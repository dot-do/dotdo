# Migration Guide: v1 to v2 to v3

This guide covers breaking changes and upgrade paths when migrating between dotdo versions. Each major version represents a significant architectural evolution.

## Table of Contents

1. [Version Overview](#version-overview)
2. [v1 to v2 Breaking Changes](#v1-to-v2-breaking-changes)
3. [v2 to v3 Breaking Changes](#v2-to-v3-breaking-changes)
4. [Package-by-Package Migration](#package-by-package-migration)
5. [Configuration Changes](#configuration-changes)
6. [Step-by-Step Upgrade Guide](#step-by-step-upgrade-guide)
7. [API Migration Reference](#api-migration-reference)
8. [Common Migration Issues and Solutions](#common-migration-issues-and-solutions)

---

## Version Overview

| Version | Architecture | Package Structure | Main Entry |
|---------|-------------|-------------------|------------|
| **v1** | Monolithic with mixins | Single package with `objects/`, `types/`, `workflows/` | `api/index.ts` |
| **v2** | Modular DO hierarchy | Workspace with `core/`, `storage/`, `workflow/`, `semantic/` | `objects/index.ts` |
| **v3** | Monorepo with focused packages | Turbo workspace with `@dotdo/do`, `@dotdo/db`, `@dotdo/rpc`, `@dotdo/api` | `do/index.ts` |

### Key Architectural Shifts

**v1: Monolithic Architecture**
- Single `DO` class with all features baked in
- Tree-shakeable via mixins: `DOTiny`, `DOBase`, `DOFull`
- Unified storage with Pipeline-as-WAL
- 90+ compat SDKs bundled
- Agent providers directly in `api/agents/`

**v2: Modular DO Hierarchy**
- Separate DO classes: `DOCore`, `DOStorage`, `DOWorkflow`, `DOSemantic`, `DOFull`
- Independent packages: `@dotdo/core`, `@dotdo/rpc`
- Cap'n Web RPC with promise pipelining
- pnpm workspace structure
- MCP server as separate DO class

**v3: Clean Monorepo Architecture**
- Focused workspace packages: `@dotdo/do`, `@dotdo/db`, `@dotdo/rpc`, `@dotdo/ai`, `@dotdo/api`, `@dotdo/auth`
- Single `DO` class with composable mixins (back to simplicity)
- Turbo for build orchestration
- Primitives moved to git submodule at `primitives/`
- Integrations registry for third-party services
- Audit logging built-in

---

## v1 to v2 Breaking Changes

### 1. DO Class Hierarchy Changed

**v1:**
```typescript
// Tree-shakeable imports with size annotations
import { DO } from 'dotdo'           // DOFull + mixins (~120KB+)
import { DO } from 'dotdo/full'      // DOFull (~120KB)
import { DO } from 'dotdo/base'      // DOBase (~80KB)
import { DO } from 'dotdo/tiny'      // DOTiny (~15KB)

class MyDO extends DO {
  async onStart() {
    this.$.on.Customer.created(handler)
  }
}
```

**v2:**
```typescript
// Separate classes, not tree-shaking
import { DOCore } from 'dotdo'       // Base class (~5KB)
import { DOFull } from 'dotdo'       // Full features
import { DOStorage } from 'dotdo'    // Storage-focused
import { DOWorkflow } from 'dotdo'   // Workflow-focused
import { DOSemantic } from 'dotdo'   // Semantic search

class MyDO extends DOCore {
  async onStart() {
    this.$.on.Customer.created(handler)
  }
}
```

### 2. Package Imports Changed

**v1:**
```typescript
import { Thing, Event, Relationship } from 'dotdo/types'
import { createRPCClient } from 'dotdo/packages/rpc'
import { ai } from 'dotdo/ai'
```

**v2:**
```typescript
import { ThingData, Event, Thing } from 'dotdo'
import { createRPCClient } from '@dotdo/core'
import { ai, is, list } from 'dotdo/ai'
```

### 3. RPC Client API Changed

**v1:**
```typescript
// From packages/rpc
import { createClient } from 'dotdo/packages/rpc'

const client = createClient(stub, { timeout: 5000 })
const result = await client.things.get('id')
```

**v2:**
```typescript
// From core
import { createRPCClient, pipeline } from '@dotdo/core'

const client = createRPCClient<MyDO>({ target: stub })
const result = await client.things.get('id')

// New: Promise pipelining
const orders = await pipeline(client)
  .Customer.get(customerId)
  .getOrders()
```

### 4. Storage Layer Restructured

**v1:**
```typescript
// objects/unified-storage/
import { UnifiedStoreDO } from 'dotdo/objects/unified-storage'

const store = new UnifiedStoreDO(state, env, {
  namespace: 'tenant-123',
  checkpointInterval: 5000,
  dirtyCountThreshold: 100,
})
```

**v2:**
```typescript
// storage/ module
import { DOStorageClass } from 'dotdo'

// Storage is built into DOCore with methods:
this.get(key)
this.set(key, value)
this.delete(key)
this.list({ prefix, limit })
```

### 5. Wrangler Configuration Changed

**v1 wrangler.jsonc:**
```jsonc
{
  "main": "api/index.ts",
  "durable_objects": {
    "bindings": [
      { "name": "DO", "class_name": "DO" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["DO"] }
  ]
}
```

**v2 wrangler.jsonc:**
```jsonc
{
  "main": "objects/index.ts",
  "durable_objects": {
    "bindings": [
      { "name": "DOCore", "class_name": "DOCore" },
      { "name": "DOFull", "class_name": "DOFull" },
      { "name": "DOStorage", "class_name": "DOStorageClass" },
      { "name": "DOWorkflow", "class_name": "DOWorkflowClass" },
      { "name": "DOSemantic", "class_name": "DOSemantic" },
      { "name": "MCP", "class_name": "McpServer" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["DOCore"] },
    { "tag": "v2", "new_classes": ["McpServer"] },
    { "tag": "v3", "new_sqlite_classes": ["DOSemantic", "DOStorageClass", "DOWorkflowClass", "DOFull"] }
  ]
}
```

### 6. WorkflowContext ($) API Mostly Unchanged

The `$` context API remained consistent between v1 and v2:

```typescript
// Same in both versions
$.on.Customer.signup(handler)
$.every.Monday.at('9am')(handler)
$.send(event)
$.do(action)
$.try(action)
await $.Customer(id).notify()
```

---

## v2 to v3 Breaking Changes

### 1. Package Structure Completely Reorganized

**v2:**
```
dotdo/
├── core/         # DOCore, RPC, query validation
├── storage/      # DOStorage
├── workflow/     # DOWorkflow, WorkflowContext
├── semantic/     # DOSemantic
├── objects/      # DOFull
├── rpc/          # RPC infrastructure
└── types/        # Shared types
```

**v3:**
```
dotdo/
├── do/           # @dotdo/do - THE Durable Object (DO = Durable Object = Digital Object)
├── db/           # @dotdo/db - Abstract storage layer
├── rpc/          # @dotdo/rpc - Cap'n Web RPC
├── api/          # @dotdo/api - Hono worker with HATEOAS
├── ai/           # @dotdo/ai - AI routing with template literals
├── auth/         # @dotdo/auth - JWT auth with jose
├── mcp/          # @dotdo/mcp - Model Context Protocol
├── app/          # @dotdo/app - TanStack Start frontend
├── integrations/ # @dotdo/integrations - Third-party service integrations
└── primitives/   # Git submodule -> primitives.org.ai
```

### 2. Single DO Class Replaces Hierarchy

**v2:**
```typescript
import { DOCore, DOFull, DOStorage } from 'dotdo'

// Choose your base class
class MyDO extends DOCore { }
class FullFeatureDO extends DOFull { }
```

**v3:**
```typescript
import { DO } from '@dotdo/do'

// Single base class - all features included
class MyDO extends DO {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env)

    // Register event handlers
    this.$.on.Customer.signup(async (event) => {
      await this.$.send({ type: 'welcome-email', payload: event.payload })
    })

    // Schedule tasks
    this.$.every.day.at('9am')(async () => {
      await this.generateDailyReport()
    })
  }

  // Custom routes via override
  protected routes(app: Hono): void {
    app.get('/customers', async (c) => {
      const customers = await this.things.list({ type: 'Customer' })
      return c.json(customers)
    })
  }
}
```

### 3. Import Paths Changed

**v2:**
```typescript
import { DOCore, createRPCClient, createWorkflowContext } from 'dotdo'
import { ThingData, Event, Thing } from 'dotdo'
import { McpServer } from 'dotdo'
```

**v3:**
```typescript
import { DO, EntityManager, WebSocketManager } from '@dotdo/do'
import { ThingsStore, EventsStore, RelationshipsStore, Thing } from '@dotdo/db'
import { RPCError, NotFoundError, InternalError } from '@dotdo/rpc'
import { McpServer } from '@dotdo/mcp'
import { ai, list, extract, is } from '@dotdo/ai'
import { IntegrationRegistry } from '@dotdo/integrations'
```

### 4. Entity Management API Enhanced

**v2 (DOCore):**
```typescript
class MyDO extends DOCore {
  async getCustomer(id: string) {
    return this.things.get(id)
  }

  async createCustomer(data: ThingData) {
    return this.things.create({ $type: 'Customer', ...data })
  }
}
```

**v3 (DO with EntityManager):**
```typescript
import { DO } from '@dotdo/do'

class MyDO extends DO {
  // EntityManager is built-in with full stores
  async getCustomer(id: string) {
    return this.things.get(id)
  }

  async createCustomer(data: object) {
    return this.things.create({ $type: 'Customer', ...data })
  }

  // NEW: Bulk operations
  async createManyCustomers(customers: object[]) {
    return this.things.bulkCreate(
      customers.map(c => ({ $type: 'Customer', ...c }))
    )
  }

  // NEW: Query builder for complex queries
  async findActiveCustomers() {
    return this.query()
      .where({ $type: 'Customer', status: 'active' })
      .orderBy('$createdAt', 'desc')
      .limit(10)
      .execute()
  }
}
```

### 5. RPC Error Types Expanded

**v2:**
```typescript
import { RPCError, RPCErrorCodes } from '@dotdo/core'

throw new RPCError(RPCErrorCodes.NOT_FOUND, 'Customer not found')
```

**v3:**
```typescript
import { RPCError, NotFoundError, ValidationError, InternalError, AuthenticationError } from '@dotdo/rpc'

// Specialized error classes with HTTP status codes
throw new NotFoundError('Customer not found')        // 404
throw new ValidationError('Invalid email format')   // 400
throw new AuthenticationError('Token expired')      // 401
throw new InternalError('Database connection lost') // 500

// With correlation IDs for distributed tracing
const error = new NotFoundError('Not found', { correlationId: 'abc-123' })

// Errors serialize properly for RPC responses
const json = error.toJSON()
// { code: 'NOT_FOUND', message: 'Not found', httpStatus: 404, correlationId: 'abc-123' }
```

### 6. Audit Logging Added (New in v3)

**v3 Only:**
```typescript
import { DO, type AuditContext } from '@dotdo/do'

class MyDO extends DO {
  async handleRequest(request: Request) {
    // Extract user from JWT and set audit context
    const userId = await this.extractUserId(request)
    this.setAuditContext({
      actor: userId,
      correlationId: request.headers.get('X-Correlation-ID')
    })

    // All entity operations are now automatically logged
    const customer = await this.things.create({
      $type: 'Customer',
      name: 'Alice',
      email: 'alice@example.com'
    })
    // Audit log entry created: { action: 'create', resource: 'Customer', resourceId: '...', actor: userId }

    // Query audit logs for compliance
    const logs = await this.auditLogs.query({
      actor: userId,
      resource: 'Customer',
      limit: 100
    })

    return new Response(JSON.stringify(logs))
  }
}
```

### 7. Integration Registry Added (New in v3)

**v3 Only:**
```typescript
import { DO } from '@dotdo/do'
import { IntegrationRegistry } from '@dotdo/integrations'

class MyDO extends DO {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env)

    // Register third-party integrations
    this.integrations.register('stripe', {
      apiKey: env.STRIPE_API_KEY,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET
    })

    this.integrations.register('sendgrid', {
      apiKey: env.SENDGRID_API_KEY
    })
  }

  async chargeCustomer(customerId: string, amount: number) {
    const stripe = this.integrations.get('stripe')
    return stripe.createPaymentIntent({ amount, customer: customerId })
  }

  async sendEmail(to: string, subject: string, body: string) {
    const sendgrid = this.integrations.get('sendgrid')
    return sendgrid.send({ to, subject, body })
  }
}
```

### 8. WebSocket Hibernation Support (Enhanced in v3)

**v3:**
```typescript
import { DO, type DOOptions } from '@dotdo/do'

class ChatDO extends DO {
  constructor(state: DurableObjectState, env: Env) {
    // Enable hibernation with reconnection protocol
    const options: DOOptions = {
      hibernation: {
        config: {
          maxConnectionsPerDO: 1000,
          heartbeatIntervalMs: 30000
        },
        reconnection: {
          enabled: true,
          maxReconnectAttempts: 5,
          reconnectIntervalMs: 1000
        }
      }
    }
    super(state, env, options)
  }

  // WebSocket handlers
  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    const data = JSON.parse(message as string)

    // Broadcast to all connected clients
    this.ws.broadcast(JSON.stringify({
      type: 'chat',
      data: data,
      timestamp: Date.now()
    }))
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    this.ws.cleanupWebSocket(ws)
  }
}
```

### 9. Build System Changed

**v2:**
```bash
# pnpm workspace commands
pnpm -r build
pnpm -r --parallel dev
vitest
```

**v3:**
```bash
# Turbo-powered commands
npm run dev          # turbo dev
npm run build        # turbo build
npm run test         # vitest (runs all tests)
npm run test:do      # vitest --config do/vitest.config.ts
npm run test:db      # vitest --config db/vitest.config.ts
npm run typecheck    # tsc --noEmit
```

### 10. Typed WorkflowContext (New in v3)

**v3 Only - Full Type Inference:**
```typescript
import { DO, createTypedContext, type TypedWorkflowContext } from '@dotdo/do'

// Define your DO interfaces
interface CustomerDO {
  getProfile(): Promise<{ name: string; email: string }>
  notify(params: { message: string }): Promise<{ delivered: boolean }>
}

interface OrderDO {
  ship(): Promise<{ status: string }>
  getItems(): Promise<string[]>
}

// Define DO bindings map
interface DOBindings {
  Customer: CustomerDO
  Order: OrderDO
}

// Define event schemas
interface EventSchemas {
  'Customer.signup': { customerId: string; email: string; plan: string }
  'Order.placed': { orderId: string; items: string[]; total: number }
}

class MyDO extends DO {
  protected $!: TypedWorkflowContext<DOBindings, EventSchemas>

  constructor(state: DurableObjectState, env: Env) {
    super(state, env)

    // Recreate $ with full type inference
    this.$ = createTypedContext<DOBindings, EventSchemas>(state, env)

    // Now get full type inference!
    this.$.on.Customer.signup((event) => {
      // event.payload is typed as { customerId: string; email: string; plan: string }
      console.log(event.payload.email)
    })
  }

  async handleOrder(orderId: string) {
    // Full type inference for cross-DO RPC
    const order = this.$.Order(orderId)
    const items = await order.getItems()  // Typed as string[]
    const result = await order.ship()     // Typed as { status: string }
  }
}
```

---

## Package-by-Package Migration

### @dotdo/do (from DOCore/DOFull)

| v2 | v3 | Notes |
|----|-----|-------|
| `DOCore` | `DO` | Single class replaces hierarchy |
| `DOFull` | `DO` | All features included by default |
| `DOStorage` | `DO` with `EntityManager` | Storage now via things/events/relationships |
| `DOWorkflow` | `DO` with `WorkflowContext` | $ context built-in |
| `DOSemantic` | Removed | Use @dotdo/ai for semantic features |
| `createWorkflowContext()` | `createContext()` | Same API, new import path |

**Before (v2):**
```typescript
import { DOCore, createWorkflowContext } from 'dotdo'

export class MyDO extends DOCore {
  private $: WorkflowContext

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.$ = createWorkflowContext({ stubResolver: this.getStub.bind(this) })
  }
}
```

**After (v3):**
```typescript
import { DO } from '@dotdo/do'

export class MyDO extends DO {
  // $ is already initialized in DO constructor

  constructor(state: DurableObjectState, env: Env) {
    super(state, env)

    // Use this.$ directly
    this.$.on.Customer.signup(async (event) => {
      // handle event
    })
  }
}
```

### @dotdo/db (from dotdo/types + core)

| v2 | v3 | Notes |
|----|-----|-------|
| `ThingData` | `Thing` | Now includes $id, $type, $createdAt, $updatedAt |
| `Event` | `Event` | Same structure |
| `createThingsStore()` | `createThingsStore()` | Same API |
| N/A | `createSQLiteThingsStore()` | New SQLite-backed store |
| N/A | `SQLiteAdapter` | New adapter for DO SQLite storage |

**Before (v2):**
```typescript
import { ThingData, Event, Thing } from 'dotdo'
```

**After (v3):**
```typescript
import {
  Thing,
  Event,
  Relationship,
  ThingsStore,
  EventsStore,
  RelationshipsStore,
  createThingsStore,
  createSQLiteThingsStore,
  SQLiteAdapter
} from '@dotdo/db'
```

### @dotdo/rpc (from @dotdo/core)

| v2 | v3 | Notes |
|----|-----|-------|
| `RPCError` | `RPCError` | Base class unchanged |
| `RPCErrorCodes` | Removed | Use specific error classes instead |
| `createRPCClient()` | `createRPCClient()` | Same API |
| `pipeline()` | `createPipeline()` | Renamed for clarity |
| N/A | `NotFoundError` | New: 404 errors |
| N/A | `ValidationError` | New: 400 errors |
| N/A | `AuthenticationError` | New: 401 errors |
| N/A | `InternalError` | New: 500 errors |

**Before (v2):**
```typescript
import { RPCError, RPCErrorCodes, createRPCClient, pipeline } from '@dotdo/core'

throw new RPCError(RPCErrorCodes.NOT_FOUND, 'Customer not found')
```

**After (v3):**
```typescript
import {
  RPCError,
  NotFoundError,
  ValidationError,
  createRPCClient,
  createPipeline
} from '@dotdo/rpc'

throw new NotFoundError('Customer not found')
throw new ValidationError('Invalid email', { field: 'email' })
```

### @dotdo/ai (from dotdo/ai)

| v2 | v3 | Notes |
|----|-----|-------|
| `ai` template literal | `ai` template literal | Same API |
| `is()` | `is()` | Same API |
| `list()` | `list()` | Same API |
| `extract()` | `extract()` | Same API |
| N/A | `research()` | New: web research with citations |
| N/A | `FallbackError` | New: multi-provider fallback |
| N/A | `BatchQueue` | New: batch processing for AI ops |

**Before (v2):**
```typescript
import { ai, is, list, extract } from 'dotdo/ai'
```

**After (v3):**
```typescript
import {
  ai,
  is,
  list,
  extract,
  research,
  createFallback,
  BatchQueue
} from '@dotdo/ai'
```

---

## Configuration Changes

### Package.json

**v1:**
```json
{
  "name": "dotdo",
  "version": "0.1.1",
  "workspaces": [
    "packages/*",
    "core",
    "ai/primitives/packages/*"
  ],
  "main": "./dist/do/index.js"
}
```

**v2:**
```json
{
  "name": "dotdo-workspace",
  "version": "2.0.0",
  "private": true,
  "scripts": {
    "build": "pnpm -r build",
    "dev": "pnpm -r --parallel dev"
  }
}
```

**v3:**
```json
{
  "name": "dotdo-monorepo",
  "private": true,
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "test": "vitest"
  },
  "devDependencies": {
    "turbo": "^2.4.0"
  }
}
```

### TypeScript Configuration

**v3 tsconfig.json paths:**
```json
{
  "compilerOptions": {
    "paths": {
      "@dotdo/do": ["./do/index.ts"],
      "@dotdo/db": ["./db/index.ts"],
      "@dotdo/rpc": ["./rpc/index.ts"],
      "@dotdo/api": ["./api/index.ts"],
      "@dotdo/ai": ["./ai/index.ts"],
      "@dotdo/auth": ["./auth/index.ts"],
      "@dotdo/mcp": ["./mcp/index.ts"],
      "@dotdo/integrations": ["./integrations/index.ts"],
      "@dotdo/utils": ["./utils/index.ts"]
    }
  }
}
```

### Wrangler Configuration

**v3 wrangler.jsonc:**
```jsonc
{
  "name": "my-app",
  "main": "api/index.ts",
  "compatibility_date": "2024-01-01",
  "durable_objects": {
    "bindings": [
      { "name": "DO", "class_name": "DO" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["DO"] }
  ],
  // Recommended settings
  "observability": {
    "enabled": true
  }
}
```

---

## Step-by-Step Upgrade Guide

### Upgrading from v1 to v2

1. **Update package.json dependencies:**
   ```bash
   npm install dotdo@2
   ```

2. **Update DO class imports:**
   ```typescript
   // Before (v1)
   import { DO } from 'dotdo'

   // After (v2)
   import { DOCore } from 'dotdo'  // or DOFull for all features
   ```

3. **Update wrangler.jsonc bindings:**
   - Add new DO class bindings for each class you use
   - Add migration tags for new classes

4. **Update RPC client usage:**
   ```typescript
   // Before (v1)
   import { createClient } from 'dotdo/packages/rpc'

   // After (v2)
   import { createRPCClient } from '@dotdo/core'
   ```

5. **Run tests and fix type errors:**
   ```bash
   npm run typecheck
   npm test
   ```

### Upgrading from v2 to v3

1. **Update package.json structure:**
   ```bash
   npm install dotdo@3
   # Or install individual packages:
   npm install @dotdo/do @dotdo/db @dotdo/rpc
   ```

2. **Update imports to new package structure:**
   ```typescript
   // Before (v2)
   import { DOCore, createRPCClient } from 'dotdo'

   // After (v3)
   import { DO } from '@dotdo/do'
   import { createRPCClient } from '@dotdo/rpc'
   ```

3. **Replace DO class hierarchy:**
   ```typescript
   // Before (v2)
   import { DOFull } from 'dotdo'
   class MyDO extends DOFull { }

   // After (v3)
   import { DO } from '@dotdo/do'
   class MyDO extends DO { }
   ```

4. **Update error handling:**
   ```typescript
   // Before (v2)
   import { RPCError } from '@dotdo/core'

   // After (v3)
   import { RPCError, NotFoundError, ValidationError } from '@dotdo/rpc'
   ```

5. **Update storage access:**
   ```typescript
   // Before (v2) - separate stores
   this.things.create(data)
   this.events.emit(event)

   // After (v3) - same API, but now with bulk operations
   this.things.create(data)
   this.things.bulkCreate([data1, data2])
   this.events.emit(event)
   ```

6. **Update build scripts:**
   ```json
   {
     "scripts": {
       "dev": "turbo dev",
       "build": "turbo build",
       "test": "vitest"
     }
   }
   ```

7. **Add audit logging (optional):**
   ```typescript
   // New v3 feature
   this.setAuditContext({ actor: userId, correlationId })
   ```

8. **Run migration tests:**
   ```bash
   npm run typecheck
   npm run test:run
   ```

---

## API Migration Reference

### DO Class Methods

| v1 | v2 | v3 | Notes |
|----|----|----|-------|
| `this.$` | `this.$` | `this.$` | WorkflowContext |
| `this.things.get()` | `this.things.get()` | `this.things.get()` | Thing CRUD |
| `this.things.create()` | `this.things.create()` | `this.things.create()` | |
| N/A | N/A | `this.things.bulkCreate()` | New bulk operations |
| N/A | N/A | `this.things.bulkUpdate()` | |
| N/A | N/A | `this.things.bulkDelete()` | |
| `this.events.emit()` | `this.events.emit()` | `this.events.emit()` | Event emission |
| `this.relationships.add()` | `this.relationships.add()` | `this.relationships.add()` | Relationships |
| N/A | N/A | `this.auditLogs.query()` | New audit logging |
| N/A | N/A | `this.integrations.register()` | New integrations |
| N/A | N/A | `this.query()` | New QueryBuilder |
| N/A | N/A | `this.ws.broadcast()` | New WebSocket manager |

### WorkflowContext ($) Methods

| Method | v1 | v2 | v3 |
|--------|----|----|-----|
| Event handler | `$.on.Noun.verb()` | `$.on.Noun.verb()` | `$.on.Noun.verb()` |
| Fire-and-forget | `$.send()` | `$.send()` | `$.send()` |
| Single attempt | `$.try()` | `$.try()` | `$.try()` |
| Durable execution | `$.do()` | `$.do()` | `$.do()` |
| Scheduling | `$.every.day.at()` | `$.every.day.at()` | `$.every.day.at()` |
| Cross-DO RPC | `$.Noun(id).method()` | `$.Noun(id).method()` | `$.Noun(id).method()` |

### Import Paths

| Concept | v1 | v2 | v3 |
|---------|----|----|-----|
| Main DO | `dotdo` | `dotdo` | `@dotdo/do` |
| RPC Client | `dotdo/packages/rpc` | `@dotdo/core` | `@dotdo/rpc` |
| Types | `dotdo/types` | `dotdo` | `@dotdo/db` |
| AI | `dotdo/ai` | `dotdo/ai` | `@dotdo/ai` |
| Auth | `dotdo/auth` | N/A | `@dotdo/auth` |
| MCP | N/A | `dotdo` | `@dotdo/mcp` |
| Integrations | N/A | N/A | `@dotdo/integrations` |
| Utils | `dotdo/lib` | `dotdo/lib` | `@dotdo/utils` |

---

## Common Migration Issues and Solutions

### 1. Type Errors After Upgrade

**Symptom:** TypeScript errors about missing properties or incompatible types.

**Solution:**
- Ensure all imports are updated to new paths
- Update `@cloudflare/workers-types` to latest version
- Check TypeScript paths in tsconfig.json are correct:
```json
{
  "compilerOptions": {
    "paths": {
      "@dotdo/*": ["./*"]
    }
  }
}
```

### 2. Wrangler Migration Errors

**Symptom:** Error about DO class not found or migration mismatch.

**Solution:**
When changing DO class names, add new migration tags:
```jsonc
{
  "migrations": [
    { "tag": "existing", "new_sqlite_classes": ["OldDO"] },
    { "tag": "v3-upgrade", "renamed_classes": [
      { "from": "DOCore", "to": "DO" }
    ]}
  ]
}
```

### 3. RPC Compatibility Issues

**Symptom:** RPC calls fail between v2 and v3 services.

**Solution:**
v3 RPC is backward compatible with v2 but includes new features. Ensure:
- Both services use compatible RPC versions
- Error handling accounts for new error types
- Correlation IDs are passed through if using distributed tracing

### 4. Entity Store Type Mismatches

**Symptom:** Type errors when using things/events/relationships stores.

**Solution:**
The v3 stores use branded types for IDs:
```typescript
// Before (v2)
const thing = await this.things.get('some-id')

// After (v3) - same API, but IDs may be branded
import { ThingId, generateThingId } from '@dotdo/db'
const thing = await this.things.get('some-id')
// Returns Thing | null with proper typing
```

### 5. WorkflowContext Not Typed

**Symptom:** `$.Customer(id).method()` doesn't have type inference.

**Solution:**
Use the typed context factory:
```typescript
import { createTypedContext, type TypedWorkflowContext } from '@dotdo/do'

interface DOBindings {
  Customer: CustomerDO
}

class MyDO extends DO {
  protected $!: TypedWorkflowContext<DOBindings>

  constructor(state: DurableObjectState, env: Env) {
    super(state, env)
    this.$ = createTypedContext<DOBindings>(state, env)
  }
}
```

### 6. Test Migration

**Symptom:** Tests fail after migration.

**Solution:**
Update test imports and bindings:
```typescript
// Before (v2)
import { env } from 'cloudflare:test'
const stub = env.DOCore.get(env.DOCore.idFromName('test'))

// After (v3)
import { env } from 'cloudflare:test'
const stub = env.DO.get(env.DO.idFromName('test'))
```

Also update vitest config if needed:
```typescript
// vitest.config.ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' }
      }
    }
  }
})
```

### 7. Hibernation Wake-Up Issues

**Symptom:** Instance variables reset unexpectedly.

**Solution:**
Remember that DO instance variables are NOT persisted across hibernation:
```typescript
class MyDO extends DO {
  private cache = new Map()  // Lost on hibernation!

  // Use storage for persistent state
  async getPersistedValue(key: string) {
    return this.things.get(key)  // Persisted in SQLite
  }
}
```

### 8. Missing Primitives Submodule

**Symptom:** Imports from `ai-functions` or `ai-providers` fail.

**Solution:**
Initialize the git submodule:
```bash
npm run submodule:init
# or
git submodule update --init --recursive
```

### 9. CORS Issues in v3

**Symptom:** CORS errors from API requests.

**Solution:**
CORS is enabled by default in v3 DO. To customize:
```typescript
class MyDO extends DO {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env, { cors: false })  // Disable default CORS

    // Add custom CORS in routes
    this.app.use('/*', cors({
      origin: ['https://myapp.com'],
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE']
    }))
  }
}
```

### 10. Alarm Scheduling Issues

**Symptom:** Scheduled tasks don't run after migration.

**Solution:**
v3 uses alarm-based scheduling. Ensure:
1. The DO has alarm capability in wrangler.jsonc
2. Schedules are registered in constructor:
```typescript
class MyDO extends DO {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env)

    // Register schedules
    this.$.every.day.at('9am')(async () => {
      await this.dailyTask()
    })
  }

  // Alarm handler is built into DO base class
}
```

---

## Further Reading

- [Getting Started Guide](/docs/GETTING_STARTED.md)
- [Troubleshooting Guide](/docs/TROUBLESHOOTING.md)
- [Node.js Migration Guide](/docs/MIGRATION.md) - For migrating from Node.js/Express
- [CLAUDE.md](/CLAUDE.md) - Project guidance and architecture overview
- [Architecture Overview](/ARCHITECTURE.md) - Detailed v3 architecture documentation
