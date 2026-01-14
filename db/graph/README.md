# GraphStore

> Relationship and edge storage with traversal queries

## Overview

GraphStore provides optimized storage for graph relationships (edges) between Things. It supports bidirectional traversal, cycle detection, and efficient adjacency queries using SQLite indexes.

## Features

- **Bidirectional edges** - Query from→to and to→from
- **Typed relationships** - Label edges with relationship types
- **Traversal queries** - Multi-hop graph traversal
- **Cycle detection** - Prevent circular dependencies
- **CDC integration** - Every mutation emits change events
- **Three-tier storage** - Hot/warm/cold automatic tiering

## Three-Tier Storage

```
┌─────────────────────────────────────────────────────────────────┐
│ HOT: DO SQLite                                                  │
│ • Active edges (recently accessed/modified)                     │
│ • Adjacency indexes for fast traversal                          │
│ • In-degree/out-degree statistics                               │
│ Access: <1ms                                                    │
├─────────────────────────────────────────────────────────────────┤
│ WARM: R2 Parquet                                                │
│ • Relationship snapshots partitioned by source type             │
│ • Pre-computed transitive closures for common patterns          │
│ • Materialized path queries                                     │
│ Access: ~50ms                                                   │
├─────────────────────────────────────────────────────────────────┤
│ COLD: R2 Iceberg Archive                                        │
│ • Full relationship history                                     │
│ • Cross-DO graph queries via R2 SQL                             │
│ • Graph evolution analysis                                      │
│ Access: ~100ms                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## API

```typescript
import { GraphStore } from 'dotdo/db/graph'

const graph = new GraphStore(db)

// Create relationship
await graph.relate({
  from: 'User/alice',
  to: 'Team/engineering',
  type: 'memberOf',
  data: { role: 'lead', since: '2024-01-01' }
})

// Query outgoing edges
const teams = await graph.outgoing('User/alice', { type: 'memberOf' })

// Query incoming edges
const members = await graph.incoming('Team/engineering', { type: 'memberOf' })

// Check if relationship exists
const isMember = await graph.exists('User/alice', 'Team/engineering', 'memberOf')

// Multi-hop traversal
const reachable = await graph.traverse({
  start: 'User/alice',
  direction: 'outgoing',
  types: ['memberOf', 'reportsTo'],
  maxDepth: 3,
})

// Find path between nodes
const path = await graph.findPath({
  from: 'User/alice',
  to: 'User/ceo',
  types: ['reportsTo'],
})

// Cycle detection
const hasCycle = await graph.detectCycle('User/alice', 'reportsTo')

// Delete relationship
await graph.unrelate('User/alice', 'Team/engineering', 'memberOf')
```

## Schema

```sql
CREATE TABLE relationships (
  $id TEXT PRIMARY KEY,
  from_id TEXT NOT NULL,
  from_type TEXT NOT NULL,
  to_id TEXT NOT NULL,
  to_type TEXT NOT NULL,
  type TEXT NOT NULL,
  data JSON,
  $createdAt INTEGER NOT NULL,
  $updatedAt INTEGER NOT NULL,
  UNIQUE(from_id, to_id, type)
);

-- Adjacency indexes for fast traversal
CREATE INDEX idx_rel_from ON relationships(from_id, type);
CREATE INDEX idx_rel_to ON relationships(to_id, type);
CREATE INDEX idx_rel_type ON relationships(type);

-- Composite index for bidirectional queries
CREATE INDEX idx_rel_from_type_to ON relationships(from_id, type, to_id);
CREATE INDEX idx_rel_to_type_from ON relationships(to_id, type, from_id);
```

## Traversal Algorithms

### Breadth-First Traversal

```typescript
const bfs = await graph.traverse({
  start: 'User/alice',
  direction: 'outgoing',
  types: ['follows'],
  maxDepth: 2,
  algorithm: 'bfs',  // Default
})
// Returns nodes in order of distance from start
```

### Depth-First Traversal

```typescript
const dfs = await graph.traverse({
  start: 'User/alice',
  direction: 'outgoing',
  types: ['follows'],
  maxDepth: 5,
  algorithm: 'dfs',
})
// Returns paths, useful for finding all reachable nodes
```

### Shortest Path

```typescript
const path = await graph.shortestPath({
  from: 'User/alice',
  to: 'User/bob',
  types: ['follows', 'friendOf'],
  maxDepth: 6,  // Six degrees of separation
})
// Returns: ['User/alice', 'User/carol', 'User/bob']
```

## N+1 Prevention

GraphStore includes built-in batching to prevent N+1 query problems:

```typescript
// Bad: N+1 queries
for (const user of users) {
  const teams = await graph.outgoing(user.id, { type: 'memberOf' })
}

// Good: Batched query
const teamsByUser = await graph.outgoingBatch(
  users.map(u => u.id),
  { type: 'memberOf' }
)
// Returns: Map<userId, Team[]>
```

## CDC Events

```typescript
// On create relationship
{
  type: 'cdc.insert',
  op: 'c',
  store: 'graph',
  table: 'relationships',
  key: 'rel_123',
  after: {
    from: 'User/alice',
    to: 'Team/engineering',
    type: 'memberOf',
    data: { role: 'lead' }
  }
}

// On delete relationship
{
  type: 'cdc.delete',
  op: 'd',
  store: 'graph',
  table: 'relationships',
  key: 'rel_123',
  before: {
    from: 'User/alice',
    to: 'Team/engineering',
    type: 'memberOf'
  }
}
```

## When to Use

| Use GraphStore | Use DocumentStore |
|----------------|-------------------|
| Relationships between entities | Entity data itself |
| Social graphs | User profiles |
| Org hierarchies | Org metadata |
| Dependencies | Task details |

## Dependencies

None. Uses only native SQLite.

## Related

- [`db/graph/`](.) - Existing graph implementations
- [`db/relationships.ts`](../relationships.ts) - Relationship types

## Implementation Status

| Feature | Status |
|---------|--------|
| Basic CRUD | ✅ Exists |
| Bidirectional queries | ✅ Exists |
| Traversal (BFS/DFS) | ✅ Exists |
| Cycle detection | ✅ Exists |
| N+1 batching | ✅ Exists |
| CDC integration | TBD |
| Hot → Warm tiering | TBD |
| Cross-DO traversal | TBD |
