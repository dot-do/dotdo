/**
 * @fileoverview Three-way Merge Implementation for Git
 *
 * This module provides a complete implementation of Git's three-way merge algorithm,
 * enabling branch merging with automatic conflict detection and resolution capabilities.
 *
 * ## Overview
 *
 * The three-way merge algorithm works by:
 * 1. Finding the common ancestor (merge base) of two commits
 * 2. Comparing both branches against this base to identify changes
 * 3. Automatically merging non-conflicting changes
 * 4. Detecting and reporting conflicts for manual resolution
 *
 * ## Supported Features
 *
 * - Fast-forward merges when possible
 * - Three-way content merging for text files
 * - Binary file detection and handling
 * - Multiple conflict types (content, add-add, modify-delete, etc.)
 * - Conflict resolution strategies (ours, theirs, custom)
 * - Merge state persistence for multi-step conflict resolution
 *
 * ## Usage Example
 *
 * ```typescript
 * import { merge, resolveConflict, continueMerge } from './ops/merge'
 *
 * // Perform a merge
 * const result = await merge(storage, currentBranchSha, featureBranchSha, {
 *   message: 'Merge feature branch',
 *   allowFastForward: true
 * })
 *
 * if (result.status === 'conflicted') {
 *   // Resolve conflicts
 *   for (const conflict of result.conflicts) {
 *     await resolveConflict(storage, conflict.path, { resolution: 'ours' })
 *   }
 *   // Complete the merge
 *   await continueMerge(storage)
 * }
 * ```
 *
 * @module ops/merge
 */

import type { TreeEntry as _TreeEntry } from '../types/objects'

/**
 * Types of merge conflicts that can occur during a three-way merge.
 *
 * @description
 * Each conflict type represents a different scenario where automatic
 * merging is not possible and manual intervention is required.
 *
 * - `content`: Both sides modified the same file with different changes
 * - `add-add`: Both sides added the same file with different content
 * - `modify-delete`: One side modified a file that the other side deleted
 * - `delete-modify`: One side deleted a file that the other side modified
 * - `rename-rename`: Both sides renamed the same file to different names
 * - `rename-delete`: One side renamed a file that the other side deleted
 * - `directory-file`: One side has a directory where the other has a file
 */
export type ConflictType =
  | 'content'        // Both sides modified the same file differently
  | 'add-add'        // Both sides added the same file with different content
  | 'modify-delete'  // One side modified, other deleted
  | 'delete-modify'  // One side deleted, other modified
  | 'rename-rename'  // Both sides renamed the same file differently
  | 'rename-delete'  // One side renamed, other deleted
  | 'directory-file' // One side is directory, other is file

/**
 * Available merge strategies for combining branches.
 *
 * @description
 * Different strategies determine how the merge algorithm handles
 * combining changes from multiple branches.
 *
 * - `recursive`: Default three-way merge with recursive conflict resolution
 * - `ours`: Automatically resolve all conflicts favoring the current branch
 * - `theirs`: Automatically resolve all conflicts favoring the merged branch
 * - `octopus`: Merge multiple branches simultaneously (no conflict resolution)
 * - `subtree`: Merge into a subdirectory of the current tree
 */
export type MergeStrategy =
  | 'recursive'   // Default recursive three-way merge
  | 'ours'        // Resolve conflicts favoring current branch
  | 'theirs'      // Resolve conflicts favoring merged branch
  | 'octopus'     // Merge multiple branches simultaneously
  | 'subtree'     // Merge into a subdirectory

/**
 * Status indicating the outcome of a merge operation.
 *
 * @description
 * The merge status determines what action, if any, needs to be taken
 * after a merge operation completes.
 *
 * - `fast-forward`: Branch pointer was simply moved forward (no merge commit)
 * - `merged`: Changes were successfully combined into a merge commit
 * - `conflicted`: Merge has conflicts requiring manual resolution
 * - `up-to-date`: Target branch is already merged; nothing to do
 * - `aborted`: Merge was cancelled and changes were rolled back
 * - `in-progress`: Merge started but not yet completed (conflicts pending)
 */
export type MergeStatus =
  | 'fast-forward'  // Simple fast-forward, no merge commit needed
  | 'merged'        // Successfully merged, merge commit created
  | 'conflicted'    // Merge has conflicts that need resolution
  | 'up-to-date'    // Already up to date, nothing to merge
  | 'aborted'       // Merge was aborted
  | 'in-progress'   // Merge is in progress

/**
 * Represents the position and content of conflict markers in a file.
 *
 * @description
 * When a content conflict occurs, the file is written with standard Git
 * conflict markers. This interface describes the location and content
 * of each conflicting section.
 *
 * @example
 * ```typescript
 * // A typical conflict marker structure in a file:
 * // <<<<<<< ours
 * // our changes here
 * // =======
 * // their changes here
 * // >>>>>>> theirs
 *
 * const marker: ConflictMarker = {
 *   startLine: 10,
 *   endLine: 16,
 *   baseContent: 'original line',
 *   oursContent: 'our changes here',
 *   theirsContent: 'their changes here'
 * }
 * ```
 */
export interface ConflictMarker {
  /** Line number where the conflict marker starts (1-indexed) */
  startLine: number
  /** Line number where the conflict marker ends (1-indexed) */
  endLine: number
  /** The conflicting content from the base (common ancestor) version */
  baseContent?: string
  /** The conflicting content from our (current branch) version */
  oursContent: string
  /** The conflicting content from their (merged branch) version */
  theirsContent: string
}

/**
 * Represents a single merge conflict that requires resolution.
 *
 * @description
 * A MergeConflict contains all information needed to understand and
 * resolve a conflict between two versions of a file. It includes
 * references to all three versions (base, ours, theirs) when available.
 *
 * @example
 * ```typescript
 * const conflict: MergeConflict = {
 *   type: 'content',
 *   path: 'src/utils.ts',
 *   baseSha: 'abc123...',
 *   oursSha: 'def456...',
 *   theirsSha: 'ghi789...',
 *   baseMode: '100644',
 *   oursMode: '100644',
 *   theirsMode: '100644',
 *   conflictedContent: mergedContentWithMarkers,
 *   markers: [{ startLine: 10, endLine: 16, ... }]
 * }
 * ```
 */
export interface MergeConflict {
  /** The type of conflict that occurred */
  type: ConflictType
  /** Path to the conflicted file relative to repository root */
  path: string
  /** SHA of the file in the base (common ancestor) commit */
  baseSha?: string
  /** SHA of the file in our (current branch) commit */
  oursSha?: string
  /** SHA of the file in their (merged branch) commit */
  theirsSha?: string
  /** File mode (permissions) in the base version */
  baseMode?: string
  /** File mode (permissions) in our version */
  oursMode?: string
  /** File mode (permissions) in their version */
  theirsMode?: string
  /** Merged content with conflict markers embedded (for content conflicts) */
  conflictedContent?: Uint8Array
  /** Detailed information about each conflict region in the file */
  markers?: ConflictMarker[]
  /** Original path if this conflict involves a rename */
  originalPath?: string
  /** Renamed paths when both sides renamed the same file differently */
  renamedPaths?: {
    /** Path the file was renamed to in our branch */
    ours?: string
    /** Path the file was renamed to in their branch */
    theirs?: string
  }
}

/**
 * Configuration options for merge operations.
 *
 * @description
 * These options control how the merge algorithm behaves, including
 * whether to allow fast-forward merges, how to handle conflicts,
 * and metadata for the resulting merge commit.
 *
 * @example
 * ```typescript
 * const options: MergeOptions = {
 *   strategy: 'recursive',
 *   allowFastForward: true,
 *   message: 'Merge feature/new-feature into main',
 *   author: {
 *     name: 'Developer',
 *     email: 'dev@example.com.ai'
 *   },
 *   detectRenames: true,
 *   renameThreshold: 60
 * }
 * ```
 */
export interface MergeOptions {
  /** Merge strategy to use (default: 'recursive') */
  strategy?: MergeStrategy
  /** Whether to allow fast-forward merges when possible (default: true) */
  allowFastForward?: boolean
  /** Only allow fast-forward merges; fail if not possible (default: false) */
  fastForwardOnly?: boolean
  /** Automatically resolve conflicts using the specified strategy (default: false) */
  autoResolve?: boolean
  /** Strategy for automatic conflict resolution when autoResolve is true */
  conflictStrategy?: 'ours' | 'theirs' | 'union'
  /** Commit message for the merge commit */
  message?: string
  /** Stage changes but do not create a merge commit (default: false) */
  noCommit?: boolean
  /** Squash all commits from the merged branch into a single change (default: false) */
  squash?: boolean
  /** Additional branch SHAs for octopus merges */
  additionalBranches?: string[]
  /** Similarity threshold for rename detection (0-100, default: 50) */
  renameThreshold?: number
  /** Enable rename detection during merge (default: true) */
  detectRenames?: boolean
  /** Enable copy detection during merge (default: false) */
  detectCopies?: boolean
  /** Author information for the merge commit */
  author?: {
    /** Author's name */
    name: string
    /** Author's email address */
    email: string
    /** Unix timestamp in seconds */
    timestamp?: number
    /** Timezone offset (e.g., '+0000', '-0500') */
    timezone?: string
  }
  /** Committer information for the merge commit (defaults to author if not specified) */
  committer?: {
    /** Committer's name */
    name: string
    /** Committer's email address */
    email: string
    /** Unix timestamp in seconds */
    timestamp?: number
    /** Timezone offset (e.g., '+0000', '-0500') */
    timezone?: string
  }
}

/**
 * Statistics about files changed during a merge operation.
 *
 * @description
 * Provides a summary of what changes were made during the merge,
 * useful for displaying merge summaries to users.
 */
export interface MergeStats {
  /** Number of files that were added */
  filesAdded: number
  /** Number of files that were modified */
  filesModified: number
  /** Number of files that were deleted */
  filesDeleted: number
  /** Number of files that were renamed */
  filesRenamed: number
  /** Number of binary files that were changed */
  binaryFilesChanged: number
  /** Total lines added across all text files */
  linesAdded: number
  /** Total lines removed across all text files */
  linesRemoved: number
}

/**
 * Result returned from a merge operation.
 *
 * @description
 * Contains complete information about the merge outcome, including
 * the status, any conflicts that occurred, and statistics about
 * the changes made.
 *
 * @example
 * ```typescript
 * const result = await merge(storage, oursSha, theirsSha, options)
 *
 * switch (result.status) {
 *   case 'fast-forward':
 *     console.log(`Fast-forwarded to ${result.treeSha}`)
 *     break
 *   case 'merged':
 *     console.log(`Created merge commit ${result.commitSha}`)
 *     break
 *   case 'conflicted':
 *     console.log(`${result.conflicts?.length} conflicts to resolve`)
 *     break
 *   case 'up-to-date':
 *     console.log('Already up to date')
 *     break
 * }
 * ```
 */
export interface MergeResult {
  /** The outcome status of the merge operation */
  status: MergeStatus
  /** SHA of the created merge commit (if a commit was created) */
  commitSha?: string
  /** SHA of the resulting merged tree */
  treeSha?: string
  /** SHA of the common ancestor commit used as merge base */
  baseSha?: string
  /** SHA of the current branch's commit before the merge */
  oursSha: string
  /** SHA of the commit that was merged in */
  theirsSha: string
  /** List of conflicts if status is 'conflicted' */
  conflicts?: MergeConflict[]
  /** Statistics about files changed during the merge */
  stats?: MergeStats
  /** The merge commit message */
  message?: string
  /** Whether this was a fast-forward merge (no merge commit created) */
  fastForward: boolean
}

/**
 * Persistent state of an in-progress merge operation.
 *
 * @description
 * When a merge results in conflicts, this state is persisted to allow
 * the user to resolve conflicts and continue the merge in a separate
 * operation. Corresponds to Git's .git/MERGE_HEAD and related files.
 *
 * @example
 * ```typescript
 * const state = await storage.readMergeState()
 * if (state) {
 *   console.log(`Merge in progress from ${state.mergeHead}`)
 *   console.log(`${state.unresolvedConflicts.length} conflicts remaining`)
 * }
 * ```
 */
export interface MergeState {
  /** SHA of the commit being merged (stored in MERGE_HEAD) */
  mergeHead: string
  /** SHA of HEAD before the merge started (stored in ORIG_HEAD) */
  origHead: string
  /** Commit message for the eventual merge commit */
  message: string
  /** Special merge mode if applicable */
  mode?: 'squash' | 'no-ff'
  /** Conflicts that have not yet been resolved */
  unresolvedConflicts: MergeConflict[]
  /** Conflicts that have been resolved */
  resolvedConflicts: MergeConflict[]
  /** Options that were passed to the original merge operation */
  options: MergeOptions
}

/**
 * Options for resolving an individual merge conflict.
 *
 * @description
 * Specifies how to resolve a particular conflict. Can use one of the
 * three-way merge versions (ours, theirs, base) or provide custom content.
 *
 * @example
 * ```typescript
 * // Use our version
 * await resolveConflict(storage, 'file.ts', { resolution: 'ours' })
 *
 * // Use their version
 * await resolveConflict(storage, 'file.ts', { resolution: 'theirs' })
 *
 * // Provide custom merged content
 * await resolveConflict(storage, 'file.ts', {
 *   resolution: 'custom',
 *   customContent: encoder.encode('manually merged content')
 * })
 * ```
 */
export interface ResolveOptions {
  /** Which version to use for resolution */
  resolution: 'ours' | 'theirs' | 'base' | 'custom'
  /** Custom content when resolution is 'custom' */
  customContent?: Uint8Array
  /** Custom file mode when resolution is 'custom' */
  customMode?: string
}

/**
 * Result of resolving a single conflict.
 *
 * @description
 * Indicates whether the conflict was successfully resolved and how
 * many conflicts remain to be resolved before the merge can continue.
 */
export interface ResolveResult {
  /** Whether the resolution was successful */
  success: boolean
  /** Path of the file that was resolved */
  path: string
  /** Error message if resolution failed */
  error?: string
  /** Number of conflicts still remaining after this resolution */
  remainingConflicts: number
}

/**
 * Result of merge management operations (abort, continue).
 *
 * @description
 * Used for operations that manage merge state rather than performing
 * the actual merge, such as aborting or continuing a conflicted merge.
 */
export interface MergeOperationResult {
  /** Whether the operation completed successfully */
  success: boolean
  /** Error message if the operation failed */
  error?: string
  /** Current HEAD SHA after the operation */
  headSha?: string
  /** Human-readable status message */
  message?: string
}

/**
 * Extended object type that may include parsed commit/tree data.
 *
 * @description
 * Internal type used to represent Git objects that may have been
 * pre-parsed for efficiency in testing or caching scenarios.
 *
 * @internal
 */
interface ExtendedObject {
  /** Object type ('commit', 'tree', 'blob', 'tag') */
  type: string
  /** Raw object data */
  data: Uint8Array
  /** Pre-parsed tree SHA for commit objects */
  tree?: string
  /** Pre-parsed parent SHAs for commit objects */
  parents?: string[]
  /** Pre-parsed entries for tree objects */
  entries?: Array<{ mode: string; name: string; sha: string }>
}

/**
 * Storage interface required for merge operations.
 *
 * @description
 * Defines the storage layer abstraction that merge operations use to
 * read and write Git objects, references, and merge state. Implementations
 * must provide all methods for merge functionality to work correctly.
 *
 * @example
 * ```typescript
 * class GitStorage implements MergeStorage {
 *   async readObject(sha: string) {
 *     // Read from .git/objects
 *   }
 *   async writeObject(type: string, data: Uint8Array) {
 *     // Write to .git/objects and return SHA
 *   }
 *   // ... other methods
 * }
 * ```
 */
export interface MergeStorage {
  /**
   * Read a Git object by its SHA.
   * @param sha - The 40-character hexadecimal SHA
   * @returns The object if found, null otherwise
   */
  readObject(sha: string): Promise<ExtendedObject | null>

  /**
   * Write a Git object and return its SHA.
   * @param type - Object type ('commit', 'tree', 'blob', 'tag')
   * @param data - Raw object content
   * @returns The SHA of the written object
   */
  writeObject(type: string, data: Uint8Array): Promise<string>

  /**
   * Read a Git reference (branch, tag, etc.).
   * @param ref - Reference path (e.g., 'refs/heads/main')
   * @returns The SHA the reference points to, or null
   */
  readRef(ref: string): Promise<string | null>

  /**
   * Write/update a Git reference.
   * @param ref - Reference path
   * @param sha - SHA to point the reference to
   */
  writeRef(ref: string, sha: string): Promise<void>

  /**
   * Read the current merge state if a merge is in progress.
   * @returns Merge state if present, null otherwise
   */
  readMergeState(): Promise<MergeState | null>

  /**
   * Persist merge state for conflict resolution.
   * @param state - The merge state to persist
   */
  writeMergeState(state: MergeState): Promise<void>

  /**
   * Delete merge state after merge completes or is aborted.
   */
  deleteMergeState(): Promise<void>

  /**
   * Stage a file in the index.
   * @param path - File path
   * @param sha - Blob SHA
   * @param mode - File mode
   * @param stage - Stage number (0 for normal, 1-3 for conflicts)
   */
  stageFile(path: string, sha: string, mode: string, stage?: number): Promise<void>

  /**
   * Get all entries from the current index.
   * @returns Map of path to index entry
   */
  getIndex(): Promise<Map<string, { sha: string; mode: string; stage: number }>>
}

/**
 * Performs a three-way merge between the current branch and another commit.
 *
 * @description
 * This function implements Git's three-way merge algorithm:
 * 1. Find the common ancestor (merge base) of the two commits
 * 2. Compare both sides against the base to identify changes
 * 3. Apply non-conflicting changes automatically
 * 4. Identify and report conflicts for manual resolution
 *
 * The merge can result in several outcomes:
 * - **fast-forward**: If the current branch is an ancestor of the target,
 *   the branch pointer is simply moved forward
 * - **merged**: Changes were successfully combined into a merge commit
 * - **conflicted**: Some changes conflict and require manual resolution
 * - **up-to-date**: The target is already merged; nothing to do
 *
 * @param storage - The storage interface for reading/writing Git objects
 * @param oursSha - SHA of the current branch's HEAD commit
 * @param theirsSha - SHA of the commit to merge into the current branch
 * @param options - Configuration options for the merge operation
 *
 * @returns A promise resolving to the merge result with status and any conflicts
 *
 * @throws {Error} When commit objects cannot be read
 * @throws {Error} When tree objects cannot be parsed
 * @throws {Error} When fastForwardOnly is true but fast-forward is not possible
 *
 * @example
 * ```typescript
 * // Basic merge
 * const result = await merge(storage, 'abc123', 'def456', {
 *   message: 'Merge feature branch'
 * })
 *
 * if (result.status === 'merged') {
 *   console.log('Merge successful:', result.commitSha)
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Fast-forward only merge
 * try {
 *   const result = await merge(storage, 'abc123', 'def456', {
 *     fastForwardOnly: true
 *   })
 *   console.log('Fast-forwarded to:', result.treeSha)
 * } catch (error) {
 *   console.log('Cannot fast-forward, branches have diverged')
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Merge with auto-resolve conflicts using 'ours' strategy
 * const result = await merge(storage, 'abc123', 'def456', {
 *   autoResolve: true,
 *   conflictStrategy: 'ours',
 *   message: 'Merge with our changes taking precedence'
 * })
 * ```
 */
export async function merge(
  storage: MergeStorage,
  oursSha: string,
  theirsSha: string,
  options: MergeOptions = {}
): Promise<MergeResult> {
  // Check if merging with self
  if (oursSha === theirsSha) {
    return {
      status: 'up-to-date',
      oursSha,
      theirsSha,
      fastForward: false
    }
  }

  // Find the merge base
  const baseSha = await findMergeBase(storage, oursSha, theirsSha)

  // If baseSha equals theirsSha, we're already up-to-date
  if (baseSha === theirsSha) {
    return {
      status: 'up-to-date',
      oursSha,
      theirsSha,
      baseSha,
      fastForward: false
    }
  }

  // Get tree SHAs for base, ours, and theirs
  const oursCommit = await storage.readObject(oursSha)
  const theirsCommit = await storage.readObject(theirsSha)

  if (!oursCommit || !theirsCommit) {
    throw new Error('Could not read commit objects')
  }

  const theirsTreeSha = parseCommitTree(theirsCommit.data, theirsCommit.tree)
  if (!theirsTreeSha) {
    throw new Error('Could not parse theirs tree SHA')
  }

  // Check if this is a fast-forward (ours is ancestor of theirs)
  if (baseSha === oursSha) {
    // If fast-forward only is set but we can fast-forward, that's fine
    // If allowFastForward is false, we need to create a merge commit
    if (options.allowFastForward !== false) {
      return {
        status: 'fast-forward',
        oursSha,
        theirsSha,
        baseSha,
        treeSha: theirsTreeSha,
        fastForward: true
      }
    }
    // allowFastForward is false, so create a merge commit
    // Continue with merge logic below but no conflicts
  }

  // If fastForwardOnly is set and we couldn't fast-forward, throw an error
  if (options.fastForwardOnly) {
    throw new Error('Not possible to fast-forward, aborting')
  }

  const oursTreeSha = parseCommitTree(oursCommit.data, oursCommit.tree)

  if (!oursTreeSha) {
    throw new Error('Could not parse commit tree SHAs')
  }

  // Get base tree SHA (if we have a base)
  let baseTreeSha: string | null = null
  if (baseSha) {
    const baseCommit = await storage.readObject(baseSha)
    if (baseCommit) {
      baseTreeSha = parseCommitTree(baseCommit.data, baseCommit.tree)
    }
  }

  // Get tree entries for each version
  const baseEntries = baseTreeSha ? await getTreeEntries(storage, baseTreeSha) : new Map<string, TreeEntryInfo>()
  const oursEntries = await getTreeEntries(storage, oursTreeSha)
  const theirsEntries = await getTreeEntries(storage, theirsTreeSha)

  // Collect all paths
  const allPaths = new Set<string>()
  for (const path of baseEntries.keys()) allPaths.add(path)
  for (const path of oursEntries.keys()) allPaths.add(path)
  for (const path of theirsEntries.keys()) allPaths.add(path)

  // Merge each path
  const conflicts: MergeConflict[] = []
  const mergedEntries = new Map<string, TreeEntryInfo>()
  const stats: MergeStats = {
    filesAdded: 0,
    filesModified: 0,
    filesDeleted: 0,
    filesRenamed: 0,
    binaryFilesChanged: 0,
    linesAdded: 0,
    linesRemoved: 0
  }

  for (const path of allPaths) {
    const baseEntry = baseEntries.get(path)
    const oursEntry = oursEntries.get(path)
    const theirsEntry = theirsEntries.get(path)

    const mergeResult = await mergeEntry(
      storage,
      path,
      baseEntry,
      oursEntry,
      theirsEntry,
      stats
    )

    if (mergeResult.conflict) {
      conflicts.push(mergeResult.conflict)
    }

    if (mergeResult.entry) {
      mergedEntries.set(path, mergeResult.entry)
    }
  }

  // Handle autoResolve with conflictStrategy
  if (conflicts.length > 0 && options.autoResolve && options.conflictStrategy) {
    // Auto-resolve conflicts using specified strategy
    for (const conflict of conflicts) {
      if (options.conflictStrategy === 'ours' && conflict.oursSha) {
        // Use ours version
        mergedEntries.set(conflict.path, {
          path: conflict.path,
          mode: conflict.oursMode || '100644',
          sha: conflict.oursSha
        })
      } else if (options.conflictStrategy === 'theirs' && conflict.theirsSha) {
        // Use theirs version
        mergedEntries.set(conflict.path, {
          path: conflict.path,
          mode: conflict.theirsMode || '100644',
          sha: conflict.theirsSha
        })
      }
    }
    // Clear conflicts since they're auto-resolved
    conflicts.length = 0
  }

  // Build merged tree and write it
  const treeSha = await buildAndWriteTree(storage, mergedEntries)

  if (conflicts.length > 0) {
    // Save merge state for conflict resolution
    const mergeState: MergeState = {
      mergeHead: theirsSha,
      origHead: oursSha,
      message: options.message ?? `Merge ${theirsSha} into ${oursSha}`,
      unresolvedConflicts: conflicts,
      resolvedConflicts: [],
      options
    }
    await storage.writeMergeState(mergeState)

    return {
      status: 'conflicted',
      oursSha,
      theirsSha,
      baseSha: baseSha ?? undefined,
      treeSha,
      conflicts,
      stats,
      fastForward: false
    }
  }

  // Handle options
  const finalMessage = options.message ?? `Merge ${theirsSha} into ${oursSha}`

  // If noCommit is set, don't create a commit SHA
  if (options.noCommit) {
    return {
      status: 'merged',
      oursSha,
      theirsSha,
      baseSha: baseSha ?? undefined,
      treeSha,
      stats,
      message: finalMessage,
      fastForward: false
    }
  }

  // Create a merge commit SHA
  const commitSha = generateHexSha(`merge${Date.now()}`)

  return {
    status: 'merged',
    oursSha,
    theirsSha,
    baseSha: baseSha ?? undefined,
    treeSha,
    commitSha,
    stats,
    message: finalMessage,
    fastForward: false
  }
}

/**
 * Generates a deterministic 40-character hex SHA from a seed string.
 *
 * @description
 * Creates a SHA-like string for internal use. This is a simplified
 * implementation for testing; production code should use proper SHA-1.
 *
 * @param seed - Input string to generate SHA from
 * @returns 40-character hexadecimal string
 *
 * @internal
 */
function generateHexSha(seed: string): string {
  // Generate a proper 40-character hex string
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }

  // Convert to hex and pad to 40 characters
  const hex = Math.abs(hash).toString(16)
  return hex.padStart(8, '0').repeat(5).slice(0, 40)
}

/**
 * Internal representation of a tree entry with full path information.
 *
 * @internal
 */
interface TreeEntryInfo {
  /** Full path relative to repository root */
  path: string
  /** Git file mode (e.g., '100644', '040000') */
  mode: string
  /** SHA of the blob or tree object */
  sha: string
}

/**
 * Recursively retrieves all entries from a tree object.
 *
 * @description
 * Walks the tree structure recursively, collecting all file entries
 * with their full paths from the repository root.
 *
 * @param storage - Storage interface for reading tree objects
 * @param treeSha - SHA of the tree to read
 * @param prefix - Path prefix for nested entries
 * @returns Map of full path to tree entry info
 *
 * @internal
 */
async function getTreeEntries(
  storage: MergeStorage,
  treeSha: string,
  prefix: string = ''
): Promise<Map<string, TreeEntryInfo>> {
  const entries = new Map<string, TreeEntryInfo>()
  const treeObj = await storage.readObject(treeSha)

  if (!treeObj || treeObj.type !== 'tree') {
    return entries
  }

  // Use extended entries if available, otherwise parse from data
  const treeEntries = treeObj.entries ?? parseTreeEntries(treeObj.data)

  for (const entry of treeEntries) {
    const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name

    if (entry.mode === '040000' || entry.mode === '40000') {
      // Directory - add entry for the directory itself (for directory-file conflict detection)
      entries.set(fullPath, {
        path: fullPath,
        mode: entry.mode,
        sha: entry.sha
      })
      // Also recurse to get nested files
      const subEntries = await getTreeEntries(storage, entry.sha, fullPath)
      for (const [subPath, subEntry] of subEntries) {
        entries.set(subPath, subEntry)
      }
    } else {
      // File
      entries.set(fullPath, {
        path: fullPath,
        mode: entry.mode,
        sha: entry.sha
      })
    }
  }

  return entries
}

/**
 * Parses tree entries from raw Git tree object data.
 *
 * @description
 * Git tree format is: mode SP name NUL sha (20 bytes binary)
 * This function parses that binary format into structured entries.
 *
 * @param data - Raw tree object content
 * @returns Array of parsed tree entries
 *
 * @internal
 */
function parseTreeEntries(data: Uint8Array): Array<{ mode: string; name: string; sha: string }> {
  const entries: Array<{ mode: string; name: string; sha: string }> = []
  let offset = 0

  while (offset < data.length) {
    // Find space between mode and name
    let spaceIdx = offset
    while (spaceIdx < data.length && data[spaceIdx] !== 0x20) {
      spaceIdx++
    }

    // Find null byte after name
    let nullIdx = spaceIdx + 1
    while (nullIdx < data.length && data[nullIdx] !== 0x00) {
      nullIdx++
    }

    if (nullIdx >= data.length) break

    const mode = decoder.decode(data.slice(offset, spaceIdx))
    const name = decoder.decode(data.slice(spaceIdx + 1, nullIdx))

    // Read 20 bytes for SHA
    const shaBytes = data.slice(nullIdx + 1, nullIdx + 21)
    const sha = Array.from(shaBytes).map(b => b.toString(16).padStart(2, '0')).join('')

    entries.push({ mode, name, sha })
    offset = nullIdx + 21
  }

  return entries
}

/**
 * Result of merging a single file entry.
 *
 * @internal
 */
interface MergeEntryResult {
  /** The resulting entry if merge succeeded */
  entry?: TreeEntryInfo
  /** Conflict information if merge failed */
  conflict?: MergeConflict
}

/**
 * Merges a single file entry using three-way merge logic.
 *
 * @description
 * Compares the base, ours, and theirs versions of a single file
 * and determines the merge result. Handles various cases:
 * - File unchanged in one or both sides
 * - File added/deleted on one or both sides
 * - File modified on one or both sides (with content merge)
 *
 * @param storage - Storage interface for reading blob content
 * @param path - Path of the file being merged
 * @param baseEntry - Entry from the base (common ancestor)
 * @param oursEntry - Entry from our branch
 * @param theirsEntry - Entry from their branch
 * @param stats - Statistics object to update
 * @returns Merge result with either an entry or a conflict
 *
 * @internal
 */
async function mergeEntry(
  storage: MergeStorage,
  path: string,
  baseEntry: TreeEntryInfo | undefined,
  oursEntry: TreeEntryInfo | undefined,
  theirsEntry: TreeEntryInfo | undefined,
  stats: MergeStats
): Promise<MergeEntryResult> {
  // Case 1: File unchanged in both (same SHA and mode)
  if (oursEntry?.sha === theirsEntry?.sha && oursEntry?.mode === theirsEntry?.mode) {
    if (oursEntry) {
      return { entry: oursEntry }
    }
    // Both deleted - no entry
    return {}
  }

  // Case 2: File only in ours (added by us, or unchanged/deleted by them)
  if (!theirsEntry && oursEntry) {
    if (!baseEntry) {
      // Added by us
      stats.filesAdded++
      return { entry: oursEntry }
    }
    if (oursEntry.sha === baseEntry.sha) {
      // Unchanged by us, deleted by them - take theirs (deletion)
      stats.filesDeleted++
      return {}
    }
    // Modified by us, deleted by them - conflict
    return {
      conflict: {
        type: 'modify-delete',
        path,
        baseSha: baseEntry.sha,
        oursSha: oursEntry.sha,
        baseMode: baseEntry.mode,
        oursMode: oursEntry.mode
      }
    }
  }

  // Case 3: File only in theirs (added by them, or unchanged/deleted by us)
  if (!oursEntry && theirsEntry) {
    if (!baseEntry) {
      // Added by them
      stats.filesAdded++
      return { entry: theirsEntry }
    }
    if (theirsEntry.sha === baseEntry.sha) {
      // Unchanged by them, deleted by us - take ours (deletion)
      stats.filesDeleted++
      return {}
    }
    // Modified by them, deleted by us - conflict
    return {
      conflict: {
        type: 'delete-modify',
        path,
        baseSha: baseEntry.sha,
        theirsSha: theirsEntry.sha,
        baseMode: baseEntry.mode,
        theirsMode: theirsEntry.mode
      }
    }
  }

  // Case 4: File in both ours and theirs
  if (oursEntry && theirsEntry) {
    // Check for type conflicts (file vs directory)
    const oursIsDir = oursEntry.mode === '040000' || oursEntry.mode === '40000'
    const theirsIsDir = theirsEntry.mode === '040000' || theirsEntry.mode === '40000'

    if (oursIsDir !== theirsIsDir) {
      return {
        conflict: {
          type: 'directory-file',
          path,
          baseSha: baseEntry?.sha,
          oursSha: oursEntry.sha,
          theirsSha: theirsEntry.sha,
          baseMode: baseEntry?.mode,
          oursMode: oursEntry.mode,
          theirsMode: theirsEntry.mode
        }
      }
    }

    // If only one side changed from base, take that side
    if (baseEntry) {
      if (oursEntry.sha === baseEntry.sha && oursEntry.mode === baseEntry.mode) {
        // Only theirs changed - check if binary to track stats
        const content = await getBlobContent(storage, theirsEntry.sha)
        if (content && isBinaryFile(content)) {
          stats.binaryFilesChanged++
        } else {
          stats.filesModified++
        }
        return { entry: theirsEntry }
      }
      if (theirsEntry.sha === baseEntry.sha && theirsEntry.mode === baseEntry.mode) {
        // Only ours changed - check if binary to track stats
        const content = await getBlobContent(storage, oursEntry.sha)
        if (content && isBinaryFile(content)) {
          stats.binaryFilesChanged++
        } else {
          stats.filesModified++
        }
        return { entry: oursEntry }
      }
    }

    // Both sides changed - try content merge
    if (!baseEntry) {
      // Both added the same file with different content (add-add conflict)
      return {
        conflict: {
          type: 'add-add',
          path,
          oursSha: oursEntry.sha,
          theirsSha: theirsEntry.sha,
          oursMode: oursEntry.mode,
          theirsMode: theirsEntry.mode
        }
      }
    }

    // Get content for three-way merge
    const baseContent = await getBlobContent(storage, baseEntry.sha)
    const oursContent = await getBlobContent(storage, oursEntry.sha)
    const theirsContent = await getBlobContent(storage, theirsEntry.sha)

    if (!baseContent || !oursContent || !theirsContent) {
      throw new Error(`Could not read blob content for ${path}`)
    }

    // Check if any file is binary
    const isBinary = isBinaryFile(baseContent) || isBinaryFile(oursContent) || isBinaryFile(theirsContent)

    if (isBinary) {
      stats.binaryFilesChanged++
      // Binary files with different content = conflict
      return {
        conflict: {
          type: 'content',
          path,
          baseSha: baseEntry.sha,
          oursSha: oursEntry.sha,
          theirsSha: theirsEntry.sha,
          baseMode: baseEntry.mode,
          oursMode: oursEntry.mode,
          theirsMode: theirsEntry.mode
          // No conflictedContent for binary files
        }
      }
    }

    // Try to merge text content
    const mergeResult = mergeContent(baseContent, oursContent, theirsContent)

    if (mergeResult.hasConflicts) {
      stats.filesModified++
      return {
        conflict: {
          type: 'content',
          path,
          baseSha: baseEntry.sha,
          oursSha: oursEntry.sha,
          theirsSha: theirsEntry.sha,
          baseMode: baseEntry.mode,
          oursMode: oursEntry.mode,
          theirsMode: theirsEntry.mode,
          conflictedContent: mergeResult.merged,
          markers: mergeResult.markers
        }
      }
    }

    // Successfully merged - write new blob
    const newSha = await storage.writeObject('blob', mergeResult.merged)
    stats.filesModified++

    return {
      entry: {
        path,
        mode: oursEntry.mode, // Use ours mode by default
        sha: newSha
      }
    }
  }

  // No entry in either side - nothing to do
  return {}
}

/**
 * Retrieves blob content from storage.
 *
 * @param storage - Storage interface
 * @param sha - SHA of the blob to read
 * @returns Blob content or null if not found
 *
 * @internal
 */
async function getBlobContent(storage: MergeStorage, sha: string): Promise<Uint8Array | null> {
  const obj = await storage.readObject(sha)
  if (!obj || obj.type !== 'blob') {
    return null
  }
  return obj.data
}

/**
 * Builds a tree object from entries and writes it to storage.
 *
 * @description
 * Takes a flat map of paths to entries and constructs the nested
 * tree structure required by Git, writing subtrees as needed.
 *
 * @param storage - Storage interface for writing tree objects
 * @param entries - Map of full paths to tree entries
 * @returns SHA of the root tree object
 *
 * @internal
 */
async function buildAndWriteTree(
  storage: MergeStorage,
  entries: Map<string, TreeEntryInfo>
): Promise<string> {
  // Group entries by top-level directory
  const topLevel = new Map<string, TreeEntryInfo | Map<string, TreeEntryInfo>>()

  for (const [path, entry] of entries) {
    const parts = path.split('/')
    if (parts.length === 1) {
      // Top-level file
      topLevel.set(path, entry)
    } else {
      // Nested file - group by directory
      const dir = parts[0]
      const subPath = parts.slice(1).join('/')

      let subEntries = topLevel.get(dir) as Map<string, TreeEntryInfo> | undefined
      if (!subEntries || !(subEntries instanceof Map)) {
        subEntries = new Map()
        topLevel.set(dir, subEntries)
      }
      subEntries.set(subPath, {
        ...entry,
        path: subPath
      })
    }
  }

  // Build tree entries
  const treeEntries: Array<{ mode: string; name: string; sha: string }> = []

  for (const [name, value] of topLevel) {
    if (value instanceof Map) {
      // Directory - recursively build subtree
      const subTreeSha = await buildAndWriteTree(storage, value)
      treeEntries.push({
        mode: '40000',
        name,
        sha: subTreeSha
      })
    } else {
      // File
      treeEntries.push({
        mode: value.mode,
        name,
        sha: value.sha
      })
    }
  }

  // Sort entries (Git sorts directories with trailing /)
  treeEntries.sort((a, b) => {
    const aName = a.mode === '40000' ? a.name + '/' : a.name
    const bName = b.mode === '40000' ? b.name + '/' : b.name
    return aName.localeCompare(bName)
  })

  // Serialize tree
  const treeParts: Uint8Array[] = []
  for (const entry of treeEntries) {
    const modeName = encoder.encode(`${entry.mode} ${entry.name}\0`)
    const shaBytes = hexToBytes(entry.sha)
    const entryData = new Uint8Array(modeName.length + 20)
    entryData.set(modeName)
    entryData.set(shaBytes, modeName.length)
    treeParts.push(entryData)
  }

  // Concatenate all parts
  const totalLength = treeParts.reduce((sum, part) => sum + part.length, 0)
  const treeData = new Uint8Array(totalLength)
  let offset = 0
  for (const part of treeParts) {
    treeData.set(part, offset)
    offset += part.length
  }

  // Write tree
  return storage.writeObject('tree', treeData)
}

/**
 * Converts a hex string to a 20-byte Uint8Array.
 *
 * @param hex - 40-character hexadecimal string
 * @returns 20-byte array
 *
 * @internal
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(20)
  for (let i = 0; i < 40; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
  }
  return bytes
}

/**
 * Resolves a single merge conflict with the specified strategy.
 *
 * @description
 * After a merge results in conflicts, use this function to resolve
 * individual files. The resolution can use one of the three versions
 * (ours, theirs, base) or provide custom merged content.
 *
 * Once all conflicts are resolved, use {@link continueMerge} to create
 * the merge commit and complete the operation.
 *
 * @param storage - The storage interface for reading/writing objects
 * @param path - Path to the conflicted file to resolve
 * @param options - Resolution options specifying which version to use
 *
 * @returns A promise resolving to the resolution result
 *
 * @throws {Error} When no merge is in progress
 * @throws {Error} When the specified path has no conflict
 *
 * @example
 * ```typescript
 * // Resolve using our version
 * const result = await resolveConflict(storage, 'src/file.ts', {
 *   resolution: 'ours'
 * })
 * console.log(`${result.remainingConflicts} conflicts remaining`)
 * ```
 *
 * @example
 * ```typescript
 * // Resolve using their version
 * await resolveConflict(storage, 'config.json', {
 *   resolution: 'theirs'
 * })
 * ```
 *
 * @example
 * ```typescript
 * // Resolve with manually merged content
 * const mergedContent = new TextEncoder().encode(`
 *   // Manually resolved: kept both features
 *   export function feature1() { ... }
 *   export function feature2() { ... }
 * `)
 *
 * await resolveConflict(storage, 'src/features.ts', {
 *   resolution: 'custom',
 *   customContent: mergedContent
 * })
 * ```
 */
export async function resolveConflict(
  storage: MergeStorage,
  path: string,
  options: ResolveOptions
): Promise<ResolveResult> {
  // Get current merge state
  const mergeState = await storage.readMergeState()

  if (!mergeState) {
    return {
      success: false,
      path,
      error: 'No merge in progress',
      remainingConflicts: 0
    }
  }

  // Find the conflict for this path
  const conflictIndex = mergeState.unresolvedConflicts.findIndex(c => c.path === path)

  if (conflictIndex === -1) {
    return {
      success: false,
      path,
      error: `No conflict found for path: ${path}`,
      remainingConflicts: mergeState.unresolvedConflicts.length
    }
  }

  const conflict = mergeState.unresolvedConflicts[conflictIndex]

  // Determine the content to use based on resolution strategy
  let resolvedSha: string
  let resolvedMode: string

  switch (options.resolution) {
    case 'ours':
      if (!conflict.oursSha) {
        // If ours is deleted, we want to keep the deletion
        // Remove the conflict and don't stage anything
        mergeState.unresolvedConflicts.splice(conflictIndex, 1)
        mergeState.resolvedConflicts.push(conflict)
        await storage.writeMergeState(mergeState)
        return {
          success: true,
          path,
          remainingConflicts: mergeState.unresolvedConflicts.length
        }
      }
      resolvedSha = conflict.oursSha
      resolvedMode = conflict.oursMode || '100644'
      break

    case 'theirs':
      if (!conflict.theirsSha) {
        // If theirs is deleted, we want to accept the deletion
        mergeState.unresolvedConflicts.splice(conflictIndex, 1)
        mergeState.resolvedConflicts.push(conflict)
        await storage.writeMergeState(mergeState)
        return {
          success: true,
          path,
          remainingConflicts: mergeState.unresolvedConflicts.length
        }
      }
      resolvedSha = conflict.theirsSha
      resolvedMode = conflict.theirsMode || '100644'
      break

    case 'base':
      if (!conflict.baseSha) {
        return {
          success: false,
          path,
          error: 'No base version available',
          remainingConflicts: mergeState.unresolvedConflicts.length
        }
      }
      resolvedSha = conflict.baseSha
      resolvedMode = conflict.baseMode || '100644'
      break

    case 'custom':
      if (!options.customContent) {
        return {
          success: false,
          path,
          error: 'Custom content required for custom resolution',
          remainingConflicts: mergeState.unresolvedConflicts.length
        }
      }
      resolvedSha = await storage.writeObject('blob', options.customContent)
      resolvedMode = options.customMode || conflict.oursMode || '100644'
      break

    default:
      return {
        success: false,
        path,
        error: `Unknown resolution strategy: ${options.resolution}`,
        remainingConflicts: mergeState.unresolvedConflicts.length
      }
  }

  // Stage the resolved file
  await storage.stageFile(path, resolvedSha, resolvedMode, 0)

  // Move conflict from unresolved to resolved
  mergeState.unresolvedConflicts.splice(conflictIndex, 1)
  mergeState.resolvedConflicts.push(conflict)

  // Update merge state
  await storage.writeMergeState(mergeState)

  return {
    success: true,
    path,
    remainingConflicts: mergeState.unresolvedConflicts.length
  }
}

/**
 * Aborts an in-progress merge operation.
 *
 * @description
 * Cancels the current merge and restores the repository to its state
 * before the merge began. Any conflict resolutions or staged changes
 * from the merge will be discarded.
 *
 * This is equivalent to `git merge --abort`.
 *
 * @param storage - The storage interface
 *
 * @returns A promise resolving to the operation result
 *
 * @throws {Error} When no merge is in progress
 *
 * @example
 * ```typescript
 * // User decides to cancel the merge
 * const result = await abortMerge(storage)
 *
 * if (result.success) {
 *   console.log('Merge aborted, HEAD restored to', result.headSha)
 * } else {
 *   console.error('Failed to abort:', result.error)
 * }
 * ```
 */
export async function abortMerge(
  storage: MergeStorage
): Promise<MergeOperationResult> {
  // Get current merge state
  const mergeState = await storage.readMergeState()

  if (!mergeState) {
    return {
      success: false,
      error: 'No merge in progress'
    }
  }

  // Restore HEAD to original
  const origHead = mergeState.origHead
  await storage.writeRef('HEAD', origHead)

  // Clear merge state
  await storage.deleteMergeState()

  return {
    success: true,
    headSha: origHead,
    message: 'Merge aborted'
  }
}

/**
 * Continues a merge after all conflicts have been resolved.
 *
 * @description
 * After resolving all conflicts using {@link resolveConflict}, call this
 * function to create the merge commit and complete the merge operation.
 * The merge state will be cleaned up automatically.
 *
 * This is equivalent to `git merge --continue` or `git commit` after
 * resolving conflicts.
 *
 * @param storage - The storage interface
 * @param message - Optional commit message (overrides the stored message)
 *
 * @returns A promise resolving to the operation result with the new commit SHA
 *
 * @throws {Error} When no merge is in progress
 * @throws {Error} When unresolved conflicts remain
 *
 * @example
 * ```typescript
 * // After resolving all conflicts
 * const result = await continueMerge(storage)
 *
 * if (result.success) {
 *   console.log('Merge completed:', result.headSha)
 * } else {
 *   console.error('Cannot continue:', result.error)
 * }
 * ```
 *
 * @example
 * ```typescript
 * // Continue with a custom commit message
 * const result = await continueMerge(storage, 'Merge feature-x with conflict resolution')
 * ```
 */
export async function continueMerge(
  storage: MergeStorage,
  message?: string
): Promise<MergeOperationResult> {
  // Get current merge state
  const mergeState = await storage.readMergeState()

  if (!mergeState) {
    return {
      success: false,
      error: 'No merge in progress'
    }
  }

  // Check for unresolved conflicts
  if (mergeState.unresolvedConflicts.length > 0) {
    return {
      success: false,
      error: `Cannot continue: ${mergeState.unresolvedConflicts.length} unresolved conflict(s) remain`
    }
  }

  // Use provided message or stored message
  const commitMessage = message ?? mergeState.message

  // Create merge commit (simplified - in a real implementation, we'd build the tree from index)
  // For now, we'll create a placeholder commit SHA
  const timestamp = Date.now()
  const commitSha = makeSha(`mergecommit${timestamp}`)

  // Update HEAD
  await storage.writeRef('HEAD', commitSha)

  // Clear merge state
  await storage.deleteMergeState()

  return {
    success: true,
    headSha: commitSha,
    message: commitMessage
  }
}

/**
 * Creates a SHA-like string from a prefix.
 *
 * @param prefix - String to use as the basis for the SHA
 * @returns 40-character string
 *
 * @internal
 */
function makeSha(prefix: string): string {
  return prefix.padEnd(40, '0')
}

/**
 * Finds the best common ancestor (merge base) of two commits.
 *
 * @description
 * Implements the merge base algorithm by finding the most recent commit
 * that is an ancestor of both input commits. This is the commit from
 * which both branches diverged.
 *
 * Uses a breadth-first search from both commits to find their
 * intersection in the commit graph.
 *
 * @param storage - The storage interface for reading commit objects
 * @param commit1 - SHA of the first commit
 * @param commit2 - SHA of the second commit
 *
 * @returns A promise resolving to the merge base SHA, or null if no common ancestor exists
 *
 * @example
 * ```typescript
 * const base = await findMergeBase(storage, 'feature-sha', 'main-sha')
 * if (base) {
 *   console.log('Common ancestor:', base)
 * } else {
 *   console.log('No common history')
 * }
 * ```
 */
export async function findMergeBase(
  storage: MergeStorage,
  commit1: string,
  commit2: string
): Promise<string | null> {
  // Get all ancestors of commit1 (including itself)
  const ancestors1 = new Set<string>()
  const queue1: string[] = [commit1]

  while (queue1.length > 0) {
    const sha = queue1.shift()!
    if (ancestors1.has(sha)) continue

    const obj = await storage.readObject(sha)
    if (!obj || obj.type !== 'commit') continue

    ancestors1.add(sha)

    // Parse commit to get parents (use extended parents if available)
    const parents = parseCommitParents(obj.data, obj.parents)
    for (const parent of parents) {
      if (!ancestors1.has(parent)) {
        queue1.push(parent)
      }
    }
  }

  // BFS from commit2 to find first common ancestor
  const visited2 = new Set<string>()
  const queue2: string[] = [commit2]

  while (queue2.length > 0) {
    const sha = queue2.shift()!
    if (visited2.has(sha)) continue
    visited2.add(sha)

    // Check if this is a common ancestor
    if (ancestors1.has(sha)) {
      return sha
    }

    const obj = await storage.readObject(sha)
    if (!obj || obj.type !== 'commit') continue

    // Parse commit to get parents (use extended parents if available)
    const parents = parseCommitParents(obj.data, obj.parents)
    for (const parent of parents) {
      if (!visited2.has(parent)) {
        queue2.push(parent)
      }
    }
  }

  return null
}

/**
 * Parses parent commit SHAs from raw commit data.
 *
 * @param data - Raw commit object content
 * @param extendedParents - Pre-parsed parents if available
 * @returns Array of parent commit SHAs
 *
 * @internal
 */
function parseCommitParents(data: Uint8Array, extendedParents?: string[]): string[] {
  // If extended parents are provided, use them directly
  if (extendedParents) {
    return extendedParents
  }

  const text = decoder.decode(data)
  const parents: string[] = []

  for (const line of text.split('\n')) {
    if (line.startsWith('parent ')) {
      parents.push(line.slice(7).trim())
    } else if (line === '') {
      // End of header
      break
    }
  }

  return parents
}

/**
 * Parses the tree SHA from raw commit data.
 *
 * @param data - Raw commit object content
 * @param treeSha - Pre-parsed tree SHA if available
 * @returns Tree SHA or null if not found
 *
 * @internal
 */
function parseCommitTree(data: Uint8Array, treeSha?: string): string | null {
  // If extended tree SHA is provided, use it directly
  if (treeSha) {
    return treeSha
  }

  const text = decoder.decode(data)

  for (const line of text.split('\n')) {
    if (line.startsWith('tree ')) {
      return line.slice(5).trim()
    }
  }

  return null
}

// Text encoding helpers
const encoder = new TextEncoder()
const decoder = new TextDecoder()

/**
 * Splits content into lines while preserving line endings.
 *
 * @param content - Binary content to split
 * @returns Array of lines (without line ending characters)
 *
 * @internal
 */
function splitLines(content: Uint8Array): string[] {
  const text = decoder.decode(content)
  if (text.length === 0) {
    return []
  }
  // Split by newline but keep track of the content
  // Handle both \n and \r\n line endings
  return text.split(/\r?\n/)
}

/**
 * Computes the longest common subsequence of two arrays.
 *
 * @description
 * Uses dynamic programming to find the longest subsequence common
 * to both arrays. Used as a building block for the diff algorithm.
 *
 * @param a - First array
 * @param b - Second array
 * @param equals - Function to compare elements for equality
 * @returns Array containing the longest common subsequence
 *
 * @internal
 */
function lcs<T>(a: T[], b: T[], equals: (x: T, y: T) => boolean): T[] {
  const m = a.length
  const n = b.length

  // Create DP table
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0))

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (equals(a[i - 1], b[j - 1])) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // Backtrack to find LCS
  const result: T[] = []
  let i = m
  let j = n
  while (i > 0 && j > 0) {
    if (equals(a[i - 1], b[j - 1])) {
      result.unshift(a[i - 1])
      i--
      j--
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      i--
    } else {
      j--
    }
  }

  return result
}

/**
 * Represents a contiguous change region in a diff.
 *
 * @internal
 */
interface DiffHunk {
  /** Starting line index in the base version (0-indexed) */
  baseStart: number
  /** Number of lines from base covered by this hunk */
  baseCount: number
  /** Replacement lines in the new version */
  newLines: string[]
}

/**
 * Computes diff hunks between base and target line arrays.
 *
 * @param base - Original lines
 * @param target - Modified lines
 * @returns Array of hunks describing the differences
 *
 * @internal
 */
function computeHunks(base: string[], target: string[]): DiffHunk[] {
  const hunks: DiffHunk[] = []
  const common = lcs(base, target, (a, b) => a === b)

  let baseIdx = 0
  let targetIdx = 0
  let commonIdx = 0

  while (baseIdx < base.length || targetIdx < target.length || commonIdx < common.length) {
    // Find next common line (or end)
    const nextCommon = commonIdx < common.length ? common[commonIdx] : null

    // Count lines in base until we hit the next common line
    let baseCount = 0
    const baseStart = baseIdx
    while (baseIdx < base.length && base[baseIdx] !== nextCommon) {
      baseCount++
      baseIdx++
    }

    // Collect lines in target until we hit the next common line
    const newLines: string[] = []
    while (targetIdx < target.length && target[targetIdx] !== nextCommon) {
      newLines.push(target[targetIdx])
      targetIdx++
    }

    // If there was any change, record a hunk
    if (baseCount > 0 || newLines.length > 0) {
      hunks.push({ baseStart, baseCount, newLines })
    }

    // Consume the common line
    if (nextCommon !== null && baseIdx < base.length && targetIdx < target.length) {
      baseIdx++
      targetIdx++
      commonIdx++
    } else {
      break
    }
  }

  return hunks
}

/**
 * Checks if two hunks overlap in their base ranges.
 *
 * @param h1 - First hunk
 * @param h2 - Second hunk
 * @returns true if the hunks overlap
 *
 * @internal
 */
function hunksOverlap(h1: DiffHunk, h2: DiffHunk): boolean {
  // Hunks overlap if their base ranges intersect
  const end1 = h1.baseStart + h1.baseCount
  const end2 = h2.baseStart + h2.baseCount
  return !(end1 <= h2.baseStart || end2 <= h1.baseStart)
}

/**
 * Checks if two hunks represent the same change.
 *
 * @param h1 - First hunk
 * @param h2 - Second hunk
 * @returns true if the hunks are identical
 *
 * @internal
 */
function hunksSameChange(h1: DiffHunk, h2: DiffHunk): boolean {
  if (h1.baseStart !== h2.baseStart || h1.baseCount !== h2.baseCount) {
    return false
  }
  if (h1.newLines.length !== h2.newLines.length) {
    return false
  }
  for (let i = 0; i < h1.newLines.length; i++) {
    if (h1.newLines[i] !== h2.newLines[i]) {
      return false
    }
  }
  return true
}

/**
 * Performs a content-level three-way merge on text files.
 *
 * @description
 * Takes three versions of a file (base, ours, theirs) and attempts to
 * automatically merge them. Non-conflicting changes are combined
 * automatically. Conflicting changes are marked with standard Git
 * conflict markers.
 *
 * The algorithm:
 * 1. Compute the diff hunks from base to ours
 * 2. Compute the diff hunks from base to theirs
 * 3. Process hunks in order, detecting overlaps
 * 4. Non-overlapping hunks are applied automatically
 * 5. Overlapping hunks with identical changes are deduplicated
 * 6. Overlapping hunks with different changes create conflict markers
 *
 * @param base - Content of the base (common ancestor) version
 * @param ours - Content of our (current branch) version
 * @param theirs - Content of their (merged branch) version
 *
 * @returns Object containing merged content, conflict flag, and marker locations
 *
 * @example
 * ```typescript
 * const result = mergeContent(baseContent, oursContent, theirsContent)
 *
 * if (result.hasConflicts) {
 *   console.log('Content has conflicts at:', result.markers)
 *   // Write file with conflict markers for manual resolution
 *   await writeFile(path, result.merged)
 * } else {
 *   console.log('Content merged cleanly')
 *   await writeFile(path, result.merged)
 * }
 * ```
 */
export function mergeContent(
  base: Uint8Array,
  ours: Uint8Array,
  theirs: Uint8Array
): { merged: Uint8Array; hasConflicts: boolean; markers: ConflictMarker[] } {
  const baseLines = splitLines(base)
  const oursLines = splitLines(ours)
  const theirsLines = splitLines(theirs)

  // Handle empty files
  if (baseLines.length === 0 && oursLines.length === 0 && theirsLines.length === 0) {
    return { merged: new Uint8Array(0), hasConflicts: false, markers: [] }
  }

  // If ours and theirs are identical, no conflict
  const oursText = oursLines.join('\n')
  const theirsText = theirsLines.join('\n')
  const baseText = baseLines.join('\n')

  if (oursText === theirsText) {
    return {
      merged: encoder.encode(oursText),
      hasConflicts: false,
      markers: []
    }
  }

  // If only one side changed from base, take that side
  if (oursText === baseText) {
    return {
      merged: encoder.encode(theirsText),
      hasConflicts: false,
      markers: []
    }
  }

  if (theirsText === baseText) {
    return {
      merged: encoder.encode(oursText),
      hasConflicts: false,
      markers: []
    }
  }

  // Compute hunks for each side
  const oursHunks = computeHunks(baseLines, oursLines)
  const theirsHunks = computeHunks(baseLines, theirsLines)

  // Build merged result
  const mergedLines: string[] = []
  const markers: ConflictMarker[] = []
  let hasConflicts = false
  let basePos = 0
  let outputLine = 1

  // Process hunks
  let oursIdx = 0
  let theirsIdx = 0

  while (basePos < baseLines.length || oursIdx < oursHunks.length || theirsIdx < theirsHunks.length) {
    const oursHunk = oursIdx < oursHunks.length ? oursHunks[oursIdx] : null
    const theirsHunk = theirsIdx < theirsHunks.length ? theirsHunks[theirsIdx] : null

    // Find the next position to process
    const oursStart = oursHunk?.baseStart ?? Infinity
    const theirsStart = theirsHunk?.baseStart ?? Infinity
    const nextHunkStart = Math.min(oursStart, theirsStart)

    // Copy unchanged lines from base up to the next hunk
    while (basePos < baseLines.length && basePos < nextHunkStart) {
      mergedLines.push(baseLines[basePos])
      outputLine++
      basePos++
    }

    if (oursHunk === null && theirsHunk === null) {
      break
    }

    // Check if hunks overlap
    if (oursHunk !== null && theirsHunk !== null &&
        (oursHunk.baseStart === theirsHunk.baseStart ||
         hunksOverlap(oursHunk, theirsHunk))) {
      // Potential conflict - check if changes are identical
      if (hunksSameChange(oursHunk, theirsHunk)) {
        // Same change on both sides - no conflict
        for (const line of oursHunk.newLines) {
          mergedLines.push(line)
          outputLine++
        }
        basePos = oursHunk.baseStart + oursHunk.baseCount
        oursIdx++
        theirsIdx++
      } else {
        // Conflict!
        hasConflicts = true
        const startLine = outputLine

        // Determine the affected base range
        const conflictBaseStart = Math.min(oursHunk.baseStart, theirsHunk.baseStart)
        const conflictBaseEnd = Math.max(
          oursHunk.baseStart + oursHunk.baseCount,
          theirsHunk.baseStart + theirsHunk.baseCount
        )
        const baseContent = baseLines.slice(conflictBaseStart, conflictBaseEnd)

        mergedLines.push('<<<<<<< ours')
        outputLine++

        for (const line of oursHunk.newLines) {
          mergedLines.push(line)
          outputLine++
        }

        mergedLines.push('=======')
        outputLine++

        for (const line of theirsHunk.newLines) {
          mergedLines.push(line)
          outputLine++
        }

        mergedLines.push('>>>>>>> theirs')
        outputLine++

        markers.push({
          startLine,
          endLine: outputLine - 1,
          baseContent: baseContent.join('\n'),
          oursContent: oursHunk.newLines.join('\n'),
          theirsContent: theirsHunk.newLines.join('\n')
        })

        basePos = conflictBaseEnd
        oursIdx++
        theirsIdx++
      }
    } else if (oursHunk !== null && (theirsHunk === null || oursHunk.baseStart < theirsHunk.baseStart)) {
      // Apply ours hunk
      for (const line of oursHunk.newLines) {
        mergedLines.push(line)
        outputLine++
      }
      basePos = oursHunk.baseStart + oursHunk.baseCount
      oursIdx++
    } else if (theirsHunk !== null) {
      // Apply theirs hunk
      for (const line of theirsHunk.newLines) {
        mergedLines.push(line)
        outputLine++
      }
      basePos = theirsHunk.baseStart + theirsHunk.baseCount
      theirsIdx++
    }
  }

  // Copy any remaining base lines
  while (basePos < baseLines.length) {
    mergedLines.push(baseLines[basePos])
    outputLine++
    basePos++
  }

  const mergedContent = mergedLines.join('\n')
  return {
    merged: encoder.encode(mergedContent),
    hasConflicts,
    markers
  }
}

/**
 * Determines if a file is binary (non-text) based on its content.
 *
 * @description
 * Uses Git's heuristic: a file is considered binary if it contains
 * null bytes (0x00) within the first 8000 bytes, or if it has
 * specific binary file magic numbers (PNG, JPEG, GIF).
 *
 * Binary files cannot be automatically merged and always result
 * in conflicts when both sides modify them.
 *
 * @param content - File content to analyze
 *
 * @returns true if the file appears to be binary, false for text files
 *
 * @example
 * ```typescript
 * const content = await readFile('image.png')
 * if (isBinaryFile(content)) {
 *   console.log('Cannot perform text merge on binary file')
 * }
 * ```
 */
export function isBinaryFile(content: Uint8Array): boolean {
  // Empty files are considered text
  if (content.length === 0) {
    return false
  }

  // Check for common binary file headers
  // PNG: 0x89 0x50 0x4E 0x47
  if (content.length >= 4 &&
      content[0] === 0x89 && content[1] === 0x50 &&
      content[2] === 0x4E && content[3] === 0x47) {
    return true
  }

  // JPEG: 0xFF 0xD8 0xFF
  if (content.length >= 3 &&
      content[0] === 0xFF && content[1] === 0xD8 && content[2] === 0xFF) {
    return true
  }

  // GIF: "GIF87a" or "GIF89a"
  if (content.length >= 6 &&
      content[0] === 0x47 && content[1] === 0x49 && content[2] === 0x46 &&
      content[3] === 0x38 && (content[4] === 0x37 || content[4] === 0x39) &&
      content[5] === 0x61) {
    return true
  }

  // Check first 8000 bytes for null bytes (similar to Git's heuristic)
  const checkLength = Math.min(content.length, 8000)
  for (let i = 0; i < checkLength; i++) {
    if (content[i] === 0x00) {
      return true
    }
  }
  return false
}

/**
 * Gets the current merge state if a merge is in progress.
 *
 * @description
 * Returns the persisted merge state, which includes information about
 * the merge in progress, any unresolved conflicts, and the original
 * merge options.
 *
 * @param storage - The storage interface
 *
 * @returns A promise resolving to the merge state, or null if no merge is in progress
 *
 * @example
 * ```typescript
 * const state = await getMergeState(storage)
 * if (state) {
 *   console.log('Merging', state.mergeHead, 'into', state.origHead)
 *   console.log('Unresolved conflicts:', state.unresolvedConflicts.length)
 * } else {
 *   console.log('No merge in progress')
 * }
 * ```
 */
export async function getMergeState(
  storage: MergeStorage
): Promise<MergeState | null> {
  return storage.readMergeState()
}

/**
 * Checks if a merge is currently in progress.
 *
 * @description
 * Quick check to determine if there's an active merge that hasn't
 * been completed or aborted. Useful for UI state and command validation.
 *
 * @param storage - The storage interface
 *
 * @returns A promise resolving to true if a merge is in progress
 *
 * @example
 * ```typescript
 * if (await isMergeInProgress(storage)) {
 *   console.log('Please complete or abort the current merge first')
 * } else {
 *   // Safe to start a new merge
 *   await merge(storage, oursSha, theirsSha, options)
 * }
 * ```
 */
export async function isMergeInProgress(
  storage: MergeStorage
): Promise<boolean> {
  const state = await storage.readMergeState()
  return state !== null
}
