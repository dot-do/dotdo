# Error Handling Patterns

**Build resilient systems that handle failures gracefully.**

```typescript
import { DO } from 'dotdo'
import { RetryableError, NonRetryableError, CircuitOpenError } from './errors'

export class ResilientDO extends DO {
  async checkout(orderId: string, amount: number) {
    // $.try - Quick check with timeout, graceful fallback
    const inventory = await $.try('Inventory.check', { orderId }, { timeout: 5000 })

    // $.do - Critical operation with retries and exponential backoff
    const payment = await $.do('Payment.charge', { orderId, amount }, {
      retry: {
        maxAttempts: 5,
        initialDelayMs: 200,
        backoffMultiplier: 2,
        jitter: true
      }
    })

    // $.send - Fire and forget (non-blocking)
    $.send('Email.confirmation', { orderId, transactionId: payment.id })

    return payment
  }
}
```

**Three durability levels. One API. Zero lost transactions.**

---

## Architecture

This example demonstrates three complementary error handling patterns using separate Durable Objects:

| Component | Purpose |
|-----------|---------|
| `RetryDO` | Retry pattern with exponential backoff, retry budgets, operation tracking |
| `CircuitDO` | Circuit breaker pattern, service isolation, failure rate monitoring |
| `ErrorsDO` | Dead letter queue, error aggregation, compensation/rollback patterns |

```
examples/error-handling-patterns/
├── src/
│   ├── index.ts           # Main worker with HTTP API
│   ├── errors.ts          # Custom error types
│   └── objects/
│       ├── RetryDO.ts     # Retry pattern implementation
│       ├── CircuitDO.ts   # Circuit breaker implementation
│       └── ErrorsDO.ts    # Error tracking & DLQ
├── tests/
│   └── errors.test.ts     # Comprehensive tests
├── package.json
├── wrangler.jsonc
└── README.md
```

---

## Quick Start

```bash
# Install dependencies
npm install

# Run locally
npm run dev

# Run tests
npm test

# Deploy
npm run deploy
```

---

## Custom Error Types

### Retryable Errors

Transient failures that may succeed on retry:

```typescript
import { RetryableError, RateLimitError, NetworkError } from './errors'

// Basic retryable error
throw new RetryableError('Service temporarily unavailable')

// With retry configuration
throw new RetryableError('Timeout', 5000, 5) // retryAfterMs, maxRetries

// Rate limit (specific retry delay)
throw new RateLimitError('Too many requests', 60000, 100, 0) // delay, limit, remaining

// Network errors (always retry)
throw new NetworkError('Connection refused', 'https://api.example.com', 5000)
```

### Non-Retryable Errors

Permanent failures where retrying won't help:

```typescript
import { NonRetryableError, ValidationError, NotFoundError, AuthorizationError } from './errors'

// Generic non-retryable
throw new NonRetryableError('Invalid operation')

// Validation error
throw new ValidationError('Invalid email format', 'email', 'not-an-email')

// Resource not found
throw new NotFoundError('User', '12345')

// Authorization failure
throw new AuthorizationError('Insufficient permissions', 'admin:write')
```

### Special Error Types

```typescript
import { TimeoutError, CircuitOpenError, AggregateError } from './errors'

// Timeout (optionally retryable)
throw new TimeoutError('Database query', 30000, true)

// Circuit breaker open (fail fast)
throw new CircuitOpenError('payment-service', Date.now() + 30000)

// Multiple errors (batch operations)
throw new AggregateError('Batch failed', [error1, error2], true) // partial=true
```

### Type Guards

```typescript
import { isRetryableError, shouldRetry, getRetryDelay } from './errors'

try {
  await operation()
} catch (error) {
  if (isRetryableError(error)) {
    const delay = error.getNextDelay()
    // Schedule retry
  }

  // Or use the utility function
  if (shouldRetry(error)) {
    const delay = getRetryDelay(error, attemptNumber)
  }
}
```

---

## Execution Modes

| Mode | Blocking | Durable | Retries | Use Case |
|------|----------|---------|---------|----------|
| `$.send()` | No | No | No | Notifications, analytics, fire-and-forget |
| `$.try()` | Yes | No | No | Cache reads, quick checks, non-critical ops |
| `$.do()` | Yes | Yes | Yes | Payments, critical operations, must-succeed |

### Fire-and-Forget (`$.send`)

```typescript
// Returns immediately - doesn't wait for delivery
$.send('User.signedUp', { userId, email })
$.send('Analytics.pageView', { path: '/checkout' })
```

Errors are logged but never propagate. Use for non-critical side effects.

### Quick Attempt (`$.try`)

```typescript
// 5 second timeout, throws on failure
const inventory = await $.try('Inventory.check', { sku }, { timeout: 5000 })

// Graceful degradation pattern
async checkInventory(sku: string) {
  try {
    return await $.try('Inventory.check', { sku }, { timeout: 3000 })
  } catch {
    // Assume available if service is down
    return { available: true, quantity: -1 }
  }
}
```

### Durable Execution (`$.do`)

```typescript
// Retries up to 5 times with exponential backoff
const payment = await $.do('Payment.charge', { orderId, amount }, {
  retry: {
    maxAttempts: 5,
    initialDelayMs: 200,    // Start at 200ms
    maxDelayMs: 30000,      // Cap at 30s
    backoffMultiplier: 2,   // 200ms -> 400ms -> 800ms -> ...
    jitter: true            // Add randomness to prevent thundering herd
  },
  timeout: 30000,           // Per-attempt timeout
  stepId: `payment:${orderId}`  // For replay on restart
})
```

---

## Retry Pattern (RetryDO)

### Exponential Backoff

Delays increase exponentially between retries to avoid overwhelming a struggling service:

```
Attempt 1: 200ms
Attempt 2: 400ms  (200 * 2^1)
Attempt 3: 800ms  (200 * 2^2)
Attempt 4: 1600ms (200 * 2^3)
Attempt 5: 3200ms (200 * 2^4)
```

With jitter, actual delays vary by 10-50% to prevent multiple clients retrying simultaneously.

### Retry Budget

Limits total retries per operation type within a time window:

```typescript
// RetryDO tracks budget internally
// - 100 retries per operation type per minute
// - Prevents runaway retry storms
// - Budget resets after window expires
```

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/retry/stats` | Get retry statistics for all operations |
| GET | `/retry/budget` | View retry budget status per operation type |
| POST | `/retry/execute` | Execute an operation with retry |
| POST | `/retry/try` | Execute single attempt with timeout |
| POST | `/retry/reset` | Reset all retry statistics |

---

## Circuit Breaker Pattern (CircuitDO)

### States

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│  ┌────────┐   failures   ┌────────┐   timeout     │
│  │ CLOSED │─────────────>│  OPEN  │───────────────┼──┐
│  └────────┘              └────────┘               │  │
│       ▲                       │                   │  │
│       │                       │ timeout           │  │
│       │    successes     ┌────▼────┐              │  │
│       └──────────────────│HALF-OPEN│<─────────────┼──┘
│                          └─────────┘              │
│                               │                   │
│                          failure                  │
│                               ▼                   │
│                           (reopen)                │
│                                                   │
└─────────────────────────────────────────────────────┘
```

1. **Closed** - Normal operation, requests flow through
2. **Open** - After threshold failures, requests fail fast immediately
3. **Half-Open** - After reset timeout, allow test requests to determine recovery

### Configuration

```typescript
circuitDO.configureCircuit('payment-service', {
  failureThreshold: 5,        // Failures before opening
  resetTimeoutMs: 30000,      // Wait before testing recovery
  successThreshold: 3,        // Successes to close circuit
  halfOpenMaxCalls: 3,        // Test calls in half-open
  failureRateThreshold: 50,   // Percentage to trip
  minimumCalls: 5,            // Min calls before rate check
})
```

### Protected Execution

```typescript
// Protected call with fallback
const result = await circuitDO.call(
  'payment-service',
  async () => await paymentAPI.charge(amount),
  { useFallback: true }
)

// Register global fallback
circuitDO.registerFallback('payment-service', () => ({
  transactionId: `pending_${crypto.randomUUID()}`,
  queued: true
}))
```

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/circuit/status` | Get status of all circuit breakers |
| GET | `/circuit/health` | Health check for all services |
| GET | `/circuit/stats` | Detailed statistics |
| GET | `/circuit/:service/status` | Status for specific service |
| POST | `/circuit/:service/configure` | Configure circuit breaker |
| POST | `/circuit/:service/reset` | Reset circuit breaker |
| POST | `/circuit/:service/trip` | Force trip (open) for testing |
| POST | `/circuit/reset-all` | Reset all circuit breakers |

---

## Dead Letter Queue (ErrorsDO)

Failed events don't disappear - they go to the DLQ for retry.

### Adding to DLQ

```typescript
await errorsDO.addToDeadLetter({
  event: 'Order.placed',
  source: 'checkout-flow',
  data: { orderId: '123', items: [...] },
  error: 'Payment service unavailable',
  errorCode: 'SERVICE_UNAVAILABLE',
  maxRetries: 5,
  metadata: { userId: '456' }
})
```

### Automatic Retry

```typescript
// DLQ entries are automatically retried with exponential backoff
// Retry schedule:
//   Attempt 1: 1 minute
//   Attempt 2: 2 minutes
//   Attempt 3: 4 minutes
//   Attempt 4: 8 minutes
//   Attempt 5: 16 minutes (capped at 1 hour)
```

### Manual Replay

```typescript
// Replay specific entry
const success = await errorsDO.replayEntry('entry-id')

// Get entries for manual review
const entries = await errorsDO.getDLQEntries({
  status: 'exhausted',  // 'pending' | 'retrying' | 'exhausted' | 'resolved'
  event: 'Payment.charge',
  limit: 10
})
```

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/dlq/stats` | Get DLQ statistics |
| GET | `/dlq/entries` | List DLQ entries (with filters) |
| POST | `/dlq/add` | Add entry to DLQ |
| POST | `/dlq/:id/replay` | Replay specific entry |
| DELETE | `/dlq/:id` | Remove entry |
| POST | `/dlq/purge` | Purge resolved/exhausted entries |

---

## Compensation Pattern

For saga rollback when a multi-step operation fails:

### Registering Compensations

```typescript
// As each step succeeds, register its compensation
await errorsDO.registerCompensation(
  'Inventory.reserve',
  'Inventory.release',
  { items: [...], orderId: '123' }
)

await errorsDO.registerCompensation(
  'Payment.charge',
  'Payment.refund',
  { amount: 99.99, transactionId: 'txn_123' }
)
```

### Executing Rollback

```typescript
// On failure, execute all pending compensations (reverse order)
const result = await errorsDO.executeAllCompensations()
// { total: 2, succeeded: 2, failed: 0 }

// Or execute specific compensation
await errorsDO.executeCompensation('compensation-id')

// Cancel a pending compensation (operation succeeded)
await errorsDO.cancelCompensation('compensation-id')
```

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/compensation/pending` | List pending compensations |
| POST | `/compensation/register` | Register new compensation |
| POST | `/compensation/:id/execute` | Execute specific compensation |
| DELETE | `/compensation/:id` | Cancel pending compensation |
| POST | `/compensation/rollback` | Execute all pending (saga rollback) |

---

## Error Aggregation

Track error patterns for monitoring and alerting:

```typescript
// Get error summary
const summary = await errorsDO.getErrorSummary()
// {
//   totalErrors: 150,
//   uniqueErrorCodes: 5,
//   topErrors: [
//     { code: 'TIMEOUT', type: 'TimeoutError', count: 80 },
//     { code: 'SERVICE_UNAVAILABLE', type: 'RetryableError', count: 50 },
//     ...
//   ],
//   errorsByHour: { '2024-01-15T10:00': 45, ... }
// }

// Get detailed metrics
const metrics = await errorsDO.getErrorMetrics({ limit: 10 })
```

### API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/errors/summary` | Error summary with top errors |
| GET | `/errors/health` | Error system health |
| GET | `/errors/metrics` | Detailed error metrics |
| POST | `/errors/reset` | Reset error metrics |

---

## Health Monitoring

Combined health check for all resilience patterns:

```bash
curl http://localhost:8787/health
```

```json
{
  "healthy": true,
  "retry": {
    "totalOperations": 150,
    "successful": 145,
    "failed": 5
  },
  "circuit": {
    "healthy": true,
    "services": {
      "payment-service": { "state": "closed", "healthy": true },
      "shipping-service": { "state": "half-open", "healthy": true }
    }
  },
  "errors": {
    "healthy": true,
    "dlq": { "pending": 3, "exhausted": 0 },
    "compensations": { "pending": 0 }
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

Returns 200 when healthy, 503 when any component is degraded.

---

## Complete Order Flow Example

```typescript
$.on.Order.placed(async (event) => {
  const order = event.data

  // Register compensations as we go
  const compensations: string[] = []

  try {
    // Step 1: Quick inventory check (can fail gracefully)
    for (const item of order.items) {
      await $.try('Inventory.reserve', { sku: item, orderId: order.orderId })
      compensations.push(await errorsDO.registerCompensation(
        'Inventory.reserve',
        'Inventory.release',
        { sku: item, orderId: order.orderId }
      ))
    }

    // Step 2: Critical payment (must succeed)
    const payment = await $.do('Payment.charge', {
      orderId: order.orderId,
      amount: order.amount
    })
    compensations.push(await errorsDO.registerCompensation(
      'Payment.charge',
      'Payment.refund',
      { orderId: order.orderId, amount: order.amount }
    ))

    // Step 3: Non-critical notification
    $.send('Email.send', {
      template: 'order-confirmation',
      to: order.customerEmail,
      data: { orderId: order.orderId }
    })

    // Success - cancel all compensations
    for (const id of compensations) {
      await errorsDO.cancelCompensation(id)
    }

  } catch (error) {
    // Rollback all completed steps
    await errorsDO.executeAllCompensations()

    // Add to DLQ for retry
    await errorsDO.addToDeadLetter({
      event: 'Order.placed',
      source: 'order-flow',
      data: order,
      error
    })

    throw error
  }
})
```

---

## Testing Failure Scenarios

```bash
# Simulate payment failures
curl -X POST http://localhost:8787/circuit/payment-service/trip

# View circuit status
curl http://localhost:8787/circuit/status

# Add test entry to DLQ
curl -X POST http://localhost:8787/dlq/add \
  -H "Content-Type: application/json" \
  -d '{"event": "Order.placed", "source": "test", "data": {"orderId": "123"}, "error": "Test error"}'

# View DLQ
curl http://localhost:8787/dlq/entries?status=pending

# Reset everything
curl -X POST http://localhost:8787/circuit/reset-all
curl -X POST http://localhost:8787/retry/reset
curl -X POST http://localhost:8787/errors/reset
```

---

## Why This Works

1. **Custom Error Types** - Semantic errors with retry semantics baked in
2. **Right tool for the job** - Three execution modes for different reliability needs
3. **Automatic retries** - Exponential backoff with jitter prevents thundering herd
4. **Retry budgets** - Prevent runaway retry storms
5. **Circuit breakers** - Fail fast when dependencies are down
6. **Dead letter queues** - No event is ever lost
7. **Compensation patterns** - Saga rollback for distributed transactions
8. **Error aggregation** - Track patterns and trigger alerts
9. **Observable** - Health endpoint shows system state at a glance

---

Built with [dotdo](https://dotdo.dev) | Powered by [workers.do](https://workers.do)
