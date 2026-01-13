# DO Database Architecture

> ClickHouse-grade analytics on Cloudflare Workers with 99%+ cost savings

## Core Insight

Cloudflare DOs bill per row read/written. By storing each **column as a separate SQLite row**, we achieve:

```
Traditional: 1000 records = 1000 row writes = $$$
Columnar:    1000 records = 6 row writes    = 99.4% savings
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  DO SQLite (Hot Index Layer)         R2 Iceberg (Cold Data)            │
│  ┌────────────────────────────┐     ┌────────────────────────────────┐ │
│  │ Index Columns:              │     │ Full Data:                     │ │
│  │ • _ids (all IDs)            │     │ • things/type=User/*.parquet   │ │
│  │ • _types (all types)        │────▶│ • things/type=Order/*.parquet  │ │
│  │ • bloom:data.email          │     │ • relationships/*.parquet      │ │
│  │ • minmax:createdAt          │     │                                │ │
│  └────────────────────────────┘     └────────────────────────────────┘ │
│  <1ms access, ~100MB index          ~100ms access, unlimited storage   │
└─────────────────────────────────────────────────────────────────────────┘
```

## Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| **Columnar Storage** | `compat/sql/clickhouse/` | Column-per-row DO storage |
| **JSON Columns** | `compat/sql/clickhouse/` | ClickHouse JSON type for typed subcolumns |
| **Query Accelerator** | `compat/sql/clickhouse/` | Index layer over R2 Iceberg |
| **Things + Relationships** | `core/` | Graph data model |

## Query Cost Comparison

| Query | Traditional | With Accelerator |
|-------|-------------|------------------|
| `SELECT COUNT(*)` | Scan all partitions | 1 DO row read |
| `WHERE type = 'User'` | Scan all | Partition pruning |
| `WHERE data.email = 'x'` | Scan all | Bloom filter check |
| `WHERE createdAt > date` | Scan all | Min/max pruning |

## Installation

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed design documentation.

See `compat/sql/clickhouse/spikes/` for working prototypes:
- `do-cost-optimization.ts` - Columnar storage strategies
- `json-columnar.ts` - Typed JSON column extraction
- `iceberg-index-accelerator.ts` - Query acceleration over R2
