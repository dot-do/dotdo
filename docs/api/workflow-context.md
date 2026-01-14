# $ Context API Reference

The workflow context (`$`) is the unified interface for all Durable Object operations. It provides event handling, scheduling, durable execution, and cross-DO communication.

> **Related:** [Getting Started](../getting-started.md) | [API Quick Reference](../API.md) | [Cross-DO Patterns](../patterns/cross-do.md)

## Execution Modes

dotdo provides three durability levels for executing actions:

| Method | Durability | Retries | Use Case |
|--------|-----------|---------|----------|
| `$.send()` | Fire-and-forget | No | Analytics, logging, telemetry |
| `$.try()` | Single attempt | No | Idempotent operations |
| `$.do()` | Durable | Yes | Critical business logic |

### $.send(event, data)

Fire-and-forget event emission. Best effort delivery with no confirmation.

```typescript
// Signature
send<T = unknown>(event: string, data: T): string  // Returns EventId

// Usage
const eventId = this.$.send('Order.viewed', {
  orderId: 'ord-123',
  userId: 'user-456',
  timestamp: Date.now()
})
```

**When to use:**
- Analytics and telemetry
- Non-critical logging
- User activity tracking

### $.try(action, data, options?)

Single attempt execution. Returns immediately on success or failure.

```typescript
// Signature
try<T>(action: string, data: unknown, options?: TryOptions): Promise<T>

interface TryOptions {
  timeout?: number  // Timeout in milliseconds (default: 30000)
}

// Usage
const result = await this.$.try<{ valid: boolean }>(
  'validateAddress',
  { street: '123 Main St', city: 'Austin' },
  { timeout: 5000 }
)

if (result.valid) {
  console.log('Address is valid')
}
```

**When to use:**
- Idempotent operations (safe to retry manually)
- Quick validations
- Operations where failure is acceptable

### $.do(action, data, options?)

Durable execution with automatic retries and exponential backoff.

```typescript
// Signature
do<T>(action: string, data: unknown, options?: DoOptions): Promise<T>

interface DoOptions {
  retry?: Partial<RetryPolicy>
  timeout?: number  // Timeout per attempt in ms
  stepId?: string   // Explicit step ID for replay
}

interface RetryPolicy {
  maxAttempts: number       // Default: 3
  initialDelayMs: number    // Default: 100
  maxDelayMs: number        // Default: 30000
  backoffMultiplier: number // Default: 2
  jitter: boolean           // Default: true
}

// Usage
const payment = await this.$.do<{ transactionId: string }>(
  'processPayment',
  { orderId: 'ord-123', amount: 99.99 },
  {
    retry: {
      maxAttempts: 5,
      initialDelayMs: 200,
      maxDelayMs: 60000
    },
    timeout: 30000
  }
)

console.log(`Payment processed: ${payment.transactionId}`)
```

**When to use:**
- Payment processing
- Order fulfillment
- Any operation that must succeed

## Event Subscriptions

Subscribe to domain events using `$.on.Noun.verb()`.

### Basic Subscription

```typescript
import type { DomainEvent } from 'dotdo/types'

interface CustomerData {
  id: string
  email: string
  plan: string
}

// Subscribe to Customer.signup events
this.$.on.Customer.signup(async (event: DomainEvent<CustomerData>) => {
  const { id, email, plan } = event.data
  await this.createAccount(id, email, plan)
})

// Subscribe to Payment.failed events
this.$.on.Payment.failed(async (event: DomainEvent<{ orderId: string }>) => {
  await this.notifyCustomer(event.data.orderId)
})
```

### Wildcard Patterns

```typescript
// All nouns with 'created' verb
this.$.on['*'].created(async (event: DomainEvent) => {
  console.log(`Created: ${event.source}`)
  await this.audit('create', event)
})

// All verbs for Customer noun
this.$.on.Customer['*'](async (event: DomainEvent) => {
  console.log(`Customer event: ${event.verb}`)
})

// Global handler for all events
this.$.on['*']['*'](async (event: DomainEvent) => {
  await this.recordMetric(event.verb, event.source)
})
```

### Handler Options

```typescript
import type { DomainEvent, HandlerOptions, EventFilter } from 'dotdo/types'

interface OrderData {
  orderId: string
  amount: number
  priority: string
}

// Filter for high-value orders only
const highValueFilter: EventFilter<OrderData> = (event) => {
  return event.data.amount > 1000
}

const options: HandlerOptions<OrderData> = {
  priority: 10,           // Higher priority runs first
  filter: highValueFilter,
  name: 'high-value-order-handler',
  maxRetries: 3           // For DLQ integration
}

this.$.on.Order.placed(async (event: DomainEvent<OrderData>) => {
  await this.expediteOrder(event.data.orderId)
}, options)
```

### DomainEvent Structure

```typescript
interface DomainEvent<TData = unknown> {
  id: string           // Unique event ID
  verb: string         // The verb (created, updated, etc.)
  source: string       // Source identifier
  data: TData          // Event payload
  actionId?: string    // Associated action ID
  timestamp: Date      // When event occurred
}
```

## Scheduling

Schedule recurring tasks using `$.every`.

### Fixed Intervals

```typescript
// Every hour (at minute 0)
this.$.every.hour(async () => {
  await this.generateReport()
})

// Every minute
this.$.every.minute(async () => {
  await this.pingHealthCheck()
})
```

### Day and Time

```typescript
// Specific day at specific time
this.$.every.Monday.at9am(async () => {
  await this.planSprint()
})

this.$.every.Friday.at5pm(async () => {
  await this.sendWeeklyDigest()
})

// Available days: Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday
// Special: day (every day), weekday (Mon-Fri), weekend (Sat-Sun)

// Available times: at6am through at6pm, atnoon, atmidnight
// Or use .at() for custom times:
this.$.every.day.at('8:30am')(async () => {
  await this.morningBriefing()
})

this.$.every.weekday.at('17:00')(async () => {
  await this.endOfDayReport()
})
```

### Natural Language

```typescript
// Parsed to cron expressions
this.$.every('every 5 minutes', async () => {
  await this.syncData()
})

this.$.every('daily at 6am', async () => {
  await this.prepareReports()
})

this.$.every('first of month at 9am', async () => {
  await this.generateMonthlyInvoice()
})
```

### Cron Conversion Reference

| Pattern | Cron Expression |
|---------|-----------------|
| `$.every.Monday.at9am` | `0 9 * * 1` |
| `$.every.day.at6pm` | `0 18 * * *` |
| `$.every.hour` | `0 * * * *` |
| `$.every.minute` | `* * * * *` |
| `$.every.weekday.at9am` | `0 9 * * 1-5` |
| `$.every.weekend.atnoon` | `0 12 * * 0,6` |

## State Management

```typescript
// Access workflow state
const currentStep = this.$.state.currentStep as string

// Log with automatic tracking
this.$.log('Order processed', { orderId: 'ord-123', status: 'completed' })
```

## User Context

Access authenticated user information:

```typescript
// User context from RPC middleware
if (this.$.user) {
  console.log(`Request by user: ${this.$.user.id}`)
  console.log(`Email: ${this.$.user.email}`)
  console.log(`Role: ${this.$.user.role}`)
}
```

```typescript
interface UserContext {
  id: string       // Unique user identifier
  email?: string   // User's email (optional)
  role?: string    // User's role (optional)
}
```

## Cross-DO Communication

Call methods on other Durable Objects:

```typescript
// Access another DO by noun and ID
const customerProxy = this.$.Customer('cust-123')
const result = await customerProxy.getProfile()

// Chain method calls
const invoice = this.$.Invoice('inv-456')
await invoice.send()
```

## Branching and Version Control

```typescript
// Create a new branch
await this.$.branch('experiment-a')

// Switch to a branch or version
await this.$.checkout('experiment-a')
await this.$.checkout('@v1234')

// Merge a branch
await this.$.merge('experiment-a')
```

## Capabilities

The context can be extended with capabilities:

```typescript
import type { WithFs, WithGit, WithBash, hasFs, hasGit } from 'dotdo/types'

// Check for filesystem capability
if (hasFs(this.$)) {
  const content = await this.$.fs.readFile('/data/config.json')
}

// Check for git capability
if (hasGit(this.$)) {
  const status = await this.$.git.status()
  console.log(`On branch: ${status.branch}`)
}
```

### Available Capabilities

```typescript
interface FsCapability {
  readFile(path: string): Promise<string | Buffer>
  writeFile(path: string, content: string | Buffer): Promise<void>
  readDir(path: string): Promise<string[]>
  exists(path: string): Promise<boolean>
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>
  rm(path: string, options?: { recursive?: boolean }): Promise<void>
}

interface GitCapability {
  status(): Promise<{ branch: string; staged: string[]; unstaged: string[] }>
  add(files: string | string[]): Promise<void>
  commit(message: string): Promise<string | { hash: string }>
  push(remote?: string, branch?: string): Promise<void>
  pull(remote?: string, branch?: string): Promise<void>
  log(options?: { limit?: number }): Promise<Array<{ hash: string; message: string }>>
  diff(ref?: string): Promise<string>
}

interface BashCapability {
  exec(command: string, options?: ExecOptions): Promise<ExecResult>
  spawn(command: string, args?: string[]): unknown
}

interface RateLimitCapability {
  check(key: string, options?: RateLimitCheckOptions): Promise<RateLimitResult>
  consume(key: string, cost?: number): Promise<RateLimitResult>
  status(key: string): Promise<RateLimitResult>
  reset(key: string): Promise<void>
}
```

## Type Extensions

Extend the `$` context with your domain types:

```typescript
// In your domain types file
declare module 'dotdo/types' {
  interface NounRegistry {
    Customer: { id: string; email: string; name: string }
    Invoice: { id: string; amount: number; status: string }
    Order: { id: string; items: string[]; total: number }
  }

  interface EventPayloadMap {
    'Customer.created': { id: string; email: string; name: string }
    'Order.paid': { orderId: string; amount: number; currency: string }
    'Invoice.sent': { invoiceId: string; recipientEmail: string }
  }
}
```

This enables full type inference for event handlers and noun accessors.

## Related Documentation

- [Getting Started](../getting-started.md) - Basic usage and setup
- [API Quick Reference](../API.md) - Condensed reference for all APIs
- [Cross-DO Patterns](../patterns/cross-do.md) - Saga and 2PC transaction patterns
- [Security Best Practices](../security/best-practices.md) - Input validation, rate limiting

---

[Back to Documentation Index](../README.md)
