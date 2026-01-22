# Observability Example

A comprehensive example demonstrating the `@dotdo/observability` package features including structured logging, distributed tracing, and metrics collection.

## Features

This example demonstrates:

- **Structured Logging**: JSON-formatted logs with levels, context, and automatic sensitive data redaction
- **Distributed Tracing**: W3C Trace Context compatible spans with hierarchies and timing
- **Metrics Collection**: Counters, gauges, and histograms for application metrics
- **Context Propagation**: Correlation IDs and trace context across async boundaries
- **Hono Middleware**: Automatic request tracing, logging, and timing

## Key dotdo Observability Concepts

### Structured Logging

```typescript
import { createStructuredLogger, LogLevel } from '@dotdo/observability'

// Create a logger with service context
const logger = createStructuredLogger({
  service: 'my-service',
  level: LogLevel.DEBUG,
  format: 'json', // or 'pretty' for development
})

// Log at different levels
logger.debug('Verbose debugging info', { details: 'here' })
logger.info('User action', { userId: '123', action: 'login' })
logger.warn('Potential issue', { issue: 'rate_limit_approaching' })
logger.error('Operation failed', new Error('Something broke'))

// Create child logger with additional context
const childLogger = logger.child({ requestId: 'abc123', component: 'auth' })
childLogger.info('All logs include requestId and component')

// Sensitive data is automatically redacted
logger.info('User data', { password: 'secret123' }) // password shows as [REDACTED]
```

### Distributed Tracing

```typescript
import { createTracer, SpanKind, SpanStatusCode } from '@dotdo/observability'

const tracer = createTracer({ name: 'my-service' })

// Create spans for operations
await tracer.startActiveSpan('processOrder', async (span) => {
  span.setAttribute('order.id', orderId)
  span.setAttribute('order.total', total)

  // Nested child spans
  await tracer.startActiveSpan('validatePayment', async (childSpan) => {
    childSpan.addEvent('payment_validated')
    // ... validation logic
  })

  await tracer.startActiveSpan('updateInventory', async (childSpan) => {
    // ... inventory logic
    childSpan.addEvent('inventory_updated', { items: 5 })
  })

  span.setStatus({ code: SpanStatusCode.OK })
})

// Handle errors
await tracer.startActiveSpan('riskyOperation', async (span) => {
  try {
    // ... operation
  } catch (error) {
    span.recordException(error)
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
    throw error
  }
})
```

### Metrics Collection

```typescript
import { createMeter, MetricNames } from '@dotdo/observability'

const meter = createMeter({ name: 'my-service' })

// Counters - monotonically increasing values
const requestCounter = meter.createCounter('http.requests', {
  description: 'Total HTTP requests',
  unit: 'requests',
})
requestCounter.inc({ method: 'GET', path: '/api/users' })

// Gauges - point-in-time measurements
const connectionsGauge = meter.createGauge('websocket.connections', {
  description: 'Active WebSocket connections',
  unit: 'connections',
})
connectionsGauge.set(42)
connectionsGauge.add(1) // Increment by 1
connectionsGauge.add(-1) // Decrement by 1

// Histograms - distributions
const latencyHistogram = meter.createHistogram('http.latency', {
  description: 'Request latency distribution',
  unit: 'ms',
  boundaries: [5, 10, 25, 50, 100, 250, 500, 1000],
})
latencyHistogram.record(45, { path: '/api/orders' })

// Collect all metrics
const dataPoints = meter.collect()
```

### Context Propagation

```typescript
import {
  runWithContext,
  createObservabilityContext,
  getCorrelationId,
  extractContextFromHeaders,
} from '@dotdo/observability'

// Extract context from incoming request
const incomingContext = extractContextFromHeaders(request.headers)

// Create context for this request
const ctx = createObservabilityContext({
  correlationId: incomingContext.correlationId,
  traceContext: incomingContext.traceContext,
})

// Run operations with context - all nested calls share the same correlation ID
await runWithContext(ctx, async () => {
  const correlationId = getCorrelationId()
  console.log(`All operations share correlation ID: ${correlationId}`)

  // Call other services, logs, traces all share this context
})
```

### Hono Middleware

```typescript
import { Hono } from 'hono'
import { observability, timing, requestId, getRequestLogger } from '@dotdo/observability'

const app = new Hono()

// Add timing header (X-Response-Time)
app.use('/*', timing())

// Ensure every request has a correlation ID
app.use('/*', requestId())

// Full observability middleware
app.use(
  '/*',
  observability({
    service: 'my-api',
    logLevel: LogLevel.INFO,
    enableTracing: true,
    enableLogging: true,
    excludePaths: ['/health', '/metrics'],
  })
)

// Use request-scoped logger in handlers
app.get('/users', (c) => {
  const log = getRequestLogger(c, 'users-handler')
  log.info('Fetching users') // Includes correlation ID automatically
  // ...
})
```

### DO Integration

```typescript
import { createDOObservability, createStorageTracker } from '@dotdo/observability'

// Create DO-specific observability
const obs = createDOObservability({
  serviceName: 'my-do',
  doId: state.id,
  doClassName: 'MyDO',
})

// Track storage operations
const storage = createStorageTracker(obs)
storage.trackGet('users/123')
storage.trackPut('orders/456')
storage.trackList('products')

// Wrap DO methods with tracing
await obs.wrapMethod('processRequest', async () => {
  // Method is traced automatically
})
```

## API Endpoints

### Products

| Method | Path | Description |
|--------|------|-------------|
| GET | `/products` | List all products |
| POST | `/products` | Create a new product |
| GET | `/products/:id` | Get a single product |

### Orders

| Method | Path | Description |
|--------|------|-------------|
| POST | `/orders` | Create a new order |
| GET | `/orders/:id` | Get a single order |
| POST | `/orders/:id/process` | Process a pending order |

### Observability

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (excluded from tracing) |
| GET | `/metrics` | Get collected metrics |

### Demos

| Method | Path | Description |
|--------|------|-------------|
| GET | `/demo/logging` | Demonstrate all log levels |
| GET | `/demo/tracing` | Demonstrate span hierarchies |
| GET | `/demo/context` | Demonstrate context propagation |

## Usage Examples

### Create Products

```bash
# Create a product
curl -X POST http://localhost:8791/products \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Widget",
    "price": 29.99,
    "category": "electronics",
    "inventory": 100
  }'
```

### Create and Process Orders

```bash
# Create an order
curl -X POST http://localhost:8791/orders \
  -H "Content-Type: application/json" \
  -d '{
    "customerId": "cust-123",
    "items": [
      {"productId": "prod-abc", "quantity": 2}
    ]
  }'

# Process the order
curl -X POST http://localhost:8791/orders/{orderId}/process
```

### View Metrics

```bash
curl http://localhost:8791/metrics
```

Response:
```json
{
  "counters": [
    { "name": "products.created", "value": 5, "attributes": { "category": "electronics" } },
    { "name": "orders.created", "value": 12, "attributes": {} },
    { "name": "orders.processed", "value": 10, "attributes": {} }
  ],
  "gauges": [
    { "name": "inventory.total", "value": 450, "attributes": {} }
  ],
  "histograms": [
    { "name": "order.value", "count": 12, "attributes": {} },
    { "name": "order.processing_time", "count": 10, "attributes": {} }
  ],
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

### Demo Endpoints

```bash
# See all log levels in action
curl http://localhost:8791/demo/logging

# See span hierarchies (check X-Response-Time and traceparent headers)
curl -v http://localhost:8791/demo/tracing

# See context propagation
curl http://localhost:8791/demo/context
```

## Response Headers

All responses include observability headers:

| Header | Description |
|--------|-------------|
| `X-Correlation-ID` | Unique ID linking all related operations |
| `X-Response-Time` | Request processing duration |
| `traceparent` | W3C Trace Context for distributed tracing |

## Running Locally

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test
```

## Log Output Format

JSON format (production):
```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "info",
  "message": "Order created",
  "service": "observability-example",
  "correlationId": "abc123",
  "traceId": "0af7651916cd43dd8448eb211c80319c",
  "orderId": "order-xyz",
  "total": 149.97
}
```

Pretty format (development):
```
10:30:00 [INFO]  [observability-example] Order created {"correlationId":"abc123","orderId":"order-xyz","total":149.97}
```

## Architecture

```
HTTP Request
     |
     v
+---------------------------+
|    Worker (index.ts)      |
|    Route to DO by tenant  |
+---------------------------+
     |
     v
+---------------------------+
|   ObservabilityDO         |
|                           |
|  Middleware Stack:        |
|  - timing()               |  <-- X-Response-Time header
|  - requestId()            |  <-- Correlation ID
|  - observability()        |  <-- Logging + Tracing
|                           |
|  Components:              |
|  - logger                 |  <-- Structured JSON logs
|  - tracer                 |  <-- W3C trace context
|  - meter                  |  <-- Counters/Gauges/Histograms
|  - storageTracker         |  <-- DO storage metrics
+---------------------------+
     |
     v
+---------------------------+
|    SQLite Storage         |
+---------------------------+
```

## Best Practices

1. **Log Levels**: Use appropriate levels (DEBUG for verbose, INFO for normal operations, WARN for issues, ERROR for failures)

2. **Span Names**: Use descriptive, action-oriented names (e.g., `createOrder`, `validatePayment`)

3. **Attributes**: Add relevant context to spans and logs (IDs, counts, durations)

4. **Metrics**: Use the right metric type (counters for totals, gauges for current values, histograms for distributions)

5. **Context Propagation**: Always pass correlation IDs between services for end-to-end tracing

6. **Sensitive Data**: The logger automatically redacts sensitive fields (password, token, apiKey, etc.)
