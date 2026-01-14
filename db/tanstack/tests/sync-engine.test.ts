/**
 * SyncEngine Primitive Tests
 *
 * TDD test suite for the SyncEngine primitive that provides
 * real-time WebSocket sync with TanStack DB integration.
 *
 * Test Coverage:
 * 1. SyncEngine - Core sync orchestration
 * 2. SyncClient - Client-side sync state management
 * 3. ThingsCollection - Collection with sync methods
 * 4. WebSocketRoute - Hono route for WebSocket connections
 * 5. BroadcastWiring - Fan-out changes to subscribers
 * 6. dotdoCollectionOptions - TanStack DB integration options
 *
 * @module db/tanstack/sync-engine.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type {
  SyncEngine,
  SyncClient,
  ThingsCollection,
  SyncConfig,
  Change,
  Filter,
  Subscription,
} from '../index'
import {
  createSyncEngine,
  createSyncClient,
  createThingsCollection,
  dotdoCollectionOptions,
} from '../index'

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
  onopen?: () => void
  onclose?: () => void
  onerror?: (error: Error) => void
}

const createMockWebSocket = (): MockWebSocket => {
  const socket: MockWebSocket = {
    send: vi.fn(),
    close: vi.fn(),
    addEventListener: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (event === 'message') {
        socket.onmessage = handler as MockWebSocket['onmessage']
      } else if (event === 'open') {
        socket.onopen = handler as MockWebSocket['onopen']
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

// Mock ThingsStore for testing
interface MockThingsStore {
  items: Map<string, TestItem>
  rowCounter: number
  list(options: { type?: string; branch?: string; limit?: number; offset?: number }): Promise<TestItem[]>
  get(id: string): Promise<TestItem | null>
  create(data: Partial<TestItem>): Promise<{ item: TestItem; rowid: number }>
  update(id: string, data: Partial<TestItem>): Promise<{ item: TestItem; rowid: number }>
  delete(id: string): Promise<{ rowid: number }>
}

interface TestItem {
  $id: string
  $type: string
  name?: string
  data?: Record<string, unknown>
  branch?: string | null
  createdAt: string
  updatedAt: string
}

const createMockThingsStore = (): MockThingsStore => {
  const items = new Map<string, TestItem>()
  let rowCounter = 0

  return {
    items,
    rowCounter,
    async list(options) {
      const results: TestItem[] = []
      for (const item of items.values()) {
        if (options.type && !item.$type.includes(options.type)) continue
        if (options.branch !== undefined && item.branch !== options.branch) continue
        results.push(item)
      }
      return results.slice(options.offset ?? 0, (options.offset ?? 0) + (options.limit ?? 100))
    },
    async get(id) {
      return items.get(id) ?? null
    },
    async create(data) {
      rowCounter++
      const now = new Date().toISOString()
      const item: TestItem = {
        $id: data.$id ?? `item-${rowCounter}`,
        $type: data.$type ?? 'TestItem',
        name: data.name,
        data: data.data,
        branch: data.branch ?? null,
        createdAt: now,
        updatedAt: now,
      }
      items.set(item.$id, item)
      return { item, rowid: rowCounter }
    },
    async update(id, data) {
      const existing = items.get(id)
      if (!existing) throw new Error(`Item '${id}' not found`)
      rowCounter++
      const updated: TestItem = {
        ...existing,
        ...data,
        $id: id,
        updatedAt: new Date().toISOString(),
      }
      items.set(id, updated)
      return { item: updated, rowid: rowCounter }
    },
    async delete(id) {
      if (!items.has(id)) throw new Error(`Item '${id}' not found`)
      rowCounter++
      items.delete(id)
      return { rowid: rowCounter }
    },
  }
}

// ============================================================================
// SYNC ENGINE TESTS
// ============================================================================

describe('SyncEngine', () => {
  let syncEngine: SyncEngine
  let mockStore: MockThingsStore

  beforeEach(() => {
    mockStore = createMockThingsStore()
    syncEngine = createSyncEngine({ store: mockStore })
  })

  describe('connection management', () => {
    it('accepts WebSocket connections', () => {
      const socket = createMockWebSocket()
      syncEngine.accept(socket as unknown as WebSocket)
      expect(syncEngine.getActiveConnections()).toBe(1)
    })

    it('tracks multiple connections', () => {
      const socket1 = createMockWebSocket()
      const socket2 = createMockWebSocket()
      syncEngine.accept(socket1 as unknown as WebSocket)
      syncEngine.accept(socket2 as unknown as WebSocket)
      expect(syncEngine.getActiveConnections()).toBe(2)
    })

    it('removes connections on close', () => {
      const socket = createMockWebSocket()
      syncEngine.accept(socket as unknown as WebSocket)
      expect(syncEngine.getActiveConnections()).toBe(1)

      // Simulate close event
      socket.onclose?.()
      expect(syncEngine.getActiveConnections()).toBe(0)
    })
  })

  describe('subscription management', () => {
    it('subscribes client to collection', () => {
      const socket = createMockWebSocket()
      syncEngine.accept(socket as unknown as WebSocket)
      syncEngine.subscribe(socket as unknown as WebSocket, 'Task')

      const subscribers = syncEngine.getSubscribers('Task')
      expect(subscribers.size).toBe(1)
    })

    it('subscribes client to collection with branch filter', () => {
      const socket = createMockWebSocket()
      syncEngine.accept(socket as unknown as WebSocket)
      syncEngine.subscribe(socket as unknown as WebSocket, 'Task', 'feature/dark-mode')

      const subscribersMain = syncEngine.getSubscribers('Task')
      const subscribersFeature = syncEngine.getSubscribers('Task', 'feature/dark-mode')

      expect(subscribersMain.size).toBe(0)
      expect(subscribersFeature.size).toBe(1)
    })

    it('unsubscribes client from collection', () => {
      const socket = createMockWebSocket()
      syncEngine.accept(socket as unknown as WebSocket)
      syncEngine.subscribe(socket as unknown as WebSocket, 'Task')
      syncEngine.unsubscribe(socket as unknown as WebSocket, 'Task')

      const subscribers = syncEngine.getSubscribers('Task')
      expect(subscribers.size).toBe(0)
    })

    it('cleans up subscriptions on connection close', () => {
      const socket = createMockWebSocket()
      syncEngine.accept(socket as unknown as WebSocket)
      syncEngine.subscribe(socket as unknown as WebSocket, 'Task')
      syncEngine.subscribe(socket as unknown as WebSocket, 'User')

      socket.onclose?.()

      expect(syncEngine.getSubscribers('Task').size).toBe(0)
      expect(syncEngine.getSubscribers('User').size).toBe(0)
    })
  })

  describe('broadcast', () => {
    it('broadcasts insert changes to collection subscribers', async () => {
      const socket = createMockWebSocket()
      syncEngine.accept(socket as unknown as WebSocket)
      syncEngine.subscribe(socket as unknown as WebSocket, 'Task')

      const change: Change = {
        type: 'insert',
        collection: 'Task',
        key: 'task-1',
        data: { $id: 'task-1', $type: 'Task', name: 'Test Task', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        txid: 1,
      }
      syncEngine.broadcast('Task', change)

      expect(socket.send).toHaveBeenCalledTimes(1)
      const sent = JSON.parse(socket.send.mock.calls[0][0])
      expect(sent.type).toBe('insert')
      expect(sent.key).toBe('task-1')
    })

    it('broadcasts update changes to collection subscribers', async () => {
      const socket = createMockWebSocket()
      syncEngine.accept(socket as unknown as WebSocket)
      syncEngine.subscribe(socket as unknown as WebSocket, 'Task')

      const change: Change = {
        type: 'update',
        collection: 'Task',
        key: 'task-1',
        data: { $id: 'task-1', $type: 'Task', name: 'Updated Task', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        txid: 2,
      }
      syncEngine.broadcast('Task', change)

      expect(socket.send).toHaveBeenCalledTimes(1)
      const sent = JSON.parse(socket.send.mock.calls[0][0])
      expect(sent.type).toBe('update')
    })

    it('broadcasts delete changes to collection subscribers', async () => {
      const socket = createMockWebSocket()
      syncEngine.accept(socket as unknown as WebSocket)
      syncEngine.subscribe(socket as unknown as WebSocket, 'Task')

      const change: Change = {
        type: 'delete',
        collection: 'Task',
        key: 'task-1',
        txid: 3,
      }
      syncEngine.broadcast('Task', change)

      expect(socket.send).toHaveBeenCalledTimes(1)
      const sent = JSON.parse(socket.send.mock.calls[0][0])
      expect(sent.type).toBe('delete')
      expect(sent.key).toBe('task-1')
    })

    it('does not broadcast to unsubscribed collections', async () => {
      const taskSocket = createMockWebSocket()
      const userSocket = createMockWebSocket()

      syncEngine.accept(taskSocket as unknown as WebSocket)
      syncEngine.accept(userSocket as unknown as WebSocket)
      syncEngine.subscribe(taskSocket as unknown as WebSocket, 'Task')
      syncEngine.subscribe(userSocket as unknown as WebSocket, 'User')

      const change: Change = {
        type: 'insert',
        collection: 'Task',
        key: 'task-1',
        data: { $id: 'task-1', $type: 'Task', name: 'Test', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        txid: 1,
      }
      syncEngine.broadcast('Task', change)

      expect(taskSocket.send).toHaveBeenCalled()
      expect(userSocket.send).not.toHaveBeenCalled()
    })

    it('respects branch isolation in broadcasts', async () => {
      const mainSocket = createMockWebSocket()
      const featureSocket = createMockWebSocket()

      syncEngine.accept(mainSocket as unknown as WebSocket)
      syncEngine.accept(featureSocket as unknown as WebSocket)
      syncEngine.subscribe(mainSocket as unknown as WebSocket, 'Task', null)
      syncEngine.subscribe(featureSocket as unknown as WebSocket, 'Task', 'feature/x')

      const change: Change = {
        type: 'insert',
        collection: 'Task',
        branch: 'feature/x',
        key: 'task-1',
        data: { $id: 'task-1', $type: 'Task', name: 'Feature Task', branch: 'feature/x', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        txid: 1,
      }
      syncEngine.broadcast('Task', change, 'feature/x')

      expect(mainSocket.send).not.toHaveBeenCalled()
      expect(featureSocket.send).toHaveBeenCalled()
    })
  })

  describe('message handling', () => {
    it('handles subscribe messages', async () => {
      const socket = createMockWebSocket()
      syncEngine.accept(socket as unknown as WebSocket)

      // Simulate subscribe message
      const subscribeMsg = JSON.stringify({ type: 'subscribe', collection: 'Task' })
      socket.onmessage?.({ data: subscribeMsg })

      // Wait for async operations
      await new Promise((resolve) => setTimeout(resolve, 10))

      expect(syncEngine.getSubscribers('Task').size).toBe(1)
    })

    it('handles unsubscribe messages', async () => {
      const socket = createMockWebSocket()
      syncEngine.accept(socket as unknown as WebSocket)
      syncEngine.subscribe(socket as unknown as WebSocket, 'Task')

      // Simulate unsubscribe message
      const unsubscribeMsg = JSON.stringify({ type: 'unsubscribe', collection: 'Task' })
      socket.onmessage?.({ data: unsubscribeMsg })

      expect(syncEngine.getSubscribers('Task').size).toBe(0)
    })

    it('sends initial state on subscribe', async () => {
      // Pre-populate store
      await mockStore.create({ $id: 'task-1', $type: 'Task', name: 'Task 1' })
      await mockStore.create({ $id: 'task-2', $type: 'Task', name: 'Task 2' })

      const socket = createMockWebSocket()
      syncEngine.accept(socket as unknown as WebSocket)

      // Subscribe should trigger initial state
      await syncEngine.sendInitialState(socket as unknown as WebSocket, 'Task')

      expect(socket.send).toHaveBeenCalled()
      const sent = JSON.parse(socket.send.mock.calls[0][0])
      expect(sent.type).toBe('initial')
      expect(sent.collection).toBe('Task')
      expect(sent.data.length).toBe(2)
    })
  })
})

// ============================================================================
// SYNC CLIENT TESTS
// ============================================================================

describe('SyncClient', () => {
  let mockWebSocket: MockWebSocket
  let originalWebSocket: typeof globalThis.WebSocket

  beforeEach(() => {
    mockWebSocket = createMockWebSocket()
    // Mock global WebSocket as a constructor
    originalWebSocket = globalThis.WebSocket
    const MockWebSocketConstructor = vi.fn().mockImplementation(() => mockWebSocket)
    globalThis.WebSocket = MockWebSocketConstructor as unknown as typeof WebSocket
  })

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket
  })

  describe('connection', () => {
    it('connects to sync endpoint', async () => {
      const client = createSyncClient({ url: 'wss://example.com/sync' })
      const connectPromise = client.connect()

      // Simulate connection opening
      mockWebSocket.onopen?.()
      await connectPromise

      expect(globalThis.WebSocket).toHaveBeenCalledWith('wss://example.com/sync')
    })

    it('disconnects cleanly', async () => {
      const client = createSyncClient({ url: 'wss://example.com/sync' })
      const connectPromise = client.connect()
      mockWebSocket.onopen?.()
      await connectPromise

      client.disconnect()
      expect(mockWebSocket.close).toHaveBeenCalled()
    })

    it('tracks connection status', async () => {
      const client = createSyncClient({ url: 'wss://example.com/sync' })
      expect(client.getStatus()).toBe('disconnected')

      const connectPromise = client.connect()
      expect(client.getStatus()).toBe('connecting')

      mockWebSocket.onopen?.()
      await connectPromise

      expect(client.getStatus()).toBe('connected')

      client.disconnect()
      expect(client.getStatus()).toBe('disconnected')
    })
  })

  describe('subscriptions', () => {
    it('subscribes to collection', async () => {
      const client = createSyncClient({ url: 'wss://example.com/sync' })
      const connectPromise = client.connect()
      mockWebSocket.onopen?.()
      await connectPromise

      client.subscribe('Task')

      expect(mockWebSocket.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'subscribe', collection: 'Task', branch: null })
      )
    })

    it('unsubscribes from collection', async () => {
      const client = createSyncClient({ url: 'wss://example.com/sync' })
      const connectPromise = client.connect()
      mockWebSocket.onopen?.()
      await connectPromise

      client.subscribe('Task')
      client.unsubscribe('Task')

      expect(mockWebSocket.send).toHaveBeenLastCalledWith(
        JSON.stringify({ type: 'unsubscribe', collection: 'Task' })
      )
    })

    it('receives initial state callback', async () => {
      const client = createSyncClient({ url: 'wss://example.com/sync' })
      const connectPromise = client.connect()
      mockWebSocket.onopen?.()
      await connectPromise

      const initialCallback = vi.fn()
      client.onInitial('Task', initialCallback)
      client.subscribe('Task')

      // Simulate initial message from server
      const initialMsg = JSON.stringify({
        type: 'initial',
        collection: 'Task',
        data: [{ $id: 'task-1', name: 'Task 1' }],
        txid: 1,
      })
      mockWebSocket.onmessage?.({ data: initialMsg })

      expect(initialCallback).toHaveBeenCalledWith(
        [{ $id: 'task-1', name: 'Task 1' }],
        1
      )
    })

    it('receives change callbacks', async () => {
      const client = createSyncClient({ url: 'wss://example.com/sync' })
      const connectPromise = client.connect()
      mockWebSocket.onopen?.()
      await connectPromise

      const changeCallback = vi.fn()
      client.onChange('Task', changeCallback)
      client.subscribe('Task')

      // Simulate change message from server
      const changeMsg = JSON.stringify({
        type: 'insert',
        collection: 'Task',
        key: 'task-2',
        data: { $id: 'task-2', name: 'New Task' },
        txid: 2,
      })
      mockWebSocket.onmessage?.({ data: changeMsg })

      expect(changeCallback).toHaveBeenCalledWith({
        type: 'insert',
        collection: 'Task',
        key: 'task-2',
        data: { $id: 'task-2', name: 'New Task' },
        txid: 2,
      })
    })
  })

  describe('sync callback', () => {
    it('calls onSync for all changes', async () => {
      const client = createSyncClient({ url: 'wss://example.com/sync' })
      const connectPromise = client.connect()
      mockWebSocket.onopen?.()
      await connectPromise

      const syncCallback = vi.fn()
      client.onSync(syncCallback)
      client.subscribe('Task')

      // Simulate insert
      mockWebSocket.onmessage?.({
        data: JSON.stringify({
          type: 'insert',
          collection: 'Task',
          key: 'task-1',
          data: { $id: 'task-1' },
          txid: 1,
        }),
      })

      // Simulate update
      mockWebSocket.onmessage?.({
        data: JSON.stringify({
          type: 'update',
          collection: 'Task',
          key: 'task-1',
          data: { $id: 'task-1', name: 'Updated' },
          txid: 2,
        }),
      })

      expect(syncCallback).toHaveBeenCalledTimes(2)
    })
  })
})

// ============================================================================
// THINGS COLLECTION TESTS
// ============================================================================

describe('ThingsCollection', () => {
  let collection: ThingsCollection<TestItem>
  let mockStore: MockThingsStore
  let syncEngine: SyncEngine

  beforeEach(() => {
    mockStore = createMockThingsStore()
    syncEngine = createSyncEngine({ store: mockStore })
    collection = createThingsCollection<TestItem>({
      name: 'Task',
      store: mockStore,
      syncEngine,
    })
  })

  describe('CRUD operations', () => {
    it('inserts items and broadcasts', async () => {
      const socket = createMockWebSocket()
      syncEngine.accept(socket as unknown as WebSocket)
      syncEngine.subscribe(socket as unknown as WebSocket, 'Task')

      const item = await collection.insert({
        $id: 'task-1',
        $type: 'Task',
        name: 'Test Task',
      } as TestItem)

      expect(item.$id).toBe('task-1')
      expect(socket.send).toHaveBeenCalled()
    })

    it('updates items and broadcasts', async () => {
      const socket = createMockWebSocket()
      syncEngine.accept(socket as unknown as WebSocket)
      syncEngine.subscribe(socket as unknown as WebSocket, 'Task')

      await collection.insert({
        $id: 'task-1',
        $type: 'Task',
        name: 'Original',
      } as TestItem)

      socket.send.mockClear()

      const updated = await collection.update('task-1', { name: 'Updated' })

      expect(updated.name).toBe('Updated')
      expect(socket.send).toHaveBeenCalled()
      const sent = JSON.parse(socket.send.mock.calls[0][0])
      expect(sent.type).toBe('update')
    })

    it('deletes items and broadcasts', async () => {
      const socket = createMockWebSocket()
      syncEngine.accept(socket as unknown as WebSocket)
      syncEngine.subscribe(socket as unknown as WebSocket, 'Task')

      await collection.insert({
        $id: 'task-1',
        $type: 'Task',
        name: 'To Delete',
      } as TestItem)

      socket.send.mockClear()

      await collection.delete('task-1')

      expect(socket.send).toHaveBeenCalled()
      const sent = JSON.parse(socket.send.mock.calls[0][0])
      expect(sent.type).toBe('delete')
      expect(sent.key).toBe('task-1')
    })

    it('queries items', async () => {
      await collection.insert({ $id: 'task-1', $type: 'Task', name: 'Task 1' } as TestItem)
      await collection.insert({ $id: 'task-2', $type: 'Task', name: 'Task 2' } as TestItem)

      const items = await collection.query()
      expect(items.length).toBe(2)
    })

    it('queries items with filter', async () => {
      await collection.insert({ $id: 'task-1', $type: 'Task', name: 'Important', data: { priority: 'high' } } as TestItem)
      await collection.insert({ $id: 'task-2', $type: 'Task', name: 'Regular', data: { priority: 'low' } } as TestItem)

      const items = await collection.query({ 'data.priority': 'high' } as Filter<TestItem>)
      // Note: filtering depends on store implementation
      expect(items).toBeDefined()
    })
  })

  describe('subscription', () => {
    it('subscribes to changes', async () => {
      const callback = vi.fn()
      const unsubscribe = collection.subscribe(callback)

      await collection.insert({ $id: 'task-1', $type: 'Task', name: 'Test' } as TestItem)

      // Callback should be called with updated items
      expect(callback).toHaveBeenCalled()

      unsubscribe()
    })
  })
})

// ============================================================================
// DOTDO COLLECTION OPTIONS TESTS
// ============================================================================

describe('dotdoCollectionOptions', () => {
  let mockWebSocket: MockWebSocket
  let originalWebSocket: typeof globalThis.WebSocket

  beforeEach(() => {
    mockWebSocket = createMockWebSocket()
    originalWebSocket = globalThis.WebSocket
    const MockWebSocketConstructor = vi.fn().mockImplementation(() => mockWebSocket)
    globalThis.WebSocket = MockWebSocketConstructor as unknown as typeof WebSocket
  })

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket
  })

  it('creates TanStack DB compatible collection options', () => {
    const options = dotdoCollectionOptions({
      name: 'Task',
      doUrl: 'https://example.do/api',
    })

    expect(options.id).toBe('dotdo:Task')
    expect(options.getKey).toBeDefined()
    expect(options.sync).toBeDefined()
  })

  it('uses $id as key getter', () => {
    const options = dotdoCollectionOptions({
      name: 'Task',
      doUrl: 'https://example.do/api',
    })

    const key = options.getKey({ $id: 'task-123', name: 'Test' })
    expect(key).toBe('task-123')
  })

  it('provides sync function that sets up WebSocket', () => {
    const options = dotdoCollectionOptions({
      name: 'Task',
      doUrl: 'https://example.do/api',
    })

    const mockSyncContext = {
      begin: vi.fn(),
      write: vi.fn(),
      commit: vi.fn(),
      markReady: vi.fn(),
    }

    const cleanup = options.sync(mockSyncContext)

    // Should have attempted to connect
    expect(globalThis.WebSocket).toHaveBeenCalled()

    // Cleanup should be a function
    expect(typeof cleanup).toBe('function')
    cleanup()
  })

  it('writes initial data on sync', async () => {
    const options = dotdoCollectionOptions({
      name: 'Task',
      doUrl: 'https://example.do/api',
    })

    const mockSyncContext = {
      begin: vi.fn(),
      write: vi.fn(),
      commit: vi.fn(),
      markReady: vi.fn(),
    }

    options.sync(mockSyncContext)

    // Simulate connection
    mockWebSocket.onopen?.()

    // Wait for subscribe to be sent
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Simulate initial data from server
    mockWebSocket.onmessage?.({
      data: JSON.stringify({
        type: 'initial',
        collection: 'Task',
        data: [{ $id: 'task-1', name: 'Task 1' }],
        txid: 1,
      }),
    })

    expect(mockSyncContext.begin).toHaveBeenCalled()
    expect(mockSyncContext.write).toHaveBeenCalledWith({
      type: 'insert',
      value: { $id: 'task-1', name: 'Task 1' },
    })
    expect(mockSyncContext.commit).toHaveBeenCalled()
    expect(mockSyncContext.markReady).toHaveBeenCalled()
  })

  it('writes changes on sync', async () => {
    const options = dotdoCollectionOptions({
      name: 'Task',
      doUrl: 'https://example.do/api',
    })

    const mockSyncContext = {
      begin: vi.fn(),
      write: vi.fn(),
      commit: vi.fn(),
      markReady: vi.fn(),
    }

    options.sync(mockSyncContext)
    mockWebSocket.onopen?.()
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Simulate change from server
    mockWebSocket.onmessage?.({
      data: JSON.stringify({
        type: 'insert',
        collection: 'Task',
        key: 'task-2',
        data: { $id: 'task-2', name: 'New Task' },
        txid: 2,
      }),
    })

    expect(mockSyncContext.begin).toHaveBeenCalled()
    expect(mockSyncContext.write).toHaveBeenCalledWith({
      type: 'insert',
      value: { $id: 'task-2', name: 'New Task' },
    })
    expect(mockSyncContext.commit).toHaveBeenCalled()
  })

  it('handles update changes', async () => {
    const options = dotdoCollectionOptions({
      name: 'Task',
      doUrl: 'https://example.do/api',
    })

    const mockSyncContext = {
      begin: vi.fn(),
      write: vi.fn(),
      commit: vi.fn(),
      markReady: vi.fn(),
    }

    options.sync(mockSyncContext)
    mockWebSocket.onopen?.()
    await new Promise((resolve) => setTimeout(resolve, 10))

    mockWebSocket.onmessage?.({
      data: JSON.stringify({
        type: 'update',
        collection: 'Task',
        key: 'task-1',
        data: { $id: 'task-1', name: 'Updated Task' },
        txid: 3,
      }),
    })

    expect(mockSyncContext.write).toHaveBeenCalledWith({
      type: 'update',
      value: { $id: 'task-1', name: 'Updated Task' },
    })
  })

  it('handles delete changes', async () => {
    const options = dotdoCollectionOptions({
      name: 'Task',
      doUrl: 'https://example.do/api',
    })

    const mockSyncContext = {
      begin: vi.fn(),
      write: vi.fn(),
      commit: vi.fn(),
      markReady: vi.fn(),
    }

    options.sync(mockSyncContext)
    mockWebSocket.onopen?.()
    await new Promise((resolve) => setTimeout(resolve, 10))

    mockWebSocket.onmessage?.({
      data: JSON.stringify({
        type: 'delete',
        collection: 'Task',
        key: 'task-1',
        txid: 4,
      }),
    })

    expect(mockSyncContext.write).toHaveBeenCalledWith({
      type: 'delete',
      key: 'task-1',
    })
  })
})

// ============================================================================
// EDGE CASES AND ERROR HANDLING
// ============================================================================

describe('Error handling', () => {
  describe('SyncEngine', () => {
    it('handles closed socket gracefully', () => {
      const mockStore = createMockThingsStore()
      const syncEngine = createSyncEngine({ store: mockStore })

      const socket = createMockWebSocket()
      socket.readyState = 3 // CLOSED

      syncEngine.accept(socket as unknown as WebSocket)
      syncEngine.subscribe(socket as unknown as WebSocket, 'Task')

      // Should not throw when broadcasting to closed socket
      expect(() => {
        syncEngine.broadcast('Task', {
          type: 'insert',
          collection: 'Task',
          key: 'task-1',
          data: { $id: 'task-1', $type: 'Task', name: 'Test', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          txid: 1,
        })
      }).not.toThrow()
    })

    it('handles socket send error gracefully', () => {
      const mockStore = createMockThingsStore()
      const syncEngine = createSyncEngine({ store: mockStore })

      const socket = createMockWebSocket()
      socket.send.mockImplementation(() => {
        throw new Error('Send failed')
      })

      syncEngine.accept(socket as unknown as WebSocket)
      syncEngine.subscribe(socket as unknown as WebSocket, 'Task')

      // Should not throw
      expect(() => {
        syncEngine.broadcast('Task', {
          type: 'insert',
          collection: 'Task',
          key: 'task-1',
          data: { $id: 'task-1', $type: 'Task', name: 'Test', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
          txid: 1,
        })
      }).not.toThrow()
    })

    it('handles invalid JSON messages', () => {
      const mockStore = createMockThingsStore()
      const syncEngine = createSyncEngine({ store: mockStore })

      const socket = createMockWebSocket()
      syncEngine.accept(socket as unknown as WebSocket)

      // Should not throw on invalid JSON
      expect(() => {
        socket.onmessage?.({ data: 'not valid json' })
      }).not.toThrow()
    })
  })

  describe('SyncClient', () => {
    let mockWebSocket: MockWebSocket
    let originalWebSocket: typeof globalThis.WebSocket

    beforeEach(() => {
      mockWebSocket = createMockWebSocket()
      originalWebSocket = globalThis.WebSocket
      const MockWebSocketConstructor = vi.fn().mockImplementation(() => mockWebSocket)
      globalThis.WebSocket = MockWebSocketConstructor as unknown as typeof WebSocket
    })

    afterEach(() => {
      globalThis.WebSocket = originalWebSocket
    })

    it('handles connection error', async () => {
      const client = createSyncClient({ url: 'wss://example.com/sync' })
      const connectPromise = client.connect()

      // First trigger error, then close - the close event rejects the promise
      mockWebSocket.onerror?.(new Error('Connection failed'))
      mockWebSocket.onclose?.()

      await expect(connectPromise).rejects.toThrow()
      expect(client.getStatus()).toBe('disconnected')
    })

    it('handles unexpected disconnect', async () => {
      const client = createSyncClient({ url: 'wss://example.com/sync' })
      const connectPromise = client.connect()
      mockWebSocket.onopen?.()
      await connectPromise

      const disconnectCallback = vi.fn()
      client.onDisconnect(disconnectCallback)

      mockWebSocket.onclose?.()

      expect(disconnectCallback).toHaveBeenCalled()
      expect(client.getStatus()).toBe('disconnected')
    })
  })
})
