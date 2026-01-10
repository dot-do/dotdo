# @dotdo/postgres

PostgreSQL compatibility layer for Cloudflare Workers - a drop-in replacement for [pg (node-postgres)](https://node-postgres.com/) backed by Durable Objects with SQLite storage.

## Installation

```bash
npm install @dotdo/postgres
```

## Features

- **API-compatible with `pg`** - Drop-in replacement for node-postgres
- **Client and Pool classes** - Full connection management with events
- **Parameterized queries** - PostgreSQL-style `$1, $2, ...` placeholders
- **Transaction support** - `BEGIN`, `COMMIT`, `ROLLBACK`, savepoints
- **Connection pooling** - Configurable pool limits and timeouts
- **PostgreSQL error codes** - SQLSTATE codes for proper error handling
- **Extended DO routing** - Sharding, replication, and tiered storage

## Usage

### Basic Client

```typescript
import { Client } from '@dotdo/postgres'

const client = new Client({
  host: 'localhost',
  database: 'mydb',
  user: 'postgres',
  password: 'secret',
})

await client.connect()

// Simple query
const { rows } = await client.query('SELECT * FROM users')
console.log(rows)

// Parameterized query
const { rows: user } = await client.query(
  'SELECT * FROM users WHERE id = $1',
  [1]
)

// INSERT with RETURNING
const { rows: newUser } = await client.query(
  'INSERT INTO users (name, email) VALUES ($1, $2) RETURNING *',
  ['Alice', 'alice@example.com']
)

await client.end()
```

### Connection Pool

```typescript
import { Pool } from '@dotdo/postgres'

const pool = new Pool({
  connectionString: 'postgres://user:pass@localhost/mydb',
  max: 20,
  idleTimeoutMillis: 30000,
})

// Simple query (auto-checkout)
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

await pool.end()
```

### Query Configuration

```typescript
// Using QueryConfig object
const result = await client.query({
  text: 'SELECT * FROM users WHERE status = $1',
  values: ['active'],
  name: 'get-active-users', // Prepared statement name
})

// Callback style
client.query('SELECT * FROM users', (err, result) => {
  if (err) {
    console.error(err)
    return
  }
  console.log(result.rows)
})
```

### Event Handling

```typescript
const client = new Client()

client.on('connect', () => console.log('Connected'))
client.on('end', () => console.log('Disconnected'))
client.on('error', (err) => console.error('Error:', err))

const pool = new Pool()

pool.on('connect', (client) => console.log('Client connected'))
pool.on('acquire', (client) => console.log('Client acquired'))
pool.on('release', (err, client) => console.log('Client released'))
pool.on('remove', (client) => console.log('Client removed'))
```

### Error Handling

```typescript
import { Client, DatabaseError, ConnectionError } from '@dotdo/postgres'

try {
  await client.query('SELECT * FROM nonexistent_table')
} catch (e) {
  if (e instanceof DatabaseError) {
    console.log('SQLSTATE:', e.code)      // '42P01' for table not found
    console.log('Severity:', e.severity)   // 'ERROR'
    console.log('Message:', e.message)
  }
}
```

### Extended DO Configuration

```typescript
import { Pool, ExtendedPostgresConfig } from '@dotdo/postgres'

const pool = new Pool({
  host: 'localhost',
  database: 'mydb',

  // Shard across multiple Durable Objects
  shard: {
    algorithm: 'consistent',  // 'consistent' | 'range' | 'hash'
    count: 8,
    key: 'tenant_id',
  },

  // Read from replicas
  replica: {
    readPreference: 'nearest',  // 'primary' | 'secondary' | 'nearest'
    writeThrough: false,
    jurisdiction: 'eu',
  },

  // Tiered storage
  tier: {
    hot: 'sqlite',
    warm: 'r2',
    cold: 'archive',
    hotThreshold: '100MB',
    coldAfter: '30d',
  },
} as ExtendedPostgresConfig)
```

## Supported SQL Operations

### Data Definition (DDL)

```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)

CREATE TABLE IF NOT EXISTS posts (...)

DROP TABLE users
DROP TABLE IF EXISTS posts
```

### Data Manipulation (DML)

```sql
-- INSERT
INSERT INTO users (name, email) VALUES ($1, $2)
INSERT INTO users (name) VALUES ($1) RETURNING *
INSERT INTO users (name) VALUES ($1) RETURNING id, name

-- SELECT
SELECT * FROM users
SELECT name, email FROM users WHERE id = $1
SELECT * FROM users WHERE age > $1 AND status = $2
SELECT * FROM users WHERE name LIKE $1
SELECT * FROM users WHERE name ILIKE $1  -- Case-insensitive
SELECT * FROM users WHERE id IN (1, 2, 3)
SELECT * FROM users WHERE value IS NULL
SELECT * FROM users WHERE value IS NOT NULL
SELECT * FROM users ORDER BY created_at DESC
SELECT * FROM users LIMIT $1 OFFSET $2

-- UPDATE
UPDATE users SET name = $1 WHERE id = $2
UPDATE users SET name = $1, email = $2 WHERE id = $3 RETURNING *

-- DELETE
DELETE FROM users WHERE id = $1
DELETE FROM users WHERE id = $1 RETURNING *
```

### Transactions

```sql
BEGIN
START TRANSACTION
COMMIT
ROLLBACK
SAVEPOINT my_savepoint
RELEASE SAVEPOINT my_savepoint
```

## Type Constants

```typescript
import { types } from '@dotdo/postgres'

types.BOOL      // 16
types.INT2      // 21
types.INT4      // 23
types.INT8      // 20
types.FLOAT4    // 700
types.FLOAT8    // 701
types.TEXT      // 25
types.VARCHAR   // 1043
types.JSON      // 114
types.JSONB     // 3802
types.UUID      // 2950
types.DATE      // 1082
types.TIMESTAMP // 1114
types.BYTEA     // 17
```

## PostgreSQL Error Codes

| Code | Name | Description |
|------|------|-------------|
| `23505` | unique_violation | Unique constraint violation |
| `42P01` | undefined_table | Table does not exist |
| `42P07` | duplicate_table | Table already exists |
| `42601` | syntax_error | SQL syntax error |

## Utilities

```typescript
// Escape strings for SQL
client.escapeLiteral("it's a test")     // "'it''s a test'"
client.escapeIdentifier('column"name')  // '"column""name"'

// Native bindings (simulated)
import { native } from '@dotdo/postgres'
const { Client, Pool } = native()
```

## Comparison with node-postgres

| Feature | pg | @dotdo/postgres |
|---------|-----|-----------------|
| Client API | Yes | Yes |
| Pool API | Yes | Yes |
| Parameterized queries | Yes | Yes |
| Transactions | Yes | Yes |
| Connection events | Yes | Yes |
| COPY commands | Yes | No |
| Cursors | Yes | Partial |
| Pub/Sub (LISTEN/NOTIFY) | Yes | No |
| SSL/TLS | Yes | N/A (internal) |
| Native bindings | Yes | Simulated |

## License

MIT
