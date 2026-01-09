/**
 * Admin Dashboard API Routes
 *
 * Provides admin-only endpoints for viewing usage analytics:
 * - GET /usage - Overview statistics
 * - GET /usage/keys - Per-API-key usage
 * - GET /usage/keys/:keyId - Single key detail
 * - GET /usage/endpoints - Per-endpoint usage
 * - GET /usage/export - Export to CSV
 * - GET /usage/keys/export - Export keys to CSV
 * - GET /usage/endpoints/export - Export endpoints to CSV
 *
 * All routes require admin authentication.
 *
 * @module api/routes/admin
 */

import { Hono } from 'hono'
import { createQueryClient, type TimeRange, type QueryOptions, type TimelineQueryOptions } from '../usage/queries'

// ============================================================================
// Types
// ============================================================================

interface AdminEnv {
  ANALYTICS?: {
    query(sql: string, params?: unknown[]): Promise<{
      rows: Record<string, unknown>[]
      meta?: { rowCount: number; duration: number }
    }>
  }
  KV?: {
    get(key: string, options?: { type?: 'json' | 'text' }): Promise<unknown>
    list(options?: { prefix?: string }): Promise<{ keys: { name: string }[] }>
  }
  API_KEYS?: string
}

interface AdminVariables {
  auth?: {
    userId: string
    role: 'admin' | 'user'
    apiKeyId?: string
  }
}

interface ApiKeyConfig {
  userId?: string
  role: string
  name?: string
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Parse range shorthand (e.g., "7d", "30d", "24h")
 */
function parseRangeShorthand(range: string): TimeRange | null {
  const match = range.match(/^(\d+)(h|d)$/)
  if (!match) return null

  const value = parseInt(match[1], 10)
  const unit = match[2]

  const now = new Date()
  const start = new Date(now)

  if (unit === 'h') {
    start.setHours(start.getHours() - value)
  } else if (unit === 'd') {
    start.setDate(start.getDate() - value)
  }

  return { start, end: now }
}

/**
 * Parse date range from query parameters
 */
function parseTimeRange(
  rangeParam?: string,
  startParam?: string,
  endParam?: string
): { range: TimeRange | null; error: string | null } {
  const now = new Date()

  // If shorthand range is provided
  if (rangeParam) {
    const range = parseRangeShorthand(rangeParam)
    if (!range) {
      return { range: null, error: `Invalid range parameter: ${rangeParam}. Use format like 7d, 30d, 24h` }
    }
    return { range, error: null }
  }

  // If custom start/end are provided
  if (startParam || endParam) {
    let start: Date
    let end: Date

    try {
      start = startParam ? new Date(startParam) : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      if (isNaN(start.getTime())) {
        return { range: null, error: 'Invalid start date format' }
      }
    } catch {
      return { range: null, error: 'Invalid start date format' }
    }

    try {
      end = endParam ? new Date(endParam) : now
      if (isNaN(end.getTime())) {
        return { range: null, error: 'Invalid end date format' }
      }
    } catch {
      return { range: null, error: 'Invalid end date format' }
    }

    // Validate end is not before start
    if (end < start) {
      return { range: null, error: 'End date must be after start date' }
    }

    // Validate dates are not in the future
    if (start > now || end > now) {
      return { range: null, error: 'Date range cannot be in the future' }
    }

    return { range: { start, end }, error: null }
  }

  // Default to last 7 days
  return {
    range: {
      start: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
      end: now,
    },
    error: null,
  }
}

/**
 * Get bucket size based on time range
 */
function getBucketSizeForRange(range: TimeRange): 'minute' | 'hour' | 'day' {
  const durationMs = range.end.getTime() - range.start.getTime()
  const hours = durationMs / (1000 * 60 * 60)

  if (hours <= 24) {
    return 'hour'
  } else if (hours <= 24 * 7) {
    return 'hour'
  } else {
    return 'day'
  }
}

/**
 * Parse pagination parameters
 */
function parsePagination(
  limitParam?: string,
  offsetParam?: string
): { limit: number; offset: number; error: string | null } {
  let limit = 100
  let offset = 0

  if (limitParam) {
    limit = parseInt(limitParam, 10)
    if (isNaN(limit)) {
      return { limit: 0, offset: 0, error: 'Invalid limit parameter' }
    }
    if (limit < 0) {
      return { limit: 0, offset: 0, error: 'Limit must be non-negative' }
    }
    if (limit > 10000) {
      return { limit: 0, offset: 0, error: 'Limit cannot exceed 10000' }
    }
  }

  if (offsetParam) {
    offset = parseInt(offsetParam, 10)
    if (isNaN(offset)) {
      return { limit: 0, offset: 0, error: 'Invalid offset parameter' }
    }
    if (offset < 0) {
      return { limit: 0, offset: 0, error: 'Offset must be non-negative' }
    }
  }

  return { limit, offset, error: null }
}

/**
 * Parse sort parameter
 */
function parseSort(sortParam?: string, validValues: string[] = ['cost', 'requests', 'latency']): { sort: string; error: string | null } {
  if (!sortParam) {
    return { sort: validValues[0], error: null }
  }

  if (!validValues.includes(sortParam)) {
    return { sort: '', error: `Invalid sort parameter. Must be one of: ${validValues.join(', ')}` }
  }

  return { sort: sortParam, error: null }
}

/**
 * Get API key metadata from config
 */
function getApiKeyConfig(env: AdminEnv): Record<string, ApiKeyConfig> {
  if (!env.API_KEYS) return {}
  try {
    return JSON.parse(env.API_KEYS)
  } catch {
    return {}
  }
}

/**
 * Convert data to CSV format
 */
function toCSV(data: Record<string, unknown>[], columns: string[]): string {
  const header = columns.join(',')
  const rows = data.map((row) =>
    columns.map((col) => {
      const value = row[col]
      if (value === null || value === undefined) return ''
      if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
        return `"${value.replace(/"/g, '""')}"`
      }
      return String(value)
    }).join(',')
  )
  return [header, ...rows].join('\n')
}

// ============================================================================
// Router Factory
// ============================================================================

/**
 * Create the admin router with usage analytics endpoints
 */
export function createAdminRouter(): Hono<{ Bindings: AdminEnv; Variables: AdminVariables }> {
  const router = new Hono<{ Bindings: AdminEnv; Variables: AdminVariables }>()

  // ============================================================================
  // Authentication & Authorization Middleware
  // ============================================================================

  router.use('/usage/*', async (c, next) => {
    const auth = c.get('auth')

    if (!auth) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401)
    }

    if (auth.role !== 'admin') {
      return c.json({ error: { code: 'FORBIDDEN', message: 'Admin access required' } }, 403)
    }

    await next()
  })

  // Also protect the root /usage endpoint
  router.use('/usage', async (c, next) => {
    const auth = c.get('auth')

    if (!auth) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401)
    }

    if (auth.role !== 'admin') {
      return c.json({ error: { code: 'FORBIDDEN', message: 'Admin access required' } }, 403)
    }

    await next()
  })

  // ============================================================================
  // GET /usage - Usage Overview
  // ============================================================================

  router.get('/usage', async (c) => {
    const { range: rangeParam, start, end } = c.req.query()

    // Parse time range
    const { range, error: rangeError } = parseTimeRange(rangeParam, start, end)
    if (rangeError) {
      return c.json({ error: { code: 'BAD_REQUEST', message: rangeError } }, 400)
    }

    if (!c.env.ANALYTICS) {
      return c.json({ error: { code: 'ANALYTICS_ERROR', message: 'Analytics service not available' } }, 500)
    }

    try {
      const client = createQueryClient(c.env.ANALYTICS)
      const queryOptions: QueryOptions = { range: range! }
      const bucketSize = getBucketSizeForRange(range!)

      const [summary, timeline, topEndpoints, topApiKeys] = await Promise.all([
        client.getSummary(queryOptions),
        client.getTimeline({ ...queryOptions, bucketSize }),
        client.getTopEndpoints({ ...queryOptions, limit: 10 }),
        client.getApiKeyUsage({ ...queryOptions, limit: 10 }),
      ])

      // Enrich API keys with names
      const apiKeyConfig = getApiKeyConfig(c.env)
      const enrichedApiKeys = topApiKeys.map((key) => ({
        apiKeyId: key.apiKeyId,
        name: apiKeyConfig[key.apiKeyId]?.name,
        requests: key.requests,
        cost: key.cost,
      }))

      return c.json({
        summary: {
          totalRequests: summary.totalRequests,
          totalCost: summary.totalCost,
          avgLatencyMs: summary.avgLatencyMs,
          p95LatencyMs: summary.p95LatencyMs,
          errorRate: summary.errorRate,
          successRate: summary.successRate,
        },
        timeline: timeline.map((point) => ({
          timestamp: point.timestamp.toISOString(),
          requests: point.requests,
          cost: point.cost,
          errors: point.errors,
        })),
        topEndpoints: topEndpoints.map((ep) => ({
          endpoint: ep.endpoint,
          method: ep.method,
          requests: ep.requests,
          cost: ep.cost,
        })),
        topApiKeys: enrichedApiKeys,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return c.json({ error: { code: 'ANALYTICS_ERROR', message: `Analytics query failed: ${message}` } }, 500)
    }
  })

  // ============================================================================
  // GET /usage/keys/export - Export API Keys to CSV
  // NOTE: This route MUST come before /usage/keys/:keyId to avoid being caught by the param route
  // ============================================================================

  router.get('/usage/keys/export', async (c) => {
    const { format, range: rangeParam, start, end } = c.req.query()

    // Validate format
    if (format && format !== 'csv') {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid format parameter. Only csv is supported' } }, 400)
    }

    // Parse time range
    const { range, error: rangeError } = parseTimeRange(rangeParam, start, end)
    if (rangeError) {
      return c.json({ error: { code: 'BAD_REQUEST', message: rangeError } }, 400)
    }

    if (!c.env.ANALYTICS) {
      return c.json({ error: { code: 'ANALYTICS_ERROR', message: 'Analytics service not available' } }, 500)
    }

    try {
      const client = createQueryClient(c.env.ANALYTICS)
      const queryOptions: QueryOptions = { range: range!, limit: 10000 }

      const apiKeys = await client.getApiKeyUsage(queryOptions)
      const apiKeyConfig = getApiKeyConfig(c.env)

      const csvData = apiKeys.map((key) => ({
        apiKeyId: key.apiKeyId,
        name: apiKeyConfig[key.apiKeyId]?.name || '',
        requests: key.requests,
        cost: key.cost,
        avgLatencyMs: key.avgLatencyMs,
        topEndpoint: key.topEndpoint,
        errors: key.errors,
      }))

      const csv = toCSV(csvData, ['apiKeyId', 'name', 'requests', 'cost', 'avgLatencyMs', 'topEndpoint', 'errors'])

      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="api-keys-usage-${range!.start.toISOString().split('T')[0]}-${range!.end.toISOString().split('T')[0]}.csv"`,
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return c.json({ error: { code: 'ANALYTICS_ERROR', message: `Analytics query failed: ${message}` } }, 500)
    }
  })

  // ============================================================================
  // GET /usage/keys - Per-Key Usage
  // ============================================================================

  router.get('/usage/keys', async (c) => {
    const { range: rangeParam, start, end, limit: limitParam, offset: offsetParam, sort: sortParam } = c.req.query()

    // Parse time range
    const { range, error: rangeError } = parseTimeRange(rangeParam, start, end)
    if (rangeError) {
      return c.json({ error: { code: 'BAD_REQUEST', message: rangeError } }, 400)
    }

    // Parse pagination
    const { limit, offset, error: paginationError } = parsePagination(limitParam, offsetParam)
    if (paginationError) {
      return c.json({ error: { code: 'BAD_REQUEST', message: paginationError } }, 400)
    }

    // Parse sort
    const { sort, error: sortError } = parseSort(sortParam)
    if (sortError) {
      return c.json({ error: { code: 'BAD_REQUEST', message: sortError } }, 400)
    }

    if (!c.env.ANALYTICS) {
      return c.json({ error: { code: 'ANALYTICS_ERROR', message: 'Analytics service not available' } }, 500)
    }

    try {
      const client = createQueryClient(c.env.ANALYTICS)
      const queryOptions: QueryOptions = { range: range!, limit, offset }

      const apiKeys = await client.getApiKeyUsage(queryOptions)
      const apiKeyConfig = getApiKeyConfig(c.env)

      // Sort based on parameter (default is cost from query)
      if (sort === 'requests') {
        apiKeys.sort((a, b) => b.requests - a.requests)
      } else if (sort === 'latency') {
        apiKeys.sort((a, b) => b.avgLatencyMs - a.avgLatencyMs)
      }
      // cost is already sorted by the query

      // Get total count (simplified - would need separate query in production)
      const total = apiKeys.length

      const enrichedKeys = apiKeys.map((key) => ({
        apiKeyId: key.apiKeyId,
        name: apiKeyConfig[key.apiKeyId]?.name,
        userId: apiKeyConfig[key.apiKeyId]?.userId,
        requests: key.requests,
        cost: key.cost,
        avgLatencyMs: key.avgLatencyMs,
        errorRate: key.requests > 0 ? (key.errors / key.requests) * 100 : 0,
        topEndpoint: key.topEndpoint,
        lastUsed: new Date().toISOString(), // Would come from query in production
      }))

      return c.json({
        keys: enrichedKeys,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + apiKeys.length < total,
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return c.json({ error: { code: 'ANALYTICS_ERROR', message: `Analytics query failed: ${message}` } }, 500)
    }
  })

  // ============================================================================
  // GET /usage/keys/:keyId/export - Export Single Key to CSV
  // NOTE: This route MUST come before /usage/keys/:keyId to avoid being caught
  // ============================================================================

  router.get('/usage/keys/:keyId/export', async (c) => {
    const keyId = c.req.param('keyId')
    const { format, range: rangeParam, start, end } = c.req.query()

    // Validate format
    if (format && format !== 'csv') {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid format parameter. Only csv is supported' } }, 400)
    }

    // Parse time range
    const { range, error: rangeError } = parseTimeRange(rangeParam, start, end)
    if (rangeError) {
      return c.json({ error: { code: 'BAD_REQUEST', message: rangeError } }, 400)
    }

    // Check if API key exists
    const apiKeyConfig = getApiKeyConfig(c.env)
    if (!apiKeyConfig[keyId]) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'API key not found' } }, 404)
    }

    if (!c.env.ANALYTICS) {
      return c.json({ error: { code: 'ANALYTICS_ERROR', message: 'Analytics service not available' } }, 500)
    }

    try {
      const client = createQueryClient(c.env.ANALYTICS)
      const queryOptions: QueryOptions = { range: range!, apiKeyId: keyId }
      const bucketSize = getBucketSizeForRange(range!)

      const timeline = await client.getTimeline({ ...queryOptions, bucketSize })

      const csvData = timeline.map((point) => ({
        timestamp: point.timestamp.toISOString(),
        requests: point.requests,
        cost: point.cost,
        avgLatencyMs: point.avgLatencyMs,
        errors: point.errors,
      }))

      const csv = toCSV(csvData, ['timestamp', 'requests', 'cost', 'avgLatencyMs', 'errors'])

      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${keyId}-usage-${range!.start.toISOString().split('T')[0]}-${range!.end.toISOString().split('T')[0]}.csv"`,
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return c.json({ error: { code: 'ANALYTICS_ERROR', message: `Analytics query failed: ${message}` } }, 500)
    }
  })

  // ============================================================================
  // GET /usage/keys/:keyId - Single Key Detail
  // ============================================================================

  router.get('/usage/keys/:keyId', async (c) => {
    const keyId = c.req.param('keyId')
    const { range: rangeParam, start, end } = c.req.query()

    // Parse time range
    const { range, error: rangeError } = parseTimeRange(rangeParam, start, end)
    if (rangeError) {
      return c.json({ error: { code: 'BAD_REQUEST', message: rangeError } }, 400)
    }

    // Check if API key exists in config
    const apiKeyConfig = getApiKeyConfig(c.env)
    if (!apiKeyConfig[keyId]) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'API key not found' } }, 404)
    }

    if (!c.env.ANALYTICS) {
      return c.json({ error: { code: 'ANALYTICS_ERROR', message: 'Analytics service not available' } }, 500)
    }

    try {
      const client = createQueryClient(c.env.ANALYTICS)
      const queryOptions: QueryOptions = { range: range!, apiKeyId: keyId }
      const bucketSize = getBucketSizeForRange(range!)

      const [summary, timeline, topEndpoints] = await Promise.all([
        client.getSummary(queryOptions),
        client.getTimeline({ ...queryOptions, bucketSize }),
        client.getTopEndpoints({ ...queryOptions, limit: 10 }),
      ])

      return c.json({
        apiKeyId: keyId,
        name: apiKeyConfig[keyId]?.name,
        userId: apiKeyConfig[keyId]?.userId,
        summary: {
          totalRequests: summary.totalRequests,
          totalCost: summary.totalCost,
          avgLatencyMs: summary.avgLatencyMs,
          errorRate: summary.errorRate,
        },
        timeline: timeline.map((point) => ({
          timestamp: point.timestamp.toISOString(),
          requests: point.requests,
          cost: point.cost,
          errors: point.errors,
        })),
        topEndpoints: topEndpoints.map((ep) => ({
          endpoint: ep.endpoint,
          method: ep.method,
          requests: ep.requests,
          cost: ep.cost,
        })),
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return c.json({ error: { code: 'ANALYTICS_ERROR', message: `Analytics query failed: ${message}` } }, 500)
    }
  })

  // ============================================================================
  // GET /usage/endpoints - Per-Endpoint Usage
  // ============================================================================

  router.get('/usage/endpoints', async (c) => {
    const { range: rangeParam, start, end, limit: limitParam, offset: offsetParam, method, endpoint } = c.req.query()

    // Check if this is an export route (handled separately)
    if (c.req.path.endsWith('/export')) {
      return c.notFound()
    }

    // Parse time range
    const { range, error: rangeError } = parseTimeRange(rangeParam, start, end)
    if (rangeError) {
      return c.json({ error: { code: 'BAD_REQUEST', message: rangeError } }, 400)
    }

    // Parse pagination
    const { limit, offset, error: paginationError } = parsePagination(limitParam, offsetParam)
    if (paginationError) {
      return c.json({ error: { code: 'BAD_REQUEST', message: paginationError } }, 400)
    }

    if (!c.env.ANALYTICS) {
      return c.json({ error: { code: 'ANALYTICS_ERROR', message: 'Analytics service not available' } }, 500)
    }

    try {
      const client = createQueryClient(c.env.ANALYTICS)
      const queryOptions: QueryOptions = { range: range!, limit, offset, method, endpoint }

      const endpoints = await client.getTopEndpoints(queryOptions)

      // Get total count (simplified)
      const total = endpoints.length

      // For endpoint response, we need p95 latency which requires additional query
      // For now, we'll use avgLatency * 1.5 as an approximation
      const enrichedEndpoints = endpoints.map((ep) => ({
        endpoint: ep.endpoint,
        method: ep.method,
        requests: ep.requests,
        cost: ep.cost,
        avgLatencyMs: ep.avgLatencyMs,
        p95LatencyMs: ep.avgLatencyMs * 1.5, // Approximation
        errorRate: ep.errorRate,
      }))

      return c.json({
        endpoints: enrichedEndpoints,
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + endpoints.length < total,
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return c.json({ error: { code: 'ANALYTICS_ERROR', message: `Analytics query failed: ${message}` } }, 500)
    }
  })

  // ============================================================================
  // GET /usage/export - Export Overview to CSV
  // ============================================================================

  router.get('/usage/export', async (c) => {
    const { format, range: rangeParam, start, end } = c.req.query()

    // Validate format
    if (format && format !== 'csv') {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid format parameter. Only csv is supported' } }, 400)
    }

    // Parse time range
    const { range, error: rangeError } = parseTimeRange(rangeParam, start, end)
    if (rangeError) {
      return c.json({ error: { code: 'BAD_REQUEST', message: rangeError } }, 400)
    }

    if (!c.env.ANALYTICS) {
      return c.json({ error: { code: 'ANALYTICS_ERROR', message: 'Analytics service not available' } }, 500)
    }

    try {
      const client = createQueryClient(c.env.ANALYTICS)
      const queryOptions: QueryOptions = { range: range! }
      const bucketSize = getBucketSizeForRange(range!)

      const timeline = await client.getTimeline({ ...queryOptions, bucketSize })

      const csvData = timeline.map((point) => ({
        timestamp: point.timestamp.toISOString(),
        requests: point.requests,
        cost: point.cost,
        avgLatencyMs: point.avgLatencyMs,
        errors: point.errors,
      }))

      const csv = toCSV(csvData, ['timestamp', 'requests', 'cost', 'avgLatencyMs', 'errors'])

      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="usage-${range!.start.toISOString().split('T')[0]}-${range!.end.toISOString().split('T')[0]}.csv"`,
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return c.json({ error: { code: 'ANALYTICS_ERROR', message: `Analytics query failed: ${message}` } }, 500)
    }
  })

  // ============================================================================
  // GET /usage/keys/export - Export API Keys to CSV
  // ============================================================================

  router.get('/usage/keys/export', async (c) => {
    const { format, range: rangeParam, start, end } = c.req.query()

    // Validate format
    if (format && format !== 'csv') {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid format parameter. Only csv is supported' } }, 400)
    }

    // Parse time range
    const { range, error: rangeError } = parseTimeRange(rangeParam, start, end)
    if (rangeError) {
      return c.json({ error: { code: 'BAD_REQUEST', message: rangeError } }, 400)
    }

    if (!c.env.ANALYTICS) {
      return c.json({ error: { code: 'ANALYTICS_ERROR', message: 'Analytics service not available' } }, 500)
    }

    try {
      const client = createQueryClient(c.env.ANALYTICS)
      const queryOptions: QueryOptions = { range: range!, limit: 10000 }

      const apiKeys = await client.getApiKeyUsage(queryOptions)
      const apiKeyConfig = getApiKeyConfig(c.env)

      const csvData = apiKeys.map((key) => ({
        apiKeyId: key.apiKeyId,
        name: apiKeyConfig[key.apiKeyId]?.name || '',
        requests: key.requests,
        cost: key.cost,
        avgLatencyMs: key.avgLatencyMs,
        topEndpoint: key.topEndpoint,
        errors: key.errors,
      }))

      const csv = toCSV(csvData, ['apiKeyId', 'name', 'requests', 'cost', 'avgLatencyMs', 'topEndpoint', 'errors'])

      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="api-keys-usage-${range!.start.toISOString().split('T')[0]}-${range!.end.toISOString().split('T')[0]}.csv"`,
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return c.json({ error: { code: 'ANALYTICS_ERROR', message: `Analytics query failed: ${message}` } }, 500)
    }
  })

  // ============================================================================
  // GET /usage/keys/:keyId/export - Export Single Key to CSV
  // ============================================================================

  router.get('/usage/keys/:keyId/export', async (c) => {
    const keyId = c.req.param('keyId')
    const { format, range: rangeParam, start, end } = c.req.query()

    // Validate format
    if (format && format !== 'csv') {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid format parameter. Only csv is supported' } }, 400)
    }

    // Parse time range
    const { range, error: rangeError } = parseTimeRange(rangeParam, start, end)
    if (rangeError) {
      return c.json({ error: { code: 'BAD_REQUEST', message: rangeError } }, 400)
    }

    // Check if API key exists
    const apiKeyConfig = getApiKeyConfig(c.env)
    if (!apiKeyConfig[keyId]) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'API key not found' } }, 404)
    }

    if (!c.env.ANALYTICS) {
      return c.json({ error: { code: 'ANALYTICS_ERROR', message: 'Analytics service not available' } }, 500)
    }

    try {
      const client = createQueryClient(c.env.ANALYTICS)
      const queryOptions: QueryOptions = { range: range!, apiKeyId: keyId }
      const bucketSize = getBucketSizeForRange(range!)

      const timeline = await client.getTimeline({ ...queryOptions, bucketSize })

      const csvData = timeline.map((point) => ({
        timestamp: point.timestamp.toISOString(),
        requests: point.requests,
        cost: point.cost,
        avgLatencyMs: point.avgLatencyMs,
        errors: point.errors,
      }))

      const csv = toCSV(csvData, ['timestamp', 'requests', 'cost', 'avgLatencyMs', 'errors'])

      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${keyId}-usage-${range!.start.toISOString().split('T')[0]}-${range!.end.toISOString().split('T')[0]}.csv"`,
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return c.json({ error: { code: 'ANALYTICS_ERROR', message: `Analytics query failed: ${message}` } }, 500)
    }
  })

  // ============================================================================
  // GET /usage/endpoints/export - Export Endpoints to CSV
  // ============================================================================

  router.get('/usage/endpoints/export', async (c) => {
    const { format, range: rangeParam, start, end } = c.req.query()

    // Validate format
    if (format && format !== 'csv') {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid format parameter. Only csv is supported' } }, 400)
    }

    // Parse time range
    const { range, error: rangeError } = parseTimeRange(rangeParam, start, end)
    if (rangeError) {
      return c.json({ error: { code: 'BAD_REQUEST', message: rangeError } }, 400)
    }

    if (!c.env.ANALYTICS) {
      return c.json({ error: { code: 'ANALYTICS_ERROR', message: 'Analytics service not available' } }, 500)
    }

    try {
      const client = createQueryClient(c.env.ANALYTICS)
      const queryOptions: QueryOptions = { range: range!, limit: 10000 }

      const endpoints = await client.getTopEndpoints(queryOptions)

      const csvData = endpoints.map((ep) => ({
        endpoint: ep.endpoint,
        method: ep.method,
        requests: ep.requests,
        cost: ep.cost,
        avgLatencyMs: ep.avgLatencyMs,
        errors: ep.errors,
        errorRate: ep.errorRate,
      }))

      const csv = toCSV(csvData, ['endpoint', 'method', 'requests', 'cost', 'avgLatencyMs', 'errors', 'errorRate'])

      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="endpoints-usage-${range!.start.toISOString().split('T')[0]}-${range!.end.toISOString().split('T')[0]}.csv"`,
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return c.json({ error: { code: 'ANALYTICS_ERROR', message: `Analytics query failed: ${message}` } }, 500)
    }
  })

  return router
}

export default createAdminRouter
