/**
 * ThingsStore -> SyncEngine Integration Tests (TDD)
 *
 * These tests verify that ThingsStore has a mutation callback that can be
 * wired to SyncEngine for real-time sync broadcasts.
 *
 * @module objects/tests/sync-store-integration.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ThingsStore, type StoreContext, type ThingEntity, type ThingsMutationCallback } from '../../db/stores'
import { SyncEngine } from '../transport/sync-engine'
import type { SyncThing } from '../transport/sync-engine'

// ============================================================================
// TESTS: ThingsStore onMutation property exists
// ============================================================================

describe('ThingsStore onMutation callback property', () => {
  it('should have onMutation property', () => {
    // Create a minimal mock store context
    const mockStoreContext: StoreContext = {
      db: {} as any,
      ns: 'test.example.com',
      currentBranch: 'main',
      env: {},
      typeCache: new Map(),
    }

    const thingsStore = new ThingsStore(mockStoreContext)

    // Verify the property exists and can be set
    expect(thingsStore.onMutation).toBeUndefined()

    const callback: ThingsMutationCallback = vi.fn()
    thingsStore.onMutation = callback
    expect(thingsStore.onMutation).toBe(callback)
  })
})

// ============================================================================
// TESTS: SyncEngine onThingCreated/Updated/Deleted methods
// ============================================================================

describe('SyncEngine broadcast methods', () => {
  let syncEngine: SyncEngine
  let mockSocket: {
    send: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    addEventListener: ReturnType<typeof vi.fn>
    removeEventListener: ReturnType<typeof vi.fn>
    readyState: number
  }

  beforeEach(() => {
    // Create minimal ThingsStore mock for SyncEngine constructor
    const mockThingsStore = {} as ThingsStore

    syncEngine = new SyncEngine(mockThingsStore)

    mockSocket = {
      send: vi.fn(),
      close: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      readyState: 1, // WebSocket.OPEN
    }

    // Accept the socket
    syncEngine.accept(mockSocket as unknown as WebSocket)
  })

  it('should broadcast insert message via onThingCreated', () => {
    // Subscribe to Task collection
    syncEngine.subscribe(mockSocket as unknown as WebSocket, 'Task')

    const syncThing: SyncThing = {
      $id: 'task-1',
      $type: 'Task',
      name: 'Test Task',
      data: { description: 'A test task' },
      branch: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    // Call onThingCreated
    syncEngine.onThingCreated(syncThing, 42)

    // Verify broadcast
    expect(mockSocket.send).toHaveBeenCalledTimes(1)
    const message = JSON.parse(mockSocket.send.mock.calls[0][0])
    expect(message.type).toBe('insert')
    expect(message.collection).toBe('Task')
    expect(message.key).toBe('task-1')
    expect(message.txid).toBe(42)
    expect(message.data.$id).toBe('task-1')
  })

  it('should broadcast update message via onThingUpdated', () => {
    syncEngine.subscribe(mockSocket as unknown as WebSocket, 'Task')

    const syncThing: SyncThing = {
      $id: 'task-1',
      $type: 'Task',
      name: 'Updated Task',
      data: { status: 'completed' },
      branch: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    syncEngine.onThingUpdated(syncThing, 43)

    expect(mockSocket.send).toHaveBeenCalledTimes(1)
    const message = JSON.parse(mockSocket.send.mock.calls[0][0])
    expect(message.type).toBe('update')
    expect(message.collection).toBe('Task')
    expect(message.key).toBe('task-1')
    expect(message.txid).toBe(43)
  })

  it('should broadcast delete message via onThingDeleted', () => {
    syncEngine.subscribe(mockSocket as unknown as WebSocket, 'Task')

    syncEngine.onThingDeleted('Task', 'task-1', null, 44)

    expect(mockSocket.send).toHaveBeenCalledTimes(1)
    const message = JSON.parse(mockSocket.send.mock.calls[0][0])
    expect(message.type).toBe('delete')
    expect(message.collection).toBe('Task')
    expect(message.key).toBe('task-1')
    expect(message.txid).toBe(44)
  })

  it('should only broadcast to subscribers of the correct collection', () => {
    const userSocket = {
      send: vi.fn(),
      close: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      readyState: 1,
    }

    syncEngine.accept(userSocket as unknown as WebSocket)
    syncEngine.subscribe(mockSocket as unknown as WebSocket, 'Task')
    syncEngine.subscribe(userSocket as unknown as WebSocket, 'User')

    const syncThing: SyncThing = {
      $id: 'task-1',
      $type: 'Task',
      name: 'Test Task',
      branch: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    syncEngine.onThingCreated(syncThing, 1)

    expect(mockSocket.send).toHaveBeenCalledTimes(1)
    expect(userSocket.send).not.toHaveBeenCalled()
  })

  it('should not broadcast to closed sockets', () => {
    mockSocket.readyState = 3 // WebSocket.CLOSED
    syncEngine.subscribe(mockSocket as unknown as WebSocket, 'Task')

    const syncThing: SyncThing = {
      $id: 'task-1',
      $type: 'Task',
      name: 'Test',
      branch: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    syncEngine.onThingCreated(syncThing, 1)

    expect(mockSocket.send).not.toHaveBeenCalled()
  })

  it('should not throw when no subscribers exist', () => {
    // No subscriptions
    const syncThing: SyncThing = {
      $id: 'task-1',
      $type: 'Task',
      name: 'Orphan',
      branch: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    // Should not throw
    expect(() => syncEngine.onThingCreated(syncThing, 1)).not.toThrow()
    expect(() => syncEngine.onThingUpdated(syncThing, 2)).not.toThrow()
    expect(() => syncEngine.onThingDeleted('Task', 'task-1', null, 3)).not.toThrow()
  })

  it('should continue when socket.send throws', () => {
    const faultySocket = {
      send: vi.fn().mockImplementation(() => {
        throw new Error('Send failed')
      }),
      close: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      readyState: 1,
    }

    syncEngine.accept(faultySocket as unknown as WebSocket)
    syncEngine.subscribe(faultySocket as unknown as WebSocket, 'Task')

    const syncThing: SyncThing = {
      $id: 'task-1',
      $type: 'Task',
      name: 'Test',
      branch: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    // Should not throw even if send fails
    expect(() => syncEngine.onThingCreated(syncThing, 1)).not.toThrow()
  })
})

// ============================================================================
// TESTS: Wiring demonstration
// ============================================================================

describe('ThingsStore -> SyncEngine wiring pattern', () => {
  it('should demonstrate the wiring pattern that DOBase will use', () => {
    // Create minimal mocks
    const mockThingsStore = new ThingsStore({
      db: {} as any,
      ns: 'test.example.com',
      currentBranch: 'main',
      env: {},
      typeCache: new Map(),
    })

    const syncEngine = new SyncEngine(mockThingsStore)

    const mockSocket = {
      send: vi.fn(),
      close: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      readyState: 1,
    }

    syncEngine.accept(mockSocket as unknown as WebSocket)
    syncEngine.subscribe(mockSocket as unknown as WebSocket, 'Task')

    // This is how DOBase will wire the callback
    mockThingsStore.onMutation = (type, thing, rowid) => {
      const syncThing: SyncThing = {
        $id: thing.$id,
        $type: thing.$type,
        name: thing.name ?? undefined,
        data: thing.data ?? undefined,
        branch: thing.branch ?? null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      if (type === 'insert') {
        syncEngine.onThingCreated(syncThing, rowid)
      } else if (type === 'update') {
        syncEngine.onThingUpdated(syncThing, rowid)
      } else if (type === 'delete') {
        syncEngine.onThingDeleted(thing.$type, thing.$id, thing.branch ?? null, rowid)
      }
    }

    // Simulate what ThingsStore.create() does after a successful insert
    const createdThing: ThingEntity = {
      $id: 'task-1',
      $type: 'Task',
      name: 'Test Task',
      data: { description: 'A test' },
      branch: null,
      version: 42,
      deleted: false,
    }

    // Call the callback (this is what create() does internally now)
    mockThingsStore.onMutation('insert', createdThing, 42)

    // Verify the socket received the broadcast
    expect(mockSocket.send).toHaveBeenCalledTimes(1)
    const message = JSON.parse(mockSocket.send.mock.calls[0][0])
    expect(message.type).toBe('insert')
    expect(message.collection).toBe('Task')
    expect(message.key).toBe('task-1')
    expect(message.txid).toBe(42)
  })
})
