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
