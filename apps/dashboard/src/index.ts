/**
 * Operator Dashboard for dotdo
 *
 * A monitoring dashboard for Durable Objects that provides:
 * - Active DO registration and health status
 * - Request/error rate metrics with time-series
 * - Recent events with status tracking
 * - DO state inspection
 *
 * Architecture:
 * - Worker handles HTTP routes and serves UI
 * - DashboardDO stores all metrics and state in SQLite
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { renderDashboardHTML } from './ui'

// Re-export the Durable Object class
export { DashboardDO } from './DashboardDO'

// Types
interface Env {
  DASHBOARD_DO: DurableObjectNamespace
}

// Main worker
const app = new Hono<{ Bindings: Env }>()

// Middleware
app.use('/*', cors())

// Get the DashboardDO stub (singleton)
function getDashboardDO(env: Env) {
  // Use a single DO instance for all dashboard data
  const id = env.DASHBOARD_DO.idFromName('global')
  return env.DASHBOARD_DO.get(id)
}

// === UI Routes ===

// Serve the dashboard UI
app.get('/', (c) => {
  return c.html(renderDashboardHTML())
})

// === API Routes ===

// Health check endpoint
app.get('/api/health', async (c) => {
  const stub = getDashboardDO(c.env)
  const response = await stub.fetch(new Request('http://internal/health'))
  return response
})

// === DO Management Routes ===

// Register a DO
app.post('/api/dos', async (c) => {
  const stub = getDashboardDO(c.env)
  const body = await c.req.json()

  const response = await stub.fetch(
    new Request('http://internal/dos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )

  return response
})

// List registered DOs
app.get('/api/dos', async (c) => {
  const stub = getDashboardDO(c.env)
  const url = new URL(c.req.url)
  const response = await stub.fetch(new Request('http://internal/dos' + url.search))
  return response
})

// Get single DO details
app.get('/api/dos/:id', async (c) => {
  const stub = getDashboardDO(c.env)
  const id = c.req.param('id')
  const response = await stub.fetch(new Request(`http://internal/dos/${id}`))
  return response
})

// Heartbeat endpoint for DOs
app.post('/api/dos/:id/heartbeat', async (c) => {
  const stub = getDashboardDO(c.env)
  const id = c.req.param('id')

  const response = await stub.fetch(
    new Request(`http://internal/dos/${id}/heartbeat`, {
      method: 'POST',
    })
  )

  return response
})

// === Events Routes ===

// Record an event
app.post('/api/events', async (c) => {
  const stub = getDashboardDO(c.env)
  const body = await c.req.json()

  const response = await stub.fetch(
    new Request('http://internal/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )

  return response
})

// List events
app.get('/api/events', async (c) => {
  const stub = getDashboardDO(c.env)
  const url = new URL(c.req.url)
  const response = await stub.fetch(new Request('http://internal/events' + url.search))
  return response
})

// === Metrics Routes ===

// Record metrics
app.post('/api/metrics', async (c) => {
  const stub = getDashboardDO(c.env)
  const body = await c.req.json()

  const response = await stub.fetch(
    new Request('http://internal/metrics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )

  return response
})

// Get aggregated metrics
app.get('/api/metrics', async (c) => {
  const stub = getDashboardDO(c.env)
  const url = new URL(c.req.url)
  const response = await stub.fetch(new Request('http://internal/metrics' + url.search))
  return response
})

// Get time-series metrics
app.get('/api/metrics/timeseries', async (c) => {
  const stub = getDashboardDO(c.env)
  const url = new URL(c.req.url)
  const response = await stub.fetch(new Request('http://internal/metrics/timeseries' + url.search))
  return response
})

// === Inspection Routes ===

// Inspect a specific DO
app.get('/api/inspect/:doId', async (c) => {
  const stub = getDashboardDO(c.env)
  const doId = c.req.param('doId')
  const response = await stub.fetch(new Request(`http://internal/inspect/${doId}`))
  return response
})

// === SDK Helper Endpoint ===

// Combined registration + heartbeat + metrics endpoint for easy SDK integration
app.post('/api/report', async (c) => {
  const stub = getDashboardDO(c.env)
  const body = await c.req.json<{
    do: {
      id: string
      name: string
      className: string
      namespace: string
      metadata?: Record<string, unknown>
    }
    metrics?: {
      requestCount?: number
      errorCount?: number
      responseTime?: number
    }
    event?: {
      type: string
      payload?: unknown
      status?: 'pending' | 'completed' | 'failed'
      duration?: number
      error?: string
    }
  }>()

  // Register/update DO
  await stub.fetch(
    new Request('http://internal/dos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body.do),
    })
  )

  // Record metrics if provided
  if (body.metrics) {
    await stub.fetch(
      new Request('http://internal/metrics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doId: body.do.id,
          ...body.metrics,
        }),
      })
    )
  }

  // Record event if provided
  if (body.event) {
    await stub.fetch(
      new Request('http://internal/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doId: body.do.id,
          doName: body.do.name,
          ...body.event,
        }),
      })
    )
  }

  return c.json({ success: true })
})

export default app
