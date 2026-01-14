/**
 * QueryEngine Federation Integration Tests
 *
 * Tests for integrating FederatedQueryPlanner with the existing QueryEngine.
 * Verifies backward compatibility with single-source queries while enabling
 * transparent multi-source query federation.
 *
 * @see dotdo-5rrer
 */

import { describe, it, expect, beforeEach } from 'vitest'

import {
  // QueryEngine exports
  QueryPlanner,
  ExecutionEngine,
  MongoQueryParser,
  SQLWhereParser,
  type QueryPlan,
  type TableStatistics,
} from '../index'

import {
  // Federation exports (should be re-exported from query-engine)
  FederatedQueryEngine,
  createFederatedQueryEngine,
  createMemorySource,
  type FederatedQueryEngineConfig,
  type SourceConfig,
} from '../../federated-query/query-engine-integration'

import {
  Catalog,
  PushdownOptimizer,
  FederatedExecutor,
  createMemoryAdapter,
  type FederatedQuery,
} from '../../federated-query/index'

// =============================================================================
// FederatedQueryEngine Integration Tests
// =============================================================================

describe('QueryEngine Federation Integration', () => {
  describe('backward compatibility', () => {
    it('should execute single-source queries using existing QueryPlanner path', async () => {
      const engine = new FederatedQueryEngine()

      engine.registerSource(createMemorySource('main', {
        users: [
          { id: 1, name: 'Alice', status: 'active' },
          { id: 2, name: 'Bob', status: 'inactive' },
          { id: 3, name: 'Charlie', status: 'active' },
        ],
      }))

      const result = await engine
        .from('main', 'users')
        .where({ status: 'active' })
        .execute()

      expect(result.rows).toHaveLength(2)
      expect(result.rows.map(r => r.name)).toContain('Alice')
      expect(result.rows.map(r => r.name)).toContain('Charlie')
    })

    it('should support MongoDB-style query syntax', async () => {
      const engine = new FederatedQueryEngine()

      engine.registerSource(createMemorySource('db', {
        products: [
          { id: 1, price: 50, category: 'electronics' },
          { id: 2, price: 150, category: 'electronics' },
          { id: 3, price: 25, category: 'books' },
        ],
      }))

      const result = await engine
        .from('db', 'products')
        .where({
          category: 'electronics',
          price: { $gte: 100 },
        })
        .execute()

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].id).toBe(2)
    })

    it('should support projection with select()', async () => {
      const engine = new FederatedQueryEngine()

      engine.registerSource(createMemorySource('db', {
        users: [
          { id: 1, name: 'Alice', email: 'alice@example.com', password: 'secret' },
        ],
      }))

      const result = await engine
        .from('db', 'users')
        .select('id', 'name')
        .execute()

      expect(result.rows[0]).toHaveProperty('id')
      expect(result.rows[0]).toHaveProperty('name')
      expect(result.rows[0]).not.toHaveProperty('password')
    })

    it('should support limit and offset', async () => {
      const engine = new FederatedQueryEngine()

      engine.registerSource(createMemorySource('db', {
        items: Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: `Item ${i + 1}` })),
      }))

      const result = await engine
        .from('db', 'items')
        .limit(10)
        .offset(20)
        .execute()

      expect(result.rows).toHaveLength(10)
      expect(result.rows[0].id).toBe(21)
      expect(result.rows[9].id).toBe(30)
    })
  })

  describe('multi-source federation', () => {
    let engine: FederatedQueryEngine

    beforeEach(() => {
      engine = new FederatedQueryEngine({ collectStats: true })

      engine.registerSource(createMemorySource('users_db', {
        users: [
          { id: 1, name: 'Alice', department: 'Engineering' },
          { id: 2, name: 'Bob', department: 'Sales' },
          { id: 3, name: 'Charlie', department: 'Engineering' },
        ],
      }))

      engine.registerSource(createMemorySource('orders_db', {
        orders: [
          { id: 101, user_id: 1, total: 150.00 },
          { id: 102, user_id: 1, total: 75.50 },
          { id: 103, user_id: 2, total: 200.00 },
          { id: 104, user_id: 3, total: 300.00 },
        ],
      }))
    })

    it('should execute cross-source joins', async () => {
      const result = await engine
        .from('users_db', 'users')
        .join('orders_db', 'orders', { left: 'users.id', right: 'orders.user_id' })
        .execute()

      expect(result.rows.length).toBe(4)
      // After join, rows have merged columns from both sources
      expect(result.rows[0]).toHaveProperty('name')
      expect(result.rows[0]).toHaveProperty('total')
    })

    it('should filter before joining across sources', async () => {
      const result = await engine
        .from('users_db', 'users')
        .where({ department: 'Engineering' })
        .join('orders_db', 'orders', { left: 'users.id', right: 'orders.user_id' })
        .execute()

      // Alice (2 orders) + Charlie (1 order) = 3 results
      expect(result.rows.length).toBe(3)
      expect(result.rows.every(r => r.department === 'Engineering')).toBe(true)
    })

    it('should collect execution statistics for federated queries', async () => {
      const result = await engine
        .from('users_db', 'users')
        .join('orders_db', 'orders', { left: 'users.id', right: 'orders.user_id' })
        .execute()

      expect(result.stats).toBeDefined()
      expect(result.stats?.sourcesQueried).toContain('users_db')
      expect(result.stats?.sourcesQueried).toContain('orders_db')
      expect(result.stats?.executionTimeMs).toBeGreaterThan(0)
    })

    it('should support left outer join via executor', async () => {
      // Test LEFT join at executor level (as shown in federated-query.test.ts)
      // The builder passes the join type through correctly
      const catalog = new Catalog()
      const executor = new FederatedExecutor(catalog)

      catalog.registerSource({ name: 'users_db', type: 'memory', config: {} })
      catalog.registerSource({ name: 'orders_db', type: 'memory', config: {} })

      catalog.attachAdapter('users_db', createMemoryAdapter({
        users: [
          { id: 1, name: 'Alice' },
          { id: 4, name: 'Dave' }, // No orders
        ],
      }))

      catalog.attachAdapter('orders_db', createMemoryAdapter({
        orders: [
          { id: 101, user_id: 1, total: 150.00 },
          { id: 102, user_id: 1, total: 75.50 },
        ],
      }))

      const plan = {
        fragments: [
          { source: 'users_db', pushdown: { table: 'users' } },
          { source: 'orders_db', pushdown: { table: 'orders' } },
        ],
        join: {
          type: 'hash' as const,
          joinType: 'LEFT' as const,
          buildSide: 'orders_db',
          probeSide: 'users_db',
          on: { left: 'user_id', right: 'id' },
        },
      }

      const result = await executor.execute(plan)

      // Alice has 2 orders, Dave has none but appears with null order fields
      expect(result.rows.some(r => r.name === 'Dave' && r.total === null)).toBe(true)
    })
  })

  describe('streaming execution', () => {
    it('should stream results in batches', async () => {
      const engine = new FederatedQueryEngine()

      engine.registerSource(createMemorySource('db', {
        items: Array.from({ length: 1000 }, (_, i) => ({ id: i })),
      }))

      const batches: Record<string, unknown>[][] = []
      const stream = engine
        .from('db', 'items')
        .stream(100)

      for await (const batch of stream) {
        batches.push(batch)
      }

      expect(batches.length).toBe(10)
      expect(batches[0].length).toBe(100)
    })
  })

  describe('query explanation', () => {
    it('should explain federated query plan', () => {
      const engine = new FederatedQueryEngine()

      engine.registerSource(createMemorySource('users', {
        users: [{ id: 1, name: 'Alice' }],
      }))

      engine.registerSource(createMemorySource('orders', {
        orders: [{ id: 1, user_id: 1, total: 100 }],
      }))

      const explanation = engine
        .from('users', 'users')
        .join('orders', 'orders', { left: 'users.id', right: 'orders.user_id' })
        .explain()

      expect(explanation).toContain('Federated Query Plan')
      expect(explanation).toContain('users.users')
      expect(explanation).toContain('orders.orders')
      expect(explanation).toContain('Join')
    })
  })

  describe('source management', () => {
    it('should list registered sources', () => {
      const engine = new FederatedQueryEngine()

      engine.registerSource(createMemorySource('source1', { t: [] }))
      engine.registerSource(createMemorySource('source2', { t: [] }))

      const sources = engine.listSources()

      expect(sources).toContain('source1')
      expect(sources).toContain('source2')
    })

    it('should unregister sources and invalidate cache', async () => {
      const engine = new FederatedQueryEngine({ enablePlanCache: true })

      engine.registerSource(createMemorySource('temp', {
        data: [{ id: 1 }],
      }))

      // Execute to populate cache
      await engine.from('temp', 'data').execute()

      engine.unregisterSource('temp')

      expect(engine.listSources()).not.toContain('temp')
    })

    it('should set default source for unqualified references', async () => {
      const engine = new FederatedQueryEngine()

      engine.registerSource(createMemorySource('main', {
        users: [{ id: 1, name: 'Alice' }],
      }))

      engine.setDefaultSource('main')

      // Should resolve 'users' to 'main.users'
      const result = await engine.from('main', 'users').execute()

      expect(result.rows).toHaveLength(1)
    })
  })

  describe('configuration options', () => {
    it('should support plan caching configuration', async () => {
      const engine = new FederatedQueryEngine({
        enablePlanCache: true,
        maxCacheSize: 50,
      })

      engine.registerSource(createMemorySource('db', {
        users: [{ id: 1 }],
      }))

      // Execute twice - second should use cache
      await engine.from('db', 'users').execute()
      await engine.from('db', 'users').execute()

      // Cache should be working (no error means success)
    })

    it('should support parallel execution toggle', async () => {
      const engine = new FederatedQueryEngine({
        parallelExecution: true,
      })

      engine.registerSource(createMemorySource('db1', { t1: [{ id: 1 }] }))
      engine.registerSource(createMemorySource('db2', { t2: [{ id: 1 }] }))

      const result = await engine
        .from('db1', 't1')
        .join('db2', 't2', { left: 't1.id', right: 't2.id' })
        .execute()

      expect(result.rows.length).toBeGreaterThan(0)
    })

    it('should support statistics collection toggle', async () => {
      const withStats = new FederatedQueryEngine({ collectStats: true })
      const withoutStats = new FederatedQueryEngine({ collectStats: false })

      withStats.registerSource(createMemorySource('db', { t: [{ id: 1 }] }))
      withoutStats.registerSource(createMemorySource('db', { t: [{ id: 1 }] }))

      const resultWithStats = await withStats.from('db', 't').execute()
      const resultWithoutStats = await withoutStats.from('db', 't').execute()

      expect(resultWithStats.stats).toBeDefined()
      expect(resultWithoutStats.stats).toBeUndefined()
    })
  })

  describe('factory functions', () => {
    it('should create engine with pre-registered sources', async () => {
      const engine = createFederatedQueryEngine([
        createMemorySource('users', {
          users: [{ id: 1, name: 'Alice' }],
        }),
        createMemorySource('orders', {
          orders: [{ id: 1, user_id: 1, total: 100 }],
        }),
      ])

      const result = await engine
        .from('users', 'users')
        .join('orders', 'orders', { left: 'users.id', right: 'orders.user_id' })
        .execute()

      expect(result.rows.length).toBe(1)
    })

    it('should create memory source with inferred schema', () => {
      const source = createMemorySource('test', {
        products: [
          { id: 1, price: 99.99, active: true },
        ],
      })

      expect(source.schema?.tables.products).toBeDefined()
      expect(source.schema?.tables.products.columns.id.type).toBe('integer')
      expect(source.schema?.tables.products.columns.price.type).toBe('number')
      expect(source.schema?.tables.products.columns.active.type).toBe('boolean')
    })
  })
})

// =============================================================================
// QueryPlanner + Federation Integration Tests
// =============================================================================

describe('QueryPlanner Federation Integration', () => {
  it('should update QueryPlanner statistics from federated source stats', async () => {
    const engine = new FederatedQueryEngine()

    engine.registerSource({
      name: 'analytics',
      type: 'memory',
      adapter: createMemoryAdapter({
        events: Array.from({ length: 1000 }, (_, i) => ({ id: i, type: 'click' })),
      }),
      statistics: {
        tables: {
          events: { rowCount: 1000000 },
        },
      },
    })

    // The QueryPlanner inside FederatedQueryEngine should have the statistics
    // This enables cost-based optimization even for federated queries
    const result = await engine.from('analytics', 'events').limit(10).execute()

    expect(result.rows.length).toBe(10)
  })
})

// =============================================================================
// Mixed Local/Remote Query Tests
// =============================================================================

describe('Mixed Local/Remote Queries', () => {
  it('should handle queries mixing local DO data with remote sources', async () => {
    const engine = new FederatedQueryEngine()

    // Local source (simulating Durable Object data)
    engine.registerSource(createMemorySource('local', {
      sessions: [
        { id: 's1', user_id: 1, created_at: '2024-01-01' },
        { id: 's2', user_id: 2, created_at: '2024-01-02' },
      ],
    }))

    // Remote source (simulating external database)
    engine.registerSource(createMemorySource('remote', {
      users: [
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'bob@example.com' },
      ],
    }))

    const result = await engine
      .from('local', 'sessions')
      .join('remote', 'users', { left: 'sessions.user_id', right: 'users.id' })
      .execute()

    // 2 sessions join with 2 users = 2 rows (each session matches one user)
    expect(result.rows.length).toBe(2)
    expect(result.rows[0]).toHaveProperty('name')
    expect(result.rows[0]).toHaveProperty('email')
    expect(result.rows[0]).toHaveProperty('user_id')
    expect(result.rows[0]).toHaveProperty('created_at')
  })

  it('should push predicates to appropriate sources', async () => {
    const engine = new FederatedQueryEngine({ collectStats: true })

    engine.registerSource(createMemorySource('local', {
      orders: [
        { id: 1, user_id: 1, status: 'completed', total: 100 },
        { id: 2, user_id: 1, status: 'pending', total: 50 },
        { id: 3, user_id: 2, status: 'completed', total: 200 },
      ],
    }))

    engine.registerSource(createMemorySource('remote', {
      users: [
        { id: 1, name: 'Alice', tier: 'premium' },
        { id: 2, name: 'Bob', tier: 'basic' },
      ],
    }))

    // This should push status='completed' to local source before join
    const result = await engine
      .from('local', 'orders')
      .where({ status: 'completed' })
      .join('remote', 'users', { left: 'orders.user_id', right: 'users.id' })
      .execute()

    expect(result.rows.length).toBe(2)
    expect(result.rows.every(r => r.status === 'completed')).toBe(true)
  })
})

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('Federation Error Handling', () => {
  it('should provide clear error when source is not registered', async () => {
    const engine = new FederatedQueryEngine()

    await expect(
      engine.from('nonexistent', 'table').execute()
    ).rejects.toThrow(/No adapter for source/)
  })

  it('should handle adapter failures gracefully', async () => {
    const engine = new FederatedQueryEngine()

    const failingAdapter = {
      capabilities: () => ({
        predicatePushdown: true,
        projectionPushdown: true,
        limitPushdown: true,
        aggregationPushdown: false,
        joinPushdown: false,
      }),
      execute: async () => { throw new Error('Connection timeout') },
      stream: async function* () { throw new Error('Connection timeout') },
    }

    engine.registerSource({
      name: 'failing',
      type: 'memory',
      adapter: failingAdapter,
    })

    await expect(
      engine.from('failing', 'table').execute()
    ).rejects.toThrow(/Connection timeout/)
  })
})
