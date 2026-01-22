# dotdo Operator Dashboard

A monitoring dashboard for dotdo Durable Objects providing real-time visibility into DO health, events, and metrics.

## Features

- **Active DO Monitoring**: Track registered Durable Objects and their health status
- **Event Tracking**: View recent events with status (completed/failed/pending)
- **Health Metrics**: Monitor request rates, error rates, and response times
- **Time-Series Charts**: Visualize request patterns over time
- **DO State Inspection**: Deep dive into individual DO details and history
- **Auto-Refresh**: Dashboard updates every 5 seconds

## Quick Start

```bash
cd apps/dashboard
npm install
npm run dev
```

Visit `http://localhost:8787` to access the dashboard.

## Architecture

```
Worker (stateless)              DashboardDO (stateful)
    |                               |
    +-> Serves UI (HTML/CSS)        +-> SQLite storage
    +-> API routes (/api/*)  --->   +-> DO registrations
    +-> CORS handling               +-> Events log
                                    +-> Metrics aggregation
```

## API Endpoints

### Health Check

```
GET /api/health
```

Returns overall system health including active DOs, error rates, and event counts.

### DO Management

```
POST /api/dos                    # Register a DO
GET /api/dos                     # List all DOs
GET /api/dos/:id                 # Get DO details
POST /api/dos/:id/heartbeat      # Update DO heartbeat
```

### Events

```
POST /api/events                 # Record an event
GET /api/events                  # List events (with filters)
GET /api/events?status=failed    # Filter by status
GET /api/events?doId=xxx         # Filter by DO
```

### Metrics

```
POST /api/metrics                # Record metrics
GET /api/metrics                 # Get aggregated metrics
GET /api/metrics?doId=xxx        # Get metrics for specific DO
GET /api/metrics/timeseries      # Get time-series data
```

### Inspection

```
GET /api/inspect/:doId           # Full DO inspection (registration, metrics, events)
```

### SDK Integration

```
POST /api/report                 # Combined registration + metrics + event
```

## Integrating with Your DOs

### Basic Registration

Register your DO with the dashboard on first request:

```typescript
export class MyDO implements DurableObject {
  private registered = false

  async fetch(request: Request): Promise<Response> {
    if (!this.registered) {
      await this.registerWithDashboard()
      this.registered = true
    }
    // ... handle request
  }

  private async registerWithDashboard() {
    await fetch('https://your-dashboard.workers.dev/api/dos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: this.state.id.toString(),
        name: 'my-do-instance',
        className: 'MyDO',
        namespace: 'MY_DO',
        metadata: { version: '1.0.0' }
      })
    })
  }
}
```

### Recording Events

Track important events in your DO:

```typescript
async processOrder(orderId: string) {
  const start = Date.now()

  try {
    const result = await this.doProcessOrder(orderId)

    // Record success
    await fetch('https://your-dashboard.workers.dev/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        doId: this.state.id.toString(),
        doName: 'order-processor',
        type: 'order.processed',
        status: 'completed',
        duration: Date.now() - start,
        payload: { orderId }
      })
    })

    return result
  } catch (error) {
    // Record failure
    await fetch('https://your-dashboard.workers.dev/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        doId: this.state.id.toString(),
        doName: 'order-processor',
        type: 'order.failed',
        status: 'failed',
        duration: Date.now() - start,
        error: error.message
      })
    })

    throw error
  }
}
```

### Recording Metrics

Track request/error counts and response times:

```typescript
async fetch(request: Request): Promise<Response> {
  const start = Date.now()
  let hasError = false

  try {
    const response = await this.handleRequest(request)
    return response
  } catch (error) {
    hasError = true
    throw error
  } finally {
    // Record metrics
    await fetch('https://your-dashboard.workers.dev/api/metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        doId: this.state.id.toString(),
        requestCount: 1,
        errorCount: hasError ? 1 : 0,
        responseTime: Date.now() - start
      })
    })
  }
}
```

### Combined Reporting (Recommended)

Use the `/api/report` endpoint for efficient single-request reporting:

```typescript
await fetch('https://your-dashboard.workers.dev/api/report', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    do: {
      id: this.state.id.toString(),
      name: 'my-do',
      className: 'MyDO',
      namespace: 'MY_DO'
    },
    metrics: {
      requestCount: 1,
      responseTime: 45
    },
    event: {
      type: 'request.handled',
      status: 'completed',
      duration: 45
    }
  })
})
```

## UI Features

### Dashboard View

- **Metrics Cards**: Quick overview of active DOs, requests, error rate, and recent events
- **Request Chart**: Visual representation of request volume over the last hour
- **DO Table**: List of all registered DOs with status indicators
- **Events Table**: Recent events with filtering capabilities

### DO Inspection Panel

Click on any DO row to open the inspection panel showing:

- Registration details (ID, class, namespace, timestamps)
- Aggregated metrics (requests, errors, response time)
- Recent events specific to that DO
- Custom metadata

## Deployment

```bash
npm run deploy
```

For production, consider:

1. Adding authentication (see `auth-api` example)
2. Configuring CORS for your domains
3. Setting up alerting based on error rates

## Configuration

The dashboard uses a single `DashboardDO` instance with SQLite storage. Tables are automatically created on first use:

- `do_registrations`: DO metadata and status
- `do_events`: Event log with timestamps
- `do_metrics`: Aggregated per-DO metrics
- `metrics_buckets`: 5-minute time-series buckets

Old data is automatically cleaned up:
- Events: Last 1000 entries retained
- Time-series: Last 24 hours retained

## Development

```bash
# Start dev server
npm run dev

# Run tests
npm test
```
