/**
 * GitxBranchStorage - Use gitx for session branch storage
 *
 * Maps bashx session concepts to Git semantics:
 * - Session branch -> Git branch (refs/session/<session-id>/branches/<name>)
 * - Session state -> Git tree/commit
 * - fork() -> git branch + checkout
 * - checkout() -> git checkout
 * - merge() -> git merge
 *
 * This adapter provides a bridge between bashx sessions and gitx's
 * RefStorage system, enabling session versioning with Git semantics.
 *
 * @module bashx/session/gitx-branch-storage
 */

import type {
  SessionId,
  SessionBranch,
  BranchStorage,
} from './types.js'

// ============================================================================
// GitxAdapter Interface
// ============================================================================

/**
 * Adapter interface for gitx operations.
 *
 * This interface abstracts the gitx API to allow for testing and
 * different gitx implementations (e.g., in-memory, R2-backed).
 *
 * The adapter methods map to core Git operations:
 * - Branch creation and management
 * - Ref operations (get, set, list, delete)
 * - Commit operations for persisting session state
 */
export interface GitxAdapter {
  /**
   * Initialize the repository at the given path.
   * @param repoPath - Path to initialize the repository
   */
  init(repoPath: string): Promise<void>

  /**
   * Create a new branch, optionally from an existing branch.
   * @param name - The branch name (without refs/heads/ prefix)
   * @param from - Optional source branch to create from
   */
  createBranch(name: string, from?: string): Promise<void>

  /**
   * Checkout a branch, making it the current HEAD.
   * @param branch - The branch name to checkout
   */
  checkout(branch: string): Promise<void>

  /**
   * Create a commit with the given tree and message.
   * @param message - Commit message
   * @param tree - Tree object representing the session state
   * @returns The SHA of the created commit
   */
  commit(message: string, tree: unknown): Promise<string>

  /**
   * Get branch information by name.
   * @param name - The branch name
   * @returns Branch info with SHA, or null if not found
   */
  getBranch(name: string): Promise<{ sha: string; name: string } | null>

  /**
   * List all branches, optionally filtered by prefix.
   * @param prefix - Optional prefix to filter branches
   * @returns Array of branch names
   */
  listBranches(prefix?: string): Promise<string[]>

  /**
   * Merge one branch into another.
   * @param from - Source branch to merge from
   * @param into - Target branch to merge into
   * @returns Merge result with success flag and optional conflicts
   */
  merge(from: string, into: string): Promise<{ success: boolean; conflicts?: string[] }>

  /**
   * Delete a branch.
   * @param name - The branch name to delete
   * @returns true if deleted, false if branch didn't exist
   */
  deleteBranch(name: string): Promise<boolean>

  /**
   * Resolve a ref to its SHA.
   * @param ref - The ref name (can be branch, tag, or full ref path)
   * @returns The SHA the ref points to, or null if not found
   */
  resolveRef(ref: string): Promise<string | null>

  /**
   * Set a ref to point to a SHA.
   * @param ref - The ref name
   * @param sha - The SHA to point to
   */
  setRef(ref: string, sha: string): Promise<void>
}

// ============================================================================
// GitxBranchStorage Implementation
// ============================================================================

/**
 * Configuration options for GitxBranchStorage.
 */
export interface GitxBranchStorageOptions {
  /**
   * Prefix for session refs in gitx.
   * Default: 'refs/sessions'
   */
  refPrefix?: string

  /**
   * Whether to auto-create the session namespace on first branch.
   * Default: true
   */
  autoCreate?: boolean
}

/**
 * GitxBranchStorage - BranchStorage implementation using gitx.
 *
 * This class implements the BranchStorage interface using gitx as the
 * underlying storage mechanism. Session branches are stored as Git refs
 * under a configurable prefix.
 *
 * Ref naming scheme:
 * ```
 * refs/sessions/<session-id>/branches/<branch-name>
 * refs/sessions/<session-id>/HEAD
 * refs/sessions/<session-id>/forks/<fork-name>
 * ```
 *
 * @example
 * ```typescript
 * import { GitxBranchStorage } from './gitx-branch-storage.js'
 *
 * // Create adapter (implementation-specific)
 * const gitxAdapter = createGitxAdapter(storage)
 *
 * // Create branch storage for a session
 * const branchStorage = new GitxBranchStorage('session-123', gitxAdapter)
 *
 * // Save a branch
 * await branchStorage.saveBranch({
 *   name: 'before-refactor',
 *   checkpointHash: 'abc123...',
 *   createdAt: Date.now(),
 *   metadata: { author: 'user' }
 * })
 *
 * // List branches
 * const branches = await branchStorage.listBranches()
 * ```
 */
export class GitxBranchStorage implements BranchStorage {
  private readonly refPrefix: string

  /**
   * Create a new GitxBranchStorage instance.
   *
   * @param sessionId - The session ID to manage branches for
   * @param gitx - The gitx adapter for Git operations
   * @param options - Optional configuration
   */
  constructor(
    private readonly sessionId: SessionId,
    private readonly gitx: GitxAdapter,
    options?: GitxBranchStorageOptions
  ) {
    this.refPrefix = options?.refPrefix ?? 'refs/sessions'
    // Note: autoCreate option reserved for future use
  }

  /**
   * Get the full ref path for a branch.
   * @param name - Branch name
   * @returns Full ref path (e.g., refs/sessions/session-123/branches/my-branch)
   */
  private getBranchRef(name: string): string {
    return `${this.refPrefix}/${this.sessionId}/branches/${name}`
  }

  /**
   * Get the HEAD ref path for the session.
   * @returns Full HEAD ref path
   */
  private getHeadRef(): string {
    return `${this.refPrefix}/${this.sessionId}/HEAD`
  }

  /**
   * Get the branch prefix for listing.
   * @returns Branch prefix path
   */
  private getBranchPrefix(): string {
    return `${this.refPrefix}/${this.sessionId}/branches/`
  }

  /**
   * Extract branch name from full ref path.
   * @param refPath - Full ref path
   * @returns Branch name without prefix
   */
  private extractBranchName(refPath: string): string {
    const prefix = this.getBranchPrefix()
    if (refPath.startsWith(prefix)) {
      return refPath.slice(prefix.length)
    }
    return refPath
  }

  /**
   * Serialize branch metadata for storage.
   * Reserved for future metadata persistence implementation.
   */
  // @ts-expect-error Reserved for future use
  private _serializeMetadata(branch: SessionBranch): string {
    return JSON.stringify({
      name: branch.name,
      checkpointHash: branch.checkpointHash,
      createdAt: branch.createdAt,
      updatedAt: branch.updatedAt,
      type: branch.type,
      sessionId: branch.sessionId,
      metadata: branch.metadata,
    })
  }

  /**
   * Deserialize branch metadata from storage.
   * Reserved for future metadata persistence implementation.
   */
  // @ts-expect-error Reserved for future use
  private _deserializeMetadata(data: string): Partial<SessionBranch> {
    try {
      return JSON.parse(data) as Partial<SessionBranch>
    } catch {
      return {}
    }
  }

  // ==========================================================================
  // BranchStorage Interface Implementation
  // ==========================================================================

  /**
   * Save a branch to gitx storage.
   *
   * Creates a Git ref pointing to the checkpoint hash, with branch
   * metadata stored in the commit message or associated ref.
   *
   * @param branch - The branch to save
   */
  async saveBranch(branch: SessionBranch): Promise<void> {
    const refPath = this.getBranchRef(branch.name)

    // In a full implementation, we would:
    // 1. Create a commit with the session state tree
    // 2. Set the branch ref to point to that commit
    // 3. Store metadata in commit message or separate ref

    // For now, we store the checkpoint hash as the ref target
    // Metadata storage in a parallel ref is reserved for future implementation
    await this.gitx.setRef(refPath, branch.checkpointHash)

    // TODO: Store metadata in a companion ref or blob
    // const metadataRef = `${refPath}__meta`
    // const metadataJson = this._serializeMetadata(branch)
    // await this.gitx.setRef(metadataRef, <blob-sha>)
  }

  /**
   * Get a branch by name.
   *
   * @param name - The branch name
   * @returns The branch, or null if not found
   */
  async getBranch(name: string): Promise<SessionBranch | null> {
    const refPath = this.getBranchRef(name)
    const sha = await this.gitx.resolveRef(refPath)

    if (!sha) {
      return null
    }

    // In a full implementation, we'd also fetch metadata
    // For now, construct a minimal SessionBranch
    return {
      name,
      checkpointHash: sha,
      type: 'branch',
      sessionId: this.sessionId,
      createdAt: Date.now(), // Would be from metadata
      updatedAt: Date.now(), // Would be from metadata
    }
  }

  /**
   * List all branches for this session.
   *
   * @returns Array of all branches
   */
  async listBranches(): Promise<SessionBranch[]> {
    const prefix = this.getBranchPrefix()
    const branchNames = await this.gitx.listBranches(prefix)

    const branches: SessionBranch[] = []

    for (const fullName of branchNames) {
      const name = this.extractBranchName(fullName)
      const sha = await this.gitx.resolveRef(fullName)

      if (sha) {
        branches.push({
          name,
          checkpointHash: sha,
          type: 'branch',
          sessionId: this.sessionId,
          createdAt: Date.now(), // Would be from metadata
          updatedAt: Date.now(), // Would be from metadata
        })
      }
    }

    return branches
  }

  /**
   * Delete a branch.
   *
   * @param name - The branch name to delete
   * @returns true if deleted, false if branch didn't exist
   */
  async deleteBranch(name: string): Promise<boolean> {
    const refPath = this.getBranchRef(name)
    return this.gitx.deleteBranch(refPath)
  }

  /**
   * Check if a branch exists.
   *
   * @param name - The branch name
   * @returns true if branch exists
   */
  async branchExists(name: string): Promise<boolean> {
    const refPath = this.getBranchRef(name)
    const sha = await this.gitx.resolveRef(refPath)
    return sha !== null
  }

  // ==========================================================================
  // Extended Git-like Operations
  // ==========================================================================

  /**
   * Create a branch from the current HEAD or specified source.
   *
   * @param name - Name for the new branch
   * @param from - Optional source branch to create from
   * @returns The created branch
   */
  async createBranch(name: string, from?: string): Promise<SessionBranch> {
    const refPath = this.getBranchRef(name)

    // Resolve the source SHA
    let sourceSha: string | null
    if (from) {
      const sourceRef = this.getBranchRef(from)
      sourceSha = await this.gitx.resolveRef(sourceRef)
      if (!sourceSha) {
        throw new Error(`Source branch not found: ${from}`)
      }
    } else {
      // Use HEAD
      sourceSha = await this.gitx.resolveRef(this.getHeadRef())
      if (!sourceSha) {
        throw new Error('No HEAD ref found - session may not be initialized')
      }
    }

    // Create the branch ref
    await this.gitx.setRef(refPath, sourceSha)

    const now = Date.now()
    return {
      name,
      checkpointHash: sourceSha,
      type: 'branch',
      sessionId: this.sessionId,
      createdAt: now,
      updatedAt: now,
    }
  }

  /**
   * Get the current HEAD branch.
   *
   * @returns The current branch, or null if HEAD is detached
   */
  async getCurrentBranch(): Promise<SessionBranch | null> {
    const headRef = this.getHeadRef()
    const sha = await this.gitx.resolveRef(headRef)

    if (!sha) {
      return null
    }

    // Find which branch points to this SHA
    const branches = await this.listBranches()
    const current = branches.find(b => b.checkpointHash === sha)

    return current || null
  }

  /**
   * Set the HEAD to point to a branch.
   *
   * @param name - Branch name to checkout
   */
  async checkout(name: string): Promise<void> {
    const branch = await this.getBranch(name)
    if (!branch) {
      throw new Error(`Branch not found: ${name}`)
    }

    await this.gitx.setRef(this.getHeadRef(), branch.checkpointHash)
  }

  /**
   * Update HEAD to point to a new checkpoint.
   *
   * @param checkpointHash - The checkpoint hash to set as HEAD
   */
  async updateHead(checkpointHash: string): Promise<void> {
    await this.gitx.setRef(this.getHeadRef(), checkpointHash)
  }

  /**
   * Get the current HEAD checkpoint hash.
   *
   * @returns The HEAD checkpoint hash, or null if not set
   */
  async getHead(): Promise<string | null> {
    return this.gitx.resolveRef(this.getHeadRef())
  }

  /**
   * Merge one branch into another.
   *
   * Note: This is a simplified merge that only works if there are no
   * conflicts. For session merging, this typically means fast-forward
   * merges where one branch is an ancestor of the other.
   *
   * @param from - Source branch to merge from
   * @param into - Target branch to merge into (default: current HEAD branch)
   * @returns Merge result
   */
  async merge(from: string, into?: string): Promise<{ success: boolean; conflicts?: string[] }> {
    const sourceRef = this.getBranchRef(from)
    const targetRef = into ? this.getBranchRef(into) : this.getHeadRef()

    const sourceSha = await this.gitx.resolveRef(sourceRef)
    const targetSha = await this.gitx.resolveRef(targetRef)

    if (!sourceSha) {
      return { success: false, conflicts: [`Source branch not found: ${from}`] }
    }

    if (!targetSha) {
      return { success: false, conflicts: [`Target branch not found: ${into || 'HEAD'}`] }
    }

    // Delegate to gitx merge (simplified - just updates the ref)
    // In a full implementation, this would involve three-way merge
    return this.gitx.merge(sourceRef, targetRef)
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a GitxBranchStorage instance for a session.
 *
 * @param sessionId - The session ID
 * @param gitx - The gitx adapter
 * @param options - Optional configuration
 * @returns A new GitxBranchStorage instance
 */
export function createGitxBranchStorage(
  sessionId: SessionId,
  gitx: GitxAdapter,
  options?: GitxBranchStorageOptions
): GitxBranchStorage {
  return new GitxBranchStorage(sessionId, gitx, options)
}

// ============================================================================
// Mock Adapter for Testing
// ============================================================================

/**
 * Create a mock GitxAdapter for testing.
 *
 * This in-memory implementation allows testing GitxBranchStorage
 * without a real gitx backend.
 *
 * @returns A mock GitxAdapter
 */
export function createMockGitxAdapter(): GitxAdapter & {
  _refs: Map<string, string>
  _branches: Set<string>
} {
  const refs = new Map<string, string>()
  const branches = new Set<string>()

  return {
    _refs: refs,
    _branches: branches,

    async init(_repoPath: string): Promise<void> {
      // No-op for mock
    },

    async createBranch(name: string, from?: string): Promise<void> {
      if (from) {
        const sourceSha = refs.get(from)
        if (sourceSha) {
          refs.set(name, sourceSha)
        }
      }
      branches.add(name)
    },

    async checkout(_branch: string): Promise<void> {
      // No-op for mock - HEAD tracking would go here
    },

    async commit(_message: string, _tree: unknown): Promise<string> {
      // Generate a fake SHA
      const sha = Array.from({ length: 40 }, () =>
        Math.floor(Math.random() * 16).toString(16)
      ).join('')
      return sha
    },

    async getBranch(name: string): Promise<{ sha: string; name: string } | null> {
      const sha = refs.get(name)
      if (!sha) return null
      return { sha, name }
    },

    async listBranches(prefix?: string): Promise<string[]> {
      const allRefs = Array.from(refs.keys())
      if (!prefix) return allRefs
      return allRefs.filter(ref => ref.startsWith(prefix))
    },

    async merge(_from: string, _into: string): Promise<{ success: boolean; conflicts?: string[] }> {
      // Simplified: always succeed
      return { success: true }
    },

    async deleteBranch(name: string): Promise<boolean> {
      const existed = refs.has(name)
      refs.delete(name)
      branches.delete(name)
      return existed
    },

    async resolveRef(ref: string): Promise<string | null> {
      return refs.get(ref) || null
    },

    async setRef(ref: string, sha: string): Promise<void> {
      refs.set(ref, sha)
    },
  }
}
