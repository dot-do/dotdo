# neon.do

**Neon for Cloudflare Workers.** Serverless Postgres API. Edge-native. Always on.

[![npm version](https://img.shields.io/npm/v/@dotdo/neon.svg)](https://www.npmjs.com/package/@dotdo/neon)
[![Tests](https://img.shields.io/badge/tests-passing-brightgreen.svg)](https://github.com/dot-do/dotdo)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why neon.do?

**Neon's serverless driver doesn't work everywhere.** It needs WebSockets or HTTP to reach Neon's servers. Some edge runtimes restrict outbound connections. Cold starts add latency.

**AI agents need instant Postgres.** They need the familiar `neon()` template tag, `Pool`, and `Client` APIs. They need transactions. They need it fast.

**neon.do gives you both:**

```typescript
import { neon, Pool } from '@dotdo/neon'

// Drop-in replacement - same API, runs on the edge
const sql = neon(process.env.DATABASE_URL)

// SQL template tag - the main API
const users = await sql`SELECT * FROM users WHERE id = ${userId}`

// Pool for pg-compatible code
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const { rows } = await pool.query('SELECT * FROM users')
```

**Scales to millions of agents.** Each agent gets its own isolated database on Cloudflare's edge network. No connection poolers. No cold starts. No WebSocket negotiation.

## Installation

```bash
npm install @dotdo/neon
```

## Quick Start

```typescript
import { neon, neonConfig, Pool, Client } from '@dotdo/neon'

// SQL template tag (recommended)
const sql = neon('postgres://user:pass@host/db')

// Create tables
await sql`
  CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE
  )
`

// Insert with interpolation (safe from SQL injection)
const name = 'Alice'
const email = 'alice@example.com'
await sql`INSERT INTO users (name, email) VALUES (${name}, ${email})`

// Query with interpolation
const userId = 1
const users = await sql`SELECT * FROM users WHERE id = ${userId}`
```

## Features

### SQL Template Tag

The `neon()` function returns a template tag for safe, readable queries.

```typescript
const sql = neon('postgres://localhost/mydb')

// Values are automatically parameterized
const id = 1
const result = await sql`SELECT * FROM users WHERE id = ${id}`

// Multiple interpolations
const minAge = 18
const status = 'active'
const users = await sql`
  SELECT * FROM users
  WHERE age > ${minAge} AND status = ${status}
`

// Returns array of row objects by default
// [{ id: 1, name: 'Alice', email: 'alice@example.com' }]
```

### Full Results Mode

Get complete query metadata with `fullResults: true`.

```typescript
const sql = neon('postgres://localhost/mydb', { fullResults: true })

const result = await sql`SELECT * FROM users`
// {
//   rows: [{ id: 1, name: 'Alice' }],
//   fields: [{ name: 'id', dataTypeID: 23 }, ...],
//   rowCount: 1,
//   command: 'SELECT',
//   oid: 0
// }
```

### Array Mode

Get rows as arrays instead of objects with `arrayMode: true`.

```typescript
const sql = neon('postgres://localhost/mydb', { arrayMode: true })

const result = await sql`SELECT id, name FROM users`
// [[1, 'Alice'], [2, 'Bob']]
```

### Parameterized Queries

Call `sql()` as a function for explicit parameter binding.

```typescript
const sql = neon('postgres://localhost/mydb')

// $1, $2, $3 parameter syntax
const result = await sql('SELECT * FROM users WHERE id = $1', [1])

// Multiple parameters
const users = await sql(
  'SELECT * FROM users WHERE age > $1 AND status = $2',
  [18, 'active']
)
```

### Transaction Support

Execute multiple queries atomically.

```typescript
const sql = neon('postgres://localhost/mydb')

// Callback style (recommended)
await sql.transaction(async (tx) => {
  await tx`UPDATE accounts SET balance = balance - 100 WHERE id = 1`
  await tx`UPDATE accounts SET balance = balance + 100 WHERE id = 2`
})

// Array style
const results = await sql.transaction([
  sql`INSERT INTO users (name) VALUES ('Alice')`,
  sql`INSERT INTO users (name) VALUES ('Bob')`,
])
```

Transactions automatically rollback on error:

```typescript
try {
  await sql.transaction(async (tx) => {
    await tx`UPDATE accounts SET balance = balance - 100 WHERE id = 1`
    throw new Error('Abort!')  // Triggers rollback
  })
} catch (e) {
  // Balance unchanged
}
```

### Pool (pg-compatible)

Full connection pool implementation for pg-style code.

```typescript
const pool = new Pool({
  connectionString: 'postgres://localhost/mydb',
  max: 20,                      // Maximum connections
  idleTimeoutMillis: 10000,     // Close idle after 10s
  connectionTimeoutMillis: 30000, // Wait 30s for connection
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

await pool.end()
```

### Client (pg-compatible)

Single connection for simpler use cases.

```typescript
const client = new Client({
  host: 'localhost',
  database: 'mydb',
  user: 'postgres',
  password: 'secret',
})

await client.connect()

const { rows } = await client.query('SELECT * FROM users WHERE id = $1', [1])

await client.end()
```

### PostgreSQL Error Codes

Authentic PostgreSQL error codes for proper error handling.

```typescript
import { NeonDbError } from '@dotdo/neon'

try {
  await sql`SELECT * FROM nonexistent_table`
} catch (e) {
  if (e instanceof NeonDbError) {
    console.log(e.code)      // '42P01' - table not found
    console.log(e.severity)  // 'ERROR'
    console.log(e.message)   // 'Table not found: nonexistent_table'
  }
}

// Common error codes
// 42P01 - table not found
// 42P07 - table already exists
// 23505 - unique constraint violation
// 42601 - syntax error
```

## How It Works

```
+---------------------------------------------------------------------+
|                          @dotdo/neon                                 |
+---------------------------------------------------------------------+
|  Neon Serverless API                                                 |
|  - neon() SQL template tag                                          |
|  - Pool / Client (pg-compatible)                                     |
|  - Transactions                                                      |
+---------------------------------------------------------------------+
|  neon()                          |  Pool / Client                    |
|  - Template tag interpolation    |  - Connection pooling             |
|  - $1, $2 parameterized queries  |  - Event emitters                 |
|  - fullResults / arrayMode       |  - Checkout / release             |
|  - transaction()                 |  - BEGIN / COMMIT / ROLLBACK      |
+----------------------------------+----------------------------------+
|  Shared SQL Engine                                                   |
|  - PostgreSQL dialect parser                                         |
|  - DDL: CREATE/DROP TABLE                                            |
|  - DML: SELECT/INSERT/UPDATE/DELETE                                  |
|  - Transactions: BEGIN/COMMIT/ROLLBACK                               |
+---------------------------------------------------------------------+
|                     Durable Object SQLite                            |
+---------------------------------------------------------------------+
```

**Edge Layer (Neon API)**
- Drop-in replacement for @neondatabase/serverless
- Full TypeScript support
- No external dependencies

**Storage Layer (Durable Object SQLite)**
- Microsecond access latency
- Transactional operations
- Automatic sharding by tenant

## API Reference

### neon()

| Parameter | Type | Description |
|-----------|------|-------------|
| `connectionString` | `string` | PostgreSQL connection URL |
| `options.fullResults` | `boolean` | Return full QueryResult object |
| `options.arrayMode` | `boolean` | Return rows as arrays |
| `options.fetchOptions` | `RequestInit` | Fetch options (ignored in DO mode) |

### NeonSqlFunction

| Method | Description |
|--------|-------------|
| `` sql`...` `` | Execute template tag query |
| `sql(text, values?)` | Execute parameterized query |
| `sql.transaction(queries)` | Execute array of queries atomically |
| `sql.transaction(callback)` | Execute callback in transaction |

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

### Client

| Method | Description |
|--------|-------------|
| `new Client(config?)` | Create client with config |
| `connect()` | Establish connection |
| `query(text, values?)` | Execute parameterized query |
| `end()` | Close connection |
| `escapeLiteral(value)` | Escape string literal |
| `escapeIdentifier(value)` | Escape identifier |

### QueryResult

| Field | Type | Description |
|-------|------|-------------|
| `rows` | `R[]` | Result rows |
| `fields` | `FieldDef[]` | Column definitions |
| `rowCount` | `number` | Rows affected |
| `command` | `string` | SQL command (SELECT, INSERT, etc.) |
| `oid` | `number` | OID of inserted row (legacy) |

### neonConfig

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `fetchConnectionCache` | `boolean` | `false` | Cache connections |
| `poolQueryViaFetch` | `boolean` | `false` | Use HTTP for pool queries |
| `fetchEndpoint` | `function` | - | Custom fetch endpoint |
| `wsProxy` | `string` | - | WebSocket proxy URL |
| `useSecureWebSocket` | `boolean` | `true` | Use secure WebSocket |
| `pipelineConnect` | `string` | `'password'` | Pipeline connect mode |
| `coalesceWrites` | `boolean` | `true` | Coalesce writes |

### Type Constants

```typescript
import { types } from '@dotdo/neon'

types.BOOL      // 16
types.INT4      // 23
types.TEXT      // 25
types.JSON      // 114
types.JSONB     // 3802
types.UUID      // 2950
types.TIMESTAMP // 1114
```

## Durable Object Integration

### As an RPC Service

Keep your DO bundle small. Offload database operations.

```toml
# wrangler.toml
[[services]]
binding = "NEON"
service = "neon-do"
```

```typescript
// Heavy operations via RPC
const users = await env.NEON.query('SELECT * FROM users')
```

### With dotdo Framework

```typescript
import { DO } from 'dotdo'
import { neon } from '@dotdo/neon'

class MyApp extends DO {
  sql = neon('postgres://localhost/mydb')

  async getUsers() {
    return this.sql`SELECT * FROM users WHERE active = ${true}`
  }

  async createUser(name: string, email: string) {
    return this.sql`
      INSERT INTO users (name, email)
      VALUES (${name}, ${email})
      RETURNING *
    `
  }
}
```

## Comparison

| Feature | @dotdo/neon | @neondatabase/serverless | pg |
|---------|-------------|--------------------------|-----|
| Edge Runtime | Yes | Yes | No |
| SQL Template Tag | Yes | Yes | No |
| Pool/Client API | Yes | Yes | Yes |
| Transactions | Yes | Yes | Yes |
| WebSocket Required | No | Yes (or HTTP) | N/A |
| External Connection | No | Yes | Yes |
| Cold Start | 0ms | ~50ms | N/A |
| DO Integration | Yes | No | No |
| Sharding | Yes | No | No |

## Performance

- **0ms cold starts** (Durable Objects)
- **Microsecond latency** for DO SQLite operations
- **No network round-trips** to external databases
- **Global distribution** (300+ Cloudflare locations)
- **No connection pooling overhead** (isolated per agent)

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

## Migration from @neondatabase/serverless

```typescript
// Before
import { neon, Pool } from '@neondatabase/serverless'

// After
import { neon, Pool } from '@dotdo/neon'

// Everything else stays the same
const sql = neon(process.env.DATABASE_URL)
const users = await sql`SELECT * FROM users`
```

## Related

- [postgres.do](https://postgres.do) - pg API-compatible
- [mysql.do](https://mysql.do) - mysql2 API-compatible
- [fsx.do](https://fsx.do) - Filesystem on SQLite
- [gitx.do](https://gitx.do) - Git on R2
- [workers.do](https://workers.do) - Durable Object primitives

## License

MIT

## Links

- [GitHub](https://github.com/dot-do/dotdo)
- [Documentation](https://neon.do)
- [Neon](https://neon.tech)
- [Platform.do](https://platform.do)
