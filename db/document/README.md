# DocumentStore

> Schema-free JSON document storage with JSONPath queries

## Overview

DocumentStore provides MongoDB-like document storage using SQLite's JSON capabilities. Documents are stored as JSON blobs with automatic indexing and JSONPath query support.

## Features

- **Schema-free** - Store any JSON structure without predefined schemas
- **JSONPath queries** - Query nested fields with `json_extract()`
- **Automatic indexing** - Bloom filters and min/max indexes on frequently queried paths
- **CDC integration** - Every mutation emits change events
- **Three-tier storage** - Hot/warm/cold automatic tiering

## Three-Tier Storage

```
┌─────────────────────────────────────────────────────────────────┐
│ HOT: DO SQLite                                                  │
│ • Recent/active documents (last 7 days default)                 │
│ • Bloom filters on high-cardinality fields (email, id)          │
│ • Min/max indexes on timestamp fields                           │
│ • Full JSON stored for fast access                              │
│ Access: <1ms                                                    │
├─────────────────────────────────────────────────────────────────┤
│ WARM: R2 Parquet                                                │
│ • Documents partitioned by $type and date                       │
│ • Columnar format for efficient queries                         │
│ • Partition pruning via Iceberg metadata                        │
│ Access: ~50ms                                                   │
├─────────────────────────────────────────────────────────────────┤
│ COLD: R2 Iceberg Archive                                        │
│ • Full document history                                         │
│ • Compressed Parquet with Zstd                                  │
│ • Cross-DO queries via R2 SQL                                   │
│ Access: ~100ms                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Tiering Policy

```typescript
const tieringPolicy = {
  hot: {
    retention: '7d',           // Keep last 7 days in SQLite
    maxSize: '50MB',           // Or until 50MB limit
  },
  warm: {
    retention: '90d',          // Keep 90 days in R2 Parquet
    partitionBy: ['$type', 'date'],
  },
  cold: {
    retention: 'forever',      // Archive everything
    compression: 'zstd',
  }
}
```

## API

```typescript
import { DocumentStore } from 'dotdo/db/document'

const docs = new DocumentStore<Customer>(db)

// Create
const customer = await docs.create({
  name: 'Alice',
  email: 'alice@example.com',
  metadata: { tier: 'premium', joinedAt: '2024-01-01' }
})

// Read (automatically checks hot → warm → cold)
const found = await docs.get(customer.$id)

// Query by JSONPath
const premium = await docs.query({
  where: { 'metadata.tier': 'premium' },
  limit: 10
})

// Update (partial)
await docs.update(customer.$id, {
  'metadata.tier': 'enterprise'
})

// Delete (soft delete, moves to cold)
await docs.delete(customer.$id)

// Time travel (reads from appropriate tier)
const historical = await docs.getAsOf(customer.$id, '2024-01-15T00:00:00Z')
```

## Schema

```sql
-- Hot tier: DO SQLite
CREATE TABLE documents (
  $id TEXT PRIMARY KEY,
  $type TEXT NOT NULL,
  data JSON NOT NULL,
  $createdAt INTEGER NOT NULL,
  $updatedAt INTEGER NOT NULL,
  $version INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX idx_documents_type ON documents($type);
CREATE INDEX idx_documents_updated ON documents($updatedAt);

-- Bloom filter index (stored as columnar)
-- Row: "bloom:email" → <bitmap>

-- Min/max index (stored as columnar)
-- Row: "minmax:$createdAt" → {min: ..., max: ...}
```

## Query Optimization

### Bloom Filters

High-cardinality fields get bloom filter indexes:

```typescript
// Check if document might exist before full query
const bloom = store.getBloomFilter('email')
if (!bloom.mightContain('alice@example.com')) {
  return null // Skip query entirely - 0 reads
}
```

### Partition Pruning

Range queries use Iceberg metadata to skip partitions:

```typescript
// Only scan partitions where max(createdAt) > targetDate
const recent = await docs.query({
  where: { $createdAt: { $gt: '2024-01-01' } }
})
// Warm/cold: Skips type=Customer/dt=2023-* partitions entirely
```

## CDC Events

Every mutation emits a `UnifiedEvent`:

```typescript
// On create
{
  type: 'cdc.insert',
  op: 'c',
  store: 'document',
  table: 'Customer',
  key: 'cust_123',
  after: { name: 'Alice', email: 'alice@example.com', ... }
}

// On update
{
  type: 'cdc.update',
  op: 'u',
  store: 'document',
  table: 'Customer',
  key: 'cust_123',
  before: { 'metadata.tier': 'premium' },
  after: { 'metadata.tier': 'enterprise' }
}

// On delete
{
  type: 'cdc.delete',
  op: 'd',
  store: 'document',
  table: 'Customer',
  key: 'cust_123',
  before: { ... }
}
```

## When to Use

| Use DocumentStore | Use RelationalStore |
|-------------------|---------------------|
| Flexible schemas | Fixed schemas |
| Nested data structures | Flat tabular data |
| Rapid prototyping | Production with migrations |
| Document-centric apps | Join-heavy queries |

## Dependencies

None. Uses only native SQLite JSON functions.

## Implementation Status

| Feature | Status |
|---------|--------|
| Basic CRUD | TBD |
| JSONPath queries | TBD |
| Bloom filters | TBD |
| Min/max indexes | TBD |
| CDC integration | TBD |
| Hot → Warm tiering | TBD |
| Warm → Cold tiering | TBD |
| Time travel queries | TBD |
