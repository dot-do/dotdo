# CLAUDE.md

This file provides guidance to Claude Code when working with the fsx codebase.

## What is fsx?

A real filesystem for Cloudflare Workers. POSIX-compatible. Durable. 3,000+ tests.

**Two packages, one architecture:**
- `@dotdo/fsx` - Pure filesystem logic with zero dependencies
- `fsx.do` - Managed service with Durable Object storage

## Architecture Overview

```
fsx/
├── core/           # @dotdo/fsx - Pure filesystem logic
│   ├── backend.ts  # FsBackend interface + MemoryBackend
│   ├── fsx.ts      # FSx main class
│   ├── types.ts    # FileEntry, Stats, Dirent, FsCapability
│   ├── errors.ts   # ENOENT, EEXIST, EISDIR, ENOTDIR, etc.
│   ├── constants.ts # S_IFREG, S_IFDIR, O_RDONLY, etc.
│   ├── path.ts     # normalize, join, resolve, dirname, basename
│   ├── fs/         # POSIX operations
│   ├── glob/       # Pattern matching (*.ts, **/*.json)
│   ├── grep/       # Content search
│   ├── find/       # File discovery
│   └── cas/        # Content-addressable storage
│
├── storage/        # Storage backends (Cloudflare-specific)
│   ├── interfaces.ts  # BlobStorage, MetadataStorage, TieredStorage
│   ├── sqlite.ts      # SQLiteMetadata - hot tier
│   ├── r2.ts          # R2Storage - warm tier
│   ├── r2-backend.ts  # R2Backend - FsBackend impl for R2
│   ├── tiered.ts      # TieredFS - automatic tier routing
│   └── tiered-r2.ts   # TieredR2Storage - R2 with hot/warm
│
├── do/             # Durable Object integration
│   ├── module.ts        # FsModule - core DO filesystem logic
│   ├── mixin.ts         # withFs() - add $.fs to DO classes
│   ├── security.ts      # PathValidator - path traversal protection
│   ├── container-executor.ts # Container exec integration
│   └── index.ts         # FileSystemDO - HTTP/RPC API layer
│
├── cli/            # npx fsx.do ls /
├── index.ts        # fsx.do entry point (re-exports core/)
└── internal/       # Internal utilities
```

## Two-Layer Architecture

### Layer 1: Core (`@dotdo/fsx`)

Pure filesystem logic with **zero Cloudflare dependencies**. Runs anywhere JavaScript runs.

```typescript
import { FSx, MemoryBackend, glob, grep, find } from '@dotdo/fsx'

// Use with any FsBackend implementation
const backend = new MemoryBackend()
const fs = new FSx(backend)

await fs.write('/hello.txt', 'Hello, World!')
const content = await fs.read('/hello.txt', { encoding: 'utf-8' })
```

**Key APIs:**
- `FSx` - Main filesystem class
- `FsBackend` - Interface for storage backends
- `MemoryBackend` - In-memory backend for testing
- `glob()`, `grep()`, `find()` - Unix-like utilities
- `Stats`, `Dirent`, `FileHandle` - POSIX types

### Layer 2: Service (`fsx.do`)

Managed service built on core with Cloudflare infrastructure.

```typescript
import { fs } from 'fsx.do'

await fs.writeFile('/config.json', JSON.stringify(config))
const data = await fs.readFile('/config.json', 'utf-8')
```

**Service additions:**
- `FileSystemDO` - Durable Object with HTTP/RPC API
- `FsModule` - Core filesystem logic for DOs
- `withFs(DO)` - Mixin for adding $.fs capability
- `TieredFS` - Automatic hot/warm tier routing
- `SQLiteMetadata` - Hot tier (fast, <1MB files)
- `R2Storage` - Warm tier (large files, cost-effective)

## FsBackend Interface

The pluggable storage interface that powers both layers:

```typescript
interface FsBackend {
  // Read operations
  readFile(path: string, options?: BackendOptions): Promise<BackendReadResult>
  stat(path: string): Promise<Stats>
  lstat(path: string): Promise<Stats>
  readdir(path: string, options?: ReaddirOptions): Promise<string[] | Dirent[]>
  readlink(path: string): Promise<string>
  realpath(path: string): Promise<string>
  access(path: string, mode?: number): Promise<void>

  // Write operations
  writeFile(path: string, data: Uint8Array | string, options?: WriteOptions): Promise<BackendWriteResult>
  mkdir(path: string, options?: MkdirOptions): Promise<void>
  rmdir(path: string, options?: RmdirOptions): Promise<void>
  unlink(path: string): Promise<void>
  rename(oldPath: string, newPath: string): Promise<void>
  copyFile(src: string, dest: string): Promise<void>

  // Metadata operations
  chmod(path: string, mode: number): Promise<void>
  chown(path: string, uid: number, gid: number): Promise<void>
  utimes(path: string, atime: Date | number, mtime: Date | number): Promise<void>

  // Links
  symlink(target: string, path: string): Promise<void>
  link(existingPath: string, newPath: string): Promise<void>

  // Tier management (optional)
  getTier?(path: string): Promise<StorageTier>
  setTier?(path: string, tier: StorageTier): Promise<void>
}
```

## Commands

```bash
npm test              # Run vitest
npm run test:watch    # Watch mode
npm run typecheck     # TypeScript check
npm run dev           # Wrangler dev server
npm run deploy        # Deploy to Cloudflare
```

### Running Tests

```bash
npx vitest run core/backend.test.ts    # Single file
npx vitest run storage/                 # Directory
npx vitest run --coverage               # With coverage
```

## Storage Tiers

```
┌─────────────────────────────────────────────────────────┐
│                      fsx.do                             │
├─────────────────────────────────────────────────────────┤
│  POSIX API Layer (readFile, writeFile, mkdir, etc.)    │
├─────────────────────────────────────────────────────────┤
│  Tiered Storage Router                                  │
├────────────────────┬────────────────────────────────────┤
│   Hot Tier         │         Warm Tier                  │
│   (SQLite)         │         (R2)                       │
│                    │                                    │
│   - Metadata       │   - Large files                    │
│   - Small files    │   - Binary blobs                   │
│   - Fast access    │   - Cost-effective                 │
└────────────────────┴────────────────────────────────────┘
```

- **Hot tier** - SQLite in Durable Object (<1MB files, microsecond latency)
- **Warm tier** - R2 object storage (large files, cost-effective)
- Automatic tier selection based on file size

## Using @dotdo/fsx vs fsx.do

| Use @dotdo/fsx when... | Use fsx.do when... |
|------------------------|--------------------|
| Self-hosting | Managed service |
| Testing with MemoryBackend | Production on Cloudflare |
| Custom storage backends | Need DO integration |
| Zero dependencies required | Need CLI/SDK |
| Library integration | Tiered storage |

Both packages share the same API - fsx.do re-exports everything from @dotdo/fsx:

```typescript
// These are equivalent
import { glob, grep, find, Stats } from '@dotdo/fsx'
import { glob, grep, find, Stats } from 'fsx.do'
```

## Issue Tracking (bd)

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git
```

## Related

- [fsx.do](https://fsx.do) - Landing page
- [platform.do](https://platform.do) - Platform
- [agents.do](https://agents.do) - AI agents
- [@mdxui/beacon](https://mdxui.dev) - Marketing sites
- [@mdxui/cockpit](https://mdxui.dev) - Developer dashboards
