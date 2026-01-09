/**
 * withGit Mixin - Git Version Control Capability
 *
 * Adds $.git to the WorkflowContext with git operations:
 * - configure: Set repo, branch, R2 configuration
 * - status, add, commit, push, sync
 * - binding: Get current git binding configuration
 *
 * Integrates with gitx GitModule for actual git operations.
 * Requires: withFs (depends on filesystem access for CAS integration)
 *
 * @example
 * ```typescript
 * class MyDO extends withGit(withFs(DO)) {
 *   async init() {
 *     this.$.git.configure({
 *       repo: 'org/repo',
 *       branch: 'main',
 *       r2: this.env.R2_BUCKET
 *     })
 *   }
 *
 *   async commitChanges() {
 *     await this.$.git.add('/src/index.ts')
 *     await this.$.git.commit('feat: add feature')
 *     await this.$.git.push()
 *   }
 * }
 * ```
 */

import type { WorkflowContext } from '../../types/WorkflowContext'
import type { DO, Env } from '../../objects/DO'
import type { FsCapability, WithFsContext } from './fs'

// ============================================================================
// R2 BUCKET TYPE (from Cloudflare Workers types)
// ============================================================================

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

// ============================================================================
// CAPABILITY TYPES
// ============================================================================

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

/**
 * Commit result.
 */
export interface GitCommitResult {
  /**
   * Commit hash
   */
  hash: string
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
}

/**
 * FsCapability adapter interface for GitModule.
 * Converts dotdo FsCapability to gitx FsCapability format.
 */
interface GitFsCapability {
  readFile(path: string): Promise<string | Buffer>
  writeFile(path: string, content: string | Buffer): Promise<void>
  readDir(path: string): Promise<string[]>
  exists(path: string): Promise<boolean>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>
}

// ============================================================================
// GITMODULE CLASS
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
 * const git = new GitModule({
 *   repo: 'org/repo',
 *   branch: 'main',
 *   r2: env.R2_BUCKET,
 *   fs: workflowContext.fs
 * })
 *
 * await git.add('src/index.ts')
 * await git.commit('Update code')
 * await git.push()
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
  private repo: string = ''

  /**
   * Branch being tracked.
   */
  private branch: string = 'main'

  /**
   * Path prefix within the repository.
   */
  private path?: string

  /**
   * R2 bucket for global object storage.
   */
  private r2?: R2BucketLike

  /**
   * Filesystem capability for file operations.
   */
  private fs?: FsCapability | GitFsCapability

  /**
   * Object key prefix in R2.
   */
  private objectPrefix: string = 'git/objects'

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
   * @param options - Configuration options (optional for deferred configuration)
   */
  constructor(options?: GitModuleOptions) {
    if (options) {
      this.repo = options.repo
      this.branch = options.branch ?? 'main'
      this.path = options.path
      this.r2 = options.r2
      this.fs = options.fs
      this.objectPrefix = options.objectPrefix ?? 'git/objects'
    }
  }

  /**
   * Configure the GitModule with repository settings.
   *
   * @param options - Configuration options
   *
   * @example
   * ```typescript
   * git.configure({
   *   repo: 'org/repo',
   *   branch: 'main',
   *   r2: env.R2_BUCKET
   * })
   * ```
   */
  configure(options: GitModuleOptions): void {
    this.repo = options.repo
    this.branch = options.branch ?? 'main'
    this.path = options.path
    this.r2 = options.r2
    if (options.fs) {
      this.fs = options.fs
    }
    this.objectPrefix = options.objectPrefix ?? 'git/objects'
  }

  /**
   * Get the current git binding configuration.
   *
   * @returns Current git binding
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
   * Get the current repository status.
   *
   * @returns Status object with branch and file information
   */
  async status(): Promise<GitStatus> {
    return {
      branch: this.branch,
      head: this.currentCommit,
      staged: Array.from(this.stagedFiles),
      unstaged: [],
      clean: this.stagedFiles.size === 0
    }
  }

  /**
   * Stage files for commit.
   *
   * @param files - File path or array of file paths to stage
   */
  async add(files: string | string[]): Promise<void> {
    const filesToAdd = Array.isArray(files) ? files : [files]
    for (const file of filesToAdd) {
      this.stagedFiles.add(file)
    }
  }

  /**
   * Create a new commit with staged changes.
   *
   * @param message - Commit message
   * @returns Commit result with hash
   */
  async commit(message: string): Promise<GitCommitResult> {
    if (this.stagedFiles.size === 0) {
      throw new Error('Nothing to commit - no files staged')
    }

    const encoder = new TextEncoder()

    // Create blob objects for each staged file
    const treeEntries: Array<{ mode: string; name: string; sha: string }> = []

    for (const filePath of Array.from(this.stagedFiles)) {
      // Read file content from filesystem if available
      let content: Uint8Array
      if (this.fs) {
        try {
          const fileContent = await this.readFile(filePath)
          content = typeof fileContent === 'string'
            ? encoder.encode(fileContent)
            : new Uint8Array(fileContent as ArrayBuffer)
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
    const author = `GitModule <git@dotdo.dev> ${timestamp} ${timezone}`

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

    return { hash: commitSha }
  }

  /**
   * Sync git objects from R2 to local storage.
   *
   * @returns Result of the sync operation
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
   * @returns Result of the push operation
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
      for (const [sha, { data }] of Array.from(this.pendingObjects)) {
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

  // ═══════════════════════════════════════════════════════════════════════════
  // Private Helper Methods
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Read a file through the filesystem capability.
   */
  private async readFile(path: string): Promise<string | ArrayBuffer> {
    if (!this.fs) {
      throw new Error('Filesystem capability not available')
    }

    // Check if it's dotdo FsCapability (has read) or gitx FsCapability (has readFile)
    if ('read' in this.fs && typeof (this.fs as FsCapability).read === 'function') {
      return (this.fs as FsCapability).read(path)
    } else if ('readFile' in this.fs && typeof (this.fs as GitFsCapability).readFile === 'function') {
      const result = await (this.fs as GitFsCapability).readFile(path)
      // Convert Buffer to string if needed
      if (typeof result === 'string') {
        return result
      }
      // Handle Node.js Buffer type by converting to string
      if (result && typeof (result as { toString?: () => string }).toString === 'function') {
        return (result as { toString: () => string }).toString()
      }
      return result as unknown as ArrayBuffer
    }

    throw new Error('Invalid filesystem capability - missing read/readFile method')
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
    const hashBuffer = await crypto.subtle.digest('SHA-1', data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
    return this.bytesToHex(new Uint8Array(hashBuffer))
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
            await this.mkdir(`/${parentDir}`, { recursive: true })
          }
          // Write file content
          await this.writeFile(`/${entryPath}`, new TextDecoder().decode(blobData))
          files++
        }
      }

      offset = nullIdx + 21
    }

    return { objects, files }
  }

  /**
   * Create directory through filesystem capability.
   */
  private async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (!this.fs) return

    if ('mkdir' in this.fs && typeof this.fs.mkdir === 'function') {
      await this.fs.mkdir(path, options)
    }
  }

  /**
   * Write file through filesystem capability.
   */
  private async writeFile(path: string, content: string): Promise<void> {
    if (!this.fs) return

    // Check if it's dotdo FsCapability (has write) or gitx FsCapability (has writeFile)
    if ('write' in this.fs && typeof (this.fs as FsCapability).write === 'function') {
      await (this.fs as FsCapability).write(path, content)
    } else if ('writeFile' in this.fs && typeof (this.fs as GitFsCapability).writeFile === 'function') {
      await (this.fs as GitFsCapability).writeFile(path, content)
    }
  }
}

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a GitModule instance with the given options.
 *
 * @param options - Configuration options for the module
 * @returns A new GitModule instance
 */
export function createGitModule(options: GitModuleOptions): GitModule {
  return new GitModule(options)
}

// ============================================================================
// EXTENDED CONTEXT TYPES
// ============================================================================

/**
 * GitCapability interface for $.git
 * Extends GitModule with configure() for mixin integration
 */
export interface GitCapability extends GitModule {
  configure(options: GitModuleOptions): void
  binding: GitBinding
  status(): Promise<GitStatus>
  add(files: string | string[]): Promise<void>
  commit(message: string): Promise<GitCommitResult>
  sync(): Promise<SyncResult>
  push(): Promise<PushResult>
}

export interface WithGitContext extends WithFsContext {
  git: GitCapability
}

// ============================================================================
// MIXIN TYPE
// ============================================================================

// Note: TypeScript requires any[] for mixin constructor patterns (TS2545)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Constructor<T = {}> = new (...args: any[]) => T

// Type that requires $.fs to exist on the base class
type DOWithFsConstructor<E extends Env = Env> = Constructor<DO<E> & { $: WithFsContext }> & typeof DO<E>

export interface WithGitDO<E extends Env = Env> extends DO<E> {
  $: WithGitContext
}

// ============================================================================
// MIXIN IMPLEMENTATION
// ============================================================================

// Symbol for caching the git capability instance
const GIT_CAPABILITY_CACHE = Symbol('gitCapabilityCache')

/**
 * Adds git capability to a DO class that already has filesystem capability
 *
 * @example
 * ```typescript
 * class MyDO extends withGit(withFs(DO)) {
 *   async init() {
 *     this.$.git.configure({
 *       repo: 'org/repo',
 *       branch: 'main',
 *       r2: this.env.R2_BUCKET
 *     })
 *   }
 *
 *   async commitChanges() {
 *     await this.$.git.add('.')
 *     await this.$.git.commit('feat: add feature')
 *     await this.$.git.push()
 *   }
 * }
 * ```
 */
export function withGit<TBase extends Constructor<{ $: WithFsContext }>>(Base: TBase) {
  return class WithGit extends Base {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    static capabilities = [...((Base as any).capabilities || []), 'git']

    /**
     * Check if this DO class has a specific capability
     */
    hasCapability(name: string): boolean {
      if (name === 'git') return true
      // Check if parent class has the hasCapability method (WithFs class)
      const baseProto = Base.prototype
      if (baseProto && typeof baseProto.hasCapability === 'function') {
        return baseProto.hasCapability.call(this, name)
      }
      return false
    }

    // Cache for the git capability instance
    private [GIT_CAPABILITY_CACHE]?: GitModule

    /**
     * Lazy-loaded git capability (GitModule instance)
     */
    private get gitCapability(): GitModule {
      if (!this[GIT_CAPABILITY_CACHE]) {
        // Create GitModule with access to $.fs for CAS integration
        const module = new GitModule()

        // Inject $.fs if available on the context
        const context = this.$ as WithFsContext
        if (context.fs) {
          // Will be set when configure() is called
        }

        this[GIT_CAPABILITY_CACHE] = module
      }
      return this[GIT_CAPABILITY_CACHE]
    }

    // TypeScript requires any[] for mixin constructors (TS2545)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args)

      // Extend $ to include git capability (preserving fs from parent)
      const originalContext = this.$
      const self = this

      // Create a new proxy that extends the original $ with git
      this.$ = new Proxy(originalContext as WithGitContext, {
        get(target, prop: string | symbol) {
          if (prop === 'git') {
            // Lazy initialize GitModule
            const gitModule = self.gitCapability

            // Ensure fs is available on the git module
            // Override configure to auto-inject fs
            const originalConfigure = gitModule.configure.bind(gitModule)
            gitModule.configure = (options: GitModuleOptions) => {
              // Auto-inject $.fs if not provided
              if (!options.fs && target.fs) {
                options = { ...options, fs: target.fs }
              }
              originalConfigure(options)
            }

            return gitModule
          }
          // Forward to original context (which includes fs)
          const value = (target as any)[prop]
          if (typeof value === 'function') {
            return value.bind(target)
          }
          return value
        },
      })
    }
  }
}
