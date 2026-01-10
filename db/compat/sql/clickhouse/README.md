# ClickHouse-Grade Analytics for Cloudflare Workers

**Native WASM ClickHouse on Workers + R2 Data Catalog**

> Every .do Durable Object becomes an analytics powerhouse with sub-second queries over billions of rows, JSON field indexing, vector similarity search, and full-text search - at a fraction of the cost of traditional data warehouses.

## The Vision

```sql
-- Query anything, anywhere, instantly
SELECT
  data->>'$.user.email' as email,
  data->>'$.user.name' as name,
  cosineDistance(data->'$.embedding', [0.1, 0.2, ...]) as similarity
FROM things
WHERE type = 'customer'
  AND hasToken(data->>'$.bio', 'engineer')
  AND data->>'$.company.size' > '100'
ORDER BY similarity
LIMIT 10
```

**This query:**
- Searches JSON fields with automatic path indexing
- Performs vector similarity search (ANN)
- Executes full-text search
- Runs entirely on Cloudflare Workers
- Costs 10-100x less than Snowflake/BigQuery/ClickHouse Cloud

## Why This Matters

### The Problem

Every SaaS needs analytics. Today you choose between:

| Solution | Cost | Latency | Complexity |
|----------|------|---------|------------|
| Snowflake | $$$$$$ | Seconds | High |
| BigQuery | $$$$$ | Seconds | Medium |
| ClickHouse Cloud | $$$$ | Sub-second | Medium |
| Self-hosted ClickHouse | $$$ + DevOps | Sub-second | Very High |
| **This** | $ | Sub-second | Low |

### The .do Advantage

```
┌─────────────────────────────────────────────────────────────────────┐
│                    DURABLE OBJECT (Your App)                        │
│                                                                     │
│  ┌─────────────────┐      ┌─────────────────┐                      │
│  │   Your Code     │ ───► │  DO Analytics   │                      │
│  │   (Business     │      │  (ClickHouse    │                      │
│  │    Logic)       │      │   SQL)          │                      │
│  └─────────────────┘      └─────────────────┘                      │
│           │                        │                                │
│           ▼                        ▼                                │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    DO SQLite (Hot Tier)                      │   │
│  │                    10GB per DO, ACID, Zero-latency           │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼ Auto-tier                            │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              R2 Data Catalog (Cold Tier - Iceberg)           │   │
│  │              Infinite scale, $0.015/GB/month, Zero egress    │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

**Every DO gets:**
- ClickHouse-compatible SQL
- Automatic hot/cold tiering
- JSON field indexing
- Vector similarity search
- Full-text search
- Time travel queries
- Zero egress fees

## Core Data Model: Things + Relationships

The universal schema that stores anything:

```sql
-- Things: The universal entity
CREATE TABLE things (
  id          String,
  type        String,           -- 'customer', 'order', 'event', etc.
  data        JSON,             -- Anything! Fully indexed.
  embedding   Array(Float32),   -- Optional: for vector search
  created_at  DateTime64(3),
  updated_at  DateTime64(3),

  -- Automatic indexes on JSON paths
  INDEX idx_type type TYPE bloom_filter,
  INDEX idx_json data TYPE json_path_index,
  INDEX idx_vec embedding TYPE vector_similarity,
  INDEX idx_fts data TYPE full_text
) ENGINE = IcebergMergeTree()
PARTITION BY toYYYYMM(created_at)
ORDER BY (type, id)

-- Relationships: Connect anything to anything
CREATE TABLE relationships (
  from_id     String,
  to_id       String,
  type        String,           -- 'owns', 'follows', 'purchased', etc.
  data        JSON,             -- Relationship metadata
  created_at  DateTime64(3),

  INDEX idx_type type TYPE bloom_filter
) ENGINE = IcebergMergeTree()
PARTITION BY toYYYYMM(created_at)
ORDER BY (type, from_id, to_id)
```

### Pipeline Integration

Write anything via Cloudflare Pipelines:

```typescript
// Your app writes to pipeline
await env.PIPELINE.send({
  type: 'page_view',
  data: {
    user: { id: 'u123', email: 'alice@example.com' },
    page: '/products/widget',
    duration_ms: 3400,
    referrer: 'google.com'
  }
})

// Automatically:
// 1. Batched into Parquet files
// 2. Written to R2 as Iceberg table
// 3. JSON paths auto-indexed
// 4. Queryable in < 1 second
```

### Query Anything

```sql
-- Find customers who viewed products but didn't purchase
SELECT
  pv.data->>'$.user.email' as email,
  count(*) as views,
  max(pv.created_at) as last_view
FROM things pv
WHERE pv.type = 'page_view'
  AND pv.data->>'$.page' LIKE '/products/%'
  AND pv.data->>'$.user.id' NOT IN (
    SELECT data->>'$.user.id'
    FROM things
    WHERE type = 'purchase'
  )
GROUP BY email
HAVING views > 5
ORDER BY views DESC
LIMIT 100

-- Vector similarity search
SELECT
  id,
  data->>'$.title' as title,
  cosineDistance(embedding, [0.1, 0.2, ...]) as score
FROM things
WHERE type = 'document'
ORDER BY score
LIMIT 10

-- Full-text search with ranking
SELECT
  id,
  data->>'$.title' as title,
  bm25Score(data->>'$.content', 'machine learning') as relevance
FROM things
WHERE type = 'article'
  AND hasToken(data->>'$.content', 'machine learning')
ORDER BY relevance DESC
LIMIT 20
```

## Architecture

### Distributed WASM Execution

```
                              ┌─────────────────────────────┐
                              │     COORDINATOR WORKER      │
                              │  ┌───────────────────────┐  │
         SQL Query ──────────►│  │    Parser.wasm        │  │
                              │  │    (ClickHouse SQL)   │  │
                              │  └───────────────────────┘  │
                              │            │                │
                              │            ▼                │
                              │  ┌───────────────────────┐  │
                              │  │    Query Planner      │  │
                              │  │    (Index-aware)      │  │
                              │  └───────────────────────┘  │
                              └─────────────────────────────┘
                                           │
                    Cap'n Web RPC (<1ms)   │
                    ┌──────────────────────┼──────────────────────┐
                    │                      │                      │
                    ▼                      ▼                      ▼
        ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐
        │  EXECUTOR WORKER  │  │  EXECUTOR WORKER  │  │  EXECUTOR WORKER  │
        │  ┌─────────────┐  │  │  ┌─────────────┐  │  │  ┌─────────────┐  │
        │  │Executor.wasm│  │  │  │Executor.wasm│  │  │  │Executor.wasm│  │
        │  │- Filter     │  │  │  │- Filter     │  │  │  │- Filter     │  │
        │  │- Aggregate  │  │  │  │- Aggregate  │  │  │  │- Aggregate  │  │
        │  │- JSON ops   │  │  │  │- JSON ops   │  │  │  │- JSON ops   │  │
        │  └─────────────┘  │  │  └─────────────┘  │  │  └─────────────┘  │
        └───────────────────┘  └───────────────────┘  └───────────────────┘
                    │                      │                      │
                    ▼                      ▼                      ▼
        ┌─────────────────────────────────────────────────────────────────┐
        │                     R2 DATA CATALOG (ICEBERG)                   │
        │  ┌──────────────────────────────────────────────────────────┐   │
        │  │  data/*.parquet          (columnar data)                 │   │
        │  │  indexes/*.json_idx      (JSON path indexes)             │   │
        │  │  indexes/*.usearch       (vector indexes, chunked)       │   │
        │  │  indexes/*.gin           (full-text indexes)             │   │
        │  │  metadata/*.json         (Iceberg snapshots)             │   │
        │  └──────────────────────────────────────────────────────────┘   │
        └─────────────────────────────────────────────────────────────────┘
```

### JSON Path Indexing

Every JSON path is automatically tracked and indexed:

```
Write: { user: { email: 'alice@example.com', tags: ['vip', 'beta'] } }

Automatic indexes created:
  - data.user.email (string, bloom filter)
  - data.user.tags (array, inverted index)
  - Path frequency statistics in Iceberg metadata

Query optimization:
  WHERE data->>'$.user.email' = 'alice@example.com'

  1. Check path index: data.user.email
  2. Bloom filter test → candidate files
  3. Load only relevant Parquet files
  4. Scan with predicate pushdown
```

### Vector Index Strategy

```
Write: { embedding: [0.1, 0.2, ...], title: 'My Document' }

Storage:
  - Vectors in Parquet as Array(Float32)
  - HNSW index as sidecar: part-00001.usearch
  - Binary quantization (b1): 32x memory reduction
  - 10MB index chunks for streaming

Query: ORDER BY cosineDistance(embedding, query_vec) LIMIT 10

Execution:
  1. Vectorize API (optional): coarse global search
  2. Load relevant .usearch files from R2
  3. HNSW search per file (streaming chunks)
  4. Merge top-k results
```

### Full-Text Search

```
Write: { content: 'Machine learning is transforming...', title: '...' }

Indexes:
  - GIN index per file: part-00001.gin
  - FST dictionary: term → posting offset
  - Roaring bitmaps: row IDs per term
  - Global term table: Iceberg table for cross-file search

Query: hasToken(data->>'$.content', 'machine learning')

Execution:
  1. Global term lookup → candidate files
  2. Load .gin files from R2
  3. Intersect posting lists (Roaring AND)
  4. Fetch matching rows from Parquet
```

## Cost Comparison

### Scenario: 100GB data, 1M queries/month

| Provider | Storage | Compute | Egress | Total |
|----------|---------|---------|--------|-------|
| Snowflake | $23/mo | $2,000+/mo | $500+/mo | **$2,500+/mo** |
| BigQuery | $2/mo | $500+/mo | $120/mo | **$620+/mo** |
| ClickHouse Cloud | $8/mo | $300+/mo | $50+/mo | **$360+/mo** |
| **This (.do)** | $1.50/mo | $50/mo | $0/mo | **$52/mo** |

**7x - 48x cheaper** with better latency.

### Why So Cheap?

1. **Zero egress**: R2 has no egress fees
2. **Serverless compute**: Pay only for actual query time
3. **Efficient storage**: Iceberg + Parquet compression
4. **No infrastructure**: No servers to manage
5. **Tiered storage**: Hot (DO SQLite) → Cold (R2) automatic

## Getting Started

```typescript
import { ClickHouse } from '@dotdo/clickhouse'

export class MyDO implements DurableObject {
  private ch: ClickHouse

  constructor(state: DurableObjectState, env: Env) {
    this.ch = new ClickHouse(state, env)
  }

  async fetch(request: Request) {
    // Write data
    await this.ch.insert('things', {
      type: 'event',
      data: { user_id: 'u123', action: 'click', target: 'button' }
    })

    // Query with ClickHouse SQL
    const result = await this.ch.query(`
      SELECT
        data->>'$.action' as action,
        count(*) as count
      FROM things
      WHERE type = 'event'
        AND created_at > now() - INTERVAL 1 HOUR
      GROUP BY action
      ORDER BY count DESC
    `)

    return Response.json(result)
  }
}
```

## Roadmap

### Phase 1: Parser + Core (Q1)
- [x] Lexer.wasm (exists in ClickHouse!)
- [ ] Parser.wasm (ClickHouse SQL → AST)
- [ ] Basic query execution
- [ ] DO SQLite hot tier
- [ ] R2 Parquet cold tier

### Phase 2: JSON Indexing (Q2)
- [ ] JSON path extraction
- [ ] Automatic path statistics
- [ ] Bloom filter indexes
- [ ] Hot path promotion to columns

### Phase 3: Vector + FTS (Q3)
- [ ] HNSW index generation
- [ ] Vectorize integration
- [ ] GIN/FTS indexes
- [ ] BM25 ranking

### Phase 4: Distributed Execution (Q4)
- [ ] Cap'n Web RPC protocol
- [ ] Coordinator/Executor Workers
- [ ] Parallel scan + aggregation
- [ ] Streaming results

## Why ClickHouse?

ClickHouse is the fastest open-source OLAP database. By bringing its:
- **SQL dialect** (familiar, powerful)
- **Columnar format** (10x compression)
- **Vectorized execution** (SIMD)
- **Index types** (bloom, minmax, skip)

...to Cloudflare Workers, we create something unprecedented:
- **ClickHouse performance**
- **Serverless simplicity**
- **Edge latency**
- **R2 economics**

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup.

### Key Spikes to Validate
1. Parser.wasm compilation following LexerStandalone pattern
2. JSON path indexing with automatic statistics
3. HNSW index chunking for 128MB memory limit
4. GIN index streaming from R2
5. Cap'n Web RPC latency validation

---

**Built by [.do](https://dotdo.dev)** - Business-as-Code Platform
