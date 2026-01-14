/**
 * WSBroadcaster Tests - WebSocket Fan-out for Real-time Updates
 *
 * TDD RED PHASE - These tests MUST FAIL because the implementation doesn't exist yet.
 *
 * WSBroadcaster handles efficient fan-out of updates to subscribed WebSocket clients:
 * - Topic-based subscriptions ($type, $id, wildcard)
 * - Efficient fan-out to many clients with batching
 * - Backpressure handling for slow clients
 * - Message coalescing for rapid updates
 * - Backfill on subscribe for late joiners
 *
 * Architecture context (from unified-storage.md):
 * - Broadcast component sits alongside Pipeline and SQLite in write path
 * - Sends real-time updates to subscribed clients
 * - Works with hibernatable WebSockets (zero duration cost when idle)
 *
 * Issue: do-2tr.4.4
 *
 * @see /objects/unified-storage/ws-broadcaster.ts (to be created in GREEN phase)
 * @see /docs/architecture/unified-storage.md
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ============================================================================
// IMPORTS - These MUST FAIL because the implementation doesn't exist yet
// ============================================================================

// This import will fail - the file doesn't exist
import {
  WSBroadcaster,
  type WSBroadcasterConfig,
  type Subscription,
  type BroadcastMessage,
  type BroadcastStats,
} from '../../objects/unified-storage/ws-broadcaster'

// ============================================================================
// TYPE DEFINITIONS FOR TESTS
// ============================================================================

/**
 * Thing type matching the unified storage pattern
 */
interface Thing {
  $id: string
  $type: string
  $version?: number
  $createdAt?: number
  $updatedAt?: number
  [key: string]: unknown
}

/**
 * Domain event emitted on mutations
 */
interface DomainEvent {
  type: 'thing.created' | 'thing.updated' | 'thing.deleted'
  entityId: string
  entityType: string
  payload: Thing | Partial<Thing>
  ts: number
  version: number
}

// ============================================================================
// MOCK WEBSOCKET
// ============================================================================

/**
 * Mock WebSocket for testing broadcast behavior
 */
class MockWebSocket {
  readyState: number = WebSocket.OPEN
  sentMessages: string[] = []
  private messageQueue: string[] = []
  private sendDelay: number = 0
  private dropAfter: number = Infinity

  constructor(options: { sendDelay?: number; dropAfter?: number } = {}) {
    this.sendDelay = options.sendDelay ?? 0
    this.dropAfter = options.dropAfter ?? Infinity
  }

  async send(message: string): Promise<void> {
    if (this.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not open')
    }

    if (this.sentMessages.length >= this.dropAfter) {
      throw new Error('Client buffer full')
    }

    if (this.sendDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.sendDelay))
    }

    this.sentMessages.push(message)
  }

  close(code?: number, reason?: string): void {
    this.readyState = WebSocket.CLOSED
  }

  getMessages<T = unknown>(): T[] {
    return this.sentMessages.map((m) => JSON.parse(m) as T)
  }

  getLastMessage<T = unknown>(): T | null {
    if (this.sentMessages.length === 0) return null
    return JSON.parse(this.sentMessages[this.sentMessages.length - 1]) as T
  }

  clearMessages(): void {
    this.sentMessages = []
  }

  simulateDisconnect(): void {
    this.readyState = WebSocket.CLOSED
  }

  simulateSlowClient(delayMs: number): void {
    this.sendDelay = delayMs
  }
}

// ============================================================================
// MOCK EVENT STORE (for backfill)
// ============================================================================

interface MockEventStore {
  events: DomainEvent[]
  addEvent(event: DomainEvent): void
  getRecentEvents(filter: { $type?: string; $id?: string; limit?: number }): DomainEvent[]
  clear(): void
}

function createMockEventStore(): MockEventStore {
  const events: DomainEvent[] = []

  return {
    events,
    addEvent(event: DomainEvent) {
      events.push(event)
    },
    getRecentEvents(filter: { $type?: string; $id?: string; limit?: number }) {
      let filtered = events

      if (filter.$type) {
        filtered = filtered.filter((e) => e.entityType === filter.$type)
      }
      if (filter.$id) {
        filtered = filtered.filter((e) => e.entityId === filter.$id)
      }

      const limit = filter.limit ?? 100
      return filtered.slice(-limit)
    },
    clear() {
      events.length = 0
    },
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function createTestThing(overrides: Partial<Thing> = {}): Thing {
  const now = Date.now()
  return {
    $id: overrides.$id ?? `thing_${crypto.randomUUID()}`,
    $type: overrides.$type ?? 'TestEntity',
    $version: overrides.$version ?? 1,
    $createdAt: overrides.$createdAt ?? now,
    $updatedAt: overrides.$updatedAt ?? now,
    name: 'Test Thing',
    ...overrides,
  }
}

function createTestEvent(
  type: DomainEvent['type'],
  thing: Thing,
  delta?: Partial<Thing>
): DomainEvent {
  return {
    type,
    entityId: thing.$id,
    entityType: thing.$type,
    payload: delta ?? thing,
    ts: Date.now(),
    version: thing.$version ?? 1,
  }
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('WSBroadcaster', () => {
  let broadcaster: WSBroadcaster
  let eventStore: MockEventStore

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-14T12:00:00.000Z'))
    eventStore = createMockEventStore()
  })

  afterEach(async () => {
    if (broadcaster) {
      await broadcaster.close()
    }
    vi.useRealTimers()
  })

  // ==========================================================================
  // SUBSCRIPTIONS
  // ==========================================================================

  describe('subscriptions', () => {
    beforeEach(() => {
      broadcaster = new WSBroadcaster({
        eventStore: eventStore as unknown as MockEventStore,
      })
    })

    it('should register subscription for $type', async () => {
      const ws = new MockWebSocket()

      // Subscribe to all Customer updates
      const sub = broadcaster.subscribe(ws as unknown as WebSocket, {
        $type: 'Customer',
      })

      expect(sub).toBeDefined()
      expect(sub.id).toBeDefined()
      expect(sub.filter.$type).toBe('Customer')

      // Verify subscription is registered
      const subs = broadcaster.getSubscriptions(ws as unknown as WebSocket)
      expect(subs.length).toBe(1)
      expect(subs[0].filter.$type).toBe('Customer')
    })

    it('should register subscription for specific $id', async () => {
      const ws = new MockWebSocket()

      // Subscribe to a specific entity
      const sub = broadcaster.subscribe(ws as unknown as WebSocket, {
        $id: 'customer_123',
      })

      expect(sub.filter.$id).toBe('customer_123')

      // Verify subscription
      const subs = broadcaster.getSubscriptions(ws as unknown as WebSocket)
      expect(subs.length).toBe(1)
      expect(subs[0].filter.$id).toBe('customer_123')
    })

    it('should register wildcard subscription (all updates)', async () => {
      const ws = new MockWebSocket()

      // Subscribe to all updates (wildcard)
      const sub = broadcaster.subscribe(ws as unknown as WebSocket, {
        wildcard: true,
      })

      expect(sub.filter.wildcard).toBe(true)

      // Verify subscription
      const subs = broadcaster.getSubscriptions(ws as unknown as WebSocket)
      expect(subs.length).toBe(1)
      expect(subs[0].filter.wildcard).toBe(true)
    })

    it('should unsubscribe client', async () => {
      const ws = new MockWebSocket()

      // Subscribe
      const sub = broadcaster.subscribe(ws as unknown as WebSocket, {
        $type: 'Customer',
      })

      expect(broadcaster.getSubscriptions(ws as unknown as WebSocket).length).toBe(1)

      // Unsubscribe
      broadcaster.unsubscribe(ws as unknown as WebSocket, sub.id)

      expect(broadcaster.getSubscriptions(ws as unknown as WebSocket).length).toBe(0)
    })

    it('should clean up subscriptions on client disconnect', async () => {
      const ws = new MockWebSocket()

      // Subscribe to multiple topics
      broadcaster.subscribe(ws as unknown as WebSocket, { $type: 'Customer' })
      broadcaster.subscribe(ws as unknown as WebSocket, { $type: 'Order' })
      broadcaster.subscribe(ws as unknown as WebSocket, { $id: 'specific_123' })

      expect(broadcaster.getSubscriptions(ws as unknown as WebSocket).length).toBe(3)

      // Simulate disconnect
      ws.simulateDisconnect()
      broadcaster.handleDisconnect(ws as unknown as WebSocket)

      // All subscriptions should be cleaned up
      expect(broadcaster.getSubscriptions(ws as unknown as WebSocket).length).toBe(0)
      expect(broadcaster.getTotalSubscriptions()).toBe(0)
    })

    it('should support multiple subscriptions per client', async () => {
      const ws = new MockWebSocket()

      broadcaster.subscribe(ws as unknown as WebSocket, { $type: 'Customer' })
      broadcaster.subscribe(ws as unknown as WebSocket, { $type: 'Order' })
      broadcaster.subscribe(ws as unknown as WebSocket, { $type: 'Product' })

      const subs = broadcaster.getSubscriptions(ws as unknown as WebSocket)
      expect(subs.length).toBe(3)
      expect(subs.map((s) => s.filter.$type).sort()).toEqual(['Customer', 'Order', 'Product'])
    })

    it('should support multiple clients per topic', async () => {
      const ws1 = new MockWebSocket()
      const ws2 = new MockWebSocket()
      const ws3 = new MockWebSocket()

      broadcaster.subscribe(ws1 as unknown as WebSocket, { $type: 'Customer' })
      broadcaster.subscribe(ws2 as unknown as WebSocket, { $type: 'Customer' })
      broadcaster.subscribe(ws3 as unknown as WebSocket, { $type: 'Customer' })

      expect(broadcaster.getSubscriberCount('Customer')).toBe(3)
    })
  })

  // ==========================================================================
  // BROADCAST
  // ==========================================================================

  describe('broadcast', () => {
    beforeEach(() => {
      broadcaster = new WSBroadcaster({
        eventStore: eventStore as unknown as MockEventStore,
      })
    })

    it('should broadcast to subscribers of matching $type', async () => {
      const ws1 = new MockWebSocket()
      const ws2 = new MockWebSocket()

      // Subscribe to Customer type
      broadcaster.subscribe(ws1 as unknown as WebSocket, { $type: 'Customer' })
      broadcaster.subscribe(ws2 as unknown as WebSocket, { $type: 'Customer' })

      // Broadcast a Customer event
      const thing = createTestThing({ $type: 'Customer', name: 'Alice' })
      const event = createTestEvent('thing.created', thing)

      await broadcaster.broadcast(event)

      // Both should receive the message
      expect(ws1.sentMessages.length).toBe(1)
      expect(ws2.sentMessages.length).toBe(1)

      const msg1 = ws1.getLastMessage<BroadcastMessage>()
      expect(msg1?.type).toBe('thing.created')
      expect(msg1?.entityId).toBe(thing.$id)
    })

    it('should broadcast to subscribers of specific $id', async () => {
      const ws = new MockWebSocket()

      // Subscribe to specific entity
      broadcaster.subscribe(ws as unknown as WebSocket, { $id: 'customer_specific' })

      // Broadcast update to that entity
      const thing = createTestThing({ $id: 'customer_specific', $type: 'Customer' })
      const event = createTestEvent('thing.updated', thing, { name: 'Updated Name' })

      await broadcaster.broadcast(event)

      expect(ws.sentMessages.length).toBe(1)
      const msg = ws.getLastMessage<BroadcastMessage>()
      expect(msg?.entityId).toBe('customer_specific')
    })

    it('should broadcast to wildcard subscribers', async () => {
      const ws = new MockWebSocket()

      // Subscribe to all updates
      broadcaster.subscribe(ws as unknown as WebSocket, { wildcard: true })

      // Broadcast different entity types
      const customer = createTestThing({ $type: 'Customer' })
      const order = createTestThing({ $type: 'Order' })
      const product = createTestThing({ $type: 'Product' })

      await broadcaster.broadcast(createTestEvent('thing.created', customer))
      await broadcaster.broadcast(createTestEvent('thing.created', order))
      await broadcaster.broadcast(createTestEvent('thing.created', product))

      // Should receive all three
      expect(ws.sentMessages.length).toBe(3)
    })

    it('should not broadcast to non-matching subscribers', async () => {
      const ws1 = new MockWebSocket()
      const ws2 = new MockWebSocket()

      // Subscribe to different types
      broadcaster.subscribe(ws1 as unknown as WebSocket, { $type: 'Customer' })
      broadcaster.subscribe(ws2 as unknown as WebSocket, { $type: 'Order' })

      // Broadcast Customer event
      const customer = createTestThing({ $type: 'Customer' })
      await broadcaster.broadcast(createTestEvent('thing.created', customer))

      // Only ws1 should receive
      expect(ws1.sentMessages.length).toBe(1)
      expect(ws2.sentMessages.length).toBe(0)
    })

    it('should skip disconnected clients', async () => {
      const ws1 = new MockWebSocket()
      const ws2 = new MockWebSocket()

      broadcaster.subscribe(ws1 as unknown as WebSocket, { $type: 'Customer' })
      broadcaster.subscribe(ws2 as unknown as WebSocket, { $type: 'Customer' })

      // Disconnect ws1
      ws1.simulateDisconnect()

      // Broadcast
      const thing = createTestThing({ $type: 'Customer' })
      await broadcaster.broadcast(createTestEvent('thing.created', thing))

      // Only ws2 should receive
      expect(ws2.sentMessages.length).toBe(1)
      // ws1 should not throw, just be skipped
    })

    it('should include subscription-specific metadata in broadcast', async () => {
      const ws = new MockWebSocket()

      const sub = broadcaster.subscribe(ws as unknown as WebSocket, {
        $type: 'Customer',
        includePayload: true,
      })

      const thing = createTestThing({ $type: 'Customer', name: 'Alice' })
      await broadcaster.broadcast(createTestEvent('thing.created', thing))

      const msg = ws.getLastMessage<BroadcastMessage>()
      expect(msg?.subscriptionId).toBe(sub.id)
      expect(msg?.payload).toBeDefined()
    })
  })

  // ==========================================================================
  // FAN-OUT EFFICIENCY
  // ==========================================================================

  describe('fan-out efficiency', () => {
    beforeEach(() => {
      broadcaster = new WSBroadcaster({
        eventStore: eventStore as unknown as MockEventStore,
        batchSize: 10,
        yieldEvery: 5,
      })
    })

    it('should batch broadcasts to many clients', async () => {
      const clients: MockWebSocket[] = []

      // Create 100 clients
      for (let i = 0; i < 100; i++) {
        const ws = new MockWebSocket()
        clients.push(ws)
        broadcaster.subscribe(ws as unknown as WebSocket, { $type: 'Customer' })
      }

      // Track batch calls
      const batchCalls: number[] = []
      const originalBroadcastBatch = (broadcaster as any).broadcastBatch?.bind(broadcaster)
      if (originalBroadcastBatch) {
        ;(broadcaster as any).broadcastBatch = async (clients: WebSocket[], message: string) => {
          batchCalls.push(clients.length)
          return originalBroadcastBatch(clients, message)
        }
      }

      // Broadcast
      const thing = createTestThing({ $type: 'Customer' })
      await broadcaster.broadcast(createTestEvent('thing.created', thing))

      // All clients should receive
      for (const client of clients) {
        expect(client.sentMessages.length).toBe(1)
      }

      // Should have been batched (exact batching strategy may vary)
      expect(batchCalls.length).toBeGreaterThan(0)
    })

    it('should yield between batches to avoid blocking', async () => {
      const clients: MockWebSocket[] = []

      // Create many clients
      for (let i = 0; i < 50; i++) {
        const ws = new MockWebSocket()
        clients.push(ws)
        broadcaster.subscribe(ws as unknown as WebSocket, { $type: 'Customer' })
      }

      // Track yields
      let yieldCount = 0
      const originalSetTimeout = globalThis.setTimeout
      vi.stubGlobal('setTimeout', (fn: Function, ms: number) => {
        if (ms === 0) yieldCount++
        return originalSetTimeout(fn, ms)
      })

      // Broadcast
      const thing = createTestThing({ $type: 'Customer' })
      await broadcaster.broadcast(createTestEvent('thing.created', thing))

      // Should have yielded between batches
      // With yieldEvery: 5 and 50 clients, expect ~10 yields
      expect(yieldCount).toBeGreaterThan(0)

      vi.unstubAllGlobals()
    })

    it('should track broadcast latency', async () => {
      const ws = new MockWebSocket()
      broadcaster.subscribe(ws as unknown as WebSocket, { $type: 'Customer' })

      const thing = createTestThing({ $type: 'Customer' })
      await broadcaster.broadcast(createTestEvent('thing.created', thing))

      const stats = broadcaster.getStats()
      expect(stats.lastBroadcastLatencyMs).toBeDefined()
      expect(stats.avgBroadcastLatencyMs).toBeDefined()
      expect(stats.totalBroadcasts).toBe(1)
    })

    it('should track messages per second', async () => {
      const ws = new MockWebSocket()
      broadcaster.subscribe(ws as unknown as WebSocket, { $type: 'Customer' })

      // Broadcast 10 messages
      for (let i = 0; i < 10; i++) {
        const thing = createTestThing({ $type: 'Customer' })
        await broadcaster.broadcast(createTestEvent('thing.created', thing))
      }

      const stats = broadcaster.getStats()
      expect(stats.totalBroadcasts).toBe(10)
      expect(stats.totalMessagesSent).toBe(10)
    })
  })

  // ==========================================================================
  // BACKPRESSURE
  // ==========================================================================

  describe('backpressure', () => {
    beforeEach(() => {
      broadcaster = new WSBroadcaster({
        eventStore: eventStore as unknown as MockEventStore,
        maxQueueSize: 5,
        dropPolicy: 'oldest',
        maxDropsBeforeDisconnect: 10,
      })
    })

    it('should queue messages when client is slow', async () => {
      const slowClient = new MockWebSocket({ sendDelay: 100 })
      broadcaster.subscribe(slowClient as unknown as WebSocket, { $type: 'Customer' })

      // Send multiple messages rapidly
      const promises: Promise<void>[] = []
      for (let i = 0; i < 3; i++) {
        const thing = createTestThing({ $type: 'Customer', name: `Customer ${i}` })
        promises.push(broadcaster.broadcast(createTestEvent('thing.created', thing)))
      }

      // Queue should have pending messages
      const queuedCount = broadcaster.getQueuedCount(slowClient as unknown as WebSocket)
      expect(queuedCount).toBeGreaterThan(0)

      // Wait for all to complete
      await vi.advanceTimersByTimeAsync(500)
      await Promise.all(promises)

      // All should eventually be delivered
      expect(slowClient.sentMessages.length).toBe(3)
    })

    it('should drop oldest messages when queue full', async () => {
      const slowClient = new MockWebSocket({ sendDelay: 1000 })
      broadcaster.subscribe(slowClient as unknown as WebSocket, { $type: 'Customer' })

      // Send more messages than queue can hold
      const messages: DomainEvent[] = []
      for (let i = 0; i < 10; i++) {
        const thing = createTestThing({ $type: 'Customer', name: `Customer ${i}` })
        messages.push(createTestEvent('thing.created', thing))
        broadcaster.broadcast(messages[i]) // Don't await - fire and forget
      }

      // Allow some processing
      await vi.advanceTimersByTimeAsync(100)

      // Check stats for dropped messages
      const stats = broadcaster.getClientStats(slowClient as unknown as WebSocket)
      expect(stats.droppedCount).toBeGreaterThan(0)
    })

    it('should disconnect client after too many drops', async () => {
      const slowClient = new MockWebSocket({ sendDelay: 1000 })
      broadcaster.subscribe(slowClient as unknown as WebSocket, { $type: 'Customer' })

      // Track disconnect
      let disconnected = false
      const originalClose = slowClient.close.bind(slowClient)
      slowClient.close = (code?: number, reason?: string) => {
        disconnected = true
        originalClose(code, reason)
      }

      // Send many messages to trigger drops
      for (let i = 0; i < 20; i++) {
        const thing = createTestThing({ $type: 'Customer', name: `Customer ${i}` })
        broadcaster.broadcast(createTestEvent('thing.created', thing))
      }

      // Allow some processing
      await vi.advanceTimersByTimeAsync(500)

      // Client should be disconnected after exceeding drop threshold
      expect(disconnected).toBe(true)
      expect(slowClient.readyState).toBe(WebSocket.CLOSED)
    })

    it('should support configurable drop policy (newest)', async () => {
      const dropNewestBroadcaster = new WSBroadcaster({
        eventStore: eventStore as unknown as MockEventStore,
        maxQueueSize: 3,
        dropPolicy: 'newest',
      })

      const slowClient = new MockWebSocket({ sendDelay: 1000 })
      dropNewestBroadcaster.subscribe(slowClient as unknown as WebSocket, { $type: 'Customer' })

      // Queue up messages - newest should be dropped
      for (let i = 0; i < 6; i++) {
        const thing = createTestThing({ $type: 'Customer', name: `Customer ${i}` })
        dropNewestBroadcaster.broadcast(createTestEvent('thing.created', thing))
      }

      await vi.advanceTimersByTimeAsync(100)

      const stats = dropNewestBroadcaster.getClientStats(slowClient as unknown as WebSocket)
      expect(stats.droppedCount).toBeGreaterThan(0)

      await dropNewestBroadcaster.close()
    })
  })

  // ==========================================================================
  // MESSAGE COALESCING
  // ==========================================================================

  describe('message coalescing', () => {
    beforeEach(() => {
      broadcaster = new WSBroadcaster({
        eventStore: eventStore as unknown as MockEventStore,
        coalesceWindowMs: 100,
        maxCoalesceDelayMs: 500,
      })
    })

    it('should coalesce rapid updates to same $id', async () => {
      const ws = new MockWebSocket()
      broadcaster.subscribe(ws as unknown as WebSocket, { $id: 'customer_123' })

      const thing = createTestThing({ $id: 'customer_123', $type: 'Customer' })

      // Send rapid updates
      broadcaster.broadcast(createTestEvent('thing.updated', thing, { name: 'Update 1' }))
      broadcaster.broadcast(createTestEvent('thing.updated', thing, { name: 'Update 2' }))
      broadcaster.broadcast(createTestEvent('thing.updated', thing, { name: 'Update 3' }))

      // Within coalesce window, should not send yet
      expect(ws.sentMessages.length).toBe(0)

      // After coalesce window, should send coalesced update
      await vi.advanceTimersByTimeAsync(150)

      // Should have only one message (coalesced)
      expect(ws.sentMessages.length).toBe(1)

      const msg = ws.getLastMessage<BroadcastMessage>()
      expect(msg?.payload?.name).toBe('Update 3') // Latest state
      expect(msg?.coalesced).toBe(true)
      expect(msg?.coalescedCount).toBe(3)
    })

    it('should send only latest state after coalesce window', async () => {
      const ws = new MockWebSocket()
      broadcaster.subscribe(ws as unknown as WebSocket, { $id: 'order_456' })

      const thing = createTestThing({ $id: 'order_456', $type: 'Order' })

      // Send updates with different values
      broadcaster.broadcast(
        createTestEvent('thing.updated', { ...thing, $version: 1 }, { status: 'pending' })
      )
      broadcaster.broadcast(
        createTestEvent('thing.updated', { ...thing, $version: 2 }, { status: 'processing' })
      )
      broadcaster.broadcast(
        createTestEvent('thing.updated', { ...thing, $version: 3 }, { status: 'completed' })
      )

      await vi.advanceTimersByTimeAsync(150)

      const msg = ws.getLastMessage<BroadcastMessage>()
      expect(msg?.payload?.status).toBe('completed')
      expect(msg?.version).toBe(3)
    })

    it('should respect maxCoalesceDelay', async () => {
      const ws = new MockWebSocket()
      broadcaster.subscribe(ws as unknown as WebSocket, { $id: 'customer_max' })

      const thing = createTestThing({ $id: 'customer_max', $type: 'Customer' })

      // Send updates continuously, each resetting the coalesce timer
      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(50) // Less than coalesce window
        broadcaster.broadcast(createTestEvent('thing.updated', thing, { counter: i }))
      }

      // Even though we keep sending, maxCoalesceDelay should force a send
      // Total time: 500ms, which equals maxCoalesceDelayMs
      expect(ws.sentMessages.length).toBeGreaterThan(0)
    })

    it('should not coalesce different $ids', async () => {
      const ws = new MockWebSocket()
      broadcaster.subscribe(ws as unknown as WebSocket, { wildcard: true })

      const thing1 = createTestThing({ $id: 'customer_1', $type: 'Customer' })
      const thing2 = createTestThing({ $id: 'customer_2', $type: 'Customer' })

      broadcaster.broadcast(createTestEvent('thing.updated', thing1, { name: 'One' }))
      broadcaster.broadcast(createTestEvent('thing.updated', thing2, { name: 'Two' }))

      await vi.advanceTimersByTimeAsync(150)

      // Should have two separate messages (different entities)
      expect(ws.sentMessages.length).toBe(2)
    })

    it('should not coalesce different event types', async () => {
      const ws = new MockWebSocket()
      broadcaster.subscribe(ws as unknown as WebSocket, { $id: 'customer_mixed' })

      const thing = createTestThing({ $id: 'customer_mixed', $type: 'Customer' })

      broadcaster.broadcast(createTestEvent('thing.created', thing))
      broadcaster.broadcast(createTestEvent('thing.updated', thing, { name: 'Updated' }))

      await vi.advanceTimersByTimeAsync(150)

      // Create and update are different, should not coalesce
      expect(ws.sentMessages.length).toBe(2)
    })

    it('should allow disabling coalescing per subscription', async () => {
      const ws = new MockWebSocket()
      broadcaster.subscribe(ws as unknown as WebSocket, {
        $id: 'customer_no_coalesce',
        coalesce: false,
      })

      const thing = createTestThing({ $id: 'customer_no_coalesce', $type: 'Customer' })

      broadcaster.broadcast(createTestEvent('thing.updated', thing, { name: 'Update 1' }))
      broadcaster.broadcast(createTestEvent('thing.updated', thing, { name: 'Update 2' }))
      broadcaster.broadcast(createTestEvent('thing.updated', thing, { name: 'Update 3' }))

      await vi.advanceTimersByTimeAsync(150)

      // All three should be sent immediately (no coalescing)
      expect(ws.sentMessages.length).toBe(3)
    })
  })

  // ==========================================================================
  // BACKFILL
  // ==========================================================================

  describe('backfill', () => {
    beforeEach(() => {
      broadcaster = new WSBroadcaster({
        eventStore: eventStore as unknown as MockEventStore,
        defaultBackfillLimit: 10,
      })
    })

    it('should send recent events on subscribe (backfill)', async () => {
      // Pre-populate event store with history
      for (let i = 0; i < 5; i++) {
        const thing = createTestThing({ $type: 'Customer', name: `Customer ${i}` })
        eventStore.addEvent(createTestEvent('thing.created', thing))
      }

      const ws = new MockWebSocket()

      // Subscribe with backfill enabled
      broadcaster.subscribe(ws as unknown as WebSocket, {
        $type: 'Customer',
        backfill: true,
      })

      // Allow async backfill
      await vi.advanceTimersByTimeAsync(10)

      // Should have received historical events
      expect(ws.sentMessages.length).toBe(5)

      const messages = ws.getMessages<BroadcastMessage>()
      expect(messages[0].backfill).toBe(true)
    })

    it('should respect backfill limit', async () => {
      // Pre-populate with many events
      for (let i = 0; i < 100; i++) {
        const thing = createTestThing({ $type: 'Order', name: `Order ${i}` })
        eventStore.addEvent(createTestEvent('thing.created', thing))
      }

      const ws = new MockWebSocket()

      // Subscribe with limited backfill
      broadcaster.subscribe(ws as unknown as WebSocket, {
        $type: 'Order',
        backfill: true,
        backfillLimit: 20,
      })

      await vi.advanceTimersByTimeAsync(10)

      // Should only receive 20 most recent
      expect(ws.sentMessages.length).toBe(20)
    })

    it('should backfill specific $id', async () => {
      // Add events for multiple entities
      for (let i = 0; i < 3; i++) {
        const thing = createTestThing({ $id: 'customer_target', $type: 'Customer' })
        eventStore.addEvent(createTestEvent('thing.updated', thing, { counter: i }))
      }
      for (let i = 0; i < 5; i++) {
        const thing = createTestThing({ $id: 'customer_other', $type: 'Customer' })
        eventStore.addEvent(createTestEvent('thing.updated', thing))
      }

      const ws = new MockWebSocket()

      broadcaster.subscribe(ws as unknown as WebSocket, {
        $id: 'customer_target',
        backfill: true,
      })

      await vi.advanceTimersByTimeAsync(10)

      // Should only receive events for customer_target
      expect(ws.sentMessages.length).toBe(3)
      const messages = ws.getMessages<BroadcastMessage>()
      messages.forEach((msg) => {
        expect(msg.entityId).toBe('customer_target')
      })
    })

    it('should mark backfill messages as historical', async () => {
      const thing = createTestThing({ $type: 'Customer' })
      eventStore.addEvent(createTestEvent('thing.created', thing))

      const ws = new MockWebSocket()

      broadcaster.subscribe(ws as unknown as WebSocket, {
        $type: 'Customer',
        backfill: true,
      })

      await vi.advanceTimersByTimeAsync(10)

      const msg = ws.getLastMessage<BroadcastMessage>()
      expect(msg?.backfill).toBe(true)
      expect(msg?.historical).toBe(true)
    })

    it('should not duplicate events between backfill and live', async () => {
      // Add one historical event
      const historicalThing = createTestThing({ $type: 'Customer', name: 'Historical' })
      eventStore.addEvent(createTestEvent('thing.created', historicalThing))

      const ws = new MockWebSocket()

      // Subscribe with backfill
      broadcaster.subscribe(ws as unknown as WebSocket, {
        $type: 'Customer',
        backfill: true,
      })

      await vi.advanceTimersByTimeAsync(10)

      // Now send a live event
      const liveThing = createTestThing({ $type: 'Customer', name: 'Live' })
      await broadcaster.broadcast(createTestEvent('thing.created', liveThing))

      // Should have 2 messages: 1 backfill + 1 live
      expect(ws.sentMessages.length).toBe(2)

      const messages = ws.getMessages<BroadcastMessage>()
      expect(messages[0].backfill).toBe(true)
      expect(messages[1].backfill).toBeUndefined() // Live message
    })
  })

  // ==========================================================================
  // LIFECYCLE AND CLEANUP
  // ==========================================================================

  describe('lifecycle', () => {
    it('should close gracefully', async () => {
      broadcaster = new WSBroadcaster({
        eventStore: eventStore as unknown as MockEventStore,
      })

      const ws1 = new MockWebSocket()
      const ws2 = new MockWebSocket()

      broadcaster.subscribe(ws1 as unknown as WebSocket, { $type: 'Customer' })
      broadcaster.subscribe(ws2 as unknown as WebSocket, { $type: 'Order' })

      expect(broadcaster.getTotalSubscriptions()).toBe(2)

      await broadcaster.close()

      expect(broadcaster.getTotalSubscriptions()).toBe(0)
      expect(broadcaster.isClosed()).toBe(true)
    })

    it('should reject new subscriptions after close', async () => {
      broadcaster = new WSBroadcaster({
        eventStore: eventStore as unknown as MockEventStore,
      })

      await broadcaster.close()

      const ws = new MockWebSocket()

      expect(() => {
        broadcaster.subscribe(ws as unknown as WebSocket, { $type: 'Customer' })
      }).toThrow(/closed/)
    })

    it('should reject broadcasts after close', async () => {
      broadcaster = new WSBroadcaster({
        eventStore: eventStore as unknown as MockEventStore,
      })

      await broadcaster.close()

      const thing = createTestThing({ $type: 'Customer' })

      await expect(broadcaster.broadcast(createTestEvent('thing.created', thing))).rejects.toThrow(
        /closed/
      )
    })

    it('should flush pending messages on close', async () => {
      broadcaster = new WSBroadcaster({
        eventStore: eventStore as unknown as MockEventStore,
        coalesceWindowMs: 1000, // Long coalesce window
      })

      const ws = new MockWebSocket()
      broadcaster.subscribe(ws as unknown as WebSocket, { $id: 'customer_flush' })

      const thing = createTestThing({ $id: 'customer_flush', $type: 'Customer' })
      broadcaster.broadcast(createTestEvent('thing.updated', thing, { name: 'Pending' }))

      // Message should be pending (coalescing)
      expect(ws.sentMessages.length).toBe(0)

      // Close should flush
      await broadcaster.close()

      // Pending message should have been sent
      expect(ws.sentMessages.length).toBe(1)
    })
  })

  // ==========================================================================
  // STATISTICS AND MONITORING
  // ==========================================================================

  describe('statistics', () => {
    beforeEach(() => {
      broadcaster = new WSBroadcaster({
        eventStore: eventStore as unknown as MockEventStore,
      })
    })

    it('should track subscriber count', async () => {
      const ws1 = new MockWebSocket()
      const ws2 = new MockWebSocket()

      broadcaster.subscribe(ws1 as unknown as WebSocket, { $type: 'Customer' })
      broadcaster.subscribe(ws2 as unknown as WebSocket, { $type: 'Customer' })

      const stats = broadcaster.getStats()
      expect(stats.totalSubscriptions).toBe(2)
      expect(stats.totalClients).toBe(2)
    })

    it('should track broadcast statistics', async () => {
      const ws = new MockWebSocket()
      broadcaster.subscribe(ws as unknown as WebSocket, { $type: 'Customer' })

      for (let i = 0; i < 5; i++) {
        const thing = createTestThing({ $type: 'Customer' })
        await broadcaster.broadcast(createTestEvent('thing.created', thing))
      }

      const stats = broadcaster.getStats()
      expect(stats.totalBroadcasts).toBe(5)
      expect(stats.totalMessagesSent).toBe(5)
    })

    it('should track per-client statistics', async () => {
      const ws = new MockWebSocket()
      broadcaster.subscribe(ws as unknown as WebSocket, { $type: 'Customer' })

      for (let i = 0; i < 3; i++) {
        const thing = createTestThing({ $type: 'Customer' })
        await broadcaster.broadcast(createTestEvent('thing.created', thing))
      }

      const clientStats = broadcaster.getClientStats(ws as unknown as WebSocket)
      expect(clientStats.messagesReceived).toBe(3)
      expect(clientStats.subscriptionCount).toBe(1)
    })

    it('should expose topic-level statistics', async () => {
      const ws1 = new MockWebSocket()
      const ws2 = new MockWebSocket()
      const ws3 = new MockWebSocket()

      broadcaster.subscribe(ws1 as unknown as WebSocket, { $type: 'Customer' })
      broadcaster.subscribe(ws2 as unknown as WebSocket, { $type: 'Customer' })
      broadcaster.subscribe(ws3 as unknown as WebSocket, { $type: 'Order' })

      expect(broadcaster.getSubscriberCount('Customer')).toBe(2)
      expect(broadcaster.getSubscriberCount('Order')).toBe(1)
      expect(broadcaster.getSubscriberCount('Product')).toBe(0)
    })
  })

  // ==========================================================================
  // ERROR HANDLING
  // ==========================================================================

  describe('error handling', () => {
    beforeEach(() => {
      broadcaster = new WSBroadcaster({
        eventStore: eventStore as unknown as MockEventStore,
      })
    })

    it('should handle WebSocket send errors gracefully', async () => {
      const brokenClient = new MockWebSocket()
      broadcaster.subscribe(brokenClient as unknown as WebSocket, { $type: 'Customer' })

      // Make send throw
      brokenClient.send = async () => {
        throw new Error('Network error')
      }

      const thing = createTestThing({ $type: 'Customer' })

      // Should not throw
      await expect(
        broadcaster.broadcast(createTestEvent('thing.created', thing))
      ).resolves.not.toThrow()

      // Client should be marked as errored
      const stats = broadcaster.getClientStats(brokenClient as unknown as WebSocket)
      expect(stats.errorCount).toBeGreaterThan(0)
    })

    it('should remove clients with persistent errors', async () => {
      const flakyClient = new MockWebSocket()
      broadcaster.subscribe(flakyClient as unknown as WebSocket, { $type: 'Customer' })

      let errorCount = 0
      flakyClient.send = async () => {
        errorCount++
        throw new Error('Persistent error')
      }

      // Send multiple messages to trigger error threshold
      for (let i = 0; i < 10; i++) {
        const thing = createTestThing({ $type: 'Customer' })
        await broadcaster.broadcast(createTestEvent('thing.created', thing))
      }

      // Client should be removed after too many errors
      expect(broadcaster.getSubscriptions(flakyClient as unknown as WebSocket).length).toBe(0)
    })

    it('should emit error events for monitoring', async () => {
      const errorEvents: Array<{ client: WebSocket; error: Error }> = []
      broadcaster.onError((client, error) => {
        errorEvents.push({ client: client as WebSocket, error })
      })

      const brokenClient = new MockWebSocket()
      broadcaster.subscribe(brokenClient as unknown as WebSocket, { $type: 'Customer' })

      brokenClient.send = async () => {
        throw new Error('Test error')
      }

      const thing = createTestThing({ $type: 'Customer' })
      await broadcaster.broadcast(createTestEvent('thing.created', thing))

      expect(errorEvents.length).toBeGreaterThan(0)
      expect(errorEvents[0].error.message).toBe('Test error')
    })
  })

  // ==========================================================================
  // INTEGRATION WITH UNIFIED STORE
  // ==========================================================================

  describe('integration scenarios', () => {
    beforeEach(() => {
      broadcaster = new WSBroadcaster({
        eventStore: eventStore as unknown as MockEventStore,
        coalesceWindowMs: 50,
      })
    })

    it('should support typical CRUD notification pattern', async () => {
      const dashboardClient = new MockWebSocket()
      const detailClient = new MockWebSocket()

      // Dashboard watches all Customers
      broadcaster.subscribe(dashboardClient as unknown as WebSocket, { $type: 'Customer' })

      // Detail view watches specific customer
      broadcaster.subscribe(detailClient as unknown as WebSocket, { $id: 'customer_active' })

      // Create
      const customer = createTestThing({
        $id: 'customer_active',
        $type: 'Customer',
        name: 'New Customer',
      })
      await broadcaster.broadcast(createTestEvent('thing.created', customer))

      // Both should receive create
      expect(dashboardClient.sentMessages.length).toBe(1)
      expect(detailClient.sentMessages.length).toBe(1)

      // Update
      await broadcaster.broadcast(
        createTestEvent('thing.updated', { ...customer, $version: 2 }, { name: 'Updated Name' })
      )

      // Wait for coalesce
      await vi.advanceTimersByTimeAsync(100)

      // Both should receive update
      expect(dashboardClient.sentMessages.length).toBe(2)
      expect(detailClient.sentMessages.length).toBe(2)

      // Delete
      await broadcaster.broadcast(createTestEvent('thing.deleted', customer))

      // Both should receive delete
      expect(dashboardClient.sentMessages.length).toBe(3)
      expect(detailClient.sentMessages.length).toBe(3)
    })

    it('should handle high-frequency updates efficiently', async () => {
      const ws = new MockWebSocket()
      broadcaster.subscribe(ws as unknown as WebSocket, { $id: 'counter_entity' })

      const thing = createTestThing({ $id: 'counter_entity', $type: 'Counter' })

      // Send 100 rapid updates
      for (let i = 0; i < 100; i++) {
        broadcaster.broadcast(
          createTestEvent('thing.updated', { ...thing, $version: i + 1 }, { count: i })
        )
      }

      // Wait for coalescing
      await vi.advanceTimersByTimeAsync(100)

      // Should have fewer messages due to coalescing
      expect(ws.sentMessages.length).toBeLessThan(100)

      // Last message should have final count
      const lastMsg = ws.getLastMessage<BroadcastMessage>()
      expect(lastMsg?.payload?.count).toBe(99)
    })

    it('should work with hibernation pattern', async () => {
      // Simulate clients connecting via hibernatable WebSocket
      const clients: MockWebSocket[] = []
      for (let i = 0; i < 10; i++) {
        const ws = new MockWebSocket()
        clients.push(ws)
        broadcaster.subscribe(ws as unknown as WebSocket, { $type: 'Notification' })
      }

      // Broadcast while active
      const notification = createTestThing({ $type: 'Notification', message: 'Alert!' })
      await broadcaster.broadcast(createTestEvent('thing.created', notification))

      // All should receive
      for (const client of clients) {
        expect(client.sentMessages.length).toBe(1)
      }

      // Simulate some clients disconnecting (hibernation)
      for (let i = 0; i < 5; i++) {
        clients[i].simulateDisconnect()
        broadcaster.handleDisconnect(clients[i] as unknown as WebSocket)
      }

      // Broadcast again
      const notification2 = createTestThing({ $type: 'Notification', message: 'Update!' })
      await broadcaster.broadcast(createTestEvent('thing.created', notification2))

      // Only remaining clients should receive
      for (let i = 0; i < 5; i++) {
        expect(clients[i].sentMessages.length).toBe(1) // Still just the first message
      }
      for (let i = 5; i < 10; i++) {
        expect(clients[i].sentMessages.length).toBe(2) // Both messages
      }
    })
  })
})
