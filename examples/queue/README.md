# queue.example.com.ai

Job queue with automatic retries, built into dotdo.

## The Problem

You need background jobs. That means Redis, Bull, a separate worker process, custom retry logic, dead letter queues, and praying nothing goes wrong during deploys.

## The Solution

dotdo has durable execution built-in:

```typescript
// This job will retry automatically
await this.do(() => sendEmail(user, 'Welcome!'))
```

No infrastructure. No separate workers. Jobs run in your Durable Object with automatic retries and persistence.

## Three Durability Levels

### `this.send` - Fire-and-Forget

Best for: Analytics, logging, non-critical notifications

```typescript
// Returns immediately, handler runs async
this.send('Job.enqueued', { type: 'email', to: user.email })

// Errors don't propagate to caller
this.send('Metrics.recorded', { event: 'signup', userId: user.id })
```

### `this.try` - Single Attempt

Best for: Idempotent operations, user-facing requests

```typescript
// Throws on failure, no retries
const result = await this.try(() => chargeCard(user, amount))

// With timeout
const data = await this.try(() => fetchExternalAPI(url), { timeout: 5000 })
```

### `this.do` - Durable with Retries

Best for: Critical operations that must eventually succeed

```typescript
// Retries up to 3 times with exponential backoff
await this.do(() => processPayment(order))

// Custom retry count
await this.do(() => syncInventory(warehouse), { maxRetries: 5 })

// Named step (for replay semantics)
await this.do(() => sendInvoice(order), { stepId: 'send-invoice' })
```

## Job Queue Pattern

```typescript
import { DO } from 'dotdo'

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

export default DO.extend({
  // Job handlers by type
  handlers: {
    'email': async (p) => sendEmail(p as EmailPayload),
    'webhook': async (p) => callWebhook(p as WebhookPayload),
    'report': async (p) => generateReport(p as ReportPayload),
  },

  init() {
    // Process jobs durably
    this.on.Job.enqueued(async (event) => {
      const job = event.data as Job

      // Update status
      job.status = 'running'
      job.attempts++

      try {
        // Durable execution with retries
        const output = await this.do(
          () => this.handlers[job.type](job.payload),
          { stepId: `job-${job.$id}`, maxRetries: 3 }
        )

        job.status = 'completed'

        // Store result
        this.send('Result.created', {
          $type: 'Result',
          $id: crypto.randomUUID(),
          jobId: job.$id,
          output,
          completedAt: new Date(),
        })

      } catch (err) {
        job.status = 'failed'
        job.error = err instanceof Error ? err.message : String(err)
        this.send('Job.failed', job)
      }
    })
  }
})
```

## Enqueue Jobs

```typescript
// Fire-and-forget enqueue
this.send('Job.enqueued', {
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
await this.do(() => riskyOperation())

// Backoff schedule:
// Attempt 1: immediate
// Attempt 2: wait 1s
// Attempt 3: wait 2s
// Attempt 4: wait 4s (capped at 10s)

// More retries for flaky operations
await this.do(() => callFlakyAPI(), { maxRetries: 5 })

// Named steps dedupe automatically
await this.do(() => chargeCard(user), { stepId: 'charge-user-123' })
// If DO restarts mid-execution, same stepId returns cached result
```

## Scheduled Jobs

```typescript
// Daily cleanup at midnight
this.every.day.at('midnight')(() => {
  this.send('Job.enqueued', { $type: 'Job', type: 'cleanup', ... })
})

// Process queue every 5 minutes
this.every(5).minutes(() => {
  this.send('Queue.process', { batchSize: 100 })
})
```

## Error Handling

```typescript
// Monitor failed sends
this.onError((info) => console.error(`Failed: ${info.eventType}`, info.error))
```

## Comparison

| Feature | this.send | this.try | this.do |
|---------|--------|-------|------|
| Retries | No | No | Yes |
| Awaitable | No | Yes | Yes |
| Throws | No | Yes | Yes |
| Timeout | No | Yes | No |
| Replay-safe | No | No | Yes |
| Use case | Analytics | User requests | Critical ops |

## Promise Pipelining (Cap'n Web)

True Cap'n Proto-style pipelining: method calls on stubs batch until `await`, then resolve in a single round-trip.

```typescript
// ❌ Sequential - N round-trips
for (const job of jobs) {
  await this.Worker(job.workerId).process(job)
}

// ✅ Pipelined - fire and forget
jobs.forEach(job => this.Worker(job.workerId).process(job))

// ✅ Pipelined - batch dispatch, single await
const results = await Promise.all(
  jobs.map(job => this.Worker(job.workerId).process(job))
)

// ✅ Chain without await - single round-trip for chained access
const pending = await this.Queue(id).metrics.pending
```

`this.Noun(id)` returns a pipelined stub. Fire-and-forget is valid for side effects.

## Deploy

```bash
npx wrangler deploy
```

Your job queue is live at `queue.example.com.ai`.
