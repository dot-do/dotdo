# Search Architecture

> Vector search and full-text search for the do.md framework.

## Overview

The search subsystem provides semantic similarity search across Things stored in Durable Objects, with a tiered architecture optimized for different use cases:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              SEARCH TIERS                                       │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│   Tier 1: DO Local          Tier 2: Vectorize         Tier 3: R2 Analytics     │
│   ─────────────────         ─────────────────         ──────────────────────   │
│                                                                                 │
│   ┌─────────────────┐       ┌─────────────────┐       ┌─────────────────────┐  │
│   │   DO SQLite     │       │   Cloudflare    │       │   R2 Data Catalog   │  │
│   │   128-dim MRL   │       │   Vectorize     │       │   Iceberg Tables    │  │
│   │   Flat scan     │       │   768-dim full  │       │   768-dim + meta    │  │
│   │   <1ms          │       │   HNSW index    │       │   R2-SQL queries    │  │
│   │   Per-DO scope  │       │   ~5ms          │       │   Analytics/batch   │  │
│   └─────────────────┘       │   Global scope  │       └─────────────────────┘  │
│                             └─────────────────┘                                 │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Embedding Strategy

### Model Selection: EmbeddingGemma on Workers AI

We use **EmbeddingGemma** (Google's open-weight model) on Cloudflare Workers AI because:

1. **MRL (Matryoshka) trained** - Single embedding can be truncated to 128, 256, 512, or 768 dims
2. **Edge execution** - Runs on Workers AI, no external API calls
3. **Open weights** - Can be fine-tuned for domain-specific use cases
4. **Multilingual** - Supports 100+ languages

```typescript
// Generate embedding with MRL truncation
async function embed(ai: Ai, text: string, dims: 128 | 256 | 512 | 768 = 768): Promise<Float32Array> {
  const result = await ai.run('@cf/google/embeddinggemma-300m', { text: [text] })
  const vec = result.data[0]

  if (dims < 768) {
    const truncated = vec.slice(0, dims)
    const norm = Math.sqrt(truncated.reduce((a, b) => a + b * b, 0))
    return new Float32Array(truncated.map(x => x / norm))
  }

  return new Float32Array(vec)
}
```

### Dimension Trade-offs

| Dimensions | Quality | Storage | Latency | Use Case |
|------------|---------|---------|---------|----------|
| 128 | ~90% | 512 B | <1ms | DO local filter |
| 256 | ~95% | 1 KB | ~1ms | Good balance |
| 512 | ~98% | 2 KB | ~2ms | High quality local |
| 768 | 100% | 3 KB | ~5ms | Global index |

## Tier 1: DO SQLite Local Search

Each Durable Object maintains a local search index with truncated embeddings for fast intra-DO queries.

### Schema (Drizzle)

```typescript
import { sqliteTable, text, integer, blob } from 'drizzle-orm/sqlite-core'

export const searchIndex = sqliteTable('search_index', {
  id: text('id').primaryKey(),
  thingId: text('thing_id').notNull().references(() => things.id),
  content: text('content').notNull(),
  embedding: blob('embedding', { mode: 'buffer' }).notNull(), // 128-dim × 4 bytes = 512 B
  createdAt: integer('created_at', { mode: 'timestamp' }),
})
```

### Indexing

```typescript
async function indexThing(thing: Thing): Promise<void> {
  const searchableText = extractSearchableText(thing)
  const embedding = await embed(this.ai, searchableText, 128) // Truncated

  await this.db.insert(searchIndex).values({
    id: crypto.randomUUID(),
    thingId: thing.id,
    content: searchableText,
    embedding: Buffer.from(embedding.buffer),
  })
}
```

### Querying

```typescript
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

async function searchLocal(query: string, limit = 10): Promise<SearchResult[]> {
  const queryVec = await embed(this.ai, query, 128)
  const rows = await this.db.select().from(searchIndex)

  return rows
    .map(row => ({
      thingId: row.thingId,
      content: row.content,
      score: cosineSimilarity(queryVec, new Float32Array(row.embedding))
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
```

### When to Use

- Searching within a single DO's Things
- Real-time autocomplete/typeahead
- <10K items per DO
- Sub-millisecond latency required

## Tier 2: Cloudflare Vectorize (Global)

For cross-DO search, we use Cloudflare Vectorize with full 768-dim embeddings.

### Configuration

```toml
# wrangler.toml
[[vectorize]]
binding = "VECTORIZE"
index_name = "things-index"
```

### Creating the Index

```bash
npx wrangler vectorize create things-index \
  --dimensions=768 \
  --metric=cosine
```

### Indexing

```typescript
async function indexToVectorize(thing: Thing): Promise<void> {
  const searchableText = extractSearchableText(thing)
  const embedding = await embed(this.ai, searchableText, 768) // Full

  await this.env.VECTORIZE.upsert([{
    id: thing.id,
    values: Array.from(embedding),
    metadata: {
      doId: this.doId,
      type: thing.type,
      name: thing.name,
    }
  }])
}
```

### Querying

```typescript
async function searchGlobal(query: string, limit = 100): Promise<SearchResult[]> {
  const queryVec = await embed(this.ai, query, 768)

  const results = await this.env.VECTORIZE.query(queryVec, {
    topK: limit,
    returnMetadata: true,
  })

  return results.matches.map(match => ({
    thingId: match.id,
    doId: match.metadata.doId,
    score: match.score,
  }))
}
```

### When to Use

- Cross-DO similarity search
- Finding related Things across tenants
- RAG retrieval from global knowledge base
- 10K - 10M items

## Tier 3: R2 Analytics (Batch/Historical)

For analytics queries over historical data, we stream embeddings to R2 Iceberg tables.

### Pipeline Configuration

```toml
# wrangler.toml
[[pipelines]]
name = "search-events"
binding = "SEARCH_PIPELINE"
```

### Streaming to R2

```typescript
async function streamToAnalytics(thing: Thing, embedding: Float32Array): Promise<void> {
  await this.env.SEARCH_PIPELINE.send([{
    id: thing.id,
    do_id: this.doId,
    type: thing.type,
    content: extractSearchableText(thing),
    embedding: Buffer.from(embedding.buffer).toString('base64'),
    created_at: new Date().toISOString(),
  }])
}
```

### R2-SQL Limitations

**Important**: R2-SQL does NOT support vector similarity functions. It has severe constraints:

| Feature | Supported | Notes |
|---------|-----------|-------|
| Basic comparisons | ✅ | `=`, `!=`, `<`, `>`, `BETWEEN` |
| Aggregations | ✅ | `COUNT(*)`, `SUM`, `AVG`, `MIN`, `MAX` |
| `LIKE` | ✅ | Prefix matching only (`'value%'`) |
| Arrays | ❌ | No array type support |
| JSON fields | ❌ | Cannot query JSON |
| Arithmetic | ❌ | No `+`, `-`, `*`, `/` in queries |
| Column comparisons | ❌ | No `WHERE a = b` |
| JOINs | ❌ | Single table only |
| Subqueries | ❌ | No nested queries |
| ORDER BY | ⚠️ | Partition keys only |

**The key insight**: *All similarity computation must happen at write time, not query time.* R2-SQL is a coarse filter; your application is the fine ranker.

### R2 Iceberg Schema (Future-Proof)

Store pre-computed similarity helpers alongside embeddings:

```sql
CREATE TABLE search_catalog.embeddings (
  -- Core identity
  id STRING,
  thing_id STRING,
  do_id STRING,
  content STRING,

  -- Pre-computed similarity helpers (for R2-SQL filtering)
  cluster_id INTEGER,              -- K-means cluster assignment
  cluster_distance FLOAT,          -- Distance to cluster centroid
  lsh_band_1 STRING,               -- LSH hash for LIKE prefix matching
  lsh_band_2 STRING,
  lsh_band_3 STRING,
  semantic_l1 STRING,              -- Hierarchical category (coarse)
  semantic_l2 STRING,              -- Hierarchical category (medium)
  semantic_l3 STRING,              -- Hierarchical category (fine)
  pq_s1 INTEGER,                   -- Product quantization subspace 1
  pq_s2 INTEGER,
  pq_s3 INTEGER,
  pq_s4 INTEGER,
  pca_dim_1 FLOAT,                 -- PCA projection for BETWEEN queries
  pca_dim_2 FLOAT,
  pca_dim_3 FLOAT,
  hilbert_key STRING,              -- Space-filling curve for range queries

  -- Full embedding (base64 for future native support)
  embedding_b64 STRING,

  -- Metadata
  created_at TIMESTAMP
) PARTITIONED BY (semantic_l1, cluster_id, DATE(created_at))
```

### Workarounds for R2-SQL Vector Search

Since R2-SQL can't compute similarity, we use pre-computed approaches:

#### Strategy 1: LSH Prefix Matching (Best for Recall)

Locality-Sensitive Hashing produces similar hashes for similar vectors. Use LIKE prefix matching:

```typescript
// At ingest time: compute LSH hashes
function computeLSH(embedding: Float32Array, numBands = 3, bitsPerBand = 8): string[] {
  const hyperplanes = getHyperplanes(numBands, bitsPerBand, embedding.length)
  return hyperplanes.map(planes => {
    const bits = planes.map(p => dotProduct(embedding, p) > 0 ? '1' : '0')
    return parseInt(bits.join(''), 2).toString(16).padStart(2, '0')
  })
}
```

```sql
-- Query: Similar vectors have similar LSH prefixes
SELECT id, content
FROM search_catalog.embeddings
WHERE lsh_band_1 LIKE 'A3F2%'
   OR lsh_band_2 LIKE 'C8D4%'
   OR lsh_band_3 LIKE '7B9A%'
LIMIT 500
```

**Why it works**: LSH is designed so similar vectors hash to similar strings. Prefix matching = approximate nearest neighbors.

#### Strategy 2: Cluster Assignment (Best for Partitioning)

Run k-means clustering on embeddings, partition by cluster_id:

```typescript
// At ingest time: assign to cluster
const clusterId = kmeans.predict(embedding)
const clusterDistance = euclideanDistance(embedding, kmeans.centroids[clusterId])
```

```sql
-- Query: Find docs in same cluster, ordered by distance to centroid
SELECT id, content, cluster_distance
FROM search_catalog.embeddings
WHERE cluster_id = 42
  AND created_at > '2026-01-01'
LIMIT 100
```

#### Strategy 3: Semantic Hierarchy (Best for Browsing)

Pre-compute hierarchical categories via clustering:

```typescript
// At ingest time: assign semantic "zipcode"
const semanticL1 = getTopLevelCategory(embedding)  // 'technology'
const semanticL2 = getMidLevelCategory(embedding)  // 'technology_ai'
const semanticL3 = getFineLevelCategory(embedding) // 'technology_ai_nlp'
```

```sql
-- Query: Navigate semantic hierarchy
SELECT id, content
FROM search_catalog.embeddings
WHERE semantic_l2 = 'technology_ai'
  AND cluster_id = 42
LIMIT 100
```

#### Strategy 4: Product Quantization (Best for Large Scale)

Divide vectors into subspaces, quantize each to centroid IDs:

```typescript
// At ingest time: quantize to subspace centroids
const [pq1, pq2, pq3, pq4] = productQuantize(embedding, codebooks)
```

```sql
-- Query: Filter by subspace centroids with range tolerance
SELECT id, content
FROM search_catalog.embeddings
WHERE pq_s1 = 42
  AND pq_s2 BETWEEN 5 AND 9
  AND pq_s3 BETWEEN 125 AND 135
LIMIT 200
```

#### Strategy 5: Hilbert Curve (Best for Range Queries)

Project embeddings onto a space-filling curve for lexicographic ordering:

```typescript
// At ingest time: compute Hilbert key from PCA projections
const pcaCoords = pca.transform(embedding).slice(0, 3)
const hilbertKey = hilbertEncode(pcaCoords) // 'AAAABBBBCCCCDDDD'
```

```sql
-- Query: Range scan on space-filling curve
SELECT id, content
FROM search_catalog.embeddings
WHERE hilbert_key BETWEEN 'AAAABBBBCCCC0000' AND 'AAAABBBBCCCCFFFF'
LIMIT 100
```

#### Strategy 6: Two-Phase (R2-SQL Filter → Vectorize Rank)

Use R2-SQL for coarse filtering, Vectorize for precise ranking:

```typescript
// Phase 1: R2-SQL for metadata + coarse similarity filtering
const candidates = await r2sql(`
  SELECT id
  FROM search_catalog.embeddings
  WHERE semantic_l2 = 'technology_ai'
    AND lsh_band_1 LIKE 'A3F2%'
    AND created_at > '2026-01-01'
  LIMIT 1000
`)

// Phase 2: Vectorize for precise similarity ranking
const queryVec = await embed(this.ai, query, 768)
const results = await this.env.VECTORIZE.query(queryVec, {
  topK: 10,
  filter: { id: { $in: candidates.map(c => c.id) } }
})
```

### Pre-Computation Pipeline

All similarity helpers are computed at ingest time:

```typescript
async function prepareForR2(thing: Thing, embedding: Float32Array): Promise<R2Record> {
  // Compute all pre-computed fields
  const lshBands = computeLSH(embedding, 3, 8)
  const clusterId = kmeans.predict(embedding)
  const clusterDistance = euclideanDistance(embedding, kmeans.centroids[clusterId])
  const [semanticL1, semanticL2, semanticL3] = getSemanticHierarchy(embedding)
  const [pq1, pq2, pq3, pq4] = productQuantize(embedding, codebooks)
  const pcaCoords = pca.transform(embedding).slice(0, 3)
  const hilbertKey = hilbertEncode(pcaCoords)

  return {
    id: thing.id,
    thing_id: thing.id,
    do_id: this.doId,
    content: extractSearchableText(thing),

    // Pre-computed helpers
    cluster_id: clusterId,
    cluster_distance: clusterDistance,
    lsh_band_1: lshBands[0],
    lsh_band_2: lshBands[1],
    lsh_band_3: lshBands[2],
    semantic_l1: semanticL1,
    semantic_l2: semanticL2,
    semantic_l3: semanticL3,
    pq_s1: pq1,
    pq_s2: pq2,
    pq_s3: pq3,
    pq_s4: pq4,
    pca_dim_1: pcaCoords[0],
    pca_dim_2: pcaCoords[1],
    pca_dim_3: pcaCoords[2],
    hilbert_key: hilbertKey,

    // Full embedding for future use
    embedding_b64: Buffer.from(embedding.buffer).toString('base64'),

    created_at: new Date().toISOString(),
  }
}
```

### Strategy Comparison

| Strategy | Best For | Recall | Precision | Complexity |
|----------|----------|--------|-----------|------------|
| **LSH Prefix** | General similarity | High | Medium | Medium |
| **Cluster ID** | Partitioned search | Medium | High | Low |
| **Semantic Hierarchy** | Category browsing | Medium | High | Low |
| **Product Quantization** | Large scale | High | Medium | High |
| **Hilbert Curve** | Range queries | Medium | Medium | Medium |
| **Two-Phase** | Filtered similarity | High | High | Medium |

**Recommended**: Combine **LSH Prefix** (recall) + **Semantic Hierarchy** (filtering) + **Two-Phase Vectorize** (precision)

### When to Use R2 Analytics

- Historical trend analysis
- Aggregate statistics over embeddings
- Compliance/audit queries with date filters
- Batch processing of large datasets

## Hybrid Search Strategy

The recommended approach combines all three tiers:

```typescript
async function search(query: string, options?: SearchOptions): Promise<SearchResult[]> {
  // 1. Try local first (fastest)
  if (!options?.global) {
    const local = await this.searchLocal(query, options?.limit)
    if (local.length > 0 && local[0].score > 0.8) {
      return local.map(r => ({ ...r, tier: 'local' }))
    }
  }

  // 2. Expand to Vectorize (global)
  const global = await this.searchGlobal(query, options?.limit)

  // 3. Optionally filter by R2-SQL metadata
  if (options?.dateRange || options?.type) {
    const filtered = await this.filterByMetadata(global.map(r => r.thingId), options)
    return global.filter(r => filtered.includes(r.thingId))
  }

  return global.map(r => ({ ...r, tier: 'global' }))
}
```

## Reranking with bge-reranker

For high-precision results, use the bge-reranker model to rerank top candidates:

```typescript
async function rerankResults(
  query: string,
  candidates: SearchResult[],
  topK = 10
): Promise<SearchResult[]> {
  const pairs = candidates.slice(0, 50).map(c => ({
    query,
    document: c.content
  }))

  const scores = await this.ai.run('@cf/baai/bge-reranker-base', { pairs })

  return candidates
    .slice(0, 50)
    .map((c, i) => ({ ...c, rerankScore: scores[i] }))
    .sort((a, b) => b.rerankScore - a.rerankScore)
    .slice(0, topK)
}
```

## Storage Cost Analysis

| Tier | Dimensions | Per Vector | 1M Vectors | Cost Driver |
|------|------------|------------|------------|-------------|
| DO SQLite | 128 | 512 B | 512 MB | DO storage |
| Vectorize | 768 | 3 KB | 3 GB | Vectorize pricing |
| R2 Iceberg | 768 + meta | ~4 KB | 4 GB | R2 storage |

### MRL Savings

Using 128-dim instead of 768-dim reduces storage by **6x** while retaining ~90% of semantic quality.

## Future Improvements

### Expected R2-SQL Vector Support

Based on industry trends (pgvector, sqlite-vec), Cloudflare will likely add:

| Expected Feature | pgvector Syntax | Likely R2-SQL Syntax |
|------------------|-----------------|----------------------|
| Cosine distance | `<=>` | `cosine_distance(a, b)` or `<=>` |
| Euclidean distance | `<->` | `l2_distance(a, b)` or `<->` |
| Inner product | `<#>` | `inner_product(a, b)` or `<#>` |
| Vector type | `vector(768)` | `VECTOR(768)` or `FLOAT32_ARRAY` |
| KNN query | `ORDER BY col <=> query LIMIT k` | Similar |

### Migration Path

When native vector support arrives:

```typescript
// Today: Pre-computed approach
const results = await r2sql(`
  SELECT id, content
  FROM embeddings
  WHERE lsh_band_1 LIKE '${queryLSH}%'
  LIMIT 100
`)

// Future: Native vector similarity
const results = await r2sql(`
  SELECT id, content, cosine_distance(embedding, ${queryVec}) as distance
  FROM embeddings
  ORDER BY distance ASC
  LIMIT 100
`)
```

### Abstraction Layer for Seamless Transition

```typescript
class R2VectorSearch {
  private useNativeVectors = false // Feature flag

  async search(query: string, limit = 100): Promise<SearchResult[]> {
    const queryVec = await embed(this.ai, query, 768)

    if (this.useNativeVectors) {
      // Future: Native R2-SQL vector support
      return this.nativeVectorSearch(queryVec, limit)
    } else {
      // Today: Pre-computed LSH + Vectorize fallback
      return this.preComputedSearch(queryVec, limit)
    }
  }

  private async nativeVectorSearch(queryVec: Float32Array, limit: number) {
    // When R2-SQL adds vector support
    return r2sql(`
      SELECT id, content, cosine_distance(embedding, ?) as score
      FROM embeddings
      ORDER BY score ASC
      LIMIT ?
    `, [queryVec, limit])
  }

  private async preComputedSearch(queryVec: Float32Array, limit: number) {
    // Today's approach: LSH + Vectorize
    const lshBands = computeLSH(queryVec)
    const candidates = await r2sql(`
      SELECT id FROM embeddings
      WHERE lsh_band_1 LIKE '${lshBands[0].slice(0, 4)}%'
      LIMIT 1000
    `)
    return this.env.VECTORIZE.query(queryVec, {
      topK: limit,
      filter: { id: { $in: candidates.map(c => c.id) } }
    })
  }
}
```

### Roadmap

1. **Today**: Pre-computed LSH + semantic hierarchy + Two-Phase with Vectorize
2. **Near-term**: Monitor R2-SQL beta for vector function announcements
3. **When available**: Enable native vectors via feature flag, migrate schema
4. **Long-term**: Remove pre-computed columns, use pure vector queries

### Additional Improvements

1. **Hybrid Dense+Sparse**: Use bge-m3's sparse vectors for keyword matching combined with dense for semantic
2. **Incremental Indexing**: Stream deltas instead of full reindex
3. **Cross-DO Sharding**: Consistent hashing for distributed search across related DOs
4. **Adaptive Quantization**: Dynamically choose dimension based on query complexity

## Configuration

```typescript
// search.config.ts
export const searchConfig = {
  embedding: {
    model: '@cf/google/embeddinggemma-300m',
    localDimensions: 128,    // For DO SQLite
    globalDimensions: 768,   // For Vectorize/R2
  },
  vectorize: {
    indexName: 'things-index',
    metric: 'cosine',
  },
  reranker: {
    model: '@cf/baai/bge-reranker-base',
    topK: 50,  // Candidates to rerank
  },
  thresholds: {
    localConfidence: 0.8,   // Use local if score > this
    rerankThreshold: 0.5,   // Rerank if score < this
  }
}
```
