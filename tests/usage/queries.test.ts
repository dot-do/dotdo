/**
 * RED Phase Tests for R2 SQL Usage Queries
 *
 * These tests verify the R2/Analytics Engine SQL queries for usage analytics.
 * They are expected to FAIL until the implementation is complete.
 *
 * Related issues:
 * - dotdo-pcl1: [Red] R2 SQL usage query tests
 *
 * Implementation requirements:
 * - Query usage by time range
 * - Query usage by API key
 * - Query usage by endpoint
 * - Aggregate usage statistics
 * - Cost calculation queries
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ============================================================================
// Types (Expected)
// ============================================================================

/**
 * Time range for queries
 */
interface TimeRange {
  start: Date
  end: Date
}

/**
 * Usage summary statistics
 */
interface UsageSummary {
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
interface TimelineDataPoint {
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
interface EndpointUsage {
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
interface ApiKeyUsage {
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
interface QueryOptions {
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
 * Analytics query client interface
 */
interface UsageQueryClient {
  /** Get summary statistics */
  getSummary(options: QueryOptions): Promise<UsageSummary>
  /** Get timeline data with configurable bucket size */
  getTimeline(options: QueryOptions & { bucketSize: 'minute' | 'hour' | 'day' }): Promise<TimelineDataPoint[]>
  /** Get top endpoints by requests */
  getTopEndpoints(options: QueryOptions): Promise<EndpointUsage[]>
  /** Get usage by API key */
  getApiKeyUsage(options: QueryOptions): Promise<ApiKeyUsage[]>
  /** Get raw events for debugging */
  getRawEvents(options: QueryOptions): Promise<unknown[]>
}

// ============================================================================
// Dynamic Import - Tests fail gracefully until module exists
// ============================================================================

let createQueryClient: ((binding: unknown) => UsageQueryClient) | undefined
let createMockAnalyticsBinding: (() => unknown) | undefined

try {
  // @ts-expect-error - Module not yet implemented
  const module = await import('../../api/usage/queries')
  createQueryClient = module.createQueryClient

  // @ts-expect-error - Module not yet implemented
  const mockModule = await import('../../tests/mocks/analytics')
  createMockAnalyticsBinding = mockModule.createMockAnalyticsBinding
} catch {
  // Modules don't exist yet - tests will fail as expected (RED phase)
  createQueryClient = undefined
  createMockAnalyticsBinding = undefined
}

// ============================================================================
// Helper: Create test data
// ============================================================================

function createTimeRange(daysAgo: number, daysUntil = 0): TimeRange {
  const now = new Date('2026-01-09T12:00:00.000Z')
  return {
    start: new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000),
    end: new Date(now.getTime() - daysUntil * 24 * 60 * 60 * 1000),
  }
}

// ============================================================================
// 1. Query Client Export Tests
// ============================================================================

describe('UsageQueryClient Export', () => {
  it('createQueryClient is exported from api/usage/queries', () => {
    expect(createQueryClient).toBeDefined()
    expect(typeof createQueryClient).toBe('function')
  })

  it('createMockAnalyticsBinding is available for testing', () => {
    expect(createMockAnalyticsBinding).toBeDefined()
    expect(typeof createMockAnalyticsBinding).toBe('function')
  })

  it('createQueryClient returns object with required methods', () => {
    const binding = createMockAnalyticsBinding!()
    const client = createQueryClient!(binding)

    expect(client.getSummary).toBeDefined()
    expect(client.getTimeline).toBeDefined()
    expect(client.getTopEndpoints).toBeDefined()
    expect(client.getApiKeyUsage).toBeDefined()
    expect(client.getRawEvents).toBeDefined()
  })
})

// ============================================================================
// 2. Query Summary Statistics Tests
// ============================================================================

describe('Query summary statistics', () => {
  let client: UsageQueryClient

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
    const binding = createMockAnalyticsBinding!()
    client = createQueryClient!(binding)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns total request count', async () => {
    const summary = await client.getSummary({
      range: createTimeRange(7),
    })

    expect(summary.totalRequests).toBeDefined()
    expect(typeof summary.totalRequests).toBe('number')
    expect(summary.totalRequests).toBeGreaterThanOrEqual(0)
  })

  it('returns total cost', async () => {
    const summary = await client.getSummary({
      range: createTimeRange(7),
    })

    expect(summary.totalCost).toBeDefined()
    expect(typeof summary.totalCost).toBe('number')
    expect(summary.totalCost).toBeGreaterThanOrEqual(0)
  })

  it('returns average latency', async () => {
    const summary = await client.getSummary({
      range: createTimeRange(7),
    })

    expect(summary.avgLatencyMs).toBeDefined()
    expect(typeof summary.avgLatencyMs).toBe('number')
  })

  it('returns latency percentiles (p50, p95, p99)', async () => {
    const summary = await client.getSummary({
      range: createTimeRange(7),
    })

    expect(summary.p50LatencyMs).toBeDefined()
    expect(summary.p95LatencyMs).toBeDefined()
    expect(summary.p99LatencyMs).toBeDefined()

    // Percentiles should be ordered
    expect(summary.p50LatencyMs).toBeLessThanOrEqual(summary.p95LatencyMs)
    expect(summary.p95LatencyMs).toBeLessThanOrEqual(summary.p99LatencyMs)
  })

  it('returns error count and rate', async () => {
    const summary = await client.getSummary({
      range: createTimeRange(7),
    })

    expect(summary.errorCount).toBeDefined()
    expect(summary.errorRate).toBeDefined()
    expect(summary.errorRate).toBeGreaterThanOrEqual(0)
    expect(summary.errorRate).toBeLessThanOrEqual(100)
  })

  it('returns success rate', async () => {
    const summary = await client.getSummary({
      range: createTimeRange(7),
    })

    expect(summary.successRate).toBeDefined()
    expect(summary.successRate).toBeGreaterThanOrEqual(0)
    expect(summary.successRate).toBeLessThanOrEqual(100)

    // Success rate + error rate should equal ~100%
    expect(summary.successRate + summary.errorRate).toBeCloseTo(100, 1)
  })

  it('filters by API key ID', async () => {
    const summary = await client.getSummary({
      range: createTimeRange(7),
      apiKeyId: 'key-specific-abc',
    })

    expect(summary).toBeDefined()
    expect(summary.totalRequests).toBeGreaterThanOrEqual(0)
  })

  it('filters by user ID', async () => {
    const summary = await client.getSummary({
      range: createTimeRange(7),
      userId: 'user-specific-123',
    })

    expect(summary).toBeDefined()
    expect(summary.totalRequests).toBeGreaterThanOrEqual(0)
  })

  it('filters by endpoint', async () => {
    const summary = await client.getSummary({
      range: createTimeRange(7),
      endpoint: '/api/users',
    })

    expect(summary).toBeDefined()
    expect(summary.totalRequests).toBeGreaterThanOrEqual(0)
  })

  it('filters by HTTP method', async () => {
    const summary = await client.getSummary({
      range: createTimeRange(7),
      method: 'POST',
    })

    expect(summary).toBeDefined()
    expect(summary.totalRequests).toBeGreaterThanOrEqual(0)
  })

  it('returns zeros for empty time range', async () => {
    const summary = await client.getSummary({
      range: {
        start: new Date('2020-01-01'),
        end: new Date('2020-01-02'),
      },
    })

    expect(summary.totalRequests).toBe(0)
    expect(summary.totalCost).toBe(0)
  })
})

// ============================================================================
// 3. Query Timeline Data Tests
// ============================================================================

describe('Query timeline data', () => {
  let client: UsageQueryClient

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
    const binding = createMockAnalyticsBinding!()
    client = createQueryClient!(binding)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns array of timeline data points', async () => {
    const timeline = await client.getTimeline({
      range: createTimeRange(1),
      bucketSize: 'hour',
    })

    expect(Array.isArray(timeline)).toBe(true)
  })

  it('returns hourly buckets for 1-day range', async () => {
    const timeline = await client.getTimeline({
      range: createTimeRange(1),
      bucketSize: 'hour',
    })

    // Should have ~24 hourly buckets
    expect(timeline.length).toBeLessThanOrEqual(24)
  })

  it('returns daily buckets for 7-day range', async () => {
    const timeline = await client.getTimeline({
      range: createTimeRange(7),
      bucketSize: 'day',
    })

    // Should have ~7-8 daily buckets (can span 8 calendar days at boundaries)
    expect(timeline.length).toBeLessThanOrEqual(8)
  })

  it('returns minute buckets for short range', async () => {
    const now = new Date('2026-01-09T12:00:00.000Z')
    const timeline = await client.getTimeline({
      range: {
        start: new Date(now.getTime() - 60 * 60 * 1000), // 1 hour ago
        end: now,
      },
      bucketSize: 'minute',
    })

    // Should have ~60 minute buckets
    expect(timeline.length).toBeLessThanOrEqual(60)
  })

  it('each data point has required fields', async () => {
    const timeline = await client.getTimeline({
      range: createTimeRange(1),
      bucketSize: 'hour',
    })

    if (timeline.length > 0) {
      const point = timeline[0]
      expect(point.timestamp).toBeInstanceOf(Date)
      expect(typeof point.requests).toBe('number')
      expect(typeof point.cost).toBe('number')
      expect(typeof point.avgLatencyMs).toBe('number')
      expect(typeof point.errors).toBe('number')
    }
  })

  it('timeline is sorted by timestamp ascending', async () => {
    const timeline = await client.getTimeline({
      range: createTimeRange(7),
      bucketSize: 'day',
    })

    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i].timestamp.getTime()).toBeGreaterThan(timeline[i - 1].timestamp.getTime())
    }
  })

  it('filters timeline by API key', async () => {
    const timeline = await client.getTimeline({
      range: createTimeRange(1),
      bucketSize: 'hour',
      apiKeyId: 'key-timeline-test',
    })

    expect(Array.isArray(timeline)).toBe(true)
  })

  it('returns empty array for no data in range', async () => {
    const timeline = await client.getTimeline({
      range: {
        start: new Date('2020-01-01'),
        end: new Date('2020-01-02'),
      },
      bucketSize: 'hour',
    })

    expect(timeline).toEqual([])
  })
})

// ============================================================================
// 4. Query Top Endpoints Tests
// ============================================================================

describe('Query top endpoints', () => {
  let client: UsageQueryClient

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
    const binding = createMockAnalyticsBinding!()
    client = createQueryClient!(binding)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns array of endpoint usage', async () => {
    const endpoints = await client.getTopEndpoints({
      range: createTimeRange(7),
    })

    expect(Array.isArray(endpoints)).toBe(true)
  })

  it('each endpoint has required fields', async () => {
    const endpoints = await client.getTopEndpoints({
      range: createTimeRange(7),
    })

    if (endpoints.length > 0) {
      const endpoint = endpoints[0]
      expect(typeof endpoint.endpoint).toBe('string')
      expect(typeof endpoint.method).toBe('string')
      expect(typeof endpoint.requests).toBe('number')
      expect(typeof endpoint.cost).toBe('number')
      expect(typeof endpoint.avgLatencyMs).toBe('number')
      expect(typeof endpoint.errors).toBe('number')
      expect(typeof endpoint.errorRate).toBe('number')
    }
  })

  it('endpoints are sorted by request count descending', async () => {
    const endpoints = await client.getTopEndpoints({
      range: createTimeRange(7),
    })

    for (let i = 1; i < endpoints.length; i++) {
      expect(endpoints[i].requests).toBeLessThanOrEqual(endpoints[i - 1].requests)
    }
  })

  it('respects limit parameter', async () => {
    const endpoints = await client.getTopEndpoints({
      range: createTimeRange(7),
      limit: 5,
    })

    expect(endpoints.length).toBeLessThanOrEqual(5)
  })

  it('groups by endpoint and method combination', async () => {
    const endpoints = await client.getTopEndpoints({
      range: createTimeRange(7),
    })

    // Each endpoint+method combination should be unique
    const keys = endpoints.map((e) => `${e.method}:${e.endpoint}`)
    const uniqueKeys = new Set(keys)
    expect(keys.length).toBe(uniqueKeys.size)
  })

  it('filters by API key', async () => {
    const endpoints = await client.getTopEndpoints({
      range: createTimeRange(7),
      apiKeyId: 'key-endpoint-test',
    })

    expect(Array.isArray(endpoints)).toBe(true)
  })

  it('calculates error rate correctly', async () => {
    const endpoints = await client.getTopEndpoints({
      range: createTimeRange(7),
    })

    for (const endpoint of endpoints) {
      if (endpoint.requests > 0) {
        const expectedRate = (endpoint.errors / endpoint.requests) * 100
        expect(endpoint.errorRate).toBeCloseTo(expectedRate, 1)
      }
    }
  })
})

// ============================================================================
// 5. Query API Key Usage Tests
// ============================================================================

describe('Query API key usage', () => {
  let client: UsageQueryClient

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
    const binding = createMockAnalyticsBinding!()
    client = createQueryClient!(binding)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns array of API key usage', async () => {
    const apiKeys = await client.getApiKeyUsage({
      range: createTimeRange(7),
    })

    expect(Array.isArray(apiKeys)).toBe(true)
  })

  it('each API key has required fields', async () => {
    const apiKeys = await client.getApiKeyUsage({
      range: createTimeRange(7),
    })

    if (apiKeys.length > 0) {
      const apiKey = apiKeys[0]
      expect(typeof apiKey.apiKeyId).toBe('string')
      expect(typeof apiKey.requests).toBe('number')
      expect(typeof apiKey.cost).toBe('number')
      expect(typeof apiKey.avgLatencyMs).toBe('number')
      expect(typeof apiKey.topEndpoint).toBe('string')
      expect(typeof apiKey.errors).toBe('number')
    }
  })

  it('API keys are sorted by cost descending', async () => {
    const apiKeys = await client.getApiKeyUsage({
      range: createTimeRange(7),
    })

    for (let i = 1; i < apiKeys.length; i++) {
      expect(apiKeys[i].cost).toBeLessThanOrEqual(apiKeys[i - 1].cost)
    }
  })

  it('respects limit parameter', async () => {
    const apiKeys = await client.getApiKeyUsage({
      range: createTimeRange(7),
      limit: 10,
    })

    expect(apiKeys.length).toBeLessThanOrEqual(10)
  })

  it('includes top endpoint for each API key', async () => {
    const apiKeys = await client.getApiKeyUsage({
      range: createTimeRange(7),
    })

    for (const apiKey of apiKeys) {
      if (apiKey.requests > 0) {
        expect(apiKey.topEndpoint.length).toBeGreaterThan(0)
      }
    }
  })

  it('filters by specific API key', async () => {
    const apiKeys = await client.getApiKeyUsage({
      range: createTimeRange(7),
      apiKeyId: 'key-specific-123',
    })

    if (apiKeys.length > 0) {
      expect(apiKeys[0].apiKeyId).toBe('key-specific-123')
      expect(apiKeys.length).toBe(1)
    }
  })

  it('filters by endpoint to show API key usage on that endpoint', async () => {
    const apiKeys = await client.getApiKeyUsage({
      range: createTimeRange(7),
      endpoint: '/api/users',
    })

    expect(Array.isArray(apiKeys)).toBe(true)
  })
})

// ============================================================================
// 6. Time Range Filtering Tests
// ============================================================================

describe('Time range filtering', () => {
  let client: UsageQueryClient

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
    const binding = createMockAnalyticsBinding!()
    client = createQueryClient!(binding)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('queries last 24 hours', async () => {
    const summary = await client.getSummary({
      range: createTimeRange(1),
    })

    expect(summary).toBeDefined()
  })

  it('queries last 7 days', async () => {
    const summary = await client.getSummary({
      range: createTimeRange(7),
    })

    expect(summary).toBeDefined()
  })

  it('queries last 30 days', async () => {
    const summary = await client.getSummary({
      range: createTimeRange(30),
    })

    expect(summary).toBeDefined()
  })

  it('queries custom date range', async () => {
    const summary = await client.getSummary({
      range: {
        start: new Date('2026-01-01T00:00:00.000Z'),
        end: new Date('2026-01-05T23:59:59.999Z'),
      },
    })

    expect(summary).toBeDefined()
  })

  it('handles timezone offsets correctly', async () => {
    const summary = await client.getSummary({
      range: {
        start: new Date('2026-01-08T00:00:00+05:30'),
        end: new Date('2026-01-09T00:00:00+05:30'),
      },
    })

    expect(summary).toBeDefined()
  })

  it('throws error for invalid date range (end before start)', async () => {
    await expect(
      client.getSummary({
        range: {
          start: new Date('2026-01-09'),
          end: new Date('2026-01-01'),
        },
      })
    ).rejects.toThrow()
  })

  it('handles same start and end time', async () => {
    const now = new Date('2026-01-09T12:00:00.000Z')
    const summary = await client.getSummary({
      range: {
        start: now,
        end: now,
      },
    })

    expect(summary.totalRequests).toBe(0)
  })
})

// ============================================================================
// 7. Cost Aggregation Tests
// ============================================================================

describe('Cost aggregation queries', () => {
  let client: UsageQueryClient

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
    const binding = createMockAnalyticsBinding!()
    client = createQueryClient!(binding)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('calculates total cost across all requests', async () => {
    const summary = await client.getSummary({
      range: createTimeRange(7),
    })

    expect(typeof summary.totalCost).toBe('number')
    expect(summary.totalCost).toBeGreaterThanOrEqual(0)
  })

  it('includes cost in timeline data', async () => {
    const timeline = await client.getTimeline({
      range: createTimeRange(1),
      bucketSize: 'hour',
    })

    for (const point of timeline) {
      expect(typeof point.cost).toBe('number')
      expect(point.cost).toBeGreaterThanOrEqual(0)
    }
  })

  it('includes cost in endpoint breakdown', async () => {
    const endpoints = await client.getTopEndpoints({
      range: createTimeRange(7),
    })

    for (const endpoint of endpoints) {
      expect(typeof endpoint.cost).toBe('number')
      expect(endpoint.cost).toBeGreaterThanOrEqual(0)
    }
  })

  it('includes cost in API key breakdown', async () => {
    const apiKeys = await client.getApiKeyUsage({
      range: createTimeRange(7),
    })

    for (const apiKey of apiKeys) {
      expect(typeof apiKey.cost).toBe('number')
      expect(apiKey.cost).toBeGreaterThanOrEqual(0)
    }
  })

  it('total cost matches sum of timeline buckets', async () => {
    const summary = await client.getSummary({
      range: createTimeRange(1),
    })

    const timeline = await client.getTimeline({
      range: createTimeRange(1),
      bucketSize: 'hour',
    })

    const timelineTotalCost = timeline.reduce((sum, point) => sum + point.cost, 0)

    expect(summary.totalCost).toBeCloseTo(timelineTotalCost, 2)
  })
})

// ============================================================================
// 8. Pagination Tests
// ============================================================================

describe('Pagination', () => {
  let client: UsageQueryClient

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
    const binding = createMockAnalyticsBinding!()
    client = createQueryClient!(binding)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('respects limit parameter on endpoints', async () => {
    const endpoints = await client.getTopEndpoints({
      range: createTimeRange(7),
      limit: 5,
    })

    expect(endpoints.length).toBeLessThanOrEqual(5)
  })

  it('respects offset parameter on endpoints', async () => {
    const page1 = await client.getTopEndpoints({
      range: createTimeRange(7),
      limit: 5,
      offset: 0,
    })

    const page2 = await client.getTopEndpoints({
      range: createTimeRange(7),
      limit: 5,
      offset: 5,
    })

    // Pages should not overlap (if there's enough data)
    if (page1.length > 0 && page2.length > 0) {
      const page1Ids = page1.map((e) => `${e.method}:${e.endpoint}`)
      const page2Ids = page2.map((e) => `${e.method}:${e.endpoint}`)
      const overlap = page1Ids.filter((id) => page2Ids.includes(id))
      expect(overlap.length).toBe(0)
    }
  })

  it('respects limit parameter on API keys', async () => {
    const apiKeys = await client.getApiKeyUsage({
      range: createTimeRange(7),
      limit: 10,
    })

    expect(apiKeys.length).toBeLessThanOrEqual(10)
  })

  it('respects offset parameter on API keys', async () => {
    const page1 = await client.getApiKeyUsage({
      range: createTimeRange(7),
      limit: 5,
      offset: 0,
    })

    const page2 = await client.getApiKeyUsage({
      range: createTimeRange(7),
      limit: 5,
      offset: 5,
    })

    // Pages should not overlap
    if (page1.length > 0 && page2.length > 0) {
      const page1Ids = page1.map((k) => k.apiKeyId)
      const page2Ids = page2.map((k) => k.apiKeyId)
      const overlap = page1Ids.filter((id) => page2Ids.includes(id))
      expect(overlap.length).toBe(0)
    }
  })

  it('respects limit on raw events', async () => {
    const events = await client.getRawEvents({
      range: createTimeRange(1),
      limit: 100,
    })

    expect(events.length).toBeLessThanOrEqual(100)
  })
})

// ============================================================================
// 9. Status Code Filtering Tests
// ============================================================================

describe('Status code filtering', () => {
  let client: UsageQueryClient

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
    const binding = createMockAnalyticsBinding!()
    client = createQueryClient!(binding)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('filters by success status codes (2xx)', async () => {
    const summary = await client.getSummary({
      range: createTimeRange(7),
      statusCodes: [200, 201, 204],
    })

    // Only successful requests should be counted
    expect(summary.errorCount).toBe(0)
  })

  it('filters by client error status codes (4xx)', async () => {
    const summary = await client.getSummary({
      range: createTimeRange(7),
      statusCodes: [400, 401, 403, 404, 422, 429],
    })

    // All requests should be errors
    if (summary.totalRequests > 0) {
      expect(summary.errorCount).toBe(summary.totalRequests)
    }
  })

  it('filters by server error status codes (5xx)', async () => {
    const summary = await client.getSummary({
      range: createTimeRange(7),
      statusCodes: [500, 502, 503, 504],
    })

    // All requests should be errors
    if (summary.totalRequests > 0) {
      expect(summary.errorCount).toBe(summary.totalRequests)
    }
  })

  it('combines multiple status code filters', async () => {
    const summary = await client.getSummary({
      range: createTimeRange(7),
      statusCodes: [200, 500],
    })

    expect(summary).toBeDefined()
  })
})

// ============================================================================
// 10. Raw Events Query Tests
// ============================================================================

describe('Raw events query', () => {
  let client: UsageQueryClient

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-09T12:00:00.000Z'))
    const binding = createMockAnalyticsBinding!()
    client = createQueryClient!(binding)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns array of raw events', async () => {
    const events = await client.getRawEvents({
      range: createTimeRange(1),
    })

    expect(Array.isArray(events)).toBe(true)
  })

  it('events include all fields', async () => {
    const events = await client.getRawEvents({
      range: createTimeRange(1),
      limit: 10,
    })

    if (events.length > 0) {
      const event = events[0] as Record<string, unknown>
      expect(event.id).toBeDefined()
      expect(event.timestamp).toBeDefined()
      expect(event.endpoint).toBeDefined()
      expect(event.method).toBeDefined()
      expect(event.statusCode).toBeDefined()
      expect(event.latencyMs).toBeDefined()
      expect(event.cost).toBeDefined()
    }
  })

  it('events are sorted by timestamp descending', async () => {
    const events = await client.getRawEvents({
      range: createTimeRange(1),
      limit: 100,
    })

    for (let i = 1; i < events.length; i++) {
      const current = events[i] as { timestamp: string }
      const prev = events[i - 1] as { timestamp: string }
      expect(new Date(current.timestamp).getTime()).toBeLessThanOrEqual(new Date(prev.timestamp).getTime())
    }
  })

  it('filters by API key', async () => {
    const events = await client.getRawEvents({
      range: createTimeRange(1),
      apiKeyId: 'key-raw-test',
      limit: 100,
    })

    for (const event of events) {
      expect((event as { apiKeyId: string }).apiKeyId).toBe('key-raw-test')
    }
  })

  it('filters by endpoint', async () => {
    const events = await client.getRawEvents({
      range: createTimeRange(1),
      endpoint: '/api/users',
      limit: 100,
    })

    for (const event of events) {
      expect((event as { endpoint: string }).endpoint).toContain('/api/users')
    }
  })

  it('supports pagination with offset', async () => {
    const page1 = await client.getRawEvents({
      range: createTimeRange(1),
      limit: 50,
      offset: 0,
    })

    const page2 = await client.getRawEvents({
      range: createTimeRange(1),
      limit: 50,
      offset: 50,
    })

    if (page1.length > 0 && page2.length > 0) {
      const page1Ids = page1.map((e) => (e as { id: string }).id)
      const page2Ids = page2.map((e) => (e as { id: string }).id)
      const overlap = page1Ids.filter((id) => page2Ids.includes(id))
      expect(overlap.length).toBe(0)
    }
  })
})
