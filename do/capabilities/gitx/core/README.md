# @dotdo/gitx

Pure Git implementation in TypeScript. Parse objects, read/write pack files, handle delta compression, manage refs. Zero dependencies - runs anywhere JavaScript runs.

## Installation

```bash
npm install @dotdo/gitx
```

## Features

- **Git Objects** - Parse and create blobs, trees, commits, and tags
- **Pack Files** - Read and write git pack format with delta compression
- **Refs Management** - Handle branches, tags, HEAD, and symbolic refs
- **Protocol Support** - Smart HTTP protocol for fetch/push

## Usage

```typescript
import {
  parseObject,
  createCommit,
  createTree,
  hashObject
} from '@dotdo/gitx'

// Parse a git object
const obj = parseObject(buffer)
// { type: 'commit', size: 245, data: {...} }

// Create a tree
const tree = createTree([
  { mode: '100644', name: 'README.md', hash: 'abc123...' },
  { mode: '040000', name: 'src', hash: 'def456...' }
])

// Create a commit
const commit = createCommit({
  tree: treeHash,
  parents: [parentHash],
  author: { name: 'Dev', email: 'dev@example.com.ai', timestamp: Date.now() },
  message: 'Initial commit'
})

// Hash an object
const hash = await hashObject('blob', content)
```

## Subpath Exports

```typescript
import { Blob, Tree, Commit, Tag, parseObject } from '@dotdo/gitx/objects'
import { PackReader, PackWriter, applyDelta } from '@dotdo/gitx/pack'
import { RefStorage, parseRef, resolveRef } from '@dotdo/gitx/refs'
import { smartHttp, pktLine } from '@dotdo/gitx/protocol'
```

## API

### Objects (`@dotdo/gitx/objects`)

- `parseObject(buffer: Uint8Array): GitObject`
- `createBlob(content: string | Uint8Array): Uint8Array`
- `createTree(entries: TreeEntry[]): Uint8Array`
- `createCommit(data: CommitData): Uint8Array`
- `createTag(data: TagData): Uint8Array`
- `hashObject(type: string, data: Uint8Array): Promise<string>`

### Pack (`@dotdo/gitx/pack`)

- `PackReader` - Read objects from pack files
- `PackWriter` - Write pack files with delta compression
- `applyDelta(base: Uint8Array, delta: Uint8Array): Uint8Array`
- `createDelta(source: Uint8Array, target: Uint8Array): Uint8Array`

### Refs (`@dotdo/gitx/refs`)

- `parseRef(content: string): Ref`
- `resolveRef(name: string, storage): Promise<string>`
- `RefStorage` - Interface for ref persistence

### Protocol (`@dotdo/gitx/protocol`)

- `pktLine.encode(data: string): Uint8Array`
- `pktLine.decode(buffer: Uint8Array): string[]`
- `smartHttp.advertiseRefs(refs: Ref[]): Uint8Array`

## Related

- [gitx.do](https://gitx.do) - Managed service with R2 storage
- [fsx.do](https://fsx.do) - Filesystem for Workers
- [bashx.do](https://bashx.do) - Shell execution for Workers

## License

MIT
