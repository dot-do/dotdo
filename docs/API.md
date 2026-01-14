# API Quick Reference

This is a condensed reference for all dotdo APIs. For detailed documentation, see the [$ Context API Reference](./api/workflow-context.md).

## $ Context Methods

### Execution Modes

| Method | Description | Use Case |
|--------|-------------|----------|
| `$.send(event, data)` | Fire-and-forget | Analytics, logging |
| `$.try(action, data, options?)` | Single attempt | Idempotent operations |
| `$.do(action, data, options?)` | Durable with retries | Critical business logic |

```typescript
// Fire-and-forget
const eventId = $.send('Order.viewed', { orderId: 'ord-123' })

// Single attempt with timeout
const result = await $.try<Result>('validate', { input }, { timeout: 5000 })

// Durable with retries
const payment = await $.do<Payment>('processPayment', { orderId }, {
  retry: { maxAttempts: 3, initialDelayMs: 100, backoffMultiplier: 2 },
  timeout: 30000
})
```

See [Execution Modes](./api/workflow-context.md#execution-modes) for full details.

### Event Subscriptions

```typescript
// Specific Noun.verb
$.on.Customer.signup(async (event) => { /* ... */ })
$.on.Payment.failed(async (event) => { /* ... */ })

// Wildcards
$.on['*'].created(async (event) => { /* all created events */ })
$.on.Customer['*'](async (event) => { /* all Customer events */ })
$.on['*']['*'](async (event) => { /* all events */ })

// With options
$.on.Order.placed(async (event) => { /* ... */ }, {
  priority: 10,
  filter: (e) => e.data.amount > 1000,
  maxRetries: 3
})
```

See [Event Subscriptions](./api/workflow-context.md#event-subscriptions) for full details.

### DomainEvent Structure

```typescript
interface DomainEvent<T = unknown> {
  id: string           // Unique event ID
  verb: string         // The verb (created, updated, etc.)
  source: string       // Source identifier
  data: T              // Event payload
  actionId?: string    // Associated action ID
  timestamp: Date      // When event occurred
}
```

## Scheduling DSL

### Fixed Intervals

```typescript
$.every.minute(handler)    // Every minute
$.every.hour(handler)      // Every hour (at minute 0)
```

### Day and Time

```typescript
// Specific day at specific time
$.every.Monday.at9am(handler)
$.every.Friday.at5pm(handler)

// Daily
$.every.day.at9am(handler)
$.every.day.at('8:30am')(handler)
$.every.day.at('17:00')(handler)

// Weekdays / Weekends
$.every.weekday.at9am(handler)    // Mon-Fri
$.every.weekend.atnoon(handler)   // Sat-Sun
```

### Natural Language

```typescript
$.every('every 5 minutes', handler)
$.every('daily at 6am', handler)
$.every('first of month at 9am', handler)
```

### Cron Conversion

| Pattern | Cron |
|---------|------|
| `$.every.minute` | `* * * * *` |
| `$.every.hour` | `0 * * * *` |
| `$.every.day.at9am` | `0 9 * * *` |
| `$.every.Monday.at9am` | `0 9 * * 1` |
| `$.every.weekday.at9am` | `0 9 * * 1-5` |
| `$.every.weekend.atnoon` | `0 12 * * 0,6` |

See [Scheduling](./api/workflow-context.md#scheduling) for full details.

## Cross-DO RPC

### Basic Calls

```typescript
// Call method on another DO
const profile = await $.Customer('cust-123').getProfile()
await $.Invoice('inv-456').send()
```

### Saga Pattern (Eventual Consistency)

```typescript
import { createSaga } from 'dotdo/objects/CrossDOTransaction'

const saga = createSaga<Input, Output>()
  .addStep({
    name: 'reserve',
    execute: async (input) => ({ reservationId: 'res-123' }),
    compensate: async (result) => { /* undo on failure */ }
  })
  .addStep({
    name: 'charge',
    execute: async (prev) => ({ transactionId: 'tx-456' }),
    compensate: async (result) => { /* refund on failure */ },
    retry: { maxAttempts: 3 }
  })

const result = await saga.execute(input, { idempotencyKey: 'order-123' })
```

### Two-Phase Commit (Strong Consistency)

```typescript
import { create2PC } from 'dotdo/objects/CrossDOTransaction'

const transfer = create2PC({ timeout: 10000 })
  .addParticipant({
    id: 'source',
    prepare: async () => true,
    commit: async () => { /* deduct */ },
    rollback: async () => { /* release lock */ }
  })
  .addParticipant({
    id: 'target',
    prepare: async () => true,
    commit: async () => { /* credit */ },
    rollback: async () => { /* nothing */ }
  })

const result = await transfer.execute()
```

See [Cross-DO Patterns](./patterns/cross-do.md) for full details.

## Storage APIs

### SQLite (Direct)

```typescript
const sql = this.ctx.storage.sql

// Parameterized queries (preferred)
const user = sql.exec<User>(
  `SELECT * FROM users WHERE id = ?`,
  userId
).one()

// Insert with returning
const newUser = sql.exec<User>(
  `INSERT INTO users (id, name) VALUES (?, ?) RETURNING *`,
  id, name
).one()

// Query multiple rows
const users = sql.exec<User>(`SELECT * FROM users`).toArray()
```

### Things Store

```typescript
// Create
const customer = await things.create({
  $type: 'Customer',
  name: 'Alice',
  email: 'alice@example.com'
})

// Read
const customer = await things.get('thing-id')

// Update
await things.update('thing-id', { name: 'Alice Smith' })

// Delete
await things.delete('thing-id')

// Query
const customers = await things.query({ $type: 'Customer' })
```

### Events Store

```typescript
// Record event
await events.record({
  verb: 'signup',
  source: 'Customer:cust-123',
  data: { plan: 'pro' }
})

// Query events
const signups = await events.query({
  verb: 'signup',
  since: new Date('2024-01-01')
})
```

### Relationships Store

```typescript
// Create relationship
await relationships.create({
  subject: 'Customer:cust-123',
  predicate: 'purchased',
  object: 'Product:prod-456'
})

// Query relationships
const purchases = await relationships.query({
  subject: 'Customer:cust-123',
  predicate: 'purchased'
})
```

## Security APIs

### SQL Sanitization

```typescript
import { SqlSanitizer } from 'dotdo/lib/security/sanitizers'

// Use parameterized queries instead when possible
const safeName = SqlSanitizer.sanitizeValue("O'Brien")
const safeTable = SqlSanitizer.sanitizeIdentifier('user"data')
const safePattern = SqlSanitizer.sanitizeLikePattern('100%_discount')
```

### XSS Prevention

```typescript
import { HtmlEscaper } from 'dotdo/lib/security/sanitizers'

const safe = HtmlEscaper.escape('<script>alert("xss")</script>')
const safeObj = HtmlEscaper.sanitizeForJson({ name: '<b>Alice</b>' })
```

### Prototype Pollution Prevention

```typescript
import { ObjectSanitizer } from 'dotdo/lib/security/sanitizers'

if (ObjectSanitizer.hasDangerousKeys(input)) {
  throw new Error('Invalid input')
}
const safe = ObjectSanitizer.sanitize(input)
```

### Rate Limiting

```typescript
import { createRateLimiter } from 'dotdo/lib/security/rate-limiter'

const limiter = createRateLimiter('standard')  // 100 req/min
// Or: createRateLimiter('strict')   // 10 req/min
// Or: createRateLimiter('relaxed')  // 1000 req/min
// Or: createRateLimiter({ requests: 50, windowSeconds: 60 })

const result = limiter.check('user:123')
if (!result.allowed) {
  return new Response('Too Many Requests', { status: 429 })
}
```

See [Security Best Practices](./security/best-practices.md) for full details.

## Capabilities

### Filesystem

```typescript
if (hasFs($)) {
  const content = await $.fs.readFile('/data/config.json')
  await $.fs.writeFile('/data/output.txt', 'Hello')
  const files = await $.fs.readDir('/data')
  const exists = await $.fs.exists('/data/file.txt')
}
```

### Git

```typescript
if (hasGit($)) {
  const status = await $.git.status()
  await $.git.add(['file.txt'])
  await $.git.commit('Update file')
  await $.git.push()
}
```

### Bash

```typescript
if (hasBash($)) {
  const result = await $.bash.exec('ls -la')
  console.log(result.stdout)
}
```

See [Capabilities](./api/workflow-context.md#capabilities) for full details.

## Type Extensions

```typescript
// Extend for type-safe events and nouns
declare module 'dotdo/types' {
  interface NounRegistry {
    Customer: { id: string; email: string }
    Order: { id: string; total: number }
  }

  interface EventPayloadMap {
    'Customer.created': { id: string; email: string }
    'Order.placed': { id: string; total: number }
  }
}
```

## Quick Start

```typescript
import { DurableObject } from 'cloudflare:workers'
import type { WorkflowContext } from 'dotdo/types'

export class MyDO extends DurableObject {
  private $!: WorkflowContext

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    // Events
    this.$.on.User.signup(async (event) => {
      await this.sendWelcome(event.data.email)
    })

    // Scheduling
    this.$.every.day.at9am(async () => {
      await this.dailyReport()
    })
  }

  async createUser(email: string): Promise<void> {
    // Fire-and-forget
    this.$.send('User.signup', { email })

    // Durable operation
    await this.$.do('sendEmail', { to: email, template: 'welcome' })
  }
}
```

See [Getting Started](./getting-started.md) for a complete tutorial.
