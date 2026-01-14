# Getting Started with dotdo

Build durable, event-driven applications with the `$` workflow context. This guide gets you from zero to a working Durable Object in 5 minutes.

> **Related:** [API Quick Reference](./API.md) | [Full $ Context API](./api/workflow-context.md) | [Migration Guide](./migration.md)

## Installation

```typescript
npm install dotdo
```

## Your First Durable Object

Create a simple counter that persists across requests:

```typescript
import { DurableObject } from 'cloudflare:workers'

export class Counter extends DurableObject {
  async increment(): Promise<number> {
    const sql = this.ctx.storage.sql

    // Create table if not exists
    sql.exec(`
      CREATE TABLE IF NOT EXISTS counter (
        id TEXT PRIMARY KEY,
        value INTEGER DEFAULT 0
      )
    `)

    // Upsert and return new value
    const result = sql.exec<{ value: number }>(`
      INSERT INTO counter (id, value) VALUES ('main', 1)
      ON CONFLICT (id) DO UPDATE SET value = value + 1
      RETURNING value
    `).one()

    return result?.value ?? 1
  }

  async getCount(): Promise<number> {
    const sql = this.ctx.storage.sql
    const result = sql.exec<{ value: number }>(`
      SELECT value FROM counter WHERE id = 'main'
    `).one()
    return result?.value ?? 0
  }
}
```

## Using the $ Context

The `$` context provides three durability levels for executing actions:

```typescript
import { DurableObject } from 'cloudflare:workers'
import type { WorkflowContext } from 'dotdo/types'

export class OrderProcessor extends DurableObject {
  private $!: WorkflowContext

  async processOrder(orderId: string): Promise<void> {
    // Fire-and-forget - for analytics, logging
    this.$.send('Order.received', { orderId, timestamp: Date.now() })

    // Single attempt - for idempotent operations
    const inventory = await this.$.try<{ available: boolean }>(
      'checkInventory',
      { orderId }
    )

    // Durable with retries - for critical operations
    if (inventory.available) {
      await this.$.do<{ chargeId: string }>(
        'processPayment',
        { orderId },
        { retry: { maxAttempts: 3 } }
      )
    }
  }
}
```

## Event Subscriptions

React to domain events with `$.on.Noun.verb()`:

```typescript
import { DurableObject } from 'cloudflare:workers'
import type { WorkflowContext, DomainEvent } from 'dotdo/types'

interface CustomerData {
  id: string
  email: string
  name: string
}

export class NotificationService extends DurableObject {
  private $!: WorkflowContext

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.registerHandlers()
  }

  private registerHandlers(): void {
    // Handle customer signup
    this.$.on.Customer.signup(async (event: DomainEvent<CustomerData>) => {
      await this.sendWelcomeEmail(event.data.email, event.data.name)
    })

    // Handle payment failures
    this.$.on.Payment.failed(async (event: DomainEvent<{ orderId: string }>) => {
      await this.notifySupport(event.data.orderId)
    })

    // Wildcard: handle all created events
    this.$.on['*'].created(async (event: DomainEvent) => {
      console.log(`Entity created: ${event.source}`)
    })
  }

  private async sendWelcomeEmail(email: string, name: string): Promise<void> {
    console.log(`Sending welcome email to ${name} at ${email}`)
  }

  private async notifySupport(orderId: string): Promise<void> {
    console.log(`Payment failed for order ${orderId}`)
  }
}

interface Env {
  NOTIFICATION_SERVICE: DurableObjectNamespace
}
```

## Scheduling

Schedule recurring tasks with `$.every`:

```typescript
import { DurableObject } from 'cloudflare:workers'
import type { WorkflowContext } from 'dotdo/types'

export class ReportGenerator extends DurableObject {
  private $!: WorkflowContext

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.setupSchedules()
  }

  private setupSchedules(): void {
    // Every hour
    this.$.every.hour(async () => {
      await this.generateHourlyReport()
    })

    // Every Monday at 9am
    this.$.every.Monday.at9am(async () => {
      await this.generateWeeklyReport()
    })

    // Every day at 6pm
    this.$.every.day.at6pm(async () => {
      await this.sendDailySummary()
    })

    // Natural language (parsed to cron)
    this.$.every('every 15 minutes', async () => {
      await this.checkSystemHealth()
    })
  }

  private async generateHourlyReport(): Promise<void> {
    console.log('Generating hourly report')
  }

  private async generateWeeklyReport(): Promise<void> {
    console.log('Generating weekly report')
  }

  private async sendDailySummary(): Promise<void> {
    console.log('Sending daily summary')
  }

  private async checkSystemHealth(): Promise<void> {
    console.log('Checking system health')
  }
}

interface Env {
  REPORT_GENERATOR: DurableObjectNamespace
}
```

## Worker Entry Point

Connect your Durable Object to a worker:

```typescript
export { Counter, OrderProcessor, NotificationService, ReportGenerator } from './objects'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    // Route to Counter DO
    if (url.pathname === '/counter/increment') {
      const id = env.COUNTER.idFromName('main')
      const stub = env.COUNTER.get(id)
      const count = await stub.increment()
      return Response.json({ count })
    }

    return new Response('Not found', { status: 404 })
  }
}

interface Env {
  COUNTER: DurableObjectNamespace
  ORDER_PROCESSOR: DurableObjectNamespace
  NOTIFICATION_SERVICE: DurableObjectNamespace
  REPORT_GENERATOR: DurableObjectNamespace
}
```

## Wrangler Configuration

Configure your `wrangler.toml`:

```toml
name = "my-app"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[[durable_objects.bindings]]
name = "COUNTER"
class_name = "Counter"

[[durable_objects.bindings]]
name = "ORDER_PROCESSOR"
class_name = "OrderProcessor"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["Counter", "OrderProcessor"]
```

## Next Steps

- [API Quick Reference](./API.md) - Condensed reference for all APIs
- [$ Context API Reference](./api/workflow-context.md) - Full API documentation
- [Cross-DO Patterns](./patterns/cross-do.md) - Saga and 2PC patterns
- [Security Best Practices](./security/best-practices.md) - Sanitizers and rate limiting
- [Migration Guide](./migration.md) - Migrating from vanilla Durable Objects

---

[Back to Documentation Index](./README.md)
