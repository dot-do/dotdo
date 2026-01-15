# ADR-002: 4-Layer Storage Architecture

## Status

Accepted

## Context

Durable Objects provide built-in SQLite storage, but a single-layer approach creates tradeoffs:

1. **Latency** - SQLite writes are ~5ms, too slow for high-throughput workloads
2. **Durability** - Memory-only storage is fast but lost on eviction
3. **Cost** - Keeping all historical data in SQLite is expensive at scale
4. **Recoverability** - No mechanism for cold storage or time-travel queries

We needed an architecture that provides sub-millisecond reads while maintaining strong durability guarantees and enabling cost-effective long-term storage.

## Decision

Implement a 4-layer tiered storage architecture:

```
L0: InMemory (hot cache)
  ↓ fire-and-forget
L1: Pipeline WAL (durability)
  ↓ lazy (5s batches)
L2: SQLite (persistent cache)
  ↓ eventual (60s)
L3: Iceberg/R2 (cold archive)
```

### Layer Characteristics

| Layer | Component | Latency | Durability | Purpose |
|-------|-----------|---------|------------|---------|
| **L0** | `InMemoryStateManager` | ~0.01ms | None | Hot cache with O(1) CRUD |
| **L1** | `PipelineEmitter` (WAL) | ~1ms | High | Fire-and-forget durability |
| **L2** | `LazyCheckpointer` (SQLite) | ~5ms | High | Batched persistence |
| **L3** | `IcebergWriter` (R2) | ~50ms | Permanent | Cold storage with time travel |

### Write Path

```
Client Write
    ↓
L0: Memory write (immediate, ~0.01ms)
    ↓
L1: Pipeline emit (fire-and-forget, ~1ms)
    ↓
Client ACK (data is durable)
    ↓ (async, batched)
L2: SQLite checkpoint (lazy 5s batches)
    ↓ (async, eventual)
L3: Iceberg archive (60s flush)
```

### Read Path

```
Client Read
    ↓
L0: Memory check (sub-ms) → hit? return
    ↓ miss
L2: SQLite query (~5ms) → hit? return + cache L0
    ↓ miss
L3: Event replay from Iceberg (~100ms) → return + cache L0/L2
```

### Key Design Choices

1. **Durability before ACK** - L1 Pipeline write completes before client acknowledgment
2. **Lazy L2 writes** - 95% write reduction through batching dirty entries
3. **Event-sourced L3** - Store events, not snapshots, enabling time travel
4. **Graceful degradation** - System works with missing layers (no R2 = no L3)

## Consequences

### Positive

- **Sub-millisecond reads** - L0 hit ratio >95% for hot data
- **Strong durability** - L1 WAL ensures no data loss on eviction
- **Cost efficiency** - L3 archival at $0.015/GB/month (R2 pricing)
- **Time travel** - Reconstruct state at any historical point from L3 events
- **Write coalescing** - Multiple updates to same key result in single L2 write

### Negative

- **Complexity** - 4 layers to understand and debug
- **Eventual consistency** - L2/L3 lag behind L0/L1 by design
- **Memory pressure** - L0 requires careful LRU eviction
- **Recovery time** - Cold start from L3 takes ~100ms

### Mitigations

- Clear monitoring for each layer (hit rates, flush counts, queue depths)
- Configurable thresholds for checkpoint intervals and batch sizes
- Explicit `waitForPipeline: true` option for maximum consistency
- LRU eviction with dirty entry protection

## Configuration

```typescript
const storage = new DOStorage({
  namespace: 'tenant-123',
  env: {
    PIPELINE: env.PIPELINE,   // L1 - optional
    R2: env.COLD_STORAGE,     // L3 - optional
    sql: ctx.storage.sql      // L2 - optional
  },
  checkpointInterval: 5000,    // L2 batch window
  icebergFlushInterval: 60000, // L3 flush window
  waitForPipeline: false       // Fire-and-forget (faster) vs blocking (safer)
})
```

## References

- `/docs/storage/index.mdx` - Storage architecture overview
- `/docs/storage/in-memory.mdx` - L0 implementation details
- `/docs/storage/pipeline-wal.mdx` - L1 WAL implementation
- `/docs/storage/lazy-checkpoint.mdx` - L2 batching strategy
- `/docs/storage/cold-tier.mdx` - L3 Iceberg/R2 archival
- `/docs/storage/recovery.mdx` - Cold start reconstruction
