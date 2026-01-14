# [dotdo](https://dotdo.dev)

**Edge-native runtime for Durable Objects.** The missing Node.js for V8 isolates—extended primitives, graph-based state, and zero cold starts.

```typescript
import { DOBase, $ } from 'dotdo'

export class MyApp extends DOBase {
  async onRequest(request: Request) {
    // Full POSIX filesystem on SQLite
    await $.fs.write('data/config.json', { version: '1.0' })

    // Git operations without shelling out
    await $.git.commit('feat: initial setup')

    // Event-driven architecture
    $.on.User.created(user => this.onboard(user))

    // Cross-DO RPC with circuit breakers
    await $.Tenant(id).notify()
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

## The V8 Isolate Runtime

A Cloudflare Worker is a **V8 isolate**—the same JavaScript engine that runs in Chrome. Think of it as a virtual browser tab:

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

---

## Extended Primitives

V8 isolates don't have filesystems, Git, or shells. We built them from scratch:

### fsx: Filesystem on SQLite

```typescript
await $.fs.write('data/report.json', data)
await $.fs.read('content/index.mdx')
await $.fs.glob('**/*.ts')
await $.fs.mkdir('uploads', { recursive: true })
```

Full POSIX semantics implemented on DO SQLite. Not a wrapper—a complete filesystem:

- **Inodes** stored as rows
- **Directory trees** as hierarchical queries
- **Tiered storage**: hot (SQLite) -> warm (R2) -> cold (archive)
- Works anywhere V8 runs

### gitx: Git on fsx + R2

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
- **Event-driven sync** when repos change

### bashx: Shell Without VMs

```typescript
const result = await $.bash`npm install && npm run build`
await $.bash`ffmpeg -i input.mp4 -c:v libx264 output.mp4`
await $.bash`python analyze.py --input ${data}`
```

Shell execution without spawning VMs:

- **AST-based safety analysis** (tree-sitter parsing)
- **Native file ops** (cat, ls, head use fsx directly)
- **Tiered execution**: pure JS -> Workers -> Containers
- **Sandboxed per-request** with resource limits

### npmx & pyx

Package management and Python execution on the edge:

```typescript
await $.npm.install('lodash')
await $.py`import pandas; df = pandas.read_csv('data.csv')`
```

---

## Graph-Based State Management

dotdo uses a graph model for state—Things connected by Relationships:

```typescript
// Create entities
const customer = await $.things.create({ type: 'Customer', name: 'Alice' })
const order = await $.things.create({ type: 'Order', total: 150 })

// Connect them
await $.relationships.create({
  from: customer.id,
  to: order.id,
  type: 'placed'
})

// Traverse the graph
const orders = await $.things.related(customer.id, 'placed')
```

### Why Graphs?

Traditional ORMs force you to think in tables. Real applications think in relationships:

- **User** owns **Documents**
- **Order** contains **LineItems**
- **Team** includes **Members**

The graph model makes these natural. No foreign keys, no join tables—just Things and Relationships.

### Storage Tiers

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

Data flows automatically. Old versions archive to R2. Analytics stream to Iceberg. You query with SQL.

**R2 has $0 egress.** Your analytics cost pennies, not thousands.

---

## The $ Context

Every Durable Object has a workflow context (`$`) that handles execution, events, and scheduling:

```typescript
// Three durability levels
$.send(event)              // Fire-and-forget (best-effort)
$.try(action)              // Single attempt (fail-fast)
$.do(action)               // Durable with retries (guaranteed)

// Event handlers via two-level proxy
$.on.Customer.signup(handler)      // No class definitions needed
$.on.Payment.failed(handler)       // Any Noun.verb combination
$.on.*.created(handler)            // Wildcards supported

// Scheduling via fluent DSL
$.every.monday.at('9am')(handler)  // Parses to CRON
$.every.hour(handler)              // No CRON syntax required
$.every('first monday', handler)   // Natural language

// Cross-DO resolution with circuit breakers
await $.Customer(id).notify()      // RPC with automatic retry
await $.Order(id).fulfill()        // Stub caching + LRU eviction
```

The event DSL uses Proxies. `$.on.Customer` returns a Proxy. `.signup` returns a function. No boilerplate classes, no `CustomerSignupEvent` definitions. Infinite combinations.

---

## Cap'n Web RPC

dotdo uses [Cap'n Web](https://github.com/cloudflare/capnweb), an object-capability RPC system with promise pipelining:

```typescript
// This is ONE network round trip, not two
const user = $.User(id)
const orders = user.orders()
const total = orders.sum('amount')
const result = await total  // Only await at the end
```

**Promise Pipelining:** Unawaited promises pass directly to servers. The server receives the entire pipeline and executes it in one pass.

```typescript
// Magic Map - runs server-side, one round trip
const results = await $.Users.list()
  .map(user => user.orders.count())
```

The `.map()` isn't JavaScript's array method. It records your callback, sends it to the server, and replays it for each result. Record-replay, not code transfer.

### Connect From Anywhere

Your Durable Object is already an API. No routes to define.

```typescript
import { $Context } from 'dotdo'

const $ = $Context('https://api.example.com')
await $.Customer('alice').orders.create({ item: 'widget', qty: 5 })
```

Works in browsers, Node.js, mobile apps, other Workers. The client is a Proxy that records calls, sends them as a single request, and returns the result.

---

## 90 API-Compatible SDKs

Use the APIs you already know. We've built edge-native compatibility layers:

**AI/ML:**
`@dotdo/anthropic` `@dotdo/cohere` `@dotdo/google-ai` `@dotdo/openai`

**Analytics:**
`@dotdo/amplitude` `@dotdo/analytics` `@dotdo/cubejs` `@dotdo/mixpanel` `@dotdo/segment` `@dotdo/vitals`

**Auth:**
`@dotdo/auth` `@dotdo/auth0` `@dotdo/clerk` `@dotdo/firebase-auth` `@dotdo/supabase-auth`

**Automation:**
`@dotdo/automation` `@dotdo/n8n` `@dotdo/zapier`

**CRM/Sales:**
`@dotdo/close` `@dotdo/freshdesk` `@dotdo/helpscout` `@dotdo/hubspot` `@dotdo/intercom` `@dotdo/pipedrive` `@dotdo/salesforce` `@dotdo/zendesk`

**Databases:**
`@dotdo/couchdb` `@dotdo/duckdb` `@dotdo/neo4j` `@dotdo/postgres` `@dotdo/supabase`

**DevOps:**
`@dotdo/datadog` `@dotdo/doppler` `@dotdo/flags` `@dotdo/launchdarkly` `@dotdo/sentry` `@dotdo/vault`

**E-commerce:**
`@dotdo/medusa` `@dotdo/payload` `@dotdo/shopify` `@dotdo/square` `@dotdo/stripe` `@dotdo/tally` `@dotdo/woocommerce`

**Email/SMS:**
`@dotdo/convertkit` `@dotdo/emails` `@dotdo/klaviyo` `@dotdo/mailchimp` `@dotdo/messagebird` `@dotdo/resend` `@dotdo/sendgrid` `@dotdo/twilio` `@dotdo/vonage`

**Messaging/Real-time:**
`@dotdo/ably` `@dotdo/discord` `@dotdo/fcm` `@dotdo/onesignal` `@dotdo/pubsub` `@dotdo/pusher` `@dotdo/slack` `@dotdo/socketio` `@dotdo/sqs`

**Productivity:**
`@dotdo/calendly` `@dotdo/docusign` `@dotdo/jira` `@dotdo/linear` `@dotdo/quickbooks` `@dotdo/zoom`

**Search:**
`@dotdo/algolia` `@dotdo/elasticsearch` `@dotdo/meilisearch` `@dotdo/typesense`

**Vector:**
`@dotdo/chroma` `@dotdo/pinecone` `@dotdo/qdrant` `@dotdo/weaviate`

**Source Control:**
`@dotdo/github` `@dotdo/gitlab`

**Storage:**
`@dotdo/cloudinary` `@dotdo/gcs` `@dotdo/mapbox` `@dotdo/s3`

**Streaming/Data:**
`@dotdo/airbyte` `@dotdo/benthos` `@dotdo/flink` `@dotdo/metabase`

**Other:**
`@dotdo/calls` `@dotdo/contentful` `@dotdo/crm` `@dotdo/paypal`

```typescript
// Drop-in replacement
import { createClient } from '@dotdo/supabase'

const supabase = createClient(url, key)
const { data } = await supabase.from('users').select('*')
```

Same API. But running on Durable Objects with automatic sharding, geo-replication, and tiered storage.

### Why Compat Layers?

Every one of these services breaks under parallel load:

| Original | Problem at Scale | @dotdo Solution |
|----------|------------------|-----------------|
| **Supabase** | Connection pooling limits | Sharded across DOs |
| **MongoDB** | Write lock contention | Single-threaded per shard |
| **Redis** | Memory limits per instance | Tiered to R2 |
| **Kafka** | Partition rebalancing storms | DO-native queues |
| **Postgres** | Connection exhaustion | Per-tenant DO isolation |

---

## DO Proxy Workers

Route requests to Durable Objects with the `API()` factory:

```typescript
import { API } from 'dotdo'

// Hostname mode (default) - subdomain -> DO namespace
export default API()  // tenant.api.dotdo.dev -> DO('tenant')

// Path param routing (Express-style)
export default API({ ns: '/:org' })  // api.dotdo.dev/acme/users -> DO('acme')

// Nested path params
export default API({ ns: '/:org/:project' })  // -> DO('acme:proj1')

// Fixed namespace (singleton DO)
export default API({ ns: 'main' })
```

---

## Sharding & Replication

### Automatic Sharding

A single DO has a 10GB SQLite limit. We shard automatically:

```typescript
await app.shard({
  key: 'customerId',
  count: 16,
  strategy: 'hash'  // or 'range', 'round-robin', custom
})
```

Maximum 1000 shards per DO. Consistent hashing minimizes redistribution on scale events.

### Geo-Replication

```typescript
await app.replicate({
  primary: 'us-east',
  secondaries: ['eu-west', 'asia-pacific'],
  readPreference: 'nearest',
})
```

Read from the closest replica. Write to primary. Automatic failover.

### City/Colo Targeting

```typescript
await thing.promote({
  colo: 'Tokyo',     // IATA code: 'nrt'
  region: 'asia-pacific',
})
```

24 IATA codes. 9 geographic regions. Data residency compliance built in.

### Promote/Demote

Scale dynamically. Start as a Thing (row in parent DO), promote to independent DO when it needs isolation:

```typescript
// Thing -> Durable Object
const newDO = await customer.promote({
  namespace: 'https://customers.acme.com',
  colo: 'Frankfurt'  // GDPR compliance
})

// Durable Object -> Thing (fold back in)
await customer.demote({ preserveHistory: true })
```

---

## Base Classes

```typescript
import { DOBase, Entity } from 'dotdo'

// DOBase - full-featured base class
export class MyApp extends DOBase {
  // REST router, SQLite, persistence, RPC
}

// Entity - domain objects with CRUD
export class Customer extends Entity {
  // Automatic REST endpoints, validation, events
}
```

---

## Architecture

```
objects/       # Durable Object classes - the core runtime
  DOBase.ts    # Base class with REST router, SQLite, persistence
  Entity.ts    # Domain objects with CRUD
  Workflow*.ts # Workflow runtime, factory, state machines
types/         # TypeScript types (Thing, Noun, Verb, WorkflowContext)
db/            # Drizzle schemas + tiered storage
  iceberg/     # Parquet navigation (50-150ms)
  stores.ts    # Things, Actions, Events, Search
workflows/     # $ context DSL
  on.ts        # Event handlers via two-level proxy
  proxy.ts     # Pipeline promises
  context/     # Execution modes
compat/        # 90 API-compatible SDKs
primitives/    # Edge-native implementations
  fsx/         # Filesystem on SQLite
  gitx/        # Git on R2
  bashx/       # Shell without VMs
  npmx/        # Package management
  pyx/         # Python execution
api/           # Hono HTTP + middleware
workers/       # DO proxy workers
lib/           # Shared utilities
```

---

## Quick Start

```bash
npm install dotdo
npx dotdo init my-app
npx dotdo dev
```

```typescript
import { DOBase } from 'dotdo'

export class MyApp extends DOBase {
  async fetch(request: Request) {
    return new Response('Hello from the edge')
  }
}
```

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

## Related Projects

- [agents.do](https://agents.do) - AI agents built on dotdo
- [workers.do](https://workers.do) - Teams of AI workers
- [workflows.do](https://workflows.do) - Visual workflow builder
- [platform.do](https://platform.do) - Unified platform

---

MIT License
