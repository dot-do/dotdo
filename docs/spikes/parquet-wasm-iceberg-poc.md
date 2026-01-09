# Spike: parquet-wasm First Approach to Iceberg Tables

**Status**: Proposed
**Author**: Engineering
**Date**: 2026-01-09

---

## 1. Hypothesis

**We can build a complete Iceberg read/write path using only parquet-wasm (6.3MB), without DuckDB (19MB) on the Worker side.**

This approach:
- Reduces Worker bundle size from ~25MB to ~10MB
- Eliminates SQL parsing overhead for point operations
- Reserves DuckDB for browser-side analytics (where it shines)
- Leverages R2 Data Catalog for Iceberg metadata management

### Why This Matters

| Metric | DuckDB Approach | parquet-wasm Approach |
|--------|-----------------|----------------------|
| Worker bundle | ~19MB (DuckDB) + ~6MB (parquet) | ~6.3MB |
| Cold start | ~50-100ms | ~20-30ms |
| Memory baseline | ~30MB | ~8-10MB |
| Point lookup | SQL parse + execute | Direct Parquet read |

---

## 2. Architecture Overview

```
                    PARQUET-WASM FIRST ARCHITECTURE
                    ================================

  BROWSER (Analytics)                    WORKER (Operations)                    STORAGE
  ==================                     ==================                     =======

  +-------------------+                 +---------------------+
  | DuckDB-WASM       |                 | IcebergMetadataDO   |
  | (~19MB)           |                 |                     |
  |                   |                 | - Metadata cache    |
  | - Full SQL        |                 | - Partition index   |
  | - Complex joins   |                 | - Bloom filters     |
  | - Aggregations    |                 | - Manifest parsing  |
  +-------------------+                 +----------+----------+
         |                                         |
         | Query Plan                              |
         v                                         v
  +-------------------+                 +---------------------+                +------------------+
  | Iceberg Client    | ---Plan req--> | Query Router        |                | R2 Data Catalog  |
  | SDK               | <--File URLs-- | Worker              |                | (Managed)        |
  |                   |                 |                     | <--REST API--> |                  |
  | - Plan execution  |                 | - Route analysis    |                | - Iceberg commits|
  | - OPFS caching    |                 | - Point lookups     |                | - Scan planning  |
  +-------------------+                 +---------------------+                +------------------+
         |                                         |                                    |
         | Presigned URLs                          |                                    |
         v                                         v                                    v
  +-------------------+                 +---------------------+                +------------------+
  | Direct R2 Fetch   |                 | ParquetReaderDO     |                | R2 Bucket        |
  | (via CORS)        |                 | (~6.3MB parquet-wasm)|               |                  |
  |                   |                 |                     |                | - Parquet files  |
  | - Row group reads |                 | - Point lookup      |                | - Manifests      |
  | - Column prune    |                 | - Write new records |                | - Metadata       |
  +-------------------+                 | - Filtered scans    |                +------------------+
                                        +---------------------+

  Zero server compute                   < 10MB total bundle                   Iceberg-native
  for heavy analytics                   Fast point operations                 Full ACID
```

### Component Responsibilities

| Component | Role | Bundle Impact |
|-----------|------|---------------|
| **IcebergMetadataDO** | Cache metadata, partition index, bloom filters | None (pure JS) |
| **ParquetReaderDO** | parquet-wasm I/O for reads/writes | 6.3MB WASM |
| **Query Router** | Route queries to optimal path | ~5KB |
| **Browser DuckDB** | Complex analytics, joins, aggregations | 0 (client-side) |
| **R2 Data Catalog** | Iceberg commits, scan planning | 0 (managed service) |

---

## 3. POC Scope

### 3.1 Point Lookup: Read Single Row by Primary Key

**Goal**: < 100ms latency for single record retrieval with partition hints.

```typescript
// API
const record = await iceberg.lookup({
  table: 'do_resources',
  partition: { ns: 'payments.do', type: 'Function' },
  id: 'charge'
})
```

**Implementation Path**:
1. Query `IcebergMetadataDO` for partition-to-file mapping
2. Use bloom filter to check if ID exists (optional early exit)
3. Fetch specific Parquet file from R2
4. Use parquet-wasm to read single row group
5. Return record

**Latency Budget**:
| Step | Target |
|------|--------|
| Metadata cache hit | 10ms |
| Bloom filter check | 5ms |
| R2 GET (Parquet) | 30-50ms |
| parquet-wasm parse | 10-20ms |
| **Total** | **55-85ms** |

### 3.2 Write: Insert New Rows, Generate Parquet, Commit to Iceberg

**Goal**: < 50ms acknowledgment, durable commit via R2 Data Catalog.

```typescript
// API
const result = await iceberg.write({
  table: 'do_analytics.events',
  records: [
    { id: 'evt_1', type: 'click', timestamp: Date.now() },
    { id: 'evt_2', type: 'view', timestamp: Date.now() },
  ]
})
```

**Implementation Path**:
1. Buffer writes in `TransactionDO` WAL (durable immediately)
2. Acknowledge to client (< 50ms)
3. Background: Batch to threshold or timeout
4. Generate Parquet with parquet-wasm (ZSTD compression)
5. Upload to R2
6. Commit via R2 Data Catalog REST API
7. Invalidate metadata cache

**Write Path Details**:
```typescript
// TransactionDO handles batching
class TransactionDO {
  private wal: WALEntry[] = []

  async write(records: Record[]): Promise<{ txId: string }> {
    // 1. Append to WAL (durable)
    const txId = crypto.randomUUID()
    await this.state.storage.put(`wal:${txId}`, { records, ts: Date.now() })

    // 2. Check batch threshold
    if (this.walSize() >= 1000) {
      this.state.waitUntil(this.commit())
    }

    return { txId } // Ack immediately
  }

  async commit() {
    // 3. Generate Parquet
    const parquetBytes = await this.generateParquet(this.wal)

    // 4. Upload to R2
    const path = `data/${this.table}/${Date.now()}.parquet`
    await this.env.R2.put(path, parquetBytes)

    // 5. Commit via R2 Data Catalog
    await this.catalog.commitTable(this.table, {
      requirements: [
        { type: 'assert-ref-snapshot-id', ref: 'main', snapshotId: this.currentSnapshot }
      ],
      updates: [
        { action: 'add-snapshot', snapshot: newSnapshot },
        { action: 'set-snapshot-ref', refName: 'main', snapshotId: newSnapshot.id }
      ]
    })

    // 6. Clear WAL, invalidate cache
    await this.clearWAL()
    await this.metadataDO.invalidate()
  }
}
```

### 3.3 Scan: Read Filtered Rows with Partition Pruning

**Goal**: Efficient filtered reads using partition bounds and column statistics.

```typescript
// API
const results = await iceberg.scan({
  table: 'do_analytics.events',
  filters: [
    { column: 'type', operator: 'eq', value: 'click' },
    { column: 'timestamp', operator: 'gte', value: Date.now() - 86400000 }
  ],
  limit: 1000
})
```

**Implementation Path**:
1. Query `IcebergMetadataDO` for manifest files matching filters
2. Prune partitions using partition bounds
3. For each relevant file, check column statistics
4. Fetch only files that may contain matching rows
5. Use parquet-wasm to read and filter locally
6. Aggregate results

**Pruning Strategy**:
```typescript
interface FileScanPlan {
  files: DataFileInfo[]
  pruningStats: {
    totalManifests: number
    prunedManifests: number
    totalDataFiles: number
    prunedDataFiles: number
  }
}

// Partition pruning reduces file reads by 10-100x
```

---

## 4. Implementation Plan

### Phase 1: Point Lookup with parquet-wasm (Week 1)

**Deliverables**:
- [ ] `IcebergMetadataDO` with metadata caching
- [ ] Partition index for O(1) file lookup
- [ ] parquet-wasm integration for single-file reads
- [ ] `/api/iceberg/lookup` endpoint
- [ ] Benchmark: < 100ms point lookup

**Key Code**:
```typescript
// objects/IcebergMetadataDO.ts
export class IcebergMetadataDO extends DurableObject {
  private cache: Map<string, CachedMetadata> = new Map()
  private partitionIndex: Map<string, string[]> = new Map() // partition -> files

  async getFileForPartition(table: string, partition: PartitionFilter): Promise<string[]> {
    const key = `${partition.ns}|${partition.type}`
    return this.partitionIndex.get(key) ?? []
  }
}

// db/iceberg/reader.ts
export async function readRecord(
  parquetBytes: Uint8Array,
  id: string
): Promise<Record<string, unknown> | null> {
  const table = wasm.readParquet(parquetBytes)
  // Filter to specific row
  // Return record or null
}
```

### Phase 2: Write Path with R2 Data Catalog Integration (Week 2)

**Deliverables**:
- [ ] `TransactionDO` with WAL and batching
- [ ] Parquet generation with parquet-wasm
- [ ] R2 Data Catalog commit integration
- [ ] `/api/iceberg/write` endpoint
- [ ] Benchmark: < 50ms ack, correct Iceberg commits

**Key Code**:
```typescript
// db/iceberg/writer.ts
export class IcebergWriter {
  async writeDataFile(records: Record[]): Promise<string> {
    const arrowTable = this.recordsToArrow(records)
    const ipcBuffer = tableToIPC(arrowTable, 'stream')
    const wasmTable = parquet.Table.fromIPCStream(ipcBuffer)

    const props = new parquet.WriterPropertiesBuilder()
      .setCompression(parquet.Compression.ZSTD)
      .setMaxRowGroupSize(2000)
      .setStatisticsEnabled(parquet.EnabledStatistics.Chunk)
      .build()

    const parquetBytes = parquet.writeParquet(wasmTable, props)

    const path = `data/${this.table}/${Date.now()}.parquet`
    await this.env.R2.put(path, parquetBytes)

    return path
  }
}
```

### Phase 3: Filtered Scans with Predicate Pushdown (Week 3)

**Deliverables**:
- [ ] Column statistics extraction from Parquet metadata
- [ ] Predicate pushdown logic (min/max bounds)
- [ ] Multi-file parallel reads
- [ ] `/api/iceberg/scan` endpoint
- [ ] Benchmark: 10x file reduction via pruning

**Key Code**:
```typescript
// db/iceberg/scanner.ts
export class IcebergScanner {
  async planScan(table: string, filters: Filter[]): Promise<FileScanPlan> {
    const metadata = await this.metadataDO.getMetadata(table)
    const manifests = await this.getManifests(metadata)

    // Prune by partition bounds
    const partitionPruned = manifests.filter(m =>
      this.matchesPartitionBounds(m, filters)
    )

    // Prune by column statistics
    const statsPruned = partitionPruned.flatMap(m =>
      m.dataFiles.filter(f => this.matchesColumnStats(f, filters))
    )

    return {
      files: statsPruned,
      pruningStats: { /* ... */ }
    }
  }

  async executeScan(plan: FileScanPlan, filters: Filter[]): Promise<Record[]> {
    const results: Record[] = []

    // Parallel file reads
    await Promise.all(plan.files.map(async (file) => {
      const bytes = await this.env.R2.get(file.path)
      const records = await this.readAndFilter(bytes, filters)
      results.push(...records)
    }))

    return results
  }
}
```

---

## 5. Success Criteria

### Performance Targets

| Operation | Target | Measurement |
|-----------|--------|-------------|
| Point lookup (cache hit) | < 100ms | p99 latency |
| Point lookup (cache miss) | < 200ms | p99 latency |
| Write acknowledgment | < 50ms | p99 latency |
| Scan (1K rows, 10 files) | < 500ms | p99 latency |

### Bundle Size Targets

| Component | Target | Current Best |
|-----------|--------|--------------|
| parquet-wasm WASM | < 7MB | 6.3MB |
| Worker JS bundle | < 3MB | TBD |
| **Total Worker** | **< 10MB** | TBD |

### Functional Requirements

- [ ] Point lookup returns correct record for known ID
- [ ] Point lookup returns null for unknown ID
- [ ] Write creates valid Parquet file readable by DuckDB
- [ ] Write commits are atomic via R2 Data Catalog
- [ ] Scan respects filters and returns only matching rows
- [ ] Partition pruning reduces file reads by 10x+ for partitioned queries

### Compatibility Requirements

- [ ] Generated Parquet files readable by DuckDB-WASM
- [ ] Generated Parquet files readable by Apache Spark
- [ ] Iceberg commits compatible with R2 Data Catalog spec
- [ ] Browser can query same tables via presigned URLs

---

## 6. Risks and Mitigations

### Risk 1: parquet-wasm Bundle Size Still Too Large

**Risk**: 6.3MB may exceed Cloudflare's 3MB inline WASM limit.

**Mitigation**: Use WASM binding or lazy load from R2:
```jsonc
// wrangler.jsonc
{
  "wasm_modules": {
    "PARQUET_WASM": "node_modules/parquet-wasm/bundler/parquet_wasm_bg.wasm"
  }
}
```

**Fallback**: If WASM binding doesn't work, lazy-load from R2 on first use (~50ms additional latency on cold start).

### Risk 2: No SQL Support for Complex Filters

**Risk**: parquet-wasm only provides row iteration, not SQL queries.

**Mitigation**:
- Implement filter logic in TypeScript (simple predicates)
- Route complex queries to browser DuckDB (zero server compute)
- For server-side complex queries, consider DuckDB Worker pool (separate from hot path)

### Risk 3: Memory Pressure with Large Scans

**Risk**: Loading many Parquet files into Worker memory may exceed 128MB limit.

**Mitigation**:
- Stream results rather than buffering
- Implement row group-level pagination
- Limit concurrent file reads (e.g., max 10 parallel)
- Fail fast with clear error if scan too large

```typescript
const MAX_SCAN_SIZE_BYTES = 50 * 1024 * 1024 // 50MB
if (plan.totalSizeBytes > MAX_SCAN_SIZE_BYTES) {
  return { error: 'SCAN_TOO_LARGE', redirect: 'client' }
}
```

### Risk 4: R2 Data Catalog API Latency

**Risk**: Iceberg commits via REST API may add significant latency.

**Mitigation**:
- Batch writes to reduce commit frequency
- Async commits (ack before commit completes)
- Measure and monitor commit latency
- Consider caching commit results

### Risk 5: Parquet File Proliferation (Small Files Problem)

**Risk**: Many small writes create many small Parquet files, degrading scan performance.

**Mitigation**:
- Implement compaction (merge small files into larger ones)
- Schedule background compaction in TransactionDO
- Target file sizes: 50-100MB for analytics tables

---

## 7. Out of Scope for POC

The following are explicitly out of scope for this POC:

- **Schema evolution**: Assumes fixed schema
- **Time travel**: Snapshot history not exposed
- **Compaction**: Small file merging
- **Delete operations**: Iceberg delete files
- **UPDATE operations**: Row-level updates
- **Concurrent writers**: Single-writer assumed
- **Browser query optimization**: Basic presigned URLs only

---

## 8. Open Questions

1. **Row group sizing**: What's the optimal row group size for Worker memory constraints? Initial hypothesis: 2000 rows.

2. **Bloom filter storage**: Should bloom filters be computed at write time and stored in Parquet metadata, or computed lazily?

3. **Partition scheme**: For `do_resources` table, is `(ns, type)` the right partition key? Consider `(ns, type, date)` for time-based pruning.

4. **Cache invalidation**: How do we handle cache invalidation across multiple IcebergMetadataDO instances (if sharded)?

5. **Transaction isolation**: What isolation level do we provide? Read-committed via snapshot isolation?

---

## 9. References

- [parquet-wasm Research](/docs/research/parquet-wasm-iceberg.md) - Detailed capability analysis
- [Hybrid Iceberg Architecture](/docs/plans/hybrid-iceberg-architecture.md) - Full architecture vision
- [Parquet Write POC Tests](/packages/duckdb-worker/tests/parquet-write-poc.test.ts) - Working examples
- [Apache Iceberg Spec](https://iceberg.apache.org/spec/) - Table format specification
- [R2 Data Catalog Docs](https://developers.cloudflare.com/r2/api/s3/extensions/data-catalog/) - REST API for Iceberg

---

## 10. Appendix: Benchmark Data

From existing POC tests (`parquet-write-poc.test.ts`):

### Write Performance (parquet-wasm, ZSTD)

| Rows | Write Time | File Size | Rows/sec |
|------|------------|-----------|----------|
| 100 | 0.3ms | 3.2 KB | 327,000 |
| 1,000 | 0.6ms | 18 KB | 1,645,000 |
| 5,000 | 2.3ms | 88 KB | 2,186,000 |
| 10,000 | 4.5ms | 176 KB | 2,207,000 |

### Memory Usage

| Row Count | WASM Memory |
|-----------|-------------|
| 10,000 | 8 MB |
| 50,000 | 9.3 MB |

### Compression Comparison (1000 rows)

| Codec | File Size | Write Time |
|-------|-----------|------------|
| UNCOMPRESSED | 28.7 KB | 0.40ms |
| SNAPPY | 20.9 KB | 0.54ms |
| **ZSTD** | **14.9 KB** | **0.61ms** |
| GZIP | 16.4 KB | 2.66ms |
