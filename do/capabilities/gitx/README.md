# gitx.do

**Git for Cloudflare Workers.** Full protocol. Edge-native. 5,600+ tests.

[![npm version](https://img.shields.io/npm/v/gitx.do.svg)](https://www.npmjs.com/package/gitx.do)
[![Tests](https://img.shields.io/badge/tests-5%2C684%20passing-brightgreen.svg)](https://github.com/dot-do/gitx)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why gitx?

**AI agents need version control.** They generate code, iterate on files, need to track changes and roll back mistakes.

**gitx is Git reimplemented for Cloudflare Workers.** Full protocol support - pack files, delta compression, smart HTTP. Not a wrapper around git CLI. A complete implementation.

**Scales to millions of agents.** Each agent gets its own git repository on Cloudflare's edge network. No shared servers. No rate limits. Just fast, isolated version control at global scale.

```typescript
import git from 'gitx.do'

// Initialize a repo
await git.init('/my-project')

// Stage and commit
await git.add('/my-project', '.')
await git.commit('/my-project', 'Initial commit')

// Branch and merge
await git.branch('/my-project', 'feature')
await git.checkout('/my-project', 'feature')
// ... make changes ...
await git.merge('/my-project', 'feature')
```

## Installation

```bash
npm install gitx.do
```

## Quick Start

```typescript
import git from 'gitx.do'

// Create a repository
await git.init('/repo')

// Write files and commit
await git.add('/repo', 'README.md')
await git.commit('/repo', 'Add readme')

// View history
const log = await git.log('/repo')
console.log(log.commits)

// Create branches
await git.branch('/repo', 'feature/auth')
await git.checkout('/repo', 'feature/auth')

// View changes
const diff = await git.diff('/repo', 'main', 'feature/auth')
const status = await git.status('/repo')
```

## Features

### Full Git Protocol

Complete implementation of Git internals:

```typescript
// Object model
await git.hashObject('/repo', content, 'blob')
await git.catFile('/repo', sha, 'blob')

// Trees and commits
const tree = await git.writeTree('/repo')
const commit = await git.commitTree('/repo', tree, 'message', [parent])

// Pack files
await git.pack('/repo', objects)
await git.unpack('/repo', packData)

// References
await git.updateRef('/repo', 'refs/heads/main', sha)
const ref = await git.resolveRef('/repo', 'HEAD')
```

### Tiered Storage

Hot objects in SQLite. Pack files in R2. You don't think about it.

```
┌────────────────────────────────────────────────────────┐
│   Hot Tier (SQLite)           │   Warm Tier (R2)       │
├───────────────────────────────┼────────────────────────┤
│   • Recent commits            │   • Pack files         │
│   • Active branches           │   • Full history       │
│   • Loose objects             │   • Large blobs        │
│   • <10ms access              │   • <100ms access      │
└───────────────────────────────┴────────────────────────┘
```

### Pack File Engine

Full packfile v2/v3 support:

```typescript
// Delta compression
await git.repack('/repo', { deltify: true })

// Verify integrity
await git.fsck('/repo')

// Garbage collection
await git.gc('/repo')
```

- OFS_DELTA and REF_DELTA compression
- Multi-pack indexes (MIDX)
- CRC32 verification
- Thin pack support for network transfer

### Wire Protocol

Smart HTTP protocol for git clients:

```typescript
// Serve git fetch/push
app.all('/repo.git/*', (req) => git.serve(req))

// Clone works
// git clone https://your-worker.dev/repo.git
```

- Capability negotiation
- Side-band progress reporting
- Multi-ack for efficiency
- Shallow clone support

### Merge & Diff

Full three-way merge with conflict detection:

```typescript
// Merge branches
const result = await git.merge('/repo', 'feature')
if (result.conflicts) {
  console.log('Conflicts:', result.conflicts)
}

// View diff
const diff = await git.diff('/repo', 'main', 'feature')
for (const file of diff.files) {
  console.log(file.path, file.additions, file.deletions)
}
```

### CLI Commands

Full command-line interface:

```typescript
import { cli } from 'gitx.do/cli'

await cli('init /repo')
await cli('add /repo .')
await cli('commit /repo -m "message"')
await cli('log /repo --oneline')
await cli('branch /repo feature')
await cli('checkout /repo feature')
await cli('merge /repo main')
await cli('status /repo')
await cli('diff /repo')
```

### MCP Tools

Model Context Protocol for AI agents:

```typescript
import { gitTools, invokeTool } from 'gitx.do/mcp'

// Available tools
// git_init, git_add, git_commit, git_log, git_diff, git_status,
// git_branch, git_checkout, git_merge, git_show, git_blame

await invokeTool('git_commit', {
  repo: '/my-project',
  message: 'Fix authentication bug'
})

await invokeTool('git_log', {
  repo: '/my-project',
  limit: 10
})
```

## Durable Object Integration

### As a Standalone DO

```typescript
import { GitDO } from 'gitx.do/do'

export { GitDO }

export default {
  async fetch(request, env) {
    const id = env.GIT.idFromName('repo-123')
    const stub = env.GIT.get(id)
    return stub.fetch(request)
  }
}
```

### With dotdo Framework

```typescript
import { DO } from 'dotdo'
import { withGit } from 'gitx.do/do'

class MyAgent extends withGit(DO) {
  async work() {
    await this.$.git.add('.', 'src/')
    await this.$.git.commit('.', 'Update source files')

    const log = await this.$.git.log('.')
    return log.commits[0]
  }
}
```

### As RPC Service

```toml
# wrangler.toml
[[services]]
binding = "GITX"
service = "gitx-worker"
```

```typescript
await env.GITX.commit('/repo', 'message')
```

## API Reference

### Repository Operations

| Method | Description |
|--------|-------------|
| `init(path)` | Initialize new repository |
| `clone(url, path)` | Clone remote repository |
| `status(path)` | Get working tree status |
| `log(path, options?)` | View commit history |

### Staging & Commits

| Method | Description |
|--------|-------------|
| `add(path, files)` | Stage files |
| `commit(path, message)` | Create commit |
| `reset(path, ref)` | Reset to commit |

### Branches & Merging

| Method | Description |
|--------|-------------|
| `branch(path, name)` | Create branch |
| `checkout(path, ref)` | Switch branches |
| `merge(path, branch)` | Merge branch |
| `rebase(path, onto)` | Rebase branch |

### Diff & Blame

| Method | Description |
|--------|-------------|
| `diff(path, a, b)` | Compare commits |
| `blame(path, file)` | Line-by-line history |
| `show(path, ref)` | Show commit details |

### Low-Level

| Method | Description |
|--------|-------------|
| `hashObject(path, data, type)` | Create object |
| `catFile(path, sha, type)` | Read object |
| `updateRef(path, ref, sha)` | Update reference |
| `pack(path, objects)` | Create packfile |

## How It Works

```
┌─────────────────────────────────────────────────────────┐
│                      gitx.do                            │
├─────────────────────────────────────────────────────────┤
│  Git Commands (add, commit, branch, merge, etc.)        │
├─────────────────────────────────────────────────────────┤
│  Object Model (blob, tree, commit, tag)                 │
├─────────────────────────────────────────────────────────┤
│  Pack Engine (delta, compression, indexes)              │
├────────────────────┬────────────────────────────────────┤
│   Hot Tier         │         Warm Tier                  │
│   (SQLite)         │         (R2)                       │
│                    │                                    │
│   • Loose objects  │   • Pack files                     │
│   • References     │   • Large blobs                    │
│   • Index          │   • Archive                        │
└────────────────────┴────────────────────────────────────┘
```

## Comparison

| Feature | GitHub | GitLab | gitx.do |
|---------|--------|--------|---------|
| **Pricing** | $21/user/month | $29/user/month | Self-hosted |
| **Storage** | 1GB free | 5GB free | R2 (cheap) |
| **LFS bandwidth** | $0.0875/GB | Metered | R2 (no egress) |
| **Full protocol** | Yes | Yes | Yes |
| **Edge-native** | No | No | Yes |
| **AI-native API** | No | No | Yes |
| **Self-hosted** | Enterprise only | Complex | One-click |

## Use Cases

### AI Agent Version Control

Each AI agent gets its own repository:

```typescript
class CodeAgent extends withGit(DO) {
  async generateCode(spec) {
    const code = await this.ai.generate(spec)

    await this.$.fs.writeFile('src/index.ts', code)
    await this.$.git.add('.', 'src/')
    await this.$.git.commit('.', `Implement: ${spec}`)

    return this.$.git.log('.', { limit: 1 })
  }
}
```

### Private Git Hosting

Your repositories on your infrastructure:

```typescript
export default GitX({
  name: 'my-repos',
  domain: 'git.mycompany.com',
})
```

### LFS Without Bandwidth Fees

R2 has no egress charges:

```typescript
await git.lfsTrack('/repo', '*.psd')
await git.lfsPush('/repo')
```

## Performance

- **5,684 tests** covering all operations
- **Full Git protocol** - clone, fetch, push all work
- **<10ms** for hot tier operations
- **Global edge** - 300+ Cloudflare locations
- **Zero cold starts** - Durable Objects

## License

MIT

## Links

- [GitHub](https://github.com/dot-do/gitx)
- [Documentation](https://gitx.do)
- [.do](https://do.org.ai)
- [Platform.do](https://platform.do)
