/**
 * ACID Test Suite - Phase 1: merge() - Merge Branches Operation
 *
 * RED TDD: These tests define the expected behavior for merge() operation.
 * All tests are expected to FAIL initially as this is the RED phase.
 *
 * The merge() operation merges a source branch into the current branch:
 * - Finds common ancestor (base) for 3-way merge
 * - Applies non-conflicting changes automatically
 * - Detects field-level conflicts when both branches modify same field
 * - Handles things only on source (adds to target)
 * - Handles deleted things appropriately
 * - Cannot merge into detached HEAD state
 * - Cannot merge branch into itself
 * - Emits lifecycle events (merge.started, merge.completed, merge.conflict)
 *
 * @see objects/lifecycle/Branch.ts for implementation reference
 * @see objects/tests/do-lifecycle.test.ts for basic tests
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockDO, MockDOResult, MockEnv } from '../../harness/do'
import { DO } from '../../../objects/DO'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface MergeOptions {
  /** Source branch to merge from */
  source: string
  /** Optional: Strategy for conflict resolution */
  strategy?: 'ours' | 'theirs' | 'manual'
  /** Optional: Commit message for the merge */
  message?: string
}

interface MergeConflict {
  /** Thing ID with conflict */
  thingId: string
  /** Field name with conflict */
  field: string
  /** Value on current branch (ours) */
  ours: unknown
  /** Value on source branch (theirs) */
  theirs: unknown
  /** Value at common ancestor (base) */
  base: unknown
}

interface MergeResult {
  /** Whether merge completed successfully */
  success: boolean
  /** Number of things merged */
  mergedCount: number
  /** Conflicts detected (empty if none) */
  conflicts: MergeConflict[]
  /** Common ancestor version used for 3-way merge */
  baseVersion?: number
}

interface BranchRecord {
  name: string
  thingId: string
  head: number
  base: number | null
  forkedFrom: string | null
  description: string | null
  createdAt: Date
  updatedAt: Date
}

type MergeEventType =
  | 'merge.started'
  | 'merge.completed'
  | 'merge.conflict'
  | 'merge.failed'

interface MergeEvent {
  type: MergeEventType
  timestamp: Date
  data: {
    source?: string
    target?: string
    mergedCount?: number
    conflictCount?: number
    conflicts?: MergeConflict[]
    error?: string
  }
}

// ============================================================================
// TEST HELPERS
// ============================================================================

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

function createBranchRecord(overrides: Partial<BranchRecord> = {}): BranchRecord {
  return {
    name: overrides.name ?? 'main',
    thingId: overrides.thingId ?? 'thing-001',
    head: overrides.head ?? 1,
    base: overrides.base ?? null,
    forkedFrom: overrides.forkedFrom ?? null,
    description: overrides.description ?? null,
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date(),
  }
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('merge() - Merge Branches Operation', () => {
  let result: MockDOResult<DO, MockEnv>
  let capturedEvents: MergeEvent[]
  const sourceNs = 'https://source.test.do'

  beforeEach(() => {
    capturedEvents = []

    // Setup: Main branch with base state, feature branch forked from main
    // Common ancestor: rowid 3
    // Main has changes: rowid 4, 5
    // Feature has changes: rowid 6, 7
    result = createMockDO(DO, {
      ns: sourceNs,
      sqlData: new Map([
        ['things', [
          // Base state (common ancestor) - on main, rowid 1-3
          createSampleThing({
            id: 'shared-thing',
            name: 'Shared Thing',
            branch: null,
            data: { version: 'base', field1: 'original', field2: 'original' },
            rowid: 1,
          }),
          createSampleThing({
            id: 'main-only',
            name: 'Main Only Thing',
            branch: null,
            data: { source: 'main' },
            rowid: 2,
          }),
          createSampleThing({
            id: 'will-conflict',
            name: 'Conflict Thing',
            branch: null,
            data: { field: 'base-value', stable: 'unchanged' },
            rowid: 3,
          }),
          // Main branch changes after fork (rowid 4-5)
          createSampleThing({
            id: 'shared-thing',
            name: 'Shared Thing Updated on Main',
            branch: null,
            data: { version: 'main', field1: 'main-change', field2: 'original' },
            rowid: 4,
          }),
          createSampleThing({
            id: 'will-conflict',
            name: 'Conflict Thing',
            branch: null,
            data: { field: 'main-value', stable: 'unchanged' },
            rowid: 5,
          }),
          // Feature branch changes (rowid 6-8)
          createSampleThing({
            id: 'shared-thing',
            name: 'Shared Thing Updated on Feature',
            branch: 'feature',
            data: { version: 'feature', field1: 'original', field2: 'feature-change' },
            rowid: 6,
          }),
          createSampleThing({
            id: 'feature-only',
            name: 'Feature Only Thing',
            branch: 'feature',
            data: { source: 'feature' },
            rowid: 7,
          }),
          createSampleThing({
            id: 'will-conflict',
            name: 'Conflict Thing',
            branch: 'feature',
            data: { field: 'feature-value', stable: 'unchanged' },
            rowid: 8,
          }),
        ]],
        ['branches', [
          createBranchRecord({ name: 'main', head: 5, base: null, forkedFrom: null }),
          createBranchRecord({ name: 'feature', head: 8, base: 3, forkedFrom: 'main' }),
        ]],
        ['actions', []],
        ['events', []],
        ['objects', []],
      ]),
    })

    // Mock event capture
    const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
    ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
      capturedEvents.push({
        type: verb as MergeEventType,
        timestamp: new Date(),
        data: data as MergeEvent['data'],
      })
      return originalEmit?.call(result.instance, verb, data)
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // BASIC MERGE FUNCTIONALITY
  // ==========================================================================

  describe('basic functionality', () => {
    it('applies source changes to target branch', async () => {
      // RED: Merge should bring feature branch changes into main
      const mergeResult = await result.instance.merge({ source: 'feature' })

      expect(mergeResult).toBeDefined()
      expect(mergeResult.success).toBe(true)
      expect(mergeResult.mergedCount).toBeGreaterThan(0)
    })

    it('adds things only on source to target', async () => {
      // RED: feature-only thing should be added to main after merge
      const mergeResult = await result.instance.merge({ source: 'feature' })

      // Verify feature-only thing is now on main
      const things = result.sqlData.get('things')!
      const featureOnlyOnMain = things.find(
        (t: unknown) => (t as { id: string; branch: string | null }).id === 'feature-only' &&
                        (t as { branch: string | null }).branch === null
      )

      expect(featureOnlyOnMain).toBeDefined()
    })

    it('finds common ancestor correctly', async () => {
      // RED: Merge should use correct base version for 3-way merge
      const mergeResult = await result.instance.merge({ source: 'feature' })

      expect(mergeResult.baseVersion).toBe(3) // Fork point
    })

    it('preserves things unchanged on both branches', async () => {
      // RED: main-only thing should remain unchanged
      const mergeResult = await result.instance.merge({ source: 'feature' })

      const things = result.sqlData.get('things')!
      const mainOnlyThing = things.find(
        (t: unknown) => (t as { id: string }).id === 'main-only'
      )

      expect(mainOnlyThing).toBeDefined()
      expect((mainOnlyThing as { data: { source: string } }).data.source).toBe('main')
    })
  })

  // ==========================================================================
  // CONFLICT DETECTION
  // ==========================================================================

  describe('conflict detection', () => {
    it('detects field-level conflicts', async () => {
      // RED: will-conflict thing has different values on both branches
      const mergeResult = await result.instance.merge({ source: 'feature' })

      expect(mergeResult.conflicts).toBeDefined()
      expect(mergeResult.conflicts.length).toBeGreaterThan(0)

      const conflict = mergeResult.conflicts.find(c => c.thingId === 'will-conflict')
      expect(conflict).toBeDefined()
      expect(conflict?.field).toBe('field')
    })

    it('includes base, ours, and theirs values in conflict', async () => {
      // RED: Conflict should contain all three values for resolution
      const mergeResult = await result.instance.merge({ source: 'feature' })

      const conflict = mergeResult.conflicts.find(c => c.thingId === 'will-conflict')
      expect(conflict).toBeDefined()
      expect(conflict?.base).toBe('base-value')
      expect(conflict?.ours).toBe('main-value')
      expect(conflict?.theirs).toBe('feature-value')
    })

    it('does not flag unchanged fields as conflicts', async () => {
      // RED: 'stable' field was not changed, should not conflict
      const mergeResult = await result.instance.merge({ source: 'feature' })

      const stableConflict = mergeResult.conflicts.find(
        c => c.thingId === 'will-conflict' && c.field === 'stable'
      )
      expect(stableConflict).toBeUndefined()
    })

    it('returns empty conflicts array when no conflicts', async () => {
      // RED: Clean merge should have empty conflicts array
      // Setup: Remove conflicting data
      const things = result.sqlData.get('things')!
      const filteredThings = things.filter(
        (t: unknown) => (t as { id: string }).id !== 'will-conflict'
      )
      result.sqlData.set('things', filteredThings)

      const mergeResult = await result.instance.merge({ source: 'feature' })

      expect(mergeResult.success).toBe(true)
      expect(mergeResult.conflicts).toEqual([])
    })
  })

  // ==========================================================================
  // AUTO-MERGE NON-CONFLICTING CHANGES (3-WAY MERGE)
  // ==========================================================================

  describe('3-way merge auto-resolution', () => {
    it('auto-merges when only one side changed a field', async () => {
      // RED: shared-thing has field1 changed on main, field2 changed on feature
      // Both should be auto-merged since they don't conflict
      const mergeResult = await result.instance.merge({ source: 'feature' })

      // Should not have conflict for shared-thing (different fields changed)
      const sharedConflict = mergeResult.conflicts.find(c => c.thingId === 'shared-thing')
      expect(sharedConflict).toBeUndefined()
    })

    it('combines non-conflicting changes from both branches', async () => {
      // RED: After merge, shared-thing should have changes from both branches
      const mergeResult = await result.instance.merge({ source: 'feature' })

      expect(mergeResult.success).toBe(true)

      // Verify merged state has both changes
      const things = result.sqlData.get('things')!
      const latestSharedThing = things
        .filter((t: unknown) =>
          (t as { id: string; branch: string | null }).id === 'shared-thing' &&
          (t as { branch: string | null }).branch === null
        )
        .sort((a: unknown, b: unknown) =>
          (b as { rowid: number }).rowid - (a as { rowid: number }).rowid
        )[0] as { data: { field1: string; field2: string } }

      expect(latestSharedThing.data.field1).toBe('main-change')
      expect(latestSharedThing.data.field2).toBe('feature-change')
    })

    it('uses source value when only source changed a field', async () => {
      // RED: If only feature changed a field and main didn't, use feature's value
      // Setup: Create thing only changed on feature
      result.sqlData.get('things')!.push(
        createSampleThing({
          id: 'feature-change-only',
          name: 'Feature Change Only',
          branch: null,
          data: { field: 'base' },
          rowid: 9,
        }),
        createSampleThing({
          id: 'feature-change-only',
          name: 'Feature Change Only',
          branch: 'feature',
          data: { field: 'feature-updated' },
          rowid: 10,
        })
      )

      const mergeResult = await result.instance.merge({ source: 'feature' })

      // Should auto-merge without conflict
      const conflict = mergeResult.conflicts.find(c => c.thingId === 'feature-change-only')
      expect(conflict).toBeUndefined()
    })
  })

  // ==========================================================================
  // DETACHED HEAD PREVENTION
  // ==========================================================================

  describe('detached HEAD prevention', () => {
    it('cannot merge into detached HEAD state', async () => {
      // RED: Merge requires being on a branch
      // Simulate detached HEAD (checkout a specific version)
      await result.instance.checkout('@v3')

      await expect(
        result.instance.merge({ source: 'feature' })
      ).rejects.toThrow(/detached.*head|not.*on.*branch/i)
    })

    it('throws descriptive error for detached HEAD merge attempt', async () => {
      // RED: Error message should explain the issue
      await result.instance.checkout('@v3')

      try {
        await result.instance.merge({ source: 'feature' })
        expect.fail('Should have thrown')
      } catch (error) {
        expect((error as Error).message).toMatch(/cannot.*merge.*detached|checkout.*branch.*first/i)
      }
    })
  })

  // ==========================================================================
  // SELF-MERGE PREVENTION
  // ==========================================================================

  describe('self-merge prevention', () => {
    it('cannot merge branch into itself', async () => {
      // RED: Merging main into main should throw
      await expect(
        result.instance.merge({ source: 'main' })
      ).rejects.toThrow(/cannot.*merge.*itself|same.*branch/i)
    })

    it('throws error when source equals current branch', async () => {
      // RED: Checkout feature, try to merge feature
      await result.instance.checkout('feature')

      await expect(
        result.instance.merge({ source: 'feature' })
      ).rejects.toThrow(/cannot.*merge.*itself|same.*branch/i)
    })
  })

  // ==========================================================================
  // DELETED THINGS HANDLING
  // ==========================================================================

  describe('deleted things handling', () => {
    it('handles thing deleted on source branch', async () => {
      // RED: If thing is deleted on feature, should be deleted on main after merge
      result.sqlData.get('things')!.push(
        createSampleThing({
          id: 'deleted-on-feature',
          name: 'Will be deleted',
          branch: null,
          data: { status: 'exists' },
          rowid: 11,
        }),
        createSampleThing({
          id: 'deleted-on-feature',
          name: 'Will be deleted',
          branch: 'feature',
          deleted: true,
          data: { status: 'deleted' },
          rowid: 12,
        })
      )

      const mergeResult = await result.instance.merge({ source: 'feature' })

      expect(mergeResult.success).toBe(true)

      // Thing should be marked as deleted on main
      const things = result.sqlData.get('things')!
      const deletedThing = things.find(
        (t: unknown) =>
          (t as { id: string; branch: string | null }).id === 'deleted-on-feature' &&
          (t as { branch: string | null }).branch === null &&
          (t as { deleted: boolean }).deleted === true
      )
      expect(deletedThing).toBeDefined()
    })

    it('handles thing deleted on target but modified on source', async () => {
      // RED: This should create a conflict (delete vs modify)
      result.sqlData.get('things')!.push(
        createSampleThing({
          id: 'delete-modify-conflict',
          name: 'Base version',
          branch: null,
          data: { content: 'base' },
          rowid: 13,
        }),
        // Deleted on main
        createSampleThing({
          id: 'delete-modify-conflict',
          name: 'Deleted on main',
          branch: null,
          deleted: true,
          data: { content: 'deleted' },
          rowid: 14,
        }),
        // Modified on feature
        createSampleThing({
          id: 'delete-modify-conflict',
          name: 'Modified on feature',
          branch: 'feature',
          data: { content: 'modified' },
          rowid: 15,
        })
      )

      const mergeResult = await result.instance.merge({ source: 'feature' })

      // Should have a delete/modify conflict
      const conflict = mergeResult.conflicts.find(c => c.thingId === 'delete-modify-conflict')
      expect(conflict).toBeDefined()
    })

    it('skips things deleted on both branches', async () => {
      // RED: No conflict if deleted on both
      result.sqlData.get('things')!.push(
        createSampleThing({
          id: 'deleted-both',
          name: 'Deleted on both',
          branch: null,
          data: {},
          rowid: 16,
        }),
        createSampleThing({
          id: 'deleted-both',
          branch: null,
          deleted: true,
          data: {},
          rowid: 17,
        }),
        createSampleThing({
          id: 'deleted-both',
          branch: 'feature',
          deleted: true,
          data: {},
          rowid: 18,
        })
      )

      const mergeResult = await result.instance.merge({ source: 'feature' })

      // No conflict for deleted-both
      const conflict = mergeResult.conflicts.find(c => c.thingId === 'deleted-both')
      expect(conflict).toBeUndefined()
    })
  })

  // ==========================================================================
  // LIFECYCLE EVENTS
  // ==========================================================================

  describe('lifecycle events', () => {
    it('emits merge.started event', async () => {
      // RED: Should emit start event before merge begins
      await result.instance.merge({ source: 'feature' })

      const startEvent = capturedEvents.find(e => e.type === 'merge.started')
      expect(startEvent).toBeDefined()
      expect(startEvent?.data.source).toBe('feature')
      expect(startEvent?.data.target).toBe('main')
    })

    it('emits merge.completed event on success', async () => {
      // RED: Should emit completion event with merge details
      // Setup: Remove conflicts for clean merge
      const things = result.sqlData.get('things')!
      const filteredThings = things.filter(
        (t: unknown) => (t as { id: string }).id !== 'will-conflict'
      )
      result.sqlData.set('things', filteredThings)

      await result.instance.merge({ source: 'feature' })

      const completedEvent = capturedEvents.find(e => e.type === 'merge.completed')
      expect(completedEvent).toBeDefined()
      expect(completedEvent?.data.mergedCount).toBeGreaterThan(0)
    })

    it('emits merge.conflict event when conflicts detected', async () => {
      // RED: Should emit conflict event with conflict details
      await result.instance.merge({ source: 'feature' })

      const conflictEvent = capturedEvents.find(e => e.type === 'merge.conflict')
      expect(conflictEvent).toBeDefined()
      expect(conflictEvent?.data.conflictCount).toBeGreaterThan(0)
      expect(conflictEvent?.data.conflicts).toBeDefined()
    })

    it('includes conflict details in conflict event', async () => {
      // RED: Conflict event should contain full conflict information
      await result.instance.merge({ source: 'feature' })

      const conflictEvent = capturedEvents.find(e => e.type === 'merge.conflict')
      expect(conflictEvent?.data.conflicts).toBeDefined()
      expect(Array.isArray(conflictEvent?.data.conflicts)).toBe(true)

      const conflict = conflictEvent?.data.conflicts?.find(c => c.thingId === 'will-conflict')
      expect(conflict).toBeDefined()
    })
  })

  // ==========================================================================
  // VALIDATION
  // ==========================================================================

  describe('validation', () => {
    it('throws error for non-existent source branch', async () => {
      // RED: Should throw when source branch doesn't exist
      await expect(
        result.instance.merge({ source: 'non-existent' })
      ).rejects.toThrow(/branch.*not.*found|branch.*not.*exist/i)
    })

    it('throws error for empty source branch name', async () => {
      // RED: Empty source should be rejected
      await expect(
        result.instance.merge({ source: '' })
      ).rejects.toThrow(/empty|required/i)
    })

    it('throws error when source branch has no commits', async () => {
      // RED: Cannot merge empty branch
      result.sqlData.get('branches')!.push(
        createBranchRecord({ name: 'empty-branch', head: 0, forkedFrom: 'main' })
      )

      await expect(
        result.instance.merge({ source: 'empty-branch' })
      ).rejects.toThrow(/no.*commits|empty.*branch/i)
    })
  })

  // ==========================================================================
  // ACID PROPERTIES
  // ==========================================================================

  describe('ACID properties', () => {
    it('is atomic - merge completes fully or not at all', async () => {
      // RED: Failed merge should not change state
      const thingsCountBefore = result.sqlData.get('things')!.length

      await expect(
        result.instance.merge({ source: 'non-existent' })
      ).rejects.toThrow()

      const thingsCountAfter = result.sqlData.get('things')!.length
      expect(thingsCountAfter).toBe(thingsCountBefore)
    })

    it('maintains consistency - state is valid after merge', async () => {
      // RED: After merge, branch state should be consistent
      // Remove conflicts for clean merge
      const things = result.sqlData.get('things')!
      const filteredThings = things.filter(
        (t: unknown) => (t as { id: string }).id !== 'will-conflict'
      )
      result.sqlData.set('things', filteredThings)

      const mergeResult = await result.instance.merge({ source: 'feature' })

      expect(mergeResult.success).toBe(true)

      // Verify branch head was updated
      const branches = result.sqlData.get('branches')!
      const mainBranch = branches.find((b: unknown) => (b as { name: string }).name === 'main')
      expect((mainBranch as { head: number }).head).toBeGreaterThan(5)
    })

    it('provides isolation - merge does not affect other branches', async () => {
      // RED: Merging feature into main should not affect feature branch
      const featureHeadBefore = (
        result.sqlData.get('branches')!.find(
          (b: unknown) => (b as { name: string }).name === 'feature'
        ) as { head: number }
      ).head

      await result.instance.merge({ source: 'feature' })

      const featureHeadAfter = (
        result.sqlData.get('branches')!.find(
          (b: unknown) => (b as { name: string }).name === 'feature'
        ) as { head: number }
      ).head

      expect(featureHeadAfter).toBe(featureHeadBefore)
    })

    it('ensures durability - merge changes persist', async () => {
      // RED: Merged changes should be in storage
      // Remove conflicts for clean merge
      const things = result.sqlData.get('things')!
      const filteredThings = things.filter(
        (t: unknown) => (t as { id: string }).id !== 'will-conflict'
      )
      result.sqlData.set('things', filteredThings)

      await result.instance.merge({ source: 'feature' })

      // Verify feature-only thing is in storage
      const storedThings = result.sqlData.get('things')!
      const featureOnlyOnMain = storedThings.find(
        (t: unknown) =>
          (t as { id: string; branch: string | null }).id === 'feature-only' &&
          (t as { branch: string | null }).branch === null
      )
      expect(featureOnlyOnMain).toBeDefined()
    })
  })

  // ==========================================================================
  // MERGE STRATEGIES
  // ==========================================================================

  describe('merge strategies', () => {
    it('supports "ours" strategy to prefer target values on conflict', async () => {
      // RED: With 'ours' strategy, conflicts should use target branch values
      const mergeResult = await result.instance.merge({
        source: 'feature',
        strategy: 'ours',
      })

      // Should have no conflicts (auto-resolved with ours)
      expect(mergeResult.conflicts).toEqual([])
      expect(mergeResult.success).toBe(true)

      // Verify 'ours' value was used
      const things = result.sqlData.get('things')!
      const conflictThing = things
        .filter((t: unknown) =>
          (t as { id: string; branch: string | null }).id === 'will-conflict' &&
          (t as { branch: string | null }).branch === null
        )
        .sort((a: unknown, b: unknown) =>
          (b as { rowid: number }).rowid - (a as { rowid: number }).rowid
        )[0] as { data: { field: string } }

      expect(conflictThing.data.field).toBe('main-value') // ours
    })

    it('supports "theirs" strategy to prefer source values on conflict', async () => {
      // RED: With 'theirs' strategy, conflicts should use source branch values
      const mergeResult = await result.instance.merge({
        source: 'feature',
        strategy: 'theirs',
      })

      expect(mergeResult.conflicts).toEqual([])
      expect(mergeResult.success).toBe(true)

      // Verify 'theirs' value was used
      const things = result.sqlData.get('things')!
      const conflictThing = things
        .filter((t: unknown) =>
          (t as { id: string; branch: string | null }).id === 'will-conflict' &&
          (t as { branch: string | null }).branch === null
        )
        .sort((a: unknown, b: unknown) =>
          (b as { rowid: number }).rowid - (a as { rowid: number }).rowid
        )[0] as { data: { field: string } }

      expect(conflictThing.data.field).toBe('feature-value') // theirs
    })

    it('uses "manual" strategy by default to report conflicts', async () => {
      // RED: Default strategy should report conflicts without auto-resolution
      const mergeResult = await result.instance.merge({ source: 'feature' })

      expect(mergeResult.conflicts.length).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('edge cases', () => {
    it('handles merge with no changes on source', async () => {
      // RED: Merge should succeed even if source has no new changes
      // Create a branch with same content as main
      result.sqlData.get('branches')!.push(
        createBranchRecord({ name: 'no-changes', head: 5, base: 5, forkedFrom: 'main' })
      )

      const mergeResult = await result.instance.merge({ source: 'no-changes' })

      expect(mergeResult.success).toBe(true)
      expect(mergeResult.mergedCount).toBe(0)
    })

    it('handles deep nested data conflicts', async () => {
      // RED: Should detect conflicts in nested object fields
      result.sqlData.get('things')!.push(
        createSampleThing({
          id: 'nested-conflict',
          branch: null,
          data: { nested: { deep: { field: 'base' } } },
          rowid: 19,
        }),
        createSampleThing({
          id: 'nested-conflict',
          branch: null,
          data: { nested: { deep: { field: 'main' } } },
          rowid: 20,
        }),
        createSampleThing({
          id: 'nested-conflict',
          branch: 'feature',
          data: { nested: { deep: { field: 'feature' } } },
          rowid: 21,
        })
      )

      const mergeResult = await result.instance.merge({ source: 'feature' })

      const conflict = mergeResult.conflicts.find(c => c.thingId === 'nested-conflict')
      expect(conflict).toBeDefined()
    })

    it('handles array field merging', async () => {
      // RED: Should handle arrays appropriately
      result.sqlData.get('things')!.push(
        createSampleThing({
          id: 'array-thing',
          branch: null,
          data: { items: ['a', 'b'] },
          rowid: 22,
        }),
        createSampleThing({
          id: 'array-thing',
          branch: null,
          data: { items: ['a', 'b', 'c'] },
          rowid: 23,
        }),
        createSampleThing({
          id: 'array-thing',
          branch: 'feature',
          data: { items: ['a', 'b', 'd'] },
          rowid: 24,
        })
      )

      const mergeResult = await result.instance.merge({ source: 'feature' })

      // Arrays with different additions should conflict
      const conflict = mergeResult.conflicts.find(c => c.thingId === 'array-thing')
      expect(conflict).toBeDefined()
    })

    it('handles rapid sequential merges', async () => {
      // RED: Multiple sequential merges should work correctly
      // Create multiple branches
      result.sqlData.get('branches')!.push(
        createBranchRecord({ name: 'branch-a', head: 5, base: 3, forkedFrom: 'main' }),
        createBranchRecord({ name: 'branch-b', head: 5, base: 3, forkedFrom: 'main' })
      )
      result.sqlData.get('things')!.push(
        createSampleThing({
          id: 'branch-a-thing',
          branch: 'branch-a',
          data: { from: 'a' },
          rowid: 25,
        }),
        createSampleThing({
          id: 'branch-b-thing',
          branch: 'branch-b',
          data: { from: 'b' },
          rowid: 26,
        })
      )

      // Merge both branches
      const mergeA = await result.instance.merge({ source: 'branch-a' })
      const mergeB = await result.instance.merge({ source: 'branch-b' })

      expect(mergeA.success).toBe(true)
      expect(mergeB.success).toBe(true)

      // Both things should be on main
      const things = result.sqlData.get('things')!
      const aThing = things.find(
        (t: unknown) =>
          (t as { id: string; branch: string | null }).id === 'branch-a-thing' &&
          (t as { branch: string | null }).branch === null
      )
      const bThing = things.find(
        (t: unknown) =>
          (t as { id: string; branch: string | null }).id === 'branch-b-thing' &&
          (t as { branch: string | null }).branch === null
      )

      expect(aThing).toBeDefined()
      expect(bThing).toBeDefined()
    })

    it('includes merge message in merge commit', async () => {
      // RED: Custom message should be included in merge record
      // Remove conflicts for clean merge
      const things = result.sqlData.get('things')!
      const filteredThings = things.filter(
        (t: unknown) => (t as { id: string }).id !== 'will-conflict'
      )
      result.sqlData.set('things', filteredThings)

      const message = 'Merge feature branch: implement new UI'
      await result.instance.merge({ source: 'feature', message })

      // Verify message is stored (implementation dependent)
      // This could be in events, actions, or a merge record
      const completedEvent = capturedEvents.find(e => e.type === 'merge.completed')
      expect(completedEvent).toBeDefined()
    })
  })
})
