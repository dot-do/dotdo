/**
 * primitive-git-ops - Zero-VM Git Operations
 *
 * Git without servers. Git without VMs. Git on the edge.
 *
 * This example demonstrates gitx - full git operations running in V8 isolates.
 * Clone, branch, commit, push - all without containers, SSH, or VMs.
 *
 * Features demonstrated:
 * - Clone/init repositories in R2
 * - Commit, branch, merge operations
 * - Push/pull between R2 repositories
 * - Git log, diff, status operations
 * - Full GitHub API integration
 */

import { Hono } from 'hono'
import { GitOpsDO } from './GitOpsDO'

// Re-export the DO class for Wrangler
export { GitOpsDO }

// ============================================================================
// Types
// ============================================================================

interface Env {
  DO: DurableObjectNamespace
  R2_BUCKET: R2Bucket
  GITHUB_TOKEN?: string
  GITHUB_API_URL: string
}

interface FileChange {
  path: string
  content: string
  mode?: 'add' | 'modify' | 'delete'
}

// ============================================================================
// RPC Helper
// ============================================================================

/**
 * Helper to call DO RPC methods
 */
async function callDO<T>(
  stub: DurableObjectStub,
  method: string,
  params: unknown[] = []
): Promise<T> {
  const response = await stub.fetch(
    new Request('http://do/rpc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method, params }),
    })
  )
  return response.json() as T
}

// ============================================================================
// HTTP API
// ============================================================================

const app = new Hono<{ Bindings: Env }>()

/**
 * Health check and API documentation.
 */
app.get('/', (c) => {
  return c.json({
    name: 'primitive-git-ops',
    description: 'Zero-VM Git Operations',
    tagline: 'Git without servers. Git without VMs. Git on the edge.',
    primitives: {
      gitx: 'Git protocol implementation on R2 + DO',
      fsx: 'Filesystem on SQLite with R2 tiering',
    },
    endpoints: {
      // Repository operations
      'POST /init': 'Initialize a new repository',
      'POST /clone': 'Clone a repository from URL',
      'GET /status': 'Get working tree status',

      // Staging and commits
      'POST /add': 'Stage files for commit',
      'POST /commit': 'Create a commit',
      'GET /log': 'View commit history',
      'GET /diff': 'View changes (staged or between refs)',

      // Branching
      'GET /branches': 'List all branches',
      'POST /checkout': 'Switch or create branch',
      'POST /merge': 'Merge a branch',

      // Remote operations
      'POST /sync': 'Pull latest from R2',
      'POST /push': 'Push to R2',

      // High-level workflows
      'POST /deploy/:feature': 'Deploy a feature branch',
      'POST /review/:pr': 'Review a pull request',
      'POST /merge-pr/:pr': 'Auto-merge a pull request',

      // File operations
      'GET /files/*': 'Read a file',
      'PUT /files/*': 'Write a file',
      'DELETE /files/*': 'Delete a file',
      'GET /tree': 'List directory tree',
    },
  })
})

// ============================================================================
// Repository Operations
// ============================================================================

/**
 * Initialize a new repository.
 *
 * @example
 * curl -X POST http://localhost:8787/init
 */
app.post('/init', async (c) => {
  const id = c.env.DO.idFromName('git-ops')
  const stub = c.env.DO.get(id)
  return c.json(await callDO(stub, 'initRepository'))
})

/**
 * Clone a repository from URL.
 *
 * @example
 * curl -X POST http://localhost:8787/clone \
 *   -H "Content-Type: application/json" \
 *   -d '{"url": "https://github.com/org/repo"}'
 */
app.post('/clone', async (c) => {
  const { url, branch } = await c.req.json<{ url: string; branch?: string }>()
  const id = c.env.DO.idFromName('git-ops')
  const stub = c.env.DO.get(id)
  return c.json(await callDO(stub, 'cloneRepository', [url, branch]))
})

/**
 * Get repository status.
 *
 * @example
 * curl http://localhost:8787/status
 */
app.get('/status', async (c) => {
  const id = c.env.DO.idFromName('git-ops')
  const stub = c.env.DO.get(id)
  return c.json(await callDO(stub, 'getStatus'))
})

// ============================================================================
// Staging and Commits
// ============================================================================

/**
 * Stage files for commit.
 *
 * @example
 * curl -X POST http://localhost:8787/add \
 *   -H "Content-Type: application/json" \
 *   -d '{"paths": ["src/index.ts", "README.md"]}'
 *
 * # Or stage all:
 * curl -X POST http://localhost:8787/add \
 *   -H "Content-Type: application/json" \
 *   -d '{"paths": "."}'
 */
app.post('/add', async (c) => {
  const { paths } = await c.req.json<{ paths: string | string[] }>()
  const id = c.env.DO.idFromName('git-ops')
  const stub = c.env.DO.get(id)
  return c.json(await callDO(stub, 'stageFiles', [paths]))
})

/**
 * Create a commit.
 *
 * @example
 * curl -X POST http://localhost:8787/commit \
 *   -H "Content-Type: application/json" \
 *   -d '{"message": "feat: add new feature", "author": "Agent Ralph <ralph@agents.do>"}'
 */
app.post('/commit', async (c) => {
  const { message, author } = await c.req.json<{ message: string; author?: string }>()
  const id = c.env.DO.idFromName('git-ops')
  const stub = c.env.DO.get(id)
  return c.json(await callDO(stub, 'createCommit', [message, author]))
})

/**
 * View commit history.
 *
 * @example
 * curl "http://localhost:8787/log?limit=10"
 */
app.get('/log', async (c) => {
  const limit = parseInt(c.req.query('limit') ?? '20', 10)
  const id = c.env.DO.idFromName('git-ops')
  const stub = c.env.DO.get(id)
  return c.json(await callDO(stub, 'getLog', [limit]))
})

/**
 * View changes.
 *
 * @example
 * # View unstaged changes
 * curl http://localhost:8787/diff
 *
 * # View diff between refs
 * curl "http://localhost:8787/diff?from=main&to=feature-branch"
 */
app.get('/diff', async (c) => {
  const from = c.req.query('from')
  const to = c.req.query('to')
  const id = c.env.DO.idFromName('git-ops')
  const stub = c.env.DO.get(id)
  return c.json(await callDO(stub, 'getDiff', [from, to]))
})

// ============================================================================
// Branching
// ============================================================================

/**
 * List all branches.
 *
 * @example
 * curl http://localhost:8787/branches
 */
app.get('/branches', async (c) => {
  const id = c.env.DO.idFromName('git-ops')
  const stub = c.env.DO.get(id)
  return c.json(await callDO(stub, 'listBranches'))
})

/**
 * Switch or create a branch.
 *
 * @example
 * # Switch to existing branch
 * curl -X POST http://localhost:8787/checkout \
 *   -H "Content-Type: application/json" \
 *   -d '{"branch": "feature-auth"}'
 *
 * # Create and switch to new branch
 * curl -X POST http://localhost:8787/checkout \
 *   -H "Content-Type: application/json" \
 *   -d '{"branch": "feature-new", "create": true}'
 */
app.post('/checkout', async (c) => {
  const { branch, create } = await c.req.json<{ branch: string; create?: boolean }>()
  const id = c.env.DO.idFromName('git-ops')
  const stub = c.env.DO.get(id)
  return c.json(await callDO(stub, 'checkoutBranch', [branch, create]))
})

/**
 * Merge a branch.
 *
 * @example
 * curl -X POST http://localhost:8787/merge \
 *   -H "Content-Type: application/json" \
 *   -d '{"branch": "feature-auth"}'
 */
app.post('/merge', async (c) => {
  const { branch } = await c.req.json<{ branch: string }>()
  const id = c.env.DO.idFromName('git-ops')
  const stub = c.env.DO.get(id)
  return c.json(await callDO(stub, 'mergeBranch', [branch]))
})

// ============================================================================
// Remote Operations
// ============================================================================

/**
 * Sync (pull) from R2.
 *
 * @example
 * curl -X POST http://localhost:8787/sync
 */
app.post('/sync', async (c) => {
  const id = c.env.DO.idFromName('git-ops')
  const stub = c.env.DO.get(id)
  return c.json(await callDO(stub, 'syncFromRemote'))
})

/**
 * Push to R2.
 *
 * @example
 * curl -X POST http://localhost:8787/push
 */
app.post('/push', async (c) => {
  const id = c.env.DO.idFromName('git-ops')
  const stub = c.env.DO.get(id)
  return c.json(await callDO(stub, 'pushToRemote'))
})

// ============================================================================
// File Operations
// ============================================================================

/**
 * Read a file from the working tree.
 *
 * @example
 * curl http://localhost:8787/files/src/index.ts
 */
app.get('/files/*', async (c) => {
  const path = c.req.path.replace('/files/', '')
  const id = c.env.DO.idFromName('git-ops')
  const stub = c.env.DO.get(id)
  return c.json(await callDO(stub, 'readFile', [path]))
})

/**
 * Write a file to the working tree.
 *
 * @example
 * curl -X PUT http://localhost:8787/files/src/new-file.ts \
 *   -H "Content-Type: application/json" \
 *   -d '{"content": "export const hello = \"world\""}'
 */
app.put('/files/*', async (c) => {
  const path = c.req.path.replace('/files/', '')
  const { content } = await c.req.json<{ content: string }>()
  const id = c.env.DO.idFromName('git-ops')
  const stub = c.env.DO.get(id)
  return c.json(await callDO(stub, 'writeFile', [path, content]))
})

/**
 * Delete a file from the working tree.
 *
 * @example
 * curl -X DELETE http://localhost:8787/files/src/old-file.ts
 */
app.delete('/files/*', async (c) => {
  const path = c.req.path.replace('/files/', '')
  const id = c.env.DO.idFromName('git-ops')
  const stub = c.env.DO.get(id)
  return c.json(await callDO(stub, 'deleteFile', [path]))
})

/**
 * List directory tree.
 *
 * @example
 * curl "http://localhost:8787/tree?path=src"
 */
app.get('/tree', async (c) => {
  const path = c.req.query('path') ?? '/'
  const id = c.env.DO.idFromName('git-ops')
  const stub = c.env.DO.get(id)
  return c.json(await callDO(stub, 'listTree', [path]))
})

// ============================================================================
// High-Level Workflows
// ============================================================================

/**
 * Deploy a feature with file changes.
 *
 * @example
 * curl -X POST http://localhost:8787/deploy/dark-mode \
 *   -H "Content-Type: application/json" \
 *   -d '{"changes": [{"path": "src/theme.ts", "content": "export const dark = {}"}]}'
 */
app.post('/deploy/:feature', async (c) => {
  const feature = c.req.param('feature')
  const body = await c.req.json<{ changes: FileChange[] }>()
  const id = c.env.DO.idFromName('git-ops')
  const stub = c.env.DO.get(id)
  return c.json(await callDO(stub, 'deployFeature', [feature, body.changes]))
})

/**
 * Review a pull request.
 *
 * @example
 * curl -X POST http://localhost:8787/review/42
 */
app.post('/review/:pr', async (c) => {
  const prNumber = parseInt(c.req.param('pr'), 10)
  const id = c.env.DO.idFromName('git-ops')
  const stub = c.env.DO.get(id)
  return c.json(await callDO(stub, 'reviewPR', [prNumber]))
})

/**
 * Auto-merge a pull request.
 *
 * @example
 * curl -X POST http://localhost:8787/merge-pr/42
 */
app.post('/merge-pr/:pr', async (c) => {
  const prNumber = parseInt(c.req.param('pr'), 10)
  const id = c.env.DO.idFromName('git-ops')
  const stub = c.env.DO.get(id)
  return c.json(await callDO(stub, 'autoMerge', [prNumber]))
})

/**
 * Sync fork with upstream.
 *
 * @example
 * curl -X POST http://localhost:8787/sync-fork
 */
app.post('/sync-fork', async (c) => {
  const id = c.env.DO.idFromName('git-ops')
  const stub = c.env.DO.get(id)
  return c.json(await callDO(stub, 'syncForkWithUpstream'))
})

// ============================================================================
// Export
// ============================================================================

export default app
