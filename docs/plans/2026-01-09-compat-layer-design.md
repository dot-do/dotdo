# Compat Layer Design

> Drop-in SDK replacements for 40 databases/services backed by Durable Objects

## Overview

The `compat/` layer provides API-compatible packages that allow developers to use familiar database SDKs (Turso, MongoDB, Redis, etc.) while leveraging dotdo's DO infrastructure with integrated replication, sharding, pipelines, and tiered storage.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Application Code                                     │
│                                                                              │
│   import { createClient } from '@dotdo/turso'     // SDK compat             │
│   import { MongoClient } from '@dotdo/mongo'      // SDK compat             │
│   import { createClient } from '@dotdo/redis'     // SDK compat             │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                         @dotdo/* Packages                                    │
│                                                                              │
│   @dotdo/turso   │ @dotdo/postgres │ @dotdo/mongo  │ @dotdo/redis │ ...    │
│        │                │                │               │                   │
│        └────────────────┴────────────────┴───────────────┘                   │
│                                    │                                         │
│                         Extended Config Options                              │
│                         • shards / shardKey                                  │
│                         • replicas / locations / colos                       │
│                         • pipeline / stream sink                             │
│                         • tier (hot/warm/cold)                               │
│                         • vector (pluggable engines)                         │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                         Core Adapters                                        │
│                                                                              │
│   ShardRouter   │   ReplicaManager   │   StreamBridge   │   TierManager     │
│   (10GB limit)  │   (jurisdiction/   │   (pipelines)    │   (hot/warm/cold) │
│                 │    region/city)    │                  │                    │
│                                                                              │
│                         VectorRouter                                         │
│   libsql │ edgevec │ vectorize │ clickhouse │ iceberg                       │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                         dotdo Primitives                                     │
│                                                                              │
│   DO (SQLite)  │  R2 (Objects)  │  Iceberg  │  Pipelines  │  fsx/gitx      │
│                                                                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                         Managed Services (*.do)                              │
│                                                                              │
│   turso.do  │  mongo.do  │  redis.do  │  kafka.do  │  firebase.do  │ ...   │
│   (hosted)     (hosted)     (hosted)     (hosted)      (hosted)              │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Two layers**:
1. **@dotdo/*** - SDK compat packages you `npm install` and use in your own Workers
2. ***.do** - Managed services (existing rewrites) that host it for you

## Extended Config Options

Every `@dotdo/*` package extends the original SDK's config with DO-specific options:

```typescript
import { createClient } from '@dotdo/turso'

const db = createClient({
  // Standard libsql options (100% compatible)
  url: 'libsql://my-db.turso.io',
  authToken: '...',

  // Extended DO options
  shard: {
    key: 'tenant_id',
    count: 16,
    algorithm: 'consistent',
  },

  replica: {
    jurisdiction: 'eu',
    regions: ['us-east-1', 'eu-west-1'],
    cities: ['iad', 'lhr', 'sin'],
    readFrom: 'nearest',
    writeThrough: true,
  },

  stream: {
    pipeline: 'EVENTS_PIPELINE',
    sink: 'iceberg',
  },

  tier: {
    hot: 'sqlite',
    warm: 'r2',
    cold: 'archive',
    hotThreshold: '1GB',
    coldAfter: '90d',
  },

  vector: {
    tiers: {
      hot: { engine: 'libsql', libsql: { dimensions: 128 } },
      cold: { engine: 'clickhouse', clickhouse: { index: 'usearch' } },
    },
    routing: { strategy: 'cascade' },
  },
})
```

## Package Matrix

### Tier 1 - Core (13 packages)

| Package | Original SDK | Category |
|---------|-------------|----------|
| `@dotdo/turso` | `@libsql/client` | SQL (libsql) |
| `@dotdo/postgres` | `pg` / `postgres` | SQL |
| `@dotdo/firebase` | `firebase/firestore` | Realtime Document |
| `@dotdo/mongo` | `mongodb` | Document |
| `@dotdo/mongoose` | `mongoose` | Document ODM |
| `@dotdo/supabase` | `@supabase/supabase-js` | SQL + Realtime |
| `@dotdo/postgrest` | `@supabase/postgrest-js` | REST Query Builder |
| `@dotdo/jsonapi` | various | REST Spec |
| `@dotdo/kafka` | `kafkajs` | Event Streaming |
| `@dotdo/nats` | `nats` | Pub/Sub |
| `@dotdo/redis` | `ioredis` / `redis` | Cache + Data Structures |
| `@dotdo/convex` | `convex` | Realtime + React |
| `@dotdo/neo4j` | `neo4j-driver` | Graph |

### Tier 2 - Data Warehouses (7 packages)

| Package | Original SDK | Category |
|---------|-------------|----------|
| `@dotdo/redshift` | `@aws-sdk/client-redshift-data` | Analytics (AWS) |
| `@dotdo/snowflake` | `snowflake-sdk` | Analytics |
| `@dotdo/databricks` | `@databricks/sql` | Analytics (Spark) |
| `@dotdo/bigquery` | `@google-cloud/bigquery` | Analytics (GCP) |
| `@dotdo/clickhouse` | `@clickhouse/client` | Analytics (OLAP) |
| `@dotdo/athena` | `@aws-sdk/client-athena` | Analytics (AWS) |
| `@dotdo/duckdb` | `duckdb` | Analytics (Embedded) |

### Tier 3 - More SQL (5 packages)

| Package | Original SDK | Category |
|---------|-------------|----------|
| `@dotdo/mysql` | `mysql2` | SQL |
| `@dotdo/planetscale` | `@planetscale/database` | SQL (Serverless MySQL) |
| `@dotdo/neon` | `@neondatabase/serverless` | SQL (Serverless Postgres) |
| `@dotdo/cockroach` | `pg` | SQL (Distributed) |
| `@dotdo/tidb` | `mysql2` | SQL (Distributed MySQL) |

### Tier 4 - More NoSQL (2 packages)

| Package | Original SDK | Category |
|---------|-------------|----------|
| `@dotdo/dynamodb` | `@aws-sdk/client-dynamodb` | Key-Value + Document |
| `@dotdo/couchdb` | `nano` / `pouchdb` | Document + Sync |

### Tier 5 - Search (4 packages)

| Package | Original SDK | Category |
|---------|-------------|----------|
| `@dotdo/elasticsearch` | `@elastic/elasticsearch` | Full-Text + Vector |
| `@dotdo/algolia` | `algoliasearch` | Search API |
| `@dotdo/meilisearch` | `meilisearch` | Search |
| `@dotdo/typesense` | `typesense` | Search |

### Tier 6 - Vector (4 packages)

| Package | Original SDK | Category |
|---------|-------------|----------|
| `@dotdo/pinecone` | `@pinecone-database/pinecone` | Vector DB |
| `@dotdo/weaviate` | `weaviate-ts-client` | Vector + Objects |
| `@dotdo/qdrant` | `@qdrant/js-client-rest` | Vector DB |
| `@dotdo/chroma` | `chromadb` | Vector + Embeddings |

### Tier 7 - Message/Event (2 packages)

| Package | Original SDK | Category |
|---------|-------------|----------|
| `@dotdo/sqs` | `@aws-sdk/client-sqs` | Queue (AWS) |
| `@dotdo/pubsub` | `@google-cloud/pubsub` | Pub/Sub (GCP) |

### Tier 8 - Realtime (3 packages)

| Package | Original SDK | Category |
|---------|-------------|----------|
| `@dotdo/pusher` | `pusher-js` | WebSocket Channels |
| `@dotdo/ably` | `ably` | Pub/Sub Channels |
| `@dotdo/socketio` | `socket.io-client` | WebSocket |

**Total: 40 packages**

## Core Adapters

### ShardRouter

Handles the 10GB DO limit by distributing data across multiple DOs:

```typescript
export interface ShardConfig {
  key: string                    // Field to shard on
  count: number                  // Number of shards (default: 16)
  algorithm: 'consistent' | 'range' | 'hash'
}

export class ShardRouter {
  // Get the DO stub for a given shard key value
  getShardStub(keyValue: string): DurableObjectStub

  // Fan-out query across all shards
  async queryAll<T>(query: Query): Promise<T[]>
}
```

### ReplicaManager

Handles geo-distribution with three levels of placement precision:

1. **Jurisdiction** - Data sovereignty (`eu`, `us`, `fedramp`) - guaranteed
2. **Region** - AWS-style (`us-east-1`, `eu-west-1`) - hint via locationHint
3. **City** - Precise via colo.do (`iad`, `lhr`, `sin`) - guaranteed

```typescript
export type Region =
  | 'us-east-1' | 'us-east-2' | 'us-west-1' | 'us-west-2'
  | 'eu-west-1' | 'eu-west-2' | 'eu-west-3' | 'eu-central-1'
  | 'ap-southeast-1' | 'ap-northeast-1'
  // ... etc

export type City = 'iad' | 'ewr' | 'ord' | 'lhr' | 'fra' | 'sin' | 'nrt' // ...

export type Jurisdiction = 'eu' | 'us' | 'fedramp'

export interface ReplicaConfig {
  jurisdiction?: Jurisdiction
  regions?: Region[]              // AWS-style, mapped to CF locationHint
  cities?: City[]                 // Precise via colo.do
  readFrom: 'nearest' | 'primary' | 'random'
  writeThrough: boolean
}
```

**Colo.do pattern** for guaranteed city placement:
- Each colo has a sentinel DO that runs there
- Creating a new DO from within that DO guarantees placement
- Call `ord.colo.do` to create a DO guaranteed to be in ORD

### StreamBridge

Connects to Cloudflare Pipelines for analytics sink:

```typescript
export interface StreamConfig {
  pipeline: string              // Binding name: 'EVENTS_PIPELINE'
  sink: 'iceberg' | 'parquet' | 'json'
  transform?: (row: unknown) => unknown
  batch?: { size: number; interval: number }
}

export class StreamBridge {
  async emit(operation: 'insert' | 'update' | 'delete', data: unknown): Promise<void>
  async flush(): Promise<void>
}
```

### TierManager

Handles hot/warm/cold data movement:

```typescript
export interface TierConfig {
  hot: 'sqlite'                 // Always SQLite in DO
  warm: 'r2'                    // R2 for overflow
  cold: 'archive'               // R2 Archive class
  hotThreshold: string          // '1GB', '500MB'
  coldAfter: string             // '90d', '30d'
}

export class TierManager {
  async checkHotTier(): Promise<void>   // Promote to warm if needed
  async archiveCold(): Promise<void>    // Move old data to cold
  async get(id: string): Promise<unknown> // Fetch from appropriate tier
}
```

## Vector Search

### Pluggable Tiers

```typescript
export type VectorEngine =
  | 'libsql'      // Native F32_BLOB in DO SQLite
  | 'edgevec'     // HNSW via Workers RPC (217KB WASM)
  | 'vectorize'   // Cloudflare managed
  | 'clickhouse'  // Analytics + ANN indexes (usearch/annoy/hnsw)
  | 'iceberg'     // R2 SQL (pre-computed LSH)

export interface VectorConfig {
  embedding?: {
    model: '@cf/baai/bge-m3' | '@cf/google/embeddinggemma-300m' | 'openai'
    autoEmbed: boolean
    dimensions: number
  }

  tiers: {
    hot?: VectorTierConfig & { maxVectors?: number; maxAge?: string }
    warm?: VectorTierConfig & { maxVectors?: number; maxAge?: string }
    cold?: VectorTierConfig
  }

  routing?: {
    strategy: 'cascade' | 'parallel' | 'smart'
  }
}
```

### Engine Comparison

| Engine | Latency | Capacity | Index Type | Best For |
|--------|---------|----------|------------|----------|
| `libsql` | <1ms | 10GB/DO | Brute/DiskANN | Hot tier, SQL-native |
| `edgevec` | ~1ms | Unlimited* | HNSW | Hot/warm, quality search |
| `vectorize` | ~5ms | Unlimited | HNSW | Managed, global corpus |
| `clickhouse` | 10-50ms | Unlimited | USearch/Annoy/HNSW | Analytics, hybrid search |
| `iceberg` | 50-500ms | Unlimited | LSH/PQ | Cold analytics, batch |

*via sharding across DOs

### EdgeVec as Workers RPC

Deploy EdgeVec (217KB WASM) as a dedicated worker to avoid bundle bloat:

```
┌─────────────────────────────────────────────┐
│           Your App Worker                    │
│   vector: { engine: 'edgevec' }             │
└──────────────────┬──────────────────────────┘
                   │ Service Binding (RPC)
                   ▼
┌─────────────────────────────────────────────┐
│         db/edgevec Worker (217KB)           │
│   EdgeVec WASM + EdgeVecDO for persistence  │
└─────────────────────────────────────────────┘
```

### MRL (Matryoshka Representation Learning)

Store truncated embeddings locally for fast search:
- **128-dim local**: 90% quality, 6x less storage, sub-ms search
- **768-dim global**: Full quality in Vectorize/ClickHouse for re-ranking

## Directory Structure

```
compat/
├── core/
│   ├── index.ts
│   ├── types.ts
│   ├── shard.ts
│   ├── replica.ts
│   ├── stream.ts
│   ├── tier.ts
│   ├── vector/
│   │   ├── index.ts
│   │   ├── types.ts
│   │   ├── engines/
│   │   │   ├── libsql.ts
│   │   │   ├── edgevec.ts
│   │   │   ├── vectorize.ts
│   │   │   ├── clickhouse.ts
│   │   │   └── iceberg.ts
│   │   └── merger.ts
│   └── query/
│       ├── translator.ts
│       ├── postgres.ts
│       ├── mysql.ts
│       └── mongo.ts
│
├── turso/
├── postgres/
├── mongo/
├── mongoose/
├── firebase/
├── supabase/
├── redis/
├── kafka/
├── nats/
├── convex/
├── neo4j/
├── clickhouse/
├── snowflake/
├── redshift/
├── bigquery/
├── databricks/
├── athena/
├── duckdb/
├── mysql/
├── planetscale/
├── neon/
├── cockroach/
├── tidb/
├── dynamodb/
├── couchdb/
├── elasticsearch/
├── algolia/
├── meilisearch/
├── typesense/
├── pinecone/
├── weaviate/
├── qdrant/
├── chroma/
├── sqs/
├── pubsub/
├── pusher/
├── ably/
└── socketio/
```

## Implementation Notes

### Package Implementation Pattern

Every `@dotdo/*` package:
1. Implements the original SDK's API exactly
2. Routes to DOs using shared primitives
3. Extends with DO-specific config (opt-in)
4. Streams to pipelines for analytics
5. Supports tiered vector search

### Example: @dotdo/turso

```typescript
import { createClient as createLibsqlClient } from '@libsql/client'
import { ShardRouter, ReplicaManager, StreamBridge, TierManager } from '../core'

export function createClient(config: DotdoTursoConfig): Client {
  // If url provided, proxy to real Turso (migration path)
  if (config.url && !config.env) {
    return createLibsqlClient(config)
  }

  // Otherwise, use DO-backed implementation
  return new DotdoTursoClient(config)
}

class DotdoTursoClient implements Client {
  async execute(stmt: InStatement): Promise<ResultSet> {
    const stub = await this.getStub(stmt)
    const response = await stub.fetch(/* ... */)

    // Stream writes to pipeline
    if (this.stream && this.isWrite(stmt)) {
      await this.stream.emit('execute', { stmt, result })
    }

    return response.json()
  }

  // libsql sync protocol support
  async sync(): Promise<void> {
    // Pull changes from primary to local replica
  }
}
```

## Related Work

- Existing rewrites in `~/projects/workers/rewrites/` (standalone *.do services)
- `db/iceberg/` - Direct Iceberg navigation for fast point lookups
- `streams/` - Event streaming from DOs to R2 SQL
- `db/objects.ts` - DO-to-DO references with sharding/replica support
- `search/README.md` - Three-tier vector architecture design
