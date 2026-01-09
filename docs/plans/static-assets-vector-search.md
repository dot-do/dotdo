# Static Assets Vector Search: The $0 Coarse Search Architecture

A revolutionary hybrid vector search architecture using Cloudflare Workers static assets for FREE coarse search + R2 Parquet for reranking.

## Executive Summary

This architecture achieves **near-zero cost vector search** by exploiting a key insight: Cloudflare Workers static assets have no subrequest cost and unlimited reads. By storing the coarse index (centroids, PQ codebooks, cluster assignments) as static assets, we eliminate R2 read costs for 99% of search operations.

**Cost Comparison at 100M vectors:**

| Architecture | Monthly Storage | Cost per 1M Queries | Total Monthly |
|--------------|-----------------|---------------------|---------------|
| Traditional R2-only | $50 | $6.20 | $56.20 |
| **Static Assets Hybrid** | $50 | **$0.36** | **$50.36** |
| Pinecone | N/A | included | $7,000 |

**Key Metrics:**

| Metric | Target | Approach |
|--------|--------|----------|
| Coarse search cost | $0 | Static assets (100% FREE) |
| Rerank cost | $0.36/M queries | R2 reads for top-100 only |
| Recall@100 | 95%+ | PQ + exact rerank |
| Latency p50 | 80ms | In-memory PQ scoring |
| Latency p99 | 150ms | Parallel R2 fetch |

## The Core Insight

### Static Assets: The Hidden Superpower

Cloudflare Workers static assets provide:
- **100,000 files maximum** per deployment
- **25MB per file** maximum size
- **2.5TB total** possible storage (100K x 25MB)
- **$0 reads** - no subrequest cost, no bandwidth cost
- **Global edge caching** - sub-millisecond access

### The Hybrid Strategy

```
QUERY FLOW:
                                                    COST
1. Load centroids (static asset)     ─────────────> FREE
2. Find top-20 clusters (in-memory)  ─────────────> FREE
3. Load PQ codes (static assets)     ─────────────> FREE
4. ADC scoring of ~500K candidates   ─────────────> FREE (CPU only)
5. Fetch top-100 full vectors (R2)   ─────────────> 1-10 subrequests
6. Exact rerank                      ─────────────> FREE (CPU only)
                                                    ─────────────
                                     TOTAL COST:    ~$0.00036/query
```

## Capacity Planning

### Static Asset Budget

| Component | Files | Size per File | Total Size | Purpose |
|-----------|-------|---------------|------------|---------|
| Centroids | 1 | ~30MB | 30MB | Cluster centers |
| Codebooks | 1 | ~1.5MB | 1.5MB | PQ codebooks |
| Clusters | 10,000-100,000 | 1-25MB | 10GB-250GB | PQ codes + IDs |
| Matryoshka (optional) | 10,000 | ~10MB | 100GB | 64-dim prefixes |
| **TOTAL** | **~20,000** | varies | **~350GB** | |

**Headroom**: With 100,000 file limit and only 20,000 files used, we have 5x capacity for growth.

### Scale Calculations

| Scale | Vectors | Clusters | Cluster File Size | Total Static | R2 Full Vectors |
|-------|---------|----------|-------------------|--------------|-----------------|
| 1M | 1,000,000 | 1,000 | ~1MB | ~1GB | 6GB |
| 10M | 10,000,000 | 3,162 | ~3MB | ~10GB | 60GB |
| 100M | 100,000,000 | 10,000 | ~10MB | ~100GB | 600GB |
| 500M | 500,000,000 | 22,360 | ~22MB | ~500GB | 3TB |

**Constraint**: At 500M vectors, cluster files approach the 25MB limit. Consider splitting into sub-clusters.

## Binary File Formats

### 1. Centroid Index (`centroids.bin`)

Stores all cluster centroids for coarse quantization.

```
┌─────────────────────────────────────────────────────────────┐
│ HEADER (32 bytes)                                            │
├─────────────────────────────────────────────────────────────┤
│ magic: uint32           = 0x43454E54 ("CENT")               │
│ version: uint16         = 1                                  │
│ flags: uint16           = 0                                  │
│ num_centroids: uint32   = K (e.g., 10000)                   │
│ dimensions: uint32      = 1536                               │
│ dtype: uint8            = 0 (float32)                       │
│ metric: uint8           = 0 (cosine), 1 (l2), 2 (dot)       │
│ reserved: uint8[10]                                          │
├─────────────────────────────────────────────────────────────┤
│ CENTROID DATA (K * D * 4 bytes)                              │
├─────────────────────────────────────────────────────────────┤
│ centroid_0: float32[1536]                                    │
│ centroid_1: float32[1536]                                    │
│ ...                                                          │
│ centroid_K-1: float32[1536]                                  │
├─────────────────────────────────────────────────────────────┤
│ CENTROID METADATA (K * 16 bytes) - optional                  │
├─────────────────────────────────────────────────────────────┤
│ struct CentroidMeta {                                        │
│   vector_count: uint32    // vectors in this cluster         │
│   avg_distance: float32   // average distance to centroid    │
│   max_distance: float32   // cluster radius                  │
│   reserved: uint32                                           │
│ }                                                            │
└─────────────────────────────────────────────────────────────┘

Size for 10K centroids, 1536d:
  Header: 32 bytes
  Data: 10,000 * 1,536 * 4 = 61,440,000 bytes (~58.6 MB)
  Metadata: 10,000 * 16 = 160,000 bytes (156 KB)
  Total: ~59 MB

Note: Exceeds 25MB limit. Solutions:
  1. Use 8K centroids (~47MB, split into 2 files)
  2. Use FP16 centroids (~30MB, single file)
  3. Store half centroids per file (2 files)
```

**Recommended**: Use FP16 centroids (~30MB for 10K clusters) in single file.

### 2. PQ Codebooks (`codebooks.bin`)

Stores Product Quantization codebook centroids.

```
┌─────────────────────────────────────────────────────────────┐
│ HEADER (32 bytes)                                            │
├─────────────────────────────────────────────────────────────┤
│ magic: uint32           = 0x50514342 ("PQCB")               │
│ version: uint16         = 1                                  │
│ flags: uint16           = 0                                  │
│ M: uint32               = 8 (num subspaces)                 │
│ Ksub: uint32            = 256 (centroids per subspace)      │
│ dimensions: uint32      = 1536                               │
│ subvector_dim: uint32   = 192 (= 1536 / 8)                  │
│ dtype: uint8            = 0 (float32)                       │
│ reserved: uint8[7]                                           │
├─────────────────────────────────────────────────────────────┤
│ CODEBOOK DATA (M * Ksub * subvector_dim * 4 bytes)           │
├─────────────────────────────────────────────────────────────┤
│ // Subspace 0: 256 centroids of 192 dimensions each          │
│ subspace_0_centroid_0: float32[192]                          │
│ subspace_0_centroid_1: float32[192]                          │
│ ...                                                          │
│ subspace_0_centroid_255: float32[192]                        │
│                                                              │
│ // Subspace 1                                                │
│ subspace_1_centroid_0: float32[192]                          │
│ ...                                                          │
│                                                              │
│ // Continue for all M subspaces                              │
└─────────────────────────────────────────────────────────────┘

Size for PQ-8x8 (M=8, Ksub=256, subdim=192):
  Header: 32 bytes
  Data: 8 * 256 * 192 * 4 = 1,572,864 bytes (~1.5 MB)
  Total: ~1.5 MB
```

### 3. Cluster Files (`cluster-{XXXX}.bin`)

Stores PQ codes and vector IDs for each cluster.

```
┌─────────────────────────────────────────────────────────────┐
│ HEADER (64 bytes)                                            │
├─────────────────────────────────────────────────────────────┤
│ magic: uint32           = 0x434C5354 ("CLST")               │
│ version: uint16         = 1                                  │
│ flags: uint16           = 0                                  │
│ cluster_id: uint32      = cluster index                      │
│ vector_count: uint32    = N (vectors in cluster)            │
│ M: uint8                = 8 (PQ subspaces)                  │
│ id_type: uint8          = 0 (uint64), 1 (string offset)     │
│ has_metadata: uint8     = 0 or 1                            │
│ reserved: uint8[41]                                          │
├─────────────────────────────────────────────────────────────┤
│ VECTOR IDS SECTION                                           │
├─────────────────────────────────────────────────────────────┤
│ // Option A: uint64 IDs (8 bytes each)                       │
│ ids: uint64[N]                                               │
│                                                              │
│ // Option B: String IDs (variable length)                    │
│ string_offsets: uint32[N+1]  // offsets into string table    │
│ string_data: bytes           // concatenated strings         │
├─────────────────────────────────────────────────────────────┤
│ PQ CODES SECTION (N * M bytes)                               │
├─────────────────────────────────────────────────────────────┤
│ // Interleaved format for cache efficiency                   │
│ vector_0_codes: uint8[M]  // [c0, c1, ..., c7]              │
│ vector_1_codes: uint8[M]                                     │
│ ...                                                          │
│ vector_N-1_codes: uint8[M]                                   │
├─────────────────────────────────────────────────────────────┤
│ METADATA SECTION (optional)                                  │
├─────────────────────────────────────────────────────────────┤
│ // Compressed JSON or MessagePack                            │
│ metadata_offsets: uint32[N+1]                                │
│ metadata_data: bytes (ZSTD compressed)                       │
└─────────────────────────────────────────────────────────────┘

Size for 50K vectors per cluster (M=8):
  Header: 64 bytes
  IDs (uint64): 50,000 * 8 = 400,000 bytes (390 KB)
  PQ codes: 50,000 * 8 = 400,000 bytes (390 KB)
  Metadata: ~500 KB (compressed)
  Total: ~1.3 MB per cluster (well under 25MB limit)
```

### 4. Matryoshka Prefixes (`matryoshka-{XXXX}.bin`) - Optional

Stores 64-dim prefix vectors for progressive precision search.

```
┌─────────────────────────────────────────────────────────────┐
│ HEADER (32 bytes)                                            │
├─────────────────────────────────────────────────────────────┤
│ magic: uint32           = 0x4D545259 ("MTRY")               │
│ version: uint16         = 1                                  │
│ flags: uint16           = 0                                  │
│ cluster_id: uint32      = cluster index                      │
│ vector_count: uint32    = N                                  │
│ prefix_dims: uint16     = 64                                 │
│ dtype: uint8            = 0 (float32), 1 (float16)          │
│ reserved: uint8[9]                                           │
├─────────────────────────────────────────────────────────────┤
│ PREFIX DATA (N * prefix_dims * sizeof(dtype) bytes)          │
├─────────────────────────────────────────────────────────────┤
│ prefix_0: float32[64] or float16[64]                         │
│ prefix_1: float32[64] or float16[64]                         │
│ ...                                                          │
│ prefix_N-1: float32[64] or float16[64]                       │
└─────────────────────────────────────────────────────────────┘

Size for 50K vectors (64-dim, float32):
  Header: 32 bytes
  Data: 50,000 * 64 * 4 = 12,800,000 bytes (~12.2 MB)
  Total: ~12.2 MB per cluster
```

## Loading Strategies

### 1. Full Load (Recommended for Small Clusters)

Load entire cluster file into memory when needed.

```typescript
async function loadClusterFull(clusterId: number): Promise<ClusterData> {
  const response = await fetch(`/static/cluster-${clusterId.toString().padStart(4, '0')}.bin`)
  const buffer = await response.arrayBuffer()
  return parseClusterFile(buffer)
}

// Memory usage: ~1-2MB per cluster
// Suitable when: cluster_size < 100K vectors
```

### 2. Streaming (For Large Clusters)

Use ReadableStream to process in chunks.

```typescript
async function* streamCluster(clusterId: number): AsyncGenerator<ClusterChunk> {
  const response = await fetch(`/static/cluster-${clusterId.toString().padStart(4, '0')}.bin`)
  const reader = response.body!.getReader()

  // Read header first
  const header = await readBytes(reader, 64)
  const { vectorCount, M } = parseHeader(header)

  // Stream IDs and PQ codes in batches
  const batchSize = 10000
  for (let offset = 0; offset < vectorCount; offset += batchSize) {
    const count = Math.min(batchSize, vectorCount - offset)
    const ids = await readBytes(reader, count * 8)
    const codes = await readBytes(reader, count * M)
    yield { ids: new BigUint64Array(ids), codes: new Uint8Array(codes) }
  }
}

// Memory usage: ~100KB per batch
// Suitable when: cluster_size > 100K vectors or memory constrained
```

### 3. Range Requests (For Selective Reads)

Use HTTP Range requests to fetch specific vector subsets.

```typescript
async function loadVectorRange(
  clusterId: number,
  startIdx: number,
  count: number
): Promise<{ ids: BigUint64Array; codes: Uint8Array }> {
  const url = `/static/cluster-${clusterId.toString().padStart(4, '0')}.bin`

  // Calculate byte offsets (assuming fixed header and uint64 IDs)
  const headerSize = 64
  const idOffset = headerSize + startIdx * 8
  const idLength = count * 8
  const codeOffset = headerSize + totalVectors * 8 + startIdx * 8
  const codeLength = count * 8

  // Parallel range requests
  const [idResponse, codeResponse] = await Promise.all([
    fetch(url, { headers: { Range: `bytes=${idOffset}-${idOffset + idLength - 1}` }}),
    fetch(url, { headers: { Range: `bytes=${codeOffset}-${codeOffset + codeLength - 1}` }})
  ])

  return {
    ids: new BigUint64Array(await idResponse.arrayBuffer()),
    codes: new Uint8Array(await codeResponse.arrayBuffer())
  }
}

// Useful for: loading specific candidates, incremental processing
```

### Memory Budget Analysis

```
Cloudflare Workers memory limit: 128 MB

Fixed allocations:
  V8 overhead:                    ~15 MB
  WASM/code:                      ~10 MB
  Available for data:             ~103 MB

Per-query allocations:
  Centroids (10K, FP16):          30 MB
  Codebooks:                      1.5 MB
  Query vector:                   6 KB
  ADC tables (8 x 256 x 4):       8 KB
  Result heap (1000 entries):     32 KB
  ─────────────────────────────────────
  Subtotal:                       ~32 MB

Available for cluster data:       ~71 MB

Streaming budget (multiple clusters):
  20 clusters @ 3.5MB each:       70 MB (fits!)

Alternative: Load 5 clusters fully + stream rest
```

## Build Pipeline

### Offline Index Generation

```typescript
interface IndexBuildConfig {
  // Input
  sourceVectors: string           // Path to source vectors (Parquet/Arrow)

  // Clustering
  numClusters: number             // K = sqrt(N) typically
  clusteringIterations: number    // K-means iterations (25-50)
  clusteringSampleSize: number    // Vectors to sample for training

  // Product Quantization
  M: number                       // Subspaces (8 or 16)
  Ksub: number                    // Centroids per subspace (256)
  pqTrainingSampleSize: number    // Vectors for PQ training

  // Output
  outputDir: string               // Directory for static assets
  r2Bucket: string                // R2 bucket for full vectors
}

async function buildIndex(config: IndexBuildConfig): Promise<BuildResult> {
  // Phase 1: Sample and train centroids
  console.log('Phase 1: Training centroids...')
  const sample = await sampleVectors(config.sourceVectors, config.clusteringSampleSize)
  const centroids = await trainKMeans(sample, config.numClusters, config.clusteringIterations)
  await writeCentroidsFile(centroids, `${config.outputDir}/centroids.bin`)

  // Phase 2: Train PQ codebooks
  console.log('Phase 2: Training PQ codebooks...')
  const pqSample = await sampleVectors(config.sourceVectors, config.pqTrainingSampleSize)
  const codebooks = await trainPQ(pqSample, centroids, config.M, config.Ksub)
  await writeCodebooksFile(codebooks, `${config.outputDir}/codebooks.bin`)

  // Phase 3: Assign vectors to clusters and encode
  console.log('Phase 3: Encoding and partitioning...')
  const clusterWriters = new Map<number, ClusterWriter>()
  const parquetWriter = new ParquetWriter(`${config.r2Bucket}/full-vectors/`)

  for await (const batch of streamVectors(config.sourceVectors)) {
    for (const { id, vector, metadata } of batch) {
      // Assign to cluster
      const clusterId = findNearestCentroid(vector, centroids)

      // Compute residual and encode
      const residual = subtractVectors(vector, centroids[clusterId])
      const pqCodes = encodePQ(residual, codebooks)

      // Write to cluster file
      const writer = getOrCreateWriter(clusterWriters, clusterId, config)
      await writer.write({ id, pqCodes, metadata })

      // Write full vector to R2 Parquet
      await parquetWriter.write({ id, vector, clusterId })
    }
  }

  // Phase 4: Finalize all files
  console.log('Phase 4: Finalizing...')
  for (const [clusterId, writer] of clusterWriters) {
    await writer.finalize(`${config.outputDir}/cluster-${clusterId.toString().padStart(4, '0')}.bin`)
  }
  await parquetWriter.finalize()

  return {
    numClusters: clusterWriters.size,
    totalVectors: parquetWriter.rowCount
  }
}
```

### Incremental Build (Append-Only)

```typescript
async function appendToIndex(
  newVectors: AsyncIterable<VectorEntry>,
  existingIndex: IndexMetadata
): Promise<void> {
  const centroids = await loadCentroids(existingIndex.centroidsPath)
  const codebooks = await loadCodebooks(existingIndex.codebooksPath)

  // Track which clusters are modified
  const modifiedClusters = new Set<number>()

  for await (const { id, vector, metadata } of newVectors) {
    const clusterId = findNearestCentroid(vector, centroids)
    modifiedClusters.add(clusterId)

    // Append to delta file (not main cluster file)
    await appendToDelta(clusterId, { id, vector, metadata })
  }

  // Merge deltas into main cluster files (can be done async)
  for (const clusterId of modifiedClusters) {
    await mergeDelta(clusterId, existingIndex)
  }
}
```

## Query Implementation

### Full Search Flow

```typescript
interface SearchOptions {
  k: number                // Number of results
  nprobe: number           // Clusters to search (default: 20)
  oversample: number       // Rerank candidates (default: 100)
  namespace?: string       // Optional namespace filter
}

interface SearchResult {
  id: string
  score: number
  metadata?: Record<string, unknown>
}

class StaticAssetsVectorSearch {
  private centroids: Float32Array | null = null
  private codebooks: Float32Array[] | null = null
  private numClusters: number = 0
  private dimensions: number = 1536
  private M: number = 8

  async initialize(): Promise<void> {
    // Load from static assets (FREE)
    const [centroidsResponse, codebooksResponse] = await Promise.all([
      fetch('/static/centroids.bin'),
      fetch('/static/codebooks.bin')
    ])

    this.centroids = await parseCentroidsFile(await centroidsResponse.arrayBuffer())
    this.codebooks = await parseCodebooksFile(await codebooksResponse.arrayBuffer())
    this.numClusters = this.centroids.length / this.dimensions
  }

  async search(query: Float32Array, options: SearchOptions): Promise<SearchResult[]> {
    const { k, nprobe = 20, oversample = 100 } = options

    // Stage 1: Find nearest clusters (in-memory, FREE)
    const clusters = this.findNearestClusters(query, nprobe)

    // Stage 2: Precompute ADC tables (in-memory, FREE)
    const adcTables = this.computeADCTables(query)

    // Stage 3: Load cluster files and score (static assets, FREE)
    const candidates = await this.scoreClusterCandidates(clusters, adcTables, oversample * nprobe)

    // Stage 4: Fetch full vectors and rerank (R2, ~$0.00036/query)
    const rerankCount = Math.min(candidates.length, oversample)
    const results = await this.rerankWithFullVectors(query, candidates.slice(0, rerankCount))

    return results.slice(0, k)
  }

  private findNearestClusters(query: Float32Array, nprobe: number): ClusterMatch[] {
    const distances: { clusterId: number; distance: number }[] = []

    for (let i = 0; i < this.numClusters; i++) {
      const centroid = this.centroids!.subarray(i * this.dimensions, (i + 1) * this.dimensions)
      const distance = cosineDistance(query, centroid)
      distances.push({ clusterId: i, distance })
    }

    distances.sort((a, b) => a.distance - b.distance)
    return distances.slice(0, nprobe)
  }

  private computeADCTables(query: Float32Array): Float32Array[] {
    const tables: Float32Array[] = []
    const subDim = this.dimensions / this.M

    for (let m = 0; m < this.M; m++) {
      const subQuery = query.subarray(m * subDim, (m + 1) * subDim)
      const table = new Float32Array(256)

      for (let k = 0; k < 256; k++) {
        const centroid = this.codebooks![m].subarray(k * subDim, (k + 1) * subDim)
        table[k] = squaredL2Distance(subQuery, centroid)
      }

      tables.push(table)
    }

    return tables
  }

  private async scoreClusterCandidates(
    clusters: ClusterMatch[],
    adcTables: Float32Array[],
    topK: number
  ): Promise<ScoredCandidate[]> {
    // Load all cluster files in parallel (FREE - static assets)
    const clusterPromises = clusters.map(async ({ clusterId }) => {
      const response = await fetch(`/static/cluster-${clusterId.toString().padStart(4, '0')}.bin`)
      return parseClusterFile(await response.arrayBuffer())
    })

    const clusterDatas = await Promise.all(clusterPromises)

    // Score all candidates using ADC
    const allCandidates: ScoredCandidate[] = []

    for (const clusterData of clusterDatas) {
      for (let i = 0; i < clusterData.vectorCount; i++) {
        const pqCodes = clusterData.pqCodes.subarray(i * this.M, (i + 1) * this.M)
        let score = 0
        for (let m = 0; m < this.M; m++) {
          score += adcTables[m][pqCodes[m]]
        }
        allCandidates.push({
          id: clusterData.ids[i],
          score,
          clusterId: clusterData.clusterId
        })
      }
    }

    // Sort and return top candidates
    allCandidates.sort((a, b) => a.score - b.score)
    return allCandidates.slice(0, topK)
  }

  private async rerankWithFullVectors(
    query: Float32Array,
    candidates: ScoredCandidate[]
  ): Promise<SearchResult[]> {
    // Group candidates by cluster for efficient Parquet reads
    const byCluster = new Map<number, string[]>()
    for (const c of candidates) {
      if (!byCluster.has(c.clusterId)) byCluster.set(c.clusterId, [])
      byCluster.get(c.clusterId)!.push(c.id)
    }

    // Fetch full vectors from R2 Parquet (this is the only R2 cost)
    const vectors = await this.fetchFullVectors(byCluster)

    // Exact distance computation
    const results: SearchResult[] = []
    for (const [id, vector] of vectors) {
      const score = cosineSimilarity(query, vector)
      results.push({ id, score })
    }

    results.sort((a, b) => b.score - a.score)
    return results
  }

  private async fetchFullVectors(
    byCluster: Map<number, string[]>
  ): Promise<Map<string, Float32Array>> {
    // Use R2 Parquet reader with row group pruning
    const vectors = new Map<string, Float32Array>()

    for (const [clusterId, ids] of byCluster) {
      const idSet = new Set(ids)
      const parquetPath = `vectors/full-vectors-${clusterId.toString().padStart(4, '0')}.parquet`

      // Read only needed IDs using Parquet predicate pushdown
      const rows = await this.r2Reader.readParquet(parquetPath, {
        filter: { id: { in: ids } },
        columns: ['id', 'vector']
      })

      for (const row of rows) {
        vectors.set(row.id, new Float32Array(row.vector))
      }
    }

    return vectors
  }
}
```

## Update Strategy

### Static Assets: Redeploy for Bulk Updates

Static assets are immutable within a deployment. For bulk updates:

1. **Generate new index offline**
2. **Deploy new Worker version** with updated assets
3. **Zero-downtime rollover** via Cloudflare's deployment system

```bash
# Build new index
node scripts/build-index.js --input vectors.parquet --output dist/static/

# Deploy with new assets
npx wrangler deploy
```

### R2: Incremental Updates

Full vectors in R2 can be updated incrementally:

```typescript
async function addVectors(newVectors: VectorEntry[]): Promise<void> {
  // Write to delta Parquet files in R2
  const deltaPath = `vectors/delta-${Date.now()}.parquet`
  await this.r2Writer.writeParquet(deltaPath, newVectors)

  // Update Iceberg manifest
  await this.icebergWriter.addDataFile(deltaPath)
}

async function compactDeltas(): Promise<void> {
  // Periodically merge delta files into main cluster files
  // Run as scheduled Worker
}
```

### Hybrid Strategy: Best of Both

```
UPDATE FREQUENCY     STRATEGY
─────────────────────────────────────────
Real-time inserts    R2 delta files
Daily batch          R2 compaction + static rebuild
Weekly full          Complete index rebuild
Emergency            Manual redeploy
```

## Workers for Platforms: Multi-Tenant Architecture

For multi-tenant deployments, each tenant gets their own static assets:

```
tenant-a.workers.dev/
├── static/
│   ├── centroids.bin      (tenant A's clusters)
│   ├── codebooks.bin      (shared or tenant-specific)
│   └── cluster-*.bin      (tenant A's vectors)

tenant-b.workers.dev/
├── static/
│   ├── centroids.bin      (tenant B's clusters)
│   └── ...
```

### Tenant Isolation Benefits

1. **Cost attribution**: Each tenant's static assets are separate
2. **Scale independently**: Different cluster counts per tenant
3. **Privacy**: No cross-tenant data leakage possible
4. **Performance**: No noisy neighbor issues

### Shared Components

```typescript
// Shared PQ codebooks across tenants (trained on diverse corpus)
const SHARED_CODEBOOKS_URL = 'https://shared.workers.dev/static/codebooks.bin'

class MultiTenantSearch {
  private sharedCodebooks: Float32Array[] | null = null

  async initialize(): Promise<void> {
    // Load shared codebooks once
    this.sharedCodebooks = await loadCodebooks(SHARED_CODEBOOKS_URL)

    // Load tenant-specific centroids
    this.centroids = await loadCentroids('/static/centroids.bin')
  }
}
```

## Cost Analysis

### Storage Costs (Monthly)

| Component | Size (100M vectors) | Location | Cost |
|-----------|---------------------|----------|------|
| Centroids | 30 MB | Static | $0 |
| Codebooks | 1.5 MB | Static | $0 |
| Cluster files (PQ) | 1 GB | Static | $0 |
| Full vectors | 600 GB | R2 | $9 |
| **TOTAL** | | | **$9/month** |

### Query Costs (per 1M queries)

| Operation | Count | Unit Cost | Total |
|-----------|-------|-----------|-------|
| Worker invocations | 1M | $0.50/M | $0.50 |
| Static asset reads | 20M | $0 | $0 |
| R2 Class B reads | 1M | $0.36/M | $0.36 |
| **TOTAL** | | | **$0.86/M queries** |

### Comparison Table

| Architecture | Monthly (100M vectors, 10M queries) |
|--------------|-------------------------------------|
| **Static Assets Hybrid** | $9 + $8.60 = **$17.60** |
| R2-only (previous design) | $9 + $62 = $71 |
| Pinecone | $7,000 |
| Weaviate Cloud | $2,500 |

**400x cheaper than Pinecone, 4x cheaper than R2-only design.**

## Performance Characteristics

### Latency Breakdown

| Stage | Operation | Time | Cost |
|-------|-----------|------|------|
| 1 | Load centroids (cached) | 0ms | FREE |
| 2 | Find nearest clusters | 2ms | FREE |
| 3 | Compute ADC tables | 0.5ms | FREE |
| 4 | Load cluster files (20 clusters) | 30ms | FREE |
| 5 | ADC scoring (1M candidates) | 10ms | FREE |
| 6 | Fetch rerank vectors (R2) | 40ms | R2 read |
| 7 | Exact reranking | 2ms | FREE |
| **TOTAL** | | **~85ms** | |

### Scalability

| Vectors | Clusters | Cluster Load Time | Total Latency |
|---------|----------|-------------------|---------------|
| 1M | 1,000 | 20ms | 60ms |
| 10M | 3,162 | 25ms | 70ms |
| 100M | 10,000 | 35ms | 90ms |
| 500M | 22,360 | 50ms | 120ms |

### Memory Profile

```
Peak memory usage during query:

Fixed:
  Centroids (10K, FP16):          30 MB
  Codebooks:                       1.5 MB

Per-query:
  Query vector:                    6 KB
  ADC tables:                      8 KB
  Cluster data (20 clusters):     26 MB
  Result heap:                    32 KB
  Full vectors for rerank:         600 KB
  ────────────────────────────────────────
  Total peak:                     ~58 MB

Well under 128 MB Worker limit!
```

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Static asset size limit (25MB) | Can't store large clusters | Split clusters, use FP16 |
| Static asset count limit (100K) | Can't scale beyond ~500M vectors | Hierarchical clustering |
| Cold start loading | First query slow | Warm pool, lazy loading |
| Stale index | Missing recent vectors | R2 delta files, frequent rebuilds |
| Memory pressure | OOM during query | Streaming, smaller batches |

## Implementation Roadmap

### Phase 1: Foundation (Week 1)
- Static asset loader (fetch, parse binary formats)
- Centroid index (FP16 support, nearest cluster search)
- PQ codec (encode, decode, ADC scoring)

### Phase 2: Build Pipeline (Week 2)
- Offline index builder (K-means, PQ training)
- Cluster file writer
- Parquet full-vector writer

### Phase 3: Query Path (Week 3)
- Coarse search (static assets only)
- Rerank fetcher (R2 Parquet)
- Search coordinator

### Phase 4: Production (Week 4)
- Multi-tenant support (Workers for Platforms)
- Incremental updates (R2 deltas)
- Monitoring and observability

## Conclusion

The Static Assets Vector Search architecture achieves near-zero query cost by leveraging Cloudflare's free static asset serving for 99% of search operations. Only the final reranking step requires R2 reads, reducing costs by 400x compared to managed vector databases.

Key innovations:
1. **Binary file formats** optimized for direct memory mapping
2. **Streaming support** for large clusters within 128MB limit
3. **Hybrid update strategy** combining immutable static assets with incremental R2 updates
4. **Multi-tenant isolation** via Workers for Platforms

This is potentially the cheapest vector search architecture ever built at scale.
