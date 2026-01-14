/**
 * Existence Cache for Content-Addressable Storage
 *
 * Provides a fast in-memory cache for object existence checks.
 * Uses a combination of:
 * - Bloom filter for fast negative lookups (O(1) "definitely not exists")
 * - TTL-based cache for positive results
 * - Cache invalidation hooks for put/delete operations
 *
 * Performance characteristics:
 * - Bloom filter: ~1% false positive rate with 10 hash functions
 * - TTL cache: O(1) lookup for positive results
 * - Memory efficient: ~1.2 bytes per item for bloom filter
 */

/**
 * Configuration options for ExistenceCache
 */
export interface ExistenceCacheOptions {
  /**
   * Time-to-live for positive cache entries in milliseconds.
   * After this time, entries are considered stale and will be re-checked.
   * @default 60000 (1 minute)
   */
  ttl?: number

  /**
   * Maximum number of entries to store in the positive cache.
   * When exceeded, oldest entries are evicted.
   * @default 10000
   */
  maxEntries?: number

  /**
   * Expected number of items for bloom filter sizing.
   * Higher values use more memory but reduce false positive rate.
   * @default 100000
   */
  expectedItems?: number

  /**
   * Target false positive rate for bloom filter.
   * Lower values use more memory but are more accurate.
   * @default 0.01 (1%)
   */
  falsePositiveRate?: number
}

/**
 * Cache statistics for monitoring
 */
export interface ExistenceCacheStats {
  /** Total cache hits (true positives from cache) */
  hits: number
  /** Total cache misses (required storage check) */
  misses: number
  /** Bloom filter rejections (fast negative lookup) */
  bloomRejections: number
  /** Current entries in positive cache */
  cacheSize: number
  /** Cache hit ratio */
  hitRatio: number
  /** Bloom filter false positive rate (estimated) */
  bloomFalsePositiveRate: number
  /** Number of entries in bloom filter */
  bloomEntries: number
}

/**
 * Simple Bloom Filter implementation
 *
 * Uses MurmurHash3-inspired hash functions for good distribution.
 * Optimized for object hash lookups where we're checking 40/64 char hex strings.
 */
export class BloomFilter {
  private bits: Uint32Array
  private numHashFunctions: number
  private numBits: number
  private itemCount: number = 0

  constructor(expectedItems: number, falsePositiveRate: number = 0.01) {
    // Calculate optimal size based on expected items and target false positive rate
    // m = -n * ln(p) / (ln(2)^2)
    const ln2Squared = Math.LN2 * Math.LN2
    this.numBits = Math.ceil((-expectedItems * Math.log(falsePositiveRate)) / ln2Squared)

    // Round up to nearest 32 bits for Uint32Array storage
    const numWords = Math.ceil(this.numBits / 32)
    this.bits = new Uint32Array(numWords)
    this.numBits = numWords * 32 // Actual number of bits

    // Calculate optimal number of hash functions
    // k = (m/n) * ln(2)
    this.numHashFunctions = Math.max(1, Math.round((this.numBits / expectedItems) * Math.LN2))
  }

  /**
   * Add a hash to the bloom filter
   */
  add(hash: string): void {
    const normalizedHash = hash.toLowerCase()
    const positions = this.getHashPositions(normalizedHash)

    for (const pos of positions) {
      const wordIndex = Math.floor(pos / 32)
      const bitIndex = pos % 32
      const currentValue = this.bits[wordIndex]
      if (currentValue !== undefined) {
        this.bits[wordIndex] = currentValue | (1 << bitIndex)
      }
    }

    this.itemCount++
  }

  /**
   * Check if a hash might exist in the bloom filter
   *
   * @returns false means "definitely not in set", true means "possibly in set"
   */
  mightContain(hash: string): boolean {
    const normalizedHash = hash.toLowerCase()
    const positions = this.getHashPositions(normalizedHash)

    for (const pos of positions) {
      const wordIndex = Math.floor(pos / 32)
      const bitIndex = pos % 32
      const currentValue = this.bits[wordIndex]
      if (currentValue === undefined || (currentValue & (1 << bitIndex)) === 0) {
        return false
      }
    }

    return true
  }

  /**
   * Clear all entries from the bloom filter
   */
  clear(): void {
    this.bits.fill(0)
    this.itemCount = 0
  }

  /**
   * Get estimated false positive rate based on current item count
   */
  getEstimatedFalsePositiveRate(): number {
    if (this.itemCount === 0) return 0
    // p = (1 - e^(-k*n/m))^k
    const exp = Math.exp((-this.numHashFunctions * this.itemCount) / this.numBits)
    return Math.pow(1 - exp, this.numHashFunctions)
  }

  /**
   * Get current item count
   */
  getItemCount(): number {
    return this.itemCount
  }

  /**
   * Get memory usage in bytes
   */
  getMemoryUsage(): number {
    return this.bits.byteLength
  }

  /**
   * Calculate hash positions for the bloom filter
   *
   * Uses double hashing technique: h(i) = h1 + i * h2
   * where h1 and h2 are derived from the input hash
   */
  private getHashPositions(hash: string): number[] {
    // For object hashes (40 or 64 hex chars), we can use the hash itself
    // as input to our hash functions since it's already well-distributed

    // Use first 8 chars for h1, next 8 for h2
    const h1 = parseInt(hash.substring(0, 8), 16) >>> 0
    const h2 = parseInt(hash.substring(8, 16), 16) >>> 0

    const positions: number[] = []
    for (let i = 0; i < this.numHashFunctions; i++) {
      // Double hashing: position = (h1 + i * h2) % numBits
      const pos = (h1 + i * h2) % this.numBits
      positions.push(pos)
    }

    return positions
  }
}

/**
 * Cache entry with TTL
 */
interface CacheEntry {
  exists: boolean
  expiresAt: number
}

/**
 * Existence Cache for fast object existence checks
 *
 * Combines a bloom filter for fast "definitely not exists" responses
 * with a TTL-based positive cache for "definitely exists" responses.
 */
export class ExistenceCache {
  private positiveCache: Map<string, CacheEntry> = new Map()
  private bloomFilter: BloomFilter
  private options: Required<ExistenceCacheOptions>

  // Statistics
  private hits: number = 0
  private misses: number = 0
  private bloomRejections: number = 0

  constructor(options: ExistenceCacheOptions = {}) {
    this.options = {
      ttl: options.ttl ?? 60000, // 1 minute default
      maxEntries: options.maxEntries ?? 10000,
      expectedItems: options.expectedItems ?? 100000,
      falsePositiveRate: options.falsePositiveRate ?? 0.01,
    }

    this.bloomFilter = new BloomFilter(this.options.expectedItems, this.options.falsePositiveRate)
  }

  /**
   * Check the cache for an object's existence
   *
   * @returns `true` if definitely exists, `false` if definitely doesn't exist,
   *          `undefined` if cache can't determine (need to check storage)
   */
  check(hash: string): boolean | undefined {
    const normalizedHash = hash.toLowerCase()

    // First check bloom filter for fast negative lookup
    if (!this.bloomFilter.mightContain(normalizedHash)) {
      this.bloomRejections++
      return false
    }

    // Check positive cache
    const entry = this.positiveCache.get(normalizedHash)
    if (entry) {
      // Check if entry is still valid
      if (Date.now() < entry.expiresAt) {
        this.hits++
        return entry.exists
      }
      // Entry expired, remove it
      this.positiveCache.delete(normalizedHash)
    }

    // Cache miss - need to check storage
    this.misses++
    return undefined
  }

  /**
   * Record an existence check result
   *
   * Called after checking storage to update the cache.
   */
  record(hash: string, exists: boolean): void {
    const normalizedHash = hash.toLowerCase()

    // Add to bloom filter if exists
    if (exists) {
      this.bloomFilter.add(normalizedHash)
    }

    // Add to positive cache
    this.evictIfNeeded()
    this.positiveCache.set(normalizedHash, {
      exists,
      expiresAt: Date.now() + this.options.ttl,
    })
  }

  /**
   * Invalidate cache entry (called on put/delete)
   */
  invalidate(hash: string): void {
    const normalizedHash = hash.toLowerCase()
    this.positiveCache.delete(normalizedHash)
    // Note: We can't remove from bloom filter (would require rebuilding)
    // This is okay - bloom filter gives false positives, not false negatives
  }

  /**
   * Record that an object was added (for bloom filter and cache)
   */
  recordPut(hash: string): void {
    const normalizedHash = hash.toLowerCase()

    // Add to bloom filter
    this.bloomFilter.add(normalizedHash)

    // Update positive cache
    this.evictIfNeeded()
    this.positiveCache.set(normalizedHash, {
      exists: true,
      expiresAt: Date.now() + this.options.ttl,
    })
  }

  /**
   * Record that an object was deleted
   */
  recordDelete(hash: string): void {
    const normalizedHash = hash.toLowerCase()

    // Remove from positive cache
    this.positiveCache.delete(normalizedHash)

    // Note: Can't remove from bloom filter, but that's okay
    // Bloom filter false positives are handled by storage check
  }

  /**
   * Clear all cached entries
   *
   * Optionally clears the bloom filter as well (expensive operation).
   */
  clear(clearBloomFilter: boolean = false): void {
    this.positiveCache.clear()
    if (clearBloomFilter) {
      this.bloomFilter.clear()
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): ExistenceCacheStats {
    const total = this.hits + this.misses + this.bloomRejections
    return {
      hits: this.hits,
      misses: this.misses,
      bloomRejections: this.bloomRejections,
      cacheSize: this.positiveCache.size,
      hitRatio: total > 0 ? this.hits / total : 0,
      bloomFalsePositiveRate: this.bloomFilter.getEstimatedFalsePositiveRate(),
      bloomEntries: this.bloomFilter.getItemCount(),
    }
  }

  /**
   * Reset statistics counters
   */
  resetStats(): void {
    this.hits = 0
    this.misses = 0
    this.bloomRejections = 0
  }

  /**
   * Evict expired and excess entries
   */
  private evictIfNeeded(): void {
    if (this.positiveCache.size < this.options.maxEntries) {
      return
    }

    const now = Date.now()
    const toDelete: string[] = []

    // First, remove expired entries
    for (const [hash, entry] of this.positiveCache) {
      if (entry.expiresAt <= now) {
        toDelete.push(hash)
      }
    }

    for (const hash of toDelete) {
      this.positiveCache.delete(hash)
    }

    // If still over limit, remove oldest entries (LRU)
    if (this.positiveCache.size >= this.options.maxEntries) {
      // Map preserves insertion order, so first entries are oldest
      const keysToRemove = this.options.maxEntries / 4 // Remove 25%
      let removed = 0
      for (const hash of this.positiveCache.keys()) {
        if (removed >= keysToRemove) break
        this.positiveCache.delete(hash)
        removed++
      }
    }
  }
}

/**
 * Create a new existence cache
 */
export function createExistenceCache(options?: ExistenceCacheOptions): ExistenceCache {
  return new ExistenceCache(options)
}
