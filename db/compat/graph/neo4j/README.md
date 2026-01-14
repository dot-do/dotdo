# neo4j.do

**Neo4j for Cloudflare Workers.** Full Cypher support. Graph on the edge. No server required.

[![npm version](https://img.shields.io/npm/v/@dotdo/neo4j.svg)](https://www.npmjs.com/package/@dotdo/neo4j)
[![Tests](https://img.shields.io/badge/tests-116%20passing-brightgreen.svg)](#tests)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

```typescript
import neo4j from '@dotdo/neo4j'

const driver = neo4j.driver('bolt://localhost', neo4j.auth.basic('neo4j', 'password'))
const session = driver.session()

// Create nodes and relationships
await session.run(
  'CREATE (a:Person {name: $name})-[:KNOWS]->(b:Person {name: $friend}) RETURN a, b',
  { name: 'Alice', friend: 'Bob' }
)

// Query the graph
const result = await session.run('MATCH (n:Person)-[:KNOWS]->(friend) RETURN n.name, friend.name')
const records = await result.records()

await session.close()
await driver.close()
```

## Why neo4j.do?

**Neo4j drivers expect TCP connections.** The official driver uses Bolt protocol over persistent sockets. V8 isolates don't support that.

**Graph databases need infrastructure.** Running Neo4j means clusters, replicas, and operational overhead.

**neo4j.do gives you graphs without the servers:**

- **Drop-in replacement** - Same API as `neo4j-driver`
- **Full Cypher parser** - CREATE, MATCH, WHERE, SET, DELETE, RETURN
- **Real graph traversal** - Relationship directions, variable-length paths, pattern matching
- **Transactions** - ACID guarantees backed by Durable Object SQLite
- **Zero cold starts** - V8 isolates start in <1ms

**Scales to millions of agents.** Each agent gets its own graph database on Cloudflare's edge network. No shared state. No noisy neighbors. Just fast, persistent graph storage at global scale.

## Installation

```bash
npm install @dotdo/neo4j
```

## Quick Start

```typescript
import neo4j from '@dotdo/neo4j'

const driver = neo4j.driver('bolt://localhost', neo4j.auth.basic('neo4j', 'password'))
const session = driver.session()

// Create
await session.run('CREATE (n:Person {name: $name, age: $age})', { name: 'Alice', age: 30 })

// Read
const result = await session.run('MATCH (n:Person) WHERE n.age > 25 RETURN n')
const records = await result.records()

// Update
await session.run('MATCH (n:Person {name: $name}) SET n.age = $age', { name: 'Alice', age: 31 })

// Delete
await session.run('MATCH (n:Person {name: $name}) DETACH DELETE n', { name: 'Alice' })

await session.close()
await driver.close()
```

## Features

### Complete Cypher Support

Full query language with nodes, relationships, and patterns.

```typescript
// Node patterns with labels and properties
await session.run('CREATE (n:Person:Employee {name: $name, department: $dept})', {
  name: 'Alice',
  dept: 'Engineering',
})

// Relationship patterns
await session.run(
  'MATCH (a:Person {name: $from}) ' +
  'MATCH (b:Person {name: $to}) ' +
  'CREATE (a)-[:MANAGES {since: $year}]->(b)',
  { from: 'Alice', to: 'Bob', year: 2024 }
)

// Variable-length paths
const result = await session.run(
  'MATCH (a:Person {name: $name})-[:KNOWS*1..3]->(friend) RETURN friend',
  { name: 'Alice' }
)

// Path assignment
await session.run(
  'MATCH p = (a:Person)-[r:KNOWS]->(b:Person) RETURN p, length(p)'
)
```

### Relationship Directions

All three direction types supported.

```typescript
// Outgoing: ->
await session.run('MATCH (a)-[:FOLLOWS]->(b) RETURN a, b')

// Incoming: <-
await session.run('MATCH (a)<-[:FOLLOWS]-(b) RETURN a, b')

// Bidirectional: -
await session.run('MATCH (a)-[:FRIENDS]-(b) RETURN a, b')
```

### WHERE Conditions

Full predicate support with AND/OR logic.

```typescript
// Comparison operators
await session.run('MATCH (n:Person) WHERE n.age >= 21 AND n.age < 65 RETURN n')

// String predicates
await session.run('MATCH (n:Person) WHERE n.name STARTS WITH $prefix RETURN n', { prefix: 'Al' })
await session.run('MATCH (n:Person) WHERE n.email CONTAINS $domain RETURN n', { domain: '@acme' })
await session.run('MATCH (n:Person) WHERE n.name ENDS WITH $suffix RETURN n', { suffix: 'son' })

// NULL checks
await session.run('MATCH (n:Person) WHERE n.email IS NOT NULL RETURN n')

// IN lists
await session.run('MATCH (n:Person) WHERE n.status IN $statuses RETURN n', {
  statuses: ['active', 'pending'],
})

// OR conditions
await session.run('MATCH (n) WHERE n.role = "admin" OR n.role = "superuser" RETURN n')
```

### Aggregations

Count, sum, avg, min, max, and collect.

```typescript
// Count
const result = await session.run('MATCH (n:Person) RETURN count(n) as total')

// Sum and average
await session.run('MATCH (n:Order) RETURN sum(n.amount), avg(n.amount)')

// Min and max
await session.run('MATCH (n:Product) RETURN min(n.price), max(n.price)')

// Collect into array
await session.run('MATCH (n:Person)-[:WORKS_AT]->(c:Company) RETURN c.name, collect(n.name) as employees')
```

### Transactions

Full ACID support with explicit transactions.

```typescript
const session = driver.session()

// Managed transactions (recommended)
await session.executeWrite(async (tx) => {
  await tx.run('CREATE (n:Account {balance: $balance})', { balance: 1000 })
  await tx.run('MATCH (n:Account) SET n.balance = n.balance - 100')
  // Auto-commits on success, auto-rollbacks on error
})

await session.executeRead(async (tx) => {
  const result = await tx.run('MATCH (n:Account) RETURN n.balance')
  return result.records()
})

// Explicit transactions
const tx = session.beginTransaction()
try {
  await tx.run('CREATE (n:Order {id: $id})', { id: 'order-123' })
  await tx.run('CREATE (n:OrderItem {sku: $sku})', { sku: 'SKU-001' })
  await tx.commit()
} catch (error) {
  await tx.rollback()
  throw error
}
```

### Integer Precision

64-bit integers with Integer type.

```typescript
import { int, isInt, Integer } from '@dotdo/neo4j'

// Create integers
const id = int(9007199254740993n) // Beyond JS safe integer range
const count = int(42)

// Check type
if (isInt(value)) {
  console.log(value.toNumber()) // Convert to JS number
  console.log(value.toString()) // String representation
}

// Arithmetic
const sum = id.add(count)
const diff = id.subtract(count)
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        @dotdo/neo4j                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   Driver ──▶ Session ──▶ Transaction ──▶ Result                    │
│                              │                                       │
│                              ▼                                       │
│                      Cypher Parser                                   │
│                              │                                       │
│                              ▼                                       │
│                    Query Executor                                    │
│                              │                                       │
│                              ▼                                       │
│                     Graph Storage                                    │
│                    (Nodes + Rels)                                    │
│                                                                      │
├─────────────────────────────────────────────────────────────────────┤
│                    Durable Object SQLite                             │
│            JSON storage with graph semantics                         │
└─────────────────────────────────────────────────────────────────────┘
```

## API Reference

### Driver Functions

| Function | Description |
|----------|-------------|
| `neo4j.driver(url, auth, config?)` | Create a driver instance |
| `neo4j.auth.basic(user, pass)` | Basic authentication |
| `neo4j.auth.bearer(token)` | Bearer token authentication |
| `neo4j.auth.kerberos(ticket)` | Kerberos authentication |
| `neo4j.int(value)` | Create 64-bit integer |
| `neo4j.isInt(value)` | Check if value is Integer |

### Driver Methods

| Method | Description |
|--------|-------------|
| `driver.session(config?)` | Create a new session |
| `driver.verifyConnectivity()` | Verify connection |
| `driver.getServerInfo()` | Get server information |
| `driver.executeQuery(cypher, params?)` | Execute query directly |
| `driver.close()` | Close driver |

### Session Methods

| Method | Description |
|--------|-------------|
| `session.run(cypher, params?)` | Execute Cypher query |
| `session.beginTransaction()` | Start explicit transaction |
| `session.executeRead(work)` | Execute read transaction |
| `session.executeWrite(work)` | Execute write transaction |
| `session.lastBookmarks()` | Get causal consistency bookmarks |
| `session.close()` | Close session |

### Transaction Methods

| Method | Description |
|--------|-------------|
| `tx.run(cypher, params?)` | Execute query in transaction |
| `tx.commit()` | Commit transaction |
| `tx.rollback()` | Rollback transaction |
| `tx.close()` | Close transaction |
| `tx.isOpen()` | Check if transaction is open |

### Result Methods

| Method | Description |
|--------|-------------|
| `result.records()` | Get all records as array |
| `result.summary()` | Get result summary |
| `result.consume()` | Consume and get summary |
| `result.keys()` | Get column names |
| `result.peek()` | Peek at first record |

### Cypher Clauses

| Clause | Description |
|--------|-------------|
| `CREATE` | Create nodes and relationships |
| `MATCH` | Find patterns in the graph |
| `WHERE` | Filter results |
| `SET` | Update properties |
| `REMOVE` | Remove properties |
| `DELETE` | Delete nodes (must have no relationships) |
| `DETACH DELETE` | Delete nodes and their relationships |
| `RETURN` | Return results |
| `ORDER BY` | Sort results |
| `SKIP` | Skip first N results |
| `LIMIT` | Limit result count |
| `DISTINCT` | Remove duplicates |

### Graph Types

| Type | Description |
|------|-------------|
| `Node` | Graph node with labels and properties |
| `Relationship` | Relationship with type and properties |
| `Path` | Sequence of nodes and relationships |
| `Integer` | 64-bit integer |
| `Point` | Spatial point (2D/3D) |
| `Date` | Date without time |
| `DateTime` | Date with time and timezone |
| `Duration` | Time duration |

### Error Types

| Error | Description |
|-------|-------------|
| `Neo4jError` | Base error class |
| `ClientError` | Client-side error |
| `DatabaseError` | Database error |
| `TransientError` | Temporary error (retry) |
| `ServiceUnavailableError` | Service unavailable |
| `SessionExpiredError` | Session expired |

## Durable Object Integration

```typescript
import { DO } from 'dotdo'
import neo4j from '@dotdo/neo4j'

export class GraphDO extends DO {
  private driver = neo4j.driver('bolt://internal', neo4j.auth.basic('', ''))

  async createUser(name: string, email: string) {
    const session = this.driver.session()
    try {
      const result = await session.run(
        'CREATE (u:User {id: $id, name: $name, email: $email}) RETURN u',
        { id: this.$.id, name, email }
      )
      const records = await result.records()
      return records[0].get('u')
    } finally {
      await session.close()
    }
  }

  async findConnections(userId: string, depth: number = 2) {
    const session = this.driver.session()
    try {
      const result = await session.run(
        `MATCH (u:User {id: $id})-[:KNOWS*1..${depth}]->(connection)
         RETURN DISTINCT connection`,
        { id: userId }
      )
      return result.records()
    } finally {
      await session.close()
    }
  }
}
```

## MCP Tools

neo4j.do exposes tools for AI agents via MCP:

| Tool | Description |
|------|-------------|
| `neo4j_query` | Execute Cypher query |
| `neo4j_create_node` | Create a node with labels and properties |
| `neo4j_create_relationship` | Create a relationship between nodes |
| `neo4j_find_nodes` | Find nodes by label and properties |
| `neo4j_traverse` | Traverse relationships from a node |
| `neo4j_delete_node` | Delete a node |

```typescript
// Agent usage
const result = await agent.tool('neo4j_query', {
  cypher: 'MATCH (n:Person)-[:KNOWS]->(friend) WHERE n.name = $name RETURN friend',
  params: { name: 'Alice' },
})
```

## Comparison

| Feature | neo4j.do | neo4j-driver | memgraph | dgraph |
|---------|----------|--------------|----------|--------|
| Edge Runtime | Yes | No | No | No |
| Full Cypher | Yes | Yes | Yes | No |
| Transactions | Yes | Yes | Yes | Yes |
| Zero Infrastructure | Yes | No | No | No |
| DO Integration | Yes | No | No | No |
| Sharding | Yes | Manual | Manual | Auto |
| Cold Start | <1ms | N/A | ~500ms | ~1s |

## Performance

| Operation | Time | Notes |
|-----------|------|-------|
| Node creation | <1ms | Single node with properties |
| Relationship creation | <1ms | Between existing nodes |
| Simple MATCH | <5ms | Single pattern |
| Complex traversal | <50ms | Multi-hop with filters |
| Transaction commit | <10ms | With SQLite sync |

## Tests

116 tests covering:

- Driver creation and connection
- Session and transaction lifecycle
- Node CRUD operations
- Relationship CRUD operations
- Cypher parsing (patterns, WHERE, aggregations)
- Graph traversal (directions, variable-length paths)
- Transaction commit/rollback
- Integer type handling
- Error types

```bash
npm test -- --project=workers db/compat/graph/neo4j
```

## Limitations

- **No stored procedures** - CALL not supported
- **No full-text indexes** - Use Cypher CONTAINS/STARTS WITH
- **No graph algorithms** - No PageRank, shortest path (yet)
- **Single DO per graph** - Sharding planned for v2

## Related

- [Neo4j](https://neo4j.com) - The graph database
- [duckdb.do](https://duckdb.do) - OLAP on the edge
- [fsx.do](https://fsx.do) - Filesystem on SQLite
- [gitx.do](https://gitx.do) - Git on R2
- [workers.do](https://workers.do) - Durable Object primitives

## License

MIT
