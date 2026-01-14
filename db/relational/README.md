# RelationalStore

> Typed relational storage with Drizzle ORM integration

## Overview

RelationalStore provides traditional SQL table storage with full Drizzle ORM support. This is the only store primitive that requires Drizzle as a peer dependency, enabling typed schemas, migrations, and complex joins.

## Features

- **Typed schemas** - Full TypeScript inference via Drizzle
- **Migrations** - Schema versioning and evolution
- **Joins** - Complex multi-table queries
- **Transactions** - ACID guarantees within DO
- **CDC integration** - Every mutation emits change events
- **Three-tier storage** - Hot/warm/cold automatic tiering

## Three-Tier Storage

```
┌─────────────────────────────────────────────────────────────────┐
│ HOT: DO SQLite                                                  │
│ • Active working set (recent writes, frequent reads)            │
│ • Full Drizzle schema with indexes                              │
│ • Columnar statistics for query optimization                    │
│ Access: <1ms                                                    │
├─────────────────────────────────────────────────────────────────┤
│ WARM: R2 Parquet                                                │
│ • Materialized views and aggregates                             │
│ • Partitioned by date ranges                                    │
│ • Pre-computed join results                                     │
│ Access: ~50ms                                                   │
├─────────────────────────────────────────────────────────────────┤
│ COLD: R2 Iceberg Archive                                        │
│ • Full table history with schema evolution                      │
│ • Cross-DO joins via R2 SQL                                     │
│ • Point-in-time recovery                                        │
│ Access: ~100ms                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## API

```typescript
import { RelationalStore } from 'dotdo/db/relational'
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

// Define schema with Drizzle
const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
})

const orders = sqliteTable('orders', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id),
  total: integer('total').notNull(),
  status: text('status').notNull(),
})

// Initialize store
const store = new RelationalStore(db, { users, orders })

// Insert
const user = await store.insert(users).values({
  id: 'user_123',
  email: 'alice@example.com',
  name: 'Alice',
  createdAt: new Date(),
}).returning()

// Query with joins
const ordersWithUser = await store
  .select()
  .from(orders)
  .leftJoin(users, eq(orders.userId, users.id))
  .where(eq(orders.status, 'pending'))

// Update
await store
  .update(users)
  .set({ name: 'Alice Smith' })
  .where(eq(users.id, 'user_123'))

// Delete
await store
  .delete(orders)
  .where(eq(orders.id, 'order_456'))

// Transaction
await store.transaction(async (tx) => {
  await tx.insert(orders).values({ ... })
  await tx.update(users).set({ ... })
})
```

## Migrations

```typescript
import { migrate } from 'dotdo/db/relational/migrate'

// Run migrations
await migrate(db, {
  migrationsFolder: './migrations',
})

// Or inline migration
await store.migrate({
  version: 2,
  up: async (db) => {
    await db.run(sql`ALTER TABLE users ADD COLUMN avatar_url TEXT`)
  },
  down: async (db) => {
    await db.run(sql`ALTER TABLE users DROP COLUMN avatar_url`)
  },
})
```

## Schema Evolution

RelationalStore supports schema evolution with compatibility modes:

```typescript
const evolution = new SchemaEvolution(db, {
  mode: 'BACKWARD',  // New schema can read old data
  // mode: 'FORWARD',   // Old schema can read new data
  // mode: 'FULL',      // Both directions
})

// Check compatibility before migration
const compatible = await evolution.checkCompatibility(newSchema)
if (!compatible.ok) {
  console.error(compatible.errors)
}
```

## CDC Events

Every mutation emits a `UnifiedEvent`:

```typescript
// On insert
{
  type: 'cdc.insert',
  op: 'c',
  store: 'relational',
  table: 'users',
  key: 'user_123',
  after: { id: 'user_123', email: 'alice@example.com', ... }
}

// On update
{
  type: 'cdc.update',
  op: 'u',
  store: 'relational',
  table: 'users',
  key: 'user_123',
  before: { name: 'Alice' },
  after: { name: 'Alice Smith' }
}
```

## Dependencies

| Package | Type | Notes |
|---------|------|-------|
| `drizzle-orm` | Peer dependency | Required for schema definition |

```json
{
  "peerDependencies": {
    "drizzle-orm": "^0.30.0"
  }
}
```

## When to Use

| Use RelationalStore | Use DocumentStore |
|---------------------|-------------------|
| Fixed schemas | Flexible schemas |
| Complex joins | Document-centric |
| Strong typing | Rapid prototyping |
| Migration support | Schema-free |

## Implementation Status

| Feature | Status |
|---------|--------|
| Drizzle integration | TBD |
| CRUD operations | TBD |
| Joins | TBD |
| Transactions | TBD |
| Migrations | TBD |
| CDC integration | TBD |
| Hot → Warm tiering | TBD |
| Schema evolution | TBD |
