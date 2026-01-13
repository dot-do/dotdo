---
title: DOBase Architecture and Decomposition
description: Architecture of the Durable Object class hierarchy in dotdo, with focus on DOBase, extension points, mixin system, and migration guidance.
---

This document describes the architecture of the Durable Object class hierarchy in dotdo, with focus on DOBase (exported as `DO`), its extension points, mixin system, and migration guidance.

## Class Hierarchy Overview

```
                              DurableObject (Cloudflare)
                                       │
                                       ▼
                              ┌─────────────────┐
                              │     DOTiny      │  ~15KB - Minimal base
                              │   (DO export)   │  Identity, Storage, fetch()
                              └─────────────────┘
                                       │
                                       ▼
                              ┌─────────────────┐
                              │     DOBase      │  ~120KB - Full features
                              │   (DO export)   │  WorkflowContext, Stores, Events
                              └─────────────────┘
                                       │
                                       ▼
                              ┌─────────────────┐
                              │     DOFull      │  ~200KB - Lifecycle ops
                              │   (DO export)   │  Clone, Branch, Shard
                              └─────────────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              │            │           │           │            │
              ▼            ▼           ▼           ▼            ▼
         ┌────────┐   ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐
         │Business│   │  App   │  │  Site  │  │ Worker │  │ Entity │
         └────────┘   └────────┘  └────────┘  └────────┘  └────────┘
              │                                    │            │
              ▼                                    ▼            ▼
    ┌──────────────────┐                     ┌────────┐   ┌────────────┐
    │ DigitalBusiness  │                     │ Agent  │   │ Collection │
    └──────────────────┘                     ├────────┤   ├────────────┤
              │                              │ Human  │   │ Directory  │
              ▼                              └────────┘   └────────────┘
         ┌────────┐
         │  SaaS  │
         └────────┘
```

## Core Classes

### DOTiny (`objects/DOTiny.ts`)

The smallest possible Durable Object implementation (~15KB). Use when bundle size is critical.

**Provides:**
- Identity (`ns`, `$type`)
- Storage (Drizzle/SQLite via `this.db`)
- `fetch()` with `/health` endpoint
- `initialize()` method
- `toJSON()` serialization
- User context extraction from `X-User-*` headers
- Type hierarchy methods (`isType()`, `extendsType()`, `isInstanceOfType()`)

**Does NOT provide:**
- WorkflowContext (`$`)
- Event handlers (`$.on`)
- Stores (things, rels, actions, events, search, objects, dlq)
- Scheduling (`$.every`, alarm)
- Built-in Hono routing

```typescript
import { DO } from 'dotdo/tiny'

class MyTinyDO extends DO {
  async fetch(request: Request): Promise<Response> {
    // Minimal DO - implement your own routing
  }
}
```

### DOBase (`objects/DOBase.ts`)

The standard Durable Object with full WorkflowContext support (~120KB). This is the default export.

**Extends DOTiny with:**
- WorkflowContext (`this.$`) - Full DSL for actions, events, scheduling
- Event handlers (`$.on.Noun.verb()`)
- All stores (things, rels, actions, events, search, objects, dlq)
- Scheduling (`$.every.day.at9am()`, alarm handling)
- Actor context
- Collection accessors
- Event emission and dispatch
- OKR (Objectives & Key Results) framework
- Location detection and caching
- Iceberg state persistence (R2 snapshots)
- Cross-DO RPC with circuit breakers
- MCP (Model Context Protocol) support
- RPC server (JSON-RPC 2.0)
- WebSocket sync engine (TanStack DB)
- REST router for CRUD operations
- Cap'n Web RPC at root endpoint
- Introspection (`$introspect`)

```typescript
import { DO } from 'dotdo'

class MyDO extends DO {
  async onStart() {
    // Register event handlers
    this.$.on.Customer.created(async (event) => {
      await this.$.do('sendWelcomeEmail', event.data)
    })

    // Schedule recurring tasks
    this.$.every.hour(async () => {
      await this.$.do('healthCheck')
    })
  }
}
```

### DOFull (`objects/DOFull.ts`)

Full-featured DO with lifecycle operations (~200KB). Use when you need advanced operations.

**Extends DOBase with:**
- Fork, Clone, Compact, Move operations
- Sharding (shard, unshard, routing)
- Branching (branch, checkout, merge)
- Promotion (promote, demote)
- Staged clone operations (two-phase commit)
- Eventual consistency replication
- Resumable clone operations

```typescript
import { DO } from 'dotdo/full'

class MyFullDO extends DO {
  async backup() {
    await this.clone('https://backup.example.com')
  }

  async experiment() {
    await this.branch('feature-x')
    // Make changes...
    await this.merge('feature-x')
  }
}
```

## Extension Points

### 1. Static Configuration

#### `static $type`
Type discriminator for the DO class. Used in serialization and type checking.

```typescript
class Customer extends DO {
  static readonly $type = 'Customer'
}
```

#### `static $mcp`
MCP (Model Context Protocol) configuration for exposing methods as tools.

```typescript
class SearchableDO extends DO {
  static $mcp = {
    tools: {
      search: {
        description: 'Search items',
        inputSchema: { query: { type: 'string' } },
        required: ['query'],
        visibility: 'user', // Role-based access
      },
    },
    resources: ['items', 'users'],
  }
}
```

#### `static $rest`
REST endpoint configuration for schema introspection.

```typescript
class ApiDO extends DO {
  static $rest = {
    endpoints: [
      { method: 'GET', path: '/items', description: 'List items' },
      { method: 'POST', path: '/items', description: 'Create item' },
    ],
  }
}
```

#### `static capabilities`
Array of capability names supported by the class. Populated by mixins.

```typescript
// Populated automatically by mixins
// MyDO.capabilities === ['fs', 'git', 'bash']
```

### 2. Lifecycle Hooks

Override these methods to customize DO behavior:

```typescript
class MyDO extends DO {
  // Called when location is first detected
  protected async onLocationDetected(location: DOLocation): Promise<void> {
    console.log(`DO running in ${location.city}`)
  }

  // Called after state is loaded from Iceberg
  // Use this.on('stateLoaded', callback) instead
}
```

### 3. Execution Customization

```typescript
class MyDO extends DO {
  // Override action execution
  protected async executeAction(action: string, data: unknown): Promise<unknown> {
    switch (action) {
      case 'customAction':
        return this.handleCustomAction(data)
      default:
        return super.executeAction(action, data)
    }
  }

  // Override retry policy
  protected static readonly DEFAULT_RETRY_POLICY = {
    maxAttempts: 5,        // More retries
    initialDelayMs: 200,
    maxDelayMs: 60000,
    backoffMultiplier: 2,
    jitter: true,
  }
}
```

### 4. HTTP Routing Extension

```typescript
class MyDO extends DO {
  // Override fetch handling
  protected override async handleFetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Custom routes
    if (url.pathname === '/custom') {
      return this.handleCustomRoute(request)
    }

    // Fall back to default handling
    return super.handleFetch(request)
  }

  // Or use Hono app
  protected app = new Hono()
    .get('/custom', (c) => c.json({ custom: true }))
}
```

### 5. Auth Token Validation

```typescript
class SecureDO extends DO {
  protected async validateSyncAuthToken(token: string): Promise<{ user: UserContext } | null> {
    // Custom JWT validation
    const claims = await verifyJWT(token, this.env.JWT_SECRET)
    if (!claims) return null

    return {
      user: {
        id: claims.sub,
        email: claims.email,
        role: claims.role,
      },
    }
  }
}
```

## Mixin Architecture

Mixins add optional capabilities to DO classes without modifying the base class.

### Creating a Custom Capability

```typescript
import { createCapability, type CapabilityContext } from 'dotdo/mixins'

// Define the capability API
interface MyCapability {
  doSomething(): Promise<void>
  getSomething(): string
}

// Create the capability mixin
export const withMyCapability = createCapability<'my', MyCapability>(
  'my',
  (ctx: CapabilityContext): MyCapability => ({
    async doSomething() {
      // Access DO state via ctx.state
      await ctx.state.storage.put('key', 'value')
    },
    getSomething() {
      return 'something'
    },
  })
)
```

### Using Capabilities

```typescript
import { DO } from 'dotdo'
import { withFs, withGit, withBash } from 'dotdo/mixins'

// Compose capabilities (order matters for dependency resolution)
class DevDO extends withBash(withGit(withFs(DO))) {
  async setup() {
    // Access capabilities via $
    await this.$.fs.write('/config.json', '{}')
    await this.$.git.commit('Initial setup')
    await this.$.bash.exec('npm install')
  }
}

// Check for capabilities at runtime
if (this.hasCapability('fs')) {
  await this.$.fs.read('/config.json')
}
```

### Available Mixins

| Mixin | Capability | Description |
|-------|------------|-------------|
| `withFs` | `$.fs` | Filesystem on SQLite (fsx) |
| `withGit` | `$.git` | Git on R2 (gitx) |
| `withBash` | `$.bash` | Shell without VMs (bashx) |
| `withNpm` | `$.npm` | Package management |
| `withPrimitives` | `$.primitives` | TemporalStore, WindowManager, ExactlyOnceContext |

### Mixin Implementation Details

The mixin system uses:

1. **Symbol-based storage** - Capability cache and init functions stored via Symbols
2. **Proxy wrapping** - `$` getter returns a Proxy that intercepts capability access
3. **Lazy initialization** - Capabilities created on first access
4. **Idempotency** - Applying same mixin twice is safe
5. **Composability** - Multiple mixins can be chained

```typescript
// Internal structure
const CAPABILITY_CACHE = Symbol.for('dotdo.capabilityCache')
const CAPABILITY_INITS = Symbol.for('dotdo.capabilityInits')

// When accessing this.$.fs:
// 1. Check CAPABILITY_CACHE for existing instance
// 2. If not found, call init function from CAPABILITY_INITS
// 3. Cache and return the capability
```

## Store Architecture

All stores are lazy-initialized on first access:

| Store | Purpose | Table(s) |
|-------|---------|----------|
| `this.things` | CRUD for Things | `things`, `nouns` |
| `this.rels` | Relationships | `relationships` |
| `this.actions` | Action lifecycle | `actions` |
| `this.events` | Event streaming | `events` |
| `this.search` | Full-text search | `search` |
| `this.objects` | DO registry | `objects` |
| `this.dlq` | Dead letter queue | `dlq` |

### Eager Initialization

Use `DO.with()` to eagerly initialize specific stores:

```typescript
// Default: all stores lazy-initialized
class LazyDO extends DO { }

// Eager: search and vectors initialized on DO creation
class SearchableDO extends DO.with({ search: true, vectors: true }) { }

// All stores eager
class FullFeaturedDO extends DO.with({
  things: true,
  relationships: true,
  actions: true,
  events: true,
  search: true,
  vectors: true,
  objects: true,
  dlq: true,
}) { }
```

## WorkflowContext ($)

The `$` property provides the workflow DSL:

### Execution Modes

```typescript
// Fire-and-forget (non-blocking, non-durable)
this.$.send('notify', { message: 'Hello' })

// Single attempt (blocking, non-durable)
const result = await this.$.try('validate', data, { timeout: 5000 })

// Durable execution (blocking, with retries)
const result = await this.$.do('process', data, {
  retry: {
    maxAttempts: 5,
    initialDelayMs: 100,
  },
})
```

### Event Handlers

```typescript
// Exact match
this.$.on.Customer.created(async (event) => { ... })

// Wildcards
this.$.on.Customer['*'](async (event) => { ... })  // Any verb
this.$.on['*'].created(async (event) => { ... })   // Any noun
this.$.on['*']['*'](async (event) => { ... })      // All events

// With options
this.$.on.Payment.failed(
  async (event) => { ... },
  {
    priority: 10,
    name: 'paymentFailureHandler',
    filter: async (event) => event.data.amount > 1000,
    maxRetries: 5,
  }
)
```

### Scheduling

```typescript
// Fluent DSL
this.$.every.Monday.at9am(async () => { ... })
this.$.every.day.at('6pm')(async () => { ... })
this.$.every.hour(async () => { ... })
this.$.every(15).minutes(async () => { ... })
```

### Domain Proxies (Cross-DO RPC)

```typescript
// Call methods on other DOs
const result = await this.$.Customer('cust-123').notify({ message: 'Hello' })

// With circuit breaker protection (automatic)
// - 5 failures opens circuit
// - 30s reset timeout
// - Automatic retries with exponential backoff
```

## HTTP Endpoints

DOBase provides these built-in endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | JSON-LD index with collections |
| `/` | POST | Cap'n Web RPC (HTTP batch) |
| `/` | WebSocket | Cap'n Web RPC (persistent) |
| `/health` | GET | Health check |
| `/rpc` | POST | JSON-RPC 2.0 |
| `/rpc` | WebSocket | RPC streaming |
| `/sync` | WebSocket | TanStack DB sync |
| `/mcp` | POST | MCP transport |
| `/resolve` | GET | Cross-DO resolution |
| `/$introspect` | GET | Schema introspection |
| `/:type` | GET/POST | REST list/create |
| `/:type/:id` | GET/PUT/PATCH/DELETE | REST CRUD |

## Migration Guidance

### From DOTiny to DOBase

```typescript
// Before: DOTiny
import { DO } from 'dotdo/tiny'

class MyDO extends DO {
  async fetch(request: Request) {
    // Manual routing
  }
}

// After: DOBase
import { DO } from 'dotdo'

class MyDO extends DO {
  async onStart() {
    // Use $ for event handling and scheduling
    this.$.on.Thing.created(handler)
    this.$.every.hour(handler)
  }
  // REST routes work automatically
}
```

### From DOBase to DOFull

```typescript
// Before: DOBase
import { DO } from 'dotdo'

class MyDO extends DO {
  // No lifecycle operations
}

// After: DOFull
import { DO } from 'dotdo/full'

class MyDO extends DO {
  async backup() {
    await this.clone('https://backup.ns')
  }

  async feature() {
    await this.branch('feature-x')
    // Changes...
    await this.merge('feature-x')
  }
}
```

### Adding Capabilities

```typescript
// Before: No file system
class MyDO extends DO { }

// After: With file system capability
import { withFs } from 'dotdo/mixins'

class MyDO extends withFs(DO) {
  async setup() {
    await this.$.fs.write('/config.json', '{}')
  }
}
```

### Switching to Eager Initialization

```typescript
// Before: Lazy (default)
class MyDO extends DO {
  async search(query: string) {
    // First call creates search table
    return this.search.query(query)
  }
}

// After: Eager (table created at DO start)
class MyDO extends DO.with({ search: true }) {
  async search(query: string) {
    // Table already exists
    return this.search.query(query)
  }
}
```

## Best Practices

1. **Start with DOTiny** when you need minimal bundle size and will implement your own routing.

2. **Use DOBase** (default) for most applications - it provides the full workflow DSL.

3. **Use DOFull** only when you need lifecycle operations (clone, branch, shard).

4. **Prefer lazy initialization** unless you know specific stores will be used immediately.

5. **Use mixins** for optional capabilities rather than subclassing.

6. **Override hooks** rather than constructor for customization.

7. **Use `DO.with()`** for eager store initialization when needed.

8. **Implement `validateSyncAuthToken()`** for production WebSocket sync.

9. **Configure `capnWebOptions`** to control stack trace exposure.

10. **Use `$introspect`** for schema discovery in clients.

## File Locations

- DOTiny: `/Users/nathanclevenger/projects/dotdo/objects/DOTiny.ts`
- DOBase: `/Users/nathanclevenger/projects/dotdo/objects/DOBase.ts`
- DOFull: `/Users/nathanclevenger/projects/dotdo/objects/DOFull.ts`
- Mixins: `/Users/nathanclevenger/projects/dotdo/objects/mixins/`
- Index: `/Users/nathanclevenger/projects/dotdo/objects/index.ts`
- Stores: `/Users/nathanclevenger/projects/dotdo/db/stores.ts`
- Transport: `/Users/nathanclevenger/projects/dotdo/objects/transport/`

---

## DOBase Decomposition Roadmap

**Current State (2026-01-13):** DOBase.ts is 3,879 lines, combining 9 distinct capabilities identified in the architecture review.

### Analysis: Capability Breakdown

| Capability | Lines (est.) | Status | Location |
|------------|-------------|--------|----------|
| **Stores** | ~200 | EXTRACTED | `objects/modules/StoresModule.ts`, `objects/services/StoreManager.ts` |
| **Transport/HTTP** | ~400 | EXTRACTED | `objects/transport/rest-router.ts`, `rpc-server.ts`, `mcp-server.ts`, `sync-engine.ts`, `capnweb-target.ts` |
| **WorkflowContext ($)** | ~150 | IN DOBase | Lines 1094-1162 |
| **Execution Modes** | ~200 | IN DOBase | Lines 1164-1407 (send, try, do) |
| **Event Handlers** | ~200 | IN DOBase | Lines 2352-2840 ($.on system) |
| **Scheduling** | ~50 | PARTIALLY EXTRACTED | `workflows/schedule-builder.ts`, `workflows/ScheduleManager.ts` |
| **Actor Context** | ~30 | IN DOBase | Lines 700-728 |
| **Iceberg Persistence** | ~450 | IN DOBase | Lines 1683-2131 |
| **Location Detection** | ~150 | IN DOBase | Lines 912-1072 |
| **Introspection** | ~200 | IN DOBase | Lines 3600-3816 |
| **Resolution** | ~120 | IN DOBase | Lines 2843-2962 |
| **Cross-DO RPC** | ~250 | IN DOBase | Lines 2428-2714 |
| **Visibility/Auth** | ~100 | IN DOBase | Lines 3037-3145 |
| **OKR Framework** | ~90 | IN DOBase | Lines 508-618 |
| **Collection Accessors** | ~150 | IN DOBase | Lines 2226-2346 |

### Extraction Priority

#### Phase 1: Low-Hanging Fruit (Week 1-2)

**1. LocationModule** (~150 lines)
Extract location detection and caching into standalone module.

```typescript
// objects/modules/LocationModule.ts
export class LocationModule {
  private _cachedLocation?: DOLocation
  private _locationHookCalled = false
  private _extractedCoordinates?: { lat: number; lng: number }

  async getLocation(): Promise<DOLocation>
  async _detectLocation(): Promise<DOLocation>
  extractCoordinatesFromRequest(request: Request): void
}
```

**2. ActorContextModule** (~30 lines)
Extract actor context management.

```typescript
// objects/modules/ActorContextModule.ts
export class ActorContextModule {
  private _currentActor = ''
  private _currentActorContext: { userId?: string; orgId?: string } = {}

  setActor(actor: string): void
  clearActor(): void
  getCurrentActor(): string
  setActorContext(actor: { userId?: string; orgId?: string }): void
  getActorContext(): { userId?: string; orgId?: string }
  clearActorContext(): void
}
```

**3. OKRModule** (~90 lines)
Extract OKR framework.

```typescript
// objects/modules/OKRModule.ts
export class OKRModule {
  okrs: Record<string, OKR> = {}

  defineOKR(definition: OKRDefinition): OKR
}
```

#### Phase 2: Core Workflow (Week 3-4)

**4. ExecutionModule** (~200 lines)
Extract send/try/do execution modes with retry logic.

```typescript
// objects/modules/ExecutionModule.ts
export class ExecutionModule {
  static readonly DEFAULT_RETRY_POLICY: RetryPolicy
  static readonly DEFAULT_TRY_TIMEOUT = 30000

  private _stepCache: Map<string, { result: unknown; completedAt: number }>

  send(event: string, data: unknown): void
  async try<T>(action: string, data: unknown, options?: TryOptions): Promise<T>
  async do<T>(action: string, data: unknown, options?: DoOptions): Promise<T>

  protected calculateBackoffDelay(attempt: number, policy: RetryPolicy): number
  protected generateStepId(action: string, data: unknown): string
  protected async persistStepResult(stepId: string, result: unknown): Promise<void>
  protected async loadPersistedSteps(): Promise<void>
}
```

**5. EventHandlerModule** (~200 lines)
Extract $.on system and event dispatch.

```typescript
// objects/modules/EventHandlerModule.ts
export class EventHandlerModule {
  private _eventHandlers: Map<string, HandlerRegistration[]>
  private _handlerCounter = 0

  createOnProxy(): OnProxy
  registerHandler(eventKey: string, handler: EventHandler, options?: HandlerOptions): void
  getEventHandlers(eventKey: string): Function[]
  getHandlersByPriority(eventKey: string): Array<{ handler: Function; priority: number }>
  async dispatchEventToHandlers(event: DomainEvent): Promise<EnhancedDispatchResult>
  unregisterEventHandler(eventKey: string, handler: Function): boolean
}
```

#### Phase 3: Persistence & Resolution (Week 5-6)

**6. IcebergModule** (~450 lines)
Extract Iceberg state persistence (largest single concern).

```typescript
// objects/modules/IcebergModule.ts
export class IcebergModule {
  private _snapshotSequence = 0
  private _r2Client?: AuthorizedR2Client
  private _icebergAdapter?: IcebergStateAdapter
  private _pendingChanges = 0
  private _lastCheckpointTimestamp = 0
  private _checkpointTimer?: ReturnType<typeof setInterval>
  private _icebergOptions: IcebergOptions = {}
  private _fencingToken?: string

  async loadFromIceberg(jwt?: string): Promise<void>
  async saveToIceberg(): Promise<void>
  configureIceberg(options: IcebergOptions): void
  async acquireFencingToken(): Promise<string>
  async releaseFencingToken(token: string): Promise<void>
  onDataChange(): void

  get pendingChanges(): number
  get lastCheckpointTimestamp(): number
  get hasFencingToken(): boolean
  get currentFencingToken(): string | undefined
}
```

**7. ResolutionModule** (~120 lines)
Extract URL resolution logic.

```typescript
// objects/modules/ResolutionModule.ts
export class ResolutionModule {
  async resolve(url: string): Promise<Thing>
  protected async resolveLocal(path: string, ref: string): Promise<Thing>
  protected async resolveCrossDO(ns: string, path: string, ref: string): Promise<Thing>
}
```

#### Phase 4: RPC & Auth (Week 7-8)

**8. CrossDORpcModule** (~250 lines)
Extract cross-DO RPC with circuit breakers.

```typescript
// objects/modules/CrossDORpcModule.ts
export class CrossDORpcModule {
  private static _circuitBreakers: Map<string, CircuitBreakerState>
  private static readonly CIRCUIT_BREAKER_CONFIG = { ... }
  private static readonly CROSS_DO_RETRY_CONFIG = { ... }
  private static readonly CROSS_DO_TIMEOUT_MS = 30000

  createDomainProxy(noun: string, id: string): DomainProxy
  async invokeDomainMethod(noun: string, id: string, method: string, args: unknown[]): Promise<unknown>
  async invokeCrossDOMethod(noun: string, id: string, method: string, args: unknown[], options?: { timeout?: number }): Promise<unknown>

  private checkCircuitBreaker(targetNs: string): 'closed' | 'open' | 'half-open'
  private recordCircuitBreakerSuccess(targetNs: string): void
  private recordCircuitBreakerFailure(targetNs: string): void

  static _resetTestState(): void
}
```

**9. VisibilityModule** (~100 lines)
Extract visibility/authorization helpers.

```typescript
// objects/modules/VisibilityModule.ts
export class VisibilityModule {
  canViewThing(thing: Thing | ThingEntity | null | undefined): boolean
  assertCanView(thing: Thing | ThingEntity | null | undefined, message?: string): void
  filterVisibleThings<T extends Thing | ThingEntity>(things: T[]): T[]
  async getVisibleThing(id: string): Promise<ThingEntity | null>
  getVisibility(thing: Thing | ThingEntity | null | undefined): 'public' | 'unlisted' | 'org' | 'user'
  isOwner(thing: Thing | ThingEntity | null | undefined): boolean
  isInThingOrg(thing: Thing | ThingEntity | null | undefined): boolean
}
```

**10. IntrospectionModule** (~200 lines)
Extract $introspect functionality.

```typescript
// objects/modules/IntrospectionModule.ts
export class IntrospectionModule {
  async $introspect(authContext?: AuthContext): Promise<DOSchema>

  private determineRole(authContext?: AuthContext): VisibilityRole
  private introspectClasses(role: VisibilityRole): DOClassSchema[]
  private introspectStores(role: VisibilityRole): StoreSchema[]
  private introspectStorage(role: VisibilityRole): StorageCapabilities
  private async introspectNouns(): Promise<IntrospectNounSchema[]>
  private async introspectVerbs(): Promise<VerbSchema[]>
}
```

### Module Integration Pattern

After extraction, DOBase becomes a thin orchestration layer:

```typescript
// objects/DOBase.ts (post-decomposition ~500 lines)
export class DO<E extends Env = Env> extends DOTiny<E> {
  // Injected modules
  protected readonly _location: LocationModule
  protected readonly _actor: ActorContextModule
  protected readonly _okr: OKRModule
  protected readonly _execution: ExecutionModule
  protected readonly _eventHandlers: EventHandlerModule
  protected readonly _iceberg: IcebergModule
  protected readonly _resolution: ResolutionModule
  protected readonly _crossDO: CrossDORpcModule
  protected readonly _visibility: VisibilityModule
  protected readonly _introspection: IntrospectionModule

  // WorkflowContext ($) - delegated proxy
  readonly $: WorkflowContext

  constructor(ctx: DurableObjectState, env: E) {
    super(ctx, env)

    // Initialize modules
    this._location = new LocationModule(ctx, env)
    this._actor = new ActorContextModule()
    // ... etc

    // Create delegating $ proxy
    this.$ = this.createWorkflowContext()
  }

  // Public accessors delegate to modules
  get things() { return this._stores.things }
  get rels() { return this._stores.rels }
  // ... etc

  // HTTP handling delegates to transport
  protected override async handleFetch(request: Request): Promise<Response> {
    // Minimal routing logic, delegates to transport modules
  }
}
```

### Benefits of Decomposition

1. **Testability**: Each module can be unit tested in isolation
2. **Maintainability**: Smaller files are easier to understand and modify
3. **Reusability**: Modules can be composed in different configurations
4. **Bundle Size**: Tree-shaking can eliminate unused modules
5. **Cognitive Load**: Developers only need to understand relevant modules
6. **Parallel Development**: Different teams can work on modules independently

### Migration Strategy

1. **Extract to separate files** without changing DOBase interface
2. **Add delegation** in DOBase to new modules
3. **Verify tests pass** after each extraction
4. **Deprecate direct access** to extracted code paths
5. **Document module boundaries** and interfaces

### Estimated Timeline

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| Phase 1 | 1-2 weeks | LocationModule, ActorContextModule, OKRModule |
| Phase 2 | 2 weeks | ExecutionModule, EventHandlerModule |
| Phase 3 | 2 weeks | IcebergModule, ResolutionModule |
| Phase 4 | 2 weeks | CrossDORpcModule, VisibilityModule, IntrospectionModule |
| Integration | 1 week | DOBase thin orchestrator, documentation |
| **Total** | **8-9 weeks** | Complete decomposition |

### Already Extracted

The following have already been moved to separate modules:

1. **StoreManager** (`objects/services/StoreManager.ts`) - Store lifecycle management
2. **StoresModule** (`objects/modules/StoresModule.ts`) - Alternative store accessor implementation
3. **REST Router** (`objects/transport/rest-router.ts`) - REST API handling
4. **RPC Server** (`objects/transport/rpc-server.ts`) - JSON-RPC 2.0 + Chain RPC
5. **MCP Server** (`objects/transport/mcp-server.ts`) - Model Context Protocol
6. **Sync Engine** (`objects/transport/sync-engine.ts`) - WebSocket sync for TanStack DB
7. **Cap'n Web Target** (`objects/transport/capnweb-target.ts`) - Promise pipelining
8. **Schedule Builder** (`workflows/schedule-builder.ts`) - Fluent CRON DSL
9. **Schedule Manager** (`workflows/ScheduleManager.ts`) - Alarm scheduling
10. **Iceberg State Adapter** (`objects/persistence/iceberg-state.ts`) - Snapshot serialization

### Remaining in DOBase (to extract)

From 3,879 lines, approximately **1,500-2,000 lines** remain embedded:
- WorkflowContext proxy creation (~70 lines)
- Execution modes (send/try/do) (~240 lines)
- Event handler registration & dispatch (~490 lines)
- Iceberg auto-checkpoint & fencing (~450 lines)
- Location detection & caching (~160 lines)
- Cross-DO RPC with circuit breakers (~290 lines)
- Resolution (local/cross-DO) (~120 lines)
- Visibility helpers (~110 lines)
- Introspection (~220 lines)
- Actor context (~50 lines)
- OKR framework (~110 lines)
- Collection accessors (~120 lines)
- HTTP handler routing (~130 lines)
