# @dotdo/observability

Comprehensive observability for dotdo applications with structured logging, distributed tracing, metrics collection, and OpenTelemetry integration.

## Features

- **Structured Logging** - JSON-formatted logs with levels, context, and automatic sanitization
- **Distributed Tracing** - W3C Trace Context compatible spans with full hierarchy support
- **Metrics Collection** - Counters, gauges, and histograms with automatic aggregation
- **Context Propagation** - Request-scoped context across async boundaries
- **OpenTelemetry Compatible** - Standards-based observability for cloud-native apps
- **Hono Middleware** - Automatic request tracing and logging for Hono apps
- **DO Integration** - Built-in observability for Durable Objects
- **API Integration** - Route-level metrics and tracing for REST APIs

## Installation

**Within the dotdo monorepo:**

The package is available as `@dotdo/observability` via TypeScript path mapping. No additional installation needed.

**For published package (when available):**

```bash
npm install @dotdo/observability
```

**Import paths:**

```typescript
// Main entry point - includes all exports
import { createStructuredLogger, createTracer, observability } from '@dotdo/observability'

// Subpath imports for tree-shaking
import { createStructuredLogger } from '@dotdo/observability/logger'
import { createTracer } from '@dotdo/observability/tracing'
import { observability } from '@dotdo/observability/middleware'
import { createMeter } from '@dotdo/observability/metrics'
import { runWithContext } from '@dotdo/observability/context'
```

## Quick Start

### Structured Logging

```typescript
import { createStructuredLogger } from '@dotdo/observability'

const logger = createStructuredLogger({
  service: 'my-service',
  level: 'info'
})

logger.info('User created', {
  userId: '123',
  email: 'user@example.com'
})
// {"level":"info","service":"my-service","message":"User created","userId":"123","email":"user@example.com","timestamp":"2026-01-21T..."}

logger.error('Payment failed', {
  orderId: 'ord_456',
  error: new Error('Insufficient funds')
})
```

### Distributed Tracing

```typescript
import { createTracer } from '@dotdo/observability'

const tracer = createTracer({
  name: 'my-service',
  version: '1.0.0'
})

// Start a span
tracer.startActiveSpan('processOrder', (span) => {
  span.setAttribute('order.id', orderId)
  span.setAttribute('order.total', 150.00)

  try {
    // Process order...
    span.setStatus({ code: SpanStatusCode.OK })
  } catch (error) {
    span.recordException(error)
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message
    })
  } finally {
    span.end()
  }
})
```

### Metrics Collection

```typescript
import { createMeter, MetricNames } from '@dotdo/observability'

const meter = createMeter({
  name: 'my-service',
  version: '1.0.0'
})

// Counter - monotonically increasing
const requestCounter = meter.createCounter(MetricNames.HTTP_REQUESTS_TOTAL, {
  description: 'Total HTTP requests'
})
requestCounter.add(1, { method: 'GET', path: '/users' })

// Gauge - arbitrary value
const activeConnections = meter.createGauge('active_connections', {
  description: 'Number of active WebSocket connections'
})
activeConnections.set(42)

// Histogram - distribution of values
const requestDuration = meter.createHistogram(MetricNames.HTTP_REQUEST_DURATION, {
  description: 'HTTP request duration in milliseconds',
  buckets: [10, 50, 100, 500, 1000]
})
requestDuration.record(123, { method: 'GET', path: '/users' })
```

### Hono Middleware

```typescript
import { Hono } from 'hono'
import { observability } from '@dotdo/observability'

const app = new Hono()

// Add observability middleware
app.use('/*', observability({
  service: 'my-api',
  logLevel: 'info'
}))

app.get('/users', async (c) => {
  // Automatically traced and logged
  const users = await getUsers()
  return c.json(users)
})
```

## OpenTelemetry Integration

### Overview

dotdo's observability package is fully compatible with OpenTelemetry standards, making it easy to integrate with popular observability platforms like:

- **Datadog** - Full-stack monitoring and APM
- **New Relic** - Application performance monitoring
- **Honeycomb** - Observability for distributed systems
- **Grafana Cloud** - Metrics, logs, and traces
- **AWS X-Ray** - Distributed tracing for AWS
- **Google Cloud Trace** - Distributed tracing for GCP
- **Azure Monitor** - Monitoring for Azure

### W3C Trace Context

The tracing implementation follows the [W3C Trace Context](https://www.w3.org/TR/trace-context/) specification:

```typescript
import {
  parseTraceparent,
  formatTraceparent,
  extractTraceContext,
  injectTraceContext
} from '@dotdo/observability'

// Parse incoming trace context
const traceContext = parseTraceparent(
  '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
)
// {
//   version: '00',
//   traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
//   parentId: '00f067aa0ba902b7',
//   traceFlags: '01'
// }

// Extract from headers
const context = extractTraceContext(request.headers)

// Inject into outgoing requests
const headers = new Headers()
injectTraceContext(headers, spanContext)
```

### Custom Exporters

Export traces and metrics to any observability platform:

```typescript
import {
  createTracer,
  createBatchSpanProcessor,
  type SpanExporter
} from '@dotdo/observability'

// Custom exporter for your platform
class DatadogExporter implements SpanExporter {
  async export(spans: SpanData[]): Promise<void> {
    await fetch('https://trace.agent.datadoghq.com/v0.4/traces', {
      method: 'POST',
      headers: {
        'DD-API-KEY': process.env.DD_API_KEY!,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(this.formatForDatadog(spans))
    })
  }

  private formatForDatadog(spans: SpanData[]) {
    // Convert to Datadog format
    return spans.map(span => ({
      trace_id: span.spanContext.traceId,
      span_id: span.spanContext.spanId,
      parent_id: span.parentSpanId,
      name: span.name,
      resource: span.attributes['http.route'] || span.name,
      service: span.attributes['service.name'],
      start: span.startTime * 1_000_000, // nanoseconds
      duration: (span.endTime - span.startTime) * 1_000_000,
      meta: span.attributes,
      error: span.status.code === SpanStatusCode.ERROR ? 1 : 0
    }))
  }
}

// Use custom exporter
const exporter = new DatadogExporter()
const processor = createBatchSpanProcessor(exporter, {
  maxQueueSize: 2048,
  maxExportBatchSize: 512,
  scheduledDelayMillis: 5000
})

const tracer = createTracer({
  name: 'my-service',
  processor
})
```

### Metrics Export

```typescript
import {
  createMeter,
  createPeriodicReporter,
  type MetricsExporter
} from '@dotdo/observability'

// Custom metrics exporter
class PrometheusExporter implements MetricsExporter {
  async export(metrics: Map<string, MetricDataPoint[]>): Promise<void> {
    const promFormat = this.formatForPrometheus(metrics)

    await fetch('https://prometheus-pushgateway.example.com/metrics/job/my-service', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: promFormat
    })
  }

  private formatForPrometheus(metrics: Map<string, MetricDataPoint[]>): string {
    const lines: string[] = []

    for (const [name, points] of metrics) {
      for (const point of points) {
        const labels = Object.entries(point.attributes)
          .map(([k, v]) => `${k}="${v}"`)
          .join(',')

        if (point.value !== undefined) {
          lines.push(`${name}{${labels}} ${point.value}`)
        }
      }
    }

    return lines.join('\n')
  }
}

// Setup periodic export
const exporter = new PrometheusExporter()
const reporter = createPeriodicReporter(meter, exporter, {
  intervalMillis: 60000 // Export every minute
})
```

## Advanced Usage

### Context Propagation

Request-scoped context that flows through async operations:

```typescript
import {
  runWithContext,
  getContext,
  setMetadata,
  getMetadata
} from '@dotdo/observability'

// Create new context for request
await runWithContext(async () => {
  setMetadata('userId', '123')
  setMetadata('requestId', 'req_abc')

  // Context automatically propagates
  await processRequest()

  // Nested async operations have access
  async function processRequest() {
    const userId = getMetadata('userId') // '123'
    const context = getContext() // Full context object
  }
})
```

### Baggage Propagation

Propagate key-value pairs across service boundaries:

```typescript
import {
  setBaggageItem,
  getBaggageItem,
  formatBaggage,
  parseBaggage
} from '@dotdo/observability'

// Set baggage in current context
setBaggageItem('userId', '123')
setBaggageItem('tenant', 'acme-corp')

// Get baggage
const userId = getBaggageItem('userId')

// Propagate via headers
const headers = new Headers()
const baggage = formatBaggage(getAllBaggage())
headers.set('baggage', baggage)

// Parse incoming baggage
const incomingBaggage = parseBaggage(
  request.headers.get('baggage') || ''
)
```

### Instrumentation Decorator

Automatically trace function calls:

```typescript
import { instrument } from '@dotdo/observability'

class OrderService {
  @instrument({ name: 'OrderService.createOrder' })
  async createOrder(order: Order) {
    // Automatically creates span, records exceptions
    const result = await this.processOrder(order)
    return result
  }

  @instrument({
    name: 'OrderService.processOrder',
    attributes: { 'order.priority': (order: Order) => order.priority }
  })
  async processOrder(order: Order) {
    // Nested span automatically linked
    return { id: 'ord_123', status: 'processed' }
  }
}
```

### DO Integration

Built-in observability for Durable Objects:

```typescript
import { DO } from '@dotdo/do'
import { createDOObservability } from '@dotdo/observability'

export class MyDO extends DO {
  private obs = createDOObservability({
    service: 'my-do',
    doName: 'MyDO'
  })

  async fetch(request: Request) {
    return this.obs.wrapRequest(request, async () => {
      // Automatically traced and logged
      const result = await this.handleRequest(request)

      // Track storage operations
      this.obs.metrics.storageOps.add(1, {
        operation: 'read',
        key: 'user:123'
      })

      return new Response(JSON.stringify(result))
    })
  }
}
```

### API Route Tracing

Automatic tracing for API routes:

```typescript
import { Hono } from 'hono'
import { createAPIObservabilityMiddleware } from '@dotdo/observability'

const app = new Hono()

// Add API observability
app.use('/*', createAPIObservabilityMiddleware({
  service: 'my-api',
  version: '1.0.0'
}))

app.get('/users/:id', async (c) => {
  // Automatic span with attributes:
  // - http.method: GET
  // - http.route: /users/:id
  // - http.status_code: 200
  // - http.user_agent: ...

  const user = await getUser(c.req.param('id'))
  return c.json(user)
})
```

### Metrics Endpoint

Expose metrics for Prometheus scraping:

```typescript
import { Hono } from 'hono'
import { metricsEndpoint } from '@dotdo/observability'

const app = new Hono()

// Expose metrics at /metrics
app.get('/metrics', metricsEndpoint())

// Prometheus can scrape:
// GET /metrics
//
// # HELP http_requests_total Total HTTP requests
// # TYPE http_requests_total counter
// http_requests_total{method="GET",path="/users"} 1523
//
// # HELP http_request_duration HTTP request duration
// # TYPE http_request_duration histogram
// http_request_duration_bucket{method="GET",path="/users",le="10"} 450
// http_request_duration_bucket{method="GET",path="/users",le="50"} 1200
```

## Examples

### Complete Observability Setup

```typescript
import { Hono } from 'hono'
import { DO } from '@dotdo/do'
import {
  createStructuredLogger,
  createTracer,
  createMeter,
  observability,
  createDOObservability,
  createBatchSpanProcessor,
  createPeriodicReporter,
  SpanStatusCode
} from '@dotdo/observability'

// Configure logger
const logger = createStructuredLogger({
  service: 'ecommerce-api',
  level: 'info'
})

// Configure tracer with batch export
const tracer = createTracer({
  name: 'ecommerce-api',
  version: '1.0.0',
  processor: createBatchSpanProcessor(new DatadogExporter())
})

// Configure metrics
const meter = createMeter({
  name: 'ecommerce-api',
  version: '1.0.0'
})

// Setup periodic metrics export
createPeriodicReporter(meter, new PrometheusExporter(), {
  intervalMillis: 30000
})

// Create Hono app with observability
const app = new Hono()
app.use('/*', observability({
  service: 'ecommerce-api',
  logger,
  tracer
}))

// Define routes
app.post('/orders', async (c) => {
  return tracer.startActiveSpan('createOrder', async (span) => {
    try {
      const order = await c.req.json()
      span.setAttribute('order.total', order.total)
      span.setAttribute('order.items', order.items.length)

      // Process order with automatic tracing
      const result = await processOrder(order)

      // Record metrics
      meter.createCounter('orders_created_total').add(1, {
        currency: order.currency,
        country: order.shippingAddress.country
      })

      span.setStatus({ code: SpanStatusCode.OK })
      return c.json(result)
    } catch (error) {
      span.recordException(error)
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message
      })
      throw error
    }
  })
})

// Durable Object with observability
export class OrderDO extends DO {
  private obs = createDOObservability({
    service: 'order-do',
    doName: 'OrderDO',
    logger,
    tracer,
    meter
  })

  async fetch(request: Request) {
    return this.obs.wrapRequest(request, async () => {
      const url = new URL(request.url)

      if (url.pathname === '/status') {
        const status = await this.getStatus()
        return new Response(JSON.stringify(status))
      }

      return new Response('Not found', { status: 404 })
    })
  }

  private async getStatus() {
    return this.obs.tracer.startActiveSpan('getStatus', async (span) => {
      const data = await this.$.things.list({ type: 'Order' })

      this.obs.metrics.storageOps.add(1, {
        operation: 'list',
        type: 'Order'
      })

      span.setAttribute('order.count', data.items.length)
      return { orders: data.items.length }
    })
  }
}

export default app
export { OrderDO }
```

### Error Tracking

```typescript
import { createStructuredLogger, createTracer } from '@dotdo/observability'

const logger = createStructuredLogger({ service: 'my-service' })
const tracer = createTracer({ name: 'my-service' })

async function processPayment(paymentId: string) {
  return tracer.startActiveSpan('processPayment', async (span) => {
    span.setAttribute('payment.id', paymentId)

    try {
      const payment = await getPayment(paymentId)
      const result = await chargeCard(payment.cardToken, payment.amount)

      logger.info('Payment processed', {
        paymentId,
        amount: payment.amount,
        transactionId: result.transactionId
      })

      span.setStatus({ code: SpanStatusCode.OK })
      return result
    } catch (error) {
      // Record exception in span
      span.recordException(error)
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message
      })

      // Log error with context
      logger.error('Payment failed', {
        paymentId,
        error: error.message,
        stack: error.stack,
        code: error.code
      })

      throw error
    }
  })
}
```

### Multi-Service Tracing

```typescript
import {
  createTracer,
  injectTraceContext,
  extractTraceContext
} from '@dotdo/observability'

// Service A
const tracerA = createTracer({ name: 'service-a' })

async function callServiceB(data: any) {
  return tracerA.startActiveSpan('callServiceB', async (span) => {
    const headers = new Headers()

    // Inject trace context into headers
    injectTraceContext(headers, span.spanContext())

    const response = await fetch('https://service-b.example.com/process', {
      method: 'POST',
      headers,
      body: JSON.stringify(data)
    })

    return response.json()
  })
}

// Service B
const tracerB = createTracer({ name: 'service-b' })

export default {
  async fetch(request: Request) {
    // Extract trace context from incoming request
    const parentContext = extractTraceContext(request.headers)

    return tracerB.startActiveSpan('process', {
      parentContext
    }, async (span) => {
      // This span is now linked to the parent in service-a
      const data = await request.json()
      const result = await processData(data)

      return new Response(JSON.stringify(result))
    })
  }
}
```

## API Reference

### Structured Logging

#### `createStructuredLogger(config)`

Create a structured logger instance.

**Config:**
- `service` (string) - Service name
- `level` (LogLevel) - Minimum log level (debug, info, warn, error)
- `format` (LogFormat) - Output format ('json' | 'pretty')

**Methods:**
- `debug(message, context?)` - Debug level log
- `info(message, context?)` - Info level log
- `warn(message, context?)` - Warning level log
- `error(message, context?)` - Error level log

### Distributed Tracing

#### `createTracer(config)`

Create a tracer instance.

**Config:**
- `name` (string) - Tracer name (usually service name)
- `version` (string, optional) - Service version
- `processor` (SpanProcessor, optional) - Span processor for export

**Methods:**
- `startActiveSpan(name, fn)` - Start a new span
- `startSpan(name, options?)` - Start a span without auto-activation

### Metrics

#### `createMeter(config)`

Create a meter instance.

**Config:**
- `name` (string) - Meter name (usually service name)
- `version` (string, optional) - Service version

**Methods:**
- `createCounter(name, options?)` - Create a counter metric
- `createGauge(name, options?)` - Create a gauge metric
- `createHistogram(name, options?)` - Create a histogram metric

### Built-in Metric Names

```typescript
import { MetricNames } from '@dotdo/observability'

// HTTP metrics
MetricNames.HTTP_REQUESTS_TOTAL      // 'http_requests_total'
MetricNames.HTTP_REQUEST_DURATION    // 'http_request_duration_ms'
MetricNames.HTTP_REQUEST_SIZE        // 'http_request_size_bytes'
MetricNames.HTTP_RESPONSE_SIZE       // 'http_response_size_bytes'

// DO metrics
MetricNames.DO_STORAGE_OPERATIONS    // 'do_storage_operations_total'
MetricNames.DO_STORAGE_SIZE          // 'do_storage_size_bytes'
MetricNames.DO_ALARM_SCHEDULED       // 'do_alarm_scheduled_total'

// RPC metrics
MetricNames.RPC_CALLS_TOTAL          // 'rpc_calls_total'
MetricNames.RPC_CALL_DURATION        // 'rpc_call_duration_ms'
```

## Best Practices

### 1. Use Structured Logging

Always use structured logging with context objects:

```typescript
// Good
logger.info('User logged in', { userId: '123', method: 'oauth' })

// Avoid
logger.info(`User ${userId} logged in via ${method}`)
```

### 2. Add Meaningful Span Attributes

Enrich spans with business context:

```typescript
tracer.startActiveSpan('checkout', (span) => {
  span.setAttribute('cart.items', cart.items.length)
  span.setAttribute('cart.total', cart.total)
  span.setAttribute('user.tier', user.tier)
  span.setAttribute('payment.method', payment.method)
})
```

### 3. Use Correlation IDs

Track requests across services:

```typescript
import { runWithContext, setMetadata } from '@dotdo/observability'

await runWithContext(async () => {
  setMetadata('correlationId', generateCorrelationId())
  // All logs and spans include this ID
})
```

### 4. Sample High-Volume Traces

For high-traffic endpoints, use sampling:

```typescript
const shouldSample = Math.random() < 0.1 // 10% sampling

if (shouldSample) {
  tracer.startActiveSpan('processRequest', (span) => {
    // ...
  })
}
```

### 5. Export in Batches

Use batch processors to reduce overhead:

```typescript
const processor = createBatchSpanProcessor(exporter, {
  maxQueueSize: 2048,
  maxExportBatchSize: 512,
  scheduledDelayMillis: 5000
})
```

## Related Packages

- [@dotdo/do](/do) - Durable Object base class
- [@dotdo/api](/api) - Self-describing API layer
- [@dotdo/rpc](/rpc) - Cap'n Web RPC

## License

MIT
