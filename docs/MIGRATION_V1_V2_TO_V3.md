# Migration Guide: v1/v2 to v3

This guide covers breaking changes, API migrations, and upgrade paths when migrating from dotdo v1 or v2 to v3. The v3 release is a fresh rewrite with a cleaner monorepo architecture.

## Table of Contents

1. [Version Overview](#version-overview)
2. [Breaking Changes](#breaking-changes)
3. [API Changes and Equivalents](#api-changes-and-equivalents)
4. [New v3 Patterns](#new-v3-patterns)
5. [Step-by-Step Migration](#step-by-step-migration)
6. [Common Migration Issues](#common-migration-issues)
7. [Compatibility Notes](#compatibility-notes)

---

## Version Overview

| Version | Architecture | Package Structure | Main Entry |
|---------|-------------|-------------------|------------|
| **v1** | Monolithic with tree-shaking | Single package with `objects/`, `types/`, `workflows/` | `api/index.ts` |
| **v2** | Modular DO hierarchy | Workspace with `core/`, `storage/`, `workflow/`, `semantic/` | `objects/index.ts` |
| **v3** | Monorepo with focused packages | Turbo workspace with `@dotdo/do`, `@dotdo/db`, `@dotdo/rpc`, `@dotdo/api` | `do/index.ts` |

### Key Architectural Shifts

**v1: Monolithic with Tree-Shaking**
- Single `DO` class with all features baked in
- Tree-shakeable via size tiers: `DOTiny` (~15KB), `DOBase` (~80KB), `DOFull` (~120KB)
- Unified storage with Pipeline-as-WAL
- Agent providers directly in `api/agents/`

**v2: Modular DO Hierarchy**
- Separate DO classes: `DOCore`, `DOStorage`, `DOWorkflow`, `DOSemantic`, `DOFull`
- Independent packages: `@dotdo/core`, `@dotdo/rpc`
- Cap'n Web RPC with promise pipelining
- pnpm workspace structure

**v3: Clean Monorepo Architecture**
- Focused workspace packages: `@dotdo/do`, `@dotdo/db`, `@dotdo/rpc`, `@dotdo/ai`, `@dotdo/api`, `@dotdo/auth`
- Single `DO` class with **composable mixins** for flexibility
- Turbo for build orchestration
- **Typed WorkflowContext** with full type inference
- Primitives moved to git submodule at `primitives/`
- Integration registry for third-party services
- Built-in audit logging

---

## Breaking Changes

### 1. DO Class Hierarchy Replaced with Single Class + Mixins

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

class MyDO extends DOCore {
  async onStart() {
    this.$.on.Customer.created(handler)
  }
}
```

**v3:**
```typescript
// Single base class with all features
import { DO } from '@dotdo/do'

class MyDO extends DO {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env)

    // WorkflowContext ($) is ready in constructor
    this.$.on.Customer.created(async (event) => {
      await this.$.send({ type: 'welcome-email', payload: event.payload })
    })
  }
}

// OR use composable mixins for custom combinations
import { WithStorage, WithWebSocket, WithRPC, WithAuth } from '@dotdo/do/mixins'

class CustomDO extends WithAuth(
  WithRPC(
    WithWebSocket(
      WithStorage(BaseDO)
    )
  ),
  { secret: env.JWT_SECRET }
) {
  // Has: this.things, this.events, this.relationships, this.ws, this.getDOStub()
}
```

### 2. Package Imports Changed

**v1/v2:**
```typescript
import { Thing, Event, Relationship } from 'dotdo/types'
import { createRPCClient } from 'dotdo/packages/rpc'  // v1
import { createRPCClient } from '@dotdo/core'          // v2
import { ai } from 'dotdo/ai'
```

**v3:**
```typescript
import { DO, createContext, createTypedContext } from '@dotdo/do'
import { ThingsStore, EventsStore, RelationshipsStore, Thing } from '@dotdo/db'
import { createRPCClient, NotFoundError, ValidationError } from '@dotdo/rpc'
import { ai, list, extract, is } from '@dotdo/ai'
```

### 3. RPC Error Handling Changed

**v1/v2:**
```typescript
import { RPCError, RPCErrorCodes } from '@dotdo/core'

throw new RPCError(RPCErrorCodes.NOT_FOUND, 'Customer not found')
```

**v3:**
```typescript
import { RPCError, NotFoundError, ValidationError, AuthenticationError, InternalError } from '@dotdo/rpc'

// Specialized error classes with HTTP status codes
throw new NotFoundError('Customer not found')        // 404
throw new ValidationError('Invalid email format')   // 400
throw new AuthenticationError('Token expired')      // 401
throw new InternalError('Database connection lost') // 500

// With correlation IDs for distributed tracing
const error = new NotFoundError('Not found', { correlationId: 'abc-123' })
```

### 4. Wrangler Configuration Simplified

**v1/v2:**
```jsonc
{
  "main": "objects/index.ts",
  "durable_objects": {
    "bindings": [
      { "name": "DOCore", "class_name": "DOCore" },
      { "name": "DOFull", "class_name": "DOFull" },
      { "name": "DOStorage", "class_name": "DOStorageClass" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["DOCore"] },
    { "tag": "v2", "new_classes": ["McpServer"] }
  ]
}
```

**v3:**
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

---

## API Changes and Equivalents

### DO Class Methods

| v1 | v2 | v3 | Notes |
|----|----|----|-------|
| `this.$` | `this.$` | `this.$` | WorkflowContext (unchanged) |
| `this.things.get()` | `this.things.get()` | `this.things.get()` | Thing CRUD (unchanged) |
| `this.things.create()` | `this.things.create()` | `this.things.create()` | |
| N/A | N/A | `this.things.bulkCreate()` | **New** bulk operations |
| N/A | N/A | `this.things.bulkUpdate()` | |
| N/A | N/A | `this.things.bulkDelete()` | |
| `this.events.emit()` | `this.events.emit()` | `this.events.emit()` | Event emission (unchanged) |
| `this.relationships.add()` | `this.relationships.add()` | `this.relationships.add()` | Relationships (unchanged) |
| N/A | N/A | `this.auditLogs.query()` | **New** audit logging |
| N/A | N/A | `this.integrations.register()` | **New** integrations |
| N/A | N/A | `this.query()` | **New** QueryBuilder |
| N/A | N/A | `this.ws.broadcast()` | **New** WebSocket manager |

### WorkflowContext ($) Methods (Unchanged)

The `$` context API remained consistent across all versions:

```typescript
// Same in v1, v2, and v3
$.on.Customer.signup(handler)           // Event handlers
$.every.Monday.at('9am')(handler)       // Scheduling
$.send(event)                            // Fire-and-forget
$.do(action)                            // Durable execution
$.try(action)                           // Single attempt
await $.Customer(id).notify()           // Cross-DO RPC
```

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

---

## New v3 Patterns

### Composable Mixins

v3 introduces a powerful mixin system for composing DO capabilities:

```typescript
import { WithStorage, WithWebSocket, WithRPC, WithAuth } from '@dotdo/do/mixins'

// Define your base class
class BaseDO implements DurableObject {
  constructor(protected state: DurableObjectState, protected env: Env) {}
  async fetch(request: Request): Promise<Response> {
    return new Response('OK')
  }
}

// Compose capabilities
class MyDO extends WithAuth(
  WithRPC(
    WithWebSocket(
      WithStorage(BaseDO)
    )
  ),
  { secret: 'my-jwt-secret' }
) {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env)
  }

  // Now you have:
  // - this.things, this.events, this.relationships (from Storage)
  // - this.ws (from WebSocket)
  // - this.getDOStub() (from RPC)
  // - this.validateCaller(), this.canAccess() (from Auth)
}

// Or compose selectively for minimal overhead
class MinimalDO extends WithStorage(BaseDO) {
  // Just storage, no WebSocket/RPC/Auth overhead
}
```

#### Available Mixins

| Mixin | Provides | When to Use |
|-------|----------|-------------|
| `WithStorage` | `this.things`, `this.events`, `this.relationships` | Entity storage |
| `WithWebSocket` | `this.ws` (WebSocketManager) | Real-time communication |
| `WithRPC` | `this.getDOStub()`, RPC handling | Cross-DO communication |
| `WithAuth` | `this.validateCaller()`, JWT validation | Authentication/authorization |

### Typed WorkflowContext

v3 provides full type inference for cross-DO RPC and event handlers:

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

    // Create typed context
    this.$ = createTypedContext<DOBindings, EventSchemas>(state, env)

    // Full type inference for event handlers
    this.$.on.Customer.signup((event) => {
      // event.payload is typed as { customerId: string; email: string; plan: string }
      console.log(event.payload.email)
    })

    this.$.on.Order.placed((event) => {
      // event.payload is typed as { orderId: string; items: string[]; total: number }
      console.log(event.payload.total)
    })
  }

  async handleOrder(orderId: string) {
    // Full type inference for cross-DO RPC
    const order = this.$.Order(orderId)
    const items = await order.getItems()  // Typed as string[]
    const result = await order.ship()     // Typed as { status: string }
    return result
  }

  async notifyCustomer(customerId: string, message: string) {
    const customer = this.$.Customer(customerId)
    const profile = await customer.getProfile()  // Typed as { name: string; email: string }
    const result = await customer.notify({ message })  // Typed as { delivered: boolean }
    return { profile, delivered: result.delivered }
  }
}
```

### Audit Logging (New in v3)

Built-in audit logging for compliance and debugging:

```typescript
import { DO } from '@dotdo/do'
import type { AuditContext } from '@dotdo/db'

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
    // Audit log entry created automatically

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

### Integration Registry (New in v3)

Type-safe third-party service integrations:

```typescript
import { DO } from '@dotdo/do'
import { createStripeIntegration, createSendGridIntegration } from '@dotdo/integrations'

class MyDO extends DO {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env)

    // Register integrations
    this.integrations.register('stripe', createStripeIntegration({
      apiKey: env.STRIPE_API_KEY,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET
    }))

    this.integrations.register('sendgrid', createSendGridIntegration({
      apiKey: env.SENDGRID_API_KEY
    }))
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

### Circuit Breaker Pattern (Enhanced in v3)

Request-scoped circuit breakers to prevent cascading failures:

```typescript
import {
  runWithCircuitBreakerRegistry,
  getCircuitBreaker,
  type CircuitBreakerConfig
} from '@dotdo/do'

class MyDO extends DO {
  async callExternalService() {
    // Recommended: Use request-scoped circuit breakers
    return runWithCircuitBreakerRegistry(async () => {
      const circuit = getCircuitBreaker('payment-service', {
        failureThreshold: 5,
        resetTimeout: 30000,
        halfOpenRequests: 3
      })

      return circuit.execute(async () => {
        return fetch('https://payment.api/charge')
      })
    })
  }
}
```

### Graceful Degradation (New in v3)

Handle DO unavailability with fallback responses:

```typescript
import {
  createGracefulDegradationHandler,
  type FallbackConfig
} from '@dotdo/do'

class MyDO extends DO {
  private degradationHandler = createGracefulDegradationHandler({
    healthCheckInterval: 5000,
    cacheStaleTime: 60000,
    writeQueueMaxSize: 1000
  })

  async getData(id: string) {
    return this.degradationHandler.execute(
      // Primary operation
      async () => this.things.get(id),
      // Fallback on failure
      async () => this.getCachedData(id)
    )
  }
}
```

---

## Step-by-Step Migration

### Phase 1: Update Dependencies

```bash
# Remove old dependencies
npm uninstall dotdo @dotdo/core

# Install v3 packages
npm install @dotdo/do @dotdo/db @dotdo/rpc @dotdo/ai
```

### Phase 2: Update Import Statements

Use a find-and-replace approach:

```typescript
// Find and replace imports
// v1/v2                                    // v3
import { DOCore } from 'dotdo'              // import { DO } from '@dotdo/do'
import { DOFull } from 'dotdo'              // import { DO } from '@dotdo/do'
import { createRPCClient } from '@dotdo/core' // import { createRPCClient } from '@dotdo/rpc'
import { ThingData } from 'dotdo'           // import { Thing } from '@dotdo/db'
```

### Phase 3: Update DO Class Definitions

**Before (v2):**
```typescript
import { DOCore, createWorkflowContext } from 'dotdo'

export class MyDO extends DOCore {
  private $: WorkflowContext

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.$ = createWorkflowContext({ stubResolver: this.getStub.bind(this) })
  }

  async onStart() {
    this.$.on.Customer.created(handler)
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

    // Use this.$ directly in constructor
    this.$.on.Customer.created(async (event) => {
      // handler logic
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

### Phase 4: Update Error Handling

```typescript
// Before (v2)
import { RPCError, RPCErrorCodes } from '@dotdo/core'

if (!customer) {
  throw new RPCError(RPCErrorCodes.NOT_FOUND, 'Customer not found')
}

// After (v3)
import { NotFoundError, ValidationError } from '@dotdo/rpc'

if (!customer) {
  throw new NotFoundError('Customer not found')
}

if (!isValidEmail(email)) {
  throw new ValidationError('Invalid email format', { field: 'email' })
}
```

### Phase 5: Update Wrangler Configuration

```jsonc
// wrangler.jsonc
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
    // If migrating from v2 DOCore
    { "tag": "v3-upgrade", "renamed_classes": [
      { "from": "DOCore", "to": "DO" }
    ]}
  ]
}
```

### Phase 6: Update Tests

```typescript
// Before (v2)
import { env } from 'cloudflare:test'
const stub = env.DOCore.get(env.DOCore.idFromName('test'))

// After (v3)
import { env } from 'cloudflare:test'
const stub = env.DO.get(env.DO.idFromName('test'))
```

### Phase 7: Update Build Scripts

```json
{
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "test": "vitest",
    "test:run": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

### Phase 8: Adopt New Features (Optional)

Incrementally adopt v3 features:

1. **Typed Context**: Add type definitions for cross-DO RPC
2. **Audit Logging**: Enable audit context for compliance
3. **Integrations**: Use integration registry for third-party services
4. **Mixins**: Refactor to use composable mixins if needed

---

## Common Migration Issues

### 1. Type Errors After Upgrade

**Symptom:** TypeScript errors about missing properties or incompatible types.

**Solution:**
- Ensure all imports are updated to new paths
- Update `@cloudflare/workers-types` to latest version
- Check TypeScript paths in tsconfig.json:
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
Add migration tags for renamed classes:
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

### 3. WorkflowContext Not Available in Constructor

**Symptom:** `this.$` is undefined in constructor.

**Solution:**
In v3, `$` is initialized in the base DO constructor. Make sure you call `super(state, env)` before accessing `this.$`:

```typescript
class MyDO extends DO {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env)  // MUST call super first
    this.$.on.Customer.signup(handler)  // Now $ is available
  }
}
```

### 4. Missing Primitives Submodule

**Symptom:** Imports from `ai-functions` or `ai-providers` fail.

**Solution:**
Initialize the git submodule:
```bash
npm run submodule:init
# or
git submodule update --init --recursive
```

### 5. Tests Failing After Migration

**Symptom:** Tests that worked in v2 fail in v3.

**Solution:**
Update test imports and bindings:
```typescript
// Update vitest.config.ts
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

### 6. Hibernation Wake-Up Issues

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

### 7. RPC Compatibility Between Versions

**Symptom:** RPC calls fail between v2 and v3 services.

**Solution:**
v3 RPC is backward compatible with v2 but includes new features. Ensure:
- Both services use compatible RPC versions
- Error handling accounts for new error types
- Correlation IDs are passed through if using distributed tracing

---

## Compatibility Notes

### Backward Compatibility

- **WorkflowContext API**: The `$` context API is fully backward compatible
- **Entity Stores**: `things`, `events`, `relationships` APIs are unchanged
- **RPC Protocol**: v3 RPC is compatible with v2 clients

### Breaking Changes Summary

| Area | Change | Migration Path |
|------|--------|----------------|
| DO Class | `DOCore`/`DOFull` -> `DO` | Replace class import |
| Package Imports | `dotdo` -> `@dotdo/*` | Update import paths |
| RPC Errors | `RPCErrorCodes` enum -> Error classes | Use `NotFoundError`, etc. |
| Wrangler | Multiple bindings -> Single `DO` binding | Simplify configuration |

### Feature Parity

| Feature | v1 | v2 | v3 |
|---------|----|----|-----|
| Entity Storage | Yes | Yes | Yes (enhanced) |
| WorkflowContext | Yes | Yes | Yes (with types) |
| Cross-DO RPC | Yes | Yes | Yes |
| WebSocket | Yes | Yes | Yes (hibernation) |
| MCP Server | No | Yes | Yes |
| Audit Logging | No | No | **Yes** |
| Integrations | No | No | **Yes** |
| Typed Context | No | No | **Yes** |
| Composable Mixins | Partial | No | **Yes** |

### Node.js Polyfill Compatibility

v3 uses standard Web APIs. If your code relies on Node.js APIs:

```typescript
// Instead of Node.js crypto
const hash = await crypto.subtle.digest('SHA-256', data)

// Instead of Node.js Buffer
const encoder = new TextEncoder()
const decoder = new TextDecoder()

// Instead of Node.js fs
const data = await env.R2_BUCKET.get('file.txt')
```

---

## Further Reading

- [Getting Started Guide](/docs/GETTING_STARTED.md)
- [Troubleshooting Guide](/docs/TROUBLESHOOTING.md)
- [Node.js/Express Migration Guide](/docs/MIGRATION.md) - For migrating from Node.js
- [CLAUDE.md](/CLAUDE.md) - Project guidance and architecture overview
