# dotdo

**Edge-native runtime for Durable Objects.** The missing primitives for V8 isolates—filesystem, git, shell execution, and graph-based state management.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://badge.fury.io/js/dotdo.svg)](https://www.npmjs.com/package/dotdo)

> **New to dotdo?** Start with the [5-Minute Quickstart](./QUICKSTART.md) to get running in minutes.

```typescript
import { DO } from 'dotdo'

export class MyApp extends DO {
  constructor(state, env) {
    super(state, env)

    // Event-driven architecture with $ context
    this.$.on.Customer.signup(async (event) => {
      // Graph-based storage
      await this.$.things.create({ $type: 'Profile', ...event.data })

      // Cross-DO RPC with promise pipelining
      await this.$.Email('welcome').send(event.email)
    })
  }
}
```

---

## What is dotdo?

dotdo is a runtime layer for [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)—V8 isolates with SQLite storage, globally distributed with single-threaded consistency guarantees.

**Think of it as Node.js for the edge:**

| Node.js | dotdo |
|---------|-------|
| `fs` module | `fsx` (filesystem on SQLite) |
| `child_process` | `bashx` (shell without VMs) |
| `npm` | `npmx` (edge package management) |
| `require()` | Cap'n Web RPC (promise pipelining) |

V8 isolates lack the primitives developers expect. We built them from scratch, optimized for edge execution.

### Who is dotdo for?

- **Startup Founders** - Build production apps without infrastructure complexity
- **Full-Stack Developers** - Deploy stateful backends that scale automatically
- **Infrastructure Engineers** - Extend Cloudflare Workers with persistence primitives
- **AI/Agent Developers** - Run autonomous agents with durable state at the edge

### Why Durable Objects?

Durable Objects provide a unique combination of benefits:

1. **Zero Cold Starts** - V8 isolates start in 0ms, not seconds
2. **Guaranteed Consistency** - Single-threaded access eliminates race conditions
3. **Global Distribution** - Deploy to 300+ cities automatically
4. **Built-in SQLite** - 10GB of persistent storage per instance
5. **Exactly-Once Delivery** - No message loss or duplication
6. **Pay-Per-Use** - Only pay for what you use, no idle costs

dotdo gives you the developer experience you expect from Node.js, on top of this powerful foundation.

---

## Why dotdo?

### The V8 Isolate Runtime

A Cloudflare Worker is a **V8 isolate**—the same JavaScript engine that runs in Chrome:

- **0ms cold start** (no container spin-up)
- **Instant execution** (no process overhead)
- **Global distribution** (runs in 300+ cities)
- **Isolated by design** (no shared memory attacks)

A Durable Object adds **persistent state** to that isolate:

- **SQLite storage** (10GB per instance)
- **Single-threaded consistency** (no locks needed)
- **Guaranteed delivery** (exactly-once semantics)
- **Location pinning** (data residency compliance)

dotdo extends this foundation with the primitives edge applications need.

### The Missing Primitives

V8 isolates don't have:
- File systems
- Git operations
- Shell execution
- Package management
- Graph databases
- Event choreography

**We built them all.** From scratch. Optimized for the edge.

---

## Quick Start

### Installation

Install dotdo in your existing project:

```bash
npm install dotdo
```

Or use the CLI to scaffold a new project with pre-configured setup:

```bash
npx dotdo init my-app
cd my-app
npm install
```

### Prerequisites

- **Node.js** >= 18.0.0
- **Cloudflare Account** - Free tier available at [dash.cloudflare.com](https://dash.cloudflare.com)
- **Wrangler CLI** - Installed automatically with dotdo

### Create Your First DO

Create a new Durable Object that extends the dotdo base class:

```typescript
// src/index.ts
import { DO } from 'dotdo'

export class MyApp extends DO {
  async fetch(request: Request) {
    const url = new URL(request.url)

    if (url.pathname === '/users') {
      // Create a Thing (entity in the graph)
      const user = await this.$.things.create({
        $type: 'User',
        name: 'Alice',
        email: 'alice@example.com'
      })

      return new Response(JSON.stringify(user), {
        headers: { 'Content-Type': 'application/json' }
      })
    }

    return new Response('Hello from dotdo!', {
      headers: { 'Content-Type': 'text/plain' }
    })
  }
}

// Export the DO
export default {
  async fetch(request: Request, env: Env) {
    const id = env.MY_APP.idFromName('default')
    const stub = env.MY_APP.get(id)
    return stub.fetch(request)
  }
}
```

### Configure wrangler.toml

```toml
name = "my-app"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[durable_objects]
bindings = [
  { name = "MY_APP", class_name = "MyApp" }
]

[[migrations]]
tag = "v1"
new_classes = ["MyApp"]
```

### Development

Start the local development server:

```bash
npm run dev          # Start Wrangler dev server at http://localhost:8787
```

Run tests with Vitest:

```bash
npm test             # Run tests in watch mode
npm run test:run     # Run tests once (CI mode)
npm run typecheck    # TypeScript type checking
npm run benchmark    # Run performance benchmarks
```

Deploy to Cloudflare:

```bash
npm run deploy       # Deploy to production
```

### Your First Request

Once the dev server is running, test your DO:

```bash
curl http://localhost:8787/users
```

You'll get back your first Thing:

```json
{
  "$id": "usr_abc123",
  "$type": "User",
  "name": "Alice",
  "email": "alice@example.com",
  "$createdAt": 1706000000000,
  "$updatedAt": 1706000000000
}
```

### Next Steps

Now that you have a working DO, explore dotdo's capabilities:

1. **Add Event Handlers** - Use `$.on.Noun.verb()` to handle events:
   ```typescript
   this.$.on.User.created(async (event) => {
     await this.$.send({ type: 'welcome-email', to: event.email })
   })
   ```

2. **Schedule Tasks** - Use fluent scheduling DSL:
   ```typescript
   this.$.every.monday.at('9am')(async () => {
     await generateWeeklyReport()
   })
   ```

3. **Call Other DOs** - Use cross-DO RPC:
   ```typescript
   const balance = await this.$.Customer('user-456').getBalance()
   await this.$.Order('order-123').ship()
   ```

4. **Add Observability** - Monitor your DOs:
   ```typescript
   import { createDOObservability } from '@dotdo/observability'

   const obs = createDOObservability({ service: 'my-app' })
   ```

5. **Explore Examples** - Check out `.worktrees/v1/examples/` for real-world patterns

---

## Architecture

This is a **monorepo** organized as a workspace. Each package handles a specific concern:

```
dotdo/                  # Main package - re-exports everything
├── @dotdo/do           # THE Durable Object class with $ context
├── @dotdo/db           # Storage layer (Things, Relationships, Events)
├── @dotdo/rpc          # Cap'n Web RPC with promise pipelining
├── @dotdo/mcp          # Model Context Protocol server (3 tools)
├── @dotdo/ai           # AI routing and template literals
├── @dotdo/auth         # Hono auth middleware
├── @dotdo/api          # Self-describing REST API layer
└── @dotdo/observability # Logging, tracing, and metrics
```

### Extended Primitives (Submodules)

Located in root submodule directories (not `primitives/` which is a git submodule for AI primitives):
- **fsx/** - Full POSIX filesystem on SQLite
- **gitx/** - Git operations with R2 storage
- **bashx/** - Shell execution without VMs
- **npmx/** - Package management for edge
- **pyx/** - Python runtime (experimental)

> **Note:** These require [manual wiring](#primitives-status) to the `$` context.

---

## Packages

### Core Runtime

#### `dotdo` (Main Package)

The unified entry point. Re-exports all packages and primitives for convenience.

```bash
npm install dotdo
```

```typescript
import { DO, createContext } from 'dotdo'

// Or import from specific packages
import { DO } from '@dotdo/do'
import { createClient } from '@dotdo/rpc'
```

#### `@dotdo/do`

THE Durable Object class with the `$` workflow context.

```typescript
import { DO } from '@dotdo/do'

export class MyDO extends DO {
  constructor(state, env) {
    super(state, env)

    // Three durability levels
    this.$.send(event)     // Fire-and-forget
    this.$.try(action)     // Single attempt
    this.$.do(action)      // Durable with retries

    // Event handlers (infinite Noun.verb combinations)
    this.$.on.Customer.signup(handler)
    this.$.on.Payment.failed(handler)
    this.$.on.*.created(handler)

    // Scheduling (fluent DSL → CRON)
    this.$.every.monday.at('9am')(handler)
    this.$.every.hour(handler)
  }
}
```

#### `@dotdo/db`

Abstract storage layer for Things, Relationships, Events, and Actions.

```typescript
import { createStore } from '@dotdo/db'

const store = createStore(state.storage)

// Graph-based state
const thing = await store.things.create({ $type: 'Customer', name: 'Alice' })
await store.relationships.create({ from: thing.$id, to: order.$id, type: 'placed' })
```

#### `@dotdo/rpc`

Cap'n Web RPC layer with promise pipelining.

```typescript
import { createClient, createServer } from '@dotdo/rpc'

// Client with promise pipelining (1 network round trip, not 3)
const api = createClient({ url: 'https://my-worker.dev' })
const result = await api.getUser('123').getProfile().getSettings()

// Server
export default createServer({ target: myImplementation })
```

**Features:**
- Promise pipelining (Cap'n Proto style)
- Client → Worker, Worker → DO, DO → DO communication
- Automatic stub caching and LRU eviction

### Developer Tools

#### `@dotdo/mcp`

Model Context Protocol server exposing dotdo capabilities to Claude and other AI tools.

**3 Tools:**
1. **search** - Query Things in the Digital Object store
2. **fetch** - Retrieve content from URLs
3. **do** - Execute code in a secure sandbox with $ context

```bash
# Add to Claude Desktop config
{
  "mcpServers": {
    "dotdo": {
      "command": "npx",
      "args": ["@dotdo/mcp"]
    }
  }
}
```

#### CLI

Command-line interface for project management and deployment.

```bash
npx dotdo init my-app   # Create new project with scaffolding
npx dotdo dev           # Start dev server (wraps wrangler)
npx dotdo deploy        # Deploy to Cloudflare Workers
npx dotdo login         # OAuth login (future: via oauth.do)
```

The CLI is included in the main `dotdo` package. No separate installation needed.

### Code Generation

dotdo follows the principle of **"Define once, generate everywhere"** - your resource definitions automatically produce SDKs, CLI commands, OpenAPI specs, and MCP tools.

#### Using the Programmatic API

```typescript
import { defineResource, generateSDK, generateCLI, generateMCPTools, generateOpenAPI } from '@dotdo/api'

// Define resources once
const CustomerResource = defineResource('customers')
  .fields({
    name: { type: 'string', required: true },
    email: { type: 'string', format: 'email', required: true }
  })
  .actions({
    upgrade: { method: 'POST', handler: async (ctx) => ({}) }
  })
  .build()

// Generate TypeScript SDK
const sdkCode = generateSDK([CustomerResource])
writeFileSync('sdk.ts', sdkCode)

// Generate OpenAPI 3.0 spec
const openApiSpec = generateOpenAPI([CustomerResource])
writeFileSync('openapi.json', JSON.stringify(openApiSpec, null, 2))

// Generate CLI command structure
const cliCommands = generateCLI([CustomerResource])

// Generate MCP tools for AI agents
const mcpTools = generateMCPTools([CustomerResource])
```

#### Generated Artifacts

| Generator | Output | Description |
|-----------|--------|-------------|
| `generateSDK()` | TypeScript SDK | Type-safe client with CRUD + custom actions |
| `generateOpenAPI()` | OpenAPI 3.0 | JSON/YAML spec for documentation |
| `generateCLI()` | CLI structure | Commander.js compatible commands |
| `generateMCPTools()` | MCP tools | AI-agent compatible tool definitions |
| `generateTypes()` | TypeScript types | Interfaces from resource definitions |

See [SDK Generation documentation](./docs/SDK_GENERATION.md) for comprehensive examples.

### Middleware & Utilities

#### `@dotdo/auth`

Hono auth middleware with JWT support.

```typescript
import { auth } from '@dotdo/auth'
import { Hono } from 'hono'

const app = new Hono()

app.use('/api/*', auth({
  secret: env.JWT_SECRET,
  algorithms: ['HS256']
}))
```

#### `@dotdo/ai`

AI routing and template literals for multi-provider LLM access.

```typescript
import { ai } from '@dotdo/ai'

const response = await ai`
  You are a helpful assistant.
  User: ${userMessage}
`
```

**Features:**
- Multi-provider routing (OpenAI, Anthropic, Gemini, etc.)
- Template literal API
- Automatic retry and fallback

#### `@dotdo/api`

Self-describing Hono API layer with automatic OpenAPI generation.

```typescript
import { createAPI } from '@dotdo/api'

const api = createAPI({
  routes: {
    'GET /users': async (c) => { /* ... */ },
    'POST /users': async (c) => { /* ... */ }
  }
})
```

#### `@dotdo/observability`

Comprehensive observability with structured logging, distributed tracing, and metrics.

```typescript
import {
  createStructuredLogger,
  createTracer,
  observability,
  createDOObservability
} from '@dotdo/observability'

// Structured logging
const logger = createStructuredLogger({ service: 'my-service' })
logger.info('User created', { userId: '123' })

// Distributed tracing (W3C Trace Context compatible)
const tracer = createTracer({ name: 'my-service' })
tracer.startActiveSpan('processOrder', (span) => {
  span.setAttribute('order.id', orderId)
  // ... process order
})

// Hono middleware
app.use('/*', observability({ service: 'my-api' }))

// DO integration
const obs = createDOObservability({ service: 'my-do' })
```

**Subpath imports** for tree-shaking:
- `@dotdo/observability/logger` - Structured logging only
- `@dotdo/observability/tracing` - Distributed tracing only
- `@dotdo/observability/metrics` - Metrics collection only
- `@dotdo/observability/middleware` - Hono middleware only
- `@dotdo/observability/context` - Context propagation only

---

## Key Concepts

### The `$` Context

Every Durable Object has a workflow context (`$`) that handles execution, events, and scheduling:

```typescript
// Event handlers via two-level proxy
$.on.Customer.signup(handler)      // No class definitions needed
$.on.Payment.failed(handler)       // Any Noun.verb combination
$.on.*.created(handler)            // Wildcards supported

// Scheduling via fluent DSL
$.every.monday.at('9am')(handler)  // Parses to CRON
$.every.hour(handler)              // No CRON syntax required

// Cross-DO RPC with circuit breakers
await $.Customer(id).notify()      // Automatic retry
await $.Order(id).fulfill()        // Stub caching + LRU
```

### Graph-Based State

dotdo uses a graph model—Things connected by Relationships:

```typescript
// Create entities
const customer = await $.things.create({ $type: 'Customer', name: 'Alice' })
const order = await $.things.create({ $type: 'Order', total: 150 })

// Connect them
await $.relationships.create({
  from: customer.$id,
  to: order.$id,
  type: 'placed'
})

// Traverse the graph
const orders = await $.things.related(customer.$id, 'placed')
```

**Why graphs?**

Traditional ORMs force you to think in tables. Real applications think in relationships:
- **User** owns **Documents**
- **Order** contains **LineItems**
- **Team** includes **Members**

The graph model makes these natural. No foreign keys, no join tables—just Things and Relationships.

### Extended Primitives

> **Note:** Extended primitives (fsx, gitx, bashx, npmx) exist as separate submodules but are **not wired automatically** to the `$` context. See the [Primitives Status](#primitives-status) section for details.

#### fsx: Filesystem on SQLite

When wired to the `$` context:

```typescript
// Requires manual wiring - see Primitives Status section
await $.fs.writeFile('data/report.json', JSON.stringify(data))
await $.fs.readFile('content/index.mdx', { encoding: 'utf-8' })
await $.fs.mkdir('uploads', { recursive: true })
```

Full POSIX semantics implemented on DO SQLite:
- **Inodes** stored as rows
- **Directory trees** as hierarchical queries
- **Tiered storage**: hot (SQLite) → warm (R2) → cold (archive)

#### gitx: Git Operations

When wired to the `$` context:

```typescript
// Requires manual wiring - see Primitives Status section
await $.git.sync()
await $.git.add('src/index.ts')
await $.git.commit('feat: add new feature')
await $.git.push()
```

Complete Git internals reimplemented for edge:
- **Blobs, trees, commits** stored in R2 (content-addressable)
- **SHA-1 hashing** via `crypto.subtle`
- **Refs** tracked in DO metadata

#### bashx: Shell Without VMs

When wired to the `$` context:

```typescript
// Requires manual wiring - see Primitives Status section
const result = await $.bash.exec('ls', ['-la'])
await $.bash.run('npm install && npm run build')
```

Shell execution without spawning VMs:
- **AST-based safety analysis** (tree-sitter parsing)
- **Native file ops** (cat, ls, head use fsx directly)
- **Tiered execution**: pure JS → Workers → Containers

---

## Primitives Status

This section documents the implementation status of extended primitives (fsx, gitx, bashx, npmx).

### Summary

| Primitive | Package | Status | `$` Context Wiring |
|-----------|---------|--------|-------------------|
| **fsx** | `fsx/` submodule | Implemented | **Automatic** (via mixin) or Manual |
| **gitx** | `gitx/` submodule | Implemented | **Automatic** (via mixin) or Manual |
| **bashx** | `bashx/` submodule | Implemented | **Automatic** (via mixin) or Manual |
| **npmx** | `npmx/` submodule | Implemented | **Automatic** (via mixin) or Manual |

### Current Architecture

The primitives are **implemented** in separate submodule directories (`fsx/`, `gitx/`, `bashx/`, `npmx/`) and are re-exported from `do/primitives/index.ts`.

**Two wiring options:**

1. **Automatic** - Use the `DOWithPrimitives` mixin (recommended)
2. **Manual** - Wire primitives yourself for full control

### How to Wire Primitives

#### Option 1: DOWithPrimitives Mixin (Recommended)

The simplest way to add primitives is the `DOWithPrimitives` mixin - one line to enable all primitives:

```typescript
import { DO, DOWithPrimitives } from '@dotdo/do'

// One-line integration - just extend DOWithPrimitives
export class MyApp extends DOWithPrimitives(DO) {
  async handleRequest() {
    // All primitives available via $ context
    await this.$.fs.writeFile('/config.json', JSON.stringify(config))
    const files = await this.$.fs.readdir('/data')
  }
}

// With explicit configuration
export class DevEnv extends DOWithPrimitives(DO, {
  fs: { basePath: '/workspace' },
  bash: { executor: containerExecutor },
  git: { repo: 'org/repo', branch: 'main' }
}) {
  async setupProject() {
    await this.$.git.sync()
    await this.$.bash.exec('npm', ['install'])
  }
}

// Selective enablement
export class FilesOnly extends DOWithPrimitives(DO, {
  fs: true,      // Enable filesystem
  git: false,    // Disable git
  bash: false,   // Disable bash
  npm: false     // Disable npm
}) {
  // Only $.fs is available
}
```

**Features:**
- **Lazy initialization** - Primitives are created on first access
- **Auto-wiring** - Automatically wires to R2 bindings and SQLite storage
- **Composable** - Works with other mixins: `DOWithPrimitives(WithAuth(DO))`
- **Type-safe** - Full TypeScript support with capability checking

```typescript
// Check primitive availability at runtime
if (this.hasPrimitive('git')) {
  await this.$.git.commit('feat: new feature')
}

// Get list of available primitives
const available = this.getAvailablePrimitives() // ['fs', 'git', 'bash']
```

#### Option 2: Manual Wiring

For full control, wire primitives manually:

```typescript
import { DO, createContext, type FsCapability, type GitCapability, type BashCapability } from '@dotdo/do'
import { FSx, MemoryBackend } from '@dotdo/do/primitives'

export class MyDOWithPrimitives extends DO {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env)

    // Create primitive implementations
    const fsCapability = createFsCapability(state)
    const gitCapability = createGitCapability(state, env)
    const bashCapability = createBashCapability(fsCapability)

    // Override $ with primitives wired
    this.$ = createContext(state, env, {
      fs: fsCapability,
      git: gitCapability,
      bash: bashCapability,
    })
  }
}

// Helper to create FsCapability from FSx
function createFsCapability(state: DurableObjectState): FsCapability {
  const fsx = new FSx({ backend: new MemoryBackend() })
  return {
    name: 'fs',
    readFile: (path, opts) => fsx.readFile(path, opts),
    writeFile: (path, data) => fsx.writeFile(path, data),
    exists: (path) => fsx.exists(path),
    mkdir: (path, opts) => fsx.mkdir(path, opts),
    readdir: (path) => fsx.readdir(path),
    stat: (path) => fsx.stat(path),
    unlink: (path) => fsx.unlink(path),
    rmdir: (path) => fsx.rmdir(path),
    rm: (path, opts) => fsx.rm(path, opts),
  }
}
```

### Capability Interfaces

Each primitive has a defined capability interface:

**FsCapability** (`$.fs`):
- `readFile(path, options?)` - Read file contents
- `writeFile(path, data)` - Write file
- `exists(path)` - Check if path exists
- `mkdir(path, options?)` - Create directory
- `readdir(path)` - List directory contents
- `stat(path)` - Get file/directory stats
- `unlink(path)` - Delete file
- `rmdir(path)` - Delete directory
- `rm(path, options?)` - Remove file or directory

**GitCapability** (`$.git`):
- `binding` - Repository binding info (repo, branch, commit)
- `sync()` - Sync with remote
- `push()` - Push changes
- `status()` - Get repository status
- `add(files)` - Stage files
- `commit(message)` - Create commit
- `diff()` - Get diff output
- `log()` - Get commit history
- `pull()` - Pull from remote

**BashCapability** (`$.bash`):
- `exec(command, args?, options?)` - Execute command with args
- `run(script)` - Run shell script
- `parse(input)` - Parse shell script to AST
- `analyze(input)` - Analyze command safety
- `isDangerous(input)` - Check if command is dangerous

**NpmCapability** (`$.npm`):
- `install(packages?, options?)` - Install packages
- `uninstall(packages)` - Remove packages
- `run(script, args?)` - Run npm script
- `list(options?)` - List installed packages
- `search(query)` - Search npm registry
- `info(name, version?)` - Get package info

### Implementation Status

The `DOWithPrimitives` mixin provides:

- **Automatic wiring via env bindings** - Detects R2 bindings and SQLite storage automatically
- **Lazy initialization** - Primitives are created on first access for efficiency
- **Composable mixins** - Use `DOWithPrimitives(WithAuth(DO))` to combine capabilities
- **Pre-built DO variant** - `DOWithPrimitives(DO)` provides all primitives with zero configuration

See [ADR-004](./docs/adr/ADR-004-workflow-context-modules.md) for the composable modules design.

---

## Storage Architecture

### Tiered Storage (Implemented)

The `@dotdo/db` package provides a working tiered storage system:

```
+---------------------------------------------------------------------+
|                    HOT: Cloudflare Cache API                        |
|  Free, fastest, ephemeral, global edge. Auto-promotes on access.    |
+-----------------------------+---------------------------------------+
                              | Promotion/Demotion
                              v
+---------------------------------------------------------------------+
|                  WARM: DO SQLite                                    |
|  Active working set. 50ms reads. 10GB per shard. Source of truth.   |
+-----------------------------+---------------------------------------+
                              | Archive on demand
                              v
+---------------------------------------------------------------------+
|                  COLD: R2 Object Storage                            |
|  Durable, unlimited, $0 egress. For archival and large datasets.    |
+---------------------------------------------------------------------+
```

**Available now:**
- `TieredStorageAdapter` - Unified interface across all three tiers
- Auto-promotion based on access patterns (configurable threshold)
- Manual promotion/demotion with event callbacks
- Statistics tracking for all tiers
- Write-through option for immediate cold tier durability

```typescript
import { createTieredStorageAdapter, createCacheLayer, R2StorageLayer } from '@dotdo/db'

const tieredStorage = createTieredStorageAdapter({
  cacheLayer: await createCacheLayer({ cacheName: 'dotdo', ttlSeconds: 300, baseUrl: 'https://cache.dotdo.dev' }),
  doStorage: sqliteAdapter,  // Your DO's SQLite storage
  r2Layer: new R2StorageLayer({ bucket: env.R2_BUCKET, prefix: 'dotdo/' }),
  promotionThreshold: 3,     // Promote after 3 accesses
  autoPromote: true,
})

// Data flows through tiers automatically
const data = await tieredStorage.get('key')  // Checks hot → warm → cold
await tieredStorage.put('key', value)        // Writes to warm by default
```

### Future: Analytics Pipeline (Roadmap)

The following architecture is planned for cross-DO analytics:

```
+---------------------------------------------------------------------+
|                    HOT: DO SQLite (per-shard)                       |
+-----------------------------+---------------------------------------+
                              | Cloudflare Pipelines (streaming)
                              v
+---------------------------------------------------------------------+
|                  WARM: R2 + Iceberg/Parquet                         |
|  Cross-DO queries. Partitioned by (ns, type, visibility)            |
+-----------------------------+---------------------------------------+
                              | R2 SQL / ClickHouse connector
                              v
+---------------------------------------------------------------------+
|                  COLD: ClickHouse + R2 Archive                      |
|  Analytics, aggregations, time-series.                              |
+---------------------------------------------------------------------+
```

**Planned features:**
- Automatic archival to R2 with Iceberg table format
- Cross-DO SQL queries via R2 SQL or ClickHouse
- Pipeline-as-WAL for zero data loss on DO eviction

---

## Testing

### Philosophy: NO MOCKS

**Durable Objects require NO MOCKING.** Miniflare runs real DOs with real SQLite locally.

```typescript
import { env } from 'cloudflare:test'

// Get real DO instance
const stub = env.DO.get(env.DO.idFromName('test'))

// Test via RPC (preferred)
const result = await stub.things.create({ $type: 'Customer', name: 'Alice' })
expect(result.$id).toBeDefined()

// Test via fetch
const res = await stub.fetch('https://test.api.dotdo.dev/customers')
expect(res.status).toBe(200)
```

### Running Tests

```bash
npm test                          # Vitest watch mode
npm run test:run                  # Run tests once
npx vitest run path/to/test.ts    # Single file
npx vitest --project=do           # DO tests (miniflare)
```

**Never mock stores or DO state**—use real miniflare instances.

### Benchmarks

Performance regression tests are run in CI to prevent performance degradation. All benchmarks are located in [`tests/benchmarks/`](./tests/benchmarks/).

```bash
npm run benchmark                # Run all benchmarks
npm run benchmark:compare        # Compare with baseline
npm run benchmark:compare -- --ci  # Fail on critical regressions
npm run benchmark:update         # Update baseline with current results
npm run benchmark:report         # Generate detailed report
```

**Benchmark suites** (in `tests/benchmarks/`):
- [`rpc-latency.bench.ts`](./tests/benchmarks/rpc-latency.bench.ts) - RPC call latency (simple, complex args, concurrent, large responses)
- [`storage.bench.ts`](./tests/benchmarks/storage.bench.ts) - Storage operations (read, write, batch, large values, list)
- [`do-instantiation.bench.ts`](./tests/benchmarks/do-instantiation.bench.ts) - DO instantiation time (base, subclass, with routes)
- [`websocket.bench.ts`](./tests/benchmarks/websocket.bench.ts) - WebSocket throughput (serialization, broadcast, connection tracking)
- [`entity-relationship.bench.ts`](./tests/benchmarks/entity-relationship.bench.ts) - Entity and relationship operations
- [`query-builder.bench.ts`](./tests/benchmarks/query-builder.bench.ts) - Query builder performance

**CI Integration:**
- Benchmarks run automatically on every PR to main
- Results are compared against the stored baseline
- Critical regressions (>10-20% depending on benchmark) fail the CI build
- Baseline is auto-updated when changes merge to main

**Custom thresholds:**
```bash
# Set custom regression threshold for a specific benchmark
npx tsx tests/benchmarks/cli.ts threshold rpc-call-latency 15
```

---

## Examples

Check out the examples in the v1 reference implementation (`.worktrees/v1/examples/`):

### Basic Examples
- `do-start/01-basic-rest-api` - Simple REST API with DO
- `do-start/02-mdx-marketing-site` - MDX-based site with fsx
- `do-start/03-multi-surface` - Web + API + WebSocket

### Real-World Patterns
- `ecommerce-checkout` - Shopping cart with inventory management
- `marketplace-escrow` - Payment escrow with state machines
- `saas-billing-cycle` - Subscription billing with events
- `workflow-event-choreography` - Event-driven workflows

### AI Agents
- `agent-code-review` - Automated code reviews
- `agent-incident-response` - Incident management
- `agent-startup-launch` - Launch campaign orchestration

### Primitive Demos
- `primitive-git-ops` - Git operations with gitx
- `primitive-shell-scripting` - Shell scripts with bashx
- `primitive-multi-tools` - Combining fsx, gitx, bashx

### Deployment
- `deploy/docker` - Docker deployment
- `deploy/kubernetes` - Helm charts
- `deploy/fly`, `deploy/railway`, `deploy/render` - Platform-specific

---

## Troubleshooting

### Common Issues

#### "Module not found" errors

Make sure you've installed dependencies:
```bash
npm install
```

If using the monorepo, ensure workspaces are linked:
```bash
npm install --workspaces
```

#### "Durable Object binding not found"

Check your `wrangler.toml` has the DO binding configured:
```toml
[durable_objects]
bindings = [
  { name = "MY_DO", class_name = "MyDO" }
]
```

The binding name in your code must match `wrangler.toml`.

#### Type errors with Cloudflare Workers types

Install the latest Workers types:
```bash
npm install --save-dev @cloudflare/workers-types@latest
```

Add to `tsconfig.json`:
```json
{
  "compilerOptions": {
    "types": ["@cloudflare/workers-types"]
  }
}
```

#### Tests fail with "env is not defined"

For Vitest tests, use the `cloudflare:test` import:
```typescript
import { env } from 'cloudflare:test'

// NOT: import { env } from 'cloudflare:workers'
```

#### Vitest processes hanging

Kill orphaned processes:
```bash
pkill -9 -f vitest
pkill -9 -f vite
```

Use `npx vitest run` instead of watch mode for CI.

### Getting Help

- **Documentation** - Start with [CLAUDE.md](./CLAUDE.md) and package READMEs
- **Examples** - Browse `.worktrees/v1/examples/` for working code
- **Issues** - Report bugs and request features at [GitHub Issues](https://github.com/dot-do/dotdo/issues)
- **Enterprise Support** - Contact [enterprise@dotdo.dev](mailto:enterprise@dotdo.dev)

## Development

### Project Structure

This is a **fresh rewrite** (v3). Reference implementations available in:
- `.worktrees/v1` - Previous stable implementation
- `.worktrees/v2` - Experimental features

### Issue Tracking with Beads

We use [beads](https://github.com/nathanclevenger/beads) for issue tracking with hierarchical IDs:

```
do-7rf           [epic]     dotdo v3 Monorepo
├── do-7rf.1     [task]     @dotdo/rpc Package
├── do-7rf.2     [task]     @dotdo/mcp Package
├── do-7rf.10    [task]     Root README.md
└── ...
```

**Common commands:**

```bash
bd ready                              # Find work (no blockers)
bd list --status=open                 # All open issues
bd show <id>                          # Issue details with hierarchy
bd update <id> --status=in_progress   # Claim work
bd close <id>                         # Complete issue
bd sync --from-main                   # Sync beads updates
```

### Contributing

1. Check for open issues: `bd ready`
2. Claim an issue: `bd update <id> --status=in_progress`
3. Make your changes
4. Run tests: `npm test`
5. Type check: `npm run typecheck`
6. Close the issue: `bd close <id>`
7. Sync: `bd sync --from-main`
8. Commit: `git add -A && git commit -m "..."`

**Note:** This is an ephemeral branch (v3). Code merges to main locally, not pushed to remote.

### Process Management

**Vitest/Vite consume memory.** Guidelines:

1. Never run multiple vitest instances in parallel
2. Use `npx vitest run` (not watch mode) for CI
3. Kill orphans: `pkill -9 -f vitest; pkill -9 -f vite`

---

## Technical Foundation

- **Runtime:** Cloudflare Workers (V8 isolates, 0ms cold starts)
- **Storage:** Durable Objects (SQLite, single-threaded consistency)
- **Object Storage:** R2 ($0 egress, tiered with Cache API)
- **Analytics:** ClickHouse integration (roadmap)
- **RPC:** Cap'n Web (promise pipelining)

---

## What You Can Build

dotdo provides the infrastructure for:

- **Multi-tenant SaaS** with per-tenant isolation
- **Real-time collaboration** with guaranteed delivery
- **AI agents** with persistent memory and tool access
- **E-commerce platforms** with inventory management
- **IoT backends** with edge processing
- **Autonomous systems** with durable workflows

The runtime handles the hard parts—state management, sharding, replication, and primitives. You focus on your application logic.

---

## Comparison

### dotdo vs Workers.do

| | **dotdo (this repo)** | **workers.do** |
|---|---|---|
| **Role** | Runtime/Framework | Platform/Product |
| **Analogy** | Node.js | Heroku |
| **Users** | Infrastructure developers | Startup founders, teams |
| **Package** | `dotdo` | `agents.do`, `teams.do`, `workers.do` |

**What belongs HERE (dotdo):**
- DO class with SQLite storage
- Extended primitives (fsx, gitx, bashx, npmx, pyx)
- Cap'n Web RPC and transport layers
- WorkflowContext ($) and event system
- AI module with template literals and LLM routing

**What belongs in workers.do:**
- Named agents (Priya, Ralph, Tom)
- Teams and Business-as-Code
- 90+ API-compatible SDKs (redis, postgres, stripe, etc.)

---

## Related Projects

- [workers.do](https://workers.do) - Platform/Product layer
- [agents.do](https://agents.do) - AI agents built on dotdo
- [workflows.do](https://workflows.do) - Visual workflow builder
- [MDXUI](https://mdxui.dev) - UI components for MDX
- [compat repo](https://github.com/dot-do/compat) - 90+ API-compatible SDKs

---

## Documentation

- **[CLAUDE.md](./CLAUDE.md)** - Guidance for Claude Code when working with this codebase
- **[AGENTS.md](./AGENTS.md)** - AI agent specifications and patterns
- **[Benchmarks](./tests/benchmarks/)** - Performance benchmarks and regression tests
- **[v1 Reference](./.worktrees/v1/README.md)** - Previous implementation documentation
- **[Unified Storage](./.worktrees/v1/objects/unified-storage/README.md)** - Pipeline-as-WAL architecture

---

## License

MIT License - see [LICENSE](./LICENSE) for details.

---

## Community

Join the dotdo community to get help, share ideas, and connect with other developers.

### Get Involved

- **[GitHub Issues](https://github.com/dot-do/dotdo/issues)** - Report bugs and request features
- **[Contributing Guidelines](./CONTRIBUTING.md)** - Learn how to contribute to dotdo
- **[Code of Conduct](./CODE_OF_CONDUCT.md)** - Our community standards

### Ways to Contribute

- **Report bugs** - Found something broken? [Open an issue](https://github.com/dot-do/dotdo/issues/new?template=bug_report.yml)
- **Suggest features** - Have an idea? [Open a feature request](https://github.com/dot-do/dotdo/issues/new?template=feature_request.yml)
- **Submit PRs** - Check out our [contributing guide](./CONTRIBUTING.md)

---

## Support

- **Questions:** [Open an issue](https://github.com/dot-do/dotdo/issues/new) for help and questions
- **Bugs:** [Report bugs](https://github.com/dot-do/dotdo/issues/new?template=bug_report.yml)
- **Features:** [Request features](https://github.com/dot-do/dotdo/issues/new?template=feature_request.yml)
- **Enterprise:** Contact [enterprise@dotdo.dev](mailto:enterprise@dotdo.dev)

---

**Built with care on Cloudflare Workers**
