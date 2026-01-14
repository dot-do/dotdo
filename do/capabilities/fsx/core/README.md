# @dotdo/fsx

**POSIX filesystem implementation in TypeScript.** Pure logic. Zero dependencies. Self-hostable.

[![npm version](https://img.shields.io/npm/v/@dotdo/fsx.svg)](https://www.npmjs.com/package/@dotdo/fsx)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## What is this?

**The filesystem logic without the infrastructure.** All POSIX operations, path handling, glob patterns, grep, find - implemented in pure TypeScript with no Cloudflare dependencies.

Bring your own storage backend. Run anywhere JavaScript runs.

```typescript
import { MemoryBackend, readFile, writeFile, mkdir } from '@dotdo/fsx'

const backend = new MemoryBackend()

await mkdir('/data', { backend })
await writeFile('/data/config.json', '{}', { backend })
const content = await readFile('/data/config.json', { backend })
```

## Installation

```bash
npm install @dotdo/fsx
```

## Architecture

```
@dotdo/fsx
├── types.ts        # FileEntry, Stats, Dirent, FsCapability
├── errors.ts       # ENOENT, EEXIST, EISDIR, ENOTDIR, etc.
├── constants.ts    # S_IFREG, S_IFDIR, O_RDONLY, etc.
├── path.ts         # normalize, join, resolve, dirname, basename
├── backend.ts      # FsBackend interface + MemoryBackend
├── fs/             # POSIX operations (readFile, writeFile, stat, etc.)
├── glob/           # Pattern matching (*.ts, **/*.json)
├── grep/           # Content search
├── find/           # File discovery
└── cas/            # Content-addressable storage
```

## FsBackend Interface

Implement this interface to add your own storage:

```typescript
import type { FsBackend, Stats, Dirent } from '@dotdo/fsx'

class MyStorageBackend implements FsBackend {
  async readFile(path: string): Promise<Uint8Array> { ... }
  async writeFile(path: string, data: Uint8Array): Promise<void> { ... }
  async stat(path: string): Promise<Stats> { ... }
  async readdir(path: string): Promise<string[] | Dirent[]> { ... }
  async mkdir(path: string): Promise<void> { ... }
  async unlink(path: string): Promise<void> { ... }
  async rename(old: string, new_: string): Promise<void> { ... }
  async copyFile(src: string, dest: string): Promise<void> { ... }
  // ... full interface in backend.ts
}
```

Built-in backends:
- `MemoryBackend` - In-memory filesystem for testing

## Submodule Exports

```typescript
// Core types and errors
import { FileEntry, Stats, ENOENT, EEXIST } from '@dotdo/fsx'

// Path utilities
import { normalize, join, resolve, dirname, basename } from '@dotdo/fsx/path'

// Glob patterns
import { glob, minimatch } from '@dotdo/fsx/glob'

// Grep (content search)
import { grep, grepFile } from '@dotdo/fsx/grep'

// Find (file discovery)
import { find } from '@dotdo/fsx/find'

// Content-addressable storage
import { sha256, compress, decompress } from '@dotdo/fsx/cas'
```

## POSIX Compatibility

Full POSIX semantics:

| Operation | Status |
|-----------|--------|
| readFile / writeFile | Complete |
| stat / lstat | Complete |
| readdir | Complete with Dirent |
| mkdir / rmdir | Complete with recursive |
| unlink / rename | Complete |
| chmod / chown | Complete |
| symlink / readlink | Complete |
| link (hard links) | Complete |
| utimes | Complete |
| access | Complete |

## Want a managed service?

**[fsx.do](https://github.com/dot-do/fsx)** is the managed service built on @dotdo/fsx:

- Durable Object integration
- Tiered storage (SQLite + R2)
- CLI: `npx fsx.do ls /`
- SDK: `import { fs } from 'fsx.do'`
- HTTP API
- File watching
- Content streaming

```typescript
// fsx.do re-exports everything from @dotdo/fsx
import { glob, grep, find, MemoryBackend } from 'fsx.do'
```

## License

MIT

## Links

- [fsx.do (managed service)](https://github.com/dot-do/fsx)
- [npm: @dotdo/fsx](https://www.npmjs.com/package/@dotdo/fsx)
- [npm: fsx.do](https://www.npmjs.com/package/fsx.do)
