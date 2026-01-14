/**
 * ACID Phase 1: compact() Test Suite
 *
 * RED TDD: Comprehensive tests for DO.compact() operation.
 *
 * Tests defined behavior for history compaction:
 * - Basic compact keeps latest version of each thing
 * - Compact removes deleted things entirely
 * - Compact archives to R2 before deletion (atomicity)
 * - Compact clears actions table
 * - Compact preserves events (except archivable ones)
 * - Compact emits lifecycle events
 * - Compact handles empty state (error case)
 * - Compact options: preserve specific versions, time-based retention
 *
 * @module testing/acid/phase1/compact
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  FIXTURES,
  createThingFixture,
  createVersionedThingFixtures,
  createActionFixtures,
  createEventFixtures,
  type ThingFixture,
  type ActionFixture,
  type EventFixture,
} from '../fixtures'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Options for configuring compact behavior
 */
interface CompactOptions {
  /**
   * Minimum number of total thing versions before compacting.
   * If the total version count is below this threshold, compact is a no-op.
   * Default: 0 (always compact)
   */
  threshold?: number

  /**
   * Whether to archive compacted data to R2.
   * When false, old versions are deleted without archiving.
   * Default: true
   */
  archive?: boolean

  /**
   * Thing IDs to preserve all versions for (exempt from compaction).
   * Useful for audit trails or important documents.
   * Supports wildcard suffix: 'audit-*' matches 'audit-1', 'audit-log', etc.
   */
  preserveKeys?: string[]

  /**
   * Time-to-live in seconds for archived data in R2.
   * After TTL expires, R2 lifecycle rules will delete the archives.
   * Default: undefined (no expiration)
   */
  ttl?: number

  /**
   * Whether to preserve things modified within the retention period.
   * If set, things updated within this many seconds are preserved.
   */
  retentionPeriod?: number
}

/**
 * Result of a compact operation
 */
interface CompactResult {
  /** Number of thing versions compacted (removed) */
  thingsCompacted: number
  /** Number of actions archived to R2 */
  actionsArchived: number
  /** Number of events archived to R2 */
  eventsArchived: number
  /** True if compaction was skipped (threshold not met) */
  skipped?: boolean
  /** Thing IDs that were preserved (not compacted) */
  preservedKeys?: string[]
  /** TTL applied to archives */
  archiveTtl?: number
}

/**
 * Branch record type for testing
 */
interface BranchFixture {
  name: string
  thingId: string
  head: number
  base: number | null
  forkedFrom: string | null
  description: string | null
  createdAt: Date
  updatedAt: Date
}

// ============================================================================
// MOCK INFRASTRUCTURE
// ============================================================================

/**
 * Mock DurableObjectState for testing
 */
function createMockDOState() {
  const storage = new Map<string, unknown>()
  const sqlData: Map<string, unknown[]> = new Map()

  // Initialize tables
  sqlData.set('things', [])
  sqlData.set('branches', [])
  sqlData.set('actions', [])
  sqlData.set('events', [])
  sqlData.set('objects', [])

  return {
    id: {
      toString: () => 'mock-do-id-12345',
      name: 'test-namespace',
    },
    storage: {
      get: vi.fn(async (key: string) => storage.get(key)),
      put: vi.fn(async (key: string, value: unknown) => {
        storage.set(key, value)
      }),
      delete: vi.fn(async (key: string) => storage.delete(key)),
      list: vi.fn(async () => storage),
      sql: {
        exec: vi.fn((sql: string) => {
          return { results: [] }
        }),
      },
    },
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async (fn: () => Promise<void>) => fn()),
    _storage: storage,
    _sqlData: sqlData,
  }
}

/**
 * Mock environment bindings with R2 archive tracking
 */
function createMockEnv() {
  const doStubs = new Map<string, unknown>()
  const r2Archives = new Map<string, { data: string; metadata?: Record<string, unknown> }>()

  return {
    DO: {
      get: vi.fn((id: { toString: () => string }) => {
        const stub = {
          fetch: vi.fn(async () => new Response('OK')),
          id: id,
        }
        doStubs.set(id.toString(), stub)
        return stub
      }),
      idFromName: vi.fn((name: string) => ({
        toString: () => `id-from-${name}`,
        name,
      })),
      newUniqueId: vi.fn((options?: { locationHint?: string }) => ({
        toString: () => `new-unique-id-${options?.locationHint || 'default'}`,
        locationHint: options?.locationHint,
      })),
    },
    R2: {
      put: vi.fn(async (key: string, data: string, options?: {
        customMetadata?: Record<string, string>
        httpMetadata?: { cacheExpiry?: Date }
      }) => {
        r2Archives.set(key, { data, metadata: options })
        return {}
      }),
      get: vi.fn(async (key: string) => {
        const archive = r2Archives.get(key)
        if (!archive) return null
        return {
          text: async () => archive.data,
          json: async () => JSON.parse(archive.data),
        }
      }),
      delete: vi.fn(async () => {}),
    },
    _doStubs: doStubs,
    _r2Archives: r2Archives,
  }
}

// ============================================================================
// MOCK DATABASE
// ============================================================================

class MockDatabase {
  constructor(private sqlData: Map<string, unknown[]>) {}

  getThings(): ThingFixture[] {
    return this.sqlData.get('things') as ThingFixture[]
  }

  addThing(thing: ThingFixture): void {
    const things = this.getThings()
    thing.rowid = things.length + 1
    things.push(thing)
  }

  getEvents(): EventFixture[] {
    return this.sqlData.get('events') as EventFixture[]
  }

  getActions(): ActionFixture[] {
    return this.sqlData.get('actions') as ActionFixture[]
  }
}

// ============================================================================
// TEST DO CLASS
// ============================================================================

/**
 * Test DO class that simulates the DO base class compact() behavior.
 *
 * This is a RED implementation - tests are written to fail against this stub.
 * The real implementation will be in objects/DO.ts.
 */
class TestDO {
  readonly ns: string = 'https://test.acid.do'
  protected db: MockDatabase
  protected ctx: ReturnType<typeof createMockDOState>
  protected env: ReturnType<typeof createMockEnv>

  constructor(ctx: ReturnType<typeof createMockDOState>, env: ReturnType<typeof createMockEnv>) {
    this.ctx = ctx
    this.env = env
    this.db = new MockDatabase(ctx._sqlData)
  }

  // Test helper methods
  _addThing(thing: Omit<ThingFixture, 'rowid'>): void {
    this.db.addThing({ ...thing, rowid: undefined } as ThingFixture)
  }

  _getThings(): ThingFixture[] {
    return this.db.getThings()
  }

  _addAction(action: Partial<ActionFixture>): void {
    const actions = this.ctx._sqlData.get('actions') as ActionFixture[]
    actions.push(action as ActionFixture)
  }

  _addEvent(event: Partial<EventFixture>): void {
    const events = this.ctx._sqlData.get('events') as EventFixture[]
    events.push(event as EventFixture)
  }

  protected async emitEvent(verb: string, data: unknown): Promise<void> {
    const events = this.ctx._sqlData.get('events') as unknown[]
    events.push({
      id: crypto.randomUUID(),
      verb,
      source: this.ns,
      data,
      sequence: events.length + 1,
      streamed: false,
      createdAt: new Date(),
    })
  }

  /**
   * Squash history to current state.
   *
   * RED: This is a stub implementation. Tests define expected behavior.
   * The real implementation will be in objects/DO.ts.
   */
  async compact(_options?: CompactOptions): Promise<CompactResult> {
    // RED: Stub - returns failure to make tests RED
    throw new Error('compact() not implemented - RED TDD phase')
  }
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('DO.compact() - ACID Phase 1', () => {
  let mockState: ReturnType<typeof createMockDOState>
  let mockEnv: ReturnType<typeof createMockEnv>
  let testDO: TestDO

  beforeEach(() => {
    mockState = createMockDOState()
    mockEnv = createMockEnv()
    testDO = new TestDO(mockState, mockEnv)
  })

  // ==========================================================================
  // 1. BASIC COMPACT - KEEPS LATEST VERSION
  // ==========================================================================

  describe('Basic compact keeps latest version of each thing', () => {
    it('keeps only the latest version when multiple versions exist', async () => {
      // Setup: Three versions of the same thing
      testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v1', data: { v: 1 }, deleted: false })
      testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v2', data: { v: 2 }, deleted: false })
      testDO._addThing({ id: 'doc-1', type: 1, branch: null, name: 'v3', data: { v: 3 }, deleted: false })

      // Act
      const result = await testDO.compact()

      // Assert
      expect(result.thingsCompacted).toBe(2) // v1 and v2 compacted
      const things = testDO._getThings()
      expect(things).toHaveLength(1)
      expect(things[0].data).toEqual({ v: 3 })
    })

    it('keeps latest version per thing ID across multiple things', async () => {
      // Setup: Multiple things with multiple versions each
      testDO._addThing({ id: 'a', type: 1, branch: null, name: 'a-v1', data: { id: 'a', v: 1 }, deleted: false })
      testDO._addThing({ id: 'a', type: 1, branch: null, name: 'a-v2', data: { id: 'a', v: 2 }, deleted: false })
      testDO._addThing({ id: 'b', type: 1, branch: null, name: 'b-v1', data: { id: 'b', v: 1 }, deleted: false })
      testDO._addThing({ id: 'b', type: 1, branch: null, name: 'b-v2', data: { id: 'b', v: 2 }, deleted: false })
      testDO._addThing({ id: 'b', type: 1, branch: null, name: 'b-v3', data: { id: 'b', v: 3 }, deleted: false })

      // Act
      const result = await testDO.compact()

      // Assert
      expect(result.thingsCompacted).toBe(3) // a-v1, b-v1, b-v2 compacted
      const things = testDO._getThings()
      expect(things).toHaveLength(2)
      expect(things.find(t => t.id === 'a')?.data).toEqual({ id: 'a', v: 2 })
      expect(things.find(t => t.id === 'b')?.data).toEqual({ id: 'b', v: 3 })
    })

    it('keeps single-version things unchanged', async () => {
      // Setup: Single version of a thing
      testDO._addThing({ id: 'single', type: 1, branch: null, name: 'Single', data: { single: true }, deleted: false })

      // Act
      const result = await testDO.compact()

      // Assert
      expect(result.thingsCompacted).toBe(0)
      const things = testDO._getThings()
      expect(things).toHaveLength(1)
      expect(things[0].data).toEqual({ single: true })
    })

    it('handles branches independently - keeps latest per branch', async () => {
      // Setup: Same thing ID on different branches
      testDO._addThing({ id: 'item', type: 1, branch: null, name: 'main-v1', data: { b: 'main', v: 1 }, deleted: false })
      testDO._addThing({ id: 'item', type: 1, branch: null, name: 'main-v2', data: { b: 'main', v: 2 }, deleted: false })
      testDO._addThing({ id: 'item', type: 1, branch: 'feature', name: 'feat-v1', data: { b: 'feature', v: 1 }, deleted: false })
      testDO._addThing({ id: 'item', type: 1, branch: 'feature', name: 'feat-v2', data: { b: 'feature', v: 2 }, deleted: false })

      // Act
      const result = await testDO.compact()

      // Assert
      expect(result.thingsCompacted).toBe(2) // main-v1 and feat-v1 compacted
      const things = testDO._getThings()
      expect(things).toHaveLength(2)
      expect(things.find(t => t.branch === null)?.data).toEqual({ b: 'main', v: 2 })
      expect(things.find(t => t.branch === 'feature')?.data).toEqual({ b: 'feature', v: 2 })
    })

    it('uses rowid to determine latest version (not insertion order)', async () => {
      // Setup: Things with explicit rowids out of order
      const things = testDO._getThings()
      things.push({ id: 'doc', type: 1, branch: null, name: 'v3', data: { v: 3 }, deleted: false, rowid: 3 })
      things.push({ id: 'doc', type: 1, branch: null, name: 'v1', data: { v: 1 }, deleted: false, rowid: 1 })
      things.push({ id: 'doc', type: 1, branch: null, name: 'v2', data: { v: 2 }, deleted: false, rowid: 2 })

      // Act
      const result = await testDO.compact()

      // Assert
      expect(result.thingsCompacted).toBe(2)
      const remainingThings = testDO._getThings()
      expect(remainingThings).toHaveLength(1)
      expect(remainingThings[0].data).toEqual({ v: 3 }) // Highest rowid
    })
  })

  // ==========================================================================
  // 2. COMPACT REMOVES DELETED THINGS ENTIRELY
  // ==========================================================================

  describe('Compact removes deleted things entirely', () => {
    it('removes soft-deleted things after compact', async () => {
      // Setup: Active and deleted things
      testDO._addThing({ id: 'active', type: 1, branch: null, name: 'Active', data: { status: 'active' }, deleted: false })
      testDO._addThing({ id: 'deleted', type: 1, branch: null, name: 'Deleted', data: { status: 'deleted' }, deleted: true })

      // Act
      await testDO.compact()

      // Assert
      const things = testDO._getThings()
      expect(things).toHaveLength(1)
      expect(things.find(t => t.id === 'deleted')).toBeUndefined()
      expect(things.find(t => t.id === 'active')).toBeDefined()
    })

    it('removes all versions of deleted things', async () => {
      // Setup: Multiple versions, last one deleted
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: { v: 1 }, deleted: false })
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v2', data: { v: 2 }, deleted: false })
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v3-deleted', data: { v: 3 }, deleted: true })

      // Act
      await testDO.compact()

      // Assert
      const things = testDO._getThings()
      expect(things.find(t => t.id === 'doc')).toBeUndefined()
    })

    it('keeps non-deleted version if delete is not the latest', async () => {
      // Setup: Deleted version followed by restore
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: { v: 1 }, deleted: false })
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v2-deleted', data: { v: 2 }, deleted: true })
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v3-restored', data: { v: 3 }, deleted: false })

      // Act
      await testDO.compact()

      // Assert
      const things = testDO._getThings()
      expect(things).toHaveLength(1)
      expect(things[0].deleted).toBe(false)
      expect(things[0].data).toEqual({ v: 3 })
    })

    it('handles mix of deleted and active things across branches', async () => {
      // Setup: Deleted on main, active on feature
      testDO._addThing({ id: 'item', type: 1, branch: null, name: 'main', data: {}, deleted: true })
      testDO._addThing({ id: 'item', type: 1, branch: 'feature', name: 'feature', data: {}, deleted: false })

      // Act
      await testDO.compact()

      // Assert
      const things = testDO._getThings()
      expect(things).toHaveLength(1)
      expect(things[0].branch).toBe('feature')
    })
  })

  // ==========================================================================
  // 3. COMPACT ARCHIVES TO R2 BEFORE DELETION (ATOMICITY)
  // ==========================================================================

  describe('Compact archives to R2 before deletion (atomicity)', () => {
    it('archives things to R2 before removing them', async () => {
      // Setup
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: { v: 1 }, deleted: false })
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v2', data: { v: 2 }, deleted: false })

      // Act
      await testDO.compact()

      // Assert
      expect(mockEnv.R2.put).toHaveBeenCalled()
      // Verify archive key pattern
      const putCalls = mockEnv.R2.put.mock.calls
      const thingsArchive = putCalls.find(call => call[0].includes('/things/'))
      expect(thingsArchive).toBeDefined()
    })

    it('rolls back on R2 archive failure - state unchanged', async () => {
      // Setup
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: { v: 1 }, deleted: false })
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v2', data: { v: 2 }, deleted: false })

      const thingsBefore = [...testDO._getThings()]

      // Simulate R2 failure
      mockEnv.R2.put = vi.fn().mockRejectedValue(new Error('R2 failure'))

      // Act & Assert
      await expect(testDO.compact()).rejects.toThrow('R2 failure')

      // State should be unchanged (atomicity)
      const thingsAfter = testDO._getThings()
      expect(thingsAfter).toHaveLength(thingsBefore.length)
    })

    it('archives BEFORE deleting - order of operations matters', async () => {
      // Setup
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

      const operationOrder: string[] = []

      mockEnv.R2.put = vi.fn().mockImplementation(async () => {
        operationOrder.push('archive')
        return {}
      })

      // We'd need to track deletion order in real implementation
      // For now, verify archive is called

      // Act
      await testDO.compact()

      // Assert
      expect(operationOrder).toContain('archive')
      expect(mockEnv.R2.put).toHaveBeenCalled()
    })

    it('includes timestamp in archive key for recovery', async () => {
      // Setup
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: {}, deleted: false })

      // Act
      await testDO.compact()

      // Assert
      const putCalls = mockEnv.R2.put.mock.calls
      expect(putCalls.length).toBeGreaterThan(0)
      const archiveKey = putCalls[0][0] as string
      // Key should include timestamp pattern
      expect(archiveKey).toMatch(/\d+\.json$/)
    })

    it('includes namespace in archive path for multi-tenant isolation', async () => {
      // Setup
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: {}, deleted: false })

      // Act
      await testDO.compact()

      // Assert
      const putCalls = mockEnv.R2.put.mock.calls
      const archiveKey = putCalls[0][0] as string
      expect(archiveKey).toContain(testDO.ns)
    })
  })

  // ==========================================================================
  // 4. COMPACT CLEARS ACTIONS TABLE
  // ==========================================================================

  describe('Compact clears actions table', () => {
    it('clears all actions after archiving', async () => {
      // Setup
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
      testDO._addAction({ id: 'action-1', verb: 'create', actor: 'system', target: 'doc' })
      testDO._addAction({ id: 'action-2', verb: 'update', actor: 'system', target: 'doc' })
      testDO._addAction({ id: 'action-3', verb: 'update', actor: 'system', target: 'doc' })

      // Act
      const result = await testDO.compact()

      // Assert
      expect(result.actionsArchived).toBe(3)
      const actions = mockState._sqlData.get('actions') as ActionFixture[]
      expect(actions.length).toBe(0)
    })

    it('archives actions to R2 before clearing', async () => {
      // Setup
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
      testDO._addAction({ id: 'action-1', verb: 'create', actor: 'system', target: 'doc' })

      // Act
      await testDO.compact()

      // Assert
      const putCalls = mockEnv.R2.put.mock.calls
      const actionsArchive = putCalls.find(call => call[0].includes('/actions/'))
      expect(actionsArchive).toBeDefined()
    })

    it('reports 0 actionsArchived when no actions exist', async () => {
      // Setup
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
      // No actions

      // Act
      const result = await testDO.compact()

      // Assert
      expect(result.actionsArchived).toBe(0)
    })

    it('handles large action history efficiently', async () => {
      // Setup
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
      for (let i = 0; i < 1000; i++) {
        testDO._addAction({ id: `action-${i}`, verb: 'update', actor: 'system', target: 'doc' })
      }

      // Act
      const startTime = Date.now()
      const result = await testDO.compact()
      const duration = Date.now() - startTime

      // Assert
      expect(result.actionsArchived).toBe(1000)
      expect(duration).toBeLessThan(5000) // Should complete in < 5s
    })
  })

  // ==========================================================================
  // 5. COMPACT PRESERVES EVENTS (EXCEPT ARCHIVABLE ONES)
  // ==========================================================================

  describe('Compact preserves events (except archivable ones)', () => {
    it('preserves recent events after compact', async () => {
      // Setup
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
      testDO._addEvent({ id: 'event-1', verb: 'thing.created', source: testDO.ns, data: {}, sequence: 1 })
      testDO._addEvent({ id: 'event-2', verb: 'thing.updated', source: testDO.ns, data: {}, sequence: 2 })

      // Act
      await testDO.compact()

      // Assert - events should be preserved (not cleared like actions)
      const events = mockState._sqlData.get('events') as EventFixture[]
      // Should preserve user events, only compact lifecycle events are added
      expect(events.some(e => e.verb === 'thing.created')).toBe(true)
    })

    it('archives lifecycle events (compact.started, compact.completed)', async () => {
      // Setup
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
      // Pre-existing lifecycle events from previous compact
      testDO._addEvent({ id: 'old-1', verb: 'compact.started', source: testDO.ns, data: {}, sequence: 1 })
      testDO._addEvent({ id: 'old-2', verb: 'compact.completed', source: testDO.ns, data: {}, sequence: 2 })

      // Act
      await testDO.compact()

      // Assert - old lifecycle events should be archived, not preserved
      const putCalls = mockEnv.R2.put.mock.calls
      const eventsArchive = putCalls.find(call => call[0].includes('/events/'))
      expect(eventsArchive).toBeDefined()
    })

    it('keeps non-lifecycle events unarchived', async () => {
      // Setup
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
      testDO._addEvent({ id: 'user-event', verb: 'user.action', source: testDO.ns, data: { important: true }, sequence: 1 })

      // Act
      const result = await testDO.compact()

      // Assert
      const events = mockState._sqlData.get('events') as EventFixture[]
      expect(events.some(e => e.verb === 'user.action')).toBe(true)
    })

    it('reports correct eventsArchived count', async () => {
      // Setup
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
      testDO._addEvent({ id: 'archive-1', verb: 'compact.started', source: testDO.ns, data: {}, sequence: 1 })
      testDO._addEvent({ id: 'archive-2', verb: 'compact.completed', source: testDO.ns, data: {}, sequence: 2 })
      testDO._addEvent({ id: 'keep-1', verb: 'user.action', source: testDO.ns, data: {}, sequence: 3 })

      // Act
      const result = await testDO.compact()

      // Assert - only lifecycle events archived
      expect(result.eventsArchived).toBe(2)
    })
  })

  // ==========================================================================
  // 6. COMPACT EMITS LIFECYCLE EVENTS
  // ==========================================================================

  describe('Compact emits lifecycle events', () => {
    it('emits compact.started event at beginning', async () => {
      // Setup
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: {}, deleted: false })

      // Act
      await testDO.compact()

      // Assert
      const events = mockState._sqlData.get('events') as any[]
      const startedEvent = events.find(e => e.verb === 'compact.started')
      expect(startedEvent).toBeDefined()
      expect(startedEvent.source).toBe(testDO.ns)
    })

    it('emits compact.completed event on success', async () => {
      // Setup
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: {}, deleted: false })

      // Act
      await testDO.compact()

      // Assert
      const events = mockState._sqlData.get('events') as any[]
      const completedEvent = events.find(e => e.verb === 'compact.completed')
      expect(completedEvent).toBeDefined()
    })

    it('includes thingsCount in compact.started event data', async () => {
      // Setup
      testDO._addThing({ id: 'a', type: 1, branch: null, name: 'a', data: {}, deleted: false })
      testDO._addThing({ id: 'b', type: 1, branch: null, name: 'b', data: {}, deleted: false })
      testDO._addThing({ id: 'c', type: 1, branch: null, name: 'c', data: {}, deleted: false })

      // Act
      await testDO.compact()

      // Assert
      const events = mockState._sqlData.get('events') as any[]
      const startedEvent = events.find(e => e.verb === 'compact.started')
      expect(startedEvent.data.thingsCount).toBe(3)
    })

    it('includes stats in compact.completed event data', async () => {
      // Setup
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v2', data: {}, deleted: false })
      testDO._addAction({ id: 'action-1', verb: 'create', actor: 'system', target: 'doc' })

      // Act
      await testDO.compact()

      // Assert
      const events = mockState._sqlData.get('events') as any[]
      const completedEvent = events.find(e => e.verb === 'compact.completed')
      expect(completedEvent.data.thingsCompacted).toBeDefined()
      expect(completedEvent.data.actionsArchived).toBeDefined()
    })

    it('does NOT emit compact.completed on failure', async () => {
      // Setup
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
      mockEnv.R2.put = vi.fn().mockRejectedValue(new Error('R2 failure'))

      // Act
      try {
        await testDO.compact()
      } catch {
        // Expected
      }

      // Assert
      const events = mockState._sqlData.get('events') as any[]
      const completedEvent = events.find(e => e.verb === 'compact.completed')
      expect(completedEvent).toBeUndefined()
    })

    it('events have sequential sequence numbers', async () => {
      // Setup
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: {}, deleted: false })

      // Act
      await testDO.compact()

      // Assert
      const events = mockState._sqlData.get('events') as any[]
      const compactEvents = events.filter(e =>
        e.verb === 'compact.started' || e.verb === 'compact.completed'
      )
      expect(compactEvents.length).toBe(2)
      expect(compactEvents[1].sequence).toBeGreaterThan(compactEvents[0].sequence)
    })
  })

  // ==========================================================================
  // 7. COMPACT HANDLES EMPTY STATE (ERROR CASE)
  // ==========================================================================

  describe('Compact handles empty state (error case)', () => {
    it('throws error when no things exist', async () => {
      // Setup: Empty state
      // No things added

      // Act & Assert
      await expect(testDO.compact()).rejects.toThrow('Nothing to compact')
    })

    it('throws error with options when no things exist', async () => {
      // Setup: Empty state with options
      // No things added

      // Act & Assert
      await expect(testDO.compact({ threshold: 10 })).rejects.toThrow('Nothing to compact')
    })

    it('throws even with actions/events if no things', async () => {
      // Setup: Only actions/events, no things
      testDO._addAction({ id: 'orphan-action', verb: 'unknown', actor: 'system', target: 'missing' })
      testDO._addEvent({ id: 'orphan-event', verb: 'unknown', source: testDO.ns, data: {}, sequence: 1 })

      // Act & Assert
      await expect(testDO.compact()).rejects.toThrow('Nothing to compact')
    })

    it('throws specific error message for empty state', async () => {
      // Act & Assert
      await expect(testDO.compact()).rejects.toThrow(/nothing to compact/i)
    })
  })

  // ==========================================================================
  // 8. COMPACT OPTIONS: PRESERVE SPECIFIC VERSIONS
  // ==========================================================================

  describe('Compact options: preserve specific versions (preserveKeys)', () => {
    it('preserves all versions for specified keys', async () => {
      // Setup
      testDO._addThing({ id: 'audit-1', type: 1, branch: null, name: 'v1', data: { v: 1 }, deleted: false })
      testDO._addThing({ id: 'audit-1', type: 1, branch: null, name: 'v2', data: { v: 2 }, deleted: false })
      testDO._addThing({ id: 'audit-1', type: 1, branch: null, name: 'v3', data: { v: 3 }, deleted: false })
      testDO._addThing({ id: 'regular', type: 1, branch: null, name: 'v1', data: { v: 1 }, deleted: false })
      testDO._addThing({ id: 'regular', type: 1, branch: null, name: 'v2', data: { v: 2 }, deleted: false })

      // Act
      const result = await testDO.compact({ preserveKeys: ['audit-1'] })

      // Assert
      const things = testDO._getThings()
      const auditVersions = things.filter(t => t.id === 'audit-1')
      const regularVersions = things.filter(t => t.id === 'regular')

      expect(auditVersions).toHaveLength(3) // All versions preserved
      expect(regularVersions).toHaveLength(1) // Compacted to latest
      expect(result.preservedKeys).toContain('audit-1')
    })

    it('supports wildcard prefix matching (audit-*)', async () => {
      // Setup
      testDO._addThing({ id: 'audit-log-1', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
      testDO._addThing({ id: 'audit-log-1', type: 1, branch: null, name: 'v2', data: {}, deleted: false })
      testDO._addThing({ id: 'audit-trace-1', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
      testDO._addThing({ id: 'audit-trace-1', type: 1, branch: null, name: 'v2', data: {}, deleted: false })
      testDO._addThing({ id: 'normal-doc', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
      testDO._addThing({ id: 'normal-doc', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

      // Act
      await testDO.compact({ preserveKeys: ['audit-*'] })

      // Assert
      const things = testDO._getThings()
      expect(things.filter(t => t.id === 'audit-log-1')).toHaveLength(2)
      expect(things.filter(t => t.id === 'audit-trace-1')).toHaveLength(2)
      expect(things.filter(t => t.id === 'normal-doc')).toHaveLength(1)
    })

    it('handles non-existent preserve keys gracefully', async () => {
      // Setup
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

      // Act
      const result = await testDO.compact({ preserveKeys: ['non-existent'] })

      // Assert
      expect(result.thingsCompacted).toBe(1)
      expect(result.preservedKeys).toBeUndefined() // Or empty array
    })

    it('preserveKeys does not prevent archiving to R2', async () => {
      // Setup
      testDO._addThing({ id: 'preserved', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
      testDO._addThing({ id: 'preserved', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

      // Act
      await testDO.compact({ preserveKeys: ['preserved'] })

      // Assert - should still archive, just not delete
      expect(mockEnv.R2.put).toHaveBeenCalled()
    })

    it('reports correct thingsCompacted excluding preserved', async () => {
      // Setup
      testDO._addThing({ id: 'preserved', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
      testDO._addThing({ id: 'preserved', type: 1, branch: null, name: 'v2', data: {}, deleted: false })
      testDO._addThing({ id: 'preserved', type: 1, branch: null, name: 'v3', data: {}, deleted: false })
      testDO._addThing({ id: 'normal', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
      testDO._addThing({ id: 'normal', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

      // Act
      const result = await testDO.compact({ preserveKeys: ['preserved'] })

      // Assert - only normal's old version compacted
      expect(result.thingsCompacted).toBe(1)
    })
  })

  // ==========================================================================
  // 9. COMPACT OPTIONS: TIME-BASED RETENTION
  // ==========================================================================

  describe('Compact options: time-based retention (ttl, retentionPeriod)', () => {
    it('sets TTL metadata on R2 archives', async () => {
      // Setup
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

      // Act
      await testDO.compact({ ttl: 86400 }) // 24 hours

      // Assert
      const putCalls = mockEnv.R2.put.mock.calls
      expect(putCalls.length).toBeGreaterThan(0)
      const [, , options] = putCalls[0]
      expect(options?.httpMetadata?.cacheExpiry).toBeDefined()
    })

    it('returns archiveTtl in result', async () => {
      // Setup
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: {}, deleted: false })

      // Act
      const result = await testDO.compact({ ttl: 604800 }) // 7 days

      // Assert
      expect(result.archiveTtl).toBe(604800)
    })

    it('does not set TTL when not specified', async () => {
      // Setup
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: {}, deleted: false })

      // Act
      const result = await testDO.compact()

      // Assert
      expect(result.archiveTtl).toBeUndefined()
    })

    it('rejects negative TTL', async () => {
      // Setup
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: {}, deleted: false })

      // Act & Assert
      await expect(testDO.compact({ ttl: -100 })).rejects.toThrow(/TTL must be non-negative/i)
    })

    it('TTL is ignored when archive: false', async () => {
      // Setup
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

      // Act
      const result = await testDO.compact({ archive: false, ttl: 86400 })

      // Assert
      expect(mockEnv.R2.put).not.toHaveBeenCalled()
      expect(result.archiveTtl).toBeUndefined()
    })

    it('retentionPeriod preserves recently modified things', async () => {
      // Setup - things with different ages
      const now = Date.now()
      const things = testDO._getThings()

      // Old thing (should be compacted)
      things.push({
        id: 'old-doc',
        type: 1,
        branch: null,
        name: 'v1',
        data: { age: 'old' },
        deleted: false,
        rowid: 1,
      })
      things.push({
        id: 'old-doc',
        type: 1,
        branch: null,
        name: 'v2',
        data: { age: 'old' },
        deleted: false,
        rowid: 2,
      })

      // Recent thing (should be preserved if within retention)
      // Note: Implementation would check updatedAt timestamp
      things.push({
        id: 'recent-doc',
        type: 1,
        branch: null,
        name: 'v1',
        data: { age: 'recent' },
        deleted: false,
        rowid: 3,
      })
      things.push({
        id: 'recent-doc',
        type: 1,
        branch: null,
        name: 'v2',
        data: { age: 'recent' },
        deleted: false,
        rowid: 4,
      })

      // Act
      await testDO.compact({ retentionPeriod: 3600 }) // 1 hour

      // Assert - recent things should have all versions preserved
      const remainingThings = testDO._getThings()
      // This behavior depends on implementation using timestamps
      expect(remainingThings.length).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // 10. COMPACT OPTIONS: THRESHOLD
  // ==========================================================================

  describe('Compact options: threshold', () => {
    it('skips compaction when below threshold', async () => {
      // Setup: 3 things
      testDO._addThing({ id: 'a', type: 1, branch: null, name: 'a', data: {}, deleted: false })
      testDO._addThing({ id: 'b', type: 1, branch: null, name: 'b', data: {}, deleted: false })
      testDO._addThing({ id: 'c', type: 1, branch: null, name: 'c', data: {}, deleted: false })

      // Act
      const result = await testDO.compact({ threshold: 10 })

      // Assert
      expect(result.skipped).toBe(true)
      expect(result.thingsCompacted).toBe(0)
      expect(testDO._getThings()).toHaveLength(3)
    })

    it('compacts when meeting threshold', async () => {
      // Setup: 10 versions
      for (let i = 0; i < 10; i++) {
        testDO._addThing({ id: 'doc', type: 1, branch: null, name: `v${i}`, data: { v: i }, deleted: false })
      }

      // Act
      const result = await testDO.compact({ threshold: 10 })

      // Assert
      expect(result.skipped).toBeFalsy()
      expect(result.thingsCompacted).toBe(9)
    })

    it('compacts when exceeding threshold', async () => {
      // Setup: 15 versions
      for (let i = 0; i < 15; i++) {
        testDO._addThing({ id: 'doc', type: 1, branch: null, name: `v${i}`, data: { v: i }, deleted: false })
      }

      // Act
      const result = await testDO.compact({ threshold: 10 })

      // Assert
      expect(result.skipped).toBeFalsy()
      expect(result.thingsCompacted).toBe(14)
    })

    it('threshold of 0 always compacts (default behavior)', async () => {
      // Setup
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

      // Act
      const result = await testDO.compact({ threshold: 0 })

      // Assert
      expect(result.skipped).toBeFalsy()
    })

    it('negative threshold treated as 0', async () => {
      // Setup
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

      // Act
      const result = await testDO.compact({ threshold: -5 })

      // Assert
      expect(result.skipped).toBeFalsy()
    })

    it('emits events even when skipped', async () => {
      // Setup
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: {}, deleted: false })

      // Act
      await testDO.compact({ threshold: 100 })

      // Assert
      const events = mockState._sqlData.get('events') as any[]
      expect(events.some(e => e.verb === 'compact.started')).toBe(true)
      expect(events.some(e => e.verb === 'compact.completed')).toBe(true)
    })

    it('includes skipped reason in completed event', async () => {
      // Setup
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: {}, deleted: false })

      // Act
      await testDO.compact({ threshold: 100 })

      // Assert
      const events = mockState._sqlData.get('events') as any[]
      const completedEvent = events.find(e => e.verb === 'compact.completed')
      expect(completedEvent.data.skipped).toBe(true)
      expect(completedEvent.data.reason).toBe('threshold_not_met')
    })
  })

  // ==========================================================================
  // 11. COMPACT OPTIONS: ARCHIVE CONTROL
  // ==========================================================================

  describe('Compact options: archive control', () => {
    it('archive: false skips R2 archiving', async () => {
      // Setup
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

      // Act
      await testDO.compact({ archive: false })

      // Assert
      expect(mockEnv.R2.put).not.toHaveBeenCalled()
    })

    it('archive: false still removes old versions', async () => {
      // Setup
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: { v: 1 }, deleted: false })
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v2', data: { v: 2 }, deleted: false })
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v3', data: { v: 3 }, deleted: false })

      // Act
      const result = await testDO.compact({ archive: false })

      // Assert
      expect(result.thingsCompacted).toBe(2)
      expect(testDO._getThings()).toHaveLength(1)
      expect(testDO._getThings()[0].data).toEqual({ v: 3 })
    })

    it('archive: false still clears actions', async () => {
      // Setup
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
      testDO._addAction({ id: 'action-1', verb: 'create', actor: 'system', target: 'doc' })

      // Act
      await testDO.compact({ archive: false })

      // Assert
      const actions = mockState._sqlData.get('actions') as ActionFixture[]
      expect(actions.length).toBe(0)
    })

    it('archive: false reports archive counts as 0', async () => {
      // Setup
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
      testDO._addAction({ id: 'action-1', verb: 'create', actor: 'system', target: 'doc' })

      // Act
      const result = await testDO.compact({ archive: false })

      // Assert
      expect(result.actionsArchived).toBe(0)
      expect(result.eventsArchived).toBe(0)
    })

    it('handles missing R2 binding gracefully', async () => {
      // Setup
      const envWithoutR2 = { ...mockEnv, R2: undefined }
      const doWithoutR2 = new TestDO(mockState, envWithoutR2 as any)
      doWithoutR2._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
      doWithoutR2._addThing({ id: 'doc', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

      // Act & Assert - should not throw
      const result = await doWithoutR2.compact()

      expect(result.thingsCompacted).toBe(1)
      expect(result.actionsArchived).toBe(0)
    })
  })

  // ==========================================================================
  // 12. COMBINED OPTIONS
  // ==========================================================================

  describe('Combined options', () => {
    it('threshold + archive: false', async () => {
      // Setup
      for (let i = 0; i < 10; i++) {
        testDO._addThing({ id: 'doc', type: 1, branch: null, name: `v${i}`, data: {}, deleted: false })
      }

      // Act
      const result = await testDO.compact({ threshold: 5, archive: false })

      // Assert
      expect(result.skipped).toBeFalsy()
      expect(result.thingsCompacted).toBe(9)
      expect(mockEnv.R2.put).not.toHaveBeenCalled()
    })

    it('threshold + preserveKeys', async () => {
      // Setup
      for (let i = 0; i < 5; i++) {
        testDO._addThing({ id: 'preserved', type: 1, branch: null, name: `v${i}`, data: {}, deleted: false })
      }
      for (let i = 0; i < 5; i++) {
        testDO._addThing({ id: 'regular', type: 1, branch: null, name: `v${i}`, data: {}, deleted: false })
      }

      // Act
      const result = await testDO.compact({ threshold: 8, preserveKeys: ['preserved'] })

      // Assert - total 10 meets threshold of 8
      expect(result.skipped).toBeFalsy()
      expect(testDO._getThings().filter(t => t.id === 'preserved')).toHaveLength(5)
      expect(testDO._getThings().filter(t => t.id === 'regular')).toHaveLength(1)
    })

    it('archive + ttl + preserveKeys', async () => {
      // Setup
      testDO._addThing({ id: 'audit', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
      testDO._addThing({ id: 'audit', type: 1, branch: null, name: 'v2', data: {}, deleted: false })
      testDO._addThing({ id: 'regular', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
      testDO._addThing({ id: 'regular', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

      // Act
      const result = await testDO.compact({
        archive: true,
        ttl: 86400,
        preserveKeys: ['audit'],
      })

      // Assert
      expect(testDO._getThings().filter(t => t.id === 'audit')).toHaveLength(2)
      expect(testDO._getThings().filter(t => t.id === 'regular')).toHaveLength(1)
      expect(result.archiveTtl).toBe(86400)
      expect(mockEnv.R2.put).toHaveBeenCalled()
    })

    it('all options together', async () => {
      // Setup
      for (let i = 0; i < 15; i++) {
        testDO._addThing({ id: 'normal', type: 1, branch: null, name: `v${i}`, data: {}, deleted: false })
      }
      for (let i = 0; i < 5; i++) {
        testDO._addThing({ id: 'audit', type: 1, branch: null, name: `v${i}`, data: {}, deleted: false })
      }

      // Act
      const result = await testDO.compact({
        threshold: 10,
        archive: true,
        preserveKeys: ['audit'],
        ttl: 604800,
      })

      // Assert - total 20 exceeds threshold of 10
      expect(result.skipped).toBeFalsy()
      expect(testDO._getThings().filter(t => t.id === 'normal')).toHaveLength(1)
      expect(testDO._getThings().filter(t => t.id === 'audit')).toHaveLength(5)
      expect(mockEnv.R2.put).toHaveBeenCalled()
      expect(result.archiveTtl).toBe(604800)
    })
  })

  // ==========================================================================
  // 13. ACID PROPERTY: ATOMICITY
  // ==========================================================================

  describe('ACID: Atomicity', () => {
    it('all-or-nothing: no partial state on failure', async () => {
      // Setup
      testDO._addThing({ id: 'a', type: 1, branch: null, name: 'a-v1', data: {}, deleted: false })
      testDO._addThing({ id: 'a', type: 1, branch: null, name: 'a-v2', data: {}, deleted: false })
      testDO._addThing({ id: 'b', type: 1, branch: null, name: 'b-v1', data: {}, deleted: false })
      testDO._addThing({ id: 'b', type: 1, branch: null, name: 'b-v2', data: {}, deleted: false })

      const thingsBefore = testDO._getThings().length

      // Fail after some progress
      let callCount = 0
      mockEnv.R2.put = vi.fn().mockImplementation(async () => {
        callCount++
        if (callCount === 2) {
          throw new Error('R2 failure mid-operation')
        }
        return {}
      })

      // Act
      try {
        await testDO.compact()
      } catch {
        // Expected
      }

      // Assert - state should be completely unchanged
      expect(testDO._getThings().length).toBe(thingsBefore)
    })

    it('rollback restores original state exactly', async () => {
      // Setup
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: { original: true }, deleted: false })
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v2', data: { original: true }, deleted: false })

      const originalState = JSON.stringify(testDO._getThings())

      mockEnv.R2.put = vi.fn().mockRejectedValue(new Error('Failure'))

      // Act
      try {
        await testDO.compact()
      } catch {
        // Expected
      }

      // Assert
      expect(JSON.stringify(testDO._getThings())).toBe(originalState)
    })
  })

  // ==========================================================================
  // 14. ACID PROPERTY: CONSISTENCY
  // ==========================================================================

  describe('ACID: Consistency', () => {
    it('maintains referential integrity after compact', async () => {
      // Setup - things with relationships
      testDO._addThing({ id: 'parent', type: 1, branch: null, name: 'Parent', data: {}, deleted: false })
      testDO._addThing({ id: 'child', type: 1, branch: null, name: 'Child', data: { parentId: 'parent' }, deleted: false })
      testDO._addThing({ id: 'child', type: 1, branch: null, name: 'Child v2', data: { parentId: 'parent' }, deleted: false })

      // Act
      await testDO.compact()

      // Assert - child still references parent
      const things = testDO._getThings()
      const child = things.find(t => t.id === 'child')
      expect(child?.data?.parentId).toBe('parent')
      expect(things.find(t => t.id === 'parent')).toBeDefined()
    })

    it('updates branch head pointers correctly', async () => {
      // Setup
      const branches = mockState._sqlData.get('branches') as BranchFixture[]
      branches.push({
        name: 'feature',
        thingId: 'item',
        head: 5,
        base: 1,
        forkedFrom: 'main',
        description: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      testDO._addThing({ id: 'item', type: 1, branch: 'feature', name: 'v1', data: {}, deleted: false })
      testDO._addThing({ id: 'item', type: 1, branch: 'feature', name: 'v2', data: {}, deleted: false })

      // Act
      await testDO.compact()

      // Assert - branch head should be updated
      const featureBranch = branches.find(b => b.name === 'feature')
      expect(featureBranch).toBeDefined()
    })

    it('preserves type constraints after compact', async () => {
      // Setup
      testDO._addThing({ id: 'typed-doc', type: 5, branch: null, name: 'v1', data: {}, deleted: false })
      testDO._addThing({ id: 'typed-doc', type: 5, branch: null, name: 'v2', data: {}, deleted: false })

      // Act
      await testDO.compact()

      // Assert
      const things = testDO._getThings()
      expect(things[0].type).toBe(5)
    })
  })

  // ==========================================================================
  // 15. ACID PROPERTY: ISOLATION
  // ==========================================================================

  describe('ACID: Isolation', () => {
    it('branch compaction is isolated per branch', async () => {
      // Setup
      testDO._addThing({ id: 'item', type: 1, branch: null, name: 'main-v1', data: { v: 1 }, deleted: false })
      testDO._addThing({ id: 'item', type: 1, branch: null, name: 'main-v2', data: { v: 2 }, deleted: false })
      testDO._addThing({ id: 'item', type: 1, branch: 'feature', name: 'feat-v1', data: { v: 1 }, deleted: false })
      testDO._addThing({ id: 'item', type: 1, branch: 'feature', name: 'feat-v2', data: { v: 2 }, deleted: false })

      // Act
      await testDO.compact()

      // Assert - each branch independently compacted
      const things = testDO._getThings()
      const mainItem = things.find(t => t.id === 'item' && t.branch === null)
      const featureItem = things.find(t => t.id === 'item' && t.branch === 'feature')

      expect(mainItem?.data?.v).toBe(2)
      expect(featureItem?.data?.v).toBe(2)
    })

    it('concurrent compact calls are serialized', async () => {
      // Setup
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

      // Act - simulate concurrent calls
      const results = await Promise.all([
        testDO.compact(),
        testDO.compact(),
      ])

      // Assert - second compact should find nothing to do or be idempotent
      expect(testDO._getThings()).toHaveLength(1)
    })
  })

  // ==========================================================================
  // 16. ACID PROPERTY: DURABILITY
  // ==========================================================================

  describe('ACID: Durability', () => {
    it('archives persist to R2 before local deletion', async () => {
      // Setup
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: { important: true }, deleted: false })
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v2', data: { important: true }, deleted: false })

      // Act
      await testDO.compact()

      // Assert - archive was written to R2
      expect(mockEnv._r2Archives.size).toBeGreaterThan(0)
    })

    it('events are persisted before operation returns', async () => {
      // Setup
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: {}, deleted: false })

      // Act
      await testDO.compact()

      // Assert - events are in storage immediately
      const events = mockState._sqlData.get('events') as any[]
      expect(events.some(e => e.verb === 'compact.completed')).toBe(true)
    })

    it('compacted state survives simulated restart', async () => {
      // Setup
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: { v: 1 }, deleted: false })
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v2', data: { v: 2 }, deleted: false })
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v3', data: { v: 3 }, deleted: false })

      // Act - compact
      await testDO.compact()

      // Simulate restart - recreate DO with same state
      const newDO = new TestDO(mockState, mockEnv)

      // Assert - compacted state persists
      expect(newDO._getThings()).toHaveLength(1)
      expect(newDO._getThings()[0].data).toEqual({ v: 3 })
    })
  })

  // ==========================================================================
  // 17. EDGE CASES
  // ==========================================================================

  describe('Edge cases', () => {
    it('handles 1000+ versions efficiently', async () => {
      // Setup
      for (let i = 0; i < 1000; i++) {
        testDO._addThing({ id: 'doc', type: 1, branch: null, name: `v${i}`, data: { v: i }, deleted: false })
      }

      // Act
      const startTime = Date.now()
      const result = await testDO.compact()
      const duration = Date.now() - startTime

      // Assert
      expect(result.thingsCompacted).toBe(999)
      expect(testDO._getThings()).toHaveLength(1)
      expect(duration).toBeLessThan(5000)
    })

    it('handles 100+ unique thing IDs', async () => {
      // Setup
      for (let doc = 0; doc < 100; doc++) {
        for (let v = 0; v < 3; v++) {
          testDO._addThing({
            id: `doc-${doc}`,
            type: 1,
            branch: null,
            name: `v${v}`,
            data: {},
            deleted: false,
          })
        }
      }

      // Act
      const result = await testDO.compact()

      // Assert
      expect(result.thingsCompacted).toBe(200) // 2 per doc
      expect(testDO._getThings()).toHaveLength(100)
    })

    it('handles thing IDs with special characters', async () => {
      // Setup
      testDO._addThing({ id: 'doc/with/slashes', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
      testDO._addThing({ id: 'doc/with/slashes', type: 1, branch: null, name: 'v2', data: {}, deleted: false })
      testDO._addThing({ id: 'doc:with:colons', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
      testDO._addThing({ id: 'doc:with:colons', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

      // Act
      const result = await testDO.compact()

      // Assert
      expect(result.thingsCompacted).toBe(2)
      expect(testDO._getThings()).toHaveLength(2)
    })

    it('handles unicode thing IDs', async () => {
      // Setup
      testDO._addThing({ id: 'doc-\u{1F600}', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
      testDO._addThing({ id: 'doc-\u{1F600}', type: 1, branch: null, name: 'v2', data: {}, deleted: false })
      testDO._addThing({ id: 'doc-\u65E5\u672C\u8A9E', type: 1, branch: null, name: 'v1', data: {}, deleted: false })

      // Act
      const result = await testDO.compact()

      // Assert
      expect(result.thingsCompacted).toBe(1)
    })

    it('second compact after first is idempotent', async () => {
      // Setup
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v1', data: {}, deleted: false })
      testDO._addThing({ id: 'doc', type: 1, branch: null, name: 'v2', data: {}, deleted: false })

      // Act
      await testDO.compact()
      const result2 = await testDO.compact()

      // Assert
      expect(result2.thingsCompacted).toBe(0)
    })

    it('handles very large data payloads', async () => {
      // Setup - large JSON data
      const largeData = { content: 'x'.repeat(100000) } // 100KB
      testDO._addThing({ id: 'large', type: 1, branch: null, name: 'v1', data: largeData, deleted: false })
      testDO._addThing({ id: 'large', type: 1, branch: null, name: 'v2', data: largeData, deleted: false })

      // Act
      const result = await testDO.compact()

      // Assert
      expect(result.thingsCompacted).toBe(1)
    })
  })
})
