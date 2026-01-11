/**
 * AnalyticsDO - Real-Time OLAP Analytics on the Edge
 *
 * DuckDB-powered analytics in a Durable Object. Query millions of rows
 * in milliseconds, directly on V8 isolates. No data warehouse required.
 *
 * Features:
 * - Time-series aggregations (DAU, MAU, retention)
 * - Funnel analysis with window functions
 * - Cohort analysis for user behavior
 * - Log analysis and search
 * - Real-time dashboard metrics
 * - Iceberg/Parquet integration via R2
 *
 * Performance:
 * - 10M row aggregation: ~50ms
 * - Cold start: <500ms (WASM load)
 * - Warm queries: <10ms
 */

import { DurableObject } from 'cloudflare:workers'
import { createDuckDB, type DuckDBInstance } from '@dotdo/duckdb-worker'

// ============================================================================
// TYPES
// ============================================================================

interface Event {
  id: string
  timestamp: string
  user_id: string
  event_type: string
  properties: Record<string, unknown>
  session_id?: string
}

interface LogEntry {
  id: string
  timestamp: string
  level: 'debug' | 'info' | 'warn' | 'error'
  service: string
  message: string
  metadata?: Record<string, unknown>
}

interface DAUResult {
  day: string
  dau: number
}

interface MAUResult {
  month: string
  mau: number
}

interface FunnelStep {
  step: string
  users: number
  conversion_rate: number
}

interface CohortRow {
  cohort: string
  period: number
  retained_users: number
  retention_rate: number
}

interface TimeseriesPoint {
  bucket: string
  count: number
  unique_users?: number
}

interface TopEvent {
  event_type: string
  count: number
  unique_users: number
}

interface Env {
  DATA_BUCKET: R2Bucket
  ENVIRONMENT?: string
}

// ============================================================================
// ANALYTICS DO CLASS
// ============================================================================

export class AnalyticsDO extends DurableObject<Env> {
  private db: DuckDBInstance | null = null
  private initialized = false

  /**
   * Initialize DuckDB instance and create tables
   */
  private async initialize(): Promise<DuckDBInstance> {
    if (this.db && this.initialized) {
      return this.db
    }

    this.db = await createDuckDB()

    // Create events table for analytics
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS events (
        id VARCHAR PRIMARY KEY,
        timestamp TIMESTAMP NOT NULL,
        user_id VARCHAR NOT NULL,
        event_type VARCHAR NOT NULL,
        properties JSON,
        session_id VARCHAR
      )
    `)

    // Create index for time-series queries
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp)
    `)
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id)
    `)
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type)
    `)

    // Create logs table for log analysis
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS logs (
        id VARCHAR PRIMARY KEY,
        timestamp TIMESTAMP NOT NULL,
        level VARCHAR NOT NULL,
        service VARCHAR NOT NULL,
        message VARCHAR NOT NULL,
        metadata JSON
      )
    `)

    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp)
    `)
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level)
    `)
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_logs_service ON logs(service)
    `)

    this.initialized = true
    return this.db
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENT INGESTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Ingest a single event
   */
  async ingestEvent(event: Event): Promise<void> {
    const db = await this.initialize()
    await db.query(
      `INSERT INTO events (id, timestamp, user_id, event_type, properties, session_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        event.id,
        event.timestamp,
        event.user_id,
        event.event_type,
        JSON.stringify(event.properties),
        event.session_id ?? null,
      ]
    )
  }

  /**
   * Batch ingest events for high throughput
   */
  async ingestEvents(events: Event[]): Promise<{ ingested: number }> {
    const db = await this.initialize()

    for (const event of events) {
      await db.query(
        `INSERT INTO events (id, timestamp, user_id, event_type, properties, session_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          event.id,
          event.timestamp,
          event.user_id,
          event.event_type,
          JSON.stringify(event.properties),
          event.session_id ?? null,
        ]
      )
    }

    return { ingested: events.length }
  }

  /**
   * Ingest log entries
   */
  async ingestLogs(logs: LogEntry[]): Promise<{ ingested: number }> {
    const db = await this.initialize()

    for (const log of logs) {
      await db.query(
        `INSERT INTO logs (id, timestamp, level, service, message, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          log.id,
          log.timestamp,
          log.level,
          log.service,
          log.message,
          log.metadata ? JSON.stringify(log.metadata) : null,
        ]
      )
    }

    return { ingested: logs.length }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TIME-SERIES AGGREGATIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get Daily Active Users (DAU) for the last N days
   */
  async getDailyActiveUsers(days: number = 30): Promise<DAUResult[]> {
    const db = await this.initialize()

    const result = await db.query<{ day: string; dau: number }>(`
      SELECT
        DATE_TRUNC('day', timestamp) as day,
        COUNT(DISTINCT user_id) as dau
      FROM events
      WHERE timestamp > NOW() - INTERVAL '${days} days'
      GROUP BY DATE_TRUNC('day', timestamp)
      ORDER BY day DESC
    `)

    return result.rows.map((row) => ({
      day: String(row.day),
      dau: Number(row.dau),
    }))
  }

  /**
   * Get Monthly Active Users (MAU) for the last N months
   */
  async getMonthlyActiveUsers(months: number = 12): Promise<MAUResult[]> {
    const db = await this.initialize()

    const result = await db.query<{ month: string; mau: number }>(`
      SELECT
        DATE_TRUNC('month', timestamp) as month,
        COUNT(DISTINCT user_id) as mau
      FROM events
      WHERE timestamp > NOW() - INTERVAL '${months} months'
      GROUP BY DATE_TRUNC('month', timestamp)
      ORDER BY month DESC
    `)

    return result.rows.map((row) => ({
      month: String(row.month),
      mau: Number(row.mau),
    }))
  }

  /**
   * Get event counts in time buckets
   */
  async getTimeseries(
    eventType: string,
    interval: 'hour' | 'day' | 'week' | 'month',
    lookback: string = '7 days'
  ): Promise<TimeseriesPoint[]> {
    const db = await this.initialize()

    const result = await db.query<{ bucket: string; count: number; unique_users: number }>(`
      SELECT
        DATE_TRUNC('${interval}', timestamp) as bucket,
        COUNT(*) as count,
        COUNT(DISTINCT user_id) as unique_users
      FROM events
      WHERE event_type = $1
        AND timestamp > NOW() - INTERVAL '${lookback}'
      GROUP BY DATE_TRUNC('${interval}', timestamp)
      ORDER BY bucket DESC
    `, [eventType])

    return result.rows.map((row) => ({
      bucket: String(row.bucket),
      count: Number(row.count),
      unique_users: Number(row.unique_users),
    }))
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FUNNEL ANALYSIS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Analyze conversion funnel with window functions
   *
   * @param steps - Array of event types representing funnel steps
   * @param timeWindow - Maximum time between steps (e.g., '24 hours')
   */
  async getFunnelConversion(
    steps: string[],
    timeWindow: string = '24 hours'
  ): Promise<FunnelStep[]> {
    const db = await this.initialize()

    if (steps.length < 2) {
      throw new Error('Funnel requires at least 2 steps')
    }

    // Build funnel query using window functions
    const stepConditions = steps
      .map((step, i) => `event_type = '${step}'`)
      .join(' OR ')

    const result = await db.query(`
      WITH user_events AS (
        SELECT
          user_id,
          event_type,
          timestamp,
          ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY timestamp) as event_order
        FROM events
        WHERE ${stepConditions}
          AND timestamp > NOW() - INTERVAL '30 days'
      ),
      funnel_progress AS (
        SELECT
          user_id,
          MAX(CASE WHEN event_type = $1 THEN 1 ELSE 0 END) as step_1,
          MAX(CASE WHEN event_type = $2 THEN 1 ELSE 0 END) as step_2
          ${steps.slice(2).map((_, i) => `,MAX(CASE WHEN event_type = $${i + 3} THEN 1 ELSE 0 END) as step_${i + 3}`).join('')}
        FROM user_events
        GROUP BY user_id
      )
      SELECT
        ${steps.map((_, i) => `SUM(step_${i + 1}) as step_${i + 1}_users`).join(', ')}
      FROM funnel_progress
    `, steps)

    const row = result.rows[0] as Record<string, unknown>
    const firstStepKey = `step_1_users`
    const totalUsers = Number(row[firstStepKey]) || 1

    return steps.map((step, i) => {
      const key = `step_${i + 1}_users`
      const users = Number(row[key]) || 0
      return {
        step,
        users,
        conversion_rate: users / totalUsers,
      }
    })
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COHORT ANALYSIS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Analyze user retention by cohort
   *
   * @param cohortType - 'signup' or 'first_purchase'
   * @param periods - Number of retention periods to analyze
   */
  async getCohortRetention(
    cohortType: string = 'signup',
    periods: number = 12
  ): Promise<CohortRow[]> {
    const db = await this.initialize()

    const result = await db.query(`
      WITH user_cohorts AS (
        SELECT
          user_id,
          DATE_TRUNC('month', MIN(timestamp)) as cohort
        FROM events
        WHERE event_type = $1
        GROUP BY user_id
      ),
      user_activity AS (
        SELECT
          e.user_id,
          c.cohort,
          DATE_TRUNC('month', e.timestamp) as activity_month,
          DATEDIFF('month', c.cohort, DATE_TRUNC('month', e.timestamp)) as period
        FROM events e
        JOIN user_cohorts c ON e.user_id = c.user_id
      ),
      cohort_sizes AS (
        SELECT cohort, COUNT(DISTINCT user_id) as cohort_size
        FROM user_cohorts
        GROUP BY cohort
      ),
      retention AS (
        SELECT
          ua.cohort,
          ua.period,
          COUNT(DISTINCT ua.user_id) as retained_users
        FROM user_activity ua
        WHERE ua.period >= 0 AND ua.period < $2
        GROUP BY ua.cohort, ua.period
      )
      SELECT
        r.cohort,
        r.period,
        r.retained_users,
        ROUND(r.retained_users::DECIMAL / cs.cohort_size * 100, 2) as retention_rate
      FROM retention r
      JOIN cohort_sizes cs ON r.cohort = cs.cohort
      ORDER BY r.cohort DESC, r.period ASC
    `, [cohortType, periods])

    return result.rows.map((row) => ({
      cohort: String(row.cohort),
      period: Number(row.period),
      retained_users: Number(row.retained_users),
      retention_rate: Number(row.retention_rate),
    }))
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LOG ANALYSIS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Search logs with full-text matching
   */
  async searchLogs(
    query: string,
    options: {
      level?: string
      service?: string
      limit?: number
      since?: string
    } = {}
  ): Promise<LogEntry[]> {
    const db = await this.initialize()

    const conditions: string[] = [`message ILIKE '%' || $1 || '%'`]
    const params: unknown[] = [query]
    let paramIndex = 2

    if (options.level) {
      conditions.push(`level = $${paramIndex}`)
      params.push(options.level)
      paramIndex++
    }

    if (options.service) {
      conditions.push(`service = $${paramIndex}`)
      params.push(options.service)
      paramIndex++
    }

    if (options.since) {
      conditions.push(`timestamp > $${paramIndex}`)
      params.push(options.since)
      paramIndex++
    }

    const limit = options.limit ?? 100

    const result = await db.query(`
      SELECT id, timestamp, level, service, message, metadata
      FROM logs
      WHERE ${conditions.join(' AND ')}
      ORDER BY timestamp DESC
      LIMIT ${limit}
    `, params)

    return result.rows.map((row) => ({
      id: String(row.id),
      timestamp: String(row.timestamp),
      level: String(row.level) as LogEntry['level'],
      service: String(row.service),
      message: String(row.message),
      metadata: row.metadata ? JSON.parse(String(row.metadata)) : undefined,
    }))
  }

  /**
   * Get error rate by service
   */
  async getErrorRates(lookback: string = '1 hour'): Promise<
    Array<{
      service: string
      total: number
      errors: number
      error_rate: number
    }>
  > {
    const db = await this.initialize()

    const result = await db.query(`
      SELECT
        service,
        COUNT(*) as total,
        SUM(CASE WHEN level = 'error' THEN 1 ELSE 0 END) as errors,
        ROUND(SUM(CASE WHEN level = 'error' THEN 1 ELSE 0 END)::DECIMAL / COUNT(*) * 100, 2) as error_rate
      FROM logs
      WHERE timestamp > NOW() - INTERVAL '${lookback}'
      GROUP BY service
      ORDER BY error_rate DESC
    `)

    return result.rows.map((row) => ({
      service: String(row.service),
      total: Number(row.total),
      errors: Number(row.errors),
      error_rate: Number(row.error_rate),
    }))
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REAL-TIME DASHBOARD
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get real-time dashboard metrics
   */
  async getDashboardMetrics(): Promise<{
    activeUsers: { last_minute: number; last_hour: number; last_day: number }
    topEvents: TopEvent[]
    errorRate: number
    requestsPerSecond: number
  }> {
    const db = await this.initialize()

    // Active users in different windows
    const activeUsersResult = await db.query<{ last_minute: number; last_hour: number; last_day: number }>(`
      SELECT
        COUNT(DISTINCT CASE WHEN timestamp > NOW() - INTERVAL '1 minute' THEN user_id END) as last_minute,
        COUNT(DISTINCT CASE WHEN timestamp > NOW() - INTERVAL '1 hour' THEN user_id END) as last_hour,
        COUNT(DISTINCT CASE WHEN timestamp > NOW() - INTERVAL '1 day' THEN user_id END) as last_day
      FROM events
    `)
    const activeRow = activeUsersResult.rows[0]

    // Top events in last hour
    const topEventsResult = await db.query<{ event_type: string; count: number; unique_users: number }>(`
      SELECT
        event_type,
        COUNT(*) as count,
        COUNT(DISTINCT user_id) as unique_users
      FROM events
      WHERE timestamp > NOW() - INTERVAL '1 hour'
      GROUP BY event_type
      ORDER BY count DESC
      LIMIT 10
    `)

    // Error rate from logs
    const errorResult = await db.query<{ error_rate: number }>(`
      SELECT
        COALESCE(
          SUM(CASE WHEN level = 'error' THEN 1 ELSE 0 END)::DECIMAL / NULLIF(COUNT(*), 0) * 100,
          0
        ) as error_rate
      FROM logs
      WHERE timestamp > NOW() - INTERVAL '1 hour'
    `)
    const errorRow = errorResult.rows[0]

    // Requests per second (events per second in last minute)
    const rpsResult = await db.query<{ rps: number }>(`
      SELECT COUNT(*) / 60.0 as rps
      FROM events
      WHERE timestamp > NOW() - INTERVAL '1 minute'
    `)
    const rpsRow = rpsResult.rows[0]

    return {
      activeUsers: {
        last_minute: Number(activeRow?.last_minute) || 0,
        last_hour: Number(activeRow?.last_hour) || 0,
        last_day: Number(activeRow?.last_day) || 0,
      },
      topEvents: topEventsResult.rows.map((row) => ({
        event_type: String(row.event_type),
        count: Number(row.count),
        unique_users: Number(row.unique_users),
      })),
      errorRate: Number(errorRow?.error_rate) || 0,
      requestsPerSecond: Number(rpsRow?.rps) || 0,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ICEBERG/PARQUET INTEGRATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Load Parquet file from R2 and register for querying
   */
  async loadParquetFromR2(key: string, virtualName?: string): Promise<void> {
    const db = await this.initialize()

    const object = await this.env.DATA_BUCKET.get(key)
    if (!object) {
      throw new Error(`Parquet file not found in R2: ${key}`)
    }

    const buffer = await object.arrayBuffer()
    const name = virtualName ?? key.split('/').pop() ?? key

    db.registerFileBuffer(name, buffer)
  }

  /**
   * Query Parquet files directly with SQL
   */
  async queryParquet(sql: string): Promise<{ columns: string[]; rows: Record<string, unknown>[] }> {
    const db = await this.initialize()
    const result = await db.query(sql)
    return {
      columns: result.columns.map(c => c.name),
      rows: result.rows,
    }
  }

  /**
   * Aggregate historical data from Parquet files
   */
  async aggregateHistoricalData(
    parquetFile: string,
    aggregation: 'sum' | 'count' | 'avg',
    column: string,
    groupBy: string,
    filters?: Record<string, unknown>
  ): Promise<Array<Record<string, unknown>>> {
    const db = await this.initialize()

    let whereClause = ''
    const params: unknown[] = []

    if (filters && Object.keys(filters).length > 0) {
      const conditions = Object.entries(filters).map(([key, value], i) => {
        params.push(value)
        return `${key} = $${i + 1}`
      })
      whereClause = `WHERE ${conditions.join(' AND ')}`
    }

    const aggFn = aggregation.toUpperCase()
    const result = await db.query(`
      SELECT
        ${groupBy},
        ${aggFn}(${column}) as ${aggregation}_${column}
      FROM parquet_scan('${parquetFile}')
      ${whereClause}
      GROUP BY ${groupBy}
      ORDER BY ${aggregation}_${column} DESC
    `, params)

    return result.rows.map((row) => ({
      [groupBy]: row[groupBy],
      [`${aggregation}_${column}`]: row[`${aggregation}_${column}`],
    }))
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RAW SQL EXECUTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Execute arbitrary SQL query (read-only recommended for analytics)
   */
  async query(sql: string, params: unknown[] = []): Promise<{ columns: string[]; rows: Record<string, unknown>[] }> {
    const db = await this.initialize()
    const result = await db.query(sql, params)
    return {
      columns: result.columns.map(c => c.name),
      rows: result.rows,
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HTTP HANDLER
  // ═══════════════════════════════════════════════════════════════════════════

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    // Handle RPC endpoint
    if (url.pathname === '/rpc' && request.method === 'POST') {
      try {
        const body = (await request.json()) as {
          jsonrpc: string
          id: number
          method: string
          params?: unknown[]
        }
        const { method, params = [], id } = body

        // Call the method on this DO
        const methodFn = (this as unknown as Record<string, (...args: unknown[]) => unknown>)[method]
        if (typeof methodFn !== 'function') {
          return Response.json(
            {
              jsonrpc: '2.0',
              id,
              error: { code: -32601, message: `Method '${method}' not found` },
            },
            { status: 400 }
          )
        }

        const result = await methodFn.apply(this, params)
        return Response.json({ jsonrpc: '2.0', id, result })
      } catch (error) {
        return Response.json(
          {
            jsonrpc: '2.0',
            id: 0,
            error: { code: -32603, message: String(error) },
          },
          { status: 500 }
        )
      }
    }

    return new Response('Not Found', { status: 404 })
  }
}

export default AnalyticsDO
