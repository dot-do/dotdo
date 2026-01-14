# Memory Limits for Intermediate Results

**Issue:** dotdo-ck97t
**Date:** 2026-01-13
**Type:** SPIKE - Research and documentation

## Executive Summary

This spike investigates memory management for query intermediate results in Durable Objects. Key findings:

- **DO Memory Limit**: 128 MB per isolate (shared across concurrent DOs)
- **Graceful Handling**: When exceeded, in-flight requests complete but new isolate created
- **SQLite Storage**: 10 GB per DO, 2 MB max per row/value - ideal for spilling
- **Existing Infrastructure**: BackpressureController, CollectionLimits, and streaming already implemented

## Cloudflare Workers/DO Memory Constraints

### Memory Limits

| Resource | Limit | Notes |
|----------|-------|-------|
| Memory per isolate | 128 MB | Includes JS heap + WebAssembly |
| Memory sharing | Multiple DOs per isolate | Billed as 128 MB each regardless |
| Overflow handling | Graceful | New isolate created, in-flight complete |

### CPU Constraints

| Resource | Limit | Notes |
|----------|-------|-------|
| CPU time per request | 30 seconds (default) | Resets on each incoming request |
| Max CPU time | 5 minutes | Configurable via `limits.cpu_ms` |

### Storage (for spilling)

| Resource | Limit | Notes |
|----------|-------|-------|
| SQLite per DO | 10 GB | Ample room for overflow |
| Row/value size | 2 MB | Max per entry |
| R2 objects | Unlimited | For large overflow |

## Strategies for Large Result Sets

### 1. Streaming (Preferred)

Already implemented in multiple locations:

```typescript
// db/compat/graph/src/streaming.ts - $stream and $batch support
for await (const node of traversal.follows.$stream) {
  // Process one node at a time
}

for await (const batch of traversal.follows.$batch(100)) {
  // Process in batches
}

// objects/CollectionLimits.ts - Async generator streaming
async *stream(): AsyncGenerator<T> {
  for (const [_, value] of this.storage) {
    yield value
  }
}
```

**Best for:**
- Graph traversals
- Large collection iteration
- Real-time data processing

### 2. Cursor-Based Pagination

Already implemented in `CollectionLimits.ts`:

```typescript
interface PaginatedResult<T> {
  items: T[]
  cursor: string | null
  hasMore: boolean
  totalEstimate?: number
}

// Usage
const page1 = await manager.list({ limit: 100 })
const page2 = await manager.list({ cursor: page1.cursor, limit: 100 })
```

**Best for:**
- API responses
- UI pagination
- Large result sets with random access needs

### 3. Backpressure Control

Implemented in `db/primitives/cdc/backpressure.ts`:

```typescript
const controller = new BackpressureController<MyEvent>({
  highWatermark: 1000,      // Pause when buffer reaches this
  lowWatermark: 200,        // Resume when drops to this
  overflowStrategy: OverflowStrategy.BUFFER_TO_DISK, // Spill to storage
  maxWaitMs: 30000,
})

// Strategies available:
// - BLOCK: Producer blocks until space available
// - DROP_OLDEST: Discard oldest events
// - DROP_NEWEST: Discard incoming events
// - BUFFER_TO_DISK: Spill to persistent storage
// - SAMPLE: Keep every Nth event under pressure
```

**Best for:**
- Streaming pipelines
- CDC processing
- Event-driven systems

### 4. Spilling to Storage

#### SQLite Spilling (Recommended for < 10 GB)

```typescript
// DiskBuffer interface from backpressure.ts
interface DiskBuffer<T> {
  write(events: BufferedEvent<T>[]): Promise<void>
  read(limit: number): Promise<BufferedEvent<T>[]>
  delete(sequences: number[]): Promise<void>
  size(): Promise<number>
  clear(): Promise<void>
}

// Implementation would use DO's SQLite storage
class SQLiteDiskBuffer<T> implements DiskBuffer<T> {
  async write(events: BufferedEvent<T>[]): Promise<void> {
    await this.sql`
      INSERT INTO overflow_buffer (sequence, data, pushed_at)
      VALUES ${events.map(e => [e.sequence, JSON.stringify(e.data), e.pushedAt])}
    `
  }

  async read(limit: number): Promise<BufferedEvent<T>[]> {
    return this.sql`
      SELECT * FROM overflow_buffer
      ORDER BY sequence ASC
      LIMIT ${limit}
    `
  }
}
```

#### R2 Spilling (For > 10 GB or cold data)

From `docs/spikes/checkpoint-size-limits.md`:

```typescript
const SIZE_THRESHOLD = 1024 * 1024 // 1 MB

async function createHybridCheckpoint(data: Uint8Array): Promise<HybridCheckpoint> {
  const compressed = await compress(data)

  if (compressed.length < SIZE_THRESHOLD) {
    // Small: store in DO SQLite
    await storage.put(`checkpoint:${id}`, compressed)
    return { location: 'do', ... }
  } else {
    // Large: store in R2
    await r2.put(`checkpoints/${id}.gz`, compressed)
    return { location: 'r2', ... }
  }
}
```

### 5. Memory Pressure Detection

#### Heuristic Approach (Current)

```typescript
// From CollectionLimits.ts
type LimitWarningType = 'approaching_limit' | 'at_limit' | 'memory_pressure' | 'slow_query'

// Monitor collection sizes
const stats = manager.getCollectionStats()
if (stats.isAtWarning) {
  // Take preventive action
}
```

#### Size Estimation

From streaming pipeline tests:

```typescript
const memoryEstimate = pipeline.estimateMemoryUsage()
// Returns: { total, windowState, accumulatorState }
```

## Memory Budget Guidelines

### Per-Query Budget

| Query Type | Max In-Memory | Strategy |
|------------|---------------|----------|
| Simple scan | 50 MB | Streaming |
| Aggregation | 20 MB | Hash + spill |
| Join (small) | 30 MB | Hash join |
| Join (large) | 10 MB build side | Spill probe |
| Sort | 30 MB | External sort |

### Warning Thresholds

```typescript
const MEMORY_BUDGETS = {
  // Per-query limits
  QUERY_WARN: 30 * 1024 * 1024,      // 30 MB - log warning
  QUERY_SPILL: 50 * 1024 * 1024,     // 50 MB - start spilling
  QUERY_ABORT: 80 * 1024 * 1024,     // 80 MB - abort query

  // Per-DO aggregate limits (multiple concurrent queries)
  DO_WARN: 80 * 1024 * 1024,         // 80 MB - shed load
  DO_CRITICAL: 100 * 1024 * 1024,    // 100 MB - emergency measures
}
```

## Graceful Degradation Strategies

### 1. Query Rewriting

When memory pressure detected:
- Add LIMIT clauses
- Convert to streaming
- Force cursor pagination

### 2. Load Shedding

```typescript
if (memoryUsage > MEMORY_BUDGETS.DO_WARN) {
  // Reject new queries with 503
  // Allow in-flight to complete
  // Emit metric for alerting
}
```

### 3. Automatic Spill Mode

```typescript
// Execution engine can switch modes
if (estimatedResultSize > MEMORY_BUDGETS.QUERY_SPILL) {
  // Use external sort instead of in-memory
  // Use hash-based aggregation with disk backing
  // Use nested-loop join instead of hash join
}
```

## Existing Implementations Summary

| Component | Location | Memory Strategy |
|-----------|----------|-----------------|
| BackpressureController | `db/primitives/cdc/backpressure.ts` | Watermarks + disk spill |
| CollectionManager | `objects/CollectionLimits.ts` | Cursor pagination + streaming |
| StreamingTraversal | `db/compat/graph/src/streaming.ts` | Async iterators |
| StreamingPipeline | `db/primitives/aggregation-pipeline/` | Checkpointing + windows |
| CheckpointManager | `objects/persistence/` | R2 overflow + compression |

## Recommendations

### Immediate (No Code Changes)

1. **Use existing streaming interfaces** for large result sets
2. **Enable pagination** with reasonable defaults (100-1000 items)
3. **Monitor collection sizes** using CollectionStats

### Short-term

1. **Integrate BackpressureController** into query execution
2. **Add memory estimation** to query planner
3. **Implement SQLiteDiskBuffer** for production spill

### Long-term

1. **External sort operator** for large sorts
2. **Spill-to-disk hash tables** for large aggregations
3. **Memory-aware query optimizer** that chooses plans based on available memory

## Testing Large Result Sets

The success criteria from the issue: "Handle 1M row result sets without OOM"

```typescript
// Test approach using existing infrastructure
describe('Memory limits for intermediate results', () => {
  it('handles 1M rows via streaming without OOM', async () => {
    const pipeline = createStreamingPipeline<Event>({
      windowAssigner: WindowManager.global(),
      trigger: new CountTrigger(10000),
    })

    let processed = 0
    pipeline.onResult(() => { processed++ })

    // Process 1M events
    for (let i = 0; i < 1_000_000; i++) {
      pipeline.process({ id: i, value: Math.random() })

      // Periodic memory check
      if (i % 100000 === 0) {
        const mem = pipeline.estimateMemoryUsage()
        expect(mem.total).toBeLessThan(50 * 1024 * 1024) // Under 50 MB
      }
    }

    // All batches processed
    expect(processed).toBe(100) // 1M / 10000
  })

  it('handles large aggregation via cursor pagination', async () => {
    const manager = new CollectionManager(storage, {
      pageSize: 1000,
      maxPageSize: 10000,
    })

    // Populate 1M items
    for (let i = 0; i < 1_000_000; i++) {
      await manager.add({ id: i, value: Math.random() })
    }

    // Paginate through all results
    let cursor: string | null = null
    let totalProcessed = 0

    do {
      const page = await manager.list({ cursor, limit: 1000 })
      totalProcessed += page.items.length
      cursor = page.cursor
    } while (cursor)

    expect(totalProcessed).toBe(1_000_000)
  })
})
```

## References

- [Cloudflare DO Limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- `/db/primitives/cdc/backpressure.ts` - BackpressureController
- `/objects/CollectionLimits.ts` - Pagination and streaming
- `/db/compat/graph/src/streaming.ts` - Graph streaming
- `/docs/spikes/checkpoint-size-limits.md` - Related checkpoint spike
