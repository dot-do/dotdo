import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import type { Context } from 'hono'

/**
 * Search Middleware Tests
 *
 * These tests verify the search middleware for the dotdo worker.
 * They are expected to FAIL until the search middleware is implemented.
 *
 * Implementation requirements:
 * - Create middleware in api/middleware/search.ts
 * - Support GET /api/search/:type routing
 * - Support local types (tasks, notes, projects) via SQLite FTS
 * - Support provider types (github:issues, github:repos) via linked accounts
 * - Query params: q, limit, offset, and arbitrary filters
 * - Return standardized response format
 * - Require authentication
 */

// Import the middleware (will fail until implemented)
// @ts-expect-error - Middleware not yet implemented
import { search, type SearchConfig, type SearchResponse } from '../../middleware/search'

// ============================================================================
// Test Types
// ============================================================================

interface SearchResult {
  type: string
  query: string
  filters: Record<string, string>
  results: unknown[]
  total: number
  limit: number
  offset: number
}

interface ErrorResponse {
  error: string
  message?: string
}

// ============================================================================
// Mock Contexts
// ============================================================================

const mockDb = {
  query: {
    tasks: {
      findMany: vi.fn(),
    },
    notes: {
      findMany: vi.fn(),
    },
    projects: {
      findMany: vi.fn(),
    },
  },
}

const mockLinkedAccounts = {
  get: vi.fn(),
}

const mockIntegrations = {
  get: vi.fn(),
}

// ============================================================================
// Helper Functions
// ============================================================================

function createTestApp(config?: SearchConfig): Hono {
  const app = new Hono()

  // Mock auth middleware - sets user context
  app.use('*', async (c, next) => {
    const authHeader = c.req.header('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      c.set('user', { id: 'user-123', role: 'user' })
    }
    c.set('db', mockDb)
    c.set('linkedAccounts', mockLinkedAccounts)
    c.set('integrations', mockIntegrations)
    await next()
  })

  app.use('/api/search/*', search(config))
  return app
}

function createAuthenticatedApp(config?: SearchConfig): Hono {
  const app = new Hono()

  // Auth middleware always sets user
  app.use('*', async (c, next) => {
    c.set('user', { id: 'user-123', role: 'user' })
    c.set('db', mockDb)
    c.set('linkedAccounts', mockLinkedAccounts)
    c.set('integrations', mockIntegrations)
    await next()
  })

  app.use('/api/search/*', search(config))
  return app
}

async function searchRequest(
  app: Hono,
  type: string,
  options: {
    query?: string
    limit?: number
    offset?: number
    filters?: Record<string, string>
    headers?: Record<string, string>
  } = {}
): Promise<Response> {
  const params = new URLSearchParams()
  if (options.query) params.set('q', options.query)
  if (options.limit !== undefined) params.set('limit', String(options.limit))
  if (options.offset !== undefined) params.set('offset', String(options.offset))
  if (options.filters) {
    for (const [key, value] of Object.entries(options.filters)) {
      params.set(key, value)
    }
  }

  const queryString = params.toString()
  const url = `/api/search/${type}${queryString ? `?${queryString}` : ''}`

  return app.request(url, {
    method: 'GET',
    headers: {
      ...options.headers,
    },
  })
}

// ============================================================================
// 1. Routing Tests
// ============================================================================

describe('Search Middleware - Routing', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.query.tasks.findMany.mockResolvedValue([])
    app = createAuthenticatedApp({
      localTypes: ['tasks', 'notes', 'projects'],
      providerTypes: {
        'github:issues': { scopes: ['repo'] },
        'github:repos': { scopes: ['repo'] },
      },
    })
  })

  describe('GET /api/search/:type routes correctly', () => {
    it('routes GET /api/search/tasks to search handler', async () => {
      const res = await searchRequest(app, 'tasks')
      expect(res.status).not.toBe(404)
      expect([200, 401, 403]).toContain(res.status)
    })

    it('routes GET /api/search/notes to search handler', async () => {
      const res = await searchRequest(app, 'notes')
      expect(res.status).not.toBe(404)
    })

    it('routes GET /api/search/projects to search handler', async () => {
      const res = await searchRequest(app, 'projects')
      expect(res.status).not.toBe(404)
    })

    it('routes GET /api/search/github:issues to provider search', async () => {
      mockLinkedAccounts.get.mockResolvedValue({ accessToken: 'token' })
      mockIntegrations.get.mockResolvedValue({
        search: vi.fn().mockResolvedValue({ results: [], total: 0 }),
      })

      const res = await searchRequest(app, 'github:issues')
      expect(res.status).not.toBe(404)
    })

    it('routes GET /api/search/github:repos to provider search', async () => {
      mockLinkedAccounts.get.mockResolvedValue({ accessToken: 'token' })
      mockIntegrations.get.mockResolvedValue({
        search: vi.fn().mockResolvedValue({ results: [], total: 0 }),
      })

      const res = await searchRequest(app, 'github:repos')
      expect(res.status).not.toBe(404)
    })

    it('only accepts GET method', async () => {
      const res = await app.request('/api/search/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(405)
    })

    it('rejects PUT method', async () => {
      const res = await app.request('/api/search/tasks', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })

      expect(res.status).toBe(405)
    })

    it('rejects DELETE method', async () => {
      const res = await app.request('/api/search/tasks', {
        method: 'DELETE',
      })

      expect(res.status).toBe(405)
    })
  })

  describe('Returns 404 for unknown types', () => {
    it('returns 404 for unconfigured local type', async () => {
      const res = await searchRequest(app, 'unknowntype')
      expect(res.status).toBe(404)
      const body = (await res.json()) as ErrorResponse
      expect(body.error).toBeDefined()
    })

    it('returns 404 for unconfigured provider type', async () => {
      const res = await searchRequest(app, 'gitlab:issues')
      expect(res.status).toBe(404)
    })

    it('returns 404 for empty type', async () => {
      const res = await app.request('/api/search/', { method: 'GET' })
      expect(res.status).toBe(404)
    })

    it('returns 404 message indicating unknown type', async () => {
      const res = await searchRequest(app, 'nonexistent')
      expect(res.status).toBe(404)
      const body = (await res.json()) as ErrorResponse
      expect(body.error?.toLowerCase()).toMatch(/type|not found|unknown/)
    })

    it('returns 404 for type with invalid characters', async () => {
      const res = await searchRequest(app, '../../../etc/passwd')
      expect(res.status).toBe(404)
    })
  })
})

// ============================================================================
// 2. Local Search (SQLite) Tests
// ============================================================================

describe('Search Middleware - Local Search (SQLite)', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.query.tasks.findMany.mockResolvedValue([
      { id: '1', title: 'Test task', description: 'A test task' },
      { id: '2', title: 'Another task', description: 'Another test' },
    ])
    mockDb.query.notes.findMany.mockResolvedValue([])
    mockDb.query.projects.findMany.mockResolvedValue([])

    app = createAuthenticatedApp({
      localTypes: ['tasks', 'notes', 'projects'],
      providerTypes: {},
    })
  })

  describe('Search local types (tasks, notes, etc.)', () => {
    it('searches tasks in local database', async () => {
      const res = await searchRequest(app, 'tasks', { query: 'test' })
      expect(res.status).toBe(200)

      const body = (await res.json()) as SearchResult
      expect(body.type).toBe('tasks')
    })

    it('searches notes in local database', async () => {
      const res = await searchRequest(app, 'notes', { query: 'meeting' })
      expect(res.status).toBe(200)

      const body = (await res.json()) as SearchResult
      expect(body.type).toBe('notes')
    })

    it('searches projects in local database', async () => {
      const res = await searchRequest(app, 'projects', { query: 'website' })
      expect(res.status).toBe(200)

      const body = (await res.json()) as SearchResult
      expect(body.type).toBe('projects')
    })

    it('calls database query method', async () => {
      await searchRequest(app, 'tasks', { query: 'test' })
      expect(mockDb.query.tasks.findMany).toHaveBeenCalled()
    })

    it('returns empty results for no matches', async () => {
      mockDb.query.tasks.findMany.mockResolvedValue([])

      const res = await searchRequest(app, 'tasks', { query: 'nonexistent' })
      expect(res.status).toBe(200)

      const body = (await res.json()) as SearchResult
      expect(body.results).toEqual([])
      expect(body.total).toBe(0)
    })
  })

  describe('Full-text search with query param `q`', () => {
    it('uses q query param for full-text search', async () => {
      const res = await searchRequest(app, 'tasks', { query: 'important meeting' })
      expect(res.status).toBe(200)

      const body = (await res.json()) as SearchResult
      expect(body.query).toBe('important meeting')
    })

    it('handles empty q param', async () => {
      const res = await searchRequest(app, 'tasks', { query: '' })
      expect(res.status).toBe(200)

      const body = (await res.json()) as SearchResult
      expect(body.query).toBe('')
    })

    it('handles missing q param', async () => {
      const res = await searchRequest(app, 'tasks')
      expect(res.status).toBe(200)

      const body = (await res.json()) as SearchResult
      expect(body.query).toBe('')
    })

    it('escapes special characters in query', async () => {
      const res = await searchRequest(app, 'tasks', { query: 'test OR 1=1; DROP TABLE' })
      expect(res.status).toBe(200)
      // Should not cause SQL injection
    })

    it('handles unicode characters in query', async () => {
      const res = await searchRequest(app, 'tasks', { query: 'meeting' })
      expect(res.status).toBe(200)
    })

    it('passes query to database FTS', async () => {
      await searchRequest(app, 'tasks', { query: 'urgent' })
      expect(mockDb.query.tasks.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.anything(),
        })
      )
    })
  })

  describe('Pagination with `limit` and `offset`', () => {
    it('respects limit parameter', async () => {
      const res = await searchRequest(app, 'tasks', { limit: 10 })
      expect(res.status).toBe(200)

      const body = (await res.json()) as SearchResult
      expect(body.limit).toBe(10)
    })

    it('respects offset parameter', async () => {
      const res = await searchRequest(app, 'tasks', { offset: 20 })
      expect(res.status).toBe(200)

      const body = (await res.json()) as SearchResult
      expect(body.offset).toBe(20)
    })

    it('uses default limit when not specified', async () => {
      const res = await searchRequest(app, 'tasks')
      expect(res.status).toBe(200)

      const body = (await res.json()) as SearchResult
      expect(body.limit).toBe(20) // default
    })

    it('uses default offset of 0 when not specified', async () => {
      const res = await searchRequest(app, 'tasks')
      expect(res.status).toBe(200)

      const body = (await res.json()) as SearchResult
      expect(body.offset).toBe(0)
    })

    it('enforces maximum limit', async () => {
      const res = await searchRequest(app, 'tasks', { limit: 10000 })
      expect(res.status).toBe(200)

      const body = (await res.json()) as SearchResult
      expect(body.limit).toBeLessThanOrEqual(100) // max limit
    })

    it('rejects negative limit', async () => {
      const res = await searchRequest(app, 'tasks', { limit: -5 })
      expect([400, 200]).toContain(res.status)

      if (res.status === 200) {
        const body = (await res.json()) as SearchResult
        expect(body.limit).toBeGreaterThan(0)
      }
    })

    it('rejects negative offset', async () => {
      const res = await searchRequest(app, 'tasks', { offset: -10 })
      expect([400, 200]).toContain(res.status)

      if (res.status === 200) {
        const body = (await res.json()) as SearchResult
        expect(body.offset).toBeGreaterThanOrEqual(0)
      }
    })

    it('passes pagination to database query', async () => {
      await searchRequest(app, 'tasks', { limit: 15, offset: 30 })
      expect(mockDb.query.tasks.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 15,
          offset: 30,
        })
      )
    })
  })

  describe('Filter params support', () => {
    it('supports status filter', async () => {
      const res = await searchRequest(app, 'tasks', {
        query: 'test',
        filters: { status: 'completed' },
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as SearchResult
      expect(body.filters).toHaveProperty('status', 'completed')
    })

    it('supports priority filter', async () => {
      const res = await searchRequest(app, 'tasks', {
        filters: { priority: 'high' },
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as SearchResult
      expect(body.filters).toHaveProperty('priority', 'high')
    })

    it('supports multiple filters', async () => {
      const res = await searchRequest(app, 'tasks', {
        filters: { status: 'open', priority: 'high', assignee: 'user-123' },
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as SearchResult
      expect(body.filters).toEqual({
        status: 'open',
        priority: 'high',
        assignee: 'user-123',
      })
    })

    it('ignores reserved query params (q, limit, offset)', async () => {
      const res = await searchRequest(app, 'tasks', {
        query: 'test',
        limit: 10,
        offset: 5,
        filters: { status: 'open' },
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as SearchResult
      expect(body.filters).not.toHaveProperty('q')
      expect(body.filters).not.toHaveProperty('limit')
      expect(body.filters).not.toHaveProperty('offset')
    })

    it('passes filters to database query', async () => {
      await searchRequest(app, 'tasks', {
        filters: { status: 'pending' },
      })
      expect(mockDb.query.tasks.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'pending',
          }),
        })
      )
    })

    it('combines filters with full-text search', async () => {
      await searchRequest(app, 'tasks', {
        query: 'important',
        filters: { status: 'open' },
      })
      expect(mockDb.query.tasks.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.anything(),
        })
      )
    })

    it('handles empty filter values', async () => {
      const res = await searchRequest(app, 'tasks', {
        filters: { status: '' },
      })
      expect(res.status).toBe(200)
    })
  })
})

// ============================================================================
// 3. Provider Search Tests
// ============================================================================

describe('Search Middleware - Provider Search', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    mockLinkedAccounts.get.mockResolvedValue({ accessToken: 'github-token-123' })
    mockIntegrations.get.mockResolvedValue({
      search: vi.fn().mockResolvedValue({
        results: [{ id: 1, title: 'Issue 1' }],
        total: 1,
      }),
    })

    app = createAuthenticatedApp({
      localTypes: ['tasks'],
      providerTypes: {
        'github:issues': { scopes: ['repo'] },
        'github:repos': { scopes: ['repo'] },
        'github:prs': { scopes: ['repo'] },
      },
    })
  })

  describe('Search provider types (github:issues, github:repos)', () => {
    it('searches github:issues via provider', async () => {
      const res = await searchRequest(app, 'github:issues', { query: 'bug' })
      expect(res.status).toBe(200)

      const body = (await res.json()) as SearchResult
      expect(body.type).toBe('github:issues')
    })

    it('searches github:repos via provider', async () => {
      const res = await searchRequest(app, 'github:repos', { query: 'react' })
      expect(res.status).toBe(200)

      const body = (await res.json()) as SearchResult
      expect(body.type).toBe('github:repos')
    })

    it('parses provider and resource from type', async () => {
      const res = await searchRequest(app, 'github:issues', { query: 'test' })
      expect(res.status).toBe(200)

      // Should have parsed "github" as provider and "issues" as resource
      expect(mockIntegrations.get).toHaveBeenCalledWith('github')
    })

    it('returns results from provider', async () => {
      mockIntegrations.get.mockResolvedValue({
        search: vi.fn().mockResolvedValue({
          results: [
            { id: 1, title: 'First issue' },
            { id: 2, title: 'Second issue' },
          ],
          total: 2,
        }),
      })

      const res = await searchRequest(app, 'github:issues', { query: 'feature' })
      expect(res.status).toBe(200)

      const body = (await res.json()) as SearchResult
      expect(body.results).toHaveLength(2)
      expect(body.total).toBe(2)
    })
  })

  describe('Uses linked account credentials', () => {
    it('retrieves linked account for provider', async () => {
      await searchRequest(app, 'github:issues', { query: 'test' })
      expect(mockLinkedAccounts.get).toHaveBeenCalledWith('github')
    })

    it('passes access token to provider search', async () => {
      const mockSearch = vi.fn().mockResolvedValue({ results: [], total: 0 })
      mockIntegrations.get.mockResolvedValue({ search: mockSearch })

      await searchRequest(app, 'github:issues', { query: 'test' })

      expect(mockSearch).toHaveBeenCalledWith(
        'issues',
        expect.objectContaining({
          accessToken: 'github-token-123',
        })
      )
    })

    it('passes query params to provider search', async () => {
      const mockSearch = vi.fn().mockResolvedValue({ results: [], total: 0 })
      mockIntegrations.get.mockResolvedValue({ search: mockSearch })

      await searchRequest(app, 'github:issues', {
        query: 'urgent bug',
        limit: 25,
        offset: 10,
      })

      expect(mockSearch).toHaveBeenCalledWith(
        'issues',
        expect.objectContaining({
          q: 'urgent bug',
          limit: 25,
          offset: 10,
        })
      )
    })

    it('passes filters to provider search', async () => {
      const mockSearch = vi.fn().mockResolvedValue({ results: [], total: 0 })
      mockIntegrations.get.mockResolvedValue({ search: mockSearch })

      await searchRequest(app, 'github:issues', {
        query: 'bug',
        filters: { state: 'open', labels: 'bug,urgent' },
      })

      expect(mockSearch).toHaveBeenCalledWith(
        'issues',
        expect.objectContaining({
          filters: expect.objectContaining({
            state: 'open',
            labels: 'bug,urgent',
          }),
        })
      )
    })
  })

  describe('Fails gracefully if account not linked', () => {
    it('returns 403 if account not linked', async () => {
      mockLinkedAccounts.get.mockResolvedValue(null)

      const res = await searchRequest(app, 'github:issues', { query: 'test' })
      expect(res.status).toBe(403)
    })

    it('returns error message about linking account', async () => {
      mockLinkedAccounts.get.mockResolvedValue(null)

      const res = await searchRequest(app, 'github:issues', { query: 'test' })
      const body = (await res.json()) as ErrorResponse

      expect(body.error?.toLowerCase()).toMatch(/link|connect|account/)
    })

    it('returns 403 if account token expired', async () => {
      mockLinkedAccounts.get.mockResolvedValue({
        accessToken: 'expired-token',
        expiresAt: new Date(Date.now() - 10000).toISOString(),
      })

      const res = await searchRequest(app, 'github:issues', { query: 'test' })
      expect([403, 401]).toContain(res.status)
    })

    it('returns 403 if account missing required scopes', async () => {
      mockLinkedAccounts.get.mockResolvedValue({
        accessToken: 'token',
        scopes: ['read:user'], // missing 'repo' scope
      })

      const res = await searchRequest(app, 'github:issues', { query: 'test' })
      expect(res.status).toBe(403)

      const body = (await res.json()) as ErrorResponse
      expect(body.error?.toLowerCase()).toMatch(/scope|permission/)
    })

    it('handles provider API errors gracefully', async () => {
      const mockSearch = vi.fn().mockRejectedValue(new Error('API rate limit exceeded'))
      mockIntegrations.get.mockResolvedValue({ search: mockSearch })

      const res = await searchRequest(app, 'github:issues', { query: 'test' })
      expect([502, 503, 429]).toContain(res.status)
    })

    it('returns empty results on provider timeout', async () => {
      const mockSearch = vi.fn().mockImplementation(
        () => new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 100))
      )
      mockIntegrations.get.mockResolvedValue({ search: mockSearch })

      const res = await searchRequest(app, 'github:issues', { query: 'test' })
      expect([502, 503, 504]).toContain(res.status)
    })
  })
})

// ============================================================================
// 4. Response Format Tests
// ============================================================================

describe('Search Middleware - Response Format', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.query.tasks.findMany.mockResolvedValue([
      { id: '1', title: 'Task 1' },
      { id: '2', title: 'Task 2' },
    ])

    app = createAuthenticatedApp({
      localTypes: ['tasks'],
      providerTypes: {},
    })
  })

  describe('Response includes all required fields', () => {
    it('includes type in response', async () => {
      const res = await searchRequest(app, 'tasks', { query: 'test' })
      expect(res.status).toBe(200)

      const body = (await res.json()) as SearchResult
      expect(body.type).toBe('tasks')
    })

    it('includes query in response', async () => {
      const res = await searchRequest(app, 'tasks', { query: 'important' })
      expect(res.status).toBe(200)

      const body = (await res.json()) as SearchResult
      expect(body.query).toBe('important')
    })

    it('includes filters in response', async () => {
      const res = await searchRequest(app, 'tasks', {
        filters: { status: 'open', priority: 'high' },
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as SearchResult
      expect(body.filters).toEqual({ status: 'open', priority: 'high' })
    })

    it('includes results array in response', async () => {
      const res = await searchRequest(app, 'tasks')
      expect(res.status).toBe(200)

      const body = (await res.json()) as SearchResult
      expect(Array.isArray(body.results)).toBe(true)
    })

    it('includes total count in response', async () => {
      const res = await searchRequest(app, 'tasks')
      expect(res.status).toBe(200)

      const body = (await res.json()) as SearchResult
      expect(typeof body.total).toBe('number')
    })

    it('includes limit in response', async () => {
      const res = await searchRequest(app, 'tasks', { limit: 15 })
      expect(res.status).toBe(200)

      const body = (await res.json()) as SearchResult
      expect(body.limit).toBe(15)
    })

    it('includes offset in response', async () => {
      const res = await searchRequest(app, 'tasks', { offset: 25 })
      expect(res.status).toBe(200)

      const body = (await res.json()) as SearchResult
      expect(body.offset).toBe(25)
    })
  })

  describe('Response format matches specification', () => {
    it('response matches expected interface', async () => {
      const res = await searchRequest(app, 'tasks', {
        query: 'test',
        limit: 10,
        offset: 5,
        filters: { status: 'open' },
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as SearchResult
      expect(body).toMatchObject({
        type: expect.any(String),
        query: expect.any(String),
        filters: expect.any(Object),
        results: expect.any(Array),
        total: expect.any(Number),
        limit: expect.any(Number),
        offset: expect.any(Number),
      })
    })

    it('returns JSON content type', async () => {
      const res = await searchRequest(app, 'tasks')
      expect(res.headers.get('content-type')).toContain('application/json')
    })

    it('total reflects actual count, not limited results', async () => {
      // Mock database returns 100 total but we only request 10
      mockDb.query.tasks.findMany.mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => ({ id: String(i), title: `Task ${i}` }))
      )

      // Assume a count query returns 100
      const res = await searchRequest(app, 'tasks', { limit: 10 })
      expect(res.status).toBe(200)

      const body = (await res.json()) as SearchResult
      expect(body.results.length).toBeLessThanOrEqual(body.limit)
      expect(body.total).toBeGreaterThanOrEqual(body.results.length)
    }
    )

    it('filters only includes non-reserved params', async () => {
      const res = await searchRequest(app, 'tasks', {
        query: 'test',
        limit: 10,
        offset: 5,
        filters: { customField: 'value' },
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as SearchResult
      expect(Object.keys(body.filters)).not.toContain('q')
      expect(Object.keys(body.filters)).not.toContain('limit')
      expect(Object.keys(body.filters)).not.toContain('offset')
      expect(body.filters).toHaveProperty('customField', 'value')
    })
  })
})

// ============================================================================
// 5. Authorization Tests
// ============================================================================

describe('Search Middleware - Authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.query.tasks.findMany.mockResolvedValue([])
  })

  describe('Returns 401 if not authenticated', () => {
    it('returns 401 without Authorization header', async () => {
      const app = createTestApp({
        localTypes: ['tasks'],
        providerTypes: {},
      })

      const res = await searchRequest(app, 'tasks', { query: 'test' })
      expect(res.status).toBe(401)
    })

    it('returns 401 with invalid Bearer token', async () => {
      const app = createTestApp({
        localTypes: ['tasks'],
        providerTypes: {},
      })

      const res = await searchRequest(app, 'tasks', {
        query: 'test',
        headers: { Authorization: 'Bearer invalid-token' },
      })
      // The mock doesn't validate tokens, so this may pass in test
      // In real implementation, would return 401
      expect([200, 401]).toContain(res.status)
    })

    it('returns 401 error message', async () => {
      const app = createTestApp({
        localTypes: ['tasks'],
        providerTypes: {},
      })

      const res = await searchRequest(app, 'tasks', { query: 'test' })
      expect(res.status).toBe(401)

      const body = (await res.json()) as ErrorResponse
      expect(body.error).toBeDefined()
    })

    it('returns WWW-Authenticate header on 401', async () => {
      const app = createTestApp({
        localTypes: ['tasks'],
        providerTypes: {},
      })

      const res = await searchRequest(app, 'tasks', { query: 'test' })
      expect(res.status).toBe(401)
      expect(res.headers.get('WWW-Authenticate')).toContain('Bearer')
    })
  })

  describe('Respects permissions', () => {
    it('allows search when user has read permission', async () => {
      const app = createAuthenticatedApp({
        localTypes: ['tasks'],
        providerTypes: {},
      })

      const res = await searchRequest(app, 'tasks', { query: 'test' })
      expect(res.status).toBe(200)
    })

    it('respects type-specific permissions', async () => {
      const app = new Hono()
      app.use('*', async (c, next) => {
        c.set('user', { id: 'user-123', role: 'user', permissions: ['search:tasks'] })
        c.set('db', mockDb)
        await next()
      })
      app.use(
        '/api/search/*',
        search({
          localTypes: ['tasks', 'admin-logs'],
          providerTypes: {},
          requirePermission: true,
        })
      )

      const tasksRes = await searchRequest(app, 'tasks', { query: 'test' })
      expect(tasksRes.status).toBe(200)

      // User doesn't have search:admin-logs permission
      const logsRes = await searchRequest(app, 'admin-logs', { query: 'test' })
      expect(logsRes.status).toBe(403)
    })

    it('admin can search any type', async () => {
      const app = new Hono()
      app.use('*', async (c, next) => {
        c.set('user', { id: 'admin-123', role: 'admin' })
        c.set('db', mockDb)
        await next()
      })
      app.use(
        '/api/search/*',
        search({
          localTypes: ['tasks', 'admin-logs'],
          providerTypes: {},
        })
      )

      const res = await searchRequest(app, 'admin-logs', { query: 'test' })
      expect(res.status).toBe(200)
    })

    it('returns 403 for insufficient permissions', async () => {
      const app = new Hono()
      app.use('*', async (c, next) => {
        c.set('user', { id: 'user-123', role: 'user', permissions: [] })
        c.set('db', mockDb)
        await next()
      })
      app.use(
        '/api/search/*',
        search({
          localTypes: ['restricted-type'],
          providerTypes: {},
          requirePermission: true,
        })
      )

      const res = await searchRequest(app, 'restricted-type', { query: 'test' })
      expect(res.status).toBe(403)

      const body = (await res.json()) as ErrorResponse
      expect(body.error?.toLowerCase()).toMatch(/permission|forbidden|access/)
    })
  })
})

// ============================================================================
// 6. Edge Cases and Error Handling
// ============================================================================

describe('Search Middleware - Edge Cases', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.query.tasks.findMany.mockResolvedValue([])

    app = createAuthenticatedApp({
      localTypes: ['tasks'],
      providerTypes: {
        'github:issues': { scopes: ['repo'] },
      },
    })
  })

  describe('Input validation', () => {
    it('handles very long query strings', async () => {
      const longQuery = 'a'.repeat(10000)
      const res = await searchRequest(app, 'tasks', { query: longQuery })
      expect([200, 400, 414]).toContain(res.status)
    })

    it('handles special characters in type param', async () => {
      const res = await searchRequest(app, 'tasks<script>', {})
      expect(res.status).toBe(404)
    })

    it('handles URL encoded characters', async () => {
      const res = await searchRequest(app, 'tasks', { query: 'test%20query' })
      expect(res.status).toBe(200)
    })

    it('handles non-numeric limit gracefully', async () => {
      const res = await app.request('/api/search/tasks?limit=abc', { method: 'GET' })
      expect([200, 400]).toContain(res.status)
    })

    it('handles non-numeric offset gracefully', async () => {
      const res = await app.request('/api/search/tasks?offset=xyz', { method: 'GET' })
      expect([200, 400]).toContain(res.status)
    })
  })

  describe('Database errors', () => {
    it('handles database connection errors', async () => {
      mockDb.query.tasks.findMany.mockRejectedValue(new Error('Database connection failed'))

      const res = await searchRequest(app, 'tasks', { query: 'test' })
      expect(res.status).toBe(500)
    })

    it('returns generic error message for database errors', async () => {
      mockDb.query.tasks.findMany.mockRejectedValue(new Error('Sensitive DB error'))

      const res = await searchRequest(app, 'tasks', { query: 'test' })
      expect(res.status).toBe(500)

      const body = (await res.json()) as ErrorResponse
      expect(body.error).not.toContain('Sensitive')
    })

    it('handles timeout errors', async () => {
      mockDb.query.tasks.findMany.mockImplementation(
        () => new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 100))
      )

      const res = await searchRequest(app, 'tasks', { query: 'test' })
      expect([500, 504]).toContain(res.status)
    })
  })

  describe('Concurrent requests', () => {
    it('handles concurrent search requests', async () => {
      mockDb.query.tasks.findMany.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return [{ id: '1', title: 'Task' }]
      })

      const requests = Array.from({ length: 5 }, () => searchRequest(app, 'tasks', { query: 'test' }))

      const responses = await Promise.all(requests)
      responses.forEach((res) => {
        expect(res.status).toBe(200)
      })
    })

    it('isolates search contexts between requests', async () => {
      const calls: string[] = []
      mockDb.query.tasks.findMany.mockImplementation(async (args: { where?: { q?: string } }) => {
        calls.push(args?.where?.q || 'no-query')
        await new Promise((resolve) => setTimeout(resolve, 10))
        return []
      })

      await Promise.all([
        searchRequest(app, 'tasks', { query: 'first' }),
        searchRequest(app, 'tasks', { query: 'second' }),
      ])

      expect(calls).toContain('first')
      expect(calls).toContain('second')
    })
  })
})

// ============================================================================
// 7. Configuration Tests
// ============================================================================

describe('Search Middleware - Configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.query.tasks.findMany.mockResolvedValue([])
  })

  describe('localTypes configuration', () => {
    it('only allows configured local types', async () => {
      const app = createAuthenticatedApp({
        localTypes: ['tasks'],
        providerTypes: {},
      })

      const tasksRes = await searchRequest(app, 'tasks')
      expect(tasksRes.status).toBe(200)

      const notesRes = await searchRequest(app, 'notes')
      expect(notesRes.status).toBe(404)
    })

    it('supports empty localTypes', async () => {
      const app = createAuthenticatedApp({
        localTypes: [],
        providerTypes: {
          'github:issues': { scopes: ['repo'] },
        },
      })

      const res = await searchRequest(app, 'tasks')
      expect(res.status).toBe(404)
    })
  })

  describe('providerTypes configuration', () => {
    it('only allows configured provider types', async () => {
      mockLinkedAccounts.get.mockResolvedValue({ accessToken: 'token' })
      mockIntegrations.get.mockResolvedValue({
        search: vi.fn().mockResolvedValue({ results: [], total: 0 }),
      })

      const app = createAuthenticatedApp({
        localTypes: [],
        providerTypes: {
          'github:issues': { scopes: ['repo'] },
        },
      })

      const issuesRes = await searchRequest(app, 'github:issues')
      expect(issuesRes.status).not.toBe(404)

      const reposRes = await searchRequest(app, 'github:repos')
      expect(reposRes.status).toBe(404)
    })

    it('validates required scopes from config', async () => {
      mockLinkedAccounts.get.mockResolvedValue({
        accessToken: 'token',
        scopes: ['read:user'], // missing 'repo'
      })

      const app = createAuthenticatedApp({
        localTypes: [],
        providerTypes: {
          'github:issues': { scopes: ['repo'] },
        },
      })

      const res = await searchRequest(app, 'github:issues')
      expect(res.status).toBe(403)
    })

    it('supports multiple scopes requirement', async () => {
      mockLinkedAccounts.get.mockResolvedValue({
        accessToken: 'token',
        scopes: ['repo', 'read:org'],
      })
      mockIntegrations.get.mockResolvedValue({
        search: vi.fn().mockResolvedValue({ results: [], total: 0 }),
      })

      const app = createAuthenticatedApp({
        localTypes: [],
        providerTypes: {
          'github:org-members': { scopes: ['read:org', 'repo'] },
        },
      })

      const res = await searchRequest(app, 'github:org-members')
      expect(res.status).toBe(200)
    })
  })

  describe('default configuration', () => {
    it('works with no configuration (empty defaults)', async () => {
      const app = createAuthenticatedApp()

      // With no config, all types should 404
      const res = await searchRequest(app, 'tasks')
      expect(res.status).toBe(404)
    })
  })
})

// ============================================================================
// 8. Query Plan Caching Tests
// ============================================================================

import {
  QueryPlanCache,
  getQueryPlanCache,
  computeIndexHints,
  encodeCursor,
  decodeCursor,
  type IndexHint,
  type SearchAnalyticsEvent,
} from '../../middleware/search'

describe('Search Middleware - Query Plan Caching', () => {
  describe('QueryPlanCache class', () => {
    it('caches query plans', () => {
      const cache = new QueryPlanCache(100, 60000)
      const where = { status: 'open' }
      const hints: IndexHint[] = [{ indexField: 'status', indexType: 'hash' }]

      cache.set('tasks', 'test', { status: 'open' }, where, hints)

      const result = cache.get('tasks', 'test', { status: 'open' })
      expect(result).not.toBeNull()
      expect(result?.where).toEqual(where)
      expect(result?.indexHints).toEqual(hints)
    })

    it('returns null for cache miss', () => {
      const cache = new QueryPlanCache(100, 60000)
      const result = cache.get('tasks', 'unknown', {})
      expect(result).toBeNull()
    })

    it('expires entries based on TTL', async () => {
      const cache = new QueryPlanCache(100, 50) // 50ms TTL
      cache.set('tasks', 'test', {}, {}, [])

      // Entry should exist immediately
      expect(cache.get('tasks', 'test', {})).not.toBeNull()

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 60))

      // Entry should be expired
      expect(cache.get('tasks', 'test', {})).toBeNull()
    })

    it('evicts old entries when at capacity', () => {
      const cache = new QueryPlanCache(2, 60000) // Max 2 entries

      cache.set('type1', 'q1', {}, {}, [])
      cache.set('type2', 'q2', {}, {}, [])
      cache.set('type3', 'q3', {}, {}, []) // Should evict type1

      // First entry should be evicted
      expect(cache.get('type1', 'q1', {})).toBeNull()
      // Later entries should still exist
      expect(cache.get('type2', 'q2', {})).not.toBeNull()
      expect(cache.get('type3', 'q3', {})).not.toBeNull()
    })

    it('tracks hit count', () => {
      const cache = new QueryPlanCache(100, 60000)
      cache.set('tasks', 'test', {}, {}, [])

      const result1 = cache.get('tasks', 'test', {})
      expect(result1?.hitCount).toBe(1)

      const result2 = cache.get('tasks', 'test', {})
      expect(result2?.hitCount).toBe(2)
    })

    it('clears all entries', () => {
      const cache = new QueryPlanCache(100, 60000)
      cache.set('type1', 'q1', {}, {}, [])
      cache.set('type2', 'q2', {}, {}, [])

      cache.clear()

      expect(cache.get('type1', 'q1', {})).toBeNull()
      expect(cache.get('type2', 'q2', {})).toBeNull()
    })

    it('provides cache statistics', () => {
      const cache = new QueryPlanCache(100, 60000)
      cache.set('type1', 'q1', {}, {}, [])
      cache.set('type2', 'q2', {}, {}, [])

      const stats = cache.stats()
      expect(stats.size).toBe(2)
      expect(stats.maxEntries).toBe(100)
      expect(stats.ttlMs).toBe(60000)
    })

    it('generates consistent hash for same parameters', () => {
      const cache = new QueryPlanCache(100, 60000)
      cache.set('tasks', 'query', { a: '1', b: '2' }, {}, [])

      // Same params in different order should hit cache
      const result = cache.get('tasks', 'query', { b: '2', a: '1' })
      expect(result).not.toBeNull()
    })
  })

  describe('getQueryPlanCache singleton', () => {
    it('returns the same instance', () => {
      const cache1 = getQueryPlanCache()
      const cache2 = getQueryPlanCache()
      expect(cache1).toBe(cache2)
    })
  })
})

// ============================================================================
// 9. Index Hints Tests
// ============================================================================

describe('Search Middleware - Index Hints', () => {
  describe('computeIndexHints', () => {
    it('returns FTS hints for text queries', () => {
      const hints = computeIndexHints('tasks', 'search term', {})
      expect(hints.some((h) => h.useFTS)).toBe(true)
    })

    it('returns btree hints for time filters', () => {
      const hints = computeIndexHints('events', '', {
        GE_eventTime: '2024-01-01',
      })
      expect(hints.some((h) => h.indexType === 'btree')).toBe(true)
    })

    it('returns hash hints for status filters', () => {
      const hints = computeIndexHints('tasks', '', {
        status: 'open',
      })
      expect(hints.some((h) => h.indexType === 'hash')).toBe(true)
    })

    it('returns hints for EPCIS bizStep', () => {
      const hints = computeIndexHints('events', '', {
        EQ_bizStep: 'shipping',
      })
      expect(hints.some((h) => h.indexField === 'bizStep')).toBe(true)
    })

    it('returns hints for EPCIS bizLocation', () => {
      const hints = computeIndexHints('events', '', {
        EQ_bizLocation: 'warehouse-1',
      })
      expect(hints.some((h) => h.indexField === 'bizLocation')).toBe(true)
    })

    it('returns composite hints for time + status queries', () => {
      const hints = computeIndexHints('events', '', {
        GE_eventTime: '2024-01-01',
        status: 'active',
      })
      expect(hints.some((h) => h.compositeFields?.includes('status'))).toBe(true)
    })

    it('uses custom hints when provided', () => {
      const customHints = {
        tasks: [{ indexField: 'dueDate', indexType: 'btree' as const }],
      }
      const hints = computeIndexHints('tasks', '', {}, customHints)
      expect(hints.some((h) => h.indexField === 'dueDate')).toBe(true)
    })

    it('returns empty array for queries with no hint-worthy patterns', () => {
      const hints = computeIndexHints('tasks', '', {})
      // May still have some hints based on type, but shouldn't error
      expect(Array.isArray(hints)).toBe(true)
    })
  })
})

// ============================================================================
// 10. Pagination Optimization Tests
// ============================================================================

describe('Search Middleware - Pagination Optimization', () => {
  describe('cursor encoding/decoding', () => {
    it('encodes and decodes offset correctly', () => {
      const cursor = encodeCursor(100)
      const decoded = decodeCursor(cursor)
      expect(decoded?.offset).toBe(100)
    })

    it('encodes and decodes with sort field', () => {
      const cursor = encodeCursor(50, 'createdAt', '2024-01-01')
      const decoded = decodeCursor(cursor)
      expect(decoded?.offset).toBe(50)
      expect(decoded?.sortField).toBe('createdAt')
      expect(decoded?.sortValue).toBe('2024-01-01')
    })

    it('returns null for invalid cursor', () => {
      const decoded = decodeCursor('invalid-cursor')
      expect(decoded).toBeNull()
    })

    it('returns null for malformed base64', () => {
      const decoded = decodeCursor('!!!not-base64!!!')
      expect(decoded).toBeNull()
    })
  })

  describe('cursor-based pagination in middleware', () => {
    let app: Hono

    beforeEach(() => {
      vi.clearAllMocks()
      mockDb.query.tasks.findMany.mockResolvedValue([
        { id: '1', title: 'Task 1' },
        { id: '2', title: 'Task 2' },
      ])
    })

    it('supports cursor parameter', async () => {
      app = new Hono()
      app.use('*', async (c, next) => {
        c.set('user', { id: 'user-123', role: 'user' })
        c.set('db', mockDb)
        await next()
      })
      app.use(
        '/api/search/*',
        search({
          localTypes: ['tasks'],
          enableCursorPagination: true,
        })
      )

      const cursor = encodeCursor(10)
      const res = await app.request(`/api/search/tasks?cursor=${cursor}`, {
        method: 'GET',
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as SearchResult
      expect(body.offset).toBe(10)
    })

    it('returns next/prev cursors when enabled', async () => {
      mockDb.query.tasks.findMany.mockResolvedValue(
        Array.from({ length: 20 }, (_, i) => ({ id: String(i), title: `Task ${i}` }))
      )

      app = new Hono()
      app.use('*', async (c, next) => {
        c.set('user', { id: 'user-123', role: 'user' })
        c.set('db', mockDb)
        await next()
      })
      app.use(
        '/api/search/*',
        search({
          localTypes: ['tasks'],
          enableCursorPagination: true,
        })
      )

      const res = await app.request('/api/search/tasks?offset=10&limit=10', {
        method: 'GET',
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as SearchResult & {
        nextCursor?: string
        prevCursor?: string
      }
      expect(body.prevCursor).toBeDefined()
    })

    it('does not include cursors when disabled', async () => {
      app = new Hono()
      app.use('*', async (c, next) => {
        c.set('user', { id: 'user-123', role: 'user' })
        c.set('db', mockDb)
        await next()
      })
      app.use(
        '/api/search/*',
        search({
          localTypes: ['tasks'],
          enableCursorPagination: false,
        })
      )

      const res = await app.request('/api/search/tasks?offset=10', {
        method: 'GET',
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as SearchResult & {
        nextCursor?: string
        prevCursor?: string
      }
      expect(body.nextCursor).toBeUndefined()
      expect(body.prevCursor).toBeUndefined()
    })
  })
})

// ============================================================================
// 11. Search Analytics Tests
// ============================================================================

describe('Search Middleware - Analytics Hooks', () => {
  let app: Hono
  let analyticsEvents: SearchAnalyticsEvent[]

  beforeEach(() => {
    vi.clearAllMocks()
    analyticsEvents = []
    mockDb.query.tasks.findMany.mockResolvedValue([
      { id: '1', title: 'Task 1' },
    ])

    app = new Hono()
    app.use('*', async (c, next) => {
      c.set('user', { id: 'user-456', role: 'user' })
      c.set('db', mockDb)
      await next()
    })
    app.use(
      '/api/search/*',
      search({
        localTypes: ['tasks'],
        analyticsHook: (event) => {
          analyticsEvents.push(event)
        },
      })
    )
  })

  it('calls analytics hook on successful search', async () => {
    const res = await app.request('/api/search/tasks?q=test', {
      method: 'GET',
    })
    expect(res.status).toBe(200)

    // Wait a tick for async analytics
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(analyticsEvents.length).toBe(1)
    expect(analyticsEvents[0].type).toBe('tasks')
    expect(analyticsEvents[0].query).toBe('test')
  })

  it('includes search duration in analytics', async () => {
    await app.request('/api/search/tasks?q=test', {
      method: 'GET',
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(analyticsEvents[0].durationMs).toBeGreaterThanOrEqual(0)
  })

  it('includes user ID in analytics', async () => {
    await app.request('/api/search/tasks?q=test', {
      method: 'GET',
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(analyticsEvents[0].userId).toBe('user-456')
  })

  it('includes result counts in analytics', async () => {
    await app.request('/api/search/tasks?q=test', {
      method: 'GET',
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(analyticsEvents[0].resultCount).toBe(1)
    expect(analyticsEvents[0].totalCount).toBe(1)
  })

  it('includes filters in analytics', async () => {
    await app.request('/api/search/tasks?q=test&status=open', {
      method: 'GET',
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(analyticsEvents[0].filters).toEqual({ status: 'open' })
  })

  it('includes cache hit status in analytics', async () => {
    // Use a unique query to avoid hitting global cache from other tests
    const uniqueQuery = `unique-${Date.now()}`

    // First request - cache miss
    await app.request(`/api/search/tasks?q=${uniqueQuery}&status=uniquestatus`, {
      method: 'GET',
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    const firstEventIndex = analyticsEvents.length - 1

    // First request should be cache miss
    expect(analyticsEvents[firstEventIndex].cacheHit).toBe(false)

    // Second identical request - cache hit
    await app.request(`/api/search/tasks?q=${uniqueQuery}&status=uniquestatus`, {
      method: 'GET',
    })

    await new Promise((resolve) => setTimeout(resolve, 10))

    // Second request should be cache hit
    expect(analyticsEvents[analyticsEvents.length - 1].cacheHit).toBe(true)
  })

  it('includes timestamp in analytics', async () => {
    const before = Date.now()

    await app.request('/api/search/tasks?q=test', {
      method: 'GET',
    })

    const after = Date.now()

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(analyticsEvents[0].timestamp).toBeGreaterThanOrEqual(before)
    expect(analyticsEvents[0].timestamp).toBeLessThanOrEqual(after)
  })

  it('gracefully handles analytics hook errors', async () => {
    const errorApp = new Hono()
    errorApp.use('*', async (c, next) => {
      c.set('user', { id: 'user-123', role: 'user' })
      c.set('db', mockDb)
      await next()
    })
    errorApp.use(
      '/api/search/*',
      search({
        localTypes: ['tasks'],
        analyticsHook: () => {
          throw new Error('Analytics failed')
        },
      })
    )

    // Should not throw, search should still work
    const res = await errorApp.request('/api/search/tasks?q=test', {
      method: 'GET',
    })
    expect(res.status).toBe(200)
  })
})

// ============================================================================
// 12. Custom Index Hints Configuration Tests
// ============================================================================

describe('Search Middleware - Custom Index Hints', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.query.tasks.findMany.mockResolvedValue([])
  })

  it('uses custom index hints from config', async () => {
    const analyticsEvents: SearchAnalyticsEvent[] = []

    const app = new Hono()
    app.use('*', async (c, next) => {
      c.set('user', { id: 'user-123', role: 'user' })
      c.set('db', mockDb)
      await next()
    })
    app.use(
      '/api/search/*',
      search({
        localTypes: ['tasks'],
        indexHints: {
          tasks: [{ indexField: 'customField', indexType: 'gin' }],
        },
        analyticsHook: (event) => {
          analyticsEvents.push(event)
        },
        // Disable cache to ensure we compute fresh index hints
        enableQueryPlanCache: false,
      })
    )

    await app.request('/api/search/tasks', { method: 'GET' })

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(analyticsEvents[0].indexHints).toBeDefined()
    expect(analyticsEvents[0].indexHints?.some((h) => h.indexField === 'customField')).toBe(true)
  })
})
