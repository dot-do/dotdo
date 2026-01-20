/**
 * gitx - Git Extended Primitive with AI Assistance
 *
 * Provides Git operations that integrate with the WorkflowContext ($) pattern
 * and can leverage AI for intelligent Git operations like commit message generation,
 * code review, and conflict resolution.
 *
 * @packageDocumentation
 */

import type { WorkflowContext } from '../context.js'
import { createLogger } from '../../utils/logger'

const logger = createLogger('[gitx]')

// ============================================================================
// AI PROMISE TYPES (inline to avoid cross-package imports)
// ============================================================================

/**
 * Metadata for AI operations
 */
export interface AIMeta {
  model?: string
  temperature?: number
  tokens?: { input: number; output: number }
  cost?: number
  duration?: number
}

/**
 * Enhanced Promise with AI metadata and chainable methods
 */
export interface AIPromise<T> extends Promise<T> {
  readonly $meta: AIMeta
  with(options: Partial<AIMeta>): AIPromise<T>
  pipe<U>(fn: (value: T) => U | Promise<U>): AIPromise<U>
}

/**
 * Create an AIPromise wrapper
 */
function createAIPromise<T>(
  executor: (meta: AIMeta) => Promise<T>,
  initialMeta: AIMeta = {}
): AIPromise<T> {
  const meta: AIMeta = { ...initialMeta }
  const basePromise = executor(meta)
  const aiPromise = basePromise as AIPromise<T>

  Object.defineProperty(aiPromise, '$meta', {
    get: () => meta,
    enumerable: true
  })

  Object.defineProperty(aiPromise, 'with', {
    value: (options: Partial<AIMeta>) => {
      return createAIPromise(executor, { ...meta, ...options })
    },
    enumerable: true
  })

  Object.defineProperty(aiPromise, 'pipe', {
    value: function <U>(fn: (value: T) => U | Promise<U>): AIPromise<U> {
      return createAIPromise<U>(
        async (pipeMeta) => {
          const result = await basePromise
          Object.assign(pipeMeta, meta)
          return await fn(result)
        },
        { ...meta }
      )
    },
    enumerable: true
  })

  return aiPromise
}

/**
 * Create initial meta with optional model (handles exactOptionalPropertyTypes)
 */
function createInitialMeta(model?: string): AIMeta {
  if (model !== undefined) {
    return { model }
  }
  return {}
}

// ============================================================================
// TYPES
// ============================================================================

/**
 * Git commit information
 */
export interface Commit {
  /** Commit SHA hash */
  sha: string
  /** Short SHA (first 7 characters) */
  shortSha: string
  /** Commit message (first line) */
  message: string
  /** Full commit message */
  body?: string
  /** Author name */
  author: string
  /** Author email */
  authorEmail: string
  /** Commit timestamp */
  date: Date
  /** Parent commit SHAs */
  parents: string[]
}

/**
 * Git branch information
 */
export interface Branch {
  /** Branch name */
  name: string
  /** Whether this is the current branch */
  current: boolean
  /** Commit SHA the branch points to */
  sha: string
  /** Remote tracking branch (if any) */
  upstream?: string
  /** Commits ahead of upstream */
  ahead?: number
  /** Commits behind upstream */
  behind?: number
}

/**
 * Git file status
 */
export interface FileStatus {
  /** File path */
  path: string
  /** Status in working tree */
  workingTree: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'ignored' | null
  /** Status in staging area */
  staging: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | null
  /** Original path (for renames) */
  originalPath?: string
}

/**
 * Git repository status
 */
export interface RepoStatus {
  /** Current branch name */
  branch: string
  /** Detached HEAD commit (if detached) */
  detachedHead?: string
  /** Files with changes */
  files: FileStatus[]
  /** Whether there are staged changes */
  hasStaged: boolean
  /** Whether there are unstaged changes */
  hasUnstaged: boolean
  /** Whether there are untracked files */
  hasUntracked: boolean
  /** Whether in merge state */
  merging: boolean
  /** Whether in rebase state */
  rebasing: boolean
  /** Commits ahead of upstream */
  ahead: number
  /** Commits behind upstream */
  behind: number
}

/**
 * Git diff information
 */
export interface DiffInfo {
  /** File path */
  path: string
  /** Lines added */
  additions: number
  /** Lines deleted */
  deletions: number
  /** Whether file is binary */
  binary: boolean
  /** Diff hunks */
  hunks: DiffHunk[]
}

/**
 * A diff hunk (section of changes)
 */
export interface DiffHunk {
  /** Starting line in old file */
  oldStart: number
  /** Number of lines in old file */
  oldLines: number
  /** Starting line in new file */
  newStart: number
  /** Number of lines in new file */
  newLines: number
  /** Hunk header */
  header: string
  /** Lines in the hunk */
  lines: DiffLine[]
}

/**
 * A line in a diff
 */
export interface DiffLine {
  /** Line type */
  type: 'context' | 'addition' | 'deletion'
  /** Line content */
  content: string
  /** Line number in old file */
  oldLineNumber?: number
  /** Line number in new file */
  newLineNumber?: number
}

/**
 * Options for commit operations
 */
export interface CommitOptions {
  /** Commit message */
  message?: string
  /** Amend the previous commit */
  amend?: boolean
  /** Author string (Name <email>) */
  author?: string
  /** Allow empty commit */
  allowEmpty?: boolean
  /** Sign commit with GPG */
  sign?: boolean
  /** Skip pre-commit hooks */
  noVerify?: boolean
}

/**
 * Options for branch operations
 */
export interface BranchOptions {
  /** Create from specific commit */
  from?: string
  /** Track remote branch */
  track?: string
  /** Force create/delete */
  force?: boolean
}

/**
 * Options for merge operations
 */
export interface MergeOptions {
  /** Commit message for merge */
  message?: string
  /** Fast-forward preference */
  fastForward?: 'only' | 'never' | 'auto'
  /** Strategy to use */
  strategy?: 'recursive' | 'ours' | 'theirs' | 'octopus'
  /** Squash commits */
  squash?: boolean
}

/**
 * Options for AI-assisted operations
 */
export interface AIGitOptions {
  /** AI model to use */
  model?: string
  /** Additional context for AI */
  context?: string
  /** Whether to require confirmation */
  confirm?: boolean
  /** Style preferences */
  style?: {
    /** Commit message style */
    commitStyle?: 'conventional' | 'angular' | 'simple' | 'semantic'
    /** Maximum commit message length */
    maxLength?: number
    /** Include emoji in messages */
    emoji?: boolean
  }
}

/**
 * AI-generated commit message result
 */
export interface AICommitMessage {
  /** Generated commit message */
  message: string
  /** Message body (detailed description) */
  body?: string
  /** Confidence score (0-1) */
  confidence: number
  /** Type classification (feat, fix, etc.) */
  type?: string
  /** Scope of changes */
  scope?: string
  /** Alternative messages */
  alternatives?: string[]
}

/**
 * AI code review result
 */
export interface AIReviewResult {
  /** Overall assessment */
  summary: string
  /** Confidence score (0-1) */
  confidence: number
  /** Issues found */
  issues: Array<{
    path: string
    line?: number
    severity: 'error' | 'warning' | 'info'
    message: string
    suggestion?: string
  }>
  /** Positive aspects */
  strengths: string[]
  /** Suggested improvements */
  suggestions: string[]
}

// ============================================================================
// GITX CLASS
// ============================================================================

/**
 * Extended Git primitive that integrates with WorkflowContext
 *
 * @example
 * ```typescript
 * const git = createGitX($)
 *
 * // Check status
 * const status = await git.status()
 *
 * // AI-generated commit message
 * const message = await git.generateCommitMessage()
 * await git.commit({ message: message.message })
 *
 * // AI code review
 * const review = await git.review('feature-branch')
 * ```
 */
export class GitX {
  private $: WorkflowContext
  private repoPath: string

  constructor(context: WorkflowContext, repoPath: string = '.') {
    this.$ = context
    this.repoPath = repoPath
  }

  // ==========================================================================
  // CORE GIT OPERATIONS
  // ==========================================================================

  /**
   * Get repository status
   *
   * @returns Current repository status
   *
   * @example
   * ```typescript
   * const status = await git.status()
   * if (status.hasStaged) {
   *   console.log('Ready to commit')
   * }
   * ```
   */
  async status(): Promise<RepoStatus> {
    this.$.send({
      type: 'Git.status',
      payload: { repo: this.repoPath }
    })

    return this.$.try(async () => {
      // Implementation would run actual git commands
      return {
        branch: 'main',
        files: [],
        hasStaged: false,
        hasUnstaged: false,
        hasUntracked: false,
        merging: false,
        rebasing: false,
        ahead: 0,
        behind: 0
      }
    })
  }

  /**
   * Stage files for commit
   *
   * @param paths - File paths to stage (use '.' for all)
   *
   * @example
   * ```typescript
   * await git.add('.')
   * await git.add(['src/index.ts', 'package.json'])
   * ```
   */
  async add(paths: string | string[]): Promise<void> {
    const pathList = Array.isArray(paths) ? paths : [paths]

    this.$.send({
      type: 'Git.add',
      payload: { paths: pathList }
    })

    return this.$.do(async () => {
      logger.debug(`add: ${pathList.join(', ')}`)
    })
  }

  /**
   * Unstage files
   *
   * @param paths - File paths to unstage
   *
   * @example
   * ```typescript
   * await git.unstage('secrets.json')
   * ```
   */
  async unstage(paths: string | string[]): Promise<void> {
    const pathList = Array.isArray(paths) ? paths : [paths]

    this.$.send({
      type: 'Git.unstage',
      payload: { paths: pathList }
    })

    return this.$.do(async () => {
      logger.debug(`unstage: ${pathList.join(', ')}`)
    })
  }

  /**
   * Create a commit
   *
   * @param options - Commit options
   * @returns The created commit
   *
   * @example
   * ```typescript
   * const commit = await git.commit({ message: 'feat: add new feature' })
   * console.log(`Created commit ${commit.shortSha}`)
   * ```
   */
  async commit(options: CommitOptions): Promise<Commit> {
    this.$.send({
      type: 'Git.commit',
      payload: { message: options.message, amend: options.amend }
    })

    return this.$.do(async () => {
      const now = new Date()
      return {
        sha: 'abc1234567890',
        shortSha: 'abc1234',
        message: options.message ?? '',
        author: 'User',
        authorEmail: 'user@example.com',
        date: now,
        parents: []
      }
    })
  }

  /**
   * Push commits to remote
   *
   * @param remote - Remote name (default: 'origin')
   * @param branch - Branch to push (default: current branch)
   * @param options - Push options
   *
   * @example
   * ```typescript
   * await git.push()
   * await git.push('origin', 'feature-branch', { force: true })
   * ```
   */
  async push(
    remote: string = 'origin',
    branch?: string,
    options?: { force?: boolean; setUpstream?: boolean; tags?: boolean }
  ): Promise<void> {
    this.$.send({
      type: 'Git.push',
      payload: { remote, branch, options }
    })

    return this.$.do(async () => {
      logger.debug(`push: ${remote} ${branch ?? ''}`)
    })
  }

  /**
   * Pull commits from remote
   *
   * @param remote - Remote name (default: 'origin')
   * @param branch - Branch to pull (default: current branch)
   * @param options - Pull options
   *
   * @example
   * ```typescript
   * await git.pull()
   * await git.pull('origin', 'main', { rebase: true })
   * ```
   */
  async pull(
    remote: string = 'origin',
    branch?: string,
    options?: { rebase?: boolean; autostash?: boolean }
  ): Promise<void> {
    this.$.send({
      type: 'Git.pull',
      payload: { remote, branch, options }
    })

    return this.$.do(async () => {
      logger.debug(`pull: ${remote} ${branch ?? ''}`)
    })
  }

  /**
   * Fetch from remote
   *
   * @param remote - Remote name (default: 'origin')
   * @param options - Fetch options
   *
   * @example
   * ```typescript
   * await git.fetch()
   * await git.fetch('origin', { prune: true, all: true })
   * ```
   */
  async fetch(
    remote: string = 'origin',
    options?: { prune?: boolean; all?: boolean; tags?: boolean }
  ): Promise<void> {
    this.$.send({
      type: 'Git.fetch',
      payload: { remote, options }
    })

    return this.$.try(async () => {
      logger.debug(`fetch: ${remote}`)
    })
  }

  /**
   * Create or checkout a branch
   *
   * @param name - Branch name
   * @param options - Branch options
   *
   * @example
   * ```typescript
   * await git.branch('feature/new-feature')
   * await git.branch('hotfix', { from: 'main' })
   * ```
   */
  async branch(name: string, options?: BranchOptions): Promise<Branch> {
    this.$.send({
      type: 'Git.branch',
      payload: { name, options }
    })

    return this.$.do(async () => {
      return {
        name,
        current: true,
        sha: 'abc1234567890'
      }
    })
  }

  /**
   * List branches
   *
   * @param options - List options
   * @returns List of branches
   *
   * @example
   * ```typescript
   * const branches = await git.branches()
   * const remoteBranches = await git.branches({ remote: true })
   * ```
   */
  async branches(options?: { remote?: boolean; all?: boolean }): Promise<Branch[]> {
    this.$.send({
      type: 'Git.branches',
      payload: { options }
    })

    return this.$.try(async () => {
      return []
    })
  }

  /**
   * Checkout a branch, commit, or file
   *
   * @param target - Branch name, commit SHA, or file path
   * @param options - Checkout options
   *
   * @example
   * ```typescript
   * await git.checkout('main')
   * await git.checkout('feature-branch', { create: true })
   * ```
   */
  async checkout(target: string, options?: { create?: boolean; force?: boolean }): Promise<void> {
    this.$.send({
      type: 'Git.checkout',
      payload: { target, options }
    })

    return this.$.do(async () => {
      logger.debug(`checkout: ${target}`)
    })
  }

  /**
   * Merge a branch into current branch
   *
   * @param branch - Branch to merge
   * @param options - Merge options
   *
   * @example
   * ```typescript
   * await git.merge('feature-branch')
   * await git.merge('main', { squash: true })
   * ```
   */
  async merge(branch: string, options?: MergeOptions): Promise<void> {
    this.$.send({
      type: 'Git.merge',
      payload: { branch, options }
    })

    return this.$.do(async () => {
      logger.debug(`merge: ${branch}`)
    })
  }

  /**
   * Get diff of changes
   *
   * @param options - Diff options
   * @returns Diff information
   *
   * @example
   * ```typescript
   * const diff = await git.diff() // Unstaged changes
   * const stagedDiff = await git.diff({ staged: true })
   * const branchDiff = await git.diff({ from: 'main', to: 'feature' })
   * ```
   */
  async diff(options?: {
    staged?: boolean
    from?: string
    to?: string
    paths?: string[]
  }): Promise<DiffInfo[]> {
    this.$.send({
      type: 'Git.diff',
      payload: { options }
    })

    return this.$.try(async () => {
      return []
    })
  }

  /**
   * Get commit history
   *
   * @param options - Log options
   * @returns List of commits
   *
   * @example
   * ```typescript
   * const history = await git.log({ limit: 10 })
   * const fileHistory = await git.log({ path: 'src/index.ts' })
   * ```
   */
  async log(options?: {
    limit?: number
    from?: string
    to?: string
    path?: string
    author?: string
  }): Promise<Commit[]> {
    this.$.send({
      type: 'Git.log',
      payload: { options }
    })

    return this.$.try(async () => {
      return []
    })
  }

  /**
   * Stash changes
   *
   * @param message - Optional stash message
   *
   * @example
   * ```typescript
   * await git.stash('WIP: feature implementation')
   * ```
   */
  async stash(message?: string): Promise<void> {
    this.$.send({
      type: 'Git.stash',
      payload: { message }
    })

    return this.$.do(async () => {
      logger.debug(`stash: ${message ?? 'WIP'}`)
    })
  }

  /**
   * Apply and drop the latest stash
   *
   * @example
   * ```typescript
   * await git.stashPop()
   * ```
   */
  async stashPop(): Promise<void> {
    this.$.send({
      type: 'Git.stashPop',
      payload: {}
    })

    return this.$.do(async () => {
      logger.debug('stashPop')
    })
  }

  // ==========================================================================
  // AI-ASSISTED OPERATIONS
  // ==========================================================================

  /**
   * Generate a commit message using AI based on staged changes
   *
   * @param options - AI options
   * @returns Generated commit message
   *
   * @example
   * ```typescript
   * const msg = await git.generateCommitMessage({
   *   style: { commitStyle: 'conventional', emoji: true }
   * })
   * console.log(msg.message) // "feat(auth): Add OAuth2 support"
   * ```
   */
  generateCommitMessage(options?: AIGitOptions): AIPromise<AICommitMessage> {
    this.$.send({
      type: 'Git.generateCommitMessage',
      payload: { options }
    })

    return createAIPromise(async (meta) => {
      meta.model = options?.model ?? 'default'

      // Get the staged diff for AI analysis
      await this.diff({ staged: true })

      // AI would analyze the diff and generate a message
      return {
        message: 'feat: implement new feature',
        body: 'Detailed description of changes',
        confidence: 0.9,
        type: 'feat',
        alternatives: [
          'feat: add new functionality',
          'feat(core): implement feature'
        ]
      }
    }, createInitialMeta(options?.model))
  }

  /**
   * Review changes using AI
   *
   * @param ref - Branch, commit, or diff reference to review
   * @param options - AI options
   * @returns Review results
   *
   * @example
   * ```typescript
   * const review = await git.review('feature-branch')
   * console.log(review.summary)
   * for (const issue of review.issues) {
   *   console.log(`${issue.path}:${issue.line} - ${issue.message}`)
   * }
   * ```
   */
  review(ref?: string, options?: AIGitOptions): AIPromise<AIReviewResult> {
    this.$.send({
      type: 'Git.review',
      payload: { ref, options }
    })

    return createAIPromise(async (meta) => {
      meta.model = options?.model ?? 'default'

      // Get diff for AI review
      if (ref) {
        await this.diff({ from: 'main', to: ref })
      } else {
        await this.diff({ staged: true })
      }

      // AI would analyze the code changes
      return {
        summary: 'Code review completed',
        confidence: 0.85,
        issues: [],
        strengths: ['Good code organization'],
        suggestions: ['Consider adding more tests']
      }
    }, createInitialMeta(options?.model))
  }

  /**
   * Get AI suggestions for resolving merge conflicts
   *
   * @param paths - Paths with conflicts (or all if not specified)
   * @param options - AI options
   * @returns Conflict resolution suggestions
   *
   * @example
   * ```typescript
   * const resolutions = await git.resolveConflicts()
   * for (const resolution of resolutions) {
   *   console.log(`${resolution.path}: ${resolution.suggestion}`)
   * }
   * ```
   */
  resolveConflicts(
    paths?: string[],
    options?: AIGitOptions
  ): AIPromise<Array<{
    path: string
    suggestion: string
    resolvedContent: string
    confidence: number
    reasoning: string
  }>> {
    this.$.send({
      type: 'Git.resolveConflicts',
      payload: { paths, options }
    })

    return createAIPromise(async (meta) => {
      meta.model = options?.model ?? 'default'

      // AI would analyze conflicts and suggest resolutions
      return []
    }, createInitialMeta(options?.model))
  }

  /**
   * Generate a changelog from commits
   *
   * @param options - Changelog options
   * @returns Generated changelog
   *
   * @example
   * ```typescript
   * const changelog = await git.generateChangelog({
   *   from: 'v1.0.0',
   *   to: 'v1.1.0'
   * })
   * ```
   */
  generateChangelog(options?: {
    from?: string
    to?: string
    format?: 'markdown' | 'json' | 'keep-a-changelog'
  } & AIGitOptions): AIPromise<string> {
    this.$.send({
      type: 'Git.generateChangelog',
      payload: { options }
    })

    return createAIPromise(async (meta) => {
      meta.model = options?.model ?? 'default'

      // Get commits in range (conditionally add properties for exactOptionalPropertyTypes)
      const logOptions: Parameters<typeof this.log>[0] = {}
      if (options?.from !== undefined) logOptions.from = options.from
      if (options?.to !== undefined) logOptions.to = options.to
      await this.log(logOptions)

      // AI would generate a formatted changelog
      return '# Changelog\n\n## Changes\n\n- Feature 1\n- Feature 2'
    }, createInitialMeta(options?.model))
  }

  /**
   * Explain a commit or diff in plain language
   *
   * @param ref - Commit SHA or diff reference
   * @param options - AI options
   * @returns Plain language explanation
   *
   * @example
   * ```typescript
   * const explanation = await git.explain('abc1234')
   * console.log(explanation)
   * ```
   */
  explain(ref: string, options?: AIGitOptions): AIPromise<string> {
    this.$.send({
      type: 'Git.explain',
      payload: { ref, options }
    })

    return createAIPromise(async (meta) => {
      meta.model = options?.model ?? 'default'

      // AI would analyze and explain the changes
      return `This commit ${ref} makes the following changes...`
    }, createInitialMeta(options?.model))
  }

  /**
   * Suggest branches to clean up (merged, stale, etc.)
   *
   * @param options - AI options
   * @returns Branches recommended for deletion
   *
   * @example
   * ```typescript
   * const toDelete = await git.suggestCleanup()
   * for (const branch of toDelete) {
   *   console.log(`${branch.name}: ${branch.reason}`)
   * }
   * ```
   */
  suggestCleanup(options?: AIGitOptions): AIPromise<Array<{
    name: string
    reason: string
    confidence: number
    lastActivity: Date
  }>> {
    this.$.send({
      type: 'Git.suggestCleanup',
      payload: { options }
    })

    return createAIPromise(async (meta) => {
      meta.model = options?.model ?? 'default'

      // AI would analyze branches and suggest cleanup
      return []
    }, createInitialMeta(options?.model))
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a GitX instance bound to a WorkflowContext
 *
 * @param context - The WorkflowContext ($) to bind to
 * @param repoPath - Path to the repository (default: current directory)
 * @returns GitX instance
 *
 * @example
 * ```typescript
 * import { createGitX } from '@dotdo/do/primitives/gitx'
 *
 * // In a DO method
 * const git = createGitX($)
 * const status = await git.status()
 * ```
 */
export function createGitX(context: WorkflowContext, repoPath?: string): GitX {
  return new GitX(context, repoPath)
}

/**
 * Standalone Git operations without WorkflowContext binding
 */
export const gitx = {
  /**
   * Get status of a repository
   */
  status: async (_repoPath: string = '.'): Promise<RepoStatus> => {
    return {
      branch: 'main',
      files: [],
      hasStaged: false,
      hasUnstaged: false,
      hasUntracked: false,
      merging: false,
      rebasing: false,
      ahead: 0,
      behind: 0
    }
  }
}
