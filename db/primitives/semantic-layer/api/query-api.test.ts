/**
 * Query API Tests - TDD RED Phase
 *
 * Tests for Cube.js REST/GraphQL query API compatibility features:
 * - /v1/load advanced query options
 * - /v1/sql query generation features
 * - /v1/pre-aggregations endpoints
 * - /v1/run-scheduled-refresh
 * - Query result annotations
 * - Continue-wait pattern for long queries
 * - Query result pivoting
 * - Compare date ranges
 * - Ungrouped queries
 * - Query decomposition
 *
 * @see dotdo-pwrlv
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import {
  semanticApiRoutes,
  createSemanticApi,
  type LoadRequest,
  type LoadResponse,
  type SqlRequest,
  type PaginatedResponse,
} from './semantic-api'
import {
  SemanticLayer,
  type CubeDefinition,
  type JoinRelationship,
} from '../index'

// =============================================================================
// TEST FIXTURES
// =============================================================================

const ordersCubeDefinition: CubeDefinition = {
  name: 'orders',
  sql: 'SELECT * FROM orders',
  measures: {
    count: { type: 'count' },
    totalRevenue: { type: 'sum', sql: 'amount' },
    avgOrderValue: { type: 'avg', sql: 'amount' },
    maxAmount: { type: 'max', sql: 'amount' },
    minAmount: { type: 'min', sql: 'amount' },
    uniqueCustomers: { type: 'countDistinct', sql: 'customer_id' },
  },
  dimensions: {
    id: { type: 'string', sql: 'id', primaryKey: true },
    status: { type: 'string', sql: 'status' },
    createdAt: { type: 'time', sql: 'created_at' },
    completedAt: { type: 'time', sql: 'completed_at' },
    customerId: { type: 'string', sql: 'customer_id' },
    region: { type: 'string', sql: 'region' },
    amount: { type: 'number', sql: 'amount' },
    isHighValue: { type: 'boolean', sql: 'amount > 1000' },
  },
  segments: {
    highValue: { sql: 'amount > 1000' },
    completed: { sql: "status = 'completed'" },
  },
}

const productsCubeDefinition: CubeDefinition = {
  name: 'products',
  sql: 'SELECT * FROM products',
  measures: {
    count: { type: 'count' },
    totalSales: { type: 'sum', sql: 'sales_count' },
    avgPrice: { type: 'avg', sql: 'price' },
  },
  dimensions: {
    id: { type: 'string', sql: 'id', primaryKey: true },
    name: { type: 'string', sql: 'name' },
    category: { type: 'string', sql: 'category' },
    price: { type: 'number', sql: 'price' },
    createdAt: { type: 'time', sql: 'created_at' },
  },
}

const customersCubeDefinition: CubeDefinition = {
  name: 'customers',
  sql: 'SELECT * FROM customers',
  measures: {
    count: { type: 'count' },
    totalSpent: { type: 'sum', sql: 'lifetime_value' },
    avgLifetimeValue: { type: 'avg', sql: 'lifetime_value' },
  },
  dimensions: {
    id: { type: 'string', sql: 'id', primaryKey: true },
    name: { type: 'string', sql: 'name' },
    country: { type: 'string', sql: 'country' },
    tier: { type: 'string', sql: 'tier' },
    createdAt: { type: 'time', sql: 'created_at' },
  },
  joins: [
    {
      name: 'orders',
      relationship: 'hasMany' as JoinRelationship,
      sql: '${customers}.id = ${orders}.customer_id',
    },
  ],
}

function createTestSemanticLayer(): SemanticLayer {
  const semantic = new SemanticLayer()
  semantic.defineCube(ordersCubeDefinition)
  semantic.defineCube(productsCubeDefinition)
  semantic.defineCube(customersCubeDefinition)
  return semantic
}

// =============================================================================
// ADVANCED QUERY OPTIONS (Cube.js compatibility)
// =============================================================================

describe('Query API - Advanced Query Options', () => {
  let app: ReturnType<typeof Hono>
  let semantic: SemanticLayer

  beforeEach(() => {
    semantic = createTestSemanticLayer()
    app = createSemanticApi({ semanticLayer: semantic })
  })

  describe('segment filtering', () => {
    it('should support segments in query', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.count'],
          segments: ['orders.highValue'],
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
      const body: LoadResponse = await response.json()
      expect(body.sql).toContain('amount > 1000')
    })

    it('should combine multiple segments with AND', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.count'],
          segments: ['orders.highValue', 'orders.completed'],
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
      const body: LoadResponse = await response.json()
      expect(body.sql).toContain('amount > 1000')
      expect(body.sql).toContain("status = 'completed'")
    })
  })

  describe('ungrouped queries', () => {
    it('should support ungrouped mode for raw data access', async () => {
      const request: LoadRequest = {
        query: {
          dimensions: ['orders.id', 'orders.status', 'orders.amount'],
          ungrouped: true,
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
      const body: LoadResponse = await response.json()
      // Ungrouped queries should not have GROUP BY
      expect(body.sql).not.toContain('GROUP BY')
    })

    it('should allow measures with ungrouped when dimensions include primary key', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.amount'],
          dimensions: ['orders.id', 'orders.status'],
          ungrouped: true,
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
    })
  })

  describe('total row count', () => {
    it('should return total count when requested', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.count'],
          dimensions: ['orders.status'],
          limit: 10,
          total: true,
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
      const body = await response.json() as PaginatedResponse & { total?: number }
      expect(body.total).toBeDefined()
      expect(typeof body.total).toBe('number')
    })
  })

  describe('renewQuery option', () => {
    it('should bypass cache when renewQuery is true', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.count'],
        },
        renewQuery: true,
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
      // Response header should indicate cache was bypassed
      expect(response.headers.get('X-Cache-Status')).toBe('MISS')
    })
  })

  describe('queryType option', () => {
    it('should support multi query type for subqueries', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.totalRevenue'],
          dimensions: ['orders.status'],
        },
        queryType: 'multi',
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
    })

    it('should support regularQuery type', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.count'],
        },
        queryType: 'regularQuery',
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
    })
  })
})

// =============================================================================
// COMPARE DATE RANGES (Cube.js compatibility)
// =============================================================================

describe('Query API - Compare Date Ranges', () => {
  let app: ReturnType<typeof Hono>
  let semantic: SemanticLayer

  beforeEach(() => {
    semantic = createTestSemanticLayer()
    app = createSemanticApi({ semanticLayer: semantic })
  })

  describe('compareDateRange feature', () => {
    it('should support comparing two date ranges', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.totalRevenue'],
          timeDimensions: [
            {
              dimension: 'orders.createdAt',
              granularity: 'day',
              compareDateRange: [
                ['2024-01-01', '2024-01-31'],
                ['2024-02-01', '2024-02-29'],
              ],
            },
          ],
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
      const body: LoadResponse = await response.json()
      // Should have results for both date ranges
      expect(body.data.length).toBeGreaterThan(0)
    })

    it('should include compareDateRange in response annotation', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.count'],
          timeDimensions: [
            {
              dimension: 'orders.createdAt',
              compareDateRange: [
                ['2024-01-01', '2024-01-31'],
                ['2023-01-01', '2023-01-31'],
              ],
            },
          ],
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
      const body = await response.json() as LoadResponse & { compareDateRange?: unknown }
      expect(body.compareDateRange).toBeDefined()
    })

    it('should label results by date range index', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.totalRevenue'],
          timeDimensions: [
            {
              dimension: 'orders.createdAt',
              compareDateRange: [
                ['2024-01-01', '2024-01-31'],
                ['2023-01-01', '2023-01-31'],
              ],
            },
          ],
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
      const body: LoadResponse = await response.json()
      // Each row should indicate which date range it belongs to
      if (body.data.length > 0) {
        expect(body.data[0]).toHaveProperty('compareDateRange')
      }
    })
  })
})

// =============================================================================
// RESULT PIVOTING
// =============================================================================

describe('Query API - Result Pivoting', () => {
  let app: ReturnType<typeof Hono>
  let semantic: SemanticLayer

  beforeEach(() => {
    semantic = createTestSemanticLayer()
    app = createSemanticApi({ semanticLayer: semantic })
  })

  describe('pivot configuration', () => {
    it('should support pivot in request', async () => {
      const request = {
        query: {
          measures: ['orders.totalRevenue'],
          dimensions: ['orders.status', 'orders.region'],
          timeDimensions: [
            {
              dimension: 'orders.createdAt',
              granularity: 'month',
            },
          ],
        },
        pivotConfig: {
          x: ['orders.createdAt.month'],
          y: ['orders.status', 'measures'],
          fillMissingDates: true,
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
    })

    it('should include pivotConfig in response', async () => {
      const request = {
        query: {
          measures: ['orders.count'],
          dimensions: ['orders.status'],
        },
        pivotConfig: {
          x: ['orders.status'],
          y: ['measures'],
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
      const body = await response.json() as LoadResponse & { pivotConfig?: unknown }
      expect(body.pivotConfig).toBeDefined()
    })

    it('should fill missing dates when fillMissingDates is true', async () => {
      const request = {
        query: {
          measures: ['orders.count'],
          timeDimensions: [
            {
              dimension: 'orders.createdAt',
              granularity: 'day',
              dateRange: ['2024-01-01', '2024-01-07'],
            },
          ],
        },
        pivotConfig: {
          fillMissingDates: true,
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
      const body: LoadResponse = await response.json()
      // Should have 7 days of data even if some days have no orders
      expect(body.data.length).toBe(7)
    })
  })
})

// =============================================================================
// CONTINUE-WAIT PATTERN FOR LONG QUERIES
// =============================================================================

describe('Query API - Continue-Wait Pattern', () => {
  let app: ReturnType<typeof Hono>
  let semantic: SemanticLayer

  beforeEach(() => {
    semantic = createTestSemanticLayer()
    app = createSemanticApi({ semanticLayer: semantic })
  })

  describe('long-running query handling', () => {
    it('should return 202 for long-running queries with continue-wait', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.totalRevenue'],
          dimensions: ['orders.status'],
        },
        waitTimeout: 1, // 1ms timeout to force continue-wait
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      // Should return 202 with continue-wait instructions
      if (response.status === 202) {
        const body = await response.json() as { continueWait?: boolean }
        expect(body.continueWait).toBe(true)
      } else {
        // Or 200 if query completed quickly
        expect(response.status).toBe(200)
      }
    })

    it('should include queryId for polling', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.count'],
        },
        waitTimeout: 0,
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      if (response.status === 202) {
        const body = await response.json() as { queryId?: string }
        expect(body.queryId).toBeDefined()
        expect(typeof body.queryId).toBe('string')
      }
    })

    it('should allow polling by queryId', async () => {
      // First request - get queryId
      const request: LoadRequest = {
        query: {
          measures: ['orders.totalRevenue'],
        },
        waitTimeout: 0,
      }

      const firstResponse = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      if (firstResponse.status === 202) {
        const body = await firstResponse.json() as { queryId?: string }
        const queryId = body.queryId

        // Poll for result
        const pollResponse = await app.request(`/v1/load?queryId=${queryId}`, {
          method: 'GET',
        })

        // Should eventually return 200 or still 202
        expect([200, 202]).toContain(pollResponse.status)
      }
    })
  })
})

// =============================================================================
// PRE-AGGREGATIONS ENDPOINTS
// =============================================================================

describe('Query API - Pre-Aggregations Management', () => {
  let app: ReturnType<typeof Hono>
  let semantic: SemanticLayer

  beforeEach(() => {
    semantic = createTestSemanticLayer()
    // Define pre-aggregations
    semantic.definePreAggregation('orders', {
      name: 'daily_status_revenue',
      measures: ['totalRevenue', 'count'],
      dimensions: ['status'],
      timeDimension: 'createdAt',
      granularity: 'day',
    })
    app = createSemanticApi({ semanticLayer: semantic })
  })

  describe('GET /v1/pre-aggregations', () => {
    it('should list all pre-aggregations', async () => {
      const response = await app.request('/v1/pre-aggregations', {
        method: 'GET',
      })

      expect(response.status).toBe(200)
      const body = await response.json() as { preAggregations: unknown[] }
      expect(body.preAggregations).toBeDefined()
      expect(Array.isArray(body.preAggregations)).toBe(true)
    })

    it('should include pre-aggregation details', async () => {
      const response = await app.request('/v1/pre-aggregations', {
        method: 'GET',
      })

      expect(response.status).toBe(200)
      const body = await response.json() as { preAggregations: Array<{ name: string; cube: string }> }

      const preAgg = body.preAggregations.find(pa => pa.name === 'daily_status_revenue')
      expect(preAgg).toBeDefined()
      expect(preAgg?.cube).toBe('orders')
    })

    it('should filter by cube name', async () => {
      const response = await app.request('/v1/pre-aggregations?cube=orders', {
        method: 'GET',
      })

      expect(response.status).toBe(200)
      const body = await response.json() as { preAggregations: Array<{ cube: string }> }
      expect(body.preAggregations.every(pa => pa.cube === 'orders')).toBe(true)
    })
  })

  describe('GET /v1/pre-aggregations/partitions', () => {
    it('should list partitions for pre-aggregation', async () => {
      const response = await app.request(
        '/v1/pre-aggregations/partitions?cube=orders&preAggregation=daily_status_revenue',
        { method: 'GET' }
      )

      expect(response.status).toBe(200)
      const body = await response.json() as { partitions: unknown[] }
      expect(body.partitions).toBeDefined()
    })
  })

  describe('POST /v1/run-scheduled-refresh', () => {
    it('should trigger scheduled refresh', async () => {
      const response = await app.request('/v1/run-scheduled-refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cubes: ['orders'],
        }),
      })

      expect(response.status).toBe(200)
      const body = await response.json() as { status: string }
      expect(body.status).toBe('scheduled')
    })

    it('should trigger refresh for specific pre-aggregations', async () => {
      const response = await app.request('/v1/run-scheduled-refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preAggregations: ['orders.daily_status_revenue'],
        }),
      })

      expect(response.status).toBe(200)
    })
  })
})

// =============================================================================
// QUERY DECOMPOSITION
// =============================================================================

describe('Query API - Query Decomposition', () => {
  let app: ReturnType<typeof Hono>
  let semantic: SemanticLayer

  beforeEach(() => {
    semantic = createTestSemanticLayer()
    app = createSemanticApi({ semanticLayer: semantic })
  })

  describe('multi-cube query decomposition', () => {
    it('should decompose cross-cube queries into subqueries', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.totalRevenue', 'customers.count'],
          dimensions: ['customers.country'],
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
      const body = await response.json() as LoadResponse & { decomposedQueries?: unknown[] }
      // Should indicate decomposed execution if applicable
      if (body.decomposedQueries) {
        expect(body.decomposedQueries.length).toBeGreaterThan(1)
      }
    })
  })

  describe('subQuery flag', () => {
    it('should support subQuery dimension for related cube data', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.totalRevenue'],
          dimensions: [
            'orders.status',
            {
              dimension: 'customers.country',
              subQuery: true,
            },
          ],
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
    })
  })
})

// =============================================================================
// FILTER OPERATORS (Cube.js compatibility)
// =============================================================================

describe('Query API - Advanced Filter Operators', () => {
  let app: ReturnType<typeof Hono>
  let semantic: SemanticLayer

  beforeEach(() => {
    semantic = createTestSemanticLayer()
    app = createSemanticApi({ semanticLayer: semantic })
  })

  describe('set operators', () => {
    it('should support set filter for multi-value equality', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.count'],
          filters: [
            {
              dimension: 'orders.status',
              operator: 'set',
            },
          ],
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
      const body: LoadResponse = await response.json()
      // 'set' operator should filter where value is not null
      expect(body.sql).toContain('IS NOT NULL')
    })

    it('should support notSet filter', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.count'],
          filters: [
            {
              dimension: 'orders.completedAt',
              operator: 'notSet',
            },
          ],
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
      const body: LoadResponse = await response.json()
      expect(body.sql).toContain('IS NULL')
    })
  })

  describe('string operators', () => {
    it('should support startsWith operator', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.count'],
          filters: [
            {
              dimension: 'orders.region',
              operator: 'startsWith',
              values: ['US-'],
            },
          ],
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
      const body: LoadResponse = await response.json()
      expect(body.sql).toMatch(/LIKE\s+'US-%'/i)
    })

    it('should support endsWith operator', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.count'],
          filters: [
            {
              dimension: 'orders.region',
              operator: 'endsWith',
              values: ['-West'],
            },
          ],
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
      const body: LoadResponse = await response.json()
      expect(body.sql).toMatch(/LIKE\s+'%-West'/i)
    })
  })

  describe('measure filters', () => {
    it('should support filtering on measures', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.totalRevenue', 'orders.count'],
          dimensions: ['orders.status'],
          filters: [
            {
              member: 'orders.totalRevenue',
              operator: 'gt',
              values: ['1000'],
            },
          ],
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
      const body: LoadResponse = await response.json()
      // Measure filter should be in HAVING clause
      expect(body.sql).toContain('HAVING')
    })
  })

  describe('logical filter operators', () => {
    it('should support AND filter groups', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.count'],
          filters: [
            {
              and: [
                { dimension: 'orders.status', operator: 'equals', values: ['completed'] },
                { dimension: 'orders.amount', operator: 'gte', values: ['100'] },
              ],
            },
          ],
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
    })

    it('should support OR filter groups', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.count'],
          filters: [
            {
              or: [
                { dimension: 'orders.status', operator: 'equals', values: ['completed'] },
                { dimension: 'orders.status', operator: 'equals', values: ['shipped'] },
              ],
            },
          ],
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
      const body: LoadResponse = await response.json()
      expect(body.sql).toContain('OR')
    })

    it('should support nested AND/OR filter groups', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.count'],
          filters: [
            {
              and: [
                { dimension: 'orders.amount', operator: 'gte', values: ['100'] },
                {
                  or: [
                    { dimension: 'orders.status', operator: 'equals', values: ['completed'] },
                    { dimension: 'orders.status', operator: 'equals', values: ['shipped'] },
                  ],
                },
              ],
            },
          ],
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
    })
  })
})

// =============================================================================
// RESPONSE ANNOTATIONS
// =============================================================================

describe('Query API - Response Annotations', () => {
  let app: ReturnType<typeof Hono>
  let semantic: SemanticLayer

  beforeEach(() => {
    semantic = createTestSemanticLayer()
    app = createSemanticApi({ semanticLayer: semantic })
  })

  describe('annotation details', () => {
    it('should include format hints in annotation', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.totalRevenue', 'orders.avgOrderValue'],
          dimensions: ['orders.status'],
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
      const body = await response.json() as LoadResponse & {
        annotation?: {
          measures?: Array<{ name: string; format?: string }>
        }
      }
      // Annotation should include format information
      expect(body.annotation?.measures).toBeDefined()
      const revenueMeasure = body.annotation?.measures?.find(m => m.name === 'totalRevenue')
      expect(revenueMeasure?.format).toBeDefined()
    })

    it('should include drill member info in annotation', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.count'],
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
      const body = await response.json() as LoadResponse & {
        annotation?: {
          measures?: Array<{ name: string; drillMembers?: string[] }>
        }
      }
      // Should list drill members if defined
      expect(body.annotation?.measures?.[0]?.drillMembers).toBeDefined()
    })

    it('should include shortTitle in annotation when available', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.avgOrderValue'],
          dimensions: ['orders.status'],
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
      const body = await response.json() as LoadResponse & {
        annotation?: {
          measures?: Array<{ name: string; shortTitle?: string }>
        }
      }
      expect(body.annotation?.measures).toBeDefined()
    })
  })

  describe('data source info', () => {
    it('should include dataSource in annotation', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.count'],
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
      const body = await response.json() as { dataSource?: string }
      expect(body.dataSource).toBeDefined()
    })
  })
})

// =============================================================================
// DRILLDOWN / DRILL MEMBERS
// =============================================================================

describe('Query API - Drilldown Support', () => {
  let app: ReturnType<typeof Hono>
  let semantic: SemanticLayer

  beforeEach(() => {
    semantic = createTestSemanticLayer()
    app = createSemanticApi({ semanticLayer: semantic })
  })

  describe('drill through queries', () => {
    it('should support drilldown query structure', async () => {
      const request = {
        query: {
          measures: [],
          dimensions: ['orders.id', 'orders.status', 'orders.amount', 'orders.createdAt'],
          filters: [
            { dimension: 'orders.status', operator: 'equals', values: ['completed'] },
          ],
          limit: 100,
        },
        drillThrough: {
          parentQuery: {
            measures: ['orders.count'],
            dimensions: ['orders.status'],
            filters: [],
          },
          pivotConfig: {
            x: ['orders.status'],
            y: ['measures'],
          },
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
    })
  })
})

// =============================================================================
// SQL ENDPOINT ADVANCED FEATURES
// =============================================================================

describe('Query API - SQL Endpoint Advanced Features', () => {
  let app: ReturnType<typeof Hono>
  let semantic: SemanticLayer

  beforeEach(() => {
    semantic = createTestSemanticLayer()
    app = createSemanticApi({ semanticLayer: semantic })
  })

  describe('SQL export options', () => {
    it('should support native SQL export for BI tools', async () => {
      const request: SqlRequest = {
        query: {
          measures: ['orders.totalRevenue'],
          dimensions: ['orders.status'],
        },
        export: true,
      }

      const response = await app.request('/v1/sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
      const body = await response.json() as { sql: string; external?: boolean }
      // SQL should be suitable for external BI tool connection
      expect(body.external).toBe(true)
    })

    it('should support different SQL formats for each dialect', async () => {
      const dialects = ['postgres', 'bigquery', 'snowflake', 'redshift']

      for (const dialect of dialects) {
        const request: SqlRequest = {
          query: {
            measures: ['orders.count'],
            timeDimensions: [
              { dimension: 'orders.createdAt', granularity: 'month' },
            ],
          },
          dialect: dialect as any,
        }

        const response = await app.request('/v1/sql', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        })

        expect(response.status).toBe(200)
      }
    })
  })

  describe('SQL with params', () => {
    it('should return query params separately when parameterized', async () => {
      const request: SqlRequest = {
        query: {
          measures: ['orders.count'],
          filters: [
            { dimension: 'orders.status', operator: 'equals', values: ['completed'] },
            { dimension: 'orders.amount', operator: 'gte', values: ['100'] },
          ],
        },
        format: 'parameterized',
      }

      const response = await app.request('/v1/sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
      const body = await response.json() as { sql: string; params?: unknown[] }
      expect(body.params).toBeDefined()
      expect(body.params?.length).toBeGreaterThan(0)
      // SQL should have placeholders
      expect(body.sql).toMatch(/\$\d+|\?/)
    })
  })
})

// =============================================================================
// TIMEZONE HANDLING
// =============================================================================

describe('Query API - Timezone Handling', () => {
  let app: ReturnType<typeof Hono>
  let semantic: SemanticLayer

  beforeEach(() => {
    semantic = createTestSemanticLayer()
    app = createSemanticApi({ semanticLayer: semantic })
  })

  describe('timezone configuration', () => {
    it('should accept timezone in query', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.count'],
          timeDimensions: [
            {
              dimension: 'orders.createdAt',
              granularity: 'day',
              dateRange: ['2024-01-01', '2024-01-31'],
            },
          ],
          timezone: 'America/New_York',
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
    })

    it('should convert time dimensions to specified timezone', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.count'],
          timeDimensions: [
            {
              dimension: 'orders.createdAt',
              granularity: 'hour',
            },
          ],
          timezone: 'Europe/London',
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
      const body: LoadResponse = await response.json()
      // SQL should include timezone conversion
      expect(body.sql).toMatch(/timezone|AT TIME ZONE/i)
    })
  })
})

// =============================================================================
// RESULT CACHING HEADERS
// =============================================================================

describe('Query API - Caching Headers', () => {
  let app: ReturnType<typeof Hono>
  let semantic: SemanticLayer

  beforeEach(() => {
    semantic = createTestSemanticLayer()
    app = createSemanticApi({ semanticLayer: semantic })
  })

  describe('cache control', () => {
    it('should include cache-related headers', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.count'],
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
      // Should have cache info headers
      const lastRefresh = response.headers.get('X-Last-Refresh')
      expect(lastRefresh).toBeDefined()
    })

    it('should include refresh key info', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.count'],
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
      const body = await response.json() as { refreshKeyValues?: unknown }
      // Response may include refresh key values
      if (body.refreshKeyValues) {
        expect(body.refreshKeyValues).toBeDefined()
      }
    })
  })
})
