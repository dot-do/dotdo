---
title: "Vector Search on Iceberg: Unified Architecture"
description: Documentation for plans
---

# Vector Search on Iceberg: Unified Architecture

A synthesis of four research perspectives into a practical, cost-effective vector search system for Cloudflare Workers.

## Executive Summary

This architecture provides **Wikipedia-scale vector search (100M-500M vectors) at 1000x lower cost than Pinecone** by combining the best ideas from:

1. **ANN Perspective**: IVF-PQ for proven compression and fast approximate search
2. **Columnar Perspective**: Parquet row groups as natural vector clusters with predicate pushdown
3. **Distributed Perspective**: LSH sharding with DO hierarchy for coordination
4. **Unconventional Perspective**: Matryoshka embeddings + binary quantization for progressive precision

**Key Innovation**: Progressive precision search with three representation levels stored in the same Parquet files, enabling graceful scaling from 1M to 500M vectors.

## Target Metrics

| Metric | 1M Vectors | 10M Vectors | 100M+ Vectors |
|--------|------------|-------------|---------------|
| Recall@100 | 98%+ | 96%+ | 94%+ |
| Latency p50 | 50ms | 80ms | 120ms |
| Latency p99 | 100ms | 150ms | 250ms |
| Storage Cost | $0.50/mo | $5/mo | $50/mo |
| Query Cost (1M queries) | $2 | $3 | $5 |

## Scale-Appropriate Strategies

### Small Scale (1M vectors): Matryoshka + Simple Clustering

At 1M vectors, the entire index can fit in a single Durable Object with smart loading:

```
Storage: ~6GB full vectors, ~250MB 64-dim Matryoshka prefixes
Memory: Keep 64-dim prefixes in DO memory (250MB with overhead)
Strategy:
  1. Full scan of 64-dim prefixes in memory (~5ms)
  2. Fetch top-500 candidates full vectors from R2
  3. Exact rerank to top-K
```

**Why this works**:
- 1M * 256 bytes (64-dim float32) = 256MB fits in DO storage
- No clustering overhead or complexity
- Single R2 round trip for candidates
- 98%+ recall with minimal infrastructure

### Medium Scale (10M vectors): IVF + Matryoshka Cascading

At 10M vectors, introduce IVF clustering with Matryoshka for candidate filtering:

```
Clusters: 1,000 centroids (sqrt(10M) rule)
Vectors per cluster: ~10K average
Storage layout:
  - centroids.parquet (1K * 6KB = 6MB)
  - cluster_XXXX.parquet (10K vectors each)
    - Row Group 0: 64-dim Matryoshka prefixes
    - Row Group 1: Full 1536-dim vectors
    - Row Group 2: Metadata
```

**Query flow**:
1. Load centroids into DO memory (6MB, cached)
2. Find top-10 nearest centroids (~1ms)
3. Parallel R2 reads for cluster Matryoshka prefixes (~50ms)
4. ADC-style scoring on 64-dim, select top-500 candidates
5. Fetch full vectors for candidates, exact rerank (~30ms)
6. Total: ~85ms, 96%+ recall

### Large Scale (100M+ vectors): Full Hybrid Architecture

At Wikipedia scale, use the complete architecture with all optimizations:

```
Tier 1: Binary quantization for ultra-fast coarse filtering
  - 192 bytes per vector = 19GB for 100M
  - Sharded across 200 Parquet files
  - Hamming distance via WASM popcount

Tier 2: Product Quantization for medium precision
  - 8 bytes per vector (PQ-8x8) = 800MB for 100M
  - Stored in IVF cluster files

Tier 3: Full vectors for final reranking
  - Only fetched for top-1000 candidates
```

## Unified File Layout

```
r2://vectors/
├── metadata/
│   └── iceberg/
│       ├── metadata.json
│       ├── snap-*.avro
│       └── manifests/
│
├── index/
│   ├── centroids.parquet           # K centroids (K=sqrt(N))
│   │   └── Columns: id, centroid_vector, vector_count, radius
│   ├── pq_codebooks.bin            # PQ codebooks (1.5MB)
│   └── lsh_hyperplanes.bin         # LSH hyperplanes for ultra-scale
│
├── clusters/
│   ├── cluster_0000.parquet
│   │   ├── Row Group 0: Matryoshka 64-dim prefixes
│   │   ├── Row Group 1: PQ codes (8 bytes each)
│   │   ├── Row Group 2: Full vectors (for reranking)
│   │   └── Row Group 3: Metadata
│   ├── cluster_0001.parquet
│   └── ...
│
└── binary/                         # Ultra-scale only
    ├── shard_000.bin               # Binary codes for fast Hamming
    └── ...
```

## Parquet Schema

```
message VectorCluster {
  required binary id (STRING);
  required binary namespace (STRING);

  // Matryoshka progressive dimensions
  required group matryoshka_64 (LIST) {
    repeated group list {
      required float element;
    }
  }

  // Product Quantization codes
  required binary pq_codes (FIXED_LEN_BYTE_ARRAY(8));

  // Full precision (optional, for reranking subset)
  optional group embedding (LIST) {
    repeated group list {
      required float element;
    }
  }

  // Clustering metadata
  required int32 cluster_id;
  required float centroid_distance;
  required float l2_norm;

  // Probe statistics for predicate pushdown
  required float probe_dot_0;
  required float probe_dot_1;
  required float probe_dot_2;
  required float probe_dot_3;

  // Application metadata
  required int64 created_at (TIMESTAMP_MILLIS);
  optional binary metadata (JSON);
}
```

## Component Architecture

### 1. Matryoshka Embedding Handler

Generates and uses hierarchical embeddings where first N dimensions are valid lower-precision embeddings.

```typescript
interface MatryoshkaHandler {
  // Extract prefix dimensions from full embedding
  extractPrefix(embedding: Float32Array, dims: 64 | 128 | 256 | 512): Float32Array

  // Compute approximate distance using prefixes (faster, lower precision)
  approximateDistance(
    queryPrefix: Float32Array,
    candidatePrefix: Float32Array,
    metric: 'cosine' | 'l2'
  ): number

  // Cascade search: coarse to fine
  cascadeSearch(
    query: Float32Array,
    candidates: MatryoshkaCandidates,
    stages: Array<{ dims: number; keep: number }>
  ): Promise<SearchResult[]>
}
```

### 2. IVF Centroid Index

Maintains cluster centroids in Durable Object memory for O(K) coarse search.

```typescript
interface CentroidIndex {
  // Load centroids from R2/storage
  initialize(env: Env): Promise<void>

  // Find nearest clusters for query
  findNearest(query: Float32Array, nprobe: number): ClusterMatch[]

  // Assign vector to cluster (for indexing)
  assignCluster(vector: Float32Array): number

  // Get centroid by ID
  getCentroid(clusterId: number): Float32Array
}
```

### 3. Product Quantizer

Implements PQ encoding/decoding with ADC (Asymmetric Distance Computation).

```typescript
interface ProductQuantizer {
  // Train codebooks on sample vectors
  train(vectors: Float32Array[], config: PQConfig): Promise<void>

  // Encode vector to PQ codes
  encode(vector: Float32Array): Uint8Array

  // Precompute ADC lookup tables for query
  computeADCTables(query: Float32Array): Float32Array[]

  // Fast approximate distance using precomputed tables
  adcDistance(tables: Float32Array[], codes: Uint8Array): number

  // Decode PQ codes back to approximate vector
  decode(codes: Uint8Array): Float32Array
}
```

### 4. Vector Search Coordinator

Orchestrates scatter-gather search across shards with result aggregation.

```typescript
interface VectorSearchCoordinator {
  // Main search entry point
  search(query: Float32Array, options: SearchOptions): Promise<SearchResult[]>

  // Plan which files/clusters to search
  planSearch(query: Float32Array, options: SearchOptions): SearchPlan

  // Execute plan with parallel R2 reads
  executeSearch(plan: SearchPlan): Promise<ScoredCandidate[]>

  // Merge results from multiple shards
  mergeResults(results: ScoredCandidate[][], k: number): SearchResult[]
}
```

### 5. Binary Quantizer (Ultra-Scale)

1-bit quantization with Hamming distance for initial coarse filtering.

```typescript
interface BinaryQuantizer {
  // Quantize to binary (sign of each dimension)
  quantize(vector: Float32Array): Uint8Array  // 192 bytes for 1536 dims

  // Hamming distance (XOR + popcount)
  hammingDistance(a: Uint8Array, b: Uint8Array): number

  // Batch Hamming scan (SIMD-optimized)
  batchScan(query: Uint8Array, corpus: Uint8Array[], topK: number): number[]
}
```

## Query Execution Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│ Query Vector (1536d)                                                │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STAGE 1: Coarse Quantization (In-Memory, <2ms)                      │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ CentroidIndex.findNearest(query, nprobe=20)                     ││
│  │ → Returns cluster IDs and distances                             ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STAGE 2: Matryoshka Filtering (Parallel R2, ~50ms)                  │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ For each cluster in parallel:                                   ││
│  │   1. Fetch 64-dim Matryoshka prefixes (Row Group 0)             ││
│  │   2. Compute approximate distances                              ││
│  │   3. Keep top-500 candidates per cluster                        ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STAGE 3: PQ Scoring (In-Memory, ~5ms)                               │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ 1. Precompute ADC tables for query                              ││
│  │ 2. Score all candidates with PQ codes (8 table lookups each)   ││
│  │ 3. Sort and keep top-1000                                       ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ STAGE 4: Exact Reranking (R2 Fetch, ~30ms)                          │
│  ┌─────────────────────────────────────────────────────────────────┐│
│  │ 1. Fetch full vectors for top-1000 candidates                   ││
│  │ 2. Compute exact distances                                      ││
│  │ 3. Sort and return top-K                                        ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Final Results (top-K with exact scores)                             │
└─────────────────────────────────────────────────────────────────────┘
```

## Durable Object Hierarchy

```
                    ┌─────────────────────────────┐
                    │   VectorCoordinatorDO       │
                    │   (Global Singleton)        │
                    │  - Routing decisions        │
                    │  - Centroid cache           │
                    │  - PQ codebooks             │
                    └──────────────┬──────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
              ▼                    ▼                    ▼
   ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
   │ VectorShardDO   │  │ VectorShardDO   │  │ VectorShardDO   │
   │ (Clusters 0-99) │  │ (Clusters 100-  │  │ (Clusters 200-  │
   │                 │  │  199)           │  │  299)           │
   │ - Lazy loads    │  │                 │  │                 │
   │   from R2       │  │                 │  │                 │
   │ - Caches hot    │  │                 │  │                 │
   │   clusters      │  │                 │  │                 │
   └─────────────────┘  └─────────────────┘  └─────────────────┘
```

## Cost Analysis

### Storage Costs (R2: $0.015/GB/month)

| Scale | Raw Vectors | PQ Codes | Matryoshka | Centroids | Total | Monthly |
|-------|-------------|----------|------------|-----------|-------|---------|
| 1M | 6GB | 8MB | 256MB | 60KB | ~7GB | $0.11 |
| 10M | 60GB | 80MB | 2.5GB | 600KB | ~65GB | $0.98 |
| 100M | 600GB | 800MB | 25GB | 6MB | ~630GB | $9.45 |
| 500M | 3TB | 4GB | 125GB | 30MB | ~3.2TB | $48 |

### Query Costs (per 1M queries)

| Operation | Count per Query | Unit Cost | Cost per 1M Queries |
|-----------|-----------------|-----------|---------------------|
| Worker invocations | 1 | $0.50/M | $0.50 |
| DO invocations | 2 | $0.15/M | $0.30 |
| R2 Class B reads | 15 | $0.36/M | $5.40 |
| **Total** | | | **~$6.20** |

### Comparison with Managed Solutions

| Solution | 100M Vectors Monthly | Notes |
|----------|----------------------|-------|
| **This Design** | ~$50 | R2 + Workers + DO |
| Pinecone | ~$7,000 | s1 pods |
| Weaviate Cloud | ~$2,500 | Estimated |
| Qdrant Cloud | ~$1,000 | Estimated |

**100-1000x cost reduction** depending on scale.

## Implementation Order

The components have natural dependencies that determine implementation order:

```
Foundation Layer (Week 1-2):
  ├── Matryoshka Handler (standalone, no deps)
  ├── Binary Quantizer (standalone, no deps)
  └── Product Quantizer (standalone, no deps)

Storage Layer (Week 3-4):
  ├── Parquet Cluster Format (depends on PQ, Matryoshka)
  └── IVF Centroid Index (standalone)

Coordination Layer (Week 5-6):
  └── Vector Search Coordinator (depends on all above)
```

## Scaling Guide

### Starting Small (< 1M vectors)

1. Skip PQ and binary quantization
2. Use single DO with Matryoshka prefixes in memory
3. Single cluster file per namespace
4. Full vector reranking for all candidates

### Scaling to Medium (1M-10M vectors)

1. Enable IVF clustering (~1K clusters)
2. Add PQ codes for faster candidate scoring
3. Multiple shard DOs
4. Matryoshka + PQ two-stage filtering

### Scaling to Large (10M-100M vectors)

1. Increase cluster count (~10K clusters)
2. Enable binary quantization for initial filtering
3. Full DO hierarchy with regional leaders
4. Aggressive caching of hot clusters

### Scaling to Wikipedia (100M+ vectors)

1. Full architecture with all components
2. LSH sharding for super-clusters
3. Multi-region DO replication
4. Binary -> Matryoshka -> PQ -> Exact four-stage search

## Key Design Decisions

### Why Matryoshka over traditional dimensionality reduction?

- No separate index to maintain (prefixes ARE the embeddings)
- Graceful precision/speed tradeoff
- Compatible with any embedding model that supports it
- Lossless first-N dimensions (not a projection)

### Why IVF over HNSW?

- Disk-friendly: clusters map to files
- Parallelizable: multiple clusters searched in parallel
- Simpler updates: append to cluster files
- Lower memory: only centroids in memory

### Why Product Quantization over scalar quantization?

- 8 bytes vs 1536 bytes (192x compression)
- Minimal recall loss (~5%)
- ADC enables sub-millisecond scoring
- Well-understood, battle-tested (FAISS)

### Why Parquet over custom format?

- Industry standard with mature tooling
- Columnar: load only needed dimensions
- Row groups: natural cluster boundaries
- Compression: ZSTD built-in
- parquet-wasm: Works in Workers

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Matryoshka not supported by embedding model | Can't use progressive search | Fall back to PQ-only with 64-dim projections |
| R2 latency spikes | Query latency degrades | Request hedging, result caching, multi-region |
| Cold start latency | First query slow | Warm DO pool, preload centroids |
| Memory pressure in DO | OOM kills | Smaller batch sizes, streaming aggregation |
| Index staleness | Missing new vectors | Background index updates, delta files |

## Next Steps

1. Implement components in TDD style (RED/GREEN/REFACTOR)
2. Benchmark with SIFT1M dataset (standard ANN benchmark)
3. Validate recall targets with real embeddings
4. Optimize hot paths based on profiling
5. Add Iceberg metadata integration
6. Production hardening (monitoring, alerting, backups)
