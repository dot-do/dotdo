/**
 * SyncEngine Broadcast Wiring Tests
 *
 * These tests verify that ThingsStore mutations automatically trigger
 * SyncEngine broadcasts to subscribed WebSocket clients.
 *
 * The wiring happens in DOBase where:
 * - ThingsStore.onMutation callback is set
 * - Callback transforms ThingEntity to SyncThing and calls SyncEngine methods
 *
 * @module objects/tests/sync-engine-broadcast.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SyncEngine, type SyncThing } from '../transport/sync-engine'
import { ThingsStore, type ThingEntity, type StoreContext } from '../../db/stores'

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

interface MockWebSocket {
  send: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  readyState: number
}

function createMockSocket(): MockWebSocket {
  return {
    send: vi.fn(),
    close: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    readyState: 1, // WebSocket.OPEN
  }
}

/**
 * Creates the wiring function that DOBase should use to connect
 * ThingsStore mutations to SyncEngine broadcasts.
 *
 * This is the pattern that DOBase.things getter should implement.
 */
function wireThingsStoreToSyncEngine(
  thingsStore: ThingsStore,
  syncEngine: SyncEngine
): void {
  thingsStore.onMutation = (type, thing, rowid) => {
    // Transform ThingEntity to SyncThing for the wire protocol
    const syncThing: SyncThing = {
      $id: thing.$id,
      $type: thing.$type,
      name: thing.name ?? undefined,
      data: thing.data ?? undefined,
      branch: thing.branch ?? null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    switch (type) {
      case 'insert':
        syncEngine.onThingCreated(syncThing, rowid)
        break
      case 'update':
        syncEngine.onThingUpdated(syncThing, rowid)
        break
      case 'delete':
        // For delete, we use the original thing's type to get the collection
        syncEngine.onThingDeleted(thing.$type, thing.$id, thing.branch ?? null, rowid)
        break
    }
  }
}

// ============================================================================
// TESTS: Wiring ThingsStore -> SyncEngine
// ============================================================================

describe('ThingsStore -> SyncEngine wiring', () => {
  let mockStoreContext: StoreContext
  let thingsStore: ThingsStore
  let syncEngine: SyncEngine
  let mockSocket: MockWebSocket

  beforeEach(() => {
    // Create minimal mock store context
    mockStoreContext = {
      db: {} as any,
      ns: 'test.example.com',
      currentBranch: 'main',
      env: {},
      typeCache: new Map(),
    }

    thingsStore = new ThingsStore(mockStoreContext)
    syncEngine = new SyncEngine(thingsStore)

    mockSocket = createMockSocket()
    syncEngine.accept(mockSocket as unknown as WebSocket)
  })

  describe('onMutation callback wiring', () => {
    it('should call SyncEngine.onThingCreated when ThingsStore.onMutation is called with insert', () => {
      syncEngine.subscribe(mockSocket as unknown as WebSocket, 'Task')

      // Wire the callback (this is what DOBase should do)
      wireThingsStoreToSyncEngine(thingsStore, syncEngine)

      // Simulate what ThingsStore.create() does after a successful insert
      const createdThing: ThingEntity = {
        $id: 'task-1',
        $type: 'Task',
        name: 'Test Task',
        data: { description: 'A test task' },
        branch: null,
        version: 42,
        deleted: false,
      }

      // Call the callback (this is what create() does internally)
      thingsStore.onMutation!('insert', createdThing, 42)

      // Verify the socket received the broadcast
      expect(mockSocket.send).toHaveBeenCalledTimes(1)
      const message = JSON.parse(mockSocket.send.mock.calls[0][0])
      expect(message.type).toBe('insert')
      expect(message.collection).toBe('Task')
      expect(message.key).toBe('task-1')
      expect(message.txid).toBe(42)
    })

    it('should call SyncEngine.onThingUpdated when ThingsStore.onMutation is called with update', () => {
      syncEngine.subscribe(mockSocket as unknown as WebSocket, 'Task')
      wireThingsStoreToSyncEngine(thingsStore, syncEngine)

      const updatedThing: ThingEntity = {
        $id: 'task-1',
        $type: 'Task',
        name: 'Updated Task',
        data: { status: 'completed' },
        branch: null,
        version: 43,
        deleted: false,
      }

      thingsStore.onMutation!('update', updatedThing, 43)

      expect(mockSocket.send).toHaveBeenCalledTimes(1)
      const message = JSON.parse(mockSocket.send.mock.calls[0][0])
      expect(message.type).toBe('update')
      expect(message.collection).toBe('Task')
      expect(message.key).toBe('task-1')
      expect(message.txid).toBe(43)
    })

    it('should call SyncEngine.onThingDeleted when ThingsStore.onMutation is called with delete', () => {
      syncEngine.subscribe(mockSocket as unknown as WebSocket, 'Task')
      wireThingsStoreToSyncEngine(thingsStore, syncEngine)

      const deletedThing: ThingEntity = {
        $id: 'task-1',
        $type: 'Task',
        name: 'Task to Delete',
        branch: null,
        version: 44,
        deleted: true,
      }

      thingsStore.onMutation!('delete', deletedThing, 44)

      expect(mockSocket.send).toHaveBeenCalledTimes(1)
      const message = JSON.parse(mockSocket.send.mock.calls[0][0])
      expect(message.type).toBe('delete')
      expect(message.collection).toBe('Task')
      expect(message.key).toBe('task-1')
      expect(message.txid).toBe(44)
    })
  })

  describe('branch-aware broadcasting', () => {
    it('should broadcast to subscribers on the same branch', () => {
      // Subscribe to feature branch
      syncEngine.subscribe(mockSocket as unknown as WebSocket, 'Task', 'feature/dark-mode')
      wireThingsStoreToSyncEngine(thingsStore, syncEngine)

      const branchedThing: ThingEntity = {
        $id: 'task-branched',
        $type: 'Task',
        name: 'Branched Task',
        branch: 'feature/dark-mode',
        version: 1,
        deleted: false,
      }

      thingsStore.onMutation!('insert', branchedThing, 1)

      expect(mockSocket.send).toHaveBeenCalledTimes(1)
      const message = JSON.parse(mockSocket.send.mock.calls[0][0])
      expect(message.branch).toBe('feature/dark-mode')
    })

    it('should not broadcast to subscribers on different branches', () => {
      // Subscribe to main branch (null)
      syncEngine.subscribe(mockSocket as unknown as WebSocket, 'Task', null)
      wireThingsStoreToSyncEngine(thingsStore, syncEngine)

      const featureThing: ThingEntity = {
        $id: 'task-feature',
        $type: 'Task',
        name: 'Feature Task',
        branch: 'feature/new-ui',
        version: 1,
        deleted: false,
      }

      thingsStore.onMutation!('insert', featureThing, 1)

      // Should not be called because subscriber is on null branch, not 'feature/new-ui'
      expect(mockSocket.send).not.toHaveBeenCalled()
    })
  })

  describe('collection-aware broadcasting', () => {
    it('should only broadcast to subscribers of the correct collection', () => {
      const userSocket = createMockSocket()
      syncEngine.accept(userSocket as unknown as WebSocket)

      syncEngine.subscribe(mockSocket as unknown as WebSocket, 'Task')
      syncEngine.subscribe(userSocket as unknown as WebSocket, 'User')

      wireThingsStoreToSyncEngine(thingsStore, syncEngine)

      const task: ThingEntity = {
        $id: 'task-1',
        $type: 'Task',
        name: 'Test Task',
        branch: null,
        version: 1,
        deleted: false,
      }

      thingsStore.onMutation!('insert', task, 1)

      expect(mockSocket.send).toHaveBeenCalledTimes(1) // Subscribed to Task
      expect(userSocket.send).not.toHaveBeenCalled() // Subscribed to User
    })
  })

  describe('error resilience', () => {
    it('should not throw when no subscribers exist', () => {
      wireThingsStoreToSyncEngine(thingsStore, syncEngine)

      const orphan: ThingEntity = {
        $id: 'orphan',
        $type: 'Orphan',
        name: 'Orphan Thing',
        branch: null,
        version: 1,
        deleted: false,
      }

      // Should not throw
      expect(() => {
        thingsStore.onMutation!('insert', orphan, 1)
      }).not.toThrow()
    })

    it('should continue when socket.send throws', () => {
      const faultySocket = createMockSocket()
      faultySocket.send.mockImplementation(() => {
        throw new Error('Send failed')
      })

      syncEngine.accept(faultySocket as unknown as WebSocket)
      syncEngine.subscribe(faultySocket as unknown as WebSocket, 'Task')

      wireThingsStoreToSyncEngine(thingsStore, syncEngine)

      const task: ThingEntity = {
        $id: 'task-1',
        $type: 'Task',
        name: 'Test',
        branch: null,
        version: 1,
        deleted: false,
      }

      // Should not throw even if send fails
      expect(() => {
        thingsStore.onMutation!('insert', task, 1)
      }).not.toThrow()
    })

    it('should not broadcast to closed sockets', () => {
      mockSocket.readyState = 3 // WebSocket.CLOSED
      syncEngine.subscribe(mockSocket as unknown as WebSocket, 'Task')
      wireThingsStoreToSyncEngine(thingsStore, syncEngine)

      const task: ThingEntity = {
        $id: 'task-1',
        $type: 'Task',
        name: 'Test',
        branch: null,
        version: 1,
        deleted: false,
      }

      thingsStore.onMutation!('insert', task, 1)

      expect(mockSocket.send).not.toHaveBeenCalled()
    })
  })

  describe('URL-based $type handling', () => {
    it('should extract collection from URL-based $type', () => {
      syncEngine.subscribe(mockSocket as unknown as WebSocket, 'Task')
      wireThingsStoreToSyncEngine(thingsStore, syncEngine)

      const task: ThingEntity = {
        $id: 'task-1',
        $type: 'https://example.com.ai/Task',
        name: 'Test Task',
        branch: null,
        version: 1,
        deleted: false,
      }

      thingsStore.onMutation!('insert', task, 1)

      expect(mockSocket.send).toHaveBeenCalledTimes(1)
      const message = JSON.parse(mockSocket.send.mock.calls[0][0])
      expect(message.collection).toBe('Task')
    })
  })

  describe('txid/rowid tracking', () => {
    it('should include the correct rowid as txid in broadcast', () => {
      syncEngine.subscribe(mockSocket as unknown as WebSocket, 'Task')
      wireThingsStoreToSyncEngine(thingsStore, syncEngine)

      const task: ThingEntity = {
        $id: 'task-1',
        $type: 'Task',
        name: 'Test',
        branch: null,
        version: 123,
        deleted: false,
      }

      // Pass rowid 999 which should be the txid in the broadcast
      thingsStore.onMutation!('insert', task, 999)

      const message = JSON.parse(mockSocket.send.mock.calls[0][0])
      expect(message.txid).toBe(999)
    })

    it('should have incrementing txids for sequential mutations', () => {
      syncEngine.subscribe(mockSocket as unknown as WebSocket, 'Task')
      wireThingsStoreToSyncEngine(thingsStore, syncEngine)

      for (let i = 1; i <= 3; i++) {
        const task: ThingEntity = {
          $id: `task-${i}`,
          $type: 'Task',
          name: `Task ${i}`,
          branch: null,
          version: i,
          deleted: false,
        }
        thingsStore.onMutation!('insert', task, i * 10)
      }

      expect(mockSocket.send).toHaveBeenCalledTimes(3)

      const txids = mockSocket.send.mock.calls.map(
        (call: [string]) => JSON.parse(call[0]).txid
      )

      expect(txids).toEqual([10, 20, 30])
      expect(txids[1]).toBeGreaterThan(txids[0])
      expect(txids[2]).toBeGreaterThan(txids[1])
    })
  })
})

// ============================================================================
// TESTS: Message format validation
// ============================================================================

describe('SyncEngine broadcast message format', () => {
  let mockStoreContext: StoreContext
  let thingsStore: ThingsStore
  let syncEngine: SyncEngine
  let mockSocket: MockWebSocket

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
    mockSocket = createMockSocket()

    syncEngine.accept(mockSocket as unknown as WebSocket)
    syncEngine.subscribe(mockSocket as unknown as WebSocket, 'Task')
    wireThingsStoreToSyncEngine(thingsStore, syncEngine)
  })

  it('insert broadcast includes full thing data', () => {
    const task: ThingEntity = {
      $id: 'task-full',
      $type: 'Task',
      name: 'Complete Task',
      data: {
        description: 'A fully described task',
        priority: 'high',
        tags: ['urgent', 'important'],
      },
      branch: null,
      version: 1,
      deleted: false,
    }

    thingsStore.onMutation!('insert', task, 1)

    const message = JSON.parse(mockSocket.send.mock.calls[0][0])
    expect(message.type).toBe('insert')
    expect(message.data.$id).toBe('task-full')
    expect(message.data.$type).toBe('Task')
    expect(message.data.name).toBe('Complete Task')
    expect(message.data.data).toEqual({
      description: 'A fully described task',
      priority: 'high',
      tags: ['urgent', 'important'],
    })
  })

  it('update broadcast includes updated thing data', () => {
    const task: ThingEntity = {
      $id: 'task-update',
      $type: 'Task',
      name: 'Updated Task',
      data: { status: 'completed' },
      branch: null,
      version: 2,
      deleted: false,
    }

    thingsStore.onMutation!('update', task, 2)

    const message = JSON.parse(mockSocket.send.mock.calls[0][0])
    expect(message.type).toBe('update')
    expect(message.data.$id).toBe('task-update')
    expect(message.data.name).toBe('Updated Task')
  })

  it('delete broadcast includes thing id and collection', () => {
    const task: ThingEntity = {
      $id: 'task-delete',
      $type: 'Task',
      name: 'Deleted Task',
      branch: null,
      version: 3,
      deleted: true,
    }

    thingsStore.onMutation!('delete', task, 3)

    const message = JSON.parse(mockSocket.send.mock.calls[0][0])
    expect(message.type).toBe('delete')
    expect(message.key).toBe('task-delete')
    expect(message.collection).toBe('Task')
  })

  it('broadcast includes branch when thing is branched', () => {
    syncEngine.subscribe(mockSocket as unknown as WebSocket, 'Task', 'feature/new-ui')

    const task: ThingEntity = {
      $id: 'task-branched',
      $type: 'Task',
      name: 'Branched Task',
      branch: 'feature/new-ui',
      version: 1,
      deleted: false,
    }

    thingsStore.onMutation!('insert', task, 1)

    const message = JSON.parse(mockSocket.send.mock.calls[0][0])
    expect(message.branch).toBe('feature/new-ui')
  })
})
