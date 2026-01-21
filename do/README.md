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

## Type Hierarchies (Polymorphic Collections)

Collections can have sub-types that share a common base. Query the collection to get all, or query a specific sub-type.

### Example: Functions Collection

```typescript
// Base type shared by all function sub-types
interface FunctionBase {
  id: string
  name: string
  description?: string
  input: JSONSchema        // Input schema
  output: JSONSchema       // Output schema
  config?: Record<string, unknown>
}

// Sub-types extend the base
interface CodeFunction extends FunctionBase {
  $type: 'CodeFunction'
  runtime: 'js' | 'ts' | 'python' | 'wasm'
  code: string
  dependencies?: string[]
}

interface GenerativeFunction extends FunctionBase {
  $type: 'GenerativeFunction'
  model: string            // e.g., 'claude-3-opus', 'gpt-4'
  prompt: string           // System prompt template
  temperature?: number
  maxTokens?: number
}

interface AgenticFunction extends FunctionBase {
  $type: 'AgenticFunction'
  agent: string            // Agent ID or URL
  tools: string[]          // Available tools
  maxSteps?: number
}

interface HumanFunction extends FunctionBase {
  $type: 'HumanFunction'
  assignee?: string        // User/role to assign
  form?: FormSchema        // UI form definition
  timeout?: number         // Human task timeout
}

// Union type for the collection
type Function = CodeFunction | GenerativeFunction | AgenticFunction | HumanFunction
```

### Schema Definition

```typescript
// Using icetype with $extends for inheritance
const FunctionBase = parseSchema({
  $type: 'Function',
  $abstract: true,          // Can't instantiate directly

  id: 'uuid!',
  name: 'string!',
  description: 'string?',
  input: 'json!',
  output: 'json!',
  config: 'json?',
})

const CodeFunction = parseSchema({
  $type: 'CodeFunction',
  $extends: 'Function',     // Inherits base fields

  runtime: 'string!',
  code: 'text!',
  dependencies: 'string[]?',
})

const GenerativeFunction = parseSchema({
  $type: 'GenerativeFunction',
  $extends: 'Function',

  model: 'string!',
  prompt: 'text!',
  temperature: 'float?',
  maxTokens: 'int?',
})

// ... AgenticFunction, HumanFunction similarly
```

### Querying Polymorphic Collections

```typescript
// Get all functions (any sub-type)
const allFunctions = await db.find({ type: 'Function' })

// Get only code functions
const codeFunctions = await db.find({ type: 'CodeFunction' })

// Get functions by base field (works across sub-types)
const namedFunctions = await db.find({
  type: 'Function',
  where: { name: { $contains: 'process' } }
})

// Type-safe access with discriminated unions
for (const fn of allFunctions) {
  switch (fn.data.$type) {
    case 'CodeFunction':
      console.log(`Code: ${fn.data.runtime}`)
      break
    case 'GenerativeFunction':
      console.log(`AI: ${fn.data.model}`)
      break
    case 'AgenticFunction':
      console.log(`Agent: ${fn.data.agent}`)
      break
    case 'HumanFunction':
      console.log(`Human: ${fn.data.assignee}`)
      break
  }
}
```

### SQL Implementation (postgres/sqlite)

```sql
-- Single table with discriminator column
CREATE TABLE functions (
  id UUID PRIMARY KEY,
  type TEXT NOT NULL,        -- Discriminator: 'CodeFunction', 'GenerativeFunction', etc.
  name TEXT NOT NULL,
  description TEXT,
  input JSONB NOT NULL,
  output JSONB NOT NULL,
  config JSONB,

  -- Sub-type specific fields (nullable, only used by relevant type)
  runtime TEXT,              -- CodeFunction
  code TEXT,                 -- CodeFunction
  dependencies JSONB,        -- CodeFunction

  model TEXT,                -- GenerativeFunction
  prompt TEXT,               -- GenerativeFunction
  temperature REAL,          -- GenerativeFunction
  max_tokens INTEGER,        -- GenerativeFunction

  agent TEXT,                -- AgenticFunction
  tools JSONB,               -- AgenticFunction
  max_steps INTEGER,         -- AgenticFunction

  assignee TEXT,             -- HumanFunction
  form JSONB,                -- HumanFunction
  timeout INTEGER,           -- HumanFunction

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index on discriminator for fast sub-type queries
CREATE INDEX idx_functions_type ON functions(type);
```

### Document Implementation (db4/evodb)

```typescript
// Document store: $type field is the discriminator
// All sub-types stored in same collection, filtered by $type

await db.create({
  ns: 'app',
  type: 'Function',  // Collection name
  data: {
    $type: 'CodeFunction',  // Discriminator in data
    name: 'processOrder',
    runtime: 'ts',
    code: 'export default async (order) => { ... }',
    input: { type: 'object', properties: { orderId: { type: 'string' } } },
    output: { type: 'object', properties: { success: { type: 'boolean' } } },
  }
})
```

---

## Actions & Events Model

A shared pattern for durable execution (Actions) and immutable history (Events).

### Actions (Durable Execution)

Actions represent work being done - they have state that changes over time.

```typescript
interface Action<TInput = unknown, TOutput = unknown, TConfig = unknown> {
  // Identity
  id: string
  type: string                 // e.g., 'Function.invoke', 'Order.process'

  // What triggered this
  trigger: {
    type: 'manual' | 'scheduled' | 'event' | 'webhook' | 'rpc'
    source: string             // User ID, cron expression, event ID, etc.
  }

  // The work
  target: string               // Thing URL being acted upon
  input: TInput
  config?: TConfig

  // Execution state
  status: ActionStatus
  output?: TOutput
  error?: {
    code: string
    message: string
    stack?: string
  }

  // Timing
  createdAt: Date
  startedAt?: Date
  completedAt?: Date

  // Retries
  attempts: number
  maxAttempts: number
  nextRetryAt?: Date

  // Correlation
  correlationId?: string       // Group related actions
  causationId?: string         // Action that caused this one
  parentId?: string            // Parent action (for sub-tasks)
}

type ActionStatus =
  | 'pending'      // Queued, not started
  | 'running'      // Currently executing
  | 'completed'    // Finished successfully
  | 'failed'       // Finished with error
  | 'cancelled'    // Manually cancelled
  | 'timeout'      // Exceeded time limit
  | 'retrying'     // Failed, will retry
```

### Events (Immutable Log)

Events are facts that happened - they never change.

```typescript
interface Event<TData = unknown> {
  // Identity
  id: string
  type: string                 // e.g., 'Function.invoked', 'Order.created'

  // What happened
  subject: string              // Thing URL this event is about
  data: TData                  // Event-specific payload

  // Context
  actor: string                // Who/what caused this (user, system, action)
  source: string               // Where it came from (service, DO, etc.)

  // Timing
  timestamp: Date              // When it happened (immutable)

  // Correlation
  correlationId?: string       // Group related events
  causationId?: string         // Event/Action that caused this
  actionId?: string            // Action this event is part of
}
```

### Relationship: Actions → Events

```
┌─────────────────────────────────────────────────────────────────┐
│                         Action Lifecycle                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Action.created ──→ Action.started ──→ Action.completed         │
│       │                   │                   │                  │
│       ▼                   ▼                   ▼                  │
│   ┌───────┐          ┌───────┐          ┌───────┐               │
│   │ Event │          │ Event │          │ Event │               │
│   │.queued│          │.running│         │.success│              │
│   └───────┘          └───────┘          └───────┘               │
│                                                                  │
│  On failure:                                                     │
│                                                                  │
│  Action.failed ──→ Action.retrying ──→ Action.started           │
│       │                   │                                      │
│       ▼                   ▼                                      │
│   ┌───────┐          ┌───────┐                                  │
│   │ Event │          │ Event │                                  │
│   │.error │          │.retry │                                  │
│   └───────┘          └───────┘                                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### DBClient Extensions for Actions & Events

```typescript
interface DBClientWithActions extends DBClient {
  // === Actions ===

  /** Create a new action (queued for execution) */
  createAction<TInput, TConfig>(options: {
    type: string
    target: string
    input: TInput
    config?: TConfig
    trigger?: Action['trigger']
    correlationId?: string
    parentId?: string
  }): Promise<Action<TInput>>

  /** Get action by ID */
  getAction(id: string): Promise<Action | null>

  /** Update action status */
  updateAction(id: string, update: {
    status?: ActionStatus
    output?: unknown
    error?: Action['error']
    startedAt?: Date
    completedAt?: Date
  }): Promise<Action>

  /** Find actions */
  findActions(options: {
    type?: string
    target?: string
    status?: ActionStatus | ActionStatus[]
    correlationId?: string
    after?: Date
    before?: Date
    limit?: number
  }): Promise<Action[]>

  /** Get pending actions (for workers) */
  claimActions(options: {
    type?: string
    limit?: number
    lockDuration?: number  // ms
  }): Promise<Action[]>

  // === Events ===

  /** Emit an event (append-only) */
  emit<TData>(options: {
    type: string
    subject: string
    data: TData
    actor?: string
    correlationId?: string
    causationId?: string
    actionId?: string
  }): Promise<Event<TData>>

  /** Get event by ID */
  getEvent(id: string): Promise<Event | null>

  /** Query events */
  queryEvents(options: {
    type?: string
    subject?: string
    actor?: string
    correlationId?: string
    after?: Date
    before?: Date
    limit?: number
    order?: 'asc' | 'desc'  // Default: desc (newest first)
  }): Promise<Event[]>

  /** Stream events (for real-time) */
  subscribeEvents(options: {
    type?: string
    subject?: string
  }): AsyncIterable<Event>
}
```

### Example: Function Invocation

```typescript
// 1. Create action to invoke a function
const action = await db.createAction({
  type: 'Function.invoke',
  target: 'https://app.do/Function/processOrder',
  input: { orderId: 'order-123' },
  config: { timeout: 30000 },
  trigger: { type: 'rpc', source: 'user-456' },
})

// 2. Event emitted automatically
// { type: 'Function.invoke.queued', subject: 'Function/processOrder', actionId: action.id }

// 3. Worker claims and executes
const [claimed] = await db.claimActions({ type: 'Function.invoke', limit: 1 })

await db.updateAction(claimed.id, { status: 'running', startedAt: new Date() })
// Event: { type: 'Function.invoke.started', ... }

try {
  const fn = await db.get(claimed.target)
  const result = await executeFunction(fn, claimed.input)

  await db.updateAction(claimed.id, {
    status: 'completed',
    output: result,
    completedAt: new Date(),
  })
  // Event: { type: 'Function.invoke.completed', data: { output: result } }

} catch (error) {
  await db.updateAction(claimed.id, {
    status: 'failed',
    error: { code: 'EXECUTION_ERROR', message: error.message },
    completedAt: new Date(),
  })
  // Event: { type: 'Function.invoke.failed', data: { error: ... } }
}
```

### Event Sourcing Pattern

Events can reconstruct state:

```typescript
// Get all events for an order
const events = await db.queryEvents({
  subject: 'https://app.do/Order/order-123',
  order: 'asc',  // Oldest first for replay
})

// Replay to get current state
let orderState = {}
for (const event of events) {
  switch (event.type) {
    case 'Order.created':
      orderState = { ...event.data, status: 'pending' }
      break
    case 'Order.paid':
      orderState = { ...orderState, status: 'paid', paidAt: event.timestamp }
      break
    case 'Order.shipped':
      orderState = { ...orderState, status: 'shipped', trackingNumber: event.data.trackingNumber }
      break
    case 'Order.delivered':
      orderState = { ...orderState, status: 'delivered', deliveredAt: event.timestamp }
      break
  }
}
```

---

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

---

# BusinessDO - Business-as-Code DO

The `BusinessDO` extends `DO` with full business analytics, financial tracking, and experimentation capabilities.

## Class Hierarchy

```
DO (base)
│
├── BusinessDO extends DO
│   ├── Analytics (ClickHouse WASM for queries, DO SQLite for hot data)
│   ├── SaaS Metrics (MRR, ARR, NRR, GRR, CAC, LTV, Churn)
│   ├── OKRs & Goals (with AI-guided optimization)
│   ├── Experiments & Feature Flags
│   ├── Financial Ledger (Stripe + optional TigerBeetle)
│   └── Contains:
│       ├── Products (Things with per-product analytics)
│       └── Services (Things with per-service analytics)
```

## BusinessDO Implementation

```typescript
// @dotdo/do/src/BusinessDO.ts
import { DO } from './DO'
import { AnalyticsClient, createClickHouseClient } from '@dotdo/clickhouse'
import { FinancialClient, createStripeClient } from '@dotdo/finance'
import { calculateMRR, calculateChurnMetrics, calculateLTVMetric } from 'business-as-code'

export interface BusinessConfig {
  // Database backend
  backend?: 'db4' | 'sqlite' | 'postgres'

  // Analytics (ClickHouse WASM for complex queries)
  analytics?: {
    enabled: boolean
    clickhouse?: { profile: 'minimal' | 'standard' | 'full' }
  }

  // Financial integration
  finance?: {
    provider: 'stripe'
    stripeSecretKey?: string
    // Optional: TigerBeetle for double-entry accounting
    ledger?: 'stripe' | 'tigerbeetle'
  }

  // Experiments
  experiments?: {
    enabled: boolean
    autoAssign?: boolean
  }
}

export class BusinessDO extends DO {
  // Analytics client (lazy-loaded ClickHouse WASM)
  private _analytics?: AnalyticsClient

  // Financial client (Stripe by default)
  private _finance?: FinancialClient

  constructor(
    state: DurableObjectState,
    env: Env,
    config: BusinessConfig = {}
  ) {
    super(state, env, { backend: config.backend ?? 'db4' })
    this.config = config

    // Set up event handlers for metrics
    this.setupMetricsHandlers()
  }

  // ==========================================================================
  // Analytics
  // ==========================================================================

  /** Analytics client - lazy loads ClickHouse WASM when first accessed */
  get analytics(): AnalyticsClient {
    if (!this._analytics) {
      this._analytics = createClickHouseClient(this.state.storage, {
        profile: this.config.analytics?.clickhouse?.profile ?? 'standard'
      })
    }
    return this._analytics
  }

  /** Track an analytics event */
  async track(event: AnalyticsEventInput): Promise<void> {
    await this.analytics.track(event)
  }

  /** Track page view with privacy-safe visitor ID */
  async pageview(input: PageViewInput): Promise<void> {
    await this.analytics.pageview(input)
  }

  /** Execute analytics SQL query (uses ClickHouse WASM) */
  async query<T>(sql: string, params?: unknown[]): Promise<T[]> {
    return this.analytics.query<T>(sql, params)
  }

  // ==========================================================================
  // SaaS Metrics
  // ==========================================================================

  /** Calculate all SaaS metrics for a period */
  async calculateMetrics(period: MetricPeriod): Promise<SaaSMetrics> {
    // Get subscription events
    const subscriptions = await this.events.query({
      type: 'Subscription.*',
      since: period.start.getTime(),
      until: period.end.getTime()
    })

    // Get customer events
    const customers = await this.events.query({
      type: 'Customer.*',
      since: period.start.getTime()
    })

    const mrr = calculateMRR({
      newMRR: sumByType(subscriptions, 'Subscription.created'),
      expansionMRR: sumByType(subscriptions, 'Subscription.upgraded'),
      contractionMRR: sumByType(subscriptions, 'Subscription.downgraded'),
      churnedMRR: sumByType(subscriptions, 'Subscription.cancelled'),
      previousMRR: await this.getPreviousMRR(period),
      period
    })

    const churn = calculateChurnMetrics({ /* ... */ })
    const ltv = calculateLTVMetric({ /* ... */ })

    // Emit metrics for OKR tracking
    await this.emitMetrics({ mrr, churn, ltv })

    return { mrr, churn, ltv, /* ... */ }
  }

  /** Get current MRR */
  async getMRR(): Promise<number> {
    const subscriptions = await this.things.list({ type: 'Subscription', where: { status: 'active' } })
    return subscriptions.reduce((sum, s) => sum + (s.data.mrr ?? 0), 0)
  }

  // ==========================================================================
  // Products & Services (with analytics)
  // ==========================================================================

  /** Products collection - Things with per-product analytics */
  get products() {
    return {
      ...this.typedClient<Product>('Product'),

      /** Get product analytics */
      analytics: async (productId: string, period: DateRange) => {
        return this.analytics.query(`
          SELECT
            date_trunc('day', timestamp) as day,
            count(*) as events,
            count(distinct visitor_id) as unique_users,
            sum(case when type = 'Product.purchased' then 1 else 0 end) as purchases,
            sum(case when type = 'Product.purchased' then value else 0 end) as revenue
          FROM events
          WHERE product_id = {productId:String}
            AND timestamp BETWEEN {start:DateTime} AND {end:DateTime}
          GROUP BY day
          ORDER BY day
        `, { productId, start: period.start, end: period.end })
      },

      /** Get product funnel */
      funnel: async (productId: string, steps: FunnelStep[], period: DateRange) => {
        return this.analytics.funnel(
          steps.map(s => ({ ...s, filter: { product_id: productId } })),
          period
        )
      }
    }
  }

  /** Services collection - Things with per-service analytics */
  get services() {
    return {
      ...this.typedClient<Service>('Service'),

      /** Get service analytics (usage, latency, errors) */
      analytics: async (serviceId: string, period: DateRange) => {
        return this.analytics.query(`
          SELECT
            date_trunc('hour', timestamp) as hour,
            count(*) as requests,
            avg(duration_ms) as avg_latency,
            quantile(0.95)(duration_ms) as p95_latency,
            sum(case when status >= 400 then 1 else 0 end) as errors,
            sum(case when status >= 400 then 1 else 0 end) / count(*) as error_rate
          FROM service_events
          WHERE service_id = {serviceId:String}
            AND timestamp BETWEEN {start:DateTime} AND {end:DateTime}
          GROUP BY hour
          ORDER BY hour
        `, { serviceId, start: period.start, end: period.end })
      }
    }
  }

  // ==========================================================================
  // Financial System
  // ==========================================================================

  /** Financial client - Stripe by default */
  get finance(): FinancialClient {
    if (!this._finance) {
      this._finance = createStripeClient(this.env.STRIPE_SECRET_KEY)
    }
    return this._finance
  }

  /** Create a customer */
  async createCustomer(input: CustomerInput): Promise<Customer> {
    // Create in Stripe
    const stripeCustomer = await this.finance.customers.create(input)

    // Store locally
    const customer = await this.things.create({
      type: 'Customer',
      data: {
        ...input,
        stripeId: stripeCustomer.id,
        createdAt: new Date()
      }
    })

    await this.events.emit({ type: 'Customer.created', payload: customer })
    return customer
  }

  /** Create a subscription */
  async createSubscription(customerId: string, priceId: string): Promise<Subscription> {
    const customer = await this.things.get({ type: 'Customer', id: customerId })
    if (!customer?.data.stripeId) throw new Error('Customer has no Stripe ID')

    // Create in Stripe
    const stripeSub = await this.finance.subscriptions.create({
      customer: customer.data.stripeId,
      items: [{ price: priceId }]
    })

    // Store locally with MRR
    const subscription = await this.things.create({
      type: 'Subscription',
      data: {
        customerId,
        stripeId: stripeSub.id,
        status: stripeSub.status,
        mrr: stripeSub.items.data[0].price.unit_amount / 100,
        currentPeriodStart: new Date(stripeSub.current_period_start * 1000),
        currentPeriodEnd: new Date(stripeSub.current_period_end * 1000)
      }
    })

    await this.events.emit({ type: 'Subscription.created', payload: subscription })
    return subscription
  }

  /** Process Stripe webhook */
  async handleStripeWebhook(request: Request): Promise<Response> {
    const sig = request.headers.get('stripe-signature')
    const body = await request.text()

    const event = await this.finance.webhooks.constructEvent(
      body, sig, this.env.STRIPE_WEBHOOK_SECRET
    )

    switch (event.type) {
      case 'invoice.paid':
        await this.recordPayment(event.data.object)
        break
      case 'customer.subscription.updated':
        await this.syncSubscription(event.data.object)
        break
      case 'customer.subscription.deleted':
        await this.handleChurn(event.data.object)
        break
    }

    return new Response('ok')
  }

  // ==========================================================================
  // Experiments & Feature Flags
  // ==========================================================================

  /** Get variant for user in experiment */
  async getVariant(userId: string, experimentKey: string): Promise<Variant | null> {
    return this.analytics.getVariant(userId, experimentKey)
  }

  /** Evaluate feature flag */
  async flag(userId: string, flagKey: string): Promise<boolean | string | number> {
    return this.analytics.flag(userId, flagKey)
  }

  /** Record experiment exposure */
  async recordExposure(userId: string, experimentKey: string, variant: string): Promise<void> {
    await this.analytics.exposure(userId, experimentKey, variant)
  }

  /** Get experiment results */
  async getExperimentResults(experimentKey: string): Promise<ExperimentResults> {
    return this.analytics.experimentResults(experimentKey)
  }

  // ==========================================================================
  // OKRs & Goals
  // ==========================================================================

  /** OKRs collection */
  get okrs() {
    return {
      ...this.typedClient<OKR>('OKR'),

      /** Get OKR health dashboard */
      health: async () => {
        const okrs = await this.things.list({ type: 'OKR', where: { status: 'in-progress' } })
        return {
          onTrack: okrs.filter(o => o.data.confidence >= 70).length,
          atRisk: okrs.filter(o => o.data.confidence < 70 && o.data.confidence >= 40).length,
          offTrack: okrs.filter(o => o.data.confidence < 40).length,
          overallConfidence: average(okrs.map(o => o.data.confidence))
        }
      },

      /** AI-powered recommendations for at-risk OKRs */
      recommendations: async (okrId: string) => {
        const okr = await this.things.get({ type: 'OKR', id: okrId })
        const atRiskKRs = okr.data.keyResults.filter(kr => kr.progress < kr.expected)

        // Use AI to generate recommendations
        return ai`
          Given OKR "${okr.data.objective}" with these at-risk key results:
          ${JSON.stringify(atRiskKRs)}

          And recent experiment results:
          ${await this.getRecentExperimentWins()}

          Suggest 3 experiments that could improve these metrics.
        `
      }
    }
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private setupMetricsHandlers(): void {
    // Auto-update OKRs when metrics change
    this.$.on.Metric.updated(async (event) => {
      const { metricKey, value } = event.payload
      await this.updateOKRsFromMetric(metricKey, value)
    })

    // Track subscription lifecycle
    this.$.on.Subscription.created(async (event) => {
      await this.track({ name: 'subscription_started', value: event.payload.mrr })
    })

    this.$.on.Subscription.cancelled(async (event) => {
      await this.track({ name: 'subscription_churned', value: event.payload.mrr })
    })
  }
}
```

## Product and Service Entities

```typescript
// Built-in entity types for BusinessDO

interface Product {
  $type: 'Product'

  // Core
  name: string
  description?: string
  sku?: string

  // Pricing
  prices: Price[]

  // Analytics (auto-populated)
  totalRevenue?: number
  totalSales?: number
  conversionRate?: number

  // Relationships
  services?: string[]  // Service IDs this product includes
}

interface Service {
  $type: 'Service'

  // Core
  name: string
  description?: string
  endpoint?: string

  // Usage tracking
  requestCount?: number
  avgLatency?: number
  errorRate?: number

  // Relationships
  products?: string[]  // Products that include this service
}

interface Price {
  $type: 'Price'

  amount: number
  currency: string
  interval?: 'month' | 'year' | 'one_time'
  stripeId?: string
}
```

## Analytics Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         BusinessDO                               │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐   ┌─────────────┐   ┌─────────────┐           │
│  │  DO SQLite  │   │ ClickHouse  │   │    R2       │           │
│  │  (Hot Data) │   │   WASM      │   │  (Archive)  │           │
│  │  ─────────  │   │  ─────────  │   │  ─────────  │           │
│  │  Events     │ → │  Analytics  │ → │  MergeTree  │           │
│  │  Counters   │   │  Queries    │   │  Parts      │           │
│  │  Sessions   │   │  Funnels    │   │  (Cold)     │           │
│  └─────────────┘   └─────────────┘   └─────────────┘           │
│         │                 │                 │                   │
│         └─────────────────┼─────────────────┘                   │
│                           ▼                                     │
│                   ┌─────────────┐                               │
│                   │  Dashboard  │                               │
│                   │  API        │                               │
│                   └─────────────┘                               │
└─────────────────────────────────────────────────────────────────┘

Data Flow:
1. Events → DO SQLite (hot, immediate)
2. DO SQLite → ClickHouse WASM (queries on warm data)
3. Old data → R2 MergeTree parts (archived, cold queries)
```

## Financial Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         BusinessDO                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Payments (Stripe as Source of Truth)                           │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Stripe API → Webhooks → BusinessDO.handleStripeWebhook │   │
│  │                              │                           │   │
│  │                              ▼                           │   │
│  │                    ┌─────────────────┐                   │   │
│  │                    │ Local State     │                   │   │
│  │                    │ - Customers     │                   │   │
│  │                    │ - Subscriptions │                   │   │
│  │                    │ - Invoices      │                   │   │
│  │                    └─────────────────┘                   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
│  Optional: TigerBeetle (Double-Entry Accounting)                │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  For businesses needing full GL:                         │   │
│  │  - Chart of Accounts                                     │   │
│  │  - Journal Entries                                       │   │
│  │  - Trial Balance                                         │   │
│  │  - Financial Statements                                  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Usage Example

```typescript
// Create a business
const business = env.BUSINESS_DO.get(env.BUSINESS_DO.idFromName('acme-corp'))

// Create a product with analytics tracking
const product = await business.products.create({
  name: 'Pro Plan',
  prices: [{ amount: 99, currency: 'USD', interval: 'month' }]
})

// Get product analytics
const analytics = await business.products.analytics(product.id, {
  start: thirtyDaysAgo,
  end: now
})

// Create a customer and subscription
const customer = await business.createCustomer({
  email: 'alice@example.com',
  name: 'Alice'
})

const subscription = await business.createSubscription(customer.id, 'price_xxx')

// Check metrics
const metrics = await business.calculateMetrics(thisMonth)
console.log(`MRR: $${metrics.mrr.total}`)
console.log(`Churn: ${metrics.churn.customerChurnRate}%`)

// Run an experiment
const variant = await business.getVariant(customer.id, 'pricing-experiment')
if (variant?.key === 'discounted') {
  // Show discounted pricing
}

// Check OKR health
const okrHealth = await business.okrs.health()
if (okrHealth.atRisk > 0) {
  const recommendations = await business.okrs.recommendations(atRiskOkrId)
}
```

## Package Structure

```
@dotdo/do          - Base DO class (existing)
@dotdo/core        - Types and interfaces (existing)
@dotdo/clickhouse  - ClickHouse WASM client (NEW)
@dotdo/finance     - Financial abstraction (NEW)
@dotdo/business    - BusinessDO class (NEW)
```
