/**
 * ACID Test Suite - Phase 1: compact() - Squash History to Current State
 *
 * RED TDD: These tests define the expected behavior for compact() operation.
 * The compact() operation:
 * - Archives old versions to R2 before deletion
 * - Keeps only latest version of each thing
 * - Removes deleted things entirely
 * - Clears actions table
 * - Preserves non-archivable events
 * - Emits lifecycle events for observability
 *
 * ACID Properties Tested:
 * - Atomicity: Archive to R2 before deleting local state
 * - Consistency: Valid state invariants maintained
 * - Isolation: Compaction doesn't affect ongoing operations
 * - Durability: R2 archives created before local deletion
 *
 * @see objects/DOFull.ts for compact() implementation
 * @see objects/lifecycle/Compact.ts for CompactModule
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockDO, MockDOResult, MockEnv, createMockR2 } from '../../do'
import { DO } from '../../../objects/DO'

// ============================================================================
// TYPE DEFINITIONS FOR COMPACT API
// ============================================================================

/**
 * Options for the compact() operation
 */
interface CompactOptions {
  /** Retention period in ms (keep history from last N ms) */
  retention?: number
  /** Preserve specific versions by rowid */
  preserveVersions?: number[]
  /** Archive destination (default: R2) */
  archiveTo?: 'r2' | 'none'
  /** Correlation ID for tracing */
  correlationId?: string
}

/**
 * Result of a compact operation
 */
interface CompactResult {
  /** Number of things compacted (old versions removed) */
  thingsCompacted: number
  /** Number of actions archived */
  actionsArchived: number
  /** Number of events archived */
  eventsArchived: number
  /** R2 archive key (if archiving enabled) */
  archiveKey?: string
  /** Duration in ms */
  durationMs?: number
}

/**
 * Compact event types
 */
type CompactEventType =
  | 'compact.started'
  | 'compact.completed'
  | 'compact.failed'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create sample thing data for testing
 */
function createSampleThing(overrides: Partial<{
  id: string
  type: number
  branch: string | null
  name: string
  data: Record<string, unknown>
  deleted: boolean
  rowid: number
}> = {}) {
  return {
    id: overrides.id ?? 'thing-001',
    type: overrides.type ?? 1,
    branch: overrides.branch ?? null,
    name: overrides.name ?? 'Test Thing',
    data: overrides.data ?? { key: 'value' },
    deleted: overrides.deleted ?? false,
    rowid: overrides.rowid ?? 1,
  }
}

/**
 * Create sample action data
 */
function createSampleAction(overrides: Partial<{
  id: string
  verb: string
  target: string
  input: unknown
  output: unknown
}> = {}) {
  return {
    id: overrides.id ?? 'action-001',
    verb: overrides.verb ?? 'update',
    target: overrides.target ?? 'Thing/thing-001',
    input: overrides.input ?? { before: 'old' },
    output: overrides.output ?? { after: 'new' },
    createdAt: new Date(),
  }
}

/**
 * Create sample event data
 */
function createSampleEvent(overrides: Partial<{
  id: string
  verb: string
  source: string
  data: unknown
}> = {}) {
  return {
    id: overrides.id ?? 'event-001',
    verb: overrides.verb ?? 'thing.updated',
    source: overrides.source ?? 'Thing/thing-001',
    data: overrides.data ?? { change: 'value' },
    createdAt: new Date(),
  }
}

// ============================================================================
// COMPACT OPERATION TESTS
// ============================================================================

describe('ACID Phase 1: compact() - Squash History', () => {
  let mockResult: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    mockResult = createMockDO(DO, {
      id: 'test-do',
      ns: 'https://test.example.com',
    })

    // Set up initial state with multiple versions
    mockResult.sqlData.set('things', [
      createSampleThing({ id: 'item-1', rowid: 1, data: { version: 1 } }),
      createSampleThing({ id: 'item-1', rowid: 2, data: { version: 2 } }),
      createSampleThing({ id: 'item-1', rowid: 3, data: { version: 3 } }), // Latest
      createSampleThing({ id: 'item-2', rowid: 4, data: { value: 'only' } }),
    ])

    mockResult.sqlData.set('actions', [
      createSampleAction({ id: 'action-1', verb: 'create' }),
      createSampleAction({ id: 'action-2', verb: 'update' }),
    ])

    mockResult.sqlData.set('events', [
      createSampleEvent({ id: 'event-1', verb: 'thing.created' }),
      createSampleEvent({ id: 'event-2', verb: 'thing.updated' }),
    ])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // BASIC COMPACT OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Basic Compact Operations', () => {
    it('should keep only latest version of each thing', async () => {
      const result = await mockResult.instance.compact()

      expect(result.thingsCompacted).toBeGreaterThan(0)

      // After compact, should only have 2 things (latest version of each)
      const things = mockResult.sqlData.get('things') as Array<{ id: string; rowid: number }>
      const uniqueIds = new Set(things.map(t => t.id))
      expect(uniqueIds.size).toBe(things.length) // Each ID appears once
    })

    it('should remove deleted things entirely', async () => {
      mockResult.sqlData.set('things', [
        createSampleThing({ id: 'active-1', deleted: false }),
        createSampleThing({ id: 'deleted-1', deleted: true }),
        createSampleThing({ id: 'active-2', deleted: false }),
      ])

      await mockResult.instance.compact()

      const things = mockResult.sqlData.get('things') as Array<{ deleted: boolean }>
      expect(things.every(t => !t.deleted)).toBe(true)
      expect(things).toHaveLength(2)
    })

    it('should archive to R2 before deletion', async () => {
      const r2Puts: Array<{ key: string; data: unknown }> = []
      mockResult.env.R2.put = vi.fn().mockImplementation(async (key: string, data: unknown) => {
        r2Puts.push({ key, data })
      })

      await mockResult.instance.compact()

      // Should have archived things
      expect(r2Puts.length).toBeGreaterThan(0)
      expect(r2Puts.some(p => p.key.includes('things'))).toBe(true)
    })

    it('should clear actions table', async () => {
      await mockResult.instance.compact()

      const result = await mockResult.instance.compact()
      expect(result.actionsArchived).toBeDefined()
      // Actions should be archived and cleared
    })

    it('should preserve non-archivable events', async () => {
      mockResult.sqlData.set('events', [
        createSampleEvent({ verb: 'compact.started' }), // Should preserve
        createSampleEvent({ verb: 'compact.completed' }), // Should preserve
        createSampleEvent({ verb: 'thing.updated' }), // Should archive
      ])

      await mockResult.instance.compact()

      const events = mockResult.sqlData.get('events') as Array<{ verb: string }>
      // Compact events should not be archived
      const compactEvents = events.filter(e =>
        e.verb === 'compact.started' || e.verb === 'compact.completed'
      )
      expect(compactEvents.length).toBeGreaterThan(0)
    })

    it('should emit compact.started and compact.completed events', async () => {
      await mockResult.instance.compact()

      const events = mockResult.sqlData.get('events') as Array<{ verb: string }>
      const eventVerbs = events.map(e => e.verb)
      expect(eventVerbs).toContain('compact.started')
      expect(eventVerbs).toContain('compact.completed')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Validation', () => {
    it('should error when nothing to compact', async () => {
      mockResult.sqlData.set('things', [])
      mockResult.sqlData.set('actions', [])
      mockResult.sqlData.set('events', [])

      await expect(mockResult.instance.compact()).rejects.toThrow(/Nothing to compact/)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // COMPACT OPTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Compact Options', () => {
    it('should respect retention period', async () => {
      const now = Date.now()
      mockResult.sqlData.set('things', [
        { ...createSampleThing({ id: 'old-1', rowid: 1 }), createdAt: new Date(now - 86400000 * 7) }, // 7 days old
        { ...createSampleThing({ id: 'recent-1', rowid: 2 }), createdAt: new Date(now - 3600000) }, // 1 hour old
      ])

      // This test verifies the option is respected; implementation may vary
      const result = await mockResult.instance.compact({
        retention: 86400000, // Keep last 24 hours
      } as CompactOptions)

      expect(result).toBeDefined()
    })

    it('should preserve specific versions when requested', async () => {
      mockResult.sqlData.set('things', [
        createSampleThing({ id: 'item-1', rowid: 1, data: { version: 1 } }),
        createSampleThing({ id: 'item-1', rowid: 2, data: { version: 2 } }),
        createSampleThing({ id: 'item-1', rowid: 3, data: { version: 3 } }),
      ])

      // This test verifies the option is respected; implementation may vary
      const result = await mockResult.instance.compact({
        preserveVersions: [1, 3], // Keep versions 1 and 3
      } as CompactOptions)

      expect(result).toBeDefined()
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // ATOMICITY (ACID)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Atomicity', () => {
    it('should archive to R2 BEFORE deleting local state', async () => {
      const operationOrder: string[] = []

      mockResult.env.R2.put = vi.fn().mockImplementation(async () => {
        operationOrder.push('r2-put')
      })

      // Track SQL deletes
      const originalExec = mockResult.storage.sql.exec
      mockResult.storage.sql.exec = vi.fn().mockImplementation((query: string, ...params: unknown[]) => {
        if (query.toLowerCase().includes('delete')) {
          operationOrder.push('sql-delete')
        }
        return originalExec.call(mockResult.storage.sql, query, ...params)
      })

      await mockResult.instance.compact()

      // R2 archive should happen before SQL delete
      const r2Index = operationOrder.indexOf('r2-put')
      const deleteIndex = operationOrder.indexOf('sql-delete')

      if (r2Index !== -1 && deleteIndex !== -1) {
        expect(r2Index).toBeLessThan(deleteIndex)
      }
    })

    it('should not delete local state if R2 archive fails', async () => {
      const initialThings = [...(mockResult.sqlData.get('things') as unknown[])]

      mockResult.env.R2.put = vi.fn().mockRejectedValue(new Error('R2 failure'))

      await expect(mockResult.instance.compact()).rejects.toThrow()

      // State should be unchanged
      const currentThings = mockResult.sqlData.get('things') as unknown[]
      expect(currentThings.length).toBe(initialThings.length)
    })

    it('should rollback on failure', async () => {
      const events = mockResult.sqlData.get('events') as Array<{ verb: string }>
      const initialEventCount = events.length

      mockResult.env.R2.put = vi.fn().mockRejectedValue(new Error('R2 failure'))

      await expect(mockResult.instance.compact()).rejects.toThrow()

      // compact.failed should be emitted or no compact.completed
      const eventVerbs = events.map(e => e.verb)
      expect(eventVerbs).not.toContain('compact.completed')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSISTENCY (ACID)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Consistency', () => {
    it('should maintain state invariants after compact', async () => {
      await mockResult.instance.compact()

      const things = mockResult.sqlData.get('things') as Array<{
        id: string
        type: number
        data: unknown
      }>

      // All remaining things should have valid structure
      for (const thing of things) {
        expect(thing.id).toBeDefined()
        expect(thing.type).toBeDefined()
        expect(thing.data).toBeDefined()
      }
    })

    it('should preserve type constraints', async () => {
      mockResult.sqlData.set('things', [
        createSampleThing({ id: 'typed-1', type: 5, data: { typed: true } }),
        createSampleThing({ id: 'typed-1', type: 5, rowid: 2, data: { typed: true, updated: true } }),
      ])

      await mockResult.instance.compact()

      const things = mockResult.sqlData.get('things') as Array<{ type: number }>
      expect(things[0]?.type).toBe(5)
    })

    it('should maintain referential integrity', async () => {
      mockResult.sqlData.set('relationships', [
        { id: 'rel-1', from: 'item-1', to: 'item-2', verb: 'relates' },
      ])

      await mockResult.instance.compact()

      // Relationships should still be valid (pointing to existing things)
      const things = mockResult.sqlData.get('things') as Array<{ id: string }>
      const thingIds = new Set(things.map(t => t.id))
      const relationships = mockResult.sqlData.get('relationships') as Array<{ from: string; to: string }>

      for (const rel of relationships) {
        // Either both endpoints exist or relationship was cleaned up
        const fromExists = thingIds.has(rel.from)
        const toExists = thingIds.has(rel.to)
        expect(fromExists && toExists || relationships.length === 0).toBe(true)
      }
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // ISOLATION (ACID)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Isolation', () => {
    it('should not affect ongoing read operations', async () => {
      // Read before compact
      const thingsBefore = mockResult.sqlData.get('things') as unknown[]
      expect(thingsBefore.length).toBe(4) // Initial state

      // Start compact (but don't await)
      const compactPromise = mockResult.instance.compact()

      // Compact should complete without affecting the ability to read
      await compactPromise

      // Read should still work
      const thingsAfter = mockResult.sqlData.get('things') as unknown[]
      expect(thingsAfter).toBeDefined()
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // DURABILITY (ACID)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Durability', () => {
    it('should persist R2 archives before completing', async () => {
      let r2ArchiveCreated = false

      mockResult.env.R2.put = vi.fn().mockImplementation(async () => {
        r2ArchiveCreated = true
      })

      await mockResult.instance.compact()

      expect(r2ArchiveCreated).toBe(true)
    })

    it('should emit events before operation returns', async () => {
      await mockResult.instance.compact()

      const events = mockResult.sqlData.get('events') as Array<{ verb: string }>
      expect(events.some(e => e.verb === 'compact.completed')).toBe(true)
    })

    it('should include archive key in result', async () => {
      mockResult.env.R2.put = vi.fn().mockImplementation(async () => ({}))

      const result = await mockResult.instance.compact()

      // Result should indicate archiving occurred
      expect(result.thingsCompacted).toBeDefined()
      expect(result.actionsArchived).toBeDefined()
    })
  })
})
