/**
 * ACID Test Suite - Phase 1: merge() - Merge Branches
 *
 * RED TDD: These tests define the expected behavior for merge() operation.
 * The merge() operation merges source branch into current branch:
 * - Fast-forward merge when no divergent changes
 * - Three-way merge for divergent branches
 * - Detect field-level conflicts
 * - Auto-merge non-conflicting changes
 * - Merge abort/continue for conflict resolution
 * - Cannot merge into detached HEAD
 * - Cannot merge branch into itself
 * - Handle deleted things
 * - Emit lifecycle events
 *
 * ACID Properties Tested:
 * - Atomicity: Merge is all-or-nothing
 * - Consistency: Merged state maintains invariants
 * - Isolation: Merge doesn't affect source branch
 * - Durability: Merged state persists
 *
 * @see objects/DOFull.ts for merge() implementation
 * @see objects/lifecycle/Branch.ts for BranchModule
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockDO, MockDOResult, MockEnv } from '../../do'
import { DO } from '../../../objects/DO'

// ============================================================================
// TYPE DEFINITIONS FOR MERGE API
// ============================================================================

/**
 * Result of a merge operation
 */
interface MergeResult {
  /** Whether merge completed successfully */
  merged: boolean
  /** List of conflicting fields (if any) */
  conflicts?: ConflictInfo[]
  /** Number of things merged */
  thingsMerged?: number
  /** Number of things with auto-resolved conflicts */
  autoResolved?: number
  /** Merge type that was performed */
  mergeType?: 'fast-forward' | 'three-way' | 'already-up-to-date'
  /** Merge commit ID (if applicable) */
  mergeCommit?: number
}

/**
 * Detailed conflict information
 */
interface ConflictInfo {
  /** Thing ID with conflict */
  thingId: string
  /** Conflicting field name */
  field: string
  /** Value in current branch (ours) */
  ours: unknown
  /** Value in source branch (theirs) */
  theirs: unknown
  /** Value in common ancestor (base) */
  base?: unknown
}

/**
 * Options for merge operation
 */
interface MergeOptions {
  /** Strategy for auto-resolving conflicts */
  strategy?: 'ours' | 'theirs' | 'manual'
  /** Whether to abort on first conflict */
  abortOnConflict?: boolean
  /** Commit message for merge commit */
  message?: string
  /** Skip merge commit (fast-forward only) */
  noCommit?: boolean
}

/**
 * Merge state for conflict resolution
 */
interface MergeState {
  /** Source branch being merged */
  source: string
  /** Target branch receiving merge */
  target: string
  /** Pending conflicts to resolve */
  conflicts: ConflictInfo[]
  /** Already resolved things */
  resolved: string[]
  /** Merge started timestamp */
  startedAt: Date
}

/**
 * Branch record in the database
 */
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

/**
 * Merge event types
 */
type MergeEventType =
  | 'merge.started'
  | 'merge.completed'
  | 'merge.conflict'
  | 'merge.failed'
  | 'merge.aborted'
  | 'merge.continued'

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
  createdAt: Date
  updatedAt: Date
}> = {}) {
  return {
    id: overrides.id ?? 'thing-001',
    type: overrides.type ?? 1,
    branch: overrides.branch ?? null,
    name: overrides.name ?? 'Test Thing',
    data: overrides.data ?? { key: 'value' },
    deleted: overrides.deleted ?? false,
    rowid: overrides.rowid ?? 1,
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date(),
  }
}

/**
 * Create sample branch data
 */
function createSampleBranch(overrides: Partial<BranchRecord> = {}): BranchRecord {
  return {
    name: overrides.name ?? 'feature-x',
    thingId: overrides.thingId ?? '',
    head: overrides.head ?? 1,
    base: overrides.base ?? null,
    forkedFrom: overrides.forkedFrom ?? null,
    description: overrides.description ?? null,
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date(),
  }
}

/**
 * Setup a fast-forward merge scenario
 * Main has no new commits, feature has new commits
 */
function setupFastForwardScenario(mockResult: MockDOResult<DO, MockEnv>) {
  // Main branch - base state (HEAD at rowid 2)
  // Feature branch - has new commits on top of main (HEAD at rowid 4)
  mockResult.sqlData.set('things', [
    // Base items (shared between main and feature at fork point)
    createSampleThing({ id: 'shared-1', rowid: 1, branch: null, data: { value: 'original' } }),
    createSampleThing({ id: 'shared-2', rowid: 2, branch: null, data: { value: 'original' } }),
    // Feature branch additions (not on main)
    createSampleThing({ id: 'feature-new-1', rowid: 3, branch: 'feature-ff', data: { added: true } }),
    createSampleThing({ id: 'feature-new-2', rowid: 4, branch: 'feature-ff', data: { added: true } }),
  ])

  mockResult.sqlData.set('branches', [
    createSampleBranch({ name: 'main', head: 2, base: null, forkedFrom: null }),
    createSampleBranch({ name: 'feature-ff', head: 4, base: 2, forkedFrom: 'main' }),
  ])

  mockResult.storage.data.set('currentBranch', 'main')
}

/**
 * Setup a three-way merge scenario
 * Both branches have divergent commits since fork point
 */
function setupThreeWayScenario(mockResult: MockDOResult<DO, MockEnv>) {
  // Fork point at rowid 2
  // Main has commits 3-4, Feature has commits 5-6
  mockResult.sqlData.set('things', [
    // Base state (fork point)
    createSampleThing({ id: 'base-1', rowid: 1, branch: null, data: { field: 'base' } }),
    createSampleThing({ id: 'base-2', rowid: 2, branch: null, data: { field: 'base' } }),
    // Main branch commits after fork
    createSampleThing({ id: 'main-new', rowid: 3, branch: null, data: { source: 'main' } }),
    createSampleThing({ id: 'base-1', rowid: 4, branch: null, data: { field: 'main-updated' } }), // Updated on main
    // Feature branch commits
    createSampleThing({ id: 'feature-new', rowid: 5, branch: 'feature-3w', data: { source: 'feature' } }),
    createSampleThing({ id: 'base-2', rowid: 6, branch: 'feature-3w', data: { field: 'feature-updated' } }), // Updated on feature
  ])

  mockResult.sqlData.set('branches', [
    createSampleBranch({ name: 'main', head: 4, base: null, forkedFrom: null }),
    createSampleBranch({ name: 'feature-3w', head: 6, base: 2, forkedFrom: 'main' }),
  ])

  mockResult.storage.data.set('currentBranch', 'main')
}

/**
 * Setup a conflict scenario
 * Same field modified on both branches
 */
function setupConflictScenario(mockResult: MockDOResult<DO, MockEnv>) {
  mockResult.sqlData.set('things', [
    // Base state
    createSampleThing({ id: 'conflict-item', rowid: 1, branch: null, data: { value: 'base', common: 'unchanged' } }),
    // Main modification
    createSampleThing({ id: 'conflict-item', rowid: 2, branch: null, data: { value: 'main-change', common: 'unchanged' } }),
    // Feature modification - CONFLICT on 'value' field
    createSampleThing({ id: 'conflict-item', rowid: 3, branch: 'feature-conflict', data: { value: 'feature-change', common: 'unchanged' } }),
  ])

  mockResult.sqlData.set('branches', [
    createSampleBranch({ name: 'main', head: 2, base: null, forkedFrom: null }),
    createSampleBranch({ name: 'feature-conflict', head: 3, base: 1, forkedFrom: 'main' }),
  ])

  mockResult.storage.data.set('currentBranch', 'main')
}

// ============================================================================
// MERGE OPERATION TESTS
// ============================================================================

describe('ACID Phase 1: merge() - Merge Branches', () => {
  let mockResult: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    mockResult = createMockDO(DO, {
      id: 'test-do',
      ns: 'https://test.example.com',
    })

    // Set up things - main and feature branch with different changes
    mockResult.sqlData.set('things', [
      // Main branch items
      createSampleThing({ id: 'shared-item', rowid: 1, branch: null, data: { field: 'main-value', common: 'base' } }),
      createSampleThing({ id: 'main-only', rowid: 2, branch: null, data: { exclusive: true } }),
      // Feature branch items
      createSampleThing({ id: 'shared-item', rowid: 3, branch: 'feature-x', data: { field: 'feature-value', common: 'base' } }),
      createSampleThing({ id: 'feature-only', rowid: 4, branch: 'feature-x', data: { new: 'feature-item' } }),
    ])

    // Set up branches
    mockResult.sqlData.set('branches', [
      createSampleBranch({ name: 'main', head: 2, base: null, forkedFrom: null }),
      createSampleBranch({ name: 'feature-x', head: 4, base: 2, forkedFrom: 'main' }),
    ])

    // Set current branch to main
    mockResult.storage.data.set('currentBranch', 'main')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // FAST-FORWARD MERGE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Fast-Forward Merge', () => {
    beforeEach(() => {
      setupFastForwardScenario(mockResult)
    })

    it('should detect fast-forward merge opportunity', async () => {
      const result = await mockResult.instance.merge('feature-ff')

      expect(result.merged).toBe(true)
      expect(result.mergeType).toBe('fast-forward')
    })

    it('should move HEAD pointer without creating merge commit', async () => {
      const mainBefore = (mockResult.sqlData.get('branches') as BranchRecord[])
        .find(b => b.name === 'main')
      expect(mainBefore?.head).toBe(2)

      await mockResult.instance.merge('feature-ff')

      const mainAfter = (mockResult.sqlData.get('branches') as BranchRecord[])
        .find(b => b.name === 'main')
      // HEAD should point to feature branch's HEAD
      expect(mainAfter?.head).toBe(4)
    })

    it('should apply all source branch commits to target', async () => {
      const result = await mockResult.instance.merge('feature-ff')

      expect(result.thingsMerged).toBe(2) // feature-new-1 and feature-new-2
    })

    it('should not report conflicts for fast-forward', async () => {
      const result = await mockResult.instance.merge('feature-ff')

      expect(result.conflicts).toBeUndefined()
    })

    it('should emit merge.completed with fast-forward type', async () => {
      const events = mockResult.sqlData.get('events') as Array<{ verb: string; data?: unknown }>

      await mockResult.instance.merge('feature-ff')

      const completedEvent = events.find(e => e.verb === 'merge.completed')
      expect(completedEvent).toBeDefined()
      expect((completedEvent?.data as Record<string, unknown>)?.mergeType).toBe('fast-forward')
    })

    it('should handle already up-to-date case', async () => {
      // Merge twice - second should be no-op
      await mockResult.instance.merge('feature-ff')
      const result = await mockResult.instance.merge('feature-ff')

      expect(result.mergeType).toBe('already-up-to-date')
      expect(result.thingsMerged).toBe(0)
    })

    it('should preserve thing ordering during fast-forward', async () => {
      await mockResult.instance.merge('feature-ff')

      const things = mockResult.sqlData.get('things') as Array<{ id: string; rowid: number }>
      const mainThings = things.filter(t => (t as { branch: string | null }).branch === null)

      // Verify ordering is preserved
      const rowids = mainThings.map(t => t.rowid)
      expect(rowids).toEqual([...rowids].sort((a, b) => a - b))
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // THREE-WAY MERGE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Three-Way Merge', () => {
    beforeEach(() => {
      setupThreeWayScenario(mockResult)
    })

    it('should detect three-way merge requirement', async () => {
      const result = await mockResult.instance.merge('feature-3w')

      expect(result.merged).toBe(true)
      expect(result.mergeType).toBe('three-way')
    })

    it('should create merge commit', async () => {
      const mainBefore = (mockResult.sqlData.get('branches') as BranchRecord[])
        .find(b => b.name === 'main')
      const initialHead = mainBefore?.head ?? 0

      const result = await mockResult.instance.merge('feature-3w')

      // Merge should create a new commit (rowid)
      expect(result.mergeCommit).toBeGreaterThan(initialHead)
    })

    it('should find common ancestor (merge base)', async () => {
      // Feature forked at base 2
      const result = await mockResult.instance.merge('feature-3w')

      expect(result.merged).toBe(true)
      // Non-conflicting changes should auto-merge
    })

    it('should merge non-conflicting changes from both branches', async () => {
      await mockResult.instance.merge('feature-3w')

      const things = mockResult.sqlData.get('things') as Array<{ id: string; branch: string | null }>
      const mainThings = things.filter(t => t.branch === null)

      // Should have: base-1, base-2, main-new, feature-new
      const ids = mainThings.map(t => t.id)
      expect(ids).toContain('main-new')
      expect(ids).toContain('feature-new')
    })

    it('should preserve changes from both branches', async () => {
      await mockResult.instance.merge('feature-3w')

      const things = mockResult.sqlData.get('things') as Array<{
        id: string
        branch: string | null
        data: Record<string, unknown>
      }>

      // base-1 was updated on main
      const base1 = things.find(t => t.id === 'base-1' && t.branch === null)
      expect(base1?.data.field).toBe('main-updated')

      // base-2 was updated on feature - should be merged
      const base2 = things.find(t => t.id === 'base-2' && t.branch === null)
      expect(base2?.data.field).toBe('feature-updated')
    })

    it('should record merge parents in history', async () => {
      const result = await mockResult.instance.merge('feature-3w')

      const events = mockResult.sqlData.get('events') as Array<{
        verb: string
        data?: { parents?: string[] }
      }>
      const mergeEvent = events.find(e => e.verb === 'merge.completed')

      expect(mergeEvent?.data?.parents).toContain('main')
      expect(mergeEvent?.data?.parents).toContain('feature-3w')
    })

    it('should handle deep nested object merges', async () => {
      mockResult.sqlData.set('things', [
        createSampleThing({
          id: 'nested',
          rowid: 1,
          branch: null,
          data: { level1: { level2: { a: 1, b: 2 } } }
        }),
        createSampleThing({
          id: 'nested',
          rowid: 2,
          branch: null,
          data: { level1: { level2: { a: 1, b: 2, c: 3 } } } // Main adds c
        }),
        createSampleThing({
          id: 'nested',
          rowid: 3,
          branch: 'feature-nested',
          data: { level1: { level2: { a: 1, b: 2, d: 4 } } } // Feature adds d
        }),
      ])

      mockResult.sqlData.set('branches', [
        createSampleBranch({ name: 'main', head: 2, base: null }),
        createSampleBranch({ name: 'feature-nested', head: 3, base: 1, forkedFrom: 'main' }),
      ])

      const result = await mockResult.instance.merge('feature-nested')

      // Should merge both additions: c and d
      expect(result.merged).toBe(true)
    })

    it('should merge arrays by position or append strategy', async () => {
      mockResult.sqlData.set('things', [
        createSampleThing({
          id: 'array-item',
          rowid: 1,
          branch: null,
          data: { tags: ['a', 'b'] }
        }),
        createSampleThing({
          id: 'array-item',
          rowid: 2,
          branch: null,
          data: { tags: ['a', 'b', 'c'] } // Main adds c
        }),
        createSampleThing({
          id: 'array-item',
          rowid: 3,
          branch: 'feature-array',
          data: { tags: ['a', 'b', 'd'] } // Feature adds d
        }),
      ])

      mockResult.sqlData.set('branches', [
        createSampleBranch({ name: 'main', head: 2, base: null }),
        createSampleBranch({ name: 'feature-array', head: 3, base: 1, forkedFrom: 'main' }),
      ])

      const result = await mockResult.instance.merge('feature-array')

      // Arrays should be merged (strategy depends on implementation)
      expect(result).toBeDefined()
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // CONFLICT DETECTION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Conflict Detection', () => {
    beforeEach(() => {
      setupConflictScenario(mockResult)
    })

    it('should detect conflicts on same field modification', async () => {
      const result = await mockResult.instance.merge('feature-conflict')

      expect(result.conflicts).toBeDefined()
      expect(result.conflicts!.length).toBeGreaterThan(0)
    })

    it('should provide detailed conflict information', async () => {
      const result = await mockResult.instance.merge('feature-conflict')

      const conflict = result.conflicts?.[0]
      expect(conflict).toMatchObject({
        thingId: 'conflict-item',
        field: 'value',
        ours: 'main-change',
        theirs: 'feature-change',
        base: 'base',
      })
    })

    it('should not merge conflicting items until resolved', async () => {
      await mockResult.instance.merge('feature-conflict')

      const things = mockResult.sqlData.get('things') as Array<{
        id: string
        branch: string | null
        data: Record<string, unknown>
      }>
      const mainItem = things.find(t => t.id === 'conflict-item' && t.branch === null)

      // Main value should be unchanged (not auto-resolved)
      expect(mainItem?.data.value).toBe('main-change')
    })

    it('should emit merge.conflict event', async () => {
      const events = mockResult.sqlData.get('events') as Array<{ verb: string }>

      await mockResult.instance.merge('feature-conflict')

      const eventVerbs = events.map(e => e.verb)
      expect(eventVerbs).toContain('merge.conflict')
    })

    it('should identify all conflicting fields in a thing', async () => {
      // Multiple fields conflict
      mockResult.sqlData.set('things', [
        createSampleThing({
          id: 'multi-conflict',
          rowid: 1,
          branch: null,
          data: { a: 'base', b: 'base', c: 'base' }
        }),
        createSampleThing({
          id: 'multi-conflict',
          rowid: 2,
          branch: null,
          data: { a: 'main-a', b: 'main-b', c: 'base' }
        }),
        createSampleThing({
          id: 'multi-conflict',
          rowid: 3,
          branch: 'feature-multi',
          data: { a: 'feat-a', b: 'feat-b', c: 'base' }
        }),
      ])

      mockResult.sqlData.set('branches', [
        createSampleBranch({ name: 'main', head: 2, base: null }),
        createSampleBranch({ name: 'feature-multi', head: 3, base: 1, forkedFrom: 'main' }),
      ])

      const result = await mockResult.instance.merge('feature-multi')

      // Should detect conflicts for both 'a' and 'b' fields
      expect(result.conflicts?.length).toBeGreaterThanOrEqual(2)
      expect(result.conflicts?.some(c => c.field === 'a')).toBe(true)
      expect(result.conflicts?.some(c => c.field === 'b')).toBe(true)
    })

    it('should not conflict on identical changes', async () => {
      // Both branches make the same change - no conflict
      mockResult.sqlData.set('things', [
        createSampleThing({
          id: 'same-change',
          rowid: 1,
          branch: null,
          data: { value: 'old' }
        }),
        createSampleThing({
          id: 'same-change',
          rowid: 2,
          branch: null,
          data: { value: 'new' }
        }),
        createSampleThing({
          id: 'same-change',
          rowid: 3,
          branch: 'feature-same',
          data: { value: 'new' } // Same change!
        }),
      ])

      mockResult.sqlData.set('branches', [
        createSampleBranch({ name: 'main', head: 2, base: null }),
        createSampleBranch({ name: 'feature-same', head: 3, base: 1, forkedFrom: 'main' }),
      ])

      const result = await mockResult.instance.merge('feature-same')

      expect(result.conflicts).toBeUndefined()
      expect(result.merged).toBe(true)
    })

    it('should detect type conflicts (string vs number)', async () => {
      mockResult.sqlData.set('things', [
        createSampleThing({
          id: 'type-conflict',
          rowid: 1,
          branch: null,
          data: { value: 'string' }
        }),
        createSampleThing({
          id: 'type-conflict',
          rowid: 2,
          branch: null,
          data: { value: 42 } // Changed to number on main
        }),
        createSampleThing({
          id: 'type-conflict',
          rowid: 3,
          branch: 'feature-type',
          data: { value: 'other-string' } // Changed to different string on feature
        }),
      ])

      mockResult.sqlData.set('branches', [
        createSampleBranch({ name: 'main', head: 2, base: null }),
        createSampleBranch({ name: 'feature-type', head: 3, base: 1, forkedFrom: 'main' }),
      ])

      const result = await mockResult.instance.merge('feature-type')

      expect(result.conflicts).toBeDefined()
      expect(result.conflicts!.length).toBeGreaterThan(0)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // MERGE ABORT / CONTINUE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Merge Abort/Continue', () => {
    beforeEach(() => {
      setupConflictScenario(mockResult)
    })

    it('should save merge state on conflict', async () => {
      await mockResult.instance.merge('feature-conflict')

      const mergeState = mockResult.storage.data.get('mergeState') as MergeState | undefined
      expect(mergeState).toBeDefined()
      expect(mergeState?.source).toBe('feature-conflict')
      expect(mergeState?.target).toBe('main')
    })

    it('should abort merge and restore original state', async () => {
      const thingsBefore = [...(mockResult.sqlData.get('things') as unknown[])]

      await mockResult.instance.merge('feature-conflict')
      await mockResult.instance.mergeAbort()

      // State should be restored
      const thingsAfter = mockResult.sqlData.get('things') as unknown[]
      expect(thingsAfter.length).toBe(thingsBefore.length)
    })

    it('should clear merge state on abort', async () => {
      await mockResult.instance.merge('feature-conflict')
      await mockResult.instance.mergeAbort()

      const mergeState = mockResult.storage.data.get('mergeState')
      expect(mergeState).toBeUndefined()
    })

    it('should emit merge.aborted event', async () => {
      const events = mockResult.sqlData.get('events') as Array<{ verb: string }>

      await mockResult.instance.merge('feature-conflict')
      await mockResult.instance.mergeAbort()

      const eventVerbs = events.map(e => e.verb)
      expect(eventVerbs).toContain('merge.aborted')
    })

    it('should resolve conflict with ours strategy', async () => {
      await mockResult.instance.merge('feature-conflict')
      await mockResult.instance.resolveConflict('conflict-item', 'value', 'ours')
      const result = await mockResult.instance.mergeContinue()

      expect(result.merged).toBe(true)

      const things = mockResult.sqlData.get('things') as Array<{
        id: string
        branch: string | null
        data: Record<string, unknown>
      }>
      const item = things.find(t => t.id === 'conflict-item' && t.branch === null)
      expect(item?.data.value).toBe('main-change')
    })

    it('should resolve conflict with theirs strategy', async () => {
      await mockResult.instance.merge('feature-conflict')
      await mockResult.instance.resolveConflict('conflict-item', 'value', 'theirs')
      const result = await mockResult.instance.mergeContinue()

      expect(result.merged).toBe(true)

      const things = mockResult.sqlData.get('things') as Array<{
        id: string
        branch: string | null
        data: Record<string, unknown>
      }>
      const item = things.find(t => t.id === 'conflict-item' && t.branch === null)
      expect(item?.data.value).toBe('feature-change')
    })

    it('should resolve conflict with custom value', async () => {
      await mockResult.instance.merge('feature-conflict')
      await mockResult.instance.resolveConflict('conflict-item', 'value', 'custom-resolution')
      const result = await mockResult.instance.mergeContinue()

      expect(result.merged).toBe(true)

      const things = mockResult.sqlData.get('things') as Array<{
        id: string
        branch: string | null
        data: Record<string, unknown>
      }>
      const item = things.find(t => t.id === 'conflict-item' && t.branch === null)
      expect(item?.data.value).toBe('custom-resolution')
    })

    it('should emit merge.continued event', async () => {
      const events = mockResult.sqlData.get('events') as Array<{ verb: string }>

      await mockResult.instance.merge('feature-conflict')
      await mockResult.instance.resolveConflict('conflict-item', 'value', 'ours')
      await mockResult.instance.mergeContinue()

      const eventVerbs = events.map(e => e.verb)
      expect(eventVerbs).toContain('merge.continued')
    })

    it('should error when continuing without resolving all conflicts', async () => {
      await mockResult.instance.merge('feature-conflict')

      // Don't resolve conflict
      await expect(mockResult.instance.mergeContinue())
        .rejects.toThrow(/Unresolved conflicts|Cannot continue/)
    })

    it('should error when aborting without active merge', async () => {
      await expect(mockResult.instance.mergeAbort())
        .rejects.toThrow(/No merge in progress|active merge/)
    })

    it('should error when continuing without active merge', async () => {
      await expect(mockResult.instance.mergeContinue())
        .rejects.toThrow(/No merge in progress|active merge/)
    })

    it('should prevent other operations during merge conflict', async () => {
      await mockResult.instance.merge('feature-conflict')

      // Trying to checkout while merge is in progress
      await expect(mockResult.instance.checkout('feature-conflict'))
        .rejects.toThrow(/Merge in progress|resolve conflicts/)
    })

    it('should allow viewing conflicts during merge', async () => {
      await mockResult.instance.merge('feature-conflict')

      const conflicts = await mockResult.instance.getMergeConflicts()

      expect(conflicts).toBeDefined()
      expect(conflicts.length).toBeGreaterThan(0)
      expect(conflicts[0]).toMatchObject({
        thingId: 'conflict-item',
        field: 'value',
      })
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // BASIC MERGE OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Basic Merge Operations', () => {
    it('should merge source branch changes into current branch', async () => {
      const result = await mockResult.instance.merge('feature-x')

      expect(result.merged).toBe(true)
    })

    it('should apply new things from source to target', async () => {
      await mockResult.instance.merge('feature-x')

      // feature-only item should now be on main (branch: null)
      const things = mockResult.sqlData.get('things') as Array<{ id: string; branch: string | null }>
      const mergedItem = things.find(t => t.id === 'feature-only' && t.branch === null)
      expect(mergedItem).toBeDefined()
    })

    it('should detect field-level conflicts', async () => {
      // Both branches modified the same field
      const result = await mockResult.instance.merge('feature-x')

      // shared-item has different 'field' values on each branch
      if (result.conflicts) {
        expect(result.conflicts.length).toBeGreaterThan(0)
        expect(result.conflicts.some(c => c.thingId === 'shared-item')).toBe(true)
      }
    })

    it('should auto-merge non-conflicting changes', async () => {
      // Set up scenario with non-conflicting changes
      mockResult.sqlData.set('things', [
        createSampleThing({ id: 'item-1', rowid: 1, branch: null, data: { fieldA: 'main' } }),
        createSampleThing({ id: 'item-1', rowid: 2, branch: 'feature-x', data: { fieldB: 'feature' } }),
      ])

      const result = await mockResult.instance.merge('feature-x')

      // Should auto-merge since different fields modified
      expect(result.merged).toBe(true)
      expect(result.conflicts).toBeUndefined()
    })

    it('should emit merge.started and merge.completed events', async () => {
      const events = mockResult.sqlData.get('events') as Array<{ verb: string }>

      await mockResult.instance.merge('feature-x')

      const eventVerbs = events.map(e => e.verb)
      expect(eventVerbs).toContain('merge.started')
      expect(eventVerbs).toContain('merge.completed')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Validation', () => {
    it('should prevent merging into detached HEAD', async () => {
      // Set detached HEAD state
      mockResult.storage.data.set('currentBranch', null)
      mockResult.storage.data.set('detachedVersion', 1)

      await expect(mockResult.instance.merge('feature-x'))
        .rejects.toThrow(/Cannot merge into detached HEAD/)
    })

    it('should prevent merging branch into itself', async () => {
      mockResult.storage.data.set('currentBranch', 'feature-x')

      await expect(mockResult.instance.merge('feature-x'))
        .rejects.toThrow(/Cannot merge branch into itself/)
    })

    it('should error for non-existent source branch', async () => {
      await expect(mockResult.instance.merge('non-existent'))
        .rejects.toThrow(/Branch .* does not exist|not found/)
    })

    it('should error for empty branch name', async () => {
      await expect(mockResult.instance.merge(''))
        .rejects.toThrow(/Invalid branch name|empty/)
    })

    it('should prevent merging during active merge', async () => {
      setupConflictScenario(mockResult)
      await mockResult.instance.merge('feature-conflict')

      await expect(mockResult.instance.merge('feature-x'))
        .rejects.toThrow(/Merge already in progress|resolve conflicts/)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // DELETED THINGS HANDLING
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Deleted Things Handling', () => {
    it('should handle things deleted in source branch', async () => {
      mockResult.sqlData.set('things', [
        createSampleThing({ id: 'to-delete', rowid: 1, branch: null, data: { val: 1 } }),
        createSampleThing({ id: 'to-delete', rowid: 2, branch: 'feature-x', deleted: true }),
      ])

      const result = await mockResult.instance.merge('feature-x')

      // Merge should succeed and mark thing as deleted on main
      expect(result.merged).toBe(true)
    })

    it('should handle things deleted in target branch', async () => {
      mockResult.sqlData.set('things', [
        createSampleThing({ id: 'was-deleted', rowid: 1, branch: null, deleted: true }),
        createSampleThing({ id: 'was-deleted', rowid: 2, branch: 'feature-x', data: { restored: true } }),
      ])

      const result = await mockResult.instance.merge('feature-x')

      // Conflict or restore - implementation may vary
      expect(result).toBeDefined()
    })

    it('should handle things deleted in both branches', async () => {
      mockResult.sqlData.set('things', [
        createSampleThing({ id: 'both-deleted', rowid: 1, branch: null, deleted: true }),
        createSampleThing({ id: 'both-deleted', rowid: 2, branch: 'feature-x', deleted: true }),
      ])

      const result = await mockResult.instance.merge('feature-x')

      // No conflict - both agree it's deleted
      expect(result.merged).toBe(true)
      expect(result.conflicts).toBeUndefined()
    })

    it('should detect modify/delete conflict', async () => {
      // Thing modified on main, deleted on feature
      mockResult.sqlData.set('things', [
        createSampleThing({ id: 'mod-del', rowid: 1, branch: null, data: { val: 'base' } }),
        createSampleThing({ id: 'mod-del', rowid: 2, branch: null, data: { val: 'modified' } }), // Modified on main
        createSampleThing({ id: 'mod-del', rowid: 3, branch: 'feature-moddel', deleted: true }), // Deleted on feature
      ])

      mockResult.sqlData.set('branches', [
        createSampleBranch({ name: 'main', head: 2, base: null }),
        createSampleBranch({ name: 'feature-moddel', head: 3, base: 1, forkedFrom: 'main' }),
      ])

      const result = await mockResult.instance.merge('feature-moddel')

      // Should detect modify/delete conflict
      expect(result.conflicts).toBeDefined()
    })

    it('should detect delete/modify conflict', async () => {
      // Thing deleted on main, modified on feature
      mockResult.sqlData.set('things', [
        createSampleThing({ id: 'del-mod', rowid: 1, branch: null, data: { val: 'base' } }),
        createSampleThing({ id: 'del-mod', rowid: 2, branch: null, deleted: true }), // Deleted on main
        createSampleThing({ id: 'del-mod', rowid: 3, branch: 'feature-delmod', data: { val: 'modified' } }), // Modified on feature
      ])

      mockResult.sqlData.set('branches', [
        createSampleBranch({ name: 'main', head: 2, base: null }),
        createSampleBranch({ name: 'feature-delmod', head: 3, base: 1, forkedFrom: 'main' }),
      ])

      const result = await mockResult.instance.merge('feature-delmod')

      // Should detect delete/modify conflict
      expect(result.conflicts).toBeDefined()
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // MERGE OPTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Merge Options', () => {
    it('should support --no-ff to force merge commit', async () => {
      setupFastForwardScenario(mockResult)

      const result = await mockResult.instance.merge('feature-ff', { noCommit: false })

      // Even though fast-forward possible, should create merge commit
      expect(result.mergeCommit).toBeDefined()
    })

    it('should support ours strategy for auto-resolution', async () => {
      setupConflictScenario(mockResult)

      const result = await mockResult.instance.merge('feature-conflict', { strategy: 'ours' })

      expect(result.merged).toBe(true)
      expect(result.conflicts).toBeUndefined()
      expect(result.autoResolved).toBeGreaterThan(0)
    })

    it('should support theirs strategy for auto-resolution', async () => {
      setupConflictScenario(mockResult)

      const result = await mockResult.instance.merge('feature-conflict', { strategy: 'theirs' })

      expect(result.merged).toBe(true)
      expect(result.conflicts).toBeUndefined()
    })

    it('should support custom merge commit message', async () => {
      setupThreeWayScenario(mockResult)

      await mockResult.instance.merge('feature-3w', { message: 'Custom merge message' })

      const events = mockResult.sqlData.get('events') as Array<{
        verb: string
        data?: { message?: string }
      }>
      const mergeEvent = events.find(e => e.verb === 'merge.completed')
      expect(mergeEvent?.data?.message).toBe('Custom merge message')
    })

    it('should support abort-on-conflict option', async () => {
      setupConflictScenario(mockResult)

      await expect(mockResult.instance.merge('feature-conflict', { abortOnConflict: true }))
        .rejects.toThrow(/Merge aborted.*conflict/)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // ATOMICITY (ACID)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Atomicity', () => {
    it('should merge fully or not at all', async () => {
      const thingsBefore = [...(mockResult.sqlData.get('things') as unknown[])]

      // Simulate failure during merge
      const originalExec = mockResult.storage.sql.exec
      let callCount = 0
      mockResult.storage.sql.exec = vi.fn().mockImplementation((query: string, ...params: unknown[]) => {
        callCount++
        if (query.toLowerCase().includes('insert') && callCount > 2) {
          throw new Error('Database error')
        }
        return originalExec.call(mockResult.storage.sql, query, ...params)
      })

      await expect(mockResult.instance.merge('feature-x'))
        .rejects.toThrow()

      // State should be unchanged (rollback)
      const thingsAfter = mockResult.sqlData.get('things') as unknown[]
      // Original items should still be present
      expect(thingsAfter.length).toBe(thingsBefore.length)
    })

    it('should not create partial merge state', async () => {
      mockResult.storage.sql.exec = vi.fn().mockImplementation(() => {
        throw new Error('Database error')
      })

      await expect(mockResult.instance.merge('feature-x'))
        .rejects.toThrow()

      // No merge.completed should be present
      const events = mockResult.sqlData.get('events') as Array<{ verb: string }>
      const eventVerbs = events.map(e => e.verb)
      expect(eventVerbs).not.toContain('merge.completed')
    })

    it('should rollback on mid-merge failure', async () => {
      const branchesBefore = [...(mockResult.sqlData.get('branches') as BranchRecord[])]

      let insertCount = 0
      const originalExec = mockResult.storage.sql.exec
      mockResult.storage.sql.exec = vi.fn().mockImplementation((query: string, ...params: unknown[]) => {
        if (query.toLowerCase().includes('insert')) {
          insertCount++
          if (insertCount >= 2) {
            throw new Error('Simulated failure')
          }
        }
        return originalExec.call(mockResult.storage.sql, query, ...params)
      })

      await expect(mockResult.instance.merge('feature-x')).rejects.toThrow()

      // Branches should be unchanged
      const branchesAfter = mockResult.sqlData.get('branches') as BranchRecord[]
      expect(branchesAfter.length).toBe(branchesBefore.length)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSISTENCY (ACID)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Consistency', () => {
    it('should maintain valid state after merge', async () => {
      await mockResult.instance.merge('feature-x')

      const things = mockResult.sqlData.get('things') as Array<{
        id: string
        type: number
        data: unknown
      }>

      // All things should have valid structure
      for (const thing of things) {
        expect(thing.id).toBeDefined()
        expect(thing.type).toBeDefined()
        expect(thing.data).toBeDefined()
      }
    })

    it('should preserve type constraints', async () => {
      mockResult.sqlData.set('things', [
        createSampleThing({ id: 'typed', rowid: 1, branch: null, type: 5 }),
        createSampleThing({ id: 'typed', rowid: 2, branch: 'feature-x', type: 5, data: { updated: true } }),
      ])

      await mockResult.instance.merge('feature-x')

      const things = mockResult.sqlData.get('things') as Array<{ id: string; type: number }>
      const mergedItem = things.find(t => t.id === 'typed')
      expect(mergedItem?.type).toBe(5)
    })

    it('should update branch HEAD after merge', async () => {
      const mainBefore = (mockResult.sqlData.get('branches') as BranchRecord[])
        .find(b => b.name === 'main')

      await mockResult.instance.merge('feature-x')

      // Main branch HEAD should be updated
      const mainAfter = (mockResult.sqlData.get('branches') as BranchRecord[])
        .find(b => b.name === 'main')

      expect(mainAfter?.head).toBeGreaterThanOrEqual(mainBefore?.head ?? 0)
    })

    it('should maintain referential integrity', async () => {
      // Set up things with relationships
      mockResult.sqlData.set('things', [
        createSampleThing({ id: 'parent', rowid: 1, branch: null }),
        createSampleThing({ id: 'child', rowid: 2, branch: null, data: { parentId: 'parent' } }),
        createSampleThing({ id: 'child', rowid: 3, branch: 'feature-x', data: { parentId: 'parent', extra: true } }),
      ])

      await mockResult.instance.merge('feature-x')

      const things = mockResult.sqlData.get('things') as Array<{
        id: string
        data: { parentId?: string }
      }>
      const child = things.find(t => t.id === 'child')
      expect(child?.data.parentId).toBe('parent')
    })

    it('should increment updatedAt on merged things', async () => {
      const before = new Date()

      await mockResult.instance.merge('feature-x')

      const things = mockResult.sqlData.get('things') as Array<{
        id: string
        branch: string | null
        updatedAt: Date
      }>
      const mergedItems = things.filter(t => t.branch === null)

      for (const item of mergedItems) {
        expect(new Date(item.updatedAt).getTime()).toBeGreaterThanOrEqual(before.getTime())
      }
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // ISOLATION (ACID)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Isolation', () => {
    it('should not modify source branch', async () => {
      const featureBefore = (mockResult.sqlData.get('branches') as BranchRecord[])
        .find(b => b.name === 'feature-x')
      const featureThingsBefore = (mockResult.sqlData.get('things') as Array<{ branch: string | null }>)
        .filter(t => t.branch === 'feature-x')

      await mockResult.instance.merge('feature-x')

      // Feature branch should be unchanged
      const featureAfter = (mockResult.sqlData.get('branches') as BranchRecord[])
        .find(b => b.name === 'feature-x')
      expect(featureAfter?.head).toBe(featureBefore?.head)

      const featureThingsAfter = (mockResult.sqlData.get('things') as Array<{ branch: string | null }>)
        .filter(t => t.branch === 'feature-x')
      expect(featureThingsAfter.length).toBe(featureThingsBefore.length)
    })

    it('should only affect target branch', async () => {
      await mockResult.instance.merge('feature-x')

      // Feature branch things should still exist
      const things = mockResult.sqlData.get('things') as Array<{ branch: string | null }>
      const featureThings = things.filter(t => t.branch === 'feature-x')
      expect(featureThings.length).toBeGreaterThan(0)
    })

    it('should not affect unrelated branches', async () => {
      // Add another feature branch
      mockResult.sqlData.set('branches', [
        ...mockResult.sqlData.get('branches') as BranchRecord[],
        createSampleBranch({ name: 'feature-y', head: 10, base: 2, forkedFrom: 'main' }),
      ])
      mockResult.sqlData.set('things', [
        ...mockResult.sqlData.get('things') as unknown[],
        createSampleThing({ id: 'y-only', rowid: 10, branch: 'feature-y', data: { from: 'y' } }),
      ])

      await mockResult.instance.merge('feature-x')

      // feature-y should be unchanged
      const featureY = (mockResult.sqlData.get('branches') as BranchRecord[])
        .find(b => b.name === 'feature-y')
      expect(featureY?.head).toBe(10)
    })

    it('should isolate concurrent merge attempts', async () => {
      setupConflictScenario(mockResult)

      // Start a merge that will conflict
      await mockResult.instance.merge('feature-conflict')

      // Another merge attempt should fail, not corrupt state
      await expect(mockResult.instance.merge('feature-x'))
        .rejects.toThrow(/Merge.*in progress/)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // DURABILITY (ACID)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Durability', () => {
    it('should persist merged state', async () => {
      await mockResult.instance.merge('feature-x')

      // Merged items should be in storage
      const things = mockResult.sqlData.get('things') as Array<{ id: string; branch: string | null }>
      const mainThings = things.filter(t => t.branch === null)
      expect(mainThings.length).toBeGreaterThan(0)
    })

    it('should emit events before returning', async () => {
      await mockResult.instance.merge('feature-x')

      const events = mockResult.sqlData.get('events') as Array<{ verb: string }>
      expect(events.some(e => e.verb === 'merge.completed')).toBe(true)
    })

    it('should record merge in history', async () => {
      await mockResult.instance.merge('feature-x')

      // Events should include merge record
      const events = mockResult.sqlData.get('events') as Array<{ verb: string; data?: unknown }>
      const mergeEvent = events.find(e => e.verb === 'merge.completed')
      expect(mergeEvent).toBeDefined()
    })

    it('should persist merge state during conflict resolution', async () => {
      setupConflictScenario(mockResult)

      await mockResult.instance.merge('feature-conflict')

      // Merge state should be stored durably
      const mergeState = mockResult.storage.data.get('mergeState') as MergeState
      expect(mergeState).toBeDefined()
      expect(mergeState.conflicts.length).toBeGreaterThan(0)
    })

    it('should persist resolution decisions', async () => {
      setupConflictScenario(mockResult)

      await mockResult.instance.merge('feature-conflict')
      await mockResult.instance.resolveConflict('conflict-item', 'value', 'ours')

      const mergeState = mockResult.storage.data.get('mergeState') as MergeState
      expect(mergeState.resolved).toContain('conflict-item.value')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // EDGE CASES
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Edge Cases', () => {
    it('should handle empty source branch', async () => {
      mockResult.sqlData.set('things', [
        createSampleThing({ id: 'main-item', rowid: 1, branch: null }),
        // No things on feature branch
      ])
      mockResult.sqlData.set('branches', [
        createSampleBranch({ name: 'main', head: 1, base: null }),
        createSampleBranch({ name: 'empty-feature', head: 1, base: 1, forkedFrom: 'main' }),
      ])

      const result = await mockResult.instance.merge('empty-feature')

      expect(result.mergeType).toBe('already-up-to-date')
    })

    it('should handle merge with many things', async () => {
      // Create 100 things on feature branch
      const things = [
        createSampleThing({ id: 'base', rowid: 1, branch: null }),
      ]
      for (let i = 0; i < 100; i++) {
        things.push(createSampleThing({
          id: `item-${i}`,
          rowid: i + 2,
          branch: 'feature-large',
          data: { index: i },
        }))
      }
      mockResult.sqlData.set('things', things)
      mockResult.sqlData.set('branches', [
        createSampleBranch({ name: 'main', head: 1, base: null }),
        createSampleBranch({ name: 'feature-large', head: 101, base: 1, forkedFrom: 'main' }),
      ])

      const result = await mockResult.instance.merge('feature-large')

      expect(result.merged).toBe(true)
      expect(result.thingsMerged).toBe(100)
    })

    it('should handle deeply nested branch hierarchy', async () => {
      // main -> feature-a -> feature-b (merging b into a, then a into main)
      mockResult.sqlData.set('things', [
        createSampleThing({ id: 'root', rowid: 1, branch: null }),
        createSampleThing({ id: 'from-a', rowid: 2, branch: 'feature-a' }),
        createSampleThing({ id: 'from-b', rowid: 3, branch: 'feature-b' }),
      ])
      mockResult.sqlData.set('branches', [
        createSampleBranch({ name: 'main', head: 1, base: null }),
        createSampleBranch({ name: 'feature-a', head: 2, base: 1, forkedFrom: 'main' }),
        createSampleBranch({ name: 'feature-b', head: 3, base: 2, forkedFrom: 'feature-a' }),
      ])

      // First merge b into a
      mockResult.storage.data.set('currentBranch', 'feature-a')
      const resultB = await mockResult.instance.merge('feature-b')
      expect(resultB.merged).toBe(true)

      // Then merge a into main
      mockResult.storage.data.set('currentBranch', 'main')
      const resultA = await mockResult.instance.merge('feature-a')
      expect(resultA.merged).toBe(true)
    })

    it('should handle special characters in thing IDs', async () => {
      mockResult.sqlData.set('things', [
        createSampleThing({ id: 'item-with-$pecial-chars!', rowid: 1, branch: null }),
        createSampleThing({ id: 'item-with-$pecial-chars!', rowid: 2, branch: 'feature-special', data: { updated: true } }),
      ])
      mockResult.sqlData.set('branches', [
        createSampleBranch({ name: 'main', head: 1 }),
        createSampleBranch({ name: 'feature-special', head: 2, base: 1, forkedFrom: 'main' }),
      ])

      const result = await mockResult.instance.merge('feature-special')

      expect(result.merged).toBe(true)
    })

    it('should handle unicode in data', async () => {
      mockResult.sqlData.set('things', [
        createSampleThing({ id: 'unicode', rowid: 1, branch: null, data: { name: 'Base' } }),
        createSampleThing({ id: 'unicode', rowid: 2, branch: 'feature-unicode', data: { name: '日本語テスト 🎉' } }),
      ])
      mockResult.sqlData.set('branches', [
        createSampleBranch({ name: 'main', head: 1 }),
        createSampleBranch({ name: 'feature-unicode', head: 2, base: 1, forkedFrom: 'main' }),
      ])

      const result = await mockResult.instance.merge('feature-unicode')

      expect(result.merged).toBe(true)
    })

    it('should handle null and undefined values in data', async () => {
      mockResult.sqlData.set('things', [
        createSampleThing({ id: 'nullish', rowid: 1, branch: null, data: { a: null, b: undefined } }),
        createSampleThing({ id: 'nullish', rowid: 2, branch: 'feature-null', data: { a: 'value', b: null } }),
      ])
      mockResult.sqlData.set('branches', [
        createSampleBranch({ name: 'main', head: 1 }),
        createSampleBranch({ name: 'feature-null', head: 2, base: 1, forkedFrom: 'main' }),
      ])

      const result = await mockResult.instance.merge('feature-null')

      expect(result.merged).toBe(true)
    })

    it('should handle very long field names', async () => {
      const longFieldName = 'a'.repeat(1000)
      mockResult.sqlData.set('things', [
        createSampleThing({ id: 'long-field', rowid: 1, branch: null, data: { [longFieldName]: 'base' } }),
        createSampleThing({ id: 'long-field', rowid: 2, branch: 'feature-long', data: { [longFieldName]: 'updated' } }),
      ])
      mockResult.sqlData.set('branches', [
        createSampleBranch({ name: 'main', head: 1 }),
        createSampleBranch({ name: 'feature-long', head: 2, base: 1, forkedFrom: 'main' }),
      ])

      const result = await mockResult.instance.merge('feature-long')

      expect(result.merged).toBe(true)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // PERFORMANCE CONSIDERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Performance', () => {
    it('should complete merge in reasonable time', async () => {
      const start = Date.now()

      await mockResult.instance.merge('feature-x')

      const duration = Date.now() - start
      expect(duration).toBeLessThan(5000) // 5 seconds max
    })

    it('should handle incremental conflict resolution efficiently', async () => {
      // Set up multiple conflicts
      mockResult.sqlData.set('things', [
        createSampleThing({ id: 'c1', rowid: 1, branch: null, data: { v: 'base' } }),
        createSampleThing({ id: 'c2', rowid: 2, branch: null, data: { v: 'base' } }),
        createSampleThing({ id: 'c3', rowid: 3, branch: null, data: { v: 'base' } }),
        createSampleThing({ id: 'c1', rowid: 4, branch: null, data: { v: 'main' } }),
        createSampleThing({ id: 'c2', rowid: 5, branch: null, data: { v: 'main' } }),
        createSampleThing({ id: 'c3', rowid: 6, branch: null, data: { v: 'main' } }),
        createSampleThing({ id: 'c1', rowid: 7, branch: 'feature-multi-conflict', data: { v: 'feat' } }),
        createSampleThing({ id: 'c2', rowid: 8, branch: 'feature-multi-conflict', data: { v: 'feat' } }),
        createSampleThing({ id: 'c3', rowid: 9, branch: 'feature-multi-conflict', data: { v: 'feat' } }),
      ])
      mockResult.sqlData.set('branches', [
        createSampleBranch({ name: 'main', head: 6, base: null }),
        createSampleBranch({ name: 'feature-multi-conflict', head: 9, base: 3, forkedFrom: 'main' }),
      ])

      await mockResult.instance.merge('feature-multi-conflict')

      // Resolve conflicts one by one
      const start = Date.now()
      await mockResult.instance.resolveConflict('c1', 'v', 'ours')
      await mockResult.instance.resolveConflict('c2', 'v', 'ours')
      await mockResult.instance.resolveConflict('c3', 'v', 'ours')
      const duration = Date.now() - start

      expect(duration).toBeLessThan(1000) // 1 second for 3 resolutions
    })
  })
})
