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

// Health check - simple response
apiRoutes.get('/health', (c) => {
  return c.json({ status: 'ok' })
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
    return c.json({ error: 'Content-Type must be application/json' }, 400)
  }

  let body: { name?: string; $type?: string; data?: Record<string, unknown> }

  try {
    const text = await c.req.text()
    if (!text || text.trim() === '') {
      return c.json({ error: 'Request body cannot be empty' }, 400)
    }
    body = JSON.parse(text)
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  if (!body.name || typeof body.name !== 'string') {
    return c.json({ error: 'Missing required field: name' }, 400)
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

// Catch-all for unknown API routes
apiRoutes.all('*', (c) => {
  return c.json({ error: 'Not found', path: c.req.path }, 404)
})

export default apiRoutes
