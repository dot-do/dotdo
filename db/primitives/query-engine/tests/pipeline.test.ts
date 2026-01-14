/**
 * Query Execution Pipeline Tests
 *
 * Tests for the refactored query execution pipeline with:
 * - Logical to Physical plan transformation
 * - Pull-based iterator operators
 * - Operator fusion for common patterns
 * - Memory-aware execution
 *
 * @see dotdo-5qu4s
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

import {
  // Logical Plan Types
  type LogicalPlan,
  LogicalScan,
  LogicalFilter,
  LogicalProject,
  LogicalJoin,
  LogicalAggregate,
  LogicalSort,
  LogicalLimit,

  // Physical Plan Types
  type PhysicalPlan,
  PhysicalScan,
  PhysicalFilter,
  PhysicalProject,
  PhysicalHashJoin,
  PhysicalNestedLoopJoin,
  PhysicalHashAggregate,
  PhysicalStreamAggregate,
  PhysicalSort,
  PhysicalLimit,

  // Plan Transformation
  LogicalToPhysicalPlanner,

  // Operators (Pull-based iterators)
  type Operator,
  ScanOperator,
  FilterOperator,
  ProjectOperator,
  HashJoinOperator,
  HashAggregateOperator,
  SortOperator,
  LimitOperator,
  FusedFilterProjectOperator,

  // Pipeline Execution
  PipelineExecutor,
  type PipelineContext,
  type Row,

  // Memory Management
  MemoryTracker,
  type MemoryBudget,
} from '../pipeline'

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockDataSource(rows: Row[]) {
  return {
    name: 'test_table',
    rows,
    getIterator: () => rows[Symbol.iterator](),
  }
}

const SAMPLE_USERS: Row[] = [
  { id: 1, name: 'Alice', age: 30, status: 'active', department: 'Engineering' },
  { id: 2, name: 'Bob', age: 25, status: 'active', department: 'Sales' },
  { id: 3, name: 'Charlie', age: 35, status: 'inactive', department: 'Engineering' },
  { id: 4, name: 'Diana', age: 28, status: 'active', department: 'Marketing' },
  { id: 5, name: 'Eve', age: 32, status: 'inactive', department: 'Engineering' },
]

const SAMPLE_ORDERS: Row[] = [
  { id: 101, userId: 1, amount: 100, product: 'Widget' },
  { id: 102, userId: 2, amount: 200, product: 'Gadget' },
  { id: 103, userId: 1, amount: 150, product: 'Gadget' },
  { id: 104, userId: 3, amount: 300, product: 'Widget' },
  { id: 105, userId: 4, amount: 250, product: 'Widget' },
]

// =============================================================================
// Logical Plan Tests
// =============================================================================

describe('LogicalPlan', () => {
  describe('LogicalScan', () => {
    it('should represent a table scan', () => {
      const plan = new LogicalScan('users')
      expect(plan.type).toBe('scan')
      expect(plan.tableName).toBe('users')
    })

    it('should support column projection hints', () => {
      const plan = new LogicalScan('users', ['id', 'name'])
      expect(plan.columns).toEqual(['id', 'name'])
    })
  })

  describe('LogicalFilter', () => {
    it('should represent a filter operation', () => {
      const scan = new LogicalScan('users')
      const filter = new LogicalFilter(scan, {
        type: 'predicate',
        column: 'age',
        op: '>',
        value: 25,
      })

      expect(filter.type).toBe('filter')
      expect(filter.input).toBe(scan)
      expect(filter.predicate.column).toBe('age')
    })

    it('should support complex predicates', () => {
      const scan = new LogicalScan('users')
      const filter = new LogicalFilter(scan, {
        type: 'logical',
        op: 'AND',
        children: [
          { type: 'predicate', column: 'age', op: '>', value: 25 },
          { type: 'predicate', column: 'status', op: '=', value: 'active' },
        ],
      })

      expect(filter.predicate.type).toBe('logical')
    })
  })

  describe('LogicalProject', () => {
    it('should represent column projection', () => {
      const scan = new LogicalScan('users')
      const project = new LogicalProject(scan, ['id', 'name', 'age'])

      expect(project.type).toBe('project')
      expect(project.columns).toEqual(['id', 'name', 'age'])
    })

    it('should support computed columns', () => {
      const scan = new LogicalScan('orders')
      const project = new LogicalProject(scan, [
        'id',
        { expression: { op: 'multiply', left: 'amount', right: 'quantity' }, alias: 'total' },
      ])

      expect(project.columns).toHaveLength(2)
    })
  })

  describe('LogicalJoin', () => {
    it('should represent a join between two tables', () => {
      const left = new LogicalScan('orders')
      const right = new LogicalScan('users')
      const join = new LogicalJoin(left, right, 'INNER', {
        leftColumn: 'userId',
        rightColumn: 'id',
      })

      expect(join.type).toBe('join')
      expect(join.joinType).toBe('INNER')
      expect(join.condition.leftColumn).toBe('userId')
    })

    it('should support different join types', () => {
      const left = new LogicalScan('orders')
      const right = new LogicalScan('users')

      const leftJoin = new LogicalJoin(left, right, 'LEFT', { leftColumn: 'userId', rightColumn: 'id' })
      const rightJoin = new LogicalJoin(left, right, 'RIGHT', { leftColumn: 'userId', rightColumn: 'id' })
      const crossJoin = new LogicalJoin(left, right, 'CROSS', { leftColumn: 'userId', rightColumn: 'id' })

      expect(leftJoin.joinType).toBe('LEFT')
      expect(rightJoin.joinType).toBe('RIGHT')
      expect(crossJoin.joinType).toBe('CROSS')
    })
  })

  describe('LogicalAggregate', () => {
    it('should represent grouped aggregation', () => {
      const scan = new LogicalScan('orders')
      const agg = new LogicalAggregate(
        scan,
        ['userId'],
        [
          { function: 'sum', column: 'amount', alias: 'total' },
          { function: 'count', alias: 'orderCount' },
        ]
      )

      expect(agg.type).toBe('aggregate')
      expect(agg.groupBy).toEqual(['userId'])
      expect(agg.aggregations).toHaveLength(2)
    })

    it('should support global aggregation (no group by)', () => {
      const scan = new LogicalScan('orders')
      const agg = new LogicalAggregate(scan, [], [{ function: 'sum', column: 'amount', alias: 'total' }])

      expect(agg.groupBy).toEqual([])
    })
  })

  describe('LogicalSort', () => {
    it('should represent ordering', () => {
      const scan = new LogicalScan('users')
      const sort = new LogicalSort(scan, [{ column: 'age', direction: 'DESC' }])

      expect(sort.type).toBe('sort')
      expect(sort.orderBy[0].direction).toBe('DESC')
    })

    it('should support multi-column sorting', () => {
      const scan = new LogicalScan('users')
      const sort = new LogicalSort(scan, [
        { column: 'department', direction: 'ASC' },
        { column: 'age', direction: 'DESC' },
      ])

      expect(sort.orderBy).toHaveLength(2)
    })
  })

  describe('LogicalLimit', () => {
    it('should represent row limiting', () => {
      const scan = new LogicalScan('users')
      const limit = new LogicalLimit(scan, 10, 0)

      expect(limit.type).toBe('limit')
      expect(limit.limit).toBe(10)
      expect(limit.offset).toBe(0)
    })

    it('should support offset for pagination', () => {
      const scan = new LogicalScan('users')
      const limit = new LogicalLimit(scan, 10, 20)

      expect(limit.offset).toBe(20)
    })
  })
})

// =============================================================================
// Logical to Physical Plan Transformation Tests
// =============================================================================

describe('LogicalToPhysicalPlanner', () => {
  let planner: LogicalToPhysicalPlanner

  beforeEach(() => {
    planner = new LogicalToPhysicalPlanner()
    // Set up table statistics
    planner.setTableStats('users', { rowCount: 1000, sortedBy: null })
    planner.setTableStats('orders', { rowCount: 10000, sortedBy: null })
  })

  it('should transform LogicalScan to PhysicalScan', () => {
    const logical = new LogicalScan('users')
    const physical = planner.transform(logical)

    expect(physical).toBeInstanceOf(PhysicalScan)
    expect((physical as PhysicalScan).tableName).toBe('users')
  })

  it('should transform LogicalFilter to PhysicalFilter', () => {
    const logical = new LogicalFilter(new LogicalScan('users'), {
      type: 'predicate',
      column: 'age',
      op: '>',
      value: 25,
    })
    const physical = planner.transform(logical)

    expect(physical).toBeInstanceOf(PhysicalFilter)
  })

  it('should transform LogicalProject to PhysicalProject', () => {
    const logical = new LogicalProject(new LogicalScan('users'), ['id', 'name'])
    const physical = planner.transform(logical)

    expect(physical).toBeInstanceOf(PhysicalProject)
  })

  it('should choose HashJoin for unsorted inputs', () => {
    const logical = new LogicalJoin(new LogicalScan('orders'), new LogicalScan('users'), 'INNER', {
      leftColumn: 'userId',
      rightColumn: 'id',
    })
    const physical = planner.transform(logical)

    expect(physical).toBeInstanceOf(PhysicalHashJoin)
  })

  it('should choose smaller table as build side for hash join', () => {
    const logical = new LogicalJoin(new LogicalScan('orders'), new LogicalScan('users'), 'INNER', {
      leftColumn: 'userId',
      rightColumn: 'id',
    })
    const physical = planner.transform(logical) as PhysicalHashJoin

    // users (1000 rows) should be build side, orders (10000 rows) probe side
    expect(physical.buildSide).toBe('right')
  })

  it('should use NestedLoopJoin for small cross joins', () => {
    planner.setTableStats('small_table', { rowCount: 10, sortedBy: null })

    const logical = new LogicalJoin(new LogicalScan('small_table'), new LogicalScan('users'), 'CROSS', {
      leftColumn: 'id',
      rightColumn: 'id',
    })
    const physical = planner.transform(logical)

    // For small inputs, nested loop may be chosen
    expect(physical).toBeInstanceOf(PhysicalNestedLoopJoin)
  })

  it('should choose HashAggregate for unsorted input', () => {
    const logical = new LogicalAggregate(new LogicalScan('orders'), ['userId'], [
      { function: 'sum', column: 'amount', alias: 'total' },
    ])
    const physical = planner.transform(logical)

    expect(physical).toBeInstanceOf(PhysicalHashAggregate)
  })

  it('should choose StreamAggregate for sorted input', () => {
    planner.setTableStats('sorted_orders', { rowCount: 10000, sortedBy: 'userId' })

    const logical = new LogicalAggregate(new LogicalScan('sorted_orders'), ['userId'], [
      { function: 'sum', column: 'amount', alias: 'total' },
    ])
    const physical = planner.transform(logical)

    expect(physical).toBeInstanceOf(PhysicalStreamAggregate)
  })

  it('should preserve sort order through planning', () => {
    const logical = new LogicalSort(new LogicalScan('users'), [{ column: 'age', direction: 'DESC' }])
    const physical = planner.transform(logical)

    expect(physical).toBeInstanceOf(PhysicalSort)
  })

  it('should push down limits', () => {
    const logical = new LogicalLimit(new LogicalScan('users'), 10, 0)
    const physical = planner.transform(logical)

    expect(physical).toBeInstanceOf(PhysicalLimit)
    expect((physical as PhysicalLimit).limit).toBe(10)
  })
})

// =============================================================================
// Pull-Based Operator Tests
// =============================================================================

describe('Pull-Based Operators', () => {
  let ctx: PipelineContext

  beforeEach(() => {
    ctx = {
      dataSources: new Map([
        ['users', createMockDataSource(SAMPLE_USERS)],
        ['orders', createMockDataSource(SAMPLE_ORDERS)],
      ]),
      memoryTracker: new MemoryTracker({ maxBytes: 50 * 1024 * 1024 }),
    }
  })

  describe('ScanOperator', () => {
    it('should iterate through all rows', () => {
      const op = new ScanOperator('users')
      op.open(ctx)

      const rows: Row[] = []
      let row: Row | null
      while ((row = op.next()) !== null) {
        rows.push(row)
      }
      op.close()

      expect(rows).toHaveLength(5)
    })

    it('should support column projection at scan time', () => {
      const op = new ScanOperator('users', ['id', 'name'])
      op.open(ctx)

      const row = op.next()
      op.close()

      expect(Object.keys(row!)).toEqual(['id', 'name'])
    })
  })

  describe('FilterOperator', () => {
    it('should filter rows based on predicate', () => {
      const scan = new ScanOperator('users')
      const filter = new FilterOperator(scan, (row) => (row.age as number) > 25)
      filter.open(ctx)

      const rows: Row[] = []
      let row: Row | null
      while ((row = filter.next()) !== null) {
        rows.push(row)
      }
      filter.close()

      expect(rows).toHaveLength(4) // Alice(30), Charlie(35), Diana(28), Eve(32)
      expect(rows.every((r) => (r.age as number) > 25)).toBe(true)
    })

    it('should support compound predicates', () => {
      const scan = new ScanOperator('users')
      const filter = new FilterOperator(scan, (row) => (row.age as number) > 25 && row.status === 'active')
      filter.open(ctx)

      const rows: Row[] = []
      let row: Row | null
      while ((row = filter.next()) !== null) {
        rows.push(row)
      }
      filter.close()

      expect(rows).toHaveLength(2) // Alice(30, active), Diana(28, active)
    })

    it('should short-circuit on empty input', () => {
      const scan = new ScanOperator('users')
      const filter1 = new FilterOperator(scan, () => false) // Returns nothing
      const filter2 = new FilterOperator(filter1, (row) => (row.age as number) > 25)
      filter2.open(ctx)

      const row = filter2.next()
      filter2.close()

      expect(row).toBeNull()
    })
  })

  describe('ProjectOperator', () => {
    it('should project specified columns', () => {
      const scan = new ScanOperator('users')
      const project = new ProjectOperator(scan, ['id', 'name'])
      project.open(ctx)

      const row = project.next()
      project.close()

      expect(Object.keys(row!)).toEqual(['id', 'name'])
    })

    it('should support column aliases', () => {
      const scan = new ScanOperator('users')
      const project = new ProjectOperator(scan, [
        { column: 'id', alias: 'userId' },
        { column: 'name', alias: 'userName' },
      ])
      project.open(ctx)

      const row = project.next()
      project.close()

      expect(row).toHaveProperty('userId')
      expect(row).toHaveProperty('userName')
    })

    it('should support computed columns', () => {
      const scan = new ScanOperator('orders')
      const project = new ProjectOperator(scan, [
        'id',
        { compute: (row) => (row.amount as number) * 1.1, alias: 'amountWithTax' },
      ])
      project.open(ctx)

      const row = project.next()
      project.close()

      expect(row!.amountWithTax).toBeCloseTo(110)
    })
  })

  describe('HashJoinOperator', () => {
    it('should perform inner hash join', () => {
      const leftScan = new ScanOperator('orders')
      const rightScan = new ScanOperator('users')
      const join = new HashJoinOperator(leftScan, rightScan, 'userId', 'id', 'INNER')
      join.open(ctx)

      const rows: Row[] = []
      let row: Row | null
      while ((row = join.next()) !== null) {
        rows.push(row)
      }
      join.close()

      expect(rows.length).toBeGreaterThan(0)
      // Each result should have both order and user data
      expect(rows[0]).toHaveProperty('userId')
      expect(rows[0]).toHaveProperty('name')
    })

    it('should perform left outer join', () => {
      const leftScan = new ScanOperator('orders')
      const rightScan = new ScanOperator('users')
      const join = new HashJoinOperator(leftScan, rightScan, 'userId', 'id', 'LEFT')
      join.open(ctx)

      const rows: Row[] = []
      let row: Row | null
      while ((row = join.next()) !== null) {
        rows.push(row)
      }
      join.close()

      // All orders should be present
      expect(rows.length).toBeGreaterThanOrEqual(5)
    })

    it('should handle no matches correctly', () => {
      // Create orders with non-existent user IDs
      ctx.dataSources.set('orphan_orders', createMockDataSource([{ id: 999, userId: 999, amount: 100 }]))

      const leftScan = new ScanOperator('orphan_orders')
      const rightScan = new ScanOperator('users')
      const join = new HashJoinOperator(leftScan, rightScan, 'userId', 'id', 'INNER')
      join.open(ctx)

      const row = join.next()
      join.close()

      expect(row).toBeNull()
    })
  })

  describe('HashAggregateOperator', () => {
    it('should compute grouped aggregations', () => {
      const scan = new ScanOperator('orders')
      const agg = new HashAggregateOperator(scan, ['userId'], [
        { function: 'sum', column: 'amount', alias: 'total' },
        { function: 'count', alias: 'orderCount' },
      ])
      agg.open(ctx)

      const rows: Row[] = []
      let row: Row | null
      while ((row = agg.next()) !== null) {
        rows.push(row)
      }
      agg.close()

      // User 1 has 2 orders totaling 250
      const user1 = rows.find((r) => r.userId === 1)
      expect(user1).toBeDefined()
      expect(user1!.total).toBe(250)
      expect(user1!.orderCount).toBe(2)
    })

    it('should compute global aggregations', () => {
      const scan = new ScanOperator('orders')
      const agg = new HashAggregateOperator(scan, [], [
        { function: 'sum', column: 'amount', alias: 'total' },
        { function: 'avg', column: 'amount', alias: 'average' },
        { function: 'min', column: 'amount', alias: 'minAmount' },
        { function: 'max', column: 'amount', alias: 'maxAmount' },
      ])
      agg.open(ctx)

      const row = agg.next()
      agg.close()

      expect(row!.total).toBe(1000) // 100+200+150+300+250
      expect(row!.average).toBe(200) // 1000/5
      expect(row!.minAmount).toBe(100)
      expect(row!.maxAmount).toBe(300)
    })
  })

  describe('SortOperator', () => {
    it('should sort rows ascending', () => {
      const scan = new ScanOperator('users')
      const sort = new SortOperator(scan, [{ column: 'age', direction: 'ASC' }])
      sort.open(ctx)

      const rows: Row[] = []
      let row: Row | null
      while ((row = sort.next()) !== null) {
        rows.push(row)
      }
      sort.close()

      expect(rows[0].age).toBe(25) // Bob
      expect(rows[4].age).toBe(35) // Charlie
    })

    it('should sort rows descending', () => {
      const scan = new ScanOperator('users')
      const sort = new SortOperator(scan, [{ column: 'age', direction: 'DESC' }])
      sort.open(ctx)

      const rows: Row[] = []
      let row: Row | null
      while ((row = sort.next()) !== null) {
        rows.push(row)
      }
      sort.close()

      expect(rows[0].age).toBe(35) // Charlie
      expect(rows[4].age).toBe(25) // Bob
    })

    it('should handle multi-column sort', () => {
      const scan = new ScanOperator('users')
      const sort = new SortOperator(scan, [
        { column: 'department', direction: 'ASC' },
        { column: 'age', direction: 'DESC' },
      ])
      sort.open(ctx)

      const rows: Row[] = []
      let row: Row | null
      while ((row = sort.next()) !== null) {
        rows.push(row)
      }
      sort.close()

      // Engineering first (sorted by age DESC): Charlie(35), Eve(32), Alice(30)
      const engineering = rows.filter((r) => r.department === 'Engineering')
      expect(engineering[0].name).toBe('Charlie')
      expect(engineering[1].name).toBe('Eve')
      expect(engineering[2].name).toBe('Alice')
    })
  })

  describe('LimitOperator', () => {
    it('should limit result count', () => {
      const scan = new ScanOperator('users')
      const limit = new LimitOperator(scan, 3, 0)
      limit.open(ctx)

      const rows: Row[] = []
      let row: Row | null
      while ((row = limit.next()) !== null) {
        rows.push(row)
      }
      limit.close()

      expect(rows).toHaveLength(3)
    })

    it('should apply offset', () => {
      const scan = new ScanOperator('users')
      const limit = new LimitOperator(scan, 2, 2)
      limit.open(ctx)

      const rows: Row[] = []
      let row: Row | null
      while ((row = limit.next()) !== null) {
        rows.push(row)
      }
      limit.close()

      expect(rows).toHaveLength(2)
      expect(rows[0].id).toBe(3) // Skipped first 2
    })

    it('should handle offset beyond data', () => {
      const scan = new ScanOperator('users')
      const limit = new LimitOperator(scan, 10, 100)
      limit.open(ctx)

      const row = limit.next()
      limit.close()

      expect(row).toBeNull()
    })
  })
})

// =============================================================================
// Operator Fusion Tests
// =============================================================================

describe('Operator Fusion', () => {
  let ctx: PipelineContext

  beforeEach(() => {
    ctx = {
      dataSources: new Map([['users', createMockDataSource(SAMPLE_USERS)]]),
      memoryTracker: new MemoryTracker({ maxBytes: 50 * 1024 * 1024 }),
    }
  })

  describe('FusedFilterProjectOperator', () => {
    it('should combine filter and project in single pass', () => {
      const scan = new ScanOperator('users')
      const fused = new FusedFilterProjectOperator(
        scan,
        (row) => (row.age as number) > 25,
        ['id', 'name', 'age']
      )
      fused.open(ctx)

      const rows: Row[] = []
      let row: Row | null
      while ((row = fused.next()) !== null) {
        rows.push(row)
      }
      fused.close()

      expect(rows).toHaveLength(4)
      expect(Object.keys(rows[0]!)).toEqual(['id', 'name', 'age'])
    })

    it('should be more efficient than separate operators', () => {
      const iterations = 1000
      const measureFused = () => {
        const scan = new ScanOperator('users')
        const fused = new FusedFilterProjectOperator(
          scan,
          (row) => (row.age as number) > 25,
          ['id', 'name']
        )
        fused.open(ctx)
        while (fused.next() !== null) {
          /* consume */
        }
        fused.close()
      }

      const measureSeparate = () => {
        const scan = new ScanOperator('users')
        const filter = new FilterOperator(scan, (row) => (row.age as number) > 25)
        const project = new ProjectOperator(filter, ['id', 'name'])
        project.open(ctx)
        while (project.next() !== null) {
          /* consume */
        }
        project.close()
      }

      // Both should complete quickly
      const start1 = performance.now()
      for (let i = 0; i < iterations; i++) measureFused()
      const fusedTime = performance.now() - start1

      const start2 = performance.now()
      for (let i = 0; i < iterations; i++) measureSeparate()
      const separateTime = performance.now() - start2

      // Fused should be at least as fast (may not be measurably faster in this simple test)
      expect(fusedTime).toBeLessThan(separateTime * 2)
    })
  })
})

// =============================================================================
// Pipeline Executor Tests
// =============================================================================

describe('PipelineExecutor', () => {
  let executor: PipelineExecutor
  let ctx: PipelineContext

  beforeEach(() => {
    executor = new PipelineExecutor()
    ctx = {
      dataSources: new Map([
        ['users', createMockDataSource(SAMPLE_USERS)],
        ['orders', createMockDataSource(SAMPLE_ORDERS)],
      ]),
      memoryTracker: new MemoryTracker({ maxBytes: 50 * 1024 * 1024 }),
    }
  })

  it('should execute a simple scan', async () => {
    const plan = new PhysicalScan('users')
    const result = await executor.execute(plan, ctx)

    expect(result.rows).toHaveLength(5)
  })

  it('should execute filter + project pipeline', async () => {
    const scan = new PhysicalScan('users')
    const filter = new PhysicalFilter(scan, { type: 'predicate', column: 'age', op: '>', value: 25 })
    const project = new PhysicalProject(filter, ['id', 'name'])

    const result = await executor.execute(project, ctx)

    expect(result.rows).toHaveLength(4)
    expect(Object.keys(result.rows[0])).toEqual(['id', 'name'])
  })

  it('should execute hash join pipeline', async () => {
    const ordersScan = new PhysicalScan('orders')
    const usersScan = new PhysicalScan('users')
    const join = new PhysicalHashJoin(ordersScan, usersScan, 'userId', 'id', 'INNER', 'right')

    const result = await executor.execute(join, ctx)

    expect(result.rows.length).toBeGreaterThan(0)
  })

  it('should execute aggregation pipeline', async () => {
    const scan = new PhysicalScan('orders')
    const agg = new PhysicalHashAggregate(scan, ['userId'], [
      { function: 'sum', column: 'amount', alias: 'total' },
    ])

    const result = await executor.execute(agg, ctx)

    expect(result.rows.length).toBeGreaterThan(0)
    expect(result.rows[0]).toHaveProperty('total')
  })

  it('should execute complex pipeline with multiple operators', async () => {
    // Orders -> Join Users -> Filter active -> Aggregate by department -> Sort
    const ordersScan = new PhysicalScan('orders')
    const usersScan = new PhysicalScan('users')
    const join = new PhysicalHashJoin(ordersScan, usersScan, 'userId', 'id', 'INNER', 'right')
    const filter = new PhysicalFilter(join, { type: 'predicate', column: 'status', op: '=', value: 'active' })
    const agg = new PhysicalHashAggregate(filter, ['department'], [
      { function: 'sum', column: 'amount', alias: 'total' },
    ])
    const sort = new PhysicalSort(agg, [{ column: 'total', direction: 'DESC' }])

    const result = await executor.execute(sort, ctx)

    expect(result.rows.length).toBeGreaterThan(0)
    // Results should be sorted by total descending
    for (let i = 1; i < result.rows.length; i++) {
      expect(result.rows[i - 1]!.total).toBeGreaterThanOrEqual(result.rows[i]!.total as number)
    }
  })

  it('should apply operator fusion when possible', async () => {
    // Filter + Project should be fused
    const scan = new PhysicalScan('users')
    const filter = new PhysicalFilter(scan, { type: 'predicate', column: 'age', op: '>', value: 25 })
    const project = new PhysicalProject(filter, ['id', 'name'])

    const result = await executor.execute(project, ctx)

    // Should produce correct results regardless of fusion
    expect(result.rows).toHaveLength(4)
    expect(result.stats?.fusedOperators).toBeGreaterThanOrEqual(0)
  })

  it('should collect execution statistics', async () => {
    const plan = new PhysicalScan('users')
    const result = await executor.execute(plan, ctx)

    expect(result.stats).toBeDefined()
    expect(result.stats?.rowsProcessed).toBe(5)
    expect(result.stats?.executionTimeMs).toBeGreaterThanOrEqual(0)
  })

  it('should handle empty results gracefully', async () => {
    const scan = new PhysicalScan('users')
    const filter = new PhysicalFilter(scan, { type: 'predicate', column: 'age', op: '>', value: 100 })

    const result = await executor.execute(filter, ctx)

    expect(result.rows).toHaveLength(0)
  })
})

// =============================================================================
// Memory Management Tests
// =============================================================================

describe('MemoryTracker', () => {
  it('should track memory allocations', () => {
    const tracker = new MemoryTracker({ maxBytes: 100 * 1024 * 1024 })

    tracker.allocate(1024)
    expect(tracker.currentBytes).toBe(1024)

    tracker.allocate(2048)
    expect(tracker.currentBytes).toBe(3072)
  })

  it('should track memory deallocations', () => {
    const tracker = new MemoryTracker({ maxBytes: 100 * 1024 * 1024 })

    tracker.allocate(1024)
    tracker.deallocate(512)
    expect(tracker.currentBytes).toBe(512)
  })

  it('should throw when memory limit exceeded', () => {
    const tracker = new MemoryTracker({ maxBytes: 1024 })

    expect(() => tracker.allocate(2048)).toThrow(/memory limit/i)
  })

  it('should support memory reservation', () => {
    const tracker = new MemoryTracker({ maxBytes: 1024 })

    const canReserve = tracker.tryReserve(512)
    expect(canReserve).toBe(true)

    const canReserveMore = tracker.tryReserve(1024)
    expect(canReserveMore).toBe(false)
  })

  it('should track peak memory usage', () => {
    const tracker = new MemoryTracker({ maxBytes: 100 * 1024 })

    tracker.allocate(1000)
    tracker.allocate(2000)
    tracker.deallocate(1500)
    tracker.allocate(500)

    expect(tracker.peakBytes).toBe(3000)
  })

  it('should integrate with operators', () => {
    const tracker = new MemoryTracker({ maxBytes: 50 * 1024 * 1024 })
    const ctx: PipelineContext = {
      dataSources: new Map([['users', createMockDataSource(SAMPLE_USERS)]]),
      memoryTracker: tracker,
    }

    const scan = new ScanOperator('users')
    const sort = new SortOperator(scan, [{ column: 'age', direction: 'ASC' }])
    sort.open(ctx)

    while (sort.next() !== null) {
      /* consume */
    }
    sort.close()

    // Sort operator should have allocated then freed memory
    expect(tracker.currentBytes).toBe(0)
    expect(tracker.peakBytes).toBeGreaterThan(0)
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('Pipeline Integration', () => {
  it('should execute end-to-end: parse -> plan -> execute', async () => {
    const executor = new PipelineExecutor()
    const planner = new LogicalToPhysicalPlanner()

    // Build logical plan
    const logical = new LogicalLimit(
      new LogicalSort(
        new LogicalFilter(new LogicalScan('users'), {
          type: 'predicate',
          column: 'status',
          op: '=',
          value: 'active',
        }),
        [{ column: 'age', direction: 'DESC' }]
      ),
      3,
      0
    )

    // Transform to physical plan
    const physical = planner.transform(logical)

    // Execute
    const ctx: PipelineContext = {
      dataSources: new Map([['users', createMockDataSource(SAMPLE_USERS)]]),
      memoryTracker: new MemoryTracker({ maxBytes: 50 * 1024 * 1024 }),
    }

    const result = await executor.execute(physical, ctx)

    expect(result.rows).toHaveLength(3)
    expect(result.rows[0].status).toBe('active')
    expect((result.rows[0].age as number)).toBeGreaterThanOrEqual(result.rows[1].age as number)
  })

  it('should handle memory pressure gracefully', async () => {
    const executor = new PipelineExecutor()

    // Create a large dataset
    const largeData: Row[] = []
    for (let i = 0; i < 10000; i++) {
      largeData.push({ id: i, value: 'x'.repeat(1000) })
    }

    const ctx: PipelineContext = {
      dataSources: new Map([['large', createMockDataSource(largeData)]]),
      memoryTracker: new MemoryTracker({ maxBytes: 5 * 1024 * 1024 }), // 5MB limit
    }

    const scan = new PhysicalScan('large')
    const sort = new PhysicalSort(scan, [{ column: 'id', direction: 'ASC' }])

    // Should either complete with spillover or throw controlled error
    try {
      const result = await executor.execute(sort, ctx)
      expect(result.rows).toHaveLength(10000)
    } catch (error) {
      expect((error as Error).message).toMatch(/memory/i)
    }
  })
})

// =============================================================================
// Stage Ordering Tests
// =============================================================================

describe('Pipeline Stage Ordering', () => {
  let ctx: PipelineContext

  beforeEach(() => {
    ctx = {
      dataSources: new Map([
        ['users', createMockDataSource(SAMPLE_USERS)],
        ['orders', createMockDataSource(SAMPLE_ORDERS)],
      ]),
      memoryTracker: new MemoryTracker({ maxBytes: 50 * 1024 * 1024 }),
    }
  })

  describe('Filter before Project', () => {
    it('should filter first, then project (correct order)', async () => {
      const executor = new PipelineExecutor()

      // Filter then project - filters have access to all columns
      const scan = new PhysicalScan('users')
      const filter = new PhysicalFilter(scan, {
        type: 'predicate',
        column: 'department',
        op: '=',
        value: 'Engineering',
      })
      const project = new PhysicalProject(filter, ['id', 'name'])

      const result = await executor.execute(project, ctx)

      expect(result.rows).toHaveLength(3) // Alice, Charlie, Eve
      expect(result.rows.every((r) => Object.keys(r).length === 2)).toBe(true)
    })
  })

  describe('Sort before Limit', () => {
    it('should sort before limiting to get correct top-N results', async () => {
      const executor = new PipelineExecutor()

      const scan = new PhysicalScan('users')
      const sort = new PhysicalSort(scan, [{ column: 'age', direction: 'DESC' }])
      const limit = new PhysicalLimit(sort, 2, 0)

      const result = await executor.execute(limit, ctx)

      expect(result.rows).toHaveLength(2)
      expect(result.rows[0].age).toBe(35) // Charlie (oldest)
      expect(result.rows[1].age).toBe(32) // Eve (second oldest)
    })

    it('should limit before sort for different semantic (limit then sort subset)', async () => {
      const executor = new PipelineExecutor()

      // This is technically a different query - take first 3, then sort them
      const scan = new PhysicalScan('users')
      const limit = new PhysicalLimit(scan, 3, 0)
      const sort = new PhysicalSort(limit, [{ column: 'age', direction: 'DESC' }])

      const result = await executor.execute(sort, ctx)

      expect(result.rows).toHaveLength(3)
      // Only sorts the first 3 rows from the scan (Alice, Bob, Charlie)
      expect(result.rows[0].age).toBe(35) // Charlie
      expect(result.rows[1].age).toBe(30) // Alice
      expect(result.rows[2].age).toBe(25) // Bob
    })
  })

  describe('Join before Aggregate', () => {
    it('should join tables before aggregating', async () => {
      const executor = new PipelineExecutor()

      const ordersScan = new PhysicalScan('orders')
      const usersScan = new PhysicalScan('users')
      const join = new PhysicalHashJoin(ordersScan, usersScan, 'userId', 'id', 'INNER', 'right')
      const agg = new PhysicalHashAggregate(join, ['department'], [
        { function: 'sum', column: 'amount', alias: 'totalAmount' },
        { function: 'count', alias: 'orderCount' },
      ])

      const result = await executor.execute(agg, ctx)

      expect(result.rows.length).toBeGreaterThan(0)
      expect(result.rows.every((r) => r.department !== undefined)).toBe(true)
      expect(result.rows.every((r) => r.totalAmount !== undefined)).toBe(true)
    })
  })

  describe('Filter before Join', () => {
    it('should filter early to reduce join input size', async () => {
      const executor = new PipelineExecutor()

      // Filter orders before joining
      const ordersScan = new PhysicalScan('orders')
      const filteredOrders = new PhysicalFilter(ordersScan, {
        type: 'predicate',
        column: 'amount',
        op: '>=',
        value: 200,
      })
      const usersScan = new PhysicalScan('users')
      const join = new PhysicalHashJoin(filteredOrders, usersScan, 'userId', 'id', 'INNER', 'right')

      const result = await executor.execute(join, ctx)

      // Only orders with amount >= 200: 102 (200), 104 (300), 105 (250)
      expect(result.rows).toHaveLength(3)
      expect(result.rows.every((r) => (r.amount as number) >= 200)).toBe(true)
    })
  })

  describe('Aggregate before Sort', () => {
    it('should aggregate before sorting aggregated results', async () => {
      const executor = new PipelineExecutor()

      const scan = new PhysicalScan('orders')
      const agg = new PhysicalHashAggregate(scan, ['userId'], [
        { function: 'sum', column: 'amount', alias: 'total' },
      ])
      const sort = new PhysicalSort(agg, [{ column: 'total', direction: 'DESC' }])

      const result = await executor.execute(sort, ctx)

      expect(result.rows.length).toBeGreaterThan(0)
      // Results should be sorted by total descending
      for (let i = 1; i < result.rows.length; i++) {
        expect(result.rows[i - 1]!.total).toBeGreaterThanOrEqual(result.rows[i]!.total as number)
      }
    })
  })

  describe('Complex Multi-Stage Ordering', () => {
    it('should execute stages in correct order: Scan -> Filter -> Join -> Filter -> Aggregate -> Sort -> Limit', async () => {
      const executor = new PipelineExecutor()

      // Build complex pipeline
      const ordersScan = new PhysicalScan('orders')
      const filteredOrders = new PhysicalFilter(ordersScan, {
        type: 'predicate',
        column: 'amount',
        op: '>',
        value: 100,
      })

      const usersScan = new PhysicalScan('users')
      const join = new PhysicalHashJoin(filteredOrders, usersScan, 'userId', 'id', 'INNER', 'right')

      const postJoinFilter = new PhysicalFilter(join, {
        type: 'predicate',
        column: 'status',
        op: '=',
        value: 'active',
      })

      const agg = new PhysicalHashAggregate(postJoinFilter, ['department'], [
        { function: 'sum', column: 'amount', alias: 'departmentTotal' },
      ])

      const sort = new PhysicalSort(agg, [{ column: 'departmentTotal', direction: 'DESC' }])
      const limit = new PhysicalLimit(sort, 2, 0)

      const result = await executor.execute(limit, ctx)

      expect(result.rows.length).toBeLessThanOrEqual(2)
      expect(result.rows.every((r) => r.department !== undefined)).toBe(true)
      expect(result.rows.every((r) => r.departmentTotal !== undefined)).toBe(true)
    })
  })
})

// =============================================================================
// Optimization Tests
// =============================================================================

describe('Pipeline Optimization', () => {
  describe('Planner Cost-Based Decisions', () => {
    let planner: LogicalToPhysicalPlanner

    beforeEach(() => {
      planner = new LogicalToPhysicalPlanner()
    })

    it('should choose hash join for large tables', () => {
      planner.setTableStats('big_left', { rowCount: 100000, sortedBy: null })
      planner.setTableStats('big_right', { rowCount: 50000, sortedBy: null })

      const logical = new LogicalJoin(new LogicalScan('big_left'), new LogicalScan('big_right'), 'INNER', {
        leftColumn: 'id',
        rightColumn: 'ref_id',
      })

      const physical = planner.transform(logical)
      expect(physical).toBeInstanceOf(PhysicalHashJoin)
    })

    it('should place smaller table on build side of hash join', () => {
      planner.setTableStats('small', { rowCount: 100, sortedBy: null })
      planner.setTableStats('large', { rowCount: 10000, sortedBy: null })

      const logical = new LogicalJoin(new LogicalScan('large'), new LogicalScan('small'), 'INNER', {
        leftColumn: 'ref_id',
        rightColumn: 'id',
      })

      const physical = planner.transform(logical) as PhysicalHashJoin
      expect(physical.buildSide).toBe('right') // small table is on the right
    })

    it('should use nested loop for very small cross joins', () => {
      planner.setTableStats('tiny', { rowCount: 5, sortedBy: null })
      planner.setTableStats('small', { rowCount: 50, sortedBy: null })

      const logical = new LogicalJoin(new LogicalScan('tiny'), new LogicalScan('small'), 'CROSS', {
        leftColumn: 'id',
        rightColumn: 'id',
      })

      const physical = planner.transform(logical)
      expect(physical).toBeInstanceOf(PhysicalNestedLoopJoin)
    })

    it('should use stream aggregate for sorted input', () => {
      planner.setTableStats('sorted_data', { rowCount: 10000, sortedBy: 'group_key' })

      const logical = new LogicalAggregate(new LogicalScan('sorted_data'), ['group_key'], [
        { function: 'sum', column: 'value', alias: 'total' },
      ])

      const physical = planner.transform(logical)
      expect(physical).toBeInstanceOf(PhysicalStreamAggregate)
    })

    it('should use hash aggregate for unsorted input', () => {
      planner.setTableStats('unsorted_data', { rowCount: 10000, sortedBy: null })

      const logical = new LogicalAggregate(new LogicalScan('unsorted_data'), ['group_key'], [
        { function: 'sum', column: 'value', alias: 'total' },
      ])

      const physical = planner.transform(logical)
      expect(physical).toBeInstanceOf(PhysicalHashAggregate)
    })

    it('should detect sorted input from sort operator', () => {
      planner.setTableStats('data', { rowCount: 10000, sortedBy: null })

      const logical = new LogicalAggregate(
        new LogicalSort(new LogicalScan('data'), [{ column: 'group_key', direction: 'ASC' }]),
        ['group_key'],
        [{ function: 'count', alias: 'cnt' }]
      )

      const physical = planner.transform(logical)
      expect(physical).toBeInstanceOf(PhysicalStreamAggregate)
    })
  })

  describe('Predicate Optimization', () => {
    let ctx: PipelineContext

    beforeEach(() => {
      ctx = {
        dataSources: new Map([['users', createMockDataSource(SAMPLE_USERS)]]),
        memoryTracker: new MemoryTracker({ maxBytes: 50 * 1024 * 1024 }),
      }
    })

    it('should handle AND predicates correctly', async () => {
      const executor = new PipelineExecutor()

      const scan = new PhysicalScan('users')
      const filter = new PhysicalFilter(scan, {
        type: 'logical',
        op: 'AND',
        children: [
          { type: 'predicate', column: 'age', op: '>', value: 25 },
          { type: 'predicate', column: 'status', op: '=', value: 'active' },
        ],
      })

      const result = await executor.execute(filter, ctx)

      // Alice (30, active) and Diana (28, active)
      expect(result.rows).toHaveLength(2)
      expect(result.rows.every((r) => (r.age as number) > 25 && r.status === 'active')).toBe(true)
    })

    it('should handle OR predicates correctly', async () => {
      const executor = new PipelineExecutor()

      const scan = new PhysicalScan('users')
      const filter = new PhysicalFilter(scan, {
        type: 'logical',
        op: 'OR',
        children: [
          { type: 'predicate', column: 'department', op: '=', value: 'Sales' },
          { type: 'predicate', column: 'department', op: '=', value: 'Marketing' },
        ],
      })

      const result = await executor.execute(filter, ctx)

      // Bob (Sales) and Diana (Marketing)
      expect(result.rows).toHaveLength(2)
    })

    it('should handle NOT predicates correctly', async () => {
      const executor = new PipelineExecutor()

      const scan = new PhysicalScan('users')
      const filter = new PhysicalFilter(scan, {
        type: 'logical',
        op: 'NOT',
        children: [{ type: 'predicate', column: 'status', op: '=', value: 'active' }],
      })

      const result = await executor.execute(filter, ctx)

      // Charlie and Eve are inactive
      expect(result.rows).toHaveLength(2)
      expect(result.rows.every((r) => r.status === 'inactive')).toBe(true)
    })

    it('should handle IN predicates correctly', async () => {
      const executor = new PipelineExecutor()

      const scan = new PhysicalScan('users')
      const filter = new PhysicalFilter(scan, {
        type: 'predicate',
        column: 'department',
        op: 'IN',
        value: ['Sales', 'Marketing'],
      })

      const result = await executor.execute(filter, ctx)

      expect(result.rows).toHaveLength(2)
      expect(result.rows.every((r) => ['Sales', 'Marketing'].includes(r.department as string))).toBe(true)
    })

    it('should handle LIKE predicates correctly', async () => {
      const executor = new PipelineExecutor()

      const scan = new PhysicalScan('users')
      const filter = new PhysicalFilter(scan, {
        type: 'predicate',
        column: 'name',
        op: 'LIKE',
        value: '%li%', // Contains 'li'
      })

      const result = await executor.execute(filter, ctx)

      // Alice and Charlie contain 'li'
      expect(result.rows).toHaveLength(2)
    })

    it('should handle nested logical predicates', async () => {
      const executor = new PipelineExecutor()

      const scan = new PhysicalScan('users')
      const filter = new PhysicalFilter(scan, {
        type: 'logical',
        op: 'OR',
        children: [
          {
            type: 'logical',
            op: 'AND',
            children: [
              { type: 'predicate', column: 'department', op: '=', value: 'Engineering' },
              { type: 'predicate', column: 'status', op: '=', value: 'active' },
            ],
          },
          { type: 'predicate', column: 'age', op: '<', value: 26 },
        ],
      })

      const result = await executor.execute(filter, ctx)

      // Alice (Engineering + active) and Bob (age 25)
      expect(result.rows).toHaveLength(2)
    })
  })
})

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('Pipeline Error Handling', () => {
  describe('Missing Data Sources', () => {
    it('should throw error when data source is not found', () => {
      const ctx: PipelineContext = {
        dataSources: new Map(),
        memoryTracker: new MemoryTracker({ maxBytes: 50 * 1024 * 1024 }),
      }

      const scan = new ScanOperator('nonexistent_table')

      expect(() => scan.open(ctx)).toThrow(/Data source not found: nonexistent_table/)
    })

    it('should throw error for missing join table', () => {
      const ctx: PipelineContext = {
        dataSources: new Map([['users', createMockDataSource(SAMPLE_USERS)]]),
        memoryTracker: new MemoryTracker({ maxBytes: 50 * 1024 * 1024 }),
      }

      const left = new ScanOperator('users')
      const right = new ScanOperator('missing_orders')
      const join = new HashJoinOperator(left, right, 'id', 'userId', 'INNER')

      expect(() => join.open(ctx)).toThrow(/Data source not found: missing_orders/)
    })
  })

  describe('Invalid Plan Types', () => {
    it('should throw error for unknown logical plan type during transformation', () => {
      const planner = new LogicalToPhysicalPlanner()
      const invalidPlan = { type: 'invalid_type' } as unknown as LogicalPlan

      expect(() => planner.transform(invalidPlan)).toThrow(/Unknown logical plan type/)
    })

    it('should throw error for unknown physical plan type during execution', async () => {
      const executor = new PipelineExecutor()
      const ctx: PipelineContext = {
        dataSources: new Map(),
        memoryTracker: new MemoryTracker({ maxBytes: 50 * 1024 * 1024 }),
      }

      const invalidPlan = { type: 'invalid_physical_type' } as unknown as PhysicalPlan

      await expect(executor.execute(invalidPlan, ctx)).rejects.toThrow(/Unknown physical plan type/)
    })
  })

  describe('Memory Limit Exceeded', () => {
    it('should throw error when memory limit is exceeded during allocation', () => {
      const tracker = new MemoryTracker({ maxBytes: 100 })

      expect(() => tracker.allocate(200)).toThrow(/Memory limit exceeded/)
    })

    it('should throw error during sort of large dataset with small memory budget', async () => {
      const executor = new PipelineExecutor()

      // Create dataset that exceeds memory budget
      const largeData: Row[] = []
      for (let i = 0; i < 100; i++) {
        largeData.push({ id: i, data: 'x'.repeat(100) })
      }

      const ctx: PipelineContext = {
        dataSources: new Map([['large', createMockDataSource(largeData)]]),
        memoryTracker: new MemoryTracker({ maxBytes: 1000 }), // Very small budget
      }

      const scan = new PhysicalScan('large')
      const sort = new PhysicalSort(scan, [{ column: 'id', direction: 'ASC' }])

      await expect(executor.execute(sort, ctx)).rejects.toThrow(/Memory limit exceeded/)
    })
  })

  describe('Invalid Aggregations', () => {
    it('should throw error for unknown aggregation function', () => {
      const ctx: PipelineContext = {
        dataSources: new Map([['users', createMockDataSource(SAMPLE_USERS)]]),
        memoryTracker: new MemoryTracker({ maxBytes: 50 * 1024 * 1024 }),
      }

      const scan = new ScanOperator('users')
      const agg = new HashAggregateOperator(scan, [], [
        { function: 'unknown_function' as any, column: 'age', alias: 'result' },
      ])

      agg.open(ctx)
      expect(() => agg.next()).toThrow(/Unknown aggregation function/)
    })
  })

  describe('Operator Lifecycle Errors', () => {
    it('should handle calling next before open gracefully', () => {
      const scan = new ScanOperator('users')

      // Should return null since iterator is not initialized
      expect(scan.next()).toBeNull()
    })

    it('should handle calling next after close gracefully', () => {
      const ctx: PipelineContext = {
        dataSources: new Map([['users', createMockDataSource(SAMPLE_USERS)]]),
        memoryTracker: new MemoryTracker({ maxBytes: 50 * 1024 * 1024 }),
      }

      const scan = new ScanOperator('users')
      scan.open(ctx)
      scan.close()

      // Should return null after close
      expect(scan.next()).toBeNull()
    })

    it('should handle multiple close calls gracefully', () => {
      const ctx: PipelineContext = {
        dataSources: new Map([['users', createMockDataSource(SAMPLE_USERS)]]),
        memoryTracker: new MemoryTracker({ maxBytes: 50 * 1024 * 1024 }),
      }

      const scan = new ScanOperator('users')
      scan.open(ctx)

      // Should not throw on multiple close calls
      expect(() => {
        scan.close()
        scan.close()
        scan.close()
      }).not.toThrow()
    })
  })

  describe('Empty Data Handling', () => {
    it('should handle empty data source correctly', async () => {
      const executor = new PipelineExecutor()
      const ctx: PipelineContext = {
        dataSources: new Map([['empty', createMockDataSource([])]]),
        memoryTracker: new MemoryTracker({ maxBytes: 50 * 1024 * 1024 }),
      }

      const scan = new PhysicalScan('empty')
      const result = await executor.execute(scan, ctx)

      expect(result.rows).toHaveLength(0)
    })

    it('should handle global aggregation on empty data', async () => {
      const executor = new PipelineExecutor()
      const ctx: PipelineContext = {
        dataSources: new Map([['empty', createMockDataSource([])]]),
        memoryTracker: new MemoryTracker({ maxBytes: 50 * 1024 * 1024 }),
      }

      const scan = new PhysicalScan('empty')
      const agg = new PhysicalHashAggregate(scan, [], [
        { function: 'count', alias: 'cnt' },
        { function: 'sum', column: 'value', alias: 'total' },
      ])

      const result = await executor.execute(agg, ctx)

      // Global aggregation should return one row even for empty input
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].cnt).toBe(0)
      expect(result.rows[0].total).toBe(0)
    })

    it('should handle sort on empty data', async () => {
      const executor = new PipelineExecutor()
      const ctx: PipelineContext = {
        dataSources: new Map([['empty', createMockDataSource([])]]),
        memoryTracker: new MemoryTracker({ maxBytes: 50 * 1024 * 1024 }),
      }

      const scan = new PhysicalScan('empty')
      const sort = new PhysicalSort(scan, [{ column: 'id', direction: 'ASC' }])

      const result = await executor.execute(sort, ctx)
      expect(result.rows).toHaveLength(0)
    })

    it('should handle join with empty left side', async () => {
      const executor = new PipelineExecutor()
      const ctx: PipelineContext = {
        dataSources: new Map([
          ['empty', createMockDataSource([])],
          ['users', createMockDataSource(SAMPLE_USERS)],
        ]),
        memoryTracker: new MemoryTracker({ maxBytes: 50 * 1024 * 1024 }),
      }

      const left = new PhysicalScan('empty')
      const right = new PhysicalScan('users')
      const join = new PhysicalHashJoin(left, right, 'userId', 'id', 'INNER', 'right')

      const result = await executor.execute(join, ctx)
      expect(result.rows).toHaveLength(0)
    })

    it('should handle join with empty right side', async () => {
      const executor = new PipelineExecutor()
      const ctx: PipelineContext = {
        dataSources: new Map([
          ['orders', createMockDataSource(SAMPLE_ORDERS)],
          ['empty', createMockDataSource([])],
        ]),
        memoryTracker: new MemoryTracker({ maxBytes: 50 * 1024 * 1024 }),
      }

      const left = new PhysicalScan('orders')
      const right = new PhysicalScan('empty')
      const join = new PhysicalHashJoin(left, right, 'userId', 'id', 'INNER', 'right')

      const result = await executor.execute(join, ctx)
      expect(result.rows).toHaveLength(0)
    })
  })

  describe('Null and Undefined Value Handling', () => {
    const DATA_WITH_NULLS: Row[] = [
      { id: 1, name: 'Alice', score: 100 },
      { id: 2, name: null, score: 80 },
      { id: 3, name: 'Charlie', score: null },
      { id: 4, name: undefined, score: undefined },
      { id: 5, name: 'Eve', score: 90 },
    ]

    it('should sort null values to the end', async () => {
      const executor = new PipelineExecutor()
      const ctx: PipelineContext = {
        dataSources: new Map([['data', createMockDataSource(DATA_WITH_NULLS)]]),
        memoryTracker: new MemoryTracker({ maxBytes: 50 * 1024 * 1024 }),
      }

      const scan = new PhysicalScan('data')
      const sort = new PhysicalSort(scan, [{ column: 'score', direction: 'ASC' }])

      const result = await executor.execute(sort, ctx)

      // Non-null values first, sorted ascending, then nulls
      expect(result.rows).toHaveLength(5)
      expect(result.rows[0].score).toBe(80)
      expect(result.rows[1].score).toBe(90)
      expect(result.rows[2].score).toBe(100)
    })

    it('should handle null values in aggregation', async () => {
      const executor = new PipelineExecutor()
      const ctx: PipelineContext = {
        dataSources: new Map([['data', createMockDataSource(DATA_WITH_NULLS)]]),
        memoryTracker: new MemoryTracker({ maxBytes: 50 * 1024 * 1024 }),
      }

      const scan = new PhysicalScan('data')
      const agg = new PhysicalHashAggregate(scan, [], [
        { function: 'sum', column: 'score', alias: 'total' },
        { function: 'count', alias: 'cnt' },
      ])

      const result = await executor.execute(agg, ctx)

      // sum(100, 80, null, undefined, 90) = 270 (nulls treated as 0)
      expect(result.rows[0].total).toBe(270)
      expect(result.rows[0].cnt).toBe(5)
    })
  })
})

// =============================================================================
// Additional Pipeline Stage Tests
// =============================================================================

describe('Additional Pipeline Stage Coverage', () => {
  let ctx: PipelineContext

  beforeEach(() => {
    ctx = {
      dataSources: new Map([
        ['users', createMockDataSource(SAMPLE_USERS)],
        ['orders', createMockDataSource(SAMPLE_ORDERS)],
      ]),
      memoryTracker: new MemoryTracker({ maxBytes: 50 * 1024 * 1024 }),
    }
  })

  describe('ScanOperator with Column Projection', () => {
    it('should project only specified columns', () => {
      const op = new ScanOperator('users', ['id', 'name'])
      op.open(ctx)

      const rows: Row[] = []
      let row: Row | null
      while ((row = op.next()) !== null) {
        rows.push(row)
      }
      op.close()

      expect(rows).toHaveLength(5)
      rows.forEach((r) => {
        expect(Object.keys(r)).toEqual(['id', 'name'])
        expect(r.age).toBeUndefined()
        expect(r.status).toBeUndefined()
      })
    })
  })

  describe('ProjectOperator with Expressions', () => {
    it('should compute expressions correctly', async () => {
      const executor = new PipelineExecutor()

      const scan = new PhysicalScan('orders')
      const project = new PhysicalProject(scan, [
        'id',
        { column: 'amount', alias: 'originalAmount' },
        { compute: (row) => (row.amount as number) * 1.1, alias: 'amountWithTax' },
        { compute: (row) => `Order-${row.id}`, alias: 'orderLabel' },
      ])

      const result = await executor.execute(project, ctx)

      expect(result.rows).toHaveLength(5)
      expect(result.rows[0]).toHaveProperty('id')
      expect(result.rows[0]).toHaveProperty('originalAmount')
      expect(result.rows[0]).toHaveProperty('amountWithTax')
      expect(result.rows[0]).toHaveProperty('orderLabel')

      // Check computation
      const firstRow = result.rows[0]
      expect(firstRow.amountWithTax).toBeCloseTo((firstRow.originalAmount as number) * 1.1)
      expect(firstRow.orderLabel).toBe(`Order-${firstRow.id}`)
    })
  })

  describe('Multiple Aggregations', () => {
    it('should compute multiple different aggregation functions', async () => {
      const executor = new PipelineExecutor()

      const scan = new PhysicalScan('orders')
      const agg = new PhysicalHashAggregate(scan, [], [
        { function: 'count', alias: 'totalOrders' },
        { function: 'sum', column: 'amount', alias: 'totalAmount' },
        { function: 'avg', column: 'amount', alias: 'avgAmount' },
        { function: 'min', column: 'amount', alias: 'minAmount' },
        { function: 'max', column: 'amount', alias: 'maxAmount' },
      ])

      const result = await executor.execute(agg, ctx)

      expect(result.rows).toHaveLength(1)
      const stats = result.rows[0]
      expect(stats.totalOrders).toBe(5)
      expect(stats.totalAmount).toBe(1000)
      expect(stats.avgAmount).toBe(200)
      expect(stats.minAmount).toBe(100)
      expect(stats.maxAmount).toBe(300)
    })

    it('should group and aggregate correctly', async () => {
      const executor = new PipelineExecutor()

      const scan = new PhysicalScan('orders')
      const agg = new PhysicalHashAggregate(scan, ['product'], [
        { function: 'count', alias: 'orderCount' },
        { function: 'sum', column: 'amount', alias: 'totalAmount' },
      ])

      const result = await executor.execute(agg, ctx)

      // Widget: orders 101 (100), 104 (300), 105 (250) = 3 orders, 650 total
      // Gadget: orders 102 (200), 103 (150) = 2 orders, 350 total
      const widget = result.rows.find((r) => r.product === 'Widget')
      const gadget = result.rows.find((r) => r.product === 'Gadget')

      expect(widget).toBeDefined()
      expect(widget!.orderCount).toBe(3)
      expect(widget!.totalAmount).toBe(650)

      expect(gadget).toBeDefined()
      expect(gadget!.orderCount).toBe(2)
      expect(gadget!.totalAmount).toBe(350)
    })
  })

  describe('Comparison Operators', () => {
    it('should handle != correctly', async () => {
      const executor = new PipelineExecutor()

      const scan = new PhysicalScan('users')
      const filter = new PhysicalFilter(scan, {
        type: 'predicate',
        column: 'status',
        op: '!=',
        value: 'active',
      })

      const result = await executor.execute(filter, ctx)
      expect(result.rows).toHaveLength(2) // Charlie and Eve (inactive)
      expect(result.rows.every((r) => r.status !== 'active')).toBe(true)
    })

    it('should handle >= correctly', async () => {
      const executor = new PipelineExecutor()

      const scan = new PhysicalScan('users')
      const filter = new PhysicalFilter(scan, {
        type: 'predicate',
        column: 'age',
        op: '>=',
        value: 30,
      })

      const result = await executor.execute(filter, ctx)
      expect(result.rows).toHaveLength(3) // Alice (30), Charlie (35), Eve (32)
    })

    it('should handle < correctly', async () => {
      const executor = new PipelineExecutor()

      const scan = new PhysicalScan('users')
      const filter = new PhysicalFilter(scan, {
        type: 'predicate',
        column: 'age',
        op: '<',
        value: 30,
      })

      const result = await executor.execute(filter, ctx)
      expect(result.rows).toHaveLength(2) // Bob (25), Diana (28)
    })

    it('should handle <= correctly', async () => {
      const executor = new PipelineExecutor()

      const scan = new PhysicalScan('users')
      const filter = new PhysicalFilter(scan, {
        type: 'predicate',
        column: 'age',
        op: '<=',
        value: 28,
      })

      const result = await executor.execute(filter, ctx)
      expect(result.rows).toHaveLength(2) // Bob (25), Diana (28)
    })
  })

  describe('LEFT JOIN Semantics', () => {
    it('should include unmatched left rows with nulls for right columns', async () => {
      // Create orders with a user that does not exist
      const ordersWithOrphan: Row[] = [
        ...SAMPLE_ORDERS,
        { id: 106, userId: 999, amount: 500, product: 'Special' }, // No matching user
      ]

      const ctx: PipelineContext = {
        dataSources: new Map([
          ['orders', createMockDataSource(ordersWithOrphan)],
          ['users', createMockDataSource(SAMPLE_USERS)],
        ]),
        memoryTracker: new MemoryTracker({ maxBytes: 50 * 1024 * 1024 }),
      }

      const executor = new PipelineExecutor()

      const left = new PhysicalScan('orders')
      const right = new PhysicalScan('users')
      const join = new PhysicalHashJoin(left, right, 'userId', 'id', 'LEFT', 'right')

      const result = await executor.execute(join, ctx)

      // All 6 orders should be present
      expect(result.rows.length).toBe(6)

      // Find the orphan order
      const orphan = result.rows.find((r) => r.userId === 999)
      expect(orphan).toBeDefined()
      expect(orphan!.name).toBeNull() // Right side columns are null
    })
  })

  describe('Limit with Offset Edge Cases', () => {
    it('should handle limit 0', async () => {
      const executor = new PipelineExecutor()

      const scan = new PhysicalScan('users')
      const limit = new PhysicalLimit(scan, 0, 0)

      const result = await executor.execute(limit, ctx)
      expect(result.rows).toHaveLength(0)
    })

    it('should handle offset equal to row count', async () => {
      const executor = new PipelineExecutor()

      const scan = new PhysicalScan('users')
      const limit = new PhysicalLimit(scan, 10, 5) // Skip all 5 rows

      const result = await executor.execute(limit, ctx)
      expect(result.rows).toHaveLength(0)
    })

    it('should handle large limit with offset', async () => {
      const executor = new PipelineExecutor()

      const scan = new PhysicalScan('users')
      const limit = new PhysicalLimit(scan, 1000, 2) // Skip 2, take up to 1000

      const result = await executor.execute(limit, ctx)
      expect(result.rows).toHaveLength(3) // Only 3 left after skipping 2
    })
  })
})
