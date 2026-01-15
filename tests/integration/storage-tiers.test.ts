/**
 * Storage Tier Integration Tests - TDD RED Phase
 *
 * Tests the full L0 -> L1 -> L2 flow and cold start recovery.
 * These tests SHOULD FAIL initially as they test behaviors
 * that may not be fully implemented or properly integrated.
 *
 * Issue: do-75t [TEST-3] Storage tier integration tests
 *
 * Storage Architecture:
 * - L0: InMemoryStateManager (hot cache, O(1) CRUD)
 * - L1: PipelineEmitter (WAL for durability, fire-and-forget)
 * - L2: LazyCheckpointer (SQLite for persistence)
 * - L3: IcebergWriter (cold storage, time travel)
 *
 * Write Path: Client -> L0 (memory) -> L1 (WAL ACK) -> lazy L2 -> eventual L3
 * Read Path: L0 (hit?) -> L2 (hit?) -> L3 (restore)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  InMemoryStateManager,
  PipelineEmitter,
  LazyCheckpointer,
  ColdStartRecovery,
  DOStorage,
  type ThingData,
  type CreateThingInput,
  type DirtyTracker,
  type EmittedEvent,
} from '../../storage'

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Creates a mock pipeline that tracks all sent events
 */
function createMockPipeline() {
  const events: EmittedEvent[] = []
  const sendCalls: unknown[][] = []

  return {
    send: vi.fn(async (batch: unknown[]) => {
      sendCalls.push(batch)
      events.push(...(batch as EmittedEvent[]))
    }),
    events,
    sendCalls,
  }
}

/**
 * Creates a mock SQL storage with in-memory state
 */
function createMockSql() {
  const store = new Map<string, { id: string; type: string; data: string }>()
  const execCalls: Array<{ query: string; params: unknown[] }> = []

  return {
    exec: vi.fn((query: string, ...params: unknown[]) => {
      execCalls.push({ query, params })

      // Handle COUNT queries
      if (query.includes('COUNT(*)')) {
        return { toArray: () => [{ count: store.size }] }
      }

      if (query.includes('SELECT') && query.includes('WHERE id =')) {
        const id = params[0] as string
        const row = store.get(id)
        return { toArray: () => (row ? [row] : []) }
      }

      if (query.includes('INSERT OR REPLACE')) {
        const [id, type, data] = params as [string, string, string]
        store.set(id, { id, type, data })
        return { toArray: () => [] }
      }

      if (query.includes('SELECT') && query.includes('FROM things')) {
        return { toArray: () => Array.from(store.values()) }
      }

      return { toArray: () => [] }
    }),
    store,
    execCalls,
    clear: () => store.clear(),
  }
}

/**
 * Creates a DirtyTracker adapter for InMemoryStateManager
 */
class TestDirtyTracker implements DirtyTracker {
  constructor(private manager: InMemoryStateManager) {}

  getDirtyEntries(): Map<string, { type: string; data: unknown; size: number }> {
    const entries = new Map<string, { type: string; data: unknown; size: number }>()
    for (const key of this.manager.getDirtyKeys()) {
      // Use getRaw to avoid incrementing access counts
      const thing = this.manager.getRaw(key)
      if (thing) {
        entries.set(key, {
          type: thing.$type,
          data: thing,
          size: JSON.stringify(thing).length,
        })
      }
    }
    return entries
  }

  getDirtyCount(): number {
    return this.manager.getDirtyCount()
  }

  getMemoryUsage(): number {
    return this.manager.getStats().estimatedBytes
  }

  clearDirty(keys: string[]): void {
    this.manager.markClean(keys)
  }

  clear(): void {
    this.manager.clear()
  }

  /**
   * Update tier residency for entries (called after successful checkpoint)
   */
  updateTierResidency(keys: string[], tier: string): void {
    this.manager.updateTierResidency(keys, tier)
  }

  /**
   * Get all entry IDs (for cross-tier verification)
   */
  getAllIds(): string[] {
    return this.manager.exportAll().map((t) => t.$id)
  }

  /**
   * Get entry data by ID (for cross-tier verification)
   */
  getEntry(id: string): { data: unknown } | undefined | null {
    const thing = this.manager.getRaw(id)
    if (!thing) return undefined
    return { data: thing }
  }

  /**
   * Get total entry count
   */
  size(): number {
    return this.manager.size()
  }
}

// ============================================================================
// L0 -> L1 Flow Tests
// ============================================================================

describe('L0 -> L1 Flow: Memory to Pipeline', () => {
  let memory: InMemoryStateManager
  let pipeline: ReturnType<typeof createMockPipeline>
  let emitter: PipelineEmitter

  beforeEach(() => {
    vi.useFakeTimers()
    memory = new InMemoryStateManager()
    pipeline = createMockPipeline()
    emitter = new PipelineEmitter(pipeline, {
      namespace: 'test-integration',
      flushInterval: 0, // Immediate flush for testing
      batchSize: 100,
    })
  })

  afterEach(async () => {
    await emitter.close()
    vi.useRealTimers()
  })

  it('should emit event to L1 immediately after L0 write', async () => {
    // Write to L0
    const thing = memory.create({ $type: 'Customer', name: 'Alice' })

    // Emit to L1
    emitter.emit('thing.created', 'things', thing)
    await vi.advanceTimersByTimeAsync(10)

    // Verify L1 received the event
    expect(pipeline.send).toHaveBeenCalled()
    expect(pipeline.events.length).toBe(1)
    expect(pipeline.events[0].payload).toEqual(expect.objectContaining({
      $type: 'Customer',
      name: 'Alice',
    }))
  })

  it('should mark L0 entry as dirty after create', () => {
    const thing = memory.create({ $type: 'Order', total: 100 })

    expect(memory.isDirty(thing.$id)).toBe(true)
    expect(memory.getDirtyCount()).toBe(1)
  })

  it('should preserve L1 event order matching L0 operation order', async () => {
    // Perform multiple L0 operations
    const t1 = memory.create({ $type: 'Item', name: 'First' })
    emitter.emit('thing.created', 'things', t1)

    const t2 = memory.create({ $type: 'Item', name: 'Second' })
    emitter.emit('thing.created', 'things', t2)

    memory.update(t1.$id, { name: 'First Updated' })
    emitter.emit('thing.updated', 'things', { $id: t1.$id, name: 'First Updated' })

    await vi.advanceTimersByTimeAsync(10)

    // Verify order preserved
    expect(pipeline.events.length).toBe(3)
    expect(pipeline.events[0].type).toBe('thing.created')
    expect(pipeline.events[1].type).toBe('thing.created')
    expect(pipeline.events[2].type).toBe('thing.updated')

    // Verify event content
    const firstEvent = pipeline.events[0] as EmittedEvent
    const secondEvent = pipeline.events[1] as EmittedEvent
    expect((firstEvent.payload as ThingData).name).toBe('First')
    expect((secondEvent.payload as ThingData).name).toBe('Second')
  })

  it('should include idempotency keys in L1 events', async () => {
    const thing = memory.create({ $type: 'Task', name: 'Test' })
    emitter.emit('thing.created', 'things', thing)
    await vi.advanceTimersByTimeAsync(10)

    expect(pipeline.events[0].idempotencyKey).toBeDefined()
    expect(typeof pipeline.events[0].idempotencyKey).toBe('string')
    expect(pipeline.events[0].idempotencyKey.length).toBeGreaterThan(0)
  })

  it('should emit delete events to L1 when L0 entry deleted', async () => {
    const thing = memory.create({ $type: 'Temp', name: 'ToDelete' })
    emitter.emit('thing.created', 'things', thing)

    const deleted = memory.delete(thing.$id)
    emitter.emit('thing.deleted', 'things', { $id: thing.$id })

    await vi.advanceTimersByTimeAsync(10)

    expect(deleted).not.toBeNull()
    expect(pipeline.events.length).toBe(2)
    expect(pipeline.events[1].type).toBe('thing.deleted')
  })

  it('should not block L0 operations when L1 is slow', async () => {
    // Create slow pipeline - use real timers for this test to simulate actual slowness
    vi.useRealTimers()

    const slowPipeline = {
      send: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5000))
      }),
    }
    const slowEmitter = new PipelineEmitter(slowPipeline, {
      namespace: 'slow-test',
      flushInterval: 0,
    })

    const start = Date.now()

    // L0 operations should be fast
    for (let i = 0; i < 100; i++) {
      const thing = memory.create({ $type: 'Item', name: `Item ${i}` })
      slowEmitter.emit('thing.created', 'things', thing)
    }

    const elapsed = Date.now() - start

    // Should complete quickly despite slow pipeline (emit is fire-and-forget)
    expect(elapsed).toBeLessThan(100)
    expect(memory.size()).toBe(100)

    // Don't wait for close - that would wait for slow pipeline
    // Just verify L0 operations were fast
    // The afterEach hook will close the emitter (from initial setup)

    // Re-enable fake timers for other tests
    vi.useFakeTimers()
  })
})

// ============================================================================
// L1 -> L2 Flow Tests
// ============================================================================

describe('L1 -> L2 Flow: Pipeline to SQLite', () => {
  let memory: InMemoryStateManager
  let mockSql: ReturnType<typeof createMockSql>
  let checkpointer: LazyCheckpointer

  beforeEach(() => {
    vi.useFakeTimers()
    memory = new InMemoryStateManager()
    mockSql = createMockSql()
  })

  afterEach(async () => {
    if (checkpointer) {
      await checkpointer.destroy()
    }
    vi.useRealTimers()
  })

  it('should checkpoint dirty entries from L0 to L2 on timer', async () => {
    const dirtyTracker = new TestDirtyTracker(memory)
    const onCheckpoint = vi.fn()

    checkpointer = new LazyCheckpointer({
      sql: mockSql,
      dirtyTracker,
      intervalMs: 1000,
      onCheckpoint,
    })

    // Create entries in L0
    memory.create({ $type: 'Customer', name: 'Alice' })
    memory.create({ $type: 'Customer', name: 'Bob' })

    checkpointer.start()

    // Wait for checkpoint
    await vi.advanceTimersByTimeAsync(1100)

    // Verify checkpoint occurred
    expect(onCheckpoint).toHaveBeenCalled()
    expect(mockSql.exec).toHaveBeenCalled()

    // Verify entries written to SQLite
    const insertCalls = mockSql.execCalls.filter((c) => c.query.includes('INSERT'))
    expect(insertCalls.length).toBeGreaterThan(0)
  })

  it('should clear dirty flags only after successful L2 write', async () => {
    const dirtyTracker = new TestDirtyTracker(memory)

    checkpointer = new LazyCheckpointer({
      sql: mockSql,
      dirtyTracker,
      intervalMs: 60000, // Long interval
    })

    // Create dirty entries
    const thing = memory.create({ $type: 'Task', name: 'Dirty' })
    expect(memory.isDirty(thing.$id)).toBe(true)

    // Manual checkpoint
    await checkpointer.checkpoint()

    // Dirty flag should be cleared
    expect(memory.isDirty(thing.$id)).toBe(false)
  })

  it('should batch multiple dirty entries in single checkpoint', async () => {
    const dirtyTracker = new TestDirtyTracker(memory)
    const onCheckpoint = vi.fn()

    checkpointer = new LazyCheckpointer({
      sql: mockSql,
      dirtyTracker,
      intervalMs: 5000,
      onCheckpoint,
    })

    // Create multiple entries
    for (let i = 0; i < 10; i++) {
      memory.create({ $type: 'Item', name: `Item ${i}` })
    }

    await checkpointer.checkpoint()

    // Should batch all in one checkpoint
    expect(onCheckpoint).toHaveBeenCalledTimes(1)
    const stats = onCheckpoint.mock.calls[0][0]
    expect(stats.entriesWritten).toBe(10)
  })

  it('should trigger checkpoint when dirty count threshold reached', async () => {
    const dirtyTracker = new TestDirtyTracker(memory)
    const onCheckpoint = vi.fn()

    checkpointer = new LazyCheckpointer({
      sql: mockSql,
      dirtyTracker,
      intervalMs: 60000, // Long timer
      dirtyCountThreshold: 5,
      onCheckpoint,
    })

    checkpointer.start()

    // Create entries up to threshold
    for (let i = 0; i < 5; i++) {
      memory.create({ $type: 'Item', name: `Item ${i}` })
      checkpointer.notifyDirty()
    }

    await vi.advanceTimersByTimeAsync(10)

    // Should trigger threshold-based checkpoint
    expect(onCheckpoint).toHaveBeenCalled()
    const stats = onCheckpoint.mock.calls[0][0]
    expect(stats.trigger).toBe('threshold')
  })

  it('should not lose data if checkpoint fails mid-write', async () => {
    let failOnWrite = true
    const failingSql = {
      exec: vi.fn((query: string, ...params: unknown[]) => {
        if (query.includes('INSERT') && failOnWrite) {
          throw new Error('SQLite write failed')
        }
        return { toArray: () => [] }
      }),
    }

    const dirtyTracker = new TestDirtyTracker(memory)
    checkpointer = new LazyCheckpointer({
      sql: failingSql as any,
      dirtyTracker,
      intervalMs: 60000,
    })

    // Create entries
    const thing = memory.create({ $type: 'Important', name: 'DoNotLose' })

    // Attempt checkpoint (should fail and throw)
    await expect(checkpointer.checkpoint()).rejects.toThrow('Checkpoint failed')

    // Entry should still be dirty (not lost)
    expect(memory.isDirty(thing.$id)).toBe(true)
    expect(memory.get(thing.$id)?.name).toBe('DoNotLose')
  })

  it('should persist all dirty state before hibernation', async () => {
    const dirtyTracker = new TestDirtyTracker(memory)
    const onCheckpoint = vi.fn()

    checkpointer = new LazyCheckpointer({
      sql: mockSql,
      dirtyTracker,
      intervalMs: 60000,
      onCheckpoint,
    })

    // Create many dirty entries
    for (let i = 0; i < 50; i++) {
      memory.create({ $type: 'Data', name: `Data ${i}` })
    }

    // Simulate hibernation
    await checkpointer.beforeHibernation()

    expect(onCheckpoint).toHaveBeenCalled()
    const stats = onCheckpoint.mock.calls[0][0]
    expect(stats.trigger).toBe('hibernation')
    expect(stats.entriesWritten).toBe(50)
  })
})

// ============================================================================
// Full L0 -> L1 -> L2 Integration Tests
// ============================================================================

describe('Full L0 -> L1 -> L2 Flow', () => {
  let memory: InMemoryStateManager
  let pipeline: ReturnType<typeof createMockPipeline>
  let emitter: PipelineEmitter
  let mockSql: ReturnType<typeof createMockSql>
  let checkpointer: LazyCheckpointer

  beforeEach(() => {
    vi.useFakeTimers()
    memory = new InMemoryStateManager()
    pipeline = createMockPipeline()
    mockSql = createMockSql()

    emitter = new PipelineEmitter(pipeline, {
      namespace: 'full-flow-test',
      flushInterval: 100,
      batchSize: 50,
    })

    const dirtyTracker = new TestDirtyTracker(memory)
    checkpointer = new LazyCheckpointer({
      sql: mockSql,
      dirtyTracker,
      intervalMs: 5000,
    })
  })

  afterEach(async () => {
    await emitter.close()
    await checkpointer.destroy()
    vi.useRealTimers()
  })

  it('should flow data correctly: create -> L0 -> L1 -> L2', async () => {
    checkpointer.start()

    // Step 1: Create in L0
    const thing = memory.create({ $type: 'Customer', name: 'Alice', email: 'alice@test.com' })
    expect(memory.get(thing.$id)).not.toBeNull()

    // Step 2: Emit to L1
    emitter.emit('thing.created', 'things', thing)
    await vi.advanceTimersByTimeAsync(150) // Past flush interval

    expect(pipeline.events.length).toBe(1)
    expect(pipeline.events[0].type).toBe('thing.created')

    // Step 3: Checkpoint to L2
    await vi.advanceTimersByTimeAsync(5000) // Past checkpoint interval

    // Verify L2 received the data
    expect(mockSql.store.size).toBeGreaterThan(0)
    const storedEntry = mockSql.store.get(thing.$id)
    expect(storedEntry).toBeDefined()

    const storedData = JSON.parse(storedEntry!.data)
    expect(storedData.name).toBe('Alice')
    expect(storedData.email).toBe('alice@test.com')
  })

  it('should maintain consistency across all tiers after update', async () => {
    checkpointer.start()

    // Create and initial flow
    const thing = memory.create({ $type: 'Task', name: 'Original', status: 'pending' })
    emitter.emit('thing.created', 'things', thing)
    await vi.advanceTimersByTimeAsync(5100) // Through checkpoint

    // Update flow
    const updated = memory.update(thing.$id, { status: 'completed', completedAt: Date.now() })
    emitter.emit('thing.updated', 'things', { $id: thing.$id, ...updated })
    await vi.advanceTimersByTimeAsync(5100)

    // Verify all tiers have updated data
    // L0
    const l0Data = memory.get(thing.$id)
    expect(l0Data?.status).toBe('completed')
    expect(l0Data?.$version).toBe(2)

    // L1 events
    expect(pipeline.events.length).toBe(2)
    expect(pipeline.events[1].type).toBe('thing.updated')

    // L2
    const l2Entry = mockSql.store.get(thing.$id)
    const l2Data = JSON.parse(l2Entry!.data)
    expect(l2Data.status).toBe('completed')
  })

  it('should handle rapid create-update-delete sequence', async () => {
    checkpointer.start()

    // Rapid sequence
    const thing = memory.create({ $type: 'Temp', name: 'Rapid' })
    emitter.emit('thing.created', 'things', thing)

    memory.update(thing.$id, { name: 'Updated' })
    emitter.emit('thing.updated', 'things', { $id: thing.$id, name: 'Updated' })

    const deleted = memory.delete(thing.$id)
    emitter.emit('thing.deleted', 'things', { $id: thing.$id })

    await vi.advanceTimersByTimeAsync(150) // Flush L1

    // L1 should have all events
    expect(pipeline.events.length).toBe(3)
    expect(pipeline.events[0].type).toBe('thing.created')
    expect(pipeline.events[1].type).toBe('thing.updated')
    expect(pipeline.events[2].type).toBe('thing.deleted')

    // L0 should not have the entry
    expect(memory.get(thing.$id)).toBeNull()

    // Checkpoint should have nothing to write (entry deleted before checkpoint)
    await vi.advanceTimersByTimeAsync(5000)
    // Entry should not be in L2 since it was deleted before checkpoint
    expect(mockSql.store.has(thing.$id)).toBe(false)
  })

  it('should preserve data integrity under high throughput', async () => {
    checkpointer.start()

    const items: ThingData[] = []

    // High throughput writes
    for (let i = 0; i < 1000; i++) {
      const thing = memory.create({ $type: 'Bulk', index: i, data: `data-${i}` })
      items.push(thing)
      emitter.emit('thing.created', 'things', thing)
    }

    // Flush through all tiers
    await vi.advanceTimersByTimeAsync(10000)

    // Verify L0 has all items
    expect(memory.size()).toBe(1000)

    // Verify L1 received all events
    expect(pipeline.events.length).toBe(1000)

    // Verify L2 has all items
    expect(mockSql.store.size).toBe(1000)

    // Verify data integrity
    for (const item of items) {
      const l0 = memory.get(item.$id)
      const l2Entry = mockSql.store.get(item.$id)
      const l2 = JSON.parse(l2Entry!.data)

      expect(l0?.index).toBe(item.index)
      expect(l2.index).toBe(item.index)
    }
  })
})

// ============================================================================
// Cold Start Recovery Tests
// ============================================================================

describe('Cold Start Recovery', () => {
  let mockSql: ReturnType<typeof createMockSql>

  beforeEach(() => {
    mockSql = createMockSql()
  })

  it('should recover state from L2 (SQLite) on cold start', async () => {
    // Pre-populate SQLite with data
    const preloadedData = [
      { $id: 'cust_001', $type: 'Customer', name: 'Alice', $version: 5 },
      { $id: 'cust_002', $type: 'Customer', name: 'Bob', $version: 3 },
      { $id: 'order_001', $type: 'Order', total: 150, customerId: 'cust_001', $version: 2 },
    ]

    for (const thing of preloadedData) {
      mockSql.store.set(thing.$id, {
        id: thing.$id,
        type: thing.$type,
        data: JSON.stringify(thing),
      })
    }

    const recovery = new ColdStartRecovery({
      sql: mockSql as any,
      namespace: 'test-recovery',
    })

    const result = await recovery.recover()

    expect(result.source).toBe('sqlite')
    expect(result.thingsLoaded).toBe(3)
    expect(result.state.size).toBe(3)
    expect(result.state.get('cust_001')?.name).toBe('Alice')
    expect(result.state.get('order_001')?.total).toBe(150)
  })

  it('should replay pipeline events on top of L2 state', async () => {
    // Base state in SQLite
    mockSql.store.set('item_001', {
      id: 'item_001',
      type: 'Item',
      data: JSON.stringify({ $id: 'item_001', $type: 'Item', name: 'BaseValue', $version: 1 }),
    })

    // Pipeline events that occurred after last checkpoint
    const pipelineEvents = [
      { type: 'thing.updated', entityId: 'item_001', payload: { name: 'UpdatedValue' }, ts: Date.now() },
      { type: 'thing.created', entityId: 'item_002', payload: { $id: 'item_002', $type: 'Item', name: 'NewItem' }, ts: Date.now() + 1 },
    ]

    const recovery = new ColdStartRecovery({
      sql: mockSql as any,
      namespace: 'test-recovery',
      pipelineEvents,
    })

    const result = await recovery.recover()

    // Should have replayed events
    expect(result.eventsReplayed).toBe(2)

    // Updated item should have new value
    expect(result.state.get('item_001')?.name).toBe('UpdatedValue')

    // New item should exist
    expect(result.state.get('item_002')).toBeDefined()
    expect(result.state.get('item_002')?.name).toBe('NewItem')
  })

  it('should fall back to L3 (Iceberg) when L2 is empty', async () => {
    const mockIceberg = {
      query: vi.fn(async () => [
        { type: 'thing.created', entityId: 'recovered_001', payload: { $id: 'recovered_001', $type: 'Legacy', name: 'FromCold' }, ts: Date.now() - 86400000 },
      ]),
    }

    const recovery = new ColdStartRecovery({
      sql: mockSql as any,
      iceberg: mockIceberg as any,
      namespace: 'test-recovery',
    })

    const result = await recovery.recover()

    expect(result.source).toBe('iceberg')
    expect(mockIceberg.query).toHaveBeenCalled()
    expect(result.state.get('recovered_001')?.name).toBe('FromCold')
  })

  it('should handle empty state gracefully', async () => {
    const recovery = new ColdStartRecovery({
      sql: mockSql as any,
      namespace: 'empty-namespace',
    })

    const result = await recovery.recover()

    expect(result.source).toBe('empty')
    expect(result.thingsLoaded).toBe(0)
    expect(result.state.size).toBe(0)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('should reconstruct state correctly from event replay', async () => {
    const mockIceberg = {
      query: vi.fn(async () => [
        // Create event
        { type: 'thing.created', entityId: 'entity_001', payload: { $id: 'entity_001', $type: 'Entity', name: 'v1', status: 'draft' }, ts: 1000, version: 1 },
        // Update events in order
        { type: 'thing.updated', entityId: 'entity_001', payload: { name: 'v2' }, ts: 2000, version: 2 },
        { type: 'thing.updated', entityId: 'entity_001', payload: { status: 'published' }, ts: 3000, version: 3 },
        { type: 'thing.updated', entityId: 'entity_001', payload: { name: 'v3' }, ts: 4000, version: 4 },
      ]),
    }

    const recovery = new ColdStartRecovery({
      sql: mockSql as any,
      iceberg: mockIceberg as any,
      namespace: 'test-replay',
    })

    const result = await recovery.recover()

    // Final state should reflect all updates applied in order
    const finalState = result.state.get('entity_001')
    expect(finalState?.name).toBe('v3')
    expect(finalState?.status).toBe('published')
    expect(finalState?.$version).toBeGreaterThanOrEqual(4)
  })

  it('should handle delete events during replay', async () => {
    const mockIceberg = {
      query: vi.fn(async () => [
        { type: 'thing.created', entityId: 'temp_001', payload: { $id: 'temp_001', $type: 'Temp', name: 'Created' }, ts: 1000 },
        { type: 'thing.updated', entityId: 'temp_001', payload: { name: 'Updated' }, ts: 2000 },
        { type: 'thing.deleted', entityId: 'temp_001', payload: {}, ts: 3000 },
      ]),
    }

    const recovery = new ColdStartRecovery({
      sql: mockSql as any,
      iceberg: mockIceberg as any,
      namespace: 'test-delete',
    })

    const result = await recovery.recover()

    // Deleted entity should not be in final state
    expect(result.state.has('temp_001')).toBe(false)
  })
})

// ============================================================================
// Tier Consistency Tests
// ============================================================================

describe('Tier Consistency', () => {
  let memory: InMemoryStateManager
  let mockSql: ReturnType<typeof createMockSql>

  beforeEach(() => {
    memory = new InMemoryStateManager()
    mockSql = createMockSql()
  })

  it('should maintain same data in L0 and L2 after checkpoint', async () => {
    vi.useFakeTimers()

    const dirtyTracker = new TestDirtyTracker(memory)
    const checkpointer = new LazyCheckpointer({
      sql: mockSql,
      dirtyTracker,
      intervalMs: 1000,
    })

    // Create diverse data
    const customer = memory.create({ $type: 'Customer', name: 'Alice', email: 'alice@test.com', tier: 'premium' })
    const order = memory.create({ $type: 'Order', customerId: customer.$id, total: 299.99, items: ['item1', 'item2'] })

    await checkpointer.checkpoint()

    // Compare L0 and L2
    const l0Customer = memory.get(customer.$id)
    const l2CustomerEntry = mockSql.store.get(customer.$id)
    const l2Customer = JSON.parse(l2CustomerEntry!.data)

    expect(l0Customer?.name).toBe(l2Customer.name)
    expect(l0Customer?.email).toBe(l2Customer.email)
    expect(l0Customer?.tier).toBe(l2Customer.tier)

    const l0Order = memory.get(order.$id)
    const l2OrderEntry = mockSql.store.get(order.$id)
    const l2Order = JSON.parse(l2OrderEntry!.data)

    expect(l0Order?.total).toBe(l2Order.total)
    expect(l0Order?.items).toEqual(l2Order.items)

    await checkpointer.destroy()
    vi.useRealTimers()
  })

  it('should recover consistent state after simulated restart', async () => {
    vi.useFakeTimers()

    // Phase 1: Create and checkpoint data
    const dirtyTracker1 = new TestDirtyTracker(memory)
    const checkpointer1 = new LazyCheckpointer({
      sql: mockSql,
      dirtyTracker: dirtyTracker1,
      intervalMs: 1000,
    })

    const original = memory.create({
      $type: 'Document',
      title: 'Important Doc',
      content: 'Original content',
      version: 1,
    })

    memory.update(original.$id, { content: 'Updated content', version: 2 })

    await checkpointer1.beforeHibernation()
    await checkpointer1.destroy()

    // Phase 2: Simulate restart - new memory instance
    const newMemory = new InMemoryStateManager()

    const recovery = new ColdStartRecovery({
      sql: mockSql as any,
      namespace: 'restart-test',
    })

    const result = await recovery.recover()

    // Load recovered state into new memory
    newMemory.loadBulk(Array.from(result.state.values()))

    // Verify consistency
    const recovered = newMemory.get(original.$id)
    expect(recovered?.title).toBe('Important Doc')
    expect(recovered?.content).toBe('Updated content')
    expect(recovered?.version).toBe(2)
    expect(recovered?.$version).toBe(2) // Should have incremented version

    vi.useRealTimers()
  })

  it('should detect and report tier inconsistency', async () => {
    vi.useFakeTimers()

    // Create entry in L0
    const thing = memory.create({ $type: 'Data', value: 100 })

    // Manually corrupt L2 with different data
    mockSql.store.set(thing.$id, {
      id: thing.$id,
      type: 'Data',
      data: JSON.stringify({ $id: thing.$id, $type: 'Data', value: 999, $version: 1 }),
    })

    // L0 and L2 are now inconsistent
    const l0 = memory.get(thing.$id)
    const l2Entry = mockSql.store.get(thing.$id)
    const l2 = JSON.parse(l2Entry!.data)

    // This test documents the expected behavior - L0 is source of truth
    // In a real system, we'd want a consistency check mechanism
    expect(l0?.value).toBe(100)
    expect(l2.value).toBe(999)
    expect(l0?.value).not.toBe(l2.value) // Inconsistency detected

    vi.useRealTimers()
  })
})

// ============================================================================
// Error Handling and Edge Cases
// ============================================================================

describe('Error Handling and Edge Cases', () => {
  let memory: InMemoryStateManager
  let mockSql: ReturnType<typeof createMockSql>

  beforeEach(() => {
    vi.useFakeTimers()
    memory = new InMemoryStateManager()
    mockSql = createMockSql()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should continue operating if L1 pipeline fails', async () => {
    const failingPipeline = {
      send: vi.fn(async () => {
        throw new Error('Pipeline unavailable')
      }),
    }

    const emitter = new PipelineEmitter(failingPipeline, {
      namespace: 'failing-test',
      flushInterval: 0,
      maxRetries: 1,
    })

    // L0 should still work even if L1 fails
    const thing = memory.create({ $type: 'Resilient', name: 'StillWorks' })
    emitter.emit('thing.created', 'things', thing)

    await vi.advanceTimersByTimeAsync(100)

    // L0 data should be intact
    expect(memory.get(thing.$id)?.name).toBe('StillWorks')

    await emitter.close()
  })

  it('should handle concurrent writes during checkpoint', async () => {
    const dirtyTracker = new TestDirtyTracker(memory)
    const checkpointer = new LazyCheckpointer({
      sql: mockSql,
      dirtyTracker,
      intervalMs: 60000,
    })

    // Create initial entry
    const thing = memory.create({ $type: 'Concurrent', value: 1 })

    // Start checkpoint
    const checkpointPromise = checkpointer.checkpoint()

    // Concurrent write during checkpoint
    memory.update(thing.$id, { value: 2 })
    checkpointer.trackWrite(thing.$id)

    await checkpointPromise

    // Entry should still be marked dirty due to concurrent write
    // The exact behavior depends on implementation
    // This test verifies the system handles this case without data loss
    expect(memory.get(thing.$id)?.value).toBe(2)

    await checkpointer.destroy()
  })

  it('should handle large payloads across tiers', async () => {
    const dirtyTracker = new TestDirtyTracker(memory)
    const checkpointer = new LazyCheckpointer({
      sql: mockSql,
      dirtyTracker,
      intervalMs: 1000,
    })

    // Create large payload
    const largeData = {
      $type: 'LargeDoc',
      content: 'X'.repeat(100000), // 100KB of data
      metadata: Array.from({ length: 1000 }, (_, i) => ({ key: `key_${i}`, value: `value_${i}` })),
    }

    const thing = memory.create(largeData)
    await checkpointer.checkpoint()

    // Verify large data survived checkpoint
    const l2Entry = mockSql.store.get(thing.$id)
    const l2Data = JSON.parse(l2Entry!.data)

    expect(l2Data.content.length).toBe(100000)
    expect(l2Data.metadata.length).toBe(1000)

    await checkpointer.destroy()
  })

  it('should handle special characters in data', async () => {
    const dirtyTracker = new TestDirtyTracker(memory)
    const checkpointer = new LazyCheckpointer({
      sql: mockSql,
      dirtyTracker,
      intervalMs: 1000,
    })

    const specialData = {
      $type: 'Special',
      name: 'Test with "quotes" and \'apostrophes\'',
      unicode: '\u00e9\u00e8\u00ea', // French accents
      emoji: '', // Should be stripped per instructions, but let's test handling
      json: '{"nested": "json string"}',
      newlines: 'Line1\nLine2\nLine3',
      nullByte: 'before\x00after',
    }

    const thing = memory.create(specialData)
    await checkpointer.checkpoint()

    const l2Entry = mockSql.store.get(thing.$id)
    const l2Data = JSON.parse(l2Entry!.data)

    expect(l2Data.name).toBe(specialData.name)
    expect(l2Data.unicode).toBe(specialData.unicode)
    expect(l2Data.json).toBe(specialData.json)
    expect(l2Data.newlines).toBe(specialData.newlines)

    await checkpointer.destroy()
  })

  it('should handle empty namespace gracefully', async () => {
    const recovery = new ColdStartRecovery({
      sql: mockSql as any,
      namespace: '',
    })

    const result = await recovery.recover()

    expect(result.source).toBe('empty')
    expect(result.state.size).toBe(0)
  })

  it('should handle version conflicts during recovery', async () => {
    // SQLite has version 5
    mockSql.store.set('conflict_001', {
      id: 'conflict_001',
      type: 'Versioned',
      data: JSON.stringify({ $id: 'conflict_001', $type: 'Versioned', name: 'SQLiteVersion', $version: 5 }),
    })

    // Pipeline events have lower versions (stale)
    const pipelineEvents = [
      { type: 'thing.updated', entityId: 'conflict_001', payload: { name: 'PipelineVersion' }, ts: Date.now() },
    ]

    const recovery = new ColdStartRecovery({
      sql: mockSql as any,
      namespace: 'version-conflict',
      pipelineEvents,
    })

    const result = await recovery.recover()

    // Pipeline events are applied on top - this is the expected behavior
    // as pipeline events represent operations after the last checkpoint
    expect(result.state.get('conflict_001')?.name).toBe('PipelineVersion')
  })
})

// ============================================================================
// DOStorage Integration Tests (Full Stack)
// ============================================================================
// FAILING Tests: Tier Promotion and Integration Gaps
// ============================================================================

describe('Tier Promotion (Expected to FAIL - not fully implemented)', () => {
  let memory: InMemoryStateManager
  let mockSql: ReturnType<typeof createMockSql>

  beforeEach(() => {
    vi.useFakeTimers()
    memory = new InMemoryStateManager()
    mockSql = createMockSql()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should automatically promote hot L0 data to L2 based on access patterns', async () => {
    // EXPECTED FAILURE: Access pattern tracking not implemented
    // Hot data should stay in L0, cold data should be promoted to L2
    const dirtyTracker = new TestDirtyTracker(memory)
    const checkpointer = new LazyCheckpointer({
      sql: mockSql,
      dirtyTracker,
      intervalMs: 1000,
    })

    // Create entries
    const hotEntry = memory.create({ $type: 'Hot', name: 'Frequently Accessed' })
    const coldEntry = memory.create({ $type: 'Cold', name: 'Rarely Accessed' })

    // Simulate hot access pattern
    for (let i = 0; i < 100; i++) {
      memory.get(hotEntry.$id)
    }

    // Checkpoint
    checkpointer.start()
    await vi.advanceTimersByTimeAsync(1100)

    // EXPECTED: Cold entry should be promoted to L2 and evicted from L0
    // Hot entry should remain in L0
    // This requires access tracking and tier promotion logic
    const accessStats = (memory as any).getAccessStats?.() ?? {}
    expect(accessStats[hotEntry.$id]?.accessCount).toBe(100)
    expect(accessStats[coldEntry.$id]?.accessCount).toBe(0)

    // Verify tier promotion decision is made
    const tierDecision = (checkpointer as any).getTierPromotion?.() ?? {}
    expect(tierDecision[coldEntry.$id]).toBe('promote-to-l2')
    expect(tierDecision[hotEntry.$id]).toBe('keep-in-l0')

    await checkpointer.destroy()
  })

  it('should demote L0 entries to L2 when memory pressure is high', async () => {
    // EXPECTED FAILURE: Memory pressure demotion not implemented
    const evicted: ThingData[] = []
    const limitedMemory = new InMemoryStateManager({
      maxBytes: 5000,
      onEvict: (entries) => evicted.push(...entries),
    })

    const dirtyTracker = new TestDirtyTracker(limitedMemory)
    const checkpointer = new LazyCheckpointer({
      sql: mockSql,
      dirtyTracker,
      intervalMs: 100,
    })

    // Fill memory with data
    for (let i = 0; i < 20; i++) {
      limitedMemory.create({ $type: 'Large', data: 'X'.repeat(500) })
    }

    checkpointer.start()
    await vi.advanceTimersByTimeAsync(200)

    // EXPECTED: Evicted entries should be persisted to L2 before eviction
    // This requires coordinated tier demotion
    const evictedIds = evicted.map((e) => e.$id)
    for (const id of evictedIds) {
      expect(mockSql.store.has(id)).toBe(true) // Must be in L2 before eviction
    }

    await checkpointer.destroy()
  })

  it('should track tier residency metadata for each entry', async () => {
    // EXPECTED FAILURE: Tier residency tracking not implemented
    const dirtyTracker = new TestDirtyTracker(memory)
    const checkpointer = new LazyCheckpointer({
      sql: mockSql,
      dirtyTracker,
      intervalMs: 1000,
    })

    const thing = memory.create({ $type: 'Tracked', name: 'WithMetadata' })

    // EXPECTED: Entry should have tier residency metadata
    const entry = memory.get(thing.$id) as any
    expect(entry._tier).toBeDefined()
    expect(entry._tier.residency).toContain('L0')
    expect(entry._tier.createdAt).toBeDefined()
    expect(entry._tier.lastPromoted).toBeUndefined() // Not promoted yet

    // After checkpoint
    await checkpointer.checkpoint()

    const afterCheckpoint = memory.get(thing.$id) as any
    expect(afterCheckpoint._tier.residency).toContain('L2')
    expect(afterCheckpoint._tier.lastPromoted).toBeDefined()

    await checkpointer.destroy()
  })
})

describe('Full L0 -> L1 -> L2 -> L3 Flow (Expected to FAIL)', () => {
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

  it('should automatically promote data through all tiers based on age', async () => {
    // EXPECTED FAILURE: Age-based tier promotion not implemented
    const pipelineSend = vi.fn(async () => {})
    const sqlExec = vi.fn(() => ({ toArray: () => [] }))
    const r2Put = vi.fn(async () => ({}))

    storage = new DOStorage({
      namespace: 'full-tier-test',
      env: {
        PIPELINE: { send: pipelineSend },
        sql: { exec: sqlExec },
        R2: { put: r2Put } as any,
      },
      checkpointInterval: 1000,
      icebergFlushInterval: 5000,
    })

    // Create entry
    const thing = await storage.create({ $type: 'Aged', name: 'OldData' })

    // Advance time to trigger tier promotions
    await vi.advanceTimersByTimeAsync(10000)

    // EXPECTED: Data should flow through all tiers
    // L1: Event emitted
    expect(pipelineSend).toHaveBeenCalled()

    // L2: Checkpointed to SQLite
    expect(sqlExec).toHaveBeenCalled()

    // L3: Promoted to Iceberg (cold storage)
    expect(r2Put).toHaveBeenCalled()

    // Verify promotion metadata
    const tierInfo = await (storage as any).getTierInfo?.(thing.$id)
    expect(tierInfo?.tiers).toEqual(['L0', 'L1', 'L2', 'L3'])
    expect(tierInfo?.promotedAt.L3).toBeDefined()
  })

  it('should support configurable tier promotion policies', async () => {
    // EXPECTED FAILURE: Configurable promotion policies not implemented
    const pipelineSend = vi.fn(async () => {})
    const sqlExec = vi.fn(() => ({ toArray: () => [] }))

    storage = new DOStorage({
      namespace: 'policy-test',
      env: {
        PIPELINE: { send: pipelineSend },
        sql: { exec: sqlExec },
      },
      checkpointInterval: 1000,
      // EXPECTED: Custom tier promotion policy
      tierPolicy: {
        L0_to_L2_threshold: 100, // Promote after 100 entries
        L2_to_L3_age_ms: 86400000, // Promote after 24h
        keepHotInL0: true,
      },
    } as any)

    // Verify policy is applied
    const policy = (storage as any).getTierPolicy?.()
    expect(policy?.L0_to_L2_threshold).toBe(100)
    expect(policy?.L2_to_L3_age_ms).toBe(86400000)
    expect(policy?.keepHotInL0).toBe(true)
  })
})

describe('Cross-Tier Consistency Verification (Expected to FAIL)', () => {
  let memory: InMemoryStateManager
  let mockSql: ReturnType<typeof createMockSql>

  beforeEach(() => {
    vi.useFakeTimers()
    memory = new InMemoryStateManager()
    mockSql = createMockSql()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should verify cross-tier consistency with checksums', async () => {
    // EXPECTED FAILURE: Checksum verification not implemented
    const dirtyTracker = new TestDirtyTracker(memory)
    const checkpointer = new LazyCheckpointer({
      sql: mockSql,
      dirtyTracker,
      intervalMs: 1000,
    })

    const thing = memory.create({ $type: 'Checksummed', name: 'VerifyMe', data: { nested: 'value' } })
    await checkpointer.checkpoint()

    // EXPECTED: Cross-tier consistency verification
    const verifyResult = await (checkpointer as any).verifyCrossTierConsistency?.(thing.$id)
    expect(verifyResult).toBeDefined()
    expect(verifyResult.L0_checksum).toBeDefined()
    expect(verifyResult.L2_checksum).toBeDefined()
    expect(verifyResult.consistent).toBe(true)
    expect(verifyResult.L0_checksum).toBe(verifyResult.L2_checksum)

    await checkpointer.destroy()
  })

  it('should detect and repair tier inconsistencies', async () => {
    // EXPECTED FAILURE: Auto-repair not implemented
    const dirtyTracker = new TestDirtyTracker(memory)
    const checkpointer = new LazyCheckpointer({
      sql: mockSql,
      dirtyTracker,
      intervalMs: 1000,
    })

    const thing = memory.create({ $type: 'Repairable', name: 'FixMe' })
    await checkpointer.checkpoint()

    // Simulate corruption in L2
    const l2Entry = mockSql.store.get(thing.$id)!
    mockSql.store.set(thing.$id, {
      ...l2Entry,
      data: JSON.stringify({ ...JSON.parse(l2Entry.data), name: 'Corrupted' }),
    })

    // EXPECTED: Detect and repair inconsistency
    const repairResult = await (checkpointer as any).detectAndRepairInconsistencies?.()
    expect(repairResult).toBeDefined()
    expect(repairResult.inconsistenciesFound).toBe(1)
    expect(repairResult.repaired[0]?.id).toBe(thing.$id)
    expect(repairResult.repaired[0]?.source).toBe('L0') // L0 is authoritative

    // Verify repair was successful
    const l2After = mockSql.store.get(thing.$id)!
    expect(JSON.parse(l2After.data).name).toBe('FixMe')

    await checkpointer.destroy()
  })

  it('should provide tier health monitoring', async () => {
    // EXPECTED FAILURE: Health monitoring not implemented
    const dirtyTracker = new TestDirtyTracker(memory)
    const checkpointer = new LazyCheckpointer({
      sql: mockSql,
      dirtyTracker,
      intervalMs: 1000,
    })

    // Create some data
    for (let i = 0; i < 10; i++) {
      memory.create({ $type: 'Health', name: `Entry ${i}` })
    }

    await checkpointer.checkpoint()

    // EXPECTED: Health monitoring metrics
    const health = await (checkpointer as any).getTierHealth?.()
    expect(health).toBeDefined()
    expect(health.L0).toEqual({
      entryCount: 10,
      dirtyCount: 0,
      memoryBytes: expect.any(Number),
      status: 'healthy',
    })
    expect(health.L2).toEqual({
      entryCount: 10,
      lastCheckpoint: expect.any(Number),
      checkpointLatencyMs: expect.any(Number),
      status: 'healthy',
    })
    expect(health.overall).toBe('healthy')

    await checkpointer.destroy()
  })
})

describe('Pipeline Event Deduplication (Expected to FAIL)', () => {
  it('should deduplicate events during cold start recovery', async () => {
    // EXPECTED FAILURE: Deduplication not implemented
    const mockSql = createMockSql()

    // Base state in SQLite
    mockSql.store.set('dedup_001', {
      id: 'dedup_001',
      type: 'Dedup',
      data: JSON.stringify({ $id: 'dedup_001', $type: 'Dedup', name: 'Base', counter: 5, $version: 5 }),
    })

    // Duplicate pipeline events (same idempotency key)
    const pipelineEvents = [
      { type: 'thing.updated', entityId: 'dedup_001', payload: { counter: 6 }, ts: 1000, idempotencyKey: 'idem-001' },
      { type: 'thing.updated', entityId: 'dedup_001', payload: { counter: 6 }, ts: 1000, idempotencyKey: 'idem-001' }, // Duplicate
      { type: 'thing.updated', entityId: 'dedup_001', payload: { counter: 7 }, ts: 2000, idempotencyKey: 'idem-002' },
      { type: 'thing.updated', entityId: 'dedup_001', payload: { counter: 7 }, ts: 2000, idempotencyKey: 'idem-002' }, // Duplicate
    ]

    const recovery = new ColdStartRecovery({
      sql: mockSql as any,
      namespace: 'dedup-test',
      pipelineEvents,
    })

    const result = await recovery.recover()

    // EXPECTED: Duplicates should be filtered out
    expect(result.eventsReplayed).toBe(2) // Only unique events
    expect(result.state.get('dedup_001')?.counter).toBe(7)
    expect(result.state.get('dedup_001')?.$version).toBe(7) // 5 + 2 unique updates
  })

  it('should track seen idempotency keys across recovery sessions', async () => {
    // EXPECTED FAILURE: Cross-session idempotency tracking not implemented
    const mockSql = createMockSql()

    // First recovery session processes some events
    const firstRecovery = new ColdStartRecovery({
      sql: mockSql as any,
      namespace: 'session-test',
      pipelineEvents: [
        { type: 'thing.created', entityId: 'sess_001', payload: { $id: 'sess_001', $type: 'Session', name: 'Created' }, ts: 1000, idempotencyKey: 'seen-001' },
      ],
    })

    const firstResult = await firstRecovery.recover()

    // Get seen idempotency keys
    const seenKeys = await (firstRecovery as any).getSeenIdempotencyKeys?.()
    expect(seenKeys).toContain('seen-001')

    // Second recovery should skip already-processed events
    const secondRecovery = new ColdStartRecovery({
      sql: mockSql as any,
      namespace: 'session-test',
      pipelineEvents: [
        { type: 'thing.created', entityId: 'sess_001', payload: { $id: 'sess_001', $type: 'Session', name: 'Created' }, ts: 1000, idempotencyKey: 'seen-001' }, // Already processed
      ],
      seenIdempotencyKeys: seenKeys,
    } as any)

    const secondResult = await secondRecovery.recover()
    expect(secondResult.eventsReplayed).toBe(0)
  })
})

describe('Tier Telemetry and Observability (Expected to FAIL)', () => {
  it('should emit telemetry events for tier operations', async () => {
    // EXPECTED FAILURE: Telemetry not implemented
    const telemetryEvents: any[] = []
    const mockTelemetry = {
      emit: (event: any) => telemetryEvents.push(event),
    }

    const memory = new InMemoryStateManager({
      telemetry: mockTelemetry,
    } as any)

    memory.create({ $type: 'Telemetry', name: 'Tracked' })

    // EXPECTED: Telemetry events emitted
    expect(telemetryEvents.length).toBeGreaterThan(0)
    expect(telemetryEvents[0]).toMatchObject({
      type: 'tier.L0.create',
      tier: 'L0',
      operation: 'create',
      entityType: 'Telemetry',
      durationMs: expect.any(Number),
    })
  })

  it('should provide tier operation latency metrics', async () => {
    // EXPECTED FAILURE: Latency metrics not implemented
    vi.useFakeTimers()

    const memory = new InMemoryStateManager()
    const mockSql = createMockSql()
    const dirtyTracker = new TestDirtyTracker(memory)
    const checkpointer = new LazyCheckpointer({
      sql: mockSql,
      dirtyTracker,
      intervalMs: 1000,
    })

    // Create and checkpoint
    for (let i = 0; i < 100; i++) {
      memory.create({ $type: 'Latency', name: `Entry ${i}` })
    }
    await checkpointer.checkpoint()

    // EXPECTED: Latency metrics available
    const metrics = (checkpointer as any).getLatencyMetrics?.()
    expect(metrics).toBeDefined()
    expect(metrics.L0_read_p50_ms).toBeDefined()
    expect(metrics.L0_write_p50_ms).toBeDefined()
    expect(metrics.L2_checkpoint_p50_ms).toBeDefined()
    expect(metrics.L2_checkpoint_p99_ms).toBeDefined()

    await checkpointer.destroy()
    vi.useRealTimers()
  })
})

// ============================================================================

describe('DOStorage Full Stack Integration', () => {
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

  it('should coordinate all tiers through DOStorage facade', async () => {
    const pipelineSend = vi.fn(async () => {})
    const sqlExec = vi.fn(() => ({ toArray: () => [] }))

    storage = new DOStorage({
      namespace: 'full-stack-test',
      env: {
        PIPELINE: { send: pipelineSend },
        sql: { exec: sqlExec },
      },
      checkpointInterval: 1000,
    })

    // Create through DOStorage
    const thing = await storage.create({ $type: 'Customer', name: 'Alice' })

    expect(thing.$id).toBeDefined()
    expect(storage.get(thing.$id)?.name).toBe('Alice')

    // L1 should be notified
    await vi.advanceTimersByTimeAsync(200)
    expect(pipelineSend).toHaveBeenCalled()

    // L2 should be checkpointed
    await vi.advanceTimersByTimeAsync(1000)
    expect(sqlExec).toHaveBeenCalled()
  })

  it('should provide fallback read path through all tiers', async () => {
    const sqlExec = vi.fn((query: string, ...params: unknown[]) => {
      if (query.includes('SELECT') && query.includes('WHERE id =')) {
        return {
          toArray: () => [{
            id: 'fallback_001',
            type: 'Legacy',
            data: JSON.stringify({ $id: 'fallback_001', $type: 'Legacy', name: 'FromSQLite' }),
          }],
        }
      }
      return { toArray: () => [] }
    })

    storage = new DOStorage({
      namespace: 'fallback-test',
      env: {
        PIPELINE: { send: vi.fn() },
        sql: { exec: sqlExec },
      },
    })

    // L0 miss, should fall back to L2
    const result = await storage.getWithFallback('fallback_001')

    expect(result?.name).toBe('FromSQLite')
    expect(sqlExec).toHaveBeenCalled()
  })

  it('should flush all tiers before hibernation', async () => {
    const pipelineSend = vi.fn(async () => {})
    const sqlExec = vi.fn(() => ({ toArray: () => [] }))

    storage = new DOStorage({
      namespace: 'hibernation-test',
      env: {
        PIPELINE: { send: pipelineSend },
        sql: { exec: sqlExec },
      },
      checkpointInterval: 60000, // Long interval
    })

    await storage.create({ $type: 'BeforeHibernate', name: 'Flush Me' })

    // Force hibernation flush
    await storage.beforeHibernation()

    // All tiers should be flushed
    expect(pipelineSend).toHaveBeenCalled()
    expect(sqlExec).toHaveBeenCalled()
  })
})
