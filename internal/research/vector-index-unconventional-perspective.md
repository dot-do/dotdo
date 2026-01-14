---
title: "Unconventional Approaches to Vector Similarity Search on Cheap Storage"
description: Documentation for research
---

# Unconventional Approaches to Vector Similarity Search on Cheap Storage

**Goal**: Wikipedia-scale vector search (hundreds of millions of embeddings) on R2 + Parquet/Iceberg + Cloudflare Workers at sub-$100/month instead of $10k+/month with traditional vector DBs.

**Constraints**:
- Workers: 128MB memory, 30s CPU time
- R2: $0.015/GB/month storage
- Target: sub-200ms latency, 95%+ recall@100
- Can run small neural networks (ONNX, TensorFlow.js)

## 1. The Index IS the Neural Network

### 1.1 Learned Index as Lookup Function

Traditional indexes are data structures. What if the index was a trained neural network?

**Core insight**: A small MLP can learn to predict which Parquet file contains vectors similar to a query. This is essentially learning a spatial hash function.

```
Query Vector (1536d)
    |
    v
[Tiny MLP: 1536 -> 256 -> 64 -> N_FILES]
    |
    v
Predicted File IDs (softmax over files)
    |
    v
Fetch top-k predicted Parquet files from R2
    |
    v
Exact search within files
```

**Training approach**:
1. Cluster the corpus into N "shards" (e.g., 10,000 files of 10K vectors each)
2. For each vector, record which file it's in
3. Train MLP to predict file ID from vector
4. The network learns the embedding space topology

**Why this could work**:
- MLP inference is FAST in WASM/Workers (~1ms for small network)
- Network learns non-linear cluster boundaries (better than k-means)
- Single model replaces entire hierarchical index
- Model size: ~500KB-2MB for 1536->256->64->10000 architecture

**Key innovation**: Progressive training. Train coarse model first (predicts region), then fine models per region.

### 1.2 Neural Routing Tree

Instead of HNSW's probabilistic graph, train a neural decision tree:

```
             Query
               |
           [Router NN]
           /    |    \
       Left  Center  Right
         |      |      |
     [Router] [Router] [Router]
     /   \    /   \    /   \
   ...   ...  ...  ... ...  ...
```

Each router is a tiny NN (1536 -> 32 -> 3) that decides which subtree to explore. The tree has log(N) depth.

**Training**: Each router is trained on vectors that reach that node, learning to separate them optimally.

**Benefits**:
- O(log N) decisions, each ~0.1ms
- Total inference: ~1-2ms
- Each router fits in L1 cache
- Naturally parallelizable (can explore multiple branches)

## 2. The Index Predicts the Vector

### 2.1 Inverted Learned Index

What if, instead of predicting WHERE similar vectors are, we predict WHAT similar vectors ARE?

```
Query: "What are the best hiking trails in Colorado?"
    |
    v
[Embedding Model] -> Query Vector
    |
    v
[Candidate Generator NN] -> Predicted "centroid" vectors
    |
    v
Hash lookup: centroid -> file mapping
    |
    v
Fetch relevant files, exact search
```

The candidate generator predicts the cluster centroids most likely to contain relevant results.

**This is like a tiny retrieval model trained to generate search targets.**

### 2.2 Compressed Vocabulary + Lookup

Extreme approach: Quantize all vectors to a finite vocabulary (e.g., 1M "words").

1. Train a VQ-VAE or product quantizer on corpus
2. Each vector maps to a "word" (vocabulary entry)
3. Build inverted index: word -> vector IDs
4. Query: encode query, find nearest vocabulary entries, lookup

```
Vector -> [Encoder] -> Vocabulary Token (20 bits)
                            |
                            v
                     Inverted Index
                     token_42 -> [vec_1, vec_892, vec_10032, ...]
```

**Why this is wild**: You're essentially building a BM25-style index for vectors.

Storage:
- Vocabulary: 1M entries * 1536 dims * 4 bytes = 6GB (can compress to ~1GB)
- Inverted index: 100M vectors * 4 bytes = 400MB
- Total: ~1.5GB vs 600GB for raw vectors

## 3. Hierarchical Matryoshka Embeddings

### 3.1 Progressive Precision Search

Matryoshka embeddings have a special property: the first N dimensions are a valid embedding of lower precision.

```
Full embedding: [d1, d2, d3, ..., d1536]
                 |<--64->|<-256->|<--full-->|
                 coarse   medium   fine
```

**Search strategy**:
1. **R2 Index File**: Store 64-dim prefixes (4% of data) with file pointers
2. **First Pass**: Load 64-dim index (~24MB for 100M vectors), find top-1000
3. **Second Pass**: Fetch 256-dim from candidate files, rerank to top-100
4. **Third Pass**: Fetch full 1536-dim for top-100, final ranking

**Memory usage**:
- Pass 1: 24MB (fits in Worker)
- Pass 2: 1000 * 256 * 4 = 1MB
- Pass 3: 100 * 1536 * 4 = 600KB

**This achieves 95%+ recall with ~2 R2 round trips.**

### 3.2 Dimension-Partitioned Storage

Store vectors split by dimension ranges in separate Parquet row groups:

```
File: vectors_shard_42.parquet
  Row Group 0: dims 0-63 (coarse index, always loaded)
  Row Group 1: dims 64-255 (medium precision)
  Row Group 2: dims 256-1535 (fine precision)
```

Parquet's columnar storage + row group structure enables selective dimension loading.

## 4. Binary Quantization + Hamming Distance

### 4.1 1-Bit Embeddings

Reduce each dimension to 1 bit: positive = 1, negative = 0.

```
Original: [0.32, -0.15, 0.87, -0.42, ...]
Binary:   [1, 0, 1, 0, ...]
```

**Storage reduction**: 1536 dims * 1 bit = 192 bytes vs 6KB = 32x compression

**Search speed**: Hamming distance via XOR + popcount
- CPU: billions of comparisons per second
- SIMD: even faster
- Workers: WASM popcount is extremely fast

**The catch**: Recall drops to ~85% without reranking.

**Solution**: Two-phase search
1. Binary scan (all 100M vectors in <100ms) -> top 10,000 candidates
2. Load full vectors for candidates -> top 100

**Memory for 100M binary vectors**: 100M * 192 bytes = 19.2GB
Still too big for Workers, but can be sharded into ~200 files.

### 4.2 Multi-Bit Quantization

Compromise: 4 bits per dimension.

```
Storage: 1536 * 4 bits = 768 bytes per vector
100M vectors = 76.8GB
```

Still need sharding, but fewer files. Can use lookup tables for distance computation.

### 4.3 Product Quantization (PQ)

Split 1536-dim vector into 192 sub-vectors of 8 dimensions each.
Quantize each sub-vector to 256 centroids (1 byte).

```
Original: [v1...v8, v9...v16, ..., v1529...v1536]
                |        |               |
                v        v               v
            [byte]   [byte]   ...   [byte]
           (256 options per segment)
```

**Storage**: 192 bytes per vector = 19.2GB for 100M vectors
**Distance**: Precompute distance tables at query time

This is Faiss IVF-PQ's secret sauce, but we can implement it for Workers.

## 5. Graph-Free Approaches

### 5.1 Locality Sensitive Hashing (LSH) on Steroids

Classic LSH with learned hyperplanes:

1. Train a neural network to output K hash bits
2. Network learns which hyperplanes best preserve similarity
3. Store vectors in 2^K buckets
4. Query: compute hash, check matching buckets

**The neural part**: Instead of random hyperplanes, learn them.

```python
class LearnedLSH(nn.Module):
    def __init__(self, dim=1536, bits=16):
        self.projections = nn.Linear(dim, bits)

    def forward(self, x):
        return (self.projections(x) > 0).int()
```

Train with contrastive loss: similar vectors should share hash bits.

### 5.2 Spectral Hashing

Use eigenvectors of the similarity graph as hash functions.
Precompute once, store hash codes + lookup tables.

**Key insight**: Eigenvectors of the graph Laplacian produce semantically meaningful binary codes.

## 6. Retrieval as Generation

### 6.1 Train a Tiny Retrieval Model

Instead of indexing, train a small model that GENERATES relevant document IDs.

```
Query Embedding -> [Tiny Transformer] -> Document ID Token Sequence
```

This is the DSI (Differentiable Search Index) approach, but miniaturized:
- Train on (query, relevant_doc_id) pairs
- Model learns to "memorize" the corpus structure
- At inference: beam search over document IDs

**Why this is crazy enough to work**:
- Model size: 10-50MB (fits in Worker)
- No index structure needed
- Naturally handles semantic similarity
- Can be trained on user behavior (implicit feedback)

### 6.2 Query-Document Cross-Attention

Two-tower architecture where document tower is precomputed:

```
Query Tower (runtime):     Document Tower (precomputed):
     |                              |
 [Encoder]                    [Encoder]
     |                              |
  Q_embed                       D_embed (stored in Parquet)
     |                              |
     +----------[Cross-Attn]--------+
                    |
               Relevance Score
```

Twist: Instead of full cross-attention, use efficient attention variants:
- Performer (linear attention)
- Sparse attention (top-k keys only)

## 7. Iceberg-Native Vector Search

### 7.1 Partition by Embedding Cluster

Use k-means cluster ID as Iceberg partition key:

```
Partition: cluster_id=42
  - vectors in cluster 42
  - cluster centroid stored in manifest metadata
```

**Query flow**:
1. Compare query to all centroid (stored in a single metadata file)
2. Use Iceberg partition pruning to fetch only relevant partitions
3. Exact search within partitions

**This reuses all of Iceberg's existing infrastructure!**

### 7.2 Embedding Statistics in Column Metadata

Store per-file embedding statistics in Parquet footer:
- Centroid of vectors in file
- Covariance matrix (compressed)
- Min/max per dimension

Use these statistics for pruning before loading any vectors.

```typescript
// Pseudo-code for Iceberg-aware vector search
async function search(query: number[], k: number) {
  const metadata = await loadIcebergMetadata()

  // Score each data file by centroid distance
  const fileScores = metadata.dataFiles.map(file => ({
    file,
    score: cosineSim(query, file.customMetadata.centroid)
  }))

  // Only load top files
  const topFiles = fileScores.sort((a, b) => b.score - a.score).slice(0, 10)

  // Exact search within top files
  return exactSearch(topFiles, query, k)
}
```

## 8. The R2 + Workers Sweet Spot

### 8.1 Architecture for 100M Vectors

Given the constraints, here's an achievable architecture:

```
┌─────────────────────────────────────────────────────────────┐
│                    Cloudflare Workers                        │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Coarse Index (in Worker memory at startup)             │ │
│  │  - 10,000 cluster centroids (1536 dims)                 │ │
│  │  - Size: 60MB                                           │ │
│  │  - Loaded via WASM import or R2 at cold start           │ │
│  └─────────────────────────────────────────────────────────┘ │
│                           │                                  │
│                           │ Top-50 clusters                  │
│                           ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Binary Codes (fetched from R2)                         │ │
│  │  - 192 bytes per vector                                 │ │
│  │  - 50 clusters * 10K vectors = 500K vectors             │ │
│  │  - Size: ~100MB (streamed, filtered)                    │ │
│  └─────────────────────────────────────────────────────────┘ │
│                           │                                  │
│                           │ Top-1000 candidates              │
│                           ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Full Vectors (fetched from R2)                         │ │
│  │  - 1000 * 6KB = 6MB                                     │ │
│  │  - Exact reranking                                      │ │
│  └─────────────────────────────────────────────────────────┘ │
│                           │                                  │
│                           ▼                                  │
│                    Top-100 results                           │
└─────────────────────────────────────────────────────────────┘
```

**Latency breakdown**:
- Coarse search: 5ms (in-memory)
- R2 fetch binary codes: 50ms (parallel fetches)
- Binary scan: 20ms (WASM)
- R2 fetch full vectors: 30ms
- Exact rerank: 5ms
- **Total: ~110ms**

### 8.2 Storage Layout

```
r2://vectors/
├── index/
│   ├── centroids.bin (60MB)
│   └── cluster_assignments.parquet (400MB)
├── binary/
│   ├── cluster_0000.bin
│   ├── cluster_0001.bin
│   └── ... (10,000 files, ~1.9GB each full, but binary = 60KB each)
├── full/
│   ├── cluster_0000.parquet
│   ├── cluster_0001.parquet
│   └── ... (10,000 files, ~60MB each)
└── metadata/
    └── iceberg/
        ├── metadata.json
        └── manifests/
```

**Total storage**:
- Binary codes: 19.2GB
- Full vectors: 600GB
- Index: ~1GB
- **Total: ~620GB = $9.30/month on R2**

Compare to:
- Pinecone: ~$700/month for 100M vectors
- Weaviate managed: ~$500/month
- **99% cost reduction**

## 9. Novel Research Directions

### 9.1 Embedding Space Warping

Train a small network to WARP the embedding space such that similar items are even more clustered:

```
Original space: items spread across high-dimensional sphere
Warped space: items collapsed into tight, searchable clusters
```

The warping function is trained to minimize intra-cluster distance while maximizing inter-cluster distance.

**This is like learned dimensionality reduction, but preserves the original dimensionality for compatibility.**

### 9.2 Semantic Chunking for Index

Instead of random chunking, use semantic boundaries:

1. Cluster vectors by meaning
2. Store clusters as Parquet files
3. Name files by semantic content (using LLM to generate descriptions)
4. At query time, use embedding of query to predict relevant file names

**Files become semantic units, not just storage units.**

### 9.3 Negative Mining for Index Optimization

Train the routing/lookup model with hard negatives:
- For each query, include vectors that are CLOSE but NOT relevant
- Model learns to distinguish "near miss" clusters
- Results in sharper cluster boundaries

### 9.4 Query-Adaptive Routing

Different queries might benefit from different search strategies:

```
Query Classifier -> {
  "navigational": use exact match index
  "semantic": use embedding search
  "hybrid": combine both
}
```

Train a small classifier to route queries to optimal search paths.

## 10. Implementation Roadmap

### Phase 1: Baseline (Week 1-2)
- Implement k-means clustering for Parquet file assignment
- Store centroids in Worker memory
- Simple two-phase search: coarse + exact

### Phase 2: Binary Quantization (Week 3-4)
- Add binary codes alongside full vectors
- Implement WASM Hamming distance
- Three-phase: coarse -> binary filter -> exact

### Phase 3: Learned Routing (Week 5-6)
- Train MLP to predict relevant clusters
- Replace k-means centroids with neural router
- Benchmark recall vs latency

### Phase 4: Matryoshka (Week 7-8)
- Generate Matryoshka embeddings for corpus
- Implement progressive precision search
- Optimize dimension loading from Parquet

### Phase 5: Production Hardening (Week 9-10)
- Iceberg integration for metadata
- Incremental index updates
- Monitoring and observability

## 11. Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Recall degradation with quantization | Use larger candidate sets, cross-encoder reranking |
| Cold start latency (loading centroids) | Preload in Durable Objects, warm pool |
| R2 latency spikes | Multi-region replication, request hedging |
| Index update complexity | Batch updates, eventual consistency model |
| Training data requirements | Use public datasets (Wikipedia, CC) for pretraining |

## 12. Conclusion

The key insight is that **the index doesn't have to be a traditional data structure**. By leveraging:

1. **Neural networks as indexes** - Learn spatial structure instead of storing it
2. **Multi-precision representations** - Matryoshka embeddings, binary codes
3. **Iceberg's existing infrastructure** - Partition pruning, column projection
4. **Workers' compute capabilities** - WASM for fast binary operations

We can achieve Wikipedia-scale vector search at 1/100th the cost of managed vector databases.

The unconventional approaches here are unproven at scale, but the fundamentals are sound:
- Information theory: compression + smart routing
- Machine learning: learn the structure, don't hard-code it
- Systems: use cheap storage, minimize network round trips

**Next step**: Build a proof-of-concept with 10M vectors to validate the architecture before scaling to 100M+.
