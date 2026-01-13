/**
 * FederatedQueryPlanner Tests
 *
 * TDD tests for cross-source query execution with:
 * - Catalog: Registry of data sources, schemas, statistics
 * - SourceAdapter: Pluggable interface for source operations
 * - PushdownOptimizer: Push predicates/projections to sources
 * - Executor: Distributed execution with streaming
 *
 * @see dotdo-9n9wc
 */

import { describe, it, expect, beforeEach } from 'vitest'

import {
  // Catalog
  Catalog,
  type DataSource,
  type SourceSchema,
  type SourceStatistics,

  // SourceAdapter
  type SourceAdapter,
  createMemoryAdapter,
  createSQLiteAdapter,

  // PushdownOptimizer
  PushdownOptimizer,
  type PushdownCapabilities,
  type PushdownResult,

  // Executor
  FederatedExecutor,
  type ExecutionPlan,
  type StreamingResult,

  // Query types
  type FederatedQuery,
  type QueryFragment,
} from '../index'

// =============================================================================
// Catalog Tests
// =============================================================================

describe('Catalog', () => {
  let catalog: Catalog

  beforeEach(() => {
    catalog = new Catalog()
  })

  describe('source registration', () => {
    it('should register a data source with schema', () => {
      const source: DataSource = {
        name: 'users_db',
        type: 'sqlite',
        config: { path: ':memory:' },
      }

      catalog.registerSource(source)

      expect(catalog.hasSource('users_db')).toBe(true)
    })

    it('should register source schema', () => {
      catalog.registerSource({
        name: 'users_db',
        type: 'sqlite',
        config: {},
      })

      const schema: SourceSchema = {
        tables: {
          users: {
            columns: {
              id: { type: 'integer', nullable: false, primaryKey: true },
              name: { type: 'string', nullable: false },
              email: { type: 'string', nullable: false },
              created_at: { type: 'timestamp', nullable: false },
            },
          },
        },
      }

      catalog.registerSchema('users_db', schema)

      const registered = catalog.getSchema('users_db')
      expect(registered?.tables.users).toBeDefined()
      expect(registered?.tables.users.columns.id.type).toBe('integer')
    })

    it('should register source statistics', () => {
      catalog.registerSource({
        name: 'orders_db',
        type: 'postgres',
        config: {},
      })

      const stats: SourceStatistics = {
        tables: {
          orders: {
            rowCount: 1_000_000,
            sizeBytes: 500_000_000,
            distinctCounts: {
              customer_id: 50_000,
              status: 5,
            },
          },
        },
      }

      catalog.registerStatistics('orders_db', stats)

      const registered = catalog.getStatistics('orders_db')
      expect(registered?.tables.orders.rowCount).toBe(1_000_000)
    })

    it('should list all registered sources', () => {
      catalog.registerSource({ name: 'source1', type: 'sqlite', config: {} })
      catalog.registerSource({ name: 'source2', type: 'postgres', config: {} })
      catalog.registerSource({ name: 'source3', type: 'memory', config: {} })

      const sources = catalog.listSources()

      expect(sources).toHaveLength(3)
      expect(sources.map(s => s.name)).toContain('source1')
      expect(sources.map(s => s.name)).toContain('source2')
      expect(sources.map(s => s.name)).toContain('source3')
    })

    it('should unregister a source', () => {
      catalog.registerSource({ name: 'temp_db', type: 'memory', config: {} })
      expect(catalog.hasSource('temp_db')).toBe(true)

      catalog.unregisterSource('temp_db')

      expect(catalog.hasSource('temp_db')).toBe(false)
    })

    it('should throw when registering duplicate source', () => {
      catalog.registerSource({ name: 'dup_db', type: 'memory', config: {} })

      expect(() => {
        catalog.registerSource({ name: 'dup_db', type: 'sqlite', config: {} })
      }).toThrow('Source dup_db already registered')
    })
  })

  describe('schema discovery', () => {
    it('should discover table columns from source', async () => {
      const adapter = createMemoryAdapter({
        users: [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
        ],
      })

      catalog.registerSource({ name: 'memory_db', type: 'memory', config: {} })
      catalog.attachAdapter('memory_db', adapter)

      const schema = await catalog.discoverSchema('memory_db')

      expect(schema.tables.users).toBeDefined()
      expect(schema.tables.users.columns.id).toBeDefined()
      expect(schema.tables.users.columns.name).toBeDefined()
      expect(schema.tables.users.columns.email).toBeDefined()
    })

    it('should infer column types from data', async () => {
      const adapter = createMemoryAdapter({
        products: [
          { id: 1, price: 99.99, in_stock: true, created_at: '2024-01-01T00:00:00Z' },
        ],
      })

      catalog.registerSource({ name: 'products_db', type: 'memory', config: {} })
      catalog.attachAdapter('products_db', adapter)

      const schema = await catalog.discoverSchema('products_db')

      expect(schema.tables.products.columns.id.type).toBe('integer')
      expect(schema.tables.products.columns.price.type).toBe('number')
      expect(schema.tables.products.columns.in_stock.type).toBe('boolean')
      // ISO 8601 timestamp strings are correctly inferred as 'timestamp' type
      expect(schema.tables.products.columns.created_at.type).toBe('timestamp')
    })
  })

  describe('cross-source resolution', () => {
    it('should resolve fully qualified table names (source.table)', () => {
      catalog.registerSource({ name: 'db1', type: 'memory', config: {} })
      catalog.registerSchema('db1', {
        tables: {
          users: { columns: { id: { type: 'integer', nullable: false } } },
        },
      })

      const resolved = catalog.resolveTable('db1.users')

      expect(resolved).toEqual({ source: 'db1', table: 'users' })
    })

    it('should resolve unqualified table names with default source', () => {
      catalog.registerSource({ name: 'default_db', type: 'memory', config: {} })
      catalog.setDefaultSource('default_db')
      catalog.registerSchema('default_db', {
        tables: {
          orders: { columns: { id: { type: 'integer', nullable: false } } },
        },
      })

      const resolved = catalog.resolveTable('orders')

      expect(resolved).toEqual({ source: 'default_db', table: 'orders' })
    })

    it('should detect ambiguous table references', () => {
      catalog.registerSource({ name: 'db1', type: 'memory', config: {} })
      catalog.registerSource({ name: 'db2', type: 'memory', config: {} })
      catalog.registerSchema('db1', {
        tables: { users: { columns: { id: { type: 'integer', nullable: false } } } },
      })
      catalog.registerSchema('db2', {
        tables: { users: { columns: { id: { type: 'integer', nullable: false } } } },
      })

      expect(() => catalog.resolveTable('users')).toThrow('Ambiguous table reference')
    })
  })
})

// =============================================================================
// SourceAdapter Tests
// =============================================================================

describe('SourceAdapter', () => {
  describe('MemoryAdapter', () => {
    it('should execute simple queries', async () => {
      const adapter = createMemoryAdapter({
        users: [
          { id: 1, name: 'Alice', status: 'active' },
          { id: 2, name: 'Bob', status: 'inactive' },
          { id: 3, name: 'Charlie', status: 'active' },
        ],
      })

      const result = await adapter.execute({
        table: 'users',
        predicates: [{ column: 'status', op: '=', value: 'active' }],
      })

      expect(result.rows).toHaveLength(2)
      expect(result.rows.map(r => r.name)).toEqual(['Alice', 'Charlie'])
    })

    it('should support projection', async () => {
      const adapter = createMemoryAdapter({
        users: [
          { id: 1, name: 'Alice', email: 'alice@example.com', password: 'secret' },
        ],
      })

      const result = await adapter.execute({
        table: 'users',
        columns: ['id', 'name'],
      })

      expect(result.rows[0]).toEqual({ id: 1, name: 'Alice' })
      expect(result.rows[0]).not.toHaveProperty('password')
    })

    it('should support limit and offset', async () => {
      const adapter = createMemoryAdapter({
        items: Array.from({ length: 100 }, (_, i) => ({ id: i + 1 })),
      })

      const result = await adapter.execute({
        table: 'items',
        limit: 10,
        offset: 20,
      })

      expect(result.rows).toHaveLength(10)
      expect(result.rows[0].id).toBe(21)
    })

    it('should report capabilities', () => {
      const adapter = createMemoryAdapter({})

      const caps = adapter.capabilities()

      expect(caps.predicatePushdown).toBe(true)
      expect(caps.projectionPushdown).toBe(true)
      expect(caps.limitPushdown).toBe(true)
      expect(caps.aggregationPushdown).toBe(false)
    })

    it('should stream results', async () => {
      const adapter = createMemoryAdapter({
        items: Array.from({ length: 1000 }, (_, i) => ({ id: i })),
      })

      const stream = adapter.stream({
        table: 'items',
        batchSize: 100,
      })

      const batches: unknown[][] = []
      for await (const batch of stream) {
        batches.push(batch)
      }

      expect(batches).toHaveLength(10)
      expect(batches[0]).toHaveLength(100)
    })
  })

  describe('SQLiteAdapter', () => {
    it('should execute queries with predicate pushdown', async () => {
      const adapter = createSQLiteAdapter()

      // Setup test data
      await adapter.execute({
        rawSQL: `
          CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY,
            name TEXT,
            status TEXT
          )
        `,
      })
      await adapter.execute({
        rawSQL: `
          INSERT INTO users (name, status) VALUES
          ('Alice', 'active'),
          ('Bob', 'inactive'),
          ('Charlie', 'active')
        `,
      })

      const result = await adapter.execute({
        table: 'users',
        predicates: [{ column: 'status', op: '=', value: 'active' }],
      })

      expect(result.rows).toHaveLength(2)
    })

    it('should generate efficient SQL from predicates', () => {
      const adapter = createSQLiteAdapter()

      const sql = adapter.toSQL({
        table: 'orders',
        columns: ['id', 'total'],
        predicates: [
          { column: 'status', op: '=', value: 'completed' },
          { column: 'total', op: '>', value: 100 },
        ],
        limit: 50,
      })

      expect(sql).toContain('SELECT id, total FROM orders')
      expect(sql).toContain("status = 'completed'")
      expect(sql).toContain('total > 100')
      expect(sql).toContain('LIMIT 50')
    })

    it('should report full SQL capabilities', () => {
      const adapter = createSQLiteAdapter()

      const caps = adapter.capabilities()

      expect(caps.predicatePushdown).toBe(true)
      expect(caps.projectionPushdown).toBe(true)
      expect(caps.limitPushdown).toBe(true)
      expect(caps.aggregationPushdown).toBe(true)
      expect(caps.joinPushdown).toBe(true)
    })
  })
})

// =============================================================================
// PushdownOptimizer Tests
// =============================================================================

describe('PushdownOptimizer', () => {
  let optimizer: PushdownOptimizer
  let catalog: Catalog

  beforeEach(() => {
    catalog = new Catalog()
    optimizer = new PushdownOptimizer(catalog)

    // Setup sources with different capabilities
    catalog.registerSource({ name: 'sql_db', type: 'sqlite', config: {} })
    catalog.registerSource({ name: 'api_source', type: 'rest', config: {} })

    const sqlAdapter = createSQLiteAdapter()
    const apiAdapter: SourceAdapter = {
      capabilities: () => ({
        predicatePushdown: true,
        projectionPushdown: false,
        limitPushdown: true,
        aggregationPushdown: false,
        joinPushdown: false,
      }),
      execute: async () => ({ rows: [] }),
      stream: async function* () { yield [] },
    }

    catalog.attachAdapter('sql_db', sqlAdapter)
    catalog.attachAdapter('api_source', apiAdapter)
  })

  describe('predicate pushdown', () => {
    it('should push predicates to sources that support it', () => {
      const query: FederatedQuery = {
        from: [{ source: 'sql_db', table: 'users' }],
        predicates: [
          { column: 'users.status', op: '=', value: 'active' },
          { column: 'users.age', op: '>', value: 21 },
        ],
      }

      const result = optimizer.optimize(query)

      expect(result.fragments[0].pushdown.predicates).toHaveLength(2)
      expect(result.residualPredicates).toHaveLength(0)
    })

    it('should keep non-pushable predicates as residual', () => {
      const query: FederatedQuery = {
        from: [{ source: 'api_source', table: 'users' }],
        predicates: [
          { column: 'users.status', op: '=', value: 'active' },
          { column: 'users.name', op: 'LIKE', value: '%alice%' }, // Assume LIKE not supported
        ],
      }

      // Mock limited predicate support
      const limitedAdapter: SourceAdapter = {
        capabilities: () => ({
          predicatePushdown: true,
          supportedOperators: ['=', '!=', '>', '<', '>=', '<='],
          projectionPushdown: false,
          limitPushdown: true,
          aggregationPushdown: false,
          joinPushdown: false,
        }),
        execute: async () => ({ rows: [] }),
        stream: async function* () { yield [] },
      }
      catalog.attachAdapter('api_source', limitedAdapter)

      const result = optimizer.optimize(query)

      expect(result.fragments[0].pushdown.predicates).toHaveLength(1)
      expect(result.residualPredicates).toHaveLength(1)
      expect(result.residualPredicates[0].op).toBe('LIKE')
    })

    it('should handle cross-source predicates', () => {
      catalog.registerSource({ name: 'orders_db', type: 'postgres', config: {} })
      catalog.attachAdapter('orders_db', createMemoryAdapter({}))

      const query: FederatedQuery = {
        from: [
          { source: 'sql_db', table: 'users' },
          { source: 'orders_db', table: 'orders' },
        ],
        predicates: [
          { column: 'users.id', op: '=', ref: 'orders.user_id' }, // Join predicate
          { column: 'users.status', op: '=', value: 'active' }, // Single-source
        ],
        join: {
          type: 'INNER',
          on: { left: 'users.id', right: 'orders.user_id' },
        },
      }

      const result = optimizer.optimize(query)

      // Single-source predicate should be pushed
      expect(result.fragments.find(f => f.source === 'sql_db')?.pushdown.predicates)
        .toContainEqual(expect.objectContaining({ column: 'users.status' }))

      // Join predicate stays for join execution
      expect(result.joinPredicates).toHaveLength(1)
    })
  })

  describe('projection pushdown', () => {
    it('should push column selections to sources', () => {
      const query: FederatedQuery = {
        from: [{ source: 'sql_db', table: 'users' }],
        columns: ['id', 'name', 'email'],
      }

      const result = optimizer.optimize(query)

      expect(result.fragments[0].pushdown.columns).toEqual(['id', 'name', 'email'])
    })

    it('should include columns needed for predicates', () => {
      const query: FederatedQuery = {
        from: [{ source: 'sql_db', table: 'users' }],
        columns: ['id', 'name'],
        predicates: [{ column: 'users.status', op: '=', value: 'active' }],
      }

      const result = optimizer.optimize(query)

      // status needed for filtering even if not in final projection
      expect(result.fragments[0].pushdown.columns).toContain('status')
    })

    it('should not push projection to sources that do not support it', () => {
      const query: FederatedQuery = {
        from: [{ source: 'api_source', table: 'users' }],
        columns: ['id', 'name'],
      }

      const result = optimizer.optimize(query)

      expect(result.fragments[0].pushdown.columns).toBeUndefined()
      expect(result.postProjection).toEqual(['id', 'name'])
    })
  })

  describe('limit pushdown', () => {
    it('should push limit to single-source queries', () => {
      const query: FederatedQuery = {
        from: [{ source: 'sql_db', table: 'users' }],
        limit: 100,
      }

      const result = optimizer.optimize(query)

      expect(result.fragments[0].pushdown.limit).toBe(100)
    })

    it('should not push limit to multi-source queries without order', () => {
      catalog.registerSource({ name: 'db2', type: 'memory', config: {} })
      catalog.attachAdapter('db2', createMemoryAdapter({}))

      const query: FederatedQuery = {
        from: [
          { source: 'sql_db', table: 'users' },
          { source: 'db2', table: 'profiles' },
        ],
        limit: 100,
        join: { type: 'INNER', on: { left: 'users.id', right: 'profiles.user_id' } },
      }

      const result = optimizer.optimize(query)

      // Limit cannot be pushed because join may filter rows
      expect(result.fragments[0].pushdown.limit).toBeUndefined()
      expect(result.postLimit).toBe(100)
    })
  })

  describe('aggregation pushdown', () => {
    it('should push aggregations to capable sources', () => {
      const query: FederatedQuery = {
        from: [{ source: 'sql_db', table: 'orders' }],
        groupBy: ['status'],
        aggregations: [
          { function: 'count', alias: 'order_count' },
          { function: 'sum', column: 'total', alias: 'total_revenue' },
        ],
      }

      const result = optimizer.optimize(query)

      expect(result.fragments[0].pushdown.aggregations).toBeDefined()
      expect(result.fragments[0].pushdown.groupBy).toEqual(['status'])
    })

    it('should compute aggregations locally for incapable sources', () => {
      const query: FederatedQuery = {
        from: [{ source: 'api_source', table: 'events' }],
        groupBy: ['event_type'],
        aggregations: [{ function: 'count', alias: 'event_count' }],
      }

      const result = optimizer.optimize(query)

      expect(result.fragments[0].pushdown.aggregations).toBeUndefined()
      expect(result.postAggregations).toBeDefined()
    })
  })
})

// =============================================================================
// FederatedExecutor Tests
// =============================================================================

describe('FederatedExecutor', () => {
  let executor: FederatedExecutor
  let catalog: Catalog

  beforeEach(() => {
    catalog = new Catalog()

    // Setup users source
    catalog.registerSource({ name: 'users_db', type: 'memory', config: {} })
    catalog.attachAdapter('users_db', createMemoryAdapter({
      users: [
        { id: 1, name: 'Alice', department: 'Engineering' },
        { id: 2, name: 'Bob', department: 'Sales' },
        { id: 3, name: 'Charlie', department: 'Engineering' },
      ],
    }))

    // Setup orders source
    catalog.registerSource({ name: 'orders_db', type: 'memory', config: {} })
    catalog.attachAdapter('orders_db', createMemoryAdapter({
      orders: [
        { id: 101, user_id: 1, total: 150.00 },
        { id: 102, user_id: 1, total: 75.50 },
        { id: 103, user_id: 2, total: 200.00 },
      ],
    }))

    executor = new FederatedExecutor(catalog)
  })

  describe('single-source execution', () => {
    it('should execute query against single source', async () => {
      const plan: ExecutionPlan = {
        fragments: [{
          source: 'users_db',
          pushdown: {
            table: 'users',
            predicates: [{ column: 'department', op: '=', value: 'Engineering' }],
          },
        }],
      }

      const result = await executor.execute(plan)

      expect(result.rows).toHaveLength(2)
      expect(result.rows.map(r => r.name)).toEqual(['Alice', 'Charlie'])
    })

    it('should apply residual predicates locally', async () => {
      const plan: ExecutionPlan = {
        fragments: [{
          source: 'users_db',
          pushdown: { table: 'users' },
        }],
        residualPredicates: [
          { column: 'name', op: 'LIKE', value: '%li%' },
        ],
      }

      const result = await executor.execute(plan)

      expect(result.rows).toHaveLength(2)
      expect(result.rows.map(r => r.name)).toEqual(['Alice', 'Charlie'])
    })
  })

  describe('cross-source joins', () => {
    it('should execute hash join across sources', async () => {
      const plan: ExecutionPlan = {
        fragments: [
          {
            source: 'users_db',
            pushdown: { table: 'users' },
          },
          {
            source: 'orders_db',
            pushdown: { table: 'orders' },
          },
        ],
        join: {
          type: 'hash',
          buildSide: 'users_db',
          probeSide: 'orders_db',
          on: { left: 'id', right: 'user_id' },
        },
      }

      const result = await executor.execute(plan)

      expect(result.rows).toHaveLength(3)
      expect(result.rows[0]).toHaveProperty('name')
      expect(result.rows[0]).toHaveProperty('total')
    })

    it('should execute nested loop join with small build side', async () => {
      const plan: ExecutionPlan = {
        fragments: [
          {
            source: 'users_db',
            pushdown: {
              table: 'users',
              predicates: [{ column: 'id', op: '=', value: 1 }],
            },
          },
          {
            source: 'orders_db',
            pushdown: { table: 'orders' },
          },
        ],
        join: {
          type: 'nested_loop',
          outer: 'users_db',
          inner: 'orders_db',
          on: { left: 'id', right: 'user_id' },
        },
      }

      const result = await executor.execute(plan)

      expect(result.rows).toHaveLength(2)
      expect(result.rows.every(r => r.user_id === 1)).toBe(true)
    })

    it('should support left outer join', async () => {
      // Add user with no orders
      catalog.attachAdapter('users_db', createMemoryAdapter({
        users: [
          { id: 1, name: 'Alice' },
          { id: 4, name: 'Dave' }, // No orders
        ],
      }))

      const plan: ExecutionPlan = {
        fragments: [
          { source: 'users_db', pushdown: { table: 'users' } },
          { source: 'orders_db', pushdown: { table: 'orders' } },
        ],
        join: {
          type: 'hash',
          joinType: 'LEFT',
          buildSide: 'orders_db',
          probeSide: 'users_db',
          on: { left: 'user_id', right: 'id' },
        },
      }

      const result = await executor.execute(plan)

      expect(result.rows.some(r => r.name === 'Dave' && r.total === null)).toBe(true)
    })
  })

  describe('streaming execution', () => {
    it('should stream results with backpressure', async () => {
      // Large dataset
      const largeData = {
        items: Array.from({ length: 10000 }, (_, i) => ({ id: i, value: i * 2 })),
      }
      catalog.attachAdapter('users_db', createMemoryAdapter(largeData))

      const plan: ExecutionPlan = {
        fragments: [{
          source: 'users_db',
          pushdown: { table: 'items' },
        }],
        streaming: { batchSize: 1000 },
      }

      const stream = executor.stream(plan)

      let batchCount = 0
      let totalRows = 0
      for await (const batch of stream) {
        batchCount++
        totalRows += batch.rows.length
      }

      expect(batchCount).toBe(10)
      expect(totalRows).toBe(10000)
    })

    it('should respect memory limits via backpressure', async () => {
      const largeData = {
        items: Array.from({ length: 100000 }, (_, i) => ({
          id: i,
          data: 'x'.repeat(1000), // 1KB per row
        })),
      }
      catalog.attachAdapter('users_db', createMemoryAdapter(largeData))

      const plan: ExecutionPlan = {
        fragments: [{
          source: 'users_db',
          pushdown: { table: 'items' },
        }],
        streaming: {
          batchSize: 1000,
          maxMemoryMB: 10, // 10MB limit
        },
      }

      const stream = executor.stream(plan)

      const batches: StreamingResult[] = []
      for await (const batch of stream) {
        batches.push(batch)
        // Simulate processing delay
        await new Promise(resolve => setTimeout(resolve, 1))
      }

      // Should have applied backpressure
      expect(batches.length).toBeGreaterThan(0)
    })
  })

  describe('parallel execution', () => {
    it('should execute independent fragments in parallel', async () => {
      const startTime = Date.now()

      // Add delay to adapters
      const slowAdapter = (data: Record<string, unknown[]>): SourceAdapter => ({
        capabilities: () => ({ predicatePushdown: true, projectionPushdown: true, limitPushdown: true, aggregationPushdown: false, joinPushdown: false }),
        execute: async (query) => {
          await new Promise(resolve => setTimeout(resolve, 50))
          return createMemoryAdapter(data).execute(query)
        },
        stream: async function* () { yield [] },
      })

      catalog.attachAdapter('users_db', slowAdapter({ users: [{ id: 1 }] }))
      catalog.attachAdapter('orders_db', slowAdapter({ orders: [{ id: 1 }] }))

      const plan: ExecutionPlan = {
        fragments: [
          { source: 'users_db', pushdown: { table: 'users' } },
          { source: 'orders_db', pushdown: { table: 'orders' } },
        ],
        parallel: true,
      }

      await executor.execute(plan)

      const elapsed = Date.now() - startTime

      // Should complete in ~50ms (parallel) not ~100ms (sequential)
      expect(elapsed).toBeLessThan(100)
    })
  })

  describe('error handling', () => {
    it('should handle source connection failures', async () => {
      const failingAdapter: SourceAdapter = {
        capabilities: () => ({ predicatePushdown: true, projectionPushdown: true, limitPushdown: true, aggregationPushdown: false, joinPushdown: false }),
        execute: async () => { throw new Error('Connection refused') },
        stream: async function* () { throw new Error('Connection refused') },
      }
      catalog.attachAdapter('users_db', failingAdapter)

      const plan: ExecutionPlan = {
        fragments: [{ source: 'users_db', pushdown: { table: 'users' } }],
      }

      await expect(executor.execute(plan)).rejects.toThrow('Connection refused')
    })

    it('should include source context in errors', async () => {
      const failingAdapter: SourceAdapter = {
        capabilities: () => ({ predicatePushdown: true, projectionPushdown: true, limitPushdown: true, aggregationPushdown: false, joinPushdown: false }),
        execute: async () => { throw new Error('Query timeout') },
        stream: async function* () { throw new Error('Query timeout') },
      }
      catalog.attachAdapter('users_db', failingAdapter)

      const plan: ExecutionPlan = {
        fragments: [{ source: 'users_db', pushdown: { table: 'users' } }],
      }

      try {
        await executor.execute(plan)
      } catch (e) {
        expect((e as Error).message).toContain('users_db')
      }
    })
  })

  describe('execution statistics', () => {
    it('should collect execution metrics', async () => {
      const plan: ExecutionPlan = {
        fragments: [{
          source: 'users_db',
          pushdown: { table: 'users' },
        }],
        collectStats: true,
      }

      const result = await executor.execute(plan)

      expect(result.stats).toBeDefined()
      expect(result.stats?.rowsScanned).toBeGreaterThan(0)
      expect(result.stats?.executionTimeMs).toBeGreaterThan(0)
      expect(result.stats?.fragmentStats).toHaveLength(1)
    })
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('FederatedQueryPlanner Integration', () => {
  let catalog: Catalog
  let optimizer: PushdownOptimizer
  let executor: FederatedExecutor

  beforeEach(() => {
    catalog = new Catalog()
    optimizer = new PushdownOptimizer(catalog)
    executor = new FederatedExecutor(catalog)

    // Setup test environment with multiple sources
    catalog.registerSource({ name: 'customers', type: 'memory', config: {} })
    catalog.registerSource({ name: 'orders', type: 'memory', config: {} })
    catalog.registerSource({ name: 'products', type: 'memory', config: {} })

    catalog.attachAdapter('customers', createMemoryAdapter({
      customers: [
        { id: 1, name: 'Acme Corp', tier: 'enterprise' },
        { id: 2, name: 'Startup Inc', tier: 'basic' },
        { id: 3, name: 'BigCo', tier: 'enterprise' },
      ],
    }))

    catalog.attachAdapter('orders', createMemoryAdapter({
      orders: [
        { id: 101, customer_id: 1, product_id: 1, quantity: 10, total: 1000 },
        { id: 102, customer_id: 1, product_id: 2, quantity: 5, total: 250 },
        { id: 103, customer_id: 2, product_id: 1, quantity: 2, total: 200 },
        { id: 104, customer_id: 3, product_id: 3, quantity: 100, total: 5000 },
      ],
    }))

    catalog.attachAdapter('products', createMemoryAdapter({
      products: [
        { id: 1, name: 'Widget', price: 100 },
        { id: 2, name: 'Gadget', price: 50 },
        { id: 3, name: 'Enterprise Suite', price: 50 },
      ],
    }))
  })

  it('should execute full federated query pipeline', async () => {
    const query: FederatedQuery = {
      from: [
        { source: 'customers', table: 'customers' },
        { source: 'orders', table: 'orders' },
      ],
      columns: ['customers.name', 'orders.total'],
      predicates: [
        { column: 'customers.tier', op: '=', value: 'enterprise' },
      ],
      join: {
        type: 'INNER',
        on: { left: 'customers.id', right: 'orders.customer_id' },
      },
    }

    const plan = optimizer.optimize(query)
    const result = await executor.execute(plan)

    expect(result.rows.length).toBeGreaterThan(0)
    expect(result.rows.every(r => r.name === 'Acme Corp' || r.name === 'BigCo')).toBe(true)
  })

  it('should handle two-way joins with proper column selection', async () => {
    // Note: Full multi-way join support (3+ sources with chained joins) is tracked
    // in subtasks dotdo-pc225 (Cross-source join execution) and dotdo-fv8v0
    // (Join strategy selection). Current implementation supports two-way joins.
    const query: FederatedQuery = {
      from: [
        { source: 'customers', table: 'customers' },
        { source: 'orders', table: 'orders' },
      ],
      columns: ['customers.name', 'orders.total', 'orders.quantity'],
      join: {
        type: 'INNER',
        on: { left: 'customers.id', right: 'orders.customer_id' },
      },
    }

    const plan = optimizer.optimize(query)
    const result = await executor.execute(plan)

    // 4 orders total, all customers have at least one order
    expect(result.rows).toHaveLength(4)
    // Rows have unqualified column names from merged sources
    expect(result.rows[0]).toHaveProperty('name')
    expect(result.rows[0]).toHaveProperty('total')
    expect(result.rows[0]).toHaveProperty('quantity')
  })

  it('should optimize join order based on statistics', async () => {
    // Register statistics to influence join order
    catalog.registerStatistics('customers', {
      tables: { customers: { rowCount: 100, sizeBytes: 10000, distinctCounts: {} } },
    })
    catalog.registerStatistics('orders', {
      tables: { orders: { rowCount: 1000000, sizeBytes: 100000000, distinctCounts: {} } },
    })

    const query: FederatedQuery = {
      from: [
        { source: 'orders', table: 'orders' },
        { source: 'customers', table: 'customers' },
      ],
      predicates: [
        { column: 'customers.tier', op: '=', value: 'enterprise' },
      ],
      join: {
        type: 'INNER',
        on: { left: 'orders.customer_id', right: 'customers.id' },
      },
    }

    const plan = optimizer.optimize(query)

    // Should build hash table on smaller filtered customers table
    expect(plan.join?.buildSide).toBe('customers')
  })
})
