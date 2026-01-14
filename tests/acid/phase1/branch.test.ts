/**
 * ACID Test Suite - Phase 1: branch() - Create Branch Operation
 *
 * RED TDD: These tests define the expected behavior for branch() operation.
 * All tests are expected to FAIL initially as this is the RED phase.
 *
 * The branch() operation creates a new branch at current HEAD:
 * - Validates branch name (no empty, no spaces, not "main")
 * - Prevents duplicate branch names
 * - Requires commits on current branch
 * - Records forkedFrom relationship
 * - Emits lifecycle events
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

interface BranchResult {
  /** Name of the created branch */
  name: string
  /** HEAD position of the new branch */
  head: number
  /** Branch this was forked from */
  forkedFrom: string
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

type BranchEventType =
  | 'branch.created'
  | 'branch.error'

interface BranchEvent {
  type: BranchEventType
  timestamp: Date
  data: {
    name: string
    head?: number
    forkedFrom?: string
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

describe('branch() - Create Branch Operation', () => {
  let result: MockDOResult<DO, MockEnv>
  let capturedEvents: BranchEvent[]
  const sourceNs = 'https://source.test.do'

  beforeEach(() => {
    capturedEvents = []

    result = createMockDO(DO, {
      ns: sourceNs,
      sqlData: new Map([
        ['things', [
          createSampleThing({ id: 'thing-001', name: 'Initial Thing', rowid: 1 }),
          createSampleThing({ id: 'thing-002', name: 'Second Thing', rowid: 2 }),
          createSampleThing({ id: 'thing-003', name: 'Third Thing', rowid: 3 }),
        ]],
        ['branches', [
          createBranchRecord({ name: 'main', head: 3 }),
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
        type: verb as BranchEventType,
        timestamp: new Date(),
        data: data as BranchEvent['data'],
      })
      return originalEmit?.call(result.instance, verb, data)
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // BASIC BRANCH CREATION
  // ==========================================================================

  describe('basic functionality', () => {
    it('creates branch at current HEAD', async () => {
      // RED: Branch should be created at current HEAD
      const branchResult = await result.instance.branch('feature')

      expect(branchResult).toBeDefined()
      expect(branchResult.name).toBe('feature')
      expect(branchResult.head).toBe(3) // Current HEAD on main
    })

    it('records forkedFrom correctly', async () => {
      // RED: New branch should record parent branch
      const branchResult = await result.instance.branch('feature')

      expect(branchResult.forkedFrom).toBe('main')
    })

    it('adds branch to branches table', async () => {
      // RED: Branch should be persisted
      await result.instance.branch('feature')

      const branches = result.sqlData.get('branches') as BranchRecord[]
      const newBranch = branches.find(b => b.name === 'feature')

      expect(newBranch).toBeDefined()
      expect(newBranch?.head).toBe(3)
      expect(newBranch?.forkedFrom).toBe('main')
    })

    it('allows creating multiple branches', async () => {
      // RED: Should allow creating multiple branches from same HEAD
      await result.instance.branch('feature-a')
      await result.instance.branch('feature-b')

      const branches = result.sqlData.get('branches') as BranchRecord[]
      expect(branches.filter(b => b.forkedFrom === 'main').length).toBe(2)
    })
  })

  // ==========================================================================
  // NAME VALIDATION
  // ==========================================================================

  describe('name validation', () => {
    it('throws error for empty name', async () => {
      // RED: Empty name should be rejected
      await expect(
        result.instance.branch('')
      ).rejects.toThrow(/empty|required/i)
    })

    it('throws error for whitespace-only name', async () => {
      // RED: Whitespace-only name should be rejected
      await expect(
        result.instance.branch('   ')
      ).rejects.toThrow(/empty|required|whitespace/i)
    })

    it('throws error for name with spaces', async () => {
      // RED: Names with spaces should be rejected
      await expect(
        result.instance.branch('my feature')
      ).rejects.toThrow(/space/i)
    })

    it('throws error for "main" name', async () => {
      // RED: "main" is reserved and cannot be created
      await expect(
        result.instance.branch('main')
      ).rejects.toThrow(/reserved|main/i)
    })

    it('accepts hyphenated names', async () => {
      // RED: Hyphenated names should work
      const branchResult = await result.instance.branch('feature-branch-name')

      expect(branchResult.name).toBe('feature-branch-name')
    })

    it('accepts underscored names', async () => {
      // RED: Underscored names should work
      const branchResult = await result.instance.branch('feature_branch_name')

      expect(branchResult.name).toBe('feature_branch_name')
    })

    it('accepts numeric suffixes', async () => {
      // RED: Names with numbers should work
      const branchResult = await result.instance.branch('feature-123')

      expect(branchResult.name).toBe('feature-123')
    })
  })

  // ==========================================================================
  // DUPLICATE PREVENTION
  // ==========================================================================

  describe('duplicate prevention', () => {
    it('throws error for duplicate branch name', async () => {
      // RED: Cannot create branch with existing name
      await result.instance.branch('feature')

      await expect(
        result.instance.branch('feature')
      ).rejects.toThrow(/exist|duplicate|already/i)
    })

    it('allows same name after previous branch is deleted', async () => {
      // RED: Can reuse name after branch deletion
      await result.instance.branch('temp-branch')

      // Delete the branch
      const branches = result.sqlData.get('branches') as BranchRecord[]
      const idx = branches.findIndex(b => b.name === 'temp-branch')
      if (idx !== -1) branches.splice(idx, 1)

      // Should now be able to create again
      const branchResult = await result.instance.branch('temp-branch')
      expect(branchResult.name).toBe('temp-branch')
    })
  })

  // ==========================================================================
  // COMMIT REQUIREMENT
  // ==========================================================================

  describe('commit requirement', () => {
    it('throws error when no commits on current branch', async () => {
      // RED: Cannot branch from empty state
      result.sqlData.set('things', [])

      await expect(
        result.instance.branch('feature')
      ).rejects.toThrow(/commit|empty|no.*things/i)
    })

    it('throws error when all things are deleted', async () => {
      // RED: Only deleted things = no valid commits
      result.sqlData.set('things', [
        createSampleThing({ id: 'deleted-1', deleted: true, rowid: 1 }),
        createSampleThing({ id: 'deleted-2', deleted: true, rowid: 2 }),
      ])

      await expect(
        result.instance.branch('feature')
      ).rejects.toThrow(/commit|empty|deleted/i)
    })

    it('creates branch when there are valid commits', async () => {
      // RED: Should work with at least one valid commit
      result.sqlData.set('things', [
        createSampleThing({ id: 'valid-thing', rowid: 1 }),
      ])

      const branchResult = await result.instance.branch('feature')
      expect(branchResult).toBeDefined()
    })
  })

  // ==========================================================================
  // ACID PROPERTIES
  // ==========================================================================

  describe('ACID properties', () => {
    it('is atomic - branch creation is all-or-nothing', async () => {
      // RED: If creation fails, no branch should exist
      const branchesCountBefore = (result.sqlData.get('branches') as BranchRecord[]).length

      await expect(
        result.instance.branch('')
      ).rejects.toThrow()

      const branchesCountAfter = (result.sqlData.get('branches') as BranchRecord[]).length
      expect(branchesCountAfter).toBe(branchesCountBefore)
    })

    it('maintains consistency - branch state is valid after creation', async () => {
      // RED: Branch should have valid state
      await result.instance.branch('feature')

      const branches = result.sqlData.get('branches') as BranchRecord[]
      const newBranch = branches.find(b => b.name === 'feature')

      expect(newBranch?.head).toBeGreaterThan(0)
      expect(newBranch?.forkedFrom).toBe('main')
      expect(newBranch?.createdAt).toBeInstanceOf(Date)
    })

    it('provides isolation - concurrent branch creations do not interfere', async () => {
      // RED: Two concurrent creations should both succeed or fail cleanly
      const [branch1, branch2] = await Promise.all([
        result.instance.branch('feature-1'),
        result.instance.branch('feature-2'),
      ])

      expect(branch1.name).toBe('feature-1')
      expect(branch2.name).toBe('feature-2')

      const branches = result.sqlData.get('branches') as BranchRecord[]
      expect(branches.filter(b => b.name.startsWith('feature-')).length).toBe(2)
    })

    it('ensures durability - branch persists after creation', async () => {
      // RED: Branch should be in storage
      await result.instance.branch('feature')

      const branches = result.sqlData.get('branches') as BranchRecord[]
      expect(branches.some(b => b.name === 'feature')).toBe(true)
    })
  })

  // ==========================================================================
  // EVENT EMISSION
  // ==========================================================================

  describe('events', () => {
    it('emits branch.created event', async () => {
      // RED: Should emit creation event
      await result.instance.branch('feature')

      const createdEvent = capturedEvents.find(e => e.type === 'branch.created')
      expect(createdEvent).toBeDefined()
      expect(createdEvent?.data.name).toBe('feature')
    })

    it('includes HEAD position in event', async () => {
      // RED: Event should have HEAD info
      await result.instance.branch('feature')

      const createdEvent = capturedEvents.find(e => e.type === 'branch.created')
      expect(createdEvent?.data.head).toBe(3)
    })

    it('includes forkedFrom in event', async () => {
      // RED: Event should have parent branch info
      await result.instance.branch('feature')

      const createdEvent = capturedEvents.find(e => e.type === 'branch.created')
      expect(createdEvent?.data.forkedFrom).toBe('main')
    })
  })

  // ==========================================================================
  // BRANCHING FROM BRANCHES
  // ==========================================================================

  describe('branching from branches', () => {
    it('allows creating branch from non-main branch', async () => {
      // RED: Should allow nested branching
      // First create a feature branch
      await result.instance.branch('feature')

      // Checkout feature (simulate)
      // Add things on feature branch
      result.sqlData.get('things')!.push(
        createSampleThing({ id: 'feature-thing', branch: 'feature', rowid: 10 })
      )

      // Update branches to set feature as current
      const branches = result.sqlData.get('branches') as BranchRecord[]
      const featureBranch = branches.find(b => b.name === 'feature')
      if (featureBranch) featureBranch.head = 10

      // Now create sub-branch from feature
      // (This requires checkout to feature first in real implementation)
      // For now, we test the creation succeeds
      const subBranch = await result.instance.branch('feature-sub')

      expect(subBranch).toBeDefined()
    })
  })

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('edge cases', () => {
    it('handles very long branch names', async () => {
      // RED: Should handle long names (within limits)
      const longName = 'feature-' + 'a'.repeat(200)

      const branchResult = await result.instance.branch(longName)
      expect(branchResult.name).toBe(longName)
    })

    it('handles special characters in allowed positions', async () => {
      // RED: Hyphens and underscores should be allowed
      const branchResult = await result.instance.branch('feature-test_123')
      expect(branchResult.name).toBe('feature-test_123')
    })

    it('handles rapid branch creation', async () => {
      // RED: Should handle many branches quickly
      const branchNames = Array.from({ length: 100 }, (_, i) => `branch-${i}`)

      for (const name of branchNames) {
        await result.instance.branch(name)
      }

      const branches = result.sqlData.get('branches') as BranchRecord[]
      expect(branches.length).toBe(101) // 100 + main
    })
  })
})
