/**
 * SQL-Style Window Function Tests
 *
 * Tests for window functions in the aggregation pipeline:
 * - ROW_NUMBER, RANK, DENSE_RANK
 * - LAG, LEAD
 * - Running totals (SUM OVER)
 * - Moving averages
 * - Frame boundary handling (ROWS vs RANGE)
 *
 * TDD: Write tests first, then implement.
 *
 * @see dotdo-g29n2
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  WindowFunctionProcessor,
  WindowFrame,
  WindowSpec,
  createWindowFunction,
  rowNumber,
  rank,
  denseRank,
  lag,
  lead,
  sumOver,
  avgOver,
  minOver,
  maxOver,
  countOver,
  firstValue,
  lastValue,
  nthValue,
  ntile,
  percentRank,
  cumeDist,
} from '../stages/window-functions'

// ============================================================================
// Test Data
// ============================================================================

interface SalesRecord {
  id: number
  region: string
  product: string
  date: string
  amount: number
  quantity: number
}

const salesData: SalesRecord[] = [
  { id: 1, region: 'East', product: 'Widget', date: '2024-01-01', amount: 100, quantity: 5 },
  { id: 2, region: 'East', product: 'Widget', date: '2024-01-02', amount: 150, quantity: 7 },
  { id: 3, region: 'East', product: 'Gadget', date: '2024-01-01', amount: 200, quantity: 3 },
  { id: 4, region: 'West', product: 'Widget', date: '2024-01-01', amount: 120, quantity: 6 },
  { id: 5, region: 'West', product: 'Widget', date: '2024-01-02', amount: 180, quantity: 9 },
  { id: 6, region: 'West', product: 'Gadget', date: '2024-01-01', amount: 250, quantity: 4 },
  { id: 7, region: 'East', product: 'Widget', date: '2024-01-03', amount: 130, quantity: 6 },
  { id: 8, region: 'West', product: 'Gadget', date: '2024-01-02', amount: 300, quantity: 5 },
]

// ============================================================================
// Ranking Window Functions
// ============================================================================

describe('Ranking Window Functions', () => {
  let processor: WindowFunctionProcessor<SalesRecord>

  beforeEach(() => {
    processor = new WindowFunctionProcessor<SalesRecord>()
  })

  describe('ROW_NUMBER', () => {
    it('assigns sequential row numbers within partition', () => {
      const result = processor.process(salesData, {
        function: rowNumber(),
        partitionBy: ['region'],
        orderBy: [{ column: 'amount', direction: 'DESC' }],
        alias: 'row_num',
      })

      // East: 200 (1), 150 (2), 130 (3), 100 (4)
      // West: 300 (1), 250 (2), 180 (3), 120 (4)
      const eastRows = result.filter((r) => r.region === 'East')
      const westRows = result.filter((r) => r.region === 'West')

      expect(eastRows.find((r) => r.amount === 200)?.row_num).toBe(1)
      expect(eastRows.find((r) => r.amount === 150)?.row_num).toBe(2)
      expect(eastRows.find((r) => r.amount === 130)?.row_num).toBe(3)
      expect(eastRows.find((r) => r.amount === 100)?.row_num).toBe(4)

      expect(westRows.find((r) => r.amount === 300)?.row_num).toBe(1)
      expect(westRows.find((r) => r.amount === 250)?.row_num).toBe(2)
    })

    it('assigns global row numbers without partition', () => {
      const result = processor.process(salesData, {
        function: rowNumber(),
        orderBy: [{ column: 'amount', direction: 'ASC' }],
        alias: 'row_num',
      })

      // Should be 1-8 based on amount ascending
      expect(result.find((r) => r.amount === 100)?.row_num).toBe(1)
      expect(result.find((r) => r.amount === 300)?.row_num).toBe(8)
    })
  })

  describe('RANK', () => {
    it('assigns same rank for ties with gaps', () => {
      // Add duplicate amounts
      const dataWithTies: SalesRecord[] = [
        { id: 1, region: 'East', product: 'A', date: '2024-01-01', amount: 100, quantity: 1 },
        { id: 2, region: 'East', product: 'B', date: '2024-01-01', amount: 100, quantity: 1 },
        { id: 3, region: 'East', product: 'C', date: '2024-01-01', amount: 200, quantity: 1 },
        { id: 4, region: 'East', product: 'D', date: '2024-01-01', amount: 150, quantity: 1 },
      ]

      const result = processor.process(dataWithTies, {
        function: rank(),
        partitionBy: ['region'],
        orderBy: [{ column: 'amount', direction: 'ASC' }],
        alias: 'rank',
      })

      // 100 (1), 100 (1), 150 (3), 200 (4) - note gap at rank 2
      const rank100 = result.filter((r) => r.amount === 100).map((r) => r.rank)
      expect(rank100).toEqual([1, 1])

      expect(result.find((r) => r.amount === 150)?.rank).toBe(3)
      expect(result.find((r) => r.amount === 200)?.rank).toBe(4)
    })
  })

  describe('DENSE_RANK', () => {
    it('assigns same rank for ties without gaps', () => {
      const dataWithTies: SalesRecord[] = [
        { id: 1, region: 'East', product: 'A', date: '2024-01-01', amount: 100, quantity: 1 },
        { id: 2, region: 'East', product: 'B', date: '2024-01-01', amount: 100, quantity: 1 },
        { id: 3, region: 'East', product: 'C', date: '2024-01-01', amount: 200, quantity: 1 },
        { id: 4, region: 'East', product: 'D', date: '2024-01-01', amount: 150, quantity: 1 },
      ]

      const result = processor.process(dataWithTies, {
        function: denseRank(),
        partitionBy: ['region'],
        orderBy: [{ column: 'amount', direction: 'ASC' }],
        alias: 'dense_rank',
      })

      // 100 (1), 100 (1), 150 (2), 200 (3) - no gap
      const rank100 = result.filter((r) => r.amount === 100).map((r) => r.dense_rank)
      expect(rank100).toEqual([1, 1])

      expect(result.find((r) => r.amount === 150)?.dense_rank).toBe(2)
      expect(result.find((r) => r.amount === 200)?.dense_rank).toBe(3)
    })
  })

  describe('NTILE', () => {
    it('divides rows into n equal buckets', () => {
      const result = processor.process(salesData, {
        function: ntile(4),
        partitionBy: ['region'],
        orderBy: [{ column: 'amount', direction: 'ASC' }],
        alias: 'quartile',
      })

      // Each region has 4 rows, so each bucket has 1 row
      const eastRows = result.filter((r) => r.region === 'East')
      const quartiles = eastRows.map((r) => r.quartile).sort()
      expect(quartiles).toEqual([1, 2, 3, 4])
    })
  })

  describe('PERCENT_RANK', () => {
    it('calculates relative rank as percentage', () => {
      const result = processor.process(salesData, {
        function: percentRank(),
        partitionBy: ['region'],
        orderBy: [{ column: 'amount', direction: 'ASC' }],
        alias: 'pct_rank',
      })

      // First row in partition should be 0, last should be 1
      const eastRows = result.filter((r) => r.region === 'East')
      const minAmountRow = eastRows.find((r) => r.amount === 100)
      const maxAmountRow = eastRows.find((r) => r.amount === 200)

      expect(minAmountRow?.pct_rank).toBe(0)
      // For 4 rows: (rank - 1) / (n - 1) = 3/3 = 1
      expect(maxAmountRow?.pct_rank).toBe(1)
    })
  })

  describe('CUME_DIST', () => {
    it('calculates cumulative distribution', () => {
      const result = processor.process(salesData, {
        function: cumeDist(),
        partitionBy: ['region'],
        orderBy: [{ column: 'amount', direction: 'ASC' }],
        alias: 'cume_dist',
      })

      // First row: 1/4 = 0.25
      // Last row: 4/4 = 1.0
      const eastRows = result.filter((r) => r.region === 'East')
      const minAmountRow = eastRows.find((r) => r.amount === 100)
      const maxAmountRow = eastRows.find((r) => r.amount === 200)

      expect(minAmountRow?.cume_dist).toBe(0.25)
      expect(maxAmountRow?.cume_dist).toBe(1)
    })
  })
})

// ============================================================================
// Offset Window Functions (LAG/LEAD)
// ============================================================================

describe('Offset Window Functions', () => {
  let processor: WindowFunctionProcessor<SalesRecord>

  beforeEach(() => {
    processor = new WindowFunctionProcessor<SalesRecord>()
  })

  describe('LAG', () => {
    it('returns previous row value within partition', () => {
      const result = processor.process(salesData, {
        function: lag('amount', 1),
        partitionBy: ['region', 'product'],
        orderBy: [{ column: 'date', direction: 'ASC' }],
        alias: 'prev_amount',
      })

      // East Widget: 100 (prev: null), 150 (prev: 100), 130 (prev: 150)
      const eastWidget = result.filter((r) => r.region === 'East' && r.product === 'Widget')
      const sorted = eastWidget.sort((a, b) => a.date.localeCompare(b.date))

      expect(sorted[0]?.prev_amount).toBeNull()
      expect(sorted[1]?.prev_amount).toBe(100)
      expect(sorted[2]?.prev_amount).toBe(150)
    })

    it('returns default value when no previous row', () => {
      const result = processor.process(salesData, {
        function: lag('amount', 1, -1),
        partitionBy: ['region'],
        orderBy: [{ column: 'date', direction: 'ASC' }],
        alias: 'prev_amount',
      })

      // First row in each partition should have default -1
      const eastRows = result.filter((r) => r.region === 'East')
      const firstRow = eastRows.reduce((min, r) =>
        r.date < min.date ? r : (r.date === min.date && r.id < min.id ? r : min)
      )
      expect(firstRow.prev_amount).toBe(-1)
    })

    it('supports offset greater than 1', () => {
      const result = processor.process(salesData, {
        function: lag('amount', 2),
        partitionBy: ['region'],
        orderBy: [{ column: 'date', direction: 'ASC' }, { column: 'id', direction: 'ASC' }],
        alias: 'prev_2_amount',
      })

      // Third row should have value of first row
      const eastRows = result
        .filter((r) => r.region === 'East')
        .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)

      expect(eastRows[0]?.prev_2_amount).toBeNull()
      expect(eastRows[1]?.prev_2_amount).toBeNull()
      expect(eastRows[2]?.prev_2_amount).toBe(eastRows[0]?.amount)
    })
  })

  describe('LEAD', () => {
    it('returns next row value within partition', () => {
      const result = processor.process(salesData, {
        function: lead('amount', 1),
        partitionBy: ['region', 'product'],
        orderBy: [{ column: 'date', direction: 'ASC' }],
        alias: 'next_amount',
      })

      // East Widget: 100 (next: 150), 150 (next: 130), 130 (next: null)
      const eastWidget = result.filter((r) => r.region === 'East' && r.product === 'Widget')
      const sorted = eastWidget.sort((a, b) => a.date.localeCompare(b.date))

      expect(sorted[0]?.next_amount).toBe(150)
      expect(sorted[1]?.next_amount).toBe(130)
      expect(sorted[2]?.next_amount).toBeNull()
    })

    it('returns default value when no next row', () => {
      const result = processor.process(salesData, {
        function: lead('amount', 1, 0),
        partitionBy: ['region'],
        orderBy: [{ column: 'date', direction: 'DESC' }],
        alias: 'next_amount',
      })

      // Last row in each partition (earliest date) should have default 0
      const eastRows = result
        .filter((r) => r.region === 'East')
        .sort((a, b) => b.date.localeCompare(a.date))
      expect(eastRows[eastRows.length - 1]?.next_amount).toBe(0)
    })
  })
})

// ============================================================================
// Value Window Functions (FIRST_VALUE, LAST_VALUE, NTH_VALUE)
// ============================================================================

describe('Value Window Functions', () => {
  let processor: WindowFunctionProcessor<SalesRecord>

  beforeEach(() => {
    processor = new WindowFunctionProcessor<SalesRecord>()
  })

  describe('FIRST_VALUE', () => {
    it('returns first value in partition', () => {
      const result = processor.process(salesData, {
        function: firstValue('amount'),
        partitionBy: ['region'],
        orderBy: [{ column: 'amount', direction: 'DESC' }],
        alias: 'first_amount',
      })

      // All rows in East should have the max amount (200) as first value
      const eastRows = result.filter((r) => r.region === 'East')
      eastRows.forEach((r) => {
        expect(r.first_amount).toBe(200)
      })
    })
  })

  describe('LAST_VALUE', () => {
    it('returns last value in frame (default RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)', () => {
      const result = processor.process(salesData, {
        function: lastValue('amount'),
        partitionBy: ['region'],
        orderBy: [{ column: 'amount', direction: 'ASC' }],
        alias: 'last_amount',
      })

      // With default frame, last_value equals current row
      const eastRows = result.filter((r) => r.region === 'East')
      eastRows.forEach((r) => {
        expect(r.last_amount).toBe(r.amount)
      })
    })

    it('returns actual last value with ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING', () => {
      const result = processor.process(salesData, {
        function: lastValue('amount'),
        partitionBy: ['region'],
        orderBy: [{ column: 'amount', direction: 'ASC' }],
        frame: {
          type: 'ROWS',
          start: { type: 'UNBOUNDED PRECEDING' },
          end: { type: 'UNBOUNDED FOLLOWING' },
        },
        alias: 'last_amount',
      })

      // All rows should have the max amount in partition
      const eastRows = result.filter((r) => r.region === 'East')
      eastRows.forEach((r) => {
        expect(r.last_amount).toBe(200)
      })
    })
  })

  describe('NTH_VALUE', () => {
    it('returns nth value in partition', () => {
      const result = processor.process(salesData, {
        function: nthValue('amount', 2),
        partitionBy: ['region'],
        orderBy: [{ column: 'amount', direction: 'DESC' }],
        frame: {
          type: 'ROWS',
          start: { type: 'UNBOUNDED PRECEDING' },
          end: { type: 'UNBOUNDED FOLLOWING' },
        },
        alias: 'second_amount',
      })

      // East: 200, 150, 130, 100 - second is 150
      const eastRows = result.filter((r) => r.region === 'East')
      eastRows.forEach((r) => {
        expect(r.second_amount).toBe(150)
      })
    })

    it('returns null when n exceeds partition size', () => {
      const smallData: SalesRecord[] = [
        { id: 1, region: 'East', product: 'A', date: '2024-01-01', amount: 100, quantity: 1 },
      ]

      const result = processor.process(smallData, {
        function: nthValue('amount', 5),
        partitionBy: ['region'],
        orderBy: [{ column: 'amount', direction: 'DESC' }],
        alias: 'fifth_amount',
      })

      expect(result[0]?.fifth_amount).toBeNull()
    })
  })
})

// ============================================================================
// Aggregate Window Functions
// ============================================================================

describe('Aggregate Window Functions', () => {
  let processor: WindowFunctionProcessor<SalesRecord>

  beforeEach(() => {
    processor = new WindowFunctionProcessor<SalesRecord>()
  })

  describe('Running Totals (SUM OVER)', () => {
    it('calculates running total within partition', () => {
      const result = processor.process(salesData, {
        function: sumOver('amount'),
        partitionBy: ['region'],
        orderBy: [{ column: 'date', direction: 'ASC' }, { column: 'id', direction: 'ASC' }],
        alias: 'running_total',
      })

      // East (ordered): 100, 200, 150, 130 -> running: 100, 300, 450, 580
      const eastRows = result
        .filter((r) => r.region === 'East')
        .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)

      let runningTotal = 0
      for (const row of eastRows) {
        runningTotal += row.amount
        expect(row.running_total).toBe(runningTotal)
      }
    })

    it('calculates global running total without partition', () => {
      const result = processor.process(salesData, {
        function: sumOver('amount'),
        orderBy: [{ column: 'id', direction: 'ASC' }],
        alias: 'running_total',
      })

      // Sum all amounts in id order
      let total = 0
      const sorted = result.sort((a, b) => a.id - b.id)
      for (const row of sorted) {
        total += salesData.find((d) => d.id === row.id)!.amount
        expect(row.running_total).toBe(total)
      }
    })
  })

  describe('Moving Averages (AVG OVER)', () => {
    it('calculates cumulative average', () => {
      const result = processor.process(salesData, {
        function: avgOver('amount'),
        partitionBy: ['region'],
        orderBy: [{ column: 'date', direction: 'ASC' }, { column: 'id', direction: 'ASC' }],
        alias: 'cumulative_avg',
      })

      // Verify first row has its own value as average
      const eastRows = result
        .filter((r) => r.region === 'East')
        .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)

      expect(eastRows[0]?.cumulative_avg).toBe(eastRows[0]?.amount)
    })

    it('calculates 3-row moving average', () => {
      const result = processor.process(salesData, {
        function: avgOver('amount'),
        partitionBy: ['region'],
        orderBy: [{ column: 'date', direction: 'ASC' }, { column: 'id', direction: 'ASC' }],
        frame: {
          type: 'ROWS',
          start: { type: 'PRECEDING', offset: 2 },
          end: { type: 'CURRENT ROW' },
        },
        alias: 'moving_avg_3',
      })

      const eastRows = result
        .filter((r) => r.region === 'East')
        .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)

      // First row: just itself
      expect(eastRows[0]?.moving_avg_3).toBe(eastRows[0]?.amount)

      // Third row: average of first 3 rows
      if (eastRows.length >= 3) {
        const expected = (eastRows[0]!.amount + eastRows[1]!.amount + eastRows[2]!.amount) / 3
        expect(eastRows[2]?.moving_avg_3).toBeCloseTo(expected, 5)
      }
    })
  })

  describe('MIN/MAX OVER', () => {
    it('calculates running minimum', () => {
      const result = processor.process(salesData, {
        function: minOver('amount'),
        partitionBy: ['region'],
        orderBy: [{ column: 'date', direction: 'ASC' }],
        alias: 'running_min',
      })

      // Running min should monotonically decrease or stay same
      const eastRows = result
        .filter((r) => r.region === 'East')
        .sort((a, b) => a.date.localeCompare(b.date))

      let currentMin = Number.MAX_VALUE
      for (const row of eastRows) {
        currentMin = Math.min(currentMin, row.amount)
        expect(row.running_min).toBeLessThanOrEqual(currentMin)
      }
    })

    it('calculates running maximum', () => {
      const result = processor.process(salesData, {
        function: maxOver('amount'),
        partitionBy: ['region'],
        orderBy: [{ column: 'date', direction: 'ASC' }],
        alias: 'running_max',
      })

      const eastRows = result
        .filter((r) => r.region === 'East')
        .sort((a, b) => a.date.localeCompare(b.date))

      let currentMax = Number.MIN_VALUE
      for (const row of eastRows) {
        currentMax = Math.max(currentMax, row.amount)
        expect(row.running_max).toBeGreaterThanOrEqual(currentMax - 1) // Allow for ties
      }
    })
  })

  describe('COUNT OVER', () => {
    it('calculates running count', () => {
      const result = processor.process(salesData, {
        function: countOver(),
        partitionBy: ['region'],
        orderBy: [{ column: 'date', direction: 'ASC' }],
        alias: 'row_count',
      })

      // Count should increase monotonically
      const eastRows = result
        .filter((r) => r.region === 'East')
        .sort((a, b) => a.date.localeCompare(b.date))

      for (let i = 0; i < eastRows.length; i++) {
        expect(eastRows[i]?.row_count).toBeGreaterThanOrEqual(i + 1)
      }
    })
  })
})

// ============================================================================
// Frame Specifications (ROWS vs RANGE)
// ============================================================================

describe('Window Frame Specifications', () => {
  let processor: WindowFunctionProcessor<SalesRecord>

  beforeEach(() => {
    processor = new WindowFunctionProcessor<SalesRecord>()
  })

  describe('ROWS frame', () => {
    it('uses physical row offset', () => {
      const dataWithDuplicates: SalesRecord[] = [
        { id: 1, region: 'East', product: 'A', date: '2024-01-01', amount: 100, quantity: 1 },
        { id: 2, region: 'East', product: 'B', date: '2024-01-01', amount: 100, quantity: 2 },
        { id: 3, region: 'East', product: 'C', date: '2024-01-02', amount: 200, quantity: 3 },
        { id: 4, region: 'East', product: 'D', date: '2024-01-02', amount: 200, quantity: 4 },
      ]

      const result = processor.process(dataWithDuplicates, {
        function: sumOver('quantity'),
        partitionBy: ['region'],
        orderBy: [{ column: 'amount', direction: 'ASC' }],
        frame: {
          type: 'ROWS',
          start: { type: 'UNBOUNDED PRECEDING' },
          end: { type: 'CURRENT ROW' },
        },
        alias: 'qty_sum',
      })

      // ROWS mode: each row is separate even with same amount
      const sorted = result.sort((a, b) => a.id - b.id)
      expect(sorted[0]?.qty_sum).toBe(1) // Just first row
      expect(sorted[1]?.qty_sum).toBe(3) // 1 + 2
      expect(sorted[2]?.qty_sum).toBe(6) // 1 + 2 + 3
      expect(sorted[3]?.qty_sum).toBe(10) // 1 + 2 + 3 + 4
    })
  })

  describe('RANGE frame', () => {
    it('uses logical value range', () => {
      const dataWithDuplicates: SalesRecord[] = [
        { id: 1, region: 'East', product: 'A', date: '2024-01-01', amount: 100, quantity: 1 },
        { id: 2, region: 'East', product: 'B', date: '2024-01-01', amount: 100, quantity: 2 },
        { id: 3, region: 'East', product: 'C', date: '2024-01-02', amount: 200, quantity: 3 },
        { id: 4, region: 'East', product: 'D', date: '2024-01-02', amount: 200, quantity: 4 },
      ]

      const result = processor.process(dataWithDuplicates, {
        function: sumOver('quantity'),
        partitionBy: ['region'],
        orderBy: [{ column: 'amount', direction: 'ASC' }],
        frame: {
          type: 'RANGE',
          start: { type: 'UNBOUNDED PRECEDING' },
          end: { type: 'CURRENT ROW' },
        },
        alias: 'qty_sum',
      })

      // RANGE mode: rows with same ORDER BY value are in same peer group
      // Rows with amount=100: sum of qty for all amount<=100 = 1+2 = 3
      // Rows with amount=200: sum of qty for all amount<=200 = 1+2+3+4 = 10
      const rows100 = result.filter((r) => r.amount === 100)
      const rows200 = result.filter((r) => r.amount === 200)

      rows100.forEach((r) => expect(r.qty_sum).toBe(3))
      rows200.forEach((r) => expect(r.qty_sum).toBe(10))
    })
  })

  describe('Frame boundary types', () => {
    it('handles CURRENT ROW boundary', () => {
      const result = processor.process(salesData.slice(0, 4), {
        function: sumOver('amount'),
        orderBy: [{ column: 'id', direction: 'ASC' }],
        frame: {
          type: 'ROWS',
          start: { type: 'CURRENT ROW' },
          end: { type: 'CURRENT ROW' },
        },
        alias: 'self_sum',
      })

      // Each row should just have its own amount
      result.forEach((r) => {
        expect(r.self_sum).toBe(r.amount)
      })
    })

    it('handles N PRECEDING boundary', () => {
      const result = processor.process(salesData.slice(0, 4), {
        function: sumOver('amount'),
        orderBy: [{ column: 'id', direction: 'ASC' }],
        frame: {
          type: 'ROWS',
          start: { type: 'PRECEDING', offset: 1 },
          end: { type: 'CURRENT ROW' },
        },
        alias: 'prev_sum',
      })

      const sorted = result.sort((a, b) => a.id - b.id)
      // Row 1: just row 1
      expect(sorted[0]?.prev_sum).toBe(sorted[0]?.amount)
      // Row 2: row 1 + row 2
      expect(sorted[1]?.prev_sum).toBe(sorted[0]!.amount + sorted[1]!.amount)
    })

    it('handles N FOLLOWING boundary', () => {
      const result = processor.process(salesData.slice(0, 4), {
        function: sumOver('amount'),
        orderBy: [{ column: 'id', direction: 'ASC' }],
        frame: {
          type: 'ROWS',
          start: { type: 'CURRENT ROW' },
          end: { type: 'FOLLOWING', offset: 1 },
        },
        alias: 'next_sum',
      })

      const sorted = result.sort((a, b) => a.id - b.id)
      // Row 1: row 1 + row 2
      expect(sorted[0]?.next_sum).toBe(sorted[0]!.amount + sorted[1]!.amount)
      // Last row: just last row
      expect(sorted[3]?.next_sum).toBe(sorted[3]?.amount)
    })

    it('handles UNBOUNDED FOLLOWING boundary', () => {
      const result = processor.process(salesData.slice(0, 4), {
        function: sumOver('amount'),
        orderBy: [{ column: 'id', direction: 'ASC' }],
        frame: {
          type: 'ROWS',
          start: { type: 'CURRENT ROW' },
          end: { type: 'UNBOUNDED FOLLOWING' },
        },
        alias: 'future_sum',
      })

      const sorted = result.sort((a, b) => a.id - b.id)
      const totalSum = sorted.reduce((sum, r) => sum + r.amount, 0)

      // First row should have sum of all rows
      expect(sorted[0]?.future_sum).toBe(totalSum)
      // Last row should just have itself
      expect(sorted[3]?.future_sum).toBe(sorted[3]?.amount)
    })
  })
})

// ============================================================================
// Performance Optimizations
// ============================================================================

describe('Window Function Optimizations', () => {
  let processor: WindowFunctionProcessor<SalesRecord>

  beforeEach(() => {
    processor = new WindowFunctionProcessor<SalesRecord>()
  })

  describe('Frame Caching', () => {
    it('caches frame calculations for repeated accesses', () => {
      // Process with frame caching enabled
      const result = processor.process(salesData, {
        function: sumOver('amount'),
        partitionBy: ['region'],
        orderBy: [{ column: 'date', direction: 'ASC' }],
        frame: {
          type: 'ROWS',
          start: { type: 'PRECEDING', offset: 2 },
          end: { type: 'CURRENT ROW' },
        },
        alias: 'sum_3',
      })

      expect(result.length).toBe(salesData.length)
      // Frame caching is an internal optimization, verify results are correct
      const eastRows = result
        .filter((r) => r.region === 'East')
        .sort((a, b) => a.date.localeCompare(b.date))

      // First row should just have itself
      expect(eastRows[0]?.sum_3).toBe(eastRows[0]?.amount)
    })

    it('uses incremental calculation for sliding windows', () => {
      // Large dataset to test incremental optimization
      const largeData: SalesRecord[] = Array.from({ length: 1000 }, (_, i) => ({
        id: i + 1,
        region: 'Test',
        product: 'A',
        date: `2024-01-${String((i % 28) + 1).padStart(2, '0')}`,
        amount: Math.random() * 1000,
        quantity: Math.floor(Math.random() * 10) + 1,
      }))

      const startTime = performance.now()

      const result = processor.process(largeData, {
        function: sumOver('amount'),
        orderBy: [{ column: 'id', direction: 'ASC' }],
        frame: {
          type: 'ROWS',
          start: { type: 'PRECEDING', offset: 10 },
          end: { type: 'CURRENT ROW' },
        },
        alias: 'sliding_sum',
      })

      const endTime = performance.now()

      expect(result.length).toBe(1000)
      // Incremental should be fast - verify rough performance
      expect(endTime - startTime).toBeLessThan(1000) // Should complete in under 1s
    })
  })

  describe('Partition-aware Processing', () => {
    it('processes partitions independently', () => {
      const result = processor.process(salesData, {
        function: rowNumber(),
        partitionBy: ['region', 'product'],
        orderBy: [{ column: 'date', direction: 'ASC' }],
        alias: 'row_num',
      })

      // Each partition should have independent row numbers
      const partitions = new Map<string, number[]>()
      for (const row of result) {
        const key = `${row.region}-${row.product}`
        if (!partitions.has(key)) partitions.set(key, [])
        partitions.get(key)!.push(row.row_num as number)
      }

      // Each partition should start at 1
      for (const [_, nums] of partitions) {
        expect(Math.min(...nums)).toBe(1)
      }
    })
  })

  describe('Memory-efficient Frame Management', () => {
    it('does not hold entire partition in memory for streaming aggregates', () => {
      // Create a very large synthetic partition
      const largePartition: SalesRecord[] = Array.from({ length: 10000 }, (_, i) => ({
        id: i + 1,
        region: 'Large',
        product: 'Test',
        date: '2024-01-01',
        amount: i + 1,
        quantity: 1,
      }))

      // Running sum should work without OOM
      const result = processor.process(largePartition, {
        function: sumOver('amount'),
        partitionBy: ['region'],
        orderBy: [{ column: 'id', direction: 'ASC' }],
        alias: 'running_sum',
      })

      // Verify last row has correct sum: 1+2+...+10000 = 10000*10001/2 = 50005000
      const lastRow = result.find((r) => r.id === 10000)
      expect(lastRow?.running_sum).toBe(50005000)
    })
  })
})

// ============================================================================
// Multiple Window Functions
// ============================================================================

describe('Multiple Window Functions', () => {
  let processor: WindowFunctionProcessor<SalesRecord>

  beforeEach(() => {
    processor = new WindowFunctionProcessor<SalesRecord>()
  })

  it('applies multiple window functions in single pass', () => {
    const specs: WindowSpec[] = [
      {
        function: rowNumber(),
        partitionBy: ['region'],
        orderBy: [{ column: 'amount', direction: 'DESC' }],
        alias: 'rank_by_amount',
      },
      {
        function: sumOver('amount'),
        partitionBy: ['region'],
        orderBy: [{ column: 'date', direction: 'ASC' }],
        alias: 'running_total',
      },
      {
        function: lag('amount', 1),
        partitionBy: ['region'],
        orderBy: [{ column: 'date', direction: 'ASC' }],
        alias: 'prev_amount',
      },
    ]

    const result = processor.processMultiple(salesData, specs)

    // All window function results should be present
    expect(result[0]).toHaveProperty('rank_by_amount')
    expect(result[0]).toHaveProperty('running_total')
    expect(result[0]).toHaveProperty('prev_amount')
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  let processor: WindowFunctionProcessor<SalesRecord>

  beforeEach(() => {
    processor = new WindowFunctionProcessor<SalesRecord>()
  })

  it('handles empty input', () => {
    const result = processor.process([], {
      function: rowNumber(),
      orderBy: [{ column: 'id', direction: 'ASC' }],
      alias: 'row_num',
    })

    expect(result).toEqual([])
  })

  it('handles single row', () => {
    const singleRow: SalesRecord[] = [
      { id: 1, region: 'East', product: 'Widget', date: '2024-01-01', amount: 100, quantity: 5 },
    ]

    const result = processor.process(singleRow, {
      function: rowNumber(),
      orderBy: [{ column: 'id', direction: 'ASC' }],
      alias: 'row_num',
    })

    expect(result[0]?.row_num).toBe(1)
  })

  it('handles null values in order by column', () => {
    const dataWithNulls = [
      { id: 1, region: 'East', product: 'A', date: '2024-01-01', amount: null as unknown as number, quantity: 1 },
      { id: 2, region: 'East', product: 'B', date: '2024-01-01', amount: 100, quantity: 2 },
      { id: 3, region: 'East', product: 'C', date: '2024-01-01', amount: 200, quantity: 3 },
    ]

    const result = processor.process(dataWithNulls, {
      function: rowNumber(),
      orderBy: [{ column: 'amount', direction: 'ASC', nulls: 'FIRST' }],
      alias: 'row_num',
    })

    // Null should be first
    const nullRow = result.find((r) => r.amount === null)
    expect(nullRow?.row_num).toBe(1)
  })

  it('handles null values in partition by column', () => {
    const dataWithNulls = [
      { id: 1, region: null as unknown as string, product: 'A', date: '2024-01-01', amount: 100, quantity: 1 },
      { id: 2, region: null as unknown as string, product: 'B', date: '2024-01-01', amount: 200, quantity: 2 },
      { id: 3, region: 'East', product: 'C', date: '2024-01-01', amount: 300, quantity: 3 },
    ]

    const result = processor.process(dataWithNulls, {
      function: rowNumber(),
      partitionBy: ['region'],
      orderBy: [{ column: 'amount', direction: 'ASC' }],
      alias: 'row_num',
    })

    // Null partition should be treated as its own group
    const nullPartition = result.filter((r) => r.region === null)
    expect(nullPartition.find((r) => r.amount === 100)?.row_num).toBe(1)
    expect(nullPartition.find((r) => r.amount === 200)?.row_num).toBe(2)
  })
})

// ============================================================================
// Additional Comprehensive Tests
// ============================================================================

describe('Multi-column ORDER BY', () => {
  let processor: WindowFunctionProcessor<SalesRecord>

  beforeEach(() => {
    processor = new WindowFunctionProcessor<SalesRecord>()
  })

  it('ROW_NUMBER with multiple ORDER BY columns', () => {
    const data: SalesRecord[] = [
      { id: 1, region: 'East', product: 'Widget', date: '2024-01-01', amount: 100, quantity: 5 },
      { id: 2, region: 'East', product: 'Widget', date: '2024-01-01', amount: 100, quantity: 3 },
      { id: 3, region: 'East', product: 'Gadget', date: '2024-01-02', amount: 100, quantity: 7 },
      { id: 4, region: 'East', product: 'Widget', date: '2024-01-01', amount: 200, quantity: 2 },
    ]

    const result = processor.process(data, {
      function: rowNumber(),
      partitionBy: ['region'],
      orderBy: [
        { column: 'amount', direction: 'ASC' },
        { column: 'quantity', direction: 'DESC' },
      ],
      alias: 'row_num',
    })

    // Within amount=100: qty 7 (1), qty 5 (2), qty 3 (3)
    // Then amount=200: qty 2 (4)
    expect(result.find((r) => r.id === 3)?.row_num).toBe(1) // amount 100, qty 7
    expect(result.find((r) => r.id === 1)?.row_num).toBe(2) // amount 100, qty 5
    expect(result.find((r) => r.id === 2)?.row_num).toBe(3) // amount 100, qty 3
    expect(result.find((r) => r.id === 4)?.row_num).toBe(4) // amount 200, qty 2
  })

  it('RANK with ties across multiple columns', () => {
    const data: SalesRecord[] = [
      { id: 1, region: 'East', product: 'A', date: '2024-01-01', amount: 100, quantity: 5 },
      { id: 2, region: 'East', product: 'B', date: '2024-01-01', amount: 100, quantity: 5 },
      { id: 3, region: 'East', product: 'C', date: '2024-01-02', amount: 100, quantity: 3 },
      { id: 4, region: 'East', product: 'D', date: '2024-01-02', amount: 200, quantity: 5 },
    ]

    const result = processor.process(data, {
      function: rank(),
      partitionBy: ['region'],
      orderBy: [
        { column: 'amount', direction: 'ASC' },
        { column: 'quantity', direction: 'ASC' },
      ],
      alias: 'rank',
    })

    // (100, 3) -> rank 1
    // (100, 5), (100, 5) -> rank 2 (ties)
    // (200, 5) -> rank 4 (gap due to tie)
    expect(result.find((r) => r.id === 3)?.rank).toBe(1)
    expect(result.find((r) => r.id === 1)?.rank).toBe(2)
    expect(result.find((r) => r.id === 2)?.rank).toBe(2)
    expect(result.find((r) => r.id === 4)?.rank).toBe(4)
  })

  it('DENSE_RANK with ties across multiple columns', () => {
    const data: SalesRecord[] = [
      { id: 1, region: 'East', product: 'A', date: '2024-01-01', amount: 100, quantity: 5 },
      { id: 2, region: 'East', product: 'B', date: '2024-01-01', amount: 100, quantity: 5 },
      { id: 3, region: 'East', product: 'C', date: '2024-01-02', amount: 100, quantity: 3 },
      { id: 4, region: 'East', product: 'D', date: '2024-01-02', amount: 200, quantity: 5 },
    ]

    const result = processor.process(data, {
      function: denseRank(),
      partitionBy: ['region'],
      orderBy: [
        { column: 'amount', direction: 'ASC' },
        { column: 'quantity', direction: 'ASC' },
      ],
      alias: 'dense_rank',
    })

    // (100, 3) -> rank 1
    // (100, 5), (100, 5) -> rank 2 (ties)
    // (200, 5) -> rank 3 (no gap)
    expect(result.find((r) => r.id === 3)?.dense_rank).toBe(1)
    expect(result.find((r) => r.id === 1)?.dense_rank).toBe(2)
    expect(result.find((r) => r.id === 2)?.dense_rank).toBe(2)
    expect(result.find((r) => r.id === 4)?.dense_rank).toBe(3)
  })
})

describe('Complex PARTITION BY Scenarios', () => {
  let processor: WindowFunctionProcessor<SalesRecord>

  beforeEach(() => {
    processor = new WindowFunctionProcessor<SalesRecord>()
  })

  it('partitions by multiple columns', () => {
    const result = processor.process(salesData, {
      function: rowNumber(),
      partitionBy: ['region', 'product'],
      orderBy: [{ column: 'date', direction: 'ASC' }],
      alias: 'row_num',
    })

    // East Widget: 3 rows, West Widget: 2 rows, East Gadget: 1, West Gadget: 2
    const eastWidget = result.filter((r) => r.region === 'East' && r.product === 'Widget')
    const westWidget = result.filter((r) => r.region === 'West' && r.product === 'Widget')
    const eastGadget = result.filter((r) => r.region === 'East' && r.product === 'Gadget')
    const westGadget = result.filter((r) => r.region === 'West' && r.product === 'Gadget')

    expect(eastWidget.map((r) => r.row_num).sort()).toEqual([1, 2, 3])
    expect(westWidget.map((r) => r.row_num).sort()).toEqual([1, 2])
    expect(eastGadget.map((r) => r.row_num)).toEqual([1])
    expect(westGadget.map((r) => r.row_num).sort()).toEqual([1, 2])
  })

  it('running sum partitioned by multiple columns', () => {
    const result = processor.process(salesData, {
      function: sumOver('amount'),
      partitionBy: ['region', 'product'],
      orderBy: [{ column: 'date', direction: 'ASC' }],
      alias: 'running_total',
    })

    // East Widget: 100, 150, 130 -> running: 100, 250, 380
    const eastWidget = result
      .filter((r) => r.region === 'East' && r.product === 'Widget')
      .sort((a, b) => a.date.localeCompare(b.date))

    expect(eastWidget[0]?.running_total).toBe(100)
    expect(eastWidget[1]?.running_total).toBe(250)
    expect(eastWidget[2]?.running_total).toBe(380)
  })

  it('handles single-row partitions', () => {
    const result = processor.process(salesData, {
      function: sumOver('amount'),
      partitionBy: ['region', 'product'],
      orderBy: [{ column: 'date', direction: 'ASC' }],
      alias: 'running_total',
    })

    // East Gadget has only 1 row
    const eastGadget = result.filter((r) => r.region === 'East' && r.product === 'Gadget')
    expect(eastGadget).toHaveLength(1)
    expect(eastGadget[0]?.running_total).toBe(200)
  })
})

describe('Advanced LAG/LEAD Scenarios', () => {
  let processor: WindowFunctionProcessor<SalesRecord>

  beforeEach(() => {
    processor = new WindowFunctionProcessor<SalesRecord>()
  })

  it('LAG with offset of 3', () => {
    const data: SalesRecord[] = [
      { id: 1, region: 'East', product: 'A', date: '2024-01-01', amount: 100, quantity: 1 },
      { id: 2, region: 'East', product: 'A', date: '2024-01-02', amount: 200, quantity: 2 },
      { id: 3, region: 'East', product: 'A', date: '2024-01-03', amount: 300, quantity: 3 },
      { id: 4, region: 'East', product: 'A', date: '2024-01-04', amount: 400, quantity: 4 },
      { id: 5, region: 'East', product: 'A', date: '2024-01-05', amount: 500, quantity: 5 },
    ]

    const result = processor.process(data, {
      function: lag('amount', 3, -999),
      partitionBy: ['region'],
      orderBy: [{ column: 'date', direction: 'ASC' }],
      alias: 'lag_3',
    })

    const sorted = result.sort((a, b) => a.id - b.id)
    expect(sorted[0]?.lag_3).toBe(-999) // No row 3 before
    expect(sorted[1]?.lag_3).toBe(-999) // No row 3 before
    expect(sorted[2]?.lag_3).toBe(-999) // No row 3 before
    expect(sorted[3]?.lag_3).toBe(100) // Row 1's amount
    expect(sorted[4]?.lag_3).toBe(200) // Row 2's amount
  })

  it('LEAD with offset of 3', () => {
    const data: SalesRecord[] = [
      { id: 1, region: 'East', product: 'A', date: '2024-01-01', amount: 100, quantity: 1 },
      { id: 2, region: 'East', product: 'A', date: '2024-01-02', amount: 200, quantity: 2 },
      { id: 3, region: 'East', product: 'A', date: '2024-01-03', amount: 300, quantity: 3 },
      { id: 4, region: 'East', product: 'A', date: '2024-01-04', amount: 400, quantity: 4 },
      { id: 5, region: 'East', product: 'A', date: '2024-01-05', amount: 500, quantity: 5 },
    ]

    const result = processor.process(data, {
      function: lead('amount', 3, -999),
      partitionBy: ['region'],
      orderBy: [{ column: 'date', direction: 'ASC' }],
      alias: 'lead_3',
    })

    const sorted = result.sort((a, b) => a.id - b.id)
    expect(sorted[0]?.lead_3).toBe(400) // Row 4's amount
    expect(sorted[1]?.lead_3).toBe(500) // Row 5's amount
    expect(sorted[2]?.lead_3).toBe(-999) // No row 3 after
    expect(sorted[3]?.lead_3).toBe(-999) // No row 3 after
    expect(sorted[4]?.lead_3).toBe(-999) // No row 3 after
  })

  it('LAG across partition boundaries', () => {
    const result = processor.process(salesData, {
      function: lag('amount', 1, -1),
      partitionBy: ['region'],
      orderBy: [{ column: 'date', direction: 'ASC' }, { column: 'id', direction: 'ASC' }],
      alias: 'prev_amount',
    })

    // First row in East partition should have default -1
    const eastRows = result
      .filter((r) => r.region === 'East')
      .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)

    expect(eastRows[0]?.prev_amount).toBe(-1)

    // First row in West partition should also have default -1
    const westRows = result
      .filter((r) => r.region === 'West')
      .sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id)

    expect(westRows[0]?.prev_amount).toBe(-1)
  })

  it('calculates day-over-day change using LAG', () => {
    const data: SalesRecord[] = [
      { id: 1, region: 'East', product: 'A', date: '2024-01-01', amount: 100, quantity: 1 },
      { id: 2, region: 'East', product: 'A', date: '2024-01-02', amount: 150, quantity: 2 },
      { id: 3, region: 'East', product: 'A', date: '2024-01-03', amount: 120, quantity: 3 },
    ]

    const result = processor.process(data, {
      function: lag('amount', 1, 0),
      partitionBy: ['region'],
      orderBy: [{ column: 'date', direction: 'ASC' }],
      alias: 'prev_amount',
    })

    const sorted = result.sort((a, b) => a.date.localeCompare(b.date))

    // Calculate change manually
    expect(sorted[0]?.amount - (sorted[0]?.prev_amount as number)).toBe(100) // 100 - 0
    expect(sorted[1]?.amount - (sorted[1]?.prev_amount as number)).toBe(50)  // 150 - 100
    expect(sorted[2]?.amount - (sorted[2]?.prev_amount as number)).toBe(-30) // 120 - 150
  })
})

describe('SUM/AVG OVER with Various Frames', () => {
  let processor: WindowFunctionProcessor<SalesRecord>

  beforeEach(() => {
    processor = new WindowFunctionProcessor<SalesRecord>()
  })

  it('calculates centered moving average (1 PRECEDING to 1 FOLLOWING)', () => {
    const data: SalesRecord[] = [
      { id: 1, region: 'East', product: 'A', date: '2024-01-01', amount: 100, quantity: 1 },
      { id: 2, region: 'East', product: 'A', date: '2024-01-02', amount: 200, quantity: 2 },
      { id: 3, region: 'East', product: 'A', date: '2024-01-03', amount: 150, quantity: 3 },
      { id: 4, region: 'East', product: 'A', date: '2024-01-04', amount: 250, quantity: 4 },
      { id: 5, region: 'East', product: 'A', date: '2024-01-05', amount: 175, quantity: 5 },
    ]

    const result = processor.process(data, {
      function: avgOver('amount'),
      orderBy: [{ column: 'id', direction: 'ASC' }],
      frame: {
        type: 'ROWS',
        start: { type: 'PRECEDING', offset: 1 },
        end: { type: 'FOLLOWING', offset: 1 },
      },
      alias: 'centered_avg',
    })

    const sorted = result.sort((a, b) => a.id - b.id)

    // Row 1: avg(100, 200) = 150
    expect(sorted[0]?.centered_avg).toBeCloseTo(150, 5)
    // Row 2: avg(100, 200, 150) = 150
    expect(sorted[1]?.centered_avg).toBeCloseTo(150, 5)
    // Row 3: avg(200, 150, 250) = 200
    expect(sorted[2]?.centered_avg).toBeCloseTo(200, 5)
    // Row 4: avg(150, 250, 175) = 191.67
    expect(sorted[3]?.centered_avg).toBeCloseTo(191.6667, 4)
    // Row 5: avg(250, 175) = 212.5
    expect(sorted[4]?.centered_avg).toBeCloseTo(212.5, 5)
  })

  it('calculates exponential-like weighting with 2 PRECEDING', () => {
    const data: SalesRecord[] = [
      { id: 1, region: 'East', product: 'A', date: '2024-01-01', amount: 10, quantity: 1 },
      { id: 2, region: 'East', product: 'A', date: '2024-01-02', amount: 20, quantity: 2 },
      { id: 3, region: 'East', product: 'A', date: '2024-01-03', amount: 30, quantity: 3 },
      { id: 4, region: 'East', product: 'A', date: '2024-01-04', amount: 40, quantity: 4 },
    ]

    const result = processor.process(data, {
      function: sumOver('amount'),
      orderBy: [{ column: 'id', direction: 'ASC' }],
      frame: {
        type: 'ROWS',
        start: { type: 'PRECEDING', offset: 2 },
        end: { type: 'CURRENT ROW' },
      },
      alias: 'sum_3',
    })

    const sorted = result.sort((a, b) => a.id - b.id)

    // Row 1: sum(10) = 10
    expect(sorted[0]?.sum_3).toBe(10)
    // Row 2: sum(10, 20) = 30
    expect(sorted[1]?.sum_3).toBe(30)
    // Row 3: sum(10, 20, 30) = 60
    expect(sorted[2]?.sum_3).toBe(60)
    // Row 4: sum(20, 30, 40) = 90
    expect(sorted[3]?.sum_3).toBe(90)
  })

  it('calculates trailing sum with UNBOUNDED PRECEDING', () => {
    const result = processor.process(salesData.slice(0, 4), {
      function: sumOver('amount'),
      orderBy: [{ column: 'id', direction: 'ASC' }],
      frame: {
        type: 'ROWS',
        start: { type: 'UNBOUNDED PRECEDING' },
        end: { type: 'CURRENT ROW' },
      },
      alias: 'cumulative_sum',
    })

    const sorted = result.sort((a, b) => a.id - b.id)
    let cumSum = 0
    for (const row of sorted) {
      cumSum += row.amount
      expect(row.cumulative_sum).toBe(cumSum)
    }
  })

  it('calculates future sum with CURRENT ROW to UNBOUNDED FOLLOWING', () => {
    const result = processor.process(salesData.slice(0, 4), {
      function: sumOver('amount'),
      orderBy: [{ column: 'id', direction: 'ASC' }],
      frame: {
        type: 'ROWS',
        start: { type: 'CURRENT ROW' },
        end: { type: 'UNBOUNDED FOLLOWING' },
      },
      alias: 'future_sum',
    })

    const sorted = result.sort((a, b) => a.id - b.id)
    const totalSum = sorted.reduce((sum, r) => sum + r.amount, 0)

    // Each row's future_sum = total - sum of preceding rows
    let precedingSum = 0
    for (const row of sorted) {
      expect(row.future_sum).toBe(totalSum - precedingSum)
      precedingSum += row.amount
    }
  })
})

describe('PARTITION BY with Running Aggregates', () => {
  let processor: WindowFunctionProcessor<SalesRecord>

  beforeEach(() => {
    processor = new WindowFunctionProcessor<SalesRecord>()
  })

  it('calculates partition-level running percentage', () => {
    const result = processor.process(salesData, {
      function: sumOver('amount'),
      partitionBy: ['region'],
      orderBy: [{ column: 'date', direction: 'ASC' }, { column: 'id', direction: 'ASC' }],
      frame: {
        type: 'ROWS',
        start: { type: 'UNBOUNDED PRECEDING' },
        end: { type: 'UNBOUNDED FOLLOWING' },
      },
      alias: 'partition_total',
    })

    // All rows in East should have the same partition total
    const eastRows = result.filter((r) => r.region === 'East')
    const eastTotal = eastRows[0]?.partition_total
    eastRows.forEach((r) => {
      expect(r.partition_total).toBe(eastTotal)
    })

    // Calculate expected East total: 100 + 150 + 200 + 130 = 580
    expect(eastTotal).toBe(580)

    // West total: 120 + 180 + 250 + 300 = 850
    const westRows = result.filter((r) => r.region === 'West')
    expect(westRows[0]?.partition_total).toBe(850)
  })
})

describe('Real-World Analytics Scenarios', () => {
  let processor: WindowFunctionProcessor<SalesRecord>

  beforeEach(() => {
    processor = new WindowFunctionProcessor<SalesRecord>()
  })

  it('calculates top N per group using ROW_NUMBER', () => {
    const result = processor.process(salesData, {
      function: rowNumber(),
      partitionBy: ['region'],
      orderBy: [{ column: 'amount', direction: 'DESC' }],
      alias: 'rank_in_region',
    })

    // Filter to top 2 per region
    const top2PerRegion = result.filter((r) => (r.rank_in_region as number) <= 2)

    const eastTop2 = top2PerRegion.filter((r) => r.region === 'East')
    const westTop2 = top2PerRegion.filter((r) => r.region === 'West')

    expect(eastTop2).toHaveLength(2)
    expect(westTop2).toHaveLength(2)

    // East top 2: 200 (Gadget), 150 (Widget)
    expect(eastTop2.map((r) => r.amount).sort((a, b) => b - a)).toEqual([200, 150])

    // West top 2: 300 (Gadget), 250 (Gadget)
    expect(westTop2.map((r) => r.amount).sort((a, b) => b - a)).toEqual([300, 250])
  })

  it('calculates year-over-year comparison using LAG', () => {
    // Simulating YoY data
    interface YearlyData {
      id: number
      region: string
      product: string
      year: number
      date: string
      amount: number
      quantity: number
    }

    const yearlyData: YearlyData[] = [
      { id: 1, region: 'East', product: 'Widget', year: 2022, date: '2022-01-01', amount: 1000, quantity: 10 },
      { id: 2, region: 'East', product: 'Widget', year: 2023, date: '2023-01-01', amount: 1200, quantity: 12 },
      { id: 3, region: 'East', product: 'Widget', year: 2024, date: '2024-01-01', amount: 1500, quantity: 15 },
      { id: 4, region: 'West', product: 'Widget', year: 2022, date: '2022-01-01', amount: 800, quantity: 8 },
      { id: 5, region: 'West', product: 'Widget', year: 2023, date: '2023-01-01', amount: 900, quantity: 9 },
      { id: 6, region: 'West', product: 'Widget', year: 2024, date: '2024-01-01', amount: 1100, quantity: 11 },
    ]

    const yearlyProcessor = new WindowFunctionProcessor<YearlyData>()

    const result = yearlyProcessor.process(yearlyData, {
      function: lag('amount', 1, 0),
      partitionBy: ['region', 'product'],
      orderBy: [{ column: 'year', direction: 'ASC' }],
      alias: 'prev_year_amount',
    })

    // East Widget 2023: prev should be 1000
    const east2023 = result.find((r) => r.region === 'East' && r.year === 2023)
    expect(east2023?.prev_year_amount).toBe(1000)

    // East Widget 2024: prev should be 1200
    const east2024 = result.find((r) => r.region === 'East' && r.year === 2024)
    expect(east2024?.prev_year_amount).toBe(1200)

    // Calculate YoY growth for 2024
    const yoyGrowth = ((east2024!.amount - (east2024!.prev_year_amount as number)) / (east2024!.prev_year_amount as number)) * 100
    expect(yoyGrowth).toBeCloseTo(25, 1) // 25% growth
  })

  it('calculates running percentage of total', () => {
    const data: SalesRecord[] = [
      { id: 1, region: 'East', product: 'A', date: '2024-01-01', amount: 100, quantity: 1 },
      { id: 2, region: 'East', product: 'B', date: '2024-01-02', amount: 200, quantity: 2 },
      { id: 3, region: 'East', product: 'C', date: '2024-01-03', amount: 300, quantity: 3 },
      { id: 4, region: 'East', product: 'D', date: '2024-01-04', amount: 400, quantity: 4 },
    ]

    // First get running sum
    const withRunningSum = processor.process(data, {
      function: sumOver('amount'),
      orderBy: [{ column: 'id', direction: 'ASC' }],
      alias: 'running_sum',
    })

    // Then get total
    const withTotal = processor.process(withRunningSum as SalesRecord[], {
      function: sumOver('amount'),
      orderBy: [{ column: 'id', direction: 'ASC' }],
      frame: {
        type: 'ROWS',
        start: { type: 'UNBOUNDED PRECEDING' },
        end: { type: 'UNBOUNDED FOLLOWING' },
      },
      alias: 'total',
    })

    // Calculate percentages
    const sorted = withTotal.sort((a, b) => a.id - b.id)
    const pctOfTotal = sorted.map((r) => ((r.running_sum as number) / (r.total as number)) * 100)

    expect(pctOfTotal[0]).toBeCloseTo(10, 1)   // 100/1000 = 10%
    expect(pctOfTotal[1]).toBeCloseTo(30, 1)   // 300/1000 = 30%
    expect(pctOfTotal[2]).toBeCloseTo(60, 1)   // 600/1000 = 60%
    expect(pctOfTotal[3]).toBeCloseTo(100, 1)  // 1000/1000 = 100%
  })

  it('identifies gaps in sequences using LAG', () => {
    interface SequenceData {
      id: number
      region: string
      product: string
      date: string
      sequence_num: number
      amount: number
      quantity: number
    }

    const sequenceData: SequenceData[] = [
      { id: 1, region: 'A', product: 'X', date: '2024-01-01', sequence_num: 1, amount: 100, quantity: 1 },
      { id: 2, region: 'A', product: 'X', date: '2024-01-02', sequence_num: 2, amount: 100, quantity: 1 },
      { id: 3, region: 'A', product: 'X', date: '2024-01-03', sequence_num: 5, amount: 100, quantity: 1 }, // Gap!
      { id: 4, region: 'A', product: 'X', date: '2024-01-04', sequence_num: 6, amount: 100, quantity: 1 },
    ]

    const seqProcessor = new WindowFunctionProcessor<SequenceData>()

    const result = seqProcessor.process(sequenceData, {
      function: lag('sequence_num', 1, 0),
      partitionBy: ['region'],
      orderBy: [{ column: 'sequence_num', direction: 'ASC' }],
      alias: 'prev_seq',
    })

    // Find gaps (where current - prev > 1)
    const gaps = result.filter((r) => r.sequence_num - (r.prev_seq as number) > 1)

    expect(gaps).toHaveLength(1)
    expect(gaps[0]?.sequence_num).toBe(5)
    expect(gaps[0]?.prev_seq).toBe(2)
  })
})

describe('NTILE Advanced Scenarios', () => {
  let processor: WindowFunctionProcessor<SalesRecord>

  beforeEach(() => {
    processor = new WindowFunctionProcessor<SalesRecord>()
  })

  it('handles uneven distribution (7 rows into 3 buckets)', () => {
    const data: SalesRecord[] = Array.from({ length: 7 }, (_, i) => ({
      id: i + 1,
      region: 'East',
      product: 'A',
      date: '2024-01-01',
      amount: (i + 1) * 100,
      quantity: 1,
    }))

    const result = processor.process(data, {
      function: ntile(3),
      orderBy: [{ column: 'id', direction: 'ASC' }],
      alias: 'bucket',
    })

    const sorted = result.sort((a, b) => a.id - b.id)
    const buckets = sorted.map((r) => r.bucket)

    // 7 rows into 3 buckets: 3, 2, 2 distribution
    expect(buckets.filter((b) => b === 1)).toHaveLength(3)
    expect(buckets.filter((b) => b === 2)).toHaveLength(2)
    expect(buckets.filter((b) => b === 3)).toHaveLength(2)
  })

  it('calculates quartiles (NTILE 4)', () => {
    const data: SalesRecord[] = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      region: 'East',
      product: 'A',
      date: '2024-01-01',
      amount: Math.random() * 1000,
      quantity: 1,
    }))

    const result = processor.process(data, {
      function: ntile(4),
      orderBy: [{ column: 'amount', direction: 'ASC' }],
      alias: 'quartile',
    })

    // Each quartile should have 25 rows
    expect(result.filter((r) => r.quartile === 1)).toHaveLength(25)
    expect(result.filter((r) => r.quartile === 2)).toHaveLength(25)
    expect(result.filter((r) => r.quartile === 3)).toHaveLength(25)
    expect(result.filter((r) => r.quartile === 4)).toHaveLength(25)
  })

  it('calculates deciles (NTILE 10)', () => {
    const data: SalesRecord[] = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      region: 'East',
      product: 'A',
      date: '2024-01-01',
      amount: i + 1,
      quantity: 1,
    }))

    const result = processor.process(data, {
      function: ntile(10),
      orderBy: [{ column: 'amount', direction: 'ASC' }],
      alias: 'decile',
    })

    // Each decile should have 10 rows
    for (let d = 1; d <= 10; d++) {
      expect(result.filter((r) => r.decile === d)).toHaveLength(10)
    }

    // First decile should contain amounts 1-10
    const firstDecile = result.filter((r) => r.decile === 1)
    expect(Math.max(...firstDecile.map((r) => r.amount))).toBe(10)
  })
})

describe('PERCENT_RANK and CUME_DIST Edge Cases', () => {
  let processor: WindowFunctionProcessor<SalesRecord>

  beforeEach(() => {
    processor = new WindowFunctionProcessor<SalesRecord>()
  })

  it('PERCENT_RANK with all ties', () => {
    const data: SalesRecord[] = [
      { id: 1, region: 'East', product: 'A', date: '2024-01-01', amount: 100, quantity: 1 },
      { id: 2, region: 'East', product: 'B', date: '2024-01-01', amount: 100, quantity: 2 },
      { id: 3, region: 'East', product: 'C', date: '2024-01-01', amount: 100, quantity: 3 },
    ]

    const result = processor.process(data, {
      function: percentRank(),
      orderBy: [{ column: 'amount', direction: 'ASC' }],
      alias: 'pct_rank',
    })

    // All rows have same value, all should have percent_rank = 0
    result.forEach((r) => {
      expect(r.pct_rank).toBe(0)
    })
  })

  it('CUME_DIST with all ties', () => {
    const data: SalesRecord[] = [
      { id: 1, region: 'East', product: 'A', date: '2024-01-01', amount: 100, quantity: 1 },
      { id: 2, region: 'East', product: 'B', date: '2024-01-01', amount: 100, quantity: 2 },
      { id: 3, region: 'East', product: 'C', date: '2024-01-01', amount: 100, quantity: 3 },
    ]

    const result = processor.process(data, {
      function: cumeDist(),
      orderBy: [{ column: 'amount', direction: 'ASC' }],
      alias: 'cume_dist',
    })

    // All rows have same value, all should have cume_dist = 1 (100% <= this value)
    result.forEach((r) => {
      expect(r.cume_dist).toBe(1)
    })
  })

  it('PERCENT_RANK with distinct values', () => {
    const data: SalesRecord[] = [
      { id: 1, region: 'East', product: 'A', date: '2024-01-01', amount: 100, quantity: 1 },
      { id: 2, region: 'East', product: 'B', date: '2024-01-01', amount: 200, quantity: 2 },
      { id: 3, region: 'East', product: 'C', date: '2024-01-01', amount: 300, quantity: 3 },
      { id: 4, region: 'East', product: 'D', date: '2024-01-01', amount: 400, quantity: 4 },
      { id: 5, region: 'East', product: 'E', date: '2024-01-01', amount: 500, quantity: 5 },
    ]

    const result = processor.process(data, {
      function: percentRank(),
      orderBy: [{ column: 'amount', direction: 'ASC' }],
      alias: 'pct_rank',
    })

    const sorted = result.sort((a, b) => a.amount - b.amount)

    // percent_rank = (rank - 1) / (n - 1)
    expect(sorted[0]?.pct_rank).toBe(0)      // (1-1)/(5-1) = 0
    expect(sorted[1]?.pct_rank).toBe(0.25)   // (2-1)/(5-1) = 0.25
    expect(sorted[2]?.pct_rank).toBe(0.5)    // (3-1)/(5-1) = 0.5
    expect(sorted[3]?.pct_rank).toBe(0.75)   // (4-1)/(5-1) = 0.75
    expect(sorted[4]?.pct_rank).toBe(1)      // (5-1)/(5-1) = 1
  })

  it('CUME_DIST with distinct values', () => {
    const data: SalesRecord[] = [
      { id: 1, region: 'East', product: 'A', date: '2024-01-01', amount: 100, quantity: 1 },
      { id: 2, region: 'East', product: 'B', date: '2024-01-01', amount: 200, quantity: 2 },
      { id: 3, region: 'East', product: 'C', date: '2024-01-01', amount: 300, quantity: 3 },
      { id: 4, region: 'East', product: 'D', date: '2024-01-01', amount: 400, quantity: 4 },
      { id: 5, region: 'East', product: 'E', date: '2024-01-01', amount: 500, quantity: 5 },
    ]

    const result = processor.process(data, {
      function: cumeDist(),
      orderBy: [{ column: 'amount', direction: 'ASC' }],
      alias: 'cume_dist',
    })

    const sorted = result.sort((a, b) => a.amount - b.amount)

    // cume_dist = (number of rows <= current) / n
    expect(sorted[0]?.cume_dist).toBe(0.2)   // 1/5 = 0.2
    expect(sorted[1]?.cume_dist).toBe(0.4)   // 2/5 = 0.4
    expect(sorted[2]?.cume_dist).toBe(0.6)   // 3/5 = 0.6
    expect(sorted[3]?.cume_dist).toBe(0.8)   // 4/5 = 0.8
    expect(sorted[4]?.cume_dist).toBe(1)     // 5/5 = 1
  })
})

describe('FIRST_VALUE and LAST_VALUE with Various Frames', () => {
  let processor: WindowFunctionProcessor<SalesRecord>

  beforeEach(() => {
    processor = new WindowFunctionProcessor<SalesRecord>()
  })

  it('FIRST_VALUE with sliding window', () => {
    const data: SalesRecord[] = [
      { id: 1, region: 'East', product: 'A', date: '2024-01-01', amount: 100, quantity: 1 },
      { id: 2, region: 'East', product: 'B', date: '2024-01-02', amount: 200, quantity: 2 },
      { id: 3, region: 'East', product: 'C', date: '2024-01-03', amount: 300, quantity: 3 },
      { id: 4, region: 'East', product: 'D', date: '2024-01-04', amount: 400, quantity: 4 },
    ]

    const result = processor.process(data, {
      function: firstValue('amount'),
      orderBy: [{ column: 'id', direction: 'ASC' }],
      frame: {
        type: 'ROWS',
        start: { type: 'PRECEDING', offset: 1 },
        end: { type: 'FOLLOWING', offset: 1 },
      },
      alias: 'first_in_window',
    })

    const sorted = result.sort((a, b) => a.id - b.id)

    // Row 1: window is [100, 200], first = 100
    expect(sorted[0]?.first_in_window).toBe(100)
    // Row 2: window is [100, 200, 300], first = 100
    expect(sorted[1]?.first_in_window).toBe(100)
    // Row 3: window is [200, 300, 400], first = 200
    expect(sorted[2]?.first_in_window).toBe(200)
    // Row 4: window is [300, 400], first = 300
    expect(sorted[3]?.first_in_window).toBe(300)
  })

  it('LAST_VALUE with sliding window', () => {
    const data: SalesRecord[] = [
      { id: 1, region: 'East', product: 'A', date: '2024-01-01', amount: 100, quantity: 1 },
      { id: 2, region: 'East', product: 'B', date: '2024-01-02', amount: 200, quantity: 2 },
      { id: 3, region: 'East', product: 'C', date: '2024-01-03', amount: 300, quantity: 3 },
      { id: 4, region: 'East', product: 'D', date: '2024-01-04', amount: 400, quantity: 4 },
    ]

    const result = processor.process(data, {
      function: lastValue('amount'),
      orderBy: [{ column: 'id', direction: 'ASC' }],
      frame: {
        type: 'ROWS',
        start: { type: 'PRECEDING', offset: 1 },
        end: { type: 'FOLLOWING', offset: 1 },
      },
      alias: 'last_in_window',
    })

    const sorted = result.sort((a, b) => a.id - b.id)

    // Row 1: window is [100, 200], last = 200
    expect(sorted[0]?.last_in_window).toBe(200)
    // Row 2: window is [100, 200, 300], last = 300
    expect(sorted[1]?.last_in_window).toBe(300)
    // Row 3: window is [200, 300, 400], last = 400
    expect(sorted[2]?.last_in_window).toBe(400)
    // Row 4: window is [300, 400], last = 400
    expect(sorted[3]?.last_in_window).toBe(400)
  })
})

describe('MIN/MAX OVER Edge Cases', () => {
  let processor: WindowFunctionProcessor<SalesRecord>

  beforeEach(() => {
    processor = new WindowFunctionProcessor<SalesRecord>()
  })

  it('running MIN monotonically decreases or stays same', () => {
    const data: SalesRecord[] = [
      { id: 1, region: 'East', product: 'A', date: '2024-01-01', amount: 300, quantity: 1 },
      { id: 2, region: 'East', product: 'A', date: '2024-01-02', amount: 200, quantity: 2 },
      { id: 3, region: 'East', product: 'A', date: '2024-01-03', amount: 400, quantity: 3 },
      { id: 4, region: 'East', product: 'A', date: '2024-01-04', amount: 100, quantity: 4 },
      { id: 5, region: 'East', product: 'A', date: '2024-01-05', amount: 500, quantity: 5 },
    ]

    const result = processor.process(data, {
      function: minOver('amount'),
      orderBy: [{ column: 'id', direction: 'ASC' }],
      alias: 'running_min',
    })

    const sorted = result.sort((a, b) => a.id - b.id)

    expect(sorted[0]?.running_min).toBe(300)  // min(300) = 300
    expect(sorted[1]?.running_min).toBe(200)  // min(300, 200) = 200
    expect(sorted[2]?.running_min).toBe(200)  // min(300, 200, 400) = 200
    expect(sorted[3]?.running_min).toBe(100)  // min(300, 200, 400, 100) = 100
    expect(sorted[4]?.running_min).toBe(100)  // min(300, 200, 400, 100, 500) = 100
  })

  it('running MAX monotonically increases or stays same', () => {
    const data: SalesRecord[] = [
      { id: 1, region: 'East', product: 'A', date: '2024-01-01', amount: 100, quantity: 1 },
      { id: 2, region: 'East', product: 'A', date: '2024-01-02', amount: 300, quantity: 2 },
      { id: 3, region: 'East', product: 'A', date: '2024-01-03', amount: 200, quantity: 3 },
      { id: 4, region: 'East', product: 'A', date: '2024-01-04', amount: 500, quantity: 4 },
      { id: 5, region: 'East', product: 'A', date: '2024-01-05', amount: 400, quantity: 5 },
    ]

    const result = processor.process(data, {
      function: maxOver('amount'),
      orderBy: [{ column: 'id', direction: 'ASC' }],
      alias: 'running_max',
    })

    const sorted = result.sort((a, b) => a.id - b.id)

    expect(sorted[0]?.running_max).toBe(100)  // max(100) = 100
    expect(sorted[1]?.running_max).toBe(300)  // max(100, 300) = 300
    expect(sorted[2]?.running_max).toBe(300)  // max(100, 300, 200) = 300
    expect(sorted[3]?.running_max).toBe(500)  // max(100, 300, 200, 500) = 500
    expect(sorted[4]?.running_max).toBe(500)  // max(100, 300, 200, 500, 400) = 500
  })

  it('MIN/MAX with sliding window', () => {
    const data: SalesRecord[] = [
      { id: 1, region: 'East', product: 'A', date: '2024-01-01', amount: 100, quantity: 1 },
      { id: 2, region: 'East', product: 'A', date: '2024-01-02', amount: 500, quantity: 2 },
      { id: 3, region: 'East', product: 'A', date: '2024-01-03', amount: 200, quantity: 3 },
      { id: 4, region: 'East', product: 'A', date: '2024-01-04', amount: 400, quantity: 4 },
      { id: 5, region: 'East', product: 'A', date: '2024-01-05', amount: 300, quantity: 5 },
    ]

    const minResult = processor.process(data, {
      function: minOver('amount'),
      orderBy: [{ column: 'id', direction: 'ASC' }],
      frame: {
        type: 'ROWS',
        start: { type: 'PRECEDING', offset: 1 },
        end: { type: 'FOLLOWING', offset: 1 },
      },
      alias: 'sliding_min',
    })

    const sorted = minResult.sort((a, b) => a.id - b.id)

    // Row 1: [100, 500] -> min = 100
    expect(sorted[0]?.sliding_min).toBe(100)
    // Row 2: [100, 500, 200] -> min = 100
    expect(sorted[1]?.sliding_min).toBe(100)
    // Row 3: [500, 200, 400] -> min = 200
    expect(sorted[2]?.sliding_min).toBe(200)
    // Row 4: [200, 400, 300] -> min = 200
    expect(sorted[3]?.sliding_min).toBe(200)
    // Row 5: [400, 300] -> min = 300
    expect(sorted[4]?.sliding_min).toBe(300)
  })
})
