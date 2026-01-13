/**
 * E2E Tests: Graph CRUD Operations
 *
 * Tests basic Create, Read, Update, Delete operations on graph Things
 * and Relationships through the DO REST API.
 *
 * These tests verify that the graph operations work correctly when
 * accessed through HTTP endpoints backed by Durable Objects.
 *
 * @module tests/e2e/graph/graph-crud.spec
 */

import { test, expect } from '@playwright/test'

/**
 * API endpoint for graph operations.
 * In production, this would be something like graph.tenant.api.dotdo.dev
 * For E2E testing, we use the local dev server.
 */
const GRAPH_API = '/api/graph'

/**
 * Generate a unique ID for test isolation
 */
function uniqueId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

test.describe('Graph CRUD - Things (Nodes)', () => {
  test.describe('Create Thing', () => {
    test('creates a Thing with type and data', async ({ request }) => {
      const thingId = uniqueId('person')

      const response = await request.post(`${GRAPH_API}/things`, {
        data: {
          id: thingId,
          type: 'Person',
          data: {
            name: 'Alice',
            age: 30,
            email: 'alice@example.com',
          },
        },
      })

      expect(response.status()).toBe(201)
      const created = await response.json()

      expect(created.id).toBe(thingId)
      expect(created.type).toBe('Person')
      expect(created.data.name).toBe('Alice')
      expect(created.data.age).toBe(30)
      expect(created.createdAt).toBeDefined()
      expect(created.updatedAt).toBeDefined()
    })

    test('auto-generates ID if not provided', async ({ request }) => {
      const response = await request.post(`${GRAPH_API}/things`, {
        data: {
          type: 'Product',
          data: {
            name: 'Widget',
            price: 29.99,
          },
        },
      })

      expect(response.status()).toBe(201)
      const created = await response.json()

      expect(created.id).toBeDefined()
      expect(created.id.length).toBeGreaterThan(0)
      expect(created.type).toBe('Product')
    })

    test('rejects duplicate Thing ID', async ({ request }) => {
      const thingId = uniqueId('dup')

      // Create first
      await request.post(`${GRAPH_API}/things`, {
        data: {
          id: thingId,
          type: 'Test',
          data: { name: 'First' },
        },
      })

      // Try duplicate
      const response = await request.post(`${GRAPH_API}/things`, {
        data: {
          id: thingId,
          type: 'Test',
          data: { name: 'Duplicate' },
        },
      })

      expect(response.status()).toBe(409)
    })

    test('validates required fields', async ({ request }) => {
      const response = await request.post(`${GRAPH_API}/things`, {
        data: {
          // Missing type
          data: { name: 'Invalid' },
        },
      })

      expect(response.status()).toBe(400)
    })
  })

  test.describe('Read Thing', () => {
    test('retrieves Thing by ID', async ({ request }) => {
      const thingId = uniqueId('read-test')

      // Create
      await request.post(`${GRAPH_API}/things`, {
        data: {
          id: thingId,
          type: 'Customer',
          data: { name: 'Bob', tier: 'premium' },
        },
      })

      // Read
      const response = await request.get(`${GRAPH_API}/things/${thingId}`)

      expect(response.ok()).toBe(true)
      const thing = await response.json()

      expect(thing.id).toBe(thingId)
      expect(thing.type).toBe('Customer')
      expect(thing.data.name).toBe('Bob')
      expect(thing.data.tier).toBe('premium')
    })

    test('returns 404 for non-existent Thing', async ({ request }) => {
      const response = await request.get(`${GRAPH_API}/things/non-existent-${Date.now()}`)

      expect(response.status()).toBe(404)
    })

    test('lists Things by type', async ({ request }) => {
      const prefix = uniqueId('list')

      // Create multiple Things of same type
      for (let i = 0; i < 3; i++) {
        await request.post(`${GRAPH_API}/things`, {
          data: {
            id: `${prefix}-order-${i}`,
            type: 'Order',
            data: { amount: (i + 1) * 100, status: 'pending' },
          },
        })
      }

      // List by type
      const response = await request.get(`${GRAPH_API}/things?type=Order`)

      expect(response.ok()).toBe(true)
      const result = await response.json()

      expect(result.items).toBeDefined()
      expect(Array.isArray(result.items)).toBe(true)
      expect(result.items.length).toBeGreaterThanOrEqual(3)
    })

    test('supports pagination', async ({ request }) => {
      const prefix = uniqueId('page')

      // Create 5 Things
      for (let i = 0; i < 5; i++) {
        await request.post(`${GRAPH_API}/things`, {
          data: {
            id: `${prefix}-item-${i}`,
            type: 'PaginationTest',
            data: { index: i },
          },
        })
      }

      // Get first page
      const page1 = await request.get(`${GRAPH_API}/things?type=PaginationTest&limit=2`)
      expect(page1.ok()).toBe(true)
      const result1 = await page1.json()

      expect(result1.items.length).toBe(2)
      expect(result1.cursor).toBeDefined()

      // Get second page
      const page2 = await request.get(`${GRAPH_API}/things?type=PaginationTest&limit=2&cursor=${result1.cursor}`)
      expect(page2.ok()).toBe(true)
      const result2 = await page2.json()

      expect(result2.items.length).toBe(2)
    })
  })

  test.describe('Update Thing', () => {
    test('updates Thing data', async ({ request }) => {
      const thingId = uniqueId('update')

      // Create
      await request.post(`${GRAPH_API}/things`, {
        data: {
          id: thingId,
          type: 'Profile',
          data: { name: 'Charlie', status: 'active' },
        },
      })

      // Update
      const response = await request.patch(`${GRAPH_API}/things/${thingId}`, {
        data: {
          data: { status: 'inactive', reason: 'vacation' },
        },
      })

      expect(response.ok()).toBe(true)
      const updated = await response.json()

      expect(updated.data.name).toBe('Charlie') // Preserved
      expect(updated.data.status).toBe('inactive') // Updated
      expect(updated.data.reason).toBe('vacation') // Added
      expect(updated.updatedAt).toBeGreaterThan(updated.createdAt)
    })

    test('replaces Thing with PUT', async ({ request }) => {
      const thingId = uniqueId('replace')

      // Create
      await request.post(`${GRAPH_API}/things`, {
        data: {
          id: thingId,
          type: 'Config',
          data: { key1: 'value1', key2: 'value2' },
        },
      })

      // Replace
      const response = await request.put(`${GRAPH_API}/things/${thingId}`, {
        data: {
          type: 'Config',
          data: { key1: 'newValue' }, // key2 should be gone
        },
      })

      expect(response.ok()).toBe(true)
      const replaced = await response.json()

      expect(replaced.data.key1).toBe('newValue')
      expect(replaced.data.key2).toBeUndefined()
    })

    test('returns 404 when updating non-existent Thing', async ({ request }) => {
      const response = await request.patch(`${GRAPH_API}/things/non-existent-${Date.now()}`, {
        data: {
          data: { foo: 'bar' },
        },
      })

      expect(response.status()).toBe(404)
    })
  })

  test.describe('Delete Thing', () => {
    test('deletes Thing by ID', async ({ request }) => {
      const thingId = uniqueId('delete')

      // Create
      await request.post(`${GRAPH_API}/things`, {
        data: {
          id: thingId,
          type: 'Temporary',
          data: { name: 'ToDelete' },
        },
      })

      // Delete
      const deleteResponse = await request.delete(`${GRAPH_API}/things/${thingId}`)
      expect(deleteResponse.status()).toBe(204)

      // Verify gone
      const getResponse = await request.get(`${GRAPH_API}/things/${thingId}`)
      expect(getResponse.status()).toBe(404)
    })

    test('deleting Thing cascades to relationships', async ({ request }) => {
      const sourceId = uniqueId('cascade-source')
      const targetId = uniqueId('cascade-target')

      // Create two Things
      await request.post(`${GRAPH_API}/things`, {
        data: { id: sourceId, type: 'CascadeSource', data: {} },
      })
      await request.post(`${GRAPH_API}/things`, {
        data: { id: targetId, type: 'CascadeTarget', data: {} },
      })

      // Create relationship
      const relResponse = await request.post(`${GRAPH_API}/relationships`, {
        data: {
          from: sourceId,
          to: targetId,
          verb: 'connects',
        },
      })
      expect(relResponse.ok()).toBe(true)
      const rel = await relResponse.json()

      // Delete source Thing
      await request.delete(`${GRAPH_API}/things/${sourceId}`)

      // Verify relationship is gone
      const relGetResponse = await request.get(`${GRAPH_API}/relationships/${rel.id}`)
      expect(relGetResponse.status()).toBe(404)
    })

    test('returns 404 when deleting non-existent Thing', async ({ request }) => {
      const response = await request.delete(`${GRAPH_API}/things/non-existent-${Date.now()}`)

      expect(response.status()).toBe(404)
    })
  })
})

test.describe('Graph CRUD - Relationships (Edges)', () => {
  let sourceId: string
  let targetId: string

  test.beforeAll(async ({ request }) => {
    // Create source and target Things for relationship tests
    sourceId = uniqueId('rel-source')
    targetId = uniqueId('rel-target')

    await request.post(`${GRAPH_API}/things`, {
      data: { id: sourceId, type: 'Employee', data: { name: 'Alice' } },
    })
    await request.post(`${GRAPH_API}/things`, {
      data: { id: targetId, type: 'Company', data: { name: 'Acme Inc' } },
    })
  })

  test.describe('Create Relationship', () => {
    test('creates relationship between Things', async ({ request }) => {
      const response = await request.post(`${GRAPH_API}/relationships`, {
        data: {
          from: sourceId,
          to: targetId,
          verb: 'worksAt',
          data: { since: 2020, role: 'Engineer' },
        },
      })

      expect(response.status()).toBe(201)
      const rel = await response.json()

      expect(rel.id).toBeDefined()
      expect(rel.from).toBe(sourceId)
      expect(rel.to).toBe(targetId)
      expect(rel.verb).toBe('worksAt')
      expect(rel.data.since).toBe(2020)
      expect(rel.data.role).toBe('Engineer')
    })

    test('rejects relationship with non-existent source', async ({ request }) => {
      const response = await request.post(`${GRAPH_API}/relationships`, {
        data: {
          from: 'non-existent-source',
          to: targetId,
          verb: 'invalid',
        },
      })

      expect(response.status()).toBe(404)
    })

    test('rejects relationship with non-existent target', async ({ request }) => {
      const response = await request.post(`${GRAPH_API}/relationships`, {
        data: {
          from: sourceId,
          to: 'non-existent-target',
          verb: 'invalid',
        },
      })

      expect(response.status()).toBe(404)
    })

    test('allows self-referential relationships', async ({ request }) => {
      const selfId = uniqueId('self-ref')
      await request.post(`${GRAPH_API}/things`, {
        data: { id: selfId, type: 'Agent', data: { name: 'Self' } },
      })

      const response = await request.post(`${GRAPH_API}/relationships`, {
        data: {
          from: selfId,
          to: selfId,
          verb: 'monitors',
        },
      })

      expect(response.status()).toBe(201)
    })

    test('allows multiple relationships between same Things', async ({ request }) => {
      const response = await request.post(`${GRAPH_API}/relationships`, {
        data: {
          from: sourceId,
          to: targetId,
          verb: 'manages', // Different verb from worksAt
          data: { department: 'Engineering' },
        },
      })

      expect(response.status()).toBe(201)
    })
  })

  test.describe('Query Relationships', () => {
    test('queries relationships by verb', async ({ request }) => {
      const response = await request.get(`${GRAPH_API}/relationships?verb=worksAt`)

      expect(response.ok()).toBe(true)
      const result = await response.json()

      expect(result.items).toBeDefined()
      expect(result.items.every((r: { verb: string }) => r.verb === 'worksAt')).toBe(true)
    })

    test('queries relationships from a Thing', async ({ request }) => {
      const response = await request.get(`${GRAPH_API}/relationships?from=${sourceId}`)

      expect(response.ok()).toBe(true)
      const result = await response.json()

      expect(result.items.every((r: { from: string }) => r.from === sourceId)).toBe(true)
    })

    test('queries relationships to a Thing', async ({ request }) => {
      const response = await request.get(`${GRAPH_API}/relationships?to=${targetId}`)

      expect(response.ok()).toBe(true)
      const result = await response.json()

      expect(result.items.every((r: { to: string }) => r.to === targetId)).toBe(true)
    })

    test('combines query parameters', async ({ request }) => {
      const response = await request.get(`${GRAPH_API}/relationships?from=${sourceId}&verb=worksAt`)

      expect(response.ok()).toBe(true)
      const result = await response.json()

      expect(result.items.every((r: { from: string; verb: string }) => r.from === sourceId && r.verb === 'worksAt')).toBe(true)
    })
  })

  test.describe('Update Relationship', () => {
    test('updates relationship data', async ({ request }) => {
      // Create a relationship to update
      const createResponse = await request.post(`${GRAPH_API}/relationships`, {
        data: {
          from: sourceId,
          to: targetId,
          verb: 'collaborates',
          data: { project: 'Alpha' },
        },
      })
      const rel = await createResponse.json()

      // Update it
      const updateResponse = await request.patch(`${GRAPH_API}/relationships/${rel.id}`, {
        data: {
          data: { project: 'Beta', status: 'active' },
        },
      })

      expect(updateResponse.ok()).toBe(true)
      const updated = await updateResponse.json()

      expect(updated.data.project).toBe('Beta')
      expect(updated.data.status).toBe('active')
    })
  })

  test.describe('Delete Relationship', () => {
    test('deletes relationship by ID', async ({ request }) => {
      // Create
      const createResponse = await request.post(`${GRAPH_API}/relationships`, {
        data: {
          from: sourceId,
          to: targetId,
          verb: 'tempConnection',
        },
      })
      const rel = await createResponse.json()

      // Delete
      const deleteResponse = await request.delete(`${GRAPH_API}/relationships/${rel.id}`)
      expect(deleteResponse.status()).toBe(204)

      // Verify gone
      const getResponse = await request.get(`${GRAPH_API}/relationships/${rel.id}`)
      expect(getResponse.status()).toBe(404)
    })
  })
})
