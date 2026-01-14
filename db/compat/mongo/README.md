# MongoDB-Compatible Query Engine for Cloudflare Workers

> Run MongoDB queries on globally distributed Durable Object indexes over R2 Iceberg cold storage

## Overview

This module provides MongoDB-compatible query semantics on Cloudflare's edge infrastructure:

```typescript
import { MongoClient } from '@dotdo/mongo'

const client = new MongoClient({ namespace: 'my-app' })
const db = client.db('production')

// Find with query operators
const users = await db.collection('User').find({
  'data.email': { $regex: '@acme.com$' },
  'data.age': { $gte: 18 },
  status: { $in: ['active', 'trial'] }
}).limit(100).toArray()

// Aggregation pipeline
const topCustomers = await db.collection('Order').aggregate([
  { $match: { 'data.status': 'completed' } },
  { $group: { 
    _id: '$data.customerId',
    totalSpent: { $sum: '$data.amount' },
    orderCount: { $count: {} }
  }},
  { $sort: { totalSpent: -1 } },
  { $limit: 10 }
]).toArray()

// Vector similarity search
const similar = await db.collection('Product').find({
  $vector: { $near: embedding, $k: 10 }
}).toArray()

// Full-text search
const results = await db.collection('Article').find({
  $text: { $search: 'cloudflare workers' }
}).toArray()
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           GLOBAL EDGE NETWORK                                   │
│                                                                                 │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐               │
│  │   SFO   │  │   NYC   │  │   LON   │  │   FRA   │  │   SIN   │  ... 300+     │
│  │  Worker │  │  Worker │  │  Worker │  │  Worker │  │  Worker │    colos      │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘               │
│       │            │            │            │            │                     │
│       └────────────┴────────────┼────────────┴────────────┘                     │
│                                 │                                               │
│                    ┌────────────▼────────────┐                                  │
│                    │     Query Router        │                                  │
│                    │  • Parse MongoDB query  │                                  │
│                    │  • Route to shards      │                                  │
│                    │  • Merge results        │                                  │
│                    └────────────┬────────────┘                                  │
│                                 │                                               │
│         ┌───────────────────────┼───────────────────────┐                       │
│         ▼                       ▼                       ▼                       │
│  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐               │
│  │ Index DO Shard  │   │ Index DO Shard  │   │ Index DO Shard  │               │
│  │   (type=User)   │   │  (type=Order)   │   │ (type=Product)  │               │
│  │ • Bloom Filters │   │ • Bloom Filters │   │ • Bloom Filters │               │
│  │ • Min/Max Stats │   │ • Min/Max Stats │   │ • Min/Max Stats │               │
│  │ • FTS GIN Index │   │ • FTS GIN Index │   │ • HNSW Vector   │               │
│  └────────┬────────┘   └────────┬────────┘   └────────┬────────┘               │
│           │ prune              │ prune              │ prune                    │
│           ▼                    ▼                    ▼                          │
│  ┌─────────────────────────────────────────────────────────────────────────────┐│
│  │                        R2 ICEBERG (Cold Storage)                            ││
│  │  things/type=User/*.parquet  things/type=Order/*.parquet  ...               ││
│  │  Edge-cached at requesting colo • ~100ms cold • <10ms warm                  ││
│  └─────────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────────┘
```

## Query Operators

### Comparison
| Operator | Description | Index Accelerated |
|----------|-------------|-------------------|
| `$eq` | Equals | ✅ Bloom filter |
| `$ne` | Not equals | ⚡ Scan |
| `$gt` | Greater than | ✅ Min/max |
| `$gte` | Greater or equal | ✅ Min/max |
| `$lt` | Less than | ✅ Min/max |
| `$lte` | Less or equal | ✅ Min/max |
| `$in` | In array | ✅ Bloom filter |
| `$nin` | Not in array | ⚡ Scan |

### Logical
| Operator | Description |
|----------|-------------|
| `$and` | Logical AND |
| `$or` | Logical OR |
| `$not` | Logical NOT |
| `$nor` | Logical NOR |

### Text & Vector Search
| Operator | Description | Index Accelerated |
|----------|-------------|-------------------|
| `$text` | Full-text search | ✅ GIN index |
| `$regex` | Pattern match | ⚡ Scan (prefix ✅) |
| `$vector.$near` | Similarity search | ✅ HNSW index |

## Aggregation Pipeline

### Stages (✅ = Implemented, 🚧 = Planned)

| Stage | Description | Status |
|-------|-------------|--------|
| `$match` | Filter documents | ✅ Uses indexes |
| `$project` | Select fields | ✅ |
| `$group` | Group and aggregate | ✅ |
| `$sort` | Sort results | ✅ |
| `$limit` | Limit results | ✅ |
| `$skip` | Skip results | ✅ |
| `$unwind` | Flatten arrays | ✅ |
| `$lookup` | Left join | ✅ |
| `$facet` | Multi-pipeline | ✅ |
| `$bucket` | Histogram | ✅ |
| `$count` | Count documents | ✅ Index-only |
| `$sample` | Random sample | ✅ |
| `$graphLookup` | Recursive join | 🚧 |
| `$merge` | Write to collection | 🚧 |

### Accumulators

| Accumulator | Status |
|-------------|--------|
| `$sum`, `$avg`, `$min`, `$max` | ✅ |
| `$first`, `$last` | ✅ |
| `$count`, `$push`, `$addToSet` | ✅ |
| `$stdDevPop`, `$stdDevSamp` | ✅ |

## Cost Comparison

| Query Pattern | Traditional OLAP | DO Accelerated | Savings |
|--------------|------------------|----------------|---------|
| COUNT(*) on 10M records | ~$0.01 | $0.000001 | **10,000x** |
| Email lookup (bloom) | ~$0.01 | $0.000001 | **10,000x** |
| Range query (25% data) | ~$0.01 | $0.0025 | **4x** |
| Vector search (k=10) | ~$0.10 | $0.000001 | **100,000x** |

## Installation

```bash
npm install @dotdo/mongo
```

## Quick Start

See [examples/](./examples/) for complete examples.
