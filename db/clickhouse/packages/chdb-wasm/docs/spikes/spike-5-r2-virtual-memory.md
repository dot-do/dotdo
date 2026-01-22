# Spike 5: R2-Backed Virtual Memory for Large Datasets

## Executive Summary

This spike investigates techniques to overcome Cloudflare Workers' 128MB memory limit by leveraging R2 storage as a paging backend for WASM memory. The goal is to enable ClickHouse queries over datasets much larger than what fits in WASM linear memory.

**Conclusion**: A hybrid approach combining VFS-level paging, memory-mapped columnar access, and smart caching is feasible. Full transparent virtual memory is not practical due to WebAssembly's lack of memory protection/fault handling, but strategic paging at the data access layer can achieve similar results.

## 1. Current Memory Model Analysis

### 1.1 WebAssembly Memory Configuration

From `src/wasm/core-loader.ts`:

```typescript
// Memory configuration
const memory = new WebAssembly.Memory({
  initial: 256,     // 16MB initial (256 * 64KB pages)
  maximum: 2048,    // 128MB maximum (Workers limit)
});
```

Key constraints:
- **Initial**: 16MB - Enough for module initialization and basic queries
- **Maximum**: 128MB - Hard limit imposed by Cloudflare Workers
- **Page size**: 64KB (WebAssembly standard)
- **Growth**: Allowed, but cannot shrink

### 1.2 Memory Budget Breakdown

```
Total Available:                128MB
-------------------------------------
V8 Runtime Overhead:            ~10MB
Worker Script + Dependencies:    ~5MB
WASM Module Instance:          ~45MB  (varies by profile)
Query Working Memory:          ~50MB
Result Buffers:                ~15MB
Safety Margin:                  ~3MB
```

The actual memory available for query data is approximately 50-65MB depending on the build profile.

### 1.3 How ClickHouse Manages Memory in WASM

ClickHouse uses:
1. **Column-oriented storage**: Data stored in compressed column chunks (parts)
2. **Granule-based reading**: Reads 8192 rows at a time by default
3. **Mark files**: Index into compressed data for efficient seeking
4. **Decompression buffers**: Temporary buffers for decompressing column chunks

The existing VFS bridge (`src/wasm/vfs-bridge.ts`) provides:
- File handle management
- Position tracking
- Read/write buffering (256KB threshold)
- Path-based routing to DO/R2 storage

## 2. R2 Capabilities Analysis

### 2.1 Range Request Support

R2 fully supports HTTP Range requests:

```typescript
// From src/r2-vfs.ts
async read(handle: FileHandle, offset: number, length: number): Promise<Uint8Array> {
  const obj = await this.bucket.get(handle.path, {
    range: { offset, length },
  });
  // ...
}
```

Key capabilities:
- **Byte-level precision**: Read any byte range `[offset, offset+length)`
- **Suffix reads**: Read last N bytes: `{ suffix: N }`
- **Streaming**: Returns ReadableStream for large responses
- **Caching**: Cloudflare's edge cache can cache range responses

### 2.2 Performance Characteristics

| Operation | Latency (p50) | Latency (p99) |
|-----------|---------------|---------------|
| R2 HEAD | 5-10ms | 50ms |
| R2 GET (uncached) | 20-50ms | 150ms |
| R2 GET (cached) | 5-15ms | 50ms |
| Range request | 15-40ms | 100ms |
| Multipart chunk | 30-60ms | 200ms |

### 2.3 Limits and Quotas

| Resource | Limit |
|----------|-------|
| Object size | 5TB |
| Range size | Unlimited |
| Request body | 500MB |
| Multipart parts | 10,000 |
| Concurrent requests | No hard limit |

### 2.4 R2 Bindings Available

From `wrangler.toml`:
```toml
[[r2_buckets]]
binding = "CLICKBENCH_BUCKET"
bucket_name = "clickbench-data"

[[r2_buckets]]
binding = "DATA_BUCKET"
bucket_name = "chdb-document-data"
```

## 3. Virtual Memory Architecture Design

### 3.1 Why True Virtual Memory is Infeasible

WebAssembly lacks the primitives needed for true virtual memory:
1. **No memory protection**: Cannot mark pages as non-resident
2. **No page fault traps**: Cannot intercept invalid memory access
3. **No on-demand paging**: All memory must be pre-allocated
4. **No memory mapping**: Cannot map files directly to linear memory

### 3.2 Proposed Alternative: Column-Level Paging

Instead of transparent virtual memory, we page at the **column/granule level**:

```
                    +----------------------+
                    |   WASM Linear Memory |
                    |      (128MB max)     |
                    +----------------------+
                              |
                    +---------+---------+
                    |                   |
              +-----v-----+       +-----v-----+
              | Hot Pages |       | Cold Refs |
              | (in-mem)  |       | (metadata)|
              +-----------+       +-----------+
                    |                   |
                    |                   |
                    +--------+----------+
                             |
                    +--------v--------+
                    |   Page Manager  |
                    |  (JS/TS layer)  |
                    +-----------------+
                             |
                    +--------v--------+
                    |    R2 Storage   |
                    |  (page backing) |
                    +-----------------+
```

### 3.3 Page Size Selection

| Page Size | Pros | Cons |
|-----------|------|------|
| 4KB | Fine-grained eviction | High API overhead |
| 64KB | Matches WASM pages | Good balance |
| 1MB | Efficient R2 transfers | Coarse eviction |
| 8MB | Near-optimal for R2 | Too large for 128MB limit |

**Recommendation**: 64KB pages with 1MB read-ahead for sequential access

Rationale:
- Aligns with WASM page boundaries
- Allows ~2000 pages in maximum memory
- R2 range requests efficient at this size
- Granule size (8192 rows) typically fits in 64KB-256KB

### 3.4 Page Table Structure

```typescript
interface PageEntry {
  // Identification
  pageId: string;           // Unique page identifier
  r2Key: string;            // R2 object key (or key + offset)
  offset: number;           // Offset within R2 object

  // State
  state: 'resident' | 'evicted' | 'dirty';
  wasmOffset: number;       // Offset in WASM linear memory (if resident)

  // LRU tracking
  accessCount: number;
  lastAccess: number;

  // Metadata
  size: number;             // Actual data size (may be < page size)
  compressed: boolean;      // Whether data is compressed in R2
}

interface PageTable {
  pages: Map<string, PageEntry>;
  residentPages: Set<string>;
  totalResident: number;    // Total bytes resident
  maxResident: number;      // Configurable limit (e.g., 50MB)
}
```

### 3.5 Paging Algorithm

```typescript
async function accessPage(pageId: string): Promise<number> {
  const entry = pageTable.pages.get(pageId);

  if (!entry) {
    throw new Error(`Unknown page: ${pageId}`);
  }

  if (entry.state === 'resident') {
    // Page is in memory - update LRU and return
    entry.lastAccess = Date.now();
    entry.accessCount++;
    return entry.wasmOffset;
  }

  // Page fault - need to load from R2
  await ensureSpace(entry.size);

  // Load from R2
  const data = await r2Bucket.get(entry.r2Key, {
    range: { offset: entry.offset, length: entry.size }
  });

  if (!data) {
    throw new Error(`Page not found in R2: ${entry.r2Key}`);
  }

  // Decompress if needed
  let pageData = await data.arrayBuffer();
  if (entry.compressed) {
    pageData = await decompress(pageData);
  }

  // Allocate in WASM memory
  const wasmOffset = wasmModule._malloc(entry.size);
  wasmModule.HEAPU8.set(new Uint8Array(pageData), wasmOffset);

  // Update page table
  entry.state = 'resident';
  entry.wasmOffset = wasmOffset;
  entry.lastAccess = Date.now();
  entry.accessCount++;
  pageTable.residentPages.add(pageId);
  pageTable.totalResident += entry.size;

  return wasmOffset;
}

async function ensureSpace(needed: number): Promise<void> {
  while (pageTable.totalResident + needed > pageTable.maxResident) {
    // Find LRU page to evict
    const victim = findLRUPage();
    await evictPage(victim);
  }
}

async function evictPage(pageId: string): Promise<void> {
  const entry = pageTable.pages.get(pageId);
  if (!entry || entry.state !== 'resident') return;

  if (entry.state === 'dirty') {
    // Write back to R2
    const data = wasmModule.HEAPU8.slice(
      entry.wasmOffset,
      entry.wasmOffset + entry.size
    );
    await r2Bucket.put(entry.r2Key, data);
  }

  // Free WASM memory
  wasmModule._free(entry.wasmOffset);

  // Update page table
  entry.state = 'evicted';
  entry.wasmOffset = -1;
  pageTable.residentPages.delete(pageId);
  pageTable.totalResident -= entry.size;
}
```

## 4. Hooking into Existing VFS

### 4.1 VFS Integration Points

The existing VFS bridge (`src/wasm/vfs-bridge.ts`) provides the ideal integration point:

```typescript
// Current VFS read implementation
async vfs_read(handleId: number, bufferPtr: number, size: number): Promise<number> {
  const handle = this.fileHandles.get(handleId);
  // ... validation ...

  // This is where we hook in paging
  const data = await this.storage.read(handle.path, handle.position, bytesToRead);
  this.writeToWasm(bufferPtr, new Uint8Array(data));

  return data.byteLength;
}
```

### 4.2 Paged Storage Provider

Create a new storage provider that wraps R2 with paging:

```typescript
class PagedR2StorageProvider implements VFSStorageProvider {
  private r2: R2Bucket;
  private pageTable: PageTable;
  private cache: Map<string, ArrayBuffer>; // Hot page cache

  constructor(r2: R2Bucket, options: {
    maxResident?: number;  // Default: 50MB
    pageSize?: number;     // Default: 64KB
  }) {
    this.r2 = r2;
    this.pageTable = new PageTable(options.maxResident ?? 50 * 1024 * 1024);
  }

  async read(path: string, offset: number, length: number): Promise<ArrayBuffer> {
    const startPage = Math.floor(offset / PAGE_SIZE);
    const endPage = Math.floor((offset + length - 1) / PAGE_SIZE);

    const chunks: ArrayBuffer[] = [];

    for (let page = startPage; page <= endPage; page++) {
      const pageData = await this.getPage(path, page);

      // Calculate slice within page
      const pageStart = page * PAGE_SIZE;
      const sliceStart = Math.max(0, offset - pageStart);
      const sliceEnd = Math.min(PAGE_SIZE, offset + length - pageStart);

      chunks.push(pageData.slice(sliceStart, sliceEnd));
    }

    // Concatenate chunks
    return concatArrayBuffers(chunks);
  }

  private async getPage(path: string, pageNum: number): Promise<ArrayBuffer> {
    const pageId = `${path}:${pageNum}`;

    // Check cache
    if (this.cache.has(pageId)) {
      return this.cache.get(pageId)!;
    }

    // Load from R2 with paging logic
    const entry = await this.loadPage(pageId, path, pageNum);
    return this.getPageData(entry);
  }
}
```

### 4.3 Integration with MergeTree VFS

The existing `vfs-bridge.ts` design can be extended:

```typescript
// Modified VFSBridge constructor
class VFSBridge {
  constructor(storage: VFSStorageProvider) {
    // Enable paging for read-heavy workloads
    if (storage instanceof R2StorageProvider) {
      this.storage = new PagedR2StorageProvider(storage.getBucket(), {
        maxResident: 50 * 1024 * 1024, // 50MB paging window
        pageSize: 65536,               // 64KB pages
      });
    } else {
      this.storage = storage;
    }
  }
}
```

## 5. Caching Strategy

### 5.1 Multi-Level Cache Design

```
                    +-----------------+
                    |   Query Cache   |   (Cloudflare Cache API)
                    |   (full results)|   TTL: 5 minutes
                    +-----------------+
                            |
                    +-----------------+
                    |   Page Cache    |   (In-Worker Map)
                    |   (64KB pages)  |   LRU, ~10MB
                    +-----------------+
                            |
                    +-----------------+
                    |  R2 Edge Cache  |   (Automatic)
                    |  (range reqs)   |   TTL: varies
                    +-----------------+
                            |
                    +-----------------+
                    |   R2 Storage    |   (Origin)
                    +-----------------+
```

### 5.2 Cache Coherency

For read-only analytical queries, cache coherency is simple:
- Pages are immutable once written
- Part names include version info (e.g., `20240115_1_1_0`)
- Metadata from DO indicates active parts
- Invalidate on part supersession (merge)

For writable tables:
- Dirty pages tracked in page table
- Write-through or write-back policy
- Sync on file close (vfs_close)
- DO provides write coordination

### 5.3 Prefetching Strategy

```typescript
class PrefetchingPageManager {
  private prefetchQueue: string[] = [];
  private readonly PREFETCH_AHEAD = 4; // Pages

  async accessPage(pageId: string): Promise<number> {
    // Trigger prefetch of next pages
    this.schedulePrefetch(pageId);

    return super.accessPage(pageId);
  }

  private schedulePrefetch(currentPageId: string): void {
    const [path, pageNumStr] = currentPageId.split(':');
    const pageNum = parseInt(pageNumStr);

    // Sequential access detection
    for (let i = 1; i <= this.PREFETCH_AHEAD; i++) {
      const nextPageId = `${path}:${pageNum + i}`;
      if (!this.pageTable.pages.has(nextPageId)) continue;
      if (this.pageTable.pages.get(nextPageId)!.state === 'resident') continue;

      // Add to prefetch queue (non-blocking)
      this.prefetchInBackground(nextPageId);
    }
  }

  private prefetchInBackground(pageId: string): void {
    // Use waitUntil() if available for background work
    ctx.waitUntil(this.loadPage(pageId).catch(() => {}));
  }
}
```

## 6. Performance Considerations

### 6.1 Latency Analysis

Assuming 64KB pages and typical R2 latencies:

| Operation | Cold (ms) | Warm (ms) |
|-----------|-----------|-----------|
| Page fault (R2 fetch) | 30-50 | 10-20 |
| Page eviction | 0-5 | 0-5 |
| LRU lookup | <1 | <1 |
| WASM memory copy | <1 | <1 |

**Sequential scan of 1GB file**:
- Total pages: ~16,000
- With prefetching: ~20ms * 16,000 = 320 seconds (5.3 minutes)
- With batching (1MB reads): ~40ms * 1,000 = 40 seconds
- **Conclusion**: Batch reads at 1MB+ for sequential access

### 6.2 Memory Efficiency

With 50MB paging window and 64KB pages:
- Maximum resident pages: ~780
- Typical working set for analytics: 10-100 pages
- Typical working set for point queries: 5-20 pages

### 6.3 Optimization Techniques

1. **Column pruning**: Only load columns needed for query
2. **Predicate pushdown**: Use primary index to skip parts
3. **Granule skipping**: Use mark files to skip unneeded granules
4. **Compression**: Keep data compressed until accessed
5. **Parallel prefetch**: Load multiple pages concurrently

## 7. Implementation Approach

### Phase 1: Page Manager (Week 1)
- Implement PageTable class
- LRU eviction algorithm
- Basic page load/evict operations
- Unit tests

### Phase 2: Storage Provider (Week 2)
- PagedR2StorageProvider implementation
- Integration with VFSBridge
- Range request optimization
- Integration tests

### Phase 3: Prefetching (Week 3)
- Sequential access detection
- Background prefetch queue
- Adaptive prefetch window
- Performance benchmarks

### Phase 4: Cache Hierarchy (Week 4)
- Multi-level cache implementation
- Cloudflare Cache API integration
- Cache coherency for writes
- E2E testing

## 8. Key Challenges

### 8.1 Synchronous WASM Calls

ClickHouse's file I/O is synchronous, but R2 is async:

**Solution**: Use Emscripten's `EM_ASYNC_JS` with JSPI (JavaScript Promise Integration):
```cpp
EM_ASYNC_JS(int64_t, js_vfs_read, (int32_t handle, void* buffer, size_t size), {
    return await vfsBridge.vfs_read(handle, buffer, size);
});
```

### 8.2 Memory Fragmentation

Long-running queries may fragment WASM memory:

**Mitigation**:
- Fixed-size page allocations
- Periodic compaction during idle
- Reserve contiguous region for hot pages

### 8.3 Cold Start

First query must:
1. Initialize WASM module
2. Load initial pages
3. Build page table from R2 listing

**Optimization**:
- Pre-warm with common queries
- Cache page table metadata
- Use smaller initial page set

### 8.4 Write Amplification

Small random writes cause full page loads/stores:

**Mitigation**:
- Buffer writes at VFS level (current design)
- Batch writes before flush
- Use append-only for MergeTree parts

## 9. Alternative Approaches Considered

### 9.1 Memory-Mapped Files via SharedArrayBuffer

SharedArrayBuffer could enable:
- Multiple Workers sharing memory
- External process managing paging

**Rejected because**:
- SharedArrayBuffer requires cross-origin isolation
- Cloudflare Workers don't support SharedArrayBuffer
- Would require significant architecture changes

### 9.2 Stream Processing

Process data in streaming fashion without loading all in memory:

**Partially adopted**:
- Good for simple aggregations
- R2VFS supports ReadableStream
- Harder for complex queries (JOINs, window functions)

### 9.3 Query Splitting

Split large queries across multiple Worker invocations:

**Complementary approach**:
- Map-reduce style execution
- Each Worker processes subset of parts
- Final Worker aggregates results
- Works well with paging

## 10. Conclusion and Recommendations

### Feasibility Assessment

| Aspect | Feasibility | Notes |
|--------|-------------|-------|
| Basic paging | High | Can be built on existing VFS |
| Hot page cache | High | In-memory LRU straightforward |
| Sequential prefetch | High | Clear patterns to exploit |
| Random access | Medium | Performance may suffer |
| Write-back | Medium | Requires careful coordination |
| True VM transparency | Low | WebAssembly limitations |

### Recommended Implementation

1. **Start with read-only paging** for ClickBench-style analytics
2. **Use 64KB pages** with 1MB prefetch for sequential access
3. **Integrate at VFSStorageProvider level** for clean abstraction
4. **Add write-back paging later** for MergeTree persistence

### Expected Results

With the proposed architecture:
- **Dataset size**: 10GB+ queryable (vs 50MB current)
- **Query latency**: 50-500ms for cached, 5-30s for cold
- **Memory usage**: 50MB working set + 30MB for WASM
- **Complexity**: Moderate - builds on existing VFS

### Next Steps

1. Create `PageManager` class with LRU eviction
2. Implement `PagedR2StorageProvider`
3. Add prefetching for sequential access
4. Benchmark with ClickBench queries
5. Iterate based on performance data
