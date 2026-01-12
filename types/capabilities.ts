/**
 * Capability Module Type Definitions
 *
 * This module defines TypeScript interfaces for the capability system that provides
 * lazy-loaded, tree-shakeable access to filesystem, git, and shell operations
 * through the WorkflowContext ($) proxy.
 *
 * @module types/capabilities
 */

// ============================================================================
// CAPABILITY MODULE BASE INTERFACE
// ============================================================================

/**
 * Base interface for all capability modules.
 *
 * Capability modules are lazy-loaded and cached on first access.
 * They provide domain-specific functionality to workflows.
 *
 * @example
 * ```typescript
 * class MyCapability implements CapabilityModule {
 *   readonly name = 'my-capability'
 *
 *   async initialize(): Promise<void> {
 *     // Setup code
 *   }
 *
 *   async dispose(): Promise<void> {
 *     // Cleanup code
 *   }
 * }
 * ```
 */
export interface CapabilityModule {
  /**
   * Unique identifier for this capability module
   */
  readonly name: string

  /**
   * Optional initialization hook called when the module is first loaded.
   * Use for async setup operations.
   */
  initialize?(): Promise<void>

  /**
   * Optional cleanup hook called when the capability is unloaded.
   * Use for releasing resources, closing connections, etc.
   */
  dispose?(): Promise<void>
}

// ============================================================================
// FILESYSTEM CAPABILITY
// ============================================================================

/**
 * Options for directory creation operations.
 */
export interface MkdirOptions {
  /**
   * If true, creates parent directories as needed (like mkdir -p).
   * @default false
   */
  recursive?: boolean
}

/**
 * Options for file/directory removal operations.
 */
export interface RmOptions {
  /**
   * If true, removes directories and their contents recursively.
   * @default false
   */
  recursive?: boolean

  /**
   * If true, ignores errors if path doesn't exist.
   * @default false
   */
  force?: boolean
}

/**
 * File statistics returned by stat operations.
 */
export interface FileStats {
  /**
   * True if the path points to a file.
   */
  isFile: boolean

  /**
   * True if the path points to a directory.
   */
  isDirectory: boolean

  /**
   * Size of the file in bytes.
   */
  size: number

  /**
   * Last modification time.
   */
  mtime: Date

  /**
   * Creation time.
   */
  ctime: Date

  /**
   * Last access time.
   */
  atime: Date
}

/**
 * Options for file read operations.
 */
export interface FsReadOptions {
  encoding?: 'utf8' | 'base64' | 'binary'
}

/**
 * Options for file write operations.
 */
export interface FsWriteOptions {
  encoding?: 'utf8' | 'base64' | 'binary'
}

/**
 * Directory entry returned by list operations.
 */
export interface FsEntry {
  name: string
  isDirectory: boolean
}

/**
 * Options for directory listing operations.
 */
export interface FsListOptions {
  filter?: (entry: FsEntry) => boolean
}

/**
 * Filesystem capability interface for workflows that need file access.
 *
 * Provides a unified API for file operations that can be backed by
 * different implementations (DurableObjectStorage, fsx.do, etc.).
 *
 * All paths should be absolute (starting with `/`). Paths are automatically
 * normalized to handle trailing slashes and ensure consistency.
 *
 * @example
 * ```typescript
 * const processConfig = async ($: WorkflowContext) => {
 *   if (!hasFs($)) {
 *     throw new CapabilityError('fs', 'not_available', 'Filesystem required')
 *   }
 *
 *   const config = await $.fs.read('/config.json')
 *   const parsed = JSON.parse(config)
 *   return parsed
 * }
 * ```
 */
export interface FsCapability extends CapabilityModule {
  readonly name: 'fs'

  /**
   * Read file content as a string.
   *
   * @param path - Absolute path to the file
   * @param options - Read options (encoding)
   * @returns File content as string
   * @throws Error if file doesn't exist or cannot be read
   *
   * @example
   * ```typescript
   * const content = await $.fs.read('/app/config.json')
   * ```
   */
  read(path: string, options?: FsReadOptions): Promise<string>

  /**
   * Write content to a file, creating it if it doesn't exist.
   *
   * Parent directories are NOT automatically created. Use `mkdir` with
   * `recursive: true` first if needed.
   *
   * @param path - Absolute path to the file
   * @param content - String content to write
   * @param options - Write options (encoding)
   *
   * @example
   * ```typescript
   * await $.fs.write('/app/output.txt', 'Hello, World!')
   * ```
   */
  write(path: string, content: string, options?: FsWriteOptions): Promise<void>

  /**
   * List entries in a directory.
   *
   * @param path - Absolute path to directory
   * @param options - List options (filter function)
   * @returns Array of directory entries with name and isDirectory flag
   *
   * @example
   * ```typescript
   * const entries = await $.fs.list('/app/src')
   * const files = entries.filter(e => !e.isDirectory)
   * ```
   */
  list(path: string, options?: FsListOptions): Promise<FsEntry[]>

  /**
   * Check if a file or directory exists at the given path.
   *
   * @param path - Path to check
   * @returns True if path exists, false otherwise
   *
   * @example
   * ```typescript
   * if (await $.fs.exists('/app/config.json')) {
   *   // Load config
   * }
   * ```
   */
  exists(path: string): Promise<boolean>

  /**
   * Delete a file or empty directory.
   *
   * @param path - Absolute path to delete
   * @throws Error if path doesn't exist
   *
   * @example
   * ```typescript
   * await $.fs.delete('/app/temp/cache.json')
   * ```
   */
  delete(path: string): Promise<void>

  /**
   * Create a directory at the given path.
   *
   * @param path - Path where directory should be created
   * @param options - Options for directory creation
   * @throws Error if parent doesn't exist (unless recursive: true)
   *
   * @example
   * ```typescript
   * await $.fs.mkdir('/app/data/cache', { recursive: true })
   * ```
   */
  mkdir(path: string, options?: MkdirOptions): Promise<void>

  /**
   * Get file or directory metadata.
   *
   * @param path - Absolute path to stat
   * @returns File statistics object
   * @throws Error if path doesn't exist
   *
   * @example
   * ```typescript
   * const stats = await $.fs.stat('/app/data.json')
   * if (stats.isFile && stats.size > 0) {
   *   // Process file
   * }
   * ```
   */
  stat(path: string): Promise<FileStats>

  /**
   * Copy a file to a new location.
   *
   * @param src - Source file path
   * @param dest - Destination file path
   * @throws Error if source doesn't exist
   *
   * @example
   * ```typescript
   * await $.fs.copy('/app/config.json', '/backup/config.json')
   * ```
   */
  copy(src: string, dest: string): Promise<void>

  /**
   * Move a file to a new location.
   *
   * This is an atomic operation: the source is deleted only after
   * the destination is successfully written.
   *
   * @param src - Source file path
   * @param dest - Destination file path
   * @throws Error if source doesn't exist
   *
   * @example
   * ```typescript
   * await $.fs.move('/tmp/upload.json', '/data/file.json')
   * ```
   */
  move(src: string, dest: string): Promise<void>
}

// ============================================================================
// GIT CAPABILITY
// ============================================================================

/**
 * Git repository status information.
 */
export interface GitStatus {
  /**
   * Current branch name.
   */
  branch: string

  /**
   * Files that have been staged for commit.
   */
  staged: string[]

  /**
   * Files with unstaged changes.
   */
  unstaged: string[]

  /**
   * Untracked files not yet added to git.
   */
  untracked?: string[]

  /**
   * True if HEAD is detached (not on a branch).
   */
  detached?: boolean
}

/**
 * A single commit in the git log.
 */
export interface GitCommit {
  /**
   * Full commit hash (SHA-1).
   */
  hash: string

  /**
   * Short commit hash (typically 7 characters).
   */
  shortHash?: string

  /**
   * Commit message (first line).
   */
  message: string

  /**
   * Full commit message including body.
   */
  body?: string

  /**
   * Commit author name.
   */
  author?: string

  /**
   * Commit author email.
   */
  email?: string

  /**
   * Commit timestamp.
   */
  date?: Date
}

/**
 * Options for git log operations.
 */
export interface GitLogOptions {
  /**
   * Maximum number of commits to return.
   * @default 10
   */
  limit?: number

  /**
   * Starting reference (branch, tag, or commit hash).
   */
  from?: string

  /**
   * Ending reference for range queries.
   */
  to?: string

  /**
   * Only include commits that modified this path.
   */
  path?: string
}

/**
 * Options for git clone operations.
 */
export interface GitCloneOptions {
  /**
   * Perform a shallow clone with limited history.
   */
  depth?: number

  /**
   * Clone only a specific branch.
   */
  branch?: string

  /**
   * Create a bare repository.
   */
  bare?: boolean
}

/**
 * Git capability interface for workflows that need version control.
 *
 * Provides git operations for managing repositories, commits, and branches.
 *
 * @example
 * ```typescript
 * const commitChanges = async ($: WorkflowContext) => {
 *   if (!hasGit($)) {
 *     throw new CapabilityError('git', 'not_available', 'Git required')
 *   }
 *
 *   const status = await $.git.status()
 *   if (status.unstaged.length > 0) {
 *     await $.git.add(status.unstaged)
 *     await $.git.commit('Auto-commit changes')
 *   }
 * }
 * ```
 */
export interface GitCapability extends CapabilityModule {
  readonly name: 'git'

  /**
   * Get the current repository status.
   *
   * @returns Status object with branch and file information
   *
   * @example
   * ```typescript
   * const status = await $.git.status()
   * console.log(`On branch ${status.branch}`)
   * console.log(`${status.staged.length} files staged`)
   * ```
   */
  status(): Promise<GitStatus>

  /**
   * Stage files for commit.
   *
   * @param files - File path or array of file paths to stage
   *
   * @example
   * ```typescript
   * await $.git.add('src/index.ts')
   * await $.git.add(['src/a.ts', 'src/b.ts'])
   * await $.git.add('.') // Stage all changes
   * ```
   */
  add(files: string | string[]): Promise<void>

  /**
   * Create a new commit with staged changes.
   *
   * @param message - Commit message
   * @returns Commit hash or commit info object
   *
   * @example
   * ```typescript
   * const hash = await $.git.commit('feat: add new feature')
   * ```
   */
  commit(message: string): Promise<string | { hash: string }>

  /**
   * Push commits to a remote repository.
   *
   * @param remote - Remote name (default: 'origin')
   * @param branch - Branch to push (default: current branch)
   *
   * @example
   * ```typescript
   * await $.git.push()
   * await $.git.push('origin', 'main')
   * ```
   */
  push(remote?: string, branch?: string): Promise<void>

  /**
   * Pull changes from a remote repository.
   *
   * @param remote - Remote name (default: 'origin')
   * @param branch - Branch to pull (default: current branch)
   *
   * @example
   * ```typescript
   * await $.git.pull()
   * await $.git.pull('upstream', 'main')
   * ```
   */
  pull(remote?: string, branch?: string): Promise<void>

  /**
   * Get commit history.
   *
   * @param options - Options for filtering and limiting results
   * @returns Array of commit objects
   *
   * @example
   * ```typescript
   * const commits = await $.git.log({ limit: 5 })
   * for (const commit of commits) {
   *   console.log(`${commit.hash.slice(0, 7)} ${commit.message}`)
   * }
   * ```
   */
  log(options?: GitLogOptions): Promise<GitCommit[]>

  /**
   * Get diff between references or working tree.
   *
   * @param ref - Reference to diff against (branch, tag, commit, or empty for working tree)
   * @returns Unified diff output
   *
   * @example
   * ```typescript
   * const diff = await $.git.diff('HEAD~1')
   * const workingDiff = await $.git.diff()
   * ```
   */
  diff(ref?: string): Promise<string>

  /**
   * Clone a repository.
   *
   * @param url - Repository URL to clone
   * @param dest - Destination directory
   * @param options - Clone options
   *
   * @example
   * ```typescript
   * await $.git.clone('https://github.com/user/repo.git', './repo')
   * await $.git.clone('git@github.com:user/repo.git', './repo', { depth: 1 })
   * ```
   */
  clone?(url: string, dest: string, options?: GitCloneOptions): Promise<void>

  /**
   * Checkout a branch, tag, or commit.
   *
   * @param ref - Branch name, tag, or commit hash
   * @param options - Checkout options
   *
   * @example
   * ```typescript
   * await $.git.checkout('feature-branch')
   * await $.git.checkout('v1.0.0')
   * ```
   */
  checkout?(ref: string, options?: { create?: boolean }): Promise<void>

  /**
   * Create a new branch.
   *
   * @param name - Branch name
   * @param startPoint - Starting reference (default: HEAD)
   *
   * @example
   * ```typescript
   * await $.git.branch('feature/new-feature')
   * await $.git.branch('hotfix/fix-bug', 'v1.0.0')
   * ```
   */
  branch?(name: string, startPoint?: string): Promise<void>

  /**
   * Merge a branch into the current branch.
   *
   * @param branch - Branch to merge
   * @param options - Merge options
   *
   * @example
   * ```typescript
   * await $.git.merge('feature-branch')
   * ```
   */
  merge?(branch: string, options?: { noFf?: boolean; squash?: boolean }): Promise<void>

  /**
   * Fetch changes from remote without merging.
   *
   * @param remote - Remote name (default: 'origin')
   * @param branch - Specific branch to fetch
   *
   * @example
   * ```typescript
   * await $.git.fetch()
   * await $.git.fetch('upstream', 'main')
   * ```
   */
  fetch?(remote?: string, branch?: string): Promise<void>
}

// ============================================================================
// BASH CAPABILITY
// ============================================================================

/**
 * Result of executing a bash command.
 */
export interface ExecResult {
  /**
   * Standard output from the command.
   */
  stdout: string

  /**
   * Standard error output from the command.
   */
  stderr: string

  /**
   * Exit code of the command (0 typically means success).
   */
  exitCode: number
}

/**
 * Options for bash command execution.
 */
export interface ExecOptions {
  /**
   * Working directory for the command.
   */
  cwd?: string

  /**
   * Timeout in milliseconds (0 = no timeout).
   */
  timeout?: number

  /**
   * Environment variables to set for the command.
   */
  env?: Record<string, string>

  /**
   * If true, throw an error on non-zero exit code.
   * @default false
   */
  throwOnError?: boolean

  /**
   * Shell to use for execution.
   * @default '/bin/bash'
   */
  shell?: string

  /**
   * Maximum buffer size for stdout/stderr in bytes.
   */
  maxBuffer?: number
}

/**
 * A spawned child process handle.
 */
export interface SpawnedProcess {
  /**
   * Process ID.
   */
  pid: number

  /**
   * Send a signal to the process.
   */
  kill(signal?: string): boolean

  /**
   * Write to the process stdin.
   */
  write?(data: string | Buffer): void

  /**
   * Wait for the process to complete.
   */
  wait(): Promise<ExecResult>

  /**
   * Standard output stream (if available).
   */
  stdout?: AsyncIterable<string>

  /**
   * Standard error stream (if available).
   */
  stderr?: AsyncIterable<string>
}

/**
 * Options for spawning a process.
 */
export interface SpawnOptions extends ExecOptions {
  /**
   * If true, detach the child process from the parent.
   */
  detached?: boolean

  /**
   * Configure stdio streams.
   */
  stdio?: 'pipe' | 'inherit' | 'ignore'
}

/**
 * Bash capability interface for workflows that need shell access.
 *
 * Provides command execution and process spawning functionality.
 *
 * @example
 * ```typescript
 * const runBuild = async ($: WorkflowContext) => {
 *   if (!hasBash($)) {
 *     throw new CapabilityError('bash', 'not_available', 'Bash required')
 *   }
 *
 *   const result = await $.bash.exec('npm run build', { cwd: '/app' })
 *   if (result.exitCode !== 0) {
 *     throw new Error(`Build failed: ${result.stderr}`)
 *   }
 *   return result.stdout
 * }
 * ```
 */
export interface BashCapability extends CapabilityModule {
  readonly name: 'bash'

  /**
   * Execute a shell command and wait for completion.
   *
   * @param command - Command to execute
   * @param options - Execution options
   * @returns Result with stdout, stderr, and exit code
   *
   * @example
   * ```typescript
   * const result = await $.bash.exec('ls -la')
   * console.log(result.stdout)
   *
   * const build = await $.bash.exec('npm run build', {
   *   cwd: '/app',
   *   timeout: 60000,
   *   env: { NODE_ENV: 'production' }
   * })
   * ```
   */
  exec(command: string, options?: ExecOptions): Promise<ExecResult>

  /**
   * Spawn a child process without waiting for completion.
   *
   * @param command - Command to spawn
   * @param args - Arguments to pass to the command
   * @param options - Spawn options
   * @returns Process handle for interaction
   *
   * @example
   * ```typescript
   * const proc = await $.bash.spawn('npm', ['run', 'dev'])
   * // Later...
   * proc.kill()
   * ```
   */
  spawn(command: string, args?: string[], options?: SpawnOptions): SpawnedProcess

  /**
   * Run a command with automatic error handling.
   * Throws if the command fails (non-zero exit code).
   *
   * @param command - Command to run
   * @param options - Execution options
   * @returns stdout on success
   * @throws Error if command fails
   *
   * @example
   * ```typescript
   * const output = await $.bash.run('git status')
   * ```
   */
  run?(command: string, options?: ExecOptions): Promise<string>

  /**
   * Check if a command exists in PATH.
   *
   * @param command - Command name to check
   * @returns True if command is available
   *
   * @example
   * ```typescript
   * if (await $.bash.which('docker')) {
   *   await $.bash.exec('docker build .')
   * }
   * ```
   */
  which?(command: string): Promise<boolean>
}

// ============================================================================
// CAPABILITY ERROR
// ============================================================================

/**
 * Valid capability names that can be referenced in errors.
 */
export type CapabilityName = 'fs' | 'git' | 'bash' | string

/**
 * Reasons why a capability might be unavailable.
 */
export type CapabilityErrorReason = 'not_available' | 'permission_denied' | 'load_failed'

/**
 * Error thrown when a capability is not available or fails to load.
 *
 * Use this error to indicate that a required capability is missing
 * or could not be initialized.
 *
 * @example
 * ```typescript
 * const requireFs = ($: WorkflowContext) => {
 *   if (!hasFs($)) {
 *     throw new CapabilityError(
 *       'fs',
 *       'not_available',
 *       'Filesystem capability is required for this operation'
 *     )
 *   }
 *   return $.fs
 * }
 * ```
 */
export class CapabilityError extends Error {
  /**
   * Error name for instanceof checks.
   */
  override readonly name = 'CapabilityError'

  /**
   * Create a new CapabilityError.
   *
   * @param capability - The name of the unavailable capability
   * @param reason - Why the capability is unavailable
   * @param message - Optional custom error message
   */
  constructor(
    public readonly capability: CapabilityName,
    public readonly reason: CapabilityErrorReason,
    message?: string,
  ) {
    super(message ?? `Capability '${capability}' is ${reason.replace(/_/g, ' ')}`)
  }
}

// ============================================================================
// TYPE HELPERS FOR COMPOSED CONTEXTS
// ============================================================================

// Import WorkflowContext type for composition
import type { WorkflowContext } from './WorkflowContext'

/**
 * WorkflowContext with required filesystem capability.
 *
 * Use this type when a workflow requires filesystem access.
 *
 * @example
 * ```typescript
 * const saveData = async ($: WithFs) => {
 *   await $.fs.writeFile('/data.json', JSON.stringify(data))
 * }
 * ```
 */
export type WithFs = WorkflowContext & { fs: FsCapability }

/**
 * WorkflowContext with required git capability.
 *
 * Use this type when a workflow requires git access.
 *
 * @example
 * ```typescript
 * const checkBranch = async ($: WithGit) => {
 *   const status = await $.git.status()
 *   return status.branch
 * }
 * ```
 */
export type WithGit = WorkflowContext & { git: GitCapability }

/**
 * WorkflowContext with required bash capability.
 *
 * Use this type when a workflow requires shell access.
 *
 * @example
 * ```typescript
 * const runTests = async ($: WithBash) => {
 *   const result = await $.bash.exec('npm test')
 *   return result.exitCode === 0
 * }
 * ```
 */
export type WithBash = WorkflowContext & { bash: BashCapability }

/**
 * WorkflowContext with all capabilities required.
 *
 * Use this type when a workflow requires full system access.
 *
 * @example
 * ```typescript
 * const fullDeploy = async ($: WithAllCapabilities) => {
 *   await $.git.pull()
 *   await $.bash.exec('npm run build')
 *   await $.fs.writeFile('/deploy.log', 'Deployed')
 * }
 * ```
 */
export type WithAllCapabilities = WithFs & WithGit & WithBash

// ============================================================================
// TYPE GUARDS FOR CAPABILITY CHECKING
// ============================================================================

/**
 * Check if a WorkflowContext has filesystem capability available.
 *
 * Use this type guard to narrow the context type before accessing $.fs.
 *
 * @param ctx - The WorkflowContext to check
 * @returns True if fs capability is available
 *
 * @example
 * ```typescript
 * const process = async ($: WorkflowContext) => {
 *   if (hasFs($)) {
 *     // $ is now typed as WithFs
 *     const data = await $.fs.readFile('/config.json')
 *   }
 * }
 * ```
 */
export function hasFs(ctx: WorkflowContext): ctx is WithFs {
  return ctx != null && typeof (ctx as WithFs).fs === 'object' && (ctx as WithFs).fs !== null
}

/**
 * Check if a WorkflowContext has git capability available.
 *
 * Use this type guard to narrow the context type before accessing $.git.
 *
 * @param ctx - The WorkflowContext to check
 * @returns True if git capability is available
 *
 * @example
 * ```typescript
 * const process = async ($: WorkflowContext) => {
 *   if (hasGit($)) {
 *     // $ is now typed as WithGit
 *     const status = await $.git.status()
 *   }
 * }
 * ```
 */
export function hasGit(ctx: WorkflowContext): ctx is WithGit {
  return ctx != null && typeof (ctx as WithGit).git === 'object' && (ctx as WithGit).git !== null
}

/**
 * Check if a WorkflowContext has bash capability available.
 *
 * Use this type guard to narrow the context type before accessing $.bash.
 *
 * @param ctx - The WorkflowContext to check
 * @returns True if bash capability is available
 *
 * @example
 * ```typescript
 * const process = async ($: WorkflowContext) => {
 *   if (hasBash($)) {
 *     // $ is now typed as WithBash
 *     const result = await $.bash.exec('echo hello')
 *   }
 * }
 * ```
 */
export function hasBash(ctx: WorkflowContext): ctx is WithBash {
  return ctx != null && typeof (ctx as WithBash).bash === 'object' && (ctx as WithBash).bash !== null
}

/**
 * Check if a WorkflowContext has all capabilities available.
 *
 * @param ctx - The WorkflowContext to check
 * @returns True if all capabilities are available
 *
 * @example
 * ```typescript
 * const fullDeploy = async ($: WorkflowContext) => {
 *   if (!hasAllCapabilities($)) {
 *     throw new CapabilityError('all', 'not_available', 'Full system access required')
 *   }
 *   // $ is now typed as WithAllCapabilities
 * }
 * ```
 */
export function hasAllCapabilities(ctx: WorkflowContext): ctx is WithAllCapabilities {
  return hasFs(ctx) && hasGit(ctx) && hasBash(ctx)
}
