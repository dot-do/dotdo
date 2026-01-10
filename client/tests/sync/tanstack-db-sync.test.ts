/**
 * TanStack DB Sync Integration Tests (RED phase - TDD)
 *
 * Tests for @tanstack/db sync integration with dotdo.
 * These tests define the contract for the createDotdoSync adapter
 * that integrates TanStack DB with dotdo's WebSocket sync infrastructure.
 *
 * Tests are expected to FAIL until the implementation is created.
 *
 * ## Test Cases
 * - Initialize TanStack DB with dotdo sync adapter
 * - Sync local changes to DO storage
 * - Receive remote changes from DO
 * - Conflict resolution (last-write-wins, merge, custom strategies)
 * - Offline persistence with IndexedDB
 * - Sync status indicator (syncing, synced, error)
 * - Partial sync (per-collection)
 * - Initial sync on connect
 * - Delta sync for efficiency
 * - Sync pause/resume
 *
 * ## Expected Adapter Interface
 *
 * ```typescript
 * interface DotdoSyncConfig {
 *   doUrl: string                           // WebSocket URL for DO
 *   collections: string[]                   // Collections to sync
 *   conflictStrategy?: ConflictStrategy     // Default: 'last-write-wins'
 *   offline?: {
 *     enabled: boolean                      // Enable IndexedDB persistence
 *     dbName?: string                       // IndexedDB database name
 *   }
 * }
 *
 * type ConflictStrategy = 'last-write-wins' | 'merge' | ConflictResolver
 * type ConflictResolver = <T>(local: T, remote: T, base?: T) => T
 *
 * interface DotdoSyncAdapter {
 *   // Status
 *   status: SyncStatus
 *   onStatusChange: (handler: (status: SyncStatus) => void) => () => void
 *
 *   // Connection
 *   connect: () => void
 *   disconnect: () => void
 *   isConnected: boolean
 *
 *   // Sync control
 *   pause: () => void
 *   resume: () => void
 *   isPaused: boolean
 *
 *   // Per-collection control
 *   syncCollection: (collection: string) => void
 *   unsyncCollection: (collection: string) => void
 *
 *   // Manual sync
 *   sync: () => Promise<void>
 *
 *   // Integration with useDollar
 *   $: DollarProxy                          // $ proxy from useDollar
 * }
 *
 * type SyncStatus = 'disconnected' | 'connecting' | 'syncing' | 'synced' | 'error'
 *
 * function createDotdoSync(config: DotdoSyncConfig): DotdoSyncAdapter
 * ```
 *
 * @see client/sync/dotdo-sync.ts (implementation to be created)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Import the adapter under test (will fail until implemented)
import { createDotdoSync, type DotdoSyncConfig, type SyncStatus } from '../../sync/dotdo-sync'

// =============================================================================
// Mock WebSocket
// =============================================================================

class MockWebSocket {
  static instances: MockWebSocket[] = []
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3

  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: ((event: { code?: number; reason?: string }) => void) | null = null
  onerror: ((error: Error) => void) | null = null
  readyState = MockWebSocket.CONNECTING

  constructor(public url: string) {
    MockWebSocket.instances.push(this)
  }

  send = vi.fn()
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED
  })

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
    this.onclose?.({ code, reason })
  }

  simulateError(error: Error) {
    this.onerror?.(error)
  }
}

// =============================================================================
// Mock IndexedDB
// =============================================================================

class MockIDBDatabase {
  objectStoreNames = { contains: vi.fn().mockReturnValue(true) }
  transaction = vi.fn().mockReturnValue({
    objectStore: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue({ result: null }),
      put: vi.fn(),
      delete: vi.fn(),
      getAll: vi.fn().mockReturnValue({ result: [] }),
    }),
  })
  close = vi.fn()
}

class MockIndexedDB {
  static databases: Map<string, MockIDBDatabase> = new Map()

  static open(name: string) {
    const request = {
      result: new MockIDBDatabase(),
      onerror: null as ((event: unknown) => void) | null,
      onsuccess: null as ((event: unknown) => void) | null,
      onupgradeneeded: null as ((event: unknown) => void) | null,
    }

    setTimeout(() => {
      MockIndexedDB.databases.set(name, request.result)
      request.onsuccess?.({ target: request })
    }, 0)

    return request
  }

  static deleteDatabase(name: string) {
    MockIndexedDB.databases.delete(name)
    return { onsuccess: null, onerror: null }
  }
}

// =============================================================================
// Test Types
// =============================================================================

interface Task {
  $id: string
  $type: string
  title: string
  completed: boolean
  updatedAt: string
  _version?: number
}

interface User {
  $id: string
  $type: string
  name: string
  email: string
  updatedAt: string
  _version?: number
}

// =============================================================================
// Test Fixtures
// =============================================================================

const createTask = (id: string, title: string, completed = false): Task => ({
  $id: `task-${id}`,
  $type: 'Task',
  title,
  completed,
  updatedAt: new Date().toISOString(),
})

const createUser = (id: string, name: string, email: string): User => ({
  $id: `user-${id}`,
  $type: 'User',
  name,
  email,
  updatedAt: new Date().toISOString(),
})

// =============================================================================
// Test Setup
// =============================================================================

describe('TanStack DB Sync Integration', () => {
  let originalWebSocket: typeof globalThis.WebSocket
  let originalIndexedDB: typeof globalThis.indexedDB

  beforeEach(() => {
    vi.useFakeTimers()
    MockWebSocket.instances = []
    MockIndexedDB.databases.clear()

    // Save and replace globals
    originalWebSocket = globalThis.WebSocket
    originalIndexedDB = globalThis.indexedDB

    // @ts-expect-error - mock WebSocket
    globalThis.WebSocket = MockWebSocket
    // @ts-expect-error - mock IndexedDB
    globalThis.indexedDB = MockIndexedDB
  })

  afterEach(() => {
    vi.useRealTimers()
    globalThis.WebSocket = originalWebSocket
    globalThis.indexedDB = originalIndexedDB
  })

  // ===========================================================================
  // Initialization Tests
  // ===========================================================================

  describe('initialization', () => {
    it('creates a sync adapter with createDotdoSync', () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      expect(adapter).toBeDefined()
      expect(typeof adapter.connect).toBe('function')
      expect(typeof adapter.disconnect).toBe('function')
    })

    it('exposes sync status property', () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      expect(adapter.status).toBe('disconnected')
    })

    it('exposes $ proxy from useDollar', () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      expect(adapter.$).toBeDefined()
      expect(typeof adapter.$.send).toBe('function')
      expect(typeof adapter.$.try).toBe('function')
      expect(typeof adapter.$.do).toBe('function')
    })

    it('accepts multiple collections', () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task', 'User', 'Project'],
      })

      expect(adapter).toBeDefined()
    })

    it('accepts conflict resolution strategy', () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
        conflictStrategy: 'last-write-wins',
      })

      expect(adapter).toBeDefined()
    })

    it('accepts custom conflict resolver function', () => {
      const customResolver = <T>(local: T, remote: T): T => remote

      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
        conflictStrategy: customResolver,
      })

      expect(adapter).toBeDefined()
    })

    it('accepts offline configuration', () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
        offline: {
          enabled: true,
          dbName: 'my-app-offline',
        },
      })

      expect(adapter).toBeDefined()
    })
  })

  // ===========================================================================
  // Connection Tests
  // ===========================================================================

  describe('connection management', () => {
    it('connects to WebSocket on connect()', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      adapter.connect()

      expect(MockWebSocket.instances).toHaveLength(1)
      expect(MockWebSocket.instances[0].url).toContain('wss://example.com/do/123')
    })

    it('updates status to "connecting" when connecting', () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      adapter.connect()

      expect(adapter.status).toBe('connecting')
    })

    it('updates isConnected when WebSocket opens', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      adapter.connect()
      expect(adapter.isConnected).toBe(false)

      MockWebSocket.instances[0].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      expect(adapter.isConnected).toBe(true)
    })

    it('disconnects WebSocket on disconnect()', () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()

      adapter.disconnect()

      expect(MockWebSocket.instances[0].close).toHaveBeenCalled()
      expect(adapter.isConnected).toBe(false)
      expect(adapter.status).toBe('disconnected')
    })

    it('calls onStatusChange when status changes', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      const statusChanges: SyncStatus[] = []
      adapter.onStatusChange((status) => statusChanges.push(status))

      adapter.connect()
      expect(statusChanges).toContain('connecting')

      MockWebSocket.instances[0].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      expect(statusChanges).toContain('syncing')
    })

    it('returns unsubscribe function from onStatusChange', () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      const handler = vi.fn()
      const unsubscribe = adapter.onStatusChange(handler)

      expect(typeof unsubscribe).toBe('function')

      adapter.connect()
      expect(handler).toHaveBeenCalled()

      handler.mockClear()
      unsubscribe()

      adapter.disconnect()
      expect(handler).not.toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Initial Sync Tests
  // ===========================================================================

  describe('initial sync on connect', () => {
    it('sends subscribe message for each collection on connect', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task', 'User'],
      })

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      const ws = MockWebSocket.instances[0]
      const sentMessages = ws.send.mock.calls.map((call: [string]) => JSON.parse(call[0]))

      expect(sentMessages).toContainEqual(
        expect.objectContaining({ type: 'subscribe', collection: 'Task' })
      )
      expect(sentMessages).toContainEqual(
        expect.objectContaining({ type: 'subscribe', collection: 'User' })
      )
    })

    it('receives initial data and populates collections', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      const onData = vi.fn()
      adapter.onInitialData = onData

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()

      const initialTasks = [
        createTask('1', 'Task 1'),
        createTask('2', 'Task 2'),
      ]

      MockWebSocket.instances[0].simulateMessage({
        type: 'initial',
        collection: 'Task',
        items: initialTasks,
        txid: 100,
      })

      await vi.advanceTimersByTimeAsync(0)

      expect(onData).toHaveBeenCalledWith('Task', initialTasks, 100)
    })

    it('updates status to "synced" after receiving all initial data', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()

      MockWebSocket.instances[0].simulateMessage({
        type: 'initial',
        collection: 'Task',
        items: [],
        txid: 0,
      })

      await vi.advanceTimersByTimeAsync(0)

      expect(adapter.status).toBe('synced')
    })

    it('handles multiple collection initial syncs', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task', 'User'],
      })

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()

      // Send initial for Task - should still be syncing
      MockWebSocket.instances[0].simulateMessage({
        type: 'initial',
        collection: 'Task',
        items: [createTask('1', 'Task 1')],
        txid: 100,
      })

      await vi.advanceTimersByTimeAsync(0)
      expect(adapter.status).toBe('syncing')

      // Send initial for User - now should be synced
      MockWebSocket.instances[0].simulateMessage({
        type: 'initial',
        collection: 'User',
        items: [createUser('1', 'John', 'john@example.com')],
        txid: 101,
      })

      await vi.advanceTimersByTimeAsync(0)
      expect(adapter.status).toBe('synced')
    })
  })

  // ===========================================================================
  // Local Changes to DO Tests
  // ===========================================================================

  describe('sync local changes to DO storage', () => {
    it('sends insert message when local item is created', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      const ws = MockWebSocket.instances[0]
      ws.send.mockClear()

      const newTask = createTask('new', 'New Task')
      adapter.syncLocalInsert('Task', newTask)

      const sentMessages = ws.send.mock.calls.map((call: [string]) => JSON.parse(call[0]))
      expect(sentMessages).toContainEqual(
        expect.objectContaining({
          type: 'insert',
          collection: 'Task',
          data: newTask,
        })
      )
    })

    it('sends update message when local item is modified', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      const ws = MockWebSocket.instances[0]
      ws.send.mockClear()

      const updatedTask = createTask('1', 'Updated Task', true)
      adapter.syncLocalUpdate('Task', updatedTask)

      const sentMessages = ws.send.mock.calls.map((call: [string]) => JSON.parse(call[0]))
      expect(sentMessages).toContainEqual(
        expect.objectContaining({
          type: 'update',
          collection: 'Task',
          data: updatedTask,
        })
      )
    })

    it('sends delete message when local item is removed', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      const ws = MockWebSocket.instances[0]
      ws.send.mockClear()

      adapter.syncLocalDelete('Task', 'task-1')

      const sentMessages = ws.send.mock.calls.map((call: [string]) => JSON.parse(call[0]))
      expect(sentMessages).toContainEqual(
        expect.objectContaining({
          type: 'delete',
          collection: 'Task',
          key: 'task-1',
        })
      )
    })

    it('queues changes when offline and sends on reconnect', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
        offline: { enabled: true },
      })

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Disconnect
      MockWebSocket.instances[0].simulateClose()
      await vi.advanceTimersByTimeAsync(0)

      // Make changes while offline
      const newTask = createTask('offline', 'Created Offline')
      adapter.syncLocalInsert('Task', newTask)

      // Reconnect
      adapter.connect()
      vi.advanceTimersByTime(1000)
      MockWebSocket.instances[1].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Should send queued changes
      const ws = MockWebSocket.instances[1]
      const sentMessages = ws.send.mock.calls.map((call: [string]) => JSON.parse(call[0]))
      expect(sentMessages).toContainEqual(
        expect.objectContaining({
          type: 'insert',
          collection: 'Task',
          data: newTask,
        })
      )
    })
  })

  // ===========================================================================
  // Receive Remote Changes Tests
  // ===========================================================================

  describe('receive remote changes from DO', () => {
    it('calls onRemoteInsert when remote insert is received', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      const onRemoteInsert = vi.fn()
      adapter.onRemoteInsert = onRemoteInsert

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      const remoteTask = createTask('remote', 'Remote Task')
      MockWebSocket.instances[0].simulateMessage({
        type: 'insert',
        collection: 'Task',
        key: remoteTask.$id,
        data: remoteTask,
        txid: 200,
      })

      await vi.advanceTimersByTimeAsync(0)

      expect(onRemoteInsert).toHaveBeenCalledWith('Task', remoteTask, 200)
    })

    it('calls onRemoteUpdate when remote update is received', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      const onRemoteUpdate = vi.fn()
      adapter.onRemoteUpdate = onRemoteUpdate

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      const updatedTask = createTask('1', 'Updated by remote', true)
      MockWebSocket.instances[0].simulateMessage({
        type: 'update',
        collection: 'Task',
        key: updatedTask.$id,
        data: updatedTask,
        txid: 201,
      })

      await vi.advanceTimersByTimeAsync(0)

      expect(onRemoteUpdate).toHaveBeenCalledWith('Task', updatedTask, 201)
    })

    it('calls onRemoteDelete when remote delete is received', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      const onRemoteDelete = vi.fn()
      adapter.onRemoteDelete = onRemoteDelete

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      MockWebSocket.instances[0].simulateMessage({
        type: 'delete',
        collection: 'Task',
        key: 'task-1',
        txid: 202,
      })

      await vi.advanceTimersByTimeAsync(0)

      expect(onRemoteDelete).toHaveBeenCalledWith('Task', 'task-1', 202)
    })

    it('filters messages by collection', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'], // Only subscribed to Task
      })

      const onRemoteInsert = vi.fn()
      adapter.onRemoteInsert = onRemoteInsert

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Send a User insert (not subscribed)
      MockWebSocket.instances[0].simulateMessage({
        type: 'insert',
        collection: 'User',
        key: 'user-1',
        data: createUser('1', 'John', 'john@example.com'),
        txid: 300,
      })

      await vi.advanceTimersByTimeAsync(0)

      // Should not call handler for non-subscribed collection
      expect(onRemoteInsert).not.toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Conflict Resolution Tests
  // ===========================================================================

  describe('conflict resolution', () => {
    it('uses last-write-wins by default', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      const onConflict = vi.fn()
      adapter.onConflict = onConflict

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Simulate local change
      const localTask = {
        ...createTask('1', 'Local Title'),
        updatedAt: '2025-01-01T00:00:01.000Z',
        _version: 2,
      }

      // Simulate remote change with later timestamp
      const remoteTask = {
        ...createTask('1', 'Remote Title'),
        updatedAt: '2025-01-01T00:00:02.000Z',
        _version: 3,
      }

      adapter.resolveConflict('Task', localTask, remoteTask)

      expect(onConflict).toHaveBeenCalledWith(
        'Task',
        localTask,
        remoteTask,
        expect.objectContaining({ winner: 'remote' })
      )
    })

    it('uses merge strategy when configured', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
        conflictStrategy: 'merge',
      })

      const onConflict = vi.fn()
      adapter.onConflict = onConflict

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      const localTask = {
        ...createTask('1', 'Task'),
        completed: true,
        updatedAt: '2025-01-01T00:00:01.000Z',
      }

      const remoteTask = {
        ...createTask('1', 'Task Updated'),
        completed: false,
        updatedAt: '2025-01-01T00:00:02.000Z',
      }

      adapter.resolveConflict('Task', localTask, remoteTask)

      // Merge should combine non-conflicting fields
      expect(onConflict).toHaveBeenCalledWith(
        'Task',
        localTask,
        remoteTask,
        expect.objectContaining({
          strategy: 'merge',
          merged: expect.any(Object),
        })
      )
    })

    it('uses custom resolver function when provided', async () => {
      const customResolver = vi.fn(<T>(local: T, remote: T): T => {
        // Custom logic: always prefer local
        return local
      })

      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
        conflictStrategy: customResolver,
      })

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      const localTask = createTask('1', 'Local')
      const remoteTask = createTask('1', 'Remote')

      const resolved = adapter.resolveConflict('Task', localTask, remoteTask)

      expect(customResolver).toHaveBeenCalledWith(localTask, remoteTask, undefined)
      expect(resolved).toEqual(localTask)
    })

    it('provides base version for three-way merge', async () => {
      const threeWayMerge = vi.fn(<T>(local: T, remote: T, base: T | undefined): T => remote)

      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
        conflictStrategy: threeWayMerge,
      })

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      const baseTask = createTask('1', 'Original')
      const localTask = { ...baseTask, title: 'Local Edit' }
      const remoteTask = { ...baseTask, title: 'Remote Edit' }

      adapter.resolveConflict('Task', localTask, remoteTask, baseTask)

      expect(threeWayMerge).toHaveBeenCalledWith(localTask, remoteTask, baseTask)
    })
  })

  // ===========================================================================
  // Offline Persistence Tests
  // ===========================================================================

  describe('offline persistence with IndexedDB', () => {
    it('persists data to IndexedDB when offline enabled', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
        offline: {
          enabled: true,
          dbName: 'test-offline-db',
        },
      })

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Receive initial data
      const tasks = [createTask('1', 'Task 1')]
      MockWebSocket.instances[0].simulateMessage({
        type: 'initial',
        collection: 'Task',
        items: tasks,
        txid: 100,
      })

      await vi.advanceTimersByTimeAsync(100)

      // IndexedDB should have been opened
      expect(MockIndexedDB.databases.has('test-offline-db')).toBe(true)
    })

    it('loads data from IndexedDB on startup', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
        offline: {
          enabled: true,
          dbName: 'test-offline-db',
        },
      })

      const onOfflineData = vi.fn()
      adapter.onOfflineDataLoaded = onOfflineData

      adapter.connect()
      await vi.advanceTimersByTimeAsync(100)

      expect(onOfflineData).toHaveBeenCalled()
    })

    it('stores pending changes in IndexedDB when offline', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
        offline: {
          enabled: true,
          dbName: 'test-offline-db',
        },
      })

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Go offline
      MockWebSocket.instances[0].simulateClose()
      await vi.advanceTimersByTimeAsync(0)

      // Make a change while offline
      const newTask = createTask('offline', 'Offline Task')
      adapter.syncLocalInsert('Task', newTask)

      // Pending changes should be persisted
      expect(adapter.hasPendingChanges()).toBe(true)
    })

    it('syncs pending changes after reconnection', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
        offline: {
          enabled: true,
          dbName: 'test-offline-db',
        },
      })

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Go offline and make changes
      MockWebSocket.instances[0].simulateClose()
      const offlineTask = createTask('offline', 'Offline')
      adapter.syncLocalInsert('Task', offlineTask)

      expect(adapter.hasPendingChanges()).toBe(true)

      // Reconnect
      vi.advanceTimersByTime(1000)
      MockWebSocket.instances[1].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Pending changes should be synced and cleared
      expect(adapter.hasPendingChanges()).toBe(false)
    })

    it('does not use IndexedDB when offline disabled', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
        offline: {
          enabled: false,
        },
      })

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()
      await vi.advanceTimersByTimeAsync(100)

      expect(MockIndexedDB.databases.size).toBe(0)
    })
  })

  // ===========================================================================
  // Sync Status Indicator Tests
  // ===========================================================================

  describe('sync status indicator', () => {
    it('starts with "disconnected" status', () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      expect(adapter.status).toBe('disconnected')
    })

    it('transitions to "connecting" when connect() called', () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      adapter.connect()

      expect(adapter.status).toBe('connecting')
    })

    it('transitions to "syncing" when WebSocket opens', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      expect(adapter.status).toBe('syncing')
    })

    it('transitions to "synced" after initial sync complete', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()

      MockWebSocket.instances[0].simulateMessage({
        type: 'initial',
        collection: 'Task',
        items: [],
        txid: 0,
      })

      await vi.advanceTimersByTimeAsync(0)

      expect(adapter.status).toBe('synced')
    })

    it('transitions to "error" on connection error', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      adapter.connect()
      MockWebSocket.instances[0].simulateError(new Error('Connection failed'))
      MockWebSocket.instances[0].simulateClose()
      await vi.advanceTimersByTimeAsync(0)

      expect(adapter.status).toBe('error')
    })

    it('tracks lastSyncedAt timestamp', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      expect(adapter.lastSyncedAt).toBeNull()

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()
      MockWebSocket.instances[0].simulateMessage({
        type: 'initial',
        collection: 'Task',
        items: [],
        txid: 0,
      })

      await vi.advanceTimersByTimeAsync(0)

      expect(adapter.lastSyncedAt).toBeInstanceOf(Date)
    })

    it('provides error details when status is error', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      adapter.connect()
      MockWebSocket.instances[0].simulateError(new Error('Network error'))
      MockWebSocket.instances[0].simulateClose(1006, 'Abnormal closure')
      await vi.advanceTimersByTimeAsync(0)

      expect(adapter.status).toBe('error')
      expect(adapter.error).toBeDefined()
      expect(adapter.error?.message).toContain('Network error')
    })
  })

  // ===========================================================================
  // Partial Sync Tests
  // ===========================================================================

  describe('partial sync (per-collection)', () => {
    it('can sync individual collection', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task', 'User'],
      })

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      const ws = MockWebSocket.instances[0]
      ws.send.mockClear()

      adapter.syncCollection('Task')

      const sentMessages = ws.send.mock.calls.map((call: [string]) => JSON.parse(call[0]))
      expect(sentMessages).toContainEqual(
        expect.objectContaining({ type: 'subscribe', collection: 'Task' })
      )
      expect(sentMessages).not.toContainEqual(
        expect.objectContaining({ type: 'subscribe', collection: 'User' })
      )
    })

    it('can unsync individual collection', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task', 'User'],
      })

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      const ws = MockWebSocket.instances[0]
      ws.send.mockClear()

      adapter.unsyncCollection('Task')

      const sentMessages = ws.send.mock.calls.map((call: [string]) => JSON.parse(call[0]))
      expect(sentMessages).toContainEqual(
        expect.objectContaining({ type: 'unsubscribe', collection: 'Task' })
      )
    })

    it('tracks which collections are synced', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task', 'User'],
      })

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      expect(adapter.syncedCollections).toContain('Task')
      expect(adapter.syncedCollections).toContain('User')

      adapter.unsyncCollection('Task')

      expect(adapter.syncedCollections).not.toContain('Task')
      expect(adapter.syncedCollections).toContain('User')
    })

    it('can add new collections at runtime', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      expect(adapter.syncedCollections).not.toContain('User')

      adapter.syncCollection('User')

      expect(adapter.syncedCollections).toContain('User')
    })
  })

  // ===========================================================================
  // Delta Sync Tests
  // ===========================================================================

  describe('delta sync for efficiency', () => {
    it('tracks last transaction ID per collection', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()

      MockWebSocket.instances[0].simulateMessage({
        type: 'initial',
        collection: 'Task',
        items: [createTask('1', 'Task 1')],
        txid: 100,
      })

      await vi.advanceTimersByTimeAsync(0)

      expect(adapter.getLastTxId('Task')).toBe(100)
    })

    it('updates transaction ID on each change', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()

      MockWebSocket.instances[0].simulateMessage({
        type: 'initial',
        collection: 'Task',
        items: [],
        txid: 100,
      })

      MockWebSocket.instances[0].simulateMessage({
        type: 'insert',
        collection: 'Task',
        key: 'task-1',
        data: createTask('1', 'Task 1'),
        txid: 101,
      })

      await vi.advanceTimersByTimeAsync(0)

      expect(adapter.getLastTxId('Task')).toBe(101)
    })

    it('requests delta sync after reconnection', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()

      MockWebSocket.instances[0].simulateMessage({
        type: 'initial',
        collection: 'Task',
        items: [],
        txid: 100,
      })

      await vi.advanceTimersByTimeAsync(0)

      // Disconnect and reconnect
      MockWebSocket.instances[0].simulateClose()
      vi.advanceTimersByTime(1000)
      MockWebSocket.instances[1].simulateOpen()

      const ws = MockWebSocket.instances[1]
      const sentMessages = ws.send.mock.calls.map((call: [string]) => JSON.parse(call[0]))

      // Should request delta sync since txid 100
      expect(sentMessages).toContainEqual(
        expect.objectContaining({
          type: 'subscribe',
          collection: 'Task',
          since: 100,
        })
      )
    })

    it('falls back to full sync when delta unavailable', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      // Server responds with full sync instead of delta
      MockWebSocket.instances[0].simulateMessage({
        type: 'initial',
        collection: 'Task',
        items: [createTask('1', 'Task 1')],
        txid: 200,
        full: true, // Indicates full sync
      })

      await vi.advanceTimersByTimeAsync(0)

      // Should accept the full sync
      expect(adapter.getLastTxId('Task')).toBe(200)
    })
  })

  // ===========================================================================
  // Sync Pause/Resume Tests
  // ===========================================================================

  describe('sync pause/resume', () => {
    it('can pause sync', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      expect(adapter.isPaused).toBe(false)

      adapter.pause()

      expect(adapter.isPaused).toBe(true)
    })

    it('does not send changes while paused', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      const ws = MockWebSocket.instances[0]
      ws.send.mockClear()

      adapter.pause()

      const newTask = createTask('paused', 'Created while paused')
      adapter.syncLocalInsert('Task', newTask)

      // Should not send while paused
      expect(ws.send).not.toHaveBeenCalled()
    })

    it('queues changes while paused', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      adapter.pause()

      const newTask = createTask('paused', 'Created while paused')
      adapter.syncLocalInsert('Task', newTask)

      expect(adapter.hasPendingChanges()).toBe(true)
    })

    it('sends queued changes on resume', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      const ws = MockWebSocket.instances[0]

      adapter.pause()

      const newTask = createTask('paused', 'Created while paused')
      adapter.syncLocalInsert('Task', newTask)

      ws.send.mockClear()

      adapter.resume()

      const sentMessages = ws.send.mock.calls.map((call: [string]) => JSON.parse(call[0]))
      expect(sentMessages).toContainEqual(
        expect.objectContaining({
          type: 'insert',
          collection: 'Task',
          data: newTask,
        })
      )
    })

    it('still receives remote changes while paused', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      const onRemoteInsert = vi.fn()
      adapter.onRemoteInsert = onRemoteInsert

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      adapter.pause()

      const remoteTask = createTask('remote', 'Remote while paused')
      MockWebSocket.instances[0].simulateMessage({
        type: 'insert',
        collection: 'Task',
        key: remoteTask.$id,
        data: remoteTask,
        txid: 500,
      })

      await vi.advanceTimersByTimeAsync(0)

      // Should still receive remote changes even when paused
      expect(onRemoteInsert).toHaveBeenCalledWith('Task', remoteTask, 500)
    })

    it('resumes sync', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      adapter.pause()
      expect(adapter.isPaused).toBe(true)

      adapter.resume()
      expect(adapter.isPaused).toBe(false)
    })
  })

  // ===========================================================================
  // Manual Sync Tests
  // ===========================================================================

  describe('manual sync', () => {
    it('provides sync() method for manual full sync', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      expect(typeof adapter.sync).toBe('function')
    })

    it('sync() returns a promise', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      const syncPromise = adapter.sync()
      expect(syncPromise).toBeInstanceOf(Promise)
    })

    it('sync() resolves after all collections synced', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task', 'User'],
      })

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      const syncPromise = adapter.sync()

      // Simulate sync responses
      MockWebSocket.instances[0].simulateMessage({
        type: 'initial',
        collection: 'Task',
        items: [],
        txid: 0,
      })

      MockWebSocket.instances[0].simulateMessage({
        type: 'initial',
        collection: 'User',
        items: [],
        txid: 0,
      })

      await vi.advanceTimersByTimeAsync(0)

      await expect(syncPromise).resolves.toBeUndefined()
    })

    it('sync() rejects on error', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      const syncPromise = adapter.sync()

      // Simulate error
      MockWebSocket.instances[0].simulateError(new Error('Sync failed'))
      MockWebSocket.instances[0].simulateClose()

      await expect(syncPromise).rejects.toThrow()
    })
  })

  // ===========================================================================
  // Integration with useDollar Tests
  // ===========================================================================

  describe('integration with useDollar', () => {
    it('exposes $ proxy for RPC calls', () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      expect(adapter.$).toBeDefined()
    })

    it('$ proxy send works', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      const ws = MockWebSocket.instances[0]
      ws.send.mockClear()

      adapter.$.send({ type: 'custom', data: 'test' })

      expect(ws.send).toHaveBeenCalled()
    })

    it('$ proxy try returns promise', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      const result = adapter.$.try({ action: 'test' })
      expect(result).toBeInstanceOf(Promise)
    })

    it('$ proxy do returns promise', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      const result = adapter.$.do({ action: 'test' })
      expect(result).toBeInstanceOf(Promise)
    })

    it('$ proxy supports cross-DO RPC', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      adapter.connect()
      MockWebSocket.instances[0].simulateOpen()
      await vi.advanceTimersByTimeAsync(0)

      const ws = MockWebSocket.instances[0]
      ws.send.mockClear()

      adapter.$.Customer('cust-1').notify({ message: 'Hello' })

      const sentMessages = ws.send.mock.calls.map((call: [string]) => JSON.parse(call[0]))
      expect(sentMessages).toContainEqual(
        expect.objectContaining({
          noun: 'Customer',
          id: 'cust-1',
          method: 'notify',
        })
      )
    })

    it('shares WebSocket connection with useDollar', async () => {
      const adapter = createDotdoSync({
        doUrl: 'wss://example.com/do/123',
        collections: ['Task'],
      })

      adapter.connect()
      await vi.advanceTimersByTimeAsync(0)

      // Should only have one WebSocket connection
      // (sync and RPC share the same connection)
      expect(MockWebSocket.instances).toHaveLength(1)
    })
  })
})
