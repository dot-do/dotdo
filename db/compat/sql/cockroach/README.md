# cockroach.do

**CockroachDB for Cloudflare Workers.** Distributed SQL API. Edge-native. Automatically sharded.

[![npm version](https://img.shields.io/npm/v/@dotdo/cockroach.svg)](https://www.npmjs.com/package/@dotdo/cockroach)
[![Tests](https://img.shields.io/badge/tests-passing-brightgreen.svg)](https://github.com/dot-do/dotdo)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why cockroach.do?

**Edge workers can't connect to CockroachDB.** CockroachDB Serverless expects TCP connections, connection pools, and long-lived processes. V8 isolates have none of these.

**AI agents need distributed SQL.** They need familiar PostgreSQL APIs, SERIALIZABLE transactions, and time-travel queries. Not a new database to learn.

**cockroach.do gives you both:**

```typescript
import { Client, Pool } from '@dotdo/cockroach'

// Drop-in replacement - same pg API, runs on the edge
const client = new Client({
  host: 'free-tier.gcp-us-central1.cockroachlabs.cloud',
  database: 'defaultdb',
  user: 'myuser',
  password: 'secret',
})
await client.connect()

// Full pg API
const { rows } = await client.query('SELECT * FROM users WHERE id = $1', [1])

// CockroachDB-specific: AS OF SYSTEM TIME
const historical = await client.query(
  "SELECT * FROM users AS OF SYSTEM TIME '-10s'"
)

// SERIALIZABLE by default
await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE')
await client.query('INSERT INTO users (name) VALUES ($1)', ['Alice'])
await client.query('COMMIT')

await client.end()
```

**Scales to millions of agents.** Each agent gets its own isolated database on Cloudflare's edge network. No shared state. No noisy neighbors. No connection limits.

## Installation

```bash
npm install @dotdo/cockroach
```

## Quick Start

```typescript
import { Client, Pool } from '@dotdo/cockroach'

// Client usage
const client = new Client()
await client.connect()

// Create tables (STRING is CockroachDB's preferred type)
await client.query(`
  CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name STRING NOT NULL,
    email STRING UNIQUE
  )
`)

// Insert with parameterized query
await client.query(
  'INSERT INTO users (name, email) VALUES ($1, $2)',
  ['Alice', 'alice@example.com.ai']
)

// Select
const { rows } = await client.query('SELECT * FROM users WHERE id = $1', [1])

// Update with RETURNING
const { rows: updated } = await client.query(
  'UPDATE users SET name = $1 WHERE id = $2 RETURNING *',
  ['Alicia', 1]
)

await client.end()
```

## Features

### PostgreSQL Wire-Protocol Compatible

CockroachDB speaks PostgreSQL. Same pg Client API. Same parameterized queries. Same tooling.

```typescript
const client = new Client({
  host: 'localhost',
  port: 26257,              // CockroachDB default port
  database: 'defaultdb',
  user: 'root',
  password: '',
  ssl: { rejectUnauthorized: true },
})

await client.connect()

// Query with promise
const result = await client.query('SELECT 1')

// Query with config object
const { rows } = await client.query({
  text: 'SELECT * FROM users WHERE id = $1',
  values: [1],
})

// Event handlers
client.on('connect', () => console.log('Connected'))
client.on('end', () => console.log('Disconnected'))
client.on('error', (err) => console.error(err))

await client.end()
```

### Connection Pooling

Pool manages multiple connections. Checkout, use, release.

```typescript
const pool = new Pool({
  max: 20,                    // Maximum connections
  min: 0,                     // Minimum idle connections
  idleTimeoutMillis: 10000,   // Close idle connections after 10s
  connectionTimeoutMillis: 30000, // Wait 30s for available connection
})

// Simple query (auto-checkout/release)
const { rows } = await pool.query('SELECT * FROM users')

// Manual checkout for transactions
const client = await pool.connect()
try {
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE')
  await client.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [100, 1])
  await client.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [100, 2])
  await client.query('COMMIT')
} catch (e) {
  await client.query('ROLLBACK')
  throw e
} finally {
  client.release()
}

await pool.end()
```

### SERIALIZABLE Transactions

CockroachDB defaults to SERIALIZABLE isolation. Full ACID guarantees.

```typescript
const client = new Client()
await client.connect()

// SERIALIZABLE (CockroachDB default)
await client.query('BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE')
await client.query('INSERT INTO orders VALUES ($1, $2)', [1, 99.99])
await client.query('UPDATE inventory SET stock = stock - 1 WHERE id = $1', [42])
await client.query('COMMIT')

// READ COMMITTED for compatibility
await client.query('BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED')
// ...
await client.query('COMMIT')

// Read-only transactions
await client.query('BEGIN TRANSACTION READ ONLY')
const { rows } = await client.query('SELECT * FROM reports')
await client.query('COMMIT')

// Savepoints
await client.query('BEGIN')
await client.query('SAVEPOINT sp1')
await client.query('INSERT INTO logs VALUES ($1)', ['event'])
await client.query('RELEASE SAVEPOINT sp1')
await client.query('COMMIT')
```

### AS OF SYSTEM TIME (Time-Travel Queries)

Query historical data. Reduce contention. Enable consistent analytics.

```typescript
// Query data from 10 seconds ago
const historical = await client.query(
  "SELECT * FROM users AS OF SYSTEM TIME '-10s'"
)

// Explicit timestamp
const snapshot = await client.query(
  "SELECT * FROM users AS OF SYSTEM TIME '2024-01-01 00:00:00'"
)

// Follower reads for reduced latency
const follower = await client.query(
  'SELECT * FROM users AS OF SYSTEM TIME follower_read_timestamp()'
)

// Historical transaction
await client.query("BEGIN TRANSACTION AS OF SYSTEM TIME '-1s'")
const { rows } = await client.query('SELECT * FROM metrics')
await client.query('COMMIT')
```

### CockroachDB Data Types

Native support for CockroachDB types.

```typescript
// STRING (CockroachDB's preferred text type)
await client.query('CREATE TABLE t (name STRING)')

// UUID with gen_random_uuid()
await client.query(`
  CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name STRING
  )
`)

// SERIAL (auto-incrementing)
await client.query(`
  CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name STRING NOT NULL
  )
`)

// JSONB
await client.query('CREATE TABLE docs (data JSONB)')
await client.query('INSERT INTO docs VALUES ($1)', [JSON.stringify({ key: 'value' })])

// DECIMAL for financial data
await client.query('CREATE TABLE prices (amount DECIMAL(10,2))')
```

## How It Works

```
+---------------------------------------------------------------------+
|                        @dotdo/cockroach                              |
+---------------------------------------------------------------------+
|  pg Client API (Client, Pool, query, connect, end)                  |
+---------------------------------------------------------------------+
|  Client                          |  Pool                            |
|  - connect() / end()             |  - totalCount / idleCount        |
|  - query() with $1, $2 params    |  - connect() -> PoolClient       |
|  - Transaction support           |  - Automatic checkout/release    |
|  - Event emitters                |  - Connection timeout            |
+----------------------------------+----------------------------------+
|  CockroachDB SQL Normalization                                      |
|  - AS OF SYSTEM TIME parsing                                        |
|  - STRING -> TEXT translation                                       |
|  - gen_random_uuid() handling                                       |
|  - SERIALIZABLE isolation                                           |
+---------------------------------------------------------------------+
|  Shared SQL Engine (PostgreSQL dialect)                             |
|  - DDL: CREATE/DROP TABLE                                           |
|  - DML: SELECT/INSERT/UPDATE/DELETE                                 |
|  - Transactions: BEGIN/COMMIT/ROLLBACK                              |
+---------------------------------------------------------------------+
|                     Durable Object SQLite                            |
+---------------------------------------------------------------------+
```

**Edge Layer (pg API)**
- Drop-in replacement for node-postgres
- CockroachDB-specific SQL normalization
- Full type safety with generics

**Storage Layer (Durable Object SQLite)**
- Microsecond access latency
- Transactional operations
- Automatic sharding by tenant

## API Reference

### Client

| Method | Description |
|--------|-------------|
| `new Client(config?)` | Create client with connection config |
| `connect()` | Establish connection |
| `query(text, values?)` | Execute parameterized query |
| `query(config)` | Execute with QueryConfig object |
| `end()` | Close connection |
| `escapeLiteral(value)` | Escape string literal |
| `escapeIdentifier(value)` | Escape identifier |
| `on(event, handler)` | Add event listener |
| `off(event, handler)` | Remove event listener |

### Pool

| Method | Description |
|--------|-------------|
| `new Pool(config?)` | Create pool with configuration |
| `query(text, values?)` | Execute query (auto-checkout) |
| `connect()` | Checkout client from pool |
| `end()` | Close all connections |
| `totalCount` | Number of total clients |
| `idleCount` | Number of idle clients |
| `waitingCount` | Number of waiting requests |
| `ended` | Pool is closed |

### PoolClient

| Method | Description |
|--------|-------------|
| `query(text, values?)` | Execute query |
| `release(destroy?)` | Return client to pool |

### QueryResult

| Field | Type | Description |
|-------|------|-------------|
| `rows` | `R[]` | Result rows |
| `fields` | `FieldDef[]` | Column definitions |
| `rowCount` | `number` | Rows affected |
| `command` | `string` | SQL command (SELECT, INSERT, etc.) |
| `oid` | `number` | OID of inserted row (legacy) |

### CockroachDB-Specific Config

| Option | Type | Description |
|--------|------|-------------|
| `cluster` | `string` | CockroachDB Cloud cluster identifier |
| `defaultIsolationLevel` | `IsolationLevel` | Default transaction isolation |
| `shard` | `object` | Sharding configuration |
| `replica` | `object` | Replica read preferences |
| `doNamespace` | `DurableObjectNamespace` | DO binding for edge storage |

### Error Classes

| Class | Description |
|-------|-------------|
| `DatabaseError` | SQL execution errors with PostgreSQL codes |
| `ConnectionError` | Connection-related errors |

### PostgreSQL Error Codes

```typescript
// Error codes
'42P01' // table not found
'42P07' // table already exists
'23505' // unique constraint violation
'42601' // syntax error
'40001' // serialization failure (retry transaction)
```

## Durable Object Integration

### As an RPC Service

Keep your DO bundle small. Offload database operations.

```toml
# wrangler.toml
[[services]]
binding = "COCKROACH"
service = "cockroach-do"
```

```typescript
// Heavy operations via RPC
const { rows } = await env.COCKROACH.query('SELECT * FROM users')
```

### With dotdo Framework

```typescript
import { DO } from 'dotdo'
import { withCockroach } from '@dotdo/cockroach/do'

class MyApp extends withCockroach(DO) {
  async loadUsers() {
    const { rows } = await this.$.crdb.query(
      'SELECT * FROM users WHERE active = $1',
      [true]
    )
    return rows
  }
}
```

### Extended Configuration

Shard routing, replica configuration, jurisdiction constraints.

```typescript
const pool = new Pool({
  host: 'localhost',
  database: 'defaultdb',

  // Shard by tenant for multi-tenancy
  shard: { key: 'tenant_id', count: 16, algorithm: 'consistent' },

  // Read from nearest replica
  replica: {
    readPreference: 'nearest',
    writeThrough: true,
    jurisdiction: 'eu',  // GDPR compliance
  },

  // Bind to DO namespace
  doNamespace: env.COCKROACH_DO,
})
```

## Comparison

| Feature | @dotdo/cockroach | CockroachDB Serverless | D1 |
|---------|------------------|------------------------|-----|
| Edge Runtime | Yes | No | Yes |
| pg API | Yes | Yes | No |
| Connection Pooling | Yes | Yes | N/A |
| Transactions | Yes | Yes | Yes |
| SERIALIZABLE Default | Yes | Yes | No |
| AS OF SYSTEM TIME | Yes | Yes | No |
| Zero Dependencies | Yes | No | Yes |
| DO Integration | Yes | No | No |
| Automatic Sharding | Yes | Yes | No |
| Time-Travel Queries | Yes | Yes | No |

## SQL Support

### DDL

```sql
CREATE TABLE users (id SERIAL PRIMARY KEY, name STRING)
CREATE TABLE IF NOT EXISTS users (id INT)
CREATE TABLE events (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name STRING)
DROP TABLE users
DROP TABLE IF EXISTS users
```

### DML

```sql
INSERT INTO users (name) VALUES ($1)
INSERT INTO users (name) VALUES ($1) RETURNING *
SELECT * FROM users WHERE id = $1
SELECT * FROM users AS OF SYSTEM TIME '-10s'
UPDATE users SET name = $1 WHERE id = $2
UPDATE users SET name = $1 WHERE id = $2 RETURNING *
DELETE FROM users WHERE id = $1
DELETE FROM users WHERE id = $1 RETURNING *
```

### Transactions

```sql
BEGIN
BEGIN TRANSACTION
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE
BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED
BEGIN TRANSACTION READ ONLY
BEGIN TRANSACTION AS OF SYSTEM TIME '-1s'
COMMIT
ROLLBACK
SAVEPOINT sp1
RELEASE SAVEPOINT sp1
ROLLBACK TO SAVEPOINT sp1
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE
```

### Operators

```sql
-- Comparison
=, !=, <>, <, <=, >, >=
IS NULL, IS NOT NULL
IN (1, 2, 3)

-- Pattern matching
LIKE 'A%'
ILIKE 'a%'  -- case-insensitive

-- Logical
AND, OR

-- Modifiers
ORDER BY column ASC/DESC
LIMIT n
OFFSET n
```

## Performance

- **Zero cold starts** (Durable Objects)
- **Microsecond latency** for DO SQLite operations
- **Global distribution** (300+ Cloudflare locations)
- **Zero TCP connections** (no connection overhead)
- **Automatic sharding** (no manual partitioning)

## Related

- [postgres.do](https://postgres.do) - PostgreSQL compat layer
- [mysql.do](https://mysql.do) - MySQL compat layer
- [fsx.do](https://fsx.do) - Filesystem on SQLite
- [gitx.do](https://gitx.do) - Git on R2
- [bashx.do](https://bashx.do) - Shell without VMs
- [workers.do](https://workers.do) - Durable Object primitives
- [CockroachDB Docs](https://www.cockroachlabs.com/docs/)

## License

MIT

## Related

- [GitHub](https://github.com/dot-do/dotdo)
- [Documentation](https://cockroach.do)
- [.do](https://do.org.ai)
- [Platform.do](https://platform.do)
