/**
 * Dashboard Durable Object
 *
 * Tracks metrics and state for the operator dashboard:
 * - Active DO registrations and health status
 * - Request/error rate metrics
 * - Recent events with status
 * - DO state inspection
 */

import { Hono } from 'hono'
import { cors } from 'hono/cors'

// Types for DO registration and metrics
export interface DORegistration {
  id: string
  name: string
  className: string
  namespace: string
  registeredAt: number
  lastSeen: number
  status: 'active' | 'inactive' | 'unknown'
  metadata?: Record<string, unknown>
}

export interface DOEvent {
  id: string
  doId: string
  doName: string
  type: string
  payload?: unknown
  status: 'pending' | 'completed' | 'failed'
  timestamp: number
  duration?: number
  error?: string
}

export interface DOMetrics {
  doId: string
  requestCount: number
  errorCount: number
  avgResponseTime: number
  lastUpdated: number
}

export interface MetricsBucket {
  timestamp: number
  requests: number
  errors: number
  totalResponseTime: number
}

// SQL row types - all include index signature for SqlStorageValue compatibility
type SqlStorageValue = string | number | null | ArrayBuffer

interface DORegistrationRow {
  id: string
  name: string
  class_name: string
  namespace: string
  registered_at: number
  last_seen: number
  status: string
  metadata: string | null
  [key: string]: SqlStorageValue
}

interface DOEventRow {
  id: string
  do_id: string
  do_name: string
  type: string
  payload: string | null
  status: string
  timestamp: number
  duration: number | null
  error: string | null
  [key: string]: SqlStorageValue
}

interface MetricsRow {
  do_id: string
  request_count: number
  error_count: number
  avg_response_time: number
  last_updated: number
  [key: string]: SqlStorageValue
}

interface MetricsBucketRow {
  do_id: string
  bucket_timestamp: number
  requests: number
  errors: number
  total_response_time: number
  [key: string]: SqlStorageValue
}

interface CountRow {
  count: number
  [key: string]: SqlStorageValue
}

interface SumRow {
  total_requests: number
  total_errors: number
  [key: string]: SqlStorageValue
}

export class DashboardDO implements DurableObject {
  private app: Hono
  private state: DurableObjectState
  private sql: SqlStorage

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state
    this.sql = state.storage.sql
    this.app = new Hono()

    // Initialize schema
    this.initSchema()

    // Setup middleware
    this.app.use('/*', cors())

    // Setup routes
    this.setupRoutes()
  }

  private initSchema(): void {
    // DO registrations table
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS do_registrations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        class_name TEXT NOT NULL,
        namespace TEXT NOT NULL,
        registered_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'unknown',
        metadata TEXT
      )
    `)

    // Events table
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS do_events (
        id TEXT PRIMARY KEY,
        do_id TEXT NOT NULL,
        do_name TEXT NOT NULL,
        type TEXT NOT NULL,
        payload TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        timestamp INTEGER NOT NULL,
        duration INTEGER,
        error TEXT
      )
    `)

    // Create index on timestamp for recent queries
    this.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON do_events(timestamp DESC)
    `)

    // Metrics table (aggregated)
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS do_metrics (
        do_id TEXT PRIMARY KEY,
        request_count INTEGER NOT NULL DEFAULT 0,
        error_count INTEGER NOT NULL DEFAULT 0,
        avg_response_time REAL NOT NULL DEFAULT 0,
        last_updated INTEGER NOT NULL
      )
    `)

    // Time-series metrics buckets (5-minute intervals)
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS metrics_buckets (
        do_id TEXT NOT NULL,
        bucket_timestamp INTEGER NOT NULL,
        requests INTEGER NOT NULL DEFAULT 0,
        errors INTEGER NOT NULL DEFAULT 0,
        total_response_time INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (do_id, bucket_timestamp)
      )
    `)
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/', (c) =>
      c.json({
        status: 'ok',
        service: 'dashboard-do',
        id: this.state.id.toString(),
        timestamp: new Date().toISOString(),
      })
    )

    // === DO Registration endpoints ===

    // Register or update a DO
    this.app.post('/dos', async (c) => {
      const body = await c.req.json<{
        id: string
        name: string
        className: string
        namespace: string
        metadata?: Record<string, unknown>
      }>()

      const now = Date.now()

      // Upsert registration
      this.sql.exec(
        `INSERT INTO do_registrations (id, name, class_name, namespace, registered_at, last_seen, status, metadata)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           class_name = excluded.class_name,
           namespace = excluded.namespace,
           last_seen = excluded.last_seen,
           status = 'active',
           metadata = excluded.metadata`,
        body.id,
        body.name,
        body.className,
        body.namespace,
        now,
        now,
        body.metadata ? JSON.stringify(body.metadata) : null
      )

      return c.json({ success: true, id: body.id })
    })

    // List all registered DOs
    this.app.get('/dos', (c) => {
      const status = c.req.query('status')
      const className = c.req.query('className')
      const limit = parseInt(c.req.query('limit') || '100', 10)
      const offset = parseInt(c.req.query('offset') || '0', 10)

      let query = 'SELECT * FROM do_registrations WHERE 1=1'
      const params: (string | number)[] = []

      if (status) {
        query += ' AND status = ?'
        params.push(status)
      }

      if (className) {
        query += ' AND class_name = ?'
        params.push(className)
      }

      query += ' ORDER BY last_seen DESC LIMIT ? OFFSET ?'
      params.push(limit, offset)

      const cursor = this.sql.exec<DORegistrationRow>(query, ...params)
      const rows = [...cursor]

      const dos: DORegistration[] = rows.map((row) => ({
        id: row.id,
        name: row.name,
        className: row.class_name,
        namespace: row.namespace,
        registeredAt: row.registered_at,
        lastSeen: row.last_seen,
        status: row.status as DORegistration['status'],
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      }))

      // Get total count
      const countCursor = this.sql.exec<CountRow>(
        'SELECT COUNT(*) as count FROM do_registrations'
      )
      const countRows = [...countCursor]
      const total = countRows[0]?.count ?? 0

      return c.json({ dos, total })
    })

    // Get single DO details
    this.app.get('/dos/:id', (c) => {
      const id = c.req.param('id')

      const cursor = this.sql.exec<DORegistrationRow>(
        'SELECT * FROM do_registrations WHERE id = ?',
        id
      )
      const rows = [...cursor]

      if (rows.length === 0) {
        return c.json({ error: 'DO not found' }, 404)
      }

      const row = rows[0]
      if (!row) {
        return c.json({ error: 'DO not found' }, 404)
      }

      const registration: DORegistration = {
        id: row.id,
        name: row.name,
        className: row.class_name,
        namespace: row.namespace,
        registeredAt: row.registered_at,
        lastSeen: row.last_seen,
        status: row.status as DORegistration['status'],
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      }

      // Get metrics for this DO
      const metricsCursor = this.sql.exec<MetricsRow>(
        'SELECT * FROM do_metrics WHERE do_id = ?',
        id
      )
      const metricsRows = [...metricsCursor]
      const metricsRow = metricsRows[0]

      const metrics: DOMetrics | null = metricsRow
        ? {
            doId: metricsRow.do_id,
            requestCount: metricsRow.request_count,
            errorCount: metricsRow.error_count,
            avgResponseTime: metricsRow.avg_response_time,
            lastUpdated: metricsRow.last_updated,
          }
        : null

      // Get recent events for this DO
      const eventsCursor = this.sql.exec<DOEventRow>(
        'SELECT * FROM do_events WHERE do_id = ? ORDER BY timestamp DESC LIMIT 10',
        id
      )
      const eventRows = [...eventsCursor]

      const recentEvents: DOEvent[] = eventRows.map((e) => {
        const event: DOEvent = {
          id: e.id,
          doId: e.do_id,
          doName: e.do_name,
          type: e.type,
          payload: e.payload ? JSON.parse(e.payload) : undefined,
          status: e.status as DOEvent['status'],
          timestamp: e.timestamp,
        }
        if (e.duration != null) event.duration = e.duration
        if (e.error != null) event.error = e.error
        return event
      })

      return c.json({ registration, metrics, recentEvents })
    })

    // Update DO heartbeat
    this.app.post('/dos/:id/heartbeat', (c) => {
      const id = c.req.param('id')
      const now = Date.now()

      this.sql.exec(
        `UPDATE do_registrations SET last_seen = ?, status = 'active' WHERE id = ?`,
        now,
        id
      )

      return c.json({ success: true })
    })

    // === Events endpoints ===

    // Record an event
    this.app.post('/events', async (c) => {
      const body = await c.req.json<{
        doId: string
        doName: string
        type: string
        payload?: unknown
        status?: DOEvent['status']
        duration?: number
        error?: string
      }>()

      const id = crypto.randomUUID()
      const now = Date.now()

      this.sql.exec(
        `INSERT INTO do_events (id, do_id, do_name, type, payload, status, timestamp, duration, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        body.doId,
        body.doName,
        body.type,
        body.payload ? JSON.stringify(body.payload) : null,
        body.status || 'completed',
        now,
        body.duration ?? null,
        body.error ?? null
      )

      // Clean up old events (keep last 1000)
      this.sql.exec(`
        DELETE FROM do_events WHERE id NOT IN (
          SELECT id FROM do_events ORDER BY timestamp DESC LIMIT 1000
        )
      `)

      return c.json({ success: true, id })
    })

    // List recent events
    this.app.get('/events', (c) => {
      const doId = c.req.query('doId')
      const type = c.req.query('type')
      const status = c.req.query('status')
      const limit = parseInt(c.req.query('limit') || '50', 10)
      const offset = parseInt(c.req.query('offset') || '0', 10)
      const since = c.req.query('since')

      let query = 'SELECT * FROM do_events WHERE 1=1'
      const params: (string | number)[] = []

      if (doId) {
        query += ' AND do_id = ?'
        params.push(doId)
      }

      if (type) {
        query += ' AND type = ?'
        params.push(type)
      }

      if (status) {
        query += ' AND status = ?'
        params.push(status)
      }

      if (since) {
        query += ' AND timestamp >= ?'
        params.push(parseInt(since, 10))
      }

      query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?'
      params.push(limit, offset)

      const cursor = this.sql.exec<DOEventRow>(query, ...params)
      const rows = [...cursor]

      const events: DOEvent[] = rows.map((row) => {
        const event: DOEvent = {
          id: row.id,
          doId: row.do_id,
          doName: row.do_name,
          type: row.type,
          payload: row.payload ? JSON.parse(row.payload) : undefined,
          status: row.status as DOEvent['status'],
          timestamp: row.timestamp,
        }
        if (row.duration != null) event.duration = row.duration
        if (row.error != null) event.error = row.error
        return event
      })

      // Get total count with filters
      let countQuery = 'SELECT COUNT(*) as count FROM do_events WHERE 1=1'
      const countParams: (string | number)[] = []

      if (doId) {
        countQuery += ' AND do_id = ?'
        countParams.push(doId)
      }
      if (type) {
        countQuery += ' AND type = ?'
        countParams.push(type)
      }
      if (status) {
        countQuery += ' AND status = ?'
        countParams.push(status)
      }
      if (since) {
        countQuery += ' AND timestamp >= ?'
        countParams.push(parseInt(since, 10))
      }

      const countCursor = this.sql.exec<CountRow>(countQuery, ...countParams)
      const countRows = [...countCursor]
      const total = countRows[0]?.count ?? 0

      return c.json({ events, total })
    })

    // === Metrics endpoints ===

    // Record metrics
    this.app.post('/metrics', async (c) => {
      const body = await c.req.json<{
        doId: string
        requestCount?: number
        errorCount?: number
        responseTime?: number
      }>()

      const now = Date.now()
      const bucketTimestamp = Math.floor(now / (5 * 60 * 1000)) * (5 * 60 * 1000) // 5-minute buckets

      // Update aggregated metrics
      if (body.requestCount !== undefined || body.errorCount !== undefined) {
        this.sql.exec(
          `INSERT INTO do_metrics (do_id, request_count, error_count, avg_response_time, last_updated)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(do_id) DO UPDATE SET
             request_count = request_count + ?,
             error_count = error_count + ?,
             avg_response_time = CASE
               WHEN ? > 0 THEN (avg_response_time * request_count + ?) / (request_count + ?)
               ELSE avg_response_time
             END,
             last_updated = ?`,
          body.doId,
          body.requestCount || 0,
          body.errorCount || 0,
          body.responseTime || 0,
          now,
          body.requestCount || 0,
          body.errorCount || 0,
          body.responseTime || 0,
          body.responseTime || 0,
          body.requestCount || 0,
          now
        )
      }

      // Update time-series bucket
      this.sql.exec(
        `INSERT INTO metrics_buckets (do_id, bucket_timestamp, requests, errors, total_response_time)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(do_id, bucket_timestamp) DO UPDATE SET
           requests = requests + ?,
           errors = errors + ?,
           total_response_time = total_response_time + ?`,
        body.doId,
        bucketTimestamp,
        body.requestCount || 0,
        body.errorCount || 0,
        body.responseTime || 0,
        body.requestCount || 0,
        body.errorCount || 0,
        body.responseTime || 0
      )

      // Clean up old buckets (keep last 24 hours)
      const cutoff = now - 24 * 60 * 60 * 1000
      this.sql.exec('DELETE FROM metrics_buckets WHERE bucket_timestamp < ?', cutoff)

      return c.json({ success: true })
    })

    // Get aggregated metrics
    this.app.get('/metrics', (c) => {
      const doId = c.req.query('doId')

      if (doId) {
        // Get metrics for specific DO
        const cursor = this.sql.exec<MetricsRow>(
          'SELECT * FROM do_metrics WHERE do_id = ?',
          doId
        )
        const rows = [...cursor]
        const row = rows[0]

        if (!row) {
          return c.json({
            doId,
            requestCount: 0,
            errorCount: 0,
            avgResponseTime: 0,
            lastUpdated: 0,
          })
        }

        return c.json({
          doId: row.do_id,
          requestCount: row.request_count,
          errorCount: row.error_count,
          avgResponseTime: row.avg_response_time,
          lastUpdated: row.last_updated,
        })
      }

      // Get all metrics aggregated
      const cursor = this.sql.exec<SumRow>(
        'SELECT SUM(request_count) as total_requests, SUM(error_count) as total_errors FROM do_metrics'
      )
      const rows = [...cursor]
      const row = rows[0]

      const countCursor = this.sql.exec<CountRow>(
        'SELECT COUNT(*) as count FROM do_metrics'
      )
      const countRows = [...countCursor]
      const doCount = countRows[0]?.count ?? 0

      return c.json({
        totalRequests: row?.total_requests || 0,
        totalErrors: row?.total_errors || 0,
        errorRate:
          row?.total_requests && row.total_requests > 0
            ? ((row?.total_errors || 0) / row.total_requests) * 100
            : 0,
        activeDOs: doCount,
      })
    })

    // Get time-series metrics
    this.app.get('/metrics/timeseries', (c) => {
      const doId = c.req.query('doId')
      const hours = parseInt(c.req.query('hours') || '1', 10)
      const cutoff = Date.now() - hours * 60 * 60 * 1000

      let query = `
        SELECT bucket_timestamp, SUM(requests) as requests, SUM(errors) as errors, SUM(total_response_time) as total_response_time
        FROM metrics_buckets
        WHERE bucket_timestamp >= ?
      `
      const params: (string | number)[] = [cutoff]

      if (doId) {
        query += ' AND do_id = ?'
        params.push(doId)
      }

      query += ' GROUP BY bucket_timestamp ORDER BY bucket_timestamp ASC'

      const cursor = this.sql.exec<{
        bucket_timestamp: number
        requests: number
        errors: number
        total_response_time: number
      }>(query, ...params)
      const rows = [...cursor]

      const timeseries = rows.map((row) => ({
        timestamp: row.bucket_timestamp,
        requests: row.requests,
        errors: row.errors,
        avgResponseTime: row.requests > 0 ? row.total_response_time / row.requests : 0,
      }))

      return c.json({ timeseries })
    })

    // === Health check endpoint ===
    this.app.get('/health', (c) => {
      // Update stale DOs to inactive
      const staleThreshold = Date.now() - 5 * 60 * 1000 // 5 minutes
      this.sql.exec(
        `UPDATE do_registrations SET status = 'inactive' WHERE last_seen < ? AND status = 'active'`,
        staleThreshold
      )

      // Get counts
      const activeCursor = this.sql.exec<CountRow>(
        `SELECT COUNT(*) as count FROM do_registrations WHERE status = 'active'`
      )
      const activeRows = [...activeCursor]
      const activeDOs = activeRows[0]?.count ?? 0

      const inactiveCursor = this.sql.exec<CountRow>(
        `SELECT COUNT(*) as count FROM do_registrations WHERE status = 'inactive'`
      )
      const inactiveRows = [...inactiveCursor]
      const inactiveDOs = inactiveRows[0]?.count ?? 0

      const metricsCursor = this.sql.exec<SumRow>(
        'SELECT SUM(request_count) as total_requests, SUM(error_count) as total_errors FROM do_metrics'
      )
      const metricsRows = [...metricsCursor]
      const metricsRow = metricsRows[0]

      const totalRequests = metricsRow?.total_requests || 0
      const totalErrors = metricsRow?.total_errors || 0
      const errorRate = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0

      // Recent events stats
      const recentCutoff = Date.now() - 60 * 60 * 1000 // Last hour
      const recentEventsCursor = this.sql.exec<CountRow>(
        'SELECT COUNT(*) as count FROM do_events WHERE timestamp >= ?',
        recentCutoff
      )
      const recentEventsRows = [...recentEventsCursor]
      const recentEvents = recentEventsRows[0]?.count ?? 0

      const failedEventsCursor = this.sql.exec<CountRow>(
        `SELECT COUNT(*) as count FROM do_events WHERE timestamp >= ? AND status = 'failed'`,
        recentCutoff
      )
      const failedEventsRows = [...failedEventsCursor]
      const failedEvents = failedEventsRows[0]?.count ?? 0

      return c.json({
        status: errorRate > 10 ? 'degraded' : 'healthy',
        timestamp: new Date().toISOString(),
        dos: {
          active: activeDOs,
          inactive: inactiveDOs,
          total: activeDOs + inactiveDOs,
        },
        metrics: {
          totalRequests,
          totalErrors,
          errorRate: errorRate.toFixed(2) + '%',
        },
        events: {
          lastHour: recentEvents,
          failed: failedEvents,
        },
      })
    })

    // === State inspection endpoint ===
    this.app.get('/inspect/:doId', (c) => {
      const doId = c.req.param('doId')

      // Get registration
      const regCursor = this.sql.exec<DORegistrationRow>(
        'SELECT * FROM do_registrations WHERE id = ?',
        doId
      )
      const regRows = [...regCursor]
      const registration = regRows[0]

      if (!registration) {
        return c.json({ error: 'DO not found' }, 404)
      }

      // Get metrics
      const metricsCursor = this.sql.exec<MetricsRow>(
        'SELECT * FROM do_metrics WHERE do_id = ?',
        doId
      )
      const metricsRows = [...metricsCursor]
      const metrics = metricsRows[0]

      // Get recent events
      const eventsCursor = this.sql.exec<DOEventRow>(
        'SELECT * FROM do_events WHERE do_id = ? ORDER BY timestamp DESC LIMIT 20',
        doId
      )
      const events = [...eventsCursor]

      // Get time-series for last hour
      const hourAgo = Date.now() - 60 * 60 * 1000
      const bucketsCursor = this.sql.exec<MetricsBucketRow>(
        'SELECT * FROM metrics_buckets WHERE do_id = ? AND bucket_timestamp >= ? ORDER BY bucket_timestamp ASC',
        doId,
        hourAgo
      )
      const buckets = [...bucketsCursor]

      return c.json({
        id: doId,
        registration: {
          name: registration.name,
          className: registration.class_name,
          namespace: registration.namespace,
          registeredAt: registration.registered_at,
          lastSeen: registration.last_seen,
          status: registration.status,
          metadata: registration.metadata ? JSON.parse(registration.metadata) : null,
        },
        metrics: metrics
          ? {
              requestCount: metrics.request_count,
              errorCount: metrics.error_count,
              avgResponseTime: metrics.avg_response_time,
              errorRate:
                metrics.request_count > 0
                  ? ((metrics.error_count / metrics.request_count) * 100).toFixed(2) + '%'
                  : '0%',
            }
          : null,
        recentEvents: events.map((e) => ({
          id: e.id,
          type: e.type,
          status: e.status,
          timestamp: e.timestamp,
          duration: e.duration,
          error: e.error,
        })),
        timeseries: buckets.map((b) => ({
          timestamp: b.bucket_timestamp,
          requests: b.requests,
          errors: b.errors,
          avgResponseTime: b.requests > 0 ? b.total_response_time / b.requests : 0,
        })),
      })
    })
  }

  async fetch(request: Request): Promise<Response> {
    return this.app.fetch(request)
  }
}
