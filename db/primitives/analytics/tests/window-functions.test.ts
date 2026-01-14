/**
 * Window Functions Tests - SQL OVER() Clause Support
 *
 * Tests for SQL-style window functions:
 * - ROW_NUMBER(), RANK(), DENSE_RANK()
 * - LAG(), LEAD()
 * - FIRST_VALUE(), LAST_VALUE()
 * - SUM/AVG/COUNT OVER (PARTITION BY ... ORDER BY ... ROWS/RANGE BETWEEN)
 *
 * @see dotdo-xj5xw
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  // Window function executor
  executeWindowFunctions,
  WindowFunctionExecutor,

  // Ranking functions
  rowNumber,
  rank,
  denseRank,
  ntile,

  // Offset functions
  lag,
  lead,
  firstValue,
  lastValue,
  nthValue,

  // Aggregate window functions
  sumOver,
  avgOver,
  countOver,
  minOver,
  maxOver,

  // Window frame helpers
  unboundedPreceding,
  unboundedFollowing,
  currentRow,
  preceding,
  following,
  rowsFrame,
  rangeFrame,

  // Window specification builder
  over,
  partitionBy,
  orderBy,

  // Types
  type WindowSpec,
  type WindowFrame,
  type FrameBound,
  type WindowFunctionSpec,
  type WindowResult,
} from '../window-functions'

// ============================================================================
// Test Fixtures
// ============================================================================

interface SalesRecord {
  id: number
  region: string
  salesperson: string
  amount: number
  date: string
  quantity: number
}

interface EmployeeRecord {
  id: number
  department: string
  name: string
  salary: number
  hire_date: string
}

function createSalesData(): SalesRecord[] {
  return [
    { id: 1, region: 'East', salesperson: 'Alice', amount: 1000, date: '2024-01-01', quantity: 10 },
    { id: 2, region: 'East', salesperson: 'Bob', amount: 1500, date: '2024-01-02', quantity: 15 },
    { id: 3, region: 'East', salesperson: 'Alice', amount: 1200, date: '2024-01-03', quantity: 12 },
    { id: 4, region: 'West', salesperson: 'Carol', amount: 2000, date: '2024-01-01', quantity: 20 },
    { id: 5, region: 'West', salesperson: 'David', amount: 1800, date: '2024-01-02', quantity: 18 },
    { id: 6, region: 'West', salesperson: 'Carol', amount: 2200, date: '2024-01-03', quantity: 22 },
    { id: 7, region: 'North', salesperson: 'Eve', amount: 900, date: '2024-01-01', quantity: 9 },
    { id: 8, region: 'North', salesperson: 'Frank', amount: 1100, date: '2024-01-02', quantity: 11 },
  ]
}

function createEmployeeData(): EmployeeRecord[] {
  return [
    { id: 1, department: 'Engineering', name: 'Alice', salary: 100000, hire_date: '2020-01-15' },
    { id: 2, department: 'Engineering', name: 'Bob', salary: 100000, hire_date: '2021-03-20' },
    { id: 3, department: 'Engineering', name: 'Carol', salary: 120000, hire_date: '2019-06-10' },
    { id: 4, department: 'Sales', name: 'David', salary: 80000, hire_date: '2022-01-05' },
    { id: 5, department: 'Sales', name: 'Eve', salary: 85000, hire_date: '2021-08-15' },
    { id: 6, department: 'Sales', name: 'Frank', salary: 85000, hire_date: '2020-11-01' },
    { id: 7, department: 'HR', name: 'Grace', salary: 70000, hire_date: '2023-02-28' },
  ]
}

// ============================================================================
// ROW_NUMBER() Tests
// ============================================================================

describe('ROW_NUMBER()', () => {
  it('should assign sequential numbers without partition', () => {
    const data = createSalesData()

    const result = executeWindowFunctions(
      data,
      [{ fn: rowNumber(), as: 'row_num' }],
      over(orderBy('amount', 'asc'))
    )

    expect(result).toHaveLength(8)

    // Sorted by amount ascending: 900, 1000, 1100, 1200, 1500, 1800, 2000, 2200
    expect(result[0]!.row_num).toBe(1)
    expect(result[0]!.amount).toBe(900)
    expect(result[7]!.row_num).toBe(8)
    expect(result[7]!.amount).toBe(2200)
  })

  it('should restart numbering for each partition', () => {
    const data = createSalesData()

    const result = executeWindowFunctions(
      data,
      [{ fn: rowNumber(), as: 'row_num' }],
      over(partitionBy('region'), orderBy('amount', 'asc'))
    )

    // East partition: 1000, 1200, 1500 -> row_num 1, 2, 3
    const eastRows = result.filter((r) => r.region === 'East')
    expect(eastRows).toHaveLength(3)
    expect(eastRows.find((r) => r.amount === 1000)!.row_num).toBe(1)
    expect(eastRows.find((r) => r.amount === 1200)!.row_num).toBe(2)
    expect(eastRows.find((r) => r.amount === 1500)!.row_num).toBe(3)

    // West partition: 1800, 2000, 2200 -> row_num 1, 2, 3
    const westRows = result.filter((r) => r.region === 'West')
    expect(westRows.find((r) => r.amount === 1800)!.row_num).toBe(1)
    expect(westRows.find((r) => r.amount === 2000)!.row_num).toBe(2)
    expect(westRows.find((r) => r.amount === 2200)!.row_num).toBe(3)
  })

  it('should handle multiple partition columns', () => {
    const data = createSalesData()

    const result = executeWindowFunctions(
      data,
      [{ fn: rowNumber(), as: 'row_num' }],
      over(partitionBy('region', 'salesperson'), orderBy('date', 'asc'))
    )

    // East/Alice has 2 records
    const aliceEast = result.filter((r) => r.region === 'East' && r.salesperson === 'Alice')
    expect(aliceEast).toHaveLength(2)
    expect(aliceEast[0]!.row_num).toBe(1)
    expect(aliceEast[1]!.row_num).toBe(2)
  })
})

// ============================================================================
// RANK() Tests
// ============================================================================

describe('RANK()', () => {
  it('should assign same rank to ties and skip ranks', () => {
    const data = createEmployeeData()

    const result = executeWindowFunctions(
      data,
      [{ fn: rank(), as: 'salary_rank' }],
      over(partitionBy('department'), orderBy('salary', 'desc'))
    )

    // Engineering: Carol (120k) rank 1, Alice & Bob (100k each) rank 2, 2
    const engineering = result.filter((r) => r.department === 'Engineering')
    expect(engineering.find((r) => r.name === 'Carol')!.salary_rank).toBe(1)
    expect(engineering.find((r) => r.name === 'Alice')!.salary_rank).toBe(2)
    expect(engineering.find((r) => r.name === 'Bob')!.salary_rank).toBe(2)

    // Sales: Eve & Frank (85k) rank 1, 1; David (80k) rank 3 (skipped 2)
    const sales = result.filter((r) => r.department === 'Sales')
    expect(sales.find((r) => r.name === 'Eve')!.salary_rank).toBe(1)
    expect(sales.find((r) => r.name === 'Frank')!.salary_rank).toBe(1)
    expect(sales.find((r) => r.name === 'David')!.salary_rank).toBe(3) // Skips 2
  })

  it('should work without partition (global ranking)', () => {
    const data = createEmployeeData()

    const result = executeWindowFunctions(
      data,
      [{ fn: rank(), as: 'global_rank' }],
      over(orderBy('salary', 'desc'))
    )

    // Carol (120k) -> 1, Alice/Bob (100k) -> 2, Eve/Frank (85k) -> 4, David (80k) -> 6, Grace (70k) -> 7
    expect(result.find((r) => r.name === 'Carol')!.global_rank).toBe(1)
    expect(result.find((r) => r.name === 'Alice')!.global_rank).toBe(2)
    expect(result.find((r) => r.name === 'Bob')!.global_rank).toBe(2)
    expect(result.find((r) => r.name === 'Eve')!.global_rank).toBe(4)
    expect(result.find((r) => r.name === 'Grace')!.global_rank).toBe(7)
  })
})

// ============================================================================
// DENSE_RANK() Tests
// ============================================================================

describe('DENSE_RANK()', () => {
  it('should assign same rank to ties without skipping ranks', () => {
    const data = createEmployeeData()

    const result = executeWindowFunctions(
      data,
      [{ fn: denseRank(), as: 'dense_salary_rank' }],
      over(partitionBy('department'), orderBy('salary', 'desc'))
    )

    // Sales: Eve & Frank (85k) rank 1, 1; David (80k) rank 2 (no skip)
    const sales = result.filter((r) => r.department === 'Sales')
    expect(sales.find((r) => r.name === 'Eve')!.dense_salary_rank).toBe(1)
    expect(sales.find((r) => r.name === 'Frank')!.dense_salary_rank).toBe(1)
    expect(sales.find((r) => r.name === 'David')!.dense_salary_rank).toBe(2) // No skip!
  })

  it('should work without partition (global dense ranking)', () => {
    const data = createEmployeeData()

    const result = executeWindowFunctions(
      data,
      [{ fn: denseRank(), as: 'dense_rank' }],
      over(orderBy('salary', 'desc'))
    )

    // Carol (120k) -> 1, Alice/Bob (100k) -> 2, Eve/Frank (85k) -> 3, David (80k) -> 4, Grace (70k) -> 5
    expect(result.find((r) => r.name === 'Carol')!.dense_rank).toBe(1)
    expect(result.find((r) => r.name === 'Alice')!.dense_rank).toBe(2)
    expect(result.find((r) => r.name === 'Eve')!.dense_rank).toBe(3)
    expect(result.find((r) => r.name === 'David')!.dense_rank).toBe(4)
    expect(result.find((r) => r.name === 'Grace')!.dense_rank).toBe(5)
  })
})

// ============================================================================
// NTILE() Tests
// ============================================================================

describe('NTILE()', () => {
  it('should divide rows into n buckets', () => {
    const data = createSalesData()

    const result = executeWindowFunctions(
      data,
      [{ fn: ntile(4), as: 'quartile' }],
      over(orderBy('amount', 'asc'))
    )

    // 8 rows divided into 4 buckets: 2 rows each
    expect(result).toHaveLength(8)

    const bucket1 = result.filter((r) => r.quartile === 1)
    const bucket2 = result.filter((r) => r.quartile === 2)
    const bucket3 = result.filter((r) => r.quartile === 3)
    const bucket4 = result.filter((r) => r.quartile === 4)

    expect(bucket1).toHaveLength(2)
    expect(bucket2).toHaveLength(2)
    expect(bucket3).toHaveLength(2)
    expect(bucket4).toHaveLength(2)
  })

  it('should handle uneven distribution', () => {
    const data = createEmployeeData() // 7 rows

    const result = executeWindowFunctions(
      data,
      [{ fn: ntile(3), as: 'tercile' }],
      over(orderBy('salary', 'desc'))
    )

    // 7 rows into 3 buckets: 3, 2, 2
    const tercile1 = result.filter((r) => r.tercile === 1)
    const tercile2 = result.filter((r) => r.tercile === 2)
    const tercile3 = result.filter((r) => r.tercile === 3)

    expect(tercile1.length + tercile2.length + tercile3.length).toBe(7)
    expect(tercile1.length).toBeGreaterThanOrEqual(2)
  })
})

// ============================================================================
// LAG() Tests
// ============================================================================

describe('LAG()', () => {
  it('should return value from previous row', () => {
    const data = createSalesData()

    const result = executeWindowFunctions(
      data,
      [{ fn: lag('amount'), as: 'prev_amount' }],
      over(partitionBy('region'), orderBy('date', 'asc'))
    )

    // First row of each partition has null prev_amount
    const eastRows = result
      .filter((r) => r.region === 'East')
      .sort((a, b) => a.date.localeCompare(b.date))

    expect(eastRows[0]!.prev_amount).toBeNull()
    expect(eastRows[1]!.prev_amount).toBe(eastRows[0]!.amount)
    expect(eastRows[2]!.prev_amount).toBe(eastRows[1]!.amount)
  })

  it('should respect offset parameter', () => {
    const data = createSalesData()

    const result = executeWindowFunctions(
      data,
      [{ fn: lag('amount', 2), as: 'prev_2_amount' }],
      over(partitionBy('region'), orderBy('date', 'asc'))
    )

    const eastRows = result
      .filter((r) => r.region === 'East')
      .sort((a, b) => a.date.localeCompare(b.date))

    expect(eastRows[0]!.prev_2_amount).toBeNull()
    expect(eastRows[1]!.prev_2_amount).toBeNull()
    expect(eastRows[2]!.prev_2_amount).toBe(eastRows[0]!.amount)
  })

  it('should use default value when no previous row exists', () => {
    const data = createSalesData()

    const result = executeWindowFunctions(
      data,
      [{ fn: lag('amount', 1, 0), as: 'prev_amount' }],
      over(partitionBy('region'), orderBy('date', 'asc'))
    )

    const eastRows = result
      .filter((r) => r.region === 'East')
      .sort((a, b) => a.date.localeCompare(b.date))

    expect(eastRows[0]!.prev_amount).toBe(0) // Default value instead of null
  })
})

// ============================================================================
// LEAD() Tests
// ============================================================================

describe('LEAD()', () => {
  it('should return value from next row', () => {
    const data = createSalesData()

    const result = executeWindowFunctions(
      data,
      [{ fn: lead('amount'), as: 'next_amount' }],
      over(partitionBy('region'), orderBy('date', 'asc'))
    )

    const eastRows = result
      .filter((r) => r.region === 'East')
      .sort((a, b) => a.date.localeCompare(b.date))

    // Last row of partition has null next_amount
    expect(eastRows[0]!.next_amount).toBe(eastRows[1]!.amount)
    expect(eastRows[1]!.next_amount).toBe(eastRows[2]!.amount)
    expect(eastRows[2]!.next_amount).toBeNull()
  })

  it('should respect offset parameter', () => {
    const data = createSalesData()

    const result = executeWindowFunctions(
      data,
      [{ fn: lead('amount', 2), as: 'next_2_amount' }],
      over(partitionBy('region'), orderBy('date', 'asc'))
    )

    const eastRows = result
      .filter((r) => r.region === 'East')
      .sort((a, b) => a.date.localeCompare(b.date))

    expect(eastRows[0]!.next_2_amount).toBe(eastRows[2]!.amount)
    expect(eastRows[1]!.next_2_amount).toBeNull()
    expect(eastRows[2]!.next_2_amount).toBeNull()
  })

  it('should use default value when no next row exists', () => {
    const data = createSalesData()

    const result = executeWindowFunctions(
      data,
      [{ fn: lead('amount', 1, -1), as: 'next_amount' }],
      over(partitionBy('region'), orderBy('date', 'asc'))
    )

    const eastRows = result
      .filter((r) => r.region === 'East')
      .sort((a, b) => a.date.localeCompare(b.date))

    expect(eastRows[2]!.next_amount).toBe(-1) // Default value instead of null
  })
})

// ============================================================================
// FIRST_VALUE() / LAST_VALUE() Tests
// ============================================================================

describe('FIRST_VALUE()', () => {
  it('should return first value in partition', () => {
    const data = createSalesData()

    const result = executeWindowFunctions(
      data,
      [{ fn: firstValue('amount'), as: 'first_amount' }],
      over(partitionBy('region'), orderBy('date', 'asc'))
    )

    // All rows in each partition should have the same first_amount
    const eastRows = result.filter((r) => r.region === 'East')
    const firstEastAmount = eastRows.find((r) => r.date === '2024-01-01')!.amount

    eastRows.forEach((r) => {
      expect(r.first_amount).toBe(firstEastAmount)
    })
  })
})

describe('LAST_VALUE()', () => {
  it('should return last value with default frame', () => {
    const data = createSalesData()

    // Default frame: RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    // So last_value changes per row
    const result = executeWindowFunctions(
      data,
      [{ fn: lastValue('amount'), as: 'last_amount' }],
      over(
        partitionBy('region'),
        orderBy('date', 'asc'),
        rowsFrame(unboundedPreceding(), currentRow())
      )
    )

    const eastRows = result
      .filter((r) => r.region === 'East')
      .sort((a, b) => a.date.localeCompare(b.date))

    // With ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    expect(eastRows[0]!.last_amount).toBe(eastRows[0]!.amount)
    expect(eastRows[1]!.last_amount).toBe(eastRows[1]!.amount)
    expect(eastRows[2]!.last_amount).toBe(eastRows[2]!.amount)
  })

  it('should return partition last value with unbounded frame', () => {
    const data = createSalesData()

    const result = executeWindowFunctions(
      data,
      [{ fn: lastValue('amount'), as: 'last_amount' }],
      over(
        partitionBy('region'),
        orderBy('date', 'asc'),
        rowsFrame(unboundedPreceding(), unboundedFollowing())
      )
    )

    const eastRows = result.filter((r) => r.region === 'East')
    const lastEastRow = eastRows.sort((a, b) => a.date.localeCompare(b.date)).at(-1)

    eastRows.forEach((r) => {
      expect(r.last_amount).toBe(lastEastRow!.amount)
    })
  })
})

// ============================================================================
// NTH_VALUE() Tests
// ============================================================================

describe('NTH_VALUE()', () => {
  it('should return nth value in window', () => {
    const data = createSalesData()

    const result = executeWindowFunctions(
      data,
      [{ fn: nthValue('amount', 2), as: 'second_amount' }],
      over(
        partitionBy('region'),
        orderBy('date', 'asc'),
        rowsFrame(unboundedPreceding(), unboundedFollowing())
      )
    )

    const eastRows = result.filter((r) => r.region === 'East')
    const sortedEast = [...eastRows].sort((a, b) => a.date.localeCompare(b.date))
    const secondAmount = sortedEast[1]!.amount

    eastRows.forEach((r) => {
      expect(r.second_amount).toBe(secondAmount)
    })
  })

  it('should return null when nth row does not exist', () => {
    const data = createSalesData().filter((r) => r.region === 'North') // Only 2 rows

    const result = executeWindowFunctions(
      data,
      [{ fn: nthValue('amount', 5), as: 'fifth_amount' }],
      over(orderBy('date', 'asc'), rowsFrame(unboundedPreceding(), unboundedFollowing()))
    )

    result.forEach((r) => {
      expect(r.fifth_amount).toBeNull()
    })
  })
})

// ============================================================================
// Aggregate Window Functions Tests
// ============================================================================

describe('SUM() OVER', () => {
  it('should compute running sum with default frame', () => {
    const data = createSalesData()

    const result = executeWindowFunctions(
      data,
      [{ fn: sumOver('amount'), as: 'running_total' }],
      over(partitionBy('region'), orderBy('date', 'asc'))
    )

    const eastRows = result
      .filter((r) => r.region === 'East')
      .sort((a, b) => a.date.localeCompare(b.date))

    // Running total: 1000, 2500, 3700
    expect(eastRows[0]!.running_total).toBe(1000)
    expect(eastRows[1]!.running_total).toBe(1000 + 1500)
    expect(eastRows[2]!.running_total).toBe(1000 + 1500 + 1200)
  })

  it('should compute total with unbounded frame', () => {
    const data = createSalesData()

    const result = executeWindowFunctions(
      data,
      [{ fn: sumOver('amount'), as: 'partition_total' }],
      over(
        partitionBy('region'),
        orderBy('date', 'asc'),
        rowsFrame(unboundedPreceding(), unboundedFollowing())
      )
    )

    const eastRows = result.filter((r) => r.region === 'East')
    const eastTotal = 1000 + 1500 + 1200

    eastRows.forEach((r) => {
      expect(r.partition_total).toBe(eastTotal)
    })
  })

  it('should compute moving sum with fixed frame', () => {
    const data = createSalesData()

    // 2-day moving sum
    const result = executeWindowFunctions(
      data,
      [{ fn: sumOver('amount'), as: 'moving_sum' }],
      over(
        partitionBy('region'),
        orderBy('date', 'asc'),
        rowsFrame(preceding(1), currentRow())
      )
    )

    const eastRows = result
      .filter((r) => r.region === 'East')
      .sort((a, b) => a.date.localeCompare(b.date))

    // Row 0: just itself = 1000
    // Row 1: prev + current = 1000 + 1500 = 2500
    // Row 2: prev + current = 1500 + 1200 = 2700
    expect(eastRows[0]!.moving_sum).toBe(1000)
    expect(eastRows[1]!.moving_sum).toBe(2500)
    expect(eastRows[2]!.moving_sum).toBe(2700)
  })
})

describe('AVG() OVER', () => {
  it('should compute running average', () => {
    const data = createSalesData()

    const result = executeWindowFunctions(
      data,
      [{ fn: avgOver('amount'), as: 'running_avg' }],
      over(partitionBy('region'), orderBy('date', 'asc'))
    )

    const eastRows = result
      .filter((r) => r.region === 'East')
      .sort((a, b) => a.date.localeCompare(b.date))

    expect(eastRows[0]!.running_avg).toBe(1000)
    expect(eastRows[1]!.running_avg).toBe((1000 + 1500) / 2)
    expect(eastRows[2]!.running_avg).toBeCloseTo((1000 + 1500 + 1200) / 3)
  })

  it('should compute moving average', () => {
    const data = createSalesData()

    const result = executeWindowFunctions(
      data,
      [{ fn: avgOver('amount'), as: 'moving_avg' }],
      over(
        partitionBy('region'),
        orderBy('date', 'asc'),
        rowsFrame(preceding(1), currentRow())
      )
    )

    const eastRows = result
      .filter((r) => r.region === 'East')
      .sort((a, b) => a.date.localeCompare(b.date))

    expect(eastRows[0]!.moving_avg).toBe(1000)
    expect(eastRows[1]!.moving_avg).toBe((1000 + 1500) / 2)
    expect(eastRows[2]!.moving_avg).toBe((1500 + 1200) / 2)
  })
})

describe('COUNT() OVER', () => {
  it('should compute running count', () => {
    const data = createSalesData()

    const result = executeWindowFunctions(
      data,
      [{ fn: countOver(), as: 'running_count' }],
      over(partitionBy('region'), orderBy('date', 'asc'))
    )

    const eastRows = result
      .filter((r) => r.region === 'East')
      .sort((a, b) => a.date.localeCompare(b.date))

    expect(eastRows[0]!.running_count).toBe(1)
    expect(eastRows[1]!.running_count).toBe(2)
    expect(eastRows[2]!.running_count).toBe(3)
  })

  it('should compute partition count with unbounded frame', () => {
    const data = createSalesData()

    const result = executeWindowFunctions(
      data,
      [{ fn: countOver(), as: 'partition_count' }],
      over(
        partitionBy('region'),
        orderBy('date', 'asc'),
        rowsFrame(unboundedPreceding(), unboundedFollowing())
      )
    )

    const eastRows = result.filter((r) => r.region === 'East')
    eastRows.forEach((r) => {
      expect(r.partition_count).toBe(3)
    })

    const northRows = result.filter((r) => r.region === 'North')
    northRows.forEach((r) => {
      expect(r.partition_count).toBe(2)
    })
  })
})

describe('MIN() OVER / MAX() OVER', () => {
  it('should compute running min', () => {
    const data = [
      { id: 1, value: 10 },
      { id: 2, value: 5 },
      { id: 3, value: 15 },
      { id: 4, value: 3 },
    ]

    const result = executeWindowFunctions(
      data,
      [{ fn: minOver('value'), as: 'running_min' }],
      over(orderBy('id', 'asc'))
    )

    expect(result[0]!.running_min).toBe(10)
    expect(result[1]!.running_min).toBe(5)
    expect(result[2]!.running_min).toBe(5)
    expect(result[3]!.running_min).toBe(3)
  })

  it('should compute running max', () => {
    const data = [
      { id: 1, value: 10 },
      { id: 2, value: 5 },
      { id: 3, value: 15 },
      { id: 4, value: 3 },
    ]

    const result = executeWindowFunctions(
      data,
      [{ fn: maxOver('value'), as: 'running_max' }],
      over(orderBy('id', 'asc'))
    )

    expect(result[0]!.running_max).toBe(10)
    expect(result[1]!.running_max).toBe(10)
    expect(result[2]!.running_max).toBe(15)
    expect(result[3]!.running_max).toBe(15)
  })
})

// ============================================================================
// Window Frame Tests
// ============================================================================

describe('Window Frames', () => {
  describe('ROWS frame', () => {
    it('should handle ROWS BETWEEN n PRECEDING AND m FOLLOWING', () => {
      const data = [
        { id: 1, value: 10 },
        { id: 2, value: 20 },
        { id: 3, value: 30 },
        { id: 4, value: 40 },
        { id: 5, value: 50 },
      ]

      const result = executeWindowFunctions(
        data,
        [{ fn: sumOver('value'), as: 'window_sum' }],
        over(orderBy('id', 'asc'), rowsFrame(preceding(1), following(1)))
      )

      // id=1: sum(10, 20) = 30 (no preceding)
      // id=2: sum(10, 20, 30) = 60
      // id=3: sum(20, 30, 40) = 90
      // id=4: sum(30, 40, 50) = 120
      // id=5: sum(40, 50) = 90 (no following)
      expect(result[0]!.window_sum).toBe(30)
      expect(result[1]!.window_sum).toBe(60)
      expect(result[2]!.window_sum).toBe(90)
      expect(result[3]!.window_sum).toBe(120)
      expect(result[4]!.window_sum).toBe(90)
    })
  })

  describe('RANGE frame', () => {
    it('should handle RANGE with numeric ordering', () => {
      const data = [
        { id: 1, value: 100, amount: 10 },
        { id: 2, value: 100, amount: 20 },
        { id: 3, value: 200, amount: 30 },
        { id: 4, value: 300, amount: 40 },
      ]

      // RANGE BETWEEN 50 PRECEDING AND 50 FOLLOWING
      // Groups rows where value is within +/- 50
      const result = executeWindowFunctions(
        data,
        [{ fn: sumOver('amount'), as: 'range_sum' }],
        over(orderBy('value', 'asc'), rangeFrame(preceding(50), following(50)))
      )

      // value=100: includes 100s only -> 10+20 = 30
      // value=200: includes 200 only -> 30
      // value=300: includes 300 only -> 40
      expect(result[0]!.range_sum).toBe(30) // id=1, value=100
      expect(result[1]!.range_sum).toBe(30) // id=2, value=100
      expect(result[2]!.range_sum).toBe(30) // id=3, value=200
      expect(result[3]!.range_sum).toBe(40) // id=4, value=300
    })
  })
})

// ============================================================================
// Multiple Window Functions Tests
// ============================================================================

describe('Multiple Window Functions', () => {
  it('should compute multiple window functions in one call', () => {
    const data = createSalesData()

    const result = executeWindowFunctions(
      data,
      [
        { fn: rowNumber(), as: 'row_num' },
        { fn: rank(), as: 'rank' },
        { fn: sumOver('amount'), as: 'running_total' },
        { fn: lag('amount'), as: 'prev_amount' },
      ],
      over(partitionBy('region'), orderBy('amount', 'asc'))
    )

    expect(result).toHaveLength(8)

    const eastRows = result.filter((r) => r.region === 'East')
    expect(eastRows[0]!.row_num).toBeDefined()
    expect(eastRows[0]!.rank).toBeDefined()
    expect(eastRows[0]!.running_total).toBeDefined()
    expect(eastRows[0]!.prev_amount).toBeDefined()
  })

  it('should support different window specs for different functions', () => {
    const data = createSalesData()

    const executor = new WindowFunctionExecutor(data)

    const result = executor
      .addFunction(
        rowNumber(),
        'row_num',
        over(partitionBy('region'), orderBy('amount', 'asc'))
      )
      .addFunction(
        sumOver('amount'),
        'total_amount',
        over(partitionBy('region'), orderBy('date', 'asc'))
      )
      .execute()

    expect(result).toHaveLength(8)
    // Each function computed with its own ordering
    result.forEach((r) => {
      expect(r.row_num).toBeDefined()
      expect(r.total_amount).toBeDefined()
    })
  })
})

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('Edge Cases', () => {
  it('should handle empty data', () => {
    const result = executeWindowFunctions(
      [],
      [{ fn: rowNumber(), as: 'row_num' }],
      over(orderBy('id', 'asc'))
    )

    expect(result).toHaveLength(0)
  })

  it('should handle single row', () => {
    const data = [{ id: 1, amount: 100 }]

    const result = executeWindowFunctions(
      data,
      [
        { fn: rowNumber(), as: 'row_num' },
        { fn: lag('amount'), as: 'prev' },
        { fn: lead('amount'), as: 'next' },
        { fn: sumOver('amount'), as: 'total' },
      ],
      over(orderBy('id', 'asc'))
    )

    expect(result).toHaveLength(1)
    expect(result[0]!.row_num).toBe(1)
    expect(result[0]!.prev).toBeNull()
    expect(result[0]!.next).toBeNull()
    expect(result[0]!.total).toBe(100)
  })

  it('should handle null values in order by column', () => {
    const data = [
      { id: 1, value: 100 },
      { id: 2, value: null },
      { id: 3, value: 200 },
    ]

    const result = executeWindowFunctions(
      data,
      [{ fn: rowNumber(), as: 'row_num' }],
      over(orderBy('value', 'asc'))
    )

    expect(result).toHaveLength(3)
    // Nulls should be handled (typically first or last depending on config)
  })

  it('should preserve original row data', () => {
    const data = createSalesData()

    const result = executeWindowFunctions(
      data,
      [{ fn: rowNumber(), as: 'row_num' }],
      over(orderBy('id', 'asc'))
    )

    // All original fields should be preserved
    result.forEach((r, i) => {
      expect(r.id).toBe(data[i]!.id)
      expect(r.region).toBe(data[i]!.region)
      expect(r.salesperson).toBe(data[i]!.salesperson)
      expect(r.amount).toBe(data[i]!.amount)
    })
  })
})

// ============================================================================
// Performance Tests
// ============================================================================

describe('Performance', () => {
  it('should handle 100K rows with 100 partitions in <1s', () => {
    // Generate 100K rows with 100 partitions
    const data = Array.from({ length: 100000 }, (_, i) => ({
      id: i,
      partition: `partition_${i % 100}`,
      value: Math.random() * 1000,
      timestamp: Date.now() + i,
    }))

    const start = performance.now()

    const result = executeWindowFunctions(
      data,
      [
        { fn: rowNumber(), as: 'row_num' },
        { fn: sumOver('value'), as: 'running_sum' },
      ],
      over(partitionBy('partition'), orderBy('timestamp', 'asc'))
    )

    const duration = performance.now() - start

    expect(result).toHaveLength(100000)
    expect(duration).toBeLessThan(1000) // Should complete in under 1 second
  })
})

// ============================================================================
// SQL-like String DSL Tests (Optional)
// ============================================================================

describe('SQL-like DSL', () => {
  it('should support fluent window specification', () => {
    const data = createSalesData()

    // Fluent style
    const windowSpec = over(
      partitionBy('region'),
      orderBy('date', 'asc'),
      rowsFrame(unboundedPreceding(), currentRow())
    )

    const result = executeWindowFunctions(
      data,
      [{ fn: sumOver('amount'), as: 'running_total' }],
      windowSpec
    )

    expect(result).toHaveLength(8)
  })
})
