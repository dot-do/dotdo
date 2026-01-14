# [workers.do](https://workers.do)

**The Platform for AI Workers.** Build autonomous businesses with teams of AI agents, human oversight, and business-as-code.

```typescript
import { Startup } from 'workers.do'
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
  }
}
```

---

## What is workers.do?

**workers.do** is the hosted platform for running AI-powered businesses. Think of it as **Heroku for AI agents**:

| Layer | Role | Analogy |
|-------|------|---------|
| **workers.do** | Platform/Product | Heroku, Vercel |
| **dotdo** | Runtime/Framework | Node.js, Deno |

**workers.do provides:**
- Named AI agents with personas (Priya, Ralph, Tom, etc.)
- Teams and organizational structure
- Human workers with approval workflows
- Business-as-Code syntax
- Platform services (llm.do, payments.do, storage.do)
- The "Autonomous Startup" product

**dotdo provides:**
- Durable Object base classes
- Edge-native primitives (fsx, gitx, bashx)
- 40+ API-compatible SDKs
- Cap'n Web RPC
- Storage tiers (SQLite -> R2 -> Iceberg)

---

## Named Agents

AI workers with specific roles and personas:

```typescript
import { priya, ralph, tom, mark, sally, quinn, rae, casey, finn, dana } from 'agents.do'
```

| Agent | Role | Capabilities |
|-------|------|--------------|
| **Priya** | Product | Specs, roadmaps, prioritization |
| **Ralph** | Engineering | Code, architecture, implementation |
| **Tom** | Tech Lead | Review, standards, architecture decisions |
| **Mark** | Marketing | Content, launches, campaigns |
| **Sally** | Sales | Outreach, closing, relationships |
| **Quinn** | QA | Testing, quality, edge cases |
| **Rae** | Frontend | React, components, design systems |
| **Casey** | Customer Success | Onboarding, retention, support |
| **Finn** | Finance | Budgets, forecasting, analysis |
| **Dana** | Data | Analytics, metrics, insights |

### Template Literal Syntax

Agents are invoked with template literals:

```typescript
const spec = await priya`define the MVP for ${hypothesis}`
const code = await ralph`implement ${spec}`
const review = await tom`review ${code}`
const tests = await quinn`test ${code} against ${spec}`
```

### Agent Approvals

Agents can approve or reject work:

```typescript
if (await tom.approve(pullRequest)) {
  await ralph`merge ${pullRequest}`
}
```

---

## Human Workers

Escalate to humans when AI needs oversight:

```typescript
import { ceo, legal, finance } from 'humans.do'

// Await human approval
const approved = await ceo`approve the partnership with ${partner}`

// Define escalation triggers
escalation = this.HumanFunction({
  trigger: 'refund > $10000',
  role: 'senior-accountant',
  sla: '4 hours',
})
```

Humans are notified via Slack, Discord, Email, or the MDXUI Chat interface.

---

## Teams

Organize agents into functional teams:

```typescript
import { engineering, product, sales, marketing } from 'teams.do'

// Team-level coordination
await engineering.standup()
await product.planSprint(backlog)
await sales.pipeline.review()
```

---

## Platform Services

workers.do includes managed services for common needs:

| Service | Purpose |
|---------|---------|
| [llm.do](https://llm.do) | Multi-provider LLM routing |
| [payments.do](https://payments.do) | Stripe-compatible payments |
| [storage.do](https://storage.do) | File storage and CDN |
| [auth.do](https://auth.do) | Identity and access |
| [oauth.do](https://oauth.do) | OAuth provider |
| [email.do](https://email.do) | Transactional email |
| [sms.do](https://sms.do) | SMS messaging |

---

## Business-as-Code

Define your entire business in TypeScript:

```typescript
import { Startup } from 'workers.do'

export class SaaSBusiness extends Startup {
  // Define your hypothesis
  hypothesis = 'Developers need simpler deployment'

  // Configure your team
  team = {
    product: priya,
    engineering: [ralph, rae],
    techLead: tom,
    qa: quinn,
    marketing: mark,
    sales: sally,
  }

  // Define your workflows
  async onCustomerSignup(customer: Customer) {
    await casey`onboard ${customer}`
    await mark`add to nurture sequence`
    await sally`schedule demo if enterprise`
  }

  async onFeatureRequest(request: FeatureRequest) {
    const spec = await priya`evaluate ${request}`
    if (await tom.approve(spec)) {
      await ralph`implement ${spec}`
    }
  }
}
```

---

## Built on dotdo

workers.do is the product layer built on top of [dotdo](https://github.com/dotdo/dotdo), the edge-native runtime for Durable Objects.

```
+------------------------------------------------------------------+
|                         workers.do                                |
|  Named Agents | Teams | Humans | Business-as-Code | Services     |
+------------------------------------------------------------------+
                              |
                              v
+------------------------------------------------------------------+
|                           dotdo                                   |
|  DOBase | fsx | gitx | bashx | Compat SDKs | Cap'n Web RPC       |
+------------------------------------------------------------------+
                              |
                              v
+------------------------------------------------------------------+
|                   Cloudflare Workers + DOs                        |
|  V8 Isolates | SQLite | R2 | 300+ Cities | 0ms Cold Start        |
+------------------------------------------------------------------+
```

### Architecture Relationship

```typescript
// workers.do imports and extends dotdo
import { DOBase } from 'dotdo'

export class Agent extends DOBase { /* AI worker capabilities */ }
export class Human extends DOBase { /* Human approval workflows */ }
export class Startup extends DOBase { /* Business container */ }
```

### When to Use Each

| Use Case | Package |
|----------|---------|
| Build autonomous businesses | `workers.do`, `agents.do` |
| Build custom DO applications | `dotdo` |
| Extend the runtime | `dotdo` |
| Run AI teams | `workers.do` |

---

## Proxy Workers (Infrastructure)

This directory also contains the DO proxy workers that route HTTP requests:

### API() Factory

```typescript
import { API } from 'dotdo'

export default API()  // Hostname-based routing
```

### Routing Modes

| Mode | Pattern | URL | DO |
|------|---------|-----|----|
| Hostname | `undefined` | `tenant.api.workers.do/users` | `tenant` |
| Path | `/:org` | `api.workers.do/acme/users` | `acme` |
| Nested | `/:org/:proj` | `api.workers.do/acme/p1/tasks` | `acme:p1` |
| Fixed | `main` | `api.workers.do/users` | `main` |

---

## Quick Start

```bash
npm install workers.do agents.do

# Create your startup
npx workers.do init my-startup
npx workers.do dev
```

```typescript
import { Startup } from 'workers.do'
import { ralph, tom } from 'agents.do'

export default class extends Startup {
  async build(spec: string) {
    let app = await ralph`build ${spec}`
    while (!await tom.approve(app)) {
      app = await ralph`fix issues from ${tom.feedback}`
    }
    return app
  }
}
```

---

## Related

- [dotdo](https://github.com/dotdo/dotdo) - Runtime/framework layer
- [agents.do](https://agents.do) - Named AI agents
- [teams.do](https://teams.do) - Team coordination
- [humans.do](https://humans.do) - Human escalation
- [platform.do](https://platform.do) - Unified platform

---

MIT License
