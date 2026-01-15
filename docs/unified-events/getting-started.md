# Unified Events Getting Started Guide

This guide covers the fundamentals of dotdo's Unified Events system, which provides a comprehensive observability solution that unifies traces, metrics, logs, analytics, Web Vitals, and CDC (Change Data Capture) into a single event schema.

## Table of Contents

1. [Introduction](#introduction)
2. [Quick Start](#quick-start)
3. [Event Types](#event-types)
4. [Querying](#querying)
5. [Examples](#examples)

---

## Introduction

### What is Unified Events?

Unified Events is dotdo's observability infrastructure that consolidates all your observability data into a single, comprehensive 165-column event schema. Instead of managing separate systems for traces, metrics, logs, and analytics, Unified Events provides a unified schema that can represent any type of observability data.

The system is built around the `UnifiedEvent` type, which combines 23 semantic groups covering everything from distributed tracing to Web Vitals to database change capture.

### Why Unify Observability Data?

Traditional observability stacks require multiple tools:

- **Tracing**: Jaeger, Zipkin, or Datadog APM
- **Metrics**: Prometheus, Datadog Metrics
- **Logs**: ELK Stack, Splunk, Datadog Logs
- **Analytics**: Segment, Amplitude, Mixpanel
- **RUM**: Google Analytics, Sentry

With Unified Events, you get:

- **Single Query Interface**: Query traces, logs, and metrics with the same SQL syntax
- **Cross-Signal Correlation**: Join traces with logs by `trace_id`, correlate user sessions across events
- **Reduced Operational Overhead**: One schema, one storage tier, one query layer
- **Cost Efficiency**: Optimized hot/cold tiered storage with automatic data lifecycle management

### Key Benefits

1. **165-Column Schema**: Comprehensive coverage for all observability needs
2. **OTEL Compatible**: Native support for OpenTelemetry traces, metrics, and logs
3. **Segment Compatible**: Drop-in replacement for Segment-style analytics
4. **Real-Time Streaming**: WebSocket-based live event streaming
5. **Tiered Storage**: Hot tier for real-time queries, cold tier for historical analysis
6. **Type Safety**: Full TypeScript types with discriminated unions

---

## Quick Start

### Install the SDK

```bash
npm install dotdo
```

### Initialize the Client

```typescript
import { createUnifiedEvent } from 'dotdo/types/unified-event'

// Create and send events directly
const event = createUnifiedEvent({
  id: crypto.randomUUID(),
  event_type: 'track',
  event_name: 'user.signup',
  ns: 'https://api.myapp.com',

  // Actor information
  actor_id: 'user-123',

  // Timing
  timestamp: new Date().toISOString(),

  // Custom properties
  properties: {
    plan: 'premium',
    referrer: 'google'
  }
})
```

### Send Your First Event

**Via HTTP Broadcast:**

```typescript
// POST to your EventStreamDO instance
const response = await fetch('https://stream.myapp.com/broadcast', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    event_type: 'track',
    event_name: 'button.clicked',
    ns: 'https://app.myapp.com',
    actor_id: 'user-456',
    timestamp: new Date().toISOString(),
    properties: {
      button_id: 'checkout-cta',
      page: '/cart'
    }
  })
})
```

**Via WebSocket Subscription:**

```typescript
// Connect to real-time stream
const ws = new WebSocket('wss://stream.myapp.com/events?topic=user.events')

ws.onmessage = (event) => {
  const unified = JSON.parse(event.data)
  console.log(`Event: ${unified.event_name}`, unified.properties)
}

ws.onopen = () => {
  console.log('Connected to event stream')
}
```

---

## Event Types

The Unified Events schema supports 10 event types, each optimized for specific observability use cases.

### Traces (OTEL Compatible)

Distributed tracing spans with full W3C Trace Context support.

```typescript
import { transformOtelSpan, SpanKind, StatusCode } from 'dotdo/db/streams/transformers'

const span = {
  traceId: '5b8aa5a2d2c872e8321cf37308d69df2',
  spanId: 'b7ad6b7169203331',
  parentSpanId: 'a1b2c3d4e5f67890',
  name: 'HTTP GET /api/users',
  kind: SpanKind.SERVER,
  startTimeUnixNano: '1705329045123000000',
  endTimeUnixNano: '1705329045145000000',
  attributes: [
    { key: 'http.method', value: { stringValue: 'GET' } },
    { key: 'http.url', value: { stringValue: '/api/users' } },
    { key: 'http.status_code', value: { intValue: 200 } }
  ],
  status: { code: StatusCode.OK }
}

const resource = {
  attributes: [
    { key: 'service.name', value: { stringValue: 'user-service' } },
    { key: 'service.version', value: { stringValue: '1.2.3' } }
  ]
}

const event = transformOtelSpan(span, resource)
// event.event_type === 'trace'
// event.trace_id === '5b8aa5a2d2c872e8321cf37308d69df2'
// event.duration_ms === 22
```

**Key Fields:**
- `trace_id`: W3C trace ID (32 hex chars)
- `span_id`: Span ID within the trace (16 hex chars)
- `parent_id`: Parent span ID for hierarchical traces
- `duration_ms`: Span duration in milliseconds
- `outcome`: 'success', 'error', or null

### Metrics

OpenTelemetry-compatible metrics including gauges, counters, and histograms.

```typescript
import { transformOtelMetric } from 'dotdo/db/streams/transformers'

const metric = {
  name: 'http.request.duration',
  unit: 'ms',
  histogram: {
    dataPoints: [{
      startTimeUnixNano: '1705329000000000000',
      timeUnixNano: '1705329060000000000',
      count: 150,
      sum: 4500,
      min: 5,
      max: 250,
      bucketCounts: [10, 50, 60, 25, 5],
      explicitBounds: [10, 50, 100, 200]
    }]
  }
}

const event = transformOtelMetric(metric)
// event.event_type === 'metric'
// event.metric_name === 'http.request.duration'
// event.metric_type === 'histogram'
```

**Key Fields:**
- `metric_name`: Metric identifier
- `metric_type`: 'gauge', 'counter', or 'histogram'
- `metric_value`: Value for gauges/counters
- `metric_buckets`: Histogram bucket data (JSON)

### Logs

Structured logging with OTEL severity levels.

```typescript
import { transformOtelLog, severityNumberToLevel } from 'dotdo/db/streams/transformers'

const log = {
  timeUnixNano: '1705329045123000000',
  severityNumber: 17, // ERROR level
  body: { stringValue: 'Database connection failed: timeout after 30s' },
  traceId: '5b8aa5a2d2c872e8321cf37308d69df2',
  attributes: [
    { key: 'db.system', value: { stringValue: 'postgres' } },
    { key: 'db.name', value: { stringValue: 'users' } }
  ]
}

const event = transformOtelLog(log, resource)
// event.event_type === 'log'
// event.log_level === 'error'
// event.log_message === 'Database connection failed: timeout after 30s'
// event.trace_id === '5b8aa5a2d2c872e8321cf37308d69df2'
```

**Severity Mapping:**
| Severity Number | Level |
|-----------------|-------|
| 1-4 | trace |
| 5-8 | debug |
| 9-12 | info |
| 13-16 | warn |
| 17-20 | error |
| 21-24 | fatal |

### Analytics (Segment Compatible)

User action tracking with Segment-style event format.

```typescript
import { transformSegmentTrack } from 'dotdo/db/streams/transformers'

const trackEvent = {
  event: 'Product Viewed',
  userId: 'user-123',
  anonymousId: 'anon-456',
  properties: {
    product_id: 'prod-789',
    product_name: 'Premium Widget',
    price: 99.99,
    category: 'widgets'
  },
  context: {
    page: {
      url: 'https://shop.example.com/products/789',
      title: 'Premium Widget - Shop'
    },
    campaign: {
      source: 'google',
      medium: 'cpc',
      name: 'summer_sale'
    },
    device: {
      type: 'mobile',
      model: 'iPhone 15'
    }
  },
  timestamp: '2024-01-15T14:30:00.000Z'
}

const event = transformSegmentTrack(trackEvent, 'https://shop.example.com')
// event.event_type === 'track'
// event.event_name === 'Product Viewed'
// event.actor_id === 'user-123'
// event.campaign_source === 'google'
```

**Key Fields:**
- `actor_id`: Authenticated user identifier
- `anonymous_id`: Device/anonymous identifier
- `properties`: Event-specific data
- `campaign_*`: UTM parameters
- `device_*`: Device information

### Web Vitals

Core Web Vitals and performance metrics from the browser.

```typescript
import { transformWebVital } from 'dotdo/db/streams/transformers'

// Capture LCP from web-vitals library
const vital = {
  name: 'LCP',
  value: 2500,      // milliseconds
  rating: 'good',   // 'good' | 'needs-improvement' | 'poor'
  delta: 2500,
  id: 'v3-1705329045-abc',
  navigationType: 'navigate',
  entries: []
}

const event = transformWebVital(vital, {
  pageUrl: 'https://app.example.com/dashboard',
  sessionId: 'session-123',
  ns: 'https://app.example.com'
})
// event.event_type === 'vital'
// event.vital_name === 'LCP'
// event.vital_value === 2500
// event.vital_rating === 'good'
```

**Supported Vitals:**
- **LCP** (Largest Contentful Paint): Loading performance
- **FID** (First Input Delay): Interactivity
- **CLS** (Cumulative Layout Shift): Visual stability
- **TTFB** (Time to First Byte): Server response time
- **INP** (Interaction to Next Paint): Input responsiveness
- **FCP** (First Contentful Paint): First render time

### CDC (Change Data Capture)

Database change events for real-time data synchronization.

```typescript
import { transformCdcEvent } from 'dotdo/db/streams/transformers'

const cdcEvent = {
  operation: 'UPDATE',
  table: 'users',
  schema: 'public',
  primaryKey: 'user-123',
  before: {
    id: 'user-123',
    name: 'Alice',
    email: 'alice@example.com',
    plan: 'free'
  },
  after: {
    id: 'user-123',
    name: 'Alice',
    email: 'alice@example.com',
    plan: 'premium'
  },
  transactionId: 'txn-456',
  lsn: 12345678,
  version: 2,
  timestamp: new Date()
}

const event = transformCdcEvent(cdcEvent, 'https://api.example.com/tenant-1')
// event.event_type === 'cdc'
// event.event_name === 'users.UPDATE'
// event.db_operation === 'UPDATE'
// event.db_table === 'users'
// event.db_before === '{"id":"user-123","name":"Alice",...,"plan":"free"}'
// event.db_after === '{"id":"user-123","name":"Alice",...,"plan":"premium"}'
```

**Key Fields:**
- `db_operation`: 'INSERT', 'UPDATE', or 'DELETE'
- `db_table`: Affected table name
- `db_row_id`: Primary key value
- `db_before`: Row state before change (JSON)
- `db_after`: Row state after change (JSON)
- `db_lsn`: Log sequence number for ordering

### Additional Event Types

| Type | Description | Use Case |
|------|-------------|----------|
| `page` | Page view events | User navigation tracking |
| `replay` | Session replay data | DOM mutations, user interactions |
| `tail` | Workers tail events | Real-time log streaming |
| `snippet` | Browser snippet timing | Resource performance data |

---

## Querying

Unified Events supports a tiered storage architecture with different query interfaces for real-time and historical data.

### Hot Tier (Real-Time)

The hot tier stores recent events (default: 5 minutes) in PGLite for fast, real-time queries.

**Query via HTTP:**

```typescript
// Basic query
const response = await fetch('https://stream.myapp.com/query', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    sql: `SELECT * FROM events WHERE event_type = 'trace' ORDER BY timestamp DESC LIMIT 100`
  })
})

const { rows } = await response.json()
```

**Unified Query Endpoint:**

```typescript
// Query with typed filters
const response = await fetch('https://stream.myapp.com/query/unified', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    event_type: 'trace',
    trace_id: '5b8aa5a2d2c872e8321cf37308d69df2',
    limit: 50
  })
})
```

**Trace Query:**

```typescript
// Get all spans for a trace
const response = await fetch(
  'https://stream.myapp.com/query/trace?trace_id=5b8aa5a2d2c872e8321cf37308d69df2'
)

const spans = await response.json()
// Returns all events with matching trace_id, ordered by timestamp
```

**Session Query:**

```typescript
// Get all events for a user session
const response = await fetch(
  'https://stream.myapp.com/query/session?session_id=session-123'
)

const sessionEvents = await response.json()
// Returns all events with matching session_id
```

### Cold Tier (Historical)

For historical queries beyond the hot tier retention window, query the cold tier (Iceberg/Parquet format) via standard SQL interfaces.

```sql
-- Query last 24 hours of errors
SELECT
  trace_id,
  service_name,
  error_message,
  timestamp
FROM unified_events
WHERE event_type = 'log'
  AND log_level = 'error'
  AND day = '2024-01-15'
ORDER BY timestamp DESC
LIMIT 1000;

-- Aggregate metrics by service
SELECT
  service_name,
  COUNT(*) as request_count,
  AVG(duration_ms) as avg_duration,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) as p95
FROM unified_events
WHERE event_type = 'trace'
  AND day = '2024-01-15'
GROUP BY service_name;
```

### Cross-Tier Queries

For queries that span both hot and cold tiers, use the correlation IDs:

```typescript
// Find related events across tiers
const traceId = '5b8aa5a2d2c872e8321cf37308d69df2'

// Hot tier: recent spans
const hotResponse = await fetch(`https://stream.myapp.com/query/trace?trace_id=${traceId}`)
const hotSpans = await hotResponse.json()

// Cold tier: historical spans (via your data lake query interface)
const coldSpans = await queryDataLake(`
  SELECT * FROM unified_events
  WHERE trace_id = '${traceId}'
    AND day >= '2024-01-01'
`)

// Merge results
const allSpans = [...hotSpans, ...coldSpans]
  .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
```

---

## Examples

### Browser Instrumentation

Complete browser instrumentation with Web Vitals and analytics.

```typescript
// browser-instrumentation.ts
import { onLCP, onFID, onCLS, onTTFB, onINP, onFCP } from 'web-vitals'
import { transformWebVital, transformSegmentTrack } from 'dotdo/db/streams/transformers'

const NS = 'https://app.example.com'
const STREAM_URL = 'wss://stream.example.com/events'

// Session management
const sessionId = sessionStorage.getItem('session_id') || crypto.randomUUID()
sessionStorage.setItem('session_id', sessionId)

// Connect to event stream
const ws = new WebSocket(`${STREAM_URL}?topic=client.events`)

function sendEvent(event: any) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(event))
  }
}

// Capture Web Vitals
const captureVital = (metric: any) => {
  const event = transformWebVital(metric, {
    pageUrl: window.location.href,
    sessionId,
    ns: NS
  })
  sendEvent(event)
}

onLCP(captureVital)
onFID(captureVital)
onCLS(captureVital)
onTTFB(captureVital)
onINP(captureVital)
onFCP(captureVital)

// Track user actions
function track(eventName: string, properties: Record<string, unknown> = {}) {
  const event = transformSegmentTrack({
    event: eventName,
    userId: getCurrentUserId(), // Your auth system
    anonymousId: sessionId,
    properties,
    context: {
      page: {
        url: window.location.href,
        title: document.title,
        referrer: document.referrer
      }
    },
    timestamp: new Date()
  }, NS)

  sendEvent(event)
}

// Track page views
function page(name?: string, properties?: Record<string, unknown>) {
  track('Page Viewed', {
    name: name || document.title,
    url: window.location.href,
    path: window.location.pathname,
    search: window.location.search,
    ...properties
  })
}

// Export for use in your app
export const analytics = { track, page }
```

### Server-Side Tracing

OpenTelemetry integration for server-side applications.

```typescript
// server-tracing.ts
import { transformOtelSpan, transformOtelLog, SpanKind } from 'dotdo/db/streams/transformers'
import type { OtlpSpan, OtlpResource } from 'dotdo/db/streams/transformers'

const SERVICE_NAME = 'api-gateway'
const SERVICE_VERSION = '2.1.0'
const STREAM_URL = 'https://stream.example.com/broadcast'

// Resource metadata (shared across all spans)
const resource: OtlpResource = {
  attributes: [
    { key: 'service.name', value: { stringValue: SERVICE_NAME } },
    { key: 'service.version', value: { stringValue: SERVICE_VERSION } },
    { key: 'deployment.environment', value: { stringValue: process.env.NODE_ENV || 'development' } }
  ]
}

// Simple span tracking
class Tracer {
  private spans: Map<string, { span: OtlpSpan; startTime: bigint }> = new Map()

  startSpan(name: string, options: {
    traceId?: string
    parentSpanId?: string
    kind?: number
    attributes?: Array<{ key: string; value: any }>
  } = {}): string {
    const spanId = crypto.randomUUID().replace(/-/g, '').slice(0, 16)
    const traceId = options.traceId || crypto.randomUUID().replace(/-/g, '')
    const startTime = BigInt(Date.now()) * BigInt(1_000_000)

    const span: OtlpSpan = {
      traceId,
      spanId,
      parentSpanId: options.parentSpanId,
      name,
      kind: options.kind ?? SpanKind.INTERNAL,
      startTimeUnixNano: startTime.toString(),
      endTimeUnixNano: '0',
      attributes: options.attributes || []
    }

    this.spans.set(spanId, { span, startTime })
    return spanId
  }

  async endSpan(spanId: string, status?: { code: number; message?: string }): Promise<void> {
    const record = this.spans.get(spanId)
    if (!record) return

    const endTime = BigInt(Date.now()) * BigInt(1_000_000)
    record.span.endTimeUnixNano = endTime.toString()

    if (status) {
      record.span.status = status
    }

    // Transform and send
    const event = transformOtelSpan(record.span, resource)
    await this.sendEvent(event)

    this.spans.delete(spanId)
  }

  private async sendEvent(event: any): Promise<void> {
    try {
      await fetch(STREAM_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event)
      })
    } catch (error) {
      console.error('Failed to send span:', error)
    }
  }
}

export const tracer = new Tracer()

// Usage in HTTP handler
export async function handleRequest(request: Request): Promise<Response> {
  const spanId = tracer.startSpan('HTTP ' + request.method + ' ' + new URL(request.url).pathname, {
    kind: SpanKind.SERVER,
    attributes: [
      { key: 'http.method', value: { stringValue: request.method } },
      { key: 'http.url', value: { stringValue: request.url } }
    ]
  })

  try {
    const response = await processRequest(request)

    await tracer.endSpan(spanId, { code: 1 }) // OK
    return response
  } catch (error) {
    await tracer.endSpan(spanId, {
      code: 2, // ERROR
      message: error instanceof Error ? error.message : 'Unknown error'
    })
    throw error
  }
}
```

### CDC Integration

Capturing database changes for real-time synchronization.

```typescript
// cdc-integration.ts
import { transformCdcEvent, type CdcEvent } from 'dotdo/db/streams/transformers'

const STREAM_URL = 'https://stream.example.com/broadcast'
const NAMESPACE = 'https://api.example.com/tenant-1'

// CDC event handler (called by your database replication system)
async function handleDatabaseChange(change: {
  operation: 'INSERT' | 'UPDATE' | 'DELETE'
  table: string
  schema?: string
  primaryKey: string | Record<string, unknown>
  oldData?: Record<string, unknown>
  newData?: Record<string, unknown>
  transactionId?: string
  lsn?: number
  timestamp: Date
}): Promise<void> {
  const cdcEvent: CdcEvent = {
    operation: change.operation,
    table: change.table,
    schema: change.schema,
    primaryKey: change.primaryKey,
    before: change.oldData,
    after: change.newData,
    transactionId: change.transactionId,
    lsn: change.lsn,
    timestamp: change.timestamp,
    dbSystem: 'postgres'
  }

  const event = transformCdcEvent(cdcEvent, NAMESPACE)

  await fetch(STREAM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event)
  })
}

// Example: Listen for PostgreSQL logical replication changes
async function setupCdcListener(connectionString: string): Promise<void> {
  // This is a conceptual example - actual implementation depends on your
  // replication setup (pg_logical, Debezium, etc.)

  const replicationSlot = await createReplicationSlot(connectionString)

  for await (const change of replicationSlot.changes()) {
    await handleDatabaseChange({
      operation: change.action.toUpperCase() as 'INSERT' | 'UPDATE' | 'DELETE',
      table: change.table,
      schema: change.schema,
      primaryKey: change.pk,
      oldData: change.old,
      newData: change.new,
      transactionId: change.xid?.toString(),
      lsn: change.lsn,
      timestamp: new Date()
    })
  }
}
```

---

## Next Steps

- **[Event Schema Reference](/docs/unified-events/schema)**: Complete 165-column schema documentation
- **[Transformer Reference](/docs/unified-events/transformers)**: All available event transformers
- **[Query Guide](/docs/unified-events/querying)**: Advanced query patterns and optimization
- **[EventStreamDO Reference](/docs/streaming/event-stream-do)**: Real-time streaming configuration
- **[Observability Guide](/docs/observability)**: Integration with Prometheus, Grafana, and Datadog
