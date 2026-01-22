// Git Operations Durable Object
// Demonstrates: Git primitives without servers, R2 object storage, scheduled sync
// Key patterns: $.every scheduling, file operations, simulated git workflow

import { Hono } from 'hono'
import { DO, type DOEnv, createContext } from '@dotdo/do'
import type {
  GitConfig,
  FileChange,
  CommitInfo,
  BranchInfo,
  StatusInfo,
  DeployResult,
  ReviewResult,
  ReviewComment,
  DiffEntry,
  GitFile,
  GitCommit,
  GitRef,
  GitBackup,
} from './types'

export class GitOpsDO extends DO {
  private config: GitConfig = {
    repo: 'example/repo',
    branch: 'main',
  }

  constructor(state: DurableObjectState, env: DOEnv) {
    super(state, env)
    this.$ = createContext(state, env)

    // ========================================================================
    // Scheduled Tasks
    // ========================================================================

    // Sync fork every hour
    this.$.every.hour(async () => {
      console.log('[Git] Hourly sync running...')
      // In production: sync with upstream
    })

    // Daily backup at 3am
    this.$.every.day.at('3am')(async () => {
      console.log('[Git] Daily backup running...')
      await this.createBackup()
    })

    // ========================================================================
    // Event Handlers
    // ========================================================================

    this.$.on.Git.pushed(async (event) => {
      const { branch, commit } = (event as { type: string; payload: { branch: string; commit: string } }).payload
      console.log(`[Git] Pushed to ${branch}: ${commit}`)
    })

    this.$.on.Git.merged(async (event) => {
      const { prNumber, targetBranch } = (event as { type: string; payload: { prNumber: number; targetBranch: string } }).payload
      console.log(`[Git] PR #${prNumber} merged to ${targetBranch}`)
    })

    this.$.on['*']['*'](async (event) => {
      const e = event as { type: string; payload: unknown }
      console.log(`[Audit] ${e.type}`, e.payload)
    })
  }

  private generateSha(): string {
    return Array.from({ length: 40 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join('')
  }

  private async createBackup(): Promise<void> {
    const commits = await this.things.list({ type: 'GitCommit' })
    const files = await this.things.list({ type: 'GitFile' })

    await this.things.create({
      $type: 'GitBackup',
      timestamp: new Date().toISOString(),
      branch: this.config.branch,
      commits: commits.map((c) => {
        const commit = c as unknown as GitCommit
        return {
          sha: commit.sha,
          message: commit.message,
          author: commit.author.name,
          timestamp: commit.timestamp,
          parents: commit.parents,
        }
      }),
      fileCount: files.length,
    })
  }

  protected routes(app: Hono): void {
    // ========================================================================
    // Repository Operations
    // ========================================================================

    // Initialize repository
    app.post('/init', async (c) => {
      // Create initial ref for main branch
      const refs = await this.things.list({ type: 'GitRef' })
      if (refs.length === 0) {
        await this.things.create({
          $type: 'GitRef',
          name: 'refs/heads/main',
          sha: '',
          type: 'branch',
        })
      }

      return c.json({ success: true, message: 'Repository initialized' })
    })

    // Clone (simulate)
    app.post('/clone', async (c) => {
      const { url, branch = 'main' } = await c.req.json<{
        url: string
        branch?: string
      }>()

      this.config = {
        repo: url.split('/').slice(-2).join('/').replace('.git', ''),
        branch,
      }

      // In production: fetch refs from remote
      return c.json({
        success: true,
        repo: this.config.repo,
        branch: this.config.branch,
      })
    })

    // Get status
    app.get('/status', async (c) => {
      const files = await this.things.list({ type: 'GitFile' })
      const refs = await this.things.list({ type: 'GitRef' })
      const currentRef = refs.find((r) => (r as unknown as GitRef).name === `refs/heads/${this.config.branch}`)

      const status: StatusInfo = {
        branch: this.config.branch,
        head: currentRef ? (currentRef as unknown as GitRef).sha : undefined,
        staged: [],
        unstaged: [],
        untracked: files.filter((f) => !(f as unknown as GitFile).sha).map((f) => (f as unknown as GitFile).path),
        clean: files.length === 0,
      }

      return c.json(status)
    })

    // ========================================================================
    // Staging and Commits
    // ========================================================================

    // Add files
    app.post('/add', async (c) => {
      const { paths } = await c.req.json<{ paths: string[] | string }>()
      const pathList = Array.isArray(paths) ? paths : [paths]

      // In production: stage files for commit
      return c.json({ success: true, staged: pathList })
    })

    // Commit
    app.post('/commit', async (c) => {
      const { message, author = 'Agent <agent@dotdo.dev>' } = await c.req.json<{
        message: string
        author?: string
      }>()

      const [authorName, authorEmail] = author.includes('<')
        ? [author.split('<')[0].trim(), author.split('<')[1].replace('>', '').trim()]
        : [author, 'agent@dotdo.dev']

      // Get current HEAD
      const refs = await this.things.list({ type: 'GitRef' })
      const currentRef = refs.find((r) => (r as unknown as GitRef).name === `refs/heads/${this.config.branch}`)
      const parentSha = currentRef ? (currentRef as unknown as GitRef).sha : ''

      // Create commit
      const sha = this.generateSha()
      const commit = await this.things.create({
        $type: 'GitCommit',
        sha,
        message,
        author: { name: authorName, email: authorEmail },
        timestamp: new Date().toISOString(),
        tree: this.generateSha(),
        parents: parentSha ? [parentSha] : [],
      })

      // Update ref
      if (currentRef) {
        await this.things.update(currentRef.$id, { sha })
      } else {
        await this.things.create({
          $type: 'GitRef',
          name: `refs/heads/${this.config.branch}`,
          sha,
          type: 'branch',
        })
      }

      this.$.send({
        type: 'Git.committed',
        payload: { sha, message, branch: this.config.branch },
      })

      return c.json({ success: true, commit: { sha, message } })
    })

    // Log
    app.get('/log', async (c) => {
      const limit = parseInt(c.req.query('limit') ?? '10')
      const commits = await this.things.list({ type: 'GitCommit' })

      const log = commits
        .map((c) => c as unknown as GitCommit)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, limit)
        .map((c) => ({
          sha: c.sha,
          message: c.message,
          author: `${c.author.name} <${c.author.email}>`,
          timestamp: c.timestamp,
        }))

      return c.json(log)
    })

    // Diff
    app.get('/diff', async (c) => {
      const from = c.req.query('from')
      const to = c.req.query('to')

      // Simulate diff output
      const diff: DiffEntry[] = []

      return c.json({ from, to, entries: diff })
    })

    // ========================================================================
    // Branching
    // ========================================================================

    // List branches
    app.get('/branches', async (c) => {
      const refs = await this.things.list({ type: 'GitRef' })
      const branches = refs
        .filter((r) => (r as unknown as GitRef).type === 'branch')
        .map((r) => {
          const ref = r as unknown as GitRef
          return {
            name: ref.name.replace('refs/heads/', ''),
            sha: ref.sha,
            isDefault: ref.name === 'refs/heads/main',
          }
        })

      return c.json(branches)
    })

    // Checkout
    app.post('/checkout', async (c) => {
      const { branch, create = false } = await c.req.json<{
        branch: string
        create?: boolean
      }>()

      const refs = await this.things.list({ type: 'GitRef' })
      const existingRef = refs.find((r) => (r as unknown as GitRef).name === `refs/heads/${branch}`)

      if (!existingRef && !create) {
        return c.json({ error: 'Branch not found' }, 404)
      }

      if (!existingRef && create) {
        const currentRef = refs.find((r) => (r as unknown as GitRef).name === `refs/heads/${this.config.branch}`)
        const sha = currentRef ? (currentRef as unknown as GitRef).sha : ''

        await this.things.create({
          $type: 'GitRef',
          name: `refs/heads/${branch}`,
          sha,
          type: 'branch',
        })
      }

      this.config.branch = branch

      return c.json({ success: true, branch })
    })

    // Merge
    app.post('/merge', async (c) => {
      const { branch } = await c.req.json<{ branch: string }>()

      // Simulate merge
      const sha = this.generateSha()

      this.$.send({
        type: 'Git.merged',
        payload: { sourceBranch: branch, targetBranch: this.config.branch, sha },
      })

      return c.json({ success: true, merged: branch, sha })
    })

    // ========================================================================
    // Remote Operations
    // ========================================================================

    // Sync (pull)
    app.post('/sync', async (c) => {
      // In production: fetch from remote and merge
      return c.json({ success: true, message: 'Synced with remote' })
    })

    // Push
    app.post('/push', async (c) => {
      const refs = await this.things.list({ type: 'GitRef' })
      const currentRef = refs.find((r) => (r as unknown as GitRef).name === `refs/heads/${this.config.branch}`)

      if (!currentRef) {
        return c.json({ error: 'No commits to push' }, 400)
      }

      const sha = (currentRef as unknown as GitRef).sha

      this.$.send({
        type: 'Git.pushed',
        payload: { branch: this.config.branch, commit: sha },
      })

      return c.json({ success: true, branch: this.config.branch, sha })
    })

    // ========================================================================
    // File Operations
    // ========================================================================

    // Read file
    app.get('/files/*', async (c) => {
      const path = c.req.path.replace('/files/', '')
      const files = await this.things.list({ type: 'GitFile' })
      const file = files.find((f) => (f as unknown as GitFile).path === path)

      if (!file) {
        return c.json({ error: 'File not found' }, 404)
      }

      return c.json(file)
    })

    // Write file
    app.put('/files/*', async (c) => {
      const path = c.req.path.replace('/files/', '')
      const { content } = await c.req.json<{ content: string }>()

      const files = await this.things.list({ type: 'GitFile' })
      const existingFile = files.find((f) => (f as unknown as GitFile).path === path)

      if (existingFile) {
        const updated = await this.things.update(existingFile.$id, { content })
        return c.json(updated)
      }

      const file = await this.things.create({
        $type: 'GitFile',
        path,
        content,
        mode: '100644',
      })

      return c.json(file, 201)
    })

    // Delete file
    app.delete('/files/*', async (c) => {
      const path = c.req.path.replace('/files/', '')
      const files = await this.things.list({ type: 'GitFile' })
      const file = files.find((f) => (f as unknown as GitFile).path === path)

      if (!file) {
        return c.json({ error: 'File not found' }, 404)
      }

      await this.things.delete(file.$id)
      return c.json({ success: true, deleted: path })
    })

    // List tree
    app.get('/tree', async (c) => {
      const path = c.req.query('path') ?? ''
      const files = await this.things.list({ type: 'GitFile' })

      const tree = files
        .map((f) => f as unknown as GitFile)
        .filter((f) => path === '' || f.path.startsWith(path))
        .map((f) => ({
          path: f.path,
          mode: f.mode,
          type: 'blob',
        }))

      return c.json(tree)
    })

    // ========================================================================
    // High-Level Workflows
    // ========================================================================

    // Deploy feature
    app.post('/deploy/:feature', async (c) => {
      const feature = c.req.param('feature')
      const { changes } = await c.req.json<{ changes: FileChange[] }>()

      // Create feature branch
      const branchName = `feature/${feature}`
      const originalBranch = this.config.branch

      // Checkout new branch
      const refs = await this.things.list({ type: 'GitRef' })
      const currentRef = refs.find((r) => (r as unknown as GitRef).name === `refs/heads/${originalBranch}`)
      const baseSha = currentRef ? (currentRef as unknown as GitRef).sha : ''

      await this.things.create({
        $type: 'GitRef',
        name: `refs/heads/${branchName}`,
        sha: baseSha,
        type: 'branch',
      })

      this.config.branch = branchName

      // Apply changes
      for (const change of changes) {
        const files = await this.things.list({ type: 'GitFile' })
        const existingFile = files.find((f) => (f as unknown as GitFile).path === change.path)

        if (change.mode === 'delete' && existingFile) {
          await this.things.delete(existingFile.$id)
        } else if (existingFile) {
          await this.things.update(existingFile.$id, { content: change.content })
        } else {
          await this.things.create({
            $type: 'GitFile',
            path: change.path,
            content: change.content,
            mode: '100644',
          })
        }
      }

      // Commit
      const sha = this.generateSha()
      await this.things.create({
        $type: 'GitCommit',
        sha,
        message: `feat: ${feature}`,
        author: { name: 'Agent', email: 'agent@dotdo.dev' },
        timestamp: new Date().toISOString(),
        tree: this.generateSha(),
        parents: baseSha ? [baseSha] : [],
      })

      // Update branch ref
      const branchRefs = await this.things.list({ type: 'GitRef' })
      const branchRef = branchRefs.find((r) => (r as unknown as GitRef).name === `refs/heads/${branchName}`)
      if (branchRef) {
        await this.things.update(branchRef.$id, { sha })
      }

      // Simulate PR creation
      const prNumber = Math.floor(Math.random() * 1000) + 1

      const result: DeployResult = {
        success: true,
        branch: branchName,
        commit: sha,
        pr: {
          number: prNumber,
          url: `https://github.com/${this.config.repo}/pull/${prNumber}`,
        },
      }

      this.$.send({
        type: 'Git.deployed',
        payload: { feature, branch: branchName, prNumber },
      })

      // Reset to original branch
      this.config.branch = originalBranch

      return c.json(result)
    })

    // Review PR (simulated)
    app.post('/review/:pr', async (c) => {
      const prNumber = parseInt(c.req.param('pr'))

      // Simulate code review
      const comments: ReviewComment[] = []
      const approved = Math.random() > 0.3 // 70% approval rate

      if (!approved) {
        comments.push({
          path: 'src/index.ts',
          line: 10,
          message: 'Consider adding error handling here',
          severity: 'warning',
        })
      }

      const result: ReviewResult = {
        approved,
        comments,
        summary: approved
          ? 'Looks good! Approved.'
          : 'Minor issues found. Please address comments.',
      }

      return c.json(result)
    })

    // Merge PR (simulated)
    app.post('/merge-pr/:pr', async (c) => {
      const prNumber = parseInt(c.req.param('pr'))
      const sha = this.generateSha()

      this.$.send({
        type: 'Git.merged',
        payload: { prNumber, targetBranch: 'main', sha },
      })

      return c.json({
        success: true,
        merged: true,
        sha,
        message: `PR #${prNumber} merged successfully`,
      })
    })

    // Sync fork (simulated)
    app.post('/sync-fork', async (c) => {
      // In production: fetch upstream and merge

      this.$.send({
        type: 'Git.synced',
        payload: { branch: this.config.branch },
      })

      return c.json({
        success: true,
        message: 'Fork synced with upstream',
        commits: 0, // Number of new commits pulled
      })
    })
  }
}

// Export for worker binding
export { GitOpsDO as DO }
