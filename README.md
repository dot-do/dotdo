# dotdo

> A batteries-included framework for vibe coders to do a Foundation Sprint and build an Experimentation Machine where the result is a Profitable Autonomous Business.

## The Idea

Infrastructure-as-Code unlocked SaaS. **Business-as-Code** unlocks something bigger: AI-delivered Services-as-Software and profitable autonomous businesses managed entirely by AI agents.

```typescript
import { Startup } from 'dotdo'

export class AcmeTax extends Startup {
  // The service your business delivers
  service = this.Service('tax-preparation', {
    inputs: ['w2', 'receipts', 'prior_returns'],
    outputs: ['completed_return', 'filing_confirmation'],
    sla: '48 hours',
  })

  // AI agents that operate your business
  agents = [
    this.Agent('tax-preparer', {
      tools: [this.analyzeDocs, this.calculateTax, this.fileReturn],
    }),
    this.Agent('support', {
      tools: [this.answerQuestions, this.scheduleCall],
    }),
  ]

  // Humans only escalate for sensitive decisions
  escalation = this.HumanFunction({
    trigger: 'refund > $10000 OR audit_risk > 0.8',
    role: 'senior-accountant',
    sla: '4 hours',
  })
}
```

That's not just an app. That's a business.

## The Journey

Building with dotdo follows three phases:

### 1. Foundation Sprint

Before you build, get clarity. Define your customer, problem, and differentiation. Formulate your Founding Hypothesis.

```typescript
const hypothesis = await $.foundation({
  customer: 'Freelance developers who hate tax season',
  problem: 'Spending 20+ hours on taxes instead of shipping code',
  differentiation: 'AI does 95% of the work, human CPA reviews edge cases',
})

// Output: "If we help freelance developers automate tax preparation
// with AI-powered analysis and human CPA oversight, they will pay
// $299/year because it saves them 20+ hours of frustration."
```

### 2. Experimentation Machine

Test your hypothesis. Run experiments. Measure what matters.

```typescript
// Built-in HUNCH metrics for product-market fit
const pmf = await $.measure({
  hairOnFire: metrics.urgency,        // Is this a must-have?
  usage: metrics.weeklyActive,         // Are they using it?
  nps: metrics.netPromoterScore,       // Would they recommend?
  churn: metrics.monthlyChurn,         // Are they staying?
  ltv_cac: metrics.lifetimeValue / metrics.acquisitionCost,
})

// Run A/B experiments on value prop, pricing, messaging
await $.experiment('pricing-test', {
  variants: ['$199/year', '$299/year', '$29/month'],
  metric: 'conversion_rate',
  confidence: 0.95,
})
```

### 3. Autonomous Business

When you find PMF, scale with AI agents. They operate the business. You set policy.

```typescript
// Agents handle the day-to-day
$.on.Customer.signup(async (customer) => {
  await agents.onboarding.welcome(customer)
  await agents.support.scheduleCheckin(customer, '24h')
})

$.on.Return.completed(async (return_) => {
  const review = await agents.qa.review(return_)
  if (review.confidence > 0.95) {
    await agents.filing.submit(return_)
  } else {
    await humans.cpa.review(return_) // HumanFunction escalation
  }
})

// Revenue flows, profit compounds
$.every.month.on(1).at('9am')(async () => {
  await agents.billing.processSubscriptions()
  await agents.reporting.generateMRR()
})
```

## What You Get

dotdo is batteries-included. Everything you need, nothing you don't.

### Domain Classes

Build with primitives that match how businesses actually work:

```
DO (Base)
├── Startup ─────────► Your business container
│   ├── Product      ► Physical or digital products
│   ├── Service      ► AI-delivered services
│   ├── SaaS         ► Subscription software
│   ├── Marketplace  ► Multi-sided platforms
│   └── Directory    ► Listings and discovery
│
├── Worker ──────────► Who does the work
│   ├── Agent        ► AI workers with tools
│   └── Human        ► People for escalation
│
├── App ─────────────► User-facing applications
├── Site ────────────► Marketing, docs, blog
├── API ─────────────► Programmatic access
└── Workflow ────────► Multi-step processes
```

### The $ Context

Every DO has a workflow context that handles execution, events, and scheduling:

```typescript
// Execution modes
$.send(event)              // Fire-and-forget
$.try(action)              // Quick attempt, non-durable
$.do(action)               // Durable with retries

// Event handlers
$.on.Customer.created(handler)
$.on.Payment.failed(handler)

// Scheduling
$.every.monday.at('9am')(handler)
$.every.hour(handler)

// Cross-DO resolution
await $.Customer(id).notify()
await $.Order(id).fulfill()
```

### Surfaces (UI)

Your business needs interfaces. Sites for customers, apps for operators:

```typescript
// Marketing site
<Site type="marketing" theme="stripe">
  <Hero title="AI-Powered Tax Prep" cta="Get Started" />
  <Features items={features} />
  <Pricing plans={plans} />
</Site>

// Customer portal
<App type="dashboard">
  <Returns collection="returns" />
  <Documents collection="documents" />
  <Support agent={agents.support} />
</App>

// Admin dashboard
<App type="admin">
  <Metrics hunch={pmfMetrics} />
  <Queue agent={agents.qa} />
  <Escalations humans={humans} />
</App>
```

### Platform Services

Everything else you need, built in:

- **Auth** - Users, orgs, API keys, federated identity
- **Billing** - Subscriptions, usage-based, invoicing
- **Analytics** - HUNCH metrics, funnels, cohorts
- **Observability** - Traces, logs, alerts
- **Real-time** - WebSocket sync, presence
- **Search** - Full-text, vector, semantic

## Quick Start

```bash
# Install
npm install dotdo

# Create your startup
npx dotdo init my-startup

# Start building
npx dotdo dev
```

```typescript
// my-startup/index.ts
import { Startup } from 'dotdo'

export class MyStartup extends Startup {
  // Define your hypothesis
  hypothesis = {
    customer: 'Who you serve',
    problem: 'What pain you solve',
    solution: 'How you solve it',
  }

  // Build from here
}
```

## Philosophy

### For Vibe Coders

dotdo is built for the way you actually work. Describe what you want, iterate fast, ship. The platform handles the complexity—you focus on the business.

### TDD Under the Hood

Vibe on top, rigor underneath. The framework enforces deterministic verification so your autonomous business actually works. Prototype fast, graduate to production.

### Business-as-Code

Just as IaC made infrastructure programmable, BaC makes businesses programmable. Define your business in code, deploy it, let AI agents run it.

## Learn More

- [Architecture](./docs/architecture.md) - How it all fits together
- [Foundation Sprint](./docs/foundation-sprint.md) - Finding what to build
- [Experimentation](./docs/experimentation.md) - Testing hypotheses
- [Autonomous Ops](./docs/autonomous-ops.md) - AI agents in production
- [API Reference](./docs/api.md) - Full documentation

## License

MIT
