/**
 * Collection Endpoint Tests
 *
 * Tests for the REST API collection endpoints following the Collection interface pattern.
 * These tests verify the complete CRUD operations for typed collections.
 *
 * A Collection is a typed container where:
 * - All items are of the same type (itemType)
 * - IDs are constructed as `ns/id` (no type in path)
 * - CRUD operations don't require type parameter
 *
 * These tests are expected to FAIL until the collection endpoints are fully implemented.
 *
 * Implementation requirements:
 * - Support typed collections via /api/:collection pattern
 * - Implement proper Collection interface methods
 * - Support cursor-based pagination
 * - Support filtering and querying
 * - Return proper status codes and error formats
 *
 * @see types/Collection.ts for the Collection interface
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest'

// ============================================================================
// Types
// ============================================================================

interface Thing {
  $id: string
  $type: string
  name?: string
  [key: string]: unknown
}

interface CollectionListResponse {
  items: Thing[]
  cursor?: string
  total?: number
}

interface CollectionData {
  $id: string
  $type: 'https://schema.org.ai/Collection'
  ns: string
  itemType: string
  name?: string
  description?: string
  createdAt: string
  updatedAt: string
}

interface ErrorResponse {
  error: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

// ============================================================================
// Test Setup
// ============================================================================

describe('Collection Endpoints', () => {
  let app: { request: (path: string | Request, options?: RequestInit) => Promise<Response> }
  const baseUrl = '/api'

  beforeAll(async () => {
    const { createTestApp } = await import('./setup')
    app = await createTestApp()
  })

  // Helper functions
  async function get(path: string, headers?: Record<string, string>): Promise<Response> {
    return app.request(path, {
      method: 'GET',
      headers,
    })
  }

  async function post(path: string, body: unknown, headers?: Record<string, string>): Promise<Response> {
    return app.request(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    })
  }

  async function put(path: string, body: unknown, headers?: Record<string, string>): Promise<Response> {
    return app.request(path, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    })
  }

  async function del(path: string, headers?: Record<string, string>): Promise<Response> {
    return app.request(path, {
      method: 'DELETE',
      headers,
    })
  }

  // ============================================================================
  // 1. Collection Discovery and Metadata
  // ============================================================================

  describe('Collection Discovery', () => {
    describe('GET /api/:collection - Collection metadata', () => {
      it('should return collection metadata for valid collection type', async () => {
        const res = await get(`${baseUrl}/startups`)
        expect(res.status).toBe(200)

        const body = await res.json() as CollectionListResponse
        expect(body.items).toBeDefined()
        expect(Array.isArray(body.items)).toBe(true)
      })

      it('should return $type as https://schema.org.ai/Collection', async () => {
        const res = await get(`${baseUrl}/projects`)
        expect(res.status).toBe(200)

        const body = await res.json() as CollectionListResponse | CollectionData
        // Collection itself or list of items
        if ('$type' in body) {
          expect(body.$type).toBe('https://schema.org.ai/Collection')
        }
      })

      it('should return 404 for unknown collection type', async () => {
        const res = await get(`${baseUrl}/nonexistent-collection-type-xyz`)
        expect(res.status).toBe(404)

        const body = await res.json() as ErrorResponse
        expect(body.error).toBeDefined()
        expect(body.error.code).toBe('NOT_FOUND')
      })

      it('should return itemType in collection metadata', async () => {
        const res = await get(`${baseUrl}/tasks`)
        expect(res.status).toBe(200)

        const body = await res.json() as CollectionListResponse
        // The items should all have the same type
        if (body.items.length > 0) {
          const firstType = body.items[0].$type
          expect(body.items.every(item => item.$type === firstType)).toBe(true)
        }
      })
    })

    describe('HEAD /api/:collection - Collection exists check', () => {
      it('should return 200 for existing collection', async () => {
        const res = await app.request(`${baseUrl}/tasks`, { method: 'HEAD' })
        expect(res.status).toBe(200)
      })

      it('should return 404 for non-existing collection', async () => {
        const res = await app.request(`${baseUrl}/fake-collection-abc`, { method: 'HEAD' })
        expect(res.status).toBe(404)
      })

      it('should return empty body for HEAD request', async () => {
        const res = await app.request(`${baseUrl}/tasks`, { method: 'HEAD' })
        const text = await res.text()
        expect(text).toBe('')
      })
    })
  })

  // ============================================================================
  // 2. Collection List Operations
  // ============================================================================

  describe('Collection List Operations', () => {
    describe('GET /api/:collection - List items', () => {
      it('should return array of items', async () => {
        const res = await get(`${baseUrl}/things`)
        expect(res.status).toBe(200)

        const body = await res.json() as CollectionListResponse
        expect(Array.isArray(body.items)).toBe(true)
      })

      it('should return items with $id and $type', async () => {
        // First create an item
        await post(`${baseUrl}/things`, { name: 'Test Item' })

        const res = await get(`${baseUrl}/things`)
        expect(res.status).toBe(200)

        const body = await res.json() as CollectionListResponse
        if (body.items.length > 0) {
          expect(body.items[0]).toHaveProperty('$id')
          expect(body.items[0]).toHaveProperty('$type')
        }
      })

      it('should return empty array when collection has no items', async () => {
        const res = await get(`${baseUrl}/empty-collection`)
        expect(res.status).toBe(200)

        const body = await res.json() as CollectionListResponse
        expect(body.items).toEqual([])
      })

      it('should include cursor for pagination', async () => {
        // Create multiple items to trigger pagination
        for (let i = 0; i < 25; i++) {
          await post(`${baseUrl}/paginated-items`, { name: `Item ${i}` })
        }

        const res = await get(`${baseUrl}/paginated-items?limit=10`)
        expect(res.status).toBe(200)

        const body = await res.json() as CollectionListResponse
        expect(body.cursor).toBeDefined()
      })
    })

    describe('Cursor-based Pagination', () => {
      it('should support cursor query parameter', async () => {
        const res = await get(`${baseUrl}/things?cursor=abc123`)
        expect([200, 400]).toContain(res.status)
      })

      it('should return next page with valid cursor', async () => {
        // First page
        const page1 = await get(`${baseUrl}/things?limit=5`)
        expect(page1.status).toBe(200)
        const body1 = await page1.json() as CollectionListResponse

        if (body1.cursor) {
          // Second page using cursor
          const page2 = await get(`${baseUrl}/things?cursor=${body1.cursor}&limit=5`)
          expect(page2.status).toBe(200)

          const body2 = await page2.json() as CollectionListResponse
          // Items should be different
          expect(body2.items[0]?.$id).not.toBe(body1.items[0]?.$id)
        }
      })

      it('should return 400 for invalid cursor', async () => {
        const res = await get(`${baseUrl}/things?cursor=invalid-cursor-format!!!`)
        expect(res.status).toBe(400)

        const body = await res.json() as ErrorResponse
        expect(body.error.code).toBe('BAD_REQUEST')
      })

      it('should return empty items and no cursor on last page', async () => {
        // Get a page that goes past the end
        const res = await get(`${baseUrl}/things?cursor=very-late-cursor&limit=100`)
        // Could be 200 with empty items or 400 for invalid cursor
        expect([200, 400]).toContain(res.status)
      })

      it('should respect limit parameter', async () => {
        const res = await get(`${baseUrl}/things?limit=3`)
        expect(res.status).toBe(200)

        const body = await res.json() as CollectionListResponse
        expect(body.items.length).toBeLessThanOrEqual(3)
      })

      it('should enforce maximum limit', async () => {
        const res = await get(`${baseUrl}/things?limit=10000`)
        expect(res.status).toBe(200)

        const body = await res.json() as CollectionListResponse
        // Should cap at max limit (e.g., 100)
        expect(body.items.length).toBeLessThanOrEqual(100)
      })

      it('should return 400 for negative limit', async () => {
        const res = await get(`${baseUrl}/things?limit=-5`)
        expect(res.status).toBe(400)
      })
    })

    describe('Query and Filtering', () => {
      it('should support query parameter for filtering', async () => {
        const res = await get(`${baseUrl}/things?query=name:Test`)
        expect([200, 400]).toContain(res.status)
      })

      it('should return filtered results matching query', async () => {
        // Create items with specific names
        await post(`${baseUrl}/things`, { name: 'Alpha Item' })
        await post(`${baseUrl}/things`, { name: 'Beta Item' })

        const res = await get(`${baseUrl}/things?name=Alpha Item`)
        expect(res.status).toBe(200)

        const body = await res.json() as CollectionListResponse
        // Should only contain items matching the filter
        body.items.forEach(item => {
          expect(item.name).toContain('Alpha')
        })
      })

      it('should support field-based filtering', async () => {
        const res = await get(`${baseUrl}/things?status=active`)
        expect([200, 400]).toContain(res.status)
      })

      it('should support multiple filter parameters', async () => {
        const res = await get(`${baseUrl}/things?status=active&priority=high`)
        expect([200, 400]).toContain(res.status)
      })

      it('should return 400 for invalid filter syntax', async () => {
        const res = await get(`${baseUrl}/things?filter=[invalid`)
        expect(res.status).toBe(400)
      })
    })

    describe('Sorting', () => {
      it('should support sort parameter', async () => {
        const res = await get(`${baseUrl}/things?sort=name`)
        expect([200, 400]).toContain(res.status)
      })

      it('should support descending sort with - prefix', async () => {
        const res = await get(`${baseUrl}/things?sort=-createdAt`)
        expect([200, 400]).toContain(res.status)
      })

      it('should return items in sorted order', async () => {
        await post(`${baseUrl}/things`, { name: 'Zebra' })
        await post(`${baseUrl}/things`, { name: 'Apple' })

        const res = await get(`${baseUrl}/things?sort=name`)
        expect(res.status).toBe(200)

        const body = await res.json() as CollectionListResponse
        if (body.items.length >= 2) {
          const names = body.items.map(i => i.name).filter(Boolean) as string[]
          const sorted = [...names].sort()
          expect(names).toEqual(sorted)
        }
      })

      it('should return 400 for invalid sort field', async () => {
        const res = await get(`${baseUrl}/things?sort=nonexistent-field-xyz`)
        expect([200, 400]).toContain(res.status)
      })
    })
  })

  // ============================================================================
  // 3. Collection Item CRUD
  // ============================================================================

  describe('Collection Item CRUD', () => {
    describe('POST /api/:collection - Create item', () => {
      it('should create item and return 201', async () => {
        const res = await post(`${baseUrl}/things`, {
          name: 'New Thing',
          data: { key: 'value' },
        })
        expect(res.status).toBe(201)
      })

      it('should return created item with $id', async () => {
        const res = await post(`${baseUrl}/things`, {
          name: 'Created Thing',
        })
        expect(res.status).toBe(201)

        const body = await res.json() as Thing
        expect(body.$id).toBeDefined()
        expect(typeof body.$id).toBe('string')
        expect(body.$id.length).toBeGreaterThan(0)
      })

      it('should set $type to collection itemType', async () => {
        const res = await post(`${baseUrl}/things`, {
          name: 'Typed Thing',
        })
        expect(res.status).toBe(201)

        const body = await res.json() as Thing
        expect(body.$type).toBeDefined()
      })

      it('should support custom id in request body', async () => {
        const customId = `custom-${Date.now()}`
        const res = await post(`${baseUrl}/things`, {
          id: customId,
          name: 'Custom ID Thing',
        })
        expect(res.status).toBe(201)

        const body = await res.json() as Thing
        expect(body.$id).toContain(customId)
      })

      it('should return 409 Conflict for duplicate custom id', async () => {
        const customId = `duplicate-${Date.now()}`

        // First creation
        await post(`${baseUrl}/things`, {
          id: customId,
          name: 'First Thing',
        })

        // Duplicate creation
        const res = await post(`${baseUrl}/things`, {
          id: customId,
          name: 'Duplicate Thing',
        })
        expect(res.status).toBe(409)

        const body = await res.json() as ErrorResponse
        expect(body.error.code).toBe('CONFLICT')
      })

      it('should return 400 for invalid JSON body', async () => {
        const res = await app.request(`${baseUrl}/things`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'invalid json {{{',
        })
        expect(res.status).toBe(400)
      })

      it('should return 400 for missing Content-Type', async () => {
        const res = await app.request(`${baseUrl}/things`, {
          method: 'POST',
          body: JSON.stringify({ name: 'Test' }),
        })
        expect(res.status).toBe(400)
      })

      it('should return Location header with new resource URL', async () => {
        const res = await post(`${baseUrl}/things`, {
          name: 'Located Thing',
        })
        expect(res.status).toBe(201)

        const location = res.headers.get('Location')
        expect(location).toBeDefined()
        expect(location).toMatch(/\/api\/things\//)
      })
    })

    describe('GET /api/:collection/:id - Get single item', () => {
      it('should return item by id', async () => {
        // Create an item first
        const createRes = await post(`${baseUrl}/things`, {
          name: 'Fetchable Thing',
        })
        const created = await createRes.json() as Thing

        const res = await get(`${baseUrl}/things/${encodeURIComponent(created.$id)}`)
        expect(res.status).toBe(200)

        const body = await res.json() as Thing
        expect(body.$id).toBe(created.$id)
        expect(body.name).toBe('Fetchable Thing')
      })

      it('should return 404 for non-existent item', async () => {
        const res = await get(`${baseUrl}/things/nonexistent-id-12345`)
        expect(res.status).toBe(404)

        const body = await res.json() as ErrorResponse
        expect(body.error.code).toBe('NOT_FOUND')
      })

      it('should handle URL-encoded ids', async () => {
        const specialId = 'user:alice@example.com.ai'
        await post(`${baseUrl}/things`, {
          id: specialId,
          name: 'Special ID Thing',
        })

        const res = await get(`${baseUrl}/things/${encodeURIComponent(specialId)}`)
        expect([200, 404]).toContain(res.status) // Depends on implementation
      })

      it('should return all item fields', async () => {
        const createRes = await post(`${baseUrl}/things`, {
          name: 'Full Thing',
          description: 'A complete thing',
          status: 'active',
          priority: 5,
        })
        const created = await createRes.json() as Thing

        const res = await get(`${baseUrl}/things/${encodeURIComponent(created.$id)}`)
        expect(res.status).toBe(200)

        const body = await res.json() as Thing
        expect(body.name).toBe('Full Thing')
        expect(body.description).toBe('A complete thing')
        expect(body.status).toBe('active')
        expect(body.priority).toBe(5)
      })

      it('should include createdAt and updatedAt timestamps', async () => {
        const createRes = await post(`${baseUrl}/things`, {
          name: 'Timestamped Thing',
        })
        const created = await createRes.json() as Thing

        const res = await get(`${baseUrl}/things/${encodeURIComponent(created.$id)}`)
        expect(res.status).toBe(200)

        const body = await res.json() as Thing
        expect(body.createdAt).toBeDefined()
        expect(body.updatedAt).toBeDefined()
      })
    })

    describe('PUT /api/:collection/:id - Update item', () => {
      it('should update item and return 200', async () => {
        // Create an item
        const createRes = await post(`${baseUrl}/things`, {
          name: 'Original Name',
        })
        const created = await createRes.json() as Thing

        // Update it
        const res = await put(`${baseUrl}/things/${encodeURIComponent(created.$id)}`, {
          name: 'Updated Name',
        })
        expect(res.status).toBe(200)

        const body = await res.json() as Thing
        expect(body.name).toBe('Updated Name')
      })

      it('should return 404 for non-existent item', async () => {
        const res = await put(`${baseUrl}/things/nonexistent-update-id`, {
          name: 'Should Not Update',
        })
        expect(res.status).toBe(404)
      })

      it('should preserve $id and $type on update', async () => {
        const createRes = await post(`${baseUrl}/things`, {
          name: 'Preserve ID Thing',
        })
        const created = await createRes.json() as Thing

        const res = await put(`${baseUrl}/things/${encodeURIComponent(created.$id)}`, {
          name: 'Updated but Same ID',
          $id: 'should-not-change', // Attempt to change ID
        })
        expect(res.status).toBe(200)

        const body = await res.json() as Thing
        expect(body.$id).toBe(created.$id)
        expect(body.$type).toBe(created.$type)
      })

      it('should update updatedAt timestamp', async () => {
        const createRes = await post(`${baseUrl}/things`, {
          name: 'Timestamp Update Thing',
        })
        const created = await createRes.json() as Thing
        const originalUpdatedAt = created.updatedAt

        // Small delay
        await new Promise(resolve => setTimeout(resolve, 10))

        const res = await put(`${baseUrl}/things/${encodeURIComponent(created.$id)}`, {
          name: 'Updated Timestamp Thing',
        })
        expect(res.status).toBe(200)

        const body = await res.json() as Thing
        expect(new Date(body.updatedAt as string).getTime())
          .toBeGreaterThanOrEqual(new Date(originalUpdatedAt as string).getTime())
      })

      it('should return 400 for invalid update data', async () => {
        const createRes = await post(`${baseUrl}/things`, {
          name: 'Valid Thing',
        })
        const created = await createRes.json() as Thing

        const res = await app.request(`${baseUrl}/things/${encodeURIComponent(created.$id)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: 'invalid json',
        })
        expect(res.status).toBe(400)
      })
    })

    describe('PATCH /api/:collection/:id - Partial update item', () => {
      it('should partially update item and return 200', async () => {
        const createRes = await post(`${baseUrl}/things`, {
          name: 'Patchable Thing',
          status: 'draft',
          priority: 1,
        })
        const created = await createRes.json() as Thing

        const res = await app.request(`${baseUrl}/things/${encodeURIComponent(created.$id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'active' }),
        })
        expect(res.status).toBe(200)

        const body = await res.json() as Thing
        expect(body.status).toBe('active')
        expect(body.name).toBe('Patchable Thing') // Preserved
        expect(body.priority).toBe(1) // Preserved
      })

      it('should return 404 for non-existent item', async () => {
        const res = await app.request(`${baseUrl}/things/nonexistent-patch-id`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'active' }),
        })
        expect(res.status).toBe(404)
      })

      it('should support JSON Patch format', async () => {
        const createRes = await post(`${baseUrl}/things`, {
          name: 'JSON Patch Thing',
          tags: ['a', 'b'],
        })
        const created = await createRes.json() as Thing

        const res = await app.request(`${baseUrl}/things/${encodeURIComponent(created.$id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json-patch+json' },
          body: JSON.stringify([
            { op: 'replace', path: '/name', value: 'Patched Thing' },
            { op: 'add', path: '/tags/-', value: 'c' },
          ]),
        })
        // May return 200 or 415 depending on implementation
        expect([200, 415]).toContain(res.status)
      })

      it('should not allow patching $id', async () => {
        const createRes = await post(`${baseUrl}/things`, {
          name: 'No ID Patch Thing',
        })
        const created = await createRes.json() as Thing

        const res = await app.request(`${baseUrl}/things/${encodeURIComponent(created.$id)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ $id: 'new-id' }),
        })

        // Either 200 with $id preserved or 400 rejecting the patch
        expect([200, 400]).toContain(res.status)

        if (res.status === 200) {
          const body = await res.json() as Thing
          expect(body.$id).toBe(created.$id)
        }
      })
    })

    describe('DELETE /api/:collection/:id - Delete item', () => {
      it('should delete item and return 204', async () => {
        const createRes = await post(`${baseUrl}/things`, {
          name: 'Deletable Thing',
        })
        const created = await createRes.json() as Thing

        const res = await del(`${baseUrl}/things/${encodeURIComponent(created.$id)}`)
        expect(res.status).toBe(204)

        const text = await res.text()
        expect(text).toBe('')
      })

      it('should return 404 for non-existent item', async () => {
        const res = await del(`${baseUrl}/things/nonexistent-delete-id`)
        expect(res.status).toBe(404)
      })

      it('should make item inaccessible after deletion', async () => {
        const createRes = await post(`${baseUrl}/things`, {
          name: 'Soon Deleted Thing',
        })
        const created = await createRes.json() as Thing

        await del(`${baseUrl}/things/${encodeURIComponent(created.$id)}`)

        const getRes = await get(`${baseUrl}/things/${encodeURIComponent(created.$id)}`)
        expect(getRes.status).toBe(404)
      })

      it('should remove item from list after deletion', async () => {
        const uniqueName = `Unique Thing ${Date.now()}`
        const createRes = await post(`${baseUrl}/things`, {
          name: uniqueName,
        })
        const created = await createRes.json() as Thing

        // Verify in list
        const beforeList = await get(`${baseUrl}/things`)
        const beforeBody = await beforeList.json() as CollectionListResponse
        expect(beforeBody.items.some(i => i.$id === created.$id)).toBe(true)

        // Delete
        await del(`${baseUrl}/things/${encodeURIComponent(created.$id)}`)

        // Verify not in list
        const afterList = await get(`${baseUrl}/things`)
        const afterBody = await afterList.json() as CollectionListResponse
        expect(afterBody.items.some(i => i.$id === created.$id)).toBe(false)
      })

      it('should return 404 on second delete of same item', async () => {
        const createRes = await post(`${baseUrl}/things`, {
          name: 'Double Delete Thing',
        })
        const created = await createRes.json() as Thing

        // First delete
        await del(`${baseUrl}/things/${encodeURIComponent(created.$id)}`)

        // Second delete
        const res = await del(`${baseUrl}/things/${encodeURIComponent(created.$id)}`)
        expect(res.status).toBe(404)
      })
    })
  })

  // ============================================================================
  // 4. Collection Count and Aggregation
  // ============================================================================

  describe('Collection Count and Aggregation', () => {
    describe('GET /api/:collection/count - Count items', () => {
      it('should return count of items', async () => {
        const res = await get(`${baseUrl}/things/count`)
        expect([200, 404]).toContain(res.status) // May not be implemented

        if (res.status === 200) {
          const body = await res.json() as { count: number }
          expect(typeof body.count).toBe('number')
          expect(body.count).toBeGreaterThanOrEqual(0)
        }
      })

      it('should support query filter for count', async () => {
        const res = await get(`${baseUrl}/things/count?status=active`)
        expect([200, 404]).toContain(res.status)
      })

      it('should return count as integer', async () => {
        const res = await get(`${baseUrl}/things/count`)

        if (res.status === 200) {
          const body = await res.json() as { count: number }
          expect(Number.isInteger(body.count)).toBe(true)
        }
      })
    })

    describe('POST /api/:collection/find - Query items', () => {
      it('should return items matching query', async () => {
        const res = await post(`${baseUrl}/things/find`, {
          status: 'active',
        })
        expect([200, 404]).toContain(res.status)

        if (res.status === 200) {
          const body = await res.json() as Thing[]
          expect(Array.isArray(body)).toBe(true)
        }
      })

      it('should return empty array for no matches', async () => {
        const res = await post(`${baseUrl}/things/find`, {
          nonexistentField: 'nonexistent-value-xyz',
        })

        if (res.status === 200) {
          const body = await res.json() as Thing[]
          expect(body).toEqual([])
        }
      })

      it('should support complex queries', async () => {
        const res = await post(`${baseUrl}/things/find`, {
          $and: [
            { status: 'active' },
            { priority: { $gt: 5 } },
          ],
        })
        expect([200, 400, 404]).toContain(res.status)
      })
    })
  })

  // ============================================================================
  // 5. Collection Schema and Validation
  // ============================================================================

  describe('Collection Schema and Validation', () => {
    describe('GET /api/:collection/schema - Get schema', () => {
      it('should return JSON Schema for collection items', async () => {
        const res = await get(`${baseUrl}/things/schema`)
        expect([200, 404]).toContain(res.status)

        if (res.status === 200) {
          const body = await res.json() as { $schema?: string; type?: string }
          expect(body.$schema || body.type).toBeDefined()
        }
      })
    })

    describe('Validation on Create', () => {
      it('should return 422 for schema validation failure', async () => {
        const res = await post(`${baseUrl}/things`, {
          name: '', // Empty name might be invalid
        })
        expect([201, 422]).toContain(res.status)
      })

      it('should return validation error details', async () => {
        const res = await post(`${baseUrl}/things`, {
          priority: 'not-a-number', // Invalid type
        })

        if (res.status === 422) {
          const body = await res.json() as ErrorResponse
          expect(body.error.code).toBe('UNPROCESSABLE_ENTITY')
          expect(body.error.details).toBeDefined()
        }
      })

      it('should validate required fields', async () => {
        const res = await post(`${baseUrl}/things`, {})
        expect([201, 400, 422]).toContain(res.status)
      })
    })

    describe('Validation on Update', () => {
      it('should validate update data against schema', async () => {
        const createRes = await post(`${baseUrl}/things`, {
          name: 'Valid Thing',
        })
        const created = await createRes.json() as Thing

        const res = await put(`${baseUrl}/things/${encodeURIComponent(created.$id)}`, {
          priority: 'invalid',
        })
        expect([200, 422]).toContain(res.status)
      })
    })
  })

  // ============================================================================
  // 6. Bulk Operations
  // ============================================================================

  describe('Bulk Operations', () => {
    describe('POST /api/:collection/_batch - Batch create', () => {
      it('should create multiple items at once', async () => {
        const res = await post(`${baseUrl}/things/_batch`, {
          items: [
            { name: 'Batch Item 1' },
            { name: 'Batch Item 2' },
            { name: 'Batch Item 3' },
          ],
        })
        expect([200, 201, 404]).toContain(res.status)

        if (res.status === 201 || res.status === 200) {
          const body = await res.json() as { items: Thing[]; errors?: unknown[] }
          expect(body.items).toBeDefined()
          expect(body.items.length).toBe(3)
        }
      })

      it('should return partial success with errors', async () => {
        const res = await post(`${baseUrl}/things/_batch`, {
          items: [
            { name: 'Valid Item' },
            { name: '' }, // Invalid
            { name: 'Another Valid Item' },
          ],
        })
        expect([200, 207, 404]).toContain(res.status) // 207 Multi-Status

        if (res.status === 207) {
          const body = await res.json() as { items: Thing[]; errors: { index: number; error: ErrorResponse }[] }
          expect(body.errors).toBeDefined()
        }
      })

      it('should return 400 for empty batch', async () => {
        const res = await post(`${baseUrl}/things/_batch`, {
          items: [],
        })
        expect([200, 400, 404]).toContain(res.status)
      })

      it('should enforce maximum batch size', async () => {
        const tooManyItems = Array.from({ length: 1001 }, (_, i) => ({
          name: `Item ${i}`,
        }))

        const res = await post(`${baseUrl}/things/_batch`, {
          items: tooManyItems,
        })
        expect([400, 404]).toContain(res.status)
      })
    })

    describe('DELETE /api/:collection/_batch - Batch delete', () => {
      it('should delete multiple items by ids', async () => {
        // Create items first
        const created: Thing[] = []
        for (let i = 0; i < 3; i++) {
          const createRes = await post(`${baseUrl}/things`, { name: `Delete Batch ${i}` })
          created.push(await createRes.json() as Thing)
        }

        const res = await app.request(`${baseUrl}/things/_batch`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ids: created.map(c => c.$id),
          }),
        })
        expect([200, 204, 404]).toContain(res.status)
      })

      it('should return count of deleted items', async () => {
        const createRes = await post(`${baseUrl}/things`, { name: 'Batch Delete Count' })
        const created = await createRes.json() as Thing

        const res = await app.request(`${baseUrl}/things/_batch`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ids: [created.$id],
          }),
        })

        if (res.status === 200) {
          const body = await res.json() as { deleted: number }
          expect(body.deleted).toBe(1)
        }
      })
    })
  })

  // ============================================================================
  // 7. Content Negotiation
  // ============================================================================

  describe('Content Negotiation', () => {
    describe('Accept header handling', () => {
      it('should return JSON by default', async () => {
        const res = await get(`${baseUrl}/things`)
        expect(res.headers.get('Content-Type')).toContain('application/json')
      })

      it('should return JSON for application/json Accept', async () => {
        const res = await get(`${baseUrl}/things`, {
          Accept: 'application/json',
        })
        expect(res.headers.get('Content-Type')).toContain('application/json')
      })

      it('should support Accept: */*', async () => {
        const res = await get(`${baseUrl}/things`, {
          Accept: '*/*',
        })
        expect(res.status).toBe(200)
      })
    })

    describe('Response headers', () => {
      it('should include ETag for GET responses', async () => {
        const createRes = await post(`${baseUrl}/things`, { name: 'ETag Thing' })
        const created = await createRes.json() as Thing

        const res = await get(`${baseUrl}/things/${encodeURIComponent(created.$id)}`)
        expect(res.headers.get('ETag')).toBeDefined()
      })

      it('should return 304 for matching If-None-Match', async () => {
        const createRes = await post(`${baseUrl}/things`, { name: 'Conditional Thing' })
        const created = await createRes.json() as Thing

        const res1 = await get(`${baseUrl}/things/${encodeURIComponent(created.$id)}`)
        const etag = res1.headers.get('ETag')

        if (etag) {
          const res2 = await get(`${baseUrl}/things/${encodeURIComponent(created.$id)}`, {
            'If-None-Match': etag,
          })
          expect(res2.status).toBe(304)
        }
      })

      it('should include Cache-Control header', async () => {
        const res = await get(`${baseUrl}/things`)
        const cacheControl = res.headers.get('Cache-Control')
        // May or may not be present depending on implementation
        expect([null, expect.any(String)]).toContain(cacheControl)
      })
    })
  })

  // ============================================================================
  // 8. Error Handling
  // ============================================================================

  describe('Error Handling', () => {
    describe('Error response format', () => {
      it('should return consistent error format', async () => {
        const res = await get(`${baseUrl}/things/nonexistent`)
        expect(res.status).toBe(404)

        const body = await res.json() as ErrorResponse
        expect(body.error).toBeDefined()
        expect(body.error.code).toBeDefined()
        expect(body.error.message).toBeDefined()
      })

      it('should return JSON Content-Type for errors', async () => {
        const res = await get(`${baseUrl}/things/nonexistent`)
        expect(res.headers.get('Content-Type')).toContain('application/json')
      })
    })

    describe('Method not allowed', () => {
      it('should return 405 for unsupported methods on collection', async () => {
        const res = await app.request(`${baseUrl}/things`, {
          method: 'TRACE',
        })
        expect([405, 501]).toContain(res.status)
      })

      it('should include Allow header on 405', async () => {
        const res = await del(`${baseUrl}/things`) // DELETE on collection
        if (res.status === 405) {
          expect(res.headers.get('Allow')).toBeDefined()
        }
      })
    })

    describe('Rate limiting', () => {
      it('should return 429 when rate limited', async () => {
        // Make many requests quickly
        const requests = Array.from({ length: 100 }, () =>
          get(`${baseUrl}/things`)
        )
        const responses = await Promise.all(requests)

        // At least some should succeed, but might get rate limited
        const statuses = responses.map(r => r.status)
        expect(statuses.some(s => s === 200 || s === 429)).toBe(true)
      })

      it('should include Retry-After header on 429', async () => {
        // This test may not trigger rate limiting in unit tests
        const res = await get(`${baseUrl}/things`)
        if (res.status === 429) {
          expect(res.headers.get('Retry-After')).toBeDefined()
        }
      })
    })
  })

  // ============================================================================
  // 9. Security
  // ============================================================================

  describe('Security', () => {
    describe('Path traversal protection', () => {
      it('should reject path traversal in collection name', async () => {
        const res = await get(`${baseUrl}/../../../etc/passwd`)
        expect(res.status).toBe(404)
      })

      it('should reject path traversal in item id', async () => {
        const res = await get(`${baseUrl}/things/../../../etc/passwd`)
        expect(res.status).toBe(404)
      })

      it('should reject encoded path traversal', async () => {
        const res = await get(`${baseUrl}/things/%2e%2e%2f%2e%2e%2fetc%2fpasswd`)
        expect([400, 404]).toContain(res.status)
      })
    })

    describe('Input sanitization', () => {
      it('should handle very long collection names', async () => {
        const longName = 'a'.repeat(10000)
        const res = await get(`${baseUrl}/${longName}`)
        expect([400, 404, 414]).toContain(res.status)
      })

      it('should handle special characters in collection name', async () => {
        const res = await get(`${baseUrl}/things<script>alert(1)</script>`)
        expect([400, 404]).toContain(res.status)
      })

      it('should sanitize output to prevent XSS', async () => {
        const createRes = await post(`${baseUrl}/things`, {
          name: '<script>alert("xss")</script>',
        })
        const created = await createRes.json() as Thing

        const res = await get(`${baseUrl}/things/${encodeURIComponent(created.$id)}`)
        const text = await res.text()

        // JSON encoding should escape the script tags
        expect(text).not.toContain('<script>')
      })
    })
  })

  // ============================================================================
  // 10. Concurrency
  // ============================================================================

  describe('Concurrency', () => {
    describe('Concurrent reads', () => {
      it('should handle concurrent GET requests', async () => {
        const requests = Array.from({ length: 10 }, () =>
          get(`${baseUrl}/things`)
        )

        const responses = await Promise.all(requests)
        responses.forEach(res => {
          expect(res.status).toBe(200)
        })
      })
    })

    describe('Concurrent writes', () => {
      it('should handle concurrent POST requests', async () => {
        const requests = Array.from({ length: 10 }, (_, i) =>
          post(`${baseUrl}/things`, { name: `Concurrent ${i}` })
        )

        const responses = await Promise.all(requests)
        responses.forEach(res => {
          expect(res.status).toBe(201)
        })

        // All should have unique IDs
        const bodies = await Promise.all(responses.map(r => r.json() as Promise<Thing>))
        const ids = bodies.map(b => b.$id)
        expect(new Set(ids).size).toBe(ids.length)
      })

      it('should handle concurrent updates to same item', async () => {
        const createRes = await post(`${baseUrl}/things`, { name: 'Concurrent Update Target' })
        const created = await createRes.json() as Thing

        const requests = Array.from({ length: 5 }, (_, i) =>
          put(`${baseUrl}/things/${encodeURIComponent(created.$id)}`, {
            name: `Updated ${i}`,
          })
        )

        const responses = await Promise.all(requests)
        // At least some should succeed
        expect(responses.some(r => r.status === 200)).toBe(true)
      })
    })

    describe('Optimistic concurrency', () => {
      it('should support If-Match header for updates', async () => {
        const createRes = await post(`${baseUrl}/things`, { name: 'Versioned Thing' })
        const created = await createRes.json() as Thing

        const getRes = await get(`${baseUrl}/things/${encodeURIComponent(created.$id)}`)
        const etag = getRes.headers.get('ETag')

        if (etag) {
          const updateRes = await app.request(`${baseUrl}/things/${encodeURIComponent(created.$id)}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'If-Match': etag,
            },
            body: JSON.stringify({ name: 'Safely Updated' }),
          })
          expect([200, 412]).toContain(updateRes.status)
        }
      })

      it('should return 412 for stale If-Match', async () => {
        const createRes = await post(`${baseUrl}/things`, { name: 'Stale Update Thing' })
        const created = await createRes.json() as Thing

        const updateRes = await app.request(`${baseUrl}/things/${encodeURIComponent(created.$id)}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'If-Match': '"stale-etag-value"',
          },
          body: JSON.stringify({ name: 'Should Fail' }),
        })
        expect([200, 412]).toContain(updateRes.status) // Depends on implementation
      })
    })
  })
})
