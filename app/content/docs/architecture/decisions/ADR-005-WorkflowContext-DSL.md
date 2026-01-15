# ADR-005: WorkflowContext ($) DSL

## Status

Accepted

## Context

Workflow orchestration in serverless environments traditionally requires:
1. Verbose configuration files for scheduling
2. Explicit event bus setup and subscription management
3. Manual durability handling with retries and timeouts
4. Boilerplate for cross-service communication

We needed a fluent DSL that:
- Reads like natural language
- Handles scheduling without CRON syntax knowledge
- Supports infinite event types via dynamic generation
- Provides durability guarantees with minimal configuration
- Enables promise pipelining for cross-DO communication

## Decision

Implement WorkflowContext ($) as a unified interface with six pillars:

### The Six Pillars

| Pillar | API | Purpose |
|--------|-----|---------|
| **Events** | `on.Noun.verb()` | React to domain events with wildcards |
| **Scheduling** | `every.Monday.at9am()` | Human-readable cron scheduling |
| **Durability** | `send()`, `waitFor()` | Fire-and-forget events and human-in-the-loop |
| **Conditionals** | `when()`, `branch()`, `match()` | Declarative workflow branching |
| **RPC** | `$.Customer(id).method()` | Type-safe cross-DO communication |
| **Cascade** | Tier-based escalation | Automatic code -> AI -> human escalation |

### Event Handlers with Proxy Magic

JavaScript Proxies enable infinite Noun.verb combinations without pre-registration:

```typescript
on.Customer.signup(handler)     // Works
on.Payment.failed(handler)      // Works
on.Spaceship.launched(handler)  // Also works - no registration needed
on.*.created(handler)           // Wildcard handlers
```

Implementation uses nested proxies:

```typescript
const on = new Proxy({}, {
  get(_, noun) {
    return new Proxy({}, {
      get(_, verb) {
        return (handler, opts) => registerHandler(`${noun}.${verb}`, handler, opts)
      }
    })
  }
})
```

### Fluent Scheduling DSL

Human-readable scheduling that generates CRON:

```typescript
every.Monday.at9am(handler)          // 0 9 * * 1
every.day.at('6pm')(handler)         // 0 18 * * *
every.hour(handler)                  // 0 * * * *
every(5).minutes(handler)            // */5 * * * *
every.month.on(1).at('midnight')     // 0 0 1 * *
```

Implementation chains builder methods:

```typescript
const every = new Proxy(createBuilder(), {
  get(target, prop) {
    if (typeof prop === 'string') {
      return target.setComponent(prop)
    }
    return target
  },
  apply(target, _, args) {
    return target.setInterval(args[0])
  }
})
```

### Three Durability Levels

```typescript
$.send(event)   // Fire-and-forget - emit to Pipeline
$.try(action)   // Single attempt - no retries
$.do(action)    // Durable - retries with exponential backoff
```

### Declarative Conditionals

```typescript
// Simple conditional
const result = when(order.total > 1000, {
  then: () => applyDiscount(order),
  else: () => order
})

// Multi-way branching
const action = $.branch(order.status, {
  pending: () => $.Order(order).process(),
  shipped: () => $.Order(order).track(),
  delivered: () => $.Order(order).archive(),
  default: () => $.Order(order).review()
})

// Pattern matching
const handler = $.match(event.type, {
  'user.created': handleUserCreated,
  'user.updated': handleUserUpdated,
  'user.*': handleUserEvent,  // Wildcard
  default: handleUnknown
})
```

### Promise Pipelining for RPC

Operations captured as expressions for deferred execution:

```typescript
// Traditional - 3 round trips
const user = await $.User(userId).get()
const orders = await $.Order(user.id).list()
const total = await $.Analytics(orders).summarize()

// Pipelined - 1 round trip
const user = $.User(userId).get()           // Not awaited - returns expression
const orders = $.Order(user.id).list()      // Uses unawaited user
const total = await $.Analytics(orders).summarize()  // Await triggers batch execution
```

## Consequences

### Positive

- **Readable code** - `every.Monday.at9am()` vs `0 9 * * 1`
- **Infinite vocabulary** - Any Noun.verb combination works
- **Minimal boilerplate** - DSL handles registration and cleanup
- **Efficient RPC** - Pipelining reduces round-trips
- **Declarative flow** - Conditionals are expressions, not statements

### Negative

- **Proxy magic** - Harder to debug and understand
- **TypeScript complexity** - Typing infinite proxies is challenging
- **Expression evaluation** - Deferred execution can surprise developers
- **Cleanup responsibility** - Must clear handlers on DO destruction

### Mitigations

- Clear documentation of proxy behavior
- TypeScript overloads for common patterns
- Explicit `await` requirements documented
- Context-based handler cleanup API

## API Examples

### Event Handling

```typescript
// Register with context for automatic cleanup
const unsubscribe = on.Order.created((event) => {
  console.log(`Order ${event.data.$id} created`)
}, { context: 'order-handler' })

// Wildcard handlers
on.*.created((event) => {
  console.log(`${event.type} created`)
})

// Manual cleanup
unsubscribe()
// or
clearHandlersByContext('order-handler')
```

### Scheduling

```typescript
// Weekly report
every.Monday.at9am(() => generateReport())

// Daily cleanup
every.day.at('midnight')(() => cleanupOldData())

// Custom interval
every(15).minutes(() => checkHealth())
```

### Cross-DO RPC

```typescript
const $ = createWorkflowProxy({ execute: rpc.execute })

// Single call
const profile = await $.Customer('cust-123').getProfile()

// Pipelined calls
const summary = await $.Customer('cust-123')
  .getOrders()
  .then(orders => $.Analytics(orders).summarize())
```

## References

- `/docs/workflow/index.mdx` - WorkflowContext overview
- `/docs/workflow/events.mdx` - Event handling with wildcards
- `/docs/workflow/scheduling.mdx` - Fluent scheduling DSL
- `/docs/workflow/durability.mdx` - Durability levels
- `/docs/workflow/rpc.mdx` - Cross-DO communication
- `/docs/workflow/cascade.mdx` - Escalation tiers
