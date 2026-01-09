# dotdo Architecture Overview

> **Build your 1-Person Unicorn.** Business-as-Code framework for autonomous businesses run by AI agents.

---

## 1. Core Philosophy

### V8 Isolates + Durable Objects = Virtual Chrome Tabs

dotdo treats each Durable Object as a **virtual Chrome tab** with persistent state. Just as Chrome isolates tabs for security and performance, V8 Isolates provide:

- **Memory isolation** - Each DO runs in its own V8 isolate
- **State persistence** - SQLite storage survives across requests
- **Concurrent execution** - Millions of DOs can run simultaneously
- **Actor model** - Single-threaded execution within each DO eliminates race conditions

```typescript
// Each DO is like a persistent browser tab
class MyStartup extends DO {
  // State lives in SQLite, survives restarts
  async fetch(request: Request) {
    const data = await this.db.select().from(things)
    return Response.json(data)
  }
}
```

### Edge-First Architecture

Cloudflare Workers + Durable Objects run on **300+ cities globally**:

- **0ms cold starts** (when warm) - V8 Isolates spin up in microseconds
- **~50ms cold starts** - When loading new isolate with SQLite state
- **Single-digit latency** - Code runs close to users
- **Automatic failover** - Cloudflare handles regional redundancy

### SQLite as Universal Storage Layer

Every DO has a built-in SQLite database via Drizzle ORM:

```typescript
// Initialize Drizzle with DO storage
this.db = drizzle(ctx.storage, { schema })

// Type-safe queries
const startups = await this.db
  .select()
  .from(things)
  .where(eq(things.type, startupFK))
```

SQLite provides:
- **ACID transactions** - Consistent state within each DO
- **JSON columns** - Flexible schema with `json_extract()` queries
- **Full-text search** - FTS5 for text search
- **Vector storage** - 128-dim MRL embeddings for semantic search

---

## 2. Package Structure

```
dotdo/
├── do/                    # Entry points (tiny, index, full)
│   ├── index.ts           # Default export (all capabilities)
│   ├── tiny.ts            # Minimal DO (~15KB)
│   ├── fs.ts              # DO + filesystem
│   ├── git.ts             # DO + filesystem + git
│   ├── bash.ts            # DO + filesystem + bash
│   └── full.ts            # DO + all capabilities (~120KB)
│
├── objects/               # DO classes
│   ├── DO.ts              # Base class (identity, storage, $)
│   ├── Worker.ts          # Execution context
│   ├── Entity.ts          # Data entity (Customer, Invoice)
│   ├── Agent.ts           # AI agent
│   ├── Human.ts           # Human actor
│   ├── Business.ts        # Business organization
│   ├── App.ts             # Application
│   ├── Site.ts            # Website/docs
│   ├── Collection.ts      # Entity collection
│   ├── Directory.ts       # Entity directory
│   └── lifecycle/         # Lifecycle modules
│       ├── Clone.ts       # DO cloning
│       ├── Branch.ts      # Git-style branching
│       ├── Compact.ts     # State compaction
│       ├── Promote.ts     # Entity -> DO promotion
│       └── Shard.ts       # Horizontal sharding
│
├── db/                    # Database layer
│   ├── index.ts           # Schema exports
│   ├── stores.ts          # Store accessors
│   ├── things.ts          # Things table (entities)
│   ├── relationships.ts   # Relationships table (edges)
│   ├── actions.ts         # Actions table (audit log)
│   ├── events.ts          # Events table (domain events)
│   ├── search.ts          # Search index (FTS + vector)
│   ├── branches.ts        # Git-style branches
│   ├── auth.ts            # Auth tables (better-auth)
│   ├── vault.ts           # Secure credential storage
│   └── compat/            # Database compatibility layers
│       ├── sql/           # postgres, mysql, planetscale
│       ├── nosql/         # mongo, dynamodb, firebase
│       ├── cache/         # redis
│       └── graph/         # neo4j
│
├── lib/                   # Utilities
│   └── mixins/            # Capability mixins
│       ├── fs.ts          # Filesystem (fsx)
│       ├── git.ts         # Git operations (gitx)
│       └── bash.ts        # Shell execution (bashx)
│
├── workflows/             # $ context DSL
│   ├── proxy.ts           # Pipeline proxy
│   ├── on.ts              # Event subscription DSL
│   ├── schedule-builder.ts # Cron scheduling
│   ├── runtime.ts         # Workflow runtime
│   └── context/           # Context extensions
│       ├── flag.ts        # Feature flags
│       ├── rate-limit.ts  # Rate limiting
│       └── vault.ts       # Secrets
│
├── api/                   # HTTP layer
│   └── routes/            # Hono routes
│
├── agents/                # Agent SDK
│   ├── Agent.ts           # Multi-provider agent
│   ├── Tool.ts            # Tool definitions
│   └── Providers/         # LLM providers
│
└── app/                   # Frontend
    └── components/        # TanStack Start + MDXUI
```

---

## 3. DO Class Hierarchy

```
DOTiny (~15KB)
│   Identity (ns)
│   SQLite (Drizzle)
│   fetch() handler
│
DO (~80KB)
│   + WorkflowContext ($)
│   + Stores (things, rels, actions, events, search)
│   + Event handlers ($.on.Noun.verb)
│   + Scheduling ($.every)
│   + Cross-DO RPC
│
DOFull (~120KB)
    + Filesystem ($.fs)
    + Git ($.git)
    + Bash ($.bash)
    + Lifecycle (clone, branch, compact, promote, shard)
```

### Entry Point Selection

```typescript
// Minimal - just identity and storage
import { DO } from 'dotdo/tiny'

// Standard - workflows, events, scheduling
import { DO } from 'dotdo'

// Full - all capabilities including fs, git, bash
import { DO } from 'dotdo/full'

// Selective - compose exactly what you need
import { DO as BaseDO } from 'dotdo/tiny'
import { withFs, withGit } from 'dotdo'

class MyDO extends withGit(withFs(BaseDO)) {
  // Has $.fs and $.git but not $.bash
}
```

---

## 4. Key Abstractions

### Things - Universal Entities

Every entity in dotdo is a **Thing** with URL-based identity:

```typescript
interface Thing {
  $id: string      // URL: 'https://startups.studio/headless.ly'
  $type: string    // URL: 'https://startups.studio/Startup'
  name?: string
  data?: Record<string, unknown>
  meta?: Record<string, unknown>
  visibility?: 'public' | 'unlisted' | 'org' | 'user'
  $version?: number
  createdAt: Date
  updatedAt: Date
}
```

**URL Identity:**
- `$id` is a fully qualified URL (unambiguous globally)
- `$type` points to a Noun definition (schema + behavior)
- Namespace (`ns`) is derived from the URL host

### Relationships - Typed Edges

Relationships connect Things with typed verbs:

```typescript
interface Relationship {
  id: string
  verb: string      // 'manages', 'employs', 'owns'
  from: string      // Thing $id
  to: string        // Thing $id
  data?: Record<string, unknown>
  createdAt: Date
}
```

### Actions - Recorded Operations

Every operation is logged in an append-only audit trail:

```typescript
interface Action {
  id: string
  verb: string           // 'create', 'update', 'approve'
  target: string         // Thing $id or namespace
  actor: string          // 'Human/nathan', 'Agent/claude'
  input: Record<string, unknown>
  output?: unknown
  durability: 'send' | 'try' | 'do'
  status: ActionStatus
  createdAt: Date
  completedAt?: Date
}

type ActionStatus = 'pending' | 'running' | 'retrying' | 'completed' | 'failed'
```

### Events - Domain Events

Domain events flow through the event system:

```typescript
interface DomainEvent {
  id: string
  verb: string           // 'signup', 'paid', 'shipped'
  source: string         // Thing $id that emitted
  data: unknown
  timestamp: Date
}
```

---

## 5. WorkflowContext ($)

The `$` proxy is the primary API for workflow operations:

### Execution Modes

```typescript
// Fire-and-forget (non-blocking, non-durable)
$.send('notify', { user, message })

// Single attempt with timeout (blocking, non-durable)
const result = await $.try('validate', data, { timeout: 5000 })

// Durable execution with retries (blocking, durable)
const output = await $.do('process', order, {
  retry: {
    maxAttempts: 3,
    initialDelayMs: 100,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    jitter: true
  }
})
```

### Event Subscription

```typescript
// Subscribe to domain events
$.on.Customer.created(async (event) => {
  await $.send('welcome-email', { customer: event.data })
})

$.on.Payment.failed(async (event) => {
  await $.do('retry-payment', event.data)
})

// With options
$.on.Order.shipped.with({
  priority: 'high',
  timeout: 30000
})(async (event) => {
  // Handle high-priority order shipments
})
```

### Scheduling

```typescript
// Fluent cron syntax
$.every.Monday.at9am(async () => {
  await $.do('weekly-report', {})
})

$.every.hour(async () => {
  await $.try('health-check', {})
})

// Natural language
$.every('daily at 6am', async () => {
  await $.do('backup', {})
})

// Interval shortcuts
$.every.minute(handler)    // '* * * * *'
$.every.day.atnoon(handler) // '0 12 * * *'
```

### Cross-DO RPC

```typescript
// Call methods on other DOs
await $.Customer(customerId).notify({ message: 'Hello!' })
await $.Order(orderId).ship()

// Chain operations
const invoice = await $.Customer(id).orders().latest().invoice()
```

### AI Functions

```typescript
// Generation
const content = await $.write`blog post about ${topic}`
const summary = await $.summarize(document)
const items = await $.list`10 marketing ideas for ${product}`
const data = await $.extract({ name: 'string', email: 'email' }).from(text)

// Classification
const spam = await $.is`spam`(message)
const category = await $.decide(['urgent', 'normal', 'low'])(ticket)
```

### Branching

```typescript
// Create a branch for experimentation
await $.branch('feature/new-pricing')

// Switch branches
await $.checkout('feature/new-pricing')

// Merge changes back
await $.merge('main')
```

---

## 6. Compat Layer Architecture

dotdo provides **API-compatible SDKs** for familiar database and service APIs:

### Available Compat Layers

| Category | SDKs |
|----------|------|
| SQL | `@dotdo/postgres`, `@dotdo/mysql`, `@dotdo/planetscale`, `@dotdo/neon`, `@dotdo/cockroach`, `@dotdo/tidb`, `@dotdo/duckdb` |
| NoSQL | `@dotdo/mongo`, `@dotdo/dynamodb`, `@dotdo/firebase`, `@dotdo/couchdb`, `@dotdo/convex` |
| Cache | `@dotdo/redis` |
| Graph | `@dotdo/neo4j` |
| BaaS | `@dotdo/supabase` |

### Compat Architecture

Each compat layer provides:

1. **Familiar API** - Same method signatures as the original SDK
2. **DO-backed storage** - Data stored in the DO's SQLite
3. **SQL parsing** - Queries translated via `node-sql-parser` or `pgsql-parser`
4. **Event emission** - Operations emit domain events

```typescript
// Using postgres compat layer
import { Client } from '@dotdo/postgres'

const client = new Client({ do: this })
await client.connect()

// Standard pg syntax, DO-backed storage
const result = await client.query(
  'SELECT * FROM users WHERE email = $1',
  ['user@example.com']
)
```

### Shared Infrastructure

Compat layers share:

- **EventEmitter** - Consolidated event emission
- **SQL Parser** - Query translation
- **Connection pooling simulation** - Managed by DO lifecycle
- **Type coercion** - SQLite <-> target DB type mapping

---

## 7. Bundle Optimization Strategy

### Lazy Loading

Heavy operations are lazy-loaded to minimize cold start impact:

```typescript
// Stores are initialized on first access
get things(): ThingsStore {
  if (!this._things) {
    this._things = new ThingsStore(this.getStoreContext())
  }
  return this._things
}

// Schedule manager loaded when scheduling is used
protected get scheduleManager(): ScheduleManager {
  if (!this._scheduleManager) {
    this._scheduleManager = new ScheduleManager(this.ctx)
  }
  return this._scheduleManager
}
```

### Mixin-Based Composition

Capabilities are added via mixins, not inheritance:

```typescript
// Each mixin adds specific capabilities
export const DO = withBash(withGit(withFs(BaseDO)))

// Users can compose exactly what they need
class MinimalDO extends BaseDO { }           // ~15KB
class FsDO extends withFs(BaseDO) { }        // ~40KB
class FullDO extends withBash(withGit(withFs(BaseDO))) { } // ~120KB
```

### Tree-Shakeable Exports

Entry points are structured for tree-shaking:

```typescript
// do/tiny.ts - Minimal exports
export { DO } from '../objects/DO'
export const capabilities: string[] = []

// do/full.ts - All capabilities
export const DO = withBash(withGit(withFs(BaseDO)))
export const capabilities = ['fs', 'git', 'bash']
export { withFs, withGit, withBash }
```

### RPC Workers for Heavy Operations

Heavy operations can be offloaded to separate Workers:

```typescript
// Lifecycle operations can be RPC'd to dedicated workers
const shardResult = await this.env.LIFECYCLE_WORKER.shard(this.ns, options)

// AI inference goes through API gateway
const response = await this.env.AI_GATEWAY.complete(prompt)
```

---

## Summary

dotdo's architecture enables building autonomous businesses by combining:

1. **V8 Isolates** - Secure, fast execution
2. **Durable Objects** - Persistent state with SQLite
3. **WorkflowContext ($)** - Intuitive API for events, scheduling, RPC
4. **Compat Layers** - Familiar APIs backed by DO storage
5. **Mixin Composition** - Pay only for capabilities you use

This creates a platform where AI agents and humans can collaborate on running businesses, with the framework handling durability, identity, and infrastructure concerns.
