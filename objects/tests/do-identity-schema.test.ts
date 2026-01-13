/**
 * DO Identity and Schema Auto-Creation Tests (RED Phase)
 *
 * These tests verify that Durable Objects correctly:
 * 1. Derive $id from the request URL hostname
 * 2. Derive ns from the request URL hostname
 * 3. Auto-create SQLite schema tables on first access
 * 4. Persist and retrieve data correctly
 *
 * IMPORTANT: These tests use REAL miniflare DOs with SQLite storage.
 * NO MOCKS are used - this tests the actual DO behavior.
 *
 * Known issues being tested (expected to FAIL):
 * - DO doesn't derive $id/ns from request URL
 * - Schema tables are never auto-created
 * - "Best effort" pattern silently swallows errors
 *
 * Run with: npx vitest run objects/tests/do-identity-schema.test.ts --project=do-identity
 *
 * INFRASTRUCTURE NOTE:
 * As of 2026-01-13, @cloudflare/vitest-pool-workers@0.12.x is incompatible
 * with vitest@3.x due to '@vitest/expect' customMatchers export issue.
 * These tests will fail to run until the package is updated.
 *
 * @module objects/tests/do-identity-schema.test
 */

import { env, SELF } from 'cloudflare:test'
import { describe, it, expect, beforeEach } from 'vitest'

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
  return SELF.fetch(`https://${ns}.api.dotdo.dev${path}`, {
    ...init,
    headers: {
      'X-DO-NS': ns,
      ...init?.headers,
    },
  })
}

/**
 * Helper to make requests directly to DO stub without X-DO-NS header
 * This tests URL-based identity derivation
 */
async function doFetchDirect(
  ns: string,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const hostname = `${ns}.api.dotdo.dev`
  return SELF.fetch(`https://${hostname}${path}`, init)
}

// ============================================================================
// DO Identity Tests
// ============================================================================

describe('DO Identity Derivation', () => {
  /**
   * RED TEST: DO should derive $id from request URL hostname
   *
   * Expected behavior:
   * - When a request comes to https://acme.api.dotdo.dev/
   * - The DO should set $id to 'https://acme.api.dotdo.dev'
   * - This should happen automatically without X-DO-NS header
   *
   * Current behavior (expected to fail):
   * - $id is not derived from URL
   * - Requires explicit initialization or X-DO-NS header
   */
  it('derives $id from request URL hostname', async () => {
    const ns = uniqueNs('identity')
    const res = await doFetchDirect(ns, '/')

    expect(res.status).toBe(200)

    const body = await res.json() as {
      $id?: string
      $type?: string
    }

    // $id should be the full URL origin
    expect(body.$id).toBe(`https://${ns}.api.dotdo.dev`)
  })

  /**
   * RED TEST: DO should derive ns from request URL hostname
   *
   * Expected behavior:
   * - When a request comes to https://acme.api.dotdo.dev/
   * - The DO's ns property should be set to 'acme' (the subdomain)
   * - This should happen automatically from URL parsing
   *
   * Current behavior (expected to fail):
   * - ns is empty string or requires explicit initialization
   * - Needs X-DO-NS header to set ns
   */
  it('derives ns from hostname', async () => {
    const ns = uniqueNs('ns-derive')
    const res = await doFetchDirect(ns, '/')

    expect(res.status).toBe(200)

    const body = await res.json() as {
      ns?: string
    }

    // ns should be the namespace (subdomain portion)
    expect(body.ns).toBe(ns)
  })

  /**
   * RED TEST: DO should persist derived identity
   *
   * Expected behavior:
   * - After first request, identity should be persisted
   * - Subsequent requests should return the same identity
   * - Even without headers, identity should be consistent
   *
   * Current behavior (expected to fail):
   * - Identity not persisted automatically
   * - May return different values on subsequent requests
   */
  it('persists derived identity across requests', async () => {
    const ns = uniqueNs('persist-id')

    // First request - should derive and persist identity
    const res1 = await doFetchDirect(ns, '/')
    const body1 = await res1.json() as { $id?: string; ns?: string }

    // Second request - should return same identity
    const res2 = await doFetchDirect(ns, '/')
    const body2 = await res2.json() as { $id?: string; ns?: string }

    expect(body1.$id).toBe(body2.$id)
    expect(body1.ns).toBe(body2.ns)
    expect(body1.$id).toBe(`https://${ns}.api.dotdo.dev`)
  })

  /**
   * RED TEST: Different hostnames should yield different identities
   *
   * Expected behavior:
   * - Request to https://acme.api.dotdo.dev → $id: https://acme.api.dotdo.dev
   * - Request to https://beta.api.dotdo.dev → $id: https://beta.api.dotdo.dev
   *
   * Current behavior (expected to fail):
   * - All requests may return same $id
   * - Identity not derived from URL
   */
  it('different hostnames yield different identities', async () => {
    const ns1 = uniqueNs('host1')
    const ns2 = uniqueNs('host2')

    const res1 = await doFetchDirect(ns1, '/')
    const body1 = await res1.json() as { $id?: string }

    const res2 = await doFetchDirect(ns2, '/')
    const body2 = await res2.json() as { $id?: string }

    expect(body1.$id).not.toBe(body2.$id)
    expect(body1.$id).toContain(ns1)
    expect(body2.$id).toContain(ns2)
  })
})

// ============================================================================
// Schema Auto-Creation Tests
// ============================================================================

describe('Schema Auto-Creation', () => {
  /**
   * RED TEST: Schema tables should be created on first access
   *
   * Expected behavior:
   * - When POST /customers is called for the first time
   * - The DO should automatically create the 'things' table
   * - The request should succeed with 201
   *
   * Current behavior (expected to fail):
   * - Tables not created automatically
   * - First POST may fail with SQL error
   * - "Best effort" pattern may swallow the error
   */
  it('creates tables on first access', async () => {
    const ns = uniqueNs('fresh-org')
    const res = await doFetch(ns, '/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alice' }),
    })

    // Should succeed - tables auto-created
    expect(res.status).toBe(201)

    const body = await res.json() as {
      $id?: string
      $type?: string
      name?: string
    }

    expect(body.$type).toBe('Customer')
    expect(body.name).toBe('Alice')
  })

  /**
   * RED TEST: Data should persist and be retrievable
   *
   * Expected behavior:
   * - POST creates a customer → returns 201 with $id
   * - GET self link → returns 200 with same data
   *
   * Current behavior (expected to fail):
   * - May fail to retrieve due to schema issues
   * - branch query bug: `branch = ${null}` instead of `branch IS NULL`
   */
  it('persists and retrieves', async () => {
    const ns = uniqueNs('persist-test')

    // Create
    const createRes = await doFetch(ns, '/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Bob', email: 'bob@example.com' }),
    })

    expect(createRes.status).toBe(201)

    const created = await createRes.json() as {
      $id: string
      name: string
      links?: { self?: string }
    }

    expect(created.name).toBe('Bob')
    expect(created.$id).toBeDefined()

    // Get by self link - use links.self if available, otherwise construct from $id
    const selfUrl = created.links?.self ?? created.$id
    const getRes = await doFetch(ns, selfUrl)

    expect(getRes.status).toBe(200)

    const retrieved = await getRes.json() as {
      name: string
      email: string
    }

    expect(retrieved.name).toBe('Bob')
    expect(retrieved.email).toBe('bob@example.com')
  })

  /**
   * RED TEST: Multiple types should be isolated
   *
   * Expected behavior:
   * - Create customer → isolated to customers collection
   * - Create order → isolated to orders collection
   * - List customers → only shows customers
   *
   * Current behavior (expected to fail):
   * - Schema may not support multiple types
   * - Type isolation may not work
   */
  it('isolates data by type', async () => {
    const ns = uniqueNs('type-isolation')

    // Create a customer
    const custRes = await doFetch(ns, '/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Customer One' }),
    })
    expect(custRes.status).toBe(201)

    // Create an order
    const orderRes = await doFetch(ns, '/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: 'Widget', qty: 5 }),
    })
    expect(orderRes.status).toBe(201)

    // List customers - should only have 1
    const listCustRes = await doFetch(ns, '/customers')
    const custList = await listCustRes.json() as { total: number; items: unknown[] }

    expect(custList.total).toBe(1)
    expect(custList.items.length).toBe(1)

    // List orders - should only have 1
    const listOrderRes = await doFetch(ns, '/orders')
    const orderList = await listOrderRes.json() as { total: number; items: unknown[] }

    expect(orderList.total).toBe(1)
    expect(orderList.items.length).toBe(1)
  })

  /**
   * RED TEST: Schema should support all CRUD operations
   *
   * Expected behavior:
   * - CREATE → 201
   * - READ → 200
   * - UPDATE → 200
   * - DELETE → 204
   *
   * Current behavior (expected to fail):
   * - One or more operations may fail
   * - Schema may not support all operations
   */
  it('supports full CRUD lifecycle', async () => {
    const ns = uniqueNs('crud-lifecycle')

    // 1. CREATE
    const createRes = await doFetch(ns, '/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Widget', price: 9.99 }),
    })
    expect(createRes.status).toBe(201)

    const created = await createRes.json() as { $id: string }

    // 2. READ
    const readRes = await doFetch(ns, created.$id)
    expect(readRes.status).toBe(200)

    const read = await readRes.json() as { name: string; price: number }
    expect(read.name).toBe('Widget')
    expect(read.price).toBe(9.99)

    // 3. UPDATE (PUT)
    const updateRes = await doFetch(ns, created.$id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Super Widget', price: 19.99 }),
    })
    expect(updateRes.status).toBe(200)

    const updated = await updateRes.json() as { name: string; price: number }
    expect(updated.name).toBe('Super Widget')
    expect(updated.price).toBe(19.99)

    // 4. DELETE
    const deleteRes = await doFetch(ns, created.$id, {
      method: 'DELETE',
    })
    expect(deleteRes.status).toBe(204)

    // Verify deleted
    const verifyRes = await doFetch(ns, created.$id)
    expect(verifyRes.status).toBe(404)
  })
})

// ============================================================================
// Error Handling Tests (Anti-Best-Effort)
// ============================================================================

describe('Error Surfacing (Anti-Best-Effort)', () => {
  /**
   * RED TEST: Errors should be surfaced, not swallowed
   *
   * Expected behavior:
   * - Invalid operations should return proper error responses
   * - Error details should be visible to the caller
   * - No silent failures
   *
   * Current behavior (expected to fail):
   * - "Best effort" pattern may swallow errors
   * - Operations may appear successful when they failed
   */
  it('surfaces errors for invalid operations', async () => {
    const ns = uniqueNs('error-surface')

    // Try to GET a non-existent item
    const res = await doFetch(ns, '/customers/non-existent-id')

    // Should return 404 with error details
    expect(res.status).toBe(404)

    const body = await res.json() as {
      code?: string
      error?: string
      $type?: string
    }

    // Should have error information, not empty response
    expect(body.code).toBe('NOT_FOUND')
  })

  /**
   * RED TEST: Invalid JSON should return 400, not be swallowed
   *
   * Expected behavior:
   * - POST with invalid JSON → 400 Bad Request
   * - Error message should explain the problem
   *
   * Current behavior (expected to fail):
   * - May silently fail or return 500
   * - Error may not be informative
   */
  it('returns 400 for invalid JSON', async () => {
    const ns = uniqueNs('invalid-json')

    const res = await doFetch(ns, '/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not valid json {{{',
    })

    expect(res.status).toBe(400)

    const body = await res.json() as { code?: string; error?: string }
    expect(body.code).toBeDefined()
  })

  /**
   * RED TEST: Schema creation failures should be surfaced
   *
   * Expected behavior:
   * - If schema creation fails, error should be returned
   * - Should not silently proceed with broken state
   *
   * Current behavior (expected to fail):
   * - Schema errors may be caught and ignored
   * - Subsequent operations may fail mysteriously
   */
  it('surfaces schema creation failures', async () => {
    const ns = uniqueNs('schema-failure')

    // First request should either:
    // 1. Succeed (schema created) → 200/201
    // 2. Fail with clear error → 500 with schema error details
    // Should NOT: return 200 with empty/undefined data

    const res = await doFetch(ns, '/')

    expect(res.status).toBe(200)

    const body = await res.json() as {
      $id?: string
      ns?: string
      collections?: Record<string, unknown>
    }

    // If successful, should have proper structure
    expect(body.$id).toBeDefined()
    expect(body.ns).toBeDefined()
    expect(body.collections).toBeDefined()
  })
})
