# @dotdo/do

THE Durable Object for Digital Objects.

**DO** = **D**urable **O**bject = **D**igital **O**bject

## Built-in Entities

- Nouns, Verbs, Things, Actions, Relationships
- Events, Functions, Workflows
- Integrations, Connections
- Orgs, Users, API Keys
- Analytics

## $ Context

```typescript
// Event handlers
$.on.Customer.signup(async (event) => {
  await $.send({ type: 'welcome-email', to: event.email })
})

// Scheduling
$.every.Monday.at('9am')(async () => {
  await generateWeeklyReport()
})

// Cross-DO RPC - call methods on other DOs
await $.Order('order-123').ship()
const balance = await $.Customer('user-456').getBalance()
await $.Worker('processor-1').run('batch-process', { size: 100 })
```

### Cross-DO RPC

Call methods on other Durable Objects via type-safe RPC:

```typescript
// In your DO class
export class MyDO extends DO {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env)
    this.$ = createContext(state, env)
  }

  async handleOrder(orderId: string) {
    // Call remote DO methods
    const customer = await $.Customer('user-123').get()
    const inventory = await $.Inventory('sku-456').check()

    if (inventory.available > 0) {
      await $.Order(orderId).confirm()
      await $.Customer('user-123').notify({ message: 'Order confirmed!' })
    }
  }
}
```

**Features:**
- Type-safe method calls with TypeScript inference
- Automatic stub caching (same ID = same stub instance)
- Works seamlessly with `$.do()` for retries
- Error propagation with stack traces
- Concurrent calls to multiple DOs

**Requirements:**
- DO bindings must be configured in `wrangler.toml`
- Method calls use fetch-based RPC under the hood
- All methods must return serializable values (JSON)

---

# Unified Database Abstraction

## Overview

A unified database layer providing a consistent `DBClient` interface across multiple storage backends, all running inside Cloudflare Durable Objects with 2MB blob optimization.

## Package Architecture

```
dotdo/                    # This repo
├── core/                 # @dotdo/core - Base types, DBClient interface
├── do/                   # @dotdo/do - THE Durable Object
└── db/                   # @dotdo/db - Abstract storage primitives

db4/                      # ~/projects/db4
└── @dotdo/db4            # Pure TypeScript columnar store

evodb/                    # ~/projects/evodb
└── @dotdo/evodb          # Columnar shredding, JSON→columns

pglite/                   # ~/projects/pglite (or pocs)
└── @dotdo/postgres       # PGlite WASM PostgreSQL

sqljs/                    # ~/projects/sqljs (or pocs)
└── @dotdo/sqlite         # sql.js WASM SQLite

mongodb/                  # ~/projects/mongodb
└── @dotdo/mongo          # MongoDB compatibility (on postgres)
```

## Core Interface (`@dotdo/core`)

The `DBClient` interface is the unified API all backends implement:

```typescript
// @dotdo/core/src/db-client.ts

/**
 * Thing - A node in the database (linked data style)
 */
export interface Thing<T extends Record<string, unknown> = Record<string, unknown>> {
  /** Namespace (e.g., 'example.com') */
  ns: string
  /** Entity type (e.g., 'User', 'Post') */
  type: string
  /** Unique identifier within namespace and type */
  id: string
  /** Full URL for the entity */
  url: string
  /** When created */
  createdAt: Date
  /** When last updated */
  updatedAt: Date
  /** Entity data */
  data: T
}

/**
 * Relationship - An edge between two Things
 */
export interface Relationship<T = Record<string, unknown>> {
  id: string
  type: string       // e.g., 'author', 'tags', 'likes'
  from: string       // Source Thing URL
  to: string         // Target Thing URL
  createdAt: Date
  data?: T           // Optional edge data
}

/**
 * Query options for filtering and pagination
 */
export interface QueryOptions {
  ns?: string
  type?: string
  where?: Record<string, unknown>
  orderBy?: string
  order?: 'asc' | 'desc'
  limit?: number
  offset?: number
}

/**
 * DBClient - The unified database interface
 *
 * All storage backends implement this interface.
 */
export interface DBClient<T extends Record<string, unknown> = Record<string, unknown>> {
  // === CRUD Operations ===

  /** Get a Thing by URL */
  get(url: string): Promise<Thing<T> | null>

  /** Get a Thing by namespace/type/id */
  getById(ns: string, type: string, id: string): Promise<Thing<T> | null>

  /** Create a new Thing */
  create(options: {
    ns: string
    type: string
    id?: string        // Auto-generated if not provided
    data: T
  }): Promise<Thing<T>>

  /** Update an existing Thing */
  update(url: string, data: Partial<T>): Promise<Thing<T>>

  /** Create or update a Thing */
  upsert(options: {
    ns: string
    type: string
    id: string
    data: T
  }): Promise<Thing<T>>

  /** Delete a Thing */
  delete(url: string): Promise<boolean>

  // === Query Operations ===

  /** List Things with optional filtering */
  list(options?: QueryOptions): Promise<Thing<T>[]>

  /** Find Things matching criteria */
  find(options: QueryOptions): Promise<Thing<T>[]>

  /** Search Things (text/semantic) */
  search(options: {
    query: string
    fields?: string[]
    limit?: number
  }): Promise<Thing<T>[]>

  /** Count Things matching criteria */
  count(options?: QueryOptions): Promise<number>

  // === Relationship Operations ===

  /** Create a relationship between two Things */
  relate(options: {
    type: string
    from: string
    to: string
    data?: Record<string, unknown>
  }): Promise<Relationship>

  /** Remove a relationship */
  unrelate(from: string, type: string, to: string): Promise<boolean>

  /** Get related Things (outbound) */
  related(url: string, relationshipType?: string): Promise<Thing<T>[]>

  /** Get referencing Things (inbound/backlinks) */
  references(url: string, relationshipType?: string): Promise<Thing<T>[]>

  /** Get relationships for a Thing */
  relationships(
    url: string,
    type?: string,
    direction?: 'from' | 'to' | 'both'
  ): Promise<Relationship[]>

  // === Batch Operations ===

  /** Get multiple Things by URL */
  batchGet(urls: string[]): Promise<Map<string, Thing<T> | null>>

  /** Create multiple Things */
  batchCreate(items: Array<{
    ns: string
    type: string
    id?: string
    data: T
  }>): Promise<Thing<T>[]>

  // === Lifecycle ===

  /** Close connection/cleanup */
  close?(): Promise<void>
}
```

## Backend Implementations

### @dotdo/db4 (Pure TypeScript)

```typescript
import { DBClient, Thing } from '@dotdo/core'
import { VortexStore } from './vortex'  // Columnar storage

export function createDB4Client(storage: DurableObjectStorage): DBClient {
  const store = new VortexStore(storage)

  return {
    async get(url) {
      return store.get(url)
    },

    async create({ ns, type, id, data }) {
      const thing = {
        ns, type,
        id: id ?? crypto.randomUUID(),
        url: `https://${ns}/${type}/${id}`,
        createdAt: new Date(),
        updatedAt: new Date(),
        data,
      }
      await store.put(thing)
      return thing
    },

    async find(options) {
      // Columnar scan with predicate pushdown
      return store.scan(options)
    },

    async related(url, type) {
      // Multi-query for relationships (no JOINs)
      const rels = await store.getRelationships(url, type, 'from')
      return Promise.all(rels.map(r => store.get(r.to)))
    },

    // ... rest of implementation
  }
}
```

**Characteristics:**
- No WASM, pure TypeScript
- Columnar storage (Vortex blocks)
- 2MB blob optimization built-in
- No JOINs - uses multi-query for relations
- Best for: Document workloads, simple queries

### @dotdo/postgres (PGlite WASM)

```typescript
import { DBClient, Thing, QueryOptions } from '@dotdo/core'
import { PGlite } from '@electric-sql/pglite'

export function createPostgresClient(storage: DurableObjectStorage): DBClient {
  let db: PGlite

  return {
    async get(url) {
      if (!db) db = await initPGlite(storage)
      const result = await db.query(
        'SELECT * FROM things WHERE url = $1',
        [url]
      )
      return result.rows[0] ?? null
    },

    async find(options) {
      if (!db) db = await initPGlite(storage)
      const { sql, params } = buildQuery(options)
      const result = await db.query(sql, params)
      return result.rows
    },

    async related(url, type) {
      if (!db) db = await initPGlite(storage)
      // Real JOIN!
      const result = await db.query(`
        SELECT t.* FROM things t
        JOIN relationships r ON r.to_url = t.url
        WHERE r.from_url = $1 AND r.type = $2
      `, [url, type])
      return result.rows
    },

    // ... rest of implementation
  }
}
```

**Characteristics:**
- Full PostgreSQL via WASM
- 13-14 MB bundle (lazy-load)
- Real JOINs, CTEs, window functions
- 2MB blob VFS for page storage
- Best for: Complex queries, analytics, full SQL

### @dotdo/sqlite (sql.js WASM)

```typescript
import { DBClient } from '@dotdo/core'
import initSqlJs, { Database } from 'sql.js'

export function createSQLiteClient(storage: DurableObjectStorage): DBClient {
  let db: Database

  return {
    async get(url) {
      if (!db) db = await initSQLite(storage)
      const stmt = db.prepare('SELECT * FROM things WHERE url = ?')
      stmt.bind([url])
      if (stmt.step()) {
        return rowToThing(stmt.getAsObject())
      }
      return null
    },

    // Similar to postgres but with SQLite syntax
    // ...
  }
}
```

**Characteristics:**
- SQLite via WASM
- 4.4 MB bundle (smaller than postgres)
- Most SQL features (no window functions pre-3.25)
- 2MB blob VFS for page storage
- Best for: Moderate SQL needs, smaller bundle

### @dotdo/mongo (MongoDB Compatibility)

```typescript
import { DBClient } from '@dotdo/core'
import { createPostgresClient } from '@dotdo/postgres'

/**
 * MongoDB-compatible interface on top of PostgreSQL
 * Uses JSONB for document storage
 */
export function createMongoClient(storage: DurableObjectStorage): MongoClient {
  const pg = createPostgresClient(storage)

  return {
    collection(name: string) {
      return {
        async findOne(filter: object) {
          // Translate MongoDB filter to SQL
          const sql = `SELECT data FROM ${name} WHERE data @> $1::jsonb LIMIT 1`
          const result = await pg.query(sql, [JSON.stringify(filter)])
          return result.rows[0]?.data ?? null
        },

        async find(filter: object) {
          const sql = `SELECT data FROM ${name} WHERE data @> $1::jsonb`
          const result = await pg.query(sql, [JSON.stringify(filter)])
          return result.rows.map(r => r.data)
        },

        async insertOne(doc: object) {
          const sql = `INSERT INTO ${name} (data) VALUES ($1::jsonb) RETURNING *`
          const result = await pg.query(sql, [JSON.stringify(doc)])
          return { insertedId: result.rows[0].id }
        },

        async aggregate(pipeline: object[]) {
          // Translate aggregation pipeline to SQL
          const sql = translatePipeline(pipeline)
          return pg.query(sql)
        },

        // ... rest of MongoDB API
      }
    }
  }
}
```

**Characteristics:**
- MongoDB API on PostgreSQL JSONB
- Same bundle as @dotdo/postgres
- Aggregation pipeline → SQL translation
- Best for: MongoDB compatibility, migration path

### @dotdo/evodb (Columnar Shredding)

```typescript
import { DBClient } from '@dotdo/core'

export function createEvoDBClient(storage: DurableObjectStorage): DBClient {
  // Similar to db4 but with column-per-field shredding
  // Each JSON field stored in separate column for analytics

  return {
    async create({ ns, type, id, data }) {
      // Shred JSON into columns
      const columns = shredDocument(data)
      // Write each column as separate blob
      await Promise.all(
        Object.entries(columns).map(([col, values]) =>
          storage.put(`${type}:${col}`, values)
        )
      )
      // ...
    },

    async find(options) {
      // Only read columns needed for query
      const neededColumns = extractColumns(options.where)
      // Columnar scan with predicate pushdown
      // ...
    },
  }
}
```

**Characteristics:**
- Column-per-field storage
- Excellent for analytics (column pruning)
- 2MB blob optimization
- No JOINs - columnar reconstruction
- Best for: Analytics on JSON, column-oriented queries

## Schema Integration (icetype)

Use icetype for schema definition, generate DDL per backend:

```typescript
import { parseSchema } from 'icetype'
import { generateDDL } from '@dotdo/core'

const UserSchema = parseSchema({
  $type: 'User',
  $index: [['email'], ['createdAt']],

  id: 'uuid!',
  email: 'string#',      // # = indexed
  name: 'string',
  age: 'int?',           // ? = optional
  posts: '<- Post.author[]',  // backward relation
})

// Generate DDL for SQL backends
const postgresDDL = generateDDL(UserSchema, 'postgres')
// CREATE TABLE users (
//   id UUID PRIMARY KEY,
//   email TEXT NOT NULL,
//   name TEXT NOT NULL,
//   age INTEGER,
//   created_at TIMESTAMPTZ DEFAULT NOW(),
//   updated_at TIMESTAMPTZ DEFAULT NOW()
// );
// CREATE INDEX idx_users_email ON users(email);
// CREATE INDEX idx_users_created_at ON users(created_at);

const sqliteDDL = generateDDL(UserSchema, 'sqlite')
// Similar but SQLite syntax

// db4/evodb don't need DDL - schema is runtime metadata
const db4Meta = generateMeta(UserSchema, 'db4')
```

## DO Integration

The DO class uses the unified interface:

```typescript
// @dotdo/do/src/DO.ts
import { DBClient } from '@dotdo/core'
import { createDB4Client } from '@dotdo/db4'
import { createPostgresClient } from '@dotdo/postgres'
import { createSQLiteClient } from '@dotdo/sqlite'

export type DatabaseBackend = 'db4' | 'postgres' | 'sqlite' | 'evodb' | 'mongo'

export class DO {
  private db: DBClient

  constructor(
    state: DurableObjectState,
    env: Env,
    options: { backend?: DatabaseBackend } = {}
  ) {
    const backend = options.backend ?? env.DB_BACKEND ?? 'db4'

    switch (backend) {
      case 'db4':
        this.db = createDB4Client(state.storage)
        break
      case 'postgres':
        this.db = createPostgresClient(state.storage)
        break
      case 'sqlite':
        this.db = createSQLiteClient(state.storage)
        break
      case 'evodb':
        this.db = createEvoDBClient(state.storage)
        break
      case 'mongo':
        this.db = createMongoClient(state.storage)
        break
    }
  }

  // Expose unified interface
  get things() { return this.db }

  // Built-in entity accessors use the same interface
  get users() { return this.typedClient<User>('User') }
  get posts() { return this.typedClient<Post>('Post') }

  private typedClient<T>(type: string): TypedDBClient<T> {
    return {
      get: (id) => this.db.getById(this.ns, type, id),
      create: (data) => this.db.create({ ns: this.ns, type, data }),
      list: (opts) => this.db.find({ ...opts, type }),
      // ...
    }
  }
}
```

## Comparison Matrix

| Feature | db4 | evodb | postgres | sqlite | mongo |
|---------|-----|-------|----------|--------|-------|
| **Bundle Size** | 0 (pure TS) | 0 (pure TS) | 13-14 MB | 4.4 MB | 13-14 MB |
| **Cold Start** | ~0ms | ~0ms | ~500ms | ~200ms | ~500ms |
| **JOINs** | Multi-query | Multi-query | Native | Native | $lookup |
| **SQL** | No | No | Full | Full | No |
| **Aggregations** | Manual | Columnar | SQL | SQL | Pipeline |
| **Transactions** | ? | ? | ACID | ACID | Limited |
| **Best For** | Documents | Analytics | Complex SQL | Simple SQL | MongoDB compat |

## Cost Model (2MB Blob Optimization)

All backends use 2MB blob packing for DO SQLite storage:

```
Cloudflare Pricing:
- Rows read:    $0.001 / 1M rows
- Rows written: $1.00 / 1M rows

With 2MB blobs (packing ~2000 rows per blob):
- 1M logical rows = 500 blob reads = $0.0000005
- Effective 2000x cost reduction vs row-per-row
```

## Migration Path

```typescript
// Start with db4 (simplest, no WASM)
const do1 = new DO(state, env, { backend: 'db4' })

// Need SQL? Switch to sqlite
const do2 = new DO(state, env, { backend: 'sqlite' })

// Need full PostgreSQL? Upgrade
const do3 = new DO(state, env, { backend: 'postgres' })

// Same interface, different backend
await do1.things.create({ ns: 'app', type: 'User', data: { name: 'Alice' } })
await do2.things.create({ ns: 'app', type: 'User', data: { name: 'Alice' } })
await do3.things.create({ ns: 'app', type: 'User', data: { name: 'Alice' } })
```

## Status

See beads issues for implementation progress.
