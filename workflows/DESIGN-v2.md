# ai-workflows v2: Event-Driven Domain DSL

## The Vision

```typescript
on.Customer.signup(customer => {
  CRM(customer).createAccount()
  Billing(customer).setupSubscription()
  Email(customer).sendWelcome()
})
```

Reads as: *"On customer signup, create CRM account, setup billing, send welcome email."*

## Core Principles

1. **Event-driven** - Workflows are triggered by events, not explicitly called
2. **Domain-first** - Domains are first-class, no `$` prefix needed
3. **No ceremony** - No `Workflow()` wrapper, no `async/await`
4. **Natural language** - `on.Order.placed`, `every.Monday.at9am`

## API Design

### Event Subscriptions

```typescript
// Entity lifecycle events
on.Customer.signup(customer => { ... })
on.Customer.upgraded(customer => { ... })
on.Customer.churned(customer => { ... })

on.Order.placed(order => { ... })
on.Order.paid(order => { ... })
on.Order.shipped(order => { ... })
on.Order.delivered(order => { ... })

// The event name is the method, entity is the namespace
on.<Entity>.<event>(handler)
```

### Domain Calls (No $ Prefix)

```typescript
on.Customer.signup(customer => {
  // Direct domain calls - no $ needed
  CRM(customer).createAccount()
  Billing(customer).setupSubscription()
  Support(customer).createTicketQueue()
  Analytics(customer).initializeTracking()

  // Property access on unresolved values still works
  Email(customer).sendWelcome({
    crmId: CRM(customer).id,
    portalUrl: Billing(customer).portalUrl
  })
})
```

### Scheduling

```typescript
// Fluent API
every.Monday.at9am(() => {
  Analytics.weeklyReport()
})

every.day.at6am(() => {
  Maintenance.cleanup()
})

every.hour(() => {
  Metrics.collect()
})

// Or natural language string
every('Monday at 9am', () => { ... })
every('first day of month', () => { ... })
every('15 minutes', () => { ... })
```

### Conditionals

```typescript
on.Expense.submitted(expense => {
  Expenses(expense).validate()

  when(expense.amount > 1000, {
    then: () => {
      Slack(expense.approver).requestApproval()
      waitFor('manager-approval', { timeout: '7 days' })
    },
    else: () => {
      Finance(expense).autoApprove()
    }
  })
})
```

### Human-in-the-Loop

```typescript
on.Expense.needsApproval(expense => {
  Slack(expense.approver).send({ template: 'approval-request', expense })

  const decision = waitFor('approval', { timeout: '7 days' })

  when(decision.approved, {
    then: () => Finance(expense).reimburse(),
    else: () => Email(expense.submitter).sendRejection({ reason: decision.reason })
  })
})
```

### Batch Processing (Magic Map)

```typescript
on.Order.placed(order => {
  // Magic map - each item processed in batch
  order.items.map(item => {
    Inventory(item.product).check()
    Inventory(item.product).reserve({ quantity: item.quantity })
  })

  Payment(order).process()
  Email(order.customer).sendConfirmation()
})
```

### Chained Events (Fire-and-Forget)

```typescript
on.Order.paid(order => {
  // Fire-and-forget: triggers Order.shipped event when done
  send.Order.readyToShip(order)
})

on.Order.readyToShip(order => {
  Fulfillment(order).createLabel()
  Warehouse(order).pickAndPack()
  send.Order.shipped(order)
})

on.Order.shipped(order => {
  Email(order.customer).sendShippingNotification()
  Analytics.trackShipment(order)
})
```

## Implementation

### The `on` Proxy

```typescript
// on.Customer.signup(handler) creates an event subscription
const on = new Proxy({}, {
  get(_, entity: string) {
    return new Proxy({}, {
      get(_, event: string) {
        return (handler: Function) => {
          // Register: when entity.event fires, run handler
          registerEventHandler(`${entity}.${event}`, handler)
        }
      }
    })
  }
})
```

### Domain as First-Class

```typescript
// Domains are registered globally, callable without $
const CRM = Domain('CRM', {
  createAccount: (customer) => { ... },
  updateAccount: (customer, data) => { ... }
})

// When called, returns PipelinePromise (same as before)
CRM(customer).createAccount()
// Returns PipelinePromise with expr: { type: 'call', domain: 'CRM', method: ['createAccount'], context: customer }
```

### The `every` Scheduler

```typescript
// Fluent: every.Monday.at9am(handler)
const every = new Proxy({}, {
  get(_, day: string) {
    return new Proxy({}, {
      get(_, time: string) {
        return (handler: Function) => {
          const cron = parseToCron(day, time) // 'Monday', 'at9am' -> '0 9 * * 1'
          registerScheduledHandler(cron, handler)
        }
      }
    })
  }
})

// String: every('Monday at 9am', handler)
function every(schedule: string, handler: Function) {
  const cron = parseNaturalLanguage(schedule)
  registerScheduledHandler(cron, handler)
}
```

### The `send` Fire-and-Forget

```typescript
// send.Order.shipped(order) - fires event, doesn't wait
const send = new Proxy({}, {
  get(_, entity: string) {
    return new Proxy({}, {
      get(_, event: string) {
        return (payload: unknown) => {
          // Queue event for async processing
          return createPipelinePromise({
            type: 'send',
            entity,
            event,
            payload
          })
        }
      }
    })
  }
})
```

## Examples Reimagined

### OnboardingWorkflow → on.Customer.signup

```typescript
// BEFORE
const OnboardingWorkflow = Workflow('customer-onboarding', ($, customer) => {
  const crm = $.CRM(customer).createAccount()
  const billing = $.Billing(customer).setupSubscription()
  $.Email(customer).sendWelcome({ crmId: crm.id })
  return { crmId: crm.id }
})

// AFTER
on.Customer.signup(customer => {
  CRM(customer).createAccount()
  Billing(customer).setupSubscription()
  Support(customer).createTicketQueue()
  Analytics(customer).initializeTracking()

  Email(customer).sendWelcome({
    crmId: CRM(customer).id,
    portalUrl: Billing(customer).portalUrl
  })
})
```

### ExpenseApprovalWorkflow → on.Expense.submitted

```typescript
// BEFORE
const ExpenseApprovalWorkflow = Workflow('expense-approval', ($, expense) => {
  const validation = $.Expenses(expense).validate()
  return $.when(validation.requiresApproval, { ... })
})

// AFTER
on.Expense.submitted(expense => {
  const validation = Expenses(expense).validate()

  when(validation.requiresApproval, {
    then: () => {
      Slack(expense.approver).requestApproval({ expense })
      const decision = waitFor('approval', { timeout: '7 days' })

      when(decision.approved, {
        then: () => Finance(expense).reimburse(),
        else: () => Email(expense.submitter).reject({ reason: decision.reason })
      })
    },
    else: () => {
      Finance(expense).autoApprove()
    }
  })
})
```

### WeeklyReportWorkflow → every.Monday.at9am

```typescript
// BEFORE
const WeeklyReportWorkflow = Workflow('weekly-report')
  .every('Monday at 9am')
  .run(($) => { ... })

// AFTER
every.Monday.at9am(() => {
  const sales = Analytics('sales').weeklyMetrics()
  const support = Support('tickets').weeklyStats()
  const engineering = Engineering('velocity').sprintMetrics()

  const insights = AI('analyst').generateInsights({ sales, support, engineering })

  const report = Reports.create({ metrics: { sales, support, engineering }, insights })

  Slack('#leadership').post({ template: 'weekly-report', report })
  Email('executives').send({ template: 'weekly-digest', report })
})
```

### SprintWorkflow → on.Sprint.started + every

```typescript
on.Sprint.started(sprint => {
  const backlog = Backlog(sprint.startup).getItems()

  // AI prioritizes each item
  backlog.map(item => AI(sprint.startup.mission).prioritize({ item }))

  Standup(sprint.team).scheduleDaily({ time: '9am', channel: sprint.slackChannel })
  Slack(sprint.slackChannel).post({ template: 'sprint-started', sprint })
})

on.Sprint.ended(sprint => {
  const feedback = Standup(sprint.team).aggregateFeedback()
  const retro = AI('agile-coach').generateRetro({ sprint, feedback })

  Slack(sprint.slackChannel).post({ template: 'sprint-retro', retro })

  // Start next sprint
  send.Sprint.started(Sprint(sprint.startup).planNext({ retro }))
})

// Trigger sprint end after 2 weeks
on.Sprint.started(sprint => {
  sleep('2 weeks')
  send.Sprint.ended(sprint)
})
```

## Comparison

| Aspect | v1 (Workflow) | v2 (on.Event) |
|--------|---------------|---------------|
| Declaration | `Workflow('name', ($, input) => ...)` | `on.Entity.event(input => ...)` |
| Domain calls | `$.CRM(ctx).method()` | `CRM(ctx).method()` |
| Scheduling | `Workflow().every('...').run()` | `every.Monday.at9am(() => ...)` |
| Fire-and-forget | N/A | `send.Entity.event(payload)` |
| Mental model | "Define and call workflows" | "React to events" |

## Benefits

1. **Simpler** - No Workflow wrapper, no $ prefix
2. **Declarative** - "When X happens, do Y"
3. **Composable** - Events can trigger other events via `send`
4. **Natural** - Reads like English
5. **Event-sourced** - Every action is an event

## Open Questions

1. **Return values** - Do event handlers return anything? Or is everything fire-and-forget with `send`?
2. **Error handling** - How do we handle failures in event handlers?
3. **Ordering** - Can multiple handlers subscribe to the same event? What order?
4. **Idempotency** - How do we ensure handlers don't double-process?
