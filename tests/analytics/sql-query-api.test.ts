/**
 * SQL Query API Integration Tests
 *
 * Comprehensive tests for the analytics SQL query API.
 * Tests query execution, planning, classification, and aggregations.
 *
 * @module tests/analytics/sql-query-api.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { analyticsRouter } from '../../api/analytics/router'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface AnalyticsError {
  error: {
    code: string
    message: string
    details?: { errors?: string[]; message?: string }
  }
}

interface SQLQueryResponse {
  data: Record<string, unknown>[]
  columns: Array<{ name: string; type: string }>
  rowCount: number
  truncated: boolean
  timing: {
    total: number
    planning: number
    execution: number
    serialization: number
  }
}

interface QueryPlanResponse {
  plan: {
    type: 'client_execute' | 'server_execute'
    dataFiles?: Array<{
      name: string
      url: string
      size: number
      rowCount: number
      columns: string[]
      cacheKey: string
    }>
    optimizedSql?: string
    estimates: {
      rowCount: number
      dataSizeBytes: number
      executionTimeMs: number
    }
    pushdownFilters?: string[]
  }
  timing: {
    total: number
    planning: number
  }
}

interface QueryClassification {
  type: 'point_lookup' | 'vector_search' | 'analytics' | 'federated'
  executionPath: 'point_lookup' | 'browser_execute' | 'federated_query'
  estimatedCost: {
    computeMs: number
    dataSizeBytes: number
    monetaryCost: number
  }
}

interface HealthResponse {
  status: string
  timestamp: string
  capabilities: {
    vectorSearch: boolean
    r2Storage: boolean
    d1Database: boolean
  }
}

interface MockEnv {
  DB?: {
    prepare: (sql: string) => {
      bind: (...params: unknown[]) => {
        all: () => Promise<{ results: Record<string, unknown>[] }>
      }
      all: () => Promise<{ results: Record<string, unknown>[] }>
    }
  }
  ANALYTICS_DB?: MockEnv['DB']
  R2?: unknown
  VECTORS?: unknown
}

// ============================================================================
// TEST UTILITIES
// ============================================================================

function createAnalyticsApp(): Hono<{ Bindings: MockEnv }> {
  const app = new Hono<{ Bindings: MockEnv }>()
  app.route('/', analyticsRouter)
  return app
}

function createQueryRequest(body: unknown): Request {
  return new Request('http://test.api.dotdo.dev/v1/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function createClassifyRequest(body: unknown): Request {
  return new Request('http://test.api.dotdo.dev/v1/classify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function createMockD1(results: Record<string, unknown>[] = []) {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...params: unknown[]) => ({
        all: vi.fn(async () => ({ results })),
      })),
      all: vi.fn(async () => ({ results })),
    })),
  }
}

// ============================================================================
// SQL QUERY ENDPOINT TESTS
// ============================================================================

describe('SQL Query API - Query Endpoint', () => {
  let app: Hono<{ Bindings: MockEnv }>

  beforeEach(() => {
    app = createAnalyticsApp()
  })

  describe('input validation', () => {
    it('returns 400 for invalid JSON', async () => {
      const request = new Request('http://test.api.dotdo.dev/v1/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json',
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as AnalyticsError

      expect(response.status).toBe(400)
      expect(data.error.code).toBe('INVALID_QUERY')
    })

    it('returns 400 when sql is missing', async () => {
      const request = createQueryRequest({})

      const response = await app.fetch(request, {})
      const data = (await response.json()) as AnalyticsError

      expect(response.status).toBe(400)
      expect(data.error.code).toBe('INVALID_QUERY')
      expect(data.error.details?.errors).toContain('sql is required')
    })

    it('returns 400 when sql is not a string', async () => {
      const request = createQueryRequest({ sql: 12345 })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as AnalyticsError

      expect(response.status).toBe(400)
      expect(data.error.details?.errors).toContain('sql must be a string')
    })

    it('returns 400 when sql is empty', async () => {
      const request = createQueryRequest({ sql: '   ' })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as AnalyticsError

      expect(response.status).toBe(400)
      expect(data.error.details?.errors).toContain('sql cannot be empty')
    })

    it('returns 400 for invalid executionHint', async () => {
      const request = createQueryRequest({
        sql: 'SELECT * FROM users',
        executionHint: 'invalid',
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as AnalyticsError

      expect(response.status).toBe(400)
      expect(data.error.details?.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('executionHint must be one of')])
      )
    })

    it('returns 400 for invalid limit', async () => {
      const request = createQueryRequest({
        sql: 'SELECT * FROM users',
        limit: -1,
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as AnalyticsError

      expect(response.status).toBe(400)
      expect(data.error.details?.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('limit must be between')])
      )
    })

    it('returns 400 for limit exceeding maximum', async () => {
      const request = createQueryRequest({
        sql: 'SELECT * FROM users',
        limit: 200000,
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as AnalyticsError

      expect(response.status).toBe(400)
      expect(data.error.details?.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('limit must be between')])
      )
    })

    it('returns 400 for invalid timeout', async () => {
      const request = createQueryRequest({
        sql: 'SELECT * FROM users',
        timeout: 500, // Less than 1000ms minimum
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as AnalyticsError

      expect(response.status).toBe(400)
      expect(data.error.details?.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('timeout must be between')])
      )
    })

    it('accepts valid executionHint values', async () => {
      const hints = ['client', 'server', 'auto']

      for (const executionHint of hints) {
        const request = createQueryRequest({
          sql: 'SELECT * FROM users',
          executionHint,
        })

        const response = await app.fetch(request, {})
        expect(response.status).not.toBe(400)
      }
    })
  })

  describe('server-side execution with D1', () => {
    it('executes query against D1 database', async () => {
      const mockResults = [
        { id: 1, name: 'Alice', email: 'alice@example.com' },
        { id: 2, name: 'Bob', email: 'bob@example.com' },
      ]
      const mockDB = createMockD1(mockResults)

      const request = createQueryRequest({
        sql: 'SELECT * FROM users',
        executionHint: 'server',
      })

      const response = await app.fetch(request, { DB: mockDB })
      const data = (await response.json()) as SQLQueryResponse

      expect(response.status).toBe(200)
      expect(data.data).toEqual(mockResults)
      expect(data.rowCount).toBe(2)
      expect(data.truncated).toBe(false)
    })

    it('includes column metadata in response', async () => {
      const mockResults = [
        { id: 1, name: 'Alice', score: 95.5 },
      ]
      const mockDB = createMockD1(mockResults)

      const request = createQueryRequest({
        sql: 'SELECT id, name, score FROM users',
        executionHint: 'server',
      })

      const response = await app.fetch(request, { DB: mockDB })
      const data = (await response.json()) as SQLQueryResponse

      expect(response.status).toBe(200)
      expect(data.columns).toBeDefined()
      expect(data.columns.length).toBe(3)
      expect(data.columns.map(c => c.name)).toEqual(['id', 'name', 'score'])
    })

    it('includes timing metrics', async () => {
      const mockDB = createMockD1([{ id: 1 }])

      const request = createQueryRequest({
        sql: 'SELECT 1 as id',
        executionHint: 'server',
      })

      const response = await app.fetch(request, { DB: mockDB })
      const data = (await response.json()) as SQLQueryResponse

      expect(response.status).toBe(200)
      expect(data.timing).toBeDefined()
      expect(data.timing.total).toBeTypeOf('number')
      expect(data.timing.planning).toBeTypeOf('number')
      expect(data.timing.execution).toBeTypeOf('number')
      expect(data.timing.serialization).toBeTypeOf('number')
    })

    it('respects limit parameter', async () => {
      const mockResults = Array.from({ length: 100 }, (_, i) => ({ id: i }))
      const mockDB = createMockD1(mockResults)

      const request = createQueryRequest({
        sql: 'SELECT * FROM users',
        executionHint: 'server',
        limit: 10,
      })

      const response = await app.fetch(request, { DB: mockDB })
      const data = (await response.json()) as SQLQueryResponse

      expect(response.status).toBe(200)
      expect(data.data.length).toBe(10)
      expect(data.rowCount).toBe(10)
      expect(data.truncated).toBe(true)
    })

    it('binds query parameters', async () => {
      const mockDB = createMockD1([{ id: 1, name: 'Alice' }])

      const request = createQueryRequest({
        sql: 'SELECT * FROM users WHERE id = ?',
        params: [1],
        executionHint: 'server',
      })

      const response = await app.fetch(request, { DB: mockDB })
      const data = (await response.json()) as SQLQueryResponse

      expect(response.status).toBe(200)
      expect(mockDB.prepare).toHaveBeenCalledWith('SELECT * FROM users WHERE id = ?')
    })

    it('uses ANALYTICS_DB if available', async () => {
      const mockAnalyticsDB = createMockD1([{ count: 100 }])
      const mockDB = createMockD1([])

      const request = createQueryRequest({
        sql: 'SELECT COUNT(*) as count FROM events',
        executionHint: 'server',
      })

      const response = await app.fetch(request, {
        DB: mockDB,
        ANALYTICS_DB: mockAnalyticsDB,
      })
      const data = (await response.json()) as SQLQueryResponse

      expect(response.status).toBe(200)
      expect(data.data[0]).toEqual({ count: 100 })
      // ANALYTICS_DB takes precedence
      expect(mockAnalyticsDB.prepare).toHaveBeenCalled()
    })
  })

  describe('client-side execution planning', () => {
    it('returns query plan for client execution', async () => {
      const request = createQueryRequest({
        sql: 'SELECT * FROM events GROUP BY user_id',
        executionHint: 'client',
        clientCapabilities: {
          duckdbWasm: true,
          maxMemoryMB: 512,
          opfsAvailable: true,
        },
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as QueryPlanResponse

      expect(response.status).toBe(200)
      expect(data.plan).toBeDefined()
      expect(data.plan.type).toBe('client_execute')
      expect(data.timing).toBeDefined()
      expect(data.timing.planning).toBeTypeOf('number')
    })

    it('includes optimized SQL in plan', async () => {
      const request = createQueryRequest({
        sql: 'SELECT * FROM events WHERE date >= "2025-01-01"',
        executionHint: 'client',
        clientCapabilities: {
          duckdbWasm: true,
          maxMemoryMB: 512,
          opfsAvailable: true,
        },
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as QueryPlanResponse

      expect(response.status).toBe(200)
      expect(data.plan.optimizedSql).toBeDefined()
    })

    it('includes cost estimates in plan', async () => {
      const request = createQueryRequest({
        sql: 'SELECT user_id, SUM(amount) FROM orders GROUP BY user_id',
        executionHint: 'client',
        clientCapabilities: {
          duckdbWasm: true,
          maxMemoryMB: 512,
          opfsAvailable: true,
        },
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as QueryPlanResponse

      expect(response.status).toBe(200)
      expect(data.plan.estimates).toBeDefined()
      expect(data.plan.estimates.rowCount).toBeTypeOf('number')
      expect(data.plan.estimates.dataSizeBytes).toBeTypeOf('number')
      expect(data.plan.estimates.executionTimeMs).toBeTypeOf('number')
    })
  })

  describe('error handling', () => {
    it('returns 400 for SQL syntax errors', async () => {
      const mockDB = {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => ({
            all: vi.fn(async () => {
              throw new Error('SQLITE_ERROR: near "FORM": syntax error')
            }),
          })),
          all: vi.fn(async () => {
            throw new Error('SQLITE_ERROR: near "FORM": syntax error')
          }),
        })),
      }

      const request = createQueryRequest({
        sql: 'SELECT * FORM users', // Intentional typo
        executionHint: 'server',
      })

      const response = await app.fetch(request, { DB: mockDB })
      const data = (await response.json()) as AnalyticsError

      expect(response.status).toBe(400)
      expect(data.error.code).toBe('INVALID_QUERY')
      expect(data.error.details?.message).toContain('syntax error')
    })

    it('returns query plan when no database available', async () => {
      const request = createQueryRequest({
        sql: 'SELECT * FROM users',
        executionHint: 'auto',
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as QueryPlanResponse

      expect(response.status).toBe(200)
      expect(data.plan).toBeDefined()
      expect(data.plan.type).toBe('client_execute')
    })
  })
})

// ============================================================================
// QUERY CLASSIFICATION ENDPOINT TESTS
// ============================================================================

describe('SQL Query API - Classification Endpoint', () => {
  let app: Hono<{ Bindings: MockEnv }>

  beforeEach(() => {
    app = createAnalyticsApp()
  })

  describe('query type classification', () => {
    it('classifies point lookup queries', async () => {
      const request = createClassifyRequest({
        sql: 'SELECT * FROM users WHERE id = 123',
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as QueryClassification

      expect(response.status).toBe(200)
      expect(data.type).toBe('point_lookup')
      expect(data.executionPath).toBe('point_lookup')
    })

    it('classifies analytics queries with aggregations', async () => {
      const request = createClassifyRequest({
        sql: 'SELECT user_id, COUNT(*) FROM events GROUP BY user_id',
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as QueryClassification

      expect(response.status).toBe(200)
      expect(data.type).toBe('analytics')
      expect(data.executionPath).toBe('browser_execute')
    })

    it('classifies federated queries with JOINs', async () => {
      const request = createClassifyRequest({
        sql: 'SELECT u.name, o.total FROM users u JOIN orders o ON u.id = o.user_id',
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as QueryClassification

      expect(response.status).toBe(200)
      expect(data.type).toBe('federated')
      expect(data.executionPath).toBe('federated_query')
    })

    it('classifies UNION queries as federated', async () => {
      const request = createClassifyRequest({
        sql: 'SELECT name FROM customers UNION SELECT name FROM prospects',
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as QueryClassification

      expect(response.status).toBe(200)
      expect(data.type).toBe('federated')
    })

    it('classifies SUM aggregation queries', async () => {
      const request = createClassifyRequest({
        sql: 'SELECT SUM(amount) FROM transactions',
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as QueryClassification

      expect(response.status).toBe(200)
      expect(data.type).toBe('analytics')
    })

    it('classifies AVG aggregation queries', async () => {
      const request = createClassifyRequest({
        sql: 'SELECT AVG(score) FROM reviews',
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as QueryClassification

      expect(response.status).toBe(200)
      expect(data.type).toBe('analytics')
    })

    it('classifies MAX/MIN aggregation queries', async () => {
      const request = createClassifyRequest({
        sql: 'SELECT MAX(price), MIN(price) FROM products',
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as QueryClassification

      expect(response.status).toBe(200)
      expect(data.type).toBe('analytics')
    })

    it('classifies window function queries', async () => {
      const request = createClassifyRequest({
        sql: 'SELECT name, ROW_NUMBER() OVER(ORDER BY created_at) FROM users',
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as QueryClassification

      expect(response.status).toBe(200)
      expect(data.type).toBe('analytics')
    })
  })

  describe('cost estimation', () => {
    it('estimates lower cost for point lookups', async () => {
      const request = createClassifyRequest({
        sql: 'SELECT * FROM users WHERE id = 1',
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as QueryClassification

      expect(response.status).toBe(200)
      expect(data.estimatedCost.computeMs).toBeLessThan(500)
      expect(data.estimatedCost.monetaryCost).toBeLessThan(0.001)
    })

    it('estimates higher cost for federated queries', async () => {
      const request = createClassifyRequest({
        sql: 'SELECT * FROM users JOIN orders ON users.id = orders.user_id',
      })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as QueryClassification

      expect(response.status).toBe(200)
      expect(data.estimatedCost.computeMs).toBeGreaterThan(100)
    })
  })

  describe('validation', () => {
    it('returns 400 for missing sql', async () => {
      const request = createClassifyRequest({})

      const response = await app.fetch(request, {})
      const data = (await response.json()) as AnalyticsError

      expect(response.status).toBe(400)
      expect(data.error.code).toBe('INVALID_QUERY')
    })

    it('returns 400 for non-string sql', async () => {
      const request = createClassifyRequest({ sql: 12345 })

      const response = await app.fetch(request, {})
      const data = (await response.json()) as AnalyticsError

      expect(response.status).toBe(400)
      expect(data.error.code).toBe('INVALID_QUERY')
    })
  })
})

// ============================================================================
// HEALTH ENDPOINT TESTS
// ============================================================================

describe('SQL Query API - Health Endpoint', () => {
  let app: Hono<{ Bindings: MockEnv }>

  beforeEach(() => {
    app = createAnalyticsApp()
  })

  it('returns health status', async () => {
    const request = new Request('http://test.api.dotdo.dev/v1/health')

    const response = await app.fetch(request, {})
    const data = (await response.json()) as HealthResponse

    expect(response.status).toBe(200)
    expect(data.status).toBe('ok')
    expect(data.timestamp).toBeDefined()
  })

  it('reports capabilities based on bindings', async () => {
    const request = new Request('http://test.api.dotdo.dev/v1/health')

    const response = await app.fetch(request, {
      VECTORS: {},
      R2: {},
      DB: createMockD1([]),
    })
    const data = (await response.json()) as HealthResponse

    expect(response.status).toBe(200)
    expect(data.capabilities.vectorSearch).toBe(true)
    expect(data.capabilities.r2Storage).toBe(true)
    expect(data.capabilities.d1Database).toBe(true)
  })

  it('reports missing capabilities', async () => {
    const request = new Request('http://test.api.dotdo.dev/v1/health')

    const response = await app.fetch(request, {})
    const data = (await response.json()) as HealthResponse

    expect(response.status).toBe(200)
    expect(data.capabilities.vectorSearch).toBe(false)
    expect(data.capabilities.r2Storage).toBe(false)
    expect(data.capabilities.d1Database).toBe(false)
  })
})

// ============================================================================
// AGGREGATION QUERY TESTS
// ============================================================================

describe('SQL Query API - Aggregation Queries', () => {
  let app: Hono<{ Bindings: MockEnv }>

  beforeEach(() => {
    app = createAnalyticsApp()
  })

  describe('COUNT aggregations', () => {
    it('executes COUNT(*) query', async () => {
      const mockDB = createMockD1([{ total: 1234 }])

      const request = createQueryRequest({
        sql: 'SELECT COUNT(*) as total FROM events',
        executionHint: 'server',
      })

      const response = await app.fetch(request, { DB: mockDB })
      const data = (await response.json()) as SQLQueryResponse

      expect(response.status).toBe(200)
      expect(data.data[0]).toEqual({ total: 1234 })
    })

    it('executes COUNT DISTINCT query', async () => {
      const mockDB = createMockD1([{ unique_users: 567 }])

      const request = createQueryRequest({
        sql: 'SELECT COUNT(DISTINCT user_id) as unique_users FROM events',
        executionHint: 'server',
      })

      const response = await app.fetch(request, { DB: mockDB })
      const data = (await response.json()) as SQLQueryResponse

      expect(response.status).toBe(200)
      expect(data.data[0]?.unique_users).toBe(567)
    })
  })

  describe('SUM aggregations', () => {
    it('executes SUM query', async () => {
      const mockDB = createMockD1([{ total_revenue: 99999.99 }])

      const request = createQueryRequest({
        sql: 'SELECT SUM(amount) as total_revenue FROM transactions',
        executionHint: 'server',
      })

      const response = await app.fetch(request, { DB: mockDB })
      const data = (await response.json()) as SQLQueryResponse

      expect(response.status).toBe(200)
      expect(data.data[0]?.total_revenue).toBe(99999.99)
    })

    it('executes SUM with GROUP BY', async () => {
      const mockDB = createMockD1([
        { category: 'electronics', total: 5000 },
        { category: 'clothing', total: 3000 },
        { category: 'books', total: 1500 },
      ])

      const request = createQueryRequest({
        sql: 'SELECT category, SUM(amount) as total FROM orders GROUP BY category',
        executionHint: 'server',
      })

      const response = await app.fetch(request, { DB: mockDB })
      const data = (await response.json()) as SQLQueryResponse

      expect(response.status).toBe(200)
      expect(data.data.length).toBe(3)
    })
  })

  describe('AVG aggregations', () => {
    it('executes AVG query', async () => {
      const mockDB = createMockD1([{ avg_score: 4.2 }])

      const request = createQueryRequest({
        sql: 'SELECT AVG(score) as avg_score FROM reviews',
        executionHint: 'server',
      })

      const response = await app.fetch(request, { DB: mockDB })
      const data = (await response.json()) as SQLQueryResponse

      expect(response.status).toBe(200)
      expect(data.data[0]?.avg_score).toBe(4.2)
    })
  })

  describe('MIN/MAX aggregations', () => {
    it('executes MIN/MAX query', async () => {
      const mockDB = createMockD1([{ min_price: 9.99, max_price: 999.99 }])

      const request = createQueryRequest({
        sql: 'SELECT MIN(price) as min_price, MAX(price) as max_price FROM products',
        executionHint: 'server',
      })

      const response = await app.fetch(request, { DB: mockDB })
      const data = (await response.json()) as SQLQueryResponse

      expect(response.status).toBe(200)
      expect(data.data[0]?.min_price).toBe(9.99)
      expect(data.data[0]?.max_price).toBe(999.99)
    })
  })

  describe('complex aggregations', () => {
    it('executes multi-aggregation query', async () => {
      const mockDB = createMockD1([
        {
          total_orders: 100,
          total_revenue: 50000,
          avg_order_value: 500,
          unique_customers: 75,
        },
      ])

      const request = createQueryRequest({
        sql: `
          SELECT
            COUNT(*) as total_orders,
            SUM(amount) as total_revenue,
            AVG(amount) as avg_order_value,
            COUNT(DISTINCT customer_id) as unique_customers
          FROM orders
        `,
        executionHint: 'server',
      })

      const response = await app.fetch(request, { DB: mockDB })
      const data = (await response.json()) as SQLQueryResponse

      expect(response.status).toBe(200)
      expect(data.data[0]).toEqual({
        total_orders: 100,
        total_revenue: 50000,
        avg_order_value: 500,
        unique_customers: 75,
      })
    })

    it('executes GROUP BY with HAVING', async () => {
      const mockDB = createMockD1([
        { category: 'electronics', order_count: 50 },
        { category: 'furniture', order_count: 30 },
      ])

      const request = createQueryRequest({
        sql: `
          SELECT category, COUNT(*) as order_count
          FROM orders
          GROUP BY category
          HAVING COUNT(*) > 25
        `,
        executionHint: 'server',
      })

      const response = await app.fetch(request, { DB: mockDB })
      const data = (await response.json()) as SQLQueryResponse

      expect(response.status).toBe(200)
      expect(data.data.length).toBe(2)
    })
  })
})

// ============================================================================
// 404 HANDLER TESTS
// ============================================================================

describe('SQL Query API - Error Handling', () => {
  let app: Hono<{ Bindings: MockEnv }>

  beforeEach(() => {
    app = createAnalyticsApp()
  })

  it('returns 404 for unknown paths', async () => {
    const request = new Request('http://test.api.dotdo.dev/v1/unknown-endpoint')

    const response = await app.fetch(request, {})
    const data = (await response.json()) as AnalyticsError

    expect(response.status).toBe(404)
    expect(data.error.code).toBe('INVALID_QUERY')
    expect(data.error.message).toContain('Not found')
  })
})
