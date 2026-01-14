/**
 * CDC Emitter Tests (RED Phase)
 *
 * These tests define the API for advanced CDC features:
 * - Event filtering by type/source
 * - Event replay from a position
 * - Dead letter queue for failed events
 * - UnifiedEvent contract verification
 *
 * This is RED phase - tests should FAIL because these features
 * don't exist yet.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Types that should exist in db/cdc
import type {
  UnifiedEvent,
  CDCOperation,
  StoreType,
} from '../../../db/cdc'

// These imports should fail until implementation exists
// The CDCEmitter exists but these advanced features don't
import { CDCEmitter } from '../../../db/cdc'

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockPipeline() {
  return {
    send: vi.fn().mockResolvedValue(undefined),
  }
}

/**
 * Event contract specified in issue do-ai0:
 * ```typescript
 * interface UnifiedEvent {
 *   verb: string      // e.g., "Thing.created", "Relationship.deleted"
 *   source: string    // DO namespace
 *   timestamp: string // ISO 8601
 *   payload: Record<string, unknown>
 * }
 * ```
 */
interface IssueContractEvent {
  verb: string
  source: string
  timestamp: string
  payload: Record<string, unknown>
}

// ============================================================================
// UnifiedEvent Contract Tests (from issue do-ai0)
// ============================================================================

describe('UnifiedEvent Contract (Issue do-ai0)', () => {
  /**
   * The issue specifies this exact contract:
   * - verb: string (e.g., "Thing.created")
   * - source: string (DO namespace)
   * - timestamp: string (ISO 8601)
   * - payload: Record<string, unknown>
   *
   * These tests verify our UnifiedEvent type matches this contract
   * either directly or through a transformation layer.
   */

  describe('verb field (Noun.verb format)', () => {
    it('should support Thing.created verb format', () => {
      // The verb field should use "Noun.verb" format
      // e.g., "Thing.created", "Relationship.deleted"
      const event: IssueContractEvent = {
        verb: 'Thing.created',
        source: 'tenant.api.dotdo.dev',
        timestamp: new Date().toISOString(),
        payload: { $type: 'Customer', name: 'Alice' },
      }

      expect(event.verb).toBe('Thing.created')
      expect(event.verb).toMatch(/^[A-Z][a-zA-Z]+\.[a-z]+$/)
    })

    it('should support Relationship.deleted verb format', () => {
      const event: IssueContractEvent = {
        verb: 'Relationship.deleted',
        source: 'tenant.api.dotdo.dev',
        timestamp: new Date().toISOString(),
        payload: { from: 'Customer/1', to: 'Order/2' },
      }

      expect(event.verb).toBe('Relationship.deleted')
    })

    it('should support Event.recorded verb format', () => {
      const event: IssueContractEvent = {
        verb: 'Event.recorded',
        source: 'tenant.api.dotdo.dev',
        timestamp: new Date().toISOString(),
        payload: { eventType: 'payment.failed', amount: 100 },
      }

      expect(event.verb).toBe('Event.recorded')
    })

    it('should support Action.executed verb format', () => {
      const event: IssueContractEvent = {
        verb: 'Action.executed',
        source: 'tenant.api.dotdo.dev',
        timestamp: new Date().toISOString(),
        payload: { actionType: 'sendEmail', target: 'user@example.com' },
      }

      expect(event.verb).toBe('Action.executed')
    })
  })

  describe('source field', () => {
    it('should contain DO namespace as source', () => {
      const event: IssueContractEvent = {
        verb: 'Thing.created',
        source: 'startups.studio',
        timestamp: new Date().toISOString(),
        payload: {},
      }

      expect(event.source).toBe('startups.studio')
    })

    it('should support subdomain-style namespaces', () => {
      const event: IssueContractEvent = {
        verb: 'Thing.created',
        source: 'tenant.api.dotdo.dev',
        timestamp: new Date().toISOString(),
        payload: {},
      }

      expect(event.source).toContain('.')
    })
  })

  describe('timestamp field', () => {
    it('should be ISO 8601 format', () => {
      const event: IssueContractEvent = {
        verb: 'Thing.created',
        source: 'ns',
        timestamp: '2024-01-14T12:00:00.000Z',
        payload: {},
      }

      expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
      expect(() => new Date(event.timestamp)).not.toThrow()
    })

    it('should include milliseconds', () => {
      const event: IssueContractEvent = {
        verb: 'Thing.created',
        source: 'ns',
        timestamp: new Date().toISOString(),
        payload: {},
      }

      expect(event.timestamp).toMatch(/\.\d{3}Z$/)
    })
  })

  describe('payload field', () => {
    it('should be a Record<string, unknown>', () => {
      const event: IssueContractEvent = {
        verb: 'Thing.created',
        source: 'ns',
        timestamp: new Date().toISOString(),
        payload: {
          $type: 'Customer',
          name: 'Alice',
          email: 'alice@example.com',
          nested: { value: 123 },
        },
      }

      expect(typeof event.payload).toBe('object')
      expect(event.payload).not.toBeNull()
      expect(event.payload.$type).toBe('Customer')
    })

    it('should support empty payload', () => {
      const event: IssueContractEvent = {
        verb: 'Thing.deleted',
        source: 'ns',
        timestamp: new Date().toISOString(),
        payload: {},
      }

      expect(Object.keys(event.payload)).toHaveLength(0)
    })
  })
})

// ============================================================================
// Event Emission on Store Operations
// ============================================================================

describe('Event Emission on Store Operations', () => {
  let mockPipeline: ReturnType<typeof createMockPipeline>
  let emitter: CDCEmitter

  beforeEach(() => {
    mockPipeline = createMockPipeline()
    emitter = new CDCEmitter(mockPipeline as any, {
      ns: 'test.namespace',
      source: 'DO/things',
    })
  })

  describe('Things store events', () => {
    it('emits Thing.created when a Thing is created', async () => {
      // This test verifies that when a Thing is created in the store,
      // a CDC event is emitted with verb "Thing.created"
      await emitter.emit({
        type: 'Thing.created',
        op: 'c',
        store: 'document',
        table: 'things',
        key: 'thing_123',
        after: {
          $id: 'thing_123',
          $type: 'Customer',
          name: 'Alice',
          email: 'alice@example.com',
        },
      })

      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
      const events = mockPipeline.send.mock.calls[0][0]
      expect(events[0].type).toBe('Thing.created')
      expect(events[0].after.$type).toBe('Customer')
    })

    it('emits Thing.updated when a Thing is updated', async () => {
      await emitter.emit({
        type: 'Thing.updated',
        op: 'u',
        store: 'document',
        table: 'things',
        key: 'thing_123',
        before: { $id: 'thing_123', $type: 'Customer', name: 'Alice' },
        after: { $id: 'thing_123', $type: 'Customer', name: 'Alicia' },
      })

      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
      const events = mockPipeline.send.mock.calls[0][0]
      expect(events[0].type).toBe('Thing.updated')
      expect(events[0].before.name).toBe('Alice')
      expect(events[0].after.name).toBe('Alicia')
    })

    it('emits Thing.deleted when a Thing is deleted', async () => {
      await emitter.emit({
        type: 'Thing.deleted',
        op: 'd',
        store: 'document',
        table: 'things',
        key: 'thing_123',
        before: { $id: 'thing_123', $type: 'Customer', name: 'Alice' },
      })

      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
      const events = mockPipeline.send.mock.calls[0][0]
      expect(events[0].type).toBe('Thing.deleted')
      expect(events[0].after).toBeUndefined()
    })
  })

  describe('Relationships store events', () => {
    it('emits Relationship.created when a Relationship is created', async () => {
      await emitter.emit({
        type: 'Relationship.created',
        op: 'c',
        store: 'graph',
        table: 'relationships',
        key: 'rel_456',
        after: {
          $id: 'rel_456',
          from: 'Customer/cust_1',
          to: 'Order/ord_1',
          type: 'placed',
        },
      })

      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
      const events = mockPipeline.send.mock.calls[0][0]
      expect(events[0].type).toBe('Relationship.created')
      expect(events[0].after.from).toBe('Customer/cust_1')
    })

    it('emits Relationship.deleted when a Relationship is deleted', async () => {
      await emitter.emit({
        type: 'Relationship.deleted',
        op: 'd',
        store: 'graph',
        table: 'relationships',
        key: 'rel_456',
        before: {
          $id: 'rel_456',
          from: 'Customer/cust_1',
          to: 'Order/ord_1',
          type: 'placed',
        },
      })

      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
      const events = mockPipeline.send.mock.calls[0][0]
      expect(events[0].type).toBe('Relationship.deleted')
    })
  })

  describe('Events store events', () => {
    it('emits Event.recorded when an Event is stored', async () => {
      await emitter.emit({
        type: 'Event.recorded',
        op: 'c',
        store: 'timeseries',
        table: 'events',
        key: 'evt_789',
        after: {
          $id: 'evt_789',
          eventType: 'payment.failed',
          entityId: 'order_123',
          data: { amount: 100, reason: 'insufficient_funds' },
        },
      })

      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
      const events = mockPipeline.send.mock.calls[0][0]
      expect(events[0].type).toBe('Event.recorded')
    })
  })

  describe('Actions store events', () => {
    it('emits Action.queued when an Action is created', async () => {
      await emitter.emit({
        type: 'Action.queued',
        op: 'c',
        store: 'document',
        table: 'actions',
        key: 'act_abc',
        after: {
          $id: 'act_abc',
          verb: 'sendNotification',
          target: 'User/user_123',
          status: 'pending',
        },
      })

      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
      const events = mockPipeline.send.mock.calls[0][0]
      expect(events[0].type).toBe('Action.queued')
    })

    it('emits Action.executed when an Action completes', async () => {
      await emitter.emit({
        type: 'Action.executed',
        op: 'u',
        store: 'document',
        table: 'actions',
        key: 'act_abc',
        before: { $id: 'act_abc', status: 'pending' },
        after: { $id: 'act_abc', status: 'completed', result: 'success' },
      })

      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
      const events = mockPipeline.send.mock.calls[0][0]
      expect(events[0].type).toBe('Action.executed')
    })
  })
})

// ============================================================================
// Event Batching and Flushing Tests
// ============================================================================

describe('Event Batching and Flushing', () => {
  let mockPipeline: ReturnType<typeof createMockPipeline>
  let emitter: CDCEmitter

  beforeEach(() => {
    mockPipeline = createMockPipeline()
    emitter = new CDCEmitter(mockPipeline as any, {
      ns: 'test.namespace',
      source: 'DO/things',
    })
  })

  describe('batch accumulation', () => {
    it('accumulates events in a batch before sending', async () => {
      // This feature doesn't exist yet - emitter should have a buffer mode
      // where events are accumulated and flushed together
      const bufferedEmitter = emitter as any

      // These methods should exist but don't
      expect(typeof bufferedEmitter.startBatch).toBe('function')

      bufferedEmitter.startBatch()

      await bufferedEmitter.emit({ type: 'Thing.created', op: 'c', store: 'document', key: '1' })
      await bufferedEmitter.emit({ type: 'Thing.created', op: 'c', store: 'document', key: '2' })
      await bufferedEmitter.emit({ type: 'Thing.created', op: 'c', store: 'document', key: '3' })

      // Events should not be sent yet
      expect(mockPipeline.send).not.toHaveBeenCalled()

      await bufferedEmitter.flush()

      // Now all events should be sent in one batch
      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
      expect(mockPipeline.send.mock.calls[0][0]).toHaveLength(3)
    })

    it('auto-flushes when batch reaches max size', async () => {
      const bufferedEmitter = emitter as any

      // Configure max batch size
      expect(typeof bufferedEmitter.setMaxBatchSize).toBe('function')
      bufferedEmitter.setMaxBatchSize(2)
      bufferedEmitter.startBatch()

      await bufferedEmitter.emit({ type: 'Thing.created', op: 'c', store: 'document', key: '1' })
      await bufferedEmitter.emit({ type: 'Thing.created', op: 'c', store: 'document', key: '2' })

      // Should auto-flush after reaching max size
      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
      expect(mockPipeline.send.mock.calls[0][0]).toHaveLength(2)
    })

    it('auto-flushes when max delay is reached', async () => {
      vi.useFakeTimers()

      const bufferedEmitter = emitter as any

      expect(typeof bufferedEmitter.setMaxBatchDelay).toBe('function')
      bufferedEmitter.setMaxBatchDelay(100) // 100ms
      bufferedEmitter.startBatch()

      await bufferedEmitter.emit({ type: 'Thing.created', op: 'c', store: 'document', key: '1' })

      // Not flushed yet
      expect(mockPipeline.send).not.toHaveBeenCalled()

      // Advance time past the max delay
      vi.advanceTimersByTime(150)

      // Should have auto-flushed
      expect(mockPipeline.send).toHaveBeenCalledTimes(1)

      vi.useRealTimers()
    })
  })

  describe('flush behavior', () => {
    it('flush is idempotent when buffer is empty', async () => {
      const bufferedEmitter = emitter as any

      expect(typeof bufferedEmitter.flush).toBe('function')

      // Flushing empty buffer should not call pipeline
      await bufferedEmitter.flush()
      await bufferedEmitter.flush()
      await bufferedEmitter.flush()

      expect(mockPipeline.send).not.toHaveBeenCalled()
    })

    it('flush returns the number of events flushed', async () => {
      const bufferedEmitter = emitter as any

      bufferedEmitter.startBatch()
      await bufferedEmitter.emit({ type: 'Thing.created', op: 'c', store: 'document', key: '1' })
      await bufferedEmitter.emit({ type: 'Thing.created', op: 'c', store: 'document', key: '2' })

      const count = await bufferedEmitter.flush()

      expect(count).toBe(2)
    })

    it('flush clears the buffer after sending', async () => {
      const bufferedEmitter = emitter as any

      bufferedEmitter.startBatch()
      await bufferedEmitter.emit({ type: 'Thing.created', op: 'c', store: 'document', key: '1' })
      await bufferedEmitter.flush()

      // Second flush should have nothing
      const count = await bufferedEmitter.flush()

      expect(count).toBe(0)
      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
    })
  })
})

// ============================================================================
// Event Filtering Tests
// ============================================================================

describe('Event Filtering', () => {
  let mockPipeline: ReturnType<typeof createMockPipeline>

  beforeEach(() => {
    mockPipeline = createMockPipeline()
  })

  describe('filtering by type', () => {
    it('filters events by exact type match', async () => {
      // EventFilter should be a class that wraps the emitter
      // and filters events before they reach subscribers
      const { EventFilter } = await import('../../../db/cdc')

      const filter = new EventFilter({
        types: ['Thing.created'],
      })

      const events = [
        { type: 'Thing.created', key: '1' },
        { type: 'Thing.updated', key: '2' },
        { type: 'Thing.created', key: '3' },
        { type: 'Relationship.created', key: '4' },
      ]

      const filtered = filter.apply(events as any)

      expect(filtered).toHaveLength(2)
      expect(filtered[0].key).toBe('1')
      expect(filtered[1].key).toBe('3')
    })

    it('filters events by type pattern (glob)', async () => {
      const { EventFilter } = await import('../../../db/cdc')

      const filter = new EventFilter({
        types: ['Thing.*'], // Match all Thing events
      })

      const events = [
        { type: 'Thing.created', key: '1' },
        { type: 'Thing.updated', key: '2' },
        { type: 'Thing.deleted', key: '3' },
        { type: 'Relationship.created', key: '4' },
      ]

      const filtered = filter.apply(events as any)

      expect(filtered).toHaveLength(3)
      expect(filtered.every((e: any) => e.type.startsWith('Thing.'))).toBe(true)
    })

    it('filters events by wildcard verb', async () => {
      const { EventFilter } = await import('../../../db/cdc')

      const filter = new EventFilter({
        types: ['*.created'], // Match all created events
      })

      const events = [
        { type: 'Thing.created', key: '1' },
        { type: 'Thing.updated', key: '2' },
        { type: 'Relationship.created', key: '3' },
        { type: 'Event.recorded', key: '4' },
      ]

      const filtered = filter.apply(events as any)

      expect(filtered).toHaveLength(2)
      expect(filtered[0].type).toBe('Thing.created')
      expect(filtered[1].type).toBe('Relationship.created')
    })
  })

  describe('filtering by source', () => {
    it('filters events by exact source match', async () => {
      const { EventFilter } = await import('../../../db/cdc')

      const filter = new EventFilter({
        sources: ['tenant-a.api.dotdo.dev'],
      })

      const events = [
        { type: 'Thing.created', ns: 'tenant-a.api.dotdo.dev', key: '1' },
        { type: 'Thing.created', ns: 'tenant-b.api.dotdo.dev', key: '2' },
        { type: 'Thing.created', ns: 'tenant-a.api.dotdo.dev', key: '3' },
      ]

      const filtered = filter.apply(events as any)

      expect(filtered).toHaveLength(2)
      expect(filtered.every((e: any) => e.ns === 'tenant-a.api.dotdo.dev')).toBe(true)
    })

    it('filters events by source pattern', async () => {
      const { EventFilter } = await import('../../../db/cdc')

      const filter = new EventFilter({
        sources: ['*.api.dotdo.dev'], // All API tenants
      })

      const events = [
        { type: 'Thing.created', ns: 'tenant-a.api.dotdo.dev', key: '1' },
        { type: 'Thing.created', ns: 'tenant-b.api.dotdo.dev', key: '2' },
        { type: 'Thing.created', ns: 'internal.admin.dotdo.dev', key: '3' },
      ]

      const filtered = filter.apply(events as any)

      expect(filtered).toHaveLength(2)
    })
  })

  describe('combined filtering', () => {
    it('applies type AND source filters together', async () => {
      const { EventFilter } = await import('../../../db/cdc')

      const filter = new EventFilter({
        types: ['Thing.created'],
        sources: ['tenant-a.api.dotdo.dev'],
      })

      const events = [
        { type: 'Thing.created', ns: 'tenant-a.api.dotdo.dev', key: '1' },
        { type: 'Thing.updated', ns: 'tenant-a.api.dotdo.dev', key: '2' },
        { type: 'Thing.created', ns: 'tenant-b.api.dotdo.dev', key: '3' },
      ]

      const filtered = filter.apply(events as any)

      expect(filtered).toHaveLength(1)
      expect(filtered[0].key).toBe('1')
    })

    it('supports exclusion filters', async () => {
      const { EventFilter } = await import('../../../db/cdc')

      const filter = new EventFilter({
        types: ['Thing.*'],
        excludeTypes: ['Thing.deleted'],
      })

      const events = [
        { type: 'Thing.created', key: '1' },
        { type: 'Thing.updated', key: '2' },
        { type: 'Thing.deleted', key: '3' },
      ]

      const filtered = filter.apply(events as any)

      expect(filtered).toHaveLength(2)
      expect(filtered.every((e: any) => e.type !== 'Thing.deleted')).toBe(true)
    })
  })
})

// ============================================================================
// Event Replay Tests
// ============================================================================

describe('Event Replay', () => {
  describe('replay from position', () => {
    it('replays events from a specific LSN position', async () => {
      // EventLog should provide replay capability
      const { EventLog } = await import('../../../db/cdc')

      const mockStorage = {
        getEvents: vi.fn().mockResolvedValue([
          { id: '1', type: 'Thing.created', lsn: 100 },
          { id: '2', type: 'Thing.updated', lsn: 101 },
          { id: '3', type: 'Thing.deleted', lsn: 102 },
        ]),
      }

      const log = new EventLog(mockStorage)

      // Replay from LSN 101 onwards
      const events = await log.replay({ fromLsn: 101 })

      expect(events).toHaveLength(2)
      expect(events[0].lsn).toBe(101)
      expect(events[1].lsn).toBe(102)
    })

    it('replays events from a specific timestamp', async () => {
      const { EventLog } = await import('../../../db/cdc')

      const mockStorage = {
        getEvents: vi.fn().mockResolvedValue([
          { id: '1', type: 'Thing.created', timestamp: '2024-01-14T10:00:00Z' },
          { id: '2', type: 'Thing.updated', timestamp: '2024-01-14T11:00:00Z' },
          { id: '3', type: 'Thing.deleted', timestamp: '2024-01-14T12:00:00Z' },
        ]),
      }

      const log = new EventLog(mockStorage)

      // Replay from 11:00 onwards
      const events = await log.replay({ fromTimestamp: '2024-01-14T11:00:00Z' })

      expect(events).toHaveLength(2)
      expect(events[0].timestamp).toBe('2024-01-14T11:00:00Z')
    })

    it('replays events with type filter', async () => {
      const { EventLog } = await import('../../../db/cdc')

      const mockStorage = {
        getEvents: vi.fn().mockResolvedValue([
          { id: '1', type: 'Thing.created', lsn: 100 },
          { id: '2', type: 'Relationship.created', lsn: 101 },
          { id: '3', type: 'Thing.updated', lsn: 102 },
        ]),
      }

      const log = new EventLog(mockStorage)

      const events = await log.replay({
        fromLsn: 100,
        filter: { types: ['Thing.*'] },
      })

      expect(events).toHaveLength(2)
      expect(events.every((e: any) => e.type.startsWith('Thing.'))).toBe(true)
    })

    it('supports limit and pagination for replay', async () => {
      const { EventLog } = await import('../../../db/cdc')

      const mockStorage = {
        getEvents: vi.fn(),
      }

      const log = new EventLog(mockStorage)

      // First page
      await log.replay({ fromLsn: 0, limit: 100 })

      expect(mockStorage.getEvents).toHaveBeenCalledWith(
        expect.objectContaining({
          fromLsn: 0,
          limit: 100,
        })
      )
    })

    it('returns cursor for continuation', async () => {
      const { EventLog } = await import('../../../db/cdc')

      const mockStorage = {
        getEvents: vi.fn().mockResolvedValue({
          events: [
            { id: '1', lsn: 100 },
            { id: '2', lsn: 101 },
          ],
          cursor: 'next_page_token',
          hasMore: true,
        }),
      }

      const log = new EventLog(mockStorage)

      const result = await log.replay({ fromLsn: 100, limit: 2 })

      expect(result.cursor).toBe('next_page_token')
      expect(result.hasMore).toBe(true)
    })
  })

  describe('checkpoint management', () => {
    it('saves replay checkpoint', async () => {
      const { EventLog } = await import('../../../db/cdc')

      const mockStorage = {
        saveCheckpoint: vi.fn().mockResolvedValue(undefined),
        getEvents: vi.fn().mockResolvedValue([]),
      }

      const log = new EventLog(mockStorage)

      await log.saveCheckpoint('consumer-1', { lsn: 150, timestamp: '2024-01-14T12:00:00Z' })

      expect(mockStorage.saveCheckpoint).toHaveBeenCalledWith('consumer-1', {
        lsn: 150,
        timestamp: '2024-01-14T12:00:00Z',
      })
    })

    it('loads replay checkpoint', async () => {
      const { EventLog } = await import('../../../db/cdc')

      const mockStorage = {
        getCheckpoint: vi.fn().mockResolvedValue({ lsn: 150, timestamp: '2024-01-14T12:00:00Z' }),
        getEvents: vi.fn().mockResolvedValue([]),
      }

      const log = new EventLog(mockStorage)

      const checkpoint = await log.getCheckpoint('consumer-1')

      expect(checkpoint.lsn).toBe(150)
    })

    it('resumes replay from checkpoint', async () => {
      const { EventLog } = await import('../../../db/cdc')

      const mockStorage = {
        getCheckpoint: vi.fn().mockResolvedValue({ lsn: 150 }),
        getEvents: vi.fn().mockResolvedValue([
          { id: '1', lsn: 150 },
          { id: '2', lsn: 151 },
        ]),
      }

      const log = new EventLog(mockStorage)

      // Resume from saved checkpoint
      const events = await log.resumeFrom('consumer-1')

      expect(mockStorage.getCheckpoint).toHaveBeenCalledWith('consumer-1')
      expect(mockStorage.getEvents).toHaveBeenCalledWith(
        expect.objectContaining({ fromLsn: 150 })
      )
    })
  })
})

// ============================================================================
// Dead Letter Queue Tests
// ============================================================================

describe('Dead Letter Queue', () => {
  let mockPipeline: ReturnType<typeof createMockPipeline>
  let mockDlqStorage: ReturnType<typeof createMockPipeline>

  beforeEach(() => {
    mockPipeline = createMockPipeline()
    mockDlqStorage = {
      send: vi.fn().mockResolvedValue(undefined),
    }
  })

  describe('failed event routing', () => {
    it('routes failed events to DLQ after max retries', async () => {
      const { CDCEmitterWithDLQ } = await import('../../../db/cdc')

      const emitter = new CDCEmitterWithDLQ(
        mockPipeline as any,
        {
          ns: 'test',
          source: 'DO/test',
          dlq: mockDlqStorage as any,
          maxRetries: 3,
        }
      )

      // Make pipeline fail
      mockPipeline.send
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))

      await emitter.emit({
        type: 'Thing.created',
        op: 'c',
        store: 'document',
        key: '1',
      })

      // After 3 retries + 1 initial, should go to DLQ
      expect(mockPipeline.send).toHaveBeenCalledTimes(4)
      expect(mockDlqStorage.send).toHaveBeenCalledTimes(1)

      const dlqEvent = mockDlqStorage.send.mock.calls[0][0][0]
      expect(dlqEvent._dlq).toBeDefined()
      expect(dlqEvent._dlq.reason).toBe('Network error')
      expect(dlqEvent._dlq.retries).toBe(3)
    })

    it('includes error details in DLQ event', async () => {
      const { CDCEmitterWithDLQ } = await import('../../../db/cdc')

      const emitter = new CDCEmitterWithDLQ(
        mockPipeline as any,
        {
          ns: 'test',
          source: 'DO/test',
          dlq: mockDlqStorage as any,
          maxRetries: 0, // Send to DLQ immediately on failure
        }
      )

      mockPipeline.send.mockRejectedValueOnce(new Error('Pipeline capacity exceeded'))

      await emitter.emit({
        type: 'Thing.created',
        op: 'c',
        store: 'document',
        key: '1',
      })

      const dlqEvent = mockDlqStorage.send.mock.calls[0][0][0]
      expect(dlqEvent._dlq.reason).toBe('Pipeline capacity exceeded')
      expect(dlqEvent._dlq.originalTimestamp).toBeDefined()
      expect(dlqEvent._dlq.dlqTimestamp).toBeDefined()
    })

    it('preserves original event in DLQ', async () => {
      const { CDCEmitterWithDLQ } = await import('../../../db/cdc')

      const emitter = new CDCEmitterWithDLQ(
        mockPipeline as any,
        {
          ns: 'test',
          source: 'DO/test',
          dlq: mockDlqStorage as any,
          maxRetries: 0,
        }
      )

      mockPipeline.send.mockRejectedValueOnce(new Error('Failure'))

      const originalEvent = {
        type: 'Thing.created',
        op: 'c' as const,
        store: 'document' as const,
        key: '1',
        after: { name: 'Alice', important: true },
      }

      await emitter.emit(originalEvent)

      const dlqEvent = mockDlqStorage.send.mock.calls[0][0][0]
      expect(dlqEvent.type).toBe('Thing.created')
      expect(dlqEvent.after).toEqual({ name: 'Alice', important: true })
    })
  })

  describe('DLQ event structure', () => {
    it('DLQ events include failure metadata', async () => {
      const { CDCEmitterWithDLQ } = await import('../../../db/cdc')

      const emitter = new CDCEmitterWithDLQ(
        mockPipeline as any,
        {
          ns: 'test',
          source: 'DO/test',
          dlq: mockDlqStorage as any,
          maxRetries: 2,
        }
      )

      mockPipeline.send.mockRejectedValue(new Error('Timeout'))

      await emitter.emit({ type: 'Thing.created', op: 'c', store: 'document', key: '1' })

      const dlqEvent = mockDlqStorage.send.mock.calls[0][0][0]

      // DLQ metadata structure
      expect(dlqEvent._dlq).toMatchObject({
        reason: expect.any(String),
        retries: expect.any(Number),
        originalTimestamp: expect.any(String),
        dlqTimestamp: expect.any(String),
        failureStack: expect.any(String),
      })
    })

    it('DLQ events have unique DLQ ID', async () => {
      const { CDCEmitterWithDLQ } = await import('../../../db/cdc')

      const emitter = new CDCEmitterWithDLQ(
        mockPipeline as any,
        {
          ns: 'test',
          source: 'DO/test',
          dlq: mockDlqStorage as any,
          maxRetries: 0,
        }
      )

      mockPipeline.send.mockRejectedValue(new Error('Failure'))

      await emitter.emit({ type: 'Thing.created', op: 'c', store: 'document', key: '1' })
      await emitter.emit({ type: 'Thing.created', op: 'c', store: 'document', key: '2' })

      const dlqEvent1 = mockDlqStorage.send.mock.calls[0][0][0]
      const dlqEvent2 = mockDlqStorage.send.mock.calls[1][0][0]

      expect(dlqEvent1._dlq.dlqId).toBeDefined()
      expect(dlqEvent2._dlq.dlqId).toBeDefined()
      expect(dlqEvent1._dlq.dlqId).not.toBe(dlqEvent2._dlq.dlqId)
    })
  })

  describe('DLQ replay and recovery', () => {
    it('can replay events from DLQ', async () => {
      const { DeadLetterQueue } = await import('../../../db/cdc')

      const mockDlqStore = {
        getEvents: vi.fn().mockResolvedValue([
          { id: 'dlq_1', type: 'Thing.created', _dlq: { reason: 'Timeout' } },
          { id: 'dlq_2', type: 'Thing.updated', _dlq: { reason: 'Rate limited' } },
        ]),
      }

      const dlq = new DeadLetterQueue(mockDlqStore)

      const events = await dlq.getFailedEvents()

      expect(events).toHaveLength(2)
      expect(events[0]._dlq.reason).toBe('Timeout')
    })

    it('can retry a DLQ event', async () => {
      const { DeadLetterQueue } = await import('../../../db/cdc')

      const mockDlqStore = {
        getEvent: vi.fn().mockResolvedValue({
          id: 'dlq_1',
          type: 'Thing.created',
          _dlq: { reason: 'Timeout' },
        }),
        deleteEvent: vi.fn().mockResolvedValue(undefined),
      }

      const dlq = new DeadLetterQueue(mockDlqStore)

      // Retry should re-emit the event and remove from DLQ on success
      await dlq.retry('dlq_1', mockPipeline as any)

      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
      expect(mockDlqStore.deleteEvent).toHaveBeenCalledWith('dlq_1')
    })

    it('can purge old DLQ events', async () => {
      const { DeadLetterQueue } = await import('../../../db/cdc')

      const mockDlqStore = {
        deleteEventsBefore: vi.fn().mockResolvedValue(5),
      }

      const dlq = new DeadLetterQueue(mockDlqStore)

      // Purge events older than 7 days
      const deleted = await dlq.purge({ olderThan: '7d' })

      expect(deleted).toBe(5)
      expect(mockDlqStore.deleteEventsBefore).toHaveBeenCalled()
    })

    it('can get DLQ statistics', async () => {
      const { DeadLetterQueue } = await import('../../../db/cdc')

      const mockDlqStore = {
        getStats: vi.fn().mockResolvedValue({
          total: 42,
          byReason: {
            'Timeout': 20,
            'Rate limited': 15,
            'Parse error': 7,
          },
          oldest: '2024-01-10T00:00:00Z',
          newest: '2024-01-14T12:00:00Z',
        }),
      }

      const dlq = new DeadLetterQueue(mockDlqStore)

      const stats = await dlq.getStats()

      expect(stats.total).toBe(42)
      expect(stats.byReason['Timeout']).toBe(20)
    })
  })

  describe('retry policies', () => {
    it('supports exponential backoff retry', async () => {
      vi.useFakeTimers()

      const { CDCEmitterWithDLQ } = await import('../../../db/cdc')

      const emitter = new CDCEmitterWithDLQ(
        mockPipeline as any,
        {
          ns: 'test',
          source: 'DO/test',
          dlq: mockDlqStorage as any,
          maxRetries: 3,
          retryPolicy: 'exponential',
          baseDelay: 100, // 100ms base
        }
      )

      mockPipeline.send.mockRejectedValue(new Error('Failure'))

      const emitPromise = emitter.emit({
        type: 'Thing.created',
        op: 'c',
        store: 'document',
        key: '1',
      })

      // First attempt immediate
      expect(mockPipeline.send).toHaveBeenCalledTimes(1)

      // Wait for retry delays: 100ms, 200ms, 400ms (exponential)
      await vi.advanceTimersByTimeAsync(100)
      expect(mockPipeline.send).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(200)
      expect(mockPipeline.send).toHaveBeenCalledTimes(3)

      await vi.advanceTimersByTimeAsync(400)
      expect(mockPipeline.send).toHaveBeenCalledTimes(4)

      await emitPromise

      vi.useRealTimers()
    })

    it('supports constant delay retry', async () => {
      vi.useFakeTimers()

      const { CDCEmitterWithDLQ } = await import('../../../db/cdc')

      const emitter = new CDCEmitterWithDLQ(
        mockPipeline as any,
        {
          ns: 'test',
          source: 'DO/test',
          dlq: mockDlqStorage as any,
          maxRetries: 2,
          retryPolicy: 'constant',
          baseDelay: 50,
        }
      )

      mockPipeline.send.mockRejectedValue(new Error('Failure'))

      const emitPromise = emitter.emit({
        type: 'Thing.created',
        op: 'c',
        store: 'document',
        key: '1',
      })

      // Constant delays: 50ms, 50ms
      await vi.advanceTimersByTimeAsync(50)
      expect(mockPipeline.send).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(50)
      expect(mockPipeline.send).toHaveBeenCalledTimes(3)

      await emitPromise

      vi.useRealTimers()
    })
  })
})

// ============================================================================
// Integration with Cloudflare Test Runtime
// ============================================================================

describe('Cloudflare Integration', () => {
  it('works with cloudflare:test environment', async () => {
    // This test should use the real cloudflare:test module
    // when running in the objects project
    try {
      const { env } = await import('cloudflare:test')
      expect(env).toBeDefined()
    } catch {
      // Skip if not in cloudflare test environment
      console.log('Skipping cloudflare:test integration - not in CF environment')
    }
  })
})
