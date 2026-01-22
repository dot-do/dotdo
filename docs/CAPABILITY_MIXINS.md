# Capability Mixins: fsx, gitx, bashx Integration

This document describes how to integrate the fsx.do (filesystem), gitx.do (git), and bashx.do (bash execution) packages with dotdo Durable Objects using capability mixins.

## Overview

dotdo uses the **mixin pattern** to add capabilities to Durable Objects. Each capability package provides a `withX()` mixin that adds the corresponding module to your DO class:

| Package | Mixin | Context Property | Purpose |
|---------|-------|------------------|---------|
| fsx.do | `withFs()` | `$.fs` | POSIX filesystem operations |
| gitx.do | `withGit()` | `$.git` | Git version control |
| bashx.do | `withBash()` | `$.bash` | Safe code execution |

## Quick Start

### Basic Mixin Usage

```typescript
import { DO } from 'dotdo'
import { withFs } from 'fsx.do/do'
import { withGit } from 'gitx.do/do'
import { withBash } from 'bashx.do/do'

// Single capability
class FileStorageDO extends withFs(DO) {
  async saveDocument(content: string) {
    await this.$.fs.write('/documents/doc.txt', content)
    return await this.$.fs.stat('/documents/doc.txt')
  }
}

// Multiple capabilities (compose mixins)
class FullStackDO extends withBash(withGit(withFs(DO))) {
  async deployCode() {
    // Use all three capabilities
    await this.$.git.pull()
    await this.$.bash`npm install`
    await this.$.bash`npm run build`
    await this.$.fs.copy('/dist', '/public')
  }
}
```

## fsx.do Integration

### withFs Mixin

The `withFs()` mixin adds POSIX-compatible filesystem operations to your DO.

```typescript
import { DO } from 'dotdo'
import { withFs, type WithFsOptions } from 'fsx.do/do'

const fsOptions: WithFsOptions = {
  basePath: '/app',           // Base path for all operations
  hotMaxSize: 1024 * 1024,    // 1MB hot tier threshold
  defaultMode: 0o644,         // Default file permissions
  defaultDirMode: 0o755,      // Default directory permissions
  r2BindingName: 'R2',        // R2 bucket for warm tier
}

class ContentDO extends withFs(DO, fsOptions) {
  async handleContent() {
    // Read files
    const config = await this.$.fs.read('/config.json', { encoding: 'utf-8' })

    // Write files
    await this.$.fs.write('/output/result.json', JSON.stringify(data))

    // List directories
    const files = await this.$.fs.list('/content')

    // Create directories
    await this.$.fs.mkdir('/uploads/images', { recursive: true })

    // Copy/move files
    await this.$.fs.copy('/source.txt', '/backup/source.txt')
    await this.$.fs.rename('/temp/file.txt', '/final/file.txt')

    // Get metadata
    const stats = await this.$.fs.stat('/document.pdf')
    console.log(`Size: ${stats.size}, Modified: ${stats.mtime}`)
  }
}
```

### FsModule API

| Method | Description |
|--------|-------------|
| `read(path, options?)` | Read file contents |
| `write(path, data, options?)` | Write file contents |
| `list(path, options?)` | List directory contents |
| `stat(path)` | Get file/directory stats |
| `mkdir(path, options?)` | Create directory |
| `rmdir(path, options?)` | Remove directory |
| `unlink(path)` | Delete file |
| `copy(src, dest)` | Copy file |
| `rename(old, new)` | Move/rename file |
| `exists(path)` | Check if path exists |

### Tiered Storage

fsx automatically routes files between hot (SQLite) and warm (R2) tiers:

```
                     ┌─────────────────┐
                     │    FsModule     │
                     └────────┬────────┘
                              │
              ┌───────────────┴───────────────┐
              │                               │
    ┌─────────▼─────────┐         ┌──────────▼─────────┐
    │    Hot Tier       │         │    Warm Tier       │
    │    (SQLite)       │         │    (R2)            │
    │                   │         │                    │
    │  - Small files    │         │  - Large files     │
    │  - Metadata       │         │  - Binary blobs    │
    │  - <1MB default   │         │  - Cost-effective  │
    │  - Microseconds   │         │  - ~100ms latency  │
    └───────────────────┘         └────────────────────┘
```

## gitx.do Integration

### withGit Mixin

The `withGit()` mixin adds full Git operations to your DO.

```typescript
import { DO } from 'dotdo'
import { withGit, type WithGitOptions } from 'gitx.do/do'

const gitOptions: WithGitOptions = {
  repo: 'org/repo',           // Repository identifier
  branch: 'main',             // Branch to track
  path: 'src/',               // Path prefix in repo
  contextMode: true,          // Enable $.git access
}

class CodeAgentDO extends withGit(DO, gitOptions) {
  async generateAndCommit(spec: string) {
    // Generate code
    const code = await this.ai.generate(spec)

    // Write to filesystem (requires withFs)
    await this.$.fs.write('/src/generated.ts', code)

    // Git operations
    await this.$.git.add('.', 'src/generated.ts')
    await this.$.git.commit(`feat: implement ${spec}`)

    // Check status
    const status = await this.$.git.status()
    console.log('Modified:', status.modified)
    console.log('Staged:', status.staged)

    return status
  }

  async reviewHistory() {
    // View commit log
    const log = await this.$.git.log({ limit: 10 })
    for (const commit of log.commits) {
      console.log(`${commit.hash} - ${commit.message}`)
    }

    // View diff
    const diff = await this.$.git.diff('main', 'feature-branch')
    return diff
  }
}
```

### GitModule API

| Method | Description |
|--------|-------------|
| `init(path?)` | Initialize repository |
| `status()` | Get working tree status |
| `add(base, paths)` | Stage files |
| `commit(message)` | Create commit |
| `log(options?)` | View commit history |
| `diff(a, b)` | Compare commits/branches |
| `branch(name)` | Create branch |
| `checkout(ref)` | Switch branches |
| `merge(branch)` | Merge branch |
| `pull()` | Fetch and merge |
| `push()` | Push to remote |
| `sync()` | Pull then push |

### AI Agent Version Control Pattern

Each AI agent can have its own git repository:

```typescript
class AIAgentDO extends withGit(withFs(DO)) {
  async workOnTask(task: string) {
    // Create feature branch
    await this.$.git.branch(`task-${Date.now()}`)
    await this.$.git.checkout(`task-${Date.now()}`)

    // Do work
    const result = await this.ai.execute(task)
    await this.$.fs.write('/output/result.json', JSON.stringify(result))

    // Commit work
    await this.$.git.add('.', 'output/')
    await this.$.git.commit(`task: ${task}`)

    // Merge back to main
    await this.$.git.checkout('main')
    await this.$.git.merge(`task-${Date.now()}`)
  }
}
```

## bashx.do Integration

### withBash Mixin

The `withBash()` mixin adds safe code execution to your DO.

```typescript
import { DO } from 'dotdo'
import { withBash } from 'bashx.do/do'

class BuildDO extends withBash(DO) {
  async buildProject() {
    // Simple commands
    const files = await this.$.bash`ls -la`

    // Package management
    await this.$.bash`npm install`
    await this.$.bash`npm run build`

    // Multi-language execution
    await this.$.bash`python scripts/validate.py`
    await this.$.bash`ruby scripts/notify.rb`

    // Commands with options
    await this.$.bash`npm test`({ timeout: 60000 })

    // Dangerous commands are blocked
    const result = await this.$.bash`rm -rf /`
    // result.blocked = true
    // result.reason = 'Recursive delete targeting root filesystem'
  }
}
```

### BashModule API

The bash template literal returns a `BashResult`:

```typescript
interface BashResult {
  stdout: string           // Command output
  stderr: string           // Error output
  exitCode: number         // Exit code

  // Safety analysis
  blocked: boolean         // Was execution blocked?
  blockReason?: string     // Why it was blocked
  classification: {
    type: string           // 'read', 'write', 'delete', etc.
    impact: string         // 'none', 'low', 'high', 'critical'
    reversible: boolean    // Can be undone?
  }

  // Metadata
  ast: Program             // Parsed AST
  intent: Intent           // Extracted intent
  tier: number             // Execution tier used
  language: string         // Detected language
  undo?: string            // Command to reverse (if available)
}
```

### Safety Tiers

bashx routes commands to optimal execution tiers:

| Tier | Latency | Examples | Implementation |
|------|---------|----------|----------------|
| 1 | <1ms | `cat`, `ls`, `head`, `tail` | Native Workers APIs |
| 1.5 | <100ms | Python, Ruby inline | WASM/warm workers |
| 2 | <5ms | `jq`, `git`, `npm` | RPC to services |
| 3 | <10ms | Dynamic Node.js | esm.sh modules |
| 4 | 2-3s | Full scripts | Sandboxed Linux |

### Multi-Language Support

```typescript
class PolyglotDO extends withBash(DO) {
  async runMultiLanguage() {
    // Bash (default)
    await this.$.bash`echo "Hello from bash"`

    // Python
    await this.$.bash`python -c 'print("Hello from Python")'`

    // With shebang
    await this.$.bash`#!/usr/bin/env python3
import json
data = {"status": "ok"}
print(json.dumps(data))
`

    // Ruby
    await this.$.bash`ruby -e 'puts "Hello from Ruby"'`

    // Node.js
    await this.$.bash`node -e 'console.log("Hello from Node")'`
  }
}
```

## Composing Multiple Capabilities

### The Recommended Pattern

```typescript
import { DO } from 'dotdo'
import { withFs } from 'fsx.do/do'
import { withGit } from 'gitx.do/do'
import { withBash } from 'bashx.do/do'

// Compose mixins - innermost to outermost
// Order: withBash(withGit(withFs(DO)))
class FullCapabilityDO extends withBash(withGit(withFs(DO))) {
  // All three capabilities available on $
  // this.$.fs   - filesystem
  // this.$.git  - git
  // this.$.bash - bash execution
}
```

### Real-World Example: CI/CD Agent

```typescript
class CIAgentDO extends withBash(withGit(withFs(DO))) {
  async runCI(repoUrl: string) {
    // Clone repository
    await this.$.git.clone(repoUrl, '/workspace')

    // Install dependencies
    await this.$.bash`cd /workspace && npm install`

    // Run tests
    const testResult = await this.$.bash`cd /workspace && npm test`
    if (testResult.exitCode !== 0) {
      return { status: 'failed', stage: 'test', output: testResult.stderr }
    }

    // Build
    await this.$.bash`cd /workspace && npm run build`

    // Copy artifacts
    await this.$.fs.copy('/workspace/dist', '/artifacts/build')

    // Create release commit
    await this.$.git.add('/workspace', 'dist/')
    await this.$.git.commit('chore: build artifacts')
    await this.$.git.push()

    return { status: 'success' }
  }
}
```

### Real-World Example: Content Site

```typescript
class ContentSiteDO extends withBash(withGit(withFs(DO))) {
  async publishContent(markdown: string) {
    // Write content
    await this.$.fs.write('/content/post.md', markdown)

    // Transform with Python
    await this.$.bash`python /scripts/transform.py /content/post.md`

    // Read transformed HTML
    const html = await this.$.fs.read('/content/post.html', { encoding: 'utf-8' })

    // Commit and push
    await this.$.git.add('.', 'content/')
    await this.$.git.commit('content: new post')
    await this.$.git.push()

    return html
  }
}
```

## Configuration

### wrangler.toml Bindings

```toml
# Required for fsx warm tier and gitx storage
[[r2_buckets]]
binding = "R2"
bucket_name = "my-bucket"

# Optional: separate archive bucket
[[r2_buckets]]
binding = "ARCHIVE"
bucket_name = "my-archive"

# Durable Object binding
[[durable_objects.bindings]]
name = "MY_DO"
class_name = "MyDO"
```

### Environment Type

```typescript
interface Env {
  R2: R2Bucket
  ARCHIVE?: R2Bucket
  MY_DO: DurableObjectNamespace
}
```

## Standalone Usage (Without dotdo)

Each package can be used standalone as a Durable Object:

### fsx.do Standalone

```typescript
import { FileSystemDO } from 'fsx.do'

export { FileSystemDO }

export default {
  async fetch(request: Request, env: Env) {
    const id = env.FSX.idFromName('user-123')
    const stub = env.FSX.get(id)
    return stub.fetch(request)
  }
}
```

### gitx.do Standalone

```typescript
import { GitDO } from 'gitx.do/do'

export { GitDO }

export default {
  async fetch(request: Request, env: Env) {
    const id = env.GIT.idFromName('repo-123')
    const stub = env.GIT.get(id)
    return stub.fetch(request)
  }
}
```

## Troubleshooting

### "$.fs is undefined"

Ensure you're using the mixin correctly:

```typescript
// Wrong - not using mixin
class MyDO extends DO {
  async test() {
    this.$.fs  // undefined!
  }
}

// Correct - use withFs mixin
class MyDO extends withFs(DO) {
  async test() {
    this.$.fs  // FsModule instance
  }
}
```

### R2 Bucket Not Found

Ensure your wrangler.toml has the R2 binding:

```toml
[[r2_buckets]]
binding = "R2"
bucket_name = "your-bucket-name"
```

### Bash Commands Blocked

bashx blocks dangerous commands by default. Use `confirm: true` for legitimate destructive operations:

```typescript
// Blocked by default
await this.$.bash`rm -rf node_modules`
// { blocked: true, reason: '...' }

// Explicitly confirm
await this.$.bash`rm -rf node_modules`({ confirm: true })
// Executes
```

## Related Documentation

- [fsx.do README](/fsx/README.md) - Full filesystem API
- [gitx.do README](/gitx/README.md) - Full git API
- [bashx.do README](/bashx/README.md) - Full bash API
- [ARCHITECTURE.md](/ARCHITECTURE.md) - Overall system design
- [WorkflowContext Documentation](/docs/WORKFLOW_CONTEXT.md) - The $ context
