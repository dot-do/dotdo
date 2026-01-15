/**
 * Live Query Memory Leak Tests (TDD - RED Phase)
 *
 * Tests verifying live query subscriptions are properly cleaned up to prevent
 * memory leaks. These tests target potential leak sources:
 *
 * 1. Server-side SyncEngine:
 *    - `connections` Map not cleaned on WebSocket disconnect
 *    - `collectionSubscribers` Map retaining stale references
 *
 * 2. Client-side SyncClient:
 *    - Callback Maps not cleaned on unsubscribe/disconnect
 *    - `pendingSubscriptions` Set not cleared
 *
 * 3. ConnectionManager:
 *    - `connections` Map not cleaned on removeConnection
 *    - `topicIndex` Map retaining stale entries
 *
 * @module db/tanstack/tests/live-query-memory-leak.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSyncEngine, createSyncClient, type SyncEngine, type ThingsStoreLike, type SyncItem } from '../index'

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

/**
 * Mock WebSocket implementation for testing
 */
class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState: number = MockWebSocket.CONNECTING
  url: string
  private listeners: Map<string, Set<EventListenerOrEventListenerObject>> = new Map()
  public sentMessages: string[] = []

  constructor(url: string) {
    this.url = url
    // Auto-open after microtask
    Promise.resolve().then(() => this.simulateOpen())
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set())
    }
    this.listeners.get(type)!.add(listener)
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.get(type)?.delete(listener)
  }

  send(data: string): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open')
    }
    this.sentMessages.push(data)
  }

  close(code?: number, reason?: string): void {
    this.readyState = MockWebSocket.CLOSING
    Promise.resolve().then(() => {
      this.readyState = MockWebSocket.CLOSED
      this.dispatchEvent('close', { code: code ?? 1000, reason, wasClean: true } as CloseEvent)
    })
  }

  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN
    this.dispatchEvent('open', new Event('open'))
  }

  simulateClose(code = 1000, reason = ''): void {
    this.readyState = MockWebSocket.CLOSED
    this.dispatchEvent('close', { code, reason, wasClean: true } as CloseEvent)
  }

  simulateError(): void {
    this.dispatchEvent('error', new Event('error'))
  }

  simulateMessage(data: unknown): void {
    const message = typeof data === 'string' ? data : JSON.stringify(data)
    this.dispatchEvent('message', { data: message } as MessageEvent)
  }

  dispatchEvent(type: string, event: Event | CloseEvent | MessageEvent): void {
    const listeners = this.listeners.get(type)
    if (listeners) {
      for (const listener of listeners) {
        if (typeof listener === 'function') {
          listener(event)
        } else {
          listener.handleEvent(event)
        }
      }
    }
  }

  // Test helper: get listener counts to verify cleanup
  getListenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0
  }
}

/**
 * Create mock ThingsStore
 */
function createMockStore(): ThingsStoreLike {
  const items = new Map<string, SyncItem>()
  return {
    async list() {
      return Array.from(items.values())
    },
    async get(id: string) {
      return items.get(id) ?? null
    },
    async create(data) {
      const id = data.$id ?? `item-${Date.now()}`
      const item: SyncItem = {
        $id: id,
        $type: data.$type ?? 'Thing',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...data,
      }
      items.set(id, item)
      return { item, rowid: items.size }
    },
    async update(id, data) {
      const existing = items.get(id)
      if (!existing) throw new Error(`Item ${id} not found`)
      const updated = { ...existing, ...data, updatedAt: new Date().toISOString() }
      items.set(id, updated)
      return { item: updated, rowid: items.size }
    },
    async delete(id) {
      items.delete(id)
      return { rowid: items.size }
    },
  }
}

// Store mock instances for verification
let mockWebSockets: MockWebSocket[] = []
let originalWebSocket: typeof globalThis.WebSocket

// ============================================================================
// TEST SETUP
// ============================================================================

beforeEach(() => {
  originalWebSocket = globalThis.WebSocket
  mockWebSockets = []

  // @ts-expect-error - Replacing WebSocket with mock
  globalThis.WebSocket = class extends MockWebSocket {
    constructor(url: string) {
      super(url)
      mockWebSockets.push(this)
    }
  }
})

afterEach(() => {
  globalThis.WebSocket = originalWebSocket
  mockWebSockets = []
})

// ============================================================================
// SERVER-SIDE: SyncEngine Memory Leak Tests
// ============================================================================

describe('SyncEngine - Connection Cleanup on Disconnect', () => {
  let syncEngine: SyncEngine
  let store: ThingsStoreLike

  beforeEach(() => {
    store = createMockStore()
    syncEngine = createSyncEngine({ store })
  })

  it('should remove connection from connections Map when WebSocket closes', async () => {
    const mockWs = new MockWebSocket('wss://test.api/sync')

    // Accept connection
    syncEngine.accept(mockWs)
    expect(syncEngine.getActiveConnections()).toBe(1)

    // Close WebSocket
    mockWs.simulateClose()

    // Connection should be removed
    expect(syncEngine.getActiveConnections()).toBe(0)
  })

  it('should remove all subscriptions when WebSocket closes', async () => {
    const mockWs = new MockWebSocket('wss://test.api/sync')
    mockWs.simulateOpen()

    // Accept and subscribe
    syncEngine.accept(mockWs)
    syncEngine.subscribe(mockWs, 'Task')
    syncEngine.subscribe(mockWs, 'User')

    expect(syncEngine.getSubscribers('Task').size).toBe(1)
    expect(syncEngine.getSubscribers('User').size).toBe(1)

    // Close WebSocket
    mockWs.simulateClose()

    // All subscriptions should be removed
    expect(syncEngine.getSubscribers('Task').size).toBe(0)
    expect(syncEngine.getSubscribers('User').size).toBe(0)
  })

  it('should handle WebSocket error by cleaning up connection', async () => {
    const mockWs = new MockWebSocket('wss://test.api/sync')

    syncEngine.accept(mockWs)
    expect(syncEngine.getActiveConnections()).toBe(1)

    // Simulate error
    mockWs.simulateError()

    // Connection should be cleaned up
    expect(syncEngine.getActiveConnections()).toBe(0)
  })

  it('should expose getMemoryStats() for monitoring connection leaks', () => {
    // This test verifies the SyncEngine exposes memory stats for monitoring
    // Currently this method doesn't exist - needs implementation

    const mockWs1 = new MockWebSocket('wss://test.api/sync')
    const mockWs2 = new MockWebSocket('wss://test.api/sync')
    mockWs1.simulateOpen()
    mockWs2.simulateOpen()

    syncEngine.accept(mockWs1)
    syncEngine.accept(mockWs2)
    syncEngine.subscribe(mockWs1, 'Task')
    syncEngine.subscribe(mockWs2, 'Task')

    // @ts-expect-error - getMemoryStats() doesn't exist yet
    const stats = syncEngine.getMemoryStats()

    expect(stats).toHaveProperty('connections')
    expect(stats).toHaveProperty('subscriptions')
    expect(stats.connections).toBe(2)
    expect(stats.subscriptions).toBe(2)
  })

  it('should not leak memory after rapid connect/disconnect cycles', async () => {
    // Simulate rapid connections and disconnections
    for (let i = 0; i < 100; i++) {
      const mockWs = new MockWebSocket(`wss://test.api/sync-${i}`)
      mockWs.simulateOpen()

      syncEngine.accept(mockWs)
      syncEngine.subscribe(mockWs, 'Task')
      syncEngine.subscribe(mockWs, 'User')

      // Immediately disconnect
      mockWs.simulateClose()
    }

    // All connections should be cleaned up
    expect(syncEngine.getActiveConnections()).toBe(0)
    expect(syncEngine.getSubscribers('Task').size).toBe(0)
    expect(syncEngine.getSubscribers('User').size).toBe(0)
  })

  it('should clean up empty subscription Sets from collectionSubscribers Map', async () => {
    const mockWs = new MockWebSocket('wss://test.api/sync')
    mockWs.simulateOpen()

    syncEngine.accept(mockWs)
    syncEngine.subscribe(mockWs, 'UniqueCollection')

    expect(syncEngine.getSubscribers('UniqueCollection').size).toBe(1)

    // Unsubscribe
    syncEngine.unsubscribe(mockWs, 'UniqueCollection')

    // Empty Set should be removed from Map, not just emptied
    // This verifies we don't accumulate empty Sets for abandoned collections
    // @ts-expect-error - accessing internal state for verification
    const hasCollection = syncEngine._collectionSubscribers?.has('UniqueCollection') ?? false
    expect(hasCollection).toBe(false)
  })
})

describe('SyncEngine - Subscription Reference Cleanup', () => {
  let syncEngine: SyncEngine
  let store: ThingsStoreLike

  beforeEach(() => {
    store = createMockStore()
    syncEngine = createSyncEngine({ store })
  })

  it('should remove subscription from both connection state and collectionSubscribers', async () => {
    const mockWs = new MockWebSocket('wss://test.api/sync')
    mockWs.simulateOpen()

    syncEngine.accept(mockWs)
    syncEngine.subscribe(mockWs, 'Task')

    // Verify subscription exists
    expect(syncEngine.getSubscribers('Task').size).toBe(1)

    // Unsubscribe
    syncEngine.unsubscribe(mockWs, 'Task')

    // Verify removed from collectionSubscribers
    expect(syncEngine.getSubscribers('Task').size).toBe(0)

    // Verify removed from connection state (won't broadcast to this socket)
    syncEngine.broadcast('Task', {
      type: 'insert',
      collection: 'Task',
      key: 'test-1',
      data: { $id: 'test-1', $type: 'Task', createdAt: '', updatedAt: '' },
      txid: 1,
    })

    // Socket should NOT have received the broadcast
    expect(mockWs.sentMessages).toHaveLength(0)
  })

  it('should handle unsubscribe for non-existent subscription gracefully', async () => {
    const mockWs = new MockWebSocket('wss://test.api/sync')
    mockWs.simulateOpen()

    syncEngine.accept(mockWs)

    // Unsubscribe without subscribing first - should not throw
    expect(() => syncEngine.unsubscribe(mockWs, 'NonExistent')).not.toThrow()
  })

  it('should not leak WeakRef or other references to closed sockets', async () => {
    // Create sockets and let them be garbage collected
    const weakRefs: WeakRef<MockWebSocket>[] = []

    for (let i = 0; i < 10; i++) {
      const mockWs = new MockWebSocket(`wss://test.api/sync-${i}`)
      mockWs.simulateOpen()
      weakRefs.push(new WeakRef(mockWs))

      syncEngine.accept(mockWs)
      syncEngine.subscribe(mockWs, 'Task')
      mockWs.simulateClose()
    }

    // Force GC if available (V8-specific)
    if (global.gc) {
      global.gc()
    }

    // After cleanup, connections should be gone
    expect(syncEngine.getActiveConnections()).toBe(0)
  })
})

// ============================================================================
// CLIENT-SIDE: SyncClient Memory Leak Tests
// ============================================================================

describe('SyncClient - Callback Cleanup on Disconnect', () => {
  it('should clear all callbacks when disconnect() is called', async () => {
    const client = createSyncClient({ url: 'wss://test.api/sync' })

    // Register callbacks
    const unsubInitial = client.onInitial('Task', () => {})
    const unsubChange = client.onChange('Task', () => {})
    const unsubSync = client.onSync(() => {})
    const unsubDisconnect = client.onDisconnect(() => {})

    await client.connect()
    await vi.waitFor(() => mockWebSockets.length > 0)

    // Disconnect
    client.disconnect()

    // After disconnect, callbacks should be cleared or ineffective
    // Currently SyncClient keeps callbacks - this test will FAIL
    // indicating we need a clearCallbacks() method or automatic cleanup

    // @ts-expect-error - accessing internals for verification
    const callbackStats = client.getCallbackStats?.() ?? { total: -1 }
    expect(callbackStats.total).toBe(0)
  })

  it('should clear pendingSubscriptions when disconnect() is called', async () => {
    const client = createSyncClient({ url: 'wss://test.api/sync' })

    await client.connect()
    await vi.waitFor(() => mockWebSockets.length > 0)

    client.subscribe('Task')
    client.subscribe('User')

    // Disconnect
    client.disconnect()

    // pendingSubscriptions should be cleared
    // @ts-expect-error - accessing internals
    const pendingCount = client._pendingSubscriptions?.size ?? -1
    expect(pendingCount).toBe(0)
  })

  it('should not accumulate callbacks after repeated subscribe/unsubscribe', async () => {
    const client = createSyncClient({ url: 'wss://test.api/sync' })

    await client.connect()
    await vi.waitFor(() => mockWebSockets.length > 0)

    // Repeated subscribe/callback registration
    const callbacks: Array<() => void> = []
    for (let i = 0; i < 100; i++) {
      callbacks.push(client.onInitial('Task', () => {}))
      callbacks.push(client.onChange('Task', () => {}))
    }

    // Unsubscribe all
    for (const unsub of callbacks) {
      unsub()
    }

    // Callbacks should be cleaned up
    // @ts-expect-error - accessing internals
    const initialCallbackCount = client._initialCallbacks?.get('Task')?.size ?? 0
    // @ts-expect-error - accessing internals
    const changeCallbackCount = client._changeCallbacks?.get('Task')?.size ?? 0

    expect(initialCallbackCount).toBe(0)
    expect(changeCallbackCount).toBe(0)

    client.disconnect()
  })

  it('should expose getMemoryStats() for monitoring callback leaks', async () => {
    const client = createSyncClient({ url: 'wss://test.api/sync' })

    await client.connect()
    await vi.waitFor(() => mockWebSockets.length > 0)

    client.onInitial('Task', () => {})
    client.onChange('Task', () => {})
    client.onSync(() => {})

    // @ts-expect-error - getMemoryStats() doesn't exist yet
    const stats = client.getMemoryStats()

    expect(stats).toHaveProperty('initialCallbacks')
    expect(stats).toHaveProperty('changeCallbacks')
    expect(stats).toHaveProperty('syncCallbacks')
    expect(stats).toHaveProperty('pendingSubscriptions')

    client.disconnect()
  })
})

describe('SyncClient - Memory Growth Prevention', () => {
  it('should not grow memory after connect/subscribe/unsubscribe/disconnect cycles', async () => {
    // Run multiple cycles and verify no memory growth
    for (let cycle = 0; cycle < 50; cycle++) {
      const client = createSyncClient({ url: 'wss://test.api/sync' })

      await client.connect()
      await vi.waitFor(() => mockWebSockets.length > cycle)

      // Subscribe and add callbacks
      client.subscribe('Task')
      const unsub1 = client.onInitial('Task', () => {})
      const unsub2 = client.onChange('Task', () => {})

      // Clean up
      unsub1()
      unsub2()
      client.unsubscribe('Task')
      client.disconnect()
    }

    // Wait for all microtasks to complete (MockWebSocket.close() uses Promise.resolve())
    await new Promise(resolve => setTimeout(resolve, 0))

    // After all cycles, there should be no leaked resources
    // This is hard to verify without internal access, but we can check
    // that all WebSockets are properly closed
    expect(mockWebSockets.every(ws => ws.readyState === MockWebSocket.CLOSED)).toBe(true)
  })

  it('should clean up callback Maps when collection has no more callbacks', async () => {
    const client = createSyncClient({ url: 'wss://test.api/sync' })

    await client.connect()
    await vi.waitFor(() => mockWebSockets.length > 0)

    // Add and remove callbacks
    const unsub1 = client.onInitial('TemporaryCollection', () => {})
    const unsub2 = client.onChange('TemporaryCollection', () => {})

    unsub1()
    unsub2()

    // Empty callback Sets should be removed from Maps
    // @ts-expect-error - accessing internals
    const hasInitialCallbacks = client._initialCallbacks?.has('TemporaryCollection') ?? true
    // @ts-expect-error - accessing internals
    const hasChangeCallbacks = client._changeCallbacks?.has('TemporaryCollection') ?? true

    expect(hasInitialCallbacks).toBe(false)
    expect(hasChangeCallbacks).toBe(false)

    client.disconnect()
  })
})

// ============================================================================
// CLIENT-SIDE: Reconnection Memory Tests
// ============================================================================

describe('SyncClient - Reconnection Memory Management', () => {
  it('should not accumulate callbacks across reconnections', async () => {
    const client = createSyncClient({ url: 'wss://test.api/sync' })

    // Register callback once
    const callback = vi.fn()
    client.onInitial('Task', callback)

    // Simulate multiple reconnections
    for (let i = 0; i < 5; i++) {
      await client.connect()
      await vi.waitFor(() => mockWebSockets.length > i)

      const ws = mockWebSockets[i]
      ws.simulateMessage({
        type: 'initial',
        collection: 'Task',
        branch: null,
        data: [{ $id: '1', $type: 'Task', createdAt: '', updatedAt: '' }],
        txid: i,
      })

      // Simulate disconnect (will trigger reconnect)
      ws.simulateClose(1006, 'Connection lost')
    }

    // Callback should only be registered once, not accumulated
    // Each initial message should trigger exactly one callback call
    expect(callback).toHaveBeenCalledTimes(5) // Once per reconnection

    // But internal callback Set should still have only 1 entry
    // @ts-expect-error - accessing internals
    const callbackCount = client._initialCallbacks?.get('Task')?.size ?? -1
    expect(callbackCount).toBe(1)

    client.disconnect()
  })

  it('should clean up reconnect timers on disconnect', async () => {
    const client = createSyncClient({ url: 'wss://test.api/sync' })

    await client.connect()
    await vi.waitFor(() => mockWebSockets.length > 0)

    // Trigger reconnection
    mockWebSockets[0].simulateClose(1006, 'Unexpected close')

    // Immediately disconnect
    client.disconnect()

    // Should not have pending reconnect timers
    // @ts-expect-error - accessing internals
    const reconnectTimer = client._reconnectTimer ?? null
    expect(reconnectTimer).toBeNull()
  })
})

// ============================================================================
// INTEGRATION: Full Lifecycle Memory Tests
// ============================================================================

describe('Live Query - Full Lifecycle Memory Test', () => {
  it('should have zero memory leaks after complete lifecycle', async () => {
    const store = createMockStore()
    const syncEngine = createSyncEngine({ store })

    // Client connects
    const mockWs = new MockWebSocket('wss://test.api/sync')
    mockWs.simulateOpen()

    syncEngine.accept(mockWs)
    syncEngine.subscribe(mockWs, 'Task')
    syncEngine.subscribe(mockWs, 'User')

    // Broadcast some messages
    for (let i = 0; i < 10; i++) {
      syncEngine.broadcast('Task', {
        type: 'insert',
        collection: 'Task',
        key: `task-${i}`,
        data: { $id: `task-${i}`, $type: 'Task', createdAt: '', updatedAt: '' },
        txid: i,
      })
    }

    // Unsubscribe
    syncEngine.unsubscribe(mockWs, 'Task')
    syncEngine.unsubscribe(mockWs, 'User')

    // Disconnect
    mockWs.simulateClose()

    // Verify complete cleanup
    expect(syncEngine.getActiveConnections()).toBe(0)
    expect(syncEngine.getSubscribers('Task').size).toBe(0)
    expect(syncEngine.getSubscribers('User').size).toBe(0)

    // @ts-expect-error - verify internal Maps are clean
    const connectionMapSize = syncEngine._connections?.size ?? -1
    // @ts-expect-error - verify internal Maps are clean
    const subscriberMapSize = syncEngine._collectionSubscribers?.size ?? -1

    expect(connectionMapSize).toBe(0)
    expect(subscriberMapSize).toBe(0)
  })

  it('should clean up all resources when client abruptly disconnects without unsubscribe', async () => {
    const store = createMockStore()
    const syncEngine = createSyncEngine({ store })

    // Multiple clients connect and subscribe
    const sockets: MockWebSocket[] = []
    for (let i = 0; i < 5; i++) {
      const ws = new MockWebSocket(`wss://test.api/sync-${i}`)
      ws.simulateOpen()
      sockets.push(ws)

      syncEngine.accept(ws)
      syncEngine.subscribe(ws, 'Task')
      syncEngine.subscribe(ws, 'User')
    }

    expect(syncEngine.getActiveConnections()).toBe(5)
    expect(syncEngine.getSubscribers('Task').size).toBe(5)

    // Abruptly close all sockets WITHOUT explicit unsubscribe
    for (const ws of sockets) {
      ws.simulateClose()
    }

    // All resources should still be cleaned up
    expect(syncEngine.getActiveConnections()).toBe(0)
    expect(syncEngine.getSubscribers('Task').size).toBe(0)
    expect(syncEngine.getSubscribers('User').size).toBe(0)
  })
})

// ============================================================================
// WeakRef/FinalizationRegistry Tests (Advanced Memory Management)
// ============================================================================

describe('SyncEngine - WeakRef Usage for Subscription Cleanup', () => {
  it('should use WeakRef for socket references to allow GC', async () => {
    // This test verifies the SyncEngine uses WeakRef for socket storage
    // to allow garbage collection when sockets are closed but references remain

    const store = createMockStore()
    const syncEngine = createSyncEngine({ store })

    // @ts-expect-error - check if WeakRef is used
    const usesWeakRef = syncEngine._usesWeakRef ?? false

    // This will FAIL initially - indicates we should implement WeakRef storage
    expect(usesWeakRef).toBe(true)
  })

  it('should register FinalizationRegistry for automatic cleanup', async () => {
    // This test verifies the SyncEngine uses FinalizationRegistry
    // for automatic cleanup when sockets are garbage collected

    const store = createMockStore()
    const syncEngine = createSyncEngine({ store })

    // @ts-expect-error - check if FinalizationRegistry is used
    const hasFinalizationRegistry = syncEngine._hasFinalizationRegistry ?? false

    // This will FAIL initially - indicates we should implement FinalizationRegistry
    expect(hasFinalizationRegistry).toBe(true)
  })
})

// ============================================================================
// Stress Test for Memory Leaks
// ============================================================================

describe('SyncEngine - Memory Stress Test', () => {
  it('should handle 1000 rapid subscribe/unsubscribe cycles without leaks', async () => {
    const store = createMockStore()
    const syncEngine = createSyncEngine({ store })

    const mockWs = new MockWebSocket('wss://test.api/sync')
    mockWs.simulateOpen()
    syncEngine.accept(mockWs)

    // Rapid subscribe/unsubscribe cycles
    for (let i = 0; i < 1000; i++) {
      const collection = `Collection-${i % 10}`
      syncEngine.subscribe(mockWs, collection)
      syncEngine.unsubscribe(mockWs, collection)
    }

    // All subscriptions should be cleaned up
    for (let i = 0; i < 10; i++) {
      expect(syncEngine.getSubscribers(`Collection-${i}`).size).toBe(0)
    }

    mockWs.simulateClose()
    expect(syncEngine.getActiveConnections()).toBe(0)
  })

  it('should handle 100 concurrent connections without memory leaks', async () => {
    const store = createMockStore()
    const syncEngine = createSyncEngine({ store })

    const sockets: MockWebSocket[] = []

    // Open 100 connections
    for (let i = 0; i < 100; i++) {
      const ws = new MockWebSocket(`wss://test.api/sync-${i}`)
      ws.simulateOpen()
      sockets.push(ws)
      syncEngine.accept(ws)
      syncEngine.subscribe(ws, 'SharedCollection')
    }

    expect(syncEngine.getActiveConnections()).toBe(100)
    expect(syncEngine.getSubscribers('SharedCollection').size).toBe(100)

    // Close all connections
    for (const ws of sockets) {
      ws.simulateClose()
    }

    expect(syncEngine.getActiveConnections()).toBe(0)
    expect(syncEngine.getSubscribers('SharedCollection').size).toBe(0)
  })
})
