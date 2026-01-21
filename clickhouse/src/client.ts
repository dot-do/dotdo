/**
 * @dotdo/clickhouse - Analytics Client
 *
 * High-level analytics client that wraps chdb WASM with a clean API.
 * Handles lazy loading, caching, and storage provider abstraction.
 */

import type {
  ClickHouseConfig,
  BuildProfile,
  AnalyticsEvent,
  AnalyticsEventInput,
  PageViewInput,
  PageView,
  QueryOptions,
  QueryResult,
  QueryStatistics,
  FunnelStep,
  FunnelResult,
  DateRange,
  MetricPeriod,
  SaaSMetrics,
  WebAnalyticsMetrics,
  ProductAnalytics,
  Experiment,
  ExperimentResults,
  VFSStorageProvider
} from './types'

// =============================================================================
// Analytics Client Interface
// =============================================================================

/**
 * AnalyticsClient - High-level interface for analytics operations
 *
 * This client provides:
 * - Event tracking (page views, custom events)
 * - SQL query execution via ClickHouse WASM
 * - Pre-built analytics (funnels, cohorts, retention)
 * - SaaS metrics calculation
 * - Web analytics aggregations
 *
 * @example
 * ```typescript
 * const analytics = await createClickHouseClient(storage, { profile: 'standard' })
 *
 * // Track events
 * await analytics.track({ type: 'signup', properties: { plan: 'pro' } })
 *
 * // Query with SQL
 * const results = await analytics.query<{ day: string; count: number }>(`
 *   SELECT toDate(timestamp) as day, count() as count
 *   FROM events
 *   WHERE type = 'signup'
 *   GROUP BY day
 *   ORDER BY day
 * `)
 *
 * // Funnel analysis
 * const funnel = await analytics.funnel([
 *   { name: 'Visit', event: 'page_view' },
 *   { name: 'Signup', event: 'signup' },
 *   { name: 'Purchase', event: 'purchase' }
 * ], { start: new Date('2024-01-01'), end: new Date() })
 * ```
 */
export interface AnalyticsClient {
  // ===========================================================================
  // Event Tracking
  // ===========================================================================

  /**
   * Track a custom analytics event
   */
  track(event: AnalyticsEventInput): Promise<void>

  /**
   * Track a page view with privacy-safe visitor ID
   */
  pageview(input: PageViewInput): Promise<void>

  /**
   * Batch track multiple events (more efficient)
   */
  trackBatch(events: AnalyticsEventInput[]): Promise<void>

  // ===========================================================================
  // Query Execution
  // ===========================================================================

  /**
   * Execute a SQL query
   */
  query<T = unknown>(sql: string, options?: QueryOptions): Promise<QueryResult<T>>

  /**
   * Execute a parameterized SQL query
   */
  queryWithParams<T = unknown>(
    sql: string,
    params: Record<string, unknown>,
    options?: QueryOptions
  ): Promise<QueryResult<T>>

  /**
   * Stream query results (for large datasets)
   */
  queryStream<T = unknown>(
    sql: string,
    options?: QueryOptions
  ): AsyncIterable<T>

  // ===========================================================================
  // Pre-built Analytics
  // ===========================================================================

  /**
   * Funnel analysis
   */
  funnel(steps: FunnelStep[], period: DateRange): Promise<FunnelResult>

  /**
   * Retention analysis (cohort-based)
   */
  retention(
    cohortEvent: string,
    returnEvent: string,
    period: DateRange,
    granularity?: 'day' | 'week' | 'month'
  ): Promise<RetentionResult>

  /**
   * User segmentation
   */
  segment(
    property: string,
    metric: string,
    period: DateRange
  ): Promise<SegmentResult[]>

  // ===========================================================================
  // SaaS Metrics
  // ===========================================================================

  /**
   * Calculate SaaS metrics for a period
   */
  calculateSaaSMetrics(period: MetricPeriod): Promise<SaaSMetrics>

  /**
   * Get current MRR
   */
  getCurrentMRR(): Promise<number>

  /**
   * Get MRR history
   */
  getMRRHistory(period: DateRange): Promise<Array<{ date: string; mrr: number }>>

  // ===========================================================================
  // Web Analytics
  // ===========================================================================

  /**
   * Get web analytics overview
   */
  getWebAnalytics(period: DateRange): Promise<WebAnalyticsMetrics>

  /**
   * Get real-time visitors (last N minutes)
   */
  getRealTimeVisitors(minutes?: number): Promise<number>

  // ===========================================================================
  // Product Analytics
  // ===========================================================================

  /**
   * Get product analytics
   */
  getProductAnalytics(productId: string, period: DateRange): Promise<ProductAnalytics>

  // ===========================================================================
  // Experiments
  // ===========================================================================

  /**
   * Get experiment results
   */
  getExperimentResults(experimentKey: string): Promise<ExperimentResults>

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Flush pending writes
   */
  flush(): Promise<void>

  /**
   * Clear in-memory cache
   */
  clearCache(): void

  /**
   * Get memory usage stats
   */
  getMemoryStats(): MemoryStats

  /**
   * Dispose client and free resources
   */
  dispose(): Promise<void>
}

// =============================================================================
// Additional Result Types
// =============================================================================

export interface RetentionResult {
  cohorts: Array<{
    cohort: string
    size: number
    retention: number[]
  }>
  periods: string[]
}

export interface SegmentResult {
  segment: string
  value: number
  count: number
}

export interface MemoryStats {
  /** WASM heap size */
  wasmHeap: number

  /** Cache size */
  cache: number

  /** Write buffer size */
  writeBuffer: number

  /** Total */
  total: number
}

// =============================================================================
// ClickHouse Client Implementation
// =============================================================================

/**
 * Create a ClickHouse analytics client
 *
 * This lazily loads the chdb WASM module when first query is executed.
 */
export async function createClickHouseClient(
  storage: DurableObjectStorage,
  config: ClickHouseConfig = {}
): Promise<AnalyticsClient> {
  const client = new ClickHouseClientImpl(storage, config)
  await client.initialize()
  return client
}

// Internal resolved config type with all required properties except optional r2
interface ResolvedClickHouseConfig {
  profile: BuildProfile
  r2: R2Bucket | undefined
  storage: DurableObjectStorage
  namespace: string
  maxMemory: number
  cacheSize: number
  writeBufferSize: number
}

/**
 * Internal implementation
 */
class ClickHouseClientImpl implements AnalyticsClient {
  private storage: DurableObjectStorage
  private config: ResolvedClickHouseConfig
  private wasmModule: ChdbWasmModule | null = null
  private eventBuffer: AnalyticsEvent[] = []
  private cache: Map<string, { data: unknown; expires: number }> = new Map()

  // Buffer configuration
  private readonly BUFFER_FLUSH_SIZE = 100
  /** Flush buffer every 5 seconds to ensure timely data persistence */
  private readonly BUFFER_FLUSH_INTERVAL = 5000
  /** Cache query results for 1 minute to reduce redundant computations */
  private readonly CACHE_TTL = 60000

  constructor(storage: DurableObjectStorage, config: ClickHouseConfig) {
    this.storage = storage
    this.config = {
      profile: config.profile ?? 'standard',
      r2: config.r2,
      storage: config.storage ?? storage,
      namespace: config.namespace ?? 'default',
      maxMemory: config.maxMemory ?? 64 * 1024 * 1024,
      cacheSize: config.cacheSize ?? 16 * 1024 * 1024,
      writeBufferSize: config.writeBufferSize ?? 256 * 1024
    }
  }

  async initialize(): Promise<void> {
    // Create events table schema in DO storage (hot data)
    await this.ensureSchema()
  }

  // ===========================================================================
  // Event Tracking
  // ===========================================================================

  async track(input: AnalyticsEventInput): Promise<void> {
    const event: AnalyticsEvent = {
      type: input.type,
      timestamp: Date.now(),
      properties: input.properties ?? {},
      visitorId: input.visitorId,
      sessionId: input.sessionId
    }

    this.eventBuffer.push(event)

    if (this.eventBuffer.length >= this.BUFFER_FLUSH_SIZE) {
      await this.flushEventBuffer()
    }
  }

  async pageview(input: PageViewInput): Promise<void> {
    const url = new URL(input.url)
    const properties: PageView['properties'] = {
      url: input.url,
      path: url.pathname,
      ...input.properties
    }
    if (input.referrer !== undefined) properties.referrer = input.referrer
    if (input.title !== undefined) properties.title = input.title

    const event: PageView = {
      type: 'page_view',
      timestamp: Date.now(),
      properties,
      visitorId: input.visitorId ?? this.generateVisitorId(),
      sessionId: input.sessionId
    }

    this.eventBuffer.push(event)

    if (this.eventBuffer.length >= this.BUFFER_FLUSH_SIZE) {
      await this.flushEventBuffer()
    }
  }

  async trackBatch(events: AnalyticsEventInput[]): Promise<void> {
    const now = Date.now()
    const fullEvents: AnalyticsEvent[] = events.map(e => ({
      type: e.type,
      timestamp: now,
      properties: e.properties ?? {},
      visitorId: e.visitorId,
      sessionId: e.sessionId
    }))

    this.eventBuffer.push(...fullEvents)

    if (this.eventBuffer.length >= this.BUFFER_FLUSH_SIZE) {
      await this.flushEventBuffer()
    }
  }

  // ===========================================================================
  // Query Execution
  // ===========================================================================

  async query<T = unknown>(sql: string, options?: QueryOptions): Promise<QueryResult<T>> {
    const module = await this.ensureWasmModule()

    const startTime = performance.now()
    const executeOptions: { format?: string; maxRows?: number } = {
      format: options?.format ?? 'JSONEachRow'
    }
    if (options?.limit !== undefined) {
      executeOptions.maxRows = options.limit
    }
    const result = await module.execute(sql, executeOptions)
    const elapsed = performance.now() - startTime

    const statistics: QueryStatistics = {
      elapsed,
      rowsRead: result.statistics?.rowsRead ?? 0,
      bytesRead: result.statistics?.bytesRead ?? 0
    }
    if (result.statistics?.memoryUsage !== undefined) {
      statistics.memoryUsage = result.statistics.memoryUsage
    }

    const queryResult: QueryResult<T> = {
      data: result.data as T[],
      meta: result.meta,
      rows: result.rows,
      statistics
    }
    if (result.extensions !== undefined) {
      queryResult.extensions = result.extensions
    }
    return queryResult
  }

  async queryWithParams<T = unknown>(
    sql: string,
    params: Record<string, unknown>,
    options?: QueryOptions
  ): Promise<QueryResult<T>> {
    // Replace {paramName:Type} placeholders with actual values
    let processedSql = sql
    for (const [key, value] of Object.entries(params)) {
      const regex = new RegExp(`\\{${key}:\\w+\\}`, 'g')
      processedSql = processedSql.replace(regex, this.formatValue(value))
    }

    return this.query<T>(processedSql, options)
  }

  async *queryStream<T = unknown>(
    sql: string,
    options?: QueryOptions
  ): AsyncIterable<T> {
    const module = await this.ensureWasmModule()

    const streamOptions: { format?: string; maxRows?: number } = {
      format: 'JSONEachRow'
    }
    if (options?.limit !== undefined) {
      streamOptions.maxRows = options.limit
    }
    const stream = await module.executeStream(sql, streamOptions)

    for await (const row of stream) {
      yield row as T
    }
  }

  // ===========================================================================
  // Pre-built Analytics
  // ===========================================================================

  async funnel(steps: FunnelStep[], period: DateRange): Promise<FunnelResult> {
    const conditions = steps.map((step, i) => {
      const filterConditions = step.filter
        ? Object.entries(step.filter)
            .map(([k, v]) => `JSONExtractString(properties, '${k}') = ${this.formatValue(v)}`)
            .join(' AND ')
        : '1=1'

      return `
        countIf(type = '${step.event}' AND ${filterConditions}) as step_${i}
      `
    })

    const sql = `
      SELECT
        visitorId,
        ${conditions.join(',\n        ')}
      FROM events
      WHERE timestamp BETWEEN ${period.start.getTime()} AND ${period.end.getTime()}
      GROUP BY visitorId
    `

    const result = await this.query<Record<string, number>>(sql)

    // Calculate funnel metrics
    const stepCounts = steps.map((_, i) =>
      result.data.filter(row => (row[`step_${i}`] ?? 0) > 0).length
    )

    const firstStepCount = stepCounts[0] ?? 0
    const lastStepCount = stepCounts[stepCounts.length - 1] ?? 0

    return {
      steps: steps.map((step, i) => {
        const currentCount = stepCounts[i] ?? 0
        const prevCount = i > 0 ? (stepCounts[i - 1] ?? 1) : 1
        return {
          name: step.name,
          count: currentCount,
          conversionRate: i === 0 ? 1 : currentCount / (prevCount || 1),
          dropoffRate: i === 0 ? 0 : 1 - (currentCount / (prevCount || 1))
        }
      }),
      overallConversionRate: lastStepCount / (firstStepCount || 1)
    }
  }

  async retention(
    cohortEvent: string,
    returnEvent: string,
    period: DateRange,
    granularity: 'day' | 'week' | 'month' = 'week'
  ): Promise<RetentionResult> {
    const truncFunc = granularity === 'day' ? 'toDate' :
                      granularity === 'week' ? 'toStartOfWeek' : 'toStartOfMonth'

    const sql = `
      WITH cohorts AS (
        SELECT
          visitorId,
          ${truncFunc}(fromUnixTimestamp64Milli(timestamp)) as cohort_period
        FROM events
        WHERE type = '${cohortEvent}'
          AND timestamp BETWEEN ${period.start.getTime()} AND ${period.end.getTime()}
        GROUP BY visitorId, cohort_period
      ),
      returns AS (
        SELECT
          c.visitorId,
          c.cohort_period,
          ${truncFunc}(fromUnixTimestamp64Milli(e.timestamp)) as return_period
        FROM cohorts c
        JOIN events e ON c.visitorId = e.visitorId
        WHERE e.type = '${returnEvent}'
          AND e.timestamp >= c.cohort_period
      )
      SELECT
        cohort_period,
        return_period,
        count(DISTINCT visitorId) as users
      FROM returns
      GROUP BY cohort_period, return_period
      ORDER BY cohort_period, return_period
    `

    const result = await this.query<{
      cohort_period: string
      return_period: string
      users: number
    }>(sql)

    // Transform into cohort retention format
    const cohortsMap = new Map<string, Map<string, number>>()

    for (const row of result.data) {
      if (!cohortsMap.has(row.cohort_period)) {
        cohortsMap.set(row.cohort_period, new Map())
      }
      cohortsMap.get(row.cohort_period)!.set(row.return_period, row.users)
    }

    const periods = Array.from(new Set(result.data.map(r => r.return_period))).sort()
    const cohorts = Array.from(cohortsMap.entries()).map(([cohort, returns]) => {
      const size = returns.get(cohort) ?? 0
      return {
        cohort,
        size,
        retention: periods.map(p => {
          const users = returns.get(p) ?? 0
          return size > 0 ? users / size : 0
        })
      }
    })

    return { cohorts, periods }
  }

  async segment(
    property: string,
    metric: string,
    period: DateRange
  ): Promise<SegmentResult[]> {
    const sql = `
      SELECT
        JSONExtractString(properties, '${property}') as segment,
        ${metric === 'count' ? 'count()' : `sum(JSONExtractFloat(properties, '${metric}'))`} as value,
        count() as count
      FROM events
      WHERE timestamp BETWEEN ${period.start.getTime()} AND ${period.end.getTime()}
        AND JSONHas(properties, '${property}')
      GROUP BY segment
      ORDER BY value DESC
    `

    const result = await this.query<SegmentResult>(sql)
    return result.data
  }

  // ===========================================================================
  // SaaS Metrics
  // ===========================================================================

  async calculateSaaSMetrics(period: MetricPeriod): Promise<SaaSMetrics> {
    // Get subscription events
    const mrrResult = await this.query<{
      type: string
      mrr: number
    }>(`
      SELECT
        type,
        sum(JSONExtractFloat(properties, 'mrr')) as mrr
      FROM events
      WHERE timestamp BETWEEN ${period.start.getTime()} AND ${period.end.getTime()}
        AND type IN ('subscription.created', 'subscription.upgraded', 'subscription.downgraded', 'subscription.cancelled')
      GROUP BY type
    `)

    const mrrByType = new Map(mrrResult.data.map(r => [r.type, r.mrr]))

    const newMRR = mrrByType.get('subscription.created') ?? 0
    const expansionMRR = mrrByType.get('subscription.upgraded') ?? 0
    const contractionMRR = mrrByType.get('subscription.downgraded') ?? 0
    const churnedMRR = mrrByType.get('subscription.cancelled') ?? 0

    // Get beginning MRR (from previous period or stored value)
    const beginningMRR = await this.getStoredMRR(period.start)
    const currentMRR = beginningMRR + newMRR + expansionMRR - contractionMRR - churnedMRR
    const netNewMRR = newMRR + expansionMRR - contractionMRR - churnedMRR

    const mrr: SaaSMetrics['mrr'] = {
      current: currentMRR,
      new: newMRR,
      expansion: expansionMRR,
      contraction: contractionMRR,
      churned: churnedMRR,
      netNew: netNewMRR,
      beginning: beginningMRR,
      growthRate: beginningMRR > 0 ? netNewMRR / beginningMRR : 0
    }

    // Churn metrics
    const churnResult = await this.query<{
      churnedCustomers: number
      totalCustomers: number
    }>(`
      SELECT
        countIf(type = 'subscription.cancelled') as churnedCustomers,
        count(DISTINCT JSONExtractString(properties, 'customerId')) as totalCustomers
      FROM events
      WHERE timestamp BETWEEN ${period.start.getTime()} AND ${period.end.getTime()}
        AND type LIKE 'subscription.%'
    `)

    const churnData = churnResult.data[0] ?? { churnedCustomers: 0, totalCustomers: 0 }

    const churn: SaaSMetrics['churn'] = {
      customerChurnRate: churnData.totalCustomers > 0
        ? churnData.churnedCustomers / churnData.totalCustomers
        : 0,
      revenueChurnRate: beginningMRR > 0 ? churnedMRR / beginningMRR : 0,
      netRevenueChurn: beginningMRR > 0
        ? (churnedMRR + contractionMRR - expansionMRR) / beginningMRR
        : 0,
      churnedCustomers: churnData.churnedCustomers,
      churnedRevenue: churnedMRR
    }

    // LTV metrics (simplified)
    const avgMRR = currentMRR / Math.max(churnData.totalCustomers, 1)
    const monthlyChurnRate = churn.customerChurnRate
    const avgLifetimeMonths = monthlyChurnRate > 0 ? 1 / monthlyChurnRate : 24 // Default to 24 months

    const ltv: SaaSMetrics['ltv'] = {
      average: avgMRR * avgLifetimeMonths
    }

    const result: SaaSMetrics = {
      mrr,
      arr: currentMRR * 12,
      churn,
      ltv,
      nrr: beginningMRR > 0
        ? (beginningMRR + expansionMRR - contractionMRR - churnedMRR) / beginningMRR
        : 1,
      grr: beginningMRR > 0
        ? (beginningMRR - contractionMRR - churnedMRR) / beginningMRR
        : 1
    }

    if ((churnedMRR + contractionMRR) > 0) {
      result.quickRatio = (newMRR + expansionMRR) / (churnedMRR + contractionMRR)
    }

    return result
  }

  async getCurrentMRR(): Promise<number> {
    const result = await this.query<{ mrr: number }>(`
      SELECT sum(JSONExtractFloat(properties, 'mrr')) as mrr
      FROM events
      WHERE type = 'subscription.active'
      ORDER BY timestamp DESC
      LIMIT 1
    `)

    return result.data[0]?.mrr ?? 0
  }

  async getMRRHistory(period: DateRange): Promise<Array<{ date: string; mrr: number }>> {
    const result = await this.query<{ date: string; mrr: number }>(`
      SELECT
        toDate(fromUnixTimestamp64Milli(timestamp)) as date,
        sum(JSONExtractFloat(properties, 'mrr')) as mrr
      FROM events
      WHERE type = 'subscription.snapshot'
        AND timestamp BETWEEN ${period.start.getTime()} AND ${period.end.getTime()}
      GROUP BY date
      ORDER BY date
    `)

    return result.data
  }

  // ===========================================================================
  // Web Analytics
  // ===========================================================================

  async getWebAnalytics(period: DateRange): Promise<WebAnalyticsMetrics> {
    const result = await this.query<{
      pageViews: number
      uniqueVisitors: number
      sessions: number
      avgSessionDuration: number
      bounceRate: number
      pagesPerSession: number
    }>(`
      WITH session_data AS (
        SELECT
          sessionId,
          count() as pages,
          max(timestamp) - min(timestamp) as duration
        FROM events
        WHERE type = 'page_view'
          AND timestamp BETWEEN ${period.start.getTime()} AND ${period.end.getTime()}
        GROUP BY sessionId
      )
      SELECT
        count() as pageViews,
        count(DISTINCT visitorId) as uniqueVisitors,
        count(DISTINCT sessionId) as sessions,
        avg(duration) / 1000 as avgSessionDuration,
        countIf(pages = 1) / count() as bounceRate,
        avg(pages) as pagesPerSession
      FROM events e
      LEFT JOIN session_data s ON e.sessionId = s.sessionId
      WHERE e.type = 'page_view'
        AND e.timestamp BETWEEN ${period.start.getTime()} AND ${period.end.getTime()}
    `)

    const topPages = await this.query<{ path: string; views: number; uniqueVisitors: number }>(`
      SELECT
        JSONExtractString(properties, 'path') as path,
        count() as views,
        count(DISTINCT visitorId) as uniqueVisitors
      FROM events
      WHERE type = 'page_view'
        AND timestamp BETWEEN ${period.start.getTime()} AND ${period.end.getTime()}
      GROUP BY path
      ORDER BY views DESC
      LIMIT 10
    `)

    const topReferrers = await this.query<{ referrer: string; visits: number }>(`
      SELECT
        JSONExtractString(properties, 'referrer') as referrer,
        count() as visits
      FROM events
      WHERE type = 'page_view'
        AND timestamp BETWEEN ${period.start.getTime()} AND ${period.end.getTime()}
        AND referrer != ''
      GROUP BY referrer
      ORDER BY visits DESC
      LIMIT 10
    `)

    const devices = await this.query<{ deviceType: string; count: number }>(`
      SELECT
        if(JSONExtractBool(device, 'mobile'), 'mobile',
           if(JSONExtractString(device, 'platform') LIKE '%tablet%', 'tablet', 'desktop')) as deviceType,
        count() as count
      FROM events
      WHERE type = 'page_view'
        AND timestamp BETWEEN ${period.start.getTime()} AND ${period.end.getTime()}
      GROUP BY deviceType
    `)

    const countries = await this.query<{ country: string; visitors: number }>(`
      SELECT
        JSONExtractString(geo, 'country') as country,
        count(DISTINCT visitorId) as visitors
      FROM events
      WHERE type = 'page_view'
        AND timestamp BETWEEN ${period.start.getTime()} AND ${period.end.getTime()}
      GROUP BY country
      ORDER BY visitors DESC
      LIMIT 10
    `)

    const deviceMap = new Map(devices.data.map(d => [d.deviceType, d.count]))
    const baseData = result.data[0]

    return {
      pageViews: baseData?.pageViews ?? 0,
      uniqueVisitors: baseData?.uniqueVisitors ?? 0,
      sessions: baseData?.sessions ?? 0,
      avgSessionDuration: baseData?.avgSessionDuration ?? 0,
      bounceRate: baseData?.bounceRate ?? 0,
      pagesPerSession: baseData?.pagesPerSession ?? 0,
      topPages: topPages.data,
      topReferrers: topReferrers.data,
      devices: {
        desktop: deviceMap.get('desktop') ?? 0,
        mobile: deviceMap.get('mobile') ?? 0,
        tablet: deviceMap.get('tablet') ?? 0
      },
      countries: countries.data
    }
  }

  async getRealTimeVisitors(minutes: number = 5): Promise<number> {
    const since = Date.now() - minutes * 60 * 1000
    const result = await this.query<{ count: number }>(`
      SELECT count(DISTINCT visitorId) as count
      FROM events
      WHERE type = 'page_view'
        AND timestamp >= ${since}
    `)

    return result.data[0]?.count ?? 0
  }

  // ===========================================================================
  // Product Analytics
  // ===========================================================================

  async getProductAnalytics(productId: string, period: DateRange): Promise<ProductAnalytics> {
    const overview = await this.query<{
      totalEvents: number
      uniqueUsers: number
      conversions: number
      revenue: number
    }>(`
      SELECT
        count() as totalEvents,
        count(DISTINCT visitorId) as uniqueUsers,
        countIf(type = 'product.purchased') as conversions,
        sumIf(JSONExtractFloat(properties, 'value'), type = 'product.purchased') as revenue
      FROM events
      WHERE JSONExtractString(properties, 'productId') = '${productId}'
        AND timestamp BETWEEN ${period.start.getTime()} AND ${period.end.getTime()}
    `)

    const daily = await this.query<{
      date: string
      events: number
      uniqueUsers: number
      conversions: number
      revenue: number
    }>(`
      SELECT
        toDate(fromUnixTimestamp64Milli(timestamp)) as date,
        count() as events,
        count(DISTINCT visitorId) as uniqueUsers,
        countIf(type = 'product.purchased') as conversions,
        sumIf(JSONExtractFloat(properties, 'value'), type = 'product.purchased') as revenue
      FROM events
      WHERE JSONExtractString(properties, 'productId') = '${productId}'
        AND timestamp BETWEEN ${period.start.getTime()} AND ${period.end.getTime()}
      GROUP BY date
      ORDER BY date
    `)

    const data = overview.data[0] ?? { totalEvents: 0, uniqueUsers: 0, conversions: 0, revenue: 0 }

    return {
      productId,
      period,
      ...data,
      conversionRate: data.uniqueUsers > 0 ? data.conversions / data.uniqueUsers : 0,
      daily: daily.data
    }
  }

  // ===========================================================================
  // Experiments
  // ===========================================================================

  async getExperimentResults(experimentKey: string): Promise<ExperimentResults> {
    // Get experiment config from storage
    const experiment = await this.storage.get<Experiment>(`experiment:${experimentKey}`)
    if (!experiment) {
      throw new Error(`Experiment '${experimentKey}' not found`)
    }

    const result = await this.query<{
      variantKey: string
      participants: number
      conversions: number
    }>(`
      WITH assignments AS (
        SELECT
          visitorId,
          JSONExtractString(properties, 'variantKey') as variantKey
        FROM events
        WHERE type = 'experiment.assigned'
          AND JSONExtractString(properties, 'experimentKey') = '${experimentKey}'
      ),
      conversions AS (
        SELECT visitorId
        FROM events
        WHERE type = '${experiment.targetMetric}'
      )
      SELECT
        a.variantKey,
        count(DISTINCT a.visitorId) as participants,
        count(DISTINCT c.visitorId) as conversions
      FROM assignments a
      LEFT JOIN conversions c ON a.visitorId = c.visitorId
      GROUP BY a.variantKey
    `)

    const controlVariant = experiment.variants.find(v => v.isControl)
    const controlData = result.data.find(r => r.variantKey === controlVariant?.key)
    const controlRate = controlData && controlData.participants > 0
      ? controlData.conversions / controlData.participants
      : 0

    const variants = experiment.variants.map(variant => {
      const data = result.data.find(r => r.variantKey === variant.key)
      const participants = data?.participants ?? 0
      const conversions = data?.conversions ?? 0
      const conversionRate = participants > 0 ? conversions / participants : 0

      const variantResult: ExperimentResults['variants'][number] = {
        variant,
        participants,
        conversions,
        conversionRate
      }

      const improvement = controlRate > 0 ? (conversionRate - controlRate) / controlRate : undefined
      if (improvement !== undefined) {
        variantResult.improvement = improvement
      }

      const pValue = this.calculatePValue(controlData, data)
      if (pValue !== undefined) {
        variantResult.pValue = pValue
      }

      const confidenceInterval = this.calculateCI(conversionRate, participants)
      if (confidenceInterval !== undefined) {
        variantResult.confidenceInterval = confidenceInterval
      }

      return variantResult
    })

    // Determine significance and winner
    const significantVariants = variants.filter(
      v => !v.variant.isControl && v.pValue !== undefined && v.pValue < 0.05
    )
    const winnerKey = significantVariants.length > 0
      ? significantVariants.reduce((best, v) =>
          (v.improvement ?? 0) > (best.improvement ?? 0) ? v : best
        ).variant.key
      : undefined

    const experimentResults: ExperimentResults = {
      experiment,
      variants,
      isSignificant: significantVariants.length > 0
    }
    if (winnerKey !== undefined) {
      experimentResults.winner = winnerKey
    }
    return experimentResults
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  async flush(): Promise<void> {
    await this.flushEventBuffer()
  }

  clearCache(): void {
    this.cache.clear()
  }

  getMemoryStats(): MemoryStats {
    const eventBufferSize = this.eventBuffer.length * 200 // Estimate 200 bytes per event
    const cacheSize = Array.from(this.cache.values())
      .reduce((sum, entry) => sum + JSON.stringify(entry.data).length, 0)

    return {
      wasmHeap: this.wasmModule?.getMemoryUsage() ?? 0,
      cache: cacheSize,
      writeBuffer: eventBufferSize,
      total: (this.wasmModule?.getMemoryUsage() ?? 0) + cacheSize + eventBufferSize
    }
  }

  async dispose(): Promise<void> {
    await this.flushEventBuffer()

    if (this.wasmModule) {
      this.wasmModule.dispose()
      this.wasmModule = null
    }

    this.cache.clear()
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  private async ensureSchema(): Promise<void> {
    // Initialize events table schema
    // This uses DO SQLite for hot data storage
    await this.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        visitorId TEXT,
        sessionId TEXT,
        properties TEXT NOT NULL,
        device TEXT,
        geo TEXT
      )
    `)

    await this.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type)
    `)

    await this.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp)
    `)

    await this.storage.sql.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_visitor ON events(visitorId)
    `)
  }

  private async ensureWasmModule(): Promise<ChdbWasmModule> {
    if (!this.wasmModule) {
      // Lazy load the WASM module
      this.wasmModule = await loadChdbModule(this.config.profile)
    }
    return this.wasmModule
  }

  private async flushEventBuffer(): Promise<void> {
    if (this.eventBuffer.length === 0) return

    const events = this.eventBuffer.splice(0)

    // Insert into DO SQLite (hot storage)
    for (const event of events) {
      this.storage.sql.exec(`
        INSERT INTO events (id, type, timestamp, visitorId, sessionId, properties, device, geo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
        crypto.randomUUID(),
        event.type,
        event.timestamp,
        event.visitorId ?? null,
        event.sessionId ?? null,
        JSON.stringify(event.properties),
        event.device ? JSON.stringify(event.device) : null,
        event.geo ? JSON.stringify(event.geo) : null
      )
    }

    // TODO: Also write to R2 for cold storage if R2 is configured
    if (this.config.r2) {
      // Batch write to R2 as Parquet or MergeTree parts
    }
  }

  private async getStoredMRR(asOf: Date): Promise<number> {
    // Get the most recent MRR snapshot before the given date
    const result = await this.storage.sql.exec(`
      SELECT properties FROM events
      WHERE type = 'mrr.snapshot'
        AND timestamp < ?
      ORDER BY timestamp DESC
      LIMIT 1
    `, asOf.getTime())

    const row = result.one() as { properties: string } | null
    if (row) {
      const props = JSON.parse(row.properties)
      return props.mrr ?? 0
    }

    return 0
  }

  private generateVisitorId(): string {
    // Generate a privacy-safe visitor ID
    // In production, this would use a fingerprinting technique
    return crypto.randomUUID()
  }

  private formatValue(value: unknown): string {
    if (typeof value === 'string') {
      return `'${value.replace(/'/g, "''")}'`
    }
    if (typeof value === 'number') {
      return String(value)
    }
    if (typeof value === 'boolean') {
      return value ? '1' : '0'
    }
    if (value instanceof Date) {
      return `toDateTime64(${value.getTime()}, 3)`
    }
    if (value === null || value === undefined) {
      return 'NULL'
    }
    return `'${JSON.stringify(value).replace(/'/g, "''")}'`
  }

  private calculatePValue(
    control: { participants: number; conversions: number } | undefined,
    variant: { participants: number; conversions: number } | undefined
  ): number | undefined {
    if (!control || !variant || control.participants === 0 || variant.participants === 0) {
      return undefined
    }

    // Two-proportion z-test (simplified)
    const p1 = control.conversions / control.participants
    const p2 = variant.conversions / variant.participants
    const p = (control.conversions + variant.conversions) /
              (control.participants + variant.participants)

    const se = Math.sqrt(p * (1 - p) * (1 / control.participants + 1 / variant.participants))

    if (se === 0) return undefined

    const z = Math.abs(p2 - p1) / se

    // Approximate p-value from z-score (two-tailed)
    return 2 * (1 - this.normalCDF(z))
  }

  private normalCDF(x: number): number {
    // Approximation of the standard normal CDF
    const a1 = 0.254829592
    const a2 = -0.284496736
    const a3 = 1.421413741
    const a4 = -1.453152027
    const a5 = 1.061405429
    const p = 0.3275911

    const sign = x < 0 ? -1 : 1
    x = Math.abs(x) / Math.sqrt(2)

    const t = 1.0 / (1.0 + p * x)
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)

    return 0.5 * (1.0 + sign * y)
  }

  private calculateCI(rate: number, n: number): [number, number] | undefined {
    if (n === 0) return undefined

    // Wilson score interval
    const z = 1.96 // 95% confidence
    const denominator = 1 + z * z / n
    const centre = (rate + z * z / (2 * n)) / denominator
    const interval = (z / denominator) * Math.sqrt(rate * (1 - rate) / n + z * z / (4 * n * n))

    return [
      Math.max(0, centre - interval),
      Math.min(1, centre + interval)
    ]
  }
}

// =============================================================================
// WASM Module Types (interface for chdb)
// =============================================================================

interface ChdbWasmModule {
  execute(sql: string, options?: { format?: string; maxRows?: number }): Promise<{
    data: unknown[]
    meta: Array<{ name: string; type: string }>
    rows: number
    statistics?: {
      rowsRead?: number
      bytesRead?: number
      memoryUsage?: number
    }
    extensions?: string[]
  }>

  executeStream(sql: string, options?: { format?: string; maxRows?: number }): AsyncIterable<unknown>

  getMemoryUsage(): number

  dispose(): void
}

/**
 * Load the chdb WASM module
 *
 * This is a placeholder - the actual implementation would load from
 * the @dotdo/clickhouse-wasm package or from a WASM asset.
 */
async function loadChdbModule(_profile: BuildProfile): Promise<ChdbWasmModule> {
  // In production, this would:
  // 1. Check if module is already loaded
  // 2. Fetch the appropriate WASM file based on profile
  // 3. Instantiate with VFS bridge
  // 4. Return the module instance

  // For now, return a stub that throws
  throw new Error(
    'chdb WASM module not yet bundled. ' +
    'Install @dotdo/clickhouse-wasm or configure WASM asset path.'
  )
}
