# db/ - Storage Primitives

> Unified storage abstractions for Durable Objects with native SQLite

## Overview

The `db/` module provides a comprehensive set of storage primitives that all share a common design philosophy:

1. **SQLite-native** - All primitives use DO's native SQLite, no external dependencies
2. **CDC-first** - Every write emits change events to the unified event stream
3. **Drizzle-optional** - Only RelationalStore requires Drizzle (peer dependency)
4. **Hybrid search** - FTS5 + vector search with Reciprocal Rank Fusion

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           Storage Primitives Layer                               │
│                                                                                  │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐        │
│   │ DocumentStore│  │  GraphStore  │  │RelationalStore│  │ColumnarStore │        │
│   │   (JSON)     │  │  (Edges)     │  │  (Drizzle)   │  │  (Analytics) │        │
│   └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘        │
│          │                 │                 │                 │                 │
│   ┌──────────────┐  ┌──────────────┐                                             │
│   │TimeSeriesStore│  │ VectorStore │                                             │
│   │  (Temporal)  │  │(Embeddings) │                                             │
│   └──────┬───────┘  └──────┬───────┘                                             │
│          │                 │                                                     │
│          └─────────────────┼─────────────────────────────────────────────────────┤
│                            ▼                                                     │
│   ┌──────────────────────────────────────────────────────────────────────────┐  │
│   │                        CDC (Change Data Capture)                          │  │
│   │                                                                           │  │
│   │  Every write → UnifiedEvent → Pipeline → R2 Iceberg                       │  │
│   └──────────────────────────────────────────────────────────────────────────┘  │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           Processing Primitives Layer                            │
│                                                                                  │
│   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                          │
│   │    Stream    │  │   Workflow   │  │    Window    │                          │
│   │  (Kafka)     │  │  (Temporal)  │  │   (Flink)    │                          │
│   └──────────────┘  └──────────────┘  └──────────────┘                          │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Three-Tier Storage Architecture

All store primitives support automatic tiering across hot, warm, and cold storage:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ Tier 1: DO SQLite (Hot)                                                         │
│ ┌─────────────────────────────────────────────────────────────────────────────┐ │
│ │ • Recent/active data in SQLite tables                                       │ │
│ │ • Columnar indexes (bloom filters, min/max stats)                           │ │
│ │ • Vector HNSW index for nearest neighbor                                    │ │
│ │ • FTS5 for full-text search                                                 │ │
│ │                                                                             │ │
│ │ Access: <1ms | Storage: ~100MB | Cost: $0.001/M reads                       │ │
│ └─────────────────────────────────────────────────────────────────────────────┘ │
│                                       │                                         │
│                                       ▼                                         │
│ Tier 2: R2 Parquet (Warm)                                                       │
│ ┌─────────────────────────────────────────────────────────────────────────────┐ │
│ │ • Partitioned Parquet files by type/date                                    │ │
│ │ • Matryoshka vector prefixes (64/128/256-dim)                               │ │
│ │ • Product quantization for compression                                      │ │
│ │ • Iceberg metadata for partition pruning                                    │ │
│ │                                                                             │ │
│ │ Access: ~50ms | Storage: ~10GB | Cost: $0.015/GB                            │ │
│ └─────────────────────────────────────────────────────────────────────────────┘ │
│                                       │                                         │
│                                       ▼                                         │
│ Tier 3: R2 Iceberg Archive (Cold)                                               │
│ ┌─────────────────────────────────────────────────────────────────────────────┐ │
│ │ things/                                                                     │ │
│ │ ├── type=Customer/dt=2024-01/*.parquet                                      │ │
│ │ ├── type=Order/dt=2024-01/*.parquet                                         │ │
│ │ └── metadata/snapshots/                                                     │ │
│ │                                                                             │ │
│ │ Access: ~100ms | Storage: Unlimited | Cost: $0.015/GB                       │ │
│ └─────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Tiering Strategy by Store

| Store | Hot (DO SQLite) | Warm (R2 Parquet) | Cold (R2 Iceberg) |
|-------|-----------------|-------------------|-------------------|
| DocumentStore | Recent documents | Older docs by type | Full archive |
| GraphStore | Active edges | Relationship snapshots | Historical graph |
| RelationalStore | Working set | Aggregated views | Full tables |
| ColumnarStore | Index columns only | Partitioned data | Raw columnar |
| TimeSeriesStore | Recent windows | Rolled-up aggregates | Raw time series |
| VectorStore | HNSW + binary hash | Matryoshka 64-256d | Full 1536d vectors |
| BlobStore | Metadata only | R2 Standard | R2 Infrequent Access |

### Query Flow

```
Query → Hot (index check) → Warm (if needed) → Cold (rare)
         │                    │                  │
         └── <1ms ───────────└── ~50ms ─────────└── ~100ms
```

## Store Primitives

| Store | Purpose | Key Features |
|-------|---------|--------------|
| [DocumentStore](./document/README.md) | JSON documents | Schema-free, JSONPath queries |
| [GraphStore](./graph/README.md) | Relationships/edges | Traversal, adjacency, cycles |
| [RelationalStore](./relational/README.md) | Typed rows | Drizzle schemas, migrations |
| [ColumnarStore](./columnar/README.md) | Analytics | 99.4% cost savings, aggregations |
| [TimeSeriesStore](./timeseries/README.md) | Time-indexed | Retention, compaction, range queries |
| [VectorStore](./vector/README.md) | Embeddings | Matryoshka, hybrid FTS+vector search |
| [BlobStore](./blob/README.md) | Binary objects | R2 primary, presigned URLs, dedup |

## Processing Primitives

| Primitive | Inspired By | Key Features |
|-----------|-------------|--------------|
| [Stream](./stream/README.md) | Kafka | Topics, partitions, consumer groups |
| [Workflow](./workflow/README.md) | Temporal | Activities, timers, signals, durable execution |
| [Window](./window/README.md) | Flink | Tumbling/sliding/session windows, watermarks |

## Cost Optimization

The columnar storage architecture achieves **99.4% cost savings** on Cloudflare DO billing:

```
Traditional: 1000 records = 1000 row writes = $1.00
Columnar:    1000 records = 6 row writes   = $0.006

Savings: 99.4%
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full cost analysis and query accelerator design.

## CDC & Events

All stores emit CDC events to a unified stream:

```typescript
interface UnifiedEvent {
  // Envelope
  id: string                    // Unique event ID
  type: string                  // 'Customer.created' | 'cdc.insert'
  timestamp: string             // ISO 8601
  ns: string                    // DO namespace
  correlationId?: string        // Request correlation

  // CDC fields (for store operations)
  op?: 'c' | 'u' | 'd' | 'r'   // create/update/delete/read
  store?: StoreType             // Which store primitive
  table?: string                // Table/collection name
  key?: string                  // Primary key
  before?: Record<string, unknown>
  after?: Record<string, unknown>

  // Domain event fields
  actor?: string                // Who triggered this
  data?: Record<string, unknown>
}
```

See [cdc/README.md](./cdc/README.md) for the full CDC specification.

## Type Annotations

Use `$store` annotation to route types to appropriate primitives:

```typescript
interface Customer {
  $store: 'document'  // → DocumentStore
  id: string
  name: string
  metadata: Record<string, unknown>
}

interface Transaction {
  $store: 'timeseries'  // → TimeSeriesStore
  id: string
  amount: number
  timestamp: Date
}

interface Embedding {
  $store: 'vector'  // → VectorStore
  id: string
  content: string
  embedding: Float32Array
}
```

## Hybrid Search

Native support for FTS5 + vector search with automatic fusion:

```typescript
import { HybridSearch } from 'dotdo/db/vector'

const search = new HybridSearch(db)

const results = await search.query({
  query: 'machine learning frameworks',
  embedding: await embed('machine learning frameworks'),
  limit: 10,
  ftsWeight: 0.4,      // BM25 weight
  vectorWeight: 0.6,   // Cosine similarity weight
  vectorDim: 256,      // Matryoshka truncation
})
```

See [vector/README.md](./vector/README.md) for full hybrid search documentation.

## Dependencies

| Package | Required By | Type |
|---------|-------------|------|
| `drizzle-orm` | RelationalStore only | Peer dependency |

All other primitives are dependency-free, using only native SQLite APIs.

## Directory Structure

```
db/
├── README.md              # This file
├── ARCHITECTURE.md        # Cost optimization & query accelerator
├── document/              # DocumentStore - JSON documents
├── graph/                 # GraphStore - Relationships/edges
├── relational/            # RelationalStore - Drizzle schemas
├── columnar/              # ColumnarStore - Analytics
├── timeseries/            # TimeSeriesStore - Time-indexed data
├── vector/                # VectorStore - Embeddings + hybrid search
├── stream/                # Stream primitives (Kafka-like)
├── workflow/              # Workflow primitives (Temporal-like)
├── window/                # Window primitives (Flink-like)
├── cdc/                   # CDC + Events unification
├── core/                  # Shared utilities (SQL parser, tiers, sharding)
├── streams/               # Pipeline SQL schemas (events.sql, things.sql, actions.sql)
├── migrations/            # Schema migration utilities
└── proxy/                 # DB Proxy for fluent queries
```

## Related Documentation

- [do/primitives/](../do/primitives/) - DO-specific primitives (TemporalStore, WindowManager, etc.)
- [streaming/](../streaming/) - Pipeline and streaming infrastructure
- [workflows/](../workflows/) - WorkflowContext ($) and event handlers
