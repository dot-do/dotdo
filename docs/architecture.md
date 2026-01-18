# System Architecture

This document describes the high-level architecture of dotdo, the semantic runtime for Cloudflare Durable Objects.

## Overview

dotdo provides a layered runtime framework that progressively enhances Cloudflare Durable Objects with semantic modeling, workflow orchestration, and AI capabilities.

```
┌─────────────────────────────────────────────────────────────┐
│                         Worker                               │
│                   (Minimal Passthrough)                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Durable Object                          │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                    DOCore (~5KB)                        │ │
│  │         State | Alarms | Routing | WebSocket            │ │
│  │  ┌───────────────────────────────────────────────────┐  │ │
│  │  │                Modules (RPC Targets)              │  │ │
│  │  │  Events | Schedule | Storage | Noun Accessors     │  │ │
│  │  └───────────────────────────────────────────────────┘  │ │
│  └─────────────────────────────────────────────────────────┘ │
│                           │                                  │
│                           ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                       SQLite                            │ │
│  │  state | things | events | schedules | action_log       │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Core Principles

### 1. Minimal Worker, Maximal DO

The worker is a pure passthrough. All business logic lives in Durable Objects:

```typescript
// api/index.ts - The entire worker
export { DOCore } from '../core/DOCore'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const ns = url.hostname.split('.')[0] ?? 'default'
    const id = env.DOCore.idFromName(ns)
    const stub = env.DOCore.get(id)
    return stub.fetch(request)
  }
}
```

**Benefits:**
- DO is the single source of truth
- Natural multi-tenancy (one DO per namespace)
- RPC bypasses the worker for DO-to-DO calls
- Cold start only affects the worker, not the DO lifecycle

### 2. Pay for What You Use

The class hierarchy allows progressive enhancement:

| Class | Added Size | Capabilities |
|-------|------------|--------------|
| **DOCore** | ~5KB | State, alarms, Hono routing, WebSocket, RPC |
| **DOSemantic** | ~5KB | Nouns, Verbs, Things, Actions, relationships |
| **DOStorage** | ~6KB | Tiered storage (L0-L3), WAL, lazy checkpoint |
| **DOWorkflow** | ~5KB | WorkflowContext ($), events, scheduling, cascade |
| **DOFull** | ~4KB | AI integration, human-in-loop, fanout |

Extend only the class you need:

```typescript
// Simple CRUD app - use DOCore
export class SimpleApp extends DOCore { }

// Event-driven app - use DOWorkflow
export class EventApp extends DOWorkflow { }

// AI-powered app - use DOFull
export class AIApp extends DOFull { }
```

### 3. No Mocking Required

Miniflare runs real Durable Objects with real SQLite locally. Tests interact with actual implementations:

```typescript
import { env } from 'cloudflare:test'

it('persists data', async () => {
  const stub = env.DOCore.get(env.DOCore.idFromName('test'))

  // Real RPC call to real DO with real SQLite
  await stub.set('key', { value: 42 })
  const result = await stub.get('key')

  expect(result).toEqual({ value: 42 })
})
```

## Component Architecture

### DOCore

The foundation class providing core DO capabilities.

```
DOCore
├── StateManager         # Key-value state (get/set/delete/list)
├── WebSocketManager     # WebSocket upgrade and broadcast
├── WebSocketRpcHandler  # Bidirectional RPC over WebSocket
├── Hono App             # HTTP routing with middleware
└── Modules
    ├── DOCoreEvents     # Event emission and subscription
    ├── DOCoreSchedule   # CRON scheduling and persistence
    └── DOCoreStorage    # Thing CRUD with LRU cache
```

**State Management:**
- SQLite-backed key-value store
- JSON serialization for values
- Prefix-based listing with pagination
- Transactional multi-key operations

**Routing:**
- Hono framework integration
- Middleware support (CORS, auth, logging)
- WebSocket upgrade handling
- RPC pipeline endpoint

### Module System

v2 extracts concerns into RPC-compatible modules:

```typescript
// Modules extend RpcTarget for cross-DO access
export class DOCoreEvents extends RpcTarget implements IEvents {
  send(type: string, data: unknown): string { /* ... */ }
  subscribe(type: string, handler: EventHandler): Unsubscribe { /* ... */ }
}

export class DOCoreSchedule extends RpcTarget implements ISchedule {
  registerSchedule(cron: string, handler: ScheduleHandler): void { /* ... */ }
  listSchedules(): ScheduleEntry[] { /* ... */ }
}

export class DOCoreStorage extends RpcTarget implements IStorage {
  create(noun: string, data: Record<string, unknown>): Promise<ThingData> { /* ... */ }
  list(noun: string, query?: QueryOptions): Promise<ThingData[]> { /* ... */ }
}
```

**Benefits:**
- Focused responsibilities
- RPC-accessible from other DOs
- Easier testing in isolation
- Clear interface contracts

### Noun Accessors

Fluent API for Thing operations:

```
this.Customer()          → NounAccessor (create, list, count, findFirst)
this.Customer('id')      → NounInstanceAccessor (get, update, delete, softDelete)
this.noun('AnyType')     → Generic accessor for any noun
this.noun('AnyType', id) → Generic instance accessor
```

**Implementation:**

```typescript
// Factory pattern creates appropriate accessor
getNounAccessor(noun: string, id?: string): NounAccessor | NounInstanceAccessor {
  const storage = this.getStorageAdapter()
  return id
    ? new NounInstanceAccessor(storage, noun, id)
    : new NounAccessor(storage, noun)
}

// Proxy enables dynamic noun methods
// this.Vehicle() works without explicit definition
```

### WorkflowContext ($)

The unified API for workflow operations, available via `this.on`, `this.every`, `this.send`, etc.

```
WorkflowContext ($)
├── on.Noun.verb()        # Event handlers with wildcards
├── every.day.at('9am')   # Scheduling DSL
├── send(type, data)      # Fire-and-forget events
├── try(action)           # Single attempt execution
├── do(action, opts)      # Durable execution with retries
└── Customer(id)          # Cross-DO RPC stub
```

**Event System (Proxy-based):**

```typescript
// Nested proxies enable infinite Noun.verb combinations
const on = new Proxy({}, {
  get(_, noun: string) {
    return new Proxy({}, {
      get(_, verb: string) {
        return (handler: EventHandler) => {
          // Register handler for "${noun}.${verb}"
          return () => { /* unsubscribe */ }
        }
      }
    })
  }
})

// Usage
this.on.Customer.signup(handler)    // Works
this.on.Spaceship.landed(handler)   // Also works
this.on['*'].created(handler)       // Wildcard
```

**Scheduling DSL:**

```typescript
// Fluent builder compiles to CRON
this.every.Monday.at9am(handler)     // "0 9 * * 1"
this.every.day.at('6pm')(handler)    // "0 18 * * *"
this.every(5).minutes(handler)       // "*/5 * * * *"
```

### Storage Architecture

Four-tier storage for cost optimization (when using DOStorage):

```
L0: In-Memory (LRU Cache)
    └── O(1) reads, dirty tracking
        │
L1: Pipeline (WAL)
    └── Immediate ACK, durability guarantee
        │
L2: SQLite (Checkpoint)
    └── Lazy batch writes, indexed queries
        │
L3: Iceberg (Cold Storage)
    └── Time travel, archival
```

**Benefits:**
- 95%+ write cost reduction vs direct SQLite
- Immediate acknowledgment for writes
- Lazy checkpointing for efficiency
- Query pushdown to SQLite

## Data Model

### Core Tables

```sql
-- Key-value state
CREATE TABLE state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)

-- Things (entities)
CREATE TABLE things (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  data TEXT NOT NULL,          -- JSON
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER           -- Soft delete
)

-- Events
CREATE TABLE events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,          -- "Noun.verb"
  data TEXT NOT NULL,          -- JSON
  timestamp INTEGER NOT NULL,
  subject TEXT,                -- Subject thing ID
  object TEXT                  -- Object thing ID
)

-- Schedules
CREATE TABLE schedules (
  cron TEXT PRIMARY KEY,
  handler_id TEXT NOT NULL,
  registered_at INTEGER NOT NULL
)

-- Action log (durable execution)
CREATE TABLE action_log (
  step_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,        -- pending, completed, failed
  result TEXT,                 -- JSON
  error TEXT
)
```

### Thing Data Structure

```typescript
interface ThingData {
  $id: string              // "thing_1234567890_abc123def"
  $type: string            // "Customer"
  $created_at?: number     // Unix timestamp
  $updated_at?: number     // Unix timestamp
  $deleted_at?: number     // Soft delete timestamp
  [key: string]: unknown   // Custom properties
}
```

## RPC Architecture

### Cap'n Web Style

Promise pipelining reduces round-trips:

```typescript
// Traditional - 3 round trips
const user = await stub.getUser('alice')
const orders = await stub.getOrders(user.id)
const total = await stub.summarize(orders)

// Pipelined - 1 round trip
const total = await pipeline(stub)
  .getUser('alice')
  .getOrders()       // Uses result of previous
  .summarize()
  .execute()
```

### Pipeline Execution

```
Client                                    DO
  │                                        │
  │  POST /rpc/pipeline                    │
  │  {pipeline: [step1, step2, step3]}    │
  │────────────────────────────────────────▶│
  │                                        │
  │                                        │ Execute step1
  │                                        │ Execute step2 (with step1 result)
  │                                        │ Execute step3 (with step2 result)
  │                                        │
  │◀────────────────────────────────────────│
  │  {result: finalResult}                 │
```

### WebSocket RPC

Bidirectional RPC for callbacks and subscriptions:

```typescript
// Client
const ws = new WebSocket('wss://tenant.api.dotdo.dev/ws/rpc')
ws.send(JSON.stringify({
  id: '1',
  method: 'subscribe',
  params: ['Customer.created']
}))

// Server pushes events
ws.onmessage = (e) => {
  const { method, params } = JSON.parse(e.data)
  if (method === 'event') {
    console.log('Event received:', params)
  }
}
```

## Security

### CORS Configuration

Environment-based origin allowlist:

```toml
# wrangler.toml
[vars]
ALLOWED_ORIGINS = "https://app.example.com,https://api.example.com"
ENVIRONMENT = "production"
```

### SQL Security

Query validation prevents injection:

```typescript
import { validateSqlQuery, SqlSecurityError } from '@dotdo/core'

// Dangerous patterns are rejected
validateSqlQuery('SELECT * FROM users; DROP TABLE users;')
// Throws: SqlSecurityError("Multiple statements not allowed")

// Safe patterns pass
validateSqlQuery('SELECT * FROM things WHERE type = ?')
// OK
```

### Query Validation

MongoDB-style operators are validated before execution:

```typescript
import { validateWhereClause, QueryValidationError } from '@dotdo/core'

// Valid operators pass
validateWhereClause({ age: { $gt: 18 } })
// { valid: true }

// Invalid operators fail
validateWhereClause({ age: { $invalid: 18 } })
// { valid: false, error: "Unknown operator: $invalid" }
```

## Deployment

### Multi-Tenancy

Each tenant gets an isolated DO instance:

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const tenant = url.hostname.split('.')[0]  // tenant.api.example.com

    // Each tenant has isolated SQLite database
    const id = env.DO.idFromName(tenant)
    const stub = env.DO.get(id)

    return stub.fetch(request)
  }
}
```

### Geographic Distribution

DOs are globally distributed by Cloudflare:

- First access creates DO in nearest region
- Subsequent requests route to existing DO location
- Optional: Use `locationHint` for preferred regions

## Architecture Decision Records

Key decisions are documented in `/docs/architecture/decisions/`:

| ADR | Title | Summary |
|-----|-------|---------|
| [ADR-001](./architecture/decisions/ADR-001-DO-Class-Hierarchy.md) | DO Class Hierarchy | Layered inheritance for progressive enhancement |
| [ADR-002](./architecture/decisions/ADR-002-4-Layer-Storage.md) | 4-Layer Storage | L0-L3 tiered storage for cost optimization |
| [ADR-003](./architecture/decisions/ADR-003-Capn-Web-RPC.md) | Cap'n Web RPC | Promise pipelining and capability tokens |
| [ADR-004](./architecture/decisions/ADR-004-Semantic-Type-System.md) | Semantic Types | Nouns, Verbs, Things, Actions |
| [ADR-005](./architecture/decisions/ADR-005-WorkflowContext-DSL.md) | WorkflowContext DSL | Fluent API for events, scheduling, durability |

## Directory Structure

```
dotdo/
├── core/                    # @dotdo/core package
│   ├── DOCore.ts            # Base DO class
│   ├── modules/             # Extracted RPC modules
│   │   ├── events.ts        # DOCoreEvents
│   │   ├── schedule.ts      # DOCoreSchedule
│   │   └── storage.ts       # DOCoreStorage
│   ├── noun-accessors.ts    # Fluent noun API
│   ├── query-validation.ts  # MongoDB-style operators
│   ├── sql-security.ts      # SQL injection prevention
│   └── index.ts             # Package exports
├── workflow/                # Workflow package
│   ├── workflow-context.ts  # WorkflowContext ($) implementation
│   └── DOWorkflow.ts        # Workflow-enabled DO
├── rpc/                     # RPC infrastructure
│   ├── websocket-rpc.ts     # WebSocket RPC handler
│   └── pipeline-executor.ts # Promise pipelining
├── types/                   # Shared types
│   └── index.ts             # ThingData, Event, etc.
├── docs/                    # Documentation
│   ├── getting-started.md   # Quick start guide
│   ├── api/                 # API reference
│   └── architecture/        # Architecture docs
└── tests/                   # Test suites
```

## See Also

- [Getting Started](./getting-started.md) - Quick start guide
- [API Reference](./api/README.md) - Detailed API documentation
- [Core Concepts](./getting-started/concepts.mdx) - Semantic types and WorkflowContext
