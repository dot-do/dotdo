# ai-workflows

> Domain-Driven Durable Execution via Cloudflare Workflows + ai-evaluate

## The Vision

A fluent, domain-driven workflow DSL where every method call is automatically durable, retryable, and executed in a secure sandbox:

```typescript
const result = await $.Inventory(product).check()
const priorities = await $.Roadmap(startup).prioritizeBacklog()
const analysis = await $.Market(competitor).analyze()
```

Each call compiles to a **Cloudflare Workflow step** executed via **ai-evaluate**, giving you:
- **Durability**: Survives crashes, restarts, deployments
- **Automatic retries**: Configurable backoff strategies
- **Security**: User handlers run in isolated V8 sandboxes
- **AI-native**: Full AI SDK available within handlers

---

## Core Concept

```
$.<Domain>(<context>).<method>(<args>)
   │         │           │       │
   │         │           │       └── Additional arguments
   │         │           └── Durable action (becomes step.do)
   │         └── Entity/context being operated on
   └── Domain actor/service
```

This reads like natural domain language while providing bulletproof execution guarantees.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Developer Interface                              │
│                                                                          │
│   $.Inventory(product).check()         $.Roadmap(startup).prioritize()  │
│   $.Payment(order).process()           $.Email(customer).sendWelcome()  │
│   $.Analysis(market).competitive()     $.Calendar(team).schedule()      │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Workflow Compiler                                │
│                                                                          │
│   Transforms fluent calls into Cloudflare WorkflowEntrypoint classes    │
│   • $.Domain(ctx).method() → step.do('Domain.method', ...)              │
│   • Serializes handler source code                                       │
│   • Generates wrangler.toml configuration                               │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                    Cloudflare Workflows Engine                           │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────────────┐    │
│  │ step.do()      │  │ step.sleep()   │  │ step.waitForEvent()    │    │
│  │ • Checkpoints  │  │ • Hibernation  │  │ • Human-in-the-loop    │    │
│  │ • Retries      │  │ • Zero cost    │  │ • Days/weeks wait      │    │
│  └────────────────┘  └────────────────┘  └────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       ai-evaluate Sandbox                                │
│                                                                          │
│   Isolated V8 execution environment for each domain method:             │
│   • Network isolated                                                     │
│   • Resource constrained                                                 │
│   • AI SDK available ($.ai.generate, $.ai.embed, $.ai.chat)            │
│   • Database access ($.db.query, $.db.search)                           │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Defining Domains

Domains are collections of related methods that operate on a specific entity type:

```typescript
import { Domain } from 'ai-workflows'

// Define the Inventory domain
export const Inventory = Domain('Inventory', {
  // Each method receives (context, args, $)
  check: async (product, _, $) => {
    const stock = await $.db.query(
      'SELECT quantity FROM inventory WHERE sku = ?',
      [product.sku]
    )
    return {
      available: stock.quantity > 0,
      quantity: stock.quantity,
      reorderPoint: stock.reorderPoint
    }
  },

  reserve: async (product, { quantity }, $) => {
    const reservation = await $.db.transaction(async (tx) => {
      await tx.execute(
        'UPDATE inventory SET reserved = reserved + ? WHERE sku = ?',
        [quantity, product.sku]
      )
      return tx.insert('reservations', {
        sku: product.sku,
        quantity,
        expiresAt: Date.now() + 15 * 60 * 1000 // 15 min hold
      })
    })
    return { reservationId: reservation.id }
  },

  release: async (reservation, _, $) => {
    await $.db.execute(
      'UPDATE inventory SET reserved = reserved - ? WHERE sku = ?',
      [reservation.quantity, reservation.sku]
    )
    await $.db.delete('reservations', reservation.id)
    return { released: true }
  }
})
```

```typescript
// Define the Roadmap domain with AI-powered methods
export const Roadmap = Domain('Roadmap', {
  prioritizeBacklog: async (startup, _, $) => {
    // Fetch current backlog
    const backlog = await $.db.query(
      'SELECT * FROM backlog WHERE startup_id = ? AND status = ?',
      [startup.id, 'open']
    )

    // AI-powered prioritization
    const prioritized = await $.ai.generate({
      system: `You are a product strategist. Prioritize backlog items based on:
        - Business impact
        - Technical feasibility
        - User demand
        - Strategic alignment with: ${startup.mission}`,
      prompt: `Prioritize these backlog items:\n${JSON.stringify(backlog, null, 2)}`,
      schema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                priority: { type: 'number' },
                reasoning: { type: 'string' }
              }
            }
          }
        }
      }
    })

    return prioritized
  },

  generatePRD: async (startup, { feature }, $) => {
    const context = await $.db.query(
      'SELECT * FROM features WHERE startup_id = ? ORDER BY created_at DESC LIMIT 10',
      [startup.id]
    )

    const prd = await $.ai.generate({
      system: 'You are a senior product manager writing detailed PRDs.',
      prompt: `Write a PRD for: ${feature.title}\n\nContext: ${JSON.stringify(context)}`,
    })

    // Store artifact
    await $.db.insert('documents', {
      type: 'prd',
      startupId: startup.id,
      featureId: feature.id,
      content: prd
    })

    return { prd, documentId: feature.id }
  }
})
```

---

## Writing Workflows

Workflows compose domain methods into durable execution flows:

```typescript
import { Workflow } from 'ai-workflows'
import { Inventory, Payment, Fulfillment, Email } from './domains'

export const OrderWorkflow = Workflow('order-processing', async ($, order) => {
  // Step 1: Check inventory (durable, retryable)
  const inventory = await $.Inventory(order.product).check()

  if (!inventory.available) {
    await $.Email(order.customer).send({
      template: 'out-of-stock',
      data: { product: order.product, eta: inventory.restockDate }
    })
    return { status: 'backordered', orderId: order.id }
  }

  // Step 2: Reserve inventory
  const reservation = await $.Inventory(order.product).reserve({
    quantity: order.quantity
  })

  // Step 3: Process payment
  const payment = await $.Payment(order).process({
    amount: order.total,
    method: order.paymentMethod
  })

  if (!payment.success) {
    // Release reservation on payment failure
    await $.Inventory(reservation).release()
    return { status: 'payment-failed', error: payment.error }
  }

  // Step 4: Create fulfillment
  const fulfillment = await $.Fulfillment(order).create({
    reservationId: reservation.id,
    shippingAddress: order.shippingAddress
  })

  // Step 5: Send confirmation
  await $.Email(order.customer).send({
    template: 'order-confirmed',
    data: {
      order,
      tracking: fulfillment.trackingNumber,
      estimatedDelivery: fulfillment.estimatedDelivery
    }
  })

  return {
    status: 'confirmed',
    orderId: order.id,
    trackingNumber: fulfillment.trackingNumber
  }
})
```

---

## Compilation: DSL → Cloudflare Workflows

The compiler transforms the fluent DSL into Cloudflare WorkflowEntrypoint classes:

### Input (Developer writes)

```typescript
const inventory = await $.Inventory(product).check()
```

### Output (Compiler generates)

```typescript
const inventory = await step.do('Inventory.check', {
  retries: { limit: 5, delay: '1s', backoff: 'exponential' },
  timeout: '5m'
}, async () => {
  const result = await evaluate({
    script: `
      const handler = ${InventoryDomain.check.source}
      return handler(context, args, $)
    `,
    env: {
      context: ${JSON.stringify(product)},
      args: {}
    },
    sdk: { context: 'local', aiGateway: env.AI_GATEWAY }
  }, { LOADER: this.env.LOADER, TEST: this.env.TEST })

  if (!result.success) {
    throw new Error(result.error)
  }
  return result.value
})
```

### Full Generated Workflow Class

```typescript
import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workflows'
import { evaluate } from 'ai-evaluate'

export class OrderProcessingWorkflow extends WorkflowEntrypoint<Env, OrderEvent> {
  private domains = {
    Inventory: InventoryHandlers,
    Payment: PaymentHandlers,
    Fulfillment: FulfillmentHandlers,
    Email: EmailHandlers
  }

  async run(event: WorkflowEvent<OrderEvent>, step: WorkflowStep) {
    const order = event.payload

    // Step 1: Inventory.check
    const inventory = await this.executeStep(step, 'Inventory', 'check', order.product, {})

    if (!inventory.available) {
      await this.executeStep(step, 'Email', 'send', order.customer, {
        template: 'out-of-stock',
        data: { product: order.product, eta: inventory.restockDate }
      })
      return { status: 'backordered', orderId: order.id }
    }

    // Step 2: Inventory.reserve
    const reservation = await this.executeStep(step, 'Inventory', 'reserve', order.product, {
      quantity: order.quantity
    })

    // Step 3: Payment.process
    const payment = await this.executeStep(step, 'Payment', 'process', order, {
      amount: order.total,
      method: order.paymentMethod
    })

    if (!payment.success) {
      await this.executeStep(step, 'Inventory', 'release', reservation, {})
      return { status: 'payment-failed', error: payment.error }
    }

    // Step 4: Fulfillment.create
    const fulfillment = await this.executeStep(step, 'Fulfillment', 'create', order, {
      reservationId: reservation.id,
      shippingAddress: order.shippingAddress
    })

    // Step 5: Email.send
    await this.executeStep(step, 'Email', 'send', order.customer, {
      template: 'order-confirmed',
      data: { order, tracking: fulfillment.trackingNumber }
    })

    return { status: 'confirmed', orderId: order.id }
  }

  private async executeStep<T>(
    step: WorkflowStep,
    domain: string,
    method: string,
    context: unknown,
    args: unknown
  ): Promise<T> {
    const handler = this.domains[domain]?.[method]
    if (!handler) throw new Error(`Unknown: ${domain}.${method}`)

    return step.do(`${domain}.${method}`, {
      retries: handler.retries ?? { limit: 5, delay: '1s', backoff: 'exponential' },
      timeout: handler.timeout ?? '5m'
    }, async () => {
      const result = await evaluate({
        script: handler.source,
        env: { context: JSON.stringify(context), args: JSON.stringify(args) },
        sdk: { context: 'local', aiGateway: this.env.AI_GATEWAY }
      }, { LOADER: this.env.LOADER, TEST: this.env.TEST })

      if (!result.success) throw new Error(result.error)
      return result.value as T
    })
  }
}
```

---

## Human-in-the-Loop

Workflows can pause and wait for human decisions using `$.waitFor()`:

```typescript
export const ExpenseWorkflow = Workflow('expense-approval', async ($, expense) => {
  // Validate expense
  const validation = await $.Expenses(expense).validate()

  if (validation.requiresApproval) {
    // Notify approver
    await $.Slack(expense.approver).send({
      template: 'expense-approval-request',
      data: { expense, validation }
    })

    // WORKFLOW HIBERNATES HERE - zero compute cost
    // Can wait days or weeks for human response
    const decision = await $.waitFor('manager-approval', {
      timeout: '7 days',
      type: 'expense-decision'
    })

    if (!decision.approved) {
      await $.Email(expense.submitter).send({
        template: 'expense-rejected',
        data: { expense, reason: decision.reason }
      })
      return { status: 'rejected', reason: decision.reason }
    }
  }

  // Process reimbursement
  const reimbursement = await $.Finance(expense).reimburse()

  await $.Email(expense.submitter).send({
    template: 'expense-approved',
    data: { expense, reimbursement }
  })

  return { status: 'approved', reimbursementId: reimbursement.id }
})
```

### Sending Events to Waiting Workflows

```typescript
// From a Slack webhook handler or approval UI
await env.EXPENSE_WORKFLOW.get(instanceId).sendEvent({
  type: 'expense-decision',
  payload: {
    approved: true,
    approver: 'manager@company.com',
    approvedAt: new Date()
  }
})
```

### Compiles To

```typescript
// Workflow hibernates with zero resource usage
const decision = await step.waitForEvent('manager-approval', {
  type: 'expense-decision',
  timeout: '7 days'
})
```

---

## Scheduled Workflows

Use `$.every()` for recurring workflows:

```typescript
export const WeeklyReportWorkflow = Workflow('weekly-report')
  .every('Monday at 9am')
  .run(async ($) => {
    // Gather metrics from all sources
    const [sales, support, engineering] = await Promise.all([
      $.Analytics('sales').weeklyMetrics(),
      $.Support('tickets').weeklyStats(),
      $.Engineering('velocity').sprintMetrics()
    ])

    // Generate AI-powered insights
    const insights = await $.AI('analyst').generateInsights({
      sales,
      support,
      engineering,
      previousWeek: await $.Reports('last-week').get()
    })

    // Create and distribute report
    const report = await $.Reports('weekly').create({
      metrics: { sales, support, engineering },
      insights
    })

    await $.Slack('#leadership').post({
      template: 'weekly-report',
      data: report
    })

    return report
  })
```

### Generates wrangler.toml

```toml
[[workflows]]
name = "weekly-report"
binding = "WEEKLY_REPORT_WORKFLOW"
class_name = "WeeklyReportWorkflow"

[triggers]
crons = ["0 9 * * 1"]  # Monday 9am UTC
```

---

## Parallel Execution

Run multiple domain calls concurrently:

```typescript
export const OnboardingWorkflow = Workflow('customer-onboarding', async ($, customer) => {
  // Parallel: Create all accounts simultaneously
  const [crm, billing, support, analytics] = await Promise.all([
    $.CRM(customer).createAccount(),
    $.Billing(customer).setupSubscription(),
    $.Support(customer).createTicketQueue(),
    $.Analytics(customer).initializeTracking()
  ])

  // Sequential: Depends on previous results
  await $.Email(customer).sendWelcome({
    crmId: crm.id,
    billingPortal: billing.portalUrl,
    supportEmail: support.email
  })

  // Parallel: Start onboarding tasks
  await Promise.all([
    $.Calendar(customer).scheduleKickoff(),
    $.Docs(customer).generateQuickstart(),
    $.Slack(customer.csm).notifyNewCustomer({ customer, crm })
  ])

  return { customerId: customer.id, status: 'onboarded' }
})
```

Each `Promise.all` group executes steps in parallel, while sequential calls wait for dependencies.

---

## Error Handling

### Automatic Retries

Every domain method call has configurable retry behavior:

```typescript
export const Payment = Domain('Payment', {
  process: {
    // Retry configuration
    retries: { limit: 10, delay: '2s', backoff: 'exponential' },
    timeout: '30s',

    handler: async (order, { amount, method }, $) => {
      const result = await $.external.stripe.charges.create({
        amount,
        currency: 'usd',
        source: method.token
      })
      return { success: true, chargeId: result.id }
    }
  }
})
```

### Non-Retryable Errors

For errors that should fail immediately:

```typescript
import { NonRetryableError } from 'ai-workflows'

export const Validation = Domain('Validation', {
  checkCredentials: async (user, _, $) => {
    const valid = await $.auth.verify(user.token)

    if (!valid) {
      // Fails immediately, no retries
      throw new NonRetryableError('Invalid credentials')
    }

    return { valid: true }
  }
})
```

### Try-Catch in Workflows

```typescript
export const RiskyWorkflow = Workflow('risky-operation', async ($, data) => {
  try {
    const result = await $.ExternalAPI(data).call()
    return { success: true, result }
  } catch (error) {
    // Graceful degradation
    await $.Fallback(data).process()
    await $.Alert('ops-team').notify({ error, data })
    return { success: false, fallback: true }
  }
})
```

---

## State Management

Workflow state is managed through step return values (Cloudflare Workflows pattern):

```typescript
export const StatefulWorkflow = Workflow('stateful', async ($, initial) => {
  // State is accumulated through steps
  const step1Result = await $.Process(initial).stepOne()

  // step1Result is persisted - survives crashes
  const step2Result = await $.Process(step1Result).stepTwo()

  // Build up state through the workflow
  const finalState = await $.Process({
    initial,
    step1: step1Result,
    step2: step2Result
  }).finalize()

  return finalState
})
```

### Explicit State Management

For complex state, use the state helper:

```typescript
export const ComplexWorkflow = Workflow('complex', async ($, input) => {
  // Initialize state
  const state = $.state({ items: [], total: 0 })

  for (const item of input.items) {
    const processed = await $.Items(item).process()

    // Update state (creates checkpoint)
    await state.update({
      items: [...state.current.items, processed],
      total: state.current.total + processed.value
    })
  }

  return state.current
})
```

---

## The Execution Model

### What Happens at Runtime

```
┌─────────────────────────────────────────────────────────────────────────┐
│  $.Inventory(product).check()                                           │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  1. CLOUDFLARE WORKFLOW ENGINE                                          │
│     • Creates checkpoint before execution                               │
│     • Manages retry state                                               │
│     • Persists result after success                                     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  2. AI-EVALUATE SANDBOX                                                 │
│     • Isolated V8 context created                                       │
│     • Handler source injected                                           │
│     • Context (product) and args passed in                              │
│     • SDK available: $.ai, $.db, $.external                             │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  3. HANDLER EXECUTION                                                   │
│     const stock = await $.db.query('SELECT...')                         │
│     return { available: stock > 0, quantity: stock }                    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  4. RESULT                                                              │
│     • { success: true, value: { available: true, quantity: 42 } }       │
│     • Persisted to Durable Object storage                               │
│     • Workflow continues to next step                                   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Failure & Recovery

```
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 1: $.Inventory.check()     ✓ Completed (persisted)               │
│  STEP 2: $.Payment.process()     ✗ Failed (attempt 1/5)                │
│                                                                          │
│  [Infrastructure restart / deployment / crash]                          │
│                                                                          │
│  RECOVERY:                                                               │
│  STEP 1: $.Inventory.check()     ⏭ Skipped (cached result)             │
│  STEP 2: $.Payment.process()     🔄 Retry (attempt 2/5)                │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Testing

### Unit Testing Domains

```typescript
import { createTestContext } from 'ai-workflows/testing'
import { Inventory } from './domains/inventory'

describe('Inventory Domain', () => {
  it('checks stock correctly', async () => {
    const $ = createTestContext({
      db: mockDatabase({ inventory: [{ sku: 'ABC', quantity: 10 }] })
    })

    const result = await Inventory.check({ sku: 'ABC' }, {}, $)

    expect(result).toEqual({
      available: true,
      quantity: 10
    })
  })
})
```

### Integration Testing Workflows

```typescript
import { createTestWorkflow } from 'ai-workflows/testing'
import { OrderWorkflow } from './workflows/order'

describe('Order Workflow', () => {
  it('processes order end-to-end', async () => {
    const workflow = await createTestWorkflow(OrderWorkflow)

    // Disable sleeps for fast tests
    workflow.modifier.disableSleeps()

    // Mock external services
    workflow.modifier.mockStepResult('Payment.process', {
      success: true,
      chargeId: 'ch_test'
    })

    const result = await workflow.run({
      product: { sku: 'ABC' },
      quantity: 1,
      customer: { email: 'test@example.com' }
    })

    expect(result.status).toBe('confirmed')
    expect(workflow.steps).toContain('Inventory.check')
    expect(workflow.steps).toContain('Payment.process')
  })

  it('handles payment failure', async () => {
    const workflow = await createTestWorkflow(OrderWorkflow)

    workflow.modifier.mockStepError('Payment.process', new Error('Card declined'))

    const result = await workflow.run({ /* ... */ })

    expect(result.status).toBe('payment-failed')
    // Verify inventory was released
    expect(workflow.steps).toContain('Inventory.release')
  })
})
```

---

## Configuration

### wrangler.toml

```toml
name = "my-workflows"
main = "src/index.ts"
compatibility_date = "2024-01-01"

# Workflows
[[workflows]]
name = "order-processing"
binding = "ORDER_WORKFLOW"
class_name = "OrderProcessingWorkflow"

[[workflows]]
name = "expense-approval"
binding = "EXPENSE_WORKFLOW"
class_name = "ExpenseApprovalWorkflow"

[[workflows]]
name = "weekly-report"
binding = "WEEKLY_REPORT_WORKFLOW"
class_name = "WeeklyReportWorkflow"

# Cron triggers
[triggers]
crons = ["0 9 * * 1"]  # Weekly report: Monday 9am

# Bindings for ai-evaluate
[[durable_objects.bindings]]
name = "LOADER"
class_name = "WorkerLoader"

[[durable_objects.bindings]]
name = "ENGINE"
class_name = "Engine"

# AI Gateway
[ai]
binding = "AI"

# Queues for event routing
[[queues.producers]]
queue = "workflow-events"
binding = "EVENT_QUEUE"

[[queues.consumers]]
queue = "workflow-events"
max_batch_size = 10
```

---

## Type Safety

Full TypeScript support throughout:

```typescript
import { Domain, Workflow } from 'ai-workflows'

// Strongly typed domain
interface Product {
  sku: string
  name: string
  price: number
}

interface InventoryResult {
  available: boolean
  quantity: number
}

interface ReservationResult {
  reservationId: string
  expiresAt: Date
}

export const Inventory = Domain<{
  check: (product: Product) => Promise<InventoryResult>
  reserve: (product: Product, args: { quantity: number }) => Promise<ReservationResult>
  release: (reservation: ReservationResult) => Promise<{ released: boolean }>
}>('Inventory', {
  check: async (product, _, $) => { /* ... */ },
  reserve: async (product, { quantity }, $) => { /* ... */ },
  release: async (reservation, _, $) => { /* ... */ }
})

// Type-safe workflow
interface OrderInput {
  product: Product
  quantity: number
  customer: Customer
}

export const OrderWorkflow = Workflow<OrderInput, OrderResult>(
  'order-processing',
  async ($, order) => {
    // TypeScript knows all types here
    const inventory = await $.Inventory(order.product).check()
    //    ^? InventoryResult

    if (inventory.available) {
      const reservation = await $.Inventory(order.product).reserve({
        quantity: order.quantity
      })
      //    ^? ReservationResult
    }
  }
)
```

---

## Comparison

| Feature | ai-workflows | Temporal.io | AWS Step Functions |
|---------|--------------|-------------|-------------------|
| Syntax | `$.Domain(ctx).method()` | Activity functions | JSON state machine |
| Durability | Cloudflare Workflows | Temporal server | AWS infrastructure |
| Handler Isolation | ai-evaluate sandbox | Worker process | Lambda functions |
| AI Integration | Native ($.ai.*) | Manual | Manual |
| Global Edge | Yes (300+ cities) | Regional | Regional |
| Cost Model | Pay per step | Server + worker | Per state transition |
| Human-in-Loop | Native waitForEvent | Signal/Query | Callback tasks |
| Cold Start | ~0ms (edge) | ~100ms | ~100-500ms |

---

## Benefits

| Benefit | How It's Achieved |
|---------|------------------|
| **Readable Code** | Domain-driven `$.Domain(ctx).method()` syntax |
| **True Durability** | Every call checkpointed by Cloudflare Workflows |
| **Automatic Retries** | Configurable per-method with backoff strategies |
| **Security** | User handlers sandboxed in ai-evaluate V8 isolates |
| **AI-Native** | Full AI SDK available within every handler |
| **Zero-Cost Waits** | Hibernation during sleep/waitForEvent |
| **Global Scale** | Cloudflare edge network (300+ cities) |
| **Type Safety** | Full TypeScript throughout |
| **Testable** | Mock contexts, step modifiers, fast local tests |

---

## Example: Full Startup Workflow

```typescript
import { Workflow, Domain } from 'ai-workflows'

// Domains
export const Roadmap = Domain('Roadmap', { /* ... */ })
export const Tasks = Domain('Tasks', { /* ... */ })
export const Sprint = Domain('Sprint', { /* ... */ })
export const Standup = Domain('Standup', { /* ... */ })
export const Retro = Domain('Retro', { /* ... */ })

// The workflow
export const SprintWorkflow = Workflow('sprint-cycle', async ($, startup) => {
  // AI prioritizes the backlog
  const priorities = await $.Roadmap(startup).prioritizeBacklog()

  // Create sprint with top items
  const sprint = await $.Sprint(startup).create({
    items: priorities.slice(0, 10),
    duration: '2 weeks'
  })

  // Schedule daily standups
  await $.Standup(startup.team).scheduleDaily({
    time: '9am',
    channel: startup.slackChannel
  })

  // Wait for sprint completion (hibernates for 2 weeks)
  const sprintResult = await $.waitFor('sprint-complete', {
    timeout: '2 weeks',
    type: 'sprint-ended'
  })

  // Generate AI-powered retrospective
  const retro = await $.Retro(startup).generate({
    sprint: sprintResult,
    teamFeedback: await $.Standup(startup.team).aggregateFeedback()
  })

  // Start next sprint
  await $.Sprint(startup).planNext({
    previousRetro: retro,
    remainingItems: priorities.slice(10)
  })

  return { sprint: sprintResult, retro }
})
```

This workflow:
1. **Prioritizes backlog** using AI analysis
2. **Creates a sprint** with selected items
3. **Schedules daily standups** automatically
4. **Hibernates for 2 weeks** waiting for sprint completion (zero compute cost)
5. **Generates retrospective** using AI insights
6. **Plans next sprint** based on learnings

All with full durability, automatic retries, and secure sandboxed execution.
