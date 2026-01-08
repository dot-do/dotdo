import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import type { Context } from 'hono'

/**
 * Resources Middleware Tests
 *
 * These tests verify the resources middleware for CRUD operations on typed resources.
 * They are expected to FAIL until the resources middleware is implemented.
 *
 * Implementation requirements:
 * - Create middleware in api/middleware/resources.ts
 * - Support full CRUD: list, get, create, update (PUT/PATCH), delete
 * - Support pagination with limit and offset
 * - Support typed permissions per resource type and operation
 * - Support lifecycle hooks (beforeCreate, afterCreate, etc.)
 * - Require authentication
 */

// Import the middleware (will fail until implemented)
// @ts-expect-error - Middleware not yet implemented
import { resources, type ResourcesConfig, type ResourceHooks } from '../../middleware/resources'

// ============================================================================
// Test Types
// ============================================================================

interface ListResponse {
  items: unknown[]
  total: number
  limit: number
  offset: number
}

interface Resource {
  id: string
  [key: string]: unknown
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
      findFirst: vi.fn(),
    },
    projects: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    notes: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  },
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}

// ============================================================================
// Helper Functions
// ============================================================================

function createTestApp(config?: ResourcesConfig): Hono {
  const app = new Hono()

  // Mock auth middleware - sets user context only with valid token
  app.use('*', async (c, next) => {
    const authHeader = c.req.header('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      c.set('user', { id: 'user-123', role: 'user' })
    }
    c.set('db', mockDb)
    await next()
  })

  app.use('/api/:type/*', resources(config))
  app.use('/api/:type', resources(config))
  return app
}

function createAuthenticatedApp(config?: ResourcesConfig, user?: { id: string; role: string; permissions?: string[] }): Hono {
  const app = new Hono()

  // Auth middleware always sets user
  app.use('*', async (c, next) => {
    c.set('user', user ?? { id: 'user-123', role: 'user' })
    c.set('db', mockDb)
    await next()
  })

  app.use('/api/:type/*', resources(config))
  app.use('/api/:type', resources(config))
  return app
}

async function listRequest(
  app: Hono,
  type: string,
  options: {
    limit?: number
    offset?: number
    headers?: Record<string, string>
  } = {}
): Promise<Response> {
  const params = new URLSearchParams()
  if (options.limit !== undefined) params.set('limit', String(options.limit))
  if (options.offset !== undefined) params.set('offset', String(options.offset))

  const queryString = params.toString()
  const url = `/api/${type}${queryString ? `?${queryString}` : ''}`

  return app.request(url, {
    method: 'GET',
    headers: {
      ...options.headers,
    },
  })
}

async function getRequest(
  app: Hono,
  type: string,
  id: string,
  headers?: Record<string, string>
): Promise<Response> {
  return app.request(`/api/${type}/${id}`, {
    method: 'GET',
    headers,
  })
}

async function createRequest(
  app: Hono,
  type: string,
  data: unknown,
  headers?: Record<string, string>
): Promise<Response> {
  return app.request(`/api/${type}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(data),
  })
}

async function updateRequest(
  app: Hono,
  type: string,
  id: string,
  data: unknown,
  method: 'PUT' | 'PATCH' = 'PUT',
  headers?: Record<string, string>
): Promise<Response> {
  return app.request(`/api/${type}/${id}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(data),
  })
}

async function deleteRequest(
  app: Hono,
  type: string,
  id: string,
  headers?: Record<string, string>
): Promise<Response> {
  return app.request(`/api/${type}/${id}`, {
    method: 'DELETE',
    headers,
  })
}

// ============================================================================
// 1. List Resources Tests
// ============================================================================

describe('Resources Middleware - List Resources', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.query.tasks.findMany.mockResolvedValue([
      { id: '1', title: 'Task 1', status: 'open' },
      { id: '2', title: 'Task 2', status: 'completed' },
    ])

    app = createAuthenticatedApp({
      types: {
        tasks: {},
        projects: {},
      },
    })
  })

  describe('GET /api/:type lists resources', () => {
    it('returns list of resources for configured type', async () => {
      const res = await listRequest(app, 'tasks')
      expect(res.status).toBe(200)

      const body = (await res.json()) as ListResponse
      expect(body.items).toBeDefined()
      expect(Array.isArray(body.items)).toBe(true)
    })

    it('returns resources from database', async () => {
      const res = await listRequest(app, 'tasks')
      expect(res.status).toBe(200)

      const body = (await res.json()) as ListResponse
      expect(body.items.length).toBeGreaterThan(0)
      expect(mockDb.query.tasks.findMany).toHaveBeenCalled()
    })

    it('returns 404 for unconfigured type', async () => {
      const res = await listRequest(app, 'unknowntype')
      expect(res.status).toBe(404)

      const body = (await res.json()) as ErrorResponse
      expect(body.error).toBeDefined()
    })

    it('returns 404 for type with invalid characters', async () => {
      const res = await listRequest(app, '../../../etc/passwd')
      expect(res.status).toBe(404)
    })
  })

  describe('Pagination with limit and offset', () => {
    it('supports limit query param', async () => {
      const res = await listRequest(app, 'tasks', { limit: 10 })
      expect(res.status).toBe(200)

      const body = (await res.json()) as ListResponse
      expect(body.limit).toBe(10)
    })

    it('supports offset query param', async () => {
      const res = await listRequest(app, 'tasks', { offset: 20 })
      expect(res.status).toBe(200)

      const body = (await res.json()) as ListResponse
      expect(body.offset).toBe(20)
    })

    it('uses default limit when not specified', async () => {
      const res = await listRequest(app, 'tasks')
      expect(res.status).toBe(200)

      const body = (await res.json()) as ListResponse
      expect(body.limit).toBe(20) // default limit
    })

    it('uses default offset of 0 when not specified', async () => {
      const res = await listRequest(app, 'tasks')
      expect(res.status).toBe(200)

      const body = (await res.json()) as ListResponse
      expect(body.offset).toBe(0)
    })

    it('enforces maximum limit', async () => {
      const res = await listRequest(app, 'tasks', { limit: 10000 })
      expect(res.status).toBe(200)

      const body = (await res.json()) as ListResponse
      expect(body.limit).toBeLessThanOrEqual(100) // max limit
    })

    it('passes pagination to database query', async () => {
      await listRequest(app, 'tasks', { limit: 15, offset: 30 })
      expect(mockDb.query.tasks.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 15,
          offset: 30,
        })
      )
    })
  })

  describe('Response format', () => {
    it('returns items array', async () => {
      const res = await listRequest(app, 'tasks')
      expect(res.status).toBe(200)

      const body = (await res.json()) as ListResponse
      expect(body.items).toBeDefined()
      expect(Array.isArray(body.items)).toBe(true)
    })

    it('returns total count', async () => {
      const res = await listRequest(app, 'tasks')
      expect(res.status).toBe(200)

      const body = (await res.json()) as ListResponse
      expect(typeof body.total).toBe('number')
    })

    it('returns limit in response', async () => {
      const res = await listRequest(app, 'tasks', { limit: 15 })
      expect(res.status).toBe(200)

      const body = (await res.json()) as ListResponse
      expect(body.limit).toBe(15)
    })

    it('returns offset in response', async () => {
      const res = await listRequest(app, 'tasks', { offset: 25 })
      expect(res.status).toBe(200)

      const body = (await res.json()) as ListResponse
      expect(body.offset).toBe(25)
    })

    it('returns JSON content type', async () => {
      const res = await listRequest(app, 'tasks')
      expect(res.headers.get('content-type')).toContain('application/json')
    })
  })
})

// ============================================================================
// 2. Get Single Resource Tests
// ============================================================================

describe('Resources Middleware - Get Single Resource', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.query.tasks.findFirst.mockResolvedValue({
      id: 'task-1',
      title: 'Test Task',
      status: 'open',
    })

    app = createAuthenticatedApp({
      types: {
        tasks: {},
      },
    })
  })

  describe('GET /api/:type/:id gets single resource', () => {
    it('returns single resource by id', async () => {
      const res = await getRequest(app, 'tasks', 'task-1')
      expect(res.status).toBe(200)

      const body = (await res.json()) as Resource
      expect(body.id).toBe('task-1')
    })

    it('queries database with id', async () => {
      await getRequest(app, 'tasks', 'task-1')
      expect(mockDb.query.tasks.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'task-1',
          }),
        })
      )
    })

    it('returns full resource object', async () => {
      const res = await getRequest(app, 'tasks', 'task-1')
      expect(res.status).toBe(200)

      const body = (await res.json()) as Resource
      expect(body.title).toBe('Test Task')
      expect(body.status).toBe('open')
    })
  })

  describe('Returns 404 if not found', () => {
    it('returns 404 for non-existent resource', async () => {
      mockDb.query.tasks.findFirst.mockResolvedValue(null)

      const res = await getRequest(app, 'tasks', 'non-existent-id')
      expect(res.status).toBe(404)
    })

    it('returns error message for 404', async () => {
      mockDb.query.tasks.findFirst.mockResolvedValue(null)

      const res = await getRequest(app, 'tasks', 'non-existent-id')
      const body = (await res.json()) as ErrorResponse
      expect(body.error).toBeDefined()
      expect(body.error.toLowerCase()).toMatch(/not found|resource/)
    })

    it('returns 404 for unconfigured type', async () => {
      const res = await getRequest(app, 'unknowntype', 'some-id')
      expect(res.status).toBe(404)
    })
  })
})

// ============================================================================
// 3. Create Resource Tests
// ============================================================================

describe('Resources Middleware - Create Resource', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.insert.mockResolvedValue({
      id: 'new-task-1',
      title: 'New Task',
      status: 'open',
      createdAt: new Date().toISOString(),
    })

    app = createAuthenticatedApp({
      types: {
        tasks: {
          requiredFields: ['title'],
        },
      },
    })
  })

  describe('POST /api/:type creates resource', () => {
    it('creates resource and returns 201', async () => {
      const res = await createRequest(app, 'tasks', { title: 'New Task' })
      expect(res.status).toBe(201)
    })

    it('returns created resource', async () => {
      const res = await createRequest(app, 'tasks', { title: 'New Task' })
      expect(res.status).toBe(201)

      const body = (await res.json()) as Resource
      expect(body.id).toBe('new-task-1')
      expect(body.title).toBe('New Task')
    })

    it('calls database insert', async () => {
      await createRequest(app, 'tasks', { title: 'New Task' })
      expect(mockDb.insert).toHaveBeenCalled()
    })

    it('passes data to database', async () => {
      await createRequest(app, 'tasks', { title: 'New Task', priority: 'high' })
      expect(mockDb.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'New Task',
          priority: 'high',
        })
      )
    })

    it('generates id if not provided', async () => {
      const res = await createRequest(app, 'tasks', { title: 'New Task' })
      expect(res.status).toBe(201)

      const body = (await res.json()) as Resource
      expect(body.id).toBeDefined()
    })
  })

  describe('Validates required fields', () => {
    it('returns 400 for missing required field', async () => {
      const res = await createRequest(app, 'tasks', { description: 'No title' })
      expect(res.status).toBe(400)
    })

    it('returns validation error message', async () => {
      const res = await createRequest(app, 'tasks', { description: 'No title' })
      expect(res.status).toBe(400)

      const body = (await res.json()) as ErrorResponse
      expect(body.error).toBeDefined()
      expect(body.error.toLowerCase()).toMatch(/required|missing|title/)
    })

    it('returns 400 for empty body', async () => {
      const res = await createRequest(app, 'tasks', {})
      expect(res.status).toBe(400)
    })

    it('returns 400 for malformed JSON', async () => {
      const res = await app.request('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{ invalid json }',
      })
      expect(res.status).toBe(400)
    })
  })

  describe('Returns 404 for unconfigured type', () => {
    it('returns 404 when creating resource of unknown type', async () => {
      const res = await createRequest(app, 'unknowntype', { name: 'test' })
      expect(res.status).toBe(404)
    })
  })
})

// ============================================================================
// 4. Update Resource Tests
// ============================================================================

describe('Resources Middleware - Update Resource', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.query.tasks.findFirst.mockResolvedValue({
      id: 'task-1',
      title: 'Original Task',
      status: 'open',
      priority: 'low',
    })
    mockDb.update.mockResolvedValue({
      id: 'task-1',
      title: 'Updated Task',
      status: 'completed',
      priority: 'high',
    })

    app = createAuthenticatedApp({
      types: {
        tasks: {},
      },
    })
  })

  describe('PUT /api/:type/:id full update', () => {
    it('updates resource with PUT', async () => {
      const res = await updateRequest(app, 'tasks', 'task-1', {
        title: 'Updated Task',
        status: 'completed',
        priority: 'high',
      })
      expect(res.status).toBe(200)
    })

    it('returns updated resource', async () => {
      const res = await updateRequest(app, 'tasks', 'task-1', {
        title: 'Updated Task',
        status: 'completed',
        priority: 'high',
      })
      expect(res.status).toBe(200)

      const body = (await res.json()) as Resource
      expect(body.title).toBe('Updated Task')
    })

    it('calls database update', async () => {
      await updateRequest(app, 'tasks', 'task-1', {
        title: 'Updated Task',
      })
      expect(mockDb.update).toHaveBeenCalled()
    })

    it('replaces all fields with PUT', async () => {
      await updateRequest(app, 'tasks', 'task-1', {
        title: 'Updated Task',
        status: 'completed',
      })
      // PUT should replace the entire resource
      expect(mockDb.update).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Updated Task',
          status: 'completed',
        })
      )
    })
  })

  describe('PATCH /api/:type/:id partial update', () => {
    it('updates resource with PATCH', async () => {
      const res = await updateRequest(
        app,
        'tasks',
        'task-1',
        { status: 'completed' },
        'PATCH'
      )
      expect(res.status).toBe(200)
    })

    it('returns updated resource', async () => {
      mockDb.update.mockResolvedValue({
        id: 'task-1',
        title: 'Original Task',
        status: 'completed',
        priority: 'low',
      })

      const res = await updateRequest(
        app,
        'tasks',
        'task-1',
        { status: 'completed' },
        'PATCH'
      )
      expect(res.status).toBe(200)

      const body = (await res.json()) as Resource
      expect(body.status).toBe('completed')
    })

    it('only updates provided fields with PATCH', async () => {
      await updateRequest(app, 'tasks', 'task-1', { status: 'completed' }, 'PATCH')
      // PATCH should only update provided fields
      expect(mockDb.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'completed',
        })
      )
    })

    it('preserves existing fields with PATCH', async () => {
      mockDb.update.mockResolvedValue({
        id: 'task-1',
        title: 'Original Task',
        status: 'completed',
        priority: 'low',
      })

      const res = await updateRequest(
        app,
        'tasks',
        'task-1',
        { status: 'completed' },
        'PATCH'
      )
      const body = (await res.json()) as Resource

      // Original title should be preserved
      expect(body.title).toBe('Original Task')
    })
  })

  describe('Returns 404 if not found', () => {
    it('returns 404 for non-existent resource with PUT', async () => {
      mockDb.query.tasks.findFirst.mockResolvedValue(null)

      const res = await updateRequest(app, 'tasks', 'non-existent', {
        title: 'Updated',
      })
      expect(res.status).toBe(404)
    })

    it('returns 404 for non-existent resource with PATCH', async () => {
      mockDb.query.tasks.findFirst.mockResolvedValue(null)

      const res = await updateRequest(
        app,
        'tasks',
        'non-existent',
        { title: 'Updated' },
        'PATCH'
      )
      expect(res.status).toBe(404)
    })

    it('returns error message for 404', async () => {
      mockDb.query.tasks.findFirst.mockResolvedValue(null)

      const res = await updateRequest(app, 'tasks', 'non-existent', {
        title: 'Updated',
      })
      const body = (await res.json()) as ErrorResponse
      expect(body.error).toBeDefined()
    })
  })
})

// ============================================================================
// 5. Delete Resource Tests
// ============================================================================

describe('Resources Middleware - Delete Resource', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.query.tasks.findFirst.mockResolvedValue({
      id: 'task-1',
      title: 'Task to Delete',
    })
    mockDb.delete.mockResolvedValue({ id: 'task-1' })

    app = createAuthenticatedApp({
      types: {
        tasks: {},
      },
    })
  })

  describe('DELETE /api/:type/:id deletes resource', () => {
    it('deletes resource and returns 204', async () => {
      const res = await deleteRequest(app, 'tasks', 'task-1')
      expect(res.status).toBe(204)
    })

    it('returns empty body on success', async () => {
      const res = await deleteRequest(app, 'tasks', 'task-1')
      expect(res.status).toBe(204)

      const text = await res.text()
      expect(text).toBe('')
    })

    it('calls database delete', async () => {
      await deleteRequest(app, 'tasks', 'task-1')
      expect(mockDb.delete).toHaveBeenCalled()
    })

    it('passes id to database delete', async () => {
      await deleteRequest(app, 'tasks', 'task-1')
      expect(mockDb.delete).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'task-1',
        })
      )
    })
  })

  describe('Returns 404 if not found', () => {
    it('returns 404 for non-existent resource', async () => {
      mockDb.query.tasks.findFirst.mockResolvedValue(null)

      const res = await deleteRequest(app, 'tasks', 'non-existent')
      expect(res.status).toBe(404)
    })

    it('returns error message for 404', async () => {
      mockDb.query.tasks.findFirst.mockResolvedValue(null)

      const res = await deleteRequest(app, 'tasks', 'non-existent')
      const body = (await res.json()) as ErrorResponse
      expect(body.error).toBeDefined()
    })
  })

  describe('Returns 404 for unconfigured type', () => {
    it('returns 404 when deleting resource of unknown type', async () => {
      const res = await deleteRequest(app, 'unknowntype', 'some-id')
      expect(res.status).toBe(404)
    })
  })
})

// ============================================================================
// 6. Permissions Tests
// ============================================================================

describe('Resources Middleware - Permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.query.tasks.findMany.mockResolvedValue([])
    mockDb.query.tasks.findFirst.mockResolvedValue({ id: '1', title: 'Task' })
    mockDb.insert.mockResolvedValue({ id: '1', title: 'Task' })
    mockDb.update.mockResolvedValue({ id: '1', title: 'Task' })
    mockDb.delete.mockResolvedValue({ id: '1' })
  })

  describe('Enforced per type and operation', () => {
    it('allows read for user with read permission', async () => {
      const app = createAuthenticatedApp(
        {
          types: {
            tasks: {
              permissions: { read: 'user', write: 'admin' },
            },
          },
        },
        { id: 'user-1', role: 'user' }
      )

      const res = await listRequest(app, 'tasks')
      expect(res.status).toBe(200)
    })

    it('allows write for user with write permission', async () => {
      const app = createAuthenticatedApp(
        {
          types: {
            tasks: {
              permissions: { read: 'user', write: 'admin' },
            },
          },
        },
        { id: 'admin-1', role: 'admin' }
      )

      const res = await createRequest(app, 'tasks', { title: 'New Task' })
      expect([200, 201]).toContain(res.status)
    })

    it('returns 403 for user without read permission', async () => {
      const app = createAuthenticatedApp(
        {
          types: {
            tasks: {
              permissions: { read: 'admin', write: 'admin' },
            },
          },
        },
        { id: 'user-1', role: 'user' }
      )

      const res = await listRequest(app, 'tasks')
      expect(res.status).toBe(403)
    })

    it('returns 403 for user without write permission on create', async () => {
      const app = createAuthenticatedApp(
        {
          types: {
            tasks: {
              permissions: { read: 'user', write: 'admin' },
            },
          },
        },
        { id: 'user-1', role: 'user' }
      )

      const res = await createRequest(app, 'tasks', { title: 'New Task' })
      expect(res.status).toBe(403)
    })

    it('returns 403 for user without write permission on update', async () => {
      const app = createAuthenticatedApp(
        {
          types: {
            tasks: {
              permissions: { read: 'user', write: 'admin' },
            },
          },
        },
        { id: 'user-1', role: 'user' }
      )

      const res = await updateRequest(app, 'tasks', 'task-1', { title: 'Updated' })
      expect(res.status).toBe(403)
    })

    it('returns 403 for user without write permission on delete', async () => {
      const app = createAuthenticatedApp(
        {
          types: {
            tasks: {
              permissions: { read: 'user', write: 'admin' },
            },
          },
        },
        { id: 'user-1', role: 'user' }
      )

      const res = await deleteRequest(app, 'tasks', 'task-1')
      expect(res.status).toBe(403)
    })
  })

  describe('Returns 403 for unauthorized', () => {
    it('returns 403 error body with message', async () => {
      const app = createAuthenticatedApp(
        {
          types: {
            tasks: {
              permissions: { read: 'admin', write: 'admin' },
            },
          },
        },
        { id: 'user-1', role: 'user' }
      )

      const res = await listRequest(app, 'tasks')
      expect(res.status).toBe(403)

      const body = (await res.json()) as ErrorResponse
      expect(body.error).toBeDefined()
      expect(body.error.toLowerCase()).toMatch(/permission|forbidden|access/)
    })

    it('returns 403 for specific permission requirements', async () => {
      const app = createAuthenticatedApp(
        {
          types: {
            tasks: {
              permissions: { read: ['tasks:read'], write: ['tasks:write'] },
            },
          },
        },
        { id: 'user-1', role: 'user', permissions: [] }
      )

      const res = await listRequest(app, 'tasks')
      expect(res.status).toBe(403)
    })

    it('allows access with specific permission', async () => {
      const app = createAuthenticatedApp(
        {
          types: {
            tasks: {
              permissions: { read: ['tasks:read'], write: ['tasks:write'] },
            },
          },
        },
        { id: 'user-1', role: 'user', permissions: ['tasks:read'] }
      )

      const res = await listRequest(app, 'tasks')
      expect(res.status).toBe(200)
    })
  })

  describe('Authentication required', () => {
    it('returns 401 without authentication', async () => {
      const app = createTestApp({
        types: {
          tasks: {},
        },
      })

      const res = await listRequest(app, 'tasks')
      expect(res.status).toBe(401)
    })

    it('returns 401 error message', async () => {
      const app = createTestApp({
        types: {
          tasks: {},
        },
      })

      const res = await listRequest(app, 'tasks')
      const body = (await res.json()) as ErrorResponse
      expect(body.error).toBeDefined()
    })

    it('returns WWW-Authenticate header on 401', async () => {
      const app = createTestApp({
        types: {
          tasks: {},
        },
      })

      const res = await listRequest(app, 'tasks')
      expect(res.status).toBe(401)
      expect(res.headers.get('WWW-Authenticate')).toContain('Bearer')
    })
  })
})

// ============================================================================
// 7. Hooks Tests
// ============================================================================

describe('Resources Middleware - Hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.query.tasks.findFirst.mockResolvedValue({ id: '1', title: 'Task' })
    mockDb.insert.mockResolvedValue({ id: '1', title: 'Task' })
    mockDb.update.mockResolvedValue({ id: '1', title: 'Updated Task' })
    mockDb.delete.mockResolvedValue({ id: '1' })
  })

  describe('beforeCreate/afterCreate hooks called', () => {
    it('calls beforeCreate hook before inserting', async () => {
      const beforeCreate = vi.fn().mockImplementation((data) => data)

      const app = createAuthenticatedApp({
        types: {
          tasks: {
            hooks: { beforeCreate },
          },
        },
      })

      await createRequest(app, 'tasks', { title: 'New Task' })
      expect(beforeCreate).toHaveBeenCalled()
    })

    it('beforeCreate receives data and context', async () => {
      let receivedData: unknown
      let receivedContext: Context | null = null

      const beforeCreate = vi.fn().mockImplementation((data, c) => {
        receivedData = data
        receivedContext = c
        return data
      })

      const app = createAuthenticatedApp({
        types: {
          tasks: {
            hooks: { beforeCreate },
          },
        },
      })

      await createRequest(app, 'tasks', { title: 'New Task' })

      expect(receivedData).toEqual(expect.objectContaining({ title: 'New Task' }))
      expect(receivedContext).not.toBeNull()
    })

    it('beforeCreate can modify data', async () => {
      const beforeCreate = vi.fn().mockImplementation((data) => ({
        ...data,
        createdBy: 'hook',
      }))

      const app = createAuthenticatedApp({
        types: {
          tasks: {
            hooks: { beforeCreate },
          },
        },
      })

      await createRequest(app, 'tasks', { title: 'New Task' })

      expect(mockDb.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'New Task',
          createdBy: 'hook',
        })
      )
    })

    it('calls afterCreate hook after inserting', async () => {
      const afterCreate = vi.fn()

      const app = createAuthenticatedApp({
        types: {
          tasks: {
            hooks: { afterCreate },
          },
        },
      })

      await createRequest(app, 'tasks', { title: 'New Task' })
      expect(afterCreate).toHaveBeenCalled()
    })

    it('afterCreate receives created resource and context', async () => {
      let receivedResource: unknown
      let receivedContext: Context | null = null

      const afterCreate = vi.fn().mockImplementation((resource, c) => {
        receivedResource = resource
        receivedContext = c
      })

      const app = createAuthenticatedApp({
        types: {
          tasks: {
            hooks: { afterCreate },
          },
        },
      })

      await createRequest(app, 'tasks', { title: 'New Task' })

      expect(receivedResource).toEqual(expect.objectContaining({ id: '1' }))
      expect(receivedContext).not.toBeNull()
    })

    it('calls beforeCreate before afterCreate', async () => {
      const callOrder: string[] = []

      const beforeCreate = vi.fn().mockImplementation((data) => {
        callOrder.push('before')
        return data
      })
      const afterCreate = vi.fn().mockImplementation(() => {
        callOrder.push('after')
      })

      const app = createAuthenticatedApp({
        types: {
          tasks: {
            hooks: { beforeCreate, afterCreate },
          },
        },
      })

      await createRequest(app, 'tasks', { title: 'New Task' })

      expect(callOrder).toEqual(['before', 'after'])
    })
  })

  describe('beforeUpdate/afterUpdate hooks called', () => {
    it('calls beforeUpdate hook before updating', async () => {
      const beforeUpdate = vi.fn().mockImplementation((data) => data)

      const app = createAuthenticatedApp({
        types: {
          tasks: {
            hooks: { beforeUpdate },
          },
        },
      })

      await updateRequest(app, 'tasks', 'task-1', { title: 'Updated' })
      expect(beforeUpdate).toHaveBeenCalled()
    })

    it('beforeUpdate receives data and context', async () => {
      let receivedData: unknown
      let receivedContext: Context | null = null

      const beforeUpdate = vi.fn().mockImplementation((data, c) => {
        receivedData = data
        receivedContext = c
        return data
      })

      const app = createAuthenticatedApp({
        types: {
          tasks: {
            hooks: { beforeUpdate },
          },
        },
      })

      await updateRequest(app, 'tasks', 'task-1', { title: 'Updated' })

      expect(receivedData).toEqual(expect.objectContaining({ title: 'Updated' }))
      expect(receivedContext).not.toBeNull()
    })

    it('beforeUpdate can modify data', async () => {
      const beforeUpdate = vi.fn().mockImplementation((data) => ({
        ...data,
        updatedBy: 'hook',
      }))

      const app = createAuthenticatedApp({
        types: {
          tasks: {
            hooks: { beforeUpdate },
          },
        },
      })

      await updateRequest(app, 'tasks', 'task-1', { title: 'Updated' })

      expect(mockDb.update).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Updated',
          updatedBy: 'hook',
        })
      )
    })

    it('calls afterUpdate hook after updating', async () => {
      const afterUpdate = vi.fn()

      const app = createAuthenticatedApp({
        types: {
          tasks: {
            hooks: { afterUpdate },
          },
        },
      })

      await updateRequest(app, 'tasks', 'task-1', { title: 'Updated' })
      expect(afterUpdate).toHaveBeenCalled()
    })

    it('afterUpdate receives updated resource and context', async () => {
      let receivedResource: unknown
      let receivedContext: Context | null = null

      const afterUpdate = vi.fn().mockImplementation((resource, c) => {
        receivedResource = resource
        receivedContext = c
      })

      const app = createAuthenticatedApp({
        types: {
          tasks: {
            hooks: { afterUpdate },
          },
        },
      })

      await updateRequest(app, 'tasks', 'task-1', { title: 'Updated' })

      expect(receivedResource).toEqual(expect.objectContaining({ id: '1' }))
      expect(receivedContext).not.toBeNull()
    })
  })

  describe('beforeDelete/afterDelete hooks called', () => {
    it('calls beforeDelete hook before deleting', async () => {
      const beforeDelete = vi.fn()

      const app = createAuthenticatedApp({
        types: {
          tasks: {
            hooks: { beforeDelete },
          },
        },
      })

      await deleteRequest(app, 'tasks', 'task-1')
      expect(beforeDelete).toHaveBeenCalled()
    })

    it('beforeDelete receives resource and context', async () => {
      let receivedResource: unknown
      let receivedContext: Context | null = null

      const beforeDelete = vi.fn().mockImplementation((resource, c) => {
        receivedResource = resource
        receivedContext = c
      })

      const app = createAuthenticatedApp({
        types: {
          tasks: {
            hooks: { beforeDelete },
          },
        },
      })

      await deleteRequest(app, 'tasks', 'task-1')

      expect(receivedResource).toEqual(expect.objectContaining({ id: '1' }))
      expect(receivedContext).not.toBeNull()
    })

    it('beforeDelete can prevent deletion by throwing', async () => {
      const beforeDelete = vi.fn().mockImplementation(() => {
        throw new Error('Cannot delete this resource')
      })

      const app = createAuthenticatedApp({
        types: {
          tasks: {
            hooks: { beforeDelete },
          },
        },
      })

      const res = await deleteRequest(app, 'tasks', 'task-1')
      expect(res.status).toBe(400)
      expect(mockDb.delete).not.toHaveBeenCalled()
    })

    it('calls afterDelete hook after deleting', async () => {
      const afterDelete = vi.fn()

      const app = createAuthenticatedApp({
        types: {
          tasks: {
            hooks: { afterDelete },
          },
        },
      })

      await deleteRequest(app, 'tasks', 'task-1')
      expect(afterDelete).toHaveBeenCalled()
    })

    it('afterDelete receives deleted resource and context', async () => {
      let receivedResource: unknown
      let receivedContext: Context | null = null

      const afterDelete = vi.fn().mockImplementation((resource, c) => {
        receivedResource = resource
        receivedContext = c
      })

      const app = createAuthenticatedApp({
        types: {
          tasks: {
            hooks: { afterDelete },
          },
        },
      })

      await deleteRequest(app, 'tasks', 'task-1')

      expect(receivedResource).toEqual(expect.objectContaining({ id: '1' }))
      expect(receivedContext).not.toBeNull()
    })
  })

  describe('Hook error handling', () => {
    it('returns 400 when beforeCreate throws', async () => {
      const beforeCreate = vi.fn().mockImplementation(() => {
        throw new Error('Validation failed')
      })

      const app = createAuthenticatedApp({
        types: {
          tasks: {
            hooks: { beforeCreate },
          },
        },
      })

      const res = await createRequest(app, 'tasks', { title: 'New Task' })
      expect(res.status).toBe(400)
    })

    it('returns 400 when beforeUpdate throws', async () => {
      const beforeUpdate = vi.fn().mockImplementation(() => {
        throw new Error('Validation failed')
      })

      const app = createAuthenticatedApp({
        types: {
          tasks: {
            hooks: { beforeUpdate },
          },
        },
      })

      const res = await updateRequest(app, 'tasks', 'task-1', { title: 'Updated' })
      expect(res.status).toBe(400)
    })

    it('does not leak error details in production', async () => {
      const beforeCreate = vi.fn().mockImplementation(() => {
        throw new Error('Sensitive error details')
      })

      const app = createAuthenticatedApp({
        types: {
          tasks: {
            hooks: { beforeCreate },
          },
        },
      })

      const res = await createRequest(app, 'tasks', { title: 'New Task' })
      const body = (await res.json()) as ErrorResponse
      expect(body.error).not.toContain('Sensitive')
    })
  })
})

// ============================================================================
// 8. Edge Cases and Error Handling
// ============================================================================

describe('Resources Middleware - Edge Cases', () => {
  let app: Hono

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.query.tasks.findMany.mockResolvedValue([])
    mockDb.query.tasks.findFirst.mockResolvedValue({ id: '1', title: 'Task' })

    app = createAuthenticatedApp({
      types: {
        tasks: {},
      },
    })
  })

  describe('Input validation', () => {
    it('handles very long id strings', async () => {
      const longId = 'a'.repeat(10000)
      const res = await getRequest(app, 'tasks', longId)
      expect([200, 400, 404]).toContain(res.status)
    })

    it('handles special characters in id', async () => {
      const res = await getRequest(app, 'tasks', '../../../etc/passwd')
      expect(res.status).toBe(404)
    })

    it('handles non-numeric limit gracefully', async () => {
      const res = await app.request('/api/tasks?limit=abc', { method: 'GET' })
      expect([200, 400]).toContain(res.status)
    }
    )

    it('handles non-numeric offset gracefully', async () => {
      const res = await app.request('/api/tasks?offset=xyz', { method: 'GET' })
      expect([200, 400]).toContain(res.status)
    })
  })

  describe('Database errors', () => {
    it('handles database connection errors on list', async () => {
      mockDb.query.tasks.findMany.mockRejectedValue(new Error('Database connection failed'))

      const res = await listRequest(app, 'tasks')
      expect(res.status).toBe(500)
    })

    it('handles database connection errors on get', async () => {
      mockDb.query.tasks.findFirst.mockRejectedValue(new Error('Database connection failed'))

      const res = await getRequest(app, 'tasks', 'task-1')
      expect(res.status).toBe(500)
    })

    it('handles database connection errors on create', async () => {
      mockDb.insert.mockRejectedValue(new Error('Database connection failed'))

      const res = await createRequest(app, 'tasks', { title: 'New Task' })
      expect(res.status).toBe(500)
    })

    it('returns generic error message for database errors', async () => {
      mockDb.query.tasks.findMany.mockRejectedValue(new Error('Sensitive DB error'))

      const res = await listRequest(app, 'tasks')
      expect(res.status).toBe(500)

      const body = (await res.json()) as ErrorResponse
      expect(body.error).not.toContain('Sensitive')
    })
  })

  describe('Concurrent requests', () => {
    it('handles concurrent list requests', async () => {
      mockDb.query.tasks.findMany.mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return [{ id: '1', title: 'Task' }]
      })

      const requests = Array.from({ length: 5 }, () => listRequest(app, 'tasks'))

      const responses = await Promise.all(requests)
      responses.forEach((res) => {
        expect(res.status).toBe(200)
      })
    })

    it('handles concurrent create requests', async () => {
      let counter = 0
      mockDb.insert.mockImplementation(async (data) => {
        counter++
        await new Promise((resolve) => setTimeout(resolve, 10))
        return { id: `task-${counter}`, ...data }
      })

      const requests = Array.from({ length: 5 }, (_, i) =>
        createRequest(app, 'tasks', { title: `Task ${i}` })
      )

      const responses = await Promise.all(requests)
      responses.forEach((res) => {
        expect(res.status).toBe(201)
      })
    })
  })
})

// ============================================================================
// 9. Configuration Tests
// ============================================================================

describe('Resources Middleware - Configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.query.tasks.findMany.mockResolvedValue([])
    mockDb.query.projects.findMany.mockResolvedValue([])
  })

  describe('Types configuration', () => {
    it('only allows configured types', async () => {
      const app = createAuthenticatedApp({
        types: {
          tasks: {},
        },
      })

      const tasksRes = await listRequest(app, 'tasks')
      expect(tasksRes.status).toBe(200)

      const projectsRes = await listRequest(app, 'projects')
      expect(projectsRes.status).toBe(404)
    })

    it('supports multiple configured types', async () => {
      const app = createAuthenticatedApp({
        types: {
          tasks: {},
          projects: {},
          notes: {},
        },
      })

      const tasksRes = await listRequest(app, 'tasks')
      const projectsRes = await listRequest(app, 'projects')

      expect(tasksRes.status).toBe(200)
      expect(projectsRes.status).toBe(200)
    })

    it('supports empty types configuration', async () => {
      const app = createAuthenticatedApp({
        types: {},
      })

      const res = await listRequest(app, 'tasks')
      expect(res.status).toBe(404)
    })
  })

  describe('Default configuration', () => {
    it('works with no configuration', async () => {
      const app = createAuthenticatedApp()

      // With no config, all types should 404
      const res = await listRequest(app, 'tasks')
      expect(res.status).toBe(404)
    })
  })
})
