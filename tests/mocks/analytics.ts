/**
 * Mock Analytics binding for testing usage analytics
 *
 * Provides test-friendly implementations of R2/Analytics Engine SQL bindings
 * that accept seeded data and return consistent results for assertions.
 *
 * @module tests/mocks/analytics
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Raw usage event stored in analytics
 */
export interface UsageEvent {
  id: string
  timestamp: string
  apiKeyId: string
  userId?: string
  endpoint: string
  method: string
  statusCode: number
  latencyMs: number
  cost: number
  requestSize?: number
  responseSize?: number
}

/**
 * Mock analytics query result
 */
interface QueryResult {
  rows: Record<string, unknown>[]
  meta?: {
    rowCount: number
    duration: number
  }
}

/**
 * Mock R2/Analytics Engine SQL binding interface
 */
export interface MockAnalyticsBinding {
  query(sql: string, params?: unknown[]): Promise<QueryResult>
}

/**
 * Mock KV binding interface for API key metadata
 */
export interface MockKVBinding {
  get(key: string, options?: { type?: 'json' | 'text' }): Promise<unknown>
  put(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  list(options?: { prefix?: string }): Promise<{ keys: { name: string }[] }>
}

// ============================================================================
// Mock Data Generation
// ============================================================================

/**
 * Generate mock usage events for testing
 */
function generateMockEvents(count: number, baseDate: Date): UsageEvent[] {
  const events: UsageEvent[] = []
  const endpoints = [
    { path: '/api/users', methods: ['GET', 'POST', 'PUT', 'DELETE'] },
    { path: '/api/things', methods: ['GET', 'POST', 'PUT', 'DELETE'] },
    { path: '/api/health', methods: ['GET'] },
    { path: '/api/workflows', methods: ['GET', 'POST'] },
    { path: '/api/auth/login', methods: ['POST'] },
    { path: '/api/auth/logout', methods: ['POST'] },
  ]
  const apiKeys = ['key-abc', 'key-xyz', 'key-123', 'key-456', 'key-specific-abc', 'key-raw-test']
  const users = ['user-1', 'user-2', 'user-3', 'user-specific-123']
  const statusCodes = [200, 200, 200, 200, 200, 201, 204, 400, 401, 404, 500]

  for (let i = 0; i < count; i++) {
    const endpointInfo = endpoints[Math.floor(Math.random() * endpoints.length)]
    const method = endpointInfo.methods[Math.floor(Math.random() * endpointInfo.methods.length)]
    const statusCode = statusCodes[Math.floor(Math.random() * statusCodes.length)]
    const apiKeyId = apiKeys[Math.floor(Math.random() * apiKeys.length)]
    const userId = users[Math.floor(Math.random() * users.length)]

    // Distribute events over the time range
    const timestamp = new Date(baseDate.getTime() - Math.random() * 7 * 24 * 60 * 60 * 1000)

    events.push({
      id: `event-${i}-${Date.now()}`,
      timestamp: timestamp.toISOString(),
      apiKeyId,
      userId,
      endpoint: endpointInfo.path,
      method,
      statusCode,
      latencyMs: Math.floor(Math.random() * 500) + 10,
      cost: Math.random() * 0.01,
      requestSize: Math.floor(Math.random() * 10000),
      responseSize: Math.floor(Math.random() * 50000),
    })
  }

  // Sort by timestamp descending
  events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  return events
}

// ============================================================================
// Mock Analytics Binding
// ============================================================================

/**
 * Create a mock analytics binding with seeded data
 *
 * @example
 * ```typescript
 * const binding = createMockAnalyticsBinding()
 * const result = await binding.query('SELECT * FROM usage_events')
 * ```
 */
export function createMockAnalyticsBinding(): MockAnalyticsBinding {
  const baseDate = new Date('2026-01-09T12:00:00.000Z')
  const events = generateMockEvents(500, baseDate)

  return {
    async query(sql: string, params?: unknown[]): Promise<QueryResult> {
      // Parse the SQL to determine what kind of query this is
      const sqlLower = sql.toLowerCase()

      // Handle timeline/bucket queries FIRST (GROUP BY with time truncation)
      // These also have COUNT/SUM/AVG but should be handled by timeline
      if (sqlLower.includes('group by') && (sqlLower.includes('date_trunc') || sqlLower.includes('strftime'))) {
        return handleTimelineQuery(sql, params, events)
      }

      // Handle top endpoints query (GROUP BY endpoint, method)
      if (sqlLower.includes('group by') && sqlLower.includes('endpoint') && sqlLower.includes('method')) {
        return handleEndpointQuery(sql, params, events)
      }

      // Handle API key usage query (GROUP BY api_key_id)
      if (sqlLower.includes('group by') && sqlLower.includes('api_key_id')) {
        return handleApiKeyQuery(sql, params, events)
      }

      // Handle summary queries (COUNT, SUM, AVG without GROUP BY)
      // This should only match pure aggregate queries
      if ((sqlLower.includes('count(') || sqlLower.includes('sum(') || sqlLower.includes('avg(')) && !sqlLower.includes('group by')) {
        return handleAggregateQuery(sql, params, events)
      }

      // Handle raw events query (SELECT * or without aggregates)
      return handleRawEventsQuery(sql, params, events)
    },
  }
}

// ============================================================================
// Query Handlers
// ============================================================================

function parseWhereClause(sql: string, params: unknown[] = []): { start?: Date; end?: Date; apiKeyId?: string; userId?: string; endpoint?: string; method?: string; statusCodes?: number[] } {
  const result: { start?: Date; end?: Date; apiKeyId?: string; userId?: string; endpoint?: string; method?: string; statusCodes?: number[] } = {}

  // Extract date range from params (positional)
  let paramIndex = 0

  // Check for timestamp conditions
  if (sql.includes('timestamp >=') || sql.includes('timestamp >')) {
    if (params[paramIndex]) {
      result.start = new Date(params[paramIndex] as string)
      paramIndex++
    }
  }
  if (sql.includes('timestamp <=') || sql.includes('timestamp <')) {
    if (params[paramIndex]) {
      result.end = new Date(params[paramIndex] as string)
      paramIndex++
    }
  }

  // Check for api_key filter
  if (sql.includes('api_key_id =') || sql.includes('api_key =')) {
    if (params[paramIndex]) {
      result.apiKeyId = params[paramIndex] as string
      paramIndex++
    }
  }

  // Check for user_id filter
  if (sql.includes('user_id =')) {
    if (params[paramIndex]) {
      result.userId = params[paramIndex] as string
      paramIndex++
    }
  }

  // Check for endpoint filter
  if (sql.includes('endpoint =') || sql.includes('endpoint LIKE')) {
    if (params[paramIndex]) {
      result.endpoint = params[paramIndex] as string
      paramIndex++
    }
  }

  // Check for method filter
  if (sql.includes('method =')) {
    if (params[paramIndex]) {
      result.method = params[paramIndex] as string
      paramIndex++
    }
  }

  // Check for status code filter - SQL uses IN (?, ?, ?) with individual params
  if (sql.includes('status_code IN')) {
    // Count the number of placeholders in the IN clause
    const inMatch = sql.match(/status_code IN\s*\(([^)]+)\)/i)
    if (inMatch) {
      const placeholders = inMatch[1].split(',').length
      const statusCodes: number[] = []
      for (let i = 0; i < placeholders && params[paramIndex] !== undefined; i++) {
        statusCodes.push(Number(params[paramIndex]))
        paramIndex++
      }
      if (statusCodes.length > 0) {
        result.statusCodes = statusCodes
      }
    }
  }

  return result
}

function filterEvents(events: UsageEvent[], filters: ReturnType<typeof parseWhereClause>): UsageEvent[] {
  return events.filter((event) => {
    const eventTime = new Date(event.timestamp)

    if (filters.start && eventTime < filters.start) return false
    if (filters.end && eventTime > filters.end) return false
    if (filters.apiKeyId && event.apiKeyId !== filters.apiKeyId) return false
    if (filters.userId && event.userId !== filters.userId) return false
    if (filters.endpoint && !event.endpoint.includes(filters.endpoint.replace(/%/g, ''))) return false
    if (filters.method && event.method !== filters.method) return false
    if (filters.statusCodes && !filters.statusCodes.includes(event.statusCode)) return false

    return true
  })
}

function handleAggregateQuery(sql: string, params: unknown[] = [], events: UsageEvent[]): QueryResult {
  const filters = parseWhereClause(sql, params)
  const filtered = filterEvents(events, filters)

  if (filtered.length === 0) {
    return {
      rows: [{
        total_requests: 0,
        total_cost: 0,
        avg_latency_ms: 0,
        p50_latency_ms: 0,
        p95_latency_ms: 0,
        p99_latency_ms: 0,
        error_count: 0,
        error_rate: 0,
        success_rate: 100,
      }],
      meta: { rowCount: 1, duration: 5 },
    }
  }

  const latencies = filtered.map((e) => e.latencyMs).sort((a, b) => a - b)
  const errorCount = filtered.filter((e) => e.statusCode >= 400).length

  return {
    rows: [{
      total_requests: filtered.length,
      total_cost: filtered.reduce((sum, e) => sum + e.cost, 0),
      avg_latency_ms: filtered.reduce((sum, e) => sum + e.latencyMs, 0) / filtered.length,
      p50_latency_ms: latencies[Math.floor(latencies.length * 0.5)] || 0,
      p95_latency_ms: latencies[Math.floor(latencies.length * 0.95)] || 0,
      p99_latency_ms: latencies[Math.floor(latencies.length * 0.99)] || 0,
      error_count: errorCount,
      error_rate: (errorCount / filtered.length) * 100,
      success_rate: ((filtered.length - errorCount) / filtered.length) * 100,
    }],
    meta: { rowCount: 1, duration: 10 },
  }
}

function handleTimelineQuery(sql: string, params: unknown[] = [], events: UsageEvent[]): QueryResult {
  const filters = parseWhereClause(sql, params)
  const filtered = filterEvents(events, filters)

  // Determine bucket size from SQL
  let bucketMs = 60 * 60 * 1000 // default: hour
  if (sql.includes('minute') || sql.includes('%Y-%m-%d %H:%M')) {
    bucketMs = 60 * 1000
  } else if (sql.includes('day') || sql.includes('%Y-%m-%d')) {
    bucketMs = 24 * 60 * 60 * 1000
  }

  // Group by time bucket
  const buckets = new Map<number, UsageEvent[]>()

  for (const event of filtered) {
    const eventTime = new Date(event.timestamp).getTime()
    const bucketTime = Math.floor(eventTime / bucketMs) * bucketMs
    if (!buckets.has(bucketTime)) {
      buckets.set(bucketTime, [])
    }
    buckets.get(bucketTime)!.push(event)
  }

  // Convert to rows
  const rows = Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([timestamp, bucketEvents]) => ({
      timestamp: new Date(timestamp).toISOString(),
      requests: bucketEvents.length,
      cost: bucketEvents.reduce((sum, e) => sum + e.cost, 0),
      avg_latency_ms: bucketEvents.reduce((sum, e) => sum + e.latencyMs, 0) / bucketEvents.length,
      errors: bucketEvents.filter((e) => e.statusCode >= 400).length,
    }))

  return { rows, meta: { rowCount: rows.length, duration: 15 } }
}

function handleEndpointQuery(sql: string, params: unknown[] = [], events: UsageEvent[]): QueryResult {
  const filters = parseWhereClause(sql, params)
  const filtered = filterEvents(events, filters)

  // Group by endpoint + method
  const groups = new Map<string, UsageEvent[]>()

  for (const event of filtered) {
    const key = `${event.method}:${event.endpoint}`
    if (!groups.has(key)) {
      groups.set(key, [])
    }
    groups.get(key)!.push(event)
  }

  // Convert to rows
  let rows = Array.from(groups.entries()).map(([key, groupEvents]) => {
    const [method, endpoint] = key.split(':')
    const errorCount = groupEvents.filter((e) => e.statusCode >= 400).length
    const latencies = groupEvents.map((e) => e.latencyMs).sort((a, b) => a - b)

    return {
      endpoint,
      method,
      requests: groupEvents.length,
      cost: groupEvents.reduce((sum, e) => sum + e.cost, 0),
      avg_latency_ms: groupEvents.reduce((sum, e) => sum + e.latencyMs, 0) / groupEvents.length,
      p95_latency_ms: latencies[Math.floor(latencies.length * 0.95)] || 0,
      errors: errorCount,
      error_rate: (errorCount / groupEvents.length) * 100,
    }
  })

  // Sort by requests descending
  rows.sort((a, b) => b.requests - a.requests)

  // Apply LIMIT
  const limitMatch = sql.match(/LIMIT\s+(\d+)/i)
  if (limitMatch) {
    const limit = parseInt(limitMatch[1], 10)
    rows = rows.slice(0, limit)
  }

  // Apply OFFSET
  const offsetMatch = sql.match(/OFFSET\s+(\d+)/i)
  if (offsetMatch) {
    const offset = parseInt(offsetMatch[1], 10)
    rows = rows.slice(offset)
  }

  return { rows, meta: { rowCount: rows.length, duration: 20 } }
}

function handleApiKeyQuery(sql: string, params: unknown[] = [], events: UsageEvent[]): QueryResult {
  const filters = parseWhereClause(sql, params)
  const filtered = filterEvents(events, filters)

  // Group by API key
  const groups = new Map<string, UsageEvent[]>()

  for (const event of filtered) {
    if (!groups.has(event.apiKeyId)) {
      groups.set(event.apiKeyId, [])
    }
    groups.get(event.apiKeyId)!.push(event)
  }

  // Convert to rows
  let rows = Array.from(groups.entries()).map(([apiKeyId, groupEvents]) => {
    const errorCount = groupEvents.filter((e) => e.statusCode >= 400).length

    // Find top endpoint
    const endpointCounts = new Map<string, number>()
    for (const e of groupEvents) {
      endpointCounts.set(e.endpoint, (endpointCounts.get(e.endpoint) || 0) + 1)
    }
    const topEndpoint = Array.from(endpointCounts.entries())
      .sort(([, a], [, b]) => b - a)[0]?.[0] || ''

    return {
      api_key_id: apiKeyId,
      requests: groupEvents.length,
      cost: groupEvents.reduce((sum, e) => sum + e.cost, 0),
      avg_latency_ms: groupEvents.reduce((sum, e) => sum + e.latencyMs, 0) / groupEvents.length,
      top_endpoint: topEndpoint,
      errors: errorCount,
      error_rate: (errorCount / groupEvents.length) * 100,
    }
  })

  // Sort by cost descending (default)
  rows.sort((a, b) => b.cost - a.cost)

  // Apply LIMIT
  const limitMatch = sql.match(/LIMIT\s+(\d+)/i)
  if (limitMatch) {
    const limit = parseInt(limitMatch[1], 10)
    rows = rows.slice(0, limit)
  }

  // Apply OFFSET
  const offsetMatch = sql.match(/OFFSET\s+(\d+)/i)
  if (offsetMatch) {
    const offset = parseInt(offsetMatch[1], 10)
    rows = rows.slice(offset)
  }

  return { rows, meta: { rowCount: rows.length, duration: 25 } }
}

function handleRawEventsQuery(sql: string, params: unknown[] = [], events: UsageEvent[]): QueryResult {
  const filters = parseWhereClause(sql, params)
  let filtered = filterEvents(events, filters)

  // Apply LIMIT
  const limitMatch = sql.match(/LIMIT\s+(\d+)/i)
  if (limitMatch) {
    const limit = parseInt(limitMatch[1], 10)
    filtered = filtered.slice(0, limit)
  }

  // Apply OFFSET
  const offsetMatch = sql.match(/OFFSET\s+(\d+)/i)
  if (offsetMatch) {
    const offset = parseInt(offsetMatch[1], 10)
    filtered = filtered.slice(offset)
  }

  // Convert to rows matching the event shape
  const rows = filtered.map((e) => ({
    id: e.id,
    timestamp: e.timestamp,
    api_key_id: e.apiKeyId,
    user_id: e.userId,
    endpoint: e.endpoint,
    method: e.method,
    status_code: e.statusCode,
    latency_ms: e.latencyMs,
    cost: e.cost,
    request_size: e.requestSize,
    response_size: e.responseSize,
  }))

  return { rows, meta: { rowCount: rows.length, duration: 30 } }
}

// ============================================================================
// Mock KV Binding
// ============================================================================

/**
 * Create a mock KV binding for API key metadata
 *
 * @example
 * ```typescript
 * const kv = createMockKVBinding()
 * const keyInfo = await kv.get('api-key:key-abc', { type: 'json' })
 * ```
 */
export function createMockKVBinding(): MockKVBinding {
  const store = new Map<string, string>()

  // Seed with some API key metadata
  store.set('api-key:key-abc', JSON.stringify({
    apiKeyId: 'key-abc',
    name: 'Production Key',
    userId: 'user-1',
    role: 'user',
    createdAt: '2025-01-01T00:00:00.000Z',
  }))
  store.set('api-key:key-xyz', JSON.stringify({
    apiKeyId: 'key-xyz',
    name: 'Admin Key',
    userId: 'user-2',
    role: 'admin',
    createdAt: '2025-01-01T00:00:00.000Z',
  }))
  store.set('api-key:key-123', JSON.stringify({
    apiKeyId: 'key-123',
    name: 'Test Key',
    userId: 'user-3',
    role: 'user',
    createdAt: '2025-06-01T00:00:00.000Z',
  }))

  return {
    async get(key: string, options?: { type?: 'json' | 'text' }): Promise<unknown> {
      const value = store.get(key)
      if (!value) return null
      if (options?.type === 'json') {
        return JSON.parse(value)
      }
      return value
    },

    async put(key: string, value: string): Promise<void> {
      store.set(key, value)
    },

    async delete(key: string): Promise<void> {
      store.delete(key)
    },

    async list(options?: { prefix?: string }): Promise<{ keys: { name: string }[] }> {
      const keys = Array.from(store.keys())
        .filter((k) => !options?.prefix || k.startsWith(options.prefix))
        .map((name) => ({ name }))
      return { keys }
    },
  }
}
