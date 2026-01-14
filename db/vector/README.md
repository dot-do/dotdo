# VectorStore

> Embedding storage with Matryoshka compression and hybrid FTS+vector search

## Overview

VectorStore provides optimized storage for vector embeddings with native support for Matryoshka representation learning, progressive search, and hybrid FTS5+vector fusion using Reciprocal Rank Fusion (RRF).

## Features

- **Matryoshka embeddings** - Truncatable embeddings that preserve semantics
- **Progressive search** - Binary → Matryoshka → PQ → Exact rerank
- **Hybrid search** - FTS5 + vector with RRF fusion
- **libSQL vec0** - Native vector operations via vec0 extension
- **Three-tier storage** - Hot/warm/cold automatic tiering

## Three-Tier Storage

```
┌─────────────────────────────────────────────────────────────────┐
│ HOT: DO SQLite                                                  │
│ • HNSW index for approximate nearest neighbor                   │
│ • Binary hash signatures (1-bit per dimension)                  │
│ • Matryoshka 64-dim prefixes for fast filtering                 │
│ • FTS5 index for full-text search                               │
│ Access: <1ms for top-k                                          │
├─────────────────────────────────────────────────────────────────┤
│ WARM: R2 Parquet                                                │
│ • Matryoshka 128/256-dim prefixes                               │
│ • Product quantization (PQ) codes                               │
│ • Clustered by semantic similarity                              │
│ • LSH buckets for fast candidate retrieval                      │
│ Access: ~20ms for candidate set                                 │
├─────────────────────────────────────────────────────────────────┤
│ COLD: R2 Iceberg Archive                                        │
│ • Full 1536-dim vectors (or original dimension)                 │
│ • Exact similarity for final reranking                          │
│ • Historical embeddings for drift analysis                      │
│ Access: ~100ms for exact rerank                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Parquet Schema (Warm/Cold)

```
vectors.parquet:
├── id: string
├── mat_64: float[64]      # Matryoshka 64-dim prefix
├── mat_256: float[256]    # Matryoshka 256-dim prefix
├── pq_codes: uint8[192]   # Product quantization codes
├── binary_hash: bytes[192] # 1536-bit binary signature
├── lsh_bucket: string     # LSH locality hash
├── full_vector: float[1536] # Original embedding
└── metadata: json
```

## Matryoshka Embeddings

Matryoshka embeddings are trained so the first N dimensions are a valid embedding:

```typescript
import { MatryoshkaHandler, truncateEmbedding } from 'dotdo/db/vector'

const handler = new MatryoshkaHandler({ originalDimension: 1536 })

// Truncate 1536-dim to 256-dim (83% storage savings)
const truncated = handler.truncate(embedding, 256)

// Cross-dimension similarity (works!)
const similarity = handler.crossDimensionSimilarity(vec1536, vec256)

// Storage savings
const savings = handler.getStorageSavings(256)
// { originalBytes: 6144, truncatedBytes: 1024, savingsPercent: 83.3 }
```

### Supported Dimensions

Standard Matryoshka dimensions: `64, 128, 256, 384, 512, 768, 1024, 1536`

## Progressive Vector Search

```
Query Embedding (1536-dim)
         │
         ▼
┌─────────────────────────────────────┐
│ Stage 1: Binary Hash (HOT)          │
│ • Hamming distance on 1-bit codes   │
│ • ~10,000 candidates → 1,000        │
│ • <1ms                              │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ Stage 2: Matryoshka 64-dim (HOT)    │
│ • Cosine on 64-dim prefixes         │
│ • 1,000 candidates → 100            │
│ • <5ms                              │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ Stage 3: Matryoshka 256-dim (WARM)  │
│ • Cosine on 256-dim from Parquet    │
│ • 100 candidates → 20               │
│ • <20ms                             │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│ Stage 4: Exact Rerank (COLD)        │
│ • Full 1536-dim cosine similarity   │
│ • 20 candidates → 10 final results  │
│ • <50ms                             │
└─────────────────────────────────────┘
```

## Hybrid Search (FTS5 + Vector)

Combine full-text search with vector similarity using Reciprocal Rank Fusion:

```typescript
import { HybridSearch } from 'dotdo/db/vector'

const search = new HybridSearch(db)

const results = await search.query({
  // Text query (for FTS5)
  query: 'machine learning frameworks python',

  // Vector query (for similarity)
  embedding: await embed('machine learning frameworks python'),

  // Fusion settings
  limit: 10,
  ftsWeight: 0.4,      // BM25 weight
  vectorWeight: 0.6,   // Cosine similarity weight

  // Matryoshka settings
  vectorDim: 256,      // Use 256-dim for speed

  // Optional filters
  where: { $type: 'Document' },
})
```

### Reciprocal Rank Fusion (RRF)

```typescript
// RRF Score = Σ 1/(k + rank_i)
// where k = 60 (constant), rank_i = rank in each result set

// Example:
// Document A: FTS rank 1, Vector rank 3
// RRF = 1/(60+1) + 1/(60+3) = 0.0164 + 0.0159 = 0.0323

// Document B: FTS rank 5, Vector rank 1
// RRF = 1/(60+5) + 1/(60+1) = 0.0154 + 0.0164 = 0.0318

// Result: A ranks higher (benefits from good FTS + decent vector)
```

## API

```typescript
import { VectorStore } from 'dotdo/db/vector'

const vectors = new VectorStore(db, {
  dimension: 1536,
  matryoshkaDims: [64, 256, 1536],  // Stored dimensions
})

// Insert with automatic Matryoshka truncation
await vectors.insert({
  id: 'doc_123',
  content: 'Machine learning frameworks for Python',
  embedding: fullEmbedding,  // 1536-dim
  metadata: { source: 'docs', category: 'ml' }
})

// Similarity search (uses progressive stages)
const similar = await vectors.search({
  embedding: queryEmbedding,
  limit: 10,
  filter: { 'metadata.category': 'ml' }
})

// Hybrid search (FTS + vector)
const hybrid = await vectors.hybridSearch({
  query: 'python machine learning',
  embedding: queryEmbedding,
  limit: 10,
})

// Batch insert
await vectors.insertBatch(documents.map(doc => ({
  id: doc.id,
  content: doc.text,
  embedding: doc.embedding,
})))
```

## Schema

```sql
-- Hot tier: DO SQLite with vec0 extension
CREATE VIRTUAL TABLE vectors USING vec0(
  id TEXT PRIMARY KEY,
  embedding FLOAT[1536]
);

-- Matryoshka prefixes for progressive search
CREATE TABLE vector_prefixes (
  id TEXT PRIMARY KEY,
  mat_64 BLOB,           -- 64-dim as Float32Array
  mat_256 BLOB,          -- 256-dim as Float32Array
  binary_hash BLOB,      -- 1-bit per dim (192 bytes for 1536)
  lsh_bucket TEXT        -- LSH locality hash
);

-- FTS5 for hybrid search
CREATE VIRTUAL TABLE vector_fts USING fts5(
  id,
  content,
  tokenize='porter'
);

-- Semantic clustering index
CREATE INDEX idx_vectors_lsh ON vector_prefixes(lsh_bucket);
CREATE INDEX idx_vectors_semantic ON vector_prefixes(
  substr(mat_64, 1, 16)  -- First 4 floats as cluster key
);
```

## CDC Events

```typescript
// On insert
{
  type: 'cdc.insert',
  op: 'c',
  store: 'vector',
  table: 'vectors',
  key: 'doc_123',
  after: {
    dimension: 1536,
    matryoshkaDims: [64, 256],
    hasContent: true
  }
}

// On batch insert
{
  type: 'cdc.batch_insert',
  op: 'c',
  store: 'vector',
  count: 100,
  partition: 'cluster=ml-python'
}
```

## Performance Targets

| Operation | Target | Notes |
|-----------|--------|-------|
| Insert (single) | < 10ms | With Matryoshka truncation |
| Insert (batch 100) | < 100ms | Parallel truncation |
| Search (1M vectors) | < 20ms p50 | Progressive stages |
| Search (100M vectors) | < 50ms p50 | With warm tier |
| Hybrid search | < 30ms p50 | FTS + vector fusion |
| Recall@10 | > 98% | Exact rerank on final |

## Dependencies

None for core. Optional:
- `@cloudflare/vectorize` - For Cloudflare Vectorize backend
- `libsql` - For native vec0 extension

## Related

- [`db/core/vector/matryoshka.ts`](../core/vector/matryoshka.ts) - Matryoshka implementation
- [`db/search.ts`](../search.ts) - Search schema with FTS + vector
- [`docs/internal/spikes/vector-search-infrastructure.md`](../../docs/internal/spikes/vector-search-infrastructure.md) - Full architecture spike

## Implementation Status

| Feature | Status |
|---------|--------|
| Matryoshka truncation | ✅ Exists |
| Binary quantization | ✅ Exists |
| Progressive search | TBD |
| Hybrid FTS+vector | TBD |
| RRF fusion | TBD |
| libSQL vec0 integration | TBD |
| Hot → Warm tiering | TBD |
| Warm → Cold tiering | TBD |
| CDC integration | TBD |
