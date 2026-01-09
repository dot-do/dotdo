# Vector Index Design for R2 + Parquet/Iceberg: An ANN Expert Perspective

## Executive Summary

This document provides a detailed analysis of how to implement Wikipedia-scale vector search (hundreds of millions of embeddings) using R2 storage, Parquet/Iceberg, and Cloudflare Workers. The key insight is that **no single approach works** - we need a hybrid architecture that combines multiple ANN techniques, each optimized for different access patterns.

**Recommended Architecture:**
- **Coarse Quantizer (IVF)**: Cluster centroids stored in Workers memory or Durable Objects
- **Fine Quantizer (PQ)**: Product-quantized codes stored in Parquet row groups
- **HNSW Navigation Layer**: Lightweight graph for centroid navigation
- **Iceberg Partitioning**: Natural clustering by semantic/temporal dimensions

**Target Metrics:**
| Metric | Target | Approach |
|--------|--------|----------|
| Recall@100 | >95% | Multi-probe IVF + asymmetric distance |
| Latency (p50) | <150ms | Cached centroids + parallel R2 reads |
| Latency (p99) | <300ms | Bounded fan-out + early termination |
| Cost per 1M queries | <$5 | R2 reads + minimal compute |
| Index size | ~25 bytes/vector | PQ-8x8 + metadata |

---

## Part 1: Understanding the Constraints

### 1.1 Cloudflare Workers Limits

```
Memory Limit: 128 MB
CPU Time: 30 seconds (per request)
Subrequests: 1000 per request
R2 Latency: 30-80ms per GET (varies by region)
R2 Throughput: ~100 MB/s per connection
```

These constraints fundamentally shape our design:

1. **128MB Memory** = Cannot hold full HNSW graph in memory
2. **1000 Subrequests** = Can fan out to ~50-100 Parquet files max (accounting for retries)
3. **30-80ms R2 latency** = Multiple sequential R2 calls are latency killers
4. **Sub-200ms target** = At most 2-3 sequential R2 calls

### 1.2 Scale Analysis

For 500M vectors at 1536 dimensions (OpenAI embeddings):

```
Raw data: 500M * 1536 * 4 bytes = 2.87 TB
With PQ-8x8: 500M * 192 bytes = 96 GB
With PQ-8x4: 500M * 96 bytes = 48 GB
Metadata (avg 200 bytes): 500M * 200 = 100 GB
```

Key insight: Even with aggressive quantization, the index is too large for memory. We must embrace disk-based search.

### 1.3 R2 Cost Model

```
Storage: $0.015/GB/month
Class A (writes): $4.50/million
Class B (reads): $0.36/million
Free egress to Workers
```

For 150 GB index + 500 GB source data:
- Storage: ~$10/month
- 1M queries at 10 R2 reads each: $3.60
- **Total: ~$15/month for 1M queries**

This is 10-100x cheaper than managed vector DBs at this scale.

---

## Part 2: HNSW on R2 - Analysis

### 2.1 Standard HNSW Structure

```
Layer 3: [  N1  ] -------- [  N2  ]
           |                  |
Layer 2: [ N1 ] -- [ N3 ] -- [ N2 ] -- [ N5 ]
           |         |         |         |
Layer 1: [N1]-[N4]-[N3]-[N6]-[N2]-[N7]-[N5]-[N8]
           |   |    |   |    |   |    |   |
Layer 0: [all nodes densely connected, M neighbors each]
```

HNSW Parameters:
- **M**: Max edges per node (typically 16-64)
- **ef_construction**: Build-time search width
- **ef_search**: Query-time search width (recall/speed tradeoff)

### 2.2 Why Pure HNSW on R2 Doesn't Work

**Problem 1: Random Access Pattern**

HNSW search is inherently sequential and random:
```
visit(entry_point)
while not converged:
  neighbors = get_neighbors(current_best)  // Random R2 read
  for n in neighbors:
    if n.distance < current_best.distance:
      current_best = n
      // Another random R2 read for n's neighbors
```

Each hop requires loading a node's neighbors from R2. With 30-50ms per R2 GET and 50-100 hops for convergence, latency would be **1.5-5 seconds** - unacceptable.

**Problem 2: Graph Serialization Overhead**

HNSW graphs have complex pointer structures. Storing in Parquet requires:
- Denormalizing neighbor lists (node_id -> [neighbor_ids])
- Multiple row group reads to follow edges
- No columnar benefit since we need full rows

**Problem 3: Memory for Top Layers**

Upper HNSW layers are sparse but critical for fast entry. At 500M vectors:
- Layer 0: 500M nodes
- Layer 1: ~25M nodes
- Layer 2: ~1.25M nodes
- Layer 3: ~62K nodes

Even the upper layers are too large to cache in 128MB.

### 2.3 When HNSW on R2 Could Work

HNSW on R2 is viable for **cluster centroid navigation** only:

```typescript
// Store only centroids (e.g., 10,000 clusters) in HNSW
// Full centroid graph: 10K * 64 neighbors * 8 bytes = 5 MB
// Fits in memory or single R2 read!

interface CentroidHNSW {
  layer0: Map<number, number[]>  // centroid_id -> neighbor_ids
  layer1: Map<number, number[]>  // sparser layer
  centroids: Float32Array        // 10K * 1536 * 4 = 60 MB
}
```

This gives us the best of both worlds:
- O(log N) navigation to find relevant clusters
- Bulk Parquet reads for candidates within clusters

---

## Part 3: IVF Variants for Parquet/Iceberg

### 3.1 IVF-Flat Architecture

**Concept**: Partition vectors into K clusters, store each cluster as a Parquet file.

```
┌─────────────────────────────────────────────────────────────┐
│                    CENTROID INDEX                            │
│  (stored in DO memory or single Parquet file)               │
│                                                              │
│  centroid_0: [0.12, -0.34, 0.56, ...]  -> cluster_0.parquet │
│  centroid_1: [0.89, 0.23, -0.11, ...]  -> cluster_1.parquet │
│  ...                                                         │
│  centroid_K: [...]                      -> cluster_K.parquet │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ Query: find nearest centroids
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    CLUSTER FILES (Parquet)                   │
│                                                              │
│  cluster_0.parquet:                                          │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ Row Group 0 (10K vectors)                               ││
│  │  - id: string                                           ││
│  │  - vector: fixed_size_list<float32>[1536]              ││
│  │  - metadata: json                                       ││
│  │  - Column statistics: min/max for filtering             ││
│  ├─────────────────────────────────────────────────────────┤│
│  │ Row Group 1 (10K vectors)                               ││
│  │  ...                                                    ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

**Parquet Schema for IVF-Flat:**

```typescript
interface IVFFlatParquetSchema {
  // Required columns
  id: string              // Vector ID
  vector: Float32Array    // Full precision vector (1536 * 4 = 6144 bytes)

  // Optional metadata
  metadata: string        // JSON metadata
  created_at: bigint      // Timestamp for time-range queries
  text: string            // Original text for hybrid search

  // Clustering info (denormalized for filtering)
  cluster_id: number      // Which cluster this belongs to
  distance_to_centroid: number  // Pre-computed for re-ranking
}
```

**File Layout:**

```
vectors/
├── centroids/
│   └── centroids.parquet     # K centroids, ~60 MB for K=10000
├── clusters/
│   ├── cluster_0000.parquet  # ~50K vectors each
│   ├── cluster_0001.parquet
│   ├── ...
│   └── cluster_9999.parquet
└── metadata/
    └── iceberg/
        ├── metadata.json
        └── manifests/
```

### 3.2 IVF-PQ Architecture (Recommended)

**Concept**: Combine IVF clustering with Product Quantization for 10-50x compression.

**Product Quantization Primer:**

```
Original vector: [x1, x2, x3, ..., x1536]
                     │
Split into M subspaces (M=8 for PQ-8):
                     │
┌────────┐ ┌────────┐     ┌────────┐
│ x1-192 │ │x193-384│ ... │x1345-  │
│        │ │        │     │  1536  │
└────┬───┘ └────┬───┘     └────┬───┘
     │          │              │
Quantize each subspace to K centroids (K=256 for 8-bit codes):
     │          │              │
     ▼          ▼              ▼
   code_0     code_1   ...   code_7
   (uint8)    (uint8)        (uint8)

Compressed representation: [code_0, code_1, ..., code_7]
8 bytes instead of 6144 bytes = 768x compression!
```

**Parquet Schema for IVF-PQ:**

```typescript
interface IVFPQParquetSchema {
  // Required columns
  id: string                    // Vector ID
  pq_codes: Uint8Array          // PQ codes (8 bytes for PQ-8x8)

  // For asymmetric distance computation
  residual_norm: number         // ||x - centroid|| for ADC

  // Optional for re-ranking
  vector?: Float32Array         // Full vector (only top candidates)

  // Metadata
  metadata: string
  cluster_id: number
}

// Stored separately: PQ codebooks
interface PQCodebook {
  // M codebooks, each with K centroids of dimension D/M
  // For PQ-8x8 with 1536d: 8 * 256 * 192 * 4 = 1.5 MB
  codebooks: Float32Array[]     // [M][K][D/M]
}
```

**Asymmetric Distance Computation (ADC):**

The key to fast PQ search is ADC - precompute query-to-codebook distances once:

```typescript
function computeADC(query: Float32Array, codebook: PQCodebook): Float32Array[] {
  // Precompute: query subvector -> all 256 centroids distance
  // Result: M tables of 256 distances each
  const tables: Float32Array[] = []

  for (let m = 0; m < M; m++) {
    const subquery = query.slice(m * subDim, (m + 1) * subDim)
    const table = new Float32Array(256)

    for (let k = 0; k < 256; k++) {
      const centroid = codebook.codebooks[m].slice(k * subDim, (k + 1) * subDim)
      table[k] = squaredL2Distance(subquery, centroid)
    }

    tables.push(table)
  }

  return tables  // Total: 8 * 256 * 4 = 8 KB
}

function approximateDistance(adcTables: Float32Array[], pqCodes: Uint8Array): number {
  let dist = 0
  for (let m = 0; m < M; m++) {
    dist += adcTables[m][pqCodes[m]]  // Table lookup!
  }
  return dist
}
```

This makes distance computation O(M) table lookups instead of O(D) floating point operations.

### 3.3 IVF-HNSW Hybrid

**Concept**: Use HNSW for centroid navigation, IVF-PQ for candidate retrieval.

```
┌─────────────────────────────────────────────────────────────┐
│                    CENTROID HNSW                             │
│           (fits in memory: ~10K centroids)                  │
│                                                              │
│  Layer 2:    [C1] -------- [C2]                             │
│               |              |                               │
│  Layer 1: [C1]-[C3]-[C2]-[C5]                               │
│            |   |   |   |                                     │
│  Layer 0: [all centroids connected]                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ HNSW search returns top-k centroids
                              │ (in-memory, <1ms)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              PARALLEL PARQUET READS                          │
│                                                              │
│  probe_1: R2 GET cluster_42.parquet ──┐                     │
│  probe_2: R2 GET cluster_17.parquet ──┼─> Merge candidates  │
│  probe_3: R2 GET cluster_89.parquet ──┤                     │
│  ...                                  │                      │
│  probe_n: R2 GET cluster_XX.parquet ──┘                     │
│                                                              │
│  (parallel, ~50-80ms total)                                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ ADC scoring of PQ codes
                              ▼
┌─────────────────────────────────────────────────────────────┐
│               RE-RANKING (Optional)                          │
│                                                              │
│  Top-1000 candidates from PQ scoring                         │
│  Fetch full vectors for top-100                              │
│  Exact distance computation                                  │
│  Return top-K results                                        │
└─────────────────────────────────────────────────────────────┘
```

---

## Part 4: Iceberg Partitioning Strategies

### 4.1 Partition Dimensions

Iceberg partitioning should align with query patterns:

```typescript
interface VectorPartitionSpec {
  // Semantic clustering (required for ANN)
  cluster_id: number        // IVF cluster assignment

  // Temporal (for time-range queries)
  year: number
  month: number

  // Domain (for multi-tenant)
  namespace: string         // e.g., 'customer.do'

  // Type (for type-specific search)
  entity_type: string       // e.g., 'Document', 'Chunk', 'Image'
}
```

**Iceberg Partition Spec:**

```json
{
  "spec-id": 0,
  "fields": [
    { "source-id": 1, "field-id": 1000, "name": "cluster_id", "transform": "identity" },
    { "source-id": 2, "field-id": 1001, "name": "namespace", "transform": "identity" },
    { "source-id": 3, "field-id": 1002, "name": "month", "transform": "month" }
  ]
}
```

### 4.2 File Layout with Partitioning

```
warehouse/
└── vectors/
    └── data/
        ├── cluster_id=0/
        │   ├── namespace=acme.do/
        │   │   ├── month=2024-01/
        │   │   │   └── 00000-0-abc123.parquet
        │   │   └── month=2024-02/
        │   │       └── 00000-0-def456.parquet
        │   └── namespace=globex.do/
        │       └── ...
        ├── cluster_id=1/
        │   └── ...
        └── metadata/
            ├── version-hint.text
            └── v1.metadata.json
```

### 4.3 Partition Pruning for Vector Search

```typescript
async function searchWithPruning(
  query: Float32Array,
  options: SearchOptions,
  icebergReader: IcebergReader
): Promise<VectorHit[]> {
  // 1. Find nearest cluster centroids
  const topClusters = await centroidHnsw.search(query, { k: options.nprobe })

  // 2. Build partition filter
  const partitionFilter = {
    cluster_id: { in: topClusters.map(c => c.id) },
    ...(options.namespace && { namespace: options.namespace }),
    ...(options.timeRange && {
      month: {
        gte: options.timeRange.start,
        lte: options.timeRange.end
      }
    })
  }

  // 3. Iceberg scan planning with partition pruning
  const scanPlan = await icebergReader.planScan({
    table: 'vectors',
    filter: partitionFilter,
    columns: ['id', 'pq_codes', 'metadata']  // Projection pushdown
  })

  // 4. scanPlan.files now contains only files matching our filters
  // Significantly fewer files than full table scan
  console.log(`Pruned to ${scanPlan.files.length} files from ${scanPlan.totalFiles}`)

  return executeSearch(scanPlan, query, options)
}
```

---

## Part 5: Quantization Deep Dive

### 5.1 Quantization Options Comparison

| Method | Compression | Recall | Speed | Use Case |
|--------|-------------|--------|-------|----------|
| Full FP32 | 1x | 100% | Slow | Re-ranking only |
| FP16 | 2x | ~100% | Medium | Memory constrained |
| BF16 | 2x | ~99% | Medium | Training compatible |
| Scalar INT8 | 4x | ~98% | Fast | Balanced |
| PQ-8x8 | 768x | ~95% | Very Fast | Large scale |
| PQ-8x4 | 1536x | ~90% | Fastest | Extreme scale |
| Binary | 48x | ~85% | Instant | First-pass filter |

### 5.2 Scalar Quantization (SQ)

Simple and effective for moderate compression:

```typescript
interface ScalarQuantization {
  min: Float32Array      // Per-dimension min values
  max: Float32Array      // Per-dimension max values
  // Quantized value = round((x - min) / (max - min) * 255)
}

function quantizeScalar(
  vector: Float32Array,
  params: ScalarQuantization
): Uint8Array {
  const quantized = new Uint8Array(vector.length)
  for (let i = 0; i < vector.length; i++) {
    const normalized = (vector[i] - params.min[i]) / (params.max[i] - params.min[i])
    quantized[i] = Math.round(Math.max(0, Math.min(255, normalized * 255)))
  }
  return quantized
}

// Parquet storage: BYTE_ARRAY with 1536 bytes per vector
// 4x compression from FP32
```

### 5.3 Product Quantization Implementation

```typescript
interface PQConfig {
  M: number              // Number of subspaces (8 or 16 typical)
  Ksub: number           // Centroids per subspace (256 for 8-bit codes)
  dimension: number      // Original vector dimension
}

class ProductQuantizer {
  private config: PQConfig
  private codebooks: Float32Array[]  // M codebooks of shape [Ksub, subDim]

  constructor(config: PQConfig) {
    this.config = config
    this.codebooks = []
  }

  async train(vectors: Float32Array[], iterations: number = 25): Promise<void> {
    const { M, Ksub, dimension } = this.config
    const subDim = dimension / M

    this.codebooks = []

    for (let m = 0; m < M; m++) {
      // Extract subvectors for this subspace
      const subvectors = vectors.map(v => v.slice(m * subDim, (m + 1) * subDim))

      // K-means clustering
      const centroids = await kmeans(subvectors, Ksub, iterations)
      this.codebooks.push(new Float32Array(centroids.flat()))
    }
  }

  encode(vector: Float32Array): Uint8Array {
    const { M, Ksub, dimension } = this.config
    const subDim = dimension / M
    const codes = new Uint8Array(M)

    for (let m = 0; m < M; m++) {
      const subvector = vector.slice(m * subDim, (m + 1) * subDim)
      let minDist = Infinity
      let minIdx = 0

      // Find nearest centroid in this subspace
      for (let k = 0; k < Ksub; k++) {
        const centroid = this.codebooks[m].slice(k * subDim, (k + 1) * subDim)
        const dist = squaredL2(subvector, centroid)
        if (dist < minDist) {
          minDist = dist
          minIdx = k
        }
      }

      codes[m] = minIdx
    }

    return codes
  }

  // Symmetric distance: decode both vectors
  symmetricDistance(codes1: Uint8Array, codes2: Uint8Array): number {
    const { M, dimension } = this.config
    const subDim = dimension / M
    let dist = 0

    for (let m = 0; m < M; m++) {
      const c1 = this.codebooks[m].slice(codes1[m] * subDim, (codes1[m] + 1) * subDim)
      const c2 = this.codebooks[m].slice(codes2[m] * subDim, (codes2[m] + 1) * subDim)
      dist += squaredL2(c1, c2)
    }

    return Math.sqrt(dist)
  }
}
```

### 5.4 PQ Codebook Storage in Parquet

```typescript
// Store codebooks as a separate small Parquet file
interface PQCodebookParquet {
  subspace: number           // 0 to M-1
  centroid_id: number        // 0 to 255
  centroid_vector: Float32Array  // subDim floats
}

// File size for PQ-8x8 with 1536 dimensions:
// 8 subspaces * 256 centroids * 192 floats * 4 bytes = 1.5 MB
// Easily cacheable in Workers memory!
```

---

## Part 6: Query Execution Pipeline

### 6.1 Complete Search Flow

```
┌──────────────────────────────────────────────────────────────┐
│                    QUERY ARRIVES                             │
│  query_vector: Float32Array[1536]                            │
│  options: { k: 100, nprobe: 10, namespace: 'acme.do' }      │
└─────────────────────────────────────────────────────────────┬┘
                                                              │
                                                              ▼
┌──────────────────────────────────────────────────────────────┐
│  STAGE 1: COARSE QUANTIZATION (In-Memory, <1ms)             │
│                                                              │
│  1. Load centroids from DO cache (or R2 if cache miss)      │
│  2. Compute query distances to all K centroids              │
│  3. Select top-nprobe clusters                               │
│                                                              │
│  Output: [cluster_42, cluster_17, cluster_89, ...]          │
└─────────────────────────────────────────────────────────────┬┘
                                                              │
                                                              ▼
┌──────────────────────────────────────────────────────────────┐
│  STAGE 2: ADC TABLE PRECOMPUTATION (<1ms)                   │
│                                                              │
│  1. Load PQ codebook (1.5 MB, cached)                       │
│  2. For each subspace m:                                     │
│     For each centroid k:                                     │
│       adc_table[m][k] = distance(query[m], codebook[m][k])  │
│                                                              │
│  Output: adc_tables[8][256] = 8 KB lookup tables            │
└─────────────────────────────────────────────────────────────┬┘
                                                              │
                                                              ▼
┌──────────────────────────────────────────────────────────────┐
│  STAGE 3: PARALLEL CLUSTER READS (50-100ms)                 │
│                                                              │
│  For each selected cluster (parallel):                       │
│    1. R2 GET cluster_{id}.parquet                           │
│    2. Read only needed columns: id, pq_codes, metadata      │
│    3. Apply partition filter (namespace, time range)         │
│                                                              │
│  Output: candidates[] with PQ codes                         │
└─────────────────────────────────────────────────────────────┬┘
                                                              │
                                                              ▼
┌──────────────────────────────────────────────────────────────┐
│  STAGE 4: ADC SCORING (<10ms for 500K candidates)           │
│                                                              │
│  For each candidate:                                         │
│    distance = sum(adc_table[m][candidate.pq_codes[m]])      │
│                                                              │
│  Sort by distance, keep top-K * oversample_factor           │
│                                                              │
│  Output: top_candidates[1000] with approximate distances    │
└─────────────────────────────────────────────────────────────┬┘
                                                              │
                                                              ▼
┌──────────────────────────────────────────────────────────────┐
│  STAGE 5: RE-RANKING (Optional, 20-50ms)                    │
│                                                              │
│  If high precision required:                                 │
│    1. Fetch full vectors for top-1000 candidates            │
│    2. Compute exact distances                                │
│    3. Re-sort and return top-K                              │
│                                                              │
│  Output: final_results[100] with exact scores               │
└──────────────────────────────────────────────────────────────┘
```

### 6.2 Implementation

```typescript
interface VectorSearchService {
  // Core search
  search(query: Float32Array, options: SearchOptions): Promise<SearchResult[]>

  // Batch search (share centroid computation)
  batchSearch(queries: Float32Array[], options: SearchOptions): Promise<SearchResult[][]>

  // Hybrid search (vector + text)
  hybridSearch(query: Float32Array, text: string, options: HybridOptions): Promise<SearchResult[]>
}

interface SearchOptions {
  k: number              // Number of results
  nprobe: number         // Number of clusters to probe
  rerank: boolean        // Whether to fetch full vectors for re-ranking
  oversample: number     // Factor for re-ranking (e.g., 10x)

  // Filters
  namespace?: string
  timeRange?: { start: Date; end: Date }
  metadata?: Record<string, unknown>
}

class IVFPQSearchService implements VectorSearchService {
  private centroidIndex: CentroidIndex
  private pqCodebook: ProductQuantizer
  private icebergReader: IcebergReader

  constructor(
    private env: Env,
    private config: IVFPQConfig
  ) {}

  async search(query: Float32Array, options: SearchOptions): Promise<SearchResult[]> {
    // Stage 1: Coarse quantization
    const clusters = await this.centroidIndex.findNearestClusters(query, options.nprobe)

    // Stage 2: Precompute ADC tables
    const adcTables = this.pqCodebook.computeADCTables(query)

    // Stage 3: Parallel cluster reads
    const clusterFiles = clusters.map(c => `clusters/cluster_${c.id.toString().padStart(4, '0')}.parquet`)

    const candidates = await Promise.all(
      clusterFiles.map(file => this.readClusterCandidates(file, options))
    ).then(results => results.flat())

    // Stage 4: ADC scoring
    const scored = candidates.map(c => ({
      ...c,
      score: this.computeADCDistance(adcTables, c.pqCodes)
    }))

    scored.sort((a, b) => a.score - b.score)
    const topCandidates = scored.slice(0, options.k * (options.rerank ? options.oversample : 1))

    // Stage 5: Optional re-ranking
    if (options.rerank) {
      return this.rerank(query, topCandidates, options.k)
    }

    return topCandidates.slice(0, options.k).map(c => ({
      id: c.id,
      score: 1 / (1 + c.score),  // Convert distance to similarity
      metadata: c.metadata
    }))
  }

  private async readClusterCandidates(
    file: string,
    options: SearchOptions
  ): Promise<Candidate[]> {
    // Use Iceberg reader for efficient Parquet access
    const records = await this.icebergReader.readParquet(file, {
      columns: ['id', 'pq_codes', 'metadata'],
      filter: this.buildFilter(options)
    })

    return records.map(r => ({
      id: r.id as string,
      pqCodes: new Uint8Array(r.pq_codes as ArrayBuffer),
      metadata: JSON.parse(r.metadata as string)
    }))
  }

  private computeADCDistance(tables: Float32Array[], codes: Uint8Array): number {
    let dist = 0
    for (let m = 0; m < tables.length; m++) {
      dist += tables[m][codes[m]]
    }
    return dist
  }

  private async rerank(
    query: Float32Array,
    candidates: ScoredCandidate[],
    k: number
  ): Promise<SearchResult[]> {
    // Fetch full vectors for top candidates
    const ids = candidates.map(c => c.id)
    const vectors = await this.icebergReader.getVectors(ids)

    // Compute exact distances
    const reranked = candidates.map((c, i) => ({
      ...c,
      exactScore: cosineSimilarity(query, vectors[i])
    }))

    reranked.sort((a, b) => b.exactScore - a.exactScore)

    return reranked.slice(0, k).map(c => ({
      id: c.id,
      score: c.exactScore,
      metadata: c.metadata
    }))
  }
}
```

---

## Part 7: Caching Strategy

### 7.1 Cache Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│  LAYER 1: Workers In-Memory (Per-Request)                   │
│  - ADC lookup tables (8 KB)                                 │
│  - Query results cache (LRU)                                 │
│  TTL: Request duration                                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  LAYER 2: Durable Object Storage                            │
│  - Cluster centroids (60 MB for 10K clusters)               │
│  - PQ codebooks (1.5 MB)                                     │
│  - Hot cluster data (configurable)                           │
│  TTL: Hours to days                                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  LAYER 3: R2 Storage                                         │
│  - All Parquet files                                         │
│  - Full index                                                │
│  TTL: Permanent (versioned via Iceberg)                      │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 Hot Cluster Caching

```typescript
class HotClusterCache {
  private cache: Map<number, CachedCluster> = new Map()
  private maxSize: number
  private accessCounts: Map<number, number> = new Map()

  constructor(maxSizeMB: number = 50) {
    // Reserve ~50MB for hot clusters in DO
    this.maxSize = maxSizeMB * 1024 * 1024
  }

  async getCluster(clusterId: number, env: Env): Promise<ClusterData> {
    // Track access for LFU
    this.accessCounts.set(clusterId, (this.accessCounts.get(clusterId) ?? 0) + 1)

    const cached = this.cache.get(clusterId)
    if (cached && !this.isStale(cached)) {
      return cached.data
    }

    // Load from R2
    const data = await this.loadFromR2(clusterId, env)

    // Cache if frequently accessed
    if (this.shouldCache(clusterId)) {
      this.evictIfNeeded(data.byteSize)
      this.cache.set(clusterId, {
        data,
        loadedAt: Date.now(),
        accessCount: this.accessCounts.get(clusterId)!
      })
    }

    return data
  }

  private shouldCache(clusterId: number): boolean {
    // Cache clusters accessed more than 10 times in recent window
    return (this.accessCounts.get(clusterId) ?? 0) > 10
  }

  private evictIfNeeded(newSize: number): void {
    let currentSize = this.getCurrentSize()

    while (currentSize + newSize > this.maxSize && this.cache.size > 0) {
      // Evict least frequently used
      const lfu = this.findLFU()
      this.cache.delete(lfu)
      currentSize = this.getCurrentSize()
    }
  }
}
```

### 7.3 Centroid Index Caching in DO

```typescript
class CentroidIndexDO extends DurableObject {
  private centroids: Float32Array | null = null
  private centroidIndex: HNSWGraph | null = null
  private pqCodebook: ProductQuantizer | null = null

  async initialize(): Promise<void> {
    // Load from R2 on first access, then cache in DO storage
    const stored = await this.state.storage.get<ArrayBuffer>('centroids')

    if (stored) {
      this.centroids = new Float32Array(stored)
    } else {
      // Load from R2
      const r2Object = await this.env.R2.get('centroids/centroids.bin')
      const buffer = await r2Object!.arrayBuffer()
      this.centroids = new Float32Array(buffer)

      // Persist to DO storage for faster subsequent loads
      await this.state.storage.put('centroids', buffer)
    }

    // Build in-memory HNSW for fast centroid search
    this.centroidIndex = await buildHNSW(this.centroids, {
      M: 16,
      efConstruction: 100
    })
  }

  async findNearestClusters(query: Float32Array, k: number): Promise<ClusterMatch[]> {
    if (!this.centroidIndex) {
      await this.initialize()
    }

    return this.centroidIndex!.search(query, { k, ef: k * 2 })
  }
}
```

---

## Part 8: Index Building Pipeline

### 8.1 Offline Training

```typescript
interface TrainingPipeline {
  // Step 1: Sample vectors for training
  sampleVectors(source: string, sampleSize: number): Promise<Float32Array[]>

  // Step 2: Train IVF centroids (K-means)
  trainCentroids(vectors: Float32Array[], K: number): Promise<Float32Array>

  // Step 3: Train PQ codebooks
  trainPQ(vectors: Float32Array[], residuals: boolean): Promise<PQCodebook>

  // Step 4: Encode and partition vectors
  encodeAndPartition(source: string, centroids: Float32Array, pq: PQCodebook): Promise<void>
}

class OfflineTrainer implements TrainingPipeline {
  async trainCentroids(vectors: Float32Array[], K: number): Promise<Float32Array> {
    console.log(`Training ${K} centroids from ${vectors.length} vectors...`)

    // Use k-means++ initialization
    const centroids = kmeanspp(vectors, K, {
      maxIterations: 50,
      tolerance: 1e-4
    })

    // Save centroids
    await this.env.R2.put('centroids/centroids.bin', centroids.buffer)

    // Also save as Parquet for inspection
    await this.saveCentroidsParquet(centroids, K)

    return centroids
  }

  async trainPQ(vectors: Float32Array[], useResiduals: boolean): Promise<PQCodebook> {
    const trainingVectors = useResiduals
      ? await this.computeResiduals(vectors)
      : vectors

    const pq = new ProductQuantizer({ M: 8, Ksub: 256, dimension: 1536 })
    await pq.train(trainingVectors, 25)

    // Save codebook
    await this.savePQCodebook(pq)

    return pq.getCodebook()
  }

  async encodeAndPartition(
    source: string,
    centroids: Float32Array,
    pq: PQCodebook
  ): Promise<void> {
    // Stream through source vectors
    const reader = await this.createStreamReader(source)
    const writers = new Map<number, ParquetWriter>()

    for await (const batch of reader.batches(10000)) {
      for (const vector of batch) {
        // Assign to cluster
        const clusterId = this.findNearestCentroid(vector.embedding, centroids)

        // Compute residual and encode
        const residual = subtractVectors(vector.embedding, centroids.slice(clusterId * 1536, (clusterId + 1) * 1536))
        const pqCodes = pq.encode(residual)

        // Write to cluster file
        const writer = await this.getOrCreateWriter(writers, clusterId)
        await writer.write({
          id: vector.id,
          pq_codes: pqCodes,
          metadata: vector.metadata,
          cluster_id: clusterId
        })
      }
    }

    // Finalize all Parquet files
    for (const writer of writers.values()) {
      await writer.close()
    }

    // Upload to R2
    await this.uploadClusterFiles(writers)
  }
}
```

### 8.2 Incremental Index Updates

```typescript
class IncrementalIndexer {
  private pendingVectors: VectorEntry[] = []
  private readonly BATCH_THRESHOLD = 10000

  async addVector(entry: VectorEntry): Promise<void> {
    this.pendingVectors.push(entry)

    if (this.pendingVectors.length >= this.BATCH_THRESHOLD) {
      await this.flushBatch()
    }
  }

  async flushBatch(): Promise<void> {
    const batch = this.pendingVectors
    this.pendingVectors = []

    // Group by cluster
    const clusterGroups = new Map<number, VectorEntry[]>()

    for (const entry of batch) {
      const clusterId = await this.assignCluster(entry.vector)

      if (!clusterGroups.has(clusterId)) {
        clusterGroups.set(clusterId, [])
      }
      clusterGroups.get(clusterId)!.push(entry)
    }

    // Append to each cluster's delta file
    for (const [clusterId, entries] of clusterGroups) {
      await this.appendToDelta(clusterId, entries)
    }

    // Optionally trigger compaction if deltas are large
    await this.maybeCompact()
  }

  private async appendToDelta(clusterId: number, entries: VectorEntry[]): Promise<void> {
    const deltaPath = `clusters/cluster_${clusterId.toString().padStart(4, '0')}_delta.parquet`

    // Read existing delta or create new
    let existing: any[] = []
    try {
      existing = await this.readParquet(deltaPath)
    } catch {
      // No existing delta
    }

    // Append and write back
    const combined = [...existing, ...entries.map(e => this.encodeEntry(e))]
    await this.writeParquet(deltaPath, combined)

    // Update Iceberg manifest
    await this.updateManifest(clusterId, deltaPath)
  }

  private async maybeCompact(): Promise<void> {
    // Check delta sizes and merge into main cluster files if needed
    const deltaStats = await this.getDeltaStats()

    for (const [clusterId, stats] of deltaStats) {
      if (stats.rowCount > 50000 || stats.fileCount > 10) {
        await this.compactCluster(clusterId)
      }
    }
  }
}
```

---

## Part 9: Recall Optimization

### 9.1 Multi-Probe IVF

Standard IVF probes only the single nearest cluster. Multi-probe improves recall:

```typescript
interface MultiProbeConfig {
  nprobe: number          // Number of clusters to probe
  probeStrategy: 'nearest' | 'residual' | 'tree'
}

class MultiProbeIVF {
  async selectProbes(
    query: Float32Array,
    centroids: Float32Array,
    nprobe: number
  ): Promise<ProbeResult[]> {
    // Compute distances to all centroids
    const distances: Array<{ id: number; dist: number }> = []

    for (let i = 0; i < this.K; i++) {
      const centroid = centroids.slice(i * this.dim, (i + 1) * this.dim)
      const dist = squaredL2Distance(query, centroid)
      distances.push({ id: i, dist })
    }

    // Sort by distance
    distances.sort((a, b) => a.dist - b.dist)

    // Return top nprobe
    return distances.slice(0, nprobe).map(d => ({
      clusterId: d.id,
      distance: Math.sqrt(d.dist),
      estimatedCandidates: this.clusterSizes.get(d.id) ?? 0
    }))
  }
}
```

### 9.2 Recall vs Latency Tradeoff

| nprobe | Recall@100 | Latency (p50) | R2 Reads |
|--------|------------|---------------|----------|
| 1 | 65% | 80ms | 1 |
| 5 | 85% | 120ms | 5 |
| 10 | 92% | 150ms | 10 |
| 20 | 96% | 200ms | 20 |
| 50 | 99% | 350ms | 50 |

**Recommendation**: Use nprobe=10-20 for 95%+ recall within 200ms budget.

### 9.3 OPQ (Optimized Product Quantization)

Standard PQ assigns equal importance to all dimensions. OPQ rotates the space first:

```typescript
class OptimizedPQ extends ProductQuantizer {
  private rotationMatrix: Float32Array  // D x D orthogonal matrix

  async train(vectors: Float32Array[], iterations: number): Promise<void> {
    // Step 1: Learn rotation matrix that minimizes PQ error
    this.rotationMatrix = await this.learnRotation(vectors)

    // Step 2: Rotate all training vectors
    const rotated = vectors.map(v => this.rotate(v))

    // Step 3: Train standard PQ on rotated vectors
    await super.train(rotated, iterations)
  }

  encode(vector: Float32Array): Uint8Array {
    const rotated = this.rotate(vector)
    return super.encode(rotated)
  }

  private rotate(vector: Float32Array): Float32Array {
    // Matrix-vector multiplication: R * v
    const result = new Float32Array(vector.length)
    for (let i = 0; i < vector.length; i++) {
      for (let j = 0; j < vector.length; j++) {
        result[i] += this.rotationMatrix[i * vector.length + j] * vector[j]
      }
    }
    return result
  }
}
```

OPQ typically improves recall by 2-5% at the same compression ratio.

---

## Part 10: File Layout Recommendations

### 10.1 Directory Structure

```
warehouse/
├── vectors/
│   ├── centroids/
│   │   ├── centroids.bin           # Raw float32 centroids (60 MB)
│   │   ├── centroids.parquet       # Parquet format for inspection
│   │   └── hnsw_graph.bin          # Centroid HNSW structure (optional)
│   │
│   ├── codebooks/
│   │   ├── pq_codebook.bin         # PQ codebooks (1.5 MB)
│   │   └── opq_rotation.bin        # OPQ rotation matrix (optional)
│   │
│   ├── clusters/
│   │   ├── cluster_0000.parquet    # ~50K vectors per cluster
│   │   ├── cluster_0000_delta.parquet  # Incremental updates
│   │   ├── cluster_0001.parquet
│   │   ├── ...
│   │   └── cluster_9999.parquet
│   │
│   └── metadata/
│       └── iceberg/
│           ├── version-hint.text
│           ├── v1.metadata.json
│           ├── v2.metadata.json
│           └── manifests/
│               ├── manifest-list-v1.avro
│               └── manifest-0001.avro
│
└── source/                          # Optional: original vectors
    └── raw_vectors.parquet
```

### 10.2 Parquet File Configuration

```typescript
const PARQUET_CONFIG = {
  // Compression
  compression: 'ZSTD',
  compressionLevel: 3,

  // Row groups
  rowGroupSize: 10000,  // 10K vectors per row group
  // For 1536d PQ-8: 10K * ~200 bytes = 2 MB per row group

  // Column encoding
  columnConfig: {
    id: { encoding: 'PLAIN', dictionary: false },
    pq_codes: { encoding: 'PLAIN' },  // Already compressed
    metadata: { encoding: 'PLAIN', dictionary: true },
    cluster_id: { encoding: 'PLAIN', dictionary: true }
  },

  // Statistics
  statisticsEnabled: true,  // For partition pruning
  bloomFilterColumns: ['id']  // For point lookups
}
```

### 10.3 Optimal File Sizes

| Metric | Target | Reasoning |
|--------|--------|-----------|
| Cluster file size | 5-20 MB | Single R2 GET, full parallelism |
| Vectors per cluster | 30K-100K | Balance between files and fan-out |
| Row group size | 5K-20K | Efficient predicate pushdown |
| Total clusters (K) | 5K-20K | sqrt(N) rule for IVF |

For 500M vectors:
- K = sqrt(500M) ~= 22K clusters
- ~22K vectors per cluster average
- ~5 MB per cluster file
- Total cluster storage: ~110 GB

---

## Part 11: Latency Breakdown Analysis

### 11.1 Theoretical Minimum

```
Stage 1 (Centroid search):     1 ms  (in-memory HNSW)
Stage 2 (ADC precompute):      0.5 ms
Stage 3 (R2 reads, parallel):  50 ms  (10 files, ~5 MB each)
Stage 4 (ADC scoring):         5 ms   (500K candidates)
Stage 5 (Re-rank, optional):   30 ms  (fetch 100 full vectors)
──────────────────────────────────────
Total (without re-rank):       ~57 ms
Total (with re-rank):          ~87 ms
```

### 11.2 Realistic Estimates (p50/p99)

| Stage | p50 | p99 | Notes |
|-------|-----|-----|-------|
| Centroid DO call | 5ms | 15ms | Service binding RPC |
| Centroid search | 1ms | 2ms | In-memory HNSW |
| ADC precompute | 0.5ms | 1ms | CPU bound |
| R2 parallel reads | 60ms | 150ms | Network variance |
| ADC scoring | 10ms | 30ms | Scales with candidates |
| Re-ranking | 40ms | 100ms | Additional R2 reads |
| **Total** | **~120ms** | **~300ms** | Meets target! |

### 11.3 Optimization Opportunities

1. **Centroid Caching**: Keep centroids in DO memory, eliminate R2 call
2. **Speculative Probing**: Start R2 reads before centroid search completes
3. **Column Pruning**: Only read `pq_codes` column, skip metadata until final results
4. **Result Caching**: Cache frequent query results in DO

---

## Part 12: Implementation Roadmap

### Phase 1: Foundation (Week 1-2)

- [ ] Implement ProductQuantizer class with PQ-8x8
- [ ] Create CentroidIndexDO with in-memory search
- [ ] Parquet writer with ZSTD compression
- [ ] Basic IVF-PQ search pipeline

### Phase 2: Index Building (Week 3-4)

- [ ] Offline k-means training for centroids
- [ ] PQ codebook training
- [ ] Batch encoding and partitioning pipeline
- [ ] Iceberg metadata generation

### Phase 3: Query Optimization (Week 5-6)

- [ ] Multi-probe IVF implementation
- [ ] ADC table optimization
- [ ] Parallel R2 reads with fan-out control
- [ ] Re-ranking with full vectors

### Phase 4: Caching & Scaling (Week 7-8)

- [ ] Hot cluster caching in DO
- [ ] Query result caching
- [ ] Incremental index updates
- [ ] Index compaction

### Phase 5: Advanced (Week 9+)

- [ ] OPQ (Optimized Product Quantization)
- [ ] Hybrid search (vector + keyword)
- [ ] Index sharding for multi-tenant
- [ ] Recall benchmarking suite

---

## Appendix A: Cost Analysis

### Storage Costs (Monthly)

| Component | Size | Cost |
|-----------|------|------|
| PQ-encoded vectors (500M) | 96 GB | $1.44 |
| Full vectors (for re-rank) | 500 GB | $7.50 |
| Centroids + codebooks | 100 MB | $0.01 |
| Iceberg metadata | 1 GB | $0.02 |
| **Total** | ~600 GB | **~$9/month** |

### Query Costs (per 1M queries)

| Operation | Count | Unit Cost | Total |
|-----------|-------|-----------|-------|
| Worker invocations | 1M | $0.50/M | $0.50 |
| DO invocations | 1M | $0.15/M | $0.15 |
| R2 Class B (reads) | 10M | $0.36/M | $3.60 |
| DO storage reads | 2M | $0.20/M | $0.40 |
| **Total per 1M queries** | | | **~$4.65** |

### Comparison with Managed Solutions

| Solution | Storage (500M vectors) | 1M Queries | Total Monthly |
|----------|------------------------|------------|---------------|
| **This approach** | $9 | $4.65 | **~$15** |
| Pinecone (s1.x1) | ~$140 | included | ~$140 |
| Weaviate Cloud | ~$200 | included | ~$200 |
| Qdrant Cloud | ~$100 | included | ~$100 |

**10x cost reduction** for read-heavy workloads.

---

## Appendix B: Recall Benchmarks

Expected recall@100 for different configurations (based on SIFT1M benchmarks):

| Configuration | Recall@100 | nprobe | Notes |
|---------------|------------|--------|-------|
| IVF-Flat, K=10K | 98% | 20 | Baseline |
| IVF-PQ8x8, K=10K | 92% | 20 | 8-bit codes |
| IVF-PQ8x8+OPQ, K=10K | 95% | 20 | With rotation |
| IVF-PQ8x8+OPQ+Rerank | 97% | 20 | Top-1000 rerank |
| IVF-PQ8x8+OPQ+Rerank | 99% | 50 | Higher probe |

**Recommendation**: Use IVF-PQ8x8 with OPQ and reranking for optimal recall/latency tradeoff.

---

## Appendix C: References

1. Jegou, H., et al. "Product quantization for nearest neighbor search." IEEE TPAMI, 2011.
2. Malkov, Y. & Yashunin, D. "Efficient and robust approximate nearest neighbor search using HNSW graphs." IEEE TPAMI, 2018.
3. Ge, T., et al. "Optimized product quantization." IEEE TPAMI, 2014.
4. Johnson, J., et al. "Billion-scale similarity search with GPUs." IEEE TBD, 2017.
5. FAISS documentation: https://github.com/facebookresearch/faiss/wiki
6. Apache Iceberg Spec: https://iceberg.apache.org/spec/
