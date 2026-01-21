# Package Boundaries and Ownership

This document defines the cross-package boundaries, ownership areas, and import rules for the dotdo monorepo.

## Package Dependency Graph

```
                        ┌──────────────────────────────────────┐
                        │               dotdo                  │
                        │         (main package)               │
                        │  Re-exports all @dotdo/* packages    │
                        └──────────────────────────────────────┘
                                         │
         ┌───────────────────────────────┼───────────────────────────────┐
         │                               │                               │
         ▼                               ▼                               ▼
┌─────────────────┐           ┌─────────────────┐           ┌─────────────────┐
│   @dotdo/api    │           │   @dotdo/mcp    │           │   @dotdo/app    │
│  (HATEOAS API)  │           │  (MCP Server)   │           │  (TanStack UI)  │
└─────────────────┘           └─────────────────┘           └─────────────────┘
         │                               │
         │                               │
         ▼                               ▼
┌─────────────────┐           ┌─────────────────┐
│   @dotdo/do     │◄──────────┤   @dotdo/do     │
│(Durable Object) │           │   @dotdo/db     │
└─────────────────┘           └─────────────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌───────┐ ┌───────┐
│@dotdo/│ │@dotdo/│
│  db   │ │  rpc  │
└───────┘ └───────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                              Leaf Packages                                  │
│  (No @dotdo/* dependencies - depend only on external packages)              │
│                                                                             │
│   @dotdo/db      @dotdo/rpc       @dotdo/ai        @dotdo/auth              │
│   @dotdo/utils   @dotdo/oauth     @dotdo/observability                      │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Package Dependency Matrix

| Package | Dependencies | Dependents |
|---------|-------------|------------|
| `@dotdo/db` | None | `@dotdo/do`, `@dotdo/mcp`, `dotdo` |
| `@dotdo/rpc` | capnweb, hono | `@dotdo/do`, `dotdo` |
| `@dotdo/ai` | hono, js-tiktoken | `dotdo` |
| `@dotdo/auth` | hono, jose, id.org.ai | `@dotdo/api`, `dotdo` |
| `@dotdo/oauth` | hono | `dotdo` |
| `@dotdo/utils` | None | Internal utilities |
| `@dotdo/observability` | hono | Internal utilities |
| `@dotdo/do` | `@dotdo/db`, `@dotdo/rpc`, ai-evaluate | `@dotdo/api`, `@dotdo/mcp`, `dotdo` |
| `@dotdo/api` | `@dotdo/auth`, `@dotdo/do`, hono | `dotdo` |
| `@dotdo/mcp` | `@dotdo/db`, `@dotdo/do`, hono | `dotdo` |
| `@dotdo/app` | TanStack, React, fumadocs | `dotdo` |
| `@dotdo/integrations` | None | `@dotdo/do` |
| `@dotdo/test-utils` | None (peer: vitest, miniflare) | Test files |
| `dotdo` | All @dotdo/* packages | End users |

## Package Ownership and Responsibilities

### Core Runtime Layer

#### @dotdo/db - Abstract Storage Layer
**Owner:** Database Team
**Responsibility:** Persistent storage primitives

| Scope | Description |
|-------|-------------|
| Things | Entity storage with CRUD operations |
| Relationships | Graph relationships between entities |
| Events | Event log with cursor-based pagination |
| Query Builder | Fluent query construction with joins |
| SQLite Adapter | Cloudflare D1/DO SQLite integration |
| Migrations | Schema versioning and migration runner |
| Audit Log | Activity tracking and compliance logging |

**Public API:**
- `createThingsStoreWithAdapter()`, `createEventsStoreWithAdapter()`, `createRelationshipsStoreWithAdapter()`
- `createQuery()`, `createQueryWithJoins()`
- `SQLiteAdapter`, `MigrationRunner`
- Type exports: `Thing`, `Event`, `Relationship`, `JsonValue`, `StorableData`

**Internal API (not for external consumption):**
- Raw SQL execution helpers
- Low-level adapter internals
- Migration state management internals

---

#### @dotdo/rpc - Cap'n Web RPC Layer
**Owner:** Infrastructure Team
**Responsibility:** All communication layers

| Scope | Description |
|-------|-------------|
| Client | RPC client for workers and browsers |
| Server | RPC server with Hono integration |
| Cross-DO | DO-to-DO RPC with stub caching |
| Pipeline | Request pipelining for batch optimization |
| Batch RPC | Parallel RPC execution |
| Error Handling | Typed errors with retry logic |
| Rate Limiting | Per-method rate limiting |

**Public API:**
- `createClient()`, `createDOStub()`, `createSecureDOStub()`
- `createServer()`, `createWorkerFromTarget()`
- `createCrossDOClient()`, `CrossDOStubCache`
- `createPipeline()`, `executeBatchRPC()`
- Error classes: `RPCError`, `NotFoundError`, `ValidationError`, etc.

**Internal API:**
- Transport layer internals
- Header manipulation utilities
- Correlation ID generation

---

#### @dotdo/do - Durable Object Runtime
**Owner:** Platform Team
**Responsibility:** Durable Object lifecycle and capabilities

| Scope | Description |
|-------|-------------|
| DO Class | Base Durable Object with entity stores |
| WorkflowContext ($) | Fluent DSL for events, scheduling, RPC |
| Mixins | Composable DO capabilities (Storage, WebSocket, RPC, Auth) |
| Event Handlers | $.on.Noun.verb pattern matching |
| Scheduling | $.every DSL for cron-like scheduling |
| WebSocket | Connection management with hibernation |
| Sharding | Load-balanced routing across DO instances |
| Circuit Breaker | Failure isolation patterns |
| Graceful Degradation | Fallback handling for DO unavailability |

**Public API:**
- `DO` class, `DOEnv`, `DOOptions`
- `createContext()`, `createTypedContext()`
- Mixins: `WithStorage`, `WithWebSocket`, `WithRPC`, `WithAuth`
- `createOnProxy()`, `createEveryProxy()`
- `ShardRouter`, `LoadBalancedRouter`, `HealthAwareRouter`
- `CircuitBreaker`, `CircuitBreakerRegistry`
- `WebSocketManager`, `HibernationManager`, `SessionManager`

**Internal API:**
- Handler implementations (StorageHandler, RPCHandler, WebSocketHandler)
- Type generation internals
- Interpreter for _eval() sandbox

---

### Application Layer

#### @dotdo/api - Self-Describing Hono API
**Owner:** API Team
**Responsibility:** HATEOAS-compliant REST API

| Scope | Description |
|-------|-------------|
| Resource Definition | Fluent DSL for REST resources |
| HATEOAS | Hypermedia link generation |
| OpenAPI | Automatic spec generation |
| Code Generation | SDK, CLI, MCP tool generation |
| Rate Limiting | Request-level rate limiting |

**Public API:**
- `createAPI()`, `defineResource()`
- `generateLinks()`, `generateCollectionLinks()`, `generateAPIRoot()`
- `generateOpenAPI()`, `OpenAPIGenerator`
- `generateSDK()`, `generateMCPTools()`
- `RateLimiter`, `rateLimitMiddleware`

**Internal API:**
- Resource registry internals
- OpenAPI schema mapping

---

#### @dotdo/auth - Authentication and Authorization
**Owner:** Security Team
**Responsibility:** Identity and access control

| Scope | Description |
|-------|-------------|
| JWT | Token validation with jose |
| JWKS | JSON Web Key Set support |
| API Keys | Key generation and validation |
| Sessions | Session management |
| RBAC | Role-based access control |
| Guards | Permission checking middleware |
| Revocation | Token revocation tracking |

**Public API:**
- `authMiddleware()`, `apiKeyMiddleware()`
- Guards: `requireAuth`, `requireRole`, `requireScope`, `requireOwner`
- `validateToken()`, `verifyTokenWithJwks()`
- `ApiKeyManager`, `ApiKeyAuth`
- `PolicyEngine`, `rbacMiddleware()`

**Internal API:**
- Token extraction utilities
- HMAC signing internals

---

#### @dotdo/mcp - Model Context Protocol Server
**Owner:** AI Integration Team
**Responsibility:** AI agent tool interface

| Scope | Description |
|-------|-------------|
| MCP Server | Tool server implementation |
| Built-in Tools | search, fetch, do, sandbox |
| Sandbox | Isolated code execution |
| Discovery | Tool registry and categories |

**Public API:**
- `createMCPServer()`
- `searchTool`, `fetchTool`, `doTool`, `createSandboxTool()`
- `createSandbox()`, `SandboxResourceEnforcer`
- `ToolRegistry`, `createDefaultRegistry()`

**Internal API:**
- Tool execution internals
- Resource limit enforcement

---

#### @dotdo/ai - AI Routing Layer
**Owner:** AI Team
**Responsibility:** LLM integration and routing

| Scope | Description |
|-------|-------------|
| Template Literals | ai\`prompt\` syntax |
| Provider Routing | Multi-provider support |
| Streaming | SSE response streaming |
| Token Counting | Tiktoken integration |
| Fallback | Provider failover logic |

**Public API:**
- `ai` template literal function
- `generateText()`, `generateObject()`, `streamText()`, `embedText()`
- `configureProvider()`, `getProvider()`
- `countMessageTokens()`, `getModelPricing()`
- `createTool()`

**Internal API:**
- Provider implementation details
- Stream parsing internals

---

### Utility Packages

#### @dotdo/utils
**Owner:** Platform Team
**Responsibility:** Shared utilities

- Logger utilities
- Common type helpers

#### @dotdo/observability
**Owner:** Platform Team
**Responsibility:** Monitoring and tracing

- Hono middleware for telemetry
- Request tracing

#### @dotdo/oauth
**Owner:** Security Team
**Responsibility:** OAuth 2.1 + PKCE

- PKCE flow implementation
- State management
- Provider integrations

#### @dotdo/integrations
**Owner:** Integrations Team
**Responsibility:** Third-party service connectors

- Stripe integration
- SendGrid integration
- Integration registry pattern

#### @dotdo/test-utils
**Owner:** Platform Team
**Responsibility:** Testing infrastructure

- DO stub helpers
- Factory functions
- Miniflare integration

---

### Main Package

#### dotdo
**Owner:** Platform Team
**Responsibility:** Unified consumer interface

- Re-exports all @dotdo/* packages
- CLI entry point
- SDK exports for consumers

## Import Rules

### Allowed Import Directions

```
┌─────────────────────────────────────────────────────────────────────────┐
│ RULE 1: Leaf packages cannot import other @dotdo/* packages             │
├─────────────────────────────────────────────────────────────────────────┤
│ @dotdo/db      → external only (no @dotdo/*)                           │
│ @dotdo/rpc     → external only (capnweb, hono)                         │
│ @dotdo/ai      → external only (hono, js-tiktoken)                     │
│ @dotdo/auth    → external only (hono, jose)                            │
│ @dotdo/utils   → external only                                          │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ RULE 2: Middle layer can only import leaf packages                      │
├─────────────────────────────────────────────────────────────────────────┤
│ @dotdo/do      → @dotdo/db, @dotdo/rpc (leaf packages only)            │
│ @dotdo/api     → @dotdo/auth, @dotdo/do                                │
│ @dotdo/mcp     → @dotdo/db, @dotdo/do                                  │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ RULE 3: Top-level package imports all                                   │
├─────────────────────────────────────────────────────────────────────────┤
│ dotdo          → All @dotdo/* packages (aggregation layer)             │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│ RULE 4: No circular dependencies                                        │
├─────────────────────────────────────────────────────────────────────────┤
│ If A imports B, B cannot import A (directly or transitively)           │
└─────────────────────────────────────────────────────────────────────────┘
```

### Prohibited Imports

| From Package | Cannot Import |
|--------------|---------------|
| `@dotdo/db` | Any @dotdo/* package |
| `@dotdo/rpc` | Any @dotdo/* package |
| `@dotdo/ai` | Any @dotdo/* package |
| `@dotdo/auth` | `@dotdo/do`, `@dotdo/api`, `@dotdo/mcp` |
| `@dotdo/do` | `@dotdo/api`, `@dotdo/mcp`, `@dotdo/app` |
| `@dotdo/api` | `@dotdo/mcp`, `@dotdo/app` |
| `@dotdo/mcp` | `@dotdo/api`, `@dotdo/app` |

### Type-Only Imports

Type-only imports (`import type`) may cross boundaries for interface definitions, but runtime code must respect the dependency graph.

```typescript
// ALLOWED: Type-only import for interface definition
import type { ThingsStore } from '@dotdo/db'

// FORBIDDEN: Runtime import from prohibited package
import { createThingsStore } from '@dotdo/db' // Not allowed in @dotdo/rpc
```

## Public vs Internal API Guidelines

### Marking Internal APIs

Internal APIs should be:
1. Not exported from the package's `index.ts`
2. Prefixed with `_` if exported for testing purposes
3. Documented with `@internal` JSDoc tag

```typescript
/**
 * @internal
 * This function is for internal use only
 */
export function _internalHelper() {}
```

### Stable Public API Contract

Public APIs must:
1. Be exported from `index.ts`
2. Have JSDoc documentation
3. Follow semver for breaking changes
4. Include type exports for all public interfaces

### Deprecation Process

1. Add `@deprecated` JSDoc tag with migration path
2. Log deprecation warning at runtime (once per session)
3. Maintain for at least 2 minor versions
4. Remove in next major version

```typescript
/**
 * @deprecated Use `createCircuitBreakerRegistry()` instead.
 * Will be removed in v4.0.0
 */
export function getGlobalCircuitBreakerRegistry() {
  console.warn('getGlobalCircuitBreakerRegistry is deprecated...')
  // ...
}
```

## Cross-Cutting Concerns

### Shared Types

Common types like `JsonValue`, `StorableData` are defined in `@dotdo/db` and re-exported through `@dotdo/do` and `dotdo` for convenience.

### Error Hierarchy

- `@dotdo/db`: `DotdoError`, `DatabaseError`, `ValidationError` (db-specific)
- `@dotdo/rpc`: `RPCError`, `NetworkError`, `TimeoutError` (transport-specific)
- Each layer should define errors appropriate to its domain

### Request Context

Request-scoped context should use `AsyncLocalStorage` patterns:
- `runWithResourceContext()` in `@dotdo/api`
- `runWithCircuitBreakerRegistry()` in `@dotdo/do`

This prevents global state leakage across concurrent requests.

## Adding New Packages

When adding a new package:

1. **Determine layer**: Is it leaf, middle, or utility?
2. **Define dependencies**: Only import from allowed packages
3. **Export through dotdo**: Add re-exports to `dotdo/index.ts`
4. **Document ownership**: Add entry to this document
5. **Add to workspace**: Update root `package.json` workspaces

## Enforcement

Package boundaries are enforced through:

1. **TypeScript paths**: Each package has its own `tsconfig.json`
2. **pnpm workspace**: Dependencies declared in `package.json`
3. **Code review**: Architectural violations caught in PR review
4. **CI checks**: Build failures for undeclared dependencies

---

*Last updated: 2026-01-21*
*Issue: do-wx5b*
