/**
 * Product Quantization (PQ) - Vector Compression for Scalable Similarity Search
 *
 * Product Quantization is a technique for compressing high-dimensional vectors
 * while preserving distance relationships. It works by:
 *
 * 1. Splitting D-dimensional vectors into M subvectors of D/M dimensions each
 * 2. Training K centroids per subvector using k-means clustering
 * 3. Encoding vectors as M indices (one per subvector) into the codebook
 * 4. Computing distances efficiently using precomputed lookup tables (ADC)
 *
 * Compression ratio: D * 4 bytes (float32) -> M bytes (uint8 codes)
 * Example: 768-dim float32 (3072 bytes) -> 48 uint8 codes (48 bytes) = 64x compression
 *
 * @module db/edgevec/pq
 */

import type { PQCodebook } from '../../types/vector'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Options for training a PQ codebook
 */
export interface TrainPQOptions {
  /** Number of subquantizers (M) - vector will be split into M parts */
  numSubquantizers: number
  /** Number of centroids per subquantizer (K) - typically 256 for 8-bit codes */
  numCentroids: number
  /** Maximum number of k-means iterations (default: 25) */
  maxIterations?: number
  /** Convergence threshold for k-means (default: 1e-4) */
  tolerance?: number
  /** Random seed for reproducibility */
  seed?: number
}

/**
 * Memory statistics for PQ compression
 */
export interface MemoryStats {
  /** Original size in bytes (float32 vectors) */
  originalBytes: number
  /** Compressed size in bytes (uint8 codes) */
  compressedBytes: number
  /** Bytes saved by compression */
  savedBytes: number
  /** Compression ratio (original / compressed) */
  compressionRatio: number
}

// ============================================================================
// K-MEANS CLUSTERING
// ============================================================================

/**
 * Initialize k-means centroids using k-means++ algorithm
 */
function initializeCentroidsKMeansPlusPlus(
  data: Float32Array[],
  k: number,
  seed?: number
): Float32Array[] {
  const n = data.length
  const dim = data[0]!.length
  const centroids: Float32Array[] = []

  // Simple seeded random (for reproducibility)
  let randomState = seed ?? Math.floor(Math.random() * 2147483647)
  const random = () => {
    randomState = (randomState * 1103515245 + 12345) & 0x7fffffff
    return randomState / 0x7fffffff
  }

  // Pick first centroid randomly
  const firstIdx = Math.floor(random() * n)
  centroids.push(new Float32Array(data[firstIdx]!))

  // Pick remaining centroids with probability proportional to squared distance
  const minDistances = new Float32Array(n).fill(Infinity)

  for (let c = 1; c < k; c++) {
    // Update minimum distances to nearest centroid
    let totalDist = 0
    for (let i = 0; i < n; i++) {
      const dist = squaredL2Distance(data[i]!, centroids[c - 1]!)
      if (dist < minDistances[i]!) {
        minDistances[i] = dist
      }
      totalDist += minDistances[i]!
    }

    // Sample next centroid with probability proportional to distance^2
    let target = random() * totalDist
    let nextIdx = 0
    for (let i = 0; i < n; i++) {
      target -= minDistances[i]!
      if (target <= 0) {
        nextIdx = i
        break
      }
    }

    centroids.push(new Float32Array(data[nextIdx]!))
  }

  return centroids
}

/**
 * Compute squared L2 distance between two vectors
 */
function squaredL2Distance(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const diff = a[i]! - b[i]!
    sum += diff * diff
  }
  return sum
}

/**
 * Find the index of the nearest centroid
 */
function findNearestCentroid(vector: Float32Array, centroids: Float32Array[]): number {
  let minDist = Infinity
  let minIdx = 0

  for (let i = 0; i < centroids.length; i++) {
    const dist = squaredL2Distance(vector, centroids[i]!)
    if (dist < minDist) {
      minDist = dist
      minIdx = i
    }
  }

  return minIdx
}

/**
 * Run k-means clustering on a set of vectors
 */
function kMeans(
  data: Float32Array[],
  k: number,
  maxIterations: number = 25,
  tolerance: number = 1e-4,
  seed?: number
): Float32Array[] {
  const n = data.length
  const dim = data[0]!.length

  // Handle case where we have fewer data points than centroids
  if (n <= k) {
    // Just use all data points as centroids, padding with random if needed
    const centroids: Float32Array[] = []
    for (let i = 0; i < k; i++) {
      centroids.push(new Float32Array(data[i % n]!))
    }
    return centroids
  }

  // Initialize centroids using k-means++
  let centroids = initializeCentroidsKMeansPlusPlus(data, k, seed)

  const assignments = new Int32Array(n)
  const counts = new Int32Array(k)

  for (let iter = 0; iter < maxIterations; iter++) {
    // Assignment step: assign each point to nearest centroid
    counts.fill(0)
    for (let i = 0; i < n; i++) {
      assignments[i] = findNearestCentroid(data[i]!, centroids)
      counts[assignments[i]!]!++
    }

    // Update step: recompute centroids
    const newCentroids: Float32Array[] = Array.from({ length: k }, () => new Float32Array(dim))

    for (let i = 0; i < n; i++) {
      const c = assignments[i]!
      for (let d = 0; d < dim; d++) {
        newCentroids[c]![d]! += data[i]![d]!
      }
    }

    // Average and handle empty clusters
    let maxDelta = 0
    for (let c = 0; c < k; c++) {
      if (counts[c]! > 0) {
        for (let d = 0; d < dim; d++) {
          newCentroids[c]![d]! /= counts[c]!
        }
      } else {
        // Reinitialize empty cluster with a random point
        const randomIdx = Math.floor(Math.random() * n)
        newCentroids[c]!.set(data[randomIdx]!)
      }

      // Compute change
      const delta = squaredL2Distance(centroids[c]!, newCentroids[c]!)
      if (delta > maxDelta) {
        maxDelta = delta
      }
    }

    centroids = newCentroids

    // Check convergence
    if (maxDelta < tolerance) {
      break
    }
  }

  return centroids
}

// ============================================================================
// CODEBOOK TRAINING
// ============================================================================

/**
 * Train a PQ codebook from training vectors
 *
 * @param vectors - Training vectors (should have at least numCentroids vectors)
 * @param options - Training options
 * @returns Trained PQ codebook
 */
export async function trainPQCodebook(
  vectors: Float32Array[],
  options: TrainPQOptions
): Promise<PQCodebook> {
  const { numSubquantizers: M, numCentroids: K, maxIterations = 25, tolerance = 1e-4, seed } = options

  if (vectors.length === 0) {
    throw new Error('Cannot train codebook with empty vectors')
  }

  const dimensions = vectors[0]!.length

  // Validate dimensions are divisible by M
  if (dimensions % M !== 0) {
    throw new Error(
      `Vector dimension (${dimensions}) must be divisible by numSubquantizers (${M})`
    )
  }

  // Validate sufficient training vectors
  const minTrainingVectors = K
  if (vectors.length < minTrainingVectors) {
    throw new Error(
      `Insufficient training vectors: got ${vectors.length}, need at least ${minTrainingVectors}`
    )
  }

  const subvectorDimension = dimensions / M

  // Extract subvectors for each subquantizer
  const subvectorSets: Float32Array[][] = Array.from({ length: M }, () => [])

  for (const vector of vectors) {
    for (let m = 0; m < M; m++) {
      const subvector = new Float32Array(subvectorDimension)
      for (let d = 0; d < subvectorDimension; d++) {
        subvector[d] = vector[m * subvectorDimension + d]!
      }
      subvectorSets[m]!.push(subvector)
    }
  }

  // Train k-means for each subquantizer
  const centroids: Float32Array[] = []

  for (let m = 0; m < M; m++) {
    const subvectorData = subvectorSets[m]!
    const clusterCentroids = kMeans(
      subvectorData,
      K,
      maxIterations,
      tolerance,
      seed !== undefined ? seed + m : undefined
    )

    // Pack centroids into a single Float32Array
    const packedCentroids = new Float32Array(K * subvectorDimension)
    for (let k = 0; k < K; k++) {
      packedCentroids.set(clusterCentroids[k]!, k * subvectorDimension)
    }

    centroids.push(packedCentroids)
  }

  return {
    numSubquantizers: M,
    numCentroids: K,
    subvectorDimension,
    centroids,
  }
}

// ============================================================================
// ENCODING / DECODING
// ============================================================================

/**
 * Encode a vector into PQ codes
 *
 * @param vector - Input vector to encode
 * @param codebook - Trained PQ codebook
 * @returns Uint8Array of M codes (one per subquantizer)
 */
export function encodePQ(vector: Float32Array, codebook: PQCodebook): Uint8Array {
  const { numSubquantizers: M, numCentroids: K, subvectorDimension: subDim } = codebook
  const expectedDim = M * subDim

  if (vector.length !== expectedDim) {
    throw new Error(
      `Vector dimension mismatch: expected ${expectedDim}, got ${vector.length}`
    )
  }

  const codes = new Uint8Array(M)

  for (let m = 0; m < M; m++) {
    // Extract subvector
    const subvector = vector.subarray(m * subDim, (m + 1) * subDim)

    // Find nearest centroid
    let minDist = Infinity
    let minIdx = 0

    for (let k = 0; k < K; k++) {
      let dist = 0
      const centroidOffset = k * subDim
      for (let d = 0; d < subDim; d++) {
        const diff = subvector[d]! - codebook.centroids[m]![centroidOffset + d]!
        dist += diff * diff
      }

      if (dist < minDist) {
        minDist = dist
        minIdx = k
      }
    }

    codes[m] = minIdx
  }

  return codes
}

/**
 * Decode PQ codes back to an approximate vector
 *
 * @param codes - PQ codes (M uint8 values)
 * @param codebook - Trained PQ codebook
 * @returns Reconstructed approximate vector
 */
export function decodePQ(codes: Uint8Array, codebook: PQCodebook): Float32Array {
  const { numSubquantizers: M, subvectorDimension: subDim } = codebook
  const dimensions = M * subDim
  const reconstructed = new Float32Array(dimensions)

  for (let m = 0; m < M; m++) {
    const centroidIdx = codes[m]!
    const centroidOffset = centroidIdx * subDim

    for (let d = 0; d < subDim; d++) {
      reconstructed[m * subDim + d] = codebook.centroids[m]![centroidOffset + d]!
    }
  }

  return reconstructed
}

// ============================================================================
// DISTANCE COMPUTATION
// ============================================================================

/**
 * Compute asymmetric distance between a query vector and PQ codes
 *
 * This computes the L2 distance between the exact query vector and the
 * approximate (quantized) database vector.
 *
 * @param query - Exact query vector
 * @param codes - PQ codes of the database vector
 * @param codebook - Trained PQ codebook
 * @returns L2 distance
 */
export function asymmetricDistance(
  query: Float32Array,
  codes: Uint8Array,
  codebook: PQCodebook
): number {
  const { numSubquantizers: M, subvectorDimension: subDim } = codebook
  let totalDist = 0

  for (let m = 0; m < M; m++) {
    const querySubvector = query.subarray(m * subDim, (m + 1) * subDim)
    const centroidIdx = codes[m]!
    const centroidOffset = centroidIdx * subDim

    for (let d = 0; d < subDim; d++) {
      const diff = querySubvector[d]! - codebook.centroids[m]![centroidOffset + d]!
      totalDist += diff * diff
    }
  }

  return Math.sqrt(totalDist)
}

/**
 * Compute symmetric distance between two sets of PQ codes
 *
 * Both vectors are quantized, so this computes the distance between
 * their approximate representations.
 *
 * @param codes1 - PQ codes of first vector
 * @param codes2 - PQ codes of second vector
 * @param codebook - Trained PQ codebook
 * @returns L2 distance between reconstructed vectors
 */
export function symmetricDistance(
  codes1: Uint8Array,
  codes2: Uint8Array,
  codebook: PQCodebook
): number {
  const { numSubquantizers: M, subvectorDimension: subDim } = codebook
  let totalDist = 0

  for (let m = 0; m < M; m++) {
    const centroid1Offset = codes1[m]! * subDim
    const centroid2Offset = codes2[m]! * subDim

    for (let d = 0; d < subDim; d++) {
      const diff = codebook.centroids[m]![centroid1Offset + d]! - codebook.centroids[m]![centroid2Offset + d]!
      totalDist += diff * diff
    }
  }

  return Math.sqrt(totalDist)
}

// ============================================================================
// SERIALIZATION
// ============================================================================

/**
 * Serialize a PQ codebook to an ArrayBuffer
 *
 * Format:
 * - Header (16 bytes):
 *   - Magic bytes: "PQCB" (4 bytes)
 *   - Version: uint32 (4 bytes)
 *   - numSubquantizers (M): uint32 (4 bytes)
 *   - numCentroids (K): uint32 (4 bytes)
 * - subvectorDimension: uint32 (4 bytes)
 * - Reserved: 12 bytes (total header: 32 bytes)
 * - Centroids data: M * K * subDim * 4 bytes (float32)
 *
 * @param codebook - PQ codebook to serialize
 * @returns ArrayBuffer containing serialized codebook
 */
export function serializeCodebook(codebook: PQCodebook): ArrayBuffer {
  const { numSubquantizers: M, numCentroids: K, subvectorDimension: subDim } = codebook

  const headerSize = 32
  const centroidsSize = M * K * subDim * 4
  const totalSize = headerSize + centroidsSize

  const buffer = new ArrayBuffer(totalSize)
  const view = new DataView(buffer)

  // Magic bytes "PQCB"
  view.setUint8(0, 0x50) // P
  view.setUint8(1, 0x51) // Q
  view.setUint8(2, 0x43) // C
  view.setUint8(3, 0x42) // B

  // Version
  view.setUint32(4, 1, true)

  // Parameters
  view.setUint32(8, M, true)
  view.setUint32(12, K, true)
  view.setUint32(16, subDim, true)

  // Reserved bytes (20-31) are already zero

  // Write centroids
  const float32View = new Float32Array(buffer, headerSize)
  let offset = 0

  for (let m = 0; m < M; m++) {
    float32View.set(codebook.centroids[m]!, offset)
    offset += K * subDim
  }

  return buffer
}

/**
 * Deserialize a PQ codebook from an ArrayBuffer
 *
 * @param buffer - ArrayBuffer containing serialized codebook
 * @returns Deserialized PQ codebook
 */
export function deserializeCodebook(buffer: ArrayBuffer): PQCodebook {
  const headerSize = 32
  const view = new DataView(buffer)

  // Verify magic bytes
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3))
  if (magic !== 'PQCB') {
    throw new Error(`Invalid codebook format: expected magic 'PQCB', got '${magic}'`)
  }

  // Read version
  const version = view.getUint32(4, true)
  if (version !== 1) {
    throw new Error(`Unsupported codebook version: ${version}`)
  }

  // Read parameters
  const M = view.getUint32(8, true)
  const K = view.getUint32(12, true)
  const subDim = view.getUint32(16, true)

  // Read centroids
  const float32View = new Float32Array(buffer, headerSize)
  const centroids: Float32Array[] = []

  let offset = 0
  for (let m = 0; m < M; m++) {
    const centroidData = new Float32Array(K * subDim)
    centroidData.set(float32View.subarray(offset, offset + K * subDim))
    centroids.push(centroidData)
    offset += K * subDim
  }

  return {
    numSubquantizers: M,
    numCentroids: K,
    subvectorDimension: subDim,
    centroids,
  }
}

// ============================================================================
// PRODUCT QUANTIZATION CLASS
// ============================================================================

/**
 * ProductQuantization - High-level class for PQ operations
 *
 * Provides methods for encoding, decoding, and computing distances
 * with a trained PQ codebook.
 */
export class ProductQuantization {
  readonly codebook: PQCodebook
  readonly dimensions: number

  constructor(codebook: PQCodebook) {
    this.codebook = codebook
    this.dimensions = codebook.numSubquantizers * codebook.subvectorDimension
  }

  /**
   * Split a vector into M subvectors
   */
  splitIntoSubvectors(vector: Float32Array): Float32Array[] {
    const { numSubquantizers: M, subvectorDimension: subDim } = this.codebook
    const subvectors: Float32Array[] = []

    for (let m = 0; m < M; m++) {
      const subvector = new Float32Array(subDim)
      for (let d = 0; d < subDim; d++) {
        subvector[d] = vector[m * subDim + d]!
      }
      subvectors.push(subvector)
    }

    return subvectors
  }

  /**
   * Encode a single vector
   */
  encode(vector: Float32Array): Uint8Array {
    return encodePQ(vector, this.codebook)
  }

  /**
   * Decode PQ codes to approximate vector
   */
  decode(codes: Uint8Array): Float32Array {
    return decodePQ(codes, this.codebook)
  }

  /**
   * Encode a batch of vectors
   */
  encodeBatch(vectors: Float32Array[]): Uint8Array[] {
    return vectors.map((v) => this.encode(v))
  }

  /**
   * Compute distance table for a query vector (ADC optimization)
   *
   * Precomputes the squared distance from each subvector of the query
   * to all centroids. This allows O(M) distance computation per database
   * vector instead of O(D).
   *
   * Table layout: M x K where table[m][k] = distance from query subvector m
   * to centroid k of subquantizer m.
   */
  computeDistanceTable(query: Float32Array): Float32Array[] {
    const { numSubquantizers: M, numCentroids: K, subvectorDimension: subDim } = this.codebook
    const table: Float32Array[] = []

    for (let m = 0; m < M; m++) {
      const distances = new Float32Array(K)
      const querySubvector = query.subarray(m * subDim, (m + 1) * subDim)

      for (let k = 0; k < K; k++) {
        let dist = 0
        const centroidOffset = k * subDim
        for (let d = 0; d < subDim; d++) {
          const diff = querySubvector[d]! - this.codebook.centroids[m]![centroidOffset + d]!
          dist += diff * diff
        }
        distances[k] = dist
      }

      table.push(distances)
    }

    return table
  }

  /**
   * Compute distance using precomputed distance table
   */
  distanceFromTable(table: Float32Array[], codes: Uint8Array): number {
    const M = this.codebook.numSubquantizers
    let totalDist = 0

    for (let m = 0; m < M; m++) {
      totalDist += table[m]![codes[m]!]!
    }

    return Math.sqrt(totalDist)
  }

  /**
   * Compute asymmetric distance
   */
  asymmetricDistance(query: Float32Array, codes: Uint8Array): number {
    return asymmetricDistance(query, codes, this.codebook)
  }

  /**
   * Compute symmetric distance
   */
  symmetricDistance(codes1: Uint8Array, codes2: Uint8Array): number {
    return symmetricDistance(codes1, codes2, this.codebook)
  }

  /**
   * Get compression ratio (original bytes / compressed bytes)
   */
  getCompressionRatio(): number {
    const originalBytes = this.dimensions * 4 // float32
    const compressedBytes = this.codebook.numSubquantizers // uint8 codes
    return originalBytes / compressedBytes
  }

  /**
   * Get memory statistics for a given number of vectors
   */
  getMemoryStats(vectorCount: number): MemoryStats {
    const originalBytes = vectorCount * this.dimensions * 4
    const compressedBytes = vectorCount * this.codebook.numSubquantizers
    return {
      originalBytes,
      compressedBytes,
      savedBytes: originalBytes - compressedBytes,
      compressionRatio: originalBytes / compressedBytes,
    }
  }

  /**
   * Get the serialized size of the codebook
   */
  getSerializedSize(): number {
    const headerSize = 32
    const { numSubquantizers: M, numCentroids: K, subvectorDimension: subDim } = this.codebook
    const centroidsSize = M * K * subDim * 4
    return headerSize + centroidsSize
  }
}

// ============================================================================
// PQ ENCODER CLASS
// ============================================================================

/**
 * PQEncoder - Wrapper class for convenient encoding/decoding
 *
 * Provides a simpler interface for basic PQ operations.
 */
export class PQEncoder {
  private pq: ProductQuantization

  constructor(codebook: PQCodebook) {
    this.pq = new ProductQuantization(codebook)
  }

  /** Number of dimensions in the original vectors */
  get dimensions(): number {
    return this.pq.dimensions
  }

  /** Number of subquantizers (M) */
  get numSubquantizers(): number {
    return this.pq.codebook.numSubquantizers
  }

  /** Size of encoded vector in bytes */
  get codeSize(): number {
    return this.pq.codebook.numSubquantizers
  }

  /**
   * Encode a vector to PQ codes
   */
  encode(vector: Float32Array): Uint8Array {
    return this.pq.encode(vector)
  }

  /**
   * Decode PQ codes to approximate vector
   */
  decode(codes: Uint8Array): Float32Array {
    return this.pq.decode(codes)
  }

  /**
   * Compute distance between query and encoded vector
   */
  distance(query: Float32Array, codes: Uint8Array): number {
    return this.pq.asymmetricDistance(query, codes)
  }
}
