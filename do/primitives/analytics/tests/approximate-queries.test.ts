/**
 * Approximate Query Functions Tests - TDD Phase
 *
 * Tests for probabilistic data structures supporting approximate query processing:
 * - T-Digest: Percentile/quantile estimation (P50, P95, P99)
 * - Count-Min Sketch: Frequency estimation for streaming data
 * - TopK/Heavy Hitters: Finding most frequent items
 *
 * These tests define expected behavior and accuracy requirements.
 *
 * Acceptance Criteria:
 * - P50/P95/P99 within 1% of exact values on 1M rows
 * - Frequency estimates within 0.1% of actual
 * - TopK returns correct items with 95%+ accuracy
 * - Merge operations preserve accuracy
 * - Memory usage <1MB for 10M distinct values
 *
 * @module db/primitives/analytics/tests/approximate-queries
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  TDigest,
  createTDigest,
  CountMinSketch,
  createCountMinSketch,
  TopK,
  createTopK,
} from '../approximate-queries'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Generate uniform random values
 */
function generateUniform(count: number, min: number, max: number): number[] {
  const values: number[] = []
  for (let i = 0; i < count; i++) {
    values.push(min + Math.random() * (max - min))
  }
  return values
}

/**
 * Generate normal distribution values using Box-Muller transform
 */
function generateNormal(count: number, mean: number, stddev: number): number[] {
  const values: number[] = []
  for (let i = 0; i < count; i += 2) {
    const u1 = Math.random()
    const u2 = Math.random()
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    const z1 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2)
    values.push(mean + z0 * stddev)
    if (i + 1 < count) {
      values.push(mean + z1 * stddev)
    }
  }
  return values
}

/**
 * Generate exponential distribution values
 */
function generateExponential(count: number, lambda: number): number[] {
  const values: number[] = []
  for (let i = 0; i < count; i++) {
    values.push(-Math.log(1 - Math.random()) / lambda)
  }
  return values
}

/**
 * Calculate exact percentile from sorted array
 */
function exactPercentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  const index = (p / 100) * (sorted.length - 1)
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  const weight = index - lower
  if (lower === upper) {
    return sorted[lower]!
  }
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight
}

/**
 * Calculate exact frequency counts
 */
function exactFrequencies<T>(values: T[]): Map<T, number> {
  const counts = new Map<T, number>()
  for (const value of values) {
    counts.set(value, (counts.get(value) || 0) + 1)
  }
  return counts
}

/**
 * Get exact top-K items
 */
function exactTopK<T>(values: T[], k: number): Array<{ value: T; count: number }> {
  const freqs = exactFrequencies(values)
  const sorted: Array<[T, number]> = []
  freqs.forEach((count, value) => sorted.push([value, count]))
  sorted.sort((a, b) => b[1] - a[1])
  return sorted.slice(0, k).map(([value, count]) => ({ value, count }))
}

// ============================================================================
// T-Digest Tests
// ============================================================================

describe('TDigest', () => {
  describe('basic operations', () => {
    it('should create an empty t-digest', () => {
      const digest = createTDigest()
      expect(digest).toBeDefined()
      expect(digest.count()).toBe(0)
    })

    it('should add single value', () => {
      const digest = createTDigest()
      digest.add(42)
      expect(digest.count()).toBe(1)
    })

    it('should add multiple values', () => {
      const digest = createTDigest()
      digest.add(10)
      digest.add(20)
      digest.add(30)
      expect(digest.count()).toBe(3)
    })

    it('should add batch of values', () => {
      const digest = createTDigest()
      digest.addBatch([1, 2, 3, 4, 5])
      expect(digest.count()).toBe(5)
    })

    it('should handle empty batch', () => {
      const digest = createTDigest()
      digest.addBatch([])
      expect(digest.count()).toBe(0)
    })

    it('should handle negative values', () => {
      const digest = createTDigest()
      digest.addBatch([-100, -50, 0, 50, 100])
      expect(digest.count()).toBe(5)
    })

    it('should handle duplicate values', () => {
      const digest = createTDigest()
      digest.addBatch([5, 5, 5, 5, 5])
      expect(digest.count()).toBe(5)
    })

    it('should handle very large values', () => {
      const digest = createTDigest()
      digest.addBatch([1e10, 1e12, 1e14])
      expect(digest.count()).toBe(3)
    })

    it('should handle very small values', () => {
      const digest = createTDigest()
      digest.addBatch([1e-10, 1e-12, 1e-14])
      expect(digest.count()).toBe(3)
    })
  })

  describe('percentile estimation', () => {
    let digest: TDigest

    beforeEach(() => {
      digest = createTDigest()
    })

    it('should estimate median (P50) for uniform data', () => {
      const values = generateUniform(10000, 0, 100)
      digest.addBatch(values)

      const estimated = digest.percentile(50)
      const exact = exactPercentile(values, 50)

      // Should be within 1% of exact value
      const errorRate = Math.abs(estimated - exact) / exact
      expect(errorRate).toBeLessThan(0.01)
    })

    it('should estimate P95 for uniform data', () => {
      const values = generateUniform(10000, 0, 100)
      digest.addBatch(values)

      const estimated = digest.percentile(95)
      const exact = exactPercentile(values, 95)

      const errorRate = Math.abs(estimated - exact) / exact
      expect(errorRate).toBeLessThan(0.01)
    })

    it('should estimate P99 for uniform data', () => {
      const values = generateUniform(10000, 0, 100)
      digest.addBatch(values)

      const estimated = digest.percentile(99)
      const exact = exactPercentile(values, 99)

      const errorRate = Math.abs(estimated - exact) / exact
      expect(errorRate).toBeLessThan(0.01)
    })

    it('should estimate P1 (low percentile) accurately', () => {
      const values = generateUniform(10000, 0, 100)
      digest.addBatch(values)

      const estimated = digest.percentile(1)
      const exact = exactPercentile(values, 1)

      const errorRate = Math.abs(estimated - exact) / Math.max(exact, 1)
      expect(errorRate).toBeLessThan(0.02) // Allow slightly more error at extremes
    })

    it('should estimate percentiles for normal distribution', () => {
      const values = generateNormal(10000, 100, 15)
      digest.addBatch(values)

      const estimated50 = digest.percentile(50)
      const exact50 = exactPercentile(values, 50)

      const errorRate = Math.abs(estimated50 - exact50) / exact50
      expect(errorRate).toBeLessThan(0.01)
    })

    it('should estimate percentiles for exponential distribution', () => {
      const values = generateExponential(10000, 0.5)
      digest.addBatch(values)

      const estimated50 = digest.percentile(50)
      const exact50 = exactPercentile(values, 50)

      const errorRate = Math.abs(estimated50 - exact50) / exact50
      expect(errorRate).toBeLessThan(0.01)
    })

    it('should return min for P0', () => {
      const values = [10, 20, 30, 40, 50]
      digest.addBatch(values)

      const estimated = digest.percentile(0)
      expect(estimated).toBe(10)
    })

    it('should return max for P100', () => {
      const values = [10, 20, 30, 40, 50]
      digest.addBatch(values)

      const estimated = digest.percentile(100)
      expect(estimated).toBe(50)
    })

    it('should handle single value', () => {
      digest.add(42)

      expect(digest.percentile(0)).toBe(42)
      expect(digest.percentile(50)).toBe(42)
      expect(digest.percentile(100)).toBe(42)
    })

    it('should throw for invalid percentile (< 0)', () => {
      digest.add(42)
      expect(() => digest.percentile(-1)).toThrow()
    })

    it('should throw for invalid percentile (> 100)', () => {
      digest.add(42)
      expect(() => digest.percentile(101)).toThrow()
    })

    it('should throw for empty digest', () => {
      expect(() => digest.percentile(50)).toThrow()
    })
  })

  describe('multiple percentiles', () => {
    it('should calculate multiple percentiles efficiently', () => {
      const digest = createTDigest()
      const values = generateUniform(10000, 0, 100)
      digest.addBatch(values)

      const percentiles = digest.percentiles([25, 50, 75, 90, 95, 99])

      expect(percentiles.length).toBe(6)
      // Should be in ascending order
      for (let i = 1; i < percentiles.length; i++) {
        expect(percentiles[i]!).toBeGreaterThanOrEqual(percentiles[i - 1]!)
      }
    })

    it('should return empty array for empty percentile list', () => {
      const digest = createTDigest()
      digest.addBatch([1, 2, 3])

      const percentiles = digest.percentiles([])
      expect(percentiles).toEqual([])
    })
  })

  describe('1M row accuracy (acceptance criteria)', () => {
    it('should maintain <1% error for P50 on 1M rows', () => {
      const digest = createTDigest()
      const values = generateUniform(1_000_000, 0, 1000)
      digest.addBatch(values)

      const estimated = digest.percentile(50)
      const exact = exactPercentile(values, 50)

      const errorRate = Math.abs(estimated - exact) / exact
      expect(errorRate).toBeLessThan(0.01)
    })

    it('should maintain <1% error for P95 on 1M rows', () => {
      const digest = createTDigest()
      const values = generateUniform(1_000_000, 0, 1000)
      digest.addBatch(values)

      const estimated = digest.percentile(95)
      const exact = exactPercentile(values, 95)

      const errorRate = Math.abs(estimated - exact) / exact
      expect(errorRate).toBeLessThan(0.01)
    })

    it('should maintain <1% error for P99 on 1M rows', () => {
      const digest = createTDigest()
      const values = generateUniform(1_000_000, 0, 1000)
      digest.addBatch(values)

      const estimated = digest.percentile(99)
      const exact = exactPercentile(values, 99)

      const errorRate = Math.abs(estimated - exact) / exact
      expect(errorRate).toBeLessThan(0.01)
    })
  })

  describe('merge operations', () => {
    it('should merge two digests', () => {
      const digest1 = createTDigest()
      const digest2 = createTDigest()

      digest1.addBatch([1, 2, 3, 4, 5])
      digest2.addBatch([6, 7, 8, 9, 10])

      const merged = digest1.merge(digest2)

      expect(merged.count()).toBe(10)
    })

    it('should preserve accuracy after merge', () => {
      const digest1 = createTDigest()
      const digest2 = createTDigest()

      const values1 = generateUniform(5000, 0, 50)
      const values2 = generateUniform(5000, 50, 100)

      digest1.addBatch(values1)
      digest2.addBatch(values2)

      const merged = digest1.merge(digest2)
      const allValues = [...values1, ...values2]

      const estimatedP50 = merged.percentile(50)
      const exactP50 = exactPercentile(allValues, 50)

      const errorRate = Math.abs(estimatedP50 - exactP50) / exactP50
      expect(errorRate).toBeLessThan(0.01)
    })

    it('should merge multiple digests', () => {
      const digests = [createTDigest(), createTDigest(), createTDigest()]
      const allValues: number[] = []

      for (let i = 0; i < 3; i++) {
        const values = generateUniform(1000, i * 100, (i + 1) * 100)
        digests[i]!.addBatch(values)
        allValues.push(...values)
      }

      let merged = digests[0]!
      for (let i = 1; i < digests.length; i++) {
        merged = merged.merge(digests[i]!)
      }

      expect(merged.count()).toBe(3000)

      const estimatedP50 = merged.percentile(50)
      const exactP50 = exactPercentile(allValues, 50)

      const errorRate = Math.abs(estimatedP50 - exactP50) / exactP50
      expect(errorRate).toBeLessThan(0.01)
    })

    it('should merge with empty digest', () => {
      const digest1 = createTDigest()
      const digest2 = createTDigest()

      digest1.addBatch([1, 2, 3, 4, 5])

      const merged = digest1.merge(digest2)
      expect(merged.count()).toBe(5)
    })

    it('should handle merge of two empty digests', () => {
      const digest1 = createTDigest()
      const digest2 = createTDigest()

      const merged = digest1.merge(digest2)
      expect(merged.count()).toBe(0)
    })
  })

  describe('configuration', () => {
    it('should accept custom compression parameter', () => {
      const digest = createTDigest({ compression: 200 })
      expect(digest).toBeDefined()
    })

    it('should use default compression of 100', () => {
      const digest = createTDigest()
      digest.addBatch(generateUniform(10000, 0, 100))
      // Default compression should give reasonable accuracy
      const estimated = digest.percentile(50)
      expect(estimated).toBeGreaterThan(40)
      expect(estimated).toBeLessThan(60)
    })

    it('should improve accuracy with higher compression', () => {
      const values = generateUniform(10000, 0, 100)

      const digestLow = createTDigest({ compression: 50 })
      const digestHigh = createTDigest({ compression: 200 })

      digestLow.addBatch(values)
      digestHigh.addBatch(values)

      const exact = exactPercentile(values, 99)
      const errorLow = Math.abs(digestLow.percentile(99) - exact) / exact
      const errorHigh = Math.abs(digestHigh.percentile(99) - exact) / exact

      // Higher compression should give equal or better accuracy
      expect(errorHigh).toBeLessThanOrEqual(errorLow + 0.001) // Allow tiny variance
    })
  })

  describe('min/max tracking', () => {
    it('should track minimum value', () => {
      const digest = createTDigest()
      digest.addBatch([50, 30, 70, 10, 90])

      expect(digest.min()).toBe(10)
    })

    it('should track maximum value', () => {
      const digest = createTDigest()
      digest.addBatch([50, 30, 70, 10, 90])

      expect(digest.max()).toBe(90)
    })

    it('should throw min/max for empty digest', () => {
      const digest = createTDigest()
      expect(() => digest.min()).toThrow()
      expect(() => digest.max()).toThrow()
    })
  })

  describe('serialization', () => {
    it('should serialize to bytes', () => {
      const digest = createTDigest()
      digest.addBatch([1, 2, 3, 4, 5])

      const bytes = digest.serialize()
      expect(bytes).toBeInstanceOf(Uint8Array)
      expect(bytes.length).toBeGreaterThan(0)
    })

    it('should deserialize from bytes', () => {
      const original = createTDigest()
      original.addBatch([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])

      const bytes = original.serialize()
      const restored = createTDigest()
      restored.deserialize(bytes)

      expect(restored.count()).toBe(original.count())
      expect(restored.percentile(50)).toBeCloseTo(original.percentile(50), 5)
    })

    it('should preserve accuracy after serialization round-trip', () => {
      const original = createTDigest()
      const values = generateUniform(10000, 0, 100)
      original.addBatch(values)

      const bytes = original.serialize()
      const restored = createTDigest()
      restored.deserialize(bytes)

      const originalP95 = original.percentile(95)
      const restoredP95 = restored.percentile(95)

      expect(Math.abs(originalP95 - restoredP95) / originalP95).toBeLessThan(0.001)
    })
  })
})

// ============================================================================
// Count-Min Sketch Tests
// ============================================================================

describe('CountMinSketch', () => {
  describe('basic operations', () => {
    it('should create an empty sketch', () => {
      const sketch = createCountMinSketch()
      expect(sketch).toBeDefined()
    })

    it('should add single item', () => {
      const sketch = createCountMinSketch()
      sketch.add('item1')
      expect(sketch.frequency('item1')).toBeGreaterThanOrEqual(1)
    })

    it('should add item with count', () => {
      const sketch = createCountMinSketch()
      sketch.add('item1', 5)
      expect(sketch.frequency('item1')).toBeGreaterThanOrEqual(5)
    })

    it('should handle string items', () => {
      const sketch = createCountMinSketch()
      sketch.add('hello')
      sketch.add('world')
      expect(sketch.frequency('hello')).toBeGreaterThanOrEqual(1)
      expect(sketch.frequency('world')).toBeGreaterThanOrEqual(1)
    })

    it('should handle number items', () => {
      const sketch = createCountMinSketch()
      sketch.add(42)
      sketch.add(100)
      expect(sketch.frequency(42)).toBeGreaterThanOrEqual(1)
      expect(sketch.frequency(100)).toBeGreaterThanOrEqual(1)
    })

    it('should handle empty strings', () => {
      const sketch = createCountMinSketch()
      sketch.add('')
      expect(sketch.frequency('')).toBeGreaterThanOrEqual(1)
    })

    it('should return 0 for unseen items', () => {
      const sketch = createCountMinSketch()
      sketch.add('seen')
      expect(sketch.frequency('unseen')).toBe(0)
    })
  })

  describe('frequency estimation', () => {
    it('should estimate frequency accurately for high-frequency items', () => {
      const sketch = createCountMinSketch({ width: 10000, depth: 7 })

      // Add item 1000 times
      for (let i = 0; i < 1000; i++) {
        sketch.add('frequent')
      }
      // Add other items
      for (let i = 0; i < 10000; i++) {
        sketch.add(`item_${i}`)
      }

      const estimated = sketch.frequency('frequent')
      // Count-Min Sketch overestimates, so should be >= actual
      expect(estimated).toBeGreaterThanOrEqual(1000)
      // Error should be within reasonable bounds
      expect(estimated).toBeLessThan(1100) // <10% overestimate
    })

    it('should never underestimate frequency', () => {
      const sketch = createCountMinSketch()

      const counts = new Map<string, number>()
      for (let i = 0; i < 1000; i++) {
        const item = `item_${i % 100}`
        sketch.add(item)
        counts.set(item, (counts.get(item) || 0) + 1)
      }

      counts.forEach((actualCount, item) => {
        const estimated = sketch.frequency(item)
        expect(estimated).toBeGreaterThanOrEqual(actualCount)
      })
    })

    it('should estimate within 0.1% of total count for high-frequency items', () => {
      const sketch = createCountMinSketch({ width: 10000, depth: 7 })

      const totalItems = 100000
      const targetFrequency = 1000

      // Add target item targetFrequency times
      for (let i = 0; i < targetFrequency; i++) {
        sketch.add('target')
      }
      // Add random items
      for (let i = 0; i < totalItems - targetFrequency; i++) {
        sketch.add(`random_${i}`)
      }

      const estimated = sketch.frequency('target')
      const error = estimated - targetFrequency
      const errorRate = error / totalItems

      // Error should be within 0.1% of total stream size
      expect(errorRate).toBeLessThan(0.001)
    })
  })

  describe('configuration', () => {
    it('should accept width and depth parameters', () => {
      const sketch = createCountMinSketch({ width: 1000, depth: 5 })
      expect(sketch).toBeDefined()
    })

    it('should accept epsilon and delta for automatic sizing', () => {
      const sketch = createCountMinSketch({ epsilon: 0.001, delta: 0.01 })
      expect(sketch).toBeDefined()
    })

    it('should use sensible defaults', () => {
      const sketch = createCountMinSketch()
      sketch.add('test', 100)
      expect(sketch.frequency('test')).toBeGreaterThanOrEqual(100)
    })

    it('should improve accuracy with larger width', () => {
      const values: string[] = []
      for (let i = 0; i < 10000; i++) {
        values.push(`item_${i % 100}`)
      }

      const sketchSmall = createCountMinSketch({ width: 100, depth: 5 })
      const sketchLarge = createCountMinSketch({ width: 10000, depth: 5 })

      for (const v of values) {
        sketchSmall.add(v)
        sketchLarge.add(v)
      }

      // Large sketch should have less overestimation
      const errorSmall = sketchSmall.frequency('item_0') - 100
      const errorLarge = sketchLarge.frequency('item_0') - 100

      expect(errorLarge).toBeLessThanOrEqual(errorSmall)
    })
  })

  describe('merge operations', () => {
    it('should merge two sketches', () => {
      const sketch1 = createCountMinSketch({ width: 1000, depth: 5 })
      const sketch2 = createCountMinSketch({ width: 1000, depth: 5 })

      for (let i = 0; i < 100; i++) {
        sketch1.add('item_a')
        sketch2.add('item_a')
      }

      const merged = sketch1.merge(sketch2)
      expect(merged.frequency('item_a')).toBeGreaterThanOrEqual(200)
    })

    it('should preserve counts after merge', () => {
      const sketch1 = createCountMinSketch({ width: 1000, depth: 5 })
      const sketch2 = createCountMinSketch({ width: 1000, depth: 5 })

      sketch1.add('only_in_1', 50)
      sketch2.add('only_in_2', 75)
      sketch1.add('in_both', 30)
      sketch2.add('in_both', 40)

      const merged = sketch1.merge(sketch2)

      expect(merged.frequency('only_in_1')).toBeGreaterThanOrEqual(50)
      expect(merged.frequency('only_in_2')).toBeGreaterThanOrEqual(75)
      expect(merged.frequency('in_both')).toBeGreaterThanOrEqual(70)
    })

    it('should throw when merging incompatible sketches', () => {
      const sketch1 = createCountMinSketch({ width: 100, depth: 5 })
      const sketch2 = createCountMinSketch({ width: 200, depth: 5 })

      expect(() => sketch1.merge(sketch2)).toThrow()
    })
  })

  describe('memory efficiency', () => {
    it('should use sub-linear space', () => {
      // For 10M distinct values, should use <1MB
      // width=10000, depth=7 = 70000 counters * 4 bytes = 280KB
      const sketch = createCountMinSketch({ width: 10000, depth: 7 })

      for (let i = 0; i < 10_000_000; i++) {
        sketch.add(`item_${i}`)
      }

      // Sketch should still work (memory is fixed regardless of items)
      expect(sketch.frequency('item_0')).toBeGreaterThanOrEqual(1)
      expect(sketch.frequency('item_9999999')).toBeGreaterThanOrEqual(1)
    })
  })

  describe('serialization', () => {
    it('should serialize to bytes', () => {
      const sketch = createCountMinSketch()
      sketch.add('item1', 100)

      const bytes = sketch.serialize()
      expect(bytes).toBeInstanceOf(Uint8Array)
    })

    it('should deserialize from bytes', () => {
      const original = createCountMinSketch({ width: 1000, depth: 5 })
      original.add('test', 42)

      const bytes = original.serialize()
      const restored = createCountMinSketch({ width: 1000, depth: 5 })
      restored.deserialize(bytes)

      expect(restored.frequency('test')).toBe(original.frequency('test'))
    })
  })
})

// ============================================================================
// TopK Tests
// ============================================================================

describe('TopK', () => {
  describe('basic operations', () => {
    it('should create a TopK tracker', () => {
      const topk = createTopK(10)
      expect(topk).toBeDefined()
    })

    it('should add items', () => {
      const topk = createTopK(10)
      topk.add('item1')
      topk.add('item2')
      topk.add('item1')

      const results = topk.getTopK()
      expect(results.length).toBeGreaterThan(0)
    })

    it('should return items sorted by frequency', () => {
      const topk = createTopK(10)

      // Add items with different frequencies
      for (let i = 0; i < 100; i++) topk.add('frequent')
      for (let i = 0; i < 50; i++) topk.add('medium')
      for (let i = 0; i < 10; i++) topk.add('rare')

      const results = topk.getTopK()

      expect(results[0]!.value).toBe('frequent')
      expect(results[1]!.value).toBe('medium')
      expect(results[2]!.value).toBe('rare')
    })

    it('should limit results to K items', () => {
      const topk = createTopK(3)

      for (let i = 0; i < 10; i++) {
        topk.add(`item_${i}`, (10 - i) * 10)
      }

      const results = topk.getTopK()
      expect(results.length).toBe(3)
    })

    it('should handle empty tracker', () => {
      const topk = createTopK(10)
      const results = topk.getTopK()
      expect(results).toEqual([])
    })
  })

  describe('accuracy', () => {
    it('should correctly identify top items with 95%+ accuracy', () => {
      const topk = createTopK(10)

      // Create Zipf-like distribution
      const items: string[] = []
      for (let i = 0; i < 100; i++) {
        const frequency = Math.floor(10000 / (i + 1))
        for (let j = 0; j < frequency; j++) {
          items.push(`item_${i}`)
        }
      }

      // Shuffle and add
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[items[i], items[j]] = [items[j]!, items[i]!]
      }

      for (const item of items) {
        topk.add(item)
      }

      const exactTop = exactTopK(items, 10).map((r) => r.value)
      const estimatedTop = topk.getTopK().map((r) => r.value)

      // Count how many of the true top-10 are in our estimated top-10
      let correctCount = 0
      for (const item of exactTop) {
        if (estimatedTop.includes(item)) {
          correctCount++
        }
      }

      const accuracy = correctCount / 10
      expect(accuracy).toBeGreaterThanOrEqual(0.95)
    })

    it('should estimate counts reasonably accurately', () => {
      const topk = createTopK(10)

      // Add known frequencies
      for (let i = 0; i < 1000; i++) topk.add('a')
      for (let i = 0; i < 500; i++) topk.add('b')
      for (let i = 0; i < 100; i++) topk.add('c')

      const results = topk.getTopK()

      const countA = results.find((r) => r.value === 'a')?.count ?? 0
      const countB = results.find((r) => r.value === 'b')?.count ?? 0
      const countC = results.find((r) => r.value === 'c')?.count ?? 0

      // Counts should be approximately correct (within 10%)
      expect(countA).toBeGreaterThanOrEqual(900)
      expect(countA).toBeLessThanOrEqual(1100)
      expect(countB).toBeGreaterThanOrEqual(450)
      expect(countB).toBeLessThanOrEqual(550)
      expect(countC).toBeGreaterThanOrEqual(90)
      expect(countC).toBeLessThanOrEqual(110)
    })
  })

  describe('streaming behavior', () => {
    it('should handle continuous stream updates', () => {
      const topk = createTopK(5)

      // Simulate streaming data
      for (let round = 0; round < 100; round++) {
        for (let i = 0; i < 10; i++) {
          topk.add(`item_${i}`)
        }
        // Periodically add a frequent item
        if (round % 2 === 0) {
          topk.add('frequent', 10)
        }
      }

      const results = topk.getTopK()
      expect(results[0]!.value).toBe('frequent')
    })

    it('should adapt to changing frequencies', () => {
      const topk = createTopK(3)

      // Phase 1: item_a is most frequent
      for (let i = 0; i < 1000; i++) {
        topk.add('item_a')
        if (i % 10 === 0) topk.add('item_b')
      }

      // Phase 2: item_b becomes most frequent
      for (let i = 0; i < 2000; i++) {
        topk.add('item_b')
        if (i % 10 === 0) topk.add('item_a')
      }

      const results = topk.getTopK()
      // item_b should now be more frequent overall
      expect(results[0]!.value).toBe('item_b')
    })
  })

  describe('edge cases', () => {
    it('should handle K=1', () => {
      const topk = createTopK(1)
      topk.add('a', 10)
      topk.add('b', 20)

      const results = topk.getTopK()
      expect(results.length).toBe(1)
      expect(results[0]!.value).toBe('b')
    })

    it('should handle very large K', () => {
      const topk = createTopK(1000)

      for (let i = 0; i < 100; i++) {
        topk.add(`item_${i}`)
      }

      const results = topk.getTopK()
      // Should return all items since we have fewer than K
      expect(results.length).toBe(100)
    })

    it('should handle tied frequencies', () => {
      const topk = createTopK(5)

      topk.add('a', 100)
      topk.add('b', 100)
      topk.add('c', 100)

      const results = topk.getTopK()
      expect(results.length).toBe(3)
      // All should have same count (approximately)
      const counts = results.map((r) => r.count)
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThan(10)
    })
  })

  describe('configuration', () => {
    it('should accept custom CMS parameters', () => {
      const topk = createTopK(10, { cmsWidth: 10000, cmsDepth: 7 })
      topk.add('test')
      expect(topk.getTopK().length).toBeGreaterThan(0)
    })
  })

  describe('merge operations', () => {
    it('should merge two TopK trackers', () => {
      const topk1 = createTopK(10)
      const topk2 = createTopK(10)

      topk1.add('a', 100)
      topk1.add('b', 50)
      topk2.add('a', 100)
      topk2.add('c', 75)

      const merged = topk1.merge(topk2)
      const results = merged.getTopK()

      // 'a' should be most frequent (200 total)
      expect(results[0]!.value).toBe('a')
      expect(results[0]!.count).toBeGreaterThanOrEqual(200)
    })
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('Integration', () => {
  describe('combined approximate analytics', () => {
    it('should support typical analytics workflow', () => {
      // Simulate response time analytics
      const digest = createTDigest()
      const frequencies = createCountMinSketch()
      const topEndpoints = createTopK(5)

      // Simulate 10000 requests
      const endpoints = ['/api/users', '/api/posts', '/api/comments', '/api/likes', '/api/search']

      for (let i = 0; i < 10000; i++) {
        // Response time (normal distribution around 100ms)
        const responseTime = 100 + (Math.random() - 0.5) * 50
        digest.add(responseTime)

        // Endpoint frequency (power law)
        const endpointIdx = Math.floor(Math.pow(Math.random(), 2) * endpoints.length)
        const endpoint = endpoints[endpointIdx]!
        frequencies.add(endpoint)
        topEndpoints.add(endpoint)
      }

      // Get P50, P95, P99 latencies
      const p50 = digest.percentile(50)
      const p95 = digest.percentile(95)
      const p99 = digest.percentile(99)

      expect(p50).toBeGreaterThan(80)
      expect(p50).toBeLessThan(120)
      expect(p95).toBeGreaterThan(p50)
      expect(p99).toBeGreaterThan(p95)

      // Get top endpoints
      const top = topEndpoints.getTopK()
      expect(top.length).toBeGreaterThan(0)

      // Verify '/api/users' is likely top (due to power law)
      const topValues = top.map((r) => r.value)
      expect(topValues.includes('/api/users')).toBe(true)
    })
  })

  describe('distributed merge scenario', () => {
    it('should maintain accuracy when merging from multiple workers', () => {
      const workerCount = 4
      const digestsPerWorker: TDigest[] = []
      const sketchesPerWorker: CountMinSketch[] = []

      // Simulate 4 workers each processing 25K values
      for (let w = 0; w < workerCount; w++) {
        const digest = createTDigest()
        const sketch = createCountMinSketch({ width: 1000, depth: 5 })

        const values = generateUniform(25000, 0, 100)
        digest.addBatch(values)

        for (const v of values) {
          sketch.add(Math.floor(v).toString())
        }

        digestsPerWorker.push(digest)
        sketchesPerWorker.push(sketch)
      }

      // Merge all digests
      let mergedDigest = digestsPerWorker[0]!
      for (let i = 1; i < digestsPerWorker.length; i++) {
        mergedDigest = mergedDigest.merge(digestsPerWorker[i]!)
      }

      // Merge all sketches
      let mergedSketch = sketchesPerWorker[0]!
      for (let i = 1; i < sketchesPerWorker.length; i++) {
        mergedSketch = mergedSketch.merge(sketchesPerWorker[i]!)
      }

      // Verify combined results
      expect(mergedDigest.count()).toBe(100000)

      const p50 = mergedDigest.percentile(50)
      // For uniform [0, 100], median should be ~50
      expect(p50).toBeGreaterThan(45)
      expect(p50).toBeLessThan(55)
    })
  })
})
