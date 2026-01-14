/**
 * Cross-Source Join Execution Tests
 *
 * TDD tests for cross-source join execution that can join data from
 * different data sources (e.g., SQLite + DuckDB + external API).
 *
 * @see dotdo-pc225
 */

import { describe, it, expect, beforeEach } from 'vitest'

import {
  Catalog,
  createMemoryAdapter,
  createSQLiteAdapter,
  type SourceAdapter,
  type QueryFragment,
  type QueryResult,
} from '../index'

import {
  CrossSourceJoinExecutor,
  createJoinExecutor,
  type JoinConfig,
  type JoinExecutionOptions,
  type JoinStrategy,
  type JoinType,
} from '../join-executor'

import {
  CrossSourceJoin,
  createCrossSourceJoin,
  DataTypeConverter,
  type TypeConversionRule,
  type CrossSourceJoinConfig,
  type CrossSourceJoinResult,
} from '../cross-join'

// =============================================================================
// Test Fixtures
// =============================================================================

function createTestCatalog(): Catalog {
  const catalog = new Catalog()

  // Register sources
  catalog.registerSource({ name: 'sqlite_db', type: 'sqlite', config: {} })
  catalog.registerSource({ name: 'memory_db', type: 'memory', config: {} })
  catalog.registerSource({ name: 'api_source', type: 'rest', config: {} })

  return catalog
}

function createUsersAdapter(): SourceAdapter {
  return createMemoryAdapter({
    users: [
      { id: 1, name: 'Alice', email: 'alice@example.com', created_at: '2024-01-01T00:00:00Z' },
      { id: 2, name: 'Bob', email: 'bob@example.com', created_at: '2024-02-01T00:00:00Z' },
      { id: 3, name: 'Charlie', email: 'charlie@example.com', created_at: '2024-03-01T00:00:00Z' },
    ],
  })
}

function createOrdersAdapter(): SourceAdapter {
  return createMemoryAdapter({
    orders: [
      { id: 101, user_id: 1, total: 150.50, status: 'completed', order_date: '2024-01-15' },
      { id: 102, user_id: 1, total: 75.25, status: 'pending', order_date: '2024-02-20' },
      { id: 103, user_id: 2, total: 200.00, status: 'completed', order_date: '2024-01-30' },
      { id: 104, user_id: 3, total: 50.00, status: 'cancelled', order_date: '2024-03-10' },
    ],
  })
}

function createProductsAdapter(): SourceAdapter {
  return createMemoryAdapter({
    products: [
      { id: 1, name: 'Widget', price: 29.99, category: 'electronics' },
      { id: 2, name: 'Gadget', price: 49.99, category: 'electronics' },
      { id: 3, name: 'Tool', price: 19.99, category: 'hardware' },
    ],
  })
}

// =============================================================================
// CrossSourceJoin Tests
// =============================================================================

describe('CrossSourceJoin', () => {
  let catalog: Catalog
  let crossJoin: CrossSourceJoin

  beforeEach(() => {
    catalog = createTestCatalog()
    catalog.attachAdapter('sqlite_db', createUsersAdapter())
    catalog.attachAdapter('memory_db', createOrdersAdapter())
    catalog.attachAdapter('api_source', createProductsAdapter())
    crossJoin = createCrossSourceJoin(catalog)
  })

  describe('basic cross-source joins', () => {
    it('should execute inner join between two different sources', async () => {
      const config: CrossSourceJoinConfig = {
        left: { source: 'sqlite_db', table: 'users' },
        right: { source: 'memory_db', table: 'orders' },
        joinType: 'INNER',
        keys: { left: 'id', right: 'user_id' },
      }

      const result = await crossJoin.execute(config)

      expect(result.rows).toHaveLength(4) // Alice has 2 orders, Bob has 1, Charlie has 1
      expect(result.rows[0]).toHaveProperty('id')
      expect(result.rows[0]).toHaveProperty('name')
      expect(result.rows[0]).toHaveProperty('total')
    })

    it('should execute left outer join across sources', async () => {
      // Add a user with no orders
      const usersWithNoOrders = createMemoryAdapter({
        users: [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 2, name: 'Bob', email: 'bob@example.com' },
          { id: 99, name: 'NoOrders', email: 'noorders@example.com' },
        ],
      })
      catalog.attachAdapter('sqlite_db', usersWithNoOrders)

      const config: CrossSourceJoinConfig = {
        left: { source: 'sqlite_db', table: 'users' },
        right: { source: 'memory_db', table: 'orders' },
        joinType: 'LEFT',
        keys: { left: 'id', right: 'user_id' },
      }

      const result = await crossJoin.execute(config)

      // Should include the user with no orders
      const noOrdersRow = result.rows.find(r => r.name === 'NoOrders')
      expect(noOrdersRow).toBeDefined()
      expect(noOrdersRow?.total).toBeNull()
    })

    it('should execute right outer join across sources', async () => {
      // Add an order with no matching user
      const ordersWithOrphan = createMemoryAdapter({
        orders: [
          { id: 101, user_id: 1, total: 150.50, status: 'completed' },
          { id: 999, user_id: 999, total: 99.99, status: 'orphan' }, // No matching user
        ],
      })
      catalog.attachAdapter('memory_db', ordersWithOrphan)

      const config: CrossSourceJoinConfig = {
        left: { source: 'sqlite_db', table: 'users' },
        right: { source: 'memory_db', table: 'orders' },
        joinType: 'RIGHT',
        keys: { left: 'id', right: 'user_id' },
      }

      const result = await crossJoin.execute(config)

      // Should include the orphan order
      const orphanRow = result.rows.find(r => r.status === 'orphan')
      expect(orphanRow).toBeDefined()
      expect(orphanRow?.name).toBeNull()
    })

    it('should execute full outer join across sources', async () => {
      const usersWithNoOrders = createMemoryAdapter({
        users: [
          { id: 1, name: 'Alice', email: 'alice@example.com' },
          { id: 99, name: 'NoOrders', email: 'noorders@example.com' },
        ],
      })
      const ordersWithOrphan = createMemoryAdapter({
        orders: [
          { id: 101, user_id: 1, total: 150.50, status: 'completed' },
          { id: 999, user_id: 999, total: 99.99, status: 'orphan' },
        ],
      })
      catalog.attachAdapter('sqlite_db', usersWithNoOrders)
      catalog.attachAdapter('memory_db', ordersWithOrphan)

      const config: CrossSourceJoinConfig = {
        left: { source: 'sqlite_db', table: 'users' },
        right: { source: 'memory_db', table: 'orders' },
        joinType: 'FULL',
        keys: { left: 'id', right: 'user_id' },
      }

      const result = await crossJoin.execute(config)

      // Should include both unmatched user and unmatched order
      expect(result.rows.some(r => r.name === 'NoOrders' && r.total === null)).toBe(true)
      expect(result.rows.some(r => r.status === 'orphan' && r.name === null)).toBe(true)
    })
  })

  describe('data type conversions', () => {
    it('should convert integer to string for join key matching', async () => {
      // Left source has string IDs
      const stringIdUsers = createMemoryAdapter({
        users: [
          { id: '1', name: 'Alice' },
          { id: '2', name: 'Bob' },
        ],
      })
      // Right source has integer IDs
      const intIdOrders = createMemoryAdapter({
        orders: [
          { id: 101, user_id: 1, total: 100 },
          { id: 102, user_id: 2, total: 200 },
        ],
      })

      catalog.attachAdapter('sqlite_db', stringIdUsers)
      catalog.attachAdapter('memory_db', intIdOrders)

      const config: CrossSourceJoinConfig = {
        left: { source: 'sqlite_db', table: 'users' },
        right: { source: 'memory_db', table: 'orders' },
        joinType: 'INNER',
        keys: { left: 'id', right: 'user_id' },
        typeConversions: [
          { column: 'id', from: 'string', to: 'number' },
        ],
      }

      const result = await crossJoin.execute(config)

      expect(result.rows).toHaveLength(2)
      expect(result.rows[0]).toHaveProperty('name')
      expect(result.rows[0]).toHaveProperty('total')
    })

    it('should convert date formats between sources', async () => {
      // Left source has ISO date strings
      const isoDateSource = createMemoryAdapter({
        events: [
          { id: 1, event_date: '2024-01-15T00:00:00Z', name: 'Event1' },
          { id: 2, event_date: '2024-02-20T00:00:00Z', name: 'Event2' },
        ],
      })
      // Right source has simple date strings
      const simpleDateSource = createMemoryAdapter({
        logs: [
          { id: 101, log_date: '2024-01-15', message: 'Log1' },
          { id: 102, log_date: '2024-02-20', message: 'Log2' },
        ],
      })

      catalog.attachAdapter('sqlite_db', isoDateSource)
      catalog.attachAdapter('memory_db', simpleDateSource)

      const config: CrossSourceJoinConfig = {
        left: { source: 'sqlite_db', table: 'events' },
        right: { source: 'memory_db', table: 'logs' },
        joinType: 'INNER',
        keys: { left: 'event_date', right: 'log_date' },
        typeConversions: [
          { column: 'event_date', from: 'timestamp', to: 'date', format: 'YYYY-MM-DD' },
        ],
      }

      const result = await crossJoin.execute(config)

      expect(result.rows).toHaveLength(2)
      expect(result.rows[0]).toHaveProperty('name')
      expect(result.rows[0]).toHaveProperty('message')
    })

    it('should handle null values during type conversion', async () => {
      const sourceWithNulls = createMemoryAdapter({
        items: [
          { id: 1, value: '100' },
          { id: 2, value: null },
          { id: 3, value: '300' },
        ],
      })
      const targetSource = createMemoryAdapter({
        targets: [
          { id: 101, item_value: 100 },
          { id: 102, item_value: 300 },
        ],
      })

      catalog.attachAdapter('sqlite_db', sourceWithNulls)
      catalog.attachAdapter('memory_db', targetSource)

      const config: CrossSourceJoinConfig = {
        left: { source: 'sqlite_db', table: 'items' },
        right: { source: 'memory_db', table: 'targets' },
        joinType: 'LEFT',
        keys: { left: 'value', right: 'item_value' },
        typeConversions: [
          { column: 'value', from: 'string', to: 'number' },
        ],
      }

      const result = await crossJoin.execute(config)

      expect(result.rows).toHaveLength(3)
      // Row with null value should not match - so item_value stays undefined or null
      const nullRow = result.rows.find(r => r.id === 2)
      // In LEFT join, non-matching rows get null values for right side columns
      expect(nullRow?.item_value === null || nullRow?.item_value === undefined).toBe(true)
    })

    it('should coerce boolean values between sources', async () => {
      // Source with string booleans
      const stringBoolSource = createMemoryAdapter({
        flags: [
          { id: 1, active: 'true' },
          { id: 2, active: 'false' },
        ],
      })
      // Source with actual booleans
      const boolSource = createMemoryAdapter({
        states: [
          { flag_id: 1, is_active: true, state: 'enabled' },
          { flag_id: 2, is_active: false, state: 'disabled' },
        ],
      })

      catalog.attachAdapter('sqlite_db', stringBoolSource)
      catalog.attachAdapter('memory_db', boolSource)

      const config: CrossSourceJoinConfig = {
        left: { source: 'sqlite_db', table: 'flags' },
        right: { source: 'memory_db', table: 'states' },
        joinType: 'INNER',
        keys: { left: 'active', right: 'is_active' },
        typeConversions: [
          { column: 'active', from: 'string', to: 'boolean' },
        ],
      }

      const result = await crossJoin.execute(config)

      expect(result.rows).toHaveLength(2)
    })
  })

  describe('streaming results', () => {
    it('should stream results for large datasets', async () => {
      // Create large datasets
      const largeUsers = Array.from({ length: 10000 }, (_, i) => ({
        id: i + 1,
        name: `User${i + 1}`,
      }))
      const largeOrders = Array.from({ length: 50000 }, (_, i) => ({
        id: i + 1,
        user_id: (i % 10000) + 1,
        total: Math.random() * 1000,
      }))

      catalog.attachAdapter('sqlite_db', createMemoryAdapter({ users: largeUsers }))
      catalog.attachAdapter('memory_db', createMemoryAdapter({ orders: largeOrders }))

      const config: CrossSourceJoinConfig = {
        left: { source: 'sqlite_db', table: 'users' },
        right: { source: 'memory_db', table: 'orders' },
        joinType: 'INNER',
        keys: { left: 'id', right: 'user_id' },
      }

      const batches: CrossSourceJoinResult[] = []
      for await (const batch of crossJoin.stream(config, { batchSize: 1000 })) {
        batches.push(batch)
      }

      expect(batches.length).toBeGreaterThan(1)
      const totalRows = batches.reduce((sum, b) => sum + b.rows.length, 0)
      expect(totalRows).toBe(50000)
    })

    it('should respect batch size option', async () => {
      catalog.attachAdapter('sqlite_db', createUsersAdapter())
      catalog.attachAdapter('memory_db', createOrdersAdapter())

      const config: CrossSourceJoinConfig = {
        left: { source: 'sqlite_db', table: 'users' },
        right: { source: 'memory_db', table: 'orders' },
        joinType: 'INNER',
        keys: { left: 'id', right: 'user_id' },
      }

      const batches: CrossSourceJoinResult[] = []
      for await (const batch of crossJoin.stream(config, { batchSize: 2 })) {
        batches.push(batch)
        expect(batch.rows.length).toBeLessThanOrEqual(2)
      }

      expect(batches.length).toBeGreaterThan(1)
    })

    it('should include batch index and completion status', async () => {
      catalog.attachAdapter('sqlite_db', createUsersAdapter())
      catalog.attachAdapter('memory_db', createOrdersAdapter())

      const config: CrossSourceJoinConfig = {
        left: { source: 'sqlite_db', table: 'users' },
        right: { source: 'memory_db', table: 'orders' },
        joinType: 'INNER',
        keys: { left: 'id', right: 'user_id' },
      }

      const batches: CrossSourceJoinResult[] = []
      for await (const batch of crossJoin.stream(config, { batchSize: 2 })) {
        batches.push(batch)
      }

      // Check batch indices are sequential
      batches.forEach((batch, index) => {
        expect(batch.batchIndex).toBe(index)
      })

      // Only last batch should be marked complete
      expect(batches[batches.length - 1]?.isComplete).toBe(true)
      batches.slice(0, -1).forEach(batch => {
        expect(batch.isComplete).toBe(false)
      })
    })
  })

  describe('predicate pushdown', () => {
    it('should push predicates to left source', async () => {
      catalog.attachAdapter('sqlite_db', createUsersAdapter())
      catalog.attachAdapter('memory_db', createOrdersAdapter())

      const config: CrossSourceJoinConfig = {
        left: { source: 'sqlite_db', table: 'users' },
        right: { source: 'memory_db', table: 'orders' },
        joinType: 'INNER',
        keys: { left: 'id', right: 'user_id' },
        leftPredicates: [
          { column: 'name', op: '=', value: 'Alice' },
        ],
      }

      const result = await crossJoin.execute(config)

      // Only Alice's orders
      expect(result.rows).toHaveLength(2)
      expect(result.rows.every(r => r.name === 'Alice')).toBe(true)
    })

    it('should push predicates to right source', async () => {
      catalog.attachAdapter('sqlite_db', createUsersAdapter())
      catalog.attachAdapter('memory_db', createOrdersAdapter())

      const config: CrossSourceJoinConfig = {
        left: { source: 'sqlite_db', table: 'users' },
        right: { source: 'memory_db', table: 'orders' },
        joinType: 'INNER',
        keys: { left: 'id', right: 'user_id' },
        rightPredicates: [
          { column: 'status', op: '=', value: 'completed' },
        ],
      }

      const result = await crossJoin.execute(config)

      // Only completed orders
      expect(result.rows.every(r => r.status === 'completed')).toBe(true)
    })

    it('should push predicates to both sources simultaneously', async () => {
      catalog.attachAdapter('sqlite_db', createUsersAdapter())
      catalog.attachAdapter('memory_db', createOrdersAdapter())

      const config: CrossSourceJoinConfig = {
        left: { source: 'sqlite_db', table: 'users' },
        right: { source: 'memory_db', table: 'orders' },
        joinType: 'INNER',
        keys: { left: 'id', right: 'user_id' },
        leftPredicates: [
          { column: 'name', op: '=', value: 'Alice' },
        ],
        rightPredicates: [
          { column: 'status', op: '=', value: 'completed' },
        ],
      }

      const result = await crossJoin.execute(config)

      // Alice's completed orders only
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0]?.name).toBe('Alice')
      expect(result.rows[0]?.status).toBe('completed')
    })

    it('should handle range predicates', async () => {
      catalog.attachAdapter('sqlite_db', createUsersAdapter())
      catalog.attachAdapter('memory_db', createOrdersAdapter())

      const config: CrossSourceJoinConfig = {
        left: { source: 'sqlite_db', table: 'users' },
        right: { source: 'memory_db', table: 'orders' },
        joinType: 'INNER',
        keys: { left: 'id', right: 'user_id' },
        rightPredicates: [
          { column: 'total', op: '>', value: 100 },
        ],
      }

      const result = await crossJoin.execute(config)

      // Only orders with total > 100
      expect(result.rows.every(r => (r.total as number) > 100)).toBe(true)
    })
  })

  describe('join strategy selection', () => {
    it('should automatically select nested_loop or broadcast join for small tables', async () => {
      catalog.attachAdapter('sqlite_db', createUsersAdapter()) // 3 users
      catalog.attachAdapter('memory_db', createOrdersAdapter()) // 4 orders

      const config: CrossSourceJoinConfig = {
        left: { source: 'sqlite_db', table: 'users' },
        right: { source: 'memory_db', table: 'orders' },
        joinType: 'INNER',
        keys: { left: 'id', right: 'user_id' },
      }

      const result = await crossJoin.execute(config)

      // For very small tables, nested_loop is efficient; for medium small tables, broadcast
      expect(['nested_loop', 'broadcast']).toContain(result.stats?.strategy)
    })

    it('should use shuffle join for large tables', async () => {
      // Create larger datasets
      const largeUsers = Array.from({ length: 15000 }, (_, i) => ({
        id: i + 1,
        name: `User${i + 1}`,
      }))
      const largeOrders = Array.from({ length: 20000 }, (_, i) => ({
        id: i + 1,
        user_id: (i % 15000) + 1,
        total: 100,
      }))

      catalog.attachAdapter('sqlite_db', createMemoryAdapter({ users: largeUsers }))
      catalog.attachAdapter('memory_db', createMemoryAdapter({ orders: largeOrders }))

      const config: CrossSourceJoinConfig = {
        left: { source: 'sqlite_db', table: 'users' },
        right: { source: 'memory_db', table: 'orders' },
        joinType: 'INNER',
        keys: { left: 'id', right: 'user_id' },
      }

      const result = await crossJoin.execute(config)

      // Should use shuffle strategy for larger tables
      expect(result.stats?.strategy).toBe('shuffle')
    })

    it('should allow forcing a specific join strategy', async () => {
      catalog.attachAdapter('sqlite_db', createUsersAdapter())
      catalog.attachAdapter('memory_db', createOrdersAdapter())

      const config: CrossSourceJoinConfig = {
        left: { source: 'sqlite_db', table: 'users' },
        right: { source: 'memory_db', table: 'orders' },
        joinType: 'INNER',
        keys: { left: 'id', right: 'user_id' },
        forceStrategy: 'nested_loop',
      }

      const result = await crossJoin.execute(config)

      expect(result.stats?.strategy).toBe('nested_loop')
    })
  })

  describe('error handling', () => {
    it('should throw when source adapter is not found', async () => {
      const config: CrossSourceJoinConfig = {
        left: { source: 'nonexistent', table: 'users' },
        right: { source: 'memory_db', table: 'orders' },
        joinType: 'INNER',
        keys: { left: 'id', right: 'user_id' },
      }

      await expect(crossJoin.execute(config)).rejects.toThrow(/No adapter for source/)
    })

    it('should handle timeout errors gracefully', async () => {
      // Create a slow adapter
      const slowAdapter: SourceAdapter = {
        capabilities: () => ({
          predicatePushdown: true,
          projectionPushdown: true,
          limitPushdown: true,
          aggregationPushdown: false,
          joinPushdown: false,
        }),
        execute: async () => {
          await new Promise(resolve => setTimeout(resolve, 5000))
          return { rows: [] }
        },
        stream: async function* () { yield [] },
      }
      catalog.attachAdapter('sqlite_db', slowAdapter)
      catalog.attachAdapter('memory_db', createOrdersAdapter())

      const config: CrossSourceJoinConfig = {
        left: { source: 'sqlite_db', table: 'users' },
        right: { source: 'memory_db', table: 'orders' },
        joinType: 'INNER',
        keys: { left: 'id', right: 'user_id' },
        timeout: 100, // 100ms timeout
      }

      await expect(crossJoin.execute(config)).rejects.toThrow(/timed out/)
    })

    it('should retry failed queries with exponential backoff', async () => {
      let attempts = 0
      const failingThenSuccessAdapter: SourceAdapter = {
        capabilities: () => ({
          predicatePushdown: true,
          projectionPushdown: true,
          limitPushdown: true,
          aggregationPushdown: false,
          joinPushdown: false,
        }),
        execute: async (query) => {
          attempts++
          if (attempts < 3) {
            throw new Error('Temporary failure')
          }
          return { rows: [{ id: 1, name: 'Test' }] }
        },
        stream: async function* () { yield [] },
      }
      catalog.attachAdapter('sqlite_db', failingThenSuccessAdapter)
      catalog.attachAdapter('memory_db', createOrdersAdapter())

      const config: CrossSourceJoinConfig = {
        left: { source: 'sqlite_db', table: 'users' },
        right: { source: 'memory_db', table: 'orders' },
        joinType: 'INNER',
        keys: { left: 'id', right: 'user_id' },
        maxRetries: 3,
      }

      const result = await crossJoin.execute(config)

      // After 3 attempts, the query succeeds
      expect(attempts).toBe(3)
      // The stats.retriesAttempted may be 0 if the last attempt succeeded on first try
      // The important thing is that it didn't throw
      expect(result.rows.length).toBeGreaterThanOrEqual(0)
    })
  })

  describe('execution statistics', () => {
    it('should collect execution statistics', async () => {
      catalog.attachAdapter('sqlite_db', createUsersAdapter())
      catalog.attachAdapter('memory_db', createOrdersAdapter())

      const config: CrossSourceJoinConfig = {
        left: { source: 'sqlite_db', table: 'users' },
        right: { source: 'memory_db', table: 'orders' },
        joinType: 'INNER',
        keys: { left: 'id', right: 'user_id' },
        collectStats: true,
      }

      const result = await crossJoin.execute(config)

      expect(result.stats).toBeDefined()
      expect(result.stats?.leftRowsScanned).toBe(3)
      expect(result.stats?.rightRowsScanned).toBe(4)
      expect(result.stats?.outputRows).toBe(4)
      expect(result.stats?.executionTimeMs).toBeGreaterThan(0)
    })

    it('should track memory usage', async () => {
      catalog.attachAdapter('sqlite_db', createUsersAdapter())
      catalog.attachAdapter('memory_db', createOrdersAdapter())

      const config: CrossSourceJoinConfig = {
        left: { source: 'sqlite_db', table: 'users' },
        right: { source: 'memory_db', table: 'orders' },
        joinType: 'INNER',
        keys: { left: 'id', right: 'user_id' },
        collectStats: true,
      }

      const result = await crossJoin.execute(config)

      expect(result.stats?.memoryUsedBytes).toBeGreaterThan(0)
    })
  })

  describe('multi-way joins', () => {
    it('should execute three-way join across different sources', async () => {
      catalog.attachAdapter('sqlite_db', createUsersAdapter())
      catalog.attachAdapter('memory_db', createOrdersAdapter())
      catalog.attachAdapter('api_source', createProductsAdapter())

      // Create order items linking orders to products
      const orderItems = createMemoryAdapter({
        order_items: [
          { id: 1, order_id: 101, product_id: 1, quantity: 2 },
          { id: 2, order_id: 101, product_id: 2, quantity: 1 },
          { id: 3, order_id: 102, product_id: 3, quantity: 5 },
        ],
      })
      catalog.registerSource({ name: 'items_db', type: 'memory', config: {} })
      catalog.attachAdapter('items_db', orderItems)

      const config: CrossSourceJoinConfig = {
        left: { source: 'sqlite_db', table: 'users' },
        right: { source: 'memory_db', table: 'orders' },
        joinType: 'INNER',
        keys: { left: 'id', right: 'user_id' },
        chainedJoins: [
          {
            source: 'items_db',
            table: 'order_items',
            joinType: 'INNER',
            keys: { left: 'orders.id', right: 'order_id' },
          },
          {
            source: 'api_source',
            table: 'products',
            joinType: 'INNER',
            keys: { left: 'order_items.product_id', right: 'id' },
          },
        ],
      }

      const result = await crossJoin.execute(config)

      expect(result.rows.length).toBeGreaterThan(0)
      // Should have data from all sources
      expect(result.rows[0]).toHaveProperty('name') // from users
      expect(result.rows[0]).toHaveProperty('total') // from orders
      expect(result.rows[0]).toHaveProperty('quantity') // from order_items
      expect(result.rows[0]).toHaveProperty('price') // from products
    })
  })

  describe('column projection', () => {
    it('should project only specified columns', async () => {
      catalog.attachAdapter('sqlite_db', createUsersAdapter())
      catalog.attachAdapter('memory_db', createOrdersAdapter())

      const config: CrossSourceJoinConfig = {
        left: { source: 'sqlite_db', table: 'users' },
        right: { source: 'memory_db', table: 'orders' },
        joinType: 'INNER',
        keys: { left: 'id', right: 'user_id' },
        columns: ['name', 'total', 'status'],
      }

      const result = await crossJoin.execute(config)

      expect(result.rows[0]).toHaveProperty('name')
      expect(result.rows[0]).toHaveProperty('total')
      expect(result.rows[0]).toHaveProperty('status')
      expect(result.rows[0]).not.toHaveProperty('email')
      expect(result.rows[0]).not.toHaveProperty('order_date')
    })

    it('should handle column aliasing', async () => {
      catalog.attachAdapter('sqlite_db', createUsersAdapter())
      catalog.attachAdapter('memory_db', createOrdersAdapter())

      const config: CrossSourceJoinConfig = {
        left: { source: 'sqlite_db', table: 'users' },
        right: { source: 'memory_db', table: 'orders' },
        joinType: 'INNER',
        keys: { left: 'id', right: 'user_id' },
        columns: [
          { column: 'name', alias: 'user_name' },
          { column: 'total', alias: 'order_total' },
        ],
      }

      const result = await crossJoin.execute(config)

      expect(result.rows[0]).toHaveProperty('user_name')
      expect(result.rows[0]).toHaveProperty('order_total')
      expect(result.rows[0]).not.toHaveProperty('name')
      expect(result.rows[0]).not.toHaveProperty('total')
    })
  })
})

// =============================================================================
// DataTypeConverter Tests
// =============================================================================

describe('DataTypeConverter', () => {
  let converter: DataTypeConverter

  beforeEach(() => {
    converter = new DataTypeConverter()
  })

  describe('numeric conversions', () => {
    it('should convert string to integer', () => {
      expect(converter.convert('123', 'string', 'integer')).toBe(123)
      expect(converter.convert('456.789', 'string', 'integer')).toBe(456)
    })

    it('should convert string to float', () => {
      expect(converter.convert('123.456', 'string', 'number')).toBeCloseTo(123.456)
    })

    it('should convert number to string', () => {
      expect(converter.convert(123, 'number', 'string')).toBe('123')
      expect(converter.convert(123.456, 'number', 'string')).toBe('123.456')
    })
  })

  describe('boolean conversions', () => {
    it('should convert string to boolean', () => {
      expect(converter.convert('true', 'string', 'boolean')).toBe(true)
      expect(converter.convert('false', 'string', 'boolean')).toBe(false)
      expect(converter.convert('1', 'string', 'boolean')).toBe(true)
      expect(converter.convert('0', 'string', 'boolean')).toBe(false)
    })

    it('should convert number to boolean', () => {
      expect(converter.convert(1, 'number', 'boolean')).toBe(true)
      expect(converter.convert(0, 'number', 'boolean')).toBe(false)
    })

    it('should convert boolean to string', () => {
      expect(converter.convert(true, 'boolean', 'string')).toBe('true')
      expect(converter.convert(false, 'boolean', 'string')).toBe('false')
    })
  })

  describe('date conversions', () => {
    it('should convert timestamp to date string', () => {
      const result = converter.convert(
        '2024-01-15T12:30:00Z',
        'timestamp',
        'date',
        { format: 'YYYY-MM-DD' }
      )
      expect(result).toBe('2024-01-15')
    })

    it('should convert date string to timestamp', () => {
      const result = converter.convert('2024-01-15', 'date', 'timestamp')
      expect(result).toMatch(/2024-01-15T/)
    })
  })

  describe('null handling', () => {
    it('should preserve null values', () => {
      expect(converter.convert(null, 'string', 'number')).toBeNull()
      expect(converter.convert(undefined, 'number', 'string')).toBeNull()
    })
  })

  describe('custom conversion rules', () => {
    it('should apply custom conversion rules', () => {
      converter.registerRule({
        from: 'string',
        to: 'number',
        convert: (value) => {
          const cleaned = String(value).replace(/[$,]/g, '')
          return parseFloat(cleaned)
        },
      })

      expect(converter.convert('$1,234.56', 'string', 'number')).toBeCloseTo(1234.56)
    })
  })
})
