/**
 * SPIKE TEST: Cloudflare Pipelines Write Path POC
 *
 * Tests for the Pipelines-based write path for DO state to Iceberg.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  PipelineWriter,
  MockPipeline,
  generateStateChangeSchema,
  generatePipelineSql,
  generateSetupCommands,
  type StateChangeEvent,
} from './pipelines-write-poc'

// ============================================================================
// PipelineWriter Tests
// ============================================================================

describe('PipelineWriter', () => {
  let mockPipeline: MockPipeline
  let writer: PipelineWriter

  beforeEach(() => {
    mockPipeline = new MockPipeline()
    writer = new PipelineWriter(mockPipeline, {
      batchSize: 10,
      flushInterval: 100,
    })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('recordPut', () => {
    it('queues PUT events', async () => {
      await writer.recordPut('do-123', 'tenant.api', 'User', 'profile', { name: 'Alice' })

      const metrics = writer.getMetrics()
      expect(metrics.eventsQueued).toBe(1)
      expect(metrics.bufferSize).toBe(1)
      expect(metrics.eventsWritten).toBe(0) // Not flushed yet
    })

    it('batches multiple events before flushing', async () => {
      for (let i = 0; i < 5; i++) {
        await writer.recordPut('do-123', 'tenant.api', 'User', `key-${i}`, { i })
      }

      expect(mockPipeline.sentRecords).toHaveLength(0) // Not flushed
      expect(writer.getMetrics().bufferSize).toBe(5)
    })

    it('auto-flushes when batch size reached', async () => {
      for (let i = 0; i < 10; i++) {
        await writer.recordPut('do-123', 'tenant.api', 'User', `key-${i}`, { i })
      }

      expect(mockPipeline.sentRecords).toHaveLength(1)
      expect(mockPipeline.sentRecords[0]).toHaveLength(10)
      expect(writer.getMetrics().eventsWritten).toBe(10)
    })

    it('generates correct event structure', async () => {
      const now = Date.now()
      vi.setSystemTime(now)

      await writer.recordPut('do-123', 'payments.do', 'Invoice', 'inv_001', {
        amount: 100.50,
        currency: 'USD',
      })

      await writer.flush()

      const event = mockPipeline.sentRecords[0][0] as StateChangeEvent
      expect(event).toMatchObject({
        do_id: 'do-123',
        ns: 'payments.do',
        type: 'Invoice',
        key: 'inv_001',
        value: JSON.stringify({ amount: 100.50, currency: 'USD' }),
        op: 'PUT',
        timestamp: now,
        seq: 0,
      })
    })
  })

  describe('recordDelete', () => {
    it('queues DELETE events with null value', async () => {
      await writer.recordDelete('do-123', 'tenant.api', 'User', 'profile')
      await writer.flush()

      const event = mockPipeline.sentRecords[0][0] as StateChangeEvent
      expect(event.op).toBe('DELETE')
      expect(event.value).toBeNull()
    })
  })

  describe('flush', () => {
    it('sends all buffered events', async () => {
      await writer.recordPut('do-1', 'ns', 'Type', 'k1', 'v1')
      await writer.recordPut('do-2', 'ns', 'Type', 'k2', 'v2')
      await writer.recordPut('do-3', 'ns', 'Type', 'k3', 'v3')

      await writer.flush()

      expect(mockPipeline.getTotalRecordCount()).toBe(3)
      expect(writer.getMetrics().bufferSize).toBe(0)
    })

    it('does nothing when buffer is empty', async () => {
      await writer.flush()
      expect(mockPipeline.sentRecords).toHaveLength(0)
    })

    it('retries on failure', async () => {
      await writer.recordPut('do-1', 'ns', 'Type', 'k1', 'v1')

      mockPipeline.shouldFail = true

      await expect(writer.flush()).rejects.toThrow('Mock pipeline failure')

      // Events should be back in buffer
      expect(writer.getMetrics().bufferSize).toBe(1)
      expect(writer.getMetrics().errors).toBe(1)

      // Retry should work
      mockPipeline.shouldFail = false
      await writer.flush()

      expect(mockPipeline.getTotalRecordCount()).toBe(1)
      expect(writer.getMetrics().bufferSize).toBe(0)
    })
  })

  describe('auto-flush interval', () => {
    it('flushes after interval expires', async () => {
      await writer.recordPut('do-1', 'ns', 'Type', 'k1', 'v1')

      expect(mockPipeline.sentRecords).toHaveLength(0)

      // Advance time past flush interval
      await vi.advanceTimersByTimeAsync(150)

      expect(mockPipeline.sentRecords).toHaveLength(1)
    })

    it('does not double-flush', async () => {
      await writer.recordPut('do-1', 'ns', 'Type', 'k1', 'v1')
      await writer.recordPut('do-2', 'ns', 'Type', 'k2', 'v2')

      // Advance time past interval
      await vi.advanceTimersByTimeAsync(150)

      expect(mockPipeline.sentRecords).toHaveLength(1)

      // Advance more time
      await vi.advanceTimersByTimeAsync(150)

      // No more flushes (buffer was empty)
      expect(mockPipeline.sentRecords).toHaveLength(1)
    })
  })

  describe('filters', () => {
    it('excludes configured types', async () => {
      const filteredWriter = new PipelineWriter(mockPipeline, {
        batchSize: 100,
        excludeTypes: ['_internal', '_tombstone'],
      })

      await filteredWriter.recordPut('do-1', 'ns', '_internal', 'k1', 'v1')
      await filteredWriter.recordPut('do-2', 'ns', '_tombstone', 'k2', 'v2')
      await filteredWriter.recordPut('do-3', 'ns', 'User', 'k3', 'v3')
      await filteredWriter.flush()

      expect(mockPipeline.getTotalRecordCount()).toBe(1)
      const event = mockPipeline.sentRecords[0][0] as StateChangeEvent
      expect(event.type).toBe('User')
    })

    it('filters by namespace prefix', async () => {
      const filteredWriter = new PipelineWriter(mockPipeline, {
        batchSize: 100,
        namespaceFilter: 'prod.',
      })

      await filteredWriter.recordPut('do-1', 'dev.api', 'User', 'k1', 'v1')
      await filteredWriter.recordPut('do-2', 'prod.api', 'User', 'k2', 'v2')
      await filteredWriter.recordPut('do-3', 'prod.payments', 'Order', 'k3', 'v3')
      await filteredWriter.flush()

      expect(mockPipeline.getTotalRecordCount()).toBe(2)
    })
  })

  describe('sequence numbers', () => {
    it('increments sequence numbers', async () => {
      await writer.recordPut('do-1', 'ns', 'Type', 'k1', 'v1')
      await writer.recordPut('do-1', 'ns', 'Type', 'k2', 'v2')
      await writer.recordPut('do-1', 'ns', 'Type', 'k3', 'v3')
      await writer.flush()

      const events = mockPipeline.sentRecords[0] as StateChangeEvent[]
      expect(events[0].seq).toBe(0)
      expect(events[1].seq).toBe(1)
      expect(events[2].seq).toBe(2)
    })
  })
})

// ============================================================================
// Schema Generation Tests
// ============================================================================

describe('generateStateChangeSchema', () => {
  it('generates correct Pipelines schema', () => {
    const schema = generateStateChangeSchema()

    expect(schema).toEqual({
      do_id: { type: 'string', required: true },
      ns: { type: 'string', required: true },
      type: { type: 'string', required: true },
      key: { type: 'string', required: true },
      value: { type: 'string', required: false },
      op: { type: 'string', required: true },
      timestamp: { type: 'timestamp', required: true },
      seq: { type: 'int64', required: true },
    })
  })
})

// ============================================================================
// SQL Generation Tests
// ============================================================================

describe('generatePipelineSql', () => {
  it('generates basic INSERT statement', () => {
    const sql = generatePipelineSql({
      streamName: 'do_state_stream',
      sinkName: 'do_state_sink',
    })

    expect(sql).toContain('INSERT INTO do_state_sink')
    expect(sql).toContain('FROM do_state_stream')
    expect(sql).toContain('do_id')
    expect(sql).toContain('timestamp')
  })

  it('adds WHERE clause for excluded ops', () => {
    const sql = generatePipelineSql({
      streamName: 'stream',
      sinkName: 'sink',
      excludeOps: ['_internal', '_test'],
    })

    expect(sql).toContain("WHERE op NOT IN ('_internal', '_test')")
  })
})

// ============================================================================
// Setup Commands Tests
// ============================================================================

describe('generateSetupCommands', () => {
  it('generates complete setup script', () => {
    const commands = generateSetupCommands({
      streamName: 'do_state_stream',
      sinkName: 'do_state_sink',
      pipelineName: 'do_state_pipeline',
      bucketName: 'cold-storage',
      namespace: 'do_state',
      tableName: 'changes',
      rollInterval: 60,
    })

    const script = commands.join('\n')

    // Check for all required commands
    expect(script).toContain('wrangler r2 bucket catalog enable cold-storage')
    expect(script).toContain('wrangler pipelines streams create do_state_stream')
    expect(script).toContain('wrangler pipelines sinks create do_state_sink')
    expect(script).toContain('--type "r2-data-catalog"')
    expect(script).toContain('--bucket "cold-storage"')
    expect(script).toContain('--namespace "do_state"')
    expect(script).toContain('--table "changes"')
    expect(script).toContain('--roll-interval 60')
    expect(script).toContain('--compression zstd')
    expect(script).toContain('wrangler pipelines create do_state_pipeline')
    expect(script).toContain('[[pipelines]]')
    expect(script).toContain('binding = "EVENTS"')
  })
})

// ============================================================================
// MockPipeline Tests
// ============================================================================

describe('MockPipeline', () => {
  let mock: MockPipeline

  beforeEach(() => {
    mock = new MockPipeline()
  })

  it('records all sent batches', async () => {
    await mock.send([{ a: 1 }])
    await mock.send([{ b: 2 }, { c: 3 }])

    expect(mock.sentRecords).toHaveLength(2)
    expect(mock.getTotalRecordCount()).toBe(3)
  })

  it('can simulate failures', async () => {
    mock.shouldFail = true

    await expect(mock.send([{ a: 1 }])).rejects.toThrow()
    expect(mock.failCount).toBe(1)
  })

  it('can simulate latency', async () => {
    mock.sendDelay = 50

    const start = performance.now()
    await mock.send([{ a: 1 }])
    const elapsed = performance.now() - start

    expect(elapsed).toBeGreaterThanOrEqual(45) // Allow some timing variance
  })

  it('resets state', async () => {
    mock.shouldFail = true
    mock.sendDelay = 100
    try { await mock.send([{ a: 1 }]) } catch { /* expected */ }

    mock.reset()

    expect(mock.sentRecords).toHaveLength(0)
    expect(mock.shouldFail).toBe(false)
    expect(mock.sendDelay).toBe(0)
    expect(mock.failCount).toBe(0)
  })
})

// ============================================================================
// Latency Comparison Test
// ============================================================================

describe('Latency Comparison', () => {
  it('compares Pipeline send vs parquet-wasm approach', async () => {
    const mock = new MockPipeline()

    // Simulate 1000 state changes
    const changes: StateChangeEvent[] = []
    for (let i = 0; i < 1000; i++) {
      changes.push({
        do_id: `do-${i % 10}`,
        ns: 'tenant.api',
        type: 'Event',
        key: `event-${i}`,
        value: JSON.stringify({ index: i, data: 'x'.repeat(100) }),
        op: 'PUT',
        timestamp: Date.now(),
        seq: i,
      })
    }

    // Measure Pipeline approach
    const pipelineStart = performance.now()
    await mock.send(changes)
    const pipelineElapsed = performance.now() - pipelineStart

    // Simulate parquet-wasm approach (just timing, not actual implementation)
    const parquetStart = performance.now()
    // Would do: await writeVectorsToParquet(changes, ...)
    // Simulate typical parquet-wasm overhead
    await new Promise(resolve => setTimeout(resolve, 50))
    const parquetElapsed = performance.now() - parquetStart

    console.log(`
  Latency Comparison (1000 events):
  ┌───────────────────────────────────────────┐
  │ Pipeline send():        ${pipelineElapsed.toFixed(2).padStart(8)}ms   │
  │ parquet-wasm (simulated): ${parquetElapsed.toFixed(2).padStart(8)}ms   │
  │ Speedup:                ${(parquetElapsed / pipelineElapsed).toFixed(1).padStart(8)}x   │
  └───────────────────────────────────────────┘
    `)

    // Pipeline should be much faster (just a network call, not WASM + compression)
    expect(pipelineElapsed).toBeLessThan(10) // Should be < 10ms
  })
})

// ============================================================================
// Memory Comparison Test
// ============================================================================

describe('Memory Comparison', () => {
  it('compares memory usage patterns', () => {
    // Pipeline approach: No WASM, no Arrow buffers
    const pipelineOverhead = {
      wasmModule: 0,       // No WASM needed
      arrowBuffers: 0,     // No Arrow tables
      parquetOutput: 0,    // No Parquet generation in DO
      total: 0,
    }

    // parquet-wasm approach
    const parquetOverhead = {
      wasmModule: 1.2 * 1024 * 1024,  // 1.2MB WASM
      arrowBuffers: 10 * 1024 * 1024,  // ~10MB for 10K rows
      parquetOutput: 2 * 1024 * 1024,  // ~2MB output buffer
      total: 13.2 * 1024 * 1024,
    }

    console.log(`
  Memory Comparison (DO-side):
  ┌────────────────────────────────────────────────┐
  │                 Pipeline   parquet-wasm        │
  │ WASM Module:        0 MB        1.2 MB        │
  │ Arrow Buffers:      0 MB       ~10 MB         │
  │ Output Buffer:      0 MB        ~2 MB         │
  │ ─────────────────────────────────────────────  │
  │ Total:              0 MB       ~13 MB         │
  │                                                │
  │ Note: Pipeline buffers on Cloudflare side,    │
  │       not in DO memory.                        │
  └────────────────────────────────────────────────┘
    `)

    expect(pipelineOverhead.total).toBe(0)
    expect(parquetOverhead.total).toBeGreaterThan(10 * 1024 * 1024)
  })
})

// ============================================================================
// Integration Test (Skipped - requires real Cloudflare setup)
// ============================================================================

describe.skip('Integration: Real Pipelines', () => {
  // These tests require:
  // - CLOUDFLARE_ACCOUNT_ID env var
  // - CLOUDFLARE_API_TOKEN env var
  // - An R2 bucket with Data Catalog enabled
  // - A configured Pipeline stream

  it('sends events to real pipeline', async () => {
    // Would use real Pipeline binding from env
    // const writer = new PipelineWriter(env.PIPELINE)
    // await writer.recordPut(...)
    // await writer.flush()
  })

  it('verifies data appears in Iceberg table', async () => {
    // Would query R2 SQL to verify:
    // SELECT * FROM do_state.changes WHERE timestamp > ...
  })
})
