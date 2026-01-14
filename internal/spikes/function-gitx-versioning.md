# Function Versioning via gitx Integration

**Issue**: dotdo-1qipb
**Status**: Investigation Complete
**Date**: 2026-01-13
**Timebox**: 2 hours

## Executive Summary

This spike investigates how gitx (dotdo's edge-native Git implementation) can be leveraged for Function versioning. The investigation found that:

1. **gitx integration is already implemented** via `GitGraphAdapter` in `db/graph/adapters/git-graph-adapter.ts`
2. **Function versioning uses the same patterns** via `FunctionGraphAdapter` and `FunctionVersionAdapter`
3. **Content-addressable storage** works identically for both Git blobs and Function code
4. **Refs/Tags map cleanly** to Function version references (latest, v1.0.0, canary, etc.)

**Recommendation**: The existing adapters provide a solid foundation. Function versioning can leverage the same graph patterns as gitx without requiring direct gitx dependencies.

---

## 1. How gitx Stores Objects as Things

### Object Types and Type IDs

gitx objects are stored as Things in the graph with dedicated type IDs from `db/graph/constants.ts`:

```typescript
// db/graph/constants.ts - Git Type IDs (range 50-99)
export const GIT_TYPE_IDS = {
  Commit: 50,
  Tree: 51,
  Blob: 52,
  Ref: 53,
} as const
```

### Thing Data Structures

Each Git object type maps to a specific Thing data schema:

```typescript
// Commit Thing
interface CommitData {
  message: string
  author: GitIdentityData
  committer: GitIdentityData
  tree: string  // SHA reference to Tree
  gpgSignature?: string
}

// Tree Thing
interface TreeData {
  entries: Array<{
    name: string
    mode: string   // '100644' | '100755' | '040000' | '120000' | '160000'
    hash: string   // SHA reference to Blob/Tree
  }>
}

// Blob Thing
interface BlobData {
  size: number
  contentRef: string  // External storage reference (e.g., 'r2:blobs/sha256-abc')
  isBinary?: boolean
}

// Ref Thing
interface RefData {
  name: string
  kind: 'branch' | 'tag' | 'remote' | 'head'
  symbolic?: boolean
  target?: string
}
```

### URL Schema

gitx uses a `do://git/` URL namespace:

```typescript
function commitUrl(id: string): string {
  return `do://git/commits/${id}`
}

function treeUrl(id: string): string {
  return `do://git/trees/${id}`
}

function blobUrl(id: string): string {
  return `do://git/blobs/${id}`
}

function refUrl(id: string): string {
  return `do://git/refs/${id}`
}
```

---

## 2. GitGraphAdapter Interface

### Location

`/Users/nathanclevenger/projects/dotdo/db/graph/adapters/git-graph-adapter.ts`

### Core Interface

```typescript
class GitGraphAdapter {
  constructor(store: GraphStore)

  // Commit Operations
  createCommit(data: {
    message: string
    tree: string
    author?: GitIdentityData
    parent?: string
    parents?: string[]  // For merge commits
  }): Promise<GraphThing>

  getCommitHistory(startCommitId: string, options?: { limit?: number }): Promise<GraphThing[]>

  // Tree Operations
  createTree(entries: TreeEntryData[]): Promise<GraphThing>
  getTreeEntries(treeId: string): Promise<Array<{ thing: GraphThing; entry: TreeEntryData }>>

  // Blob Operations (Content-Addressable)
  createBlob(data: { content: Uint8Array | string; contentRef?: string }): Promise<GraphThing>

  // Ref Operations
  createRef(name: string, kind: RefData['kind'], commitId: string): Promise<GraphThing>
  resolveRef(refName: string): Promise<GraphThing | null>

  // Checkout
  checkout(refName: string): Promise<Map<string, GraphThing>>
}
```

### Key Design Patterns

1. **Relationship-Based Navigation**: All object relationships use graph edges with verbs:
   - Commit `parent` Commit (history chain)
   - Commit `hasTree` Tree
   - Tree `contains` Blob|Tree
   - Ref `pointsTo` Commit

2. **Content-Addressable IDs**: Blob IDs are derived from SHA-256 hashes:
   ```typescript
   function hashContent(content: Uint8Array | string): string {
     const data = typeof content === 'string' ? Buffer.from(content) : content
     return createHash('sha256').update(data).digest('hex').substring(0, 40)
   }
   ```

3. **Ref Caching**: Refs are cached by normalized name for fast lookups.

4. **Recursive Tree Traversal**: `collectTreeFiles()` handles nested directory structures.

---

## 3. Mapping Refs/Tags to Function Versions

### Ref Types for Functions

The existing `FunctionVersionAdapter` (`db/graph/adapters/function-version-adapter.ts`) already implements this mapping:

| Git Concept | Function Equivalent | Use Case |
|-------------|---------------------|----------|
| `refs/heads/main` | `latest` | Current production version |
| `refs/tags/v1.0.0` | `v1.0.0` | Semantic version tag |
| Custom ref | `canary`, `stable` | Deployment channels |
| Multiple refs to same commit | Multiple refs to same SHA | A/B testing |

### FunctionRef Data Structure

```typescript
interface FunctionRefData {
  name: string      // 'latest', 'v1.0.0', 'canary', etc.
  kind: 'latest' | 'version' | 'tag' | 'channel'
  functionId: string  // Which function this ref belongs to
}
```

### Ref Resolution Flow

```
resolveRef(functionId, 'latest')
    |
    v
Find FunctionRef Thing where data.functionId == functionId && data.name == 'latest'
    |
    v
Query 'pointsTo' relationship from FunctionRef
    |
    v
Return target FunctionVersion Thing
```

### A/B Testing Support

Multiple refs can point to different versions of the same function:

```typescript
// Create A/B test variants
await adapter.createRef(func.id, 'control', 'channel', versionAData.sha)
await adapter.createRef(func.id, 'experiment', 'channel', versionBData.sha)

// Resolve based on traffic routing
const variant = await adapter.resolveRef(func.id, userInExperiment ? 'experiment' : 'control')
```

---

## 4. Content-Addressable Storage Pattern for Function Code

### Pattern Overview

Function code follows the exact same content-addressable pattern as Git blobs:

```typescript
// Generate deterministic ID from content hash
const sha = hashContent(data.content)  // SHA-256, truncated to 40 chars

// Check if blob already exists (deduplication)
const existing = await this.store.getThing(sha)
if (existing) {
  return existing  // Return existing instead of creating duplicate
}

// Create new blob with content reference
const blobData: FunctionBlobData = {
  size: getContentSize(data.content),
  contentRef: `internal:${sha}`,  // Or 'r2:functions/sha256-...'
  contentType: detectContentType(data.content),
  hash: sha,
}
```

### Type IDs for Function Versioning

From `db/graph/constants.ts`:

```typescript
// Function versioning types (range 110-119) - FunctionGraphAdapter
export const FUNCTION_TYPE_IDS = {
  FunctionVersion: 110,
  FunctionRef: 111,
  FunctionBlob: 112,
}

// Alternative range (120-129) - FunctionVersionAdapter (gitx-style)
export const FUNCTION_VERSION_TYPE_IDS = {
  Function: 120,
  FunctionVersion: 121,
  FunctionBlob: 122,
  FunctionRef: 123,
}
```

### Relationship Schema

```
FunctionVersion (sha)
    |
    |-- definedIn --> Function
    |-- parent --> FunctionVersion (previous version)
    |-- hasContent --> FunctionBlob

FunctionRef
    |
    |-- pointsTo --> FunctionVersion
```

### Content Storage Strategy

1. **Small Functions (<1MB)**: Store inline in SQLite via contentRef `internal:{sha}`
2. **Large Functions (>1MB)**: Store in R2 via contentRef `r2:functions/{sha}`
3. **WASM Modules**: Detect via magic bytes, store as binary with `application/wasm` contentType

---

## 5. Recommended Approach

### Option A: Use Existing FunctionGraphAdapter (Recommended)

The `FunctionGraphAdapter` (`db/graph/adapters/function-graph-adapter.ts`) already provides:
- Function CRUD with type-specific IDs (Code/Generative/Agentic/Human)
- Cascade chain resolution
- Version creation with content-addressable storage
- Ref management for version references
- Ownership and access control via relationships

**Pros**:
- Already implemented and tested
- Integrated with cascade chains
- Supports all function types

**Cons**:
- Separate from gitx integration (no direct git commands)

### Option B: Use FunctionVersionAdapter (gitx-style)

The `FunctionVersionAdapter` (`db/graph/adapters/function-version-adapter.ts`) provides a more gitx-aligned API:
- `createFunction()` / `createVersion()` / `createRef()` mirrors git workflow
- `getVersionHistory()` traverses parent chain
- `rollback()` moves refs to previous versions

**Pros**:
- Closer conceptual alignment with gitx
- Cleaner version history traversal

**Cons**:
- Doesn't integrate cascade chain logic
- Different type ID range (120-129)

### Option C: Hybrid - Use gitx Directly for Function Storage

Store Function code as actual gitx blobs, with:
- Function metadata as commits
- Code as blobs in trees
- Versions as commit refs

**Pros**:
- Full git compatibility (clone, push, pull)
- Unified storage model

**Cons**:
- Requires gitx adapter extension
- Overhead for simple functions
- Complexity for non-code function types (Generative/Human)

### Recommendation

**Use Option A (FunctionGraphAdapter)** for the following reasons:

1. **Already GREEN**: Tests pass, implementation complete
2. **Cascade Integration**: Works with Code -> Generative -> Agentic -> Human cascade chains
3. **Type Safety**: Proper type IDs for each function kind
4. **Separation of Concerns**: Function versioning doesn't need full git semantics (branches, merges)

The gitx patterns have been successfully adopted without requiring direct gitx dependency.

---

## 6. Blockers and Dependencies

### Resolved Dependencies

- **dotdo-6otdo** (Functions as Graph Things) - CLOSED: Functions stored as Things
- **dotdo-pf9ui** (gitx-as-Things GREEN) - IMPLEMENTED: GitGraphAdapter complete

### No Blockers Identified

The investigation found no blocking issues. Both adapters are implemented and tested.

---

## 7. Key Files Referenced

| File | Description |
|------|-------------|
| `/Users/nathanclevenger/projects/dotdo/db/graph/adapters/git-graph-adapter.ts` | GitGraphAdapter implementation |
| `/Users/nathanclevenger/projects/dotdo/db/graph/adapters/function-graph-adapter.ts` | FunctionGraphAdapter with cascade chains |
| `/Users/nathanclevenger/projects/dotdo/db/graph/adapters/function-version-adapter.ts` | Gitx-style function versioning |
| `/Users/nathanclevenger/projects/dotdo/db/graph/constants.ts` | Type ID definitions |
| `/Users/nathanclevenger/projects/dotdo/db/graph/types.ts` | GraphStore interface |
| `/Users/nathanclevenger/projects/dotdo/db/graph/tests/gitx-integration.test.ts` | GitGraphAdapter tests |
| `/Users/nathanclevenger/projects/dotdo/db/graph/tests/function-versioning.test.ts` | Function versioning tests |
| `/Users/nathanclevenger/projects/dotdo/primitives/gitx/core/objects/types.ts` | Git object type definitions |
| `/Users/nathanclevenger/projects/dotdo/primitives/gitx/core/refs/index.ts` | Git refs implementation |

---

## 8. Appendix: Test Patterns

### Content-Addressable Storage Test

```typescript
it('generates deterministic SHA from content', async () => {
  const content = 'export function processOrder() { return true }'

  const v1 = await adapter.createVersion({ functionId, content, message: 'V1' })
  const v2 = await adapter.createVersion({ functionId, content, message: 'V2' })

  // Same content = same SHA
  expect(v1Data.sha).toBe(v2Data.sha)
})
```

### Version History Traversal Test

```typescript
it('traverses version chain via parent relationships', async () => {
  // Create chain: v1 <- v2 <- v3
  const v1 = await adapter.createVersion({ content: 'v1', message: 'First' })
  const v2 = await adapter.createVersion({ content: 'v2', parentSha: v1.sha })
  const v3 = await adapter.createVersion({ content: 'v3', parentSha: v2.sha })

  const history = await adapter.getVersionHistory(funcId, v3.sha)

  expect(history.length).toBe(3)
  expect(history[0].message).toBe('Third')
  expect(history[2].message).toBe('First')
})
```

### A/B Testing via Multiple Refs Test

```typescript
it('supports multiple refs for A/B testing', async () => {
  await adapter.createRef(funcId, 'control', 'channel', versionA.sha)
  await adapter.createRef(funcId, 'experiment', 'channel', versionB.sha)

  const control = await adapter.resolveRef(funcId, 'control')
  const experiment = await adapter.resolveRef(funcId, 'experiment')

  expect(control.sha).toBe(versionA.sha)
  expect(experiment.sha).toBe(versionB.sha)
})
```
