---
title: "Bypassing Cloudflare Workers Subrequest Limits for Distributed Vector Search"
description: Documentation for plans
---

# Bypassing Cloudflare Workers Subrequest Limits for Distributed Vector Search

## Executive Summary

This document provides a concrete architecture for executing 1000+ parallel R2 fetches for distributed vector search on Cloudflare Workers, working around platform limits through strategic architectural patterns.

## Current Platform Limits (2025)

| Limit | Free | Paid | Notes |
|-------|------|------|-------|
| **External subrequests** | 50/request | 1,000/request | Internet fetches |
| **Internal services (R2, KV, DO, D1)** | 1,000/request | 1,000/request | Same regardless of plan |
| **Simultaneous open connections** | 6 | 6 | Hard limit per invocation |
| **Service Binding invocations** | 32 | 32 | Hard cap per request chain |
| **Worker-to-Worker via same zone** | Blocked | Blocked | Must use Service Bindings |
| **DO requests/second (soft)** | 1,000 | 1,000 | Per individual object |

**Key insight**: R2 bindings count as **internal services** with 1,000 subrequests/request limit regardless of plan.

## The Problem

For distributed vector search across N shards:
- Each shard stores vector index data in R2
- Query needs to search ALL shards in parallel
- With 1000 shards, we need 1000+ R2 fetches per query
- Single Worker limited to 1,000 internal subrequests AND 6 concurrent connections

## Architecture Options

### Option 1: Zone-Hopping Fan-Out (Works, Not Recommended)

**Concept**: Workers on different zones get independent subrequest budgets.

```
Request --> Worker A (example.com.ai)
                |
                +--> fetch(worker-b.workers.dev) --> 1000 R2 ops
                +--> fetch(worker-c.workers.dev) --> 1000 R2 ops
                +--> fetch(worker-d.workers.dev) --> 1000 R2 ops
```

**Pros**:
- Each zone gets fresh 1000 subrequest budget
- Conceptually simple

**Cons**:
- Requires multiple deployed Workers on different zones
- Network latency between zones (not same-thread)
- Still limited to 6 concurrent outbound connections from coordinator
- Management complexity

**Not recommended** due to latency and complexity.

---

### Option 2: Durable Object Coordinator Pattern (Recommended)

**Based on**: How Cloudflare built Queues (10x throughput via horizontal DO scaling)

**Concept**: Single Coordinator DO delegates to N Consumer Shard DOs, each with independent limits.

```
                                    +---> Shard DO 0 --> R2 (vectors 0-999)
                                    |
Request --> Coordinator DO --------+---> Shard DO 1 --> R2 (vectors 1000-1999)
            (routes queries)       |
                                   +---> Shard DO 2 --> R2 (vectors 2000-2999)
                                   |
                                   +---> ...N Shard DOs
```

**Why this works**:
1. Each DO gets **independent** 1,000 internal subrequests limit
2. DO-to-DO calls via stubs don't count as external subrequests
3. RPC calls are same-thread when possible (zero network overhead)
4. Promise pipelining enables single round-trip for multiple calls

**Implementation**:

```typescript
// coordinator.ts
export class VectorSearchCoordinator extends DurableObject {
  private shardMap: Map<number, DurableObjectId> = new Map()

  async search(query: Float32Array, topK: number): Promise<SearchResult[]> {
    // Fan out to all shard DOs in parallel
    const shardResults = await Promise.all(
      Array.from(this.shardMap.entries()).map(async ([shardIndex, doId]) => {
        const stub = this.ctx.env.VECTOR_SHARD.get(doId)
        // RPC call - runs same-thread, no network
        return stub.searchShard(query, topK)
      })
    )

    // Merge and re-rank results
    return this.mergeResults(shardResults, topK)
  }
}

// shard.ts
export class VectorShard extends DurableObject {
  async searchShard(query: Float32Array, topK: number): Promise<SearchResult[]> {
    // This DO has its OWN 1,000 R2 subrequest budget
    const indexData = await this.ctx.env.R2.get(`shard-${this.shardIndex}/index.bin`)
    const vectors = await this.ctx.env.R2.get(`shard-${this.shardIndex}/vectors.bin`)

    // Perform local vector search
    return this.localSearch(indexData, vectors, query, topK)
  }
}
```

**Scaling math**:
- 1 Coordinator + 100 Shard DOs = 100 * 1,000 = **100,000 R2 ops per query**
- Latency: Single network round-trip (promise pipelining)

---

### Option 3: Two-Tier Shard Hierarchy (For 1M+ vectors)

**Concept**: Tree structure where each level multiplies available subrequests.

```
                              Coordinator DO
                                    |
                    +---------------+---------------+
                    |               |               |
              Region DO 0      Region DO 1     Region DO 2
                    |               |               |
              +-----+-----+   +-----+-----+   +-----+-----+
              |     |     |   |     |     |   |     |     |
           Shard  Shard  ... Shard  Shard ... Shard  Shard ...
           DO 0   DO 1       DO N   DO N+1   DO M   DO M+1
```

**Math**:
- Level 0: 1 Coordinator
- Level 1: 32 Region DOs (limited by Service Binding invocation cap)
- Level 2: 32 * 31 = 992 Shard DOs per Region DO
- Total: 32 * 992 = **31,744 Shard DOs**
- R2 ops: 31,744 * 1,000 = **31.7 million R2 ops per query**

**Latency**: 2 network round-trips (each level pipelines)

**Implementation**:

```typescript
// coordinator.ts
export class HierarchicalCoordinator extends DurableObject {
  async search(query: Float32Array, topK: number): Promise<SearchResult[]> {
    // Fan out to region coordinators (max 32 due to invocation limit)
    const regionResults = await Promise.all(
      this.regionDOs.map(regionId => {
        const stub = this.ctx.env.REGION_DO.get(regionId)
        return stub.searchRegion(query, topK)
      })
    )
    return this.mergeResults(regionResults, topK)
  }
}

// region.ts
export class RegionCoordinator extends DurableObject {
  async searchRegion(query: Float32Array, topK: number): Promise<SearchResult[]> {
    // Fan out to shard DOs (max 31 to stay under 32 limit)
    const shardResults = await Promise.all(
      this.shardDOs.map(shardId => {
        const stub = this.ctx.env.SHARD_DO.get(shardId)
        return stub.searchShard(query, topK)
      })
    )
    return this.mergeResults(shardResults, topK)
  }
}
```

---

### Option 4: Vectorize-Style Architecture (Cloudflare's Own Pattern)

**Based on**: How Cloudflare built Vectorize

**Key insight**: Vectorize uses a single DO as WAL coordinator, delegating heavy computation to external "Executors" while caching R2 data through Cloudflare Cache.

```
Query --> Worker --> Vectorize DO (coordinator)
                          |
                          +--> R2 (via Cache) --> Index snapshots
                          |
                          +--> Executor instances (heavy compute)
```

**Adaptations for our use case**:

1. **Cache R2 index data**: Index files are immutable snapshots, highly cacheable
2. **Single DO coordinates**: Maintains shard map, routes queries
3. **Executors do compute**: Stateless Workers/DOs that load cached data and search

```typescript
// Using Cloudflare Cache for R2 data
async function getCachedIndex(shardId: string, env: Env): Promise<ArrayBuffer> {
  const cacheKey = new Request(`https://internal/index/${shardId}`)
  const cache = caches.default

  let response = await cache.match(cacheKey)
  if (!response) {
    const r2Object = await env.R2.get(`indexes/${shardId}.bin`)
    response = new Response(r2Object?.body, {
      headers: { 'Cache-Control': 'public, max-age=3600' }
    })
    await cache.put(cacheKey, response.clone())
  }
  return response.arrayBuffer()
}
```

---

### Option 5: Workflows for Batch Operations (Not Real-Time)

**Concept**: Workflows allow 1,024 steps, each with fresh subrequest limits.

**Use case**: Batch indexing, not real-time search

```typescript
// workflow.ts
export class BatchVectorIndex extends Workflow {
  async run(event: WorkflowEvent) {
    const chunks = this.splitIntoChunks(event.payload.vectors, 1000)

    for (const [i, chunk] of chunks.entries()) {
      await this.step(`index-chunk-${i}`, async () => {
        // Each step gets fresh 1,000 subrequest limit
        await this.indexChunk(chunk)
      })
    }
  }
}
```

**Limits**:
- Max 1,024 steps
- Not suitable for real-time queries (steps are durable checkpoints)
- Good for background indexing

---

## Recommended Architecture for 1000 Shard Vector Search

### Design Goals
- Support 1000 shards (1M+ vectors)
- Sub-100ms query latency
- Single network round-trip where possible

### Architecture

```
                    +-----------------+
                    |   Edge Worker   |
                    | (entry point)   |
                    +--------+--------+
                             |
                             v
                    +--------+--------+
                    |  Coordinator DO |
                    |  (shard map,    |
                    |   routing)      |
                    +--------+--------+
                             |
          +------------------+------------------+
          |                  |                  |
          v                  v                  v
   +------+------+    +------+------+    +------+------+
   | Region DO 0 |    | Region DO 1 |    | Region DO N |
   | (32 shards) |    | (32 shards) |    | (32 shards) |
   +------+------+    +------+------+    +------+------+
          |                  |                  |
    +-----+-----+      +-----+-----+      +-----+-----+
    |     |     |      |     |     |      |     |     |
    v     v     v      v     v     v      v     v     v
  Shard Shard Shard  Shard Shard Shard  Shard Shard Shard
   DO    DO    DO     DO    DO    DO     DO    DO    DO
    |     |     |      |     |     |      |     |     |
    v     v     v      v     v     v      v     v     v
   R2    R2    R2     R2    R2    R2     R2    R2    R2
(cached)(cached)(cached)...
```

### Implementation

```typescript
// types.ts
interface VectorSearchQuery {
  vector: Float32Array
  topK: number
  filter?: Record<string, unknown>
}

interface SearchResult {
  id: string
  score: number
  metadata?: Record<string, unknown>
}

// coordinator.do.ts
export class VectorCoordinator extends DurableObject {
  private regionMap: Map<number, DurableObjectId> = new Map()

  async initialize() {
    // Load shard map from storage
    const stored = await this.ctx.storage.get<Map<number, string>>('regionMap')
    if (stored) {
      for (const [idx, idStr] of stored) {
        this.regionMap.set(idx, this.ctx.env.REGION_DO.idFromString(idStr))
      }
    }
  }

  async search(query: VectorSearchQuery): Promise<SearchResult[]> {
    const startTime = Date.now()

    // Promise pipelining: all calls sent in single round-trip
    const regionPromises = Array.from(this.regionMap.values()).map(regionId => {
      const stub = this.ctx.env.REGION_DO.get(regionId)
      return stub.searchRegion(query)
    })

    const regionResults = await Promise.all(regionPromises)

    // Merge results using heap for efficiency
    const merged = this.heapMerge(regionResults.flat(), query.topK)

    console.log(`Search completed in ${Date.now() - startTime}ms`)
    return merged
  }

  private heapMerge(results: SearchResult[], topK: number): SearchResult[] {
    // Min-heap to keep top K results
    results.sort((a, b) => b.score - a.score)
    return results.slice(0, topK)
  }
}

// region.do.ts
export class RegionCoordinator extends DurableObject {
  private shardDOs: DurableObjectId[] = []

  async searchRegion(query: VectorSearchQuery): Promise<SearchResult[]> {
    // Each region coordinates up to 31 shards (staying under 32 invocation limit)
    const shardPromises = this.shardDOs.map(shardId => {
      const stub = this.ctx.env.SHARD_DO.get(shardId)
      return stub.searchShard(query)
    })

    const shardResults = await Promise.all(shardPromises)

    // Local merge before returning to coordinator
    return this.localMerge(shardResults.flat(), query.topK * 2) // Over-fetch for better merge
  }
}

// shard.do.ts
export class VectorShard extends DurableObject {
  private indexCache: ArrayBuffer | null = null
  private vectorsCache: Float32Array | null = null

  async searchShard(query: VectorSearchQuery): Promise<SearchResult[]> {
    // Load index from R2 (cached in memory and Cloudflare Cache)
    await this.ensureLoaded()

    // Perform SIMD-optimized vector search
    return this.vectorSearch(query.vector, query.topK)
  }

  private async ensureLoaded() {
    if (this.indexCache) return

    // Try Cloudflare Cache first
    const cacheKey = `https://internal/shard/${this.shardId}/index`
    const cache = caches.default

    let cached = await cache.match(cacheKey)
    if (cached) {
      this.indexCache = await cached.arrayBuffer()
    } else {
      // Fall back to R2
      const obj = await this.ctx.env.R2.get(`shards/${this.shardId}/index.bin`)
      if (obj) {
        this.indexCache = await obj.arrayBuffer()
        // Cache for future requests
        await cache.put(cacheKey, new Response(this.indexCache, {
          headers: { 'Cache-Control': 'public, max-age=3600' }
        }))
      }
    }
  }

  private vectorSearch(query: Float32Array, topK: number): SearchResult[] {
    // HNSW or IVF search implementation
    // Uses SIMD via WebAssembly for performance
    return searchHNSW(this.indexCache!, query, topK)
  }
}

// wrangler.toml
// [[durable_objects.bindings]]
// name = "COORDINATOR"
// class_name = "VectorCoordinator"
//
// [[durable_objects.bindings]]
// name = "REGION_DO"
// class_name = "RegionCoordinator"
//
// [[durable_objects.bindings]]
// name = "SHARD_DO"
// class_name = "VectorShard"
//
// [[r2_buckets]]
// binding = "R2"
// bucket_name = "vector-indexes"
```

### Latency Analysis

| Operation | Latency | Notes |
|-----------|---------|-------|
| Worker -> Coordinator DO | ~1ms | Same colo, same thread possible |
| Coordinator -> Region DOs (32) | ~1ms | Promise pipelining, same colo |
| Region -> Shard DOs (31 each) | ~1ms | Promise pipelining, same colo |
| Shard -> R2 (cached) | ~5ms | Cloudflare Cache hit |
| Shard -> R2 (miss) | ~50ms | Cold R2 fetch |
| Vector search (WASM) | ~10ms | SIMD-optimized HNSW |
| **Total (cache hit)** | **~20ms** | Excellent |
| **Total (cache miss)** | **~70ms** | Acceptable |

### Capacity Calculation

For 1000 shards with this architecture:

```
Regions needed: ceil(1000 / 31) = 33 Region DOs
Coordinator -> 33 Region calls (within 1000 subrequest limit)
Each Region -> 31 Shard calls (within 32 invocation limit)
Total Shards: 33 * 31 = 1,023 (covers 1000)
```

For 10,000 shards:
```
Regions needed: ceil(10000 / 31) = 323 Region DOs
Coordinator -> 323 Region calls (within 1000 subrequest limit)
Each Region -> 31 Shard calls
Total Shards: 323 * 31 = 10,013 (covers 10,000)
```

**Maximum theoretical scale**: 1000 Regions * 31 Shards = **31,000 shards per query**

---

## Error Handling & Resilience

### Timeout Propagation

```typescript
async search(query: VectorSearchQuery, timeout = 5000): Promise<SearchResult[]> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const results = await Promise.race([
      this.doSearch(query),
      new Promise((_, reject) =>
        controller.signal.addEventListener('abort', () =>
          reject(new Error('Search timeout'))
        )
      )
    ])
    return results
  } finally {
    clearTimeout(timeoutId)
  }
}
```

### Partial Results on Failure

```typescript
async searchWithFallback(query: VectorSearchQuery): Promise<SearchResultWithMeta> {
  const results = await Promise.allSettled(
    this.regionDOs.map(id => this.ctx.env.REGION_DO.get(id).searchRegion(query))
  )

  const successful = results
    .filter((r): r is PromiseFulfilledResult<SearchResult[]> => r.status === 'fulfilled')
    .map(r => r.value)
    .flat()

  const failed = results.filter(r => r.status === 'rejected').length

  return {
    results: this.heapMerge(successful, query.topK),
    meta: {
      shardsQueried: results.length,
      shardsFailed: failed,
      partial: failed > 0
    }
  }
}
```

### Circuit Breaker Pattern

```typescript
class ShardCircuitBreaker {
  private failures = new Map<string, number>()
  private lastFailure = new Map<string, number>()
  private readonly threshold = 5
  private readonly resetTimeout = 30000

  async call<T>(shardId: string, fn: () => Promise<T>): Promise<T | null> {
    const failures = this.failures.get(shardId) || 0
    const lastFail = this.lastFailure.get(shardId) || 0

    // Check if circuit is open
    if (failures >= this.threshold) {
      if (Date.now() - lastFail < this.resetTimeout) {
        return null // Skip this shard
      }
      // Reset for retry
      this.failures.set(shardId, 0)
    }

    try {
      const result = await fn()
      this.failures.set(shardId, 0)
      return result
    } catch (error) {
      this.failures.set(shardId, failures + 1)
      this.lastFailure.set(shardId, Date.now())
      throw error
    }
  }
}
```

---

## Monitoring & Observability

```typescript
// Emit metrics via Workers Analytics Engine
async search(query: VectorSearchQuery): Promise<SearchResult[]> {
  const startTime = Date.now()

  try {
    const results = await this.doSearch(query)

    this.ctx.env.ANALYTICS.writeDataPoint({
      blobs: ['vector_search', 'success'],
      doubles: [Date.now() - startTime, results.length],
      indexes: [this.shardId]
    })

    return results
  } catch (error) {
    this.ctx.env.ANALYTICS.writeDataPoint({
      blobs: ['vector_search', 'error', error.message],
      doubles: [Date.now() - startTime, 0],
      indexes: [this.shardId]
    })
    throw error
  }
}
```

---

## Summary

| Approach | Max Shards | Latency | Complexity | Recommended For |
|----------|------------|---------|------------|-----------------|
| Single DO | 1 | ~20ms | Low | < 1M vectors |
| Coordinator + Shards | 1,000 | ~25ms | Medium | 1M-100M vectors |
| Two-Tier Hierarchy | 31,000 | ~35ms | High | 100M-1B vectors |
| Zone-Hopping | Unlimited | ~100ms+ | Very High | Not recommended |

**Recommended approach**: Two-Tier Hierarchy (Coordinator -> Regions -> Shards) for flexibility and scale.

---

## Sources

- [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cloudflare Service Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
- [Durable Objects Limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [Building Vectorize](https://blog.cloudflare.com/building-vectorize-a-distributed-vector-database-on-cloudflare-developer-platform/)
- [How We Built Cloudflare Queues](https://blog.cloudflare.com/how-we-built-cloudflare-queues/)
- [JavaScript-Native RPC](https://blog.cloudflare.com/javascript-native-rpc/)
- [Cloudflare Workflows Limits](https://developers.cloudflare.com/workflows/reference/limits/)
