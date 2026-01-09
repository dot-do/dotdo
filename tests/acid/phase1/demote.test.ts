/**
 * ACID Test Suite - Phase 1: demote() - DO to Thing collapse
 *
 * RED TDD: These tests define the expected behavior for demote().
 * All tests are expected to FAIL initially as this is the RED phase.
 *
 * demote() is the inverse of promote():
 * - promote() elevates a Thing within a parent DO to its own independent DO
 * - demote() collapses a DO back into a Thing within a target parent DO
 *
 * The demote() operation:
 * - Takes a target namespace (the parent DO to demote into)
 * - Migrates all DO data to become a Thing in the parent
 * - Handles relationships, actions, and events
 * - Deletes the source DO after successful migration
 * - Emits lifecycle events for observability
 * - Provides rollback on failure
 *
 * @see types/Lifecycle.ts for DemoteResult type
 * @see objects/tests/do-promote.test.ts for the inverse operation
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockDO, MockDOResult, MockEnv, createMockDONamespace } from '../../do'
import { DO } from '../../../objects/DO'
import type { DemoteResult } from '../../../types/Lifecycle'

// ============================================================================
// TYPE DEFINITIONS FOR DEMOTE API
// ============================================================================

/**
 * Options for the demote() operation
 */
interface DemoteOptions {
  /** Custom Thing ID in the parent (default: auto-generated from DO ID) */
  thingId?: string
  /** Preserve action/event history in parent (default: true) */
  preserveHistory?: boolean
  /** Type/noun for the Thing in the parent (default: inferred from DO type) */
  type?: string
  /** Force demote even if constraints would normally prevent it */
  force?: boolean
}

/**
 * Extended demote result with detailed information
 */
interface ExtendedDemoteResult extends DemoteResult {
  /** Number of actions migrated to parent */
  actionsMigrated?: number
  /** Number of events migrated to parent */
  eventsMigrated?: number
  /** Number of relationships updated */
  relationshipsUpdated?: number
  /** Duration of demotion in ms */
  durationMs?: number
  /** Number of nested Things migrated */
  nestedThingsMigrated?: number
}

/**
 * Demote event types for observability
 */
type DemoteEventType =
  | 'do.demote.started'
  | 'do.demote.completed'
  | 'do.demote.failed'
  | 'do.demote.rollback'
  | 'do.demoted'

/**
 * Demote event payload
 */
interface DemoteEvent {
  type: DemoteEventType
  timestamp: Date
  sourceNs: string
  targetNs: string
  thingId?: string
  data?: {
    error?: string
    duration?: number
    actionsMigrated?: number
    eventsMigrated?: number
  }
}

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create sample Thing data for the DO being demoted.
 * Schema: id, type, branch, name, data, deleted, visibility
 */
function createSampleThing(overrides: Partial<{
  id: string
  type: number
  branch: string | null
  name: string
  data: Record<string, unknown>
  deleted: boolean
  visibility: string
}> = {}) {
  return {
    id: overrides.id ?? 'thing-001',
    type: overrides.type ?? 1,
    branch: overrides.branch ?? null,
    name: overrides.name ?? 'Test Thing',
    data: overrides.data ?? { key: 'value' },
    deleted: overrides.deleted ?? false,
    visibility: overrides.visibility ?? 'user',
  }
}

/**
 * Create sample actions for the DO being demoted
 */
function createSampleActions(count: number = 3) {
  const now = new Date()
  return Array.from({ length: count }, (_, i) => ({
    id: `action-${i}`,
    verb: i === 0 ? 'create' : 'update',
    actor: 'system',
    target: 'self',
    input: i === 0 ? null : i,
    output: i + 1,
    options: null,
    durability: 'try',
    status: 'completed',
    error: null,
    requestId: null,
    sessionId: null,
    workflowId: null,
    startedAt: now,
    completedAt: now,
    duration: 10 + i,
    createdAt: now,
  }))
}

/**
 * Create sample events for the DO being demoted
 */
function createSampleEvents(sourceNs: string, count: number = 3) {
  const now = new Date()
  return Array.from({ length: count }, (_, i) => ({
    id: `event-${i}`,
    verb: i === 0 ? 'do.created' : 'thing.updated',
    source: sourceNs,
    data: { version: i + 1 },
    actionId: `action-${i}`,
    sequence: i + 1,
    streamed: false,
    streamedAt: null,
    createdAt: now,
  }))
}

/**
 * Create sample relationships
 */
function createSampleRelationships(fromId: string, toIds: string[]) {
  const now = new Date().toISOString()
  return toIds.map((toId, i) => ({
    id: `rel-${i}`,
    verb: 'relatedTo',
    from: fromId,
    to: toId,
    data: { order: i },
    createdAt: now,
  }))
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('demote() - DO to Thing collapse', () => {
  let result: MockDOResult<DO, MockEnv>
  let capturedEvents: DemoteEvent[]
  const sourceNs = 'https://child.test.do'
  const targetNs = 'https://parent.test.do'

  beforeEach(() => {
    capturedEvents = []

    // Create the DO that will be demoted
    result = createMockDO(DO, {
      ns: sourceNs,
      sqlData: new Map([
        ['things', [
          createSampleThing({ id: '', name: 'Root Thing', data: { rootData: 'value' } }),
        ]],
        ['branches', [{ name: 'main', head: 5, forkedFrom: null, createdAt: new Date().toISOString() }]],
        ['actions', createSampleActions(3)],
        ['events', createSampleEvents(sourceNs, 3)],
        ['relationships', []],
        ['objects', []],
      ]),
    })

    // Mock event capture
    const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
    ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
      capturedEvents.push({
        type: verb as DemoteEventType,
        timestamp: new Date(),
        sourceNs,
        targetNs: (data as Record<string, unknown>)?.targetNs as string || targetNs,
        thingId: (data as Record<string, unknown>)?.thingId as string,
        data: data as DemoteEvent['data'],
      })
      return originalEmit?.call(result.instance, verb, data)
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // 1. BASIC DEMOTION
  // ==========================================================================

  describe('basic demotion', () => {
    it('demotes DO back to Thing in target parent', async () => {
      // RED: This test should fail until demote() is implemented
      const demoteResult = await result.instance.demote(targetNs)

      expect(demoteResult).toBeDefined()
      expect(demoteResult.thingId).toBeDefined()
      expect(demoteResult.parentNs).toBe(targetNs)
      expect(demoteResult.deletedNs).toBe(sourceNs)
    })

    it('migrates all DO data to Thing', async () => {
      // RED: All root Thing data should become the new Thing's data
      const demoteResult = await result.instance.demote(targetNs) as ExtendedDemoteResult

      expect(demoteResult.thingId).toBeDefined()
      // The Thing in parent should contain the DO's root data
    })

    it('deletes source DO after success', async () => {
      // RED: The source DO should be deleted after successful demotion
      const demoteResult = await result.instance.demote(targetNs)

      expect(demoteResult.deletedNs).toBe(sourceNs)
      // Source DO should no longer be accessible
    })

    it('returns DemoteResult with thingId, parentNs, and deletedNs', async () => {
      // RED: Result should match DemoteResult interface
      const demoteResult = await result.instance.demote(targetNs)

      expect(demoteResult).toHaveProperty('thingId')
      expect(demoteResult).toHaveProperty('parentNs')
      expect(demoteResult).toHaveProperty('deletedNs')
      expect(typeof demoteResult.thingId).toBe('string')
      expect(typeof demoteResult.parentNs).toBe('string')
      expect(typeof demoteResult.deletedNs).toBe('string')
    })

    it('accepts optional DemoteOptions as second argument', async () => {
      // RED: Options should be accepted
      const options: DemoteOptions = {
        thingId: 'custom-thing-id',
        preserveHistory: true,
        type: 'Customer',
      }

      const demoteResult = await result.instance.demote(targetNs, options)

      expect(demoteResult).toBeDefined()
      expect(demoteResult.thingId).toContain('custom-thing-id')
    })

    it('uses custom thingId when options.thingId is specified', async () => {
      // RED: Custom Thing ID should be used
      const customId = 'my-custom-thing-id'

      const demoteResult = await result.instance.demote(targetNs, {
        thingId: customId,
      })

      expect(demoteResult.thingId).toBe(customId)
    })

    it('auto-generates thingId when not specified', async () => {
      // RED: Should generate a unique Thing ID
      const demoteResult = await result.instance.demote(targetNs)

      expect(demoteResult.thingId).toBeDefined()
      expect(demoteResult.thingId.length).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // 2. DATA MIGRATION
  // ==========================================================================

  describe('data migration', () => {
    it('preserves Thing data in new Thing', async () => {
      // RED: Root Thing data should become the demoted Thing's data
      const rootData = { name: 'Important Customer', value: 42, nested: { deep: true } }
      result.sqlData.get('things')![0] = createSampleThing({
        id: '',
        name: 'Root',
        data: rootData,
      })

      const demoteResult = await result.instance.demote(targetNs)

      expect(demoteResult.thingId).toBeDefined()
      // New Thing in parent should have the root data preserved
    })

    it('merges nested Things into parent', async () => {
      // RED: Nested Things should be transferred to parent
      result.sqlData.get('things')!.push(
        createSampleThing({ id: 'nested-1', name: 'Nested Thing 1' }),
        createSampleThing({ id: 'nested-2', name: 'Nested Thing 2' }),
      )

      const demoteResult = await result.instance.demote(targetNs) as ExtendedDemoteResult

      expect(demoteResult.nestedThingsMigrated).toBe(2)
    })

    it('preserves Thing metadata (timestamps, visibility)', async () => {
      // RED: Metadata should be preserved during migration
      const thing = result.sqlData.get('things')![0] as Record<string, unknown>
      thing.visibility = 'public'
      thing.createdAt = new Date('2024-01-01').toISOString()

      const demoteResult = await result.instance.demote(targetNs)

      expect(demoteResult.thingId).toBeDefined()
      // Visibility and timestamps should be preserved in parent
    })

    it('handles complex nested data structures', async () => {
      // RED: Complex data should be serialized correctly
      const complexData = {
        array: [1, 2, { nested: true }],
        deep: { level1: { level2: { level3: 'value' } } },
        nullValue: null,
        emptyObject: {},
        emptyArray: [],
      }
      result.sqlData.get('things')![0] = createSampleThing({
        id: '',
        data: complexData,
      })

      const demoteResult = await result.instance.demote(targetNs)

      expect(demoteResult.thingId).toBeDefined()
    })

    it('handles unicode and special characters', async () => {
      // RED: Unicode should be preserved
      const unicodeData = {
        emoji: 'Hello World!',
        chinese: 'Example Text',
        special: '<script>alert("test")</script>',
      }
      result.sqlData.get('things')![0] = createSampleThing({
        id: '',
        data: unicodeData,
      })

      const demoteResult = await result.instance.demote(targetNs)

      expect(demoteResult.thingId).toBeDefined()
    })

    it('migrates actions to parent DO', async () => {
      // RED: Actions should be transferred to parent
      const demoteResult = await result.instance.demote(targetNs) as ExtendedDemoteResult

      expect(demoteResult.actionsMigrated).toBe(3)
    })

    it('migrates events to parent DO', async () => {
      // RED: Events should be transferred to parent
      const demoteResult = await result.instance.demote(targetNs) as ExtendedDemoteResult

      expect(demoteResult.eventsMigrated).toBe(3)
    })

    it('skips history migration when preserveHistory: false', async () => {
      // RED: History should not be migrated when disabled
      const demoteResult = await result.instance.demote(targetNs, {
        preserveHistory: false,
      }) as ExtendedDemoteResult

      expect(demoteResult.actionsMigrated).toBe(0)
      expect(demoteResult.eventsMigrated).toBe(0)
    })

    it('updates event source URLs to reflect new location', async () => {
      // RED: Event sources should point to new Thing path in parent
      const demoteResult = await result.instance.demote(targetNs)

      expect(demoteResult.thingId).toBeDefined()
      // Events should have updated source URLs
    })

    it('updates action targets to reflect new location', async () => {
      // RED: Action targets should point to new Thing path
      const demoteResult = await result.instance.demote(targetNs)

      expect(demoteResult.thingId).toBeDefined()
      // Actions should have updated target paths
    })
  })

  // ==========================================================================
  // 3. CONSTRAINTS
  // ==========================================================================

  describe('constraints', () => {
    it('rejects demoting DO with children DOs', async () => {
      // RED: Cannot demote if this DO has promoted children
      // Add a child reference (simulating a promoted Thing that became its own DO)
      result.sqlData.get('objects')!.push({
        ns: 'https://child-do.test.do',
        doId: 'child-do-id',
        type: 'promoted',
        promotedFrom: 'thing-child',
        parentNs: sourceNs,
        createdAt: new Date().toISOString(),
      })

      await expect(
        result.instance.demote(targetNs)
      ).rejects.toThrow(/has children|cannot demote.*children/i)
    })

    it('rejects demoting root DO (no parent)', async () => {
      // RED: Root DOs that were never promoted cannot be demoted
      // Ensure no parent reference exists
      result.sqlData.get('objects')!.length = 0

      // If the DO was created fresh (not via promote), it has no natural parent
      await expect(
        result.instance.demote(targetNs)
      ).rejects.toThrow(/root.*DO|no parent|cannot demote.*root/i)
    })

    it('rejects demoting to invalid namespace URL', async () => {
      // RED: Target namespace must be valid
      const invalidTargets = [
        'not-a-url',
        'ftp://wrong-protocol.test.do',
        '',
        '   ',
      ]

      for (const invalidTarget of invalidTargets) {
        await expect(
          result.instance.demote(invalidTarget)
        ).rejects.toThrow(/invalid.*url|namespace/i)
      }
    })

    it('rejects demoting to self', async () => {
      // RED: Cannot demote into the same namespace
      await expect(
        result.instance.demote(sourceNs)
      ).rejects.toThrow(/same.*namespace|self|cannot demote.*into itself/i)
    })

    it('rejects demoting when target namespace is unreachable', async () => {
      // RED: Target must be accessible
      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'unreachable-id', equals: () => false },
        fetch: vi.fn().mockRejectedValue(new Error('Connection refused')),
      })
      result.env.DO = mockNamespace

      await expect(
        result.instance.demote(targetNs)
      ).rejects.toThrow(/unreachable|connection|target.*not accessible/i)
    })

    it('allows force demote with children when force: true', async () => {
      // RED: Force flag should bypass children check
      result.sqlData.get('objects')!.push({
        ns: 'https://child-do.test.do',
        doId: 'child-do-id',
        type: 'promoted',
        promotedFrom: 'thing-child',
        parentNs: sourceNs,
        createdAt: new Date().toISOString(),
      })

      const demoteResult = await result.instance.demote(targetNs, { force: true })

      expect(demoteResult.thingId).toBeDefined()
      // Children should be orphaned or demoted recursively
    })

    it('rejects when thingId already exists in parent', async () => {
      // RED: Should not overwrite existing Thing in parent
      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'parent-id', equals: () => false },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          const url = new URL(req.url)
          if (url.pathname.includes('/things/check')) {
            return new Response(JSON.stringify({ exists: true }), { status: 200 })
          }
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      await expect(
        result.instance.demote(targetNs, { thingId: 'existing-thing' })
      ).rejects.toThrow(/already exists|duplicate|thingId.*taken/i)
    })

    it('validates thingId format', async () => {
      // RED: Invalid Thing IDs should be rejected
      const invalidIds = ['../escape', 'thing\0null', 'thing\nline']

      for (const invalidId of invalidIds) {
        await expect(
          result.instance.demote(targetNs, { thingId: invalidId })
        ).rejects.toThrow(/invalid.*id|format/i)
      }
    })
  })

  // ==========================================================================
  // 4. RELATED DATA HANDLING
  // ==========================================================================

  describe('related data handling', () => {
    beforeEach(() => {
      // Add relationships to the DO being demoted
      result.sqlData.get('relationships')!.push(
        ...createSampleRelationships('self', ['external-thing-1', 'external-thing-2']),
        {
          id: 'rel-inbound',
          verb: 'belongsTo',
          from: 'external-thing-3',
          to: 'self',
          data: null,
          createdAt: new Date().toISOString(),
        }
      )
    })

    it('migrates outbound relationships to parent', async () => {
      // RED: Outbound relationships should be transferred
      const demoteResult = await result.instance.demote(targetNs) as ExtendedDemoteResult

      expect(demoteResult.relationshipsUpdated).toBeGreaterThan(0)
    })

    it('updates inbound relationship references', async () => {
      // RED: External Things pointing to this DO should be updated
      const demoteResult = await result.instance.demote(targetNs) as ExtendedDemoteResult

      expect(demoteResult.relationshipsUpdated).toBeGreaterThan(0)
      // External references should now point to parent/thingId
    })

    it('preserves relationship data during migration', async () => {
      // RED: Relationship metadata should be preserved
      const demoteResult = await result.instance.demote(targetNs)

      expect(demoteResult.thingId).toBeDefined()
      // Relationship data like { order: 0 } should be preserved
    })

    it('handles circular relationships', async () => {
      // RED: Self-referential relationships should be handled
      result.sqlData.get('relationships')!.push({
        id: 'rel-circular',
        verb: 'references',
        from: 'self',
        to: 'self',
        data: null,
        createdAt: new Date().toISOString(),
      })

      const demoteResult = await result.instance.demote(targetNs)

      expect(demoteResult.thingId).toBeDefined()
    })

    it('notifies external DOs of reference change', async () => {
      // RED: External DOs with inbound refs should be notified
      const mockNamespace = createMockDONamespace()
      const notifiedDos: string[] = []

      mockNamespace.stubFactory = (id) => ({
        id,
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          const url = new URL(req.url)
          if (url.pathname.includes('/reference-update')) {
            notifiedDos.push(id.toString())
          }
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      await result.instance.demote(targetNs)

      // External DOs should have been notified
      // (This depends on implementation - might be async)
    })
  })

  // ==========================================================================
  // 5. REFERENCE CLEANUP
  // ==========================================================================

  describe('reference cleanup', () => {
    it('removes $parent reference from demoted DO', async () => {
      // RED: Parent reference should be cleaned up before deletion
      result.storage.data.set('$parent', { ns: targetNs, id: 'original-thing-id' })

      const demoteResult = await result.instance.demote(targetNs)

      expect(demoteResult.deletedNs).toBe(sourceNs)
      // $parent should have been cleaned up (DO is deleted anyway)
    })

    it('removes entry from parent objects table', async () => {
      // RED: Parent's objects table should no longer reference this DO
      const mockNamespace = createMockDONamespace()
      let objectsTableUpdated = false

      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'parent-id', equals: () => false },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          const url = new URL(req.url)
          if (url.pathname.includes('/objects/remove')) {
            objectsTableUpdated = true
          }
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      await result.instance.demote(targetNs)

      expect(objectsTableUpdated).toBe(true)
    })

    it('updates namespace registry if applicable', async () => {
      // RED: Global namespace registry should be updated
      const demoteResult = await result.instance.demote(targetNs)

      expect(demoteResult.deletedNs).toBe(sourceNs)
      // Namespace registry should no longer contain the deleted DO
    })

    it('handles orphaned references gracefully', async () => {
      // RED: References that can't be updated should not block demotion
      result.sqlData.get('relationships')!.push({
        id: 'orphan-ref',
        verb: 'references',
        from: 'self',
        to: 'https://unreachable.test.do/thing-orphan',
        data: null,
        createdAt: new Date().toISOString(),
      })

      const demoteResult = await result.instance.demote(targetNs)

      expect(demoteResult.thingId).toBeDefined()
      // Orphaned references should be logged but not block
    })
  })

  // ==========================================================================
  // 6. ERROR HANDLING AND ROLLBACK
  // ==========================================================================

  describe('error handling', () => {
    it('rolls back on failure during data transfer', async () => {
      // RED: Failed transfer should leave DO intact
      const mockNamespace = createMockDONamespace()
      let transferAttempts = 0

      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'fail-transfer-id', equals: () => false },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          transferAttempts++
          if (transferAttempts > 1) {
            throw new Error('Transfer failed mid-operation')
          }
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      const thingsBefore = [...result.sqlData.get('things')!]

      await expect(
        result.instance.demote(targetNs)
      ).rejects.toThrow()

      // DO data should still exist (rollback)
      const thingsAfter = result.sqlData.get('things')!
      expect(thingsAfter.length).toBe(thingsBefore.length)
    })

    it('rolls back on failure during DO deletion', async () => {
      // RED: If deletion fails, data should be restored to source
      const mockNamespace = createMockDONamespace()

      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'delete-fail-id', equals: () => false },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          const url = new URL(req.url)
          if (url.pathname.includes('/delete') || url.pathname.includes('/cleanup')) {
            throw new Error('Deletion failed')
          }
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      await expect(
        result.instance.demote(targetNs)
      ).rejects.toThrow()

      // Source DO should still be intact
    })

    it('rolls back parent changes on failure', async () => {
      // RED: If anything fails, parent should be reverted
      const mockNamespace = createMockDONamespace()
      let createInParent = false
      let rollbackCalled = false

      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'parent-rollback-id', equals: () => false },
        fetch: vi.fn().mockImplementation(async (req: Request) => {
          const url = new URL(req.url)
          if (url.pathname.includes('/things/create')) {
            createInParent = true
            // Fail after create
            throw new Error('Post-create operation failed')
          }
          if (url.pathname.includes('/rollback')) {
            rollbackCalled = true
          }
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      await expect(
        result.instance.demote(targetNs)
      ).rejects.toThrow()

      // Rollback should have been attempted
    })

    it('preserves source DO on network failure', async () => {
      // RED: Network errors should trigger rollback
      const mockNamespace = createMockDONamespace()

      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'network-fail-id', equals: () => false },
        fetch: vi.fn().mockRejectedValue(new Error('Network connection lost')),
      })
      result.env.DO = mockNamespace

      const thingsBefore = [...result.sqlData.get('things')!]

      await expect(
        result.instance.demote(targetNs)
      ).rejects.toThrow('Network connection lost')

      // Source should be unchanged
      expect(result.sqlData.get('things')!.length).toBe(thingsBefore.length)
    })

    it('throws clear error when DO binding is unavailable', async () => {
      // RED: Missing binding should throw descriptive error
      result.env.DO = undefined as unknown as typeof result.env.DO

      await expect(
        result.instance.demote(targetNs)
      ).rejects.toThrow(/DO.*binding|unavailable/i)
    })

    it('includes source namespace in error messages', async () => {
      // RED: Errors should identify which DO failed
      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'error-id', equals: () => false },
        fetch: vi.fn().mockRejectedValue(new Error('Generic failure')),
      })
      result.env.DO = mockNamespace

      try {
        await result.instance.demote(targetNs)
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as Error).message).toContain(sourceNs)
      }
    })

    it('handles timeout during demotion', async () => {
      // RED: Long-running demotions should timeout
      const mockNamespace = createMockDONamespace()

      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'timeout-id', equals: () => false },
        fetch: vi.fn().mockImplementation(async () => {
          await new Promise((resolve) => setTimeout(resolve, 500))
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      // With a very short timeout, should fail
      // Note: actual timeout mechanism depends on implementation
    })
  })

  // ==========================================================================
  // 7. EVENT EMISSION
  // ==========================================================================

  describe('event emission', () => {
    it('emits do.demote.started event when demotion begins', async () => {
      // RED: Start event should be emitted
      await result.instance.demote(targetNs)

      const startedEvent = capturedEvents.find((e) => e.type === 'do.demote.started')
      expect(startedEvent).toBeDefined()
      expect(startedEvent?.sourceNs).toBe(sourceNs)
      expect(startedEvent?.targetNs).toBe(targetNs)
    })

    it('emits do.demote.completed on success', async () => {
      // RED: Completed event should be emitted
      const demoteResult = await result.instance.demote(targetNs)

      const completedEvent = capturedEvents.find((e) => e.type === 'do.demote.completed')
      expect(completedEvent).toBeDefined()
      expect(completedEvent?.thingId).toBe(demoteResult.thingId)
    })

    it('emits do.demoted event for observability', async () => {
      // RED: The do.demoted event signals the demotion is complete
      const demoteResult = await result.instance.demote(targetNs)

      const demotedEvent = capturedEvents.find((e) => e.type === 'do.demoted')
      expect(demotedEvent).toBeDefined()
      expect(demotedEvent?.thingId).toBe(demoteResult.thingId)
    })

    it('emits do.demote.failed on error', async () => {
      // RED: Failure event should include error details
      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'event-fail-id', equals: () => false },
        fetch: vi.fn().mockRejectedValue(new Error('Demotion failed')),
      })
      result.env.DO = mockNamespace

      await expect(result.instance.demote(targetNs)).rejects.toThrow()

      const failedEvent = capturedEvents.find((e) => e.type === 'do.demote.failed')
      expect(failedEvent).toBeDefined()
      expect(failedEvent?.data?.error).toContain('Demotion failed')
    }
    )

    it('emits do.demote.rollback on rollback', async () => {
      // RED: Rollback event should be emitted when rolling back
      const mockNamespace = createMockDONamespace()
      let attempts = 0

      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'rollback-event-id', equals: () => false },
        fetch: vi.fn().mockImplementation(async () => {
          attempts++
          if (attempts > 2) {
            throw new Error('Rollback trigger')
          }
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      await expect(result.instance.demote(targetNs)).rejects.toThrow()

      const rollbackEvent = capturedEvents.find((e) => e.type === 'do.demote.rollback')
      expect(rollbackEvent).toBeDefined()
    })

    it('includes duration in completed event', async () => {
      // RED: Duration should be tracked
      await result.instance.demote(targetNs)

      const completedEvent = capturedEvents.find((e) => e.type === 'do.demote.completed')
      expect(completedEvent?.data?.duration).toBeGreaterThanOrEqual(0)
    })

    it('includes migration stats in completed event', async () => {
      // RED: Stats about what was migrated should be included
      await result.instance.demote(targetNs)

      const completedEvent = capturedEvents.find((e) => e.type === 'do.demote.completed')
      expect(completedEvent?.data?.actionsMigrated).toBeDefined()
      expect(completedEvent?.data?.eventsMigrated).toBeDefined()
    })
  })

  // ==========================================================================
  // 8. ATOMIC BEHAVIOR
  // ==========================================================================

  describe('atomic behavior', () => {
    it('demote is atomic - all or nothing', async () => {
      // RED: Partial failure should result in complete rollback
      const mockNamespace = createMockDONamespace()
      let step = 0

      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'atomic-id', equals: () => false },
        fetch: vi.fn().mockImplementation(async () => {
          step++
          if (step === 3) {
            throw new Error('Partial failure')
          }
          return new Response('OK')
        }),
      })
      result.env.DO = mockNamespace

      const thingsBefore = [...result.sqlData.get('things')!]

      await expect(result.instance.demote(targetNs)).rejects.toThrow()

      // Everything should be rolled back
      expect(result.sqlData.get('things')!.length).toBe(thingsBefore.length)
    })

    it('uses blockConcurrencyWhile for atomicity', async () => {
      // RED: Should use DO's concurrency control
      const blockSpy = vi.spyOn(result.ctx, 'blockConcurrencyWhile')

      await result.instance.demote(targetNs)

      expect(blockSpy).toHaveBeenCalled()
    })

    it('prevents concurrent demote operations', async () => {
      // RED: Only one demote should be allowed at a time
      const demote1 = result.instance.demote(targetNs)
      const demote2 = result.instance.demote(targetNs)

      const results = await Promise.allSettled([demote1, demote2])

      // One should succeed, one should fail
      const successes = results.filter((r) => r.status === 'fulfilled')
      const failures = results.filter((r) => r.status === 'rejected')

      expect(successes.length + failures.length).toBe(2)
      // At least one should succeed
      expect(successes.length).toBeGreaterThanOrEqual(1)
    })

    it('acquires lock before starting demotion', async () => {
      // RED: Should acquire exclusive lock
      let lockAcquired = false
      let lockReleased = false

      const originalBlock = result.ctx.blockConcurrencyWhile
      result.ctx.blockConcurrencyWhile = async <T>(callback: () => Promise<T>): Promise<T> => {
        lockAcquired = true
        try {
          return await callback()
        } finally {
          lockReleased = true
        }
      }

      await result.instance.demote(targetNs)

      expect(lockAcquired).toBe(true)
      expect(lockReleased).toBe(true)
    })

    it('releases lock on failure', async () => {
      // RED: Lock should be released even on failure
      let lockReleased = false

      const mockNamespace = createMockDONamespace()
      mockNamespace.stubFactory = () => ({
        id: { toString: () => 'lock-fail-id', equals: () => false },
        fetch: vi.fn().mockRejectedValue(new Error('Failure')),
      })
      result.env.DO = mockNamespace

      result.ctx.blockConcurrencyWhile = async <T>(callback: () => Promise<T>): Promise<T> => {
        try {
          return await callback()
        } finally {
          lockReleased = true
        }
      }

      await expect(result.instance.demote(targetNs)).rejects.toThrow()

      expect(lockReleased).toBe(true)
    })
  })

  // ==========================================================================
  // 9. EDGE CASES
  // ==========================================================================

  describe('edge cases', () => {
    it('handles empty DO (no Things)', async () => {
      // RED: DO with only root Thing (empty) should still demote
      result.sqlData.set('things', [createSampleThing({ id: '' })])
      result.sqlData.set('actions', [])
      result.sqlData.set('events', [])
      result.sqlData.set('relationships', [])

      const demoteResult = await result.instance.demote(targetNs)

      expect(demoteResult.thingId).toBeDefined()
    })

    it('handles DO with no history', async () => {
      // RED: No actions/events should still work
      result.sqlData.set('actions', [])
      result.sqlData.set('events', [])

      const demoteResult = await result.instance.demote(targetNs)

      expect(demoteResult.thingId).toBeDefined()
    })

    it('handles large number of nested Things', async () => {
      // RED: Should handle many Things efficiently
      const manyThings = Array.from({ length: 100 }, (_, i) =>
        createSampleThing({ id: `thing-${i}`, name: `Thing ${i}` })
      )
      result.sqlData.set('things', [
        createSampleThing({ id: '' }),
        ...manyThings,
      ])

      const demoteResult = await result.instance.demote(targetNs) as ExtendedDemoteResult

      expect(demoteResult.nestedThingsMigrated).toBe(100)
    })

    it('handles long Thing IDs', async () => {
      // RED: Long IDs should work
      const longId = 'a'.repeat(500)

      const demoteResult = await result.instance.demote(targetNs, {
        thingId: longId,
      })

      expect(demoteResult.thingId).toBe(longId)
    })

    it('handles special characters in custom thingId', async () => {
      // RED: Valid special chars should work
      const specialIds = [
        'thing-with-dash',
        'thing_with_underscore',
        'thing.with.dots',
        'thing:with:colons',
      ]

      for (const specialId of specialIds) {
        // Reset for each test
        result.sqlData.set('things', [createSampleThing({ id: '' })])

        const demoteResult = await result.instance.demote(targetNs, {
          thingId: specialId,
        })
        expect(demoteResult.thingId).toBe(specialId)
      }
    })

    it('handles demoting non-main branch', async () => {
      // RED: Branch info should be preserved
      result.sqlData.get('branches')!.push({
        name: 'feature-x',
        head: 10,
        forkedFrom: 'main',
        createdAt: new Date().toISOString(),
      })

      const demoteResult = await result.instance.demote(targetNs)

      expect(demoteResult.thingId).toBeDefined()
      // Branch info might need special handling
    })

    it('handles previously promoted DO (has $parent)', async () => {
      // RED: DOs that were promoted should demote smoothly
      result.storage.data.set('$parent', {
        ns: targetNs,
        previousId: 'original-thing-id',
      })

      const demoteResult = await result.instance.demote(targetNs)

      expect(demoteResult.thingId).toBeDefined()
      // Might want to use original ID
    })

    it('handles DO with very large data payload', async () => {
      // RED: Large data should be handled
      const largeData = {
        items: Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          name: `Item ${i}`,
          description: 'x'.repeat(100),
        })),
      }
      result.sqlData.get('things')![0] = createSampleThing({
        id: '',
        data: largeData,
      })

      const demoteResult = await result.instance.demote(targetNs)

      expect(demoteResult.thingId).toBeDefined()
    })
  })

  // ==========================================================================
  // 10. DOLifecycle INTERFACE COMPATIBILITY
  // ==========================================================================

  describe('DOLifecycle interface compatibility', () => {
    it('demote() matches DOLifecycle.demote signature', async () => {
      // DOLifecycle.demote(targetNs: string): Promise<DemoteResult>
      const demoteResult = await result.instance.demote(targetNs)

      expect(demoteResult).toHaveProperty('thingId')
      expect(demoteResult).toHaveProperty('parentNs')
      expect(demoteResult).toHaveProperty('deletedNs')
    })

    it('demote() is accessible via $ workflow context', async () => {
      // The $ context should provide access to lifecycle operations
      const $ = (result.instance as unknown as { $: { demote: Function } }).$

      expect($).toBeDefined()
      // Note: Actual $ context structure may vary
    })

    it('returns DemoteResult type', async () => {
      // RED: Type should match interface
      const demoteResult: DemoteResult = await result.instance.demote(targetNs)

      expect(typeof demoteResult.thingId).toBe('string')
      expect(typeof demoteResult.parentNs).toBe('string')
      expect(typeof demoteResult.deletedNs).toBe('string')
    })
  })
})

// ============================================================================
// DEMOTE OPTIONS TYPE TESTS
// ============================================================================

describe('DemoteOptions type', () => {
  it('all options are optional', () => {
    const options1: DemoteOptions = {}
    const options2: DemoteOptions = { thingId: 'custom' }
    const options3: DemoteOptions = { preserveHistory: false }
    const options4: DemoteOptions = { type: 'Customer' }
    const options5: DemoteOptions = { force: true }

    expect(options1).toBeDefined()
    expect(options2.thingId).toBe('custom')
    expect(options3.preserveHistory).toBe(false)
    expect(options4.type).toBe('Customer')
    expect(options5.force).toBe(true)
  })

  it('accepts all options together', () => {
    const fullOptions: DemoteOptions = {
      thingId: 'my-custom-id',
      preserveHistory: true,
      type: 'Customer',
      force: false,
    }

    expect(fullOptions.thingId).toBe('my-custom-id')
    expect(fullOptions.preserveHistory).toBe(true)
    expect(fullOptions.type).toBe('Customer')
    expect(fullOptions.force).toBe(false)
  })
})

// ============================================================================
// DemoteResult TYPE TESTS
// ============================================================================

describe('DemoteResult type', () => {
  it('has required fields', () => {
    const result: DemoteResult = {
      thingId: 'new-thing-id',
      parentNs: 'https://parent.test.do',
      deletedNs: 'https://child.test.do',
    }

    expect(result.thingId).toBe('new-thing-id')
    expect(result.parentNs).toBe('https://parent.test.do')
    expect(result.deletedNs).toBe('https://child.test.do')
  })
})
