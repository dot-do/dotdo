# SQLite Transaction Limitations in Cloudflare Durable Objects

This document describes the limitations of SQLite transactions in the Cloudflare Durable Objects context and the workarounds implemented in `@dotdo/db`.

## Executive Summary

SQLite transactions in Durable Objects have significant limitations that differ from traditional SQLite usage. The key constraints are:

1. **No explicit `BEGIN`/`COMMIT`/`ROLLBACK` statements** - These are blocked by the runtime
2. **Two transaction APIs exist**: `transactionSync()` (synchronous) and `transaction()` (async, largely obsolete)
3. **Automatic atomicity** - Consecutive writes without `await` are automatically atomic
4. **Single-threaded execution** - `blockConcurrencyWhile()` serializes all request processing

## Cloudflare's Transaction Model

### Automatic Atomicity (Preferred Approach)

Cloudflare's Durable Objects runtime provides **implicit transaction behavior**. Any series of write operations with no intervening `await` statements are automatically submitted atomically - either all operations persist or none do.

```typescript
// These operations are automatically atomic (no await between them)
sql.exec('INSERT INTO users (name) VALUES (?)', 'Alice')
sql.exec('INSERT INTO users (name) VALUES (?)', 'Bob')
sql.exec('INSERT INTO users (name) VALUES (?)', 'Charlie')
// All three inserts succeed or fail together
```

### Explicit Transaction APIs

Cloudflare provides two transaction methods:

#### `transactionSync(callback)` - Synchronous Transactions

```typescript
// Wraps synchronous operations in a transaction
const result = state.storage.transactionSync(() => {
  sql.exec('INSERT INTO accounts (id, balance) VALUES (?, ?)', 'acc-1', 100)
  sql.exec('INSERT INTO accounts (id, balance) VALUES (?, ?)', 'acc-2', 200)
  return 'success'
})
```

**Requirements:**
- Callback must be synchronous (no `await` inside)
- Only works with SQL operations
- Automatically rolls back on exception

#### `transaction(closureFunction)` - Async Transactions (Largely Obsolete)

```typescript
// Async transaction wrapper
await state.storage.transaction(async (txn) => {
  await txn.put('key1', 'value1')
  await txn.put('key2', 'value2')
})
```

**Note:** This is largely obsolete. The automatic atomicity of consecutive writes without `await` makes explicit async transactions unnecessary in most cases.

## Critical Limitations

### 1. Blocked SQL Transaction Statements

The following SQL statements are **explicitly blocked** by the Cloudflare runtime:

```sql
-- All of these will throw an error
BEGIN TRANSACTION
BEGIN
COMMIT
ROLLBACK
SAVEPOINT
RELEASE SAVEPOINT
ROLLBACK TO SAVEPOINT
```

**Error:** `sql.exec() cannot execute transaction-related statements like 'BEGIN TRANSACTION' or 'SAVEPOINT'`

### 2. No Nested Transactions

SQLite savepoints (used for nested transactions) are blocked. There is no workaround for true nested transaction support.

### 3. No Cross-await Atomicity (without explicit API)

Operations separated by `await` are NOT automatically atomic:

```typescript
// DANGER: These are NOT atomic
const user = await sql.prepare('SELECT * FROM users WHERE id = ?').bind(id).first()
await delay(100) // Some async operation
await sql.exec('UPDATE users SET name = ? WHERE id = ?', 'NewName', id)
// If the DO crashes between SELECT and UPDATE, state is inconsistent
```

### 4. Single DO Instance Serialization

Cloudflare guarantees that only one request handler runs at a time within a single DO instance. However, the DO can hibernate between operations, and upon wake, any in-flight transaction state is lost.

## Current Implementation in @dotdo/db

### SQLiteAdapter.transaction()

The `SQLiteAdapter` class in `db/sqlite.ts` implements a transaction method that uses explicit `BEGIN`/`COMMIT`/`ROLLBACK`:

```typescript
// From db/sqlite.ts - SQLiteAdapter.transaction()
async transaction<T>(fn: () => Promise<T>): Promise<T> {
  this.sql.exec('BEGIN')
  try {
    const result = await fn()
    this.sql.exec('COMMIT')
    return result
  } catch (error) {
    this.sql.exec('ROLLBACK')
    throw error
  }
}
```

**WARNING:** This implementation uses blocked statements. While it works in Miniflare (local testing), it will fail in production Cloudflare Workers because `BEGIN`, `COMMIT`, and `ROLLBACK` are blocked by the runtime.

### Recommended Migration

Replace `BEGIN`/`COMMIT`/`ROLLBACK` with `transactionSync()`:

```typescript
async transaction<T>(fn: () => T): Promise<T> {
  // Note: fn must be synchronous for transactionSync
  return this.state.storage.transactionSync(fn)
}
```

Or leverage automatic atomicity by avoiding `await` within critical sections:

```typescript
async bulkCreate(items: Item[]): Promise<Item[]> {
  const created: Item[] = []

  // All these sql.exec calls are automatically atomic
  // because there's no await between them
  for (const item of items) {
    const id = generateId()
    sql.exec('INSERT INTO items (id, data) VALUES (?, ?)', id, JSON.stringify(item))
    created.push({ $id: id, ...item })
  }

  return created
}
```

## Concurrency Control: blockConcurrencyWhile()

### Purpose

`blockConcurrencyWhile()` ensures that no other request handlers execute during critical initialization or state modification:

```typescript
constructor(state: DurableObjectState, env: Env) {
  super(state, env)

  state.blockConcurrencyWhile(async () => {
    // Initialize schema - no other requests will run until this completes
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS things (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL
      )
    `)
  })
}
```

### How It Works

1. **Input Gate Blocking**: Prevents new requests from being processed
2. **Serialization**: Ensures the callback runs to completion before any other code
3. **Alarm Deferral**: Alarms scheduled during `blockConcurrencyWhile` are delayed

### Limitations

- Does NOT provide database-level transaction isolation
- Only provides concurrency control within a single DO instance
- The callback can be async, but this doesn't extend transaction boundaries
- Memory state changes are NOT rolled back if an error occurs

### Using blockConcurrencyWhile for Atomic Operations

```typescript
// Pattern: Use blockConcurrencyWhile for read-modify-write operations
async incrementCounter(id: string): Promise<number> {
  return await this.ctx.blockConcurrencyWhile(async () => {
    const row = await sql.prepare('SELECT value FROM counters WHERE id = ?').bind(id).first()
    const newValue = (row?.value ?? 0) + 1
    sql.exec('UPDATE counters SET value = ? WHERE id = ?', newValue, id)
    return newValue
  })
}
```

## Transaction Isolation Between Event Handlers

A significant gap exists in the current architecture: **event handlers that run via `Promise.all` have no transaction isolation**.

### The Problem

```typescript
// Event handlers run concurrently via Promise.all
eventSystem.on.Counter.increment(async (event) => {
  const current = sharedState.counter  // Read
  await delay(10)                       // Async gap
  sharedState.counter = current + 1    // Write - may overwrite another handler's update
})
```

### Known Issues

1. **Lost Updates**: Concurrent handlers can overwrite each other's changes
2. **Dirty Reads**: Handlers can see intermediate/uncommitted state
3. **No Serialization**: Unlike DO requests, event handlers are NOT serialized

### Workaround

Use `blockConcurrencyWhile()` within handlers if they modify shared state:

```typescript
eventSystem.on.Counter.increment(async (event) => {
  await this.ctx.blockConcurrencyWhile(async () => {
    const current = sharedState.counter
    sharedState.counter = current + 1
  })
})
```

See `do/tests/transaction-isolation.test.ts` for detailed test cases demonstrating these issues.

## Bulk Operation Atomicity

### Current Status

Bulk operations (`bulkCreate`, `bulkUpdate`, `bulkDelete`) in `db/sqlite.ts` use explicit transactions wrapped with `BEGIN`/`COMMIT`/`ROLLBACK`. This works in Miniflare but will fail in production.

### Test Evidence

See `db/tests/bulk-atomicity.test.ts` which demonstrates:

1. **Non-atomic behavior**: Partial results exist after failure midway through bulk operation
2. **Database inconsistency**: Failed bulk operations leave partial data

### Fix Required

Replace explicit transaction statements with either:

1. `transactionSync()` (for synchronous bulk operations)
2. Remove `await` between SQL statements to leverage automatic atomicity

## Best Practices

### DO

1. **Use `transactionSync()` for critical operations** that must be atomic
2. **Avoid `await` within transaction boundaries** when using implicit atomicity
3. **Use `blockConcurrencyWhile()` for initialization** and state migrations
4. **Keep transactions short** to minimize lock duration
5. **Validate inputs before starting transactions** to fail fast

### DON'T

1. **Never use `BEGIN`/`COMMIT`/`ROLLBACK`** - These are blocked in production
2. **Don't rely on cross-await atomicity** without explicit transaction APIs
3. **Don't assume nested transaction support** - Savepoints are blocked
4. **Don't mix async operations with transaction logic** without careful consideration

## Error Handling

### TransactionError Class

The `@dotdo/db` package provides a `TransactionError` class for transaction-related failures:

```typescript
import { TransactionError, NestedTransactionError } from '@dotdo/db'

try {
  await store.bulkCreate(items)
} catch (error) {
  if (error instanceof TransactionError) {
    // Handle transaction failure
    console.error('Transaction failed:', error.message)
  }
}
```

### Error Types

- `TransactionError`: General transaction failure
- `NestedTransactionError`: Attempt to use nested transactions (not supported)
- `TransactionError.rollbackFailed()`: Rollback itself failed (critical)
- `TransactionError.nestedFailed()`: Savepoint operation failed

## Testing Considerations

### Miniflare vs Production

**Critical:** Miniflare (local testing) may not enforce all Cloudflare runtime restrictions. Code using `BEGIN`/`COMMIT`/`ROLLBACK` will pass in Miniflare but fail in production.

### Test Pattern

```typescript
// Use real Miniflare instances - no mocks
import { env } from 'cloudflare:test'

describe('Transaction Tests', () => {
  it('should handle bulk operations atomically', async () => {
    const stub = env.DO.get(env.DO.idFromName('test'))

    // Test via fetch - exercises real DO runtime
    const response = await stub.fetch('https://test/bulk-create', {
      method: 'POST',
      body: JSON.stringify({ items: [...] })
    })

    expect(response.status).toBe(200)
  })
})
```

## References

- [Cloudflare Durable Objects SQL Storage Documentation](https://developers.cloudflare.com/durable-objects/api/sql-storage/)
- [Cloudflare Durable Objects Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)
- [Miniflare Documentation](https://miniflare.dev/)
- Test files:
  - `db/tests/transactions.test.ts` - Transaction rollback and concurrent write tests
  - `db/tests/bulk-atomicity.test.ts` - Bulk operation atomicity tests
  - `do/tests/transaction-isolation.test.ts` - Event handler isolation tests
  - `do/tests/concurrency.test.ts` - Concurrent access tests

## Related Issues

- `do-6dc7` - Implement atomic bulk operations
- `do-5uai` - Bulk operation atomicity issues
- `do-6b5vx` - This documentation
