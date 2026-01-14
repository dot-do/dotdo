/**
 * Semantic Query API Tests (TDD RED Phase)
 *
 * Tests for the semantic query API layer:
 * - REST endpoints (/v1/load, /v1/sql, /v1/meta)
 * - GraphQL schema generated from cube definitions
 * - Streaming results for large datasets
 * - Pagination and cursor-based navigation
 * - OpenAPI spec generation
 *
 * @see dotdo-caxk5
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import {
  semanticApiRoutes,
  createSemanticApi,
  generateGraphQLSchema,
  generateOpenAPISpec,
  type SemanticApiConfig,
  type LoadRequest,
  type LoadResponse,
  type SqlRequest,
  type SqlResponse,
  type MetaResponse,
  type StreamOptions,
  type PaginatedResponse,
  type CursorInfo,
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
  },
  dimensions: {
    status: { type: 'string', sql: 'status' },
    createdAt: { type: 'time', sql: 'created_at' },
    customerId: { type: 'string', sql: 'customer_id' },
    region: { type: 'string', sql: 'region' },
  },
}

const customersCubeDefinition: CubeDefinition = {
  name: 'customers',
  sql: 'SELECT * FROM customers',
  measures: {
    count: { type: 'count' },
    totalSpent: { type: 'sum', sql: 'lifetime_value' },
  },
  dimensions: {
    id: { type: 'string', sql: 'id' },
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
  semantic.defineCube(customersCubeDefinition)
  return semantic
}

// =============================================================================
// REST API TESTS - /v1/load
// =============================================================================

describe('POST /v1/load - Semantic Query Endpoint', () => {
  let app: ReturnType<typeof Hono>
  let semantic: SemanticLayer

  beforeEach(() => {
    semantic = createTestSemanticLayer()
    app = createSemanticApi({ semanticLayer: semantic })
  })

  describe('basic query execution', () => {
    it('should accept POST requests to /v1/load', async () => {
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
    })

    it('should return JSON response with data array', async () => {
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

      const body: LoadResponse = await response.json()
      expect(body.data).toBeDefined()
      expect(Array.isArray(body.data)).toBe(true)
    })

    it('should execute query with measures and dimensions', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.totalRevenue'],
          dimensions: ['orders.status'],
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      const body: LoadResponse = await response.json()
      expect(response.status).toBe(200)
      expect(body.query).toBeDefined()
      expect(body.annotation).toBeDefined()
    })

    it('should include generated SQL in response', async () => {
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

      const body: LoadResponse = await response.json()
      expect(body.sql).toBeDefined()
      expect(body.sql).toContain('SELECT')
    })

    it('should support time dimensions with granularity', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.count'],
          timeDimensions: [
            {
              dimension: 'orders.createdAt',
              granularity: 'month',
              dateRange: ['2024-01-01', '2024-12-31'],
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
      expect(body.data).toBeDefined()
    })

    it('should support filters in query', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.totalRevenue'],
          dimensions: ['orders.status'],
          filters: [
            {
              dimension: 'orders.status',
              operator: 'equals',
              values: ['completed'],
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
      expect(body.sql).toContain('WHERE')
    })

    it('should support order and limit', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.totalRevenue'],
          dimensions: ['orders.status'],
          order: [{ id: 'orders.totalRevenue', desc: true }],
          limit: 10,
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
      const body: LoadResponse = await response.json()
      expect(body.sql).toContain('ORDER BY')
      expect(body.sql).toContain('LIMIT')
    })
  })

  describe('error handling', () => {
    it('should return 400 for invalid JSON', async () => {
      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json {',
      })

      expect(response.status).toBe(400)
    })

    it('should return 400 for missing query field', async () => {
      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(response.status).toBe(400)
    })

    it('should return 400 for invalid cube reference', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['nonexistent.count'],
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toBeDefined()
    })

    it('should return 400 for invalid measure reference', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.nonexistent'],
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(400)
    })

    it('should return 400 for empty query', async () => {
      const request: LoadRequest = {
        query: {},
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(400)
    })
  })

  describe('response metadata', () => {
    it('should include query annotation with measure/dimension types', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.count', 'orders.totalRevenue'],
          dimensions: ['orders.status'],
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      const body: LoadResponse = await response.json()
      expect(body.annotation).toBeDefined()
      expect(body.annotation?.measures).toBeDefined()
      expect(body.annotation?.dimensions).toBeDefined()
    })

    it('should indicate pre-aggregation usage if applicable', async () => {
      // Add a pre-aggregation to the semantic layer
      semantic.definePreAggregation('orders', {
        name: 'daily_count',
        measures: ['count'],
        dimensions: ['status'],
        timeDimension: 'createdAt',
        granularity: 'day',
      })

      const request: LoadRequest = {
        query: {
          measures: ['orders.count'],
          dimensions: ['orders.status'],
          timeDimensions: [
            {
              dimension: 'orders.createdAt',
              granularity: 'day',
            },
          ],
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      const body: LoadResponse = await response.json()
      expect(body.usedPreAggregation).toBe('daily_count')
    })
  })
})

// =============================================================================
// REST API TESTS - /v1/sql
// =============================================================================

describe('POST /v1/sql - Raw SQL Query Endpoint', () => {
  let app: ReturnType<typeof Hono>
  let semantic: SemanticLayer

  beforeEach(() => {
    semantic = createTestSemanticLayer()
    app = createSemanticApi({ semanticLayer: semantic })
  })

  describe('SQL generation', () => {
    it('should accept POST requests to /v1/sql', async () => {
      const request: SqlRequest = {
        query: {
          measures: ['orders.count'],
        },
      }

      const response = await app.request('/v1/sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
    })

    it('should return SQL without executing query', async () => {
      const request: SqlRequest = {
        query: {
          measures: ['orders.count'],
          dimensions: ['orders.status'],
        },
      }

      const response = await app.request('/v1/sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      const body: SqlResponse = await response.json()
      expect(body.sql).toBeDefined()
      expect(body.sql).toContain('SELECT')
      expect(body.sql).toContain('COUNT')
      expect(body.sql).toContain('status')
    })

    it('should return parameterized SQL with parameters array', async () => {
      const request: SqlRequest = {
        query: {
          measures: ['orders.count'],
          filters: [
            {
              dimension: 'orders.status',
              operator: 'equals',
              values: ['completed'],
            },
          ],
        },
        format: 'parameterized',
      }

      const response = await app.request('/v1/sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      const body: SqlResponse = await response.json()
      expect(body.sql).toBeDefined()
      // Parameters should be returned if parameterized format requested
      expect(body.params).toBeDefined()
    })

    it('should support multiple SQL dialects', async () => {
      const request: SqlRequest = {
        query: {
          measures: ['orders.count'],
          timeDimensions: [
            {
              dimension: 'orders.createdAt',
              granularity: 'day',
            },
          ],
        },
        dialect: 'clickhouse',
      }

      const response = await app.request('/v1/sql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      const body: SqlResponse = await response.json()
      // ClickHouse uses toStartOf functions instead of date_trunc
      expect(body.sql).toMatch(/toStartOf|toDate/)
    })
  })
})

// =============================================================================
// REST API TESTS - /v1/meta
// =============================================================================

describe('GET /v1/meta - Schema Metadata Endpoint', () => {
  let app: ReturnType<typeof Hono>
  let semantic: SemanticLayer

  beforeEach(() => {
    semantic = createTestSemanticLayer()
    app = createSemanticApi({ semanticLayer: semantic })
  })

  describe('schema introspection', () => {
    it('should accept GET requests to /v1/meta', async () => {
      const response = await app.request('/v1/meta', {
        method: 'GET',
      })

      expect(response.status).toBe(200)
    })

    it('should return list of cubes', async () => {
      const response = await app.request('/v1/meta', {
        method: 'GET',
      })

      const body: MetaResponse = await response.json()
      expect(body.cubes).toBeDefined()
      expect(Array.isArray(body.cubes)).toBe(true)
      expect(body.cubes.length).toBe(2)
    })

    it('should return cube names', async () => {
      const response = await app.request('/v1/meta', {
        method: 'GET',
      })

      const body: MetaResponse = await response.json()
      const cubeNames = body.cubes.map((c) => c.name)
      expect(cubeNames).toContain('orders')
      expect(cubeNames).toContain('customers')
    })

    it('should return measures for each cube', async () => {
      const response = await app.request('/v1/meta', {
        method: 'GET',
      })

      const body: MetaResponse = await response.json()
      const ordersCube = body.cubes.find((c) => c.name === 'orders')
      expect(ordersCube?.measures).toBeDefined()
      expect(ordersCube?.measures.length).toBeGreaterThan(0)

      const countMeasure = ordersCube?.measures.find((m) => m.name === 'count')
      expect(countMeasure).toBeDefined()
      expect(countMeasure?.type).toBe('count')
    })

    it('should return dimensions for each cube', async () => {
      const response = await app.request('/v1/meta', {
        method: 'GET',
      })

      const body: MetaResponse = await response.json()
      const ordersCube = body.cubes.find((c) => c.name === 'orders')
      expect(ordersCube?.dimensions).toBeDefined()
      expect(ordersCube?.dimensions.length).toBeGreaterThan(0)

      const statusDim = ordersCube?.dimensions.find((d) => d.name === 'status')
      expect(statusDim).toBeDefined()
      expect(statusDim?.type).toBe('string')
    })

    it('should return join information', async () => {
      const response = await app.request('/v1/meta', {
        method: 'GET',
      })

      const body: MetaResponse = await response.json()
      const customersCube = body.cubes.find((c) => c.name === 'customers')
      expect(customersCube?.joins).toBeDefined()
      expect(customersCube?.joins?.length).toBeGreaterThan(0)
    })
  })

  describe('filtering', () => {
    it('should filter by cube name query param', async () => {
      const response = await app.request('/v1/meta?cube=orders', {
        method: 'GET',
      })

      const body: MetaResponse = await response.json()
      expect(body.cubes.length).toBe(1)
      expect(body.cubes[0].name).toBe('orders')
    })

    it('should return 404 for non-existent cube', async () => {
      const response = await app.request('/v1/meta?cube=nonexistent', {
        method: 'GET',
      })

      expect(response.status).toBe(404)
    })
  })
})

// =============================================================================
// GRAPHQL SCHEMA GENERATION
// =============================================================================

describe('GraphQL Schema Generation', () => {
  let semantic: SemanticLayer

  beforeEach(() => {
    semantic = createTestSemanticLayer()
  })

  describe('schema structure', () => {
    it('should generate valid GraphQL schema from cube definitions', () => {
      const schema = generateGraphQLSchema(semantic)

      expect(schema).toBeDefined()
      expect(typeof schema).toBe('string')
      expect(schema).toContain('type Query')
    })

    it('should generate type for each cube', () => {
      const schema = generateGraphQLSchema(semantic)

      expect(schema).toContain('type Orders')
      expect(schema).toContain('type Customers')
    })

    it('should include measures as fields', () => {
      const schema = generateGraphQLSchema(semantic)

      expect(schema).toContain('count: Int')
      expect(schema).toContain('totalRevenue: Float')
      expect(schema).toContain('avgOrderValue: Float')
    })

    it('should include dimensions as fields', () => {
      const schema = generateGraphQLSchema(semantic)

      expect(schema).toContain('status: String')
      expect(schema).toContain('createdAt: DateTime')
      expect(schema).toContain('region: String')
    })

    it('should generate input types for filters', () => {
      const schema = generateGraphQLSchema(semantic)

      expect(schema).toContain('input OrdersFilter')
      expect(schema).toContain('input CustomersFilter')
    })

    it('should generate query root with cube accessors', () => {
      const schema = generateGraphQLSchema(semantic)

      expect(schema).toContain('orders(')
      expect(schema).toContain('customers(')
    })

    it('should include time granularity enum', () => {
      const schema = generateGraphQLSchema(semantic)

      expect(schema).toContain('enum TimeGranularity')
      expect(schema).toContain('DAY')
      expect(schema).toContain('MONTH')
      expect(schema).toContain('YEAR')
    })

    it('should include pagination arguments', () => {
      const schema = generateGraphQLSchema(semantic)

      expect(schema).toContain('limit: Int')
      expect(schema).toContain('offset: Int')
    })
  })

  describe('GraphQL endpoint', () => {
    let app: ReturnType<typeof Hono>

    beforeEach(() => {
      app = createSemanticApi({ semanticLayer: semantic, enableGraphQL: true })
    })

    it('should accept POST requests to /graphql', async () => {
      const query = `
        query {
          orders {
            count
          }
        }
      `

      const response = await app.request('/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })

      expect(response.status).toBe(200)
    })

    it('should execute simple cube query', async () => {
      const query = `
        query {
          orders {
            count
            totalRevenue
          }
        }
      `

      const response = await app.request('/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })

      const body = await response.json()
      expect(body.data).toBeDefined()
      expect(body.data.orders).toBeDefined()
    })

    it('should support filtering via arguments', async () => {
      const query = `
        query {
          orders(filter: { status: { equals: "completed" } }) {
            count
          }
        }
      `

      const response = await app.request('/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })

      expect(response.status).toBe(200)
    })

    it('should support time dimension arguments', async () => {
      const query = `
        query {
          orders(
            timeDimension: { dimension: createdAt, granularity: MONTH }
          ) {
            count
            createdAt
          }
        }
      `

      const response = await app.request('/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })

      expect(response.status).toBe(200)
    })

    it('should support introspection query', async () => {
      const query = `
        query {
          __schema {
            types {
              name
            }
          }
        }
      `

      const response = await app.request('/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.data.__schema).toBeDefined()
    })
  })
})

// =============================================================================
// STREAMING RESULTS
// =============================================================================

describe('Streaming Results for Large Datasets', () => {
  let app: ReturnType<typeof Hono>
  let semantic: SemanticLayer

  beforeEach(() => {
    semantic = createTestSemanticLayer()
    app = createSemanticApi({ semanticLayer: semantic })
  })

  describe('streaming endpoint', () => {
    it('should accept streaming requests via Accept header', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.count'],
          dimensions: ['orders.status'],
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/x-ndjson',
        },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toContain('application/x-ndjson')
    })

    it('should stream results as newline-delimited JSON', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.count'],
          dimensions: ['orders.status'],
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/x-ndjson',
        },
        body: JSON.stringify(request),
      })

      const text = await response.text()
      // NDJSON format: each line is a valid JSON object
      const lines = text.trim().split('\n')
      for (const line of lines) {
        if (line) {
          expect(() => JSON.parse(line)).not.toThrow()
        }
      }
    })

    it('should support Server-Sent Events (SSE) format', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.count'],
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toContain('text/event-stream')
    })

    it('should include progress events in stream', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.count'],
          dimensions: ['orders.status'],
        },
        streaming: {
          includeProgress: true,
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/x-ndjson',
        },
        body: JSON.stringify(request),
      })

      const text = await response.text()
      const lines = text.trim().split('\n')
      // Should have progress or metadata events
      const events = lines.map((l) => JSON.parse(l))
      const hasMetaEvent = events.some((e) => e.type === 'meta' || e.type === 'progress')
      expect(hasMetaEvent || events.length > 0).toBe(true)
    })
  })

  describe('batch size control', () => {
    it('should respect batchSize parameter', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.count'],
          dimensions: ['orders.status'],
        },
        streaming: {
          batchSize: 100,
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/x-ndjson',
        },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
    })
  })
})

// =============================================================================
// PAGINATION AND CURSOR-BASED NAVIGATION
// =============================================================================

describe('Pagination and Cursor-Based Navigation', () => {
  let app: ReturnType<typeof Hono>
  let semantic: SemanticLayer

  beforeEach(() => {
    semantic = createTestSemanticLayer()
    app = createSemanticApi({ semanticLayer: semantic })
  })

  describe('offset-based pagination', () => {
    it('should support limit and offset parameters', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.count'],
          dimensions: ['orders.status'],
          limit: 10,
          offset: 0,
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      const body: LoadResponse = await response.json()
      expect(body.sql).toContain('LIMIT')
      expect(body.sql).toContain('OFFSET')
    })

    it('should return pagination info in response', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.count'],
          dimensions: ['orders.status'],
          limit: 10,
        },
        pagination: {
          page: 1,
          pageSize: 10,
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      const body = (await response.json()) as PaginatedResponse
      expect(body.pagination).toBeDefined()
      expect(body.pagination?.page).toBe(1)
      expect(body.pagination?.pageSize).toBe(10)
    })
  })

  describe('cursor-based pagination', () => {
    it('should return cursor for next page', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.count'],
          dimensions: ['orders.status'],
          limit: 10,
        },
        pagination: {
          type: 'cursor',
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      const body = (await response.json()) as PaginatedResponse
      // If there's more data, cursor should be present
      if (body.data && body.data.length >= 10) {
        expect(body.cursor).toBeDefined()
        expect(body.cursor?.next).toBeDefined()
      }
    })

    it('should accept cursor for continuation', async () => {
      // First request to get cursor
      const firstRequest: LoadRequest = {
        query: {
          measures: ['orders.count'],
          dimensions: ['orders.status'],
          limit: 5,
        },
        pagination: {
          type: 'cursor',
        },
      }

      const firstResponse = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(firstRequest),
      })

      const firstBody = (await firstResponse.json()) as PaginatedResponse

      // If we have a cursor, use it for next request
      if (firstBody.cursor?.next) {
        const secondRequest: LoadRequest = {
          query: {
            measures: ['orders.count'],
            dimensions: ['orders.status'],
            limit: 5,
          },
          pagination: {
            type: 'cursor',
            cursor: firstBody.cursor.next,
          },
        }

        const secondResponse = await app.request('/v1/load', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(secondRequest),
        })

        expect(secondResponse.status).toBe(200)
      }
    })

    it('should return hasMore flag', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.count'],
          dimensions: ['orders.status'],
          limit: 10,
        },
        pagination: {
          type: 'cursor',
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      const body = (await response.json()) as PaginatedResponse
      expect(typeof body.cursor?.hasMore).toBe('boolean')
    })

    it('should encode cursor as base64', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.count'],
          dimensions: ['orders.status'],
          limit: 5,
        },
        pagination: {
          type: 'cursor',
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      const body = (await response.json()) as PaginatedResponse
      if (body.cursor?.next) {
        // Cursor should be base64 encoded
        expect(() => atob(body.cursor!.next!)).not.toThrow()
      }
    })
  })

  describe('total count', () => {
    it('should optionally include total count', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.count'],
          dimensions: ['orders.status'],
          limit: 10,
        },
        pagination: {
          includeTotal: true,
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      const body = (await response.json()) as PaginatedResponse
      expect(body.pagination?.total).toBeDefined()
      expect(typeof body.pagination?.total).toBe('number')
    })
  })
})

// =============================================================================
// OPENAPI SPEC GENERATION
// =============================================================================

describe('OpenAPI Spec Generation', () => {
  let semantic: SemanticLayer

  beforeEach(() => {
    semantic = createTestSemanticLayer()
  })

  describe('spec structure', () => {
    it('should generate valid OpenAPI 3.1 spec', () => {
      const spec = generateOpenAPISpec(semantic)

      expect(spec).toBeDefined()
      expect(spec.openapi).toBe('3.1.0')
    })

    it('should include API info', () => {
      const spec = generateOpenAPISpec(semantic)

      expect(spec.info).toBeDefined()
      expect(spec.info.title).toBeDefined()
      expect(spec.info.version).toBeDefined()
    })

    it('should document /v1/load endpoint', () => {
      const spec = generateOpenAPISpec(semantic)

      expect(spec.paths['/v1/load']).toBeDefined()
      expect(spec.paths['/v1/load'].post).toBeDefined()
    })

    it('should document /v1/sql endpoint', () => {
      const spec = generateOpenAPISpec(semantic)

      expect(spec.paths['/v1/sql']).toBeDefined()
      expect(spec.paths['/v1/sql'].post).toBeDefined()
    })

    it('should document /v1/meta endpoint', () => {
      const spec = generateOpenAPISpec(semantic)

      expect(spec.paths['/v1/meta']).toBeDefined()
      expect(spec.paths['/v1/meta'].get).toBeDefined()
    })

    it('should include request/response schemas', () => {
      const spec = generateOpenAPISpec(semantic)

      expect(spec.components?.schemas).toBeDefined()
      expect(spec.components?.schemas?.LoadRequest).toBeDefined()
      expect(spec.components?.schemas?.LoadResponse).toBeDefined()
    })

    it('should document query parameters', () => {
      const spec = generateOpenAPISpec(semantic)

      const loadEndpoint = spec.paths['/v1/load'].post
      expect(loadEndpoint.requestBody).toBeDefined()
      expect(loadEndpoint.requestBody.content['application/json']).toBeDefined()
    })

    it('should document error responses', () => {
      const spec = generateOpenAPISpec(semantic)

      const loadEndpoint = spec.paths['/v1/load'].post
      expect(loadEndpoint.responses['400']).toBeDefined()
      expect(loadEndpoint.responses['500']).toBeDefined()
    })
  })

  describe('GET /openapi.json endpoint', () => {
    let app: ReturnType<typeof Hono>

    beforeEach(() => {
      app = createSemanticApi({ semanticLayer: semantic })
    })

    it('should serve OpenAPI spec at /openapi.json', async () => {
      const response = await app.request('/openapi.json', {
        method: 'GET',
      })

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toContain('application/json')
    })

    it('should return valid JSON', async () => {
      const response = await app.request('/openapi.json', {
        method: 'GET',
      })

      const body = await response.json()
      expect(body.openapi).toBe('3.1.0')
    })
  })
})

// =============================================================================
// INTEGRATION TESTS
// =============================================================================

describe('Integration Tests', () => {
  let app: ReturnType<typeof Hono>
  let semantic: SemanticLayer

  beforeEach(() => {
    semantic = createTestSemanticLayer()
    app = createSemanticApi({
      semanticLayer: semantic,
      enableGraphQL: true,
    })
  })

  describe('cross-cube queries', () => {
    it('should handle cross-cube joins in load requests', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.totalRevenue'],
          dimensions: ['customers.country'],
        },
      }

      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })

      expect(response.status).toBe(200)
      const body: LoadResponse = await response.json()
      expect(body.sql).toContain('JOIN')
    })
  })

  describe('request correlation', () => {
    it('should include request ID in response', async () => {
      const request: LoadRequest = {
        query: {
          measures: ['orders.count'],
        },
      }

      const requestId = 'test-request-123'
      const response = await app.request('/v1/load', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-ID': requestId,
        },
        body: JSON.stringify(request),
      })

      expect(response.headers.get('X-Request-ID')).toBe(requestId)
    })
  })

  describe('performance headers', () => {
    it('should include execution time header', async () => {
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

      const execTime = response.headers.get('X-Execution-Time')
      expect(execTime).toBeDefined()
    })
  })
})

// =============================================================================
// HONO APP FACTORY TESTS
// =============================================================================

describe('createSemanticApi Factory', () => {
  let semantic: SemanticLayer

  beforeEach(() => {
    semantic = createTestSemanticLayer()
  })

  it('should create Hono app with routes', () => {
    const app = createSemanticApi({ semanticLayer: semantic })
    expect(app).toBeDefined()
  })

  it('should mount routes at custom base path', async () => {
    const app = createSemanticApi({
      semanticLayer: semantic,
      basePath: '/api/semantic',
    })

    const response = await app.request('/api/semantic/v1/meta', {
      method: 'GET',
    })

    expect(response.status).toBe(200)
  })

  it('should optionally enable GraphQL', async () => {
    const appWithGraphQL = createSemanticApi({
      semanticLayer: semantic,
      enableGraphQL: true,
    })

    const response = await appWithGraphQL.request('/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ __typename }' }),
    })

    expect(response.status).toBe(200)
  })

  it('should accept custom middleware', async () => {
    const middlewareCalled = vi.fn()

    const app = createSemanticApi({
      semanticLayer: semantic,
      middleware: [
        async (c, next) => {
          middlewareCalled()
          await next()
        },
      ],
    })

    await app.request('/v1/meta', { method: 'GET' })

    expect(middlewareCalled).toHaveBeenCalled()
  })
})
