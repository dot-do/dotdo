# dotdo Documentation

Welcome to the dotdo documentation. dotdo is a runtime/framework layer for building durable, event-driven applications on Cloudflare Durable Objects.

## Quick Links

- [Getting Started](./getting-started.md) - Build your first Durable Object in 5 minutes
- [API Reference](./API.md) - Quick reference for all APIs
- [Migration Guide](./migration.md) - Migrate from vanilla Durable Objects

## Documentation

### Core Concepts

| Document | Description |
|----------|-------------|
| [Getting Started](./getting-started.md) | Installation, first DO, basic usage |
| [$ Context API](./api/workflow-context.md) | Full API reference for workflow context |
| [API Quick Reference](./API.md) | Condensed reference for all APIs |

### Patterns

| Document | Description |
|----------|-------------|
| [Cross-DO Transactions](./patterns/cross-do.md) | Saga and 2PC patterns for distributed transactions |

### Security

| Document | Description |
|----------|-------------|
| [Security Best Practices](./security/best-practices.md) | SQL injection, XSS, rate limiting |

### Migration

| Document | Description |
|----------|-------------|
| [Migration Guide](./migration.md) | Step-by-step migration from vanilla DOs |

## Architecture Overview

```
                    +-------------------+
                    |   Hono Worker     |
                    |   (passthrough)   |
                    +--------+----------+
                             |
                             v
                    +--------+----------+
                    |   Durable Object  |
                    |                   |
                    |  +-------------+  |
                    |  | $ Context   |  |
                    |  |             |  |
                    |  | - Events    |  |
                    |  | - Schedules |  |
                    |  | - Durability|  |
                    |  | - Cross-DO  |  |
                    |  +-------------+  |
                    |                   |
                    |  +-------------+  |
                    |  | SQLite      |  |
                    |  | - Things    |  |
                    |  | - Events    |  |
                    |  | - Relations |  |
                    |  +-------------+  |
                    +-------------------+
```

## Key Features

### Three Durability Levels

```typescript
$.send(event)    // Fire-and-forget
$.try(action)    // Single attempt
$.do(action)     // Durable with retries
```

See [$ Context API](./api/workflow-context.md#execution-modes) for details.

### Event Subscriptions

```typescript
$.on.Customer.signup(handler)   // Specific event
$.on.Payment.failed(handler)    // Another event
$.on['*'].created(handler)      // Wildcard pattern
```

See [$ Context API](./api/workflow-context.md#event-subscriptions) for details.

### Declarative Scheduling

```typescript
$.every.Monday.at9am(handler)   // Weekly
$.every.day.at6pm(handler)      // Daily
$.every.hour(handler)           // Hourly
```

See [$ Context API](./api/workflow-context.md#scheduling) for details.

### Cross-DO Communication

```typescript
await $.Customer(id).notify()   // Call another DO
await $.Invoice(id).send()      // RPC-style calls
```

See [Cross-DO Patterns](./patterns/cross-do.md) for advanced patterns.

## Testing Philosophy

dotdo uses Miniflare to run real Durable Objects with real SQLite locally. **No mocking required.**

```typescript
import { env } from 'cloudflare:test'

const stub = env.DO.get(env.DO.idFromName('test'))
const result = await stub.things.create({ $type: 'Customer', name: 'Alice' })
expect(result.$id).toBeDefined()
```

## Related Projects

- [workers.do](https://workers.do) - Platform/Product layer built on dotdo
- [MDXUI](https://mdxui.dev) - UI components
