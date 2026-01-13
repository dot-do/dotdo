# DOBase Architecture and Decomposition

This document describes the architecture of the Durable Object class hierarchy in dotdo, with focus on DOBase (exported as `DO`), its extension points, mixin system, and migration guidance.

## Class Hierarchy Overview

```
                              DurableObject (Cloudflare)
                                       |
                                       v
                              +-----------------+
                              |     DOTiny      |  ~15KB - Minimal base
                              |   (DO export)   |  Identity, Storage, fetch()
                              +-----------------+
                                       |
                                       v
                              +-----------------+
                              |     DOBase      |  ~120KB - Full features
                              |   (DO export)   |  WorkflowContext, Stores, Events
                              +-----------------+
                                       |
                                       v
                              +-----------------+
                              |     DOFull      |  ~200KB - Lifecycle ops
                              |   (DO export)   |  Clone, Branch, Shard
                              +-----------------+
                                       |
              +------------------------+------------------------+
              |            |           |           |            |
              v            v           v           v            v
         +--------+   +--------+  +--------+  +--------+  +--------+
         |Business|   |  App   |  |  Site  |  | Worker |  | Entity |
         +--------+   +--------+  +--------+  +--------+  +--------+
              |                                    |            |
              v                                    v            v
    +------------------+                     +--------+   +------------+
    | DigitalBusiness  |                     | Agent  |   | Collection |
    +------------------+                     +--------+   +------------+
              |                              | Human  |   | Directory  |
              v                              +--------+   +------------+
         +--------+
         |  SaaS  |
         +--------+
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
