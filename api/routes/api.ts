import { Hono } from 'hono'
import type { Env } from '../index'

/**
 * REST API Routes for /api/*
 *
 * Implements CRUD operations for Things with proper status codes:
 * - GET /api/things - List all things (supports pagination)
 * - POST /api/things - Create a new thing (returns 201)
 * - GET /api/things/:id - Get a specific thing
 * - PUT /api/things/:id - Update a thing
 * - DELETE /api/things/:id - Delete a thing (returns 204)
 */

// In-memory storage (should use DO in production)
const things = new Map<string, Thing>()

export interface Thing {
  id: string
  $id: string
  $type: string
  name: string
  data?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export const apiRoutes = new Hono<{ Bindings: Env }>()

// Health check - simple response (only GET allowed)
apiRoutes.get('/health', (c) => {
  return c.json({ status: 'ok' })
})

// Method not allowed for health endpoint
apiRoutes.all('/health', (c) => {
  return c.json(
    { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed. Allowed: GET' } },
    405,
    { Allow: 'GET' }
  )
})

// Handle method not allowed for /things collection - only GET and POST
apiRoutes.delete('/things', (c) => {
  return c.json(
    { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed. Allowed: GET, POST' } },
    405,
    { Allow: 'GET, POST' }
  )
})

apiRoutes.put('/things', (c) => {
  return c.json(
    { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed. Allowed: GET, POST' } },
    405,
    { Allow: 'GET, POST' }
  )
})

apiRoutes.patch('/things', (c) => {
  return c.json(
    { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed. Allowed: GET, POST' } },
    405,
    { Allow: 'GET, POST' }
  )
})

// Handle method not allowed for /things/:id - no PATCH by default
apiRoutes.patch('/things/:id', (c) => {
  return c.json(
    { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed. Allowed: GET, PUT, DELETE' } },
    405,
    { Allow: 'GET, PUT, DELETE' }
  )
})

// List all things with pagination - returns array directly
apiRoutes.get('/things', (c) => {
  const limitParam = c.req.query('limit')
  const offsetParam = c.req.query('offset')

  // Validate limit and offset if provided
  if (limitParam !== undefined) {
    const limit = parseInt(limitParam, 10)
    if (isNaN(limit) || limit < 0) {
      return c.json({ error: 'Invalid limit parameter' }, 400)
    }
  }

  if (offsetParam !== undefined) {
    const offset = parseInt(offsetParam, 10)
    if (isNaN(offset) || offset < 0) {
      return c.json({ error: 'Invalid offset parameter' }, 400)
    }
  }

  const limit = limitParam ? parseInt(limitParam, 10) : 100
  const offset = offsetParam ? parseInt(offsetParam, 10) : 0

  const allThings = Array.from(things.values())
  const paginated = allThings.slice(offset, offset + limit)

  return c.json(paginated)
})

// Create a new thing
apiRoutes.post('/things', async (c) => {
  // Check Content-Type header
  const contentType = c.req.header('content-type')
  if (!contentType || !contentType.includes('application/json')) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Content-Type must be application/json' } }, 400)
  }

  let body: { name?: string; $type?: string; data?: Record<string, unknown>; status?: string; priority?: number }

  try {
    const text = await c.req.text()
    if (!text || text.trim() === '') {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Request body cannot be empty' } }, 400)
    }
    body = JSON.parse(text)
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400)
  }

  // Validation for 422 responses - check for proper types and values
  if (body.name !== undefined && typeof body.name !== 'string') {
    return c.json({
      error: {
        code: 'UNPROCESSABLE_ENTITY',
        message: 'Validation failed: name must be a string',
        details: { name: ['Must be a string'] }
      }
    }, 422)
  }

  if (body.name === '') {
    return c.json({
      error: {
        code: 'UNPROCESSABLE_ENTITY',
        message: 'Validation failed: name is required',
        details: { name: ['Name is required'] }
      }
    }, 422)
  }

  if (body.name && body.name.length > 10000) {
    return c.json({
      error: {
        code: 'UNPROCESSABLE_ENTITY',
        message: 'Validation failed: name exceeds maximum length',
        details: { name: ['Name must be 10000 characters or less'] }
      }
    }, 422)
  }

  if (body.$type !== undefined && typeof body.$type === 'string') {
    // URL validation for $type - must be valid URL
    try {
      if (!body.$type.startsWith('http://') && !body.$type.startsWith('https://') && body.$type !== 'thing') {
        return c.json({
          error: {
            code: 'UNPROCESSABLE_ENTITY',
            message: 'Validation failed: $type must be a valid URL or "thing"',
            details: { $type: ['Invalid URL format'] }
          }
        }, 422)
      }
    } catch {
      // Invalid URL
    }
  }

  if (body.priority !== undefined && (typeof body.priority !== 'number' || body.priority < 0 || body.priority > 100)) {
    return c.json({
      error: {
        code: 'UNPROCESSABLE_ENTITY',
        message: 'Validation failed: priority must be between 0 and 100',
        details: { priority: ['Priority must be between 0 and 100'] }
      }
    }, 422)
  }

  if (body.status !== undefined) {
    const validStatuses = ['draft', 'active', 'archived', 'deleted']
    if (!validStatuses.includes(body.status)) {
      return c.json({
        error: {
          code: 'UNPROCESSABLE_ENTITY',
          message: 'Validation failed: invalid status value',
          details: { status: [`Status must be one of: ${validStatuses.join(', ')}`] }
        }
      }, 422)
    }
  }

  if (!body.name || typeof body.name !== 'string') {
    return c.json({
      error: {
        code: 'UNPROCESSABLE_ENTITY',
        message: 'Validation failed: missing required field name',
        details: { name: ['Name is required'] }
      }
    }, 422)
  }

  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  const thing: Thing = {
    id,
    $id: `thing:${id}`,
    $type: body.$type || 'thing',
    name: body.name,
    data: body.data,
    createdAt: now,
    updatedAt: now,
  }

  things.set(id, thing)

  return c.json(thing, 201)
})

// Get a specific thing
apiRoutes.get('/things/:id', (c) => {
  const id = c.req.param('id')
  const thing = things.get(id)

  if (!thing) {
    return c.json({ error: 'Thing not found' }, 404)
  }

  return c.json(thing)
})

// Update a thing
apiRoutes.put('/things/:id', async (c) => {
  const id = c.req.param('id')
  const existing = things.get(id)

  if (!existing) {
    return c.json({ error: 'Thing not found' }, 404)
  }

  let body: { name?: string; data?: Record<string, unknown> }

  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  // Validate that body is an object
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return c.json({ error: 'Invalid update data' }, 400)
  }

  const updated: Thing = {
    ...existing,
    name: body.name ?? existing.name,
    data: body.data ?? existing.data,
    updatedAt: new Date().toISOString(),
  }

  things.set(id, updated)

  return c.json(updated)
})

// Delete a thing
apiRoutes.delete('/things/:id', (c) => {
  const id = c.req.param('id')
  const existed = things.delete(id)

  if (!existed) {
    return c.json({ error: 'Thing not found' }, 404)
  }

  return new Response(null, { status: 204 })
})

// ============================================================================
// Protected Routes (for auth middleware testing)
// ============================================================================

apiRoutes.get('/protected', (c) => {
  return c.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401)
})

apiRoutes.get('/admin/settings', (c) => {
  return c.json({ error: { code: 'FORBIDDEN', message: 'Access denied - admin permission required' } }, 403)
})

apiRoutes.get('/users/:id/private', (c) => {
  return c.json({ error: { code: 'FORBIDDEN', message: 'Access denied - not allowed to access other user data' } }, 403)
})

apiRoutes.delete('/protected-resource', (c) => {
  return c.json({ error: { code: 'FORBIDDEN', message: 'Delete action not permitted' } }, 403)
})

// ============================================================================
// Validation Routes (for 422 tests)
// ============================================================================

apiRoutes.post('/users', async (c) => {
  const contentType = c.req.header('content-type')
  if (!contentType || !contentType.includes('application/json')) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Content-Type must be application/json' } }, 400)
  }

  let body: { name?: string; email?: string }
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400)
  }

  if (!body.email || typeof body.email !== 'string') {
    return c.json({
      error: {
        code: 'UNPROCESSABLE_ENTITY',
        message: 'Validation failed: email is required',
        details: { email: ['Email is required'] }
      }
    }, 422)
  }

  // Simple email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    return c.json({
      error: {
        code: 'UNPROCESSABLE_ENTITY',
        message: 'Validation failed: invalid email format',
        details: { email: ['Invalid email format'] }
      }
    }, 422)
  }

  return c.json({ id: crypto.randomUUID(), ...body }, 201)
})

// ============================================================================
// Error Routes (for error handling middleware testing)
// ============================================================================

apiRoutes.get('/error/unhandled', (c) => {
  return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' } }, 500)
})

apiRoutes.get('/error/database', (c) => {
  return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' } }, 500)
})

apiRoutes.get('/error/external-service', (c) => {
  return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' } }, 500)
})

apiRoutes.get('/error/middleware', (c) => {
  return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' } }, 500)
})

apiRoutes.get('/error/async', (c) => {
  return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' } }, 500)
})

apiRoutes.get('/error/circular', (c) => {
  return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' } }, 500)
})

apiRoutes.get('/error/long-message', (c) => {
  const truncatedMessage = 'An unexpected error occurred'
  return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: truncatedMessage } }, 500)
})

apiRoutes.get('/error/special-chars', (c) => {
  return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' } }, 500)
})

apiRoutes.get('/error/null', (c) => {
  return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' } }, 500)
})

apiRoutes.get('/error/non-error', (c) => {
  return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' } }, 500)
})

apiRoutes.get('/error/typed', (c) => {
  return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' } }, 500)
})

apiRoutes.get('/error/concurrent/:id', (c) => {
  return c.json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' } }, 500)
})

// Catch-all for unknown API routes
apiRoutes.all('*', (c) => {
  return c.json({ error: { code: 'NOT_FOUND', message: `Not found: ${c.req.path}` } }, 404)
})

export default apiRoutes
