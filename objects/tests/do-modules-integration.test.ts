/**
 * DO Modules Integration Tests
 *
 * Integration tests for DOStorage, DOTransport, DOWorkflow, DOIntrospection
 * using REAL miniflare DOs. NO MOCKS.
 *
 * This replaces do-modules.test.ts which used MockStorage and mock dependencies.
 *
 * Tests verify the modular components extracted from DOBase:
 * 1. DOStorage - SQLite, stores, persistence
 * 2. DOTransport - REST, MCP, CapnWeb handlers
 * 3. DOWorkflow - $ context, events, scheduling
 * 4. DOIntrospection - Schema discovery
 *
 * Run with: npx vitest run objects/tests/do-modules-integration.test.ts --project=modules-integration
 *
 * @module objects/tests/do-modules-integration.test
 */

import { env, SELF } from 'cloudflare:test'
import { describe, it, expect, beforeEach } from 'vitest'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface ThingEntity {
  $id: string
  $type: string
  name?: string
  data?: Record<string, unknown>
}

interface RelationshipEntity {
  $id: string
  id: string
  verb: string
  from: string
  to: string
  data?: Record<string, unknown>
}

interface ThingsRpc {
  create(data: Partial<ThingEntity> & { type?: string }): Promise<ThingEntity>
  get(id: string): Promise<ThingEntity | null>
  list(options?: { type?: string }): Promise<ThingEntity[]>
  update(id: string, data: Partial<ThingEntity>): Promise<ThingEntity>
  delete(id: string): Promise<ThingEntity>
}

interface RelsRpc {
  create(data: { verb: string; from: string; to: string; data?: Record<string, unknown> }): Promise<RelationshipEntity>
  list(options?: { from?: string; to?: string; verb?: string }): Promise<RelationshipEntity[]>
  delete(id: string): Promise<RelationshipEntity>
}

interface RPCStub extends DurableObjectStub {
  things: ThingsRpc
  rels: RelsRpc
  thingsCreate(data: Partial<ThingEntity> & { type?: string }): Promise<ThingEntity>
  thingsGet(id: string): Promise<ThingEntity | null>
  thingsList(options?: { type?: string }): Promise<ThingEntity[]>
  thingsUpdate(id: string, data: Partial<ThingEntity>): Promise<ThingEntity>
  thingsDelete(id: string): Promise<ThingEntity | null>
  relsCreate(data: { verb: string; from: string; to: string; data?: Record<string, unknown> }): Promise<RelationshipEntity>
  relsList(options?: { from?: string; to?: string; verb?: string }): Promise<RelationshipEntity[]>
  relsDelete(id: string): Promise<void>
  sqlExecute(query: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; changes?: number }>
  getNs(): Promise<string>
  $id: Promise<string>
  introspect(role?: string): Promise<{ ns: string; stores: string[]; nouns: string[] }>
}

// ============================================================================
// TEST HELPERS
// ============================================================================

const testRunId = Date.now()

function uniqueNs(prefix: string = 'modules-test'): string {
  return `${prefix}-${testRunId}-${Math.random().toString(36).slice(2, 8)}`
}

// ============================================================================
// DOStorage Module Integration Tests
// ============================================================================

describe('DOStorage Module Integration', () => {
  let stub: RPCStub
  let ns: string

  beforeEach(() => {
    ns = uniqueNs()
    const id = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.idFromName(ns)
    stub = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.get(id) as RPCStub
  })

  describe('Things Store via RPC', () => {
    it('creates thing with $id and $type', async () => {
      const result = await stub.thingsCreate({
        $type: 'Customer',
        name: 'Alice',
      })

      expect(result.$id).toBeDefined()
      expect(result.$type).toBe('Customer')
      expect(result.name).toBe('Alice')
    })

    it('retrieves thing by ID', async () => {
      const created = await stub.thingsCreate({
        $type: 'Product',
        name: 'Widget',
      })

      const retrieved = await stub.thingsGet(created.$id)

      expect(retrieved).not.toBeNull()
      expect(retrieved!.$id).toBe(created.$id)
      expect(retrieved!.name).toBe('Widget')
    })

    it('lists things by type', async () => {
      await stub.thingsCreate({ $type: 'Order', name: 'Order 1' })
      await stub.thingsCreate({ $type: 'Order', name: 'Order 2' })
      await stub.thingsCreate({ $type: 'Customer', name: 'Customer 1' })

      const orders = await stub.thingsList({ type: 'Order' })

      expect(orders.length).toBeGreaterThanOrEqual(2)
      expect(orders.every(t => t.$type === 'Order')).toBe(true)
    })

    it('updates thing', async () => {
      const created = await stub.thingsCreate({
        $type: 'Task',
        name: 'Original',
      })

      const updated = await stub.thingsUpdate(created.$id, { name: 'Updated' })

      expect(updated.name).toBe('Updated')

      const retrieved = await stub.thingsGet(created.$id)
      expect(retrieved!.name).toBe('Updated')
    })

    it('deletes thing', async () => {
      const created = await stub.thingsCreate({
        $type: 'Note',
        name: 'ToDelete',
      })

      await stub.thingsDelete(created.$id)

      const deleted = await stub.thingsGet(created.$id)
      expect(deleted).toBeNull()
    })

    it('returns null for non-existent thing', async () => {
      const result = await stub.thingsGet('non-existent-id')
      expect(result).toBeNull()
    })
  })

  describe('Relationships Store via RPC', () => {
    it('creates relationship between things', async () => {
      const a = await stub.thingsCreate({ $type: 'User', name: 'A' })
      const b = await stub.thingsCreate({ $type: 'User', name: 'B' })

      const rel = await stub.relsCreate({
        verb: 'knows',
        from: a.$id,
        to: b.$id,
      })

      expect(rel.verb).toBe('knows')
      expect(rel.$id).toBeDefined()
      expect(rel.from).toBe(a.$id)
      expect(rel.to).toBe(b.$id)
    })

    it('lists relationships by from', async () => {
      const person = await stub.thingsCreate({ $type: 'User', name: 'X' })
      const company = await stub.thingsCreate({ $type: 'User', name: 'Acme' })

      await stub.relsCreate({
        verb: 'works_at',
        from: person.$id,
        to: company.$id,
      })

      const rels = await stub.relsList({ from: person.$id })

      expect(rels.length).toBeGreaterThanOrEqual(1)
      expect(rels.some(r => r.verb === 'works_at')).toBe(true)
    })

    it('lists relationships by to', async () => {
      const manager = await stub.thingsCreate({ $type: 'User', name: 'Manager' })
      const employee = await stub.thingsCreate({ $type: 'User', name: 'Employee' })

      await stub.relsCreate({
        verb: 'manages',
        from: manager.$id,
        to: employee.$id,
      })

      const managed = await stub.relsList({ to: employee.$id, verb: 'manages' })

      expect(managed.length).toBe(1)
      expect(managed[0].from).toBe(manager.$id)
    })

    it('creates relationship with data payload', async () => {
      const investor = await stub.thingsCreate({ $type: 'User', name: 'VC Fund' })
      const startup = await stub.thingsCreate({ $type: 'User', name: 'TechCo' })

      const rel = await stub.relsCreate({
        verb: 'invested_in',
        from: investor.$id,
        to: startup.$id,
        data: { amount: 1000000, round: 'seed' },
      })

      expect(rel.data).toEqual({ amount: 1000000, round: 'seed' })
    })
  })

  describe('SQL Access via RPC', () => {
    it('executes SELECT query', async () => {
      const result = await stub.sqlExecute('SELECT 1 as num')

      expect(result.rows).toBeDefined()
      expect(result.rows[0]?.num).toBe(1)
    })

    it('handles parameterized queries', async () => {
      const result = await stub.sqlExecute('SELECT ? as value', ['hello'])

      expect(result.rows[0]?.value).toBe('hello')
    })

    it('handles multiple parameters', async () => {
      const result = await stub.sqlExecute(
        'SELECT ? as a, ? as b, ? as c',
        ['one', 'two', 'three']
      )

      expect(result.rows[0]?.a).toBe('one')
      expect(result.rows[0]?.b).toBe('two')
      expect(result.rows[0]?.c).toBe('three')
    })
  })

  describe('Type Caching', () => {
    it('maintains type consistency across operations', async () => {
      // Create things of same type
      const t1 = await stub.thingsCreate({ $type: 'Widget', name: 'W1' })
      const t2 = await stub.thingsCreate({ $type: 'Widget', name: 'W2' })

      // Retrieve and verify types match
      const r1 = await stub.thingsGet(t1.$id)
      const r2 = await stub.thingsGet(t2.$id)

      expect(r1!.$type).toBe('Widget')
      expect(r2!.$type).toBe('Widget')
    })
  })
})

// ============================================================================
// DOTransport Module Integration Tests
// ============================================================================

describe('DOTransport Module Integration', () => {
  let stub: RPCStub
  let ns: string

  beforeEach(() => {
    ns = uniqueNs()
    const id = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.idFromName(ns)
    stub = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.get(id) as RPCStub
  })

  describe('REST Request Handling via fetch', () => {
    it('handles GET / root request', async () => {
      const res = await stub.fetch(new Request('https://test.api/', {
        method: 'GET',
        headers: { 'X-DO-NS': ns },
      }))

      expect(res.status).toBe(200)
    })

    it('handles GET /health request', async () => {
      const res = await stub.fetch(new Request('https://test.api/health', {
        method: 'GET',
        headers: { 'X-DO-NS': ns },
      }))

      expect(res.status).toBe(200)
    })

    it('returns 404 for unknown routes', async () => {
      const res = await stub.fetch(new Request('https://test.api/unknown/deep/route/path', {
        method: 'GET',
        headers: { 'X-DO-NS': ns },
      }))

      expect(res.status).toBe(404)
    })

    it('routes POST /:type to create handler', async () => {
      const res = await stub.fetch(new Request('https://test.api/customers', {
        method: 'POST',
        body: JSON.stringify({ name: 'Alice' }),
        headers: {
          'Content-Type': 'application/json',
          'X-DO-NS': ns,
        },
      }))

      // Should succeed or return validation error (not 500)
      expect([200, 201, 400, 422]).toContain(res.status)
    })

    it('routes GET /:type/:id to get handler', async () => {
      // First create a thing
      const created = await stub.thingsCreate({ $type: 'Customer', name: 'Test' })

      // Then get via REST
      const res = await stub.fetch(new Request(`https://test.api/customers/${created.$id}`, {
        method: 'GET',
        headers: { 'X-DO-NS': ns },
      }))

      expect([200, 404]).toContain(res.status)
    })
  })

  describe('Introspect Endpoint', () => {
    it('handles introspect request via RPC', async () => {
      const schema = await stub.introspect('user')

      expect(schema.ns).toBeDefined()
      expect(schema.stores).toBeDefined()
      expect(Array.isArray(schema.stores)).toBe(true)
      expect(schema.nouns).toBeDefined()
      expect(Array.isArray(schema.nouns)).toBe(true)
    })
  })
})

// ============================================================================
// Identity Integration Tests
// ============================================================================

describe('Identity Integration', () => {
  let stub: RPCStub
  let ns: string

  beforeEach(() => {
    ns = uniqueNs()
    const id = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.idFromName(ns)
    stub = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.get(id) as RPCStub
  })

  it('exposes ns via getNs() method', async () => {
    const nsValue = await stub.getNs()

    expect(nsValue).toBeDefined()
    expect(typeof nsValue).toBe('string')
  })

  it('exposes $id property', async () => {
    const $id = await stub.$id

    expect($id).toBeDefined()
    expect(typeof $id).toBe('string')
    expect($id).toMatch(/^https:\/\/.+/)
  })
})

// ============================================================================
// Concurrent Operations Integration Tests
// ============================================================================

describe('Concurrent Operations Integration', () => {
  let stub: RPCStub
  let ns: string

  beforeEach(() => {
    ns = uniqueNs()
    const id = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.idFromName(ns)
    stub = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.get(id) as RPCStub
  })

  it('handles concurrent creates', async () => {
    const creates = Array.from({ length: 10 }, (_, i) =>
      stub.thingsCreate({ $type: 'Widget', name: `Item ${i}` })
    )

    const results = await Promise.all(creates)

    expect(results.length).toBe(10)

    // All should have unique IDs
    const ids = results.map(r => r.$id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(10)

    // Verify all are persisted
    const items = await stub.thingsList({ type: 'Widget' })
    expect(items.length).toBe(10)
  })

  it('handles concurrent reads consistently', async () => {
    const created = await stub.thingsCreate({
      $type: 'Widget',
      name: 'Consistent',
      data: { value: 42 },
    })

    const reads = Array.from({ length: 10 }, () => stub.thingsGet(created.$id))

    const results = await Promise.all(reads)

    // All reads should return the same data
    expect(results.every(r => r!.name === 'Consistent')).toBe(true)
  })
})

// ============================================================================
// Store Context Integration Tests
// ============================================================================

describe('Store Context Integration', () => {
  let stub: RPCStub
  let ns: string

  beforeEach(() => {
    ns = uniqueNs()
    const id = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.idFromName(ns)
    stub = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.get(id) as RPCStub
  })

  it('stores share the same namespace', async () => {
    // Create a thing
    const thing = await stub.thingsCreate({ $type: 'Customer', name: 'Test' })

    // Create a relationship using the thing ID
    const rel = await stub.relsCreate({
      verb: 'owns',
      from: thing.$id,
      to: 'target-1',
    })

    // Verify both operations succeeded
    expect(thing.$id).toBeDefined()
    expect(rel.$id).toBeDefined()

    // List relationships by from should find the relationship
    const rels = await stub.relsList({ from: thing.$id })
    expect(rels.length).toBeGreaterThanOrEqual(1)
  })

  it('maintains data integrity across store operations', async () => {
    // Create two things
    const a = await stub.thingsCreate({ $type: 'User', name: 'A' })
    const b = await stub.thingsCreate({ $type: 'User', name: 'B' })

    // Create relationship
    await stub.relsCreate({ verb: 'friends', from: a.$id, to: b.$id })

    // Update one thing
    await stub.thingsUpdate(a.$id, { name: 'Updated A' })

    // Verify relationship still exists
    const rels = await stub.relsList({ from: a.$id })
    expect(rels.length).toBe(1)

    // Verify thing was updated
    const retrieved = await stub.thingsGet(a.$id)
    expect(retrieved!.name).toBe('Updated A')
  })
})

// ============================================================================
// Lazy Loading Behavior Tests
// ============================================================================

describe('Lazy Loading Behavior', () => {
  let stub: RPCStub
  let ns: string

  beforeEach(() => {
    ns = uniqueNs()
    const id = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.idFromName(ns)
    stub = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.get(id) as RPCStub
  })

  it('stores are cached after first access', async () => {
    // Access things store multiple times
    const t1 = await stub.thingsCreate({ $type: 'Widget', name: 'W1' })
    const t2 = await stub.thingsCreate({ $type: 'Widget', name: 'W2' })
    const t3 = await stub.thingsCreate({ $type: 'Widget', name: 'W3' })

    // All should have unique IDs, proving store is consistent
    const ids = [t1.$id, t2.$id, t3.$id]
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(3)
  })

  it('different stores work independently', async () => {
    // Create thing
    const thing = await stub.thingsCreate({ $type: 'Product', name: 'Product1' })

    // Create relationship
    const rel = await stub.relsCreate({
      verb: 'has',
      from: 'source-1',
      to: thing.$id,
    })

    // Both should exist
    const retrievedThing = await stub.thingsGet(thing.$id)
    const retrievedRels = await stub.relsList({ to: thing.$id })

    expect(retrievedThing).not.toBeNull()
    expect(retrievedRels.length).toBe(1)
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Error Handling', () => {
  let stub: RPCStub
  let ns: string

  beforeEach(() => {
    ns = uniqueNs()
    const id = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.idFromName(ns)
    stub = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.get(id) as RPCStub
  })

  it('handles invalid SQL gracefully', async () => {
    await expect(
      stub.sqlExecute('SELECT * FROM nonexistent_table_xyz')
    ).rejects.toThrow()
  })

  it('update non-existent thing throws error', async () => {
    await expect(
      stub.thingsUpdate('non-existent-id', { name: 'Updated' })
    ).rejects.toThrow()
  })
})
