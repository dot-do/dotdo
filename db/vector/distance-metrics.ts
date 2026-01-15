/**
 * Unified Distance Metrics
 *
 * Consolidated distance/similarity metrics for vector operations.
 * This module provides a single source of truth for all distance calculations
 * across the db/vector hierarchy.
 *
 * Supports both number[] (for general use) and Float32Array (for performance-critical code).
 *
 * @module db/vector/distance-metrics
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Supported distance metric types
 */
export type DistanceMetric = 'cosine' | 'euclidean' | 'dot' | 'l2' | 'manhattan'

/**
 * Vector type - supports both number[] and typed arrays
 */
export type Vector = number[] | Float32Array

/**
 * Distance function signature
 */
export type DistanceFunction<T extends Vector = Vector> = (a: T, b: T) => number

// ============================================================================
// CORE DISTANCE FUNCTIONS
// ============================================================================

/**
 * Calculate cosine similarity between two vectors
 *
 * Returns a value between -1 (opposite) and 1 (identical).
 * Higher is better for similarity.
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Cosine similarity value
 */
export function cosineSimilarity(a: Vector, b: Vector): number {
  let dotProd = 0
  let normA = 0
  let normB = 0

  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    dotProd += a[i]! * b[i]!
    normA += a[i]! * a[i]!
    normB += b[i]! * b[i]!
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  if (denominator === 0) return 0

  return dotProd / denominator
}

/**
 * Calculate cosine distance between two vectors
 *
 * Returns a value between 0 (identical) and 2 (opposite).
 * Lower is better for distance.
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Cosine distance (1 - similarity)
 */
export function cosineDistance(a: Vector, b: Vector): number {
  return 1 - cosineSimilarity(a, b)
}

/**
 * Calculate Euclidean (L2) distance between two vectors
 *
 * Lower is better.
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Euclidean distance
 */
export function euclideanDistance(a: Vector, b: Vector): number {
  let sum = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const diff = a[i]! - b[i]!
    sum += diff * diff
  }
  return Math.sqrt(sum)
}

/**
 * Alias for euclideanDistance
 */
export const l2Distance = euclideanDistance

/**
 * Calculate squared Euclidean distance (avoids sqrt for efficiency)
 *
 * Useful when only relative ordering matters.
 * Lower is better.
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Squared Euclidean distance
 */
export function euclideanDistanceSquared(a: Vector, b: Vector): number {
  let sum = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const diff = a[i]! - b[i]!
    sum += diff * diff
  }
  return sum
}

/**
 * Calculate dot product of two vectors
 *
 * Higher is better for similarity (for normalized vectors).
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Dot product
 */
export function dotProduct(a: Vector, b: Vector): number {
  let sum = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    sum += a[i]! * b[i]!
  }
  return sum
}

/**
 * Calculate Manhattan (L1) distance between two vectors
 *
 * Lower is better.
 *
 * @param a - First vector
 * @param b - Second vector
 * @returns Manhattan distance
 */
export function manhattanDistance(a: Vector, b: Vector): number {
  let sum = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    sum += Math.abs(a[i]! - b[i]!)
  }
  return sum
}

// ============================================================================
// VECTOR UTILITIES
// ============================================================================

/**
 * Normalize a vector to unit length
 *
 * @param v - Input vector
 * @returns New normalized vector
 */
export function normalizeVector(v: number[]): number[] {
  const magnitude = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0))
  if (magnitude === 0) return v
  return v.map((x) => x / magnitude)
}

/**
 * Normalize a Float32Array to unit length
 *
 * @param v - Input vector
 * @returns New normalized Float32Array
 */
export function normalizeFloat32(v: Float32Array): Float32Array {
  let sum = 0
  for (let i = 0; i < v.length; i++) {
    sum += v[i]! * v[i]!
  }
  const magnitude = Math.sqrt(sum)

  if (magnitude === 0) return new Float32Array(v)

  const result = new Float32Array(v.length)
  for (let i = 0; i < v.length; i++) {
    result[i] = v[i]! / magnitude
  }
  return result
}

/**
 * Calculate the magnitude (L2 norm) of a vector
 *
 * @param v - Input vector
 * @returns Vector magnitude
 */
export function magnitude(v: Vector): number {
  let sum = 0
  for (let i = 0; i < v.length; i++) {
    sum += v[i]! * v[i]!
  }
  return Math.sqrt(sum)
}

// ============================================================================
// METRIC HELPERS
// ============================================================================

/**
 * Get the appropriate distance function for a metric
 *
 * Returns a function where LOWER is always better.
 * For dot product, returns negative dot product.
 *
 * @param metric - Distance metric type
 * @returns Distance function
 */
export function getDistanceFunction(metric: DistanceMetric): DistanceFunction {
  switch (metric) {
    case 'cosine':
      return cosineDistance
    case 'euclidean':
    case 'l2':
      return euclideanDistance
    case 'dot':
      // Negate so lower is better (higher dot product = lower distance)
      return (a, b) => -dotProduct(a, b)
    case 'manhattan':
      return manhattanDistance
    default:
      throw new Error(`Unknown distance metric: ${metric}`)
  }
}

/**
 * Get the appropriate similarity function for a metric
 *
 * Returns a function where HIGHER is always better.
 *
 * @param metric - Distance metric type
 * @returns Similarity function
 */
export function getSimilarityFunction(metric: DistanceMetric): DistanceFunction {
  switch (metric) {
    case 'cosine':
      return cosineSimilarity
    case 'euclidean':
    case 'l2':
      // Negative distance (closer = more similar)
      return (a, b) => -euclideanDistance(a, b)
    case 'dot':
      return dotProduct
    case 'manhattan':
      // Negative distance (closer = more similar)
      return (a, b) => -manhattanDistance(a, b)
    default:
      throw new Error(`Unknown distance metric: ${metric}`)
  }
}

/**
 * Convert a distance to a similarity score
 *
 * Uses the formula: similarity = 1 / (1 + distance)
 * This maps [0, infinity) -> (0, 1]
 *
 * @param distance - Distance value (lower is better)
 * @returns Similarity score (higher is better, range 0-1)
 */
export function distanceToSimilarity(distance: number): number {
  return 1 / (1 + distance)
}

/**
 * Check if a metric uses "higher is better" semantics
 *
 * @param metric - Distance metric type
 * @returns True if higher values mean more similar
 */
export function isHigherBetter(metric: DistanceMetric): boolean {
  switch (metric) {
    case 'cosine':
    case 'dot':
      return true
    case 'euclidean':
    case 'l2':
    case 'manhattan':
      return false
    default:
      return false
  }
}

/**
 * Get a comparison function for sorting search results
 *
 * @param metric - Distance metric type
 * @returns Comparison function for Array.sort()
 */
export function getCompareFunction<T extends { score: number }>(
  metric: DistanceMetric
): (a: T, b: T) => number {
  const higherBetter = isHigherBetter(metric)
  return higherBetter ? (a, b) => b.score - a.score : (a, b) => a.score - b.score
}

// ============================================================================
// SCORE CALCULATION
// ============================================================================

/**
 * Calculate a score from two vectors using the specified metric
 *
 * Returns a value where higher always means more similar,
 * suitable for ranking search results.
 *
 * @param a - First vector
 * @param b - Second vector
 * @param metric - Distance metric type
 * @returns Similarity score (higher is better)
 */
export function calculateScore(a: Vector, b: Vector, metric: DistanceMetric): number {
  switch (metric) {
    case 'cosine':
      return cosineSimilarity(a, b)
    case 'euclidean':
    case 'l2':
      // Convert distance to similarity
      return distanceToSimilarity(euclideanDistance(a, b))
    case 'dot':
      return dotProduct(a, b)
    case 'manhattan':
      // Convert distance to similarity
      return distanceToSimilarity(manhattanDistance(a, b))
    default:
      return cosineSimilarity(a, b)
  }
}
