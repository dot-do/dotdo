# mysql.do

**MySQL for Cloudflare Workers.** mysql2-compatible. Edge-native. No connection limits.

[![npm version](https://img.shields.io/npm/v/@dotdo/mysql.svg)](https://www.npmjs.com/package/@dotdo/mysql)
[![Tests](https://img.shields.io/badge/tests-106%20passing-brightgreen.svg)](https://github.com/dot-do/dotdo)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why mysql.do?

**Edge workers can't connect to MySQL.** Traditional MySQL drivers require TCP sockets, connection pools, and long-lived processes. V8 isolates have none of these.

**Connection limits kill scale.** Every serverless invocation opens a connection. At scale, you hit MySQL's max_connections limit. PlanetScale, Neon, and Turso all have connection limits.

**mysql.do gives you both:**

```typescript
import mysql from '@dotdo/mysql'

// Drop-in replacement - same API as mysql2/promise
const connection = await mysql.createConnection({
  host: 'localhost',
  user: 'root',
  database: 'myapp',
})

// Full mysql2 API
const [rows] = await connection.query('SELECT * FROM users WHERE id = ?', [1])
const [result] = await connection.execute<mysql.ResultSetHeader>(
  'INSERT INTO users (name, email) VALUES (?, ?)',
  ['Alice', 'alice@example.com']
)

await connection.end()
```

**Scales to millions of agents.** Each agent gets its own isolated database on Cloudflare's edge network. No shared connections. No connection pools to exhaust. Just fast, persistent storage at global scale.

## Installation

```bash
npm install @dotdo/mysql
```

## Quick Start

```typescript
import mysql from '@dotdo/mysql'
// or
import { createConnection, createPool } from '@dotdo/mysql'

// Single connection
const connection = await mysql.createConnection({
  host: 'localhost',
  user: 'root',
  database: 'test',
})

// Execute queries
await connection.query('CREATE TABLE users (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255))')
await connection.execute('INSERT INTO users (name) VALUES (?)', ['Alice'])
const [rows] = await connection.query('SELECT * FROM users')

await connection.end()

// Connection pool
const pool = mysql.createPool({
  host: 'localhost',
  database: 'test',
  connectionLimit: 10,
})

const [rows] = await pool.query('SELECT * FROM users WHERE active = ?', [true])
await pool.end()
```

## Features

### Drop-in mysql2 Replacement

100% API-compatible with `mysql2/promise`. Same imports, same methods, same result types.

```typescript
// Before (mysql2)
import mysql from 'mysql2/promise'

// After (@dotdo/mysql)
import mysql from '@dotdo/mysql'

// Everything else stays the same
const connection = await mysql.createConnection(config)
const [rows, fields] = await connection.query('SELECT * FROM users')
```

### Connection Pooling

Full connection pool implementation with limits, queuing, and automatic cleanup.

```typescript
const pool = mysql.createPool({
  host: 'localhost',
  database: 'myapp',
  connectionLimit: 10,     // Max connections
  queueLimit: 0,           // Unlimited queue
  waitForConnections: true,
  connectTimeout: 30000,
})

// Direct pool queries
const [rows] = await pool.query('SELECT * FROM users')

// Get connection for transactions
const connection = await pool.getConnection()
try {
  await connection.beginTransaction()
  await connection.query('UPDATE accounts SET balance = balance - ? WHERE id = ?', [100, 1])
  await connection.query('UPDATE accounts SET balance = balance + ? WHERE id = ?', [100, 2])
  await connection.commit()
} catch (e) {
  await connection.rollback()
  throw e
} finally {
  connection.release()
}

await pool.end()
```

### Prepared Statements

Execute parameterized queries with `?` placeholders.

```typescript
// SELECT with parameters
const [rows] = await connection.execute<RowDataPacket[]>(
  'SELECT * FROM users WHERE age > ? AND status = ?',
  [18, 'active']
)

// INSERT with auto-increment
const [result] = await connection.execute<ResultSetHeader>(
  'INSERT INTO users (name, email) VALUES (?, ?)',
  ['Bob', 'bob@example.com']
)
console.log(result.insertId)  // Auto-generated ID
console.log(result.affectedRows)  // 1

// UPDATE
const [updateResult] = await connection.execute<ResultSetHeader>(
  'UPDATE users SET name = ? WHERE id = ?',
  ['Robert', result.insertId]
)
console.log(updateResult.changedRows)  // Rows actually changed

// DELETE
const [deleteResult] = await connection.execute<ResultSetHeader>(
  'DELETE FROM users WHERE id = ?',
  [1]
)
```

### Transaction Support

Full transaction support with BEGIN, COMMIT, and ROLLBACK.

```typescript
const connection = await mysql.createConnection(config)

await connection.beginTransaction()

try {
  // Transfer money between accounts
  await connection.query('UPDATE accounts SET balance = balance - ? WHERE id = ?', [100, 1])
  await connection.query('UPDATE accounts SET balance = balance + ? WHERE id = ?', [100, 2])

  await connection.commit()
} catch (e) {
  await connection.rollback()
  throw e
}
```

### MySQL Syntax Translation

Write standard MySQL syntax - it's automatically translated to SQLite under the hood.

```typescript
// AUTO_INCREMENT works
await connection.query('CREATE TABLE users (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255))')

// UNSIGNED is handled
await connection.query('CREATE TABLE counters (count INT UNSIGNED)')

// DATETIME, ENUM, JSON all work
await connection.query(`
  CREATE TABLE posts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    status ENUM('draft', 'published'),
    metadata JSON,
    created_at DATETIME
  )
`)

// ON DUPLICATE KEY UPDATE
await connection.query(
  'INSERT INTO users (id, name) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = ?',
  [1, 'Alice', 'Alice']
)

// Backtick identifiers
await connection.query('SELECT `id`, `name` FROM `users`')
```

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                        @dotdo/mysql                              │
├─────────────────────────────────────────────────────────────────┤
│  mysql2/promise API                                              │
│  • createConnection / createPool                                 │
│  • query() / execute()                                           │
│  • beginTransaction / commit / rollback                          │
├─────────────────────────────────────────────────────────────────┤
│  MySQL Dialect Translation                                       │
│  • AUTO_INCREMENT → AUTOINCREMENT                                │
│  • UNSIGNED → (removed)                                          │
│  • DATETIME/ENUM → TEXT                                          │
│  • ON DUPLICATE KEY → INSERT OR REPLACE                          │
├─────────────────────────────────────────────────────────────────┤
│  Shared SQL Engine                                               │
│  • Query parsing and execution                                   │
│  • Parameter binding                                             │
│  • Result transformation                                         │
├─────────────────────────────────────────────────────────────────┤
│                    Durable Object SQLite                         │
└─────────────────────────────────────────────────────────────────┘
```

**Edge Layer (mysql2 API)**
- Drop-in replacement for mysql2/promise
- Full TypeScript types
- Connection pooling with queue management

**Translation Layer**
- MySQL syntax → SQLite syntax
- Type mapping (ENUM, JSON, DATETIME)
- Error code translation

**Storage Layer (Durable Object SQLite)**
- Microsecond access latency
- Transactional operations
- Automatic sharding by tenant

## API Reference

### Factory Functions

| Function | Description |
|----------|-------------|
| `createConnection(config)` | Create a single database connection |
| `createPool(config)` | Create a connection pool |

### Connection Methods

| Method | Description |
|--------|-------------|
| `query(sql, values?)` | Execute a query, return `[rows, fields]` |
| `execute(sql, values?)` | Execute prepared statement, return `[rows, fields]` |
| `beginTransaction()` | Start a transaction |
| `commit()` | Commit the transaction |
| `rollback()` | Rollback the transaction |
| `prepare(sql)` | Prepare a statement |
| `unprepare(sql)` | Unprepare a statement |
| `ping()` | Ping the connection |
| `end()` | Close the connection gracefully |
| `destroy()` | Close the connection immediately |
| `escape(value)` | Escape a value for SQL |
| `escapeId(value)` | Escape an identifier |
| `format(sql, values)` | Format a query with values |

### Pool Methods

| Method | Description |
|--------|-------------|
| `query(sql, values?)` | Execute query using pooled connection |
| `execute(sql, values?)` | Execute prepared statement |
| `getConnection()` | Get a connection from the pool |
| `end()` | Close all pool connections |

### PoolConnection Methods

| Method | Description |
|--------|-------------|
| `release()` | Return connection to pool |
| (inherits Connection methods) | |

### Result Types

| Type | Description |
|------|-------------|
| `RowDataPacket[]` | Array of row objects from SELECT |
| `ResultSetHeader` | Result from INSERT/UPDATE/DELETE |
| `FieldPacket[]` | Column metadata |

### ResultSetHeader Fields

| Field | Description |
|-------|-------------|
| `affectedRows` | Number of rows affected |
| `changedRows` | Number of rows changed (UPDATE) |
| `insertId` | Auto-generated insert ID |
| `fieldCount` | Number of fields |
| `serverStatus` | Server status flags |
| `warningCount` | Number of warnings |

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `host` | `string` | - | MySQL host |
| `port` | `number` | `3306` | MySQL port |
| `user` | `string` | - | MySQL user |
| `password` | `string` | - | MySQL password |
| `database` | `string` | - | Database name |
| `connectionLimit` | `number` | `10` | Max pool connections |
| `queueLimit` | `number` | `0` | Max queued requests |
| `waitForConnections` | `boolean` | `true` | Wait for available connection |
| `connectTimeout` | `number` | `30000` | Connection timeout (ms) |

## Durable Object Integration

### As an RPC Service

Keep your DO bundle small - offload database operations:

```toml
# wrangler.toml
[[services]]
binding = "MYSQL"
service = "mysql-do"
```

```typescript
// Heavy operations via RPC
const [rows] = await env.MYSQL.query('SELECT * FROM users')
```

### With dotdo Framework

```typescript
import { DO } from 'dotdo'
import mysql from '@dotdo/mysql'

class MyApp extends DO {
  db = mysql.createPool({
    database: 'myapp',
    doNamespace: this.ctx.storage,
  })

  async getUsers() {
    const [rows] = await this.db.query('SELECT * FROM users WHERE active = ?', [true])
    return rows
  }

  async createUser(name: string, email: string) {
    const [result] = await this.db.execute<mysql.ResultSetHeader>(
      'INSERT INTO users (name, email) VALUES (?, ?)',
      [name, email]
    )
    return result.insertId
  }
}
```

### Extended Configuration

Shard routing, replica configuration, jurisdiction constraints.

```typescript
import mysql from '@dotdo/mysql'
import type { ExtendedMySQLConfig } from '@dotdo/mysql'

const pool = mysql.createPool({
  database: 'myapp',

  // Shard by tenant for multi-tenancy
  shard: { key: 'tenant_id', count: 16, algorithm: 'consistent' },

  // Read from nearest replica
  replica: {
    readPreference: 'nearest',
    writeThrough: true,
    jurisdiction: 'eu',  // GDPR compliance
  },

  // Bind to DO namespace
  doNamespace: env.MYSQL_DO,
} as ExtendedMySQLConfig)
```

## Comparison

| Feature | @dotdo/mysql | mysql2 | PlanetScale |
|---------|--------------|--------|-------------|
| Edge Runtime | Yes | No | Limited |
| Connection Limits | None | Server limit | Plan limit |
| Cold Start | <5ms | N/A | ~50ms |
| Connection Pooling | Yes | Yes | Yes |
| Prepared Statements | Yes | Yes | Yes |
| Transactions | Yes | Yes | Yes |
| TypeScript | Yes | Yes | Yes |
| DO Integration | Yes | No | No |
| Sharding | Yes | No | Yes |
| Self-hosted | Yes | N/A | No |
| Global Distribution | 300+ cities | N/A | Limited |

## Performance

- **106 tests** covering all operations
- **<5ms** query execution (edge)
- **Microsecond** latency for cached queries
- **Zero cold starts** (Durable Objects)
- **Global distribution** (300+ Cloudflare locations)
- **No connection limits** (isolated per agent)

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

Errors are thrown as `MySQLError` with MySQL-compatible error codes.

```typescript
import { MySQLError, ConnectionError } from '@dotdo/mysql'

try {
  await connection.query('SELECT * FROM nonexistent')
} catch (e) {
  if (e instanceof MySQLError) {
    console.log(e.code)    // 'ER_NO_SUCH_TABLE'
    console.log(e.errno)   // 1146
    console.log(e.message) // Error message
  }
}
```

### Error Codes

| Code | Errno | Description |
|------|-------|-------------|
| `ER_NO_SUCH_TABLE` | 1146 | Table not found |
| `ER_TABLE_EXISTS_ERROR` | 1050 | Table already exists |
| `ER_DUP_ENTRY` | 1062 | Duplicate key violation |
| `ER_PARSE_ERROR` | 1064 | SQL syntax error |
| `ECONNREFUSED` | 1045 | Connection error |

## Related

- [fsx.do](https://fsx.do) - Filesystem on SQLite
- [gitx.do](https://gitx.do) - Git on R2
- [bashx.do](https://bashx.do) - Shell without VMs
- [workers.do](https://workers.do) - Durable Object primitives
- [mysql2](https://sidorares.github.io/node-mysql2/docs) - Original mysql2 package

## License

MIT
