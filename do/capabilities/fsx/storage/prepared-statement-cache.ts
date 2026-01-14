/**
 * Prepared Statement LRU Cache for SQLite
 *
 * Provides a bounded LRU cache for SQLite prepared statements to prevent
 * unbounded memory growth when using dynamic SQL queries.
 *
 * Features:
 * - Configurable maximum cache size (default: 100 statements)
 * - LRU eviction when cache is full
 * - Cache hit/miss statistics
 * - Proper statement finalization on eviction
 * - Thread-safe for single-threaded JS environments
 *
 * @module storage/prepared-statement-cache
 */

/**
 * Interface for statements that can be finalized.
 *
 * SQLite prepared statements should implement this interface to ensure
 * proper resource cleanup when evicted from the cache.
 */
export interface FinalizableStatement {
  /**
   * Finalize the prepared statement, releasing associated resources.
   * This method is called automatically when the statement is evicted
   * from the cache or when the cache is cleared.
   */
  finalize?(): void
}

/**
 * Cache entry containing the statement and metadata
 * @internal
 */
interface CacheEntry<T> {
  statement: T
  lastAccessed: number
}

/**
 * Cache statistics for monitoring cache performance
 */
export interface PreparedStatementCacheStats {
  /** Total number of cache hits */
  hits: number
  /** Total number of cache misses */
  misses: number
  /** Current number of entries in cache */
  size: number
  /** Maximum entries allowed in cache */
  maxSize: number
  /** Cache hit ratio (hits / total requests) */
  hitRatio: number
  /** Number of evictions performed */
  evictions: number
  /** Total statements created (misses that resulted in new statements) */
  totalCreated: number
}

/**
 * Configuration options for the prepared statement cache
 */
export interface PreparedStatementCacheOptions {
  /**
   * Maximum number of prepared statements to store in cache.
   * When exceeded, least recently used statements are evicted and finalized.
   * @default 100
   */
  maxSize?: number
}

/**
 * Default cache configuration
 */
const DEFAULT_MAX_SIZE = 100

/**
 * LRU Cache implementation for SQLite prepared statements
 *
 * Uses a Map for O(1) access and maintains access order for LRU eviction.
 * The Map's insertion order is leveraged for LRU - we delete and re-insert
 * on access to maintain LRU order.
 *
 * When statements are evicted, their finalize() method is called (if present)
 * to properly release SQLite resources.
 *
 * @example
 * ```typescript
 * const cache = new PreparedStatementCache({ maxSize: 50 })
 *
 * // Get or create a prepared statement
 * const stmt = cache.getOrCreate(
 *   'SELECT * FROM users WHERE id = ?',
 *   () => db.prepare('SELECT * FROM users WHERE id = ?')
 * )
 *
 * // Execute the statement
 * stmt.get(userId)
 *
 * // Check cache stats
 * const stats = cache.getStats()
 * console.log(`Hit ratio: ${(stats.hitRatio * 100).toFixed(1)}%`)
 * ```
 */
export class PreparedStatementCache<T extends FinalizableStatement = FinalizableStatement> {
  private cache: Map<string, CacheEntry<T>> = new Map()
  private maxSize: number

  // Statistics
  private hits: number = 0
  private misses: number = 0
  private evictions: number = 0
  private totalCreated: number = 0

  /**
   * Create a new PreparedStatementCache instance.
   *
   * @param options - Configuration options
   * @param options.maxSize - Maximum number of statements to cache (default: 100)
   */
  constructor(options: PreparedStatementCacheOptions = {}) {
    const size = options.maxSize ?? DEFAULT_MAX_SIZE
    // Enforce minimum size of 1
    this.maxSize = Math.max(1, size)
  }

  /**
   * Get a statement from cache or create a new one.
   *
   * If the statement exists in cache, it is returned and marked as recently used.
   * If not, the factory function is called to create a new statement, which is
   * then cached and returned.
   *
   * @param sql - The SQL query string (used as cache key)
   * @param factory - Function to create a new statement if not in cache
   * @returns The cached or newly created statement
   *
   * @example
   * ```typescript
   * const stmt = cache.getOrCreate(
   *   'SELECT * FROM users WHERE id = ?',
   *   () => db.prepare('SELECT * FROM users WHERE id = ?')
   * )
   * ```
   */
  getOrCreate(sql: string, factory: () => T): T {
    const entry = this.cache.get(sql)

    if (entry) {
      // Cache hit - update access time and move to end (most recently used)
      this.hits++
      entry.lastAccessed = Date.now()
      this.cache.delete(sql)
      this.cache.set(sql, entry)
      return entry.statement
    }

    // Cache miss - create new statement
    this.misses++
    this.totalCreated++

    const statement = factory()
    const newEntry: CacheEntry<T> = {
      statement,
      lastAccessed: Date.now(),
    }

    // Evict if needed before adding
    this.evictIfNeeded()

    // Add to cache
    this.cache.set(sql, newEntry)

    return statement
  }

  /**
   * Get a statement from cache without creating a new one.
   *
   * Updates LRU order if statement is found.
   *
   * @param sql - The SQL query string
   * @returns The cached statement or undefined if not found
   */
  get(sql: string): T | undefined {
    const entry = this.cache.get(sql)

    if (!entry) {
      return undefined
    }

    // Update access time and move to end (most recently used)
    entry.lastAccessed = Date.now()
    this.cache.delete(sql)
    this.cache.set(sql, entry)

    return entry.statement
  }

  /**
   * Check if a statement is in the cache.
   *
   * This does NOT update LRU order (unlike get()).
   *
   * @param sql - The SQL query string
   * @returns true if the statement is cached
   */
  has(sql: string): boolean {
    return this.cache.has(sql)
  }

  /**
   * Delete a statement from the cache.
   *
   * The statement's finalize() method is called if present.
   *
   * @param sql - The SQL query string
   * @returns true if the statement was in cache and removed
   */
  delete(sql: string): boolean {
    const entry = this.cache.get(sql)
    if (!entry) {
      return false
    }

    // Finalize the statement
    this.finalizeStatement(entry.statement)

    // Remove from cache
    this.cache.delete(sql)
    return true
  }

  /**
   * Clear all statements from the cache.
   *
   * All statements' finalize() methods are called.
   */
  clear(): void {
    // Finalize all statements
    for (const entry of this.cache.values()) {
      this.finalizeStatement(entry.statement)
    }

    this.cache.clear()
  }

  /**
   * Get the current number of cached statements.
   */
  get size(): number {
    return this.cache.size
  }

  /**
   * Get current cache statistics.
   *
   * @returns Cache performance statistics
   */
  getStats(): PreparedStatementCacheStats {
    const total = this.hits + this.misses
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
      maxSize: this.maxSize,
      hitRatio: total > 0 ? this.hits / total : 0,
      evictions: this.evictions,
      totalCreated: this.totalCreated,
    }
  }

  /**
   * Reset statistics counters.
   *
   * Cache contents are preserved.
   */
  resetStats(): void {
    this.hits = 0
    this.misses = 0
    this.evictions = 0
    this.totalCreated = 0
  }

  /**
   * Evict the oldest entry if cache is at capacity.
   * @internal
   */
  private evictIfNeeded(): void {
    while (this.cache.size >= this.maxSize) {
      this.evictOldest()
    }
  }

  /**
   * Evict the oldest (least recently used) entry.
   * @internal
   */
  private evictOldest(): void {
    // Map iterates in insertion order, so first entry is oldest
    const firstKey = this.cache.keys().next().value
    if (firstKey !== undefined) {
      const entry = this.cache.get(firstKey)
      if (entry) {
        this.finalizeStatement(entry.statement)
      }
      this.cache.delete(firstKey)
      this.evictions++
    }
  }

  /**
   * Safely finalize a statement, catching any errors.
   * @internal
   */
  private finalizeStatement(statement: T): void {
    try {
      if (typeof statement.finalize === 'function') {
        statement.finalize()
      }
    } catch {
      // Swallow finalization errors to prevent affecting cache operations
    }
  }
}

/**
 * Create a new PreparedStatementCache with the given options.
 *
 * @param options - Configuration options
 * @returns A new PreparedStatementCache instance
 */
export function createPreparedStatementCache<T extends FinalizableStatement = FinalizableStatement>(
  options?: PreparedStatementCacheOptions
): PreparedStatementCache<T> {
  return new PreparedStatementCache<T>(options)
}
