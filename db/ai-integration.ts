/**
 * AI Integration Layer for @dotdo/db
 *
 * Bridges @dotdo/db's ThingsStore with ai-database's AI features including:
 * - Natural Language Queries via queryNL()
 * - AI Value Generation via createWithAI()
 * - Draft/Resolve Pattern for cascade generation
 * - Semantic Search via semanticSearch()
 *
 * @module @dotdo/db/ai-integration
 */

import type { Thing, ThingsStore } from './things'
import type { StorableData } from './types'

// =============================================================================
// Types
// =============================================================================

/**
 * Result from a natural language query
 */
export interface NLQueryResult<T> {
  /** Human-readable interpretation of the query */
  interpretation: string
  /** Confidence score (0-1) */
  confidence: number
  /** Query results */
  results: T[]
  /** Generated query (SQL or filter structure) */
  query?: string
  /** Explanation of how query was processed */
  explanation?: string
}

/**
 * Draft object for two-phase creation
 */
export interface Draft<T = Record<string, unknown>> {
  /** Marks this as a draft */
  $phase: 'draft'
  /** Unresolved references (natural language to entity mappings) */
  $refs?: Record<string, string>
  /** Draft data */
  [key: string]: unknown
}

/**
 * Value generator interface for AI field generation
 */
export interface ValueGenerator {
  /** Generate a value asynchronously */
  generate(field: string, type: string, context: string): Promise<string>
  /** Generate a value synchronously (for placeholder fallback) */
  generateSync(field: string, type: string, context: string): string
}

/**
 * Options for AI-powered operations
 */
export interface AIOptions {
  /** Model to use for generation */
  model?: string
  /** Whether to use cascade generation */
  cascade?: boolean
  /** Maximum depth for cascade generation */
  maxDepth?: number
}

/**
 * Scored result from semantic search
 */
export interface ScoredThing<T = Thing> {
  /** The entity data */
  entity: T
  /** Similarity score (0-1) */
  $score: number
}

/**
 * Options for semantic search
 */
export interface SemanticSearchOptions {
  /** Minimum similarity score */
  minScore?: number
  /** Maximum number of results */
  limit?: number
  /** Fields to consider for embedding */
  fields?: string[]
}

/**
 * Configuration for NL query generator
 */
export interface NLQueryGeneratorConfig {
  /** AI model to use */
  model?: string
  /** Custom prompt template */
  promptTemplate?: string
}

/**
 * NL Query Generator function type
 */
export type NLQueryGenerator = (
  question: string,
  context: { types: string[]; fields: Record<string, string[]> }
) => Promise<{
  interpretation: string
  confidence: number
  types: string[]
  filters?: Record<string, unknown>
  search?: string
}>

// =============================================================================
// State Management
// =============================================================================

let nlQueryGenerator: NLQueryGenerator | null = null
let valueGenerator: ValueGenerator | null = null

/**
 * Set the NL query generator for natural language queries
 */
export function setNLQueryGenerator(generator: NLQueryGenerator): void {
  nlQueryGenerator = generator
}

/**
 * Get the current NL query generator
 */
export function getNLQueryGenerator(): NLQueryGenerator | null {
  return nlQueryGenerator
}

/**
 * Set the value generator for AI field generation
 */
export function setValueGenerator(generator: ValueGenerator): void {
  valueGenerator = generator
}

/**
 * Get the current value generator
 */
export function getValueGenerator(): ValueGenerator | null {
  return valueGenerator
}

// =============================================================================
// Natural Language Query
// =============================================================================

/**
 * Execute a natural language query against a ThingsStore
 *
 * @param question - The natural language question
 * @param store - The ThingsStore to query
 * @param type - Optional type to constrain query to
 * @returns NLQueryResult with interpretation and results
 *
 * @example
 * ```typescript
 * const result = await queryNL('show all customers from acme', store, 'Customer')
 * console.log(result.interpretation) // "Find customers with company containing 'acme'"
 * console.log(result.results) // [{ $id: '...', name: 'Alice', company: 'Acme Corp' }]
 * ```
 */
export async function queryNL<T extends Thing = Thing>(
  question: string,
  store: ThingsStore,
  type?: string
): Promise<NLQueryResult<T>> {
  const lowerQuestion = question.toLowerCase().trim()

  // Extract meaningful keywords for filtering
  const stopWords = new Set([
    'customers', 'customer', 'companies', 'company', 'leads', 'lead',
    'posts', 'post', 'users', 'user', 'items', 'item',
    'show', 'find', 'get', 'list', 'display', 'all', 'every', 'the',
    'from', 'at', 'in', 'with', 'for', 'by', 'to', 'of', 'and', 'or'
  ])

  const potentialKeywords = lowerQuestion
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w))

  // Simple heuristic for "list all" patterns - only if no meaningful filter keywords
  const isListAllQuery =
    ((/^(show|list|get|find|display)\s+(all|every|the)?\s*/i.test(lowerQuestion) ||
    /\ball\b/i.test(lowerQuestion)) && potentialKeywords.length === 0)

  // If we have an AI generator, use it
  if (nlQueryGenerator) {
    // Build context for the generator
    const types = type ? [type] : []
    const fields: Record<string, string[]> = {}

    // Get the types from the question context
    const context = { types, fields }
    const plan = await nlQueryGenerator(question, context)

    // Execute the query based on the plan
    const results: T[] = []

    for (const typeName of plan.types) {
      const items = await store.list({ type: typeName })

      // Apply filters if any
      if (plan.filters && Object.keys(plan.filters).length > 0) {
        const filtered = items.filter((item) => {
          for (const [key, value] of Object.entries(plan.filters!)) {
            const itemValue = item[key as keyof typeof item]
            if (typeof value === 'string' && typeof itemValue === 'string') {
              if (!itemValue.toLowerCase().includes(value.toLowerCase())) {
                return false
              }
            } else if (itemValue !== value) {
              return false
            }
          }
          return true
        })
        results.push(...(filtered as T[]))
      } else {
        results.push(...(items as T[]))
      }
    }

    return {
      interpretation: plan.interpretation,
      confidence: plan.confidence,
      results,
      query: JSON.stringify({ types: plan.types, filters: plan.filters }),
    }
  }

  // Fallback to simple keyword search
  const results: T[] = []

  if (type) {
    const items = await store.list({ type })
    if (isListAllQuery) {
      results.push(...(items as T[]))
    } else {
      // Use previously extracted keywords for filtering
      if (potentialKeywords.length === 0) {
        // No meaningful keywords, return all
        results.push(...(items as T[]))
      } else {
        const filtered = items.filter((item) => {
          const itemStr = JSON.stringify(item).toLowerCase()
          // Must match ALL meaningful keywords for precision
          return potentialKeywords.every((kw) => itemStr.includes(kw))
        })
        results.push(...(filtered as T[]))
      }
    }
  } else {
    // Without type constraint, return empty (would need schema info)
    return {
      interpretation: `Cannot search without type constraint`,
      confidence: 0.3,
      results: [],
      explanation: 'Type parameter required for fallback search',
    }
  }

  return {
    interpretation: isListAllQuery ? `List all ${type || 'entities'}` : `Search for "${question}"`,
    confidence: 0.5,
    results,
    explanation: 'Fallback to keyword search (no AI generator configured)',
  }
}

// =============================================================================
// Draft/Resolve Pattern
// =============================================================================

/**
 * Create a draft object with unresolved references
 *
 * Drafts allow specifying relationships using natural language
 * that will be resolved later to actual entity IDs.
 *
 * @param data - The entity data with natural language references
 * @returns A Draft object with $phase and $refs
 *
 * @example
 * ```typescript
 * const draft = await createDraft({
 *   $type: 'Lead',
 *   name: 'Enterprise Prospect',
 *   customer: 'the CEO of Acme Corp', // Natural language reference
 * })
 *
 * console.log(draft.$phase) // 'draft'
 * console.log(draft.$refs?.customer) // 'the CEO of Acme Corp'
 * ```
 */
export async function createDraft<T extends Record<string, unknown>>(
  data: T & { $type: string }
): Promise<Draft<T>> {
  const refs: Record<string, string> = {}
  const cleanData: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(data)) {
    // Skip metadata fields
    if (key.startsWith('$')) {
      cleanData[key] = value
      continue
    }

    // Check if value looks like a natural language reference
    if (typeof value === 'string' && isNaturalLanguageReference(value)) {
      refs[key] = value
    } else {
      cleanData[key] = value
    }
  }

  return {
    ...cleanData,
    $phase: 'draft',
    $refs: Object.keys(refs).length > 0 ? refs : undefined,
  } as Draft<T>
}

/**
 * Check if a string looks like a natural language reference
 */
function isNaturalLanguageReference(value: string): boolean {
  // Patterns that indicate natural language references:
  // - "the X of Y" pattern
  // - "X at Y" pattern
  // - Contains common relationship words
  const nlPatterns = [
    /^the\s+\w+\s+of\s+/i, // "the CEO of Acme"
    /\s+at\s+\w+/i, // "Alice at Acme"
    /\w+\s+at\s+\w+/i, // "Alice at Acme" (alternative)
    /^(a|an)\s+\w+\s+(from|for|with)/i, // "a customer from..."
  ]

  return nlPatterns.some((pattern) => pattern.test(value))
}

/**
 * Resolve a draft to a Thing by resolving natural language references
 *
 * @param draft - The draft to resolve
 * @param store - The ThingsStore for looking up references
 * @returns The resolved Thing with actual entity IDs
 *
 * @example
 * ```typescript
 * const resolved = await resolveDraft(draft, store)
 * console.log(resolved.customerId) // 'abc-123' (actual customer ID)
 * ```
 */
export async function resolveDraft<T extends Thing = Thing>(
  draft: Draft,
  store: ThingsStore
): Promise<T> {
  const resolved: Record<string, unknown> = {}

  // Copy non-draft fields
  for (const [key, value] of Object.entries(draft)) {
    if (key === '$phase' || key === '$refs') continue
    resolved[key] = value
  }

  // Resolve references
  if (draft.$refs) {
    for (const [fieldName, nlRef] of Object.entries(draft.$refs)) {
      const resolvedId = await resolveReference(nlRef, store)
      if (resolvedId) {
        // Convert field name to ID field (e.g., 'customer' -> 'customerId')
        const idFieldName = fieldName.endsWith('Id') ? fieldName : `${fieldName}Id`
        resolved[idFieldName] = resolvedId
      }
    }
  }

  return resolved as T
}

/**
 * Resolve a natural language reference to an entity ID
 */
async function resolveReference(nlRef: string, store: ThingsStore): Promise<string | null> {
  // Parse the reference to extract search terms
  const searchTerms = nlRef
    .toLowerCase()
    .replace(/^(the|a|an)\s+/i, '')
    .replace(/\s+(of|at|from|for|with)\s+/gi, ' ')
    .trim()

  // Try to find matching entities
  // First, try to extract a type hint from the reference
  const typeHints: Record<string, string> = {
    ceo: 'Customer',
    cto: 'Customer',
    cfo: 'Customer',
    founder: 'Customer',
    customer: 'Customer',
    company: 'Company',
    lead: 'Lead',
    author: 'Customer',
  }

  let type: string | undefined
  for (const [hint, typeName] of Object.entries(typeHints)) {
    if (nlRef.toLowerCase().includes(hint)) {
      type = typeName
      break
    }
  }

  // If no type hint found, try to infer from field name patterns
  // For references like "Alice at Acme", assume Customer type
  if (!type) {
    // Check if it looks like a person reference (name at company pattern)
    if (/\w+\s+at\s+\w+/i.test(nlRef)) {
      type = 'Customer'
    }
  }

  if (!type) return null

  // Search for matching entities
  const items = await store.list({ type })

  // Score each item by how well it matches the search terms
  const terms = searchTerms.split(/\s+/).filter((t) => t.length > 1)
  let bestMatch: Thing | null = null
  let bestScore = 0

  for (const item of items) {
    const itemStr = JSON.stringify(item).toLowerCase()
    let score = 0

    for (const term of terms) {
      if (itemStr.includes(term)) {
        score++
      }
    }

    if (score > bestScore) {
      bestScore = score
      bestMatch = item
    }
  }

  return bestMatch?.$id || null
}

// =============================================================================
// AI Value Generation
// =============================================================================

/**
 * Create an entity with AI-generated values for prompt fields
 *
 * @param data - The entity data (prompt fields will be generated)
 * @param store - The ThingsStore to create in
 * @param generator - Optional value generator to use
 * @returns The created Thing with generated values
 *
 * @example
 * ```typescript
 * const generator = {
 *   generate: async (field, type, context) => 'AI generated value',
 *   generateSync: (field, type, context) => 'Sync generated value',
 * }
 *
 * const lead = await createWithAI(
 *   { $type: 'Lead', name: 'Enterprise Prospect' },
 *   store,
 *   generator
 * )
 * // lead.notes is now AI-generated based on the schema's prompt field
 * ```
 */
export async function createWithAI<T extends Thing = Thing>(
  data: { $type: string } & Record<string, unknown>,
  store: ThingsStore,
  generator?: ValueGenerator,
  schema?: Record<string, Record<string, string>>
): Promise<T> {
  const gen = generator || valueGenerator

  if (!gen) {
    // No generator, just create normally
    return store.create(data) as Promise<T>
  }

  // Generate values for prompt fields
  const enrichedData = { ...data }
  const type = data.$type

  if (schema && schema[type]) {
    const typeSchema = schema[type]

    for (const [fieldName, fieldType] of Object.entries(typeSchema)) {
      // Skip if value already provided
      if (enrichedData[fieldName] !== undefined) continue

      // Check if this is a prompt field (contains spaces, slashes, or question marks)
      const isPromptField =
        fieldType.includes(' ') || fieldType.includes('/') || fieldType.includes('?')

      if (isPromptField) {
        // Build context from existing data
        const contextParts: string[] = []
        for (const [key, value] of Object.entries(enrichedData)) {
          if (!key.startsWith('$') && typeof value === 'string') {
            contextParts.push(`${key}: ${value}`)
          }
        }
        const context = contextParts.join(', ')

        // Generate the value
        enrichedData[fieldName] = await gen.generate(fieldName, type, context)
      }
    }
  }

  return store.create(enrichedData) as Promise<T>
}

// =============================================================================
// Semantic Search
// =============================================================================

/**
 * Perform semantic search on a ThingsStore
 *
 * Note: This requires embeddings to be configured and stored with entities.
 * In the current implementation, this falls back to keyword search.
 *
 * @param query - The search query
 * @param store - The ThingsStore to search
 * @param type - The entity type to search
 * @param options - Search options
 * @returns Scored results sorted by similarity
 *
 * @example
 * ```typescript
 * const results = await semanticSearch(
 *   'artificial intelligence concepts',
 *   store,
 *   'BlogPost',
 *   { minScore: 0.5, limit: 10 }
 * )
 * // Results ranked by semantic similarity
 * ```
 */
export async function semanticSearch<T extends Thing = Thing>(
  query: string,
  store: ThingsStore,
  type: string,
  options?: SemanticSearchOptions
): Promise<ScoredThing<T>[]> {
  const { minScore = 0, limit = 10 } = options || {}

  // Get all items of the type
  const items = await store.list({ type })

  // Calculate similarity scores
  const scored: ScoredThing<T>[] = []
  const queryTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2)

  for (const item of items) {
    // Calculate a basic keyword similarity score
    const itemStr = JSON.stringify(item).toLowerCase()
    let matches = 0

    for (const term of queryTerms) {
      if (itemStr.includes(term)) {
        matches++
      }
    }

    const score = queryTerms.length > 0 ? matches / queryTerms.length : 0

    if (score >= minScore) {
      scored.push({
        entity: item as T,
        $score: score,
      })
    }
  }

  // Sort by score descending
  scored.sort((a, b) => b.$score - a.$score)

  // Apply limit
  return scored.slice(0, limit)
}

// =============================================================================
// Pipeline Support
// =============================================================================

/**
 * A promise that supports lazy chaining operations
 */
export interface PipelineList<T> extends Promise<T[]> {
  /** Filter results */
  filter(predicate: (item: T) => boolean): PipelineList<T>
  /** Map results */
  map<U>(transform: (item: T) => U): PipelineList<U>
}

/**
 * Create a pipeline-enabled list operation
 *
 * @param store - The ThingsStore to query
 * @param type - The entity type to list
 * @returns A PipelineList that supports chaining
 *
 * @example
 * ```typescript
 * const results = await createPipeline(store, 'Customer')
 *   .filter(c => c.name.startsWith('A'))
 *   .map(c => ({ name: c.name, email: c.email }))
 *
 * // Operations are accumulated and executed lazily
 * ```
 */
export function createPipeline<T extends Thing = Thing>(
  store: ThingsStore,
  type?: string
): PipelineList<T> {
  const operations: Array<{
    type: 'filter' | 'map'
    fn: (items: unknown[]) => unknown[]
  }> = []

  const executeOperations = async (): Promise<T[]> => {
    let items: unknown[] = await store.list({ type })

    for (const op of operations) {
      items = op.fn(items)
    }

    return items as T[]
  }

  const pipeline: PipelineList<T> = Object.assign(
    executeOperations().then((results) => results),
    {
      filter(predicate: (item: T) => boolean): PipelineList<T> {
        operations.push({
          type: 'filter',
          fn: (items) => (items as T[]).filter(predicate),
        })
        return createNextPipeline()
      },
      map<U>(transform: (item: T) => U): PipelineList<U> {
        operations.push({
          type: 'map',
          fn: (items) => (items as T[]).map(transform),
        })
        return createNextPipeline() as unknown as PipelineList<U>
      },
    }
  )

  function createNextPipeline<U>(): PipelineList<U> {
    const nextPipeline: PipelineList<U> = Object.assign(
      executeOperations().then((results) => results as unknown as U[]),
      {
        filter(predicate: (item: U) => boolean): PipelineList<U> {
          operations.push({
            type: 'filter',
            fn: (items) => (items as U[]).filter(predicate),
          })
          return createNextPipeline<U>()
        },
        map<V>(transform: (item: U) => V): PipelineList<V> {
          operations.push({
            type: 'map',
            fn: (items) => (items as U[]).map(transform),
          })
          return createNextPipeline<V>()
        },
      }
    )
    return nextPipeline
  }

  return pipeline
}

// =============================================================================
// AI-Enhanced Store Wrapper
// =============================================================================

/**
 * AI-enhanced ThingsStore with NL query and generation support
 */
export interface AIThingsStore<T extends StorableData = StorableData> extends ThingsStore<T> {
  /** Natural language query */
  queryNL(question: string, type?: string): Promise<NLQueryResult<Thing<T>>>

  /** Create with AI-generated values */
  createWithAI(
    data: { $type: string } & Partial<T>,
    options?: AIOptions
  ): Promise<Thing<T>>

  /** Create a draft with natural language references */
  createDraft(data: { $type: string } & Partial<T>): Promise<Draft<T>>

  /** Resolve a draft to a Thing */
  resolveDraft(draft: Draft<T>): Promise<Thing<T>>

  /** Semantic search */
  semanticSearch(
    query: string,
    type: string,
    options?: SemanticSearchOptions
  ): Promise<ScoredThing<Thing<T>>[]>

  /** Create a pipeline for lazy evaluation */
  pipeline(type?: string): PipelineList<Thing<T>>
}

/**
 * Wrap a ThingsStore with AI capabilities
 *
 * @param store - The base ThingsStore to enhance
 * @param schema - Optional schema for AI value generation
 * @returns An AIThingsStore with additional AI methods
 *
 * @example
 * ```typescript
 * const store = createThingsStore()
 * const aiStore = wrapWithAI(store, TestSchema)
 *
 * // Use AI-enhanced methods
 * const results = await aiStore.queryNL('show all customers from acme')
 * const lead = await aiStore.createWithAI({ $type: 'Lead', name: 'Prospect' })
 * ```
 */
export function wrapWithAI<T extends StorableData = StorableData>(
  store: ThingsStore<T>,
  schema?: Record<string, Record<string, string>>
): AIThingsStore<T> {
  return {
    // Passthrough base methods
    create: store.create.bind(store),
    get: store.get.bind(store),
    update: store.update.bind(store),
    delete: store.delete.bind(store),
    list: store.list.bind(store),
    bulkCreate: store.bulkCreate.bind(store),
    bulkUpdate: store.bulkUpdate.bind(store),
    bulkDelete: store.bulkDelete.bind(store),

    // AI-enhanced methods
    async queryNL(question: string, type?: string) {
      return queryNL(question, store as unknown as ThingsStore, type)
    },

    async createWithAI(data: { $type: string } & Partial<T>, options?: AIOptions) {
      return createWithAI(data as { $type: string } & Record<string, unknown>, store as unknown as ThingsStore, undefined, schema) as Promise<Thing<T>>
    },

    async createDraft(data: { $type: string } & Partial<T>) {
      return createDraft(data as { $type: string } & Record<string, unknown>) as Promise<Draft<T>>
    },

    async resolveDraft(draft: Draft<T>) {
      return resolveDraft(draft as Draft, store as unknown as ThingsStore) as Promise<Thing<T>>
    },

    async semanticSearch(query: string, type: string, options?: SemanticSearchOptions) {
      return semanticSearch(query, store as unknown as ThingsStore, type, options) as Promise<ScoredThing<Thing<T>>[]>
    },

    pipeline(type?: string) {
      return createPipeline(store as unknown as ThingsStore, type) as PipelineList<Thing<T>>
    },
  }
}
