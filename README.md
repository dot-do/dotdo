# dotdo v2

> The Semantic Runtime for Durable Objects

dotdo is a runtime/framework layer for Cloudflare Durable Objects that provides:

- **Semantic Type System** - Nouns, Verbs, Things, and Actions as first-class primitives
- **Cap'n Web RPC** - Remote introspection and execution via capability-based RPC
- **Cost-Optimized Durability** - Pipeline-as-WAL with 95%+ SQLite cost reduction
- **AI-Native Operations** - Template literal AI with cascade execution
- **Distributed Queries** - Fanout coordination across sharded clusters

## Core Concepts

### Everything is Semantic

dotdo models your domain using linguistic primitives:

```typescript
// Nouns name things
const Customer = noun('Customer')    // → customer, customers
const Order = noun('Order')          // → order, orders

// Verbs describe actions
const purchase = verb('purchase')    // → purchased, purchasing
const ship = verb('ship')            // → shipped, shipping

// Things are instances
const alice = thing(Customer, 'alice-123')
const order = thing(Order, 'order-456')

// Actions unify events + edges + audit
const action = alice.purchased(order).at(store).on(new Date())
// This is simultaneously:
// - An event (something happened)
// - An edge (alice → order relationship)
// - An audit log entry (who did what when)
```

### Four Relationship Operators

Navigate your data graph with four operators:

```typescript
// Forward exact: A -> B (A directly relates to B)
const orders = await customer -> 'Order'

// Forward fuzzy: A ~> B (A semantically relates to B)
const recommendations = await customer ~> 'Product'

// Backward exact: A <- B (things that relate to A)
const reviews = await product <- 'Review'

// Backward fuzzy: A <~ B (things semantically related to A)
const similar = await product <~ 'Product'
```

### WorkflowContext ($)

The `$` context is your universal API:

```typescript
// Event handling (infinite Noun.verb combinations)
$.on.Customer.signup(async (event) => { ... })
$.on.Payment.failed(async (event) => { ... })
$.on.*.created(async (event) => { ... })  // Wildcards

// Scheduling (fluent DSL → CRON)
$.every.Monday.at9am(handler)
$.every.day.at('6pm')(handler)
$.every.hour(handler)

// AI operations (cascade execution)
$.ai`Summarize: ${document}`           // Single-shot
$.ai.agentic`Research: ${topic}`       // Multi-step

// Graph operations
$.things.Customer(id) -> 'Order'       // Relationships

// Cross-DO RPC
await $.Customer(id).notify()

// Durable execution
$.do(action)      // Retries + persistence
$.try(action)     // Single attempt
$.send(event)     // Fire-and-forget
```

### Cascade Execution

Every operation cascades through tiers:

```
┌──────────────────────────────────────────────────────┐
│  1. Code        Deterministic functions    instant   │
│  2. Generative  LLM single-shot           <1s       │
│  3. Agentic     Multi-step AI reasoning   seconds   │
│  4. Human       Approval queue            minutes+  │
└──────────────────────────────────────────────────────┘
```

Start deterministic, escalate only as needed.

### Template Literal AI

Native AI via tagged template literals:

```typescript
const summary = ai`Summarize: ${document}`
const sentiment = is`${review} positive, negative, or neutral?`
const items = list`Extract action items from: ${notes}`
const impl = code`TypeScript function to ${description}`

// Batch modes for cost optimization
const summaries = ai.batch(documents, 'flex')     // Cheaper, slower
const urgent = ai.batch(alerts, 'immediate')      // Full price, fast
```

## Architecture

### DO Class Hierarchy

Progressive enhancement - pay only for what you use:

```
DOCore      (~5KB)   State, alarms, routing
DOSemantic  (~20KB)  Nouns, Verbs, Things, Actions, operators
DOStorage   (~40KB)  InMemory + Pipeline + SQLite + Iceberg
DOWorkflow  (~60KB)  WorkflowContext ($), cascade, scheduling
DOFull      (~80KB)  AI, human-in-loop, fanout, streaming
```

### Storage Stack

Four-layer durability with Pipeline-as-WAL:

```
L0: InMemory   O(1) reads, dirty tracking, LRU eviction
L1: Pipeline   WAL for durability, fire-and-forget, immediate ACK
L2: SQLite     Lazy checkpoint, batched writes
L3: Iceberg    Cold storage, time travel, schema evolution
```

Write path: `L0 → L1 (ACK) → lazy L2 → eventual L3`
Read path: `L0 (hit?) → L2 (hit?) → L3 (restore)`

### Cap'n Web RPC

Every DO exposes capabilities via RPC:

```typescript
interface CustomerDO {
  // Introspection
  $meta: {
    schema: () => Schema
    methods: () => MethodDescriptor[]
    capabilities: () => Capability[]
  }

  // Data operations
  things: ThingStore
  actions: ActionStore

  // Domain methods
  notify: (message: string) => Promise<void>
  charge: (amount: number) => Promise<Receipt>
}
```

Benefits:
- Remote introspection (list methods, types, schemas)
- Type-safe remote execution
- Promise pipelining (chain without round-trips)
- Capability-based security

### Worker Layer

Multiple deployment patterns:

```typescript
// Single DO: https://tenant.api.dotdo.dev/:id
// Typed:     https://tenant.api.dotdo.dev/:type/:id
// Path NS:   https://api.dotdo.dev/:ns/:type/:id
// Sharded:   Routes to correct shard via consistent hash
// Replicated: Read replicas + primary with intent detection
```

### Sharded Clusters

```
Client → Worker → Hash Ring → Shard DO
                     ↓
              128+ parallel scanners
              for distributed queries
```

### Read Replicas

```
         ┌─ Read  → Replica (load balanced)
Client → │
         └─ Write → Primary → async replicate
```

## Package Structure

```
dotdo/
├── core/           # DOCore - minimal foundation
├── semantic/       # DOSemantic - Nouns, Verbs, Things, Actions
├── storage/        # DOStorage - 4-layer durability
├── workflow/       # DOWorkflow - $ context
├── ai/             # Template literal AI
├── streaming/      # WebSocket, SSE, backpressure
├── fanout/         # Distributed queries
├── human/          # Human-in-the-loop
├── rpc/            # Cap'n Web RPC layer
└── workers/        # Deployment presets
    ├── routing/    # URL parsing strategies
    ├── proxy/      # RPC proxy
    ├── sharding/   # Cluster distribution
    ├── replication/# Read scaling
    └── presets/    # Ready-to-deploy workers
```

## Development

```bash
# Development
npm run dev          # Wrangler dev server
npm test             # Vitest watch mode
npm run test:run     # Tests once
npm run typecheck    # TypeScript check

# Single test file
npx vitest run path/to/test.ts

# Deploy
npm run deploy
```

### Testing Philosophy: NO MOCKS

Miniflare runs real DOs with real SQLite locally:

```typescript
import { env } from 'cloudflare:test'

const stub = env.DO.get(env.DO.idFromName('test'))

// Test via RPC (preferred)
const result = await stub.things.create({ $type: 'Customer', name: 'Alice' })
expect(result.$id).toBeDefined()

// Test via fetch
const res = await stub.fetch('https://test.api.dotdo.dev/customers')
expect(res.status).toBe(200)
```

## Issue Tracking

Using beads with hierarchical IDs:

```bash
bd ready                              # Find available work
bd list --status=open                 # All open issues
bd show <id>                          # Issue details
bd update <id> --status=in_progress   # Claim work
bd close <id>                         # Complete
bd sync                               # Sync with git
```

## License

MIT
