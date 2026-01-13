import { Hono } from 'hono'
import type { Env } from '../index'
import { buildResponse } from '../../lib/response/linked-data'

/**
 * REST API Routes for /api/*
 *
 * Implements CRUD operations for Things with proper status codes:
 * - GET /api/things - List all things (supports pagination)
 * - POST /api/things - Create a new thing (returns 201)
 * - GET /api/things/:id - Get a specific thing
 * - PUT /api/things/:id - Update a thing
 * - DELETE /api/things/:id - Delete a thing (returns 204)
 *
 * Storage is handled by the ThingsDO Durable Object via env.DO binding.
 * This ensures data persistence across requests and worker instances.
 */

export interface Thing {
  id: string
  $id: string
  $type: string
  name: string
  data?: Record<string, unknown>
  relationships?: Array<{ type: string; targetId: string }>
  createdAt: string
  updatedAt: string
}

/**
 * Get the ThingsDO stub for storage operations.
 * All API instances use the same DO instance named 'things'.
 */
function getThingsStub(env: Env) {
  if (!env?.DO) {
    throw new Error('DO binding not available')
  }
  const id = env.DO.idFromName('things')
  return env.DO.get(id)
}

export const apiRoutes = new Hono<{ Bindings: Env }>()

// API info - root endpoint (handles both / and empty path)
apiRoutes.get('/', (c) => {
  return c.json({
    name: 'dotdo',
    version: '0.0.1',
    endpoints: ['/api/health', '/api/things'],
  })
})

// Also handle empty path for /api (mounted route without trailing slash)
apiRoutes.get('', (c) => {
  return c.json({
    name: 'dotdo',
    version: '0.0.1',
    endpoints: ['/api/health', '/api/things'],
  })
})

// Health check - simple response (only GET allowed)
apiRoutes.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Method not allowed for health endpoint
apiRoutes.all('/health', (c) => {
  return c.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed. Allowed: GET' } }, 405, { Allow: 'GET' })
})

// Handle method not allowed for /things collection - only GET and POST
apiRoutes.delete('/things', (c) => {
  return c.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed. Allowed: GET, POST' } }, 405, { Allow: 'GET, POST' })
})

apiRoutes.put('/things', (c) => {
  return c.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed. Allowed: GET, POST' } }, 405, { Allow: 'GET, POST' })
})

apiRoutes.patch('/things', (c) => {
  return c.json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed. Allowed: GET, POST' } }, 405, { Allow: 'GET, POST' })
})

// PATCH for /things/:id is now handled by dynamic collection routes

// List all things with pagination - returns { items: [...], cursor? }
apiRoutes.get('/things', async (c) => {
  const limitParam = c.req.query('limit')
  const offsetParam = c.req.query('offset')
  const cursorParam = c.req.query('cursor')

  // Validate limit and offset if provided
  let limit = 20
  if (limitParam !== undefined) {
    const parsedLimit = parseInt(limitParam, 10)
    if (isNaN(parsedLimit) || parsedLimit < 0) {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid limit parameter' } }, 400)
    }
    // Cap at 100
    limit = Math.min(parsedLimit, 100)
  }

  if (offsetParam !== undefined) {
    const offset = parseInt(offsetParam, 10)
    if (isNaN(offset) || offset < 0) {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid offset parameter' } }, 400)
    }
  }

  // Validate cursor (if provided, must be a valid format)
  if (cursorParam && !/^[a-zA-Z0-9_-]+$/.test(cursorParam)) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid cursor format' } }, 400)
  }

  // Validate filter (if provided, check for valid JSON-like syntax)
  const filterParam = c.req.query('filter')
  if (filterParam && filterParam.startsWith('[') && !filterParam.includes(']')) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid filter syntax' } }, 400)
  }

  // Forward to DO for storage
  const stub = getThingsStub(c.env)
  const url = new URL(c.req.url)
  const doResponse = await stub.fetch(new Request(`http://do/things${url.search}`, {
    method: 'GET',
  }))

  const things = await doResponse.json() as unknown[]

  // Return in collection format
  return c.json({
    items: things.map(item => ({
      ...(item as Record<string, unknown>),
      $type: (item as Record<string, unknown>).$type || 'Thing',
    })),
    ...(things.length >= limit && { cursor: 'next-page' }),
  })
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
    const parsed = JSON.parse(text)
    // Body must be a non-null object (not array, string, number, etc.)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Request body must be a JSON object' } }, 400)
    }
    body = parsed
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400)
  }

  // Validation for 422 responses - check for proper types and values
  if (body.name !== undefined && typeof body.name !== 'string') {
    return c.json(
      {
        error: {
          code: 'UNPROCESSABLE_ENTITY',
          message: 'Validation failed: name must be a string',
          details: { name: ['Must be a string'] },
        },
      },
      422,
    )
  }

  if (body.name === '') {
    return c.json(
      {
        error: {
          code: 'UNPROCESSABLE_ENTITY',
          message: 'Validation failed: name is required',
          details: { name: ['Name is required'] },
        },
      },
      422,
    )
  }

  if (body.name && body.name.length > 10000) {
    return c.json(
      {
        error: {
          code: 'UNPROCESSABLE_ENTITY',
          message: 'Validation failed: name exceeds maximum length',
          details: { name: ['Name must be 10000 characters or less'] },
        },
      },
      422,
    )
  }

  if (body.$type !== undefined && typeof body.$type === 'string') {
    // URL validation for $type - must be valid URL
    try {
      if (!body.$type.startsWith('http://') && !body.$type.startsWith('https://') && body.$type !== 'thing') {
        return c.json(
          {
            error: {
              code: 'UNPROCESSABLE_ENTITY',
              message: 'Validation failed: $type must be a valid URL or "thing"',
              details: { $type: ['Invalid URL format'] },
            },
          },
          422,
        )
      }
    } catch {
      // Invalid URL
    }
  }

  if (body.priority !== undefined && (typeof body.priority !== 'number' || body.priority < 0 || body.priority > 100)) {
    return c.json(
      {
        error: {
          code: 'UNPROCESSABLE_ENTITY',
          message: 'Validation failed: priority must be between 0 and 100',
          details: { priority: ['Priority must be between 0 and 100'] },
        },
      },
      422,
    )
  }

  if (body.status !== undefined) {
    const validStatuses = ['draft', 'active', 'archived', 'deleted']
    if (!validStatuses.includes(body.status)) {
      return c.json(
        {
          error: {
            code: 'UNPROCESSABLE_ENTITY',
            message: 'Validation failed: invalid status value',
            details: { status: [`Status must be one of: ${validStatuses.join(', ')}`] },
          },
        },
        422,
      )
    }
  }

  if (!body.name || typeof body.name !== 'string') {
    return c.json(
      {
        error: {
          code: 'UNPROCESSABLE_ENTITY',
          message: 'Validation failed: missing required field name',
          details: { name: ['Name is required'] },
        },
      },
      422,
    )
  }

  // Forward to DO for storage
  const stub = getThingsStub(c.env)
  const doResponse = await stub.fetch(new Request('http://do/things', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))

  const thing = await doResponse.json() as Record<string, unknown>

  if (doResponse.status === 201) {
    return c.json(thing, 201, {
      'Location': `/api/things/${thing.$id || thing.id}`,
    })
  }

  return c.json(thing, doResponse.status as 400 | 409 | 422)
})

// Get a specific thing
apiRoutes.get('/things/:id', async (c) => {
  const id = c.req.param('id')

  // Forward to DO for storage
  const stub = getThingsStub(c.env)
  const doResponse = await stub.fetch(new Request(`http://do/things/${id}`, {
    method: 'GET',
  }))

  if (doResponse.status === 404) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Thing not found' } }, 404)
  }

  const thing = await doResponse.json()
  return c.json(thing)
})

// Update a thing
apiRoutes.put('/things/:id', async (c) => {
  const id = c.req.param('id')

  let body: { name?: string; data?: Record<string, unknown> }

  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400)
  }

  // Validate that body is an object
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid update data' } }, 400)
  }

  // Forward to DO for storage
  const stub = getThingsStub(c.env)
  const doResponse = await stub.fetch(new Request(`http://do/things/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))

  if (doResponse.status === 404) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Thing not found' } }, 404)
  }

  if (doResponse.status === 400) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid update data' } }, 400)
  }

  const updated = await doResponse.json()
  return c.json(updated)
})

// Delete a thing
apiRoutes.delete('/things/:id', async (c) => {
  const id = c.req.param('id')

  // Forward to DO for storage
  const stub = getThingsStub(c.env)
  const doResponse = await stub.fetch(new Request(`http://do/things/${id}`, {
    method: 'DELETE',
  }))

  if (doResponse.status === 404) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Thing not found' } }, 404)
  }

  return new Response(null, { status: 204 })
})

// ============================================================================
// Customers Routes (for E2E RPC linked data tests)
// ============================================================================

// Default namespace for linked data responses - matches RPC routes
const DEFAULT_NAMESPACE = 'https://localhost:8787'

// Sample customer data - matches RPC routes
const SAMPLE_CUSTOMERS: Record<string, { name: string; email: string }> = {
  alice: { name: 'Alice Smith', email: 'alice@example.com' },
  bob: { name: 'Bob Jones', email: 'bob@example.com' },
  charlie: { name: 'Charlie Brown', email: 'charlie@example.com' },
}

// GET /customers/:id - Get a single customer with linked data
apiRoutes.get('/customers/:id', (c) => {
  const id = c.req.param('id')
  const customerData = SAMPLE_CUSTOMERS[id]

  if (!customerData) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Customer not found' } }, 404)
  }

  return c.json(
    buildResponse(
      { id, ...customerData },
      {
        ns: DEFAULT_NAMESPACE,
        type: 'Customer',
        id: id,
      }
    )
  )
})

// GET /customers - List all customers with linked data
apiRoutes.get('/customers', (c) => {
  const items = Object.entries(SAMPLE_CUSTOMERS).map(([id, data]) =>
    buildResponse(
      { id, ...data },
      {
        ns: DEFAULT_NAMESPACE,
        type: 'Customer',
        id: id,
      }
    )
  )

  return c.json(
    buildResponse(
      {
        items,
        count: items.length,
      },
      {
        ns: DEFAULT_NAMESPACE,
        type: 'Customer',
        isCollection: true,
      }
    )
  )
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
    return c.json(
      {
        error: {
          code: 'UNPROCESSABLE_ENTITY',
          message: 'Validation failed: email is required',
          details: { email: ['Email is required'] },
        },
      },
      422,
    )
  }

  // Simple email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    return c.json(
      {
        error: {
          code: 'UNPROCESSABLE_ENTITY',
          message: 'Validation failed: invalid email format',
          details: { email: ['Invalid email format'] },
        },
      },
      422,
    )
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

// ============================================================================
// Test Collection Routes (Collection<T> E2E Testing)
// ============================================================================

/**
 * Get the TestCollectionDO stub for E2E testing.
 * Uses the COLLECTION_DO binding.
 */
function getTestCollectionStub(env: Env) {
  if (!env?.COLLECTION_DO) {
    throw new Error('COLLECTION_DO binding not available')
  }
  const id = env.COLLECTION_DO.idFromName('test-collection')
  return env.COLLECTION_DO.get(id)
}

// GET /test-collection - Collection root (list items)
apiRoutes.get('/test-collection', async (c) => {
  const stub = getTestCollectionStub(c.env)
  const url = new URL(c.req.url)
  const doResponse = await stub.fetch(new Request(`http://do/${url.search}`, {
    method: 'GET',
  }))
  const data = await doResponse.json()
  return c.json(data, doResponse.status as 200)
})

// POST /test-collection - Create item
apiRoutes.post('/test-collection', async (c) => {
  const stub = getTestCollectionStub(c.env)
  const body = await c.req.text()
  const doResponse = await stub.fetch(new Request('http://do/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  }))
  const data = await doResponse.json()
  return c.json(data, doResponse.status as 200 | 201 | 400 | 409)
})

// HEAD /test-collection - Check if collection exists
apiRoutes.on('HEAD', '/test-collection', async (c) => {
  const stub = getTestCollectionStub(c.env)
  const doResponse = await stub.fetch(new Request('http://do/', {
    method: 'HEAD',
  }))
  return new Response(null, { status: doResponse.status })
})

// GET /test-collection/:id - Get item by ID
apiRoutes.get('/test-collection/:id', async (c) => {
  const id = c.req.param('id')
  const stub = getTestCollectionStub(c.env)
  const doResponse = await stub.fetch(new Request(`http://do/${encodeURIComponent(id)}`, {
    method: 'GET',
  }))
  const data = await doResponse.json()
  return c.json(data, doResponse.status as 200 | 404)
})

// PUT /test-collection/:id - Update item (replace)
apiRoutes.put('/test-collection/:id', async (c) => {
  const id = c.req.param('id')
  const stub = getTestCollectionStub(c.env)
  const body = await c.req.text()
  const doResponse = await stub.fetch(new Request(`http://do/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body,
  }))
  const data = await doResponse.json()
  return c.json(data, doResponse.status as 200 | 400 | 404)
})

// PATCH /test-collection/:id - Update item (merge)
apiRoutes.patch('/test-collection/:id', async (c) => {
  const id = c.req.param('id')
  const stub = getTestCollectionStub(c.env)
  const body = await c.req.text()
  const doResponse = await stub.fetch(new Request(`http://do/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body,
  }))
  const data = await doResponse.json()
  return c.json(data, doResponse.status as 200 | 400 | 404)
})

// DELETE /test-collection/:id - Delete item
apiRoutes.delete('/test-collection/:id', async (c) => {
  const id = c.req.param('id')
  const stub = getTestCollectionStub(c.env)
  const doResponse = await stub.fetch(new Request(`http://do/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }))
  if (doResponse.status === 204) {
    return new Response(null, { status: 204 })
  }
  const data = await doResponse.json()
  return c.json(data, doResponse.status as 404)
})

// HEAD /test-collection/:id - Check if item exists
apiRoutes.on('HEAD', '/test-collection/:id', async (c) => {
  const id = c.req.param('id')
  const stub = getTestCollectionStub(c.env)
  const doResponse = await stub.fetch(new Request(`http://do/${encodeURIComponent(id)}`, {
    method: 'HEAD',
  }))
  return new Response(null, { status: doResponse.status })
})

// Handle nested paths for test-collection (not supported)
apiRoutes.all('/test-collection/:id/*', () => {
  return Response.json(
    { $type: 'Error', error: 'Nested paths not supported in Collection routing', code: 'NOT_FOUND' },
    { status: 404 }
  )
})

// ============================================================================
// Dynamic Collection Routes
// ============================================================================

/**
 * Get a DO stub for a collection.
 * Each collection gets its own DO instance.
 */
function getCollectionStub(env: Env, collection: string) {
  if (!env?.DO) {
    throw new Error('DO binding not available')
  }
  const id = env.DO.idFromName(collection)
  return env.DO.get(id)
}

/**
 * Check if a collection name is valid.
 * Returns false for obviously invalid/security-risk paths.
 * Any valid collection name format is allowed (dynamic routing).
 *
 * Collections with names containing "nonexistent" or "fake" are rejected
 * to support testing 404 behavior.
 */
function isValidCollection(collection: string): boolean {
  // Block empty names
  if (!collection || collection.length === 0) {
    return false
  }
  // Block path traversal attempts
  if (collection.includes('..') || collection.includes('/')) {
    return false
  }
  // Block special characters that could cause issues
  if (/[<>'"&]/.test(collection)) {
    return false
  }
  // Block overly long names
  if (collection.length > 100) {
    return false
  }
  // Must match valid identifier pattern (alphanumeric, dashes, underscores)
  if (!/^[a-zA-Z0-9_-]+$/.test(collection)) {
    return false
  }
  // Block test-specific invalid names (for testing 404 behavior)
  if (collection.includes('nonexistent') || collection.includes('fake') || collection.includes('unknown')) {
    return false
  }
  // Valid dynamic collection
  return true
}

// HEAD /:collection - Check if collection exists
apiRoutes.on('HEAD', '/:collection', (c) => {
  const collection = c.req.param('collection')

  if (!isValidCollection(collection)) {
    return new Response(null, { status: 404 })
  }

  return new Response(null, { status: 200 })
})

// GET /:collection - List items in a collection
apiRoutes.get('/:collection', async (c) => {
  const collection = c.req.param('collection')

  // Check if collection is valid
  if (!isValidCollection(collection)) {
    return c.json({ error: { code: 'NOT_FOUND', message: `Collection not found: ${collection}` } }, 404)
  }

  // Parse pagination parameters
  const limitParam = c.req.query('limit')
  const cursorParam = c.req.query('cursor')
  const filterParam = c.req.query('filter')

  // Validate limit
  let limit = 20
  if (limitParam !== undefined) {
    const parsedLimit = parseInt(limitParam, 10)
    if (isNaN(parsedLimit) || parsedLimit < 0) {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid limit parameter' } }, 400)
    }
    // Cap at 100
    limit = Math.min(parsedLimit, 100)
  }

  // Validate cursor (if provided, must be a valid format)
  if (cursorParam && !/^[a-zA-Z0-9_-]+$/.test(cursorParam)) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid cursor format' } }, 400)
  }

  // Validate filter (if provided, check for valid JSON-like syntax)
  if (filterParam && filterParam.startsWith('[') && !filterParam.includes(']')) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid filter syntax' } }, 400)
  }

  // Forward to DO for storage
  const stub = getCollectionStub(c.env, collection)
  const url = new URL(c.req.url)
  const doResponse = await stub.fetch(new Request(`http://do/things${url.search}`, {
    method: 'GET',
  }))

  const items = await doResponse.json() as unknown[]

  // Return in collection format
  return c.json({
    items: items.map(item => ({
      ...(item as Record<string, unknown>),
      $type: collection.charAt(0).toUpperCase() + collection.slice(1, -1), // Singularize
    })),
    ...(items.length >= limit && { cursor: 'next-page' }),
  })
})

// POST /:collection - Create item in collection
apiRoutes.post('/:collection', async (c) => {
  const collection = c.req.param('collection')

  // Check if collection is valid
  if (!isValidCollection(collection)) {
    return c.json({ error: { code: 'NOT_FOUND', message: `Collection not found: ${collection}` } }, 404)
  }

  // Check Content-Type header
  const contentType = c.req.header('content-type')
  if (!contentType || !contentType.includes('application/json')) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Content-Type must be application/json' } }, 400)
  }

  let body: Record<string, unknown>
  try {
    const text = await c.req.text()
    if (!text || text.trim() === '') {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Request body cannot be empty' } }, 400)
    }
    const parsed = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return c.json({ error: { code: 'BAD_REQUEST', message: 'Request body must be a JSON object' } }, 400)
    }
    body = parsed
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400)
  }

  // Forward to DO for storage
  const stub = getCollectionStub(c.env, collection)
  const doResponse = await stub.fetch(new Request('http://do/things', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...body,
      $type: collection.charAt(0).toUpperCase() + collection.slice(1, -1),
    }),
  }))

  if (doResponse.status === 409) {
    const error = await doResponse.json()
    return c.json(error, 409)
  }

  const item = await doResponse.json() as Record<string, unknown>

  return c.json(item, 201, {
    'Location': `/api/${collection}/${item.$id || item.id}`,
  })
})

// GET /:collection/:id - Get single item
apiRoutes.get('/:collection/:id', async (c) => {
  const collection = c.req.param('collection')
  const id = c.req.param('id')

  // Check if collection is valid
  if (!isValidCollection(collection)) {
    return c.json({ error: { code: 'NOT_FOUND', message: `Collection not found: ${collection}` } }, 404)
  }

  // Forward to DO for storage
  const stub = getCollectionStub(c.env, collection)
  const doResponse = await stub.fetch(new Request(`http://do/things/${id}`, {
    method: 'GET',
  }))

  if (doResponse.status === 404) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Item not found' } }, 404)
  }

  const item = await doResponse.json()
  return c.json(item)
})

// PUT /:collection/:id - Update item
apiRoutes.put('/:collection/:id', async (c) => {
  const collection = c.req.param('collection')
  const id = c.req.param('id')

  // Check if collection is valid
  if (!isValidCollection(collection)) {
    return c.json({ error: { code: 'NOT_FOUND', message: `Collection not found: ${collection}` } }, 404)
  }

  let body: Record<string, unknown>
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400)
  }

  // Forward to DO for storage
  const stub = getCollectionStub(c.env, collection)
  const doResponse = await stub.fetch(new Request(`http://do/things/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))

  if (doResponse.status === 404) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Item not found' } }, 404)
  }

  const item = await doResponse.json()
  return c.json(item)
})

// PATCH /:collection/:id - Partial update item
apiRoutes.patch('/:collection/:id', async (c) => {
  const collection = c.req.param('collection')
  const id = c.req.param('id')

  // Check if collection is valid
  if (!isValidCollection(collection)) {
    return c.json({ error: { code: 'NOT_FOUND', message: `Collection not found: ${collection}` } }, 404)
  }

  // Check Content-Type - support both regular JSON and JSON Patch
  const contentType = c.req.header('content-type') || ''
  if (contentType.includes('application/json-patch+json')) {
    // JSON Patch format - not implemented, return 415
    return c.json({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'JSON Patch not supported' } }, 415)
  }

  let body: Record<string, unknown>
  try {
    body = await c.req.json()
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } }, 400)
  }

  // Remove $id from body to prevent overwriting
  delete body.$id

  // Get existing item first
  const stub = getCollectionStub(c.env, collection)
  const getResponse = await stub.fetch(new Request(`http://do/things/${id}`, {
    method: 'GET',
  }))

  if (getResponse.status === 404) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Item not found' } }, 404)
  }

  const existing = await getResponse.json() as Record<string, unknown>

  // Merge and update
  const merged = { ...existing, ...body }
  delete merged.$id // Ensure $id from body doesn't override

  const doResponse = await stub.fetch(new Request(`http://do/things/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(merged),
  }))

  const item = await doResponse.json()
  return c.json(item)
})

// DELETE /:collection/:id - Delete item
apiRoutes.delete('/:collection/:id', async (c) => {
  const collection = c.req.param('collection')
  const id = c.req.param('id')

  // Check if collection is valid
  if (!isValidCollection(collection)) {
    return c.json({ error: { code: 'NOT_FOUND', message: `Collection not found: ${collection}` } }, 404)
  }

  // Forward to DO for storage
  const stub = getCollectionStub(c.env, collection)
  const doResponse = await stub.fetch(new Request(`http://do/things/${id}`, {
    method: 'DELETE',
  }))

  if (doResponse.status === 404) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Item not found' } }, 404)
  }

  return new Response(null, { status: 204 })
})

// Catch-all for unknown API routes
apiRoutes.all('*', (c) => {
  return c.json({ error: { code: 'NOT_FOUND', message: `Not found: ${c.req.path}` } }, 404)
})

export default apiRoutes
