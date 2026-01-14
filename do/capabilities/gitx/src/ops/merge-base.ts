/**
 * @fileoverview Merge Base Finding Operations
 *
 * Provides functionality for finding merge bases between commits,
 * which is essential for merge operations, rebasing, and understanding
 * branch relationships in the commit graph.
 *
 * ## What is a Merge Base?
 *
 * A merge base is the best common ancestor(s) of two or more commits.
 * The "best" common ancestor is one that is not an ancestor of any
 * other common ancestor (i.e., a maximal common ancestor).
 *
 * ## Features
 *
 * - Find merge base(s) between two commits
 * - Find merge bases for multiple commits (octopus merge)
 * - Fork point detection
 * - Ancestor relationship checking
 * - Independent commit detection
 * - Recursive merge base computation
 *
 * ## Usage Example
 *
 * ```typescript
 * import { findMergeBase, isAncestor } from './ops/merge-base'
 *
 * // Find the merge base between two branches
 * const result = await findMergeBase(provider, [branchA, branchB])
 * if (result.hasCommonHistory) {
 *   console.log('Merge base:', result.bases[0])
 * }
 *
 * // Check if one commit is an ancestor of another
 * const isOld = await isAncestor(provider, oldCommit, newCommit)
 * ```
 *
 * @module ops/merge-base
 */

import type { BasicCommitProvider as CommitProvider } from '../types/storage'

/**
 * CommitProvider interface for merge base operations.
 * Re-exported from storage types for convenience.
 */
export type { CommitProvider }

// ============================================================================
// Types
// ============================================================================

/**
 * Result of a merge base operation.
 *
 * Contains the merge base SHA(s) and metadata about the result.
 *
 * @interface MergeBaseResult
 *
 * @example
 * ```typescript
 * const result = await findMergeBase(provider, [commitA, commitB])
 *
 * if (result.hasCommonHistory) {
 *   if (result.isUnique) {
 *     console.log('Single merge base:', result.bases[0])
 *   } else {
 *     console.log('Multiple merge bases (criss-cross):', result.bases)
 *   }
 * } else {
 *   console.log('No common history (unrelated branches)')
 * }
 * ```
 */
export interface MergeBaseResult {
  /**
   * The merge base commit SHA(s).
   * Empty if no common history exists.
   */
  bases: string[]

  /**
   * Whether a unique merge base was found.
   * False if multiple merge bases exist (criss-cross merge situation).
   */
  isUnique: boolean

  /**
   * Whether the commits share any common history.
   * False for unrelated branches (e.g., different repos merged together).
   */
  hasCommonHistory: boolean

  /** The number of merge bases found */
  count: number
}

/**
 * Options for merge base finding.
 *
 * @interface MergeBaseOptions
 *
 * @example
 * ```typescript
 * // Find all merge bases (for criss-cross detection)
 * const result = await findMergeBase(provider, [a, b], { all: true })
 *
 * // Find independent commits from a list
 * const independent = await findMergeBase(provider, commits, { independent: true })
 * ```
 */
export interface MergeBaseOptions {
  /**
   * Return all merge bases instead of just one.
   * Useful for detecting criss-cross merge situations.
   * @default false
   */
  all?: boolean

  /**
   * Use octopus merge strategy (for >2 commits).
   * Finds a merge base suitable for merging multiple branches.
   * @default false (auto-enabled when >2 commits provided)
   */
  octopus?: boolean

  /**
   * Return independent refs (refs that cannot be reached from each other).
   * Filters the input to only commits that are not ancestors of any other.
   * @default false
   */
  independent?: boolean

  /**
   * Include fork point calculation.
   * Uses reflog information when available for more accurate detection.
   * @default false
   */
  forkPoint?: boolean
}

/**
 * Result of fork point detection.
 *
 * A fork point is where a branch diverged from another branch,
 * taking into account any rebases that may have occurred.
 *
 * @interface ForkPointResult
 *
 * @example
 * ```typescript
 * const result = await findForkPoint(provider, 'feature', 'main')
 * if (result.found) {
 *   console.log(`Feature forked from main at ${result.forkPoint}`)
 *   console.log(`${result.commitsSinceFork} commits since then`)
 * }
 * ```
 */
export interface ForkPointResult {
  /**
   * The fork point commit SHA.
   * Null if no fork point could be determined.
   */
  forkPoint: string | null

  /** The branch ref that was analyzed */
  ref: string

  /** Whether the fork point could be determined */
  found: boolean

  /** Number of commits on the branch since the fork point */
  commitsSinceFork: number
}

/**
 * Result of an ancestor check operation.
 *
 * @interface AncestorCheckResult
 *
 * @example
 * ```typescript
 * const result = await checkAncestor(provider, oldCommit, newCommit)
 * if (result.isAncestor) {
 *   console.log(`${oldCommit} is ${result.distance} commits behind ${newCommit}`)
 * }
 * ```
 */
export interface AncestorCheckResult {
  /** Whether the first commit is an ancestor of the second */
  isAncestor: boolean

  /**
   * The distance (number of commits) if ancestor, -1 otherwise.
   * A distance of 0 means the commits are the same.
   */
  distance: number
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Gets all ancestors of a commit (including itself).
 *
 * Uses iterative BFS to avoid stack overflow with deep histories.
 * This is the core function used by merge base finding algorithms.
 *
 * @param provider - The commit provider for fetching commits
 * @param sha - The starting commit SHA
 * @returns Set of all ancestor SHAs including the starting commit
 *
 * @internal
 */
async function getAncestors(
  provider: CommitProvider,
  sha: string
): Promise<Set<string>> {
  const visited = new Set<string>()
  const queue: string[] = [sha]

  while (queue.length > 0) {
    const current = queue.shift()!

    if (visited.has(current)) {
      continue
    }

    const commit = await provider.getCommit(current)
    if (!commit) {
      continue
    }

    visited.add(current)

    for (const parent of commit.parents) {
      if (!visited.has(parent)) {
        queue.push(parent)
      }
    }
  }

  return visited
}

/**
 * Finds all common ancestors of two commits.
 *
 * Computes the intersection of ancestor sets for both commits.
 *
 * @param provider - The commit provider for fetching commits
 * @param sha1 - First commit SHA
 * @param sha2 - Second commit SHA
 * @returns Set of all common ancestor SHAs
 *
 * @internal
 */
async function findCommonAncestors(
  provider: CommitProvider,
  sha1: string,
  sha2: string
): Promise<Set<string>> {
  const ancestors1 = await getAncestors(provider, sha1)
  const ancestors2 = await getAncestors(provider, sha2)

  const common = new Set<string>()
  for (const sha of ancestors1) {
    if (ancestors2.has(sha)) {
      common.add(sha)
    }
  }

  return common
}

/**
 * Filters common ancestors to only keep maximal ones.
 *
 * A maximal ancestor is one that is not an ancestor of any other
 * common ancestor. These are the "best" merge bases.
 *
 * @param provider - The commit provider for fetching commits
 * @param commonAncestors - Set of all common ancestors
 * @returns Array of maximal ancestor SHAs (the merge bases)
 *
 * @internal
 */
async function filterToMaximalAncestors(
  provider: CommitProvider,
  commonAncestors: Set<string>
): Promise<string[]> {
  const ancestorsList = Array.from(commonAncestors)

  if (ancestorsList.length === 0) {
    return []
  }

  if (ancestorsList.length === 1) {
    return ancestorsList
  }

  // For each ancestor, check if it's an ancestor of any other ancestor
  const isAncestorOfAnother = new Map<string, boolean>()

  for (const sha of ancestorsList) {
    isAncestorOfAnother.set(sha, false)
  }

  // Build ancestor sets for each common ancestor
  const ancestorSets = new Map<string, Set<string>>()
  for (const sha of ancestorsList) {
    const ancestors = await getAncestors(provider, sha)
    // Remove the sha itself from its ancestors for comparison
    ancestors.delete(sha)
    ancestorSets.set(sha, ancestors)
  }

  // Check which ones are ancestors of others
  for (const sha of ancestorsList) {
    for (const otherSha of ancestorsList) {
      if (sha !== otherSha) {
        const otherAncestors = ancestorSets.get(otherSha)!
        if (otherAncestors.has(sha)) {
          isAncestorOfAnother.set(sha, true)
          break
        }
      }
    }
  }

  // Return only maximal ancestors
  return ancestorsList.filter(sha => !isAncestorOfAnother.get(sha))
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Find the merge base of two or more commits
 *
 * Given two commits, finds the best common ancestor (merge base).
 * Given multiple commits, finds the merge base of all of them.
 *
 * This is equivalent to `git merge-base`.
 *
 * @param provider - The commit provider for fetching commits
 * @param commits - Two or more commit SHAs
 * @param options - Options for the merge base search
 * @returns The merge base result
 *
 * @example
 * ```ts
 * const result = await findMergeBase(provider, ['abc123', 'def456'])
 * if (result.hasCommonHistory) {
 *   console.log('Merge base:', result.bases[0])
 * }
 * ```
 */
export async function findMergeBase(
  provider: CommitProvider,
  commits: string[],
  options: MergeBaseOptions = {}
): Promise<MergeBaseResult> {
  // Handle edge cases
  if (commits.length === 0) {
    return {
      bases: [],
      isUnique: false,
      hasCommonHistory: false,
      count: 0
    }
  }

  if (commits.length === 1) {
    const commit = await provider.getCommit(commits[0])
    if (!commit) {
      return {
        bases: [],
        isUnique: false,
        hasCommonHistory: false,
        count: 0
      }
    }
    return {
      bases: [commits[0]],
      isUnique: true,
      hasCommonHistory: true,
      count: 1
    }
  }

  // Handle independent option
  if (options.independent) {
    const independent = await findIndependentCommits(provider, commits)
    return {
      bases: independent,
      isUnique: independent.length === 1,
      hasCommonHistory: independent.length > 0,
      count: independent.length
    }
  }

  // Handle octopus option
  if (options.octopus || commits.length > 2) {
    const bases = await findOctopusMergeBase(provider, commits)
    return {
      bases,
      isUnique: bases.length === 1,
      hasCommonHistory: bases.length > 0,
      count: bases.length
    }
  }

  // Handle fork point option
  if (options.forkPoint && commits.length === 2) {
    const result = await findForkPoint(provider, commits[0], commits[1])
    if (result.found && result.forkPoint) {
      return {
        bases: [result.forkPoint],
        isUnique: true,
        hasCommonHistory: true,
        count: 1
      }
    }
  }

  // Standard two-commit merge base
  const [sha1, sha2] = commits

  // Check if either commit doesn't exist
  const commit1 = await provider.getCommit(sha1)
  const commit2 = await provider.getCommit(sha2)

  if (!commit1 || !commit2) {
    return {
      bases: [],
      isUnique: false,
      hasCommonHistory: false,
      count: 0
    }
  }

  // Find all common ancestors
  const commonAncestors = await findCommonAncestors(provider, sha1, sha2)

  if (commonAncestors.size === 0) {
    return {
      bases: [],
      isUnique: false,
      hasCommonHistory: false,
      count: 0
    }
  }

  // Filter to maximal ancestors
  const maximalBases = await filterToMaximalAncestors(provider, commonAncestors)

  if (options.all) {
    return {
      bases: maximalBases,
      isUnique: maximalBases.length === 1,
      hasCommonHistory: true,
      count: maximalBases.length
    }
  }

  // Default: return just one merge base
  return {
    bases: maximalBases.length > 0 ? [maximalBases[0]] : [],
    isUnique: maximalBases.length === 1,
    hasCommonHistory: maximalBases.length > 0,
    count: 1
  }
}

/**
 * Find all merge bases between two commits
 *
 * Unlike findMergeBase with all=true, this specifically finds
 * all maximal common ancestors, which is useful for criss-cross
 * merge situations.
 *
 * This is equivalent to `git merge-base --all`.
 *
 * @param provider - The commit provider for fetching commits
 * @param commit1 - First commit SHA
 * @param commit2 - Second commit SHA
 * @returns Array of all merge base SHAs
 *
 * @example
 * ```ts
 * const bases = await findAllMergeBases(provider, 'abc123', 'def456')
 * if (bases.length > 1) {
 *   console.log('Multiple merge bases (criss-cross merge):', bases)
 * }
 * ```
 */
export async function findAllMergeBases(
  provider: CommitProvider,
  commit1: string,
  commit2: string
): Promise<string[]> {
  const result = await findMergeBase(provider, [commit1, commit2], { all: true })
  return result.bases
}

/**
 * Find the fork point of a branch relative to another ref
 *
 * Calculates where a branch forked off from another branch,
 * taking into account any rebases that may have occurred.
 * This uses reflog information when available.
 *
 * This is equivalent to `git merge-base --fork-point`.
 *
 * @param provider - The commit provider for fetching commits
 * @param ref - The branch ref to analyze
 * @param baseRef - The base ref to compare against
 * @param reflog - Optional reflog entries for more accurate detection
 * @returns The fork point result
 *
 * @example
 * ```ts
 * const result = await findForkPoint(provider, 'feature-branch', 'main')
 * if (result.found) {
 *   console.log('Forked from:', result.forkPoint)
 * }
 * ```
 */
export async function findForkPoint(
  provider: CommitProvider,
  ref: string,
  baseRef: string,
  reflog?: string[]
): Promise<ForkPointResult> {
  // If reflog is provided, use it for better detection
  if (reflog && reflog.length > 0) {
    // Get ancestors of ref
    const refAncestors = await getAncestors(provider, ref)

    // Check each reflog entry to find the fork point
    for (const entry of reflog) {
      if (refAncestors.has(entry)) {
        // Found a common point in the reflog
        // Calculate commits since fork
        let commitsSinceFork = 0
        let current = ref
        while (current !== entry) {
          const commit = await provider.getCommit(current)
          if (!commit || commit.parents.length === 0) break
          commitsSinceFork++
          current = commit.parents[0]
        }

        return {
          forkPoint: entry,
          ref,
          found: true,
          commitsSinceFork
        }
      }
    }
  }

  // Standard fork point detection: find merge base
  const result = await findMergeBase(provider, [ref, baseRef])

  if (!result.hasCommonHistory || result.bases.length === 0) {
    return {
      forkPoint: null,
      ref,
      found: false,
      commitsSinceFork: 0
    }
  }

  const forkPoint = result.bases[0]

  // Calculate commits since fork
  let commitsSinceFork = 0
  let current = ref
  const visited = new Set<string>()

  while (current !== forkPoint && !visited.has(current)) {
    visited.add(current)
    const commit = await provider.getCommit(current)
    if (!commit) break

    if (current === forkPoint) break

    commitsSinceFork++

    if (commit.parents.length === 0) break
    current = commit.parents[0]
  }

  return {
    forkPoint,
    ref,
    found: true,
    commitsSinceFork
  }
}

/**
 * Check if one commit is an ancestor of another
 *
 * Returns true if the first commit is reachable from the second
 * commit by following parent links.
 *
 * This is equivalent to `git merge-base --is-ancestor`.
 *
 * @param provider - The commit provider for fetching commits
 * @param potentialAncestor - The commit to check as potential ancestor
 * @param commit - The commit to start walking from
 * @returns True if potentialAncestor is an ancestor of commit
 *
 * @example
 * ```ts
 * if (await isAncestor(provider, 'oldcommit', 'newcommit')) {
 *   console.log('oldcommit is an ancestor of newcommit')
 * }
 * ```
 */
export async function isAncestor(
  provider: CommitProvider,
  potentialAncestor: string,
  commit: string
): Promise<boolean> {
  // Same commit is considered its own ancestor
  if (potentialAncestor === commit) {
    return true
  }

  const ancestors = await getAncestors(provider, commit)
  return ancestors.has(potentialAncestor)
}

/**
 * Checks ancestor relationship and returns additional information.
 *
 * Unlike `isAncestor`, this function also computes the distance
 * (number of commits) between the two commits if they are related.
 *
 * @description
 * Uses BFS to find the shortest path from `commit` to `potentialAncestor`,
 * which gives the minimum distance between them.
 *
 * @param provider - The commit provider for fetching commits
 * @param potentialAncestor - The commit to check as potential ancestor
 * @param commit - The commit to start walking from
 * @returns Detailed ancestor check result with distance information
 *
 * @example
 * ```typescript
 * const result = await checkAncestor(provider, 'abc123', 'def456')
 *
 * if (result.isAncestor) {
 *   if (result.distance === 0) {
 *     console.log('Same commit')
 *   } else {
 *     console.log(`abc123 is ${result.distance} commits behind def456`)
 *   }
 * } else {
 *   console.log('Not an ancestor')
 * }
 * ```
 */
export async function checkAncestor(
  provider: CommitProvider,
  potentialAncestor: string,
  commit: string
): Promise<AncestorCheckResult> {
  // Same commit
  if (potentialAncestor === commit) {
    return {
      isAncestor: true,
      distance: 0
    }
  }

  // BFS to find the shortest path
  const queue: Array<{ sha: string; distance: number }> = [{ sha: commit, distance: 0 }]
  const visited = new Set<string>()

  while (queue.length > 0) {
    const { sha, distance } = queue.shift()!

    if (visited.has(sha)) continue
    visited.add(sha)

    if (sha === potentialAncestor) {
      return {
        isAncestor: true,
        distance
      }
    }

    const commitObj = await provider.getCommit(sha)
    if (!commitObj) continue

    for (const parent of commitObj.parents) {
      if (!visited.has(parent)) {
        queue.push({ sha: parent, distance: distance + 1 })
      }
    }
  }

  return {
    isAncestor: false,
    distance: -1
  }
}

// ============================================================================
// Advanced Functions
// ============================================================================

/**
 * Find independent commits from a list
 *
 * Returns the subset of commits that are not reachable from
 * any other commit in the list.
 *
 * This is equivalent to `git merge-base --independent`.
 *
 * @param provider - The commit provider for fetching commits
 * @param commits - List of commit SHAs to analyze
 * @returns Array of independent commit SHAs
 *
 * @example
 * ```ts
 * const independent = await findIndependentCommits(provider, [a, b, c])
 * // Returns commits that are not ancestors of others
 * ```
 */
export async function findIndependentCommits(
  provider: CommitProvider,
  commits: string[]
): Promise<string[]> {
  if (commits.length <= 1) {
    return [...commits]
  }

  // Build ancestor sets for each commit
  const ancestorSets = new Map<string, Set<string>>()
  for (const sha of commits) {
    const ancestors = await getAncestors(provider, sha)
    // Remove the commit itself from its ancestor set
    ancestors.delete(sha)
    ancestorSets.set(sha, ancestors)
  }

  // A commit is independent if it's not an ancestor of any other commit in the list
  const independent: string[] = []

  for (const sha of commits) {
    let isAncestorOfAnother = false

    for (const otherSha of commits) {
      if (sha !== otherSha) {
        const otherAncestors = ancestorSets.get(otherSha)!
        if (otherAncestors.has(sha)) {
          isAncestorOfAnother = true
          break
        }
      }
    }

    if (!isAncestorOfAnother) {
      independent.push(sha)
    }
  }

  return independent
}

/**
 * Find the octopus merge base
 *
 * For merging more than two branches, finds a suitable merge base
 * that works for all branches.
 *
 * @param provider - The commit provider for fetching commits
 * @param commits - List of commit SHAs (3 or more)
 * @returns The octopus merge base SHA(s)
 */
export async function findOctopusMergeBase(
  provider: CommitProvider,
  commits: string[]
): Promise<string[]> {
  if (commits.length === 0) {
    return []
  }

  if (commits.length === 1) {
    const commit = await provider.getCommit(commits[0])
    return commit ? [commits[0]] : []
  }

  if (commits.length === 2) {
    return findAllMergeBases(provider, commits[0], commits[1])
  }

  // For 3+ commits, iteratively find the merge base
  // Start with the first two commits
  let currentBases = await findAllMergeBases(provider, commits[0], commits[1])

  if (currentBases.length === 0) {
    return []
  }

  // For each additional commit, find the merge base with current bases
  for (let i = 2; i < commits.length; i++) {
    const nextCommit = commits[i]
    const newBases: string[] = []

    for (const base of currentBases) {
      const bases = await findAllMergeBases(provider, base, nextCommit)
      for (const b of bases) {
        if (!newBases.includes(b)) {
          newBases.push(b)
        }
      }
    }

    if (newBases.length === 0) {
      return []
    }

    currentBases = newBases
  }

  return currentBases
}

/**
 * Compute the three-way merge base for a merge operation
 *
 * Given the current HEAD, merge target, and optionally a common ancestor,
 * returns the appropriate base for a three-way merge.
 *
 * @param provider - The commit provider for fetching commits
 * @param ours - Our commit (HEAD)
 * @param theirs - Their commit (merge target)
 * @returns The merge base for three-way merge
 */
export async function computeThreeWayMergeBase(
  provider: CommitProvider,
  ours: string,
  theirs: string
): Promise<MergeBaseResult> {
  return findMergeBase(provider, [ours, theirs])
}

/**
 * Checks if commits have any common history.
 *
 * For multiple commits to share common history, every pair of commits
 * must have at least one common ancestor.
 *
 * @description
 * This is useful for detecting if branches can be merged without
 * creating unrelated histories.
 *
 * @param provider - The commit provider for fetching commits
 * @param commits - List of commit SHAs to check
 * @returns True if all commits share common history
 *
 * @example
 * ```typescript
 * const canMerge = await hasCommonHistory(provider, [branchA, branchB, branchC])
 * if (!canMerge) {
 *   console.log('Warning: branches have unrelated histories')
 * }
 * ```
 */
export async function hasCommonHistory(
  provider: CommitProvider,
  commits: string[]
): Promise<boolean> {
  if (commits.length <= 1) {
    return true
  }

  // Check pairwise - for common history, all pairs must have a common ancestor
  for (let i = 0; i < commits.length; i++) {
    for (let j = i + 1; j < commits.length; j++) {
      const common = await findCommonAncestors(provider, commits[i], commits[j])
      if (common.size === 0) {
        return false
      }
    }
  }

  return true
}

/**
 * Calculates merge base for a recursive merge.
 *
 * When there are multiple merge bases (criss-cross merge situation),
 * this creates a virtual merge base by recursively merging the merge bases.
 *
 * @description
 * In a criss-cross merge situation, there can be multiple merge bases.
 * The recursive strategy handles this by first finding the merge base
 * of the merge bases, creating a "virtual" common ancestor.
 *
 * This is similar to Git's recursive merge strategy.
 *
 * @param provider - The commit provider for fetching commits
 * @param commit1 - First commit SHA
 * @param commit2 - Second commit SHA
 * @returns The recursive merge base result
 *
 * @example
 * ```typescript
 * // For a criss-cross merge situation:
 * //     A---B---C (branch1)
 * //    / \ / \
 * //   O   X   (merge)
 * //    \ / \ /
 * //     D---E---F (branch2)
 *
 * const result = await computeRecursiveMergeBase(provider, 'C', 'F')
 * // Returns a single merge base by recursively merging B and E's common ancestor
 * ```
 */
export async function computeRecursiveMergeBase(
  provider: CommitProvider,
  commit1: string,
  commit2: string
): Promise<MergeBaseResult> {
  const allBases = await findAllMergeBases(provider, commit1, commit2)

  if (allBases.length === 0) {
    return {
      bases: [],
      isUnique: false,
      hasCommonHistory: false,
      count: 0
    }
  }

  if (allBases.length === 1) {
    return {
      bases: allBases,
      isUnique: true,
      hasCommonHistory: true,
      count: 1
    }
  }

  // Multiple merge bases - recursively merge them
  // In a real implementation, this would create virtual merge commits
  // For now, we return the result of recursively finding merge bases of the bases
  let currentBase = allBases[0]

  for (let i = 1; i < allBases.length; i++) {
    const result = await findMergeBase(provider, [currentBase, allBases[i]])
    if (result.bases.length > 0) {
      currentBase = result.bases[0]
    }
  }

  return {
    bases: [currentBase],
    isUnique: true,
    hasCommonHistory: true,
    count: 1
  }
}
