# Cross-DO Transaction Patterns

When coordinating operations across multiple Durable Objects, you need transaction safety patterns. dotdo provides two approaches: **Saga** for eventual consistency and **Two-Phase Commit (2PC)** for atomic operations.

> **Related:** [$ Context API](../api/workflow-context.md) | [Security Best Practices](../security/best-practices.md) | [API Quick Reference](../API.md)

## Choosing Between Saga and 2PC

| Aspect | CrossDOSaga | TwoPhaseCommit |
|--------|-------------|----------------|
| Consistency | Eventual | Strong |
| Availability | High | Lower (blocking) |
| Latency | Lower | Higher |
| Complexity | Medium | Higher |
| Failure Recovery | Compensation | Rollback |
| Best For | Long-running flows | Atomic transfers |

### When to Use CrossDOSaga

- E-commerce checkout flows
- User onboarding workflows
- Multi-service integrations
- Long-running business processes
- When partial completion is acceptable with compensation

### When to Use TwoPhaseCommit

- Financial transfers between accounts
- Inventory reservations that must be atomic
- Critical data consistency requirements
- Short-lived, coordinated operations

## CrossDOSaga

The Saga pattern executes steps sequentially and compensates (undoes) completed steps if a later step fails.

### Basic Usage

```typescript
import { CrossDOSaga, createSaga } from 'dotdo/objects/CrossDOTransaction'

interface Order {
  id: string
  items: string[]
  amount: number
}

interface Reservation {
  reservationId: string
  items: string[]
}

interface PaymentResult {
  transactionId: string
}

interface Shipment {
  trackingNumber: string
}

// Create a checkout saga
const checkoutSaga = createSaga<Order, Shipment>()
  .addStep({
    name: 'reserveInventory',
    targetDO: 'InventoryDO',
    execute: async (order: Order): Promise<Reservation> => {
      // Reserve items in inventory
      return { reservationId: 'res-123', items: order.items }
    },
    compensate: async (reservation: Reservation): Promise<void> => {
      // Release the reservation if a later step fails
      console.log(`Releasing reservation: ${reservation.reservationId}`)
    }
  })
  .addStep({
    name: 'processPayment',
    targetDO: 'PaymentDO',
    execute: async (reservation: Reservation): Promise<PaymentResult> => {
      // Charge the customer
      return { transactionId: 'tx-456' }
    },
    compensate: async (payment: PaymentResult): Promise<void> => {
      // Refund if shipping fails
      console.log(`Refunding transaction: ${payment.transactionId}`)
    },
    retry: {
      maxAttempts: 3,
      backoffMs: 100
    }
  })
  .addStep({
    name: 'createShipment',
    targetDO: 'ShippingDO',
    execute: async (payment: PaymentResult): Promise<Shipment> => {
      // Create shipping label
      return { trackingNumber: 'TRACK-789' }
    }
    // No compensation needed - shipping is the final step
  })

// Execute the saga
const order: Order = { id: 'ord-123', items: ['item-1', 'item-2'], amount: 99.99 }
const result = await checkoutSaga.execute(order, {
  idempotencyKey: order.id
})

if (result.success) {
  console.log(`Order shipped: ${result.result?.trackingNumber}`)
} else {
  console.log(`Order failed: ${result.error?.message}`)
  console.log(`Compensated: ${result.compensated}`)
}
```

### Saga with Timeout and Observability

```typescript
import {
  CrossDOSaga,
  ConsoleTracer,
  MetricsCollector
} from 'dotdo/objects/CrossDOTransaction'

interface Input {
  userId: string
  data: string
}

interface StepOneResult {
  processed: boolean
}

interface StepTwoResult {
  completed: boolean
}

// Create tracer for debugging
const tracer = new ConsoleTracer({ prefix: '[Checkout]' })

// Or collect metrics
const metrics = new MetricsCollector({ maxSize: 1000 })

const saga = new CrossDOSaga<Input, StepTwoResult>({ tracer: metrics })

saga.addStep({
  name: 'step1',
  execute: async (input: Input): Promise<StepOneResult> => {
    return { processed: true }
  },
  timeout: 5000  // 5 second timeout
})

saga.addStep({
  name: 'step2',
  execute: async (prev: StepOneResult): Promise<StepTwoResult> => {
    return { completed: true }
  },
  compensate: async (result: StepTwoResult): Promise<void> => {
    console.log('Compensating step2')
  },
  compensationPriority: 10  // Higher priority = compensate first
})

const result = await saga.execute(
  { userId: 'user-1', data: 'test' },
  {
    timeout: 30000,
    continueCompensationOnError: true,
    collectMetrics: true
  }
)

// Access metrics
const summary = metrics.getSummary()
console.log(`Total transactions: ${summary.total}`)
console.log(`Success rate: ${(summary.successful / summary.total * 100).toFixed(1)}%`)
```

### Saga Result Structure

```typescript
interface SagaResult<T> {
  success: boolean
  result?: T                    // Final result if successful
  error?: Error                 // Error if failed
  steps: SagaStepResult[]       // Per-step results
  compensated: boolean          // Whether compensation ran
  compensationErrors?: Error[]  // Errors during compensation
  duration: number              // Total duration in ms
  metrics?: TransactionMetrics  // Observability data
}

interface SagaStepResult {
  name: string
  success: boolean
  result?: unknown
  error?: Error
  compensated: boolean
  duration: number
}
```

## TwoPhaseCommit

2PC provides stronger consistency by ensuring all participants either commit or rollback atomically.

### Basic Usage

```typescript
import {
  TwoPhaseCommit,
  create2PC,
  TwoPhaseParticipant
} from 'dotdo/objects/CrossDOTransaction'

// Define participants
const sourceAccount: TwoPhaseParticipant = {
  id: 'source-account',
  prepare: async (): Promise<boolean> => {
    // Lock funds and validate balance
    console.log('Locking source account')
    return true  // Return false to abort
  },
  commit: async (): Promise<void> => {
    // Deduct funds
    console.log('Deducting from source')
  },
  rollback: async (): Promise<void> => {
    // Release lock
    console.log('Releasing source lock')
  }
}

const targetAccount: TwoPhaseParticipant = {
  id: 'target-account',
  prepare: async (): Promise<boolean> => {
    // Validate account exists
    console.log('Validating target account')
    return true
  },
  commit: async (): Promise<void> => {
    // Add funds
    console.log('Adding to target')
  },
  rollback: async (): Promise<void> => {
    // Nothing to rollback
    console.log('Rolling back target')
  }
}

// Create and execute 2PC
const transfer = create2PC({ timeout: 10000 })
  .addParticipant(sourceAccount)
  .addParticipant(targetAccount)

const result = await transfer.execute()

if (result.success) {
  console.log('Transfer completed')
} else {
  console.log(`Transfer failed in ${result.phase} phase: ${result.error?.message}`)
}
```

### 2PC with Parallel Prepare

```typescript
import { TwoPhaseCommit, ConsoleTracer } from 'dotdo/objects/CrossDOTransaction'

const tracer = new ConsoleTracer()

// Parallel prepare reduces latency
const tpc = new TwoPhaseCommit({
  timeout: 30000,
  parallelPrepare: true,  // Default: true
  tracer
})

// Add many participants - prepare runs in parallel
for (let i = 0; i < 5; i++) {
  tpc.addParticipant({
    id: `participant-${i}`,
    prepare: async () => {
      await new Promise(r => setTimeout(r, 100))  // Simulate network
      return true
    },
    commit: async () => {
      console.log(`Committing participant-${i}`)
    },
    rollback: async () => {
      console.log(`Rolling back participant-${i}`)
    }
  })
}

const result = await tpc.execute({
  parallelPrepare: true,
  collectMetrics: true
})

// Parallel prepare: ~100ms total
// Sequential prepare: ~500ms total
console.log(`Duration: ${result.duration}ms`)
```

### 2PC Result Structure

```typescript
interface TwoPhaseResult {
  success: boolean
  phase: 'prepare' | 'commit' | 'rollback' | 'complete'
  participantResults: Map<string, ParticipantResult>
  error?: Error
  metrics?: TransactionMetrics
  duration: number
}

interface ParticipantResult {
  prepared: boolean
  committed: boolean
  error?: Error
}
```

## Idempotency

Both patterns support idempotency keys to prevent duplicate execution.

### In-Memory Store (Testing)

```typescript
import { IdempotencyKeyManager } from 'dotdo/objects/CrossDOTransaction'

const store = new IdempotencyKeyManager()

// Check and store
const exists = await store.has('order-123')
if (!exists) {
  await store.set('order-123', { processed: true }, 3600000)  // 1 hour TTL
}
```

### SQLite Store (Production)

```typescript
import {
  SqliteIdempotencyKeyManager,
  createPersistentIdempotencyStore
} from 'dotdo/objects/CrossDOTransaction'
import { DurableObject } from 'cloudflare:workers'

class MyDO extends DurableObject {
  private idempotencyStore: SqliteIdempotencyKeyManager

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // Persistent storage that survives hibernation
    this.idempotencyStore = createPersistentIdempotencyStore(
      ctx.storage.sql,
      { defaultTtlMs: 24 * 60 * 60 * 1000 }  // 24 hours
    )
  }

  async processOrder(orderId: string): Promise<void> {
    // Check if already processed
    const existing = await this.idempotencyStore.get<{ status: string }>(orderId)
    if (existing) {
      console.log(`Order ${orderId} already processed: ${existing.status}`)
      return
    }

    // Process and store result
    const result = { status: 'completed', timestamp: Date.now() }
    await this.idempotencyStore.set(orderId, result)
  }

  // Call periodically (e.g., in alarm handler)
  async cleanupExpiredKeys(): Promise<void> {
    const deleted = await this.idempotencyStore.cleanupExpired()
    console.log(`Cleaned up ${deleted} expired idempotency keys`)
  }
}

interface Env {
  MY_DO: DurableObjectNamespace
}
```

## Helper Utilities

### Cross-DO Call with Timeout

```typescript
import { crossDOCallWithTimeout } from 'dotdo/objects/CrossDOTransaction'

interface InventoryResult {
  available: boolean
  quantity: number
}

const checkInventory = async (): Promise<InventoryResult> => {
  // Simulated inventory check
  return { available: true, quantity: 10 }
}

const result = await crossDOCallWithTimeout<InventoryResult>(
  checkInventory,
  5000,        // 5 second timeout
  'InventoryDO'  // Target DO name (for error context)
)
```

### Cross-DO Call with Retry

```typescript
import { crossDOCallWithRetry } from 'dotdo/objects/CrossDOTransaction'

interface ReservationResult {
  id: string
  success: boolean
}

const makeReservation = async (): Promise<ReservationResult> => {
  // Simulated reservation
  return { id: 'res-123', success: true }
}

const result = await crossDOCallWithRetry<ReservationResult>(
  makeReservation,
  {
    maxAttempts: 3,
    backoffMs: 100,
    timeoutMs: 5000,
    targetDO: 'ReservationDO'
  }
)
```

### Batch Cross-DO Calls

```typescript
import { batchCrossDOCalls, BatchCallResult } from 'dotdo/objects/CrossDOTransaction'

interface ServiceResult {
  status: string
}

const calls = [
  async (): Promise<ServiceResult> => ({ status: 'ok' }),
  async (): Promise<ServiceResult> => ({ status: 'ok' }),
  async (): Promise<ServiceResult> => ({ status: 'ok' })
]

const results: BatchCallResult<ServiceResult> = await batchCrossDOCalls(calls, {
  timeoutMs: 5000,
  maxConcurrency: 10,  // Limit parallel calls
  stopOnError: false   // Continue on individual failures
})

console.log(`Success: ${results.successCount}/${results.results.length}`)
console.log(`Duration: ${results.duration}ms`)

for (const r of results.results) {
  if (r.success) {
    console.log(`Call ${r.index}: ${r.result?.status}`)
  } else {
    console.log(`Call ${r.index} failed: ${r.error?.message}`)
  }
}
```

## Best Practices

### 1. Design for Idempotency

```typescript
interface OrderData {
  orderId: string
  items: string[]
}

interface ProcessResult {
  success: boolean
  orderId: string
}

// Use natural keys for idempotency
const saga = createSaga<OrderData, ProcessResult>()

const result = await saga.execute(order, {
  idempotencyKey: `order:${order.orderId}`  // Natural business key
})
```

### 2. Prioritize Compensation

```typescript
// Financial compensations should run first
saga.addStep({
  name: 'chargeCard',
  execute: async (input) => ({ chargeId: 'ch-123' }),
  compensate: async (result) => {
    // Refund runs before inventory release
    await refundCharge(result.chargeId)
  },
  compensationPriority: 100  // High priority
})

saga.addStep({
  name: 'reserveInventory',
  execute: async (input) => ({ reservationId: 'res-456' }),
  compensate: async (result) => {
    await releaseInventory(result.reservationId)
  },
  compensationPriority: 50  // Lower priority
})

async function refundCharge(chargeId: string): Promise<void> {
  console.log(`Refunding ${chargeId}`)
}

async function releaseInventory(reservationId: string): Promise<void> {
  console.log(`Releasing ${reservationId}`)
}
```

### 3. Use Observability

```typescript
import { MetricsCollector, CrossDOSaga } from 'dotdo/objects/CrossDOTransaction'

const metrics = new MetricsCollector()

const saga = new CrossDOSaga({ tracer: metrics })

// After execution, analyze
const summary = metrics.getSummary()
if (summary.failed > summary.total * 0.05) {
  console.warn('Failure rate above 5% threshold')
}
```

### 4. Handle Compensation Failures

```typescript
const result = await saga.execute(input, {
  continueCompensationOnError: true  // Don't stop on compensation failure
})

if (result.compensationErrors && result.compensationErrors.length > 0) {
  // Log for manual intervention
  for (const err of result.compensationErrors) {
    console.error('Compensation failed:', err)
  }
  await alertOps('Manual intervention required', result)
}

async function alertOps(message: string, context: unknown): Promise<void> {
  console.error(message, context)
}
```

## Related Documentation

- [$ Context API](../api/workflow-context.md) - Core workflow context methods
- [API Quick Reference](../API.md) - Quick reference for all APIs
- [Security Best Practices](../security/best-practices.md) - Input validation and rate limiting
- [Getting Started](../getting-started.md) - Basic setup and usage

---

[Back to Documentation Index](../README.md)
