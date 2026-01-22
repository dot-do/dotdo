# dotdo Architecture

**Edge-native runtime for Durable Objects.** The missing Node.js for V8 isolates—extended primitives, graph-based state, and zero cold starts.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Layered Architecture](#layered-architecture)
3. [Package Dependency Graph](#package-dependency-graph)
4. [RPC Communication Patterns](#rpc-communication-patterns)
5. [Storage Architecture](#storage-architecture)
6. [WorkflowContext ($) Design](#workflowcontext--design)
7. [MCP Integration](#mcp-integration)
8. [Deployment Model](#deployment-model)
9. [Security Considerations](#security-considerations)

---

## System Overview

dotdo is a runtime/framework layer for Cloudflare Durable Objects—V8 isolates with SQLite storage, globally distributed with single-threaded consistency guarantees.

```
┌─────────────────────────────────────────────────────────────────┐
│                    APPLICATION LAYER                             │
│              (workers.do, agents.do, teams.do)                   │
│                                                                  │
│  Business logic, named agents, team roles, human-in-the-loop    │
└────────────────────────────┬────────────────────────────────────┘
                             │ imports from
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     DOTDO RUNTIME LAYER                          │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Core Objects                                             │  │
│  │  DO │ DOBase │ EntityManager │ WorkflowContext ($)        │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Extended Primitives                                      │  │
│  │  fsx │ gitx │ bashx │ npmx │ pyx                          │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Storage Layer                                            │  │
│  │  Things │ Events │ Relationships │ QueryBuilder           │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  Communication                                            │  │
│  │  Cap'n Web RPC │ Pipeline Promises │ MCP Server           │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │  API Layer                                                │  │
│  │  HATEOAS │ OpenAPI │ SDK Generator │ Hono Router          │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │ runs on
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CLOUDFLARE PLATFORM                           │
│                                                                  │
│  Durable Objects │ SQLite │ R2 │ KV │ Pipelines │ 300+ Cities   │
└─────────────────────────────────────────────────────────────────┘
```

### Core Principles

1. **Zero Cold Starts** - V8 isolates start in <1ms, no container overhead
2. **Single-Threaded Consistency** - No locks, no race conditions, no distributed transactions
3. **Graph-Based State** - Things, Relationships, Events stored in SQLite
4. **Promise Pipelining** - Cap'n Web RPC reduces round trips
5. **Extended Primitives** - POSIX filesystem, Git, Shell on pure V8

---

## Layered Architecture

dotdo follows a clean layered architecture with strict dependency flow:

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 5: Application                                            │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  User Applications (workers.do, custom DOs)               │  │
│  └───────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌─────────────────────────────────────────────────────────────────┐
│  Layer 4: API & CLI                                              │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  api/    - HATEOAS, OpenAPI, SDK generation               │  │
│  │  dotdo/  - CLI commands, RPC client, MCP client            │  │
│  └───────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌─────────────────────────────────────────────────────────────────┐
│  Layer 3: Runtime Services                                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  do/     - DO base class, WorkflowContext, entities        │  │
│  │  mcp/    - Model Context Protocol server                   │  │
│  │  ai/     - Multi-provider LLM routing, templates           │  │
│  │  auth/   - Authentication middleware                       │  │
│  └───────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌─────────────────────────────────────────────────────────────────┐
│  Layer 2: Infrastructure                                         │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  db/     - Storage layer (Things, Events, Relationships)   │  │
│  │  rpc/    - Cap'n Web RPC, pipeline promises                │  │
│  │  app/    - TanStack Start frontend                         │  │
│  └───────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │
┌─────────────────────────────────────────────────────────────────┐
│  Layer 1: Primitives (git submodule)                             │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  primitives/  - Extended primitives (fsx, gitx, etc.)      │  │
│  │               - AI primitives (ai-core, ai-providers)      │  │
│  │               - Digital objects                            │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Dependency Rules

- **Downward Only**: Higher layers import from lower layers, never upward
- **No Circular Dependencies**: Each layer is self-contained
- **Platform Abstraction**: Layer 1 abstracts V8 isolate limitations

---

## Package Dependency Graph

dotdo is organized as a **monorepo** with 27+ internal packages. The v3 rewrite focuses on a minimal, clean dependency graph with strict tier boundaries.

### Tier Overview

```
                    ┌─────────────────────────────────────────────┐
                    │                   dotdo                      │
                    │  @dotdo/ai, @dotdo/api, @dotdo/auth,        │
                    │  @dotdo/db, @dotdo/do, @dotdo/mcp,          │
                    │  @dotdo/rpc, rpc.do, commander, hono        │
                    └──────────────────────┬──────────────────────┘
                                           │
          ┌────────────────────────────────┼────────────────────────────────┐
          │                                │                                │
          ▼                                ▼                                ▼
┌─────────────────────┐     ┌─────────────────────┐      ┌─────────────────────┐
│     @dotdo/api      │     │     @dotdo/mcp      │      │   @dotdo/business   │
│  @dotdo/auth        │     │  @dotdo/db          │      │  @dotdo/do          │
│  @dotdo/db          │     │  @dotdo/do          │      │  @dotdo/clickhouse  │
│  @dotdo/do          │     │  @dotdo/rpc         │      │  @dotdo/business-   │
│  @dotdo/observ.     │     │  hono               │      │    finance          │
│  @dotdo/rpc         │     └─────────┬───────────┘      └──────────┬──────────┘
│  hono               │               │                             │
└─────────┬───────────┘               │                             │
          │                           │                             │
          └───────────────────────────┼─────────────────────────────┘
                                      │
                                      ▼
                    ┌─────────────────────────────────────────────┐
                    │                 @dotdo/do                    │
                    │  @dotdo/auth, @dotdo/db, @dotdo/integrations │
                    │  @dotdo/observability, @dotdo/rpc            │
                    │  ai-evaluate*, digital-workers*              │
                    │  language-models*, hono                      │
                    └──────────────────────┬──────────────────────┘
                                           │
          ┌────────────────────────────────┼────────────────────────────────┐
          │                                │                                │
          ▼                                ▼                                ▼
┌─────────────────────┐     ┌─────────────────────┐      ┌─────────────────────┐
│     @dotdo/rpc      │     │     @dotdo/auth     │      │  @dotdo/observ.     │
│  @dotdo/db          │     │  hono               │      │  hono               │
│  capnweb            │     │  jose               │      └─────────────────────┘
│  hono               │     │  id.org.ai*         │
└─────────┬───────────┘     └─────────────────────┘
          │
          ▼
┌─────────────────────┐     ┌─────────────────────┐
│     @dotdo/db       │     │     @dotdo/ai       │
│  zod                │     │  hono               │
│  digital-objects*   │     │  js-tiktoken        │
└─────────┬───────────┘     └─────────────────────┘
          │
          ▼
┌─────────────────────┐
│    @dotdo/core      │
│    (no deps)        │
└─────────────────────┘
```

*From primitives submodule

### Complete Package List by Tier

#### Tier 0: Foundation (Zero Runtime Dependencies)

| Package | npm Name | Description | Dependencies |
|---------|----------|-------------|--------------|
| core | `@dotdo/core` | Core types and DBClient interface | None |
| utils | `@dotdo/utils` | Shared utilities (proxy, logger, mixins) | None |
| integrations | `@dotdo/integrations` | Third-party integration registry (Stripe, SendGrid) | None |

#### Tier 1: Infrastructure

| Package | npm Name | Description | Dependencies |
|---------|----------|-------------|--------------|
| db | `@dotdo/db` | Storage layer (Things, Events, Relationships) | `zod`, peer: `digital-objects` |
| auth | `@dotdo/auth` | JWT authentication with jose | `hono`, `jose`, `id.org.ai` |
| ai | `@dotdo/ai` | AI routing with template literals | `hono`, `js-tiktoken` |
| observability | `@dotdo/observability` | Logging, tracing, metrics | `hono` |
| oauth | `@dotdo/oauth` | OAuth 2.1 + PKCE core | `hono` |
| clickhouse | `@dotdo/clickhouse` | ClickHouse WASM analytics | peer: `@cloudflare/workers-types` |

#### Tier 2: RPC Layer

| Package | npm Name | Description | Dependencies |
|---------|----------|-------------|--------------|
| rpc | `@dotdo/rpc` | Cap'n Web RPC (Client-Worker, Worker-DO, DO-DO) | `@dotdo/db`, `capnweb`, `hono` |
| rpc.do | `rpc.do` | Cap'n Web RPC client/server CLI | `@dotdo/utils`, `commander`, `hono` |

#### Tier 3: DO Layer

| Package | npm Name | Description | Dependencies |
|---------|----------|-------------|--------------|
| do | `@dotdo/do` | THE Durable Object class with SQLite | `@dotdo/auth`, `@dotdo/db`, `@dotdo/integrations`, `@dotdo/observability`, `@dotdo/rpc`, `ai-evaluate`*, `digital-workers`*, `language-models`*, `hono` |

#### Tier 4: API Layer

| Package | npm Name | Description | Dependencies |
|---------|----------|-------------|--------------|
| api | `@dotdo/api` | HATEOAS API with OpenAPI | `@dotdo/auth`, `@dotdo/db`, `@dotdo/do`, `@dotdo/observability`, `@dotdo/rpc`, `hono` |
| mcp | `@dotdo/mcp` | Model Context Protocol server | `@dotdo/db`, `@dotdo/do`, `@dotdo/rpc`, `hono` |

#### Tier 5: SDKs & Meta

| Package | npm Name | Description | Dependencies |
|---------|----------|-------------|--------------|
| sdk.do | `sdk.do` | Unified SDK (rpc.do + oauth) | `rpc.do`, `@dotdo/oauth` |
| platform.do | `platform.do` | Platform SDK with typed $ context | `sdk.do` |
| dotdo | `dotdo` | Main CLI, re-exports all modules | ALL @dotdo/* packages, `rpc.do`, `commander`, `hono` |
| business | `@dotdo/business` | Business-as-Code | `@dotdo/do`, `@dotdo/clickhouse`, `@dotdo/business-finance` |
| business/finance | `@dotdo/business-finance` | Financial primitives | TBD |

#### Tier 6: Testing

| Package | npm Name | Description | Dependencies |
|---------|----------|-------------|--------------|
| test-utils | `@dotdo/test-utils` | DO stub helpers, factories | peer: `vitest`, `miniflare` |
| testing | `@dotdo/testing` | Custom assertion helpers | `@dotdo/db`, peer: `vitest` |

### Dev Tool Packages (Capabilities)

These packages provide development capabilities that run on pure V8 isolates:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        bashx.do                                      │
│            (AI-enhanced bash execution with safety)                  │
├─────────────────────────────────────────────────────────────────────┤
│  @dotdo/fsx     │   @dotdo/npmx   │     gitx      │    (future)     │
│  (Filesystem)   │  (NPM for edge) │   (Git impl)  │  postgres, etc. │
└─────────────────┴─────────────────┴───────────────┴─────────────────┘
```

| Package | npm Name | Description | Dependencies |
|---------|----------|-------------|--------------|
| fsx | `@dotdo/fsx` | Virtual POSIX filesystem | `hono`, `miniflare`, `pako` |
| bashx | `bashx.do` | Bash execution with AST safety | `@dotdo/fsx`, `dotdo`, `fflate`, `hono`, `pako` |
| npmx | `@dotdo/npmx` | NPM/NPX for edge | `hono`, `semver`, `tar`, peer: `@dotdo/fsx`, `bashx.do` |
| gitx | `gitx-monorepo` (private) | Git on Cloudflare | `fsx.do`, `hono`, `miniflare`, `pako` |

### Primitives Submodule

The `primitives/` directory is a git submodule from [primitives.org.ai](https://primitives.org.ai):

| Package | Used By | Purpose |
|---------|---------|---------|
| `ai-core` | - | Core AI abstractions |
| `ai-database` | - | AI-powered database operations |
| `ai-evaluate` | `@dotdo/do` | LLM evaluation framework |
| `ai-experiments` | - | A/B testing for AI |
| `ai-functions` | - | Function calling primitives |
| `ai-props` | - | AI component props |
| `ai-providers` | - | Provider integrations |
| `ai-tests` | - | AI testing utilities |
| `ai-workflows` | - | Workflow orchestration |
| `autonomous-agents` | - | Agent framework |
| `business-as-code` | - | Business logic primitives |
| `config` | - | Configuration management |
| `digital-objects` | `@dotdo/db` (peer) | DO type definitions |
| `digital-products` | - | Product abstractions |
| `digital-tasks` | - | Task management |
| `digital-tools` | - | Tool definitions |
| `digital-workers` | `@dotdo/do` | Worker abstractions |
| `human-in-the-loop` | - | HITL workflows |
| `id.org.ai` | `@dotdo/auth` | Identity primitives |
| `language-models` | `@dotdo/do` | LLM routing + providers |
| `org.ai` | - | Organization primitives |
| `services-as-software` | - | SaaS primitives |
| `types` | - | Shared type definitions |

### Package Naming Convention

| Pattern | Example | Purpose |
|---------|---------|---------|
| `@dotdo/*` | `@dotdo/do`, `@dotdo/db` | Core framework packages |
| `*.do` | `rpc.do`, `bashx.do` | Standalone services/tools |
| `dotdo` | `dotdo` | Main CLI package |

### External Dependencies

| Dependency | Used By | Purpose |
|------------|---------|---------|
| `hono` | Most packages | HTTP framework |
| `zod` | `@dotdo/db` | Schema validation |
| `jose` | `@dotdo/auth` | JWT implementation |
| `capnweb` | `@dotdo/rpc` | Cap'n Proto RPC |
| `commander` | `dotdo`, `rpc.do` | CLI framework |
| `semver` | `@dotdo/npmx` | Version resolution |
| `tar` | `@dotdo/npmx` | Tarball handling |
| `pako` | fsx, bashx, gitx | Compression |
| `miniflare` | fsx, gitx, test-utils | Local DO testing |

### Future Capabilities (Planned)

```
capabilities/
├── fsx        ✓ Filesystem
├── bashx      ✓ Shell execution
├── npmx       ✓ Package management
├── gitx       ✓ Version control
├── postgres   ○ PostgreSQL (via pg-gateway)
├── mongo      ○ MongoDB (via protocol)
├── sqlite     ○ SQLite (native via DO)
├── redis      ○ Redis (via protocol)
└── db4        ○ Universal DB abstraction
```

### Legacy Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                     dotdo Monorepo                            │
│                                                               │
│  ┌────────────┐                                               │
│  │ dotdo/     │  CLI & Client Facades                         │
│  │            │  ├─ do.ts    → Exposes DO base               │
│  │            │  ├─ api.ts   → Exposes API layer             │
│  │            │  ├─ rpc.ts   → Exposes RPC client            │
│  │            │  ├─ mcp.ts   → Exposes MCP server            │
│  │            │  ├─ ai.ts    → Exposes AI router             │
│  │            │  └─ cli.ts   → Command-line interface        │
│  └─────┬──────┘                                               │
│        │                                                       │
│        ├──────► api/        HATEOAS, OpenAPI, SDK Generator   │
│        │          └──► do/  (uses DO base class)              │
│        │                                                       │
│        ├──────► do/         Durable Object Base Classes       │
│        │          ├──► db/  (uses storage layer)              │
│        │          └──► rpc/ (uses RPC for cross-DO calls)     │
│        │                                                       │
│        ├──────► db/         Storage Layer (Things, Events)    │
│        │          └──► primitives/digital-objects             │
│        │                                                       │
│        ├──────► rpc/        Cap'n Web RPC & Pipelines         │
│        │                                                       │
│        ├──────► mcp/        Model Context Protocol            │
│        │          └──► do/  (integrates with DO tools)        │
│        │                                                       │
│        ├──────► ai/         Multi-provider LLM Routing        │
│        │          └──► primitives/ai-*                        │
│        │                                                       │
│        ├──────► auth/       Authentication & Authorization    │
│        │                                                       │
│        ├──────► app/        TanStack Start Frontend           │
│        │                                                       │
│        └──────► primitives/ Extended Primitives (submodule)   │
│                   ├─ ai-core                                  │
│                   ├─ ai-providers                             │
│                   ├─ digital-objects                          │
│                   └─ ... (fsx, gitx, bashx, etc.)             │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

### Package Responsibilities

| Package | Purpose | Key Files | Exports |
|---------|---------|-----------|---------|
| **do/** | Durable Object base classes | `DO.ts`, `context.ts`, `entities.ts`, `on.ts`, `schedule.ts` | `DO`, `WorkflowContext`, `EntityManager` |
| **db/** | Storage primitives | `things.ts`, `events.ts`, `relationships.ts`, `query.ts` | `ThingsStore`, `EventsStore`, `RelationshipsStore` |
| **rpc/** | RPC communication | `client.ts`, `server.ts`, `pipeline.ts`, `errors.ts` | `RPCClient`, `PipelinePromise`, `withPipeline` |
| **api/** | Self-describing API | `app.ts`, `resource.ts`, `openapi.ts`, `hateoas.ts` | `createAPI`, `defineResource`, `generateOpenAPI` |
| **mcp/** | Model Context Protocol | `server.ts`, `do.ts`, `search.ts`, `fetch.ts` | `createMCPServer`, `MCPTool` |
| **ai/** | LLM integration | `router.ts`, `template.ts`, `providers.ts`, `stream.ts` | `ai()`, `template()`, `router` |
| **auth/** | Authentication | `middleware.ts`, `guards.ts` | `authMiddleware`, `guards` |
| **dotdo/** | CLI & client facades | `cli.ts`, `do.ts`, `api.ts`, `rpc.ts`, `mcp.ts` | `dotdo` CLI, client APIs |
| **app/** | TanStack Start frontend | `index.ts`, `vite.config.ts` | Frontend application |
| **primitives/** | Extended primitives | `ai-*`, `digital-objects`, etc. | `fsx`, `gitx`, `bashx`, `npmx`, `pyx` |

---

## RPC Communication Patterns

dotdo uses **Cap'n Web RPC** for cross-DO communication with promise pipelining.

### Traditional RPC (N Round Trips)

```typescript
// Traditional: 3 sequential round trips
const user = await do.things.get('user-123')          // 1 RTT
const tenantId = user.tenantId                        // Local
const tenant = await do.things.get(tenantId)          // 1 RTT
const plan = await do.things.get(tenant.planId)       // 1 RTT
// Total: 3 RTTs
```

### Cap'n Web RPC (1 Round Trip)

```typescript
// Pipeline: 1 round trip for entire chain
const plan = do.things.get('user-123')
  .pipe(user => user.tenantId)
  .pipe(tenantId => do.things.get(tenantId))
  .pipe(tenant => do.things.get(tenant.planId))
// Total: 1 RTT - entire pipeline executes on server
```

### RPC Protocol Flow

```
┌─────────────────────────────────────────────────────────────────┐
│  Client DO (Tenant A)                                            │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  const result = await rpc.call('things.get', ['user-123'])│  │
│  └────────────────────────┬──────────────────────────────────┘  │
└───────────────────────────┼─────────────────────────────────────┘
                            │
                            │ HTTP POST /rpc
                            │ Content-Type: application/json
                            │ Authorization: Bearer <token>
                            │
                            │ {
                            │   "method": "things.get",
                            │   "args": ["user-123"]
                            │ }
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Server DO (Tenant B)                                            │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  1. Parse method path: "things.get"                        │  │
│  │  2. Navigate: this.things.get                              │  │
│  │  3. Validate function exists                               │  │
│  │  4. Execute: await this.things.get('user-123')             │  │
│  │  5. Serialize result                                       │  │
│  └────────────────────────┬──────────────────────────────────┘  │
└───────────────────────────┼─────────────────────────────────────┘
                            │
                            │ HTTP 200 OK
                            │ Content-Type: application/json
                            │
                            │ {
                            │   "$id": "user-123",
                            │   "$type": "User",
                            │   "name": "Alice",
                            │   ...
                            │ }
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Client DO receives result                                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  const user = result  // TypeScript typed!                 │  │
│  │  console.log(user.name)  // "Alice"                        │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Pipeline Promise Implementation

```typescript
export interface PipelinePromise<T> extends Promise<T> {
  // Chain another call
  pipe<U>(fn: (result: T) => Promise<U> | U): PipelinePromise<U>

  // Access nested property
  get<K extends keyof T>(key: K): PipelinePromise<T[K]>

  // Call method on result
  call<K extends keyof T>(method: K, ...args): PipelinePromise<R>
}
```

The pipeline collapses multiple async calls into a single round trip by tracking the chain and executing it server-side.

### Cross-DO RPC

```typescript
// In DO A
export class OrderDO extends DO {
  async processPayment(orderId: string) {
    // Call payment DO via RPC
    const payment = await $.PaymentDO(tenantId).charge({
      amount: order.total,
      customerId: order.customerId
    })

    // Call inventory DO
    await $.InventoryDO(tenantId).reserve(order.items)

    return payment
  }
}
```

The `$` context provides cross-DO proxies that automatically route RPC calls.

---

## Storage Architecture

dotdo uses a **graph-based storage model** with three core primitives:

### The Three Stores

```
┌─────────────────────────────────────────────────────────────────┐
│                         DURABLE OBJECT                           │
│                                                                  │
│  ┌────────────────┐  ┌──────────────────┐  ┌─────────────────┐ │
│  │  Things Store  │  │ Relationships    │  │  Events Store   │ │
│  │                │  │    Store         │  │                 │ │
│  │  Entities with │  │  Graph edges     │  │  Event log      │ │
│  │  properties    │  │  between Things  │  │  (append-only)  │ │
│  │                │  │                  │  │                 │ │
│  │  Customer      │  │  owns →          │  │  created        │ │
│  │  Order         │  │  ← belongs_to    │  │  updated        │ │
│  │  Product       │  │  → contains      │  │  deleted        │ │
│  └────────┬───────┘  └────────┬─────────┘  └────────┬────────┘ │
│           │                   │                     │          │
│           └───────────────────┴─────────────────────┘          │
│                              │                                 │
│                              ▼                                 │
│                  ┌───────────────────────┐                     │
│                  │   SQLite Database     │                     │
│                  │   (10GB per DO)       │                     │
│                  └───────────────────────┘                     │
└─────────────────────────────────────────────────────────────────┘
```

### Things Store

**Purpose**: Store typed entities with properties.

```typescript
export interface Thing {
  $id: string           // Unique identifier
  $type: string         // Type URL (schema.org.ai)
  $createdAt: number    // Unix timestamp
  $updatedAt: number    // Unix timestamp
  [key: string]: unknown // Custom properties
}

export interface ThingsStore {
  create(thing: Omit<Thing, '$id' | '$createdAt' | '$updatedAt'>): Promise<Thing>
  get(id: string): Promise<Thing | null>
  update(id: string, data: Partial<Thing>): Promise<Thing>
  delete(id: string): Promise<void>
  list(options?: { type?: string; limit?: number }): Promise<Thing[]>
}
```

**Example**:

```typescript
const customer = await $.things.create({
  $type: 'Customer',
  name: 'Alice',
  email: 'alice@example.com',
  plan: 'pro'
})

// Result:
// {
//   $id: 'l9k3j4h2-5a8c',
//   $type: 'Customer',
//   $createdAt: 1705680000000,
//   $updatedAt: 1705680000000,
//   name: 'Alice',
//   email: 'alice@example.com',
//   plan: 'pro'
// }
```

### Relationships Store

**Purpose**: Store directed edges between Things.

```typescript
export interface Relationship {
  $id: string
  $type: string         // Relationship type
  fromId: string        // Source Thing
  toId: string          // Target Thing
  properties?: object   // Optional metadata
}

export interface RelationshipsStore {
  create(rel: Omit<Relationship, '$id'>): Promise<Relationship>
  delete(id: string): Promise<void>
  findByFrom(fromId: string, type?: string): Promise<Relationship[]>
  findByTo(toId: string, type?: string): Promise<Relationship[]>
}
```

**Example**:

```typescript
// Customer owns Order
await $.relationships.create({
  $type: 'owns',
  fromId: customer.$id,
  toId: order.$id
})

// Query
const orders = await $.relationships.findByFrom(customer.$id, 'owns')
```

### Events Store

**Purpose**: Append-only event log for audit, replay, CDC.

```typescript
export interface Event {
  $id: string
  type: string          // Event type (Noun.verb)
  payload: unknown      // Event data
  source: string        // Event origin
  timestamp: number     // Unix timestamp
}

export interface EventsStore {
  emit(event: Omit<Event, '$id' | 'timestamp'>): Promise<Event>
  list(options?: { type?: string; since?: number }): Promise<Event[]>
}
```

**Example**:

```typescript
// Emit event
await $.events.emit({
  type: 'Customer.created',
  payload: customer,
  source: 'api'
})

// Query events
const recentEvents = await $.events.list({
  type: 'Customer.*',
  since: Date.now() - 86400000  // Last 24h
})
```

### Query Builder

**Purpose**: Compose complex queries across Things and Relationships.

```typescript
export interface QueryBuilder {
  // Filter by type
  type(type: string): QueryBuilder

  // Filter by property
  where(field: string, op: string, value: unknown): QueryBuilder

  // Traverse relationships
  traverse(relType: string, direction: 'from' | 'to'): QueryBuilder

  // Execute query
  exec(): Promise<Thing[]>
}
```

**Example**:

```typescript
// Find pro customers with recent orders
const customers = await $.query()
  .type('Customer')
  .where('plan', '=', 'pro')
  .traverse('owns', 'from')  // Follow owns edge
  .type('Order')
  .where('createdAt', '>', Date.now() - 86400000)
  .exec()
```

### Tiered Storage (Future)

```
┌────────────────────────────────────────────────────────────┐
│  Tier 1: DO SQLite (Hot)                                   │
│  • Active Things, Events, Relationships                    │
│  • Access: <1ms                                            │
│  • Size: Up to 10GB                                        │
│  • Cost: $0.001/M reads                                    │
└──────────────────────────┬─────────────────────────────────┘
                           │ Checkpoint
                           ▼
┌────────────────────────────────────────────────────────────┐
│  Tier 2: R2 Iceberg (Warm)                                 │
│  • Partitioned Parquet files                               │
│  • Access: ~100ms                                          │
│  • Size: Unlimited                                         │
│  • Cost: $0.015/GB stored                                  │
└──────────────────────────┬─────────────────────────────────┘
                           │ Archive
                           ▼
┌────────────────────────────────────────────────────────────┐
│  Tier 3: ClickHouse (Cold)                                 │
│  • Analytics queries                                       │
│  • Access: ~1s                                             │
│  • Size: Unlimited                                         │
│  • Cost: Pay per query                                     │
└────────────────────────────────────────────────────────────┘
```

See `.worktrees/v1/db/ARCHITECTURE.md` for detailed storage architecture.

---

## WorkflowContext ($) Design

The **WorkflowContext** (`$`) is the central execution context for all workflow operations.

### Core Concept

Every DO has access to a `$` context providing:
1. **Durability levels** - `send`, `try`, `do`
2. **Event handlers** - `$.on.Noun.verb(handler)`
3. **Scheduling** - `$.every.day.at9am(handler)`
4. **Storage access** - `$.things`, `$.events`, `$.relationships`
5. **Cross-DO RPC** - `$.TenantDO(id).method()`

### Durability Levels

```typescript
export interface WorkflowContext {
  // Fire-and-forget (no retry, no durability)
  send(event: { type: string; payload?: unknown }): void

  // Single attempt (throws on failure)
  try<T>(action: () => Promise<T>): Promise<T>

  // Durable with retries (exponential backoff)
  do<T>(action: () => Promise<T>, options?: DoOptions): Promise<T>
}

export interface DoOptions {
  retries?: number        // Default: 3
  backoff?: 'linear' | 'exponential'  // Default: exponential
  timeout?: number        // Default: 30000ms
}
```

**Usage**:

```typescript
// Fire-and-forget analytics event
$.send({ type: 'PageView', payload: { url, userId } })

// Single attempt - fail fast
const result = await $.try(() => externalAPI.call())

// Durable - retry with backoff
const payment = await $.do(
  () => stripe.charges.create({ amount, customer }),
  { retries: 5, timeout: 60000 }
)
```

### Event Handlers

The `$.on` proxy enables **infinite event patterns** via JavaScript Proxy:

```typescript
export type OnProxy = {
  [noun: string]: {
    [verb: string]: (handler: EventHandler) => void
  }
}

// Examples
$.on.Customer.created(async (event) => {
  await sendWelcomeEmail(event.payload)
})

$.on.Payment.failed(async (event) => {
  await notifyAdmin(event.payload)
})

// Wildcard patterns
$.on['*'].created(async (event) => {
  console.log('Something was created:', event.type)
})

$.on.Order['*'](async (event) => {
  console.log('Order event:', event.type)
})
```

**Implementation**:

```typescript
export function createOnProxy(
  handlers: Map<string, EventHandler[]>
): OnProxy {
  return new Proxy({} as OnProxy, {
    get: (_, noun: string) => {
      return new Proxy({}, {
        get: (_, verb: string) => {
          return (handler: EventHandler) => {
            const pattern = `${noun}.${verb}`
            if (!handlers.has(pattern)) {
              handlers.set(pattern, [])
            }
            handlers.get(pattern)!.push(handler)
          }
        }
      })
    }
  })
}
```

### Scheduling DSL

The `$.every` proxy enables **natural language scheduling**:

```typescript
// Simple intervals
$.every.hour(async () => {
  await cleanupExpiredSessions()
})

// Day-based
$.every.Monday.at9am(async () => {
  await generateWeeklyReport()
})

// Complex patterns
$.every.day.at('6pm')(async () => {
  await sendDailyDigest()
})

$.every.Friday.at('5:30pm')(async () => {
  await closeWeeklyBooks()
})
```

**Implementation**:

The DSL compiles to CRON expressions:

```typescript
$.every.Monday.at9am
// → "0 9 * * 1"

$.every.day.at('6pm')
// → "0 18 * * *"

$.every.hour
// → "0 * * * *"
```

See `do/schedule.ts` for full implementation.

### WorkflowContext Lifecycle

```
┌─────────────────────────────────────────────────────────────┐
│  DO Constructor                                              │
│  1. Create WorkflowContext                                   │
│  2. Initialize handlers Map                                  │
│  3. Initialize schedules Map                                 │
└────────────────────────┬────────────────────────────────────┘
                         │
┌─────────────────────────────────────────────────────────────┐
│  Application Code                                            │
│  1. Register event handlers via $.on                         │
│  2. Register schedules via $.every                           │
│  3. Use $.send/$.try/$.do for actions                        │
└────────────────────────┬────────────────────────────────────┘
                         │
┌─────────────────────────────────────────────────────────────┐
│  Runtime Execution                                           │
│  1. Events trigger matching handlers                         │
│  2. Alarms trigger scheduled tasks                           │
│  3. Actions execute with configured durability               │
└─────────────────────────────────────────────────────────────┘
```

---

## MCP Integration

dotdo implements the **Model Context Protocol** (MCP) for AI tool integration.

### MCP Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  AI Assistant (Claude, GPT, etc.)                            │
└────────────────────────┬────────────────────────────────────┘
                         │ MCP Protocol
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  MCP Server (Hono)                                           │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  POST /mcp/initialize                                  │  │
│  │  • Return server capabilities                          │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  GET /mcp/tools                                        │  │
│  │  • List available tools                                │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  POST /mcp/tools/call                                  │  │
│  │  • Execute tool with parameters                        │  │
│  └───────────────────────────────────────────────────────┘  │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  DO Tools                                                    │
│  • things.create, things.get, things.update, things.delete   │
│  • events.emit, events.list                                  │
│  • relationships.create, relationships.findByFrom            │
│  • Custom tools via MCPTool interface                        │
└─────────────────────────────────────────────────────────────┘
```

### MCP Tool Definition

```typescript
export interface MCPTool {
  name: string
  description: string
  inputSchema: object      // JSON Schema
  execute: (params: unknown) => Promise<unknown>
}

// Example: Create Thing tool
const createThingTool: MCPTool = {
  name: 'things.create',
  description: 'Create a new Thing in the database',
  inputSchema: {
    type: 'object',
    properties: {
      type: { type: 'string', description: 'Thing type' },
      data: { type: 'object', description: 'Thing properties' }
    },
    required: ['type']
  },
  execute: async (params: any) => {
    return await things.create({
      $type: params.type,
      ...params.data
    })
  }
}
```

### MCP Server Setup

```typescript
import { createMCPServer } from '@dotdo/mcp'

const server = createMCPServer({
  name: 'dotdo-mcp',
  version: '0.0.1'
})

// Add DO tools
server.addTool({
  name: 'things.create',
  description: 'Create a Thing',
  inputSchema: { /* ... */ },
  execute: async (params) => {
    return await do.things.create(params)
  }
})

// Export as Worker
export default {
  fetch: server.fetch
}
```

### AI Integration

The MCP server allows AI assistants to interact with dotdo:

```
AI: Create a new customer named Alice
→ MCP: POST /mcp/tools/call
  { name: "things.create", arguments: { type: "Customer", data: { name: "Alice" } } }
← MCP: { content: [{ type: "text", text: '{"$id":"...", "$type":"Customer", "name":"Alice"}' }] }
AI: Customer created with ID: ...
```

See `mcp/` directory for full implementation.

---

## Deployment Model

dotdo applications deploy as **Cloudflare Workers** with **Durable Objects**.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Cloudflare Global Network (300+ cities)                     │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Worker (Stateless)                                     │ │
│  │  • Minimal passthrough                                  │ │
│  │  • Routes requests to DO by namespace                   │ │
│  │  • Hostname-based routing: tenant.api.dotdo.dev         │ │
│  └────────────────────┬───────────────────────────────────┘ │
│                       │                                      │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Durable Object (Stateful)                             │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │  Application Logic                                │  │ │
│  │  │  • DO class extends base                          │  │ │
│  │  │  • WorkflowContext ($)                            │  │ │
│  │  │  • Event handlers, schedules                      │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │  SQLite Storage (10GB)                            │  │ │
│  │  │  • Things, Events, Relationships                  │  │ │
│  │  │  • Single-threaded consistency                    │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Minimal Worker

The Worker is a thin passthrough to the DO:

```typescript
// api/index.ts - entire worker
export { DO } from '../objects/DO'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const hostParts = url.hostname.split('.')

    // Extract namespace from subdomain
    // tenant.api.dotdo.dev → namespace: "tenant"
    const ns = hostParts.length > 2 ? hostParts[0] : 'default'

    // Get or create DO instance
    const id = env.DO.idFromName(ns)
    const stub = env.DO.get(id)

    // Forward request to DO
    return stub.fetch(request)
  }
}
```

### Wrangler Configuration

```toml
name = "dotdo-app"
main = "api/index.ts"
compatibility_date = "2024-01-01"

[[durable_objects.bindings]]
name = "DO"
class_name = "DO"
script_name = "dotdo-app"

[[migrations]]
tag = "v1"
new_classes = ["DO"]
```

### Deployment Flow

```
Developer                Wrangler                Cloudflare
    │                       │                        │
    │  wrangler deploy      │                        │
    ├──────────────────────>│                        │
    │                       │                        │
    │                       │  Build & bundle        │
    │                       │  TypeScript → JS       │
    │                       │                        │
    │                       │  Upload to API         │
    │                       ├───────────────────────>│
    │                       │                        │
    │                       │                Deploy  │
    │                       │               to edge  │
    │                       │                        │
    │                       │   Success              │
    │<──────────────────────┤                        │
    │                       │                        │
    │  https://tenant.api.dotdo.dev                  │
    │<───────────────────────────────────────────────┤
```

### Namespace Isolation

Each tenant gets an isolated DO namespace:

```
tenant-a.api.dotdo.dev  → DO namespace: "tenant-a"
tenant-b.api.dotdo.dev  → DO namespace: "tenant-b"
default.api.dotdo.dev   → DO namespace: "default"
```

This provides:
- **Data isolation** - Each tenant's data in separate DO
- **Independent scaling** - DOs scale independently
- **Geographic pinning** - Data stays in configured jurisdiction

---

## Security Considerations

### Principle of Least Privilege

Each DO namespace is isolated with no cross-namespace access by default.

```typescript
// Cannot access other namespaces directly
const otherDO = env.DO.idFromName('other-tenant')  // ❌ No access

// Must use explicit RPC with authentication
const result = await $.TenantDO('other-tenant').method()  // ✓ Authenticated
```

### Authentication & Authorization

```typescript
// auth/middleware.ts
export function authMiddleware() {
  return async (c, next) => {
    const token = c.req.header('Authorization')?.replace('Bearer ', '')

    if (!token) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    // Verify JWT
    const user = await verifyToken(token)

    // Set user context
    c.set('user', user)

    await next()
  }
}

// Usage in DO
this.app.use('/api/*', authMiddleware())
```

### RPC Security

Cross-DO RPC includes authentication headers:

```typescript
// rpc/client.ts
export class RPCClient {
  async call(method: string, args: unknown[]) {
    const token = await getAuthToken()

    const response = await fetch(`${this.url}/rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ method, args })
    })

    return response.json()
  }
}
```

### SQL Injection Prevention

All storage operations use **parameterized queries**:

```typescript
// ✓ Safe - parameterized
const thing = await db.prepare(
  'SELECT * FROM things WHERE $id = ?'
).bind(id).first()

// ❌ Unsafe - string concatenation
const thing = await db.prepare(
  `SELECT * FROM things WHERE $id = '${id}'`  // DON'T DO THIS
).first()
```

### Rate Limiting

```typescript
// Use DO state for rate limiting
export class RateLimitedDO extends DO {
  async fetch(request: Request) {
    const ip = request.headers.get('CF-Connecting-IP')

    // Check rate limit (100 requests/minute)
    const count = await this.state.storage.get(`ratelimit:${ip}`) ?? 0

    if (count >= 100) {
      return new Response('Rate limit exceeded', { status: 429 })
    }

    // Increment counter
    await this.state.storage.put(`ratelimit:${ip}`, count + 1, {
      expirationTtl: 60  // 1 minute
    })

    return super.fetch(request)
  }
}
```

### Content Security Policy

```typescript
// api/app.ts
app.use('*', async (c, next) => {
  await next()

  // Add security headers
  c.res.headers.set('X-Content-Type-Options', 'nosniff')
  c.res.headers.set('X-Frame-Options', 'DENY')
  c.res.headers.set('X-XSS-Protection', '1; mode=block')
  c.res.headers.set('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'"
  )
})
```

### Secret Management

```typescript
// Secrets from Wrangler
interface Env {
  STRIPE_SECRET_KEY: string
  DATABASE_URL: string
  JWT_SECRET: string
}

// Access via env
const stripe = new Stripe(env.STRIPE_SECRET_KEY)

// Never hardcode secrets
// ❌ const key = 'sk_live_...'
```

### CORS Configuration

```typescript
// Explicit CORS configuration
import { cors } from 'hono/cors'

app.use('/*', cors({
  origin: ['https://app.example.com'],
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400
}))
```

---

## Related Documentation

- **CLAUDE.md** - Development guidelines and conventions
- **.worktrees/v1/ARCHITECTURE.md** - Detailed v1 architecture (reference)
- **.worktrees/v1/db/ARCHITECTURE.md** - Database architecture deep dive
- **primitives/ARCHITECTURE.md** - Extended primitives architecture
- **MCP Specification** - https://modelcontextprotocol.io

---

## Appendix: Key Design Decisions

### Why Single-Threaded?

Durable Objects are **single-threaded by design**, eliminating:
- Race conditions
- Deadlocks
- Complex locking mechanisms
- Distributed transactions

This simplifies reasoning and guarantees consistency.

### Why SQLite?

SQLite provides:
- **ACID transactions** - Atomic, consistent, isolated, durable
- **10GB storage** - Sufficient for most entities
- **Sub-millisecond queries** - In-process, no network
- **Mature ecosystem** - Battle-tested, well-documented

### Why Cap'n Proto RPC?

Promise pipelining reduces latency:
- **Traditional RPC**: N sequential round trips
- **Pipeline RPC**: 1 round trip for entire chain
- **Bandwidth savings**: Send entire pipeline at once

### Why Graph Storage?

Graph-based storage (Things + Relationships) enables:
- **Flexible schemas** - No migrations for property changes
- **Natural queries** - Traverse relationships directly
- **Event sourcing** - Append-only event log
- **Audit trail** - Complete history of changes

### Why MCP?

Model Context Protocol provides:
- **Standardized AI integration** - Works with any MCP client
- **Tool discovery** - AI learns available capabilities
- **Type safety** - JSON Schema for inputs/outputs
- **Vendor neutral** - Not tied to specific AI provider

---

*This document reflects the v3 architecture. See `.worktrees/v1/` and `.worktrees/v2/` for previous versions.*
