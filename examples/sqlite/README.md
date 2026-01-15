# sqlite.example.com.ai

> Direct SQLite access for Durable Objects

SQLite is simple. It scales to billions of rows. But it runs on one machine.

dotdo gives you SQLite **per Durable Object**, distributed globally. Same SQL you know. Zero infrastructure to manage.

## Quick Start

```typescript
export class MyDO extends DurableObject {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE,
        metadata JSON,
        created_at INTEGER DEFAULT (unixepoch())
      )
    `)
  }
}
```

That's it. SQLite at the edge.

## Raw SQL Access

Every Durable Object has `ctx.storage.sql`:

```typescript
// Insert
ctx.storage.sql.exec(
  `INSERT INTO customers (id, name, email) VALUES (?, ?, ?)`,
  'cust_001', 'Alice', 'alice@example.com'
)

// Query
const rows = ctx.storage.sql
  .exec(`SELECT * FROM customers WHERE name LIKE ?`, '%Ali%')
  .toArray()

// Update
ctx.storage.sql.exec(
  `UPDATE customers SET name = ? WHERE id = ?`,
  'Alice Smith', 'cust_001'
)

// Delete
ctx.storage.sql.exec(`DELETE FROM customers WHERE id = ?`, 'cust_001')
```

## Schema Migrations

```typescript
const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, name TEXT)`,
  `ALTER TABLE customers ADD COLUMN email TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_email ON customers(email)`,
]

function migrate(sql: SqlStorage) {
  sql.exec(`CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY)`)
  const result = sql.exec(`SELECT MAX(version) as v FROM _migrations`).toArray()
  const current = (result[0]?.v as number) ?? 0

  for (let i = current; i < MIGRATIONS.length; i++) {
    sql.exec(MIGRATIONS[i])
    sql.exec(`INSERT INTO _migrations (version) VALUES (?)`, i + 1)
  }
}
```

## Full-Text Search

SQLite FTS5 works out of the box:

```typescript
// Create FTS table
ctx.storage.sql.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(title, content)
`)

// Index a document
ctx.storage.sql.exec(
  `INSERT INTO docs_fts (rowid, title, content) VALUES (?, ?, ?)`,
  docId, doc.title, doc.content
)

// Search with ranking
const results = ctx.storage.sql.exec(`
  SELECT rowid, title, snippet(docs_fts, 1, '<b>', '</b>', '...', 32) as excerpt
  FROM docs_fts WHERE docs_fts MATCH ? ORDER BY rank LIMIT 10
`, 'sqlite AND edge').toArray()
```

## JSON Functions

```typescript
// Store JSON
ctx.storage.sql.exec(`
  INSERT INTO customers (id, name, metadata) VALUES (?, ?, json(?))
`, 'cust_001', 'Alice', JSON.stringify({ plan: 'pro', tags: ['vip'] }))

// Extract JSON fields
const vips = ctx.storage.sql.exec(`
  SELECT id, name, json_extract(metadata, '$.plan') as plan
  FROM customers WHERE json_extract(metadata, '$.tags') LIKE '%vip%'
`).toArray()

// JSON aggregation
const stats = ctx.storage.sql.exec(`
  SELECT json_extract(metadata, '$.plan') as plan, COUNT(*) as count
  FROM customers GROUP BY plan
`).toArray()
```

## Combining with Things

Use raw SQL alongside the Things abstraction:

```typescript
import { DO } from 'dotdo'

export class MyDO extends DO {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS analytics (
        event TEXT PRIMARY KEY,
        count INTEGER DEFAULT 0
      )
    `)
  }

  async createCustomer(data: CustomerInput) {
    const customer = await this.things.create({ $type: 'Customer', ...data })

    // Raw SQL for analytics
    this.ctx.storage.sql.exec(`
      INSERT INTO analytics (event, count) VALUES ('customer_created', 1)
      ON CONFLICT(event) DO UPDATE SET count = count + 1
    `)

    return customer
  }

  async getAnalytics() {
    return this.ctx.storage.sql
      .exec(`SELECT * FROM analytics ORDER BY count DESC`)
      .toArray()
  }
}
```

## Performance Tips

```typescript
// Parameterized queries (safe)
sql.exec(`SELECT * FROM users WHERE id = ?`, id)

// Batch inserts
sql.exec(`BEGIN TRANSACTION`)
for (const item of items) {
  sql.exec(`INSERT INTO items (id, data) VALUES (?, ?)`, item.id, item.data)
}
sql.exec(`COMMIT`)

// Create indexes
sql.exec(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`)

// Debug with EXPLAIN
const plan = sql.exec(`EXPLAIN QUERY PLAN SELECT * FROM users WHERE email = ?`, email)
```

## Promise Pipelining (Cap'n Web)

True Cap'n Proto-style pipelining: method calls on stubs batch until `await`, then resolve in a single round-trip.

```typescript
// ❌ Sequential - N round-trips
for (const row of rows) {
  await this.DB(name).insert('customers', row)
}

// ✅ Pipelined - fire and forget
rows.forEach(row => this.DB(name).insert('customers', row))

// ✅ Pipelined - batch then await once
const inserts = rows.map(row => this.DB(name).insert('customers', row))
await Promise.all(inserts)

// ✅ Single round-trip for the result you need
const count = await this.DB(name).table('customers').count()
```

`this.Noun(id)` returns a pipelined stub. Fire-and-forget is valid for side effects. Only `await` at exit points when you need the value.

## Limits

| Resource | Limit |
|----------|-------|
| Database size | 1 GB per DO |
| Row size | 2 MB |
| Columns per table | 100 |
| SQL statement | 1 MB |

## Next Steps

1. **Create your first table** - `CREATE TABLE IF NOT EXISTS`
2. **Add migrations** - Track schema versions
3. **Index your queries** - Use `EXPLAIN QUERY PLAN`
4. **Combine with Things** - SQL for what it does best

---

[dotdo.dev](https://dotdo.dev) | [GitHub](https://github.com/dot-do/dotdo)
