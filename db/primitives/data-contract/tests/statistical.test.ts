/**
 * Statistical Expectations Tests - Aggregate validation for data quality
 *
 * TDD: These tests define the expected behavior of statistical expectations.
 *
 * Statistical expectations provide:
 * - Row count expectations (min, max, exact, between)
 * - Column statistics (mean, stddev, percentiles)
 * - Uniqueness and cardinality checks
 * - Null percentage thresholds
 */
import { describe, it, expect } from 'vitest'
import {
  // Statistical expectations API
  expectStats,
  StatisticalExpectationBuilder,
  ColumnStatsBuilder,
  validateStatisticalExpectations,
  // Types
  type StatisticalExpectation,
  type StatisticalExpectationResult,
  type ColumnStatistics,
} from '../statistical'

// ============================================================================
// ENTRY POINT
// ============================================================================

describe('Statistical Expectations', () => {
  describe('expectStats() entry point', () => {
    it('should create a statistical expectation builder for a table', () => {
      const builder = expectStats('orders')

      expect(builder).toBeInstanceOf(StatisticalExpectationBuilder)
      expect(builder.getTableName()).toBe('orders')
    })
  })

  // ============================================================================
  // ROW COUNT EXPECTATIONS
  // ============================================================================

  describe('Row Count Expectations', () => {
    describe('toHaveRowCount()', () => {
      it('should validate exact row count', () => {
        const expectation = expectStats('orders')
          .toHaveRowCount().exactly(3)
          .build()

        const data = [
          { id: 1, amount: 100 },
          { id: 2, amount: 200 },
          { id: 3, amount: 300 },
        ]

        const result = validateStatisticalExpectations(expectation, data)
        expect(result.passed).toBe(true)
      })

      it('should fail when row count does not match exact', () => {
        const expectation = expectStats('orders')
          .toHaveRowCount().exactly(5)
          .build()

        const data = [
          { id: 1, amount: 100 },
          { id: 2, amount: 200 },
        ]

        const result = validateStatisticalExpectations(expectation, data)
        expect(result.passed).toBe(false)
        expect(result.failures[0].message).toContain('2')
        expect(result.failures[0].message).toContain('5')
      })

      it('should validate row count between min and max', () => {
        const expectation = expectStats('orders')
          .toHaveRowCount().between(1000, 10000)
          .build()

        const data = Array.from({ length: 5000 }, (_, i) => ({ id: i }))

        const result = validateStatisticalExpectations(expectation, data)
        expect(result.passed).toBe(true)
      })

      it('should fail when row count is below minimum', () => {
        const expectation = expectStats('orders')
          .toHaveRowCount().between(1000, 10000)
          .build()

        const data = Array.from({ length: 500 }, (_, i) => ({ id: i }))

        const result = validateStatisticalExpectations(expectation, data)
        expect(result.passed).toBe(false)
        expect(result.failures[0].expectationType).toBe('row_count')
      })

      it('should fail when row count is above maximum', () => {
        const expectation = expectStats('orders')
          .toHaveRowCount().between(1, 100)
          .build()

        const data = Array.from({ length: 200 }, (_, i) => ({ id: i }))

        const result = validateStatisticalExpectations(expectation, data)
        expect(result.passed).toBe(false)
      })

      it('should validate minimum row count only', () => {
        const expectation = expectStats('orders')
          .toHaveRowCount().atLeast(10)
          .build()

        const data = Array.from({ length: 50 }, (_, i) => ({ id: i }))

        const result = validateStatisticalExpectations(expectation, data)
        expect(result.passed).toBe(true)
      })

      it('should validate maximum row count only', () => {
        const expectation = expectStats('orders')
          .toHaveRowCount().atMost(100)
          .build()

        const data = Array.from({ length: 50 }, (_, i) => ({ id: i }))

        const result = validateStatisticalExpectations(expectation, data)
        expect(result.passed).toBe(true)
      })
    })
  })

  // ============================================================================
  // COLUMN STATISTICS - MEAN
  // ============================================================================

  describe('Column Statistics - Mean', () => {
    describe('.column().mean()', () => {
      it('should validate mean within range', () => {
        const expectation = expectStats('orders')
          .column('amount').mean().toBeBetween(50, 150)
          .build()

        const data = [
          { amount: 80 },
          { amount: 100 },
          { amount: 120 },
        ]
        // Mean = 100, which is between 50 and 150

        const result = validateStatisticalExpectations(expectation, data)
        expect(result.passed).toBe(true)
      })

      it('should fail when mean is outside range', () => {
        const expectation = expectStats('orders')
          .column('amount').mean().toBeBetween(50, 100)
          .build()

        const data = [
          { amount: 200 },
          { amount: 300 },
          { amount: 400 },
        ]
        // Mean = 300, which is outside 50-100

        const result = validateStatisticalExpectations(expectation, data)
        expect(result.passed).toBe(false)
        expect(result.failures[0].column).toBe('amount')
        expect(result.failures[0].statistic).toBe('mean')
      })

      it('should validate mean greater than threshold', () => {
        const expectation = expectStats('orders')
          .column('amount').mean().toBeGreaterThan(50)
          .build()

        const data = [
          { amount: 100 },
          { amount: 200 },
        ]
        // Mean = 150

        const result = validateStatisticalExpectations(expectation, data)
        expect(result.passed).toBe(true)
      })

      it('should validate mean less than threshold', () => {
        const expectation = expectStats('orders')
          .column('amount').mean().toBeLessThan(200)
          .build()

        const data = [
          { amount: 100 },
          { amount: 150 },
        ]
        // Mean = 125

        const result = validateStatisticalExpectations(expectation, data)
        expect(result.passed).toBe(true)
      })

      it('should skip null/undefined values when calculating mean', () => {
        const expectation = expectStats('orders')
          .column('amount').mean().toBeBetween(90, 110)
          .build()

        const data = [
          { amount: 100 },
          { amount: null },
          { amount: 100 },
          { amount: undefined },
        ]
        // Mean = 100 (only counting non-null values)

        const result = validateStatisticalExpectations(expectation, data)
        expect(result.passed).toBe(true)
      })
    })
  })

  // ============================================================================
  // COLUMN STATISTICS - STANDARD DEVIATION
  // ============================================================================

  describe('Column Statistics - Standard Deviation', () => {
    describe('.column().stddev()', () => {
      it('should validate standard deviation within range', () => {
        const expectation = expectStats('orders')
          .column('amount').stddev().toBeLessThan(50)
          .build()

        const data = [
          { amount: 100 },
          { amount: 102 },
          { amount: 98 },
          { amount: 101 },
        ]
        // Very low variance, stddev should be < 50

        const result = validateStatisticalExpectations(expectation, data)
        expect(result.passed).toBe(true)
      })

      it('should fail when standard deviation exceeds threshold', () => {
        const expectation = expectStats('orders')
          .column('amount').stddev().toBeLessThan(10)
          .build()

        const data = [
          { amount: 10 },
          { amount: 100 },
          { amount: 1000 },
        ]
        // High variance

        const result = validateStatisticalExpectations(expectation, data)
        expect(result.passed).toBe(false)
      })

      it('should validate standard deviation between bounds', () => {
        const expectation = expectStats('orders')
          .column('amount').stddev().toBeBetween(1, 100)
          .build()

        const data = [
          { amount: 50 },
          { amount: 60 },
          { amount: 70 },
          { amount: 80 },
        ]

        const result = validateStatisticalExpectations(expectation, data)
        expect(result.passed).toBe(true)
      })
    })
  })

  // ============================================================================
  // COLUMN STATISTICS - PERCENTILES
  // ============================================================================

  describe('Column Statistics - Percentiles', () => {
    describe('.column().percentile()', () => {
      it('should validate median (50th percentile)', () => {
        const expectation = expectStats('orders')
          .column('amount').percentile(50).toBeBetween(90, 110)
          .build()

        const data = [
          { amount: 50 },
          { amount: 100 },
          { amount: 150 },
        ]
        // Median = 100

        const result = validateStatisticalExpectations(expectation, data)
        expect(result.passed).toBe(true)
      })

      it('should validate 95th percentile', () => {
        const expectation = expectStats('orders')
          .column('amount').percentile(95).toBeLessThan(1000)
          .build()

        const data = Array.from({ length: 100 }, (_, i) => ({ amount: i * 10 }))
        // Values from 0 to 990, 95th percentile should be around 945

        const result = validateStatisticalExpectations(expectation, data)
        expect(result.passed).toBe(true)
      })

      it('should validate 25th percentile (Q1)', () => {
        const expectation = expectStats('orders')
          .column('amount').percentile(25).toBeGreaterThan(10)
          .build()

        const data = Array.from({ length: 100 }, (_, i) => ({ amount: i + 20 }))
        // Values from 20 to 119, Q1 should be around 45

        const result = validateStatisticalExpectations(expectation, data)
        expect(result.passed).toBe(true)
      })
    })
  })

  // ============================================================================
  // UNIQUENESS AND CARDINALITY
  // ============================================================================

  describe('Uniqueness and Cardinality', () => {
    describe('.column().uniqueRatio()', () => {
      it('should validate unique ratio above threshold', () => {
        const expectation = expectStats('orders')
          .column('user_id').uniqueRatio().toBeGreaterThan(0.8)
          .build()

        const data = [
          { user_id: 1 },
          { user_id: 2 },
          { user_id: 3 },
          { user_id: 4 },
          { user_id: 5 },
        ]
        // All unique, ratio = 1.0

        const result = validateStatisticalExpectations(expectation, data)
        expect(result.passed).toBe(true)
      })

      it('should fail when unique ratio is below threshold', () => {
        const expectation = expectStats('orders')
          .column('user_id').uniqueRatio().toBeGreaterThan(0.8)
          .build()

        const data = [
          { user_id: 1 },
          { user_id: 1 },
          { user_id: 1 },
          { user_id: 2 },
          { user_id: 3 },
        ]
        // 3 unique out of 5, ratio = 0.6

        const result = validateStatisticalExpectations(expectation, data)
        expect(result.passed).toBe(false)
        expect(result.failures[0].column).toBe('user_id')
        expect(result.failures[0].statistic).toBe('unique_ratio')
      })

      it('should calculate unique ratio correctly', () => {
        const expectation = expectStats('orders')
          .column('status').uniqueRatio().toBeBetween(0.2, 0.4)
          .build()

        const data = [
          { status: 'pending' },
          { status: 'pending' },
          { status: 'complete' },
          { status: 'complete' },
          { status: 'complete' },
          { status: 'cancelled' },
          { status: 'cancelled' },
          { status: 'cancelled' },
          { status: 'cancelled' },
          { status: 'cancelled' },
        ]
        // 3 unique out of 10, ratio = 0.3

        const result = validateStatisticalExpectations(expectation, data)
        expect(result.passed).toBe(true)
      })
    })

    describe('.column().uniqueCount()', () => {
      it('should validate unique count within range', () => {
        const expectation = expectStats('orders')
          .column('status').uniqueCount().toBeBetween(2, 5)
          .build()

        const data = [
          { status: 'pending' },
          { status: 'complete' },
          { status: 'cancelled' },
        ]
        // 3 unique values

        const result = validateStatisticalExpectations(expectation, data)
        expect(result.passed).toBe(true)
      })

      it('should fail when unique count is outside range', () => {
        const expectation = expectStats('orders')
          .column('status').uniqueCount().toBeBetween(5, 10)
          .build()

        const data = [
          { status: 'pending' },
          { status: 'complete' },
        ]
        // Only 2 unique values

        const result = validateStatisticalExpectations(expectation, data)
        expect(result.passed).toBe(false)
      })
    })
  })

  // ============================================================================
  // NULL PERCENTAGE THRESHOLDS
  // ============================================================================

  describe('Null Percentage Thresholds', () => {
    describe('.column().nullPercentage()', () => {
      it('should validate null percentage below threshold', () => {
        const expectation = expectStats('orders')
          .column('email').nullPercentage().toBeLessThan(0.01)
          .build()

        const data = Array.from({ length: 1000 }, (_, i) => ({
          email: i < 5 ? null : `user${i}@example.com`,
        }))
        // 5 nulls out of 1000 = 0.5%

        const result = validateStatisticalExpectations(expectation, data)
        expect(result.passed).toBe(true)
      })

      it('should fail when null percentage exceeds threshold', () => {
        const expectation = expectStats('orders')
          .column('email').nullPercentage().toBeLessThan(0.01)
          .build()

        const data = Array.from({ length: 100 }, (_, i) => ({
          email: i < 20 ? null : `user${i}@example.com`,
        }))
        // 20 nulls out of 100 = 20%

        const result = validateStatisticalExpectations(expectation, data)
        expect(result.passed).toBe(false)
        expect(result.failures[0].column).toBe('email')
        expect(result.failures[0].statistic).toBe('null_percentage')
      })

      it('should handle zero nulls', () => {
        const expectation = expectStats('orders')
          .column('email').nullPercentage().toBeLessThan(0.01)
          .build()

        const data = [
          { email: 'a@b.com' },
          { email: 'c@d.com' },
        ]

        const result = validateStatisticalExpectations(expectation, data)
        expect(result.passed).toBe(true)
        expect(result.statistics?.email?.nullPercentage).toBe(0)
      })

      it('should handle all nulls', () => {
        const expectation = expectStats('orders')
          .column('email').nullPercentage().toBeLessThan(0.5)
          .build()

        const data = [
          { email: null },
          { email: null },
        ]

        const result = validateStatisticalExpectations(expectation, data)
        expect(result.passed).toBe(false)
        expect(result.statistics?.email?.nullPercentage).toBe(1)
      })

      it('should treat undefined as null', () => {
        const expectation = expectStats('orders')
          .column('email').nullPercentage().toBeLessThan(0.25)
          .build()

        const data = [
          { email: 'a@b.com' },
          { email: null },
          { email: undefined },
          { name: 'Bob' }, // email is undefined
        ]
        // 3 nullish out of 4 = 75%

        const result = validateStatisticalExpectations(expectation, data)
        expect(result.passed).toBe(false)
      })
    })
  })

  // ============================================================================
  // CHAINED EXPECTATIONS
  // ============================================================================

  describe('Chained Expectations', () => {
    it('should chain multiple column expectations', () => {
      const expectation = expectStats('orders')
        .toHaveRowCount().between(1000, 10000)
        .column('amount').mean().toBeBetween(50, 150)
        .column('user_id').uniqueRatio().toBeGreaterThan(0.8)
        .column('email').nullPercentage().toBeLessThan(0.01)
        .build()

      expect(expectation.table).toBe('orders')
      expect(expectation.rowCountExpectation).toBeDefined()
      expect(expectation.columnExpectations).toHaveLength(3)
    })

    it('should validate all chained expectations', () => {
      const expectation = expectStats('orders')
        .toHaveRowCount().between(2, 10)
        .column('amount').mean().toBeBetween(90, 110)
        .column('id').uniqueRatio().toBeGreaterThan(0.9)
        .build()

      const data = [
        { id: 1, amount: 100 },
        { id: 2, amount: 100 },
        { id: 3, amount: 100 },
      ]

      const result = validateStatisticalExpectations(expectation, data)
      expect(result.passed).toBe(true)
    })

    it('should report all failures', () => {
      const expectation = expectStats('orders')
        .toHaveRowCount().exactly(10)
        .column('amount').mean().toBeBetween(200, 300)
        .column('id').uniqueRatio().toBeGreaterThan(0.9)
        .build()

      const data = [
        { id: 1, amount: 50 },
        { id: 1, amount: 50 },
        { id: 1, amount: 50 },
      ]

      const result = validateStatisticalExpectations(expectation, data)
      expect(result.passed).toBe(false)
      expect(result.failures.length).toBeGreaterThanOrEqual(2) // row count, mean, and possibly unique ratio
    })
  })

  // ============================================================================
  // COMPUTED STATISTICS
  // ============================================================================

  describe('Computed Statistics', () => {
    it('should return computed statistics in result', () => {
      const expectation = expectStats('orders')
        .column('amount').mean().toBeBetween(0, 1000)
        .column('amount').stddev().toBeLessThan(1000)
        .column('status').uniqueRatio().toBeGreaterThan(0)
        .build()

      const data = [
        { amount: 100, status: 'pending' },
        { amount: 200, status: 'complete' },
        { amount: 300, status: 'pending' },
      ]

      const result = validateStatisticalExpectations(expectation, data)

      expect(result.statistics).toBeDefined()
      expect(result.statistics?.amount?.mean).toBeCloseTo(200, 1)
      expect(result.statistics?.amount?.stddev).toBeDefined()
      expect(result.statistics?.status?.uniqueRatio).toBeCloseTo(0.666, 2)
    })

    it('should include row count in statistics', () => {
      const expectation = expectStats('orders')
        .toHaveRowCount().atLeast(1)
        .build()

      const data = [
        { id: 1 },
        { id: 2 },
        { id: 3 },
      ]

      const result = validateStatisticalExpectations(expectation, data)
      expect(result.statistics?.rowCount).toBe(3)
    })
  })

  // ============================================================================
  // API MATCHING TASK DESCRIPTION
  // ============================================================================

  describe('API from Task Description', () => {
    it('should implement the exact API from the task', () => {
      // This is the exact API from the task description
      const expectation = expectStats('orders')
        .toHaveRowCount().between(1000, 10000)
        .column('amount').mean().toBeBetween(50, 150)
        .column('user_id').uniqueRatio().toBeGreaterThan(0.8)
        .column('email').nullPercentage().toBeLessThan(0.01)
        .build()

      expect(expectation.table).toBe('orders')
      expect(expectation.rowCountExpectation).toEqual({
        type: 'between',
        min: 1000,
        max: 10000,
      })
      expect(expectation.columnExpectations).toHaveLength(3)
    })
  })

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('Edge Cases', () => {
    it('should handle empty data array', () => {
      const expectation = expectStats('orders')
        .column('amount').mean().toBeBetween(0, 100)
        .build()

      const result = validateStatisticalExpectations(expectation, [])

      // Empty array cannot satisfy mean expectation
      expect(result.passed).toBe(false)
    })

    it('should handle single row', () => {
      const expectation = expectStats('orders')
        .toHaveRowCount().exactly(1)
        .column('amount').mean().toBeBetween(90, 110)
        .build()

      const data = [{ amount: 100 }]

      const result = validateStatisticalExpectations(expectation, data)
      expect(result.passed).toBe(true)
    })

    it('should handle column with all null values for mean', () => {
      const expectation = expectStats('orders')
        .column('amount').mean().toBeBetween(0, 100)
        .build()

      const data = [
        { amount: null },
        { amount: null },
      ]

      const result = validateStatisticalExpectations(expectation, data)
      expect(result.passed).toBe(false)
      expect(result.failures[0].message).toContain('no valid values')
    })

    it('should handle missing column', () => {
      const expectation = expectStats('orders')
        .column('nonexistent').mean().toBeBetween(0, 100)
        .build()

      const data = [
        { amount: 100 },
        { amount: 200 },
      ]

      const result = validateStatisticalExpectations(expectation, data)
      expect(result.passed).toBe(false)
      expect(result.failures[0].message).toContain('nonexistent')
    })

    it('should handle non-numeric values for numeric statistics', () => {
      const expectation = expectStats('orders')
        .column('amount').mean().toBeBetween(0, 100)
        .build()

      const data = [
        { amount: 'not a number' },
        { amount: 50 },
      ]

      const result = validateStatisticalExpectations(expectation, data)
      // Should calculate mean of numeric values only (50)
      expect(result.statistics?.amount?.mean).toBe(50)
    })
  })

  // ============================================================================
  // TIMING
  // ============================================================================

  describe('Timing', () => {
    it('should return timing information', () => {
      const expectation = expectStats('orders')
        .toHaveRowCount().atLeast(1)
        .build()

      const data = [{ id: 1 }]

      const result = validateStatisticalExpectations(expectation, data)

      expect(result.timing).toBeDefined()
      expect(result.timing.totalMs).toBeGreaterThanOrEqual(0)
    })
  })
})
