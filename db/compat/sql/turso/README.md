# turso.do

**Turso for Cloudflare Workers.** libsql-compatible. Edge-native. Serverless scale.

[![npm version](https://img.shields.io/npm/v/@dotdo/turso.svg)](https://www.npmjs.com/package/@dotdo/turso)
[![Tests](https://img.shields.io/badge/tests-58%20passing-brightgreen.svg)](https://github.com/dot-do/dotdo)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why turso.do?

**Edge workers can't use @libsql/client.** The official Turso SDK relies on HTTP connections, WebSocket pooling, and external database servers. That means latency, cold starts, and connection limits.

**AI agents need Turso's API.** They need familiar patterns - `execute()`, `batch()`, transactions. Not a new database to learn.

**turso.do gives you both:**

```typescript
import { createClient } from '@dotdo/turso'

// Drop-in replacement - same API, runs on the edge
const client = createClient({
  url: 'libsql://your-db.turso.io',
  authToken: 'your-token',
})

// Full libsql API
const result = await client.execute('SELECT * FROM users WHERE id = ?', [1])

// Batch operations
const results = await client.batch([
  'CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)',
  { sql: 'INSERT INTO posts VALUES (?, ?)', args: [1, 'Hello'] },
])

// Interactive transactions
const tx = await client.transaction()
await tx.execute('UPDATE accounts SET balance = balance - ? WHERE id = ?', [100, 1])
await tx.execute('UPDATE accounts SET balance = balance + ? WHERE id = ?', [100, 2])
await tx.commit()
```

**Scales to millions of agents.** Each agent gets its own isolated database on Cloudflare's edge network. No shared state. No noisy neighbors. No connection limits.

## Installation

```bash
npm install @dotdo/turso
```

## Quick Start

```typescript
import { createClient } from '@dotdo/turso'

const client = createClient({ url: ':memory:' })

// Create tables
await client.execute(`
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE
  )
`)

// Insert with parameters
await client.execute({
  sql: 'INSERT INTO users (name, email) VALUES (?, ?)',
  args: ['Alice', 'alice@example.com.ai'],
})

// Query
const { rows } = await client.execute('SELECT * FROM users')
console.log(rows[0].name)  // 'Alice'
console.log(rows[0]['email'])  // 'alice@example.com.ai'

client.close()
```

## Features

### Drop-in @libsql/client Replacement

100% API-compatible. Same imports, same methods, same result types.

```typescript
// Before (@libsql/client)
import { createClient } from '@libsql/client'

// After (@dotdo/turso)
import { createClient } from '@dotdo/turso'

// Everything else stays the same
const client = createClient({ url: ':memory:' })
const result = await client.execute('SELECT * FROM users')
```

### execute() - Single Queries

Run a single SQL statement with optional parameters.

```typescript
// Simple query
const result = await client.execute('SELECT * FROM users')

// Positional parameters
const result = await client.execute({
  sql: 'SELECT * FROM users WHERE id = ?',
  args: [1],
})

// Named parameters
const result = await client.execute({
  sql: 'SELECT * FROM users WHERE name = :name',
  args: { name: 'Alice' },
})

// Result shape
result.columns      // ['id', 'name', 'email']
result.columnTypes  // ['INTEGER', 'TEXT', 'TEXT']
result.rows         // Row[] with index and column access
result.rowsAffected // Number of rows modified
result.lastInsertRowid // BigInt of last insert
```

### batch() - Multiple Queries

Execute multiple statements in an implicit transaction. All succeed or all fail.

```typescript
const results = await client.batch([
  'CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)',
  { sql: 'INSERT INTO posts VALUES (?, ?)', args: [1, 'First Post'] },
  { sql: 'INSERT INTO posts VALUES (?, ?)', args: [2, 'Second Post'] },
  'SELECT * FROM posts',
])

// results[3].rows.length === 2
```

### transaction() - Interactive Transactions

Full transaction control with commit and rollback.

```typescript
const tx = await client.transaction()

try {
  await tx.execute('INSERT INTO orders VALUES (?, ?)', [1, 99.99])
  await tx.execute('UPDATE inventory SET stock = stock - 1 WHERE id = ?', [42])
  await tx.commit()
} catch (e) {
  await tx.rollback()
  throw e
}
```

Transaction modes:

```typescript
// Write mode (default) - allows reads and writes
const tx = await client.transaction('write')

// Read mode - only allows SELECT
const tx = await client.transaction('read')

// Deferred mode - acquires lock on first write
const tx = await client.transaction('deferred')
```

### Row Access

Rows are accessible by both index and column name.

```typescript
const { rows } = await client.execute('SELECT id, name FROM users')

// By index
rows[0][0]  // 1
rows[0][1]  // 'Alice'

// By column name
rows[0]['id']    // 1
rows[0].name     // 'Alice'
rows[0].length   // 2
```

### Type Coercion

JavaScript types are automatically converted to SQLite-compatible values.

```typescript
await client.execute({
  sql: 'INSERT INTO events VALUES (?, ?, ?)',
  args: [
    true,              // → 1 (INTEGER)
    new Date(),        // → '2025-01-09T...' (TEXT)
    null,              // → NULL
  ],
})
```

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                        @dotdo/turso                              │
├─────────────────────────────────────────────────────────────────┤
│  libsql Client API                                               │
│  • createClient(config)                                          │
│  • execute() / batch() / transaction()                           │
│  • sync() for embedded replicas                                  │
├─────────────────────────────────────────────────────────────────┤
│  Statement Parser                                                │
│  • Positional args (?)                                           │
│  • Named args (:name)                                            │
│  • Type coercion (boolean, Date, Uint8Array)                     │
├─────────────────────────────────────────────────────────────────┤
│  Shared SQL Engine                                               │
│  • SQLite dialect                                                │
│  • Transaction management                                        │
│  • Error mapping to LibsqlError                                  │
├─────────────────────────────────────────────────────────────────┤
│                    Durable Object SQLite                         │
└─────────────────────────────────────────────────────────────────┘
```

**Edge Layer (libsql API)**
- Drop-in replacement for @libsql/client
- Full TypeScript types
- No external dependencies

**Storage Layer (Durable Object SQLite)**
- Microsecond access latency
- Transactional operations
- Automatic sharding by tenant

## API Reference

### createClient

| Option | Type | Description |
|--------|------|-------------|
| `url` | `string` | Database URL (libsql:, http:, https:, ws:, wss:, file:, :memory:) |
| `authToken` | `string` | Auth token for remote databases |
| `syncUrl` | `string` | URL for embedded replica sync |
| `syncInterval` | `number` | Auto-sync interval in seconds |
| `intMode` | `'number' \| 'bigint' \| 'string'` | Integer representation |
| `concurrency` | `number` | Max concurrent requests (default: 20) |

### Client Methods

| Method | Description |
|--------|-------------|
| `execute(stmt)` | Execute single statement |
| `batch(stmts, mode?)` | Execute multiple statements in transaction |
| `migrate(stmts)` | Apply database migrations |
| `transaction(mode?)` | Start interactive transaction |
| `executeMultiple(sql)` | Execute semicolon-separated statements |
| `sync()` | Sync embedded replica with remote |
| `close()` | Close client connection |
| `reconnect()` | Reconnect HTTP/WS connection |

### Transaction Methods

| Method | Description |
|--------|-------------|
| `execute(stmt)` | Execute statement in transaction |
| `batch(stmts)` | Execute multiple statements |
| `executeMultiple(sql)` | Execute semicolon-separated statements |
| `commit()` | Commit transaction |
| `rollback()` | Rollback transaction |
| `close()` | Close (rollback if not committed) |

### ResultSet

| Field | Type | Description |
|-------|------|-------------|
| `columns` | `string[]` | Column names |
| `columnTypes` | `string[]` | SQLite column types |
| `rows` | `Row[]` | Result rows |
| `rowsAffected` | `number` | Rows affected by statement |
| `lastInsertRowid` | `bigint \| undefined` | Last inserted row ID |
| `toJSON()` | `object` | JSON-serializable result |

### Error Classes

| Class | Description |
|-------|-------------|
| `LibsqlError` | Base error with `code` property |
| `LibsqlBatchError` | Batch error with `statementIndex` |

## Durable Object Integration

### As an RPC Service

Keep your DO bundle small. Offload database operations.

```toml
# wrangler.toml
[[services]]
binding = "TURSO"
service = "turso-do"
```

```typescript
// Heavy operations via RPC
const result = await env.TURSO.execute('SELECT * FROM users')
```

### With dotdo Framework

```typescript
import { DO } from 'dotdo'
import { createClient } from '@dotdo/turso'

class MyApp extends DO {
  db = createClient({
    url: ':memory:',
    doNamespace: this.ctx.storage,
  })

  async getUsers() {
    const { rows } = await this.db.execute(
      'SELECT * FROM users WHERE active = ?',
      [true]
    )
    return rows
  }
}
```

### Extended Configuration

Shard routing, replica configuration, jurisdiction constraints.

```typescript
import { createClient } from '@dotdo/turso'
import type { ExtendedTursoConfig } from '@dotdo/turso'

const client = createClient({
  url: ':memory:',

  // Shard by tenant for multi-tenancy
  shard: { key: 'tenant_id', count: 16, algorithm: 'consistent' },

  // Read from nearest replica
  replica: {
    readPreference: 'nearest',
    writeThrough: true,
    jurisdiction: 'eu',  // GDPR compliance
  },

  // Bind to DO namespace
  doNamespace: env.TURSO_DO,
} as ExtendedTursoConfig)
```

## Comparison

| Feature | @dotdo/turso | @libsql/client | D1 |
|---------|--------------|----------------|-----|
| Edge Runtime | Yes | Limited | Yes |
| libsql API | Yes | Yes | No |
| Connection Limits | None | Plan limit | N/A |
| Transactions | Yes | Yes | Yes |
| Batch Operations | Yes | Yes | Yes |
| Interactive Transactions | Yes | Yes | No |
| Row Index Access | Yes | Yes | No |
| Zero Dependencies | Yes | No | Yes |
| DO Integration | Yes | No | No |
| Sharding | Yes | No | No |
| Global Distribution | 300+ cities | Limited | 300+ cities |

## Performance

- **58 tests** covering all operations
- **Microsecond latency** for DO SQLite operations
- **Zero cold starts** (Durable Objects)
- **Global distribution** (300+ Cloudflare locations)
- **Zero HTTP connections** (no network overhead)

## Supported SQL

### DDL

```sql
CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)
CREATE TABLE IF NOT EXISTS users (id INTEGER)
CREATE INDEX idx ON users(name)
DROP TABLE users
DROP TABLE IF EXISTS users
```

### DML

```sql
INSERT INTO users (name) VALUES (?)
INSERT INTO users (name) VALUES (?) RETURNING *
SELECT * FROM users WHERE id = ?
SELECT name, age FROM users WHERE age > ? ORDER BY name LIMIT 10
UPDATE users SET name = ? WHERE id = ?
UPDATE users SET name = ? WHERE id = ? RETURNING *
DELETE FROM users WHERE id = ?
```

### Transactions

```sql
BEGIN
BEGIN IMMEDIATE
BEGIN DEFERRED
COMMIT
ROLLBACK
SAVEPOINT sp1
RELEASE SAVEPOINT sp1
ROLLBACK TO SAVEPOINT sp1
```

## Error Handling

Errors are thrown as `LibsqlError` with SQLite-compatible codes.

```typescript
import { LibsqlError, LibsqlBatchError } from '@dotdo/turso'

try {
  await client.execute('SELECT * FROM nonexistent')
} catch (e) {
  if (e instanceof LibsqlError) {
    console.log(e.code)     // 'SQLITE_ERROR'
    console.log(e.message)  // Error message
  }
}

// Batch errors include statement index
try {
  await client.batch([...])
} catch (e) {
  if (e instanceof LibsqlBatchError) {
    console.log(e.statementIndex)  // Which statement failed
  }
}
```

### Error Codes

| Code | Description |
|------|-------------|
| `SQLITE_ERROR` | Generic SQL error |
| `SQLITE_CONSTRAINT_UNIQUE` | Unique constraint violation |
| `SQLITE_READONLY` | Write in read-only transaction |
| `SQLITE_MISUSE` | Client/transaction already closed |

## License

MIT

## Related

- [GitHub](https://github.com/dot-do/dotdo)
- [Documentation](https://turso.do)
- [Turso Docs](https://docs.turso.tech/sdk/ts/reference)
- [.do](https://do.org.ai)
- [Platform.do](https://platform.do)
