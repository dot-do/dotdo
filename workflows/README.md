# ai-workflows

> Event-Driven Domain DSL for Durable Execution

## The Vision

```typescript
on.Customer.signup((customer) => {
  CRM(customer).createAccount()
  Billing(customer).setupSubscription()
  Email(customer).sendWelcome()
})
```

Reads as: _"On customer signup, create CRM account, setup billing, send welcome email."_

## Core Principles

1. **Event-driven** - Workflows are triggered by events, not explicitly called
2. **Domain-first** - Domains are first-class, no `$` prefix needed
3. **No ceremony** - No `Workflow()` wrapper, no `async/await`
4. **Natural language** - `on.Order.placed`, `every.Monday.at9am`

---

## API Design

### Event Subscriptions

```typescript
import { on, Domain } from './on'

// Entity lifecycle events
on.Customer.signup(customer => { ... })
on.Customer.upgraded(customer => { ... })
on.Customer.churned(customer => { ... })

on.Order.placed(order => { ... })
on.Order.paid(order => { ... })
on.Order.shipped(order => { ... })
on.Order.delivered(order => { ... })

// The pattern: on.<Entity>.<event>(handler)
```

### Domain Calls (No $ Prefix)

```typescript
const CRM = Domain('CRM', {
  createAccount: (customer) => ({ accountId: '123' }),
})

const Billing = Domain('Billing', {
  setupSubscription: (customer) => ({ subscriptionId: '456' }),
})

on.Customer.signup((customer) => {
  // Direct domain calls - no $ needed
  CRM(customer).createAccount()
  Billing(customer).setupSubscription()

  // Property access on unresolved values works
  Email(customer).sendWelcome({
    crmId: CRM(customer).createAccount().accountId,
    portalUrl: Billing(customer).setupSubscription().portalUrl,
  })
})
```

### Scheduling

```typescript
import { every } from './on'

// Fluent API
every.Monday.at9am(() => {
  Analytics('sales').weeklyMetrics()
  Slack('#leadership').post({ template: 'weekly-report' })
})

every.day.at6am(() => {
  Maintenance.cleanup()
})

every.hour(() => {
  Metrics.collect()
})

// Natural language string
every('Monday at 9am', () => { ... })
every('daily at 6am', () => { ... })
```

### Fire-and-Forget Events

```typescript
import { send } from './on'

on.Order.paid((order) => {
  // Fire-and-forget: triggers Order.readyToShip event
  send.Order.readyToShip(order)
})

on.Order.readyToShip((order) => {
  Fulfillment(order).createLabel()
  Warehouse(order).pickAndPack()
  send.Order.shipped(order)
})

on.Order.shipped((order) => {
  Email(order.customer).sendShippingNotification()
  Analytics.trackShipment(order)
})
```

### Declarative Conditionals

```typescript
import { when } from './on'

on.Expense.submitted((expense) => {
  const validation = Expenses(expense).validate()

  when(expense.amount > 1000, {
    then: () => {
      Slack(expense.approver).requestApproval()
      waitFor('manager-approval', { timeout: '7 days' })
    },
    else: () => {
      Finance(expense).autoApprove()
    },
  })
})
```

### Human-in-the-Loop

```typescript
import { waitFor, when } from './on'

on.Expense.needsApproval((expense) => {
  Slack(expense.approver).send({ template: 'approval-request', expense })

  const decision = waitFor('approval', { timeout: '7 days' })

  when(decision.approved, {
    then: () => Finance(expense).reimburse(),
    else: () => Email(expense.submitter).sendRejection({ reason: decision.reason }),
  })
})
```

---

## Implementation

### The `on` Proxy

```typescript
// on.Customer.signup(handler) creates an event subscription
export const on = new Proxy(
  {},
  {
    get(_, entity: string) {
      return new Proxy(
        {},
        {
          get(_, event: string) {
            return (handler: Function) => {
              registerEventHandler(`${entity}.${event}`, handler)
            }
          },
        },
      )
    },
  },
)
```

### Domain as First-Class

```typescript
// Domains are callable without $ prefix
const CRM = Domain('CRM', {
  createAccount: (customer) => { ... }
})

// When called, returns PipelinePromise (deferred execution)
CRM(customer).createAccount()
// Returns: { __expr: { type: 'call', domain: 'CRM', method: ['createAccount'], context: customer } }
```

### The `every` Scheduler

```typescript
// Fluent: every.Monday.at9am(handler)
// String: every('Monday at 9am', handler)
export const every = new Proxy(..., {
  get(_, day: string) {
    return new Proxy(..., {
      get(_, time: string) {
        return (handler: Function) => {
          const cron = toCron(day, time) // 'Monday', 'at9am' -> '0 9 * * 1'
          registerScheduledHandler(cron, handler)
        }
      }
    })
  }
})
```

### The `send` Fire-and-Forget

```typescript
// send.Order.shipped(order) - fires event, doesn't wait
export const send = new Proxy(
  {},
  {
    get(_, entity: string) {
      return new Proxy(
        {},
        {
          get(_, event: string) {
            return (payload: unknown) => {
              return createPipelinePromise({
                type: 'send',
                entity,
                event,
                payload,
              })
            }
          },
        },
      )
    },
  },
)
```

---

## PipelinePromise: Capnweb-Style Lazy Execution

Inspired by [capnweb](https://github.com/cloudflare/capnweb), all domain calls return **PipelinePromises** that capture expressions without executing:

```typescript
// User writes:
CRM(customer).createAccount()

// Runtime captures (no execution yet):
{
  __expr: {
    type: 'call',
    domain: 'CRM',
    method: ['createAccount'],
    context: customer
  }
}
```

### Property Access on Unresolved Values

```typescript
const crm = CRM(customer).createAccount()
const accountId = crm.accountId  // Returns PipelinePromise, not actual value

// accountId.__expr:
{
  type: 'property',
  base: { type: 'call', domain: 'CRM', ... },
  property: 'accountId'
}
```

### Deferred Execution Benefits

| Benefit                  | Explanation                                 |
| ------------------------ | ------------------------------------------- |
| **No async/await**       | Workflows read like synchronous code        |
| **Dependency analysis**  | Runtime can analyze the expression graph    |
| **Parallel execution**   | Independent operations execute concurrently |
| **Deterministic replay** | Expressions serialize for durable execution |

---

## Examples

### Customer Onboarding

```typescript
const CRM = Domain('CRM', {
  createAccount: (customer) => ({ accountId: `crm_${customer.id}`, ...customer }),
})
const Billing = Domain('Billing', {
  setupSubscription: (customer) => ({ subscriptionId: `sub_${customer.id}`, portalUrl: `https://billing.example.com/${customer.id}` }),
})
const Email = Domain('Email', {
  sendWelcome: (customer, data) => ({ sent: true, to: customer.email }),
})

on.Customer.signup((customer) => {
  CRM(customer).createAccount()
  Billing(customer).setupSubscription()

  // Property access on unresolved PipelinePromises - values resolve at execution time
  Email(customer).sendWelcome({
    crmId: CRM(customer).createAccount().accountId,
    portalUrl: Billing(customer).setupSubscription().portalUrl,
  })
})
```

### Weekly Reports

```typescript
const Analytics = Domain('Analytics', {
  weeklyMetrics: (team) => ({ revenue: 50000, growth: 0.15, team }),
})
const AI = Domain('AI', {
  generateInsights: (context, data) => ({ summary: 'Revenue up 15%', recommendations: [] }),
})
const Slack = Domain('Slack', {
  post: (channel, message) => ({ posted: true, channel, ts: Date.now() }),
})

every.Monday.at9am(() => {
  const metrics = Analytics('sales').weeklyMetrics()
  const insights = AI('analyst').generateInsights({ metrics })
  Slack('#leadership').post({ report: { metrics, insights } })
})
```

### Expense Approval with Human-in-Loop

```typescript
const Expenses = Domain('Expenses', {
  validate: (expense) => ({ valid: true, requiresApproval: expense.amount > 1000 }),
})
const Finance = Domain('Finance', {
  reimburse: (expense) => ({ processed: true, amount: expense.amount }),
  autoApprove: (expense) => ({ approved: true, automated: true }),
})
const Slack = Domain('Slack', {
  requestApproval: (approver, data) => ({ sent: true, channel: approver }),
})
const Email = Domain('Email', {
  reject: (recipient, data) => ({ sent: true, to: recipient }),
})

on.Expense.submitted((expense) => {
  const validation = Expenses(expense).validate()

  when(validation.requiresApproval, {
    then: () => {
      Slack(expense.approver).requestApproval({ expense })
      const decision = waitFor('approval', { timeout: '7 days' })

      when(decision.approved, {
        then: () => Finance(expense).reimburse(),
        else: () => Email(expense.submitter).reject({ reason: decision.reason }),
      })
    },
    else: () => {
      Finance(expense).autoApprove()
    },
  })
})
```

### Sprint Lifecycle

```typescript
on.Sprint.started((sprint) => {
  const backlog = Backlog(sprint.startup).getItems()
  backlog.map((item) => AI(sprint.startup.mission).prioritize({ item }))

  Standup(sprint.team).scheduleDaily({ time: '9am', channel: sprint.slackChannel })
  Slack(sprint.slackChannel).post({ template: 'sprint-started', sprint })
})

on.Sprint.ended((sprint) => {
  const feedback = Standup(sprint.team).aggregateFeedback()
  const retro = AI('agile-coach').generateRetro({ sprint, feedback })

  Slack(sprint.slackChannel).post({ template: 'sprint-retro', retro })
  send.Sprint.started(Sprint(sprint.startup).planNext({ retro }))
})
```

---

## Comparison: v1 vs v2

| Aspect          | v1 (Workflow)                         | v2 (on.Event)                   |
| --------------- | ------------------------------------- | ------------------------------- |
| Declaration     | `Workflow('name', ($, input) => ...)` | `on.Entity.event(input => ...)` |
| Domain calls    | `$.CRM(ctx).method()`                 | `CRM(ctx).method()`             |
| Async           | `await`, `Promise.all`                | No await needed                 |
| Scheduling      | `Workflow().every('...').run()`       | `every.Monday.at9am(() => ...)` |
| Fire-and-forget | N/A                                   | `send.Entity.event(payload)`    |
| Mental model    | "Define and call workflows"           | "React to events"               |

---

## Benefits

1. **Simpler** - No Workflow wrapper, no $ prefix, no await
2. **Declarative** - "When X happens, do Y"
3. **Composable** - Events can trigger other events via `send`
4. **Natural** - Reads like English
5. **Event-sourced** - Every action is an event

---

## File Structure

```
workflows/
├── on.ts                    # Event DSL: on, every, send, when, waitFor, Domain
├── on.test.ts               # Tests for event DSL
├── pipeline-promise.ts      # PipelinePromise implementation
├── pipeline-promise.test.ts # Tests for PipelinePromise
├── analyzer.ts              # Expression dependency analysis
├── domain.ts                # Base domain registry
├── DESIGN.md                # Original architecture doc
├── DESIGN-v2.md             # Event-driven design doc
└── README.md                # This file
```

---

## Running Tests

```bash
npx vitest run workflows/
```

---

## Related Documentation

- [Workflows Documentation](/docs/workflows/) - User-facing documentation with $ context DSL, durability levels, and patterns
- [Workflow Triggers](/docs/workflows/triggers) - Event, schedule, manual, and webhook triggers
- [SDK: WorkflowContext](/docs/sdk/workflow-context) - Full $ API reference

---

## License

MIT
