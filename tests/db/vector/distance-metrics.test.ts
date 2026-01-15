/**
 * Tests for the shared distance-metrics module
 *
 * @module db/vector/distance-metrics.test
 */
import { describe, test, expect } from 'vitest'
import {
  cosineSimilarity,
  cosineDistance,
  euclideanDistance,
  l2Distance,
  euclideanDistanceSquared,
  dotProduct,
  manhattanDistance,
  normalizeVector,
  normalizeFloat32,
  magnitude,
  getDistanceFunction,
  getSimilarityFunction,
  distanceToSimilarity,
  isHigherBetter,
  getCompareFunction,
  calculateScore,
} from '../../../db/vector/distance-metrics'

describe('Distance Metrics - Core Functions', () => {
  describe('cosineSimilarity', () => {
    test('should return 1 for identical vectors', () => {
      const a = [1, 2, 3]
      const b = [1, 2, 3]
      expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5)
    })

    test('should return 0 for orthogonal vectors', () => {
      const a = [1, 0]
      const b = [0, 1]
      expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5)
    })

    test('should return -1 for opposite vectors', () => {
      const a = [1, 2, 3]
      const b = [-1, -2, -3]
      expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5)
    })

    test('should handle Float32Array', () => {
      const a = new Float32Array([1, 2, 3])
      const b = new Float32Array([1, 2, 3])
      expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5)
    })

    test('should return 0 for zero vectors', () => {
      const a = [0, 0, 0]
      const b = [1, 2, 3]
      expect(cosineSimilarity(a, b)).toBe(0)
    })
  })

  describe('cosineDistance', () => {
    test('should return 0 for identical vectors', () => {
      const a = [1, 2, 3]
      const b = [1, 2, 3]
      expect(cosineDistance(a, b)).toBeCloseTo(0, 5)
    })

    test('should return 2 for opposite vectors', () => {
      const a = [1, 2, 3]
      const b = [-1, -2, -3]
      expect(cosineDistance(a, b)).toBeCloseTo(2, 5)
    })
  })

  describe('euclideanDistance', () => {
    test('should return 0 for identical vectors', () => {
      const a = [1, 2, 3]
      const b = [1, 2, 3]
      expect(euclideanDistance(a, b)).toBe(0)
    })

    test('should return correct distance', () => {
      const a = [0, 0]
      const b = [3, 4]
      expect(euclideanDistance(a, b)).toBe(5)
    })

    test('should handle Float32Array', () => {
      const a = new Float32Array([0, 0])
      const b = new Float32Array([3, 4])
      expect(euclideanDistance(a, b)).toBe(5)
    })
  })

  describe('l2Distance', () => {
    test('should be an alias for euclideanDistance', () => {
      const a = [0, 0]
      const b = [3, 4]
      expect(l2Distance(a, b)).toBe(euclideanDistance(a, b))
    })
  })

  describe('euclideanDistanceSquared', () => {
    test('should return squared distance', () => {
      const a = [0, 0]
      const b = [3, 4]
      expect(euclideanDistanceSquared(a, b)).toBe(25)
    })
  })

  describe('dotProduct', () => {
    test('should return correct dot product', () => {
      const a = [1, 2, 3]
      const b = [4, 5, 6]
      expect(dotProduct(a, b)).toBe(32) // 1*4 + 2*5 + 3*6 = 4 + 10 + 18 = 32
    })

    test('should return 0 for orthogonal vectors', () => {
      const a = [1, 0]
      const b = [0, 1]
      expect(dotProduct(a, b)).toBe(0)
    })

    test('should handle Float32Array', () => {
      const a = new Float32Array([1, 2, 3])
      const b = new Float32Array([4, 5, 6])
      expect(dotProduct(a, b)).toBe(32)
    })
  })

  describe('manhattanDistance', () => {
    test('should return 0 for identical vectors', () => {
      const a = [1, 2, 3]
      const b = [1, 2, 3]
      expect(manhattanDistance(a, b)).toBe(0)
    })

    test('should return correct L1 distance', () => {
      const a = [0, 0, 0]
      const b = [1, 2, 3]
      expect(manhattanDistance(a, b)).toBe(6) // |1| + |2| + |3| = 6
    })
  })
})

describe('Distance Metrics - Vector Utilities', () => {
  describe('normalizeVector', () => {
    test('should normalize to unit length', () => {
      const v = [3, 4]
      const normalized = normalizeVector(v)
      expect(magnitude(normalized)).toBeCloseTo(1, 5)
    })

    test('should preserve direction', () => {
      const v = [3, 4]
      const normalized = normalizeVector(v)
      expect(normalized[0]).toBeCloseTo(0.6, 5)
      expect(normalized[1]).toBeCloseTo(0.8, 5)
    })

    test('should return zero vector unchanged', () => {
      const v = [0, 0, 0]
      const normalized = normalizeVector(v)
      expect(normalized).toEqual(v)
    })
  })

  describe('normalizeFloat32', () => {
    test('should normalize Float32Array to unit length', () => {
      const v = new Float32Array([3, 4])
      const normalized = normalizeFloat32(v)
      expect(magnitude(normalized)).toBeCloseTo(1, 5)
    })
  })

  describe('magnitude', () => {
    test('should return correct magnitude', () => {
      const v = [3, 4]
      expect(magnitude(v)).toBe(5)
    })

    test('should return 0 for zero vector', () => {
      const v = [0, 0, 0]
      expect(magnitude(v)).toBe(0)
    })
  })
})

describe('Distance Metrics - Helpers', () => {
  describe('getDistanceFunction', () => {
    test('should return cosine distance for cosine metric', () => {
      const fn = getDistanceFunction('cosine')
      const a = [1, 2, 3]
      const b = [1, 2, 3]
      expect(fn(a, b)).toBeCloseTo(0, 5)
    })

    test('should return euclidean distance for euclidean metric', () => {
      const fn = getDistanceFunction('euclidean')
      const a = [0, 0]
      const b = [3, 4]
      expect(fn(a, b)).toBe(5)
    })

    test('should return negative dot product for dot metric', () => {
      const fn = getDistanceFunction('dot')
      const a = [1, 2, 3]
      const b = [4, 5, 6]
      expect(fn(a, b)).toBe(-32) // Negative so lower is better
    })

    test('should return manhattan distance for manhattan metric', () => {
      const fn = getDistanceFunction('manhattan')
      const a = [0, 0, 0]
      const b = [1, 2, 3]
      expect(fn(a, b)).toBe(6)
    })
  })

  describe('getSimilarityFunction', () => {
    test('should return cosine similarity for cosine metric', () => {
      const fn = getSimilarityFunction('cosine')
      const a = [1, 2, 3]
      const b = [1, 2, 3]
      expect(fn(a, b)).toBeCloseTo(1, 5)
    })

    test('should return dot product for dot metric', () => {
      const fn = getSimilarityFunction('dot')
      const a = [1, 2, 3]
      const b = [4, 5, 6]
      expect(fn(a, b)).toBe(32)
    })
  })

  describe('distanceToSimilarity', () => {
    test('should convert 0 distance to 1 similarity', () => {
      expect(distanceToSimilarity(0)).toBe(1)
    })

    test('should convert larger distances to smaller similarities', () => {
      expect(distanceToSimilarity(1)).toBe(0.5)
      expect(distanceToSimilarity(9)).toBe(0.1)
    })
  })

  describe('isHigherBetter', () => {
    test('should return true for cosine', () => {
      expect(isHigherBetter('cosine')).toBe(true)
    })

    test('should return true for dot', () => {
      expect(isHigherBetter('dot')).toBe(true)
    })

    test('should return false for euclidean', () => {
      expect(isHigherBetter('euclidean')).toBe(false)
    })

    test('should return false for manhattan', () => {
      expect(isHigherBetter('manhattan')).toBe(false)
    })
  })

  describe('getCompareFunction', () => {
    test('should sort by score descending for cosine', () => {
      const compare = getCompareFunction('cosine')
      const items = [{ score: 0.5 }, { score: 0.9 }, { score: 0.3 }]
      items.sort(compare)
      expect(items[0].score).toBe(0.9)
      expect(items[2].score).toBe(0.3)
    })

    test('should sort by score ascending for euclidean', () => {
      const compare = getCompareFunction('euclidean')
      const items = [{ score: 0.5 }, { score: 0.9 }, { score: 0.3 }]
      items.sort(compare)
      expect(items[0].score).toBe(0.3)
      expect(items[2].score).toBe(0.9)
    })
  })

  describe('calculateScore', () => {
    test('should return cosine similarity for cosine metric', () => {
      const a = [1, 2, 3]
      const b = [1, 2, 3]
      expect(calculateScore(a, b, 'cosine')).toBeCloseTo(1, 5)
    })

    test('should return converted euclidean distance for euclidean metric', () => {
      const a = [0, 0]
      const b = [0, 0]
      expect(calculateScore(a, b, 'euclidean')).toBe(1) // 0 distance = 1 similarity
    })

    test('should return dot product for dot metric', () => {
      const a = [1, 2, 3]
      const b = [4, 5, 6]
      expect(calculateScore(a, b, 'dot')).toBe(32)
    })
  })
})
