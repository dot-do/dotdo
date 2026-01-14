import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  CommitWalker,
  walkCommits,
  isAncestor,
  findCommonAncestor,
  findMergeBase,
  parseRevisionRange,
  expandRevisionRange,
  topologicalSort,
  sortByDate,
  getCommitsBetween,
  countCommits,
  CommitProvider,
  TraversalOptions,
  TraversalCommit,
  RevisionRange,
  SortStrategy
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
 *
 * The commits map maps SHA -> CommitObject
 * The pathCommits map maps path -> array of SHAs that modified that path
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
 * Build a complex history with multiple branches for testing:
 *
 *       G (merge B+F)
 *      / \
 *     E   F
 *     |   |
 *     D   |
 *    /|   |
 *   B C   |
 *    \|  /
 *     A-/
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
  // Walking Commit History from a Ref
  // ==========================================================================

  describe('Walking commit history from a ref', () => {
    describe('walkCommits generator', () => {
      it('should yield commits starting from the given SHA', async () => {
        const { commits, shas } = buildLinearHistory(5)
        const provider = createMockProvider(commits)
        const headSha = shas[shas.length - 1]

        const walked: TraversalCommit[] = []
        for await (const commit of walkCommits(provider, headSha)) {
          walked.push(commit)
        }

        expect(walked.length).toBe(5)
        expect(walked[0].sha).toBe(headSha)
      })

      it('should walk all ancestors of the starting commit', async () => {
        const { commits, shas } = buildLinearHistory(5)
        const provider = createMockProvider(commits)
        const headSha = shas[shas.length - 1]

        const walkedShas: string[] = []
        for await (const commit of walkCommits(provider, headSha)) {
          walkedShas.push(commit.sha)
        }

        // Should include all commits
        for (const sha of shas) {
          expect(walkedShas).toContain(sha)
        }
      })

      it('should walk from multiple starting points', async () => {
        const { commits, shas } = buildComplexHistory()
        const provider = createMockProvider(commits)

        const walked: TraversalCommit[] = []
        for await (const commit of walkCommits(provider, [shas.E, shas.F])) {
          walked.push(commit)
        }

        // Should include commits reachable from E and F
        const walkedShas = walked.map(w => w.sha)
        expect(walkedShas).toContain(shas.E)
        expect(walkedShas).toContain(shas.F)
        expect(walkedShas).toContain(shas.A)
      })

      it('should not revisit already visited commits', async () => {
        const { commits, A, B, C, D } = buildDiamondHistory()
        const provider = createMockProvider(commits)

        const walkedShas: string[] = []
        for await (const commit of walkCommits(provider, D)) {
          walkedShas.push(commit.sha)
        }

        // A should only appear once
        expect(walkedShas.filter(sha => sha === A).length).toBe(1)
      })

      it('should track depth from starting commit', async () => {
        const { commits, shas } = buildLinearHistory(4)
        const provider = createMockProvider(commits)
        const headSha = shas[shas.length - 1]

        const depthMap = new Map<string, number>()
        for await (const commit of walkCommits(provider, headSha)) {
          depthMap.set(commit.sha, commit.depth)
        }

        expect(depthMap.get(headSha)).toBe(0)
        expect(depthMap.get(shas[shas.length - 2])).toBe(1)
        expect(depthMap.get(shas[0])).toBe(3)
      })

      it('should identify merge commits', async () => {
        const { commits, D } = buildDiamondHistory()
        const provider = createMockProvider(commits)

        const walked: TraversalCommit[] = []
        for await (const commit of walkCommits(provider, D)) {
          walked.push(commit)
        }

        const mergeCommit = walked.find(w => w.sha === D)
        expect(mergeCommit?.isMerge).toBe(true)
      })

      it('should handle empty history gracefully', async () => {
        const provider = createMockProvider(new Map())

        const walked: TraversalCommit[] = []
        for await (const commit of walkCommits(provider, 'nonexistent'.padEnd(40, '0'))) {
          walked.push(commit)
        }

        expect(walked.length).toBe(0)
      })
    })

    describe('CommitWalker class', () => {
      it('should create a walker with options', () => {
        const provider = createMockProvider(new Map())
        const walker = new CommitWalker(provider, { maxCount: 10 })

        expect(walker).toBeInstanceOf(CommitWalker)
      })

      it('should push starting commits', () => {
        const { commits, shas } = buildLinearHistory(3)
        const provider = createMockProvider(commits)
        const walker = new CommitWalker(provider)

        expect(() => walker.push(shas[2])).not.toThrow()
      })

      it('should iterate with next()', async () => {
        const { commits, shas } = buildLinearHistory(3)
        const provider = createMockProvider(commits)
        const walker = new CommitWalker(provider)
        walker.push(shas[2])

        const first = await walker.next()
        expect(first).not.toBeNull()
        expect(first?.sha).toBe(shas[2])
      })

      it('should return null when no more commits', async () => {
        const { commits, shas } = buildLinearHistory(2)
        const provider = createMockProvider(commits)
        const walker = new CommitWalker(provider)
        walker.push(shas[1])

        await walker.next() // commit 1
        await walker.next() // commit 0
        const result = await walker.next() // should be null

        expect(result).toBeNull()
      })

      it('should check hasNext() correctly', async () => {
        const { commits, shas } = buildLinearHistory(2)
        const provider = createMockProvider(commits)
        const walker = new CommitWalker(provider)
        walker.push(shas[1])

        expect(walker.hasNext()).toBe(true)
        await walker.next()
        await walker.next()
        expect(walker.hasNext()).toBe(false)
      })

      it('should reset walker state', async () => {
        const { commits, shas } = buildLinearHistory(3)
        const provider = createMockProvider(commits)
        const walker = new CommitWalker(provider)
        walker.push(shas[2])

        await walker.next()
        walker.reset()
        walker.push(shas[2])

        const commit = await walker.next()
        expect(commit?.sha).toBe(shas[2])
      })

      it('should hide commits and their ancestors', async () => {
        const { commits, shas } = buildLinearHistory(5)
        const provider = createMockProvider(commits)
        const walker = new CommitWalker(provider)
        walker.push(shas[4])
        walker.hide(shas[2]) // Hide commit 2 and its ancestors (0, 1)

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

      it('should support async iteration', async () => {
        const { commits, shas } = buildLinearHistory(3)
        const provider = createMockProvider(commits)
        const walker = new CommitWalker(provider)
        walker.push(shas[2])

        const walked: TraversalCommit[] = []
        for await (const commit of walker) {
          walked.push(commit)
        }

        expect(walked.length).toBe(3)
      })
    })
  })

  // ==========================================================================
  // Limiting by Count
  // ==========================================================================

  describe('Limiting by count', () => {
    it('should limit results with maxCount option', async () => {
      const { commits, shas } = buildLinearHistory(10)
      const provider = createMockProvider(commits)

      const walked: TraversalCommit[] = []
      for await (const commit of walkCommits(provider, shas[9], { maxCount: 5 })) {
        walked.push(commit)
      }

      expect(walked.length).toBe(5)
    })

    it('should return all commits when maxCount exceeds history length', async () => {
      const { commits, shas } = buildLinearHistory(5)
      const provider = createMockProvider(commits)

      const walked: TraversalCommit[] = []
      for await (const commit of walkCommits(provider, shas[4], { maxCount: 100 })) {
        walked.push(commit)
      }

      expect(walked.length).toBe(5)
    })

    it('should skip commits with skip option', async () => {
      const { commits, shas } = buildLinearHistory(10)
      const provider = createMockProvider(commits)

      const walked: TraversalCommit[] = []
      for await (const commit of walkCommits(provider, shas[9], { skip: 3 })) {
        walked.push(commit)
      }

      expect(walked.length).toBe(7)
      expect(walked[0].sha).toBe(shas[6]) // Skipped 9, 8, 7
    })

    it('should combine skip and maxCount', async () => {
      const { commits, shas } = buildLinearHistory(10)
      const provider = createMockProvider(commits)

      const walked: TraversalCommit[] = []
      for await (const commit of walkCommits(provider, shas[9], { skip: 2, maxCount: 3 })) {
        walked.push(commit)
      }

      expect(walked.length).toBe(3)
      expect(walked[0].sha).toBe(shas[7]) // Skipped 9, 8
      expect(walked[2].sha).toBe(shas[5]) // Only 3 commits
    })

    it('should handle skip greater than history length', async () => {
      const { commits, shas } = buildLinearHistory(5)
      const provider = createMockProvider(commits)

      const walked: TraversalCommit[] = []
      for await (const commit of walkCommits(provider, shas[4], { skip: 100 })) {
        walked.push(commit)
      }

      expect(walked.length).toBe(0)
    })

    it('should handle maxCount of zero', async () => {
      const { commits, shas } = buildLinearHistory(5)
      const provider = createMockProvider(commits)

      const walked: TraversalCommit[] = []
      for await (const commit of walkCommits(provider, shas[4], { maxCount: 0 })) {
        walked.push(commit)
      }

      expect(walked.length).toBe(0)
    })
  })

  // ==========================================================================
  // Filtering by Path
  // ==========================================================================

  describe('Filtering by path', () => {
    it('should filter commits by single path', async () => {
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

    it('should filter commits by multiple paths', async () => {
      const { commits, shas } = buildLinearHistory(5)
      const pathCommits = new Map([
        ['src/a.ts', [shas[1]]],
        ['src/b.ts', [shas[2], shas[4]]]
      ])
      const provider = createMockProvider(commits, pathCommits)

      const walked: TraversalCommit[] = []
      for await (const commit of walkCommits(provider, shas[4], { paths: ['src/a.ts', 'src/b.ts'] })) {
        walked.push(commit)
      }

      // Should include commits from either path
      expect(walked.length).toBe(3)
    })

    it('should return empty when no commits match path', async () => {
      const { commits, shas } = buildLinearHistory(5)
      const pathCommits = new Map<string, string[]>([])
      const provider = createMockProvider(commits, pathCommits)

      const walked: TraversalCommit[] = []
      for await (const commit of walkCommits(provider, shas[4], { paths: ['nonexistent.ts'] })) {
        walked.push(commit)
      }

      expect(walked.length).toBe(0)
    })

    it('should combine path filter with maxCount', async () => {
      const { commits, shas } = buildLinearHistory(10)
      const pathCommits = new Map([
        ['src/index.ts', [shas[1], shas[3], shas[5], shas[7], shas[9]]]
      ])
      const provider = createMockProvider(commits, pathCommits)

      const walked: TraversalCommit[] = []
      for await (const commit of walkCommits(provider, shas[9], { paths: ['src/index.ts'], maxCount: 2 })) {
        walked.push(commit)
      }

      expect(walked.length).toBe(2)
    })

    it('should handle directory paths', async () => {
      const { commits, shas } = buildLinearHistory(5)
      const pathCommits = new Map([
        ['src/', [shas[0], shas[2], shas[4]]]
      ])
      const provider = createMockProvider(commits, pathCommits)

      const walked: TraversalCommit[] = []
      for await (const commit of walkCommits(provider, shas[4], { paths: ['src/'] })) {
        walked.push(commit)
      }

      expect(walked.length).toBe(3)
    })
  })

  // ==========================================================================
  // Topological Ordering
  // ==========================================================================

  describe('Topological ordering', () => {
    it('should sort commits topologically (children before parents)', async () => {
      const { commits, A, B, C, D } = buildDiamondHistory()
      const provider = createMockProvider(commits)

      const sorted = await topologicalSort(provider, [A, B, C, D])

      // D should come before B and C, which should come before A
      const indexD = sorted.indexOf(D)
      const indexB = sorted.indexOf(B)
      const indexC = sorted.indexOf(C)
      const indexA = sorted.indexOf(A)

      expect(indexD).toBeLessThan(indexB)
      expect(indexD).toBeLessThan(indexC)
      expect(indexB).toBeLessThan(indexA)
      expect(indexC).toBeLessThan(indexA)
    })

    it('should use topological sort with walkCommits when specified', async () => {
      const { commits, A, B, C, D } = buildDiamondHistory()
      const provider = createMockProvider(commits)

      const walked: string[] = []
      for await (const commit of walkCommits(provider, D, { sort: 'topological' })) {
        walked.push(commit.sha)
      }

      // D should come first
      expect(walked[0]).toBe(D)
      // A should come last
      expect(walked[walked.length - 1]).toBe(A)
    })

    it('should handle linear history correctly', async () => {
      const { commits, shas } = buildLinearHistory(5)
      const provider = createMockProvider(commits)

      const sorted = await topologicalSort(provider, shas)

      // Should be in reverse order (newest to oldest)
      expect(sorted[0]).toBe(shas[4])
      expect(sorted[4]).toBe(shas[0])
    })

    it('should handle complex merge history', async () => {
      const { commits, shas } = buildComplexHistory()
      const provider = createMockProvider(commits)

      const sorted = await topologicalSort(provider, Object.values(shas))

      // G should come first, A should come last
      expect(sorted[0]).toBe(shas.G)
      expect(sorted[sorted.length - 1]).toBe(shas.A)

      // D should come before B and C
      const indexD = sorted.indexOf(shas.D)
      const indexB = sorted.indexOf(shas.B)
      const indexC = sorted.indexOf(shas.C)
      expect(indexD).toBeLessThan(indexB)
      expect(indexD).toBeLessThan(indexC)
    })

    it('should return empty array for empty input', async () => {
      const provider = createMockProvider(new Map())

      const sorted = await topologicalSort(provider, [])

      expect(sorted).toEqual([])
    })
  })

  // ==========================================================================
  // Date Ordering
  // ==========================================================================

  describe('Date ordering', () => {
    it('should sort commits by committer date (newest first)', async () => {
      const { commits, shas } = buildLinearHistory(5)
      const provider = createMockProvider(commits)

      const sorted = await sortByDate(provider, shas)

      // Should be sorted by timestamp, newest first
      expect(sorted[0]).toBe(shas[4])
      expect(sorted[4]).toBe(shas[0])
    })

    it('should use date sort with walkCommits when specified', async () => {
      const { commits, shas } = buildLinearHistory(5)
      const provider = createMockProvider(commits)

      const walked: string[] = []
      for await (const commit of walkCommits(provider, shas[4], { sort: 'date' })) {
        walked.push(commit.sha)
      }

      // Should be sorted by date
      expect(walked[0]).toBe(shas[4])
    })

    it('should sort by author date when specified', async () => {
      const commits = new Map<string, CommitObject>()
      const A = 'commitA'.padEnd(40, '0')
      const B = 'commitB'.padEnd(40, '0')

      // Create commits with different author and committer dates
      const commitA = createMockCommit(A, [], 'A', 1704067200)
      commitA.author.timestamp = 1704100000 // Author date is later
      commitA.committer.timestamp = 1704067200

      const commitB = createMockCommit(B, [A], 'B', 1704070800)
      commitB.author.timestamp = 1704050000 // Author date is earlier
      commitB.committer.timestamp = 1704070800

      commits.set(A, commitA)
      commits.set(B, commitB)

      const provider = createMockProvider(commits)

      const sortedByCommitter = await sortByDate(provider, [A, B], false)
      const sortedByAuthor = await sortByDate(provider, [A, B], true)

      // By committer date: B (1704070800) before A (1704067200)
      expect(sortedByCommitter[0]).toBe(B)

      // By author date: A (1704100000) before B (1704050000)
      expect(sortedByAuthor[0]).toBe(A)
    })

    it('should handle commits with same timestamp', async () => {
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

      // All commits should be present
      expect(sorted.length).toBe(3)
      expect(sorted).toContain(A)
      expect(sorted).toContain(B)
      expect(sorted).toContain(C)
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

    it('should reverse order when reverse option is true', async () => {
      const { commits, shas } = buildLinearHistory(5)
      const provider = createMockProvider(commits)

      const walked: string[] = []
      for await (const commit of walkCommits(provider, shas[4], { sort: 'date', reverse: true })) {
        walked.push(commit.sha)
      }

      // Should be oldest first
      expect(walked[0]).toBe(shas[0])
      expect(walked[4]).toBe(shas[4])
    })
  })

  // ==========================================================================
  // Finding Merge Base
  // ==========================================================================

  describe('Finding merge base', () => {
    it('should find merge base of two diverged branches', async () => {
      const { commits, A, B, C } = buildDiamondHistory()
      const provider = createMockProvider(commits)

      const mergeBase = await findMergeBase(provider, [B, C])

      expect(mergeBase).toContain(A)
    })

    it('should find common ancestor of two commits', async () => {
      const { commits, A, B, C } = buildDiamondHistory()
      const provider = createMockProvider(commits)

      const ancestor = await findCommonAncestor(provider, B, C)

      expect(ancestor).toBe(A)
    })

    it('should return all common ancestors when all=true', async () => {
      const { commits, shas } = buildComplexHistory()
      const provider = createMockProvider(commits)

      const ancestors = await findCommonAncestor(provider, shas.E, shas.F, true)

      expect(Array.isArray(ancestors)).toBe(true)
      expect(ancestors).toContain(shas.A)
    })

    it('should return the commit itself when both inputs are the same', async () => {
      const { commits, A } = buildDiamondHistory()
      const provider = createMockProvider(commits)

      const mergeBase = await findMergeBase(provider, [A, A])

      expect(mergeBase).toContain(A)
    })

    it('should return ancestor when one commit is ancestor of another', async () => {
      const { commits, shas } = buildLinearHistory(5)
      const provider = createMockProvider(commits)

      const mergeBase = await findMergeBase(provider, [shas[4], shas[2]])

      expect(mergeBase).toContain(shas[2])
    })

    it('should handle multiple commits for merge base', async () => {
      const { commits, shas } = buildComplexHistory()
      const provider = createMockProvider(commits)

      const mergeBase = await findMergeBase(provider, [shas.E, shas.F, shas.G])

      // Should find the common ancestor
      expect(mergeBase.length).toBeGreaterThan(0)
    })

    it('should return null when no common ancestor exists', async () => {
      // Create two completely separate histories
      const commits = new Map<string, CommitObject>()
      const A = 'commitA'.padEnd(40, '0')
      const B = 'commitB'.padEnd(40, '0')

      commits.set(A, createMockCommit(A, [], 'A'))
      commits.set(B, createMockCommit(B, [], 'B'))

      const provider = createMockProvider(commits)

      const ancestor = await findCommonAncestor(provider, A, B)

      expect(ancestor).toBeNull()
    })

    it('should return empty array from findMergeBase when no common ancestor', async () => {
      const commits = new Map<string, CommitObject>()
      const A = 'commitA'.padEnd(40, '0')
      const B = 'commitB'.padEnd(40, '0')

      commits.set(A, createMockCommit(A, [], 'A'))
      commits.set(B, createMockCommit(B, [], 'B'))

      const provider = createMockProvider(commits)

      const mergeBase = await findMergeBase(provider, [A, B])

      expect(mergeBase).toEqual([])
    })
  })

  // ==========================================================================
  // Reachability Checks
  // ==========================================================================

  describe('Reachability checks', () => {
    it('should return true when ancestor is reachable from descendant', async () => {
      const { commits, shas } = buildLinearHistory(5)
      const provider = createMockProvider(commits)

      const result = await isAncestor(provider, shas[0], shas[4])

      expect(result).toBe(true)
    })

    it('should return false when ancestor is not reachable', async () => {
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

    it('should handle merge commits correctly', async () => {
      const { commits, A, B, C, D } = buildDiamondHistory()
      const provider = createMockProvider(commits)

      // A is reachable from D via both B and C
      const result = await isAncestor(provider, A, D)

      expect(result).toBe(true)
    })

    it('should return false for unrelated commits', async () => {
      const commits = new Map<string, CommitObject>()
      const A = 'commitA'.padEnd(40, '0')
      const B = 'commitB'.padEnd(40, '0')

      commits.set(A, createMockCommit(A, [], 'A'))
      commits.set(B, createMockCommit(B, [], 'B'))

      const provider = createMockProvider(commits)

      expect(await isAncestor(provider, A, B)).toBe(false)
      expect(await isAncestor(provider, B, A)).toBe(false)
    })

    it('should handle non-existent commits gracefully', async () => {
      const { commits, shas } = buildLinearHistory(3)
      const provider = createMockProvider(commits)

      const nonexistent = 'nonexistent'.padEnd(40, '0')
      const result = await isAncestor(provider, nonexistent, shas[2])

      expect(result).toBe(false)
    })
  })

  // ==========================================================================
  // Revision Range Parsing
  // ==========================================================================

  describe('Revision range parsing', () => {
    describe('parseRevisionRange', () => {
      it('should parse a single commit reference', () => {
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

      it('should handle SHA-like references', () => {
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

      it('should handle HEAD reference', () => {
        const range = parseRevisionRange('HEAD~5..HEAD')

        expect(range.left).toBe('HEAD~5')
        expect(range.right).toBe('HEAD')
      })
    })

    describe('expandRevisionRange', () => {
      it('should expand two-dot range to include/exclude sets', async () => {
        const { commits, shas } = buildLinearHistory(5)
        const provider = createMockProvider(commits)

        const range: RevisionRange = {
          type: 'two-dot',
          left: shas[1],
          right: shas[4]
        }

        const { include, exclude } = await expandRevisionRange(provider, range)

        // Include commits reachable from right (shas[4])
        expect(include).toContain(shas[4])
        // Exclude commits reachable from left (shas[1])
        expect(exclude).toContain(shas[1])
      })

      it('should expand three-dot range (symmetric difference)', async () => {
        const { commits, B, C, D } = buildDiamondHistory()
        const provider = createMockProvider(commits)

        const range: RevisionRange = {
          type: 'three-dot',
          left: B,
          right: C
        }

        const { include, exclude } = await expandRevisionRange(provider, range)

        // Should include B and C but exclude their common ancestors
        expect(include).toContain(B)
        expect(include).toContain(C)
      })

      it('should handle single commit range', async () => {
        const { commits, shas } = buildLinearHistory(3)
        const provider = createMockProvider(commits)

        const range: RevisionRange = {
          type: 'single',
          left: shas[2]
        }

        const { include, exclude } = await expandRevisionRange(provider, range)

        expect(include).toContain(shas[2])
        expect(exclude).toEqual([])
      })
    })
  })

  // ==========================================================================
  // Utility Functions
  // ==========================================================================

  describe('Utility functions', () => {
    describe('getCommitsBetween', () => {
      it('should get commits between two points (exclusive start, inclusive end)', async () => {
        const { commits, shas } = buildLinearHistory(5)
        const provider = createMockProvider(commits)

        const between = await getCommitsBetween(provider, shas[1], shas[4])

        expect(between).not.toContain(shas[0])
        expect(between).not.toContain(shas[1])
        expect(between).toContain(shas[2])
        expect(between).toContain(shas[3])
        expect(between).toContain(shas[4])
      })

      it('should return empty array when start equals end', async () => {
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

        expect(count).toBe(4) // Current commit + 3 ancestors
      })

      it('should count merge commits correctly', async () => {
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
  })

  // ==========================================================================
  // Additional Filter Options
  // ==========================================================================

  describe('Additional filter options', () => {
    describe('First parent only', () => {
      it('should follow only first parent in merge commits', async () => {
        const { commits, A, B, C, D } = buildDiamondHistory()
        const provider = createMockProvider(commits)

        const walked: string[] = []
        for await (const commit of walkCommits(provider, D, { firstParentOnly: true })) {
          walked.push(commit.sha)
        }

        // Should walk D -> B -> A (first parent path)
        expect(walked).toContain(D)
        expect(walked).toContain(B)
        expect(walked).toContain(A)
        expect(walked).not.toContain(C) // C is second parent
      })
    })

    describe('Include/exclude merges', () => {
      it('should exclude merge commits when includeMerges is false', async () => {
        const { commits, A, B, C, D } = buildDiamondHistory()
        const provider = createMockProvider(commits)

        const walked: string[] = []
        for await (const commit of walkCommits(provider, D, { includeMerges: false })) {
          walked.push(commit.sha)
        }

        expect(walked).not.toContain(D) // D is a merge commit
        expect(walked).toContain(B)
        expect(walked).toContain(C)
        expect(walked).toContain(A)
      })
    })

    describe('Author/committer filters', () => {
      it('should filter by author name', async () => {
        const commits = new Map<string, CommitObject>()
        const shas = ['a', 'b', 'c'].map(c => `commit${c}`.padEnd(40, '0'))

        commits.set(shas[0], createMockCommit(shas[0], [], 'A'))
        commits.set(shas[1], {
          ...createMockCommit(shas[1], [shas[0]], 'B'),
          author: createAuthor('Different Author')
        })
        commits.set(shas[2], createMockCommit(shas[2], [shas[1]], 'C'))

        const provider = createMockProvider(commits)

        const walked: string[] = []
        for await (const commit of walkCommits(provider, shas[2], { author: 'Different Author' })) {
          walked.push(commit.sha)
        }

        expect(walked.length).toBe(1)
        expect(walked[0]).toBe(shas[1])
      })

      it('should filter by committer name', async () => {
        const commits = new Map<string, CommitObject>()
        const shas = ['a', 'b', 'c'].map(c => `commit${c}`.padEnd(40, '0'))

        commits.set(shas[0], createMockCommit(shas[0], [], 'A'))
        commits.set(shas[1], {
          ...createMockCommit(shas[1], [shas[0]], 'B'),
          committer: createAuthor('Different Committer')
        })
        commits.set(shas[2], createMockCommit(shas[2], [shas[1]], 'C'))

        const provider = createMockProvider(commits)

        const walked: string[] = []
        for await (const commit of walkCommits(provider, shas[2], { committer: 'Different Committer' })) {
          walked.push(commit.sha)
        }

        expect(walked.length).toBe(1)
        expect(walked[0]).toBe(shas[1])
      })
    })

    describe('Date range filters', () => {
      it('should filter commits after a date', async () => {
        const { commits, shas } = buildLinearHistory(5, 1704067200) // Starting Jan 1, 2024
        const provider = createMockProvider(commits)

        // Filter for commits after Jan 1, 2024 12:00 (shas 1-4)
        const afterDate = new Date(1704078000 * 1000)

        const walked: string[] = []
        for await (const commit of walkCommits(provider, shas[4], { after: afterDate })) {
          walked.push(commit.sha)
        }

        expect(walked).not.toContain(shas[0])
        expect(walked).not.toContain(shas[1])
        expect(walked).not.toContain(shas[2])
      })

      it('should filter commits before a date', async () => {
        const { commits, shas } = buildLinearHistory(5, 1704067200)
        const provider = createMockProvider(commits)

        // Filter for commits before Jan 1, 2024 04:00 (shas 0-2)
        const beforeDate = new Date(1704078000 * 1000)

        const walked: string[] = []
        for await (const commit of walkCommits(provider, shas[4], { before: beforeDate })) {
          walked.push(commit.sha)
        }

        expect(walked).toContain(shas[0])
        expect(walked).toContain(shas[1])
        expect(walked).toContain(shas[2])
      })

      it('should combine after and before date filters', async () => {
        const { commits, shas } = buildLinearHistory(10, 1704067200)
        const provider = createMockProvider(commits)

        const afterDate = new Date(1704074400 * 1000)  // 2 hours after start
        const beforeDate = new Date(1704085200 * 1000) // 5 hours after start

        const walked: string[] = []
        for await (const commit of walkCommits(provider, shas[9], { after: afterDate, before: beforeDate })) {
          walked.push(commit.sha)
        }

        // Should only include commits 3, 4 (between 2 and 5 hours)
        expect(walked.length).toBeLessThan(10)
      })
    })

    describe('Grep message filter', () => {
      it('should filter by commit message string', async () => {
        const commits = new Map<string, CommitObject>()
        const shas = ['a', 'b', 'c'].map(c => `commit${c}`.padEnd(40, '0'))

        commits.set(shas[0], createMockCommit(shas[0], [], 'Initial commit'))
        commits.set(shas[1], createMockCommit(shas[1], [shas[0]], 'Fix: resolve bug #123'))
        commits.set(shas[2], createMockCommit(shas[2], [shas[1]], 'Add new feature'))

        const provider = createMockProvider(commits)

        const walked: string[] = []
        for await (const commit of walkCommits(provider, shas[2], { grep: 'Fix' })) {
          walked.push(commit.sha)
        }

        expect(walked.length).toBe(1)
        expect(walked[0]).toBe(shas[1])
      })

      it('should filter by commit message regex', async () => {
        const commits = new Map<string, CommitObject>()
        const shas = ['a', 'b', 'c', 'd'].map(c => `commit${c}`.padEnd(40, '0'))

        commits.set(shas[0], createMockCommit(shas[0], [], 'Initial commit'))
        commits.set(shas[1], createMockCommit(shas[1], [shas[0]], 'Fix bug #123'))
        commits.set(shas[2], createMockCommit(shas[2], [shas[1]], 'Fix bug #456'))
        commits.set(shas[3], createMockCommit(shas[3], [shas[2]], 'Add feature'))

        const provider = createMockProvider(commits)

        const walked: string[] = []
        for await (const commit of walkCommits(provider, shas[3], { grep: /Fix bug #\d+/ })) {
          walked.push(commit.sha)
        }

        expect(walked.length).toBe(2)
        expect(walked).toContain(shas[1])
        expect(walked).toContain(shas[2])
      })
    })

    describe('Exclude option', () => {
      it('should exclude specified commits and their ancestors', async () => {
        const { commits, shas } = buildLinearHistory(5)
        const provider = createMockProvider(commits)

        const walked: string[] = []
        for await (const commit of walkCommits(provider, shas[4], { exclude: [shas[2]] })) {
          walked.push(commit.sha)
        }

        // Should include 4, 3 but not 2, 1, 0
        expect(walked).toContain(shas[4])
        expect(walked).toContain(shas[3])
        expect(walked).not.toContain(shas[2])
        expect(walked).not.toContain(shas[1])
        expect(walked).not.toContain(shas[0])
      })
    })
  })
})
