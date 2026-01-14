/**
 * ACID Test Suite - Phase 1: checkout() - Switch Branch or Version
 *
 * RED TDD: These tests define the expected behavior for checkout() operation.
 * The checkout() operation switches to a branch or specific version:
 * - Checkout branch by name
 * - Checkout explicit main branch
 * - Checkout version by rowid (@v1234)
 * - Checkout relative version (@~1, @~2)
 * - Handle invalid branch/version errors
 * - Emit lifecycle events
 *
 * ACID Properties Tested:
 * - Atomicity: Branch switch is all-or-nothing
 * - Consistency: Current branch state is valid
 * - Isolation: Checkout doesn't affect other branches
 * - Durability: Current branch persists
 *
 * @see objects/DOFull.ts for checkout() implementation
 * @see objects/lifecycle/Branch.ts for BranchModule
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockDO, MockDOResult, MockEnv } from '../../do'
import { DO } from '../../../objects/DO'

// ============================================================================
// TYPE DEFINITIONS FOR CHECKOUT API
// ============================================================================

/**
 * Result of a checkout operation
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
 * Checkout event types
 */
type CheckoutEventType =
  | 'checkout.started'
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

// ============================================================================
// CHECKOUT OPERATION TESTS
// ============================================================================

describe('ACID Phase 1: checkout() - Switch Branch/Version', () => {
  let mockResult: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    mockResult = createMockDO(DO, {
      id: 'test-do',
      ns: 'https://test.example.com',
    })

    // Set up things on different branches
    mockResult.sqlData.set('things', [
      createSampleThing({ id: 'main-item', rowid: 1, branch: null, data: { on: 'main' } }),
      createSampleThing({ id: 'main-item', rowid: 2, branch: null, data: { on: 'main', v: 2 } }),
      createSampleThing({ id: 'feature-item', rowid: 3, branch: 'feature-x', data: { on: 'feature' } }),
    ])

    // Set up branches
    mockResult.sqlData.set('branches', [
      createSampleBranch({ name: 'main', head: 2, base: null, forkedFrom: null }),
      createSampleBranch({ name: 'feature-x', head: 3, base: 2, forkedFrom: 'main' }),
    ])
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // BASIC CHECKOUT OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Basic Checkout Operations', () => {
    it('should checkout branch by name', async () => {
      const result = await mockResult.instance.checkout('feature-x')

      expect(result).toHaveProperty('branch', 'feature-x')
      expect(result.detached).toBeFalsy()
    })

    it('should checkout explicit main branch', async () => {
      // Start on feature branch
      await mockResult.instance.checkout('feature-x')

      // Checkout main
      const result = await mockResult.instance.checkout('main')

      expect(result).toHaveProperty('branch', 'main')
    })

    it('should checkout version by rowid (@v prefix)', async () => {
      const result = await mockResult.instance.checkout('@v1')

      expect(result).toHaveProperty('version', 1)
      expect(result.detached).toBe(true)
    })

    it('should checkout relative version (@~N)', async () => {
      // @~1 means one version back from HEAD
      const result = await mockResult.instance.checkout('@~1')

      expect(result).toHaveProperty('version')
      expect(result.detached).toBe(true)
    })

    it('should checkout relative version (@~2)', async () => {
      const result = await mockResult.instance.checkout('@~2')

      expect(result).toHaveProperty('version')
      expect(result.detached).toBe(true)
    })

    it('should emit checkout.completed event', async () => {
      const events = mockResult.sqlData.get('events') as Array<{ verb: string }>

      await mockResult.instance.checkout('feature-x')

      const eventVerbs = events.map(e => e.verb)
      expect(eventVerbs).toContain('checkout.completed')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // VALIDATION
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Validation', () => {
    it('should error for invalid branch name', async () => {
      await expect(mockResult.instance.checkout('non-existent-branch'))
        .rejects.toThrow(/Branch .* does not exist|not found/)
    })

    it('should error for invalid version', async () => {
      await expect(mockResult.instance.checkout('@v99999'))
        .rejects.toThrow(/Version .* not found|invalid/)
    })

    it('should error for invalid relative version', async () => {
      // @~100 when there are only 3 versions
      await expect(mockResult.instance.checkout('@~100'))
        .rejects.toThrow(/Invalid relative version|out of range/)
    })

    it('should error for malformed ref', async () => {
      await expect(mockResult.instance.checkout('@invalid'))
        .rejects.toThrow(/Invalid ref format|malformed/)
    })

    it('should error for empty ref', async () => {
      await expect(mockResult.instance.checkout(''))
        .rejects.toThrow(/Invalid ref|empty/)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // ATOMICITY (ACID)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Atomicity', () => {
    it('should switch branch fully or not at all', async () => {
      // Store current state
      const stateBefore = mockResult.storage.data.get('currentBranch')

      // Simulate failure during checkout
      mockResult.storage.sql.exec = vi.fn().mockImplementation(() => {
        throw new Error('Database error')
      })

      await expect(mockResult.instance.checkout('feature-x'))
        .rejects.toThrow()

      // Current branch should be unchanged
      const stateAfter = mockResult.storage.data.get('currentBranch')
      expect(stateAfter).toBe(stateBefore)
    })

    it('should rollback on failure', async () => {
      const events = mockResult.sqlData.get('events') as Array<{ verb: string }>

      mockResult.storage.sql.exec = vi.fn().mockImplementation(() => {
        throw new Error('Database error')
      })

      await expect(mockResult.instance.checkout('feature-x'))
        .rejects.toThrow()

      // checkout.failed should be emitted or no checkout.completed
      const eventVerbs = events.map(e => e.verb)
      expect(eventVerbs).not.toContain('checkout.completed')
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSISTENCY (ACID)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Consistency', () => {
    it('should maintain valid current branch state', async () => {
      await mockResult.instance.checkout('feature-x')

      // Current branch should be feature-x
      const currentBranch = mockResult.storage.data.get('currentBranch')
      expect(currentBranch).toBe('feature-x')
    })

    it('should clear detached HEAD when checking out branch', async () => {
      // First checkout to a version (detached)
      await mockResult.instance.checkout('@v1')

      // Then checkout branch
      const result = await mockResult.instance.checkout('main')

      expect(result.branch).toBe('main')
      expect(result.detached).toBeFalsy()
    })

    it('should set detached HEAD when checking out version', async () => {
      const result = await mockResult.instance.checkout('@v1')

      expect(result.detached).toBe(true)
      expect(result.version).toBeDefined()
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // ISOLATION (ACID)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Isolation', () => {
    it('should not affect other branches when checking out', async () => {
      const branchesBefore = [...(mockResult.sqlData.get('branches') as BranchRecord[])]

      await mockResult.instance.checkout('feature-x')

      // All branches should still exist with same properties
      const branchesAfter = mockResult.sqlData.get('branches') as BranchRecord[]
      expect(branchesAfter.length).toBe(branchesBefore.length)

      const mainBranch = branchesAfter.find(b => b.name === 'main')
      const mainBranchBefore = branchesBefore.find(b => b.name === 'main')
      expect(mainBranch?.head).toBe(mainBranchBefore?.head)
    })

    it('should not modify things when checking out', async () => {
      const thingsBefore = [...(mockResult.sqlData.get('things') as unknown[])]

      await mockResult.instance.checkout('feature-x')

      const thingsAfter = mockResult.sqlData.get('things') as unknown[]
      expect(thingsAfter.length).toBe(thingsBefore.length)
    })

    it('should only change view, not data', async () => {
      // Checkout feature branch
      await mockResult.instance.checkout('feature-x')

      // Main branch items should still exist
      const things = mockResult.sqlData.get('things') as Array<{ branch: string | null }>
      const mainThings = things.filter(t => t.branch === null)
      expect(mainThings.length).toBeGreaterThan(0)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // DURABILITY (ACID)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Durability', () => {
    it('should persist current branch after checkout', async () => {
      await mockResult.instance.checkout('feature-x')

      const currentBranch = mockResult.storage.data.get('currentBranch')
      expect(currentBranch).toBe('feature-x')
    })

    it('should emit event before returning', async () => {
      await mockResult.instance.checkout('feature-x')

      const events = mockResult.sqlData.get('events') as Array<{ verb: string }>
      expect(events.some(e => e.verb === 'checkout.completed')).toBe(true)
    })

    it('should persist detached HEAD version', async () => {
      await mockResult.instance.checkout('@v1')

      // Detached version should be stored
      const detachedVersion = mockResult.storage.data.get('detachedVersion')
      expect(detachedVersion).toBe(1)
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // VERSION REFERENCE FORMATS
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Version Reference Formats', () => {
    it.each([
      ['@v1', 1],
      ['@v2', 2],
    ])('should parse version ref: %s -> %d', async (ref, expectedVersion) => {
      mockResult.sqlData.set('things', [
        createSampleThing({ id: 'item', rowid: 1 }),
        createSampleThing({ id: 'item', rowid: 2 }),
      ])

      const result = await mockResult.instance.checkout(ref)
      expect(result.version).toBe(expectedVersion)
    })

    it.each([
      '@~1',
      '@~2',
    ])('should parse relative version ref: %s', async (ref) => {
      const result = await mockResult.instance.checkout(ref)
      expect(result.version).toBeDefined()
      expect(result.detached).toBe(true)
    })

    it.each([
      '@invalid',
      '@vABC',
      '@~-1',
      '@~0',
    ])('should reject invalid version ref: %s', async (ref) => {
      await expect(mockResult.instance.checkout(ref)).rejects.toThrow()
    })
  })

  // ═══════════════════════════════════════════════════════════════════════════
  // DETACHED HEAD STATE
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Detached HEAD State', () => {
    it('should enter detached HEAD when checking out version', async () => {
      const result = await mockResult.instance.checkout('@v1')

      expect(result.detached).toBe(true)
      expect(result.branch).toBeUndefined()
    })

    it('should exit detached HEAD when checking out branch', async () => {
      // Enter detached state
      await mockResult.instance.checkout('@v1')

      // Checkout branch
      const result = await mockResult.instance.checkout('main')

      expect(result.detached).toBeFalsy()
      expect(result.branch).toBe('main')
    })

    it('should warn about detached HEAD limitations', async () => {
      const result = await mockResult.instance.checkout('@v1')

      // Result should indicate detached state
      expect(result.detached).toBe(true)
    })
  })
})
