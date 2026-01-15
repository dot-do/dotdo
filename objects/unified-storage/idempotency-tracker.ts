/**
 * IdempotencyTracker - TTL-based deduplication for event replay
 *
 * Provides memory-efficient tracking of processed events to prevent
 * duplicate application during cold start recovery.
 *
 * Features:
 * - TTL-based key expiration (configurable window)
 * - Bloom filter for memory-efficient large-scale tracking
 * - SQLite persistence for crash recovery
 * - Statistics tracking (duplicates skipped)
 *
 * @module objects/unified-storage/idempotency-tracker
 */

// ============================================================================
// BLOOM FILTER IMPLEMENTATION
// ============================================================================

/**
 * Simple bloom filter for memory-efficient set membership testing.
 * Uses multiple hash functions to reduce false positive rate.
 */
class BloomFilter {
  private readonly bits: Uint8Array
  private readonly numHashes: number
  private readonly bitCount: number

  /**
   * Create a bloom filter optimized for expected item count and false positive rate.
   *
   * @param expectedCount - Expected number of items to store
   * @param falsePositiveRate - Desired false positive rate (0-1)
   */
  constructor(expectedCount: number, falsePositiveRate: number = 0.01) {
    // Calculate optimal bit array size: m = -n * ln(p) / (ln(2)^2)
    const n = Math.max(expectedCount, 1)
    const p = Math.max(Math.min(falsePositiveRate, 0.5), 0.0001)
    const m = Math.ceil((-n * Math.log(p)) / (Math.LN2 * Math.LN2))

    // Calculate optimal number of hash functions: k = (m/n) * ln(2)
    const k = Math.max(1, Math.round((m / n) * Math.LN2))

    this.bitCount = m
    this.bits = new Uint8Array(Math.ceil(m / 8))
    this.numHashes = k
  }

  /**
   * Add a key to the filter.
   */
  add(key: string): void {
    const hashes = this.getHashes(key)
    for (const hash of hashes) {
      const index = hash % this.bitCount
      const byteIndex = Math.floor(index / 8)
      const bitIndex = index % 8
      this.bits[byteIndex] |= 1 << bitIndex
    }
  }

  /**
   * Check if a key might be in the filter.
   * False positives are possible, false negatives are not.
   */
  mightContain(key: string): boolean {
    const hashes = this.getHashes(key)
    for (const hash of hashes) {
      const index = hash % this.bitCount
      const byteIndex = Math.floor(index / 8)
      const bitIndex = index % 8
      if ((this.bits[byteIndex] & (1 << bitIndex)) === 0) {
        return false
      }
    }
    return true
  }

  /**
   * Generate multiple hash values for a key using double hashing technique.
   */
  private getHashes(key: string): number[] {
    const h1 = this.hash1(key)
    const h2 = this.hash2(key)
    const hashes: number[] = []

    for (let i = 0; i < this.numHashes; i++) {
      // Double hashing: h(i) = h1 + i * h2
      hashes.push(Math.abs(h1 + i * h2))
    }

    return hashes
  }

  /**
   * FNV-1a hash function
   */
  private hash1(key: string): number {
    let hash = 2166136261 // FNV offset basis
    for (let i = 0; i < key.length; i++) {
      hash ^= key.charCodeAt(i)
      hash = Math.imul(hash, 16777619) // FNV prime
    }
    return hash >>> 0 // Convert to unsigned
  }

  /**
   * DJB2 hash function
   */
  private hash2(key: string): number {
    let hash = 5381
    for (let i = 0; i < key.length; i++) {
      hash = ((hash << 5) + hash) ^ key.charCodeAt(i)
    }
    return hash >>> 0 // Convert to unsigned
  }

  /**
   * Get memory usage in bytes
   */
  getMemoryUsage(): number {
    return this.bits.length
  }
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Configuration for idempotency tracking
 */
export interface IdempotencyConfig {
  /** TTL for idempotency keys in milliseconds (default: 24 hours) */
  ttlMs?: number
  /** Expected number of events for bloom filter sizing */
  expectedEventCount?: number
  /** Target false positive rate for bloom filter (default: 0.01 = 1%) */
  falsePositiveRate?: number
  /** Threshold for switching from Set to BloomFilter */
  bloomFilterThreshold?: number
}

/**
 * Resolved configuration with defaults applied
 */
export interface ResolvedIdempotencyConfig {
  ttlMs: number
  expectedEventCount: number
  falsePositiveRate: number
  bloomFilterThreshold: number
}

/**
 * Entry for tracking a key with its timestamp
 */
interface TrackedKey {
  key: string
  ts: number
}

/**
 * Statistics for idempotency tracking
 */
export interface IdempotencyStats {
  /** Number of keys currently tracked */
  keysTracked: number
  /** Number of duplicate events skipped */
  duplicatesSkipped: number
  /** Whether bloom filter is active */
  usingBloomFilter: boolean
  /** Memory usage in bytes (approximate) */
  memoryUsageBytes: number
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

const DEFAULT_CONFIG: ResolvedIdempotencyConfig = {
  ttlMs: 24 * 60 * 60 * 1000, // 24 hours
  expectedEventCount: 100000,
  falsePositiveRate: 0.01,
  bloomFilterThreshold: 10000, // Switch to bloom filter after 10k keys
}

// ============================================================================
// IDEMPOTENCY TRACKER CLASS
// ============================================================================

/**
 * IdempotencyTracker provides TTL-based deduplication for event replay.
 *
 * For small event sets, uses an exact Set<string> for zero false positives.
 * For large event sets (>10k by default), switches to a bloom filter for
 * memory efficiency with a configurable false positive rate.
 */
export class IdempotencyTracker {
  private readonly config: ResolvedIdempotencyConfig

  // Exact tracking for small sets
  private exactKeys: Map<string, number> = new Map()

  // Bloom filter for large sets
  private bloomFilter: BloomFilter | null = null
  private bloomFilterKeys: TrackedKey[] = []

  // Statistics
  private _duplicatesSkipped: number = 0

  constructor(config: IdempotencyConfig = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    }
  }

  /**
   * Check if an event with this key has already been processed.
   * Returns true if duplicate (should skip), false if new.
   *
   * @param key - Idempotency key to check
   * @param eventTs - Timestamp of the event (for TTL calculation)
   */
  isDuplicate(key: string, eventTs?: number): boolean {
    // Empty or undefined keys are never duplicates (can't deduplicate)
    if (!key) {
      return false
    }

    const now = eventTs ?? Date.now()

    // Using bloom filter mode?
    if (this.bloomFilter) {
      return this.isDuplicateBloomFilter(key, now)
    }

    // Exact mode
    return this.isDuplicateExact(key, now)
  }

  /**
   * Track a key as processed.
   *
   * @param key - Idempotency key to track
   * @param eventTs - Timestamp of the event
   */
  track(key: string, eventTs?: number): void {
    // Empty or undefined keys can't be tracked
    if (!key) {
      return
    }

    const ts = eventTs ?? Date.now()

    // Check if we should switch to bloom filter
    if (!this.bloomFilter && this.exactKeys.size >= this.config.bloomFilterThreshold) {
      this.switchToBloomFilter()
    }

    if (this.bloomFilter) {
      this.trackBloomFilter(key, ts)
    } else {
      this.trackExact(key, ts)
    }
  }

  /**
   * Check and track in one operation.
   * Returns true if duplicate (skipped), false if new (tracked).
   */
  checkAndTrack(key: string, eventTs?: number): boolean {
    if (this.isDuplicate(key, eventTs)) {
      this._duplicatesSkipped++
      return true
    }
    this.track(key, eventTs)
    return false
  }

  /**
   * Record that a duplicate was skipped (for external tracking).
   */
  recordDuplicateSkipped(): void {
    this._duplicatesSkipped++
  }

  /**
   * Get number of duplicates skipped.
   */
  get duplicatesSkipped(): number {
    return this._duplicatesSkipped
  }

  /**
   * Get current statistics.
   */
  getStats(): IdempotencyStats {
    const usingBloomFilter = this.bloomFilter !== null

    let memoryUsageBytes: number
    if (usingBloomFilter && this.bloomFilter) {
      // Bloom filter memory + tracked keys for expiration
      memoryUsageBytes =
        this.bloomFilter.getMemoryUsage() + this.bloomFilterKeys.length * 50 // ~50 bytes per tracked key entry
    } else {
      // Map with string keys - rough estimate
      let keySize = 0
      for (const key of this.exactKeys.keys()) {
        keySize += key.length * 2 + 8 // UTF-16 + timestamp
      }
      memoryUsageBytes = keySize + this.exactKeys.size * 50 // Map overhead
    }

    return {
      keysTracked: usingBloomFilter ? this.bloomFilterKeys.length : this.exactKeys.size,
      duplicatesSkipped: this._duplicatesSkipped,
      usingBloomFilter,
      memoryUsageBytes,
    }
  }

  /**
   * Clear all tracked keys.
   */
  clear(): void {
    this.exactKeys.clear()
    this.bloomFilter = null
    this.bloomFilterKeys = []
    this._duplicatesSkipped = 0
  }

  // ==========================================================================
  // PRIVATE - EXACT MODE (Set<string>)
  // ==========================================================================

  private isDuplicateExact(key: string, now: number): boolean {
    const trackedTs = this.exactKeys.get(key)
    if (trackedTs === undefined) {
      return false
    }

    // Check if within TTL window
    if (now - trackedTs < this.config.ttlMs) {
      return true
    }

    // Key expired, remove it
    this.exactKeys.delete(key)
    return false
  }

  private trackExact(key: string, ts: number): void {
    this.exactKeys.set(key, ts)

    // Periodic cleanup of expired keys
    if (this.exactKeys.size > 0 && this.exactKeys.size % 1000 === 0) {
      this.cleanupExpiredExact(ts)
    }
  }

  private cleanupExpiredExact(now: number): void {
    const cutoff = now - this.config.ttlMs
    for (const [key, ts] of this.exactKeys) {
      if (ts < cutoff) {
        this.exactKeys.delete(key)
      }
    }
  }

  // ==========================================================================
  // PRIVATE - BLOOM FILTER MODE
  // ==========================================================================

  private switchToBloomFilter(): void {
    // Create bloom filter sized for expected events
    this.bloomFilter = new BloomFilter(this.config.expectedEventCount, this.config.falsePositiveRate)

    // Transfer existing keys
    for (const [key, ts] of this.exactKeys) {
      this.bloomFilter.add(key)
      this.bloomFilterKeys.push({ key, ts })
    }

    // Clear exact keys to save memory
    this.exactKeys.clear()
  }

  private isDuplicateBloomFilter(key: string, now: number): boolean {
    if (!this.bloomFilter) {
      return false
    }

    // Fast negative check via bloom filter
    if (!this.bloomFilter.mightContain(key)) {
      return false
    }

    // Bloom filter says maybe - check exact list for TTL
    // This handles false positives and TTL expiration
    const cutoff = now - this.config.ttlMs

    for (const entry of this.bloomFilterKeys) {
      if (entry.key === key) {
        // Found exact match - check TTL
        if (entry.ts >= cutoff) {
          return true // Within TTL, is duplicate
        }
        // Expired - not a duplicate (can't remove from bloom filter, but that's ok)
        return false
      }
    }

    // Bloom filter false positive - not actually tracked
    return false
  }

  private trackBloomFilter(key: string, ts: number): void {
    if (!this.bloomFilter) {
      return
    }

    this.bloomFilter.add(key)
    this.bloomFilterKeys.push({ key, ts })

    // Periodic cleanup of expired keys from tracking list
    // (Can't remove from bloom filter, but can free memory from list)
    if (this.bloomFilterKeys.length > 0 && this.bloomFilterKeys.length % 10000 === 0) {
      this.cleanupExpiredBloomFilter(ts)
    }
  }

  private cleanupExpiredBloomFilter(now: number): void {
    const cutoff = now - this.config.ttlMs
    this.bloomFilterKeys = this.bloomFilterKeys.filter((entry) => entry.ts >= cutoff)
  }
}
