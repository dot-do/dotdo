/**
 * SPIKE: JSON Path Indexing - Automatic statistics and bloom filters
 *
 * Goal: Automatically track JSON paths in documents and build indexes
 *       for efficient query optimization
 *
 * Key features:
 * - Extract all paths from nested JSON
 * - Track frequency and type statistics
 * - Generate bloom filters for frequent paths
 * - HyperLogLog for cardinality estimation
 *
 * Run: npx vitest run json-path-index.test.ts
 */

export type JSONValue = string | number | boolean | null | JSONValue[] | { [key: string]: JSONValue }
export type JSONType = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'null'

export interface PathStatistics {
  path: string           // 'data.user.email'
  frequency: number      // times seen
  cardinality: number    // unique values estimate (HyperLogLog)
  type: JSONType
  bloomFilter?: Uint8Array
}

/**
 * Bloom Filter implementation with configurable false positive rate
 * Uses double hashing with FNV-1a and murmur-inspired hash
 */
export class BloomFilter {
  private bits: Uint8Array
  private readonly size: number
  private readonly hashCount: number
  private count: number = 0

  constructor(expectedItems: number, falsePositiveRate: number = 0.01) {
    // Optimal size: m = -n * ln(p) / (ln(2)^2)
    this.size = Math.ceil(-expectedItems * Math.log(falsePositiveRate) / (Math.LN2 * Math.LN2))
    // Optimal hash count: k = (m/n) * ln(2)
    this.hashCount = Math.ceil((this.size / expectedItems) * Math.LN2)
    // Use bytes for storage (8 bits per byte)
    this.bits = new Uint8Array(Math.ceil(this.size / 8))
  }

  /**
   * FNV-1a hash - fast and simple
   */
  private fnv1a(str: string): number {
    let hash = 2166136261
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i)
      hash = Math.imul(hash, 16777619)
    }
    return hash >>> 0
  }

  /**
   * Murmur-inspired hash for second hash function
   */
  private murmur(str: string): number {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = Math.imul(hash ^ char, 0x5bd1e995)
      hash ^= hash >>> 15
    }
    return hash >>> 0
  }

  /**
   * Generate k hash positions using double hashing
   * h(i) = (h1 + i * h2) mod m
   */
  private getPositions(value: string): number[] {
    const h1 = this.fnv1a(value)
    const h2 = this.murmur(value)
    const positions: number[] = []
    for (let i = 0; i < this.hashCount; i++) {
      positions.push((h1 + i * h2) % this.size)
    }
    return positions
  }

  add(value: string): void {
    for (const pos of this.getPositions(value)) {
      const byteIndex = Math.floor(pos / 8)
      const bitIndex = pos % 8
      this.bits[byteIndex] |= (1 << bitIndex)
    }
    this.count++
  }

  has(value: string): boolean {
    for (const pos of this.getPositions(value)) {
      const byteIndex = Math.floor(pos / 8)
      const bitIndex = pos % 8
      if ((this.bits[byteIndex] & (1 << bitIndex)) === 0) {
        return false
      }
    }
    return true
  }

  /**
   * Calculate current false positive rate based on fill ratio
   * p = (1 - e^(-kn/m))^k
   */
  getFalsePositiveRate(): number {
    const filledBits = this.getFilledBitsCount()
    const fillRatio = filledBits / this.size
    return Math.pow(fillRatio, this.hashCount)
  }

  private getFilledBitsCount(): number {
    let count = 0
    for (const byte of this.bits) {
      // Count set bits using Brian Kernighan's algorithm
      let b = byte
      while (b) {
        b &= b - 1
        count++
      }
    }
    return count
  }

  getCount(): number {
    return this.count
  }

  getSize(): number {
    return this.size
  }

  serialize(): Uint8Array {
    return this.bits.slice()
  }

  static deserialize(data: Uint8Array, expectedItems: number, falsePositiveRate: number = 0.01): BloomFilter {
    const filter = new BloomFilter(expectedItems, falsePositiveRate)
    filter.bits = data.slice()
    return filter
  }
}

/**
 * HyperLogLog implementation for cardinality estimation
 * Uses 2^p registers for ~1.04/sqrt(m) standard error
 */
export class HyperLogLog {
  private readonly p: number  // precision (number of bits for register index)
  private readonly m: number  // number of registers (2^p)
  private readonly registers: Uint8Array
  private readonly alphaMM: number  // alpha * m * m for bias correction

  constructor(precision: number = 14) {
    // Clamp precision between 4 and 16
    this.p = Math.max(4, Math.min(16, precision))
    this.m = 1 << this.p
    this.registers = new Uint8Array(this.m)

    // Calculate alpha_m for bias correction
    if (this.m >= 128) {
      this.alphaMM = 0.7213 / (1 + 1.079 / this.m) * this.m * this.m
    } else if (this.m === 64) {
      this.alphaMM = 0.709 * this.m * this.m
    } else if (this.m === 32) {
      this.alphaMM = 0.697 * this.m * this.m
    } else {
      this.alphaMM = 0.673 * this.m * this.m
    }
  }

  /**
   * Hash a string value to a 32-bit integer
   */
  private hash(value: string): number {
    // MurmurHash3 32-bit finalizer-based hash
    let h = 0
    for (let i = 0; i < value.length; i++) {
      h = Math.imul(h ^ value.charCodeAt(i), 0xcc9e2d51)
      h = (h << 15) | (h >>> 17)
      h = Math.imul(h, 0x1b873593)
    }
    h ^= value.length
    h ^= h >>> 16
    h = Math.imul(h, 0x85ebca6b)
    h ^= h >>> 13
    h = Math.imul(h, 0xc2b2ae35)
    h ^= h >>> 16
    return h >>> 0
  }

  /**
   * Count leading zeros in a 32-bit integer
   */
  private clz32(x: number): number {
    if (x === 0) return 32
    let n = 0
    if ((x & 0xFFFF0000) === 0) { n += 16; x <<= 16 }
    if ((x & 0xFF000000) === 0) { n += 8; x <<= 8 }
    if ((x & 0xF0000000) === 0) { n += 4; x <<= 4 }
    if ((x & 0xC0000000) === 0) { n += 2; x <<= 2 }
    if ((x & 0x80000000) === 0) { n += 1 }
    return n
  }

  add(value: string): void {
    const hash = this.hash(value)
    // Use first p bits for register index
    const registerIndex = hash >>> (32 - this.p)
    // Use remaining bits for rank calculation
    const w = hash << this.p | (1 << (this.p - 1))  // Ensure at least one bit set
    const rank = this.clz32(w) + 1
    // Update register with max rank
    if (rank > this.registers[registerIndex]) {
      this.registers[registerIndex] = rank
    }
  }

  count(): number {
    // Calculate harmonic mean
    let sum = 0
    let zeros = 0
    for (const register of this.registers) {
      if (register === 0) {
        zeros++
        sum += 1
      } else {
        sum += 1 / (1 << register)
      }
    }

    let estimate = this.alphaMM / sum

    // Small range correction using linear counting
    if (estimate <= 2.5 * this.m && zeros > 0) {
      estimate = this.m * Math.log(this.m / zeros)
    }

    // Large range correction (not needed for 32-bit hash)
    // Skip for simplicity

    return Math.round(estimate)
  }

  /**
   * Merge another HyperLogLog into this one
   */
  merge(other: HyperLogLog): void {
    if (this.m !== other.m) {
      throw new Error('Cannot merge HyperLogLog with different precision')
    }
    for (let i = 0; i < this.m; i++) {
      if (other.registers[i] > this.registers[i]) {
        this.registers[i] = other.registers[i]
      }
    }
  }

  /**
   * Get relative standard error (accuracy)
   */
  getAccuracy(): number {
    return 1.04 / Math.sqrt(this.m)
  }
}

/**
 * Track statistics for a single JSON path
 */
class PathTracker {
  readonly path: string
  frequency: number = 0
  type: JSONType = 'null'
  private hyperLogLog: HyperLogLog
  private bloomFilter: BloomFilter | null = null
  private readonly bloomThreshold: number
  private readonly bloomCapacity: number
  private readonly bloomFPRate: number

  constructor(
    path: string,
    options: {
      bloomThreshold?: number
      bloomCapacity?: number
      bloomFPRate?: number
      hllPrecision?: number
    } = {}
  ) {
    this.path = path
    this.bloomThreshold = options.bloomThreshold ?? 100
    this.bloomCapacity = options.bloomCapacity ?? 10000
    this.bloomFPRate = options.bloomFPRate ?? 0.01
    this.hyperLogLog = new HyperLogLog(options.hllPrecision ?? 14)
  }

  update(value: JSONValue): void {
    this.frequency++

    // Update type (use first non-null type seen)
    const valueType = this.getValueType(value)
    if (this.type === 'null' && valueType !== 'null') {
      this.type = valueType
    }

    // Update cardinality estimation
    const stringValue = this.valueToString(value)
    this.hyperLogLog.add(stringValue)

    // Create bloom filter once threshold is reached
    if (this.frequency === this.bloomThreshold && !this.bloomFilter) {
      this.bloomFilter = new BloomFilter(this.bloomCapacity, this.bloomFPRate)
    }

    // Add to bloom filter if it exists
    if (this.bloomFilter) {
      this.bloomFilter.add(stringValue)
    }
  }

  private getValueType(value: JSONValue): JSONType {
    if (value === null) return 'null'
    if (Array.isArray(value)) return 'array'
    const t = typeof value
    if (t === 'string') return 'string'
    if (t === 'number') return 'number'
    if (t === 'boolean') return 'boolean'
    if (t === 'object') return 'object'
    return 'null'
  }

  private valueToString(value: JSONValue): string {
    if (value === null) return 'null'
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }

  getCardinality(): number {
    return this.hyperLogLog.count()
  }

  getBloomFilter(): BloomFilter | null {
    return this.bloomFilter
  }

  testBloom(value: string): boolean {
    if (!this.bloomFilter) return true  // No filter = unknown, assume true
    return this.bloomFilter.has(value)
  }

  getStats(): PathStatistics {
    return {
      path: this.path,
      frequency: this.frequency,
      cardinality: this.getCardinality(),
      type: this.type,
      bloomFilter: this.bloomFilter?.serialize()
    }
  }
}

export interface JSONPathIndexOptions {
  bloomThreshold?: number   // Minimum frequency before creating bloom filter (default: 100)
  bloomCapacity?: number    // Expected capacity for bloom filters (default: 10000)
  bloomFPRate?: number      // False positive rate for bloom filters (default: 0.01)
  hllPrecision?: number     // HyperLogLog precision 4-16 (default: 14, ~1.6% error)
  maxDepth?: number         // Maximum depth to index (default: 10)
}

/**
 * JSON Path Index - Automatically tracks statistics and builds bloom filters
 * for all paths in JSON documents
 */
export class JSONPathIndex {
  private readonly paths: Map<string, PathTracker> = new Map()
  private readonly options: Required<JSONPathIndexOptions>
  private documentCount: number = 0

  constructor(options: JSONPathIndexOptions = {}) {
    this.options = {
      bloomThreshold: options.bloomThreshold ?? 100,
      bloomCapacity: options.bloomCapacity ?? 10000,
      bloomFPRate: options.bloomFPRate ?? 0.01,
      hllPrecision: options.hllPrecision ?? 14,
      maxDepth: options.maxDepth ?? 10
    }
  }

  /**
   * Index a document, extracting and tracking all paths
   */
  write(doc: Record<string, unknown>): void {
    this.documentCount++
    this.extractPaths(doc, '', 0)
  }

  private extractPaths(value: unknown, currentPath: string, depth: number): void {
    if (depth > this.options.maxDepth) return

    // Track this path's value
    if (currentPath) {
      this.trackPath(currentPath, value as JSONValue)
    }

    // Recurse into objects
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, val] of Object.entries(value)) {
        const newPath = currentPath ? `${currentPath}.${key}` : key
        this.extractPaths(val, newPath, depth + 1)
      }
    }

    // Recurse into arrays (track array elements with [] suffix)
    if (Array.isArray(value)) {
      for (const item of value) {
        const arrayPath = `${currentPath}[]`
        this.extractPaths(item, arrayPath, depth + 1)
      }
    }
  }

  private trackPath(path: string, value: JSONValue): void {
    let tracker = this.paths.get(path)
    if (!tracker) {
      tracker = new PathTracker(path, {
        bloomThreshold: this.options.bloomThreshold,
        bloomCapacity: this.options.bloomCapacity,
        bloomFPRate: this.options.bloomFPRate,
        hllPrecision: this.options.hllPrecision
      })
      this.paths.set(path, tracker)
    }
    tracker.update(value)
  }

  /**
   * Get statistics for a specific path
   */
  getPathStats(path: string): PathStatistics | undefined {
    return this.paths.get(path)?.getStats()
  }

  /**
   * Get the bloom filter for a path (if available)
   */
  getBloomFilter(path: string): BloomFilter | null {
    return this.paths.get(path)?.getBloomFilter() ?? null
  }

  /**
   * Test if a value might exist at a path using bloom filter
   * Returns true if the value might exist, false if definitely not
   */
  testBloomFilter(path: string, value: string): boolean {
    const tracker = this.paths.get(path)
    if (!tracker) return false  // Path never seen
    return tracker.testBloom(value)
  }

  /**
   * Get all indexed paths
   */
  getAllPaths(): string[] {
    return Array.from(this.paths.keys())
  }

  /**
   * Get all path statistics sorted by frequency
   */
  getAllStats(): PathStatistics[] {
    return Array.from(this.paths.values())
      .map(t => t.getStats())
      .sort((a, b) => b.frequency - a.frequency)
  }

  /**
   * Get total number of documents indexed
   */
  getDocumentCount(): number {
    return this.documentCount
  }

  /**
   * Find paths matching a pattern (supports * wildcard)
   */
  findPaths(pattern: string): string[] {
    const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '[^.]+') + '$')
    return this.getAllPaths().filter(path => regex.test(path))
  }

  /**
   * Get high-cardinality paths (likely good for indexing)
   */
  getHighCardinalityPaths(minCardinality: number = 100): PathStatistics[] {
    return this.getAllStats().filter(s => s.cardinality >= minCardinality)
  }

  /**
   * Get low-cardinality paths (good for bloom filters)
   */
  getLowCardinalityPaths(maxCardinality: number = 1000): PathStatistics[] {
    return this.getAllStats().filter(s => s.cardinality <= maxCardinality)
  }
}

export default JSONPathIndex
