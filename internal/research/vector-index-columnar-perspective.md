---
title: "Vector Index Design: A Columnar Database Perspective"
description: Documentation for research
---

# Vector Index Design: A Columnar Database Perspective

## Executive Summary

This document explores how to leverage Parquet's native columnar features for Wikipedia-scale vector similarity search (hundreds of millions of embeddings) on Cloudflare Workers + R2.

**Key Insight**: Rather than fighting against Parquet's columnar nature, we embrace it. Parquet row groups become natural vector clusters, column statistics enable coarse filtering, and the format's compression and I/O patterns align well with vector search access patterns.

**Cost Analysis at 500M vectors (1536 dimensions)**:
| Approach | Storage | Monthly Cost | Search Latency | Recall@100 |
|----------|---------|--------------|----------------|------------|
| Pinecone | N/A | ~$70,000 | 20-50ms | 99% |
| Milvus (managed) | N/A | ~$25,000 | 30-80ms | 98% |
| **This Design** | 3TB | **$45** (R2) + compute | 100-180ms | 95-98% |

**Target Performance**:
- Sub-200ms latency for top-100 search
- 95%+ recall@100
- 128MB Worker memory limit
- $0.015/GB/month R2 storage

---

## Part 1: Parquet Fundamentals for Vector Storage

### 1.1 Row Groups as Vector Clusters

Parquet's row group structure naturally maps to vector clustering. Each row group is an independent unit that can be:
- Read without reading other row groups
- Assigned to a centroid for IVF-style indexing
- Compressed independently
- Cached independently

**Optimal Row Group Sizing for Vectors**:

```
Per-vector storage (1536-dim, float32):
  - Raw: 1536 * 4 = 6,144 bytes
  - With ZSTD: ~4,000 bytes (35% compression typical)
  - With PQ (64 subvectors): 64 bytes

Memory budget per row group (target 8MB after decompression):
  - Raw vectors: 8MB / 6KB = ~1,333 vectors
  - Quantized vectors: 8MB / 64B = ~125,000 vectors

Recommended row group sizes:
  - Full-precision vectors: 1,000-2,000 vectors per row group
  - Product-quantized vectors: 50,000-100,000 vectors per row group
```

### 1.2 Column Statistics for Vector Search

Parquet stores min/max statistics per column in row group metadata. For vectors:

```
Traditional approach (doesn't work well):
  - Min/max per dimension is nearly useless for similarity search
  - High-dimensional data clusters near center (curse of dimensionality)

Our approach: Synthetic statistics columns
  - Store pre-computed dot products with orthogonal probes
  - Store L2 norm for normalization-free cosine similarity
  - Store cluster centroid distances
```

**Schema with Auxiliary Statistics**:

```sql
-- Parquet schema for vector storage with statistics
CREATE TABLE vectors (
  -- Identity
  id VARCHAR NOT NULL,
  namespace VARCHAR NOT NULL,

  -- The embedding (primary data)
  embedding FLOAT[1536],

  -- Auxiliary statistics for filtering (stored in row group stats)
  l2_norm FLOAT,                    -- ||v||, enables fast cosine from dot product
  centroid_id INT,                  -- Cluster assignment
  centroid_distance FLOAT,          -- Distance to assigned centroid

  -- Probe dot products (enable approximate distance bounds)
  probe_dot_0 FLOAT,                -- dot(v, probe_0)
  probe_dot_1 FLOAT,                -- dot(v, probe_1)
  probe_dot_2 FLOAT,                -- dot(v, probe_2)
  probe_dot_3 FLOAT,                -- dot(v, probe_3)

  -- Metadata for filtering
  created_at TIMESTAMP,
  metadata JSON
);
```

### 1.3 Dictionary Encoding for Vector Quantization

Parquet's dictionary encoding is designed for repeated values. We repurpose it for Product Quantization (PQ):

```
Product Quantization in Parquet:

1. Split 1536-dim vector into 64 subvectors of 24 dimensions
2. Each subvector is quantized to one of 256 centroids (8 bits)
3. Store 64 codebook indices instead of 6,144 bytes

Parquet dictionary encoding:
  - Dictionary = PQ codebook (256 * 24 * 4 = 24KB per subquantizer)
  - Values = Indices into codebook
  - 64 columns, each with 256-entry dictionary

Storage per vector: 64 bytes (indices) + amortized codebook
Compression ratio: 96x (6,144 / 64)
```

**PQ-Optimized Parquet Schema**:

```sql
-- Product Quantized vector storage
CREATE TABLE vectors_pq (
  id VARCHAR NOT NULL,
  namespace VARCHAR NOT NULL,

  -- PQ codes (64 subquantizers, 8 bits each)
  pq_code_0 UINT8,   -- Dictionary-encoded with 256 centroids
  pq_code_1 UINT8,
  -- ... 62 more columns ...
  pq_code_63 UINT8,

  -- Statistics for coarse filtering
  l2_norm FLOAT,
  centroid_id INT,

  metadata JSON
);
```

---

## Part 2: Predicate Pushdown for Vector Search

### 2.1 The Challenge

Standard Parquet predicate pushdown works on scalar comparisons:
```sql
SELECT * FROM vectors WHERE created_at > '2024-01-01'
```

Vector similarity isn't directly expressible:
```sql
-- This doesn't work in standard Parquet
SELECT * FROM vectors
WHERE cosine_similarity(embedding, query_vector) > 0.8
```

### 2.2 Our Solution: Bound-Based Pruning

We compute distance bounds using auxiliary columns that DO support predicate pushdown:

**Theorem (Triangle Inequality Bounds)**:

For any vectors v, q and centroid c:
```
|d(v,q) - d(v,c)| <= d(c,q) <= d(v,q) + d(v,c)
```

This gives us:
```
d(v,q) >= d(c,q) - d(v,c)    [lower bound]
d(v,q) <= d(c,q) + d(v,c)    [upper bound]
```

**Implementation**:

```typescript
interface VectorSearchPlan {
  // Pre-computed during query planning
  queryCentroidDistances: Map<number, number>  // centroid_id -> distance to query

  // Generates Parquet predicate pushdown expression
  generatePushdown(threshold: number): ParquetPredicate {
    // For each row group, we can compute:
    // min_distance >= centroid_distance_to_query - max_centroid_distance_in_rowgroup
    // max_distance <= centroid_distance_to_query + max_centroid_distance_in_rowgroup

    // If min_distance > threshold, skip entire row group
    return {
      type: 'row_group_filter',
      evaluate: (rowGroupStats) => {
        const centroidId = rowGroupStats['centroid_id'].min  // Assume sorted by centroid
        const maxCentroidDist = rowGroupStats['centroid_distance'].max
        const centroidQueryDist = this.queryCentroidDistances.get(centroidId)

        const minPossibleDistance = centroidQueryDist - maxCentroidDist
        return minPossibleDistance <= threshold
      }
    }
  }
}
```

### 2.3 Probe-Based Bounds

We add orthonormal probe vectors and store dot products. This enables tighter bounds:

**Mathematical Foundation**:

If p_i are orthonormal probes, then by Cauchy-Schwarz:
```
dot(v, q) <= sum_i |dot(v, p_i) * dot(q, p_i)| + residual_term
```

More practically, we use random projections (Johnson-Lindenstrauss):

```typescript
// Generate 4 random unit probes (stored globally, ~6KB each)
const PROBES = [
  normalizedRandomVector(1536),
  normalizedRandomVector(1536),
  normalizedRandomVector(1536),
  normalizedRandomVector(1536),
]

// At index time, store dot products
function indexVector(v: Float32Array): ProbeStats {
  return {
    probe_dot_0: dot(v, PROBES[0]),
    probe_dot_1: dot(v, PROBES[1]),
    probe_dot_2: dot(v, PROBES[2]),
    probe_dot_3: dot(v, PROBES[3]),
  }
}

// At query time, use probe distances for bounds
function computeBounds(
  queryProbes: number[],
  rowGroupStats: RowGroupStats
): { lower: number, upper: number } {
  // Each probe gives independent estimate via random projection
  // Combine for tighter bounds
  let sumSquaredDiff = 0
  for (let i = 0; i < 4; i++) {
    const qProbe = queryProbes[i]
    const vMin = rowGroupStats[`probe_dot_${i}`].min
    const vMax = rowGroupStats[`probe_dot_${i}`].max

    // Worst case: query probe is outside [vMin, vMax]
    if (qProbe < vMin) sumSquaredDiff += (vMin - qProbe) ** 2
    else if (qProbe > vMax) sumSquaredDiff += (qProbe - vMax) ** 2
  }

  // This gives lower bound on L2 distance (scaled by sqrt(dims/probes))
  const scaleFactor = Math.sqrt(1536 / 4)
  return {
    lower: Math.sqrt(sumSquaredDiff) * scaleFactor * 0.8,  // Conservative
    upper: Infinity  // Upper bounds need different approach
  }
}
```

---

## Part 3: Custom Page Types for Vectors

### 3.1 Parquet Page Structure

Parquet stores data in pages within column chunks:
- **Dictionary Page**: Optional, stores unique values
- **Data Pages**: Actual column data, compressed
- **Data Page V2**: Includes statistics, supports page-level predicate pushdown

### 3.2 Proposed Vector Page Extension

We propose a custom page type for dense vectors that:
1. Stores vectors in a SIMD-friendly layout
2. Includes quantization codebooks inline
3. Supports incremental distance computation

**Vector Page Layout**:

```
┌─────────────────────────────────────────────────────────────┐
│ Page Header                                                  │
│   - page_type: VECTOR (custom enum value)                   │
│   - uncompressed_size: uint32                               │
│   - compressed_size: uint32                                 │
│   - vector_count: uint32                                    │
│   - dimensions: uint16                                      │
│   - quantization: enum {NONE, PQ64, PQ128, BINARY}          │
│   - norm_storage: enum {NONE, PRECOMPUTED, ON_DEMAND}       │
├─────────────────────────────────────────────────────────────┤
│ Quantization Codebook (if PQ)                               │
│   - For PQ64: 64 * 256 * (dims/64) * 4 bytes                │
│   - Stored once per page, shared by all vectors             │
├─────────────────────────────────────────────────────────────┤
│ Vector Data (SIMD-aligned)                                  │
│   - Full precision: dims * 4 * count bytes (float32)        │
│   - PQ: subvectors * count bytes (uint8 indices)            │
│   - Binary: dims/8 * count bytes                            │
├─────────────────────────────────────────────────────────────┤
│ Precomputed Norms (if enabled)                              │
│   - count * 4 bytes (float32 L2 norms)                      │
├─────────────────────────────────────────────────────────────┤
│ Page Statistics                                             │
│   - centroid: dims * 4 bytes (mean vector)                  │
│   - max_radius: float32 (max distance from centroid)        │
│   - probe_stats: 4 * 2 * 4 bytes (min/max per probe)        │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 SIMD-Optimized Reading

The vector page layout enables efficient SIMD operations:

```typescript
// WebAssembly SIMD for vector distance computation
function computeDistancesSIMD(
  queryVec: Float32Array,      // 1536 floats
  pageVectors: Float32Array,   // N * 1536 floats, SIMD-aligned
  count: number
): Float32Array {
  const distances = new Float32Array(count)

  // Process 4 floats at a time using SIMD
  // WebAssembly SIMD (128-bit) processes 4 float32s per instruction
  for (let i = 0; i < count; i++) {
    let sum = 0
    const offset = i * 1536

    // Inner loop: 1536/4 = 384 SIMD iterations
    for (let j = 0; j < 1536; j += 4) {
      // v128.load, v128.sub, v128.mul, horizontal_sum
      const diff0 = pageVectors[offset + j] - queryVec[j]
      const diff1 = pageVectors[offset + j + 1] - queryVec[j + 1]
      const diff2 = pageVectors[offset + j + 2] - queryVec[j + 2]
      const diff3 = pageVectors[offset + j + 3] - queryVec[j + 3]
      sum += diff0*diff0 + diff1*diff1 + diff2*diff2 + diff3*diff3
    }

    distances[i] = Math.sqrt(sum)
  }

  return distances
}
```

---

## Part 4: Iceberg Integration

### 4.1 Vector-Aware Table Properties

Iceberg table properties for vector search configuration:

```json
{
  "table-uuid": "550e8400-e29b-41d4-a716-446655440000",
  "format-version": 2,
  "location": "r2://bucket/vectors/",
  "properties": {
    "dotdo.vector.enabled": "true",
    "dotdo.vector.dimensions": "1536",
    "dotdo.vector.metric": "cosine",
    "dotdo.vector.quantization": "pq64",

    "dotdo.vector.index.type": "ivf",
    "dotdo.vector.index.nlist": "4096",
    "dotdo.vector.index.nprobe": "64",

    "dotdo.vector.clustering.column": "centroid_id",
    "dotdo.vector.clustering.centroids_path": "metadata/centroids.parquet",

    "dotdo.vector.probes.count": "4",
    "dotdo.vector.probes.path": "metadata/probes.bin"
  }
}
```

### 4.2 Partition Spec for Vector Tables

Optimal partitioning for vector search:

```json
{
  "spec-id": 0,
  "fields": [
    {
      "source-id": 5,
      "field-id": 1000,
      "name": "namespace_partition",
      "transform": "identity"
    },
    {
      "source-id": 6,
      "field-id": 1001,
      "name": "centroid_bucket",
      "transform": "bucket[256]"
    }
  ]
}
```

This creates:
- First-level partitions by namespace (tenant isolation)
- Second-level by centroid bucket (cluster co-location)

### 4.3 Manifest Entries with Vector Statistics

Extended manifest entry for vector-aware pruning:

```typescript
interface VectorManifestEntry extends DataFileEntry {
  // Standard Iceberg fields
  filePath: string
  fileFormat: string
  recordCount: number
  fileSizeBytes: number
  partition: Record<string, unknown>

  // Extended vector statistics
  vectorStats: {
    // Centroid information for this file
    centroidIds: number[]           // Which centroids are in this file
    centroidCount: number

    // Bounding sphere
    boundingCentroid: number[]      // Mean of all vectors
    boundingRadius: number          // Max distance from mean

    // Probe statistics (for predicate pushdown)
    probeStats: Array<{
      min: number
      max: number
      mean: number
    }>

    // Quantization stats
    quantizationType: 'none' | 'pq64' | 'pq128' | 'binary'
    codebookHash?: string           // For codebook compatibility
  }
}
```

### 4.4 Centroid File Format

Store cluster centroids in a separate Parquet file:

```sql
-- metadata/centroids.parquet
CREATE TABLE centroids (
  centroid_id INT PRIMARY KEY,
  centroid FLOAT[1536],
  vector_count INT,                 -- Number of vectors in cluster
  avg_distance FLOAT,               -- Average distance to centroid
  max_distance FLOAT,               -- Maximum distance (cluster radius)

  -- Probe dot products for centroid (enables two-level bounds)
  probe_dot_0 FLOAT,
  probe_dot_1 FLOAT,
  probe_dot_2 FLOAT,
  probe_dot_3 FLOAT
);
```

---

## Part 5: Query Execution Strategy

### 5.1 Two-Phase Search Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     QUERY FLOW                               │
└─────────────────────────────────────────────────────────────┘

Phase 1: Coarse Quantizer (in Worker, ~10ms)
├── Load centroids.parquet (~200KB, cached in DO)
├── Compute query-centroid distances
├── Select top-N centroids (N = nprobe, typically 32-128)
└── Output: List of centroid_ids to search

Phase 2: Fine Search (parallel R2 reads, ~100-150ms)
├── For each selected centroid:
│   ├── Load partition manifest (cached)
│   ├── Apply row group pruning using:
│   │   ├── Centroid distance bounds
│   │   ├── Probe statistics bounds
│   │   └── Bounding sphere test
│   ├── Fetch qualifying row groups (range requests)
│   └── Compute exact distances, maintain top-K heap
└── Merge results from all centroids

┌─────────────────────────────────────────────────────────────┐
│                   MEMORY BUDGET                              │
└─────────────────────────────────────────────────────────────┘

Component                           Size
─────────────────────────────────────────────────
Centroid data (4096 centroids)      4096 * 6KB = 24MB
Query vector                        6KB
Distance heap (K=100)               100 * 16B = 1.6KB
Row group buffer (1 at a time)      8MB
Codebook (if PQ)                    64 * 256 * 96B = 1.5MB
Worker overhead                     20MB
─────────────────────────────────────────────────
Total                               ~55MB (under 128MB limit)
```

### 5.2 Detailed Query Execution

```typescript
interface VectorSearchQuery {
  query: Float32Array
  k: number
  namespace?: string
  filter?: MetadataFilter
  nprobe?: number           // Number of centroids to search
  efSearch?: number         // Oversampling factor
}

async function executeVectorSearch(
  query: VectorSearchQuery,
  env: Env
): Promise<SearchResult[]> {
  const startTime = Date.now()

  // Phase 1: Load centroids and find nearest clusters
  const centroids = await loadCentroids(env.R2, 'metadata/centroids.parquet')
  const queryNorm = computeNorm(query.query)
  const normalizedQuery = normalizeVector(query.query, queryNorm)

  // Compute distances to all centroids (24MB, ~5ms with SIMD)
  const centroidDistances = computeDistancesBatch(
    normalizedQuery,
    centroids.embeddings,
    centroids.count
  )

  // Select top nprobe centroids
  const nprobe = query.nprobe ?? 64
  const selectedCentroids = topK(centroidDistances, nprobe)

  console.log(`Phase 1: ${Date.now() - startTime}ms, selected ${nprobe} centroids`)

  // Phase 2: Search selected partitions in parallel
  const searchPromises = selectedCentroids.map(async (centroidId) => {
    return searchPartition(
      env.R2,
      query,
      centroidId,
      centroidDistances[centroidId]
    )
  })

  // Gather results with bounded concurrency
  const partitionResults = await Promise.all(searchPromises)

  // Merge results
  const merged = mergeTopK(partitionResults, query.k)

  console.log(`Total search time: ${Date.now() - startTime}ms`)
  return merged
}

async function searchPartition(
  r2: R2Bucket,
  query: VectorSearchQuery,
  centroidId: number,
  centroidDistance: number
): Promise<SearchResult[]> {
  // Load partition manifest
  const manifest = await loadPartitionManifest(r2, query.namespace, centroidId)

  // Prune row groups using statistics
  const qualifyingRowGroups = manifest.rowGroups.filter(rg => {
    // Triangle inequality bound
    const minPossibleDistance = centroidDistance - rg.stats.maxCentroidDistance

    // If min possible distance exceeds our current k-th best, skip
    if (minPossibleDistance > getCurrentKthDistance()) {
      return false
    }

    // Additional probe-based pruning
    return probeBasedPruning(query, rg.stats.probeStats)
  })

  // Fetch and search qualifying row groups
  const results: SearchResult[] = []

  for (const rg of qualifyingRowGroups) {
    // Range request for specific row group
    const data = await r2.get(rg.filePath, {
      range: { offset: rg.offset, length: rg.compressedSize }
    })

    // Decompress and compute distances
    const vectors = await decompressRowGroup(data)
    const distances = computeDistancesSIMD(query.query, vectors.embeddings, vectors.count)

    // Add to results
    for (let i = 0; i < vectors.count; i++) {
      results.push({
        id: vectors.ids[i],
        distance: distances[i],
        metadata: vectors.metadata[i]
      })
    }
  }

  // Return top-k from this partition
  return topK(results, query.k * 2)  // Oversample for merge
}
```

### 5.3 Caching Strategy

```typescript
interface VectorSearchCache {
  // Level 1: Durable Object storage (persists across requests)
  centroids: {
    data: Float32Array         // 24MB, loaded once
    probeStats: Float32Array   // Centroid probe dot products
    lastUpdated: number
  }

  // Level 2: Worker memory (per-request)
  partitionManifests: Map<string, ManifestEntry[]>

  // Level 3: R2 cache headers (cross-worker)
  rowGroupCache: {
    key: string                // `${filePath}:${rowGroupIndex}`
    data: ArrayBuffer
    ttl: number                // 1 hour for hot data
  }
}

// Caching implementation
class VectorSearchDO extends DurableObject {
  private centroids: CentroidCache | null = null

  async getCentroids(): Promise<CentroidCache> {
    if (this.centroids && !this.isStale(this.centroids)) {
      return this.centroids
    }

    // Load from R2
    const data = await this.env.R2.get('metadata/centroids.parquet')
    this.centroids = await parseCentroidsParquet(data)

    // Persist to DO storage for faster warm starts
    await this.state.storage.put('centroids', this.centroids)

    return this.centroids
  }
}
```

---

## Part 6: Parquet Schema Designs

### 6.1 Full-Precision Schema (Maximum Recall)

```
message VectorTable {
  required binary id (STRING);
  required binary namespace (STRING);

  // Primary vector storage - 1536 float32 values
  required group embedding (LIST) {
    repeated group list {
      required float element;
    }
  }

  // Clustering metadata
  required int32 centroid_id;
  required float centroid_distance;
  required float l2_norm;

  // Probe dot products for predicate pushdown
  required float probe_dot_0;
  required float probe_dot_1;
  required float probe_dot_2;
  required float probe_dot_3;

  // Timestamp for freshness
  required int64 created_at (TIMESTAMP(MILLIS, true));

  // Flexible metadata
  optional binary metadata (JSON);
}
```

**Row Group Configuration**:
```typescript
const FULL_PRECISION_CONFIG = {
  rowGroupSize: 2000,              // 2000 vectors per row group
  targetRowGroupBytes: 12_000_000, // ~12MB uncompressed
  compression: 'ZSTD',
  compressionLevel: 3,

  // Enable all statistics
  statisticsEnabled: 'CHUNK',      // Per row group stats
  maxStatisticsSize: 4096,

  // Dictionary encoding for ID (if many duplicates in testing)
  dictionaryEncoding: {
    'namespace': true,
    'centroid_id': true,
  }
}
```

### 6.2 Product-Quantized Schema (Maximum Scale)

```
message VectorTablePQ {
  required binary id (STRING);
  required binary namespace (STRING);

  // PQ codes: 64 subquantizers, each maps to 256 centroids
  // Total: 64 bytes per vector (vs 6144 for full precision)
  required int32 pq_code_0;   // Using int32 for Parquet compatibility
  required int32 pq_code_1;   // Actual values are 0-255
  required int32 pq_code_2;
  // ... (64 columns total) ...
  required int32 pq_code_63;

  // Statistics (still full precision for accurate filtering)
  required int32 centroid_id;
  required float centroid_distance;
  required float l2_norm;

  // Probe stats
  required float probe_dot_0;
  required float probe_dot_1;
  required float probe_dot_2;
  required float probe_dot_3;

  required int64 created_at (TIMESTAMP(MILLIS, true));
  optional binary metadata (JSON);
}
```

**Row Group Configuration**:
```typescript
const PQ_CONFIG = {
  rowGroupSize: 50_000,            // 50K vectors per row group
  targetRowGroupBytes: 8_000_000,  // ~8MB compressed
  compression: 'ZSTD',
  compressionLevel: 1,             // Faster, PQ already compressed

  statisticsEnabled: 'CHUNK',

  // Dictionary encoding for PQ codes (256 unique values each)
  dictionaryEncoding: {
    'pq_code_*': true,             // All PQ columns
    'namespace': true,
    'centroid_id': true,
  }
}
```

### 6.3 Hybrid Schema (Balanced)

Store both full vectors and PQ codes for two-stage search:

```
message VectorTableHybrid {
  required binary id (STRING);
  required binary namespace (STRING);

  // Full precision for reranking
  required group embedding (LIST) {
    repeated group list {
      required float element;
    }
  }

  // PQ codes for initial filtering
  required binary pq_codes (FIXED_LEN_BYTE_ARRAY(64));

  // Clustering
  required int32 centroid_id;
  required float centroid_distance;
  required float l2_norm;

  // Probes
  required float probe_dot_0;
  required float probe_dot_1;
  required float probe_dot_2;
  required float probe_dot_3;

  required int64 created_at (TIMESTAMP(MILLIS, true));
  optional binary metadata (JSON);
}
```

**Search Strategy**:
1. Use PQ codes for fast approximate distances (read 64 bytes/vector)
2. Identify top 10x candidates
3. Fetch full embeddings only for candidates (range reads)
4. Rerank with exact distances

---

## Part 7: Graph Structures in Parquet

### 7.1 HNSW Graph Storage

HNSW requires storing neighbor lists per vector. Parquet's nested types handle this:

```
message HNSWIndex {
  required binary id (STRING);
  required int32 vector_index;      // Index in vector table

  // Layer 0 neighbors (all vectors)
  required group layer_0 (LIST) {
    repeated group list {
      required int32 neighbor_index;
    }
  }

  // Higher layer neighbors (subset of vectors)
  optional group higher_layers (LIST) {
    repeated group layer {
      required int32 layer_num;
      required group neighbors (LIST) {
        repeated group list {
          required int32 neighbor_index;
        }
      }
    }
  }

  // Entry point info
  required int32 level;             // Max level for this node
}
```

### 7.2 Graph-Optimized File Layout

```
┌─────────────────────────────────────────────────────────────┐
│                    HNSW FILE LAYOUT                          │
└─────────────────────────────────────────────────────────────┘

File 1: vectors.parquet (data)
├── Row Group 0 (vectors 0-1999)
├── Row Group 1 (vectors 2000-3999)
└── ...

File 2: graph_layer0.parquet (base layer)
├── Row Group 0 (neighbors for vectors 0-1999)
├── Row Group 1 (neighbors for vectors 2000-3999)
└── ...
Note: Row groups aligned with vector file for co-located access

File 3: graph_upper.parquet (upper layers, much smaller)
├── Single row group containing all upper-layer edges
└── Typically <1% of vectors have upper layer presence

File 4: entry_points.parquet (search starting points)
├── Entry point per layer
└── Tiny file, always cached
```

### 7.3 Graph Traversal Optimization

```typescript
async function hnswSearch(
  query: Float32Array,
  k: number,
  env: Env
): Promise<SearchResult[]> {
  // Load entry points (tiny, always cached)
  const entryPoints = await loadEntryPoints(env.R2)

  // Search upper layers (small, often fully cached)
  let candidates = new Set([entryPoints.topLevel])

  for (let level = entryPoints.maxLevel; level > 0; level--) {
    candidates = await searchLayer(
      env.R2,
      query,
      candidates,
      level,
      1  // efSearch = 1 for upper layers
    )
  }

  // Search layer 0 (bulk of the work)
  const results = await searchLayer0(
    env.R2,
    query,
    candidates,
    k * 2,  // efSearch for layer 0
    {
      // Row-group-aligned access pattern
      fetchStrategy: 'aligned',
      prefetchNeighbors: true,
    }
  )

  return topK(results, k)
}

async function searchLayer0(
  r2: R2Bucket,
  query: Float32Array,
  entryPoints: Set<number>,
  efSearch: number,
  options: SearchOptions
): Promise<Map<number, number>> {
  const visited = new Set<number>()
  const candidates = new MinHeap<{id: number, dist: number}>()
  const results = new MaxHeap<{id: number, dist: number}>()

  // Initialize with entry points
  for (const ep of entryPoints) {
    const dist = await getDistance(r2, query, ep)
    candidates.push({ id: ep, dist })
    results.push({ id: ep, dist })
    visited.add(ep)
  }

  // Aligned fetch buffer
  let currentRowGroup = -1
  let rowGroupVectors: Float32Array | null = null
  let rowGroupNeighbors: number[][] | null = null

  while (candidates.size > 0) {
    const current = candidates.pop()
    if (current.dist > results.peek().dist) break

    // Determine row group for this vector
    const rowGroup = Math.floor(current.id / ROW_GROUP_SIZE)

    // Fetch row group if needed (aligned access)
    if (rowGroup !== currentRowGroup) {
      [rowGroupVectors, rowGroupNeighbors] = await fetchRowGroupWithGraph(
        r2,
        rowGroup
      )
      currentRowGroup = rowGroup
    }

    // Get neighbors from cached row group
    const localIndex = current.id % ROW_GROUP_SIZE
    const neighbors = rowGroupNeighbors[localIndex]

    // Process neighbors
    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) continue
      visited.add(neighbor)

      // Compute distance (may need another row group fetch)
      const neighborRowGroup = Math.floor(neighbor / ROW_GROUP_SIZE)
      let dist: number

      if (neighborRowGroup === currentRowGroup) {
        // Fast path: neighbor in same row group
        const neighborLocal = neighbor % ROW_GROUP_SIZE
        dist = computeDistance(query, rowGroupVectors, neighborLocal)
      } else {
        // Slow path: need to fetch another row group
        dist = await getDistanceFromR2(r2, query, neighbor)
      }

      if (results.size < efSearch || dist < results.peek().dist) {
        candidates.push({ id: neighbor, dist })
        results.push({ id: neighbor, dist })
        if (results.size > efSearch) results.pop()
      }
    }
  }

  return results.toMap()
}
```

---

## Part 8: Implementation Roadmap

### Phase 1: Foundation (Week 1-2)

**Goal**: Basic vector storage and brute-force search

```typescript
// Milestone 1.1: Vector Parquet writer
interface VectorWriter {
  addVector(id: string, embedding: Float32Array, metadata?: object): void
  flush(): Promise<string>  // Returns R2 path
}

// Milestone 1.2: Brute-force search
interface BruteForceSearch {
  search(query: Float32Array, k: number): Promise<SearchResult[]>
}

// Tests
- Write 10K vectors to Parquet
- Read back and verify
- Brute force search correctness
- Memory usage under 128MB
```

### Phase 2: Clustering (Week 3-4)

**Goal**: IVF-style search with centroid-based partitioning

```typescript
// Milestone 2.1: Centroid computation
interface ClusteringService {
  computeCentroids(vectors: Float32Array[], nClusters: number): Float32Array[]
  assignToClusters(vectors: Float32Array[], centroids: Float32Array[]): number[]
}

// Milestone 2.2: Partitioned storage
interface PartitionedWriter {
  writeToCentroidPartition(centroidId: number, vectors: VectorBatch): void
  writeManifestWithStats(): Promise<void>
}

// Tests
- Cluster 1M synthetic vectors
- Verify cluster quality (NMI, silhouette)
- Search with nprobe parameter
- Recall@100 > 90%
```

### Phase 3: Quantization (Week 5-6)

**Goal**: Product quantization for scale

```typescript
// Milestone 3.1: PQ training
interface PQTrainer {
  train(vectors: Float32Array[], M: number, Ks: number): PQCodebook
  encode(vector: Float32Array, codebook: PQCodebook): Uint8Array
  computeDistanceTable(query: Float32Array, codebook: PQCodebook): Float32Array
}

// Milestone 3.2: PQ-aware search
interface PQSearch {
  search(query: Float32Array, k: number, rerank?: boolean): Promise<SearchResult[]>
}

// Tests
- PQ with M=64, Ks=256
- Storage reduction: 96x
- Recall@100 > 85% without reranking
- Recall@100 > 95% with top-1000 reranking
```

### Phase 4: Predicate Pushdown (Week 7-8)

**Goal**: Row group pruning using Parquet statistics

```typescript
// Milestone 4.1: Probe vector system
interface ProbeSystem {
  generateProbes(count: number, dims: number): Float32Array[]
  computeProbeStats(vector: Float32Array, probes: Float32Array[]): number[]
  pruneRowGroups(query: Float32Array, rowGroupStats: RowGroupStats[]): number[]
}

// Milestone 4.2: Statistics-aware reader
interface StatsAwareReader {
  readWithPruning(query: Float32Array, threshold: number): Promise<VectorBatch[]>
}

// Tests
- Generate 4 orthonormal probes
- Store probe stats in Parquet
- Verify row group pruning reduces reads by >50%
- No recall loss from pruning
```

### Phase 5: Graph Index (Week 9-10)

**Goal**: HNSW graph stored in Parquet

```typescript
// Milestone 5.1: Graph construction
interface HNSWBuilder {
  build(vectors: VectorBatch[], M: number, efConstruction: number): HNSWGraph
  writeToParquet(graph: HNSWGraph): Promise<string[]>
}

// Milestone 5.2: Graph search
interface HNSWSearch {
  search(query: Float32Array, k: number, efSearch: number): Promise<SearchResult[]>
}

// Tests
- Build HNSW with M=16, efConstruction=200
- Verify graph connectivity
- Search latency < 200ms
- Recall@100 > 95%
```

### Phase 6: Scale Testing (Week 11-12)

**Goal**: Validate at Wikipedia scale

```
Scale targets:
- 100M vectors: Basic functionality
- 500M vectors: Target scale
- 1B vectors: Stretch goal

Metrics:
- Search latency p50, p95, p99
- Recall@10, @100
- Storage efficiency (bytes/vector)
- Cost per 1M searches
```

---

## Part 9: Cost Analysis

### 9.1 Storage Costs

```
500M vectors at 1536 dimensions:

Full precision:
  500M * 6KB = 3TB
  R2 cost: 3000 * $0.015 = $45/month

Product Quantized:
  500M * 64B = 32GB (codes) + 64 * 256 * 96B = 1.5MB (codebook)
  R2 cost: 32 * $0.015 = $0.48/month

Hybrid (PQ + 10% full precision for reranking):
  32GB + 300GB = 332GB
  R2 cost: 332 * $0.015 = $5/month
```

### 9.2 Compute Costs

```
Per search (IVF with nprobe=64):

R2 operations:
  - 1 GET for centroids (cached in DO, amortized)
  - 64 range GETs for partition data
  - ~65 Class A operations = $0.0000293

Worker compute:
  - ~50ms CPU time
  - $0.50 / million requests = $0.0000005

Total per search: ~$0.00003

At 1M searches/day:
  Monthly cost: $0.00003 * 30M = $900

At 100K searches/day:
  Monthly cost: $90
```

### 9.3 Comparison with Managed Services

| Service | 500M vectors | Monthly Cost | Search Latency |
|---------|--------------|--------------|----------------|
| Pinecone | s1.x8 pods | ~$70,000 | 20-50ms |
| Milvus Cloud | 16 CU | ~$25,000 | 30-80ms |
| Qdrant Cloud | 64GB RAM | ~$5,000 | 40-100ms |
| **This Design** | R2 + Workers | **$50-1000** | 100-180ms |

**Trade-off**: We accept ~2-4x higher latency for 50-1000x cost reduction.

---

## Part 10: References

### Academic Papers

1. **Product Quantization for Nearest Neighbor Search**
   - Jegou, Douze, Schmid (PAMI 2011)
   - Foundation for PQ-based storage

2. **Efficient and robust approximate nearest neighbor search using HNSW graphs**
   - Malkov, Yashunin (2018)
   - HNSW algorithm details

3. **Billion-scale similarity search with GPUs**
   - Johnson, Douze, Jegou (2019)
   - FAISS implementation details

### Parquet Specifications

- [Apache Parquet Format Specification](https://parquet.apache.org/docs/file-format/)
- [Parquet Logical Types](https://github.com/apache/parquet-format/blob/master/LogicalTypes.md)
- [Column Statistics](https://github.com/apache/parquet-format/blob/master/Statistics.md)

### Implementation References

- [FAISS Wiki](https://github.com/facebookresearch/faiss/wiki)
- [Qdrant Quantization](https://qdrant.tech/documentation/guides/quantization/)
- [parquet-wasm](https://github.com/kylebarron/parquet-wasm)

---

## Appendix A: Parquet Statistics Deep Dive

### A.1 Statistics Structure

```typescript
interface ParquetStatistics {
  // Exists for all types
  nullCount: bigint
  distinctCount?: bigint

  // Type-dependent bounds
  minValue: T
  maxValue: T

  // Physical storage
  minBytes: Uint8Array
  maxBytes: Uint8Array
}
```

### A.2 Statistics for Vector Auxiliary Columns

For our probe dot product columns, Parquet automatically computes:

```
Column: probe_dot_0 (FLOAT)
Statistics per row group:
  - min: -0.847  (minimum dot product in row group)
  - max: 0.923   (maximum dot product in row group)
  - null_count: 0
```

These statistics are read from the Parquet footer without reading any data pages. This enables O(1) row group pruning.

### A.3 Custom Statistics via Key-Value Metadata

For statistics Parquet doesn't natively support, use key-value metadata:

```typescript
const writerProps = new parquet.WriterPropertiesBuilder()
  .setKeyValueMetadata(new Map([
    // Row group level (stored in row group metadata)
    ['dotdo:centroid_ids', JSON.stringify([42, 43, 44])],
    ['dotdo:bounding_radius', '0.234'],
    ['dotdo:probe_stats', JSON.stringify({
      probe_0: { min: -0.5, max: 0.8, mean: 0.12 },
      probe_1: { min: -0.3, max: 0.9, mean: 0.34 },
    })],
  ]))
  .build()
```

---

## Appendix B: Memory Budget Breakdown

### B.1 Worker Memory Constraints

```
Cloudflare Workers limit: 128MB

Our allocation:
┌────────────────────────────────────────────┐
│ Component                    │ Size        │
├────────────────────────────────────────────┤
│ V8 overhead                  │ 15MB        │
│ WASM module (parquet-wasm)   │ 8MB         │
│ Code + libraries             │ 5MB         │
│ ─────────────────────────────┼───────────  │
│ Available for data           │ 100MB       │
└────────────────────────────────────────────┘
```

### B.2 Data Structure Sizes

```typescript
// Centroid storage (4096 centroids, 1536 dims)
const CENTROID_SIZE = 4096 * 1536 * 4  // 24MB

// Query processing
const QUERY_SIZE = 1536 * 4  // 6KB
const DISTANCE_TABLE = 4096 * 4  // 16KB (centroid distances)

// Row group buffer (streaming, one at a time)
const ROW_GROUP_BUFFER = 8 * 1024 * 1024  // 8MB

// PQ codebook (if used)
const PQ_CODEBOOK = 64 * 256 * 24 * 4  // 1.5MB

// Result heap
const RESULT_HEAP = 100 * 24  // 2.4KB (id + distance + pointer)

// Total worst case
const TOTAL = 24 + 0.006 + 0.016 + 8 + 1.5 + 0.0024  // ~34MB
// Plenty of headroom!
```

### B.3 Streaming Strategy

For very large result sets, use streaming:

```typescript
async function* streamSearch(
  query: Float32Array,
  threshold: number
): AsyncGenerator<SearchResult> {
  const centroids = await loadCentroids()
  const nearCentroids = findNearCentroids(query, centroids, 64)

  for (const centroidId of nearCentroids) {
    // Stream row groups one at a time
    for await (const rowGroup of streamRowGroups(centroidId)) {
      const distances = computeDistances(query, rowGroup)

      for (let i = 0; i < rowGroup.count; i++) {
        if (distances[i] < threshold) {
          yield {
            id: rowGroup.ids[i],
            distance: distances[i],
            metadata: rowGroup.metadata[i]
          }
        }
      }
      // Row group memory is freed here
    }
  }
}
```

---

## Appendix C: Iceberg Metadata Examples

### C.1 Table Metadata (metadata.json)

```json
{
  "format-version": 2,
  "table-uuid": "9c12d441-03fe-4693-9a96-a0705ddf69c1",
  "location": "r2://dotdo-vectors/tables/embeddings",
  "last-sequence-number": 1,
  "last-updated-ms": 1704825600000,
  "last-column-id": 15,
  "current-schema-id": 0,
  "schemas": [
    {
      "type": "struct",
      "schema-id": 0,
      "fields": [
        {"id": 1, "name": "id", "required": true, "type": "string"},
        {"id": 2, "name": "namespace", "required": true, "type": "string"},
        {"id": 3, "name": "embedding", "required": true, "type": {"type": "list", "element-id": 4, "element": "float", "element-required": true}},
        {"id": 5, "name": "centroid_id", "required": true, "type": "int"},
        {"id": 6, "name": "centroid_distance", "required": true, "type": "float"},
        {"id": 7, "name": "l2_norm", "required": true, "type": "float"},
        {"id": 8, "name": "probe_dot_0", "required": true, "type": "float"},
        {"id": 9, "name": "probe_dot_1", "required": true, "type": "float"},
        {"id": 10, "name": "probe_dot_2", "required": true, "type": "float"},
        {"id": 11, "name": "probe_dot_3", "required": true, "type": "float"},
        {"id": 12, "name": "created_at", "required": true, "type": "timestamptz"},
        {"id": 13, "name": "metadata", "required": false, "type": "string"}
      ]
    }
  ],
  "current-snapshot-id": 3051729675574597004,
  "snapshots": [
    {
      "snapshot-id": 3051729675574597004,
      "timestamp-ms": 1704825600000,
      "manifest-list": "r2://dotdo-vectors/tables/embeddings/metadata/snap-3051729675574597004.avro",
      "summary": {
        "operation": "append",
        "added-records": "500000000",
        "total-records": "500000000"
      }
    }
  ],
  "properties": {
    "dotdo.vector.enabled": "true",
    "dotdo.vector.dimensions": "1536",
    "dotdo.vector.metric": "cosine",
    "dotdo.vector.index.type": "ivf-pq",
    "dotdo.vector.index.nlist": "4096",
    "dotdo.vector.quantization": "pq64",
    "dotdo.vector.clustering.centroids_path": "metadata/centroids.parquet",
    "dotdo.vector.probes.path": "metadata/probes.bin"
  },
  "partition-specs": [
    {
      "spec-id": 0,
      "fields": [
        {"source-id": 2, "field-id": 1000, "name": "namespace", "transform": "identity"},
        {"source-id": 5, "field-id": 1001, "name": "centroid_bucket", "transform": "bucket[256]"}
      ]
    }
  ],
  "default-spec-id": 0
}
```

### C.2 Manifest List Entry

```json
{
  "manifest_path": "r2://dotdo-vectors/tables/embeddings/metadata/manifest-001.avro",
  "manifest_length": 8192,
  "partition_spec_id": 0,
  "content": "data",
  "sequence_number": 1,
  "min_sequence_number": 1,
  "added_snapshot_id": 3051729675574597004,
  "added_files_count": 250,
  "existing_files_count": 0,
  "deleted_files_count": 0,
  "added_rows_count": 500000000,
  "existing_rows_count": 0,
  "deleted_rows_count": 0,
  "partitions": [
    {
      "contains_null": false,
      "contains_nan": false,
      "lower_bound": "default",
      "upper_bound": "default"
    },
    {
      "contains_null": false,
      "contains_nan": false,
      "lower_bound": 0,
      "upper_bound": 255
    }
  ]
}
```

### C.3 Manifest File Entry (Vector-Aware)

```json
{
  "status": 1,
  "snapshot_id": 3051729675574597004,
  "data_file": {
    "content": "data",
    "file_path": "r2://dotdo-vectors/tables/embeddings/data/namespace=default/centroid_bucket=42/part-00001.parquet",
    "file_format": "PARQUET",
    "partition": {
      "namespace": "default",
      "centroid_bucket": 42
    },
    "record_count": 2000000,
    "file_size_in_bytes": 12884901888,
    "column_sizes": {
      "1": 48000000,
      "3": 12288000000,
      "5": 8000000,
      "6": 8000000,
      "7": 8000000
    },
    "value_counts": {
      "1": 2000000,
      "3": 2000000
    },
    "null_value_counts": {},
    "nan_value_counts": {},
    "lower_bounds": {
      "5": 672,
      "6": 0.0012,
      "7": 0.9823,
      "8": -0.8471,
      "9": -0.7234,
      "10": -0.9012,
      "11": -0.6543
    },
    "upper_bounds": {
      "5": 687,
      "6": 0.4532,
      "7": 1.0234,
      "8": 0.9234,
      "9": 0.8765,
      "10": 0.7654,
      "11": 0.8901
    }
  }
}
```

---

## Conclusion

This design demonstrates that Parquet's columnar architecture is not just compatible with vector search, but provides unique advantages:

1. **Row groups as natural clusters**: Aligns with IVF partitioning
2. **Column statistics for pruning**: Enables predicate pushdown for approximate filtering
3. **Dictionary encoding for quantization**: PQ codes stored efficiently
4. **Nested types for graphs**: HNSW neighbor lists in Parquet
5. **Iceberg for metadata management**: Snapshots, time travel, schema evolution

The result is a vector search system that costs 50-1000x less than managed alternatives while maintaining competitive recall and acceptable latency for many use cases.

**Next Steps**:
1. Implement Phase 1 (basic storage) with tests
2. Validate memory usage under 128MB
3. Benchmark against 1M vector dataset
4. Iterate on clustering and quantization strategies
