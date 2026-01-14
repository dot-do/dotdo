# Architecture: dotdo vs workers.do

This document clarifies the distinction between **dotdo** (this repository) and **workers.do**, explaining how they relate and where each fits in the ecosystem.

## Summary

| | **dotdo** | **workers.do** |
|---|---|---|
| **Role** | Runtime/Framework | Platform/Product |
| **Analogy** | Node.js | Heroku |
| **Users** | Infrastructure developers | Founders, teams, businesses |
| **Package** | `dotdo` | `agents.do`, `teams.do`, `humans.do` |
| **Focus** | Low-level primitives | High-level abstractions |
| **Tagline** | Edge-native runtime for Durable Objects | Build your 1-Person Unicorn |

## The Two-Layer Model

```
                          PLATFORM ECOSYSTEM
                          ==================

┌─────────────────────────────────────────────────────────────────────┐
│                     PRODUCT LAYER (workers.do)                       │
│                                                                      │
│   ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌─────────────┐      │
│   │ agents.do │  │ teams.do  │  │ humans.do │  │ workflows.do│      │
│   │           │  │           │  │           │  │             │      │
│   │ Named AI  │  │ Team      │  │ Human-in- │  │ Visual      │      │
│   │ Agents    │  │ Roles     │  │ the-Loop  │  │ Workflow    │      │
│   │ (Priya,   │  │ (eng,     │  │ Approvals │  │ Builder     │      │
│   │ Ralph,    │  │ product,  │  │           │  │             │      │
│   │ Tom...)   │  │ sales)    │  │           │  │             │      │
│   └─────┬─────┘  └─────┬─────┘  └─────┬─────┘  └──────┬──────┘      │
│         │              │              │               │             │
│         └──────────────┴──────────────┴───────────────┘             │
│                                │                                     │
│              Business-as-Code Syntax                                 │
│         priya`define the MVP` / ralph`build ${spec}`                 │
│                                                                      │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 │ imports from
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      RUNTIME LAYER (dotdo)                           │
│                                                                      │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │                 Durable Object Classes                       │   │
│   │  DO │ DOBase │ DOTiny │ Entity │ Collection │ Worker │ Agent │   │
│   └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │                 Extended Primitives                          │   │
│   │  fsx (filesystem) │ gitx (git) │ bashx (shell) │ npmx │ pyx  │   │
│   └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │                 Infrastructure Primitives                    │   │
│   │  rate-limiter │ circuit-breaker │ cache-manager │ task-queue │   │
│   │  secret-store │ token-manager │ permission-engine │ 40+ more │   │
│   └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │                 Compat SDKs (40+ APIs)                       │   │
│   │  @dotdo/postgres │ @dotdo/redis │ @dotdo/kafka │ @dotdo/mongo│   │
│   │  @dotdo/stripe │ @dotdo/supabase │ @dotdo/openai │ ...       │   │
│   └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │                 Core Infrastructure                          │   │
│   │  Cap'n Web RPC │ $ Context │ Stores │ SQLite/Drizzle │       │   │
│   │  Event System │ Scheduling │ Sharding │ Replication          │   │
│   └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
└─────────────────────────────────┬───────────────────────────────────┘
                                  │
                                  │ runs on
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     CLOUDFLARE PLATFORM                              │
│   V8 Isolates │ Durable Objects │ R2 │ KV │ Pipelines │ 300+ Cities │
└─────────────────────────────────────────────────────────────────────┘
```

## What dotdo Provides

dotdo is the **runtime layer**—the infrastructure foundation that applications build upon.

### Durable Object Base Classes

```typescript
import { DO, DOBase, Entity, Collection, Worker, Agent } from 'dotdo'

// Base classes for building any DO-backed system
export class MyService extends DOBase {
  // REST router, SQLite, persistence, RPC
}
```

### Extended Primitives

Edge-native implementations of capabilities V8 isolates lack:

| Primitive | Description |
|-----------|-------------|
| **fsx** | POSIX filesystem on SQLite |
| **gitx** | Git on R2 object storage |
| **bashx** | Shell execution without VMs |
| **npmx** | Package management |
| **pyx** | Python via Pyodide |

### Infrastructure Primitives (44 total)

Building blocks for distributed systems:

- Circuit Breaker - Fault tolerance
- Rate Limiter - Request throttling
- Cache Manager - Multi-tier caching
- Task Queue - Background job processing
- Secret Store - Encrypted secrets
- Token Manager - JWT/OAuth tokens
- Permission Engine - RBAC/ABAC access control
- And 37 more...

### Compat SDKs (40+ APIs)

Drop-in replacements backed by Durable Objects:

```typescript
import { createClient } from '@dotdo/supabase'
import { Kafka } from '@dotdo/kafka'
import { Redis } from '@dotdo/redis'

// Same API, but running on edge with automatic sharding
```

### Core Infrastructure

- **Cap'n Web RPC** - Promise pipelining (one round trip for entire pipelines)
- **$ Context** - Workflow execution ($.do, $.try, $.send)
- **Event System** - $.on.Noun.verb event handlers
- **Scheduling** - $.every.day.at9am DSL
- **Stores** - things, rels, actions, events, search
- **Tiered Storage** - SQLite -> R2/Iceberg -> ClickHouse

## What workers.do Provides

workers.do is the **product layer**—the user-facing experience for building autonomous businesses.

### Named AI Agents

Pre-configured agents with personas:

```typescript
import { priya, ralph, tom, mark, sally, quinn } from 'agents.do'

const spec = await priya`define the MVP for ${hypothesis}`
let app = await ralph`build ${spec}`

do {
  app = await ralph`improve ${app} per ${tom}`
} while (!await tom.approve(app))

mark`announce the launch`
sally`start selling`
```

| Agent | Role | Expertise |
|-------|------|-----------|
| **Priya** | Product | Specs, roadmaps, user stories |
| **Ralph** | Engineering | Code, architecture, implementation |
| **Tom** | Tech Lead | Reviews, standards, decisions |
| **Mark** | Marketing | Content, launches, positioning |
| **Sally** | Sales | Outreach, closing, relationships |
| **Quinn** | QA | Testing, quality, validation |

### Teams and Roles

```typescript
import { engineering, product, sales, marketing } from 'teams.do'

// Teams are collections of workers with shared context
const review = await engineering.review(pullRequest)
const campaign = await marketing.launch(product)
```

### Human Workers

Human-in-the-loop with SLA-based escalation:

```typescript
import { legal, ceo, seniorAccountant } from 'humans.do'

// Human escalation with SLA
const approved = await ceo`approve the partnership`

// Conditional escalation
if (refund.amount > 10000) {
  await seniorAccountant`approve ${refund}` // SLA: 4 hours
}
```

### Business-as-Code Syntax

```typescript
import { Startup } from 'workers.do'

export class MyStartup extends Startup {
  async launch() {
    const spec = priya`define the MVP`
    const app = ralph`build ${spec}`
    await tom.approve(app)
    mark`announce the launch`
    sally`start selling`
  }
}
```

### Platform Services

Hosted services that run on dotdo:

- **llm.do** - Multi-provider LLM gateway
- **payments.do** - Payment processing
- **auth.do** - Authentication
- **storage.do** - File storage
- **search.do** - Full-text search

## Dependency Direction

The dependency flows **one way**: workers.do imports dotdo, never the reverse.

```
workers.do
    │
    ├── agents.do     ─┐
    ├── teams.do       │
    ├── humans.do      ├──► all import from dotdo
    ├── workflows.do   │
    └── ...           ─┘
            │
            ▼
         dotdo
            │
            ▼
    Cloudflare Platform
```

## Where Code Belongs

Use this decision tree:

```
Is this code...
├─ A DO base class or primitive?
│   └─ dotdo (objects/, primitives/, lib/)
├─ An API compatibility layer?
│   └─ dotdo (compat/, packages/)
├─ A named agent with persona?
│   └─ workers.do (agents/)
├─ A team or role abstraction?
│   └─ workers.do (teams/)
├─ Human workflow/escalation?
│   └─ workers.do (humans/)
├─ Business-as-Code syntax?
│   └─ workers.do
└─ Platform service (llm.do, etc)?
    └─ workers.do (services/)
```

### Examples

| Code | Location | Reason |
|------|----------|--------|
| `class DO extends DurableObject` | dotdo | Core runtime primitive |
| `class Agent extends Worker` | dotdo | Base class for agents |
| `const ralph = createNamedAgent(...)` | workers.do | Product-level persona |
| `@dotdo/redis` | dotdo | Compat SDK |
| `class Startup extends DO` | workers.do | Business-as-Code abstraction |
| `$.on.Customer.created()` | dotdo | Event system primitive |
| `priya\`define the MVP\`` | workers.do | Product syntax |

## Abstract Interfaces

The **base classes** and **interfaces** stay in dotdo. workers.do extends them:

```typescript
// dotdo exports the base
export { Agent, type AgentConfig } from 'dotdo/objects'

// workers.do extends it
import { Agent } from 'dotdo/objects'

class Priya extends Agent {
  persona = PERSONAS.priya
  // Product-specific implementation
}
```

## Related Documentation

- [docs/architecture/dotdo-vs-workers-do.mdx](/docs/architecture/dotdo-vs-workers-do.mdx) - Comprehensive MDX documentation
- [docs/architecture/do-hierarchy.mdx](/docs/architecture/do-hierarchy.mdx) - DO class hierarchy
- [docs/architecture/dobase-decomposition.md](/docs/architecture/dobase-decomposition.md) - DOBase architecture details
