# DOBase Decomposition Architecture

## Executive Summary

This document analyzes the current DOBase.ts (~3,400 LOC, ~104KB) and proposes a decomposition strategy to enable tree-shaking and improve maintainability. The goal is to allow users to import only the functionality they need, reducing bundle sizes for simpler use cases.

---

## Current State Analysis

### File Statistics

| File | LOC | Size | Responsibilities |
|------|-----|------|------------------|
| `DOTiny.ts` | ~330 | ~15KB | Identity, storage, fetch, type discriminator |
| `DOBase.ts` | ~3,390 | ~104KB | WorkflowContext, stores, events, scheduling, RPC, REST, MCP |
| `DOFull.ts` | ~2,400 | ~70KB | Lifecycle (fork, clone, branch), sharding, 2PC |
| `DO.ts` | ~85 | ~3KB | Re-exports from DOFull for backward compatibility |

### Current Hierarchy

```
DurableObject (cloudflare:workers)
    |
    v
DOTiny (~15KB)
    - Identity (ns, $type)
    - Storage (Drizzle/SQLite)
    - fetch() + /health
    - initialize()
    - toJSON()
    - User context extraction
    |
    v
DOBase (~104KB) - THE PROBLEM
    - WorkflowContext ($)
    - Store accessors (things, rels, actions, events, search, objects, dlq)
    - Event handlers ($.on.Noun.verb)
    - Schedule management ($.every)
    - Execution modes (send, try, do)
    - Action logging
    - Event emission
    - Location detection
    - Cross-DO resolution
    - REST/GraphQL routing
    - MCP server integration
    - RPC server integration
    - Sync WebSocket handler
    - Introspection ($introspect)
    - Circuit breaker for cross-DO calls
    - Iceberg state persistence
    - Visibility/authorization
    |
    v
DOFull (~70KB)
    - Fork/Clone/Compact/Move
    - Branch/Checkout/Merge
    - Promote/Demote
    - Staged clone (2PC)
    - Eventual consistency replication
    - Resumable clones
    - Sharding (delegates to ShardModule)
    - Cross-DO resolution with caching
```

### DOBase Responsibility Analysis

DOBase currently handles 12+ distinct concerns:

| # | Responsibility | LOC Est. | Dependencies | Extractable? |
|---|----------------|----------|--------------|--------------|
| 1 | **WorkflowContext Creation** | ~70 | Proxy factories | Yes - Core |
| 2 | **Store Accessors** | ~150 | db, schema, StoreContext | Yes - Module |
| 3 | **Event Handlers** | ~200 | $.on proxy, DomainEvent | Yes - Module |
| 4 | **Schedule Management** | ~100 | $.every proxy, ScheduleManager | Yes - Module |
| 5 | **Execution Modes** | ~250 | send/try/do, retry logic | Yes - Module |
| 6 | **Action Logging** | ~200 | actions store, status updates | Yes - Module |
| 7 | **Event Emission** | ~150 | events store, pipeline, DLQ | Yes - Module |
| 8 | **Cross-DO Resolution** | ~300 | objects store, circuit breaker | Yes - Module |
| 9 | **HTTP Handler (handleFetch)** | ~150 | Route dispatch | Yes - Module |
| 10 | **REST Router** | ~50 | rest-router.ts | Already extracted |
| 11 | **MCP Handler** | ~30 | mcp-server.ts | Already extracted |
| 12 | **RPC Server** | ~50 | rpc-server.ts | Already extracted |
| 13 | **Sync WebSocket** | ~100 | sync-engine.ts | Already extracted |
| 14 | **Introspection** | ~250 | Schema discovery | Yes - Module |
| 15 | **Location Detection** | ~150 | CF trace API | Yes - Module |
| 16 | **Iceberg Persistence** | ~200 | R2, IcebergStateAdapter | Yes - Module |
| 17 | **Visibility/Auth** | ~150 | Actor context, filters | Yes - Module |
| 18 | **Noun/Collection Access** | ~200 | Type resolution, CRUD | Yes - Module |
| 19 | **OKRs** | ~80 | Progress tracking | Yes - Module |
| 20 | **Capabilities** | ~30 | hasCapability() | In DOTiny |

---

## Proposed Module Structure

### Target Architecture

```
DurableObject (cloudflare:workers)
    |
    v
DOTiny (~15KB) - UNCHANGED
    - Identity, storage, fetch, type discriminator
    |
    v
DOCore (~25KB) - NEW (replaces thin layer of DOBase)
    - WorkflowContext creation
    - $ proxy setup
    - Basic execution modes (send, try, do)
    - Store accessors (lazy-loaded)
    |
    +-- modules/stores.ts (~15KB) - Lazy module
    |   - ThingsStore, ActionsStore, EventsStore, etc.
    |   - StoreContext interface
    |
    +-- modules/events.ts (~15KB) - Lazy module
    |   - Event handler registration ($.on)
    |   - Event dispatch
    |   - Wildcard matching
    |   - DLQ integration
    |
    +-- modules/scheduling.ts (~10KB) - Lazy module
    |   - Schedule builder ($.every)
    |   - ScheduleManager integration
    |   - Alarm handler
    |
    +-- modules/actions.ts (~12KB) - Lazy module
    |   - Action logging
    |   - Status updates
    |   - Retry policy
    |
    +-- modules/cross-do.ts (~15KB) - Lazy module
    |   - Cross-DO resolution
    |   - Circuit breaker
    |   - Stub caching
    |
    v
DOBase (~30KB) - SLIMMED (was 104KB)
    - Integrates core modules
    - HTTP handler (delegates to transport modules)
    - REST routing (already external)
    |
    +-- transport/ (already extracted)
    |   - rest-router.ts
    |   - mcp-server.ts
    |   - rpc-server.ts
    |   - sync-engine.ts
    |   - capnweb-target.ts
    |
    +-- modules/introspection.ts (~12KB) - NEW
    |   - $introspect implementation
    |   - Schema discovery
    |   - Role-based filtering
    |
    +-- modules/location.ts (~8KB) - NEW
    |   - Location detection
    |   - CF trace API
    |   - Caching
    |
    +-- modules/iceberg.ts (~10KB) - NEW
    |   - loadFromIceberg()
    |   - saveToIceberg()
    |   - Snapshot management
    |
    +-- modules/visibility.ts (~8KB) - NEW
    |   - Actor context
    |   - canViewThing()
    |   - filterVisibleThings()
    |
    v
DOFull (~70KB) - LARGELY UNCHANGED
    - Lifecycle operations
    - Sharding (already uses ShardModule)
```

### Module Contracts

Each module follows the `LifecycleModule` pattern already established:

```typescript
// modules/types.ts
export interface ModuleContext {
  ns: string
  currentBranch: string
  db: DrizzleSqliteDODatabase<typeof schema>
  env: CloudflareEnv
  ctx: DurableObjectState
  emitEvent: (verb: string, data?: unknown) => Promise<void>
  log: (message: string, data?: unknown) => void
}

export interface DOModule {
  initialize(context: ModuleContext): void
}
```

---

## Proposed Module Interfaces

### 1. EventsModule

```typescript
// modules/events.ts
export interface EventsModule extends DOModule {
  // Handler registration
  registerHandler(eventKey: string, handler: EventHandler, options?: HandlerOptions): void
  unregisterHandler(eventKey: string, handler: Function): boolean

  // Handler access
  getHandlers(eventKey: string): Function[]
  getHandlersByPriority(eventKey: string): Array<{ handler: Function; priority: number }>
  getHandlerMetadata(eventKey: string, name: string): HandlerRegistration | undefined
  listAllHandlers(): Map<string, HandlerRegistration[]>

  // Event dispatch
  dispatchEvent(event: DomainEvent): Promise<EnhancedDispatchResult>

  // Proxy factory
  createOnProxy(): OnProxy
}
```

### 2. SchedulingModule

```typescript
// modules/scheduling.ts
export interface SchedulingModule extends DOModule {
  // Schedule registration
  registerSchedule(cron: string, name: string, handler: ScheduleHandler): Promise<void>
  unregisterSchedule(name: string): Promise<void>

  // Alarm handling
  handleAlarm(): Promise<void>

  // Proxy factory
  createScheduleBuilder(): ScheduleBuilder
}
```

### 3. ActionsModule

```typescript
// modules/actions.ts
export interface ActionsModule extends DOModule {
  // Execution modes
  send(event: string, data: unknown): void
  try<T>(action: string, data: unknown, options?: TryOptions): Promise<T>
  do<T>(action: string, data: unknown, options?: DoOptions): Promise<T>

  // Action logging
  logAction(durability: 'send' | 'try' | 'do', verb: string, input: unknown): Promise<{ id: string }>
  updateActionStatus(actionId: string, status: ActionStatus, fields?: object): Promise<void>
  completeAction(actionId: string, output: unknown, fields?: object): Promise<void>
  failAction(actionId: string, error: ActionError, fields?: object): Promise<void>
}
```

### 4. CrossDOModule

```typescript
// modules/cross-do.ts
export interface CrossDOModule extends DOModule {
  // Resolution
  resolve(url: string): Promise<Thing>
  resolveLocal(path: string, ref: string): Promise<Thing>
  resolveCrossDO(ns: string, path: string, ref: string): Promise<Thing>

  // Cross-DO method invocation
  invokeCrossDOMethod(noun: string, id: string, method: string, args: unknown[]): Promise<unknown>

  // Circuit breaker
  checkCircuitBreaker(targetNs: string): 'closed' | 'open' | 'half-open'
  recordSuccess(targetNs: string): void
  recordFailure(targetNs: string): void
  clearCache(ns?: string): void
}
```

### 5. IntrospectionModule

```typescript
// modules/introspection.ts
export interface IntrospectionModule extends DOModule {
  introspect(authContext?: AuthContext): Promise<DOSchema>
  introspectClasses(role: VisibilityRole): DOClassSchema[]
  introspectStores(role: VisibilityRole): StoreSchema[]
  introspectStorage(role: VisibilityRole): StorageCapabilities
  introspectNouns(): Promise<IntrospectNounSchema[]>
  introspectVerbs(): Promise<VerbSchema[]>
}
```

### 6. LocationModule

```typescript
// modules/location.ts
export interface LocationModule extends DOModule {
  getLocation(): Promise<DOLocation>
  detectLocation(): Promise<DOLocation>
  onLocationDetected?(location: DOLocation): Promise<void>
}
```

### 7. IcebergModule

```typescript
// modules/iceberg.ts
export interface IcebergModule extends DOModule {
  loadFromIceberg(jwt?: string): Promise<void>
  saveToIceberg(): Promise<void>
  getSnapshotSequence(): number
}
```

### 8. VisibilityModule

```typescript
// modules/visibility.ts
export interface VisibilityModule extends DOModule {
  setActorContext(actor: { userId?: string; orgId?: string }): void
  getActorContext(): { userId?: string; orgId?: string }
  clearActorContext(): void
  canViewThing(thing: Thing | null): boolean
  assertCanView(thing: Thing | null, message?: string): void
  filterVisibleThings<T extends Thing>(things: T[]): T[]
  getVisibility(thing: Thing | null): 'public' | 'unlisted' | 'org' | 'user'
  isOwner(thing: Thing | null): boolean
  isInThingOrg(thing: Thing | null): boolean
}
```

---

## Migration Path

### Phase 1: Extract Pure Modules (Low Risk)

1. **Location Module** - No dependencies on other DOBase functionality
2. **Visibility Module** - Pure utility functions
3. **Introspection Module** - Self-contained schema discovery

**Approach**: Create modules in `objects/modules/`, import from DOBase, delegate calls.

### Phase 2: Extract Event System (Medium Risk)

1. **Events Module** - Handler registration and dispatch
2. **Scheduling Module** - $.every and alarm handling

**Approach**: These are core to WorkflowContext but have clear boundaries.

### Phase 3: Extract Execution Engine (Medium Risk)

1. **Actions Module** - send/try/do execution modes
2. **Cross-DO Module** - Resolution and circuit breaker

**Approach**: These interact with stores but can be decoupled with interfaces.

### Phase 4: Create DOCore (Higher Risk)

1. Extract WorkflowContext creation into DOCore
2. DOCore manages module lifecycle
3. DOBase becomes a thin layer over DOCore + transport

**Approach**: Requires careful testing of backward compatibility.

### Migration Sequence

```
Week 1: Phase 1
  - Extract location.ts
  - Extract visibility.ts
  - Extract introspection.ts
  - All tests pass

Week 2: Phase 2
  - Extract events.ts
  - Extract scheduling.ts
  - Update DOBase to use modules
  - All tests pass

Week 3: Phase 3
  - Extract actions.ts
  - Extract cross-do.ts
  - Update DOBase to use modules
  - All tests pass

Week 4: Phase 4
  - Create DOCore
  - Slim DOBase
  - Update imports
  - Performance testing
```

---

## Tree-Shaking Strategy

### Bundle Size Targets

| Import | Target Size | Contents |
|--------|-------------|----------|
| `dotdo/tiny` | ~15KB | DOTiny only |
| `dotdo/core` | ~40KB | DOCore + essential modules |
| `dotdo/base` | ~60KB | DOBase + transport |
| `dotdo/full` | ~130KB | DOFull + lifecycle |
| `dotdo` | ~150KB | Full + mixins (fs, git, bash) |

### Import Paths

```typescript
// Minimal - just identity and storage
import { DO } from 'dotdo/tiny'

// Core workflow context without HTTP
import { DO } from 'dotdo/core'

// HTTP APIs (REST, RPC, MCP)
import { DO } from 'dotdo/base'

// Lifecycle operations
import { DO } from 'dotdo/full'

// Everything including mixins
import { DO } from 'dotdo'
```

### Conditional Module Loading

```typescript
// In DOCore
class DOCore extends DOTiny {
  private _eventsModule?: EventsModule
  private _schedulingModule?: SchedulingModule

  get events(): EventsModule {
    if (!this._eventsModule) {
      // Dynamic import for tree-shaking
      this._eventsModule = new EventsModuleImpl(this.getModuleContext())
    }
    return this._eventsModule
  }
}
```

---

## Risk Assessment

### High Risk Areas

1. **WorkflowContext Proxy** - Complex proxy chain may break with changes
2. **Cross-DO Resolution** - Circuit breaker state is shared across instances
3. **Event Dispatch** - Priority ordering and wildcard matching are subtle

### Mitigation Strategies

1. **Comprehensive Test Coverage** - Each module needs isolated unit tests
2. **Integration Tests** - Full workflow tests for each import level
3. **Backward Compatibility Layer** - DOBase re-exports all module methods
4. **Feature Flags** - Gradual rollout with ability to disable new modules

### Testing Requirements

```typescript
// Each module needs:
// 1. Unit tests in objects/modules/tests/
// 2. Integration tests with DOBase
// 3. Tree-shaking verification

// Example test structure:
// objects/modules/tests/events.test.ts
// objects/modules/tests/scheduling.test.ts
// objects/modules/tests/actions.test.ts
// objects/modules/tests/cross-do.test.ts
// objects/modules/tests/introspection.test.ts
// objects/modules/tests/location.test.ts
// objects/modules/tests/iceberg.test.ts
// objects/modules/tests/visibility.test.ts
```

---

## Dependency Graph

```
                    DOTiny
                      |
                      v
    +---------------DOCore---------------+
    |                 |                  |
    v                 v                  v
 stores          events           scheduling
    |              /|\                  |
    |             / | \                 |
    v            v  v  v                v
 actions    cross-do  introspection  (alarm)
    |           |
    v           v
 (DLQ)    (circuit breaker)

                      |
                      v
                   DOBase
                      |
        +-------------+-------------+
        |             |             |
        v             v             v
    transport    iceberg      visibility
     (REST)     (R2/state)   (auth/filter)
     (RPC)
     (MCP)
     (sync)

                      |
                      v
                   DOFull
                      |
        +-------------+-------------+
        |             |             |
        v             v             v
    lifecycle      shard         clone
    (fork)      (ShardModule)   (2PC)
    (branch)
    (merge)
```

---

## Success Criteria

1. **Bundle Size**: `dotdo/core` < 50KB gzipped
2. **Cold Start**: No regression in cold start time
3. **Test Coverage**: 90%+ coverage on all new modules
4. **Backward Compatibility**: All existing tests pass without modification
5. **API Stability**: No breaking changes to public API

---

## See Also

### Related Architecture Documents

- [Architecture Overview](../architecture.md) - Main architecture documentation index

### Related Spikes

- [Cross-DO Join Latency](../spikes/cross-do-join-latency.md) - Impact of cross-DO calls on join performance
- [Checkpoint Size Limits](../spikes/checkpoint-size-limits.md) - Storage limits affecting state persistence
- [Long-Running Tasks](../spikes/long-running-tasks.md) - CPU time limits and chunked execution patterns
- [Distributed Checkpoint Coordination](../spikes/distributed-checkpoint-coordination.md) - Multi-DO checkpoint strategies

### Code References

- `objects/DOTiny.ts` - Base class
- `objects/DOBase.ts` - Target for decomposition
- `objects/DOFull.ts` - Lifecycle operations
- `objects/lifecycle/types.ts` - Module pattern
- `objects/lifecycle/Shard.ts` - Example module
- `objects/mixins/infrastructure.ts` - Capability mixin pattern
- `objects/transport/` - Already extracted HTTP handlers

---

## Appendix: Current DOBase Method Inventory

### Public Methods (API Surface)
- `$.send()`, `$.try()`, `$.do()` - Execution modes
- `$.on` proxy - Event registration
- `$.every` proxy - Scheduling
- `$.location` - Location access
- `$.user` - User context
- `$.ai`, `$.write`, `$.summarize`, `$.list`, `$.extract`, `$.is`, `$.decide` - AI functions
- `things`, `rels`, `actions`, `events`, `search`, `objects`, `dlq` - Store accessors
- `resolve()` - URL resolution
- `$introspect()` - Schema introspection
- `handleMcp()` - MCP protocol
- `alarm()` - Scheduled task handler

### Protected Methods (Subclass API)
- `collection<T>()` - Typed collection accessor
- `relationships` - Relationship accessor
- `link()`, `getLinkedObjects()` - DO linking
- `createThing()`, `createAction()` - Entity creation
- `emitEvent()`, `emit()` - Event emission
- `send()`, `try()`, `do()` - Execution modes (internal)
- `setActor()`, `clearActor()`, `getCurrentActor()` - Actor context
- `setActorContext()`, `getActorContext()`, `clearActorContext()` - Visibility
- `canViewThing()`, `assertCanView()`, `filterVisibleThings()` - Visibility helpers
- `getVisibleThing()`, `getVisibility()`, `isOwner()`, `isInThingOrg()` - Visibility
- `resolveNounToFK()`, `registerNoun()` - Noun management
- `getLocation()`, `_detectLocation()`, `onLocationDetected()` - Location
- `loadFromIceberg()`, `saveToIceberg()` - Persistence
- `handleFetch()` - HTTP handling override point
- `handleSyncWebSocket()` - WebSocket handling
- `validateSyncAuthToken()` - Auth override point
- `capnWebOptions` - RPC config override

### Private Methods (Internal)
- `createWorkflowContext()` - $ proxy factory
- `createOnProxy()` - $.on proxy factory
- `createScheduleBuilder()` - $.every proxy factory
- `createDomainProxy()` - $.Noun() proxy factory
- `invokeDomainMethod()`, `invokeCrossDOMethod()` - Method dispatch
- `fetchWithCrossDOTimeout()` - HTTP with timeout
- `checkCircuitBreaker()`, `recordCircuitBreakerSuccess/Failure()` - Circuit breaker
- `logAction()`, `updateActionStatus()`, `completeAction()`, `failAction()` - Action lifecycle
- `calculateBackoffDelay()`, `generateStepId()` - Retry logic
- `persistStepResult()`, `loadPersistedSteps()` - Step caching
- `emitSystemError()` - Error handling
- `collectMatchingHandlers()`, `dispatchEventToHandlers()` - Event dispatch
- `getStoreContext()` - Store initialization
- `getRestRouterContext()`, `getRegisteredNouns()` - REST helpers
- `handleIntrospectRoute()` - HTTP route handler
- `determineRole()`, `introspectClasses/Stores/Storage/Nouns/Verbs()` - Introspection
- `verifyJwtSignature()`, `base64UrlDecode()` - JWT helpers
- `decodeJwtClaimsInternal()`, `getJwtFromContextInternal()` - JWT helpers
- `emitLifecycleEvent()` - Internal events
- `extractBearerTokenFromProtocol()` - WebSocket auth
