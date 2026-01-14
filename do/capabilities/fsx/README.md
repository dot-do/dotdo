# fsx.do

**A real filesystem for Cloudflare Workers.** POSIX-compatible. Durable. 3,000+ tests.

[![npm version](https://img.shields.io/npm/v/fsx.do.svg)](https://www.npmjs.com/package/fsx.do)
[![Tests](https://img.shields.io/badge/tests-3%2C044%20passing-brightgreen.svg)](https://github.com/dot-do/fsx)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why fsx?

**Edge workers don't have filesystems.** No `fs.readFile()`. No directories. No persistence across requests.

**AI agents need filesystems.** They want to read configs, write outputs, organize files in directories, watch for changes.

**fsx gives you both:**

```typescript
import fs from 'fsx.do'

// Just like Node.js fs - but on the edge
await fs.writeFile('/app/config.json', JSON.stringify(config))
await fs.mkdir('/app/uploads', { recursive: true })
const files = await fs.readdir('/app/uploads')
```

**Scales to millions of agents.** Each agent gets its own isolated filesystem on Cloudflare's edge network. No shared state. No noisy neighbors. Just fast, persistent storage at global scale.

## Installation

```bash
npm install fsx.do
```

## Quick Start

```typescript
import fs from 'fsx.do'

// Write files
await fs.writeFile('/hello.txt', 'Hello, World!')

// Read files
const content = await fs.readFile('/hello.txt', 'utf-8')

// Create directories
await fs.mkdir('/data/uploads', { recursive: true })

// List contents
const entries = await fs.readdir('/data')

// Get metadata
const stats = await fs.stat('/hello.txt')
console.log(`Size: ${stats.size}, Modified: ${stats.mtime}`)

// Delete
await fs.unlink('/hello.txt')
```

## Features

### Tiered Storage

Small files stay fast in SQLite. Large files go to R2. You don't think about it.

```typescript
import { TieredFS } from 'fsx.do/storage'

const fs = new TieredFS({
  hot: env.FSX,           // Durable Object SQLite (fast, <1MB)
  warm: env.R2_BUCKET,    // R2 object storage (large files)
  thresholds: {
    hotMaxSize: 1024 * 1024,  // 1MB threshold
  }
})

// Automatic tier selection
await fs.writeFile('/small.json', '{}')           // → SQLite
await fs.writeFile('/large.bin', hugeBinaryData)  // → R2
```

### Streaming

Handle files larger than memory:

```typescript
// Write stream
const writable = await fs.createWriteStream('/large-file.bin')
await sourceStream.pipeTo(writable)

// Read stream
const readable = await fs.createReadStream('/large-file.bin')
for await (const chunk of readable) {
  await process(chunk)
}

// Partial reads (byte ranges)
const partial = await fs.createReadStream('/video.mp4', {
  start: 1000,
  end: 2000
})
```

### File Watching

React to changes:

```typescript
const watcher = fs.watch('/config.json', (eventType, filename) => {
  console.log(`${eventType}: ${filename}`)
  // Reload config, trigger rebuild, etc.
})

// Watch directories recursively
fs.watch('/src', { recursive: true }, (event, file) => {
  if (file.endsWith('.ts')) rebuild()
})
```

### Unix Permissions

Real permission model:

```typescript
// Set permissions
await fs.chmod('/script.sh', 0o755)  // rwxr-xr-x

// Change ownership
await fs.chown('/data', 1000, 1000)

// Check access
await fs.access('/secret', fs.constants.R_OK)
```

### Symbolic Links

```typescript
await fs.symlink('/app/current', '/app/releases/v1.2.3')
const target = await fs.readlink('/app/current')
const resolved = await fs.realpath('/app/current/config.json')
```

### CLI

```bash
npx fsx.do ls /
npx fsx.do cat /config.json
npx fsx.do mkdir /data
npx fsx.do rm /tmp/cache.json
```

## Durable Object Integration

### As a Standalone DO

```typescript
import { FileSystemDO } from 'fsx.do'

export { FileSystemDO }

export default {
  async fetch(request, env) {
    const id = env.FSX.idFromName('user-123')
    const stub = env.FSX.get(id)
    return stub.fetch(request)
  }
}
```

### With dotdo Framework

```typescript
import { DO } from 'dotdo'
import { withFs } from 'fsx.do'

class MySite extends withFs(DO) {
  async loadContent() {
    const content = await this.$.fs.read('content/index.mdx')
    const files = await this.$.fs.list('content/')
    await this.$.fs.write('cache/index.html', rendered)
  }
}
```

## API Reference

### File Operations

| Method | Description |
|--------|-------------|
| `readFile(path, encoding?)` | Read file contents |
| `writeFile(path, data, options?)` | Write file contents |
| `appendFile(path, data)` | Append to file |
| `copyFile(src, dest)` | Copy file |
| `rename(oldPath, newPath)` | Rename/move file |
| `unlink(path)` | Delete file |

### Directory Operations

| Method | Description |
|--------|-------------|
| `mkdir(path, options?)` | Create directory |
| `rmdir(path, options?)` | Remove directory |
| `readdir(path, options?)` | List directory contents |

### Metadata

| Method | Description |
|--------|-------------|
| `stat(path)` | Get file stats |
| `lstat(path)` | Get stats (don't follow symlinks) |
| `access(path, mode?)` | Check access permissions |
| `chmod(path, mode)` | Change permissions |
| `chown(path, uid, gid)` | Change ownership |
| `utimes(path, atime, mtime)` | Update timestamps |

### Links

| Method | Description |
|--------|-------------|
| `symlink(target, path)` | Create symbolic link |
| `link(existingPath, newPath)` | Create hard link |
| `readlink(path)` | Read symlink target |
| `realpath(path)` | Resolve path |

### Streams

| Method | Description |
|--------|-------------|
| `createReadStream(path, options?)` | Get readable stream |
| `createWriteStream(path, options?)` | Get writable stream |

### Watching

| Method | Description |
|--------|-------------|
| `watch(path, options?, listener?)` | Watch for changes |
| `watchFile(path, options?, listener?)` | Poll-based watching |

## Configuration

```typescript
const fs = new FSx(env.FSX, {
  // Storage tiers
  tiers: {
    hotMaxSize: 1024 * 1024,     // 1MB (files below go to SQLite)
    warmEnabled: true,            // Enable R2 for large files
  },

  // Default permissions
  defaultMode: 0o644,             // rw-r--r--
  defaultDirMode: 0o755,          // rwxr-xr-x

  // Limits
  maxFileSize: 100 * 1024 * 1024, // 100MB max file size
  maxPathLength: 4096,            // Max path length

  // Temp file cleanup
  tmpMaxAge: 24 * 60 * 60 * 1000, // 24 hours
})
```

## How It Works

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
│   • Metadata       │   • Large files                    │
│   • Small files    │   • Binary blobs                   │
│   • Fast access    │   • Cost-effective                 │
└────────────────────┴────────────────────────────────────┘
```

**Hot Tier (Durable Object SQLite)**
- File metadata (paths, permissions, timestamps)
- Small files (<1MB by default)
- Microsecond access latency

**Warm Tier (R2 Object Storage)**
- Large files and binary data
- Cost-effective at scale
- Automatic promotion/demotion

## Comparison

| Feature | fsx.do | Workers KV | R2 | D1 |
|---------|--------|------------|----|----|
| Directories | ✅ | ❌ | ❌ | ❌ |
| POSIX API | ✅ | ❌ | ❌ | ❌ |
| Permissions | ✅ | ❌ | ❌ | ❌ |
| Symlinks | ✅ | ❌ | ❌ | ❌ |
| Streaming | ✅ | ❌ | ✅ | ❌ |
| Watch | ✅ | ❌ | ❌ | ❌ |
| Large files | ✅ | 25MB | 5GB | ❌ |
| Transactions | ✅ | ❌ | ❌ | ✅ |

## Performance

- **3,044 tests** covering all operations
- **Microsecond latency** for hot tier operations
- **Zero cold starts** (Durable Objects)
- **Global distribution** (300+ Cloudflare locations)

## Packages

This repo contains two packages:

| Package | Description | Install |
|---------|-------------|---------|
| **[@dotdo/fsx](./core/)** | Pure filesystem logic. Zero dependencies. Self-hostable. | `npm i @dotdo/fsx` |
| **[fsx.do](https://fsx.do)** | Managed service with DO, tiered storage, CLI, SDK | `npm i fsx.do` |

**fsx.do re-exports everything from @dotdo/fsx** - if you're using the managed service, you get the core library too:

```typescript
// Both work the same
import { glob, grep, find, MemoryBackend } from '@dotdo/fsx'
import { glob, grep, find, MemoryBackend } from 'fsx.do'
```

## License

MIT

## Links

- [GitHub](https://github.com/dot-do/fsx)
- [Documentation](https://fsx.do)
- [npm: @dotdo/fsx](https://www.npmjs.com/package/@dotdo/fsx)
- [npm: fsx.do](https://www.npmjs.com/package/fsx.do)
- [Platform.do](https://platform.do)
