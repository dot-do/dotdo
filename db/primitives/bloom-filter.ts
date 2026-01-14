/**
 * Bloom Filter - Space-efficient probabilistic data structure
 *
 * Provides O(1) space and time complexity for duplicate detection with configurable
 * false positive rate. Used for streaming deduplication where memory efficiency
 * is critical.
 *
 * Features:
 * - Configurable false positive rate (FPR)
 * - Bounded memory usage
 * - Window-based expiration for time-bounded dedup
 * - Serialization for checkpointing
 *
 * @module db/primitives/bloom-filter
 */

import { murmurHash3 } from './utils/murmur3'

// ============================================================================
// Types
// ============================================================================

/**
 * Bloom filter configuration options
 */
export interface BloomFilterOptions {
  /** Expected number of items to be inserted */
  expectedItems: number
  /** Target false positive rate (0-1, default 0.01 = 1%) */
  falsePositiveRate?: number
  /** Optional seed for hash functions */
  seed?: number
}

/**
 * Bloom filter serialized state for checkpointing
 */
export interface BloomFilterState {
  bitArray: string // Base64 encoded
  numBits: number
  numHashFunctions: number
  itemCount: number
  seed: number
}

/**
 * Bloom filter statistics
 */
export interface BloomFilterStats {
  /** Number of bits in the filter */
  numBits: number
  /** Number of hash functions used */
  numHashFunctions: number
  /** Number of items added */
  itemCount: number
  /** Estimated fill ratio (0-1) */
  fillRatio: number
  /** Estimated false positive rate based on current fill */
  estimatedFPR: number
  /** Memory usage in bytes */
  memoryBytes: number
}

// ============================================================================
// Bloom Filter Implementation
// ============================================================================

/**
 * Space-efficient probabilistic set membership structure.
 *
 * A Bloom filter uses k hash functions to map elements to k positions in a bit array.
 * - `add(key)` sets k bits to 1
 * - `mightContain(key)` returns true if all k bits are 1
 *
 * False positives are possible (returns true when item was never added),
 * but false negatives are impossible (never returns false for added items).
 */
export class BloomFilter {
  private bitArray: Uint8Array
  private numBits: number
  private numHashFunctions: number
  private itemCount: number
  private seed: number

  constructor(options: BloomFilterOptions) {
    const { expectedItems, falsePositiveRate = 0.01, seed = 0 } = options

    // Calculate optimal parameters using standard formulas:
    // m = -n * ln(p) / (ln(2)^2) where n = expected items, p = FPR
    // k = (m/n) * ln(2) where k = number of hash functions
    this.numBits = this.calculateOptimalBits(expectedItems, falsePositiveRate)
    this.numHashFunctions = this.calculateOptimalHashFunctions(this.numBits, expectedItems)
    this.seed = seed
    this.itemCount = 0

    // Allocate bit array (1 bit per position, stored in bytes)
    const numBytes = Math.ceil(this.numBits / 8)
    this.bitArray = new Uint8Array(numBytes)
  }

  /**
   * Calculate optimal number of bits for target FPR
   */
  private calculateOptimalBits(n: number, p: number): number {
    // m = -n * ln(p) / (ln(2)^2)
    const m = Math.ceil(-n * Math.log(p) / (Math.LN2 * Math.LN2))
    // Ensure minimum size of 64 bits
    return Math.max(m, 64)
  }

  /**
   * Calculate optimal number of hash functions
   */
  private calculateOptimalHashFunctions(m: number, n: number): number {
    // k = (m/n) * ln(2)
    const k = Math.round((m / n) * Math.LN2)
    // Ensure at least 1 and at most 16 hash functions
    return Math.max(1, Math.min(k, 16))
  }

  /**
   * Generate k hash values for a key using double hashing technique.
   * Uses two base hash values to generate k hash positions:
   * h(i) = (h1 + i * h2) mod m
   */
  private getHashPositions(key: string): number[] {
    // Generate two independent hash values
    const hash1 = murmurHash3(key, this.seed)
    const hash2 = murmurHash3(key, this.seed + 0x9e3779b9) // Golden ratio prime

    const positions: number[] = []
    for (let i = 0; i < this.numHashFunctions; i++) {
      // Double hashing: h(i) = (h1 + i * h2) mod m
      const position = Math.abs((hash1 + i * hash2) % this.numBits)
      positions.push(position)
    }
    return positions
  }

  /**
   * Set a bit at the given position
   */
  private setBit(position: number): void {
    const byteIndex = Math.floor(position / 8)
    const bitIndex = position % 8
    this.bitArray[byteIndex] |= (1 << bitIndex)
  }

  /**
   * Check if a bit is set at the given position
   */
  private getBit(position: number): boolean {
    const byteIndex = Math.floor(position / 8)
    const bitIndex = position % 8
    return (this.bitArray[byteIndex] & (1 << bitIndex)) !== 0
  }

  /**
   * Add an item to the filter.
   *
   * @param key - The key to add
   * @returns true if this is likely a new item, false if it might be a duplicate
   */
  add(key: string): boolean {
    const positions = this.getHashPositions(key)

    // Check if all bits are already set (likely duplicate)
    let allSet = true
    for (const pos of positions) {
      if (!this.getBit(pos)) {
        allSet = false
        break
      }
    }

    // Set all bits
    for (const pos of positions) {
      this.setBit(pos)
    }

    this.itemCount++
    return !allSet
  }

  /**
   * Check if an item might be in the filter.
   *
   * @param key - The key to check
   * @returns true if the item might be present (could be false positive),
   *          false if the item is definitely not present
   */
  mightContain(key: string): boolean {
    const positions = this.getHashPositions(key)
    for (const pos of positions) {
      if (!this.getBit(pos)) {
        return false
      }
    }
    return true
  }

  /**
   * Clear the filter, removing all items.
   */
  clear(): void {
    this.bitArray.fill(0)
    this.itemCount = 0
  }

  /**
   * Get statistics about the filter
   */
  getStats(): BloomFilterStats {
    // Count set bits
    let setBits = 0
    for (let i = 0; i < this.bitArray.length; i++) {
      setBits += this.popCount(this.bitArray[i])
    }

    const fillRatio = setBits / this.numBits

    // Estimate FPR: p ~ (1 - e^(-kn/m))^k
    // Using current fill ratio as approximation
    const estimatedFPR = Math.pow(fillRatio, this.numHashFunctions)

    return {
      numBits: this.numBits,
      numHashFunctions: this.numHashFunctions,
      itemCount: this.itemCount,
      fillRatio,
      estimatedFPR,
      memoryBytes: this.bitArray.byteLength,
    }
  }

  /**
   * Population count (number of set bits in a byte)
   */
  private popCount(byte: number): number {
    let count = 0
    while (byte) {
      count += byte & 1
      byte >>= 1
    }
    return count
  }

  /**
   * Serialize the filter state for checkpointing
   */
  serialize(): BloomFilterState {
    // Convert Uint8Array to base64 for JSON serialization
    const binary = String.fromCharCode(...this.bitArray)
    const base64 = btoa(binary)

    return {
      bitArray: base64,
      numBits: this.numBits,
      numHashFunctions: this.numHashFunctions,
      itemCount: this.itemCount,
      seed: this.seed,
    }
  }

  /**
   * Restore filter state from checkpoint
   */
  static deserialize(state: BloomFilterState): BloomFilter {
    // Create a minimal instance
    const filter = Object.create(BloomFilter.prototype) as BloomFilter

    // Decode base64 to Uint8Array
    const binary = atob(state.bitArray)
    filter.bitArray = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      filter.bitArray[i] = binary.charCodeAt(i)
    }

    filter.numBits = state.numBits
    filter.numHashFunctions = state.numHashFunctions
    filter.itemCount = state.itemCount
    filter.seed = state.seed

    return filter
  }

  /**
   * Merge another bloom filter into this one (union operation).
   * Both filters must have the same configuration.
   */
  merge(other: BloomFilter): void {
    if (this.numBits !== other.numBits || this.numHashFunctions !== other.numHashFunctions) {
      throw new Error('Cannot merge Bloom filters with different configurations')
    }

    for (let i = 0; i < this.bitArray.length; i++) {
      this.bitArray[i] |= other.bitArray[i]
    }

    // Item count is approximate after merge
    this.itemCount += other.itemCount
  }

  /**
   * Get the memory usage in bytes
   */
  get memoryUsage(): number {
    return this.bitArray.byteLength
  }
}

// ============================================================================
// Scalable Bloom Filter (for unknown item count)
// ============================================================================

/**
 * Options for scalable bloom filter
 */
export interface ScalableBloomFilterOptions {
  /** Initial expected items (default: 10000) */
  initialExpectedItems?: number
  /** Target false positive rate (default: 0.01) */
  falsePositiveRate?: number
  /** Growth factor when scaling (default: 2) */
  growthFactor?: number
  /** FPR tightening factor for each new filter (default: 0.9) */
  tighteningRatio?: number
  /** Maximum memory limit in bytes (optional) */
  maxMemoryBytes?: number
}

/**
 * Scalable Bloom Filter that grows as items are added.
 *
 * Maintains a series of bloom filters with progressively tighter FPR requirements.
 * When the current filter reaches capacity, a new one is added.
 */
export class ScalableBloomFilter {
  private filters: BloomFilter[] = []
  private options: Required<Omit<ScalableBloomFilterOptions, 'maxMemoryBytes'>> & { maxMemoryBytes?: number }
  private currentExpectedItems: number
  private currentFPR: number
  private totalItems: number = 0

  constructor(options: ScalableBloomFilterOptions = {}) {
    this.options = {
      initialExpectedItems: options.initialExpectedItems ?? 10000,
      falsePositiveRate: options.falsePositiveRate ?? 0.01,
      growthFactor: options.growthFactor ?? 2,
      tighteningRatio: options.tighteningRatio ?? 0.9,
      maxMemoryBytes: options.maxMemoryBytes,
    }

    this.currentExpectedItems = this.options.initialExpectedItems
    this.currentFPR = this.options.falsePositiveRate

    // Create initial filter
    this.addNewFilter()
  }

  private addNewFilter(): void {
    // Check memory limit before adding new filter
    if (this.options.maxMemoryBytes) {
      const currentMemory = this.memoryUsage
      const estimatedNewFilterSize = Math.ceil(
        -this.currentExpectedItems * Math.log(this.currentFPR) / (Math.LN2 * Math.LN2) / 8
      )
      if (currentMemory + estimatedNewFilterSize > this.options.maxMemoryBytes) {
        // Memory limit reached, don't add new filter
        return
      }
    }

    const filter = new BloomFilter({
      expectedItems: this.currentExpectedItems,
      falsePositiveRate: this.currentFPR,
      seed: this.filters.length, // Different seed for each filter
    })
    this.filters.push(filter)
  }

  /**
   * Add an item to the filter.
   *
   * @returns true if this is likely a new item, false if it might be a duplicate
   */
  add(key: string): boolean {
    // First check if it's already present
    if (this.mightContain(key)) {
      return false
    }

    // Add to the last filter
    const lastFilter = this.filters[this.filters.length - 1]
    lastFilter.add(key)
    this.totalItems++

    // Check if we need to scale
    const stats = lastFilter.getStats()
    if (stats.itemCount >= this.currentExpectedItems * 0.9) {
      // Scale up
      this.currentExpectedItems = Math.floor(this.currentExpectedItems * this.options.growthFactor)
      this.currentFPR *= this.options.tighteningRatio
      this.addNewFilter()
    }

    return true
  }

  /**
   * Check if an item might be in the filter.
   */
  mightContain(key: string): boolean {
    // Check all filters (any positive is a potential match)
    for (const filter of this.filters) {
      if (filter.mightContain(key)) {
        return true
      }
    }
    return false
  }

  /**
   * Clear all filters
   */
  clear(): void {
    this.filters = []
    this.currentExpectedItems = this.options.initialExpectedItems
    this.currentFPR = this.options.falsePositiveRate
    this.totalItems = 0
    this.addNewFilter()
  }

  /**
   * Get memory usage in bytes
   */
  get memoryUsage(): number {
    return this.filters.reduce((sum, f) => sum + f.memoryUsage, 0)
  }

  /**
   * Get number of items added
   */
  get itemCount(): number {
    return this.totalItems
  }

  /**
   * Serialize for checkpointing
   */
  serialize(): { filters: BloomFilterState[]; options: typeof this.options; totalItems: number } {
    return {
      filters: this.filters.map(f => f.serialize()),
      options: this.options,
      totalItems: this.totalItems,
    }
  }

  /**
   * Restore from checkpoint
   */
  static deserialize(state: ReturnType<ScalableBloomFilter['serialize']>): ScalableBloomFilter {
    const filter = Object.create(ScalableBloomFilter.prototype) as ScalableBloomFilter
    filter.filters = state.filters.map(s => BloomFilter.deserialize(s))
    filter.options = state.options
    filter.totalItems = state.totalItems
    filter.currentExpectedItems = state.options.initialExpectedItems * Math.pow(state.options.growthFactor, state.filters.length - 1)
    filter.currentFPR = state.options.falsePositiveRate * Math.pow(state.options.tighteningRatio, state.filters.length - 1)
    return filter
  }
}

// ============================================================================
// Time-Windowed Bloom Filter (for window-based dedup with eviction)
// ============================================================================

/**
 * Options for time-windowed bloom filter
 */
export interface TimeWindowedBloomFilterOptions {
  /** Window duration in milliseconds */
  windowDurationMs: number
  /** Expected items per window */
  expectedItemsPerWindow: number
  /** Target false positive rate */
  falsePositiveRate?: number
  /** Number of overlapping windows (default: 2 for sliding) */
  numWindows?: number
}

/**
 * Time-windowed Bloom Filter for streaming deduplication with bounded memory.
 *
 * Maintains multiple overlapping bloom filters that rotate based on time.
 * Old windows are automatically evicted to bound memory usage.
 */
export class TimeWindowedBloomFilter {
  private windows: Array<{ filter: BloomFilter; startTime: number; endTime: number }>
  private options: Required<TimeWindowedBloomFilterOptions>
  private currentWindowIndex: number = 0

  constructor(options: TimeWindowedBloomFilterOptions) {
    this.options = {
      windowDurationMs: options.windowDurationMs,
      expectedItemsPerWindow: options.expectedItemsPerWindow,
      falsePositiveRate: options.falsePositiveRate ?? 0.01,
      numWindows: options.numWindows ?? 2,
    }

    this.windows = []
    // Initialize with first window
    this.createWindow(Date.now())
  }

  private createWindow(startTime: number): void {
    const filter = new BloomFilter({
      expectedItems: this.options.expectedItemsPerWindow,
      falsePositiveRate: this.options.falsePositiveRate,
      seed: this.windows.length,
    })

    this.windows.push({
      filter,
      startTime,
      endTime: startTime + this.options.windowDurationMs,
    })

    // Evict old windows if we exceed the limit
    while (this.windows.length > this.options.numWindows) {
      this.windows.shift()
    }
  }

  /**
   * Add an item with timestamp
   *
   * @returns true if this is likely a new item in the current window
   */
  add(key: string, timestamp: number = Date.now()): boolean {
    // Ensure we have a window for this timestamp
    this.ensureWindowForTimestamp(timestamp)

    // Check if it exists in any active window
    if (this.mightContain(key, timestamp)) {
      return false
    }

    // Add to the appropriate window
    const window = this.getWindowForTimestamp(timestamp)
    if (window) {
      window.filter.add(key)
    }

    return true
  }

  /**
   * Check if an item might exist in any active window
   */
  mightContain(key: string, timestamp: number = Date.now()): boolean {
    // Check all windows that overlap with the given timestamp
    for (const window of this.windows) {
      if (timestamp >= window.startTime && timestamp < window.endTime + this.options.windowDurationMs) {
        if (window.filter.mightContain(key)) {
          return true
        }
      }
    }
    return false
  }

  private ensureWindowForTimestamp(timestamp: number): void {
    if (this.windows.length === 0) {
      this.createWindow(timestamp)
      return
    }

    const lastWindow = this.windows[this.windows.length - 1]
    if (timestamp >= lastWindow.endTime) {
      // Create new windows as needed
      let nextStart = lastWindow.endTime
      while (timestamp >= nextStart) {
        this.createWindow(nextStart)
        nextStart += this.options.windowDurationMs
      }
    }
  }

  private getWindowForTimestamp(timestamp: number): { filter: BloomFilter } | undefined {
    for (const window of this.windows) {
      if (timestamp >= window.startTime && timestamp < window.endTime) {
        return window
      }
    }
    return undefined
  }

  /**
   * Advance time and evict expired windows
   */
  advanceTime(timestamp: number): void {
    this.ensureWindowForTimestamp(timestamp)

    // Evict windows that are completely outside the dedup window
    const cutoffTime = timestamp - this.options.windowDurationMs * this.options.numWindows
    while (this.windows.length > 0 && this.windows[0].endTime < cutoffTime) {
      this.windows.shift()
    }
  }

  /**
   * Get memory usage in bytes
   */
  get memoryUsage(): number {
    return this.windows.reduce((sum, w) => sum + w.filter.memoryUsage, 0)
  }

  /**
   * Clear all windows
   */
  clear(): void {
    this.windows = []
    this.createWindow(Date.now())
  }

  /**
   * Serialize for checkpointing
   */
  serialize(): {
    windows: Array<{ state: BloomFilterState; startTime: number; endTime: number }>
    options: typeof this.options
  } {
    return {
      windows: this.windows.map(w => ({
        state: w.filter.serialize(),
        startTime: w.startTime,
        endTime: w.endTime,
      })),
      options: this.options,
    }
  }

  /**
   * Restore from checkpoint
   */
  static deserialize(
    state: ReturnType<TimeWindowedBloomFilter['serialize']>
  ): TimeWindowedBloomFilter {
    const filter = Object.create(TimeWindowedBloomFilter.prototype) as TimeWindowedBloomFilter
    filter.options = state.options
    filter.windows = state.windows.map(w => ({
      filter: BloomFilter.deserialize(w.state),
      startTime: w.startTime,
      endTime: w.endTime,
    }))
    filter.currentWindowIndex = 0
    return filter
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a bloom filter with optimal parameters for the expected use case
 */
export function createBloomFilter(options: BloomFilterOptions): BloomFilter {
  return new BloomFilter(options)
}

/**
 * Create a scalable bloom filter that grows with data
 */
export function createScalableBloomFilter(options?: ScalableBloomFilterOptions): ScalableBloomFilter {
  return new ScalableBloomFilter(options)
}

/**
 * Create a time-windowed bloom filter for streaming dedup
 */
export function createTimeWindowedBloomFilter(
  options: TimeWindowedBloomFilterOptions
): TimeWindowedBloomFilter {
  return new TimeWindowedBloomFilter(options)
}
