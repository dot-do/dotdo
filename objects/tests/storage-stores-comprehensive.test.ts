/**
 * Storage Stores Comprehensive Tests
 *
 * TDD RED phase: Comprehensive tests for Things, Relationships, Events, Actions stores.
 * Uses cloudflare:test with real miniflare - NO MOCKS.
 *
 * Test Coverage:
 * 1. ThingsStore CRUD operations
 * 2. RelationshipsStore (graph edges)
 * 3. EventsStore (append-only log)
 * 4. ActionsStore (workflow state)
 * 5. Query filters and pagination
 * 6. Transactions and rollbacks
 * 7. Index usage and performance
 *
 * @see db/stores.ts for store implementations
 * @see CLAUDE.md for testing philosophy (NO MOCKS)
 */

import { env, SELF } from 'cloudflare:test'
import { describe, it, expect, beforeEach, beforeAll, afterEach } from 'vitest'

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Unique namespace per test suite run to ensure isolation
 */
const testRunId = Date.now()
let testCounter = 0

/**
 * Generate a unique namespace for each test to ensure isolation
 */
function uniqueNs(prefix: string = 'store-test'): string {
  return `${prefix}-${testRunId}-${++testCounter}`
}

/**
 * Helper to get a real DO stub from env
 */
function getDOStub(ns: string) {
  const id = env.TEST_DO.idFromName(ns)
  return env.TEST_DO.get(id)
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

// ============================================================================
// TEST SUITE 1: ThingsStore CRUD Operations
// ============================================================================

describe('ThingsStore - CRUD Operations (Real SQLite)', () => {
  // --------------------------------------------------------------------------
  // CREATE Tests
  // --------------------------------------------------------------------------

  describe('create', () => {
    it('creates a thing with auto-generated $id', async () => {
      const ns = uniqueNs('things-create')
      const stub = getDOStub(ns)

      // Use RPC to call things.create directly
      const thing = await stub.things.create({
        $type: 'Customer',
        name: 'Acme Corp',
        data: { email: 'test@acme.com' },
      })

      expect(thing.$id).toBeDefined()
      expect(thing.$id).toMatch(/^[0-9a-f-]{36}$/) // UUID format
      expect(thing.$type).toBe('Customer')
      expect(thing.name).toBe('Acme Corp')
      expect(thing.data).toEqual({ email: 'test@acme.com' })
      expect(thing.deleted).toBe(false)
    })

    it('creates a thing with custom $id', async () => {
      const ns = uniqueNs('things-custom-id')
      const stub = getDOStub(ns)
      const customId = `cust-${Date.now()}`

      const thing = await stub.things.create({
        $id: customId,
        $type: 'Customer',
        name: 'Custom ID Corp',
      })

      expect(thing.$id).toBe(customId)
      expect(thing.$type).toBe('Customer')
    })

    it('throws error when $type is missing', async () => {
      const ns = uniqueNs('things-no-type')
      const stub = getDOStub(ns)

      await expect(
        stub.things.create({ name: 'No Type' } as any)
      ).rejects.toThrow(/\$type.*required/i)
    })

    it('throws error for duplicate $id', async () => {
      const ns = uniqueNs('things-duplicate')
      const stub = getDOStub(ns)
      const duplicateId = `dup-${Date.now()}`

      // First create succeeds
      await stub.things.create({
        $id: duplicateId,
        $type: 'Customer',
        name: 'First',
      })

      // Second create with same ID should fail
      await expect(
        stub.things.create({
          $id: duplicateId,
          $type: 'Customer',
          name: 'Second',
        })
      ).rejects.toThrow(/already exists/i)
    })

    it('sets version number on create', async () => {
      const ns = uniqueNs('things-version')
      const stub = getDOStub(ns)

      const thing = await stub.things.create({
        $type: 'Customer',
        name: 'Version Test',
      })

      expect(thing.version).toBeDefined()
      expect(typeof thing.version).toBe('number')
      expect(thing.version).toBeGreaterThan(0)
    })
  })

  // --------------------------------------------------------------------------
  // READ Tests
  // --------------------------------------------------------------------------

  describe('get', () => {
    it('retrieves a thing by $id', async () => {
      const ns = uniqueNs('things-get')
      const stub = getDOStub(ns)

      const created = await stub.things.create({
        $type: 'Customer',
        name: 'Get Test',
        data: { status: 'active' },
      })

      const retrieved = await stub.things.get(created.$id)

      expect(retrieved).not.toBeNull()
      expect(retrieved!.$id).toBe(created.$id)
      expect(retrieved!.$type).toBe('Customer')
      expect(retrieved!.name).toBe('Get Test')
      expect(retrieved!.data).toEqual({ status: 'active' })
    })

    it('returns null for non-existent thing', async () => {
      const ns = uniqueNs('things-get-null')
      const stub = getDOStub(ns)

      const result = await stub.things.get('non-existent-id')

      expect(result).toBeNull()
    })

    it('excludes soft-deleted things by default', async () => {
      const ns = uniqueNs('things-get-deleted')
      const stub = getDOStub(ns)

      const created = await stub.things.create({
        $type: 'Customer',
        name: 'To Delete',
      })

      await stub.things.delete(created.$id)

      // Default get should not find it
      const result = await stub.things.get(created.$id)
      expect(result).toBeNull()
    })

    it('includes soft-deleted things when includeDeleted is true', async () => {
      const ns = uniqueNs('things-get-include-deleted')
      const stub = getDOStub(ns)

      const created = await stub.things.create({
        $type: 'Customer',
        name: 'To Delete Include',
      })

      await stub.things.delete(created.$id)

      // With includeDeleted should find it
      const result = await stub.things.get(created.$id, { includeDeleted: true })
      expect(result).not.toBeNull()
      expect(result!.deleted).toBe(true)
    })

    it('retrieves thing at specific version', async () => {
      const ns = uniqueNs('things-get-version')
      const stub = getDOStub(ns)

      const created = await stub.things.create({
        $type: 'Customer',
        name: 'Version 1',
        data: { state: 'v1' },
      })

      await stub.things.update(created.$id, {
        name: 'Version 2',
        data: { state: 'v2' },
      })

      // Get version 1
      const v1 = await stub.things.get(created.$id, { version: 1 })
      expect(v1?.data?.state).toBe('v1')
      expect(v1?.name).toBe('Version 1')
    })
  })

  // --------------------------------------------------------------------------
  // UPDATE Tests
  // --------------------------------------------------------------------------

  describe('update', () => {
    it('updates a thing and creates new version (append-only)', async () => {
      const ns = uniqueNs('things-update')
      const stub = getDOStub(ns)

      const created = await stub.things.create({
        $type: 'Customer',
        name: 'Original Name',
      })
      const originalVersion = created.version

      const updated = await stub.things.update(created.$id, {
        name: 'Updated Name',
      })

      expect(updated.name).toBe('Updated Name')
      expect(updated.version).toBeGreaterThan(originalVersion!)
    })

    it('preserves unspecified fields', async () => {
      const ns = uniqueNs('things-update-preserve')
      const stub = getDOStub(ns)

      const created = await stub.things.create({
        $type: 'Customer',
        name: 'Original',
        data: { email: 'test@test.com', phone: '123-456' },
      })

      const updated = await stub.things.update(created.$id, {
        name: 'New Name',
      })

      // data should be preserved
      expect(updated.data).toEqual({ email: 'test@test.com', phone: '123-456' })
      expect(updated.name).toBe('New Name')
    })

    it('deep merges data field by default', async () => {
      const ns = uniqueNs('things-update-merge')
      const stub = getDOStub(ns)

      const created = await stub.things.create({
        $type: 'Customer',
        name: 'Merge Test',
        data: { a: 1, b: { c: 2 } },
      })

      const updated = await stub.things.update(created.$id, {
        data: { b: { d: 3 } },
      })

      expect(updated.data).toEqual({ a: 1, b: { c: 2, d: 3 } })
    })

    it('replaces data field when merge is false', async () => {
      const ns = uniqueNs('things-update-replace')
      const stub = getDOStub(ns)

      const created = await stub.things.create({
        $type: 'Customer',
        name: 'Replace Test',
        data: { a: 1, b: 2 },
      })

      const updated = await stub.things.update(
        created.$id,
        { data: { c: 3 } },
        { merge: false }
      )

      expect(updated.data).toEqual({ c: 3 })
    })

    it('throws for non-existent thing', async () => {
      const ns = uniqueNs('things-update-notfound')
      const stub = getDOStub(ns)

      await expect(
        stub.things.update('non-existent', { name: 'Update' })
      ).rejects.toThrow(/not found/i)
    })
  })

  // --------------------------------------------------------------------------
  // DELETE Tests
  // --------------------------------------------------------------------------

  describe('delete', () => {
    it('soft deletes a thing (creates new version with deleted=true)', async () => {
      const ns = uniqueNs('things-delete')
      const stub = getDOStub(ns)

      const created = await stub.things.create({
        $type: 'Customer',
        name: 'To Soft Delete',
      })

      const deleted = await stub.things.delete(created.$id)

      expect(deleted.deleted).toBe(true)
      expect(deleted.$id).toBe(created.$id)

      // Verify it's not found by default get
      const result = await stub.things.get(created.$id)
      expect(result).toBeNull()
    })

    it('hard deletes a thing (removes all versions)', async () => {
      const ns = uniqueNs('things-hard-delete')
      const stub = getDOStub(ns)

      const created = await stub.things.create({
        $type: 'Customer',
        name: 'To Hard Delete',
      })

      await stub.things.delete(created.$id, { hard: true })

      // Even with includeDeleted, should not be found
      const result = await stub.things.get(created.$id, { includeDeleted: true })
      expect(result).toBeNull()
    })

    it('throws for non-existent thing', async () => {
      const ns = uniqueNs('things-delete-notfound')
      const stub = getDOStub(ns)

      await expect(
        stub.things.delete('non-existent')
      ).rejects.toThrow(/not found/i)
    })
  })

  // --------------------------------------------------------------------------
  // LIST Tests
  // --------------------------------------------------------------------------

  describe('list', () => {
    it('lists all things', async () => {
      const ns = uniqueNs('things-list')
      const stub = getDOStub(ns)

      await stub.things.create({ $type: 'Customer', name: 'Customer 1' })
      await stub.things.create({ $type: 'Customer', name: 'Customer 2' })
      await stub.things.create({ $type: 'Order', name: 'Order 1' })

      const allThings = await stub.things.list()

      expect(allThings).toBeInstanceOf(Array)
      expect(allThings.length).toBe(3)
    })

    it('filters by type', async () => {
      const ns = uniqueNs('things-list-type')
      const stub = getDOStub(ns)

      await stub.things.create({ $type: 'Customer', name: 'Customer 1' })
      await stub.things.create({ $type: 'Customer', name: 'Customer 2' })
      await stub.things.create({ $type: 'Order', name: 'Order 1' })

      const customers = await stub.things.list({ type: 'Customer' })

      expect(customers.length).toBe(2)
      expect(customers.every(t => t.$type === 'Customer')).toBe(true)
    })

    it('supports pagination with limit and offset', async () => {
      const ns = uniqueNs('things-list-pagination')
      const stub = getDOStub(ns)

      // Create 10 things
      for (let i = 0; i < 10; i++) {
        await stub.things.create({
          $type: 'Item',
          name: `Item ${i}`,
          data: { index: i },
        })
      }

      const page1 = await stub.things.list({ limit: 3, offset: 0 })
      const page2 = await stub.things.list({ limit: 3, offset: 3 })

      expect(page1.length).toBe(3)
      expect(page2.length).toBe(3)
      // Ensure different items
      expect(page1[0].$id).not.toBe(page2[0].$id)
    })

    it('supports cursor-based pagination', async () => {
      const ns = uniqueNs('things-list-cursor')
      const stub = getDOStub(ns)

      // Create 5 things
      for (let i = 0; i < 5; i++) {
        await stub.things.create({
          $type: 'Item',
          name: `Item ${i}`,
        })
      }

      const firstPage = await stub.things.list({ limit: 2 })
      expect(firstPage.length).toBe(2)

      const cursor = firstPage[firstPage.length - 1].$id
      const secondPage = await stub.things.list({ limit: 2, after: cursor })

      expect(secondPage.length).toBe(2)
      expect(secondPage[0].$id).not.toBe(firstPage[0].$id)
      expect(secondPage[0].$id).not.toBe(firstPage[1].$id)
    })

    it('supports ordering by field', async () => {
      const ns = uniqueNs('things-list-order')
      const stub = getDOStub(ns)

      await stub.things.create({ $type: 'Customer', name: 'Charlie' })
      await stub.things.create({ $type: 'Customer', name: 'Alice' })
      await stub.things.create({ $type: 'Customer', name: 'Bob' })

      const ascOrder = await stub.things.list({
        type: 'Customer',
        orderBy: 'name',
        order: 'asc',
      })

      expect(ascOrder[0].name).toBe('Alice')
      expect(ascOrder[1].name).toBe('Bob')
      expect(ascOrder[2].name).toBe('Charlie')

      const descOrder = await stub.things.list({
        type: 'Customer',
        orderBy: 'name',
        order: 'desc',
      })

      expect(descOrder[0].name).toBe('Charlie')
      expect(descOrder[2].name).toBe('Alice')
    })

    it('excludes soft-deleted things by default', async () => {
      const ns = uniqueNs('things-list-deleted')
      const stub = getDOStub(ns)

      const c1 = await stub.things.create({ $type: 'Customer', name: 'Keep' })
      const c2 = await stub.things.create({ $type: 'Customer', name: 'Delete' })

      await stub.things.delete(c2.$id)

      const list = await stub.things.list({ type: 'Customer' })

      expect(list.length).toBe(1)
      expect(list[0].name).toBe('Keep')
    })

    it('includes soft-deleted things when includeDeleted is true', async () => {
      const ns = uniqueNs('things-list-include-deleted')
      const stub = getDOStub(ns)

      await stub.things.create({ $type: 'Customer', name: 'Keep' })
      const c2 = await stub.things.create({ $type: 'Customer', name: 'Delete' })

      await stub.things.delete(c2.$id)

      const list = await stub.things.list({
        type: 'Customer',
        includeDeleted: true,
      })

      expect(list.length).toBe(2)
    })

    it('filters by JSON data field with where clause', async () => {
      const ns = uniqueNs('things-list-where')
      const stub = getDOStub(ns)

      await stub.things.create({
        $type: 'Customer',
        name: 'Active 1',
        data: { status: 'active' },
      })
      await stub.things.create({
        $type: 'Customer',
        name: 'Active 2',
        data: { status: 'active' },
      })
      await stub.things.create({
        $type: 'Customer',
        name: 'Inactive',
        data: { status: 'inactive' },
      })

      const active = await stub.things.list({
        type: 'Customer',
        where: { 'data.status': 'active' },
      })

      expect(active.length).toBe(2)
      expect(active.every(t => (t.data as any)?.status === 'active')).toBe(true)
    })
  })

  // --------------------------------------------------------------------------
  // VERSIONS Tests
  // --------------------------------------------------------------------------

  describe('versions', () => {
    it('returns all versions of a thing in chronological order', async () => {
      const ns = uniqueNs('things-versions')
      const stub = getDOStub(ns)

      const created = await stub.things.create({
        $type: 'Customer',
        name: 'V1',
        data: { state: 'v1' },
      })

      await stub.things.update(created.$id, {
        name: 'V2',
        data: { state: 'v2' },
      })

      await stub.things.update(created.$id, {
        name: 'V3',
        data: { state: 'v3' },
      })

      const versions = await stub.things.versions(created.$id)

      expect(versions.length).toBe(3)
      expect(versions[0].name).toBe('V1')
      expect(versions[1].name).toBe('V2')
      expect(versions[2].name).toBe('V3')

      // Versions should be in ascending order
      for (let i = 1; i < versions.length; i++) {
        expect(versions[i].version).toBeGreaterThan(versions[i - 1].version!)
      }
    })

    it('returns empty array for non-existent thing', async () => {
      const ns = uniqueNs('things-versions-empty')
      const stub = getDOStub(ns)

      const versions = await stub.things.versions('non-existent')

      expect(versions).toEqual([])
    })
  })
})

// ============================================================================
// TEST SUITE 2: RelationshipsStore (Graph Edges)
// ============================================================================

describe('RelationshipsStore - Graph Edges (Real SQLite)', () => {
  describe('create', () => {
    it('creates a relationship with auto-generated id', async () => {
      const ns = uniqueNs('rels-create')
      const stub = getDOStub(ns)

      const rel = await stub.rels.create({
        verb: 'manages',
        from: 'https://test.do/Person/alice',
        to: 'https://test.do/Startup/acme',
      })

      expect(rel.id).toBeDefined()
      expect(rel.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(rel.verb).toBe('manages')
      expect(rel.from).toBe('https://test.do/Person/alice')
      expect(rel.to).toBe('https://test.do/Startup/acme')
      expect(rel.createdAt).toBeInstanceOf(Date)
    })

    it('creates a relationship with data payload', async () => {
      const ns = uniqueNs('rels-create-data')
      const stub = getDOStub(ns)

      const rel = await stub.rels.create({
        verb: 'invested',
        from: 'https://test.do/Investor/bob',
        to: 'https://test.do/Startup/acme',
        data: { amount: 1000000, round: 'seed' },
      })

      expect(rel.data).toEqual({ amount: 1000000, round: 'seed' })
    })

    it('prevents duplicate relationships (same verb/from/to)', async () => {
      const ns = uniqueNs('rels-duplicate')
      const stub = getDOStub(ns)

      await stub.rels.create({
        verb: 'manages',
        from: 'https://test.do/Person/alice',
        to: 'https://test.do/Startup/acme',
      })

      await expect(
        stub.rels.create({
          verb: 'manages',
          from: 'https://test.do/Person/alice',
          to: 'https://test.do/Startup/acme',
        })
      ).rejects.toThrow(/duplicate|already exists/i)
    })

    it('allows same from/to with different verbs', async () => {
      const ns = uniqueNs('rels-different-verbs')
      const stub = getDOStub(ns)

      await stub.rels.create({
        verb: 'manages',
        from: 'https://test.do/Person/alice',
        to: 'https://test.do/Startup/acme',
      })

      const rel2 = await stub.rels.create({
        verb: 'founded',
        from: 'https://test.do/Person/alice',
        to: 'https://test.do/Startup/acme',
      })

      expect(rel2.id).toBeDefined()
      expect(rel2.verb).toBe('founded')
    })
  })

  describe('list', () => {
    it('lists all relationships', async () => {
      const ns = uniqueNs('rels-list')
      const stub = getDOStub(ns)

      await stub.rels.create({ verb: 'manages', from: 'A', to: 'B' })
      await stub.rels.create({ verb: 'owns', from: 'C', to: 'D' })

      const all = await stub.rels.list()

      expect(all).toBeInstanceOf(Array)
      expect(all.length).toBe(2)
    })

    it('filters by from URL', async () => {
      const ns = uniqueNs('rels-list-from')
      const stub = getDOStub(ns)

      await stub.rels.create({ verb: 'manages', from: 'Person/alice', to: 'B' })
      await stub.rels.create({ verb: 'owns', from: 'Person/alice', to: 'C' })
      await stub.rels.create({ verb: 'likes', from: 'Person/bob', to: 'D' })

      const aliceRels = await stub.rels.list({ from: 'Person/alice' })

      expect(aliceRels.length).toBe(2)
      expect(aliceRels.every(r => r.from === 'Person/alice')).toBe(true)
    })

    it('filters by to URL', async () => {
      const ns = uniqueNs('rels-list-to')
      const stub = getDOStub(ns)

      await stub.rels.create({ verb: 'manages', from: 'A', to: 'Startup/acme' })
      await stub.rels.create({ verb: 'funds', from: 'B', to: 'Startup/acme' })
      await stub.rels.create({ verb: 'likes', from: 'C', to: 'Startup/beta' })

      const acmeRels = await stub.rels.list({ to: 'Startup/acme' })

      expect(acmeRels.length).toBe(2)
      expect(acmeRels.every(r => r.to === 'Startup/acme')).toBe(true)
    })

    it('filters by verb', async () => {
      const ns = uniqueNs('rels-list-verb')
      const stub = getDOStub(ns)

      await stub.rels.create({ verb: 'manages', from: 'A', to: 'B' })
      await stub.rels.create({ verb: 'manages', from: 'C', to: 'D' })
      await stub.rels.create({ verb: 'owns', from: 'E', to: 'F' })

      const managesRels = await stub.rels.list({ verb: 'manages' })

      expect(managesRels.length).toBe(2)
      expect(managesRels.every(r => r.verb === 'manages')).toBe(true)
    })

    it('supports pagination', async () => {
      const ns = uniqueNs('rels-list-pagination')
      const stub = getDOStub(ns)

      for (let i = 0; i < 10; i++) {
        await stub.rels.create({
          verb: 'links',
          from: `A${i}`,
          to: `B${i}`,
        })
      }

      const page1 = await stub.rels.list({ limit: 3, offset: 0 })
      const page2 = await stub.rels.list({ limit: 3, offset: 3 })

      expect(page1.length).toBe(3)
      expect(page2.length).toBe(3)
      expect(page1[0].id).not.toBe(page2[0].id)
    })
  })

  describe('delete', () => {
    it('deletes a relationship by id', async () => {
      const ns = uniqueNs('rels-delete')
      const stub = getDOStub(ns)

      const rel = await stub.rels.create({
        verb: 'temporary',
        from: 'A',
        to: 'B',
      })

      const deleted = await stub.rels.delete(rel.id)

      expect(deleted.id).toBe(rel.id)

      const remaining = await stub.rels.list({ verb: 'temporary' })
      expect(remaining.length).toBe(0)
    })

    it('throws for non-existent relationship', async () => {
      const ns = uniqueNs('rels-delete-notfound')
      const stub = getDOStub(ns)

      await expect(
        stub.rels.delete('non-existent-id')
      ).rejects.toThrow(/not found/i)
    })
  })

  describe('deleteWhere', () => {
    it('deletes multiple relationships by criteria', async () => {
      const ns = uniqueNs('rels-deletewhere')
      const stub = getDOStub(ns)

      await stub.rels.create({ verb: 'bulk-test', from: 'A', to: 'B1' })
      await stub.rels.create({ verb: 'bulk-test', from: 'A', to: 'B2' })
      await stub.rels.create({ verb: 'bulk-test', from: 'A', to: 'B3' })
      await stub.rels.create({ verb: 'keep', from: 'A', to: 'B4' })

      const count = await stub.rels.deleteWhere({ from: 'A', verb: 'bulk-test' })

      expect(count).toBe(3)

      const remaining = await stub.rels.list({ from: 'A' })
      expect(remaining.length).toBe(1)
      expect(remaining[0].verb).toBe('keep')
    })
  })

  describe('traversal - from and to', () => {
    it('gets outgoing relationships from a source', async () => {
      const ns = uniqueNs('rels-from')
      const stub = getDOStub(ns)

      await stub.rels.create({ verb: 'manages', from: 'Person/alice', to: 'B' })
      await stub.rels.create({ verb: 'owns', from: 'Person/alice', to: 'C' })
      await stub.rels.create({ verb: 'likes', from: 'Person/bob', to: 'D' })

      const outgoing = await stub.rels.from('Person/alice')

      expect(outgoing.length).toBe(2)
      expect(outgoing.every(r => r.from === 'Person/alice')).toBe(true)
    })

    it('gets incoming relationships to a target', async () => {
      const ns = uniqueNs('rels-to')
      const stub = getDOStub(ns)

      await stub.rels.create({ verb: 'manages', from: 'A', to: 'Startup/acme' })
      await stub.rels.create({ verb: 'funds', from: 'B', to: 'Startup/acme' })
      await stub.rels.create({ verb: 'likes', from: 'C', to: 'Other' })

      const incoming = await stub.rels.to('Startup/acme')

      expect(incoming.length).toBe(2)
      expect(incoming.every(r => r.to === 'Startup/acme')).toBe(true)
    })

    it('supports verb filter in traversal', async () => {
      const ns = uniqueNs('rels-traverse-verb')
      const stub = getDOStub(ns)

      await stub.rels.create({ verb: 'manages', from: 'Person/alice', to: 'B' })
      await stub.rels.create({ verb: 'owns', from: 'Person/alice', to: 'C' })

      const manages = await stub.rels.from('Person/alice', { verb: 'manages' })

      expect(manages.length).toBe(1)
      expect(manages[0].verb).toBe('manages')
    })
  })
})

// ============================================================================
// TEST SUITE 3: EventsStore (Append-Only Log)
// ============================================================================

describe('EventsStore - Append-Only Log (Real SQLite)', () => {
  describe('emit', () => {
    it('emits an event with auto-generated id and sequence', async () => {
      const ns = uniqueNs('events-emit')
      const stub = getDOStub(ns)

      const event = await stub.events.emit({
        verb: 'Customer.created',
        source: 'https://test.do/Customer/123',
        data: { name: 'Acme Corp' },
      })

      expect(event.id).toBeDefined()
      expect(event.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(event.verb).toBe('Customer.created')
      expect(event.source).toBe('https://test.do/Customer/123')
      expect(event.data).toEqual({ name: 'Acme Corp' })
      expect(event.sequence).toBeGreaterThan(0)
      expect(event.streamed).toBe(false)
      expect(event.createdAt).toBeInstanceOf(Date)
    })

    it('assigns increasing sequence numbers', async () => {
      const ns = uniqueNs('events-sequence')
      const stub = getDOStub(ns)

      const e1 = await stub.events.emit({
        verb: 'Event1',
        source: 'A',
        data: {},
      })

      const e2 = await stub.events.emit({
        verb: 'Event2',
        source: 'B',
        data: {},
      })

      const e3 = await stub.events.emit({
        verb: 'Event3',
        source: 'C',
        data: {},
      })

      expect(e2.sequence).toBeGreaterThan(e1.sequence)
      expect(e3.sequence).toBeGreaterThan(e2.sequence)
    })

    it('links to action if provided', async () => {
      const ns = uniqueNs('events-action')
      const stub = getDOStub(ns)

      const event = await stub.events.emit({
        verb: 'Customer.created',
        source: 'test',
        data: {},
        actionId: 'action-123',
      })

      expect(event.actionId).toBe('action-123')
    })
  })

  describe('get', () => {
    it('retrieves event by id', async () => {
      const ns = uniqueNs('events-get')
      const stub = getDOStub(ns)

      const created = await stub.events.emit({
        verb: 'Test.event',
        source: 'test',
        data: { key: 'value' },
      })

      const retrieved = await stub.events.get(created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved!.id).toBe(created.id)
      expect(retrieved!.verb).toBe('Test.event')
      expect(retrieved!.data).toEqual({ key: 'value' })
    })

    it('returns null for non-existent event', async () => {
      const ns = uniqueNs('events-get-null')
      const stub = getDOStub(ns)

      const result = await stub.events.get('non-existent')

      expect(result).toBeNull()
    })
  })

  describe('list', () => {
    it('lists events by source', async () => {
      const ns = uniqueNs('events-list-source')
      const stub = getDOStub(ns)

      await stub.events.emit({ verb: 'Event1', source: 'Source/A', data: {} })
      await stub.events.emit({ verb: 'Event2', source: 'Source/A', data: {} })
      await stub.events.emit({ verb: 'Event3', source: 'Source/B', data: {} })

      const events = await stub.events.list({ source: 'Source/A' })

      expect(events.length).toBe(2)
      expect(events.every(e => e.source === 'Source/A')).toBe(true)
    })

    it('lists events by verb', async () => {
      const ns = uniqueNs('events-list-verb')
      const stub = getDOStub(ns)

      await stub.events.emit({ verb: 'Customer.created', source: 'A', data: {} })
      await stub.events.emit({ verb: 'Customer.created', source: 'B', data: {} })
      await stub.events.emit({ verb: 'Order.placed', source: 'C', data: {} })

      const events = await stub.events.list({ verb: 'Customer.created' })

      expect(events.length).toBe(2)
      expect(events.every(e => e.verb === 'Customer.created')).toBe(true)
    })

    it('lists events after sequence number', async () => {
      const ns = uniqueNs('events-list-after')
      const stub = getDOStub(ns)

      const e1 = await stub.events.emit({ verb: 'Event1', source: 'A', data: {} })
      const e2 = await stub.events.emit({ verb: 'Event2', source: 'B', data: {} })
      const e3 = await stub.events.emit({ verb: 'Event3', source: 'C', data: {} })

      const afterE1 = await stub.events.list({ afterSequence: e1.sequence })

      expect(afterE1.length).toBe(2)
      expect(afterE1.every(e => e.sequence > e1.sequence)).toBe(true)
    })
  })

  describe('replay', () => {
    it('replays events from a given sequence', async () => {
      const ns = uniqueNs('events-replay')
      const stub = getDOStub(ns)

      await stub.events.emit({ verb: 'Event1', source: 'A', data: {} })
      await stub.events.emit({ verb: 'Event2', source: 'B', data: {} })
      await stub.events.emit({ verb: 'Event3', source: 'C', data: {} })
      await stub.events.emit({ verb: 'Event4', source: 'D', data: {} })

      const replayed = await stub.events.replay({ fromSequence: 2, limit: 10 })

      expect(replayed.length).toBeGreaterThanOrEqual(2)
      expect(replayed.every(e => e.sequence >= 2)).toBe(true)
    })

    it('respects limit in replay', async () => {
      const ns = uniqueNs('events-replay-limit')
      const stub = getDOStub(ns)

      for (let i = 0; i < 10; i++) {
        await stub.events.emit({ verb: `Event${i}`, source: 'test', data: {} })
      }

      const replayed = await stub.events.replay({ fromSequence: 0, limit: 3 })

      expect(replayed.length).toBeLessThanOrEqual(3)
    })
  })

  describe('stream', () => {
    it('marks event as streamed', async () => {
      const ns = uniqueNs('events-stream')
      const stub = getDOStub(ns)

      const event = await stub.events.emit({
        verb: 'Test.event',
        source: 'test',
        data: {},
      })

      expect(event.streamed).toBe(false)

      const streamed = await stub.events.stream(event.id)

      expect(streamed.streamed).toBe(true)
      expect(streamed.streamedAt).toBeInstanceOf(Date)
    })
  })

  describe('streamPending', () => {
    it('streams all pending events and returns count', async () => {
      const ns = uniqueNs('events-stream-pending')
      const stub = getDOStub(ns)

      await stub.events.emit({ verb: 'Event1', source: 'A', data: {} })
      await stub.events.emit({ verb: 'Event2', source: 'B', data: {} })
      await stub.events.emit({ verb: 'Event3', source: 'C', data: {} })

      const count = await stub.events.streamPending()

      expect(count).toBe(3)
    })
  })
})

// ============================================================================
// TEST SUITE 4: ActionsStore (Workflow State)
// ============================================================================

describe('ActionsStore - Workflow State (Real SQLite)', () => {
  describe('log', () => {
    it('logs a new action with pending status', async () => {
      const ns = uniqueNs('actions-log')
      const stub = getDOStub(ns)

      const action = await stub.actions.log({
        verb: 'create',
        target: 'Customer/123',
        actor: 'Human/alice',
        input: { name: 'Acme' },
      })

      expect(action.id).toBeDefined()
      expect(action.verb).toBe('create')
      expect(action.target).toBe('Customer/123')
      expect(action.actor).toBe('Human/alice')
      expect(action.status).toBe('pending')
      expect(action.createdAt).toBeInstanceOf(Date)
    })

    it('sets durability level (defaults to try)', async () => {
      const ns = uniqueNs('actions-durability')
      const stub = getDOStub(ns)

      const defaultAction = await stub.actions.log({
        verb: 'update',
        target: 'test',
      })
      expect(defaultAction.durability).toBe('try')

      const doAction = await stub.actions.log({
        verb: 'critical',
        target: 'test',
        durability: 'do',
      })
      expect(doAction.durability).toBe('do')

      const sendAction = await stub.actions.log({
        verb: 'fire-forget',
        target: 'test',
        durability: 'send',
      })
      expect(sendAction.durability).toBe('send')
    })

    it('supports context fields (requestId, sessionId, workflowId)', async () => {
      const ns = uniqueNs('actions-context')
      const stub = getDOStub(ns)

      const action = await stub.actions.log({
        verb: 'update',
        target: 'test',
        requestId: 'req-123',
        sessionId: 'sess-456',
        workflowId: 'wf-789',
      })

      expect(action.requestId).toBe('req-123')
      expect(action.sessionId).toBe('sess-456')
      expect(action.workflowId).toBe('wf-789')
    })
  })

  describe('complete', () => {
    it('marks action as completed with output', async () => {
      const ns = uniqueNs('actions-complete')
      const stub = getDOStub(ns)

      const action = await stub.actions.log({
        verb: 'create',
        target: 'test',
      })

      const completed = await stub.actions.complete(action.id, { result: 'success' })

      expect(completed.status).toBe('completed')
      expect(completed.completedAt).toBeInstanceOf(Date)
    })

    it('calculates duration', async () => {
      const ns = uniqueNs('actions-duration')
      const stub = getDOStub(ns)

      const action = await stub.actions.log({
        verb: 'slow-op',
        target: 'test',
      })

      // Small delay to ensure duration > 0
      await new Promise(resolve => setTimeout(resolve, 10))

      const completed = await stub.actions.complete(action.id, {})

      expect(completed.duration).toBeGreaterThan(0)
    })

    it('throws for non-existent action', async () => {
      const ns = uniqueNs('actions-complete-notfound')
      const stub = getDOStub(ns)

      await expect(
        stub.actions.complete('non-existent', {})
      ).rejects.toThrow(/not found/i)
    })

    it('throws for already completed action', async () => {
      const ns = uniqueNs('actions-complete-twice')
      const stub = getDOStub(ns)

      const action = await stub.actions.log({
        verb: 'once',
        target: 'test',
      })

      await stub.actions.complete(action.id, {})

      await expect(
        stub.actions.complete(action.id, {})
      ).rejects.toThrow(/already completed/i)
    })
  })

  describe('fail', () => {
    it('marks action as failed with error', async () => {
      const ns = uniqueNs('actions-fail')
      const stub = getDOStub(ns)

      const action = await stub.actions.log({
        verb: 'risky',
        target: 'test',
      })

      const failed = await stub.actions.fail(action.id, new Error('Something went wrong'))

      expect(failed.status).toBe('failed')
      expect(failed.error).toBeDefined()
      expect(failed.error?.message).toBe('Something went wrong')
    })

    it('stores custom error details', async () => {
      const ns = uniqueNs('actions-fail-custom')
      const stub = getDOStub(ns)

      const action = await stub.actions.log({
        verb: 'validate',
        target: 'test',
      })

      const failed = await stub.actions.fail(action.id, {
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
        details: { field: 'email' },
      })

      expect(failed.error).toEqual({
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
        details: { field: 'email' },
      })
    })
  })

  describe('retry', () => {
    it('marks action for retry', async () => {
      const ns = uniqueNs('actions-retry')
      const stub = getDOStub(ns)

      const action = await stub.actions.log({
        verb: 'retryable',
        target: 'test',
        durability: 'do',
      })

      await stub.actions.fail(action.id, new Error('Temp failure'))

      const retrying = await stub.actions.retry(action.id)

      expect(retrying.status).toBe('retrying')
    })

    it('throws for non-durable (send) actions', async () => {
      const ns = uniqueNs('actions-retry-send')
      const stub = getDOStub(ns)

      const action = await stub.actions.log({
        verb: 'fire-forget',
        target: 'test',
        durability: 'send',
      })

      await expect(
        stub.actions.retry(action.id)
      ).rejects.toThrow(/cannot retry.*send/i)
    })
  })

  describe('queries', () => {
    it('gets action by id', async () => {
      const ns = uniqueNs('actions-get')
      const stub = getDOStub(ns)

      const created = await stub.actions.log({
        verb: 'test',
        target: 'item',
      })

      const retrieved = await stub.actions.get(created.id)

      expect(retrieved).not.toBeNull()
      expect(retrieved!.id).toBe(created.id)
    })

    it('lists actions by target', async () => {
      const ns = uniqueNs('actions-list-target')
      const stub = getDOStub(ns)

      await stub.actions.log({ verb: 'create', target: 'Customer/123' })
      await stub.actions.log({ verb: 'update', target: 'Customer/123' })
      await stub.actions.log({ verb: 'delete', target: 'Order/456' })

      const customerActions = await stub.actions.list({ target: 'Customer/123' })

      expect(customerActions.length).toBe(2)
      expect(customerActions.every(a => a.target === 'Customer/123')).toBe(true)
    })

    it('lists actions by status', async () => {
      const ns = uniqueNs('actions-list-status')
      const stub = getDOStub(ns)

      const a1 = await stub.actions.log({ verb: 'op1', target: 't1' })
      await stub.actions.log({ verb: 'op2', target: 't2' })
      await stub.actions.complete(a1.id, {})

      const pending = await stub.actions.list({ status: 'pending' })
      const completed = await stub.actions.list({ status: 'completed' })

      expect(pending.length).toBe(1)
      expect(completed.length).toBe(1)
    })

    it('gets pending actions', async () => {
      const ns = uniqueNs('actions-pending')
      const stub = getDOStub(ns)

      await stub.actions.log({ verb: 'op1', target: 't1' })
      await stub.actions.log({ verb: 'op2', target: 't2' })

      const pending = await stub.actions.pending()

      expect(pending.length).toBe(2)
      expect(pending.every(a => a.status === 'pending')).toBe(true)
    })

    it('gets failed actions', async () => {
      const ns = uniqueNs('actions-failed')
      const stub = getDOStub(ns)

      const a1 = await stub.actions.log({ verb: 'op1', target: 't1' })
      await stub.actions.log({ verb: 'op2', target: 't2' })
      await stub.actions.fail(a1.id, new Error('Failed'))

      const failed = await stub.actions.failed()

      expect(failed.length).toBe(1)
      expect(failed[0].status).toBe('failed')
    })
  })
})

// ============================================================================
// TEST SUITE 5: Query Filters and Performance
// ============================================================================

describe('Query Filters and Index Performance', () => {
  it('validates orderBy column against whitelist', async () => {
    const ns = uniqueNs('query-validate-order')
    const stub = getDOStub(ns)

    // Valid columns should work
    const result = await stub.things.list({ orderBy: 'name' })
    expect(result).toBeInstanceOf(Array)

    // Invalid columns should throw
    await expect(
      stub.things.list({ orderBy: 'invalid_column; DROP TABLE things;--' } as any)
    ).rejects.toThrow(/Invalid order column/i)
  })

  it('validates JSON paths for injection prevention', async () => {
    const ns = uniqueNs('query-validate-json')
    const stub = getDOStub(ns)

    await stub.things.create({
      $type: 'Test',
      name: 'Test',
      data: { status: 'active' },
    })

    // Valid paths should work
    const result = await stub.things.list({
      where: { 'data.status': 'active' },
    })
    expect(result.length).toBe(1)

    // Invalid paths should throw (paths with SQL injection attempts)
    await expect(
      stub.things.list({
        where: { 'data; DROP TABLE': 'value' },
      })
    ).rejects.toThrow(/Invalid JSON path/i)
  })

  it('handles large result sets with pagination', async () => {
    const ns = uniqueNs('query-large')
    const stub = getDOStub(ns)

    // Create 50 items
    for (let i = 0; i < 50; i++) {
      await stub.things.create({
        $type: 'Item',
        name: `Item ${i.toString().padStart(2, '0')}`,
      })
    }

    // Fetch in pages
    let allItems: any[] = []
    let offset = 0
    const pageSize = 10

    while (true) {
      const page = await stub.things.list({
        type: 'Item',
        limit: pageSize,
        offset,
        orderBy: 'name',
        order: 'asc',
      })

      allItems = allItems.concat(page)
      offset += pageSize

      if (page.length < pageSize) break
    }

    expect(allItems.length).toBe(50)
    // Verify ordering
    expect(allItems[0].name).toBe('Item 00')
    expect(allItems[49].name).toBe('Item 49')
  })
})

// ============================================================================
// TEST SUITE 6: Transaction-like Behavior
// ============================================================================

describe('Consistency and Durability', () => {
  it('maintains version history across updates', async () => {
    const ns = uniqueNs('consistency-versions')
    const stub = getDOStub(ns)

    const thing = await stub.things.create({
      $type: 'Document',
      name: 'Doc v1',
      data: { content: 'Initial' },
    })

    // Multiple updates
    await stub.things.update(thing.$id, { data: { content: 'Update 1' } })
    await stub.things.update(thing.$id, { data: { content: 'Update 2' } })
    await stub.things.update(thing.$id, { data: { content: 'Final' } })

    // All versions should be preserved
    const versions = await stub.things.versions(thing.$id)
    expect(versions.length).toBe(4)

    // Latest should be Final
    const latest = await stub.things.get(thing.$id)
    expect(latest?.data?.content).toBe('Final')

    // Can retrieve any version
    const v1 = await stub.things.get(thing.$id, { version: 1 })
    expect(v1?.data?.content).toBe('Initial')
  })

  it('soft delete preserves history for audit', async () => {
    const ns = uniqueNs('consistency-audit')
    const stub = getDOStub(ns)

    const thing = await stub.things.create({
      $type: 'AuditItem',
      name: 'Auditable',
      data: { sensitive: true },
    })

    await stub.things.update(thing.$id, { data: { modified: true } })
    await stub.things.delete(thing.$id)

    // History is preserved
    const versions = await stub.things.versions(thing.$id)
    expect(versions.length).toBe(3) // create, update, delete

    // Can see deletion in history
    const lastVersion = versions[versions.length - 1]
    expect(lastVersion.deleted).toBe(true)
  })

  it('events provide ordered audit trail', async () => {
    const ns = uniqueNs('consistency-events')
    const stub = getDOStub(ns)

    // Emit events in order
    const e1 = await stub.events.emit({ verb: 'Step1', source: 'workflow', data: {} })
    const e2 = await stub.events.emit({ verb: 'Step2', source: 'workflow', data: {} })
    const e3 = await stub.events.emit({ verb: 'Step3', source: 'workflow', data: {} })

    // List preserves order
    const events = await stub.events.list({ source: 'workflow' })

    // Sequence numbers are monotonically increasing
    expect(events[0].sequence).toBeLessThan(events[1].sequence)
    expect(events[1].sequence).toBeLessThan(events[2].sequence)
  })

  it('actions track complete workflow lifecycle', async () => {
    const ns = uniqueNs('consistency-workflow')
    const stub = getDOStub(ns)

    // Log action
    const action = await stub.actions.log({
      verb: 'processOrder',
      target: 'Order/123',
      input: { items: 3 },
      durability: 'do',
    })

    expect(action.status).toBe('pending')

    // Start processing (in real workflow, would transition to 'running')
    // Here we just complete it

    const completed = await stub.actions.complete(action.id, {
      result: 'processed',
      itemsProcessed: 3,
    })

    expect(completed.status).toBe('completed')
    expect(completed.duration).toBeGreaterThan(0)

    // Can query by status
    const completedActions = await stub.actions.list({ status: 'completed' })
    expect(completedActions.some(a => a.id === action.id)).toBe(true)
  })
})
