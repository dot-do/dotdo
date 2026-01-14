# Migrating from Vanilla Durable Objects to dotdo

This guide helps you migrate existing Cloudflare Durable Objects to dotdo, gaining access to the `$` workflow context, event system, and cross-DO patterns.

> **Related:** [Getting Started](./getting-started.md) | [$ Context API](./api/workflow-context.md) | [Security Best Practices](./security/best-practices.md)

## Why Migrate?

| Feature | Vanilla DO | dotdo |
|---------|-----------|-------|
| Event handling | Manual | `$.on.Noun.verb()` |
| Scheduling | Alarms only | `$.every.Monday.at9am()` |
| Durability | Manual | `$.send/$.try/$.do` |
| Cross-DO calls | Fetch-based | `$.Noun(id).method()` |
| State management | Manual SQL | Typed stores |
| Security | DIY | Built-in sanitizers |

## Migration Steps

### Step 1: Before (Vanilla DO)

```typescript
import { DurableObject } from 'cloudflare:workers'

interface User {
  id: string
  email: string
  name: string
}

export class UserServiceVanilla extends DurableObject {
  private users: Map<string, User> = new Map()

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/users' && request.method === 'POST') {
      const body = await request.json() as { email: string; name: string }
      return this.createUser(body.email, body.name)
    }

    if (url.pathname.startsWith('/users/') && request.method === 'GET') {
      const id = url.pathname.split('/')[2]
      return this.getUser(id!)
    }

    return new Response('Not found', { status: 404 })
  }

  private async createUser(email: string, name: string): Promise<Response> {
    const sql = this.ctx.storage.sql

    // Manual table creation
    sql.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE,
        name TEXT,
        created_at INTEGER
      )
    `)

    const id = crypto.randomUUID()
    const now = Date.now()

    try {
      sql.exec(
        `INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)`,
        id, email, name, now
      )

      const user = { id, email, name }

      // Manual event emission - must implement yourself
      await this.emitEvent('User.created', user)

      return Response.json(user, { status: 201 })
    } catch (error) {
      return Response.json({ error: 'User exists' }, { status: 409 })
    }
  }

  private async getUser(id: string): Promise<Response> {
    const sql = this.ctx.storage.sql
    const result = sql.exec<User>(
      `SELECT id, email, name FROM users WHERE id = ?`,
      id
    ).one()

    if (!result) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }

    return Response.json(result)
  }

  // Manual event system - you must build this
  private async emitEvent(eventName: string, data: unknown): Promise<void> {
    console.log(`Event: ${eventName}`, data)
  }

  // Manual alarm handling for scheduling
  async alarm(): Promise<void> {
    // All scheduled tasks crammed into one handler
    const sql = this.ctx.storage.sql
    const time = new Date()

    if (time.getHours() === 9 && time.getDay() === 1) {
      await this.generateWeeklyReport()
    }
  }

  private async generateWeeklyReport(): Promise<void> {
    console.log('Generating weekly report')
  }
}
```

### Step 2: After (dotdo)

```typescript
import { DurableObject } from 'cloudflare:workers'
import type { WorkflowContext, DomainEvent } from 'dotdo/types'

interface User {
  id: string
  email: string
  name: string
}

interface UserCreatedData {
  id: string
  email: string
  name: string
}

export class UserService extends DurableObject {
  private $!: WorkflowContext

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.setupEventHandlers()
    this.setupSchedules()
  }

  private setupEventHandlers(): void {
    // Declarative event handling
    this.$.on.User.created(async (event: DomainEvent<UserCreatedData>) => {
      await this.sendWelcomeEmail(event.data.email, event.data.name)
    })

    this.$.on.User.deleted(async (event: DomainEvent<{ id: string }>) => {
      await this.cleanupUserData(event.data.id)
    })
  }

  private setupSchedules(): void {
    // Declarative scheduling
    this.$.every.Monday.at9am(async () => {
      await this.generateWeeklyReport()
    })

    this.$.every.day.at6pm(async () => {
      await this.sendDailySummary()
    })
  }

  async createUser(email: string, name: string): Promise<User> {
    const sql = this.ctx.storage.sql

    sql.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE,
        name TEXT,
        created_at INTEGER
      )
    `)

    const id = crypto.randomUUID()
    const now = Date.now()

    sql.exec(
      `INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, ?)`,
      id, email, name, now
    )

    const user = { id, email, name }

    // Durable event emission with automatic retry
    this.$.send('User.created', user)

    return user
  }

  async getUser(id: string): Promise<User | null> {
    const sql = this.ctx.storage.sql
    return sql.exec<User>(
      `SELECT id, email, name FROM users WHERE id = ?`,
      id
    ).one()
  }

  private async sendWelcomeEmail(email: string, name: string): Promise<void> {
    // Use $.do for durable execution with retries
    await this.$.do<void>(
      'sendEmail',
      { to: email, subject: 'Welcome!', template: 'welcome', data: { name } },
      { retry: { maxAttempts: 3 } }
    )
  }

  private async cleanupUserData(userId: string): Promise<void> {
    console.log(`Cleaning up data for user: ${userId}`)
  }

  private async generateWeeklyReport(): Promise<void> {
    console.log('Generating weekly report')
  }

  private async sendDailySummary(): Promise<void> {
    console.log('Sending daily summary')
  }
}

interface Env {
  USER_SERVICE: DurableObjectNamespace
}
```

## Pattern Migrations

### Event Handling

**Before (manual):**

```typescript
class VanillaDO extends DurableObject {
  private handlers: Map<string, Array<(data: unknown) => Promise<void>>> = new Map()

  registerHandler(event: string, handler: (data: unknown) => Promise<void>): void {
    const handlers = this.handlers.get(event) || []
    handlers.push(handler)
    this.handlers.set(event, handlers)
  }

  async emit(event: string, data: unknown): Promise<void> {
    const handlers = this.handlers.get(event) || []
    for (const handler of handlers) {
      try {
        await handler(data)
      } catch (error) {
        console.error(`Handler failed for ${event}:`, error)
      }
    }
  }
}
```

**After (dotdo):**

```typescript
class DotdoDO extends DurableObject {
  private $!: WorkflowContext

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    // Declarative, type-safe event handling
    this.$.on.Order.placed(async (event) => {
      await this.processOrder(event.data)
    })

    // Wildcards for cross-cutting concerns
    this.$.on['*'].created(async (event) => {
      await this.auditLog('create', event)
    })
  }

  private async processOrder(data: unknown): Promise<void> {
    console.log('Processing order:', data)
  }

  private async auditLog(action: string, event: unknown): Promise<void> {
    console.log(`Audit: ${action}`, event)
  }
}

interface Env {
  DOTDO_DO: DurableObjectNamespace
}
```

### Scheduling

**Before (alarm-based):**

```typescript
class VanillaDO extends DurableObject {
  async alarm(): Promise<void> {
    const sql = this.ctx.storage.sql
    const now = new Date()
    const hour = now.getHours()
    const day = now.getDay()

    // Manual schedule checking
    if (hour === 9) {
      await this.dailyTask()
    }

    if (hour === 9 && day === 1) {
      await this.weeklyTask()
    }

    // Must manually set next alarm
    const nextAlarm = new Date()
    nextAlarm.setHours(nextAlarm.getHours() + 1, 0, 0, 0)
    await this.ctx.storage.setAlarm(nextAlarm.getTime())
  }

  private async dailyTask(): Promise<void> {
    console.log('Daily task')
  }

  private async weeklyTask(): Promise<void> {
    console.log('Weekly task')
  }
}
```

**After (dotdo):**

```typescript
class DotdoDO extends DurableObject {
  private $!: WorkflowContext

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    // Declarative scheduling - no manual alarm management
    this.$.every.day.at9am(async () => {
      await this.dailyTask()
    })

    this.$.every.Monday.at9am(async () => {
      await this.weeklyTask()
    })

    this.$.every.hour(async () => {
      await this.hourlyCheck()
    })

    // Natural language
    this.$.every('every 15 minutes', async () => {
      await this.frequentTask()
    })
  }

  private async dailyTask(): Promise<void> {
    console.log('Daily task')
  }

  private async weeklyTask(): Promise<void> {
    console.log('Weekly task')
  }

  private async hourlyCheck(): Promise<void> {
    console.log('Hourly check')
  }

  private async frequentTask(): Promise<void> {
    console.log('Frequent task')
  }
}

interface Env {
  DOTDO_DO: DurableObjectNamespace
}
```

### Cross-DO Communication

**Before (fetch-based):**

```typescript
class OrderDO extends DurableObject {
  async processOrder(orderId: string): Promise<void> {
    // Manual fetch to another DO
    const inventoryId = this.env.INVENTORY_DO.idFromName('main')
    const inventoryStub = this.env.INVENTORY_DO.get(inventoryId)

    const response = await inventoryStub.fetch(
      new Request('https://do/reserve', {
        method: 'POST',
        body: JSON.stringify({ orderId, items: ['item-1'] })
      })
    )

    if (!response.ok) {
      throw new Error('Inventory reservation failed')
    }

    const reservation = await response.json() as { id: string }
    console.log(`Reserved: ${reservation.id}`)
  }

  private env!: Env
}

interface Env {
  INVENTORY_DO: DurableObjectNamespace
}
```

**After (dotdo):**

```typescript
interface ReservationResult {
  id: string
  items: string[]
}

class OrderDO extends DurableObject {
  private $!: WorkflowContext

  async processOrder(orderId: string): Promise<void> {
    // Type-safe cross-DO calls
    const reservation = await this.$.Inventory('main').reserve({
      orderId,
      items: ['item-1']
    }) as ReservationResult

    console.log(`Reserved: ${reservation.id}`)

    // Or use durable execution for critical operations
    await this.$.do<ReservationResult>('processInventory', {
      orderId,
      reservationId: reservation.id
    })
  }
}
```

### Error Handling and Retries

**Before (manual):**

```typescript
class PaymentDO extends DurableObject {
  async chargeCustomer(customerId: string, amount: number): Promise<void> {
    const maxAttempts = 3
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await this.charge(customerId, amount)
        return
      } catch (error) {
        lastError = error as Error
        const delay = Math.pow(2, attempt) * 100
        await new Promise(r => setTimeout(r, delay))
      }
    }

    throw lastError
  }

  private async charge(customerId: string, amount: number): Promise<void> {
    console.log(`Charging ${customerId}: $${amount}`)
  }
}
```

**After (dotdo):**

```typescript
class PaymentDO extends DurableObject {
  private $!: WorkflowContext

  async chargeCustomer(customerId: string, amount: number): Promise<void> {
    // Automatic retries with exponential backoff
    await this.$.do<void>('charge', { customerId, amount }, {
      retry: {
        maxAttempts: 3,
        initialDelayMs: 100,
        backoffMultiplier: 2
      }
    })
  }
}
```

## Migration Checklist

### Phase 1: Setup

- [ ] Install dotdo: `npm install dotdo`
- [ ] Update `wrangler.toml` with new migrations
- [ ] Add TypeScript types from `dotdo/types`

### Phase 2: Event System

- [ ] Replace manual event handlers with `$.on.Noun.verb()`
- [ ] Replace manual event emission with `$.send()`
- [ ] Add typed event payloads via module augmentation

### Phase 3: Scheduling

- [ ] Replace alarm-based scheduling with `$.every`
- [ ] Remove manual alarm management code
- [ ] Use natural language schedules where appropriate

### Phase 4: Cross-DO Communication

- [ ] Replace fetch-based calls with `$.Noun(id).method()`
- [ ] Implement CrossDOSaga for complex flows
- [ ] Add 2PC for atomic cross-DO transactions

### Phase 5: Security

- [ ] Add SqlSanitizer for any dynamic SQL
- [ ] Add HtmlEscaper for user-facing content
- [ ] Add RateLimiter for public endpoints
- [ ] Add ObjectSanitizer for JSON body parsing

### Phase 6: Testing

- [ ] Update tests to use miniflare
- [ ] Remove all mocks (use real DO instances)
- [ ] Add integration tests for cross-DO flows

## Common Migration Issues

### Issue: Alarm handler still needed

dotdo's scheduling builds on alarms. If you have custom alarm logic, keep it:

```typescript
class HybridDO extends DurableObject {
  private $!: WorkflowContext

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)

    // dotdo scheduling
    this.$.every.hour(async () => {
      await this.hourlyTask()
    })
  }

  // Keep custom alarm logic if needed
  async alarm(): Promise<void> {
    // Custom logic not covered by $.every
    await this.customAlarmLogic()
  }

  private async hourlyTask(): Promise<void> {
    console.log('Hourly task')
  }

  private async customAlarmLogic(): Promise<void> {
    console.log('Custom alarm logic')
  }
}

interface Env {
  HYBRID_DO: DurableObjectNamespace
}
```

### Issue: Type mismatches

Use module augmentation for typed events:

```typescript
// types/domain.ts
declare module 'dotdo/types' {
  interface NounRegistry {
    User: { id: string; email: string }
    Order: { id: string; total: number }
  }

  interface EventPayloadMap {
    'User.created': { id: string; email: string }
    'Order.placed': { id: string; total: number; items: string[] }
  }
}
```

### Issue: Existing fetch handler

Keep your fetch handler, use `$` for internal operations:

```typescript
class ApiDO extends DurableObject {
  private $!: WorkflowContext

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/orders' && request.method === 'POST') {
      const body = await request.json() as { items: string[] }
      const order = await this.createOrder(body.items)

      // Use $ for events
      this.$.send('Order.created', order)

      return Response.json(order)
    }

    return new Response('Not found', { status: 404 })
  }

  private async createOrder(items: string[]): Promise<{ id: string; items: string[] }> {
    return { id: crypto.randomUUID(), items }
  }
}
```

## Related Documentation

- [Getting Started](./getting-started.md) - Quick start guide
- [$ Context API](./api/workflow-context.md) - Full API reference
- [API Quick Reference](./API.md) - Condensed reference for all APIs
- [Cross-DO Patterns](./patterns/cross-do.md) - Saga and 2PC patterns
- [Security Best Practices](./security/best-practices.md) - Sanitizers and rate limiting

---

[Back to Documentation Index](./README.md)
