# primitive-git-ops

**Git without servers. Git without VMs.**

```typescript
const result = await gitOps.deployFeature('dark-mode', [
  { path: 'src/theme.ts', content: 'export const dark = { ... }' },
  { path: 'src/App.tsx', content: '...' }
])

console.log(result.pr.html_url)
// https://github.com/org/repo/pull/42
```

You just ran Git in a V8 isolate. No container. No SSH. No VM.

---

## The Problem

Every git operation requires infrastructure:

- **Clone?** Spin up a container, pull gigabytes, wait.
- **Commit?** SSH keys, authentication, processes.
- **CI/CD?** VMs running 24/7, burning compute.

What if git was just... a function call?

## The Solution: gitx

**gitx** is Git reimplemented for V8 isolates:

- **Blobs and trees** stored in R2 (content-addressable, globally distributed)
- **Refs** stored in Durable Object SQLite (consistent, durable)
- **Working tree** managed by fsx (filesystem on SQLite)
- **Push/pull** via smart HTTP protocol over fetch()

All running on Cloudflare's edge. 300+ cities. 0ms cold starts.

---

## Quick Start

```bash
# Clone this example
git clone https://github.com/dotdo/examples
cd examples/primitive-git-ops

# Install dependencies
npm install

# Set up R2 bucket (one-time)
wrangler r2 bucket create git-objects

# Start development
npm run dev
```

### Deploy a Feature

```bash
curl -X POST http://localhost:8787/deploy/dark-mode \
  -H "Content-Type: application/json" \
  -d '{
    "changes": [
      { "path": "src/theme.ts", "content": "export const dark = {}" },
      { "path": "src/App.tsx", "content": "// updated" }
    ]
  }'
```

Response:
```json
{
  "success": true,
  "branch": "feature/dark-mode",
  "commit": "abc123...",
  "pr": {
    "number": 42,
    "html_url": "https://github.com/org/repo/pull/42"
  }
}
```

---

## How It Works

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     GitOpsDO (V8 Isolate)                   │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │   $.git     │  │   $.fs      │  │   $.things  │         │
│  │   (gitx)    │  │   (fsx)     │  │   (SQLite)  │         │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘         │
│         │                │                │                 │
│         │    ┌───────────┴───────────┐    │                 │
│         │    │   SQLite (DO State)   │────┘                 │
│         │    │   - refs/heads/*      │                      │
│         │    │   - index              │                      │
│         │    │   - working tree       │                      │
│         │    └───────────────────────┘                      │
│         │                                                    │
│         └────────────────────┐                              │
│                              ▼                              │
│                   ┌─────────────────────┐                   │
│                   │   R2 Object Store   │                   │
│                   │   - git/objects/*   │                   │
│                   │   (blobs, trees,    │                   │
│                   │    commits)         │                   │
│                   └─────────────────────┘                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                   ┌─────────────────────┐
                   │    GitHub API       │
                   │    (PRs, reviews,   │
                   │     merges)         │
                   └─────────────────────┘
```

### Object Storage

Git objects use content-addressable storage in R2:

```
R2 Bucket: git-objects/
├── git/objects/
│   ├── ab/
│   │   └── cdef1234...  (blob: file content)
│   ├── 12/
│   │   └── 3456789...   (tree: directory listing)
│   └── fe/
│       └── dcba987...   (commit: metadata + tree ref)
└── git/refs/
    └── heads/
        └── main         (branch pointer: commit SHA)
```

### Operations

| Operation | Traditional | gitx |
|-----------|-------------|------|
| Clone | Container + disk + network | R2 fetch + SQLite write |
| Commit | Disk I/O + object packing | SHA-1 hash + R2 put |
| Push | SSH tunnel + pack upload | R2 put + ref update |
| Status | Filesystem scan | SQLite query |

---

## API Reference

### Repository Operations

#### POST /init
Initialize a new repository.
```bash
curl -X POST http://localhost:8787/init
```

#### POST /clone
Clone a repository from URL.
```bash
curl -X POST http://localhost:8787/clone \
  -H "Content-Type: application/json" \
  -d '{"url": "https://github.com/org/repo", "branch": "main"}'
```

#### GET /status
Get current repository status.
```bash
curl http://localhost:8787/status
```
```typescript
interface StatusResponse {
  branch: string
  head?: string
  staged: string[]
  unstaged: string[]
  untracked: string[]
  clean: boolean
}
```

### Staging and Commits

#### POST /add
Stage files for commit.
```bash
# Stage specific files
curl -X POST http://localhost:8787/add \
  -H "Content-Type: application/json" \
  -d '{"paths": ["src/index.ts", "README.md"]}'

# Stage all changes
curl -X POST http://localhost:8787/add \
  -H "Content-Type: application/json" \
  -d '{"paths": "."}'
```

#### POST /commit
Create a commit.
```bash
curl -X POST http://localhost:8787/commit \
  -H "Content-Type: application/json" \
  -d '{"message": "feat: add new feature", "author": "Agent Ralph <ralph@agents.do>"}'
```

#### GET /log
View commit history.
```bash
curl "http://localhost:8787/log?limit=10"
```

#### GET /diff
View changes (working tree or between refs).
```bash
# Working tree changes
curl http://localhost:8787/diff

# Diff between refs
curl "http://localhost:8787/diff?from=main&to=feature-branch"
```

### Branching

#### GET /branches
List all branches.
```bash
curl http://localhost:8787/branches
```

#### POST /checkout
Switch or create a branch.
```bash
# Switch to existing branch
curl -X POST http://localhost:8787/checkout \
  -H "Content-Type: application/json" \
  -d '{"branch": "feature-auth"}'

# Create and switch
curl -X POST http://localhost:8787/checkout \
  -H "Content-Type: application/json" \
  -d '{"branch": "feature-new", "create": true}'
```

#### POST /merge
Merge a branch into current.
```bash
curl -X POST http://localhost:8787/merge \
  -H "Content-Type: application/json" \
  -d '{"branch": "feature-auth"}'
```

### Remote Operations

#### POST /sync
Sync (pull) from R2.
```bash
curl -X POST http://localhost:8787/sync
```

#### POST /push
Push to R2.
```bash
curl -X POST http://localhost:8787/push
```

### File Operations

#### GET /files/*
Read a file from the working tree.
```bash
curl http://localhost:8787/files/src/index.ts
```

#### PUT /files/*
Write a file to the working tree.
```bash
curl -X PUT http://localhost:8787/files/src/new-file.ts \
  -H "Content-Type: application/json" \
  -d '{"content": "export const hello = \"world\""}'
```

#### DELETE /files/*
Delete a file from the working tree.
```bash
curl -X DELETE http://localhost:8787/files/src/old-file.ts
```

#### GET /tree
List directory tree.
```bash
curl "http://localhost:8787/tree?path=src"
```

### High-Level Workflows

#### POST /deploy/:feature
Deploy a feature branch with file changes.
```bash
curl -X POST http://localhost:8787/deploy/dark-mode \
  -H "Content-Type: application/json" \
  -d '{
    "changes": [
      {"path": "src/theme.ts", "content": "export const dark = {}"},
      {"path": "src/App.tsx", "content": "// updated"}
    ]
  }'
```
```typescript
interface DeployResponse {
  success: boolean
  branch: string
  commit?: string
  pr?: {
    number: number
    html_url: string
  }
  error?: string
}
```

#### POST /review/:pr
Run automated code review on a pull request.
```bash
curl -X POST http://localhost:8787/review/42
```
```typescript
interface ReviewResponse {
  approved: boolean
  comments: Array<{
    path: string
    line: number
    message: string
    severity: 'error' | 'warning' | 'info'
  }>
  summary: string
}
```

#### POST /merge-pr/:pr
Auto-merge a pull request after checks pass.
```bash
curl -X POST http://localhost:8787/merge-pr/42
```

#### POST /sync-fork
Sync fork with upstream repository.
```bash
curl -X POST http://localhost:8787/sync-fork
```

---

## DO Implementation

```typescript
// Import DO with fs + git capabilities pre-composed
import { DO } from 'dotdo/git'

export class GitOpsDO extends DO {
  async onStart() {
    // Configure git with R2 object storage
    this.$.git.configure({
      repo: 'org/repo',
      branch: 'main',
      r2: this.env.R2_BUCKET,
      fs: this.$.fs,
    })
  }

  async deployFeature(name: string, changes: FileChange[]) {
    // Initialize and sync
    await this.$.git.init()
    await this.$.git.sync()

    // Apply changes via filesystem primitive
    for (const change of changes) {
      await this.$.fs.write(change.path, change.content)
    }

    // Git workflow
    await this.$.git.add('.')
    await this.$.git.commit(`feat: ${name}`)
    await this.$.git.push()

    // Create PR via GitHub API
    return this.createPR({ title: `Feature: ${name}` })
  }
}
```

---

## Scheduled Operations

```typescript
// Sync fork every hour
$.every.hour(async () => {
  await this.$.git.sync()
  await this.$.git.push()
})

// Daily backup
$.every.day.at('3am')(async () => {
  const log = await this.$.git.log({ limit: 100 })
  await this.$.things.create({
    $type: 'GitBackup',
    $id: new Date().toISOString(),
    commits: log,
  })
})
```

---

## Production Setup

### 1. Create R2 Bucket

```bash
wrangler r2 bucket create git-objects
```

### 2. Set GitHub Token

```bash
wrangler secret put GITHUB_TOKEN
# Enter your GitHub personal access token
```

### 3. Deploy

```bash
npm run deploy
```

### 4. Configure Webhooks (Optional)

Set up GitHub webhooks to trigger reviews on PR creation:

```
Webhook URL: https://your-worker.workers.dev/webhook
Events: Pull request
```

---

## Why This Matters

| Metric | Traditional CI/CD | gitx |
|--------|-------------------|------|
| Cold start | 10-60 seconds | 0ms |
| Memory | 512MB - 4GB | 128MB |
| Cost | $50-500/mo | Pay-per-request |
| Scale | 10-100 concurrent | Unlimited |
| Global | Single region | 300+ cities |

**gitx turns git operations into edge functions.**

---

## CI/CD Integration Patterns

### Pattern 1: Automated Deployments

Deploy code changes without CI/CD servers:

```typescript
// In your DO
async deployToProduction(changes: FileChange[]) {
  // Validate changes
  for (const change of changes) {
    const validation = validateCommitMessage(`feat: ${change.path}`)
    if (!validation.valid) throw new Error(validation.error)
  }

  // Deploy feature
  const result = await this.deployFeature('release', changes)

  // Trigger downstream (e.g., Cloudflare Queue)
  await this.env.DEPLOY_QUEUE.send({
    branch: result.branch,
    commit: result.commit,
    timestamp: new Date().toISOString(),
  })

  return result
}
```

### Pattern 2: Webhook Handler

Process GitHub webhooks for automated responses:

```typescript
// POST /webhook
app.post('/webhook', async (c) => {
  const event = c.req.header('X-GitHub-Event')
  const payload = await c.req.json()

  const stub = c.env.DO.get(c.env.DO.idFromName('webhook-handler'))

  switch (event) {
    case 'push':
      return c.json(await stub.handlePush(payload))
    case 'pull_request':
      return c.json(await stub.handlePR(payload))
    case 'pull_request_review':
      return c.json(await stub.handleReview(payload))
  }

  return c.json({ ok: true })
})
```

### Pattern 3: Scheduled Sync

Keep forks synchronized automatically:

```typescript
// Register scheduled handler in DO
$.every.hour(async () => {
  const result = await this.syncForkWithUpstream()

  if (result.commits > 0) {
    // Notify via webhook, email, or Slack
    await this.notify(`Synced ${result.commits} commits`)
  }
})

// Or via cron trigger in wrangler.toml:
// [triggers]
// crons = ["0 * * * *"]  # Every hour
```

### Pattern 4: Deployment Automation

Create automated deployment pipelines:

```typescript
// Analyze changes to determine deployment needs
const analysis = await analyzeDeploymentNeeds($.git, 'main', 'feature/xyz')

if (analysis.needsBackendDeploy) {
  await this.env.BACKEND_QUEUE.send({ action: 'deploy' })
}

if (analysis.needsFrontendDeploy) {
  await this.env.FRONTEND_QUEUE.send({ action: 'deploy' })
}

// Wait for deployments via Durable Object alarm
this.ctx.storage.setAlarm(Date.now() + 5 * 60 * 1000) // 5 minutes
```

### Pattern 5: Automated Code Review

Run code review on every PR:

```typescript
async handlePROpened(payload: PRPayload) {
  const prNumber = payload.number

  // Run automated review
  const review = await this.reviewPR(prNumber)

  // Post review to GitHub
  if (!review.approved) {
    await this.requestChanges(prNumber, review.comments)
  }

  // Check for auto-merge eligibility
  const canMerge = canAutoMerge(await this.$.git.status(), {
    requireCleanTree: true,
  })

  if (review.approved && canMerge.canMerge) {
    await this.autoMerge(prNumber)
  }

  return review
}
```

---

## Zero-VM Advantage

### Traditional Git Operations

```
Developer Machine          CI/CD Server              Git Server
      │                         │                         │
      ├── git push ─────────────┼─────────────────────────┤
      │                         │                         │
      │                    ┌────┴────┐                    │
      │                    │ Spin up │                    │
      │                    │   VM    │ (10-60s)           │
      │                    └────┬────┘                    │
      │                         │                         │
      │                    ┌────┴────┐                    │
      │                    │  Clone  │ (30-120s)          │
      │                    │  Repo   │                    │
      │                    └────┬────┘                    │
      │                         │                         │
      │                    ┌────┴────┐                    │
      │                    │  Build  │                    │
      │                    │  Test   │                    │
      │                    └────┬────┘                    │
      │                         │                         │
      │                    ┌────┴────┐                    │
      │                    │  Push   │                    │
      │                    │ Deploy  │                    │
      │                    └────┬────┘                    │
      │                         │                         │
      └────── Done! ────────────┴─────────────────────────┘

Total: 2-5 minutes
Cost: $50-500/month
Scale: 10-100 concurrent jobs
```

### gitx Operations

```
Any Edge Location (300+ cities)
      │
      ├── Request arrives ──────────────────────────────┐
      │                                                  │
      │    ┌──────────────────────────────────┐         │
      │    │     V8 Isolate (0ms cold start)   │         │
      │    │                                   │         │
      │    │  ┌──────────┐   ┌──────────┐     │         │
      │    │  │ $.git    │   │ $.fs     │     │         │
      │    │  │ (pure JS)│   │ (SQLite) │     │         │
      │    │  └────┬─────┘   └────┬─────┘     │         │
      │    │       │              │           │         │
      │    │       └──────┬───────┘           │         │
      │    │              │                   │         │
      │    │       ┌──────┴──────┐            │         │
      │    │       │ R2 Objects  │            │         │
      │    │       │ (global CDN)│            │         │
      │    │       └─────────────┘            │         │
      │    │                                   │         │
      │    └──────────────────────────────────┘         │
      │                                                  │
      └────── Done! ─────────────────────────────────────┘

Total: 10-100ms
Cost: Pay-per-request (~$0.0001)
Scale: Unlimited concurrent
```

### What Makes This Possible

1. **Pure JavaScript Git Implementation**
   - No git CLI binary needed
   - SHA-1 via Web Crypto API
   - Object serialization in JS

2. **R2 Object Storage**
   - Content-addressable like Git
   - Global CDN distribution
   - No egress fees

3. **SQLite in Durable Objects**
   - Refs stored consistently
   - Index managed durably
   - Working tree in memory

4. **Edge Execution**
   - 300+ Cloudflare locations
   - 0ms cold starts
   - Runs next to your users

---

## Use Cases

### 1. Automated PR Creation

AI agents create PRs without server infrastructure:

```typescript
// Agent Ralph creates a feature PR
const result = await ralph`
  implement dark mode for the dashboard
  using the existing theme system
`

// Result includes PR URL
console.log(result.pr.html_url)
```

### 2. Deployment Scripts

Replace shell scripts with edge functions:

```typescript
// Instead of: bash deploy.sh
// Use: fetch('/deploy/production')

app.post('/deploy/:env', async (c) => {
  const env = c.req.param('env')
  const stub = c.env.DO.get(c.env.DO.idFromName('deployer'))
  return c.json(await stub.deployToEnv(env))
})
```

### 3. Fork Synchronization

Keep forks up to date automatically:

```typescript
// Scheduled every hour
$.every.hour(async () => {
  await this.$.git.sync() // Fetch from upstream
  await this.$.git.push() // Push to fork
})
```

### 4. Code Review Automation

Run automated reviews on every PR:

```typescript
// Webhook handler
async onPRCreated(pr: PRPayload) {
  const review = await this.analyzeCode(pr.diff)
  await this.postReview(pr.number, review)
}
```

---

## Learn More

- [dotdo Documentation](https://dotdo.dev)
- [gitx Primitive](https://gitx.do)
- [fsx Primitive](https://fsx.do)
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)

---

*Built with [dotdo](https://dotdo.dev) - Business-as-Code for the 1-Person Unicorn*
