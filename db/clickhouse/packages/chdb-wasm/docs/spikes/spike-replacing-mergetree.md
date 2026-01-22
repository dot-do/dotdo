# Spike: ReplacingMergeTree for Document-Style Upserts in WASM

## Executive Summary

This spike investigates how ClickHouse's ReplacingMergeTree engine can enable document-style databases with upsert semantics in the WASM environment. ReplacingMergeTree provides eventual-consistency upserts by keeping only the latest version of each row during background merges.

**Key Findings**:
1. ReplacingMergeTree handles duplicates during merge operations, not at insert time
2. The `version` column determines which row to keep (highest version wins)
3. The `is_deleted` column enables soft deletes with cleanup merges
4. FINAL modifier forces deduplication at query time (significant performance cost)
5. WASM compatibility requires careful consideration of threading and I/O

**Conclusion**: ReplacingMergeTree is viable for WASM but with important trade-offs. For the minimal profile, a hybrid approach using Memory engine + manual deduplication at query time may be more practical. For the standard profile with R2 storage, ReplacingMergeTree through VFS abstraction is the recommended path.

## 1. ReplacingMergeTree Engine Overview

### 1.1 What is ReplacingMergeTree?

ReplacingMergeTree is a MergeTree variant designed for deduplication. From the source code:

```cpp
// vendor/chdb/src/Storages/MergeTree/MergeTreeData.h:408
enum Mode
{
    Ordinary            = 0,
    Collapsing          = 1,
    Summing             = 2,
    Aggregating         = 3,
    Replacing           = 5,  // <-- ReplacingMergeTree
    Graphite            = 6,
    VersionedCollapsing = 7,
    Coalescing          = 8,
};
```

### 1.2 Core Parameters

From `registerStorageMergeTree.cpp`:

```cpp
case MergeTreeData::MergingParams::Replacing:
    add_optional_param("is_deleted column");  // UInt8, marks deleted rows
    add_optional_param("version");            // Any comparable type
    break;
```

The engine accepts:
- **version column** (optional): Any comparable type. Higher version wins.
- **is_deleted column** (optional): UInt8. Value of 1 marks row as deleted.

### 1.3 Table Creation Syntax

```sql
-- Basic ReplacingMergeTree
CREATE TABLE documents (
    id String,
    data String,
    updated_at DateTime
) ENGINE = ReplacingMergeTree(updated_at)
ORDER BY id;

-- With soft deletes
CREATE TABLE documents (
    id String,
    data String,
    version UInt64,
    is_deleted UInt8
) ENGINE = ReplacingMergeTree(version, is_deleted)
ORDER BY id;
```

## 2. How Deduplication Works

### 2.1 Merge-Time Deduplication

The `ReplacingSortedAlgorithm` (found in `vendor/chdb/src/Processors/Merges/Algorithms/ReplacingSortedAlgorithm.cpp`) handles deduplication during merge:

```cpp
/// A non-strict comparison, since we select the last row for the same version values.
if (version_column_number == -1
    || selected_row.empty()
    || current->all_columns[version_column_number]->compareAt(
        current->getRow(), selected_row.row_num,
        *(*selected_row.all_columns)[version_column_number],
        /* nan_direction_hint = */ 1) >= 0)
{
    max_pos = current_pos;
    saveChunkForSkippingFinalFromSelectedRow();
    setRowRef(selected_row, current);  // Keep row with highest version
}
```

Key behaviors:
1. Rows are sorted by ORDER BY key
2. For duplicate keys, the row with the highest version is kept
3. If no version column: last inserted row wins
4. If versions are equal: last inserted row wins

### 2.2 Insert Behavior (No Immediate Deduplication)

Inserts do NOT deduplicate immediately:

```sql
INSERT INTO documents VALUES ('doc1', 'version 1', 1);
INSERT INTO documents VALUES ('doc1', 'version 2', 2);

SELECT * FROM documents;  -- Returns BOTH rows!
-- doc1, version 1, 1
-- doc1, version 2, 2

SELECT * FROM documents FINAL;  -- Returns only latest
-- doc1, version 2, 2
```

### 2.3 The FINAL Modifier

FINAL forces immediate deduplication at query time:

```sql
SELECT * FROM documents FINAL WHERE id = 'doc1';
```

From `MergeTask.cpp`, this triggers the merge algorithm inline:

```cpp
if (global_ctx->merging_params.mode == MergeTreeData::MergingParams::Replacing)
{
    key_columns.emplace(global_ctx->merging_params.is_deleted_column);
    key_columns.emplace(global_ctx->merging_params.version_column);
}
```

**Performance Cost**: FINAL requires reading all parts and performing merge logic at query time. This can be 2-10x slower than regular queries.

### 2.4 Cleanup Merges (Experimental)

The `is_deleted` column enables cleanup merges that physically remove deleted rows:

```cpp
// MergeTreeSettings.cpp:1691
DECLARE(Bool, allow_experimental_replacing_merge_with_cleanup, false, R"(
    Allow experimental CLEANUP merges for ReplacingMergeTree with `is_deleted`
    column. When enabled, allows using `OPTIMIZE ... FINAL CLEANUP` to manually
    merge all parts in a partition down to a single part and removing any
    rows that have been marked with is_deleted = 1.
)")
```

Usage:
```sql
-- Mark row as deleted
INSERT INTO documents VALUES ('doc1', '', 3, 1);

-- Force cleanup merge
OPTIMIZE TABLE documents FINAL CLEANUP;
```

## 3. WASM Compatibility Analysis

### 3.1 Disk I/O Requirements

MergeTree engines require persistent storage for:
- Column data files (`.bin`)
- Mark files (`.mrk3`)
- Primary index (`primary.idx`)
- Metadata (`checksums.txt`, `columns.txt`)

**WASM Solution**: VFS (Virtual File System) abstraction

From the existing implementation in `spike-mergetree-r2-parts.md`:
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
```

R2 can serve as the backing store with the VFS layer translating file operations.

### 3.2 Memory Requirements

Merge operations require memory for:
- Sorting buffers
- Mark loading
- Block processing

From `MergeTreeSettings.cpp`:
```cpp
DECLARE(UInt64, merge_max_block_size, DEFAULT_MERGE_BLOCK_SIZE, ...)
DECLARE(UInt64, merge_max_block_size_bytes, 0, ...)
```

For WASM, memory is constrained:
- Typical limit: 256MB - 4GB depending on platform
- Should use smaller block sizes
- Consider streaming merges

### 3.3 Threading Requirements

Background merges typically use thread pools:

```cpp
// MergeTask uses background thread pools for:
// - Horizontal merge stage
// - Vertical merge stage
// - Projection rebuilding
```

**WASM Limitation**:
- Single-threaded by default
- Web Workers available but complex coordination
- Cloudflare Workers: no shared memory between workers

**Mitigation Strategies**:
1. Foreground merges triggered by OPTIMIZE
2. Query-time deduplication with FINAL
3. Durable Object coordination for scheduled merges

### 3.4 Merge Algorithm Selection

From `MergeTask.cpp`:

```cpp
bool is_supported_storage =
    global_ctx->merging_params.mode == MergeTreeData::MergingParams::Ordinary ||
    global_ctx->merging_params.mode == MergeTreeData::MergingParams::Collapsing ||
    global_ctx->merging_params.mode == MergeTreeData::MergingParams::Replacing ||
    global_ctx->merging_params.mode == MergeTreeData::MergingParams::VersionedCollapsing;
```

ReplacingMergeTree supports vertical merge algorithm, which is more memory-efficient for wide tables.

## 4. Alternatives for Minimal Profile

### 4.1 Memory Engine + Manual Deduplication

For the minimal WASM profile without persistent storage:

```sql
-- Create Memory table
CREATE TABLE documents ENGINE = Memory AS SELECT ...;

-- Query with deduplication
SELECT * FROM documents
WHERE (id, version) IN (
    SELECT id, max(version) FROM documents GROUP BY id
);
```

Pros:
- No disk I/O
- Simpler implementation
- Lower memory overhead for merge operations

Cons:
- No persistence across sessions
- Full table scan for deduplication
- Limited by available memory

### 4.2 AggregatingMergeTree Alternative

For state aggregation use cases:

```sql
CREATE TABLE document_state (
    id String,
    data AggregateFunction(argMax, String, UInt64)
) ENGINE = AggregatingMergeTree()
ORDER BY id;

INSERT INTO document_state
SELECT id, argMaxState(data, version) FROM documents GROUP BY id;
```

Pros:
- Pre-aggregated state
- Efficient queries

Cons:
- More complex insert logic
- Limited to specific aggregation patterns

### 4.3 Simulated Upserts with INSERT...SELECT

```sql
-- Delete existing rows and insert new
INSERT INTO documents_new
SELECT * FROM documents WHERE id != 'target_id'
UNION ALL
SELECT 'target_id', 'new_data', now();

-- Swap tables
RENAME TABLE documents TO documents_old, documents_new TO documents;
DROP TABLE documents_old;
```

Pros:
- Works with any engine
- Immediate consistency

Cons:
- Expensive for large tables
- Not atomic
- Requires table locking

## 5. Implementation Strategy for WASM

### 5.1 Minimal Profile (Memory Only)

For the minimal WASM profile without R2:

```typescript
// Pseudo-implementation
class InMemoryDocumentStore {
    private data: Map<string, { version: number; data: any }> = new Map();

    upsert(id: string, version: number, data: any) {
        const existing = this.data.get(id);
        if (!existing || version > existing.version) {
            this.data.set(id, { version, data });
        }
    }

    get(id: string) {
        return this.data.get(id)?.data;
    }

    query(filter: (doc: any) => boolean) {
        return Array.from(this.data.values())
            .filter(doc => filter(doc.data));
    }
}
```

Use cases:
- Session-scoped data
- Caching layer
- Small datasets (< 100MB)

### 5.2 Standard Profile (R2 + VFS)

For persistent storage with R2:

```typescript
// Use ReplacingMergeTree via VFS
const createTable = `
    CREATE TABLE documents (
        id String,
        data String,
        version UInt64
    ) ENGINE = ReplacingMergeTree(version)
    ORDER BY id
`;

// Insert with automatic versioning
const insert = `
    INSERT INTO documents
    SELECT id, data, toUInt64(now64())
    FROM input('id String, data String')
`;

// Query with deduplication
const query = `
    SELECT * FROM documents FINAL
    WHERE id = {id:String}
`;
```

Implementation requirements:
1. VFS layer mapping to R2
2. Metadata coordination via Durable Object
3. Scheduled merge operations via DO alarms
4. Cache layer for hot data

### 5.3 Merge Scheduling in Cloudflare Workers

Using Durable Object alarms for background merges:

```typescript
// MergeTreeDO.ts
export class MergeTreeDO {
    async scheduleMerge(table: string) {
        const parts = await this.getCommittedParts(table);

        if (this.shouldMerge(parts)) {
            // Schedule merge via alarm
            await this.ctx.storage.setAlarm(Date.now() + 1000);
        }
    }

    async alarm() {
        // Perform merge operation
        const parts = await this.selectPartsToMerge();
        if (parts.length >= 2) {
            await this.mergeParts(parts);
        }

        // Reschedule if more merges needed
        if (this.shouldMerge(await this.getCommittedParts())) {
            await this.ctx.storage.setAlarm(Date.now() + 5000);
        }
    }

    private shouldMerge(parts: PartInfo[]): boolean {
        // Merge when too many parts or parts too small
        return parts.length > 10 || parts.some(p => p.rows < 1000);
    }
}
```

## 6. Query Patterns for Document Databases

### 6.1 Upsert Pattern

```sql
-- Upsert document
INSERT INTO documents (id, data, version)
VALUES ('doc123', '{"name": "test"}', now64());

-- Read latest version
SELECT * FROM documents FINAL WHERE id = 'doc123';
```

### 6.2 Soft Delete Pattern

```sql
-- Create table with is_deleted
CREATE TABLE documents (
    id String,
    data String,
    version UInt64,
    is_deleted UInt8 DEFAULT 0
) ENGINE = ReplacingMergeTree(version, is_deleted)
ORDER BY id;

-- Delete document
INSERT INTO documents (id, data, version, is_deleted)
VALUES ('doc123', '', now64(), 1);

-- Query active documents only
SELECT * FROM documents FINAL WHERE is_deleted = 0;

-- Cleanup deleted documents
OPTIMIZE TABLE documents FINAL CLEANUP;
```

### 6.3 Version History Pattern

If you need history, use a separate history table:

```sql
-- History table (append-only)
CREATE TABLE document_history (
    id String,
    data String,
    version UInt64,
    timestamp DateTime64
) ENGINE = MergeTree()
ORDER BY (id, version);

-- Current state table (deduplicated)
CREATE TABLE documents (
    id String,
    data String,
    version UInt64
) ENGINE = ReplacingMergeTree(version)
ORDER BY id;

-- Materialized view to maintain both
CREATE MATERIALIZED VIEW documents_mv TO documents AS
SELECT id, data, version FROM document_history;
```

## 7. Performance Considerations

### 7.1 Query Performance

| Query Type | Relative Cost | When to Use |
|------------|---------------|-------------|
| Regular SELECT | 1x | When duplicates acceptable |
| SELECT FINAL | 2-10x | When consistency required |
| SELECT with subquery dedup | 2-5x | Custom dedup logic |

### 7.2 Merge Frequency Trade-offs

More frequent merges:
- Faster FINAL queries
- More write amplification
- Higher CPU usage

Less frequent merges:
- Slower FINAL queries
- Lower write amplification
- More parts to manage

### 7.3 Version Column Selection

Good choices:
- `UInt64` auto-incrementing counter
- `DateTime64` with nanosecond precision
- `UInt64` from `now64()`

Avoid:
- `DateTime` (second precision may collide)
- Non-monotonic values
- Nullable columns

## 8. Recommendations

### 8.1 For Minimal WASM Profile

1. Use Memory engine with manual deduplication in application code
2. Implement simple Map-based document store in TypeScript
3. Support SQL queries via chdb for complex operations
4. No background merge complexity

### 8.2 For Standard WASM Profile with R2

1. Use ReplacingMergeTree with VFS abstraction
2. Implement merge scheduling via Durable Object alarms
3. Cache frequently accessed documents in worker memory
4. Use FINAL modifier for consistency-critical queries
5. Consider read-replica pattern for query distribution

### 8.3 Migration Path

1. Start with Memory engine in minimal profile
2. Add persistence via VFS/R2 when needed
3. Upgrade to ReplacingMergeTree for large datasets
4. Implement background merges when write volume justifies

## 9. Conclusion

ReplacingMergeTree provides a solid foundation for document-style upserts in ClickHouse. For WASM deployment:

- **Minimal profile**: Use Memory engine + application-level deduplication
- **Standard profile**: Use ReplacingMergeTree with VFS abstraction to R2
- **Background merges**: Coordinate via Durable Objects alarms

The eventual-consistency model of ReplacingMergeTree (deduplicate on merge, not insert) fits well with serverless constraints where immediate consistency is expensive.

## References

- Source: `vendor/chdb/src/Storages/MergeTree/registerStorageMergeTree.cpp`
- Source: `vendor/chdb/src/Processors/Merges/Algorithms/ReplacingSortedAlgorithm.cpp`
- Source: `vendor/chdb/src/Storages/MergeTree/MergeTask.cpp`
- Source: `vendor/chdb/src/Storages/MergeTree/MergeTreeData.h`
- Existing spike: `spike-mergetree-r2-parts.md`
- [ClickHouse ReplacingMergeTree Documentation](https://clickhouse.com/docs/engines/table-engines/mergetree-family/replacingmergetree)
