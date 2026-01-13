# [.do](https://platform.do)

**Build your 1-Person Unicorn.**

```typescript
import { Startup } from 'dotdo'
import { priya, ralph, tom, mark, sally } from 'agents.do'

export class MyStartup extends Startup {
  async launch() {
    const spec = priya`define the MVP for ${this.hypothesis}`
    let app = ralph`build ${spec}`

    do {
      app = ralph`improve ${app} per ${tom}`
    } while (!await tom.approve(app))

    mark`announce the launch`
    sally`start selling`

    // Your business is running. Go back to bed.
  }
}
```

You just deployed a startup with a product team, engineering, marketing, and sales.

It's Tuesday. You're one person.

---

## How This Actually Works

dotdo is built on [Cap'n Web](https://github.com/cloudflare/capnweb), an object-capability RPC system with promise pipelining. When you write:

```typescript
const spec = priya`define the MVP`
const app = await ralph`build ${spec}`
```

You're making **one** network round trip, not two. The unawaited promise from `priya` is passed directly to `ralph`—the server receives the entire pipeline and executes it in one pass. This is **Promise Pipelining**.

If you `await` each step, you force separate round trips. Only await what you actually need.

The template literal syntax (`priya\`...\``) isn't string interpolation—it's a remote procedure call. The agent receives your intent, executes with its tools, and returns structured output.

```typescript
// This runs as a single batch, not N separate calls
const sprint = await priya`plan the sprint`
  .map(issue => ralph`build ${issue}`)
  .map(code => tom`review ${code}`)
```

The `.map()` isn't JavaScript's array method. It's a **Magic Map** that records your callback, sends it to the server, and replays it for each result. Record-replay, not code transfer. All in one network round trip.

---

## Meet Your Team

| Agent | Role |
|-------|------|
| **Priya** | Product—specs, roadmaps, priorities |
| **Ralph** | Engineering—builds what you need |
| **Tom** | Tech Lead—architecture, code review |
| **Rae** | Frontend—React, UI, accessibility |
| **Mark** | Marketing—copy, content, launches |
| **Sally** | Sales—outreach, demos, closing |
| **Quinn** | QA—testing, edge cases, quality |

Each agent has real identity—email, GitHub account, avatar. When Tom reviews your PR, you'll see `@tom-do` commenting. They're not chatbots. They're workers.

```typescript
import { priya, ralph, tom, mark, quinn } from 'agents.do'

priya`what should we build next?`
ralph`implement the user dashboard`
tom`review the pull request`
mark`write a blog post about our launch`
quinn`test ${feature} thoroughly`
```

No method names. No parameters. No awaits. Just say what you want.

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

## Connect From Anywhere

Your Durable Object is already an API. No routes to define. No schemas to maintain.

```typescript
import { $Context } from 'dotdo'

const $ = $Context('https://my-startup.example.com.ai')
await $.Customer('alice').orders.create({ item: 'widget', qty: 5 })
```

The same promise pipelining works over HTTP. One round trip for the entire chain. Your DO methods become your API automatically.

```typescript
// Local development
import { $ } from 'dotdo'
await $.Customer('alice')  // Auto-connects to localhost or do.config.ts
```

Works in browsers, Node.js, mobile apps, other Workers. The client is just a Proxy—it records your calls, sends them as a single request, and returns the result. No SDK generation. No API versioning headaches. Your code IS your contract.

---

## The DO in .do

dotdo runs on [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)—V8 isolates with SQLite storage, globally distributed with single-threaded consistency guarantees. But we've added layers:

### Sharding

A single DO has a 10GB SQLite limit. We shard automatically:

```typescript
// Hash-based distribution across 16 shards
await startup.shard({
  key: 'customerId',
  count: 16,
  strategy: 'hash'  // or 'range', 'round-robin', custom
})
```

Maximum 1000 shards per DO. Consistent hashing minimizes redistribution on scale events.

### Geo-Replication

```typescript
await startup.replicate({
  primary: 'us-east',
  secondaries: ['eu-west', 'asia-pacific'],
  readPreference: 'nearest',  // or 'primary', 'secondary'
})
```

Read from the closest replica. Write to primary. Automatic failover.

### City/Colo Targeting

```typescript
await thing.promote({
  colo: 'Tokyo',     // IATA code: 'nrt'
  region: 'asia-pacific',
  preserveHistory: true
})
```

24 IATA codes. 9 geographic regions. Data residency compliance built in.

### Promote/Demote

Scale dynamically. Start as a Thing (row in parent DO), promote to independent DO when it needs isolation:

```typescript
// Thing → Durable Object
const newDO = await customer.promote({
  namespace: 'https://customers.acme.com',
  colo: 'Frankfurt'  // GDPR compliance
})

// Durable Object → Thing (fold back in)
await customer.demote({ preserveHistory: true })
```

---

## Tiered Storage: Hot → Warm → Cold

```
┌─────────────────────────────────────────────────────────────────────┐
│                    HOT: DO SQLite                                   │
│  Active working set. 50ms reads. 10GB per shard.                   │
└────────────────────────────┬────────────────────────────────────────┘
                             │ Cloudflare Pipelines (streaming)
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  WARM: R2 + Iceberg/Parquet                         │
│  Cross-DO queries. 100-150ms. Partitioned by (ns, type, visibility) │
└────────────────────────────┬────────────────────────────────────────┘
                             │ R2 SQL / ClickHouse
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  COLD: ClickHouse + R2 Archive                      │
│  Analytics, aggregations, time-series. Pennies per TB.              │
└─────────────────────────────────────────────────────────────────────┘
```

Data flows automatically. Old versions archive to R2. Analytics stream to Iceberg. You query with SQL.

**Why this matters:** Traditional data warehouses charge per-query compute and massive egress fees. Cloudflare R2 has **$0 egress**. Your analytics cost pennies, not thousands.

---

## Pricing Reality Check

| Service | Egress | Storage | Compute |
|---------|--------|---------|---------|
| **Cloudflare R2** | **$0** | $0.015/GB-mo | Operations only |
| **AWS S3** | $0.09/GB | $0.023/GB-mo | + transfer fees |
| **Snowflake** | $0.05-0.12/GB | Credit-based | Warehouse costs |
| **BigQuery** | $0.05-0.12/GB | $0.02/GB-mo | $5/TB queried |

With R2:
- **10GB free** storage
- **10M free** Class B operations/month
- **$0 egress forever**

We're not subsidizing this. Cloudflare's network architecture makes egress free. Your data warehouse runs at a fraction of legacy costs.

---

## 38 API-Compatible SDKs

Use the APIs you already know. We've built edge-native compatibility layers:

**Databases:**
`@dotdo/postgres` · `@dotdo/mysql` · `@dotdo/mongo` · `@dotdo/supabase` · `@dotdo/firebase` · `@dotdo/neon` · `@dotdo/planetscale` · `@dotdo/cockroach` · `@dotdo/tidb` · `@dotdo/turso` · `@dotdo/duckdb` · `@dotdo/couchdb`

**Messaging:**
`@dotdo/kafka` · `@dotdo/redis` · `@dotdo/nats` · `@dotdo/sqs` · `@dotdo/pubsub`

**Real-time:**
`@dotdo/pusher` · `@dotdo/ably` · `@dotdo/socketio`

**Search:**
`@dotdo/elasticsearch` · `@dotdo/algolia` · `@dotdo/meilisearch` · `@dotdo/typesense` · `@dotdo/orama`

**Vector:**
`@dotdo/pinecone` · `@dotdo/qdrant` · `@dotdo/weaviate` · `@dotdo/chroma`

**Graph:**
`@dotdo/neo4j`

```typescript
// Drop-in replacement
import { createClient } from '@dotdo/supabase'

const supabase = createClient(url, key)
const { data } = await supabase.from('users').select('*')
```

Same API. But running on Durable Objects with automatic sharding, geo-replication, and tiered storage. Your existing code works. Your AI agents can use familiar APIs. It scales to millions.

---

## Why We Rebuilt Everything

We didn't want to reimplement Git, Bash, MongoDB, Kafka, and Supabase from scratch.

But when we dispatched 10,000 parallel AI agents, everything crumbled:
- **Databases** hit connection limits and lock contention
- **Filesystems** couldn't handle concurrent writes
- **Git** servers choked on parallel clone operations
- **Message queues** backed up under sustained load

The fundamental problem: traditional infrastructure was built for **thousands of human users**, not **millions of parallel AI agents**.

So we rebuilt everything on a different primitive.

---

## The V8 Isolate: A Virtual Chrome Tab

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

This is the primitive we built on. Not VMs. Not containers. **V8 isolates with durable state, running on the edge, right next to your users.**

---

## Extended Primitives: What V8 Isolates Can't Do

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
- **Tiered storage**: hot (SQLite) → warm (R2) → cold (archive)
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

Your agents can version control without shelling out to `git`.

### bashx: Shell Without VMs

```typescript
const result = await $.bash`npm install && npm run build`
await $.bash`ffmpeg -i input.mp4 -c:v libx264 output.mp4`
await $.bash`python analyze.py --input ${data}`
```

Shell execution without spawning VMs:
- **AST-based safety analysis** (tree-sitter parsing)
- **Native file ops** (cat, ls, head use fsx directly)
- **Tiered execution**: pure JS → Workers → Containers
- **Sandboxed per-request** with resource limits

Commands are parsed, classified by impact (read/write/delete/network/system), and blocked if dangerous unless explicitly confirmed.

---

## Why the Compat Layer Exists

We built 38 API-compatible SDKs because developers know these APIs—and because every one of them breaks under parallel agent load:

| Original | Problem at Scale | @dotdo Solution |
|----------|------------------|-----------------|
| **Supabase** | Connection pooling limits | Sharded across DOs |
| **MongoDB** | Write lock contention | Single-threaded per shard |
| **Redis** | Memory limits per instance | Tiered to R2 |
| **Kafka** | Partition rebalancing storms | DO-native queues |
| **Postgres** | Connection exhaustion | Per-tenant DO isolation |

Each compat package provides the **exact same API** but runs on Durable Objects with automatic sharding, replication, and tiering. Your code doesn't change. It just scales.

---

## Humans When It Matters (humans.do)

AI does the work. Humans make the decisions.

```typescript
import { legal, ceo, cfo } from 'humans.do'

// Same syntax as agents
const contract = await legal`review this agreement`
const approved = await ceo`approve the partnership`

// With SLA and channel
const reviewed = await legal`review contract for ${amount}`
  .timeout('4 hours')
  .via('slack')

// Custom roles
import { createHumanTemplate } from 'humans.do'
const seniorAccountant = createHumanTemplate('senior-accountant')
await seniorAccountant`approve refund over ${amount}`

// Or explicit escalation
escalation = this.HumanFunction({
  trigger: 'refund > $10000 OR audit_risk > 0.8',
  role: 'senior-accountant',
  sla: '4 hours',
})
```

### Two Human APIs

- **`$.human.*`** — Internal escalation (employees, org roles)
- **`$.user.*`** — End-user interaction (app users)

```typescript
// Internal escalation
await $.human.approve('Approve this expense?', { role: 'cfo' })

// End-user interaction
const confirmed = await $.user.confirm('Delete this item?')
const name = await $.user.prompt('Enter your name')
const size = await $.user.select('Choose size', ['S', 'M', 'L'])
```

### Multi-Channel Notifications

| Channel | Description |
|---------|-------------|
| **Slack BlockKit** | Interactive messages with approve/reject buttons |
| **Discord** | Webhook with embeds and reactions |
| **Email** | HTML templates with action links |
| **MDXUI Chat** | In-app real-time chat interface |

Messages route to Slack, email, SMS. Your workflow waits for response. Full audit trail.

---

## The Journey

### 1. Foundation Sprint

Before you build, get clarity. Define customer, problem, differentiation:

```typescript
const hypothesis = await $.foundation({
  customer: 'Freelance developers who hate tax season',
  problem: 'Spending 20+ hours on taxes instead of shipping code',
  differentiation: 'AI does 95%, human CPA reviews edge cases',
})

// Output: "If we help freelance developers automate tax preparation
// with AI-powered analysis and human CPA oversight, they will pay
// $299/year because it saves them 20+ hours."
```

### 2. Experimentation Machine

Test your hypothesis with built-in HUNCH metrics:

```typescript
const pmf = await $.measure({
  hairOnFire: metrics.urgency,        // Is this a must-have?
  usage: metrics.weeklyActive,         // Are they using it?
  nps: metrics.netPromoterScore,       // Would they recommend?
  churn: metrics.monthlyChurn,         // Are they staying?
  ltv_cac: metrics.lifetimeValue / metrics.acquisitionCost,
})

await $.experiment('pricing-test', {
  variants: ['$199/year', '$299/year', '$29/month'],
  metric: 'conversion_rate',
  confidence: 0.95,
})
```

### 3. Autonomous Business

When you find PMF, scale. Agents operate. You set policy.

```typescript
$.on.Customer.signup((customer) => {
  agents.onboarding.welcome(customer)
  agents.support.scheduleCheckin(customer, '24h')
})

$.on.Return.completed(async (return_) => {
  const review = await agents.qa.review(return_)
  if (review.confidence > 0.95) {
    agents.filing.submit(return_)
  } else {
    humans.cpa.review(return_)
  }
})

$.every.month.on(1).at('9am')(() => {
  agents.billing.processSubscriptions()
  agents.reporting.generateMRR()
})
```

Revenue flows. Profit compounds. You're one person.

---

## Quick Start

```bash
npm install dotdo
npx dotdo init my-startup
npx dotdo dev
```

```typescript
import { Startup } from 'dotdo'

export class MyStartup extends Startup {
  hypothesis = {
    customer: 'Who you serve',
    problem: 'What pain you solve',
    solution: 'How you solve it',
  }
}
```

---

## Architecture

```
api/           # Hono HTTP + middleware
objects/       # Durable Object classes (DO.ts base, 72K lines)
├── Agent.ts   # AI worker with tools
├── Human.ts   # Approval workflows
├── Entity.ts  # Domain objects
└── Startup.ts # Business container
types/         # TypeScript types (Thing, Noun, Verb, WorkflowContext)
db/            # Drizzle schemas + tiered storage
├── iceberg/   # Parquet navigation (50-150ms)
├── clickhouse.ts  # Analytics queries
└── stores.ts  # Things, Actions, Events, Search
workflows/     # $ context DSL
├── on.ts      # Event handlers
├── proxy.ts   # Pipeline promises
└── context/   # Execution modes
compat/        # 38 API-compatible SDKs
agents/        # Multi-provider agent SDK
```

---

## The Technical Foundation

- **Runtime:** Cloudflare Workers (V8 isolates, 0ms cold starts)
- **Storage:** Durable Objects (SQLite, single-threaded consistency)
- **Object Storage:** R2 ($0 egress, Iceberg/Parquet)
- **Analytics:** ClickHouse (time-series, aggregations)
- **RPC:** Cap'n Web (promise pipelining, magic map)
- **Agents:** Unified SDK (Claude, OpenAI, Vercel AI)
- **UI:** [MDXUI](https://mdxui.dev) (Beacon sites, Cockpit apps)
- **Auth:** [org.ai](https://id.org.ai) (federated identity, AI + humans)

---

**Solo founders** — Get a team without hiring one.

**Small teams** — AI does the work, humans decide.

**Growing startups** — Add humans without changing code.

---

[platform.do](https://platform.do) · [agents.do](https://agents.do) · [workers.do](https://workers.do) · [workflows.do](https://workflows.do)

MIT License
