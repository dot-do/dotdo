---
title: "Wikipedia-Scale Vector Search: Distributed Systems Analysis"
description: Documentation for research
---

# Wikipedia-Scale Vector Search: Distributed Systems Analysis

A comprehensive distributed systems design for vector similarity search at Wikipedia scale (500M+ embeddings) using R2 storage, Parquet/Iceberg, and Cloudflare Workers.

## Executive Summary

| Metric | Target | Design Achieves |
|--------|--------|-----------------|
| Total Embeddings | 500M+ | Yes, via LSH sharding |
| Query Latency | <200ms p99 | ~150ms p95 with warm cache |
| Recall@100 | 95%+ | 96-98% via multi-probe LSH |
| Cost vs Pinecone | 10-20x cheaper | ~$500/mo vs $5-10K/mo |
| Memory per Worker | <128MB | ~80MB per shard DO |

**Key Insight**: By combining Locality-Sensitive Hashing (LSH) with Iceberg's partition pruning, we can achieve sub-200ms queries without loading all vectors into memory.

---

## 1. Scale Analysis

### 1.1 Wikipedia-Scale Numbers

```
Wikipedia Corpus:
- ~6.7M English articles
- Average ~50 chunks per article = 335M chunks
- With multilingual + multimedia = 500M+ embeddings

Per-Embedding Storage:
- 1536 dimensions (OpenAI text-embedding-3-large)
- 4 bytes per float = 6,144 bytes raw
- With ZSTD compression (~40%) = ~2,500 bytes
- Plus metadata (id, namespace, timestamps) = ~200 bytes
- Total: ~2.7 KB per embedding

Total Storage:
- 500M * 2.7KB = 1.35 TB compressed
- Raw vectors: 500M * 6KB = 3 TB
```

### 1.2 Cloudflare Constraints

| Resource | Limit | Impact |
|----------|-------|--------|
| Worker memory | 128 MB | Max ~20K 1536d vectors per isolate |
| DO storage | 10 GB | Max ~3.7M embeddings per DO |
| Subrequests | 1,000/request | Limits fan-out parallelism |
| R2 GET latency | 20-50ms | Dominates search time |
| CPU time | 30 seconds | Allows ~10M distance computations |

### 1.3 Memory Budget Analysis

```
Per VectorShardDO (128MB limit):
- WASM overhead: ~8 MB
- Runtime/V8: ~20 MB
- Available for vectors: ~100 MB

At 1536 dimensions:
- Per vector: 1536 * 4 = 6,144 bytes
- ID + index overhead: ~100 bytes
- Total per vector: ~6.3 KB

Max vectors per DO: 100MB / 6.3KB = ~15,800 vectors
With safety margin: ~12,000 vectors per shard
```

---

## 2. Sharding Strategy: Multi-Level LSH

### 2.1 Locality-Sensitive Hashing Overview

LSH projects high-dimensional vectors into hash buckets such that similar vectors have high probability of landing in the same bucket.

```
For cosine similarity, use Random Hyperplane LSH:
1. Generate K random hyperplanes in 1536-dimensional space
2. For each vector v, compute sign(v · h_i) for each hyperplane h_i
3. Concatenate signs to form K-bit hash
4. Vectors with same hash are "probably similar"
```

**Key Properties**:
- P(same bucket | similarity > 0.9) > 0.8
- P(same bucket | similarity < 0.5) < 0.2
- Tunable via number of hyperplanes and bands

### 2.2 Two-Level Sharding Design

```
Level 1: Coarse Sharding (LSH Bands)
- 256 "super-shards" based on LSH band signatures
- Each super-shard stored as separate Parquet file(s) in R2
- Files organized by Iceberg partitioning

Level 2: Fine Sharding (DO-level)
- Each super-shard split across 4-8 VectorShardDOs
- ~2M vectors per super-shard = ~150K-500K per DO
- DOs load vectors on-demand from R2
```

**Concrete Numbers for 500M Vectors**:

```
Super-Shard Distribution:
- 256 super-shards
- ~2M vectors per super-shard (average)
- ~500 Parquet files per super-shard (~4K vectors/file)
- Total: ~128,000 Parquet files

DO Distribution:
- 256 * 8 = 2,048 VectorShardDOs
- ~244K vectors per DO
- ~20 partitions per DO (loaded on demand)
```

### 2.3 LSH Configuration

```typescript
interface LSHConfig {
  // Number of hash functions per band
  hashesPerBand: 8

  // Number of bands (determines recall vs speed tradeoff)
  bands: 32

  // Total bits: 8 * 32 = 256 bits per vector

  // Multi-probe: check neighboring buckets
  probeExpansion: 4  // Check 4 nearby buckets

  // Expected recall with these settings: ~96-98%
}
```

**Why This Configuration**:
- 8 hashes per band: P(match within band | sim > 0.85) ~ 0.35
- 32 bands: P(match in any band | sim > 0.85) ~ 0.9999
- Multi-probe adds 4 neighboring buckets: catches near-boundary vectors
- Total candidates per query: ~16 super-shards (6.25% of index)

---

## 3. Durable Object Hierarchy

### 3.1 Three-Tier Architecture

```
                    ┌─────────────────────────────┐
                    │     VectorCoordinatorDO     │
                    │     (Global Singleton)      │
                    │  - Routing table            │
                    │  - LSH hyperplanes          │
                    │  - Shard health tracking    │
                    └──────────────┬──────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
              ▼                    ▼                    ▼
   ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
   │ RegionLeaderDO  │  │ RegionLeaderDO  │  │ RegionLeaderDO  │
   │  (us-east)      │  │  (eu-west)      │  │  (ap-northeast) │
   │ - Local cache   │  │ - Local cache   │  │ - Local cache   │
   │ - Aggregation   │  │ - Aggregation   │  │ - Aggregation   │
   └────────┬────────┘  └────────┬────────┘  └────────┬────────┘
            │                    │                    │
      ┌─────┴─────┐        ┌─────┴─────┐        ┌─────┴─────┐
      │           │        │           │        │           │
      ▼           ▼        ▼           ▼        ▼           ▼
  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
  │Shard   │ │Shard   │ │Shard   │ │Shard   │ │Shard   │ │Shard   │
  │DO 0-7  │ │DO 8-15 │ │DO 0-7  │ │DO 8-15 │ │DO 0-7  │ │DO 8-15 │
  │(256 ea)│ │(256 ea)│ │(256 ea)│ │(256 ea)│ │(256 ea)│ │(256 ea)│
  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘ └────────┘
```

### 3.2 VectorCoordinatorDO

**Responsibilities**:
- Maintain LSH hyperplane matrix (12KB for 32 hyperplanes)
- Route queries to appropriate super-shards
- Track shard health and load metrics
- Handle index rebuilds and rebalancing

```typescript
class VectorCoordinatorDO extends DurableObject {
  // LSH hyperplanes: 32 bands * 8 hashes * 1536 dims * 4 bytes = 1.5MB
  private hyperplanes: Float32Array

  // Routing table: super-shard -> [DO IDs]
  private routingTable: Map<number, string[]>

  // Health metrics per shard
  private shardHealth: Map<string, ShardHealth>

  async computeLSHBuckets(query: Float32Array): Promise<number[]> {
    const buckets: number[] = []

    for (let band = 0; band < 32; band++) {
      let hash = 0
      for (let h = 0; h < 8; h++) {
        const planeIdx = band * 8 + h
        const plane = this.hyperplanes.subarray(
          planeIdx * 1536,
          (planeIdx + 1) * 1536
        )
        const dot = this.dotProduct(query, plane)
        hash |= (dot > 0 ? 1 : 0) << h
      }
      buckets.push(band * 256 + hash)
    }

    return this.expandWithProbes(buckets)
  }

  async routeQuery(buckets: number[]): Promise<string[]> {
    const doIds = new Set<string>()
    for (const bucket of buckets) {
      const superShard = bucket % 256
      const shardDOs = this.routingTable.get(superShard) || []
      shardDOs.forEach(id => doIds.add(id))
    }
    return Array.from(doIds)
  }
}
```

### 3.3 RegionLeaderDO

**Responsibilities**:
- Aggregate results from local shards
- Cache hot query results (1-minute TTL)
- Handle partial failures gracefully
- Load balance across local shard DOs

```typescript
class RegionLeaderDO extends DurableObject {
  private resultCache: LRUCache<string, SearchResult[]>
  private localShards: Map<number, DurableObjectStub>

  async search(
    query: Float32Array,
    buckets: number[],
    k: number
  ): Promise<SearchResult[]> {
    // Check cache first
    const cacheKey = this.hashQuery(query, buckets)
    const cached = this.resultCache.get(cacheKey)
    if (cached) return cached

    // Fan out to local shards
    const relevantShards = buckets
      .map(b => b % 256)
      .filter((v, i, a) => a.indexOf(v) === i)
      .flatMap(s => this.localShards.get(s) || [])

    // Parallel search with streaming aggregation
    const results = await this.scatterGatherSearch(
      relevantShards,
      query,
      k,
      { timeout: 150, minShards: Math.ceil(relevantShards.length * 0.8) }
    )

    // Cache and return
    this.resultCache.set(cacheKey, results)
    return results
  }
}
```

### 3.4 VectorShardDO (Enhanced)

Building on existing `VectorShardDO`, add:
- Lazy loading from R2/Parquet
- LSH bucket membership
- Bloom filter for fast negative lookups

```typescript
class VectorShardDO extends DurableObject {
  private vectors: Float32Array | null = null
  private loaded: boolean = false
  private lshBuckets: Set<number>  // Which LSH buckets this shard covers
  private bloomFilter: BloomFilter  // Fast "definitely not here" check

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return

    // Load from R2 Parquet files
    const manifest = await this.ctx.storage.get('manifest')
    const files = manifest.parquetFiles as string[]

    let totalVectors = 0
    for (const file of files) {
      const data = await this.loadParquetVectors(file)
      // Append to vectors array
      totalVectors += data.count
    }

    this.loaded = true
  }

  async searchWithBuckets(
    query: Float32Array,
    buckets: number[],
    k: number
  ): Promise<SearchResult[]> {
    // Fast path: check if any of query's buckets match this shard
    const matches = buckets.some(b => this.lshBuckets.has(b))
    if (!matches) {
      return []  // Early termination
    }

    await this.ensureLoaded()
    return this.search(query, k, 'cosine')
  }
}
```

---

## 4. Scatter-Gather Protocol

### 4.1 Query Flow

```
┌─────────┐      1. Query      ┌──────────────────┐
│  Client │ ────────────────▶  │    Worker        │
└─────────┘                    └────────┬─────────┘
                                        │
                    2. Compute LSH buckets, route
                                        │
                                        ▼
                               ┌──────────────────┐
                               │  CoordinatorDO   │
                               │  (LSH routing)   │
                               └────────┬─────────┘
                                        │
                    3. Parallel dispatch to regions
                    ┌───────────────────┼───────────────────┐
                    │                   │                   │
                    ▼                   ▼                   ▼
            ┌───────────────┐   ┌───────────────┐   ┌───────────────┐
            │ RegionLeader  │   │ RegionLeader  │   │ RegionLeader  │
            │   (us-east)   │   │   (eu-west)   │   │ (ap-northeast)│
            └───────┬───────┘   └───────┬───────┘   └───────┬───────┘
                    │                   │                   │
    4. Local scatter-gather to shards   │                   │
        ┌───────────┼───────────┐       │                   │
        ▼           ▼           ▼       ▼                   ▼
    ┌───────┐   ┌───────┐   ┌───────┐   ...                 ...
    │Shard 0│   │Shard 1│   │Shard 2│
    └───┬───┘   └───┬───┘   └───┬───┘
        │           │           │
        └───────────┼───────────┘
                    │
    5. Merge results (streaming min-heap)
                    │
                    ▼
            ┌───────────────┐
            │ Top-K Results │
            └───────────────┘
```

### 4.2 Streaming Aggregation

```typescript
interface AggregationState {
  heap: MinHeap<SearchResult>
  shardsResponded: number
  shardsTotal: number
  deadline: number
  minResultsReceived: number
}

async function scatterGatherSearch(
  shards: DurableObjectStub[],
  query: Float32Array,
  k: number,
  options: { timeout: number; minShards: number }
): Promise<SearchResult[]> {
  const state: AggregationState = {
    heap: new MinHeap(k),
    shardsResponded: 0,
    shardsTotal: shards.length,
    deadline: Date.now() + options.timeout,
    minResultsReceived: 0
  }

  // Create abort controller for timeout
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), options.timeout)

  // Stream results as they arrive
  const promises = shards.map(async (shard, idx) => {
    try {
      const results = await shard.search(query, k, { signal: controller.signal })

      // Merge into heap as results arrive
      for (const result of results) {
        if (state.heap.size() < k || result.score > state.heap.peek().score) {
          state.heap.pushPop(result)
        }
      }

      state.shardsResponded++
      state.minResultsReceived = Math.min(
        state.minResultsReceived + results.length,
        k
      )

      // Early termination if we have enough high-quality results
      if (state.shardsResponded >= options.minShards &&
          state.minResultsReceived >= k) {
        controller.abort()
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.warn(`Shard ${idx} failed:`, err)
      }
    }
  })

  // Wait for minimum shards or timeout
  await Promise.race([
    Promise.allSettled(promises),
    new Promise(r => setTimeout(r, options.timeout))
  ])

  clearTimeout(timeoutId)
  return state.heap.toSortedArray()
}
```

### 4.3 Partial Result Handling

```typescript
interface PartialResultPolicy {
  // Minimum fraction of shards that must respond
  minShardCoverage: 0.7

  // Minimum results before early termination allowed
  minResultsForEarlyTermination: 50

  // How to handle missing shards
  missingShardBehavior: 'warn' | 'retry' | 'fail'

  // Confidence score adjustment for partial results
  adjustConfidence: (coverage: number) => number
}

function computeResultConfidence(
  shardsResponded: number,
  shardsTotal: number,
  policy: PartialResultPolicy
): { confidence: number; shouldRetry: boolean } {
  const coverage = shardsResponded / shardsTotal

  if (coverage < policy.minShardCoverage) {
    return {
      confidence: 0,
      shouldRetry: policy.missingShardBehavior === 'retry'
    }
  }

  return {
    confidence: policy.adjustConfidence(coverage),
    shouldRetry: false
  }
}
```

---

## 5. Parquet/Iceberg Integration

### 5.1 File Organization

```
r2://vectors/
├── metadata/
│   ├── v1.metadata.json          # Iceberg metadata
│   └── snap-*.avro               # Manifests
├── data/
│   ├── super-shard-000/
│   │   ├── part-000-*.parquet    # ~4K vectors each
│   │   ├── part-001-*.parquet
│   │   └── ...
│   ├── super-shard-001/
│   │   └── ...
│   └── super-shard-255/
│       └── ...
└── lsh/
    ├── hyperplanes.bin           # LSH hyperplane matrix
    └── bucket-mapping.json       # Vector ID -> bucket mapping
```

### 5.2 Parquet Schema for Vectors

```typescript
const vectorParquetSchema = {
  fields: [
    { name: 'id', type: 'string', required: true },
    { name: 'ns', type: 'string', required: true },
    { name: 'embedding', type: 'fixed_size_list',
      elementType: 'float32', size: 1536 },
    { name: 'lsh_bucket', type: 'int32' },
    { name: 'metadata', type: 'binary' },  // JSON blob
    { name: 'created_at', type: 'timestamp_ms' },
  ],

  // Iceberg partitioning
  partitionSpec: {
    fields: [
      { sourceField: 'ns', transform: 'identity' },
      { sourceField: 'lsh_bucket', transform: 'truncate[8]' }  // Super-shard
    ]
  },

  // Column statistics for pruning
  columnStats: ['id', 'lsh_bucket', 'ns']
}
```

### 5.3 Loading Vectors from Parquet

```typescript
async function loadVectorsFromParquet(
  r2: R2Bucket,
  manifestPath: string,
  lshBuckets: number[]
): Promise<{ ids: string[], vectors: Float32Array }> {
  // 1. Load Iceberg manifest
  const manifest = await loadIcebergManifest(r2, manifestPath)

  // 2. Prune files by LSH bucket partition
  const relevantFiles = manifest.dataFiles.filter(file =>
    lshBuckets.some(bucket =>
      file.partitionValues.lsh_bucket >= bucket - 1 &&
      file.partitionValues.lsh_bucket <= bucket + 1
    )
  )

  // 3. Load Parquet files in parallel (up to 10 concurrent)
  const chunks = await Promise.all(
    relevantFiles.slice(0, 10).map(file => loadParquetChunk(r2, file.path))
  )

  // 4. Concatenate into single arrays
  const totalVectors = chunks.reduce((sum, c) => sum + c.count, 0)
  const ids: string[] = []
  const vectors = new Float32Array(totalVectors * 1536)

  let offset = 0
  for (const chunk of chunks) {
    ids.push(...chunk.ids)
    vectors.set(chunk.vectors, offset)
    offset += chunk.vectors.length
  }

  return { ids, vectors }
}
```

---

## 6. Failure Handling

### 6.1 Failure Modes

| Failure | Detection | Mitigation |
|---------|-----------|------------|
| Shard DO unavailable | Timeout (100ms) | Route to replica, return partial |
| R2 read failure | Error response | Retry with backoff, fallback to stale |
| Coordinator unavailable | Connection refused | Use cached routing table |
| LSH mismatch | No results | Multi-probe expansion |
| Memory pressure | OOM kill | Smaller batches, eviction |

### 6.2 Redundancy Strategy

```
Each super-shard replicated 3x:
- Primary: Same region as coordinator
- Replica 1: Different AZ in same region
- Replica 2: Different region

Read path:
1. Try primary
2. On timeout/error, try replica 1
3. On timeout/error, try replica 2
4. Return partial results with confidence score

Write path:
1. Write to primary synchronously
2. Queue async replication to replicas
3. Background consistency checker
```

### 6.3 Circuit Breaker

```typescript
class ShardCircuitBreaker {
  private failures: Map<string, number> = new Map()
  private lastFailure: Map<string, number> = new Map()

  readonly threshold = 5
  readonly resetTimeout = 30_000  // 30 seconds

  async callShard<T>(
    shardId: string,
    fn: () => Promise<T>
  ): Promise<T | null> {
    if (this.isOpen(shardId)) {
      return null  // Skip this shard
    }

    try {
      const result = await fn()
      this.recordSuccess(shardId)
      return result
    } catch (err) {
      this.recordFailure(shardId)
      throw err
    }
  }

  private isOpen(shardId: string): boolean {
    const failures = this.failures.get(shardId) || 0
    const lastFailure = this.lastFailure.get(shardId) || 0

    if (failures >= this.threshold) {
      // Check if reset timeout has passed
      if (Date.now() - lastFailure > this.resetTimeout) {
        this.failures.set(shardId, 0)
        return false
      }
      return true
    }
    return false
  }
}
```

---

## 7. Load Balancing

### 7.1 Hot Cluster Detection

Some LSH buckets will be "hotter" than others (common query patterns):

```typescript
interface BucketMetrics {
  bucketId: number
  queryCount: number    // Last 5 minutes
  avgLatency: number
  p99Latency: number
  errorRate: number
}

class HotClusterManager {
  private metrics: Map<number, BucketMetrics> = new Map()

  async rebalanceIfNeeded(): Promise<void> {
    const hotBuckets = this.findHotBuckets()

    for (const bucket of hotBuckets) {
      if (this.shouldSplit(bucket)) {
        await this.splitBucket(bucket)
      }
    }
  }

  private shouldSplit(metrics: BucketMetrics): boolean {
    return metrics.queryCount > 10_000 &&  // High QPS
           metrics.p99Latency > 100 &&     // Latency degradation
           metrics.errorRate < 0.01        // Not a failure issue
  }

  private async splitBucket(metrics: BucketMetrics): Promise<void> {
    // Create additional shard DOs for this bucket
    // Update routing table
    // Migrate subset of vectors
  }
}
```

### 7.2 Query-Aware Routing

```typescript
async function routeWithLoadBalancing(
  buckets: number[],
  coordinator: VectorCoordinatorDO
): Promise<Map<string, number[]>> {
  const routing = new Map<string, number[]>()  // DO ID -> buckets

  for (const bucket of buckets) {
    const candidates = coordinator.getShardCandidates(bucket)

    // Score candidates by:
    // 1. Recent latency
    // 2. Current queue depth
    // 3. Geographic proximity
    const scored = candidates.map(c => ({
      id: c.id,
      score: this.scoreCandidate(c)
    }))

    // Pick best candidate
    const best = scored.sort((a, b) => b.score - a.score)[0]

    if (!routing.has(best.id)) {
      routing.set(best.id, [])
    }
    routing.get(best.id)!.push(bucket)
  }

  return routing
}
```

---

## 8. Incremental Updates

### 8.1 Write Path

```
New Vector Insertion:
1. Compute LSH hash -> super-shard
2. Write to TransactionDO buffer (WAL)
3. When buffer reaches threshold (1000 vectors):
   a. Generate new Parquet file
   b. Upload to R2
   c. Update Iceberg manifest
   d. Notify affected shard DOs

Shard DO Update:
1. Receive notification of new Parquet file
2. On next query, lazy-load new file
3. Merge into in-memory index
```

### 8.2 Avoiding Full Rebuild

```typescript
class IncrementalIndexManager {
  // Maintain "delta" files for recent additions
  private deltaFiles: Map<number, string[]> = new Map()  // bucket -> paths

  // Background compaction
  private compactionQueue: CompactionJob[] = []

  async addVectors(vectors: VectorBatch): Promise<void> {
    // 1. Compute LSH buckets for each vector
    const bucketAssignments = vectors.map(v => ({
      vector: v,
      bucket: this.computeLSHBucket(v.embedding)
    }))

    // 2. Group by bucket
    const byBucket = groupBy(bucketAssignments, 'bucket')

    // 3. Write delta files (one per bucket)
    for (const [bucket, vectors] of byBucket) {
      const deltaPath = await this.writeDeltaFile(bucket, vectors)
      this.deltaFiles.get(bucket)?.push(deltaPath)

      // 4. Trigger compaction if too many deltas
      if ((this.deltaFiles.get(bucket)?.length || 0) > 10) {
        this.scheduleCompaction(bucket)
      }
    }

    // 5. Notify shard DOs
    await this.notifyShards(bucketAssignments)
  }

  async compactBucket(bucket: number): Promise<void> {
    const deltas = this.deltaFiles.get(bucket) || []
    const baseFiles = await this.getBaseFiles(bucket)

    // Merge all files into new compacted file
    const vectors = await this.loadAllVectors([...baseFiles, ...deltas])
    const compactedPath = await this.writeCompactedFile(bucket, vectors)

    // Update Iceberg manifest atomically
    await this.updateManifest(bucket, compactedPath, [...baseFiles, ...deltas])

    // Clean up old files
    await this.deleteOldFiles([...baseFiles, ...deltas])
  }
}
```

---

## 9. Latency Analysis

### 9.1 Query Path Breakdown

```
Step                          Time (ms)    Notes
────────────────────────────────────────────────────
Worker invocation             5-10         Cold: 50-100ms
LSH bucket computation        1-2          32 bands * 8 hashes
Coordinator routing           5-10         DO roundtrip
Region leader dispatch        10-20        Parallel to 3 regions
Shard search (parallel)       50-80        Bottleneck
R2 reads (if cold)            20-40        Per Parquet file
Distance computation          10-30        ~100K vectors
Heap aggregation              5-10         Streaming merge
Response serialization        2-5
────────────────────────────────────────────────────
Total (warm cache)            80-150ms     Target: <200ms
Total (cold start)            150-300ms    First query to region
```

### 9.2 Optimization Opportunities

| Optimization | Latency Saved | Complexity |
|--------------|---------------|------------|
| Warm DO instances | 20-50ms | Low |
| Pre-computed routing | 10-15ms | Low |
| SIMD distance (WASM) | 20-40ms | Medium |
| Result caching | 50-100ms | Low |
| Speculative prefetch | 10-30ms | Medium |
| Geo-routing | 30-50ms | High |

### 9.3 Caching Strategy

```typescript
interface CacheLayer {
  // L1: Worker-level (per request)
  workerCache: Map<string, SearchResult[]>  // queryHash -> results
  ttl: 100  // Very short, handles retry storms

  // L2: Region Leader DO
  regionCache: LRUCache<string, SearchResult[]>
  capacity: 10_000  // ~10K recent queries
  ttl: 60_000  // 1 minute

  // L3: R2 (pre-computed hot queries)
  r2Cache: {
    prefix: 'cache/hot-queries/'
    ttl: 3600  // 1 hour
  }
}
```

---

## 10. Cost Analysis

### 10.1 R2 Costs

```
Storage:
- 1.35 TB compressed = $19.58/month

Operations (500K queries/day):
- Class A (writes): ~1M/day * 30 = 30M = $135/month
- Class B (reads): ~5M/day * 30 = 150M = $54/month

Egress:
- Internal (Workers <-> R2): Free
- External: Depends on usage pattern

Total R2: ~$210/month
```

### 10.2 Workers/DO Costs

```
Durable Objects:
- Requests: ~500K queries * 30 days = 15M
- Duration: ~150ms avg = 2.25M GB-seconds
- Cost: ~$12/month

Workers:
- Requests: ~15M
- Duration: ~50ms avg = 750K GB-seconds
- Cost: ~$3/month

Total Compute: ~$15/month
```

### 10.3 Total Cost Comparison

| Solution | Monthly Cost | Notes |
|----------|--------------|-------|
| This Design | ~$225/mo | R2 + Workers + DO |
| Pinecone (500M) | $2,500-5,000/mo | p2 or s1 pods |
| Weaviate Cloud | $1,500-3,000/mo | Estimated |
| Milvus (self-hosted) | $800-1,500/mo | Compute + storage |

**10-20x cost reduction vs managed vector DBs**

---

## 11. Implementation Roadmap

### Phase 1: Foundation (Weeks 1-2)
- [ ] Implement LSH hash function
- [ ] Extend VectorShardDO with lazy loading
- [ ] Create VectorCoordinatorDO skeleton
- [ ] Basic scatter-gather search

### Phase 2: Sharding (Weeks 3-4)
- [ ] Parquet file generation with LSH partitions
- [ ] Iceberg manifest integration
- [ ] Multi-probe LSH implementation
- [ ] Shard distribution algorithms

### Phase 3: Reliability (Weeks 5-6)
- [ ] Circuit breaker pattern
- [ ] Partial result handling
- [ ] Health checking
- [ ] Replica management

### Phase 4: Performance (Weeks 7-8)
- [ ] Result caching layers
- [ ] WASM-accelerated distance computation
- [ ] Hot cluster detection
- [ ] Geographic routing

### Phase 5: Operations (Weeks 9-10)
- [ ] Incremental index updates
- [ ] Background compaction
- [ ] Monitoring dashboards
- [ ] Alerting rules

---

## 12. Key Design Decisions

### Why LSH over HNSW?

| Factor | LSH | HNSW |
|--------|-----|------|
| Memory per vector | ~0 (disk-based) | ~100-200 bytes |
| Index build time | O(n) | O(n log n) |
| Query time | O(n/k) | O(log n) |
| Update cost | O(1) | O(log n) |
| Parallelizable | Yes | Limited |
| Disk-friendly | Yes | No |

**Verdict**: At Wikipedia scale, HNSW would require 100+ GB RAM. LSH enables disk-based index with similar recall.

### Why Not Cloudflare Vectorize?

- Currently limited to 5M vectors per index
- No control over sharding strategy
- Higher cost at scale ($25/month per 1M vectors = $12,500/mo for 500M)
- Less flexibility for custom similarity metrics

### Why Iceberg for Vector Storage?

- Schema evolution (add metadata fields without rewriting)
- Time travel (rollback bad index updates)
- Partition pruning (skip irrelevant files)
- Statistics (min/max per column for filtering)
- Industry standard (tooling ecosystem)

---

## References

1. [Locality-Sensitive Hashing (Indyk & Motwani, 1998)](https://www.cs.princeton.edu/courses/archive/spr05/cos598E/bib/p518-gionis.pdf)
2. [Multi-Probe LSH (Lv et al., 2007)](https://www.cs.princeton.edu/cass/papers/mplsh_vldb07.pdf)
3. [Apache Iceberg Table Spec](https://iceberg.apache.org/spec/)
4. [Cloudflare Durable Objects Documentation](https://developers.cloudflare.com/durable-objects/)
5. [parquet-wasm Research](./parquet-wasm-iceberg.md)
6. [dotdo VectorShardDO](/objects/VectorShardDO.ts)
7. [dotdo ShardRouter](/db/core/shard.ts)
