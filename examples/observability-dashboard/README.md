# Observability Dashboard Example

A real-time observability dashboard demonstrating unified events with EventStreamDO.

## Features

- **Real-time Event Streaming**: WebSocket connection to EventStreamDO for live event updates
- **Unified Event Schema**: 165-column event schema supporting traces, logs, metrics, CDC, and more
- **Trace Explorer**: Distributed tracing with waterfall visualization
- **Log Viewer**: Structured log aggregation with filtering
- **TanStack Start Frontend**: Modern React SSR with file-based routing

## Architecture

```
Frontend (TanStack Start)
    |
    v
Worker (Cloudflare)
    |
    v
EventStreamDO (Durable Object)
    |
    +-- WebSocket connections (real-time events)
    +-- PGLite hot tier (5 min retention)
    +-- Topic-based pub/sub
```

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Deploy to Cloudflare
wrangler deploy
```

## API Endpoints

### WebSocket - Event Stream

```javascript
// Connect to event stream
const ws = new WebSocket('wss://your-worker.workers.dev/api/events?topic=*')

ws.onmessage = (event) => {
  const data = JSON.parse(event.data)
  console.log('Event:', data)
}
```

Topic patterns:
- `*` - All events
- `trace` - Trace events only
- `log` - Log events only
- `orders.*` - All order-related events

### POST /api/broadcast - Send Event

```javascript
// Send a trace event
await fetch('/api/broadcast', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    id: crypto.randomUUID(),
    event_type: 'trace',
    event_name: 'http.request',
    ns: 'https://api.example.com',
    trace_id: '0af7651916cd43dd8448eb211c80319c',
    span_id: '00f067aa0ba902b7',
    service_name: 'api-gateway',
    http_method: 'GET',
    http_url: '/api/users',
    http_status: 200,
    duration_ms: 42,
    outcome: 'success',
    timestamp: new Date().toISOString()
  })
})

// Send a log event
await fetch('/api/broadcast', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    id: crypto.randomUUID(),
    event_type: 'log',
    event_name: 'app.log',
    ns: 'https://api.example.com',
    log_level: 'info',
    log_message: 'User logged in successfully',
    log_logger: 'auth.service',
    service_name: 'auth-service',
    actor_id: 'user_123',
    timestamp: new Date().toISOString()
  })
})
```

### GET /api/stats - Stream Statistics

```javascript
const res = await fetch('/api/stats')
const stats = await res.json()
// {
//   activeConnections: 42,
//   messagesSent: 12345,
//   messagesPerSecond: 25.5,
//   topicStats: { 'trace': { subscribers: 10 }, ... }
// }
```

### POST /api/query/unified - Query Events

```javascript
const res = await fetch('/api/query/unified', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    event_type: 'trace',
    service_name: 'api-gateway',
    limit: 100
  })
})
const { rows } = await res.json()
```

### GET /api/query/trace - Get Trace

```javascript
const res = await fetch('/api/query/trace?trace_id=0af7651916cd43dd8448eb211c80319c')
const { rows } = await res.json()
// All spans in the trace
```

## Unified Event Schema

The unified event schema supports multiple event types:

| Event Type | Description | Key Fields |
|------------|-------------|------------|
| `trace` | Distributed tracing spans | trace_id, span_id, parent_id, duration_ms |
| `log` | Structured log entries | log_level, log_message, log_logger |
| `metric` | OTEL metrics | metric_name, metric_value, metric_type |
| `cdc` | Database change events | db_operation, db_table, db_before, db_after |
| `track` | User action tracking | actor_id, properties |
| `page` | Page view events | http_url, page_title |
| `vital` | Web Vitals | vital_name, vital_value, vital_rating |

See `types/unified-event.ts` for the complete 165-column schema.

## Components

### EventStream

Real-time event streaming component with WebSocket connection management.

```tsx
import { EventStream } from './components/EventStream'

<EventStream
  topics={['trace', 'log']}
  onEvent={(event) => console.log(event)}
  maxEvents={100}
/>
```

### TraceWaterfall

Distributed trace visualization with span hierarchy.

```tsx
import { TraceWaterfall } from './components/TraceWaterfall'

<TraceWaterfall
  spans={spans}
  totalDuration={150}
/>
```

## Development

### Testing Events

Use curl to send test events:

```bash
# Send a trace event
curl -X POST http://localhost:8787/api/broadcast \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "test-1",
    "event_type": "trace",
    "event_name": "http.request",
    "ns": "test",
    "service_name": "test-service",
    "duration_ms": 100,
    "outcome": "success",
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"
  }'

# Send a log event
curl -X POST http://localhost:8787/api/broadcast \
  -H 'Content-Type: application/json' \
  -d '{
    "id": "log-1",
    "event_type": "log",
    "event_name": "app.log",
    "ns": "test",
    "log_level": "info",
    "log_message": "Test log message",
    "service_name": "test-service",
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'"
  }'
```

### WebSocket Testing

```javascript
// Browser console
const ws = new WebSocket('ws://localhost:8787/api/events?topic=*')
ws.onopen = () => console.log('Connected')
ws.onmessage = (e) => console.log('Event:', JSON.parse(e.data))
```

## Related

- [EventStreamDO](../../streaming/event-stream-do.ts) - The Durable Object powering event streaming
- [UnifiedEvent Types](../../types/unified-event.ts) - The 165-column unified event schema
- [dotdo](../../) - The runtime framework
