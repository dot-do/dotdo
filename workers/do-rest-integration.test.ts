/**
 * DOBase REST Router Integration Tests
 *
 * Tests the REST router with real Durable Object SQLite storage using
 * @cloudflare/vitest-pool-workers. Verifies full CRUD lifecycle,
 * JSON-LD formatting, and error handling with actual persistence.
 *
 * KNOWN ISSUE: ThingsStore.get() has a bug where it uses `branch = ${null}`
 * instead of `branch IS NULL` in SQL, causing queries to fail for main branch.
 * Tests that read data after writing are currently expected to fail until
 * this is fixed in db/stores.ts.
 *
 * @module workers/do-rest-integration.test
 */

import { env, SELF } from 'cloudflare:test'
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Unique namespace per test suite run to ensure isolation
 */
const testRunId = Date.now()

/**
 * Generate a unique namespace for each test to ensure isolation
 */
function uniqueNs(prefix: string = 'test'): string {
  return `${prefix}-${testRunId}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Helper to make requests to the DO via SELF
 */
function doFetch(
  ns: string,
  path: string,
  init?: RequestInit
): Promise<Response> {
  return SELF.fetch(`https://test.do${path}`, {
    ...init,
    headers: {
      'X-DO-NS': ns,
      ...init?.headers,
    },
  })
}

/**
 * Helper to fetch a full URL link (like $id or links.self)
 * Unlike doFetch, this takes a full URL and passes it directly
 */
function fetchLink(url: string, ns: string, init?: RequestInit): Promise<Response> {
  return SELF.fetch(url, {
    ...init,
    headers: {
      'X-DO-NS': ns,
      ...init?.headers,
    },
  })
}

// ============================================================================
// Index Endpoint Tests
// ============================================================================

describe('REST Router Integration (Real DO Storage)', () => {
  describe('GET / - Index Endpoint', () => {
    it('returns JSON-LD index with $context and $type', async () => {
      const ns = uniqueNs('index')
      const res = await doFetch(ns, '/')

      expect(res.status).toBe(200)

      const body = await res.json() as {
        $context?: string
        $type?: string
        ns?: string
        collections?: Record<string, unknown>
      }

      expect(body.$context).toBeDefined()
      // $type is the namespace URL itself for the root resource (JSON-LD convention)
      expect(body.$type).toBe('https://test.do')
      expect(body.ns).toBeDefined()
      expect(body.collections).toBeDefined()
    })

    it('returns collections for registered nouns', async () => {
      const ns = uniqueNs('index-nouns')
      const res = await doFetch(ns, '/')

      expect(res.status).toBe(200)

      const body = await res.json() as {
        collections: Record<string, { $id: string; $type: string }>
      }

      // TestDO registers customers, orders, products, users, items, tasks
      expect(body.collections.customers).toBeDefined()
      expect(body.collections.orders).toBeDefined()
      expect(body.collections.customers.$type).toBe('Collection')
    })

    it('accepts application/ld+json content type', async () => {
      const ns = uniqueNs('content-type')
      const res = await doFetch(ns, '/', {
        headers: { 'Accept': 'application/ld+json' },
      })

      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toContain('application/ld+json')
    })
  })

  // ============================================================================
  // Create (POST) Tests
  // ============================================================================

  describe('POST /:type - Create', () => {
    it('creates thing with generated $id', async () => {
      const ns = uniqueNs('create')
      const res = await doFetch(ns, '/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Acme Corp', email: 'test@acme.com' }),
      })

      expect(res.status).toBe(201)

      const body = await res.json() as {
        $id: string
        $type: string
        name: string
        email: string
      }

      // Full URL format for JSON-LD compatibility
      expect(body.$id).toMatch(/^https:\/\/test\.do\/customers\//)
      // $type is also a URL for JSON-LD (the collection URL represents the type)
      expect(body.$type).toBe('https://test.do/customers')
      expect(body.name).toBe('Acme Corp')
      expect(body.email).toBe('test@acme.com')
    })

    it('creates thing with custom $id', async () => {
      const ns = uniqueNs('create-custom-id')
      const customId = `cust-${Date.now()}`

      const res = await doFetch(ns, '/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Note: $id should be just the id portion, not the full path
          // The REST router formats it as /customers/{id} in the response
          $id: customId,
          name: 'Custom ID Corp',
        }),
      })

      expect(res.status).toBe(201)

      const body = await res.json() as { $id: string }
      // Full URL format for JSON-LD compatibility
      expect(body.$id).toBe(`https://test.do/customers/${customId}`)
    })

    it('returns 201 with Location header', async () => {
      const ns = uniqueNs('create-location')
      const res = await doFetch(ns, '/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Header Test Corp' }),
      })

      expect(res.status).toBe(201)
      // Location header contains full URL
      expect(res.headers.get('Location')).toMatch(/^https:\/\/test\.do\/customers\//)
    })

    // KNOWN BUG: Duplicate check depends on ThingsStore.get which has branch query bug
    it('returns 409 for duplicate $id', async () => {
      const ns = uniqueNs('duplicate')
      const customId = `dup-${Date.now()}`

      // First create succeeds
      const res1 = await doFetch(ns, '/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Just the id portion, not the full path
          $id: customId,
          name: 'First',
        }),
      })
      expect(res1.status).toBe(201)

      // Second create with same ID should fail
      const res2 = await doFetch(ns, '/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          $id: customId,
          name: 'Second',
        }),
      })
      expect(res2.status).toBe(409)

      const body = await res2.json() as { code: string }
      expect(body.code).toBe('DUPLICATE')
    })

    it('returns 400 for invalid JSON', async () => {
      const ns = uniqueNs('invalid-json')
      const res = await doFetch(ns, '/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json',
      })

      expect(res.status).toBe(400)
    })

    it('returns 415 for unsupported Content-Type', async () => {
      const ns = uniqueNs('unsupported-type')
      const res = await doFetch(ns, '/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: 'name=test',
      })

      expect(res.status).toBe(415)
    })
  })

  // ============================================================================
  // Read (GET) Tests
  // ============================================================================

  describe('GET /:type/:id - Read', () => {
    // KNOWN BUG: ThingsStore.get uses `branch = ${null}` which doesn't work in SQL
    // This test documents the expected behavior once the bug is fixed
    it('retrieves created thing by id', async () => {
      const ns = uniqueNs('read')

      // Create
      const createRes = await doFetch(ns, '/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Co', industry: 'Tech' }),
      })
      expect(createRes.status).toBe(201)

      const created = await createRes.json() as { $id: string }

      // Read by fetching the $id link (full URL)
      const readRes = await fetchLink(created.$id, ns)
      expect(readRes.status).toBe(200)

      const read = await readRes.json() as {
        $id: string
        name: string
        industry: string
      }
      expect(read.$id).toBe(created.$id)
      expect(read.name).toBe('Test Co')
      expect(read.industry).toBe('Tech')
    })

    it('returns 404 for non-existent id', async () => {
      const ns = uniqueNs('read-404')
      const res = await doFetch(ns, '/customers/non-existent-id')

      expect(res.status).toBe(404)

      const body = await res.json() as { code: string }
      expect(body.code).toBe('NOT_FOUND')
    })

    it('returns 404 when type does not match', async () => {
      const ns = uniqueNs('read-type-mismatch')

      // Create a customer
      const createRes = await doFetch(ns, '/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test' }),
      })
      const created = await createRes.json() as { $id: string }
      const id = created.$id.split('/').pop()

      // Try to read as order (should fail)
      const readRes = await doFetch(ns, `/orders/${id}`)
      expect(readRes.status).toBe(404)
    })
  })

  // ============================================================================
  // List (GET Collection) Tests
  // ============================================================================

  describe('GET /:type - List', () => {
    it('returns empty collection initially', async () => {
      const ns = uniqueNs('list-empty')
      const res = await doFetch(ns, '/customers')

      expect(res.status).toBe(200)

      const body = await res.json() as {
        $type: string
        items: unknown[]
        total: number
      }

      // $type is the collection URL (JSON-LD convention)
      expect(body.$type).toBe('https://test.do/customers')
      expect(body.items).toEqual([])
      // 'count' is the standard field name
      expect(body.count).toBe(0)
    })

    it('returns created items in collection', async () => {
      const ns = uniqueNs('list-items')

      // Create multiple items
      await doFetch(ns, '/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Customer A' }),
      })
      await doFetch(ns, '/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Customer B' }),
      })

      // List
      const res = await doFetch(ns, '/customers')
      expect(res.status).toBe(200)

      const body = await res.json() as {
        items: Array<{ name: string }>
        total: number
      }

      expect(body.items.length).toBe(2)
      // 'count' is the standard field name
      expect(body.count).toBe(2)
    })

    it('supports limit query parameter', async () => {
      const ns = uniqueNs('list-limit')

      // Create 5 items
      for (let i = 0; i < 5; i++) {
        await doFetch(ns, '/products', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: `Product ${i}` }),
        })
      }

      // List with limit
      const res = await doFetch(ns, '/products?limit=3')
      expect(res.status).toBe(200)

      const body = await res.json() as { items: unknown[] }
      expect(body.items.length).toBe(3)
    })
  })

  // ============================================================================
  // Update (PUT/PATCH) Tests
  // ============================================================================

  describe('PUT /:type/:id - Replace', () => {
    // KNOWN BUG: PUT depends on ThingsStore.get which has branch query bug
    it('replaces thing data', async () => {
      const ns = uniqueNs('put')

      // Create
      const createRes = await doFetch(ns, '/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: 'Widget', qty: 5, status: 'pending' }),
      })
      const created = await createRes.json() as { $id: string }

      // Replace
      const updateRes = await fetchLink(created.$id, ns, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: 'Widget', qty: 10, status: 'confirmed' }),
      })
      expect(updateRes.status).toBe(200)

      const updated = await updateRes.json() as {
        qty: number
        status: string
      }
      expect(updated.qty).toBe(10)
      expect(updated.status).toBe('confirmed')
    })

    it('returns 404 for non-existent id', async () => {
      const ns = uniqueNs('put-404')
      const res = await doFetch(ns, '/orders/non-existent', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: 'Test' }),
      })

      expect(res.status).toBe(404)
    })
  })

  describe('PATCH /:type/:id - Merge', () => {
    // KNOWN BUG: PATCH depends on ThingsStore.get which has branch query bug
    it('merges partial updates', async () => {
      const ns = uniqueNs('patch')

      // Create
      const createRes = await doFetch(ns, '/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: 'Gadget', qty: 3, color: 'blue' }),
      })
      const created = await createRes.json() as { $id: string }

      // Patch (only update qty)
      const patchRes = await fetchLink(created.$id, ns, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qty: 7 }),
      })
      expect(patchRes.status).toBe(200)

      // Verify merge
      const readRes = await fetchLink(created.$id, ns)
      const read = await readRes.json() as {
        item: string
        qty: number
        color: string
      }

      expect(read.item).toBe('Gadget')
      expect(read.qty).toBe(7)
      expect(read.color).toBe('blue')
    })
  })

  // ============================================================================
  // Delete Tests
  // ============================================================================

  describe('DELETE /:type/:id - Delete', () => {
    // KNOWN BUG: DELETE depends on ThingsStore.get which has branch query bug
    it('deletes existing thing', async () => {
      const ns = uniqueNs('delete')

      // Create
      const createRes = await doFetch(ns, '/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Task to delete' }),
      })
      const created = await createRes.json() as { $id: string }

      // Delete
      const deleteRes = await fetchLink(created.$id, ns, { method: 'DELETE' })
      expect(deleteRes.status).toBe(204)

      // Verify deleted
      const readRes = await fetchLink(created.$id, ns)
      expect(readRes.status).toBe(404)
    })

    it('returns 404 for non-existent id', async () => {
      const ns = uniqueNs('delete-404')
      const res = await doFetch(ns, '/tasks/non-existent', { method: 'DELETE' })

      expect(res.status).toBe(404)
    })
  })

  // ============================================================================
  // Full CRUD Lifecycle Tests
  // ============================================================================

  describe('Full CRUD Lifecycle', () => {
    // KNOWN BUG: Full lifecycle depends on ThingsStore.get which has branch query bug
    it('complete lifecycle works end-to-end', async () => {
      const ns = uniqueNs('lifecycle')

      // 1. Create
      const createRes = await doFetch(ns, '/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: 'Widget', qty: 5, status: 'new' }),
      })
      expect(createRes.status).toBe(201)

      const created = await createRes.json() as { $id: string; qty: number }
      expect(created.qty).toBe(5)

      // 2. Read
      const readRes = await fetchLink(created.$id, ns)
      expect(readRes.status).toBe(200)

      const read = await readRes.json() as { qty: number }
      expect(read.qty).toBe(5)

      // 3. Update
      const updateRes = await fetchLink(created.$id, ns, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: 'Widget', qty: 10, status: 'shipped' }),
      })
      expect(updateRes.status).toBe(200)

      const updated = await updateRes.json() as { qty: number; status: string }
      expect(updated.qty).toBe(10)
      expect(updated.status).toBe('shipped')

      // 4. Delete
      const deleteRes = await fetchLink(created.$id, ns, { method: 'DELETE' })
      expect(deleteRes.status).toBe(204)

      // 5. Verify deleted
      const verifyRes = await fetchLink(created.$id, ns)
      expect(verifyRes.status).toBe(404)
    })

    // KNOWN BUG: List depends on ThingsStore.list which has branch query bug
    it('operations on different types are isolated', async () => {
      const ns = uniqueNs('isolation')

      // Create customer
      const custRes = await doFetch(ns, '/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test Customer' }),
      })
      expect(custRes.status).toBe(201)

      // Create order
      const orderRes = await doFetch(ns, '/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item: 'Test Order' }),
      })
      expect(orderRes.status).toBe(201)

      // List customers - should only have 1
      const custListRes = await doFetch(ns, '/customers')
      const custList = await custListRes.json() as { total: number }
      expect(custList.count).toBe(1)

      // List orders - should only have 1
      const orderListRes = await doFetch(ns, '/orders')
      const orderList = await orderListRes.json() as { count: number }
      expect(orderList.count).toBe(1)
    })
  })

  // ============================================================================
  // Namespace Isolation Tests
  // ============================================================================

  describe('Namespace Isolation', () => {
    // KNOWN BUG: List depends on ThingsStore.list which has branch query bug
    it('different namespaces have isolated data', async () => {
      const ns1 = uniqueNs('ns1')
      const ns2 = uniqueNs('ns2')

      // Create in ns1
      const res1 = await doFetch(ns1, '/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'NS1 Customer' }),
      })
      expect(res1.status).toBe(201)

      // Create in ns2
      const res2 = await doFetch(ns2, '/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'NS2 Customer' }),
      })
      expect(res2.status).toBe(201)

      // List in ns1 - should only see ns1 customer
      const list1 = await doFetch(ns1, '/customers')
      const body1 = await list1.json() as { items: Array<{ name: string }> }
      expect(body1.items.length).toBe(1)
      expect(body1.items[0].name).toBe('NS1 Customer')

      // List in ns2 - should only see ns2 customer
      const list2 = await doFetch(ns2, '/customers')
      const body2 = await list2.json() as { items: Array<{ name: string }> }
      expect(body2.items.length).toBe(1)
      expect(body2.items[0].name).toBe('NS2 Customer')
    })
  })

  // ============================================================================
  // Health Endpoint Tests
  // ============================================================================

  describe('GET /health - Health Check', () => {
    it('returns ok status', async () => {
      const ns = uniqueNs('health')
      const res = await doFetch(ns, '/health')

      expect(res.status).toBe(200)

      const body = await res.json() as { status: string; ns: string }
      expect(body.status).toBe('ok')
      expect(body.ns).toBe(ns)
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('Edge Cases', () => {
    it('handles empty request body', async () => {
      const ns = uniqueNs('empty-body')
      const res = await doFetch(ns, '/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })

      expect(res.status).toBe(201)
    })

    it('handles special characters in data', async () => {
      const ns = uniqueNs('special-chars')
      const res = await doFetch(ns, '/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test "Quoted" Corp',
          notes: 'Line1\nLine2',
          emoji: 'Test 123',
        }),
      })

      expect(res.status).toBe(201)

      const body = await res.json() as { name: string }
      expect(body.name).toBe('Test "Quoted" Corp')
    })

    it('handles nested objects in data', async () => {
      const ns = uniqueNs('nested')
      const res = await doFetch(ns, '/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Nested Corp',
          address: {
            street: '123 Main St',
            city: 'Test City',
            zip: '12345',
          },
          tags: ['enterprise', 'tech'],
        }),
      })

      expect(res.status).toBe(201)

      const body = await res.json() as {
        address: { city: string }
        tags: string[]
      }
      expect(body.address.city).toBe('Test City')
      expect(body.tags).toContain('enterprise')
    })

    it('handles application/ld+json Content-Type', async () => {
      const ns = uniqueNs('ld-json')
      const res = await doFetch(ns, '/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/ld+json' },
        body: JSON.stringify({ name: 'LD+JSON Corp' }),
      })

      expect(res.status).toBe(201)
    })
  })
})
