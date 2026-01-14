/**
 * Type declarations for fsx.do/storage columnar storage module
 *
 * This file provides TypeScript type declarations for the fsx.do/storage
 * external package. It enables type-safe usage of the columnar storage
 * pattern within bashx.
 *
 * ## Type Hierarchy
 *
 * ```
 * fsx.do/storage
 * +-- Cache Types
 * |   +-- WriteBufferCache<V>       (class) - LRU cache with dirty tracking
 * |   +-- WriteBufferCacheOptions<V> (interface) - Cache configuration
 * |   +-- EvictionReason            (type) - Why an entry was evicted
 * |   +-- CacheStats                (interface) - Cache performance metrics
 * |
 * +-- Schema Types
 * |   +-- ColumnType                (type) - SQL column type union
 * |   +-- ColumnDefinition<T,K>     (interface) - Single column configuration
 * |   +-- SchemaDefinition<T>       (interface) - Full table schema
 * |
 * +-- Store Types
 * |   +-- ColumnarStore<T>          (class) - Generic columnar store
 * |   +-- ColumnarStoreOptions<T>   (interface) - Store configuration
 * |   +-- CheckpointTriggers        (interface) - When to checkpoint
 * |   +-- CheckpointStats           (interface) - Checkpoint result metrics
 * |
 * +-- Cost Analysis Types
 *     +-- CostComparison            (interface) - Normalized vs columnar costs
 *     +-- analyzeWorkloadCost       (function) - Calculate workload costs
 *     +-- printCostReport           (function) - Format cost comparison
 * ```
 *
 * ## Cost Optimization
 *
 * The columnar pattern achieves ~99%+ cost reduction by:
 * - Storing entities as single rows with JSON columns (vs normalized many-row approach)
 * - Buffering writes in an LRU cache
 * - Batch checkpointing dirty entries
 *
 * @module fsx.do/storage
 * @see https://github.com/dot-do/fsx for full documentation
 */

import type { SqlStorage } from '@cloudflare/workers-types'

declare module 'fsx.do/storage' {
  // ============================================================================
  // Cache Types
  // ============================================================================

  /**
   * Reason why a cache entry was evicted.
   *
   * @remarks
   * Used in the `onEvict` callback to understand why an entry was removed.
   *
   * - `count` - Maximum entry count exceeded
   * - `size` - Maximum byte size exceeded
   * - `expired` - TTL expired
   * - `deleted` - Explicitly deleted via `delete()`
   * - `cleared` - Cache was cleared via `clear()`
   * - `checkpoint` - Evicted during checkpoint operation
   */
  export type EvictionReason = 'count' | 'size' | 'expired' | 'deleted' | 'cleared' | 'checkpoint'

  /**
   * Configuration options for WriteBufferCache.
   *
   * @typeParam V - The type of values stored in the cache
   *
   * @example
   * ```typescript
   * const options: WriteBufferCacheOptions<SessionState> = {
   *   maxCount: 1000,
   *   maxBytes: 25 * 1024 * 1024,
   *   defaultTTL: 60000,
   *   onEvict: (key, value, reason) => {
   *     console.log(`Evicted ${key} due to ${reason}`)
   *   }
   * }
   * ```
   */
  export interface WriteBufferCacheOptions<V = unknown> {
    /**
     * Maximum number of entries in the cache.
     * When exceeded, LRU entries are evicted.
     * @default 500
     */
    maxCount?: number

    /**
     * Maximum total size in bytes.
     * When exceeded, LRU entries are evicted.
     * @default 25MB (25 * 1024 * 1024)
     */
    maxBytes?: number

    /**
     * Default time-to-live in milliseconds.
     * Entries expire after this duration. Set to 0 to disable expiry.
     * @default 0
     */
    defaultTTL?: number

    /**
     * Callback invoked when an entry is evicted.
     * Use this to persist dirty data before eviction.
     *
     * @param key - The evicted entry's key
     * @param value - The evicted entry's value
     * @param reason - Why the entry was evicted
     */
    onEvict?: (key: string, value: V, reason: EvictionReason) => void

    /**
     * Function to calculate the size of a value in bytes.
     * Used for `maxBytes` enforcement.
     *
     * @param value - The value to measure
     * @returns Size in bytes
     */
    sizeCalculator?: (value: V) => number
  }

  /**
   * Cache performance and status metrics.
   *
   * @example
   * ```typescript
   * const stats = cache.getStats()
   * console.log(`Hit rate: ${(stats.hitRate * 100).toFixed(1)}%`)
   * console.log(`Memory usage: ${(stats.memoryUsageRatio * 100).toFixed(1)}%`)
   * ```
   */
  export interface CacheStats {
    /** Number of entries currently in the cache */
    count: number

    /** Total size in bytes of cached entries */
    bytes: number

    /** Number of dirty (unsynced) entries */
    dirtyCount: number

    /** Number of cache hits */
    hits: number

    /** Number of cache misses */
    misses: number

    /**
     * Cache hit rate (0.0 to 1.0).
     * Calculated as hits / (hits + misses).
     */
    hitRate: number

    /** Total number of evictions */
    evictions: number

    /** Number of checkpoint operations performed */
    checkpoints: number

    /**
     * Memory usage ratio (0.0 to 1.0).
     * Calculated as bytes / maxBytes.
     */
    memoryUsageRatio: number
  }

  /**
   * LRU Cache with write buffering for batch checkpoints.
   *
   * This cache tracks dirty entries and flushes them in batches to minimize
   * row writes to SQLite. It implements an LRU eviction policy with optional
   * TTL-based expiration.
   *
   * @typeParam V - The type of values stored in the cache
   *
   * @example
   * ```typescript
   * const cache = new WriteBufferCache<SessionState>({
   *   maxCount: 1000,
   *   onEvict: async (key, value) => {
   *     // Persist dirty data before eviction
   *     await persistToStorage(key, value)
   *   }
   * })
   *
   * cache.set('session-1', sessionData)
   * cache.get('session-1') // Returns sessionData
   *
   * // Checkpoint dirty entries
   * const dirty = cache.getDirtyEntries()
   * await batchPersist(dirty)
   * cache.markClean([...dirty.keys()])
   * ```
   */
  export class WriteBufferCache<V> {
    constructor(options?: WriteBufferCacheOptions<V>)

    /**
     * Get a value from the cache.
     * Updates LRU order on access.
     *
     * @param key - The key to retrieve
     * @returns The cached value, or undefined if not found or expired
     */
    get(key: string): V | undefined

    /**
     * Set a value in the cache.
     * By default, marks the entry as dirty for checkpointing.
     *
     * @param key - The key to set
     * @param value - The value to store
     * @param options - Optional settings for this entry
     * @param options.ttl - Custom TTL for this entry (overrides defaultTTL)
     * @param options.markDirty - Whether to mark as dirty (default: true)
     */
    set(key: string, value: V, options?: { ttl?: number; markDirty?: boolean }): void

    /**
     * Delete a value from the cache.
     *
     * @param key - The key to delete
     * @returns true if the key existed, false otherwise
     */
    delete(key: string): boolean

    /**
     * Check if a key exists in the cache.
     * Does not update LRU order or trigger expiration check.
     *
     * @param key - The key to check
     * @returns true if the key exists and is not expired
     */
    has(key: string): boolean

    /**
     * Get all dirty entries for checkpointing.
     * Dirty entries are those modified since the last checkpoint.
     *
     * @returns Map of key-value pairs that need to be persisted
     */
    getDirtyEntries(): Map<string, V>

    /**
     * Mark entries as clean after successful checkpoint.
     * Call this after persisting dirty entries to storage.
     *
     * @param keys - Array of keys to mark as clean
     */
    markClean(keys: string[]): void

    /**
     * Number of dirty (unsynced) entries.
     * Use this to determine when to trigger a checkpoint.
     */
    readonly dirtyCount: number

    /**
     * Get cache statistics.
     * Use for monitoring cache performance.
     */
    getStats(): CacheStats

    /**
     * Clear all entries from the cache.
     * Triggers `onEvict` callback for each entry with reason 'cleared'.
     */
    clear(): void

    /**
     * Iterate over cache entries.
     * Entries are yielded in LRU order (most recent first).
     */
    entries(): IterableIterator<[string, V]>
  }

  // ============================================================================
  // Schema Types
  // ============================================================================

  /**
   * SQL column type for schema definition.
   *
   * Maps to SQLite types:
   * - `text` - TEXT (strings)
   * - `integer` - INTEGER (whole numbers)
   * - `real` - REAL (floating point)
   * - `blob` - BLOB (binary data)
   * - `json` - TEXT with JSON serialization
   * - `datetime` - TEXT in ISO 8601 format
   */
  export type ColumnType = 'text' | 'integer' | 'real' | 'blob' | 'json' | 'datetime'

  /**
   * Column definition for a single field in the schema.
   *
   * @typeParam T - The entity type being mapped
   * @typeParam K - The specific field being defined (keyof T)
   *
   * @example
   * ```typescript
   * const emailColumn: ColumnDefinition<User, 'email'> = {
   *   type: 'text',
   *   column: 'email_address', // Custom SQL column name
   *   required: true,
   * }
   *
   * const settingsColumn: ColumnDefinition<User, 'settings'> = {
   *   type: 'json',
   *   defaultValue: "'{}'",
   *   serialize: (value) => JSON.stringify(value),
   *   deserialize: (raw) => JSON.parse(raw as string),
   * }
   * ```
   */
  export interface ColumnDefinition<T = unknown, K extends keyof T = keyof T> {
    /**
     * SQL column name.
     * If not specified, defaults to the field name in snake_case.
     */
    column?: string

    /** SQL column type */
    type: ColumnType

    /**
     * Whether this column is NOT NULL.
     * Required columns must have a value or defaultValue.
     */
    required?: boolean

    /**
     * Default SQL value expression.
     * Must be a valid SQL literal (e.g., "'default'", "0", "'{}'").
     */
    defaultValue?: string

    /**
     * Custom serializer for storing the value.
     * Called before writing to the database.
     */
    serialize?: (value: T[K]) => unknown

    /**
     * Custom deserializer for reading the value.
     * Called after reading from the database.
     */
    deserialize?: (raw: unknown) => T[K]
  }

  /**
   * Complete schema definition for mapping a TypeScript type to SQL columns.
   *
   * Defines how an entity type T is stored in a SQL table, including:
   * - Table name and primary key
   * - Column mappings for each field
   * - Optional version and timestamp fields for optimistic locking
   *
   * @typeParam T - The entity type being mapped
   *
   * @example
   * ```typescript
   * interface User {
   *   id: string
   *   name: string
   *   settings: Record<string, unknown>
   *   createdAt: Date
   *   updatedAt: Date
   *   version: number
   * }
   *
   * const userSchema: SchemaDefinition<User> = {
   *   tableName: 'users',
   *   primaryKey: 'id',
   *   versionField: 'version',
   *   updatedAtField: 'updatedAt',
   *   createdAtField: 'createdAt',
   *   columns: {
   *     id: { type: 'text', required: true },
   *     name: { type: 'text', required: true },
   *     settings: { type: 'json', defaultValue: "'{}'" },
   *     createdAt: { type: 'datetime', column: 'created_at', required: true },
   *     updatedAt: { type: 'datetime', column: 'updated_at', required: true },
   *     version: { type: 'integer', defaultValue: '1', required: true },
   *   },
   * }
   * ```
   */
  export interface SchemaDefinition<T> {
    /** SQL table name */
    tableName: string

    /**
     * Primary key field name.
     * Must be a key of T that identifies each entity uniquely.
     */
    primaryKey: keyof T & string

    /**
     * Column definitions for each field.
     * Fields not defined here will not be persisted.
     */
    columns: {
      [K in keyof T]?: ColumnDefinition<T, K>
    }

    /**
     * Version field for optimistic locking.
     * Automatically incremented on each update.
     */
    versionField?: keyof T & string

    /**
     * Updated-at field for automatic timestamp.
     * Automatically set to current time on each update.
     */
    updatedAtField?: keyof T & string

    /**
     * Created-at field for automatic timestamp.
     * Automatically set to current time on create.
     */
    createdAtField?: keyof T & string

    /**
     * Checkpointed-at field for tracking checkpoint time.
     * Set to current time when entity is written to database.
     */
    checkpointedAtField?: keyof T & string
  }

  // ============================================================================
  // Store Types
  // ============================================================================

  /**
   * Configuration for when to trigger automatic checkpoints.
   *
   * Checkpoints persist dirty cache entries to the database.
   * Configure triggers based on your workload characteristics.
   *
   * @example
   * ```typescript
   * const triggers: CheckpointTriggers = {
   *   afterWrites: 100,        // Checkpoint after 100 dirty entries
   *   afterMs: 60000,          // Or after 60 seconds
   *   onShutdown: true,        // Always checkpoint on shutdown
   *   memoryPressureRatio: 0.8 // Checkpoint when 80% memory used
   * }
   * ```
   */
  export interface CheckpointTriggers {
    /**
     * Checkpoint after this many dirty entries.
     * @alias dirtyCount
     */
    afterWrites?: number

    /**
     * Checkpoint after this many milliseconds since last checkpoint.
     * @alias intervalMs
     */
    afterMs?: number

    /** Checkpoint when the store is stopped/shutdown */
    onShutdown?: boolean

    /**
     * Checkpoint after this many dirty entries.
     * @alias afterWrites
     */
    dirtyCount?: number

    /**
     * Checkpoint after this many milliseconds.
     * @alias afterMs
     */
    intervalMs?: number

    /**
     * Checkpoint when memory usage exceeds this ratio (0.0 to 1.0).
     * Calculated as cache.bytes / cache.maxBytes.
     */
    memoryPressureRatio?: number
  }

  /**
   * Configuration options for ColumnarStore.
   *
   * @typeParam T - The entity type being stored
   *
   * @example
   * ```typescript
   * const options: ColumnarStoreOptions<SessionState> = {
   *   cache: {
   *     maxCount: 1000,
   *     maxBytes: 50 * 1024 * 1024,
   *   },
   *   checkpointTriggers: {
   *     afterWrites: 100,
   *     afterMs: 30000,
   *     onShutdown: true,
   *   },
   *   onCheckpoint: (entities, stats) => {
   *     console.log(`Checkpointed ${stats.entityCount} entities in ${stats.durationMs}ms`)
   *   },
   * }
   * ```
   */
  export interface ColumnarStoreOptions<T> {
    /** WriteBufferCache configuration */
    cache?: WriteBufferCacheOptions<T>

    /** Checkpoint trigger configuration */
    checkpointTriggers?: CheckpointTriggers

    /**
     * Callback invoked after each checkpoint.
     *
     * @param entities - The entities that were checkpointed
     * @param stats - Checkpoint performance statistics
     */
    onCheckpoint?: (entities: T[], stats: CheckpointStats) => void
  }

  /**
   * Statistics from a checkpoint operation.
   *
   * @example
   * ```typescript
   * const stats = await store.checkpoint()
   * console.log(`Wrote ${stats.entityCount ?? stats.rowsCheckpointed} entities`)
   * console.log(`Total ${stats.totalBytes ?? stats.bytesWritten} bytes`)
   * console.log(`Duration: ${stats.durationMs}ms`)
   * ```
   */
  export interface CheckpointStats {
    /**
     * Number of entities written.
     * @alias rowsCheckpointed
     */
    entityCount?: number

    /**
     * Number of rows checkpointed.
     * @alias entityCount
     */
    rowsCheckpointed?: number

    /**
     * Total bytes written.
     * @alias bytesWritten
     */
    totalBytes?: number

    /**
     * Total bytes written.
     * @alias totalBytes
     */
    bytesWritten?: number

    /** Time taken in milliseconds */
    durationMs: number

    /**
     * What triggered this checkpoint.
     * - `count` - Dirty count threshold exceeded
     * - `interval` - Time interval elapsed
     * - `memory` - Memory pressure threshold exceeded
     * - `manual` - Explicitly called `checkpoint()`
     * - `eviction` - Triggered by cache eviction
     */
    trigger?: 'count' | 'interval' | 'memory' | 'manual' | 'eviction'
  }

  // ============================================================================
  // Cost Analysis Types
  // ============================================================================

  /**
   * Cost comparison between normalized and columnar storage approaches.
   *
   * This interface represents the cost savings achieved by using the columnar
   * pattern instead of traditional normalized database design.
   *
   * @example
   * ```typescript
   * const comparison = store.getCostComparison()
   *
   * console.log(`Columnar: ${comparison.columnar.rowWrites} rows`)
   * console.log(`Normalized: ${comparison.normalized.rowWrites} rows`)
   * console.log(`Savings: ${comparison.reductionPercent}%`)
   * ```
   */
  export interface CostComparison {
    /**
     * Statistics for normalized (traditional) approach.
     * This is the estimated cost if using one row per attribute.
     */
    normalized: {
      /** Estimated row writes */
      rowWrites?: number
      /** Estimated reads */
      reads?: number
      /** Estimated writes */
      writes?: number
      /** Estimated cost in dollars */
      estimatedCost?: number
      /** Total cost in dollars */
      totalCost?: number
    }

    /**
     * Statistics for columnar (optimized) approach.
     * This is the actual cost using one row per entity with JSON columns.
     */
    columnar: {
      /** Actual row writes */
      rowWrites?: number
      /** Actual reads */
      reads?: number
      /** Actual writes */
      writes?: number
      /** Actual cost in dollars */
      estimatedCost?: number
      /** Total cost in dollars */
      totalCost?: number
    }

    /**
     * Cost reduction as a percentage (0-100).
     * @example 99.5 means 99.5% cost reduction
     */
    reductionPercent?: number

    /**
     * Cost reduction as a factor.
     * @example 100 means 100x fewer writes
     */
    reductionFactor?: number

    /** Absolute savings in dollars */
    savings?: number

    /** Savings as a percentage (0-100) */
    savingsPercent?: number
  }

  /**
   * Generic Columnar Store with write buffering.
   *
   * This store uses a columnar schema (one row per entity with JSON columns)
   * combined with an LRU cache and batch checkpointing to minimize row writes.
   *
   * ## Key Features
   *
   * - **Columnar Storage**: One row per entity with JSON columns for nested data
   * - **Write Buffering**: Changes are buffered in memory and batch-written
   * - **Automatic Checkpointing**: Based on dirty count, time, or memory pressure
   * - **Optimistic Locking**: Optional version field for concurrent updates
   * - **Cost Tracking**: Built-in comparison with normalized approach
   *
   * @typeParam T - The entity type being stored. Must extend `object`.
   *
   * @example
   * ```typescript
   * // Define your entity type
   * interface Session {
   *   id: string
   *   data: Record<string, unknown>
   *   createdAt: Date
   *   updatedAt: Date
   *   version: number
   * }
   *
   * // Define the schema
   * const schema: SchemaDefinition<Session> = {
   *   tableName: 'sessions',
   *   primaryKey: 'id',
   *   versionField: 'version',
   *   columns: {
   *     id: { type: 'text', required: true },
   *     data: { type: 'json', defaultValue: "'{}'" },
   *     createdAt: { type: 'datetime', column: 'created_at' },
   *     updatedAt: { type: 'datetime', column: 'updated_at' },
   *     version: { type: 'integer', defaultValue: '1' },
   *   },
   * }
   *
   * // Create the store
   * const store = new ColumnarStore<Session>(sql, schema, {
   *   checkpointTriggers: { afterWrites: 100, afterMs: 60000 }
   * })
   *
   * // Use the store
   * await store.ensureSchema()
   * await store.create({ id: '1', data: {}, ... })
   * await store.update('1', { data: { key: 'value' } })
   * await store.checkpoint()
   * ```
   */
  export class ColumnarStore<T extends object> {
    /** The SqlStorage instance for database operations */
    protected sql: SqlStorage

    /** Schema definition for this store */
    protected schema: SchemaDefinition<T>

    /** Internal write buffer cache */
    protected cache: WriteBufferCache<T>

    /**
     * Create a new ColumnarStore.
     *
     * @param sql - Cloudflare Durable Object SqlStorage instance
     * @param schema - Schema definition for the entity type
     * @param options - Store configuration options
     */
    constructor(sql: SqlStorage, schema: SchemaDefinition<T>, options?: ColumnarStoreOptions<T>)

    /**
     * Get the SQL column name for a TypeScript field.
     * Returns the custom column name if specified, otherwise snake_case of field name.
     *
     * @param field - The field name from type T
     * @returns The SQL column name
     */
    getColumnName(field: keyof T): string

    /**
     * Get the TypeScript field name for a SQL column.
     *
     * @param column - The SQL column name
     * @returns The field name, or undefined if not found
     */
    getFieldName(column: string): keyof T | undefined

    /**
     * Initialize the database schema.
     * Creates the table if it doesn't exist.
     * Safe to call multiple times (idempotent).
     */
    ensureSchema(): Promise<void>

    /**
     * Get an entity by its primary key.
     * Returns from cache if available, otherwise loads from database.
     *
     * @param id - The primary key value
     * @returns The entity, or null if not found
     */
    get(id: string): Promise<T | null>

    /**
     * Create a new entity.
     * Adds to cache as dirty and returns the created entity.
     *
     * @param entity - The entity to create
     * @returns The created entity with timestamps set
     * @throws If an entity with the same ID already exists
     */
    create(entity: T): Promise<T>

    /**
     * Update an existing entity.
     * Merges updates into the cached entity and increments version.
     *
     * @param id - The primary key of the entity to update
     * @param updates - Partial entity with fields to update
     * @returns The updated entity, or null if not found
     */
    update(id: string, updates: Partial<T>): Promise<T | null>

    /**
     * Delete an entity.
     * Removes from cache and marks for deletion in database.
     *
     * @param id - The primary key of the entity to delete
     * @returns true if the entity was deleted, false if not found
     */
    delete(id: string): Promise<boolean>

    /**
     * Force a checkpoint.
     * Writes all dirty cache entries to the database.
     *
     * @param trigger - The reason for this checkpoint (for stats)
     * @returns Checkpoint statistics
     */
    checkpoint(trigger?: CheckpointStats['trigger']): Promise<CheckpointStats>

    /**
     * Get cost comparison statistics.
     * Compares actual columnar costs with estimated normalized costs.
     */
    getCostComparison(): CostComparison

    /**
     * Get cache statistics.
     */
    getCacheStats(): CacheStats

    /**
     * Stop the checkpoint timer.
     * Call this when shutting down to clean up resources.
     * Does NOT automatically checkpoint - call `checkpoint()` first if needed.
     */
    stop(): void
  }

  // ============================================================================
  // Cost Analysis Utilities
  // ============================================================================

  /**
   * Calculate cost comparison for a hypothetical workload.
   *
   * Use this to estimate savings before implementing columnar storage.
   *
   * @param workload - Workload characteristics
   * @returns Cost comparison between approaches
   *
   * @example
   * ```typescript
   * const comparison = analyzeWorkloadCost({
   *   entities: 1000,              // 1000 active sessions
   *   attributesPerEntity: 50,     // 50 env vars/history entries each
   *   updatesPerEntityPerHour: 60, // 1 update per minute per session
   *   checkpointsPerEntityPerHour: 6, // Checkpoint every 10 minutes
   *   hoursPerMonth: 720,          // 30 days
   * })
   *
   * console.log(`Estimated savings: ${comparison.reductionPercent}%`)
   * // Estimated savings: 90%
   * ```
   */
  export function analyzeWorkloadCost(workload: {
    /** Number of concurrent entities (e.g., active sessions) */
    entities: number

    /** Average attributes per entity (env vars, history entries, etc.) */
    attributesPerEntity: number

    /** Average updates per entity per hour */
    updatesPerEntityPerHour: number

    /** Checkpoints per entity per hour (columnar approach) */
    checkpointsPerEntityPerHour: number

    /** Hours of operation per month */
    hoursPerMonth: number
  }): CostComparison

  /**
   * Format a cost comparison as a human-readable report.
   *
   * @param comparison - The cost comparison to format
   * @returns Multi-line string with formatted report
   *
   * @example
   * ```typescript
   * const comparison = store.getCostComparison()
   * console.log(printCostReport(comparison))
   * // DO SQLite Cost Comparison
   * // ==========================
   * // Normalized Approach:
   * //   Row Writes: 1,000,000
   * //   Estimated Cost: $0.75
   * // Columnar Approach:
   * //   Row Writes: 10,000
   * //   Estimated Cost: $0.0075
   * // Cost Reduction: 99.0% (100x)
   * ```
   */
  export function printCostReport(comparison: CostComparison): string
}
