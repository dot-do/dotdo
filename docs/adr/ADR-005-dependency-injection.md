# ADR-005: Dependency Injection Pattern for DO Class Composition

## Status

Proposed

## Date

2026-01-21

## Context

The DO class (`@dotdo/do`) has evolved into a sophisticated component that coordinates multiple handlers:

- **StorageHandler**: Entity management (things, events, relationships, audit logs)
- **RPCHandler**: RPC endpoint handling with method resolution
- **WebSocketHandler**: WebSocket connection management
- **AlarmHandler**: Scheduling and alarm management

Currently, these handlers are instantiated directly in the DO constructor:

```typescript
// Current pattern in DO.ts
constructor(state: DurableObjectState, env: DOEnv, options: DOOptions = {}) {
  this.storageHandler = new StorageHandler()
  this.rpcHandler = new RPCHandler({ debug })
  this.websocketHandler = new WebSocketHandler({ debug })
  // ...
}
```

While we have a `DOHandlerRegistry` for registration and lifecycle management, there is no formal dependency injection (DI) pattern. This creates several challenges:

1. **Testing complexity**: Hard to substitute handlers with test doubles without using real implementations
2. **Coupling**: DO class directly depends on concrete handler implementations
3. **Extension difficulty**: Subclasses must understand internal handler wiring to extend behavior
4. **Service discovery**: Handlers cannot easily access other handlers they depend on
5. **Lifecycle management**: Handler initialization order is implicit, not declarative

### Current Architecture Analysis

The codebase already has composition patterns:

1. **Handler Registry** (`do/handlers/registry.ts`): Provides registration, retrieval, and lifecycle management
2. **Mixins** (`do/mixins/`): Enable selective composition via TypeScript mixin pattern
3. **EntityManager** (`do/entities.ts`): Coordinates stores with event emission and audit logging

However, these patterns are not unified under a DI framework.

## Decision

We will establish a **constructor injection pattern** with a **service container** for handler composition. This builds on the existing `DOHandlerRegistry` while adding explicit dependency declaration.

### 1. Handler Factory Pattern

Define handlers with explicit dependencies:

```typescript
// Handler interface with dependency declaration
interface HandlerFactory<T extends DOHandler> {
  name: string
  dependencies?: string[]
  create(container: HandlerContainer): T
}

// Example: StorageHandler has no dependencies
const StorageHandlerFactory: HandlerFactory<StorageHandler> = {
  name: 'storage',
  dependencies: [],
  create: () => new StorageHandler()
}

// Example: RPCHandler depends on auth context
const RPCHandlerFactory: HandlerFactory<RPCHandler> = {
  name: 'rpc',
  dependencies: ['auth'],
  create: (container) => new RPCHandler({
    authGuard: container.get<AuthHandler>('auth')?.getGuard()
  })
}
```

### 2. Handler Container

Extend `DOHandlerRegistry` to support dependency resolution:

```typescript
interface HandlerContainer {
  // Register a handler factory
  registerFactory<T extends DOHandler>(factory: HandlerFactory<T>): void

  // Get a handler by name (created on demand, cached)
  get<T extends DOHandler>(name: string): T | undefined

  // Get required handler (throws if not found)
  getRequired<T extends DOHandler>(name: string): T

  // Check if handler is registered
  has(name: string): boolean

  // Initialize all handlers in dependency order
  initializeAll(): Promise<void>
}
```

### 3. DO Configuration Object

Replace constructor parameters with a configuration object that includes handler overrides:

```typescript
interface DOConfig {
  // Environment (required)
  env: DOEnv

  // Optional handler overrides for testing/extension
  handlers?: {
    storage?: HandlerFactory<StorageHandler>
    rpc?: HandlerFactory<RPCHandler>
    websocket?: HandlerFactory<WebSocketHandler>
    alarm?: HandlerFactory<AlarmHandler>
    // Allow custom handlers
    [name: string]: HandlerFactory<DOHandler> | undefined
  }

  // Existing options
  cors?: boolean | CORSOptions
  debug?: boolean
}

// Usage
class DO {
  constructor(state: DurableObjectState, config: DOConfig) {
    this.container = new HandlerContainer(config.handlers ?? defaultHandlers)
    // ...
  }
}
```

### 4. Default Handler Registration

Provide sensible defaults while allowing override:

```typescript
const defaultHandlers = {
  storage: StorageHandlerFactory,
  rpc: RPCHandlerFactory,
  websocket: WebSocketHandlerFactory,
  alarm: AlarmHandlerFactory,
}

// Extension: add custom handler
class MyDO extends DO {
  constructor(state: DurableObjectState, env: DOEnv) {
    super(state, {
      env,
      handlers: {
        ...defaultHandlers,
        analytics: AnalyticsHandlerFactory,
      }
    })
  }
}
```

### 5. Service Registration Approach

For cross-cutting concerns (logging, metrics, auth), use a service locator pattern within the container:

```typescript
interface ServiceRegistry {
  // Core services available to all handlers
  readonly logger: Logger
  readonly state: DurableObjectState
  readonly env: DOEnv

  // Register custom service
  registerService<T>(name: string, service: T): void

  // Get service
  getService<T>(name: string): T | undefined
}

// Handlers receive ServiceRegistry in their factory
const MyHandlerFactory: HandlerFactory<MyHandler> = {
  name: 'my-handler',
  create: (container, services) => new MyHandler({
    logger: services.logger,
    state: services.state,
  })
}
```

## Consequences

### Positive

- **Testability**: Handlers can be easily replaced with test doubles
- **Explicit dependencies**: Handler dependencies are documented in factory definitions
- **Lifecycle management**: Container manages initialization order based on dependency graph
- **Extensibility**: Custom handlers integrate naturally with the same pattern
- **Service sharing**: Cross-cutting concerns are accessible via service registry
- **Backward compatibility**: Existing DO subclasses continue to work with defaults

### Negative

- **Complexity**: Adds indirection compared to direct instantiation
- **Learning curve**: Contributors must understand DI pattern
- **Performance overhead**: Minor overhead from dependency resolution (negligible for DO lifecycle)
- **Type complexity**: Generic container types can be harder to understand

### Neutral

- **Migration**: Existing handlers need factory wrappers (mechanical transformation)
- **Testing patterns**: Test utilities will be updated to support handler injection
- **Documentation**: Need to document the DI pattern for contributors

## Alternatives Considered

### 1. Keep Current Direct Instantiation

Continue with direct `new Handler()` calls in DO constructor.

**Rejected because:**
- Testing requires real implementations or complex mocking
- No clear way to extend handlers without copy-paste
- Handler inter-dependencies not explicit

### 2. Full IoC Container (e.g., InversifyJS)

Use a mature IoC container library.

**Rejected because:**
- Heavy dependency for simple use case
- Decorator-based API conflicts with our TypeScript patterns
- Runtime reflection not available in Workers environment

### 3. Pure Mixin Composition

Rely entirely on TypeScript mixins for composition.

**Rejected because:**
- Mixins don't support runtime composition
- Can't substitute implementations for testing
- Limited to class extension, not instance configuration

### 4. React-style Context Pattern

Pass dependencies through a context object down the call chain.

**Rejected because:**
- Verbose to thread through all methods
- Doesn't fit handler lifecycle model
- More suited to request-scoped dependencies

## Implementation Notes

### Phase 1: Handler Container

1. Extend `DOHandlerRegistry` with factory support
2. Add dependency resolution with cycle detection
3. Add service registry for cross-cutting concerns

### Phase 2: Handler Factories

1. Create factory definitions for existing handlers
2. Update handlers to accept injected dependencies
3. Maintain backward compatibility with direct instantiation

### Phase 3: DO Configuration

1. Introduce `DOConfig` interface
2. Support handler overrides in constructor
3. Document extension patterns

### Phase 4: Testing Utilities

1. Create test handler factories (mocks/stubs)
2. Update test setup patterns
3. Document testing best practices

## References

- [do/handlers/registry.ts](/Users/nathanclevenger/projects/dotdo/do/handlers/registry.ts) - Existing handler registry
- [do/handlers/index.ts](/Users/nathanclevenger/projects/dotdo/do/handlers/index.ts) - Handler exports
- [do/DO.ts](/Users/nathanclevenger/projects/dotdo/do/DO.ts) - Current DO class implementation
- [do/mixins/](/Users/nathanclevenger/projects/dotdo/do/mixins/) - Existing mixin patterns
- [do/entities.ts](/Users/nathanclevenger/projects/dotdo/do/entities.ts) - EntityManager composition
- [ADR-002: Durable Objects as Core Primitive](./ADR-002-durable-objects-as-core-primitive.md) - DO architecture context
- [ADR-003: RPC-First Communication](./ADR-003-rpc-first-communication.md) - RPC handler context
