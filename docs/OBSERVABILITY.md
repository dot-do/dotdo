# Observability and Monitoring Guide

This guide covers dotdo's comprehensive observability stack, including metrics collection, structured logging, distributed tracing, and integration with external monitoring systems.

## Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Metrics Collection](#metrics-collection)
4. [Structured Logging](#structured-logging)
5. [Distributed Tracing](#distributed-tracing)
6. [Context Propagation](#context-propagation)
7. [Hono Middleware](#hono-middleware)
8. [Durable Object Integration](#durable-object-integration)
9. [Dashboard Integration](#dashboard-integration)
10. [Alerting Recommendations](#alerting-recommendations)
11. [Cloudflare Analytics Integration](#cloudflare-analytics-integration)
12. [Best Practices](#best-practices)

---

## Overview

dotdo's observability package (`@dotdo/observability`) provides a complete observability solution built on OpenTelemetry standards:

```
+------------------+    +-------------------+    +------------------+
|  Structured      |    |   Distributed     |    |   Metrics        |
|  Logging         |    |   Tracing         |    |   Collection     |
+------------------+    +-------------------+    +------------------+
         |                       |                       |
         +----------+------------+-----------+-----------+
                    |                        |
            +----------------+       +----------------+
            | Context        |       | Hono           |
            | Propagation    |       | Middleware     |
            +----------------+       +----------------+
                    |                        |
         +----------+-----------+------------+
                    |
            +----------------+
            | DO Integration |
            +----------------+
```

### Key Features

- **Structured Logging**: JSON-formatted logs with automatic sensitive data redaction
- **Distributed Tracing**: W3C Trace Context compatible spans with full hierarchy support
- **Metrics Collection**: Counters, gauges, and histograms with OpenTelemetry compatibility
- **Context Propagation**: Request-scoped context across async boundaries
- **Hono Middleware**: Automatic request tracing and logging
- **DO Integration**: Built-in observability for Durable Objects

---

## Quick Start

### Installation

```bash
npm install @dotdo/observability
```

### Basic Setup

```typescript
import {
  createStructuredLogger,
  createTracer,
  createMeter,
  observability,
} from '@dotdo/observability'

// Create logger
const logger = createStructuredLogger({
  service: 'my-service',
  level: LogLevel.INFO,
  format: 'json',
})

// Create tracer
const tracer = createTracer({ name: 'my-service' })

// Create meter for metrics
const meter = createMeter({ name: 'my-service' })

// Use with Hono
import { Hono } from 'hono'

const app = new Hono()
app.use('/*', observability({ service: 'my-api' }))
```

---

## Metrics Collection

### Metric Types

The metrics system provides three core metric types following OpenTelemetry conventions:

#### Counter

Monotonically increasing values for tracking counts:

```typescript
import { createMeter, MetricNames } from '@dotdo/observability'

const meter = createMeter({ name: 'my-service' })

const requestCounter = meter.createCounter(MetricNames.RPC_REQUEST_COUNT, {
  description: 'Total number of requests',
  unit: 'requests',
})

// Increment by 1
requestCounter.inc({ method: 'GET', status: 200 })

// Add specific value
requestCounter.add(5, { method: 'POST', status: 201 })

// Get current value
const value = requestCounter.getValue({ method: 'GET', status: 200 })
```

#### Gauge

Point-in-time measurements that can increase or decrease:

```typescript
const activeConnections = meter.createGauge(MetricNames.DO_WEBSOCKET_CONNECTIONS, {
  description: 'Active WebSocket connections',
  unit: 'connections',
})

// Set absolute value
activeConnections.set(42, { doId: 'do-123' })

// Add (can be negative)
activeConnections.add(1, { doId: 'do-123' })   // increment
activeConnections.add(-1, { doId: 'do-123' })  // decrement
```

#### Histogram

Distribution tracking with configurable buckets:

```typescript
const requestDuration = meter.createHistogram(MetricNames.DO_REQUEST_DURATION, {
  description: 'Request duration in milliseconds',
  unit: 'ms',
  boundaries: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
})

// Record a value
requestDuration.record(45, { method: 'createThing', doClass: 'CustomerDO' })

// Get histogram data
const data = requestDuration.getData({ method: 'createThing' })
// {
//   boundaries: [1, 5, 10, ...],
//   counts: [0, 2, 15, ...],
//   sum: 4523,
//   count: 100,
//   min: 3,
//   max: 892
// }
```

### Built-in Metric Names

```typescript
import { MetricNames } from '@dotdo/observability'

// HTTP metrics
MetricNames.HTTP_REQUEST_DURATION     // 'http.server.request.duration'
MetricNames.HTTP_REQUEST_SIZE         // 'http.server.request.body.size'
MetricNames.HTTP_RESPONSE_SIZE        // 'http.server.response.body.size'
MetricNames.HTTP_ACTIVE_REQUESTS      // 'http.server.active_requests'

// Durable Object metrics
MetricNames.DO_REQUEST_DURATION       // 'do.request.duration'
MetricNames.DO_STORAGE_OPERATIONS     // 'do.storage.operations'
MetricNames.DO_ALARM_EXECUTIONS       // 'do.alarm.executions'
MetricNames.DO_WEBSOCKET_CONNECTIONS  // 'do.websocket.connections'

// RPC metrics
MetricNames.RPC_REQUEST_DURATION      // 'rpc.request.duration'
MetricNames.RPC_REQUEST_COUNT         // 'rpc.request.count'
MetricNames.RPC_ERROR_COUNT           // 'rpc.error.count'

// Event metrics
MetricNames.EVENT_EMIT_COUNT          // 'event.emit.count'
MetricNames.EVENT_HANDLER_DURATION    // 'event.handler.duration'
MetricNames.EVENT_DLQ_SIZE            // 'event.dlq.size'
```

### Metrics Export

#### Console Exporter (Development)

```typescript
import { createConsoleMetricsExporter, createPeriodicReporter } from '@dotdo/observability'

const exporter = createConsoleMetricsExporter()
const reporter = createPeriodicReporter(meter, exporter, 60000) // Export every 60s

reporter.start()

// On shutdown
reporter.stop()
await reporter.flush()
```

#### Custom Exporter

```typescript
import type { MetricsExporter, MetricDataPoint } from '@dotdo/observability'

class PrometheusExporter implements MetricsExporter {
  async export(metrics: MetricDataPoint[]): Promise<void> {
    const prometheusFormat = this.formatMetrics(metrics)
    await fetch('https://pushgateway.example.com/metrics/job/my-service', {
      method: 'POST',
      body: prometheusFormat,
    })
  }

  async shutdown(): Promise<void> {
    // Cleanup
  }

  private formatMetrics(metrics: MetricDataPoint[]): string {
    return metrics.map(m => {
      const labels = Object.entries(m.attributes)
        .map(([k, v]) => `${k}="${v}"`)
        .join(',')
      return `${m.name}{${labels}} ${m.value}`
    }).join('\n')
  }
}
```

### Collecting All Metrics

```typescript
// Get all collected metrics as data points
const allMetrics = meter.collect()
// Returns: MetricDataPoint[]

// Reset all metrics (useful for testing)
meter.reset()
```

---

## Structured Logging

### Configuration

```typescript
import {
  createStructuredLogger,
  configureLogger,
  LogLevel,
  parseLogLevel,
} from '@dotdo/observability'

// Configure global defaults
configureLogger({
  level: LogLevel.INFO,
  format: 'json',
  service: 'my-service',
})

// Create logger instance
const logger = createStructuredLogger({
  service: 'order-service',
  level: parseLogLevel(process.env.LOG_LEVEL),
  format: 'json', // or 'pretty' for development
})
```

### Log Levels

```typescript
enum LogLevel {
  DEBUG = 0,  // Detailed debugging information
  INFO = 1,   // General operational information
  WARN = 2,   // Warning conditions
  ERROR = 3,  // Error conditions
  FATAL = 4,  // Critical failures
  SILENT = 5, // Disable all logging
}
```

### Logging Methods

```typescript
// Basic logging
logger.debug('Processing item', { itemId: '123' })
logger.info('Order created', { orderId: 'ord-456', total: 99.99 })
logger.warn('Rate limit approaching', { current: 95, limit: 100 })
logger.error('Payment failed', { orderId: 'ord-456', error: new Error('Declined') })
logger.fatal('Database connection lost', { host: 'db.example.com' })

// With Error objects
logger.error('Operation failed', new Error('Connection timeout'))
// Automatically extracts: { error: { name, message, stack } }
```

### Child Loggers

Create loggers with inherited context:

```typescript
const logger = createStructuredLogger({ service: 'api' })

// Create child with additional context
const requestLogger = logger.child({
  correlationId: 'req-123',
  traceId: 'trace-abc',
  userId: 'user-456',
})

// All logs include the context
requestLogger.info('Processing request')
// {"service":"api","correlationId":"req-123","traceId":"trace-abc","userId":"user-456","message":"Processing request",...}
```

### Automatic Sensitive Data Redaction

The logger automatically redacts sensitive data:

```typescript
logger.info('User authenticated', {
  userId: '123',
  password: 'secret123',      // Will be: [REDACTED]
  apiKey: 'sk_live_abc',      // Will be: [REDACTED]
  authorization: 'Bearer xyz', // Will be: [REDACTED]
  token: 'eyJhbG...',         // Will be: [REDACTED]
})
```

**Automatically redacted keys:**
- `password`, `passwd`, `secret`
- `apikey`, `api_key`, `apiKey`
- `token`, `accesstoken`, `access_token`
- `authorization`, `auth`
- `credential`, `credentials`
- `privatekey`, `private_key`

**Automatically redacted patterns:**
- JWT tokens (`eyJ...`)
- Bearer tokens
- API keys (`sk_*`, `pk_*`)

### Output Formats

**JSON Format (Production):**
```json
{"timestamp":"2026-01-21T10:30:00.000Z","level":"info","message":"Order created","service":"order-service","orderId":"ord-123","total":99.99}
```

**Pretty Format (Development):**
```
10:30:00 [INFO]  [order-service] Order created {"orderId":"ord-123","total":99.99}
```

---

## Distributed Tracing

### Creating Traces

```typescript
import {
  createTracer,
  SpanKind,
  SpanStatusCode,
} from '@dotdo/observability'

const tracer = createTracer({ name: 'order-service' })

// Start a span
const span = tracer.startSpan('processOrder', {
  kind: SpanKind.SERVER,
  attributes: {
    'order.id': 'ord-123',
    'order.total': 99.99,
  },
})

try {
  // Process order...
  span.addEvent('validation_complete', { valid: true })
  span.addEvent('payment_processed', { transactionId: 'txn-456' })

  span.setStatus({ code: SpanStatusCode.OK })
} catch (error) {
  span.recordException(error)
  span.setStatus({ code: SpanStatusCode.ERROR, message: error.message })
} finally {
  span.end()
}
```

### Active Span Management

```typescript
// Automatically manage span lifecycle
const result = await tracer.startActiveSpan('processOrder', async (span) => {
  span.setAttribute('order.id', orderId)

  // Nested spans automatically become children
  await tracer.startActiveSpan('validateOrder', async (childSpan) => {
    // ...
  })

  await tracer.startActiveSpan('chargePayment', async (childSpan) => {
    // ...
  })

  return { success: true }
})
// Span automatically ends with OK status on success
// Span automatically records exception and ERROR status on failure
```

### Span Kinds

```typescript
enum SpanKind {
  INTERNAL = 'INTERNAL',  // Internal operation
  SERVER = 'SERVER',      // Server-side request handling
  CLIENT = 'CLIENT',      // Client-side request
  PRODUCER = 'PRODUCER',  // Async request initiator
  CONSUMER = 'CONSUMER',  // Async request handler
}
```

### Span Attributes and Events

```typescript
const span = tracer.startSpan('processOrder')

// Set individual attributes
span.setAttribute('order.id', 'ord-123')
span.setAttribute('order.items', 5)
span.setAttribute('order.priority', 'high')

// Set multiple attributes
span.setAttributes({
  'customer.id': 'cust-456',
  'customer.tier': 'premium',
})

// Add events (timestamped annotations)
span.addEvent('inventory_checked', { available: true })
span.addEvent('payment_initiated', { provider: 'stripe' })

// Add links to related spans
span.addLink({
  traceId: 'other-trace-id',
  spanId: 'other-span-id',
  attributes: { relationship: 'caused_by' },
})
```

### W3C Trace Context Propagation

```typescript
import {
  parseTraceparent,
  formatTraceparent,
  extractTraceContext,
  injectTraceContext,
  TRACEPARENT_HEADER,
} from '@dotdo/observability'

// Parse incoming trace context
const context = parseTraceparent(
  '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'
)
// { traceId: '4bf92f3577b34da6a3ce929d0e0e4736', spanId: '00f067aa0ba902b7', traceFlags: 1 }

// Extract from headers
const parentContext = extractTraceContext(request.headers)

// Create child span with parent
const span = tracer.startSpan('handleRequest', { parent: parentContext })

// Inject into outgoing request
const headers = new Headers()
injectTraceContext(headers, span.context())
```

### Span Export

```typescript
import {
  createConsoleExporter,
  createBatchSpanProcessor,
  type SpanExporter,
} from '@dotdo/observability'

// Console exporter for development
const consoleExporter = createConsoleExporter()

// Batch processor for efficiency
const processor = createBatchSpanProcessor(consoleExporter, {
  maxQueueSize: 2048,
  maxExportBatchSize: 512,
  scheduledDelayMs: 5000,
})

// Use custom exporter
class DatadogExporter implements SpanExporter {
  async export(spans: SpanData[]): Promise<void> {
    // Convert and send to Datadog
  }

  async shutdown(): Promise<void> {
    // Cleanup
  }
}
```

### Function Instrumentation

```typescript
import { instrument } from '@dotdo/observability'

// Wrap function with automatic span creation
const processOrder = instrument(
  'processOrder',
  async (order: Order) => {
    // Automatically traced
    return await orderService.process(order)
  },
  {
    kind: SpanKind.INTERNAL,
    attributes: { 'service.name': 'order-processor' },
  }
)
```

---

## Context Propagation

### Request-Scoped Context

```typescript
import {
  createObservabilityContext,
  runWithContext,
  runInNewContext,
  runWithChildContext,
  getContext,
  getCorrelationId,
} from '@dotdo/observability'

// Create and run with context
const context = createObservabilityContext({
  correlationId: 'req-123',
  traceContext: parentSpan.context(),
})

await runWithContext(context, async () => {
  // Context available anywhere in this execution
  const ctx = getContext()
  const corrId = getCorrelationId()
})

// Simpler: create new context automatically
await runInNewContext({ correlationId: 'req-456' }, async () => {
  // ...
})

// Create child context inheriting from parent
await runWithChildContext({ metadata: { userId: '123' } }, async () => {
  // Inherits parent's correlationId, traceContext, baggage
})
```

### Baggage Propagation

Propagate key-value pairs across service boundaries:

```typescript
import {
  setBaggageItem,
  getBaggageItem,
  getAllBaggage,
  formatBaggage,
  parseBaggage,
  BAGGAGE_HEADER,
} from '@dotdo/observability'

// Set baggage in current context
setBaggageItem('userId', 'user-123')
setBaggageItem('tenant', 'acme-corp')
setBaggageItem('feature-flags', 'dark-mode,beta')

// Get baggage
const userId = getBaggageItem('userId')
const allBaggage = getAllBaggage()

// Propagate via headers
const headers = new Headers()
headers.set(BAGGAGE_HEADER, formatBaggage(allBaggage))
// "userId=user-123,tenant=acme-corp,feature-flags=dark-mode%2Cbeta"

// Parse incoming baggage
const incomingBaggage = parseBaggage(request.headers.get('baggage') || '')
```

### Metadata

```typescript
import { setMetadata, getMetadata } from '@dotdo/observability'

// Store arbitrary metadata in context
setMetadata('startTime', Date.now())
setMetadata('userPreferences', { theme: 'dark' })

// Retrieve metadata
const startTime = getMetadata('startTime') as number
```

### Context Holder

Convenient wrapper for context operations:

```typescript
import { createContextHolder } from '@dotdo/observability'

const ctx = createContextHolder({
  correlationId: 'req-123',
})

// Access properties
console.log(ctx.correlationId) // 'req-123'

// Baggage operations
ctx.baggage.set('userId', '456')
ctx.baggage.get('userId') // '456'

// Metadata operations
ctx.metadata.set('startTime', Date.now())
ctx.metadata.get('startTime')

// Run with context
await ctx.run(async () => {
  // Context active here
})
```

---

## Hono Middleware

### Basic Usage

```typescript
import { Hono } from 'hono'
import { observability } from '@dotdo/observability'

const app = new Hono()

// Add observability middleware
app.use('/*', observability({
  service: 'my-api',
}))

app.get('/users/:id', async (c) => {
  // Automatically:
  // - Creates span for request
  // - Logs request/response
  // - Propagates trace context
  // - Sets correlation ID in response
  return c.json({ id: c.req.param('id') })
})
```

### Configuration Options

```typescript
import { observability, LogLevel } from '@dotdo/observability'

app.use('/*', observability({
  service: 'my-api',
  logLevel: LogLevel.INFO,
  logRequestBody: false,      // Log request bodies
  logResponseBody: false,     // Log response bodies
  maxBodyLogLength: 1000,     // Truncate logged bodies
  excludeHeaders: [           // Headers to redact
    'authorization',
    'cookie',
    'x-api-key',
  ],
  excludePaths: [             // Paths to skip tracing
    '/health',
    '/metrics',
    '/favicon.ico',
  ],
  enableTracing: true,        // Enable span creation
  enableLogging: true,        // Enable request logging
  logger: customLogger,       // Use custom logger
  tracer: customTracer,       // Use custom tracer
}))
```

### Request Logger

```typescript
import { getRequestLogger } from '@dotdo/observability'

app.get('/orders/:id', async (c) => {
  // Get logger with request context
  const logger = getRequestLogger(c, 'orders-handler')

  logger.info('Fetching order', { orderId: c.req.param('id') })
  // Automatically includes correlationId, traceId, spanId

  const order = await getOrder(c.req.param('id'))
  return c.json(order)
})
```

### Timing Middleware

```typescript
import { timing } from '@dotdo/observability'

// Add X-Response-Time header
app.use('/*', timing())
// Response header: X-Response-Time: 45ms
```

### Request ID Middleware

```typescript
import { requestId } from '@dotdo/observability'

// Ensure every request has a correlation ID
app.use('/*', requestId())
// Response header: x-correlation-id: <generated-or-passed-id>
```

---

## Durable Object Integration

### Setup DO Observability

```typescript
import { createDOObservability } from '@dotdo/observability'

export class MyDO {
  private obs = createDOObservability({
    serviceName: 'my-do',
    doId: this.state.id,
    doClassName: 'MyDO',
    enableTracing: true,
    enableMetrics: true,
    enableLogging: true,
  })

  async fetch(request: Request): Promise<Response> {
    // Extract context from incoming request
    const { correlationId, traceContext } = extractDOContextFromHeaders(request.headers)

    // Create request context
    const ctx = this.obs.createRequestContext(correlationId, traceContext)

    // Wrap method with observability
    return this.obs.wrapMethod('fetch', async () => {
      ctx.logger.info('Handling request', { url: request.url })

      // Your logic here...

      return new Response('OK')
    }, ctx)
  }
}
```

### DO Metrics

```typescript
// Built-in DO metrics
const { metrics } = createDOObservability({ serviceName: 'my-do' })

// Request metrics (automatically tracked by wrapMethod)
metrics.requestCount      // Counter: requests by method
metrics.requestDuration   // Histogram: request duration
metrics.errorCount        // Counter: errors by type

// Storage tracking
metrics.storageOperations // Counter: storage operations

// Alarm tracking
metrics.alarmExecutions   // Counter: alarm executions

// WebSocket tracking
metrics.websocketConnections // Gauge: active connections
```

### Storage Tracking

```typescript
const obs = createDOObservability({ serviceName: 'my-do' })

// Track storage operations
obs.trackStorageOperation('get', { keyPrefix: 'user' })
obs.trackStorageOperation('put', { keyPrefix: 'order', size: 1024 })
obs.trackStorageOperation('delete', { keyPrefix: 'session' })
obs.trackStorageOperation('list', { prefix: 'items/' })

// Or use the storage tracker helper
const storage = createStorageTracker(obs)

storage.trackGet('user:123')
storage.trackPut('order:456')
storage.trackDelete('session:789')
storage.trackList('items/')
storage.trackTransaction(5) // 5 operations in transaction
```

### Alarm Tracking

```typescript
async alarm(): Promise<void> {
  const startTime = Date.now()
  let success = false

  try {
    await this.processAlarm()
    success = true
  } finally {
    const duration = Date.now() - startTime
    this.obs.trackAlarmExecution(success, duration)
  }
}
```

### WebSocket Tracking

```typescript
async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
  // Track connection on open (elsewhere)
  this.obs.updateWebSocketCount(1)

  // Track disconnection on close (elsewhere)
  this.obs.updateWebSocketCount(-1)
}
```

### Context Propagation Between DOs

```typescript
import {
  extractDOContextFromHeaders,
  injectDOContextToHeaders,
} from '@dotdo/observability'

// In calling DO
const ctx = this.obs.createRequestContext()
const headers = new Headers()
injectDOContextToHeaders(headers, ctx)

const stub = env.OTHER_DO.get(id)
const response = await stub.fetch(new Request(url, { headers }))

// In receiving DO
async fetch(request: Request): Promise<Response> {
  const { correlationId, traceContext } = extractDOContextFromHeaders(request.headers)
  const ctx = this.obs.createRequestContext(correlationId, traceContext)

  // Spans are now linked across DOs
}
```

---

## Dashboard Integration

### Grafana Setup

#### Prometheus Data Source

Configure Prometheus to scrape your metrics endpoint:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'dotdo'
    scrape_interval: 15s
    static_configs:
      - targets: ['your-worker.workers.dev']
    metrics_path: /metrics
    scheme: https
```

#### Key Grafana Queries

**Request Rate:**
```promql
sum(rate(rpc_request_count[5m])) by (method)
```

**Request Latency (p99):**
```promql
histogram_quantile(0.99,
  sum(rate(do_request_duration_bucket[5m])) by (le, do_class)
)
```

**Error Rate:**
```promql
sum(rate(rpc_error_count[5m])) /
sum(rate(rpc_request_count[5m]))
```

**Active WebSocket Connections:**
```promql
sum(do_websocket_connections) by (do_class)
```

**Storage Operations:**
```promql
sum(rate(do_storage_operations[5m])) by (operation)
```

### Datadog Integration

```typescript
import type { MetricsExporter, MetricDataPoint } from '@dotdo/observability'

class DatadogMetricsExporter implements MetricsExporter {
  constructor(private apiKey: string, private site = 'datadoghq.com') {}

  async export(metrics: MetricDataPoint[]): Promise<void> {
    const now = Math.floor(Date.now() / 1000)

    const series = metrics.map(metric => ({
      metric: `dotdo.${metric.name}`,
      type: metric.type === 'counter' ? 'count' : 'gauge',
      points: [[now, metric.value]],
      tags: Object.entries(metric.attributes).map(([k, v]) => `${k}:${v}`),
    }))

    await fetch(`https://api.${this.site}/api/v2/series`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'DD-API-KEY': this.apiKey,
      },
      body: JSON.stringify({ series }),
    })
  }

  async shutdown(): Promise<void> {}
}
```

### Trace Export to Datadog

```typescript
import type { SpanExporter, SpanData } from '@dotdo/observability'

class DatadogTraceExporter implements SpanExporter {
  constructor(private apiKey: string, private site = 'datadoghq.com') {}

  async export(spans: SpanData[]): Promise<void> {
    const traces = spans.map(span => ({
      trace_id: BigInt(`0x${span.traceId.slice(16)}`).toString(),
      span_id: BigInt(`0x${span.spanId}`).toString(),
      parent_id: span.parentSpanId
        ? BigInt(`0x${span.parentSpanId}`).toString()
        : '0',
      name: span.name,
      service: 'dotdo',
      resource: span.name,
      type: span.kind === 'SERVER' ? 'web' : 'custom',
      start: span.startTime * 1000000, // nanoseconds
      duration: ((span.endTime || span.startTime) - span.startTime) * 1000000,
      error: span.status.code === 'ERROR' ? 1 : 0,
      meta: Object.fromEntries(
        Object.entries(span.attributes).filter(([_, v]) => typeof v === 'string')
      ),
      metrics: Object.fromEntries(
        Object.entries(span.attributes).filter(([_, v]) => typeof v === 'number')
      ),
    }))

    await fetch(`https://trace.agent.${this.site}/v0.4/traces`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Datadog-Trace-Count': traces.length.toString(),
        'DD-API-KEY': this.apiKey,
      },
      body: JSON.stringify([traces]),
    })
  }

  async shutdown(): Promise<void> {}
}
```

---

## Alerting Recommendations

### Critical Alerts (PagerDuty)

| Alert | Condition | Severity | Response |
|-------|-----------|----------|----------|
| High Error Rate | `error_rate > 5%` for 5min | Critical | Check logs, recent deployments |
| DO Unavailable | Health check fails for 2min | Critical | Check DO state, review errors |
| High Latency | `p99 > 5s` for 5min | Critical | Scale horizontally, optimize queries |
| Storage Failures | Storage error rate > 1% | Critical | Check storage connectivity |

### Warning Alerts (Slack)

| Alert | Condition | Severity | Response |
|-------|-----------|----------|----------|
| Elevated Latency | `p99 > 1s` for 10min | Warning | Monitor, prepare to scale |
| High Memory | Memory > 80% | Warning | Review caching, check leaks |
| Retry Rate | Retries > 10% of requests | Warning | Check downstream services |
| WebSocket Spike | Connections > 2x normal | Warning | Prepare for load |

### Prometheus Alerting Rules

```yaml
groups:
  - name: dotdo
    rules:
      - alert: DotdoHighErrorRate
        expr: |
          sum(rate(rpc_error_count[5m])) /
          sum(rate(rpc_request_count[5m])) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High error rate in dotdo ({{ $value | humanizePercentage }})"

      - alert: DotdoHighLatency
        expr: |
          histogram_quantile(0.99,
            sum(rate(do_request_duration_bucket[5m])) by (le)
          ) > 5000
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "DO request latency p99 > 5s"

      - alert: DotdoAlarmFailures
        expr: |
          sum(rate(do_alarm_executions{success="false"}[5m])) > 0
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "DO alarm failures detected"
```

---

## Cloudflare Analytics Integration

### Workers Analytics Engine

dotdo integrates with Cloudflare's Workers Analytics Engine for built-in observability:

```typescript
// In wrangler.toml
// [[analytics_engine_datasets]]
// binding = "ANALYTICS"

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const startTime = Date.now()

    try {
      const response = await handleRequest(request, env)

      // Write to Analytics Engine
      env.ANALYTICS.writeDataPoint({
        blobs: [
          request.url,
          request.method,
          response.status.toString(),
        ],
        doubles: [
          Date.now() - startTime, // duration
          response.headers.get('content-length') || 0,
        ],
        indexes: [
          new URL(request.url).pathname, // index for querying
        ],
      })

      return response
    } catch (error) {
      env.ANALYTICS.writeDataPoint({
        blobs: [request.url, request.method, 'error', error.message],
        doubles: [Date.now() - startTime],
        indexes: [new URL(request.url).pathname],
      })
      throw error
    }
  },
}
```

### Querying Analytics

Use Cloudflare's GraphQL API to query analytics:

```graphql
query {
  viewer {
    accounts(filter: { accountTag: $accountId }) {
      workersAnalyticsEngineAdaptiveGroups(
        limit: 100
        filter: {
          datetime_geq: "2026-01-20T00:00:00Z"
          datetime_lt: "2026-01-21T00:00:00Z"
        }
        orderBy: [sum_double1_DESC]
      ) {
        dimensions {
          index1  # pathname
        }
        sum {
          double1  # total duration
        }
        avg {
          double1  # average duration
        }
        count
      }
    }
  }
}
```

### Logpush Integration

Configure Cloudflare Logpush to export logs to your preferred destination:

```typescript
// Logs are automatically captured and can be pushed to:
// - S3
// - R2
// - Datadog
// - Splunk
// - Azure Blob Storage
// - BigQuery
```

---

## Best Practices

### 1. Use Structured Logging

```typescript
// Good - structured data
logger.info('Order created', {
  orderId: 'ord-123',
  customerId: 'cust-456',
  total: 99.99,
  items: 3,
})

// Avoid - string interpolation
logger.info(`Order ord-123 created for customer cust-456, total $99.99`)
```

### 2. Add Business Context to Spans

```typescript
tracer.startActiveSpan('processOrder', (span) => {
  // Add business context
  span.setAttribute('order.id', order.id)
  span.setAttribute('order.total', order.total)
  span.setAttribute('customer.tier', customer.tier)
  span.setAttribute('payment.method', payment.type)

  // Add events for key milestones
  span.addEvent('inventory_reserved')
  span.addEvent('payment_captured')
  span.addEvent('fulfillment_started')
})
```

### 3. Keep Metric Cardinality Low

```typescript
// Good - bounded cardinality
meter.createCounter('requests').inc({
  method: 'GET',      // ~5 values
  status: '2xx',      // ~5 values
  endpoint: '/users', // ~20 values
})

// Avoid - unbounded cardinality
meter.createCounter('requests').inc({
  userId: user.id,    // Millions of values!
  requestId: req.id,  // Unique per request!
})
```

### 4. Use Correlation IDs

Always propagate correlation IDs across service boundaries:

```typescript
// Set on incoming request
const correlationId = request.headers.get('x-correlation-id') || generateCorrelationId()

// Include in all logs
const logger = baseLogger.child({ correlationId })

// Propagate to downstream services
const headers = new Headers()
headers.set('x-correlation-id', correlationId)
await fetch(url, { headers })
```

### 5. Sample High-Volume Traces

For high-traffic endpoints, use sampling:

```typescript
const SAMPLE_RATE = 0.1 // 10%

function shouldSample(): boolean {
  return Math.random() < SAMPLE_RATE
}

// Always trace errors
if (error || shouldSample()) {
  tracer.startActiveSpan('processRequest', (span) => {
    // ...
  })
}
```

### 6. Use Batch Export

```typescript
const processor = createBatchSpanProcessor(exporter, {
  maxQueueSize: 2048,        // Queue size before dropping
  maxExportBatchSize: 512,   // Batch size per export
  scheduledDelayMs: 5000,    // Export interval
})
```

### 7. Handle Sensitive Data

```typescript
// Logger automatically redacts, but be explicit
logger.info('User authenticated', {
  userId: user.id,
  email: user.email,
  // Don't log: password, token, apiKey
})

// For spans, avoid sensitive attributes
span.setAttribute('user.id', user.id)
// Don't add: span.setAttribute('user.password', password)
```

### 8. Set Up Proper Alerting Thresholds

Base thresholds on historical data:

```typescript
// Query historical p99
const historicalP99 = await queryPrometheus(`
  quantile_over_time(0.99, do_request_duration[7d])
`)

// Set alert at 2x baseline
const alertThreshold = historicalP99 * 2
```

---

## API Reference

### Module Exports

```typescript
// Logging
export {
  LogLevel,
  parseLogLevel,
  configureLogger,
  getLoggerConfig,
  createStructuredLogger,
  logger,
} from './logger'

// Tracing
export {
  generateTraceId,
  generateSpanId,
  SpanStatusCode,
  SpanKind,
  createTracer,
  getTracer,
  setGlobalTracer,
  parseTraceparent,
  formatTraceparent,
  extractTraceContext,
  injectTraceContext,
  createConsoleExporter,
  createBatchSpanProcessor,
  instrument,
} from './tracing'

// Context
export {
  generateCorrelationId,
  createObservabilityContext,
  getContext,
  getOrCreateContext,
  runWithContext,
  runInNewContext,
  runWithChildContext,
  getCorrelationId,
  getTraceContext,
  getBaggageItem,
  setBaggageItem,
  getAllBaggage,
  getMetadata,
  setMetadata,
  parseBaggage,
  formatBaggage,
  extractContextFromHeaders,
  injectContextToHeaders,
  createContextHolder,
} from './context'

// Middleware
export {
  observability,
  getRequestLogger,
  timing,
  requestId,
} from './middleware'

// Metrics
export {
  MetricType,
  createMeter,
  getMeter,
  setGlobalMeter,
  createConsoleMetricsExporter,
  createPeriodicReporter,
  MetricNames,
} from './metrics'

// DO Integration
export {
  createDOObservability,
  createDOMetrics,
  extractDOContextFromHeaders,
  injectDOContextToHeaders,
  createStorageTracker,
} from './do-integration'

// API Integration
export {
  createAPIObservabilityMiddleware,
  createAPIMetrics,
  createRouteTracer,
  metricsEndpoint,
} from './api-integration'
```

---

## Related Documentation

- [Getting Started Guide](./GETTING_STARTED.md) - Initial setup
- [Deployment Guide](./DEPLOYMENT.md) - Production deployment
- [Troubleshooting Guide](./TROUBLESHOOTING.md) - Common issues
- [@dotdo/observability README](/observability/README.md) - Package documentation
