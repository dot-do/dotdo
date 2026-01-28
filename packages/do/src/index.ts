/**
 * @dotdo/do v4 - Base Durable Object with events + analytics built-in
 *
 * Every DO:
 * 1. Emits events to the Pipeline
 * 2. Can query its own analytics
 * 3. Has SQLite for local state
 */

import { Hono } from 'hono'
import { EventEmitter, PipelineStream } from '@dotdo/events'
import { Analytics, QueryEngine } from '@dotdo/analytics'
import type { OrgId, Period, AnalyticsQuery, AnalyticsResult } from '@dotdo/types'

// ============================================================================
// Environment Types
// ============================================================================

export interface DOEnv {
  /** Cloudflare Pipeline Stream binding */
  EVENTS_PIPELINE?: PipelineStream
  /** Organization ID (can be set per-request) */
  ORG_ID?: string
}

// ============================================================================
// DO Options
// ============================================================================

export interface DOOptions {
  /** Organization ID override */
  orgId?: OrgId
  /** Custom query engine for analytics */
  queryEngine?: QueryEngine
  /** Disable event emission */
  disableEvents?: boolean
}

// ============================================================================
// Base DO Class
// ============================================================================

export abstract class DO implements DurableObject {
  /** Hono app for HTTP/RPC routing */
  protected app: Hono

  /** Durable Object state */
  protected ctx: DurableObjectState

  /** Environment bindings */
  protected env: DOEnv

  /** Event emitter → Cloudflare Pipeline */
  protected events: EventEmitter

  /** Analytics query interface */
  protected analytics: Analytics

  /** SQLite storage */
  protected get sql() {
    return this.ctx.storage.sql
  }

  constructor(ctx: DurableObjectState, env: DOEnv, options: DOOptions = {}) {
    this.ctx = ctx
    this.env = env
    this.app = new Hono()

    // Set up event emitter
    const pipeline = env.EVENTS_PIPELINE
    if (pipeline && !options.disableEvents) {
      this.events = new EventEmitter({
        pipeline,
        orgId: options.orgId ?? (env.ORG_ID as OrgId | undefined),
        doId: ctx.id.toString(),
        doClass: this.constructor.name,
      })
    } else {
      // Null emitter if no pipeline
      this.events = new NullEventEmitter() as unknown as EventEmitter
    }

    // Set up analytics
    this.analytics = new Analytics({
      orgId: options.orgId ?? (env.ORG_ID as OrgId | undefined),
      doId: ctx.id.toString(),
      realtimeEngine: options.queryEngine ?? this.createDefaultQueryEngine(),
    })

    // Lifecycle event
    this.events.emit({
      type: 'lifecycle.activated',
      data: {
        action: 'activated',
        doId: ctx.id.toString(),
        doClass: this.constructor.name,
      },
    })

    // Set up routes
    this.setupRoutes()
  }

  /**
   * Override to add custom routes
   */
  protected setupRoutes(): void {
    // Health check
    this.app.get('/health', (c) => c.json({ ok: true }))

    // Analytics endpoint
    this.app.post('/analytics', async (c) => {
      const query = await c.req.json<AnalyticsQuery>()
      const result = await this.analytics.query(query)
      return c.json(result)
    })
  }

  /**
   * HTTP request handler
   */
  async fetch(request: Request): Promise<Response> {
    const start = Date.now()
    let success = true
    let error: string | undefined

    try {
      const response = await this.app.fetch(request)
      return response
    } catch (e) {
      success = false
      error = e instanceof Error ? e.message : String(e)
      throw e
    } finally {
      // Emit RPC event
      const duration = Date.now() - start
      const url = new URL(request.url)

      await this.events.emit({
        type: 'rpc.call',
        data: {
          method: `${request.method} ${url.pathname}`,
          duration,
          success,
          error,
        },
      })
    }
  }

  /**
   * Create default query engine using DO SQLite
   */
  private createDefaultQueryEngine(): QueryEngine {
    return new SQLiteQueryEngine(this.ctx.storage.sql)
  }

  /**
   * Flush pending events before hibernation
   */
  async alarm(): Promise<void> {
    await this.events.flush()
  }

  // ============================================================================
  // Convenience Methods
  // ============================================================================

  /**
   * Get usage for a metric in a period
   */
  protected async getUsage(metric: string, period: Period): Promise<number> {
    return this.analytics.getUsage(metric, period)
  }

  /**
   * Query analytics
   */
  protected async queryAnalytics(query: AnalyticsQuery): Promise<AnalyticsResult> {
    return this.analytics.query(query)
  }

  /**
   * Record a usage event
   */
  protected async recordUsage(metric: string, value: number, unit?: string): Promise<void> {
    await this.events.emit({
      type: 'usage.recorded',
      data: { metric, value, unit },
    })
  }

  /**
   * Record a custom event
   */
  protected async recordEvent<T>(type: string, data: T): Promise<void> {
    await this.events.emit({ type, data })
  }
}

// ============================================================================
// SQLite Query Engine
// ============================================================================

class SQLiteQueryEngine implements QueryEngine {
  private storage: SqlStorage

  constructor(storage: SqlStorage) {
    this.storage = storage
  }

  async query(q: AnalyticsQuery): Promise<AnalyticsResult> {
    // Build SQL from analytics query
    const metricSelects = q.metrics.map((m) => `SUM(CASE WHEN metric = '${m}' THEN value ELSE 0 END) as "${m}"`)
    const groupByClause = q.groupBy ? this.buildGroupBy(q.groupBy) : ''
    const whereClause = this.buildWhere(q)

    const sql = `
      SELECT ${metricSelects.join(', ')}${groupByClause ? ', ' + groupByClause : ''}
      FROM usage_events
      ${whereClause}
      ${groupByClause ? 'GROUP BY ' + groupByClause : ''}
      ORDER BY timestamp DESC
    `

    const cursor = this.storage.exec(sql)
    const data = [...cursor] as Record<string, unknown>[]

    return {
      data,
      period: q.period,
      computedAt: new Date(),
    }
  }

  capabilities() {
    return {
      name: 'db4-sqlite' as const,
      maxMemoryMB: 128, // DO memory limit
      supportsWindowFunctions: true,
      supportsCTE: true,
      supportsJSON: true,
      latencyProfile: 'hot' as const,
    }
  }

  private buildGroupBy(interval: string): string {
    switch (interval) {
      case 'minute':
        return "strftime('%Y-%m-%d %H:%M', timestamp)"
      case 'hour':
        return "strftime('%Y-%m-%d %H', timestamp)"
      case 'day':
        return "strftime('%Y-%m-%d', timestamp)"
      case 'week':
        return "strftime('%Y-%W', timestamp)"
      case 'month':
        return "strftime('%Y-%m', timestamp)"
      default:
        return ''
    }
  }

  private buildWhere(q: AnalyticsQuery): string {
    const conditions: string[] = []

    conditions.push(`timestamp >= '${q.period.start.toISOString()}'`)
    conditions.push(`timestamp < '${q.period.end.toISOString()}'`)

    if (q.filters) {
      for (const [key, value] of Object.entries(q.filters)) {
        if (value !== undefined) {
          conditions.push(`${key} = '${value}'`)
        }
      }
    }

    return conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''
  }
}

// ============================================================================
// Null Event Emitter (for when no pipeline is configured)
// ============================================================================

class NullEventEmitter {
  async emit(): Promise<string> {
    return 'null'
  }
  async emitBatch(): Promise<string[]> {
    return []
  }
  async flush(): Promise<void> {}
  get pendingCount(): number {
    return 0
  }
}

// ============================================================================
// Re-exports
// ============================================================================

export { EventEmitter, type PipelineStream } from '@dotdo/events'
export { Analytics, type QueryEngine, analyticsQuery } from '@dotdo/analytics'
export type { Event, EventId, OrgId, AnalyticsQuery, AnalyticsResult, Period } from '@dotdo/types'
