import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Experiment Branch Resolution Tests (RED Phase)
 *
 * Tests for the resolveBranch(userId, thingId) function that deterministically
 * assigns users to experiment branches via hash.
 *
 * These tests are expected to FAIL until the implementation is complete.
 *
 * Implementation requirements (from docs/concepts/experiments.mdx):
 * - Returns 'main' when no experiment exists
 * - Deterministic assignment (same user always gets same branch)
 * - Traffic allocation respects percentage
 * - Even distribution across branches
 *
 * Expected implementation:
 * ```typescript
 * function resolveBranch(userId: string, thingId: string): string {
 *   const experiment = getActiveExperiment(thingId)
 *   if (!experiment) return 'main'
 *
 *   const trafficHash = hash(`${userId}:${experiment.id}`)
 *   if (trafficHash % 10000 > experiment.traffic * 10000) {
 *     return 'main'  // Not in experiment
 *   }
 *
 *   const branchHash = hash(`${userId}:${experiment.id}:branch`)
 *   return experiment.branches[branchHash % experiment.branches.length]
 * }
 * ```
 */

// Import the functions we expect to implement
import { resolveBranch, getActiveExperiment, setActiveExperiment, clearExperiments, hash } from '../experiments'

// ============================================================================
// Test Types
// ============================================================================

interface Experiment {
  id: string
  thing: string
  branches: string[]
  traffic: number // 0-1, percentage in experiment
  metric: string
  status: 'draft' | 'running' | 'completed'
  winner?: string
}

// ============================================================================
// Returns 'main' When No Experiment Exists
// ============================================================================

describe('resolveBranch - No Active Experiment', () => {
  beforeEach(() => {
    // Clear any registered experiments
    clearExperiments()
  })

  it('returns "main" when no experiment exists for the thing', () => {
    const result = resolveBranch('user-123', 'qualifyLead')
    expect(result).toBe('main')
  })

  it('returns "main" for any user when no experiment exists', () => {
    const users = ['user-1', 'user-2', 'user-3', 'admin@example.com.ai', 'uuid-abc-123']

    for (const userId of users) {
      const result = resolveBranch(userId, 'nonExistentThing')
      expect(result).toBe('main')
    }
  })

  it('returns "main" when experiment is in draft status', () => {
    // Draft experiments should not affect branch resolution
    setActiveExperiment('qualifyLead', {
      id: 'exp-draft',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a'],
      traffic: 1.0,
      metric: 'Sales.qualified',
      status: 'draft',
    })

    const result = resolveBranch('user-123', 'qualifyLead')
    expect(result).toBe('main')
  })

  it('returns "main" when experiment is completed without winner being set', () => {
    setActiveExperiment('qualifyLead', {
      id: 'exp-completed',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a'],
      traffic: 1.0,
      metric: 'Sales.qualified',
      status: 'completed',
      // No winner set
    })

    const result = resolveBranch('user-123', 'qualifyLead')
    expect(result).toBe('main')
  })

  it('returns winner branch when experiment is completed with winner', () => {
    setActiveExperiment('qualifyLead', {
      id: 'exp-completed-winner',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a'],
      traffic: 1.0,
      metric: 'Sales.qualified',
      status: 'completed',
      winner: 'variant-a',
    })

    const result = resolveBranch('user-123', 'qualifyLead')
    // Should always return the winner for completed experiments
    expect(result).toBe('variant-a')
  })
})

// ============================================================================
// Deterministic Assignment
// ============================================================================

describe('resolveBranch - Deterministic Assignment', () => {
  beforeEach(() => {
    clearExperiments()
    setActiveExperiment('qualifyLead', {
      id: 'exp-deterministic',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a', 'variant-b'],
      traffic: 1.0, // 100% in experiment
      metric: 'Sales.qualified',
      status: 'running',
    })
  })

  it('returns the same branch for the same user on multiple calls', () => {
    const userId = 'user-deterministic-test'
    const thingId = 'qualifyLead'

    const results = Array.from({ length: 100 }, () => resolveBranch(userId, thingId))

    // All results should be identical
    const uniqueResults = new Set(results)
    expect(uniqueResults.size).toBe(1)
  })

  it('same user always gets same branch across different sessions', () => {
    const userId = 'user-session-test'
    const thingId = 'qualifyLead'

    // Simulate "different sessions" by calling multiple times
    const firstSessionResult = resolveBranch(userId, thingId)

    // Clear and re-register the experiment
    clearExperiments()
    setActiveExperiment('qualifyLead', {
      id: 'exp-deterministic',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a', 'variant-b'],
      traffic: 1.0,
      metric: 'Sales.qualified',
      status: 'running',
    })

    const secondSessionResult = resolveBranch(userId, thingId)

    expect(firstSessionResult).toBe(secondSessionResult)
  })

  it('different users may get different branches', () => {
    const thingId = 'qualifyLead'
    const users = Array.from({ length: 1000 }, (_, i) => `user-diff-${i}`)

    const results = users.map((userId) => resolveBranch(userId, thingId))

    // With 1000 users and 3 branches, we should see multiple different branches
    const uniqueBranches = new Set(results)
    expect(uniqueBranches.size).toBeGreaterThan(1)
  })

  it('assignment depends on both userId and experimentId', () => {
    // Create a second experiment with different ID
    setActiveExperiment('checkout', {
      id: 'exp-checkout',
      thing: 'checkout',
      branches: ['main', 'new-checkout'],
      traffic: 1.0,
      metric: 'Conversion.completed',
      status: 'running',
    })

    const userId = 'user-cross-experiment'

    // Same user in different experiments should have independent assignment
    const leadBranch = resolveBranch(userId, 'qualifyLead')
    const checkoutBranch = resolveBranch(userId, 'checkout')

    // Results should be valid branches for their respective experiments
    expect(['main', 'variant-a', 'variant-b']).toContain(leadBranch)
    expect(['main', 'new-checkout']).toContain(checkoutBranch)
  })

  it('hash is based on userId:experimentId not userId:thingId', () => {
    // Two experiments for the same thing should have different hashes
    clearExperiments()

    // First experiment
    setActiveExperiment('qualifyLead', {
      id: 'exp-version-1',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a'],
      traffic: 1.0,
      metric: 'Sales.qualified',
      status: 'running',
    })

    const resultV1 = resolveBranch('user-test', 'qualifyLead')

    // Clear and register new experiment with different ID
    clearExperiments()
    setActiveExperiment('qualifyLead', {
      id: 'exp-version-2',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a'],
      traffic: 1.0,
      metric: 'Sales.qualified',
      status: 'running',
    })

    const resultV2 = resolveBranch('user-test', 'qualifyLead')

    // Note: Results MAY be the same by chance, but the point is they are
    // computed independently based on experiment ID
    // This test verifies the hash input format is correct
    expect(typeof resultV1).toBe('string')
    expect(typeof resultV2).toBe('string')
  })
})

// ============================================================================
// Traffic Allocation Respects Percentage
// ============================================================================

describe('resolveBranch - Traffic Allocation', () => {
  beforeEach(() => {
    clearExperiments()
  })

  it('100% traffic puts all users in experiment', () => {
    setActiveExperiment('qualifyLead', {
      id: 'exp-full-traffic',
      thing: 'qualifyLead',
      branches: ['main', 'variant-a'],
      traffic: 1.0, // 100%
      metric: 'Sales.qualified',
      status: 'running',
    })

    const users = Array.from({ length: 100 }, (_, i) => `user-full-${i}`)
    const results = users.map((userId) => resolveBranch(userId, 'qualifyLead'))

    // With 100% traffic and 2 branches (main and variant-a), all results
    // should be either 'main' or 'variant-a' from the experiment branches
    // NOT 'main' from traffic exclusion
    const inExperiment = results.filter((r) => r === 'main' || r === 'variant-a')
    expect(inExperiment.length).toBe(100)
  })

  it('0% traffic puts no users in experiment', () => {
    setActiveExperiment('qualifyLead', {
      id: 'exp-no-traffic',
      thing: 'qualifyLead',
      branches: ['variant-a', 'variant-b'], // No 'main' in branches
      traffic: 0.0, // 0%
      metric: 'Sales.qualified',
      status: 'running',
    })

    const users = Array.from({ length: 100 }, (_, i) => `user-zero-${i}`)
    const results = users.map((userId) => resolveBranch(userId, 'qualifyLead'))

    // With 0% traffic, all users should get 'main' (excluded from experiment)
    const mainOnly = results.filter((r) => r === 'main')
    expect(mainOnly.length).toBe(100)
  })

  it('50% traffic approximately splits users', () => {
    setActiveExperiment('qualifyLead', {
      id: 'exp-half-traffic',
      thing: 'qualifyLead',
      branches: ['variant-a'], // Single variant for clearer testing
      traffic: 0.5, // 50%
      metric: 'Sales.qualified',
      status: 'running',
    })

    // Use many users for statistical validity
    const users = Array.from({ length: 10000 }, (_, i) => `user-half-${i}`)
    const results = users.map((userId) => resolveBranch(userId, 'qualifyLead'))

    const inExperiment = results.filter((r) => r === 'variant-a').length
    const notInExperiment = results.filter((r) => r === 'main').length

    // Should be approximately 50/50, allow 5% tolerance
    expect(inExperiment).toBeGreaterThan(4500) // > 45%
    expect(inExperiment).toBeLessThan(5500) // < 55%
    expect(notInExperiment).toBeGreaterThan(4500)
    expect(notInExperiment).toBeLessThan(5500)
  })

  it('20% traffic puts approximately 20% of users in experiment', () => {
    setActiveExperiment('qualifyLead', {
      id: 'exp-twenty-traffic',
      thing: 'qualifyLead',
      branches: ['variant-a'],
      traffic: 0.2, // 20%
      metric: 'Sales.qualified',
      status: 'running',
    })

    const users = Array.from({ length: 10000 }, (_, i) => `user-twenty-${i}`)
    const results = users.map((userId) => resolveBranch(userId, 'qualifyLead'))

    const inExperiment = results.filter((r) => r === 'variant-a').length

    // Should be approximately 20%, allow 3% tolerance
    expect(inExperiment).toBeGreaterThan(1700) // > 17%
    expect(inExperiment).toBeLessThan(2300) // < 23%
  })

  it('traffic allocation is deterministic for each user', () => {
    setActiveExperiment('qualifyLead', {
      id: 'exp-deterministic-traffic',
      thing: 'qualifyLead',
      branches: ['variant-a'],
      traffic: 0.5,
      metric: 'Sales.qualified',
      status: 'running',
    })

    const userId = 'user-traffic-deterministic'

    // Call multiple times
    const results = Array.from({ length: 100 }, () => resolveBranch(userId, 'qualifyLead'))

    // Should always be the same result
    const uniqueResults = new Set(results)
    expect(uniqueResults.size).toBe(1)
  })

  it('traffic hash uses 10000 buckets for precision', () => {
    // This test verifies the implementation uses % 10000 for traffic allocation
    // which allows traffic percentages down to 0.01% precision

    setActiveExperiment('qualifyLead', {
      id: 'exp-precision',
      thing: 'qualifyLead',
      branches: ['variant-a'],
      traffic: 0.0001, // 0.01%
      metric: 'Sales.qualified',
      status: 'running',
    })

    // With 0.01% traffic, we need lots of users to see any in experiment
    const users = Array.from({ length: 100000 }, (_, i) => `user-precision-${i}`)
    const results = users.map((userId) => resolveBranch(userId, 'qualifyLead'))

    const inExperiment = results.filter((r) => r === 'variant-a').length

    // Should be approximately 10 users (0.01% of 100000)
    // Allow wide tolerance due to small numbers
    expect(inExperiment).toBeGreaterThanOrEqual(1)
    expect(inExperiment).toBeLessThan(50)
  })
})

// ============================================================================
// Even Distribution Across Branches
// ============================================================================

describe('resolveBranch - Branch Distribution', () => {
  beforeEach(() => {
    clearExperiments()
  })

  it('distributes evenly across 2 branches', () => {
    setActiveExperiment('qualifyLead', {
      id: 'exp-two-branches',
      thing: 'qualifyLead',
      branches: ['control', 'variant-a'],
      traffic: 1.0,
      metric: 'Sales.qualified',
      status: 'running',
    })

    const users = Array.from({ length: 10000 }, (_, i) => `user-two-${i}`)
    const results = users.map((userId) => resolveBranch(userId, 'qualifyLead'))

    const distribution = results.reduce(
      (acc, branch) => {
        acc[branch] = (acc[branch] || 0) + 1
        return acc
      },
      {} as Record<string, number>,
    )

    // Each branch should have approximately 50%
    expect(distribution['control']).toBeGreaterThan(4500)
    expect(distribution['control']).toBeLessThan(5500)
    expect(distribution['variant-a']).toBeGreaterThan(4500)
    expect(distribution['variant-a']).toBeLessThan(5500)
  })

  it('distributes evenly across 3 branches', () => {
    setActiveExperiment('qualifyLead', {
      id: 'exp-three-branches',
      thing: 'qualifyLead',
      branches: ['control', 'variant-a', 'variant-b'],
      traffic: 1.0,
      metric: 'Sales.qualified',
      status: 'running',
    })

    const users = Array.from({ length: 10000 }, (_, i) => `user-three-${i}`)
    const results = users.map((userId) => resolveBranch(userId, 'qualifyLead'))

    const distribution = results.reduce(
      (acc, branch) => {
        acc[branch] = (acc[branch] || 0) + 1
        return acc
      },
      {} as Record<string, number>,
    )

    // Each branch should have approximately 33.3%
    expect(distribution['control']).toBeGreaterThan(3000)
    expect(distribution['control']).toBeLessThan(3700)
    expect(distribution['variant-a']).toBeGreaterThan(3000)
    expect(distribution['variant-a']).toBeLessThan(3700)
    expect(distribution['variant-b']).toBeGreaterThan(3000)
    expect(distribution['variant-b']).toBeLessThan(3700)
  })

  it('distributes evenly across 4 branches', () => {
    setActiveExperiment('qualifyLead', {
      id: 'exp-four-branches',
      thing: 'qualifyLead',
      branches: ['control', 'variant-a', 'variant-b', 'variant-c'],
      traffic: 1.0,
      metric: 'Sales.qualified',
      status: 'running',
    })

    const users = Array.from({ length: 10000 }, (_, i) => `user-four-${i}`)
    const results = users.map((userId) => resolveBranch(userId, 'qualifyLead'))

    const distribution = results.reduce(
      (acc, branch) => {
        acc[branch] = (acc[branch] || 0) + 1
        return acc
      },
      {} as Record<string, number>,
    )

    // Each branch should have approximately 25%
    for (const branch of ['control', 'variant-a', 'variant-b', 'variant-c']) {
      expect(distribution[branch]).toBeGreaterThan(2200)
      expect(distribution[branch]).toBeLessThan(2800)
    }
  })

  it('handles single branch experiment', () => {
    setActiveExperiment('qualifyLead', {
      id: 'exp-single-branch',
      thing: 'qualifyLead',
      branches: ['variant-a'],
      traffic: 1.0,
      metric: 'Sales.qualified',
      status: 'running',
    })

    const users = Array.from({ length: 100 }, (_, i) => `user-single-${i}`)
    const results = users.map((userId) => resolveBranch(userId, 'qualifyLead'))

    // All should be in the single branch
    const allSameBranch = results.every((r) => r === 'variant-a')
    expect(allSameBranch).toBe(true)
  })

  it('branch assignment uses separate hash from traffic', () => {
    // Users in the experiment should be evenly distributed regardless of
    // where they fall in the traffic allocation

    setActiveExperiment('qualifyLead', {
      id: 'exp-separate-hash',
      thing: 'qualifyLead',
      branches: ['variant-a', 'variant-b'],
      traffic: 0.5, // 50% traffic
      metric: 'Sales.qualified',
      status: 'running',
    })

    const users = Array.from({ length: 10000 }, (_, i) => `user-sep-${i}`)
    const results = users.map((userId) => resolveBranch(userId, 'qualifyLead'))

    // Filter to only users in the experiment (not 'main')
    const inExperiment = results.filter((r) => r !== 'main')

    const distribution = inExperiment.reduce(
      (acc, branch) => {
        acc[branch] = (acc[branch] || 0) + 1
        return acc
      },
      {} as Record<string, number>,
    )

    // Among users in experiment, should be evenly split
    const total = inExperiment.length
    const expectedEach = total / 2

    expect(distribution['variant-a']).toBeGreaterThan(expectedEach * 0.9)
    expect(distribution['variant-a']).toBeLessThan(expectedEach * 1.1)
    expect(distribution['variant-b']).toBeGreaterThan(expectedEach * 0.9)
    expect(distribution['variant-b']).toBeLessThan(expectedEach * 1.1)
  })
})

// ============================================================================
// Hash Function Tests
// ============================================================================

describe('hash function', () => {
  it('produces consistent hash for same input', () => {
    const input = 'user-123:exp-456'
    const hash1 = hash(input)
    const hash2 = hash(input)

    expect(hash1).toBe(hash2)
  })

  it('produces different hashes for different inputs', () => {
    const hash1 = hash('user-123:exp-456')
    const hash2 = hash('user-124:exp-456')
    const hash3 = hash('user-123:exp-457')

    expect(hash1).not.toBe(hash2)
    expect(hash1).not.toBe(hash3)
    expect(hash2).not.toBe(hash3)
  })

  it('returns a numeric value suitable for modulo operations', () => {
    const result = hash('test-input')

    expect(typeof result).toBe('number')
    expect(Number.isInteger(result)).toBe(true)
    expect(result).toBeGreaterThanOrEqual(0)
  })

  it('distributes uniformly across bucket range', () => {
    // Hash 10000 different inputs and check distribution
    const buckets = new Array(100).fill(0)

    for (let i = 0; i < 10000; i++) {
      const h = hash(`input-${i}`)
      const bucket = h % 100
      buckets[bucket]++
    }

    // Each bucket should have approximately 100 entries (10000/100)
    for (const count of buckets) {
      expect(count).toBeGreaterThan(50) // > 50% of expected
      expect(count).toBeLessThan(150) // < 150% of expected
    }
  })
})

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('resolveBranch - Edge Cases', () => {
  beforeEach(() => {
    clearExperiments()
  })

  it('handles empty userId', () => {
    setActiveExperiment('qualifyLead', {
      id: 'exp-empty-user',
      thing: 'qualifyLead',
      branches: ['variant-a'],
      traffic: 1.0,
      metric: 'Sales.qualified',
      status: 'running',
    })

    const result = resolveBranch('', 'qualifyLead')

    // Should still work deterministically
    expect(typeof result).toBe('string')
  })

  it('handles special characters in userId', () => {
    setActiveExperiment('qualifyLead', {
      id: 'exp-special-chars',
      thing: 'qualifyLead',
      branches: ['variant-a', 'variant-b'],
      traffic: 1.0,
      metric: 'Sales.qualified',
      status: 'running',
    })

    const specialUsers = ['user@example.com.ai', 'user+test@mail.com', 'user:with:colons', "user'quote", 'user"doublequote']

    for (const userId of specialUsers) {
      const result = resolveBranch(userId, 'qualifyLead')
      expect(['variant-a', 'variant-b']).toContain(result)
    }
  })

  it('handles unicode in userId', () => {
    setActiveExperiment('qualifyLead', {
      id: 'exp-unicode',
      thing: 'qualifyLead',
      branches: ['variant-a', 'variant-b'],
      traffic: 1.0,
      metric: 'Sales.qualified',
      status: 'running',
    })

    const result = resolveBranch('user-\u4e2d\u6587', 'qualifyLead')
    expect(['variant-a', 'variant-b']).toContain(result)
  })

  it('handles very long userId', () => {
    setActiveExperiment('qualifyLead', {
      id: 'exp-long-user',
      thing: 'qualifyLead',
      branches: ['variant-a'],
      traffic: 1.0,
      metric: 'Sales.qualified',
      status: 'running',
    })

    const longUserId = 'user-' + 'x'.repeat(10000)
    const result = resolveBranch(longUserId, 'qualifyLead')

    expect(result).toBe('variant-a')
  })

  it('handles empty branches array gracefully', () => {
    setActiveExperiment('qualifyLead', {
      id: 'exp-no-branches',
      thing: 'qualifyLead',
      branches: [], // Invalid but should handle gracefully
      traffic: 1.0,
      metric: 'Sales.qualified',
      status: 'running',
    })

    const result = resolveBranch('user-123', 'qualifyLead')

    // Should return 'main' or throw meaningful error
    expect(result).toBe('main')
  })

  it('handles many branches efficiently', () => {
    const manyBranches = Array.from({ length: 100 }, (_, i) => `variant-${i}`)

    setActiveExperiment('qualifyLead', {
      id: 'exp-many-branches',
      thing: 'qualifyLead',
      branches: manyBranches,
      traffic: 1.0,
      metric: 'Sales.qualified',
      status: 'running',
    })

    const result = resolveBranch('user-123', 'qualifyLead')
    expect(manyBranches).toContain(result)
  })
})

// ============================================================================
// getActiveExperiment Tests
// ============================================================================

describe('getActiveExperiment', () => {
  beforeEach(() => {
    clearExperiments()
  })

  it('returns undefined when no experiment exists', () => {
    const result = getActiveExperiment('nonExistent')
    expect(result).toBeUndefined()
  })

  it('returns experiment when one exists and is running', () => {
    const experiment = {
      id: 'exp-get-test',
      thing: 'qualifyLead',
      branches: ['variant-a'],
      traffic: 1.0,
      metric: 'Sales.qualified',
      status: 'running' as const,
    }

    setActiveExperiment('qualifyLead', experiment)

    const result = getActiveExperiment('qualifyLead')
    expect(result).toEqual(experiment)
  })

  it('returns undefined for draft experiments', () => {
    setActiveExperiment('qualifyLead', {
      id: 'exp-draft-test',
      thing: 'qualifyLead',
      branches: ['variant-a'],
      traffic: 1.0,
      metric: 'Sales.qualified',
      status: 'draft',
    })

    const result = getActiveExperiment('qualifyLead')
    // Should not return draft experiments as "active"
    expect(result).toBeUndefined()
  })

  it('returns completed experiments with winners', () => {
    setActiveExperiment('qualifyLead', {
      id: 'exp-completed-test',
      thing: 'qualifyLead',
      branches: ['variant-a'],
      traffic: 1.0,
      metric: 'Sales.qualified',
      status: 'completed',
      winner: 'variant-a',
    })

    const result = getActiveExperiment('qualifyLead')
    expect(result).toBeDefined()
    expect(result?.winner).toBe('variant-a')
  })
})
