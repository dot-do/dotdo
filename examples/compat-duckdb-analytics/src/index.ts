/**
 * compat-duckdb-analytics Worker Entry Point
 *
 * OLAP on the edge. Milliseconds, not minutes.
 *
 * Routes requests to the AnalyticsDO Durable Object for real-time
 * analytics queries. Each tenant gets an isolated DuckDB instance.
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'

// Re-export the DO classes for Cloudflare to instantiate
export { AnalyticsDO } from './AnalyticsDO'
export { EventsDO } from './objects/EventsDO'

// Define environment bindings
interface Env {
  ANALYTICS_DO: DurableObjectNamespace
  EVENTS_DO: DurableObjectNamespace
  DATA_BUCKET: R2Bucket
}

const app = new Hono<{ Bindings: Env }>()

// Enable CORS for dashboard access
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// ═══════════════════════════════════════════════════════════════════════════
// LANDING PAGE
// ═══════════════════════════════════════════════════════════════════════════

app.get('/', (c) => {
  return c.html(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DuckDB Analytics - OLAP on the Edge</title>
  <style>
    :root { --bg: #0a0a0a; --fg: #fafafa; --accent: #f59e0b; --muted: #71717a; --code-bg: #1f1f1f; }
    body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--fg); margin: 0; padding: 2rem; line-height: 1.6; max-width: 900px; margin: 0 auto; }
    h1 { color: var(--accent); margin-bottom: 0.25rem; font-size: 2.5rem; }
    .tagline { font-size: 1.5rem; color: var(--fg); margin-bottom: 0.5rem; font-weight: 600; }
    .subtitle { color: var(--muted); margin-bottom: 2rem; font-size: 1.1rem; }
    .highlight { background: linear-gradient(90deg, var(--accent), #ef4444); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-weight: 700; }
    code { background: var(--code-bg); padding: 0.2rem 0.4rem; border-radius: 4px; font-size: 0.9rem; }
    pre { background: var(--code-bg); padding: 1.5rem; border-radius: 8px; overflow-x: auto; margin: 1.5rem 0; }
    pre code { padding: 0; background: none; }
    .endpoints { display: grid; gap: 1rem; margin: 2rem 0; }
    .endpoint { background: var(--code-bg); padding: 1rem; border-radius: 8px; border-left: 3px solid var(--accent); }
    .endpoint h3 { margin: 0 0 0.5rem 0; color: var(--accent); }
    .endpoint p { margin: 0; color: var(--muted); }
    a { color: var(--accent); }
    .try-it { display: inline-block; margin-top: 0.5rem; padding: 0.25rem 0.5rem; background: var(--accent); color: #000; text-decoration: none; border-radius: 4px; font-size: 0.875rem; font-weight: 600; }
    .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin: 2rem 0; }
    .stat { background: var(--code-bg); padding: 1.5rem; border-radius: 8px; text-align: center; }
    .stat-value { font-size: 2rem; font-weight: 700; color: var(--accent); }
    .stat-label { color: var(--muted); font-size: 0.9rem; }
    section { margin: 3rem 0; }
    h2 { color: var(--fg); border-bottom: 1px solid #333; padding-bottom: 0.5rem; }
    footer { margin-top: 3rem; color: var(--muted); border-top: 1px solid #333; padding-top: 1rem; }
  </style>
</head>
<body>
  <h1>duckdb.do/analytics</h1>
  <p class="tagline">OLAP on the edge. <span class="highlight">Milliseconds, not minutes.</span></p>
  <p class="subtitle">Real-time analytics powered by DuckDB on Cloudflare Workers. No data warehouse required.</p>

  <div class="stats">
    <div class="stat">
      <div class="stat-value">10M</div>
      <div class="stat-label">rows processed</div>
    </div>
    <div class="stat">
      <div class="stat-value">50ms</div>
      <div class="stat-label">query time</div>
    </div>
    <div class="stat">
      <div class="stat-value">V8</div>
      <div class="stat-label">isolate runtime</div>
    </div>
  </div>

  <section>
    <h2>Hero Example</h2>
    <pre><code>import { DuckDB } from '@dotdo/duckdb'

export class AnalyticsDO extends DO {
  private db = new DuckDB(this.ctx)

  async getDailyActiveUsers(days: number) {
    return this.db.query(\`
      SELECT DATE_TRUNC('day', timestamp) as day,
             COUNT(DISTINCT user_id) as dau
      FROM events
      WHERE timestamp > NOW() - INTERVAL '\${days} days'
      GROUP BY 1 ORDER BY 1
    \`)
  }

  async getFunnelConversion(steps: string[]) {
    // Window functions for funnel analysis
    return this.db.query(\`
      WITH funnel AS (
        SELECT user_id,
               MAX(CASE WHEN event = '\${steps[0]}' THEN 1 END) as step_1,
               MAX(CASE WHEN event = '\${steps[1]}' THEN 1 END) as step_2
        FROM events GROUP BY user_id
      )
      SELECT COUNT(*) FILTER (WHERE step_1 = 1) as started,
             COUNT(*) FILTER (WHERE step_2 = 1) as converted
      FROM funnel
    \`)
  }
}</code></pre>
  </section>

  <section>
    <h2>API Endpoints</h2>
    <div class="endpoints">
      <div class="endpoint">
        <h3>GET /api/dau</h3>
        <p>Daily Active Users for the last 30 days</p>
        <a href="/api/dau" class="try-it">Try it</a>
      </div>

      <div class="endpoint">
        <h3>GET /api/mau</h3>
        <p>Monthly Active Users for the last 12 months</p>
        <a href="/api/mau" class="try-it">Try it</a>
      </div>

      <div class="endpoint">
        <h3>GET /api/dashboard</h3>
        <p>Real-time dashboard metrics</p>
        <a href="/api/dashboard" class="try-it">Try it</a>
      </div>

      <div class="endpoint">
        <h3>POST /api/funnel</h3>
        <p>Funnel analysis with conversion rates</p>
      </div>

      <div class="endpoint">
        <h3>POST /api/cohort</h3>
        <p>Cohort retention analysis</p>
      </div>

      <div class="endpoint">
        <h3>GET /api/logs/search?q=error</h3>
        <p>Full-text log search</p>
        <a href="/api/logs/search?q=error" class="try-it">Try it</a>
      </div>

      <div class="endpoint">
        <h3>GET /api/errors</h3>
        <p>Error rates by service</p>
        <a href="/api/errors" class="try-it">Try it</a>
      </div>

      <div class="endpoint">
        <h3>POST /api/events</h3>
        <p>Ingest events (batch supported)</p>
      </div>

      <div class="endpoint">
        <h3>POST /api/query</h3>
        <p>Execute arbitrary SQL</p>
      </div>
    </div>

    <h3 style="margin-top: 2rem; color: var(--accent);">High-Throughput Streaming</h3>
    <div class="endpoints">
      <div class="endpoint">
        <h3>POST /api/stream/events</h3>
        <p>Buffered event ingestion with auto-aggregation</p>
      </div>

      <div class="endpoint">
        <h3>POST /api/stream/flush</h3>
        <p>Force flush event buffer</p>
      </div>

      <div class="endpoint">
        <h3>GET /api/stream/stats</h3>
        <p>Ingestion statistics (buffer size, total counts)</p>
        <a href="/api/stream/stats" class="try-it">Try it</a>
      </div>

      <div class="endpoint">
        <h3>GET /api/stream/hourly</h3>
        <p>Pre-aggregated hourly counts</p>
        <a href="/api/stream/hourly" class="try-it">Try it</a>
      </div>

      <div class="endpoint">
        <h3>GET /api/stream/daily</h3>
        <p>Pre-aggregated daily counts</p>
        <a href="/api/stream/daily" class="try-it">Try it</a>
      </div>

      <div class="endpoint">
        <h3>GET /api/stream/types</h3>
        <p>Event type distribution</p>
        <a href="/api/stream/types" class="try-it">Try it</a>
      </div>
    </div>
  </section>

  <section>
    <h2>Features</h2>
    <ul>
      <li><strong>Time-series aggregations:</strong> DAU, MAU, custom intervals</li>
      <li><strong>Funnel analysis:</strong> Conversion rates with window functions</li>
      <li><strong>Cohort analysis:</strong> User retention by signup cohort</li>
      <li><strong>Log analysis:</strong> Full-text search, error rates</li>
      <li><strong>Real-time dashboards:</strong> Sub-second metrics</li>
      <li><strong>Iceberg/Parquet:</strong> Query historical data from R2</li>
    </ul>
  </section>

  <section>
    <h2>Quick Start</h2>
    <pre><code>npm install
npm run dev

# Ingest events
curl -X POST http://localhost:8787/api/events \\
  -H "Content-Type: application/json" \\
  -d '[{"id":"1","timestamp":"2024-01-01T00:00:00Z","user_id":"alice","event_type":"signup"}]'

# Query DAU
curl http://localhost:8787/api/dau</code></pre>
  </section>

  <footer>
    <p>Powered by <a href="https://dotdo.dev">dotdo</a> + <a href="https://duckdb.org">DuckDB</a></p>
  </footer>
</body>
</html>
  `)
})

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Get DO stub
// ═══════════════════════════════════════════════════════════════════════════

function getDO(c: { env: Env }, tenantId?: string): DurableObjectStub {
  const id = tenantId
    ? c.env.ANALYTICS_DO.idFromName(tenantId)
    : c.env.ANALYTICS_DO.idFromName('default')
  return c.env.ANALYTICS_DO.get(id)
}

function getEventsDO(c: { env: Env }, tenantId?: string): DurableObjectStub {
  const id = tenantId
    ? c.env.EVENTS_DO.idFromName(tenantId)
    : c.env.EVENTS_DO.idFromName('default')
  return c.env.EVENTS_DO.get(id)
}

// Proxy RPC call to DO
async function callDO(stub: DurableObjectStub, method: string, args: unknown[] = []): Promise<Response> {
  const response = await stub.fetch('https://analytics.do/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method,
      params: args,
    }),
  })

  const result = await response.json() as { result?: unknown; error?: { message: string } }

  if (result.error) {
    return Response.json({ error: result.error.message }, { status: 400 })
  }

  return Response.json(result.result)
}

// ═══════════════════════════════════════════════════════════════════════════
// TIME-SERIES ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

app.get('/api/dau', async (c) => {
  const days = Number(c.req.query('days')) || 30
  const stub = getDO(c, c.req.query('tenant'))
  return callDO(stub, 'getDailyActiveUsers', [days])
})

app.get('/api/mau', async (c) => {
  const months = Number(c.req.query('months')) || 12
  const stub = getDO(c, c.req.query('tenant'))
  return callDO(stub, 'getMonthlyActiveUsers', [months])
})

app.get('/api/timeseries/:eventType', async (c) => {
  const eventType = c.req.param('eventType')
  const interval = (c.req.query('interval') as 'hour' | 'day' | 'week' | 'month') || 'day'
  const lookback = c.req.query('lookback') || '7 days'
  const stub = getDO(c, c.req.query('tenant'))
  return callDO(stub, 'getTimeseries', [eventType, interval, lookback])
})

// ═══════════════════════════════════════════════════════════════════════════
// FUNNEL & COHORT ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

app.post('/api/funnel', async (c) => {
  const body = await c.req.json() as { steps: string[]; timeWindow?: string }
  const stub = getDO(c, c.req.query('tenant'))
  return callDO(stub, 'getFunnelConversion', [body.steps, body.timeWindow])
})

app.post('/api/cohort', async (c) => {
  const body = await c.req.json() as { cohortType?: string; periods?: number }
  const stub = getDO(c, c.req.query('tenant'))
  return callDO(stub, 'getCohortRetention', [body.cohortType, body.periods])
})

// ═══════════════════════════════════════════════════════════════════════════
// LOG ANALYSIS ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

app.get('/api/logs/search', async (c) => {
  const query = c.req.query('q') || ''
  const options = {
    level: c.req.query('level'),
    service: c.req.query('service'),
    limit: c.req.query('limit') ? Number(c.req.query('limit')) : undefined,
    since: c.req.query('since'),
  }
  const stub = getDO(c, c.req.query('tenant'))
  return callDO(stub, 'searchLogs', [query, options])
})

app.get('/api/errors', async (c) => {
  const lookback = c.req.query('lookback') || '1 hour'
  const stub = getDO(c, c.req.query('tenant'))
  return callDO(stub, 'getErrorRates', [lookback])
})

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD ENDPOINT
// ═══════════════════════════════════════════════════════════════════════════

app.get('/api/dashboard', async (c) => {
  const stub = getDO(c, c.req.query('tenant'))
  return callDO(stub, 'getDashboardMetrics')
})

// ═══════════════════════════════════════════════════════════════════════════
// INGESTION ENDPOINTS (AnalyticsDO - direct to DuckDB)
// ═══════════════════════════════════════════════════════════════════════════

app.post('/api/events', async (c) => {
  const body = await c.req.json()
  const stub = getDO(c, c.req.query('tenant'))

  // Support single event or batch
  if (Array.isArray(body)) {
    return callDO(stub, 'ingestEvents', [body])
  }
  return callDO(stub, 'ingestEvent', [body])
})

app.post('/api/logs', async (c) => {
  const body = await c.req.json()
  const stub = getDO(c, c.req.query('tenant'))

  // Support single log or batch
  const logs = Array.isArray(body) ? body : [body]
  return callDO(stub, 'ingestLogs', [logs])
})

// ═══════════════════════════════════════════════════════════════════════════
// HIGH-THROUGHPUT INGESTION (EventsDO - buffered writes with materialized views)
// ═══════════════════════════════════════════════════════════════════════════

// Buffered event ingestion for high-throughput scenarios
// Events are batched and flushed periodically with automatic aggregation
app.post('/api/stream/events', async (c) => {
  const body = await c.req.json()
  const stub = getEventsDO(c, c.req.query('tenant'))

  // Support single event or batch
  if (Array.isArray(body)) {
    return callDO(stub, 'ingestEvents', [body])
  }
  return callDO(stub, 'ingestEvent', [body])
})

// Force flush the event buffer
app.post('/api/stream/flush', async (c) => {
  const stub = getEventsDO(c, c.req.query('tenant'))
  return callDO(stub, 'flush')
})

// Get ingestion statistics
app.get('/api/stream/stats', async (c) => {
  const stub = getEventsDO(c, c.req.query('tenant'))
  return callDO(stub, 'getStats')
})

// Get materialized views info
app.get('/api/stream/views', async (c) => {
  const stub = getEventsDO(c, c.req.query('tenant'))
  return callDO(stub, 'getMaterializedViews')
})

// Query hourly event counts from materialized view
app.get('/api/stream/hourly', async (c) => {
  const startDate = c.req.query('start') || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const endDate = c.req.query('end') || new Date().toISOString()
  const stub = getEventsDO(c, c.req.query('tenant'))
  return callDO(stub, 'getHourlyCounts', [startDate, endDate])
})

// Query daily event counts from materialized view
app.get('/api/stream/daily', async (c) => {
  const startDate = c.req.query('start') || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const endDate = c.req.query('end') || new Date().toISOString()
  const stub = getEventsDO(c, c.req.query('tenant'))
  return callDO(stub, 'getDailyCounts', [startDate, endDate])
})

// Get event type distribution
app.get('/api/stream/types', async (c) => {
  const stub = getEventsDO(c, c.req.query('tenant'))
  return callDO(stub, 'getEventTypeCounts')
})

// ═══════════════════════════════════════════════════════════════════════════
// RAW QUERY ENDPOINT
// ═══════════════════════════════════════════════════════════════════════════

app.post('/api/query', async (c) => {
  const body = await c.req.json() as { sql: string; params?: unknown[] }
  const stub = getDO(c, c.req.query('tenant'))
  return callDO(stub, 'query', [body.sql, body.params])
})

// ═══════════════════════════════════════════════════════════════════════════
// PARQUET ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

app.post('/api/parquet/load', async (c) => {
  const body = await c.req.json() as { key: string; name?: string }
  const stub = getDO(c, c.req.query('tenant'))
  return callDO(stub, 'loadParquetFromR2', [body.key, body.name])
})

app.post('/api/parquet/query', async (c) => {
  const body = await c.req.json() as { sql: string }
  const stub = getDO(c, c.req.query('tenant'))
  return callDO(stub, 'queryParquet', [body.sql])
})

app.post('/api/parquet/aggregate', async (c) => {
  const body = await c.req.json() as {
    file: string
    aggregation: 'sum' | 'count' | 'avg'
    column: string
    groupBy: string
    filters?: Record<string, unknown>
  }
  const stub = getDO(c, c.req.query('tenant'))
  return callDO(stub, 'aggregateHistoricalData', [
    body.file,
    body.aggregation,
    body.column,
    body.groupBy,
    body.filters,
  ])
})

// ═══════════════════════════════════════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════════════════════════════════════

app.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'compat-duckdb-analytics' })
})

// Forward RPC directly
app.all('/rpc', async (c) => {
  const stub = getDO(c, c.req.query('tenant'))
  return stub.fetch(c.req.raw)
})

export default app
