import { describe, it, expect, beforeEach } from 'vitest'
import {
  findMergeBase,
  findAllMergeBases,
  findForkPoint,
  isAncestor,
  checkAncestor,
  findIndependentCommits,
  findOctopusMergeBase,
  computeThreeWayMergeBase,
  hasCommonHistory,
  computeRecursiveMergeBase,
  CommitProvider,
  MergeBaseResult,
  MergeBaseOptions
} from '../../src/ops/merge-base'
import { CommitObject, Author } from '../../src/types/objects'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock author for testing
 */
function createAuthor(name: string = 'Test User', timestamp: number = 1704067200): Author {
  return {
    name,
    email: `${name.toLowerCase().replace(' ', '.')}@example.com.ai`,
    timestamp,
    timezone: '+0000'
  }
}

/**
 * Create a mock commit object for testing
 */
function createMockCommit(
  sha: string,
  parents: string[] = [],
  message: string = 'Test commit',
  timestamp: number = 1704067200
): CommitObject {
  return {
    type: 'commit',
    data: new Uint8Array(),
    tree: 'tree'.padEnd(40, '0'),
    parents,
    author: createAuthor('Author', timestamp),
    committer: createAuthor('Committer', timestamp),
    message
  }
}

/**
 * Create a mock commit provider for testing
 */
function createMockProvider(
  commits: Map<string, CommitObject>
): CommitProvider {
  return {
    async getCommit(sha: string): Promise<CommitObject | null> {
      return commits.get(sha) ?? null
    }
  }
}

/**
 * Helper to generate deterministic SHA-like strings
 * Uses a delimiter to prevent collisions (e.g., commit1 vs commit10)
 */
function makeSha(prefix: string): string {
  return (prefix + '_').padEnd(40, '0')
}

/**
 * Build a linear commit chain for testing
 * Returns array of SHAs from oldest to newest
 *
 * Example: A <- B <- C <- D
 */
function buildLinearHistory(count: number, startTimestamp: number = 1704067200): {
  commits: Map<string, CommitObject>
  shas: string[]
} {
  const commits = new Map<string, CommitObject>()
  const shas: string[] = []

  for (let i = 0; i < count; i++) {
    const sha = makeSha(`commit${i}`)
    const parents = i > 0 ? [shas[i - 1]] : []
    const timestamp = startTimestamp + i * 3600
    const commit = createMockCommit(sha, parents, `Commit ${i}`, timestamp)
    commits.set(sha, commit)
    shas.push(sha)
  }

  return { commits, shas }
}

/**
 * Build a simple diamond/fork-merge history:
 *
 *     D (merge)
 *    / \
 *   B   C
 *    \ /
 *     A (initial)
 */
function buildDiamondHistory(): {
  commits: Map<string, CommitObject>
  A: string
  B: string
  C: string
  D: string
} {
  const commits = new Map<string, CommitObject>()

  const A = makeSha('commitA')
  const B = makeSha('commitB')
  const C = makeSha('commitC')
  const D = makeSha('commitD')

  commits.set(A, createMockCommit(A, [], 'Initial commit', 1704067200))
  commits.set(B, createMockCommit(B, [A], 'Branch B commit', 1704070800))
  commits.set(C, createMockCommit(C, [A], 'Branch C commit', 1704074400))
  commits.set(D, createMockCommit(D, [B, C], 'Merge commit', 1704078000))

  return { commits, A, B, C, D }
}

/**
 * Build a criss-cross merge history:
 *
 *       E (merge B+D)      F (merge C+D)
 *      / \                / \
 *     |   D (merge A+B)  |
 *     |  /|              |
 *     B   |              C
 *      \  |             /
 *       \ |            /
 *        \|           /
 *         A----------/
 *
 * Simplified criss-cross:
 *
 *       F
 *      /|\
 *     E | \
 *    /| |  \
 *   B | |   C
 *    \|/   /
 *     A---/
 *
 * Proper criss-cross where there are two merge bases:
 *
 *      E (merge of B+C)
 *     /|\
 *    | | \
 *    B-+--C
 *    |\ /|
 *    | X |
 *    |/ \|
 *    D   E' (these are merge bases - both B and C merge from D and E')
 *     \ /
 *      A
 *
 * Actual criss-cross for testing:
 *
 *        F
 *       / \
 *      D   E
 *     /|\ /|
 *    B | X |
 *    |\|/ \|
 *    | C   |
 *    |/   /
 *    A---/
 *
 * Simplest true criss-cross:
 *
 *      E---F
 *     /\ /\
 *    B  X  C
 *     \/ \/
 *      D--E'
 *       \/
 *        A
 *
 * Let's use the canonical example:
 *
 *      E (head1)    F (head2)
 *      |\          /|
 *      | \        / |
 *      |  C------/  |
 *      | /       \  |
 *      |/         \ |
 *      B-----------D
 *       \         /
 *        \       /
 *         \     /
 *          \   /
 *           \ /
 *            A
 *
 * Where:
 * - A is initial commit
 * - B and D are children of A (two branches diverge)
 * - C is merge of B and D (criss-cross point 1)
 * - E is child of B and C (head1)
 * - F is child of D and C (head2 - but wait, this means C is ancestor of F directly)
 *
 * True criss-cross: multiple equally valid merge bases
 *
 *         G
 *        / \
 *       E   F
 *      /\ / \
 *     |  X   |
 *      \/ \ /
 *       B   C
 *        \ /
 *         A
 *
 * Where B = merge(A, ...), C = merge(A, ...)
 * E = merge(B, C), F = merge(B, C) differently
 * G wants to merge E and F -> merge bases are B and C
 */
function buildCrissCrossHistory(): {
  commits: Map<string, CommitObject>
  A: string
  B: string
  C: string
  D: string
  E: string
} {
  const commits = new Map<string, CommitObject>()

  // Base commit
  const A = makeSha('commitA')
  // Two branches from A
  const B = makeSha('commitB')
  const C = makeSha('commitC')
  // D merges B and C
  const D = makeSha('commitD')
  // E also merges B and C (different merge)
  const E = makeSha('commitE')

  commits.set(A, createMockCommit(A, [], 'Initial', 1704067200))
  commits.set(B, createMockCommit(B, [A], 'Branch B', 1704070800))
  commits.set(C, createMockCommit(C, [A], 'Branch C', 1704074400))
  // Both D and E merge B and C
  commits.set(D, createMockCommit(D, [B, C], 'Merge 1 (B+C)', 1704078000))
  commits.set(E, createMockCommit(E, [C, B], 'Merge 2 (C+B)', 1704081600))

  // Now if we try to find merge base of D and E, we should get both B and C
  // because both are equally valid merge bases (criss-cross)

  return { commits, A, B, C, D, E }
}

/**
 * Build history with multiple common ancestors at different depths
 *
 *           G
 *          / \
 *         E   F
 *        / \ / \
 *       B   C   D
 *        \ / \ /
 *         A   A' (two roots, or same root)
 *
 * Actually, let's do:
 *
 *         F (head)
 *        /|
 *       E |
 *      /| |
 *     B | |
 *      \| |
 *       C-+
 *      /| |
 *     D | |
 *      \|/
 *       A
 */
function buildMultipleCommonAncestors(): {
  commits: Map<string, CommitObject>
  shas: Record<string, string>
} {
  const commits = new Map<string, CommitObject>()

  const A = makeSha('commitA')
  const B = makeSha('commitB')
  const C = makeSha('commitC')
  const D = makeSha('commitD')
  const E = makeSha('commitE')
  const F = makeSha('commitF')

  // Linear base: A <- B <- C
  commits.set(A, createMockCommit(A, [], 'A: Root', 1704067200))
  commits.set(B, createMockCommit(B, [A], 'B: Second', 1704070800))
  commits.set(C, createMockCommit(C, [B], 'C: Third', 1704074400))

  // D branches from A
  commits.set(D, createMockCommit(D, [A], 'D: Branch from A', 1704072000))

  // E branches from C
  commits.set(E, createMockCommit(E, [C], 'E: Branch from C', 1704078000))

  // F branches from D
  commits.set(F, createMockCommit(F, [D], 'F: Branch from D', 1704081600))

  return { commits, shas: { A, B, C, D, E, F } }
}

/**
 * Build an octopus merge history (merging more than 2 branches):
 *
 *         E (octopus merge of B, C, D)
 *        /|\
 *       B C D
 *        \|/
 *         A
 */
function buildOctopusHistory(): {
  commits: Map<string, CommitObject>
  A: string
  B: string
  C: string
  D: string
  E: string
} {
  const commits = new Map<string, CommitObject>()

  const A = makeSha('commitA')
  const B = makeSha('commitB')
  const C = makeSha('commitC')
  const D = makeSha('commitD')
  const E = makeSha('commitE')

  commits.set(A, createMockCommit(A, [], 'Initial', 1704067200))
  commits.set(B, createMockCommit(B, [A], 'Branch B', 1704070800))
  commits.set(C, createMockCommit(C, [A], 'Branch C', 1704074400))
  commits.set(D, createMockCommit(D, [A], 'Branch D', 1704078000))
  // Octopus merge: 3 parents
  commits.set(E, createMockCommit(E, [B, C, D], 'Octopus merge', 1704081600))

  return { commits, A, B, C, D, E }
}

/**
 * Build two completely unrelated histories (no common ancestor)
 *
 *    B        D
 *    |        |
 *    A        C
 *
 * A-B and C-D have no shared history
 */
function buildUnrelatedHistories(): {
  commits: Map<string, CommitObject>
  A: string
  B: string
  C: string
  D: string
} {
  const commits = new Map<string, CommitObject>()

  const A = makeSha('commitA')
  const B = makeSha('commitB')
  const C = makeSha('commitC')
  const D = makeSha('commitD')

  // First unrelated chain
  commits.set(A, createMockCommit(A, [], 'Root 1', 1704067200))
  commits.set(B, createMockCommit(B, [A], 'Child 1', 1704070800))

  // Second unrelated chain
  commits.set(C, createMockCommit(C, [], 'Root 2', 1704074400))
  commits.set(D, createMockCommit(D, [C], 'Child 2', 1704078000))

  return { commits, A, B, C, D }
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Merge Base Finding', () => {

  // ==========================================================================
  // Simple Linear Merge Base
  // ==========================================================================

  describe('Simple linear merge base', () => {
    it('should find merge base when one commit is ancestor of another', async () => {
      const { commits, shas } = buildLinearHistory(5)
      const provider = createMockProvider(commits)

      // shas[2] is ancestor of shas[4]
      const result = await findMergeBase(provider, [shas[4], shas[2]])

      expect(result.hasCommonHistory).toBe(true)
      expect(result.bases).toContain(shas[2])
      expect(result.isUnique).toBe(true)
      expect(result.count).toBe(1)
    })

    it('should find merge base of two commits on same branch', async () => {
      const { commits, shas } = buildLinearHistory(5)
      const provider = createMockProvider(commits)

      // Both are on same linear history, base should be the earlier one
      const result = await findMergeBase(provider, [shas[3], shas[1]])

      expect(result.hasCommonHistory).toBe(true)
      expect(result.bases).toContain(shas[1])
    })

    it('should return the same commit when merging with itself', async () => {
      const { commits, shas } = buildLinearHistory(3)
      const provider = createMockProvider(commits)

      const result = await findMergeBase(provider, [shas[1], shas[1]])

      expect(result.hasCommonHistory).toBe(true)
      expect(result.bases).toContain(shas[1])
      expect(result.isUnique).toBe(true)
    })

    it('should find common ancestor of diverged branches', async () => {
      const { commits, A, B, C } = buildDiamondHistory()
      const provider = createMockProvider(commits)

      // B and C both have A as their common ancestor
      const result = await findMergeBase(provider, [B, C])

      expect(result.hasCommonHistory).toBe(true)
      expect(result.bases).toContain(A)
      expect(result.isUnique).toBe(true)
    })

    it('should handle merge commit as one of the inputs', async () => {
      const { commits, A, B, D } = buildDiamondHistory()
      const provider = createMockProvider(commits)

      // D is merge of B and C, finding base of D and B should be B
      const result = await findMergeBase(provider, [D, B])

      expect(result.hasCommonHistory).toBe(true)
      expect(result.bases).toContain(B)
    })

    it('should find correct merge base with deep history', async () => {
      const { commits, shas } = buildLinearHistory(100)
      const provider = createMockProvider(commits)

      const result = await findMergeBase(provider, [shas[99], shas[50]])

      expect(result.hasCommonHistory).toBe(true)
      expect(result.bases).toContain(shas[50])
    })
  })

  // ==========================================================================
  // Multiple Common Ancestors
  // ==========================================================================

  describe('Multiple common ancestors', () => {
    it('should find all merge bases in criss-cross merge scenario', async () => {
      const { commits, B, C, D, E } = buildCrissCrossHistory()
      const provider = createMockProvider(commits)

      // D and E both merge B and C, so B and C are both merge bases
      const bases = await findAllMergeBases(provider, D, E)

      expect(bases.length).toBe(2)
      expect(bases).toContain(B)
      expect(bases).toContain(C)
    })

    it('should return multiple bases when all=true option is set', async () => {
      const { commits, B, C, D, E } = buildCrissCrossHistory()
      const provider = createMockProvider(commits)

      const result = await findMergeBase(provider, [D, E], { all: true })

      expect(result.count).toBe(2)
      expect(result.bases).toContain(B)
      expect(result.bases).toContain(C)
      expect(result.isUnique).toBe(false)
    })

    it('should return only one base by default even when multiple exist', async () => {
      const { commits, B, C, D, E } = buildCrissCrossHistory()
      const provider = createMockProvider(commits)

      // Default behavior: return just one (any valid) merge base
      const result = await findMergeBase(provider, [D, E])

      expect(result.count).toBe(1)
      expect(result.bases.length).toBe(1)
      // Should be one of B or C
      expect([B, C]).toContain(result.bases[0])
    })

    it('should handle history with multiple ancestor paths', async () => {
      const { commits, shas } = buildMultipleCommonAncestors()
      const provider = createMockProvider(commits)

      // E (from C) and F (from D) have A as common ancestor
      // since D branches from A and C comes from B which comes from A
      const result = await findMergeBase(provider, [shas.E, shas.F])

      expect(result.hasCommonHistory).toBe(true)
      expect(result.bases).toContain(shas.A)
    })

    it('should not include ancestors of other merge bases', async () => {
      const { commits, A, B, C, D, E } = buildCrissCrossHistory()
      const provider = createMockProvider(commits)

      // A is an ancestor of both B and C, so it should NOT be included
      // Only B and C (maximal common ancestors) should be included
      const bases = await findAllMergeBases(provider, D, E)

      expect(bases).not.toContain(A)
      expect(bases).toContain(B)
      expect(bases).toContain(C)
    })
  })

  // ==========================================================================
  // Criss-Cross Merge Scenarios
  // ==========================================================================

  describe('Criss-cross merge scenarios', () => {
    it('should detect criss-cross merge situation', async () => {
      const { commits, D, E } = buildCrissCrossHistory()
      const provider = createMockProvider(commits)

      const result = await findMergeBase(provider, [D, E], { all: true })

      // Criss-cross is characterized by multiple merge bases
      expect(result.isUnique).toBe(false)
      expect(result.count).toBeGreaterThan(1)
    })

    it('should compute recursive merge base for criss-cross', async () => {
      const { commits, D, E } = buildCrissCrossHistory()
      const provider = createMockProvider(commits)

      // Recursive merge base should handle the criss-cross
      const result = await computeRecursiveMergeBase(provider, D, E)

      expect(result.hasCommonHistory).toBe(true)
      // Recursive merge creates a virtual merge base
      expect(result.bases.length).toBe(1)
    })

    it('should handle complex criss-cross with multiple levels', async () => {
      const commits = new Map<string, CommitObject>()

      // Build a more complex criss-cross
      //         H
      //        / \
      //       F   G
      //      /|\ /|\
      //     | D-+-E |
      //     |/|\ /|\|
      //     B-+-X-+-C
      //      \|/ \|/
      //       A

      const A = makeSha('A')
      const B = makeSha('B')
      const C = makeSha('C')
      const D = makeSha('D')
      const E = makeSha('E')
      const F = makeSha('F')
      const G = makeSha('G')
      const H = makeSha('H')

      commits.set(A, createMockCommit(A, [], 'A'))
      commits.set(B, createMockCommit(B, [A], 'B'))
      commits.set(C, createMockCommit(C, [A], 'C'))
      commits.set(D, createMockCommit(D, [B, C], 'D'))
      commits.set(E, createMockCommit(E, [C, B], 'E'))
      commits.set(F, createMockCommit(F, [D, E], 'F'))
      commits.set(G, createMockCommit(G, [E, D], 'G'))
      commits.set(H, createMockCommit(H, [F, G], 'H'))

      const provider = createMockProvider(commits)

      // F and G are criss-cross merges of D and E
      const result = await findMergeBase(provider, [F, G], { all: true })

      expect(result.hasCommonHistory).toBe(true)
      expect(result.count).toBeGreaterThanOrEqual(2)
    })

    it('should find correct base after criss-cross is resolved', async () => {
      const { commits, B, C, D, E } = buildCrissCrossHistory()
      const provider = createMockProvider(commits)

      // If we add a merge commit that resolves the criss-cross
      const F = makeSha('F')
      commits.set(F, createMockCommit(F, [D, E], 'Merge D+E'))

      // Now finding base of F with any branch should work
      const result = await findMergeBase(provider, [F, B])

      expect(result.hasCommonHistory).toBe(true)
      expect(result.bases).toContain(B)
    })
  })

  // ==========================================================================
  // Octopus Merge Base
  // ==========================================================================

  describe('Octopus merge base', () => {
    it('should find merge base for three branches', async () => {
      const { commits, A, B, C, D } = buildOctopusHistory()
      const provider = createMockProvider(commits)

      // B, C, D all branch from A
      const bases = await findOctopusMergeBase(provider, [B, C, D])

      expect(bases).toContain(A)
    })

    it('should find merge base for four or more branches', async () => {
      const commits = new Map<string, CommitObject>()

      const A = makeSha('A')
      const B = makeSha('B')
      const C = makeSha('C')
      const D = makeSha('D')
      const E = makeSha('E')

      commits.set(A, createMockCommit(A, [], 'Root'))
      commits.set(B, createMockCommit(B, [A], 'B'))
      commits.set(C, createMockCommit(C, [A], 'C'))
      commits.set(D, createMockCommit(D, [A], 'D'))
      commits.set(E, createMockCommit(E, [A], 'E'))

      const provider = createMockProvider(commits)

      const bases = await findOctopusMergeBase(provider, [B, C, D, E])

      expect(bases).toContain(A)
    })

    it('should handle octopus with uneven branch depths', async () => {
      const commits = new Map<string, CommitObject>()

      const A = makeSha('A')
      const B = makeSha('B')
      const B2 = makeSha('B2')
      const B3 = makeSha('B3')
      const C = makeSha('C')
      const D = makeSha('D')
      const D2 = makeSha('D2')

      commits.set(A, createMockCommit(A, [], 'Root'))
      // Branch B is deep: A <- B <- B2 <- B3
      commits.set(B, createMockCommit(B, [A], 'B'))
      commits.set(B2, createMockCommit(B2, [B], 'B2'))
      commits.set(B3, createMockCommit(B3, [B2], 'B3'))
      // Branch C is shallow: A <- C
      commits.set(C, createMockCommit(C, [A], 'C'))
      // Branch D is medium: A <- D <- D2
      commits.set(D, createMockCommit(D, [A], 'D'))
      commits.set(D2, createMockCommit(D2, [D], 'D2'))

      const provider = createMockProvider(commits)

      // Find base for tips of all three branches
      const bases = await findOctopusMergeBase(provider, [B3, C, D2])

      expect(bases).toContain(A)
    })

    it('should return empty when no common base exists for octopus', async () => {
      const { commits, A, B, C, D } = buildUnrelatedHistories()
      const provider = createMockProvider(commits)

      // B (from chain 1) and D (from chain 2) have no common history
      // If we try octopus with unrelated commits
      const bases = await findOctopusMergeBase(provider, [B, D])

      expect(bases).toEqual([])
    })

    it('should use octopus option in findMergeBase', async () => {
      const { commits, A, B, C, D } = buildOctopusHistory()
      const provider = createMockProvider(commits)

      const result = await findMergeBase(provider, [B, C, D], { octopus: true })

      expect(result.hasCommonHistory).toBe(true)
      expect(result.bases).toContain(A)
    })
  })

  // ==========================================================================
  // No Common Ancestor Case
  // ==========================================================================

  describe('No common ancestor case', () => {
    it('should return empty bases when commits have no common history', async () => {
      const { commits, B, D } = buildUnrelatedHistories()
      const provider = createMockProvider(commits)

      const result = await findMergeBase(provider, [B, D])

      expect(result.hasCommonHistory).toBe(false)
      expect(result.bases).toEqual([])
      expect(result.count).toBe(0)
    })

    it('should return null from findAllMergeBases when no common ancestor', async () => {
      const { commits, B, D } = buildUnrelatedHistories()
      const provider = createMockProvider(commits)

      const bases = await findAllMergeBases(provider, B, D)

      expect(bases).toEqual([])
    })

    it('should handle hasCommonHistory returning false', async () => {
      const { commits, B, D } = buildUnrelatedHistories()
      const provider = createMockProvider(commits)

      const result = await hasCommonHistory(provider, [B, D])

      expect(result).toBe(false)
    })

    it('should return true for hasCommonHistory with related commits', async () => {
      const { commits, A, B, C } = buildDiamondHistory()
      const provider = createMockProvider(commits)

      const result = await hasCommonHistory(provider, [B, C])

      expect(result).toBe(true)
    })

    it('should handle single commit with no parents', async () => {
      const commits = new Map<string, CommitObject>()
      const A = makeSha('A')
      commits.set(A, createMockCommit(A, [], 'Orphan'))

      const provider = createMockProvider(commits)

      // Finding base with itself should still work
      const result = await findMergeBase(provider, [A, A])

      expect(result.hasCommonHistory).toBe(true)
      expect(result.bases).toContain(A)
    })

    it('should handle non-existent commit SHA gracefully', async () => {
      const { commits, shas } = buildLinearHistory(3)
      const provider = createMockProvider(commits)

      const nonexistent = makeSha('nonexistent')

      // Should handle gracefully, not throw
      const result = await findMergeBase(provider, [shas[0], nonexistent])

      expect(result.hasCommonHistory).toBe(false)
      expect(result.bases).toEqual([])
    })
  })

  // ==========================================================================
  // Ancestor Checking
  // ==========================================================================

  describe('Ancestor checking', () => {
    it('should return true when commit is ancestor', async () => {
      const { commits, shas } = buildLinearHistory(5)
      const provider = createMockProvider(commits)

      const result = await isAncestor(provider, shas[1], shas[4])

      expect(result).toBe(true)
    })

    it('should return false when commit is not ancestor', async () => {
      const { commits, shas } = buildLinearHistory(5)
      const provider = createMockProvider(commits)

      const result = await isAncestor(provider, shas[4], shas[1])

      expect(result).toBe(false)
    })

    it('should return true when commit is its own ancestor', async () => {
      const { commits, shas } = buildLinearHistory(3)
      const provider = createMockProvider(commits)

      const result = await isAncestor(provider, shas[1], shas[1])

      expect(result).toBe(true)
    })

    it('should find ancestor through merge commit', async () => {
      const { commits, A, D } = buildDiamondHistory()
      const provider = createMockProvider(commits)

      // A is reachable from D through both B and C
      const result = await isAncestor(provider, A, D)

      expect(result).toBe(true)
    })

    it('should return detailed ancestor check result', async () => {
      const { commits, shas } = buildLinearHistory(5)
      const provider = createMockProvider(commits)

      const result = await checkAncestor(provider, shas[1], shas[4])

      expect(result.isAncestor).toBe(true)
      expect(result.distance).toBe(3) // 4 -> 3 -> 2 -> 1 = 3 steps
    })

    it('should return -1 distance when not ancestor', async () => {
      const { commits, shas } = buildLinearHistory(5)
      const provider = createMockProvider(commits)

      const result = await checkAncestor(provider, shas[4], shas[1])

      expect(result.isAncestor).toBe(false)
      expect(result.distance).toBe(-1)
    })
  })

  // ==========================================================================
  // Independent Commits
  // ==========================================================================

  describe('Independent commits', () => {
    it('should find independent commits (not reachable from each other)', async () => {
      const { commits, B, C } = buildDiamondHistory()
      const provider = createMockProvider(commits)

      // B and C are independent - neither is reachable from the other
      const independent = await findIndependentCommits(provider, [B, C])

      expect(independent).toContain(B)
      expect(independent).toContain(C)
    })

    it('should filter out ancestors when finding independent', async () => {
      const { commits, A, B, C, D } = buildDiamondHistory()
      const provider = createMockProvider(commits)

      // A is ancestor of B and C, D is merge of B and C
      const independent = await findIndependentCommits(provider, [A, B, C, D])

      // Only D should remain (it's the only one not reachable from any other in the set)
      expect(independent).toContain(D)
      expect(independent).not.toContain(A) // A is ancestor of B, C, D
    })

    it('should return all when none are related', async () => {
      const { commits, A, C } = buildUnrelatedHistories()
      const provider = createMockProvider(commits)

      // A and C are roots of unrelated histories
      const independent = await findIndependentCommits(provider, [A, C])

      expect(independent).toContain(A)
      expect(independent).toContain(C)
    })

    it('should handle single commit', async () => {
      const { commits, shas } = buildLinearHistory(1)
      const provider = createMockProvider(commits)

      const independent = await findIndependentCommits(provider, [shas[0]])

      expect(independent).toContain(shas[0])
    })

    it('should use independent option in findMergeBase', async () => {
      const { commits, A, B, C, D } = buildDiamondHistory()
      const provider = createMockProvider(commits)

      const result = await findMergeBase(provider, [A, B, C, D], { independent: true })

      expect(result.bases).toContain(D)
      expect(result.bases).not.toContain(A)
    })
  })

  // ==========================================================================
  // Fork Point Detection
  // ==========================================================================

  describe('Fork point detection', () => {
    it('should find fork point of a branch', async () => {
      const { commits, A, B } = buildDiamondHistory()
      const provider = createMockProvider(commits)

      // B forked from A
      const result = await findForkPoint(provider, B, A)

      expect(result.found).toBe(true)
      expect(result.forkPoint).toBe(A)
    })

    it('should calculate commits since fork', async () => {
      const { commits, shas } = buildLinearHistory(5)
      const provider = createMockProvider(commits)

      // Simulate a branch from shas[2] with shas[4] as tip
      const result = await findForkPoint(provider, shas[4], shas[2])

      expect(result.found).toBe(true)
      expect(result.commitsSinceFork).toBe(2) // shas[3] and shas[4]
    })

    it('should return not found when no common fork', async () => {
      const { commits, B, D } = buildUnrelatedHistories()
      const provider = createMockProvider(commits)

      const result = await findForkPoint(provider, B, D)

      expect(result.found).toBe(false)
      expect(result.forkPoint).toBeNull()
    })

    it('should use reflog for better fork point detection', async () => {
      const { commits, shas } = buildLinearHistory(5)
      const provider = createMockProvider(commits)

      // Simulate reflog with rebase history
      const reflog = [
        shas[4],
        shas[3],
        shas[2] // Original base before rebase
      ]

      const result = await findForkPoint(provider, shas[4], shas[0], reflog)

      expect(result.found).toBe(true)
      // Fork point should be found using reflog
    })

    it('should use forkPoint option in findMergeBase', async () => {
      const { commits, A, B, C } = buildDiamondHistory()
      const provider = createMockProvider(commits)

      const result = await findMergeBase(provider, [B, A], { forkPoint: true })

      expect(result.hasCommonHistory).toBe(true)
      expect(result.bases).toContain(A)
    })
  })

  // ==========================================================================
  // Three-Way Merge Base
  // ==========================================================================

  describe('Three-way merge base', () => {
    it('should compute three-way merge base', async () => {
      const { commits, A, B, C } = buildDiamondHistory()
      const provider = createMockProvider(commits)

      const result = await computeThreeWayMergeBase(provider, B, C)

      expect(result.hasCommonHistory).toBe(true)
      expect(result.bases).toContain(A)
    })

    it('should handle fast-forward case', async () => {
      const { commits, shas } = buildLinearHistory(5)
      const provider = createMockProvider(commits)

      // shas[2] is ancestor of shas[4]
      const result = await computeThreeWayMergeBase(provider, shas[4], shas[2])

      expect(result.hasCommonHistory).toBe(true)
      expect(result.bases).toContain(shas[2])
    })

    it('should handle no common history', async () => {
      const { commits, B, D } = buildUnrelatedHistories()
      const provider = createMockProvider(commits)

      const result = await computeThreeWayMergeBase(provider, B, D)

      expect(result.hasCommonHistory).toBe(false)
      expect(result.bases).toEqual([])
    })
  })

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  describe('Edge cases', () => {
    it('should handle empty commit list', async () => {
      const provider = createMockProvider(new Map())

      const result = await findMergeBase(provider, [])

      expect(result.bases).toEqual([])
      expect(result.hasCommonHistory).toBe(false)
    })

    it('should handle single commit in list', async () => {
      const { commits, shas } = buildLinearHistory(3)
      const provider = createMockProvider(commits)

      const result = await findMergeBase(provider, [shas[1]])

      expect(result.bases).toContain(shas[1])
      expect(result.hasCommonHistory).toBe(true)
    })

    it('should handle very long commit history efficiently', async () => {
      const { commits, shas } = buildLinearHistory(1000)
      const provider = createMockProvider(commits)

      const startTime = Date.now()
      const result = await findMergeBase(provider, [shas[999], shas[500]])
      const elapsed = Date.now() - startTime

      expect(result.hasCommonHistory).toBe(true)
      expect(result.bases).toContain(shas[500])
      // Should complete in reasonable time (under 1 second)
      expect(elapsed).toBeLessThan(1000)
    })

    it('should handle commit with many parents', async () => {
      const commits = new Map<string, CommitObject>()

      const root = makeSha('root')
      const branches: string[] = []

      commits.set(root, createMockCommit(root, [], 'Root'))

      // Create 10 branches from root
      for (let i = 0; i < 10; i++) {
        const sha = makeSha(`branch${i}`)
        commits.set(sha, createMockCommit(sha, [root], `Branch ${i}`))
        branches.push(sha)
      }

      // Create merge with all 10 parents
      const megaMerge = makeSha('megamerge')
      commits.set(megaMerge, createMockCommit(megaMerge, branches, 'Mega merge'))

      const provider = createMockProvider(commits)

      const result = await findMergeBase(provider, [megaMerge, root])

      expect(result.hasCommonHistory).toBe(true)
      expect(result.bases).toContain(root)
    })

    it('should handle diamond within diamond (nested merges)', async () => {
      const commits = new Map<string, CommitObject>()

      //       H
      //      / \
      //     F   G
      //    / \ / \
      //   D   E   |
      //  / \ / \ /
      // A   B   C

      const A = makeSha('A')
      const B = makeSha('B')
      const C = makeSha('C')
      const D = makeSha('D')
      const E = makeSha('E')
      const F = makeSha('F')
      const G = makeSha('G')
      const H = makeSha('H')

      commits.set(A, createMockCommit(A, [], 'A'))
      commits.set(B, createMockCommit(B, [A], 'B'))
      commits.set(C, createMockCommit(C, [B], 'C'))
      commits.set(D, createMockCommit(D, [A, B], 'D'))
      commits.set(E, createMockCommit(E, [B, C], 'E'))
      commits.set(F, createMockCommit(F, [D, E], 'F'))
      commits.set(G, createMockCommit(G, [E, C], 'G'))
      commits.set(H, createMockCommit(H, [F, G], 'H'))

      const provider = createMockProvider(commits)

      // Find merge base of F and G
      const result = await findMergeBase(provider, [F, G], { all: true })

      expect(result.hasCommonHistory).toBe(true)
      // E should be in the merge bases since both F and G have E as parent
      expect(result.bases).toContain(E)
    })
  })
})
