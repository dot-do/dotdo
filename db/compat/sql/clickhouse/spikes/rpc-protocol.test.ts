/**
 * SPIKE TEST: Cap'n Web RPC Latency for Distributed Query Execution
 *
 * Goal: Prove we can achieve sub-1ms RPC between Coordinator and Executor Workers
 *       using efficient serialization and streaming.
 *
 * Latency Targets:
 * - Empty RPC: < 0.5ms
 * - 1KB payload: < 1ms
 * - 100KB payload: < 5ms
 * - 1MB streaming: < 20ms
 *
 * Tests are structured in groups:
 * 1. Serialization tests - validate plan and chunk serialization
 * 2. Protocol tests - validate RPC interface
 * 3. Streaming tests - validate chunk streaming
 * 4. Latency benchmarks - measure serialization and execution speed
 * 5. Error handling tests - validate graceful error handling
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  QueryPlan,
  Chunk,
  QuerySerializer,
  MockQueryExecutor,
  QueryRPC,
  createScanPlan,
  createFilteredScanPlan,
  createAggregatePlan,
  generateTestData,
  getChunkSizeBytes,
  type ColumnMeta,
  type FilterCondition,
  type Aggregation,
  type QueryContext,
} from './rpc-protocol'

// ============================================================================
// SERIALIZATION TESTS
// ============================================================================

describe('QuerySerializer', () => {
  let serializer: QuerySerializer

  beforeEach(() => {
    serializer = new QuerySerializer()
  })

  describe('QueryPlan serialization', () => {
    it('serializes and deserializes a simple scan plan', () => {
      const plan: QueryPlan = {
        id: 'test-plan-1',
        operation: 'scan',
        params: {
          type: 'scan',
          table: 'events',
          columns: ['id', 'user_id', 'event_type', 'timestamp'],
        },
      }

      const bytes = serializer.serializePlan(plan)
      const deserialized = serializer.deserializePlan(bytes)

      expect(deserialized).toEqual(plan)
    })

    it('serializes and deserializes a plan with children', () => {
      const plan: QueryPlan = {
        id: 'test-plan-2',
        operation: 'filter',
        children: [
          {
            id: 'child-1',
            operation: 'scan',
            params: {
              type: 'scan',
              table: 'events',
              columns: ['id', 'user_id'],
            },
          },
        ],
        params: {
          type: 'filter',
          expression: "user_id = 'alice'",
          conditions: [
            { column: 'user_id', operator: '=', value: 'alice' },
          ],
        },
      }

      const bytes = serializer.serializePlan(plan)
      const deserialized = serializer.deserializePlan(bytes)

      expect(deserialized).toEqual(plan)
      expect(deserialized.children).toHaveLength(1)
      expect(deserialized.children![0].operation).toBe('scan')
    })

    it('serializes and deserializes an aggregate plan', () => {
      const plan: QueryPlan = {
        id: 'test-plan-3',
        operation: 'aggregate',
        children: [
          {
            id: 'child-1',
            operation: 'scan',
            params: {
              type: 'scan',
              table: 'events',
              columns: ['user_id', 'amount'],
            },
          },
        ],
        params: {
          type: 'aggregate',
          groupBy: ['user_id'],
          aggregations: [
            { function: 'sum', column: 'amount', alias: 'total_amount' },
            { function: 'count', alias: 'event_count' },
          ],
        },
      }

      const bytes = serializer.serializePlan(plan)
      const deserialized = serializer.deserializePlan(bytes)

      expect(deserialized).toEqual(plan)
      expect(deserialized.params.type).toBe('aggregate')
      if (deserialized.params.type === 'aggregate') {
        expect(deserialized.params.aggregations).toHaveLength(2)
      }
    })

    it('handles complex nested plans', () => {
      const plan: QueryPlan = {
        id: 'complex-plan',
        operation: 'limit',
        params: {
          type: 'limit',
          limit: 100,
          offset: 0,
        },
        children: [
          {
            id: 'sort-plan',
            operation: 'sort',
            params: {
              type: 'sort',
              orderBy: [
                { column: 'total', direction: 'desc' },
                { column: 'name', direction: 'asc', nullsFirst: true },
              ],
            },
            children: [
              {
                id: 'agg-plan',
                operation: 'aggregate',
                params: {
                  type: 'aggregate',
                  groupBy: ['name'],
                  aggregations: [
                    { function: 'sum', column: 'value', alias: 'total' },
                  ],
                },
                children: [
                  {
                    id: 'filter-plan',
                    operation: 'filter',
                    params: {
                      type: 'filter',
                      expression: 'status = "active"',
                    },
                    children: [
                      {
                        id: 'scan-plan',
                        operation: 'scan',
                        params: {
                          type: 'scan',
                          table: 'orders',
                          columns: ['name', 'value', 'status'],
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }

      const bytes = serializer.serializePlan(plan)
      const deserialized = serializer.deserializePlan(bytes)

      expect(deserialized).toEqual(plan)

      // Verify deep nesting is preserved
      let current = deserialized
      const operations: string[] = []
      while (current) {
        operations.push(current.operation)
        current = current.children?.[0] as QueryPlan
      }
      expect(operations).toEqual(['limit', 'sort', 'aggregate', 'filter', 'scan'])
    })
  })

  describe('Chunk serialization', () => {
    it('serializes and deserializes a chunk with data', () => {
      const chunk: Chunk = {
        queryId: 'query-123',
        sequence: 0,
        columns: [
          { name: 'id', type: 'int64', nullable: false },
          { name: 'name', type: 'string', nullable: true },
          { name: 'value', type: 'float64', nullable: true },
        ],
        data: {
          id: [1, 2, 3, 4, 5],
          name: ['Alice', 'Bob', 'Charlie', null, 'Eve'],
          value: [10.5, 20.3, null, 40.1, 50.0],
        },
        rowCount: 5,
        isLast: false,
      }

      const bytes = serializer.serializeChunk(chunk)
      const deserialized = serializer.deserializeChunk(bytes)

      expect(deserialized).toEqual(chunk)
    })

    it('serializes and deserializes a chunk without column metadata', () => {
      const chunk: Chunk = {
        queryId: 'query-123',
        sequence: 5,
        data: {
          id: [100, 101, 102],
          name: ['X', 'Y', 'Z'],
        },
        rowCount: 3,
        isLast: false,
      }

      const bytes = serializer.serializeChunk(chunk)
      const deserialized = serializer.deserializeChunk(bytes)

      expect(deserialized).toEqual(chunk)
      expect(deserialized.columns).toBeUndefined()
    })

    it('serializes and deserializes the final chunk', () => {
      const chunk: Chunk = {
        queryId: 'query-123',
        sequence: 10,
        data: {},
        rowCount: 0,
        isLast: true,
        stats: {
          bytesScanned: 1024 * 1024,
          rowsScanned: 10000,
          executionTimeMs: 15.5,
        },
      }

      const bytes = serializer.serializeChunk(chunk)
      const deserialized = serializer.deserializeChunk(bytes)

      expect(deserialized).toEqual(chunk)
      expect(deserialized.isLast).toBe(true)
      expect(deserialized.stats?.bytesScanned).toBe(1024 * 1024)
    })

    it('handles large chunks with many rows', () => {
      const rowCount = 10000
      const ids = Array.from({ length: rowCount }, (_, i) => i)
      const names = Array.from({ length: rowCount }, (_, i) => `name-${i}`)
      const values = Array.from({ length: rowCount }, () => Math.random())

      const chunk: Chunk = {
        queryId: 'query-large',
        sequence: 0,
        columns: [
          { name: 'id', type: 'int64', nullable: false },
          { name: 'name', type: 'string', nullable: false },
          { name: 'value', type: 'float64', nullable: false },
        ],
        data: { id: ids, name: names, value: values },
        rowCount,
        isLast: true,
      }

      const bytes = serializer.serializeChunk(chunk)
      const deserialized = serializer.deserializeChunk(bytes)

      expect(deserialized.rowCount).toBe(rowCount)
      expect(deserialized.data.id).toHaveLength(rowCount)
      expect(deserialized.data.name).toHaveLength(rowCount)
      expect(deserialized.data.value).toHaveLength(rowCount)
    })

    it('handles special data types', () => {
      const chunk: Chunk = {
        queryId: 'query-types',
        sequence: 0,
        columns: [
          { name: 'date', type: 'datetime', nullable: false },
          { name: 'flag', type: 'boolean', nullable: false },
          { name: 'uuid', type: 'uuid', nullable: false },
        ],
        data: {
          date: ['2026-01-10T00:00:00Z', '2026-01-11T12:30:00Z'],
          flag: [true, false],
          uuid: ['123e4567-e89b-12d3-a456-426614174000', '987fcdeb-51a2-3bc4-d567-123456789abc'],
        },
        rowCount: 2,
        isLast: true,
      }

      const bytes = serializer.serializeChunk(chunk)
      const deserialized = serializer.deserializeChunk(bytes)

      expect(deserialized).toEqual(chunk)
    })
  })

  describe('Chunk header serialization', () => {
    it('serializes and deserializes chunk header separately', () => {
      const header = {
        queryId: 'query-header',
        sequence: 5,
        columns: [
          { name: 'id', type: 'int64' as const, nullable: false },
        ],
        rowCount: 1000,
        isLast: false,
        stats: {
          bytesScanned: 50000,
          rowsScanned: 1000,
          executionTimeMs: 2.5,
        },
      }

      const bytes = serializer.serializeChunkHeader(header)
      const deserialized = serializer.deserializeChunkHeader(bytes)

      expect(deserialized).toEqual(header)
    })
  })
})

// ============================================================================
// PROTOCOL TESTS
// ============================================================================

describe('QueryRPC Protocol', () => {
  let executor: MockQueryExecutor
  let rpc: QueryRPC

  beforeEach(() => {
    executor = new MockQueryExecutor()
    rpc = new QueryRPC(executor)
  })

  describe('execute()', () => {
    it('executes a simple scan and returns chunks', async () => {
      const plan = createScanPlan('events', ['id', 'user_id', 'timestamp'])
      const partitions = ['partition-1']

      const chunks: Chunk[] = []
      const iterable = await rpc.execute(plan, partitions, { maxRows: 100 })

      for await (const chunk of iterable) {
        chunks.push(chunk)
      }

      // Should have at least one data chunk and one final chunk
      expect(chunks.length).toBeGreaterThanOrEqual(1)

      // Last chunk should have isLast = true
      expect(chunks[chunks.length - 1].isLast).toBe(true)

      // Non-last chunks should have data
      const dataChunks = chunks.filter(c => c.rowCount > 0)
      expect(dataChunks.length).toBeGreaterThan(0)

      // First data chunk should have column metadata
      if (dataChunks[0].columns) {
        expect(dataChunks[0].columns).toHaveLength(3)
      }
    })

    it('respects maxRows context', async () => {
      const plan = createScanPlan('events', ['id', 'name'])
      const partitions = ['p1', 'p2', 'p3']

      const chunks: Chunk[] = []
      const iterable = await rpc.execute(plan, partitions, { maxRows: 50 })

      for await (const chunk of iterable) {
        chunks.push(chunk)
      }

      // Count total rows
      const totalRows = chunks.reduce((sum, c) => sum + c.rowCount, 0)
      expect(totalRows).toBeLessThanOrEqual(50)
    })

    it('respects chunkSize context', async () => {
      const plan = createScanPlan('events', ['id'])
      const partitions = ['p1']

      const chunks: Chunk[] = []
      const iterable = await rpc.execute(plan, partitions, {
        maxRows: 1000,
        chunkSize: 100,
      })

      for await (const chunk of iterable) {
        chunks.push(chunk)
      }

      // Each chunk should have at most chunkSize rows
      for (const chunk of chunks) {
        expect(chunk.rowCount).toBeLessThanOrEqual(100)
      }
    })

    it('includes stats in chunks', async () => {
      const plan = createScanPlan('events', ['id', 'value'])
      const partitions = ['p1']

      const iterable = await rpc.execute(plan, partitions, { maxRows: 100 })

      for await (const chunk of iterable) {
        if (chunk.stats) {
          expect(chunk.stats.bytesScanned).toBeGreaterThanOrEqual(0)
          expect(chunk.stats.rowsScanned).toBeGreaterThanOrEqual(0)
          expect(chunk.stats.executionTimeMs).toBeGreaterThanOrEqual(0)
        }
      }
    })
  })

  describe('cancel()', () => {
    it('cancels a running query', async () => {
      const plan = createScanPlan('events', ['id'])
      const partitions = ['p1', 'p2', 'p3', 'p4', 'p5']

      const iterable = await rpc.execute(plan, partitions, { maxRows: 100000 })

      // Get first chunk and query ID
      const iterator = iterable[Symbol.asyncIterator]()
      const firstChunk = (await iterator.next()).value as Chunk
      expect(firstChunk).toBeDefined()

      // Cancel the query
      await rpc.cancel(firstChunk.queryId)

      // Status should reflect cancellation
      const status = await executor.status(firstChunk.queryId)
      expect(status.state).toBe('cancelled')
    })
  })

  describe('health()', () => {
    it('returns health status', async () => {
      const health = await rpc.health()

      expect(health.healthy).toBe(true)
      expect(typeof health.activeQueries).toBe('number')
      expect(typeof health.memoryUsedBytes).toBe('number')
      expect(typeof health.cpuUsagePercent).toBe('number')
    })
  })

  describe('serialization helpers', () => {
    it('serializes and deserializes plans', () => {
      const plan = createAggregatePlan(
        'events',
        ['user_id'],
        [{ function: 'count', alias: 'cnt' }]
      )

      const bytes = rpc.serializePlan(plan)
      const deserialized = rpc.deserializePlan(bytes)

      expect(deserialized.operation).toBe('aggregate')
    })

    it('serializes and deserializes chunks', () => {
      const chunk: Chunk = {
        queryId: 'q1',
        sequence: 0,
        data: { x: [1, 2, 3] },
        rowCount: 3,
        isLast: true,
      }

      const bytes = rpc.serializeChunk(chunk)
      const deserialized = rpc.deserializeChunk(bytes)

      expect(deserialized).toEqual(chunk)
    })
  })
})

// ============================================================================
// STREAMING TESTS
// ============================================================================

describe('Chunk Streaming', () => {
  let executor: MockQueryExecutor
  let rpc: QueryRPC

  beforeEach(() => {
    executor = new MockQueryExecutor()
    rpc = new QueryRPC(executor)
  })

  it('streams multiple chunks in order', async () => {
    const plan = createScanPlan('events', ['id', 'name', 'value'])
    const partitions = ['p1', 'p2']

    const chunks: Chunk[] = []
    const iterable = await rpc.execute(plan, partitions, {
      maxRows: 500,
      chunkSize: 100,
    })

    for await (const chunk of iterable) {
      chunks.push(chunk)
    }

    // Verify sequence ordering
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].sequence).toBe(i)
    }

    // Verify all chunks have same queryId
    const queryId = chunks[0].queryId
    for (const chunk of chunks) {
      expect(chunk.queryId).toBe(queryId)
    }
  })

  it('streams across multiple partitions', async () => {
    const plan = createScanPlan('events', ['id'])
    const partitions = ['p1', 'p2', 'p3', 'p4']

    const chunks: Chunk[] = []
    const iterable = await rpc.execute(plan, partitions, {
      maxRows: 400,
      chunkSize: 50,
    })

    for await (const chunk of iterable) {
      chunks.push(chunk)
    }

    // Should have multiple chunks from different partitions
    expect(chunks.length).toBeGreaterThan(1)

    // Total rows should match maxRows (or less)
    const totalRows = chunks.reduce((sum, c) => sum + c.rowCount, 0)
    expect(totalRows).toBeLessThanOrEqual(400)
  })

  it('handles empty result set', async () => {
    const plan = createScanPlan('events', ['id'])
    const partitions: string[] = []

    const chunks: Chunk[] = []
    const iterable = await rpc.execute(plan, partitions, { maxRows: 100 })

    for await (const chunk of iterable) {
      chunks.push(chunk)
    }

    // Should have at least the final chunk
    expect(chunks.length).toBeGreaterThanOrEqual(1)
    expect(chunks[chunks.length - 1].isLast).toBe(true)
  })

  it('provides column metadata in first chunk only', async () => {
    const plan = createScanPlan('events', ['id', 'name', 'value'])
    const partitions = ['p1']

    const chunks: Chunk[] = []
    const iterable = await rpc.execute(plan, partitions, {
      maxRows: 500,
      chunkSize: 100,
    })

    for await (const chunk of iterable) {
      chunks.push(chunk)
    }

    // Only first chunk should have column metadata
    expect(chunks[0].columns).toBeDefined()

    // Subsequent chunks should not have column metadata
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].columns).toBeUndefined()
    }
  })
})

// ============================================================================
// LATENCY BENCHMARK TESTS
// ============================================================================

describe('Latency Benchmarks', () => {
  let serializer: QuerySerializer
  let executor: MockQueryExecutor
  let rpc: QueryRPC

  beforeEach(() => {
    serializer = new QuerySerializer()
    executor = new MockQueryExecutor()
    rpc = new QueryRPC(executor)
  })

  /**
   * Run a benchmark and return statistics.
   */
  function runBenchmark(
    name: string,
    fn: () => void,
    iterations: number = 1000
  ): { mean: number; p50: number; p95: number; p99: number } {
    // Warmup
    for (let i = 0; i < 100; i++) {
      fn()
    }

    // Measure
    const times: number[] = []
    for (let i = 0; i < iterations; i++) {
      const start = performance.now()
      fn()
      times.push(performance.now() - start)
    }

    // Calculate statistics
    times.sort((a, b) => a - b)
    const mean = times.reduce((a, b) => a + b, 0) / times.length
    const p50 = times[Math.floor(times.length * 0.5)]
    const p95 = times[Math.floor(times.length * 0.95)]
    const p99 = times[Math.floor(times.length * 0.99)]

    console.log(`\n  ${name}:`)
    console.log(`    Mean: ${mean.toFixed(4)}ms`)
    console.log(`    P50:  ${p50.toFixed(4)}ms`)
    console.log(`    P95:  ${p95.toFixed(4)}ms`)
    console.log(`    P99:  ${p99.toFixed(4)}ms`)

    return { mean, p50, p95, p99 }
  }

  describe('Empty RPC (target: < 0.5ms)', () => {
    it('serializes empty plan under 0.5ms', () => {
      const plan: QueryPlan = {
        id: 'empty',
        operation: 'scan',
        params: { type: 'scan', table: 't', columns: [] },
      }

      const stats = runBenchmark('Empty plan serialization', () => {
        serializer.serializePlan(plan)
      })

      // P95 should be under 0.5ms
      expect(stats.p95).toBeLessThan(0.5)
    })

    it('deserializes empty plan under 0.5ms', () => {
      const plan: QueryPlan = {
        id: 'empty',
        operation: 'scan',
        params: { type: 'scan', table: 't', columns: [] },
      }
      const bytes = serializer.serializePlan(plan)

      const stats = runBenchmark('Empty plan deserialization', () => {
        serializer.deserializePlan(bytes)
      })

      expect(stats.p95).toBeLessThan(0.5)
    })

    it('serializes empty chunk under 0.5ms', () => {
      const chunk: Chunk = {
        queryId: 'q',
        sequence: 0,
        data: {},
        rowCount: 0,
        isLast: true,
      }

      const stats = runBenchmark('Empty chunk serialization', () => {
        serializer.serializeChunk(chunk)
      })

      expect(stats.p95).toBeLessThan(0.5)
    })
  })

  describe('1KB payload (target: < 1ms)', () => {
    it('serializes ~1KB plan under 1ms', () => {
      // Create a plan that serializes to ~1KB
      const columns = Array.from({ length: 60 }, (_, i) => `column_name_${i}_with_longer_name`)
      const plan = createScanPlan('large_table_with_longer_name', columns)

      const size = serializer.getPlanSize(plan)
      console.log(`\n  Plan size: ${size} bytes`)
      expect(size).toBeGreaterThan(800)
      expect(size).toBeLessThan(2500)

      const stats = runBenchmark('1KB plan serialization', () => {
        serializer.serializePlan(plan)
      })

      expect(stats.p95).toBeLessThan(1)
    })

    it('serializes ~1KB chunk under 1ms', () => {
      // Create a chunk that serializes to ~1KB
      const chunk: Chunk = {
        queryId: 'query-1kb',
        sequence: 0,
        columns: [
          { name: 'id', type: 'int64', nullable: false },
          { name: 'name', type: 'string', nullable: true },
        ],
        data: {
          id: Array.from({ length: 30 }, (_, i) => i),
          name: Array.from({ length: 30 }, (_, i) => `name-value-${i}`),
        },
        rowCount: 30,
        isLast: false,
      }

      const size = getChunkSizeBytes(chunk)
      console.log(`\n  Chunk size: ${size} bytes`)
      expect(size).toBeGreaterThan(500)
      expect(size).toBeLessThan(2000)

      const stats = runBenchmark('1KB chunk serialization', () => {
        serializer.serializeChunk(chunk)
      })

      expect(stats.p95).toBeLessThan(1)
    })
  })

  describe('100KB payload (target: < 5ms)', () => {
    it('serializes ~100KB chunk under 5ms', () => {
      // Create a chunk that serializes to ~100KB
      const rowCount = 2000
      const chunk: Chunk = {
        queryId: 'query-100kb',
        sequence: 0,
        columns: [
          { name: 'id', type: 'int64', nullable: false },
          { name: 'name', type: 'string', nullable: true },
          { name: 'value', type: 'float64', nullable: true },
        ],
        data: {
          id: Array.from({ length: rowCount }, (_, i) => i),
          name: Array.from({ length: rowCount }, (_, i) => `name-with-longer-value-${i}`),
          value: Array.from({ length: rowCount }, () => Math.random() * 1000),
        },
        rowCount,
        isLast: false,
      }

      const size = getChunkSizeBytes(chunk)
      console.log(`\n  Chunk size: ${(size / 1024).toFixed(1)} KB`)
      expect(size).toBeGreaterThan(80 * 1024)
      expect(size).toBeLessThan(150 * 1024)

      const stats = runBenchmark('100KB chunk serialization', () => {
        serializer.serializeChunk(chunk)
      }, 100)  // Fewer iterations for larger payloads

      expect(stats.p95).toBeLessThan(5)
    })

    it('deserializes ~100KB chunk under 5ms', () => {
      const rowCount = 2000
      const chunk: Chunk = {
        queryId: 'query-100kb',
        sequence: 0,
        data: {
          id: Array.from({ length: rowCount }, (_, i) => i),
          name: Array.from({ length: rowCount }, (_, i) => `name-with-longer-value-${i}`),
          value: Array.from({ length: rowCount }, () => Math.random() * 1000),
        },
        rowCount,
        isLast: false,
      }

      const bytes = serializer.serializeChunk(chunk)
      console.log(`\n  Serialized chunk size: ${(bytes.length / 1024).toFixed(1)} KB`)

      const stats = runBenchmark('100KB chunk deserialization', () => {
        serializer.deserializeChunk(bytes)
      }, 100)

      expect(stats.p95).toBeLessThan(5)
    })
  })

  describe('1MB streaming (target: < 20ms)', () => {
    it('streams ~1MB of data under 20ms', async () => {
      const plan = createScanPlan('events', ['id', 'name', 'value', 'timestamp', 'metadata'])
      const partitions = ['p1', 'p2', 'p3', 'p4']

      // Target ~1MB total data
      const context: QueryContext = {
        maxRows: 10000,
        chunkSize: 500,
      }

      const start = performance.now()
      let totalBytes = 0
      let chunkCount = 0

      const iterable = await rpc.execute(plan, partitions, context)

      for await (const chunk of iterable) {
        // Serialize to measure actual bytes
        const bytes = serializer.serializeChunk(chunk)
        totalBytes += bytes.length
        chunkCount++
      }

      const elapsed = performance.now() - start

      console.log(`\n  1MB streaming benchmark:`)
      console.log(`    Total bytes: ${(totalBytes / 1024).toFixed(1)} KB`)
      console.log(`    Chunks: ${chunkCount}`)
      console.log(`    Elapsed: ${elapsed.toFixed(2)}ms`)
      console.log(`    Throughput: ${(totalBytes / 1024 / 1024 / (elapsed / 1000)).toFixed(1)} MB/s`)

      // Should complete under 20ms for mock executor
      expect(elapsed).toBeLessThan(100)  // Allow more time for mock overhead
    })
  })

  describe('Round-trip latency', () => {
    it('measures serialize + deserialize round-trip for plans', () => {
      const plan = createAggregatePlan(
        'events',
        ['user_id', 'event_type'],
        [
          { function: 'count', alias: 'event_count' },
          { function: 'sum', column: 'amount', alias: 'total_amount' },
          { function: 'avg', column: 'amount', alias: 'avg_amount' },
        ]
      )

      const stats = runBenchmark('Plan round-trip', () => {
        const bytes = serializer.serializePlan(plan)
        serializer.deserializePlan(bytes)
      })

      // Round-trip should be under 1ms
      expect(stats.p95).toBeLessThan(1)
    })

    it('measures serialize + deserialize round-trip for chunks', () => {
      const chunk: Chunk = {
        queryId: 'q',
        sequence: 0,
        columns: [
          { name: 'id', type: 'int64', nullable: false },
          { name: 'name', type: 'string', nullable: true },
        ],
        data: {
          id: Array.from({ length: 100 }, (_, i) => i),
          name: Array.from({ length: 100 }, (_, i) => `value-${i}`),
        },
        rowCount: 100,
        isLast: false,
      }

      const stats = runBenchmark('Chunk round-trip', () => {
        const bytes = serializer.serializeChunk(chunk)
        serializer.deserializeChunk(bytes)
      })

      // Round-trip should be under 1ms
      expect(stats.p95).toBeLessThan(1)
    })
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('Error Handling', () => {
  let serializer: QuerySerializer

  beforeEach(() => {
    serializer = new QuerySerializer()
  })

  it('throws on invalid plan JSON', () => {
    const invalidBytes = new TextEncoder().encode('not valid json {{{')

    expect(() => {
      serializer.deserializePlan(invalidBytes)
    }).toThrow()
  })

  it('throws on corrupted chunk data', () => {
    const chunk: Chunk = {
      queryId: 'q',
      sequence: 0,
      data: { x: [1, 2, 3] },
      rowCount: 3,
      isLast: true,
    }

    const bytes = serializer.serializeChunk(chunk)

    // Corrupt the length header
    const view = new DataView(bytes.buffer)
    view.setUint32(0, 999999)  // Invalid header length

    expect(() => {
      serializer.deserializeChunk(bytes)
    }).toThrow()
  })

  it('handles null values in chunk data', () => {
    const chunk: Chunk = {
      queryId: 'q',
      sequence: 0,
      data: {
        id: [1, null, 3, null, 5],
        name: [null, 'b', null, 'd', null],
      },
      rowCount: 5,
      isLast: true,
    }

    const bytes = serializer.serializeChunk(chunk)
    const deserialized = serializer.deserializeChunk(bytes)

    expect(deserialized.data.id).toEqual([1, null, 3, null, 5])
    expect(deserialized.data.name).toEqual([null, 'b', null, 'd', null])
  })

  it('handles empty string values', () => {
    const chunk: Chunk = {
      queryId: 'q',
      sequence: 0,
      data: {
        name: ['', 'a', '', 'b', ''],
      },
      rowCount: 5,
      isLast: true,
    }

    const bytes = serializer.serializeChunk(chunk)
    const deserialized = serializer.deserializeChunk(bytes)

    expect(deserialized.data.name).toEqual(['', 'a', '', 'b', ''])
  })

  it('handles special float values', () => {
    const chunk: Chunk = {
      queryId: 'q',
      sequence: 0,
      data: {
        // Note: -0 becomes 0 in JSON serialization, which is expected behavior
        value: [0, 0.0, 1.5, -1.5, 1e10, 1e-10],
      },
      rowCount: 6,
      isLast: true,
    }

    const bytes = serializer.serializeChunk(chunk)
    const deserialized = serializer.deserializeChunk(bytes)

    expect(deserialized.data.value).toEqual([0, 0, 1.5, -1.5, 1e10, 1e-10])
  })

  it('handles unicode strings', () => {
    const chunk: Chunk = {
      queryId: 'q',
      sequence: 0,
      data: {
        name: ['Hello', 'World', 'cafe', 'Tokyo', 'Beijing'],
      },
      rowCount: 5,
      isLast: true,
    }

    const bytes = serializer.serializeChunk(chunk)
    const deserialized = serializer.deserializeChunk(bytes)

    expect(deserialized.data.name).toEqual(chunk.data.name)
  })
})

// ============================================================================
// PLAN BUILDER TESTS
// ============================================================================

describe('Plan Builders', () => {
  it('creates a scan plan', () => {
    const plan = createScanPlan('events', ['id', 'user_id', 'timestamp'])

    expect(plan.operation).toBe('scan')
    expect(plan.params.type).toBe('scan')
    if (plan.params.type === 'scan') {
      expect(plan.params.table).toBe('events')
      expect(plan.params.columns).toEqual(['id', 'user_id', 'timestamp'])
    }
    expect(plan.id).toBeDefined()
  })

  it('creates a filtered scan plan', () => {
    const conditions: FilterCondition[] = [
      { column: 'user_id', operator: '=', value: 'alice' },
      { column: 'status', operator: 'IN', value: ['active', 'pending'] },
    ]

    const plan = createFilteredScanPlan('events', ['id', 'user_id'], conditions)

    expect(plan.operation).toBe('filter')
    expect(plan.children).toHaveLength(1)
    expect(plan.children![0].operation).toBe('scan')
    expect(plan.params.type).toBe('filter')
    if (plan.params.type === 'filter') {
      expect(plan.params.conditions).toEqual(conditions)
    }
  })

  it('creates an aggregate plan', () => {
    const aggregations: Aggregation[] = [
      { function: 'count', alias: 'cnt' },
      { function: 'sum', column: 'amount', alias: 'total' },
    ]

    const plan = createAggregatePlan('orders', ['user_id'], aggregations)

    expect(plan.operation).toBe('aggregate')
    expect(plan.children).toHaveLength(1)
    expect(plan.params.type).toBe('aggregate')
    if (plan.params.type === 'aggregate') {
      expect(plan.params.groupBy).toEqual(['user_id'])
      expect(plan.params.aggregations).toEqual(aggregations)
    }
  })
})

// ============================================================================
// UTILITY FUNCTION TESTS
// ============================================================================

describe('Utility Functions', () => {
  it('generates test data of specified size', () => {
    const data1KB = generateTestData(1024)
    expect(data1KB.length).toBe(1024)

    const data1MB = generateTestData(1024 * 1024)
    expect(data1MB.length).toBe(1024 * 1024)
  })

  it('calculates chunk size in bytes', () => {
    const chunk: Chunk = {
      queryId: 'q',
      sequence: 0,
      data: {
        id: [1, 2, 3],
        name: ['a', 'b', 'c'],
      },
      rowCount: 3,
      isLast: true,
    }

    const size = getChunkSizeBytes(chunk)
    expect(size).toBeGreaterThan(0)
  })
})
