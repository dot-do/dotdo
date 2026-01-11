# postgres.do

**PostgreSQL for Cloudflare Workers.** pg API-compatible. Edge-native. Zero connections.

[![npm version](https://img.shields.io/npm/v/@dotdo/postgres.svg)](https://www.npmjs.com/package/@dotdo/postgres)
[![Tests](https://img.shields.io/badge/tests-110%20passing-brightgreen.svg)](https://github.com/dot-do/dotdo)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why postgres.do?

**Edge workers can't use pg.** The node-postgres library expects TCP connections, connection pooling, and long-lived processes. None of that works on Cloudflare Workers.

**AI agents need PostgreSQL.** They need familiar APIs, parameterized queries, transactions, and the pg ecosystem. Not a new database to learn.

**postgres.do gives you both:**

```typescript
import { Client, Pool } from '@dotdo/postgres'

// Drop-in replacement - same API, runs on the edge
const client = new Client({
  host: 'localhost',
  database: 'mydb',
  user: 'postgres',
  password: 'secret',
})
await client.connect()

// Full pg API
const { rows } = await client.query('SELECT * FROM users WHERE id = $1', [1])

// Connection pooling
const pool = new Pool({ max: 20 })
const result = await pool.query('SELECT * FROM orders')
```

**Scales to millions of agents.** Each agent gets its own isolated database on Cloudflare's edge network. No shared state. No noisy neighbors. No connection limits.

## Installation

```bash
npm install @dotdo/postgres
```

## Quick Start

```typescript
import { Client, Pool } from '@dotdo/postgres'

// Client usage
const client = new Client()
await client.connect()

// Create tables
await client.query(`
  CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE
  )
`)

// Insert with parameterized query
await client.query('INSERT INTO users (name, email) VALUES ($1, $2)', ['Alice', 'alice@example.com.ai'])

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

### Full pg Client API

Complete node-postgres Client interface. Connect, query, disconnect.

```typescript
const client = new Client({
  host: 'localhost',
  port: 5432,
  database: 'mydb',
  user: 'postgres',
  password: 'secret',
  connectionString: 'postgres://user:pass@localhost:5432/mydb',
})

await client.connect()

// Query with callback (legacy API)
client.query('SELECT 1', (err, result) => {
  console.log(result.rows)
})

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
  await client.query('BEGIN')
  await client.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [100, 1])
  await client.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [100, 2])
  await client.query('COMMIT')
} catch (e) {
  await client.query('ROLLBACK')
  throw e
} finally {
  client.release()
}

// Pool events
pool.on('connect', (client) => console.log('New connection'))
pool.on('acquire', (client) => console.log('Connection acquired'))
pool.on('release', (err, client) => console.log('Connection released'))
pool.on('remove', (client) => console.log('Connection removed'))

await pool.end()
```

### Transactions

Full transaction support with BEGIN, COMMIT, ROLLBACK, and savepoints.

```typescript
const client = new Client()
await client.connect()

// Basic transaction
await client.query('BEGIN')
await client.query('INSERT INTO orders VALUES ($1, $2)', [1, 99.99])
await client.query('UPDATE inventory SET stock = stock - 1 WHERE id = $1', [42])
await client.query('COMMIT')

// Rollback on error
await client.query('BEGIN')
try {
  await client.query('DELETE FROM users WHERE id = $1', [1])
  throw new Error('Abort!')
} catch (e) {
  await client.query('ROLLBACK')
}

// Savepoints (acknowledged)
await client.query('BEGIN')
await client.query('SAVEPOINT sp1')
await client.query('INSERT INTO logs VALUES ($1)', ['event'])
await client.query('RELEASE SAVEPOINT sp1')
await client.query('COMMIT')
```

### PostgreSQL Error Codes

Authentic PostgreSQL error codes for proper error handling.

```typescript
import { DatabaseError } from '@dotdo/postgres'

try {
  await client.query('SELECT * FROM nonexistent')
} catch (e) {
  if (e instanceof DatabaseError) {
    console.log(e.code)     // '42P01' - table not found
    console.log(e.severity) // 'ERROR'
    console.log(e.message)  // 'Table not found: nonexistent'
  }
}

// Error codes
// 42P01 - table not found
// 42P07 - table already exists
// 23505 - unique constraint violation
// 42601 - syntax error
```

### Parameterized Queries

Safe parameter binding with $1, $2, $3 syntax.

```typescript
// Positional parameters
await client.query('SELECT * FROM users WHERE id = $1 AND active = $2', [1, true])

// Insert with RETURNING
const { rows } = await client.query(
  'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING id, name',
  ['Bob', 'bob@example.com.ai']
)

// Update multiple columns
await client.query(
  'UPDATE users SET name = $1, email = $2, updated_at = $3 WHERE id = $4',
  ['Robert', 'robert@example.com.ai', new Date().toISOString(), 1]
)
```

### Escape Utilities

Safe string escaping for dynamic SQL.

```typescript
// Escape literals (values)
client.escapeLiteral("it's a test")  // "'it''s a test'"

// Escape identifiers (table/column names)
client.escapeIdentifier('user"name') // '"user""name"'

// Use in dynamic queries
const table = client.escapeIdentifier(userInput)
await client.query(`SELECT * FROM ${table}`)
```

## Durable Object Integration

### As an RPC Service

Keep your DO bundle small. Offload database operations.

```toml
# wrangler.toml
[[services]]
binding = "POSTGRES"
service = "postgres-do"
```

```typescript
// Heavy operations via RPC
const { rows } = await env.POSTGRES.query('SELECT * FROM users')
```

### With dotdo Framework

```typescript
import { DO } from 'dotdo'
import { withPostgres } from '@dotdo/postgres/do'

class MyApp extends withPostgres(DO) {
  async loadUsers() {
    const { rows } = await this.$.pg.query(
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
  database: 'mydb',

  // Shard by tenant for multi-tenancy
  shard: { key: 'tenant_id', count: 16, algorithm: 'consistent' },

  // Read from nearest replica
  replica: {
    readPreference: 'nearest',
    writeThrough: true,
    jurisdiction: 'eu',  // GDPR compliance
  },

  // Bind to DO namespace
  doNamespace: env.POSTGRES_DO,
})
```

## How It Works

```
+---------------------------------------------------------------------+
|                         @dotdo/postgres                              |
+---------------------------------------------------------------------+
|  pg Client API (Client, Pool, query, connect, end)                  |
+---------------------------------------------------------------------+
|  Client                          |  Pool                            |
|  - connect() / end()             |  - totalCount / idleCount        |
|  - query() with $1, $2 params    |  - connect() -> PoolClient       |
|  - Transaction support           |  - Automatic checkout/release    |
|  - Event emitters                |  - Connection timeout            |
+----------------------------------+----------------------------------+
|  Shared SQL Engine                                                  |
|  - PostgreSQL dialect parser                                        |
|  - DDL: CREATE/DROP TABLE                                           |
|  - DML: SELECT/INSERT/UPDATE/DELETE                                 |
|  - Transactions: BEGIN/COMMIT/ROLLBACK                              |
+---------------------------------------------------------------------+
|                     Durable Object SQLite                            |
+---------------------------------------------------------------------+
```

**Edge Layer (pg API)**
- Drop-in replacement for node-postgres
- Full type safety with generics
- No external dependencies

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

### Error Classes

| Class | Description |
|-------|-------------|
| `DatabaseError` | SQL execution errors with PostgreSQL codes |
| `ConnectionError` | Connection-related errors |

### Type Constants

```typescript
import { types } from '@dotdo/postgres'

types.BOOL      // 16
types.INT4      // 23
types.TEXT      // 25
types.JSON      // 114
types.JSONB     // 3802
types.UUID      // 2950
types.TIMESTAMP // 1114
```

## Comparison

| Feature | @dotdo/postgres | pg (node-postgres) | D1 |
|---------|-----------------|-------------------|-----|
| Edge Runtime | Yes | No | Yes |
| pg API | Yes | Yes | No |
| Connection Pooling | Yes | Yes | N/A |
| Transactions | Yes | Yes | Yes |
| Parameterized Queries | Yes | Yes | Yes |
| PostgreSQL Error Codes | Yes | Yes | No |
| Event Emitters | Yes | Yes | No |
| Zero Dependencies | Yes | No | Yes |
| DO Integration | Yes | No | No |
| Sharding | Yes | No | No |

## Performance

- **110 tests** covering all operations
- **Microsecond latency** for DO SQLite operations
- **Zero cold starts** (Durable Objects)
- **Global distribution** (300+ Cloudflare locations)
- **Zero TCP connections** (no connection overhead)

## SQL Support

### DDL

```sql
CREATE TABLE users (id SERIAL PRIMARY KEY, name TEXT)
CREATE TABLE IF NOT EXISTS users (id INTEGER)
DROP TABLE users
DROP TABLE IF EXISTS users
```

### DML

```sql
INSERT INTO users (name) VALUES ($1)
INSERT INTO users (name) VALUES ($1) RETURNING *
SELECT * FROM users WHERE id = $1
SELECT name, age FROM users WHERE age > $1 ORDER BY name LIMIT 10
UPDATE users SET name = $1 WHERE id = $2
UPDATE users SET name = $1 WHERE id = $2 RETURNING *
DELETE FROM users WHERE id = $1
DELETE FROM users WHERE id = $1 RETURNING *
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

## License

MIT

## Links

- [GitHub](https://github.com/dot-do/dotdo)
- [Documentation](https://postgres.do)
- [.do](https://do.org.ai)
- [Platform.do](https://platform.do)
