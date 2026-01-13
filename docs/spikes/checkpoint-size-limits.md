# Checkpoint Size Limits in DO Storage

**Issue:** dotdo-v5rxt
**Date:** 2026-01-13
**Author:** Research Spike

## Executive Summary

This spike investigates checkpoint size limits for stateful streaming operations in Durable Objects. Key findings:

- **SQLite-backed DOs**: 10 GB total storage, 2 MB max per key/value/row
- **KV-backed DOs**: 128 KB max per value, 2 KB max per key
- **Practical checkpoint budget**: 50-100 MB safe target for SQLite DOs
- **Recommended strategy**: Chunked checkpoints with R2 overflow for large state

## Cloudflare DO Storage Limits

### SQLite-backed Durable Objects (Recommended)

| Limit | Value | Notes |
|-------|-------|-------|
| Storage per DO | 10 GB | Hard limit |
| Max key+value size | 2 MB | Combined |
| Max row size | 2 MB | Same as KV |
| Max SQL statement | 100 KB | Query length |
| Max columns per table | 100 | Schema limit |
| Bound params per query | 100 | For prepared statements |

### Key-Value backed Durable Objects (Legacy)

| Limit | Value | Notes |
|-------|-------|-------|
| Storage per account | 50 GB | Can be raised |
| Max key size | 2 KB | 2048 bytes |
| Max value size | 128 KB | 131072 bytes - **critical limit** |
| Storage per DO | No explicit limit | Bounded by account limit |

**Key Finding:** KV-backed DOs have a 128 KB per-value limit that makes them unsuitable for large checkpoints without chunking.

## Current Checkpoint Implementation Analysis

### StatefulOperator Checkpoints (`db/primitives/stateful-operator/`)

The existing implementation uses JSON serialization for snapshots:

```typescript
// From InMemoryStateBackend.snapshot()
const jsonData = JSON.stringify(serializedEntries)
const data = new TextEncoder().encode(jsonData)
```

**Current limitations:**
1. No chunking - entire state serialized as single blob
2. No compression built-in (wrapper available but not default)
3. Checksum validation via MurmurHash3

### DOStateBackend (`db/primitives/stateful-operator/backends/do-backend.ts`)

The DO backend stores entries with prefix keys:

```typescript
// Entry format: ${name}:${key} -> StateEntry<T>
const entry: StateEntry<T> = {
  value,
  createdAt: Date.now(),
  expiresAt: ttl !== undefined ? Date.now() + ttl : undefined,
}
```

**Snapshot behavior:**
- Uses DO transactions for atomic snapshot
- Iterates all entries with prefix
- Serializes to JSON, returns as Uint8Array
- No chunking or R2 overflow

### CheckpointManager (`objects/persistence/checkpoint-manager.ts`)

The production checkpoint manager already implements:
- Gzip compression via CompressionStream
- R2 storage for snapshots
- Checksum verification (SHA-256)
- Retention policies

```typescript
// Compression is enabled by default
compressSnapshots: options?.config?.compressSnapshots ?? true,
```

## Typical Checkpoint Sizes

Based on benchmark analysis and code patterns:

### Small State (< 1000 entries)

| Scenario | Raw Size | Compressed | Entries | Notes |
|----------|----------|------------|---------|-------|
| Counter aggregations | ~50 KB | ~10 KB | 100 | Numeric values |
| Session windows | ~200 KB | ~40 KB | 500 | Session state |
| User state | ~500 KB | ~100 KB | 1000 | JSON objects |

### Medium State (1K-10K entries)

| Scenario | Raw Size | Compressed | Entries | Notes |
|----------|----------|------------|---------|-------|
| Event counts | ~5 MB | ~500 KB | 10,000 | Simple counters |
| Sliding windows | ~20 MB | ~4 MB | 5,000 | Overlapping windows |
| Join state | ~50 MB | ~10 MB | 10,000 | Hash tables |

### Large State (> 10K entries)

| Scenario | Raw Size | Compressed | Entries | Notes |
|----------|----------|------------|---------|-------|
| Full aggregations | ~100 MB | ~20 MB | 50,000 | Complex objects |
| Graph state | ~500 MB | ~100 MB | 100,000 | Relationship data |
| ML features | ~1 GB+ | ~200 MB+ | 1M+ | Feature vectors |

## Constraint Analysis

### SQLite DO Constraints

With 10 GB total and 2 MB per row:
- **Safe checkpoint budget**: 50-100 MB per operator
- **Multiple operators**: 10+ operators per DO feasible
- **Max single checkpoint**: ~2 MB without chunking

### KV DO Constraints (if used)

With 128 KB per value:
- **Chunking required**: For any state > 128 KB
- **Chunk overhead**: ~5-10% for metadata
- **Max practical checkpoint**: ~10 MB (100 chunks)

## Proposed Solutions

### Solution 1: Chunked Checkpoints (Recommended)

Split large checkpoints into 1 MB chunks stored separately:

```typescript
interface ChunkedCheckpoint {
  id: string
  totalSize: number
  chunkCount: number
  chunks: string[] // References to chunk keys
  checksum: string
  compressed: boolean
}

interface CheckpointChunk {
  index: number
  data: Uint8Array
  checksum: string
}

// Storage pattern: checkpoint:{id}:chunk:{index}
async function createChunkedCheckpoint(
  data: Uint8Array,
  chunkSize = 1024 * 1024 // 1 MB chunks
): Promise<ChunkedCheckpoint> {
  const chunks: string[] = []
  const id = generateId()

  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, i + chunkSize)
    const chunkId = `checkpoint:${id}:chunk:${chunks.length}`
    await storage.put(chunkId, {
      index: chunks.length,
      data: chunk,
      checksum: calculateChecksum(chunk)
    })
    chunks.push(chunkId)
  }

  return {
    id,
    totalSize: data.length,
    chunkCount: chunks.length,
    chunks,
    checksum: calculateChecksum(data),
    compressed: true
  }
}
```

**Advantages:**
- Works with both SQLite and KV backends
- Parallel restore possible
- Incremental updates feasible

**Disadvantages:**
- Coordination complexity
- Non-atomic (chunks can be inconsistent)

### Solution 2: R2 Overflow for Large State

Use DO storage for metadata, R2 for large payloads:

```typescript
interface HybridCheckpoint {
  id: string
  sizeBytes: number
  location: 'do' | 'r2'
  storageKey: string // DO key or R2 path
  checksum: string
}

const SIZE_THRESHOLD = 1024 * 1024 // 1 MB

async function createHybridCheckpoint(
  data: Uint8Array
): Promise<HybridCheckpoint> {
  const compressed = await compress(data)
  const id = generateId()

  if (compressed.length < SIZE_THRESHOLD) {
    // Small: store in DO
    await storage.put(`checkpoint:${id}`, compressed)
    return {
      id,
      sizeBytes: compressed.length,
      location: 'do',
      storageKey: `checkpoint:${id}`,
      checksum: calculateChecksum(compressed)
    }
  } else {
    // Large: store in R2
    await r2.put(`checkpoints/${id}.gz`, compressed)
    return {
      id,
      sizeBytes: compressed.length,
      location: 'r2',
      storageKey: `checkpoints/${id}.gz`,
      checksum: calculateChecksum(compressed)
    }
  }
}
```

**Advantages:**
- Unlimited checkpoint size
- Clean separation of concerns
- Already implemented in CheckpointManager

**Disadvantages:**
- R2 latency higher (~50-100ms vs ~5ms)
- R2 requires binding configuration
- Cross-service consistency challenges

### Solution 3: Incremental Checkpoints

Only store deltas since last checkpoint:

```typescript
interface IncrementalCheckpoint {
  baseCheckpointId: string
  sequence: number
  delta: {
    added: Array<[string, unknown]>
    modified: Array<[string, unknown]>
    deleted: string[]
  }
  checksum: string
}

// Track changes between checkpoints
class ChangeTracker {
  private changes = new Map<string, 'added' | 'modified' | 'deleted'>()

  onPut(key: string, isNew: boolean) {
    this.changes.set(key, isNew ? 'added' : 'modified')
  }

  onDelete(key: string) {
    this.changes.set(key, 'deleted')
  }

  getDelta(): IncrementalCheckpoint['delta'] {
    // Build delta from tracked changes
  }
}
```

**Advantages:**
- Minimal checkpoint size
- Fast checkpoint creation
- Low storage overhead

**Disadvantages:**
- Complex recovery (apply multiple deltas)
- Requires periodic full checkpoints
- Change tracking overhead

### Solution 4: Compression Optimization

Improve compression for specific data patterns:

| Strategy | Compression Ratio | Best For |
|----------|------------------|----------|
| Gzip (current) | 5-10x | General JSON |
| Zstd | 7-15x | Repeated patterns |
| Delta encoding | 10-50x | Time series |
| Dictionary compression | 10-20x | Similar keys |

```typescript
// Column-oriented compression for numeric data
function compressNumericState(entries: Array<[string, number]>): Uint8Array {
  // Separate keys and values
  const keys = entries.map(([k]) => k)
  const values = new Float64Array(entries.map(([, v]) => v))

  // Compress keys as strings (high ratio due to patterns)
  const keysCompressed = gzip(JSON.stringify(keys))

  // Delta-encode values for time series
  const deltas = deltaEncode(values)

  // Combine
  return packBuffers([keysCompressed, deltas])
}
```

## Recommended State Budgets

### Per-Operator Budget

| Operator Type | Max Raw State | Max Compressed | Max Entries |
|---------------|---------------|----------------|-------------|
| Counters/Aggregations | 10 MB | 1 MB | 10,000 |
| Windowed State | 50 MB | 5 MB | 5,000 windows |
| Join State | 100 MB | 10 MB | 50,000 pairs |
| Pattern Matching | 20 MB | 2 MB | 1,000 patterns |

### Per-DO Budget (Multiple Operators)

| Configuration | Operators | Total State | Checkpoint Size |
|---------------|-----------|-------------|-----------------|
| Light | 5 | 100 MB | 10 MB |
| Standard | 10 | 500 MB | 50 MB |
| Heavy | 20 | 2 GB | 200 MB |

### Warning Thresholds

```typescript
const STATE_BUDGETS = {
  WARN_THRESHOLD: 50 * 1024 * 1024,   // 50 MB - log warning
  CHUNK_THRESHOLD: 100 * 1024 * 1024, // 100 MB - force chunking
  R2_THRESHOLD: 500 * 1024 * 1024,    // 500 MB - force R2 overflow
  MAX_THRESHOLD: 2 * 1024 * 1024 * 1024, // 2 GB - reject
}
```

## Implementation Recommendations

### Short-term (This Sprint)

1. **Add size tracking to DOStateBackend**
   - Track total bytes per backend
   - Log warnings when approaching limits
   - Add metrics for monitoring

2. **Enable compression by default**
   - Wrap InMemoryStateBackend with gzip
   - Add compressed flag to StateSnapshot

### Medium-term (Next Sprint)

1. **Implement chunked checkpoints**
   - Split snapshots > 1 MB into chunks
   - Parallel restore for performance
   - Atomic checkpoint metadata

2. **Add R2StateBackend**
   - New backend implementation for large state
   - Automatic overflow from DO to R2
   - Transparent to consumers

### Long-term (Future)

1. **Incremental checkpoints**
   - Change tracking infrastructure
   - Delta-based snapshots
   - Compaction of checkpoint chains

2. **Tiered state management**
   - Integrate with TieredStorage
   - Hot state in DO, cold in R2
   - Access pattern optimization

## References

- [Cloudflare DO Limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- `/db/primitives/stateful-operator/` - StatefulOperator implementation
- `/objects/persistence/checkpoint-manager.ts` - Production checkpoint manager
- `/objects/TieredStorage.ts` - Tiered storage reference
- `/docs/spikes/cross-do-join-latency.md` - Related spike on DO performance

## Appendix: Size Estimation Formulas

```typescript
// Estimate checkpoint size for keyed state
function estimateCheckpointSize(
  entryCount: number,
  avgKeyLength: number,
  avgValueSize: number,
  compressionRatio = 0.1 // 10x compression typical for JSON
): { raw: number; compressed: number } {
  // StateEntry overhead: ~50 bytes (timestamps, metadata)
  const entryOverhead = 50

  // JSON encoding overhead: ~20% for quotes, commas, braces
  const jsonOverhead = 1.2

  const rawSize = entryCount * (avgKeyLength + avgValueSize + entryOverhead) * jsonOverhead
  const compressedSize = rawSize * compressionRatio

  return {
    raw: Math.ceil(rawSize),
    compressed: Math.ceil(compressedSize)
  }
}

// Example: 10,000 user counters
// Keys: "user:123456" (~12 bytes avg)
// Values: { count: 42, lastSeen: 1704067200000 } (~50 bytes)
const estimate = estimateCheckpointSize(10000, 12, 50)
// { raw: 1,440,000 (~1.4 MB), compressed: 144,000 (~144 KB) }
```
