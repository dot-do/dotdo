/**
 * Approximate Query Functions
 *
 * Probabilistic data structures for approximate query processing at scale:
 * - T-Digest: Percentile/quantile estimation (P50, P95, P99)
 * - Count-Min Sketch: Frequency estimation for streaming data
 * - TopK/Heavy Hitters: Finding most frequent items
 *
 * These data structures provide sub-linear space complexity while maintaining
 * bounded error guarantees, making them ideal for analytics on large datasets.
 *
 * @module db/primitives/analytics/approximate-queries
 */

import { murmurHash3_32 } from '../utils/murmur3'

// ============================================================================
// T-Digest Implementation
// ============================================================================

/**
 * A centroid represents a cluster of values with a mean and weight (count)
 */
interface Centroid {
  mean: number
  weight: number
}

/**
 * T-Digest configuration options
 */
export interface TDigestOptions {
  /**
   * Compression parameter (delta). Higher values use more memory but improve accuracy.
   * Default: 100 (good balance of accuracy and memory)
   * Recommended range: 50-500
   */
  compression?: number
}

/**
 * T-Digest for approximate percentile estimation
 *
 * The t-digest data structure uses a variant of 1-dimensional k-means clustering
 * to maintain a compact representation of a distribution that allows for accurate
 * estimation of quantiles/percentiles.
 *
 * Key properties:
 * - O(1) per-value insertion (amortized)
 * - High accuracy at tail percentiles (P1, P99)
 * - Memory proportional to compression parameter
 * - Supports merge for distributed computation
 */
export interface TDigest {
  /** Add a single value */
  add(value: number): void

  /** Add a batch of values */
  addBatch(values: number[]): void

  /** Get the number of values added */
  count(): number

  /** Estimate the value at a given percentile (0-100) */
  percentile(p: number): number

  /** Estimate values at multiple percentiles */
  percentiles(ps: number[]): number[]

  /** Get the minimum value seen */
  min(): number

  /** Get the maximum value seen */
  max(): number

  /** Merge with another t-digest */
  merge(other: TDigest): TDigest

  /** Serialize to bytes for storage/transmission */
  serialize(): Uint8Array

  /** Deserialize from bytes */
  deserialize(data: Uint8Array): void
}

/**
 * T-Digest implementation using the scaling function from the original paper
 */
class TDigestImpl implements TDigest {
  private centroids: Centroid[] = []
  private _count: number = 0
  private _min: number = Infinity
  private _max: number = -Infinity
  private readonly compression: number
  private bufferedValues: number[] = []
  private readonly bufferSize: number = 500

  constructor(options: TDigestOptions = {}) {
    this.compression = options.compression ?? 100
  }

  add(value: number): void {
    this.bufferedValues.push(value)
    this._count++

    if (value < this._min) this._min = value
    if (value > this._max) this._max = value

    if (this.bufferedValues.length >= this.bufferSize) {
      this.flushBuffer()
    }
  }

  addBatch(values: number[]): void {
    for (const v of values) {
      this.bufferedValues.push(v)
      this._count++
      if (v < this._min) this._min = v
      if (v > this._max) this._max = v
    }
    this.flushBuffer()
  }

  count(): number {
    return this._count
  }

  percentile(p: number): number {
    if (p < 0 || p > 100) {
      throw new Error('Percentile must be between 0 and 100')
    }
    if (this._count === 0) {
      throw new Error('Cannot compute percentile of empty digest')
    }

    // Flush any buffered values first
    if (this.bufferedValues.length > 0) {
      this.flushBuffer()
    }

    if (p === 0) return this._min
    if (p === 100) return this._max

    const q = p / 100
    const target = q * this._count

    let cumulative = 0
    for (let i = 0; i < this.centroids.length; i++) {
      const c = this.centroids[i]!
      const nextCumulative = cumulative + c.weight

      if (nextCumulative >= target) {
        // Found the centroid containing our target percentile
        if (i === 0) {
          // First centroid - interpolate from min
          const ratio = (target - cumulative) / c.weight
          return this._min + ratio * (c.mean - this._min)
        } else if (i === this.centroids.length - 1) {
          // Last centroid - interpolate to max
          const ratio = (target - cumulative) / c.weight
          return c.mean + ratio * (this._max - c.mean)
        } else {
          // Middle centroid - interpolate between neighbors
          const prev = this.centroids[i - 1]!
          const weightInCentroid = target - cumulative
          const fraction = weightInCentroid / c.weight

          // Interpolate within centroid bounds
          const prevBoundary = (prev.mean + c.mean) / 2
          const next = this.centroids[i + 1]!
          const nextBoundary = (c.mean + next.mean) / 2

          return prevBoundary + fraction * (nextBoundary - prevBoundary)
        }
      }
      cumulative = nextCumulative
    }

    // Should not reach here
    return this._max
  }

  percentiles(ps: number[]): number[] {
    return ps.map((p) => this.percentile(p))
  }

  min(): number {
    if (this._count === 0) {
      throw new Error('Cannot get min of empty digest')
    }
    return this._min
  }

  max(): number {
    if (this._count === 0) {
      throw new Error('Cannot get max of empty digest')
    }
    return this._max
  }

  merge(other: TDigest): TDigest {
    const result = new TDigestImpl({ compression: this.compression })

    // Flush both digests first
    if (this.bufferedValues.length > 0) {
      this.flushBuffer()
    }
    const otherImpl = other as TDigestImpl
    if (otherImpl.bufferedValues.length > 0) {
      otherImpl.flushBuffer()
    }

    // Merge all centroids
    const allCentroids = [...this.centroids, ...otherImpl.centroids]

    if (allCentroids.length === 0) {
      return result
    }

    // Sort by mean
    allCentroids.sort((a, b) => a.mean - b.mean)

    // Update result metadata
    result._count = this._count + otherImpl._count
    result._min = Math.min(this._min, otherImpl._min)
    result._max = Math.max(this._max, otherImpl._max)

    // Re-cluster centroids
    result.centroids = this.compressCentroids(allCentroids, result._count)

    return result
  }

  serialize(): Uint8Array {
    // Flush buffer first
    if (this.bufferedValues.length > 0) {
      this.flushBuffer()
    }

    // Format: [count 8B][min 8B][max 8B][compression 4B][numCentroids 4B][centroids...]
    const headerSize = 8 + 8 + 8 + 4 + 4
    const centroidSize = 8 + 8 // mean + weight
    const totalSize = headerSize + this.centroids.length * centroidSize

    const buffer = new ArrayBuffer(totalSize)
    const view = new DataView(buffer)

    let offset = 0

    // Write header
    view.setFloat64(offset, this._count, true)
    offset += 8
    view.setFloat64(offset, this._min, true)
    offset += 8
    view.setFloat64(offset, this._max, true)
    offset += 8
    view.setUint32(offset, this.compression, true)
    offset += 4
    view.setUint32(offset, this.centroids.length, true)
    offset += 4

    // Write centroids
    for (const c of this.centroids) {
      view.setFloat64(offset, c.mean, true)
      offset += 8
      view.setFloat64(offset, c.weight, true)
      offset += 8
    }

    return new Uint8Array(buffer)
  }

  deserialize(data: Uint8Array): void {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    let offset = 0

    // Read header
    this._count = view.getFloat64(offset, true)
    offset += 8
    this._min = view.getFloat64(offset, true)
    offset += 8
    this._max = view.getFloat64(offset, true)
    offset += 8
    // Skip compression (already set in constructor)
    offset += 4
    const numCentroids = view.getUint32(offset, true)
    offset += 4

    // Read centroids
    this.centroids = []
    for (let i = 0; i < numCentroids; i++) {
      const mean = view.getFloat64(offset, true)
      offset += 8
      const weight = view.getFloat64(offset, true)
      offset += 8
      this.centroids.push({ mean, weight })
    }

    this.bufferedValues = []
  }

  /**
   * Flush buffered values into centroids
   */
  private flushBuffer(): void {
    if (this.bufferedValues.length === 0) return

    // Sort buffered values
    this.bufferedValues.sort((a, b) => a - b)

    // Add each buffered value as a centroid
    const newCentroids: Centroid[] = this.bufferedValues.map((v) => ({
      mean: v,
      weight: 1,
    }))

    // Merge with existing centroids
    const allCentroids = [...this.centroids, ...newCentroids]
    allCentroids.sort((a, b) => a.mean - b.mean)

    // Compress
    this.centroids = this.compressCentroids(allCentroids, this._count)
    this.bufferedValues = []
  }

  /**
   * Compress centroids using the t-digest algorithm scaling function
   */
  private compressCentroids(centroids: Centroid[], totalWeight: number): Centroid[] {
    if (centroids.length <= 1) return centroids

    const result: Centroid[] = []
    let cumulative = 0

    for (const c of centroids) {
      if (result.length === 0) {
        result.push({ ...c })
        cumulative += c.weight
        continue
      }

      const last = result[result.length - 1]!

      // Calculate the quantile position
      const q = (cumulative + c.weight / 2) / totalWeight

      // Use the scaling function k(q) = delta/2 * (asin(2q-1)/pi + 0.5)
      // This gives more resolution at the tails
      const k = (this.compression / 2) * (Math.asin(2 * q - 1) / Math.PI + 0.5)
      const kPrev = (this.compression / 2) * (Math.asin(2 * (cumulative / totalWeight) - 1) / Math.PI + 0.5)

      // Maximum weight for this position
      const maxWeight = Math.max(1, 4 * totalWeight * (k - kPrev) / this.compression)

      if (last.weight + c.weight <= maxWeight) {
        // Merge into last centroid
        const totalW = last.weight + c.weight
        last.mean = (last.mean * last.weight + c.mean * c.weight) / totalW
        last.weight = totalW
      } else {
        // Start new centroid
        result.push({ ...c })
      }

      cumulative += c.weight
    }

    return result
  }
}

/**
 * Create a new T-Digest instance
 */
export function createTDigest(options?: TDigestOptions): TDigest {
  return new TDigestImpl(options)
}

// ============================================================================
// Count-Min Sketch Implementation
// ============================================================================

/**
 * Count-Min Sketch configuration options
 */
export interface CountMinSketchOptions {
  /**
   * Width of the sketch (number of counters per row)
   * Higher values reduce error but use more memory
   */
  width?: number

  /**
   * Depth of the sketch (number of hash functions)
   * Higher values reduce probability of large errors
   */
  depth?: number

  /**
   * Desired relative error (epsilon)
   * Alternative to specifying width directly
   * Width = ceil(e/epsilon)
   */
  epsilon?: number

  /**
   * Desired probability of error exceeding epsilon (delta)
   * Alternative to specifying depth directly
   * Depth = ceil(ln(1/delta))
   */
  delta?: number
}

/**
 * Count-Min Sketch for frequency estimation
 *
 * The Count-Min Sketch is a probabilistic data structure that maintains
 * frequency counts in sub-linear space with bounded overestimation error.
 *
 * Key properties:
 * - O(1) add and query operations
 * - Never underestimates frequency
 * - Error bounded by epsilon with probability 1-delta
 * - Supports merge for distributed computation
 */
export interface CountMinSketch {
  /** Add an item (optionally with count) */
  add(item: string | number, count?: number): void

  /** Estimate the frequency of an item */
  frequency(item: string | number): number

  /** Merge with another sketch */
  merge(other: CountMinSketch): CountMinSketch

  /** Serialize to bytes */
  serialize(): Uint8Array

  /** Deserialize from bytes */
  deserialize(data: Uint8Array): void

  /** Get the width of the sketch */
  getWidth(): number

  /** Get the depth of the sketch */
  getDepth(): number
}

/**
 * Count-Min Sketch implementation
 */
class CountMinSketchImpl implements CountMinSketch {
  private readonly width: number
  private readonly depth: number
  private counters: Uint32Array

  constructor(options: CountMinSketchOptions = {}) {
    // Calculate dimensions from epsilon/delta or use provided values
    if (options.epsilon !== undefined && options.delta !== undefined) {
      this.width = Math.ceil(Math.E / options.epsilon)
      this.depth = Math.ceil(Math.log(1 / options.delta))
    } else {
      this.width = options.width ?? 2048
      this.depth = options.depth ?? 5
    }

    this.counters = new Uint32Array(this.width * this.depth)
  }

  add(item: string | number, count: number = 1): void {
    const key = this.itemToBytes(item)

    for (let i = 0; i < this.depth; i++) {
      const hash = murmurHash3_32(key, i) % this.width
      const index = i * this.width + hash
      this.counters[index] = Math.min(this.counters[index]! + count, 0xFFFFFFFF)
    }
  }

  frequency(item: string | number): number {
    const key = this.itemToBytes(item)
    let minCount = Infinity

    for (let i = 0; i < this.depth; i++) {
      const hash = murmurHash3_32(key, i) % this.width
      const index = i * this.width + hash
      minCount = Math.min(minCount, this.counters[index]!)
    }

    return minCount === Infinity ? 0 : minCount
  }

  merge(other: CountMinSketch): CountMinSketch {
    const otherImpl = other as CountMinSketchImpl

    if (this.width !== otherImpl.width || this.depth !== otherImpl.depth) {
      throw new Error('Cannot merge sketches with different dimensions')
    }

    const result = new CountMinSketchImpl({ width: this.width, depth: this.depth })

    for (let i = 0; i < this.counters.length; i++) {
      result.counters[i] = Math.min(
        this.counters[i]! + otherImpl.counters[i]!,
        0xFFFFFFFF
      )
    }

    return result
  }

  serialize(): Uint8Array {
    // Format: [width 4B][depth 4B][counters...]
    const headerSize = 8
    const countersBytes = this.counters.length * 4
    const totalSize = headerSize + countersBytes

    const buffer = new ArrayBuffer(totalSize)
    const view = new DataView(buffer)
    const output = new Uint8Array(buffer)

    view.setUint32(0, this.width, true)
    view.setUint32(4, this.depth, true)

    // Copy counters
    const counterBytes = new Uint8Array(this.counters.buffer)
    output.set(counterBytes, headerSize)

    return output
  }

  deserialize(data: Uint8Array): void {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)

    const width = view.getUint32(0, true)
    const depth = view.getUint32(4, true)

    if (width !== this.width || depth !== this.depth) {
      throw new Error('Sketch dimensions mismatch')
    }

    // Copy counters
    const counterBytes = data.slice(8)
    this.counters = new Uint32Array(counterBytes.buffer.slice(counterBytes.byteOffset))
  }

  getWidth(): number {
    return this.width
  }

  getDepth(): number {
    return this.depth
  }

  private itemToBytes(item: string | number): Uint8Array {
    if (typeof item === 'string') {
      return new TextEncoder().encode(item)
    }
    const buffer = new ArrayBuffer(8)
    const view = new DataView(buffer)
    view.setFloat64(0, item, true)
    return new Uint8Array(buffer)
  }
}

/**
 * Create a new Count-Min Sketch instance
 */
export function createCountMinSketch(options?: CountMinSketchOptions): CountMinSketch {
  return new CountMinSketchImpl(options)
}

// ============================================================================
// TopK Implementation
// ============================================================================

/**
 * TopK configuration options
 */
export interface TopKOptions {
  /**
   * Width of underlying Count-Min Sketch
   */
  cmsWidth?: number

  /**
   * Depth of underlying Count-Min Sketch
   */
  cmsDepth?: number
}

/**
 * TopK result item
 */
export interface TopKItem {
  value: string | number
  count: number
}

/**
 * TopK tracker for finding heavy hitters
 *
 * Uses a Count-Min Sketch for frequency estimation and maintains
 * a min-heap of the top K items seen so far.
 */
export interface TopK {
  /** Add an item (optionally with count) */
  add(item: string | number, count?: number): void

  /** Get the top K items sorted by frequency (descending) */
  getTopK(): TopKItem[]

  /** Merge with another TopK tracker */
  merge(other: TopK): TopK
}

/**
 * TopK implementation using Count-Min Sketch + heap
 */
class TopKImpl implements TopK {
  private readonly k: number
  private readonly cms: CountMinSketchImpl
  private readonly candidates: Map<string, number> = new Map()
  private readonly options: TopKOptions

  constructor(k: number, options: TopKOptions = {}) {
    this.k = k
    this.options = options
    this.cms = new CountMinSketchImpl({
      width: options.cmsWidth ?? 10000,
      depth: options.cmsDepth ?? 7,
    })
  }

  add(item: string | number, count: number = 1): void {
    const key = String(item)

    // Add to CMS
    this.cms.add(item, count)

    // Update candidate tracking
    const currentCount = this.candidates.get(key) ?? 0
    this.candidates.set(key, currentCount + count)

    // Prune candidates if too many
    if (this.candidates.size > this.k * 10) {
      this.pruneCanditates()
    }
  }

  getTopK(): TopKItem[] {
    // Get estimated counts for all candidates
    const items: TopKItem[] = []

    this.candidates.forEach((_, key) => {
      const count = this.cms.frequency(key)
      items.push({ value: key, count })
    })

    // Sort by count descending
    items.sort((a, b) => b.count - a.count)

    // Return top K
    return items.slice(0, this.k)
  }

  merge(other: TopK): TopK {
    const otherImpl = other as TopKImpl

    const result = new TopKImpl(this.k, this.options)

    // Merge CMS
    const mergedCms = this.cms.merge(otherImpl.cms) as CountMinSketchImpl
    ;(result as unknown as { cms: CountMinSketchImpl }).cms = mergedCms

    // Merge candidates
    this.candidates.forEach((count, key) => {
      result.candidates.set(key, count)
    })
    otherImpl.candidates.forEach((count, key) => {
      const existing = result.candidates.get(key) ?? 0
      result.candidates.set(key, existing + count)
    })

    result.pruneCanditates()

    return result
  }

  private pruneCanditates(): void {
    // Keep only candidates that could potentially be in top K
    const items: Array<[string, number]> = []

    this.candidates.forEach((_, key) => {
      const count = this.cms.frequency(key)
      items.push([key, count])
    })

    // Sort by estimated count
    items.sort((a, b) => b[1] - a[1])

    // Keep top K * 2 candidates
    const toKeep = new Set(items.slice(0, this.k * 2).map(([key]) => key))

    const keysToDelete: string[] = []
    this.candidates.forEach((_, key) => {
      if (!toKeep.has(key)) {
        keysToDelete.push(key)
      }
    })
    for (const key of keysToDelete) {
      this.candidates.delete(key)
    }
  }
}

/**
 * Create a new TopK tracker
 */
export function createTopK(k: number, options?: TopKOptions): TopK {
  return new TopKImpl(k, options)
}
