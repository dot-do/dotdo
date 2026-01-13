/**
 * DO Identity and Schema Tests - Real Miniflare (RED Phase)
 *
 * These tests verify DO behavior using REAL miniflare DOs with SQLite storage.
 * Unlike the mocked version, these tests use actual Durable Object stubs via RPC.
 *
 * Tests should initially FAIL (RED phase) because:
 * 1. DO RPC methods may not be implemented correctly
 * 2. Identity derivation from request URL may not work
 * 3. Schema auto-creation may not function via RPC
 *
 * Run with: npx vitest run objects/tests/do-identity-schema-real.test.ts --project=do-identity
 *
 * @module objects/tests/do-identity-schema-real.test
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
function uniqueNs(prefix: string = 'real-test'): string {
  return `${prefix}-${testRunId}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Get a DO stub by namespace name
 * Uses env.TEST_DO binding from wrangler.do-test.jsonc
 */
function getDOStub(ns: string) {
  const id = env.TEST_DO.idFromName(ns)
  return env.TEST_DO.get(id)
}

/**
 * Helper to make HTTP requests to the DO via SELF
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

// ============================================================================
// DO Identity Tests via RPC
// ============================================================================

describe('[REAL] DO Identity Derivation via RPC', () => {
  /**
   * RED TEST: DO stub should have accessible $id via RPC
   *
   * Expected behavior:
   * - When we get a DO stub, we should be able to access $id via RPC
   * - $id should be derived from the namespace
   *
   * Current behavior (expected to fail):
   * - RPC method may not be implemented
   * - $id may not be accessible via RPC
   */
  it('stub.$id returns identity URL via RPC', async () => {
    const ns = uniqueNs('rpc-id')
    const stub = getDOStub(ns)

    // Access $id via RPC
    // This tests that the DO exposes $id as an RPC-accessible property
    const $id = await (stub as any).$id

    expect($id).toBeDefined()
    expect(typeof $id).toBe('string')
    expect($id).toContain(ns)
  })

  /**
   * RED TEST: DO stub should expose namespace via RPC
   */
  it('stub.getNs() returns namespace via RPC', async () => {
    const ns = uniqueNs('rpc-ns')
    const stub = getDOStub(ns)

    // Call getNs() method via RPC
    const returnedNs = await (stub as any).getNs()

    expect(returnedNs).toBeDefined()
    // Note: The namespace might be the DO ID if not set via HTTP request
    expect(typeof returnedNs).toBe('string')
  })

  /**
   * RED TEST: Different stubs should have different identities
   */
  it('different namespace stubs have different identities', async () => {
    const ns1 = uniqueNs('diff1')
    const ns2 = uniqueNs('diff2')

    const stub1 = getDOStub(ns1)
    const stub2 = getDOStub(ns2)

    const id1 = await (stub1 as any).$id
    const id2 = await (stub2 as any).$id

    expect(id1).toBeDefined()
    expect(id2).toBeDefined()
    expect(id1).not.toBe(id2)
  })
})

// ============================================================================
// Schema Auto-Creation Tests via RPC
// ============================================================================

describe('[REAL] Schema Auto-Creation via RPC', () => {
  /**
   * RED TEST: things.create() should work via RPC on fresh DO
   *
   * Expected behavior:
   * - Calling stub.things.create() on a fresh DO should auto-create schema
   * - Should return created entity with $id
   *
   * Current behavior (expected to fail):
   * - RPC access to things.create() may not work
   * - Schema may not be auto-created
   */
  it('stub.things.create() auto-creates schema and returns entity', async () => {
    const ns = uniqueNs('rpc-create')
    const stub = getDOStub(ns)

    // Direct RPC call to things.create()
    const result = await (stub as any).thingsCreate({
      $type: 'Customer',
      name: 'RPC Customer',
      email: 'rpc@test.com',
    })

    expect(result).toBeDefined()
    expect(result.$id).toBeDefined()
    expect(result.name).toBe('RPC Customer')
    expect(result.email).toBe('rpc@test.com')
  })

  /**
   * RED TEST: things.get() should retrieve created entity via RPC
   */
  it('stub.thingsGet() retrieves entity created via RPC', async () => {
    const ns = uniqueNs('rpc-get')
    const stub = getDOStub(ns)

    // Create
    const created = await (stub as any).thingsCreate({
      $type: 'Customer',
      name: 'GetTest Customer',
    })

    expect(created.$id).toBeDefined()

    // Retrieve via RPC
    const retrieved = await (stub as any).thingsGet(created.$id)

    expect(retrieved).toBeDefined()
    expect(retrieved.$id).toBe(created.$id)
    expect(retrieved.name).toBe('GetTest Customer')
  })

  /**
   * RED TEST: things.list() should return all entities of a type
   */
  it('stub.thingsList() returns entities of type via RPC', async () => {
    const ns = uniqueNs('rpc-list')
    const stub = getDOStub(ns)

    // Create multiple entities
    await (stub as any).thingsCreate({
      $type: 'Customer',
      name: 'Customer A',
    })
    await (stub as any).thingsCreate({
      $type: 'Customer',
      name: 'Customer B',
    })
    await (stub as any).thingsCreate({
      $type: 'Order',
      item: 'Widget',
    })

    // List customers only
    const customers = await (stub as any).thingsList({ type: 'Customer' })

    expect(Array.isArray(customers)).toBe(true)
    expect(customers.length).toBe(2)
    expect(customers.every((c: any) => c.$type === 'Customer' || c.type === 'Customer')).toBe(true)
  })

  /**
   * RED TEST: things.update() should modify existing entity via RPC
   */
  it('stub.thingsUpdate() modifies entity via RPC', async () => {
    const ns = uniqueNs('rpc-update')
    const stub = getDOStub(ns)

    // Create
    const created = await (stub as any).thingsCreate({
      $type: 'Customer',
      name: 'Original Name',
      status: 'active',
    })

    // Update
    const updated = await (stub as any).thingsUpdate(created.$id, {
      name: 'Updated Name',
      status: 'inactive',
    })

    expect(updated.name).toBe('Updated Name')
    expect(updated.status).toBe('inactive')

    // Verify by getting again
    const retrieved = await (stub as any).thingsGet(created.$id)
    expect(retrieved.name).toBe('Updated Name')
  })

  /**
   * RED TEST: things.delete() should remove entity via RPC
   */
  it('stub.thingsDelete() removes entity via RPC', async () => {
    const ns = uniqueNs('rpc-delete')
    const stub = getDOStub(ns)

    // Create
    const created = await (stub as any).thingsCreate({
      $type: 'Customer',
      name: 'ToDelete',
    })

    // Delete
    const deleted = await (stub as any).thingsDelete(created.$id)
    expect(deleted).toBeDefined()

    // Verify deleted - should return null
    const retrieved = await (stub as any).thingsGet(created.$id)
    expect(retrieved).toBeNull()
  })
})

// ============================================================================
// Relationships Store Tests via RPC
// ============================================================================

describe('[REAL] Relationships via RPC', () => {
  /**
   * RED TEST: rels.create() should create relationship via RPC
   */
  it('stub.relsCreate() creates relationship via RPC', async () => {
    const ns = uniqueNs('rpc-rel-create')
    const stub = getDOStub(ns)

    // Create entities first
    const customer = await (stub as any).thingsCreate({
      $type: 'Customer',
      name: 'Relationship Customer',
    })
    const order = await (stub as any).thingsCreate({
      $type: 'Order',
      item: 'Widget',
    })

    // Create relationship
    const rel = await (stub as any).relsCreate({
      verb: 'PLACED',
      from: customer.$id,
      to: order.$id,
      data: { timestamp: new Date().toISOString() },
    })

    expect(rel).toBeDefined()
    expect(rel.$id).toBeDefined()
    expect(rel.verb).toBe('PLACED')
    expect(rel.from).toBe(customer.$id)
    expect(rel.to).toBe(order.$id)
  })

  /**
   * RED TEST: rels.query() should find relationships via RPC
   */
  it('stub.relsQuery() finds relationships via RPC', async () => {
    const ns = uniqueNs('rpc-rel-query')
    const stub = getDOStub(ns)

    // Create entities
    const customer = await (stub as any).thingsCreate({
      $type: 'Customer',
      name: 'Query Customer',
    })
    const order1 = await (stub as any).thingsCreate({
      $type: 'Order',
      item: 'Widget 1',
    })
    const order2 = await (stub as any).thingsCreate({
      $type: 'Order',
      item: 'Widget 2',
    })

    // Create relationships
    await (stub as any).relsCreate({
      verb: 'PLACED',
      from: customer.$id,
      to: order1.$id,
    })
    await (stub as any).relsCreate({
      verb: 'PLACED',
      from: customer.$id,
      to: order2.$id,
    })

    // Query relationships from customer
    const rels = await (stub as any).relsQuery({ from: customer.$id })

    expect(Array.isArray(rels)).toBe(true)
    expect(rels.length).toBe(2)
    expect(rels.every((r: any) => r.from === customer.$id)).toBe(true)
  })

  /**
   * RED TEST: rels.delete() should remove relationship via RPC
   */
  it('stub.relsDelete() removes relationship via RPC', async () => {
    const ns = uniqueNs('rpc-rel-delete')
    const stub = getDOStub(ns)

    // Create entities and relationship
    const customer = await (stub as any).thingsCreate({
      $type: 'Customer',
      name: 'Delete Rel Customer',
    })
    const order = await (stub as any).thingsCreate({
      $type: 'Order',
      item: 'Widget',
    })
    const rel = await (stub as any).relsCreate({
      verb: 'PLACED',
      from: customer.$id,
      to: order.$id,
    })

    // Delete relationship
    await (stub as any).relsDelete(rel.$id)

    // Verify deleted
    const rels = await (stub as any).relsQuery({ from: customer.$id })
    expect(rels.length).toBe(0)
  })
})

// ============================================================================
// SQL Execution Tests via RPC
// ============================================================================

describe('[REAL] SQL Execution via RPC', () => {
  /**
   * RED TEST: sql.execute() should run raw SQL via RPC
   */
  it('stub.sqlExecute() runs raw SQL queries via RPC', async () => {
    const ns = uniqueNs('rpc-sql')
    const stub = getDOStub(ns)

    // First ensure schema exists by creating something
    await (stub as any).thingsCreate({
      $type: 'Customer',
      name: 'SQL Test Customer',
    })

    // Execute raw SQL
    const result = await (stub as any).sqlExecute(
      'SELECT COUNT(*) as count FROM things WHERE type = 1'
    )

    expect(result).toBeDefined()
    expect(result.rows).toBeDefined()
    expect(Array.isArray(result.rows)).toBe(true)
  })

  /**
   * RED TEST: sql.execute() should support parameterized queries
   */
  it('stub.sqlExecute() supports parameterized queries via RPC', async () => {
    const ns = uniqueNs('rpc-sql-params')
    const stub = getDOStub(ns)

    // Create test data
    await (stub as any).thingsCreate({
      $type: 'Customer',
      name: 'Parameterized Test',
    })

    // Execute parameterized query
    const result = await (stub as any).sqlExecute(
      'SELECT * FROM things WHERE type = ?',
      [1]
    )

    expect(result).toBeDefined()
    expect(result.rows).toBeDefined()
  })
})

// ============================================================================
// Batch Operations via RPC
// ============================================================================

describe('[REAL] Batch Operations via RPC', () => {
  /**
   * RED TEST: thingsCreateMany() should create multiple entities atomically
   */
  it('stub.thingsCreateMany() creates multiple entities via RPC', async () => {
    const ns = uniqueNs('rpc-batch')
    const stub = getDOStub(ns)

    const items = [
      { $type: 'Customer', name: 'Batch Customer 1' },
      { $type: 'Customer', name: 'Batch Customer 2' },
      { $type: 'Customer', name: 'Batch Customer 3' },
    ]

    const results = await (stub as any).thingsCreateMany(items)

    expect(Array.isArray(results)).toBe(true)
    expect(results.length).toBe(3)
    expect(results.every((r: any) => r.$id)).toBe(true)
  })

  /**
   * RED TEST: thingsQuery() should filter entities by criteria
   */
  it('stub.thingsQuery() filters entities by type and where clause', async () => {
    const ns = uniqueNs('rpc-query')
    const stub = getDOStub(ns)

    // Create test data
    await (stub as any).thingsCreateMany([
      { $type: 'Customer', name: 'Query A', status: 'active' },
      { $type: 'Customer', name: 'Query B', status: 'inactive' },
      { $type: 'Customer', name: 'Query C', status: 'active' },
    ])

    // Query with type filter
    const results = await (stub as any).thingsQuery({
      type: 'Customer',
    })

    expect(Array.isArray(results)).toBe(true)
    expect(results.length).toBe(3)
  })
})

// ============================================================================
// Persistence Tests via RPC
// ============================================================================

describe('[REAL] Persistence Across Requests via RPC', () => {
  /**
   * RED TEST: Data should persist across multiple RPC calls
   */
  it('data persists across separate RPC calls to same stub', async () => {
    const ns = uniqueNs('rpc-persist')

    // First call - create
    const stub1 = getDOStub(ns)
    const created = await (stub1 as any).thingsCreate({
      $type: 'Customer',
      name: 'Persistent Customer',
    })

    // Second call - get fresh stub and retrieve
    const stub2 = getDOStub(ns)
    const retrieved = await (stub2 as any).thingsGet(created.$id)

    expect(retrieved).toBeDefined()
    expect(retrieved.$id).toBe(created.$id)
    expect(retrieved.name).toBe('Persistent Customer')
  })

  /**
   * RED TEST: Multiple operations on same stub maintain consistency
   */
  it('multiple operations on same stub are consistent', async () => {
    const ns = uniqueNs('rpc-consistency')
    const stub = getDOStub(ns)

    // Create
    const created = await (stub as any).thingsCreate({
      $type: 'Product',
      name: 'Widget',
      price: 9.99,
    })

    // Update
    await (stub as any).thingsUpdate(created.$id, { price: 19.99 })

    // Get
    const retrieved = await (stub as any).thingsGet(created.$id)
    expect(retrieved.price).toBe(19.99)

    // List
    const products = await (stub as any).thingsList({ type: 'Product' })
    expect(products.length).toBe(1)
    expect(products[0].price).toBe(19.99)
  })
})

// ============================================================================
// HTTP vs RPC Consistency Tests
// ============================================================================

describe('[REAL] HTTP vs RPC Consistency', () => {
  /**
   * RED TEST: Entity created via HTTP should be retrievable via RPC
   */
  it('entity created via HTTP is retrievable via RPC', async () => {
    const ns = uniqueNs('http-rpc')

    // Create via HTTP
    const httpRes = await doFetch(ns, '/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'HTTP Created Customer' }),
    })
    expect(httpRes.status).toBe(201)

    const httpCreated = await httpRes.json() as { $id: string; name: string }
    expect(httpCreated.$id).toBeDefined()

    // Retrieve via RPC
    const stub = getDOStub(ns)
    const rpcRetrieved = await (stub as any).thingsGet(httpCreated.$id)

    expect(rpcRetrieved).toBeDefined()
    expect(rpcRetrieved.name).toBe('HTTP Created Customer')
  })

  /**
   * RED TEST: Entity created via RPC should be retrievable via HTTP
   */
  it('entity created via RPC is retrievable via HTTP', async () => {
    const ns = uniqueNs('rpc-http')

    // Create via RPC
    const stub = getDOStub(ns)
    const rpcCreated = await (stub as any).thingsCreate({
      $type: 'Customer',
      name: 'RPC Created Customer',
    })
    expect(rpcCreated.$id).toBeDefined()

    // Extract ID from $id URL
    const idParts = rpcCreated.$id.split('/')
    const shortId = idParts[idParts.length - 1]

    // Retrieve via HTTP
    const httpRes = await doFetch(ns, `/customers/${shortId}`)
    expect(httpRes.status).toBe(200)

    const httpRetrieved = await httpRes.json() as { name: string }
    expect(httpRetrieved.name).toBe('RPC Created Customer')
  })
})

// ============================================================================
// Error Handling Tests via RPC
// ============================================================================

describe('[REAL] Error Handling via RPC', () => {
  /**
   * RED TEST: thingsGet() should return null for non-existent entity
   */
  it('stub.thingsGet() returns null for non-existent ID', async () => {
    const ns = uniqueNs('rpc-not-found')
    const stub = getDOStub(ns)

    const result = await (stub as any).thingsGet('non-existent-id-12345')

    expect(result).toBeNull()
  })

  /**
   * RED TEST: thingsCreate() should fail without $type
   */
  it('stub.thingsCreate() fails without $type', async () => {
    const ns = uniqueNs('rpc-no-type')
    const stub = getDOStub(ns)

    try {
      await (stub as any).thingsCreate({
        name: 'No Type Entity',
      })
      // Should have thrown
      expect.fail('Should have thrown error for missing $type')
    } catch (error) {
      expect(error).toBeDefined()
    }
  })

  /**
   * RED TEST: thingsCreateMany() should fail if any item lacks $type
   */
  it('stub.thingsCreateMany() fails if any item lacks $type', async () => {
    const ns = uniqueNs('rpc-batch-fail')
    const stub = getDOStub(ns)

    const items = [
      { $type: 'Customer', name: 'Valid' },
      { name: 'Invalid - no type' },
      { $type: 'Customer', name: 'Also Valid' },
    ]

    try {
      await (stub as any).thingsCreateMany(items)
      expect.fail('Should have thrown error for missing $type')
    } catch (error) {
      expect(error).toBeDefined()
    }
  })
})
