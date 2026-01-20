# dotdo

**Edge-native runtime for Durable Objects.** The missing primitives for V8 isolates—filesystem, git, shell execution, and graph-based state management.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![npm version](https://badge.fury.io/js/dotdo.svg)](https://www.npmjs.com/package/dotdo)

```typescript
import { DO, createContext, ai } from 'dotdo'

export class MyApp extends DO {
  private $ = createContext(this.state, this.env)

  constructor(state: DurableObjectState, env: Env) {
    super(state, env)

    // Event-driven architecture with $ context
    this.$.on.Customer.signup(async (event) => {
      // Store data in built-in entity store
      await this.things.create({
        $type: 'CustomerProfile',
        customerId: event.payload.id,
        ...event.payload
      })

      // AI with template literals
      const welcome = await ai`Write a welcome message for ${event.payload.name}`

      // Cross-DO RPC
      await this.$.Email('welcome').send({
        to: event.payload.email,
        body: welcome
      })
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

```bash
npm install dotdo
```

Or use the CLI to scaffold a new project:

```bash
npx dotdo init my-app
cd my-app
npm install
```

### Create Your First DO

```typescript
import { DO } from 'dotdo'
import { Hono } from 'hono'

export class MyApp extends DO {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env)
  }

  // Add custom routes
  protected routes(app: Hono) {
    app.get('/users', async (c) => {
      const users = await this.things.list({ $type: 'User' })
      return c.json(users)
    })

    app.post('/users', async (c) => {
      const data = await c.req.json()
      const user = await this.things.create({
        $type: 'User',
        ...data
      })
      return c.json(user)
    })
  }
}
```

### Development

```bash
npm run dev          # Start Wrangler dev server
npm test             # Run tests with Vitest
npm run test:run     # Run tests once (CI mode)
npm run typecheck    # TypeScript type checking
npm run deploy       # Deploy to Cloudflare
```

---

## Architecture

This is a **monorepo** organized as a workspace. Each package handles a specific concern:

```
dotdo/             # Main package - re-exports everything
├── @dotdo/do      # THE Durable Object class with $ context
├── @dotdo/db      # Storage layer (Things, Relationships, Events)
├── @dotdo/rpc     # Cap'n Web RPC with promise pipelining
├── @dotdo/mcp     # Model Context Protocol server (3 tools)
├── @dotdo/ai      # AI routing and template literals
├── @dotdo/auth    # Hono auth middleware
└── @dotdo/api     # Self-describing REST API layer
```

### Extended Primitives (Submodules)

Located in `primitives/`:
- **fsx** - Full POSIX filesystem on SQLite
- **gitx** - Git operations with R2 storage
- **bashx** - Shell execution without VMs
- **npmx** - Package management for edge
- **pyx** - Python runtime (experimental)

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

THE Durable Object class with built-in entity stores and WorkflowContext.

```typescript
import { DO } from '@dotdo/do'
import { createContext } from '@dotdo/do'

export class MyDO extends DO {
  private $: WorkflowContext

  constructor(state: DurableObjectState, env: Env) {
    super(state, env)
    this.$ = createContext(state, env)

    // Event handlers (infinite Noun.verb combinations via Proxy)
    this.$.on.Customer.signup(async (event) => {
      await sendWelcomeEmail(event.payload.email)
    })

    this.$.on.Order.placed(async (event) => {
      await processOrder(event.payload.orderId)
    })

    // Scheduling (fluent DSL)
    this.$.every.Monday.at('9am')(async () => {
      await generateWeeklyReport()
    })
  }

  protected routes(app: Hono) {
    app.get('/customers', async (c) => {
      // Direct access to entity stores
      const customers = await this.things.list({ $type: 'Customer' })
      return c.json(customers)
    })
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
import { ai, configureAI } from '@dotdo/ai'

// Configure global defaults (optional)
configureAI({
  defaultModel: 'claude-sonnet-4',
  defaultTemperature: 0.7,
  systemPrompt: 'You are a helpful assistant.',
})

// Basic usage - just await the template literal
const summary = await ai`Summarize this text: ${document}`

// Override model and options per-call
const poem = await ai`Write a poem about ${topic}`.with({
  model: 'claude-opus-4',
  temperature: 0.9,
})

// Streaming responses
for await (const chunk of ai`Write a story about ${character}`.stream()) {
  process.stdout.write(chunk)
}

// Access metadata after resolution
const promise = ai`Explain ${concept}`
const result = await promise
console.log(promise.$meta.tokens)   // { input: 15, output: 150 }
console.log(promise.$meta.cost)     // 0.00045
console.log(promise.$meta.duration) // 1234 (ms)
```

**Features:**
- Multi-provider routing (Anthropic, OpenAI, Google, etc.)
- Elegant template literal API
- Streaming support
- Token counting and cost tracking
- Automatic retry and fallback

#### `@dotdo/api`

Self-describing HATEOAS API layer with automatic OpenAPI, SDK, and MCP generation.

```typescript
import { defineResource, generateLinks, withLinks, generateOpenAPI, generateMCPTools } from '@dotdo/api'

// Define a resource once
defineResource('customers', {
  fields: {
    name: { type: 'string', required: true },
    email: { type: 'string', required: true },
  },
  actions: ['activate', 'deactivate'],
  relations: {
    orders: { resource: 'orders', type: 'hasMany' },
  },
})

// Responses include navigable HATEOAS links
const customer = await this.things.get(id)
const response = withLinks(customer, generateLinks('customers', id, baseUrl, {
  actions: ['activate', 'deactivate'],
  relations: { orders: { resource: 'orders', type: 'hasMany' } },
}))

// Returns:
// {
//   data: { $id: 'cust-123', name: 'Alice', email: 'alice@example.com' },
//   _links: {
//     self: { href: '/customers/cust-123', method: 'GET' },
//     update: { href: '/customers/cust-123', method: 'PUT' },
//     orders: { href: '/customers/cust-123/orders', method: 'GET' },
//     activate: { href: '/customers/cust-123/activate', method: 'POST' },
//   }
// }

// Auto-generate artifacts from resource definitions
const openApiSpec = generateOpenAPI(resources)   // OpenAPI 3.0 spec
const mcpTools = generateMCPTools(resources)      // MCP tools for AI agents
```

---

## Key Concepts

### The `$` Context (WorkflowContext)

The `$` context provides a fluent API for events, scheduling, and cross-DO RPC:

```typescript
import { createContext, createTypedContext } from '@dotdo/do'

const $ = createContext(state, env)

// Event handlers via two-level proxy (infinite Noun.verb combinations)
$.on.Customer.signup(async (event) => {
  console.log('New customer:', event.payload.email)
  await sendWelcomeEmail(event.payload.email)
})

$.on.Order.placed(async (event) => {
  await processOrder(event.payload.orderId)
})

// Durability levels
$.send(event)              // Fire-and-forget (no guarantees)
await $.try(riskyAction)   // Single attempt (throws on failure)
await $.do(criticalAction) // Durable with retries (guaranteed)

// Scheduling via fluent DSL
$.every.Monday.at('9am')(async () => {
  await generateWeeklyReport()
})

$.every.day.at('6pm')(async () => {
  await cleanupOldRecords()
})

$.every.hour(async () => {
  await syncExternalData()
})

// Cross-DO RPC
const profile = await $.Customer('user-123').getProfile()
await $.Order('order-456').ship()
```

#### Type-Safe Context

For full TypeScript support, use `createTypedContext`:

```typescript
// Define your DO interfaces and event schemas
interface DOBindings {
  Customer: { getProfile(): Promise<Profile>; notify(msg: string): Promise<void> }
  Order: { ship(): Promise<Status>; getItems(): Promise<string[]> }
}

interface EventSchemas {
  'Customer.signup': { customerId: string; email: string }
  'Order.placed': { orderId: string; total: number }
}

// Create typed context
const $ = createTypedContext<DOBindings, EventSchemas>(state, env)

// Full type inference!
const profile = await $.Customer('user-123').getProfile()  // Returns Promise<Profile>

$.on.Customer.signup((event) => {
  // event.payload is typed as { customerId: string; email: string }
  console.log(event.payload.email)
})
```

### Graph-Based State

The DO class provides built-in entity stores directly on the instance:

```typescript
class MyDO extends DO {
  async example() {
    // Things - typed entities with $type and $id
    const customer = await this.things.create({
      $type: 'Customer',
      name: 'Alice',
      email: 'alice@example.com'
    })

    const order = await this.things.create({
      $type: 'Order',
      total: 150,
      status: 'pending'
    })

    // Relationships - connect entities
    await this.relationships.create({
      from: customer.$id,
      to: order.$id,
      type: 'placed'
    })

    // Events - immutable event log
    await this.events.append({
      type: 'Order.placed',
      payload: { orderId: order.$id, customerId: customer.$id }
    })

    // Query builder for complex queries
    const results = await this.query()
      .from('Customer')
      .where('status', '=', 'active')
      .orderBy('createdAt', 'desc')
      .limit(10)
      .execute()
  }
}

**Why graphs?**

Traditional ORMs force you to think in tables. Real applications think in relationships:
- **User** owns **Documents**
- **Order** contains **LineItems**
- **Team** includes **Members**

The graph model makes these natural. No foreign keys, no join tables—just Things and Relationships.

### Extended Primitives

#### fsx: Filesystem on SQLite

```typescript
await $.fs.write('data/report.json', data)
await $.fs.read('content/index.mdx')
await $.fs.glob('**/*.ts')
await $.fs.mkdir('uploads', { recursive: true })
```

Full POSIX semantics implemented on DO SQLite:
- **Inodes** stored as rows
- **Directory trees** as hierarchical queries
- **Tiered storage**: hot (SQLite) → warm (R2) → cold (archive)

#### gitx: Git Operations

```typescript
await $.git.clone('https://github.com/org/repo')
await $.git.checkout('feature-branch')
await $.git.commit('feat: add new feature')
await $.git.push('origin', 'main')
```

Complete Git internals reimplemented for edge:
- **Blobs, trees, commits** stored in R2 (content-addressable)
- **SHA-1 hashing** via `crypto.subtle`
- **Refs** tracked in DO metadata

#### bashx: Shell Without VMs

```typescript
const result = await $.bash`npm install && npm run build`
await $.bash`ffmpeg -i input.mp4 -c:v libx264 output.mp4`
```

Shell execution without spawning VMs:
- **AST-based safety analysis** (tree-sitter parsing)
- **Native file ops** (cat, ls, head use fsx directly)
- **Tiered execution**: pure JS → Workers → Containers

---

## Storage Architecture

### Tiered Storage

```
+---------------------------------------------------------------------+
|                    HOT: DO SQLite                                   |
|  Active working set. 50ms reads. 10GB per shard.                    |
+-----------------------------+---------------------------------------+
                              | Cloudflare Pipelines (streaming)
                              v
+---------------------------------------------------------------------+
|                  WARM: R2 + Iceberg/Parquet                         |
|  Cross-DO queries. 100-150ms. Partitioned by (ns, type, visibility) |
+-----------------------------+---------------------------------------+
                              | R2 SQL / ClickHouse
                              v
+---------------------------------------------------------------------+
|                  COLD: ClickHouse + R2 Archive                      |
|  Analytics, aggregations, time-series. Pennies per TB.              |
+---------------------------------------------------------------------+
```

Data flows automatically:
- Old versions archive to R2
- Analytics stream to Iceberg
- Query with SQL across all tiers

**R2 has $0 egress.** Your analytics cost pennies, not thousands.

### Pipeline-as-WAL

The unified storage module implements **Pipeline-as-WAL** (Write-Ahead Log):

```
Write Path:
  Client → PipelineEmitter → Pipeline (WAL) → ACK
                ↓
         InMemoryState
                ↓
         LazyCheckpointer → SQLite (batched)

Read Path:
  Client → InMemoryState (O(1)) → Response
```

**Key invariant:** Events are durable in Pipeline BEFORE local SQLite persistence.

**Benefits:**
- Zero data loss on DO eviction
- Immediate ACK to clients
- ~95% reduction in SQLite write operations

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

Performance regression tests are run in CI to prevent performance degradation:

```bash
npm run benchmark                # Run all benchmarks
npm run benchmark:compare        # Compare with baseline
npm run benchmark:compare -- --ci  # Fail on critical regressions
npm run benchmark:update         # Update baseline with current results
npm run benchmark:report         # Generate detailed report
```

**Benchmark suites:**
- `rpc-latency.bench.ts` - RPC call latency (simple, complex args, concurrent, large responses)
- `storage.bench.ts` - Storage operations (read, write, batch, large values, list)
- `do-instantiation.bench.ts` - DO instantiation time (base, subclass, with routes)
- `websocket.bench.ts` - WebSocket throughput (serialization, broadcast, connection tracking)

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
- **Object Storage:** R2 ($0 egress, Iceberg/Parquet)
- **Analytics:** ClickHouse (time-series, aggregations)
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
- **[v1 Reference](./.worktrees/v1/README.md)** - Previous implementation documentation
- **[Unified Storage](./.worktrees/v1/objects/unified-storage/README.md)** - Pipeline-as-WAL architecture

---

## License

MIT License - see [LICENSE](./LICENSE) for details.

---

## Community

Join the dotdo community to get help, share ideas, and connect with other developers.

### Get Involved

- **[GitHub Discussions](https://github.com/dot-do/dotdo/discussions)** - Ask questions, share ideas, and show what you've built
- **[Discord](https://workers.do/discord)** - Real-time chat with the community
- **[Contributing Guidelines](./CONTRIBUTING.md)** - Learn how to contribute to dotdo
- **[Code of Conduct](./CODE_OF_CONDUCT.md)** - Our community standards

### Ways to Contribute

- **Report bugs** - Found something broken? [Open an issue](https://github.com/dot-do/dotdo/issues/new?template=bug_report.yml)
- **Suggest features** - Have an idea? [Start a discussion](https://github.com/dot-do/dotdo/discussions/categories/ideas)
- **Submit PRs** - Check out our [contributing guide](./CONTRIBUTING.md)
- **Share your projects** - Built something cool? [Show it off](https://github.com/dot-do/dotdo/discussions/categories/show-and-tell)

---

## Support

- **Questions:** Use [GitHub Discussions](https://github.com/dot-do/dotdo/discussions/categories/q-a) for Q&A
- **Issues:** [Report bugs](https://github.com/dot-do/dotdo/issues/new?template=bug_report.yml) or [request features](https://github.com/dot-do/dotdo/issues/new?template=feature_request.yml)
- **Enterprise:** Contact [enterprise@dotdo.dev](mailto:enterprise@dotdo.dev)

---

**Built with care on Cloudflare Workers**
