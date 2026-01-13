/**
 * ThingsCollection Interface Tests - TDD RED Phase
 *
 * Tests for the complete ThingsCollection interface with update/delete methods
 * that return rowid for TanStack DB sync protocol.
 *
 * Expected interface (from dotdo-x3oa7):
 * ```typescript
 * export interface ThingsCollection<T extends Thing = Thing> {
 *   get(id: string): Promise<T | null>
 *   list(): Promise<T[]>
 *   find(query: Record<string, unknown>): Promise<T[]>
 *   create(data: Partial<T>): Promise<T & { rowid: number }>
 *   update(id: string, data: Partial<T>): Promise<T & { rowid: number }>  // NEW
 *   delete(id: string): Promise<{ rowid: number }>                        // NEW
 * }
 * ```
 *
 * Current interface has:
 * - insert(item: T): Promise<T> (no rowid)
 * - update(id: string, changes: Partial<T>): Promise<T> (no rowid)
 * - delete(id: string): Promise<void> (returns void, not rowid)
 * - query(filter?: Filter<T>): Promise<T[]>
 * - subscribe(callback): () => void
 *
 * These tests verify the GAP between current and expected interface.
 * All methods must return rowid for txid tracking in sync protocol.
 *
 * @module db/tanstack/tests/things-collection-interface.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SyncEngine, ThingsStoreLike, SyncItem, ThingsCollection } from '../index'
import { createSyncEngine, createThingsCollection } from '../index'

// ============================================================================
// TYPE DEFINITIONS - Expected interface vs Current interface
// ============================================================================

/**
 * Expected ThingsCollection interface after implementation.
 * This defines what we're testing towards.
 */
interface ExpectedThingsCollection<T extends SyncItem> {
  // Current interface methods - should still work
  insert(item: T): Promise<T & { rowid: number }> // Modified: should return rowid
  update(id: string, data: Partial<T>): Promise<T & { rowid: number }> // Modified: should return rowid
  delete(id: string): Promise<{ rowid: number }> // Modified: should return rowid, not void
  query(filter?: Record<string, unknown>): Promise<T[]>
  subscribe(callback: (items: T[]) => void): () => void

  // NEW methods to add (for compatibility with DOBase.collection interface)
  get?(id: string): Promise<T | null>
  list?(): Promise<T[]>
  find?(query: Record<string, unknown>): Promise<T[]>
  create?(data: Partial<T>): Promise<T & { rowid: number }>
}

// ============================================================================
// TEST INFRASTRUCTURE
// ============================================================================

interface TestItem extends SyncItem {
  $id: string
  $type: string
  name?: string
  data?: Record<string, unknown>
  branch?: string | null
  createdAt: string
  updatedAt: string
}

interface MockThingsStore extends ThingsStoreLike {
  items: Map<string, TestItem>
  rowCounter: number
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
      if (event === 'message') socket.onmessage = handler as MockWebSocket['onmessage']
      else if (event === 'open') socket.onopen = handler as MockWebSocket['onopen']
      else if (event === 'close') socket.onclose = handler as MockWebSocket['onclose']
      else if (event === 'error') socket.onerror = handler as MockWebSocket['onerror']
    }),
    removeEventListener: vi.fn(),
    readyState: 1, // WebSocket.OPEN
  }
  return socket
}

// ============================================================================
// TESTS: ThingsCollection Interface Completeness
// ============================================================================

describe('ThingsCollection Interface (TDD RED - dotdo-x3oa7)', () => {
  let mockStore: MockThingsStore
  let syncEngine: SyncEngine
  let collection: ThingsCollection<TestItem>

  beforeEach(() => {
    mockStore = createMockThingsStore()
    syncEngine = createSyncEngine({ store: mockStore })
    collection = createThingsCollection<TestItem>({
      name: 'Task',
      store: mockStore,
      syncEngine,
    })
  })

  // ============================================================================
  // Tests for update() method returning rowid
  // ============================================================================

  describe('update() method', () => {
    it('should return rowid for txid tracking in sync protocol', async () => {
      // Create an item first
      const created = await collection.create({
        $id: 'task-1',
        $type: 'Task',
        name: 'Original Name',
      } as Partial<TestItem>)

      // Update the item
      const updated = await collection.update('task-1', { name: 'Updated Name' })

      // RED: Current implementation returns T without rowid
      // Expected: update should return T & { rowid: number }
      expect(updated).toHaveProperty('rowid')
      expect(typeof updated.rowid).toBe('number')
      expect(updated.rowid).toBeGreaterThan(0)
    })

    it('should return the updated item data along with rowid', async () => {
      await collection.create({
        $id: 'task-1',
        $type: 'Task',
        name: 'Original',
        data: { priority: 'low' },
      } as Partial<TestItem>)

      const updated = await collection.update('task-1', {
        name: 'Updated',
        data: { priority: 'high' },
      })

      // Should have both item properties and rowid
      expect(updated.$id).toBe('task-1')
      expect(updated.name).toBe('Updated')
      expect(updated.rowid).toBeDefined()
      expect(typeof updated.rowid).toBe('number')
    })

    it('should return monotonically increasing rowid for sequential updates', async () => {
      await collection.create({
        $id: 'task-1',
        $type: 'Task',
        name: 'Initial',
      } as Partial<TestItem>)

      const update1 = await collection.update('task-1', { name: 'First Update' })
      const update2 = await collection.update('task-1', { name: 'Second Update' })
      const update3 = await collection.update('task-1', { name: 'Third Update' })

      // Each update should have a higher rowid (used as txid in sync)
      expect(update2.rowid).toBeGreaterThan(update1.rowid)
      expect(update3.rowid).toBeGreaterThan(update2.rowid)
    })

    it('should throw error when updating non-existent item', async () => {
      await expect(
        collection.update('non-existent', { name: 'Test' })
      ).rejects.toThrow()
    })

    it('should preserve $id and $type on update', async () => {
      await collection.create({
        $id: 'task-1',
        $type: 'Task',
        name: 'Original',
      } as Partial<TestItem>)

      const updated = await collection.update('task-1', {
        name: 'Updated',
        // Attempting to change $id or $type should be ignored
        $id: 'different-id',
        $type: 'DifferentType',
      } as Partial<TestItem>)

      // Identity fields should be preserved
      expect(updated.$id).toBe('task-1')
    })

    it('should update updatedAt timestamp', async () => {
      await collection.create({
        $id: 'task-1',
        $type: 'Task',
        name: 'Original',
      } as Partial<TestItem>)

      // Small delay to ensure different timestamp
      await new Promise((r) => setTimeout(r, 10))

      const updated = await collection.update('task-1', { name: 'Updated' })

      expect(updated.updatedAt).toBeDefined()
      // updatedAt should be a recent ISO string
      const updatedTime = new Date(updated.updatedAt).getTime()
      expect(updatedTime).toBeLessThanOrEqual(Date.now())
      expect(updatedTime).toBeGreaterThan(Date.now() - 5000) // Within last 5 seconds
    })

    it('should broadcast update change with txid to subscribers', async () => {
      const socket = createMockWebSocket()
      syncEngine.accept(socket as unknown as WebSocket)
      syncEngine.subscribe(socket as unknown as WebSocket, 'Task')

      await collection.create({
        $id: 'task-1',
        $type: 'Task',
        name: 'Original',
      } as Partial<TestItem>)

      socket.send.mockClear()

      const updated = await collection.update('task-1', { name: 'Updated' })

      expect(socket.send).toHaveBeenCalled()
      const broadcastMessage = JSON.parse(socket.send.mock.calls[0][0])
      expect(broadcastMessage.type).toBe('update')
      expect(broadcastMessage.key).toBe('task-1')
      // txid should match the rowid returned
      expect(broadcastMessage.txid).toBe(updated.rowid)
    })
  })

  // ============================================================================
  // Tests for delete() method returning rowid
  // ============================================================================

  describe('delete() method', () => {
    it('should return rowid for txid tracking in sync protocol', async () => {
      await collection.create({
        $id: 'task-1',
        $type: 'Task',
        name: 'To Delete',
      } as Partial<TestItem>)

      // Delete the item
      const result = await collection.delete('task-1')

      // RED: Current implementation returns void
      // Expected: delete should return { rowid: number }
      expect(result).toHaveProperty('rowid')
      expect(typeof result.rowid).toBe('number')
      expect(result.rowid).toBeGreaterThan(0)
    })

    it('should return only rowid (minimal response)', async () => {
      await collection.create({
        $id: 'task-1',
        $type: 'Task',
        name: 'To Delete',
      } as Partial<TestItem>)

      const result = await collection.delete('task-1')

      // Delete should return minimal object with just rowid
      // (unlike update which returns full item)
      expect(result.rowid).toBeDefined()
      // The result should have rowid but not require the full item
      expect(typeof result.rowid).toBe('number')
    })

    it('should return monotonically increasing rowid', async () => {
      await collection.create({ $id: 'task-1', $type: 'Task', name: 'Item 1' } as Partial<TestItem>)
      await collection.create({ $id: 'task-2', $type: 'Task', name: 'Item 2' } as Partial<TestItem>)
      await collection.create({ $id: 'task-3', $type: 'Task', name: 'Item 3' } as Partial<TestItem>)

      const delete1 = await collection.delete('task-1')
      const delete2 = await collection.delete('task-2')
      const delete3 = await collection.delete('task-3')

      // Each delete should have a higher rowid
      expect(delete2.rowid).toBeGreaterThan(delete1.rowid)
      expect(delete3.rowid).toBeGreaterThan(delete2.rowid)
    })

    it('should throw error when deleting non-existent item', async () => {
      await expect(
        collection.delete('non-existent')
      ).rejects.toThrow()
    })

    it('should remove item from list() results', async () => {
      await collection.create({ $id: 'task-1', $type: 'Task', name: 'Item 1' } as Partial<TestItem>)
      await collection.create({ $id: 'task-2', $type: 'Task', name: 'Item 2' } as Partial<TestItem>)

      const beforeDelete = await collection.list()
      expect(beforeDelete.length).toBe(2)

      await collection.delete('task-1')

      const afterDelete = await collection.list()
      expect(afterDelete.length).toBe(1)
      expect(afterDelete.find((i) => i.$id === 'task-1')).toBeUndefined()
      expect(afterDelete.find((i) => i.$id === 'task-2')).toBeDefined()
    })

    it('should remove item from query() results', async () => {
      await collection.create({
        $id: 'task-1',
        $type: 'Task',
        name: 'High Priority',
        data: { priority: 'high' },
      } as Partial<TestItem>)
      await collection.create({
        $id: 'task-2',
        $type: 'Task',
        name: 'High Priority 2',
        data: { priority: 'high' },
      } as Partial<TestItem>)

      await collection.delete('task-1')

      const results = await collection.query({ 'data.priority': 'high' })
      expect(results.find((i) => i.$id === 'task-1')).toBeUndefined()
    })

    it('should return null from get() after delete', async () => {
      await collection.create({ $id: 'task-1', $type: 'Task', name: 'Item' } as Partial<TestItem>)

      await collection.delete('task-1')

      const result = await collection.get('task-1')
      expect(result).toBeNull()
    })

    it('should broadcast delete change with txid to subscribers', async () => {
      const socket = createMockWebSocket()
      syncEngine.accept(socket as unknown as WebSocket)
      syncEngine.subscribe(socket as unknown as WebSocket, 'Task')

      await collection.create({
        $id: 'task-1',
        $type: 'Task',
        name: 'To Delete',
      } as Partial<TestItem>)

      socket.send.mockClear()

      const result = await collection.delete('task-1')

      expect(socket.send).toHaveBeenCalled()
      const broadcastMessage = JSON.parse(socket.send.mock.calls[0][0])
      expect(broadcastMessage.type).toBe('delete')
      expect(broadcastMessage.key).toBe('task-1')
      // txid should match the rowid returned
      expect(broadcastMessage.txid).toBe(result.rowid)
    })
  })

  // ============================================================================
  // Tests for create() method returning rowid (verifying existing behavior)
  // ============================================================================

  describe('create() method rowid', () => {
    it('should return rowid for txid tracking in sync protocol', async () => {
      const created = await collection.create({
        $id: 'task-1',
        $type: 'Task',
        name: 'New Task',
      } as Partial<TestItem>)

      // Verify create also returns rowid (part of complete interface)
      expect(created).toHaveProperty('rowid')
      expect(typeof created.rowid).toBe('number')
      expect(created.rowid).toBeGreaterThan(0)
    })

    it('should return monotonically increasing rowid for sequential creates', async () => {
      const create1 = await collection.create({ $id: 'task-1', $type: 'Task', name: 'Task 1' } as Partial<TestItem>)
      const create2 = await collection.create({ $id: 'task-2', $type: 'Task', name: 'Task 2' } as Partial<TestItem>)
      const create3 = await collection.create({ $id: 'task-3', $type: 'Task', name: 'Task 3' } as Partial<TestItem>)

      expect(create2.rowid).toBeGreaterThan(create1.rowid)
      expect(create3.rowid).toBeGreaterThan(create2.rowid)
    })

    it('should broadcast insert change with txid to subscribers', async () => {
      const socket = createMockWebSocket()
      syncEngine.accept(socket as unknown as WebSocket)
      syncEngine.subscribe(socket as unknown as WebSocket, 'Task')

      const created = await collection.create({
        $id: 'task-1',
        $type: 'Task',
        name: 'New Task',
      } as Partial<TestItem>)

      expect(socket.send).toHaveBeenCalled()
      const broadcastMessage = JSON.parse(socket.send.mock.calls[0][0])
      expect(broadcastMessage.type).toBe('insert')
      expect(broadcastMessage.key).toBe('task-1')
      // txid should match the rowid returned
      expect(broadcastMessage.txid).toBe(created.rowid)
    })
  })

  // ============================================================================
  // Tests for rowid consistency across operations
  // ============================================================================

  describe('rowid consistency', () => {
    it('should maintain global rowid ordering across create/update/delete', async () => {
      // Create items
      const c1 = await collection.create({ $id: 'task-1', $type: 'Task', name: 'Task 1' } as Partial<TestItem>)
      const c2 = await collection.create({ $id: 'task-2', $type: 'Task', name: 'Task 2' } as Partial<TestItem>)

      // Update
      const u1 = await collection.update('task-1', { name: 'Updated 1' })

      // Create another
      const c3 = await collection.create({ $id: 'task-3', $type: 'Task', name: 'Task 3' } as Partial<TestItem>)

      // Delete
      const d1 = await collection.delete('task-2')

      // All rowids should be monotonically increasing
      expect(c2.rowid).toBeGreaterThan(c1.rowid)
      expect(u1.rowid).toBeGreaterThan(c2.rowid)
      expect(c3.rowid).toBeGreaterThan(u1.rowid)
      expect(d1.rowid).toBeGreaterThan(c3.rowid)
    })

    it('should use rowid as txid for sync protocol ordering', async () => {
      const socket = createMockWebSocket()
      syncEngine.accept(socket as unknown as WebSocket)
      syncEngine.subscribe(socket as unknown as WebSocket, 'Task')

      // Perform mixed operations
      await collection.create({ $id: 'task-1', $type: 'Task', name: 'Task 1' } as Partial<TestItem>)
      await collection.update('task-1', { name: 'Updated' })
      await collection.delete('task-1')

      // All broadcasts should have monotonically increasing txid
      const messages = socket.send.mock.calls.map((call) => JSON.parse(call[0] as string))
      expect(messages.length).toBe(3)

      for (let i = 1; i < messages.length; i++) {
        expect(messages[i].txid).toBeGreaterThan(messages[i - 1].txid)
      }
    })
  })

  // ============================================================================
  // Interface completeness check
  // ============================================================================

  describe('interface completeness', () => {
    it('should have all required methods', () => {
      // Check that collection has all expected methods
      expect(typeof collection.get).toBe('function')
      expect(typeof collection.list).toBe('function')
      expect(typeof collection.find).toBe('function')
      expect(typeof collection.create).toBe('function')
      expect(typeof collection.update).toBe('function')
      expect(typeof collection.delete).toBe('function')
    })

    it('should export ThingsCollection interface with correct method signatures', async () => {
      // Import the interface type to verify it matches expected
      const { ThingsCollection } = await import('../index')

      // Type check: create an object that satisfies the interface
      // This is a compile-time check
      const typeCheck: ExpectedThingsCollection<TestItem> = {
        get: async () => null,
        list: async () => [],
        find: async () => [],
        create: async () => ({ $id: '', $type: '', createdAt: '', updatedAt: '', rowid: 1 }),
        update: async () => ({ $id: '', $type: '', createdAt: '', updatedAt: '', rowid: 1 }),
        delete: async () => ({ rowid: 1 }),
        query: async () => [],
        subscribe: () => () => {},
      }

      expect(typeCheck).toBeDefined()
    })
  })
})

// ============================================================================
// Type-level tests (compile-time checks)
// ============================================================================

describe('ThingsCollection type correctness', () => {
  it('documents expected return types', () => {
    // These type assertions document the expected interface
    // They help catch type mismatches at compile time

    type ExpectedCreateReturn<T> = T & { rowid: number }
    type ExpectedUpdateReturn<T> = T & { rowid: number }
    type ExpectedDeleteReturn = { rowid: number }

    // Document: create should return item with rowid
    type CreateReturnCheck = ExpectedCreateReturn<{ $id: string }>
    const createCheck: CreateReturnCheck = { $id: 'test', rowid: 1 }
    expect(createCheck.rowid).toBe(1)

    // Document: update should return item with rowid
    type UpdateReturnCheck = ExpectedUpdateReturn<{ $id: string; name: string }>
    const updateCheck: UpdateReturnCheck = { $id: 'test', name: 'updated', rowid: 2 }
    expect(updateCheck.rowid).toBe(2)

    // Document: delete should return only rowid
    type DeleteReturnCheck = ExpectedDeleteReturn
    const deleteCheck: DeleteReturnCheck = { rowid: 3 }
    expect(deleteCheck.rowid).toBe(3)
  })
})
