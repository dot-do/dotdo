/**
 * DO Compact and Merge Operations Tests
 *
 * Tests for DOFull compact() and merge() operations using REAL miniflare DOs.
 * NO MOCKS - these tests verify actual DO behavior with real SQLite storage.
 *
 * Reference implementations:
 * - compact(): objects/DOFull.ts:563
 * - merge(): objects/DOFull.ts:1871
 *
 * Run with: npx vitest run objects/tests/do-compact-merge.test.ts --project=do-rpc
 *
 * @module objects/tests/do-compact-merge.test
 */

import { env } from 'cloudflare:test'
import { describe, it, expect, beforeEach } from 'vitest'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Unique namespace per test suite run to ensure isolation
 */
const testRunId = Date.now()

/**
 * Generate a unique namespace for each test to ensure isolation
 */
function uniqueNs(prefix: string = 'compact-test'): string {
  return `${prefix}-${testRunId}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Type definitions for compact/merge RPC
 */
interface CompactResult {
  thingsCompacted: number
  actionsArchived: number
  eventsArchived: number
}

interface BranchResult {
  name: string
  created: boolean
}

interface CheckoutResult {
  ref: string
  version?: number
}

interface MergeResult {
  merged: boolean
  conflicts?: string[]
}

interface ThingEntity {
  $id: string
  $type: string
  name?: string
  data?: Record<string, unknown>
}

/**
 * Extended stub type with DOFull RPC methods
 */
interface DOFullStub extends DurableObjectStub {
  // Things store RPC methods
  thingsCreate(data: Partial<ThingEntity>): Promise<ThingEntity>
  thingsGet(id: string): Promise<ThingEntity | null>
  thingsList(options?: { type?: string }): Promise<ThingEntity[]>
  thingsUpdate(id: string, data: Partial<ThingEntity>): Promise<ThingEntity>
  thingsDelete(id: string): Promise<ThingEntity | null>

  // DOFull lifecycle operations
  compact(): Promise<CompactResult>
  branch(name: string): Promise<BranchResult>
  checkout(ref: string): Promise<CheckoutResult>
  merge(branch: string): Promise<MergeResult>

  // SQL access for verification
  sqlExecute(
    query: string,
    params?: unknown[]
  ): Promise<{ rows: Record<string, unknown>[]; changes?: number }>
}

// ============================================================================
// Compact Operation Tests
// ============================================================================

describe('DO Compact and Merge Operations', () => {
  let stub: DOFullStub
  let ns: string

  beforeEach(() => {
    ns = uniqueNs()
    // Get DO stub - uses TEST_DO binding from wrangler.do-test.jsonc
    const id = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.idFromName(ns)
    stub = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.get(id) as DOFullStub
  })

  // ==========================================================================
  // compact() Tests
  // ==========================================================================

  describe('compact()', () => {
    /**
     * Test: Basic compaction after creating and deleting things
     *
     * Expected behavior:
     * - Create multiple things, then delete them to create "garbage"
     * - compact() should squash history and return stats
     * - thingsCompacted should reflect versions removed
     */
    it('compacts DO storage after create/delete cycles', async () => {
      // Create and delete things to create garbage
      for (let i = 0; i < 5; i++) {
        const thing = await stub.thingsCreate({ $type: 'Temp', name: `temp-${i}` })
        await stub.thingsDelete(thing.$id)
      }

      // Create things we want to keep
      await stub.thingsCreate({ $type: 'Keeper', name: 'keeper-1' })
      await stub.thingsCreate({ $type: 'Keeper', name: 'keeper-2' })

      // Compact
      const result = await stub.compact()

      expect(result).toBeDefined()
      expect(typeof result.thingsCompacted).toBe('number')
      expect(result.thingsCompacted).toBeGreaterThanOrEqual(0)
      expect(typeof result.actionsArchived).toBe('number')
      expect(typeof result.eventsArchived).toBe('number')
    })

    /**
     * Test: Compact removes old versions but keeps latest
     *
     * Expected behavior:
     * - Create thing, update it multiple times
     * - compact() should keep only the latest version
     * - All updates should be squashed to current state
     */
    it('keeps only latest version after compact', async () => {
      // Create a thing and update it multiple times
      const thing = await stub.thingsCreate({
        $type: 'Versioned',
        name: 'original',
        data: { version: 1 },
      })

      // Update multiple times to create version history
      await stub.thingsUpdate(thing.$id, { data: { version: 2 } })
      await stub.thingsUpdate(thing.$id, { data: { version: 3 } })
      await stub.thingsUpdate(thing.$id, { data: { version: 4 } })
      await stub.thingsUpdate(thing.$id, { name: 'final', data: { version: 5 } })

      // Compact
      const result = await stub.compact()

      // Verify compaction happened
      expect(result.thingsCompacted).toBeGreaterThanOrEqual(0)

      // Verify latest version is preserved
      const retrieved = await stub.thingsGet(thing.$id)
      expect(retrieved).not.toBeNull()
      expect(retrieved!.name).toBe('final')
      expect((retrieved!.data as { version: number })?.version).toBe(5)
    })

    /**
     * Test: Compact handles empty state
     *
     * Expected behavior:
     * - compact() on empty DO should throw an error
     * - Error message should indicate nothing to compact
     */
    it('throws error when nothing to compact', async () => {
      // DO is empty - compact should fail
      await expect(stub.compact()).rejects.toThrow(/nothing to compact/i)
    })

    /**
     * Test: Compact is idempotent
     *
     * Expected behavior:
     * - After first compact, subsequent compact should have nothing to do
     * - thingsCompacted should be 0 on second call
     */
    it('is idempotent - second compact has nothing to do', async () => {
      // Create some things
      await stub.thingsCreate({ $type: 'Item', name: 'item-1' })
      await stub.thingsCreate({ $type: 'Item', name: 'item-2' })

      // First compact
      const first = await stub.compact()
      expect(first).toBeDefined()

      // Second compact should have nothing to do
      const second = await stub.compact()
      expect(second.thingsCompacted).toBe(0)
    })

    /**
     * Test: Compact preserves non-deleted things
     *
     * Expected behavior:
     * - Create multiple things, delete some
     * - compact() should preserve all non-deleted things
     * - List should return only the kept things
     */
    it('preserves non-deleted things', async () => {
      // Create things
      const keep1 = await stub.thingsCreate({ $type: 'Keep', name: 'keep-1' })
      const keep2 = await stub.thingsCreate({ $type: 'Keep', name: 'keep-2' })
      const del1 = await stub.thingsCreate({ $type: 'Delete', name: 'delete-1' })
      const del2 = await stub.thingsCreate({ $type: 'Delete', name: 'delete-2' })

      // Delete some
      await stub.thingsDelete(del1.$id)
      await stub.thingsDelete(del2.$id)

      // Compact
      await stub.compact()

      // Verify kept things are preserved
      expect(await stub.thingsGet(keep1.$id)).not.toBeNull()
      expect(await stub.thingsGet(keep2.$id)).not.toBeNull()

      // Verify deleted things stay deleted
      expect(await stub.thingsGet(del1.$id)).toBeNull()
      expect(await stub.thingsGet(del2.$id)).toBeNull()

      // Verify list returns only kept things
      const keeps = await stub.thingsList({ type: 'Keep' })
      expect(keeps.length).toBe(2)
    })

    /**
     * Test: Compact archives to R2 when available
     *
     * Expected behavior:
     * - If R2 binding exists, compact should archive old data
     * - Archives should be stored in archives/{ns}/things/{timestamp}.json
     */
    it('archives old data before compacting', async () => {
      // Create things with multiple versions
      const thing = await stub.thingsCreate({
        $type: 'Archive',
        name: 'v1',
        data: { version: 1 },
      })
      await stub.thingsUpdate(thing.$id, { name: 'v2', data: { version: 2 } })
      await stub.thingsUpdate(thing.$id, { name: 'v3', data: { version: 3 } })

      // Compact
      const result = await stub.compact()

      // Should have compacted versions
      expect(result.thingsCompacted).toBeGreaterThanOrEqual(2)

      // Note: Actual R2 archive verification would require R2 access
      // This test verifies the operation completes successfully
    })
  })

  // ==========================================================================
  // merge() Tests
  // ==========================================================================

  describe('merge()', () => {
    /**
     * Test: Basic merge of feature branch to main
     *
     * Expected behavior:
     * - Create branch, make changes, merge back
     * - Changes from branch should appear in main
     */
    it('merges branch changes back to main', async () => {
      // Create initial state on main
      const mainThing = await stub.thingsCreate({
        $type: 'Doc',
        name: 'main-doc',
        data: { source: 'main' },
      })

      // Create feature branch
      const branchResult = await stub.branch('feature')
      expect(branchResult.created).toBe(true)

      // Switch to feature branch
      await stub.checkout('feature')

      // Make changes on feature branch
      const featureThing = await stub.thingsCreate({
        $type: 'Doc',
        name: 'feature-doc',
        data: { source: 'feature' },
      })

      // Switch back to main
      await stub.checkout('main')

      // Merge feature into main
      const mergeResult = await stub.merge('feature')

      expect(mergeResult.merged).toBe(true)
      expect(mergeResult.conflicts).toBeUndefined()

      // Verify feature changes are now on main
      const docs = await stub.thingsList({ type: 'Doc' })
      expect(docs.some((d) => d.name === 'feature-doc')).toBe(true)
    })

    /**
     * Test: Merge detects and reports conflicts
     *
     * Expected behavior:
     * - When same thing is modified differently on both branches
     * - merge() should return conflicts array
     * - merged should be false when conflicts exist
     */
    it('detects conflicts when same thing modified on both branches', async () => {
      // Create thing on main
      const thing = await stub.thingsCreate({
        $type: 'Shared',
        name: 'shared',
        data: { field: 'original' },
      })

      // Create and checkout feature branch
      await stub.branch('feature')
      await stub.checkout('feature')

      // Modify on feature branch
      await stub.thingsUpdate(thing.$id, { data: { field: 'feature-value' } })

      // Switch back to main
      await stub.checkout('main')

      // Modify same thing differently on main
      await stub.thingsUpdate(thing.$id, { data: { field: 'main-value' } })

      // Attempt merge - should detect conflict
      const mergeResult = await stub.merge('feature')

      expect(mergeResult.merged).toBe(false)
      expect(mergeResult.conflicts).toBeDefined()
      expect(mergeResult.conflicts!.length).toBeGreaterThan(0)
      expect(mergeResult.conflicts!.some((c) => c.includes(thing.$id))).toBe(true)
    })

    /**
     * Test: Merge fails when branch doesn't exist
     *
     * Expected behavior:
     * - merge() with non-existent branch should throw error
     */
    it('throws error for non-existent branch', async () => {
      // Create something so DO has state
      await stub.thingsCreate({ $type: 'Doc', name: 'doc' })

      // Attempt to merge non-existent branch
      await expect(stub.merge('non-existent')).rejects.toThrow(/branch not found/i)
    })

    /**
     * Test: Cannot merge branch into itself
     *
     * Expected behavior:
     * - merge('main') while on main should throw error
     */
    it('throws error when merging branch into itself', async () => {
      // Create something so DO has state
      await stub.thingsCreate({ $type: 'Doc', name: 'doc' })

      // Attempt to merge main into main
      await expect(stub.merge('main')).rejects.toThrow(/cannot merge branch into itself/i)
    })

    /**
     * Test: Non-conflicting changes merge cleanly
     *
     * Expected behavior:
     * - When different fields are modified on different branches
     * - merge() should combine changes without conflict
     */
    it('merges non-conflicting field changes', async () => {
      // Create thing on main
      const thing = await stub.thingsCreate({
        $type: 'MultiField',
        name: 'base',
        data: { fieldA: 'original-a', fieldB: 'original-b' },
      })

      // Create and checkout feature branch
      await stub.branch('feature')
      await stub.checkout('feature')

      // Modify fieldA on feature
      await stub.thingsUpdate(thing.$id, {
        data: { fieldA: 'feature-a', fieldB: 'original-b' },
      })

      // Switch back to main
      await stub.checkout('main')

      // Modify fieldB on main (different field - no conflict)
      await stub.thingsUpdate(thing.$id, {
        data: { fieldA: 'original-a', fieldB: 'main-b' },
      })

      // Merge should succeed
      const mergeResult = await stub.merge('feature')

      expect(mergeResult.merged).toBe(true)

      // Both changes should be present
      const merged = await stub.thingsGet(thing.$id)
      const mergedData = merged!.data as { fieldA: string; fieldB: string }
      expect(mergedData.fieldA).toBe('feature-a')
      expect(mergedData.fieldB).toBe('main-b')
    })

    /**
     * Test: Merge includes new things from source branch
     *
     * Expected behavior:
     * - Things created on feature branch should appear after merge
     */
    it('includes new things from source branch', async () => {
      // Create thing on main
      await stub.thingsCreate({ $type: 'Main', name: 'main-only' })

      // Create feature branch and add new things
      await stub.branch('feature')
      await stub.checkout('feature')

      await stub.thingsCreate({ $type: 'Feature', name: 'feature-1' })
      await stub.thingsCreate({ $type: 'Feature', name: 'feature-2' })

      // Switch back and merge
      await stub.checkout('main')
      const result = await stub.merge('feature')

      expect(result.merged).toBe(true)

      // Feature things should now be on main
      const featureThings = await stub.thingsList({ type: 'Feature' })
      expect(featureThings.length).toBe(2)
    })
  })

  // ==========================================================================
  // Branch and Checkout Tests (Prerequisites for Merge)
  // ==========================================================================

  describe('branch() and checkout()', () => {
    /**
     * Test: Create a new branch
     */
    it('creates a new branch', async () => {
      // Create initial state
      await stub.thingsCreate({ $type: 'Doc', name: 'doc' })

      // Create branch
      const result = await stub.branch('feature')

      expect(result.name).toBe('feature')
      expect(result.created).toBe(true)
    })

    /**
     * Test: Cannot create branch with empty name
     */
    it('throws error for empty branch name', async () => {
      await stub.thingsCreate({ $type: 'Doc', name: 'doc' })
      await expect(stub.branch('')).rejects.toThrow(/cannot be empty/i)
    })

    /**
     * Test: Cannot create branch named 'main'
     */
    it('throws error when creating branch named main', async () => {
      await stub.thingsCreate({ $type: 'Doc', name: 'doc' })
      await expect(stub.branch('main')).rejects.toThrow(/reserved/i)
    })

    /**
     * Test: Checkout to existing branch
     */
    it('checks out to existing branch', async () => {
      await stub.thingsCreate({ $type: 'Doc', name: 'doc' })
      await stub.branch('feature')

      const result = await stub.checkout('feature')

      expect(result.ref).toBe('feature')
    })

    /**
     * Test: Checkout to non-existent branch throws error
     */
    it('throws error when checking out non-existent branch', async () => {
      await stub.thingsCreate({ $type: 'Doc', name: 'doc' })
      await expect(stub.checkout('non-existent')).rejects.toThrow(/not found/i)
    })
  })

  // ==========================================================================
  // Integration Tests
  // ==========================================================================

  describe('compact() and merge() integration', () => {
    /**
     * Test: Compact after merge preserves merged state
     */
    it('compact after merge preserves merged state', async () => {
      // Setup: create state on main
      const mainThing = await stub.thingsCreate({
        $type: 'Int',
        name: 'main-thing',
        data: { source: 'main' },
      })

      // Create branch and add things
      await stub.branch('feature')
      await stub.checkout('feature')

      await stub.thingsCreate({
        $type: 'Int',
        name: 'feature-thing',
        data: { source: 'feature' },
      })

      // Merge
      await stub.checkout('main')
      await stub.merge('feature')

      // Compact
      const compactResult = await stub.compact()
      expect(compactResult).toBeDefined()

      // Verify all things preserved
      const allThings = await stub.thingsList({ type: 'Int' })
      expect(allThings.length).toBe(2)
      expect(allThings.some((t) => t.name === 'main-thing')).toBe(true)
      expect(allThings.some((t) => t.name === 'feature-thing')).toBe(true)
    })

    /**
     * Test: Multiple branches can be created and merged
     */
    it('supports multiple feature branches', async () => {
      // Initial state
      await stub.thingsCreate({ $type: 'Base', name: 'base' })

      // Create and populate feature-a
      await stub.branch('feature-a')
      await stub.checkout('feature-a')
      await stub.thingsCreate({ $type: 'A', name: 'from-a' })

      // Switch back to main, create feature-b
      await stub.checkout('main')
      await stub.branch('feature-b')
      await stub.checkout('feature-b')
      await stub.thingsCreate({ $type: 'B', name: 'from-b' })

      // Merge both back to main
      await stub.checkout('main')
      await stub.merge('feature-a')
      await stub.merge('feature-b')

      // Verify all things exist
      const aThings = await stub.thingsList({ type: 'A' })
      const bThings = await stub.thingsList({ type: 'B' })
      expect(aThings.length).toBe(1)
      expect(bThings.length).toBe(1)
    })
  })
})
