/**
 * Vector Quantization - Memory-efficient Vector Storage
 *
 * This module implements two vector quantization techniques for compressing
 * high-dimensional vectors while preserving distance relationships:
 *
 * - **Product Quantization (PQ)**: Higher compression with trained codebooks
 * - **Scalar Quantization (SQ)**: Simpler compression with learned ranges
 *
 * ## Comparison
 *
 * | Feature             | Product Quantization     | Scalar Quantization      |
 * |---------------------|--------------------------|--------------------------|
 * | Compression ratio   | 32x - 64x                | 4x                       |
 * | Training required   | Yes (k-means)            | Yes (min/max bounds)     |
 * | Accuracy            | Good                     | Better                   |
 * | Distance computation| ADC lookup tables        | Direct int8 arithmetic   |
 * | Memory per vector   | M bytes (e.g., 48B)      | D bytes (e.g., 768B)     |
 * | Use case            | Billion-scale search     | Million-scale search     |
 *
 * ## Product Quantization
 *
 * PQ divides vectors into M subvectors and quantizes each to K centroids:
 *
 * ```
 * D=768, M=48 subquantizers, K=256 centroids
 * 768 floats (3072 bytes) -> 48 uint8 codes (48 bytes) = 64x compression
 * ```
 *
 * ## Scalar Quantization
 *
 * SQ maps each float32 value to int8 using learned min/max bounds:
 *
 * ```
 * D=768 floats (3072 bytes) -> 768 int8 values (768 bytes) = 4x compression
 * ```
 *
 * @example Product Quantization
 * ```typescript
 * import { ProductQuantizer } from 'db/edgevec/quantization'
 *
 * // Create quantizer
 * const pq = new ProductQuantizer({
 *   dimensions: 768,
 *   numSubvectors: 48,     // M = 48 subspaces
 *   numCentroids: 256,     // K = 256 codes per subspace
 *   trainingIterations: 25
 * })
 *
 * // Train on sample data (need at least numCentroids * 10 vectors)
 * await pq.train(trainingVectors)
 *
 * // Encode vectors
 * const code = pq.encode(vector)  // Uint8Array of 48 bytes
 *
 * // Decode (approximate)
 * const reconstructed = pq.decode(code)
 *
 * // Create searchable index
 * const index = pq.createIndex()
 * index.insert('doc-1', vector)
 * const results = index.search(query, { k: 10 })
 * ```
 *
 * @example Scalar Quantization
 * ```typescript
 * import { ScalarQuantizer } from 'db/edgevec/quantization'
 *
 * const sq = new ScalarQuantizer({ dimensions: 768 })
 *
 * // Train on sample data to learn min/max bounds
 * await sq.train(trainingVectors)
 *
 * // Quantize vectors
 * const quantized = sq.quantize(vector)  // Int8Array
 *
 * // Dequantize (approximate)
 * const reconstructed = sq.dequantize(quantized)
 *
 * // Create searchable index
 * const index = sq.createIndex()
 * index.insert('doc-1', vector)
 * const results = index.search(query, { k: 10 })
 * ```
 *
 * @example Memory usage comparison
 * ```typescript
 * // For 100K vectors of 768 dimensions:
 * // - Full float32: 100K * 768 * 4 = 307MB
 * // - PQ (M=48):    100K * 48 = 4.8MB (64x reduction)
 * // - SQ (int8):    100K * 768 = 76.8MB (4x reduction)
 *
 * console.log(`PQ memory: ${pqIndex.memoryUsage()} bytes`)
 * console.log(`SQ memory: ${sqIndex.memoryUsage()} bytes`)
 * ```
 *
 * @module db/edgevec/quantization
 * @see {@link https://ieeexplore.ieee.org/document/5432202 | Product Quantization Paper}
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Product Quantization configuration
 */
export interface PQConfig {
  /** Vector dimensions */
  dimensions: number
  /** Number of subvectors (M) - dimensions must be divisible by this */
  numSubvectors: number
  /** Number of centroids per subvector (default: 256 for uint8 codes) */
  numCentroids?: number
  /** Training iterations for k-means (default: 25) */
  trainingIterations?: number
}

/**
 * Scalar Quantization configuration
 */
export interface SQConfig {
  /** Vector dimensions */
  dimensions: number
  /** Number of bits per value (default: 8 for int8) */
  bits?: number
}

/**
 * Quantized index interface
 */
export interface QuantizedIndex {
  /** Insert a vector (will be quantized) */
  insert(id: string, vector: Float32Array): void
  /** Search using asymmetric distance computation */
  search(query: Float32Array, options?: { k?: number }): Array<{ id: string; score: number }>
  /** Get number of vectors */
  size(): number
  /** Get memory usage estimate in bytes */
  memoryUsage(): number
}

// ============================================================================
// PRODUCT QUANTIZATION
// ============================================================================

/**
 * ProductQuantizer - Trainable vector compression using Product Quantization.
 *
 * This class trains codebooks using k-means clustering and provides
 * encoding/decoding for vector compression.
 *
 * ## Training Requirements
 *
 * - Minimum training vectors: numCentroids * 10 (e.g., 2560 for K=256)
 * - Training time: O(numVectors * numSubvectors * numCentroids * trainingIterations)
 * - Memory during training: O(numVectors * dimensions)
 *
 * ## Compression Characteristics
 *
 * - Compression ratio: dimensions * 4 / numSubvectors (e.g., 64x for D=768, M=48)
 * - Reconstruction error increases with higher compression
 * - Distance estimation accuracy: ~95% recall at 10x recall candidates
 *
 * @example
 * ```typescript
 * const pq = new ProductQuantizer({
 *   dimensions: 768,
 *   numSubvectors: 48,
 *   numCentroids: 256
 * })
 *
 * await pq.train(trainingVectors)
 * const code = pq.encode(vector)  // 48 bytes instead of 3072
 * ```
 */
export class ProductQuantizer {
  private config: Required<PQConfig>
  private subvectorDim: number
  private codebooks: Float32Array[][] | null = null
  private _isTrained = false

  constructor(config: PQConfig) {
    const numCentroids = config.numCentroids ?? 256
    const trainingIterations = config.trainingIterations ?? 25

    // Validate dimensions divisibility
    if (config.dimensions % config.numSubvectors !== 0) {
      throw new Error(
        `dimensions (${config.dimensions}) must be divisible by numSubvectors (${config.numSubvectors})`
      )
    }

    this.config = {
      ...config,
      numCentroids,
      trainingIterations,
    }

    this.subvectorDim = config.dimensions / config.numSubvectors
  }

  // ============================================================================
  // TRAINING
  // ============================================================================

  /**
   * Train codebooks from training vectors using k-means
   */
  async train(vectors: Float32Array[]): Promise<void> {
    const minVectors = this.config.numCentroids * 10
    if (vectors.length < minVectors) {
      throw new Error(
        `insufficient training vectors: got ${vectors.length}, need at least ${minVectors}`
      )
    }

    // Initialize codebooks
    this.codebooks = []

    for (let m = 0; m < this.config.numSubvectors; m++) {
      // Extract subvectors for this subspace
      const subvectors = vectors.map((v) =>
        v.slice(m * this.subvectorDim, (m + 1) * this.subvectorDim)
      )

      // Run k-means
      const centroids = await this.kmeans(
        subvectors,
        this.config.numCentroids,
        this.config.trainingIterations
      )

      this.codebooks.push(centroids)
    }

    this._isTrained = true
  }

  /**
   * Simple k-means clustering
   */
  private async kmeans(
    vectors: Float32Array[],
    k: number,
    iterations: number
  ): Promise<Float32Array[]> {
    const dim = vectors[0]!.length

    // Initialize centroids randomly
    const centroids: Float32Array[] = []
    const indices = new Set<number>()
    while (centroids.length < k) {
      const idx = Math.floor(Math.random() * vectors.length)
      if (!indices.has(idx)) {
        indices.add(idx)
        centroids.push(new Float32Array(vectors[idx]!))
      }
    }

    // Iterate
    for (let iter = 0; iter < iterations; iter++) {
      // Assign vectors to nearest centroid
      const assignments: number[][] = Array.from({ length: k }, () => [])

      for (let i = 0; i < vectors.length; i++) {
        let minDist = Infinity
        let minIdx = 0

        for (let c = 0; c < k; c++) {
          const dist = this.l2Distance(vectors[i]!, centroids[c]!)
          if (dist < minDist) {
            minDist = dist
            minIdx = c
          }
        }

        assignments[minIdx]!.push(i)
      }

      // Update centroids
      for (let c = 0; c < k; c++) {
        if (assignments[c]!.length === 0) continue

        const newCentroid = new Float32Array(dim)
        for (const idx of assignments[c]!) {
          for (let d = 0; d < dim; d++) {
            newCentroid[d]! += vectors[idx]![d]!
          }
        }
        for (let d = 0; d < dim; d++) {
          newCentroid[d]! /= assignments[c]!.length
        }
        centroids[c] = newCentroid
      }
    }

    return centroids
  }

  private l2Distance(a: Float32Array, b: Float32Array): number {
    let sum = 0
    for (let i = 0; i < a.length; i++) {
      const diff = a[i]! - b[i]!
      sum += diff * diff
    }
    return sum // Return squared distance for efficiency
  }

  // ============================================================================
  // ENCODING / DECODING
  // ============================================================================

  isTrained(): boolean {
    return this._isTrained
  }

  numSubvectors(): number {
    return this.config.numSubvectors
  }

  numCentroids(): number {
    return this.config.numCentroids
  }

  /**
   * Encode a vector to PQ codes
   */
  encode(vector: Float32Array): Uint8Array {
    if (!this.codebooks) {
      throw new Error('Quantizer not trained')
    }

    const codes = new Uint8Array(this.config.numSubvectors)

    for (let m = 0; m < this.config.numSubvectors; m++) {
      const subvector = vector.slice(
        m * this.subvectorDim,
        (m + 1) * this.subvectorDim
      )

      // Find nearest centroid
      let minDist = Infinity
      let minIdx = 0

      for (let c = 0; c < this.config.numCentroids; c++) {
        const dist = this.l2Distance(subvector, this.codebooks[m]![c]!)
        if (dist < minDist) {
          minDist = dist
          minIdx = c
        }
      }

      codes[m] = minIdx
    }

    return codes
  }

  /**
   * Encode a batch of vectors
   */
  encodeBatch(vectors: Float32Array[]): Uint8Array[] {
    return vectors.map((v) => this.encode(v))
  }

  /**
   * Decode PQ codes back to approximate vector
   */
  decode(codes: Uint8Array): Float32Array {
    if (!this.codebooks) {
      throw new Error('Quantizer not trained')
    }

    const vector = new Float32Array(this.config.dimensions)

    for (let m = 0; m < this.config.numSubvectors; m++) {
      const centroid = this.codebooks[m]![codes[m]!]!
      for (let d = 0; d < this.subvectorDim; d++) {
        vector[m * this.subvectorDim + d] = centroid[d]!
      }
    }

    return vector
  }

  // ============================================================================
  // ASYMMETRIC DISTANCE COMPUTATION
  // ============================================================================

  /**
   * Compute distance lookup table for a query
   */
  computeDistanceTable(query: Float32Array): Float32Array[] {
    if (!this.codebooks) {
      throw new Error('Quantizer not trained')
    }

    const tables: Float32Array[] = []

    for (let m = 0; m < this.config.numSubvectors; m++) {
      const table = new Float32Array(this.config.numCentroids)
      const subquery = query.slice(
        m * this.subvectorDim,
        (m + 1) * this.subvectorDim
      )

      for (let c = 0; c < this.config.numCentroids; c++) {
        table[c] = this.l2Distance(subquery, this.codebooks[m]![c]!)
      }

      tables.push(table)
    }

    return tables
  }

  /**
   * Compute asymmetric distance using lookup table
   */
  asymmetricDistance(codes: Uint8Array, lookupTable: Float32Array[]): number {
    let distance = 0
    for (let m = 0; m < this.config.numSubvectors; m++) {
      distance += lookupTable[m]![codes[m]!]!
    }
    return distance
  }

  /**
   * Batch asymmetric distance computation
   */
  batchAsymmetricDistance(
    codes: Uint8Array[],
    lookupTable: Float32Array[]
  ): Float32Array {
    const distances = new Float32Array(codes.length)

    for (let i = 0; i < codes.length; i++) {
      distances[i] = this.asymmetricDistance(codes[i]!, lookupTable)
    }

    return distances
  }

  // ============================================================================
  // INDEX CREATION
  // ============================================================================

  /**
   * Create a quantized index
   */
  createIndex(): QuantizedIndex {
    if (!this.codebooks) {
      throw new Error('Quantizer not trained')
    }

    return new PQIndex(this)
  }
}

/**
 * PQ-based Index
 */
class PQIndex implements QuantizedIndex {
  private pq: ProductQuantizer
  private ids: string[] = []
  private codes: Uint8Array[] = []

  constructor(pq: ProductQuantizer) {
    this.pq = pq
  }

  insert(id: string, vector: Float32Array): void {
    const codes = this.pq.encode(vector)
    this.ids.push(id)
    this.codes.push(codes)
  }

  search(
    query: Float32Array,
    options?: { k?: number }
  ): Array<{ id: string; score: number }> {
    const k = options?.k ?? 10

    // Compute lookup table
    const lookupTable = this.pq.computeDistanceTable(query)

    // Compute distances
    const distances = this.pq.batchAsymmetricDistance(this.codes, lookupTable)

    // Find top-k (smaller distance is better)
    const scored = this.ids.map((id, i) => ({
      id,
      score: -distances[i]!, // Negative so higher is better
    }))

    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, k)
  }

  size(): number {
    return this.ids.length
  }

  memoryUsage(): number {
    // Codes: numSubvectors bytes per vector
    // IDs: rough estimate of 20 bytes per string
    const codesBytes = this.codes.length * this.pq.numSubvectors()
    const idsBytes = this.ids.length * 20
    return codesBytes + idsBytes
  }
}

// ============================================================================
// SCALAR QUANTIZATION
// ============================================================================

/**
 * ScalarQuantizer - Simple per-dimension vector quantization to int8.
 *
 * Scalar quantization is simpler than PQ but provides less compression.
 * It learns min/max bounds per dimension and maps float32 to int8.
 *
 * ## Advantages over PQ
 *
 * - Simpler training (just min/max, no k-means)
 * - Better accuracy for same query latency
 * - Direct arithmetic for distance computation
 *
 * ## Disadvantages
 *
 * - Lower compression (4x vs 64x)
 * - Higher memory per vector
 *
 * @example
 * ```typescript
 * const sq = new ScalarQuantizer({ dimensions: 768 })
 *
 * await sq.train(trainingVectors)
 * const quantized = sq.quantize(vector)  // Int8Array of 768 values
 * const reconstructed = sq.dequantize(quantized)
 * ```
 */
export class ScalarQuantizer {
  private config: Required<SQConfig>
  private mins: Float32Array | null = null
  private scales: Float32Array | null = null
  private _isTrained = false

  constructor(config: SQConfig) {
    this.config = {
      dimensions: config.dimensions,
      bits: config.bits ?? 8,
    }
  }

  // ============================================================================
  // TRAINING
  // ============================================================================

  /**
   * Train min/max bounds from data
   */
  async train(vectors: Float32Array[]): Promise<void> {
    const dim = this.config.dimensions

    // Find min/max per dimension
    this.mins = new Float32Array(dim).fill(Infinity)
    const maxs = new Float32Array(dim).fill(-Infinity)

    for (const v of vectors) {
      for (let d = 0; d < dim; d++) {
        if (v[d]! < this.mins[d]!) this.mins[d] = v[d]!
        if (v[d]! > maxs[d]!) maxs[d] = v[d]!
      }
    }

    // Calculate scales
    this.scales = new Float32Array(dim)
    const range = Math.pow(2, this.config.bits) - 1 // 255 for 8 bits

    for (let d = 0; d < dim; d++) {
      const diff = maxs[d]! - this.mins[d]!
      this.scales[d] = diff > 0 ? range / diff : 1
    }

    this._isTrained = true
  }

  isTrained(): boolean {
    return this._isTrained
  }

  // ============================================================================
  // QUANTIZATION
  // ============================================================================

  /**
   * Quantize float32 to int8
   */
  quantize(vector: Float32Array): Int8Array {
    const dim = this.config.dimensions
    const result = new Int8Array(dim)

    // Default bounds if not trained
    const mins = this.mins ?? new Float32Array(dim).fill(-1)
    const scales = this.scales ?? new Float32Array(dim).fill(127)

    for (let d = 0; d < dim; d++) {
      // Scale to 0-255 range, then shift to -128 to 127
      const scaled = (vector[d]! - mins[d]!) * scales[d]!
      result[d] = Math.round(Math.max(-128, Math.min(127, scaled - 128)))
    }

    return result
  }

  /**
   * Batch quantize
   */
  quantizeBatch(vectors: Float32Array[]): Int8Array[] {
    return vectors.map((v) => this.quantize(v))
  }

  /**
   * Dequantize int8 back to float32
   */
  dequantize(quantized: Int8Array): Float32Array {
    const dim = this.config.dimensions
    const result = new Float32Array(dim)

    const mins = this.mins ?? new Float32Array(dim).fill(-1)
    const scales = this.scales ?? new Float32Array(dim).fill(127)

    for (let d = 0; d < dim; d++) {
      // Reverse the quantization
      result[d] = (quantized[d]! + 128) / scales[d]! + mins[d]!
    }

    return result
  }

  // ============================================================================
  // DISTANCE COMPUTATION
  // ============================================================================

  /**
   * Compute dot product on int8 vectors
   */
  dotProduct(a: Int8Array, b: Int8Array): number {
    let dot = 0
    for (let i = 0; i < a.length; i++) {
      dot += a[i]! * b[i]!
    }
    return dot
  }

  // ============================================================================
  // INDEX CREATION
  // ============================================================================

  /**
   * Create a scalar quantized index
   */
  createIndex(): QuantizedIndex {
    return new SQIndex(this)
  }
}

/**
 * SQ-based Index
 */
class SQIndex implements QuantizedIndex {
  private sq: ScalarQuantizer
  private ids: string[] = []
  private vectors: Int8Array[] = []

  constructor(sq: ScalarQuantizer) {
    this.sq = sq
  }

  insert(id: string, vector: Float32Array): void {
    const quantized = this.sq.quantize(vector)
    this.ids.push(id)
    this.vectors.push(quantized)
  }

  search(
    query: Float32Array,
    options?: { k?: number }
  ): Array<{ id: string; score: number }> {
    const k = options?.k ?? 10
    const quantizedQuery = this.sq.quantize(query)

    // Compute dot products
    const scored = this.ids.map((id, i) => ({
      id,
      score: this.sq.dotProduct(quantizedQuery, this.vectors[i]!),
    }))

    // Sort by score descending (higher dot product = more similar)
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, k)
  }

  size(): number {
    return this.ids.length
  }

  memoryUsage(): number {
    // Vectors: 1 byte per dimension
    // IDs: rough estimate of 20 bytes per string
    const vectorBytes = this.vectors.length * (this.vectors[0]?.length ?? 0)
    const idsBytes = this.ids.length * 20
    return vectorBytes + idsBytes
  }
}
