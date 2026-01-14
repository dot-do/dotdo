# schema.org.ai Type Hierarchy Design

## Overview

This document defines the DO class inheritance hierarchy and type system for schema.org.ai. The goal is "batteries included" defaults for building businesses (Startups, SaaS, Agencies) while allowing complete customization.

## Architecture Layers

```
                              primitives.org.ai
    ┌─────────┬─────────┬─────────┬─────────┬─────────┬─────────┬─────────┐
    ▼         ▼         ▼         ▼         ▼         ▼         ▼         ▼
@org.ai/  digital-  digital-  tools.    id.org.ai  ai-       ai-       goals.
 types    products  workers   org.ai               database  functions org.ai
    │         │         │         │         │         │         │         │
    └─────────┴─────────┴─────────┴────┬────┴─────────┴─────────┴─────────┘
                                       ▼
                                  @dotdo/core
                                       │
                    ┌──────────────────┼──────────────────┐
                    ▼                  ▼                  ▼
             business-as-code    @saaskit/core    startup-builder
                    │                  │                  │
                    └──────────────────┼──────────────────┘
                                       ▼
                                     dotdo
```

## Package Ownership

| Package | Types | Purpose |
|---------|-------|---------|
| `@org.ai/types` | Thing, Event, Noun, Verb | Base primitives |
| `id.org.ai` | Identity, User, AgentIdentity, Credential, Session | Identity layer |
| `digital-workers` | Worker, Agent, Human, Role, Team, Task | Work performers |
| `digital-products` | App, API, Site, Service, Product, Feature | Digital products |
| `tools.org.ai` | Tool, Integration, Capability | Tools & integrations |
| `ai-database` | DB(), relationship operators | Database DSL |
| `ai-functions` | AI function primitives | AI-powered functions |
| `goals.org.ai` | Goal, Objective, KeyResult | OKR framework |
| `@dotdo/core` | DOCore, WorkflowContext, RPC, DB wrapper | DO runtime |
| `business-as-code` | Business, Company, Org, Employee, Customer, Goals | Business entities |
| `@saaskit/core` | SaaS, Subscription, Plan, MRR, Churn | SaaS-specific |
| `startup-builder` | Startup, ICP, Idea, Hypothesis, LeanCanvas, JTBD | Startup tooling |

## schema.org.ai Type URLs

Every type has a canonical URL:

```
https://schema.org.ai/Thing                    # @org.ai/types
│
├── https://schema.org.ai/Identity             # id.org.ai
│   ├── https://schema.org.ai/User
│   └── https://schema.org.ai/AgentIdentity
│
├── https://schema.org.ai/Worker               # digital-workers
│   ├── https://schema.org.ai/Agent
│   ├── https://schema.org.ai/Human
│   │   └── https://schema.org.ai/Role
│   └── https://schema.org.ai/Team
│
├── https://schema.org.ai/Product              # digital-products
│   ├── https://schema.org.ai/App
│   ├── https://schema.org.ai/API
│   ├── https://schema.org.ai/Site
│   └── https://schema.org.ai/Service
│
├── https://schema.org.ai/Tool                 # tools.org.ai
│   ├── https://schema.org.ai/Integration
│   └── https://schema.org.ai/Capability
│
├── https://schema.org.ai/Organization         # business-as-code
│   ├── https://schema.org.ai/Business
│   │   └── https://schema.org.ai/Company
│   ├── https://schema.org.ai/Org
│   └── https://schema.org.ai/Department
│
├── https://schema.org.ai/BusinessModel        # business-as-code
│   ├── https://schema.org.ai/SaaS
│   ├── https://schema.org.ai/ServicesAsSoftware
│   ├── https://schema.org.ai/IaaS
│   ├── https://schema.org.ai/PaaS
│   └── https://schema.org.ai/Marketplace
│
├── https://schema.org.ai/Goal                 # business-as-code (via goals.org.ai)
│   ├── https://schema.org.ai/Objective
│   └── https://schema.org.ai/KeyResult
│
└── https://schema.org.ai/Startup              # startup-builder
    ├── https://schema.org.ai/ICP
    ├── https://schema.org.ai/Idea
    ├── https://schema.org.ai/Hypothesis
    ├── https://schema.org.ai/JTBD
    ├── https://schema.org.ai/LeanCanvas
    ├── https://schema.org.ai/StoryBrand
    └── https://schema.org.ai/Founder
```

## Key Design Decisions

### 1. Identity vs Relationship

**Identity** (id.org.ai) = Who you ARE
- User, AgentIdentity

**Relationship** (business-as-code) = What you ARE TO something
- Employee, Contractor, Customer, Partner

Same User can have multiple relationships:
```typescript
user.as(Employee).of(companyA)
user.as(Customer).of(companyB)
user.as(Contractor).of(companyC)
```

### 2. Startup is NOT a Business Model

Startup is independent of business model. It has:
- ICP (who you serve)
- Idea (what you're building)
- BusinessModel (how you make money) - composed, not inherited

```typescript
const startup = Startup({
  icp: ICP({ as: 'Developers', at: 'Startups', are: 'building APIs' }),
  idea: Idea({ concept: 'API Platform' }),
  businessModel: SaaS(),  // or Marketplace(), or ServicesAsSoftware()
})
```

### 3. OKRs are Ground Truth

Goals with Objectives and KeyResults are grounded in real analytics:

```typescript
Goals {
  objective: "Achieve product-market fit"
  keyResults: [
    { metric: "MRR", target: 50000, current: 32000, source: "stripe.mrr" },
    { metric: "NPS", target: 50, current: 42, source: "surveys.nps" }
  ]
}
```

Entities with Goals: Business, Startup, Agent, Role

### 4. Workers Compose Goals

digital-workers is a pure primitive. Goals are composed when deployed in business context:

```typescript
// Agent without business context
const agent = Agent({ skills: ['code-review'] })

// Agent with Goals (business context)
business.deploy(agent, {
  goals: [{ objective: 'Review PRs', keyResults: [...] }]
})
```

### 5. Code-Mode for Tools

Agents use tools via code-mode with the `do` MCP tool:

```typescript
await do(`
  const customer = await stripe.customers.create({ email })
  await db.Customer.create({ stripeId: customer.id, email })
  await slack.notify('#sales', \`New customer: \${email}\`)
`)
```

Dynamic tool composition through code, not predefined workflows.

## DO Runtime Layers

```
DOCore (@dotdo/core)
│   └─ Base runtime (db, ns, storage, with(schema))
│
DOTiny (~15KB)
│   └─ + Type hierarchy, user context, identity
│
DOBase (~80KB)
│   └─ + WorkflowContext ($), stores, events, scheduling
│
DOFull (~120KB)
    └─ + Lifecycle, sharding, branching, promotion
```

## ICP Framework (as/at/are/using/to)

The Ideal Customer Profile framework:

| Field | Question | Example |
|-------|----------|---------|
| `as` | Who are they? | "Developers" |
| `at` | Where do they work? | "FinTech startups" |
| `are` | What are they doing? | "building APIs" |
| `using` | What tools do they use? | "Node.js" |
| `to` | What's their goal? | "ship faster" |

Semantic frame: `[as] at [at] are [are] using [using] to [to]`

Grounded against standards:
- `as` → O*NET occupations
- `at` → NAICS industries

## Next Steps

1. Implement primitives in ai/primitives repo
2. Create business-as-code package
3. Update @saaskit/core with SaaS types
4. Update startup-builder with Startup types
5. Wire everything into dotdo
