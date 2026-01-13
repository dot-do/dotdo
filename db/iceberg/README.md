# db/iceberg - Direct Iceberg Navigation

Fast point lookups from R2 Data Catalog without R2 SQL overhead.

## Why

| Path | Latency | Use Case |
|------|---------|----------|
| Direct Iceberg | 50-150ms | Point lookups by ns/type/id |
| R2 SQL | 500ms-2s | Analytics, aggregations, search |

For single-record retrieval, direct navigation is 3-10x faster.

## Navigation Chain

```
metadata.json          →  ~10-50ms
    ↓
current-snapshot-id
    ↓
manifest-list.avro     →  ~10-50ms
    ↓
filter by partition (ns + type)
    ↓
manifest-file.avro     →  ~10-50ms
    ↓
column stats → which Parquet has id?
    ↓
data-file.parquet      →  ~10-50ms (optional)
```

## Use Cases

- **Event history** - Retrieve DO event stream without SQL
- **DO cloning** - Copy state from one DO to another
- **Artifact lookup** - Get compiled ESM, AST, HTML by id
- **Cross-DO queries** - Fast lookups across namespaces

## API

```typescript
import { IcebergReader } from './db/iceberg'

const reader = new IcebergReader(env.R2)

// Point lookup - returns file path or null
const file = await reader.findFile({
  table: 'do_resources',
  partition: { ns: 'payments.do', type: 'Function' },
  id: 'charge'
})

// Get record (reads Parquet)
const record = await reader.getRecord({
  table: 'do_resources',
  partition: { ns: 'payments.do', type: 'Function' },
  id: 'charge'
})
```

## Schema

Iceberg tables use partition-by for efficient pruning:

```sql
CREATE TABLE do_resources (
  ns STRING,
  type STRING,
  id STRING,
  ts TIMESTAMP,
  mdx STRING,
  data STRUCT<...>,
  esm STRING,
  dts STRING,
  mdast STRUCT<...>,
  hast STRUCT<...>,
  estree STRUCT<...>,
  tsast STRUCT<...>,
  html STRING,
  markdown STRING
)
PARTITIONED BY (ns, type)
```

## Implementation

- `types.ts` - Iceberg metadata types
- `reader.ts` - IcebergReader class
- `metadata.ts` - Parse metadata.json
- `manifest.ts` - Parse Avro manifests
- `parquet.ts` - Optional Parquet reading (parquet-wasm)
