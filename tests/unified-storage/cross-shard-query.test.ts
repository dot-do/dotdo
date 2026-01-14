/**
 * CrossShardQuery Tests - TDD RED Phase
 *
 * These tests define the expected behavior of the CrossShardQuery component
 * which enables querying data across all shards via Iceberg tables.
 *
 * CrossShardQuery provides:
 * - Global queries across all shards for Things and Events
 * - Filter by $type, namespace, and custom WHERE clauses
 * - ORDER BY, LIMIT, and OFFSET support
 * - Aggregations (COUNT, SUM, AVG) across shards
 * - Partition pruning for efficient queries
 * - Streaming results for large datasets
 * - Query caching for frequently executed queries
 *
 * These tests WILL FAIL because the CrossShardQuery implementation
 * does not exist yet. This is the TDD RED phase.
 *
 * Issue: do-2tr.3.3
 * Related: do-2tr.3.7 (GREEN phase implementation)
 *
 * @module tests/unified-storage/cross-shard-query
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ============================================================================
// IMPORTS - These MUST FAIL because the implementation doesn't exist yet
// ============================================================================

// This import will fail - the file doesn't exist
import {
  CrossShardQuery,
  type CrossShardQueryConfig,
  type GlobalQueryOptions,
  type GlobalQueryResult,
  type AggregationOptions,
  type AggregationResult,
  type QueryStats,
} from '../../objects/unified-storage/cross-shard-query'

// ============================================================================
// TYPE DEFINITIONS (Expected Interface)
// ============================================================================

/**
 * Thing stored in Iceberg
 */
interface Thing {
  $id: string
  $type: string
  $version: number
  $createdAt: number
  $updatedAt: number
  $ns: string // namespace (shard identifier)
  [key: string]: unknown
}

/**
 * Domain event stored in Iceberg
 */
interface DomainEvent {
  type: 'thing.created' | 'thing.updated' | 'thing.deleted'
  entityId: string
  entityType: string
  payload: Record<string, unknown>
  ts: number
  version: number
  ns: string
  idempotencyKey: string
}

/**
 * Mock Iceberg reader interface
 */
interface IcebergReader {
  query<T = Record<string, unknown>>(options: {
    table: string
    columns?: string[]
    where?: Record<string, unknown>
    orderBy?: Array<{ column: string; direction: 'asc' | 'desc' }>
    limit?: number
    offset?: number
    partitionFilter?: Record<string, unknown>
  }): Promise<{
    rows: T[]
    stats: {
      partitionsScanned: number
      filesScanned: number
      bytesScanned: number
      rowsScanned: number
    }
  }>

  aggregate<T = Record<string, unknown>>(options: {
    table: string
    groupBy?: string[]
    aggregations: Array<{
      function: 'COUNT' | 'SUM' | 'AVG' | 'MIN' | 'MAX'
      column?: string
      alias: string
    }>
    where?: Record<string, unknown>
    having?: Record<string, unknown>
    partitionFilter?: Record<string, unknown>
  }): Promise<{
    rows: T[]
    stats: {
      partitionsScanned: number
      filesScanned: number
      bytesScanned: number
      rowsScanned: number
    }
  }>

  stream<T = Record<string, unknown>>(options: {
    table: string
    batchSize?: number
    where?: Record<string, unknown>
    partitionFilter?: Record<string, unknown>
  }): AsyncIterable<T[]>
}

// ============================================================================
// MOCK FACTORIES
// ============================================================================

function createMockIcebergReader(data: {
  things?: Thing[]
  events?: DomainEvent[]
} = {}): IcebergReader {
  const things = data.things ?? []
  const events = data.events ?? []

  return {
    query: vi.fn(async (options) => {
      const source = options.table === 'do_things' ? things : events
      let rows = [...source]

      // Apply partition filter
      if (options.partitionFilter) {
        rows = rows.filter(row => {
          for (const [key, value] of Object.entries(options.partitionFilter!)) {
            if (row[key] !== value) return false
          }
          return true
        })
      }

      // Apply where filter
      if (options.where) {
        rows = rows.filter(row => {
          for (const [key, condition] of Object.entries(options.where!)) {
            const value = row[key]
            if (typeof condition === 'object' && condition !== null) {
              const ops = condition as Record<string, unknown>
              if ('$gt' in ops && !(Number(value) > Number(ops.$gt))) return false
              if ('$gte' in ops && !(Number(value) >= Number(ops.$gte))) return false
              if ('$lt' in ops && !(Number(value) < Number(ops.$lt))) return false
              if ('$lte' in ops && !(Number(value) <= Number(ops.$lte))) return false
              if ('$ne' in ops && value === ops.$ne) return false
              if ('$in' in ops && Array.isArray(ops.$in) && !ops.$in.includes(value)) return false
            } else {
              if (value !== condition) return false
            }
          }
          return true
        })
      }

      // Apply order by
      if (options.orderBy) {
        rows.sort((a, b) => {
          for (const { column, direction } of options.orderBy!) {
            const aVal = a[column] as number | string
            const bVal = b[column] as number | string
            if (aVal < bVal) return direction === 'asc' ? -1 : 1
            if (aVal > bVal) return direction === 'asc' ? 1 : -1
          }
          return 0
        })
      }

      // Apply offset
      if (options.offset) {
        rows = rows.slice(options.offset)
      }

      // Apply limit
      if (options.limit) {
        rows = rows.slice(0, options.limit)
      }

      return {
        rows: rows as unknown[],
        stats: {
          partitionsScanned: 1,
          filesScanned: 1,
          bytesScanned: JSON.stringify(rows).length,
          rowsScanned: rows.length,
        },
      }
    }),

    aggregate: vi.fn(async (options) => {
      const source = options.table === 'do_things' ? things : events
      let rows = [...source]

      // Apply partition filter
      if (options.partitionFilter) {
        rows = rows.filter(row => {
          for (const [key, value] of Object.entries(options.partitionFilter!)) {
            if (row[key] !== value) return false
          }
          return true
        })
      }

      // Apply where filter
      if (options.where) {
        rows = rows.filter(row => {
          for (const [key, condition] of Object.entries(options.where!)) {
            if (row[key] !== condition) return false
          }
          return true
        })
      }

      // Group rows
      const groups = new Map<string, unknown[]>()
      if (options.groupBy && options.groupBy.length > 0) {
        for (const row of rows) {
          const key = options.groupBy.map(col => String(row[col])).join('|')
          const group = groups.get(key) || []
          group.push(row)
          groups.set(key, group)
        }
      } else {
        groups.set('', rows)
      }

      // Compute aggregations
      const results: Record<string, unknown>[] = []
      for (const [key, groupRows] of groups) {
        const result: Record<string, unknown> = {}

        // Add group key columns
        if (options.groupBy && options.groupBy.length > 0 && groupRows.length > 0) {
          const firstRow = groupRows[0] as Record<string, unknown>
          for (const col of options.groupBy) {
            result[col] = firstRow[col]
          }
        }

        // Compute aggregations
        for (const agg of options.aggregations) {
          if (agg.function === 'COUNT') {
            result[agg.alias] = groupRows.length
          } else if (agg.function === 'SUM') {
            result[agg.alias] = groupRows.reduce((sum, row) => sum + Number((row as Record<string, unknown>)[agg.column!] ?? 0), 0)
          } else if (agg.function === 'AVG') {
            const sum = groupRows.reduce((s, row) => s + Number((row as Record<string, unknown>)[agg.column!] ?? 0), 0)
            result[agg.alias] = groupRows.length > 0 ? sum / groupRows.length : 0
          } else if (agg.function === 'MIN') {
            result[agg.alias] = Math.min(...groupRows.map(row => Number((row as Record<string, unknown>)[agg.column!] ?? Infinity)))
          } else if (agg.function === 'MAX') {
            result[agg.alias] = Math.max(...groupRows.map(row => Number((row as Record<string, unknown>)[agg.column!] ?? -Infinity)))
          }
        }

        results.push(result)
      }

      return {
        rows: results,
        stats: {
          partitionsScanned: 1,
          filesScanned: 1,
          bytesScanned: JSON.stringify(rows).length,
          rowsScanned: rows.length,
        },
      }
    }),

    stream: vi.fn(async function* (options) {
      const source = options.table === 'do_things' ? things : events
      const batchSize = options.batchSize ?? 100

      for (let i = 0; i < source.length; i += batchSize) {
        yield source.slice(i, i + batchSize) as unknown[]
      }
    }),
  }
}

function createTestThing(overrides: Partial<Thing> = {}): Thing {
  const now = Date.now()
  return {
    $id: `thing_${crypto.randomUUID()}`,
    $type: 'TestThing',
    $version: 1,
    $createdAt: now,
    $updatedAt: now,
    $ns: 'shard_0',
    ...overrides,
  }
}

function createTestEvent(
  type: DomainEvent['type'],
  thing: Partial<Thing>,
  overrides: Partial<DomainEvent> = {}
): DomainEvent {
  return {
    type,
    entityId: thing.$id ?? `thing_${crypto.randomUUID()}`,
    entityType: thing.$type ?? 'TestThing',
    payload: thing as Record<string, unknown>,
    ts: Date.now(),
    version: thing.$version ?? 1,
    ns: thing.$ns ?? 'shard_0',
    idempotencyKey: `${type}-${thing.$id}-${Date.now()}`,
    ...overrides,
  }
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('CrossShardQuery', () => {
  let icebergReader: IcebergReader
  let query: CrossShardQuery

  beforeEach(() => {
    icebergReader = createMockIcebergReader()
  })

  // ==========================================================================
  // GLOBAL QUERIES
  // ==========================================================================

  describe('global queries', () => {
    it('should query all Things across all shards', async () => {
      // Setup: Things distributed across multiple shards
      const things = [
        createTestThing({ $id: 'customer_1', $type: 'Customer', $ns: 'shard_0', name: 'Alice' }),
        createTestThing({ $id: 'customer_2', $type: 'Customer', $ns: 'shard_1', name: 'Bob' }),
        createTestThing({ $id: 'customer_3', $type: 'Customer', $ns: 'shard_2', name: 'Charlie' }),
        createTestThing({ $id: 'order_1', $type: 'Order', $ns: 'shard_0', total: 100 }),
        createTestThing({ $id: 'order_2', $type: 'Order', $ns: 'shard_1', total: 200 }),
      ]
      icebergReader = createMockIcebergReader({ things })

      query = new CrossShardQuery({
        iceberg: icebergReader,
      })

      // Act: Query all things
      const result = await query.queryThings({})

      // Assert: Should return all things from all shards
      expect(result.rows).toHaveLength(5)
      expect(result.rows.map(t => t.$id)).toEqual(
        expect.arrayContaining(['customer_1', 'customer_2', 'customer_3', 'order_1', 'order_2'])
      )

      // Stats should reflect cross-shard query
      expect(result.stats.shardsQueried).toBeGreaterThanOrEqual(1)
      expect(result.stats.totalRows).toBe(5)
    })

    it('should filter by $type', async () => {
      // Setup: Mix of types across shards
      const things = [
        createTestThing({ $id: 'customer_1', $type: 'Customer', $ns: 'shard_0', name: 'Alice' }),
        createTestThing({ $id: 'customer_2', $type: 'Customer', $ns: 'shard_1', name: 'Bob' }),
        createTestThing({ $id: 'order_1', $type: 'Order', $ns: 'shard_0', total: 100 }),
        createTestThing({ $id: 'product_1', $type: 'Product', $ns: 'shard_2', name: 'Widget' }),
      ]
      icebergReader = createMockIcebergReader({ things })

      query = new CrossShardQuery({
        iceberg: icebergReader,
      })

      // Act: Query only Customers
      const result = await query.queryThings({
        type: 'Customer',
      })

      // Assert: Should only return Customer type
      expect(result.rows).toHaveLength(2)
      expect(result.rows.every(t => t.$type === 'Customer')).toBe(true)
      expect(result.rows.map(t => t.$id)).toEqual(
        expect.arrayContaining(['customer_1', 'customer_2'])
      )
    })

    it('should filter by namespace', async () => {
      // Setup: Things in different namespaces (shards)
      const things = [
        createTestThing({ $id: 'thing_1', $type: 'Item', $ns: 'tenant_a.shard_0' }),
        createTestThing({ $id: 'thing_2', $type: 'Item', $ns: 'tenant_a.shard_1' }),
        createTestThing({ $id: 'thing_3', $type: 'Item', $ns: 'tenant_b.shard_0' }),
        createTestThing({ $id: 'thing_4', $type: 'Item', $ns: 'tenant_b.shard_1' }),
      ]
      icebergReader = createMockIcebergReader({ things })

      query = new CrossShardQuery({
        iceberg: icebergReader,
      })

      // Act: Query only tenant_a namespace
      const result = await query.queryThings({
        namespace: 'tenant_a',
      })

      // Assert: Should only return tenant_a things
      expect(result.rows).toHaveLength(2)
      expect(result.rows.every(t => t.$ns.startsWith('tenant_a'))).toBe(true)
    })

    it('should support WHERE clauses', async () => {
      // Setup: Things with various properties
      const things = [
        createTestThing({ $id: 'order_1', $type: 'Order', $ns: 'shard_0', total: 50, status: 'pending' }),
        createTestThing({ $id: 'order_2', $type: 'Order', $ns: 'shard_0', total: 150, status: 'completed' }),
        createTestThing({ $id: 'order_3', $type: 'Order', $ns: 'shard_1', total: 75, status: 'pending' }),
        createTestThing({ $id: 'order_4', $type: 'Order', $ns: 'shard_1', total: 200, status: 'completed' }),
      ]
      icebergReader = createMockIcebergReader({ things })

      query = new CrossShardQuery({
        iceberg: icebergReader,
      })

      // Act: Query with WHERE clause
      const result = await query.queryThings({
        where: {
          total: { $gte: 100 },
          status: 'completed',
        },
      })

      // Assert: Should filter by WHERE conditions
      expect(result.rows).toHaveLength(2)
      expect(result.rows.every(t => (t.total as number) >= 100)).toBe(true)
      expect(result.rows.every(t => t.status === 'completed')).toBe(true)
    })

    it('should support ORDER BY', async () => {
      // Setup: Things to be sorted
      const things = [
        createTestThing({ $id: 'order_3', $type: 'Order', $ns: 'shard_0', total: 300 }),
        createTestThing({ $id: 'order_1', $type: 'Order', $ns: 'shard_1', total: 100 }),
        createTestThing({ $id: 'order_2', $type: 'Order', $ns: 'shard_2', total: 200 }),
      ]
      icebergReader = createMockIcebergReader({ things })

      query = new CrossShardQuery({
        iceberg: icebergReader,
      })

      // Act: Query with ORDER BY total DESC
      const result = await query.queryThings({
        orderBy: [{ column: 'total', direction: 'desc' }],
      })

      // Assert: Should be sorted by total descending
      expect(result.rows).toHaveLength(3)
      expect(result.rows[0].total).toBe(300)
      expect(result.rows[1].total).toBe(200)
      expect(result.rows[2].total).toBe(100)
    })

    it('should support LIMIT and OFFSET', async () => {
      // Setup: Many things for pagination
      const things = Array.from({ length: 100 }, (_, i) =>
        createTestThing({
          $id: `thing_${i}`,
          $type: 'Item',
          $ns: `shard_${i % 4}`,
          index: i,
        })
      )
      icebergReader = createMockIcebergReader({ things })

      query = new CrossShardQuery({
        iceberg: icebergReader,
      })

      // Act: Query with pagination
      const page1 = await query.queryThings({
        limit: 10,
        offset: 0,
        orderBy: [{ column: 'index', direction: 'asc' }],
      })

      const page2 = await query.queryThings({
        limit: 10,
        offset: 10,
        orderBy: [{ column: 'index', direction: 'asc' }],
      })

      // Assert: Should return paginated results
      expect(page1.rows).toHaveLength(10)
      expect(page2.rows).toHaveLength(10)

      // Pages should be different
      expect(page1.rows[0].$id).not.toBe(page2.rows[0].$id)

      // First page should have indices 0-9
      expect((page1.rows[0] as Thing).index).toBe(0)
      expect((page1.rows[9] as Thing).index).toBe(9)

      // Second page should have indices 10-19
      expect((page2.rows[0] as Thing).index).toBe(10)
      expect((page2.rows[9] as Thing).index).toBe(19)
    })
  })

  // ==========================================================================
  // AGGREGATIONS
  // ==========================================================================

  describe('aggregations', () => {
    it('should count things across shards', async () => {
      // Setup: Things distributed across shards
      const things = [
        createTestThing({ $id: 'c_1', $type: 'Customer', $ns: 'shard_0' }),
        createTestThing({ $id: 'c_2', $type: 'Customer', $ns: 'shard_1' }),
        createTestThing({ $id: 'c_3', $type: 'Customer', $ns: 'shard_2' }),
        createTestThing({ $id: 'o_1', $type: 'Order', $ns: 'shard_0' }),
        createTestThing({ $id: 'o_2', $type: 'Order', $ns: 'shard_1' }),
      ]
      icebergReader = createMockIcebergReader({ things })

      query = new CrossShardQuery({
        iceberg: icebergReader,
      })

      // Act: Count all things
      const result = await query.aggregateThings({
        aggregations: [{ function: 'COUNT', alias: 'total_count' }],
      })

      // Assert: Should return total count
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].total_count).toBe(5)
    })

    it('should sum numeric fields across shards', async () => {
      // Setup: Orders with amounts
      const things = [
        createTestThing({ $id: 'o_1', $type: 'Order', $ns: 'shard_0', amount: 100 }),
        createTestThing({ $id: 'o_2', $type: 'Order', $ns: 'shard_1', amount: 250 }),
        createTestThing({ $id: 'o_3', $type: 'Order', $ns: 'shard_2', amount: 150 }),
      ]
      icebergReader = createMockIcebergReader({ things })

      query = new CrossShardQuery({
        iceberg: icebergReader,
      })

      // Act: Sum amounts
      const result = await query.aggregateThings({
        where: { $type: 'Order' },
        aggregations: [{ function: 'SUM', column: 'amount', alias: 'total_amount' }],
      })

      // Assert: Should return sum
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].total_amount).toBe(500)
    })

    it('should compute averages across shards', async () => {
      // Setup: Products with prices
      const things = [
        createTestThing({ $id: 'p_1', $type: 'Product', $ns: 'shard_0', price: 10 }),
        createTestThing({ $id: 'p_2', $type: 'Product', $ns: 'shard_1', price: 20 }),
        createTestThing({ $id: 'p_3', $type: 'Product', $ns: 'shard_2', price: 30 }),
        createTestThing({ $id: 'p_4', $type: 'Product', $ns: 'shard_3', price: 40 }),
      ]
      icebergReader = createMockIcebergReader({ things })

      query = new CrossShardQuery({
        iceberg: icebergReader,
      })

      // Act: Compute average
      const result = await query.aggregateThings({
        where: { $type: 'Product' },
        aggregations: [{ function: 'AVG', column: 'price', alias: 'avg_price' }],
      })

      // Assert: Should return average (10+20+30+40)/4 = 25
      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].avg_price).toBe(25)
    })

    it('should group by field', async () => {
      // Setup: Orders by status
      const things = [
        createTestThing({ $id: 'o_1', $type: 'Order', $ns: 'shard_0', status: 'pending', amount: 100 }),
        createTestThing({ $id: 'o_2', $type: 'Order', $ns: 'shard_0', status: 'completed', amount: 200 }),
        createTestThing({ $id: 'o_3', $type: 'Order', $ns: 'shard_1', status: 'pending', amount: 150 }),
        createTestThing({ $id: 'o_4', $type: 'Order', $ns: 'shard_1', status: 'completed', amount: 250 }),
        createTestThing({ $id: 'o_5', $type: 'Order', $ns: 'shard_2', status: 'cancelled', amount: 50 }),
      ]
      icebergReader = createMockIcebergReader({ things })

      query = new CrossShardQuery({
        iceberg: icebergReader,
      })

      // Act: Group by status
      const result = await query.aggregateThings({
        where: { $type: 'Order' },
        groupBy: ['status'],
        aggregations: [
          { function: 'COUNT', alias: 'order_count' },
          { function: 'SUM', column: 'amount', alias: 'total_amount' },
        ],
      })

      // Assert: Should return grouped results
      expect(result.rows).toHaveLength(3)

      const pending = result.rows.find(r => r.status === 'pending')
      expect(pending).toBeDefined()
      expect(pending!.order_count).toBe(2)
      expect(pending!.total_amount).toBe(250) // 100 + 150

      const completed = result.rows.find(r => r.status === 'completed')
      expect(completed).toBeDefined()
      expect(completed!.order_count).toBe(2)
      expect(completed!.total_amount).toBe(450) // 200 + 250

      const cancelled = result.rows.find(r => r.status === 'cancelled')
      expect(cancelled).toBeDefined()
      expect(cancelled!.order_count).toBe(1)
      expect(cancelled!.total_amount).toBe(50)
    })
  })

  // ==========================================================================
  // ICEBERG INTEGRATION
  // ==========================================================================

  describe('Iceberg integration', () => {
    it('should query do_events table', async () => {
      // Setup: Events across shards
      const events = [
        createTestEvent('thing.created', { $id: 'c_1', $type: 'Customer', $ns: 'shard_0' }),
        createTestEvent('thing.updated', { $id: 'c_1', $type: 'Customer', $ns: 'shard_0' }),
        createTestEvent('thing.created', { $id: 'c_2', $type: 'Customer', $ns: 'shard_1' }),
        createTestEvent('thing.deleted', { $id: 'c_1', $type: 'Customer', $ns: 'shard_0' }),
      ]
      icebergReader = createMockIcebergReader({ events })

      query = new CrossShardQuery({
        iceberg: icebergReader,
      })

      // Act: Query events
      const result = await query.queryEvents({})

      // Assert: Should return all events
      expect(result.rows).toHaveLength(4)
      expect(icebergReader.query).toHaveBeenCalledWith(
        expect.objectContaining({
          table: 'do_events',
        })
      )
    })

    it('should query do_things table', async () => {
      // Setup: Things in Iceberg
      const things = [
        createTestThing({ $id: 't_1', $type: 'Test', $ns: 'shard_0' }),
        createTestThing({ $id: 't_2', $type: 'Test', $ns: 'shard_1' }),
      ]
      icebergReader = createMockIcebergReader({ things })

      query = new CrossShardQuery({
        iceberg: icebergReader,
      })

      // Act: Query things
      const result = await query.queryThings({})

      // Assert: Should query do_things table
      expect(result.rows).toHaveLength(2)
      expect(icebergReader.query).toHaveBeenCalledWith(
        expect.objectContaining({
          table: 'do_things',
        })
      )
    })

    it('should use partition pruning', async () => {
      // Setup: Things in specific partitions (namespaces)
      const things = [
        createTestThing({ $id: 't_1', $type: 'Test', $ns: 'tenant_a' }),
        createTestThing({ $id: 't_2', $type: 'Test', $ns: 'tenant_b' }),
        createTestThing({ $id: 't_3', $type: 'Test', $ns: 'tenant_a' }),
      ]
      icebergReader = createMockIcebergReader({ things })

      query = new CrossShardQuery({
        iceberg: icebergReader,
      })

      // Act: Query with namespace filter (should prune partitions)
      const result = await query.queryThings({
        namespace: 'tenant_a',
      })

      // Assert: Should use partition pruning
      expect(icebergReader.query).toHaveBeenCalledWith(
        expect.objectContaining({
          partitionFilter: expect.objectContaining({
            $ns: 'tenant_a',
          }),
        })
      )

      // Stats should show partition pruning was used
      expect(result.stats.partitionsPruned).toBeGreaterThanOrEqual(0)
    })

    it('should handle large result sets', async () => {
      // Setup: Large dataset
      const things = Array.from({ length: 10000 }, (_, i) =>
        createTestThing({
          $id: `thing_${i}`,
          $type: 'LargeItem',
          $ns: `shard_${i % 8}`,
          index: i,
        })
      )
      icebergReader = createMockIcebergReader({ things })

      query = new CrossShardQuery({
        iceberg: icebergReader,
      })

      // Act: Query all
      const result = await query.queryThings({})

      // Assert: Should handle large result set
      expect(result.rows).toHaveLength(10000)
      expect(result.stats.totalRows).toBe(10000)
    })
  })

  // ==========================================================================
  // PERFORMANCE
  // ==========================================================================

  describe('performance', () => {
    it('should timeout long-running queries', async () => {
      // Setup: Mock slow query
      const slowReader: IcebergReader = {
        query: vi.fn(async () => {
          await new Promise(resolve => setTimeout(resolve, 5000))
          return { rows: [], stats: { partitionsScanned: 0, filesScanned: 0, bytesScanned: 0, rowsScanned: 0 } }
        }),
        aggregate: vi.fn(async () => ({ rows: [], stats: { partitionsScanned: 0, filesScanned: 0, bytesScanned: 0, rowsScanned: 0 } })),
        stream: vi.fn(async function* () { yield [] }),
      }

      query = new CrossShardQuery({
        iceberg: slowReader,
        timeout: 100, // 100ms timeout
      })

      // Act & Assert: Should timeout
      await expect(query.queryThings({})).rejects.toThrow(/timeout|timed out/i)
    })

    it('should stream results for large queries', async () => {
      // Setup: Large dataset
      const things = Array.from({ length: 1000 }, (_, i) =>
        createTestThing({
          $id: `thing_${i}`,
          $type: 'StreamItem',
          $ns: `shard_${i % 4}`,
          index: i,
        })
      )
      icebergReader = createMockIcebergReader({ things })

      query = new CrossShardQuery({
        iceberg: icebergReader,
      })

      // Act: Stream results
      const batches: Thing[][] = []
      for await (const batch of query.streamThings({ batchSize: 100 })) {
        batches.push(batch as Thing[])
      }

      // Assert: Should stream in batches
      expect(batches.length).toBeGreaterThan(1)
      expect(batches.flat()).toHaveLength(1000)

      // Each batch should respect batch size
      for (const batch of batches.slice(0, -1)) {
        expect(batch.length).toBeLessThanOrEqual(100)
      }
    })

    it('should cache frequent queries', async () => {
      // Setup: Simple dataset
      const things = [
        createTestThing({ $id: 't_1', $type: 'CachedItem', $ns: 'shard_0' }),
        createTestThing({ $id: 't_2', $type: 'CachedItem', $ns: 'shard_1' }),
      ]
      icebergReader = createMockIcebergReader({ things })

      query = new CrossShardQuery({
        iceberg: icebergReader,
        cacheEnabled: true,
        cacheTTL: 60_000, // 1 minute cache
      })

      // Act: Execute same query multiple times
      const result1 = await query.queryThings({ type: 'CachedItem' })
      const result2 = await query.queryThings({ type: 'CachedItem' })
      const result3 = await query.queryThings({ type: 'CachedItem' })

      // Assert: Should return same results
      expect(result1.rows).toEqual(result2.rows)
      expect(result2.rows).toEqual(result3.rows)

      // Should use cache (only one actual query)
      expect(icebergReader.query).toHaveBeenCalledTimes(1)

      // Stats should indicate cache hit
      expect(result2.stats.cacheHit).toBe(true)
      expect(result3.stats.cacheHit).toBe(true)
    })
  })

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle empty result set', async () => {
      // Setup: No data
      icebergReader = createMockIcebergReader({ things: [], events: [] })

      query = new CrossShardQuery({
        iceberg: icebergReader,
      })

      // Act: Query
      const result = await query.queryThings({})

      // Assert: Should return empty result
      expect(result.rows).toHaveLength(0)
      expect(result.stats.totalRows).toBe(0)
    })

    it('should handle invalid query options gracefully', async () => {
      icebergReader = createMockIcebergReader({
        things: [createTestThing({ $id: 't_1', $type: 'Test', $ns: 'shard_0' })],
      })

      query = new CrossShardQuery({
        iceberg: icebergReader,
      })

      // Act & Assert: Invalid offset should be handled
      const result = await query.queryThings({
        limit: 10,
        offset: -5, // Invalid negative offset
      })

      // Should treat invalid offset as 0
      expect(result.rows).toBeDefined()
    })

    it('should handle concurrent queries', async () => {
      // Setup: Dataset
      const things = Array.from({ length: 100 }, (_, i) =>
        createTestThing({
          $id: `thing_${i}`,
          $type: 'ConcurrentItem',
          $ns: `shard_${i % 4}`,
        })
      )
      icebergReader = createMockIcebergReader({ things })

      query = new CrossShardQuery({
        iceberg: icebergReader,
      })

      // Act: Execute concurrent queries
      const results = await Promise.all([
        query.queryThings({ type: 'ConcurrentItem', limit: 10 }),
        query.queryThings({ type: 'ConcurrentItem', limit: 20 }),
        query.queryThings({ type: 'ConcurrentItem', limit: 30 }),
      ])

      // Assert: All queries should succeed
      expect(results[0].rows).toHaveLength(10)
      expect(results[1].rows).toHaveLength(20)
      expect(results[2].rows).toHaveLength(30)
    })

    it('should handle Iceberg reader errors', async () => {
      // Setup: Reader that throws
      const errorReader: IcebergReader = {
        query: vi.fn(async () => {
          throw new Error('Iceberg connection failed')
        }),
        aggregate: vi.fn(async () => {
          throw new Error('Iceberg connection failed')
        }),
        stream: vi.fn(async function* () {
          throw new Error('Iceberg connection failed')
        }),
      }

      query = new CrossShardQuery({
        iceberg: errorReader,
      })

      // Act & Assert: Should propagate error
      await expect(query.queryThings({})).rejects.toThrow('Iceberg connection failed')
    })

    it('should handle multiple GROUP BY columns', async () => {
      // Setup: Things with multiple groupable fields
      const things = [
        createTestThing({ $id: 'o_1', $type: 'Order', $ns: 'shard_0', region: 'US', status: 'completed', amount: 100 }),
        createTestThing({ $id: 'o_2', $type: 'Order', $ns: 'shard_0', region: 'US', status: 'pending', amount: 50 }),
        createTestThing({ $id: 'o_3', $type: 'Order', $ns: 'shard_1', region: 'EU', status: 'completed', amount: 200 }),
        createTestThing({ $id: 'o_4', $type: 'Order', $ns: 'shard_1', region: 'EU', status: 'pending', amount: 75 }),
        createTestThing({ $id: 'o_5', $type: 'Order', $ns: 'shard_2', region: 'US', status: 'completed', amount: 150 }),
      ]
      icebergReader = createMockIcebergReader({ things })

      query = new CrossShardQuery({
        iceberg: icebergReader,
      })

      // Act: Group by region and status
      const result = await query.aggregateThings({
        where: { $type: 'Order' },
        groupBy: ['region', 'status'],
        aggregations: [
          { function: 'COUNT', alias: 'count' },
          { function: 'SUM', column: 'amount', alias: 'total' },
        ],
      })

      // Assert: Should have 4 groups (US-completed, US-pending, EU-completed, EU-pending)
      expect(result.rows.length).toBe(4)

      const usCompleted = result.rows.find(r => r.region === 'US' && r.status === 'completed')
      expect(usCompleted).toBeDefined()
      expect(usCompleted!.count).toBe(2)
      expect(usCompleted!.total).toBe(250) // 100 + 150
    })
  })

  // ==========================================================================
  // CONSTRUCTOR AND CONFIG
  // ==========================================================================

  describe('constructor and config', () => {
    it('should create with iceberg reader', () => {
      query = new CrossShardQuery({
        iceberg: icebergReader,
      })

      expect(query).toBeInstanceOf(CrossShardQuery)
    })

    it('should accept timeout configuration', () => {
      query = new CrossShardQuery({
        iceberg: icebergReader,
        timeout: 30_000,
      })

      expect(query.config.timeout).toBe(30_000)
    })

    it('should accept cache configuration', () => {
      query = new CrossShardQuery({
        iceberg: icebergReader,
        cacheEnabled: true,
        cacheTTL: 120_000,
        cacheMaxSize: 1000,
      })

      expect(query.config.cacheEnabled).toBe(true)
      expect(query.config.cacheTTL).toBe(120_000)
      expect(query.config.cacheMaxSize).toBe(1000)
    })

    it('should use default config values', () => {
      query = new CrossShardQuery({
        iceberg: icebergReader,
      })

      expect(query.config.timeout).toBe(30_000) // Default timeout
      expect(query.config.cacheEnabled).toBe(false) // Cache off by default
    })
  })
})
