# queue.example.com.ai

Job queue with automatic retries, built into dotdo.

## The Problem

You need background jobs. That means Redis, Bull, a separate worker process, custom retry logic, dead letter queues, and praying nothing goes wrong during deploys.

## The Solution

dotdo's `$` context has durable execution built-in:

```typescript
// This job will retry automatically
await $.do(() => sendEmail(user, 'Welcome!'))
```

No infrastructure. No separate workers. Jobs run in your Durable Object with automatic retries and persistence.

## Three Durability Levels

### `$.send` - Fire-and-Forget

Best for: Analytics, logging, non-critical notifications

```typescript
// Returns immediately, handler runs async
$.send('Job.enqueued', { type: 'email', to: user.email })

// Errors don't propagate to caller
$.send('Metrics.recorded', { event: 'signup', userId: user.id })
```

### `$.try` - Single Attempt

Best for: Idempotent operations, user-facing requests

```typescript
// Throws on failure, no retries
const result = await $.try(() => chargeCard(user, amount))

// With timeout
const data = await $.try(() => fetchExternalAPI(url), { timeout: 5000 })
```

### `$.do` - Durable with Retries

Best for: Critical operations that must eventually succeed

```typescript
// Retries up to 3 times with exponential backoff
await $.do(() => processPayment(order))

// Custom retry count
await $.do(() => syncInventory(warehouse), { maxRetries: 5 })

// Named step (for replay semantics)
await $.do(() => sendInvoice(order), { stepId: 'send-invoice' })
```

## Job Queue Pattern

```typescript
import { $ } from 'dotdo'

// Define Things
interface Job {
  $type: 'Job'
  $id: string
  type: string
  payload: unknown
  status: 'pending' | 'running' | 'completed' | 'failed'
  attempts: number
  error?: string
}

interface Result {
  $type: 'Result'
  $id: string
  jobId: string
  output: unknown
  completedAt: Date
}

// Job handlers by type
const handlers: Record<string, (payload: unknown) => Promise<unknown>> = {
  'email': async (p) => sendEmail(p as EmailPayload),
  'webhook': async (p) => callWebhook(p as WebhookPayload),
  'report': async (p) => generateReport(p as ReportPayload),
}

// Process jobs durably
$.on.Job.enqueued(async (event) => {
  const job = event.data as Job

  // Update status
  job.status = 'running'
  job.attempts++

  try {
    // Durable execution with retries
    const output = await $.do(
      () => handlers[job.type](job.payload),
      { stepId: `job-${job.$id}`, maxRetries: 3 }
    )

    job.status = 'completed'

    // Store result
    $.send('Result.created', {
      $type: 'Result',
      $id: crypto.randomUUID(),
      jobId: job.$id,
      output,
      completedAt: new Date(),
    })

  } catch (err) {
    job.status = 'failed'
    job.error = err instanceof Error ? err.message : String(err)
    $.send('Job.failed', job)
  }
})
```

## Enqueue Jobs

```typescript
// Fire-and-forget enqueue
$.send('Job.enqueued', {
  $type: 'Job',
  $id: crypto.randomUUID(),
  type: 'email',
  payload: { to: 'user@example.com', subject: 'Hello' },
  status: 'pending',
  attempts: 0,
})
```

## Retry Configuration

```typescript
// Default: 3 retries with exponential backoff
await $.do(() => riskyOperation())

// Backoff schedule:
// Attempt 1: immediate
// Attempt 2: wait 1s
// Attempt 3: wait 2s
// Attempt 4: wait 4s (capped at 10s)

// More retries for flaky operations
await $.do(() => callFlakyAPI(), { maxRetries: 5 })

// Named steps dedupe automatically
await $.do(() => chargeCard(user), { stepId: 'charge-user-123' })
// If DO restarts mid-execution, same stepId returns cached result
```

## Scheduled Jobs

```typescript
// Daily cleanup at midnight
$.every.day.at('midnight')(() => {
  $.send('Job.enqueued', { $type: 'Job', type: 'cleanup', ... })
})

// Process queue every 5 minutes
$.every(5).minutes(() => {
  $.send('Queue.process', { batchSize: 100 })
})
```

## Error Handling

```typescript
// Monitor failed sends
$.onError((info) => console.error(`Failed: ${info.eventType}`, info.error))
```

## Comparison

| Feature | $.send | $.try | $.do |
|---------|--------|-------|------|
| Retries | No | No | Yes |
| Awaitable | No | Yes | Yes |
| Throws | No | Yes | Yes |
| Timeout | No | Yes | No |
| Replay-safe | No | No | Yes |
| Use case | Analytics | User requests | Critical ops |

## Promise Pipelining

Promises are stubs. Chain freely, await only when needed.

```typescript
// ❌ Sequential - N round-trips
for (const job of jobs) {
  await $.Worker(job.workerId).process(job)
}

// ✅ Pipelined - fire and forget
jobs.forEach(job => $.Worker(job.workerId).process(job))

// ✅ Pipelined - batch dispatch, single await
const results = await Promise.all(
  jobs.map(job => $.Worker(job.workerId).process(job))
)

// ✅ Chain without await - single round-trip
const pending = await $.Queue(id).getMetrics().pending
```

Fire-and-forget is valid for side effects. Only `await` at exit points when you need the value.

## Deploy

```bash
npx wrangler deploy
```

Your job queue is live at `queue.example.com.ai`.
