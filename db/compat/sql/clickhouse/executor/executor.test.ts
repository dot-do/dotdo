/**
 * Distributed Query Executor Tests
 *
 * Tests for the distributed query execution system with Cap'n Web RPC.
 *
 * Run: npx vitest run db/compat/sql/clickhouse/executor/executor.test.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  QueryExecutor,
  Coordinator,
  ExecutorWorker,
  QueryResult,
  QueryPlan,
  QueryStats,
  ChunkStream,
  ExecutorConfig,
} from './index'

// ============================================================================
// LOCAL EXECUTION TESTS
// ============================================================================

describe('QueryExecutor', () => {
  let executor: QueryExecutor

  beforeEach(() => {
    executor = new QueryExecutor()
  })

  describe('simple SELECT', () => {
    it('executes simple SELECT locally', async () => {
      const result = await executor.execute('SELECT 1 + 1 as sum')
      expect(result.rows[0].sum).toBe(2)
    })

    it('executes SELECT with multiple expressions', async () => {
      const result = await executor.execute('SELECT 2 * 3 as product, 10 - 4 as diff')
      expect(result.rows[0].product).toBe(6)
      expect(result.rows[0].diff).toBe(6)
    })

    it('executes SELECT with string literals', async () => {
      const result = await executor.execute("SELECT 'hello' as greeting")
      expect(result.rows[0].greeting).toBe('hello')
    })

    it('executes SELECT with boolean expressions', async () => {
      const result = await executor.execute('SELECT 1 > 0 as is_positive, 1 < 0 as is_negative')
      expect(result.rows[0].is_positive).toBe(true)
      expect(result.rows[0].is_negative).toBe(false)
    })
  })

  describe('aggregations', () => {
    it('executes count(*)', async () => {
      // Seed with test data
      await executor.seedTestData('things', [
        { $id: '1', $type: 'event', data: {} },
        { $id: '2', $type: 'event', data: {} },
        { $id: '3', $type: 'event', data: {} },
      ])

      const result = await executor.execute('SELECT count(*) as cnt FROM things')
      expect(result.rows[0].cnt).toBe(3)
    })

    it('executes sum', async () => {
      await executor.seedTestData('things', [
        { $id: '1', $type: 'order', data: { amount: 100 } },
        { $id: '2', $type: 'order', data: { amount: 200 } },
        { $id: '3', $type: 'order', data: { amount: 300 } },
      ])

      const result = await executor.execute("SELECT sum(data->>'$.amount') as total FROM things")
      expect(result.rows[0].total).toBe(600)
    })
  })

  describe('WHERE clauses', () => {
    it('filters with equality', async () => {
      await executor.seedTestData('things', [
        { id: '1', type: 'event', data: {} },
        { id: '2', type: 'user', data: {} },
        { id: '3', type: 'event', data: {} },
      ])

      const result = await executor.execute("SELECT count(*) as cnt FROM things WHERE type = 'event'")
      expect(result.rows[0].cnt).toBe(2)
    })

    it('filters with JSON path', async () => {
      await executor.seedTestData('things', [
        { id: '1', type: 'user', data: { email: 'alice@example.com' } },
        { id: '2', type: 'user', data: { email: 'bob@example.com' } },
      ])

      const result = await executor.execute(`
        SELECT * FROM things WHERE data->>'$.email' = 'alice@example.com'
      `)
      expect(result.rows.length).toBe(1)
      expect(result.rows[0].id).toBe('1')
    })
  })
})

// ============================================================================
// DISTRIBUTED EXECUTION TESTS
// ============================================================================

describe('Coordinator', () => {
  let coordinator: Coordinator

  beforeEach(() => {
    coordinator = new Coordinator({
      executors: 4,
      chunkSize: 1000,
    })
  })

  describe('distributed scan', () => {
    it('distributes scan across Executor Workers', async () => {
      // Seed test data across partitions
      await coordinator.seedTestData('things', generateTestThings(10000, 'event'))

      const result = await coordinator.execute(`
        SELECT count(*) FROM things WHERE type = 'event'
      `)

      // Should have used multiple executors
      expect(coordinator.lastQueryStats.executorsUsed).toBeGreaterThan(1)
      expect(result.rows[0]['count(*)']).toBe(10000)
    })

    it('performs distributed aggregation', async () => {
      // Seed with different types
      await coordinator.seedTestData('things', [
        ...generateTestThings(1000, 'user'),
        ...generateTestThings(2000, 'event'),
        ...generateTestThings(500, 'order'),
      ])

      const result = await coordinator.execute(`
        SELECT type, count(*) as cnt
        FROM things
        GROUP BY type
        ORDER BY cnt DESC
      `)

      // Partial aggregation in executors, final merge in coordinator
      expect(result.rows.length).toBe(3)
      expect(result.rows[0].type).toBe('event')
      expect(result.rows[0].cnt).toBe(2000)
      expect(result.rows[1].type).toBe('user')
      expect(result.rows[1].cnt).toBe(1000)
      expect(result.rows[2].type).toBe('order')
      expect(result.rows[2].cnt).toBe(500)
    })

    it('handles distributed JOIN', async () => {
      await coordinator.seedTestData('users', [
        { id: 'u1', name: 'Alice' },
        { id: 'u2', name: 'Bob' },
      ])
      await coordinator.seedTestData('orders', [
        { id: 'o1', user_id: 'u1', amount: 100 },
        { id: 'o2', user_id: 'u1', amount: 200 },
        { id: 'o3', user_id: 'u2', amount: 150 },
      ])

      const result = await coordinator.execute(`
        SELECT u.name, sum(o.amount) as total
        FROM users u
        JOIN orders o ON u.id = o.user_id
        GROUP BY u.name
        ORDER BY total DESC
      `)

      expect(result.rows.length).toBe(2)
      expect(result.rows[0].name).toBe('Alice')
      expect(result.rows[0].total).toBe(300)
    })
  })

  describe('streaming results', () => {
    it('streams results for large queries', async () => {
      await coordinator.seedTestData('things', generateTestThings(100000, 'event'))

      const stream = coordinator.executeStream('SELECT * FROM things LIMIT 100000')

      let rowCount = 0
      for await (const chunk of stream) {
        rowCount += chunk.rowCount
        expect(chunk.rowCount).toBeLessThanOrEqual(10000) // Chunked
      }
      expect(rowCount).toBe(100000)
    })

    it('provides progress updates during streaming', async () => {
      await coordinator.seedTestData('things', generateTestThings(100000, 'event'))

      const stream = coordinator.executeStream('SELECT * FROM things')
      const progressUpdates: number[] = []

      for await (const chunk of stream) {
        if (chunk.progress !== undefined) {
          progressUpdates.push(chunk.progress)
        }
      }

      // Should have multiple progress updates
      expect(progressUpdates.length).toBeGreaterThan(1)
      // Last update should be 100%
      expect(progressUpdates[progressUpdates.length - 1]).toBe(100)
    })
  })

  describe('failure handling', () => {
    it('handles executor failure with retry', async () => {
      await coordinator.seedTestData('things', generateTestThings(10000, 'event'))

      // Simulate one executor failing
      coordinator.simulateFailure('executor-2')

      const result = await coordinator.execute('SELECT count(*) FROM things')
      expect(result.success).toBe(true) // Should retry on another executor
      expect(result.rows[0]['count(*)']).toBe(10000)
    })

    it('fails after max retries exceeded', async () => {
      await coordinator.seedTestData('things', generateTestThings(1000, 'event'))

      // Simulate all executors failing
      coordinator.simulateFailure('executor-0')
      coordinator.simulateFailure('executor-1')
      coordinator.simulateFailure('executor-2')
      coordinator.simulateFailure('executor-3')

      await expect(coordinator.execute('SELECT count(*) FROM things')).rejects.toThrow(
        /all executors failed/i
      )
    })

    it('reports partial results on timeout', async () => {
      await coordinator.seedTestData('things', generateTestThings(1000000, 'event'))

      // Set very short timeout
      coordinator.setTimeout(10) // 10ms

      const result = await coordinator.execute('SELECT * FROM things', {
        allowPartialResults: true,
      })

      expect(result.partial).toBe(true)
      expect(result.rows.length).toBeGreaterThan(0)
      expect(result.rows.length).toBeLessThan(1000000)
    })
  })

  describe('query planning', () => {
    it('generates query plan for simple SELECT', async () => {
      const plan = await coordinator.explain('SELECT * FROM things')

      expect(plan.nodes.length).toBeGreaterThan(0)
      expect(plan.nodes[0].operation).toBe('scan')
    })

    it('uses index hints for optimization', async () => {
      // Create index on email
      await coordinator.createIndex('things', 'data.user.email', 'bloom_filter')

      const plan = await coordinator.explain(`
        SELECT * FROM things
        WHERE data->>'$.user.email' = 'alice@example.com'
      `)

      expect(plan.usesIndex).toBe(true)
      expect(plan.indexType).toBe('bloom_filter')
    })

    it('optimizes aggregation with pre-aggregation', async () => {
      const plan = await coordinator.explain(`
        SELECT type, count(*) FROM things GROUP BY type
      `)

      // Should show partial aggregation in executors
      expect(plan.nodes.some((n) => n.operation === 'partial_aggregate')).toBe(true)
      expect(plan.nodes.some((n) => n.operation === 'final_aggregate')).toBe(true)
    })
  })
})

// ============================================================================
// EXECUTOR WORKER TESTS
// ============================================================================

describe('ExecutorWorker', () => {
  let worker: ExecutorWorker

  beforeEach(() => {
    worker = new ExecutorWorker()
  })

  describe('plan execution', () => {
    it('executes scan plan', async () => {
      await worker.seedTestData([
        { $id: '1', $type: 'event', data: {} },
        { $id: '2', $type: 'event', data: {} },
      ])

      const plan: QueryPlan = {
        id: 'scan-1',
        operation: 'scan',
        params: {
          type: 'scan',
          table: 'things',
          columns: ['$id', '$type'],
        },
      }

      const chunks: any[] = []
      for await (const chunk of worker.execute(plan, ['partition-0'])) {
        chunks.push(chunk)
      }

      // Should return data chunks
      expect(chunks.length).toBeGreaterThan(0)
      const totalRows = chunks.reduce((sum, c) => sum + c.rowCount, 0)
      expect(totalRows).toBe(2)
    })

    it('executes filter plan', async () => {
      await worker.seedTestData([
        { $id: '1', $type: 'user', data: {} },
        { $id: '2', $type: 'event', data: {} },
        { $id: '3', $type: 'user', data: {} },
      ])

      const plan: QueryPlan = {
        id: 'filter-1',
        operation: 'filter',
        params: {
          type: 'filter',
          expression: "$type = 'user'",
        },
        children: [
          {
            id: 'scan-1',
            operation: 'scan',
            params: {
              type: 'scan',
              table: 'things',
              columns: ['$id', '$type'],
            },
          },
        ],
      }

      const chunks: any[] = []
      for await (const chunk of worker.execute(plan, ['partition-0'])) {
        chunks.push(chunk)
      }

      const totalRows = chunks.reduce((sum, c) => sum + c.rowCount, 0)
      expect(totalRows).toBe(2) // Only users
    })

    it('executes partial aggregation', async () => {
      await worker.seedTestData([
        { $id: '1', $type: 'event', data: {} },
        { $id: '2', $type: 'event', data: {} },
        { $id: '3', $type: 'user', data: {} },
      ])

      const plan: QueryPlan = {
        id: 'agg-1',
        operation: 'aggregate',
        params: {
          type: 'aggregate',
          groupBy: ['$type'],
          aggregations: [{ function: 'count', alias: 'cnt' }],
        },
        children: [
          {
            id: 'scan-1',
            operation: 'scan',
            params: {
              type: 'scan',
              table: 'things',
              columns: ['$type'],
            },
          },
        ],
      }

      const chunks: any[] = []
      for await (const chunk of worker.execute(plan, ['partition-0'])) {
        chunks.push(chunk)
      }

      // Should have partial aggregation results
      const allRows = chunks.flatMap((c) => {
        const rows: any[] = []
        for (let i = 0; i < c.rowCount; i++) {
          const row: any = {}
          for (const col of Object.keys(c.data)) {
            row[col] = c.data[col][i]
          }
          rows.push(row)
        }
        return rows
      })

      expect(allRows.length).toBe(2) // Two groups: event, user
      expect(allRows.find((r) => r.$type === 'event').cnt).toBe(2)
      expect(allRows.find((r) => r.$type === 'user').cnt).toBe(1)
    })
  })

  describe('RPC communication', () => {
    it('receives plan via RPC', async () => {
      const plan: QueryPlan = {
        id: 'rpc-test',
        operation: 'scan',
        params: {
          type: 'scan',
          table: 'things',
          columns: ['$id'],
        },
      }

      // Simulate RPC request
      const request = worker.createRPCRequest({
        queryId: 'q1',
        plan,
        partitions: ['p0'],
      })

      expect(request).toBeDefined()
      expect(request.method).toBe('execute')
      expect(request.params.plan.id).toBe('rpc-test')
    })

    it('streams chunks via RPC', async () => {
      await worker.seedTestData(generateTestThings(100, 'event'))

      const plan: QueryPlan = {
        id: 'stream-test',
        operation: 'scan',
        params: {
          type: 'scan',
          table: 'things',
          columns: ['$id', '$type'],
        },
      }

      const chunks: any[] = []
      for await (const chunk of worker.execute(plan, ['p0'], { chunkSize: 10 })) {
        chunks.push(chunk)
      }

      // Should stream in chunks
      expect(chunks.length).toBeGreaterThan(1)
      for (const chunk of chunks.slice(0, -1)) {
        expect(chunk.rowCount).toBeLessThanOrEqual(10)
      }
    })
  })
})

// ============================================================================
// RPC LATENCY TESTS
// ============================================================================

describe('RPC Latency', () => {
  let coordinator: Coordinator

  beforeEach(() => {
    coordinator = new Coordinator({ executors: 4 })
  })

  it('achieves sub-1ms RPC latency for small payloads', async () => {
    const iterations = 100
    const latencies: number[] = []

    for (let i = 0; i < iterations; i++) {
      const start = performance.now()
      await coordinator.ping('executor-0')
      latencies.push(performance.now() - start)
    }

    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length
    const p95 = latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)]

    console.log(`RPC Latency - Avg: ${avgLatency.toFixed(3)}ms, P95: ${p95.toFixed(3)}ms`)

    expect(p95).toBeLessThan(1) // Sub-1ms P95
  })

  it('pipelines multiple RPC calls efficiently', async () => {
    await coordinator.seedTestData('things', generateTestThings(1000, 'event'))

    const start = performance.now()

    // Execute multiple queries in parallel using promise pipelining
    const results = await Promise.all([
      coordinator.execute('SELECT count(*) FROM things'),
      coordinator.execute("SELECT count(*) FROM things WHERE type = 'event'"),
      coordinator.execute('SELECT type, count(*) FROM things GROUP BY type'),
    ])

    const elapsed = performance.now() - start

    expect(results.every((r) => r.success)).toBe(true)

    // Pipelining should be more efficient than serial execution
    // Total time should be less than 3x single query time
    console.log(`Pipelined 3 queries in ${elapsed.toFixed(2)}ms`)
  })
})

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function generateTestThings(count: number, type: string): any[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${type}-${i}`,
    type: type,
    data: {
      index: i,
      name: `${type}-${i}`,
    },
  }))
}
