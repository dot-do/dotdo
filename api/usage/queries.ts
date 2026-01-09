/**
 * Usage Analytics Query Client
 *
 * Provides SQL queries for R2/Analytics Engine usage data with support for:
 * - Summary statistics (total requests, cost, latency percentiles)
 * - Timeline data with configurable bucket sizes
 * - Top endpoints by usage
 * - Per-API-key usage breakdown
 * - Raw event access with filters
 *
 * @module api/usage/queries
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Time range for queries
 */
export interface TimeRange {
  start: Date
  end: Date
}

/**
 * Usage summary statistics
 */
export interface UsageSummary {
  /** Total number of requests */
  totalRequests: number
  /** Total cost units consumed */
  totalCost: number
  /** Average latency in milliseconds */
  avgLatencyMs: number
  /** P50 latency */
  p50LatencyMs: number
  /** P95 latency */
  p95LatencyMs: number
  /** P99 latency */
  p99LatencyMs: number
  /** Total error count (4xx + 5xx) */
  errorCount: number
  /** Error rate percentage */
  errorRate: number
  /** Success rate percentage */
  successRate: number
}

/**
 * Usage by time bucket
 */
export interface TimelineDataPoint {
  /** Bucket timestamp (start of period) */
  timestamp: Date
  /** Request count in this bucket */
  requests: number
  /** Cost in this bucket */
  cost: number
  /** Average latency in this bucket */
  avgLatencyMs: number
  /** Error count in this bucket */
  errors: number
}

/**
 * Endpoint usage statistics
 */
export interface EndpointUsage {
  /** Endpoint path */
  endpoint: string
  /** HTTP method */
  method: string
  /** Request count */
  requests: number
  /** Total cost */
  cost: number
  /** Average latency */
  avgLatencyMs: number
  /** Error count */
  errors: number
  /** Error rate percentage */
  errorRate: number
}

/**
 * API key usage statistics
 */
export interface ApiKeyUsage {
  /** API key ID */
  apiKeyId: string
  /** Request count */
  requests: number
  /** Total cost */
  cost: number
  /** Average latency */
  avgLatencyMs: number
  /** Most used endpoint */
  topEndpoint: string
  /** Error count */
  errors: number
}

/**
 * Query options
 */
export interface QueryOptions {
  /** Time range for the query */
  range: TimeRange
  /** Filter by API key ID */
  apiKeyId?: string
  /** Filter by user ID */
  userId?: string
  /** Filter by endpoint pattern */
  endpoint?: string
  /** Filter by HTTP method */
  method?: string
  /** Filter by status code range */
  statusCodes?: number[]
  /** Limit results */
  limit?: number
  /** Offset for pagination */
  offset?: number
}

/**
 * Timeline query options
 */
export interface TimelineQueryOptions extends QueryOptions {
  bucketSize: 'minute' | 'hour' | 'day'
}

/**
 * Raw usage event
 */
export interface RawEvent {
  id: string
  timestamp: string
  endpoint: string
  method: string
  statusCode: number
  latencyMs: number
  cost: number
  apiKeyId?: string
  userId?: string
}

/**
 * Analytics binding interface (R2 SQL API compatible)
 */
export interface AnalyticsBinding {
  query(sql: string, params?: unknown[]): Promise<{
    rows: Record<string, unknown>[]
    meta?: { rowCount: number; duration: number }
  }>
}

/**
 * Analytics query client interface
 */
export interface UsageQueryClient {
  /** Get summary statistics */
  getSummary(options: QueryOptions): Promise<UsageSummary>
  /** Get timeline data with configurable bucket size */
  getTimeline(options: TimelineQueryOptions): Promise<TimelineDataPoint[]>
  /** Get top endpoints by requests */
  getTopEndpoints(options: QueryOptions): Promise<EndpointUsage[]>
  /** Get usage by API key */
  getApiKeyUsage(options: QueryOptions): Promise<ApiKeyUsage[]>
  /** Get raw events for debugging */
  getRawEvents(options: QueryOptions): Promise<RawEvent[]>
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Validate time range
 */
function validateTimeRange(range: TimeRange): void {
  if (range.end < range.start) {
    throw new Error('Invalid time range: end must be after start')
  }
}

/**
 * Build WHERE clause for common filters
 */
function buildWhereClause(options: QueryOptions): { clause: string; params: unknown[] } {
  const conditions: string[] = []
  const params: unknown[] = []

  // Time range filter
  conditions.push('timestamp >= ?')
  params.push(options.range.start.toISOString())

  conditions.push('timestamp <= ?')
  params.push(options.range.end.toISOString())

  // API key filter
  if (options.apiKeyId) {
    conditions.push('api_key_id = ?')
    params.push(options.apiKeyId)
  }

  // User ID filter
  if (options.userId) {
    conditions.push('user_id = ?')
    params.push(options.userId)
  }

  // Endpoint filter
  if (options.endpoint) {
    conditions.push('endpoint LIKE ?')
    params.push(`%${options.endpoint}%`)
  }

  // Method filter
  if (options.method) {
    conditions.push('method = ?')
    params.push(options.method)
  }

  // Status code filter
  if (options.statusCodes && options.statusCodes.length > 0) {
    const placeholders = options.statusCodes.map(() => '?').join(', ')
    conditions.push(`status_code IN (${placeholders})`)
    params.push(...options.statusCodes)
  }

  return {
    clause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  }
}

/**
 * Get bucket expression for timeline queries
 */
function getBucketExpression(bucketSize: 'minute' | 'hour' | 'day'): string {
  switch (bucketSize) {
    case 'minute':
      return "strftime('%Y-%m-%d %H:%M', timestamp)"
    case 'hour':
      return "strftime('%Y-%m-%d %H:00', timestamp)"
    case 'day':
      return "strftime('%Y-%m-%d', timestamp)"
    default:
      return "strftime('%Y-%m-%d %H:00', timestamp)"
  }
}

/**
 * Create a UsageQueryClient from an analytics binding
 */
export function createQueryClient(binding: AnalyticsBinding): UsageQueryClient {
  return {
    async getSummary(options: QueryOptions): Promise<UsageSummary> {
      validateTimeRange(options.range)

      const { clause, params } = buildWhereClause(options)

      // Handle same start and end time
      if (options.range.start.getTime() === options.range.end.getTime()) {
        return {
          totalRequests: 0,
          totalCost: 0,
          avgLatencyMs: 0,
          p50LatencyMs: 0,
          p95LatencyMs: 0,
          p99LatencyMs: 0,
          errorCount: 0,
          errorRate: 0,
          successRate: 100,
        }
      }

      const sql = `
        SELECT
          COUNT(*) as total_requests,
          SUM(cost) as total_cost,
          AVG(latency_ms) as avg_latency_ms,
          PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY latency_ms) as p50_latency_ms,
          PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) as p95_latency_ms,
          PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_ms) as p99_latency_ms,
          SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as error_count
        FROM usage_events
        ${clause}
      `

      const result = await binding.query(sql, params)
      const row = result.rows[0] || {}

      const totalRequests = Number(row.total_requests) || 0
      const errorCount = Number(row.error_count) || 0
      const errorRate = totalRequests > 0 ? (errorCount / totalRequests) * 100 : 0
      const successRate = totalRequests > 0 ? ((totalRequests - errorCount) / totalRequests) * 100 : 100

      return {
        totalRequests,
        totalCost: Number(row.total_cost) || 0,
        avgLatencyMs: Number(row.avg_latency_ms) || 0,
        p50LatencyMs: Number(row.p50_latency_ms) || 0,
        p95LatencyMs: Number(row.p95_latency_ms) || 0,
        p99LatencyMs: Number(row.p99_latency_ms) || 0,
        errorCount,
        errorRate,
        successRate,
      }
    },

    async getTimeline(options: TimelineQueryOptions): Promise<TimelineDataPoint[]> {
      validateTimeRange(options.range)

      const { clause, params } = buildWhereClause(options)
      const bucketExpr = getBucketExpression(options.bucketSize)

      const sql = `
        SELECT
          ${bucketExpr} as timestamp,
          COUNT(*) as requests,
          SUM(cost) as cost,
          AVG(latency_ms) as avg_latency_ms,
          SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as errors
        FROM usage_events
        ${clause}
        GROUP BY ${bucketExpr}
        ORDER BY timestamp ASC
      `

      const result = await binding.query(sql, params)

      return result.rows.map((row) => ({
        timestamp: new Date(row.timestamp as string),
        requests: Number(row.requests) || 0,
        cost: Number(row.cost) || 0,
        avgLatencyMs: Number(row.avg_latency_ms) || 0,
        errors: Number(row.errors) || 0,
      }))
    },

    async getTopEndpoints(options: QueryOptions): Promise<EndpointUsage[]> {
      validateTimeRange(options.range)

      const { clause, params } = buildWhereClause(options)
      const limit = options.limit || 100
      const offset = options.offset || 0

      const sql = `
        SELECT
          endpoint,
          method,
          COUNT(*) as requests,
          SUM(cost) as cost,
          AVG(latency_ms) as avg_latency_ms,
          SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as errors
        FROM usage_events
        ${clause}
        GROUP BY endpoint, method
        ORDER BY requests DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `

      const result = await binding.query(sql, params)

      return result.rows.map((row) => {
        const requests = Number(row.requests) || 0
        const errors = Number(row.errors) || 0
        const errorRate = requests > 0 ? (errors / requests) * 100 : 0

        return {
          endpoint: row.endpoint as string,
          method: row.method as string,
          requests,
          cost: Number(row.cost) || 0,
          avgLatencyMs: Number(row.avg_latency_ms) || 0,
          errors,
          errorRate,
        }
      })
    },

    async getApiKeyUsage(options: QueryOptions): Promise<ApiKeyUsage[]> {
      validateTimeRange(options.range)

      const { clause, params } = buildWhereClause(options)
      const limit = options.limit || 100
      const offset = options.offset || 0

      const sql = `
        SELECT
          api_key_id,
          COUNT(*) as requests,
          SUM(cost) as cost,
          AVG(latency_ms) as avg_latency_ms,
          MAX(top_endpoint) as top_endpoint,
          SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as errors
        FROM usage_events
        ${clause}
        GROUP BY api_key_id
        ORDER BY cost DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `

      const result = await binding.query(sql, params)

      return result.rows.map((row) => ({
        apiKeyId: row.api_key_id as string,
        requests: Number(row.requests) || 0,
        cost: Number(row.cost) || 0,
        avgLatencyMs: Number(row.avg_latency_ms) || 0,
        topEndpoint: (row.top_endpoint as string) || '',
        errors: Number(row.errors) || 0,
      }))
    },

    async getRawEvents(options: QueryOptions): Promise<RawEvent[]> {
      validateTimeRange(options.range)

      const { clause, params } = buildWhereClause(options)
      const limit = options.limit || 100
      const offset = options.offset || 0

      const sql = `
        SELECT
          id,
          timestamp,
          endpoint,
          method,
          status_code,
          latency_ms,
          cost,
          api_key_id,
          user_id
        FROM usage_events
        ${clause}
        ORDER BY timestamp DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `

      const result = await binding.query(sql, params)

      return result.rows.map((row) => ({
        id: row.id as string,
        timestamp: row.timestamp as string,
        endpoint: row.endpoint as string,
        method: row.method as string,
        statusCode: Number(row.status_code) || 0,
        latencyMs: Number(row.latency_ms) || 0,
        cost: Number(row.cost) || 0,
        apiKeyId: row.api_key_id as string | undefined,
        userId: row.user_id as string | undefined,
      }))
    },
  }
}
