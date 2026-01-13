# SPIKE: Cloudflare Pipelines -> R2 Data Catalog Write Path

**Issue:** dotdo-jeoor
**Date:** 2026-01-13
**Author:** Research Spike
**Status:** COMPLETE

## Executive Summary

This spike investigates the write path from Cloudflare Pipelines to R2 Data Catalog for Iceberg-compatible event streaming. Cloudflare Pipelines provides a managed solution for streaming data ingestion with SQL transformations and exactly-once delivery to R2 as Apache Iceberg tables, eliminating the need for custom write path implementation.

### Key Findings

| Area | Finding |
|------|---------|
| Write Path | Fully managed by Pipelines - no custom implementation needed |
| Data Format | Parquet-only for R2 Data Catalog sinks |
| Partitioning | Hive-style via strftime patterns (time-based only) |
| Compaction | Automatic via R2 Data Catalog (up to 2GB/hour during beta) |
| Schema | Stream schemas with validation + SQL transformations |
| Throughput | Up to 100 MB/s per pipeline |
| Delivery | Exactly-once guarantees |

### Recommendation

**Use Cloudflare Pipelines for streaming event ingestion.** It provides:
1. Managed Iceberg table creation and maintenance
2. Automatic compaction via R2 Data Catalog
3. SQL-based transformation at ingestion time
4. Integration with existing `db/iceberg/` reader code

## Architecture Overview

```
                    +-----------------+
                    |   Durable Object |
                    |   (DO Event)     |
                    +--------+--------+
                             |
                             | Worker Binding / HTTP
                             v
                    +-----------------+
                    |   Pipeline      |
                    |   Stream        |
                    +--------+--------+
                             |
                             | SQL Transformation
                             v
                    +-----------------+
                    |   Pipeline      |
                    |   Sink          |
                    +--------+--------+
                             |
                             | Exactly-once write
                             v
            +--------------------------------+
            |       R2 Data Catalog          |
            |  +---------------------------+ |
            |  |  Apache Iceberg Tables    | |
            |  |  - Parquet data files     | |
            |  |  - Avro manifest files    | |
            |  |  - JSON metadata          | |
            |  +---------------------------+ |
            +--------------------------------+
                             |
                             | Direct navigation
                             v
                    +-----------------+
                    |   IcebergReader |
                    |   (db/iceberg/) |
                    +-----------------+
```

## Cloudflare Pipelines Capabilities

### Components

**Streams** - Durable buffered queues that receive events:
- Accept JSON events via HTTP endpoint or Worker binding
- Support schema validation with enforcement
- Can feed multiple pipelines simultaneously
- 1 MB max payload size, 5 MB/s ingest rate (beta limits)

**Pipelines** - SQL transformation layer:
- Connect streams to sinks with SQL
- Support WITH clauses, WHERE filtering, UNNEST for arrays
- Immutable after creation (must recreate to modify SQL)

**Sinks** - Destination configuration:
- R2 Data Catalog: Iceberg tables with Parquet format
- R2 Files: JSON or Parquet with configurable compression
- Exactly-once delivery guarantees

### Stream Schema Definition

```json
{
  "fields": [
    { "name": "ns", "type": "string", "required": true },
    { "name": "type", "type": "string", "required": true },
    { "name": "id", "type": "string", "required": true },
    { "name": "ts", "type": "timestamp", "required": true },
    { "name": "data", "type": "json", "required": false },
    { "name": "visibility", "type": "string", "required": false }
  ]
}
```

Supported types: `string`, `int32`, `int64`, `float32`, `float64`, `bool`, `timestamp`, `binary`, `json`, `list`, `struct`

### Sink Configuration Options

| Option | Description | Recommendation |
|--------|-------------|----------------|
| `destination` | `data_catalog_table` or `r2` | `data_catalog_table` for Iceberg |
| `bucket` | R2 bucket name | Catalog-enabled bucket |
| `format` | `parquet` (catalog) or `json/parquet` (r2) | `parquet` |
| `compression` | `zstd`, `snappy`, `gzip`, `lz4`, `uncompressed` | `zstd` |
| `roll_interval` | Seconds between file writes (default 300) | 60-300 |
| `roll_size` | Max file size in MB before rotation | 100 |

### SQL Transformation Example

```sql
-- Basic pass-through with timestamp enrichment
INSERT INTO events_sink
SELECT
  ns,
  type,
  id,
  COALESCE(ts, NOW()) as ts,
  data,
  visibility
FROM events_stream
WHERE ns IS NOT NULL

-- With array expansion (UNNEST)
INSERT INTO events_sink
SELECT
  e.ns,
  e.type,
  item.id,
  e.ts,
  item.data,
  e.visibility
FROM events_stream e, UNNEST(e.items) as item
```

## R2 Data Catalog Integration

### Enabling the Catalog

```bash
# Via Wrangler CLI
wrangler r2 bucket catalog enable <bucket-name>

# Returns:
# - Catalog URI: https://catalog.r2.cloudflarestorage.com/<account-id>/<bucket>
# - Warehouse: <bucket-name>
```

### Iceberg Table Structure in R2

When Pipelines writes to R2 Data Catalog, files are organized as:

```
<bucket>/
  <warehouse>/
    <namespace>/
      <table>/
        metadata/
          v1.metadata.json        # Table metadata
          snap-123-1-uuid.avro    # Manifest list
          uuid-manifest.avro      # Manifest file
        data/
          dt=2026-01-13/          # Partition directory (time-based)
            00001-uuid.parquet    # Data file
            00002-uuid.parquet
```

### Compaction

R2 Data Catalog provides automatic compaction during the beta period:
- Compacts up to 2 GB of files per hour per table
- Retroactively applies to existing tables when enabled
- Reduces small file overhead from frequent writes

**Important:** This removes the need for custom compaction logic in `db/iceberg/`.

## Integration with Existing Code

### Compatibility with `db/iceberg/`

The existing Iceberg reader code in `db/iceberg/` is **fully compatible** with Pipelines-written tables:

| Module | Compatibility | Notes |
|--------|--------------|-------|
| `reader.ts` / `IcebergReader` | Compatible | Point lookups work unchanged |
| `metadata.ts` | Compatible | Parses standard Iceberg v2 metadata |
| `manifest.ts` | Compatible | Parses Avro manifests |
| `parquet.ts` | Compatible | Reads Parquet data files |
| `snapshot-writer.ts` | Not used | Pipelines handles writes |

### Current Partition Strategy vs Pipelines

**Existing code** (`db/iceberg/reader.ts`):
```typescript
// Uses identity partitioning on (ns, type, visibility)
const NS_PARTITION_INDEX = 0
const TYPE_PARTITION_INDEX = 1
const VISIBILITY_PARTITION_INDEX = 2
```

**Pipelines limitation:** Only supports time-based Hive-style partitioning via strftime:
- `%Y-%m-%d` (year-month-day)
- `%Y/%m/%d/%H` (nested directories)

**Gap:** Pipelines cannot partition by `ns` or `type` directly. This affects:
- Manifest pruning efficiency
- Query performance for namespace-scoped lookups

**Workaround options:**
1. Use R2 Files sink with custom partitioning (lose Iceberg benefits)
2. Create separate tables per namespace/type combination
3. Accept time-only partitioning and rely on column statistics for pruning

## Implementation Recommendations

### Phase 1: DO Event Streaming (Recommended)

Stream DO lifecycle events to R2 Data Catalog for analytics and time-travel.

**Schema:**
```json
{
  "fields": [
    { "name": "do_id", "type": "string", "required": true },
    { "name": "ns", "type": "string", "required": true },
    { "name": "event_type", "type": "string", "required": true },
    { "name": "ts", "type": "timestamp", "required": true },
    { "name": "snapshot_id", "type": "string", "required": false },
    { "name": "payload", "type": "json", "required": false }
  ]
}
```

**Pipeline SQL:**
```sql
INSERT INTO do_events_sink
SELECT
  do_id,
  ns,
  event_type,
  ts,
  snapshot_id,
  payload
FROM do_events_stream
```

**Worker Integration:**
```typescript
// In DOBase.ts or event handler
async function emitEvent(env: Env, event: DOEvent) {
  await env.DO_EVENTS_STREAM.send([{
    do_id: this.doId,
    ns: this.ns,
    event_type: event.type,
    ts: Date.now(),
    snapshot_id: event.snapshotId,
    payload: event.data
  }])
}
```

### Phase 2: Resource Catalog (Future)

For the full `do_resources` table currently served by `IcebergReader`, consider:

1. **Separate tables per type:** `do_functions`, `do_schemas`, `do_events`
2. **Time-series approach:** Partition by creation date, filter by ns in SQL
3. **Hybrid:** Use Pipelines for append-only events, `IcebergSnapshotWriter` for state snapshots

### Wrangler Configuration

```toml
# wrangler.toml additions

[[pipelines]]
name = "do-events"

[[pipelines.streams]]
name = "do-events-stream"
http_endpoint = true
schema = "schemas/do-events.json"

[[pipelines.sinks]]
name = "do-events-sink"
destination = "data_catalog_table"
bucket = "dotdo-data"
compression = "zstd"

[pipelines.sinks.rolling]
max_interval_seconds = 60
max_size_mb = 100

[[pipelines]]
sql = """
INSERT INTO do-events-sink
SELECT * FROM do-events-stream
"""
```

## Latency Considerations

### Write Path Latency

| Stage | Latency | Notes |
|-------|---------|-------|
| Worker -> Stream | ~1-5ms | Same-colo network |
| Stream buffering | 0-300s | Based on roll_interval |
| Write to R2 | ~10-50ms | Parquet file write |
| Metadata commit | ~5-20ms | Iceberg transaction |

**Total end-to-end:** 10s - 5min depending on batching configuration.

### Read Path Latency (unchanged)

From `db/iceberg/reader.ts`:
- Point lookups: 50-150ms with metadata caching
- Query via R2 SQL: 500ms - 2s

## Rate Limits (Open Beta)

| Resource | Limit | Request Increase |
|----------|-------|------------------|
| Streams per account | 20 | Via form |
| Sinks per account | 20 | Via form |
| Pipelines per account | 20 | Via form |
| Payload size | 1 MB | Not adjustable |
| Ingest rate per stream | 5 MB/s | Via form |
| Pipeline throughput | 100 MB/s | Via form |

## Cost Analysis

During open beta:
- **Pipelines processing:** Free
- **R2 storage:** Standard R2 pricing
- **R2 operations:** Standard R2 pricing
- **Data Catalog:** Free (included with R2)
- **Egress:** Zero egress fees (R2 benefit)

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Pipelines SQL is immutable | Medium | Plan schema carefully; use versioned table names |
| Time-only partitioning | Medium | Accept for analytics; use hybrid approach for lookups |
| Beta rate limits | Low | Request increases; implement backpressure in Workers |
| Compaction lag | Low | Configure smaller roll_size for fewer files |

## Open Questions

1. **Multi-tenant isolation:** Should we create separate pipelines per tenant, or use a single pipeline with tenant ID in data?

2. **Schema evolution:** How to handle schema changes when Pipelines SQL is immutable?

3. **Backfill strategy:** How to populate historical data into Pipelines-managed tables?

4. **R2 SQL integration:** Should we use R2 SQL for analytics queries, or stick with direct Iceberg navigation?

## Conclusion

Cloudflare Pipelines provides a managed, production-ready write path to R2 Data Catalog. The main trade-off is limited partitioning flexibility (time-based only) versus full Iceberg capabilities (any partition strategy).

**Recommended approach:**
1. Use Pipelines for event streaming and analytics workloads
2. Keep `IcebergSnapshotWriter` for DO state snapshots requiring custom partitioning
3. Use `IcebergReader` unchanged for point lookups on both data sources

## References

- [Cloudflare Pipelines Documentation](https://developers.cloudflare.com/pipelines/)
- [Cloudflare Pipelines Getting Started](https://developers.cloudflare.com/pipelines/getting-started/)
- [R2 Data Catalog Documentation](https://developers.cloudflare.com/r2/data-catalog/)
- [R2 Data Catalog: Managed Apache Iceberg tables](https://blog.cloudflare.com/r2-data-catalog-public-beta/)
- [Cloudflare Data Platform Announcement](https://blog.cloudflare.com/cloudflare-data-platform/)
- [Pipelines SQL Reference](https://developers.cloudflare.com/pipelines/sql-reference/)
- [Cloudflare Pipelines API](https://developers.cloudflare.com/api/resources/pipelines/)
