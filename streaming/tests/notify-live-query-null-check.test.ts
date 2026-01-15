/**
 * Tests for notifyLiveQuerySubscribers null check handling
 *
 * TDD RED PHASE: These tests verify that notifyLiveQuerySubscribers handles
 * null, undefined, and malformed inputs gracefully without crashing.
 *
 * The method is private, so we test through the public API (broadcast methods).
 * Since liveQueries is internal state, we need to subscribe first, then test
 * malformed events that could trigger null reference errors.
 *
 * @see streaming/event-stream-do.ts notifyLiveQuerySubscribers
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Install WebSocket mock for test environment
import { installWebSocketMock } from './utils/websocket-mock'
installWebSocketMock()

import { EventStreamDO, type BroadcastEvent, type LiveQuerySubscription } from '../event-stream-do'

// ============================================================================
// MOCK DURABLE OBJECT STATE
// ============================================================================

const createMockState = () => {
  const storage = new Map<string, unknown>()
  const alarms: number[] = []

  return {
    storage: {
      get: vi.fn(async (key: string) => storage.get(key)),
      put: vi.fn(async (key: string, value: unknown) => {
        storage.set(key, value)
      }),
      delete: vi.fn(async (key: string) => storage.delete(key)),
      deleteAll: vi.fn(async () => storage.clear()),
      list: vi.fn(async () => storage),
    },
    waitUntil: vi.fn(),
    setAlarm: vi.fn((timestamp: number) => alarms.push(timestamp)),
    getAlarm: vi.fn(async () => alarms[0]),
    deleteAlarm: vi.fn(async () => {
      alarms.length = 0
    }),
    getWebSockets: vi.fn(() => []),
    acceptWebSocket: vi.fn(),
    _storage: storage,
    _alarms: alarms,
  }
}

type MockState = ReturnType<typeof createMockState>

// ============================================================================
// notifyLiveQuerySubscribers NULL CHECK TESTS
// ============================================================================

describe('notifyLiveQuerySubscribers null check handling', () => {
  let mockState: MockState
  let eventStream: EventStreamDO

  beforeEach(() => {
    vi.useFakeTimers()
    mockState = createMockState()
    eventStream = new EventStreamDO(mockState as any)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('handles null subscribers gracefully', () => {
    it('should not crash when liveQueries map contains null entry value', async () => {
      // Subscribe to a live query first to populate liveQueries
      // Signature: subscribeToQuery(sql, callback, params?)
      const callback = vi.fn()
      const subscription = await eventStream.subscribeToQuery(
        'SELECT * FROM events WHERE topic = $1',
        callback,
        ['orders']
      )

      // Manually corrupt the internal liveQueries map by setting a null value
      // This simulates a bug where a null entry could be inserted
      const liveQueriesMap = (eventStream as any).liveQueries as Map<string, any>
      liveQueriesMap.set('corrupted-entry', null)

      // Attempt to broadcast - should not crash
      const event: BroadcastEvent = {
        id: 'evt-1',
        type: 'test',
        topic: 'orders',
        payload: { data: 'test' },
        timestamp: Date.now(),
      }

      // This should handle null gracefully without throwing
      await expect(eventStream.broadcastToTopic('orders', event)).resolves.not.toThrow()

      // Clean up
      await subscription.unsubscribe()
    })

    it('should not crash when liveQueries map contains undefined entry value', async () => {
      // Subscribe to a live query
      const callback = vi.fn()
      const subscription = await eventStream.subscribeToQuery(
        'SELECT * FROM events',
        callback
      )

      // Corrupt with undefined
      const liveQueriesMap = (eventStream as any).liveQueries as Map<string, any>
      liveQueriesMap.set('undefined-entry', undefined)

      const event: BroadcastEvent = {
        id: 'evt-2',
        type: 'test',
        topic: 'test-topic',
        payload: {},
        timestamp: Date.now(),
      }

      await expect(eventStream.broadcastToTopic('test-topic', event)).resolves.not.toThrow()

      await subscription.unsubscribe()
    })
  })

  describe('handles null/undefined event properties gracefully', () => {
    it('should handle event with null topic', async () => {
      const callback = vi.fn()
      const subscription = await eventStream.subscribeToQuery(
        'SELECT * FROM events',
        callback
      )

      // Event with null topic
      const event = {
        id: 'evt-3',
        type: 'test',
        topic: null as any, // Intentionally null
        payload: {},
        timestamp: Date.now(),
      } as BroadcastEvent

      await expect(eventStream.broadcast(event)).resolves.not.toThrow()

      await subscription.unsubscribe()
    })

    it('should handle event with undefined topic', async () => {
      const callback = vi.fn()
      const subscription = await eventStream.subscribeToQuery(
        'SELECT * FROM events',
        callback
      )

      const event = {
        id: 'evt-4',
        type: 'test',
        topic: undefined as any, // Intentionally undefined
        payload: {},
        timestamp: Date.now(),
      } as BroadcastEvent

      await expect(eventStream.broadcast(event)).resolves.not.toThrow()

      await subscription.unsubscribe()
    })

    it('should handle event with null type', async () => {
      const callback = vi.fn()
      const subscription = await eventStream.subscribeToQuery(
        'SELECT * FROM events WHERE topic = $1',
        callback,
        ['orders']
      )

      const event = {
        id: 'evt-5',
        type: null as any, // Intentionally null
        topic: 'orders',
        payload: {},
        timestamp: Date.now(),
      } as BroadcastEvent

      await expect(eventStream.broadcastToTopic('orders', event)).resolves.not.toThrow()

      await subscription.unsubscribe()
    })

    it('should handle event with undefined type', async () => {
      const callback = vi.fn()
      const subscription = await eventStream.subscribeToQuery(
        'SELECT * FROM events',
        callback
      )

      const event = {
        id: 'evt-6',
        type: undefined as any, // Intentionally undefined
        topic: 'test',
        payload: {},
        timestamp: Date.now(),
      } as BroadcastEvent

      await expect(eventStream.broadcast(event)).resolves.not.toThrow()

      await subscription.unsubscribe()
    })
  })

  describe('handles empty array of subscribers', () => {
    it('should handle broadcast when no live query subscribers exist', async () => {
      // No subscriptions - liveQueries should be empty
      const event: BroadcastEvent = {
        id: 'evt-7',
        type: 'test',
        topic: 'empty-topic',
        payload: { data: 'test' },
        timestamp: Date.now(),
      }

      // Should not crash with empty liveQueries
      await expect(eventStream.broadcastToTopic('empty-topic', event)).resolves.not.toThrow()
    })

    it('should handle broadcast after all subscribers have unsubscribed', async () => {
      const callback = vi.fn()
      const subscription = await eventStream.subscribeToQuery(
        'SELECT * FROM events',
        callback
      )

      // Unsubscribe before broadcasting
      await subscription.unsubscribe()

      const event: BroadcastEvent = {
        id: 'evt-8',
        type: 'test',
        topic: 'test',
        payload: {},
        timestamp: Date.now(),
      }

      // Should not crash after unsubscribe
      await expect(eventStream.broadcast(event)).resolves.not.toThrow()
    })
  })

  describe('handles invalid subscriber objects', () => {
    it('should handle subscriber with null sql property', async () => {
      const callback = vi.fn()
      await eventStream.subscribeToQuery('SELECT * FROM events', callback)

      // Corrupt the entry with null sql
      const liveQueriesMap = (eventStream as any).liveQueries as Map<string, any>
      liveQueriesMap.set('bad-sql-entry', {
        sql: null,
        params: [],
        callback: callback,
      })

      const event: BroadcastEvent = {
        id: 'evt-9',
        type: 'test',
        topic: 'test',
        payload: {},
        timestamp: Date.now(),
      }

      await expect(eventStream.broadcast(event)).resolves.not.toThrow()
    })

    it('should handle subscriber with undefined sql property', async () => {
      const callback = vi.fn()
      await eventStream.subscribeToQuery('SELECT * FROM events', callback)

      const liveQueriesMap = (eventStream as any).liveQueries as Map<string, any>
      liveQueriesMap.set('undefined-sql-entry', {
        sql: undefined,
        params: [],
        callback: callback,
      })

      const event: BroadcastEvent = {
        id: 'evt-10',
        type: 'test',
        topic: 'test',
        payload: {},
        timestamp: Date.now(),
      }

      await expect(eventStream.broadcast(event)).resolves.not.toThrow()
    })

    it('should handle subscriber with null callback property', async () => {
      const callback = vi.fn()
      await eventStream.subscribeToQuery('SELECT * FROM events', callback)

      // Corrupt entry with null callback
      const liveQueriesMap = (eventStream as any).liveQueries as Map<string, any>
      liveQueriesMap.set('null-callback-entry', {
        sql: 'SELECT * FROM events',
        params: [],
        callback: null,
      })

      const event: BroadcastEvent = {
        id: 'evt-11',
        type: 'test',
        topic: 'test',
        payload: {},
        timestamp: Date.now(),
      }

      await expect(eventStream.broadcast(event)).resolves.not.toThrow()
    })

    it('should handle subscriber with undefined callback property', async () => {
      const callback = vi.fn()
      await eventStream.subscribeToQuery('SELECT * FROM events', callback)

      const liveQueriesMap = (eventStream as any).liveQueries as Map<string, any>
      liveQueriesMap.set('undefined-callback-entry', {
        sql: 'SELECT * FROM events',
        params: [],
        callback: undefined,
      })

      const event: BroadcastEvent = {
        id: 'evt-12',
        type: 'test',
        topic: 'test',
        payload: {},
        timestamp: Date.now(),
      }

      await expect(eventStream.broadcast(event)).resolves.not.toThrow()
    })
  })

  describe('no crash on malformed input', () => {
    it('should handle completely malformed subscriber entry (empty object)', async () => {
      const callback = vi.fn()
      await eventStream.subscribeToQuery('SELECT * FROM events', callback)

      const liveQueriesMap = (eventStream as any).liveQueries as Map<string, any>
      liveQueriesMap.set('empty-object-entry', {})

      const event: BroadcastEvent = {
        id: 'evt-13',
        type: 'test',
        topic: 'test',
        payload: {},
        timestamp: Date.now(),
      }

      await expect(eventStream.broadcast(event)).resolves.not.toThrow()
    })

    it('should handle subscriber entry that is not an object (string)', async () => {
      const callback = vi.fn()
      await eventStream.subscribeToQuery('SELECT * FROM events', callback)

      const liveQueriesMap = (eventStream as any).liveQueries as Map<string, any>
      liveQueriesMap.set('string-entry', 'not-an-object' as any)

      const event: BroadcastEvent = {
        id: 'evt-14',
        type: 'test',
        topic: 'test',
        payload: {},
        timestamp: Date.now(),
      }

      await expect(eventStream.broadcast(event)).resolves.not.toThrow()
    })

    it('should handle subscriber entry that is a number', async () => {
      const callback = vi.fn()
      await eventStream.subscribeToQuery('SELECT * FROM events', callback)

      const liveQueriesMap = (eventStream as any).liveQueries as Map<string, any>
      liveQueriesMap.set('number-entry', 12345 as any)

      const event: BroadcastEvent = {
        id: 'evt-15',
        type: 'test',
        topic: 'test',
        payload: {},
        timestamp: Date.now(),
      }

      await expect(eventStream.broadcast(event)).resolves.not.toThrow()
    })

    it('should handle null event passed to broadcast', async () => {
      const callback = vi.fn()
      await eventStream.subscribeToQuery('SELECT * FROM events', callback)

      // Passing null event should be handled gracefully
      await expect(eventStream.broadcast(null as any)).resolves.not.toThrow()
    })

    it('should handle undefined event passed to broadcast', async () => {
      const callback = vi.fn()
      await eventStream.subscribeToQuery('SELECT * FROM events', callback)

      // Passing undefined event should be handled gracefully
      await expect(eventStream.broadcast(undefined as any)).resolves.not.toThrow()
    })
  })
})
