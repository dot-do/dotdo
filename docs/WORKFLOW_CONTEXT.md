# WorkflowContext ($) Guide

This guide covers the WorkflowContext (`$`) features in dotdo, focusing on Cross-DO RPC and Event Wildcard Patterns.

## Table of Contents

1. [Cross-DO RPC](#cross-do-rpc)
   - [Basic Usage](#basic-usage)
   - [Wrangler Configuration](#wrangler-configuration)
   - [Type-Safe Cross-DO Calls](#type-safe-cross-do-calls)
   - [Error Handling](#error-handling)
   - [Circuit Breaker Protection](#circuit-breaker-protection)
   - [Stub Caching](#stub-caching)
2. [Event Wildcard Patterns](#event-wildcard-patterns)
   - [Pattern Types](#pattern-types)
   - [Handler Matching Order](#handler-matching-order)
   - [Use Cases](#use-cases)
   - [Retry Behavior](#retry-behavior)

---

## Cross-DO RPC

The `$.EntityType(id).method()` pattern enables type-safe cross-DO communication. This is the recommended way for Durable Objects to call methods on other Durable Objects.

### Basic Usage

```typescript
// In your DO code
const $ = createContext(state, env)

// Call methods on other DOs
await $.Customer('customer-123').notify({ message: 'Order shipped!' })
await $.Order('order-456').ship()
await $.Payment('payment-789').refund({ amount: 50 })
```

The `$` context uses JavaScript Proxy to dynamically route calls. When you access `$.Customer`, it looks for a binding named `Customer` in your environment and creates a stub for the specified ID.

### Wrangler Configuration

For Cross-DO RPC to work, you must configure DO bindings in `wrangler.toml`:

```toml
name = "my-app"
main = "src/index.ts"
compatibility_date = "2024-12-30"

# Define all DO bindings needed for cross-DO RPC
[durable_objects]
bindings = [
  # Each binding creates a $.BindingName accessor
  { name = "Customer", class_name = "CustomerDO" },
  { name = "Order", class_name = "OrderDO" },
  { name = "Payment", class_name = "PaymentDO" },
  { name = "Notification", class_name = "NotificationDO" },
]

# SQLite migrations for DOs
[[migrations]]
tag = "v1"
new_sqlite_classes = ["CustomerDO", "OrderDO", "PaymentDO", "NotificationDO"]
```

With this configuration:
- `$.Customer(id)` uses the `Customer` binding to access `CustomerDO`
- `$.Order(id)` uses the `Order` binding to access `OrderDO`
- `$.Payment(id)` uses the `Payment` binding to access `PaymentDO`
- `$.Notification(id)` uses the `Notification` binding to access `NotificationDO`

### Type-Safe Cross-DO Calls

For full type safety, define interfaces for your DO methods:

```typescript
// types.ts
export interface CustomerDO {
  notify(params: { message: string }): Promise<NotificationResult>
  getProfile(): Promise<CustomerProfile>
  updateBalance(params: { amount: number; operation: 'credit' | 'debit' }): Promise<{ balance: number }>
}

export interface OrderDO {
  ship(): Promise<{ orderId: string; status: string; shippedAt: number }>
  getStatus(): Promise<{ status: string }>
}

export interface NotificationResult {
  delivered: boolean
  customerId: string
  message: string
  timestamp: number
}
```

Then in your DO implementation:

```typescript
// OrderDO.ts
import { DurableObject } from 'cloudflare:workers'

export class OrderDO extends DurableObject<Env> {
  async ship(): Promise<{ orderId: string; status: string; shippedAt: number }> {
    const order = await this.getOrder()

    if (order.status !== 'pending') {
      throw new Error(`Cannot ship order in ${order.status} status`)
    }

    order.status = 'shipped'
    order.shippedAt = Date.now()
    await this.saveOrder(order)

    // Cross-DO call to notify customer
    const $ = this.getContext()
    const result = await $.Customer(order.customerId).notify({
      message: `Your order ${order.id} has been shipped!`
    })

    return {
      orderId: order.id,
      status: order.status,
      shippedAt: order.shippedAt,
    }
  }
}
```

### Error Handling

Cross-DO calls can fail for various reasons. Always handle errors appropriately:

```typescript
import { NotFoundError, TimeoutError, CircuitOpenError } from '@dotdo/rpc'

async function processOrder(orderId: string) {
  const $ = this.getContext()

  try {
    await $.Order(orderId).ship()
  } catch (error) {
    if (error instanceof NotFoundError) {
      // DO binding not found in environment
      console.error(`Order binding not configured: ${error.message}`)
    } else if (error instanceof TimeoutError) {
      // Cross-DO call timed out
      console.error(`Cross-DO call timed out after ${error.timeout}ms`)
    } else if (error instanceof CircuitOpenError) {
      // Circuit breaker is open, service degraded
      console.error(`Circuit open for ${error.circuitName}`)
      // Use fallback behavior
      return this.handleDegradedMode(orderId)
    } else {
      // Other errors (method threw, network issues, etc.)
      throw error
    }
  }
}
```

**Common Error Scenarios:**

| Error Type | Cause | Recommended Action |
|------------|-------|-------------------|
| `NotFoundError` | DO binding not in env | Check wrangler.toml bindings |
| `TimeoutError` | Call exceeded timeout | Increase timeout or optimize DO |
| `CircuitOpenError` | Too many recent failures | Wait for circuit reset, use fallback |
| `RPCError` | Remote method threw | Handle business logic error |

### Circuit Breaker Protection

Cross-DO RPC includes automatic circuit breaker protection to prevent cascade failures. When a downstream DO is slow or failing, the circuit breaker opens to fail fast.

**Configuration:**

```typescript
const $ = createContext(state, env, {
  circuitBreaker: {
    enabled: true,                    // Enable circuit breaker (default: true)
    failureThreshold: 5,              // Failures before opening (default: 5)
    resetTimeoutMs: 30000,            // Time before trying again (default: 30s)
    successThreshold: 3,              // Successes to close circuit (default: 3)
    timeoutMs: 10000,                 // Request timeout (default: 10s)
    halfOpenRequestRatio: 0.1,        // % of requests in half-open (default: 10%)
    namePrefix: 'my-app',             // Prefix for circuit names
  }
})
```

**Circuit States:**

1. **CLOSED** - Normal operation, all requests pass through
2. **OPEN** - Requests fail immediately with `CircuitOpenError`
3. **HALF_OPEN** - Testing recovery, limited requests pass through

**Disabling Circuit Breaker:**

```typescript
const $ = createContext(state, env, {
  circuitBreaker: {
    enabled: false  // Disable circuit breaker (not recommended for production)
  }
})
```

### Stub Caching

DO stubs are automatically cached to avoid creating multiple stubs for the same DO instance:

```typescript
// These use the same cached stub
await $.Customer('cust-123').notify({ message: 'Hello' })
await $.Customer('cust-123').getProfile()  // Reuses cached stub

// Different ID = different stub
await $.Customer('cust-456').notify({ message: 'Hello' })  // New stub
```

**Cache Management:**

```typescript
import { hasStub, clearStub, clearAllStubs, getStubCount } from '@dotdo/do'

// Check if stub is cached
if (hasStub($.stubCache, 'Customer', 'cust-123')) {
  console.log('Stub is cached')
}

// Clear specific stub
clearStub($.stubCache, 'Customer', 'cust-123')

// Clear all stubs (e.g., on DO hibernation)
clearAllStubs($.stubCache)

// Get cache size
console.log(`Cached stubs: ${getStubCount($.stubCache)}`)
```

---

## Event Wildcard Patterns

The `$.on` system supports wildcard patterns for flexible event handling. This enables namespace-wide event listening and cross-cutting concerns.

### Pattern Types

```typescript
const $ = createContext(state, env)

// 1. Exact Match - handles only 'Customer.signup' events
$.on.Customer.signup(async (event) => {
  console.log('Customer signed up:', event)
})

// 2. Noun Wildcard - handles ALL Customer events
$.on.Customer['*'](async (event) => {
  console.log('Any Customer event:', event)
  // Matches: Customer.signup, Customer.updated, Customer.deleted, etc.
})

// 3. Verb Wildcard - handles 'created' events from ANY noun
$.on['*'].created(async (event) => {
  console.log('Something was created:', event)
  // Matches: Customer.created, Order.created, Product.created, etc.
})

// 4. Global Wildcard - handles ALL events
$.on['*']['*'](async (event) => {
  console.log('Any event occurred:', event)
  // Matches every single event
})
```

### Handler Matching Order

When an event fires, handlers are matched in specificity order:

1. **Exact match** (`Customer.signup`) - highest priority
2. **Noun wildcard** (`Customer.*`)
3. **Verb wildcard** (`*.signup`)
4. **Global wildcard** (`*.*`) - lowest priority

All matching handlers are invoked, not just the most specific one.

**Example:**

```typescript
// Register handlers
$.on.Order.placed(h1)       // Exact
$.on.Order['*'](h2)         // Noun wildcard
$.on['*'].placed(h3)        // Verb wildcard
$.on['*']['*'](h4)          // Global wildcard

// When 'Order.placed' fires, ALL 4 handlers run:
// h1 (exact) + h2 (Order.*) + h3 (*.placed) + h4 (*.*)
$.send({ type: 'Order.placed', payload: { orderId: '123' } })
```

### Use Cases

**Audit Logging:**

```typescript
// Log every event for audit trail
$.on['*']['*'](async (event) => {
  await auditLog.write({
    timestamp: Date.now(),
    eventType: event.type,
    payload: event.payload,
    source: event.source,
  })
})
```

**Analytics:**

```typescript
// Track all 'created' events for analytics
$.on['*'].created(async (event) => {
  await analytics.track('entity_created', {
    entityType: event.type.split('.')[0],
    entityId: event.payload?.id,
    timestamp: event.$timestamp,
  })
})
```

**Entity-Level Logging:**

```typescript
// Log all Customer-related events
$.on.Customer['*'](async (event) => {
  const verb = event.type.split('.')[1]
  console.log(`Customer ${verb}:`, event.payload)
})
```

**Cross-Cutting Concerns:**

```typescript
// Notify admin on any 'failed' event
$.on['*'].failed(async (event) => {
  await $.Notification('admin').send({
    message: `${event.type} occurred`,
    severity: 'warning',
    details: event.payload,
  })
})
```

**Error Recovery:**

```typescript
// Handle system recovery events
$.on.System.recovered(async (event) => {
  console.log(`Recovered from ${event.originalEvent.type} after ${event.attempts} attempts`)
  await metrics.record('event_recovered', {
    eventType: event.originalEvent.type,
    attempts: event.attempts,
  })
})
```

### Retry Behavior

Event handlers automatically retry on transient failures with exponential backoff:

```typescript
// Configure retry behavior per event type
$.events.setDurabilityConfig('Order.placed', {
  retries: 5,                    // Max retry attempts (default: 3)
  backoff: 'exponential',        // 'exponential' or 'linear'
})

// Handlers that throw retriable errors will be retried
$.on.Order.placed(async (event) => {
  const result = await externalService.process(event)
  if (result.status === 'temporarily_unavailable') {
    const error = new Error('Service temporarily unavailable')
    error.retriable = true  // Mark as retriable
    throw error
  }
})
```

**Non-Retriable Errors:**

Some errors should not be retried:

```typescript
import { ValidationError } from '@dotdo/rpc'

$.on.Order.placed(async (event) => {
  if (!event.payload?.orderId) {
    // ValidationErrors are never retried
    throw new ValidationError('orderId is required', { field: 'orderId' })
  }
})
```

**Dead Letter Queue:**

Failed handlers (after all retries) are sent to the Dead Letter Queue:

```typescript
// Access DLQ
const dlqItems = $.events.getDeadLetterQueue()

// Replay failed events
for (const item of dlqItems) {
  await $.events.replay(item.event)
}
```

---

## Complete Example

Here's a complete example showing Cross-DO RPC and Event Wildcards together:

```typescript
import { DurableObject } from 'cloudflare:workers'
import { createContext } from '@dotdo/do'

interface Env {
  Customer: DurableObjectNamespace
  Order: DurableObjectNamespace
  Notification: DurableObjectNamespace
}

export class OrderProcessorDO extends DurableObject<Env> {
  private $: WorkflowContext

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.$ = createContext(ctx, env, {
      circuitBreaker: {
        failureThreshold: 3,
        resetTimeoutMs: 15000,
      }
    })
    this.setupEventHandlers()
  }

  private setupEventHandlers() {
    const $ = this.$

    // Exact match: handle Order.placed specifically
    $.on.Order.placed(async (event) => {
      const { orderId, customerId } = event.payload

      // Cross-DO RPC to get customer details
      const customer = await $.Customer(customerId).getProfile()

      // Process the order
      await this.processOrder(orderId, customer)

      // Emit completion event
      $.send({ type: 'Order.processed', payload: { orderId } })
    })

    // Noun wildcard: log all Order events
    $.on.Order['*'](async (event) => {
      console.log(`[Order Event] ${event.type}:`, event.payload)
    })

    // Verb wildcard: handle any failed event
    $.on['*'].failed(async (event) => {
      const noun = event.type.split('.')[0]

      // Cross-DO RPC to send notification
      await $.Notification('alerts').send({
        channel: 'slack',
        message: `${noun} operation failed`,
        details: event.payload,
      })
    })

    // Global wildcard: audit logging
    $.on['*']['*'](async (event) => {
      await this.auditLog(event)
    })
  }

  async processOrder(orderId: string, customer: CustomerProfile) {
    // ... order processing logic
  }

  async auditLog(event: Event) {
    // ... audit logging logic
  }
}
```

---

## Summary

| Feature | Pattern | Use Case |
|---------|---------|----------|
| Cross-DO RPC | `$.Entity(id).method()` | Call methods on other DOs |
| Circuit Breaker | `circuitBreaker` config | Prevent cascade failures |
| Exact Event | `$.on.Noun.verb()` | Handle specific events |
| Noun Wildcard | `$.on.Noun['*']()` | Handle all events for an entity |
| Verb Wildcard | `$.on['*'].verb()` | Handle events across entities |
| Global Wildcard | `$.on['*']['*']()` | Handle all events |

For more information:
- [Getting Started Guide](/docs/getting-started.md)
- [API Reference](/docs/api/workflow-context.md)
- [Circuit Breaker Details](/docs/GRACEFUL_DEGRADATION.md)
