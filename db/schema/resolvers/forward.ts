/**
 * Forward Cascade Resolver
 *
 * Handles forward cascade operators:
 * - `->` (Forward Insert): Generate NEW target entity, link TO it
 * - `~>` (Forward Search): Semantic search first, generate if not found, link TO result
 *
 * Schema example:
 * ```typescript
 * const schema = DB({
 *   Startup: {
 *     idea: 'What is the startup idea?',
 *     businessModel: '->LeanCanvas',        // Generate new LeanCanvas, link TO it
 *     customer: '~>IdealCustomerProfile',   // Search for existing ICP, generate if not found
 *     founders: ['->Founder'],              // Generate array of new Founders
 *   },
 * })
 * ```
 */

import {
  type Entity,
  type Relationship,
  type SemanticSearchResult,
  type TypeSchema,
  type GenerationContext as SharedGenerationContext,
  type GenerateOptions as SharedGenerateOptions,
  type SearchOptions,
  type RelationshipOptions,
  type BaseCascadeResolverOptions,
  generateEntityId,
  generateRelationshipId,
  buildSearchQuery,
  sortByGenerationTime,
  buildCascadeMetadata,
  BaseCascadeResolver,
} from './shared'

// Re-export shared types
export type { Entity, Relationship, SemanticSearchResult, TypeSchema }

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

export interface ParsedReference {
  direction: 'forward' | 'backward'
  mode: 'insert' | 'fuzzy'
  operator: '->' | '~>' | '<-' | '<~'
  target: string
  fieldName: string
  prompt: string
  optional: boolean
  isArray?: boolean
  count?: number
}

export interface GenerationContext {
  entity: Entity
  previousGenerations: Entity[]
  db: unknown
  ai: unknown
}

export interface GenerateOptions {
  type: string
  prompt: string
  context: {
    parentEntity: Entity
    previousGenerations?: Entity[]
    previousInArray?: Entity[]
  }
  schema?: TypeSchema
}

export interface SemanticSearchOptions {
  type: string
  query: string
  context: {
    parentEntity: Entity
  }
}

export interface CreateRelationshipOptions {
  id?: string
  from: string
  to: string
  verb: string
  data?: Record<string, unknown> | null
  createdAt: Date
}

/**
 * Options for ForwardCascadeResolver.
 * Extends BaseCascadeResolverOptions with forward-specific options.
 */
export interface ForwardCascadeResolverOptions extends BaseCascadeResolverOptions {
  /** Filter function to select relevant previous generations for context */
  contextFilter?: (prev: Entity[], target: string) => Entity[]
  /** Database instance for direct inserts (optional) */
  db?: unknown
}

// ============================================================================
// FORWARD CASCADE RESOLVER
// ============================================================================

/**
 * Forward cascade resolver for -> and ~> operators.
 *
 * Extends BaseCascadeResolver with forward-specific relationship direction:
 * - from = this (source entity)
 * - to = target (generated/found entity)
 *
 * @example
 * ```typescript
 * const resolver = new ForwardCascadeResolver({
 *   generate: async (opts) => aiService.generate(opts),
 *   semanticSearch: async (opts) => vectorDB.search(opts),
 * })
 *
 * const result = await resolver.resolve({
 *   direction: 'forward',
 *   mode: 'insert',
 *   operator: '->',
 *   target: 'LeanCanvas',
 *   fieldName: 'businessModel',
 *   prompt: 'Generate a lean canvas',
 *   optional: false,
 * }, { entity: startup, previousGenerations: [] })
 * ```
 */
export class ForwardCascadeResolver extends BaseCascadeResolver {
  private contextFilter?: (prev: Entity[], target: string) => Entity[]
  private db: unknown

  constructor(options: ForwardCascadeResolverOptions = {}) {
    // Map forward-specific options to base options
    const baseOptions: BaseCascadeResolverOptions = {
      ...options,
      // Map semanticSearch to the base interface if provided
      semanticSearch: options.semanticSearch
        ? async (opts: SearchOptions) => options.semanticSearch!({
            type: opts.type,
            query: opts.query,
            context: { parentEntity: opts.context.parentEntity },
          })
        : undefined,
      // Map createRelationship to the base interface if provided
      createRelationship: options.createRelationship
        ? async (opts: RelationshipOptions) => options.createRelationship!({
            id: opts.id,
            from: opts.from,
            to: opts.to,
            verb: opts.verb,
            data: opts.data,
            createdAt: opts.createdAt ?? new Date(),
          })
        : undefined,
    }

    super(baseOptions)

    this.contextFilter = options.contextFilter
    this.db = options.db
  }

  /**
   * Resolve a forward reference to an entity.
   *
   * For insert mode (->): Always generates a new entity
   * For fuzzy mode (~>): Searches first, generates if no match found
   *
   * Relationship direction: from=this, to=target
   */
  async resolve(ref: ParsedReference, context: GenerationContext): Promise<Entity | null> {
    // For fuzzy mode (~>), perform semantic search first
    if (ref.mode === 'fuzzy') {
      const searchQuery = this.buildQuery(context.entity)

      const searchResults = await this.performSearch({
        type: ref.target,
        query: searchQuery,
        context: {
          parentEntity: context.entity,
        },
      })

      // Check if any result exceeds similarity threshold
      const matchingResult = searchResults.find(
        (result) => this.meetsThreshold(result.similarity)
      )

      if (matchingResult) {
        // Found existing entity - create relationship and return
        await super.createRelationship({
          id: generateRelationshipId(),
          from: context.entity.$id,
          to: matchingResult.entity.$id,
          verb: this.getVerb(ref.fieldName),
          data: this.buildMetadata(ref.operator),
          createdAt: new Date(),
        })
        return matchingResult.entity
      }
    }

    // Prepare previous generations, sorted and filtered if needed
    let previousGenerations = this.sortByTime(context.previousGenerations)
    if (this.contextFilter) {
      previousGenerations = this.contextFilter(previousGenerations, ref.target)
    }

    // Generate new entity using base class helper
    const generated = await this.generateEntity(
      ref.target,
      ref.prompt,
      {
        parentEntity: context.entity,
        previousGenerations,
      },
      ref.optional
    )

    // If generation returned null (for optional fields)
    if (!generated) {
      return null
    }

    // Store the generated entity
    await this.storeEntity(generated)

    // Handle db insert if db option provided with insert method
    if (this.db && typeof (this.db as any).insert === 'function') {
      const db = this.db as { insert: (table: string) => { values: (data: unknown) => { returning: () => Promise<unknown[]> } } }
      await db.insert('relationships').values({
        from: context.entity.$id,
        to: generated.$id,
        verb: this.getVerb(ref.fieldName),
        data: this.buildMetadata(ref.operator),
        createdAt: new Date(),
      }).returning()
    } else {
      // Create relationship using the inherited method
      // Forward direction: from=this, to=target
      await super.createRelationship({
        id: generateRelationshipId(),
        from: context.entity.$id,
        to: generated.$id,
        verb: this.getVerb(ref.fieldName),
        data: this.buildMetadata(ref.operator),
        createdAt: new Date(),
      })
    }

    return generated
  }

  /**
   * Resolve an array of forward references.
   *
   * Generates multiple entities, passing previously generated array items
   * as context to each subsequent generation.
   */
  async resolveArray(ref: ParsedReference, context: GenerationContext): Promise<Entity[]> {
    const count = ref.count ?? 1
    const results: Entity[] = []

    for (let i = 0; i < count; i++) {
      // Create a modified generate function that includes previous array items
      const previousInArray = [...results]

      const originalGenerate = this.generateFn
      const wrappedGenerate = async (opts: SharedGenerateOptions): Promise<Entity | null> => {
        return originalGenerate({
          ...opts,
          context: {
            ...opts.context,
            previousInArray,
          },
        })
      }

      // Temporarily replace generate
      this.generateFn = wrappedGenerate

      try {
        const entity = await this.resolve(ref, context)
        if (entity) {
          results.push(entity)
        }
      } finally {
        // Restore original generate
        this.generateFn = originalGenerate
      }

      // Small delay between iterations to ensure unique timestamps for relationship ids
      // This ensures Date.now() returns different values for each relationship
      if (i < count - 1) {
        await new Promise(resolve => setTimeout(resolve, 1))
      }
    }

    return results
  }
}

// ============================================================================
// SHORTHAND HELPER FUNCTIONS
// ============================================================================

export interface ShorthandReference {
  target: string
  fieldName: string
  prompt: string
}

/**
 * Shorthand for resolving a forward insert (->) reference
 */
export async function resolveForwardInsert(
  ref: ShorthandReference,
  context: GenerationContext,
  resolver: ForwardCascadeResolver
): Promise<Entity> {
  const parsedRef: ParsedReference = {
    direction: 'forward',
    mode: 'insert',
    operator: '->',
    target: ref.target,
    fieldName: ref.fieldName,
    prompt: ref.prompt,
    optional: false,
  }

  const result = await resolver.resolve(parsedRef, context)
  return result!
}

/**
 * Shorthand for resolving a forward search (~>) reference
 */
export async function resolveForwardSearch(
  ref: ShorthandReference,
  context: GenerationContext,
  resolver: ForwardCascadeResolver
): Promise<Entity> {
  const parsedRef: ParsedReference = {
    direction: 'forward',
    mode: 'fuzzy',
    operator: '~>',
    target: ref.target,
    fieldName: ref.fieldName,
    prompt: ref.prompt,
    optional: false,
  }

  const result = await resolver.resolve(parsedRef, context)
  return result!
}

// ============================================================================
// SESSION CACHE
// ============================================================================

/**
 * Cache entry with TTL and hit tracking
 */
interface CacheEntry<T> {
  value: T
  timestamp: number
  hits: number
}

/**
 * Session cache for within-generation caching
 *
 * Prevents duplicate searches within a single generation session.
 * Cache is keyed by type + query hash for efficient lookups.
 *
 * Features:
 * - TTL-based expiration
 * - Hit counting for cache analytics
 * - Type-scoped cache keys
 * - Configurable max entries to prevent memory bloat
 *
 * @example
 * ```typescript
 * const cache = new SessionCache<SemanticSearchResult[]>({ ttlMs: 30000 })
 *
 * // First search - cache miss
 * const results = await semanticSearch(type, query, threshold)
 * cache.set(type, query, results)
 *
 * // Second search with same query - cache hit
 * const cached = cache.get(type, query)
 * if (cached) return cached
 * ```
 */
export class SessionCache<T> {
  private cache: Map<string, CacheEntry<T>>
  private ttlMs: number
  private maxEntries: number

  constructor(options: { ttlMs?: number; maxEntries?: number } = {}) {
    this.cache = new Map()
    this.ttlMs = options.ttlMs ?? 60000 // Default 1 minute TTL
    this.maxEntries = options.maxEntries ?? 1000
  }

  /**
   * Build a cache key from type and query
   */
  private buildKey(type: string, query: string): string {
    // Simple hash for query to keep keys manageable
    const queryHash = this.hashQuery(query)
    return `${type}:${queryHash}`
  }

  /**
   * Simple hash function for query strings
   */
  private hashQuery(query: string): string {
    let hash = 0
    for (let i = 0; i < query.length; i++) {
      const char = query.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36)
  }

  /**
   * Get a cached value if it exists and hasn't expired
   */
  get(type: string, query: string): T | undefined {
    const key = this.buildKey(type, query)
    const entry = this.cache.get(key)

    if (!entry) {
      return undefined
    }

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key)
      return undefined
    }

    // Update hit count
    entry.hits++
    return entry.value
  }

  /**
   * Set a value in the cache
   */
  set(type: string, query: string, value: T): void {
    const key = this.buildKey(type, query)

    // Evict oldest entries if at capacity
    if (this.cache.size >= this.maxEntries && !this.cache.has(key)) {
      this.evictOldest()
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      hits: 0,
    })
  }

  /**
   * Check if a key exists in the cache (and is not expired)
   */
  has(type: string, query: string): boolean {
    return this.get(type, query) !== undefined
  }

  /**
   * Clear the entire cache
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; hits: number; maxEntries: number } {
    let totalHits = 0
    for (const entry of this.cache.values()) {
      totalHits += entry.hits
    }
    return {
      size: this.cache.size,
      hits: totalHits,
      maxEntries: this.maxEntries,
    }
  }

  /**
   * Evict oldest entry from cache
   */
  private evictOldest(): void {
    let oldestKey: string | undefined
    let oldestTime = Infinity

    for (const [key, entry] of this.cache) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp
        oldestKey = key
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey)
    }
  }

  /**
   * Remove expired entries
   */
  prune(): number {
    const now = Date.now()
    let pruned = 0

    for (const [key, entry] of this.cache) {
      if (now - entry.timestamp > this.ttlMs) {
        this.cache.delete(key)
        pruned++
      }
    }

    return pruned
  }
}

// ============================================================================
// SEMANTIC SEARCH HELPER
// ============================================================================

/**
 * Embedding function type for generating vector embeddings
 */
export type EmbedFunction = (text: string) => Promise<number[]>

/**
 * Vector search function type
 */
export type VectorSearchFunction = (
  type: string,
  embedding: number[],
  options: { k?: number; threshold?: number }
) => Promise<Array<{ id: string; score: number; metadata?: Record<string, unknown> }>>

/**
 * Entity loader function type
 */
export type EntityLoaderFunction = (ids: string[]) => Promise<Entity[]>

/**
 * Semantic search helper options
 */
export interface SemanticSearchHelperOptions {
  /** Function to generate embeddings */
  embed: EmbedFunction
  /** Function to search vectors */
  vectorSearch: VectorSearchFunction
  /** Function to load entities by ID */
  loadEntities: EntityLoaderFunction
  /** Session cache for deduplication */
  cache?: SessionCache<SemanticSearchResult[]>
  /** Default similarity threshold */
  defaultThreshold?: number
  /** Default number of results to return */
  defaultK?: number
}

/**
 * Create a semantic search helper function with caching
 *
 * This helper:
 * 1. Checks cache for existing results
 * 2. Embeds query text using configured embed function
 * 3. Performs vector search against entity type index
 * 4. Loads full entities from search results
 * 5. Caches results for session deduplication
 *
 * @example
 * ```typescript
 * const semanticSearch = createSemanticSearchHelper({
 *   embed: async (text) => ai.embed(text),
 *   vectorSearch: async (type, embedding, opts) => edgevec.search(type, embedding, opts),
 *   loadEntities: async (ids) => db.select(entities).where(in_(id, ids)),
 *   cache: new SessionCache({ ttlMs: 30000 }),
 *   defaultThreshold: 0.8,
 * })
 *
 * const results = await semanticSearch('Customer', 'enterprise SaaS buyer', 0.85)
 * ```
 */
export function createSemanticSearchHelper(
  options: SemanticSearchHelperOptions
): (type: string, query: string, threshold?: number) => Promise<SemanticSearchResult[]> {
  const {
    embed,
    vectorSearch,
    loadEntities,
    cache,
    defaultThreshold = 0.80,
    defaultK = 10,
  } = options

  return async (
    type: string,
    query: string,
    threshold: number = defaultThreshold
  ): Promise<SemanticSearchResult[]> => {
    // Check cache first
    if (cache) {
      const cached = cache.get(type, query)
      if (cached) {
        // Filter cached results by threshold (threshold may differ)
        return cached.filter(r => r.similarity >= threshold)
      }
    }

    // Generate embedding for query
    const embedding = await embed(query)

    // Search vectors
    const searchResults = await vectorSearch(type, embedding, {
      k: defaultK,
      threshold,
    })

    if (searchResults.length === 0) {
      // Cache empty result
      if (cache) {
        cache.set(type, query, [])
      }
      return []
    }

    // Load full entities
    const entityIds = searchResults.map(r => r.id)
    const entities = await loadEntities(entityIds)

    // Build entity map for efficient lookup
    const entityMap = new Map<string, Entity>()
    for (const entity of entities) {
      entityMap.set(entity.$id, entity)
    }

    // Combine search results with entities
    const results: SemanticSearchResult[] = []
    for (const searchResult of searchResults) {
      const entity = entityMap.get(searchResult.id)
      if (entity) {
        results.push({
          entity,
          similarity: searchResult.score,
        })
      }
    }

    // Cache results
    if (cache) {
      cache.set(type, query, results)
    }

    return results
  }
}

// ============================================================================
// FORWARD SEARCH WITH CACHING
// ============================================================================

/**
 * Extended options for forward cascade resolver with caching
 */
export interface ForwardCascadeResolverWithCacheOptions extends ForwardCascadeResolverOptions {
  /** Session cache for semantic search deduplication */
  searchCache?: SessionCache<SemanticSearchResult[]>
  /** Embedding function for semantic search */
  embed?: EmbedFunction
  /** Vector search function */
  vectorSearch?: VectorSearchFunction
  /** Entity loader function */
  loadEntities?: EntityLoaderFunction
}

/**
 * Create a forward cascade resolver with integrated semantic search caching
 *
 * This factory function creates a resolver with:
 * - Session caching for semantic search deduplication
 * - Integrated vector search via EdgeVec or similar
 * - Automatic embedding generation
 *
 * @example
 * ```typescript
 * const resolver = createForwardResolverWithCache({
 *   embed: async (text) => env.AI.run('@cf/baai/bge-base-en-v1.5', { text }),
 *   vectorSearch: async (type, embedding, opts) => {
 *     const result = await env.EDGEVEC.search(namespace, type, embedding, opts)
 *     return result.success ? result.results : []
 *   },
 *   loadEntities: async (ids) => {
 *     return db.query.entities.findMany({ where: inArray(entities.id, ids) })
 *   },
 *   searchCache: new SessionCache({ ttlMs: 60000 }),
 *   similarityThreshold: 0.85,
 * })
 * ```
 */
export function createForwardResolverWithCache(
  options: ForwardCascadeResolverWithCacheOptions
): ForwardCascadeResolver {
  const {
    searchCache,
    embed,
    vectorSearch,
    loadEntities,
    ...baseOptions
  } = options

  // If semantic search dependencies are provided, create the helper
  let semanticSearchFn = baseOptions.semanticSearch

  if (embed && vectorSearch && loadEntities && !semanticSearchFn) {
    const searchHelper = createSemanticSearchHelper({
      embed,
      vectorSearch,
      loadEntities,
      cache: searchCache,
      defaultThreshold: baseOptions.similarityThreshold ?? 0.80,
    })

    // Wrap the helper to match SemanticSearchOptions interface
    semanticSearchFn = async (opts: SemanticSearchOptions): Promise<SemanticSearchResult[]> => {
      return searchHelper(opts.type, opts.query, baseOptions.similarityThreshold)
    }
  }

  return new ForwardCascadeResolver({
    ...baseOptions,
    semanticSearch: semanticSearchFn,
  })
}
