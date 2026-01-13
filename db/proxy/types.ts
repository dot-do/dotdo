/**
 * @fileoverview DB Proxy Type Definitions
 *
 * This module defines the type system for dotdo's database proxy layer, which implements
 * Cap'n Proto-style promise pipelining for efficient database operations.
 *
 * ## Promise Pipelining Overview
 *
 * Traditional database access requires awaiting each operation before using its result:
 *
 * ```typescript
 * // Traditional: 3 network round trips
 * const lead = await db.getLead('lead-123')
 * const company = await db.getCompany(lead.companyId)
 * const contacts = await db.getContacts(company.id)
 * ```
 *
 * With promise pipelining, operations can be chained without awaiting intermediate results.
 * The pipeline is sent to the server as a single operation, requiring only one round trip:
 *
 * ```typescript
 * // Pipelined: 1 network round trip
 * const contacts = await db.Lead
 *   .get('lead-123')
 *   .expand('company')
 *   .expand('contacts')
 * ```
 *
 * ## Architecture
 *
 * The proxy system consists of three main components:
 *
 * 1. **DBProxy** - Entry point that intercepts property access (e.g., `db.Lead`)
 *    and returns EntityAccessor instances for each entity type.
 *
 * 2. **EntityAccessor** - Provides CRUD operations (`get`, `list`, `create`, etc.)
 *    and supports natural language queries via template literals (`db.Lead\`query\``).
 *
 * 3. **DBPromise** - A thenable that accumulates query operations (filter, sort, limit)
 *    and executes them lazily when awaited. Each method returns a new DBPromise,
 *    enabling fluent chaining.
 *
 * ## Key Features
 *
 * - **Lazy Execution**: Query operations are accumulated and executed only when awaited
 * - **Fluent API**: Method chaining with type preservation
 * - **Natural Language Queries**: Template literal syntax for AI-powered queries
 * - **Batch Processing**: `forEach` with concurrency control and crash recovery
 * - **Cursor-based Pagination**: Efficient pagination with `after()` and `paginate()`
 *
 * @see {@link DBProxy} - Main database accessor interface
 * @see {@link EntityAccessor} - Entity-specific operations
 * @see {@link DBPromise} - Fluent query builder
 *
 * @module db/proxy/types
 */

import type { ThingEntity } from '../stores'

// ============================================================================
// DB PROMISE - Fluent Query Builder
// ============================================================================

/**
 * DBPromise - Fluent Query Builder with Promise Pipelining
 *
 * A thenable object that accumulates query operations and executes them lazily
 * when awaited. This enables Cap'n Proto-style promise pipelining where multiple
 * operations can be chained without intermediate awaits.
 *
 * ## How Promise Pipelining Works
 *
 * Each method on DBPromise returns a **new** DBPromise instance with the operation
 * added to an internal queue. No database calls are made until the promise is
 * awaited. This allows the entire query pipeline to be optimized and executed
 * as a single operation.
 *
 * ```typescript
 * // These operations are NOT executed immediately
 * const pipeline = db.Lead
 *   .filter(lead => lead.status === 'active')  // Returns new DBPromise
 *   .orderBy('score', 'desc')                   // Returns new DBPromise
 *   .limit(10)                                  // Returns new DBPromise
 *
 * // Execution happens HERE when awaited
 * const results = await pipeline
 * ```
 *
 * ## Immutability
 *
 * Each method creates a new DBPromise, preserving immutability:
 *
 * ```typescript
 * const base = db.Lead.filter(l => l.active)
 * const topTen = base.limit(10)    // New DBPromise, base unchanged
 * const sorted = base.orderBy('score')  // New DBPromise from same base
 * ```
 *
 * ## Memoization
 *
 * Once executed, results are cached. Subsequent awaits return the same result:
 *
 * ```typescript
 * const query = db.Lead.limit(10)
 * const first = await query   // Executes query
 * const second = await query  // Returns cached result (no re-execution)
 * ```
 *
 * @typeParam T - The entity type being queried, must extend ThingEntity
 *
 * @example Basic filtering and pagination
 * ```typescript
 * const results = await db.Lead
 *   .filter(lead => lead.status === 'active')
 *   .sort((a, b) => b.score - a.score)
 *   .limit(10)
 * ```
 *
 * @example Using operators for complex queries
 * ```typescript
 * const highValue = await db.Customer
 *   .whereOp('revenue', 'gte', 100000)
 *   .whereOp('status', 'in', ['active', 'pending'])
 *   .orderBy('revenue', 'desc')
 * ```
 */
export interface DBPromise<T extends ThingEntity = ThingEntity> extends Promise<T[]> {
  // ═══════════════════════════════════════════════════════════════════════════
  // FILTERING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Filter results by predicate function
   */
  filter(predicate: (item: T) => boolean): DBPromise<T>

  /**
   * Filter by field equality (convenience method)
   */
  where<K extends keyof T>(field: K, value: T[K]): DBPromise<T>

  /**
   * Filter by field matching operator
   */
  whereOp<K extends keyof T>(
    field: K,
    op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin' | 'contains' | 'startsWith' | 'endsWith',
    value: unknown
  ): DBPromise<T>

  // ═══════════════════════════════════════════════════════════════════════════
  // TRANSFORMATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Transform each result
   */
  map<U extends ThingEntity>(mapper: (item: T) => U): DBPromise<U>

  /**
   * Select specific fields
   * Note: Returns DBPromise<T> instead of DBPromise<Pick<T, K>> due to ThingEntity constraint
   */
  select<K extends keyof T>(...fields: K[]): DBPromise<T>

  /**
   * Expand relationships
   */
  expand(...relations: string[]): DBPromise<T>

  // ═══════════════════════════════════════════════════════════════════════════
  // ORDERING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Sort by comparator function
   */
  sort(compareFn: (a: T, b: T) => number): DBPromise<T>

  /**
   * Sort by field (convenience method)
   */
  orderBy<K extends keyof T>(field: K, direction?: 'asc' | 'desc'): DBPromise<T>

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGINATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Limit number of results
   */
  limit(n: number): DBPromise<T>

  /**
   * Skip first n results
   */
  offset(n: number): DBPromise<T>

  /**
   * Cursor-based pagination
   */
  after(cursor: string): DBPromise<T>

  /**
   * Get paginated results with cursor
   */
  paginate(options: { limit: number; cursor?: string }): DBPromise<T> & {
    nextCursor: Promise<string | null>
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AGGREGATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Count results
   */
  count(): Promise<number>

  /**
   * Get first result
   */
  first(): Promise<T | null>

  /**
   * Check if any results exist
   */
  exists(): Promise<boolean>

  // ═══════════════════════════════════════════════════════════════════════════
  // BATCH PROCESSING (with concurrency and crash recovery)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Process each item with concurrency control and crash recovery
   *
   * @example
   * ```typescript
   * await db.Lead
   *   .filter(lead => lead.status === 'new')
   *   .forEach(async lead => {
   *     await sendEmail(lead)
   *   }, {
   *     concurrency: 5,
   *     persist: true,
   *     onProgress: (p) => console.log(`${p.completed}/${p.total}`)
   *   })
   * ```
   */
  forEach(
    fn: (item: T, index: number) => Promise<void>,
    options?: ForEachOptions
  ): Promise<ForEachResult>
}

// ============================================================================
// FOREACH OPTIONS & RESULT
// ============================================================================

/**
 * Options for forEach batch processing
 */
export interface ForEachOptions {
  /**
   * Maximum concurrent operations (default: 1)
   */
  concurrency?: number

  /**
   * Maximum retries per item (default: 3)
   */
  maxRetries?: number

  /**
   * Base delay between retries in ms (default: 1000)
   */
  retryDelay?: number

  /**
   * Persist progress for crash recovery (default: false)
   */
  persist?: boolean

  /**
   * Resume from a previous run ID
   */
  resume?: string

  /**
   * Progress callback
   */
  onProgress?: (progress: ForEachProgress) => void

  /**
   * Error handler - return 'skip' to continue, 'retry' to retry, 'abort' to stop
   */
  onError?: (error: Error, item: ThingEntity, attempt: number) => 'skip' | 'retry' | 'abort'

  /**
   * Batch size for fetching items (default: 100)
   */
  batchSize?: number
}

/**
 * Progress information for forEach
 */
export interface ForEachProgress {
  /**
   * Total number of items
   */
  total: number

  /**
   * Successfully processed items
   */
  completed: number

  /**
   * Failed items (after all retries)
   */
  failed: number

  /**
   * Skipped items
   */
  skipped: number

  /**
   * Items currently in progress
   */
  inProgress: number

  /**
   * Current processing rate (items/second)
   */
  rate: number

  /**
   * Estimated time remaining in ms
   */
  eta: number

  /**
   * Run ID for resumption
   */
  runId: string
}

/**
 * Result of forEach operation
 */
export interface ForEachResult {
  /**
   * Successfully processed items
   */
  completed: number

  /**
   * Failed items
   */
  failed: number

  /**
   * Skipped items
   */
  skipped: number

  /**
   * Total time in ms
   */
  duration: number

  /**
   * Run ID for potential resumption
   */
  runId: string

  /**
   * Errors encountered (limited to first 100)
   */
  errors: Array<{ item: string; error: string; attempts: number }>
}

// ============================================================================
// ENTITY ACCESSOR
// ============================================================================

/**
 * EntityAccessor provides CRUD operations for a specific entity type.
 * Accessed via db.EntityName pattern.
 *
 * @example
 * ```typescript
 * // Get a single entity
 * const lead = await db.Lead.get('lead-123')
 *
 * // List entities with filtering
 * const leads = await db.Lead.list({ status: 'active' })
 *
 * // Natural language query
 * const deals = await db.Lead`who closed deals this month?`
 * ```
 */
export interface EntityAccessor<T extends ThingEntity = ThingEntity> {
  // ═══════════════════════════════════════════════════════════════════════════
  // CRUD OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get a single entity by ID
   */
  get(id: string): Promise<T | null>

  /**
   * List all entities (returns DBPromise for chaining)
   */
  list(options?: ListOptions): DBPromise<T>

  /**
   * Find entities matching criteria
   */
  find(query: Record<string, unknown>): DBPromise<T>

  /**
   * Search entities by text
   */
  search(text: string, options?: SearchOptions): DBPromise<T>

  /**
   * Create a new entity
   */
  create(data: Partial<T>): Promise<T>

  /**
   * Update an entity
   */
  update(id: string, data: Partial<T>): Promise<T>

  /**
   * Delete an entity
   */
  delete(id: string): Promise<T>

  // ═══════════════════════════════════════════════════════════════════════════
  // NATURAL LANGUAGE QUERY (Template Literal)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Query using natural language via template literal
   *
   * @example
   * ```typescript
   * const leads = await db.Lead`who closed deals this month?`
   * const top = await db.Lead`top 10 by revenue in ${region}`
   * ```
   */
  (strings: TemplateStringsArray, ...values: unknown[]): DBPromise<T>

  // ═══════════════════════════════════════════════════════════════════════════
  // ASYNC ITERATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Async iterator for all entities
   */
  [Symbol.asyncIterator](): AsyncIterator<T>
}

/**
 * Options for list operation
 */
export interface ListOptions {
  limit?: number
  offset?: number
  orderBy?: string
  order?: 'asc' | 'desc'
  branch?: string
  includeDeleted?: boolean
}

/**
 * Options for search operation
 */
export interface SearchOptions {
  limit?: number
  type?: 'text' | 'semantic' | 'hybrid'
  threshold?: number
}

// ============================================================================
// DB PROXY
// ============================================================================

/**
 * DBProxy is the main database accessor.
 * Access entity types as properties: db.Lead, db.Customer, db.Product
 *
 * @example
 * ```typescript
 * // In a DO class
 * class MyDO extends DO {
 *   get db(): DBProxy {
 *     return createDBProxy(this)
 *   }
 *
 *   async process() {
 *     const leads = await this.db.Lead.list()
 *     const deals = await this.db.Lead`who closed deals?`
 *   }
 * }
 * ```
 */
export interface DBProxy {
  /**
   * Access entities by type name
   */
  [entityName: string]: EntityAccessor
}

// ============================================================================
// NL QUERY CONTEXT
// ============================================================================

/**
 * Context for natural language query execution
 */
export interface NLQueryContext {
  /**
   * Entity type being queried
   */
  entityType: string

  /**
   * Raw query string
   */
  query: string

  /**
   * Interpolated values
   */
  values: unknown[]

  /**
   * Schema information for the entity
   */
  schema?: EntitySchema
}

/**
 * Schema information for an entity type
 */
export interface EntitySchema {
  /**
   * Entity type name
   */
  name: string

  /**
   * Field definitions
   */
  fields: Record<string, FieldSchema>

  /**
   * Relationship definitions
   */
  relationships?: Record<string, RelationshipSchema>
}

/**
 * Field schema
 */
export interface FieldSchema {
  type: 'string' | 'number' | 'boolean' | 'date' | 'json' | 'array'
  required?: boolean
  indexed?: boolean
  searchable?: boolean
}

/**
 * Relationship schema
 */
export interface RelationshipSchema {
  target: string
  type: 'one' | 'many'
  verb: string
}

// ============================================================================
// FOREACH PROGRESS TRACKER
// ============================================================================

/**
 * Progress tracker for forEach with persistence
 */
export interface ForEachTracker {
  /**
   * Unique run ID
   */
  runId: string

  /**
   * Entity type being processed
   */
  entityType: string

  /**
   * Query that generated the items
   */
  query: string

  /**
   * Total items to process
   */
  total: number

  /**
   * IDs of completed items
   */
  completedIds: Set<string>

  /**
   * IDs of failed items with error info
   */
  failedIds: Map<string, { error: string; attempts: number }>

  /**
   * IDs of skipped items
   */
  skippedIds: Set<string>

  /**
   * Start time
   */
  startedAt: Date

  /**
   * Last checkpoint time
   */
  lastCheckpoint: Date

  /**
   * Current cursor position
   */
  cursor: string | null
}
