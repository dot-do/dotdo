/**
 * @fileoverview GitCapability TypeScript Interfaces
 *
 * This module defines the comprehensive TypeScript interfaces for the git capability,
 * designed for integration with Durable Objects as the $.git proxy. It provides
 * type definitions for all core git operations including:
 *
 * - **Repository operations**: clone, init, fetch, pull, push
 * - **Working tree operations**: add, commit, status, log, diff
 * - **Branch operations**: branch, checkout, merge
 * - **Low-level operations**: resolveRef, readObject
 *
 * The interfaces follow the existing patterns established in objects.ts and storage.ts,
 * using JSDoc comments and consistent naming conventions.
 *
 * @module types/capability
 *
 * @example
 * ```typescript
 * import type { GitCapability, GitStatus, Commit } from 'gitx.do'
 *
 * // Use in a Durable Object context as $.git
 * class MyDO extends DO {
 *   async handleRequest(request: Request): Promise<Response> {
 *     const status = await this.$.git.status()
 *     if (status.staged.length > 0) {
 *       const commit = await this.$.git.commit({ message: 'Auto-commit' })
 *       console.log(`Created commit: ${commit.sha}`)
 *     }
 *     return new Response('OK')
 *   }
 * }
 * ```
 */

import type { Author, ObjectType } from './objects'

// ============================================================================
// Core Types
// ============================================================================

/**
 * 40-character lowercase hexadecimal SHA-1 hash.
 *
 * @description
 * Type alias for SHA-1 hashes used throughout the git system.
 * All SHAs should be lowercase hexadecimal strings of exactly 40 characters.
 */
export type SHA = string

/**
 * Git reference name.
 *
 * @description
 * Full ref path (e.g., 'refs/heads/main', 'refs/tags/v1.0.0', 'HEAD').
 * References are pointers to commits or other objects.
 */
export type RefName = string

// ============================================================================
// Git Object Representations
// ============================================================================

/**
 * Represents a Git commit with all metadata.
 *
 * @description
 * A complete commit representation including SHA, message, author information,
 * parent commits, and the tree SHA representing the project state at this commit.
 * This is the primary type returned by log and commit operations.
 *
 * @see Author - The author/committer identity type
 *
 * @example
 * ```typescript
 * const commits = await $.git.log({ maxCount: 10 })
 * for (const commit of commits) {
 *   console.log(`${commit.sha.slice(0, 7)} ${commit.message.split('\n')[0]}`)
 *   console.log(`  Author: ${commit.author.name} <${commit.author.email}>`)
 * }
 * ```
 */
export interface Commit {
  /** 40-character SHA-1 hash of the commit */
  sha: SHA
  /** 40-character SHA-1 of the root tree object */
  tree: SHA
  /** Parent commit SHAs (empty for root commit, multiple for merge commits) */
  parents: SHA[]
  /** Original author of the changes */
  author: Author
  /** Person who created this commit object */
  committer: Author
  /** Full commit message including subject and body */
  message: string
}

/**
 * Represents a raw Git object with size metadata.
 *
 * @description
 * A low-level representation of any Git object (blob, tree, commit, tag)
 * with its type, raw binary data, and size. Used by readObject for accessing
 * objects directly. This extends the base GitObject from objects.ts with
 * an explicit size field.
 *
 * @see ObjectType - The four Git object types
 *
 * @example
 * ```typescript
 * const obj = await $.git.readObject('abc123...')
 * if (obj && obj.type === 'blob') {
 *   const content = new TextDecoder().decode(obj.data)
 *   console.log('File content:', content)
 * }
 * ```
 */
export interface RawGitObject {
  /** The type of Git object */
  type: ObjectType
  /** Raw binary data of the object */
  data: Uint8Array
  /** Size of the object in bytes */
  size: number
}

/**
 * Represents a Git reference with target and optional metadata.
 *
 * @description
 * A reference pointing to a commit or other object. Includes the full
 * ref name, target SHA, and optional symbolic target for HEAD-like refs.
 *
 * @example
 * ```typescript
 * const refs = await $.git.listRefs('refs/heads/')
 * for (const ref of refs) {
 *   console.log(`${ref.name} -> ${ref.sha}`)
 * }
 * ```
 */
export interface GitRef {
  /** Full ref name (e.g., 'refs/heads/main') */
  name: RefName
  /** 40-character SHA-1 the ref points to */
  sha: SHA
  /** For symbolic refs, the target ref name */
  symbolicTarget?: RefName
  /** For annotated tags, the peeled (dereferenced) SHA */
  peeled?: SHA
}

/**
 * Represents a Git branch with tracking information.
 *
 * @description
 * A branch with its current commit SHA and optional upstream tracking
 * information showing ahead/behind counts.
 *
 * @example
 * ```typescript
 * const branches = await $.git.branch({ all: true })
 * for (const branch of branches) {
 *   let status = branch.name
 *   if (branch.upstream) {
 *     status += ` [${branch.upstream}: +${branch.ahead}/-${branch.behind}]`
 *   }
 *   console.log(branch.current ? `* ${status}` : `  ${status}`)
 * }
 * ```
 */
export interface Branch {
  /** Branch name (without refs/heads/ prefix) */
  name: string
  /** 40-character SHA-1 of the branch tip */
  sha: SHA
  /** Whether this is the currently checked out branch */
  current: boolean
  /** Upstream tracking branch name (e.g., 'origin/main') */
  upstream?: string
  /** Commits ahead of upstream */
  ahead?: number
  /** Commits behind upstream */
  behind?: number
}

/**
 * Represents a Git tag.
 *
 * @description
 * A tag reference pointing to a commit (or other object). For annotated tags,
 * includes tagger information and message.
 *
 * @example
 * ```typescript
 * const tags = await $.git.listTags()
 * for (const tag of tags) {
 *   console.log(`${tag.name} -> ${tag.sha}`)
 *   if (tag.message) {
 *     console.log(`  ${tag.message}`)
 *   }
 * }
 * ```
 */
export interface Tag {
  /** Tag name (without refs/tags/ prefix) */
  name: string
  /** SHA of the tag object (for annotated) or target (for lightweight) */
  sha: SHA
  /** SHA of the tagged object (commit) after dereferencing */
  target: SHA
  /** Whether this is an annotated tag */
  annotated: boolean
  /** Tagger information (annotated tags only) */
  tagger?: Author
  /** Tag message (annotated tags only) */
  message?: string
}

// ============================================================================
// Status Types
// ============================================================================

/**
 * File status in the working tree or index.
 *
 * @description
 * Represents the status of a single file, including its path and
 * status codes for both the index (staged) and working tree.
 *
 * Status codes:
 * - ' ' (space): Unmodified
 * - 'M': Modified
 * - 'A': Added
 * - 'D': Deleted
 * - 'R': Renamed
 * - 'C': Copied
 * - 'U': Updated but unmerged
 * - '?': Untracked
 * - '!': Ignored
 *
 * @example
 * ```typescript
 * const status = await $.git.status()
 * for (const file of status.files) {
 *   console.log(`${file.index}${file.workingTree} ${file.path}`)
 * }
 * ```
 */
export interface FileStatus {
  /** File path relative to repository root */
  path: string
  /** Status in the index (staged area) */
  index: ' ' | 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '?' | '!'
  /** Status in the working tree */
  workingTree: ' ' | 'M' | 'A' | 'D' | 'R' | 'C' | 'U' | '?' | '!'
  /** Original path for renamed/copied files */
  origPath?: string
}

/**
 * Working tree status result.
 *
 * @description
 * Complete status of the repository working tree including current branch,
 * HEAD commit, and categorized file lists for staged, modified, and untracked files.
 *
 * @see FileStatus - Individual file status representation
 *
 * @example
 * ```typescript
 * const status = await $.git.status()
 * console.log(`On branch ${status.branch}`)
 * if (status.staged.length > 0) {
 *   console.log('Changes to be committed:')
 *   status.staged.forEach(f => console.log(`  ${f.path}`))
 * }
 * if (status.modified.length > 0) {
 *   console.log('Changes not staged for commit:')
 *   status.modified.forEach(f => console.log(`  ${f.path}`))
 * }
 * ```
 */
export interface GitStatus {
  /** Current branch name (null if detached HEAD) */
  branch: string | null
  /** Current HEAD commit SHA */
  head: SHA | null
  /** Whether the repository is in a clean state */
  clean: boolean
  /** Whether HEAD is detached */
  detached: boolean
  /** Upstream tracking branch */
  upstream?: string
  /** Commits ahead of upstream */
  ahead?: number
  /** Commits behind upstream */
  behind?: number
  /** All files with their status codes */
  files: FileStatus[]
  /** Files staged for commit */
  staged: FileStatus[]
  /** Modified files not yet staged */
  modified: FileStatus[]
  /** Untracked files */
  untracked: FileStatus[]
  /** Files with merge conflicts */
  conflicted: FileStatus[]
}

// ============================================================================
// Diff Types
// ============================================================================

/**
 * A single hunk in a diff.
 *
 * @description
 * Represents a contiguous section of changes in a file diff,
 * with line numbers and the actual diff lines.
 *
 * @example
 * ```typescript
 * for (const hunk of fileDiff.hunks) {
 *   console.log(`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`)
 *   for (const line of hunk.lines) {
 *     console.log(line)
 *   }
 * }
 * ```
 */
export interface DiffHunk {
  /** Starting line number in the old file */
  oldStart: number
  /** Number of lines in the old file */
  oldLines: number
  /** Starting line number in the new file */
  newStart: number
  /** Number of lines in the new file */
  newLines: number
  /** Diff lines (prefixed with ' ', '+', or '-') */
  lines: string[]
}

/**
 * Diff result for a single file.
 *
 * @description
 * Complete diff information for a single file including the change type,
 * old/new paths, mode changes, and diff hunks.
 *
 * @see DiffHunk - Individual diff hunk
 *
 * @example
 * ```typescript
 * const diff = await $.git.diff({ cached: true })
 * for (const file of diff.files) {
 *   console.log(`${file.status} ${file.newPath || file.oldPath}`)
 *   console.log(`+${file.additions} -${file.deletions}`)
 * }
 * ```
 */
export interface FileDiff {
  /** Type of change */
  status: 'added' | 'deleted' | 'modified' | 'renamed' | 'copied'
  /** Old file path (null for added files) */
  oldPath: string | null
  /** New file path (null for deleted files) */
  newPath: string | null
  /** Old file mode */
  oldMode?: string
  /** New file mode */
  newMode?: string
  /** Old blob SHA */
  oldSha?: SHA
  /** New blob SHA */
  newSha?: SHA
  /** Whether the file is binary */
  binary: boolean
  /** Number of added lines */
  additions: number
  /** Number of deleted lines */
  deletions: number
  /** Diff hunks (empty for binary files) */
  hunks: DiffHunk[]
}

/**
 * Complete diff result.
 *
 * @description
 * Result of a diff operation containing all changed files and summary statistics.
 *
 * @example
 * ```typescript
 * const diff = await $.git.diff({ from: 'HEAD~3', to: 'HEAD' })
 * console.log(`${diff.files.length} files changed`)
 * console.log(`+${diff.additions} -${diff.deletions}`)
 * ```
 */
export interface DiffResult {
  /** Individual file diffs */
  files: FileDiff[]
  /** Total number of files changed */
  filesChanged: number
  /** Total lines added */
  additions: number
  /** Total lines deleted */
  deletions: number
}

// ============================================================================
// Operation Options
// ============================================================================

/**
 * Options for cloning a repository.
 *
 * @description
 * Configuration for the clone operation including remote URL,
 * branch selection, depth limits, and authentication.
 *
 * @example
 * ```typescript
 * await $.git.clone({
 *   url: 'https://github.com/user/repo.git',
 *   branch: 'develop',
 *   depth: 1,
 *   auth: { token: process.env.GITHUB_TOKEN }
 * })
 * ```
 */
export interface CloneOptions {
  /** Remote repository URL */
  url: string
  /** Branch to clone (defaults to remote default) */
  branch?: string
  /** Clone depth (shallow clone if specified) */
  depth?: number
  /** Clone single branch only */
  singleBranch?: boolean
  /** Skip checkout after clone */
  noCheckout?: boolean
  /** Authentication credentials */
  auth?: AuthOptions
  /** Progress callback */
  onProgress?: ProgressCallback
}

/**
 * Options for initializing a repository.
 *
 * @description
 * Configuration for the init operation including initial branch name
 * and whether to create a bare repository.
 *
 * @example
 * ```typescript
 * await $.git.init({
 *   defaultBranch: 'main',
 *   bare: false
 * })
 * ```
 */
export interface InitOptions {
  /** Initial branch name (defaults to 'main') */
  defaultBranch?: string
  /** Create a bare repository */
  bare?: boolean
}

/**
 * Options for fetching from a remote.
 *
 * @description
 * Configuration for the fetch operation including remote name,
 * refspecs, depth, and tag handling.
 *
 * @example
 * ```typescript
 * await $.git.fetch({
 *   remote: 'origin',
 *   prune: true,
 *   tags: true
 * })
 * ```
 */
export interface FetchOptions {
  /** Remote name (defaults to 'origin') */
  remote?: string
  /** Specific refs to fetch */
  refspecs?: string[]
  /** Fetch depth for shallow repositories */
  depth?: number
  /** Remove remote-tracking refs that no longer exist */
  prune?: boolean
  /** Fetch tags */
  tags?: boolean
  /** Force update of local refs */
  force?: boolean
  /** Authentication credentials */
  auth?: AuthOptions
  /** Progress callback */
  onProgress?: ProgressCallback
}

/**
 * Options for pulling from a remote.
 *
 * @description
 * Configuration for the pull operation (fetch + merge or rebase).
 *
 * @example
 * ```typescript
 * await $.git.pull({
 *   remote: 'origin',
 *   branch: 'main',
 *   rebase: true
 * })
 * ```
 */
export interface PullOptions {
  /** Remote name (defaults to 'origin') */
  remote?: string
  /** Branch to pull (defaults to current upstream) */
  branch?: string
  /** Use rebase instead of merge */
  rebase?: boolean
  /** Fast-forward only (fail if not possible) */
  fastForwardOnly?: boolean
  /** Authentication credentials */
  auth?: AuthOptions
  /** Progress callback */
  onProgress?: ProgressCallback
}

/**
 * Options for pushing to a remote.
 *
 * @description
 * Configuration for the push operation including remote, branches,
 * and force/delete options.
 *
 * @example
 * ```typescript
 * await $.git.push({
 *   remote: 'origin',
 *   branch: 'feature-branch',
 *   setUpstream: true
 * })
 * ```
 */
export interface PushOptions {
  /** Remote name (defaults to 'origin') */
  remote?: string
  /** Branch to push (defaults to current branch) */
  branch?: string
  /** Refspecs to push */
  refspecs?: string[]
  /** Force push (overwrites remote history) */
  force?: boolean
  /** Force with lease (safe force push) */
  forceWithLease?: boolean
  /** Delete the remote branch */
  delete?: boolean
  /** Set upstream tracking */
  setUpstream?: boolean
  /** Push tags */
  tags?: boolean
  /** Push all branches */
  all?: boolean
  /** Authentication credentials */
  auth?: AuthOptions
  /** Progress callback */
  onProgress?: ProgressCallback
}

/**
 * Options for staging files.
 *
 * @description
 * Configuration for the add operation including file patterns
 * and force/update modes.
 *
 * @example
 * ```typescript
 * // Stage specific files
 * await $.git.add({ paths: ['src/index.ts', 'package.json'] })
 *
 * // Stage all changes
 * await $.git.add({ all: true })
 * ```
 */
export interface AddOptions {
  /** File paths or glob patterns to add */
  paths?: string[]
  /** Add all changes including untracked files */
  all?: boolean
  /** Update tracked files only */
  update?: boolean
  /** Force add ignored files */
  force?: boolean
  /** Dry run (show what would be added) */
  dryRun?: boolean
}

/**
 * Options for creating a commit.
 *
 * @description
 * Configuration for the commit operation including message,
 * author information, and amendment options.
 *
 * @example
 * ```typescript
 * const commit = await $.git.commit({
 *   message: 'feat: add new feature\n\nDetailed description here.',
 *   author: {
 *     name: 'Alice',
 *     email: 'alice@example.com.ai',
 *     timestamp: Date.now() / 1000,
 *     timezone: '+0000'
 *   }
 * })
 * ```
 */
export interface CommitOptions {
  /** Commit message */
  message: string
  /** Author information (defaults to configured user) */
  author?: Author
  /** Committer information (defaults to author) */
  committer?: Author
  /** Amend the previous commit */
  amend?: boolean
  /** Allow empty commits (no changes) */
  allowEmpty?: boolean
  /** Sign the commit with GPG */
  gpgSign?: boolean
  /** Skip pre-commit and commit-msg hooks */
  noVerify?: boolean
}

/**
 * Options for viewing status.
 *
 * @description
 * Configuration for the status operation including ignored files
 * and untracked files handling.
 *
 * @example
 * ```typescript
 * const status = await $.git.status({
 *   includeIgnored: true,
 *   untrackedFiles: 'all'
 * })
 * ```
 */
export interface StatusOptions {
  /** Include ignored files in the status */
  includeIgnored?: boolean
  /** Untracked files mode: 'no', 'normal', 'all' */
  untrackedFiles?: 'no' | 'normal' | 'all'
  /** Only check specific paths */
  paths?: string[]
}

/**
 * Options for viewing commit log.
 *
 * @description
 * Configuration for the log operation including commit range,
 * file filtering, and formatting options.
 *
 * @example
 * ```typescript
 * // Last 10 commits
 * const commits = await $.git.log({ maxCount: 10 })
 *
 * // Commits affecting a file
 * const fileHistory = await $.git.log({
 *   path: 'src/index.ts',
 *   follow: true
 * })
 * ```
 */
export interface LogOptions {
  /** Starting commit ref (defaults to HEAD) */
  ref?: string
  /** Maximum number of commits to return */
  maxCount?: number
  /** Skip the first N commits */
  skip?: number
  /** Only commits after this date */
  since?: Date | string
  /** Only commits before this date */
  until?: Date | string
  /** Only commits by this author (pattern match) */
  author?: string
  /** Only commits matching this message pattern */
  grep?: string
  /** Only commits affecting this path */
  path?: string
  /** Follow file renames */
  follow?: boolean
  /** First parent only (for merge commits) */
  firstParent?: boolean
  /** Show all refs (not just from ref) */
  all?: boolean
}

/**
 * Options for generating diffs.
 *
 * @description
 * Configuration for the diff operation including commit range,
 * context lines, and output options.
 *
 * @example
 * ```typescript
 * // Working tree vs staged
 * const diff = await $.git.diff()
 *
 * // Staged vs HEAD
 * const staged = await $.git.diff({ cached: true })
 *
 * // Between commits
 * const compare = await $.git.diff({
 *   from: 'HEAD~5',
 *   to: 'HEAD'
 * })
 * ```
 */
export interface DiffOptions {
  /** Starting commit/tree (defaults to index) */
  from?: string
  /** Ending commit/tree (defaults to working tree) */
  to?: string
  /** Diff staged changes vs HEAD */
  cached?: boolean
  /** Number of context lines */
  contextLines?: number
  /** Detect renames */
  detectRenames?: boolean
  /** Detect copies */
  detectCopies?: boolean
  /** Only specific paths */
  paths?: string[]
  /** Ignore whitespace changes */
  ignoreWhitespace?: boolean
  /** Show only file names */
  nameOnly?: boolean
  /** Show file names with status */
  nameStatus?: boolean
}

/**
 * Options for branch operations.
 *
 * @description
 * Configuration for listing, creating, or deleting branches.
 *
 * @example
 * ```typescript
 * // List all branches
 * const branches = await $.git.branch({ all: true })
 *
 * // Create a new branch
 * await $.git.branch({ create: 'feature/new', startPoint: 'develop' })
 *
 * // Delete a branch
 * await $.git.branch({ delete: 'old-branch' })
 * ```
 */
export interface BranchOptions {
  /** List all branches (local and remote) */
  all?: boolean
  /** List only remote branches */
  remotes?: boolean
  /** Create a new branch with this name */
  create?: string
  /** Delete branch with this name */
  delete?: string
  /** Force delete (even if not merged) */
  force?: boolean
  /** Starting point for new branch */
  startPoint?: string
  /** Set up tracking for new branch */
  track?: string
  /** Rename current branch to this name */
  rename?: string
  /** Show verbose output (including tracking) */
  verbose?: boolean
}

/**
 * Options for checkout operations.
 *
 * @description
 * Configuration for switching branches or restoring files.
 *
 * @example
 * ```typescript
 * // Switch to a branch
 * await $.git.checkout({ branch: 'develop' })
 *
 * // Create and switch to new branch
 * await $.git.checkout({ branch: 'feature/new', create: true })
 *
 * // Restore a file from HEAD
 * await $.git.checkout({ paths: ['src/index.ts'] })
 * ```
 */
export interface CheckoutOptions {
  /** Branch name to checkout */
  branch?: string
  /** Create branch if it doesn't exist */
  create?: boolean
  /** Force checkout (discard local changes) */
  force?: boolean
  /** Specific paths to checkout/restore */
  paths?: string[]
  /** Source commit/tree for restoring paths */
  source?: string
  /** Detach HEAD at this commit */
  detach?: boolean
}

/**
 * Options for merge operations.
 *
 * @description
 * Configuration for merging branches or commits.
 *
 * @example
 * ```typescript
 * // Merge a branch
 * const result = await $.git.merge({
 *   branch: 'feature/new',
 *   message: 'Merge feature/new into main'
 * })
 *
 * // Fast-forward only
 * await $.git.merge({ branch: 'develop', fastForwardOnly: true })
 * ```
 */
export interface MergeOptions {
  /** Branch or commit to merge */
  branch: string
  /** Merge commit message */
  message?: string
  /** Fast-forward only (fail if not possible) */
  fastForwardOnly?: boolean
  /** Never fast-forward (always create merge commit) */
  noFastForward?: boolean
  /** Merge strategy ('recursive', 'ours', 'theirs') */
  strategy?: 'recursive' | 'ours' | 'theirs'
  /** Squash commits into single change */
  squash?: boolean
  /** Abort if there are conflicts */
  abortOnConflict?: boolean
}

// ============================================================================
// Authentication
// ============================================================================

/**
 * Authentication options for remote operations.
 *
 * @description
 * Credentials for authenticating with remote repositories.
 * Supports token-based, username/password, and SSH authentication.
 *
 * @example
 * ```typescript
 * // Token authentication (GitHub)
 * const auth: AuthOptions = { token: process.env.GITHUB_TOKEN }
 *
 * // Username/password
 * const auth: AuthOptions = {
 *   username: 'user',
 *   password: 'pass'
 * }
 * ```
 */
export interface AuthOptions {
  /** Bearer token for authentication */
  token?: string
  /** Username for basic auth */
  username?: string
  /** Password for basic auth */
  password?: string
  /** SSH private key (PEM format) */
  privateKey?: string
  /** Passphrase for SSH key */
  passphrase?: string
}

// ============================================================================
// Callbacks
// ============================================================================

/**
 * Progress callback for long-running operations.
 *
 * @description
 * Called during clone, fetch, push, and other network operations
 * to report progress.
 *
 * @param progress - Progress information
 *
 * @example
 * ```typescript
 * await $.git.clone({
 *   url: 'https://github.com/user/repo.git',
 *   onProgress: (progress) => {
 *     console.log(`${progress.phase}: ${progress.loaded}/${progress.total}`)
 *   }
 * })
 * ```
 */
export type ProgressCallback = (progress: ProgressEvent) => void

/**
 * Progress event data.
 *
 * @description
 * Progress information for network operations including phase,
 * loaded/total bytes or objects, and human-readable message.
 */
export interface ProgressEvent {
  /** Current phase of the operation */
  phase: 'counting' | 'compressing' | 'receiving' | 'resolving' | 'checking'
  /** Number of items/bytes processed */
  loaded: number
  /** Total items/bytes (may be 0 if unknown) */
  total: number
  /** Human-readable progress message */
  message: string
}

// ============================================================================
// Result Types
// ============================================================================

/**
 * Result of a merge operation.
 *
 * @description
 * Information about a completed merge including the result type,
 * resulting commit, and any conflicts.
 *
 * @example
 * ```typescript
 * const result = await $.git.merge({ branch: 'feature' })
 * if (result.conflicts) {
 *   console.log('Merge conflicts:', result.conflicts)
 * } else if (result.type === 'fast-forward') {
 *   console.log('Fast-forwarded to', result.commit)
 * }
 * ```
 */
export interface MergeResult {
  /** Type of merge performed */
  type: 'fast-forward' | 'merge' | 'already-up-to-date' | 'conflict'
  /** Resulting commit SHA (null if conflicts) */
  commit: SHA | null
  /** List of conflicted file paths */
  conflicts?: string[]
  /** Merged commit message */
  message?: string
}

/**
 * Result of a push operation.
 *
 * @description
 * Information about a completed push including updated refs
 * and any errors.
 *
 * @example
 * ```typescript
 * const result = await $.git.push({ remote: 'origin' })
 * for (const ref of result.updates) {
 *   console.log(`${ref.ref}: ${ref.oldSha} -> ${ref.newSha}`)
 * }
 * ```
 */
export interface PushResult {
  /** Whether the push succeeded */
  ok: boolean
  /** Refs that were updated */
  updates: Array<{
    ref: RefName
    oldSha: SHA | null
    newSha: SHA
    forced: boolean
  }>
  /** Error messages for failed updates */
  errors?: Array<{
    ref: RefName
    message: string
  }>
}

/**
 * Result of a fetch operation.
 *
 * @description
 * Information about a completed fetch including updated refs
 * and pruned refs.
 *
 * @example
 * ```typescript
 * const result = await $.git.fetch({ prune: true })
 * console.log(`Updated ${result.updates.length} refs`)
 * console.log(`Pruned ${result.pruned.length} refs`)
 * ```
 */
export interface FetchResult {
  /** Refs that were updated */
  updates: Array<{
    ref: RefName
    oldSha: SHA | null
    newSha: SHA
  }>
  /** Refs that were pruned */
  pruned: RefName[]
}

// ============================================================================
// Main GitCapability Interface
// ============================================================================

/**
 * Main interface for the git capability proxy.
 *
 * @description
 * The comprehensive interface for all git operations, designed to be used
 * as the $.git proxy in a Durable Object context. Provides methods for:
 *
 * - **Repository operations**: clone, init, fetch, pull, push
 * - **Working tree operations**: add, commit, status, log, diff
 * - **Branch operations**: branch, checkout, merge
 * - **Low-level operations**: resolveRef, readObject
 *
 * All methods return Promises and support cancellation through AbortSignal
 * where applicable.
 *
 * @example
 * ```typescript
 * // Full example workflow
 * class MyDO extends DO {
 *   git: GitCapability = this.$.git
 *
 *   async createFeature(name: string): Promise<Commit> {
 *     // Create and checkout new branch
 *     await this.git.checkout({ branch: `feature/${name}`, create: true })
 *
 *     // Make changes...
 *
 *     // Stage and commit
 *     await this.git.add({ all: true })
 *     const commit = await this.git.commit({
 *       message: `feat: ${name}`
 *     })
 *
 *     // Push to remote
 *     await this.git.push({ setUpstream: true })
 *
 *     return commit
 *   }
 * }
 * ```
 */
export interface GitCapability {
  // ─────────────────────────────────────────────────────────────────────────
  // Repository Operations
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Clone a repository from a remote URL.
   *
   * @description
   * Clones a remote repository, downloading all objects and refs.
   * Supports shallow clones, single-branch, and authentication.
   *
   * @param options - Clone configuration
   * @returns Void on success
   * @throws Error if clone fails
   *
   * @example
   * ```typescript
   * await $.git.clone({
   *   url: 'https://github.com/user/repo.git',
   *   branch: 'main',
   *   depth: 1
   * })
   * ```
   */
  clone(options: CloneOptions): Promise<void>

  /**
   * Initialize a new repository.
   *
   * @description
   * Creates a new Git repository in the current location.
   * Can create either a normal or bare repository.
   *
   * @param options - Initialization configuration
   * @returns Void on success
   *
   * @example
   * ```typescript
   * await $.git.init({ defaultBranch: 'main' })
   * ```
   */
  init(options?: InitOptions): Promise<void>

  /**
   * Fetch refs and objects from a remote.
   *
   * @description
   * Downloads objects and refs from a remote repository.
   * Does not modify the working tree or current branch.
   *
   * @param options - Fetch configuration
   * @returns Fetch result with updated and pruned refs
   *
   * @example
   * ```typescript
   * const result = await $.git.fetch({ prune: true, tags: true })
   * console.log(`Fetched ${result.updates.length} refs`)
   * ```
   */
  fetch(options?: FetchOptions): Promise<FetchResult>

  /**
   * Pull changes from a remote (fetch + merge).
   *
   * @description
   * Fetches from a remote and integrates changes into the current branch.
   * Can use either merge or rebase strategy.
   *
   * @param options - Pull configuration
   * @returns Merge result
   *
   * @example
   * ```typescript
   * const result = await $.git.pull({ rebase: true })
   * if (result.type === 'conflict') {
   *   console.log('Conflicts detected')
   * }
   * ```
   */
  pull(options?: PullOptions): Promise<MergeResult>

  /**
   * Push commits to a remote repository.
   *
   * @description
   * Uploads local commits to a remote repository.
   * Supports force push, delete, and upstream tracking.
   *
   * @param options - Push configuration
   * @returns Push result with updated refs
   *
   * @example
   * ```typescript
   * await $.git.push({
   *   remote: 'origin',
   *   branch: 'main',
   *   setUpstream: true
   * })
   * ```
   */
  push(options?: PushOptions): Promise<PushResult>

  // ─────────────────────────────────────────────────────────────────────────
  // Working Tree Operations
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Add files to the staging area.
   *
   * @description
   * Stages file changes for the next commit. Can add specific files,
   * all changes, or only updates to tracked files.
   *
   * @param options - Add configuration
   * @returns List of staged file paths
   *
   * @example
   * ```typescript
   * // Stage specific files
   * await $.git.add({ paths: ['src/index.ts'] })
   *
   * // Stage all changes
   * await $.git.add({ all: true })
   * ```
   */
  add(options?: AddOptions): Promise<string[]>

  /**
   * Create a new commit.
   *
   * @description
   * Records changes to the repository by creating a new commit
   * with the currently staged changes.
   *
   * @param options - Commit configuration
   * @returns The created commit
   *
   * @example
   * ```typescript
   * const commit = await $.git.commit({
   *   message: 'feat: add new feature'
   * })
   * console.log(`Created commit: ${commit.sha}`)
   * ```
   */
  commit(options: CommitOptions): Promise<Commit>

  /**
   * Get the working tree status.
   *
   * @description
   * Shows the state of the working tree and staging area,
   * including modified, staged, and untracked files.
   *
   * @param options - Status configuration
   * @returns Complete status information
   *
   * @example
   * ```typescript
   * const status = await $.git.status()
   * console.log(`On branch ${status.branch}`)
   * console.log(`${status.staged.length} files staged`)
   * ```
   */
  status(options?: StatusOptions): Promise<GitStatus>

  /**
   * View commit history.
   *
   * @description
   * Returns a list of commits matching the specified criteria.
   * Supports filtering by date, author, path, and message.
   *
   * @param options - Log configuration
   * @returns Array of commits
   *
   * @example
   * ```typescript
   * const commits = await $.git.log({ maxCount: 10 })
   * for (const commit of commits) {
   *   console.log(`${commit.sha.slice(0, 7)} ${commit.message}`)
   * }
   * ```
   */
  log(options?: LogOptions): Promise<Commit[]>

  /**
   * Show changes between commits, working tree, and staging area.
   *
   * @description
   * Generates diffs between commits, trees, or the working tree.
   * Returns detailed file-by-file diff information.
   *
   * @param options - Diff configuration
   * @returns Complete diff result
   *
   * @example
   * ```typescript
   * // Show unstaged changes
   * const diff = await $.git.diff()
   *
   * // Show staged changes
   * const staged = await $.git.diff({ cached: true })
   * ```
   */
  diff(options?: DiffOptions): Promise<DiffResult>

  // ─────────────────────────────────────────────────────────────────────────
  // Branch Operations
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * List, create, or delete branches.
   *
   * @description
   * Manages branches in the repository. Without options, lists local branches.
   * Can also create new branches or delete existing ones.
   *
   * @param options - Branch configuration
   * @returns Array of branches (for list operations)
   *
   * @example
   * ```typescript
   * // List all branches
   * const branches = await $.git.branch({ all: true })
   *
   * // Create a new branch
   * await $.git.branch({ create: 'feature/new' })
   * ```
   */
  branch(options?: BranchOptions): Promise<Branch[]>

  /**
   * Switch branches or restore files.
   *
   * @description
   * Changes the current branch or restores files from a commit.
   * Can also create new branches during checkout.
   *
   * @param options - Checkout configuration
   * @returns Void on success
   *
   * @example
   * ```typescript
   * // Switch to existing branch
   * await $.git.checkout({ branch: 'develop' })
   *
   * // Create and switch to new branch
   * await $.git.checkout({ branch: 'feature/new', create: true })
   * ```
   */
  checkout(options: CheckoutOptions): Promise<void>

  /**
   * Merge branches or commits.
   *
   * @description
   * Joins two or more development histories together.
   * Supports fast-forward, merge commit, and squash strategies.
   *
   * @param options - Merge configuration
   * @returns Merge result
   *
   * @example
   * ```typescript
   * const result = await $.git.merge({
   *   branch: 'feature/complete',
   *   noFastForward: true
   * })
   * ```
   */
  merge(options: MergeOptions): Promise<MergeResult>

  // ─────────────────────────────────────────────────────────────────────────
  // Low-Level Operations
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Resolve a ref to its SHA.
   *
   * @description
   * Resolves a symbolic reference, branch name, tag, or partial SHA
   * to its full 40-character SHA-1 hash.
   *
   * @param ref - Reference to resolve (e.g., 'HEAD', 'main', 'v1.0.0')
   * @returns The resolved SHA, or null if not found
   *
   * @example
   * ```typescript
   * const sha = await $.git.resolveRef('HEAD')
   * const mainSha = await $.git.resolveRef('refs/heads/main')
   * const tagSha = await $.git.resolveRef('v1.0.0')
   * ```
   */
  resolveRef(ref: string): Promise<SHA | null>

  /**
   * Read a raw Git object.
   *
   * @description
   * Retrieves the raw object data for a given SHA.
   * Returns the object type, data, and size.
   *
   * @param sha - 40-character SHA-1 hash
   * @returns The raw object, or null if not found
   *
   * @example
   * ```typescript
   * const obj = await $.git.readObject(sha)
   * if (obj?.type === 'blob') {
   *   const content = new TextDecoder().decode(obj.data)
   * }
   * ```
   */
  readObject(sha: SHA): Promise<RawGitObject | null>

  /**
   * List refs matching a prefix.
   *
   * @description
   * Returns all refs that start with the given prefix.
   * Useful for listing branches, tags, or remote refs.
   *
   * @param prefix - Ref prefix (e.g., 'refs/heads/', 'refs/tags/')
   * @returns Array of matching refs
   *
   * @example
   * ```typescript
   * const branches = await $.git.listRefs('refs/heads/')
   * const tags = await $.git.listRefs('refs/tags/')
   * ```
   */
  listRefs(prefix?: string): Promise<GitRef[]>

  /**
   * List all tags.
   *
   * @description
   * Returns all tags in the repository with their metadata.
   * Includes both lightweight and annotated tags.
   *
   * @returns Array of tags
   *
   * @example
   * ```typescript
   * const tags = await $.git.listTags()
   * for (const tag of tags) {
   *   console.log(`${tag.name}: ${tag.target}`)
   * }
   * ```
   */
  listTags(): Promise<Tag[]>

  /**
   * Get the current HEAD reference.
   *
   * @description
   * Returns information about the current HEAD, including whether
   * it's detached and what it points to.
   *
   * @returns HEAD reference information
   *
   * @example
   * ```typescript
   * const head = await $.git.head()
   * if (head.symbolicTarget) {
   *   console.log(`On branch ${head.symbolicTarget}`)
   * } else {
   *   console.log(`HEAD detached at ${head.sha}`)
   * }
   * ```
   */
  head(): Promise<GitRef>
}

// ============================================================================
// Utility Types
// ============================================================================

/**
 * Result of resolving a tree path.
 *
 * @description
 * Information about an entry at a specific path within a tree,
 * including the mode, name, and SHA.
 */
export interface TreePathResult {
  /** Entry mode (file type) */
  mode: string
  /** Entry name */
  name: string
  /** Entry SHA */
  sha: SHA
  /** Object type at this path */
  type: 'blob' | 'tree' | 'commit'
}

/**
 * Remote configuration.
 *
 * @description
 * Configuration for a remote repository including URL and refspecs.
 */
export interface Remote {
  /** Remote name */
  name: string
  /** Fetch URL */
  url: string
  /** Push URL (if different from fetch) */
  pushUrl?: string
  /** Fetch refspecs */
  fetchRefspecs: string[]
  /** Push refspecs */
  pushRefspecs: string[]
}
