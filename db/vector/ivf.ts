/**
 * IVF Index - Inverted File Index with Centroids
 *
 * IVF (Inverted File) is an approximate nearest neighbor algorithm that:
 * 1. Partitions vectors into clusters using k-means clustering
 * 2. Maintains inverted lists mapping centroid -> vector IDs
 * 3. At query time, probes only the nprobe nearest clusters
 *
 * @see tests/vector/ivf-index.test.ts for expected behavior
 * @module db/vector/ivf
 */

import type { Centroid, DistanceMetric, SearchResult } from '../../types/vector'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Configuration for IVF index
 */
export interface IVFConfig {
  /** Number of dimensions in vectors */
  dimensions: number
  /** Number of clusters (centroids) */
  nlist: number
  /** Number of clusters to probe during search (default: 1) */
  nprobe?: number
  /** Distance metric */
  metric?: DistanceMetric
  /** Whether to relocate empty clusters during training */
  relocateEmptyClusters?: boolean
}

/**
 * Options for k-means training
 */
export interface IVFTrainingOptions {
  /** Maximum iterations for k-means */
  maxIterations?: number
  /** Convergence threshold for k-means */
  convergenceThreshold?: number
  /** Initialization method */
  initialization?: 'random' | 'kmeans++'
  /** Random seed for reproducibility */
  randomSeed?: number
  /** Whether to perform incremental training */
  incremental?: boolean
}

/**
 * Result of training operation
 */
export interface TrainingResult {
  /** Whether training converged */
  converged: boolean
  /** Number of iterations performed */
  iterations: number
  /** Initial clustering error */
  initialError: number
  /** Final clustering error */
  finalError: number
  /** Warnings generated during training */
  warnings: string[]
}

/**
 * An inverted list for a single cluster
 */
export interface InvertedList {
  /** Vector IDs assigned to this cluster */
  vectorIds: string[]
}

/**
 * Assignment of a vector to a cluster
 */
export interface ClusterAssignment {
  /** ID of the centroid (cluster) */
  centroidId: number
  /** Distance to the centroid */
  distance: number
}

/**
 * Cluster balance statistics
 */
export interface ClusterBalance {
  /** Minimum cluster size */
  minSize: number
  /** Maximum cluster size */
  maxSize: number
  /** Mean cluster size */
  mean: number
  /** Standard deviation of cluster sizes */
  stdDev: number
  /** Number of empty clusters */
  emptyClusters: number
}

/**
 * Cluster size distribution entry
 */
export interface ClusterSizeEntry {
  /** Centroid ID */
  centroidId: number
  /** Number of vectors in this cluster */
  count: number
}

/**
 * Search options
 */
export interface IVFSearchOptions {
  /** Number of clusters to probe (overrides index default) */
  nprobe?: number
}

/**
 * Search statistics
 */
export interface SearchStats {
  /** Number of clusters probed */
  clustersProbed: number
  /** Number of vectors scanned */
  vectorsScanned: number
  /** Number of empty clusters encountered */
  emptyClustersPassed: number
  /** Search time in milliseconds */
  searchTimeMs: number
}

/**
 * Index statistics
 */
export interface IVFStats {
  /** Total number of vectors */
  vectorCount: number
  /** Vector dimensions */
  dimensions: number
  /** Number of clusters */
  nlist: number
  /** Default probe count */
  nprobe: number
  /** Distance metric */
  metric: DistanceMetric
  /** Whether index is trained */
  trained: boolean
  /** Approximate memory usage in bytes */
  memoryUsageBytes: number
  /** Average vectors per cluster */
  avgVectorsPerCluster: number
}

/**
 * Latency statistics
 */
export interface LatencyStats {
  /** Number of searches performed */
  searchCount: number
  /** Average latency in milliseconds */
  avgLatencyMs: number
  /** 50th percentile latency */
  p50LatencyMs: number
  /** 99th percentile latency */
  p99LatencyMs: number
}

/**
 * Recall evaluation options
 */
export interface RecallEvalOptions {
  /** Number of results to retrieve */
  k: number
  /** nprobe values to test */
  nprobeValues: number[]
  /** Function to compute ground truth */
  groundTruthFn: (query: Float32Array, k: number) => SearchResult[]
}

/**
 * Recall metric for a single nprobe value
 */
export interface RecallMetric {
  /** nprobe value */
  nprobe: number
  /** Mean recall across queries */
  meanRecall: number
}

/**
 * Options for computing recalls
 */
export interface RecallComputeOptions {
  /** k values to compute recall at */
  kValues: number[]
  /** Function to compute ground truth */
  groundTruthFn: (query: Float32Array, k: number) => SearchResult[]
}

/**
 * JSON serialization format - config excludes relocateEmptyClusters for backward compat
 */
export interface IVFIndexJSON {
  config: {
    dimensions: number
    nlist: number
    nprobe: number
    metric: DistanceMetric
  }
  centroids: Array<{ id: number; vector: number[]; count: number }>
  invertedLists: Array<{ centroidId: number; vectorIds: string[] }>
  vectors: Array<{ id: string; vector: number[] }>
  vectorCount: number
  trained: boolean
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Simple seeded PRNG (Linear Congruential Generator)
 */
class SeededRandom {
  private seed: number

  constructor(seed: number) {
    this.seed = seed
  }

  next(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff
    return this.seed / 0x7fffffff
  }

  nextInt(max: number): number {
    return Math.floor(this.next() * max)
  }
}

/**
 * Compute cosine similarity between two vectors
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom > 0 ? dot / denom : 0
}

/**
 * Compute L2 (Euclidean) distance between two vectors
 */
function l2Distance(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i]
    sum += diff * diff
  }
  return Math.sqrt(sum)
}

/**
 * Convert similarity/distance to comparable value
 * For cosine: higher similarity = better, so return 1 - similarity for distance
 * For L2: lower distance = better
 */
function computeDistance(
  a: Float32Array,
  b: Float32Array,
  metric: DistanceMetric
): number {
  if (metric === 'cosine') {
    return 1 - cosineSimilarity(a, b)
  }
  return l2Distance(a, b)
}

/**
 * Normalize a vector to unit length
 */
function normalizeVector(v: Float32Array): Float32Array {
  let norm = 0
  for (let i = 0; i < v.length; i++) {
    norm += v[i] * v[i]
  }
  norm = Math.sqrt(norm)
  if (norm === 0) return v

  const result = new Float32Array(v.length)
  for (let i = 0; i < v.length; i++) {
    result[i] = v[i] / norm
  }
  return result
}

// ============================================================================
// IVF INDEX IMPLEMENTATION
// ============================================================================

/**
 * IVF Index Implementation
 *
 * Implements Inverted File Index with k-means clustering for
 * approximate nearest neighbor search.
 */
export class IVFIndex {
  readonly config: Required<IVFConfig>

  // Vector storage
  private vectors: Map<string, Float32Array> = new Map()

  // Centroids (computed during training)
  private centroids: Centroid[] = []

  // Inverted lists: centroidId -> list of vector IDs
  private invertedLists: Map<number, string[]> = new Map()

  // Cluster assignments: vectorId -> centroidId
  private assignments: Map<string, number> = new Map()

  // Training state
  private trained = false
  private vectorsAtTraining = 0

  // Latency tracking
  private latencies: number[] = []

  constructor(config: IVFConfig) {
    // Validate configuration
    if (config.nlist < 1) {
      throw new Error('nlist must be positive')
    }
    if (config.nprobe !== undefined && config.nprobe < 1) {
      throw new Error('nprobe must be positive')
    }
    if (config.nprobe !== undefined && config.nprobe > config.nlist) {
      throw new Error('nprobe cannot exceed nlist')
    }

    this.config = {
      dimensions: config.dimensions,
      nlist: config.nlist,
      nprobe: config.nprobe ?? 1,
      metric: config.metric ?? 'cosine',
      relocateEmptyClusters: config.relocateEmptyClusters ?? false,
    }

    // Initialize empty inverted lists
    for (let i = 0; i < this.config.nlist; i++) {
      this.invertedLists.set(i, [])
    }
  }

  // --------------------------------------------------------------------------
  // Vector Operations
  // --------------------------------------------------------------------------

  async add(id: string, vector: Float32Array): Promise<void> {
    if (vector.length !== this.config.dimensions) {
      throw new Error(
        `Dimension mismatch: expected ${this.config.dimensions}, got ${vector.length}`
      )
    }

    // Store the vector
    this.vectors.set(id, vector)

    // If trained, assign to a cluster
    if (this.trained) {
      const centroidId = this.findNearestCentroid(vector)
      this.assignments.set(id, centroidId)
      this.invertedLists.get(centroidId)!.push(id)
      this.centroids[centroidId].count++
    }
  }

  async delete(id: string): Promise<boolean> {
    if (!this.vectors.has(id)) {
      return false
    }

    // Remove from inverted list if trained
    if (this.trained && this.assignments.has(id)) {
      const centroidId = this.assignments.get(id)!
      const list = this.invertedLists.get(centroidId)!
      const idx = list.indexOf(id)
      if (idx >= 0) {
        list.splice(idx, 1)
        this.centroids[centroidId].count--
      }
      this.assignments.delete(id)
    }

    this.vectors.delete(id)
    return true
  }

  async update(id: string, vector: Float32Array): Promise<void> {
    if (!this.vectors.has(id)) {
      throw new Error(`Vector ${id} not found`)
    }

    // Remove old assignment if trained
    if (this.trained && this.assignments.has(id)) {
      const oldCentroidId = this.assignments.get(id)!
      const list = this.invertedLists.get(oldCentroidId)!
      const idx = list.indexOf(id)
      if (idx >= 0) {
        list.splice(idx, 1)
        this.centroids[oldCentroidId].count--
      }
    }

    // Update vector
    this.vectors.set(id, vector)

    // Reassign if trained
    if (this.trained) {
      const newCentroidId = this.findNearestCentroid(vector)
      this.assignments.set(id, newCentroidId)
      this.invertedLists.get(newCentroidId)!.push(id)
      this.centroids[newCentroidId].count++
    }
  }

  async getVector(id: string): Promise<Float32Array | null> {
    return this.vectors.get(id) ?? null
  }

  size(): number {
    return this.vectors.size
  }

  // --------------------------------------------------------------------------
  // Training
  // --------------------------------------------------------------------------

  async train(options?: IVFTrainingOptions): Promise<TrainingResult> {
    const maxIterations = options?.maxIterations ?? 100
    const convergenceThreshold = options?.convergenceThreshold ?? 0.0001
    const initialization = options?.initialization ?? 'kmeans++'
    const randomSeed = options?.randomSeed ?? Date.now()
    const rng = new SeededRandom(randomSeed)

    const warnings: string[] = []
    const vectorIds = Array.from(this.vectors.keys())
    const n = vectorIds.length

    // Validate we have enough vectors
    if (n < this.config.nlist) {
      throw new Error(
        `Insufficient vectors for training: have ${n}, need at least ${this.config.nlist}`
      )
    }

    // Warn about low vectors per cluster
    const avgPerCluster = n / this.config.nlist
    if (avgPerCluster < 10) {
      warnings.push(
        `Low number of vectors per cluster (${avgPerCluster.toFixed(1)} avg)`
      )
    }

    // Initialize centroids
    if (initialization === 'kmeans++') {
      this.initializeCentroidsKMeansPlusPlus(vectorIds, rng)
    } else {
      this.initializeCentroidsRandom(vectorIds, rng)
    }

    // Compute initial error
    let prevError = this.computeClusteringError()
    const initialError = prevError

    let converged = false
    let iterations = 0

    // K-means iterations
    for (iterations = 1; iterations <= maxIterations; iterations++) {
      // E-step: Assign vectors to nearest centroid
      this.assignVectorsToCentroids()

      // M-step: Update centroids
      this.updateCentroids()

      // Handle empty clusters if configured
      if (this.config.relocateEmptyClusters) {
        this.relocateEmptyClusters(rng)
      }

      // Check convergence
      const currentError = this.computeClusteringError()
      const improvement = Math.abs(prevError - currentError) / (prevError || 1)

      if (improvement < convergenceThreshold) {
        converged = true
        break
      }

      prevError = currentError
    }

    // Check for empty clusters
    const emptyClusters = this.centroids.filter((c) => c.count === 0).length
    if (emptyClusters > 0) {
      warnings.push(`${emptyClusters} empty clusters after training`)
    }

    this.trained = true
    this.vectorsAtTraining = n

    return {
      converged,
      iterations,
      initialError,
      finalError: this.computeClusteringError(),
      warnings,
    }
  }

  private initializeCentroidsRandom(
    vectorIds: string[],
    rng: SeededRandom
  ): void {
    // Random initialization: pick random vectors as initial centroids
    const shuffled = [...vectorIds]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = rng.nextInt(i + 1)
      ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
    }

    this.centroids = []
    for (let i = 0; i < this.config.nlist; i++) {
      const vec = this.vectors.get(shuffled[i])!
      this.centroids.push({
        id: i,
        vector: normalizeVector(new Float32Array(vec)),
        count: 0,
      })
    }
  }

  private initializeCentroidsKMeansPlusPlus(
    vectorIds: string[],
    rng: SeededRandom
  ): void {
    // K-means++ initialization
    this.centroids = []

    // Pick first centroid randomly
    const firstIdx = rng.nextInt(vectorIds.length)
    const firstVec = this.vectors.get(vectorIds[firstIdx])!
    this.centroids.push({
      id: 0,
      vector: normalizeVector(new Float32Array(firstVec)),
      count: 0,
    })

    // Pick remaining centroids with probability proportional to D(x)^2
    for (let k = 1; k < this.config.nlist; k++) {
      // Compute distances to nearest existing centroid
      const distances: number[] = []
      let totalDist = 0

      for (const id of vectorIds) {
        const vec = this.vectors.get(id)!
        let minDist = Infinity
        for (const centroid of this.centroids) {
          const dist = computeDistance(vec, centroid.vector, this.config.metric)
          minDist = Math.min(minDist, dist)
        }
        distances.push(minDist * minDist) // D(x)^2
        totalDist += minDist * minDist
      }

      // Sample proportionally to D(x)^2
      const threshold = rng.next() * totalDist
      let cumulative = 0
      let chosenIdx = 0

      for (let i = 0; i < distances.length; i++) {
        cumulative += distances[i]
        if (cumulative >= threshold) {
          chosenIdx = i
          break
        }
      }

      const chosenVec = this.vectors.get(vectorIds[chosenIdx])!
      this.centroids.push({
        id: k,
        vector: normalizeVector(new Float32Array(chosenVec)),
        count: 0,
      })
    }
  }

  private assignVectorsToCentroids(): void {
    // Clear current assignments
    this.assignments.clear()
    for (let i = 0; i < this.config.nlist; i++) {
      this.invertedLists.set(i, [])
      this.centroids[i].count = 0
    }

    // Assign each vector to nearest centroid
    for (const [id, vec] of this.vectors) {
      const centroidId = this.findNearestCentroid(vec)
      this.assignments.set(id, centroidId)
      this.invertedLists.get(centroidId)!.push(id)
      this.centroids[centroidId].count++
    }
  }

  private updateCentroids(): void {
    for (let i = 0; i < this.config.nlist; i++) {
      const list = this.invertedLists.get(i)!
      if (list.length === 0) continue

      // Compute mean of all vectors in this cluster
      const mean = new Float32Array(this.config.dimensions)
      for (const id of list) {
        const vec = this.vectors.get(id)!
        for (let d = 0; d < this.config.dimensions; d++) {
          mean[d] += vec[d]
        }
      }

      for (let d = 0; d < this.config.dimensions; d++) {
        mean[d] /= list.length
      }

      // Normalize for cosine metric
      this.centroids[i].vector = normalizeVector(mean)
    }
  }

  private relocateEmptyClusters(rng: SeededRandom): void {
    // Find the largest cluster
    let maxCount = 0
    let maxClusterId = 0
    for (let i = 0; i < this.config.nlist; i++) {
      if (this.centroids[i].count > maxCount) {
        maxCount = this.centroids[i].count
        maxClusterId = i
      }
    }

    // Relocate empty clusters to points from the largest cluster
    for (let i = 0; i < this.config.nlist; i++) {
      if (this.centroids[i].count === 0 && maxCount > 1) {
        const largestList = this.invertedLists.get(maxClusterId)!
        const randIdx = rng.nextInt(largestList.length)
        const vecId = largestList[randIdx]
        const vec = this.vectors.get(vecId)!

        // Move this vector to the empty cluster
        this.centroids[i].vector = normalizeVector(new Float32Array(vec))
      }
    }
  }

  private computeClusteringError(): number {
    let totalError = 0
    for (const [id, vec] of this.vectors) {
      const centroidId = this.assignments.get(id)
      if (centroidId !== undefined) {
        const centroid = this.centroids[centroidId]
        totalError += computeDistance(vec, centroid.vector, this.config.metric)
      } else {
        // Not assigned yet - use distance to nearest centroid
        const nearestId = this.findNearestCentroid(vec)
        totalError += computeDistance(
          vec,
          this.centroids[nearestId].vector,
          this.config.metric
        )
      }
    }
    return totalError / this.vectors.size
  }

  private findNearestCentroid(vec: Float32Array): number {
    let minDist = Infinity
    let nearestId = 0

    for (const centroid of this.centroids) {
      const dist = computeDistance(vec, centroid.vector, this.config.metric)
      if (dist < minDist) {
        minDist = dist
        nearestId = centroid.id
      }
    }

    return nearestId
  }

  isTrained(): boolean {
    return this.trained
  }

  needsRetraining(): boolean {
    if (!this.trained) return true
    // If 50% or more new vectors have been added since training
    const newVectors = this.vectors.size - this.vectorsAtTraining
    return newVectors >= this.vectorsAtTraining * 0.5
  }

  // --------------------------------------------------------------------------
  // Centroids and Clusters
  // --------------------------------------------------------------------------

  getCentroids(): Centroid[] {
    return [...this.centroids]
  }

  getInvertedLists(): Record<number, InvertedList> {
    const result: Record<number, InvertedList> = {}
    for (const [id, vectorIds] of this.invertedLists) {
      result[id] = { vectorIds: [...vectorIds] }
    }
    return result
  }

  async getVectorAssignment(id: string): Promise<ClusterAssignment | null> {
    if (!this.assignments.has(id)) return null

    const centroidId = this.assignments.get(id)!
    const vec = this.vectors.get(id)!
    const centroid = this.centroids[centroidId]
    const distance = computeDistance(vec, centroid.vector, this.config.metric)

    return { centroidId, distance }
  }

  getClusterBalance(): ClusterBalance {
    const sizes = this.centroids.map((c) => c.count)
    const nonZeroSizes = sizes.filter((s) => s > 0)

    const minSize = nonZeroSizes.length > 0 ? Math.min(...nonZeroSizes) : 0
    const maxSize = Math.max(...sizes)
    const mean = sizes.reduce((a, b) => a + b, 0) / sizes.length
    const emptyClusters = sizes.filter((s) => s === 0).length

    // Compute standard deviation
    const variance =
      sizes.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / sizes.length
    const stdDev = Math.sqrt(variance)

    return { minSize, maxSize, mean, stdDev, emptyClusters }
  }

  getClusterSizeDistribution(): ClusterSizeEntry[] {
    return this.centroids.map((c) => ({
      centroidId: c.id,
      count: c.count,
    }))
  }

  // --------------------------------------------------------------------------
  // Search
  // --------------------------------------------------------------------------

  async search(
    query: Float32Array,
    k: number,
    options?: IVFSearchOptions
  ): Promise<SearchResult[]> {
    const { results } = await this.searchWithStats(query, k, options)
    return results
  }

  async searchWithStats(
    query: Float32Array,
    k: number,
    options?: IVFSearchOptions
  ): Promise<{ results: SearchResult[]; stats: SearchStats }> {
    const startTime = performance.now()

    // Validate state
    if (!this.trained) {
      throw new Error('Index is not trained. Call train() first.')
    }

    if (query.length !== this.config.dimensions) {
      throw new Error(
        `Dimension mismatch: query has ${query.length} dimensions, index has ${this.config.dimensions}`
      )
    }

    const nprobe = options?.nprobe ?? this.config.nprobe

    // Find nprobe nearest centroids
    const centroidDistances: Array<{ id: number; distance: number }> = []
    for (const centroid of this.centroids) {
      const distance = computeDistance(
        query,
        centroid.vector,
        this.config.metric
      )
      centroidDistances.push({ id: centroid.id, distance })
    }
    centroidDistances.sort((a, b) => a.distance - b.distance)

    const probedCentroids = centroidDistances.slice(0, nprobe)

    // Search vectors in probed clusters
    const candidates: SearchResult[] = []
    let vectorsScanned = 0
    let emptyClustersPassed = 0

    for (const { id: centroidId } of probedCentroids) {
      const list = this.invertedLists.get(centroidId)!

      if (list.length === 0) {
        emptyClustersPassed++
        continue
      }

      for (const vecId of list) {
        const vec = this.vectors.get(vecId)!
        const score =
          this.config.metric === 'cosine'
            ? cosineSimilarity(query, vec)
            : -l2Distance(query, vec) // Negate L2 so higher is better

        candidates.push({ id: vecId, score })
        vectorsScanned++
      }
    }

    // Sort by score (descending for cosine, since we negated L2)
    candidates.sort((a, b) => b.score - a.score)

    const endTime = performance.now()
    const searchTimeMs = endTime - startTime

    // Track latency
    this.latencies.push(searchTimeMs)

    return {
      results: candidates.slice(0, k),
      stats: {
        clustersProbed: nprobe,
        vectorsScanned,
        emptyClustersPassed,
        searchTimeMs,
      },
    }
  }

  // --------------------------------------------------------------------------
  // Statistics
  // --------------------------------------------------------------------------

  getStats(): IVFStats {
    const vectorCount = this.vectors.size

    // Estimate memory usage
    // Vectors: n * dimensions * 4 bytes (Float32)
    // Inverted lists: overhead for string storage
    // Centroids: nlist * dimensions * 4 bytes
    const vectorBytes = vectorCount * this.config.dimensions * 4
    const centroidBytes = this.config.nlist * this.config.dimensions * 4
    const estimatedIdBytes = vectorCount * 20 // Approximate string overhead
    const memoryUsageBytes = vectorBytes + centroidBytes + estimatedIdBytes

    return {
      vectorCount,
      dimensions: this.config.dimensions,
      nlist: this.config.nlist,
      nprobe: this.config.nprobe,
      metric: this.config.metric,
      trained: this.trained,
      memoryUsageBytes,
      avgVectorsPerCluster: vectorCount / this.config.nlist,
    }
  }

  getLatencyStats(): LatencyStats {
    if (this.latencies.length === 0) {
      return {
        searchCount: 0,
        avgLatencyMs: 0,
        p50LatencyMs: 0,
        p99LatencyMs: 0,
      }
    }

    const sorted = [...this.latencies].sort((a, b) => a - b)
    const n = sorted.length

    const avgLatencyMs = sorted.reduce((a, b) => a + b, 0) / n
    const p50LatencyMs = sorted[Math.floor(n * 0.5)]
    const p99LatencyMs = sorted[Math.floor(n * 0.99)]

    return {
      searchCount: n,
      avgLatencyMs,
      p50LatencyMs,
      p99LatencyMs,
    }
  }

  // --------------------------------------------------------------------------
  // Recall Evaluation
  // --------------------------------------------------------------------------

  async evaluateRecall(
    queries: Float32Array[],
    options: RecallEvalOptions
  ): Promise<RecallMetric[]> {
    const results: RecallMetric[] = []

    for (const nprobe of options.nprobeValues) {
      let totalRecall = 0

      for (const query of queries) {
        const approxResults = await this.search(query, options.k, { nprobe })
        const groundTruth = options.groundTruthFn(query, options.k)

        const truthIds = new Set(groundTruth.map((r) => r.id))
        const hits = approxResults.filter((r) => truthIds.has(r.id)).length
        totalRecall += hits / groundTruth.length
      }

      results.push({
        nprobe,
        meanRecall: totalRecall / queries.length,
      })
    }

    return results
  }

  async computeRecalls(
    query: Float32Array,
    options: RecallComputeOptions
  ): Promise<Record<string, number>> {
    const result: Record<string, number> = {}

    for (const k of options.kValues) {
      const approxResults = await this.search(query, k)
      const groundTruth = options.groundTruthFn(query, k)

      const truthIds = new Set(groundTruth.map((r) => r.id))
      const hits = approxResults.filter((r) => truthIds.has(r.id)).length
      const recall = groundTruth.length > 0 ? hits / groundTruth.length : 1

      result[`recall@${k}`] = recall
    }

    return result
  }

  // --------------------------------------------------------------------------
  // Serialization
  // --------------------------------------------------------------------------

  async serialize(): Promise<ArrayBuffer> {
    const json = await this.toJSON()
    const jsonStr = JSON.stringify(json)
    const encoder = new TextEncoder()
    const jsonBytes = encoder.encode(jsonStr)

    // Create buffer with magic header + JSON
    const buffer = new ArrayBuffer(4 + jsonBytes.length)
    const view = new DataView(buffer)

    // Write magic "IVF1"
    view.setUint8(0, 'I'.charCodeAt(0))
    view.setUint8(1, 'V'.charCodeAt(0))
    view.setUint8(2, 'F'.charCodeAt(0))
    view.setUint8(3, '1'.charCodeAt(0))

    // Write JSON
    const uint8View = new Uint8Array(buffer, 4)
    uint8View.set(jsonBytes)

    return buffer
  }

  static async deserialize(buffer: ArrayBuffer): Promise<IVFIndex> {
    const view = new DataView(buffer)

    // Verify magic
    const magic = String.fromCharCode(
      view.getUint8(0),
      view.getUint8(1),
      view.getUint8(2),
      view.getUint8(3)
    )
    if (magic !== 'IVF1') {
      throw new Error(`Invalid IVF format: expected IVF1, got ${magic}`)
    }

    // Parse JSON
    const jsonBytes = new Uint8Array(buffer, 4)
    const decoder = new TextDecoder()
    const jsonStr = decoder.decode(jsonBytes)
    const json = JSON.parse(jsonStr) as IVFIndexJSON

    return IVFIndex.fromJSON(json)
  }

  async toJSON(): Promise<IVFIndexJSON> {
    const centroids = this.centroids.map((c) => ({
      id: c.id,
      vector: Array.from(c.vector),
      count: c.count,
    }))

    const invertedLists: Array<{ centroidId: number; vectorIds: string[] }> = []
    for (let i = 0; i < this.config.nlist; i++) {
      invertedLists.push({
        centroidId: i,
        vectorIds: [...(this.invertedLists.get(i) ?? [])],
      })
    }

    // Serialize vectors
    const vectors: Array<{ id: string; vector: number[] }> = []
    for (const [id, vec] of this.vectors) {
      vectors.push({ id, vector: Array.from(vec) })
    }

    return {
      config: {
        dimensions: this.config.dimensions,
        nlist: this.config.nlist,
        nprobe: this.config.nprobe,
        metric: this.config.metric,
      },
      centroids,
      invertedLists,
      vectors,
      vectorCount: this.vectors.size,
      trained: this.trained,
    }
  }

  static async fromJSON(json: IVFIndexJSON): Promise<IVFIndex> {
    const index = new IVFIndex(json.config)

    // Restore vectors
    for (const { id, vector } of json.vectors) {
      index.vectors.set(id, new Float32Array(vector))
    }

    // Restore centroids
    index.centroids = json.centroids.map((c) => ({
      id: c.id,
      vector: new Float32Array(c.vector),
      count: c.count,
    }))

    // Restore inverted lists and assignments
    for (const list of json.invertedLists) {
      index.invertedLists.set(list.centroidId, [...list.vectorIds])
      // Restore assignments from inverted lists
      for (const vecId of list.vectorIds) {
        index.assignments.set(vecId, list.centroidId)
      }
    }

    index.trained = json.trained
    index.vectorsAtTraining = json.vectorCount

    return index
  }
}
