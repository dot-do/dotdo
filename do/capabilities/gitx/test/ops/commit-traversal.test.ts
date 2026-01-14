import { describe, it, expect, beforeEach } from 'vitest'
import {
  CommitWalker,
  walkCommits,
  isAncestor,
  findCommonAncestor,
  findMergeBase,
  topologicalSort,
  sortByDate,
  CommitProvider,
  TraversalOptions,
  TraversalCommit,
  parseRevisionRange,
  expandRevisionRange,
  getCommitsBetween,
  countCommits
} from '../../src/ops/commit-traversal'
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
    email: `${name.toLowerCase().replace(/\s+/g, '.')}@example.com.ai`,
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
  commits: Map<string, CommitObject>,
  pathCommits?: Map<string, string[]>
): CommitProvider {
  return {
    async getCommit(sha: string): Promise<CommitObject | null> {
      return commits.get(sha) ?? null
    },
    async getCommitsForPath(path: string): Promise<string[]> {
      return pathCommits?.get(path) ?? []
    }
  }
}

/**
 * Build a linear commit chain for testing
 * Returns array of SHAs from oldest to newest
 */
function buildLinearHistory(count: number, startTimestamp: number = 1704067200): {
  commits: Map<string, CommitObject>
  shas: string[]
} {
  const commits = new Map<string, CommitObject>()
  const shas: string[] = []

  for (let i = 0; i < count; i++) {
    const sha = `commit${String(i).padStart(36, '0')}`
    const parents = i > 0 ? [shas[i - 1]] : []
    const timestamp = startTimestamp + i * 3600 // 1 hour apart
    const commit = createMockCommit(sha, parents, `Commit ${i}`, timestamp)
    commits.set(sha, commit)
    shas.push(sha)
  }

  return { commits, shas }
}

/**
 * Build a diamond merge history for testing:
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

  const A = 'commitA'.padEnd(40, '0')
  const B = 'commitB'.padEnd(40, '0')
  const C = 'commitC'.padEnd(40, '0')
  const D = 'commitD'.padEnd(40, '0')

  commits.set(A, createMockCommit(A, [], 'Initial commit', 1704067200))
  commits.set(B, createMockCommit(B, [A], 'Branch B commit', 1704070800))
  commits.set(C, createMockCommit(C, [A], 'Branch C commit', 1704074400))
  commits.set(D, createMockCommit(D, [B, C], 'Merge commit', 1704078000))

  return { commits, A, B, C, D }
}

/**
 * Build a complex forked history with multiple branches:
 *
 *       G
 *      / \
 *     E   F
 *     |   |
 *     D   |
 *    / \  |
 *   B   C |
 *    \ /  |
 *     A --+
 */
function buildComplexHistory(): {
  commits: Map<string, CommitObject>
  shas: Record<string, string>
} {
  const commits = new Map<string, CommitObject>()

  const A = 'commitA'.padEnd(40, '0')
  const B = 'commitB'.padEnd(40, '0')
  const C = 'commitC'.padEnd(40, '0')
  const D = 'commitD'.padEnd(40, '0')
  const E = 'commitE'.padEnd(40, '0')
  const F = 'commitF'.padEnd(40, '0')
  const G = 'commitG'.padEnd(40, '0')

  commits.set(A, createMockCommit(A, [], 'A: Initial', 1704067200))
  commits.set(B, createMockCommit(B, [A], 'B: Feature 1', 1704070800))
  commits.set(C, createMockCommit(C, [A], 'C: Feature 2', 1704074400))
  commits.set(D, createMockCommit(D, [B, C], 'D: Merge B+C', 1704078000))
  commits.set(E, createMockCommit(E, [D], 'E: Continue', 1704081600))
  commits.set(F, createMockCommit(F, [A], 'F: Hotfix', 1704072000))
  commits.set(G, createMockCommit(G, [E, F], 'G: Final merge', 1704085200))

  return { commits, shas: { A, B, C, D, E, F, G } }
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Commit Graph Traversal', () => {

  // ==========================================================================
  // Parent Chain Walking
  // ==========================================================================

  describe('Parent Chain Walking', () => {
    describe('walkCommits - basic parent traversal', () => {
      it('should walk a single commit with no parents', async () => {
        const commits = new Map<string, CommitObject>()
        const sha = 'initial'.padEnd(40, '0')
        commits.set(sha, createMockCommit(sha, [], 'Initial'))
        const provider = createMockProvider(commits)

        const walked: TraversalCommit[] = []
        for await (const commit of walkCommits(provider, sha)) {
          walked.push(commit)
        }

        expect(walked.length).toBe(1)
        expect(walked[0].sha).toBe(sha)
        expect(walked[0].depth).toBe(0)
      })

      it('should walk parent chain from child to root', async () => {
        const { commits, shas } = buildLinearHistory(5)
        const provider = createMockProvider(commits)
        const head = shas[shas.length - 1]

        const walked: string[] = []
        for await (const commit of walkCommits(provider, head)) {
          walked.push(commit.sha)
        }

        // Should visit all 5 commits from newest to oldest
        expect(walked).toEqual(shas.slice().reverse())
      })

      it('should correctly track depth during parent walking', async () => {
        const { commits, shas } = buildLinearHistory(4)
        const provider = createMockProvider(commits)

        const depths: Map<string, number> = new Map()
        for await (const commit of walkCommits(provider, shas[3])) {
          depths.set(commit.sha, commit.depth)
        }

        expect(depths.get(shas[3])).toBe(0) // head
        expect(depths.get(shas[2])).toBe(1) // parent
        expect(depths.get(shas[1])).toBe(2) // grandparent
        expect(depths.get(shas[0])).toBe(3) // great-grandparent
      })

      it('should handle multiple parent walks from different starting points', async () => {
        const { commits, shas } = buildLinearHistory(5)
        const provider = createMockProvider(commits)

        // Start from commit 2 (not head)
        const walked: string[] = []
        for await (const commit of walkCommits(provider, shas[2])) {
          walked.push(commit.sha)
        }

        // Should only include shas[0], shas[1], shas[2]
        expect(walked.length).toBe(3)
        expect(walked).toContain(shas[0])
        expect(walked).toContain(shas[1])
        expect(walked).toContain(shas[2])
        expect(walked).not.toContain(shas[3])
        expect(walked).not.toContain(shas[4])
      })
    })

    describe('walkCommits - merge parent handling', () => {
      it('should visit both parents of merge commit', async () => {
        const { commits, A, B, C, D } = buildDiamondHistory()
        const provider = createMockProvider(commits)

        const walked: string[] = []
        for await (const commit of walkCommits(provider, D)) {
          walked.push(commit.sha)
        }

        expect(walked).toContain(D) // merge commit
        expect(walked).toContain(B) // first parent
        expect(walked).toContain(C) // second parent
        expect(walked).toContain(A) // common ancestor
      })

      it('should not visit a commit twice in diamond history', async () => {
        const { commits, A, D } = buildDiamondHistory()
        const provider = createMockProvider(commits)

        const walked: string[] = []
        for await (const commit of walkCommits(provider, D)) {
          walked.push(commit.sha)
        }

        // A is reachable via both B and C, but should only appear once
        const countA = walked.filter(sha => sha === A).length
        expect(countA).toBe(1)
      })

      it('should identify merge commits with isMerge flag', async () => {
        const { commits, A, B, C, D } = buildDiamondHistory()
        const provider = createMockProvider(commits)

        const mergeStatus: Map<string, boolean> = new Map()
        for await (const commit of walkCommits(provider, D)) {
          mergeStatus.set(commit.sha, commit.isMerge)
        }

        expect(mergeStatus.get(D)).toBe(true)  // D has 2 parents
        expect(mergeStatus.get(B)).toBe(false) // B has 1 parent
        expect(mergeStatus.get(C)).toBe(false) // C has 1 parent
        expect(mergeStatus.get(A)).toBe(false) // A has 0 parents
      })

      it('should walk first parent only when firstParentOnly is true', async () => {
        const { commits, A, B, C, D } = buildDiamondHistory()
        const provider = createMockProvider(commits)

        const walked: string[] = []
        for await (const commit of walkCommits(provider, D, { firstParentOnly: true })) {
          walked.push(commit.sha)
        }

        // Should follow D -> B -> A (first parent chain)
        expect(walked).toContain(D)
        expect(walked).toContain(B) // first parent
        expect(walked).toContain(A)
        expect(walked).not.toContain(C) // second parent should be skipped
      })
    })

    describe('CommitWalker class - manual iteration', () => {
      it('should allow pushing starting commits', async () => {
        const { commits, shas } = buildLinearHistory(3)
        const provider = createMockProvider(commits)

        const walker = new CommitWalker(provider)
        walker.push(shas[2])

        const first = await walker.next()
        expect(first).not.toBeNull()
        expect(first?.sha).toBe(shas[2])
      })

      it('should hide commits and stop walking their ancestors', async () => {
        const { commits, shas } = buildLinearHistory(5)
        const provider = createMockProvider(commits)

        const walker = new CommitWalker(provider)
        walker.push(shas[4])
        walker.hide(shas[2]) // Hide commit 2 and below

        const walked: string[] = []
        let commit = await walker.next()
        while (commit) {
          walked.push(commit.sha)
          commit = await walker.next()
        }

        expect(walked).toContain(shas[4])
        expect(walked).toContain(shas[3])
        expect(walked).not.toContain(shas[2])
        expect(walked).not.toContain(shas[1])
        expect(walked).not.toContain(shas[0])
      })

      it('should reset state and allow new walk', async () => {
        const { commits, shas } = buildLinearHistory(3)
        const provider = createMockProvider(commits)

        const walker = new CommitWalker(provider)
        walker.push(shas[2])
        await walker.next()
        await walker.next()

        walker.reset()
        walker.push(shas[1])

        const commit = await walker.next()
        expect(commit?.sha).toBe(shas[1])
      })

      it('should report hasNext correctly', async () => {
        const { commits, shas } = buildLinearHistory(2)
        const provider = createMockProvider(commits)

        const walker = new CommitWalker(provider)
        walker.push(shas[1])

        expect(walker.hasNext()).toBe(true)
        await walker.next() // commit 1
        expect(walker.hasNext()).toBe(true)
        await walker.next() // commit 0
        expect(walker.hasNext()).toBe(false)
      })
    })
  })

  // ==========================================================================
  // Topological Ordering
  // ==========================================================================

  describe('Topological Ordering', () => {
    describe('topologicalSort function', () => {
      it('should place children before parents in output', async () => {
        const { commits, A, B, C, D } = buildDiamondHistory()
        const provider = createMockProvider(commits)

        const sorted = await topologicalSort(provider, [A, B, C, D])

        const indexD = sorted.indexOf(D)
        const indexB = sorted.indexOf(B)
        const indexC = sorted.indexOf(C)
        const indexA = sorted.indexOf(A)

        expect(indexD).toBeLessThan(indexB)
        expect(indexD).toBeLessThan(indexC)
        expect(indexB).toBeLessThan(indexA)
        expect(indexC).toBeLessThan(indexA)
      })

      it('should handle linear history correctly', async () => {
        const { commits, shas } = buildLinearHistory(5)
        const provider = createMockProvider(commits)

        const sorted = await topologicalSort(provider, shas)

        // Newest should come first, oldest last
        expect(sorted[0]).toBe(shas[4])
        expect(sorted[4]).toBe(shas[0])
      })

      it('should handle complex merge history', async () => {
        const { commits, shas } = buildComplexHistory()
        const provider = createMockProvider(commits)

        const sorted = await topologicalSort(provider, Object.values(shas))

        // G should be first (no children in set), A should be last (no parents)
        expect(sorted[0]).toBe(shas.G)
        expect(sorted[sorted.length - 1]).toBe(shas.A)

        // E should come before D (E is child of D)
        expect(sorted.indexOf(shas.E)).toBeLessThan(sorted.indexOf(shas.D))

        // D should come before B and C
        expect(sorted.indexOf(shas.D)).toBeLessThan(sorted.indexOf(shas.B))
        expect(sorted.indexOf(shas.D)).toBeLessThan(sorted.indexOf(shas.C))
      })

      it('should return empty array for empty input', async () => {
        const provider = createMockProvider(new Map())
        const sorted = await topologicalSort(provider, [])
        expect(sorted).toEqual([])
      })

      it('should handle single commit', async () => {
        const commits = new Map<string, CommitObject>()
        const sha = 'single'.padEnd(40, '0')
        commits.set(sha, createMockCommit(sha, []))
        const provider = createMockProvider(commits)

        const sorted = await topologicalSort(provider, [sha])
        expect(sorted).toEqual([sha])
      })

      it('should handle disconnected commits', async () => {
        const commits = new Map<string, CommitObject>()
        const A = 'commitA'.padEnd(40, '0')
        const B = 'commitB'.padEnd(40, '0')
        // A and B have no relationship
        commits.set(A, createMockCommit(A, []))
        commits.set(B, createMockCommit(B, []))

        const provider = createMockProvider(commits)
        const sorted = await topologicalSort(provider, [A, B])

        expect(sorted.length).toBe(2)
        expect(sorted).toContain(A)
        expect(sorted).toContain(B)
      })
    })

    describe('walkCommits with sort: topological', () => {
      it('should yield commits in topological order', async () => {
        const { commits, A, B, C, D } = buildDiamondHistory()
        const provider = createMockProvider(commits)

        const walked: string[] = []
        for await (const commit of walkCommits(provider, D, { sort: 'topological' })) {
          walked.push(commit.sha)
        }

        // D should be first
        expect(walked[0]).toBe(D)
        // A should be last
        expect(walked[walked.length - 1]).toBe(A)
      })

      it('should ensure no parent appears before all its children', async () => {
        const { commits, shas } = buildComplexHistory()
        const provider = createMockProvider(commits)

        const walked: string[] = []
        for await (const commit of walkCommits(provider, shas.G, { sort: 'topological' })) {
          walked.push(commit.sha)
        }

        // For each commit, verify all its children come before it
        for (const [sha, commitObj] of commits) {
          const shaIndex = walked.indexOf(sha)
          if (shaIndex === -1) continue

          for (const parent of commitObj.parents) {
            const parentIndex = walked.indexOf(parent)
            if (parentIndex !== -1) {
              expect(shaIndex).toBeLessThan(parentIndex)
            }
          }
        }
      })
    })
  })

  // ==========================================================================
  // Date Ordering
  // ==========================================================================

  describe('Date Ordering', () => {
    describe('sortByDate function', () => {
      it('should sort commits by committer date (newest first)', async () => {
        const { commits, shas } = buildLinearHistory(5)
        const provider = createMockProvider(commits)

        const sorted = await sortByDate(provider, shas)

        // Commits have increasing timestamps, so newest (shas[4]) should be first
        expect(sorted[0]).toBe(shas[4])
        expect(sorted[4]).toBe(shas[0])
      })

      it('should sort by author date when useAuthorDate is true', async () => {
        const commits = new Map<string, CommitObject>()
        const A = 'commitA'.padEnd(40, '0')
        const B = 'commitB'.padEnd(40, '0')

        // A: author date = 1000, committer date = 500
        const commitA = createMockCommit(A, [], 'A', 500)
        commitA.author.timestamp = 1000

        // B: author date = 800, committer date = 600
        const commitB = createMockCommit(B, [], 'B', 600)
        commitB.author.timestamp = 800

        commits.set(A, commitA)
        commits.set(B, commitB)

        const provider = createMockProvider(commits)

        // By committer date: B (600) > A (500)
        const byCommitter = await sortByDate(provider, [A, B], false)
        expect(byCommitter[0]).toBe(B)

        // By author date: A (1000) > B (800)
        const byAuthor = await sortByDate(provider, [A, B], true)
        expect(byAuthor[0]).toBe(A)
      })

      it('should handle commits with identical timestamps', async () => {
        const commits = new Map<string, CommitObject>()
        const sameTime = 1704067200
        const A = 'commitA'.padEnd(40, '0')
        const B = 'commitB'.padEnd(40, '0')
        const C = 'commitC'.padEnd(40, '0')

        commits.set(A, createMockCommit(A, [], 'A', sameTime))
        commits.set(B, createMockCommit(B, [], 'B', sameTime))
        commits.set(C, createMockCommit(C, [], 'C', sameTime))

        const provider = createMockProvider(commits)
        const sorted = await sortByDate(provider, [A, B, C])

        // All should be present
        expect(sorted.length).toBe(3)
        expect(sorted).toContain(A)
        expect(sorted).toContain(B)
        expect(sorted).toContain(C)
      })

      it('should handle empty array', async () => {
        const provider = createMockProvider(new Map())
        const sorted = await sortByDate(provider, [])
        expect(sorted).toEqual([])
      })
    })

    describe('walkCommits with sort: date', () => {
      it('should yield commits in date order (newest first)', async () => {
        const { commits, shas } = buildLinearHistory(5)
        const provider = createMockProvider(commits)

        const walked: string[] = []
        for await (const commit of walkCommits(provider, shas[4], { sort: 'date' })) {
          walked.push(commit.sha)
        }

        expect(walked[0]).toBe(shas[4])
      })

      it('should reverse order when reverse option is true', async () => {
        const { commits, shas } = buildLinearHistory(5)
        const provider = createMockProvider(commits)

        const walked: string[] = []
        for await (const commit of walkCommits(provider, shas[4], { sort: 'date', reverse: true })) {
          walked.push(commit.sha)
        }

        // Oldest should be first
        expect(walked[0]).toBe(shas[0])
        expect(walked[4]).toBe(shas[4])
      })

      it('should use author-date sort strategy', async () => {
        const { commits, shas } = buildLinearHistory(5)
        const provider = createMockProvider(commits)

        const walked: string[] = []
        for await (const commit of walkCommits(provider, shas[4], { sort: 'author-date' })) {
          walked.push(commit.sha)
        }

        expect(walked.length).toBe(5)
      })
    })

    describe('Date range filtering', () => {
      it('should filter commits after a date', async () => {
        const { commits, shas } = buildLinearHistory(5, 1704067200)
        const provider = createMockProvider(commits)

        // Commits are 1 hour apart. Filter for commits after 2 hours in.
        const afterDate = new Date((1704067200 + 2 * 3600) * 1000)

        const walked: string[] = []
        for await (const commit of walkCommits(provider, shas[4], { after: afterDate })) {
          walked.push(commit.sha)
        }

        // Should include shas[3] and shas[4] (3 and 4 hours after start, strictly after 2h)
        expect(walked).toContain(shas[3])
        expect(walked).toContain(shas[4])
        expect(walked).not.toContain(shas[0])
        expect(walked).not.toContain(shas[1])
        expect(walked).not.toContain(shas[2]) // At exactly 2 hours, excluded (strictly after)
      })

      it('should filter commits before a date', async () => {
        const { commits, shas } = buildLinearHistory(5, 1704067200)
        const provider = createMockProvider(commits)

        // Filter for commits before 2 hours in
        const beforeDate = new Date((1704067200 + 2 * 3600) * 1000)

        const walked: string[] = []
        for await (const commit of walkCommits(provider, shas[4], { before: beforeDate })) {
          walked.push(commit.sha)
        }

        // Should include shas[0] and shas[1] (0 and 1 hour after start)
        expect(walked).toContain(shas[0])
        expect(walked).toContain(shas[1])
      })

      it('should combine before and after date filters', async () => {
        const { commits, shas } = buildLinearHistory(10, 1704067200)
        const provider = createMockProvider(commits)

        const afterDate = new Date((1704067200 + 2 * 3600) * 1000)  // After 2h
        const beforeDate = new Date((1704067200 + 6 * 3600) * 1000) // Before 6h

        const walked: string[] = []
        for await (const commit of walkCommits(provider, shas[9], { after: afterDate, before: beforeDate })) {
          walked.push(commit.sha)
        }

        // Should include shas[3], shas[4], shas[5] (3, 4, 5 hours)
        expect(walked).toContain(shas[3])
        expect(walked).toContain(shas[4])
        expect(walked).toContain(shas[5])
        expect(walked).not.toContain(shas[0])
        expect(walked).not.toContain(shas[1])
        expect(walked).not.toContain(shas[2])
        expect(walked).not.toContain(shas[6])
      })
    })
  })

  // ==========================================================================
  // Commit Filtering
  // ==========================================================================

  describe('Commit Filtering', () => {
    describe('maxCount and skip options', () => {
      it('should limit results with maxCount', async () => {
        const { commits, shas } = buildLinearHistory(10)
        const provider = createMockProvider(commits)

        const walked: TraversalCommit[] = []
        for await (const commit of walkCommits(provider, shas[9], { maxCount: 3 })) {
          walked.push(commit)
        }

        expect(walked.length).toBe(3)
      })

      it('should skip commits with skip option', async () => {
        const { commits, shas } = buildLinearHistory(10)
        const provider = createMockProvider(commits)

        const walked: TraversalCommit[] = []
        for await (const commit of walkCommits(provider, shas[9], { skip: 5 })) {
          walked.push(commit)
        }

        expect(walked.length).toBe(5)
        expect(walked[0].sha).toBe(shas[4])
      })

      it('should combine skip and maxCount', async () => {
        const { commits, shas } = buildLinearHistory(10)
        const provider = createMockProvider(commits)

        const walked: TraversalCommit[] = []
        for await (const commit of walkCommits(provider, shas[9], { skip: 3, maxCount: 2 })) {
          walked.push(commit)
        }

        expect(walked.length).toBe(2)
        expect(walked[0].sha).toBe(shas[6])
        expect(walked[1].sha).toBe(shas[5])
      })

      it('should handle maxCount of 0', async () => {
        const { commits, shas } = buildLinearHistory(5)
        const provider = createMockProvider(commits)

        const walked: TraversalCommit[] = []
        for await (const commit of walkCommits(provider, shas[4], { maxCount: 0 })) {
          walked.push(commit)
        }

        expect(walked.length).toBe(0)
      })

      it('should handle skip greater than available commits', async () => {
        const { commits, shas } = buildLinearHistory(5)
        const provider = createMockProvider(commits)

        const walked: TraversalCommit[] = []
        for await (const commit of walkCommits(provider, shas[4], { skip: 100 })) {
          walked.push(commit)
        }

        expect(walked.length).toBe(0)
      })
    })

    describe('Path filtering', () => {
      it('should filter by single path', async () => {
        const { commits, shas } = buildLinearHistory(5)
        const pathCommits = new Map([
          ['src/index.ts', [shas[1], shas[3]]]
        ])
        const provider = createMockProvider(commits, pathCommits)

        const walked: TraversalCommit[] = []
        for await (const commit of walkCommits(provider, shas[4], { paths: ['src/index.ts'] })) {
          walked.push(commit)
        }

        expect(walked.length).toBe(2)
        expect(walked.map(w => w.sha)).toContain(shas[1])
        expect(walked.map(w => w.sha)).toContain(shas[3])
      })

      it('should filter by multiple paths', async () => {
        const { commits, shas } = buildLinearHistory(5)
        const pathCommits = new Map([
          ['src/a.ts', [shas[0], shas[2]]],
          ['src/b.ts', [shas[1], shas[4]]]
        ])
        const provider = createMockProvider(commits, pathCommits)

        const walked: TraversalCommit[] = []
        for await (const commit of walkCommits(provider, shas[4], { paths: ['src/a.ts', 'src/b.ts'] })) {
          walked.push(commit)
        }

        expect(walked.length).toBe(4)
      })

      it('should return empty for non-matching path', async () => {
        const { commits, shas } = buildLinearHistory(5)
        const pathCommits = new Map<string, string[]>()
        const provider = createMockProvider(commits, pathCommits)

        const walked: TraversalCommit[] = []
        for await (const commit of walkCommits(provider, shas[4], { paths: ['nonexistent.ts'] })) {
          walked.push(commit)
        }

        expect(walked.length).toBe(0)
      })
    })

    describe('Author/committer filtering', () => {
      it('should filter by author name', async () => {
        const commits = new Map<string, CommitObject>()
        const shas = ['a', 'b', 'c'].map(c => `commit${c}`.padEnd(40, '0'))

        commits.set(shas[0], createMockCommit(shas[0], [], 'A'))
        const commitB = createMockCommit(shas[1], [shas[0]], 'B')
        commitB.author = createAuthor('Special Author')
        commits.set(shas[1], commitB)
        commits.set(shas[2], createMockCommit(shas[2], [shas[1]], 'C'))

        const provider = createMockProvider(commits)

        const walked: string[] = []
        for await (const commit of walkCommits(provider, shas[2], { author: 'Special Author' })) {
          walked.push(commit.sha)
        }

        expect(walked.length).toBe(1)
        expect(walked[0]).toBe(shas[1])
      })

      it('should filter by committer name', async () => {
        const commits = new Map<string, CommitObject>()
        const shas = ['a', 'b', 'c'].map(c => `commit${c}`.padEnd(40, '0'))

        commits.set(shas[0], createMockCommit(shas[0], [], 'A'))
        const commitB = createMockCommit(shas[1], [shas[0]], 'B')
        commitB.committer = createAuthor('Special Committer')
        commits.set(shas[1], commitB)
        commits.set(shas[2], createMockCommit(shas[2], [shas[1]], 'C'))

        const provider = createMockProvider(commits)

        const walked: string[] = []
        for await (const commit of walkCommits(provider, shas[2], { committer: 'Special Committer' })) {
          walked.push(commit.sha)
        }

        expect(walked.length).toBe(1)
        expect(walked[0]).toBe(shas[1])
      })
    })

    describe('Message grep filtering', () => {
      it('should filter by string match in message', async () => {
        const commits = new Map<string, CommitObject>()
        const shas = ['a', 'b', 'c', 'd'].map(c => `commit${c}`.padEnd(40, '0'))

        commits.set(shas[0], createMockCommit(shas[0], [], 'Initial commit'))
        commits.set(shas[1], createMockCommit(shas[1], [shas[0]], 'Fix: resolve bug #123'))
        commits.set(shas[2], createMockCommit(shas[2], [shas[1]], 'Add feature'))
        commits.set(shas[3], createMockCommit(shas[3], [shas[2]], 'Fix: resolve bug #456'))

        const provider = createMockProvider(commits)

        const walked: string[] = []
        for await (const commit of walkCommits(provider, shas[3], { grep: 'Fix' })) {
          walked.push(commit.sha)
        }

        expect(walked.length).toBe(2)
        expect(walked).toContain(shas[1])
        expect(walked).toContain(shas[3])
      })

      it('should filter by regex match in message', async () => {
        const commits = new Map<string, CommitObject>()
        const shas = ['a', 'b', 'c', 'd'].map(c => `commit${c}`.padEnd(40, '0'))

        commits.set(shas[0], createMockCommit(shas[0], [], 'feat: add login'))
        commits.set(shas[1], createMockCommit(shas[1], [shas[0]], 'fix: auth bug'))
        commits.set(shas[2], createMockCommit(shas[2], [shas[1]], 'feat: add signup'))
        commits.set(shas[3], createMockCommit(shas[3], [shas[2]], 'docs: readme'))

        const provider = createMockProvider(commits)

        const walked: string[] = []
        for await (const commit of walkCommits(provider, shas[3], { grep: /^feat:/ })) {
          walked.push(commit.sha)
        }

        expect(walked.length).toBe(2)
        expect(walked).toContain(shas[0])
        expect(walked).toContain(shas[2])
      })
    })

    describe('Merge commit filtering', () => {
      it('should include merge commits by default', async () => {
        const { commits, D } = buildDiamondHistory()
        const provider = createMockProvider(commits)

        const walked: string[] = []
        for await (const commit of walkCommits(provider, D)) {
          walked.push(commit.sha)
        }

        expect(walked).toContain(D)
      })

      it('should exclude merge commits when includeMerges is false', async () => {
        const { commits, A, B, C, D } = buildDiamondHistory()
        const provider = createMockProvider(commits)

        const walked: string[] = []
        for await (const commit of walkCommits(provider, D, { includeMerges: false })) {
          walked.push(commit.sha)
        }

        expect(walked).not.toContain(D)
        expect(walked).toContain(B)
        expect(walked).toContain(C)
        expect(walked).toContain(A)
      })
    })

    describe('Exclude commits', () => {
      it('should exclude specified commits and their ancestors', async () => {
        const { commits, shas } = buildLinearHistory(5)
        const provider = createMockProvider(commits)

        const walked: string[] = []
        for await (const commit of walkCommits(provider, shas[4], { exclude: [shas[2]] })) {
          walked.push(commit.sha)
        }

        expect(walked).toContain(shas[4])
        expect(walked).toContain(shas[3])
        expect(walked).not.toContain(shas[2])
        expect(walked).not.toContain(shas[1])
        expect(walked).not.toContain(shas[0])
      })

      it('should handle multiple exclude commits', async () => {
        const { commits, shas } = buildComplexHistory()
        const provider = createMockProvider(commits)

        const walked: string[] = []
        for await (const commit of walkCommits(provider, shas.G, { exclude: [shas.B, shas.F] })) {
          walked.push(commit.sha)
        }

        // Should stop at B and F
        expect(walked).not.toContain(shas.B)
        expect(walked).not.toContain(shas.F)
        expect(walked).not.toContain(shas.A) // Excluded by both B and F
      })
    })
  })

  // ==========================================================================
  // Ancestor Checking
  // ==========================================================================

  describe('Ancestor Checking', () => {
    describe('isAncestor function', () => {
      it('should return true for direct parent-child relationship', async () => {
        const { commits, shas } = buildLinearHistory(3)
        const provider = createMockProvider(commits)

        const result = await isAncestor(provider, shas[0], shas[1])
        expect(result).toBe(true)
      })

      it('should return true for distant ancestor', async () => {
        const { commits, shas } = buildLinearHistory(10)
        const provider = createMockProvider(commits)

        const result = await isAncestor(provider, shas[0], shas[9])
        expect(result).toBe(true)
      })

      it('should return false when not an ancestor', async () => {
        const { commits, shas } = buildLinearHistory(5)
        const provider = createMockProvider(commits)

        // shas[4] is not an ancestor of shas[0]
        const result = await isAncestor(provider, shas[4], shas[0])
        expect(result).toBe(false)
      })

      it('should return true when commit is its own ancestor', async () => {
        const { commits, shas } = buildLinearHistory(3)
        const provider = createMockProvider(commits)

        const result = await isAncestor(provider, shas[1], shas[1])
        expect(result).toBe(true)
      })

      it('should find ancestor through merge commits', async () => {
        const { commits, A, D } = buildDiamondHistory()
        const provider = createMockProvider(commits)

        // A is ancestor of D through both paths
        const result = await isAncestor(provider, A, D)
        expect(result).toBe(true)
      })

      it('should handle unrelated commits', async () => {
        const commits = new Map<string, CommitObject>()
        const A = 'commitA'.padEnd(40, '0')
        const B = 'commitB'.padEnd(40, '0')

        commits.set(A, createMockCommit(A, []))
        commits.set(B, createMockCommit(B, []))

        const provider = createMockProvider(commits)

        expect(await isAncestor(provider, A, B)).toBe(false)
        expect(await isAncestor(provider, B, A)).toBe(false)
      })

      it('should handle non-existent ancestor', async () => {
        const { commits, shas } = buildLinearHistory(3)
        const provider = createMockProvider(commits)

        const nonexistent = 'nonexistent'.padEnd(40, '0')
        const result = await isAncestor(provider, nonexistent, shas[2])
        expect(result).toBe(false)
      })

      it('should handle non-existent descendant', async () => {
        const { commits, shas } = buildLinearHistory(3)
        const provider = createMockProvider(commits)

        const nonexistent = 'nonexistent'.padEnd(40, '0')
        const result = await isAncestor(provider, shas[0], nonexistent)
        expect(result).toBe(false)
      })
    })

    describe('findCommonAncestor function', () => {
      it('should find common ancestor of diverged branches', async () => {
        const { commits, A, B, C } = buildDiamondHistory()
        const provider = createMockProvider(commits)

        const ancestor = await findCommonAncestor(provider, B, C)
        expect(ancestor).toBe(A)
      })

      it('should return commit itself when both are same', async () => {
        const { commits, B } = buildDiamondHistory()
        const provider = createMockProvider(commits)

        const ancestor = await findCommonAncestor(provider, B, B)
        expect(ancestor).toBe(B)
      })

      it('should return ancestor when one commit is ancestor of other', async () => {
        const { commits, shas } = buildLinearHistory(5)
        const provider = createMockProvider(commits)

        const ancestor = await findCommonAncestor(provider, shas[4], shas[2])
        expect(ancestor).toBe(shas[2])
      })

      it('should return null for unrelated commits', async () => {
        const commits = new Map<string, CommitObject>()
        const A = 'commitA'.padEnd(40, '0')
        const B = 'commitB'.padEnd(40, '0')

        commits.set(A, createMockCommit(A, []))
        commits.set(B, createMockCommit(B, []))

        const provider = createMockProvider(commits)

        const ancestor = await findCommonAncestor(provider, A, B)
        expect(ancestor).toBeNull()
      })

      it('should return all ancestors when all=true', async () => {
        const { commits, shas } = buildComplexHistory()
        const provider = createMockProvider(commits)

        const ancestors = await findCommonAncestor(provider, shas.E, shas.F, true)

        expect(Array.isArray(ancestors)).toBe(true)
        expect(ancestors).toContain(shas.A)
      })
    })

    describe('findMergeBase function', () => {
      it('should find merge base of two commits', async () => {
        const { commits, A, B, C } = buildDiamondHistory()
        const provider = createMockProvider(commits)

        const mergeBase = await findMergeBase(provider, [B, C])
        expect(mergeBase).toContain(A)
      })

      it('should handle three or more commits', async () => {
        const { commits, shas } = buildComplexHistory()
        const provider = createMockProvider(commits)

        const mergeBase = await findMergeBase(provider, [shas.B, shas.C, shas.F])
        expect(mergeBase.length).toBeGreaterThan(0)
        expect(mergeBase).toContain(shas.A)
      })

      it('should return empty array for unrelated commits', async () => {
        const commits = new Map<string, CommitObject>()
        const A = 'commitA'.padEnd(40, '0')
        const B = 'commitB'.padEnd(40, '0')

        commits.set(A, createMockCommit(A, []))
        commits.set(B, createMockCommit(B, []))

        const provider = createMockProvider(commits)

        const mergeBase = await findMergeBase(provider, [A, B])
        expect(mergeBase).toEqual([])
      })

      it('should return the commit when same commit passed twice', async () => {
        const { commits, B } = buildDiamondHistory()
        const provider = createMockProvider(commits)

        const mergeBase = await findMergeBase(provider, [B, B])
        expect(mergeBase).toContain(B)
      })
    })
  })

  // ==========================================================================
  // Utility Functions
  // ==========================================================================

  describe('Utility Functions', () => {
    describe('getCommitsBetween', () => {
      it('should get commits between two points (exclusive/inclusive)', async () => {
        const { commits, shas } = buildLinearHistory(5)
        const provider = createMockProvider(commits)

        const between = await getCommitsBetween(provider, shas[1], shas[4])

        expect(between).not.toContain(shas[0])
        expect(between).not.toContain(shas[1]) // exclusive start
        expect(between).toContain(shas[2])
        expect(between).toContain(shas[3])
        expect(between).toContain(shas[4]) // inclusive end
      })

      it('should return empty when start equals end', async () => {
        const { commits, shas } = buildLinearHistory(5)
        const provider = createMockProvider(commits)

        const between = await getCommitsBetween(provider, shas[2], shas[2])
        expect(between).toEqual([])
      })

      it('should return empty when end is ancestor of start', async () => {
        const { commits, shas } = buildLinearHistory(5)
        const provider = createMockProvider(commits)

        const between = await getCommitsBetween(provider, shas[4], shas[1])
        expect(between).toEqual([])
      })
    })

    describe('countCommits', () => {
      it('should count all reachable commits', async () => {
        const { commits, shas } = buildLinearHistory(10)
        const provider = createMockProvider(commits)

        const count = await countCommits(provider, shas[9])
        expect(count).toBe(10)
      })

      it('should respect maxDepth limit', async () => {
        const { commits, shas } = buildLinearHistory(10)
        const provider = createMockProvider(commits)

        const count = await countCommits(provider, shas[9], 3)
        expect(count).toBe(4) // current + 3 ancestors
      })

      it('should count correctly in merge history', async () => {
        const { commits, D } = buildDiamondHistory()
        const provider = createMockProvider(commits)

        const count = await countCommits(provider, D)
        expect(count).toBe(4) // D, B, C, A
      })

      it('should return 0 for non-existent commit', async () => {
        const provider = createMockProvider(new Map())

        const count = await countCommits(provider, 'nonexistent'.padEnd(40, '0'))
        expect(count).toBe(0)
      })
    })

    describe('parseRevisionRange', () => {
      it('should parse single commit reference', () => {
        const range = parseRevisionRange('abc123')
        expect(range.type).toBe('single')
        expect(range.left).toBe('abc123')
        expect(range.right).toBeUndefined()
      })

      it('should parse two-dot range (A..B)', () => {
        const range = parseRevisionRange('main..feature')
        expect(range.type).toBe('two-dot')
        expect(range.left).toBe('main')
        expect(range.right).toBe('feature')
      })

      it('should parse three-dot range (A...B)', () => {
        const range = parseRevisionRange('main...feature')
        expect(range.type).toBe('three-dot')
        expect(range.left).toBe('main')
        expect(range.right).toBe('feature')
      })

      it('should handle SHA references', () => {
        const sha1 = 'a'.repeat(40)
        const sha2 = 'b'.repeat(40)
        const range = parseRevisionRange(`${sha1}..${sha2}`)
        expect(range.left).toBe(sha1)
        expect(range.right).toBe(sha2)
      })

      it('should handle refs with slashes', () => {
        const range = parseRevisionRange('origin/main..origin/feature')
        expect(range.left).toBe('origin/main')
        expect(range.right).toBe('origin/feature')
      })
    })

    describe('expandRevisionRange', () => {
      it('should expand two-dot range to include/exclude', async () => {
        const { commits, shas } = buildLinearHistory(5)
        const provider = createMockProvider(commits)

        const { include, exclude } = await expandRevisionRange(provider, {
          type: 'two-dot',
          left: shas[1],
          right: shas[4]
        })

        expect(include).toContain(shas[4])
        expect(exclude).toContain(shas[1])
      })

      it('should expand single commit range', async () => {
        const { commits, shas } = buildLinearHistory(3)
        const provider = createMockProvider(commits)

        const { include, exclude } = await expandRevisionRange(provider, {
          type: 'single',
          left: shas[2]
        })

        expect(include).toContain(shas[2])
        expect(exclude).toEqual([])
      })
    })
  })

  // ==========================================================================
  // Edge Cases and Error Handling
  // ==========================================================================

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty repository', async () => {
      const provider = createMockProvider(new Map())

      const walked: TraversalCommit[] = []
      for await (const commit of walkCommits(provider, 'nonexistent'.padEnd(40, '0'))) {
        walked.push(commit)
      }

      expect(walked.length).toBe(0)
    })

    it('should walk from multiple starting points', async () => {
      const { commits, shas } = buildComplexHistory()
      const provider = createMockProvider(commits)

      const walked: TraversalCommit[] = []
      for await (const commit of walkCommits(provider, [shas.E, shas.F])) {
        walked.push(commit)
      }

      expect(walked.map(w => w.sha)).toContain(shas.E)
      expect(walked.map(w => w.sha)).toContain(shas.F)
      expect(walked.map(w => w.sha)).toContain(shas.A)
    })

    it('should handle very deep history efficiently', async () => {
      const { commits, shas } = buildLinearHistory(100)
      const provider = createMockProvider(commits)

      const walked: TraversalCommit[] = []
      for await (const commit of walkCommits(provider, shas[99])) {
        walked.push(commit)
      }

      expect(walked.length).toBe(100)
    })

    it('should support async iteration on CommitWalker', async () => {
      const { commits, shas } = buildLinearHistory(5)
      const provider = createMockProvider(commits)

      const walker = new CommitWalker(provider)
      walker.push(shas[4])

      const walked: TraversalCommit[] = []
      for await (const commit of walker) {
        walked.push(commit)
      }

      expect(walked.length).toBe(5)
    })
  })
})
