# Cloudflare Pipelines Spike Results

**Issue:** SPIKE - Cloudflare Pipelines -> Streams -> R2 Data Catalog / Iceberg Write Path
**Date:** 2026-01-11
**Decision:** GO - Recommended for DO cold storage write path

---

## Executive Summary

Cloudflare Pipelines provides a managed streaming ingestion service that can replace our current `parquet-wasm` based write path for Durable Object state to Iceberg. The R2 Data Catalog (public beta since April 2025) automatically manages Apache Iceberg metadata, eliminating manual manifest updates.

**Key Benefits:**
1. Zero DO-side memory for Parquet generation
2. Automatic Iceberg manifest management
3. Automatic compaction (128MB target files)
4. Automatic snapshot management
5. Native R2 SQL query support

---

## Questions Answered

### Q1: Can Pipelines receive events from DOs?

**Answer: YES**

Pipelines provides a Worker binding that DOs can use to send events.

**Configuration (wrangler.toml):**
```toml
[[pipelines]]
pipeline = "do-state-stream"
binding = "PIPELINE"
```

**Usage in DO:**
```typescript
await env.PIPELINE.send([{
  do_id: this.state.id.toString(),
  type: 'User',
  key: 'profile',
  value: JSON.stringify({ name: 'Alice' }),
  timestamp: Date.now()
}])
```

The `send()` method accepts an array of JSON-serializable objects and returns a Promise that resolves when events are confirmed as ingested.

**Sources:**
- [Writing to Streams](https://developers.cloudflare.com/pipelines/streams/writing-to-streams/)

---

### Q2: Does R2 Data Catalog auto-generate Iceberg manifests?

**Answer: YES**

R2 Data Catalog is a fully managed Apache Iceberg catalog that handles:

1. **Table creation**: Creates namespace and table if they don't exist
2. **Data file management**: Writes Parquet files with proper naming
3. **Manifest updates**: Automatically updates Iceberg manifests
4. **Snapshot management**: Creates snapshots for time-travel queries
5. **Compaction**: Combines small files into 128MB targets (2GB/hour during beta)
6. **Snapshot expiration**: Removes old snapshots per configuration

**Setup:**
```bash
# Enable catalog on bucket
npx wrangler r2 bucket catalog enable my-bucket

# Create sink
npx wrangler pipelines sinks create my_sink \
  --type "r2-data-catalog" \
  --bucket "my-bucket" \
  --namespace "my_namespace" \
  --table "my_table"
```

**Sources:**
- [R2 Data Catalog Docs](https://developers.cloudflare.com/r2/data-catalog/)
- [R2 Data Catalog Sink](https://developers.cloudflare.com/pipelines/sinks/available-sinks/r2-data-catalog/)

---

### Q3: What's the end-to-end latency?

**Answer: 10-300 seconds** (configurable)

The latency is controlled by the sink's `roll-interval` setting:

| Roll Interval | Write Latency | Use Case |
|---------------|---------------|----------|
| 10s | ~10-15s | Near real-time analytics |
| 60s | ~60-65s | Standard ingestion |
| 300s (default) | ~300-305s | Batch analytics |

**Latency Breakdown:**
1. `env.PIPELINE.send()`: <1ms (async, fire-and-forget)
2. Stream buffering: 10-300s (roll-interval)
3. Transform execution: ~1s
4. Parquet write to R2: ~1-5s
5. Manifest update: ~1s

**Note:** Hot path (libSQL reads/writes) is unaffected. Cold storage visibility has this delay.

---

### Q4: How does this compare cost-wise?

**Current Approach (parquet-wasm):**

| Component | Cost per 1M events |
|-----------|-------------------|
| DO CPU (Parquet gen) | ~$0.10 |
| R2 PUTs (many small files) | ~$0.45 |
| R2 Storage | ~$0.15 |
| **Total** | **~$0.70** |

**Pipelines Approach:**

| Component | Cost per 1M events |
|-----------|-------------------|
| Pipelines | FREE (beta) |
| R2 PUTs (batched) | ~$0.10 |
| R2 Storage | ~$0.15 |
| **Total** | **~$0.25** |

**Notes:**
- Pipelines is free during beta (no GA pricing announced)
- Fewer R2 PUTs because events are batched into larger files
- R2 Data Catalog operations will have pricing post-beta

---

### Q5: Can DuckDB query the resulting Iceberg tables?

**Answer: YES, via Iceberg REST Catalog**

The R2 Data Catalog exposes a standard Iceberg REST catalog interface compatible with:
- DuckDB (via Iceberg extension)
- Spark
- Snowflake
- PyIceberg
- Trino

**DuckDB Query (browser/Node):**
```sql
-- Requires Iceberg REST catalog support
-- Currently works in native DuckDB, WASM support TBD
SELECT * FROM iceberg_scan(
  'r2://my-bucket/my_namespace/my_table'
)
WHERE timestamp > '2026-01-01'
```

**R2 SQL Query (Cloudflare native):**
```sql
SELECT * FROM my_namespace.my_table
WHERE timestamp > '2026-01-01'
```

**Limitation:** DuckDB WASM doesn't have the Iceberg extension. Continue using `IcebergIndexAccelerator` for DO-based queries.

---

## Feature Comparison

| Feature | Current (parquet-wasm) | Pipelines + R2 Data Catalog |
|---------|------------------------|----------------------------|
| **Parquet Generation** | In DO (1.2MB WASM) | Cloudflare-managed |
| **Manifest Management** | Manual | Automatic |
| **Compaction** | Manual | Automatic (2GB/hr) |
| **Snapshots** | Manual | Automatic |
| **Schema Evolution** | Manual | Supported |
| **ACID Transactions** | Manual locking | Built-in |
| **Write Latency** | 50-200ms | 10-300s (buffered) |
| **Memory Usage** | 10-50MB per write | 0 in DO |
| **Bundle Size** | +1.2MB | 0 |
| **Query Support** | DuckDB WASM | R2 SQL + REST catalog |
| **Time Travel** | If implemented | Built-in |

---

## Architecture Decision

### Recommended: Hybrid Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       DURABLE OBJECT                            │
│                                                                 │
│  ┌─────────────┐                                               │
│  │ libSQL      │◀───── Hot reads/writes (< 5ms)               │
│  │ (SQLite)    │                                               │
│  └──────┬──────┘                                               │
│         │                                                       │
│         ├─── Transactional writes ──────────────────────────┐  │
│         │                                                    │  │
│         └─── Async stream ──▶ env.PIPELINE.send([...])     │  │
│                               Fire-and-forget, < 1ms         │  │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
                    Cloudflare Pipelines
                    (buffer, transform, sink)
                                │
                                ▼
                    R2 Data Catalog (Iceberg)
                    (auto manifest, compaction)
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
              R2 SQL                   DuckDB/Spark
              (analytics)              (via REST catalog)
```

**Key Insight:** Keep libSQL for hot path, use Pipelines for cold storage durability.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Pipelines GA pricing | Cost uncertainty | Monitor usage, budget 2x current |
| 20 stream limit | Scale limitation | Multi-tenant streams with filtering |
| Schema immutability | Can't alter tables | Plan schema, version tables |
| Buffer latency | Stale analytics | Accept for cold; hot via libSQL |
| Beta stability | Production issues | Fallback to parquet-wasm |

---

## Implementation Plan

### Phase 1: POC (Week 1)
1. Create R2 bucket with Data Catalog enabled
2. Create Pipeline for single DO type
3. Implement `PipelineWriter` class
4. Validate end-to-end write path
5. Query via R2 SQL

### Phase 2: Integration (Week 2-3)
1. Add Pipeline binding to wrangler.toml
2. Integrate with DO base class
3. Add metrics and monitoring
4. Implement error handling
5. Test with production-like load

### Phase 3: Migration (Week 4)
1. Deploy to staging
2. Validate query compatibility
3. Update `IcebergIndexAccelerator`
4. Deploy to production
5. Remove parquet-wasm dependency

---

## Files Created

| File | Purpose |
|------|---------|
| `db/spikes/pipelines-write-path-design.md` | Detailed architecture design |
| `db/spikes/pipelines-spike-results.md` | This document |
| `db/compat/sql/clickhouse/spikes/pipelines-write-poc.ts` | POC implementation with types |
| `db/compat/sql/clickhouse/spikes/pipelines-write-poc.test.ts` | Tests for POC (23 passing) |

---

## Recommendations

### Short Term
1. **GO** - Implement Pipeline-based write path
2. Keep libSQL as hot state source of truth
3. Use Pipelines for cold storage durability only
4. Query cold data via R2 SQL or IcebergIndexAccelerator

### Medium Term
1. Monitor Pipelines GA pricing announcement
2. Evaluate R2 SQL for more analytics use cases
3. Consider removing parquet-wasm from DO builds

### Long Term
1. Full Iceberg REST catalog integration
2. DuckDB WASM Iceberg support (when available)
3. Cross-region data lake federation

---

## References

- [Cloudflare Pipelines Documentation](https://developers.cloudflare.com/pipelines/)
- [R2 Data Catalog Documentation](https://developers.cloudflare.com/r2/data-catalog/)
- [R2 Data Catalog Blog Post](https://blog.cloudflare.com/r2-data-catalog-public-beta/)
- [Cloudflare Data Platform Announcement](https://blog.cloudflare.com/cloudflare-data-platform/)
- [Writing to Streams](https://developers.cloudflare.com/pipelines/streams/writing-to-streams/)
- [R2 Data Catalog Sink](https://developers.cloudflare.com/pipelines/sinks/available-sinks/r2-data-catalog/)
- [R2 SQL Deep Dive](https://blog.cloudflare.com/r2-sql-deep-dive/)

---

## Decision Summary

| Aspect | Decision | Notes |
|--------|----------|-------|
| Pipelines for cold storage | **GO** | Replaces parquet-wasm write path |
| R2 Data Catalog | **GO** | Auto-manages Iceberg metadata |
| libSQL hot path | **KEEP** | No change to hot reads/writes |
| parquet-wasm | **DEPRECATE** | Remove after migration |
| IcebergIndexAccelerator | **KEEP** | Still needed for DO-based queries |
| R2 SQL | **USE** | For analytics queries |

**Final Verdict:** Implement Pipelines-based write path. The benefits of managed Iceberg metadata, zero DO memory overhead, and automatic compaction outweigh the increased write latency for cold storage.
