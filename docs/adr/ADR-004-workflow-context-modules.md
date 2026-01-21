# ADR-004: Break Up WorkflowContext into Composable Modules

## Status

Proposed

## Date

2026-01-21

## Context

The `WorkflowContext` (`$`) is the central abstraction in dotdo, providing a fluent API for:

- **Event handlers**: `$.on.Customer.signup(handler)`
- **Scheduling**: `$.every.Monday.at('9am')(handler)`
- **Cross-DO RPC**: `$.Customer(id).method()`
- **Durability levels**: `$.send()`, `$.try()`, `$.do()`
- **Async context propagation**: `$.run()`, `$.getMetadata()`, `$.hasContext()`
- **Extended primitives**: `$.fs`, `$.git`, `$.bash`, `$.npm`
- **Integrations**: `$.integrations`

### Current Structure

The implementation is already partially modularized in `do/workflow/`:

```
do/workflow/
├── context.ts        # Main factory (createContext) - 364 lines
├── types.ts          # Shared type definitions - 258 lines
├── events.ts         # Event handler DSL ($.on) - 403 lines
├── schedule.ts       # Scheduling DSL ($.every) - 397 lines
├── rpc.ts            # Cross-DO RPC ($.Customer(id)) - 250 lines
├── async-context.ts  # AsyncLocalStorage propagation - 401 lines
├── index.ts          # Public exports - 89 lines
├── alarm.ts          # Alarm handler integration
└── event-system.ts   # Event emission/subscription
```

### Problems with Current Structure

1. **Monolithic Factory Function**: `createContext()` in `context.ts` assembles everything, making it hard to:
   - Use only the parts you need (tree-shaking)
   - Test individual modules in isolation
   - Extend with custom capabilities

2. **Tight Coupling**: The `WorkflowContext` interface has 40+ members, mixing:
   - Core durability methods (`send`, `try`, `do`)
   - DSL proxies (`on`, `every`)
   - Capability providers (`fs`, `git`, `bash`, `npm`)
   - Internal state (`_events`, `_handlers`, `_stubCache`, etc.)

3. **Initialization Complexity**: The factory function handles:
   - Event store creation
   - Handler registry setup
   - Schedule registry setup
   - Stub cache management
   - Integration initialization
   - Async context initialization
   - Error store configuration
   - Primitive wiring (fs, git, bash, npm)

4. **Proxy Layering**: Multiple proxies are composed:
   - `createOnProxy()` for events
   - `createEveryProxy()` for scheduling
   - `createDORPCProxy()` wraps the entire context for dynamic DO access

## Decision

We will refactor `WorkflowContext` into composable modules that can be independently used, tested, and extended.

### Proposed Module Structure

```
do/workflow/
├── core/
│   ├── durability.ts     # send(), try(), do() - core durability methods
│   ├── context-base.ts   # Base context with internal state management
│   └── types.ts          # Core type definitions
├── events/
│   ├── on-proxy.ts       # Event handler registration ($.on)
│   ├── handlers.ts       # Handler invocation with retry logic
│   ├── matching.ts       # Wildcard matching logic
│   └── index.ts          # Public API
├── scheduling/
│   ├── every-proxy.ts    # Schedule DSL ($.every)
│   ├── cron.ts           # CRON expression utilities
│   ├── registry.ts       # Schedule registry management
│   └── index.ts          # Public API
├── rpc/
│   ├── do-accessor.ts    # Cross-DO RPC factory
│   ├── stub-proxy.ts     # Dynamic method proxy
│   ├── cache.ts          # Stub caching logic
│   └── index.ts          # Public API
├── async-context/
│   ├── storage.ts        # AsyncLocalStorage abstraction
│   ├── propagation.ts    # Context propagation utilities
│   └── index.ts          # Public API
├── primitives/
│   ├── fs.ts             # Filesystem capability interface
│   ├── git.ts            # Git capability interface
│   ├── bash.ts           # Bash capability interface
│   ├── npm.ts            # NPM capability interface
│   └── index.ts          # Aggregate interface
├── compose.ts            # Composable context factory
└── index.ts              # Public API with backward-compatible createContext
```

### Composable API Design

```typescript
// New composable API
import {
  createBaseContext,
  withEvents,
  withScheduling,
  withRPC,
  withAsyncContext,
  withPrimitives,
} from '@dotdo/do/workflow'

// Compose only what you need
const $ = compose(
  createBaseContext(state, env),
  withEvents(),
  withScheduling(),
  withRPC(),
  withAsyncContext(),
  withPrimitives({ fs, git, bash, npm }),
)

// Or use the full factory (backward compatible)
const $ = createContext(state, env, options)
```

### Mixin Pattern for Extensions

Each module provides a mixin that adds functionality:

```typescript
// Core durability (always included)
interface DurabilityMixin {
  send(event: { type: string; payload?: unknown }): void
  try<T>(action: () => Promise<T>, options?: TryOptions): Promise<T>
  do<T>(action: () => Promise<T>, options?: DoOptions): Promise<T>
}

// Events mixin
interface EventsMixin {
  on: OnProxy
  _handlers: Map<string, EventHandler[]>
}

// Scheduling mixin
interface SchedulingMixin {
  every: EveryProxy
  _schedules: Map<string, ScheduleRegistration>
}

// RPC mixin (via Proxy)
interface RPCMixin {
  [doName: string]: DOStubFactory
  _stubCache: Map<string, DOStubProxy>
}

// Async context mixin
interface AsyncContextMixin {
  run<T>(fn: () => T): T
  getRequestId(): string | undefined
  getMetadata<T>(key: string): T | undefined
  setMetadata(key: string, value: unknown): void
  hasContext(): boolean
}

// Primitives mixin
interface PrimitivesMixin {
  fs?: FsCapability
  git?: GitCapability
  bash?: BashCapability
  npm?: NpmCapability
}
```

### Internal State Isolation

Move internal state to a separate symbol-keyed object:

```typescript
// Current (exposes internals)
interface WorkflowContext {
  _events: EventsStore
  _handlers: Map<string, EventHandler[]>
  _schedules: Map<string, ScheduleRegistration>
  _stubCache: Map<string, DOStubProxy>
  _env: unknown
  _fireAndForgetErrors: FireAndForgetErrorStore
}

// Proposed (hides internals)
const INTERNALS = Symbol('workflow-internals')

interface WorkflowInternals {
  events: EventsStore
  handlers: Map<string, EventHandler[]>
  schedules: Map<string, ScheduleRegistration>
  stubCache: Map<string, DOStubProxy>
  env: unknown
  fireAndForgetErrors: FireAndForgetErrorStore
}

interface WorkflowContext {
  [INTERNALS]: WorkflowInternals
  // ... public API only
}
```

## Migration Path

### Phase 1: Extract Modules (Non-Breaking)

1. Create new module files under `do/workflow/` subdirectories
2. Move existing code into new modules
3. Re-export from original locations for backward compatibility
4. Add unit tests for each module in isolation

### Phase 2: Add Composition API (Additive)

1. Implement `compose()` function and `with*()` mixins
2. Keep `createContext()` as the default factory (uses all mixins)
3. Document new API in package README
4. Add integration tests for composed contexts

### Phase 3: Internals Hiding (Breaking in v4)

1. Move internal state to symbol-keyed property
2. Provide explicit APIs for internal access when needed
3. Update all internal consumers
4. Deprecate direct `_` property access
5. Release as major version bump

## Consequences

### Positive

- **Tree-shaking**: Applications only bundle the modules they use
- **Testability**: Each module can be unit tested in isolation
- **Extensibility**: Custom modules can be composed with core ones
- **Clarity**: Clear separation of concerns across modules
- **Type safety**: Each mixin has focused type definitions
- **Incremental adoption**: Backward-compatible migration path

### Negative

- **Complexity**: More files and indirection
- **Learning curve**: Developers need to understand composition model
- **Migration effort**: Existing code needs updates (eventually)
- **Proxy overhead**: Multiple proxy layers may impact performance
- **Bundle size**: Composition utilities add some overhead

### Neutral

- **Backward compatibility**: `createContext()` continues to work
- **Internal state**: Symbol-keyed properties still accessible for testing
- **Documentation**: Need to document both simple and advanced usage

## Alternatives Considered

### Keep Current Structure

Leave `context.ts` as-is and only extract shared utilities.

**Rejected because:**
- Doesn't address tree-shaking or testability concerns
- Factory function will continue to grow with new features
- Tight coupling makes extensions difficult

### Class-Based Composition

Use class inheritance or decorators for composition.

**Rejected because:**
- Classes don't tree-shake well
- Decorator syntax is still experimental
- Multiple inheritance is awkward in TypeScript
- Proxy-based DSLs (`$.on`, `$.every`) don't map well to classes

### Plugin System

Create a plugin architecture with hooks and lifecycle methods.

**Rejected because:**
- Over-engineered for current needs
- Plugin registration adds runtime overhead
- Harder to type correctly
- Existing mixin pattern is simpler and sufficient

### Keep Internal State Public

Don't hide `_` prefixed properties, just document them as internal.

**Rejected because:**
- Convention-based privacy is easy to violate
- IntelliSense shows internal properties
- Makes semver compatibility harder (internals become de facto API)

## References

- [Issue do-yulh](https://github.com/dotdo-platform/dotdo/issues/do-yulh) - Original issue
- [do/workflow/context.ts](/do/workflow/context.ts) - Current implementation
- [TypeScript Mixins](https://www.typescriptlang.org/docs/handbook/mixins.html) - Mixin pattern reference
- [Functional Composition](https://en.wikipedia.org/wiki/Function_composition_(computer_science)) - Compose pattern
- [Symbol-keyed Properties](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Symbol) - Internal state hiding
