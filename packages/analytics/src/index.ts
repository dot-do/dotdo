/**
 * @dotdo/analytics v4 - Analytics query interface
 * Core package - every DO has analytics built-in
 */

import type {
  AnalyticsQuery,
  AnalyticsResult,
  MaterializedView,
  Period,
  OrgId,
} from '@dotdo/types'

// ============================================================================
// Query Engine Interface
// ============================================================================

/**
 * Abstract query engine interface
 * Implementations: DuckDB WASM, db4 SQLite, R2 SQL
 */
export interface QueryEngine {
  /** Execute analytics query */
  query(q: AnalyticsQuery): Promise<AnalyticsResult>

  /** Get engine capabilities */
  capabilities(): QueryEngineCapabilities
}

export interface QueryEngineCapabilities {
  name: 'duckdb-wasm' | 'db4-sqlite' | 'r2-sql'
  maxMemoryMB: number
  supportsWindowFunctions: boolean
  supportsCTE: boolean
  supportsJSON: boolean
  latencyProfile: 'hot' | 'warm' | 'cold'
}

// ============================================================================
// Analytics Service
// ============================================================================

export interface AnalyticsOptions {
  /** Real-time query engine (typically db4 SQLite in DO) */
  realtimeEngine?: QueryEngine
  /** Historical query engine (typically DuckDB on R2) */
  historicalEngine?: QueryEngine
  /** Organization ID */
  orgId?: OrgId
  /** DO ID for scoping */
  doId?: string
}

export class Analytics {
  private realtimeEngine?: QueryEngine
  private historicalEngine?: QueryEngine
  private orgId?: OrgId
  private doId?: string
  private materializedViews: Map<string, MaterializedView> = new Map()

  constructor(options: AnalyticsOptions = {}) {
    this.realtimeEngine = options.realtimeEngine
    this.historicalEngine = options.historicalEngine
    this.orgId = options.orgId
    this.doId = options.doId
  }

  /**
   * Query real-time analytics (from DO SQLite)
   */
  async query(q: AnalyticsQuery): Promise<AnalyticsResult> {
    if (!this.realtimeEngine) {
      throw new Error('No real-time query engine configured')
    }

    return this.realtimeEngine.query({
      ...q,
      filters: {
        ...q.filters,
        orgId: this.orgId,
        doId: this.doId,
      },
    })
  }

  /**
   * Query historical analytics (from R2 via DuckDB/R2 SQL)
   */
  async queryHistorical(q: AnalyticsQuery): Promise<AnalyticsResult> {
    if (!this.historicalEngine) {
      throw new Error('No historical query engine configured')
    }

    return this.historicalEngine.query({
      ...q,
      filters: {
        ...q.filters,
        orgId: this.orgId,
      },
    })
  }

  /**
   * Get a materialized view
   */
  async getMaterialized(viewName: string): Promise<unknown> {
    const view = this.materializedViews.get(viewName)
    if (!view) {
      throw new Error(`Materialized view not found: ${viewName}`)
    }

    // Check if refresh needed
    const now = Date.now()
    const lastRefresh = view.lastRefreshed?.getTime() ?? 0
    if (now - lastRefresh > view.refreshInterval) {
      await this.refreshMaterializedView(viewName)
    }

    // Query the materialized view
    return this.query(view.query)
  }

  /**
   * Register a materialized view
   */
  registerMaterializedView(view: MaterializedView): void {
    this.materializedViews.set(view.name, view)
  }

  /**
   * Refresh a materialized view
   */
  async refreshMaterializedView(viewName: string): Promise<void> {
    const view = this.materializedViews.get(viewName)
    if (!view) {
      throw new Error(`Materialized view not found: ${viewName}`)
    }

    // Execute the query and cache result
    await this.query(view.query)
    view.lastRefreshed = new Date()
  }

  /**
   * Get usage for a specific metric in a period
   */
  async getUsage(metric: string, period: Period): Promise<number> {
    const result = await this.query({
      metrics: [metric],
      period,
    })

    const row = result.data[0]
    return (row?.[metric] as number) ?? 0
  }

  /**
   * Get multiple metrics
   */
  async getMetrics(metrics: string[], period: Period): Promise<Record<string, number>> {
    const result = await this.query({
      metrics,
      period,
    })

    const row = result.data[0] ?? {}
    const output: Record<string, number> = {}
    for (const metric of metrics) {
      output[metric] = (row[metric] as number) ?? 0
    }
    return output
  }
}

// ============================================================================
// Query Builders
// ============================================================================

export class AnalyticsQueryBuilder {
  private _metrics: string[] = []
  private _period?: Period
  private _groupBy?: 'minute' | 'hour' | 'day' | 'week' | 'month'
  private _filters: Record<string, unknown> = {}

  metrics(...metrics: string[]): this {
    this._metrics.push(...metrics)
    return this
  }

  period(start: Date, end: Date): this {
    this._period = { start, end }
    return this
  }

  lastHours(hours: number): this {
    const end = new Date()
    const start = new Date(end.getTime() - hours * 60 * 60 * 1000)
    return this.period(start, end)
  }

  lastDays(days: number): this {
    const end = new Date()
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000)
    return this.period(start, end)
  }

  groupBy(interval: 'minute' | 'hour' | 'day' | 'week' | 'month'): this {
    this._groupBy = interval
    return this
  }

  filter(key: string, value: unknown): this {
    this._filters[key] = value
    return this
  }

  build(): AnalyticsQuery {
    if (!this._period) {
      throw new Error('Period is required')
    }
    if (this._metrics.length === 0) {
      throw new Error('At least one metric is required')
    }

    return {
      metrics: this._metrics,
      period: this._period,
      groupBy: this._groupBy,
      filters: Object.keys(this._filters).length > 0 ? this._filters : undefined,
    }
  }
}

export function analyticsQuery(): AnalyticsQueryBuilder {
  return new AnalyticsQueryBuilder()
}

// ============================================================================
// Re-exports
// ============================================================================

export type { AnalyticsQuery, AnalyticsResult, MaterializedView, Period } from '@dotdo/types'
