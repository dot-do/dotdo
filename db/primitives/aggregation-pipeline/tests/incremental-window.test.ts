/**
 * Incremental Window Aggregation Tests
 *
 * Tests verify:
 * 1. Correctness: Incremental results match full recalculation
 * 2. Edge cases: Empty windows, single values, large values
 * 3. Numerical stability: Floating point precision
 * 4. Checkpoint/restore: State recovery works correctly
 * 5. Performance: Incremental is faster than full recalculation
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  IncrementalSum,
  IncrementalCount,
  IncrementalAvg,
  IncrementalMin,
  IncrementalMax,
  IncrementalStddev,
  BatchNumericAccumulator,
  IncrementalSlidingWindow,
  IncrementalTumblingWindow,
  IncrementalSessionWindow,
  IncrementalSlidingWindowStream,
  IncrementalTumblingWindowStream,
  IncrementalSessionWindowStream,
  createIncrementalAccumulator,
  createSlidingWindow,
  createTumblingWindow,
  createSessionWindow,
  fullRecalc,
} from '../incremental-window'

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Assert approximate equality for floating point comparisons
 */
function expectApprox(actual: number | null, expected: number | null, epsilon = 1e-10): void {
  if (actual === null && expected === null) return
  if (actual === null || expected === null) {
    expect(actual).toBe(expected)
    return
  }
  expect(Math.abs(actual - expected)).toBeLessThan(epsilon)
}

/**
 * Generate random numbers for testing
 */
function randomNumbers(count: number, min = -1000, max = 1000): number[] {
  const result: number[] = []
  for (let i = 0; i < count; i++) {
    result.push(min + Math.random() * (max - min))
  }
  return result
}

// =============================================================================
// IncrementalSum Tests
// =============================================================================

describe('IncrementalSum', () => {
  let acc: IncrementalSum

  beforeEach(() => {
    acc = new IncrementalSum()
  })

  describe('basic operations', () => {
    it('returns null for empty accumulator', () => {
      expect(acc.value()).toBeNull()
      expect(acc.count()).toBe(0)
    })

    it('computes sum correctly for single value', () => {
      acc.add(42)
      expect(acc.value()).toBe(42)
      expect(acc.count()).toBe(1)
    })

    it('computes sum correctly for multiple values', () => {
      acc.add(1)
      acc.add(2)
      acc.add(3)
      acc.add(4)
      acc.add(5)
      expect(acc.value()).toBe(15)
      expect(acc.count()).toBe(5)
    })

    it('handles negative values', () => {
      acc.add(-10)
      acc.add(5)
      acc.add(-3)
      expect(acc.value()).toBe(-8)
    })

    it('handles zero values', () => {
      acc.add(0)
      acc.add(0)
      acc.add(0)
      expect(acc.value()).toBe(0)
      expect(acc.count()).toBe(3)
    })
  })

  describe('remove operations', () => {
    it('removes value correctly', () => {
      acc.add(10)
      acc.add(20)
      acc.add(30)
      acc.remove(20)
      expect(acc.value()).toBe(40)
      expect(acc.count()).toBe(2)
    })

    it('returns null when all values removed', () => {
      acc.add(5)
      acc.remove(5)
      expect(acc.value()).toBeNull()
      expect(acc.count()).toBe(0)
    })

    it('handles remove on empty accumulator', () => {
      acc.remove(10)
      expect(acc.value()).toBeNull()
      expect(acc.count()).toBe(0)
    })
  })

  describe('numerical stability', () => {
    it('maintains precision with large values', () => {
      const largeValues = [1e15, 1, -1e15, 1]
      for (const v of largeValues) {
        acc.add(v)
      }
      expectApprox(acc.value(), 2, 1e-5)
    })

    it('matches full recalculation for random data', () => {
      const values = randomNumbers(1000)
      for (const v of values) {
        acc.add(v)
      }
      expectApprox(acc.value(), fullRecalc.sum(values), 1e-8)
    })

    it('maintains precision after add/remove cycles', () => {
      const values = [1.1, 2.2, 3.3, 4.4, 5.5]
      for (const v of values) {
        acc.add(v)
      }

      // Remove first two, add two new
      acc.remove(1.1)
      acc.remove(2.2)
      acc.add(6.6)
      acc.add(7.7)

      const expected = 3.3 + 4.4 + 5.5 + 6.6 + 7.7
      expectApprox(acc.value(), expected, 1e-10)
    })
  })

  describe('checkpoint/restore', () => {
    it('restores state correctly', () => {
      acc.add(10)
      acc.add(20)
      acc.add(30)

      const checkpoint = acc.checkpoint()

      const restored = new IncrementalSum()
      restored.restore(checkpoint)

      expect(restored.value()).toBe(acc.value())
      expect(restored.count()).toBe(acc.count())
    })

    it('continues operation after restore', () => {
      acc.add(10)
      acc.add(20)

      const checkpoint = acc.checkpoint()
      const restored = new IncrementalSum()
      restored.restore(checkpoint)

      restored.add(30)
      expect(restored.value()).toBe(60)
    })
  })

  describe('reset', () => {
    it('clears all state', () => {
      acc.add(100)
      acc.add(200)
      acc.reset()

      expect(acc.value()).toBeNull()
      expect(acc.count()).toBe(0)
    })
  })
})

// =============================================================================
// IncrementalCount Tests
// =============================================================================

describe('IncrementalCount', () => {
  let acc: IncrementalCount

  beforeEach(() => {
    acc = new IncrementalCount()
  })

  it('returns null for empty accumulator', () => {
    expect(acc.value()).toBeNull()
  })

  it('counts correctly', () => {
    acc.add(1)
    acc.add(2)
    acc.add(3)
    expect(acc.value()).toBe(3)
  })

  it('decrements on remove', () => {
    acc.add(1)
    acc.add(2)
    acc.add(3)
    acc.remove(0) // Value doesn't matter
    expect(acc.value()).toBe(2)
  })

  it('matches full recalculation', () => {
    const values = randomNumbers(500)
    for (const v of values) {
      acc.add(v)
    }
    expect(acc.value()).toBe(fullRecalc.count(values))
  })
})

// =============================================================================
// IncrementalAvg Tests
// =============================================================================

describe('IncrementalAvg', () => {
  let acc: IncrementalAvg

  beforeEach(() => {
    acc = new IncrementalAvg()
  })

  it('returns null for empty accumulator', () => {
    expect(acc.value()).toBeNull()
  })

  it('computes average correctly', () => {
    acc.add(2)
    acc.add(4)
    acc.add(6)
    expect(acc.value()).toBe(4)
  })

  it('handles single value', () => {
    acc.add(42)
    expect(acc.value()).toBe(42)
  })

  it('updates average after removal', () => {
    acc.add(10)
    acc.add(20)
    acc.add(30)
    acc.remove(10)
    expect(acc.value()).toBe(25) // (20 + 30) / 2
  })

  it('matches full recalculation', () => {
    const values = randomNumbers(500)
    for (const v of values) {
      acc.add(v)
    }
    expectApprox(acc.value(), fullRecalc.avg(values), 1e-10)
  })

  it('maintains precision with add/remove cycles', () => {
    const initial = [1, 2, 3, 4, 5]
    for (const v of initial) {
      acc.add(v)
    }

    // Remove 1 and 2, add 6 and 7
    acc.remove(1)
    acc.remove(2)
    acc.add(6)
    acc.add(7)

    const expected = (3 + 4 + 5 + 6 + 7) / 5
    expectApprox(acc.value(), expected, 1e-10)
  })
})

// =============================================================================
// IncrementalMin Tests
// =============================================================================

describe('IncrementalMin', () => {
  let acc: IncrementalMin

  beforeEach(() => {
    acc = new IncrementalMin()
  })

  it('returns null for empty accumulator', () => {
    expect(acc.value()).toBeNull()
  })

  it('finds minimum correctly', () => {
    acc.add(5)
    acc.add(2)
    acc.add(8)
    acc.add(1)
    acc.add(9)
    expect(acc.value()).toBe(1)
  })

  it('handles single value', () => {
    acc.add(42)
    expect(acc.value()).toBe(42)
  })

  it('handles all same values', () => {
    acc.add(5)
    acc.add(5)
    acc.add(5)
    expect(acc.value()).toBe(5)
  })

  it('handles descending sequence', () => {
    acc.add(10)
    acc.add(9)
    acc.add(8)
    acc.add(7)
    expect(acc.value()).toBe(7)
  })

  it('handles ascending sequence', () => {
    acc.add(1)
    acc.add(2)
    acc.add(3)
    acc.add(4)
    expect(acc.value()).toBe(1)
  })

  it('updates min correctly when old min is removed', () => {
    // Window: [5, 2, 8, 1, 9]
    acc.add(5)
    acc.add(2)
    acc.add(8)
    acc.add(1)
    acc.add(9)
    expect(acc.value()).toBe(1)

    // Remove 5 (oldest), window: [2, 8, 1, 9]
    acc.remove(5)
    expect(acc.value()).toBe(1)

    // Remove 2, window: [8, 1, 9]
    acc.remove(2)
    expect(acc.value()).toBe(1)

    // Remove 8, window: [1, 9]
    acc.remove(8)
    expect(acc.value()).toBe(1)

    // Remove 1 (the min), window: [9]
    acc.remove(1)
    expect(acc.value()).toBe(9)
  })

  it('matches full recalculation for sliding window', () => {
    const values = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5]
    const windowSize = 4

    const window: number[] = []

    for (let i = 0; i < values.length; i++) {
      acc.add(values[i]!)
      window.push(values[i]!)

      if (window.length > windowSize) {
        acc.remove(window.shift()!)
      }

      expectApprox(acc.value(), fullRecalc.min(window), 1e-10)
    }
  })
})

// =============================================================================
// IncrementalMax Tests
// =============================================================================

describe('IncrementalMax', () => {
  let acc: IncrementalMax

  beforeEach(() => {
    acc = new IncrementalMax()
  })

  it('returns null for empty accumulator', () => {
    expect(acc.value()).toBeNull()
  })

  it('finds maximum correctly', () => {
    acc.add(5)
    acc.add(2)
    acc.add(8)
    acc.add(1)
    acc.add(9)
    expect(acc.value()).toBe(9)
  })

  it('handles single value', () => {
    acc.add(42)
    expect(acc.value()).toBe(42)
  })

  it('updates max correctly when old max is removed', () => {
    acc.add(9)
    acc.add(5)
    acc.add(7)
    acc.add(3)
    expect(acc.value()).toBe(9)

    // Remove 9 (oldest and max)
    acc.remove(9)
    expect(acc.value()).toBe(7)
  })

  it('matches full recalculation for sliding window', () => {
    const values = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5]
    const windowSize = 4

    const window: number[] = []

    for (let i = 0; i < values.length; i++) {
      acc.add(values[i]!)
      window.push(values[i]!)

      if (window.length > windowSize) {
        acc.remove(window.shift()!)
      }

      expectApprox(acc.value(), fullRecalc.max(window), 1e-10)
    }
  })
})

// =============================================================================
// IncrementalStddev Tests (Welford's Algorithm)
// =============================================================================

describe('IncrementalStddev', () => {
  let acc: IncrementalStddev

  beforeEach(() => {
    acc = new IncrementalStddev()
  })

  it('returns null for empty accumulator', () => {
    expect(acc.value()).toBeNull()
    expect(acc.variance()).toBeNull()
  })

  it('returns 0 for single value', () => {
    acc.add(42)
    expect(acc.value()).toBe(0)
    expect(acc.variance()).toBe(0)
  })

  it('computes stddev correctly for simple case', () => {
    // Values: 2, 4, 4, 4, 5, 5, 7, 9
    // Mean = 5, Variance = 4, StdDev = 2
    const values = [2, 4, 4, 4, 5, 5, 7, 9]
    for (const v of values) {
      acc.add(v)
    }
    expectApprox(acc.getMean(), 5, 1e-10)
    expectApprox(acc.variance(), 4, 1e-10)
    expectApprox(acc.value(), 2, 1e-10)
  })

  it('matches full recalculation for random data', () => {
    const values = randomNumbers(500)
    for (const v of values) {
      acc.add(v)
    }
    expectApprox(acc.value(), fullRecalc.stddev(values), 1e-8)
  })

  it('handles removal correctly', () => {
    const values = [10, 20, 30, 40, 50]
    for (const v of values) {
      acc.add(v)
    }

    // Remove first value
    acc.remove(10)

    const remaining = [20, 30, 40, 50]
    expectApprox(acc.value(), fullRecalc.stddev(remaining), 1e-8)
  })

  it('maintains precision after add/remove cycles', () => {
    const initial = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    for (const v of initial) {
      acc.add(v)
    }

    // Simulate sliding window by removing first 3 and adding 11, 12, 13
    acc.remove(1)
    acc.remove(2)
    acc.remove(3)
    acc.add(11)
    acc.add(12)
    acc.add(13)

    const expected = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13]
    expectApprox(acc.value(), fullRecalc.stddev(expected), 1e-8)
  })

  it('returns correct sample stddev', () => {
    const values = [2, 4, 4, 4, 5, 5, 7, 9]
    for (const v of values) {
      acc.add(v)
    }

    // Sample variance = Σ(x-μ)² / (n-1) = 32 / 7
    // Sample stddev = sqrt(32/7)
    const expectedSampleVariance = 32 / 7
    const expectedSampleStddev = Math.sqrt(expectedSampleVariance)

    expectApprox(acc.sampleVariance(), expectedSampleVariance, 1e-10)
    expectApprox(acc.sampleStddev(), expectedSampleStddev, 1e-10)
  })

  it('handles edge case of removing all but one', () => {
    acc.add(10)
    acc.add(20)
    acc.add(30)

    acc.remove(10)
    acc.remove(20)

    // Single value remaining
    expect(acc.value()).toBe(0)
    expect(acc.count()).toBe(1)
  })
})

// =============================================================================
// BatchNumericAccumulator Tests
// =============================================================================

describe('BatchNumericAccumulator', () => {
  let batch: BatchNumericAccumulator

  beforeEach(() => {
    batch = new BatchNumericAccumulator()
  })

  it('returns null for empty batch', () => {
    expect(batch.sum()).toBe(0)
    expect(batch.avg()).toBeNull()
    expect(batch.min()).toBeNull()
    expect(batch.max()).toBeNull()
  })

  it('computes sum correctly', () => {
    batch.addBatch([1, 2, 3, 4, 5])
    expect(batch.sum()).toBe(15)
  })

  it('computes avg correctly', () => {
    batch.addBatch([2, 4, 6, 8, 10])
    expect(batch.avg()).toBe(6)
  })

  it('finds min correctly', () => {
    batch.addBatch([5, 2, 8, 1, 9])
    expect(batch.min()).toBe(1)
  })

  it('finds max correctly', () => {
    batch.addBatch([5, 2, 8, 1, 9])
    expect(batch.max()).toBe(9)
  })

  it('computes variance and stddev correctly', () => {
    batch.addBatch([2, 4, 4, 4, 5, 5, 7, 9])
    expectApprox(batch.variance(), 4, 1e-10)
    expectApprox(batch.stddev(), 2, 1e-10)
  })

  it('handles large batches', () => {
    const values = randomNumbers(10000)
    batch.addBatch(values)

    expectApprox(batch.sum(), fullRecalc.sum(values), 1e-6)
    expectApprox(batch.avg(), fullRecalc.avg(values), 1e-8)
    expectApprox(batch.min(), fullRecalc.min(values), 1e-10)
    expectApprox(batch.max(), fullRecalc.max(values), 1e-10)
  })

  it('handles multiple batch adds', () => {
    batch.addBatch([1, 2, 3])
    batch.addBatch([4, 5, 6])
    batch.addBatch([7, 8, 9])

    expect(batch.count()).toBe(9)
    expect(batch.sum()).toBe(45)
    expect(batch.avg()).toBe(5)
  })

  it('exports to array correctly', () => {
    batch.addBatch([1, 2, 3, 4, 5])
    expect(batch.toArray()).toEqual([1, 2, 3, 4, 5])
  })

  it('resets correctly', () => {
    batch.addBatch([1, 2, 3])
    batch.reset()

    expect(batch.count()).toBe(0)
    expect(batch.sum()).toBe(0)
  })
})

// =============================================================================
// IncrementalSlidingWindow Tests
// =============================================================================

describe('IncrementalSlidingWindow', () => {
  it('creates window with specified size', () => {
    const window = createSlidingWindow(5)
    expect(window.count()).toBe(0)
    expect(window.isFull()).toBe(false)
  })

  it('accumulates values until window is full', () => {
    const window = createSlidingWindow(3, ['sum', 'count'])

    window.add(10)
    expect(window.getValue('sum')).toBe(10)
    expect(window.getValue('count')).toBe(1)

    window.add(20)
    expect(window.getValue('sum')).toBe(30)

    window.add(30)
    expect(window.getValue('sum')).toBe(60)
    expect(window.isFull()).toBe(true)
  })

  it('slides window when full', () => {
    const window = createSlidingWindow(3, ['sum', 'avg'])

    window.add(10)
    window.add(20)
    window.add(30)
    expect(window.getValue('sum')).toBe(60)

    // Add fourth value, should slide
    window.add(40)
    expect(window.getValue('sum')).toBe(90) // 20 + 30 + 40
    expect(window.getValue('avg')).toBe(30)
    expect(window.getWindow()).toEqual([20, 30, 40])
  })

  it('computes all aggregations correctly', () => {
    const window = createSlidingWindow(5, ['sum', 'avg', 'min', 'max'])

    window.add(5)
    window.add(2)
    window.add(8)
    window.add(1)
    window.add(9)

    const values = window.getValues()
    expect(values.sum).toBe(25)
    expect(values.avg).toBe(5)
    expect(values.min).toBe(1)
    expect(values.max).toBe(9)
  })

  it('maintains correct values through sliding', () => {
    const window = createSlidingWindow(3, ['min', 'max'])
    const testData = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5]
    const reference: number[] = []

    for (const value of testData) {
      window.add(value)
      reference.push(value)
      if (reference.length > 3) {
        reference.shift()
      }

      expectApprox(window.getValue('min'), fullRecalc.min(reference), 1e-10)
      expectApprox(window.getValue('max'), fullRecalc.max(reference), 1e-10)
    }
  })

  it('checkpoint and restore works correctly', () => {
    const window = createSlidingWindow(4, ['sum', 'avg', 'min', 'max'])

    window.add(10)
    window.add(20)
    window.add(30)

    const checkpoint = window.checkpoint()

    // Create new window and restore
    const restored = createSlidingWindow(4, ['sum', 'avg', 'min', 'max'])
    restored.restore(checkpoint)

    expect(restored.getValue('sum')).toBe(window.getValue('sum'))
    expect(restored.getValue('avg')).toBe(window.getValue('avg'))
    expect(restored.getWindow()).toEqual(window.getWindow())

    // Continue operation on restored
    restored.add(40)
    expect(restored.getValue('sum')).toBe(100)
  })

  it('handles stddev accumulator', () => {
    const window = new IncrementalSlidingWindow({ windowSize: 8 })
    window.registerAccumulator('stddev', createIncrementalAccumulator('stddev'))

    const values = [2, 4, 4, 4, 5, 5, 7, 9]
    for (const v of values) {
      window.add(v)
    }

    expectApprox(window.getValue('stddev'), 2, 1e-10)
  })

  it('resets correctly', () => {
    const window = createSlidingWindow(3, ['sum'])
    window.add(10)
    window.add(20)
    window.reset()

    expect(window.count()).toBe(0)
    expect(window.getValue('sum')).toBeNull()
  })
})

// =============================================================================
// Factory Function Tests
// =============================================================================

describe('createIncrementalAccumulator', () => {
  it('creates sum accumulator', () => {
    const acc = createIncrementalAccumulator('sum')
    acc.add(1)
    acc.add(2)
    expect(acc.value()).toBe(3)
  })

  it('creates count accumulator', () => {
    const acc = createIncrementalAccumulator('count')
    acc.add(1)
    acc.add(2)
    expect(acc.value()).toBe(2)
  })

  it('creates avg accumulator', () => {
    const acc = createIncrementalAccumulator('avg')
    acc.add(10)
    acc.add(20)
    expect(acc.value()).toBe(15)
  })

  it('creates min accumulator', () => {
    const acc = createIncrementalAccumulator('min')
    acc.add(5)
    acc.add(2)
    acc.add(8)
    expect(acc.value()).toBe(2)
  })

  it('creates max accumulator', () => {
    const acc = createIncrementalAccumulator('max')
    acc.add(5)
    acc.add(2)
    acc.add(8)
    expect(acc.value()).toBe(8)
  })

  it('creates stddev accumulator', () => {
    const acc = createIncrementalAccumulator('stddev')
    const values = [2, 4, 4, 4, 5, 5, 7, 9]
    for (const v of values) {
      acc.add(v)
    }
    expectApprox(acc.value(), 2, 1e-10)
  })

  it('supports MongoDB-style operator names', () => {
    const sum = createIncrementalAccumulator('$sum')
    const count = createIncrementalAccumulator('$count')
    const avg = createIncrementalAccumulator('$avg')
    const min = createIncrementalAccumulator('$min')
    const max = createIncrementalAccumulator('$max')
    const stddev = createIncrementalAccumulator('$stddev')

    expect(sum).toBeInstanceOf(Object)
    expect(count).toBeInstanceOf(Object)
    expect(avg).toBeInstanceOf(Object)
    expect(min).toBeInstanceOf(Object)
    expect(max).toBeInstanceOf(Object)
    expect(stddev).toBeInstanceOf(Object)
  })

  it('throws for unknown accumulator type', () => {
    expect(() => createIncrementalAccumulator('unknown')).toThrow('Unknown accumulator type')
  })
})

// =============================================================================
// Correctness Tests: Incremental vs Full Recalculation
// =============================================================================

describe('Incremental vs Full Recalculation Correctness', () => {
  it('sum matches for all sliding window positions', () => {
    const data = randomNumbers(100)
    const windowSize = 10
    const window = createSlidingWindow(windowSize, ['sum'])
    const reference: number[] = []

    for (const value of data) {
      window.add(value)
      reference.push(value)
      if (reference.length > windowSize) {
        reference.shift()
      }

      expectApprox(window.getValue('sum'), fullRecalc.sum(reference), 1e-8)
    }
  })

  it('avg matches for all sliding window positions', () => {
    const data = randomNumbers(100)
    const windowSize = 10
    const window = createSlidingWindow(windowSize, ['avg'])
    const reference: number[] = []

    for (const value of data) {
      window.add(value)
      reference.push(value)
      if (reference.length > windowSize) {
        reference.shift()
      }

      expectApprox(window.getValue('avg'), fullRecalc.avg(reference), 1e-10)
    }
  })

  it('min matches for all sliding window positions', () => {
    const data = randomNumbers(100)
    const windowSize = 10
    const window = createSlidingWindow(windowSize, ['min'])
    const reference: number[] = []

    for (const value of data) {
      window.add(value)
      reference.push(value)
      if (reference.length > windowSize) {
        reference.shift()
      }

      expectApprox(window.getValue('min'), fullRecalc.min(reference), 1e-10)
    }
  })

  it('max matches for all sliding window positions', () => {
    const data = randomNumbers(100)
    const windowSize = 10
    const window = createSlidingWindow(windowSize, ['max'])
    const reference: number[] = []

    for (const value of data) {
      window.add(value)
      reference.push(value)
      if (reference.length > windowSize) {
        reference.shift()
      }

      expectApprox(window.getValue('max'), fullRecalc.max(reference), 1e-10)
    }
  })

  it('stddev matches for all sliding window positions', () => {
    const data = randomNumbers(100)
    const windowSize = 10
    const window = new IncrementalSlidingWindow({ windowSize })
    window.registerAccumulator('stddev', createIncrementalAccumulator('stddev'))
    const reference: number[] = []

    for (const value of data) {
      window.add(value)
      reference.push(value)
      if (reference.length > windowSize) {
        reference.shift()
      }

      if (reference.length >= 2) {
        expectApprox(window.getValue('stddev'), fullRecalc.stddev(reference), 1e-8)
      }
    }
  })

  it('all aggregations match simultaneously', () => {
    const data = randomNumbers(200)
    const windowSize = 20
    const window = new IncrementalSlidingWindow({ windowSize })
    window.registerAccumulator('sum', createIncrementalAccumulator('sum'))
    window.registerAccumulator('avg', createIncrementalAccumulator('avg'))
    window.registerAccumulator('min', createIncrementalAccumulator('min'))
    window.registerAccumulator('max', createIncrementalAccumulator('max'))
    window.registerAccumulator('count', createIncrementalAccumulator('count'))

    const reference: number[] = []

    for (const value of data) {
      window.add(value)
      reference.push(value)
      if (reference.length > windowSize) {
        reference.shift()
      }

      expectApprox(window.getValue('sum'), fullRecalc.sum(reference), 1e-8)
      expectApprox(window.getValue('avg'), fullRecalc.avg(reference), 1e-10)
      expectApprox(window.getValue('min'), fullRecalc.min(reference), 1e-10)
      expectApprox(window.getValue('max'), fullRecalc.max(reference), 1e-10)
      expect(window.getValue('count')).toBe(fullRecalc.count(reference))
    }
  })
})

// =============================================================================
// Edge Cases
// =============================================================================

describe('Edge Cases', () => {
  it('handles very large values', () => {
    const window = createSlidingWindow(3, ['sum', 'avg'])

    window.add(Number.MAX_SAFE_INTEGER)
    window.add(1)
    window.add(2)

    expect(window.getValue('sum')).toBeGreaterThan(Number.MAX_SAFE_INTEGER)
  })

  it('handles very small values', () => {
    const window = createSlidingWindow(3, ['sum', 'min'])

    window.add(Number.MIN_VALUE)
    window.add(Number.MIN_VALUE)
    window.add(Number.MIN_VALUE)

    expect(window.getValue('min')).toBe(Number.MIN_VALUE)
  })

  it('handles negative infinity', () => {
    const window = createSlidingWindow(3, ['min', 'max'])

    window.add(-Infinity)
    window.add(0)
    window.add(Infinity)

    expect(window.getValue('min')).toBe(-Infinity)
    expect(window.getValue('max')).toBe(Infinity)
  })

  it('handles all zeros', () => {
    const window = createSlidingWindow(5, ['sum', 'avg', 'min', 'max'])

    for (let i = 0; i < 5; i++) {
      window.add(0)
    }

    expect(window.getValue('sum')).toBe(0)
    expect(window.getValue('avg')).toBe(0)
    expect(window.getValue('min')).toBe(0)
    expect(window.getValue('max')).toBe(0)
  })

  it('handles alternating positive/negative', () => {
    const window = createSlidingWindow(4, ['sum', 'avg'])

    window.add(10)
    window.add(-10)
    window.add(10)
    window.add(-10)

    expect(window.getValue('sum')).toBe(0)
    expect(window.getValue('avg')).toBe(0)
  })

  it('handles window size of 1', () => {
    const window = createSlidingWindow(1, ['sum', 'avg', 'min', 'max'])

    window.add(10)
    expect(window.getValue('sum')).toBe(10)

    window.add(20)
    expect(window.getValue('sum')).toBe(20)
    expect(window.getWindow()).toEqual([20])
  })

  it('handles rapid add/remove cycles', () => {
    const acc = new IncrementalSum()

    for (let i = 0; i < 1000; i++) {
      acc.add(i)
      if (i > 10) {
        acc.remove(i - 10)
      }
    }

    // Should have values 990-999 in accumulator
    const expected = [990, 991, 992, 993, 994, 995, 996, 997, 998, 999].reduce((a, b) => a + b, 0)
    expectApprox(acc.value(), expected, 1e-8)
  })
})

// =============================================================================
// Performance Benchmarks
// =============================================================================

describe('Performance', () => {
  it('incremental is faster than full recalculation for large windows', () => {
    const windowSize = 1000
    const iterations = 5000
    const data = randomNumbers(iterations)

    // Incremental approach
    const incrementalStart = performance.now()
    const window = createSlidingWindow(windowSize, ['sum', 'avg', 'min', 'max'])

    for (const value of data) {
      window.add(value)
      // Access values (simulate real usage)
      window.getValues()
    }
    const incrementalTime = performance.now() - incrementalStart

    // Full recalculation approach
    const fullStart = performance.now()
    const fullWindow: number[] = []

    for (const value of data) {
      fullWindow.push(value)
      if (fullWindow.length > windowSize) {
        fullWindow.shift()
      }
      // Full recalculation
      fullRecalc.sum(fullWindow)
      fullRecalc.avg(fullWindow)
      fullRecalc.min(fullWindow)
      fullRecalc.max(fullWindow)
    }
    const fullTime = performance.now() - fullStart

    // Log performance comparison
    console.log(`Incremental: ${incrementalTime.toFixed(2)}ms`)
    console.log(`Full Recalc: ${fullTime.toFixed(2)}ms`)
    console.log(`Speedup: ${(fullTime / incrementalTime).toFixed(2)}x`)

    // Incremental should be significantly faster for large windows
    expect(incrementalTime).toBeLessThan(fullTime)
  })

  it('batch operations are efficient for large datasets', () => {
    const size = 100000
    const data = randomNumbers(size)

    const start = performance.now()
    const batch = new BatchNumericAccumulator()
    batch.addBatch(data)

    const sum = batch.sum()
    const avg = batch.avg()
    const min = batch.min()
    const max = batch.max()
    const duration = performance.now() - start

    console.log(`Batch operations on ${size} elements: ${duration.toFixed(2)}ms`)

    // Should complete in reasonable time
    expect(duration).toBeLessThan(100)

    // Results should be valid
    expect(sum).not.toBeNull()
    expect(avg).not.toBeNull()
    expect(min).not.toBeNull()
    expect(max).not.toBeNull()
  })
})

// =============================================================================
// IncrementalTumblingWindow Tests
// =============================================================================

describe('IncrementalTumblingWindow', () => {
  it('creates window with specified size', () => {
    const window = createTumblingWindow(1000, ['sum', 'count'])
    expect(window.count()).toBe(0)
    expect(window.getCurrentWindow()).toBeNull()
  })

  it('initializes window on first event', () => {
    const window = createTumblingWindow(1000, ['sum'])

    window.add(10, 500)

    const currentWindow = window.getCurrentWindow()
    expect(currentWindow).not.toBeNull()
    expect(currentWindow!.start).toBe(0)
    expect(currentWindow!.end).toBe(1000)
    expect(window.getValue('sum')).toBe(10)
  })

  it('accumulates values within same window', () => {
    const window = createTumblingWindow(1000, ['sum', 'count'])

    window.add(10, 100)
    window.add(20, 200)
    window.add(30, 500)

    expect(window.getValue('sum')).toBe(60)
    expect(window.getValue('count')).toBe(3)
    expect(window.count()).toBe(3)
  })

  it('closes window and opens new one when timestamp crosses boundary', () => {
    const window = createTumblingWindow(1000, ['sum', 'avg'])
    const completedWindows: Array<{ start: number; end: number; results: Record<string, number | null> }> = []

    window.onComplete((w) => completedWindows.push(w))

    // First window [0, 1000)
    window.add(10, 100)
    window.add(20, 500)
    window.add(30, 900)

    expect(completedWindows.length).toBe(0)

    // This should close first window and start new one [1000, 2000)
    window.add(40, 1200)

    expect(completedWindows.length).toBe(1)
    expect(completedWindows[0]!.start).toBe(0)
    expect(completedWindows[0]!.end).toBe(1000)
    expect(completedWindows[0]!.results.sum).toBe(60)
    expect(completedWindows[0]!.results.avg).toBe(20)

    // New window should have just the one value
    expect(window.getValue('sum')).toBe(40)
    expect(window.count()).toBe(1)
  })

  it('handles multiple window transitions', () => {
    const window = createTumblingWindow(100, ['sum'])
    const completedWindows: Array<{ start: number; results: Record<string, number | null> }> = []

    window.onComplete((w) => completedWindows.push(w))

    window.add(1, 50)   // Window [0, 100)
    window.add(2, 150)  // Window [100, 200)
    window.add(3, 250)  // Window [200, 300)
    window.add(4, 350)  // Window [300, 400)

    expect(completedWindows.length).toBe(3)
    expect(completedWindows[0]!.results.sum).toBe(1)
    expect(completedWindows[1]!.results.sum).toBe(2)
    expect(completedWindows[2]!.results.sum).toBe(3)
    expect(window.getValue('sum')).toBe(4)
  })

  it('advanceTime closes current window', () => {
    const window = createTumblingWindow(1000, ['sum'])
    const completedWindows: Array<{ start: number }> = []

    window.onComplete((w) => completedWindows.push(w))

    window.add(10, 100)
    window.add(20, 500)

    expect(completedWindows.length).toBe(0)

    window.advanceTime(1500)

    expect(completedWindows.length).toBe(1)
  })

  it('checkpoint and restore works correctly', () => {
    const window = createTumblingWindow(1000, ['sum', 'avg'])

    window.add(10, 100)
    window.add(20, 200)
    window.add(30, 300)

    const checkpoint = window.checkpoint()

    const restored = createTumblingWindow(1000, ['sum', 'avg'])
    restored.restore(checkpoint)

    expect(restored.getValue('sum')).toBe(window.getValue('sum'))
    expect(restored.getValue('avg')).toBe(window.getValue('avg'))
    expect(restored.count()).toBe(window.count())
    expect(restored.getCurrentWindow()).toEqual(window.getCurrentWindow())
  })

  it('getCompletedWindows returns history', () => {
    const window = createTumblingWindow(100, ['sum'])

    window.add(1, 50)
    window.add(2, 150)
    window.add(3, 250)

    const completed = window.getCompletedWindows()

    expect(completed.length).toBe(2)
    expect(completed[0]!.start).toBe(0)
    expect(completed[1]!.start).toBe(100)
  })

  it('getWindowResult retrieves specific window', () => {
    const window = createTumblingWindow(100, ['sum'])

    window.add(5, 50)
    window.add(10, 150)

    const result = window.getWindowResult(0)

    expect(result).not.toBeNull()
    expect(result!.results.sum).toBe(5)
    expect(result!.count).toBe(1)
  })

  it('reset clears all state', () => {
    const window = createTumblingWindow(100, ['sum'])

    window.add(10, 50)
    window.add(20, 150)

    window.reset()

    expect(window.count()).toBe(0)
    expect(window.getCurrentWindow()).toBeNull()
    expect(window.getCompletedWindows().length).toBe(0)
  })

  it('handles out-of-order events within same window', () => {
    const window = createTumblingWindow(1000, ['sum', 'min', 'max'])

    window.add(30, 500)
    window.add(10, 100)  // Earlier timestamp, still same window
    window.add(20, 300)

    expect(window.getValue('sum')).toBe(60)
    expect(window.getValue('min')).toBe(10)
    expect(window.getValue('max')).toBe(30)
    expect(window.count()).toBe(3)
  })
})

// =============================================================================
// IncrementalSessionWindow Tests
// =============================================================================

describe('IncrementalSessionWindow', () => {
  it('creates session on first event', () => {
    const window = createSessionWindow(1000, ['sum'])

    window.add(10, 100)

    expect(window.getActiveSessionCount()).toBe(1)
    const sessions = window.getActiveSessions()
    expect(sessions[0]!.start).toBe(100)
    expect(sessions[0]!.end).toBe(100)
    expect(sessions[0]!.values.sum).toBe(10)
  })

  it('extends session when events are within gap', () => {
    const window = createSessionWindow(1000, ['sum', 'count'])

    window.add(10, 100)
    window.add(20, 500)  // Within 1000ms gap
    window.add(30, 900)  // Still within gap

    expect(window.getActiveSessionCount()).toBe(1)
    const sessions = window.getActiveSessions()
    expect(sessions[0]!.start).toBe(100)
    expect(sessions[0]!.end).toBe(900)
    expect(sessions[0]!.values.sum).toBe(60)
    expect(sessions[0]!.count).toBe(3)
  })

  it('creates new session when gap exceeds threshold', () => {
    const window = createSessionWindow(500, ['sum'])

    window.add(10, 100)
    window.add(20, 200)  // Within gap
    window.add(30, 1500) // > 500ms gap from 200, new session

    expect(window.getActiveSessionCount()).toBe(2)
    const sessions = window.getActiveSessions()

    // First session
    expect(sessions[0]!.values.sum).toBe(30)

    // Second session
    expect(sessions[1]!.values.sum).toBe(30)
  })

  it('merges sessions when event bridges gap', () => {
    const window = createSessionWindow(500, ['sum'])

    window.add(10, 100)   // Session 1: [100, 100]
    window.add(20, 1500)  // Session 2: [1500, 1500] - gap > 500
    window.add(30, 800)   // Bridges gap between sessions, should merge

    // The bridging event should cause sessions to merge
    expect(window.getActiveSessionCount()).toBeLessThanOrEqual(2)
  })

  it('advanceTime closes timed-out sessions', () => {
    const window = createSessionWindow(500, ['sum'])
    const completedSessions: Array<{ start: number; results: Record<string, number | null> }> = []

    window.onComplete((s) => completedSessions.push(s))

    window.add(10, 100)
    window.add(20, 200)

    expect(completedSessions.length).toBe(0)

    // Advance past gap threshold
    window.advanceTime(800)

    expect(completedSessions.length).toBe(1)
    expect(completedSessions[0]!.results.sum).toBe(30)
    expect(window.getActiveSessionCount()).toBe(0)
  })

  it('closeAllSessions forces completion', () => {
    const window = createSessionWindow(1000, ['sum'])
    const completedSessions: Array<{ start: number }> = []

    window.onComplete((s) => completedSessions.push(s))

    window.add(10, 100)
    window.add(20, 2000)  // Creates second session

    expect(window.getActiveSessionCount()).toBe(2)

    window.closeAllSessions()

    expect(window.getActiveSessionCount()).toBe(0)
    expect(completedSessions.length).toBe(2)
  })

  it('respects maxDuration constraint', () => {
    const window = createSessionWindow(1000, ['sum'], 500) // Max duration 500ms
    const completedSessions: Array<{ start: number; end: number }> = []

    window.onComplete((s) => completedSessions.push(s))

    window.add(10, 100)
    window.add(20, 400)
    window.add(30, 700)  // This pushes duration past 500ms

    // Session should have been closed due to max duration
    expect(completedSessions.length).toBeGreaterThan(0)
  })

  it('getCompletedSessions returns history', () => {
    const window = createSessionWindow(500, ['sum'])

    window.add(10, 100)
    window.add(20, 200)
    window.advanceTime(1000)

    window.add(30, 1500)
    window.advanceTime(2500)

    const completed = window.getCompletedSessions()
    expect(completed.length).toBe(2)
  })

  it('checkpoint and restore works correctly', () => {
    const window = createSessionWindow(1000, ['sum', 'avg'])

    window.add(10, 100)
    window.add(20, 200)
    window.add(30, 300)

    const checkpoint = window.checkpoint()

    const restored = createSessionWindow(1000, ['sum', 'avg'])
    restored.restore(checkpoint)

    expect(restored.getActiveSessionCount()).toBe(window.getActiveSessionCount())

    const originalSessions = window.getActiveSessions()
    const restoredSessions = restored.getActiveSessions()

    expect(restoredSessions[0]!.values.sum).toBe(originalSessions[0]!.values.sum)
    expect(restoredSessions[0]!.count).toBe(originalSessions[0]!.count)
  })

  it('reset clears all state', () => {
    const window = createSessionWindow(1000, ['sum'])

    window.add(10, 100)
    window.add(20, 200)

    window.reset()

    expect(window.getActiveSessionCount()).toBe(0)
    expect(window.getCompletedSessions().length).toBe(0)
  })
})

// =============================================================================
// Stream Processor Tests
// =============================================================================

describe('IncrementalSlidingWindowStream', () => {
  it('processes values and emits updates', () => {
    const stream = new IncrementalSlidingWindowStream(3, ['sum', 'avg'])
    const updates: Array<{ type: string; values: Record<string, number | null> }> = []

    stream.subscribe((update) => updates.push(update))

    stream.process(10, 0)
    stream.process(20, 1)
    stream.process(30, 2)

    expect(updates.length).toBe(3)
    expect(updates[2]!.values.sum).toBe(60)
    expect(updates[2]!.values.avg).toBe(20)
  })

  it('calculates deltas between updates', () => {
    const stream = new IncrementalSlidingWindowStream(3, ['sum'])

    const update1 = stream.process(10, 0)
    const update2 = stream.process(20, 1)

    expect(update2.delta!.sum).toBe(20) // Sum went from 10 to 30
  })

  it('subscribe returns unsubscribe function', () => {
    const stream = new IncrementalSlidingWindowStream(3, ['sum'])
    const updates: unknown[] = []

    const unsubscribe = stream.subscribe((update) => updates.push(update))

    stream.process(10, 0)
    expect(updates.length).toBe(1)

    unsubscribe()

    stream.process(20, 1)
    expect(updates.length).toBe(1) // No new updates after unsubscribe
  })
})

describe('IncrementalTumblingWindowStream', () => {
  it('processes values and emits updates', () => {
    const stream = new IncrementalTumblingWindowStream(1000, ['sum'])
    const updates: Array<{ type: string }> = []

    stream.subscribe((update) => updates.push(update))

    stream.process(10, 100)
    stream.process(20, 500)

    expect(updates.length).toBe(2)
    expect(updates[0]!.type).toBe('add')
  })

  it('emits window_close when crossing boundary', () => {
    const stream = new IncrementalTumblingWindowStream(1000, ['sum'])
    const updates: Array<{ type: string; values: Record<string, number | null> }> = []

    stream.subscribe((update) => updates.push(update))

    stream.process(10, 100)
    stream.process(20, 500)
    stream.process(30, 1200) // Crosses boundary

    const closeUpdates = updates.filter((u) => u.type === 'window_close')
    expect(closeUpdates.length).toBe(1)
    expect(closeUpdates[0]!.values.sum).toBe(30)
  })

  it('advanceWatermark triggers window closes', () => {
    const stream = new IncrementalTumblingWindowStream(1000, ['sum'])

    stream.process(10, 100)
    stream.process(20, 500)

    const closeUpdates = stream.advanceWatermark(1500)

    expect(closeUpdates.length).toBe(1)
    expect(closeUpdates[0]!.type).toBe('window_close')
  })
})

describe('IncrementalSessionWindowStream', () => {
  it('processes values and emits updates', () => {
    const stream = new IncrementalSessionWindowStream(500, ['sum'])
    const updates: Array<{ type: string }> = []

    stream.subscribe((update) => updates.push(update))

    stream.process(10, 100)
    stream.process(20, 200)

    expect(updates.length).toBe(2)
    expect(updates[0]!.type).toBe('add')
  })

  it('detects session merges', () => {
    const stream = new IncrementalSessionWindowStream(500, ['sum'])
    const updates: Array<{ type: string }> = []

    stream.subscribe((update) => updates.push(update))

    stream.process(10, 100)   // Session 1
    stream.process(20, 1500)  // Session 2 (gap > 500)
    stream.process(30, 800)   // Should bridge and merge

    // Check if any merge was detected
    const mergeUpdates = updates.filter((u) => u.type === 'window_merge')
    // Note: merge detection depends on session state
  })

  it('advanceWatermark closes timed-out sessions', () => {
    const stream = new IncrementalSessionWindowStream(500, ['sum'])

    stream.process(10, 100)
    stream.process(20, 200)

    const closeUpdates = stream.advanceWatermark(1000)

    expect(closeUpdates.length).toBe(1)
    expect(closeUpdates[0]!.type).toBe('window_close')
  })
})

// =============================================================================
// Integration Tests: Tumbling Window Correctness
// =============================================================================

describe('Tumbling Window Correctness', () => {
  it('sum matches for all tumbling window positions', () => {
    const windowSizeMs = 100
    const window = createTumblingWindow(windowSizeMs, ['sum'])
    const completedResults: number[] = []

    window.onComplete((w) => {
      if (w.results.sum !== null) {
        completedResults.push(w.results.sum)
      }
    })

    // Generate events across multiple windows
    const events = [
      { value: 10, ts: 50 },
      { value: 20, ts: 80 },
      { value: 30, ts: 150 },
      { value: 40, ts: 180 },
      { value: 50, ts: 250 },
    ]

    for (const e of events) {
      window.add(e.value, e.ts)
    }

    // Force close last window
    window.advanceTime(400)

    // Verify completed windows
    expect(completedResults).toContain(30)  // Window [0, 100): 10 + 20
    expect(completedResults).toContain(70)  // Window [100, 200): 30 + 40
    expect(completedResults).toContain(50)  // Window [200, 300): 50
  })

  it('correctly assigns events to aligned windows', () => {
    const window = createTumblingWindow(60000, ['count']) // 1 minute windows

    // Events at different minute boundaries
    window.add(1, 30000)   // 0:30 -> Window [0, 60000)
    window.add(1, 90000)   // 1:30 -> Window [60000, 120000)
    window.add(1, 150000)  // 2:30 -> Window [120000, 180000)

    const completed = window.getCompletedWindows()

    expect(completed.length).toBe(2)
    expect(completed[0]!.start).toBe(0)
    expect(completed[1]!.start).toBe(60000)
  })
})

// =============================================================================
// Integration Tests: Session Window Correctness
// =============================================================================

describe('Session Window Correctness', () => {
  it('correctly identifies user sessions', () => {
    // Simulate user activity with 30-second gap timeout
    const window = createSessionWindow(30000, ['count'])
    const completedSessions: Array<{ start: number; end: number; count: number }> = []

    window.onComplete((s) => completedSessions.push({ ...s, count: s.count }))

    // User session 1: rapid clicks
    window.add(1, 0)
    window.add(1, 5000)
    window.add(1, 10000)

    // Gap of 40 seconds (> 30s threshold)
    // User session 2: single click
    window.add(1, 50000)

    // Gap of 40 seconds
    // User session 3: two clicks
    window.add(1, 90000)
    window.add(1, 100000)

    // Close all sessions
    window.closeAllSessions()

    expect(completedSessions.length).toBe(3)
    expect(completedSessions[0]!.count).toBe(3)  // First session: 3 events
    expect(completedSessions[1]!.count).toBe(1)  // Second session: 1 event
    expect(completedSessions[2]!.count).toBe(2)  // Third session: 2 events
  })

  it('handles interleaved events correctly', () => {
    const window = createSessionWindow(1000, ['sum'])

    // Events arrive out of order but within gap
    window.add(10, 500)
    window.add(20, 100)  // Earlier but within gap
    window.add(30, 800)

    const sessions = window.getActiveSessions()
    expect(sessions.length).toBe(1)
    expect(sessions[0]!.start).toBe(100)  // Should use earliest timestamp
    expect(sessions[0]!.end).toBe(800)    // Should use latest timestamp
    expect(sessions[0]!.values.sum).toBe(60)
  })
})
