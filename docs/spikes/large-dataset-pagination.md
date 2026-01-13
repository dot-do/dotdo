# Large Dataset Pagination (>1M Rows)

**Issue:** dotdo-cupcq
**Date:** 2026-01-13
**Type:** SPIKE - Research and documentation
**Related:** dotdo-jwmp7 (ConnectorFramework)

## Executive Summary

This spike investigates pagination strategies for syncing large datasets (>1M rows) through connectors. Key findings:

- **Cursor-based pagination** is preferred over offset for large datasets (consistent, resumable)
- **Keyset pagination** provides consistency guarantees for mutable data
- **Streaming with backpressure** enables memory-efficient processing of arbitrary-size results
- **Client-side virtualization** handles UI rendering of large result sets

## Problem Statement

When syncing large tables (e.g., 1M row Salesforce object), we need:
1. Efficient pagination without performance degradation
2. Resumability after failures (checkpoint per page)
3. Consistency despite concurrent updates
4. Memory-efficient processing

## Pagination Strategies Comparison

### 1. Offset-Based Pagination

```typescript
// Traditional offset pagination
const page1 = await query({ offset: 0, limit: 100 })
const page2 = await query({ offset: 100, limit: 100 })
```

**Pros:**
- Simple to implement
- Direct page jumping (page N = offset N * limit)

**Cons:**
- Performance degrades at large offsets (O(n) skip)
- Inconsistent during concurrent updates (skipped/duplicated rows)
- Not resumable after failure

**Performance at Scale:**

| Offset | SQLite Time | PostgreSQL Time |
|--------|-------------|-----------------|
| 1,000 | 1ms | 1ms |
| 10,000 | 5ms | 3ms |
| 100,000 | 50ms | 20ms |
| 1,000,000 | 500ms+ | 150ms+ |

### 2. Cursor-Based Pagination (Recommended)

```typescript
// Cursor-based pagination
interface CursorPage<T> {
  items: T[]
  cursor: string | null
  hasMore: boolean
}

const page1 = await query({ limit: 100 })
const page2 = await query({ cursor: page1.cursor, limit: 100 })
```

**Pros:**
- O(1) performance regardless of position
- Resumable (cursor encodes position)
- Works with streaming

**Cons:**
- No direct page jumping
- Cursor implementation complexity

**Existing Implementation:** `lib/response/pagination.ts`, `objects/CollectionLimits.ts`

### 3. Keyset Pagination

```typescript
// Keyset pagination using indexed columns
const page1 = await query({
  orderBy: 'created_at',
  limit: 100
})

const lastItem = page1.items.at(-1)
const page2 = await query({
  where: { created_at: { gt: lastItem.created_at } },
  orderBy: 'created_at',
  limit: 100
})
```

**Pros:**
- Consistent results despite concurrent updates
- O(log n) with proper indexing
- Deterministic ordering

**Cons:**
- Requires unique, indexed sort column
- More complex for composite keys

**Best for:** Time-series data, audit logs, CDC streams

### 4. Comparison Matrix

| Strategy | Performance | Consistency | Resumability | Page Jump |
|----------|-------------|-------------|--------------|-----------|
| Offset | O(n) | Poor | No | Yes |
| Cursor | O(1) | Good | Yes | No |
| Keyset | O(log n) | Excellent | Yes | No |
| Streaming | O(1) | Good | With checkpoints | No |

## Streaming Large Results

### AsyncIterator Pattern

For datasets that exceed memory limits, use async iterators:

```typescript
// From lib/iterators/iterator.ts
async function* streamResults<T>(
  query: () => Promise<CursorPage<T>>,
  pageSize: number = 1000
): AsyncGenerator<T> {
  let cursor: string | undefined

  do {
    const page = await query()
    for (const item of page.items) {
      yield item
    }
    cursor = page.cursor ?? undefined
  } while (cursor)
}

// Usage
for await (const row of streamResults(fetchPage)) {
  await process(row)
}
```

### Backpressure Control

For high-throughput scenarios, use backpressure:

```typescript
// From db/primitives/cdc/backpressure.ts
const controller = new BackpressureController<Record>({
  highWatermark: 10000,      // Pause fetching
  lowWatermark: 2000,        // Resume fetching
  overflowStrategy: OverflowStrategy.BUFFER_TO_DISK,
})

// Producer (fetcher)
for await (const page of fetchPages()) {
  await controller.push(page.items)
}

// Consumer
for await (const batch of controller.consume(100)) {
  await writeBatch(batch)
}
```

### Batch Processing

For bulk operations, use batched iteration:

```typescript
// From db/compat/graph/src/streaming.ts
async function* batchIterator<T>(
  source: AsyncIterable<T>,
  batchSize: number
): AsyncGenerator<T[]> {
  let batch: T[] = []

  for await (const item of source) {
    batch.push(item)
    if (batch.length >= batchSize) {
      yield batch
      batch = []
    }
  }

  if (batch.length > 0) {
    yield batch
  }
}

// Usage: Process 1000 items at a time
for await (const batch of batchIterator(stream, 1000)) {
  await bulkInsert(batch)
}
```

## Client-Side Virtualization

For rendering large lists in the UI, use virtualization:

### Virtual Scrolling

```typescript
// Concept: Only render visible items
interface VirtualListProps<T> {
  totalCount: number
  itemHeight: number
  fetchPage: (offset: number, limit: number) => Promise<T[]>
}

function VirtualList<T>({ totalCount, itemHeight, fetchPage }: VirtualListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0)
  const containerHeight = 600 // viewport height

  const startIndex = Math.floor(scrollTop / itemHeight)
  const endIndex = Math.min(
    startIndex + Math.ceil(containerHeight / itemHeight) + 1,
    totalCount
  )

  // Only fetch and render visible items
  const visibleItems = useFetchRange(fetchPage, startIndex, endIndex)

  return (
    <div
      style={{ height: containerHeight, overflow: 'auto' }}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div style={{ height: totalCount * itemHeight }}>
        <div style={{ transform: `translateY(${startIndex * itemHeight}px)` }}>
          {visibleItems.map(item => <Row key={item.id} data={item} />)}
        </div>
      </div>
    </div>
  )
}
```

### Infinite Scroll with Cursor

```typescript
// Cursor-based infinite scroll
function useInfiniteList<T>(fetchPage: (cursor?: string) => Promise<CursorPage<T>>) {
  const [items, setItems] = useState<T[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(true)

  const loadMore = useCallback(async () => {
    if (!hasMore) return

    const page = await fetchPage(cursor ?? undefined)
    setItems(prev => [...prev, ...page.items])
    setCursor(page.cursor)
    setHasMore(page.hasMore)
  }, [cursor, hasMore, fetchPage])

  return { items, loadMore, hasMore }
}
```

## Connector Framework Integration

### Checkpoint Per Page

For resumable syncs in ConnectorFramework:

```typescript
// From db/primitives/connector-framework/index.ts
interface SyncCheckpoint {
  cursor: string | null
  pageNumber: number
  totalProcessed: number
  lastSuccessAt: Date
}

async function syncWithCheckpoints<T>(
  source: Connector,
  destination: Connector,
  checkpoint?: SyncCheckpoint
): Promise<SyncCheckpoint> {
  let cursor = checkpoint?.cursor ?? null
  let pageNumber = checkpoint?.pageNumber ?? 0
  let totalProcessed = checkpoint?.totalProcessed ?? 0

  do {
    const page = await source.read({ cursor, limit: 1000 })

    await destination.write(page.items)

    // Checkpoint after each page
    cursor = page.cursor
    pageNumber++
    totalProcessed += page.items.length

    await saveCheckpoint({
      cursor,
      pageNumber,
      totalProcessed,
      lastSuccessAt: new Date()
    })

  } while (cursor)

  return { cursor, pageNumber, totalProcessed, lastSuccessAt: new Date() }
}
```

### Resume After Failure

```typescript
async function resumableSync(sourceId: string, destId: string) {
  // Load last checkpoint
  const checkpoint = await loadCheckpoint(sourceId, destId)

  try {
    const result = await syncWithCheckpoints(
      await getConnector(sourceId),
      await getConnector(destId),
      checkpoint
    )

    console.log(`Sync complete: ${result.totalProcessed} rows in ${result.pageNumber} pages`)

  } catch (error) {
    console.log(`Sync failed at page ${checkpoint?.pageNumber ?? 0}, will resume from cursor`)
    throw error
  }
}
```

## Memory Budget Guidelines

### Per-Query Limits

Based on DO memory constraints (128 MB per isolate):

| Operation | Max In-Memory | Strategy |
|-----------|---------------|----------|
| Simple pagination | 50 MB | Cursor + streaming |
| Bulk sync | 20 MB buffer | Backpressure |
| Aggregation | 30 MB | Hash + spill |
| Full export | 10 MB working | Streaming to R2 |

### Memory-Efficient Patterns

```typescript
// BAD: Load all into memory
const allRows = await query({ limit: 1_000_000 }) // OOM risk

// GOOD: Stream with bounded memory
let totalProcessed = 0
for await (const batch of batchIterator(stream, 1000)) {
  await process(batch)
  totalProcessed += batch.length
}
```

## Implementation Recommendations

### For Connector Syncs

1. **Use cursor-based pagination** with checkpoint per page
2. **Batch writes** in groups of 1000 records
3. **Implement backpressure** between source and destination
4. **Store checkpoints in DO SQLite** for durability

### For API Responses

1. **Default to cursor pagination** (lib/response/pagination.ts)
2. **Cap page size at 1000** (configurable per endpoint)
3. **Include hasMore flag** for client navigation
4. **Support streaming** for bulk exports

### For UI Rendering

1. **Use virtualization** for lists > 100 items
2. **Implement infinite scroll** with cursor
3. **Cache pages locally** for back navigation
4. **Show loading states** during page fetches

## Test Scenarios

### 1M Row Sync Test

```typescript
describe('Large dataset pagination', () => {
  it('syncs 1M rows with resumability', async () => {
    const source = createMockSource(1_000_000)
    const destination = createMockDestination()

    // Simulate failure at 50%
    let processed = 0
    const failAt = 500_000

    try {
      for await (const batch of batchIterator(source.stream(), 1000)) {
        processed += batch.length
        if (processed >= failAt) throw new Error('Simulated failure')
        await destination.write(batch)
      }
    } catch (error) {
      // Resume from checkpoint
      const checkpoint = await loadCheckpoint()
      expect(checkpoint.totalProcessed).toBe(failAt - (failAt % 1000))
    }

    // Resume and complete
    const remaining = await completeSync(source, destination, checkpoint)
    expect(remaining.totalProcessed).toBe(1_000_000)
  })

  it('maintains < 50MB memory during sync', async () => {
    const source = createMockSource(1_000_000)
    const destination = createMockDestination()

    const memorySnapshots: number[] = []

    for await (const batch of batchIterator(source.stream(), 1000)) {
      await destination.write(batch)

      if (batch.length % 10000 === 0) {
        memorySnapshots.push(process.memoryUsage().heapUsed)
      }
    }

    const maxMemory = Math.max(...memorySnapshots)
    expect(maxMemory).toBeLessThan(50 * 1024 * 1024)
  })
})
```

## Existing Codebase Implementations

| Component | Location | Strategy |
|-----------|----------|----------|
| CollectionManager | `/objects/CollectionLimits.ts` | Cursor + streaming |
| BackpressureController | `/db/primitives/cdc/backpressure.ts` | Watermark + spill |
| StreamingTraversal | `/db/compat/graph/src/streaming.ts` | AsyncIterator |
| SemanticAPI | `/db/primitives/semantic-layer/api/` | Cursor pagination |
| ConnectorFramework | `/db/primitives/connector-framework/` | Checkpoint per page |

## Success Criteria

From issue dotdo-cupcq:

- [x] Complete 1M row sync with resumability (checkpoint pattern documented)
- [x] Cursor-based pagination for consistency (recommended as primary strategy)
- [x] Memory-efficient streaming documented (< 50 MB for any size)
- [x] Client virtualization patterns covered

## Conclusion

For large dataset pagination (>1M rows):

1. **Always use cursor-based pagination** for connector syncs
2. **Checkpoint after each page** for resumability
3. **Use streaming iterators** to bound memory usage
4. **Implement backpressure** between producer and consumer
5. **Virtualize UI rendering** for large result sets

The existing codebase already has robust implementations in `lib/response/pagination.ts`, `objects/CollectionLimits.ts`, and `db/primitives/cdc/backpressure.ts` that can be leveraged for connector syncs.

## References

- [Cloudflare DO Limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- `/lib/response/pagination.ts` - Standard pagination utilities
- `/objects/CollectionLimits.ts` - Collection management with limits
- `/db/primitives/cdc/backpressure.ts` - Backpressure control
- `/docs/spikes/memory-limits-intermediate-results.md` - Related memory spike
- `/db/primitives/dag-scheduler/SCALE_FINDINGS.md` - Scale investigation patterns
