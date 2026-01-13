/**
 * SyncEngine Heartbeat and Connection Management Tests
 *
 * Tests for:
 * - Server-side heartbeat ping/pong
 * - Connection timeout detection
 * - Connection state events
 * - Connection metrics
 *
 * @module objects/tests/sync-engine-heartbeat.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SyncEngine, type ConnectionStateEvent } from '../transport/sync-engine'
import { ThingsStore, type StoreContext } from '../../db/stores'

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

interface MockWebSocket {
  send: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  readyState: number
  onmessage?: (event: { data: string }) => void
  onclose?: () => void
  onerror?: () => void
}

function createMockSocket(): MockWebSocket {
  const socket: MockWebSocket = {
    send: vi.fn(),
    close: vi.fn(),
    addEventListener: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (event === 'message') {
        socket.onmessage = handler as MockWebSocket['onmessage']
      } else if (event === 'close') {
        socket.onclose = handler as MockWebSocket['onclose']
      } else if (event === 'error') {
        socket.onerror = handler as MockWebSocket['onerror']
      }
    }),
    removeEventListener: vi.fn(),
    readyState: 1, // WebSocket.OPEN
  }
  return socket
}

// ============================================================================
// TESTS: Heartbeat Management
// ============================================================================

describe('SyncEngine heartbeat', () => {
  let mockStoreContext: StoreContext
  let thingsStore: ThingsStore
  let syncEngine: SyncEngine

  beforeEach(() => {
    vi.useFakeTimers()
    mockStoreContext = {
      db: {} as any,
      ns: 'test.example.com',
      currentBranch: 'main',
      env: {},
      typeCache: new Map(),
    }

    thingsStore = new ThingsStore(mockStoreContext)
    syncEngine = new SyncEngine(thingsStore)
  })

  afterEach(() => {
    syncEngine.stopHeartbeat()
    vi.useRealTimers()
  })

  describe('startHeartbeat()', () => {
    it('should send ping messages to all connections periodically', async () => {
      const socket = createMockSocket()
      syncEngine.accept(socket as unknown as WebSocket)
      syncEngine.startHeartbeat()

      // Advance time by 30 seconds (heartbeat interval)
      await vi.advanceTimersByTimeAsync(30000)

      expect(socket.send).toHaveBeenCalled()
      const message = JSON.parse(socket.send.mock.calls[0][0])
      expect(message.type).toBe('ping')
      expect(typeof message.timestamp).toBe('number')
    })

    it('should send pings to multiple connections', async () => {
      const socket1 = createMockSocket()
      const socket2 = createMockSocket()

      syncEngine.accept(socket1 as unknown as WebSocket)
      syncEngine.accept(socket2 as unknown as WebSocket)
      syncEngine.startHeartbeat()

      await vi.advanceTimersByTimeAsync(30000)

      expect(socket1.send).toHaveBeenCalled()
      expect(socket2.send).toHaveBeenCalled()
    })

    it('should not start multiple heartbeat intervals', () => {
      const socket = createMockSocket()
      syncEngine.accept(socket as unknown as WebSocket)

      syncEngine.startHeartbeat()
      syncEngine.startHeartbeat() // Second call should be no-op

      vi.advanceTimersByTime(30000)

      // Should only have received one ping
      expect(socket.send).toHaveBeenCalledTimes(1)
    })
  })

  describe('stopHeartbeat()', () => {
    it('should stop sending ping messages', async () => {
      const socket = createMockSocket()
      syncEngine.accept(socket as unknown as WebSocket)
      syncEngine.startHeartbeat()

      // First interval
      await vi.advanceTimersByTimeAsync(30000)
      expect(socket.send).toHaveBeenCalledTimes(1)

      // Simulate pong to allow next ping
      socket.onmessage?.({ data: JSON.stringify({ type: 'pong', timestamp: Date.now() }) })

      syncEngine.stopHeartbeat()

      // Second interval - should not trigger
      await vi.advanceTimersByTimeAsync(30000)
      expect(socket.send).toHaveBeenCalledTimes(1) // Still just 1
    })
  })

  describe('pong handling', () => {
    it('should handle pong messages and update lastPongAt', async () => {
      const socket = createMockSocket()
      syncEngine.accept(socket as unknown as WebSocket)
      syncEngine.startHeartbeat()

      // Send ping
      await vi.advanceTimersByTimeAsync(30000)
      expect(socket.send).toHaveBeenCalledTimes(1)

      // Send pong response
      socket.onmessage?.({ data: JSON.stringify({ type: 'pong', timestamp: Date.now() }) })

      // Advance time - should send another ping since pong was received
      await vi.advanceTimersByTimeAsync(30000)
      expect(socket.send).toHaveBeenCalledTimes(2)
    })

    it('should not send ping if previous ping has no pong response', async () => {
      const socket = createMockSocket()
      syncEngine.accept(socket as unknown as WebSocket)
      syncEngine.startHeartbeat()

      // Send first ping
      await vi.advanceTimersByTimeAsync(30000)
      expect(socket.send).toHaveBeenCalledTimes(1)

      // Don't respond with pong - next interval should NOT send another ping
      await vi.advanceTimersByTimeAsync(30000)
      expect(socket.send).toHaveBeenCalledTimes(1) // Still just 1
    })
  })
})

// ============================================================================
// TESTS: Connection Timeout Detection
// ============================================================================

describe('SyncEngine connection timeout', () => {
  let mockStoreContext: StoreContext
  let thingsStore: ThingsStore
  let syncEngine: SyncEngine

  beforeEach(() => {
    vi.useFakeTimers()
    mockStoreContext = {
      db: {} as any,
      ns: 'test.example.com',
      currentBranch: 'main',
      env: {},
      typeCache: new Map(),
    }

    thingsStore = new ThingsStore(mockStoreContext)
    syncEngine = new SyncEngine(thingsStore)
  })

  afterEach(() => {
    syncEngine.stopHeartbeat()
    vi.useRealTimers()
  })

  it('should detect and close timed-out connections', async () => {
    const socket = createMockSocket()
    syncEngine.accept(socket as unknown as WebSocket)
    syncEngine.startHeartbeat()

    expect(syncEngine.getActiveConnections()).toBe(1)

    // Advance time past the timeout (45 seconds)
    // Need to advance past heartbeat interval (30s) + timeout check (45s)
    await vi.advanceTimersByTimeAsync(30000) // First heartbeat
    await vi.advanceTimersByTimeAsync(30000) // Second heartbeat - will check timeout

    // Connection should be closed due to timeout (no pong received)
    expect(socket.close).toHaveBeenCalledWith(4000, 'Connection timeout')
  })

  it('should emit timeout event before closing', async () => {
    const socket = createMockSocket()
    syncEngine.accept(socket as unknown as WebSocket)

    const events: ConnectionStateEvent[] = []
    syncEngine.onConnectionState((event) => events.push(event))

    syncEngine.startHeartbeat()

    // Advance time past timeout
    await vi.advanceTimersByTimeAsync(30000)
    await vi.advanceTimersByTimeAsync(30000)

    const timeoutEvent = events.find((e) => e.type === 'timeout')
    expect(timeoutEvent).toBeDefined()
    expect(timeoutEvent?.type).toBe('timeout')
  })

  it('should not timeout connections that respond to pings', async () => {
    const socket = createMockSocket()
    syncEngine.accept(socket as unknown as WebSocket)
    syncEngine.startHeartbeat()

    // First heartbeat
    await vi.advanceTimersByTimeAsync(30000)
    socket.onmessage?.({ data: JSON.stringify({ type: 'pong', timestamp: Date.now() }) })

    // Second heartbeat
    await vi.advanceTimersByTimeAsync(30000)
    socket.onmessage?.({ data: JSON.stringify({ type: 'pong', timestamp: Date.now() }) })

    // Connection should still be active
    expect(syncEngine.getActiveConnections()).toBe(1)
    expect(socket.close).not.toHaveBeenCalled()
  })
})

// ============================================================================
// TESTS: Connection State Events
// ============================================================================

describe('SyncEngine connection state events', () => {
  let mockStoreContext: StoreContext
  let thingsStore: ThingsStore
  let syncEngine: SyncEngine

  beforeEach(() => {
    mockStoreContext = {
      db: {} as any,
      ns: 'test.example.com',
      currentBranch: 'main',
      env: {},
      typeCache: new Map(),
    }

    thingsStore = new ThingsStore(mockStoreContext)
    syncEngine = new SyncEngine(thingsStore)
  })

  it('should emit connected event when connection is accepted', () => {
    const events: ConnectionStateEvent[] = []
    syncEngine.onConnectionState((event) => events.push(event))

    const socket = createMockSocket()
    syncEngine.accept(socket as unknown as WebSocket)

    expect(events.length).toBe(1)
    expect(events[0].type).toBe('connected')
    expect(events[0]).toHaveProperty('socketId')
  })

  it('should emit disconnected event when connection closes', () => {
    const events: ConnectionStateEvent[] = []
    syncEngine.onConnectionState((event) => events.push(event))

    const socket = createMockSocket()
    syncEngine.accept(socket as unknown as WebSocket)

    // Trigger close event
    socket.onclose?.()

    const disconnectedEvent = events.find((e) => e.type === 'disconnected')
    expect(disconnectedEvent).toBeDefined()
    expect(disconnectedEvent?.type).toBe('disconnected')
    if (disconnectedEvent?.type === 'disconnected') {
      expect(disconnectedEvent.reason).toBe('close')
    }
  })

  it('should emit disconnected event with error reason', () => {
    const events: ConnectionStateEvent[] = []
    syncEngine.onConnectionState((event) => events.push(event))

    const socket = createMockSocket()
    syncEngine.accept(socket as unknown as WebSocket)

    // Trigger error event
    socket.onerror?.()

    const disconnectedEvent = events.find((e) => e.type === 'disconnected')
    expect(disconnectedEvent).toBeDefined()
    if (disconnectedEvent?.type === 'disconnected') {
      expect(disconnectedEvent.reason).toBe('error')
    }
  })

  it('should allow unsubscribing from events', () => {
    const events: ConnectionStateEvent[] = []
    const unsubscribe = syncEngine.onConnectionState((event) => events.push(event))

    const socket1 = createMockSocket()
    syncEngine.accept(socket1 as unknown as WebSocket)
    expect(events.length).toBe(1)

    unsubscribe()

    const socket2 = createMockSocket()
    syncEngine.accept(socket2 as unknown as WebSocket)
    expect(events.length).toBe(1) // No new events after unsubscribe
  })
})

// ============================================================================
// TESTS: Connection Metrics
// ============================================================================

describe('SyncEngine connection metrics', () => {
  let mockStoreContext: StoreContext
  let thingsStore: ThingsStore
  let syncEngine: SyncEngine

  beforeEach(() => {
    mockStoreContext = {
      db: {} as any,
      ns: 'test.example.com',
      currentBranch: 'main',
      env: {},
      typeCache: new Map(),
    }

    thingsStore = new ThingsStore(mockStoreContext)
    syncEngine = new SyncEngine(thingsStore)
  })

  it('should return correct activeConnections count', () => {
    expect(syncEngine.getMetrics().activeConnections).toBe(0)

    const socket1 = createMockSocket()
    syncEngine.accept(socket1 as unknown as WebSocket)
    expect(syncEngine.getMetrics().activeConnections).toBe(1)

    const socket2 = createMockSocket()
    syncEngine.accept(socket2 as unknown as WebSocket)
    expect(syncEngine.getMetrics().activeConnections).toBe(2)

    socket1.onclose?.()
    expect(syncEngine.getMetrics().activeConnections).toBe(1)
  })

  it('should track subscriptions by collection', () => {
    const socket1 = createMockSocket()
    const socket2 = createMockSocket()
    const socket3 = createMockSocket()

    syncEngine.accept(socket1 as unknown as WebSocket)
    syncEngine.accept(socket2 as unknown as WebSocket)
    syncEngine.accept(socket3 as unknown as WebSocket)

    syncEngine.subscribe(socket1 as unknown as WebSocket, 'Task')
    syncEngine.subscribe(socket2 as unknown as WebSocket, 'Task')
    syncEngine.subscribe(socket3 as unknown as WebSocket, 'User')

    const metrics = syncEngine.getMetrics()
    expect(metrics.subscriptionsByCollection.get('Task')).toBe(2)
    expect(metrics.subscriptionsByCollection.get('User')).toBe(1)
    expect(metrics.totalSubscriptions).toBe(3)
  })

  it('should track branch-specific subscriptions separately', () => {
    const socket1 = createMockSocket()
    const socket2 = createMockSocket()

    syncEngine.accept(socket1 as unknown as WebSocket)
    syncEngine.accept(socket2 as unknown as WebSocket)

    syncEngine.subscribe(socket1 as unknown as WebSocket, 'Task', null)
    syncEngine.subscribe(socket2 as unknown as WebSocket, 'Task', 'feature/x')

    const metrics = syncEngine.getMetrics()
    expect(metrics.subscriptionsByCollection.get('Task')).toBe(1)
    expect(metrics.subscriptionsByCollection.get('Task:feature/x')).toBe(1)
    expect(metrics.totalSubscriptions).toBe(2)
  })

  it('should update metrics when subscriptions change', () => {
    const socket = createMockSocket()
    syncEngine.accept(socket as unknown as WebSocket)

    syncEngine.subscribe(socket as unknown as WebSocket, 'Task')
    expect(syncEngine.getMetrics().totalSubscriptions).toBe(1)

    syncEngine.subscribe(socket as unknown as WebSocket, 'User')
    expect(syncEngine.getMetrics().totalSubscriptions).toBe(2)

    syncEngine.unsubscribe(socket as unknown as WebSocket, 'Task')
    expect(syncEngine.getMetrics().totalSubscriptions).toBe(1)
    expect(syncEngine.getMetrics().subscriptionsByCollection.get('Task')).toBeUndefined()
  })
})
