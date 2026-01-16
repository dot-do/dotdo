# workflow.example.com.ai

Durable workflow orchestration for dotdo v2.

## The Problem

Building business processes that survive failures is hard. You need Temporal, Step Functions, or similar infrastructure. More services to deploy, more SDKs to learn.

## The Solution

dotdo gives you durable execution built into every Durable Object. No external services. Just `this.do` for durable steps.

```typescript
import { DO } from 'dotdo'

export default DO.extend({
  async processOrder(order: Order) {
    // Each this.do step is durable - survives crashes and restarts
    const validated = await this.do(() => this.validateOrder(order), { stepId: 'validate' })
    const payment = await this.do(() => this.chargePayment(order), { stepId: 'charge' })
    const fulfilled = await this.do(() => this.fulfillOrder(order), { stepId: 'fulfill' })

    return { validated, payment, fulfilled }
  }
})
```

## Durability Levels

```typescript
this.send('Order.placed', order)                                    // Fire-and-forget
await this.try(() => sendEmail(user), { timeout: 5000 })            // Single attempt
await this.do(() => processPayment(order), { stepId: 'payment' })   // Durable with retries
```

## Compensation Pattern

```typescript
async bookTrip(trip: Trip) {
  const compensations: Array<() => Promise<void>> = []

  try {
    const flight = await this.do(() => this.bookFlight(trip), { stepId: 'flight' })
    compensations.push(() => this.cancelFlight(flight.id))

    const hotel = await this.do(() => this.bookHotel(trip), { stepId: 'hotel' })
    compensations.push(() => this.cancelHotel(hotel.id))

    const car = await this.do(() => this.bookCar(trip), { stepId: 'car' })
    compensations.push(() => this.cancelCar(car.id))

    return { flight, hotel, car, status: 'confirmed' }
  } catch (error) {
    // Rollback in reverse order
    for (const compensate of compensations.reverse()) {
      await this.do(compensate, { stepId: `compensate-${compensations.length}` })
    }
    throw error
  }
}
```

## Human Approval Gates

Workflows pause indefinitely for human input. The DO hibernates (zero cost) until approval arrives.

```typescript
import { DO } from 'dotdo'

export default DO.extend({
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
})
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
this.every.Monday.at('9am')(() => this.generateWeeklyReport())
this.every.day.at('6pm')(() => this.sendDailySummary())
this.every(15).minutes(() => this.checkHealthStatus())
```

## Event-Driven

```typescript
this.on.Order.placed(async (event) => {
  await this.do(() => this.sendConfirmation(event.data), { stepId: 'confirm' })
})

this.on.Payment.failed(async (event) => {
  await this.do(() => this.retryPayment(event.data), { stepId: 'retry' })
})

this.on.*.failed(async (event) => {
  await this.do(() => this.logFailure(event), { stepId: 'log-failure' })
})
```

## Cascade Execution

Try automation first, fall back to humans only when needed:

```typescript
const result = await this.cascade({
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
const inventory = await this.Inventory(order.warehouseId).reserve(order.items)
const payment = await this.Payment(order.customerId).charge(order.total)
const shipping = await this.Shipping(order.id).schedule(order.address)
```

## Promise Pipelining (Cap'n Web)

True Cap'n Proto-style pipelining: method calls on stubs batch until `await`, then resolve in a single round-trip.

```typescript
// Sequential - unnecessary blocking
const user = await this.User(id)
const profile = await user.profile
const email = await profile.email

// Pipelined - single round-trip for chained access
const email = await this.User(id).profile.email

// Fire and forget - no await for side effects
this.User(id).notify({ type: 'order_shipped' })
this.Order(orderId).markFulfilled()
```

`this.Noun(id)` returns a pipelined stub. Property access and method calls are recorded, then executed server-side on `await`. Side effects like notifications don't require waiting.

## Comparison

| Feature | Temporal/Step Functions | dotdo |
|---------|------------------------|-------|
| Deployment | Separate service | Built into DO |
| State | External database | SQLite in DO |
| Cost model | Per execution | Zero when idle |
| Human tasks | External queue | Native hibernation |

## Next Steps

1. Extend `DO` for your domain
2. Define steps with `this.do` for durability
3. Add human gates where needed
4. Deploy as a standard Cloudflare Worker
