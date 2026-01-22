/**
 * AI-Database Integration for @dotdo/db
 *
 * Provides AI-powered features on top of the core Thing/Relationship/Event primitives:
 * - Natural Language Queries - Transform NL questions into database queries
 * - AI Value Generation - Draft/resolve pattern with LLM field generation
 * - Semantic Search - Vector-based similarity search
 * - Event Emission - Subscribe to entity lifecycle events
 * - Relationship Traversal - Verb-based relationship operations
 * - Promise Pipelining - Lazy evaluation with method chaining
 *
 * @module @dotdo/db/ai-database
 */

import type { Thing, ThingsStore, StorableData, JsonValue, Event, EventsStore } from './index'
import type { DigitalObjectsProvider } from 'digital-objects'

// =============================================================================
// Types
// =============================================================================

/**
 * Result of a natural language query
 */
export interface NLQueryResult<T> {
  /** Human-readable interpretation of the query */
  interpretation: string
  /** Confidence score 0-1 */
  confidence: number
  /** Query results */
  results: T[]
  /** Generated SQL or filter query (for debugging) */
  query?: string
  /** Additional explanation of the query */
  explanation?: string
}

/**
 * Draft object for AI-generated entities
 * Contains unresolved natural language references
 */
export interface Draft<T extends StorableData = StorableData> {
  /** Draft phase marker */
  $phase: 'draft'
  /** Unresolved natural language references by field name */
  $refs?: Record<string, string>
  /** Draft data */
  [key: string]: unknown
}

/**
 * Value generator interface for AI-powered field generation
 */
export interface ValueGenerator {
  /** Generate a value asynchronously */
  generate(field: string, type: string, context: string): Promise<string>
  /** Generate a value synchronously (for testing) */
  generateSync(field: string, type: string, context: string): string
}

/**
 * Configuration for AI generation
 */
export interface AIGenerationConfig {
  /** LLM model to use */
  model: string
  /** Enable/disable AI generation */
  enabled: boolean
}

/**
 * Options for semantic search
 */
export interface SemanticSearchOptions {
  /** Minimum similarity score (0-1) */
  minScore?: number
  /** Maximum number of results */
  limit?: number
}

/**
 * Thing with similarity score
 */
export interface ScoredThing<T extends StorableData = StorableData> extends Thing<T> {
  /** Similarity score 0-1 */
  $score: number
}

/**
 * Options for embedding generation
 */
export interface EmbeddingsConfig {
  /** Fields to generate embeddings for */
  fields: string[]
  /** Embedding vector dimensions */
  dimensions: number
}

/**
 * Pipeline list for lazy evaluation
 */
export interface PipelineList<T> extends Promise<T[]> {
  /** Filter items by predicate */
  filter(predicate: (item: T) => boolean): PipelineList<T>
  /** Transform items */
  map<U>(transform: (item: T) => U): PipelineList<U>
}

/**
 * Event handler type
 */
export type EventHandler<P extends JsonValue = JsonValue> = (event: Event<P>) => void | Promise<void>

/**
 * Event emitter interface for entity lifecycle events
 */
export interface EntityEventEmitter {
  /** Subscribe to events */
  on(eventType: string, handler: EventHandler): () => void
  /** Emit a custom event */
  emit(eventType: string, data: unknown): Promise<{ id: string }>
}

// =============================================================================
// Natural Language Queries
// =============================================================================

/**
 * Parse a natural language query into structured components
 *
 * @internal
 */
function parseNLQuery(question: string): {
  action: 'list' | 'find' | 'count' | 'search'
  entityType?: string
  filters: Record<string, string>
  limit?: number
} {
  const q = question.toLowerCase().trim()

  // Detect action
  let action: 'list' | 'find' | 'count' | 'search' = 'list'
  if (q.includes('find') || q.includes('search for') || q.includes('look for')) {
    action = 'find'
  } else if (q.includes('count') || q.includes('how many')) {
    action = 'count'
  } else if (q.includes('similar') || q.includes('like')) {
    action = 'search'
  }

  // Extract entity type (simple heuristic)
  const entityPatterns = [
    /(?:show|list|find|get|search)\s+(?:all\s+)?(\w+)/i,
    /(\w+)s?\s+(?:from|with|where|that)/i,
  ]

  let entityType: string | undefined
  for (const pattern of entityPatterns) {
    const match = question.match(pattern)
    if (match && match[1]) {
      // Singularize and capitalize
      let type = match[1].replace(/s$/, '')
      type = type.charAt(0).toUpperCase() + type.slice(1)
      entityType = type
      break
    }
  }

  // Extract filters (simple pattern matching)
  const filters: Record<string, string> = {}

  // Pattern: "from <company>" or "at <company>"
  const fromMatch = question.match(/(?:from|at|in)\s+(\w+)/i)
  if (fromMatch) {
    filters.company = fromMatch[1]
  }

  // Pattern: "named <name>" or "called <name>"
  const namedMatch = question.match(/(?:named|called)\s+["']?(\w+)["']?/i)
  if (namedMatch) {
    filters.name = namedMatch[1]
  }

  // Pattern: "with email <email>"
  const emailMatch = question.match(/(?:with\s+)?email\s+(?:like\s+)?["']?([^\s"']+)["']?/i)
  if (emailMatch) {
    filters.email = emailMatch[1]
  }

  // Detect limit
  let limit: number | undefined
  const limitMatch = question.match(/(?:first|top|limit)\s+(\d+)/i)
  if (limitMatch) {
    limit = parseInt(limitMatch[1], 10)
  }

  return { action, entityType, filters, limit }
}

/**
 * Generate SQL-like filter from parsed NL query
 *
 * @internal
 */
function generateQueryFilter(
  parsed: ReturnType<typeof parseNLQuery>
): { type?: string; where?: Record<string, unknown>; limit?: number } {
  const result: { type?: string; where?: Record<string, unknown>; limit?: number } = {}

  if (parsed.entityType) {
    result.type = parsed.entityType
  }

  if (Object.keys(parsed.filters).length > 0) {
    result.where = {}
    for (const [key, value] of Object.entries(parsed.filters)) {
      // Convert filter patterns to query conditions
      if (value.includes('@')) {
        // Email pattern - check for domain
        const domain = value.split('@')[1]
        if (domain) {
          result.where[key] = { $contains: domain }
        }
      } else {
        // Simple equality or contains
        result.where[key] = value
      }
    }
  }

  if (parsed.limit) {
    result.limit = parsed.limit
  }

  return result
}

/**
 * Execute a natural language query against a ThingsStore
 *
 * Uses simple NL parsing and translates to store operations.
 * For production use, integrate with @dotdo/ai for LLM-based parsing.
 *
 * @param question - Natural language question
 * @param store - ThingsStore to query
 * @param type - Optional entity type to constrain results
 * @returns Query results with interpretation
 *
 * @example
 * ```typescript
 * const result = await queryNL('show all customers from acme', store)
 * console.log(result.interpretation) // "List Customer entities where company contains 'acme'"
 * console.log(result.results) // [...matching things]
 * ```
 */
export async function queryNL<T extends StorableData = StorableData>(
  question: string,
  store: ThingsStore<T>,
  type?: string
): Promise<NLQueryResult<Thing<T>>> {
  const parsed = parseNLQuery(question)
  const queryFilter = generateQueryFilter(parsed)

  // Use provided type or parsed type
  const entityType = type || queryFilter.type

  // Build interpretation
  let interpretation = `${parsed.action === 'list' ? 'List' : parsed.action === 'find' ? 'Find' : parsed.action === 'count' ? 'Count' : 'Search'}`
  if (entityType) {
    interpretation += ` ${entityType} entities`
  } else {
    interpretation += ' all entities'
  }
  if (queryFilter.where && Object.keys(queryFilter.where).length > 0) {
    const conditions = Object.entries(queryFilter.where)
      .map(([k, v]) => `${k} = '${typeof v === 'object' ? JSON.stringify(v) : v}'`)
      .join(' and ')
    interpretation += ` where ${conditions}`
  }

  // Execute query
  const listOptions: { type?: string; limit?: number } = {}
  if (entityType) {
    listOptions.type = entityType
  }
  if (queryFilter.limit) {
    listOptions.limit = queryFilter.limit
  }

  let results = await store.list(listOptions)

  // Apply additional filters if present
  if (queryFilter.where) {
    results = results.filter(item => {
      for (const [key, value] of Object.entries(queryFilter.where!)) {
        const itemValue = (item as Record<string, unknown>)[key]
        if (typeof value === 'object' && value !== null && '$contains' in value) {
          // Contains filter
          if (typeof itemValue !== 'string' || !itemValue.toLowerCase().includes(String((value as { $contains: string }).$contains).toLowerCase())) {
            return false
          }
        } else {
          // Equality filter
          if (itemValue !== value && !(typeof itemValue === 'string' && itemValue.toLowerCase().includes(String(value).toLowerCase()))) {
            return false
          }
        }
      }
      return true
    })
  }

  // Calculate confidence based on parsing certainty
  let confidence = 0.5 // Base confidence
  if (entityType) confidence += 0.2
  if (parsed.filters && Object.keys(parsed.filters).length > 0) confidence += 0.2
  if (results.length > 0) confidence += 0.1

  return {
    interpretation,
    confidence: Math.min(confidence, 1.0),
    results,
    query: JSON.stringify(queryFilter),
    explanation: `Parsed action: ${parsed.action}, type: ${entityType || 'any'}, filters: ${JSON.stringify(parsed.filters)}`
  }
}

// =============================================================================
// AI Value Generation
// =============================================================================

/**
 * Check if a field type is a prompt field (contains NL description)
 *
 * @param fieldType - The field type string from schema
 * @returns True if the field is a prompt field
 */
export function isPromptField(fieldType: string): boolean {
  // Prompt fields contain spaces, or slashes for choices, or pipe for alternatives
  // Standard types: string, number, boolean, date, etc.
  return (
    fieldType.includes(' ') ||
    (fieldType.includes('/') && !fieldType.startsWith('[')) ||
    fieldType.includes('|')
  )
}

/**
 * Parse a schema field definition
 *
 * @param field - The field definition string
 * @returns Parsed field information
 */
export function parseSchemaField(field: string): {
  type: string
  optional: boolean
  isArray: boolean
  isRelation: boolean
  relationType?: string
  backRef?: string
} {
  const isArray = field.startsWith('[') && field.endsWith(']')
  let baseField = isArray ? field.slice(1, -1) : field
  const optional = baseField.endsWith('?')
  if (optional) baseField = baseField.slice(0, -1)

  // Handle relationship syntax: Type.backref
  const isRelation = baseField.includes('.')
  let relationType: string | undefined
  let backRef: string | undefined
  let type = baseField

  if (isRelation) {
    const parts = baseField.split('.')
    relationType = parts[0]
    backRef = parts[1]
    type = relationType
  }

  return { type, optional, isArray, isRelation, relationType, backRef }
}

/**
 * Create a draft object with unresolved references
 *
 * @param data - Entity data with potential NL references
 * @param schema - Schema definition for the entity type
 * @returns Draft object with $refs for unresolved references
 *
 * @example
 * ```typescript
 * const draft = createDraft({
 *   $type: 'Lead',
 *   name: 'Enterprise Prospect',
 *   customer: 'the CEO of Acme Corp' // NL reference
 * }, LeadSchema)
 *
 * // draft.$refs.customer = 'the CEO of Acme Corp'
 * ```
 */
export function createDraft<T extends StorableData = StorableData>(
  data: Partial<T> & { $type: string },
  schema?: Record<string, string>
): Draft<T> {
  const draft: Draft<T> = {
    $phase: 'draft',
    $type: data.$type,
  }

  const refs: Record<string, string> = {}

  for (const [key, value] of Object.entries(data)) {
    if (key === '$type') continue

    // Check if value looks like a natural language reference
    if (typeof value === 'string' && schema) {
      const fieldDef = schema[key]
      if (fieldDef) {
        const parsed = parseSchemaField(fieldDef)
        // If it's a relation field and the value is NL (not a valid ID)
        if (parsed.isRelation && !value.match(/^[a-zA-Z0-9_-]+$/)) {
          refs[key] = value
          continue
        }
      }
    }

    // Check if value looks like natural language (contains spaces, articles, etc.)
    if (typeof value === 'string' && /\b(the|a|an|of|at|from|in)\b/i.test(value)) {
      refs[key] = value
      continue
    }

    draft[key] = value
  }

  if (Object.keys(refs).length > 0) {
    draft.$refs = refs
  }

  return draft
}

/**
 * Resolve a draft by finding matching entities for NL references
 *
 * @param draft - Draft with unresolved references
 * @param store - ThingsStore to search for matching entities
 * @param generator - Optional value generator for AI fields
 * @returns Resolved Thing ready for creation
 *
 * @example
 * ```typescript
 * const draft = createDraft({ $type: 'Lead', customer: 'Alice at Acme' })
 * const resolved = await resolveDraft(draft, store)
 * // resolved.customerId = '<actual-customer-id>'
 * ```
 */
export async function resolveDraft<T extends StorableData = StorableData>(
  draft: Draft<T>,
  store: ThingsStore<T>,
  generator?: ValueGenerator
): Promise<Partial<T> & { $type: string }> {
  const resolved: Record<string, unknown> = { $type: draft.$type }

  // Copy non-ref fields
  for (const [key, value] of Object.entries(draft)) {
    if (key === '$phase' || key === '$refs' || key === '$type') continue
    resolved[key] = value
  }

  // Resolve references
  if (draft.$refs) {
    for (const [field, nlRef] of Object.entries(draft.$refs)) {
      // Try to find matching entity using NL query
      const result = await queryNL(nlRef, store)

      if (result.results.length > 0) {
        // Use the first match
        const match = result.results[0]
        // Store as field + 'Id' convention
        resolved[`${field}Id`] = match.$id
      } else if (generator) {
        // Generate value using AI if no match found
        const generated = await generator.generate(field, 'string', nlRef)
        resolved[field] = generated
      } else {
        // Keep original NL reference if unresolved
        resolved[field] = nlRef
      }
    }
  }

  return resolved as Partial<T> & { $type: string }
}

/**
 * Create a Thing with AI-powered field generation
 *
 * @param data - Entity data
 * @param store - ThingsStore to create in
 * @param schema - Schema with potential prompt fields
 * @param generator - Value generator for AI fields
 * @returns Created Thing with generated values
 */
export async function createWithAI<T extends StorableData = StorableData>(
  data: Partial<T> & { $type: string },
  store: ThingsStore<T>,
  schema: Record<string, string>,
  generator: ValueGenerator
): Promise<Thing<T>> {
  const enrichedData = { ...data }

  // Find prompt fields in schema that aren't set in data
  for (const [field, fieldType] of Object.entries(schema)) {
    if (isPromptField(fieldType) && !(field in data)) {
      // Generate value using AI
      const context = JSON.stringify(data)
      const generated = await generator.generate(field, fieldType, context)
      ;(enrichedData as Record<string, unknown>)[field] = generated
    }
  }

  return store.create(enrichedData as Parameters<typeof store.create>[0])
}

// =============================================================================
// Semantic Search
// =============================================================================

/**
 * Simple cosine similarity between two vectors
 *
 * @internal
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  return denominator === 0 ? 0 : dotProduct / denominator
}

/**
 * Embedding generator interface
 */
export interface EmbeddingGenerator {
  /** Generate embedding vector for text */
  embed(text: string): Promise<number[]>
}

/**
 * Create a semantic search function for a ThingsStore
 *
 * @param store - ThingsStore to search
 * @param embedder - Embedding generator
 * @param textFields - Fields to combine for embedding
 * @returns Semantic search function
 *
 * @example
 * ```typescript
 * const search = createSemanticSearch(store, embedder, ['title', 'content'])
 * const results = await search('artificial intelligence concepts')
 * // Returns Things sorted by semantic similarity with $score
 * ```
 */
export function createSemanticSearch<T extends StorableData = StorableData>(
  store: ThingsStore<T>,
  embedder: EmbeddingGenerator,
  textFields: string[]
): (query: string, options?: SemanticSearchOptions) => Promise<ScoredThing<T>[]> {
  // Cache embeddings by entity ID
  const embeddingCache = new Map<string, number[]>()

  return async (query: string, options: SemanticSearchOptions = {}): Promise<ScoredThing<T>[]> => {
    const { minScore = 0, limit = 10 } = options

    // Generate query embedding
    const queryEmbedding = await embedder.embed(query)

    // Get all entities
    const entities = await store.list({})

    // Score each entity
    const scored: ScoredThing<T>[] = []

    for (const entity of entities) {
      // Get or generate entity embedding
      let entityEmbedding = embeddingCache.get(entity.$id)

      if (!entityEmbedding) {
        // Combine text fields for embedding
        const text = textFields
          .map(field => (entity as Record<string, unknown>)[field])
          .filter(v => typeof v === 'string')
          .join(' ')

        if (text) {
          entityEmbedding = await embedder.embed(text)
          embeddingCache.set(entity.$id, entityEmbedding)
        } else {
          continue
        }
      }

      // Calculate similarity
      const score = cosineSimilarity(queryEmbedding, entityEmbedding)

      if (score >= minScore) {
        scored.push({
          ...entity,
          $score: score
        })
      }
    }

    // Sort by score descending and limit
    scored.sort((a, b) => b.$score - a.$score)
    return scored.slice(0, limit)
  }
}

// =============================================================================
// Event Emission
// =============================================================================

/**
 * Create an event emitter wrapper for a DigitalObjectsProvider
 *
 * @param eventsStore - EventsStore to use for persistence
 * @returns Entity event emitter
 *
 * @example
 * ```typescript
 * const emitter = createEntityEventEmitter(eventsStore)
 *
 * emitter.on('Customer.created', (event) => {
 *   console.log('New customer:', event.payload)
 * })
 *
 * await emitter.emit('Customer.signup', { plan: 'enterprise' })
 * ```
 */
export function createEntityEventEmitter(
  eventsStore: EventsStore
): EntityEventEmitter {
  return {
    on(eventType: string, handler: EventHandler): () => void {
      // Subscribe to events store with type filter
      return eventsStore.subscribe((event) => {
        if (event.type === eventType) {
          handler(event)
        }
      })
    },

    async emit(eventType: string, data: unknown): Promise<{ id: string }> {
      const event = await eventsStore.emit({
        type: eventType,
        payload: data as JsonValue
      })
      return { id: event.$id }
    }
  }
}

/**
 * Wrap a ThingsStore to emit events on CRUD operations
 *
 * @param store - ThingsStore to wrap
 * @param emitter - Event emitter for publishing events
 * @returns Wrapped store with event emission
 */
export function withEventEmission<T extends StorableData = StorableData>(
  store: ThingsStore<T>,
  emitter: EntityEventEmitter
): ThingsStore<T> {
  return {
    async create(data) {
      const thing = await store.create(data)
      await emitter.emit(`${thing.$type}.created`, thing)
      return thing
    },

    async get(id) {
      return store.get(id)
    },

    async update(id, data) {
      const thing = await store.update(id, data)
      await emitter.emit(`${thing.$type}.updated`, thing)
      return thing
    },

    async delete(id) {
      const thing = await store.get(id)
      await store.delete(id)
      if (thing) {
        await emitter.emit(`${thing.$type}.deleted`, { $id: id, $type: thing.$type })
      }
    },

    list: store.list.bind(store),
    bulkCreate: store.bulkCreate?.bind(store),
    bulkUpdate: store.bulkUpdate?.bind(store),
    bulkDelete: store.bulkDelete?.bind(store),
    getMany: store.getMany?.bind(store),
    listWithCursor: store.listWithCursor?.bind(store),
  } as ThingsStore<T>
}

// =============================================================================
// Relationship Traversal
// =============================================================================

/**
 * Extended provider interface with relationship traversal
 */
export interface RelationshipTraversalProvider {
  /** Perform a verb action creating a relationship */
  perform(verb: string, fromId: string, toId: string): Promise<void>
  /** Get related entities by verb */
  related(entityId: string, verb: string, direction: 'forward' | 'backward' | 'both'): Promise<Array<{ id: string }>>
}

/**
 * Create relationship traversal methods for a provider
 *
 * @param provider - DigitalObjectsProvider to extend
 * @returns Provider with relationship traversal
 */
export function createRelationshipTraversal(
  provider: DigitalObjectsProvider & { relationships?: Map<string, Array<{ verb: string; to: string }>> }
): RelationshipTraversalProvider {
  // In-memory relationship storage for the provider
  const relationships = provider.relationships || new Map<string, Array<{ verb: string; to: string }>>()

  return {
    async perform(verb: string, fromId: string, toId: string): Promise<void> {
      // Store forward relationship
      const existing = relationships.get(fromId) || []
      existing.push({ verb, to: toId })
      relationships.set(fromId, existing)
    },

    async related(entityId: string, verb: string, direction: 'forward' | 'backward' | 'both'): Promise<Array<{ id: string }>> {
      const results: Array<{ id: string }> = []

      if (direction === 'forward' || direction === 'both') {
        // Find entities where this entity is the source
        const rels = relationships.get(entityId) || []
        for (const rel of rels) {
          if (rel.verb === verb) {
            results.push({ id: rel.to })
          }
        }
      }

      if (direction === 'backward' || direction === 'both') {
        // Find entities where this entity is the target
        for (const [fromId, rels] of relationships) {
          for (const rel of rels) {
            if (rel.verb === verb && rel.to === entityId) {
              results.push({ id: fromId })
            }
          }
        }
      }

      return results
    }
  }
}

// =============================================================================
// Promise Pipelining
// =============================================================================

/**
 * Create a pipeline list with lazy evaluation
 *
 * @param executor - Function that fetches the data
 * @returns PipelineList with chainable operations
 *
 * @example
 * ```typescript
 * const pipeline = createPipeline(store)
 * const names = await pipeline.list()
 *   .filter(c => c.name.startsWith('A'))
 *   .map(c => c.name)
 * ```
 */
export function createPipeline<T extends StorableData = StorableData>(
  store: ThingsStore<T>
): { list: (options?: { type?: string }) => PipelineList<Thing<T>> } {
  return {
    list(options?: { type?: string }): PipelineList<Thing<T>> {
      // Track pending operations
      const operations: Array<
        | { type: 'filter'; predicate: (item: unknown) => boolean }
        | { type: 'map'; transform: (item: unknown) => unknown }
      > = []

      // Create the promise that executes lazily
      const createExecutor = () => {
        return async () => {
          // Fetch data
          let data: unknown[] = await store.list(options)

          // Apply operations in order
          for (const op of operations) {
            if (op.type === 'filter') {
              data = data.filter(op.predicate)
            } else if (op.type === 'map') {
              data = data.map(op.transform)
            }
          }

          return data
        }
      }

      // Build the chainable promise
      const buildPipeline = <U>(): PipelineList<U> => {
        const executor = createExecutor()

        // Create promise-like object
        const pipeline = {
          then<TResult1 = U[], TResult2 = never>(
            onfulfilled?: ((value: U[]) => TResult1 | PromiseLike<TResult1>) | null,
            onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
          ): Promise<TResult1 | TResult2> {
            return executor().then(onfulfilled as (value: unknown[]) => TResult1, onrejected)
          },

          catch<TResult = never>(
            onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null
          ): Promise<U[] | TResult> {
            return executor().catch(onrejected)
          },

          finally(onfinally?: (() => void) | null): Promise<U[]> {
            return executor().finally(onfinally) as Promise<U[]>
          },

          filter(predicate: (item: U) => boolean): PipelineList<U> {
            operations.push({ type: 'filter', predicate: predicate as (item: unknown) => boolean })
            return buildPipeline<U>()
          },

          map<V>(transform: (item: U) => V): PipelineList<V> {
            operations.push({ type: 'map', transform: transform as (item: unknown) => unknown })
            return buildPipeline<V>()
          },

          [Symbol.toStringTag]: 'PipelineList'
        }

        return pipeline as PipelineList<U>
      }

      return buildPipeline<Thing<T>>()
    }
  }
}

// =============================================================================
// Type Inference Utilities
// =============================================================================

/**
 * Infer singular/plural forms from a type name
 *
 * @param typeName - The entity type name (e.g., 'Customer')
 * @returns Object with singular, plural, slug forms
 */
export function inferTypeForms(typeName: string): {
  singular: string
  plural: string
  slug: string
  slugPlural: string
} {
  const singular = typeName.charAt(0).toLowerCase() + typeName.slice(1)

  // Simple pluralization rules
  let plural: string
  if (singular.endsWith('y') && !/[aeiou]y$/.test(singular)) {
    plural = singular.slice(0, -1) + 'ies'
  } else if (singular.endsWith('s') || singular.endsWith('x') || singular.endsWith('ch') || singular.endsWith('sh')) {
    plural = singular + 'es'
  } else {
    plural = singular + 's'
  }

  return {
    singular,
    plural,
    slug: singular.toLowerCase(),
    slugPlural: plural.toLowerCase()
  }
}
