# inngest.do

**Durable functions for AI agents.** Drop-in Inngest replacement. Runs on edge.

[![npm version](https://img.shields.io/npm/v/@dotdo/inngest.svg)](https://www.npmjs.com/package/@dotdo/inngest)
[![Tests](https://img.shields.io/badge/tests-17%20passing-brightgreen.svg)](https://github.com/dot-do/dotdo)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why inngest.do?

**Inngest is great.** Event-driven durable functions with a beautiful API.

**But it's another service.** Events leave your infrastructure, hop to Inngest's servers, then back to your workers. Extra latency. Extra cost. Extra vendor dependency.

**inngest.do runs on dotdo's infrastructure.** Same API, same patterns - but your functions execute on Cloudflare's edge in 300+ cities. Events never leave your infrastructure. Zero cold starts. Scales to millions of concurrent executions.

```typescript
// Just change the import
import { Inngest } from '@dotdo/inngest'  // was: 'inngest'

const inngest = new Inngest({ id: 'my-app' })

export const processOrder = inngest.createFunction(
  { id: 'process-order' },
  { event: 'order/created' },
  async ({ event, step }) => {
    const user = await step.run('fetch-user', async () => {
      return await fetchUser(event.data.userId)
    })

    await step.sleep('wait-a-bit', '1h')

    await step.run('send-email', async () => {
      await sendEmail(user.email, 'Order confirmed!')
    })
  }
)
```

## Installation

```bash
npm install @dotdo/inngest
```

## Quick Start

```typescript
import { Inngest } from '@dotdo/inngest'

// Create a client
const inngest = new Inngest({ id: 'my-app' })

// Define a function
const helloWorld = inngest.createFunction(
  { id: 'hello-world' },
  { event: 'test/hello' },
  async ({ event, step }) => {
    const greeting = await step.run('create-greeting', () => {
      return `Hello, ${event.data.name}!`
    })
    return greeting
  }
)

// Send an event to trigger the function
await inngest.send({
  name: 'test/hello',
  data: { name: 'World' }
})
```

## Features

### Event-Driven Functions

Functions trigger on events, just like native Inngest:

```typescript
// Event trigger
const onUserSignup = inngest.createFunction(
  { id: 'on-user-signup' },
  { event: 'user/signup' },
  async ({ event }) => {
    await sendWelcomeEmail(event.data.email)
  }
)

// Cron trigger
const dailyReport = inngest.createFunction(
  { id: 'daily-report' },
  { cron: '0 9 * * MON-FRI' },
  async () => {
    await generateReport()
  }
)

// String shorthand
const quickHandler = inngest.createFunction(
  { id: 'quick' },
  'payment/received',
  async ({ event }) => event.data.amount
)
```

### Step Primitives

Full support for all Inngest step primitives:

#### step.run - Durable Step Execution

```typescript
const result = await step.run('fetch-data', async () => {
  const response = await fetch('https://api.example.com.ai/data')
  return response.json()
})

// Results are automatically memoized on replay
// If the function retries, this step won't re-execute
```

#### step.sleep - Durable Sleep

```typescript
// Sleep for a duration (function pauses, not blocked)
await step.sleep('wait-for-cooling', '30m')
await step.sleep('delay', '2h')
await step.sleep('quick-pause', '5s')

// Supported units: ms, s, sec, m, min, h, hr, hour, d, day, w, week
```

#### step.waitForEvent - Event Coordination

```typescript
// Wait for a related event
const approval = await step.waitForEvent('wait-for-approval', {
  event: 'order/approved',
  timeout: '24h',
  match: 'data.orderId',  // Match on correlation field
})

if (!approval) {
  // Timeout - no approval received
  await cancelOrder(orderId)
}
```

#### step.sendEvent - Send Events from Steps

```typescript
// Send events as a durable step
await step.sendEvent('notify-downstream', {
  name: 'order/processed',
  data: { orderId, status: 'complete' }
})

// Send multiple events
await step.sendEvent('fan-out', [
  { name: 'notification/email', data: { userId, message } },
  { name: 'notification/push', data: { userId, message } },
  { name: 'analytics/event', data: { type: 'order_complete' } },
])
```

#### step.invoke - Call Other Functions

```typescript
// Invoke another function and wait for result
const result = await step.invoke('call-processor', {
  function: processPayment,
  data: { amount: 100, currency: 'USD' },
  timeout: '5m'
})
```

### Parallel Steps

Run multiple steps concurrently:

```typescript
const [user, order, inventory] = await step.parallel('fetch-all', [
  async () => fetchUser(userId),
  async () => fetchOrder(orderId),
  async () => checkInventory(productId),
])
```

### Error Handling

#### NonRetriableError

```typescript
import { NonRetriableError } from '@dotdo/inngest'

await step.run('validate', () => {
  if (!isValid(data)) {
    // This error will NOT trigger retries
    throw new NonRetriableError('Invalid data format')
  }
})
```

#### RetryAfterError

```typescript
import { RetryAfterError } from '@dotdo/inngest'

await step.run('call-api', async () => {
  const response = await fetch(url)

  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After')
    throw new RetryAfterError('Rate limited', retryAfter)
  }

  return response.json()
})
```

### Middleware Support

Extend functionality with middleware:

```typescript
const loggingMiddleware = {
  name: 'logging',

  init: () => {
    console.log('Middleware initialized')
  },

  onSendEvent: (events) => {
    console.log('Sending events:', events.length)
    return events
  },

  onFunctionRun: ({ fn, event, runId }) => ({
    beforeExecution: () => {
      console.log(`Starting ${fn.id}`)
    },
    afterExecution: () => {
      console.log(`Completed ${fn.id}`)
    },
    transformInput: (ctx) => ctx,
    transformOutput: (result) => result,
    onError: (error) => {
      console.error(`Error in ${fn.id}:`, error)
    }
  })
}

const inngest = new Inngest({
  id: 'my-app',
  middleware: [loggingMiddleware]
})
```

### Function Configuration

All Inngest function options are supported:

```typescript
const fn = inngest.createFunction(
  {
    id: 'robust-function',
    name: 'My Robust Function',

    // Retry configuration
    retries: {
      attempts: 5,
      backoff: 'exponential',
      initialInterval: '1s',
      maxInterval: '1h'
    },

    // Timeouts
    timeouts: {
      function: '30m',
      step: '5m'
    },

    // Rate limiting
    rateLimit: {
      key: 'event.data.userId',
      limit: 10,
      period: '1m'
    },

    // Throttling
    throttle: {
      key: 'event.data.customerId',
      count: 5,
      period: '1h'
    },

    // Debouncing
    debounce: {
      key: 'event.data.userId',
      period: '5s'
    },

    // Concurrency control
    concurrency: {
      limit: 10,
      key: 'event.data.accountId',
      scope: 'fn'
    },

    // Batching
    batchEvents: {
      maxSize: 100,
      timeout: '5s'
    },

    // Cancel on events
    cancelOn: [{
      event: 'order/cancelled',
      match: 'data.orderId'
    }]
  },
  { event: 'order/created' },
  handler
)
```

## Backend Options

inngest.do can use different backends depending on your needs:

| Backend | Best For | Durability | Max Duration |
|---------|----------|------------|--------------|
| **Durable Objects** | Default, most workflows | Transactional | Unlimited |
| **CF Workflows** | Complex orchestration | Event-sourced | 24h |
| **Pipelines** | High-throughput ETL | At-least-once | 5m per step |

```typescript
// Durable Objects (default)
const inngest = new Inngest({
  id: 'my-app',
  storage: doStorage
})

// With DO state for waitForEvent
const inngest = new Inngest({
  id: 'my-app',
  state: ctx.state  // From Durable Object
})
```

## API Reference

### Client

| Method | Description |
|--------|-------------|
| `new Inngest(config)` | Create client |
| `inngest.send(event)` | Send one or more events |
| `inngest.createFunction(config, trigger, handler)` | Create a function |
| `inngest.getFunctions()` | Get all registered functions |
| `inngest.getFunction(id)` | Get function by ID |

### InngestConfig

| Property | Type | Description |
|----------|------|-------------|
| `id` | string | Application identifier |
| `eventKey` | string? | Event key (optional) |
| `middleware` | Middleware[]? | Middleware array |
| `storage` | StepStorage? | Durable storage backend |
| `state` | DurableObjectState? | DO state for waitForEvent |
| `logger` | Logger? | Custom logger |

### Step Tools

| Method | Description |
|--------|-------------|
| `step.run(id, fn)` | Execute durable step |
| `step.sleep(id, duration)` | Sleep for duration |
| `step.waitForEvent(id, opts)` | Wait for correlated event |
| `step.sendEvent(id, event)` | Send event(s) |
| `step.invoke(id, opts)` | Invoke another function |
| `step.parallel(id, fns)` | Run steps in parallel |
| `step.ai.infer(id, opts)` | AI inference (experimental) |

### Error Types

| Class | Description |
|-------|-------------|
| `NonRetriableError` | Error that should not retry |
| `RetryAfterError` | Error with retry delay |
| `StepError` | Error from step execution |

### HTTP Handler

```typescript
import { serve } from '@dotdo/inngest'

const handler = serve(inngest, [fn1, fn2, fn3], {
  path: '/api/inngest',  // Optional, default: /api/inngest
  signingKey: 'sk_...'   // Optional signing key
})

// Use with any framework
export default { fetch: handler }
```

## How It Works

```
Event: { name: 'order/created', data: {...} }
         ↓
┌─────────────────────────────────────────┐
│         inngest.send()                   │
│    Generate event ID, add timestamp      │
└─────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────┐
│         Middleware: onSendEvent          │
│    Transform, validate, log events       │
└─────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────┐
│         Event Router                     │
│    Match event name to registered fns    │
│    Deliver to waitForEvent waiters       │
└─────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────┐
│         Middleware: onFunctionRun        │
│    beforeExecution, transformInput       │
└─────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────┐
│         Function Execution               │
│    step.run → memoized execution        │
│    step.sleep → durable timer           │
│    step.waitForEvent → suspend/resume   │
└─────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────┐
│         Middleware: afterExecution       │
│    transformOutput, cleanup              │
└─────────────────────────────────────────┘
         ↓
Result: returned to caller or stored
```

## Comparison

| Feature | Native Inngest | inngest.do |
|---------|---------------|------------|
| API Compatibility | - | 100% |
| Events leave infra | Yes | No |
| Cold start | ~50ms | 0ms |
| Global edge | 5 regions | 300+ cities |
| Max duration | 2h | Unlimited |
| Pricing | Per-step | Included |
| Self-hosted option | Enterprise | Always |
| DO integration | N/A | Native |

## Performance

- **17 tests** covering core functionality
- **0ms cold start** via V8 isolates
- **<1ms** event routing and dispatch
- **Unlimited duration** with Durable Objects
- **Global edge** execution in 300+ cities

## License

MIT

## Related

- [GitHub](https://github.com/dot-do/dotdo)
- [Documentation](https://inngest.do)
- [.do Platform](https://do.org.ai)
- [Inngest SDK](https://www.inngest.com)
