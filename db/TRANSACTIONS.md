# SQLite Transaction Limitations in Cloudflare Durable Objects

This document describes the limitations of SQLite transactions in the Cloudflare Durable Objects context and the workarounds implemented in `@dotdo/db`.

## Quick Reference

| Feature | Status | Workaround |
|---------|--------|------------|
| `BEGIN`/`COMMIT`/`ROLLBACK` | **BLOCKED** | Use `transactionSync()` or automatic atomicity |
| `SAVEPOINT`/`RELEASE` | **BLOCKED** | No nested transactions supported |
| Consecutive writes (no await) | **ATOMIC** | Preferred approach |
| `transactionSync(callback)` | **WORKS** | For explicit synchronous transactions |
| `transaction(callback)` async | **OBSOLETE** | Avoid; use consecutive writes instead |
| `blockConcurrencyWhile()` | **WORKS** | For concurrency control, NOT database transactions |

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

**Important:** This code **works in Miniflare** (local testing) but **fails in production**:

```typescript
// FAILS IN PRODUCTION - DO NOT USE
async function badTransaction() {
  sql.exec('BEGIN')              // Error in production!
  try {
    sql.exec('INSERT ...')
    sql.exec('INSERT ...')
    sql.exec('COMMIT')           // Never reached
  } catch (error) {
    sql.exec('ROLLBACK')         // Never reached
    throw error
  }
}
```

### 2. No Nested Transactions

SQLite savepoints (used for nested transactions) are blocked. There is no workaround for true nested transaction support.

```typescript
// IMPOSSIBLE IN CLOUDFLARE DO
function nestedTransaction() {
  sql.exec('SAVEPOINT sp1')        // Error!
  // ... nested operations ...
  sql.exec('RELEASE sp1')          // Error!
}
```

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

### 5. Miniflare vs Production Differences

**CRITICAL:** Miniflare does not enforce all Cloudflare runtime restrictions. Code that works locally may fail in production.

| Feature | Miniflare | Production |
|---------|-----------|------------|
| `BEGIN`/`COMMIT`/`ROLLBACK` | Works | **BLOCKED** |
| `SAVEPOINT` | Works | **BLOCKED** |
| Automatic atomicity | Works | Works |
| `transactionSync()` | Works | Works |

Always test with real Cloudflare Workers in staging before production deployment.

## What Works vs. What Doesn't

### WORKS: Automatic Atomicity (No Await Between Writes)

```typescript
// All these writes are automatically atomic
function createUserWithProfile(userId: string, userData: UserData) {
  // No await between these statements - they form an atomic batch
  sql.exec('INSERT INTO users (id, name) VALUES (?, ?)', userId, userData.name)
  sql.exec('INSERT INTO profiles (user_id, bio) VALUES (?, ?)', userId, userData.bio)
  sql.exec('INSERT INTO settings (user_id, theme) VALUES (?, ?)', userId, 'default')
  // Either all three inserts succeed or none do
}
```

### WORKS: transactionSync() for Explicit Transactions

```typescript
// Explicit synchronous transaction - fully supported
function transferFunds(fromId: string, toId: string, amount: number) {
  return state.storage.transactionSync(() => {
    // All operations inside are synchronous - no await allowed
    const from = sql.exec('SELECT balance FROM accounts WHERE id = ?', fromId).toArray()[0]
    const to = sql.exec('SELECT balance FROM accounts WHERE id = ?', toId).toArray()[0]

    if (from.balance < amount) {
      throw new Error('Insufficient funds') // Automatically rolls back
    }

    sql.exec('UPDATE accounts SET balance = balance - ? WHERE id = ?', amount, fromId)
    sql.exec('UPDATE accounts SET balance = balance + ? WHERE id = ?', amount, toId)

    return { success: true }
  })
}
```

### WORKS: blockConcurrencyWhile() for Read-Modify-Write

```typescript
// Use blockConcurrencyWhile to prevent concurrent requests from interleaving
async function incrementCounter(counterId: string) {
  return await ctx.blockConcurrencyWhile(async () => {
    // Read current value
    const result = sql.exec('SELECT value FROM counters WHERE id = ?', counterId)
    const current = result.toArray()[0]?.value ?? 0

    // Modify and write (no await between read and write makes this atomic)
    const newValue = current + 1
    sql.exec('UPDATE counters SET value = ? WHERE id = ?', newValue, counterId)

    return newValue
  })
}
```

### DOESN'T WORK: Explicit BEGIN/COMMIT/ROLLBACK

```typescript
// FAILS IN PRODUCTION
async function badApproach() {
  sql.exec('BEGIN')  // Error: blocked by runtime
  try {
    await doSomething()
    sql.exec('COMMIT')
  } catch {
    sql.exec('ROLLBACK')
  }
}
```

### DOESN'T WORK: Async Operations in transactionSync

```typescript
// INVALID - callback must be synchronous
state.storage.transactionSync(async () => {  // Wrong! No async allowed
  await fetchExternalData()  // Error!
  sql.exec('INSERT ...')
})
```

### DOESN'T WORK: Cross-Await Atomicity Without blockConcurrencyWhile

```typescript
// NOT ATOMIC - vulnerable to race conditions
async function riskyUpdate(id: string) {
  const item = await sql.prepare('SELECT * FROM items WHERE id = ?').bind(id).first()
  // Another request could modify the item here!
  await someAsyncOperation()
  // This update might overwrite changes from another request
  await sql.exec('UPDATE items SET value = ? WHERE id = ?', newValue, id)
}
```

### PATTERN: Combining blockConcurrencyWhile with Automatic Atomicity

```typescript
// Best practice: blockConcurrencyWhile for concurrency + automatic atomicity for database
async function complexOperation(orderId: string) {
  return await ctx.blockConcurrencyWhile(async () => {
    // 1. Read phase (can use await for queries)
    const order = await sql.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first()
    const items = await sql.prepare('SELECT * FROM order_items WHERE order_id = ?').bind(orderId).all()

    // 2. Validate
    if (order.status !== 'pending') {
      throw new Error('Order already processed')
    }

    // 3. Write phase - no await between writes for atomicity
    const now = Date.now()
    sql.exec('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', 'processing', now, orderId)
    for (const item of items.results) {
      sql.exec('UPDATE inventory SET quantity = quantity - ? WHERE product_id = ?', item.quantity, item.product_id)
    }
    sql.exec('INSERT INTO order_history (order_id, status, timestamp) VALUES (?, ?, ?)', orderId, 'processing', now)

    return { success: true }
  })
}
```

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

There are three approaches to migrate away from blocked `BEGIN`/`COMMIT`/`ROLLBACK`:

#### Approach 1: Use transactionSync() (Best for synchronous operations)

```typescript
// Before (BROKEN in production)
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

// After (WORKS in production)
transactionSync<T>(fn: () => T): T {
  // Note: fn must be synchronous - no await allowed inside
  return this.state.storage.transactionSync(fn)
}
```

#### Approach 2: Leverage Automatic Atomicity (Simplest)

```typescript
// Just avoid await between SQL statements
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

#### Approach 3: Use blockConcurrencyWhile() for Read-Modify-Write

```typescript
// For operations that need to read, then write based on the read value
async incrementAndGet(id: string): Promise<number> {
  return await this.ctx.blockConcurrencyWhile(async () => {
    // Read
    const row = sql.exec('SELECT value FROM counters WHERE id = ?', id).toArray()[0]
    const current = row?.value ?? 0

    // Modify-Write (no await - atomic)
    const newValue = current + 1
    sql.exec('UPDATE counters SET value = ? WHERE id = ?', newValue, id)

    return newValue
  })
}
```

### Decision Tree: Which Approach to Use?

```
Is your operation purely synchronous (no await needed)?
├── YES → Use transactionSync()
└── NO → Do you need read-modify-write?
    ├── YES → Use blockConcurrencyWhile() + automatic atomicity
    └── NO → Is it just multiple writes?
        ├── YES → Use automatic atomicity (no await between writes)
        └── NO → Redesign your operation
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
6. **Test in real Cloudflare Workers** not just Miniflare

### DON'T

1. **Never use `BEGIN`/`COMMIT`/`ROLLBACK`** - These are blocked in production
2. **Don't rely on cross-await atomicity** without explicit transaction APIs
3. **Don't assume nested transaction support** - Savepoints are blocked
4. **Don't mix async operations with transaction logic** without careful consideration
5. **Don't trust Miniflare for transaction behavior** - It's more permissive than production

## Common Pitfalls and Solutions

### Pitfall 1: Code Works Locally, Fails in Production

**Symptom:** `sql.exec() cannot execute transaction-related statements like 'BEGIN TRANSACTION'`

**Cause:** Using explicit SQL transaction statements that Miniflare allows but production blocks.

**Solution:** Replace with `transactionSync()` or automatic atomicity pattern.

### Pitfall 2: Race Conditions in Read-Modify-Write

**Symptom:** Counter increments get lost, inventory goes negative, duplicate records.

```typescript
// BUGGY - race condition
async increment(id: string) {
  const row = await sql.prepare('SELECT value FROM counters WHERE id = ?').bind(id).first()
  const newValue = row.value + 1
  // Another request can read the old value here!
  await sql.exec('UPDATE counters SET value = ? WHERE id = ?', newValue, id)
}
```

**Solution:** Wrap in `blockConcurrencyWhile()`:

```typescript
// FIXED - no race condition
async increment(id: string) {
  return await ctx.blockConcurrencyWhile(async () => {
    const row = sql.exec('SELECT value FROM counters WHERE id = ?', id).toArray()[0]
    const newValue = row.value + 1
    sql.exec('UPDATE counters SET value = ? WHERE id = ?', newValue, id)
    return newValue
  })
}
```

### Pitfall 3: Partial Bulk Operations

**Symptom:** After an error, some items were created but not all.

**Cause:** Bulk operations using await between database calls.

```typescript
// BUGGY - partial results on error
async bulkCreate(items: Item[]) {
  const results = []
  for (const item of items) {
    const result = await createItem(item)  // Await breaks atomicity!
    results.push(result)
  }
  return results
}
```

**Solution:** Remove await or use `transactionSync()`:

```typescript
// FIXED - all or nothing
async bulkCreate(items: Item[]) {
  return state.storage.transactionSync(() => {
    const results = []
    for (const item of items) {
      const id = generateId()
      sql.exec('INSERT INTO items (id, data) VALUES (?, ?)', id, JSON.stringify(item))
      results.push({ id, ...item })
    }
    return results
  })
}
```

### Pitfall 4: Async in transactionSync

**Symptom:** `await is not valid in this context` or unexpected behavior.

**Cause:** Trying to use async/await inside `transactionSync()`.

```typescript
// INVALID
state.storage.transactionSync(async () => {
  const data = await fetchExternal()  // Can't await in transactionSync!
  sql.exec('INSERT ...', data)
})
```

**Solution:** Fetch data before the transaction, or use a different pattern:

```typescript
// FIXED - fetch first, then transact
const data = await fetchExternal()  // Fetch outside transaction
state.storage.transactionSync(() => {
  sql.exec('INSERT ...', data)
})
```

### Pitfall 5: Confusing blockConcurrencyWhile with Database Transactions

**Symptom:** Data corruption despite using `blockConcurrencyWhile()`.

**Cause:** `blockConcurrencyWhile()` only prevents concurrent requests - it doesn't provide database transaction semantics like rollback.

```typescript
// WRONG ASSUMPTION
await ctx.blockConcurrencyWhile(async () => {
  sql.exec('INSERT INTO items ...', item1)
  await someFailingOperation()  // Error!
  sql.exec('INSERT INTO items ...', item2)
  // item1 was already inserted - no automatic rollback!
})
```

**Solution:** Combine with automatic atomicity (no await between SQL) or use `transactionSync()`:

```typescript
// FIXED - proper atomicity
await ctx.blockConcurrencyWhile(async () => {
  // Validate and prepare
  await validateItems([item1, item2])

  // Then write atomically (no await between)
  sql.exec('INSERT INTO items ...', item1)
  sql.exec('INSERT INTO items ...', item2)
})
```

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
