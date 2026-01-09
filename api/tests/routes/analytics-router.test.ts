/**
 * Analytics Router Tests
 *
 * Tests for the analytics query router:
 * - Vector search endpoint validation and response
 * - Point lookup endpoint validation and response
 * - SQL query endpoint validation and execution path selection
 * - Query classification
 *
 * @module tests/api/analytics-router
 */

import { describe, it, expect } from 'vitest'
import { analyticsRouter } from '../../analytics/router'

// ============================================================================
// TEST HELPERS
// ============================================================================

interface AnalyticsError {
  error: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

// Mock env for testing (minimal bindings)
const mockEnv = {} as Record<string, unknown>

async function request(method: string, path: string, body?: unknown): Promise<Response> {
  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
  }
  if (body !== undefined) {
    options.body = JSON.stringify(body)
  }
  return analyticsRouter.request(path, options, mockEnv)
}

async function get(path: string): Promise<Response> {
  return request('GET', path)
}

async function post(path: string, body: unknown): Promise<Response> {
  return request('POST', path, body)
}

// ============================================================================
// HEALTH CHECK TESTS
// ============================================================================

describe('GET /v1/health', () => {
  it('returns status ok', async () => {
    const res = await get('/v1/health')

    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.timestamp).toBeDefined()
  })

  it('includes capability flags', async () => {
    const res = await get('/v1/health')
    const body = await res.json()

    expect(body.capabilities).toBeDefined()
    expect(typeof body.capabilities.vectorSearch).toBe('boolean')
    expect(typeof body.capabilities.r2Storage).toBe('boolean')
    expect(typeof body.capabilities.d1Database).toBe('boolean')
  })
})

// ============================================================================
// VECTOR SEARCH TESTS
// ============================================================================

describe('POST /v1/search', () => {
  describe('request validation', () => {
    it('requires a query vector', async () => {
      const res = await post('/v1/search', {})

      expect(res.status).toBe(400)

      const body = (await res.json()) as AnalyticsError
      expect(body.error.code).toBe('INVALID_VECTOR')
      expect(body.error.details?.errors).toContain('query vector is required')
    })

    it('validates query is an array', async () => {
      const res = await post('/v1/search', {
        query: 'not an array',
      })

      expect(res.status).toBe(400)

      const body = (await res.json()) as AnalyticsError
      expect(body.error.code).toBe('INVALID_VECTOR')
      expect(body.error.details?.errors).toContain('query must be an array of numbers')
    })

    it('validates query contains numbers', async () => {
      const res = await post('/v1/search', {
        query: [1, 2, 'three', 4],
      })

      expect(res.status).toBe(400)

      const body = (await res.json()) as AnalyticsError
      expect(body.error.code).toBe('INVALID_VECTOR')
      expect(body.error.details?.errors).toContain('query must contain only valid numbers')
    })

    it('validates k is within bounds', async () => {
      const res = await post('/v1/search', {
        query: [1, 2, 3],
        k: 2000,
      })

      expect(res.status).toBe(400)

      const body = (await res.json()) as AnalyticsError
      expect(body.error.code).toBe('INVALID_VECTOR')
      expect(body.error.details?.errors).toContain('k must be between 1 and 1000')
    })

    it('validates metric is valid', async () => {
      const res = await post('/v1/search', {
        query: [1, 2, 3],
        metric: 'invalid',
      })

      expect(res.status).toBe(400)

      const body = (await res.json()) as AnalyticsError
      expect(body.error.code).toBe('INVALID_VECTOR')
    })

    it('validates nprobe is within bounds', async () => {
      const res = await post('/v1/search', {
        query: [1, 2, 3],
        nprobe: 200,
      })

      expect(res.status).toBe(400)

      const body = (await res.json()) as AnalyticsError
      expect(body.error.code).toBe('INVALID_VECTOR')
      expect(body.error.details?.errors).toContain('nprobe must be between 1 and 100')
    })

    it('returns 400 for invalid JSON', async () => {
      const res = await analyticsRouter.request('/v1/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json{',
      }, mockEnv)

      expect(res.status).toBe(400)

      const body = (await res.json()) as AnalyticsError
      expect(body.error.code).toBe('INVALID_QUERY')
    })
  })

  describe('successful requests', () => {
    it('accepts valid search request', async () => {
      const res = await post('/v1/search', {
        query: [0.1, 0.2, 0.3, 0.4, 0.5],
        k: 10,
        metric: 'cosine',
      })

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.results).toBeDefined()
      expect(Array.isArray(body.results)).toBe(true)
      expect(body.timing).toBeDefined()
      expect(body.timing.total).toBeGreaterThanOrEqual(0)
      expect(body.stats).toBeDefined()
    })

    it('uses default values when not specified', async () => {
      const res = await post('/v1/search', {
        query: [0.1, 0.2, 0.3],
      })

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.results).toBeDefined()
    })

    it('accepts filters', async () => {
      const res = await post('/v1/search', {
        query: [0.1, 0.2, 0.3],
        filters: [
          { field: 'type', operator: 'eq', value: 'document' },
          { field: 'score', operator: 'gte', value: 0.5 },
        ],
      })

      expect(res.status).toBe(200)
    })

    it('returns timing metrics', async () => {
      const res = await post('/v1/search', {
        query: [0.1, 0.2, 0.3],
      })

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.timing).toBeDefined()
      expect(typeof body.timing.total).toBe('number')
    })
  })
})

// ============================================================================
// POINT LOOKUP TESTS
// ============================================================================

describe('GET /v1/lookup/:table/:key', () => {
  describe('request validation', () => {
    it('validates table name format', async () => {
      const res = await get('/v1/lookup/123-invalid/key123')

      expect(res.status).toBe(400)

      const body = (await res.json()) as AnalyticsError
      expect(body.error.code).toBe('INVALID_QUERY')
      expect(body.error.message).toContain('Invalid table name')
    })
  })

  describe('successful requests', () => {
    it('returns lookup response structure', async () => {
      const res = await get('/v1/lookup/users/user123')

      // May be 200 (found) or 404 (not found)
      expect([200, 404]).toContain(res.status)

      const body = await res.json()
      expect(body.found).toBeDefined()
      expect(body.timing).toBeDefined()
      expect(body.source).toBeDefined()
    })

    it('accepts partition hints as query params', async () => {
      const res = await get('/v1/lookup/events/event456?ns=tenant-1&type=click&date=2024-01-15')

      expect([200, 404]).toContain(res.status)

      const body = await res.json()
      expect(body.source.table).toBe('events')
    })

    it('returns timing breakdown', async () => {
      const res = await get('/v1/lookup/items/item789')

      const body = await res.json()
      expect(body.timing).toBeDefined()
      expect(typeof body.timing.total).toBe('number')
      expect(typeof body.timing.metadataLookup).toBe('number')
      expect(typeof body.timing.partitionPrune).toBe('number')
      expect(typeof body.timing.dataFetch).toBe('number')
    })

    it('returns source information', async () => {
      const res = await get('/v1/lookup/products/prod001')

      const body = await res.json()
      expect(body.source).toBeDefined()
      expect(body.source.table).toBe('products')
    })
  })
})

// ============================================================================
// SQL QUERY TESTS
// ============================================================================

describe('POST /v1/query', () => {
  describe('request validation', () => {
    it('requires sql field', async () => {
      const res = await post('/v1/query', {})

      expect(res.status).toBe(400)

      const body = (await res.json()) as AnalyticsError
      expect(body.error.code).toBe('INVALID_QUERY')
      expect(body.error.details?.errors).toContain('sql is required')
    })

    it('validates sql is a string', async () => {
      const res = await post('/v1/query', {
        sql: 123,
      })

      expect(res.status).toBe(400)

      const body = (await res.json()) as AnalyticsError
      expect(body.error.code).toBe('INVALID_QUERY')
      expect(body.error.details?.errors).toContain('sql must be a string')
    })

    it('validates sql is not empty', async () => {
      const res = await post('/v1/query', {
        sql: '   ',
      })

      expect(res.status).toBe(400)

      const body = (await res.json()) as AnalyticsError
      expect(body.error.code).toBe('INVALID_QUERY')
      expect(body.error.details?.errors).toContain('sql cannot be empty')
    })

    it('validates executionHint values', async () => {
      const res = await post('/v1/query', {
        sql: 'SELECT * FROM users',
        executionHint: 'invalid',
      })

      expect(res.status).toBe(400)

      const body = (await res.json()) as AnalyticsError
      expect(body.error.code).toBe('INVALID_QUERY')
    })

    it('validates limit bounds', async () => {
      const res = await post('/v1/query', {
        sql: 'SELECT * FROM users',
        limit: 200000,
      })

      expect(res.status).toBe(400)

      const body = (await res.json()) as AnalyticsError
      expect(body.error.code).toBe('INVALID_QUERY')
      expect(body.error.details?.errors).toContain('limit must be between 1 and 100000')
    })

    it('validates timeout bounds', async () => {
      const res = await post('/v1/query', {
        sql: 'SELECT * FROM users',
        timeout: 500, // Too low
      })

      expect(res.status).toBe(400)

      const body = (await res.json()) as AnalyticsError
      expect(body.error.code).toBe('INVALID_QUERY')
    })

    it('returns 400 for invalid JSON', async () => {
      const res = await analyticsRouter.request('/v1/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json{',
      }, mockEnv)

      expect(res.status).toBe(400)

      const body = (await res.json()) as AnalyticsError
      expect(body.error.code).toBe('INVALID_QUERY')
    })
  })

  describe('successful requests', () => {
    it('accepts valid query request', async () => {
      const res = await post('/v1/query', {
        sql: 'SELECT * FROM users',
      })

      expect(res.status).toBe(200)

      const body = await res.json()
      // Response could be QueryPlanResponse or SQLQueryResponse
      expect(body.timing).toBeDefined()
    })

    it('returns query plan for client execution hint', async () => {
      const res = await post('/v1/query', {
        sql: 'SELECT * FROM events GROUP BY type',
        executionHint: 'client',
        clientCapabilities: {
          duckdbWasm: true,
          maxMemoryMB: 1024,
          opfsAvailable: true,
        },
      })

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.plan).toBeDefined()
      expect(body.plan.type).toBe('client_execute')
    })

    it('returns timing information', async () => {
      const res = await post('/v1/query', {
        sql: 'SELECT id, name FROM items LIMIT 10',
      })

      expect(res.status).toBe(200)

      const body = await res.json()
      expect(body.timing).toBeDefined()
      expect(typeof body.timing.total).toBe('number')
      expect(typeof body.timing.planning).toBe('number')
    })

    it('accepts query parameters', async () => {
      const res = await post('/v1/query', {
        sql: 'SELECT * FROM users WHERE id = ?',
        params: ['user123'],
      })

      expect(res.status).toBe(200)
    })
  })
})

// ============================================================================
// QUERY CLASSIFICATION TESTS
// ============================================================================

describe('POST /v1/classify', () => {
  it('classifies point lookup queries', async () => {
    const res = await post('/v1/classify', {
      sql: "SELECT * FROM users WHERE id = 'user123'",
    })

    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.type).toBe('point_lookup')
    expect(body.executionPath).toBe('point_lookup')
  })

  it('classifies analytics queries with aggregations', async () => {
    const res = await post('/v1/classify', {
      sql: 'SELECT type, COUNT(*) FROM events GROUP BY type',
    })

    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.type).toBe('analytics')
    expect(body.executionPath).toBe('browser_execute')
  })

  it('classifies federated queries with JOINs', async () => {
    const res = await post('/v1/classify', {
      sql: 'SELECT u.name, o.total FROM users u JOIN orders o ON u.id = o.user_id',
    })

    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.type).toBe('federated')
    expect(body.executionPath).toBe('federated_query')
  })

  it('returns estimated costs', async () => {
    const res = await post('/v1/classify', {
      sql: 'SELECT * FROM users',
    })

    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.estimatedCost).toBeDefined()
    expect(typeof body.estimatedCost.computeMs).toBe('number')
    expect(typeof body.estimatedCost.dataSizeBytes).toBe('number')
    expect(typeof body.estimatedCost.monetaryCost).toBe('number')
  })

  it('returns 400 when sql is missing', async () => {
    const res = await post('/v1/classify', {})

    expect(res.status).toBe(400)

    const body = (await res.json()) as AnalyticsError
    expect(body.error.code).toBe('INVALID_QUERY')
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('Error Handling', () => {
  it('returns 404 for unknown endpoints', async () => {
    const res = await get('/v1/unknown')

    expect(res.status).toBe(404)

    const body = (await res.json()) as AnalyticsError
    expect(body.error.code).toBe('INVALID_QUERY')
    expect(body.error.message).toContain('Not found')
  })

  it('returns JSON content type on errors', async () => {
    const res = await post('/v1/search', {})

    expect(res.headers.get('content-type')).toContain('application/json')
  })

  it('includes error code in all error responses', async () => {
    const res = await post('/v1/query', {})

    const body = (await res.json()) as AnalyticsError
    expect(body.error).toBeDefined()
    expect(body.error.code).toBeDefined()
    expect(body.error.message).toBeDefined()
  })
})

// ============================================================================
// CONTENT TYPE TESTS
// ============================================================================

describe('Content Type Handling', () => {
  it('returns JSON content type on success', async () => {
    const res = await get('/v1/health')

    expect(res.headers.get('content-type')).toContain('application/json')
  })

  it('returns JSON content type on vector search response', async () => {
    const res = await post('/v1/search', {
      query: [0.1, 0.2, 0.3],
    })

    expect(res.headers.get('content-type')).toContain('application/json')
  })

  it('returns JSON content type on lookup response', async () => {
    const res = await get('/v1/lookup/users/test')

    expect(res.headers.get('content-type')).toContain('application/json')
  })

  it('returns JSON content type on query response', async () => {
    const res = await post('/v1/query', {
      sql: 'SELECT 1',
    })

    expect(res.headers.get('content-type')).toContain('application/json')
  })
})

// ============================================================================
// HTTP METHOD TESTS
// ============================================================================

describe('HTTP Methods', () => {
  it('supports POST on /v1/search', async () => {
    const res = await post('/v1/search', {
      query: [0.1, 0.2, 0.3],
    })
    expect([200, 400, 500]).toContain(res.status)
  })

  it('supports GET on /v1/lookup/:table/:key', async () => {
    const res = await get('/v1/lookup/users/test')
    expect([200, 400, 404]).toContain(res.status)
  })

  it('supports POST on /v1/query', async () => {
    const res = await post('/v1/query', {
      sql: 'SELECT 1',
    })
    expect([200, 400, 500]).toContain(res.status)
  })

  it('supports GET on /v1/health', async () => {
    const res = await get('/v1/health')
    expect(res.status).toBe(200)
  })

  it('supports POST on /v1/classify', async () => {
    const res = await post('/v1/classify', {
      sql: 'SELECT 1',
    })
    expect([200, 400]).toContain(res.status)
  })
})
