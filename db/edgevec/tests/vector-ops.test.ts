/**
 * Vector Operations Unit Tests
 *
 * Tests for the unified vector operations interface that consolidates
 * common vector operations across EdgeVec modules.
 *
 * @module db/edgevec/tests/vector-ops.test
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  // Distance functions
  cosineDistance,
  cosineDistanceNormalized,
  cosineSimilarity,
  l2Distance,
  l2DistanceSquared,
  dotProduct,
  getDistanceFunction,

  // Vector manipulation
  normalize,
  magnitude,
  splitIntoSubvectors,
  concatenateSubvectors,

  // Comparison utilities
  isHigherBetter,
  compareFn,

  // Heap utilities
  MinHeap,
  MaxHeap,

  // Types
  type DistanceMetric,
  type DistanceFunction,
  type HeapItem,
} from '../vector-ops'

// ============================================================================
// TEST DATA
// ============================================================================

const vec1 = new Float32Array([1, 0, 0])
const vec2 = new Float32Array([0, 1, 0])
const vec3 = new Float32Array([1, 1, 0])
const vec4 = new Float32Array([1, 2, 3])
const vec5 = new Float32Array([4, 5, 6])
const zeroVec = new Float32Array([0, 0, 0])
const unitVec = new Float32Array([1, 0, 0])

// Higher dimensional vectors for subvector tests
const highDimVec = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8])

// ============================================================================
// DISTANCE FUNCTIONS
// ============================================================================

describe('Distance Functions', () => {
  describe('cosineDistance', () => {
    it('should return 0 for identical vectors', () => {
      const dist = cosineDistance(vec1, vec1)
      expect(dist).toBeCloseTo(0, 5)
    })

    it('should return 1 for orthogonal vectors', () => {
      const dist = cosineDistance(vec1, vec2)
      expect(dist).toBeCloseTo(1, 5)
    })

    it('should return 2 for opposite vectors', () => {
      const negVec = new Float32Array([-1, 0, 0])
      const dist = cosineDistance(vec1, negVec)
      expect(dist).toBeCloseTo(2, 5)
    })

    it('should handle non-unit vectors', () => {
      // vec3 = [1, 1, 0] at 45 degrees from vec1
      const dist = cosineDistance(vec1, vec3)
      // cos(45) = 1/sqrt(2), so distance = 1 - 1/sqrt(2) ~= 0.293
      expect(dist).toBeCloseTo(1 - Math.sqrt(2) / 2, 5)
    })

    it('should handle zero vectors gracefully', () => {
      const dist = cosineDistance(zeroVec, vec1)
      // Should return 1 (no similarity) for zero vector
      expect(dist).toBe(1)
    })
  })

  describe('cosineDistanceNormalized', () => {
    it('should compute distance for pre-normalized vectors', () => {
      const norm1 = normalize(vec4)
      const norm2 = normalize(vec5)
      const dist = cosineDistanceNormalized(norm1, norm2)
      // Should match regular cosine distance
      expect(dist).toBeCloseTo(cosineDistance(vec4, vec5), 5)
    })
  })

  describe('cosineSimilarity', () => {
    it('should return 1 for identical vectors', () => {
      const sim = cosineSimilarity(vec1, vec1)
      expect(sim).toBeCloseTo(1, 5)
    })

    it('should return 0 for orthogonal vectors', () => {
      const sim = cosineSimilarity(vec1, vec2)
      expect(sim).toBeCloseTo(0, 5)
    })

    it('should return -1 for opposite vectors', () => {
      const negVec = new Float32Array([-1, 0, 0])
      const sim = cosineSimilarity(vec1, negVec)
      expect(sim).toBeCloseTo(-1, 5)
    })
  })

  describe('l2Distance', () => {
    it('should return 0 for identical vectors', () => {
      const dist = l2Distance(vec1, vec1)
      expect(dist).toBe(0)
    })

    it('should return sqrt(2) for adjacent unit vectors', () => {
      const dist = l2Distance(vec1, vec2)
      expect(dist).toBeCloseTo(Math.sqrt(2), 5)
    })

    it('should compute correct euclidean distance', () => {
      const a = new Float32Array([0, 0, 0])
      const b = new Float32Array([3, 4, 0])
      const dist = l2Distance(a, b)
      expect(dist).toBe(5)
    })
  })

  describe('l2DistanceSquared', () => {
    it('should return squared distance for efficiency', () => {
      const a = new Float32Array([0, 0, 0])
      const b = new Float32Array([3, 4, 0])
      const distSq = l2DistanceSquared(a, b)
      expect(distSq).toBe(25)
    })

    it('should be consistent with l2Distance', () => {
      const distSq = l2DistanceSquared(vec4, vec5)
      const dist = l2Distance(vec4, vec5)
      expect(Math.sqrt(distSq)).toBeCloseTo(dist, 5)
    })
  })

  describe('dotProduct', () => {
    it('should return 0 for orthogonal vectors', () => {
      const dot = dotProduct(vec1, vec2)
      expect(dot).toBe(0)
    })

    it('should return 1 for identical unit vectors', () => {
      const dot = dotProduct(unitVec, unitVec)
      expect(dot).toBe(1)
    })

    it('should compute correct dot product', () => {
      // [1,2,3] . [4,5,6] = 4 + 10 + 18 = 32
      const dot = dotProduct(vec4, vec5)
      expect(dot).toBe(32)
    })
  })

  describe('getDistanceFunction', () => {
    it('should return cosine distance function for cosine metric', () => {
      const fn = getDistanceFunction('cosine')
      expect(fn(vec1, vec1)).toBeCloseTo(0, 5)
      expect(fn(vec1, vec2)).toBeCloseTo(1, 5)
    })

    it('should return L2 distance function for l2 metric', () => {
      const fn = getDistanceFunction('l2')
      expect(fn(vec1, vec1)).toBe(0)
      expect(fn(vec1, vec2)).toBeCloseTo(Math.sqrt(2), 5)
    })

    it('should return L2 distance function for euclidean metric', () => {
      const fn = getDistanceFunction('euclidean')
      expect(fn(vec1, vec1)).toBe(0)
    })

    it('should return negative dot product for dot metric', () => {
      const fn = getDistanceFunction('dot')
      // For dot product, we return negative so lower is better in distance terms
      expect(fn(vec4, vec5)).toBe(-32)
    })

    it('should throw for unknown metric', () => {
      expect(() => getDistanceFunction('unknown' as DistanceMetric)).toThrow()
    })
  })
})

// ============================================================================
// VECTOR MANIPULATION
// ============================================================================

describe('Vector Manipulation', () => {
  describe('normalize', () => {
    it('should normalize vector to unit length', () => {
      const norm = normalize(vec4)
      const mag = magnitude(norm)
      expect(mag).toBeCloseTo(1, 5)
    })

    it('should preserve direction', () => {
      const norm = normalize(vec4)
      // Check ratios are preserved
      expect(norm[1]! / norm[0]!).toBeCloseTo(vec4[1]! / vec4[0]!, 5)
      expect(norm[2]! / norm[0]!).toBeCloseTo(vec4[2]! / vec4[0]!, 5)
    })

    it('should handle zero vector', () => {
      const norm = normalize(zeroVec)
      // Should return zero vector (not NaN)
      expect(norm[0]).toBe(0)
      expect(norm[1]).toBe(0)
      expect(norm[2]).toBe(0)
    })

    it('should not modify the original vector', () => {
      const original = new Float32Array([3, 4, 0])
      const norm = normalize(original)
      expect(original[0]).toBe(3)
      expect(norm[0]).toBeCloseTo(0.6, 5)
    })
  })

  describe('magnitude', () => {
    it('should return correct magnitude', () => {
      const v = new Float32Array([3, 4, 0])
      expect(magnitude(v)).toBe(5)
    })

    it('should return 1 for unit vectors', () => {
      expect(magnitude(unitVec)).toBe(1)
    })

    it('should return 0 for zero vector', () => {
      expect(magnitude(zeroVec)).toBe(0)
    })
  })

  describe('splitIntoSubvectors', () => {
    it('should split vector into equal subvectors', () => {
      const subs = splitIntoSubvectors(highDimVec, 4)
      expect(subs).toHaveLength(4)
      expect(subs[0]).toEqual(new Float32Array([1, 2]))
      expect(subs[1]).toEqual(new Float32Array([3, 4]))
      expect(subs[2]).toEqual(new Float32Array([5, 6]))
      expect(subs[3]).toEqual(new Float32Array([7, 8]))
    })

    it('should throw if dimension not divisible by numSubvectors', () => {
      expect(() => splitIntoSubvectors(highDimVec, 3)).toThrow()
    })

    it('should handle single subvector case', () => {
      const subs = splitIntoSubvectors(vec4, 1)
      expect(subs).toHaveLength(1)
      expect(subs[0]).toEqual(vec4)
    })
  })

  describe('concatenateSubvectors', () => {
    it('should concatenate subvectors back into original', () => {
      const subs = splitIntoSubvectors(highDimVec, 4)
      const result = concatenateSubvectors(subs)
      expect(result).toEqual(highDimVec)
    })

    it('should handle empty array', () => {
      const result = concatenateSubvectors([])
      expect(result).toEqual(new Float32Array(0))
    })
  })
})

// ============================================================================
// COMPARISON UTILITIES
// ============================================================================

describe('Comparison Utilities', () => {
  describe('isHigherBetter', () => {
    it('should return true for cosine similarity', () => {
      expect(isHigherBetter('cosine')).toBe(true)
    })

    it('should return false for L2 distance', () => {
      expect(isHigherBetter('l2')).toBe(false)
      expect(isHigherBetter('euclidean')).toBe(false)
    })

    it('should return true for dot product', () => {
      expect(isHigherBetter('dot')).toBe(true)
    })
  })

  describe('compareFn', () => {
    it('should sort ascending for L2 (lower is better)', () => {
      const items = [{ score: 3 }, { score: 1 }, { score: 2 }]
      const sorted = items.sort(compareFn('l2'))
      expect(sorted[0]!.score).toBe(1)
      expect(sorted[2]!.score).toBe(3)
    })

    it('should sort descending for cosine (higher is better)', () => {
      const items = [{ score: 1 }, { score: 3 }, { score: 2 }]
      const sorted = items.sort(compareFn('cosine'))
      expect(sorted[0]!.score).toBe(3)
      expect(sorted[2]!.score).toBe(1)
    })
  })
})

// ============================================================================
// HEAP UTILITIES
// ============================================================================

describe('MinHeap', () => {
  let heap: MinHeap<HeapItem>

  beforeEach(() => {
    heap = new MinHeap()
  })

  it('should start empty', () => {
    expect(heap.size()).toBe(0)
    expect(heap.peek()).toBeUndefined()
  })

  it('should return smallest item first', () => {
    heap.push({ id: 'a', distance: 3 })
    heap.push({ id: 'b', distance: 1 })
    heap.push({ id: 'c', distance: 2 })

    expect(heap.peek()?.id).toBe('b')
    expect(heap.pop()?.id).toBe('b')
    expect(heap.pop()?.id).toBe('c')
    expect(heap.pop()?.id).toBe('a')
  })

  it('should maintain heap property after multiple operations', () => {
    const values = [5, 3, 8, 1, 9, 2, 7, 4, 6]
    for (const v of values) {
      heap.push({ id: String(v), distance: v })
    }

    const sorted: number[] = []
    while (heap.size() > 0) {
      sorted.push(heap.pop()!.distance)
    }

    expect(sorted).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('should convert to sorted array', () => {
    heap.push({ id: 'a', distance: 3 })
    heap.push({ id: 'b', distance: 1 })
    heap.push({ id: 'c', distance: 2 })

    const arr = heap.toSortedArray()
    expect(arr[0]?.distance).toBe(1)
    expect(arr[1]?.distance).toBe(2)
    expect(arr[2]?.distance).toBe(3)
  })
})

describe('MaxHeap', () => {
  let heap: MaxHeap<HeapItem>

  beforeEach(() => {
    heap = new MaxHeap()
  })

  it('should start empty', () => {
    expect(heap.size()).toBe(0)
    expect(heap.peek()).toBeUndefined()
  })

  it('should return largest item first', () => {
    heap.push({ id: 'a', distance: 1 })
    heap.push({ id: 'b', distance: 3 })
    heap.push({ id: 'c', distance: 2 })

    expect(heap.peek()?.id).toBe('b')
    expect(heap.pop()?.id).toBe('b')
    expect(heap.pop()?.id).toBe('c')
    expect(heap.pop()?.id).toBe('a')
  })

  it('should maintain heap property after multiple operations', () => {
    const values = [5, 3, 8, 1, 9, 2, 7, 4, 6]
    for (const v of values) {
      heap.push({ id: String(v), distance: v })
    }

    const sorted: number[] = []
    while (heap.size() > 0) {
      sorted.push(heap.pop()!.distance)
    }

    expect(sorted).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1])
  })

  it('should support top-K selection pattern', () => {
    const k = 3
    const items = [5, 3, 8, 1, 9, 2, 7, 4, 6]

    // Use max-heap to keep track of K smallest
    for (const v of items) {
      heap.push({ id: String(v), distance: v })
      if (heap.size() > k) {
        heap.pop() // Remove largest
      }
    }

    // Heap now contains 3 smallest: 1, 2, 3
    expect(heap.size()).toBe(k)
    const results = heap.toSortedArray()
    expect(results.map((r) => r.distance).sort((a, b) => a - b)).toEqual([1, 2, 3])
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('Integration', () => {
  it('should support full vector search workflow', () => {
    const query = new Float32Array([1, 0, 0, 0])
    const database = [
      { id: 'a', vector: new Float32Array([1, 0, 0, 0]) }, // identical
      { id: 'b', vector: new Float32Array([0, 1, 0, 0]) }, // orthogonal
      { id: 'c', vector: new Float32Array([0.9, 0.1, 0, 0]) }, // very similar
      { id: 'd', vector: new Float32Array([-1, 0, 0, 0]) }, // opposite
    ]

    const distFn = getDistanceFunction('cosine')
    const higherBetter = isHigherBetter('cosine')

    // Compute distances
    const results = database.map((item) => ({
      id: item.id,
      distance: distFn(query, item.vector),
    }))

    // Sort (for cosine, higher is better, but getDistanceFunction returns distance not similarity)
    results.sort((a, b) => (higherBetter ? a.distance - b.distance : a.distance - b.distance))

    // Best match should be 'a' (identical)
    expect(results[0]!.id).toBe('a')
    expect(results[0]!.distance).toBeCloseTo(0, 5)
  })

  it('should support PQ-style subvector operations', () => {
    const vector = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    const numSubvectors = 4

    // Split into subvectors
    const subvectors = splitIntoSubvectors(vector, numSubvectors)
    expect(subvectors).toHaveLength(numSubvectors)
    expect(subvectors[0]!.length).toBe(3)

    // Compute distances for each subvector
    const centroid = new Float32Array([1, 2, 3])
    const subDistances = subvectors.map((sub) => l2DistanceSquared(sub, centroid))

    // First subvector should be closest to centroid
    expect(subDistances[0]).toBe(0)

    // Concatenate back
    const reconstructed = concatenateSubvectors(subvectors)
    expect(reconstructed).toEqual(vector)
  })
})
