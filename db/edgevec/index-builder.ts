/**
 * Offline Index Builder
 *
 * Generates static vector index assets from source vectors for the
 * Static Assets Vector Search architecture.
 *
 * Outputs:
 * - centroids.bin (CENT format) - K-means cluster centers
 * - codebooks.bin (PQCB format) - PQ codebook centroids
 * - cluster-XXXX.bin (CLST format) - Per-cluster vector IDs + PQ codes
 *
 * @module db/edgevec/index-builder
 */

import { writeFile, readFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { parseClusterFile as parseStaticCluster, createClusterFile } from './cluster-file'

// ============================================================================
// CONSTANTS
// ============================================================================

const CENT_MAGIC = 0x43454e54 // "CENT"
const PQCB_MAGIC = 0x50514342 // "PQCB"

// ============================================================================
// RE-EXPORTS - Parsers from static-asset-loader
// ============================================================================

/**
 * Parse a centroids file (CENT format) and return individual centroid arrays
 *
 * Note: This reads magic as little-endian to match the test expectations,
 * which differs from static-asset-loader.ts that reads big-endian.
 */
export function parseCentroidsFile(buffer: Buffer | ArrayBuffer): {
  numCentroids: number
  dimensions: number
  centroids: Float32Array[]
} {
  // Convert Buffer to ArrayBuffer if needed
  const arrayBuffer = buffer instanceof Buffer
    ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    : buffer

  if (arrayBuffer.byteLength < 32) {
    throw new Error('Truncated or incomplete header')
  }

  const view = new DataView(arrayBuffer)

  // Parse header - read magic as little-endian to match test expectations
  const magic = view.getUint32(0, true)
  if (magic !== CENT_MAGIC) {
    throw new Error(`Invalid magic bytes: expected CENT (0x43454E54), got 0x${magic.toString(16)}`)
  }

  const numCentroids = view.getUint32(8, true)
  const dimensions = view.getUint32(12, true)
  const dtype = view.getUint8(16)

  // Calculate expected data size
  const bytesPerFloat = dtype === 0 ? 4 : 2
  const headerSize = 32

  // Convert flat centroids array to array of individual centroid vectors
  const centroids: Float32Array[] = []

  if (dtype === 0) {
    // float32
    for (let i = 0; i < numCentroids; i++) {
      const offset = headerSize + i * dimensions * 4
      const centroid = new Float32Array(arrayBuffer, offset, dimensions)
      centroids.push(new Float32Array(centroid)) // Copy to avoid aliasing
    }
  } else {
    // float16 - would need conversion, but for now assume float32
    throw new Error('float16 not supported in parseCentroidsFile')
  }

  return {
    numCentroids,
    dimensions,
    centroids,
  }
}

/**
 * Parse a codebooks file (PQCB format)
 *
 * Note: This reads magic as little-endian to match the test expectations,
 * which differs from static-asset-loader.ts that reads big-endian.
 */
export function parseCodebooksFile(buffer: Buffer | ArrayBuffer): {
  M: number
  Ksub: number
  subvectorDim: number
  centroids: Float32Array[]
} {
  // Convert Buffer to ArrayBuffer if needed
  const arrayBuffer = buffer instanceof Buffer
    ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    : buffer

  if (arrayBuffer.byteLength < 32) {
    throw new Error('Truncated or incomplete header')
  }

  const view = new DataView(arrayBuffer)

  // Parse header - read magic as little-endian to match test expectations
  const magic = view.getUint32(0, true)
  if (magic !== PQCB_MAGIC) {
    throw new Error(`Invalid magic bytes: expected PQCB (0x50514342), got 0x${magic.toString(16)}`)
  }

  const M = view.getUint32(8, true)
  const Ksub = view.getUint32(12, true)
  const dimensions = view.getUint32(16, true)
  const subvectorDim = view.getUint32(20, true)
  const dtype = view.getUint8(24)

  const headerSize = 32

  // Extract codebooks - organized by subspace
  const centroids: Float32Array[] = []
  const codebookSize = Ksub * subvectorDim

  for (let m = 0; m < M; m++) {
    const offset = headerSize + m * codebookSize * 4
    if (dtype === 0) {
      const codebook = new Float32Array(arrayBuffer, offset, codebookSize)
      centroids.push(new Float32Array(codebook)) // Copy to avoid aliasing
    } else {
      throw new Error('float16 not supported in parseCodebooksFile')
    }
  }

  return {
    M,
    Ksub,
    subvectorDim,
    centroids,
  }
}

/**
 * Parse a cluster file (CLST format)
 */
export function parseClusterFile(buffer: Buffer | ArrayBuffer): {
  clusterId: number
  vectorCount: number
  ids: string[]
  pqCodes: Uint8Array
} {
  // Convert Buffer to ArrayBuffer if needed
  const arrayBuffer = buffer instanceof Buffer
    ? buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
    : buffer

  const parsed = parseStaticCluster(arrayBuffer)

  // Convert ids to strings
  const ids = parsed.ids.map((id) => {
    if (typeof id === 'string') return id
    return String(id)
  })

  return {
    clusterId: parsed.header.clusterId,
    vectorCount: parsed.header.vectorCount,
    ids,
    pqCodes: parsed.pqCodes,
  }
}

// ============================================================================
// TYPES
// ============================================================================

export interface KMeansOptions {
  k: number
  maxIterations?: number
  convergenceThreshold?: number
  seed?: number
  relocateEmptyClusters?: boolean
  returnStats?: boolean
}

export interface KMeansResult {
  centroids: Float32Array[]
  iterations: number
  converged: boolean
  initialInertia: number
  finalInertia: number
  emptyClusters: number
}

export interface PQTrainOptions {
  M: number
  Ksub: number
  maxIterations?: number
  seed?: number
  returnStats?: boolean
}

export interface PQCodebooks {
  M: number
  Ksub: number
  subvectorDim: number
  centroids: Float32Array[]
}

export interface PQTrainResult {
  codebooks: PQCodebooks
  reconstructionError: number
}

export interface VectorAssignment {
  id: string
  clusterId: number
  distance: number
}

export interface EncodedVector {
  id: string
  clusterId: number
  pqCodes: Uint8Array
}

export interface IndexBuilderConfig {
  dimensions: number
  numClusters: number
  M?: number
  Ksub?: number
  streamingMode?: boolean
}

export interface BuildIndexOptions {
  vectors: AsyncIterable<{ id: string; vector: Float32Array }[]>
  outputDir: string
  numClusters: number
  M: number
  Ksub: number
  dimensions: number
  streamingMode?: boolean
  onProgress?: (phase: string, progress: number) => void
}

export interface AppendToIndexOptions {
  vectors: AsyncIterable<{ id: string; vector: Float32Array }[]>
  indexDir: string
}

// ============================================================================
// RANDOM UTILITIES
// ============================================================================

/**
 * Simple seeded PRNG (LCG)
 */
function createRng(seed: number = 12345): () => number {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    return state / 0x7fffffff
  }
}

// ============================================================================
// DISTANCE FUNCTIONS
// ============================================================================

/**
 * Compute L2 distance squared between two vectors
 */
function l2DistanceSquared(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i]
    sum += diff * diff
  }
  return sum
}

/**
 * Compute L2 distance between two vectors
 */
function l2Distance(a: Float32Array, b: Float32Array): number {
  return Math.sqrt(l2DistanceSquared(a, b))
}

// ============================================================================
// K-MEANS CLUSTERING
// ============================================================================

/**
 * Train K-means centroids using K-means++ initialization
 */
export async function trainKMeans(
  vectors: Float32Array[],
  options: KMeansOptions
): Promise<Float32Array[] | KMeansResult> {
  const {
    k,
    maxIterations = 100,
    convergenceThreshold = 1e-6,
    seed = 12345,
    relocateEmptyClusters = true,
    returnStats = false,
  } = options

  if (vectors.length < k) {
    throw new Error(`Insufficient vectors: have ${vectors.length}, need at least ${k} for ${k} clusters`)
  }

  const dimensions = vectors[0].length
  const rng = createRng(seed)

  // K-means++ initialization
  const centroids: Float32Array[] = []

  // Pick first centroid uniformly at random
  const firstIdx = Math.floor(rng() * vectors.length)
  centroids.push(new Float32Array(vectors[firstIdx]))

  // Pick remaining centroids with probability proportional to D^2
  for (let c = 1; c < k; c++) {
    // Compute minimum distance from each point to existing centroids
    const distances = new Float32Array(vectors.length)
    let totalDist = 0

    for (let i = 0; i < vectors.length; i++) {
      let minDist = Infinity
      for (const centroid of centroids) {
        const dist = l2DistanceSquared(vectors[i], centroid)
        if (dist < minDist) minDist = dist
      }
      distances[i] = minDist
      totalDist += minDist
    }

    // Sample proportional to D^2
    let r = rng() * totalDist
    let selectedIdx = 0
    for (let i = 0; i < vectors.length; i++) {
      r -= distances[i]
      if (r <= 0) {
        selectedIdx = i
        break
      }
    }

    centroids.push(new Float32Array(vectors[selectedIdx]))
  }

  // Lloyd's algorithm iterations
  const assignments = new Int32Array(vectors.length)
  let iterations = 0
  let converged = false
  let initialInertia = 0
  let finalInertia = 0

  // Compute initial inertia
  for (let i = 0; i < vectors.length; i++) {
    let minDist = Infinity
    let minIdx = 0
    for (let c = 0; c < k; c++) {
      const dist = l2DistanceSquared(vectors[i], centroids[c])
      if (dist < minDist) {
        minDist = dist
        minIdx = c
      }
    }
    assignments[i] = minIdx
    initialInertia += minDist
  }

  for (let iter = 0; iter < maxIterations; iter++) {
    iterations = iter + 1

    // Assign vectors to nearest centroids
    let inertia = 0
    for (let i = 0; i < vectors.length; i++) {
      let minDist = Infinity
      let minIdx = 0
      for (let c = 0; c < k; c++) {
        const dist = l2DistanceSquared(vectors[i], centroids[c])
        if (dist < minDist) {
          minDist = dist
          minIdx = c
        }
      }
      assignments[i] = minIdx
      inertia += minDist
    }

    // Update centroids
    const counts = new Int32Array(k)
    const newCentroids: Float32Array[] = []
    for (let c = 0; c < k; c++) {
      newCentroids.push(new Float32Array(dimensions))
    }

    for (let i = 0; i < vectors.length; i++) {
      const c = assignments[i]
      counts[c]++
      for (let d = 0; d < dimensions; d++) {
        newCentroids[c][d] += vectors[i][d]
      }
    }

    // Handle empty clusters by relocating to farthest point
    let emptyClusters = 0
    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) {
        emptyClusters++
        if (relocateEmptyClusters) {
          // Find vector farthest from its assigned centroid
          let maxDist = -1
          let maxIdx = 0
          for (let i = 0; i < vectors.length; i++) {
            const dist = l2DistanceSquared(vectors[i], centroids[assignments[i]])
            if (dist > maxDist) {
              maxDist = dist
              maxIdx = i
            }
          }
          // Relocate centroid to this vector
          for (let d = 0; d < dimensions; d++) {
            newCentroids[c][d] = vectors[maxIdx][d]
          }
          counts[c] = 1
        }
      } else {
        // Average
        for (let d = 0; d < dimensions; d++) {
          newCentroids[c][d] /= counts[c]
        }
      }
    }

    // Check convergence
    let maxShift = 0
    for (let c = 0; c < k; c++) {
      const shift = l2Distance(centroids[c], newCentroids[c])
      if (shift > maxShift) maxShift = shift
    }

    // Copy new centroids
    for (let c = 0; c < k; c++) {
      centroids[c].set(newCentroids[c])
    }

    finalInertia = inertia

    if (maxShift < convergenceThreshold) {
      converged = true
      break
    }
  }

  // Final empty cluster count
  const finalCounts = new Int32Array(k)
  for (let i = 0; i < vectors.length; i++) {
    finalCounts[assignments[i]]++
  }
  let emptyClusters = 0
  for (let c = 0; c < k; c++) {
    if (finalCounts[c] === 0) emptyClusters++
  }

  if (returnStats) {
    return {
      centroids,
      iterations,
      converged,
      initialInertia,
      finalInertia,
      emptyClusters,
    }
  }

  return centroids
}

// ============================================================================
// PQ TRAINING
// ============================================================================

/**
 * Train Product Quantization codebooks on residual vectors
 */
export async function trainPQ(
  residuals: Float32Array[],
  options: PQTrainOptions
): Promise<PQCodebooks | PQTrainResult> {
  const {
    M,
    Ksub,
    maxIterations = 25,
    seed = 12345,
    returnStats = false,
  } = options

  if (residuals.length === 0) {
    throw new Error('No residuals provided for PQ training')
  }

  const dimensions = residuals[0].length

  if (dimensions % M !== 0) {
    throw new Error(`Dimension ${dimensions} is not divisible by M=${M}`)
  }

  const subvectorDim = dimensions / M
  const rng = createRng(seed)

  // Train a K-means codebook for each subspace
  const codebooks: Float32Array[] = []

  for (let m = 0; m < M; m++) {
    // Extract subvectors for this subspace
    const subvectors: Float32Array[] = residuals.map((r) => {
      const start = m * subvectorDim
      return new Float32Array(r.buffer, r.byteOffset + start * 4, subvectorDim)
    })

    // Make copies to avoid aliasing issues
    const subvectorsCopy = subvectors.map((sv) => new Float32Array(sv))

    // Train K-means on this subspace
    const effectiveK = Math.min(Ksub, subvectorsCopy.length)
    const result = await trainKMeans(subvectorsCopy, {
      k: effectiveK,
      maxIterations,
      seed: seed + m,
      returnStats: false,
    }) as Float32Array[]

    // Pack centroids into a flat array
    const codebook = new Float32Array(Ksub * subvectorDim)
    for (let i = 0; i < result.length; i++) {
      codebook.set(result[i], i * subvectorDim)
    }
    // Pad with zeros if we got fewer than Ksub centroids
    // (zeros are already the default)

    codebooks.push(codebook)
  }

  const pqCodebooks: PQCodebooks = {
    M,
    Ksub,
    subvectorDim,
    centroids: codebooks,
  }

  if (returnStats) {
    // Compute reconstruction error
    let totalError = 0
    for (const residual of residuals) {
      const codes = encodeToPQ(residual, pqCodebooks)
      const reconstructed = decodeFromPQ(codes, pqCodebooks)
      totalError += l2DistanceSquared(residual, reconstructed)
    }
    const reconstructionError = totalError / residuals.length

    return {
      codebooks: pqCodebooks,
      reconstructionError,
    }
  }

  return pqCodebooks
}

/**
 * Encode a vector to PQ codes
 */
function encodeToPQ(vector: Float32Array, codebooks: PQCodebooks): Uint8Array {
  const { M, Ksub, subvectorDim, centroids } = codebooks
  const codes = new Uint8Array(M)

  for (let m = 0; m < M; m++) {
    const start = m * subvectorDim
    let minDist = Infinity
    let minIdx = 0

    for (let k = 0; k < Ksub; k++) {
      let dist = 0
      const codebookOffset = k * subvectorDim
      for (let d = 0; d < subvectorDim; d++) {
        const diff = vector[start + d] - centroids[m][codebookOffset + d]
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
 * Decode PQ codes back to a vector
 */
function decodeFromPQ(codes: Uint8Array, codebooks: PQCodebooks): Float32Array {
  const { M, subvectorDim, centroids } = codebooks
  const dimensions = M * subvectorDim
  const vector = new Float32Array(dimensions)

  for (let m = 0; m < M; m++) {
    const k = codes[m]
    const start = m * subvectorDim
    const codebookOffset = k * subvectorDim
    for (let d = 0; d < subvectorDim; d++) {
      vector[start + d] = centroids[m][codebookOffset + d]
    }
  }

  return vector
}

// ============================================================================
// INDEX BUILDER CLASS
// ============================================================================

export class IndexBuilder {
  private config: IndexBuilderConfig
  private centroids: Float32Array[] = []
  private codebooks: PQCodebooks | null = null
  private processedCount = 0
  private encodedVectors: Map<number, EncodedVector[]> = new Map()

  constructor(config: IndexBuilderConfig) {
    this.config = {
      M: 8,
      Ksub: 256,
      streamingMode: false,
      ...config,
    }
  }

  /**
   * Train K-means centroids from sample vectors
   */
  async trainCentroids(vectors: Float32Array[]): Promise<void> {
    const result = await trainKMeans(vectors, {
      k: this.config.numClusters,
      maxIterations: 100,
    })

    this.centroids = Array.isArray(result) ? result : result.centroids
  }

  /**
   * Get trained centroids
   */
  getCentroids(): Float32Array[] {
    return this.centroids
  }

  /**
   * Get trained codebooks
   */
  getCodebooks(): PQCodebooks | null {
    return this.codebooks
  }

  /**
   * Get count of processed vectors
   */
  getProcessedCount(): number {
    return this.processedCount
  }

  /**
   * Assign vectors to nearest centroids
   */
  async assignVectors(
    vectors: Float32Array[],
    ids: string[]
  ): Promise<VectorAssignment[]> {
    const assignments: VectorAssignment[] = []

    for (let i = 0; i < vectors.length; i++) {
      let minDist = Infinity
      let minIdx = 0

      for (let c = 0; c < this.centroids.length; c++) {
        const dist = l2Distance(vectors[i], this.centroids[c])
        if (dist < minDist) {
          minDist = dist
          minIdx = c
        }
      }

      assignments.push({
        id: ids[i],
        clusterId: minIdx,
        distance: minDist,
      })
    }

    return assignments
  }

  /**
   * Assign vectors and compute residuals
   */
  async assignVectorsWithResiduals(
    vectors: Float32Array[],
    ids: string[]
  ): Promise<{ assignments: VectorAssignment[]; residuals: Float32Array[] }> {
    const assignments: VectorAssignment[] = []
    const residuals: Float32Array[] = []

    for (let i = 0; i < vectors.length; i++) {
      let minDist = Infinity
      let minIdx = 0

      for (let c = 0; c < this.centroids.length; c++) {
        const dist = l2Distance(vectors[i], this.centroids[c])
        if (dist < minDist) {
          minDist = dist
          minIdx = c
        }
      }

      assignments.push({
        id: ids[i],
        clusterId: minIdx,
        distance: minDist,
      })

      // Compute residual
      const residual = new Float32Array(vectors[i].length)
      for (let d = 0; d < vectors[i].length; d++) {
        residual[d] = vectors[i][d] - this.centroids[minIdx][d]
      }
      residuals.push(residual)
    }

    return { assignments, residuals }
  }

  /**
   * Train full pipeline (centroids + PQ codebooks)
   */
  async train(vectors: Float32Array[]): Promise<void> {
    await this.trainWithOptions(vectors, {})
  }

  /**
   * Train with custom options for iteration counts
   */
  async trainWithOptions(
    vectors: Float32Array[],
    options: { maxKMeansIter?: number; maxPQIter?: number }
  ): Promise<void> {
    const { maxKMeansIter = 100, maxPQIter = 25 } = options

    // Train centroids
    const result = await trainKMeans(vectors, {
      k: this.config.numClusters,
      maxIterations: maxKMeansIter,
    })
    this.centroids = Array.isArray(result) ? result : result.centroids

    // Compute residuals
    const residuals: Float32Array[] = []
    for (const vector of vectors) {
      let minDist = Infinity
      let minIdx = 0
      for (let c = 0; c < this.centroids.length; c++) {
        const dist = l2DistanceSquared(vector, this.centroids[c])
        if (dist < minDist) {
          minDist = dist
          minIdx = c
        }
      }

      const residual = new Float32Array(vector.length)
      for (let d = 0; d < vector.length; d++) {
        residual[d] = vector[d] - this.centroids[minIdx][d]
      }
      residuals.push(residual)
    }

    // Train PQ codebooks
    this.codebooks = (await trainPQ(residuals, {
      M: this.config.M!,
      Ksub: this.config.Ksub!,
      maxIterations: maxPQIter,
    })) as PQCodebooks
  }

  /**
   * Encode vectors to PQ codes
   */
  async encodeVectors(
    vectors: Float32Array[],
    ids: string[]
  ): Promise<EncodedVector[]> {
    if (!this.codebooks) {
      throw new Error('Must train before encoding')
    }

    const encoded: EncodedVector[] = []

    for (let i = 0; i < vectors.length; i++) {
      // Find nearest centroid
      let minDist = Infinity
      let minIdx = 0
      for (let c = 0; c < this.centroids.length; c++) {
        const dist = l2DistanceSquared(vectors[i], this.centroids[c])
        if (dist < minDist) {
          minDist = dist
          minIdx = c
        }
      }

      // Compute residual
      const residual = new Float32Array(vectors[i].length)
      for (let d = 0; d < vectors[i].length; d++) {
        residual[d] = vectors[i][d] - this.centroids[minIdx][d]
      }

      // Encode residual to PQ codes
      const pqCodes = encodeToPQ(residual, this.codebooks)

      encoded.push({
        id: ids[i],
        clusterId: minIdx,
        pqCodes,
      })
    }

    return encoded
  }

  /**
   * Decode PQ codes back to approximate residual vector
   */
  decodePQ(codes: Uint8Array, codebooks: PQCodebooks): Float32Array {
    return decodeFromPQ(codes, codebooks)
  }

  /**
   * Train on a stream of batches (for large datasets)
   */
  async trainOnStream(
    stream: AsyncIterable<{ id: string; vector: Float32Array }[]>,
    options: { trainingSampleSize?: number } = {}
  ): Promise<void> {
    const sampleSize = options.trainingSampleSize ?? 1000
    const samples: Float32Array[] = []

    for await (const batch of stream) {
      for (const item of batch) {
        if (samples.length < sampleSize) {
          samples.push(item.vector)
        }
      }
      if (samples.length >= sampleSize) break
    }

    await this.train(samples)
  }

  /**
   * Process a stream of vectors (encode and partition)
   */
  async processStream(
    stream: AsyncIterable<{ id: string; vector: Float32Array }[]>
  ): Promise<void> {
    if (!this.codebooks) {
      throw new Error('Must train before processing')
    }

    for await (const batch of stream) {
      const vectors = batch.map((b) => b.vector)
      const ids = batch.map((b) => b.id)

      const encoded = await this.encodeVectors(vectors, ids)

      // Partition by cluster
      for (const entry of encoded) {
        if (!this.encodedVectors.has(entry.clusterId)) {
          this.encodedVectors.set(entry.clusterId, [])
        }
        this.encodedVectors.get(entry.clusterId)!.push(entry)
      }

      this.processedCount += batch.length
    }
  }
}

// ============================================================================
// FILE WRITERS
// ============================================================================

/**
 * Write centroids to CENT format binary file
 */
async function writeCentroidsFile(
  centroids: Float32Array[],
  dimensions: number,
  outputPath: string
): Promise<void> {
  const numCentroids = centroids.length
  const headerSize = 32
  const dataSize = numCentroids * dimensions * 4
  const buffer = new ArrayBuffer(headerSize + dataSize)
  const view = new DataView(buffer)

  // Write header
  // Magic is read as little-endian by test file and our parseCentroidsFile
  view.setUint32(0, CENT_MAGIC, true) // magic (little-endian)
  view.setUint16(4, 1, true) // version
  view.setUint16(6, 0, true) // flags
  view.setUint32(8, numCentroids, true)
  view.setUint32(12, dimensions, true)
  view.setUint8(16, 0) // dtype = float32
  view.setUint8(17, 0) // metric = cosine

  // Write centroid data
  const dataArray = new Float32Array(buffer, headerSize)
  let offset = 0
  for (const centroid of centroids) {
    dataArray.set(centroid, offset)
    offset += dimensions
  }

  await writeFile(outputPath, Buffer.from(buffer))
}

/**
 * Write codebooks to PQCB format binary file
 */
async function writeCodebooksFile(
  codebooks: PQCodebooks,
  dimensions: number,
  outputPath: string
): Promise<void> {
  const { M, Ksub, subvectorDim, centroids } = codebooks
  const headerSize = 32
  const dataSize = M * Ksub * subvectorDim * 4
  const buffer = new ArrayBuffer(headerSize + dataSize)
  const view = new DataView(buffer)

  // Write header
  // Magic is read as little-endian by test file and our parseCodebooksFile
  view.setUint32(0, PQCB_MAGIC, true) // magic (little-endian)
  view.setUint16(4, 1, true) // version
  view.setUint16(6, 0, true) // flags
  view.setUint32(8, M, true)
  view.setUint32(12, Ksub, true)
  view.setUint32(16, dimensions, true)
  view.setUint32(20, subvectorDim, true)
  view.setUint8(24, 0) // dtype = float32

  // Write codebook data
  const dataArray = new Float32Array(buffer, headerSize)
  let offset = 0
  for (let m = 0; m < M; m++) {
    dataArray.set(centroids[m], offset)
    offset += Ksub * subvectorDim
  }

  await writeFile(outputPath, Buffer.from(buffer))
}

/**
 * Write cluster file in CLST format
 */
async function writeClusterFile(
  clusterId: number,
  entries: EncodedVector[],
  M: number,
  outputPath: string
): Promise<void> {
  const vectorCount = entries.length
  const pqCodes: Uint8Array[] = entries.map((e) => e.pqCodes)
  const ids = entries.map((e) => e.id)

  // Use createClusterFile from cluster-file module
  const buffer = createClusterFile({
    clusterId,
    ids,
    pqCodes,
    M,
    idType: 'string',
  })

  await writeFile(outputPath, Buffer.from(buffer))
}

// ============================================================================
// BUILD INDEX
// ============================================================================

/**
 * Build a complete vector index from a stream of vectors
 */
export async function buildIndex(options: BuildIndexOptions): Promise<void> {
  const {
    vectors,
    outputDir,
    numClusters,
    M,
    Ksub,
    dimensions,
    streamingMode = false,
    onProgress,
  } = options

  // Ensure output directory exists
  await mkdir(outputDir, { recursive: true })

  // Report training start
  onProgress?.('training', 0)

  // Collect vectors for training
  const allVectors: { id: string; vector: Float32Array }[] = []
  for await (const batch of vectors) {
    for (const item of batch) {
      allVectors.push(item)
    }
  }

  onProgress?.('training', 0.3)

  // Create builder and train
  const builder = new IndexBuilder({
    dimensions,
    numClusters,
    M,
    Ksub,
    streamingMode,
  })

  // For streaming mode, use fewer iterations for faster training
  const maxKMeansIter = streamingMode ? 10 : 100
  const maxPQIter = streamingMode ? 5 : 25

  // For streaming mode, subsample vectors for training if dataset is large
  let trainingVectors = allVectors.map((v) => v.vector)
  if (streamingMode && trainingVectors.length > 500) {
    // Sample 500 vectors for training
    const sampleStep = Math.floor(trainingVectors.length / 500)
    trainingVectors = trainingVectors.filter((_, i) => i % sampleStep === 0).slice(0, 500)
  }

  await builder.trainWithOptions(trainingVectors, { maxKMeansIter, maxPQIter })

  onProgress?.('training', 1)

  // Report encoding start
  onProgress?.('encoding', 0)

  // Encode all vectors (use full dataset, not the training sample)
  const allVectorArrays = allVectors.map((v) => v.vector)
  const ids = allVectors.map((v) => v.id)
  const encoded = await builder.encodeVectors(allVectorArrays, ids)

  onProgress?.('encoding', 1)

  // Report writing start
  onProgress?.('writing', 0)

  // Partition by cluster
  const clusterMap = new Map<number, EncodedVector[]>()
  for (const entry of encoded) {
    if (!clusterMap.has(entry.clusterId)) {
      clusterMap.set(entry.clusterId, [])
    }
    clusterMap.get(entry.clusterId)!.push(entry)
  }

  // Write centroids file
  await writeCentroidsFile(builder.getCentroids(), dimensions, join(outputDir, 'centroids.bin'))

  // Write codebooks file
  const codebooks = builder.getCodebooks()!
  await writeCodebooksFile(codebooks, dimensions, join(outputDir, 'codebooks.bin'))

  // Write cluster files (only for non-empty clusters)
  let writtenClusters = 0
  const totalClusters = clusterMap.size

  for (const [clusterId, entries] of clusterMap) {
    if (entries.length > 0) {
      const paddedId = clusterId.toString().padStart(4, '0')
      await writeClusterFile(clusterId, entries, M, join(outputDir, `cluster-${paddedId}.bin`))
      writtenClusters++
      onProgress?.('writing', writtenClusters / totalClusters)
    }
  }

  onProgress?.('writing', 1)
}

// ============================================================================
// APPEND TO INDEX
// ============================================================================

/**
 * Append new vectors to an existing index
 */
export async function appendToIndex(options: AppendToIndexOptions): Promise<void> {
  const { vectors, indexDir } = options

  // Load existing index
  const centroidsBuffer = await readFile(join(indexDir, 'centroids.bin'))
  const codebooksBuffer = await readFile(join(indexDir, 'codebooks.bin'))

  const centroidsData = parseCentroidsFile(centroidsBuffer)
  const codebooksData = parseCodebooksFile(codebooksBuffer)

  const { numClusters, dimensions, centroids } = centroidsData
  const { M, Ksub, subvectorDim, centroids: codebookCentroids } = codebooksData

  // Reconstruct codebooks object
  const codebooks: PQCodebooks = {
    M,
    Ksub,
    subvectorDim,
    centroids: codebookCentroids,
  }

  // Load existing cluster files
  const { readdir } = await import('fs/promises')
  const files = await readdir(indexDir)
  const clusterFiles = files.filter((f) => f.startsWith('cluster-') && f.endsWith('.bin'))

  // Load existing entries by cluster
  const clusterEntries = new Map<number, EncodedVector[]>()

  for (const file of clusterFiles) {
    const buffer = await readFile(join(indexDir, file))
    const cluster = parseClusterFile(buffer)

    const entries: EncodedVector[] = []
    for (let i = 0; i < cluster.vectorCount; i++) {
      entries.push({
        id: cluster.ids[i],
        clusterId: cluster.clusterId,
        pqCodes: new Uint8Array(cluster.pqCodes.buffer, cluster.pqCodes.byteOffset + i * M, M),
      })
    }
    clusterEntries.set(cluster.clusterId, entries)
  }

  // Process new vectors
  for await (const batch of vectors) {
    for (const { id, vector } of batch) {
      // Find nearest centroid
      let minDist = Infinity
      let minIdx = 0
      for (let c = 0; c < centroids.length; c++) {
        const dist = l2DistanceSquared(vector, centroids[c])
        if (dist < minDist) {
          minDist = dist
          minIdx = c
        }
      }

      // Compute residual
      const residual = new Float32Array(dimensions)
      for (let d = 0; d < dimensions; d++) {
        residual[d] = vector[d] - centroids[minIdx][d]
      }

      // Encode to PQ codes
      const pqCodes = encodeToPQ(residual, codebooks)

      // Add to cluster
      if (!clusterEntries.has(minIdx)) {
        clusterEntries.set(minIdx, [])
      }
      clusterEntries.get(minIdx)!.push({
        id,
        clusterId: minIdx,
        pqCodes,
      })
    }
  }

  // Write updated cluster files
  for (const [clusterId, entries] of clusterEntries) {
    if (entries.length > 0) {
      const paddedId = clusterId.toString().padStart(4, '0')
      await writeClusterFile(clusterId, entries, M, join(indexDir, `cluster-${paddedId}.bin`))
    }
  }
}
