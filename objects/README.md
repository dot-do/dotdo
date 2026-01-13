# Durable Objects Data Model

The dotdo Durable Object architecture is built on a **Graph** where:

- **Things** are instances of **Nouns**
- **Relationships** are instances of **Verbs**

This simple model supports complex behaviors: file systems, git repositories, domain data, function execution, workflow orchestration, and event streaming.

## Core Philosophy

Everything in a DO can be represented as a graph:

1. **Things** - Nodes (instances of Nouns)
2. **Relationships** - Edges (instances of Verbs)

That's it. No complex schema migrations. No ORM configuration. Just a graph that can represent anything.

### Performance & Storage

If you're concerned about technical efficiency: the graph model is a **logical abstraction**. Under the hood, we have multiple concrete implementations optimized for different workloads:

- **DocumentStore** - MongoDB-like JSON storage with indexes
- **TypedColumnStore** - Columnar storage with compression (Gorilla, Delta, RLE)
- **TemporalStore** - Versioned key-value with time-travel
- **SQLite** - Direct relational storage when needed

The abstraction means **no migrations**. Add a field? Just store it. Change a type? The graph handles it. This simplifies development immensely - you define the logical model, and the storage layer optimizes automatically.

## The Graph

```
┌─────────────────────────────────────────────────────────────────┐
│                     Things (Noun instances)                      │
├─────────────────────────────────────────────────────────────────┤
│  id        │ type      │ name           │ data                  │
│────────────│───────────│────────────────│───────────────────────│
│  Customer  │ Noun      │ Customer       │ { schema: {...} }     │
│  acme      │ Customer  │ Acme Corp      │ { email: '...' }      │
│  /src/app  │ File      │ app.ts         │ { mode: 0o644 }       │
│  abc123    │ GitCommit │ feat: login    │ { tree: 'def456' }    │
│  list      │ Function  │ list           │ { tier: 'generative' }│
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                 Relationships (Verb instances)                   │
├─────────────────────────────────────────────────────────────────┤
│  from            │ verb       │ to              │ data          │
│──────────────────│────────────│─────────────────│───────────────│
│  Customer/acme   │ owns       │ Product/widget  │ {}            │
│  Human/nathan    │ creating   │ null            │ { input }     │
│  Human/nathan    │ created    │ Startup/acme    │ { output }    │
│  Payment/xyz     │ failed     │ null            │ { error }     │
└─────────────────────────────────────────────────────────────────┘
```

## Things: Universal Entities

Everything is a Thing:

| Category | Examples |
|----------|----------|
| **Domain Data** | Customer, Product, Order, Invoice |
| **Meta Types** | Noun (type definitions), Verb (predicates) |
| **Files** | fsx file system entries |
| **Git Objects** | GitCommit, GitTree, GitBlob |
| **Functions** | Function definitions (versioned in gitx) |
| **Workflows** | Workflow definitions |
| **Actors** | Agent, Human |

### Thing Schema

```typescript
Thing: {
  id: string           // Unique identifier within DO
  type: Noun           // Reference to type definition (also a Thing)
  name: string         // Human-readable name
  data: object         // JSON properties
  visibility: 'public' | 'unlisted' | 'org' | 'user'
}
```

The Things table is **append-only** for versioning. Each mutation creates a new row; the rowid serves as the version number.

## Relationships: Universal Edges

Everything that connects Things is a Relationship:

| Type | Description | Example |
|------|-------------|---------|
| **Static** | Permanent connections | `Customer/acme --owns--> Product/widget` |
| **Actions** | Commands/operations | `Human/nathan --created--> Startup/acme` |
| **Events** | State changes | `Payment/xyz --failed--> null` |

### Verb Forms Encode State

The key insight: **verb form IS the status**.

| Form | Name | State | `to` field |
|------|------|-------|------------|
| `create` | action | intent/pending | target or placeholder |
| `creating` | activity | in progress | `null` (not yet exists) |
| `created` | event | completed | the result Thing |

This eliminates the need for a separate `status` column.

```
Action lifecycle:
  Human/nathan --create--> Startup/?        (intent declared)
  Human/nathan --creating--> null           (work in progress)
  Human/nathan --created--> Startup/acme    (completed)
```

### Relationship Schema

```typescript
Relationship: {
  from: Thing          // Source entity
  verb: string         // Predicate (verb form encodes state)
  to: Thing | null     // Target entity (null = in progress or event)
  data: object         // Edge properties
  createdAt: timestamp
}
```

## Verbs Registry

Verbs are Things of type `Verb` that define linguistic forms:

```typescript
{
  id: 'creates',
  type: 'Verb',
  data: {
    verb: 'creates',      // Predicate form (for static relationships)
    action: 'create',     // Imperative form (commands)
    activity: 'creating', // Gerund (in progress)
    event: 'created',     // Past participle (completed)
    reverse: 'createdBy', // Backward traversal
    inverse: 'deletes',   // Opposite action
  }
}
```

## Functions as Versioned Data

**Functions are DATA, not code.** The model, prompt, temperature, and config are NOT hardcoded in TypeScript. They're stored in gitx as versioned JSON:

```
@functions/
  list.json      → { tier: 'generative', prompt: '...', model: 'claude-sonnet-4-20250514' }
  is.json        → { tier: 'generative', prompt: '...', temperature: 0.3 }
  planTrip.json  → { tier: 'agentic', tools: [...], maxIterations: 10 }
```

This enables:

- **A/B Testing** - Git branches for experiments
- **Rollback** - Git history for reverting changes
- **Evals** - Test different models/prompts without code changes
- **Hot Swapping** - Update prompts without deployment

### Function Execution Flow

When you call `list\`5 startup ideas\``:

1. Look up `@functions/list` in gitx
2. Get current version (or experiment branch)
3. Load config (model, prompt template, temperature, etc.)
4. Execute with the config
5. Record action in Relationships

### Function Tiers (Cascade Pattern)

Functions have tiers that cascade on failure:

```
Code → Generative → Agentic → Human
```

| Tier | Description | Example |
|------|-------------|---------|
| **Code** | Pure TypeScript | `validateEmail(email)` |
| **Generative** | LLM-powered | `list\`5 startup ideas\`` |
| **Agentic** | Multi-step with tools | `planTrip({ destination })` |
| **Human** | Requires approval | `ceo\`approve partnership\`` |

## fsx Integration

Files are Things:

```typescript
{
  id: '/src/index.ts',
  type: 'File',
  name: 'index.ts',
  data: {
    mode: 0o644,
    size: 1234,
    blob: 'sha256...',  // Content stored separately
    parent: '/src',
    tier: 'hot',
  }
}
```

File relationships:

```
File/index.ts --imports--> File/utils.ts
File/index.ts --trackedBy--> GitCommit/abc123
File/README.md --ownedBy--> User/nathan
```

## gitx Integration

Git objects are Things:

```typescript
// Commit
{ id: 'abc123', type: 'GitCommit', data: { tree: 'def456', parents: ['xyz789'], message: '...' } }

// Tree
{ id: 'def456', type: 'GitTree', data: { entries: [{ name: 'src', sha: '...' }] } }

// Blob
{ id: 'ghi789', type: 'GitBlob', data: { size: 1234 } }  // Content in blobs table
```

Git relationships:

```
GitCommit/abc123 --authored--> User/nathan
GitCommit/abc123 --contains--> File/index.ts
Function/list --definedAt--> GitCommit/abc123  // Version tracking
```

## Actions and Durable Execution

Actions are temporal Relationships with execution metadata:

```typescript
// In progress
{
  from: 'Agent/ralph',
  verb: 'building',
  to: null,
  data: {
    function: '@functions/build@abc123',  // Git SHA
    input: { spec: '...' },
    durability: 'do',
    startedAt: 1705156800000,
  }
}

// Completed
{
  from: 'Agent/ralph',
  verb: 'built',
  to: 'App/xyz',
  data: {
    function: '@functions/build@abc123',
    input: { spec: '...' },
    output: { url: 'https://...' },
    durability: 'do',
    startedAt: 1705156800000,
    completedAt: 1705157400000,
    duration: 600000,
  }
}
```

### Durability Levels

From the `$` context DSL:

| Level | Behavior | Use Case |
|-------|----------|----------|
| `$.send()` | Fire and forget | Notifications, logging |
| `$.try()` | Single attempt | Non-critical operations |
| `$.do()` | Durable with retries | Critical business logic |

## Events and Guaranteed Delivery

Events are Relationships with guaranteed delivery to pipelines:

```typescript
{
  from: 'Payment/xyz',
  verb: 'failed',
  to: null,
  data: {
    error: { code: 'insufficient_funds' },
    streamed: false,  // Not yet delivered
  },
  createdAt: 1705156800000,
}
```

### Event Streaming Flow

1. Query relationships where verb is event form and `streamed = false`
2. Write to pipeline (R2/Parquet/Iceberg)
3. Mark `streamed = true`

This provides exactly-once delivery for event sourcing and analytics.

## Workflows

Workflow definitions are versioned in gitx:

```json
// @workflows/onboarding.json
{
  "triggers": [{ "on": "Customer.created" }],
  "steps": [
    { "action": "sendWelcome", "function": "@functions/sendEmail" },
    { "action": "assignAgent", "function": "@functions/assignAgent" },
    { "wait": "24h" },
    { "action": "followUp", "function": "@functions/followUp" }
  ]
}
```

Workflow execution creates Relationships:

```typescript
{
  from: 'Workflow/onboarding-123',
  verb: 'executing',
  to: 'Step/2',
  data: {
    definition: '@workflows/onboarding@abc123',
    state: { currentStep: 2, context: { customerId: 'acme' } },
    startedAt: 1705156800000,
  }
}
```

## Event Handlers ($ Context DSL)

```typescript
// React to domain events
$.on.Customer.created(async (customer, $) => {
  await $.do('@functions/sendWelcome', { to: customer.email })
})

$.on.Payment.failed(async (payment, $) => {
  await $.send('@functions/notifyAdmin', { payment })
})

// Scheduled tasks
$.every.Monday.at9am(async ($) => {
  await $.do('@functions/weeklyReport')
})

$.every.hour(async ($) => {
  await $.do('@functions/healthCheck')
})
```

## Human Escalation

```typescript
import { ceo, legal } from 'humans.do'

// Request human decision
const approved = await ceo`approve the partnership with ${company}`

// Creates relationship:
// { from: 'Human/ceo', verb: 'approving', to: null, data: { prompt, sla: '4h' } }

// When approved:
// { from: 'Human/ceo', verb: 'approved', to: 'Decision/xyz', data: { decision: true } }
```

## Named Agents

```typescript
import { priya, ralph, tom } from 'agents.do'

// Define product spec
const spec = await priya`define the MVP for ${hypothesis}`

// Build it
let app = await ralph`build ${spec}`

// Review loop
while (!await tom.approve(app)) {
  app = await ralph`improve ${app} based on ${tom.feedback}`
}
```

Each agent call creates action Relationships:

```
Agent/priya --defining--> null           (in progress)
Agent/priya --defined--> Spec/abc123     (completed)
Agent/ralph --building--> null           (in progress)
Agent/ralph --built--> App/xyz           (completed)
Agent/tom --reviewing--> null            (in progress)
Agent/tom --approved--> App/xyz          (completed)
```

## Storage Primitives

The physical storage uses composed primitives from `db/primitives/`:

### TypedColumnStore

Columnar storage with compression:

- **Gorilla XOR** - Float time series (10x compression)
- **Delta-of-delta** - Timestamps
- **RLE** - Repeated values
- **Bloom filters** - Membership testing
- **HyperLogLog** - Distinct counts

### DocumentStore

MongoDB-like API:

- JSON storage with queries ($eq, $gt, $in, etc.)
- Secondary indexes
- Time-travel (`getAsOf`)
- Transactions

### TemporalStore

Versioned key-value:

- Append-only history
- Point-in-time queries
- Retention policies

## Schema Definition

The logical schema is defined using ai-database syntax:

```typescript
import { DB } from 'ai-database'

const { db } = DB({
  Thing: {
    name: 'string',
    type: 'Noun.instances',
    data: 'object',
    visibility: 'public | unlisted | org | user',
  },

  Relationship: {
    from: 'Thing.outgoing',
    verb: 'string',
    to: 'Thing.incoming?',  // Nullable for events/in-progress
    data: 'object',
  },
})
```

The adapter handles physical storage - could be DocumentStore, TypedColumnStore, raw SQLite, or external systems.

## Query Patterns

```typescript
// Get a Thing
const customer = await db.Thing.get('Customer/acme')

// Forward traversal: what does acme own?
const products = await db.Relationship.find({
  from: 'Customer/acme',
  verb: 'owns',
})

// Backward traversal: who owns this product?
const owners = await db.Relationship.find({
  to: 'Product/widget',
  verb: 'owns',
})

// Natural language query
const leads = await db.Thing`customers who signed up this month`

// Time travel
const customerYesterday = await db.Thing.getAsOf('Customer/acme', yesterday)

// Get in-progress actions
const pending = await db.Relationship.find({
  verb: { $regex: /ing$/ },  // All activity forms
})
```

## Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          gitx                                    │
│              (versioned definitions)                             │
│                                                                  │
│  @functions/ - Function configs (model, prompt, temperature)    │
│  @schemas/   - Noun definitions (type schemas)                  │
│  @workflows/ - Workflow definitions                             │
│                                                                  │
│  Git objects ARE Things (GitCommit, GitTree, GitBlob)           │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Things (Noun instances)                       │
│                                                                  │
│  All entities: Files, Git objects, Domain data, Meta types      │
│                                                                  │
│  Backed by: DocumentStore, TypedColumnStore, or SQLite          │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                 Relationships (Verb instances)                   │
│                                                                  │
│  Static:  Customer --owns--> Product                            │
│  Actions: Agent --building--> null (in progress)                │
│  Events:  Payment --failed--> null { streamed: false }          │
│                                                                  │
│  Verb form = state (create → creating → created)                │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                        (streamed=false)
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Pipelines → Iceberg                            │
│                                                                  │
│  Events streamed to R2/Parquet for analytics                    │
│  Guaranteed delivery with exactly-once semantics                │
└─────────────────────────────────────────────────────────────────┘
```

## Integration: better-auth

The graph model requires a custom database adapter for better-auth. Instead of traditional tables (users, sessions, accounts), authentication data lives in the graph:

```typescript
// Users are Things
{ id: 'nathan', type: 'User', data: { email: 'nathan@...', name: 'Nathan' } }

// Sessions are Things
{ id: 'sess_abc', type: 'Session', data: { expiresAt: '...' } }

// Relationships connect them
{ from: 'Session/sess_abc', verb: 'belongsTo', to: 'User/nathan' }
{ from: 'User/nathan', verb: 'authenticatedVia', to: 'Account/github_123' }
```

The better-auth adapter maps its operations to graph queries. This means:
- **No auth migrations** - User schema changes are just data
- **Unified model** - Auth data participates in the same graph as business data
- **Relationships** - Users naturally connect to everything they own/create

## Summary

The DO data model achieves simplicity through unification:

- **Graph model** - Things (Noun instances) + Relationships (Verb instances)
- **Verb forms** encode action state (no status column needed)
- **gitx** versions definitions (functions, schemas, workflows)
- **fsx** integrates natively (files are Things)
- **Events** have guaranteed delivery (streamed flag)
- **No migrations** - Schema changes are just data changes
- **Storage abstraction** - Multiple concrete implementations for performance

This foundation supports the full spectrum of dotdo capabilities: AI agents, human escalation, durable workflows, event sourcing, and business-as-code - all through the simple abstraction of Things connected by Relationships.
