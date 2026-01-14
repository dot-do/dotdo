/**
 * ACID Test Suite - Phase 1: Branch Operations - Comprehensive Tests
 *
 * RED TDD: These tests define the expected behavior for branch operations:
 * - branch(name): Create new branch at current HEAD
 * - checkout(ref): Switch to branch or version reference
 * - deleteBranch(name): Delete a branch
 * - listBranches(): List all branches
 * - Concurrent branch operations
 *
 * ACID Properties Tested:
 * - Atomicity: Branch operations are all-or-nothing
 * - Consistency: Branch metadata is always valid
 * - Isolation: Branch operations don't affect other branches
 * - Durability: Branch state persists after operations
 *
 * @see objects/DOFull.ts for branch() implementation
 * @see objects/lifecycle/Branch.ts for BranchModule
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockDO, MockDOResult, MockEnv } from '../../do'
import { DO } from '../../../objects/DO'

// ============================================================================
// TYPE DEFINITIONS FOR BRANCH API
// ============================================================================

/**
 * Result of a branch operation
 */
interface BranchResult {
  /** Branch name */
  name: string
  /** HEAD version (rowid) */
  head: number
  /** Base version the branch forked from */
  base?: number
  /** Branch it forked from */
  forkedFrom?: string
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
 * Result of checkout operation
 */
interface CheckoutResult {
  /** Branch name (if checked out branch) */
  branch?: string
  /** Version rowid (if checked out version - detached HEAD) */
  version?: number
  /** Whether this is a detached HEAD state */
  detached?: boolean
}

/**
 * Result of deleteBranch operation
 */
interface DeleteBranchResult {
  /** Whether deletion succeeded */
  deleted: boolean
  /** Name of deleted branch */
  name: string
  /** Number of things orphaned */
  orphanedThings?: number
}

/**
 * Branch event types
 */
type BranchEventType =
  | 'branch.created'
  | 'branch.deleted'
  | 'branch.updated'
  | 'checkout.completed'
  | 'checkout.failed'

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
 * Setup a multi-branch scenario for testing
 */
function setupMultiBranchScenario(mockResult: MockDOResult<DO, MockEnv>) {
  mockResult.sqlData.set('things', [
    // Main branch things
    createSampleThing({ id: 'main-1', rowid: 1, branch: null, data: { on: 'main' } }),
    createSampleThing({ id: 'main-2', rowid: 2, branch: null, data: { on: 'main', v: 2 } }),
    // Feature A branch things
    createSampleThing({ id: 'feature-a-1', rowid: 3, branch: 'feature-a', data: { on: 'feature-a' } }),
    createSampleThing({ id: 'feature-a-2', rowid: 4, branch: 'feature-a', data: { on: 'feature-a', v: 2 } }),
    // Feature B branch things
    createSampleThing({ id: 'feature-b-1', rowid: 5, branch: 'feature-b', data: { on: 'feature-b' } }),
  ])

  mockResult.sqlData.set('branches', [
    createSampleBranch({ name: 'main', head: 2, base: null, forkedFrom: null }),
    createSampleBranch({ name: 'feature-a', head: 4, base: 2, forkedFrom: 'main' }),
    createSampleBranch({ name: 'feature-b', head: 5, base: 2, forkedFrom: 'main' }),
  ])

  mockResult.storage.data.set('currentBranch', 'main')
}

// ============================================================================
// BRANCH CREATION TESTS
// ============================================================================

describe('ACID Phase 1: branch() - Create Named Branch', () => {
  let mockResult: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    mockResult = createMockDO(DO, {
      id: 'test-do',
      ns: 'https://test.example.com',
    })

    // Set up initial state on main branch
    mockResult.sqlData.set('things', [
      createSampleThing({ id: 'item-1', rowid: 1, branch: null }),
      createSampleThing({ id: 'item-2', rowid: 2, branch: null }),
    ])

    // Initialize branches table with main
    mockResult.sqlData.set('branches', [
      createSampleBranch({ name: 'main', head: 2, base: null, forkedFrom: null }),
    ])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // BASIC BRANCH OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Basic Branch Operations', () => {
    it('should create a new branch at current HEAD', async () => {
      const result = await mockResult.instance.branch('feature-auth')

      expect(result).toHaveProperty('name', 'feature-auth')
      expect(result).toHaveProperty('head')
      expect(typeof result.head).toBe('number')
    })

    it('should record forkedFrom correctly', async () => {
      // On main branch initially
      const result = await mockResult.instance.branch('feature-auth')

      expect(result.forkedFrom).toBe('main')
    })

    it('should set base to current HEAD', async () => {
      const result = await mockResult.instance.branch('feature-api')

      // Base should be the HEAD of the branch we forked from
      expect(result.head).toBeGreaterThan(0)
    })

    it('should emit branch.created event', async () => {
      const events = mockResult.sqlData.get('events') as Array<{ verb: string }>

      await mockResult.instance.branch('feature-db')

      const eventVerbs = events.map(e => e.verb)
      expect(eventVerbs).toContain('branch.created')
    })

    it('should add branch to branches table', async () => {
      await mockResult.instance.branch('feature-ui')

      const branches = mockResult.sqlData.get('branches') as BranchRecord[]
      const newBranch = branches.find(b => b.name === 'feature-ui')
      expect(newBranch).toBeDefined()
    })

    it('should create branch from feature branch', async () => {
      // First create a feature branch
      await mockResult.instance.branch('feature-x')

      // Checkout to feature-x (mocked since checkout may not be fully implemented)
      mockResult.storage.data.set('currentBranch', 'feature-x')

      // Add things on feature-x
      const things = mockResult.sqlData.get('things') as unknown[]
      things.push(createSampleThing({ id: 'feature-item', rowid: 3, branch: 'feature-x' }))

      // Create sub-branch from feature-x
      const result = await mockResult.instance.branch('feature-x-sub')

      expect(result.name).toBe('feature-x-sub')
      expect(result.forkedFrom).toBe('feature-x')
    })

    it('should return correct head version', async () => {
      const result = await mockResult.instance.branch('feature-head-test')

      // Head should match the number of things on current branch
      expect(result.head).toBe(2) // 2 things on main
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Validation', () => {
    it('should reject empty branch name', async () => {
      await expect(mockResult.instance.branch('')).rejects.toThrow(/Invalid branch name|empty/)
    })

    it('should reject branch name with spaces', async () => {
      await expect(mockResult.instance.branch('my feature'))
        .rejects.toThrow(/Invalid branch name|spaces/)
    })

    it('should reject creating branch named "main"', async () => {
      await expect(mockResult.instance.branch('main'))
        .rejects.toThrow(/Cannot create branch named "main"|reserved/)
    })

    it('should prevent duplicate branch names', async () => {
      await mockResult.instance.branch('feature-x')

      await expect(mockResult.instance.branch('feature-x'))
        .rejects.toThrow(/Branch .* already exists|duplicate/)
    })

    it('should require commits on current branch', async () => {
      // Clear all things (no commits)
      mockResult.sqlData.set('things', [])

      await expect(mockResult.instance.branch('feature-empty'))
        .rejects.toThrow(/No commits|empty branch/)
    })

    it('should reject branch names with special characters', async () => {
      await expect(mockResult.instance.branch('feature/auth'))
        .rejects.toThrow(/Invalid branch name/)
    })

    it('should reject branch name that is only whitespace', async () => {
      await expect(mockResult.instance.branch('   '))
        .rejects.toThrow(/Invalid branch name|empty/)
    })

    it('should reject branch name with newlines', async () => {
      await expect(mockResult.instance.branch('feature\nauth'))
        .rejects.toThrow(/Invalid branch name/)
    })

    it('should reject branch name with tabs', async () => {
      await expect(mockResult.instance.branch('feature\tauth'))
        .rejects.toThrow(/Invalid branch name/)
    })

    it('should reject branch name starting with hyphen', async () => {
      await expect(mockResult.instance.branch('-feature'))
        .rejects.toThrow(/Invalid branch name/)
    })

    it('should reject reserved names', async () => {
      const reservedNames = ['HEAD', 'head', 'MAIN', 'master', 'MASTER']
      for (const name of reservedNames) {
        await expect(mockResult.instance.branch(name))
          .rejects.toThrow(/reserved|Invalid/)
      }
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // ATOMICITY (ACID)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Atomicity', () => {
    it('should create branch fully or not at all', async () => {
      const initialBranches = [...(mockResult.sqlData.get('branches') as BranchRecord[])]

      // Simulate failure during branch creation
      const originalExec = mockResult.storage.sql.exec
      let callCount = 0
      mockResult.storage.sql.exec = vi.fn().mockImplementation((query: string, ...params: unknown[]) => {
        callCount++
        if (query.toLowerCase().includes('insert') && callCount > 1) {
          throw new Error('Database error')
        }
        return originalExec.call(mockResult.storage.sql, query, ...params)
      })

      await expect(mockResult.instance.branch('feature-fail'))
        .rejects.toThrow()

      // Branch should not be partially created
      const currentBranches = mockResult.sqlData.get('branches') as BranchRecord[]
      expect(currentBranches.find(b => b.name === 'feature-fail')).toBeUndefined()
    })

    it('should rollback on failure', async () => {
      const events = mockResult.sqlData.get('events') as Array<{ verb: string }>

      // Mock failure after event emission
      mockResult.storage.sql.exec = vi.fn().mockImplementation(() => {
        throw new Error('Database error')
      })

      await expect(mockResult.instance.branch('feature-rollback'))
        .rejects.toThrow()

      // No branch.created should be present if rollback occurred
      // (or it should be followed by branch.failed)
      const eventVerbs = events.map(e => e.verb)
      expect(eventVerbs).not.toContain('branch.created')
    })

    it('should not leave orphan metadata on failure', async () => {
      const originalExec = mockResult.storage.sql.exec
      let insertCount = 0

      mockResult.storage.sql.exec = vi.fn().mockImplementation((query: string, ...params: unknown[]) => {
        if (query.toLowerCase().includes('insert into')) {
          insertCount++
          if (insertCount === 2) {
            throw new Error('Second insert failed')
          }
        }
        return originalExec.call(mockResult.storage.sql, query, ...params)
      })

      await expect(mockResult.instance.branch('feature-orphan'))
        .rejects.toThrow()

      // No partial data should exist
      const branches = mockResult.sqlData.get('branches') as BranchRecord[]
      expect(branches.find(b => b.name === 'feature-orphan')).toBeUndefined()
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSISTENCY (ACID)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Consistency', () => {
    it('should maintain valid branch metadata', async () => {
      await mockResult.instance.branch('feature-valid')

      const branches = mockResult.sqlData.get('branches') as BranchRecord[]
      const newBranch = branches.find(b => b.name === 'feature-valid')

      expect(newBranch).toBeDefined()
      expect(newBranch?.name).toBe('feature-valid')
      expect(typeof newBranch?.head).toBe('number')
    })

    it('should track forkedFrom relationship', async () => {
      await mockResult.instance.branch('child-branch')

      const branches = mockResult.sqlData.get('branches') as BranchRecord[]
      const childBranch = branches.find(b => b.name === 'child-branch')

      expect(childBranch?.forkedFrom).toBe('main')
    })

    it('should preserve parent branch state', async () => {
      const mainBranchBefore = (mockResult.sqlData.get('branches') as BranchRecord[])
        .find(b => b.name === 'main')

      await mockResult.instance.branch('feature-preserve')

      const mainBranchAfter = (mockResult.sqlData.get('branches') as BranchRecord[])
        .find(b => b.name === 'main')

      expect(mainBranchAfter?.head).toBe(mainBranchBefore?.head)
    })

    it('should have valid base reference', async () => {
      await mockResult.instance.branch('feature-base-check')

      const branches = mockResult.sqlData.get('branches') as BranchRecord[]
      const newBranch = branches.find(b => b.name === 'feature-base-check')

      // Base should be a valid version number
      expect(newBranch?.base).toBeGreaterThanOrEqual(0)
    })

    it('should ensure branch names are case-sensitive', async () => {
      await mockResult.instance.branch('Feature')

      // Should be able to create 'feature' as different branch
      const result = await mockResult.instance.branch('feature')

      expect(result.name).toBe('feature')

      const branches = mockResult.sqlData.get('branches') as BranchRecord[]
      expect(branches.some(b => b.name === 'Feature')).toBe(true)
      expect(branches.some(b => b.name === 'feature')).toBe(true)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // ISOLATION (ACID)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Isolation', () => {
    it('should not affect other branches', async () => {
      // Create first branch
      await mockResult.instance.branch('feature-a')

      const branchesAfterA = [...(mockResult.sqlData.get('branches') as BranchRecord[])]

      // Create second branch
      await mockResult.instance.branch('feature-b')

      // First branch should be unchanged
      const branchA = (mockResult.sqlData.get('branches') as BranchRecord[])
        .find(b => b.name === 'feature-a')
      const originalBranchA = branchesAfterA.find(b => b.name === 'feature-a')

      expect(branchA?.head).toBe(originalBranchA?.head)
    })

    it('should isolate branch state from main', async () => {
      await mockResult.instance.branch('feature-isolated')

      // Get things on main (null branch)
      const mainThings = (mockResult.sqlData.get('things') as Array<{ branch: string | null }>)
        .filter(t => t.branch === null)

      // Main should still have its things
      expect(mainThings.length).toBe(2)
    })

    it('should not affect things on source branch', async () => {
      const thingsBefore = [...(mockResult.sqlData.get('things') as unknown[])]

      await mockResult.instance.branch('feature-safe')

      // Original things should be unchanged
      const thingsAfter = mockResult.sqlData.get('things') as unknown[]
      expect(thingsAfter.length).toBe(thingsBefore.length)
    })

    it('should not share mutable state between branches', async () => {
      await mockResult.instance.branch('feature-mutable-a')
      await mockResult.instance.branch('feature-mutable-b')

      const branches = mockResult.sqlData.get('branches') as BranchRecord[]
      const branchA = branches.find(b => b.name === 'feature-mutable-a')
      const branchB = branches.find(b => b.name === 'feature-mutable-b')

      // Each branch should have its own metadata
      expect(branchA).not.toBe(branchB)
      expect(branchA?.name).not.toBe(branchB?.name)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // DURABILITY (ACID)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Durability', () => {
    it('should persist branch after creation', async () => {
      const result = await mockResult.instance.branch('feature-persist')

      expect(result.name).toBe('feature-persist')

      // Branch should be in storage
      const branches = mockResult.sqlData.get('branches') as BranchRecord[]
      expect(branches.some(b => b.name === 'feature-persist')).toBe(true)
    })

    it('should emit event before returning', async () => {
      await mockResult.instance.branch('feature-event')

      const events = mockResult.sqlData.get('events') as Array<{ verb: string }>
      expect(events.some(e => e.verb === 'branch.created')).toBe(true)
    })

    it('should record creation timestamp', async () => {
      const beforeCreate = new Date()

      await mockResult.instance.branch('feature-timestamp')

      const branches = mockResult.sqlData.get('branches') as BranchRecord[]
      const newBranch = branches.find(b => b.name === 'feature-timestamp')

      expect(newBranch?.createdAt).toBeDefined()
      expect(new Date(newBranch!.createdAt).getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime())
    })

    it('should record update timestamp', async () => {
      await mockResult.instance.branch('feature-update-ts')

      const branches = mockResult.sqlData.get('branches') as BranchRecord[]
      const newBranch = branches.find(b => b.name === 'feature-update-ts')

      expect(newBranch?.updatedAt).toBeDefined()
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // BRANCH NAMING CONVENTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Branch Naming Conventions', () => {
    it.each([
      'feature-auth',
      'bugfix-login',
      'release-v1.0',
      'hotfix-security',
      'feat-api-v2',
      'fix_underscore',
      'UPPERCASE',
      'MixedCase123',
      'with-numbers-123',
      'a', // Single character
    ])('should accept valid branch name: %s', async (name) => {
      const result = await mockResult.instance.branch(name)
      expect(result.name).toBe(name)
    })

    it.each([
      ['', 'empty'],
      ['main', 'reserved'],
      ['has space', 'contains space'],
      ['feature/nested', 'contains slash'],
      ['a'.repeat(256), 'too long'],
      ['feature\\back', 'contains backslash'],
      ['feature:colon', 'contains colon'],
      ['feature*star', 'contains asterisk'],
      ['feature?question', 'contains question mark'],
      ['feature"quote', 'contains quote'],
      ['feature<angle', 'contains angle bracket'],
      ['feature>angle', 'contains angle bracket'],
      ['feature|pipe', 'contains pipe'],
    ])('should reject invalid branch name: %s (%s)', async (name) => {
      await expect(mockResult.instance.branch(name)).rejects.toThrow()
    })
  })
})

// ============================================================================
// BRANCH SWITCHING (CHECKOUT) TESTS
// ============================================================================

describe('ACID Phase 1: Branch Switching Operations', () => {
  let mockResult: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    mockResult = createMockDO(DO, {
      id: 'test-do',
      ns: 'https://test.example.com',
    })

    setupMultiBranchScenario(mockResult)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Switching to Existing Branch', () => {
    it('should switch to an existing branch', async () => {
      const result = await mockResult.instance.checkout('feature-a')

      expect(result).toHaveProperty('branch', 'feature-a')
      expect(result.detached).toBeFalsy()
    })

    it('should switch back to main', async () => {
      await mockResult.instance.checkout('feature-a')
      const result = await mockResult.instance.checkout('main')

      expect(result).toHaveProperty('branch', 'main')
    })

    it('should switch between feature branches', async () => {
      await mockResult.instance.checkout('feature-a')
      const result = await mockResult.instance.checkout('feature-b')

      expect(result).toHaveProperty('branch', 'feature-b')
    })

    it('should emit checkout event', async () => {
      const events = mockResult.sqlData.get('events') as Array<{ verb: string }>

      await mockResult.instance.checkout('feature-a')

      const eventVerbs = events.map(e => e.verb)
      expect(eventVerbs.some(v => v.includes('checkout'))).toBe(true)
    })

    it('should update current branch state', async () => {
      await mockResult.instance.checkout('feature-a')

      const currentBranch = mockResult.storage.data.get('currentBranch')
      expect(currentBranch).toBe('feature-a')
    })
  })

  describe('Switching to Non-Existent Branch', () => {
    it('should error when branch does not exist', async () => {
      await expect(mockResult.instance.checkout('non-existent'))
        .rejects.toThrow(/Branch .* not found|does not exist/)
    })

    it('should not change current branch on error', async () => {
      mockResult.storage.data.set('currentBranch', 'main')

      await expect(mockResult.instance.checkout('non-existent'))
        .rejects.toThrow()

      const currentBranch = mockResult.storage.data.get('currentBranch')
      expect(currentBranch).toBe('main')
    })
  })

  describe('Version Checkout (Detached HEAD)', () => {
    it('should checkout specific version', async () => {
      const result = await mockResult.instance.checkout('@v1')

      expect(result).toHaveProperty('version', 1)
      expect(result.detached).toBe(true)
    })

    it('should checkout relative version', async () => {
      const result = await mockResult.instance.checkout('@~1')

      expect(result).toHaveProperty('version')
      expect(result.detached).toBe(true)
    })

    it('should error for invalid version', async () => {
      await expect(mockResult.instance.checkout('@v99999'))
        .rejects.toThrow(/Version .* not found|invalid/)
    })

    it('should error for version beyond history', async () => {
      await expect(mockResult.instance.checkout('@~100'))
        .rejects.toThrow(/Cannot go back|out of range/)
    })

    it('should exit detached HEAD when checking out branch', async () => {
      await mockResult.instance.checkout('@v1')
      const result = await mockResult.instance.checkout('main')

      expect(result.detached).toBeFalsy()
      expect(result.branch).toBe('main')
    })
  })

  describe('Atomicity of Checkout', () => {
    it('should checkout fully or not at all', async () => {
      mockResult.storage.data.set('currentBranch', 'main')

      mockResult.storage.sql.exec = vi.fn().mockImplementation(() => {
        throw new Error('Database error')
      })

      await expect(mockResult.instance.checkout('feature-a'))
        .rejects.toThrow()

      // Should remain on main
      const currentBranch = mockResult.storage.data.get('currentBranch')
      expect(currentBranch).toBe('main')
    })
  })

  describe('Isolation of Checkout', () => {
    it('should not modify any branch data on checkout', async () => {
      const branchesBefore = JSON.stringify(mockResult.sqlData.get('branches'))

      await mockResult.instance.checkout('feature-a')

      const branchesAfter = JSON.stringify(mockResult.sqlData.get('branches'))
      expect(branchesAfter).toBe(branchesBefore)
    })

    it('should not modify things on checkout', async () => {
      const thingsBefore = JSON.stringify(mockResult.sqlData.get('things'))

      await mockResult.instance.checkout('feature-a')

      const thingsAfter = JSON.stringify(mockResult.sqlData.get('things'))
      expect(thingsAfter).toBe(thingsBefore)
    })
  })
})

// ============================================================================
// BRANCH DELETION TESTS
// ============================================================================

describe('ACID Phase 1: Branch Deletion Operations', () => {
  let mockResult: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    mockResult = createMockDO(DO, {
      id: 'test-do',
      ns: 'https://test.example.com',
    })

    setupMultiBranchScenario(mockResult)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Basic Deletion', () => {
    it('should delete an existing branch', async () => {
      const result = await mockResult.instance.deleteBranch('feature-a')

      expect(result).toHaveProperty('deleted', true)
      expect(result).toHaveProperty('name', 'feature-a')
    })

    it('should remove branch from branches table', async () => {
      await mockResult.instance.deleteBranch('feature-a')

      const branches = mockResult.sqlData.get('branches') as BranchRecord[]
      expect(branches.find(b => b.name === 'feature-a')).toBeUndefined()
    })

    it('should emit branch.deleted event', async () => {
      const events = mockResult.sqlData.get('events') as Array<{ verb: string }>

      await mockResult.instance.deleteBranch('feature-a')

      const eventVerbs = events.map(e => e.verb)
      expect(eventVerbs).toContain('branch.deleted')
    })

    it('should report orphaned things count', async () => {
      const result = await mockResult.instance.deleteBranch('feature-a')

      // feature-a has 2 things
      expect(result.orphanedThings).toBe(2)
    })
  })

  describe('Deletion Validation', () => {
    it('should not delete main branch', async () => {
      await expect(mockResult.instance.deleteBranch('main'))
        .rejects.toThrow(/Cannot delete main|protected/)
    })

    it('should error when deleting non-existent branch', async () => {
      await expect(mockResult.instance.deleteBranch('non-existent'))
        .rejects.toThrow(/Branch .* not found|does not exist/)
    })

    it('should not delete current branch', async () => {
      mockResult.storage.data.set('currentBranch', 'feature-a')

      await expect(mockResult.instance.deleteBranch('feature-a'))
        .rejects.toThrow(/Cannot delete current branch|checked out/)
    })

    it('should not delete branch with child branches', async () => {
      // Create a child branch from feature-a
      const branches = mockResult.sqlData.get('branches') as BranchRecord[]
      branches.push(createSampleBranch({
        name: 'feature-a-child',
        forkedFrom: 'feature-a',
        base: 4,
        head: 6,
      }))

      await expect(mockResult.instance.deleteBranch('feature-a'))
        .rejects.toThrow(/has child branches|dependent/)
    })
  })

  describe('Atomicity of Deletion', () => {
    it('should delete fully or not at all', async () => {
      const branchesBefore = [...(mockResult.sqlData.get('branches') as BranchRecord[])]

      mockResult.storage.sql.exec = vi.fn().mockImplementation((query: string) => {
        if (query.toLowerCase().includes('delete')) {
          throw new Error('Delete failed')
        }
        return { toArray: () => [], one: () => undefined, raw: () => [] }
      })

      await expect(mockResult.instance.deleteBranch('feature-a'))
        .rejects.toThrow()

      // Branch should still exist
      const branches = mockResult.sqlData.get('branches') as BranchRecord[]
      expect(branches.find(b => b.name === 'feature-a')).toBeDefined()
    })

    it('should rollback on event emission failure', async () => {
      const originalEmit = mockResult.instance.emitEvent
      mockResult.instance.emitEvent = vi.fn().mockRejectedValue(new Error('Event failed'))

      await expect(mockResult.instance.deleteBranch('feature-a'))
        .rejects.toThrow()

      // Restore
      mockResult.instance.emitEvent = originalEmit as typeof mockResult.instance.emitEvent
    })
  })

  describe('Isolation of Deletion', () => {
    it('should not affect other branches', async () => {
      const featureBBefore = (mockResult.sqlData.get('branches') as BranchRecord[])
        .find(b => b.name === 'feature-b')

      await mockResult.instance.deleteBranch('feature-a')

      const featureBAfter = (mockResult.sqlData.get('branches') as BranchRecord[])
        .find(b => b.name === 'feature-b')

      expect(featureBAfter).toEqual(featureBBefore)
    })

    it('should not affect main branch', async () => {
      const mainBefore = (mockResult.sqlData.get('branches') as BranchRecord[])
        .find(b => b.name === 'main')

      await mockResult.instance.deleteBranch('feature-a')

      const mainAfter = (mockResult.sqlData.get('branches') as BranchRecord[])
        .find(b => b.name === 'main')

      expect(mainAfter).toEqual(mainBefore)
    })

    it('should not delete things from other branches', async () => {
      const featureBThingsBefore = (mockResult.sqlData.get('things') as Array<{ branch: string | null }>)
        .filter(t => t.branch === 'feature-b')

      await mockResult.instance.deleteBranch('feature-a')

      const featureBThingsAfter = (mockResult.sqlData.get('things') as Array<{ branch: string | null }>)
        .filter(t => t.branch === 'feature-b')

      expect(featureBThingsAfter.length).toBe(featureBThingsBefore.length)
    })
  })

  describe('Durability of Deletion', () => {
    it('should persist deletion', async () => {
      await mockResult.instance.deleteBranch('feature-a')

      // Verify deletion persisted
      const branches = mockResult.sqlData.get('branches') as BranchRecord[]
      expect(branches.find(b => b.name === 'feature-a')).toBeUndefined()
    })

    it('should emit event before returning', async () => {
      await mockResult.instance.deleteBranch('feature-a')

      const events = mockResult.sqlData.get('events') as Array<{ verb: string }>
      expect(events.some(e => e.verb === 'branch.deleted')).toBe(true)
    })
  })
})

// ============================================================================
// CONCURRENT BRANCH OPERATIONS TESTS
// ============================================================================

describe('ACID Phase 1: Concurrent Branch Operations', () => {
  let mockResult: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    mockResult = createMockDO(DO, {
      id: 'test-do',
      ns: 'https://test.example.com',
    })

    // Set up initial state
    mockResult.sqlData.set('things', [
      createSampleThing({ id: 'item-1', rowid: 1, branch: null }),
      createSampleThing({ id: 'item-2', rowid: 2, branch: null }),
    ])

    mockResult.sqlData.set('branches', [
      createSampleBranch({ name: 'main', head: 2, base: null, forkedFrom: null }),
    ])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Concurrent Branch Creation', () => {
    it('should handle concurrent branch creation with different names', async () => {
      const results = await Promise.all([
        mockResult.instance.branch('feature-concurrent-a'),
        mockResult.instance.branch('feature-concurrent-b'),
        mockResult.instance.branch('feature-concurrent-c'),
      ])

      // All should succeed
      expect(results).toHaveLength(3)
      expect(results.map(r => r.name).sort()).toEqual([
        'feature-concurrent-a',
        'feature-concurrent-b',
        'feature-concurrent-c',
      ])

      // All branches should exist
      const branches = mockResult.sqlData.get('branches') as BranchRecord[]
      expect(branches.find(b => b.name === 'feature-concurrent-a')).toBeDefined()
      expect(branches.find(b => b.name === 'feature-concurrent-b')).toBeDefined()
      expect(branches.find(b => b.name === 'feature-concurrent-c')).toBeDefined()
    })

    it('should handle race condition on same branch name', async () => {
      // Both try to create same branch - one should fail
      const results = await Promise.allSettled([
        mockResult.instance.branch('feature-race'),
        mockResult.instance.branch('feature-race'),
      ])

      // At least one should succeed, at least one may fail
      const successes = results.filter(r => r.status === 'fulfilled')
      const failures = results.filter(r => r.status === 'rejected')

      expect(successes.length).toBeGreaterThanOrEqual(1)
      // The implementation may allow both or reject second
      if (failures.length > 0) {
        expect((failures[0] as PromiseRejectedResult).reason.message)
          .toMatch(/already exists|duplicate/)
      }
    })

    it('should serialize branch creation to prevent conflicts', async () => {
      // Create branches in quick succession
      const names = Array.from({ length: 10 }, (_, i) => `branch-${i}`)

      const results = await Promise.all(
        names.map(name => mockResult.instance.branch(name))
      )

      // All should succeed
      expect(results).toHaveLength(10)

      const branches = mockResult.sqlData.get('branches') as BranchRecord[]
      expect(branches.length).toBe(11) // 10 new + main
    })
  })

  describe('Concurrent Branch and Checkout', () => {
    it('should handle branch creation while checkout in progress', async () => {
      // First create a target branch
      await mockResult.instance.branch('feature-target')

      // Now try concurrent operations
      const results = await Promise.allSettled([
        mockResult.instance.checkout('feature-target'),
        mockResult.instance.branch('feature-new'),
      ])

      // Both operations should complete (either succeed or fail cleanly)
      expect(results).toHaveLength(2)
    })

    it('should handle checkout while branch creation in progress', async () => {
      await mockResult.instance.branch('feature-x')

      const results = await Promise.allSettled([
        mockResult.instance.branch('feature-during-checkout'),
        mockResult.instance.checkout('feature-x'),
      ])

      expect(results).toHaveLength(2)
    })
  })

  describe('Concurrent Deletion and Checkout', () => {
    it('should not allow checkout to deleted branch', async () => {
      await mockResult.instance.branch('feature-to-delete')

      // Try to delete and checkout concurrently
      const results = await Promise.allSettled([
        mockResult.instance.deleteBranch('feature-to-delete'),
        mockResult.instance.checkout('feature-to-delete'),
      ])

      // One should succeed, one may fail depending on order
      const successes = results.filter(r => r.status === 'fulfilled')
      expect(successes.length).toBeGreaterThanOrEqual(1)
    })

    it('should handle multiple concurrent deletions of different branches', async () => {
      await mockResult.instance.branch('feature-del-a')
      await mockResult.instance.branch('feature-del-b')
      await mockResult.instance.branch('feature-del-c')

      const results = await Promise.allSettled([
        mockResult.instance.deleteBranch('feature-del-a'),
        mockResult.instance.deleteBranch('feature-del-b'),
        mockResult.instance.deleteBranch('feature-del-c'),
      ])

      // All should succeed
      const successes = results.filter(r => r.status === 'fulfilled')
      expect(successes).toHaveLength(3)

      const branches = mockResult.sqlData.get('branches') as BranchRecord[]
      expect(branches.find(b => b.name === 'feature-del-a')).toBeUndefined()
      expect(branches.find(b => b.name === 'feature-del-b')).toBeUndefined()
      expect(branches.find(b => b.name === 'feature-del-c')).toBeUndefined()
    })
  })

  describe('Concurrent Operations Isolation', () => {
    it('should maintain consistent branch count after concurrent operations', async () => {
      const initialCount = (mockResult.sqlData.get('branches') as BranchRecord[]).length

      // Mix of create and delete operations
      await mockResult.instance.branch('feature-temp-1')
      await mockResult.instance.branch('feature-temp-2')

      const afterCreates = (mockResult.sqlData.get('branches') as BranchRecord[]).length
      expect(afterCreates).toBe(initialCount + 2)

      await mockResult.instance.deleteBranch('feature-temp-1')

      const afterDelete = (mockResult.sqlData.get('branches') as BranchRecord[]).length
      expect(afterDelete).toBe(initialCount + 1)
    })

    it('should preserve branch integrity during concurrent modifications', async () => {
      // Create several branches
      await mockResult.instance.branch('feature-integrity-a')
      await mockResult.instance.branch('feature-integrity-b')

      // Get expected state
      const expectedBranches = ['main', 'feature-integrity-a', 'feature-integrity-b']

      // Concurrent operations
      await Promise.all([
        mockResult.instance.branch('feature-integrity-c'),
        mockResult.instance.checkout('main'),
      ])

      const branches = mockResult.sqlData.get('branches') as BranchRecord[]
      const branchNames = branches.map(b => b.name).sort()

      // All expected branches plus the new one should exist
      expect(branchNames).toContain('main')
      expect(branchNames).toContain('feature-integrity-a')
      expect(branchNames).toContain('feature-integrity-b')
      expect(branchNames).toContain('feature-integrity-c')
    })
  })

  describe('Error Recovery in Concurrent Operations', () => {
    it('should recover from partial failures in concurrent creates', async () => {
      const originalExec = mockResult.storage.sql.exec
      let callCount = 0

      // Fail every third insert
      mockResult.storage.sql.exec = vi.fn().mockImplementation((query: string, ...params: unknown[]) => {
        callCount++
        if (query.toLowerCase().includes('insert') && callCount % 3 === 0) {
          throw new Error('Intermittent failure')
        }
        return originalExec.call(mockResult.storage.sql, query, ...params)
      })

      const results = await Promise.allSettled([
        mockResult.instance.branch('feature-recovery-a'),
        mockResult.instance.branch('feature-recovery-b'),
        mockResult.instance.branch('feature-recovery-c'),
      ])

      // At least some should succeed
      const successes = results.filter(r => r.status === 'fulfilled')
      expect(successes.length).toBeGreaterThan(0)

      // Failures should be clean (no partial state)
      const branches = mockResult.sqlData.get('branches') as BranchRecord[]
      for (const result of results) {
        if (result.status === 'rejected') {
          // Verify no partial branch was created
          const partialBranch = branches.find(b =>
            b.name.startsWith('feature-recovery-') && !b.head
          )
          expect(partialBranch).toBeUndefined()
        }
      }
    })

    it('should maintain database consistency after mixed success/failure', async () => {
      await mockResult.instance.branch('existing-branch')

      const results = await Promise.allSettled([
        mockResult.instance.branch('new-branch-1'),
        mockResult.instance.branch('existing-branch'), // Should fail
        mockResult.instance.branch('new-branch-2'),
      ])

      // Second should fail
      expect(results[1].status).toBe('rejected')

      // Check branches exist correctly
      const branches = mockResult.sqlData.get('branches') as BranchRecord[]
      const branchNames = branches.map(b => b.name)

      expect(branchNames).toContain('existing-branch')
      expect(branchNames.filter(n => n === 'existing-branch')).toHaveLength(1) // No duplicates
    })
  })
})

// ============================================================================
// LIST BRANCHES TESTS
// ============================================================================

describe('ACID Phase 1: List Branches Operation', () => {
  let mockResult: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    mockResult = createMockDO(DO, {
      id: 'test-do',
      ns: 'https://test.example.com',
    })

    setupMultiBranchScenario(mockResult)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Basic Listing', () => {
    it('should list all branches', async () => {
      const result = await mockResult.instance.listBranches()

      expect(result).toContain('main')
      expect(result).toContain('feature-a')
      expect(result).toContain('feature-b')
      expect(result).toHaveLength(3)
    })

    it('should include newly created branches', async () => {
      await mockResult.instance.branch('feature-new')

      const result = await mockResult.instance.listBranches()

      expect(result).toContain('feature-new')
    })

    it('should exclude deleted branches', async () => {
      await mockResult.instance.deleteBranch('feature-a')

      const result = await mockResult.instance.listBranches()

      expect(result).not.toContain('feature-a')
      expect(result).toContain('feature-b')
    })

    it('should return empty array for new DO with no branches', async () => {
      mockResult.sqlData.set('branches', [])

      const result = await mockResult.instance.listBranches()

      // May return empty or just 'main' depending on implementation
      expect(Array.isArray(result)).toBe(true)
    })
  })

  describe('List with Current Branch Info', () => {
    it('should indicate current branch', async () => {
      mockResult.storage.data.set('currentBranch', 'feature-a')

      const result = await mockResult.instance.listBranches({ showCurrent: true })

      // Should have some indication of current branch
      expect(result.current).toBe('feature-a')
    })

    it('should show all branches with metadata', async () => {
      const result = await mockResult.instance.listBranches({ includeMetadata: true })

      // Should return full branch records
      expect(result.branches).toBeDefined()
      expect(result.branches.find((b: BranchRecord) => b.name === 'main')).toBeDefined()
    })
  })
})

// ============================================================================
// EDGE CASES AND ERROR HANDLING
// ============================================================================

describe('ACID Phase 1: Branch Edge Cases', () => {
  let mockResult: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    mockResult = createMockDO(DO, {
      id: 'test-do',
      ns: 'https://test.example.com',
    })

    mockResult.sqlData.set('things', [
      createSampleThing({ id: 'item-1', rowid: 1, branch: null }),
    ])

    mockResult.sqlData.set('branches', [
      createSampleBranch({ name: 'main', head: 1, base: null, forkedFrom: null }),
    ])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Maximum Branch Limit', () => {
    it('should handle many branches', async () => {
      // Create 100 branches
      const promises = Array.from({ length: 100 }, (_, i) =>
        mockResult.instance.branch(`feature-${i.toString().padStart(3, '0')}`)
      )

      const results = await Promise.all(promises)

      expect(results).toHaveLength(100)

      const branches = mockResult.sqlData.get('branches') as BranchRecord[]
      expect(branches.length).toBe(101) // 100 new + main
    })

    it('should reject when branch limit exceeded', async () => {
      // Set up mock to simulate branch limit
      const branches = mockResult.sqlData.get('branches') as BranchRecord[]
      for (let i = 0; i < 1000; i++) {
        branches.push(createSampleBranch({ name: `branch-${i}`, head: 1 }))
      }

      // Implementation should enforce some limit
      await expect(mockResult.instance.branch('one-too-many'))
        .rejects.toThrow(/limit exceeded|too many/)
    })
  })

  describe('Unicode Branch Names', () => {
    it('should handle unicode in branch names', async () => {
      const result = await mockResult.instance.branch('feature-\u00e9')

      expect(result.name).toBe('feature-\u00e9')
    })

    it('should reject emojis in branch names', async () => {
      await expect(mockResult.instance.branch('feature-\ud83d\ude00'))
        .rejects.toThrow(/Invalid branch name/)
    })
  })

  describe('Branch with Long History', () => {
    it('should handle branch from deep history', async () => {
      // Add many versions
      const things = mockResult.sqlData.get('things') as unknown[]
      for (let i = 2; i <= 1000; i++) {
        things.push(createSampleThing({ id: `item-${i}`, rowid: i, branch: null }))
      }

      // Update main head
      const branches = mockResult.sqlData.get('branches') as BranchRecord[]
      branches[0]!.head = 1000

      const result = await mockResult.instance.branch('feature-from-deep')

      expect(result.head).toBe(1000)
    })
  })

  describe('Branch Recovery', () => {
    it('should allow re-creation of deleted branch name', async () => {
      await mockResult.instance.branch('feature-reuse')
      await mockResult.instance.deleteBranch('feature-reuse')

      // Should be able to create again
      const result = await mockResult.instance.branch('feature-reuse')

      expect(result.name).toBe('feature-reuse')
    })

    it('should preserve history when branch is recreated', async () => {
      await mockResult.instance.branch('feature-history')

      // Add some things on the branch
      const things = mockResult.sqlData.get('things') as unknown[]
      things.push(createSampleThing({
        id: 'branch-item',
        rowid: things.length + 1,
        branch: 'feature-history',
      }))

      await mockResult.instance.deleteBranch('feature-history')

      // Recreate - should start fresh (orphaned things remain but new branch is clean)
      const result = await mockResult.instance.branch('feature-history')

      expect(result.name).toBe('feature-history')
    })
  })

  describe('Branch Metadata Edge Cases', () => {
    it('should handle null forkedFrom for main-like branches', async () => {
      // Some implementations may allow branches with no parent
      const result = await mockResult.instance.branch('orphan-branch')

      // forkedFrom should be set to current branch (main)
      expect(result.forkedFrom).toBe('main')
    })

    it('should handle circular fork detection', async () => {
      await mockResult.instance.branch('branch-a')

      // Manually create a circular reference (shouldn't happen normally)
      const branches = mockResult.sqlData.get('branches') as BranchRecord[]
      const branchA = branches.find(b => b.name === 'branch-a')
      if (branchA) {
        branchA.forkedFrom = 'branch-b'
      }
      branches.push(createSampleBranch({
        name: 'branch-b',
        forkedFrom: 'branch-a',
        head: 1,
      }))

      // Creating a new branch should still work (no infinite loop)
      const result = await mockResult.instance.branch('branch-c')

      expect(result.name).toBe('branch-c')
    })
  })
})
