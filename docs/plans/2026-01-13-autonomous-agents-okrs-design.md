# Autonomous Agents with OKRs Design

> Agents with goals tied to real business metrics, responding to ambient events.

## Overview

This design extends the dotdo platform with:
1. **DO Subclass Hierarchy** - Business-type-specific defaults
2. **Named Agent Roster** - Agents with real .do domains
3. **OKRs Framework** - Goals tied to actual metrics
4. **Support Integration** - ChatBox → Agent → Human escalation
5. **Pricing Models** - AI-native monetization

All APIs follow the template literal elegance pattern:

```typescript
await priya`how are we doing on product adoption?`
await is`${customer} is at risk of churning`
await ai`current metrics for ${this.startup}`
```

## DO Subclass Hierarchy

```
DO (base)
├── Business
│   ├── DigitalBusiness
│   │   ├── SaaS          → MRR, Churn, NRR, CAC, LTV
│   │   ├── Marketplace   → GMV, Take Rate, Liquidity
│   │   ├── API           → API Calls, Latency, Error Rate
│   │   └── Directory     → Listings, Search Volume, Clicks
│   ├── LocalBusiness     → Foot Traffic, Reviews, Bookings
│   └── Service           → AI-delivered services (formerly human)
│       ├── Agency        → Marketing, design, content
│       ├── Consulting    → Strategy, analysis, advice
│       ├── Support       → Customer service, helpdesk
│       └── Operations    → Bookkeeping, HR, legal ops
├── Startup               → Runway, Burn, Growth Rate, PMF Score
└── (user subclasses)
```

### Base DO

The base `DO` class provides the Goals/OKRs framework and analytics awareness but no pre-built metrics:

```typescript
import { DO } from 'dotdo'

class MyApp extends DO {
  // Framework available, no defaults
}
```

### Business Subclasses

Each subclass comes with relevant OKRs and default agents:

| Subclass | Default OKRs | Default Agents |
|----------|--------------|----------------|
| **Business** | Revenue, Costs, Profit | finn |
| **DigitalBusiness** | + Traffic, Conversion, Engagement | + dana |
| **SaaS** | + MRR, Churn, NRR, CAC, LTV | + sam, casey |
| **Startup** | + Runway, Burn, Growth, PMF | + priya, ralph |
| **Marketplace** | + GMV, TakeRate, Liquidity | + both-sides support |
| **API** | + APICalls, Latency, ErrorRate | + developer relations |
| **Service** | + TasksCompleted, QualityScore, EscalationRate | + service delivery |

### Service Subclass

Service is for **AI-delivered Services-as-Software** - what humans used to do, now delivered by agents with optional human escalation:

```typescript
import { Service } from 'dotdo'

class MyAgency extends Service {
  // AI agents deliver the service
  // Humans escalate when needed
}
```

Service-specific OKRs:
- `TasksCompleted` - Work items delivered
- `QualityScore` - Output quality (human or AI-rated)
- `ResponseTime` - Time to first action
- `DeliveryTime` - Time to completion
- `CustomerSatisfaction` - Service CSAT
- `HumanEscalationRate` - % requiring human intervention
- `CostPerTask` - Efficiency metric
- `CapacityUtilization` - Agent workload

### Composition

Users can subclass, mixin, or customize:

```typescript
// Use as-is
class MyApp extends SaaS {}

// Mixin additional capabilities
class MyApp extends SaaS.with(Marketplace) {}

// Override/extend OKRs
class MyApp extends SaaS {
  okrs = {
    ...super.okrs,
    CustomMetric: this.defineOKR({...})
  }
}
```

## Named Agent Roster

Using actual .do domains owned:

### Core Team

| Domain | Agent | Role | Primary OKRs |
|--------|-------|------|--------------|
| priya.do | Priya | Product | Feature adoption, user satisfaction |
| ralph.do | Ralph | Engineering | Build velocity, code quality |
| tom.do | Tom | Tech Lead | Architecture health, review throughput |
| mark.do | Mark | Marketing | Awareness, content engagement |
| sally.do | Sally | Sales | Pipeline, conversion, revenue |
| quinn.do | Quinn | QA | Test coverage, defect escape rate |

### Extended Team

| Domain | Agent | Role | Primary OKRs |
|--------|-------|------|--------------|
| sam.do | Sam | Support | Response time, resolution rate, CSAT |
| finn.do | Finn | Finance | Burn rate, runway, unit economics |
| casey.do | Casey | Customer Success | Retention, NPS, expansion revenue |
| dana.do | Dana | Data/Analytics | Dashboard accuracy, insight delivery |

### C-Suite (Executive Escalation)

| Domain | Role | When Triggered |
|--------|------|----------------|
| ceo.do | CEO | Major pivots, partnerships, fundraising |
| cfo.do | CFO | Budget approvals, financial strategy |
| cmo.do | CMO | Brand decisions, major campaigns |
| cpo.do | CPO | Roadmap priorities, major features |
| cro.do | CRO | Revenue strategy, pricing changes |
| cto.do | CTO | Architecture decisions, tech stack |

### Infrastructure Domains

- **goals.do** - Goals API endpoint
- **okrs.do** - OKR framework
- **kpis.do** - Metrics definitions
- **analytics.do** - Analytics aggregation

## OKRs Framework

### Design Principles

1. **Strong types** - Schema-defined structure
2. **Natural language** - AI translates config
3. **Ambient awareness** - Agents respond to metric changes

### Schema-Based Definition

```typescript
import { AI } from 'ai-functions'

const AI = AI({
  okr: {
    objective: 'What we want to achieve',
    keyResults: [{
      metric: 'What we measure (PascalCase)',
      target: 'Target value (number)',
      current: 'Current value (number)',
      measurement: 'How to measure (function reference)',
    }],
  },
})

// Natural language → strongly typed
const goals = await AI.okr`growth goals for Q1`
```

### Pre-Built OKRs (~20)

#### Product (Priya)
1. `FeatureAdoption` - % users using new features
2. `UserSatisfaction` - NPS/CSAT scores
3. `TimeToValue` - Onboarding completion time

#### Engineering (Ralph/Tom)
4. `BuildVelocity` - Story points/sprint
5. `CodeQuality` - Test coverage, lint scores
6. `SystemReliability` - Uptime, error rates

#### Growth (Mark)
7. `BrandAwareness` - Traffic, social reach
8. `ContentEngagement` - Views, shares, time on page
9. `LeadGeneration` - MQLs generated

#### Sales (Sally)
10. `PipelineHealth` - Qualified opportunities
11. `ConversionRate` - Demo → Close %
12. `RevenueGrowth` - MRR/ARR targets

#### Support (Sam)
13. `ResponseTime` - First response SLA
14. `ResolutionRate` - % resolved without escalation
15. `CustomerSatisfaction` - Support CSAT

#### Customer Success (Casey)
16. `NetRetention` - NRR %
17. `ExpansionRevenue` - Upsell/cross-sell
18. `ChurnPrevention` - At-risk accounts saved

#### Finance (Finn)
19. `BurnEfficiency` - Burn multiple
20. `UnitEconomics` - LTV:CAC ratio

### Analytics Integration

Base DO has knowledge of all analytics:

```typescript
// Namespace-based access
$.analytics.web      // Traffic, sessions, bounce rate
$.analytics.product  // DAU, MAU, feature usage
$.analytics.financial // Revenue, costs, margins

// Or ask agents
await finn`what's our runway?`
await dana`which features have low adoption?`
await casey`which customers are at risk?`
```

## Agent Collaboration

### Event-Driven (Default)

Agents respond to ambient events - loose coupling:

```typescript
// Agents subscribe to events
$.on.Deal.closed(async (deal) => {
  sam.onboard(deal.customer)
})

$.on.Customer.churning(async (customer) => {
  casey.intervene(customer)
})

$.on.Metric.alert(async (metric) => {
  // Relevant agent notified based on metric type
})
```

### Direct RPC (When Needed)

Explicit handoffs for specific workflows:

```typescript
await sally.handoff(sam, deal)
await sam.escalate(support, ticket)
```

### Orchestrator (Complex Workflows)

Central coordination for multi-step processes:

```typescript
$.workflow('enterprise-onboarding')
  .step(sally.closesDeal)
  .step(finn.invoices)
  .step(sam.onboards)
  .step(casey.schedules)
```

## Support Integration

### ChatBox → Agent → Human

MDXUI ChatBox integration with agent-first support:

```typescript
import { sam } from 'agents.do'

// Sam handles all support by default
// Topic routing via natural language
sam`handle billing questions`
finn`handle financial questions`
sally`handle sales questions`
```

### Automatic Escalation

AI determines when human intervention needed:

```typescript
// AI-powered escalation detection
const escalate = await is`${conversation} needs human intervention`

// Triggers (evaluated by AI):
// - Negative sentiment
// - Repeated questions (loops)
// - Explicit request ("talk to human")
// - High-value customer
// - Complex/sensitive topics
```

### Human Pool

```typescript
import { support } from 'humans.do'

// Same template literal syntax
support`help this frustrated customer`

// With SLA
support`urgent billing dispute`.timeout('1 hour')
```

### Default Support Agent

Sam is the default named support agent:

```typescript
import { sam } from 'agents.do'

// Handles all incoming support
// Routes to specialists when needed
// Escalates to humans automatically
```

## Pricing Models

Based on paid.ai research, Service supports all five models:

### 1. Outcome-Based

Pay per result delivered:

```typescript
pricing = {
  TicketResolved: 0.99,
  LeadQualified: 5.00,
  ContentDelivered: 25.00,
}
```

### 2. Activity-Based

Pay per action taken:

```typescript
pricing = {
  EmailDrafted: 0.10,
  CallScheduled: 1.00,
  ReportGenerated: 5.00,
}
```

### 3. Seat-Based (Concurrency)

Pay for parallel capacity - applies to both AI agents and humans:

```typescript
seats = {
  agents: { count: 5, price: 500 },   // 5 parallel AI agents
  humans: { count: 2, price: 2000 },  // 2 human escalation slots
}

// Jobs queue if capacity exceeded
overflow: 'queue' | 'reject' | 'burst-pricing'
```

### 4. Credit-Based

Prepaid consumption:

```typescript
credits = {
  price: 99,        // $99 for 100 credits
  amount: 100,
  expiration: '1 year',
  topUp: 'automatic',
}
```

### 5. Hybrid

Combine multiple models:

```typescript
pricing = {
  base: { monthly: 500 },           // Base subscription
  outcomes: { TicketResolved: 0.50 }, // Plus outcomes
  overage: { rate: 0.75 },          // After threshold
  bonus: { metric: 'CSAT', threshold: 0.95, amount: 100 },
}
```

### Natural Language Config

AI translates natural language to typed pricing config:

```typescript
// Natural language
pricing = await ai`$0.99 per resolved ticket, $5 per qualified lead`

// AI returns strongly typed
// { outcomes: { TicketResolved: 0.99, LeadQualified: 5.00 } }
```

## API Summary

### Template Literal Elegance

```typescript
// Agents
await priya`plan the roadmap`
await ralph`build the feature`
await sam`handle support`

// Humans
await ceo`approve the partnership`
await support`help this customer`

// Metrics
await is`${customer} is at risk`
await ai`current metrics for ${startup}`

// Goals
await priya`how are we doing on adoption?`
await finn`what's our runway?`
```

### Strong Types via Schema

```typescript
const AI = AI({
  okr: { objective: 'string', keyResults: [...] },
  pricing: { outcomes: {...}, seats: {...} },
  routing: { agent: 'string', escalate: 'boolean' },
})

// Natural language in, typed output
const goals = await AI.okr`Q1 growth goals`
const config = await AI.pricing`SaaS pricing model`
```

### Event-Driven Ambient Awareness

```typescript
$.on.Customer.signup(handler)
$.on.Deal.closed(handler)
$.on.Metric.alert(handler)
$.on.*.created(handler)  // Wildcards
```

## Implementation Notes

### Folder Structure

```
objects/               # DO subclasses (business types)
├── DO.ts              # Base DO with Goals/OKRs framework
├── Business.ts        # Revenue, Costs, Profit
├── DigitalBusiness.ts # + Traffic, Conversion, Engagement
├── SaaS.ts            # + MRR, Churn, NRR, CAC, LTV
├── Startup.ts         # + Runway, Burn, Growth, PMF
├── Service.ts         # AI-delivered services
├── Marketplace.ts     # + GMV, TakeRate, Liquidity
├── API.ts             # + APICalls, Latency, ErrorRate
├── Directory.ts       # + Listings, Search Volume, Clicks
├── LocalBusiness.ts   # + Foot Traffic, Reviews, Bookings
└── index.ts           # Re-exports all DO subclasses

roles/                 # Pre-built agent roles (job functions)
├── product.ts         # Product role: OKRs, capabilities
├── engineering.ts     # Engineering role
├── techLead.ts        # Tech Lead role
├── marketing.ts       # Marketing role
├── sales.ts           # Sales role
├── qa.ts              # QA role
├── support.ts         # Support role
├── finance.ts         # Finance role
├── customerSuccess.ts # Customer Success role
├── data.ts            # Data/Analytics role
├── types.ts           # Role type definitions
└── index.ts           # Re-exports all roles

agents/                # Pre-built named agents (implement roles)
├── priya.ts           # implements: product
├── ralph.ts           # implements: engineering
├── tom.ts             # implements: techLead
├── rae.ts             # implements: frontend (existing)
├── mark.ts            # implements: marketing
├── sally.ts           # implements: sales
├── quinn.ts           # implements: qa
├── sam.ts             # implements: support
├── finn.ts            # implements: finance
├── casey.ts           # implements: customerSuccess
├── dana.ts            # implements: data
├── types.ts           # Agent type definitions
└── index.ts           # Re-exports all agents
```

### Role → Agent Relationship

```typescript
// roles/product.ts
export const product = defineRole({
  name: 'product',
  okrs: ['FeatureAdoption', 'UserSatisfaction', 'TimeToValue'],
  capabilities: ['spec', 'roadmap', 'prioritize', 'plan'],
})

// agents/priya.ts
import { product } from '../roles'

export const priya = defineAgent({
  name: 'Priya',
  domain: 'priya.do',
  role: product,
  persona: { voice: '...', style: '...', avatar: '...' },
})

// Usage - either works
await priya`plan the roadmap`           // Named agent
await product`plan the roadmap`         // Role (uses default agent)
```

### OKRs Framework

```
lib/okrs/              # OKRs framework
├── types.ts           # OKR, KeyResult, Metric types
├── define.ts          # defineOKR(), defineMetric()
├── prebuilt.ts        # ~20 pre-built OKRs
├── measurement.ts     # Metric measurement functions
└── index.ts           # Re-exports

lib/pricing/           # Pricing models
├── types.ts           # Pricing model types
├── outcome.ts         # Outcome-based pricing
├── activity.ts        # Activity-based pricing
├── seat.ts            # Seat/concurrency pricing
├── credit.ts          # Credit-based pricing
├── hybrid.ts          # Hybrid pricing
└── index.ts           # Re-exports

lib/support/           # Support integration
├── types.ts           # Support types
├── chatbox.ts         # MDXUI ChatBox integration
├── routing.ts         # Topic-based routing
├── escalation.ts      # Human escalation logic
└── index.ts           # Re-exports
```

### Dependencies

- `ai-functions` - Natural language → typed output
- `@mdxui/chatbox` - Support widget
- `paid.ai` - Billing infrastructure (optional)

## Open Questions

1. Should C-suite agents be autonomous or human-only escalation points?
2. How should cross-business agent sharing work? (Agency serves multiple clients)
3. Should there be a marketplace for pre-built agent configurations?
