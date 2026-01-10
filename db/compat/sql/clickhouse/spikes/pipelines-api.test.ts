/**
 * SPIKE TEST: Cloudflare Pipelines API for Dynamic Stream/Pipeline Creation
 *
 * Goal: Prove we can dynamically create Pipelines streams/sinks/pipelines
 *       via REST API for CREATE TABLE support
 *
 * Tests are structured in two groups:
 * 1. Unit tests (mocked API) - validate client logic
 * 2. Integration tests (real API) - validate actual Cloudflare behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  PipelinesClient,
  PipelinesApiError,
  StreamPool,
  clickHouseToStreamSchema,
  parseCreateTableColumns,
} from './pipelines-api'

// ============================================================================
// Unit Tests (Mocked API)
// ============================================================================

describe('Pipelines API Client - Unit Tests', () => {
  let client: PipelinesClient
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    globalThis.fetch = mockFetch

    client = new PipelinesClient({
      accountId: 'test-account-id',
      apiToken: 'test-api-token',
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('createStream', () => {
    it('sends correct request to create a stream', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          result: {
            id: 'stream-123',
            name: 'events_stream',
            endpoint: 'https://stream-123.ingest.cloudflare.com',
            created_at: '2026-01-10T00:00:00Z',
          },
          errors: [],
          messages: [],
        }),
      })

      const stream = await client.createStream({
        name: 'events_stream',
        schema: {
          user_id: { type: 'string', required: true },
          amount: { type: 'float64', required: false },
        },
      })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.cloudflare.com/client/v4/accounts/test-account-id/pipelines/v1/streams',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Authorization': 'Bearer test-api-token',
            'Content-Type': 'application/json',
          },
        })
      )

      expect(stream.id).toBe('stream-123')
      expect(stream.name).toBe('events_stream')
      expect(stream.endpoint).toBe('https://stream-123.ingest.cloudflare.com')
    })

    it('throws PipelinesApiError on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: async () => 'Invalid schema format',
      })

      await expect(client.createStream({ name: 'bad_stream' }))
        .rejects.toThrow(PipelinesApiError)
    })
  })

  describe('createSink', () => {
    it('sends correct request to create a sink', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          result: {
            id: 'sink-456',
            name: 'events_sink',
            destination_conf: {
              bucket: 'my-bucket',
              dataset: 'events',
              path_prefix: 'warehouse/',
              format: 'parquet',
            },
            created_at: '2026-01-10T00:00:00Z',
          },
          errors: [],
          messages: [],
        }),
      })

      const sink = await client.createSink({
        name: 'events_sink',
        destination_conf: {
          bucket: 'my-bucket',
          dataset: 'events',
          path_prefix: 'warehouse/',
          format: 'parquet',
        },
      })

      expect(sink.id).toBe('sink-456')
      expect(sink.destination_conf.format).toBe('parquet')
    })
  })

  describe('createPipeline', () => {
    it('sends correct request to create a pipeline', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          result: {
            id: 'pipeline-789',
            name: 'events_pipeline',
            source_conf: { source_id: 'stream-123', source_type: 'stream' },
            sink_conf: { sink_id: 'sink-456' },
            created_at: '2026-01-10T00:00:00Z',
          },
          errors: [],
          messages: [],
        }),
      })

      const pipeline = await client.createPipeline({
        name: 'events_pipeline',
        source_conf: { source_id: 'stream-123', source_type: 'stream' },
        sink_conf: { sink_id: 'sink-456' },
      })

      expect(pipeline.id).toBe('pipeline-789')
      expect(pipeline.source_conf.source_id).toBe('stream-123')
    })
  })

  describe('createTablePipeline', () => {
    it('creates stream, sink, and pipeline in sequence', async () => {
      // Mock stream creation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          result: {
            id: 'stream-123',
            name: 'events_stream',
            endpoint: 'https://stream-123.ingest.cloudflare.com',
            created_at: '2026-01-10T00:00:00Z',
          },
          errors: [],
          messages: [],
        }),
      })

      // Mock sink creation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          result: {
            id: 'sink-456',
            name: 'events_sink',
            destination_conf: { bucket: 'my-bucket', dataset: 'events' },
            created_at: '2026-01-10T00:00:00Z',
          },
          errors: [],
          messages: [],
        }),
      })

      // Mock pipeline creation
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          result: {
            id: 'pipeline-789',
            name: 'events_pipeline',
            source_conf: { source_id: 'stream-123', source_type: 'stream' },
            sink_conf: { sink_id: 'sink-456' },
            created_at: '2026-01-10T00:00:00Z',
          },
          errors: [],
          messages: [],
        }),
      })

      const result = await client.createTablePipeline({
        tableName: 'events',
        schema: {
          user_id: { type: 'string', required: true },
          amount: { type: 'float64', required: false },
        },
        r2Bucket: 'my-bucket',
        format: 'parquet',
      })

      expect(mockFetch).toHaveBeenCalledTimes(3)
      expect(result.stream.id).toBe('stream-123')
      expect(result.sink.id).toBe('sink-456')
      expect(result.pipeline.id).toBe('pipeline-789')
      expect(result.writeUrl).toBe('https://stream-123.ingest.cloudflare.com')
    })

    it('measures latency for full CREATE TABLE flow', async () => {
      // Simulate realistic API latencies
      const simulateLatency = (ms: number) =>
        new Promise(resolve => setTimeout(resolve, ms))

      mockFetch.mockImplementation(async () => {
        await simulateLatency(100) // Simulate 100ms per API call
        return {
          ok: true,
          json: async () => ({
            success: true,
            result: {
              id: `id-${Date.now()}`,
              name: 'test',
              endpoint: 'https://test.ingest.cloudflare.com',
              created_at: '2026-01-10T00:00:00Z',
              destination_conf: {},
              source_conf: { source_id: 'stream', source_type: 'stream' },
              sink_conf: { sink_id: 'sink' },
            },
            errors: [],
            messages: [],
          }),
        }
      })

      const start = performance.now()

      await client.createTablePipeline({
        tableName: 'latency_test',
        schema: { id: { type: 'int64', required: true } },
        r2Bucket: 'test-bucket',
      })

      const elapsed = performance.now() - start

      console.log(`\n  CREATE TABLE latency (mocked): ${elapsed.toFixed(0)}ms\n`)

      // With 3 sequential API calls at ~100ms each, expect ~300ms
      expect(elapsed).toBeGreaterThan(250)
      expect(elapsed).toBeLessThan(500)
    })
  })
})

// ============================================================================
// Stream Pool Tests
// ============================================================================

describe('Stream Pool', () => {
  let mockClient: PipelinesClient
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    globalThis.fetch = mockFetch

    mockClient = new PipelinesClient({
      accountId: 'test-account-id',
      apiToken: 'test-api-token',
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('allocates streams from pool with zero latency', async () => {
    const pool = new StreamPool(mockClient, { poolSize: 5 })

    // Mock listStreams returning existing pool streams
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        result: [
          { id: 'pool-1', name: 'pool_1', endpoint: 'https://pool-1.ingest.cloudflare.com' },
          { id: 'pool-2', name: 'pool_2', endpoint: 'https://pool-2.ingest.cloudflare.com' },
        ],
        errors: [],
        messages: [],
      }),
    })

    // Mock stream creation for additional pool streams
    for (let i = 0; i < 3; i++) {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          result: {
            id: `pool-${i + 3}`,
            name: `pool_${i + 3}`,
            endpoint: `https://pool-${i + 3}.ingest.cloudflare.com`,
          },
          errors: [],
          messages: [],
        }),
      })
    }

    await pool.initialize()

    const stats = pool.stats()
    expect(stats.total).toBe(5)
    expect(stats.available).toBe(5)
    expect(stats.inUse).toBe(0)

    // Allocation should be instant (no API call)
    const start = performance.now()
    const stream = pool.allocate('events_table')
    const elapsed = performance.now() - start

    console.log(`\n  Pool allocation latency: ${elapsed.toFixed(3)}ms\n`)

    expect(stream).not.toBeNull()
    expect(elapsed).toBeLessThan(1) // Sub-millisecond

    const statsAfter = pool.stats()
    expect(statsAfter.available).toBe(4)
    expect(statsAfter.inUse).toBe(1)
  })

  it('returns null when pool exhausted', async () => {
    const pool = new StreamPool(mockClient, { poolSize: 2 })

    // Mock listStreams
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        result: [],
        errors: [],
        messages: [],
      }),
    })

    // Mock stream creation
    for (let i = 0; i < 2; i++) {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          result: {
            id: `pool-${i}`,
            name: `pool_${i}`,
            endpoint: `https://pool-${i}.ingest.cloudflare.com`,
          },
          errors: [],
          messages: [],
        }),
      })
    }

    await pool.initialize()

    // Allocate all streams
    pool.allocate('table1')
    pool.allocate('table2')

    // Pool should be exhausted
    const stream = pool.allocate('table3')
    expect(stream).toBeNull()
  })

  it('releases streams back to pool', async () => {
    const pool = new StreamPool(mockClient, { poolSize: 1 })

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        result: [{ id: 'pool-1', name: 'pool_1', endpoint: 'https://pool-1.ingest.cloudflare.com' }],
        errors: [],
        messages: [],
      }),
    })

    await pool.initialize()

    const stream = pool.allocate('table1')
    expect(stream).not.toBeNull()
    expect(pool.stats().available).toBe(0)

    pool.release(stream!.id)
    expect(pool.stats().available).toBe(1)

    // Can allocate again
    const stream2 = pool.allocate('table2')
    expect(stream2).not.toBeNull()
  })
})

// ============================================================================
// ClickHouse Type Mapping Tests
// ============================================================================

describe('ClickHouse Type Mapping', () => {
  describe('clickHouseToStreamSchema', () => {
    it('maps integer types to int64', () => {
      const schema = clickHouseToStreamSchema([
        { name: 'a', type: 'Int32' },
        { name: 'b', type: 'UInt64' },
        { name: 'c', type: 'Int8' },
      ])

      expect(schema.a.type).toBe('int64')
      expect(schema.b.type).toBe('int64')
      expect(schema.c.type).toBe('int64')
    })

    it('maps float types to float64', () => {
      const schema = clickHouseToStreamSchema([
        { name: 'a', type: 'Float32' },
        { name: 'b', type: 'Float64' },
        { name: 'c', type: 'Decimal(10, 2)' },
      ])

      expect(schema.a.type).toBe('float64')
      expect(schema.b.type).toBe('float64')
      expect(schema.c.type).toBe('float64')
    })

    it('maps date/time types to timestamp', () => {
      const schema = clickHouseToStreamSchema([
        { name: 'a', type: 'Date' },
        { name: 'b', type: 'DateTime' },
        { name: 'c', type: 'DateTime64(3)' },
      ])

      expect(schema.a.type).toBe('timestamp')
      expect(schema.b.type).toBe('timestamp')
      expect(schema.c.type).toBe('timestamp')
    })

    it('maps string types to string', () => {
      const schema = clickHouseToStreamSchema([
        { name: 'a', type: 'String' },
        { name: 'b', type: 'FixedString(32)' },
        { name: 'c', type: "Enum8('a' = 1, 'b' = 2)" },
      ])

      expect(schema.a.type).toBe('string')
      expect(schema.b.type).toBe('string')
      expect(schema.c.type).toBe('string')
    })

    it('handles Nullable types', () => {
      const schema = clickHouseToStreamSchema([
        { name: 'a', type: 'Nullable(Int32)', nullable: true },
        { name: 'b', type: 'Int32', nullable: false },
      ])

      expect(schema.a.required).toBe(false)
      expect(schema.b.required).toBe(true)
    })
  })

  describe('parseCreateTableColumns', () => {
    it('parses simple CREATE TABLE statement', () => {
      const sql = `
        CREATE TABLE events (
          id UInt64,
          user_id String,
          amount Float64
        ) ENGINE = Iceberg('s3://bucket/warehouse/events')
      `

      const columns = parseCreateTableColumns(sql)

      expect(columns).toHaveLength(3)
      expect(columns[0]).toEqual({ name: 'id', type: 'UInt64', nullable: false })
      expect(columns[1]).toEqual({ name: 'user_id', type: 'String', nullable: false })
      expect(columns[2]).toEqual({ name: 'amount', type: 'Float64', nullable: false })
    })

    it('parses CREATE TABLE with Nullable columns', () => {
      const sql = `
        CREATE TABLE events (
          id UInt64,
          optional_field Nullable(String)
        ) ENGINE = MergeTree()
      `

      const columns = parseCreateTableColumns(sql)

      expect(columns).toHaveLength(2)
      expect(columns[1].nullable).toBe(true)
    })

    it('handles complex types with parentheses', () => {
      const sql = `
        CREATE TABLE events (
          id UInt64,
          metadata Map(String, String),
          tags Array(String)
        ) ENGINE = Log
      `

      const columns = parseCreateTableColumns(sql)

      expect(columns).toHaveLength(3)
      expect(columns[1]).toEqual({
        name: 'metadata',
        type: 'Map(String, String)',
        nullable: false,
      })
      expect(columns[2]).toEqual({
        name: 'tags',
        type: 'Array(String)',
        nullable: false,
      })
    })
  })
})

// ============================================================================
// Integration Tests (Real API - Skipped by Default)
// ============================================================================

describe.skip('Pipelines API - Integration Tests', () => {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const apiToken = process.env.CLOUDFLARE_API_TOKEN

  if (!accountId || !apiToken) {
    console.log('Skipping integration tests: CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN required')
    return
  }

  let client: PipelinesClient
  const createdResources: { streams: string[]; sinks: string[]; pipelines: string[] } = {
    streams: [],
    sinks: [],
    pipelines: [],
  }

  beforeEach(() => {
    client = new PipelinesClient({ accountId, apiToken })
  })

  afterEach(async () => {
    // Cleanup created resources
    for (const id of createdResources.pipelines) {
      try {
        await client.deletePipeline(id)
      } catch { /* ignore */ }
    }
    for (const id of createdResources.sinks) {
      try {
        await client.deleteSink(id)
      } catch { /* ignore */ }
    }
    for (const id of createdResources.streams) {
      try {
        await client.deleteStream(id)
      } catch { /* ignore */ }
    }
    createdResources.streams = []
    createdResources.sinks = []
    createdResources.pipelines = []
  })

  it('creates a real stream via API', async () => {
    const stream = await client.createStream({
      name: `spike_test_${Date.now()}`,
    })

    createdResources.streams.push(stream.id)

    expect(stream.id).toBeTruthy()
    expect(stream.endpoint).toContain('ingest.cloudflare.com')

    console.log(`\n  Created stream: ${stream.id}\n  Endpoint: ${stream.endpoint}\n`)
  })

  it('measures real CREATE TABLE latency', async () => {
    const start = performance.now()

    const result = await client.createTablePipeline({
      tableName: `spike_${Date.now()}`,
      schema: {
        id: { type: 'int64', required: true },
        name: { type: 'string', required: true },
      },
      r2Bucket: 'test-bucket',
    })

    const elapsed = performance.now() - start

    createdResources.streams.push(result.stream.id)
    createdResources.sinks.push(result.sink.id)
    createdResources.pipelines.push(result.pipeline.id)

    console.log(`\n  Real CREATE TABLE latency: ${elapsed.toFixed(0)}ms`)
    console.log(`    Stream: ${result.stream.id}`)
    console.log(`    Sink: ${result.sink.id}`)
    console.log(`    Pipeline: ${result.pipeline.id}`)
    console.log(`    Write URL: ${result.writeUrl}\n`)

    // Expected: 500ms - 1.5s based on research
    expect(elapsed).toBeLessThan(3000)
  })

  it('lists current streams and checks quota', async () => {
    const streams = await client.listStreams()
    const sinks = await client.listSinks()
    const pipelines = await client.listPipelines()

    console.log(`\n  Current quota usage:`)
    console.log(`    Streams: ${streams.length}/20`)
    console.log(`    Sinks: ${sinks.length}/20`)
    console.log(`    Pipelines: ${pipelines.length}/20\n`)

    expect(streams.length).toBeLessThanOrEqual(20)
    expect(sinks.length).toBeLessThanOrEqual(20)
    expect(pipelines.length).toBeLessThanOrEqual(20)
  })
})
