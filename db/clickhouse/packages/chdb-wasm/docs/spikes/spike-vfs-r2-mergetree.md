# Spike: VFS Design for MergeTree on R2 Storage in WASM

## Executive Summary

This spike investigates how to enable MergeTree storage engine functionality in WASM by abstracting file I/O operations to Cloudflare R2 object storage. The design leverages the existing VFS infrastructure in the codebase and proposes enhancements specifically optimized for MergeTree's access patterns.

**Conclusion**: MergeTree can work on R2 storage through the existing VFS abstraction with targeted enhancements for:
1. Mark file caching for efficient granule lookups
2. Column data range request optimization
3. Part metadata caching via Durable Objects
4. Write buffering for atomic part creation

## 1. Existing VFS Infrastructure Analysis

### 1.1 Current VFS Architecture

The codebase already has a comprehensive VFS layer:

```
+------------------+     +-------------------+     +------------------+
|   WASM Module    |     |   VFS Bridge      |     | Cloudflare       |
|   (C/C++ Code)   |<--->| (TypeScript)      |<--->| Infrastructure   |
|                  |     |                   |     |                  |
| - vfs_open()     |     | - File Handles    |     | - DO (metadata)  |
| - vfs_read()     |     | - Position Track  |     | - R2 (data)      |
| - vfs_write()    |     | - Write Buffer    |     |                  |
+------------------+     +-------------------+     +------------------+
```

**Key Files:**
- `/src/wasm/vfs-bridge.ts` - Core VFS bridge implementation
- `/src/wasm/core-loader.ts` - WASM module loader with VFS function exports
- `/src/r2-vfs.ts` - R2-backed VFS with advanced features
- `/src/storage/r2-provider.ts` - VFSStorageProvider implementation for R2
- `/src/storage/mergetree-do.ts` - Durable Object for MergeTree metadata

### 1.2 VFS Constants (from vfs-bridge.ts)

```typescript
// File mode flags
export const VFS_O_RDONLY = 0x0001;
export const VFS_O_WRONLY = 0x0002;
export const VFS_O_RDWR = 0x0003;
export const VFS_O_CREAT = 0x0100;
export const VFS_O_TRUNC = 0x0200;
export const VFS_O_APPEND = 0x0400;

// Seek origins
export const VFS_SEEK_SET = 0;
export const VFS_SEEK_CUR = 1;
export const VFS_SEEK_END = 2;

// File types
export const VFS_S_IFREG = 0x8000;  // Regular file
export const VFS_S_IFDIR = 0x4000;  // Directory
```

### 1.3 VFSStorageProvider Interface

The existing interface provides the foundation:

```typescript
export interface VFSStorageProvider {
  stat(path: string): Promise<FileStat | null>;
  read(path: string, offset: number, length: number): Promise<ArrayBuffer>;
  readFile(path: string): Promise<ArrayBuffer>;
  write(path: string, data: ArrayBuffer): Promise<void>;
  append(path: string, data: ArrayBuffer): Promise<void>;
  delete(path: string): Promise<void>;
  list(path: string): Promise<DirEntry[]>;
  mkdir(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  flush(): Promise<void>;
}
```

### 1.4 R2VFS Features (from r2-vfs.ts)

The existing `R2VFS` class already provides:
- **File handles** with reference counting
- **Read-ahead buffering** for sequential access (configurable, default 64KB)
- **Range request batching** for reduced API calls
- **Metadata caching** with LRU eviction
- **Retry logic** with exponential backoff
- **Concurrent read limiting** to prevent overload

## 2. MergeTree File Operations

### 2.1 MergeTree File Structure

MergeTree stores data in "parts" - directories containing:

```
data/{database}/{table}/{partition}/{part_name}/
  |-- checksums.txt      # Part checksum manifest
  |-- columns.txt        # Column list
  |-- count.txt          # Row count
  |-- primary.idx        # Primary key index
  |-- partition.dat      # Partition info
  |-- minmax_{col}.idx   # MinMax indexes
  |
  |-- {column}.bin       # Column data (compressed)
  |-- {column}.mrk3      # Mark file (index into .bin)
  |-- {column}.cidx      # Compression index (optional)
```

### 2.2 File Types and Access Patterns

| File Type | Size Range | Read Pattern | Write Pattern | Critical for Performance |
|-----------|------------|--------------|---------------|--------------------------|
| `primary.idx` | 1KB-10MB | Sequential + Random | Once | Yes - query planning |
| `*.mrk3` | 1KB-1MB | Random (sparse) | Once | Yes - data location |
| `*.bin` | 1KB-100MB+ | Range (granule) | Once | Yes - actual data |
| `checksums.txt` | ~1KB | Once (full) | Once | No |
| `columns.txt` | ~1KB | Once (full) | Once | No |
| `count.txt` | ~10B | Once (full) | Once | No |
| `minmax_*.idx` | ~1KB | Once (full) | Once | Yes - part skipping |

### 2.3 Read Patterns Analysis

**Primary Index Read (query planning):**
```
1. Open primary.idx
2. Read entire file (usually small, <10MB)
3. Binary search for key range
4. Close
```

**Mark File Read (locating data):**
```
1. Open {column}.mrk3
2. Read mark at index N (16 bytes: compressed_offset + decompressed_offset)
3. May read multiple non-consecutive marks
4. Close
```

**Column Data Read (actual data):**
```
1. Open {column}.bin
2. Seek to compressed_offset from mark
3. Read compressed granule (8192 rows typically)
4. Decompress
5. May read consecutive granules
6. Close
```

### 2.4 Write Patterns Analysis

**Part Creation (INSERT/MERGE):**
```
1. Create temporary directory
2. Write columns.txt, count.txt
3. For each column:
   a. Open {column}.bin for write
   b. Write compressed data chunks
   c. Close
   d. Open {column}.mrk3 for write
   e. Write marks as data is written
   f. Close
4. Write primary.idx
5. Write checksums.txt
6. Atomic rename temp -> final
```

**Key Insight**: Parts are immutable once written. No in-place updates.

## 3. R2 Storage Considerations

### 3.1 R2 Capabilities

| Feature | R2 Support | Notes |
|---------|------------|-------|
| Range reads | Yes | `{ offset, length }` |
| Suffix reads | Yes | `{ suffix: N }` |
| Append | No | Must rewrite entire object |
| Random write | No | Must rewrite entire object |
| Atomic rename | No | Copy + delete |
| Directory listing | Via prefix | `list({ prefix, delimiter })` |
| Object size limit | 5TB | More than enough |
| Multipart upload | Yes | For large objects |

### 3.2 Mapping File Operations to R2

| VFS Operation | R2 Implementation | Notes |
|---------------|-------------------|-------|
| `vfs_open(r)` | `bucket.head()` to verify | Cache metadata |
| `vfs_open(w)` | Initialize write buffer | Buffer locally |
| `vfs_read()` | `bucket.get({ range })` | Range request |
| `vfs_write()` | Buffer in memory | Flush on close |
| `vfs_seek()` | Update position | No R2 call |
| `vfs_close()` | `bucket.put()` for writes | Single PUT |
| `vfs_stat()` | `bucket.head()` | Cache result |
| `vfs_mkdir()` | No-op (implicit) | Directories don't exist |
| `vfs_unlink()` | `bucket.delete()` | Simple |
| `vfs_rename()` | Copy + delete | Not atomic! |

### 3.3 Key Challenge: No Append Operation

R2 does not support append. MergeTree writes column files sequentially.

**Solution**: Write buffering in the VFS layer (already implemented in `vfs-bridge.ts`):

```typescript
// From vfs-bridge.ts
private readonly WRITE_BUFFER_THRESHOLD = 256 * 1024;

async vfs_write(handleId: number, bufferPtr: number, size: number): Promise<number> {
  // Buffer writes locally
  handle.writeBuffer.push(data);
  handle.writeBufferSize += data.length;

  // Flush if threshold exceeded
  if (handle.writeBufferSize >= this.WRITE_BUFFER_THRESHOLD) {
    await this.flushWriteBuffer(handle);
  }
  return size;
}
```

For MergeTree parts (which are typically 10MB-1GB), we should:
1. Buffer entire file in memory during write
2. Single PUT to R2 on close
3. Use multipart upload for files > 5MB

### 3.4 Key Challenge: Atomic Rename

MergeTree uses atomic rename for:
1. Committing parts (temp -> final)
2. Merge completion

**Solution**: Use Durable Objects for coordination:

```typescript
// In MergeTreeDO
async commitPart(partName: string): Promise<void> {
  await this.state.blockConcurrencyWhile(async () => {
    // 1. Verify all R2 objects exist
    // 2. Update part registry atomically in DO
    // 3. Part is now "visible" for queries
  });
}
```

## 4. VFS Layer Design for MergeTree

### 4.1 MergeTree-Optimized Storage Provider

Create a specialized storage provider that wraps `R2StorageProvider`:

```typescript
class MergeTreeR2StorageProvider implements VFSStorageProvider {
  private r2Provider: R2StorageProvider;
  private markCache: Map<string, ArrayBuffer>;      // Mark files are small, cache them
  private primaryIndexCache: Map<string, ArrayBuffer>; // Primary indexes
  private metadataCache: Map<string, FileStat>;

  // Configuration
  private readonly MARK_CACHE_MAX_SIZE = 10 * 1024 * 1024;  // 10MB for marks
  private readonly PRIMARY_INDEX_CACHE_MAX_SIZE = 50 * 1024 * 1024; // 50MB for indexes

  async read(path: string, offset: number, length: number): Promise<ArrayBuffer> {
    // Route based on file type
    if (this.isMarkFile(path)) {
      return this.readMarkFile(path, offset, length);
    }
    if (this.isPrimaryIndex(path)) {
      return this.readPrimaryIndex(path, offset, length);
    }
    // Column data - use range requests
    return this.r2Provider.read(path, offset, length);
  }

  private async readMarkFile(path: string, offset: number, length: number): Promise<ArrayBuffer> {
    // Mark files are small (<1MB typically), cache entire file
    if (!this.markCache.has(path)) {
      const fullFile = await this.r2Provider.readFile(path);
      this.markCache.set(path, fullFile);
      this.evictMarkCacheIfNeeded();
    }
    return this.markCache.get(path)!.slice(offset, offset + length);
  }
}
```

### 4.2 Read-Ahead Optimization for Sequential Column Reads

The existing `R2VFS` has read-ahead, but we can optimize for MergeTree's granule access:

```typescript
interface GranuleReadAhead {
  path: string;
  currentMark: number;
  prefetchedMarks: Set<number>;
  prefetchedData: Map<number, ArrayBuffer>;
}

async readGranule(path: string, markIndex: number): Promise<ArrayBuffer> {
  // Get mark information
  const marks = await this.getMarks(path);
  const mark = marks[markIndex];
  const nextMark = marks[markIndex + 1];

  // Calculate range
  const offset = mark.compressedOffset;
  const length = nextMark
    ? Number(nextMark.compressedOffset - mark.compressedOffset)
    : undefined;  // Read to end for last granule

  // Trigger prefetch of next granules (for sequential scans)
  this.schedulePrefetch(path, markIndex + 1, PREFETCH_GRANULES);

  return this.r2Provider.read(path, offset, length || (await this.stat(path)).size - offset);
}
```

### 4.3 Write Buffering Strategy

For MergeTree part writes:

```typescript
class PartWriteBuffer {
  private files: Map<string, Uint8Array[]> = new Map();
  private sizes: Map<string, number> = new Map();
  private partPath: string;
  private maxBufferSize: number = 100 * 1024 * 1024; // 100MB max per part

  async write(filename: string, data: Uint8Array): Promise<void> {
    const buffers = this.files.get(filename) || [];
    buffers.push(data);
    this.files.set(filename, buffers);

    const currentSize = (this.sizes.get(filename) || 0) + data.length;
    this.sizes.set(filename, currentSize);

    // Check total buffer size
    const totalSize = Array.from(this.sizes.values()).reduce((a, b) => a + b, 0);
    if (totalSize > this.maxBufferSize) {
      throw new Error('Part exceeds maximum buffer size');
    }
  }

  async flush(r2Provider: R2StorageProvider): Promise<void> {
    // Write all buffered files to R2
    for (const [filename, buffers] of this.files) {
      const totalSize = buffers.reduce((sum, b) => sum + b.length, 0);
      const combined = new Uint8Array(totalSize);
      let offset = 0;
      for (const buffer of buffers) {
        combined.set(buffer, offset);
        offset += buffer.length;
      }

      const key = `${this.partPath}/${filename}`;

      if (totalSize > 5 * 1024 * 1024) {
        // Use multipart upload for large files
        await this.multipartUpload(r2Provider, key, combined);
      } else {
        await r2Provider.write(key, combined.buffer);
      }
    }
  }
}
```

### 4.4 Part File Management

```typescript
interface PartInfo {
  name: string;           // e.g., "20240115_1_1_0"
  partition: string;      // e.g., "202401"
  minBlock: number;
  maxBlock: number;
  level: number;
  rowCount: number;
  sizeBytes: number;
  state: 'temporary' | 'committed' | 'merging' | 'obsolete';
  r2Keys: string[];       // All R2 objects for this part
  createdAt: number;
}

class PartManager {
  private do: DurableObjectStub;  // MergeTree DO for metadata
  private r2: R2StorageProvider;

  async createPart(partition: string, data: PartWriteBuffer): Promise<PartInfo> {
    // Generate part name
    const { minBlock, maxBlock } = await this.do.allocateBlockRange();
    const name = `${partition}_${minBlock}_${maxBlock}_0`;
    const tempName = `tmp_${name}_${Date.now()}`;

    // Write to R2 with temp prefix
    data.partPath = `data/${partition}/${tempName}`;
    await data.flush(this.r2);

    // Register part in DO
    const part = await this.do.registerPart({
      name,
      partition,
      minBlock,
      maxBlock,
      level: 0,
      rowCount: data.rowCount,
      sizeBytes: data.totalSize,
      state: 'temporary',
      r2Keys: data.getR2Keys(),
    });

    return part;
  }

  async commitPart(partName: string): Promise<void> {
    await this.do.commitPart(partName);
    // Part is now visible for queries
  }
}
```

## 5. Caching Strategy

### 5.1 Multi-Level Cache Design

```
+--------------------+
| Query Result Cache |  <- Cloudflare Cache API
|  (full results)    |  TTL: 60s-300s
+--------------------+
         |
+--------------------+
| Primary Index Cache|  <- In-worker Map
|  (per table)       |  LRU, 50MB max
+--------------------+
         |
+--------------------+
|   Mark File Cache  |  <- In-worker Map
|  (per part)        |  LRU, 10MB max
+--------------------+
         |
+--------------------+
| Metadata Cache     |  <- R2StorageProvider built-in
|  (stat results)    |  TTL: 30s
+--------------------+
         |
+--------------------+
|   R2 Edge Cache    |  <- Automatic
|  (range responses) |  Varies
+--------------------+
```

### 5.2 Cache Key Design

```typescript
// Primary index cache keys
const primaryIndexKey = `${database}/${table}/${partition}/${partName}/primary.idx`;

// Mark file cache keys
const markFileKey = `${database}/${table}/${partition}/${partName}/${column}.mrk3`;

// Metadata cache keys
const metadataKey = `meta:${r2ObjectKey}`;
```

### 5.3 Cache Invalidation

Since MergeTree parts are immutable:
- **No invalidation needed** for part data after commit
- Invalidate on **part deletion** (merge cleanup)
- Invalidate on **table drop**

```typescript
async onPartObsolete(partName: string): Promise<void> {
  // Invalidate all caches for this part
  const partPath = `data/${partition}/${partName}/`;

  // Clear mark cache entries
  for (const key of this.markCache.keys()) {
    if (key.startsWith(partPath)) {
      this.markCache.delete(key);
    }
  }

  // Clear primary index cache
  this.primaryIndexCache.delete(`${partPath}primary.idx`);

  // Clear metadata cache
  for (const key of this.metadataCache.keys()) {
    if (key.includes(partPath)) {
      this.metadataCache.delete(key);
    }
  }
}
```

## 6. Data Flow Examples

### 6.1 SELECT Query Flow

```
Client                  Worker                  DO                     R2
  |                       |                      |                      |
  |-- SELECT * FROM t --->|                      |                      |
  |                       |-- Get active parts ->|                      |
  |                       |<-- [part1, part2] ---|                      |
  |                       |                      |                      |
  |                       |-- Get primary.idx ----------------------->|
  |                       |<-- index data ----------------------------|
  |                       |                      |                      |
  |                       | (binary search for   |                      |
  |                       |  matching granules)  |                      |
  |                       |                      |                      |
  |                       |-- Get col.mrk3 -------------------------->|
  |                       |<-- mark data -----------------------------|
  |                       |                      |                      |
  |                       |-- Range GET col.bin[offset:length] ------>|
  |                       |<-- compressed data ------------------------|
  |                       |                      |                      |
  |                       | (decompress + filter)|                      |
  |                       |                      |                      |
  |<-- Result rows -------|                      |                      |
```

### 6.2 INSERT Query Flow

```
Client                  Worker                  DO                     R2
  |                       |                      |                      |
  |-- INSERT INTO t ... ->|                      |                      |
  |                       |-- Acquire write lock>|                      |
  |                       |<-- Lock acquired ----|                      |
  |                       |                      |                      |
  |                       |-- Allocate block # ->|                      |
  |                       |<-- minBlock=5 -------|                      |
  |                       |                      |                      |
  |                       | (buffer & compress   |                      |
  |                       |  column data)        |                      |
  |                       |                      |                      |
  |                       |-- PUT tmp_part/col.bin ------------------->|
  |                       |-- PUT tmp_part/col.mrk3 ------------------>|
  |                       |-- PUT tmp_part/primary.idx --------------->|
  |                       |-- PUT tmp_part/checksums.txt ------------->|
  |                       |<-- OK ------------------------------------|
  |                       |                      |                      |
  |                       |-- Register part ---->|                      |
  |                       |<-- Part registered --|                      |
  |                       |                      |                      |
  |                       |-- Release write lock>|                      |
  |                       |<-- Lock released ----|                      |
  |                       |                      |                      |
  |<-- OK ----------------|                      |                      |
```

## 7. Implementation Plan

### Phase 1: MergeTree Read Path (Week 1-2)
- [ ] Create `MergeTreeR2StorageProvider` extending `R2StorageProvider`
- [ ] Implement mark file caching
- [ ] Implement primary index caching
- [ ] Add granule-level read-ahead for sequential scans
- [ ] Unit tests for read operations

### Phase 2: MergeTree Write Path (Week 3-4)
- [ ] Implement `PartWriteBuffer` class
- [ ] Add multipart upload support for large files
- [ ] Integrate with `MergeTreeDO` for part registration
- [ ] Implement write lock coordination
- [ ] Unit tests for write operations

### Phase 3: Cache Optimization (Week 5)
- [ ] Implement multi-level cache hierarchy
- [ ] Add cache size monitoring and eviction
- [ ] Implement cache warming on Worker startup
- [ ] Performance benchmarks

### Phase 4: Integration Testing (Week 6)
- [ ] End-to-end tests with ClickBench queries
- [ ] Test part creation and merge flows
- [ ] Test concurrent read/write scenarios
- [ ] Load testing and performance tuning

## 8. API Surface

### 8.1 MergeTreeVFS Class

```typescript
class MergeTreeVFS {
  constructor(options: {
    bucket: R2Bucket;
    metadataDO: DurableObjectNamespace;
    database: string;
    table: string;
    config?: {
      markCacheSize?: number;      // Default: 10MB
      primaryIndexCacheSize?: number; // Default: 50MB
      writeBufferSize?: number;    // Default: 100MB
      readAheadGranules?: number;  // Default: 4
    };
  });

  // VFS operations (implement VFSStorageProvider)
  async stat(path: string): Promise<FileStat | null>;
  async read(path: string, offset: number, length: number): Promise<ArrayBuffer>;
  async readFile(path: string): Promise<ArrayBuffer>;
  async write(path: string, data: ArrayBuffer): Promise<void>;
  async delete(path: string): Promise<void>;
  async list(path: string): Promise<DirEntry[]>;

  // MergeTree-specific operations
  async getActiveParts(): Promise<PartInfo[]>;
  async createPart(partition: string): Promise<PartWriteHandle>;
  async commitPart(partName: string): Promise<void>;
  async markPartObsolete(partName: string): Promise<void>;

  // Cache management
  async warmCache(parts: string[]): Promise<void>;
  clearCache(): void;
  getCacheStats(): CacheStats;
}
```

### 8.2 Integration with Existing VFSBridge

```typescript
// In mergetree-loader.ts
async function initMergeTreeReader(
  env: { DATA_BUCKET: R2Bucket; MERGETREE_DO: DurableObjectNamespace },
  database: string,
  table: string
): Promise<MergeTreeLoader> {
  // Create MergeTree-optimized VFS
  const storage = new MergeTreeVFS({
    bucket: env.DATA_BUCKET,
    metadataDO: env.MERGETREE_DO,
    database,
    table,
  });

  // Create VFS bridge with MergeTree storage
  const vfsBridge = new VFSBridge(storage);

  // Initialize MergeTree WASM module
  const loader = new MergeTreeLoader();
  await loader.init(storage);

  return loader;
}
```

## 9. Performance Considerations

### 9.1 Expected Latencies

| Operation | Cold (ms) | Warm (ms) | Notes |
|-----------|-----------|-----------|-------|
| Get active parts | 10-30 | 5-10 | DO lookup |
| Read primary index | 50-150 | <5 | Cached |
| Read mark file | 30-100 | <1 | Cached |
| Read granule | 30-100 | 10-30 | Range request |
| Write small part | 100-300 | - | Single PUT |
| Write large part | 500-2000 | - | Multipart |

### 9.2 Optimization Strategies

1. **Parallel granule fetching**: Fetch multiple granules concurrently
2. **Compression-aware reads**: Read exactly compressed size, not decompressed
3. **Part pruning**: Use MinMax indexes to skip entire parts
4. **Column pruning**: Only read columns needed for query
5. **Prefetch pipeline**: Start fetching next granules during decompression

### 9.3 Memory Budget

With 128MB Worker limit:
- WASM module: ~45MB
- Write buffer: ~50MB max (configurable)
- Mark cache: ~10MB
- Primary index cache: ~20MB
- Working memory: ~3MB safety margin

## 10. Limitations and Future Work

### Current Limitations

1. **No background merges**: Parts accumulate until explicit merge
2. **Single-writer model**: Only one Worker can write at a time
3. **No TTL support**: Parts don't auto-expire
4. **Limited transaction support**: Atomic within single part only

### Future Enhancements

1. **Scheduled merges**: Cloudflare Cron Triggers for background merges
2. **Multi-writer coordination**: Optimistic locking with DO
3. **Part replication**: Multi-region via R2 replication
4. **Compression plugins**: LZ4, ZSTD support in WASM
5. **Secondary indexes**: Skipping indexes for complex predicates

## 11. Conclusion

The existing VFS infrastructure provides a solid foundation for MergeTree on R2. The key enhancements needed are:

1. **Mark file caching** - Small files, frequently accessed, cache entire file
2. **Write buffering** - Buffer entire part in memory, single PUT to R2
3. **DO coordination** - Part registry, write locks, block allocation
4. **Granule-aware reads** - Use mark files for precise range requests

This design enables MergeTree tables up to R2's 5TB limit per object, with query performance bounded primarily by R2 range request latency (30-100ms per granule, improvable with caching and prefetching).

## 12. References

- `/src/wasm/vfs-bridge.ts` - Core VFS implementation
- `/src/r2-vfs.ts` - R2 VFS with advanced features
- `/src/storage/r2-provider.ts` - R2 storage provider
- `/src/storage/mergetree-do.ts` - MergeTree Durable Object
- `/wasm/docs/MERGETREE_VFS_DESIGN.md` - Original VFS design document
- `/docs/spikes/spike-5-r2-virtual-memory.md` - R2 virtual memory spike
