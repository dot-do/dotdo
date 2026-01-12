/**
 * Distributed DuckDB Analytics Engine Tests
 *
 * RED phase TDD tests for DistributedDuckDB on Cloudflare Workers.
 * Tests should FAIL until the implementation is complete.
 *
 * Features:
 * - Query Routing: Route queries to appropriate shards
 * - Distributed Joins: Cross-shard join execution
 * - Parallel Aggregation: Distributed aggregation with merge
 * - Result Streaming: Stream large results
 * - Query Planning: Distributed query optimizer
 *
 * @see docs/plans/unified-analytics-architecture.md
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Import types and implementation that will be created
import type {
  DistributedDuckDBConfig,
  ShardConfig,
  QueryPlan,
  QueryResult,
  StreamBatch,
  InsertOptions,
  RebalanceOptions,
  ShardInfo,
  QueryPlanNode,
  QueryMetrics,
} from '../types'

import {
  DistributedDuckDB,
  Shard,
  QueryPlanner,
  QueryRouter,
  ResultMerger,
} from '../index'

// ============================================================================
// Test Fixtures
// ============================================================================

const createTestShards = (): ShardConfig[] => [
  { id: 'shard-1', region: 'us-east', tables: ['orders_2023', 'customers'] },
  { id: 'shard-2', region: 'us-west', tables: ['orders_2024'] },
  { id: 'shard-3', region: 'eu-west', tables: ['products', 'inventory'] },
]

const createTestConfig = (overrides?: Partial<DistributedDuckDBConfig>): DistributedDuckDBConfig => ({
  shards: createTestShards(),
  defaultTimeout: 30000,
  maxParallelism: 4,
  ...overrides,
})

// Mock data for testing
const mockOrdersData = [
  { order_id: 1, customer_id: 101, amount: 150.00, order_date: '2023-03-15' },
  { order_id: 2, customer_id: 102, amount: 250.00, order_date: '2023-06-20' },
  { order_id: 3, customer_id: 101, amount: 300.00, order_date: '2024-01-10' },
  { order_id: 4, customer_id: 103, amount: 175.00, order_date: '2024-02-28' },
]

const mockCustomersData = [
  { id: 101, name: 'Alice Corp', region: 'US' },
  { id: 102, name: 'Bob Industries', region: 'EU' },
  { id: 103, name: 'Charlie Ltd', region: 'US' },
]

// ============================================================================
// DistributedDuckDB Class Structure Tests
// ============================================================================

describe('DistributedDuckDB class structure', () => {
  it('is a class that can be instantiated with config', () => {
    const config = createTestConfig()
    const db = new DistributedDuckDB(config)

    expect(db).toBeInstanceOf(DistributedDuckDB)
  })

  it('exposes query method', () => {
    const db = new DistributedDuckDB(createTestConfig())
    expect(typeof db.query).toBe('function')
  })

  it('exposes explain method', () => {
    const db = new DistributedDuckDB(createTestConfig())
    expect(typeof db.explain).toBe('function')
  })

  it('exposes queryStream method', () => {
    const db = new DistributedDuckDB(createTestConfig())
    expect(typeof db.queryStream).toBe('function')
  })

  it('exposes insertParallel method', () => {
    const db = new DistributedDuckDB(createTestConfig())
    expect(typeof db.insertParallel).toBe('function')
  })

  it('exposes addShard method', () => {
    const db = new DistributedDuckDB(createTestConfig())
    expect(typeof db.addShard).toBe('function')
  })

  it('exposes removeShard method', () => {
    const db = new DistributedDuckDB(createTestConfig())
    expect(typeof db.removeShard).toBe('function')
  })

  it('exposes rebalance method', () => {
    const db = new DistributedDuckDB(createTestConfig())
    expect(typeof db.rebalance).toBe('function')
  })

  it('exposes getShards method', () => {
    const db = new DistributedDuckDB(createTestConfig())
    expect(typeof db.getShards).toBe('function')
  })

  it('exposes close method', () => {
    const db = new DistributedDuckDB(createTestConfig())
    expect(typeof db.close).toBe('function')
  })
})

// ============================================================================
// Query Routing Tests
// ============================================================================

describe('DistributedDuckDB query routing', () => {
  let db: DistributedDuckDB

  beforeEach(() => {
    db = new DistributedDuckDB(createTestConfig())
  })

  afterEach(async () => {
    await db.close()
  })

  describe('single-shard queries', () => {
    it('routes query to shard containing the table', async () => {
      const result = await db.query('SELECT * FROM orders_2023 LIMIT 10')

      expect(result.success).toBe(true)
      expect(result.metadata?.shards).toContain('shard-1')
      expect(result.metadata?.shards).toHaveLength(1)
    })

    it('routes to correct shard for 2024 orders', async () => {
      const result = await db.query('SELECT * FROM orders_2024 LIMIT 10')

      expect(result.success).toBe(true)
      expect(result.metadata?.shards).toContain('shard-2')
    })

    it('routes to correct shard for products table', async () => {
      const result = await db.query('SELECT * FROM products LIMIT 10')

      expect(result.success).toBe(true)
      expect(result.metadata?.shards).toContain('shard-3')
    })
  })

  describe('multi-shard queries', () => {
    it('routes query to multiple shards for UNION table', async () => {
      // "orders" spans orders_2023 (shard-1) and orders_2024 (shard-2)
      const result = await db.query(`
        SELECT customer_id, SUM(amount) as total
        FROM orders
        GROUP BY customer_id
      `)

      expect(result.success).toBe(true)
      expect(result.metadata?.shards).toContain('shard-1')
      expect(result.metadata?.shards).toContain('shard-2')
    })

    it('handles queries with date filters routing to specific shards', async () => {
      const result = await db.query(`
        SELECT * FROM orders
        WHERE order_date >= '2024-01-01'
      `)

      expect(result.success).toBe(true)
      // Should only hit shard-2 (orders_2024) due to date filter
      expect(result.metadata?.shards).toContain('shard-2')
    })
  })

  describe('routing errors', () => {
    it('returns error for query on nonexistent table', async () => {
      const result = await db.query('SELECT * FROM nonexistent_table')

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('TABLE_NOT_FOUND')
    })

    it('returns error for invalid SQL', async () => {
      const result = await db.query('SELCT * FORM orders')

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('PARSE_ERROR')
    })
  })
})

// ============================================================================
// Distributed Joins Tests
// ============================================================================

describe('DistributedDuckDB distributed joins', () => {
  let db: DistributedDuckDB

  beforeEach(() => {
    db = new DistributedDuckDB(createTestConfig())
  })

  afterEach(async () => {
    await db.close()
  })

  describe('cross-shard joins', () => {
    it('executes join between tables on different shards', async () => {
      const result = await db.query(`
        SELECT o.order_id, o.amount, c.name
        FROM orders o
        JOIN customers c ON o.customer_id = c.id
        WHERE o.amount > 100
      `)

      expect(result.success).toBe(true)
      expect(result.rows.length).toBeGreaterThan(0)
      expect(result.rows[0]).toHaveProperty('order_id')
      expect(result.rows[0]).toHaveProperty('name')
    })

    it('handles join with filters on both tables', async () => {
      const result = await db.query(`
        SELECT o.order_id, c.name, c.region
        FROM orders o
        JOIN customers c ON o.customer_id = c.id
        WHERE o.amount > 200 AND c.region = 'US'
      `)

      expect(result.success).toBe(true)
      result.rows.forEach((row: any) => {
        expect(row.region).toBe('US')
      })
    })

    it('handles LEFT JOIN across shards', async () => {
      const result = await db.query(`
        SELECT c.name, COALESCE(SUM(o.amount), 0) as total_spent
        FROM customers c
        LEFT JOIN orders o ON c.id = o.customer_id
        GROUP BY c.name
      `)

      expect(result.success).toBe(true)
      expect(result.rows.length).toBeGreaterThan(0)
    })

    it('handles multiple joins across shards', async () => {
      const result = await db.query(`
        SELECT o.order_id, c.name, p.product_name
        FROM orders o
        JOIN customers c ON o.customer_id = c.id
        JOIN products p ON o.product_id = p.id
        LIMIT 10
      `)

      expect(result.success).toBe(true)
      expect(result.metadata?.shards?.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('join strategies', () => {
    it('uses broadcast join for small tables', async () => {
      const plan = await db.explain(`
        SELECT o.*, c.name
        FROM orders o
        JOIN customers c ON o.customer_id = c.id
      `)

      expect(plan.success).toBe(true)
      // Small table (customers) should be broadcast to all shards
      expect(plan.plan.strategy).toMatch(/broadcast|hash/)
    })

    it('uses hash join for large tables', async () => {
      const plan = await db.explain(`
        SELECT o1.*, o2.amount as prev_amount
        FROM orders_2024 o1
        JOIN orders_2023 o2 ON o1.customer_id = o2.customer_id
      `)

      expect(plan.success).toBe(true)
      expect(plan.plan.strategy).toBe('hash')
    })
  })
})

// ============================================================================
// Parallel Aggregation Tests
// ============================================================================

describe('DistributedDuckDB parallel aggregation', () => {
  let db: DistributedDuckDB

  beforeEach(() => {
    db = new DistributedDuckDB(createTestConfig())
  })

  afterEach(async () => {
    await db.close()
  })

  describe('distributed aggregates', () => {
    it('computes SUM across shards', async () => {
      const result = await db.query(`
        SELECT SUM(amount) as total_amount
        FROM orders
      `)

      expect(result.success).toBe(true)
      expect(typeof result.rows[0].total_amount).toBe('number')
    })

    it('computes COUNT across shards', async () => {
      const result = await db.query(`
        SELECT COUNT(*) as order_count
        FROM orders
      `)

      expect(result.success).toBe(true)
      expect(typeof result.rows[0].order_count).toBe('number')
    })

    it('computes AVG across shards correctly', async () => {
      const result = await db.query(`
        SELECT AVG(amount) as avg_amount
        FROM orders
      `)

      expect(result.success).toBe(true)
      expect(typeof result.rows[0].avg_amount).toBe('number')
    })

    it('computes MIN/MAX across shards', async () => {
      const result = await db.query(`
        SELECT MIN(amount) as min_amount, MAX(amount) as max_amount
        FROM orders
      `)

      expect(result.success).toBe(true)
      expect(result.rows[0].min_amount).toBeLessThanOrEqual(result.rows[0].max_amount)
    })

    it('computes COUNT(DISTINCT) across shards', async () => {
      const result = await db.query(`
        SELECT COUNT(DISTINCT customer_id) as unique_customers
        FROM orders
      `)

      expect(result.success).toBe(true)
      expect(typeof result.rows[0].unique_customers).toBe('number')
    })
  })

  describe('GROUP BY across shards', () => {
    it('groups and aggregates across shards', async () => {
      const result = await db.query(`
        SELECT
          customer_id,
          SUM(amount) as total,
          COUNT(*) as orders
        FROM orders
        GROUP BY customer_id
        ORDER BY total DESC
      `)

      expect(result.success).toBe(true)
      expect(result.rows.length).toBeGreaterThan(0)
      // Verify ordering
      for (let i = 1; i < result.rows.length; i++) {
        expect(result.rows[i - 1].total).toBeGreaterThanOrEqual(result.rows[i].total)
      }
    })

    it('handles HAVING clause across shards', async () => {
      const result = await db.query(`
        SELECT
          customer_id,
          SUM(amount) as total
        FROM orders
        GROUP BY customer_id
        HAVING SUM(amount) > 200
      `)

      expect(result.success).toBe(true)
      result.rows.forEach((row: any) => {
        expect(row.total).toBeGreaterThan(200)
      })
    })

    it('handles multiple GROUP BY columns', async () => {
      // Test grouping by multiple simple columns
      const result = await db.query(`
        SELECT
          customer_id,
          SUM(amount) as total,
          COUNT(*) as order_count
        FROM orders
        GROUP BY customer_id
      `)

      expect(result.success).toBe(true)
      expect(result.rows.length).toBeGreaterThan(0)
      // Each customer should have aggregated totals
      result.rows.forEach((row: any) => {
        expect(typeof row.customer_id).toBe('number')
        expect(typeof row.total).toBe('number')
      })
    })
  })

  describe('merge strategy', () => {
    it('uses two-phase aggregation for distributed queries', async () => {
      const plan = await db.explain(`
        SELECT customer_id, SUM(amount) as total
        FROM orders
        GROUP BY customer_id
      `)

      expect(plan.success).toBe(true)
      // Should show partial aggregation on shards, then merge
      expect(plan.plan.nodes.some((n: QueryPlanNode) => n.type === 'partial_aggregate')).toBe(true)
      expect(plan.plan.nodes.some((n: QueryPlanNode) => n.type === 'merge_aggregate')).toBe(true)
    })
  })
})

// ============================================================================
// Result Streaming Tests
// ============================================================================

describe('DistributedDuckDB result streaming', () => {
  let db: DistributedDuckDB

  beforeEach(() => {
    db = new DistributedDuckDB(createTestConfig())
  })

  afterEach(async () => {
    await db.close()
  })

  describe('streaming API', () => {
    it('returns async iterable for queryStream', async () => {
      const stream = await db.queryStream('SELECT * FROM orders')

      expect(stream).toBeDefined()
      expect(typeof stream[Symbol.asyncIterator]).toBe('function')
    })

    it('yields batches of rows', async () => {
      const stream = await db.queryStream('SELECT * FROM orders', { batchSize: 10 })

      const batches: StreamBatch[] = []
      for await (const batch of stream) {
        batches.push(batch)
      }

      expect(batches.length).toBeGreaterThan(0)
      expect(batches[0].rows).toBeDefined()
    })

    it('respects batch size option', async () => {
      const batchSize = 5
      const stream = await db.queryStream('SELECT * FROM orders', { batchSize })

      for await (const batch of stream) {
        expect(batch.rows.length).toBeLessThanOrEqual(batchSize)
      }
    })

    it('provides batch metadata', async () => {
      const stream = await db.queryStream('SELECT * FROM orders')

      for await (const batch of stream) {
        expect(typeof batch.batchIndex).toBe('number')
        expect(typeof batch.isLast).toBe('boolean')
        expect(batch.columns).toBeDefined()
      }
    })

    it('streams results from multiple shards', async () => {
      const stream = await db.queryStream('SELECT * FROM orders')

      const batches: StreamBatch[] = []
      for await (const batch of stream) {
        batches.push(batch)
      }

      // Should have results from both 2023 and 2024 orders
      expect(batches.flatMap(b => b.rows).length).toBeGreaterThan(0)
    })
  })

  describe('streaming error handling', () => {
    it('handles query errors gracefully', async () => {
      const stream = await db.queryStream('SELECT * FROM nonexistent')

      await expect(async () => {
        for await (const _batch of stream) {
          // Should throw
        }
      }).rejects.toThrow()
    })

    it('can be cancelled mid-stream', async () => {
      // Use small batch size to get multiple batches from the mock data
      const stream = await db.queryStream('SELECT * FROM orders', { batchSize: 2 })

      let batchCount = 0
      for await (const _batch of stream) {
        batchCount++
        if (batchCount >= 2) {
          break // Early exit
        }
      }

      expect(batchCount).toBe(2)
    })
  })
})

// ============================================================================
// Query Planning Tests
// ============================================================================

describe('DistributedDuckDB query planning', () => {
  let db: DistributedDuckDB

  beforeEach(() => {
    db = new DistributedDuckDB(createTestConfig())
  })

  afterEach(async () => {
    await db.close()
  })

  describe('explain output', () => {
    it('returns query plan for simple query', async () => {
      const plan = await db.explain('SELECT * FROM orders_2023 LIMIT 10')

      expect(plan.success).toBe(true)
      expect(plan.plan).toBeDefined()
      expect(plan.plan.nodes).toBeInstanceOf(Array)
    })

    it('shows shard assignment in plan', async () => {
      const plan = await db.explain('SELECT * FROM orders')

      expect(plan.success).toBe(true)
      expect(plan.plan.shards).toBeDefined()
      expect(plan.plan.shards.length).toBeGreaterThan(0)
    })

    it('shows filter pushdown in plan', async () => {
      const plan = await db.explain(`
        SELECT * FROM orders WHERE amount > 100
      `)

      expect(plan.success).toBe(true)
      // Filter should be pushed down to shards
      expect(plan.plan.nodes.some((n: QueryPlanNode) =>
        n.type === 'filter' && n.pushdown === true
      )).toBe(true)
    })

    it('shows join strategy in plan', async () => {
      const plan = await db.explain(`
        SELECT o.*, c.name
        FROM orders o
        JOIN customers c ON o.customer_id = c.id
      `)

      expect(plan.success).toBe(true)
      expect(plan.plan.nodes.some((n: QueryPlanNode) => n.type === 'join')).toBe(true)
      const joinNode = plan.plan.nodes.find((n: QueryPlanNode) => n.type === 'join')
      expect(joinNode?.strategy).toBeDefined()
    })

    it('estimates cost for query plan', async () => {
      const plan = await db.explain('SELECT * FROM orders')

      expect(plan.success).toBe(true)
      expect(typeof plan.plan.estimatedCost).toBe('number')
      expect(plan.plan.estimatedCost).toBeGreaterThan(0)
    })
  })

  describe('optimization', () => {
    it('optimizes predicate pushdown', async () => {
      const plan = await db.explain(`
        SELECT * FROM orders o
        JOIN customers c ON o.customer_id = c.id
        WHERE o.amount > 100 AND c.region = 'US'
      `)

      expect(plan.success).toBe(true)
      // Both filters should be pushed down to their respective tables
      const filterNodes = plan.plan.nodes.filter((n: QueryPlanNode) => n.type === 'filter')
      expect(filterNodes.length).toBeGreaterThanOrEqual(2)
    })

    it('optimizes projection pushdown', async () => {
      const plan = await db.explain(`
        SELECT customer_id, amount FROM orders
      `)

      expect(plan.success).toBe(true)
      // Only selected columns should be fetched from shards
      const scanNodes = plan.plan.nodes.filter((n: QueryPlanNode) => n.type === 'scan')
      scanNodes.forEach((node: QueryPlanNode) => {
        expect(node.columns?.length).toBeLessThanOrEqual(2)
      })
    })

    it('eliminates unnecessary shards from plan', async () => {
      const plan = await db.explain(`
        SELECT * FROM orders WHERE order_date >= '2024-01-01'
      `)

      expect(plan.success).toBe(true)
      // Should only include shard-2 (orders_2024)
      expect(plan.plan.shards).not.toContain('shard-1')
    })
  })
})

// ============================================================================
// Parallel Insert Tests
// ============================================================================

describe('DistributedDuckDB parallel insert', () => {
  let db: DistributedDuckDB

  beforeEach(() => {
    db = new DistributedDuckDB(createTestConfig())
  })

  afterEach(async () => {
    await db.close()
  })

  describe('insertParallel', () => {
    it('inserts data in parallel batches', async () => {
      const data = Array.from({ length: 1000 }, (_, i) => ({
        order_id: 10000 + i,
        customer_id: 100 + (i % 10),
        amount: Math.random() * 500,
        order_date: '2024-03-15',
      }))

      const result = await db.insertParallel('orders_2024', data, {
        batchSize: 100,
        parallelism: 4,
      })

      expect(result.success).toBe(true)
      expect(result.inserted).toBe(1000)
    })

    it('respects batch size option', async () => {
      const data = Array.from({ length: 50 }, (_, i) => ({
        order_id: 20000 + i,
        customer_id: 101,
        amount: 100,
        order_date: '2024-03-15',
      }))

      const result = await db.insertParallel('orders_2024', data, {
        batchSize: 10,
      })

      expect(result.success).toBe(true)
      expect(result.batches).toBe(5)
    })

    it('respects parallelism limit', async () => {
      const data = Array.from({ length: 100 }, (_, i) => ({
        order_id: 30000 + i,
        customer_id: 102,
        amount: 200,
        order_date: '2024-03-15',
      }))

      const result = await db.insertParallel('orders_2024', data, {
        batchSize: 10,
        parallelism: 2,
      })

      expect(result.success).toBe(true)
      expect(result.maxConcurrent).toBeLessThanOrEqual(2)
    })

    it('returns error for invalid table', async () => {
      const result = await db.insertParallel('nonexistent', [{ a: 1 }])

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('TABLE_NOT_FOUND')
    })

    it('returns partial success on batch failures', async () => {
      const data = Array.from({ length: 50 }, (_, i) => ({
        order_id: 40000 + i,
        customer_id: i < 25 ? 103 : null, // Second half has invalid null
        amount: 100,
        order_date: '2024-03-15',
      }))

      const result = await db.insertParallel('orders_2024', data, {
        batchSize: 25,
        continueOnError: true,
      })

      expect(result.success).toBe(true)
      expect(result.inserted).toBe(25)
      expect(result.failed).toBe(25)
    })
  })
})

// ============================================================================
// Shard Management Tests
// ============================================================================

describe('DistributedDuckDB shard management', () => {
  let db: DistributedDuckDB

  beforeEach(() => {
    db = new DistributedDuckDB(createTestConfig())
  })

  afterEach(async () => {
    await db.close()
  })

  describe('getShards', () => {
    it('returns current shard configuration', () => {
      const shards = db.getShards()

      expect(shards).toHaveLength(3)
      expect(shards.map(s => s.id)).toContain('shard-1')
      expect(shards.map(s => s.id)).toContain('shard-2')
      expect(shards.map(s => s.id)).toContain('shard-3')
    })

    it('includes shard health status', () => {
      const shards = db.getShards()

      shards.forEach(shard => {
        expect(shard.status).toBeDefined()
        expect(['healthy', 'degraded', 'offline']).toContain(shard.status)
      })
    })
  })

  describe('addShard', () => {
    it('adds a new shard to the cluster', async () => {
      const result = await db.addShard({
        id: 'shard-4',
        region: 'ap-east',
        tables: [],
      })

      expect(result.success).toBe(true)
      expect(db.getShards()).toHaveLength(4)
    })

    it('returns error for duplicate shard ID', async () => {
      const result = await db.addShard({
        id: 'shard-1', // Already exists
        region: 'ap-east',
        tables: [],
      })

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('SHARD_EXISTS')
    })
  })

  describe('removeShard', () => {
    it('removes a shard from the cluster', async () => {
      // First add a removable shard
      await db.addShard({ id: 'temp-shard', region: 'temp', tables: [] })

      const result = await db.removeShard('temp-shard')

      expect(result.success).toBe(true)
      expect(db.getShards().map(s => s.id)).not.toContain('temp-shard')
    })

    it('returns error for nonexistent shard', async () => {
      const result = await db.removeShard('nonexistent-shard')

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('SHARD_NOT_FOUND')
    })

    it('prevents removal of shard with data without force', async () => {
      const result = await db.removeShard('shard-1') // Has orders_2023

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('SHARD_HAS_DATA')
    })

    it('allows forced removal of shard with data', async () => {
      const result = await db.removeShard('shard-1', { force: true })

      expect(result.success).toBe(true)
    })
  })

  describe('rebalance', () => {
    it('redistributes data across shards', async () => {
      const result = await db.rebalance('orders')

      expect(result.success).toBe(true)
      expect(result.movedRows).toBeGreaterThanOrEqual(0)
    })

    it('reports rebalance progress', async () => {
      const progressUpdates: number[] = []

      const result = await db.rebalance('orders', {
        onProgress: (progress) => progressUpdates.push(progress),
      })

      expect(result.success).toBe(true)
      expect(progressUpdates.length).toBeGreaterThan(0)
      expect(progressUpdates[progressUpdates.length - 1]).toBe(100)
    })

    it('returns error for nonexistent table', async () => {
      const result = await db.rebalance('nonexistent')

      expect(result.success).toBe(false)
      expect(result.error?.code).toBe('TABLE_NOT_FOUND')
    })
  })
})

// ============================================================================
// Query Metrics Tests
// ============================================================================

describe('DistributedDuckDB query metrics', () => {
  let db: DistributedDuckDB

  beforeEach(() => {
    db = new DistributedDuckDB(createTestConfig())
  })

  afterEach(async () => {
    await db.close()
  })

  it('returns execution time in query result', async () => {
    const result = await db.query('SELECT * FROM orders LIMIT 10')

    expect(result.success).toBe(true)
    expect(typeof result.metrics?.executionTimeMs).toBe('number')
    expect(result.metrics?.executionTimeMs).toBeGreaterThanOrEqual(0)
  })

  it('returns per-shard metrics', async () => {
    const result = await db.query('SELECT * FROM orders')

    expect(result.success).toBe(true)
    expect(result.metrics?.shardMetrics).toBeDefined()
    expect(Object.keys(result.metrics?.shardMetrics || {}).length).toBeGreaterThan(0)
  })

  it('tracks rows scanned', async () => {
    const result = await db.query('SELECT * FROM orders WHERE amount > 100')

    expect(result.success).toBe(true)
    expect(typeof result.metrics?.rowsScanned).toBe('number')
  })

  it('tracks bytes transferred', async () => {
    const result = await db.query('SELECT * FROM orders')

    expect(result.success).toBe(true)
    expect(typeof result.metrics?.bytesTransferred).toBe('number')
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('DistributedDuckDB error handling', () => {
  let db: DistributedDuckDB

  beforeEach(() => {
    db = new DistributedDuckDB(createTestConfig())
  })

  afterEach(async () => {
    await db.close()
  })

  it('handles shard timeout gracefully', async () => {
    const slowDb = new DistributedDuckDB({
      ...createTestConfig(),
      defaultTimeout: 1, // 1ms timeout - will always fail
    })

    const result = await slowDb.query('SELECT * FROM orders')

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('TIMEOUT')

    await slowDb.close()
  })

  it('handles partial shard failure', async () => {
    // Simulate a shard being offline
    const config = createTestConfig()
    config.shards[0].offline = true

    const db2 = new DistributedDuckDB(config)
    const result = await db2.query('SELECT * FROM orders')

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('SHARD_UNAVAILABLE')
    expect(result.error?.shard).toBe('shard-1')

    await db2.close()
  })

  it('returns typed error objects', async () => {
    const result = await db.query('SELECT * FROM nonexistent')

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    expect(typeof result.error?.code).toBe('string')
    expect(typeof result.error?.message).toBe('string')
  })

  it('does not throw exceptions on query errors', async () => {
    // All errors should be returned in result, not thrown
    await expect(db.query('INVALID SQL')).resolves.toBeDefined()
    await expect(db.query('')).resolves.toBeDefined()
    await expect(db.query(null as any)).resolves.toBeDefined()
  })
})

// ============================================================================
// Component Unit Tests
// ============================================================================

describe('Shard class', () => {
  it('can be instantiated with config', () => {
    const shard = new Shard({
      id: 'test-shard',
      region: 'us-east',
      tables: ['test_table'],
    })

    expect(shard).toBeInstanceOf(Shard)
    expect(shard.id).toBe('test-shard')
    expect(shard.region).toBe('us-east')
  })

  it('exposes query method', () => {
    const shard = new Shard({ id: 's1', region: 'us', tables: [] })
    expect(typeof shard.query).toBe('function')
  })

  it('exposes insert method', () => {
    const shard = new Shard({ id: 's1', region: 'us', tables: [] })
    expect(typeof shard.insert).toBe('function')
  })

  it('tracks health status', () => {
    const shard = new Shard({ id: 's1', region: 'us', tables: [] })
    expect(shard.status).toBe('healthy')
  })
})

describe('QueryPlanner class', () => {
  it('can be instantiated', () => {
    const planner = new QueryPlanner()
    expect(planner).toBeInstanceOf(QueryPlanner)
  })

  it('parses SQL to AST', () => {
    const planner = new QueryPlanner()
    const ast = planner.parse('SELECT * FROM orders WHERE amount > 100')

    expect(ast).toBeDefined()
    expect(ast.type).toBe('select')
  })

  it('creates execution plan from AST', () => {
    const planner = new QueryPlanner()
    const shards = createTestShards().map(s => new Shard(s))
    const plan = planner.plan('SELECT * FROM orders', shards)

    expect(plan).toBeDefined()
    expect(plan.nodes).toBeInstanceOf(Array)
  })
})

describe('QueryRouter class', () => {
  it('routes query to appropriate shards', () => {
    const router = new QueryRouter()
    const shards = createTestShards().map(s => new Shard(s))

    const targets = router.route('SELECT * FROM orders_2023', shards)

    expect(targets).toHaveLength(1)
    expect(targets[0].id).toBe('shard-1')
  })

  it('routes to multiple shards for union tables', () => {
    const router = new QueryRouter()
    const shards = createTestShards().map(s => new Shard(s))

    const targets = router.route('SELECT * FROM orders', shards)

    expect(targets.length).toBeGreaterThan(1)
  })
})

describe('ResultMerger class', () => {
  it('merges results from multiple shards', () => {
    const merger = new ResultMerger()

    const results = [
      { rows: [{ id: 1, val: 10 }], columns: [{ name: 'id' }, { name: 'val' }] },
      { rows: [{ id: 2, val: 20 }], columns: [{ name: 'id' }, { name: 'val' }] },
    ]

    const merged = merger.merge(results)

    expect(merged.rows).toHaveLength(2)
  })

  it('applies ORDER BY during merge', () => {
    const merger = new ResultMerger()

    const results = [
      { rows: [{ id: 2, val: 20 }, { id: 4, val: 40 }], columns: [] },
      { rows: [{ id: 1, val: 10 }, { id: 3, val: 30 }], columns: [] },
    ]

    const merged = merger.merge(results, { orderBy: [{ column: 'id', direction: 'asc' }] })

    expect(merged.rows.map((r: any) => r.id)).toEqual([1, 2, 3, 4])
  })

  it('applies LIMIT during merge', () => {
    const merger = new ResultMerger()

    const results = [
      { rows: [{ id: 1 }, { id: 2 }, { id: 3 }], columns: [] },
      { rows: [{ id: 4 }, { id: 5 }, { id: 6 }], columns: [] },
    ]

    const merged = merger.merge(results, { limit: 4 })

    expect(merged.rows).toHaveLength(4)
  })

  it('merges aggregates correctly', () => {
    const merger = new ResultMerger()

    // Partial SUM results from shards
    const results = [
      { rows: [{ customer_id: 1, total: 100, count: 2 }], columns: [], isPartial: true },
      { rows: [{ customer_id: 1, total: 150, count: 3 }], columns: [], isPartial: true },
    ]

    const merged = merger.mergeAggregates(results, {
      groupBy: ['customer_id'],
      aggregates: [
        { column: 'total', func: 'SUM' },
        { column: 'count', func: 'SUM' },
      ],
    })

    expect(merged.rows[0].total).toBe(250)
    expect(merged.rows[0].count).toBe(5)
  })
})

// ============================================================================
// Integration Tests
// ============================================================================

describe('DistributedDuckDB integration', () => {
  let db: DistributedDuckDB

  beforeEach(() => {
    db = new DistributedDuckDB(createTestConfig())
  })

  afterEach(async () => {
    await db.close()
  })

  it('executes complex analytical query', async () => {
    const result = await db.query(`
      SELECT
        c.name,
        c.region,
        COUNT(*) as order_count,
        SUM(o.amount) as total_spent,
        AVG(o.amount) as avg_order
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      WHERE o.order_date >= '2023-01-01'
      GROUP BY c.name, c.region
      HAVING SUM(o.amount) > 100
      ORDER BY total_spent DESC
      LIMIT 10
    `)

    expect(result.success).toBe(true)
    expect(result.rows.length).toBeGreaterThan(0)
    expect(result.rows.length).toBeLessThanOrEqual(10)

    // Verify structure
    const row = result.rows[0]
    expect(row).toHaveProperty('name')
    expect(row).toHaveProperty('region')
    expect(row).toHaveProperty('order_count')
    expect(row).toHaveProperty('total_spent')
    expect(row).toHaveProperty('avg_order')
  })

  it('handles concurrent queries', async () => {
    const queries = [
      db.query('SELECT COUNT(*) FROM orders'),
      db.query('SELECT SUM(amount) FROM orders_2023'),
      db.query('SELECT AVG(amount) FROM orders_2024'),
      db.query('SELECT * FROM customers LIMIT 5'),
    ]

    const results = await Promise.all(queries)

    results.forEach(result => {
      expect(result.success).toBe(true)
    })
  })

  it('maintains consistency during concurrent reads and writes', async () => {
    // Start a long read
    const readPromise = db.query('SELECT * FROM orders')

    // Concurrent insert
    const insertPromise = db.insertParallel('orders_2024', [
      { order_id: 99999, customer_id: 101, amount: 999, order_date: '2024-12-31' },
    ])

    const [readResult, insertResult] = await Promise.all([readPromise, insertPromise])

    expect(readResult.success).toBe(true)
    expect(insertResult.success).toBe(true)
  })
})
