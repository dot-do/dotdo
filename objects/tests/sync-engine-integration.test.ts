/**
 * SyncEngine Broadcast Integration Tests
 *
 * [RED] TDD: These tests verify that when ThingsStore mutations occur,
 * the SyncEngine broadcasts changes to subscribed clients.
 *
 * The tests SHOULD FAIL because this integration doesn't exist yet.
 * The ThingsStore currently does not notify SyncEngine of mutations.
 *
 * Expected flow:
 * 1. ThingsStore.create() -> SyncEngine.onThingCreated() -> WebSocket broadcast
 * 2. ThingsStore.update() -> SyncEngine.onThingUpdated() -> WebSocket broadcast
 * 3. ThingsStore.delete() -> SyncEngine.onThingDeleted() -> WebSocket broadcast
 *
 * Implementation Note:
 * When implementing GREEN, either:
 * - ThingsStore needs a SyncEngine reference and calls broadcast after mutations
 * - Or DO needs to wrap ThingsStore methods and call SyncEngine after
 * - Or use an event emitter pattern between stores and sync engine
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
// NOTE: SyncEngine was in packages/tanstack which has been migrated to db/tanstack.
// The SyncEngine server component will be implemented in objects/ as part of a GREEN issue.
// For now, we import types from db/tanstack and define placeholder types for SyncEngine.
import type { ChangeMessage, SyncThing } from '../../db/tanstack/protocol'

// Placeholder type for SyncEngine - to be implemented in objects/
// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface ThingsStoreLike {
  list(options: { type?: string; branch?: string | null; limit?: number; offset?: number }): Promise<SyncThing[]>
  getMaxRowid(options: { type?: string; branch?: string | null }): Promise<number | null>
}

// Placeholder SyncEngine class - the tests will fail until this is implemented
class SyncEngine {
  constructor(_store: ThingsStoreLike) {
    // Stub - will be implemented in objects/
  }
  accept(_socket: WebSocket): void {
    throw new Error('SyncEngine not yet implemented in objects/')
  }
  subscribe(_socket: WebSocket, _collection: string, _branch?: string): void {
    throw new Error('SyncEngine not yet implemented in objects/')
  }
}

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

/**
 * Mock WebSocket interface matching Cloudflare Workers WebSocket
 */
interface MockWebSocket {
  send: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  addEventListener: ReturnType<typeof vi.fn>
  removeEventListener: ReturnType<typeof vi.fn>
  readyState: number
}

const createMockSocket = (): MockWebSocket => ({
  send: vi.fn(),
  close: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  readyState: 1, // WebSocket.OPEN
})

/**
 * Mock ThingsStore that tracks mutations and simulates what the real store does.
 * In the actual implementation, this store should notify SyncEngine of mutations.
 */
class MockThingsStore implements ThingsStoreLike {
  private things: Map<string, SyncThing> = new Map()
  private rowCounter = 0

  // Track if broadcast was called (for verification)
  public broadcastCalls: Array<{
    method: 'created' | 'updated' | 'deleted'
    thing?: SyncThing
    id?: string
    collection?: string
    branch?: string | null
    rowid: number
  }> = []

  // Sync engine reference - this is what needs to be wired up
  private syncEngine?: SyncEngine

  setSyncEngine(engine: SyncEngine): void {
    this.syncEngine = engine
  }

  async list(options: { type?: string; branch?: string | null; limit?: number; offset?: number }): Promise<SyncThing[]> {
    const results: SyncThing[] = []
    for (const thing of this.things.values()) {
      if (options.type && !thing.$type.includes(options.type)) continue
      if (options.branch !== undefined && thing.branch !== options.branch) continue
      results.push(thing)
    }
    return results.slice(options.offset ?? 0, (options.offset ?? 0) + (options.limit ?? 100))
  }

  async getMaxRowid(options: { type?: string; branch?: string | null }): Promise<number | null> {
    return this.rowCounter || null
  }

  /**
   * Create a thing.
   *
   * [RED] This currently does NOT call syncEngine.onThingCreated()
   * The test expects it to broadcast, but it won't until we implement the integration.
   */
  async create(data: Partial<SyncThing> & { $type: string }, options?: { branch?: string }): Promise<{ thing: SyncThing; rowid: number }> {
    this.rowCounter++
    const rowid = this.rowCounter
    const now = new Date().toISOString()

    const thing: SyncThing = {
      $id: data.$id ?? `thing-${rowid}`,
      $type: data.$type,
      name: data.name,
      data: data.data,
      branch: options?.branch ?? null,
      createdAt: now,
      updatedAt: now,
    }

    this.things.set(thing.$id, thing)

    // [RED] THIS IS THE MISSING INTEGRATION
    // The store should call: this.syncEngine?.onThingCreated(thing, rowid)
    // But it doesn't, so the test will FAIL

    return { thing, rowid }
  }

  /**
   * Update a thing.
   *
   * [RED] This currently does NOT call syncEngine.onThingUpdated()
   */
  async update(id: string, data: Partial<SyncThing>, options?: { branch?: string }): Promise<{ thing: SyncThing; rowid: number }> {
    const existing = this.things.get(id)
    if (!existing) {
      throw new Error(`Thing '${id}' not found`)
    }

    this.rowCounter++
    const rowid = this.rowCounter

    const updated: SyncThing = {
      ...existing,
      ...data,
      $id: id,
      updatedAt: new Date().toISOString(),
    }

    this.things.set(id, updated)

    // [RED] THIS IS THE MISSING INTEGRATION
    // The store should call: this.syncEngine?.onThingUpdated(updated, rowid)

    return { thing: updated, rowid }
  }

  /**
   * Delete a thing.
   *
   * [RED] This currently does NOT call syncEngine.onThingDeleted()
   */
  async delete(id: string, options?: { branch?: string }): Promise<{ rowid: number }> {
    const existing = this.things.get(id)
    if (!existing) {
      throw new Error(`Thing '${id}' not found`)
    }

    this.rowCounter++
    const rowid = this.rowCounter
    const collection = existing.$type.split('/').pop() ?? existing.$type

    this.things.delete(id)

    // [RED] THIS IS THE MISSING INTEGRATION
    // The store should call: this.syncEngine?.onThingDeleted(collection, id, existing.branch ?? null, rowid)

    return { rowid }
  }

  // Helper for tests
  get(id: string): SyncThing | undefined {
    return this.things.get(id)
  }
}

// ============================================================================
// TESTS: SYNC ENGINE BROADCAST INTEGRATION
// ============================================================================

describe('SyncEngine broadcast integration', () => {
  let store: MockThingsStore
  let syncEngine: SyncEngine
  let mockSocket: MockWebSocket

  beforeEach(() => {
    store = new MockThingsStore()
    syncEngine = new SyncEngine(store)
    store.setSyncEngine(syncEngine)

    // Set up mock socket and subscribe to collection
    mockSocket = createMockSocket()
    syncEngine.accept(mockSocket as unknown as WebSocket)
    syncEngine.subscribe(mockSocket as unknown as WebSocket, 'Task')
  })

  it('broadcasts insert when collection.create called', async () => {
    // Create a Task via the store
    // This should trigger SyncEngine.onThingCreated() and broadcast to subscribers
    await store.create({
      $id: 'task-1',
      $type: 'https://example.com/Task',
      name: 'Test Task',
      data: { description: 'A test task' },
    })

    // [RED] This will FAIL because store.create() doesn't call syncEngine.onThingCreated()
    expect(mockSocket.send).toHaveBeenCalled()

    const message: ChangeMessage = JSON.parse(mockSocket.send.mock.calls[0][0])
    expect(message.type).toBe('change')
    expect(message.operation).toBe('insert')
    expect(message.collection).toBe('Task')
  })

  it('broadcasts update when collection.update called', async () => {
    // First create a task
    await store.create({
      $id: 'task-update',
      $type: 'https://example.com/Task',
      name: 'Original Task',
      data: { status: 'pending' },
    })

    // Reset mock to only capture update broadcasts
    mockSocket.send.mockClear()

    // Update the task
    await store.update('task-update', {
      name: 'Updated Task',
      data: { status: 'completed' },
    })

    // [RED] This will FAIL because store.update() doesn't call syncEngine.onThingUpdated()
    expect(mockSocket.send).toHaveBeenCalled()

    const message: ChangeMessage = JSON.parse(mockSocket.send.mock.calls[0][0])
    expect(message.type).toBe('change')
    expect(message.operation).toBe('update')
    expect(message.collection).toBe('Task')
  })

  it('broadcasts delete when collection.delete called', async () => {
    // Create a thing first
    await store.create({
      $id: 'task-delete',
      $type: 'https://example.com/Task',
      name: 'Task to Delete',
    })

    // Reset mock
    mockSocket.send.mockClear()

    // Delete the task
    await store.delete('task-delete')

    // [RED] This will FAIL because store.delete() doesn't call syncEngine.onThingDeleted()
    expect(mockSocket.send).toHaveBeenCalled()

    const message: ChangeMessage = JSON.parse(mockSocket.send.mock.calls[0][0])
    expect(message.type).toBe('change')
    expect(message.operation).toBe('delete')
    expect(message.collection).toBe('Task')
    expect(message.id).toBe('task-delete')
  })

  it('includes correct txid (rowid) in broadcast', async () => {
    // Create a task
    const { rowid } = await store.create({
      $id: 'task-txid',
      $type: 'https://example.com/Task',
      name: 'Test Task',
    })

    // [RED] This will FAIL - no broadcast happens
    expect(mockSocket.send).toHaveBeenCalled()

    const message: ChangeMessage = JSON.parse(mockSocket.send.mock.calls[0][0])

    // txid should match the rowid returned by the create operation
    expect(message.txid).toBe(rowid)
    expect(message.txid).toBeGreaterThan(0)
  })

  it('broadcasts to correct collection subscribers only', async () => {
    // Add another socket subscribed to a different collection
    const userSocket = createMockSocket()
    syncEngine.accept(userSocket as unknown as WebSocket)
    syncEngine.subscribe(userSocket as unknown as WebSocket, 'User')

    // Create a Task
    await store.create({
      $id: 'task-collection',
      $type: 'https://example.com/Task',
      name: 'Test Task',
    })

    // [RED] This will FAIL - no broadcast happens
    expect(mockSocket.send).toHaveBeenCalled() // Subscribed to Task
    expect(userSocket.send).not.toHaveBeenCalled() // Subscribed to User
  })

  it('respects branch filtering', async () => {
    // Socket subscribed to main branch only
    const mainBranchSocket = createMockSocket()
    syncEngine.accept(mainBranchSocket as unknown as WebSocket)
    syncEngine.subscribe(mainBranchSocket as unknown as WebSocket, 'Task', 'main')

    // Socket subscribed to feature branch
    const featureBranchSocket = createMockSocket()
    syncEngine.accept(featureBranchSocket as unknown as WebSocket)
    syncEngine.subscribe(featureBranchSocket as unknown as WebSocket, 'Task', 'feature/dark-mode')

    // Create a task on the feature branch
    await store.create(
      { $id: 'task-branch', $type: 'https://example.com/Task', name: 'Feature Task' },
      { branch: 'feature/dark-mode' }
    )

    // [RED] This will FAIL - no broadcast happens
    // When implemented, only feature branch subscriber should receive
    expect(featureBranchSocket.send).toHaveBeenCalled()
    expect(mainBranchSocket.send).not.toHaveBeenCalled()
  })
})

describe('SyncEngine broadcast - txid/rowid matching', () => {
  let store: MockThingsStore
  let syncEngine: SyncEngine
  let mockSocket: MockWebSocket

  beforeEach(() => {
    store = new MockThingsStore()
    syncEngine = new SyncEngine(store)
    store.setSyncEngine(syncEngine)

    mockSocket = createMockSocket()
    syncEngine.accept(mockSocket as unknown as WebSocket)
    syncEngine.subscribe(mockSocket as unknown as WebSocket, 'Task')
  })

  it('includes incrementing txid for sequential inserts', async () => {
    await store.create({ $id: 'task-1', $type: 'https://example.com/Task', name: 'Task 1' })
    await store.create({ $id: 'task-2', $type: 'https://example.com/Task', name: 'Task 2' })
    await store.create({ $id: 'task-3', $type: 'https://example.com/Task', name: 'Task 3' })

    // [RED] This will FAIL - no broadcasts happen
    const calls = mockSocket.send.mock.calls
    expect(calls.length).toBe(3)

    const txids = calls.map((call: [string]) => JSON.parse(call[0]).txid)

    // txids should be strictly increasing
    expect(txids[1]).toBeGreaterThan(txids[0])
    expect(txids[2]).toBeGreaterThan(txids[1])
  })

  it('update txid is greater than create txid for same thing', async () => {
    const { rowid: createRowid } = await store.create({
      $id: 'task-versions',
      $type: 'https://example.com/Task',
      name: 'Original',
    })

    const { rowid: updateRowid } = await store.update('task-versions', {
      name: 'Updated',
    })

    // [RED] This will FAIL - no broadcasts happen
    expect(mockSocket.send).toHaveBeenCalledTimes(2)

    const createMessage: ChangeMessage = JSON.parse(mockSocket.send.mock.calls[0][0])
    const updateMessage: ChangeMessage = JSON.parse(mockSocket.send.mock.calls[1][0])

    expect(updateMessage.txid).toBeGreaterThan(createMessage.txid)
    expect(createMessage.txid).toBe(createRowid)
    expect(updateMessage.txid).toBe(updateRowid)
  })

  it('delete txid is greater than update txid', async () => {
    await store.create({
      $id: 'task-lifecycle',
      $type: 'https://example.com/Task',
      name: 'Lifecycle Task',
    })

    await store.update('task-lifecycle', { name: 'Updated' })

    const { rowid: deleteRowid } = await store.delete('task-lifecycle')

    // [RED] This will FAIL - no broadcasts happen
    expect(mockSocket.send).toHaveBeenCalledTimes(3)

    const deleteMessage: ChangeMessage = JSON.parse(mockSocket.send.mock.calls[2][0])
    const updateMessage: ChangeMessage = JSON.parse(mockSocket.send.mock.calls[1][0])

    expect(deleteMessage.txid).toBeGreaterThan(updateMessage.txid)
    expect(deleteMessage.txid).toBe(deleteRowid)
  })
})

describe('SyncEngine integration edge cases', () => {
  let store: MockThingsStore
  let syncEngine: SyncEngine

  beforeEach(() => {
    store = new MockThingsStore()
    syncEngine = new SyncEngine(store)
    store.setSyncEngine(syncEngine)
  })

  it('does not throw when no subscribers exist', async () => {
    // No sockets accepted/subscribed
    // Should not throw even if broadcast is attempted
    await expect(
      store.create({ $id: 'orphan', $type: 'https://example.com/Task', name: 'Orphan' })
    ).resolves.toBeDefined()
  })

  it('continues operation even if socket.send fails', async () => {
    const faultySocket = createMockSocket()
    faultySocket.send.mockImplementation(() => {
      throw new Error('WebSocket send failed')
    })

    syncEngine.accept(faultySocket as unknown as WebSocket)
    syncEngine.subscribe(faultySocket as unknown as WebSocket, 'Task')

    // Create should succeed even if broadcast fails
    const result = await store.create({
      $id: 'resilient',
      $type: 'https://example.com/Task',
      name: 'Resilient Task',
    })

    expect(result.thing.$id).toBe('resilient')
  })

  it('does not broadcast to closed sockets', async () => {
    const closedSocket = createMockSocket()
    closedSocket.readyState = 3 // WebSocket.CLOSED

    syncEngine.accept(closedSocket as unknown as WebSocket)
    syncEngine.subscribe(closedSocket as unknown as WebSocket, 'Task')

    await store.create({
      $id: 'no-closed',
      $type: 'https://example.com/Task',
      name: 'Test',
    })

    // Should not attempt to send to closed socket
    // Note: This test documents expected behavior - SyncEngine already handles this
    expect(closedSocket.send).not.toHaveBeenCalled()
  })
})

describe('SyncEngine broadcast message format', () => {
  let store: MockThingsStore
  let syncEngine: SyncEngine
  let mockSocket: MockWebSocket

  beforeEach(() => {
    store = new MockThingsStore()
    syncEngine = new SyncEngine(store)
    store.setSyncEngine(syncEngine)

    mockSocket = createMockSocket()
    syncEngine.accept(mockSocket as unknown as WebSocket)
    syncEngine.subscribe(mockSocket as unknown as WebSocket, 'Task')
  })

  it('insert broadcast includes full thing with SyncThing structure', async () => {
    await store.create({
      $id: 'task-full',
      $type: 'https://example.com/Task',
      name: 'Complete Task',
      data: {
        description: 'A fully described task',
        priority: 'high',
        tags: ['urgent', 'important'],
      },
    })

    // [RED] This will FAIL - no broadcast happens
    expect(mockSocket.send).toHaveBeenCalled()

    const message: ChangeMessage = JSON.parse(mockSocket.send.mock.calls[0][0])

    expect(message.operation).toBe('insert')
    expect(message.thing).toBeDefined()

    const thing = message.thing as SyncThing
    expect(thing.$id).toBe('task-full')
    expect(thing.$type).toContain('Task')
    expect(thing.name).toBe('Complete Task')
    expect(thing.data).toEqual({
      description: 'A fully described task',
      priority: 'high',
      tags: ['urgent', 'important'],
    })
    expect(thing.createdAt).toBeDefined()
    expect(thing.updatedAt).toBeDefined()
  })

  it('update broadcast includes updated thing data', async () => {
    await store.create({
      $id: 'task-update-format',
      $type: 'https://example.com/Task',
      name: 'Original',
      data: { status: 'pending' },
    })

    mockSocket.send.mockClear()

    await store.update('task-update-format', {
      name: 'Updated',
      data: { status: 'completed', completedAt: '2024-01-15' },
    })

    // [RED] This will FAIL - no broadcast happens
    expect(mockSocket.send).toHaveBeenCalled()

    const message: ChangeMessage = JSON.parse(mockSocket.send.mock.calls[0][0])

    expect(message.operation).toBe('update')
    expect(message.thing).toBeDefined()

    const thing = message.thing as SyncThing
    expect(thing.name).toBe('Updated')
    expect(thing.data?.status).toBe('completed')
  })

  it('delete broadcast includes thing id but not full thing', async () => {
    await store.create({
      $id: 'task-delete-format',
      $type: 'https://example.com/Task',
      name: 'To Delete',
    })

    mockSocket.send.mockClear()

    await store.delete('task-delete-format')

    // [RED] This will FAIL - no broadcast happens
    expect(mockSocket.send).toHaveBeenCalled()

    const message: ChangeMessage = JSON.parse(mockSocket.send.mock.calls[0][0])

    expect(message.operation).toBe('delete')
    expect(message.id).toBe('task-delete-format')
    expect(message.collection).toBe('Task')
    // Delete messages typically don't include the full thing
    expect(message.thing).toBeUndefined()
  })

  it('broadcast includes branch in message', async () => {
    await store.create(
      { $id: 'task-branched', $type: 'https://example.com/Task', name: 'Branched Task' },
      { branch: 'feature/new-ui' }
    )

    // [RED] This will FAIL - no broadcast happens
    expect(mockSocket.send).toHaveBeenCalled()

    const message: ChangeMessage = JSON.parse(mockSocket.send.mock.calls[0][0])
    expect(message.branch).toBe('feature/new-ui')
  })
})
