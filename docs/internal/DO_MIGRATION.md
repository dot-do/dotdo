---
title: "DO Capability Module Migration Guide"
description: Documentation for docs
---

# DO Capability Module Migration Guide

This guide explains how to migrate existing DOs to use the new capability module architecture. The architecture enables tree-shakeable, lazy-loaded capabilities via the `$` WorkflowContext.

## Overview

The new architecture introduces **capability modules** that extend the base DO class with optional functionality:

- `$.fs` - Filesystem operations (provided by `fsx`)
- `$.git` - Git operations (provided by `gitx`)
- `$.bash` - Shell execution (provided by `bashx`)
- `$.jq` - JSON query (optional RPC binding)
- `$.npm` - Package management (optional RPC binding)

These modules are:
1. **Lazy-loaded** - Only initialized when first accessed
2. **Tree-shakeable** - Import only what you need
3. **External packages** - Distributed as separate npm packages
4. **Optional RPC bindings** - Heavy tools as separate Workers to keep bundles small

## Execution Tiers

The architecture uses a **tiered execution model** for optimal performance:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Tier 1: Native In-Worker (<1ms)                   │
├─────────────────────────────────────────────────────────────────────┤
│  • fetch/ofetch (curl equivalent)     • JSON operations              │
│  • Node.js APIs (nodejs_compat_v2)    • Text processing              │
│  • Path, crypto, streams, zlib        • Basic file ops via $.fs      │
└─────────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────────┐
│                 Tier 2: RPC Bindings (<5ms)                          │
├─────────────────────────────────────────────────────────────────────┤
│  • $.jq → jq.do (jqjs as a service)                                  │
│  • $.npm → npm.do (package resolution/execution)                     │
│  • Heavy gitx operations → git.do                                    │
│  Optional: Only loaded if binding exists in wrangler.toml           │
└─────────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────────┐
│              Tier 3: worker_loaders (<10ms cold)                     │
├─────────────────────────────────────────────────────────────────────┤
│  • Dynamic npm packages (fetch from esm.sh, run in isolate)          │
│  • User-provided code (sandboxed V8 isolate)                         │
│  • ai-evaluate pattern for code execution                            │
└─────────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────────┐
│              Tier 4: Sandbox SDK (2-3s cold)                         │
├─────────────────────────────────────────────────────────────────────┤
│  Only for things that truly need Linux:                              │
│  • Shell scripts with bash-specific features                         │
│  • Python with native C extensions (numpy, pandas)                   │
│  • Binary executables (ffmpeg, imagemagick)                          │
└─────────────────────────────────────────────────────────────────────┘
```

## RPC Binding Architecture

Heavy tools like jq can be **optional RPC bindings** - separate Workers that don't bloat your core bundle:

```toml
# wrangler.toml - only add bindings you need
[[services]]
binding = "JQ"
service = "jq-do"

[[services]]
binding = "NPM"
service = "npm-do"
```

```typescript
// In your DO - graceful fallback if binding doesn't exist
class MyDO extends DO {
  async processData(data: unknown, filter: string) {
    // If JQ binding exists, use it (fast, dedicated Worker)
    if (this.env.JQ) {
      return this.env.JQ.query(data, filter)
    }
    // Fallback: inline jqjs (adds to bundle size)
    const jq = await import('jqjs')
    return jq.run(data, filter)
  }
}
```

The `$` proxy handles this automatically:

```typescript
// $.jq automatically uses RPC binding if available, falls back to inline
const result = await this.$.jq(data, '.users[].name')
```

## Dependency Graph

```
dotdo/full
    |
    +-- dotdo/git (includes $.fs, $.git)
    |       |
    |       +-- gitx (npm package)
    |       +-- fsx (npm package)
    |
    +-- dotdo/fs (includes $.fs)
    |       |
    |       +-- fsx (npm package)
    |
    +-- dotdo/bash (includes $.fs, $.bash)
            |
            +-- bashx (npm package)
            +-- fsx (npm package)

dotdo/tiny
    |
    (no capability modules, minimal DO)
```

**Package dependencies:**
- `bashx` depends on `fsx` (shell operations need filesystem access)
- `gitx` depends on `fsx` (git operations need filesystem access)

## Entry Points

Choose the right entry point based on your needs:

```typescript
// Minimal DO - no capability modules, smallest bundle
import { DO } from 'dotdo/tiny'

// With filesystem support only
import { DO } from 'dotdo/fs'

// With git support (includes filesystem)
import { DO } from 'dotdo/git'

// With bash support (includes filesystem)
import { DO } from 'dotdo/bash'

// Full featured - all capability modules
import { DO } from 'dotdo/full'

// Default export - same as dotdo/full
import { DO } from 'dotdo'
```

## New Database Tables

### `exec` Table

Tracks shell command executions for auditing and replay:

```typescript
// db/exec.ts
export const exec = sqliteTable('exec', {
  id: text('id').primaryKey(),              // UUID
  command: text('command').notNull(),        // The command executed
  args: text('args', { mode: 'json' }),      // Command arguments as JSON array
  cwd: text('cwd'),                          // Working directory
  env: text('env', { mode: 'json' }),        // Environment variables (filtered)
  exitCode: integer('exit_code'),            // Process exit code
  stdout: text('stdout'),                    // Standard output (truncated)
  stderr: text('stderr'),                    // Standard error (truncated)
  startedAt: integer('started_at', { mode: 'timestamp' }).notNull(),
  completedAt: integer('completed_at', { mode: 'timestamp' }),
  durationMs: integer('duration_ms'),        // Execution time in milliseconds
  status: text('status', {
    enum: ['pending', 'running', 'completed', 'failed', 'timeout']
  }).default('pending'),
})
```

### `files` Table (existing, enhanced)

The `files` table uses **integer rowid** for efficient foreign key references:

```typescript
// files table uses implicit SQLite rowid
// This enables efficient integer FKs instead of text path duplication

// Example: git_content references files.rowid
export const gitContent = sqliteTable('git_content', {
  file: integer('file').notNull(),  // FK -> files.rowid (not text path!)
  thing: integer('thing').notNull(), // FK -> things.rowid
  // ...
})
```

### `git`, `git_branches`, `git_content` Tables

Already exist in `db/git.ts`. See source for full schema.

## Migration Steps

### Step 1: Update Database Schema

Run migrations to add the new `exec` table:

```typescript
// In your migration script
import { exec } from 'dotdo/db/exec'

// Or run via Drizzle Kit
// npx drizzle-kit push:sqlite
```

### Step 2: Update Entry Point Import

Change your DO import to the appropriate entry point:

```typescript
// Before
import { DO } from 'dotdo'

// After - choose based on your needs
import { DO } from 'dotdo/tiny'   // Minimal
import { DO } from 'dotdo/fs'     // + filesystem
import { DO } from 'dotdo/git'    // + git
import { DO } from 'dotdo/full'   // Everything
```

### Step 3: Use Mixin Functions (Alternative)

For more control, use mixin functions to compose capabilities:

```typescript
import { DO } from 'dotdo/tiny'
import { withFs } from 'dotdo/mixins/fs'
import { withGit } from 'dotdo/mixins/git'
import { withBash } from 'dotdo/mixins/bash'

// Compose your own DO class
class MyDO extends withGit(withFs(DO)) {
  // Has $.fs and $.git, but not $.bash
}

// Or use the helper
import { compose } from 'dotdo/mixins'
class MyDO extends compose(DO, withFs, withGit) {
  // Same result
}
```

### Step 4: Update WorkflowContext Usage

Access capability modules through the `$` proxy:

```typescript
class MySite extends DO {
  async syncFromGit() {
    // Lazy-loaded on first access
    await this.$.git.pull('origin', 'main')

    // Filesystem operations
    const files = await this.$.fs.list('content/')

    // Shell execution (if using dotdo/bash or dotdo/full)
    const result = await this.$.bash.exec('npm', ['run', 'build'])
  }
}
```

### Step 5: Update Type Imports

Import capability types for TypeScript support:

```typescript
import type { WorkflowContext } from 'dotdo/types'
import type { FsCapability } from 'fsx'
import type { GitCapability } from 'gitx'
import type { BashCapability } from 'bashx'

// Extended WorkflowContext with capabilities
interface ExtendedWorkflowContext extends WorkflowContext {
  fs: FsCapability
  git: GitCapability
  bash: BashCapability
}
```

## Capability Module APIs

### $.fs (Filesystem)

```typescript
interface FsCapability {
  // Read operations
  read(path: string): Promise<string>
  readBinary(path: string): Promise<Uint8Array>
  exists(path: string): Promise<boolean>
  stat(path: string): Promise<FileStat>
  list(path: string): Promise<FileEntry[]>

  // Write operations
  write(path: string, content: string | Uint8Array): Promise<void>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
  rm(path: string, options?: { recursive?: boolean }): Promise<void>
  mv(from: string, to: string): Promise<void>
  cp(from: string, to: string): Promise<void>

  // Content-addressable storage
  hash(content: string | Uint8Array): Promise<string>
  store(content: string | Uint8Array): Promise<{ hash: string; path: string }>
  retrieve(hash: string): Promise<Uint8Array | null>
}
```

### $.git (Git Operations)

```typescript
interface GitCapability {
  // Repository
  clone(url: string, options?: CloneOptions): Promise<void>
  init(options?: InitOptions): Promise<void>

  // Branches
  branch(name: string): Promise<void>
  checkout(ref: string): Promise<void>
  merge(branch: string): Promise<MergeResult>

  // Remote
  fetch(remote?: string): Promise<void>
  pull(remote?: string, branch?: string): Promise<void>
  push(remote?: string, branch?: string): Promise<void>

  // Staging
  add(paths: string | string[]): Promise<void>
  commit(message: string, options?: CommitOptions): Promise<string>
  status(): Promise<GitStatus>

  // History
  log(options?: LogOptions): Promise<Commit[]>
  diff(options?: DiffOptions): Promise<string>

  // Low-level
  resolveRef(ref: string): Promise<string>
  readObject(oid: string): Promise<GitObject>
}
```

### $.bash (Shell Execution)

```typescript
interface BashCapability {
  // Execute command
  exec(command: string, args?: string[], options?: ExecOptions): Promise<ExecResult>

  // Execute with streaming
  spawn(command: string, args?: string[], options?: SpawnOptions): AsyncIterable<OutputChunk>

  // Convenience methods
  run(script: string): Promise<ExecResult>  // Run shell script
  env(key: string): string | undefined       // Get environment variable
  cwd(): string                              // Get current working directory
}

interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
}
```

## Lazy Loading Behavior

Capability modules are **only loaded when first accessed**:

```typescript
class MySite extends DO {
  async doWork() {
    // At this point, no modules are loaded yet
    console.log('Starting work...')

    // First access to $.fs loads the fsx module
    const content = await this.$.fs.read('config.json')

    // $.fs is now cached, subsequent calls don't reload
    await this.$.fs.write('output.json', JSON.stringify(data))

    // First access to $.git loads gitx (and fsx if not loaded)
    await this.$.git.commit('Update config')
  }
}
```

## Bundle Size Impact

| Entry Point    | Approx. Size | Includes                |
|----------------|--------------|-------------------------|
| `dotdo/tiny`   | ~15KB        | Base DO only            |
| `dotdo/fs`     | ~45KB        | + fsx                   |
| `dotdo/git`    | ~120KB       | + fsx, gitx             |
| `dotdo/bash`   | ~55KB        | + fsx, bashx            |
| `dotdo/full`   | ~150KB       | All modules             |

## External Package Structure

### fsx (Filesystem Extension)

```
npm install fsx

fsx/
├── index.ts        # Main export
├── capability.ts   # FsCapability implementation
├── storage.ts      # Content-addressable storage
└── types.ts        # TypeScript types
```

### gitx (Git Extension)

```
npm install gitx

gitx/
├── index.ts        # Main export
├── capability.ts   # GitCapability implementation
├── packfile.ts     # Packfile parsing
├── wire.ts         # Git wire protocol
└── types.ts        # TypeScript types
```

### bashx (Bash Extension)

```
npm install bashx

bashx/
├── index.ts        # Main export
├── capability.ts   # BashCapability implementation
├── sandbox.ts      # Sandboxed execution
└── types.ts        # TypeScript types
```

## Error Handling

Capability module errors are wrapped with context:

```typescript
try {
  await this.$.git.push()
} catch (error) {
  if (error instanceof CapabilityError) {
    console.error(`Git operation failed: ${error.message}`)
    console.error(`Module: ${error.module}`)     // 'git'
    console.error(`Operation: ${error.operation}`) // 'push'
    console.error(`Cause: ${error.cause}`)       // Original error
  }
}
```

## Best Practices

1. **Choose the minimal entry point** - Only import what you need
2. **Use mixins for custom combinations** - More control over bundle
3. **Leverage lazy loading** - Don't eagerly access capabilities
4. **Handle errors gracefully** - Capabilities may fail to load
5. **Use types for safety** - Import capability types for better IDE support

## Troubleshooting

### Module not loading

Ensure you're using the correct entry point:

```typescript
// Wrong - $.git won't exist with dotdo/tiny
import { DO } from 'dotdo/tiny'
this.$.git.status() // TypeError: Cannot read property 'status' of undefined

// Right
import { DO } from 'dotdo/git'
this.$.git.status() // Works!
```

### Type errors

Import capability types explicitly:

```typescript
import type { GitCapability } from 'gitx'

// Now TypeScript knows about $.git methods
const status: GitStatus = await this.$.git.status()
```

### Performance issues

Check if you're importing the full bundle unnecessarily:

```typescript
// Avoid - loads everything
import { DO } from 'dotdo'

// Prefer - loads only what's needed
import { DO } from 'dotdo/fs'
```
