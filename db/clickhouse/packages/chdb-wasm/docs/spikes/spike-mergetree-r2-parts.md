# Spike: MergeTree Parts Storage on R2

## Executive Summary

This spike investigates how MergeTree data parts can be persisted to Cloudflare R2 object storage. The research covers part structure, R2 mapping strategies, read/write paths, and atomic operations. The goal is to enable durable MergeTree storage on Cloudflare Workers using R2 for data and Durable Objects for metadata coordination.

**Conclusion**: The existing implementation in this codebase provides a solid foundation. MergeTree parts map naturally to R2 objects with one object per file within a part. The Durable Object (DO) layer handles metadata and coordination, while R2 stores the actual column data. Key considerations include atomic part replacement, efficient range reads for columnar access, and proper caching strategies.

## 1. MergeTree Part Structure

### 1.1 What is a Part?

In ClickHouse's MergeTree engine, data is stored in horizontal divisions called "parts". Each part:
- Contains a contiguous range of primary key values
- Is stored in its own directory
- Is immutable once written (append-only semantics)
- Can be merged with other parts in the background

### 1.2 Part Naming Convention

Parts follow a specific naming convention:

```
{partition}_{min_block}_{max_block}_{level}
```

Examples:
- `20240115_1_1_0` - Partition 20240115, blocks 1-1, level 0 (new insert)
- `20240115_1_5_1` - Partition 20240115, blocks 1-5, level 1 (merged from 5 parts)
- `all_0_0_0` - No partitioning, all data in one partition

The level indicates how many merges have occurred:
- Level 0: Initial insert
- Level 1+: Result of merging previous parts

### 1.3 Files Within a Part

Each MergeTree part directory contains these files:

#### Data Files (Wide Format)
When part size > 10MB, data is stored in separate column files:

| File | Description | Size |
|------|-------------|------|
| `{column}.bin` | Compressed column data | Large (KB-GB) |
| `{column}.mrk3` | Mark file (granule index into .bin) | Small-Medium |
| `{column}.mrk2` | Legacy mark format | Small-Medium |

#### Data Files (Compact Format)
When part size < 10MB, all columns are in one file:

| File | Description | Size |
|------|-------------|------|
| `data.bin` | All column data combined | Medium (KB-MB) |
| `data.mrk3` | Combined mark file | Small |

#### Metadata Files

| File | Description | Size | Cacheable |
|------|-------------|------|-----------|
| `checksums.txt` | Checksums of all files | ~1KB | Yes |
| `columns.txt` | Column names and types | ~256B | Yes |
| `count.txt` | Row count | ~16B | Yes |
| `primary.idx` | Primary key index | Small-Medium | Yes |
| `partition.dat` | Partition key value | ~64B | Yes |
| `minmax_{col}.idx` | MinMax index per partition column | ~128B | Yes |
| `skp_idx_{name}.idx` | Skip index files | Varies | Yes |
| `skp_idx_{name}.mrk3` | Skip index marks | Varies | Yes |

#### Projections
Sub-directories containing pre-aggregated data:
```
{part_name}/
  {projection_name}.proj/
    data.bin
    columns.txt
    checksums.txt
```

### 1.4 Part State Lifecycle

```
temporary -> committed -> [merging] -> obsolete -> deleted
    |            |            |            |
    v            v            v            v
  Writing    Queryable    Being       Superseded
                         merged       by merge
```

### 1.5 How Parts are Merged

MergeTree merges parts to:
1. Reduce the number of parts (improves query performance)
2. Remove deleted/updated rows (for ReplacingMergeTree, etc.)
3. Apply TTL deletions

Merge process:
1. Select parts to merge (same partition, consecutive blocks)
2. Create new part with combined data
3. Atomically update part list (new part visible, old parts hidden)
4. Delete old parts after delay (allows in-flight queries to complete)

## 2. R2 Mapping Strategy

### 2.1 Key Structure

The existing implementation uses a hierarchical key structure:

```
{database}/{table}/data/{partition}/{part_name}/{file}
```

Example paths:
```
default/events/data/202401/20240115_1_1_0/data.bin
default/events/data/202401/20240115_1_1_0/checksums.txt
default/events/data/202401/20240115_1_1_0/columns.txt
default/events/data/202401/20240115_1_5_1/id.bin
default/events/data/202401/20240115_1_5_1/id.mrk3
default/events/data/202401/20240115_1_5_1/timestamp.bin
```

### 2.2 One R2 Object Per File vs Per Part

**Current Design: One Object Per File**

Pros:
- Efficient range reads (R2 supports byte-range requests)
- Can read only needed columns (column pruning)
- Natural fit for ClickHouse's file-based I/O
- Parallel downloads of multiple columns
- Granular caching

Cons:
- More R2 API calls for full part reads
- Metadata overhead per object

**Alternative: One Object Per Part (Rejected)**

Pros:
- Fewer R2 API calls
- Simpler listing

Cons:
- Cannot read partial column data
- Must download entire part for any query
- No column pruning
- Larger minimum read size

**Recommendation**: Keep one object per file for optimal query performance.

### 2.3 Prefix Structure Benefits

The hierarchical prefix structure enables:

1. **Efficient listing**: List all parts in a partition
   ```typescript
   r2.list({ prefix: "default/events/data/202401/" })
   ```

2. **Bulk deletion**: Delete all files in a part
   ```typescript
   r2.delete(keys) // up to 1000 keys per call
   ```

3. **Partition-level operations**: Drop partition efficiently

4. **Table-level operations**: List all partitions, calculate storage

### 2.4 Storage Layer Separation

The implementation uses a two-layer approach:

```
                  +------------------+
                  |   VFS Bridge     |  (WASM <-> JS interface)
                  +--------+---------+
                           |
              +------------+------------+
              |                         |
   +----------v----------+   +----------v----------+
   |  MergeTree R2       |   |  MergeTree DO       |
   |  (Data Storage)     |   |  (Metadata)         |
   +---------------------+   +---------------------+
              |                         |
              v                         v
         R2 Bucket               Durable Object
    (Column data, marks)      (Schema, parts list,
                              locks, mutations)
```

**R2 Layer** (`MergeTreeR2.ts`):
- Column data files (`.bin`)
- Mark files (`.mrk3`)
- Large index files
- 64KB read alignment for efficiency
- LRU cache for metadata files
- Multipart uploads for large files

**DO Layer** (`MergeTreeDO.ts`):
- Table schema
- Part registry (which parts exist)
- Part state (temporary/committed/obsolete)
- Write lock coordination
- Mutation log

## 3. Read Path Design

### 3.1 Query Execution Flow

```
1. Parse SQL query
2. Get table schema from DO
3. Get active parts list from DO
4. For each matching part:
   a. Load primary index (cached)
   b. Determine relevant granules using PK
   c. Load mark files for needed columns (cached)
   d. Read column data ranges from R2
   e. Decompress and filter
5. Aggregate results
6. Return to client
```

### 3.2 Lazy Loading vs Eager Loading

**Current Design: Lazy Loading with Caching**

```typescript
// From MergeTreeR2.ts
const CACHEABLE_FILES = [
  'checksums.txt',
  'columns.txt',
  'count.txt',
  'primary.idx',
  'partition.dat',
  'minmax_',      // prefix
  'skp_idx_',     // prefix
];
```

Small metadata files are:
1. Loaded on first access
2. Cached in memory (64MB max cache)
3. TTL of 5 minutes

Large data files are:
1. Read on demand via range requests
2. Read alignment to 64KB for R2 efficiency
3. Not cached (too large, streaming preferred)

### 3.3 Caching Strategy

**Multi-Level Cache**:

```
Level 1: In-Worker LRU Cache (64MB)
         - Metadata files (checksums, columns, indexes)
         - Frequently accessed ranges
         - TTL: 5 minutes

Level 2: R2 Edge Cache (Automatic)
         - Range request responses
         - Varies by region

Level 3: R2 Storage (Origin)
         - All data
         - Durable
```

**Cache Key Design**:
```typescript
// Full path as cache key
const cacheKey = `${database}/${table}/data/${partition}/${part}/${file}`;
```

**Cache Invalidation**:
- On write: Remove key from cache
- On part obsolescence: Clear all keys for part
- TTL expiration: Background cleanup

### 3.4 Range Read Optimization

R2 performs best with aligned reads:

```typescript
// From MergeTreeR2.ts
async readRange(path: string, offset: number, length: number): Promise<Uint8Array> {
  // Align read to 64KB boundary for R2 efficiency
  const alignedOffset = Math.floor(offset / this.readAlignment) * this.readAlignment;
  const alignedEnd = Math.ceil((offset + length) / this.readAlignment) * this.readAlignment;
  const alignedLength = alignedEnd - alignedOffset;

  const object = await this.r2.get(path, {
    range: { offset: alignedOffset, length: alignedLength },
  });

  // Extract requested range from aligned read
  const startInBuffer = offset - alignedOffset;
  return data.slice(startInBuffer, startInBuffer + length);
}
```

### 3.5 Parallel Column Loading

For queries reading multiple columns, load in parallel:

```typescript
async function loadColumns(
  part: PartInfo,
  columns: string[],
  granules: number[]
): Promise<Map<string, ArrayBuffer>> {
  const results = new Map<string, ArrayBuffer>();

  // Load all columns in parallel
  await Promise.all(columns.map(async (column) => {
    const data = await loadColumnGranules(part, column, granules);
    results.set(column, data);
  }));

  return results;
}
```

## 4. Write Path Design

### 4.1 INSERT Flow

```
1. Acquire write lock from DO
2. Generate part name: {partition}_{block}_{block}_0
3. Register part in DO (state: temporary)
4. For each column:
   a. Compress data
   b. Write to R2 (.bin file)
   c. Generate marks
   d. Write marks to R2 (.mrk3 file)
5. Write metadata files (checksums, columns, count)
6. Commit part in DO (state: committed)
7. Release write lock
```

### 4.2 Atomic Part Replacement

MergeTree relies on atomic part visibility changes. With R2, this is achieved through the DO layer:

```typescript
// From MergeTreeDO.ts
async commitPart(table: string, partId: string): Promise<void> {
  await this.ctx.blockConcurrencyWhile(async () => {
    const part = tableParts.get(partId);
    if (part.state !== 'temporary') {
      throw new Error(`Part ${partId} is not in temporary state`);
    }

    // Atomic state change
    part.state = 'committed';
    part.modificationTime = Date.now();

    await this.persistParts(table);
  });
}
```

The DO's `blockConcurrencyWhile` ensures atomicity.

### 4.3 Multipart Upload for Large Parts

For parts > 5MB, use R2 multipart upload:

```typescript
// From MergeTreeR2.ts
async writeFile(path: string, data: Uint8Array): Promise<void> {
  if (data.length <= this.multipartThreshold) {
    // Direct upload for small files
    await this.r2.put(path, data);
  } else {
    // Multipart upload for large files
    const uploadId = await this.startMultipartUpload(path);

    try {
      const parts: { partNum: number; etag: string }[] = [];

      for (let i = 0; i < data.length; i += this.multipartPartSize) {
        const partNum = Math.floor(i / this.multipartPartSize) + 1;
        const partData = data.slice(i, i + this.multipartPartSize);
        const etag = await this.uploadPart(uploadId, partNum, partData);
        parts.push({ partNum, etag });
      }

      await this.completeMultipartUpload(uploadId, parts);
    } catch (error) {
      await this.abortMultipartUpload(uploadId);
      throw error;
    }
  }
}
```

### 4.4 Part Mutation Handling

Mutations (UPDATE/DELETE) in MergeTree create new parts:

```typescript
// From MergeTreeDO.ts
async registerMerge(
  table: string,
  resultPart: Omit<PartInfo, 'state'>,
  sourceParts: string[]
): Promise<void> {
  await this.ctx.blockConcurrencyWhile(async () => {
    // Mark source parts as obsolete
    for (const name of sourceParts) {
      const part = tableParts.get(name);
      if (part && part.state === 'committed') {
        part.state = 'obsolete';
      }
    }

    // Add merged part as committed
    tableParts.set(resultPart.name, { ...resultPart, state: 'committed' });

    await this.persistParts(table);
  });
}
```

### 4.5 Write Coordination

The DO provides distributed locking:

```typescript
// From MergeTreeDO.ts
async acquireLock(table: string, timeout: number): Promise<string> {
  const lockId = `lock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  while (Date.now() - startTime < maxWait) {
    const acquired = await this.ctx.blockConcurrencyWhile(async () => {
      // Check for expired locks
      const existingLock = this.locks.get(table);
      if (existingLock && existingLock.expiresAt < Date.now()) {
        this.locks.delete(table);
      }

      // Try to acquire
      if (!this.locks.has(table)) {
        this.locks.set(table, {
          lockId,
          holder: lockId,
          acquiredAt: Date.now(),
          expiresAt: Date.now() + timeout,
        });
        return true;
      }
      return false;
    });

    if (acquired) return lockId;
    await new Promise(r => setTimeout(r, 100));
  }

  throw new Error('Lock acquisition timeout');
}
```

## 5. Consistency and Durability

### 5.1 Eventual Consistency Considerations

R2 provides strong consistency for:
- Read-after-write (same region)
- List-after-write (same region)

However, cross-region replication is eventually consistent.

**Mitigation**: The DO is the source of truth for part state. Queries always check DO before accessing R2 data.

### 5.2 Failure Modes

**Insert Failure During Write**:
- Part remains in `temporary` state
- Cleanup job removes orphaned temporary parts
- No data corruption (append-only)

**DO Failure**:
- Cloudflare's Durable Objects are replicated
- Automatic failover
- State recovered from persistent storage

**R2 Failure**:
- R2 provides 99.999999999% durability
- Multi-region replication
- Objects are immutable once written

### 5.3 Recovery Procedures

**Orphaned Temporary Parts**:
```typescript
async cleanupOrphanedParts(): Promise<void> {
  const maxAge = 24 * 60 * 60 * 1000; // 24 hours

  for (const [name, part] of tableParts) {
    if (part.state === 'temporary' &&
        Date.now() - part.modificationTime > maxAge) {
      // Delete R2 objects
      await this.r2.deletePrefix(partPrefix);
      // Remove from registry
      tableParts.delete(name);
    }
  }
}
```

## 6. Performance Characteristics

### 6.1 Expected Latencies

| Operation | Cold (ms) | Warm (ms) |
|-----------|-----------|-----------|
| DO schema fetch | 20-50 | 5-15 |
| DO parts list | 20-50 | 5-15 |
| R2 metadata read | 30-50 | 10-20 |
| R2 range read (64KB) | 30-50 | 15-30 |
| R2 range read (1MB) | 40-80 | 20-40 |
| R2 full file read | 50-200 | varies |

### 6.2 Optimization Recommendations

1. **Read Primary Index Early**: Cache in DO or first R2 call
2. **Batch Mark File Reads**: Combine multiple column marks
3. **Prefetch Next Granules**: For sequential scans
4. **Column Pruning**: Only read needed columns
5. **Partition Pruning**: Skip irrelevant partitions early

### 6.3 Cost Considerations

R2 Pricing (as of 2025):
- Storage: $0.015/GB/month
- Class A operations (write): $4.50/million
- Class B operations (read): $0.36/million
- Egress: Free

**Cost Optimization**:
- Cache frequently read metadata
- Batch small writes
- Use multipart for large files (fewer operations)
- Align reads to reduce partial object fetches

## 7. Implementation Status

### 7.1 Existing Implementation

The codebase already contains a complete implementation:

| Component | File | Status |
|-----------|------|--------|
| R2 Storage | `configs/chdb-lake/MergeTreeR2.ts` | Complete |
| DO Metadata | `configs/chdb-lake/MergeTreeDO.ts` | Complete |
| VFS Provider | `configs/chdb-lake/MergeTreeVFSProvider.ts` | Complete |
| VFS Design | `wasm/docs/MERGETREE_VFS_DESIGN.md` | Complete |

### 7.2 Key Interfaces

**Part Info** (from `MergeTreeDO.ts`):
```typescript
interface PartInfo {
  name: string;              // e.g., "20240115_1_1_0"
  state: PartState;          // temporary | committed | obsolete
  partition: string;         // Partition key value
  minBlock: number;          // Block range
  maxBlock: number;
  level: number;             // Merge level
  rows: number;              // Row count
  bytesCompressed: number;
  bytesUncompressed: number;
  modificationTime: number;
  r2Keys: string[];          // R2 object keys
  checksum: string;
}
```

**R2 Storage Config** (from `MergeTreeR2.ts`):
```typescript
interface MergeTreeR2Config {
  maxCacheSize?: number;        // Default: 64MB
  readAlignment?: number;       // Default: 64KB
  multipartThreshold?: number;  // Default: 5MB
  multipartPartSize?: number;   // Default: 5MB
  cacheTtlMs?: number;          // Default: 5 minutes
}
```

## 8. Future Enhancements

### 8.1 Background Merges

Current limitation: No automatic background merging.

Future work:
- Durable Object Alarms for scheduled merges
- Merge scheduling based on part count/size
- Parallel merge execution

### 8.2 Multi-Region Support

R2 supports multi-region replication:
- Configure R2 bucket for multi-region
- DO automatically handled by Cloudflare
- Consider read replicas for query distribution

### 8.3 Compression Improvements

Currently: LZ4 compression (ClickHouse default)

Potential improvements:
- ZSTD for better compression ratio
- Per-column codec selection
- Dictionary compression for low-cardinality columns

### 8.4 Index Improvements

- Pre-computed skip indexes stored in R2
- Bloom filters for string columns
- MinMax indexes for time-series optimization

## 9. Conclusion

The existing implementation provides a robust foundation for MergeTree storage on R2:

1. **Part Structure**: Natural mapping of MergeTree files to R2 objects
2. **R2 Mapping**: One object per file with hierarchical key structure
3. **Read Path**: Lazy loading with LRU caching and aligned reads
4. **Write Path**: Atomic commits via DO with multipart uploads
5. **Consistency**: DO as source of truth, R2 for durable data

The design successfully adapts ClickHouse's MergeTree storage model to Cloudflare's serverless infrastructure while maintaining the key properties that make MergeTree efficient for analytical queries.

## References

- [ClickHouse MergeTree Documentation](https://clickhouse.com/docs/engines/table-engines/mergetree-family/mergetree)
- [ClickHouse MergeTree on S3 - Altinity Blog](https://altinity.com/blog/clickhouse-mergetree-on-s3-intro-and-architecture)
- [Data Storage in MergeTree - PostHog Handbook](https://posthog.com/handbook/engineering/clickhouse/data-storage)
- [Cloudflare R2 Documentation](https://developers.cloudflare.com/r2/)
- [Cloudflare Durable Objects Documentation](https://developers.cloudflare.com/durable-objects/)
- Internal: `wasm/docs/MERGETREE_VFS_DESIGN.md`
- Internal: `configs/chdb-lake/MergeTreeR2.ts`
- Internal: `configs/chdb-lake/MergeTreeDO.ts`
