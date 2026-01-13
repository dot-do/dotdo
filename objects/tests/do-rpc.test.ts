/**
 * DO RPC Direct Method Access Tests (RED Phase)
 *
 * These tests verify that Durable Objects correctly expose RPC methods
 * for direct method invocation via stub.methodName() pattern.
 *
 * IMPORTANT: These tests use REAL miniflare DOs with SQLite storage.
 * NO MOCKS are used - this tests the actual DO RPC behavior.
 *
 * The 95% rule: Most DO testing should use Workers RPC direct method access,
 * NOT fetch. Workers RPC allows calling DO methods directly via stub.methodName()
 *
 * Expected behavior (tests should FAIL initially - RED phase):
 * - stub.thingsCreate() creates a thing via RPC
 * - stub.thingsGet() retrieves a thing via RPC
 * - stub.thingsList() lists things via RPC
 * - stub.thingsUpdate() updates a thing via RPC
 * - stub.thingsDelete() deletes a thing via RPC
 * - stub.relsCreate() creates a relationship via RPC
 * - stub.relsQuery() queries relationships via RPC
 * - stub.sqlExecute() executes raw SQL via RPC
 * - stub.ns / stub.$id expose identity properties via RPC
 *
 * Run with: npx vitest run objects/tests/do-rpc.test.ts --project=do-rpc
 *
 * @module objects/tests/do-rpc.test
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
function uniqueNs(prefix: string = 'rpc-test'): string {
  return `${prefix}-${testRunId}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Type definitions for RPC responses
 */
interface ThingEntity {
  $id: string
  $type: string
  name?: string
  data?: Record<string, unknown>
  tags?: string[]
}

interface RelationshipEntity {
  $id: string
  verb: string
  from: string
  to: string
  data?: Record<string, unknown>
}

interface SqlResult {
  rows: Record<string, unknown>[]
  changes?: number
  lastInsertRowid?: number
}

/**
 * Extended stub type with RPC methods
 *
 * Workers RPC supports two patterns for nested objects:
 * 1. Nested RpcTarget objects: stub.thingsCreate() - RpcTarget returned from getter
 * 2. Flat methods: stub.thingsCreate() - Direct methods on the DO
 *
 * Pattern 1 (nested RpcTarget) requires the getter to return an RpcTarget whose
 * methods are defined on the prototype. Pattern 2 (flat methods) is simpler
 * and always works.
 *
 * This test uses BOTH patterns to verify they work correctly:
 * - things/rels/sql: Nested RpcTarget objects (stub.thingsCreate())
 * - thingsCreate/thingsGet/etc: Flat method alternatives
 */
interface RPCStub extends DurableObjectStub {
  // Identity properties
  // Note: `ns` is an instance property in DOTiny, which Workers RPC doesn't expose.
  // Use getNs() method instead for RPC access.
  getNs(): Promise<string>
  $id: Promise<string>

  // ==========================================================================
  // Pattern 1: Nested RpcTarget objects (stub.thingsCreate())
  // ==========================================================================

  // Things store RPC methods (nested object)
  things: {
    create(data: Partial<ThingEntity>): Promise<ThingEntity>
    get(id: string): Promise<ThingEntity | null>
    list(options?: { type?: string }): Promise<ThingEntity[]>
    update(id: string, data: Partial<ThingEntity>): Promise<ThingEntity>
    delete(id: string): Promise<ThingEntity | null>
    query(options: { type: string; where?: Record<string, unknown> }): Promise<ThingEntity[]>
    createMany(items: Partial<ThingEntity>[]): Promise<ThingEntity[]>
  }

  // Relationships store RPC methods (nested object)
  rels: {
    create(data: { verb: string; from: string; to: string; data?: Record<string, unknown> }): Promise<RelationshipEntity>
    query(options: { from?: string; to?: string; verb?: string }): Promise<RelationshipEntity[]>
    delete(id: string): Promise<void>
  }

  // SQL RPC methods (nested object)
  sql: {
    execute(query: string, params?: unknown[]): Promise<SqlResult>
  }

  // ==========================================================================
  // Pattern 2: Flat methods (stub.thingsCreate())
  // These are alternative methods that always work with Workers RPC
  // ==========================================================================

  // Things flat methods
  thingsCreate(data: Partial<ThingEntity>): Promise<ThingEntity>
  thingsGet(id: string): Promise<ThingEntity | null>
  thingsList(options?: { type?: string }): Promise<ThingEntity[]>
  thingsUpdate(id: string, data: Partial<ThingEntity>): Promise<ThingEntity>
  thingsDelete(id: string): Promise<ThingEntity | null>
  thingsQuery(options: { type: string; where?: Record<string, unknown> }): Promise<ThingEntity[]>
  thingsCreateMany(items: Partial<ThingEntity>[]): Promise<ThingEntity[]>

  // Rels flat methods
  relsCreate(data: { verb: string; from: string; to: string; data?: Record<string, unknown> }): Promise<RelationshipEntity>
  relsQuery(options: { from?: string; to?: string; verb?: string }): Promise<RelationshipEntity[]>
  relsDelete(id: string): Promise<void>

  // SQL flat method
  sqlExecute(query: string, params?: unknown[]): Promise<SqlResult>
}

// ============================================================================
// DO RPC Method Tests
// ============================================================================

describe('DO RPC Methods', () => {
  let stub: RPCStub
  let ns: string

  beforeEach(() => {
    ns = uniqueNs()
    // Get DO stub - uses TEST_DO binding from wrangler.do-test.jsonc
    const id = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.idFromName(ns)
    stub = (env as { TEST_DO: DurableObjectNamespace }).TEST_DO.get(id) as RPCStub
  })

  // ==========================================================================
  // Things Store via RPC
  // ==========================================================================

  describe('things store via RPC', () => {
    /**
     * RED TEST: Create a thing via RPC
     *
     * Expected behavior:
     * - stub.thingsCreate() should create a thing and return it
     * - The returned thing should have $id generated
     * - The returned thing should have the provided data
     *
     * Current behavior (expected to fail):
     * - RPC method things.create() does not exist on stub
     * - TypeError: stub.things is undefined
     */
    it('creates via things.create()', async () => {
      const result = await stub.thingsCreate({
        $type: 'Customer',
        name: 'Alice',
        data: { email: 'alice@example.com' },
      })

      expect(result.$id).toBeDefined()
      expect(result.name).toBe('Alice')
      expect(result.$type).toBe('Customer')
      expect(result.data).toEqual({ email: 'alice@example.com' })
    })

    /**
     * RED TEST: Retrieve a thing via RPC
     *
     * Expected behavior:
     * - Create a thing first
     * - stub.thingsGet(id) should retrieve it by ID
     * - Should return the full thing data
     *
     * Current behavior (expected to fail):
     * - RPC method things.get() does not exist on stub
     */
    it('retrieves via things.get()', async () => {
      const created = await stub.thingsCreate({
        $type: 'Product',
        name: 'Widget',
      })

      const retrieved = await stub.thingsGet(created.$id)

      expect(retrieved).not.toBeNull()
      expect(retrieved!.name).toBe('Widget')
      expect(retrieved!.$type).toBe('Product')
    })

    /**
     * RED TEST: List things via RPC
     *
     * Expected behavior:
     * - Create multiple things
     * - stub.thingsList() should return all things
     * - stub.thingsList({ type: 'Order' }) should filter by type
     *
     * Current behavior (expected to fail):
     * - RPC method things.list() does not exist on stub
     */
    it('lists via things.list()', async () => {
      await stub.thingsCreate({ $type: 'Order', name: 'Order 1' })
      await stub.thingsCreate({ $type: 'Order', name: 'Order 2' })
      await stub.thingsCreate({ $type: 'Customer', name: 'Customer 1' })

      const orders = await stub.thingsList({ type: 'Order' })

      expect(orders.length).toBeGreaterThanOrEqual(2)
      expect(orders.every((t) => t.$type === 'Order')).toBe(true)
    })

    /**
     * RED TEST: Update a thing via RPC
     *
     * Expected behavior:
     * - Create a thing
     * - stub.thingsUpdate(id, data) should update it
     * - Should return the updated thing
     *
     * Current behavior (expected to fail):
     * - RPC method things.update() does not exist on stub
     */
    it('updates via things.update()', async () => {
      const created = await stub.thingsCreate({
        $type: 'Task',
        name: 'Original',
      })

      const updated = await stub.thingsUpdate(created.$id, { name: 'Updated' })

      expect(updated.name).toBe('Updated')

      const retrieved = await stub.thingsGet(created.$id)
      expect(retrieved!.name).toBe('Updated')
    })

    /**
     * RED TEST: Delete a thing via RPC
     *
     * Expected behavior:
     * - Create a thing
     * - stub.thingsDelete(id) should delete it
     * - Subsequent get should return null
     *
     * Current behavior (expected to fail):
     * - RPC method things.delete() does not exist on stub
     */
    it('deletes via things.delete()', async () => {
      const created = await stub.thingsCreate({
        $type: 'Item',
        name: 'ToDelete',
      })

      await stub.thingsDelete(created.$id)

      const deleted = await stub.thingsGet(created.$id)
      expect(deleted).toBeNull()
    })

    /**
     * RED TEST: Query things with filters via RPC
     *
     * Expected behavior:
     * - Create things with different tags
     * - stub.thingsQuery({ where: ... }) should filter
     *
     * Current behavior (expected to fail):
     * - RPC method things.query() does not exist on stub
     */
    it('queries via things.query()', async () => {
      await stub.thingsCreate({ $type: 'Note', name: 'Note A', tags: ['work'] })
      await stub.thingsCreate({ $type: 'Note', name: 'Note B', tags: ['personal'] })

      const workNotes = await stub.thingsQuery({
        type: 'Note',
        where: { tags: ['work'] },
      })

      expect(workNotes.length).toBeGreaterThanOrEqual(1)
      expect(workNotes.some((n) => n.name === 'Note A')).toBe(true)
    })

    /**
     * RED TEST: Get non-existent thing returns null
     *
     * Expected behavior:
     * - stub.thingsGet('non-existent') should return null
     * - Should not throw an error
     *
     * Current behavior (expected to fail):
     * - RPC method things.get() does not exist on stub
     */
    it('returns null for non-existent thing', async () => {
      const result = await stub.thingsGet('non-existent-id')

      expect(result).toBeNull()
    })
  })

  // ==========================================================================
  // Relationships via RPC
  // ==========================================================================

  describe('relationships via RPC', () => {
    /**
     * RED TEST: Create a relationship via RPC
     *
     * Expected behavior:
     * - Create two things
     * - stub.relsCreate() should create a relationship between them
     * - Should return the relationship with $id
     *
     * Current behavior (expected to fail):
     * - RPC method rels.create() does not exist on stub
     */
    it('creates relationship via rels.create()', async () => {
      const a = await stub.thingsCreate({ $type: 'Person', name: 'A' })
      const b = await stub.thingsCreate({ $type: 'Person', name: 'B' })

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

    /**
     * RED TEST: Query relationships from a source via RPC
     *
     * Expected behavior:
     * - Create things and relationships
     * - stub.relsQuery({ from: ... }) should return outgoing relationships
     *
     * Current behavior (expected to fail):
     * - RPC method rels.query() does not exist on stub
     */
    it('queries relationships via rels.query()', async () => {
      const person = await stub.thingsCreate({ $type: 'Person', name: 'X' })
      const company = await stub.thingsCreate({ $type: 'Company', name: 'Acme' })

      await stub.relsCreate({
        verb: 'works_at',
        from: person.$id,
        to: company.$id,
      })

      const rels = await stub.relsQuery({ from: person.$id })

      expect(rels.length).toBeGreaterThanOrEqual(1)
      expect(rels.some((r) => r.verb === 'works_at')).toBe(true)
    })

    /**
     * RED TEST: Query reverse relationships via RPC
     *
     * Expected behavior:
     * - Create relationship from manager to employee
     * - Query by 'to' should find incoming relationships
     *
     * Current behavior (expected to fail):
     * - RPC method rels.query() does not exist on stub
     */
    it('queries reverse relationships', async () => {
      const manager = await stub.thingsCreate({ $type: 'Person', name: 'Manager' })
      const employee = await stub.thingsCreate({ $type: 'Person', name: 'Employee' })

      await stub.relsCreate({
        verb: 'manages',
        from: manager.$id,
        to: employee.$id,
      })

      const managed = await stub.relsQuery({ to: employee.$id, verb: 'manages' })

      expect(managed.length).toBe(1)
      expect(managed[0].from).toBe(manager.$id)
    })

    /**
     * RED TEST: Delete a relationship via RPC
     *
     * Expected behavior:
     * - Create a relationship
     * - stub.relsDelete(id) should remove it
     * - Subsequent query should not include it
     *
     * Current behavior (expected to fail):
     * - RPC method rels.delete() does not exist on stub
     */
    it('deletes relationship via rels.delete()', async () => {
      const a = await stub.thingsCreate({ $type: 'Node', name: 'A' })
      const b = await stub.thingsCreate({ $type: 'Node', name: 'B' })

      const rel = await stub.relsCreate({
        verb: 'links_to',
        from: a.$id,
        to: b.$id,
      })

      await stub.relsDelete(rel.$id)

      const rels = await stub.relsQuery({ from: a.$id })
      expect(rels.some((r) => r.$id === rel.$id)).toBe(false)
    })

    /**
     * RED TEST: Create relationship with data payload
     *
     * Expected behavior:
     * - stub.relsCreate() should accept a data payload
     * - Data should be stored and retrievable
     *
     * Current behavior (expected to fail):
     * - RPC method rels.create() does not exist on stub
     */
    it('creates relationship with data payload', async () => {
      const investor = await stub.thingsCreate({ $type: 'Investor', name: 'VC Fund' })
      const startup = await stub.thingsCreate({ $type: 'Startup', name: 'TechCo' })

      const rel = await stub.relsCreate({
        verb: 'invested_in',
        from: investor.$id,
        to: startup.$id,
        data: { amount: 1000000, round: 'seed' },
      })

      expect(rel.data).toEqual({ amount: 1000000, round: 'seed' })
    })
  })

  // ==========================================================================
  // Identity via RPC
  // ==========================================================================

  describe('identity via RPC', () => {
    /**
     * GREEN TEST: Expose ns via RPC method
     *
     * Note: Workers RPC only exposes prototype properties/methods, not instance properties.
     * Since `ns` is an instance property in DOTiny, we expose it via getNs() method.
     *
     * Expected behavior:
     * - stub.getNs() should return the namespace
     * - The namespace is initialized from the DO ID since no X-DO-NS header is sent via RPC
     */
    it('exposes ns via getNs() method', async () => {
      const nsValue = await stub.getNs()

      // The namespace should be the DO ID since no header was sent
      expect(nsValue).toBeDefined()
      expect(typeof nsValue).toBe('string')
    })

    /**
     * GREEN TEST: Expose $id property via RPC
     *
     * Expected behavior:
     * - stub.$id should return the full identity URL (https://ns)
     * - Should start with https://
     *
     * Note: $id is a getter on the prototype, so it's accessible via RPC.
     * The ns is set to the DO ID in the constructor, so $id will be https://<do-id>
     */
    it('exposes $id property', async () => {
      const $id = await stub.$id

      expect($id).toBeDefined()
      expect(typeof $id).toBe('string')
      expect($id).toMatch(/^https:\/\/.+/)
    })
  })

  // ==========================================================================
  // SQL Access via RPC
  // ==========================================================================

  describe('SQL access via RPC', () => {
    /**
     * RED TEST: Execute raw SQL via RPC
     *
     * Expected behavior:
     * - stub.sqlExecute() should run arbitrary SQL
     * - Should return rows for SELECT queries
     *
     * Current behavior (expected to fail):
     * - RPC method sql.execute() does not exist on stub
     */
    it('executes raw SQL via sql.execute()', async () => {
      const result = await stub.sqlExecute('SELECT 1 as num')

      expect(result.rows).toBeDefined()
      expect(result.rows[0]?.num).toBe(1)
    })

    /**
     * RED TEST: Parameterized SQL queries via RPC
     *
     * Expected behavior:
     * - stub.sqlExecute(sql, params) should handle parameters
     * - Should properly bind parameter values
     *
     * Current behavior (expected to fail):
     * - RPC method sql.execute() does not exist on stub
     */
    it('handles parameterized queries', async () => {
      const result = await stub.sqlExecute('SELECT ? as value', ['hello'])

      expect(result.rows[0]?.value).toBe('hello')
    })

    /**
     * RED TEST: SQL with multiple parameters via RPC
     *
     * Expected behavior:
     * - Should handle multiple parameters in order
     *
     * Current behavior (expected to fail):
     * - RPC method sql.execute() does not exist on stub
     */
    it('handles multiple parameters', async () => {
      const result = await stub.sqlExecute(
        'SELECT ? as a, ? as b, ? as c',
        ['one', 'two', 'three']
      )

      expect(result.rows[0]?.a).toBe('one')
      expect(result.rows[0]?.b).toBe('two')
      expect(result.rows[0]?.c).toBe('three')
    })

    /**
     * RED TEST: SQL mutation returns changes count
     *
     * Expected behavior:
     * - INSERT/UPDATE/DELETE should return changes count
     *
     * Current behavior (expected to fail):
     * - RPC method sql.execute() does not exist on stub
     */
    it('returns changes count for mutations', async () => {
      // Create a test table
      await stub.sqlExecute(
        'CREATE TABLE IF NOT EXISTS test_table (id INTEGER PRIMARY KEY, value TEXT)'
      )

      // Insert a row
      const insertResult = await stub.sqlExecute(
        'INSERT INTO test_table (value) VALUES (?)',
        ['test-value']
      )

      expect(insertResult.changes).toBe(1)
    })
  })

  // ==========================================================================
  // Batch Operations via RPC
  // ==========================================================================

  describe('batch operations via RPC', () => {
    /**
     * RED TEST: Create multiple things in batch via RPC
     *
     * Expected behavior:
     * - stub.thingsCreateMany() should create multiple things atomically
     * - Should return all created things with $ids
     *
     * Current behavior (expected to fail):
     * - RPC method things.createMany() does not exist on stub
     */
    it('creates multiple things in batch', async () => {
      const items = [
        { $type: 'Widget', name: 'Widget 1' },
        { $type: 'Widget', name: 'Widget 2' },
        { $type: 'Widget', name: 'Widget 3' },
      ]

      const results = await stub.thingsCreateMany(items)

      expect(results.length).toBe(3)
      expect(results.every((r) => r.$id)).toBe(true)
      expect(results.map((r) => r.name)).toEqual(['Widget 1', 'Widget 2', 'Widget 3'])
    })

    /**
     * RED TEST: Batch create is atomic
     *
     * Expected behavior:
     * - If one item fails validation, none should be created
     * - Transaction should be rolled back
     *
     * Current behavior (expected to fail):
     * - RPC method things.createMany() does not exist on stub
     */
    it('batch create is atomic on failure', async () => {
      const items = [
        { $type: 'Widget', name: 'Valid 1' },
        { $type: '', name: 'Invalid - no type' }, // Should fail validation
        { $type: 'Widget', name: 'Valid 2' },
      ]

      // Should reject with validation error
      await expect(stub.thingsCreateMany(items)).rejects.toThrow()

      // None should be created
      const widgets = await stub.thingsList({ type: 'Widget' })
      expect(widgets.length).toBe(0)
    })
  })

  // ==========================================================================
  // Error Handling via RPC
  // ==========================================================================

  describe('error handling via RPC', () => {
    /**
     * RED TEST: RPC errors are properly surfaced
     *
     * Expected behavior:
     * - Invalid operations should throw meaningful errors
     * - Errors should be propagated to the caller
     *
     * Current behavior (expected to fail):
     * - RPC methods don't exist, so can't test error handling
     */
    it('surfaces validation errors', async () => {
      // Creating without required $type should fail
      await expect(
        stub.thingsCreate({ name: 'Missing Type' } as ThingEntity)
      ).rejects.toThrow(/type.*required/i)
    })

    /**
     * RED TEST: Update non-existent thing throws error
     *
     * Expected behavior:
     * - stub.thingsUpdate('non-existent', ...) should throw NOT_FOUND
     *
     * Current behavior (expected to fail):
     * - RPC method things.update() does not exist on stub
     */
    it('throws on update of non-existent thing', async () => {
      await expect(
        stub.thingsUpdate('non-existent-id', { name: 'Updated' })
      ).rejects.toThrow(/not found/i)
    })

    /**
     * RED TEST: Delete non-existent relationship throws error
     *
     * Expected behavior:
     * - stub.relsDelete('non-existent') should throw NOT_FOUND
     *
     * Current behavior (expected to fail):
     * - RPC method rels.delete() does not exist on stub
     */
    it('throws on delete of non-existent relationship', async () => {
      await expect(stub.relsDelete('non-existent-rel-id')).rejects.toThrow(/not found/i)
    })

    /**
     * RED TEST: Invalid SQL throws error
     *
     * Expected behavior:
     * - stub.sqlExecute('INVALID SQL') should throw SQL error
     *
     * Current behavior (expected to fail):
     * - RPC method sql.execute() does not exist on stub
     */
    it('throws on invalid SQL', async () => {
      await expect(
        stub.sqlExecute('SELECT * FROM nonexistent_table_xyz')
      ).rejects.toThrow()
    })
  })

  // ==========================================================================
  // Type Safety via RPC
  // ==========================================================================

  describe('type safety via RPC', () => {
    /**
     * RED TEST: Created things have correct $type
     *
     * Expected behavior:
     * - stub.thingsCreate({ $type: 'X' }) should set $type to 'X'
     * - $type should be preserved on retrieval
     *
     * Current behavior (expected to fail):
     * - RPC method things.create() does not exist on stub
     */
    it('preserves $type on creation', async () => {
      const created = await stub.thingsCreate({
        $type: 'SpecificType',
        name: 'Test',
      })

      expect(created.$type).toBe('SpecificType')

      const retrieved = await stub.thingsGet(created.$id)
      expect(retrieved!.$type).toBe('SpecificType')
    })

    /**
     * RED TEST: List filters by exact type match
     *
     * Expected behavior:
     * - things.list({ type: 'X' }) should only return things of type X
     * - Should not include subtypes or similar names
     *
     * Current behavior (expected to fail):
     * - RPC method things.list() does not exist on stub
     */
    it('filters by exact type match', async () => {
      await stub.thingsCreate({ $type: 'TypeA', name: 'A1' })
      await stub.thingsCreate({ $type: 'TypeAExtended', name: 'AE1' })
      await stub.thingsCreate({ $type: 'TypeB', name: 'B1' })

      const typeA = await stub.thingsList({ type: 'TypeA' })

      expect(typeA.length).toBe(1)
      expect(typeA[0].name).toBe('A1')
    })
  })

  // ==========================================================================
  // Concurrent Operations via RPC
  // ==========================================================================

  describe('concurrent operations via RPC', () => {
    /**
     * RED TEST: Concurrent creates are handled correctly
     *
     * Expected behavior:
     * - Multiple concurrent creates should all succeed
     * - Each should get a unique $id
     * - No race conditions or lost writes
     *
     * Current behavior (expected to fail):
     * - RPC methods don't exist on stub
     */
    it('handles concurrent creates', async () => {
      const creates = Array.from({ length: 10 }, (_, i) =>
        stub.thingsCreate({ $type: 'ConcurrentItem', name: `Item ${i}` })
      )

      const results = await Promise.all(creates)

      expect(results.length).toBe(10)

      // All should have unique IDs
      const ids = results.map((r) => r.$id)
      const uniqueIds = new Set(ids)
      expect(uniqueIds.size).toBe(10)

      // Verify all are persisted
      const items = await stub.thingsList({ type: 'ConcurrentItem' })
      expect(items.length).toBe(10)
    })

    /**
     * RED TEST: Concurrent reads are consistent
     *
     * Expected behavior:
     * - Reading the same item concurrently should return same data
     * - No phantom reads or stale data
     *
     * Current behavior (expected to fail):
     * - RPC methods don't exist on stub
     */
    it('handles concurrent reads consistently', async () => {
      const created = await stub.thingsCreate({
        $type: 'ReadTest',
        name: 'Consistent',
        data: { value: 42 },
      })

      const reads = Array.from({ length: 10 }, () => stub.thingsGet(created.$id))

      const results = await Promise.all(reads)

      // All reads should return the same data
      expect(results.every((r) => r!.name === 'Consistent')).toBe(true)
      expect(results.every((r) => (r!.data as { value: number }).value === 42)).toBe(true)
    })
  })
})
