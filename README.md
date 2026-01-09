# [.do](https://platform.do)

**Build your 1-Person Unicorn.**

```typescript
import { Startup } from 'dotdo'
import { priya, ralph, tom, mark, sally } from 'agents.do'

export class MyStartup extends Startup {
  async launch() {
    const spec = await priya`define the MVP for ${this.hypothesis}`
    const app = await ralph`build ${spec}`
    const reviewed = await tom`ship ${app}`

    await mark`announce the launch`
    await sally`start selling`

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
const spec = await priya`define the MVP`
const app = await ralph`build ${spec}`
```

You're not making two network round trips. The promise from `priya` is passed directly to `ralph`—the server receives the entire pipeline and executes it in one pass. This is **Promise Pipelining**.

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

await priya`what should we build next?`
await ralph`implement the user dashboard`
await tom`review the pull request`
await mark`write a blog post about our launch`
await quinn`test ${feature} thoroughly`
```

No method names. No parameters. Just say what you want.

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

## Extended Primitives

Cloudflare Workers don't have a filesystem, Git, or shell. We reimplemented them from scratch:

### fsx: Filesystem on SQLite

```typescript
await $.fs.write('data/report.json', data)
await $.fs.read('content/index.mdx')
await $.fs.glob('**/*.ts')
await $.fs.mkdir('uploads', { recursive: true })
```

Full POSIX semantics. Tiered storage (hot SQLite → warm R2 → cold archive). Works in V8 isolates.

### gitx: Git on fsx

```typescript
await $.git.clone('https://github.com/org/repo')
await $.git.checkout('feature-branch')
await $.git.commit('feat: add new feature')
await $.git.push('origin', 'main')
```

Complete Git implementation. Object storage in R2. Diffs, merges, history. Your agents can version control.

### bashx: Shell Without VMs

```typescript
const result = await $.bash`npm install && npm run build`
await $.bash`ffmpeg -i input.mp4 -c:v libx264 output.mp4`
await $.bash`python analyze.py --input ${data}`
```

Shell execution on Workers. No VMs, no cold starts. Sandboxed per-request. Your agents can run builds.

These aren't wrappers—they're complete reimplementations that run natively on edge, enabling millions of parallel AI agents to have full system capabilities.

---

## Humans When It Matters

AI does the work. Humans make the decisions.

```typescript
import { legal, ceo } from 'humans.do'

// Same syntax as agents
const contract = await legal`review this agreement`
const approved = await ceo`approve the partnership`

// Or explicit escalation
escalation = this.HumanFunction({
  trigger: 'refund > $10000 OR audit_risk > 0.8',
  role: 'senior-accountant',
  sla: '4 hours',
})
```

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
$.on.Customer.signup(async (customer) => {
  await agents.onboarding.welcome(customer)
  await agents.support.scheduleCheckin(customer, '24h')
})

$.on.Return.completed(async (return_) => {
  const review = await agents.qa.review(return_)
  if (review.confidence > 0.95) {
    await agents.filing.submit(return_)
  } else {
    await humans.cpa.review(return_)
  }
})

$.every.month.on(1).at('9am')(async () => {
  await agents.billing.processSubscriptions()
  await agents.reporting.generateMRR()
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
