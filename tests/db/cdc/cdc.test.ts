/**
 * CDC (Change Data Capture) Tests (RED Phase)
 *
 * These tests verify the CDC system that provides a unified event format
 * for capturing changes from all store primitives, flowing through
 * Cloudflare Pipelines to R2 Iceberg tables.
 *
 * Implementation requirements:
 * - Create db/cdc/index.ts with UnifiedEvent type and CDCEmitter class
 * - CDCEmitter.emit(event) - emits a single event to the pipeline
 * - CDCEmitter.emitBatch(events) - emits multiple events in a batch
 * - Store integration hooks for automatic CDC emission
 * - Correlation ID propagation across events
 * - Exactly-once delivery via ExactlyOnceContext
 * - Pipeline SQL transform helpers
 *
 * This is the RED phase of TDD - tests should fail because the
 * implementation doesn't exist yet.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// These imports should fail until the implementation exists
import {
  CDCEmitter,
  type UnifiedEvent,
  type StoreType,
  type CDCOperation,
  type EventMeta,
  createCDCEvent,
  transformForPipeline,
} from '../../../db/cdc'

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockPipeline() {
  return {
    send: vi.fn().mockResolvedValue(undefined),
  }
}

function createSampleCDCEvent(overrides: Partial<UnifiedEvent> = {}): UnifiedEvent {
  return {
    id: '01HQXYZ1234567890ABCDEFGHIJ',
    type: 'cdc.insert',
    timestamp: '2024-01-14T12:00:00.000Z',
    ns: 'startups.studio',
    op: 'c',
    store: 'document',
    table: 'Customer',
    key: 'cust_123',
    after: { name: 'Alice', email: 'alice@example.com' },
    ...overrides,
  }
}

function createSampleDomainEvent(overrides: Partial<UnifiedEvent> = {}): UnifiedEvent {
  return {
    id: '01HQXYZ1234567890ABCDEFGHIK',
    type: 'Customer.created',
    timestamp: '2024-01-14T12:00:00.000Z',
    ns: 'startups.studio',
    actor: 'User/nathan',
    data: { customerId: 'cust_123', source: 'signup' },
    ...overrides,
  }
}

function createFullCDCEvent(): UnifiedEvent {
  return {
    id: '01HQXYZ1234567890ABCDEFGHIL',
    type: 'cdc.update',
    timestamp: '2024-01-14T12:30:00.000Z',
    ns: 'startups.studio',
    correlationId: 'req-abc-123',
    op: 'u',
    store: 'document',
    table: 'Customer',
    key: 'cust_123',
    before: { name: 'Alice', email: 'alice@old.com' },
    after: { name: 'Alice', email: 'alice@new.com' },
    txid: 'tx-001',
    lsn: 42,
    actor: 'User/nathan',
    data: { reason: 'email_update' },
    visibility: 'team',
    _meta: {
      schemaVersion: 1,
      source: 'DO/customers',
      retries: 0,
    },
  }
}

// ============================================================================
// UnifiedEvent Type Structure Tests
// ============================================================================

describe('UnifiedEvent Type Structure', () => {
  describe('envelope fields', () => {
    it('requires id field (ULID format)', () => {
      const event = createSampleCDCEvent()

      expect(event.id).toBeDefined()
      expect(typeof event.id).toBe('string')
      expect(event.id.length).toBe(26) // ULID length
    })

    it('requires type field', () => {
      const event = createSampleCDCEvent()

      expect(event.type).toBeDefined()
      expect(typeof event.type).toBe('string')
    })

    it('requires timestamp field (ISO 8601)', () => {
      const event = createSampleCDCEvent()

      expect(event.timestamp).toBeDefined()
      expect(typeof event.timestamp).toBe('string')
      // Should be valid ISO 8601
      expect(() => new Date(event.timestamp)).not.toThrow()
    })

    it('requires ns field (namespace)', () => {
      const event = createSampleCDCEvent()

      expect(event.ns).toBeDefined()
      expect(typeof event.ns).toBe('string')
    })

    it('accepts optional correlationId', () => {
      const eventWithCorrelation = createSampleCDCEvent({ correlationId: 'req-123' })
      const eventWithoutCorrelation = createSampleCDCEvent()
      delete eventWithoutCorrelation.correlationId

      expect(eventWithCorrelation.correlationId).toBe('req-123')
      expect(eventWithoutCorrelation.correlationId).toBeUndefined()
    })
  })

  describe('CDC fields', () => {
    it('op field accepts valid operations', () => {
      const operations: CDCOperation[] = ['c', 'u', 'd', 'r']

      operations.forEach((op) => {
        const event = createSampleCDCEvent({ op })
        expect(event.op).toBe(op)
      })
    })

    it('store field accepts valid store types', () => {
      const stores: StoreType[] = [
        'document',
        'graph',
        'relational',
        'columnar',
        'timeseries',
        'vector',
      ]

      stores.forEach((store) => {
        const event = createSampleCDCEvent({ store })
        expect(event.store).toBe(store)
      })
    })

    it('table field identifies the collection', () => {
      const event = createSampleCDCEvent({ table: 'Customer' })
      expect(event.table).toBe('Customer')
    })

    it('key field identifies the primary key', () => {
      const event = createSampleCDCEvent({ key: 'cust_123' })
      expect(event.key).toBe('cust_123')
    })

    it('before field contains previous state for updates and deletes', () => {
      const updateEvent = createSampleCDCEvent({
        op: 'u',
        before: { name: 'Alice', email: 'old@example.com' },
        after: { name: 'Alice', email: 'new@example.com' },
      })

      expect(updateEvent.before).toEqual({ name: 'Alice', email: 'old@example.com' })
    })

    it('after field contains new state for creates and updates', () => {
      const createEvent = createSampleCDCEvent({
        op: 'c',
        after: { name: 'Alice', email: 'alice@example.com' },
      })

      expect(createEvent.after).toEqual({ name: 'Alice', email: 'alice@example.com' })
    })

    it('txid field groups batched changes', () => {
      const event = createSampleCDCEvent({ txid: 'tx-001' })
      expect(event.txid).toBe('tx-001')
    })

    it('lsn field provides ordering', () => {
      const event = createSampleCDCEvent({ lsn: 42 })
      expect(event.lsn).toBe(42)
    })
  })

  describe('domain event fields', () => {
    it('actor field identifies who triggered the event', () => {
      const event = createSampleDomainEvent({ actor: 'User/alice' })
      expect(event.actor).toBe('User/alice')
    })

    it('data field contains domain-specific payload', () => {
      const event = createSampleDomainEvent({
        data: { customerId: 'cust_123', source: 'signup' },
      })
      expect(event.data).toEqual({ customerId: 'cust_123', source: 'signup' })
    })

    it('visibility field controls access', () => {
      const visibilities = ['user', 'team', 'public'] as const

      visibilities.forEach((visibility) => {
        const event = createSampleDomainEvent({ visibility })
        expect(event.visibility).toBe(visibility)
      })
    })
  })

  describe('metadata fields', () => {
    it('_meta contains schema version', () => {
      const event = createFullCDCEvent()
      expect(event._meta?.schemaVersion).toBe(1)
    })

    it('_meta contains source', () => {
      const event = createFullCDCEvent()
      expect(event._meta?.source).toBe('DO/customers')
    })

    it('_meta contains optional retries count', () => {
      const event = createFullCDCEvent()
      expect(event._meta?.retries).toBe(0)
    })
  })
})

// ============================================================================
// CDCEmitter Tests
// ============================================================================

describe('CDCEmitter', () => {
  let mockPipeline: ReturnType<typeof createMockPipeline>
  let emitter: CDCEmitter

  beforeEach(() => {
    mockPipeline = createMockPipeline()
    emitter = new CDCEmitter(mockPipeline as any, {
      ns: 'startups.studio',
      source: 'DO/customers',
    })
  })

  describe('construction', () => {
    it('creates emitter with pipeline binding and options', () => {
      const emitter = new CDCEmitter(mockPipeline as any, {
        ns: 'startups.studio',
        source: 'DO/customers',
      })

      expect(emitter).toBeDefined()
    })

    it('requires ns option', () => {
      expect(() => {
        new CDCEmitter(mockPipeline as any, {
          ns: '',
          source: 'DO/customers',
        })
      }).toThrow()
    })

    it('requires source option', () => {
      expect(() => {
        new CDCEmitter(mockPipeline as any, {
          ns: 'startups.studio',
          source: '',
        })
      }).toThrow()
    })
  })

  describe('emit', () => {
    it('emits CDC event with op and store fields', async () => {
      await emitter.emit({
        op: 'c',
        store: 'document',
        table: 'Customer',
        key: 'cust_123',
        after: { name: 'Alice', email: 'alice@example.com' },
      })

      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
      const sentEvents = mockPipeline.send.mock.calls[0][0]
      expect(sentEvents).toHaveLength(1)
      expect(sentEvents[0].op).toBe('c')
      expect(sentEvents[0].store).toBe('document')
    })

    it('emits domain event with type and actor', async () => {
      await emitter.emit({
        type: 'Customer.created',
        actor: 'User/nathan',
        data: { customerId: 'cust_123', source: 'signup' },
      })

      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
      const sentEvents = mockPipeline.send.mock.calls[0][0]
      expect(sentEvents[0].type).toBe('Customer.created')
      expect(sentEvents[0].actor).toBe('User/nathan')
    })

    it('auto-generates id if not provided', async () => {
      await emitter.emit({
        op: 'c',
        store: 'document',
        table: 'Customer',
        key: 'cust_123',
        after: { name: 'Alice' },
      })

      const sentEvents = mockPipeline.send.mock.calls[0][0]
      expect(sentEvents[0].id).toBeDefined()
      expect(sentEvents[0].id.length).toBe(26) // ULID length
    })

    it('auto-generates timestamp if not provided', async () => {
      await emitter.emit({
        op: 'c',
        store: 'document',
        table: 'Customer',
        key: 'cust_123',
        after: { name: 'Alice' },
      })

      const sentEvents = mockPipeline.send.mock.calls[0][0]
      expect(sentEvents[0].timestamp).toBeDefined()
      expect(() => new Date(sentEvents[0].timestamp)).not.toThrow()
    })

    it('uses configured ns', async () => {
      await emitter.emit({
        op: 'c',
        store: 'document',
        table: 'Customer',
        key: 'cust_123',
        after: { name: 'Alice' },
      })

      const sentEvents = mockPipeline.send.mock.calls[0][0]
      expect(sentEvents[0].ns).toBe('startups.studio')
    })

    it('adds source to _meta', async () => {
      await emitter.emit({
        op: 'c',
        store: 'document',
        table: 'Customer',
        key: 'cust_123',
        after: { name: 'Alice' },
      })

      const sentEvents = mockPipeline.send.mock.calls[0][0]
      expect(sentEvents[0]._meta?.source).toBe('DO/customers')
    })

    it('returns the emitted event', async () => {
      const result = await emitter.emit({
        op: 'c',
        store: 'document',
        table: 'Customer',
        key: 'cust_123',
        after: { name: 'Alice' },
      })

      expect(result).toBeDefined()
      expect(result.id).toBeDefined()
      expect(result.op).toBe('c')
    })
  })

  describe('emitBatch', () => {
    it('emits multiple events in a single call', async () => {
      await emitter.emitBatch([
        { op: 'c', store: 'document', table: 'Order', key: 'ord_1', after: { total: 100 } },
        { op: 'c', store: 'document', table: 'Order', key: 'ord_2', after: { total: 200 } },
        { op: 'c', store: 'document', table: 'Order', key: 'ord_3', after: { total: 300 } },
      ])

      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
      const sentEvents = mockPipeline.send.mock.calls[0][0]
      expect(sentEvents).toHaveLength(3)
    })

    it('assigns unique ids to each event', async () => {
      await emitter.emitBatch([
        { op: 'c', store: 'document', table: 'Order', key: 'ord_1', after: { total: 100 } },
        { op: 'c', store: 'document', table: 'Order', key: 'ord_2', after: { total: 200 } },
      ])

      const sentEvents = mockPipeline.send.mock.calls[0][0]
      const ids = sentEvents.map((e: UnifiedEvent) => e.id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(2)
    })

    it('shares txid across batch events when provided', async () => {
      await emitter.emitBatch(
        [
          { op: 'c', store: 'document', table: 'Order', key: 'ord_1', after: { total: 100 } },
          { op: 'c', store: 'document', table: 'Order', key: 'ord_2', after: { total: 200 } },
        ],
        { txid: 'tx-batch-001' }
      )

      const sentEvents = mockPipeline.send.mock.calls[0][0]
      expect(sentEvents[0].txid).toBe('tx-batch-001')
      expect(sentEvents[1].txid).toBe('tx-batch-001')
    })

    it('assigns sequential lsn values', async () => {
      await emitter.emitBatch([
        { op: 'c', store: 'document', table: 'Order', key: 'ord_1', after: { total: 100 } },
        { op: 'c', store: 'document', table: 'Order', key: 'ord_2', after: { total: 200 } },
        { op: 'c', store: 'document', table: 'Order', key: 'ord_3', after: { total: 300 } },
      ])

      const sentEvents = mockPipeline.send.mock.calls[0][0]
      expect(sentEvents[0].lsn).toBe(0)
      expect(sentEvents[1].lsn).toBe(1)
      expect(sentEvents[2].lsn).toBe(2)
    })

    it('returns all emitted events', async () => {
      const results = await emitter.emitBatch([
        { op: 'c', store: 'document', table: 'Order', key: 'ord_1', after: { total: 100 } },
        { op: 'c', store: 'document', table: 'Order', key: 'ord_2', after: { total: 200 } },
      ])

      expect(results).toHaveLength(2)
      expect(results[0].key).toBe('ord_1')
      expect(results[1].key).toBe('ord_2')
    })

    it('handles empty batch gracefully', async () => {
      const results = await emitter.emitBatch([])

      expect(results).toHaveLength(0)
      expect(mockPipeline.send).not.toHaveBeenCalled()
    })
  })
})

// ============================================================================
// Store Integration Hooks Tests
// ============================================================================

describe('Store Integration Hooks', () => {
  let mockPipeline: ReturnType<typeof createMockPipeline>
  let emitter: CDCEmitter

  beforeEach(() => {
    mockPipeline = createMockPipeline()
    emitter = new CDCEmitter(mockPipeline as any, {
      ns: 'startups.studio',
      source: 'DO/customers',
    })
  })

  describe('DocumentStore integration', () => {
    it('emits CDC event on document create', async () => {
      await emitter.emit({
        op: 'c',
        store: 'document',
        table: 'Customer',
        key: 'cust_123',
        after: { name: 'Alice', email: 'alice@example.com' },
      })

      const sentEvents = mockPipeline.send.mock.calls[0][0]
      expect(sentEvents[0].store).toBe('document')
      expect(sentEvents[0].op).toBe('c')
      expect(sentEvents[0].after).toEqual({ name: 'Alice', email: 'alice@example.com' })
    })

    it('emits CDC event on document update with before/after', async () => {
      await emitter.emit({
        op: 'u',
        store: 'document',
        table: 'Customer',
        key: 'cust_123',
        before: { name: 'Alice', email: 'old@example.com' },
        after: { name: 'Alice', email: 'new@example.com' },
      })

      const sentEvents = mockPipeline.send.mock.calls[0][0]
      expect(sentEvents[0].op).toBe('u')
      expect(sentEvents[0].before).toEqual({ name: 'Alice', email: 'old@example.com' })
      expect(sentEvents[0].after).toEqual({ name: 'Alice', email: 'new@example.com' })
    })

    it('emits CDC event on document delete with before state', async () => {
      await emitter.emit({
        op: 'd',
        store: 'document',
        table: 'Customer',
        key: 'cust_123',
        before: { name: 'Alice', email: 'alice@example.com' },
      })

      const sentEvents = mockPipeline.send.mock.calls[0][0]
      expect(sentEvents[0].op).toBe('d')
      expect(sentEvents[0].before).toEqual({ name: 'Alice', email: 'alice@example.com' })
      expect(sentEvents[0].after).toBeUndefined()
    })
  })

  describe('GraphStore integration', () => {
    it('emits CDC event on edge create', async () => {
      await emitter.emit({
        op: 'c',
        store: 'graph',
        table: 'Edge',
        key: 'edge_123',
        after: {
          from: 'Customer/cust_1',
          to: 'Order/ord_1',
          type: 'placed',
        },
      })

      const sentEvents = mockPipeline.send.mock.calls[0][0]
      expect(sentEvents[0].store).toBe('graph')
      expect(sentEvents[0].after).toHaveProperty('from')
      expect(sentEvents[0].after).toHaveProperty('to')
      expect(sentEvents[0].after).toHaveProperty('type')
    })
  })

  describe('RelationalStore integration', () => {
    it('emits CDC event on row insert', async () => {
      await emitter.emit({
        op: 'c',
        store: 'relational',
        table: 'customers',
        key: '123',
        after: { id: 123, name: 'Alice', created_at: '2024-01-14' },
      })

      const sentEvents = mockPipeline.send.mock.calls[0][0]
      expect(sentEvents[0].store).toBe('relational')
    })
  })

  describe('TimeSeriesStore integration', () => {
    it('emits CDC event on data point write', async () => {
      await emitter.emit({
        op: 'c',
        store: 'timeseries',
        table: 'metrics',
        key: '2024-01-14T12:00:00Z',
        after: { value: 42.5, tags: { host: 'server-1' } },
      })

      const sentEvents = mockPipeline.send.mock.calls[0][0]
      expect(sentEvents[0].store).toBe('timeseries')
    })

    it('emits read event for rollup queries', async () => {
      await emitter.emit({
        op: 'r',
        store: 'timeseries',
        table: 'metrics',
        data: { query: 'rollup', window: '1h', result_count: 24 },
      })

      const sentEvents = mockPipeline.send.mock.calls[0][0]
      expect(sentEvents[0].op).toBe('r')
      expect(sentEvents[0].store).toBe('timeseries')
    })
  })

  describe('ColumnarStore integration', () => {
    it('emits CDC event on batch insert', async () => {
      await emitter.emit({
        op: 'c',
        store: 'columnar',
        table: 'events',
        data: { row_count: 1000, partition: '2024-01' },
      })

      const sentEvents = mockPipeline.send.mock.calls[0][0]
      expect(sentEvents[0].store).toBe('columnar')
      expect(sentEvents[0].data).toHaveProperty('row_count')
    })
  })

  describe('VectorStore integration', () => {
    it('emits CDC event on embedding create (metadata only)', async () => {
      await emitter.emit({
        op: 'c',
        store: 'vector',
        table: 'embeddings',
        key: 'vec_123',
        after: {
          // Note: Full vectors NOT included in CDC (too large)
          dimensions: 1536,
          model: 'text-embedding-3-small',
          source_id: 'doc_456',
        },
      })

      const sentEvents = mockPipeline.send.mock.calls[0][0]
      expect(sentEvents[0].store).toBe('vector')
      expect(sentEvents[0].after).not.toHaveProperty('vector') // Vector excluded
      expect(sentEvents[0].after).toHaveProperty('dimensions')
    })
  })
})

// ============================================================================
// Correlation ID Propagation Tests
// ============================================================================

describe('Correlation ID Propagation', () => {
  let mockPipeline: ReturnType<typeof createMockPipeline>
  let emitter: CDCEmitter

  beforeEach(() => {
    mockPipeline = createMockPipeline()
    emitter = new CDCEmitter(mockPipeline as any, {
      ns: 'startups.studio',
      source: 'DO/customers',
    })
  })

  it('accepts correlationId in emit options', async () => {
    await emitter.emit(
      {
        op: 'c',
        store: 'document',
        table: 'Customer',
        key: 'cust_123',
        after: { name: 'Alice' },
      },
      { correlationId: 'req-abc-123' }
    )

    const sentEvents = mockPipeline.send.mock.calls[0][0]
    expect(sentEvents[0].correlationId).toBe('req-abc-123')
  })

  it('propagates correlationId to batch events', async () => {
    await emitter.emitBatch(
      [
        { op: 'c', store: 'document', table: 'Order', key: 'ord_1', after: { total: 100 } },
        { op: 'c', store: 'document', table: 'Order', key: 'ord_2', after: { total: 200 } },
      ],
      { correlationId: 'req-xyz-789' }
    )

    const sentEvents = mockPipeline.send.mock.calls[0][0]
    expect(sentEvents[0].correlationId).toBe('req-xyz-789')
    expect(sentEvents[1].correlationId).toBe('req-xyz-789')
  })

  it('supports withCorrelation helper for context propagation', async () => {
    const contextEmitter = emitter.withCorrelation('ctx-123')

    await contextEmitter.emit({
      op: 'c',
      store: 'document',
      table: 'Customer',
      key: 'cust_123',
      after: { name: 'Alice' },
    })

    const sentEvents = mockPipeline.send.mock.calls[0][0]
    expect(sentEvents[0].correlationId).toBe('ctx-123')
  })

  it('withCorrelation returns same type as parent emitter', async () => {
    const contextEmitter = emitter.withCorrelation('ctx-123')

    expect(contextEmitter).toBeInstanceOf(CDCEmitter)
    expect(typeof contextEmitter.emit).toBe('function')
    expect(typeof contextEmitter.emitBatch).toBe('function')
  })

  it('allows chaining withCorrelation calls', async () => {
    const firstContext = emitter.withCorrelation('ctx-1')
    const secondContext = firstContext.withCorrelation('ctx-2')

    await secondContext.emit({
      op: 'c',
      store: 'document',
      table: 'Customer',
      key: 'cust_123',
      after: { name: 'Alice' },
    })

    const sentEvents = mockPipeline.send.mock.calls[0][0]
    // Later withCorrelation overrides earlier
    expect(sentEvents[0].correlationId).toBe('ctx-2')
  })
})

// ============================================================================
// Exactly-Once Delivery Tests
// ============================================================================

describe('Exactly-Once Delivery', () => {
  it('imports ExactlyOnceContext from do/primitives', async () => {
    // This import should fail until implementation exists
    const { ExactlyOnceContext } = await import('../../../do/primitives')
    expect(ExactlyOnceContext).toBeDefined()
  })

  it('creates ExactlyOnceContext with db', async () => {
    const { ExactlyOnceContext } = await import('../../../do/primitives')
    const mockDb = {} as any

    const ctx = new ExactlyOnceContext(mockDb)
    expect(ctx).toBeDefined()
  })

  it('transaction commits both mutation and event atomically', async () => {
    const { ExactlyOnceContext } = await import('../../../do/primitives')
    const mockDb = {
      exec: vi.fn(),
    } as any

    const ctx = new ExactlyOnceContext(mockDb)
    let mutationExecuted = false
    let eventEmitted = false

    await ctx.transaction(async (tx) => {
      // Store mutation
      await tx.execute('INSERT INTO customers VALUES (...)')
      mutationExecuted = true

      // CDC event (part of same transaction)
      await tx.emit({
        op: 'c',
        store: 'document',
        table: 'Customer',
        key: 'cust_123',
        after: { name: 'Alice' },
      })
      eventEmitted = true
    })

    expect(mutationExecuted).toBe(true)
    expect(eventEmitted).toBe(true)
  })

  it('transaction rollback prevents both mutation and event', async () => {
    const { ExactlyOnceContext } = await import('../../../do/primitives')
    const mockDb = {} as any
    const mockPipeline = createMockPipeline()

    const ctx = new ExactlyOnceContext(mockDb, mockPipeline)

    await expect(
      ctx.transaction(async (tx) => {
        await tx.execute('INSERT INTO customers VALUES (...)')
        await tx.emit({
          op: 'c',
          store: 'document',
          table: 'Customer',
          key: 'cust_123',
          after: { name: 'Alice' },
        })
        throw new Error('Intentional rollback')
      })
    ).rejects.toThrow('Intentional rollback')

    // Pipeline should not have been called
    expect(mockPipeline.send).not.toHaveBeenCalled()
  })

  it('tx.emit queues event until transaction commits', async () => {
    const { ExactlyOnceContext } = await import('../../../do/primitives')
    const mockDb = {} as any
    const mockPipeline = createMockPipeline()

    const ctx = new ExactlyOnceContext(mockDb, mockPipeline)

    await ctx.transaction(async (tx) => {
      await tx.emit({
        op: 'c',
        store: 'document',
        table: 'Customer',
        key: 'cust_123',
        after: { name: 'Alice' },
      })

      // Event not yet sent (still in transaction)
      expect(mockPipeline.send).not.toHaveBeenCalled()
    })

    // After transaction commits, event is sent
    expect(mockPipeline.send).toHaveBeenCalledTimes(1)
  })

  it('multiple tx.emit calls in one transaction batch together', async () => {
    const { ExactlyOnceContext } = await import('../../../do/primitives')
    const mockDb = {} as any
    const mockPipeline = createMockPipeline()

    const ctx = new ExactlyOnceContext(mockDb, mockPipeline)

    await ctx.transaction(async (tx) => {
      await tx.emit({
        op: 'c',
        store: 'document',
        table: 'Customer',
        key: 'cust_1',
        after: { name: 'Alice' },
      })
      await tx.emit({
        op: 'c',
        store: 'document',
        table: 'Customer',
        key: 'cust_2',
        after: { name: 'Bob' },
      })
    })

    // All events sent in single batch
    expect(mockPipeline.send).toHaveBeenCalledTimes(1)
    const sentEvents = mockPipeline.send.mock.calls[0][0]
    expect(sentEvents).toHaveLength(2)
  })
})

// ============================================================================
// Pipeline SQL Transform Tests
// ============================================================================

describe('Pipeline SQL Transform', () => {
  describe('transformForPipeline helper', () => {
    it('expands local IDs to global URLs', () => {
      const event = createSampleCDCEvent({
        ns: 'startups.studio',
        table: 'Customer',
      })

      const result = transformForPipeline(event)

      expect(result.table_url).toBe('startups.studio/Customer')
    })

    it('creates source URL from ns and _meta.source', () => {
      const event = createFullCDCEvent()

      const result = transformForPipeline(event)

      expect(result.source).toBe('startups.studio/DO/customers')
    })

    it('converts timestamp to ISO format', () => {
      const event = createSampleCDCEvent({
        timestamp: '2024-01-14T12:00:00.000Z',
      })

      const result = transformForPipeline(event)

      expect(result.timestamp).toBe('2024-01-14T12:00:00.000Z')
    })

    it('preserves id field', () => {
      const event = createSampleCDCEvent({
        id: '01HQXYZ1234567890ABCDEFGHIJ',
      })

      const result = transformForPipeline(event)

      expect(result.id).toBe('01HQXYZ1234567890ABCDEFGHIJ')
    })

    it('preserves type field', () => {
      const event = createSampleCDCEvent({
        type: 'Customer.created',
      })

      const result = transformForPipeline(event)

      expect(result.type).toBe('Customer.created')
    })

    it('preserves op field', () => {
      const event = createSampleCDCEvent({ op: 'u' })

      const result = transformForPipeline(event)

      expect(result.op).toBe('u')
    })

    it('preserves store field', () => {
      const event = createSampleCDCEvent({ store: 'graph' })

      const result = transformForPipeline(event)

      expect(result.store).toBe('graph')
    })

    it('preserves key field', () => {
      const event = createSampleCDCEvent({ key: 'cust_123' })

      const result = transformForPipeline(event)

      expect(result.key).toBe('cust_123')
    })

    it('serializes before field to JSON', () => {
      const event = createSampleCDCEvent({
        op: 'u',
        before: { name: 'Alice', email: 'old@example.com' },
      })

      const result = transformForPipeline(event)

      expect(typeof result.before).toBe('string')
      expect(JSON.parse(result.before as string)).toEqual({
        name: 'Alice',
        email: 'old@example.com',
      })
    })

    it('serializes after field to JSON', () => {
      const event = createSampleCDCEvent({
        after: { name: 'Alice', email: 'alice@example.com' },
      })

      const result = transformForPipeline(event)

      expect(typeof result.after).toBe('string')
      expect(JSON.parse(result.after as string)).toEqual({
        name: 'Alice',
        email: 'alice@example.com',
      })
    })

    it('preserves actor field', () => {
      const event = createSampleDomainEvent({ actor: 'User/nathan' })

      const result = transformForPipeline(event)

      expect(result.actor).toBe('User/nathan')
    })

    it('serializes data field to JSON', () => {
      const event = createSampleDomainEvent({
        data: { customerId: 'cust_123', source: 'signup' },
      })

      const result = transformForPipeline(event)

      expect(typeof result.data).toBe('string')
      expect(JSON.parse(result.data as string)).toEqual({
        customerId: 'cust_123',
        source: 'signup',
      })
    })

    it('maps correlationId to correlation_id', () => {
      const event = createSampleCDCEvent({ correlationId: 'req-abc-123' })

      const result = transformForPipeline(event)

      expect(result).toHaveProperty('correlation_id')
      expect(result.correlation_id).toBe('req-abc-123')
      expect(result).not.toHaveProperty('correlationId')
    })

    it('serializes _meta to JSON', () => {
      const event = createFullCDCEvent()

      const result = transformForPipeline(event)

      expect(typeof result._meta).toBe('string')
      const parsed = JSON.parse(result._meta as string)
      expect(parsed.schemaVersion).toBe(1)
      expect(parsed.source).toBe('DO/customers')
    })

    it('converts null fields correctly', () => {
      const event = createSampleCDCEvent()
      delete (event as any).before
      delete (event as any).actor
      delete (event as any).data

      const result = transformForPipeline(event)

      expect(result.before).toBeNull()
      expect(result.actor).toBeNull()
      expect(result.data).toBeNull()
    })
  })

  describe('createCDCEvent helper', () => {
    it('creates valid UnifiedEvent from partial input', () => {
      const event = createCDCEvent({
        op: 'c',
        store: 'document',
        table: 'Customer',
        key: 'cust_123',
        after: { name: 'Alice' },
      })

      expect(event.id).toBeDefined()
      expect(event.timestamp).toBeDefined()
      expect(event.type).toBe('cdc.insert')
      expect(event.op).toBe('c')
    })

    it('generates type from op for CDC events', () => {
      expect(createCDCEvent({ op: 'c', store: 'document' }).type).toBe('cdc.insert')
      expect(createCDCEvent({ op: 'u', store: 'document' }).type).toBe('cdc.update')
      expect(createCDCEvent({ op: 'd', store: 'document' }).type).toBe('cdc.delete')
      expect(createCDCEvent({ op: 'r', store: 'document' }).type).toBe('cdc.read')
    })

    it('preserves explicit type over generated type', () => {
      const event = createCDCEvent({
        type: 'Customer.created',
        op: 'c',
        store: 'document',
      })

      expect(event.type).toBe('Customer.created')
    })

    it('generates ULID for id', () => {
      const event = createCDCEvent({ op: 'c', store: 'document' })

      expect(event.id).toBeDefined()
      expect(event.id.length).toBe(26)
      // ULID is time-sortable, starts with timestamp
      expect(/^[0-9A-Z]{26}$/.test(event.id)).toBe(true)
    })

    it('generates ISO timestamp', () => {
      const event = createCDCEvent({ op: 'c', store: 'document' })

      expect(event.timestamp).toBeDefined()
      expect(() => new Date(event.timestamp)).not.toThrow()
      expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })

    it('adds default _meta with schemaVersion', () => {
      const event = createCDCEvent({ op: 'c', store: 'document' })

      expect(event._meta).toBeDefined()
      expect(event._meta?.schemaVersion).toBe(1)
    })
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('Edge Cases', () => {
  let mockPipeline: ReturnType<typeof createMockPipeline>
  let emitter: CDCEmitter

  beforeEach(() => {
    mockPipeline = createMockPipeline()
    emitter = new CDCEmitter(mockPipeline as any, {
      ns: 'startups.studio',
      source: 'DO/customers',
    })
  })

  it('handles large after payload', async () => {
    const largeObject: Record<string, string> = {}
    for (let i = 0; i < 1000; i++) {
      largeObject[`field_${i}`] = `value_${i}_${'x'.repeat(100)}`
    }

    await emitter.emit({
      op: 'c',
      store: 'document',
      table: 'LargeDoc',
      key: 'doc_1',
      after: largeObject,
    })

    expect(mockPipeline.send).toHaveBeenCalled()
    const sentEvents = mockPipeline.send.mock.calls[0][0]
    expect(Object.keys(sentEvents[0].after)).toHaveLength(1000)
  })

  it('handles special characters in string fields', async () => {
    await emitter.emit({
      op: 'c',
      store: 'document',
      table: 'Customer',
      key: 'cust_123',
      after: {
        name: "O'Brien",
        query: 'SELECT * FROM "users"',
        unicode: '\u2603 snowman',
        newlines: 'line1\nline2',
        backslash: 'path\\to\\file',
      },
    })

    const sentEvents = mockPipeline.send.mock.calls[0][0]
    expect(sentEvents[0].after.name).toBe("O'Brien")
    expect(sentEvents[0].after.unicode).toBe('\u2603 snowman')
  })

  it('handles nested objects in after', async () => {
    await emitter.emit({
      op: 'c',
      store: 'document',
      table: 'Customer',
      key: 'cust_123',
      after: {
        name: 'Alice',
        address: {
          street: '123 Main St',
          city: 'Springfield',
          country: {
            code: 'US',
            name: 'United States',
          },
        },
      },
    })

    const sentEvents = mockPipeline.send.mock.calls[0][0]
    expect(sentEvents[0].after.address.country.code).toBe('US')
  })

  it('handles arrays in after', async () => {
    await emitter.emit({
      op: 'c',
      store: 'document',
      table: 'Customer',
      key: 'cust_123',
      after: {
        name: 'Alice',
        tags: ['premium', 'verified', 'enterprise'],
        orders: [{ id: 1 }, { id: 2 }, { id: 3 }],
      },
    })

    const sentEvents = mockPipeline.send.mock.calls[0][0]
    expect(sentEvents[0].after.tags).toHaveLength(3)
    expect(sentEvents[0].after.orders).toHaveLength(3)
  })

  it('handles null values in after', async () => {
    await emitter.emit({
      op: 'c',
      store: 'document',
      table: 'Customer',
      key: 'cust_123',
      after: {
        name: 'Alice',
        middleName: null,
        deletedAt: null,
      },
    })

    const sentEvents = mockPipeline.send.mock.calls[0][0]
    expect(sentEvents[0].after.middleName).toBeNull()
    expect(sentEvents[0].after.deletedAt).toBeNull()
  })

  it('handles pipeline send failure gracefully', async () => {
    mockPipeline.send.mockRejectedValueOnce(new Error('Pipeline unavailable'))

    await expect(
      emitter.emit({
        op: 'c',
        store: 'document',
        table: 'Customer',
        key: 'cust_123',
        after: { name: 'Alice' },
      })
    ).rejects.toThrow('Pipeline unavailable')
  })

  it('handles very long table names', async () => {
    const longTableName = 'A'.repeat(256)

    await emitter.emit({
      op: 'c',
      store: 'document',
      table: longTableName,
      key: 'doc_1',
      after: { data: 'test' },
    })

    const sentEvents = mockPipeline.send.mock.calls[0][0]
    expect(sentEvents[0].table).toBe(longTableName)
  })

  it('handles concurrent emit calls', async () => {
    const promises = Array.from({ length: 10 }, (_, i) =>
      emitter.emit({
        op: 'c',
        store: 'document',
        table: 'Customer',
        key: `cust_${i}`,
        after: { index: i },
      })
    )

    await Promise.all(promises)

    expect(mockPipeline.send).toHaveBeenCalledTimes(10)
  })

  it('handles mixed event types in batch', async () => {
    await emitter.emitBatch([
      { op: 'c', store: 'document', table: 'Customer', key: 'cust_1', after: { name: 'Alice' } },
      { type: 'Customer.created', actor: 'User/nathan', data: { customerId: 'cust_1' } },
      { op: 'u', store: 'graph', table: 'Edge', key: 'edge_1', after: { from: 'A', to: 'B' } },
    ])

    const sentEvents = mockPipeline.send.mock.calls[0][0]
    expect(sentEvents[0].op).toBe('c')
    expect(sentEvents[1].type).toBe('Customer.created')
    expect(sentEvents[2].store).toBe('graph')
  })
})
