# Migration Guide: v1 to v2 to v3

This guide covers breaking changes and upgrade paths when migrating between dotdo versions. Each major version represents a significant architectural evolution.

## Table of Contents

1. [Version Overview](#version-overview)
2. [v1 to v2 Breaking Changes](#v1-to-v2-breaking-changes)
3. [v2 to v3 Breaking Changes](#v2-to-v3-breaking-changes)
4. [Configuration Changes](#configuration-changes)
5. [Step-by-Step Upgrade Guide](#step-by-step-upgrade-guide)
6. [API Migration Reference](#api-migration-reference)

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

**v2: Modular DO Hierarchy**
- Separate DO classes: `DOCore`, `DOStorage`, `DOWorkflow`, `DOSemantic`, `DOFull`
- Independent packages: `@dotdo/core`, `@dotdo/rpc`
- Cap'n Web RPC with promise pipelining
- pnpm workspace structure

**v3: Clean Monorepo Architecture**
- Focused workspace packages: `@dotdo/do`, `@dotdo/db`, `@dotdo/rpc`, `@dotdo/ai`, `@dotdo/api`, `@dotdo/auth`
- Single `DO` class with composable mixins
- Turbo for build orchestration
- Primitives moved to git submodule

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
import { DOCore } from 'dotdo'       // Base class
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
└── primitives/   # Git submodule -> primitives.org.ai
```

### 2. Single DO Class with Composable Mixins

**v2:**
```typescript
import { DOCore, DOFull, DOStorage } from 'dotdo'

// Choose your base class
class MyDO extends DOCore { }
class FullFeatureDO extends DOFull { }
```

**v3:**
```typescript
import { DO, WithStorage, WithWebSocket, WithRPC, WithAuth } from '@dotdo/do'

// Single base class with composable mixins
class MyDO extends DO { }

// Or compose with mixins
class AdvancedDO extends WithAuth(WithRPC(WithWebSocket(WithStorage(DO)))) { }
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
import { ThingsStore, EventsStore, RelationshipsStore } from '@dotdo/db'
import { RPCError, NotFoundError, InternalError } from '@dotdo/rpc'
import { McpServer } from '@dotdo/mcp'
```

### 4. Entity Management API Changed

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
import { DO, EntityManager } from '@dotdo/do'

class MyDO extends DO {
  // EntityManager is built-in
  async getCustomer(id: string) {
    return this.things.get(id)
  }

  async createCustomer(data: ThingData) {
    return this.things.create({ $type: 'Customer', ...data })
  }

  // New: Query builder
  async findCustomers() {
    return this.query()
      .where({ $type: 'Customer' })
      .orderBy('createdAt', 'desc')
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

// Specialized error classes
throw new NotFoundError('Customer not found')
throw new ValidationError('Invalid email format')
throw new AuthenticationError('Token expired')

// With correlation IDs for tracing
const error = new NotFoundError('Not found', { correlationId: 'abc-123' })
```

### 6. Audit Logging Added (New in v3)

**v3 Only:**
```typescript
import { DO } from '@dotdo/do'

class MyDO extends DO {
  async handleRequest(request: Request) {
    // Set audit context for tracking
    this.setAuditContext({
      userId: 'user-123',
      action: 'create',
      resource: 'Customer'
    })

    // Operations are automatically logged
    const customer = await this.things.create({ $type: 'Customer', name: 'Alice' })

    // Query audit logs
    const logs = await this.auditLogs.query({
      userId: 'user-123',
      limit: 100
    })
  }
}
```

### 7. Integration Registry Added (New in v3)

**v3 Only:**
```typescript
import { DO, IntegrationRegistry, StripeIntegration, SendGridIntegration } from '@dotdo/do'

class MyDO extends DO {
  async onStart() {
    // Register third-party integrations
    this.integrations.register('stripe', createStripeIntegration({
      apiKey: this.env.STRIPE_API_KEY
    }))

    this.integrations.register('sendgrid', createSendGridIntegration({
      apiKey: this.env.SENDGRID_API_KEY
    }))
  }

  async chargeCustomer(customerId: string, amount: number) {
    const stripe = this.integrations.get<StripeIntegration>('stripe')
    return stripe.createPaymentIntent({ amount, customer: customerId })
  }
}
```

### 8. Build System Changed

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
npm run test         # vitest
npm run typecheck    # turbo typecheck
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
      "@dotdo/mcp": ["./mcp/index.ts"]
    }
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

3. **Replace DO class hierarchy with mixins:**
   ```typescript
   // Before (v2)
   import { DOFull } from 'dotdo'
   class MyDO extends DOFull { }

   // After (v3)
   import { DO, WithStorage, WithRPC } from '@dotdo/do'
   class MyDO extends DO { }
   // or with mixins:
   class MyDO extends WithRPC(WithStorage(DO)) { }
   ```

4. **Update error handling:**
   ```typescript
   // Before (v2)
   import { RPCError } from '@dotdo/core'

   // After (v3)
   import { RPCError, NotFoundError, ValidationError } from '@dotdo/rpc'
   ```

5. **Update build scripts:**
   ```json
   {
     "scripts": {
       "dev": "turbo dev",
       "build": "turbo build",
       "test": "vitest"
     }
   }
   ```

6. **Add audit logging (optional):**
   ```typescript
   // New v3 feature
   this.setAuditContext({ userId, action })
   ```

7. **Run migration tests:**
   ```bash
   npm run typecheck
   npm run test:run
   ```

---

## API Migration Reference

### DO Class Methods

| v1 | v2 | v3 |
|----|----|----|
| `this.$` | `this.$` | `this.$` |
| `this.things.get()` | `this.things.get()` | `this.things.get()` |
| `this.events.emit()` | `this.events.emit()` | `this.events.emit()` |
| `this.relationships.create()` | `this.relationships.create()` | `this.relationships.create()` |
| N/A | N/A | `this.auditLogs.query()` |
| N/A | N/A | `this.integrations.register()` |
| N/A | N/A | `this.query()` (QueryBuilder) |

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

---

## Common Migration Issues

### 1. Type Errors After Upgrade

If you see type errors after upgrading, ensure:
- All imports are updated to new paths
- `@cloudflare/workers-types` is at a compatible version
- TypeScript paths in tsconfig.json are correct

### 2. Wrangler Migration Errors

When adding new DO classes:
```jsonc
{
  "migrations": [
    { "tag": "existing", "new_sqlite_classes": ["ExistingDO"] },
    { "tag": "new", "new_sqlite_classes": ["NewDO"] }  // Add new migration
  ]
}
```

### 3. RPC Compatibility

v3 RPC is backward compatible with v2 but includes new features:
- Correlation IDs for request tracing
- Specialized error types
- Enhanced logging

### 4. Test Migration

Update test imports:
```typescript
// Before (v2)
import { env } from 'cloudflare:test'
const stub = env.DOCore.get(env.DOCore.idFromName('test'))

// After (v3)
import { env } from 'cloudflare:test'
const stub = env.DO.get(env.DO.idFromName('test'))
```

---

## Further Reading

- [Getting Started Guide](/docs/GETTING_STARTED.md)
- [Troubleshooting Guide](/docs/TROUBLESHOOTING.md)
- [Node.js Migration Guide](/docs/MIGRATION.md) - For migrating from Node.js/Express
- [CLAUDE.md](/CLAUDE.md) - Project guidance and architecture overview
