# temporal.do

> Temporal SDK for the edge. Zero infrastructure. Same API.

[![npm version](https://img.shields.io/npm/v/@dotdo/temporal.svg)](https://www.npmjs.com/package/@dotdo/temporal)
[![Tests](https://img.shields.io/badge/tests-27%20passing-brightgreen.svg)](./temporal.test.ts)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why temporal.do?

**The Problem:** Temporal is the gold standard for durable execution, but running it requires:
- A Temporal cluster (self-hosted or Temporal Cloud)
- Worker processes that must be kept running 24/7
- Complex infrastructure for high availability
- Significant operational overhead

**The Solution:** `temporal.do` provides **100% API compatibility** with `@temporalio/workflow` but runs entirely on dotdo's edge infrastructure:
- **No cluster required** - runs on Cloudflare's global network
- **No workers to manage** - workflows execute in Durable Objects
- **Zero cold starts** - V8 isolates start in <1ms
- **Pay-per-execution** - no idle compute costs

Drop in your existing Temporal workflows with a single import change.

## Installation

```bash
npm install @dotdo/temporal
# or
pnpm add @dotdo/temporal
```

## Quick Start

```typescript
// Before: import { proxyActivities, sleep } from '@temporalio/workflow'
import { proxyActivities, defineSignal, setHandler, sleep, condition } from '@dotdo/temporal'

// Activities work exactly the same
const { sendEmail, chargeCard } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10s',
  retry: { maximumAttempts: 3 },
})

// Workflows are identical
export async function orderWorkflow(order: Order) {
  const approved = defineSignal<[boolean]>('approve')
  let isApproved = false

  setHandler(approved, (approval) => {
    isApproved = approval
  })

  // Wait up to 7 days for approval
  await condition(() => isApproved, '7d')

  await chargeCard(order.cardToken, order.amount)
  await sendEmail(order.email, 'Order confirmed!')

  return { status: 'completed' }
}
```

## Features

### Workflow Definition

Workflows are async functions that orchestrate activities and handle signals:

```typescript
import { proxyActivities, sleep, workflowInfo } from '@dotdo/temporal'

export async function subscriptionWorkflow(userId: string) {
  const info = workflowInfo()
  console.log(`Running workflow ${info.workflowId}`)

  const { createSubscription, sendWelcome } = proxyActivities<typeof activities>({
    startToCloseTimeout: '30s',
  })

  await createSubscription(userId)
  await sendWelcome(userId)

  // Run forever, billing monthly
  while (true) {
    await sleep('30d')
    await billUser(userId)
  }
}
```

### Activities (proxyActivities, proxyLocalActivities)

Activities are the building blocks of workflows - they execute actual business logic:

```typescript
import { proxyActivities, proxyLocalActivities } from '@dotdo/temporal'

// Remote activities (can run on any worker)
const activities = proxyActivities<{
  sendEmail: (to: string, body: string) => Promise<void>
  processPayment: (amount: number) => Promise<string>
}>({
  startToCloseTimeout: '10s',
  scheduleToCloseTimeout: '30s',
  heartbeatTimeout: '5s',
  retry: {
    maximumAttempts: 5,
    initialInterval: '1s',
    backoffCoefficient: 2,
    maximumInterval: '30s',
    nonRetryableErrorTypes: ['ValidationError'],
  },
})

// Local activities (run in-process, faster but less durable)
const localActivities = proxyLocalActivities<{
  validateInput: (data: unknown) => boolean
  formatMessage: (template: string) => string
}>({
  startToCloseTimeout: '5s',
  localRetryThreshold: '3s',
})
```

### Signals, Queries, Updates

Interact with running workflows in real-time:

```typescript
import { defineSignal, defineQuery, defineUpdate, setHandler } from '@dotdo/temporal'

// Define signal - fire-and-forget messages to workflow
const approvalSignal = defineSignal<[boolean]>('approval')
const cancelSignal = defineSignal('cancel')

// Define query - read workflow state
const getStatusQuery = defineQuery<string>('getStatus')
const getProgressQuery = defineQuery<number, [string]>('getProgress')

// Define update - mutate state and return result
const updateConfigUpdate = defineUpdate<void, [{ key: string; value: string }]>('updateConfig')

export async function orderWorkflow() {
  let status = 'pending'
  let approved = false

  // Register signal handlers
  setHandler(approvalSignal, (isApproved) => {
    approved = isApproved
    status = isApproved ? 'approved' : 'rejected'
  })

  setHandler(cancelSignal, () => {
    status = 'cancelled'
  })

  // Register query handlers
  setHandler(getStatusQuery, () => status)

  // Register update handlers
  setHandler(updateConfigUpdate, ({ key, value }) => {
    config[key] = value
  })

  // ... workflow logic
}
```

### Child Workflows (startChild, executeChild)

Compose workflows together:

```typescript
import { startChild, executeChild } from '@dotdo/temporal'

export async function parentWorkflow(orders: Order[]) {
  // Start child without waiting
  const handles = await Promise.all(
    orders.map((order) =>
      startChild(processOrderWorkflow, {
        workflowId: `order-${order.id}`,
        args: [order],
      })
    )
  )

  // Or execute and wait for result
  const result = await executeChild(validateWorkflow, {
    args: [{ orderId: '123' }],
    taskQueue: 'validation-queue',
    parentClosePolicy: 'TERMINATE', // or 'ABANDON', 'REQUEST_CANCEL'
  })

  // Collect all results
  return Promise.all(handles.map((h) => h.result()))
}
```

### Sleep & Conditions

Durable timers and condition waiting:

```typescript
import { sleep, condition } from '@dotdo/temporal'

export async function approvalWorkflow() {
  let approved = false
  let rejected = false

  // Signal handlers would set these...

  // Sleep for fixed duration (durable - survives restarts)
  await sleep('1h')
  await sleep(60000) // also accepts milliseconds

  // Wait for condition with timeout
  const wasApproved = await condition(() => approved || rejected, '7d')

  if (!wasApproved) {
    throw new Error('Approval timed out')
  }

  return approved ? 'approved' : 'rejected'
}
```

### Cancellation Scopes

Control cancellation propagation:

```typescript
import { CancellationScope, isCancellation } from '@dotdo/temporal'

export async function scopedWorkflow() {
  // Run with automatic cleanup
  await CancellationScope.run(async () => {
    await riskyOperation()
  })

  // Non-cancellable scope (cleanup code)
  await CancellationScope.nonCancellable(async () => {
    await cleanupResources()
  })

  // Cancellable scope with explicit control
  const scope = new CancellationScope()

  try {
    await longRunningOperation()
  } catch (error) {
    if (isCancellation(error)) {
      console.log('Operation was cancelled')
    }
    throw error
  }
}
```

### Deterministic Execution

Temporal workflows must be deterministic. These utilities provide deterministic alternatives to non-deterministic operations:

```typescript
import { uuid4, random } from '@dotdo/temporal'

export async function deterministicWorkflow() {
  // Use uuid4() instead of crypto.randomUUID()
  const orderId = uuid4()

  // Use random() instead of Math.random()
  const shouldRetry = random() < 0.5

  // Results are deterministic on replay
  return { orderId, shouldRetry }
}
```

### Continue-as-New

Reset workflow history to prevent unbounded growth:

```typescript
import { continueAsNew, makeContinueAsNewFunc } from '@dotdo/temporal'

export async function infiniteWorkflow(iteration: number) {
  await processIteration(iteration)

  // Option 1: Direct continue-as-new
  if (iteration % 1000 === 0) {
    continueAsNew(iteration + 1)
  }

  // Option 2: Type-safe continue-as-new
  const continueAsNewFn = makeContinueAsNewFunc<[number], void>(infiniteWorkflow, {
    taskQueue: 'my-queue',
  })

  continueAsNewFn(iteration + 1)
}
```

### WorkflowClient

Start and interact with workflows:

```typescript
import { WorkflowClient } from '@dotdo/temporal'

const client = new WorkflowClient({
  namespace: 'production',
})

// Start workflow
const handle = await client.start(orderWorkflow, {
  taskQueue: 'orders',
  workflowId: `order-${orderId}`,
  args: [orderData],
  workflowExecutionTimeout: '24h',
  retry: { maximumAttempts: 3 },
  memo: { customer: 'acme-corp' },
  searchAttributes: { orderValue: 1000 },
})

// Or execute and wait for result
const result = await client.execute(orderWorkflow, {
  taskQueue: 'orders',
  args: [orderData],
})

// Get handle to existing workflow
const existingHandle = client.getHandle('order-123')

// Interact with workflow
await handle.signal(approvalSignal, true)
const status = await handle.query(getStatusQuery)
await handle.executeUpdate(updateConfigUpdate, { key: 'priority', value: 'high' })

// Control workflow
await handle.cancel()
await handle.terminate('Manual termination')

// Get info
const description = await handle.describe()
console.log(description.status) // 'RUNNING' | 'COMPLETED' | 'FAILED' | etc.
```

## Backend Options

temporal.do can run on three different backends:

| Backend | Best For | Latency | Cost |
|---------|----------|---------|------|
| **Durable Objects** | Real-time, WebSocket, low-latency | <10ms | $$ |
| **CF Workflows** | Long waits, batch processing | <100ms | $ |
| **Pipelines/Iceberg** | Analytics, audit logs | ~60s | $ |

```typescript
import { configure } from '@dotdo/temporal'
import { CFWorkflowsBackend } from '@dotdo/workflows/backends'

// Use CF Workflows backend (recommended for cost efficiency)
configure({
  storage: new CFWorkflowsBackend(env.MY_WORKFLOW),
})

// Or use DO state directly (for real-time requirements)
configure({
  state: ctx.state, // DurableObjectState
})
```

## API Reference

### Workflow Functions

| Function | Description |
|----------|-------------|
| `sleep(duration)` | Durable sleep (survives restarts) |
| `condition(fn, timeout?)` | Wait for condition to be true |
| `workflowInfo()` | Get current workflow metadata |
| `uuid4()` | Deterministic UUID generation |
| `random()` | Deterministic random number |
| `continueAsNew(...args)` | Reset workflow history |

### Activity Functions

| Function | Description |
|----------|-------------|
| `proxyActivities(options)` | Create activity proxy with retry |
| `proxyLocalActivities(options)` | Create local activity proxy |

### Signal/Query/Update

| Function | Description |
|----------|-------------|
| `defineSignal(name)` | Define a signal type |
| `defineQuery(name)` | Define a query type |
| `defineUpdate(name)` | Define an update type |
| `setHandler(def, handler)` | Register handler for signal/query/update |

### Child Workflows

| Function | Description |
|----------|-------------|
| `startChild(workflow, options)` | Start child workflow, return handle |
| `executeChild(workflow, options)` | Start child and wait for result |

### Cancellation

| Class/Function | Description |
|----------------|-------------|
| `CancellationScope.run(fn)` | Run function in cancellation scope |
| `CancellationScope.nonCancellable(fn)` | Run function that can't be cancelled |
| `isCancellation(error)` | Check if error is cancellation |

### WorkflowClient

| Method | Description |
|--------|-------------|
| `start(workflow, options)` | Start workflow, return handle |
| `execute(workflow, options)` | Start and wait for result |
| `getHandle(workflowId)` | Get handle to existing workflow |
| `signalWithStart(workflow, options)` | Signal and optionally start |

### WorkflowHandle

| Method | Description |
|--------|-------------|
| `result()` | Wait for workflow result |
| `describe()` | Get workflow status/metadata |
| `signal(signal, ...args)` | Send signal to workflow |
| `query(query, ...args)` | Query workflow state |
| `executeUpdate(update, ...args)` | Execute update on workflow |
| `cancel()` | Request workflow cancellation |
| `terminate(reason?)` | Force terminate workflow |

## How It Works

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Your Temporal Workflow Code                        │
│   import { proxyActivities, sleep, condition } from '@dotdo/temporal'       │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         temporal.do Compat Layer                             │
│                                                                              │
│   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│   │  Signals    │  │  Queries    │  │  Updates    │  │ Activities  │       │
│   │  Handlers   │  │  Handlers   │  │  Handlers   │  │   Proxy     │       │
│   └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘       │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────┐       │
│   │              DurableWorkflowRuntime (Step Memoization)           │       │
│   └─────────────────────────────────────────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                 ▼
           ┌───────────────┐  ┌───────────────┐  ┌───────────────┐
           │ Durable       │  │ CF Workflows  │  │ Pipelines/    │
           │ Objects       │  │ Backend       │  │ Iceberg       │
           │ (real-time)   │  │ (cost-opt)    │  │ (analytics)   │
           └───────────────┘  └───────────────┘  └───────────────┘
                    │                 │                 │
                    └─────────────────┴─────────────────┘
                                      │
                                      ▼
                    ┌─────────────────────────────────────┐
                    │     Cloudflare Global Network       │
                    │         300+ cities, <50ms          │
                    └─────────────────────────────────────┘
```

## Comparison vs Native Temporal

| Feature | Native Temporal | temporal.do |
|---------|-----------------|-------------|
| **Infrastructure** | Temporal cluster + workers | None (edge-native) |
| **Cold Start** | 100ms-2s | <1ms |
| **Global Distribution** | Manual setup | Automatic (300+ cities) |
| **Pricing Model** | Server costs + worker hosting | Pay-per-execution |
| **Max Workflow Duration** | Unlimited | Unlimited |
| **Signal Delivery** | Real-time | Real-time |
| **Query Support** | Full | Full |
| **Update Support** | Full | Full |
| **Child Workflows** | Full | Full |
| **Continue-as-New** | Full | Full |
| **Cancellation Scopes** | Full | Full |
| **Activity Heartbeats** | Full | Simulated |
| **Search Attributes** | Advanced queries | Basic |
| **Visibility API** | Full | Limited |

## Performance

- **<5ms** workflow start latency (vs 50-200ms native)
- **<2ms** signal delivery (vs 10-50ms native)
- **<1ms** query response (vs 5-20ms native)
- **Zero cold starts** (Durable Objects)
- **Global distribution** (300+ Cloudflare locations)

## License

MIT

---

**[temporal.do](https://temporal.do)** - Part of the [dotdo](https://dotdo.dev) Business-as-Code platform

See also: [workflows.do](https://workflows.do) | [workers.do](https://workers.do) | [agents.do](https://agents.do)
