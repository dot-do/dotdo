/**
 * Query Router Tests
 *
 * Tests for the query router worker:
 * - Query parsing for different request types
 * - Query classification (point lookup, vector search, analytics)
 * - Query routing to appropriate execution paths
 * - Error handling and timeouts
 * - Timing metrics
 *
 * @module tests/api/query-router
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import queryRouter, {
  parseQuery,
  classifySQL,
  routeQuery,
  QueryParseError,
  QueryRouteError,
  type ParsedQuery,
  type QueryResult,
} from '../../query-router'
import type { Env } from '../../types'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a mock Request object
 */
function mockRequest(
  method: string,
  path: string,
  body?: unknown,
  contentType = 'application/json'
): Request {
  const url = `https://test.example.com${path}`
  const init: RequestInit = {
    method,
    headers: new Headers({
      'Content-Type': contentType,
    }),
  }

  if (body !== undefined) {
    init.body = JSON.stringify(body)
  }

  return new Request(url, init)
}

/**
 * Create a mock environment
 */
function mockEnv(overrides: Partial<Env> = {}): Env {
  return {
    KV: {} as KVNamespace,
    DO: {} as DurableObjectNamespace,
    BROWSER_DO: {} as DurableObjectNamespace,
    SANDBOX_DO: {} as DurableObjectNamespace,
    OBS_BROADCASTER: {} as DurableObjectNamespace,
    TEST_KV: {} as KVNamespace,
    TEST_DO: {} as DurableObjectNamespace,
    ASSETS: {} as Fetcher,
    ...overrides,
  } as Env
}

// ============================================================================
// QUERY PARSING TESTS
// ============================================================================

describe('parseQuery', () => {
  describe('GET requests for point lookups', () => {
    it('parses /lookup/:table/:key pattern', async () => {
      const request = mockRequest('GET', '/lookup/users/user-123')
      const query = await parseQuery(request)

      expect(query.type).toBe('point_lookup')
      expect(query.executionPath).toBe('point_lookup')
      expect(query.table).toBe('users')
      expect(query.key).toBe('user-123')
    })

    it('extracts partition hints from query params', async () => {
      const request = mockRequest('GET', '/lookup/events/evt-456?ns=tenant-1&type=click&date=2024-01-15')
      const query = await parseQuery(request)

      expect(query.type).toBe('point_lookup')
      expect(query.table).toBe('events')
      expect(query.key).toBe('evt-456')
      expect(query.partition).toEqual({
        ns: 'tenant-1',
        type: 'click',
        date: '2024-01-15',
      })
    })

    it('extracts timeout from query params', async () => {
      const request = mockRequest('GET', '/lookup/users/user-123?timeout=5000')
      const query = await parseQuery(request)

      expect(query.timeout).toBe(5000)
    })

    it('does not include timeout in partition', async () => {
      const request = mockRequest('GET', '/lookup/users/user-123?ns=test&timeout=5000')
      const query = await parseQuery(request)

      expect(query.partition).toEqual({ ns: 'test' })
      expect(query.timeout).toBe(5000)
    })
  })

  describe('POST requests for vector search', () => {
    it('parses vector search request with query array', async () => {
      const request = mockRequest('POST', '/query', {
        query: [0.1, 0.2, 0.3, 0.4, 0.5],
        k: 10,
        metric: 'cosine',
      })
      const query = await parseQuery(request)

      expect(query.type).toBe('vector_search')
      expect(query.vector).toEqual([0.1, 0.2, 0.3, 0.4, 0.5])
      expect(query.k).toBe(10)
      expect(query.metric).toBe('cosine')
    })

    it('parses vector search request with explicit type', async () => {
      const request = mockRequest('POST', '/query', {
        type: 'vector_search',
        query: [0.5, 0.5, 0.5],
        k: 20,
      })
      const query = await parseQuery(request)

      expect(query.type).toBe('vector_search')
      expect(query.k).toBe(20)
    })

    it('uses default k value', async () => {
      const request = mockRequest('POST', '/query', {
        query: [0.1, 0.2, 0.3],
      })
      const query = await parseQuery(request)

      expect(query.k).toBe(10)
    })

    it('caps k at maximum value', async () => {
      const request = mockRequest('POST', '/query', {
        query: [0.1, 0.2, 0.3],
        k: 5000,
      })
      const query = await parseQuery(request)

      expect(query.k).toBe(1000)
    })

    it('uses default metric of cosine', async () => {
      const request = mockRequest('POST', '/query', {
        query: [0.1, 0.2, 0.3],
      })
      const query = await parseQuery(request)

      expect(query.metric).toBe('cosine')
    })

    it('throws on empty query vector', async () => {
      const request = mockRequest('POST', '/query', {
        query: [],
      })

      await expect(parseQuery(request)).rejects.toThrow('Query vector cannot be empty')
    })

    it('throws on invalid vector values', async () => {
      const request = mockRequest('POST', '/query', {
        query: [0.1, 'invalid', 0.3],
      })

      await expect(parseQuery(request)).rejects.toThrow('must contain only valid numbers')
    })

    it('throws on invalid metric', async () => {
      const request = mockRequest('POST', '/query', {
        query: [0.1, 0.2, 0.3],
        metric: 'invalid_metric',
      })

      await expect(parseQuery(request)).rejects.toThrow('Invalid metric')
    })
  })

  describe('POST requests for point lookups', () => {
    it('parses point lookup request with table and key', async () => {
      const request = mockRequest('POST', '/query', {
        type: 'point_lookup',
        table: 'users',
        key: 'user-789',
      })
      const query = await parseQuery(request)

      expect(query.type).toBe('point_lookup')
      expect(query.table).toBe('users')
      expect(query.key).toBe('user-789')
    })

    it('parses point lookup with partition', async () => {
      const request = mockRequest('POST', '/query', {
        table: 'events',
        key: 'evt-001',
        partition: { ns: 'tenant-2', year: 2024 },
      })
      const query = await parseQuery(request)

      expect(query.partition).toEqual({ ns: 'tenant-2', year: 2024 })
    })

    it('throws on invalid table name', async () => {
      const request = mockRequest('POST', '/query', {
        table: '123-invalid',
        key: 'key-1',
      })

      await expect(parseQuery(request)).rejects.toThrow('Invalid table name format')
    })

    it('throws on missing key', async () => {
      const request = mockRequest('POST', '/query', {
        table: 'users',
      })

      await expect(parseQuery(request)).rejects.toThrow('requires a "key" string')
    })
  })

  describe('POST requests for SQL queries', () => {
    it('parses SQL query request', async () => {
      const request = mockRequest('POST', '/query', {
        sql: 'SELECT * FROM users WHERE id = ?',
      })
      const query = await parseQuery(request)

      expect(query.sql).toBe('SELECT * FROM users WHERE id = ?')
    })

    it('parses SQL query with type hint', async () => {
      const request = mockRequest('POST', '/query', {
        type: 'analytics',
        sql: 'SELECT COUNT(*) FROM events GROUP BY type',
      })
      const query = await parseQuery(request)

      expect(query.type).toBe('analytics')
      expect(query.sql).toBe('SELECT COUNT(*) FROM events GROUP BY type')
    })

    it('throws on empty SQL', async () => {
      const request = mockRequest('POST', '/query', {
        sql: '   ',
      })

      await expect(parseQuery(request)).rejects.toThrow('SQL query cannot be empty')
    })

    it('throws on missing SQL', async () => {
      const request = mockRequest('POST', '/query', {
        type: 'sql',
      })

      await expect(parseQuery(request)).rejects.toThrow('requires a "sql" string')
    })
  })

  describe('error handling', () => {
    it('throws on unknown request type', async () => {
      const request = mockRequest('POST', '/query', {
        unknown: 'field',
      })

      await expect(parseQuery(request)).rejects.toThrow('Unable to determine query type')
    })

    it('throws on unsupported HTTP method', async () => {
      const request = mockRequest('PUT', '/query', {
        sql: 'SELECT 1',
      })

      await expect(parseQuery(request)).rejects.toThrow(QueryParseError)
      await expect(parseQuery(request)).rejects.toThrow('Unsupported request method')
    })
  })
})

// ============================================================================
// QUERY CLASSIFICATION TESTS
// ============================================================================

describe('classifySQL', () => {
  describe('point lookup classification', () => {
    it('classifies simple equality query as point_lookup', () => {
      const result = classifySQL("SELECT * FROM users WHERE id = 'user-123'")

      expect(result.type).toBe('point_lookup')
      expect(result.executionPath).toBe('point_lookup')
    })

    it('classifies parameterized query as point_lookup', () => {
      const result = classifySQL('SELECT * FROM users WHERE id = ?')

      expect(result.type).toBe('point_lookup')
      expect(result.executionPath).toBe('point_lookup')
    })

    it('has low cost estimate for point lookups', () => {
      const result = classifySQL('SELECT * FROM users WHERE id = ?')

      expect(result.estimatedCost.computeMs).toBe(100)
      expect(result.estimatedCost.monetaryCost).toBe(0.00014)
    })
  })

  describe('analytics classification', () => {
    it('classifies GROUP BY queries as analytics', () => {
      const result = classifySQL('SELECT type, COUNT(*) FROM events GROUP BY type')

      expect(result.type).toBe('analytics')
      expect(result.executionPath).toBe('browser_execute')
    })

    it('classifies COUNT queries as analytics', () => {
      const result = classifySQL('SELECT COUNT(*) FROM users')

      expect(result.type).toBe('analytics')
    })

    it('classifies SUM queries as analytics', () => {
      const result = classifySQL('SELECT SUM(amount) FROM orders')

      expect(result.type).toBe('analytics')
    })

    it('classifies AVG queries as analytics', () => {
      const result = classifySQL('SELECT AVG(price) FROM products')

      expect(result.type).toBe('analytics')
    })

    it('classifies MAX/MIN queries as analytics', () => {
      const max = classifySQL('SELECT MAX(created_at) FROM events')
      const min = classifySQL('SELECT MIN(created_at) FROM events')

      expect(max.type).toBe('analytics')
      expect(min.type).toBe('analytics')
    })

    it('classifies window functions as analytics', () => {
      const result = classifySQL('SELECT name, ROW_NUMBER() OVER(ORDER BY created_at) FROM users')

      expect(result.type).toBe('analytics')
    })

    it('prefers browser execution for analytics', () => {
      const result = classifySQL('SELECT type, COUNT(*) FROM events GROUP BY type')

      expect(result.executionPath).toBe('browser_execute')
      expect(result.estimatedCost.monetaryCost).toBe(0.009) // Egress cost only
    })
  })

  describe('federated classification', () => {
    it('classifies JOIN queries as federated', () => {
      const result = classifySQL('SELECT u.name, o.total FROM users u JOIN orders o ON u.id = o.user_id')

      expect(result.type).toBe('federated')
      expect(result.executionPath).toBe('federated_query')
    })

    it('classifies UNION queries as federated', () => {
      const result = classifySQL('SELECT id FROM users UNION SELECT id FROM admins')

      expect(result.type).toBe('federated')
      expect(result.executionPath).toBe('federated_query')
    })

    it('has moderate cost estimate for federated queries', () => {
      const result = classifySQL('SELECT * FROM a JOIN b ON a.id = b.a_id')

      expect(result.estimatedCost.computeMs).toBe(400)
      expect(result.estimatedCost.monetaryCost).toBe(0.002)
    })
  })

  describe('default classification', () => {
    it('classifies simple SELECT as analytics with browser execution', () => {
      const result = classifySQL('SELECT name, email FROM users')

      expect(result.type).toBe('analytics')
      expect(result.executionPath).toBe('browser_execute')
    })
  })

  describe('case insensitivity', () => {
    it('handles uppercase SQL', () => {
      const result = classifySQL('SELECT COUNT(*) FROM USERS GROUP BY TYPE')

      expect(result.type).toBe('analytics')
    })

    it('handles mixed case SQL', () => {
      const result = classifySQL('Select * From users Where id = ?')

      expect(result.type).toBe('point_lookup')
    })
  })
})

// ============================================================================
// QUERY ROUTING TESTS
// ============================================================================

describe('routeQuery', () => {
  describe('point lookup routing', () => {
    it('routes to R2 when available', async () => {
      const mockR2 = {
        get: vi.fn().mockResolvedValue({
          json: vi.fn().mockResolvedValue({ id: 'user-123', name: 'Test User' }),
        }),
      }

      const env = mockEnv({ R2: mockR2 as unknown as R2Bucket })

      const query: ParsedQuery = {
        raw: '/lookup/users/user-123',
        type: 'point_lookup',
        executionPath: 'point_lookup',
        table: 'users',
        key: 'user-123',
      }

      const result = await routeQuery(query, env)

      expect(result.success).toBe(true)
      expect(mockR2.get).toHaveBeenCalledWith('data/users/user-123.json')
    })

    it('includes partition path in R2 lookup', async () => {
      const mockR2 = {
        get: vi.fn().mockResolvedValue({
          json: vi.fn().mockResolvedValue({ id: 'evt-1' }),
        }),
      }

      const env = mockEnv({ R2: mockR2 as unknown as R2Bucket })

      const query: ParsedQuery = {
        raw: '/lookup/events/evt-1',
        type: 'point_lookup',
        executionPath: 'point_lookup',
        table: 'events',
        key: 'evt-1',
        partition: { ns: 'tenant-1', type: 'click' },
      }

      const result = await routeQuery(query, env)

      expect(result.success).toBe(true)
      expect(mockR2.get).toHaveBeenCalledWith('data/events/ns=tenant-1/type=click/evt-1.json')
    })

    it('returns found:false when record not found', async () => {
      const mockR2 = {
        get: vi.fn().mockResolvedValue(null),
      }

      const env = mockEnv({ R2: mockR2 as unknown as R2Bucket })

      const query: ParsedQuery = {
        raw: '/lookup/users/nonexistent',
        type: 'point_lookup',
        executionPath: 'point_lookup',
        table: 'users',
        key: 'nonexistent',
      }

      const result = await routeQuery(query, env)

      expect(result.success).toBe(true)
      expect((result.data as { found: boolean }).found).toBe(false)
    })

    it('returns error when no backend available', async () => {
      const env = mockEnv()

      const query: ParsedQuery = {
        raw: '/lookup/users/user-123',
        type: 'point_lookup',
        executionPath: 'point_lookup',
        table: 'users',
        key: 'user-123',
      }

      const result = await routeQuery(query, env)

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('NO_BACKEND')
    })
  })

  describe('vector search routing', () => {
    it('routes to Vectorize when available', async () => {
      const mockVectors = {
        query: vi.fn().mockResolvedValue({
          matches: [
            { id: 'vec-1', score: 0.95, metadata: { type: 'doc' } },
            { id: 'vec-2', score: 0.87, metadata: { type: 'doc' } },
          ],
          count: 100,
        }),
      }

      const env = mockEnv({ VECTORS: mockVectors as unknown as VectorizeIndex })

      const query: ParsedQuery = {
        raw: { query: [0.1, 0.2, 0.3] },
        type: 'vector_search',
        executionPath: 'point_lookup',
        vector: [0.1, 0.2, 0.3],
        k: 10,
        metric: 'cosine',
      }

      const result = await routeQuery(query, env)

      expect(result.success).toBe(true)
      expect(mockVectors.query).toHaveBeenCalled()

      const data = result.data as { results: Array<{ id: string; score: number }> }
      expect(data.results).toHaveLength(2)
      expect(data.results[0].id).toBe('vec-1')
    })

    it('returns error when no vector backend available', async () => {
      const env = mockEnv()

      const query: ParsedQuery = {
        raw: { query: [0.1, 0.2, 0.3] },
        type: 'vector_search',
        executionPath: 'point_lookup',
        vector: [0.1, 0.2, 0.3],
        k: 10,
      }

      const result = await routeQuery(query, env)

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('NO_BACKEND')
    })
  })

  describe('analytics routing', () => {
    it('returns query plan for browser execution', async () => {
      const env = mockEnv()

      const query: ParsedQuery = {
        raw: { sql: 'SELECT COUNT(*) FROM events GROUP BY type' },
        type: 'analytics',
        executionPath: 'browser_execute',
        sql: 'SELECT COUNT(*) FROM events GROUP BY type',
      }

      const result = await routeQuery(query, env)

      expect(result.success).toBe(true)

      const data = result.data as { plan: { type: string; optimizedSql: string } }
      expect(data.plan.type).toBe('client_execute')
      expect(data.plan.optimizedSql).toBe('SELECT COUNT(*) FROM events GROUP BY type')
    })

    it('executes via D1 for server execution', async () => {
      const mockDB = {
        prepare: vi.fn().mockReturnValue({
          all: vi.fn().mockResolvedValue({
            results: [{ id: 1, name: 'Test' }],
            meta: { duration: 5 },
          }),
        }),
      }

      const env = mockEnv({ DB: mockDB as unknown as D1Database })

      const query: ParsedQuery = {
        raw: { sql: "SELECT * FROM users WHERE id = 'user-1'" },
        type: 'point_lookup',
        executionPath: 'point_lookup',
        sql: "SELECT * FROM users WHERE id = 'user-1'",
      }

      const result = await routeQuery(query, env)

      expect(result.success).toBe(true)
      expect(mockDB.prepare).toHaveBeenCalledWith("SELECT * FROM users WHERE id = 'user-1'")

      const data = result.data as { data: Array<{ id: number; name: string }> }
      expect(data.data).toHaveLength(1)
    })

    it('returns not implemented for federated queries', async () => {
      const env = mockEnv()

      const query: ParsedQuery = {
        raw: { sql: 'SELECT * FROM a JOIN b ON a.id = b.a_id' },
        type: 'federated',
        executionPath: 'federated_query',
        sql: 'SELECT * FROM a JOIN b ON a.id = b.a_id',
      }

      const result = await routeQuery(query, env)

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('NOT_IMPLEMENTED')
    })
  })

  describe('timing metrics', () => {
    it('includes timing information in result', async () => {
      const mockR2 = {
        get: vi.fn().mockResolvedValue({
          json: vi.fn().mockResolvedValue({ id: 'test' }),
        }),
      }

      const env = mockEnv({ R2: mockR2 as unknown as R2Bucket })

      const query: ParsedQuery = {
        raw: '/lookup/users/user-1',
        type: 'point_lookup',
        executionPath: 'point_lookup',
        table: 'users',
        key: 'user-1',
      }

      const result = await routeQuery(query, env)

      expect(result.timing).toBeDefined()
      expect(result.timing.totalMs).toBeGreaterThanOrEqual(0)
      expect(result.timing.executeMs).toBeGreaterThanOrEqual(0)
      expect(result.timing.routeMs).toBeGreaterThanOrEqual(0)
    })
  })

  describe('error handling', () => {
    it('handles R2 errors gracefully', async () => {
      const mockR2 = {
        get: vi.fn().mockRejectedValue(new Error('R2 connection failed')),
      }

      const env = mockEnv({ R2: mockR2 as unknown as R2Bucket })

      const query: ParsedQuery = {
        raw: '/lookup/users/user-1',
        type: 'point_lookup',
        executionPath: 'point_lookup',
        table: 'users',
        key: 'user-1',
      }

      const result = await routeQuery(query, env)

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('STORAGE_ERROR')
      expect(result.error).toContain('R2 lookup failed')
    })

    it('handles D1 errors gracefully', async () => {
      const mockDB = {
        prepare: vi.fn().mockReturnValue({
          all: vi.fn().mockRejectedValue(new Error('SQL syntax error')),
        }),
      }

      const env = mockEnv({ DB: mockDB as unknown as D1Database })

      const query: ParsedQuery = {
        raw: { sql: 'INVALID SQL' },
        type: 'point_lookup',
        executionPath: 'point_lookup',
        sql: 'INVALID SQL',
      }

      const result = await routeQuery(query, env)

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('SQL_ERROR')
    })

    it('handles Vectorize errors gracefully', async () => {
      const mockVectors = {
        query: vi.fn().mockRejectedValue(new Error('Vector index not found')),
      }

      const env = mockEnv({ VECTORS: mockVectors as unknown as VectorizeIndex })

      const query: ParsedQuery = {
        raw: { query: [0.1, 0.2, 0.3] },
        type: 'vector_search',
        executionPath: 'point_lookup',
        vector: [0.1, 0.2, 0.3],
        k: 10,
      }

      const result = await routeQuery(query, env)

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('VECTOR_ERROR')
    })
  })
})

// ============================================================================
// WORKER FETCH HANDLER TESTS
// ============================================================================

describe('Query Router Worker', () => {
  describe('health check', () => {
    it('returns health status', async () => {
      const request = new Request('https://test.example.com/health')
      const env = mockEnv()

      const response = await queryRouter.fetch(request, env)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.status).toBe('ok')
      expect(body.timestamp).toBeDefined()
      expect(body.capabilities).toBeDefined()
    })

    it('reports available capabilities', async () => {
      const mockR2 = {} as R2Bucket
      const mockVectors = {} as VectorizeIndex
      const mockDB = {} as D1Database

      const env = mockEnv({
        R2: mockR2,
        VECTORS: mockVectors,
        DB: mockDB,
      })

      const request = new Request('https://test.example.com/health')
      const response = await queryRouter.fetch(request, env)
      const body = await response.json()

      expect(body.capabilities.r2).toBe(true)
      expect(body.capabilities.vectorize).toBe(true)
      expect(body.capabilities.d1).toBe(true)
    })
  })

  describe('CORS handling', () => {
    it('handles OPTIONS preflight requests', async () => {
      const request = new Request('https://test.example.com/query', {
        method: 'OPTIONS',
      })
      const env = mockEnv()

      const response = await queryRouter.fetch(request, env)

      expect(response.status).toBe(200)
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST')
    })

    it('includes CORS headers in responses', async () => {
      const request = new Request('https://test.example.com/health')
      const env = mockEnv()

      const response = await queryRouter.fetch(request, env)

      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    })
  })

  describe('query execution', () => {
    it('handles vector search requests', async () => {
      const mockVectors = {
        query: vi.fn().mockResolvedValue({
          matches: [{ id: 'vec-1', score: 0.9 }],
          count: 10,
        }),
      }

      const env = mockEnv({ VECTORS: mockVectors as unknown as VectorizeIndex })

      const request = new Request('https://test.example.com/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: [0.1, 0.2, 0.3], k: 5 }),
      })

      const response = await queryRouter.fetch(request, env)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(response.headers.get('X-Query-Type')).toBe('vector_search')
    })

    it('handles point lookup requests', async () => {
      const mockR2 = {
        get: vi.fn().mockResolvedValue({
          json: vi.fn().mockResolvedValue({ id: 'test' }),
        }),
      }

      const env = mockEnv({ R2: mockR2 as unknown as R2Bucket })

      const request = new Request('https://test.example.com/lookup/users/user-1')
      const response = await queryRouter.fetch(request, env)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(response.headers.get('X-Query-Type')).toBe('point_lookup')
    })

    it('handles SQL requests', async () => {
      const env = mockEnv()

      const request = new Request('https://test.example.com/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: 'SELECT COUNT(*) FROM events GROUP BY type' }),
      })

      const response = await queryRouter.fetch(request, env)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(response.headers.get('X-Query-Type')).toBe('analytics')
    })

    it('includes timing headers', async () => {
      const env = mockEnv()

      const request = new Request('https://test.example.com/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: 'SELECT 1' }),
      })

      const response = await queryRouter.fetch(request, env)

      expect(response.headers.get('X-Total-Time-Ms')).toBeDefined()
    })
  })

  describe('error handling', () => {
    it('returns 400 for parse errors', async () => {
      const env = mockEnv()

      const request = new Request('https://test.example.com/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unknown: 'field' }),
      })

      const response = await queryRouter.fetch(request, env)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.success).toBe(false)
      expect(body.errorCode).toBe('PARSE_ERROR')
    })

    it('returns 400 for validation errors', async () => {
      const env = mockEnv()

      const request = new Request('https://test.example.com/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: [] }),
      })

      const response = await queryRouter.fetch(request, env)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.success).toBe(false)
    })

    it('returns JSON error for invalid JSON body', async () => {
      const env = mockEnv()

      const request = new Request('https://test.example.com/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json{',
      })

      const response = await queryRouter.fetch(request, env)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.success).toBe(false)
      expect(body.errorCode).toBe('INTERNAL_ERROR')
    })
  })
})
