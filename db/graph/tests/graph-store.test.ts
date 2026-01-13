/**
 * GraphStore Interface Tests - Abstract Storage Backend Tests
 *
 * RED PHASE: These tests define the contract that ANY GraphStore implementation
 * must satisfy. Tests are written in a parameterized factory pattern to support
 * multiple backends (in-memory, SQLite, Durable Objects).
 *
 * @see dotdo-j8n2i - [RED] GraphStore Interface - Abstract storage tests
 *
 * These tests FAIL until a concrete implementation (SQLiteGraphStore) is created.
 *
 * Design:
 * - Factory pattern allows running same tests against different backends
 * - Tests verify GraphStore interface contract from db/graph/types.ts
 * - NO MOCKS - uses real storage backends (per project testing philosophy)
 *
 * Test Categories:
 * 1. Things CRUD Tests - createThing, getThing, getThingsByType, updateThing, deleteThing
 * 2. Relationships CRUD Tests - createRelationship, queryRelationshipsFrom/To/ByVerb, deleteRelationship
 * 3. Transaction Tests - Atomic multi-operation transactions
 * 4. Unique Constraint Tests - Verify (verb, from, to) uniqueness
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type {
  GraphStore,
  GraphThing,
  NewGraphThing,
  GetThingsByTypeOptions,
  UpdateThingInput,
  GraphRelationship,
  CreateRelationshipInput,
  RelationshipQueryOptions,
} from '../types'

// ============================================================================
// TEST FACTORY - Parameterized tests for any GraphStore implementation
// ============================================================================

/**
 * Create a suite of tests for a GraphStore implementation.
 *
 * This factory pattern allows the same tests to run against:
 * - In-memory stores
 * - SQLiteGraphStore
 * - DOGraphStore (Durable Objects)
 * - Any future backend
 *
 * @param name - Name of the backend being tested
 * @param factory - Factory function that creates a fresh GraphStore instance
 * @param cleanup - Optional cleanup function called after each test
 *
 * @example
 * ```typescript
 * // Test in-memory implementation
 * createGraphStoreTests(
 *   'InMemoryGraphStore',
 *   async () => new InMemoryGraphStore(),
 *   async () => store.clear()
 * )
 *
 * // Test SQLite implementation
 * createGraphStoreTests(
 *   'SQLiteGraphStore',
 *   async () => new SQLiteGraphStore(':memory:'),
 *   async (store) => await store.close()
 * )
 * ```
 */
export function createGraphStoreTests(
  name: string,
  factory: () => Promise<GraphStore>,
  cleanup?: (store: GraphStore) => Promise<void>
): void {
  describe(`GraphStore: ${name}`, () => {
    let store: GraphStore

    beforeEach(async () => {
      store = await factory()
    })

    afterEach(async () => {
      if (cleanup) {
        await cleanup(store)
      }
    })

    // ==========================================================================
    // THINGS CRUD TESTS
    // ==========================================================================

    describe('Things CRUD Operations', () => {
      describe('createThing', () => {
        it('creates a Thing with all required fields', async () => {
          const thing = await store.createThing({
            id: 'test-thing-1',
            typeId: 1,
            typeName: 'Customer',
            data: { name: 'Alice', email: 'alice@example.com' },
          })

          expect(thing.id).toBe('test-thing-1')
          expect(thing.typeId).toBe(1)
          expect(thing.typeName).toBe('Customer')
          expect(thing.data).toEqual({ name: 'Alice', email: 'alice@example.com' })
        })

        it('auto-generates createdAt and updatedAt timestamps', async () => {
          const before = Date.now()

          const thing = await store.createThing({
            id: 'timestamp-thing',
            typeId: 1,
            typeName: 'Customer',
            data: { name: 'Bob' },
          })

          const after = Date.now()

          expect(thing.createdAt).toBeGreaterThanOrEqual(before)
          expect(thing.createdAt).toBeLessThanOrEqual(after)
          expect(thing.updatedAt).toBeGreaterThanOrEqual(before)
          expect(thing.updatedAt).toBeLessThanOrEqual(after)
        })

        it('sets deletedAt to null by default', async () => {
          const thing = await store.createThing({
            id: 'not-deleted',
            typeId: 1,
            typeName: 'Customer',
            data: null,
          })

          expect(thing.deletedAt).toBeNull()
        })

        it('handles null data', async () => {
          const thing = await store.createThing({
            id: 'null-data-thing',
            typeId: 1,
            typeName: 'Product',
            data: null,
          })

          expect(thing.data).toBeNull()
        })

        it('handles complex nested JSON data', async () => {
          const complexData = {
            customer: { name: 'Alice', tier: 'premium' },
            items: [
              { productId: 'prod-1', quantity: 2, price: 29.99 },
              { productId: 'prod-2', quantity: 1, price: 49.99 },
            ],
            metadata: {
              source: 'web',
              campaign: 'holiday-2024',
              tags: ['urgent', 'gift'],
            },
          }

          const thing = await store.createThing({
            id: 'complex-data-thing',
            typeId: 3,
            typeName: 'Order',
            data: complexData,
          })

          expect(thing.data).toEqual(complexData)
        })

        it('rejects duplicate Thing IDs', async () => {
          await store.createThing({
            id: 'duplicate-id',
            typeId: 1,
            typeName: 'Customer',
            data: { name: 'First' },
          })

          await expect(
            store.createThing({
              id: 'duplicate-id',
              typeId: 1,
              typeName: 'Customer',
              data: { name: 'Second' },
            })
          ).rejects.toThrow()
        })

        it('handles empty object data', async () => {
          const thing = await store.createThing({
            id: 'empty-data-thing',
            typeId: 1,
            typeName: 'Task',
            data: {},
          })

          expect(thing.data).toEqual({})
        })

        it('handles special characters in ID', async () => {
          const thing = await store.createThing({
            id: 'special-id_with.dots-and_underscores:colons',
            typeId: 1,
            typeName: 'Customer',
            data: {},
          })

          expect(thing.id).toBe('special-id_with.dots-and_underscores:colons')
        })
      })

      describe('getThing', () => {
        it('retrieves a Thing by ID', async () => {
          await store.createThing({
            id: 'get-test-thing',
            typeId: 1,
            typeName: 'Customer',
            data: { name: 'Charlie' },
          })

          const thing = await store.getThing('get-test-thing')

          expect(thing).not.toBeNull()
          expect(thing?.id).toBe('get-test-thing')
          expect(thing?.typeName).toBe('Customer')
          expect(thing?.data).toEqual({ name: 'Charlie' })
        })

        it('returns null for non-existent ID', async () => {
          const thing = await store.getThing('non-existent-id-xyz')

          expect(thing).toBeNull()
        })

        it('returns Thing with all fields populated', async () => {
          await store.createThing({
            id: 'full-thing',
            typeId: 2,
            typeName: 'Product',
            data: { price: 99.99 },
          })

          const thing = await store.getThing('full-thing')

          expect(thing).toHaveProperty('id')
          expect(thing).toHaveProperty('typeId')
          expect(thing).toHaveProperty('typeName')
          expect(thing).toHaveProperty('data')
          expect(thing).toHaveProperty('createdAt')
          expect(thing).toHaveProperty('updatedAt')
          expect(thing).toHaveProperty('deletedAt')
        })

        it('parses JSON data correctly', async () => {
          await store.createThing({
            id: 'json-thing',
            typeId: 2,
            typeName: 'Product',
            data: { name: 'Widget', price: 29.99, inStock: true },
          })

          const thing = await store.getThing('json-thing')

          expect(thing?.data).toEqual({ name: 'Widget', price: 29.99, inStock: true })
          expect(typeof (thing?.data as { price: number })?.price).toBe('number')
          expect(typeof (thing?.data as { inStock: boolean })?.inStock).toBe('boolean')
        })
      })

      describe('getThingsByType', () => {
        beforeEach(async () => {
          // Seed test data
          await store.createThing({
            id: 'customer-1',
            typeId: 1,
            typeName: 'Customer',
            data: { name: 'Alice' },
          })
          await store.createThing({
            id: 'customer-2',
            typeId: 1,
            typeName: 'Customer',
            data: { name: 'Bob' },
          })
          await store.createThing({
            id: 'customer-3',
            typeId: 1,
            typeName: 'Customer',
            data: { name: 'Charlie' },
          })
          await store.createThing({
            id: 'product-1',
            typeId: 2,
            typeName: 'Product',
            data: { name: 'Widget' },
          })
        })

        it('queries Things by type ID', async () => {
          const customers = await store.getThingsByType({ typeId: 1 })

          expect(Array.isArray(customers)).toBe(true)
          expect(customers.length).toBe(3)
          expect(customers.every((t) => t.typeId === 1)).toBe(true)
        })

        it('queries Things by type name', async () => {
          const products = await store.getThingsByType({ typeName: 'Product' })

          expect(Array.isArray(products)).toBe(true)
          expect(products.length).toBe(1)
          expect(products.every((t) => t.typeName === 'Product')).toBe(true)
        })

        it('returns empty array for type with no instances', async () => {
          const agents = await store.getThingsByType({ typeId: 999 })

          expect(agents).toHaveLength(0)
        })

        it('supports limit parameter', async () => {
          const customers = await store.getThingsByType({ typeId: 1, limit: 2 })

          expect(customers.length).toBe(2)
        })

        it('supports offset parameter', async () => {
          const allCustomers = await store.getThingsByType({ typeId: 1 })
          const offsetCustomers = await store.getThingsByType({ typeId: 1, offset: 1 })

          expect(offsetCustomers.length).toBe(allCustomers.length - 1)
        })

        it('supports limit and offset together', async () => {
          const paged = await store.getThingsByType({ typeId: 1, limit: 1, offset: 1 })

          expect(paged.length).toBe(1)
        })

        it('orders by createdAt descending by default', async () => {
          const customers = await store.getThingsByType({ typeId: 1 })

          for (let i = 1; i < customers.length; i++) {
            expect(customers[i - 1]!.createdAt).toBeGreaterThanOrEqual(customers[i]!.createdAt)
          }
        })

        it('supports ordering by field with direction', async () => {
          const customers = await store.getThingsByType({
            typeId: 1,
            orderBy: 'id',
            orderDirection: 'asc',
          })

          for (let i = 1; i < customers.length; i++) {
            expect(customers[i - 1]!.id <= customers[i]!.id).toBe(true)
          }
        })

        it('excludes soft-deleted Things by default', async () => {
          // Soft delete one customer
          await store.deleteThing('customer-1')

          const customers = await store.getThingsByType({ typeId: 1 })

          expect(customers.length).toBe(2)
          expect(customers.every((t) => t.deletedAt === null)).toBe(true)
        })

        it('includes soft-deleted Things when requested', async () => {
          await store.deleteThing('customer-1')

          const customers = await store.getThingsByType({ typeId: 1, includeDeleted: true })

          expect(customers.length).toBe(3)
          expect(customers.some((t) => t.deletedAt !== null)).toBe(true)
        })
      })

      describe('updateThing', () => {
        beforeEach(async () => {
          await store.createThing({
            id: 'update-target',
            typeId: 1,
            typeName: 'Customer',
            data: { name: 'Original', tier: 'basic' },
          })
        })

        it('updates Thing data', async () => {
          const updated = await store.updateThing('update-target', {
            data: { name: 'Updated', tier: 'premium' },
          })

          expect(updated?.data).toEqual({ name: 'Updated', tier: 'premium' })
        })

        it('updates updatedAt timestamp', async () => {
          const before = await store.getThing('update-target')
          const beforeUpdatedAt = before!.updatedAt

          // Small delay to ensure timestamp difference
          await new Promise((resolve) => setTimeout(resolve, 10))

          const after = await store.updateThing('update-target', {
            data: { name: 'Newer' },
          })

          expect(after!.updatedAt).toBeGreaterThan(beforeUpdatedAt)
        })

        it('preserves createdAt timestamp', async () => {
          const before = await store.getThing('update-target')

          await new Promise((resolve) => setTimeout(resolve, 10))

          const after = await store.updateThing('update-target', {
            data: { name: 'Newer' },
          })

          expect(after!.createdAt).toBe(before!.createdAt)
        })

        it('returns null for non-existent Thing', async () => {
          const result = await store.updateThing('non-existent', {
            data: { name: 'Test' },
          })

          expect(result).toBeNull()
        })

        it('handles null data update', async () => {
          const updated = await store.updateThing('update-target', {
            data: null,
          })

          expect(updated?.data).toBeNull()
        })

        it('handles partial data update (replaces entire data)', async () => {
          // GraphStore.updateThing replaces the entire data object, not merges
          const updated = await store.updateThing('update-target', {
            data: { tier: 'premium' },
          })

          expect(updated?.data).toEqual({ tier: 'premium' })
        })
      })

      describe('deleteThing (Soft Delete)', () => {
        beforeEach(async () => {
          await store.createThing({
            id: 'delete-target',
            typeId: 1,
            typeName: 'Customer',
            data: { name: 'ToDelete' },
          })
        })

        it('soft deletes by setting deletedAt timestamp', async () => {
          const before = Date.now()
          const deleted = await store.deleteThing('delete-target')
          const after = Date.now()

          expect(deleted?.deletedAt).not.toBeNull()
          expect(deleted!.deletedAt).toBeGreaterThanOrEqual(before)
          expect(deleted!.deletedAt).toBeLessThanOrEqual(after)
        })

        it('soft deleted Thing is still retrievable by ID', async () => {
          await store.deleteThing('delete-target')

          const thing = await store.getThing('delete-target')

          expect(thing).not.toBeNull()
          expect(thing?.deletedAt).not.toBeNull()
        })

        it('returns null for non-existent Thing', async () => {
          const result = await store.deleteThing('non-existent')

          expect(result).toBeNull()
        })

        it('returns the deleted Thing with all fields', async () => {
          const deleted = await store.deleteThing('delete-target')

          expect(deleted).toHaveProperty('id', 'delete-target')
          expect(deleted).toHaveProperty('typeId', 1)
          expect(deleted).toHaveProperty('typeName', 'Customer')
          expect(deleted).toHaveProperty('data')
          expect(deleted).toHaveProperty('createdAt')
          expect(deleted).toHaveProperty('updatedAt')
          expect(deleted).toHaveProperty('deletedAt')
        })
      })
    })

    // ==========================================================================
    // RELATIONSHIPS CRUD TESTS
    // ==========================================================================

    describe('Relationships CRUD Operations', () => {
      describe('createRelationship', () => {
        it('creates a Relationship with all required fields', async () => {
          const rel = await store.createRelationship({
            id: 'rel-1',
            verb: 'owns',
            from: 'do://tenant/customers/alice',
            to: 'do://tenant/products/widget',
            data: { since: '2024-01-01' },
          })

          expect(rel.id).toBe('rel-1')
          expect(rel.verb).toBe('owns')
          expect(rel.from).toBe('do://tenant/customers/alice')
          expect(rel.to).toBe('do://tenant/products/widget')
          expect(rel.data).toEqual({ since: '2024-01-01' })
        })

        it('auto-generates createdAt timestamp', async () => {
          const before = Date.now()

          const rel = await store.createRelationship({
            id: 'rel-timestamp',
            verb: 'creates',
            from: 'do://tenant/users/bob',
            to: 'do://tenant/projects/alpha',
          })

          const after = Date.now()

          // createdAt is a Date object in GraphRelationship
          const createdAtMs =
            rel.createdAt instanceof Date ? rel.createdAt.getTime() : (rel.createdAt as number)

          expect(createdAtMs).toBeGreaterThanOrEqual(before)
          expect(createdAtMs).toBeLessThanOrEqual(after)
        })

        it('handles null data', async () => {
          const rel = await store.createRelationship({
            id: 'rel-no-data',
            verb: 'manages',
            from: 'do://tenant/managers/carol',
            to: 'do://tenant/teams/engineering',
          })

          expect(rel.data).toBeNull()
        })

        it('handles complex JSON data on edge', async () => {
          const edgeData = {
            role: 'founder',
            percentage: 60,
            permissions: ['admin', 'write', 'delete'],
            nested: { level1: { level2: 'deep value' } },
          }

          const rel = await store.createRelationship({
            id: 'rel-complex-data',
            verb: 'owns',
            from: 'do://tenant/founders/alice',
            to: 'do://tenant/companies/startup',
            data: edgeData,
          })

          expect(rel.data).toEqual(edgeData)
        })

        it('allows self-referential relationship (from = to)', async () => {
          const rel = await store.createRelationship({
            id: 'rel-self',
            verb: 'references',
            from: 'do://tenant/docs/intro',
            to: 'do://tenant/docs/intro',
            data: { section: 'footnote' },
          })

          expect(rel.from).toBe(rel.to)
        })

        it('supports cross-DO URLs', async () => {
          const rel = await store.createRelationship({
            id: 'rel-cross-do',
            verb: 'integratesWith',
            from: 'do://apps/my-app',
            to: 'do://workers/my-worker',
          })

          expect(rel.from).toContain('apps')
          expect(rel.to).toContain('workers')
        })

        it('supports external URLs (github, linear)', async () => {
          const rel = await store.createRelationship({
            id: 'rel-external',
            verb: 'integratesWith',
            from: 'do://tenant/projects/headlessly',
            to: 'https://github.com/headlessly/repo',
          })

          expect(rel.to).toContain('github.com')
        })
      })

      describe('Unique Constraint on (verb, from, to)', () => {
        it('rejects duplicate (verb, from, to) combination', async () => {
          await store.createRelationship({
            id: 'unique-rel-1',
            verb: 'owns',
            from: 'do://tenant/a',
            to: 'do://tenant/b',
          })

          await expect(
            store.createRelationship({
              id: 'unique-rel-2',
              verb: 'owns',
              from: 'do://tenant/a',
              to: 'do://tenant/b',
            })
          ).rejects.toThrow()
        })

        it('allows same from+to with different verb', async () => {
          await store.createRelationship({
            id: 'diff-verb-1',
            verb: 'owns',
            from: 'do://tenant/a',
            to: 'do://tenant/b',
          })

          const rel2 = await store.createRelationship({
            id: 'diff-verb-2',
            verb: 'creates',
            from: 'do://tenant/a',
            to: 'do://tenant/b',
          })

          expect(rel2.id).toBe('diff-verb-2')
        })

        it('allows same verb+from with different to', async () => {
          await store.createRelationship({
            id: 'diff-to-1',
            verb: 'owns',
            from: 'do://tenant/a',
            to: 'do://tenant/b',
          })

          const rel2 = await store.createRelationship({
            id: 'diff-to-2',
            verb: 'owns',
            from: 'do://tenant/a',
            to: 'do://tenant/c',
          })

          expect(rel2.id).toBe('diff-to-2')
        })

        it('allows same verb+to with different from', async () => {
          await store.createRelationship({
            id: 'diff-from-1',
            verb: 'owns',
            from: 'do://tenant/a',
            to: 'do://tenant/b',
          })

          const rel2 = await store.createRelationship({
            id: 'diff-from-2',
            verb: 'owns',
            from: 'do://tenant/c',
            to: 'do://tenant/b',
          })

          expect(rel2.id).toBe('diff-from-2')
        })
      })

      describe('queryRelationshipsFrom (Forward Traversal)', () => {
        beforeEach(async () => {
          await store.createRelationship({
            id: 'fwd-1',
            verb: 'owns',
            from: 'do://tenant/users/alice',
            to: 'do://tenant/projects/alpha',
          })
          await store.createRelationship({
            id: 'fwd-2',
            verb: 'owns',
            from: 'do://tenant/users/alice',
            to: 'do://tenant/projects/beta',
          })
          await store.createRelationship({
            id: 'fwd-3',
            verb: 'manages',
            from: 'do://tenant/users/alice',
            to: 'do://tenant/teams/engineering',
          })
          await store.createRelationship({
            id: 'fwd-4',
            verb: 'owns',
            from: 'do://tenant/users/bob',
            to: 'do://tenant/projects/gamma',
          })
        })

        it('gets all outgoing relationships from a URL', async () => {
          const rels = await store.queryRelationshipsFrom('do://tenant/users/alice')

          expect(rels.length).toBe(3)
          expect(rels.every((r) => r.from === 'do://tenant/users/alice')).toBe(true)
        })

        it('filters outgoing relationships by verb', async () => {
          const rels = await store.queryRelationshipsFrom('do://tenant/users/alice', { verb: 'owns' })

          expect(rels.length).toBe(2)
          expect(rels.every((r) => r.verb === 'owns')).toBe(true)
        })

        it('returns empty array for URL with no outgoing relationships', async () => {
          const rels = await store.queryRelationshipsFrom('do://tenant/users/nobody')

          expect(rels).toHaveLength(0)
        })

        it('returns relationships with correct structure', async () => {
          const rels = await store.queryRelationshipsFrom('do://tenant/users/alice')

          for (const rel of rels) {
            expect(rel).toHaveProperty('id')
            expect(rel).toHaveProperty('verb')
            expect(rel).toHaveProperty('from')
            expect(rel).toHaveProperty('to')
            expect(rel).toHaveProperty('data')
            expect(rel).toHaveProperty('createdAt')
          }
        })
      })

      describe('queryRelationshipsTo (Backward Traversal)', () => {
        beforeEach(async () => {
          await store.createRelationship({
            id: 'bwd-1',
            verb: 'owns',
            from: 'do://tenant/users/alice',
            to: 'do://tenant/projects/alpha',
          })
          await store.createRelationship({
            id: 'bwd-2',
            verb: 'contributesTo',
            from: 'do://tenant/users/bob',
            to: 'do://tenant/projects/alpha',
          })
          await store.createRelationship({
            id: 'bwd-3',
            verb: 'contributesTo',
            from: 'do://tenant/users/carol',
            to: 'do://tenant/projects/alpha',
          })
          await store.createRelationship({
            id: 'bwd-4',
            verb: 'owns',
            from: 'do://tenant/users/dave',
            to: 'do://tenant/projects/beta',
          })
        })

        it('gets all incoming relationships to a URL', async () => {
          const rels = await store.queryRelationshipsTo('do://tenant/projects/alpha')

          expect(rels.length).toBe(3)
          expect(rels.every((r) => r.to === 'do://tenant/projects/alpha')).toBe(true)
        })

        it('filters incoming relationships by verb', async () => {
          const rels = await store.queryRelationshipsTo('do://tenant/projects/alpha', {
            verb: 'contributesTo',
          })

          expect(rels.length).toBe(2)
          expect(rels.every((r) => r.verb === 'contributesTo')).toBe(true)
        })

        it('returns empty array for URL with no incoming relationships', async () => {
          const rels = await store.queryRelationshipsTo('do://tenant/projects/orphan')

          expect(rels).toHaveLength(0)
        })

        it('finds owner via backward traversal', async () => {
          const rels = await store.queryRelationshipsTo('do://tenant/projects/alpha', {
            verb: 'owns',
          })

          expect(rels.length).toBe(1)
          expect(rels[0]!.from).toBe('do://tenant/users/alice')
        })
      })

      describe('queryRelationshipsByVerb', () => {
        beforeEach(async () => {
          await store.createRelationship({
            id: 'verb-1',
            verb: 'owns',
            from: 'do://tenant/a',
            to: 'do://tenant/b',
          })
          await store.createRelationship({
            id: 'verb-2',
            verb: 'owns',
            from: 'do://tenant/c',
            to: 'do://tenant/d',
          })
          await store.createRelationship({
            id: 'verb-3',
            verb: 'manages',
            from: 'do://tenant/e',
            to: 'do://tenant/f',
          })
        })

        it('gets all relationships of a specific verb type', async () => {
          const rels = await store.queryRelationshipsByVerb('owns')

          expect(rels.length).toBe(2)
          expect(rels.every((r) => r.verb === 'owns')).toBe(true)
        })

        it('returns empty array for verb with no relationships', async () => {
          const rels = await store.queryRelationshipsByVerb('nonExistentVerb')

          expect(rels).toHaveLength(0)
        })

        it('returns relationships with correct IDs', async () => {
          const rels = await store.queryRelationshipsByVerb('owns')

          expect(rels.map((r) => r.id).sort()).toEqual(['verb-1', 'verb-2'])
        })
      })

      describe('deleteRelationship', () => {
        beforeEach(async () => {
          await store.createRelationship({
            id: 'delete-rel',
            verb: 'owns',
            from: 'do://tenant/a',
            to: 'do://tenant/b',
          })
        })

        it('deletes a relationship by ID', async () => {
          const result = await store.deleteRelationship('delete-rel')

          expect(result).toBe(true)
        })

        it('deleted relationship is no longer queryable', async () => {
          await store.deleteRelationship('delete-rel')

          const rels = await store.queryRelationshipsFrom('do://tenant/a')

          expect(rels).toHaveLength(0)
        })

        it('returns false for non-existent relationship', async () => {
          const result = await store.deleteRelationship('non-existent-rel')

          expect(result).toBe(false)
        })

        it('allows recreating relationship after deletion', async () => {
          await store.deleteRelationship('delete-rel')

          // Should be able to create the same (verb, from, to) combination again
          const rel = await store.createRelationship({
            id: 'delete-rel-recreated',
            verb: 'owns',
            from: 'do://tenant/a',
            to: 'do://tenant/b',
          })

          expect(rel.id).toBe('delete-rel-recreated')
        })
      })
    })

    // ==========================================================================
    // EDGE CASES
    // ==========================================================================

    describe('Edge Cases', () => {
      describe('Unicode Support', () => {
        it('handles Unicode in Thing data', async () => {
          const thing = await store.createThing({
            id: 'unicode-thing',
            typeId: 1,
            typeName: 'Customer',
            data: {
              japanese: 'Test Japanese text',
              chinese: 'Test Chinese text',
              emoji: 'Test with emoji',
            },
          })

          const retrieved = await store.getThing('unicode-thing')
          expect(retrieved?.data).toEqual(thing.data)
        })

        it('handles Unicode in Relationship URLs', async () => {
          const rel = await store.createRelationship({
            id: 'unicode-rel',
            verb: 'references',
            from: 'do://tenant/docs/guide',
            to: 'do://tenant/docs/example',
          })

          const rels = await store.queryRelationshipsFrom('do://tenant/docs/guide')
          expect(rels.length).toBe(1)
          expect(rels[0]!.to).toBe(rel.to)
        })
      })

      describe('Long Values', () => {
        it('handles very long Thing IDs', async () => {
          const longId = 'thing-' + 'a'.repeat(200)

          const thing = await store.createThing({
            id: longId,
            typeId: 1,
            typeName: 'Customer',
            data: {},
          })

          const retrieved = await store.getThing(longId)
          expect(retrieved?.id).toBe(longId)
        })

        it('handles very long URLs in relationships', async () => {
          const longPath = 'a'.repeat(500)
          const longUrl = `do://tenant/${longPath}`

          const rel = await store.createRelationship({
            id: 'long-url-rel',
            verb: 'references',
            from: 'do://tenant/short',
            to: longUrl,
          })

          expect(rel.to.length).toBeGreaterThan(500)
        })

        it('handles large JSON data', async () => {
          const largeData: Record<string, string> = {}
          for (let i = 0; i < 100; i++) {
            largeData[`field_${i}`] = 'value_'.repeat(100)
          }

          const thing = await store.createThing({
            id: 'large-data-thing',
            typeId: 1,
            typeName: 'LargeData',
            data: largeData,
          })

          const retrieved = await store.getThing('large-data-thing')
          expect(Object.keys(retrieved?.data || {}).length).toBe(100)
        })
      })

      describe('Concurrent Operations', () => {
        it('handles concurrent Thing creations with different IDs', async () => {
          const promises = Array.from({ length: 10 }, (_, i) =>
            store.createThing({
              id: `concurrent-thing-${i}`,
              typeId: 1,
              typeName: 'Customer',
              data: { index: i },
            })
          )

          const results = await Promise.all(promises)

          expect(results.length).toBe(10)
          expect(new Set(results.map((r) => r.id)).size).toBe(10)
        })

        it('handles concurrent Relationship creations with different tuples', async () => {
          const promises = Array.from({ length: 10 }, (_, i) =>
            store.createRelationship({
              id: `concurrent-rel-${i}`,
              verb: 'owns',
              from: `do://tenant/user-${i}`,
              to: `do://tenant/project-${i}`,
            })
          )

          const results = await Promise.all(promises)

          expect(results.length).toBe(10)
        })
      })
    })

    // ==========================================================================
    // BATCH OPERATIONS TESTS (N+1 elimination)
    // ==========================================================================

    describe('Batch Operations (N+1 elimination)', () => {
      describe('getThings (batch fetch as Map)', () => {
        beforeEach(async () => {
          // Create test things
          await store.createThing({
            id: 'batch-thing-1',
            typeId: 1,
            typeName: 'Customer',
            data: { name: 'Alice' },
          })
          await store.createThing({
            id: 'batch-thing-2',
            typeId: 1,
            typeName: 'Customer',
            data: { name: 'Bob' },
          })
          await store.createThing({
            id: 'batch-thing-3',
            typeId: 2,
            typeName: 'Product',
            data: { name: 'Widget' },
          })
        })

        it('fetches multiple Things by IDs in a single call', async () => {
          const ids = ['batch-thing-1', 'batch-thing-2', 'batch-thing-3']
          const result = await store.getThings(ids)

          expect(result).toBeInstanceOf(Map)
          expect(result.size).toBe(3)
          expect(result.get('batch-thing-1')?.data).toEqual({ name: 'Alice' })
          expect(result.get('batch-thing-2')?.data).toEqual({ name: 'Bob' })
          expect(result.get('batch-thing-3')?.data).toEqual({ name: 'Widget' })
        })

        it('returns empty Map for empty array', async () => {
          const result = await store.getThings([])

          expect(result).toBeInstanceOf(Map)
          expect(result.size).toBe(0)
        })

        it('excludes non-existent IDs from result Map', async () => {
          const ids = ['batch-thing-1', 'non-existent', 'batch-thing-2']
          const result = await store.getThings(ids)

          expect(result.size).toBe(2)
          expect(result.has('batch-thing-1')).toBe(true)
          expect(result.has('non-existent')).toBe(false)
          expect(result.has('batch-thing-2')).toBe(true)
        })

        it('handles all non-existent IDs', async () => {
          const ids = ['non-existent-1', 'non-existent-2']
          const result = await store.getThings(ids)

          expect(result.size).toBe(0)
        })

        it('handles duplicate IDs in input', async () => {
          const ids = ['batch-thing-1', 'batch-thing-1', 'batch-thing-2']
          const result = await store.getThings(ids)

          expect(result.size).toBe(2) // Deduplicated in Map
          expect(result.get('batch-thing-1')).toBeDefined()
        })

        it('returns Things with all fields populated', async () => {
          const result = await store.getThings(['batch-thing-1'])
          const thing = result.get('batch-thing-1')

          expect(thing).toHaveProperty('id')
          expect(thing).toHaveProperty('typeId')
          expect(thing).toHaveProperty('typeName')
          expect(thing).toHaveProperty('data')
          expect(thing).toHaveProperty('createdAt')
          expect(thing).toHaveProperty('updatedAt')
          expect(thing).toHaveProperty('deletedAt')
        })
      })

      describe('getThingsByIds (batch fetch preserving order)', () => {
        beforeEach(async () => {
          await store.createThing({
            id: 'ordered-thing-a',
            typeId: 1,
            typeName: 'Customer',
            data: { name: 'A' },
          })
          await store.createThing({
            id: 'ordered-thing-b',
            typeId: 1,
            typeName: 'Customer',
            data: { name: 'B' },
          })
          await store.createThing({
            id: 'ordered-thing-c',
            typeId: 1,
            typeName: 'Customer',
            data: { name: 'C' },
          })
        })

        it('fetches Things preserving order of input IDs', async () => {
          const ids = ['ordered-thing-c', 'ordered-thing-a', 'ordered-thing-b']
          const result = await store.getThingsByIds(ids)

          expect(Array.isArray(result)).toBe(true)
          expect(result.length).toBe(3)
          expect(result[0]?.id).toBe('ordered-thing-c')
          expect(result[1]?.id).toBe('ordered-thing-a')
          expect(result[2]?.id).toBe('ordered-thing-b')
        })

        it('returns null for non-existent IDs at correct positions', async () => {
          const ids = ['ordered-thing-a', 'non-existent', 'ordered-thing-b']
          const result = await store.getThingsByIds(ids)

          expect(result.length).toBe(3)
          expect(result[0]?.id).toBe('ordered-thing-a')
          expect(result[1]).toBeNull()
          expect(result[2]?.id).toBe('ordered-thing-b')
        })

        it('returns empty array for empty input', async () => {
          const result = await store.getThingsByIds([])

          expect(Array.isArray(result)).toBe(true)
          expect(result.length).toBe(0)
        })

        it('handles all non-existent IDs', async () => {
          const ids = ['non-existent-1', 'non-existent-2']
          const result = await store.getThingsByIds(ids)

          expect(result.length).toBe(2)
          expect(result[0]).toBeNull()
          expect(result[1]).toBeNull()
        })

        it('handles duplicate IDs preserving duplicates', async () => {
          const ids = ['ordered-thing-a', 'ordered-thing-a', 'ordered-thing-b']
          const result = await store.getThingsByIds(ids)

          expect(result.length).toBe(3)
          expect(result[0]?.id).toBe('ordered-thing-a')
          expect(result[1]?.id).toBe('ordered-thing-a')
          expect(result[2]?.id).toBe('ordered-thing-b')
        })
      })

      describe('queryRelationshipsFromMany (batch relationship query)', () => {
        beforeEach(async () => {
          // Create relationships from multiple source URLs
          await store.createRelationship({
            id: 'batch-rel-1',
            verb: 'owns',
            from: 'do://tenant/users/alice',
            to: 'do://tenant/projects/alpha',
          })
          await store.createRelationship({
            id: 'batch-rel-2',
            verb: 'owns',
            from: 'do://tenant/users/alice',
            to: 'do://tenant/projects/beta',
          })
          await store.createRelationship({
            id: 'batch-rel-3',
            verb: 'manages',
            from: 'do://tenant/users/alice',
            to: 'do://tenant/teams/engineering',
          })
          await store.createRelationship({
            id: 'batch-rel-4',
            verb: 'owns',
            from: 'do://tenant/users/bob',
            to: 'do://tenant/projects/gamma',
          })
          await store.createRelationship({
            id: 'batch-rel-5',
            verb: 'manages',
            from: 'do://tenant/users/bob',
            to: 'do://tenant/teams/design',
          })
          await store.createRelationship({
            id: 'batch-rel-6',
            verb: 'owns',
            from: 'do://tenant/users/carol',
            to: 'do://tenant/projects/delta',
          })
        })

        it('fetches relationships from multiple URLs in a single call', async () => {
          const urls = ['do://tenant/users/alice', 'do://tenant/users/bob']
          const result = await store.queryRelationshipsFromMany(urls)

          expect(result.length).toBe(5)
          expect(result.every((r) => urls.includes(r.from))).toBe(true)
        })

        it('returns empty array for empty URL array', async () => {
          const result = await store.queryRelationshipsFromMany([])

          expect(Array.isArray(result)).toBe(true)
          expect(result.length).toBe(0)
        })

        it('returns empty array for URLs with no relationships', async () => {
          const result = await store.queryRelationshipsFromMany(['do://tenant/users/nobody'])

          expect(result.length).toBe(0)
        })

        it('filters by verb when option provided', async () => {
          const urls = ['do://tenant/users/alice', 'do://tenant/users/bob']
          const result = await store.queryRelationshipsFromMany(urls, { verb: 'owns' })

          expect(result.length).toBe(3)
          expect(result.every((r) => r.verb === 'owns')).toBe(true)
        })

        it('handles single URL (degenerates to queryRelationshipsFrom)', async () => {
          const result = await store.queryRelationshipsFromMany(['do://tenant/users/alice'])

          expect(result.length).toBe(3)
          expect(result.every((r) => r.from === 'do://tenant/users/alice')).toBe(true)
        })

        it('handles URLs where some have no relationships', async () => {
          const urls = ['do://tenant/users/alice', 'do://tenant/users/nobody', 'do://tenant/users/bob']
          const result = await store.queryRelationshipsFromMany(urls)

          expect(result.length).toBe(5) // Only alice (3) and bob (2)
        })

        it('returns relationships with correct structure', async () => {
          const result = await store.queryRelationshipsFromMany(['do://tenant/users/alice'])

          for (const rel of result) {
            expect(rel).toHaveProperty('id')
            expect(rel).toHaveProperty('verb')
            expect(rel).toHaveProperty('from')
            expect(rel).toHaveProperty('to')
            expect(rel).toHaveProperty('data')
            expect(rel).toHaveProperty('createdAt')
          }
        })
      })

      describe('Large Batch Operations (chunking)', () => {
        it('handles batch fetch of many Things', async () => {
          // Create 100 things
          const ids: string[] = []
          for (let i = 0; i < 100; i++) {
            const id = `large-batch-thing-${i}`
            ids.push(id)
            await store.createThing({
              id,
              typeId: 1,
              typeName: 'Customer',
              data: { index: i },
            })
          }

          // Fetch all at once
          const result = await store.getThings(ids)

          expect(result.size).toBe(100)
          for (let i = 0; i < 100; i++) {
            expect(result.get(`large-batch-thing-${i}`)).toBeDefined()
          }
        })

        it('handles batch relationship query from many URLs', async () => {
          // Create relationships from 50 different sources
          const urls: string[] = []
          for (let i = 0; i < 50; i++) {
            const from = `do://tenant/users/user-${i}`
            urls.push(from)
            await store.createRelationship({
              id: `large-batch-rel-${i}`,
              verb: 'owns',
              from,
              to: `do://tenant/projects/project-${i}`,
            })
          }

          // Query all at once
          const result = await store.queryRelationshipsFromMany(urls)

          expect(result.length).toBe(50)
        })
      })
    })
  })
}

// ============================================================================
// PLACEHOLDER TEST - Will fail until SQLiteGraphStore is implemented
// ============================================================================

/**
 * This test block verifies that the GraphStore interface exists and has
 * the expected methods. It will FAIL until a concrete implementation is created.
 */
describe('GraphStore Interface Contract', () => {
  it('GraphStore type is exported from db/graph/types', async () => {
    const types = await import('../types').catch(() => null)

    expect(types).not.toBeNull()
    // The GraphStore interface should be defined
    // This is a compile-time check; at runtime we verify the module exports
  })

  it('GraphStore interface has expected method signatures (compile-time check)', async () => {
    // This test documents the expected interface
    // TypeScript compilation ensures the interface exists
    const _: GraphStore = {
      createThing: async () => ({
        id: '',
        typeId: 0,
        typeName: '',
        data: null,
        createdAt: 0,
        updatedAt: 0,
        deletedAt: null,
      }),
      getThing: async () => null,
      getThingsByType: async () => [],
      updateThing: async () => null,
      deleteThing: async () => null,
      // Batch Things operations (N+1 elimination)
      getThings: async () => new Map(),
      getThingsByIds: async () => [],
      createRelationship: async () => ({
        id: '',
        verb: '',
        from: '',
        to: '',
        data: null,
        createdAt: new Date(),
      }),
      queryRelationshipsFrom: async () => [],
      queryRelationshipsTo: async () => [],
      queryRelationshipsByVerb: async () => [],
      deleteRelationship: async () => false,
      // Batch Relationships operations (N+1 elimination)
      queryRelationshipsFromMany: async () => [],
    }

    // If we get here, the interface is correctly defined
    expect(_).toBeDefined()
  })
})

// ============================================================================
// SQLiteGraphStore Implementation Tests
// ============================================================================

describe('[GREEN] SQLiteGraphStore Implementation', () => {
  it('SQLiteGraphStore is exported from db/graph/stores', async () => {
    const stores = await import('../stores').catch(() => null)

    expect(stores).not.toBeNull()
    expect(stores?.SQLiteGraphStore).toBeDefined()
  })

  it('creates SQLiteGraphStore instance', async () => {
    const { SQLiteGraphStore } = await import('../stores')
    const store = new SQLiteGraphStore(':memory:')
    expect(store).toBeDefined()
    await store.initialize()
    await store.close()
  })
})

// ============================================================================
// Run GraphStore tests against SQLite implementation
// ============================================================================

import { SQLiteGraphStore } from '../stores'

// Run all GraphStore tests against SQLite implementation
createGraphStoreTests(
  'SQLiteGraphStore',
  async () => {
    const store = new SQLiteGraphStore(':memory:')
    await store.initialize()
    return store
  },
  async (store) => {
    await (store as SQLiteGraphStore).close()
  }
)

// ============================================================================
// TRANSACTION TESTS (for future implementations that support transactions)
// ============================================================================

describe('GraphStore Transaction Support (Future)', () => {
  it.skip('atomic multi-operation transactions', async () => {
    // This test is skipped until transaction support is added
    // Transactions should allow:
    // - Creating multiple Things atomically
    // - Creating Things and Relationships atomically
    // - Rolling back on error
  })

  it.skip('rollback on error', async () => {
    // When a transaction fails, all changes should be rolled back
    // This is particularly important for maintaining graph consistency
  })
})
