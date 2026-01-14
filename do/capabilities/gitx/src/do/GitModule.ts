/**
 * @fileoverview GitModule for Durable Object Integration
 *
 * This module provides a GitModule class that integrates with dotdo's $ WorkflowContext,
 * providing $.git.sync(), $.git.push(), and $.git.binding functionality.
 *
 * The module depends on FsModule for file operations and uses R2 as the
 * global git object store for cross-DO synchronization.
 *
 * @module do/GitModule
 *
 * @example
 * ```typescript
 * import { GitModule } from 'gitx.do/do'
 *
 * class MyDO extends DO {
 *   git = new GitModule(this.$, {
 *     repo: 'org/repo',
 *     branch: 'main',
 *     r2: this.env.R2_BUCKET
 *   })
 *
 *   async syncRepository() {
 *     await this.git.sync()
 *     const status = await this.git.status()
 *     console.log(`On branch ${status.branch}`)
 *   }
 * }
 * ```
 */

// ============================================================================
// Types and Interfaces
// ============================================================================

/**
 * Filesystem capability interface that GitModule depends on.
 * Mirrors the FsCapability from dotdo's WorkflowContext.
 */
export interface FsCapability {
  readFile(path: string): Promise<string | Buffer>
  writeFile(path: string, content: string | Buffer): Promise<void>
  readDir(path: string): Promise<string[]>
  exists(path: string): Promise<boolean>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>
  /**
   * Get the integer rowid (file_id) for a file path.
   * Used to establish foreign key references in git_content table.
   * @param path - File path to look up
   * @returns The file's integer rowid, or null if file doesn't exist
   */
  getFileId?(path: string): Promise<number | null>
}

/**
 * R2 Bucket interface for object storage operations.
 * Used as the global git object store.
 */
export interface R2BucketLike {
  get(key: string): Promise<R2ObjectLike | null>
  put(key: string, value: ArrayBuffer | Uint8Array | string): Promise<R2ObjectLike>
  delete(key: string | string[]): Promise<void>
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<R2ObjectsLike>
}

/**
 * R2 Object interface.
 */
export interface R2ObjectLike {
  key: string
  size: number
  arrayBuffer(): Promise<ArrayBuffer>
  text(): Promise<string>
}

/**
 * R2 Objects list result interface.
 */
export interface R2ObjectsLike {
  objects: R2ObjectLike[]
  truncated: boolean
  cursor?: string
}

/**
 * Database storage interface for GitModule persistence.
 * Provides access to the git, git_branches, and git_content tables.
 */
export interface GitStorage {
  /**
   * SQL execution interface.
   */
  sql: {
    /**
     * Execute a SQL query with optional parameters.
     * @param query - SQL query string (can use ? placeholders)
     * @param params - Parameter values for placeholders
     * @returns Result object with toArray() method for reading rows
     */
    exec(query: string, ...params: unknown[]): { toArray(): unknown[] }
  }
}

/**
 * Row structure for the git table.
 */
export interface GitRow {
  id: number
  repo: string
  path: string | null
  branch: string
  commit: string | null
  last_sync: number | null
  object_prefix: string
  created_at: number | null
  updated_at: number | null
}

/**
 * Row structure for the git_branches table.
 */
export interface GitBranchRow {
  id: number
  repo_id: number
  name: string
  head: string | null
  upstream: string | null
  tracking: number
  ahead: number
  behind: number
  created_at: number | null
  updated_at: number | null
}

/**
 * Row structure for the git_content table.
 * Uses file_id to reference the shared files table for efficient lookups.
 */
export interface GitContentRow {
  id: number
  repo_id: number
  file_id: number | null
  path: string
  content: Uint8Array | null
  mode: string
  status: string
  sha: string | null
  created_at: number | null
  updated_at: number | null
}

/**
 * Git binding configuration for the module.
 * Represents the connection between a DO and a git repository.
 */
export interface GitBinding {
  /**
   * Repository identifier (e.g., 'org/repo' or full URL)
   */
  repo: string

  /**
   * Optional path prefix within the repository
   */
  path?: string

  /**
   * Branch name to track
   * @default 'main'
   */
  branch: string

  /**
   * Current commit SHA that this DO is synced to
   */
  commit?: string

  /**
   * Last sync timestamp
   */
  lastSync?: Date
}

/**
 * Configuration options for GitModule.
 */
export interface GitModuleOptions {
  /**
   * Repository identifier (e.g., 'org/repo')
   */
  repo: string

  /**
   * Branch to track
   * @default 'main'
   */
  branch?: string

  /**
   * Optional path prefix within the repository
   */
  path?: string

  /**
   * R2 bucket for global object storage
   */
  r2?: R2BucketLike

  /**
   * Filesystem capability to use for file operations
   */
  fs?: FsCapability

  /**
   * Custom object key prefix in R2
   * @default 'git/objects'
   */
  objectPrefix?: string

  /**
   * Database storage for persistent state.
   * When provided, GitModule will persist state to the git, git_branches,
   * and git_content tables.
   */
  storage?: GitStorage
}

/**
 * Git status information.
 */
export interface GitStatus {
  /**
   * Current branch name
   */
  branch: string

  /**
   * Current HEAD commit SHA
   */
  head?: string

  /**
   * Files staged for commit
   */
  staged: string[]

  /**
   * Files with unstaged changes
   */
  unstaged: string[]

  /**
   * Untracked files
   */
  untracked?: string[]

  /**
   * Whether the working tree is clean
   */
  clean: boolean
}

/**
 * Result of a sync operation.
 */
export interface SyncResult {
  /**
   * Whether the sync succeeded
   */
  success: boolean

  /**
   * Number of objects fetched
   */
  objectsFetched: number

  /**
   * Number of files written
   */
  filesWritten: number

  /**
   * New HEAD commit after sync
   */
  commit?: string

  /**
   * Error message if sync failed
   */
  error?: string
}

/**
 * Result of a push operation.
 */
export interface PushResult {
  /**
   * Whether the push succeeded
   */
  success: boolean

  /**
   * Number of objects pushed
   */
  objectsPushed: number

  /**
   * New commit SHA after push
   */
  commit?: string

  /**
   * Error message if push failed
   */
  error?: string
}

// ============================================================================
// GitModule Class
// ============================================================================

/**
 * GitModule class for integration with dotdo's $ WorkflowContext.
 *
 * @description
 * Provides git functionality as a capability module that integrates with
 * dotdo's Durable Object framework. The module:
 *
 * - Syncs git objects from R2 global object store to local storage via FsModule
 * - Pushes local changes back to R2 for cross-DO synchronization
 * - Provides a binding property for repository configuration
 * - Implements standard git operations (status, add, commit)
 *
 * @example
 * ```typescript
 * // In a Durable Object
 * class MyDO extends DO {
 *   private git: GitModule
 *
 *   constructor(state: DurableObjectState, env: Env) {
 *     super(state, env)
 *     this.git = new GitModule({
 *       repo: 'my-org/my-repo',
 *       branch: 'main',
 *       r2: env.GIT_OBJECTS,
 *       fs: this.$.fs
 *     })
 *   }
 *
 *   async fetch(request: Request) {
 *     // Sync from R2
 *     await this.git.sync()
 *
 *     // Make changes via $.fs
 *     await this.$.fs.writeFile('/src/index.ts', 'new code')
 *
 *     // Stage and commit
 *     await this.git.add('src/index.ts')
 *     await this.git.commit('Update code')
 *
 *     // Push to R2
 *     await this.git.push()
 *
 *     return new Response('OK')
 *   }
 * }
 * ```
 */
export class GitModule {
  /**
   * Capability module name for identification.
   */
  readonly name = 'git' as const

  /**
   * Repository identifier.
   */
  private readonly repo: string

  /**
   * Branch being tracked.
   */
  private readonly branch: string

  /**
   * Path prefix within the repository.
   */
  private readonly path?: string

  /**
   * R2 bucket for global object storage.
   */
  private readonly r2?: R2BucketLike

  /**
   * Filesystem capability for file operations.
   */
  private readonly fs?: FsCapability

  /**
   * Object key prefix in R2.
   */
  private readonly objectPrefix: string

  /**
   * Database storage for persistence.
   */
  private readonly storage?: GitStorage

  /**
   * Database row ID for this repository binding.
   */
  private repoId?: number

  /**
   * Current HEAD commit SHA.
   */
  private currentCommit?: string

  /**
   * Timestamp of last sync operation.
   */
  private lastSyncTime?: Date

  /**
   * Staged files pending commit.
   */
  private stagedFiles: Set<string> = new Set()

  /**
   * Pending objects to push to R2.
   * Map of SHA to { type, data } for objects that have been committed locally
   * but not yet pushed to the R2 object store.
   */
  private pendingObjects: Map<string, { type: string; data: Uint8Array }> = new Map()

  /**
   * Create a new GitModule instance.
   *
   * @param options - Configuration options
   *
   * @example
   * ```typescript
   * const git = new GitModule({
   *   repo: 'org/repo',
   *   branch: 'main',
   *   r2: env.R2_BUCKET,
   *   fs: workflowContext.fs
   * })
   * ```
   */
  constructor(options: GitModuleOptions) {
    this.repo = options.repo
    this.branch = options.branch ?? 'main'
    this.path = options.path
    this.r2 = options.r2
    this.fs = options.fs
    this.objectPrefix = options.objectPrefix ?? 'git/objects'
    this.storage = options.storage
  }

  /**
   * Get the current git binding configuration.
   *
   * @description
   * Returns the binding information connecting this module to a git repository.
   * This includes the repository, branch, path, current commit, and last sync time.
   *
   * @returns Current git binding
   *
   * @example
   * ```typescript
   * const binding = git.binding
   * console.log(`Repo: ${binding.repo}`)
   * console.log(`Branch: ${binding.branch}`)
   * console.log(`Commit: ${binding.commit ?? 'not synced'}`)
   * ```
   */
  get binding(): GitBinding {
    return {
      repo: this.repo,
      branch: this.branch,
      path: this.path,
      commit: this.currentCommit,
      lastSync: this.lastSyncTime
    }
  }

  /**
   * Optional initialization hook.
   * Called when the module is first loaded.
   * When storage is provided, loads or creates the repository binding from the database.
   */
  async initialize(): Promise<void> {
    if (!this.storage) return

    // Try to load existing repository binding
    const existingRows = this.storage.sql.exec(
      'SELECT id, commit, last_sync FROM git WHERE repo = ?',
      this.repo
    ).toArray() as Pick<GitRow, 'id' | 'commit' | 'last_sync'>[]

    if (existingRows.length > 0) {
      // Load existing state
      const row = existingRows[0]
      this.repoId = row.id
      this.currentCommit = row.commit ?? undefined
      this.lastSyncTime = row.last_sync ? new Date(row.last_sync) : undefined

      // Load staged files from git_content table
      const stagedRows = this.storage.sql.exec(
        'SELECT path FROM git_content WHERE repo_id = ? AND status = ?',
        this.repoId,
        'staged'
      ).toArray() as Pick<GitContentRow, 'path'>[]

      for (const staged of stagedRows) {
        this.stagedFiles.add(staged.path)
      }
    } else {
      // Create new repository binding
      const now = Date.now()
      this.storage.sql.exec(
        `INSERT INTO git (repo, path, branch, object_prefix, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        this.repo,
        this.path ?? null,
        this.branch,
        this.objectPrefix,
        now,
        now
      )

      // Get the inserted row ID
      const insertedRows = this.storage.sql.exec(
        'SELECT id FROM git WHERE repo = ?',
        this.repo
      ).toArray() as Pick<GitRow, 'id'>[]

      if (insertedRows.length > 0) {
        this.repoId = insertedRows[0].id

        // Create the branch record
        this.storage.sql.exec(
          `INSERT INTO git_branches (repo_id, name, tracking, created_at, updated_at)
           VALUES (?, ?, 1, ?, ?)`,
          this.repoId,
          this.branch,
          now,
          now
        )
      }
    }
  }

  /**
   * Optional cleanup hook.
   * Called when the capability is unloaded.
   */
  async dispose(): Promise<void> {
    // Cleanup logic if needed
    this.stagedFiles.clear()
  }

  /**
   * Sync git objects from R2 to local storage via FsModule.
   *
   * @description
   * Fetches git objects from the R2 global object store and writes them
   * to the local filesystem via the FsModule. This syncs the DO's local
   * state with the shared repository state.
   *
   * @returns Result of the sync operation
   *
   * @example
   * ```typescript
   * const result = await git.sync()
   * if (result.success) {
   *   console.log(`Synced ${result.objectsFetched} objects`)
   *   console.log(`Now at commit ${result.commit}`)
   * } else {
   *   console.error(`Sync failed: ${result.error}`)
   * }
   * ```
   */
  async sync(): Promise<SyncResult> {
    if (!this.r2) {
      return {
        success: false,
        objectsFetched: 0,
        filesWritten: 0,
        error: 'R2 bucket not configured'
      }
    }

    if (!this.fs) {
      return {
        success: false,
        objectsFetched: 0,
        filesWritten: 0,
        error: 'Filesystem capability not available'
      }
    }

    try {
      // Get the ref for our branch
      const refKey = `${this.objectPrefix}/refs/heads/${this.branch}`
      const refObject = await this.r2.get(refKey)

      if (!refObject) {
        // No ref exists yet - this is a new/empty repository
        this.currentCommit = undefined
        this.lastSyncTime = new Date()

        // Persist sync state to database even for empty repos
        await this.persistSyncState()

        return {
          success: true,
          objectsFetched: 0,
          filesWritten: 0,
          commit: undefined
        }
      }

      const commitSha = await refObject.text()
      let objectsFetched = 0
      let filesWritten = 0

      // Fetch the commit object
      const commitObject = await this.fetchObject(commitSha)
      if (commitObject) {
        objectsFetched++

        // Parse commit to get tree SHA
        const commitContent = new TextDecoder().decode(commitObject)
        const treeMatch = commitContent.match(/^tree ([a-f0-9]{40})/m)

        if (treeMatch) {
          const treeSha = treeMatch[1]
          // Recursively sync tree contents
          const treeResult = await this.syncTree(treeSha, this.path ?? '')
          objectsFetched += treeResult.objects
          filesWritten += treeResult.files
        }
      }

      this.currentCommit = commitSha
      this.lastSyncTime = new Date()

      // Persist sync state to database
      await this.persistSyncState()

      return {
        success: true,
        objectsFetched,
        filesWritten,
        commit: commitSha
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return {
        success: false,
        objectsFetched: 0,
        filesWritten: 0,
        error: errorMessage
      }
    }
  }

  /**
   * Push local changes to R2 object store.
   *
   * @description
   * Writes local git objects to the R2 global object store for
   * cross-DO synchronization. This makes local changes available
   * to other DOs that sync from the same repository.
   *
   * @returns Result of the push operation
   *
   * @example
   * ```typescript
   * // Make changes and commit
   * await git.add('src/index.ts')
   * await git.commit('Update code')
   *
   * // Push to R2
   * const result = await git.push()
   * if (result.success) {
   *   console.log(`Pushed ${result.objectsPushed} objects`)
   * }
   * ```
   */
  async push(): Promise<PushResult> {
    if (!this.r2) {
      return {
        success: false,
        objectsPushed: 0,
        error: 'R2 bucket not configured'
      }
    }

    if (!this.currentCommit) {
      return {
        success: false,
        objectsPushed: 0,
        error: 'No commits to push'
      }
    }

    try {
      let objectsPushed = 0

      // Push all pending objects to R2
      for (const [sha, { data }] of this.pendingObjects) {
        await this.storeObject(sha, data)
        objectsPushed++
      }

      // Clear pending objects after successful push
      this.pendingObjects.clear()

      // Update the ref to point to our current commit
      const refKey = `${this.objectPrefix}/refs/heads/${this.branch}`
      await this.r2.put(refKey, this.currentCommit)

      return {
        success: true,
        objectsPushed,
        commit: this.currentCommit
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return {
        success: false,
        objectsPushed: 0,
        error: errorMessage
      }
    }
  }

  /**
   * Get the current repository status.
   *
   * @description
   * Returns information about the current branch, HEAD commit,
   * and staged/unstaged files.
   *
   * @returns Status object with branch and file information
   *
   * @example
   * ```typescript
   * const status = await git.status()
   * console.log(`On branch ${status.branch}`)
   * if (status.staged.length > 0) {
   *   console.log(`${status.staged.length} files staged`)
   * }
   * ```
   */
  async status(): Promise<GitStatus> {
    return {
      branch: this.branch,
      head: this.currentCommit,
      staged: Array.from(this.stagedFiles),
      unstaged: [], // Would need working tree comparison
      clean: this.stagedFiles.size === 0
    }
  }

  /**
   * Stage files for commit.
   *
   * @description
   * Adds files to the staging area for the next commit.
   *
   * @param files - File path or array of file paths to stage
   *
   * @example
   * ```typescript
   * await git.add('src/index.ts')
   * await git.add(['src/a.ts', 'src/b.ts'])
   * ```
   */
  async add(files: string | string[]): Promise<void> {
    const filesToAdd = Array.isArray(files) ? files : [files]
    for (const file of filesToAdd) {
      this.stagedFiles.add(file)
      // Persist staged file to database
      await this.persistStagedFile(file)
    }
  }

  /**
   * Create a new commit with staged changes.
   *
   * @description
   * Creates a commit object with the currently staged changes.
   * Returns the commit hash.
   *
   * @param message - Commit message
   * @returns Commit hash or object with hash
   *
   * @example
   * ```typescript
   * await git.add('src/index.ts')
   * const result = await git.commit('Update code')
   * console.log(`Created commit: ${result}`)
   * ```
   */
  async commit(message: string): Promise<string | { hash: string }> {
    if (this.stagedFiles.size === 0) {
      throw new Error('Nothing to commit - no files staged')
    }

    const encoder = new TextEncoder()

    // Create blob objects for each staged file
    const treeEntries: Array<{ mode: string; name: string; sha: string }> = []

    for (const filePath of this.stagedFiles) {
      // Read file content from filesystem if available
      let content: Uint8Array
      if (this.fs) {
        try {
          const fileContent = await this.fs.readFile(filePath)
          content = typeof fileContent === 'string'
            ? encoder.encode(fileContent)
            : new Uint8Array(fileContent)
        } catch {
          // File doesn't exist or can't be read, create empty blob
          content = new Uint8Array(0)
        }
      } else {
        // No filesystem, create placeholder content
        content = encoder.encode(`placeholder content for ${filePath}`)
      }

      // Create blob object
      const blobHeader = encoder.encode(`blob ${content.length}\0`)
      const blobData = new Uint8Array(blobHeader.length + content.length)
      blobData.set(blobHeader)
      blobData.set(content, blobHeader.length)
      const blobSha = await this.hashBytes(blobData)

      // Store blob content (without header) for push
      this.pendingObjects.set(blobSha, { type: 'blob', data: content })

      // Add to tree entries (use basename for tree entry name)
      const name = filePath.split('/').pop() || filePath
      treeEntries.push({ mode: '100644', name, sha: blobSha })
    }

    // Sort tree entries by name (git requirement)
    treeEntries.sort((a, b) => a.name.localeCompare(b.name))

    // Create tree object content
    const treeContent = this.buildTreeContent(treeEntries)
    const treeHeader = encoder.encode(`tree ${treeContent.length}\0`)
    const treeData = new Uint8Array(treeHeader.length + treeContent.length)
    treeData.set(treeHeader)
    treeData.set(treeContent, treeHeader.length)
    const treeSha = await this.hashBytes(treeData)

    // Store tree for push
    this.pendingObjects.set(treeSha, { type: 'tree', data: treeContent })

    // Create commit object
    const timestamp = Math.floor(Date.now() / 1000)
    const timezone = '+0000'
    const author = `GitModule <git@gitx.do> ${timestamp} ${timezone}`

    let commitContent = `tree ${treeSha}\n`
    if (this.currentCommit) {
      commitContent += `parent ${this.currentCommit}\n`
    }
    commitContent += `author ${author}\n`
    commitContent += `committer ${author}\n`
    commitContent += `\n${message}\n`

    const commitContentBytes = encoder.encode(commitContent)
    const commitHeader = encoder.encode(`commit ${commitContentBytes.length}\0`)
    const commitData = new Uint8Array(commitHeader.length + commitContentBytes.length)
    commitData.set(commitHeader)
    commitData.set(commitContentBytes, commitHeader.length)
    const commitSha = await this.hashBytes(commitData)

    // Store commit for push
    this.pendingObjects.set(commitSha, { type: 'commit', data: commitContentBytes })

    this.currentCommit = commitSha
    this.stagedFiles.clear()

    // Persist commit state to database and clear staged files
    await this.persistCommitState(commitSha)

    return { hash: commitSha }
  }

  /**
   * Build tree content from entries.
   * Format: mode name\0sha20bytes (repeated)
   */
  private buildTreeContent(entries: Array<{ mode: string; name: string; sha: string }>): Uint8Array {
    const encoder = new TextEncoder()
    const parts: Uint8Array[] = []

    for (const entry of entries) {
      const modeAndName = encoder.encode(`${entry.mode} ${entry.name}\0`)
      const sha20 = this.hexToBytes(entry.sha)
      const entryData = new Uint8Array(modeAndName.length + 20)
      entryData.set(modeAndName)
      entryData.set(sha20, modeAndName.length)
      parts.push(entryData)
    }

    // Combine all parts
    const totalLength = parts.reduce((sum, part) => sum + part.length, 0)
    const result = new Uint8Array(totalLength)
    let offset = 0
    for (const part of parts) {
      result.set(part, offset)
      offset += part.length
    }

    return result
  }

  /**
   * Convert hex string to bytes.
   */
  private hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2)
    for (let i = 0; i < hex.length; i += 2) {
      bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16)
    }
    return bytes
  }

  /**
   * Hash raw bytes using SHA-1.
   */
  private async hashBytes(data: Uint8Array): Promise<string> {
    // Create a copy as ArrayBuffer to satisfy BufferSource type
    const buffer = new ArrayBuffer(data.length)
    new Uint8Array(buffer).set(data)
    const hashBuffer = await crypto.subtle.digest('SHA-1', buffer)
    return this.bytesToHex(new Uint8Array(hashBuffer))
  }

  /**
   * Get diff between references or working tree.
   *
   * @param _ref - Reference to diff against (not yet implemented)
   * @returns Unified diff output
   */
  async diff(_ref?: string): Promise<string> {
    // Placeholder - would need full diff implementation
    return `diff --git a/ b/\n(diff not yet implemented)`
  }

  /**
   * Get commit history.
   *
   * @param _options - Options for filtering results (not yet implemented)
   * @returns Array of commit objects
   */
  async log(_options?: { limit?: number }): Promise<Array<{ hash: string; message: string }>> {
    // Placeholder - would need commit traversal
    if (this.currentCommit) {
      return [{ hash: this.currentCommit, message: 'Current commit' }]
    }
    return []
  }

  /**
   * Pull changes from R2 (alias for sync).
   *
   * @param _remote - Remote name (ignored, always uses R2)
   * @param _branch - Branch to pull (uses configured branch)
   */
  async pull(_remote?: string, _branch?: string): Promise<void> {
    const result = await this.sync()
    if (!result.success) {
      throw new Error(result.error ?? 'Pull failed')
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Private Helper Methods
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Fetch a git object from R2 by SHA.
   */
  private async fetchObject(sha: string): Promise<Uint8Array | null> {
    if (!this.r2) return null

    const key = `${this.objectPrefix}/${sha.slice(0, 2)}/${sha.slice(2)}`
    const object = await this.r2.get(key)

    if (!object) return null

    const buffer = await object.arrayBuffer()
    return new Uint8Array(buffer)
  }

  /**
   * Store a git object in R2.
   */
  private async storeObject(sha: string, data: Uint8Array): Promise<void> {
    if (!this.r2) return

    const key = `${this.objectPrefix}/${sha.slice(0, 2)}/${sha.slice(2)}`
    await this.r2.put(key, data)
  }

  /**
   * Recursively sync a tree and its contents.
   */
  private async syncTree(treeSha: string, basePath: string): Promise<{ objects: number; files: number }> {
    let objects = 0
    let files = 0

    const treeData = await this.fetchObject(treeSha)
    if (!treeData) return { objects, files }

    objects++

    // Parse tree entries
    // Tree format: mode name\0sha20bytes (repeated)
    let offset = 0
    const decoder = new TextDecoder()

    while (offset < treeData.length) {
      // Find the null byte
      let nullIdx = offset
      while (nullIdx < treeData.length && treeData[nullIdx] !== 0) {
        nullIdx++
      }

      const modeAndName = decoder.decode(treeData.slice(offset, nullIdx))
      const spaceIdx = modeAndName.indexOf(' ')
      const mode = modeAndName.slice(0, spaceIdx)
      const name = modeAndName.slice(spaceIdx + 1)

      // Read 20-byte SHA
      const sha20 = treeData.slice(nullIdx + 1, nullIdx + 21)
      const sha = this.bytesToHex(sha20)

      const entryPath = basePath ? `${basePath}/${name}` : name

      if (mode === '40000' || mode === '040000') {
        // Directory - recurse
        const subResult = await this.syncTree(sha, entryPath)
        objects += subResult.objects
        files += subResult.files
      } else {
        // File - fetch blob and write via fs
        const blobData = await this.fetchObject(sha)
        if (blobData && this.fs) {
          objects++
          // Ensure parent directory exists
          const parentDir = entryPath.split('/').slice(0, -1).join('/')
          if (parentDir) {
            await this.fs.mkdir(`/${parentDir}`, { recursive: true })
          }
          // Write file content (skip git header if present)
          await this.fs.writeFile(`/${entryPath}`, Buffer.from(blobData))
          files++
        }
      }

      offset = nullIdx + 21
    }

    return { objects, files }
  }

  /**
   * Convert bytes to hex string.
   */
  private bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  }

  /**
   * Persist sync state to the database.
   * Updates the git table with the current commit and last sync timestamp.
   */
  private async persistSyncState(): Promise<void> {
    if (!this.storage || !this.repoId) return

    const now = Date.now()
    this.storage.sql.exec(
      `UPDATE git SET commit = ?, last_sync = ?, updated_at = ? WHERE id = ?`,
      this.currentCommit ?? null,
      now,
      now,
      this.repoId
    )
  }

  /**
   * Persist a staged file to the database.
   * Inserts or updates a record in the git_content table.
   * Uses file_id foreign key to reference the shared files table when available.
   */
  private async persistStagedFile(file: string): Promise<void> {
    if (!this.storage || !this.repoId) return

    const now = Date.now()

    // Get file_id from filesystem if getFileId is available
    let fileId: number | null = null
    if (this.fs?.getFileId) {
      try {
        fileId = await this.fs.getFileId(file)
      } catch {
        // File may not exist in filesystem yet, that's okay
        fileId = null
      }
    }

    // Use INSERT OR REPLACE to handle both new and existing files
    // Include file_id for efficient foreign key relationships
    this.storage.sql.exec(
      `INSERT INTO git_content (repo_id, file_id, path, status, created_at, updated_at)
       VALUES (?, ?, ?, 'staged', ?, ?)
       ON CONFLICT(repo_id, path) DO UPDATE SET status = 'staged', file_id = ?, updated_at = ?`,
      this.repoId,
      fileId,
      file,
      now,
      now,
      fileId,
      now
    )
  }

  /**
   * Persist commit state to the database.
   * Updates the git table with the new commit hash and clears staged files.
   */
  private async persistCommitState(hash: string): Promise<void> {
    if (!this.storage || !this.repoId) return

    const now = Date.now()

    // Update the commit hash in the git table
    this.storage.sql.exec(
      `UPDATE git SET commit = ?, updated_at = ? WHERE id = ?`,
      hash,
      now,
      this.repoId
    )

    // Update branch head
    this.storage.sql.exec(
      `UPDATE git_branches SET head = ?, updated_at = ? WHERE repo_id = ? AND name = ?`,
      hash,
      now,
      this.repoId,
      this.branch
    )

    // Clear staged files from git_content
    this.storage.sql.exec(
      `DELETE FROM git_content WHERE repo_id = ? AND status = 'staged'`,
      this.repoId
    )
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a GitModule instance with the given options.
 *
 * @param options - Configuration options for the module
 * @returns A new GitModule instance
 *
 * @example
 * ```typescript
 * import { createGitModule } from 'gitx.do/do'
 *
 * const git = createGitModule({
 *   repo: 'org/repo',
 *   branch: 'main',
 *   r2: env.R2_BUCKET,
 *   fs: workflowContext.fs
 * })
 * ```
 */
export function createGitModule(options: GitModuleOptions): GitModule {
  return new GitModule(options)
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Check if a value is a GitModule instance.
 *
 * @param value - Value to check
 * @returns True if value is a GitModule
 */
export function isGitModule(value: unknown): value is GitModule {
  return value instanceof GitModule
}
