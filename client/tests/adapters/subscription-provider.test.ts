/**
 * Subscription Provider Adapter Tests
 *
 * RED TDD tests for real-time subscription adapter.
 * The adapter creates a subscription provider that:
 * - Connects to Durable Objects via WebSocket
 * - Subscribes to collection changes (create/update/delete events)
 * - Integrates with react-admin's useSubscribe pattern
 * - Handles automatic reconnection
 * - Manages offline queue and replay
 *
 * Expected API:
 *   import { createSubscriptionProvider } from '@dotdo/client/adapters'
 *   const subscriptionProvider = createSubscriptionProvider('wss://api.example.com/do/main')
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// =============================================================================
// Import from implementation (does not exist yet - tests should FAIL)
// =============================================================================

// This import will fail until the adapter is implemented
// The adapter should be created at: packages/client/src/adapters/subscription-provider.ts
// Or exported from: @dotdo/client/adapters
import { createSubscriptionProvider } from '@dotdo/client/adapters/subscription-provider'
import type {
  SubscriptionProvider,
  SubscriptionCallback,
  SubscriptionEvent,
  SubscriptionOptions,
} from '@dotdo/client/adapters/subscription-provider'

// =============================================================================
// Mock WebSocket for testing
// =============================================================================

class MockWebSocket {
  static instances: MockWebSocket[] = []
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  url: string
  readyState = MockWebSocket.CONNECTING

  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code?: number; reason?: string; wasClean?: boolean }) => void) | null = null
  onerror: ((error: Event) => void) | null = null

  sentMessages: string[] = []

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sentMessages.push(data)
  }

  close(code?: number, reason?: string) {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({ code, reason, wasClean: true })
  }

  // Test helpers
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN
    this.onopen?.()
  }

  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) })
  }

  simulateClose(code?: number, reason?: string) {
    this.readyState = MockWebSocket.CLOSED
    this.onclose?.({ code, reason, wasClean: false })
  }

  simulateError(error: Event) {
    this.onerror?.(error)
  }

  getSentJSON<T = unknown>(): T[] {
    return this.sentMessages.map((m) => JSON.parse(m))
  }
}

// =============================================================================
// Test Suite
// =============================================================================

describe('Subscription Provider Adapter', () => {
  let originalWebSocket: typeof globalThis.WebSocket

  beforeEach(() => {
    vi.useFakeTimers()
    MockWebSocket.instances = []
    originalWebSocket = globalThis.WebSocket
    // @ts-expect-error - mock WebSocket
    globalThis.WebSocket = MockWebSocket
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.WebSocket = originalWebSocket
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // Basic Subscription Tests
  // ===========================================================================

  describe('subscribe to collection changes', () => {
    it('creates a subscription provider from DO URL', () => {
      const provider = createSubscriptionProvider('wss://api.example.com/do/main')

      expect(provider).toBeDefined()
      expect(provider.subscribe).toBeInstanceOf(Function)
      expect(provider.unsubscribe).toBeInstanceOf(Function)
    })

    it('establishes WebSocket connection on first subscription', () => {
      const provider = createSubscriptionProvider('wss://api.example.com/do/main')

      provider.subscribe('posts', () => {})

      expect(MockWebSocket.instances).toHaveLength(1)
      expect(MockWebSocket.instances[0].url).toBe('wss://api.example.com/do/main/subscribe')
    })

    it('sends subscription message for resource', () => {
      const provider = createSubscriptionProvider('wss://api.example.com/do/main')

      provider.subscribe('posts', () => {})
      MockWebSocket.instances[0].simulateOpen()

      const sent = MockWebSocket.instances[0].getSentJSON<{ type: string; resource: string }>()
      expect(sent).toContainEqual(
        expect.objectContaining({
          type: 'subscribe',
          resource: 'posts',
        })
      )
    })

    it('receives create events for subscribed collection', () => {
      const provider = createSubscriptionProvider('wss://api.example.com/do/main')
      const events: SubscriptionEvent[] = []

      provider.subscribe('posts', (event) => {
        events.push(event)
      })
      MockWebSocket.instances[0].simulateOpen()

      // Server sends create event
      MockWebSocket.instances[0].simulateMessage({
        type: 'event',
        resource: 'posts',
        event: 'created',
        payload: { id: '1', title: 'New Post', content: 'Hello world' },
      })

      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        type: 'created',
        resource: 'posts',
        payload: { id: '1', title: 'New Post' },
      })
    })

    it('receives update events for subscribed collection', () => {
      const provider = createSubscriptionProvider('wss://api.example.com/do/main')
      const events: SubscriptionEvent[] = []

      provider.subscribe('posts', (event) => {
        events.push(event)
      })
      MockWebSocket.instances[0].simulateOpen()

      MockWebSocket.instances[0].simulateMessage({
        type: 'event',
        resource: 'posts',
        event: 'updated',
        payload: { id: '1', title: 'Updated Post' },
        previousData: { id: '1', title: 'Original Title' },
      })

      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        type: 'updated',
        resource: 'posts',
        payload: { id: '1', title: 'Updated Post' },
        previousData: { id: '1', title: 'Original Title' },
      })
    })

    it('receives delete events for subscribed collection', () => {
      const provider = createSubscriptionProvider('wss://api.example.com/do/main')
      const events: SubscriptionEvent[] = []

      provider.subscribe('posts', (event) => {
        events.push(event)
      })
      MockWebSocket.instances[0].simulateOpen()

      MockWebSocket.instances[0].simulateMessage({
        type: 'event',
        resource: 'posts',
        event: 'deleted',
        payload: { id: '1' },
      })

      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        type: 'deleted',
        resource: 'posts',
        payload: { id: '1' },
      })
    })
  })

  // ===========================================================================
  // Automatic Reconnection Tests
  // ===========================================================================

  describe('automatic reconnection on disconnect', () => {
    it('reconnects automatically when connection is lost', async () => {
      const provider = createSubscriptionProvider('wss://api.example.com/do/main')

      provider.subscribe('posts', () => {})
      MockWebSocket.instances[0].simulateOpen()
      expect(MockWebSocket.instances).toHaveLength(1)

      // Simulate unexpected disconnect
      MockWebSocket.instances[0].simulateClose(1006, 'Abnormal closure')

      // Should schedule reconnection
      vi.advanceTimersByTime(1000)
      expect(MockWebSocket.instances).toHaveLength(2)
    })

    it('uses exponential backoff for reconnection attempts', async () => {
      const provider = createSubscriptionProvider('wss://api.example.com/do/main', {
        reconnect: { jitter: 0 },
      })

      provider.subscribe('posts', () => {})

      // First connection fails
      MockWebSocket.instances[0].simulateClose(1006)
      vi.advanceTimersByTime(1000) // 1s delay
      expect(MockWebSocket.instances).toHaveLength(2)

      // Second connection fails
      MockWebSocket.instances[1].simulateClose(1006)
      vi.advanceTimersByTime(1000) // Not yet (need 2s)
      expect(MockWebSocket.instances).toHaveLength(2)
      vi.advanceTimersByTime(1000) // 2s total
      expect(MockWebSocket.instances).toHaveLength(3)
    })

    it('re-subscribes to all resources after reconnection', async () => {
      const provider = createSubscriptionProvider('wss://api.example.com/do/main')

      provider.subscribe('posts', () => {})
      provider.subscribe('comments', () => {})
      MockWebSocket.instances[0].simulateOpen()

      // Disconnect
      MockWebSocket.instances[0].simulateClose(1006)
      vi.advanceTimersByTime(1000)

      // Reconnect
      MockWebSocket.instances[1].simulateOpen()

      const sent = MockWebSocket.instances[1].getSentJSON<{ type: string; resource: string }>()
      expect(sent).toContainEqual(expect.objectContaining({ type: 'subscribe', resource: 'posts' }))
      expect(sent).toContainEqual(expect.objectContaining({ type: 'subscribe', resource: 'comments' }))
    })

    it('emits reconnection status events', async () => {
      const provider = createSubscriptionProvider('wss://api.example.com/do/main')
      const statusEvents: string[] = []

      provider.onStatusChange((status) => {
        statusEvents.push(status)
      })

      provider.subscribe('posts', () => {})
      MockWebSocket.instances[0].simulateOpen()
      expect(statusEvents).toContain('connected')

      MockWebSocket.instances[0].simulateClose(1006)
      expect(statusEvents).toContain('reconnecting')

      vi.advanceTimersByTime(1000)
      MockWebSocket.instances[1].simulateOpen()
      expect(statusEvents).toContain('connected')
    })

    it('continues receiving events after reconnection', async () => {
      const provider = createSubscriptionProvider('wss://api.example.com/do/main')
      const events: SubscriptionEvent[] = []

      provider.subscribe('posts', (event) => {
        events.push(event)
      })
      MockWebSocket.instances[0].simulateOpen()

      // Receive event before disconnect
      MockWebSocket.instances[0].simulateMessage({
        type: 'event',
        resource: 'posts',
        event: 'created',
        payload: { id: '1' },
      })
      expect(events).toHaveLength(1)

      // Disconnect and reconnect
      MockWebSocket.instances[0].simulateClose(1006)
      vi.advanceTimersByTime(1000)
      MockWebSocket.instances[1].simulateOpen()

      // Receive event after reconnect
      MockWebSocket.instances[1].simulateMessage({
        type: 'event',
        resource: 'posts',
        event: 'created',
        payload: { id: '2' },
      })
      expect(events).toHaveLength(2)
    })
  })

  // ===========================================================================
  // Subscription Cleanup Tests
  // ===========================================================================

  describe('subscription cleanup on unmount', () => {
    it('returns unsubscribe function from subscribe', () => {
      const provider = createSubscriptionProvider('wss://api.example.com/do/main')

      const unsubscribe = provider.subscribe('posts', () => {})

      expect(unsubscribe).toBeInstanceOf(Function)
    })

    it('stops receiving events after unsubscribe', () => {
      const provider = createSubscriptionProvider('wss://api.example.com/do/main')
      const events: SubscriptionEvent[] = []

      const unsubscribe = provider.subscribe('posts', (event) => {
        events.push(event)
      })
      MockWebSocket.instances[0].simulateOpen()

      // Receive event
      MockWebSocket.instances[0].simulateMessage({
        type: 'event',
        resource: 'posts',
        event: 'created',
        payload: { id: '1' },
      })
      expect(events).toHaveLength(1)

      // Unsubscribe
      unsubscribe()

      // Should not receive more events
      MockWebSocket.instances[0].simulateMessage({
        type: 'event',
        resource: 'posts',
        event: 'created',
        payload: { id: '2' },
      })
      expect(events).toHaveLength(1)
    })

    it('sends unsubscribe message when all listeners removed', () => {
      const provider = createSubscriptionProvider('wss://api.example.com/do/main')

      const unsub1 = provider.subscribe('posts', () => {})
      const unsub2 = provider.subscribe('posts', () => {})
      MockWebSocket.instances[0].simulateOpen()

      MockWebSocket.instances[0].sentMessages = []

      unsub1()
      // Should not unsubscribe yet (still have unsub2)
      const sentAfterFirst = MockWebSocket.instances[0].getSentJSON<{ type: string }>()
      expect(sentAfterFirst).not.toContainEqual(expect.objectContaining({ type: 'unsubscribe' }))

      unsub2()
      // Now should unsubscribe
      const sentAfterSecond = MockWebSocket.instances[0].getSentJSON<{ type: string; resource: string }>()
      expect(sentAfterSecond).toContainEqual(
        expect.objectContaining({
          type: 'unsubscribe',
          resource: 'posts',
        })
      )
    })

    it('closes WebSocket when all subscriptions removed', () => {
      const provider = createSubscriptionProvider('wss://api.example.com/do/main')

      const unsubscribe = provider.subscribe('posts', () => {})
      MockWebSocket.instances[0].simulateOpen()

      unsubscribe()

      // Should close connection after grace period
      vi.advanceTimersByTime(5000)
      expect(MockWebSocket.instances[0].readyState).toBe(MockWebSocket.CLOSED)
    })

    it('provides disconnect method for explicit cleanup', () => {
      const provider = createSubscriptionProvider('wss://api.example.com/do/main')

      provider.subscribe('posts', () => {})
      MockWebSocket.instances[0].simulateOpen()

      provider.disconnect()

      expect(MockWebSocket.instances[0].readyState).toBe(MockWebSocket.CLOSED)
    })
  })

  // ===========================================================================
  // Multiple Concurrent Subscriptions Tests
  // ===========================================================================

  describe('multiple concurrent subscriptions', () => {
    it('supports subscribing to multiple resources', () => {
      const provider = createSubscriptionProvider('wss://api.example.com/do/main')

      const postEvents: SubscriptionEvent[] = []
      const commentEvents: SubscriptionEvent[] = []

      provider.subscribe('posts', (event) => postEvents.push(event))
      provider.subscribe('comments', (event) => commentEvents.push(event))
      MockWebSocket.instances[0].simulateOpen()

      // Post event
      MockWebSocket.instances[0].simulateMessage({
        type: 'event',
        resource: 'posts',
        event: 'created',
        payload: { id: '1' },
      })

      // Comment event
      MockWebSocket.instances[0].simulateMessage({
        type: 'event',
        resource: 'comments',
        event: 'created',
        payload: { id: '2', postId: '1' },
      })

      expect(postEvents).toHaveLength(1)
      expect(commentEvents).toHaveLength(1)
    })

    it('allows multiple callbacks for same resource', () => {
      const provider = createSubscriptionProvider('wss://api.example.com/do/main')

      const events1: SubscriptionEvent[] = []
      const events2: SubscriptionEvent[] = []

      provider.subscribe('posts', (event) => events1.push(event))
      provider.subscribe('posts', (event) => events2.push(event))
      MockWebSocket.instances[0].simulateOpen()

      MockWebSocket.instances[0].simulateMessage({
        type: 'event',
        resource: 'posts',
        event: 'created',
        payload: { id: '1' },
      })

      expect(events1).toHaveLength(1)
      expect(events2).toHaveLength(1)
    })

    it('reuses single WebSocket connection for all subscriptions', () => {
      const provider = createSubscriptionProvider('wss://api.example.com/do/main')

      provider.subscribe('posts', () => {})
      provider.subscribe('comments', () => {})
      provider.subscribe('users', () => {})

      expect(MockWebSocket.instances).toHaveLength(1)
    })

    it('handles rapid subscribe/unsubscribe cycles', () => {
      const provider = createSubscriptionProvider('wss://api.example.com/do/main')

      for (let i = 0; i < 10; i++) {
        const unsub = provider.subscribe(`resource-${i}`, () => {})
        unsub()
      }

      // Should not throw or enter bad state
      expect(provider).toBeDefined()
    })
  })

  // ===========================================================================
  // Filter Subscriptions Tests
  // ===========================================================================

  describe('filter subscriptions by resource', () => {
    it('supports subscribing to specific record by ID', () => {
      const provider = createSubscriptionProvider('wss://api.example.com/do/main')
      const events: SubscriptionEvent[] = []

      provider.subscribe('posts', (event) => events.push(event), {
        id: 'post-123',
      })
      MockWebSocket.instances[0].simulateOpen()

      const sent = MockWebSocket.instances[0].getSentJSON<{ type: string; resource: string; filter: { id: string } }>()
      expect(sent).toContainEqual(
        expect.objectContaining({
          type: 'subscribe',
          resource: 'posts',
          filter: { id: 'post-123' },
        })
      )
    })

    it('filters events by subscribed ID', () => {
      const provider = createSubscriptionProvider('wss://api.example.com/do/main')
      const events: SubscriptionEvent[] = []

      provider.subscribe('posts', (event) => events.push(event), {
        id: 'post-123',
      })
      MockWebSocket.instances[0].simulateOpen()

      // Event for subscribed ID
      MockWebSocket.instances[0].simulateMessage({
        type: 'event',
        resource: 'posts',
        event: 'updated',
        payload: { id: 'post-123', title: 'Updated' },
      })

      // Event for different ID (should be ignored)
      MockWebSocket.instances[0].simulateMessage({
        type: 'event',
        resource: 'posts',
        event: 'updated',
        payload: { id: 'post-456', title: 'Other' },
      })

      expect(events).toHaveLength(1)
      expect(events[0].payload).toMatchObject({ id: 'post-123' })
    })

    it('supports subscribing with custom filter', () => {
      const provider = createSubscriptionProvider('wss://api.example.com/do/main')
      const events: SubscriptionEvent[] = []

      provider.subscribe('posts', (event) => events.push(event), {
        filter: { authorId: 'user-1', status: 'published' },
      })
      MockWebSocket.instances[0].simulateOpen()

      const sent = MockWebSocket.instances[0].getSentJSON<{
        type: string
        resource: string
        filter: Record<string, unknown>
      }>()
      expect(sent).toContainEqual(
        expect.objectContaining({
          type: 'subscribe',
          resource: 'posts',
          filter: { authorId: 'user-1', status: 'published' },
        })
      )
    })

    it('supports subscribing to related resources', () => {
      const provider = createSubscriptionProvider('wss://api.example.com/do/main')

      provider.subscribe('comments', () => {}, {
        filter: { postId: 'post-123' },
      })
      MockWebSocket.instances[0].simulateOpen()

      const sent = MockWebSocket.instances[0].getSentJSON<{
        type: string
        resource: string
        filter: { postId: string }
      }>()
      expect(sent).toContainEqual(
        expect.objectContaining({
          type: 'subscribe',
          resource: 'comments',
          filter: { postId: 'post-123' },
        })
      )
    })
  })

  // ===========================================================================
  // React-Admin useSubscribe Integration Tests
  // ===========================================================================

  describe('react-admin useSubscribe pattern integration', () => {
    it('provides subscribe function compatible with useSubscribe', () => {
      const provider = createSubscriptionProvider('wss://api.example.com/do/main')

      // react-admin useSubscribe pattern:
      // subscribe(topic, callback)
      // where topic can be:
      // - 'resource/posts' for all posts
      // - 'resource/posts/123' for specific post

      const events: SubscriptionEvent[] = []
      const unsubscribe = provider.subscribe('resource/posts', (event) => {
        events.push(event)
      })

      expect(unsubscribe).toBeInstanceOf(Function)
    })

    it('parses resource/id topic format', () => {
      const provider = createSubscriptionProvider('wss://api.example.com/do/main')

      provider.subscribe('resource/posts/123', () => {})
      MockWebSocket.instances[0].simulateOpen()

      const sent = MockWebSocket.instances[0].getSentJSON<{
        type: string
        resource: string
        filter?: { id: string }
      }>()
      expect(sent).toContainEqual(
        expect.objectContaining({
          type: 'subscribe',
          resource: 'posts',
          filter: { id: '123' },
        })
      )
    })

    it('provides getSubscriptionCallback for dataProvider integration', () => {
      const provider = createSubscriptionProvider('wss://api.example.com/do/main')

      // react-admin dataProvider with realtime:
      // dataProvider.getSubscriptionCallback = subscriptionProvider.getSubscriptionCallback
      expect(provider.getSubscriptionCallback).toBeInstanceOf(Function)

      const callback = provider.getSubscriptionCallback('posts')
      expect(callback).toBeInstanceOf(Function)
    })

    it('maps events to react-admin format', () => {
      const provider = createSubscriptionProvider('wss://api.example.com/do/main')
      const events: SubscriptionEvent[] = []

      provider.subscribe('resource/posts', (event) => {
        events.push(event)
      })
      MockWebSocket.instances[0].simulateOpen()

      MockWebSocket.instances[0].simulateMessage({
        type: 'event',
        resource: 'posts',
        event: 'created',
        payload: { id: '1', title: 'New' },
      })

      // react-admin expects: { type: 'created', payload: { ids: ['1'], data: {...} } }
      expect(events[0]).toMatchObject({
        type: 'created',
        payload: expect.objectContaining({
          ids: ['1'],
        }),
      })
    })

    it('supports useSubscribeToRecord pattern (specific record)', () => {
      const provider = createSubscriptionProvider('wss://api.example.com/do/main')
      const events: SubscriptionEvent[] = []

      // useSubscribeToRecord subscribes to specific record changes
      provider.subscribeToRecord('posts', '123', (event) => {
        events.push(event)
      })
      MockWebSocket.instances[0].simulateOpen()

      MockWebSocket.instances[0].simulateMessage({
        type: 'event',
        resource: 'posts',
        event: 'updated',
        payload: { id: '123', title: 'Updated' },
      })

      expect(events).toHaveLength(1)
    })

    it('supports useSubscribeToRecordList pattern (list of records)', () => {
      const provider = createSubscriptionProvider('wss://api.example.com/do/main')
      const events: SubscriptionEvent[] = []

      // useSubscribeToRecordList subscribes to changes in a list
      provider.subscribeToRecordList('posts', ['1', '2', '3'], (event) => {
        events.push(event)
      })
      MockWebSocket.instances[0].simulateOpen()

      const sent = MockWebSocket.instances[0].getSentJSON<{
        type: string
        resource: string
        filter: { ids: string[] }
      }>()
      expect(sent).toContainEqual(
        expect.objectContaining({
          type: 'subscribe',
          resource: 'posts',
          filter: { ids: ['1', '2', '3'] },
        })
      )
    })
  })

  // ===========================================================================
  // Offline Queue and Replay Tests
  // ===========================================================================

  describe('offline queue and replay', () => {
    it('queues subscription requests when offline', () => {
      const provider = createSubscriptionProvider('wss://api.example.com/do/main')

      // Subscribe while connecting (not yet open)
      provider.subscribe('posts', () => {})

      // No messages sent yet
      expect(MockWebSocket.instances[0].sentMessages).toHaveLength(0)

      // Connection opens
      MockWebSocket.instances[0].simulateOpen()

      // Now subscription is sent
      const sent = MockWebSocket.instances[0].getSentJSON<{ type: string; resource: string }>()
      expect(sent).toContainEqual(
        expect.objectContaining({
          type: 'subscribe',
          resource: 'posts',
        })
      )
    })

    it('replays missed events on reconnection with last event ID', async () => {
      const provider = createSubscriptionProvider('wss://api.example.com/do/main', {
        enableReplay: true,
      })
      const events: SubscriptionEvent[] = []

      provider.subscribe('posts', (event) => {
        events.push(event)
      })
      MockWebSocket.instances[0].simulateOpen()

      // Receive event with eventId
      MockWebSocket.instances[0].simulateMessage({
        type: 'event',
        resource: 'posts',
        event: 'created',
        payload: { id: '1' },
        eventId: 'evt-100',
      })

      // Disconnect
      MockWebSocket.instances[0].simulateClose(1006)
      vi.advanceTimersByTime(1000)

      // Reconnect
      MockWebSocket.instances[1].simulateOpen()

      // Should request replay from last eventId
      const sent = MockWebSocket.instances[1].getSentJSON<{
        type: string
        resource: string
        lastEventId: string
      }>()
      expect(sent).toContainEqual(
        expect.objectContaining({
          type: 'subscribe',
          resource: 'posts',
          lastEventId: 'evt-100',
        })
      )
    })

    it('handles replay events from server', async () => {
      const provider = createSubscriptionProvider('wss://api.example.com/do/main', {
        enableReplay: true,
      })
      const events: SubscriptionEvent[] = []

      provider.subscribe('posts', (event) => {
        events.push(event)
      })
      MockWebSocket.instances[0].simulateOpen()

      // Initial event
      MockWebSocket.instances[0].simulateMessage({
        type: 'event',
        resource: 'posts',
        event: 'created',
        payload: { id: '1' },
        eventId: 'evt-100',
      })

      // Disconnect and reconnect
      MockWebSocket.instances[0].simulateClose(1006)
      vi.advanceTimersByTime(1000)
      MockWebSocket.instances[1].simulateOpen()

      // Server sends replayed events
      MockWebSocket.instances[1].simulateMessage({
        type: 'replay',
        events: [
          { resource: 'posts', event: 'created', payload: { id: '2' }, eventId: 'evt-101' },
          { resource: 'posts', event: 'updated', payload: { id: '1' }, eventId: 'evt-102' },
        ],
      })

      // Should have received replay events
      expect(events).toHaveLength(3) // initial + 2 replayed
    })

    it('stores events locally for offline access', async () => {
      const mockStorage = new Map<string, string>()
      const provider = createSubscriptionProvider('wss://api.example.com/do/main', {
        enableReplay: true,
        storage: {
          getItem: (key: string) => mockStorage.get(key) ?? null,
          setItem: (key: string, value: string) => mockStorage.set(key, value),
          removeItem: (key: string) => mockStorage.delete(key),
        },
      })
      const events: SubscriptionEvent[] = []

      provider.subscribe('posts', (event) => {
        events.push(event)
      })
      MockWebSocket.instances[0].simulateOpen()

      MockWebSocket.instances[0].simulateMessage({
        type: 'event',
        resource: 'posts',
        event: 'created',
        payload: { id: '1', title: 'Test' },
        eventId: 'evt-100',
      })

      // Event should be stored
      expect(mockStorage.size).toBeGreaterThan(0)
    })

    it('limits offline event storage size', async () => {
      const mockStorage = new Map<string, string>()
      const provider = createSubscriptionProvider('wss://api.example.com/do/main', {
        enableReplay: true,
        maxStoredEvents: 10,
        storage: {
          getItem: (key: string) => mockStorage.get(key) ?? null,
          setItem: (key: string, value: string) => mockStorage.set(key, value),
          removeItem: (key: string) => mockStorage.delete(key),
        },
      })

      provider.subscribe('posts', () => {})
      MockWebSocket.instances[0].simulateOpen()

      // Send many events
      for (let i = 0; i < 20; i++) {
        MockWebSocket.instances[0].simulateMessage({
          type: 'event',
          resource: 'posts',
          event: 'created',
          payload: { id: `${i}` },
          eventId: `evt-${i}`,
        })
      }

      // Should have pruned old events
      const storedEvents = JSON.parse(mockStorage.get('subscription-events') ?? '[]')
      expect(storedEvents.length).toBeLessThanOrEqual(10)
    })

    it('provides optimistic updates while offline', async () => {
      const provider = createSubscriptionProvider('wss://api.example.com/do/main', {
        enableOptimisticUpdates: true,
      })
      const events: SubscriptionEvent[] = []

      provider.subscribe('posts', (event) => {
        events.push(event)
      })

      // Apply optimistic update
      provider.applyOptimisticUpdate('posts', {
        type: 'created',
        payload: { id: 'temp-1', title: 'Optimistic Post' },
      })

      expect(events).toHaveLength(1)
      expect(events[0].payload).toMatchObject({
        id: 'temp-1',
        title: 'Optimistic Post',
      })
    })

    it('rolls back optimistic updates on server rejection', async () => {
      const provider = createSubscriptionProvider('wss://api.example.com/do/main', {
        enableOptimisticUpdates: true,
      })
      const events: SubscriptionEvent[] = []

      provider.subscribe('posts', (event) => {
        events.push(event)
      })

      const updateId = provider.applyOptimisticUpdate('posts', {
        type: 'created',
        payload: { id: 'temp-1', title: 'Optimistic Post' },
      })

      expect(events).toHaveLength(1)

      // Server rejects
      provider.rollbackOptimisticUpdate(updateId)

      expect(events).toHaveLength(2)
      expect(events[1].type).toBe('rollback')
    })
  })

  // ===========================================================================
  // Error Handling Tests
  // ===========================================================================

  describe('error handling', () => {
    it('emits error events on connection failure', () => {
      const provider = createSubscriptionProvider('wss://api.example.com/do/main')
      const errors: Error[] = []

      provider.onError((error) => {
        errors.push(error)
      })

      provider.subscribe('posts', () => {})
      MockWebSocket.instances[0].simulateError(new Event('error'))

      expect(errors).toHaveLength(1)
    })

    it('handles malformed server messages gracefully', () => {
      const provider = createSubscriptionProvider('wss://api.example.com/do/main')
      const events: SubscriptionEvent[] = []
      const errors: Error[] = []

      provider.onError((error) => errors.push(error))
      provider.subscribe('posts', (event) => events.push(event))
      MockWebSocket.instances[0].simulateOpen()

      // Send malformed message
      MockWebSocket.instances[0].onmessage?.({ data: 'not json' })

      // Should not crash, may emit error
      expect(events).toHaveLength(0)
    })

    it('provides connection status for UI feedback', () => {
      const provider = createSubscriptionProvider('wss://api.example.com/do/main')

      expect(provider.status).toBe('disconnected')

      provider.subscribe('posts', () => {})
      expect(provider.status).toBe('connecting')

      MockWebSocket.instances[0].simulateOpen()
      expect(provider.status).toBe('connected')

      MockWebSocket.instances[0].simulateClose(1006)
      expect(provider.status).toBe('reconnecting')
    })
  })
})
