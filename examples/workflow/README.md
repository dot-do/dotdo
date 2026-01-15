# workflow.example.com.ai

Durable workflow orchestration for dotdo v2.

## The Problem

Building business processes that survive failures is hard. You need Temporal, Step Functions, or similar infrastructure. More services to deploy, more SDKs to learn.

## The Solution

dotdo's WorkflowContext (`$`) gives you durable execution built into every Durable Object. No external services. Just `$.do` for durable steps.

```typescript
import { $, DO } from 'dotdo'

class OrderWorkflow extends DO {
  async processOrder(order: Order) {

    // Each $.do step is durable - survives crashes and restarts
    const validated = await $.do(() => this.validateOrder(order), { stepId: 'validate' })
    const payment = await $.do(() => this.chargePayment(order), { stepId: 'charge' })
    const fulfilled = await $.do(() => this.fulfillOrder(order), { stepId: 'fulfill' })

    return { validated, payment, fulfilled }
  }
}
```

## Durability Levels

```typescript
$.send('Order.placed', order)                                    // Fire-and-forget
await $.try(() => sendEmail(user), { timeout: 5000 })            // Single attempt
await $.do(() => processPayment(order), { stepId: 'payment' })   // Durable with retries
```

## Compensation Pattern

```typescript
async bookTrip(trip: Trip) {
  const compensations: Array<() => Promise<void>> = []

  try {
    const flight = await $.do(() => this.bookFlight(trip), { stepId: 'flight' })
    compensations.push(() => this.cancelFlight(flight.id))

    const hotel = await $.do(() => this.bookHotel(trip), { stepId: 'hotel' })
    compensations.push(() => this.cancelHotel(hotel.id))

    const car = await $.do(() => this.bookCar(trip), { stepId: 'car' })
    compensations.push(() => this.cancelCar(car.id))

    return { flight, hotel, car, status: 'confirmed' }
  } catch (error) {
    // Rollback in reverse order
    for (const compensate of compensations.reverse()) {
      await $.do(compensate, { stepId: `compensate-${compensations.length}` })
    }
    throw error
  }
}
```

## Human Approval Gates

Workflows pause indefinitely for human input. The DO hibernates (zero cost) until approval arrives.

```typescript
import { $, DO } from 'dotdo'

class ExpenseWorkflow extends DO {
  async submitExpense(expense: Expense) {

    // Auto-approve under $100
    if (expense.amount < 100) {
      return this.processApproval(expense)
    }

    // Queue for human approval (workflow hibernates here)
    const approval = await this.approvalFlow.requestApproval({
      type: 'expense',
      title: `Expense: ${expense.description}`,
      amount: expense.amount,
      requestedBy: expense.submitter,
      approvers: [expense.manager],
    })

    if (approval.status === 'approved') {
      return this.processApproval(expense)
    }
    return { status: 'rejected', reason: approval.rejectionReason }
  }
}
```

## Multi-Level Approval

```typescript
const approval = await this.approvalFlow.requestApproval({
  type: 'purchase',
  title: `PO: ${po.item}`,
  amount: po.amount,
  requestedBy: po.requester,
  approvers: ['manager', 'director', 'vp'],  // Chain
  deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  priority: po.amount > 10000 ? 'high' : 'normal',
})
```

## Scheduled Workflows

```typescript
$.every.Monday.at9am(() => this.generateWeeklyReport())
$.every.day.at('6pm')(() => this.sendDailySummary())
$.every(15).minutes(() => this.checkHealthStatus())
```

## Event-Driven

```typescript
$.on.Order.placed(async (event) => {
  await $.do(() => this.sendConfirmation(event.data), { stepId: 'confirm' })
})

$.on.Payment.failed(async (event) => {
  await $.do(() => this.retryPayment(event.data), { stepId: 'retry' })
})

$.on.*.failed(async (event) => {
  await $.do(() => this.logFailure(event), { stepId: 'log-failure' })
})
```

## Cascade Execution

Try automation first, fall back to humans only when needed:

```typescript
const result = await $.cascade({
  task: 'categorize-expense',
  tiers: {
    code: () => this.ruleBasedCategorize(expense),      // Instant
    generative: () => this.aiCategorize(expense),       // ~1s
    agentic: () => this.agentCategorize(expense),       // ~10s
    human: () => this.queueForReview(expense),          // Minutes+
  },
  confidenceThreshold: 0.9,
})
```

## Cross-DO Orchestration

```typescript
const inventory = await $.Inventory(order.warehouseId).reserve(order.items)
const payment = await $.Payment(order.customerId).charge(order.total)
const shipping = await $.Shipping(order.id).schedule(order.address)
```

## Promise Pipelining

Promises are stubs. Chain freely, await only when needed.

```typescript
// Sequential - unnecessary blocking
const user = await $.User(id)
const profile = await user.getProfile()
const email = await profile.email

// Pipelined - single round-trip
const email = await $.User(id).getProfile().email

// Fire and forget - no await for side effects
$.User(id).notify({ type: 'order_shipped' })
$.Order(orderId).markFulfilled()
```

Only `await` at exit points when you actually need the value. Side effects like notifications and status updates don't require waiting for completion.

## Comparison

| Feature | Temporal/Step Functions | dotdo |
|---------|------------------------|-------|
| Deployment | Separate service | Built into DO |
| State | External database | SQLite in DO |
| Cost model | Per execution | Zero when idle |
| Human tasks | External queue | Native hibernation |

## Next Steps

1. Extend `DO` for your domain
2. Define steps with `$.do` for durability
3. Add human gates where needed
4. Deploy as a standard Cloudflare Worker
