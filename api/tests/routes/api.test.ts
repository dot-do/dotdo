import { describe, it, expect, beforeEach } from 'vitest'

/**
 * REST API Route Tests
 *
 * These tests verify the /api/* routes for the dotdo worker.
 * They are expected to FAIL until the API routes are implemented.
 *
 * Implementation requirements:
 * - Create routes in worker/src/routes/api.ts (or similar)
 * - Mount routes on the main Hono app
 * - Implement Thing CRUD operations with proper status codes
 */

// Import the actual app
import { app } from '../../index'

// ============================================================================
// Test Types
// ============================================================================

interface Thing {
  id: string
  $id: string
  $type: string
  name: string
  data?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

interface ErrorResponse {
  error: string
  message?: string
}

// ============================================================================
// Helper Functions
// ============================================================================

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
  return app.request(path, options)
}

async function get(path: string): Promise<Response> {
  return request('GET', path)
}

async function post(path: string, body: unknown): Promise<Response> {
  return request('POST', path, body)
}

async function put(path: string, body: unknown): Promise<Response> {
  return request('PUT', path, body)
}

async function del(path: string): Promise<Response> {
  return request('DELETE', path)
}

// ============================================================================
// Health Check Tests
// ============================================================================

describe('GET /api/health', () => {
  it('returns status ok', async () => {
    const res = await get('/api/health')

    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toEqual({ status: 'ok' })
  })

  it('returns JSON content type', async () => {
    const res = await get('/api/health')

    expect(res.headers.get('content-type')).toContain('application/json')
  })
})

// ============================================================================
// GET /api/things - List Things
// ============================================================================

describe('GET /api/things', () => {
  it('returns an array of things', async () => {
    const res = await get('/api/things')

    expect(res.status).toBe(200)

    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })

  it('returns JSON content type', async () => {
    const res = await get('/api/things')

    expect(res.headers.get('content-type')).toContain('application/json')
  })

  it('returns things with required fields', async () => {
    const res = await get('/api/things')
    const body = (await res.json()) as Thing[]

    // If there are any things, verify they have required fields
    if (body.length > 0) {
      const thing = body[0]
      expect(thing).toHaveProperty('id')
      expect(thing).toHaveProperty('$id')
      expect(thing).toHaveProperty('$type')
      expect(thing).toHaveProperty('createdAt')
      expect(thing).toHaveProperty('updatedAt')
    }
  })

  it('supports pagination with limit query param', async () => {
    const res = await get('/api/things?limit=5')

    expect(res.status).toBe(200)

    const body = (await res.json()) as Thing[]
    expect(body.length).toBeLessThanOrEqual(5)
  })

  it('supports pagination with offset query param', async () => {
    const res = await get('/api/things?offset=10&limit=5')

    expect(res.status).toBe(200)
  })
})

// ============================================================================
// POST /api/things - Create Thing
// ============================================================================

describe('POST /api/things', () => {
  it('creates a thing and returns 201', async () => {
    const newThing = {
      name: 'Test Thing',
      $type: 'https://example.com/TestThing',
      data: { foo: 'bar' },
    }

    const res = await post('/api/things', newThing)

    expect(res.status).toBe(201)

    const body = (await res.json()) as Thing
    expect(body.name).toBe('Test Thing')
    expect(body.$type).toBe('https://example.com/TestThing')
    expect(body.data).toEqual({ foo: 'bar' })
  })

  it('returns the created thing with id', async () => {
    const newThing = {
      name: 'Another Thing',
      $type: 'https://example.com/AnotherThing',
    }

    const res = await post('/api/things', newThing)
    const body = (await res.json()) as Thing

    expect(body).toHaveProperty('id')
    expect(body).toHaveProperty('$id')
    expect(typeof body.id).toBe('string')
    expect(body.id.length).toBeGreaterThan(0)
  })

  it('sets createdAt and updatedAt timestamps', async () => {
    const newThing = {
      name: 'Timestamped Thing',
      $type: 'https://example.com/TimestampedThing',
    }

    const res = await post('/api/things', newThing)
    const body = (await res.json()) as Thing

    expect(body).toHaveProperty('createdAt')
    expect(body).toHaveProperty('updatedAt')
    // Timestamps should be valid ISO strings
    expect(() => new Date(body.createdAt)).not.toThrow()
    expect(() => new Date(body.updatedAt)).not.toThrow()
  })

  it('returns 400 for missing required fields', async () => {
    const invalidThing = {
      // Missing name and $type
      data: { foo: 'bar' },
    }

    const res = await post('/api/things', invalidThing)

    expect(res.status).toBe(400)

    const body = (await res.json()) as ErrorResponse
    expect(body).toHaveProperty('error')
  })

  it('returns 400 for invalid JSON body', async () => {
    const res = await app.request('/api/things', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json{',
    })

    expect(res.status).toBe(400)

    const body = (await res.json()) as ErrorResponse
    expect(body).toHaveProperty('error')
  })

  it('returns 400 for empty body', async () => {
    const res = await app.request('/api/things', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })

    expect(res.status).toBe(400)
  })
})

// ============================================================================
// GET /api/things/:id - Get Single Thing
// ============================================================================

describe('GET /api/things/:id', () => {
  it('returns a specific thing by id', async () => {
    // First create a thing
    const created = await post('/api/things', {
      name: 'Specific Thing',
      $type: 'https://example.com/SpecificThing',
    })
    const createdThing = (await created.json()) as Thing

    // Then fetch it
    const res = await get(`/api/things/${createdThing.id}`)

    expect(res.status).toBe(200)

    const body = (await res.json()) as Thing
    expect(body.id).toBe(createdThing.id)
    expect(body.name).toBe('Specific Thing')
  })

  it('returns 404 for non-existent thing', async () => {
    const res = await get('/api/things/non-existent-id-12345')

    expect(res.status).toBe(404)

    const body = (await res.json()) as ErrorResponse
    expect(body).toHaveProperty('error')
  })

  it('returns 404 for invalid id format', async () => {
    const res = await get('/api/things/')

    // Empty id should return 404
    expect(res.status).toBe(404)
  })

  it('includes relationships if present', async () => {
    // Create a thing that might have relationships
    const created = await post('/api/things', {
      name: 'Thing with Relationships',
      $type: 'https://example.com/RelatedThing',
    })
    const createdThing = (await created.json()) as Thing

    const res = await get(`/api/things/${createdThing.id}`)
    const body = await res.json()

    // Should have relationships property (even if empty)
    expect(body).toHaveProperty('relationships')
  })
})

// ============================================================================
// PUT /api/things/:id - Update Thing
// ============================================================================

describe('PUT /api/things/:id', () => {
  it('updates a thing', async () => {
    // First create a thing
    const created = await post('/api/things', {
      name: 'Original Name',
      $type: 'https://example.com/UpdateableThing',
      data: { version: 1 },
    })
    const createdThing = (await created.json()) as Thing

    // Then update it
    const res = await put(`/api/things/${createdThing.id}`, {
      name: 'Updated Name',
      data: { version: 2 },
    })

    expect(res.status).toBe(200)

    const body = (await res.json()) as Thing
    expect(body.name).toBe('Updated Name')
    expect(body.data).toEqual({ version: 2 })
  })

  it('returns the updated thing', async () => {
    const created = await post('/api/things', {
      name: 'Before Update',
      $type: 'https://example.com/Thing',
    })
    const createdThing = (await created.json()) as Thing

    const res = await put(`/api/things/${createdThing.id}`, {
      name: 'After Update',
    })

    const body = (await res.json()) as Thing
    expect(body.id).toBe(createdThing.id)
    expect(body.name).toBe('After Update')
  })

  it('updates the updatedAt timestamp', async () => {
    const created = await post('/api/things', {
      name: 'Timestamp Test',
      $type: 'https://example.com/Thing',
    })
    const createdThing = (await created.json()) as Thing
    const originalUpdatedAt = createdThing.updatedAt

    // Small delay to ensure timestamp changes
    await new Promise((resolve) => setTimeout(resolve, 10))

    const res = await put(`/api/things/${createdThing.id}`, {
      name: 'Updated Timestamp Test',
    })

    const body = (await res.json()) as Thing
    expect(new Date(body.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(originalUpdatedAt).getTime())
  })

  it('returns 404 for non-existent thing', async () => {
    const res = await put('/api/things/non-existent-id-12345', {
      name: 'Should Not Work',
    })

    expect(res.status).toBe(404)

    const body = (await res.json()) as ErrorResponse
    expect(body).toHaveProperty('error')
  })

  it('returns 400 for invalid update data', async () => {
    const created = await post('/api/things', {
      name: 'Valid Thing',
      $type: 'https://example.com/Thing',
    })
    const createdThing = (await created.json()) as Thing

    // Try to update with invalid data (e.g., wrong type)
    const res = await app.request(`/api/things/${createdThing.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json',
    })

    expect(res.status).toBe(400)
  })

  it('preserves fields not included in update', async () => {
    const created = await post('/api/things', {
      name: 'Original',
      $type: 'https://example.com/Thing',
      data: { preserved: true, updated: false },
    })
    const createdThing = (await created.json()) as Thing

    // Update only name, not data
    const res = await put(`/api/things/${createdThing.id}`, {
      name: 'Updated',
    })

    const body = (await res.json()) as Thing
    expect(body.name).toBe('Updated')
    // $type should be preserved
    expect(body.$type).toBe('https://example.com/Thing')
  })
})

// ============================================================================
// DELETE /api/things/:id - Delete Thing
// ============================================================================

describe('DELETE /api/things/:id', () => {
  it('deletes a thing and returns 204', async () => {
    // First create a thing
    const created = await post('/api/things', {
      name: 'To Be Deleted',
      $type: 'https://example.com/DeletableThing',
    })
    const createdThing = (await created.json()) as Thing

    // Then delete it
    const res = await del(`/api/things/${createdThing.id}`)

    expect(res.status).toBe(204)
  })

  it('returns empty body on successful delete', async () => {
    const created = await post('/api/things', {
      name: 'Delete Me',
      $type: 'https://example.com/Thing',
    })
    const createdThing = (await created.json()) as Thing

    const res = await del(`/api/things/${createdThing.id}`)

    // 204 should have no content
    const text = await res.text()
    expect(text).toBe('')
  })

  it('returns 404 for non-existent thing', async () => {
    const res = await del('/api/things/non-existent-id-12345')

    expect(res.status).toBe(404)

    const body = (await res.json()) as ErrorResponse
    expect(body).toHaveProperty('error')
  })

  it('thing is not accessible after deletion', async () => {
    const created = await post('/api/things', {
      name: 'Will Be Gone',
      $type: 'https://example.com/Thing',
    })
    const createdThing = (await created.json()) as Thing

    // Delete it
    await del(`/api/things/${createdThing.id}`)

    // Try to fetch it
    const res = await get(`/api/things/${createdThing.id}`)

    expect(res.status).toBe(404)
  })

  it('deleted thing does not appear in list', async () => {
    const created = await post('/api/things', {
      name: 'Unique Deletable Thing ' + Date.now(),
      $type: 'https://example.com/Thing',
    })
    const createdThing = (await created.json()) as Thing

    // Verify it's in the list
    const beforeList = await get('/api/things')
    const beforeThings = (await beforeList.json()) as Thing[]
    expect(beforeThings.some((t) => t.id === createdThing.id)).toBe(true)

    // Delete it
    await del(`/api/things/${createdThing.id}`)

    // Verify it's not in the list
    const afterList = await get('/api/things')
    const afterThings = (await afterList.json()) as Thing[]
    expect(afterThings.some((t) => t.id === createdThing.id)).toBe(false)
  })
})

// ============================================================================
// Invalid Requests - 400 Bad Request
// ============================================================================

describe('Invalid Requests (400)', () => {
  it('returns 400 for malformed JSON in POST', async () => {
    const res = await app.request('/api/things', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ invalid json }',
    })

    expect(res.status).toBe(400)

    const body = (await res.json()) as ErrorResponse
    expect(body).toHaveProperty('error')
    expect(body.error).toBeTruthy()
  })

  it('returns 400 for malformed JSON in PUT', async () => {
    const res = await app.request('/api/things/some-id', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{ broken: ',
    })

    expect(res.status).toBe(400)

    const body = (await res.json()) as ErrorResponse
    expect(body).toHaveProperty('error')
  })

  it('returns 400 for missing Content-Type header on POST', async () => {
    const res = await app.request('/api/things', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test', $type: 'https://example.com/Thing' }),
    })

    // Should require Content-Type: application/json
    expect(res.status).toBe(400)
  })

  it('returns 400 for invalid query parameters', async () => {
    const res = await get('/api/things?limit=invalid')

    expect(res.status).toBe(400)

    const body = (await res.json()) as ErrorResponse
    expect(body).toHaveProperty('error')
  })

  it('returns 400 for negative limit', async () => {
    const res = await get('/api/things?limit=-5')

    expect(res.status).toBe(400)
  })

  it('returns 400 for negative offset', async () => {
    const res = await get('/api/things?offset=-10')

    expect(res.status).toBe(400)
  })

  it('error response includes error message', async () => {
    const res = await app.request('/api/things', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })

    expect(res.status).toBe(400)

    const body = (await res.json()) as ErrorResponse
    expect(body.error).toBeTruthy()
    expect(typeof body.error).toBe('string')
  })
})

// ============================================================================
// Missing Resources - 404 Not Found
// ============================================================================

describe('Missing Resources (404)', () => {
  it('returns 404 for GET non-existent thing', async () => {
    const res = await get('/api/things/does-not-exist-123')

    expect(res.status).toBe(404)

    const body = (await res.json()) as ErrorResponse
    expect(body).toHaveProperty('error')
  })

  it('returns 404 for PUT non-existent thing', async () => {
    const res = await put('/api/things/does-not-exist-456', {
      name: 'Cannot Update',
    })

    expect(res.status).toBe(404)

    const body = (await res.json()) as ErrorResponse
    expect(body).toHaveProperty('error')
  })

  it('returns 404 for DELETE non-existent thing', async () => {
    const res = await del('/api/things/does-not-exist-789')

    expect(res.status).toBe(404)

    const body = (await res.json()) as ErrorResponse
    expect(body).toHaveProperty('error')
  })

  it('returns 404 for unknown API routes', async () => {
    const res = await get('/api/unknown-endpoint')

    expect(res.status).toBe(404)
  })

  it('returns 404 for nested unknown routes', async () => {
    const res = await get('/api/things/id/nested/unknown')

    expect(res.status).toBe(404)
  })

  it('404 response includes error message', async () => {
    const res = await get('/api/things/not-found-thing')

    expect(res.status).toBe(404)

    const body = (await res.json()) as ErrorResponse
    expect(body.error).toBeTruthy()
    expect(typeof body.error).toBe('string')
  })

  it('404 response is JSON', async () => {
    const res = await get('/api/things/not-found')

    expect(res.headers.get('content-type')).toContain('application/json')
  })
})

// ============================================================================
// Content-Type Validation
// ============================================================================

describe('Content-Type Handling', () => {
  it('accepts application/json for POST', async () => {
    const res = await app.request('/api/things', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'JSON Thing',
        $type: 'https://example.com/Thing',
      }),
    })

    // Should succeed (201) or fail validation (400), not reject content-type
    expect([201, 400]).toContain(res.status)
  })

  it('accepts application/json with charset for POST', async () => {
    const res = await app.request('/api/things', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        name: 'Charset Thing',
        $type: 'https://example.com/Thing',
      }),
    })

    // Should succeed (201) or fail validation (400)
    expect([201, 400]).toContain(res.status)
  })

  it('returns JSON content-type on success responses', async () => {
    const res = await get('/api/things')

    expect(res.headers.get('content-type')).toContain('application/json')
  })

  it('returns JSON content-type on error responses', async () => {
    const res = await get('/api/things/not-found')

    expect(res.headers.get('content-type')).toContain('application/json')
  })
})

// ============================================================================
// HTTP Methods
// ============================================================================

describe('HTTP Methods', () => {
  it('supports GET on /api/health', async () => {
    const res = await get('/api/health')
    expect([200, 404]).toContain(res.status)
  })

  it('supports GET on /api/things', async () => {
    const res = await get('/api/things')
    expect([200, 404]).toContain(res.status)
  })

  it('supports POST on /api/things', async () => {
    const res = await post('/api/things', {
      name: 'Test',
      $type: 'https://example.com/Thing',
    })
    expect([201, 400, 404]).toContain(res.status)
  })

  it('supports GET on /api/things/:id', async () => {
    const res = await get('/api/things/test-id')
    expect([200, 404]).toContain(res.status)
  })

  it('supports PUT on /api/things/:id', async () => {
    const res = await put('/api/things/test-id', { name: 'Updated' })
    expect([200, 400, 404]).toContain(res.status)
  })

  it('supports DELETE on /api/things/:id', async () => {
    const res = await del('/api/things/test-id')
    expect([204, 404]).toContain(res.status)
  })

  it('returns 405 for unsupported methods on /api/things', async () => {
    const res = await app.request('/api/things', { method: 'PATCH' })
    expect(res.status).toBe(405)
  })

  it('returns 405 for unsupported methods on /api/things/:id', async () => {
    const res = await app.request('/api/things/test-id', { method: 'OPTIONS' })
    // OPTIONS might be allowed for CORS, so check for either 204 or 405
    expect([204, 405]).toContain(res.status)
  })
})
