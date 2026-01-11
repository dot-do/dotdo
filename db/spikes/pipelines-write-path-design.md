# Cloudflare Pipelines Write Path Design

**Issue:** SPIKE - Cloudflare Pipelines -> Streams -> R2 Data Catalog / Iceberg Write Path
**Date:** 2026-01-11
**Status:** Research Complete

## Executive Summary

Cloudflare Pipelines provides a managed streaming ingestion service that can significantly simplify the DO-to-Iceberg write path. The R2 Data Catalog (public beta) automatically manages Iceberg metadata, eliminating manual manifest updates.

**Recommendation:** This architecture is viable and recommended for the write path. The primary benefits are reduced complexity and automatic Iceberg metadata management.

---

## Current Architecture

```
DO State Changes
       │
       ▼
libSQL/SQLite (Hot State)
       │
       ▼ (Periodic Checkpoint)
parquet-wasm (Generate Parquet)
       │
       ▼
R2 Upload via Binding
       │
       ▼
Manual Iceberg Manifest Update
       │
       ▼
DuckDB WASM Query via IcebergIndexAccelerator
```

**Pain Points:**
1. Manual Parquet generation (parquet-wasm overhead)
2. Manual Iceberg manifest management (complex, error-prone)
3. No automatic compaction
4. No automatic snapshot management

---

## Proposed Architecture

```
DO State Changes
       │
       ▼
Pipeline Stream (via Worker Binding)
       │ Buffer: 10s or 1000 events
       ▼
Cloudflare Pipeline (SQL Transform)
       │
       ▼
R2 Data Catalog Sink (auto-Iceberg)
       │
       ▼ Auto:
       ├── Parquet file generation
       ├── Iceberg manifest updates
       ├── Snapshot management
       └── Compaction (128MB target)
       │
       ▼
DuckDB/R2 SQL Query
```

---

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                           DURABLE OBJECT                                          │
│  ┌────────────────────────────────────────────────────────────────────────────┐  │
│  │  State Change                                                               │  │
│  │  ┌─────────────┐                                                           │  │
│  │  │ SQLite      │──┬─▶ Hot reads/writes (low latency)                      │  │
│  │  │ (libSQL)    │  │                                                        │  │
│  │  └─────────────┘  │                                                        │  │
│  │                    │                                                        │  │
│  │                    └─▶ env.PIPELINE.send([{...}])                          │  │
│  │                            │                                                │  │
│  └────────────────────────────│────────────────────────────────────────────────┘  │
└───────────────────────────────│────────────────────────────────────────────────────┘
                                │
                                ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                        CLOUDFLARE PIPELINES                                       │
│                                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │                          STREAM                                              │ │
│  │  • HTTP endpoint: https://{stream-id}.ingest.cloudflare.com                 │ │
│  │  • Worker binding: env.PIPELINE                                             │ │
│  │  • Schema validation (optional)                                             │ │
│  │  • Durable buffering                                                        │ │
│  └────────────────────────────────┬────────────────────────────────────────────┘ │
│                                   │                                              │
│  ┌────────────────────────────────▼────────────────────────────────────────────┐ │
│  │                          PIPELINE                                            │ │
│  │  SQL: INSERT INTO sink                                                       │ │
│  │       SELECT do_id, type, data, timestamp                                   │ │
│  │       FROM stream                                                            │ │
│  │       WHERE type NOT IN ('_internal', '_tombstone')                         │ │
│  └────────────────────────────────┬────────────────────────────────────────────┘ │
│                                   │                                              │
│  ┌────────────────────────────────▼────────────────────────────────────────────┐ │
│  │                          SINK (R2 Data Catalog)                              │ │
│  │  • Type: r2-data-catalog                                                     │ │
│  │  • Format: Parquet (auto)                                                    │ │
│  │  • Compression: ZSTD (default)                                              │ │
│  │  • Roll Interval: 30-300s                                                   │ │
│  │  • Roll Size: 100MB max                                                     │ │
│  └────────────────────────────────┬────────────────────────────────────────────┘ │
└───────────────────────────────────│────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                          R2 DATA CATALOG                                          │
│                                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │  Iceberg Table: do_state                                                     │ │
│  │                                                                              │ │
│  │  data/                                                                       │ │
│  │  ├── 00000-{uuid}.parquet     (128MB target)                                │ │
│  │  ├── 00001-{uuid}.parquet                                                   │ │
│  │  └── ...                                                                     │ │
│  │                                                                              │ │
│  │  metadata/                                                                   │ │
│  │  ├── v1.metadata.json                                                        │ │
│  │  ├── v2.metadata.json                                                        │ │
│  │  ├── snap-{id}.avro           (snapshots)                                   │ │
│  │  └── manifests/                                                              │ │
│  │      └── {uuid}.avro          (manifest lists)                              │ │
│  │                                                                              │ │
│  │  AUTO MAINTENANCE:                                                           │ │
│  │  • Compaction: 2GB/hour during beta                                         │ │
│  │  • Snapshot expiration: configurable                                        │ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                   │
│  REST Catalog Interface:                                                         │
│  • Catalog URI: {account}.r2.cloudflarestorage.com                              │
│  • Warehouse: {bucket}                                                           │
│  • Compatible: Spark, Snowflake, PyIceberg, DuckDB                              │
└──────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                          QUERY LAYER                                              │
│                                                                                   │
│  Option A: R2 SQL (Cloudflare)                                                   │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │  SELECT * FROM do_state WHERE do_id = 'xyz' AND timestamp > '2026-01-01'   │ │
│  │  • Petabyte-scale                                                            │ │
│  │  • Distributed query engine                                                  │ │
│  │  • Zero egress                                                               │ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                   │
│  Option B: DuckDB + IcebergIndexAccelerator (DO-based)                          │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │  • DO maintains columnar indexes                                             │ │
│  │  • Partition pruning via min/max stats                                       │ │
│  │  • Bloom filter lookups                                                      │ │
│  │  • Fetch Parquet files via R2 binding                                       │ │
│  │  • DuckDB WASM for in-memory query                                          │ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## Configuration

### wrangler.toml

```toml
[[pipelines]]
pipeline = "do-state-stream"
binding = "PIPELINE"
```

### Stream Schema (Optional)

```json
{
  "do_id": { "type": "string", "required": true },
  "type": { "type": "string", "required": true },
  "key": { "type": "string", "required": true },
  "value": { "type": "string", "required": false },
  "timestamp": { "type": "timestamp", "required": true }
}
```

### Sink Configuration

```bash
npx wrangler pipelines sinks create do_state_sink \
  --type "r2-data-catalog" \
  --bucket "do-cold-storage" \
  --namespace "do_state" \
  --table "changes" \
  --roll-interval 60 \
  --compression zstd \
  --catalog-token $R2_CATALOG_TOKEN
```

---

## Data Flow

### 1. DO State Change Event

```typescript
interface StateChangeEvent {
  do_id: string        // Durable Object ID
  ns: string           // Namespace (e.g., "tenant.api")
  type: string         // Entity type (e.g., "User", "Order")
  key: string          // State key
  value: string | null // JSON-encoded value (null = delete)
  op: 'PUT' | 'DELETE' // Operation type
  timestamp: number    // Unix timestamp ms
  seq: number          // Sequence number within DO
}
```

### 2. Stream Buffering

- **Buffer Time:** 10-300 seconds (configurable via roll-interval)
- **Buffer Size:** Up to 100MB (configurable via roll-size)
- **Delivery:** Exactly-once guarantee
- **Durability:** Events are durably stored until written

### 3. Pipeline SQL Transform

```sql
INSERT INTO do_state_sink
SELECT
  do_id,
  ns,
  type,
  key,
  value,
  op,
  timestamp,
  seq
FROM do_state_stream
WHERE op != '_internal'  -- Filter internal events
```

### 4. Iceberg Table (Auto-managed)

- **Partitioning:** By day (automatic from timestamp)
- **Compaction:** 128MB target files (automatic)
- **Snapshots:** Retained per configuration
- **Schema:** Inferred from first event or explicit

---

## Comparison

| Aspect | Current (parquet-wasm) | Pipelines |
|--------|------------------------|-----------|
| **Latency (write)** | 50-200ms (buffered) | 10-300s (stream buffering) |
| **Latency (visibility)** | Immediate in SQLite | 10-300s (after roll) |
| **Complexity** | High (manual manifest) | Low (auto-managed) |
| **Bundle Size** | +1.2MB (parquet-wasm) | 0 (platform feature) |
| **Memory Usage** | 10-50MB per write | 0 (offloaded) |
| **Compaction** | Manual | Automatic |
| **Snapshots** | Manual | Automatic |
| **Cost (writes)** | R2 PUT | Pipelines (free beta) + R2 |
| **Cost (storage)** | R2 ($0.015/GB-mo) | Same |
| **Reliability** | DO-managed | Platform-managed |
| **Query Support** | DuckDB WASM | R2 SQL + DuckDB |

---

## Cost Analysis

### Current Approach (parquet-wasm)

```
Per 10K state changes (assuming 1KB avg):
- Parquet generation CPU: ~100ms DO time
- R2 PUT: $0.0000045 per PUT
- R2 Storage: $0.015/GB/month

Monthly (1M state changes):
- DO CPU: ~$0.10
- R2 Writes: ~$0.45
- R2 Storage: ~$0.15 (10MB compressed)
Total: ~$0.70/month
```

### Pipelines Approach

```
Per 10K state changes:
- Pipeline ingestion: FREE (beta)
- R2 writes: Fewer PUTs (batched to larger files)
- R2 Storage: Same

Monthly (1M state changes):
- Pipeline: FREE (during beta)
- R2 Writes: ~$0.10 (batched)
- R2 Storage: ~$0.15
Total: ~$0.25/month (beta), TBD after GA
```

---

## Latency Considerations

### Hot Path (libSQL)

```
State Change → libSQL Write → Response
              < 5ms
```

**Unchanged.** Hot state remains in libSQL for low-latency reads/writes.

### Cold Path (Pipelines)

```
State Change → Pipeline.send() → Stream Buffer → Sink → R2
              < 1ms            10-300s          ~1s
```

**Trade-off:**
- Events visible in Iceberg after 10-300s (configurable)
- For analytics/durability, this is acceptable
- For point-in-time recovery, libSQL remains source of truth

### Hybrid Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       DURABLE OBJECT                            │
│                                                                 │
│  ┌─────────────┐                         ┌──────────────────┐  │
│  │ libSQL      │◀───── Hot reads/writes ─│ Application      │  │
│  │ (SQLite)    │       < 5ms             │ Logic            │  │
│  └──────┬──────┘                         └────────┬─────────┘  │
│         │                                         │             │
│         │  WAL/Trigger                           │ State       │
│         │                                        │ Change      │
│         ▼                                        ▼             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Pipeline Stream (async)                     │   │
│  │              env.PIPELINE.send([...])                   │   │
│  │              Fire-and-forget, < 1ms                     │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    Iceberg (durable, queryable)
                    Visible in 10-300s
```

---

## Implementation Steps

### Phase 1: Basic Integration

1. Create R2 bucket with Data Catalog enabled
2. Create Stream with schema
3. Create Sink pointing to R2 Data Catalog
4. Add Pipeline binding to wrangler.toml
5. Implement `env.PIPELINE.send()` in DO

### Phase 2: Schema and Transforms

1. Define comprehensive state change schema
2. Add SQL transforms for filtering/enrichment
3. Configure partitioning strategy
4. Set up compaction and snapshot policies

### Phase 3: Query Integration

1. Configure R2 SQL for analytics queries
2. Update IcebergIndexAccelerator to use REST catalog
3. Add DuckDB integration via Iceberg REST catalog
4. Implement query result caching

### Phase 4: Monitoring and Optimization

1. Add metrics for pipeline throughput
2. Monitor compaction effectiveness
3. Tune roll-interval for latency/efficiency trade-off
4. Implement backpressure handling

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Pipelines GA pricing unknown | Cost uncertainty | Monitor beta usage, budget buffer |
| 20 stream/sink limit per account | Scale limitation | Use multi-tenant streams with filtering |
| Schema immutability | Schema evolution blocked | Plan schema carefully, version tables |
| Buffer latency | Stale analytics | Accept for cold storage; hot path via libSQL |
| Beta stability | Production risk | Fallback to parquet-wasm if issues |

---

## Decision

**GO** - Proceed with Pipelines integration for DO cold storage write path.

**Rationale:**
1. Eliminates manual Iceberg manifest management
2. Reduces bundle size (no parquet-wasm for writes)
3. Automatic compaction and snapshot management
4. Native Cloudflare integration
5. Zero egress with R2 SQL queries

**Next Steps:**
1. Create POC with single DO type
2. Validate end-to-end latency
3. Test R2 SQL query performance
4. Document production rollout plan

---

## References

- [Cloudflare Pipelines Docs](https://developers.cloudflare.com/pipelines/)
- [R2 Data Catalog Docs](https://developers.cloudflare.com/r2/data-catalog/)
- [R2 Data Catalog Blog](https://blog.cloudflare.com/r2-data-catalog-public-beta/)
- [Cloudflare Data Platform Announcement](https://blog.cloudflare.com/cloudflare-data-platform/)
- [Writing to Streams](https://developers.cloudflare.com/pipelines/streams/writing-to-streams/)
- [R2 Data Catalog Sink](https://developers.cloudflare.com/pipelines/sinks/available-sinks/r2-data-catalog/)
