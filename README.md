# do.md

> Core Durable Object framework for building distributed, AI-native applications on Cloudflare Workers.

## Overview

`do.md` provides a comprehensive base class hierarchy for Durable Objects that powers Platform.do, Agents.do, Humans.do, Workers.do, Workflows.do, Services.do, Functions.do, Database.do, and more.

The framework unifies:

- **Entity Management** - Things, Relationships, Actions, Events with Drizzle ORM
- **AI Integration** - Agents, Workers, Human-in-the-Loop patterns
- **Data Persistence** - SQLite via Drizzle, cross-DO relationships, R2 analytics
- **Event Streaming** - Cloudflare Pipelines integration for real-time data flows
- **Distributed Systems** - Sharding, replication, geographic colocation

## Key Design Decisions

### URL-Based Identity

All entities use fully qualified URLs for unambiguous identity:

```typescript
$id: 'https://startups.studio/headless.ly'    // Entity URL
$type: 'https://startups.studio/Startup'      // Type URL (Noun)
ns: 'https://startups.studio'                 // Namespace = DO identity
```

When `$id === ns`, the Thing IS a Durable Object.

### Append-Only Version Model

Things are versioned, not mutated. Time travel is free:

```
Things = version log (rowid IS the version ID)
Actions = who did what, referencing before/after rowids
Events = derived from actions, streamed to Pipelines
```

No `createdAt/updatedAt/createdBy` on Things - all derived from Actions.

### Action Durability Spectrum

```
$.send(event, data)    → Fire-and-forget (non-blocking, non-durable)
$.try(action, data)    → Quick attempt (blocking, non-durable)
$.do(action, data)     → Durable execution (blocking, retries, guaranteed event)
```

### Version & Branch Addressing

Git-like `@ref` syntax:

```
https://startups.studio/acme              → HEAD of main
https://startups.studio/acme@main         → explicit main branch
https://startups.studio/acme@experiment   → experiment branch
https://startups.studio/acme@v1234        → specific version (rowid)
https://startups.studio/acme@~1           → one version back
```

### Lifecycle Operations

```typescript
await do.fork({ to: 'https://new.ns' })   // New identity from current state
await do.compact()                         // Squash history, same identity
await do.moveTo('ORD')                     // Relocate to different colo
await do.branch('experiment')              // Create branch
await do.checkout('@v1234')                // Switch to version/branch
await do.merge('experiment')               // Merge branch
```

### Local vs Global Schema

| Layer | Identity | Optimization |
|-------|----------|--------------|
| In-DO SQLite | `type: rowid FK`, `id: 'acme'` | Integer FKs, efficient |
| R2 SQL | `type: 'https://...Startup'`, `id: 'https://...acme'` | Full URLs, cross-DO queryable |

### The $ Context

Unified workflow interface:

```typescript
$.send('notify', data)                    // Fire-and-forget
$.try('validate', data)                   // Quick attempt
$.do('process', data)                     // Durable execution
$.on.Customer.created(handler)            // Event subscription
$.every.Monday.at9am(handler)             // Scheduling
$.Startup('acme').prioritize()            // Cross-DO resolution
```

## Architecture

```
                                ┌─────────────────┐
                                │       DO        │
                                │   (Base Class)  │
                                └────────┬────────┘
                                         │
         ┌───────────────┬───────────────┼───────────────┬───────────────┐
         │               │               │               │               │
   ┌─────┴─────┐   ┌─────┴─────┐   ┌─────┴─────┐   ┌─────┴─────┐  ┌──────┴──────┐
   │  Business │   │    App    │   │   Site    │   │  Worker   │  │   Entity    │
   │           │   │           │   │           │   │           │  │             │
   └───────────┘   └───────────┘   └───────────┘   └─────┬─────┘  └─────────────┘
                                                         │
                                                   ┌─────┴─────┐
                                                   │           │
                                               ┌───┴───┐   ┌───┴───┐
                                               │ Agent │   │ Human │
                                               └───────┘   └───────┘
```

### Class Hierarchy

| Class | Purpose | Example |
|-------|---------|---------|
| **DO** | Base class with core data model | All objects inherit from this |
| **Business** | Multi-tenant organization | `acme-corp`, `startup-inc` |
| **App** | Application within a business | `crm-app`, `analytics-dashboard` |
| **Site** | Website/domain within an app | `docs.acme.com`, `app.acme.com` |
| **Worker** | Work-performing entity (AI or Human) | Common interface for `do()`, `ask()`, `decide()` |
| **Agent** | AI-powered autonomous worker | `support-agent`, `sales-assistant` |
| **Human** | Human worker with approval flows | `john@acme.com`, `support-team` |
| **Entity** | Domain object container | `Customer`, `Order`, `Product` |

## Core Data Model

Every DO inherits a unified data model implemented with **Drizzle ORM** on SQLite:

```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

// Things - Core entities
export const things = sqliteTable('things', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),           // 'customer', 'order', 'product'
  name: text('name'),
  data: text('data', { mode: 'json' }),   // Flexible JSON storage
  meta: text('meta', { mode: 'json' }),   // System metadata
  createdAt: integer('created_at', { mode: 'timestamp' }),
  updatedAt: integer('updated_at', { mode: 'timestamp' }),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
})

// Relationships - Graph edges between things
export const relationships = sqliteTable('relationships', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),            // 'owns', 'employs', 'purchased'
  fromId: text('from_id').notNull(),
  fromType: text('from_type').notNull(),
  toId: text('to_id').notNull(),
  toType: text('to_type').notNull(),
  data: text('data', { mode: 'json' }),    // Edge properties
  createdAt: integer('created_at', { mode: 'timestamp' }),
})

// Actions - Command log with undo/redo
export const actions = sqliteTable('actions', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),            // 'create', 'update', 'delete'
  target: text('target').notNull(),        // Thing ID
  actor: text('actor').notNull(),          // Who performed action
  data: text('data', { mode: 'json' }),    // Action payload
  result: text('result', { mode: 'json' }),
  status: text('status').notNull(),        // pending, completed, failed, undone
  createdAt: integer('created_at', { mode: 'timestamp' }),
})

// Events - Event sourcing
export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),            // 'customer.created', 'order.shipped'
  source: text('source').notNull(),        // Origin DO/Thing
  data: text('data', { mode: 'json' }),    // Event payload
  sequence: integer('sequence').notNull(), // Ordering
  createdAt: integer('created_at', { mode: 'timestamp' }),
})

// Search - Full-text search index
export const search = sqliteTable('search', {
  id: text('id').primaryKey(),
  thingId: text('thing_id').notNull(),
  content: text('content').notNull(),      // Searchable text
  vector: text('vector', { mode: 'json' }), // Embedding vector (optional)
})

// Objects - Cross-DO references
export const objects = sqliteTable('objects', {
  id: text('id').primaryKey(),
  doId: text('do_id').notNull(),           // Target Durable Object ID
  doClass: text('do_class').notNull(),     // 'Business', 'Agent', etc.
  localRef: text('local_ref'),             // Local Thing ID this relates to
  role: text('role'),                      // 'parent', 'owner', 'handler'
  data: text('data', { mode: 'json' }),
  createdAt: integer('created_at', { mode: 'timestamp' }),
})
```

## DO Base Class

```typescript
import { DurableObject } from 'cloudflare:workers'
import { drizzle, DrizzleSqliteDODatabase } from 'drizzle-orm/durable-sqlite'
import { migrate } from 'drizzle-orm/durable-sqlite/migrator'
import * as schema from './schema'

export class DO extends DurableObject {
  protected db: DrizzleSqliteDODatabase<typeof schema>

  // Data model accessors
  protected things: ThingStore
  protected rels: RelationshipStore
  protected actions: ActionStore
  protected events: EventStore
  protected search: SearchIndex
  protected objects: ObjectStore

  // Workflow context (ai-workflows pattern)
  protected $: WorkflowContext

  // AI primitives (ai-functions pattern)
  protected ai: AITemplateFunction
  protected is: IsTemplateFunction
  protected decide: DecideTemplateFunction

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    // Initialize Drizzle with DO storage
    this.db = drizzle(ctx.storage, { schema })

    // Run migrations before any queries
    ctx.blockConcurrencyWhile(async () => {
      await migrate(this.db, migrations)
      await this.initializeStores()
    })
  }
}
```

## Worker Interface

Common interface for both AI agents and humans, implementing the `digital-workers` pattern:

```typescript
export type WorkerMode = 'autonomous' | 'supervised' | 'manual'

export class Worker extends DO {
  protected mode: WorkerMode = 'supervised'

  // Digital Worker Interface
  async do(task: Task, context?: Context): Promise<TaskResult>
  async ask(question: string, context?: Context): Promise<Answer>
  async decide(question: string, options: Option[]): Promise<Decision>
  async approve(request: ApprovalRequest): Promise<ApprovalResult>
  async generate<T>(prompt: string, schema?: ZodSchema<T>): Promise<T>
  async notify(message: string, channels: Channel[]): Promise<void>
}
```

### Agent (AI Worker)

```typescript
export class Agent extends Worker {
  protected mode: WorkerMode = 'autonomous'
  protected tools: ToolRegistry
  protected memory: MemoryStore
  protected sandbox: Sandbox

  async run(goal: Goal): Promise<GoalResult> {
    // Observe → Think → Act agentic loop
    while (iteration < maxIterations) {
      const observation = await this.observe()
      const action = await this.ai`What action for goal: ${goal}?`

      if (action.action === 'complete') {
        return { success: true, result: action.result }
      }

      await this.tools.execute(action.action, action.input)
    }
  }
}
```

### Human

```typescript
export class Human extends Worker {
  protected mode: WorkerMode = 'manual'
  protected channels: NotificationChannel[]
  protected approvalQueue: ApprovalQueue
  protected escalationPolicy: EscalationPolicy

  async requestApproval(request: ApprovalRequest): Promise<ApprovalResult> {
    await this.notify(`Approval needed: ${request.description}`, this.channels)
    // Wait for response with timeout escalation
  }
}
```

## Event Streaming

Integration with Cloudflare Pipelines for analytics:

```typescript
// Emit events to both local store and Pipeline
await this.events.emit('order.created', order, { stream: true })

// Events flow: DO → Stream → Pipeline (SQL transform) → R2 Iceberg tables
// Query via R2-SQL:
// SELECT source, type, COUNT(*) FROM events GROUP BY source, type
```

## Cross-Object Relationships

```typescript
// Link to another DO
await this.objects.link({
  doId: 'agent:support-bot',
  doClass: 'Agent',
  role: 'assignedAgent'
})

// Traverse hierarchy
const parent = await this.objects.parent()
const business = await this.objects.root()
const children = await this.objects.children()
```

## Sharding & Colocation

```typescript
// Geographic colocation (colo.do pattern)
const coloId = request.cf?.colo // 'ORD', 'LHR', 'NRT'
const doId = `entity:${entityId}:${coloId}`

// Hierarchical sharding
const siteId = `site:${businessId}:${appId}:${siteSlug}`

// Hash-based sharding
const shardId = hash(entityId) % shardCount
const doId = `entity:shard-${shardId}:${entityId}`
```

## Configuration

```toml
# wrangler.toml
name = "my-app"
main = "src/index.ts"
compatibility_date = "2024-11-12"
compatibility_flags = ["nodejs_compat"]

[durable_objects]
bindings = [
  { name = "BUSINESS", class_name = "Business" },
  { name = "APP", class_name = "App" },
  { name = "SITE", class_name = "Site" },
  { name = "AGENT", class_name = "Agent" },
  { name = "HUMAN", class_name = "Human" },
  { name = "ENTITY", class_name = "Entity" }
]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["Business", "App", "Site", "Agent", "Human", "Entity"]

[[pipelines]]
name = "events"
binding = "PIPELINE"

[[r2_buckets]]
binding = "ANALYTICS"
bucket_name = "analytics"
```

## Key Integrations

| Source | Integration |
|--------|-------------|
| **Cloudflare Agent** | Base class with state, SQL, WebSocket, scheduling |
| **Drizzle ORM** | Type-safe SQLite persistence |
| **digital-workers** | Common Worker interface for AI/Human |
| **ai-functions** | Promise-pipelined AI primitives |
| **ai-workflows** | Event-driven DSL: `on.Customer.signup`, `every.Monday.at9am` |
| **human-in-the-loop** | Approval flows and escalation |
| **Pipelines/Streams** | Event streaming to R2 Iceberg |
| **R2 Data Catalog** | Analytics with R2-SQL |
| **colo.do** | Geographic colocation patterns |

## Design Principles

1. **Hierarchy over flat** - Business → App → Site → Entity structure
2. **Unified data model** - Things, Relationships, Actions, Events everywhere
3. **AI-native** - Agents and Humans share the same Worker interface
4. **Event-sourced** - Every change is an event, streamable to analytics
5. **Locality-aware** - Support for geographic colocation and sharding
6. **Type-safe** - Drizzle ORM with full TypeScript inference

## License

MIT
