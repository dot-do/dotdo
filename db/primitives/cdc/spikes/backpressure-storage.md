# CDC Backpressure with DO Storage Limits

**Issue:** dotdo-djbe0
**Date:** 2026-01-13
**Author:** Research Spike
**Status:** COMPLETE

## Executive Summary

This spike investigates what happens when CDC produces faster than Durable Objects can persist, and how to implement sustainable backpressure strategies within DO storage limits.

### Success Criteria (from issue)

| Criteria | Target | Result |
|----------|--------|--------|
| Define sustainable throughput ceiling | Documented | ~100K events/s (batch writes) |
| Implement overflow/backpressure strategy | Complete | BackpressureController implemented |
| Document storage limits | Complete | See DO Storage Limits below |

**Key Findings:**
1. **SQLite-backed DOs have 10GB limit** (not 128MB as initially assumed - that's for KV-backed DOs)
2. **Existing BackpressureController** provides comprehensive flow control with multiple overflow strategies
3. **Missing piece:** Production R2 DiskBuffer implementation for spill-to-R2 pattern
4. **Sustainable throughput:** With batch writes, ~100K events/s is achievable

## DO Storage Limits (Updated 2025/2026)

### SQLite-backed Durable Objects (Current Standard)

| Resource | Limit | Notes |
|----------|-------|-------|
| **Per-object storage** | **10 GB** | Increased from 1GB beta limit |
| Maximum row/blob/string size | 2 MB | Per-row limit |
| Maximum bound parameters | 100 | Per SQL statement |
| Maximum columns per table | 100 | Schema limit |
| Request throughput (soft) | 1,000 req/s | Triggers overloaded error |
| CPU per request | 30 seconds | Configurable to 5 minutes |

### Key-Value Storage (Legacy)

| Resource | Limit | Notes |
|----------|-------|-------|
| Per-object limit | **128 MB** | NOT applicable to SQLite DOs |
| Key size | 2 KiB | |
| Value size | 128 KiB | |

**Critical Insight:** The 128MB limit applies to KV-backed DOs, not SQLite. SQLite DOs have 10GB per object, making CDC storage much more viable than initially assumed.

## Backpressure Signals and Flow Control

### Existing Implementation: BackpressureController

Location: `/db/primitives/cdc/backpressure.ts`

The `BackpressureController` provides comprehensive flow control:

```typescript
const controller = new BackpressureController<CDCEvent>({
  highWatermark: 1000,     // Pause source when buffer reaches this
  lowWatermark: 200,       // Resume source when buffer drains to this
  overflowStrategy: OverflowStrategy.BUFFER_TO_DISK,
  maxWaitMs: 30000,        // Timeout for BLOCK strategy
  onPause: () => source.pause(),
  onResume: () => source.resume(),
  diskBuffer: r2DiskBuffer, // For spill-to-R2
  rateLimitPerSecond: 1000, // Token bucket rate limiting
})
```

### Flow States

```
FLOWING -> PAUSED -> OVERFLOW -> FLOWING
   |         |          |
   |    (high watermark reached)
   |                    |
   (buffer < low watermark)
```

### Overflow Strategies

| Strategy | Behavior | Use Case |
|----------|----------|----------|
| `BLOCK` | Producer blocks until space available | Guaranteed delivery, latency-tolerant |
| `DROP_OLDEST` | Discard oldest events when full | Metrics, latest-wins scenarios |
| `DROP_NEWEST` | Reject incoming events when full | Rate limiting, queue-at-source |
| `BUFFER_TO_DISK` | Spill overflow to R2/disk | Large bursts, eventual delivery |
| `SAMPLE` | Keep every Nth event under pressure | High-cardinality metrics |

### Backpressure Metrics

```typescript
const BackpressureMetrics = {
  EVENTS_PUSHED: 'backpressure.events_pushed',
  EVENTS_PULLED: 'backpressure.events_pulled',
  EVENTS_DROPPED: 'backpressure.events_dropped',
  EVENTS_SPILLED: 'backpressure.events_spilled',
  BUFFER_SIZE: 'backpressure.buffer_size',
  BUFFER_UTILIZATION: 'backpressure.buffer_utilization',
  PAUSE_COUNT: 'backpressure.pause_count',
  CONSUMER_LAG: 'backpressure.consumer_lag',
}
```

## Buffer Management Strategies

### Tiered Storage Architecture

From existing `fsx` implementation (`/lib/mixins/fs.ts`):

```
HOT TIER (SQLite)    WARM TIER (R2)      COLD TIER (Archive R2)
-----------------    ---------------     ---------------------
- In-DO storage      - Active R2 bucket  - Archive R2 bucket
- < 1MB default      - > 1MB files       - Aged out data
- Fast read/write    - Medium latency    - Low cost storage
        |                   |                    |
        +--- promote() ----+                    |
        +--- demote() -----+--------------------+
```

### DiskBuffer Interface

```typescript
interface DiskBuffer<T> {
  write(events: BufferedEvent<T>[]): Promise<void>
  read(limit: number): Promise<BufferedEvent<T>[]>
  delete(sequences: number[]): Promise<void>
  size(): Promise<number>
  clear(): Promise<void>
}
```

**Current State:**
- `InMemoryDiskBuffer` - exists for testing
- `R2DiskBuffer` - **NOT IMPLEMENTED** (production gap)

### Recommended R2 DiskBuffer Implementation

```typescript
class R2DiskBuffer<T> implements DiskBuffer<T> {
  constructor(
    private bucket: R2Bucket,
    private streamId: string,
    private options: { maxBatchSize: number }
  ) {}

  async write(events: BufferedEvent<T>[]): Promise<void> {
    // Use NDJSON format for streaming reads
    const content = events.map(e => JSON.stringify(e)).join('\n')
    const key = `cdc-buffer/${this.streamId}/${events[0].sequence}.ndjson`
    await this.bucket.put(key, content)
  }

  async read(limit: number): Promise<BufferedEvent<T>[]> {
    // List with prefix, ordered by sequence (key naming)
    const list = await this.bucket.list({
      prefix: `cdc-buffer/${this.streamId}/`,
      limit: Math.ceil(limit / this.options.maxBatchSize)
    })

    const events: BufferedEvent<T>[] = []
    for (const object of list.objects) {
      const content = await this.bucket.get(object.key)
      const text = await content.text()
      const batch = text.split('\n').map(line => JSON.parse(line))
      events.push(...batch)
      if (events.length >= limit) break
    }

    return events.slice(0, limit)
  }

  async delete(sequences: number[]): Promise<void> {
    // Batch delete by sequence prefix
    const keys = sequences.map(seq =>
      `cdc-buffer/${this.streamId}/${seq}.ndjson`
    )
    await Promise.all(keys.map(k => this.bucket.delete(k)))
  }

  async size(): Promise<number> {
    const list = await this.bucket.list({
      prefix: `cdc-buffer/${this.streamId}/`
    })
    return list.objects.length * this.options.maxBatchSize // Approximate
  }

  async clear(): Promise<void> {
    const list = await this.bucket.list({
      prefix: `cdc-buffer/${this.streamId}/`
    })
    await Promise.all(list.objects.map(o => this.bucket.delete(o.key)))
  }
}
```

## Spill-to-R2 Patterns

### When to Spill

```
SQLite Utilization
       |
  100% |--------------------------------- DANGER ZONE
       |
   80% |................... SPILL THRESHOLD
       |                   /
   70% |................../  Proactive spilling starts
       |                /
   50% |...............|   Normal operation
       |
    0% |_______________________________________________
```

### Adaptive Threshold Calculation

```typescript
async calculateSpillThreshold(): Promise<number> {
  // Get current SQLite usage
  const result = await this.db.execute(
    'SELECT page_count * page_size as total_bytes FROM pragma_page_count(), pragma_page_size()'
  )
  const usedBytes = result[0].total_bytes

  // 10GB limit for SQLite DOs
  const maxBytes = 10 * 1024 * 1024 * 1024
  const utilizationPercent = (usedBytes / maxBytes) * 100

  // Start spilling at 70% utilization
  if (utilizationPercent > 70) {
    return Math.max(100, this.defaultHighWatermark * (1 - utilizationPercent / 100))
  }

  return this.defaultHighWatermark
}
```

### R2 Integration Points

From existing codebase:

```typescript
// lib/storage/authorized-r2.ts - JWT-scoped tenant isolation
const r2 = new AuthorizedR2Client(env.R2, tenantId, jwt)

// R2 bucket bindings from wrangler.toml
// R2 - primary storage
// ARCHIVES - cold tier
// UPLOADS - temporary uploads
```

## Consumer Lag Monitoring

### WatermarkService Integration

From `/db/primitives/watermark-service.ts`:

```typescript
const watermarkService = new WatermarkService({
  maxOutOfOrderness: 5000,  // 5s bounded lateness
  idleTimeout: 60000,       // 1 minute idle detection
  onAdvance: (watermark) => {
    // Watermark advanced, safe to emit downstream
    emitWatermark(watermark)
  }
})

// Track event-time progress per source
watermarkService.updateWatermark('source-1', eventTime)
watermarkService.updateWatermark('source-2', eventTime)

// Get aggregated watermark (min across active sources)
const globalWatermark = watermarkService.getCurrentWatermark()
```

### Lag Metrics to Track

```typescript
interface CDCLagMetrics {
  // Sequence-based lag (events behind)
  sequenceLag: number

  // Time-based lag (seconds behind real-time)
  timeLagSeconds: number

  // Source-specific lag
  perSourceLag: Map<string, { sequence: number; time: number }>

  // Storage pressure metrics
  sqliteUtilizationPercent: number
  r2SpilledEvents: number
  r2SpilledBytes: number
}
```

## Sustainable Throughput Ceiling

### Theoretical Limits

Based on DO constraints:

| Bottleneck | Limit | Events/s (1KB avg) |
|------------|-------|-------------------|
| Request rate | 1,000 req/s | 1,000 (unbatched) |
| Request rate | 1,000 req/s | **100,000** (100/batch) |
| CPU per request | 30s | Not limiting for CDC |
| Storage (10GB) | 10M events | N/A (capacity, not rate) |

### Recommended Configuration

```typescript
const cdcConfig = {
  // Batching for throughput
  batchSize: 100,
  batchTimeoutMs: 100,

  // Backpressure thresholds
  highWatermark: 10000,     // 10K events in memory
  lowWatermark: 2000,       // Resume at 2K

  // Storage thresholds
  sqliteSpillThreshold: 0.7, // Start R2 spill at 70%
  maxSqliteEvents: 1000000,  // 1M events before forced R2 spill

  // Rate limiting
  maxEventsPerSecond: 50000, // Conservative target

  // R2 overflow
  r2BatchSize: 1000,         // Events per R2 object
  r2RetentionHours: 168,     // 7 days
}
```

### Capacity Planning

| Scenario | Events/Day | Storage/Day | Days to 10GB |
|----------|------------|-------------|--------------|
| Low volume | 1M | 1GB | 10 days |
| Medium volume | 10M | 10GB | **1 day** |
| High volume | 100M | 100GB | R2 required |

**Recommendation:** For high-volume CDC (>10M events/day), use SQLite as hot buffer (recent events) and R2 as primary storage.

## Implementation Recommendations

### Phase 1: R2 DiskBuffer (Priority)

Create production `R2DiskBuffer` implementing the `DiskBuffer<T>` interface:
- Use R2 multipart uploads for large batches
- NDJSON format for streaming reads
- Sequence-based key naming for ordering

### Phase 2: Adaptive Thresholds

- Monitor SQLite storage via `PRAGMA page_count * page_size`
- Adjust watermarks based on storage pressure
- Target 70% SQLite utilization before R2 spilling

### Phase 3: Rate Limiting

- Token bucket already implemented in BackpressureController
- Add exponential backoff for repeated overflows
- Circuit breaker for persistent consumer lag

### Phase 4: Observability

Extend BackpressureMetrics with:
- `cdc.storage.sqlite_bytes`
- `cdc.storage.r2_events`
- `cdc.backpressure.spill_count`
- `cdc.consumer.lag_seconds`

## Prototype Tests

See `/db/primitives/cdc/tests/backpressure.test.ts` for comprehensive test coverage:

- `FlowController` - watermark-based flow control
- `AdaptiveBatcher` - throughput-adaptive batching
- `BackpressureSignal` - upstream coordination
- Integration tests for slow consumer scenarios

### Key Test Scenarios

```typescript
// Test: High-throughput CDC with backpressure
it('should handle slow consumer with fast producer', async () => {
  const controller = createBackpressureController({
    highWatermark: 10,
    lowWatermark: 5,
    overflowStrategy: OverflowStrategy.BUFFER_TO_DISK,
    diskBuffer: r2DiskBuffer,
  })

  // Fast producer: 100K events
  await produceEvents(100000, 1) // 1ms between events

  // Slow consumer: 10ms per event
  await consumeWithDelay(10)

  // Verify no data loss
  expect(controller.getStats().totalDropped).toBe(0)
  expect(r2DiskBuffer.size()).toBeGreaterThan(0) // Spilled to R2
})

// Test: Storage pressure triggers R2 spill
it('should spill to R2 when SQLite approaches limit', async () => {
  const controller = createAdaptiveBackpressure({
    sqliteSpillThreshold: 0.7,
    diskBuffer: r2DiskBuffer,
  })

  // Fill to 80% SQLite capacity
  await fillSqliteToPercent(80)

  // Next batch should go to R2
  await controller.push(largeEventBatch)

  expect(r2DiskBuffer.size()).toBeGreaterThan(0)
})
```

## Open Questions

1. **R2 cost optimization:** Should we use R2 lifecycle rules to transition old CDC events to Glacier-equivalent storage?

2. **Cross-DO CDC:** For multi-tenant scenarios, should each tenant have its own CDC stream or share a partitioned stream?

3. **Checkpoint coordination:** How to coordinate checkpoints across multiple CDC streams consuming from the same source?

4. **Schema evolution:** How to handle CDC events when the source schema changes mid-stream?

## Conclusion

CDC backpressure with DO storage limits is well-addressed by the existing `BackpressureController` implementation. The key gaps are:

1. **Production R2 DiskBuffer** - needs implementation for spill-to-R2
2. **Adaptive thresholds** - needs SQLite monitoring integration
3. **Observability** - needs CDC-specific metrics

With 10GB SQLite storage per DO and R2 overflow, sustainable throughput of ~100K events/s is achievable with proper batching.

## References

### Codebase
- `/db/primitives/cdc/backpressure.ts` - BackpressureController implementation
- `/db/primitives/cdc/tests/backpressure.test.ts` - Comprehensive test suite
- `/db/primitives/watermark-service.ts` - Event-time progress tracking
- `/lib/mixins/fs.ts` - Tiered storage patterns
- `/lib/storage/authorized-r2.ts` - R2 client with tenant isolation

### External
- [Cloudflare DO Storage Limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [Cloudflare R2 API](https://developers.cloudflare.com/r2/api/)
- [Reactive Streams Backpressure](https://www.reactive-streams.org/)
- [Flink Backpressure](https://nightlies.apache.org/flink/flink-docs-release-1.17/docs/ops/monitoring/back_pressure/)
