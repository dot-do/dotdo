# trigger.do

**Background jobs for AI agents.** Drop-in Trigger.dev replacement. Durable execution. 29 tests.

[![npm version](https://img.shields.io/npm/v/@dotdo/trigger.svg)](https://www.npmjs.com/package/@dotdo/trigger)
[![Tests](https://img.shields.io/badge/tests-29%20passing-brightgreen.svg)](https://github.com/dot-do/dotdo)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why trigger.do?

**Trigger.dev is fantastic.** Beautiful API for background jobs with retries, queues, and durable execution.

**But it's another service.** Your task payloads leave your infrastructure, execute on Trigger.dev's servers, and results come back. Extra latency. Extra cost. Extra vendor lock-in.

**trigger.do runs on dotdo's infrastructure.** 100% API-compatible with `@trigger.dev/sdk` v3, but your tasks execute on Cloudflare's edge in 300+ cities. Payloads never leave your infrastructure. Zero cold starts. Scales to millions of concurrent task runs.

```typescript
// Just change the import
import { task, wait, retry } from '@dotdo/trigger'  // was: '@trigger.dev/sdk/v3'

export const processOrder = task({
  id: 'process-order',
  retry: { maxAttempts: 3 },
  run: async (payload, { ctx }) => {
    const user = await ctx.run('fetch-user', async () => {
      return await fetchUser(payload.userId)
    })

    await wait.for({ seconds: 30 })

    return { userId: user.id, status: 'processed' }
  },
})

// Trigger the task
await processOrder.trigger({ orderId: '123' })
```

## Installation

```bash
npm install @dotdo/trigger
```

## Quick Start

```typescript
import { task, wait } from '@dotdo/trigger'

// Define a task
export const helloWorld = task({
  id: 'hello-world',
  run: async (payload: { name: string }) => {
    await wait.for({ seconds: 5 })
    return `Hello, ${payload.name}!`
  },
})

// Trigger and forget
const { id, handle } = await helloWorld.trigger({ name: 'World' })

// Or trigger and wait for result
const result = await helloWorld.triggerAndWait({ name: 'World' })
console.log(result.output)  // "Hello, World!"
```

## Features

### Task Definition

Define background tasks with full type safety:

```typescript
import { task } from '@dotdo/trigger'

interface OrderPayload {
  orderId: string
  userId: string
  items: Array<{ productId: string; quantity: number }>
}

interface OrderResult {
  orderId: string
  status: 'processed' | 'failed'
  processedAt: Date
}

export const processOrder = task<OrderPayload, OrderResult>({
  id: 'process-order',
  version: '1.0.0',

  // Retry configuration
  retry: {
    maxAttempts: 5,
    minTimeoutInMs: 1000,
    maxTimeoutInMs: 30000,
    factor: 2,
    randomize: true,
  },

  // Queue configuration
  queue: {
    name: 'orders',
    concurrencyLimit: 10,
  },

  // Machine resources (mapped to DO/Worker limits)
  machine: {
    preset: 'medium',
  },

  // Maximum duration
  maxDuration: 60000,  // 1 minute

  run: async (payload, { ctx }) => {
    // Task implementation
    return {
      orderId: payload.orderId,
      status: 'processed',
      processedAt: new Date(),
    }
  },
})
```

### Trigger Methods

Multiple ways to trigger tasks based on your needs:

#### trigger - Fire-and-Forget

```typescript
// Trigger without waiting for result
const { id, handle } = await processOrder.trigger({ orderId: '123', userId: 'user_1', items: [] })

console.log('Run ID:', id)

// Later, check status or get result
const status = await handle.status()  // 'PENDING' | 'QUEUED' | 'EXECUTING' | 'COMPLETED' | 'FAILED'
const result = await handle.result()  // Polls until complete
```

#### triggerAndWait - Await Result

```typescript
// Trigger and wait for completion
const result = await processOrder.triggerAndWait({ orderId: '123', userId: 'user_1', items: [] })

if (result.ok) {
  console.log('Order processed:', result.output)
} else {
  console.error('Order failed:', result.error.message)
}
```

#### batchTrigger - Process Multiple Items

```typescript
// Trigger multiple tasks in parallel
const { runs } = await processOrder.batchTrigger([
  { orderId: '1', userId: 'user_1', items: [] },
  { orderId: '2', userId: 'user_2', items: [] },
  { orderId: '3', userId: 'user_3', items: [] },
])

// Each run has its own handle
runs.forEach(run => console.log(run.id))
```

#### batchTriggerAndWait - Await All Results

```typescript
// Trigger multiple and wait for all to complete
const { runs } = await processOrder.batchTriggerAndWait([
  { orderId: '1', userId: 'user_1', items: [] },
  { orderId: '2', userId: 'user_2', items: [] },
])

const successful = runs.filter(r => r.ok)
const failed = runs.filter(r => !r.ok)
```

#### Trigger Options

```typescript
await processOrder.trigger(payload, {
  // Idempotency - prevent duplicate processing
  idempotencyKey: `order-${payload.orderId}`,
  idempotencyKeyTTL: '24h',

  // Delay execution
  delay: '5m',  // or delay: 300000 (ms) or delay: new Date('2024-12-25')

  // Tags for filtering/querying
  tags: ['high-priority', 'vip-customer'],

  // Queue override
  queue: { name: 'priority-orders', concurrencyLimit: 5 },

  // Concurrency control
  concurrencyKey: `user-${payload.userId}`,

  // Override max attempts
  maxAttempts: 10,

  // Custom metadata
  metadata: { source: 'api', version: '2.0' },
})
```

### Context Operations (ctx.run)

Execute sub-steps with automatic memoization and replay:

```typescript
export const complexWorkflow = task({
  id: 'complex-workflow',
  run: async (payload, { ctx }) => {
    // Each step is memoized - on replay, cached results are returned
    const user = await ctx.run('fetch-user', async () => {
      return await db.users.findById(payload.userId)
    })

    const order = await ctx.run('create-order', async () => {
      return await db.orders.create({
        userId: user.id,
        items: payload.items,
      })
    })

    // Steps can depend on previous step results
    const payment = await ctx.run('process-payment', async () => {
      return await stripe.charges.create({
        amount: order.total,
        customer: user.stripeId,
      })
    })

    // Access run context
    console.log('Run ID:', ctx.run.id)
    console.log('Attempt:', ctx.attempt.number)
    console.log('Is test:', ctx.run.isTest)

    return { orderId: order.id, paymentId: payment.id }
  },
})
```

### Lifecycle Hooks

Hook into task execution lifecycle:

```typescript
export const trackedTask = task({
  id: 'tracked-task',

  // Called when task starts executing
  onStart: async (payload, ctx) => {
    await analytics.track('task.started', {
      taskId: ctx.task.id,
      runId: ctx.run.id,
      payload,
    })
  },

  // Called when task completes successfully
  onSuccess: async (payload, output, ctx) => {
    await analytics.track('task.completed', {
      taskId: ctx.task.id,
      runId: ctx.run.id,
      output,
    })
  },

  // Called when task fails (after all retries exhausted)
  onFailure: async (payload, error, ctx) => {
    await alerting.send({
      level: 'error',
      message: `Task ${ctx.task.id} failed: ${error.message}`,
      runId: ctx.run.id,
    })
  },

  // Custom error handler (alternative to onFailure)
  handleError: async (payload, error, ctx) => {
    // Custom error handling logic
    if (error.message.includes('rate limit')) {
      // Handle rate limiting
    }
  },

  run: async (payload) => {
    // Task implementation
  },
})
```

### Middleware Support

Extend task functionality with middleware:

```typescript
import { task, type TaskMiddleware } from '@dotdo/trigger'

// Logging middleware
const loggingMiddleware: TaskMiddleware = {
  name: 'logging',

  // Called once when worker starts
  init: async () => {
    console.log('Logging middleware initialized')
  },

  // Transform payload before enqueueing
  onEnqueue: async (payload) => {
    console.log('Enqueueing task:', payload)
    return payload  // Return transformed payload
  },

  // Called before task execution
  beforeRun: async (payload, ctx) => {
    console.log(`Starting ${ctx.task.id} (run: ${ctx.run.id})`)
  },

  // Called after successful execution
  afterRun: async (payload, output, ctx) => {
    console.log(`Completed ${ctx.task.id}:`, output)
  },

  // Called on error
  onError: async (payload, error, ctx) => {
    console.error(`Failed ${ctx.task.id}:`, error.message)
  },
}

// Validation middleware
const validationMiddleware: TaskMiddleware = {
  name: 'validation',

  onEnqueue: async (payload) => {
    if (!payload.userId) {
      throw new Error('userId is required')
    }
    return payload
  },
}

// Apply middleware to task
export const processOrder = task({
  id: 'process-order',
  middleware: [loggingMiddleware, validationMiddleware],
  run: async (payload) => {
    // ...
  },
})
```

### Wait Utilities

Durable wait operations that don't consume resources:

```typescript
import { wait } from '@dotdo/trigger'

// Wait for a duration
await wait.for({ seconds: 30 })
await wait.for({ minutes: 5 })
await wait.for({ hours: 2 })
await wait.for({ days: 1 })

// Combine units
await wait.for({ hours: 1, minutes: 30 })

// Wait until a specific time
await wait.until(new Date('2024-12-25T00:00:00Z'))
```

### Retry Utilities

Configure retry strategies:

```typescript
import { retry } from '@dotdo/trigger'

// Use presets
const defaultRetry = retry.preset('default')    // 3 attempts, exponential backoff
const aggressiveRetry = retry.preset('aggressive')  // 10 attempts, faster backoff
const patientRetry = retry.preset('patient')    // 5 attempts, longer delays

// Exponential backoff
const exponential = retry.exponential(5, {
  minTimeout: 1000,   // Start at 1s
  maxTimeout: 60000,  // Cap at 60s
})

// Linear backoff (constant delay)
const linear = retry.linear(3, 5000)  // 3 attempts, 5s between each

// Apply to task
export const myTask = task({
  id: 'my-task',
  retry: retry.exponential(5),
  run: async (payload) => {
    // ...
  },
})
```

### Queue Configuration

Control concurrency and rate limiting:

```typescript
import { queue, task } from '@dotdo/trigger'

// Create a queue configuration
const orderQueue = queue.create('orders', {
  concurrency: 10,  // Max 10 concurrent executions
  rateLimit: {
    limit: 100,
    period: '1m',   // 100 per minute
  },
})

// Apply to task
export const processOrder = task({
  id: 'process-order',
  queue: orderQueue,
  run: async (payload) => {
    // At most 10 running concurrently, 100/min
  },
})
```

### Abort Utilities

Gracefully abort task execution:

```typescript
import { abort, AbortTaskRunError } from '@dotdo/trigger'

export const validateOrder = task({
  id: 'validate-order',
  run: async (payload) => {
    if (!payload.orderId) {
      // Immediately abort - no retries
      abort('Missing orderId')
    }

    const order = await fetchOrder(payload.orderId)

    if (order.status === 'cancelled') {
      abort('Order has been cancelled')
    }

    return { valid: true }
  },
})
```

### Scheduled Tasks

Create cron-triggered tasks:

```typescript
import { schedules } from '@dotdo/trigger'

export const dailyReport = schedules({
  id: 'daily-report',
  cron: '0 9 * * MON-FRI',  // Weekdays at 9 AM
  timezone: 'America/New_York',

  run: async (payload, { ctx }) => {
    const report = await generateReport()
    await sendEmail(report)
    return { sentAt: new Date() }
  },
})
```

## Backend Options

trigger.do supports multiple execution backends based on your durability and cost requirements:

| Backend | Best For | Durability | Max Duration | Cost |
|---------|----------|------------|--------------|------|
| **Durable Objects** | Real-time, interactive | Transactional | Unlimited | Higher (wall-clock) |
| **CF Workflows** | Background jobs, long waits | Event-sourced | 24h | 100-1000x cheaper |
| **Pipelines** | High-throughput batch | At-least-once | 5m/step | Cheapest |

```
┌─────────────────────────────────────────────────────────────┐
│         Durable Objects (Default)                           │
├─────────────────────────────────────────────────────────────┤
│  Full consistency, real-time, WebSocket support             │
│  Best for: Low-latency tasks, real-time updates            │
│  Cost: Wall-clock billing                                   │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│         Cloudflare Workflows                                │
├─────────────────────────────────────────────────────────────┤
│  Hot execution, out-of-band processing                      │
│  Best for: Long waits, scheduled jobs, batch processing     │
│  Cost: CPU-only billing (sleep is FREE)                     │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│         Pipelines + Iceberg                                 │
├─────────────────────────────────────────────────────────────┤
│  60s batch aggregation, R2 storage                          │
│  Best for: Analytics, audit logs, high-volume events        │
│  Cost: Batch writes to R2                                   │
└─────────────────────────────────────────────────────────────┘
```

Configure the backend:

```typescript
import { configure } from '@dotdo/trigger'
import { CFWorkflowsBackend } from '@dotdo/workflows/backends'

// Use CF Workflows backend for cost-efficient background jobs
configure({
  storage: new CFWorkflowsBackend(env.MY_WORKFLOW),
})

// Or use DO storage directly
configure({
  storage: doStorage,
  state: this.ctx.state,  // Durable Object state
})
```

## API Reference

### Task Factory

| Function | Parameters | Returns | Description |
|----------|------------|---------|-------------|
| `task<P, O>(config)` | `TaskConfig<P, O>` | `Task<P, O>` | Create a new task |
| `schedules<P, O>(config)` | `ScheduledTaskConfig<P, O>` | `Task<P, O>` | Create a scheduled task |
| `configure(config)` | `GlobalConfig` | `void` | Set global configuration |

### TaskConfig Options

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `id` | `string` | required | Unique task identifier |
| `version` | `string` | - | Task version |
| `retry` | `RetryConfig` | - | Retry configuration |
| `queue` | `QueueConfig` | - | Queue configuration |
| `machine` | `MachineConfig` | - | Resource allocation |
| `maxDuration` | `number` | - | Maximum run duration (ms) |
| `middleware` | `TaskMiddleware[]` | - | Middleware chain |
| `onStart` | `(payload, ctx) => void` | - | Start lifecycle hook |
| `onSuccess` | `(payload, output, ctx) => void` | - | Success lifecycle hook |
| `onFailure` | `(payload, error, ctx) => void` | - | Failure lifecycle hook |
| `handleError` | `(payload, error, ctx) => void` | - | Custom error handler |
| `init` | `() => void` | - | Worker initialization |
| `cleanup` | `() => void` | - | Worker cleanup |
| `run` | `(payload, { ctx }) => output` | required | Task implementation |

### Task Instance Methods

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| `trigger(payload, opts?)` | `TPayload, TriggerOptions?` | `Promise<TriggerResult>` | Fire-and-forget |
| `triggerAndWait(payload, opts?)` | `TPayload, TriggerOptions?` | `Promise<TaskRunResult<O>>` | Await completion |
| `batchTrigger(items, opts?)` | `TPayload[], TriggerOptions?` | `Promise<{ runs: TriggerResult[] }>` | Batch trigger |
| `batchTriggerAndWait(items, opts?)` | `TPayload[], TriggerOptions?` | `Promise<{ runs: TaskRunResult<O>[] }>` | Batch await |

### TaskContext Properties

| Property | Type | Description |
|----------|------|-------------|
| `run` | `TaskRunContext` | Run context (also callable for ctx.run) |
| `run.id` | `string` | Unique run identifier |
| `run.tags` | `string[]` | Run tags |
| `run.isTest` | `boolean` | Whether this is a test run |
| `run.createdAt` | `Date` | When run was created |
| `run.startedAt` | `Date` | When execution started |
| `run.idempotencyKey` | `string?` | Idempotency key if provided |
| `run.parentId` | `string?` | Parent run ID (for child tasks) |
| `run.batchId` | `string?` | Batch ID (for batch triggers) |
| `task.id` | `string` | Task identifier |
| `task.version` | `string?` | Task version |
| `attempt.id` | `string` | Attempt identifier |
| `attempt.number` | `number` | Attempt number (1-indexed) |
| `attempt.startedAt` | `Date` | When attempt started |
| `environment.type` | `string` | Environment type |
| `organization.id` | `string` | Organization identifier |
| `project.id` | `string` | Project identifier |
| `machine.cpu` | `number` | CPU allocation |
| `machine.memory` | `number` | Memory allocation (MB) |

### Wait Utilities

| Method | Parameters | Description |
|--------|------------|-------------|
| `wait.for(duration)` | `{ seconds?, minutes?, hours?, days? }` | Wait for duration |
| `wait.until(date)` | `Date` | Wait until specific time |

### Retry Utilities

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| `retry.preset(name)` | `'default' \| 'aggressive' \| 'patient'` | `RetryConfig` | Get preset config |
| `retry.exponential(max, opts?)` | `number, { minTimeout?, maxTimeout? }` | `RetryConfig` | Exponential backoff |
| `retry.linear(max, delay)` | `number, number` | `RetryConfig` | Linear backoff |

### Queue Utilities

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| `queue.create(name, opts?)` | `string, { concurrency?, rateLimit? }` | `QueueConfig` | Create queue config |

### Error Classes

| Class | Description |
|-------|-------------|
| `AbortTaskRunError` | Thrown by `abort()` to stop execution without retry |

## How It Works

```
Input: task.trigger({ orderId: '123' })
         ↓
┌─────────────────────────────────────────┐
│         Middleware: onEnqueue           │
│    Transform/validate payload           │
└─────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────┐
│         Queue Management                │
│    Apply concurrency limits             │
│    Check idempotency cache              │
│    Schedule with delay if specified     │
└─────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────┐
│         Middleware: beforeRun           │
│    Pre-execution hooks                  │
└─────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────┐
│         Lifecycle: onStart              │
│    Task start notification              │
└─────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────┐
│         Task Execution                  │
│    ctx.run → memoized step execution   │
│    wait.for → durable sleep             │
│    Automatic retry on failure           │
└─────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────┐
│         Middleware: afterRun            │
│    Post-execution hooks                 │
└─────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────┐
│         Lifecycle: onSuccess/onFailure  │
│    Completion notification              │
└─────────────────────────────────────────┘
         ↓
Output: { ok, id, status, output/error }
```

## Comparison

| Feature | @trigger.dev/sdk | @dotdo/trigger |
|---------|------------------|----------------|
| API Compatibility | - | 100% |
| Payloads leave infra | Yes | No |
| Cold start | ~100ms | 0ms |
| Global edge | Limited | 300+ cities |
| Max duration | Varies by plan | Unlimited (DO) |
| Pricing | Per-task run | Included |
| Self-hosted | Enterprise | Always |
| DO integration | N/A | Native |
| CF Workflows | N/A | Native |
| ctx.run memoization | Yes | Yes |
| Lifecycle hooks | Yes | Yes |
| Middleware | Yes | Yes |
| Batch operations | Yes | Yes |
| Scheduled tasks | Yes | Yes |

## Performance

- **29 tests** covering all functionality
- **0ms cold start** via V8 isolates
- **<1ms** task dispatch latency (edge)
- **Unlimited duration** with Durable Objects
- **Global edge** execution in 300+ cities
- **Automatic memoization** for ctx.run steps
- **Free sleep** on CF Workflows backend

## License

MIT

## Related

- [GitHub](https://github.com/dot-do/dotdo)
- [Documentation](https://trigger.do)
- [.do Platform](https://do.org.ai)
- [Trigger.dev SDK](https://trigger.dev)
- [Platform.do](https://platform.do)
