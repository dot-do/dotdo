/**
 * Unified Vector Operations
 *
 * Consolidated vector operations for EdgeVec modules including:
 * - Distance functions (cosine, L2, dot product)
 * - Vector manipulation (normalization, subvectors)
 * - Comparison utilities
 * - Heap data structures for efficient top-K selection
 *
 * This module extracts common patterns from hnsw.ts, quantization.ts,
 * pq.ts, filtered-search.ts, batch-insert.ts, and coarse-search.ts
 * into a shared, tested utility layer.
 *
 * @module db/edgevec/vector-ops
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Supported distance metrics
 */
export type DistanceMetric = 'cosine' | 'l2' | 'euclidean' | 'dot'

/**
 * Distance function signature
 */
export type DistanceFunction = (a: Float32Array, b: Float32Array) => number

/**
 * Item type for heap operations
 */
export interface HeapItem {
  id: string
  distance: number
}

// ============================================================================
// DISTANCE FUNCTIONS
// ============================================================================

/**
 * Cosine distance (1 - cosine similarity)
 *
 * Returns a value between 0 (identical) and 2 (opposite).
 * Lower is better.
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Cosine distance (1 - similarity)
 */
export function cosineDistance(a: Float32Array, b: Float32Array): number {
  let dot = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  if (denom === 0) return 1 // No similarity for zero vectors

  const similarity = dot / denom
  return 1 - similarity
}

/**
 * Cosine distance for pre-normalized vectors (optimized)
 *
 * When vectors are already normalized to unit length, we can skip
 * the norm computation and just use 1 - dot product.
 *
 * @param a - First normalized vector
 * @param b - Second normalized vector
 * @returns Cosine distance
 */
export function cosineDistanceNormalized(a: Float32Array, b: Float32Array): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
  }
  return 1 - dot
}

/**
 * Cosine similarity (dot product of normalized vectors)
 *
 * Returns a value between -1 (opposite) and 1 (identical).
 * Higher is better.
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Cosine similarity
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  if (denom === 0) return 0

  return dot / denom
}

/**
 * L2 (Euclidean) distance
 *
 * Returns the Euclidean distance between two vectors.
 * Lower is better.
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns L2 distance
 */
export function l2Distance(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const diff = a[i]! - b[i]!
    sum += diff * diff
  }
  return Math.sqrt(sum)
}

/**
 * Squared L2 distance (for efficiency when comparing)
 *
 * Avoids the sqrt operation when only relative ordering matters.
 * Lower is better.
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Squared L2 distance
 */
export function l2DistanceSquared(a: Float32Array, b: Float32Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) {
    const diff = a[i]! - b[i]!
    sum += diff * diff
  }
  return sum
}

/**
 * Dot product
 *
 * Returns the dot product of two vectors.
 * Higher is better for similarity.
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Dot product
 */
export function dotProduct(a: Float32Array, b: Float32Array): number {
  let dot = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!
  }
  return dot
}

/**
 * Get the distance function for a given metric
 *
 * Returns a function that computes distance where LOWER is always better.
 * For dot product, this returns the negative value.
 *
 * @param metric - Distance metric
 * @returns Distance function
 */
export function getDistanceFunction(metric: DistanceMetric): DistanceFunction {
  switch (metric) {
    case 'cosine':
      return cosineDistance
    case 'l2':
    case 'euclidean':
      return l2Distance
    case 'dot':
      // Return negative so lower is better (consistent with other metrics)
      return (a, b) => -dotProduct(a, b)
    default:
      throw new Error(`Unknown distance metric: ${metric}`)
  }
}

/**
 * Get the similarity function for a given metric
 *
 * Returns a function that computes similarity where HIGHER is always better.
 *
 * @param metric - Distance metric
 * @returns Similarity function
 */
export function getSimilarityFunction(metric: DistanceMetric): DistanceFunction {
  switch (metric) {
    case 'cosine':
      return cosineSimilarity
    case 'l2':
    case 'euclidean':
      // Negative L2 distance (higher = closer = more similar)
      return (a, b) => -l2Distance(a, b)
    case 'dot':
      return dotProduct
    default:
      throw new Error(`Unknown distance metric: ${metric}`)
  }
}

// ============================================================================
// VECTOR MANIPULATION
// ============================================================================

/**
 * Compute the magnitude (L2 norm) of a vector
 *
 * @param v - Input vector
 * @returns Vector magnitude
 */
export function magnitude(v: Float32Array): number {
  let sum = 0
  for (let i = 0; i < v.length; i++) {
    sum += v[i]! * v[i]!
  }
  return Math.sqrt(sum)
}

/**
 * Normalize a vector to unit length
 *
 * Returns a new vector with the same direction but magnitude 1.
 * Handles zero vectors by returning a zero vector.
 *
 * @param v - Input vector
 * @returns Normalized vector (new Float32Array)
 */
export function normalize(v: Float32Array): Float32Array {
  const mag = magnitude(v)
  const result = new Float32Array(v.length)

  if (mag === 0) {
    return result // Return zero vector
  }

  for (let i = 0; i < v.length; i++) {
    result[i] = v[i]! / mag
  }

  return result
}

/**
 * Normalize a vector in-place
 *
 * Modifies the input vector to have unit length.
 *
 * @param v - Vector to normalize (modified in-place)
 */
export function normalizeInPlace(v: Float32Array): void {
  const mag = magnitude(v)

  if (mag === 0) {
    return // Leave as zero vector
  }

  for (let i = 0; i < v.length; i++) {
    v[i] = v[i]! / mag
  }
}

/**
 * Split a vector into M equal subvectors
 *
 * Used in Product Quantization to divide vectors into subspaces.
 *
 * @param vector - Input vector
 * @param numSubvectors - Number of subvectors (M)
 * @returns Array of subvectors
 */
export function splitIntoSubvectors(vector: Float32Array, numSubvectors: number): Float32Array[] {
  const dimensions = vector.length

  if (dimensions % numSubvectors !== 0) {
    throw new Error(
      `Vector dimension (${dimensions}) must be divisible by numSubvectors (${numSubvectors})`
    )
  }

  const subvectorDim = dimensions / numSubvectors
  const subvectors: Float32Array[] = []

  for (let m = 0; m < numSubvectors; m++) {
    const subvector = new Float32Array(subvectorDim)
    for (let d = 0; d < subvectorDim; d++) {
      subvector[d] = vector[m * subvectorDim + d]!
    }
    subvectors.push(subvector)
  }

  return subvectors
}

/**
 * Extract a subvector view (no copy)
 *
 * Returns a view into the original vector for efficiency.
 *
 * @param vector - Input vector
 * @param subvectorIndex - Index of the subvector (0-based)
 * @param subvectorDim - Dimension of each subvector
 * @returns Subvector view (Float32Array subarray)
 */
export function getSubvectorView(
  vector: Float32Array,
  subvectorIndex: number,
  subvectorDim: number
): Float32Array {
  const start = subvectorIndex * subvectorDim
  return vector.subarray(start, start + subvectorDim)
}

/**
 * Concatenate subvectors back into a single vector
 *
 * @param subvectors - Array of subvectors
 * @returns Concatenated vector
 */
export function concatenateSubvectors(subvectors: Float32Array[]): Float32Array {
  if (subvectors.length === 0) {
    return new Float32Array(0)
  }

  const totalDim = subvectors.reduce((sum, sub) => sum + sub.length, 0)
  const result = new Float32Array(totalDim)

  let offset = 0
  for (const sub of subvectors) {
    result.set(sub, offset)
    offset += sub.length
  }

  return result
}

// ============================================================================
// COMPARISON UTILITIES
// ============================================================================

/**
 * Check if higher values are better for a given metric
 *
 * @param metric - Distance metric
 * @returns True if higher similarity/lower distance means more similar
 */
export function isHigherBetter(metric: DistanceMetric): boolean {
  switch (metric) {
    case 'cosine':
    case 'dot':
      return true
    case 'l2':
    case 'euclidean':
      return false
    default:
      return false
  }
}

/**
 * Get a comparison function for sorting search results
 *
 * Returns a function suitable for Array.sort() that sorts items
 * by their score in the correct order for the metric.
 *
 * @param metric - Distance metric
 * @returns Comparison function
 */
export function compareFn<T extends { score: number }>(
  metric: DistanceMetric
): (a: T, b: T) => number {
  const higherBetter = isHigherBetter(metric)
  return higherBetter ? (a, b) => b.score - a.score : (a, b) => a.score - b.score
}

/**
 * Check if a new distance is better than an existing one
 *
 * @param metric - Distance metric
 * @param newDist - New distance value
 * @param oldDist - Old distance value
 * @returns True if newDist is better than oldDist
 */
export function isBetter(metric: DistanceMetric, newDist: number, oldDist: number): boolean {
  const higherBetter = isHigherBetter(metric)
  return higherBetter ? newDist > oldDist : newDist < oldDist
}

// ============================================================================
// HEAP UTILITIES
// ============================================================================

/**
 * Generic Min-Heap implementation
 *
 * Efficient data structure for finding K smallest items.
 * Supports any item type with a distance property.
 */
export class MinHeap<T extends { distance: number }> {
  private heap: T[] = []

  /**
   * Add an item to the heap
   */
  push(item: T): void {
    this.heap.push(item)
    this.bubbleUp(this.heap.length - 1)
  }

  /**
   * Remove and return the smallest item
   */
  pop(): T | undefined {
    if (this.heap.length === 0) return undefined

    const result = this.heap[0]
    const last = this.heap.pop()!

    if (this.heap.length > 0) {
      this.heap[0] = last
      this.bubbleDown(0)
    }

    return result
  }

  /**
   * Peek at the smallest item without removing it
   */
  peek(): T | undefined {
    return this.heap[0]
  }

  /**
   * Get the current size of the heap
   */
  size(): number {
    return this.heap.length
  }

  /**
   * Check if the heap is empty
   */
  isEmpty(): boolean {
    return this.heap.length === 0
  }

  /**
   * Convert to a sorted array (smallest first)
   */
  toSortedArray(): T[] {
    return [...this.heap].sort((a, b) => a.distance - b.distance)
  }

  /**
   * Clear all items from the heap
   */
  clear(): void {
    this.heap = []
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2)
      if (this.heap[parentIndex]!.distance <= this.heap[index]!.distance) break
      ;[this.heap[parentIndex], this.heap[index]] = [this.heap[index]!, this.heap[parentIndex]!]
      index = parentIndex
    }
  }

  private bubbleDown(index: number): void {
    const length = this.heap.length
    while (true) {
      const leftChild = 2 * index + 1
      const rightChild = 2 * index + 2
      let smallest = index

      if (leftChild < length && this.heap[leftChild]!.distance < this.heap[smallest]!.distance) {
        smallest = leftChild
      }
      if (rightChild < length && this.heap[rightChild]!.distance < this.heap[smallest]!.distance) {
        smallest = rightChild
      }

      if (smallest === index) break
      ;[this.heap[smallest], this.heap[index]] = [this.heap[index]!, this.heap[smallest]!]
      index = smallest
    }
  }
}

/**
 * Generic Max-Heap implementation
 *
 * Efficient data structure for finding K largest items.
 * Also useful for top-K selection (maintain K smallest by removing largest).
 */
export class MaxHeap<T extends { distance: number }> {
  private heap: T[] = []

  /**
   * Add an item to the heap
   */
  push(item: T): void {
    this.heap.push(item)
    this.bubbleUp(this.heap.length - 1)
  }

  /**
   * Remove and return the largest item
   */
  pop(): T | undefined {
    if (this.heap.length === 0) return undefined

    const result = this.heap[0]
    const last = this.heap.pop()!

    if (this.heap.length > 0) {
      this.heap[0] = last
      this.bubbleDown(0)
    }

    return result
  }

  /**
   * Peek at the largest item without removing it
   */
  peek(): T | undefined {
    return this.heap[0]
  }

  /**
   * Get the current size of the heap
   */
  size(): number {
    return this.heap.length
  }

  /**
   * Check if the heap is empty
   */
  isEmpty(): boolean {
    return this.heap.length === 0
  }

  /**
   * Convert to a sorted array (largest first)
   */
  toSortedArray(): T[] {
    return [...this.heap].sort((a, b) => b.distance - a.distance)
  }

  /**
   * Clear all items from the heap
   */
  clear(): void {
    this.heap = []
  }

  private bubbleUp(index: number): void {
    while (index > 0) {
      const parentIndex = Math.floor((index - 1) / 2)
      if (this.heap[parentIndex]!.distance >= this.heap[index]!.distance) break
      ;[this.heap[parentIndex], this.heap[index]] = [this.heap[index]!, this.heap[parentIndex]!]
      index = parentIndex
    }
  }

  private bubbleDown(index: number): void {
    const length = this.heap.length
    while (true) {
      const leftChild = 2 * index + 1
      const rightChild = 2 * index + 2
      let largest = index

      if (leftChild < length && this.heap[leftChild]!.distance > this.heap[largest]!.distance) {
        largest = leftChild
      }
      if (rightChild < length && this.heap[rightChild]!.distance > this.heap[largest]!.distance) {
        largest = rightChild
      }

      if (largest === index) break
      ;[this.heap[largest], this.heap[index]] = [this.heap[index]!, this.heap[largest]!]
      index = largest
    }
  }
}

// ============================================================================
// TOP-K SELECTION
// ============================================================================

/**
 * Select top-K items from an array using a heap
 *
 * Efficiently finds the K items with smallest distances.
 *
 * @param items - Array of items with distances
 * @param k - Number of items to select
 * @returns Array of K items with smallest distances
 */
export function selectTopK<T extends { distance: number }>(items: T[], k: number): T[] {
  if (items.length <= k) {
    return [...items].sort((a, b) => a.distance - b.distance)
  }

  // Use max-heap to maintain K smallest
  const heap = new MaxHeap<T>()

  for (const item of items) {
    heap.push(item)
    if (heap.size() > k) {
      heap.pop() // Remove largest
    }
  }

  return heap.toSortedArray().reverse() // Return sorted smallest-first
}

/**
 * Select top-K items where higher is better
 *
 * @param items - Array of items with scores
 * @param k - Number of items to select
 * @returns Array of K items with highest scores
 */
export function selectTopKHigherBetter<T extends { distance: number }>(items: T[], k: number): T[] {
  if (items.length <= k) {
    return [...items].sort((a, b) => b.distance - a.distance)
  }

  // Use min-heap to maintain K largest
  const heap = new MinHeap<T>()

  for (const item of items) {
    heap.push(item)
    if (heap.size() > k) {
      heap.pop() // Remove smallest
    }
  }

  return heap.toSortedArray().reverse() // Return sorted largest-first
}
