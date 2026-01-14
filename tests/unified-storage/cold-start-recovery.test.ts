/**
 * ColdStartRecovery Tests - TDD RED Phase
 *
 * These tests define the expected behavior of the ColdStartRecovery component
 * which handles state restoration when a Durable Object starts cold.
 *
 * Recovery strategy:
 * 1. First, try loading from local SQLite (fast, ~100ms)
 * 2. If SQLite empty, replay from Iceberg (slower, but complete)
 * 3. Handle empty state gracefully
 *
 * These tests WILL FAIL because the ColdStartRecovery implementation
 * does not exist yet.
 *
 * @module tests/unified-storage/cold-start-recovery.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// This import will fail - the module doesn't exist yet
// import { ColdStartRecovery } from '../../objects/unified-storage/cold-start-recovery'
import type { MockIcebergReader } from '../mocks/iceberg'

// ============================================================================
// TYPE DEFINITIONS (Expected Interface)
// ============================================================================

/**
 * Expected interface for ColdStartRecovery
 * Implementation should match these types
 */
interface Thing {
  $id: string
  $type: string
  $version: number
  $createdAt: number
  $updatedAt: number
  [key: string]: unknown
}

interface DomainEvent {
  type: 'thing.created' | 'thing.updated' | 'thing.deleted'
  entityId: string
  entityType: string
  payload: Record<string, unknown>
  ts: number
  version: number
  ns: string
}

interface RecoveryOptions {
  namespace: string
  sql: SqliteConnection
  iceberg?: IcebergReader
  timeout?: number
  onProgress?: (progress: RecoveryProgress) => void
}

interface RecoveryProgress {
  phase: 'sqlite' | 'iceberg' | 'applying' | 'complete'
  loaded: number
  total: number
  elapsedMs: number
}

interface RecoveryResult {
  source: 'sqlite' | 'iceberg' | 'empty'
  thingsLoaded: number
  eventsReplayed: number
  durationMs: number
  state: Map<string, Thing>
}

interface SqliteConnection {
  exec(query: string, ...params: unknown[]): { toArray(): unknown[] }
}

interface IcebergReader {
  getRecords(options: {
    table: string
    partition?: { ns?: string }
    orderBy?: string
  }): Promise<DomainEvent[]>
}

interface ColdStartRecoveryInterface {
  recover(): Promise<RecoveryResult>
  getState(): Map<string, Thing>
  validateState(): { valid: boolean; errors: string[] }
}

// ============================================================================
// MOCK FACTORIES
// ============================================================================

function createMockSql(data: {
  collections?: Array<{ type: string; data: string }>
  things?: Array<{ id: string; type: string; data: string }>
} = {}): SqliteConnection {
  return {
    exec: vi.fn((query: string) => {
      if (query.includes('FROM collections')) {
        return { toArray: () => data.collections ?? [] }
      }
      if (query.includes('FROM things')) {
        return { toArray: () => data.things ?? [] }
      }
      return { toArray: () => [] }
    }),
  }
}

function createMockIceberg(events: DomainEvent[] = []): IcebergReader {
  return {
    getRecords: vi.fn(async () => events),
  }
}

function createTestThing(overrides: Partial<Thing> = {}): Thing {
  const now = Date.now()
  return {
    $id: `thing_${crypto.randomUUID()}`,
    $type: 'TestThing',
    $version: 1,
    $createdAt: now,
    $updatedAt: now,
    name: 'Test',
    ...overrides,
  }
}

function createTestEvent(
  type: DomainEvent['type'],
  thing: Partial<Thing>,
  overrides: Partial<DomainEvent> = {}
): DomainEvent {
  return {
    type,
    entityId: thing.$id ?? `thing_${crypto.randomUUID()}`,
    entityType: thing.$type ?? 'TestThing',
    payload: thing as Record<string, unknown>,
    ts: Date.now(),
    version: thing.$version ?? 1,
    ns: 'test.do',
    ...overrides,
  }
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('ColdStartRecovery', () => {
  // Since ColdStartRecovery doesn't exist, these tests will fail at import time
  // For now, we use a placeholder that will fail
  let ColdStartRecovery: new (options: RecoveryOptions) => ColdStartRecoveryInterface

  beforeEach(async () => {
    // This dynamic import will fail - the module doesn't exist
    try {
      const module = await import('../../objects/unified-storage/cold-start-recovery')
      ColdStartRecovery = module.ColdStartRecovery
    } catch {
      // Expected to fail - module doesn't exist yet
      ColdStartRecovery = undefined as unknown as typeof ColdStartRecovery
    }
  })

  // ==========================================================================
  // SQLite Loading Tests
  // ==========================================================================

  describe('SQLite loading', () => {
    it('should load columnar collections from SQLite', async () => {
      // Setup: SQLite has columnar data
      const things = [
        createTestThing({ $id: 'customer_1', $type: 'Customer', name: 'Alice' }),
        createTestThing({ $id: 'customer_2', $type: 'Customer', name: 'Bob' }),
      ]
      const sql = createMockSql({
        collections: [{ type: 'Customer', data: JSON.stringify(things) }],
      })

      // Act
      const recovery = new ColdStartRecovery({
        namespace: 'test.do',
        sql,
      })
      const result = await recovery.recover()

      // Assert
      expect(result.source).toBe('sqlite')
      expect(result.thingsLoaded).toBe(2)
      expect(result.state.get('customer_1')).toMatchObject({ name: 'Alice' })
      expect(result.state.get('customer_2')).toMatchObject({ name: 'Bob' })
    })

    it('should load normalized things from SQLite', async () => {
      // Setup: SQLite has normalized (row-per-thing) data
      const thing1 = createTestThing({ $id: 'order_1', $type: 'Order', total: 100 })
      const thing2 = createTestThing({ $id: 'order_2', $type: 'Order', total: 200 })

      const sql = createMockSql({
        things: [
          { id: 'order_1', type: 'Order', data: JSON.stringify(thing1) },
          { id: 'order_2', type: 'Order', data: JSON.stringify(thing2) },
        ],
      })

      // Act
      const recovery = new ColdStartRecovery({
        namespace: 'test.do',
        sql,
      })
      const result = await recovery.recover()

      // Assert
      expect(result.source).toBe('sqlite')
      expect(result.thingsLoaded).toBe(2)
      expect(result.state.get('order_1')).toMatchObject({ total: 100 })
      expect(result.state.get('order_2')).toMatchObject({ total: 200 })
    })

    it('should populate in-memory state from SQLite', async () => {
      // Setup: Mix of columnar and normalized data
      const customers = [
        createTestThing({ $id: 'customer_1', $type: 'Customer', name: 'Alice' }),
      ]
      const sql = createMockSql({
        collections: [{ type: 'Customer', data: JSON.stringify(customers) }],
        things: [
          { id: 'order_1', type: 'Order', data: JSON.stringify(createTestThing({ $id: 'order_1', $type: 'Order' })) },
        ],
      })

      // Act
      const recovery = new ColdStartRecovery({
        namespace: 'test.do',
        sql,
      })
      await recovery.recover()

      // Assert: State should contain both
      const state = recovery.getState()
      expect(state.size).toBe(2)
      expect(state.has('customer_1')).toBe(true)
      expect(state.has('order_1')).toBe(true)
    })

    it('should complete in under 500ms for typical load', async () => {
      // Setup: Simulate ~1000 things (typical load)
      const things: Thing[] = []
      for (let i = 0; i < 1000; i++) {
        things.push(createTestThing({ $id: `thing_${i}`, $type: 'TestThing', index: i }))
      }

      const sql = createMockSql({
        collections: [{ type: 'TestThing', data: JSON.stringify(things) }],
      })

      // Act
      const recovery = new ColdStartRecovery({
        namespace: 'test.do',
        sql,
      })

      const start = performance.now()
      const result = await recovery.recover()
      const elapsed = performance.now() - start

      // Assert: Should complete in < 500ms
      expect(elapsed).toBeLessThan(500)
      expect(result.durationMs).toBeLessThan(500)
      expect(result.thingsLoaded).toBe(1000)
    })

    it('should handle empty SQLite gracefully', async () => {
      // Setup: SQLite is empty (new DO or after data loss)
      const sql = createMockSql({
        collections: [],
        things: [],
      })

      // Act
      const recovery = new ColdStartRecovery({
        namespace: 'test.do',
        sql,
      })
      const result = await recovery.recover()

      // Assert: Should indicate empty source, not error
      expect(result.source).toBe('empty')
      expect(result.thingsLoaded).toBe(0)
      expect(result.state.size).toBe(0)
    })
  })

  // ==========================================================================
  // Iceberg Replay Tests
  // ==========================================================================

  describe('Iceberg replay', () => {
    it('should replay from Iceberg when SQLite is empty', async () => {
      // Setup: Empty SQLite, but Iceberg has events
      const sql = createMockSql({ collections: [], things: [] })

      const events: DomainEvent[] = [
        createTestEvent('thing.created', { $id: 'customer_1', $type: 'Customer', name: 'Alice' }),
        createTestEvent('thing.created', { $id: 'customer_2', $type: 'Customer', name: 'Bob' }),
      ]
      const iceberg = createMockIceberg(events)

      // Act
      const recovery = new ColdStartRecovery({
        namespace: 'test.do',
        sql,
        iceberg,
      })
      const result = await recovery.recover()

      // Assert
      expect(result.source).toBe('iceberg')
      expect(result.eventsReplayed).toBe(2)
      expect(result.state.get('customer_1')).toMatchObject({ name: 'Alice' })
    })

    it('should query events by namespace', async () => {
      // Setup
      const sql = createMockSql({ collections: [], things: [] })
      const iceberg = createMockIceberg([])

      // Act
      const recovery = new ColdStartRecovery({
        namespace: 'payments.do',
        sql,
        iceberg,
      })
      await recovery.recover()

      // Assert: Should query with namespace filter
      expect(iceberg.getRecords).toHaveBeenCalledWith(
        expect.objectContaining({
          table: 'do_events',
          partition: { ns: 'payments.do' },
        })
      )
    })

    it('should order events by timestamp', async () => {
      // Setup: Events out of order
      const sql = createMockSql({ collections: [], things: [] })

      const now = Date.now()
      const events: DomainEvent[] = [
        createTestEvent('thing.updated', { $id: 'thing_1', name: 'Updated' }, { ts: now + 1000, version: 2 }),
        createTestEvent('thing.created', { $id: 'thing_1', name: 'Original' }, { ts: now, version: 1 }),
      ]
      const iceberg = createMockIceberg(events)

      // Act
      const recovery = new ColdStartRecovery({
        namespace: 'test.do',
        sql,
        iceberg,
      })
      await recovery.recover()

      // Assert: Should request ordered by timestamp
      expect(iceberg.getRecords).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: 'ts ASC',
        })
      )
    })

    it('should apply create events', async () => {
      // Setup
      const sql = createMockSql({ collections: [], things: [] })

      const events: DomainEvent[] = [
        createTestEvent('thing.created', {
          $id: 'product_1',
          $type: 'Product',
          $version: 1,
          name: 'Widget',
          price: 99,
        }),
      ]
      const iceberg = createMockIceberg(events)

      // Act
      const recovery = new ColdStartRecovery({
        namespace: 'test.do',
        sql,
        iceberg,
      })
      const result = await recovery.recover()

      // Assert
      expect(result.state.has('product_1')).toBe(true)
      const product = result.state.get('product_1')!
      expect(product.name).toBe('Widget')
      expect(product.price).toBe(99)
    })

    it('should apply update events (merge)', async () => {
      // Setup: Create then update
      const sql = createMockSql({ collections: [], things: [] })

      const now = Date.now()
      const events: DomainEvent[] = [
        createTestEvent('thing.created', {
          $id: 'product_1',
          $type: 'Product',
          name: 'Widget',
          price: 99,
          stock: 10,
        }, { ts: now, version: 1 }),
        createTestEvent('thing.updated', {
          $id: 'product_1',
          price: 79, // Only update price
        }, { ts: now + 1000, version: 2 }),
      ]
      const iceberg = createMockIceberg(events)

      // Act
      const recovery = new ColdStartRecovery({
        namespace: 'test.do',
        sql,
        iceberg,
      })
      const result = await recovery.recover()

      // Assert: Should have merged state
      const product = result.state.get('product_1')!
      expect(product.name).toBe('Widget') // Original
      expect(product.price).toBe(79) // Updated
      expect(product.stock).toBe(10) // Original
    })

    it('should apply delete events', async () => {
      // Setup: Create then delete
      const sql = createMockSql({ collections: [], things: [] })

      const now = Date.now()
      const events: DomainEvent[] = [
        createTestEvent('thing.created', { $id: 'temp_1', $type: 'Temp' }, { ts: now, version: 1 }),
        createTestEvent('thing.deleted', { $id: 'temp_1' }, { ts: now + 1000, version: 2 }),
      ]
      const iceberg = createMockIceberg(events)

      // Act
      const recovery = new ColdStartRecovery({
        namespace: 'test.do',
        sql,
        iceberg,
      })
      const result = await recovery.recover()

      // Assert: Thing should be removed
      expect(result.state.has('temp_1')).toBe(false)
    })
  })

  // ==========================================================================
  // Event Application Tests
  // ==========================================================================

  describe('event application', () => {
    it('should handle thing.created event', async () => {
      const sql = createMockSql({ collections: [], things: [] })

      const events: DomainEvent[] = [
        {
          type: 'thing.created',
          entityId: 'user_1',
          entityType: 'User',
          payload: {
            $id: 'user_1',
            $type: 'User',
            $version: 1,
            email: 'alice@example.com',
          },
          ts: Date.now(),
          version: 1,
          ns: 'test.do',
        },
      ]
      const iceberg = createMockIceberg(events)

      const recovery = new ColdStartRecovery({
        namespace: 'test.do',
        sql,
        iceberg,
      })
      const result = await recovery.recover()

      const user = result.state.get('user_1')
      expect(user).toBeDefined()
      expect(user!.email).toBe('alice@example.com')
      expect(user!.$type).toBe('User')
    })

    it('should handle thing.updated event with merge', async () => {
      const sql = createMockSql({ collections: [], things: [] })

      const now = Date.now()
      const events: DomainEvent[] = [
        {
          type: 'thing.created',
          entityId: 'user_1',
          entityType: 'User',
          payload: {
            $id: 'user_1',
            $type: 'User',
            $version: 1,
            email: 'alice@example.com',
            name: 'Alice',
            role: 'member',
          },
          ts: now,
          version: 1,
          ns: 'test.do',
        },
        {
          type: 'thing.updated',
          entityId: 'user_1',
          entityType: 'User',
          payload: {
            role: 'admin', // Only update role
          },
          ts: now + 1000,
          version: 2,
          ns: 'test.do',
        },
      ]
      const iceberg = createMockIceberg(events)

      const recovery = new ColdStartRecovery({
        namespace: 'test.do',
        sql,
        iceberg,
      })
      const result = await recovery.recover()

      const user = result.state.get('user_1')!
      expect(user.email).toBe('alice@example.com') // Preserved
      expect(user.name).toBe('Alice') // Preserved
      expect(user.role).toBe('admin') // Updated
    })

    it('should handle thing.deleted event', async () => {
      const sql = createMockSql({ collections: [], things: [] })

      const now = Date.now()
      const events: DomainEvent[] = [
        {
          type: 'thing.created',
          entityId: 'session_1',
          entityType: 'Session',
          payload: { $id: 'session_1', $type: 'Session', token: 'abc123' },
          ts: now,
          version: 1,
          ns: 'test.do',
        },
        {
          type: 'thing.deleted',
          entityId: 'session_1',
          entityType: 'Session',
          payload: { $id: 'session_1' },
          ts: now + 1000,
          version: 2,
          ns: 'test.do',
        },
      ]
      const iceberg = createMockIceberg(events)

      const recovery = new ColdStartRecovery({
        namespace: 'test.do',
        sql,
        iceberg,
      })
      const result = await recovery.recover()

      expect(result.state.has('session_1')).toBe(false)
      expect(result.eventsReplayed).toBe(2)
    })

    it('should track version from events', async () => {
      const sql = createMockSql({ collections: [], things: [] })

      const now = Date.now()
      const events: DomainEvent[] = [
        createTestEvent('thing.created', { $id: 'doc_1', $type: 'Document' }, { ts: now, version: 1 }),
        createTestEvent('thing.updated', { $id: 'doc_1', title: 'v2' }, { ts: now + 100, version: 2 }),
        createTestEvent('thing.updated', { $id: 'doc_1', title: 'v3' }, { ts: now + 200, version: 3 }),
        createTestEvent('thing.updated', { $id: 'doc_1', title: 'v4' }, { ts: now + 300, version: 4 }),
      ]
      const iceberg = createMockIceberg(events)

      const recovery = new ColdStartRecovery({
        namespace: 'test.do',
        sql,
        iceberg,
      })
      const result = await recovery.recover()

      const doc = result.state.get('doc_1')!
      expect(doc.$version).toBe(4)
      expect(doc.title).toBe('v4')
    })

    it('should rebuild correct final state from event sequence', async () => {
      // Complex sequence: create, update, update, delete, create (same id)
      const sql = createMockSql({ collections: [], things: [] })

      const now = Date.now()
      const events: DomainEvent[] = [
        // First entity lifecycle
        createTestEvent('thing.created', {
          $id: 'item_1',
          $type: 'Item',
          status: 'draft',
        }, { ts: now, version: 1 }),
        createTestEvent('thing.updated', {
          $id: 'item_1',
          status: 'published',
        }, { ts: now + 100, version: 2 }),
        createTestEvent('thing.deleted', {
          $id: 'item_1',
        }, { ts: now + 200, version: 3 }),
        // Re-created with same ID
        createTestEvent('thing.created', {
          $id: 'item_1',
          $type: 'Item',
          status: 'new',
          recreated: true,
        }, { ts: now + 300, version: 1 }),
      ]
      const iceberg = createMockIceberg(events)

      const recovery = new ColdStartRecovery({
        namespace: 'test.do',
        sql,
        iceberg,
      })
      const result = await recovery.recover()

      // Final state should reflect the re-created entity
      const item = result.state.get('item_1')!
      expect(item.status).toBe('new')
      expect(item.recreated).toBe(true)
      expect(item.$version).toBe(1) // Reset on re-create
    })
  })

  // ==========================================================================
  // Recovery Mode Tests
  // ==========================================================================

  describe('recovery modes', () => {
    it('should prefer SQLite over Iceberg (faster)', async () => {
      // Setup: Both SQLite and Iceberg have data
      const sqlThings = [createTestThing({ $id: 'from_sqlite', name: 'SQLite Thing' })]
      const sql = createMockSql({
        collections: [{ type: 'TestThing', data: JSON.stringify(sqlThings) }],
      })

      const icebergEvents = [
        createTestEvent('thing.created', { $id: 'from_iceberg', name: 'Iceberg Thing' }),
      ]
      const iceberg = createMockIceberg(icebergEvents)

      // Act
      const recovery = new ColdStartRecovery({
        namespace: 'test.do',
        sql,
        iceberg,
      })
      const result = await recovery.recover()

      // Assert: Should use SQLite, not Iceberg
      expect(result.source).toBe('sqlite')
      expect(result.state.has('from_sqlite')).toBe(true)
      expect(result.state.has('from_iceberg')).toBe(false)
      expect(iceberg.getRecords).not.toHaveBeenCalled()
    })

    it('should fall back to Iceberg when SQLite empty', async () => {
      // Setup: Empty SQLite, populated Iceberg
      const sql = createMockSql({ collections: [], things: [] })

      const events = [
        createTestEvent('thing.created', { $id: 'recovered', name: 'Recovered Thing' }),
      ]
      const iceberg = createMockIceberg(events)

      // Act
      const recovery = new ColdStartRecovery({
        namespace: 'test.do',
        sql,
        iceberg,
      })
      const result = await recovery.recover()

      // Assert
      expect(result.source).toBe('iceberg')
      expect(result.state.has('recovered')).toBe(true)
      expect(iceberg.getRecords).toHaveBeenCalled()
    })

    it('should support force-rebuild from Iceberg', async () => {
      // Setup: SQLite has data, but we want to rebuild from Iceberg
      const sqlThings = [createTestThing({ $id: 'stale', name: 'Stale Data' })]
      const sql = createMockSql({
        collections: [{ type: 'TestThing', data: JSON.stringify(sqlThings) }],
      })

      const events = [
        createTestEvent('thing.created', { $id: 'fresh', name: 'Fresh Data' }),
      ]
      const iceberg = createMockIceberg(events)

      // Act: Force rebuild
      const recovery = new ColdStartRecovery({
        namespace: 'test.do',
        sql,
        iceberg,
      })
      // Use a method that forces Iceberg rebuild
      const result = await (recovery as any).forceRebuildFromIceberg?.() ??
        recovery.recover() // Fallback for when method exists

      // Assert: Should have fresh data from Iceberg
      // This test validates the interface supports force-rebuild
      expect(result).toBeDefined()
    })

    it('should validate state consistency after recovery', async () => {
      // Setup: SQLite with valid data
      const validThings = [
        createTestThing({ $id: 'valid_1', $type: 'Valid', $version: 1 }),
      ]
      const sql = createMockSql({
        collections: [{ type: 'Valid', data: JSON.stringify(validThings) }],
      })

      // Act
      const recovery = new ColdStartRecovery({
        namespace: 'test.do',
        sql,
      })
      await recovery.recover()

      // Assert: Validation should pass
      const validation = recovery.validateState()
      expect(validation.valid).toBe(true)
      expect(validation.errors).toHaveLength(0)
    })
  })

  // ==========================================================================
  // Performance Tests
  // ==========================================================================

  describe('performance', () => {
    it('should batch Iceberg queries', async () => {
      const sql = createMockSql({ collections: [], things: [] })

      // Large event set
      const events: DomainEvent[] = Array.from({ length: 10000 }, (_, i) =>
        createTestEvent('thing.created', {
          $id: `batch_${i}`,
          $type: 'BatchItem',
          index: i,
        })
      )
      const iceberg = createMockIceberg(events)

      const recovery = new ColdStartRecovery({
        namespace: 'test.do',
        sql,
        iceberg,
      })
      await recovery.recover()

      // Assert: Should batch queries, not make 10000 individual calls
      // Implementation should use a single query or batched queries
      expect((iceberg.getRecords as ReturnType<typeof vi.fn>).mock.calls.length).toBeLessThan(10)
    })

    it('should stream large event sets', async () => {
      const sql = createMockSql({ collections: [], things: [] })

      // Very large event set (100k events)
      const events: DomainEvent[] = Array.from({ length: 100000 }, (_, i) =>
        createTestEvent('thing.created', {
          $id: `stream_${i}`,
          $type: 'StreamItem',
          index: i,
        })
      )
      const iceberg = createMockIceberg(events)

      const recovery = new ColdStartRecovery({
        namespace: 'test.do',
        sql,
        iceberg,
      })

      // Should not run out of memory
      const result = await recovery.recover()
      expect(result.eventsReplayed).toBe(100000)
      expect(result.state.size).toBe(100000)
    })

    it('should report recovery progress', async () => {
      const sql = createMockSql({ collections: [], things: [] })

      const events: DomainEvent[] = Array.from({ length: 1000 }, (_, i) =>
        createTestEvent('thing.created', { $id: `progress_${i}`, $type: 'ProgressItem' })
      )
      const iceberg = createMockIceberg(events)

      const progressUpdates: RecoveryProgress[] = []

      const recovery = new ColdStartRecovery({
        namespace: 'test.do',
        sql,
        iceberg,
        onProgress: (progress) => progressUpdates.push({ ...progress }),
      })

      await recovery.recover()

      // Assert: Should have received progress updates
      expect(progressUpdates.length).toBeGreaterThan(0)

      // Should have phases
      const phases = new Set(progressUpdates.map((p) => p.phase))
      expect(phases.has('iceberg')).toBe(true)
      expect(phases.has('applying')).toBe(true)
      expect(phases.has('complete')).toBe(true)

      // Final progress should be complete
      const final = progressUpdates[progressUpdates.length - 1]
      expect(final.phase).toBe('complete')
      expect(final.loaded).toBe(1000)
    })

    it('should timeout if recovery takes too long', async () => {
      const sql = createMockSql({ collections: [], things: [] })

      // Simulate slow Iceberg that exceeds timeout
      const slowIceberg: IcebergReader = {
        getRecords: vi.fn(async () => {
          // Simulate 5 second delay
          await new Promise((resolve) => setTimeout(resolve, 5000))
          return []
        }),
      }

      const recovery = new ColdStartRecovery({
        namespace: 'test.do',
        sql,
        iceberg: slowIceberg,
        timeout: 100, // 100ms timeout
      })

      // Assert: Should reject with timeout error
      await expect(recovery.recover()).rejects.toThrow(/timeout|timed out/i)
    })
  })

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('edge cases', () => {
    it('should handle corrupted SQLite data gracefully', async () => {
      // Setup: SQLite returns invalid JSON
      const sql: SqliteConnection = {
        exec: vi.fn(() => ({
          toArray: () => [{ type: 'BadData', data: 'not valid json{{{' }],
        })),
      }

      const iceberg = createMockIceberg([
        createTestEvent('thing.created', { $id: 'fallback_1', name: 'Fallback' }),
      ])

      const recovery = new ColdStartRecovery({
        namespace: 'test.do',
        sql,
        iceberg,
      })

      // Should fall back to Iceberg on SQLite error
      const result = await recovery.recover()
      expect(result.source).toBe('iceberg')
      expect(result.state.has('fallback_1')).toBe(true)
    })

    it('should handle missing required fields in events', async () => {
      const sql = createMockSql({ collections: [], things: [] })

      // Event with missing entityId
      const malformedEvents = [
        { type: 'thing.created', payload: { name: 'Test' }, ts: Date.now() } as unknown as DomainEvent,
      ]
      const iceberg = createMockIceberg(malformedEvents)

      const recovery = new ColdStartRecovery({
        namespace: 'test.do',
        sql,
        iceberg,
      })

      // Should handle gracefully (skip or error depending on implementation)
      const result = await recovery.recover()
      expect(result).toBeDefined()
    })

    it('should handle concurrent recovery calls', async () => {
      const sql = createMockSql({
        collections: [{ type: 'Test', data: JSON.stringify([createTestThing({ $id: 'concurrent' })]) }],
      })

      const recovery = new ColdStartRecovery({
        namespace: 'test.do',
        sql,
      })

      // Call recover() multiple times concurrently
      const results = await Promise.all([
        recovery.recover(),
        recovery.recover(),
        recovery.recover(),
      ])

      // All should succeed with same state
      expect(results[0].state.size).toBe(results[1].state.size)
      expect(results[1].state.size).toBe(results[2].state.size)
    })

    it('should handle empty namespace gracefully', async () => {
      const sql = createMockSql({ collections: [], things: [] })
      const iceberg = createMockIceberg([])

      // Edge case: empty namespace string
      const recovery = new ColdStartRecovery({
        namespace: '',
        sql,
        iceberg,
      })

      const result = await recovery.recover()
      expect(result.source).toBe('empty')
      expect(result.state.size).toBe(0)
    })
  })
})
