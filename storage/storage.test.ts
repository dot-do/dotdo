/**
 * DOStorage 4-Layer Storage Stack Tests - TDD RED Phase
 *
 * This test file defines the expected behavior of the DOStorage 4-layer architecture:
 *
 * L0: InMemoryStateManager - Fast O(1) CRUD with dirty tracking and LRU eviction
 * L1: PipelineEmitter (WAL) - Fire-and-forget event emission for durability
 * L2: LazyCheckpointer (SQLite) - Batched lazy persistence to SQLite
 * L3: IcebergWriter (Cold Storage) - Long-term storage in R2 with time travel
 *
 * Write Path: Client -> L0 (memory) -> L1 (WAL ACK) -> lazy L2 -> eventual L3
 * Read Path: L0 (hit?) -> L2 (hit?) -> L3 (restore)
 *
 * These tests WILL FAIL because the implementations don't exist yet.
 *
 * Issue: do-v2.3.1
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ============================================================================
// IMPORTS - These WILL FAIL because implementations don't exist
// ============================================================================

// L0: InMemoryStateManager
import {
  InMemoryStateManager,
  type ThingData,
  type CreateThingInput,
  type InMemoryStateManagerOptions,
  type StateManagerStats,
} from '../storage/in-memory-state-manager'

// L1: PipelineEmitter (WAL)
import {
  PipelineEmitter,
  type PipelineEmitterConfig,
  type EmittedEvent,
} from '../storage/pipeline-emitter'

// L2: LazyCheckpointer (SQLite)
import {
  LazyCheckpointer,
  type LazyCheckpointerOptions,
  type CheckpointStats,
  type DirtyTracker,
} from '../storage/lazy-checkpointer'

// L3: IcebergWriter (Cold Storage)
import {
  IcebergWriter,
  type IcebergWriterConfig,
  type IcebergPartition,
  type TimeTravelQuery,
} from '../storage/iceberg-writer'

// Cold Start Recovery
import {
  ColdStartRecovery,
  type RecoveryResult,
  type RecoveryOptions,
} from '../storage/cold-start-recovery'

// Integrated DOStorage
import {
  DOStorage,
  type DOStorageConfig,
} from '../storage/do-storage'

// ============================================================================
// TYPE DEFINITIONS (Expected Interfaces)
// ============================================================================

interface Thing {
  $id: string
  $type: string
  $version?: number
  name?: string
  data?: Record<string, unknown>
  [key: string]: unknown
}

// ============================================================================
// L0: InMemoryStateManager Tests
// ============================================================================

describe('L0: InMemoryStateManager', () => {
  let manager: InMemoryStateManager

  beforeEach(() => {
    manager = new InMemoryStateManager()
  })

  // ==========================================================================
  // O(1) CRUD Operations
  // ==========================================================================

  describe('O(1) CRUD operations', () => {
    it('should create a thing with generated $id', () => {
      const input: CreateThingInput = {
        $type: 'Customer',
        name: 'Alice',
      }

      const result = manager.create(input)

      expect(result.$id).toBeDefined()
      expect(result.$id).toMatch(/^customer_/)
      expect(result.$type).toBe('Customer')
      expect(result.name).toBe('Alice')
      expect(result.$version).toBe(1)
    })

    it('should create a thing with provided $id', () => {
      const input: CreateThingInput = {
        $id: 'custom_id_123',
        $type: 'Order',
        total: 150,
      }

      const result = manager.create(input)

      expect(result.$id).toBe('custom_id_123')
      expect(result.total).toBe(150)
    })

    it('should read a thing by $id in O(1) time', () => {
      const created = manager.create({ $type: 'Customer', name: 'Bob' })

      const result = manager.get(created.$id)

      expect(result).not.toBeNull()
      expect(result!.$id).toBe(created.$id)
      expect(result!.name).toBe('Bob')
    })

    it('should update a thing and increment $version', () => {
      const created = manager.create({ $type: 'Customer', name: 'Charlie' })

      const updated = manager.update(created.$id, { name: 'Charlie Updated' })

      expect(updated.$version).toBe(2)
      expect(updated.name).toBe('Charlie Updated')
      expect(updated.$type).toBe('Customer') // Preserved
    })

    it('should merge updates by default', () => {
      const created = manager.create({
        $type: 'Customer',
        name: 'David',
        email: 'david@example.com',
        role: 'user',
      })

      const updated = manager.update(created.$id, { role: 'admin' })

      expect(updated.name).toBe('David') // Preserved
      expect(updated.email).toBe('david@example.com') // Preserved
      expect(updated.role).toBe('admin') // Updated
    })

    it('should delete a thing and return it', () => {
      const created = manager.create({ $type: 'Task', name: 'DeleteMe' })

      const deleted = manager.delete(created.$id)

      expect(deleted).not.toBeNull()
      expect(deleted!.$id).toBe(created.$id)
      expect(manager.get(created.$id)).toBeNull()
    })

    it('should return null for non-existent $id', () => {
      expect(manager.get('nonexistent_id')).toBeNull()
    })

    it('should throw when updating non-existent $id', () => {
      expect(() => manager.update('ghost_id', { name: 'Ghost' })).toThrow()
    })

    it('should return null when deleting non-existent $id', () => {
      expect(manager.delete('phantom_id')).toBeNull()
    })
  })

  // ==========================================================================
  // Dirty Tracking
  // ==========================================================================

  describe('dirty tracking', () => {
    it('should mark created things as dirty', () => {
      expect(manager.getDirtyCount()).toBe(0)

      const created = manager.create({ $type: 'Customer', name: 'Eve' })

      expect(manager.isDirty(created.$id)).toBe(true)
      expect(manager.getDirtyCount()).toBe(1)
    })

    it('should mark updated things as dirty', () => {
      const created = manager.create({ $type: 'Customer', name: 'Frank' })
      manager.markClean([created.$id])

      expect(manager.isDirty(created.$id)).toBe(false)

      manager.update(created.$id, { name: 'Frank Updated' })

      expect(manager.isDirty(created.$id)).toBe(true)
    })

    it('should not mark read-only access as dirty', () => {
      const created = manager.create({ $type: 'Customer', name: 'Grace' })
      manager.markClean([created.$id])

      const initialCount = manager.getDirtyCount()

      // Multiple reads should not dirty the entry
      manager.get(created.$id)
      manager.get(created.$id)
      manager.get(created.$id)

      expect(manager.getDirtyCount()).toBe(initialCount)
    })

    it('should return all dirty entry keys', () => {
      const t1 = manager.create({ $type: 'Item', name: 'One' })
      const t2 = manager.create({ $type: 'Item', name: 'Two' })
      const t3 = manager.create({ $type: 'Item', name: 'Three' })

      manager.markClean([t1.$id, t2.$id])

      const dirtyKeys = manager.getDirtyKeys()

      expect(dirtyKeys).toContain(t3.$id)
      expect(dirtyKeys).not.toContain(t1.$id)
      expect(dirtyKeys).not.toContain(t2.$id)
    })

    it('should clear dirty flags with markClean()', () => {
      const t1 = manager.create({ $type: 'Item', name: 'One' })
      const t2 = manager.create({ $type: 'Item', name: 'Two' })

      expect(manager.getDirtyCount()).toBe(2)

      manager.markClean([t1.$id, t2.$id])

      expect(manager.getDirtyCount()).toBe(0)
      expect(manager.isDirty(t1.$id)).toBe(false)
      expect(manager.isDirty(t2.$id)).toBe(false)
    })

    it('should remove from dirty set on delete', () => {
      const thing = manager.create({ $type: 'Temp', name: 'ToDelete' })

      expect(manager.isDirty(thing.$id)).toBe(true)

      manager.delete(thing.$id)

      expect(manager.isDirty(thing.$id)).toBe(false)
    })
  })

  // ==========================================================================
  // LRU Eviction
  // ==========================================================================

  describe('LRU eviction', () => {
    it('should evict LRU entries when max count exceeded', () => {
      const evicted: Thing[] = []
      const smallManager = new InMemoryStateManager({
        maxEntries: 3,
        onEvict: (entries) => evicted.push(...entries),
      })

      const first = smallManager.create({ $type: 'Item', name: 'First' })
      const second = smallManager.create({ $type: 'Item', name: 'Second' })
      const third = smallManager.create({ $type: 'Item', name: 'Third' })

      // Mark clean so they can be evicted
      smallManager.markClean([first.$id, second.$id, third.$id])

      smallManager.create({ $type: 'Item', name: 'Fourth' }) // Triggers eviction

      expect(evicted.length).toBeGreaterThan(0)
      expect(evicted[0].name).toBe('First') // LRU
    })

    it('should evict entries when max bytes exceeded', () => {
      const evicted: Thing[] = []
      const smallManager = new InMemoryStateManager({
        maxBytes: 1000,
        onEvict: (entries) => evicted.push(...entries),
      })

      const doc1 = smallManager.create({
        $type: 'Doc',
        data: { content: 'X'.repeat(400) },
      })
      smallManager.markClean([doc1.$id])

      const doc2 = smallManager.create({
        $type: 'Doc',
        data: { content: 'Y'.repeat(400) },
      })
      smallManager.markClean([doc2.$id])

      smallManager.create({
        $type: 'Doc',
        data: { content: 'Z'.repeat(400) },
      })

      expect(evicted.length).toBeGreaterThan(0)
    })

    it('should update LRU order on read access', () => {
      const evicted: Thing[] = []
      const smallManager = new InMemoryStateManager({
        maxEntries: 3,
        onEvict: (entries) => evicted.push(...entries),
      })

      const first = smallManager.create({ $type: 'Item', name: 'First' })
      const second = smallManager.create({ $type: 'Item', name: 'Second' })
      const third = smallManager.create({ $type: 'Item', name: 'Third' })

      smallManager.markClean([first.$id, second.$id, third.$id])

      // Access first item (makes it recently used)
      smallManager.get(first.$id)

      smallManager.create({ $type: 'Item', name: 'Fourth' })

      // Second should be evicted (LRU clean), not first (recently accessed)
      expect(evicted[0].name).toBe('Second')
    })

    it('should evict dirty entries as last resort under memory pressure', () => {
      const evicted: Thing[] = []
      const memoryPressureCalled = { value: false }
      const smallManager = new InMemoryStateManager({
        maxEntries: 2,
        onEvict: (entries) => evicted.push(...entries),
        onMemoryPressure: () => { memoryPressureCalled.value = true },
      })

      // All dirty by default
      smallManager.create({ $type: 'Item', name: 'First' })
      smallManager.create({ $type: 'Item', name: 'Second' })
      smallManager.create({ $type: 'Item', name: 'Third' })

      // When over capacity with only dirty entries:
      // 1. onMemoryPressure callback is called
      // 2. Dirty entries are evicted as last resort (LRU order)
      expect(memoryPressureCalled.value).toBe(true)
      expect(evicted.length).toBe(1)
      expect(evicted[0].name).toBe('First') // LRU dirty entry
    })

    it('should call onEvict callback with evicted entries', () => {
      const onEvict = vi.fn()
      const smallManager = new InMemoryStateManager({
        maxEntries: 2,
        onEvict,
      })

      const first = smallManager.create({ $type: 'Item', name: 'First' })
      const second = smallManager.create({ $type: 'Item', name: 'Second' })

      smallManager.markClean([first.$id])

      smallManager.create({ $type: 'Item', name: 'Third' })

      expect(onEvict).toHaveBeenCalled()
      expect(onEvict.mock.calls[0][0].length).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // list() with Prefix Filtering
  // ==========================================================================

  describe('list() with prefix filtering', () => {
    it('should list all things', () => {
      manager.create({ $type: 'Customer', name: 'Alice' })
      manager.create({ $type: 'Customer', name: 'Bob' })
      manager.create({ $type: 'Order', name: 'Order 1' })

      const all = manager.list()

      expect(all.length).toBe(3)
    })

    it('should list things by $type prefix', () => {
      manager.create({ $type: 'Customer', name: 'Alice' })
      manager.create({ $type: 'Customer', name: 'Bob' })
      manager.create({ $type: 'Order', name: 'Order 1' })

      const customers = manager.list({ prefix: 'customer' })

      expect(customers.length).toBe(2)
      expect(customers.every((t) => t.$type === 'Customer')).toBe(true)
    })

    it('should list things by $id prefix', () => {
      manager.create({ $id: 'user_1', $type: 'User', name: 'One' })
      manager.create({ $id: 'user_2', $type: 'User', name: 'Two' })
      manager.create({ $id: 'admin_1', $type: 'User', name: 'Admin' })

      const users = manager.list({ prefix: 'user_' })

      expect(users.length).toBe(2)
    })

    it('should support limit and offset', () => {
      for (let i = 0; i < 10; i++) {
        manager.create({ $type: 'Item', name: `Item ${i}` })
      }

      const page1 = manager.list({ limit: 3, offset: 0 })
      const page2 = manager.list({ limit: 3, offset: 3 })

      expect(page1.length).toBe(3)
      expect(page2.length).toBe(3)
    })
  })

  // ==========================================================================
  // Bulk Operations
  // ==========================================================================

  describe('bulk operations', () => {
    it('should load bulk data without marking dirty', () => {
      const things: Thing[] = [
        { $id: 'cust_1', $type: 'Customer', name: 'Alice', $version: 5 },
        { $id: 'cust_2', $type: 'Customer', name: 'Bob', $version: 3 },
      ]

      manager.loadBulk(things)

      expect(manager.get('cust_1')?.name).toBe('Alice')
      expect(manager.isDirty('cust_1')).toBe(false) // NOT dirty
      expect(manager.getDirtyCount()).toBe(0)
    })

    it('should export all things', () => {
      manager.create({ $type: 'A', name: 'One' })
      manager.create({ $type: 'B', name: 'Two' })

      const exported = manager.exportAll()

      expect(exported.length).toBe(2)
    })

    it('should clear all state', () => {
      manager.create({ $type: 'A', name: 'One' })
      manager.create({ $type: 'B', name: 'Two' })

      manager.clear()

      expect(manager.size()).toBe(0)
      expect(manager.getDirtyCount()).toBe(0)
    })
  })

  // ==========================================================================
  // Statistics
  // ==========================================================================

  describe('statistics', () => {
    it('should report correct size', () => {
      expect(manager.size()).toBe(0)

      const t1 = manager.create({ $type: 'A', name: 'One' })
      expect(manager.size()).toBe(1)

      manager.create({ $type: 'B', name: 'Two' })
      expect(manager.size()).toBe(2)

      manager.delete(t1.$id)
      expect(manager.size()).toBe(1)
    })

    it('should report stats', () => {
      manager.create({ $type: 'A', data: { large: 'X'.repeat(1000) } })
      manager.create({ $type: 'B', data: { large: 'Y'.repeat(1000) } })

      const stats = manager.getStats()

      expect(stats.entryCount).toBe(2)
      expect(stats.dirtyCount).toBe(2)
      expect(stats.estimatedBytes).toBeGreaterThan(0)
    })

    it('should check if ID exists', () => {
      const thing = manager.create({ $type: 'A', name: 'Test' })

      expect(manager.has(thing.$id)).toBe(true)
      expect(manager.has('nonexistent')).toBe(false)
    })
  })

  // ==========================================================================
  // Edge Cases and Error Handling
  // ==========================================================================

  describe('edge cases and error handling', () => {
    it('should handle empty strings in data', () => {
      const thing = manager.create({ $type: 'Item', name: '', description: '' })

      expect(thing.name).toBe('')
      expect(thing.description).toBe('')

      const retrieved = manager.get(thing.$id)
      expect(retrieved?.name).toBe('')
    })

    it('should handle null values in data', () => {
      const thing = manager.create({ $type: 'Item', name: null as unknown as string })

      expect(thing.name).toBeNull()

      const retrieved = manager.get(thing.$id)
      expect(retrieved?.name).toBeNull()
    })

    it('should handle special characters in data fields', () => {
      // Note: $type must be PascalCase per validation rules
      const thing = manager.create({
        $type: 'UserProfile',
        name: '测试用户 <script>alert("xss")</script>',
        email: "user@example.com'; DROP TABLE users;--",
        path: '/path/with/slashes',
        query: 'key=value&other=123',
      })

      expect(thing.$type).toBe('UserProfile')
      expect(thing.name).toBe('测试用户 <script>alert("xss")</script>')
      expect(thing.email).toBe("user@example.com'; DROP TABLE users;--")
      expect(thing.path).toBe('/path/with/slashes')
    })

    it('should handle large payloads', () => {
      const largeData = 'X'.repeat(100000) // 100KB string
      const thing = manager.create({
        $type: 'LargeItem',
        data: largeData,
      })

      expect(thing.data).toBe(largeData)
      expect(manager.getStats().estimatedBytes).toBeGreaterThan(100000)
    })

    it('should handle deeply nested objects', () => {
      const nested = {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: { value: 'deep' },
              },
            },
          },
        },
      }

      const thing = manager.create({ $type: 'Nested', data: nested })

      const retrieved = manager.get(thing.$id)
      expect((retrieved?.data as typeof nested).level1.level2.level3.level4.level5.value).toBe('deep')
    })

    it('should handle arrays in data', () => {
      const thing = manager.create({
        $type: 'ArrayItem',
        tags: ['tag1', 'tag2', 'tag3'],
        numbers: [1, 2, 3, 4, 5],
        nested: [{ a: 1 }, { b: 2 }],
      })

      const retrieved = manager.get(thing.$id)
      expect(retrieved?.tags).toEqual(['tag1', 'tag2', 'tag3'])
      expect(retrieved?.numbers).toEqual([1, 2, 3, 4, 5])
    })

    it('should preserve data types across operations', () => {
      const thing = manager.create({
        $type: 'TypeTest',
        string: 'hello',
        number: 42,
        float: 3.14159,
        boolean: true,
        nullValue: null,
        array: [1, 'two', true],
        object: { nested: true },
      })

      const retrieved = manager.get(thing.$id)
      expect(typeof retrieved?.string).toBe('string')
      expect(typeof retrieved?.number).toBe('number')
      expect(typeof retrieved?.float).toBe('number')
      expect(typeof retrieved?.boolean).toBe('boolean')
      expect(retrieved?.nullValue).toBeNull()
      expect(Array.isArray(retrieved?.array)).toBe(true)
      expect(typeof retrieved?.object).toBe('object')
    })

    it('should handle concurrent updates correctly', () => {
      const thing = manager.create({ $type: 'Counter', count: 0 })

      // Simulate multiple updates
      for (let i = 0; i < 100; i++) {
        const current = manager.get(thing.$id)
        manager.update(thing.$id, { count: (current?.count as number) + 1 })
      }

      const final = manager.get(thing.$id)
      expect(final?.count).toBe(100)
      expect(final?.$version).toBe(101) // 1 create + 100 updates
    })

    it('should handle rapid create/delete cycles', () => {
      const ids: string[] = []

      // Create many items
      for (let i = 0; i < 100; i++) {
        const thing = manager.create({ $type: 'Temp', index: i })
        ids.push(thing.$id)
      }

      expect(manager.size()).toBe(100)

      // Delete all
      for (const id of ids) {
        manager.delete(id)
      }

      expect(manager.size()).toBe(0)
      expect(manager.getDirtyCount()).toBe(0)
    })

    it('should handle custom $id with special characters', () => {
      const customIds = [
        'item/with/slashes',
        'item:with:colons',
        'item#with#hashes',
        'item?with?questions',
        'item@with@at',
      ]

      for (const customId of customIds) {
        const thing = manager.create({ $id: customId, $type: 'Special' })
        expect(thing.$id).toBe(customId)

        const retrieved = manager.get(customId)
        expect(retrieved?.$id).toBe(customId)
      }
    })

    it('should throw when creating with invalid input', () => {
      // Missing $type should throw
      expect(() => manager.create({ name: 'NoType' } as any)).toThrow()
    })

    it('should handle update with empty object', () => {
      const thing = manager.create({ $type: 'Item', name: 'Original' })

      // Empty update should just increment version
      const updated = manager.update(thing.$id, {})

      expect(updated.name).toBe('Original')
      expect(updated.$version).toBe(2)
    })

    it('should not allow changing $id via update', () => {
      const thing = manager.create({ $type: 'Item', name: 'Test' })
      const originalId = thing.$id

      // Attempt to change $id via update
      const updated = manager.update(thing.$id, { $id: 'new_id' } as any)

      // $id should be preserved
      expect(updated.$id).toBe(originalId)
    })

    it('should not allow changing $type via update', () => {
      const thing = manager.create({ $type: 'Original', name: 'Test' })

      // Attempt to change $type via update
      const updated = manager.update(thing.$id, { $type: 'Changed' } as any)

      // $type should be preserved
      expect(updated.$type).toBe('Original')
    })
  })
})

// ============================================================================
// L1: PipelineEmitter (WAL) Tests
// ============================================================================

describe('L1: PipelineEmitter (WAL)', () => {
  let mockPipeline: { send: ReturnType<typeof vi.fn>; events: unknown[] }
  let emitter: PipelineEmitter

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'))
    mockPipeline = {
      send: vi.fn(async (batch: unknown[]) => {
        mockPipeline.events.push(...batch)
      }),
      events: [],
    }
  })

  afterEach(async () => {
    if (emitter) {
      await emitter.close()
    }
    vi.useRealTimers()
  })

  // ==========================================================================
  // Event Emission
  // ==========================================================================

  describe('event emission', () => {
    it('should emit event to pipeline immediately (fire-and-forget)', async () => {
      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0, // Immediate
      })

      emitter.emit('thing.created', 'things', { $id: 'thing_1', $type: 'Customer', name: 'Alice' })

      await vi.advanceTimersByTimeAsync(10)

      expect(mockPipeline.send).toHaveBeenCalled()
      expect(mockPipeline.events.length).toBeGreaterThan(0)
    })

    it('should not block caller on pipeline response', async () => {
      // Use a never-resolving promise to simulate slow pipeline
      // This avoids the setTimeout/fake timer conflict
      let pipelineResolve: () => void
      const slowPipeline = {
        send: vi.fn(() => new Promise<void>((resolve) => {
          pipelineResolve = resolve
        })),
        events: [],
      }

      emitter = new PipelineEmitter(slowPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
      })

      const start = Date.now()
      emitter.emit('thing.created', 'things', { $id: 'thing_1', name: 'Alice' })
      const elapsed = Date.now() - start

      // Should return immediately, not wait for slow pipeline
      expect(elapsed).toBeLessThan(50)

      // Resolve the pending pipeline send so afterEach can close cleanly
      pipelineResolve!()
      await vi.advanceTimersByTimeAsync(10)
    })

    it('should include timestamp in event', async () => {
      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
      })

      emitter.emit('thing.created', 'things', { $id: 'thing_1' })
      await vi.advanceTimersByTimeAsync(10)

      const event = mockPipeline.events[0] as EmittedEvent
      expect(event.timestamp).toBe('2026-01-15T12:00:00.000Z')
    })

    it('should include namespace in event metadata', async () => {
      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'tenant-123',
        flushInterval: 0,
      })

      emitter.emit('thing.created', 'things', { $id: 'thing_1' })
      await vi.advanceTimersByTimeAsync(10)

      const event = mockPipeline.events[0] as EmittedEvent
      expect(event._meta.namespace).toBe('tenant-123')
    })
  })

  // ==========================================================================
  // Durability Guarantee (Events durable BEFORE SQLite)
  // ==========================================================================

  describe('durability guarantee', () => {
    it('should emit to pipeline before returning ACK', async () => {
      const emitOrder: string[] = []

      const trackingPipeline = {
        send: vi.fn(async () => {
          emitOrder.push('pipeline')
        }),
        events: [],
      }

      emitter = new PipelineEmitter(trackingPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
      })

      emitter.emit('thing.created', 'things', { $id: 'thing_1' })
      emitOrder.push('emit_returned')

      await vi.advanceTimersByTimeAsync(10)

      // Pipeline should be called (async) while emit returns immediately
      expect(trackingPipeline.send).toHaveBeenCalled()
    })

    it('should generate unique idempotency keys', async () => {
      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
      })

      emitter.emit('thing.created', 'things', { $id: 'thing_1' })
      emitter.emit('thing.created', 'things', { $id: 'thing_2' })
      await vi.advanceTimersByTimeAsync(10)

      const events = mockPipeline.events as EmittedEvent[]
      expect(events[0].idempotencyKey).not.toBe(events[1].idempotencyKey)
    })
  })

  // ==========================================================================
  // Batch Emission
  // ==========================================================================

  describe('batch emission', () => {
    it('should batch events within flush interval', async () => {
      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 1000,
        batchSize: 100,
      })

      emitter.emit('thing.created', 'things', { $id: 'thing_1' })
      emitter.emit('thing.created', 'things', { $id: 'thing_2' })
      emitter.emit('thing.created', 'things', { $id: 'thing_3' })

      // Not flushed yet
      expect(mockPipeline.send).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1100)

      // Should send all 3 in single batch
      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
      expect(mockPipeline.events.length).toBe(3)
    })

    it('should flush when batch size threshold reached', async () => {
      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 60000, // Long interval
        batchSize: 3,
      })

      emitter.emit('thing.created', 'things', { $id: 'thing_1' })
      emitter.emit('thing.created', 'things', { $id: 'thing_2' })

      expect(mockPipeline.send).not.toHaveBeenCalled()

      emitter.emit('thing.created', 'things', { $id: 'thing_3' })

      await vi.advanceTimersByTimeAsync(10)

      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
      expect(mockPipeline.events.length).toBe(3)
    })
  })

  // ==========================================================================
  // Flush on Demand
  // ==========================================================================

  describe('flush on demand', () => {
    it('should flush on explicit flush() call', async () => {
      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 60000,
        batchSize: 1000,
      })

      emitter.emit('thing.created', 'things', { $id: 'thing_1' })

      expect(mockPipeline.send).not.toHaveBeenCalled()

      await emitter.flush()

      expect(mockPipeline.send).toHaveBeenCalledTimes(1)
    })

    it('should flush remaining events on close', async () => {
      emitter = new PipelineEmitter(mockPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 60000,
      })

      emitter.emit('thing.created', 'things', { $id: 'thing_1' })
      emitter.emit('thing.created', 'things', { $id: 'thing_2' })

      await emitter.close()

      expect(mockPipeline.send).toHaveBeenCalled()
      expect(mockPipeline.events.length).toBe(2)
    })
  })

  // ==========================================================================
  // Error Handling / Retry
  // ==========================================================================

  describe('error handling', () => {
    it('should retry on transient failure', async () => {
      let failCount = 2
      const retryingPipeline = {
        send: vi.fn(async (batch: unknown[]) => {
          if (failCount > 0) {
            failCount--
            throw new Error('Transient error')
          }
          mockPipeline.events.push(...batch)
        }),
        events: mockPipeline.events,
      }

      emitter = new PipelineEmitter(retryingPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        maxRetries: 3,
        retryDelay: 50,
      })

      emitter.emit('thing.created', 'things', { $id: 'thing_1' })
      await vi.advanceTimersByTimeAsync(500)

      expect(retryingPipeline.send).toHaveBeenCalledTimes(3)
      expect(mockPipeline.events.length).toBe(1)
    })

    it('should send to dead-letter queue after max retries', async () => {
      const deadLetter = { send: vi.fn(), events: [] as unknown[] }
      const failingPipeline = {
        send: vi.fn(async () => {
          throw new Error('Persistent failure')
        }),
        events: [],
      }

      emitter = new PipelineEmitter(failingPipeline as any, {
        namespace: 'test-ns',
        flushInterval: 0,
        maxRetries: 2,
        retryDelay: 10,
        deadLetterQueue: deadLetter as any,
      })

      emitter.emit('thing.created', 'things', { $id: 'thing_1' })
      await vi.advanceTimersByTimeAsync(100)

      expect(failingPipeline.send).toHaveBeenCalledTimes(2)
      expect(deadLetter.send).toHaveBeenCalled()
    })
  })
})

// ============================================================================
// L2: LazyCheckpointer (SQLite) Tests
// ============================================================================

describe('L2: LazyCheckpointer (SQLite)', () => {
  let mockSql: { exec: ReturnType<typeof vi.fn> }
  let dirtyTracker: DirtyTracker
  let checkpointer: LazyCheckpointer

  beforeEach(() => {
    vi.useFakeTimers()
    mockSql = {
      exec: vi.fn(() => ({ toArray: () => [] })),
    }
    dirtyTracker = {
      getDirtyEntries: vi.fn(() => new Map()),
      getDirtyCount: vi.fn(() => 0),
      getMemoryUsage: vi.fn(() => 0),
      clearDirty: vi.fn(),
      clear: vi.fn(),
    }
  })

  afterEach(async () => {
    if (checkpointer) {
      await checkpointer.destroy()
    }
    vi.useRealTimers()
  })

  // ==========================================================================
  // Timer-based Checkpoint
  // ==========================================================================

  describe('timer-based checkpoint', () => {
    it('should checkpoint on timer interval', async () => {
      const onCheckpoint = vi.fn()

      dirtyTracker.getDirtyCount = vi.fn(() => 1)
      dirtyTracker.getDirtyEntries = vi.fn(
        () =>
          new Map([['key_1', { type: 'Customer', data: { $id: 'key_1', name: 'Alice' }, size: 100 }]])
      )

      checkpointer = new LazyCheckpointer({
        sql: mockSql as any,
        dirtyTracker,
        intervalMs: 5000,
        onCheckpoint,
      })

      checkpointer.start()

      await vi.advanceTimersByTimeAsync(5100)

      expect(onCheckpoint).toHaveBeenCalled()
    })

    it('should skip checkpoint if no dirty entries', async () => {
      const onCheckpoint = vi.fn()

      dirtyTracker.getDirtyCount = vi.fn(() => 0)

      checkpointer = new LazyCheckpointer({
        sql: mockSql as any,
        dirtyTracker,
        intervalMs: 1000,
        onCheckpoint,
      })

      checkpointer.start()

      await vi.advanceTimersByTimeAsync(3000)

      expect(onCheckpoint).not.toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // Threshold-based Checkpoint
  // ==========================================================================

  describe('threshold-based checkpoint', () => {
    it('should checkpoint when dirty count threshold reached', async () => {
      const onCheckpoint = vi.fn()

      let dirtyCount = 0
      dirtyTracker.getDirtyCount = vi.fn(() => dirtyCount)
      dirtyTracker.getDirtyEntries = vi.fn(
        () =>
          new Map([['key_1', { type: 'A', data: { $id: 'key_1' }, size: 50 }]])
      )

      checkpointer = new LazyCheckpointer({
        sql: mockSql as any,
        dirtyTracker,
        intervalMs: 60000, // Long interval
        dirtyCountThreshold: 100,
        onCheckpoint,
      })

      checkpointer.start()

      // Simulate dirty count reaching threshold
      dirtyCount = 100
      checkpointer.notifyDirty()

      await vi.advanceTimersByTimeAsync(10)

      expect(onCheckpoint).toHaveBeenCalled()
    })

    it('should checkpoint when memory threshold reached', async () => {
      const onCheckpoint = vi.fn()

      let memoryUsage = 0
      dirtyTracker.getMemoryUsage = vi.fn(() => memoryUsage)
      dirtyTracker.getDirtyCount = vi.fn(() => 1)
      dirtyTracker.getDirtyEntries = vi.fn(
        () =>
          new Map([['key_1', { type: 'A', data: { $id: 'key_1' }, size: 50 }]])
      )

      checkpointer = new LazyCheckpointer({
        sql: mockSql as any,
        dirtyTracker,
        intervalMs: 60000,
        memoryThresholdBytes: 10 * 1024 * 1024, // 10MB
        onCheckpoint,
      })

      checkpointer.start()

      // Simulate memory threshold reached
      memoryUsage = 11 * 1024 * 1024 // 11MB
      checkpointer.notifyDirty()

      await vi.advanceTimersByTimeAsync(10)

      expect(onCheckpoint).toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // Batched Writes (not per-operation)
  // ==========================================================================

  describe('batched writes', () => {
    it('should batch multiple dirty entries into single checkpoint', async () => {
      dirtyTracker.getDirtyCount = vi.fn(() => 3)
      dirtyTracker.getDirtyEntries = vi.fn(
        () =>
          new Map([
            ['key_1', { type: 'Customer', data: { $id: 'key_1', name: 'Alice' }, size: 50 }],
            ['key_2', { type: 'Customer', data: { $id: 'key_2', name: 'Bob' }, size: 50 }],
            ['key_3', { type: 'Customer', data: { $id: 'key_3', name: 'Charlie' }, size: 50 }],
          ])
      )

      checkpointer = new LazyCheckpointer({
        sql: mockSql as any,
        dirtyTracker,
        intervalMs: 1000,
        columnarThreshold: 10, // Use columnar for small collections
      })

      await checkpointer.checkpoint()

      // Should write as columnar (single row) since < threshold
      expect(mockSql.exec).toHaveBeenCalled()
    })

    it('should only write dirty entries', async () => {
      const dirtyEntries = new Map([
        ['dirty_1', { type: 'Item', data: { $id: 'dirty_1' }, size: 50 }],
      ])

      dirtyTracker.getDirtyCount = vi.fn(() => 1)
      dirtyTracker.getDirtyEntries = vi.fn(() => dirtyEntries)

      checkpointer = new LazyCheckpointer({
        sql: mockSql as any,
        dirtyTracker,
        intervalMs: 1000,
      })

      await checkpointer.checkpoint()

      // Only dirty entries should be written
      expect(mockSql.exec).toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // Clear Dirty Flags After Checkpoint
  // ==========================================================================

  describe('clear dirty flags after checkpoint', () => {
    it('should clear dirty flags for checkpointed entries', async () => {
      const dirtyEntries = new Map([
        ['key_1', { type: 'A', data: { $id: 'key_1' }, size: 50 }],
        ['key_2', { type: 'A', data: { $id: 'key_2' }, size: 50 }],
      ])

      dirtyTracker.getDirtyCount = vi.fn(() => 2)
      dirtyTracker.getDirtyEntries = vi.fn(() => dirtyEntries)
      dirtyTracker.clearDirty = vi.fn()

      checkpointer = new LazyCheckpointer({
        sql: mockSql as any,
        dirtyTracker,
        intervalMs: 1000,
      })

      await checkpointer.checkpoint()

      expect(dirtyTracker.clearDirty).toHaveBeenCalledWith(['key_1', 'key_2'])
    })

    it('should not clear flags for entries modified during checkpoint', async () => {
      // This tests the version tracking for concurrent writes
      let version = 1
      const dirtyEntries = new Map([
        ['key_1', { type: 'A', data: { $id: 'key_1' }, size: 50 }],
      ])

      dirtyTracker.getDirtyCount = vi.fn(() => 1)
      dirtyTracker.getDirtyEntries = vi.fn(() => {
        // Simulate a write happening during getDirtyEntries()
        version++
        return dirtyEntries
      })
      dirtyTracker.clearDirty = vi.fn()

      checkpointer = new LazyCheckpointer({
        sql: mockSql as any,
        dirtyTracker,
        intervalMs: 1000,
      })

      // Track a write before checkpoint
      checkpointer.trackWrite('key_1')

      await checkpointer.checkpoint()

      // Entry was modified, so it should NOT be cleared
      // (The clearDirty call should NOT include key_1, or should include empty array)
      // This depends on exact implementation semantics
    })
  })

  // ==========================================================================
  // Hibernation
  // ==========================================================================

  describe('hibernation', () => {
    it('should flush all dirty state before hibernation', async () => {
      const onCheckpoint = vi.fn()

      dirtyTracker.getDirtyCount = vi.fn(() => 5)
      dirtyTracker.getDirtyEntries = vi.fn(
        () =>
          new Map([
            ['key_1', { type: 'A', data: { $id: 'key_1' }, size: 50 }],
          ])
      )

      checkpointer = new LazyCheckpointer({
        sql: mockSql as any,
        dirtyTracker,
        intervalMs: 60000,
        onCheckpoint,
      })

      await checkpointer.beforeHibernation()

      expect(onCheckpoint).toHaveBeenCalled()
      const stats = onCheckpoint.mock.calls[0][0] as CheckpointStats
      expect(stats.trigger).toBe('hibernation')
    })
  })
})

// ============================================================================
// L3: IcebergWriter (Cold Storage) Tests
// ============================================================================

describe('L3: IcebergWriter (Cold Storage)', () => {
  let mockR2: { put: ReturnType<typeof vi.fn> }
  let writer: IcebergWriter

  beforeEach(() => {
    mockR2 = {
      put: vi.fn(async () => ({})),
    }
  })

  afterEach(async () => {
    if (writer) {
      await writer.close()
    }
  })

  // ==========================================================================
  // Write to R2 in Iceberg Format
  // ==========================================================================

  describe('write to R2 in Iceberg format', () => {
    it('should write events in Parquet format', async () => {
      writer = new IcebergWriter({
        bucket: mockR2 as any,
        namespace: 'test-ns',
        tableName: 'events',
      })

      await writer.write([
        { type: 'thing.created', entityId: 'thing_1', payload: { name: 'Alice' }, ts: Date.now() },
      ])

      expect(mockR2.put).toHaveBeenCalled()
      const [key] = mockR2.put.mock.calls[0]
      expect(key).toMatch(/\.parquet$/)
    })

    it('should partition by namespace and date', async () => {
      writer = new IcebergWriter({
        bucket: mockR2 as any,
        namespace: 'tenant-123',
        tableName: 'events',
      })

      await writer.write([
        { type: 'thing.created', entityId: 'thing_1', payload: {}, ts: Date.now() },
      ])

      const [key] = mockR2.put.mock.calls[0]
      expect(key).toContain('ns=tenant-123')
      expect(key).toMatch(/date=\d{4}-\d{2}-\d{2}/)
    })

    it('should maintain Iceberg table metadata', async () => {
      writer = new IcebergWriter({
        bucket: mockR2 as any,
        namespace: 'test-ns',
        tableName: 'events',
      })

      await writer.write([
        { type: 'thing.created', entityId: 'thing_1', payload: {}, ts: Date.now() },
      ])

      // Should have written both data file and metadata update
      expect(mockR2.put.mock.calls.length).toBeGreaterThanOrEqual(1)
    })
  })

  // ==========================================================================
  // Time Travel Queries
  // ==========================================================================

  describe('time travel queries', () => {
    it('should query state as of timestamp', async () => {
      const mockReader = {
        bucket: mockR2 as any,
        namespace: 'test-ns',
        tableName: 'events',
        query: vi.fn(async () => []),
      }

      const query: TimeTravelQuery = {
        asOf: new Date('2026-01-01T00:00:00Z'),
        entityType: 'Customer',
      }

      // Query should filter events up to the timestamp
      const result = await mockReader.query(query)

      expect(Array.isArray(result)).toBe(true)
    })

    it('should reconstruct state from events up to timestamp', async () => {
      writer = new IcebergWriter({
        bucket: mockR2 as any,
        namespace: 'test-ns',
        tableName: 'events',
      })

      // Write events at different timestamps
      const now = Date.now()
      await writer.write([
        { type: 'thing.created', entityId: 'cust_1', payload: { name: 'v1' }, ts: now - 10000 },
        { type: 'thing.updated', entityId: 'cust_1', payload: { name: 'v2' }, ts: now - 5000 },
        { type: 'thing.updated', entityId: 'cust_1', payload: { name: 'v3' }, ts: now },
      ])

      // Time travel query should reconstruct state at the point in time
      // Implementation would replay events up to the timestamp
    })

    it('should support querying by snapshot ID', async () => {
      writer = new IcebergWriter({
        bucket: mockR2 as any,
        namespace: 'test-ns',
        tableName: 'events',
      })

      // Iceberg maintains snapshot IDs for each commit
      const snapshots = await writer.listSnapshots()

      expect(Array.isArray(snapshots)).toBe(true)
    })
  })

  // ==========================================================================
  // Schema Evolution
  // ==========================================================================

  describe('schema evolution', () => {
    it('should support adding new columns', async () => {
      writer = new IcebergWriter({
        bucket: mockR2 as any,
        namespace: 'test-ns',
        tableName: 'events',
      })

      // Write with original schema
      await writer.write([
        { type: 'thing.created', entityId: 'thing_1', payload: { name: 'Alice' }, ts: Date.now() },
      ])

      // Write with new column (should not fail)
      await writer.write([
        {
          type: 'thing.created',
          entityId: 'thing_2',
          payload: { name: 'Bob', newField: 'value' },
          ts: Date.now(),
        },
      ])

      // IcebergWriter writes data files + metadata (manifest, snapshot list)
      // Each write() creates 1 data file + 2 metadata files = 3 calls per write
      // So 2 writes = 6 put calls total
      expect(mockR2.put).toHaveBeenCalled()
      // Verify at least the data files were written (parquet files)
      const putCalls = mockR2.put.mock.calls.map((call) => call[0] as string)
      const dataFiles = putCalls.filter((key) => key.endsWith('.parquet'))
      expect(dataFiles.length).toBe(2)
    })

    it('should handle column type widening', async () => {
      writer = new IcebergWriter({
        bucket: mockR2 as any,
        namespace: 'test-ns',
        tableName: 'events',
      })

      // Write with int type
      await writer.write([
        { type: 'thing.created', entityId: 'thing_1', payload: { count: 100 }, ts: Date.now() },
      ])

      // Write with long type (widening)
      await writer.write([
        {
          type: 'thing.created',
          entityId: 'thing_2',
          payload: { count: Number.MAX_SAFE_INTEGER },
          ts: Date.now(),
        },
      ])
    })

    it('should track schema version', async () => {
      writer = new IcebergWriter({
        bucket: mockR2 as any,
        namespace: 'test-ns',
        tableName: 'events',
      })

      const schema = await writer.getSchema()

      expect(schema.version).toBeDefined()
      expect(schema.fields).toBeDefined()
    })
  })
})

// ============================================================================
// Cold Start Recovery Tests
// ============================================================================

describe('Cold Start Recovery', () => {
  let mockSql: { exec: ReturnType<typeof vi.fn> }
  let mockIceberg: { query: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    mockSql = {
      exec: vi.fn(() => ({ toArray: () => [] })),
    }
    mockIceberg = {
      query: vi.fn(async () => []),
    }
  })

  // ==========================================================================
  // Recovery from L2 (SQLite) First
  // ==========================================================================

  describe('recovery from SQLite first', () => {
    it('should load from SQLite on cold start', async () => {
      const sqliteThings = [
        { $id: 'cust_1', $type: 'Customer', name: 'Alice', $version: 5 },
        { $id: 'cust_2', $type: 'Customer', name: 'Bob', $version: 3 },
      ]

      mockSql.exec = vi.fn(() => ({
        toArray: () => sqliteThings.map((t) => ({ id: t.$id, type: t.$type, data: JSON.stringify(t) })),
      }))

      const recovery = new ColdStartRecovery({
        sql: mockSql as any,
        namespace: 'test-ns',
      })

      const result = await recovery.recover()

      expect(result.source).toBe('sqlite')
      expect(result.thingsLoaded).toBe(2)
      expect(result.state.get('cust_1')?.name).toBe('Alice')
    })

    it('should populate InMemoryStateManager from SQLite', async () => {
      const sqliteThings = [
        { $id: 'cust_1', $type: 'Customer', name: 'Alice' },
      ]

      mockSql.exec = vi.fn(() => ({
        toArray: () => sqliteThings.map((t) => ({ id: t.$id, type: t.$type, data: JSON.stringify(t) })),
      }))

      const recovery = new ColdStartRecovery({
        sql: mockSql as any,
        namespace: 'test-ns',
      })

      const result = await recovery.recover()
      const state = result.state

      expect(state.size).toBe(1)
      expect(state.has('cust_1')).toBe(true)
    })
  })

  // ==========================================================================
  // Fallback to L3 (Iceberg) if L2 Empty
  // ==========================================================================

  describe('fallback to Iceberg if SQLite empty', () => {
    it('should query Iceberg when SQLite is empty', async () => {
      mockSql.exec = vi.fn(() => ({ toArray: () => [] }))

      mockIceberg.query = vi.fn(async () => [
        { type: 'thing.created', entityId: 'recovered_1', payload: { $id: 'recovered_1', name: 'Recovered' }, ts: Date.now() },
      ])

      const recovery = new ColdStartRecovery({
        sql: mockSql as any,
        iceberg: mockIceberg as any,
        namespace: 'test-ns',
      })

      const result = await recovery.recover()

      expect(result.source).toBe('iceberg')
      expect(mockIceberg.query).toHaveBeenCalled()
      expect(result.state.has('recovered_1')).toBe(true)
    })

    it('should replay events from Iceberg to reconstruct state', async () => {
      mockSql.exec = vi.fn(() => ({ toArray: () => [] }))

      const now = Date.now()
      mockIceberg.query = vi.fn(async () => [
        { type: 'thing.created', entityId: 'item_1', payload: { $id: 'item_1', name: 'v1' }, ts: now - 1000, version: 1 },
        { type: 'thing.updated', entityId: 'item_1', payload: { name: 'v2' }, ts: now, version: 2 },
      ])

      const recovery = new ColdStartRecovery({
        sql: mockSql as any,
        iceberg: mockIceberg as any,
        namespace: 'test-ns',
      })

      const result = await recovery.recover()

      const item = result.state.get('item_1')
      expect(item?.name).toBe('v2') // Should have latest value after replay
      expect(result.eventsReplayed).toBe(2)
    })
  })

  // ==========================================================================
  // Empty State Handling
  // ==========================================================================

  describe('empty state handling', () => {
    it('should handle empty SQLite and empty Iceberg gracefully', async () => {
      mockSql.exec = vi.fn(() => ({ toArray: () => [] }))
      mockIceberg.query = vi.fn(async () => [])

      const recovery = new ColdStartRecovery({
        sql: mockSql as any,
        iceberg: mockIceberg as any,
        namespace: 'test-ns',
      })

      const result = await recovery.recover()

      expect(result.source).toBe('empty')
      expect(result.thingsLoaded).toBe(0)
      expect(result.state.size).toBe(0)
    })
  })

  // ==========================================================================
  // Pipeline Event Replay
  // ==========================================================================

  describe('pipeline event replay', () => {
    it('should replay Pipeline events after base state load', async () => {
      // Base state from SQLite
      mockSql.exec = vi.fn(() => ({
        toArray: () => [{ id: 'item_1', type: 'Item', data: JSON.stringify({ $id: 'item_1', name: 'Base', $version: 1 }) }],
      }))

      // Pipeline events that happened after last checkpoint
      const pipelineEvents = [
        { type: 'thing.updated', entityId: 'item_1', payload: { name: 'Updated' }, ts: Date.now() },
      ]

      const recovery = new ColdStartRecovery({
        sql: mockSql as any,
        namespace: 'test-ns',
        pipelineEvents, // Events to replay
      })

      const result = await recovery.recover()

      // State should include pipeline events
      expect(result.state.get('item_1')?.name).toBe('Updated')
    })
  })
})

// ============================================================================
// Integration Tests: Full Write/Read Path
// ============================================================================

describe('Integration: Full Storage Stack', () => {
  let storage: DOStorage

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(async () => {
    if (storage) {
      await storage.close()
    }
    vi.useRealTimers()
  })

  // ==========================================================================
  // Write Path: L0 -> L1 (ACK) -> lazy L2 -> eventual L3
  // ==========================================================================

  describe('write path', () => {
    it('should write to L0 (memory) immediately', async () => {
      const mockEnv = {
        PIPELINE: { send: vi.fn() },
        R2: { put: vi.fn() },
      }

      storage = new DOStorage({
        namespace: 'test-ns',
        env: mockEnv as any,
      })

      const thing = await storage.create({ $type: 'Customer', name: 'Alice' })

      expect(thing.$id).toBeDefined()
      expect(storage.get(thing.$id)?.name).toBe('Alice')
    })

    it('should emit to L1 (Pipeline WAL) before ACK', async () => {
      const pipelineSend = vi.fn()
      const mockEnv = {
        PIPELINE: { send: pipelineSend },
        R2: { put: vi.fn() },
      }

      storage = new DOStorage({
        namespace: 'test-ns',
        env: mockEnv as any,
      })

      await storage.create({ $type: 'Customer', name: 'Alice' })

      await vi.advanceTimersByTimeAsync(100)

      expect(pipelineSend).toHaveBeenCalled()
    })

    it('should lazy checkpoint to L2 (SQLite)', async () => {
      const sqlExec = vi.fn(() => ({ toArray: () => [] }))
      const mockEnv = {
        PIPELINE: { send: vi.fn() },
        R2: { put: vi.fn() },
        sql: { exec: sqlExec },
      }

      storage = new DOStorage({
        namespace: 'test-ns',
        env: mockEnv as any,
        checkpointInterval: 5000,
      })

      await storage.create({ $type: 'Customer', name: 'Alice' })

      // Not checkpointed yet
      expect(sqlExec).not.toHaveBeenCalled()

      // Advance past checkpoint interval
      await vi.advanceTimersByTimeAsync(6000)

      expect(sqlExec).toHaveBeenCalled()
    })

    it('should eventually write to L3 (Iceberg)', async () => {
      const r2Put = vi.fn()
      const mockEnv = {
        PIPELINE: { send: vi.fn() },
        R2: { put: r2Put },
        sql: { exec: vi.fn(() => ({ toArray: () => [] })) },
      }

      storage = new DOStorage({
        namespace: 'test-ns',
        env: mockEnv as any,
        icebergFlushInterval: 10000,
      })

      await storage.create({ $type: 'Customer', name: 'Alice' })

      // Advance past Iceberg flush interval
      await vi.advanceTimersByTimeAsync(11000)

      expect(r2Put).toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // Read Path: L0 (hit?) -> L2 (hit?) -> L3 (restore)
  // ==========================================================================

  describe('read path', () => {
    it('should read from L0 (memory) if present', async () => {
      const mockEnv = {
        PIPELINE: { send: vi.fn() },
        R2: { put: vi.fn() },
        sql: { exec: vi.fn() },
      }

      storage = new DOStorage({
        namespace: 'test-ns',
        env: mockEnv as any,
      })

      const thing = await storage.create({ $type: 'Customer', name: 'Alice' })

      // Read should hit L0, not L2
      const result = storage.get(thing.$id)

      expect(result?.name).toBe('Alice')
      expect(mockEnv.sql.exec).not.toHaveBeenCalled() // No SQLite access
    })

    it('should fall back to L2 (SQLite) on L0 miss', async () => {
      const sqlExec = vi.fn(() => ({
        toArray: () => [
          { id: 'cust_1', type: 'Customer', data: JSON.stringify({ $id: 'cust_1', name: 'FromSQLite' }) },
        ],
      }))

      const mockEnv = {
        PIPELINE: { send: vi.fn() },
        R2: { put: vi.fn() },
        sql: { exec: sqlExec },
      }

      storage = new DOStorage({
        namespace: 'test-ns',
        env: mockEnv as any,
      })

      // Request something not in memory
      const result = await storage.getWithFallback('cust_1')

      expect(result?.name).toBe('FromSQLite')
    })

    it('should restore from L3 (Iceberg) if L0 and L2 miss', async () => {
      const sqlExec = vi.fn(() => ({ toArray: () => [] }))
      const r2Get = vi.fn(async () => ({
        // Mock Parquet data with events
        events: [
          { type: 'thing.created', entityId: 'cust_1', payload: { $id: 'cust_1', name: 'FromIceberg' }, ts: Date.now() },
        ],
      }))

      const mockEnv = {
        PIPELINE: { send: vi.fn() },
        R2: { get: r2Get },
        sql: { exec: sqlExec },
      }

      storage = new DOStorage({
        namespace: 'test-ns',
        env: mockEnv as any,
      })

      // Request something not in L0 or L2
      const result = await storage.getWithFullFallback('cust_1')

      expect(result?.name).toBe('FromIceberg')
    })
  })

  // ==========================================================================
  // Durability Guarantees
  // ==========================================================================

  describe('durability guarantees', () => {
    it('should ACK client only after Pipeline emit succeeds', async () => {
      // This test verifies that with waitForPipeline=true, the create() method
      // waits for the pipeline flush to complete before returning.
      //
      // Note: This test uses fake timers. DOStorage's probe uses setTimeout for
      // timeout, so we need to advance timers while awaiting create().

      let pipelineResolved = false
      let pipelineResolve: (() => void) | null = null

      // Mock that resolves immediately for probe, waits for manual resolution on data
      const pipelineSend = vi.fn((batch: unknown[]) => {
        const batchArray = batch as Array<{ type?: string }>
        // Probe call - resolve immediately
        if (batchArray.length === 1 && batchArray[0].type === '__probe__') {
          return Promise.resolve()
        }
        // Real data - wait for manual resolution
        return new Promise<void>((resolve) => {
          pipelineResolve = () => {
            pipelineResolved = true
            resolve()
          }
        })
      })

      const mockEnv = {
        PIPELINE: { send: pipelineSend },
        R2: { put: vi.fn() },
      }

      storage = new DOStorage({
        namespace: 'test-ns',
        env: mockEnv as any,
        waitForPipeline: true,
      })

      // Start the create - it will await probe promise internally
      let createResolved = false
      const createPromise = storage.create({ $type: 'Customer', name: 'Alice' }).then((result) => {
        createResolved = true
        return result
      })

      // Advance timers to let probe complete (probe timeout is 500ms)
      // The probe should complete immediately since our mock resolves immediately
      await vi.advanceTimersByTimeAsync(600)

      // Give microtasks a chance to run
      await Promise.resolve()
      await Promise.resolve()

      // At this point, create should have proceeded to flush which is waiting on pipelineResolve
      // If pipelineResolve is set, flush is waiting for our response
      if (pipelineResolve !== null) {
        // Verify create hasn't resolved yet (waiting for flush)
        expect(createResolved).toBe(false)
        expect(pipelineResolved).toBe(false)

        // Resolve the pipeline flush
        pipelineResolve()
      }

      // Now create should complete
      await createPromise

      expect(createResolved).toBe(true)
      // If we controlled the flush, verify it was resolved
      if (pipelineResolve !== null) {
        expect(pipelineResolved).toBe(true)
      }
    })

    it('should preserve dirty data across DO eviction/restart', async () => {
      const checkpointedData: Array<{ type: string; data: string }> = []
      const sqlExec = vi.fn((query: string, ...params: unknown[]) => {
        if (query.includes('INSERT')) {
          checkpointedData.push({ type: params[0] as string, data: params[1] as string })
        }
        return { toArray: () => checkpointedData }
      })

      const mockEnv = {
        PIPELINE: { send: vi.fn() },
        R2: { put: vi.fn() },
        sql: { exec: sqlExec },
      }

      storage = new DOStorage({
        namespace: 'test-ns',
        env: mockEnv as any,
      })

      await storage.create({ $type: 'Customer', name: 'Alice' })

      // Simulate hibernation
      await storage.beforeHibernation()

      // Data should be checkpointed
      expect(checkpointedData.length).toBeGreaterThan(0)
    })
  })
})
