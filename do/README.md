# @dotdo/do

> Digital Objects with infinite durability and zero configuration

[![npm version](https://img.shields.io/npm/v/@dotdo/do.svg)](https://www.npmjs.com/package/@dotdo/do)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)

## The Problem

Building stateful applications on serverless is painful:

- **State management chaos** - Managing state across ephemeral workers requires external databases, caching layers, and complex synchronization
- **Infrastructure overhead** - You need Redis for caching, Postgres for persistence, Kafka for events, cron jobs for scheduling
- **Coordination nightmares** - Distributed locks, race conditions, and consistency issues plague every multi-step operation

You wanted serverless simplicity. You got distributed systems complexity.

## The Solution

**DO** = **D**urable **O**bject = **D**igital **O**bject

One class that gives you:

```typescript
import { DO } from '@dotdo/do'

export class MyApp extends DO {
  async handleSignup(email: string) {
    // Create a thing (auto-persisted to SQLite)
    const customer = await this.things.create({
      $type: 'Customer',
      email,
      plan: 'free'
    })

    // Fire events (durably)
    await this.$.send({ type: 'Customer.signup', data: customer })

    // Schedule follow-up (built-in cron)
    this.$.every.day.at('9am')(async () => {
      await this.checkOnboarding(customer.$id)
    })

    return customer
  }
}
```

## Quick Start

### Installation

```bash
npm install @dotdo/do
```

### Define Your DO

```typescript
// src/DO.ts
import { DO } from '@dotdo/do'

export class AppDO extends DO {
  // Built-in storage - no configuration needed
  async createCustomer(data: { name: string; email: string }) {
    return this.things.create({ $type: 'Customer', ...data })
  }

  async getCustomer(id: string) {
    return this.things.get(id)
  }
}
```

### Configure Wrangler

```toml
# wrangler.toml
[[durable_objects.bindings]]
name = "DO"
class_name = "AppDO"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["AppDO"]
```

### Use From Your Worker

```typescript
export default {
  async fetch(request: Request, env: Env) {
    const id = env.DO.idFromName('default')
    const stub = env.DO.get(id)
    return stub.fetch(request)
  }
}
```

## Features

### Built-in Entities

Every DO comes with built-in storage for common entities:

```typescript
// Things - your domain objects
await this.things.create({ $type: 'Customer', name: 'Alice' })
await this.things.list({ type: 'Customer' })

// Relationships - connect things
await this.relationships.create({
  subject: customer.$id,
  predicate: 'purchased',
  object: product.$id
})

// Events - immutable audit log
await this.events.emit({ type: 'Order.shipped', data: { orderId } })
```

### WorkflowContext ($)

The `$` context provides a fluent API for durability:

```typescript
// Event handlers (infinite Noun.verb combinations via Proxy)
this.$.on.Customer.signup(async (event) => {
  await this.$.send({ type: 'welcome-email', to: event.email })
})

// Durability levels
this.$.send(event)         // Fire-and-forget
this.$.try(action)         // Single attempt
this.$.do(action)          // Durable with retries

// Scheduling (fluent DSL to CRON)
this.$.every.Monday.at('9am')(generateWeeklyReport)
this.$.every.day.at('6pm')(sendDailySummary)
this.$.every.hour(checkHeartbeats)
```

### Cross-DO RPC

Call methods on other Durable Objects with type safety:

```typescript
// Call another DO's methods directly
const customer = await this.$.Customer('user-123').get()
const inventory = await this.$.Inventory('sku-456').check()

// Chain operations across DOs
await this.$.Order(orderId).confirm()
await this.$.Customer('user-123').notify({ message: 'Order confirmed!' })
```

### SQLite Storage

Built-in SQLite with automatic schema management:

```typescript
// Direct SQL when you need it
const results = await this.sql`
  SELECT * FROM things
  WHERE $type = 'Customer'
  AND data->>'plan' = 'enterprise'
`

// Or use the fluent API
const enterprise = await this.things.list({
  type: 'Customer',
  where: { plan: 'enterprise' }
})
```

## API Reference

### DO Class

| Property | Type | Description |
|----------|------|-------------|
| `things` | ThingsStore | CRUD operations for Things |
| `relationships` | RelationshipsStore | Graph relationships |
| `events` | EventsStore | Immutable event log |
| `$` | WorkflowContext | Event handlers, scheduling, cross-DO RPC |
| `sql` | SqlStorage | Direct SQLite access |

### ThingsStore

```typescript
interface ThingsStore {
  create(data: ThingInput): Promise<Thing>
  get(id: string): Promise<Thing | null>
  update(id: string, data: Partial<ThingInput>): Promise<Thing>
  delete(id: string): Promise<boolean>
  list(options?: ListOptions): Promise<Thing[]>
}
```

### WorkflowContext ($)

```typescript
interface WorkflowContext {
  // Event emission
  send(event: Event): void           // Fire-and-forget
  try<T>(fn: () => T): Promise<T>    // Single attempt
  do<T>(fn: () => T): Promise<T>     // With retries

  // Event handlers
  on: {
    [Noun: string]: {
      [verb: string]: (handler: EventHandler) => void
    }
  }

  // Scheduling
  every: ScheduleBuilder

  // Cross-DO RPC
  [DOName: string]: (id: string) => DOProxy
}
```

## Examples

### E-commerce Order Flow

```typescript
export class OrderDO extends DO {
  async placeOrder(customerId: string, items: Item[]) {
    // Create order
    const order = await this.things.create({
      $type: 'Order',
      customerId,
      items,
      status: 'pending'
    })

    // Check inventory via cross-DO RPC
    for (const item of items) {
      const available = await this.$.Inventory(item.sku).check()
      if (!available) throw new Error(`${item.sku} out of stock`)
    }

    // Process payment
    await this.$.do(async () => {
      await this.$.Payment(order.$id).charge()
    })

    // Update status
    await this.things.update(order.$id, { status: 'paid' })

    // Emit event for downstream handlers
    await this.$.send({ type: 'Order.placed', data: order })

    return order
  }
}
```

### Event-Driven Workflows

```typescript
export class NotificationDO extends DO {
  constructor(state: DurableObjectState, env: Env) {
    super(state, env)

    // React to events
    this.$.on.Customer.signup(async (event) => {
      await this.sendWelcomeEmail(event.data.email)
    })

    this.$.on.Order.shipped(async (event) => {
      await this.sendTrackingEmail(event.data)
    })

    // Daily digest
    this.$.every.day.at('6pm')(async () => {
      await this.sendDailyDigest()
    })
  }
}
```

## Related Packages

| Package | Description |
|---------|-------------|
| [@dotdo/db](/db) | Abstract storage layer |
| [@dotdo/rpc](/rpc) | Cap'n Web RPC transport |
| [@dotdo/api](/api) | Self-describing Hono API |
| [@dotdo/ai](/ai) | AI template literals |
| [@dotdo/auth](/auth) | JWT authentication |
| [@dotdo/mcp](/mcp) | Model Context Protocol tools |

## License

MIT
