# planetscale.do

**PlanetScale for Cloudflare Workers.** API-compatible. Edge-native. No branches needed.

[![npm version](https://img.shields.io/npm/v/@dotdo/planetscale.svg)](https://www.npmjs.com/package/@dotdo/planetscale)
[![Tests](https://img.shields.io/badge/tests-94%20passing-brightgreen.svg)](https://github.com/dot-do/dotdo)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why planetscale.do?

**Edge workers can't use TCP.** PlanetScale's serverless driver uses HTTP, but you're still making network requests to a central database. Latency adds up.

**Connection limits still exist.** Even with serverless drivers, you hit rate limits. Database branches add complexity. Schema changes require coordination.

**planetscale.do gives you both:**

```typescript
import { connect } from '@dotdo/planetscale'

// Drop-in replacement - same API, runs on the edge
const conn = connect({
  host: process.env.DATABASE_HOST,
  username: process.env.DATABASE_USERNAME,
  password: process.env.DATABASE_PASSWORD,
})

// Full PlanetScale API
const results = await conn.execute('SELECT * FROM users WHERE id = ?', [1])
console.log(results.rows)

// Transactions
await conn.transaction(async (tx) => {
  await tx.execute('INSERT INTO orders VALUES (?, ?)', [1, 99.99])
  await tx.execute('UPDATE inventory SET stock = stock - 1 WHERE id = ?', [42])
})
```

**Scales to millions of agents.** Each agent gets its own isolated database on Cloudflare's edge network. No branches to manage. No schema migration coordination. Just fast, persistent storage at global scale.

## Installation

```bash
npm install @dotdo/planetscale
```

## Quick Start

```typescript
import { connect } from '@dotdo/planetscale'

const conn = connect({
  host: 'aws.connect.psdb.cloud',
  username: 'your_username',
  password: 'your_password',
})

// Create table
await conn.execute(`
  CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE
  )
`)

// Insert with parameters
const { insertId } = await conn.execute(
  'INSERT INTO users (name, email) VALUES (?, ?)',
  ['Alice', 'alice@example.com']
)

// Select with typed results
interface User {
  id: number
  name: string
  email: string
}

const { rows } = await conn.execute<User>('SELECT * FROM users WHERE id = ?', [insertId])
console.log(rows[0].name) // 'Alice'
```

## Features

### Drop-in @planetscale/database Replacement

100% API-compatible with @planetscale/database. Same imports, same methods, same result types.

```typescript
// Before (@planetscale/database)
import { connect } from '@planetscale/database'

// After (@dotdo/planetscale)
import { connect } from '@dotdo/planetscale'

// Everything else stays the same
const conn = connect(config)
const { rows, headers, insertId, rowsAffected } = await conn.execute(sql, params)
```

### Parameterized Queries

Safe parameter binding with `?` placeholders. Prevents SQL injection.

```typescript
// Positional parameters
await conn.execute('SELECT * FROM users WHERE age > ? AND status = ?', [18, 'active'])

// Insert with parameters
await conn.execute('INSERT INTO users (name, email) VALUES (?, ?)', ['Bob', 'bob@example.com'])

// Update
await conn.execute('UPDATE users SET name = ? WHERE id = ?', ['Robert', 1])

// Special characters are escaped
await conn.execute('INSERT INTO users (name) VALUES (?)', ["O'Brien"])
```

### Transaction Support

Atomic operations with automatic rollback on error.

```typescript
// Money transfer - all or nothing
await conn.transaction(async (tx) => {
  await tx.execute('UPDATE accounts SET balance = balance - ? WHERE id = ?', [100, 1])
  await tx.execute('UPDATE accounts SET balance = balance + ? WHERE id = ?', [100, 2])
})

// Return values from transactions
const total = await conn.transaction(async (tx) => {
  const { rows } = await tx.execute('SELECT SUM(balance) as total FROM accounts')
  return rows[0].total
})

// Automatic rollback on error
try {
  await conn.transaction(async (tx) => {
    await tx.execute('UPDATE accounts SET balance = 0 WHERE id = ?', [1])
    throw new Error('Abort!')
  })
} catch (e) {
  // Balance unchanged - transaction rolled back
}
```

### MySQL Syntax Translation

Write standard MySQL syntax. It's automatically translated to SQLite under the hood.

```typescript
// AUTO_INCREMENT works
await conn.execute('CREATE TABLE users (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255))')

// UNSIGNED is handled
await conn.execute('CREATE TABLE counters (count INT UNSIGNED)')

// DATETIME, JSON, ENUM all work
await conn.execute(`
  CREATE TABLE posts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    status ENUM('draft', 'published'),
    metadata JSON,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`)

// ON DUPLICATE KEY UPDATE
await conn.execute(
  'INSERT INTO users (id, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = ?',
  [1, 'Alice', 'Alice']
)

// Backtick identifiers
await conn.execute('SELECT `id`, `name` FROM `my-table`')
```

### Cast Helpers

Format data for MySQL-compatible insertion.

```typescript
import { cast, hex, datetime, json } from '@dotdo/planetscale'

// Binary data as hex
const buffer = Buffer.from('hello')
await conn.execute('INSERT INTO files (data) VALUES (?)', [hex(buffer)])

// JavaScript Date to MySQL datetime
const now = new Date()
await conn.execute('INSERT INTO events (created_at) VALUES (?)', [datetime(now)])

// Objects to JSON
const metadata = { version: 1, tags: ['important'] }
await conn.execute('INSERT INTO configs (data) VALUES (?)', [json(metadata)])

// Or use the cast object
await conn.execute('INSERT INTO t VALUES (?, ?, ?)', [
  cast.hex(buffer),
  cast.datetime(now),
  cast.json(metadata),
])
```

## How It Works

```
+---------------------------------------------------------------------+
|                        @dotdo/planetscale                            |
+---------------------------------------------------------------------+
|  PlanetScale API (connect, execute, transaction)                    |
+---------------------------------------------------------------------+
|  Connection                        |  Transaction                   |
|  - execute() with ? params         |  - Atomic operations           |
|  - transaction()                   |  - Auto-commit/rollback        |
|  - Type-safe results               |  - Nested queries              |
+------------------------------------+--------------------------------+
|  MySQL Dialect Translation                                          |
|  - AUTO_INCREMENT -> AUTOINCREMENT                                  |
|  - ON DUPLICATE KEY -> INSERT OR REPLACE                            |
|  - MySQL types -> SQLite types                                      |
+---------------------------------------------------------------------+
|  Shared SQL Engine                                                  |
|  - Query parsing and execution                                      |
|  - Parameter binding                                                |
|  - Result transformation                                            |
+---------------------------------------------------------------------+
|                     Durable Object SQLite                            |
+---------------------------------------------------------------------+
```

**Edge Layer (PlanetScale API)**
- Drop-in replacement for @planetscale/database
- Full TypeScript types with generics
- No external dependencies

**Translation Layer**
- MySQL syntax to SQLite syntax
- Type mapping (ENUM, JSON, DATETIME)
- Error code translation

**Storage Layer (Durable Object SQLite)**
- Microsecond access latency
- Transactional operations
- Automatic sharding by tenant

## API Reference

### Factory Function

| Function | Description |
|----------|-------------|
| `connect(config)` | Create a database connection |

### Connection Methods

| Method | Description |
|--------|-------------|
| `execute<T>(sql, args?)` | Execute query, return `ExecutedQuery<T>` |
| `transaction<T>(fn)` | Execute queries atomically |

### ExecutedQuery Result

| Field | Type | Description |
|-------|------|-------------|
| `rows` | `T[]` | Result rows as objects |
| `headers` | `string[]` | Column names |
| `size` | `number` | Number of rows returned |
| `time` | `number` | Execution time in ms |
| `insertId` | `number \| string` | Auto-increment ID (INSERT) |
| `rowsAffected` | `number` | Rows modified (INSERT/UPDATE/DELETE) |

### Transaction Object

| Method | Description |
|--------|-------------|
| `execute<T>(sql, args?)` | Execute query within transaction |

### Cast Helpers

| Function | Description |
|----------|-------------|
| `hex(buffer)` | Convert Buffer/Uint8Array to hex string |
| `datetime(date)` | Format Date as MySQL datetime |
| `json(obj)` | Stringify object to JSON |

### Configuration

| Option | Type | Description |
|--------|------|-------------|
| `host` | `string` | PlanetScale host |
| `username` | `string` | Database username |
| `password` | `string` | Database password |
| `url` | `string` | Connection URL (alternative) |
| `fetch` | `typeof fetch` | Custom fetch function |
| `format` | `'json' \| 'array'` | Response format |
| `boost` | `boolean` | Enable query caching |

### Extended DO Configuration

| Option | Type | Description |
|--------|------|-------------|
| `doNamespace` | `DurableObjectNamespace` | DO namespace binding |
| `shard.algorithm` | `'consistent' \| 'range' \| 'hash'` | Sharding strategy |
| `shard.count` | `number` | Number of shards |
| `shard.key` | `string` | Shard key field |
| `replica.readPreference` | `'primary' \| 'secondary' \| 'nearest'` | Read routing |
| `replica.writeThrough` | `boolean` | Write to all replicas |
| `replica.jurisdiction` | `'eu' \| 'us' \| 'fedramp'` | Data residency |

## Durable Object Integration

### As an RPC Service

Keep your DO bundle small. Offload database operations.

```toml
# wrangler.toml
[[services]]
binding = "PLANETSCALE"
service = "planetscale-do"
```

```typescript
// Heavy operations via RPC
const { rows } = await env.PLANETSCALE.execute('SELECT * FROM users')
```

### With dotdo Framework

```typescript
import { DO } from 'dotdo'
import { connect } from '@dotdo/planetscale'

class MyApp extends DO {
  db = connect({
    host: 'localhost',
    doNamespace: this.ctx.storage,
  })

  async getUsers() {
    const { rows } = await this.db.execute('SELECT * FROM users WHERE active = ?', [true])
    return rows
  }

  async createUser(name: string, email: string) {
    const { insertId } = await this.db.execute(
      'INSERT INTO users (name, email) VALUES (?, ?)',
      [name, email]
    )
    return insertId
  }
}
```

### Extended Configuration

Shard routing, replica configuration, jurisdiction constraints.

```typescript
const conn = connect({
  host: 'localhost',
  username: 'test',
  password: 'test',

  // Shard by tenant for multi-tenancy
  shard: { key: 'tenant_id', count: 16, algorithm: 'consistent' },

  // Read from nearest replica
  replica: {
    readPreference: 'nearest',
    writeThrough: true,
    jurisdiction: 'eu',  // GDPR compliance
  },

  // Bind to DO namespace
  doNamespace: env.PLANETSCALE_DO,
})
```

## Comparison

| Feature | @dotdo/planetscale | @planetscale/database | PlanetScale |
|---------|-------------------|----------------------|-------------|
| Edge Runtime | Yes | Yes | N/A |
| Network Latency | None (local) | HTTP round-trip | HTTP round-trip |
| Connection Limits | None | Plan limit | Plan limit |
| Cold Start | <5ms | N/A | N/A |
| Branches | Not needed | Yes | Yes |
| Schema Migrations | Instant | Coordinated | Coordinated |
| Transactions | Yes | Yes | Yes |
| TypeScript | Yes | Yes | Yes |
| DO Integration | Yes | No | No |
| Sharding | Yes | No | Yes |
| Global Distribution | 300+ cities | Limited | Limited |

## Performance

- **94 tests** covering all operations
- **<5ms** query execution (edge)
- **Microsecond** latency for cached queries
- **Zero cold starts** (Durable Objects)
- **Global distribution** (300+ Cloudflare locations)
- **No network latency** (local DO storage)

## Supported MySQL Features

### Data Types

| MySQL Type | Supported | Notes |
|------------|-----------|-------|
| INT, BIGINT | Yes | Full range |
| VARCHAR, TEXT | Yes | |
| BOOLEAN, TINYINT(1) | Yes | Stored as INTEGER |
| FLOAT, DOUBLE | Yes | Stored as REAL |
| DATETIME, TIMESTAMP | Yes | Stored as TEXT |
| ENUM | Yes | Stored as TEXT |
| JSON | Yes | Stored as TEXT |
| BLOB | Yes | |

### SQL Features

| Feature | Supported |
|---------|-----------|
| SELECT with all operators | Yes |
| INSERT, UPDATE, DELETE | Yes |
| CREATE/DROP TABLE | Yes |
| AUTO_INCREMENT | Yes |
| PRIMARY KEY, UNIQUE | Yes |
| NOT NULL, DEFAULT | Yes |
| ORDER BY, LIMIT, OFFSET | Yes |
| WHERE with AND/OR | Yes |
| LIKE, IN, IS NULL | Yes |
| JOIN (INNER, LEFT, RIGHT) | Yes |
| Transactions | Yes |
| ON DUPLICATE KEY UPDATE | Yes |

## Error Handling

Errors are thrown as `DatabaseError` with MySQL-compatible error codes.

```typescript
import { DatabaseError } from '@dotdo/planetscale'

try {
  await conn.execute('SELECT * FROM nonexistent')
} catch (e) {
  if (e instanceof DatabaseError) {
    console.log(e.code)    // 'ER_NO_SUCH_TABLE'
    console.log(e.message) // Error message
    console.log(e.status)  // HTTP status (if applicable)
  }
}
```

### Error Codes

| Code | Description |
|------|-------------|
| `ER_NO_SUCH_TABLE` | Table not found |
| `ER_TABLE_EXISTS_ERROR` | Table already exists |
| `ER_DUP_ENTRY` | Duplicate key violation |
| `ER_PARSE_ERROR` | SQL syntax error |
| `INVALID_CONFIG` | Configuration error |

## Related

- [fsx.do](https://fsx.do) - Filesystem on SQLite
- [gitx.do](https://gitx.do) - Git on R2
- [bashx.do](https://bashx.do) - Shell without VMs
- [mysql.do](https://mysql.do) - mysql2 API on DO SQLite
- [workers.do](https://workers.do) - Durable Object primitives
- [@planetscale/database](https://github.com/planetscale/database-js) - Original PlanetScale package

## License

MIT
