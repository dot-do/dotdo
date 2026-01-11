/**
 * GitOpsDO - Zero-VM Git Operations
 *
 * Demonstrates gitx (Git on R2) - full git operations running in a V8 isolate.
 * No containers, no SSH, no VMs. Just JavaScript and object storage.
 *
 * How it works:
 * - Git objects (blobs, trees, commits) stored in R2 with content-addressable keys
 * - Refs (branches, tags) stored in DO SQLite for consistency
 * - Working tree managed via fsx (filesystem on SQLite)
 * - Push/pull via smart HTTP protocol over fetch()
 *
 * Core Operations:
 * - init/clone - Initialize or clone repositories
 * - add/commit - Stage and commit changes
 * - branch/checkout/merge - Branch management
 * - push/pull/sync - Remote synchronization
 * - log/diff/status - Repository inspection
 */

// Import DO with both fs and git capabilities pre-composed
import { DO } from 'dotdo/git'
import type { Env as BaseEnv } from 'dotdo'

// ============================================================================
// Types
// ============================================================================

interface Env extends BaseEnv {
  R2_BUCKET: R2Bucket
  GITHUB_TOKEN?: string
  GITHUB_API_URL: string
}

interface FileChange {
  path: string
  content: string
  mode?: 'add' | 'modify' | 'delete'
}

interface PROptions {
  title: string
  body?: string
  base?: string
  head: string
  draft?: boolean
  labels?: string[]
}

interface PRResult {
  number: number
  url: string
  html_url: string
  state: 'open' | 'closed' | 'merged'
}

interface DeploymentResult {
  success: boolean
  branch: string
  commit?: string
  pr?: PRResult
  error?: string
}

interface SyncForkResult {
  success: boolean
  commits: number
  message: string
}

interface CodeReviewResult {
  approved: boolean
  comments: Array<{
    path: string
    line: number
    message: string
    severity: 'error' | 'warning' | 'info'
  }>
  summary: string
}

interface GitStatus {
  branch: string
  head?: string
  staged: string[]
  unstaged: string[]
  untracked: string[]
  clean: boolean
}

interface CommitInfo {
  hash: string
  message: string
  author: string
  date: Date
}

interface BranchInfo {
  name: string
  current: boolean
  commit: string
}

interface MergeResult {
  success: boolean
  commit?: string
  conflicts: string[]
  message: string
}

// ============================================================================
// GitOpsDO Class
// ============================================================================

/**
 * Durable Object with full git capability.
 *
 * Extends DO with filesystem (fsx) and git (gitx) primitives.
 * All operations run in a V8 isolate - no containers, no VMs.
 *
 * The DO from 'dotdo/git' already includes both $.fs and $.git capabilities.
 */
export class GitOpsDO extends DO<Env> {
  static readonly $type = 'GitOpsDO'

  // ──────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Initialize git configuration on DO startup.
   */
  async onStart() {
    // Configure git with R2 object storage
    this.$.git.configure({
      repo: 'dotdo/examples',
      branch: 'main',
      r2: this.env.R2_BUCKET,
      fs: this.$.fs,
    })
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Core Git Operations
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Initialize a new repository.
   *
   * Creates the git object store in R2 and sets up refs.
   *
   * @example
   * ```typescript
   * const result = await gitOps.initRepository()
   * // { success: true, message: 'Repository initialized' }
   * ```
   */
  async initRepository(): Promise<{ success: boolean; message: string }> {
    try {
      await this.$.git.init()
      return { success: true, message: 'Repository initialized' }
    } catch (error) {
      return {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Clone a repository from URL.
   *
   * Fetches objects via smart HTTP protocol and sets up working tree.
   *
   * @example
   * ```typescript
   * const result = await gitOps.cloneRepository('https://github.com/org/repo', 'main')
   * // { success: true, branch: 'main', commit: 'abc123...' }
   * ```
   */
  async cloneRepository(
    url: string,
    branch?: string
  ): Promise<{ success: boolean; branch?: string; commit?: string; error?: string }> {
    try {
      await this.$.git.clone(url, { branch })
      const status = await this.$.git.status()
      return {
        success: true,
        branch: status.branch,
        commit: status.head,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Get repository status.
   *
   * Shows staged, unstaged, and untracked files.
   *
   * @example
   * ```typescript
   * const status = await gitOps.getStatus()
   * // { branch: 'main', head: 'abc123', staged: [], unstaged: ['src/index.ts'], ... }
   * ```
   */
  async getStatus(): Promise<GitStatus> {
    const status = await this.$.git.status()
    return {
      branch: status.branch,
      head: status.head,
      staged: status.staged ?? [],
      unstaged: status.unstaged ?? [],
      untracked: status.untracked ?? [],
      clean: status.clean,
    }
  }

  /**
   * Stage files for commit.
   *
   * @example
   * ```typescript
   * // Stage specific files
   * await gitOps.stageFiles(['src/index.ts', 'README.md'])
   *
   * // Stage all changes
   * await gitOps.stageFiles('.')
   * ```
   */
  async stageFiles(
    paths: string | string[]
  ): Promise<{ success: boolean; staged: string[] }> {
    try {
      await this.$.git.add(paths)
      const status = await this.$.git.status()
      return { success: true, staged: status.staged ?? [] }
    } catch (error) {
      return { success: false, staged: [] }
    }
  }

  /**
   * Create a commit.
   *
   * @example
   * ```typescript
   * const result = await gitOps.createCommit('feat: add new feature')
   * // { success: true, hash: 'abc123...' }
   * ```
   */
  async createCommit(
    message: string,
    author?: string
  ): Promise<{ success: boolean; hash?: string; error?: string }> {
    try {
      const result = await this.$.git.commit(message, { author })
      return { success: true, hash: result.hash }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Get commit history.
   *
   * @example
   * ```typescript
   * const log = await gitOps.getLog(10)
   * // [{ hash: 'abc123', message: 'feat: ...', author: '...', date: Date }]
   * ```
   */
  async getLog(limit: number = 20): Promise<CommitInfo[]> {
    const commits = await this.$.git.log({ limit })
    return commits.map((c) => ({
      hash: c.hash,
      message: c.message,
      author: c.author,
      date: c.date,
    }))
  }

  /**
   * Get diff between refs or working tree changes.
   *
   * @example
   * ```typescript
   * // Working tree changes
   * const diff = await gitOps.getDiff()
   *
   * // Diff between refs
   * const diff = await gitOps.getDiff('main', 'feature-branch')
   * ```
   */
  async getDiff(
    from?: string,
    to?: string
  ): Promise<{ diff: string; files: string[] }> {
    const diff = from && to
      ? await this.$.git.diff(from, to)
      : await this.$.git.diff()

    // Parse diff to extract file names
    const filePattern = /^diff --git a\/(.+) b\//gm
    const files: string[] = []
    let match: RegExpExecArray | null
    while ((match = filePattern.exec(diff)) !== null) {
      files.push(match[1])
    }

    return { diff, files }
  }

  /**
   * List all branches.
   *
   * @example
   * ```typescript
   * const branches = await gitOps.listBranches()
   * // [{ name: 'main', current: true, commit: 'abc123' }, ...]
   * ```
   */
  async listBranches(): Promise<BranchInfo[]> {
    const branches = await this.$.git.branches()
    const status = await this.$.git.status()
    const currentBranch = status.branch

    return branches.map((name) => ({
      name,
      current: name === currentBranch,
      commit: '', // Would need to resolve ref to get commit
    }))
  }

  /**
   * Switch or create a branch.
   *
   * @example
   * ```typescript
   * // Switch to existing branch
   * await gitOps.checkoutBranch('feature-auth')
   *
   * // Create and switch
   * await gitOps.checkoutBranch('feature-new', true)
   * ```
   */
  async checkoutBranch(
    branch: string,
    create?: boolean
  ): Promise<{ success: boolean; branch: string; error?: string }> {
    try {
      await this.$.git.checkout(branch, { create })
      return { success: true, branch }
    } catch (error) {
      return {
        success: false,
        branch,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Merge a branch into current.
   *
   * @example
   * ```typescript
   * const result = await gitOps.mergeBranch('feature-auth')
   * // { success: true, commit: 'abc123', conflicts: [], message: 'Merged' }
   * ```
   */
  async mergeBranch(branch: string): Promise<MergeResult> {
    try {
      const result = await this.$.git.merge(branch)
      return {
        success: result.conflicts.length === 0,
        commit: result.commit,
        conflicts: result.conflicts.map((c) => c.path),
        message: result.conflicts.length > 0
          ? `Merge has ${result.conflicts.length} conflict(s)`
          : 'Merge successful',
      }
    } catch (error) {
      return {
        success: false,
        conflicts: [],
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Sync (pull) from R2.
   *
   * @example
   * ```typescript
   * const result = await gitOps.syncFromRemote()
   * // { success: true, objectsFetched: 5, commit: 'abc123' }
   * ```
   */
  async syncFromRemote(): Promise<{
    success: boolean
    objectsFetched?: number
    commit?: string
    error?: string
  }> {
    try {
      const result = await this.$.git.sync()
      return {
        success: result.success,
        objectsFetched: result.objectsFetched,
        commit: result.commit,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Push to R2.
   *
   * @example
   * ```typescript
   * const result = await gitOps.pushToRemote()
   * // { success: true, objectsPushed: 3, commit: 'abc123' }
   * ```
   */
  async pushToRemote(): Promise<{
    success: boolean
    objectsPushed?: number
    commit?: string
    error?: string
  }> {
    try {
      const result = await this.$.git.push()
      return {
        success: result.success,
        objectsPushed: result.objectsPushed,
        commit: result.commit,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // File Operations (via fsx)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Read a file from the working tree.
   */
  async readFile(path: string): Promise<{ content: string } | { error: string }> {
    try {
      const content = await this.$.fs.read(path, { encoding: 'utf-8' })
      return { content }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * Write a file to the working tree.
   */
  async writeFile(
    path: string,
    content: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Ensure parent directory exists
      const parentDir = path.split('/').slice(0, -1).join('/')
      if (parentDir) {
        await this.$.fs.mkdir(parentDir, { recursive: true })
      }
      await this.$.fs.write(path, content)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * Delete a file from the working tree.
   */
  async deleteFile(path: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this.$.fs.rm(path)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  /**
   * List directory tree.
   */
  async listTree(path: string = '/'): Promise<{ entries: string[] }> {
    try {
      const entries = await this.$.fs.list(path)
      return { entries }
    } catch {
      return { entries: [] }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Feature Deployment Workflow
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Deploy a feature branch with file changes.
   *
   * This is the hero example: clone, branch, edit, commit, push, create PR.
   * All running in a V8 isolate without containers or VMs.
   *
   * @example
   * ```typescript
   * const result = await gitOps.deployFeature('dark-mode', [
   *   { path: 'src/theme.ts', content: 'export const dark = {...}' },
   *   { path: 'src/App.tsx', content: '...' }
   * ])
   * console.log(result.pr?.html_url) // https://github.com/org/repo/pull/42
   * ```
   */
  async deployFeature(
    featureName: string,
    changes: FileChange[]
  ): Promise<DeploymentResult> {
    try {
      // Initialize repository if needed
      await this.$.git.init()

      // Sync from remote (fetch latest objects from R2)
      const syncResult = await this.$.git.sync()
      if (!syncResult.success) {
        return {
          success: false,
          branch: `feature/${featureName}`,
          error: `Sync failed: ${syncResult.error}`,
        }
      }

      // Apply file changes via fsx
      for (const change of changes) {
        if (change.mode === 'delete') {
          await this.$.fs.rm(change.path)
        } else {
          // Ensure parent directory exists
          const parentDir = change.path.split('/').slice(0, -1).join('/')
          if (parentDir) {
            await this.$.fs.mkdir(parentDir, { recursive: true })
          }
          await this.$.fs.write(change.path, change.content)
        }
      }

      // Stage all changes
      await this.$.git.add('.')

      // Check status
      const status = await this.$.git.status()
      if (status.clean) {
        return {
          success: true,
          branch: `feature/${featureName}`,
          commit: status.head,
          error: 'No changes to commit',
        }
      }

      // Commit changes
      const commitResult = await this.$.git.commit(`feat: ${featureName}`)

      // Push to remote (R2 object store)
      const pushResult = await this.$.git.push()
      if (!pushResult.success) {
        return {
          success: false,
          branch: `feature/${featureName}`,
          commit: commitResult.hash,
          error: `Push failed: ${pushResult.error}`,
        }
      }

      // Create pull request via GitHub API
      const pr = await this.createPR({
        title: `Feature: ${featureName}`,
        body: this.generatePRDescription(featureName, changes),
        base: 'main',
        head: `feature/${featureName}`,
      })

      return {
        success: true,
        branch: `feature/${featureName}`,
        commit: commitResult.hash,
        pr,
      }
    } catch (error) {
      return {
        success: false,
        branch: `feature/${featureName}`,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CI/CD Integration Patterns
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Run automated code review on a PR.
   *
   * Fetches the PR diff, analyzes changes, and posts review comments.
   * Demonstrates git diff integration and GitHub API usage.
   */
  async reviewPR(prNumber: number): Promise<CodeReviewResult> {
    // Get PR details from GitHub API
    const pr = await this.fetchGitHubAPI<{
      head: { sha: string; ref: string }
      base: { sha: string; ref: string }
    }>(`/pulls/${prNumber}`)

    // Sync to get both commits
    await this.$.git.sync()

    // Get the diff between base and head
    const diff = await this.$.git.diff(pr.base.sha, pr.head.sha)

    // Analyze the diff (simplified - in production use an AI agent)
    const comments = this.analyzeCode(diff)

    // Post review to GitHub
    if (this.env.GITHUB_TOKEN) {
      await this.postReview(prNumber, comments)
    }

    return {
      approved: comments.filter((c) => c.severity === 'error').length === 0,
      comments,
      summary: this.generateReviewSummary(comments),
    }
  }

  /**
   * Auto-merge PR after checks pass.
   *
   * Demonstrates the merge workflow without needing git CLI.
   */
  async autoMerge(prNumber: number): Promise<{ success: boolean; message: string }> {
    // Check if PR is mergeable
    const pr = await this.fetchGitHubAPI<{
      mergeable: boolean
      mergeable_state: string
      merged: boolean
    }>(`/pulls/${prNumber}`)

    if (pr.merged) {
      return { success: true, message: 'Already merged' }
    }

    if (!pr.mergeable) {
      return { success: false, message: `Not mergeable: ${pr.mergeable_state}` }
    }

    // Perform merge via GitHub API
    const result = await this.fetchGitHubAPI<{ merged: boolean; message: string }>(
      `/pulls/${prNumber}/merge`,
      {
        method: 'PUT',
        body: JSON.stringify({
          merge_method: 'squash',
          commit_title: `Merge PR #${prNumber}`,
        }),
      }
    )

    return {
      success: result.merged,
      message: result.message,
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Fork Sync Pattern
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Sync a fork with its upstream repository.
   *
   * This is a common workflow that typically requires:
   * - A local git installation
   * - SSH keys or token auth
   * - A running process
   *
   * With gitx, it runs in a V8 isolate on schedule.
   */
  async syncForkWithUpstream(): Promise<SyncForkResult> {
    try {
      // Sync from upstream (configure upstream in $.git if needed)
      await this.$.git.sync()

      // Get log to count new commits
      const log = await this.$.git.log({ limit: 10 })

      // Push to origin (our fork)
      const pushResult = await this.$.git.push()

      if (!pushResult.success) {
        return {
          success: false,
          commits: 0,
          message: `Push failed: ${pushResult.error}`,
        }
      }

      return {
        success: true,
        commits: pushResult.objectsPushed,
        message: `Synced ${pushResult.objectsPushed} objects`,
      }
    } catch (error) {
      return {
        success: false,
        commits: 0,
        message: error instanceof Error ? error.message : String(error),
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Scheduled Tasks
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Schedule regular fork sync.
   *
   * In a full dotdo app, you'd register this with:
   * ```typescript
   * $.every.hour(async () => {
   *   await this.syncForkWithUpstream()
   * })
   * ```
   */
  async onScheduledSync() {
    const result = await this.syncForkWithUpstream()
    console.log(`Fork sync: ${result.message}`)
  }

  /**
   * Daily backup of repository state.
   *
   * ```typescript
   * $.every.day.at('3am')(async () => {
   *   await this.backupRepository()
   * })
   * ```
   */
  async backupRepository() {
    const status = await this.$.git.status()
    const log = await this.$.git.log({ limit: 100 })

    // Store backup metadata
    await this.$.things.create({
      $type: 'GitBackup',
      $id: new Date().toISOString(),
      branch: status.branch,
      head: status.head,
      commitCount: log.length,
      timestamp: new Date(),
    })
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Helper Methods
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Create a pull request via GitHub API.
   */
  private async createPR(options: PROptions): Promise<PRResult> {
    if (!this.env.GITHUB_TOKEN) {
      // Return mock PR for demo purposes
      return {
        number: Math.floor(Math.random() * 1000),
        url: `${this.env.GITHUB_API_URL}/repos/dotdo/examples/pulls/0`,
        html_url: 'https://github.com/dotdo/examples/pull/0',
        state: 'open',
      }
    }

    return this.fetchGitHubAPI<PRResult>('/pulls', {
      method: 'POST',
      body: JSON.stringify({
        title: options.title,
        body: options.body,
        head: options.head,
        base: options.base ?? 'main',
        draft: options.draft ?? false,
      }),
    })
  }

  /**
   * Generate PR description from changes.
   */
  private generatePRDescription(featureName: string, changes: FileChange[]): string {
    const fileList = changes
      .map((c) => `- \`${c.path}\` (${c.mode ?? 'modify'})`)
      .join('\n')

    return `## Summary

Implements ${featureName} feature.

## Changes

${fileList}

## Testing

- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual testing complete

---
*Automated PR created by GitOpsDO*`
  }

  /**
   * Analyze code diff for review comments.
   */
  private analyzeCode(diff: string): CodeReviewResult['comments'] {
    const comments: CodeReviewResult['comments'] = []

    // Simple pattern matching (in production, use an AI agent)
    const lines = diff.split('\n')
    let currentFile = ''
    let lineNumber = 0

    for (const line of lines) {
      if (line.startsWith('diff --git')) {
        const match = line.match(/b\/(.+)$/)
        currentFile = match?.[1] ?? ''
        lineNumber = 0
      } else if (line.startsWith('@@')) {
        const match = line.match(/@@ -\d+,?\d* \+(\d+)/)
        lineNumber = parseInt(match?.[1] ?? '0', 10)
      } else if (line.startsWith('+') && !line.startsWith('+++')) {
        lineNumber++

        // Check for common issues
        if (line.includes('console.log')) {
          comments.push({
            path: currentFile,
            line: lineNumber,
            message: 'Remove console.log before merging',
            severity: 'warning',
          })
        }
        if (line.includes('TODO')) {
          comments.push({
            path: currentFile,
            line: lineNumber,
            message: 'TODO found - consider addressing before merge',
            severity: 'info',
          })
        }
        if (line.includes('password') || line.includes('secret')) {
          comments.push({
            path: currentFile,
            line: lineNumber,
            message: 'Potential secret in code - verify this is safe',
            severity: 'error',
          })
        }
      } else if (!line.startsWith('-')) {
        lineNumber++
      }
    }

    return comments
  }

  /**
   * Generate review summary from comments.
   */
  private generateReviewSummary(comments: CodeReviewResult['comments']): string {
    const errors = comments.filter((c) => c.severity === 'error').length
    const warnings = comments.filter((c) => c.severity === 'warning').length
    const infos = comments.filter((c) => c.severity === 'info').length

    if (errors > 0) {
      return `Found ${errors} error(s), ${warnings} warning(s), ${infos} info(s). Please address errors before merging.`
    }
    if (warnings > 0) {
      return `Found ${warnings} warning(s), ${infos} info(s). Consider addressing warnings.`
    }
    return 'LGTM! No issues found.'
  }

  /**
   * Post review comments to GitHub.
   */
  private async postReview(
    prNumber: number,
    comments: CodeReviewResult['comments']
  ): Promise<void> {
    await this.fetchGitHubAPI(`/pulls/${prNumber}/reviews`, {
      method: 'POST',
      body: JSON.stringify({
        event: comments.some((c) => c.severity === 'error')
          ? 'REQUEST_CHANGES'
          : 'APPROVE',
        comments: comments.map((c) => ({
          path: c.path,
          line: c.line,
          body: `**${c.severity.toUpperCase()}**: ${c.message}`,
        })),
      }),
    })
  }

  /**
   * Fetch from GitHub API with authentication.
   */
  private async fetchGitHubAPI<T>(
    endpoint: string,
    options?: RequestInit
  ): Promise<T> {
    const repo = 'dotdo/examples'
    const url = `${this.env.GITHUB_API_URL}/repos/${repo}${endpoint}`

    const response = await fetch(url, {
      ...options,
      headers: {
        Accept: 'application/vnd.github.v3+json',
        Authorization: this.env.GITHUB_TOKEN
          ? `token ${this.env.GITHUB_TOKEN}`
          : '',
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    })

    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`)
    }

    return response.json()
  }
}
