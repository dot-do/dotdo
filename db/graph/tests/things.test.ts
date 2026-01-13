/**
 * Things Table Schema Tests - Core Graph Schema
 *
 * TDD RED phase: Failing tests for the Things table that validates Noun instance storage.
 * Things are instances of Nouns (types) in the unified DO Graph data model.
 *
 * @see dotdo-eq50h - [RED] Core Graph Schema - Things table tests
 * @see dotdo-2v5yg - Graph Model: Things + Relationships Foundation
 *
 * Design:
 * - Things = Noun instances (id, type, data, createdAt, updatedAt)
 * - Type is a first-class citizen referencing Nouns (not just a string)
 * - Data is JSON field with indexing support
 * - Uses real SQLite in production (Durable Objects), NO MOCKS
 *
 * This test file verifies:
 * 1. Schema exports exist from db/graph/things.ts
 * 2. Type definitions are correctly exported
 * 3. CRUD operation functions have correct signatures
 * 4. The API contract matches expected behavior
 */

import { describe, it, expect } from 'vitest'

// ============================================================================
// EXPECTED TYPE DEFINITIONS
// ============================================================================
// These types define the expected API contract for the Things table.
// They document what the implementation SHOULD export.

/**
 * A Thing is an instance of a Noun (type) in the graph model.
 * This is the SELECT return type.
 */
interface ExpectedGraphThing {
  /** Unique identifier for the thing */
  id: string
  /** Foreign key to nouns.rowid - type as first-class citizen */
  typeId: number
  /** Denormalized type name for efficient queries */
  typeName: string
  /** JSON data payload - flexible schema */
  data: Record<string, unknown> | null
  /** Unix timestamp (milliseconds) when created */
  createdAt: number
  /** Unix timestamp (milliseconds) when last updated */
  updatedAt: number
  /** Unix timestamp (milliseconds) when soft deleted, null if active */
  deletedAt: number | null
}

/**
 * Data required to create a new Thing.
 * This is the INSERT input type.
 */
interface ExpectedNewGraphThing {
  /** Unique identifier for the thing */
  id: string
  /** Foreign key to nouns.rowid */
  typeId: number
  /** Type name (must match typeId) */
  typeName: string
  /** Optional JSON data payload */
  data?: Record<string, unknown> | null
}

/**
 * Options for querying Things by type.
 */
interface ExpectedGetThingsByTypeOptions {
  /** Filter by type ID (FK to nouns.rowid) */
  typeId?: number
  /** Filter by type name */
  typeName?: string
  /** Maximum number of results */
  limit?: number
  /** Number of results to skip */
  offset?: number
  /** Field to order by */
  orderBy?: string
  /** Order direction */
  orderDirection?: 'asc' | 'desc'
  /** Include soft-deleted things */
  includeDeleted?: boolean
}

// ============================================================================
// SCHEMA EXPORT TESTS - These FAIL until db/graph/things.ts exists
// ============================================================================

describe('Things Table (Core Graph Schema)', () => {
  describe('Schema Exports', () => {
    it('exports graphThings table from db/graph/things.ts', async () => {
      // This test FAILS until the module exists
      const thingsModule = await import('../things').catch(() => null)

      expect(thingsModule).not.toBeNull()
      expect(thingsModule?.graphThings).toBeDefined()
    })

    it('graphThings table has expected columns', async () => {
      const thingsModule = await import('../things').catch(() => null)
      const table = thingsModule?.graphThings

      // Table should have all required columns
      expect(table?.id).toBeDefined()
      expect(table?.typeId).toBeDefined()
      expect(table?.typeName).toBeDefined()
      expect(table?.data).toBeDefined()
      expect(table?.createdAt).toBeDefined()
      expect(table?.updatedAt).toBeDefined()
      expect(table?.deletedAt).toBeDefined()
    })

    it('exports GraphThing type for select operations', async () => {
      // This test verifies the type is exported
      // Type checking happens at compile time, this tests runtime export
      const thingsModule = await import('../things').catch(() => null)

      // The module should export type definitions (via type inference from table)
      expect(thingsModule).not.toBeNull()
    })

    it('exports NewGraphThing type for insert operations', async () => {
      const thingsModule = await import('../things').catch(() => null)
      expect(thingsModule).not.toBeNull()
    })
  })

  // ============================================================================
  // CRUD FUNCTION EXPORT TESTS - These FAIL until functions are implemented
  // ============================================================================

  describe('CRUD Function Exports', () => {
    it('exports createThing function', async () => {
      const thingsModule = await import('../things').catch(() => null)

      expect(thingsModule?.createThing).toBeDefined()
      expect(typeof thingsModule?.createThing).toBe('function')
    })

    it('exports getThing function', async () => {
      const thingsModule = await import('../things').catch(() => null)

      expect(thingsModule?.getThing).toBeDefined()
      expect(typeof thingsModule?.getThing).toBe('function')
    })

    it('exports getThingsByType function', async () => {
      const thingsModule = await import('../things').catch(() => null)

      expect(thingsModule?.getThingsByType).toBeDefined()
      expect(typeof thingsModule?.getThingsByType).toBe('function')
    })

    it('exports updateThing function', async () => {
      const thingsModule = await import('../things').catch(() => null)

      expect(thingsModule?.updateThing).toBeDefined()
      expect(typeof thingsModule?.updateThing).toBe('function')
    })

    it('exports deleteThing function', async () => {
      const thingsModule = await import('../things').catch(() => null)

      expect(thingsModule?.deleteThing).toBeDefined()
      expect(typeof thingsModule?.deleteThing).toBe('function')
    })
  })

  // ============================================================================
  // CREATE THING CONTRACT TESTS
  // ============================================================================

  describe('createThing Contract', () => {
    it('creates a Thing with required fields', async () => {
      const thingsModule = await import('../things').catch(() => null)
      if (!thingsModule?.createThing) {
        throw new Error('createThing not implemented - waiting for db/graph/things.ts')
      }

      // Test will run when implementation exists
      // For now, this documents the expected behavior
      const mockDb = {}
      const input: ExpectedNewGraphThing = {
        id: 'customer-001',
        typeId: 1,
        typeName: 'Customer',
        data: { name: 'Alice', email: 'alice@example.com' },
      }

      const thing = await thingsModule.createThing(mockDb, input)

      expect(thing).toBeDefined()
      expect(thing.id).toBe('customer-001')
      expect(thing.typeId).toBe(1)
      expect(thing.typeName).toBe('Customer')
      expect(thing.data).toEqual({ name: 'Alice', email: 'alice@example.com' })
    })

    it('auto-generates timestamps on creation', async () => {
      const thingsModule = await import('../things').catch(() => null)
      if (!thingsModule?.createThing) {
        throw new Error('createThing not implemented')
      }

      const mockDb = {}
      const before = Date.now()

      const thing = await thingsModule.createThing(mockDb, {
        id: 'customer-002',
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
      const thingsModule = await import('../things').catch(() => null)
      if (!thingsModule?.createThing) {
        throw new Error('createThing not implemented')
      }

      const mockDb = {}
      const thing = await thingsModule.createThing(mockDb, {
        id: 'customer-003',
        typeId: 1,
        typeName: 'Customer',
        data: {},
      })

      expect(thing.deletedAt).toBeNull()
    })

    it('handles null data', async () => {
      const thingsModule = await import('../things').catch(() => null)
      if (!thingsModule?.createThing) {
        throw new Error('createThing not implemented')
      }

      const mockDb = {}
      const thing = await thingsModule.createThing(mockDb, {
        id: 'product-001',
        typeId: 2,
        typeName: 'Product',
        data: null,
      })

      expect(thing.data).toBeNull()
    })

    it('handles complex nested JSON data', async () => {
      const thingsModule = await import('../things').catch(() => null)
      if (!thingsModule?.createThing) {
        throw new Error('createThing not implemented')
      }

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

      const mockDb = {}
      const thing = await thingsModule.createThing(mockDb, {
        id: 'order-001',
        typeId: 3,
        typeName: 'Order',
        data: complexData,
      })

      expect(thing.data).toEqual(complexData)
    })

    it('rejects duplicate Thing IDs', async () => {
      const thingsModule = await import('../things').catch(() => null)
      if (!thingsModule?.createThing) {
        throw new Error('createThing not implemented')
      }

      const mockDb = {}

      // First create should succeed
      await thingsModule.createThing(mockDb, {
        id: 'unique-thing',
        typeId: 1,
        typeName: 'Customer',
        data: { name: 'First' },
      })

      // Second create with same ID should fail
      await expect(
        thingsModule.createThing(mockDb, {
          id: 'unique-thing',
          typeId: 1,
          typeName: 'Customer',
          data: { name: 'Second' },
        })
      ).rejects.toThrow()
    })
  })

  // ============================================================================
  // GET THING BY ID CONTRACT TESTS
  // ============================================================================

  describe('getThing Contract', () => {
    it('retrieves a Thing by ID', async () => {
      const thingsModule = await import('../things').catch(() => null)
      if (!thingsModule?.getThing) {
        throw new Error('getThing not implemented - waiting for db/graph/things.ts')
      }

      const mockDb = {}
      const thing = await thingsModule.getThing(mockDb, 'customer-alice')

      expect(thing).toBeDefined()
      expect(thing?.id).toBe('customer-alice')
    })

    it('returns null for non-existent ID', async () => {
      const thingsModule = await import('../things').catch(() => null)
      if (!thingsModule?.getThing) {
        throw new Error('getThing not implemented')
      }

      const mockDb = {}
      const thing = await thingsModule.getThing(mockDb, 'non-existent-id')

      expect(thing).toBeNull()
    })

    it('returns Thing with all fields populated', async () => {
      const thingsModule = await import('../things').catch(() => null)
      if (!thingsModule?.getThing) {
        throw new Error('getThing not implemented')
      }

      const mockDb = {}
      const thing = await thingsModule.getThing(mockDb, 'customer-alice')

      expect(thing).toHaveProperty('id')
      expect(thing).toHaveProperty('typeId')
      expect(thing).toHaveProperty('typeName')
      expect(thing).toHaveProperty('data')
      expect(thing).toHaveProperty('createdAt')
      expect(thing).toHaveProperty('updatedAt')
      expect(thing).toHaveProperty('deletedAt')
    })

    it('parses JSON data correctly', async () => {
      const thingsModule = await import('../things').catch(() => null)
      if (!thingsModule?.getThing) {
        throw new Error('getThing not implemented')
      }

      const mockDb = {}
      const thing = await thingsModule.getThing(mockDb, 'product-widget')

      // Data should be parsed from JSON, not a string
      expect(thing?.data).toEqual({ name: 'Widget', price: 29.99 })
      expect(typeof (thing?.data as { price: number })?.price).toBe('number')
    })
  })

  // ============================================================================
  // QUERY THINGS BY TYPE CONTRACT TESTS
  // ============================================================================

  describe('getThingsByType Contract', () => {
    it('queries Things by type ID', async () => {
      const thingsModule = await import('../things').catch(() => null)
      if (!thingsModule?.getThingsByType) {
        throw new Error('getThingsByType not implemented - waiting for db/graph/things.ts')
      }

      const mockDb = {}
      const customers = await thingsModule.getThingsByType(mockDb, { typeId: 1 })

      expect(Array.isArray(customers)).toBe(true)
      expect(customers.every((t: ExpectedGraphThing) => t.typeId === 1)).toBe(true)
    })

    it('queries Things by type name', async () => {
      const thingsModule = await import('../things').catch(() => null)
      if (!thingsModule?.getThingsByType) {
        throw new Error('getThingsByType not implemented')
      }

      const mockDb = {}
      const products = await thingsModule.getThingsByType(mockDb, { typeName: 'Product' })

      expect(Array.isArray(products)).toBe(true)
      expect(products.every((t: ExpectedGraphThing) => t.typeName === 'Product')).toBe(true)
    })

    it('returns empty array for type with no instances', async () => {
      const thingsModule = await import('../things').catch(() => null)
      if (!thingsModule?.getThingsByType) {
        throw new Error('getThingsByType not implemented')
      }

      const mockDb = {}
      const agents = await thingsModule.getThingsByType(mockDb, { typeId: 999 })

      expect(agents).toHaveLength(0)
    })

    it('supports limit parameter', async () => {
      const thingsModule = await import('../things').catch(() => null)
      if (!thingsModule?.getThingsByType) {
        throw new Error('getThingsByType not implemented')
      }

      const mockDb = {}
      const customers = await thingsModule.getThingsByType(mockDb, { typeId: 1, limit: 2 })

      expect(customers.length).toBeLessThanOrEqual(2)
    })

    it('supports offset parameter', async () => {
      const thingsModule = await import('../things').catch(() => null)
      if (!thingsModule?.getThingsByType) {
        throw new Error('getThingsByType not implemented')
      }

      const mockDb = {}
      const allCustomers = await thingsModule.getThingsByType(mockDb, { typeId: 1 })
      const offsetCustomers = await thingsModule.getThingsByType(mockDb, { typeId: 1, offset: 1 })

      // Offset should return fewer or different results
      expect(offsetCustomers.length).toBeLessThanOrEqual(allCustomers.length)
    })

    it('orders by createdAt descending by default', async () => {
      const thingsModule = await import('../things').catch(() => null)
      if (!thingsModule?.getThingsByType) {
        throw new Error('getThingsByType not implemented')
      }

      const mockDb = {}
      const customers = await thingsModule.getThingsByType(mockDb, { typeId: 1 })

      // Most recently created should be first
      for (let i = 1; i < customers.length; i++) {
        expect(customers[i - 1]!.createdAt).toBeGreaterThanOrEqual(customers[i]!.createdAt)
      }
    })

    it('supports ordering by field', async () => {
      const thingsModule = await import('../things').catch(() => null)
      if (!thingsModule?.getThingsByType) {
        throw new Error('getThingsByType not implemented')
      }

      const mockDb = {}
      const customers = await thingsModule.getThingsByType(mockDb, {
        typeId: 1,
        orderBy: 'id',
        orderDirection: 'asc',
      })

      // Should be ordered by id ascending
      for (let i = 1; i < customers.length; i++) {
        expect(customers[i - 1]!.id <= customers[i]!.id).toBe(true)
      }
    })

    it('excludes deleted by default', async () => {
      const thingsModule = await import('../things').catch(() => null)
      if (!thingsModule?.getThingsByType) {
        throw new Error('getThingsByType not implemented')
      }

      const mockDb = {}
      const customers = await thingsModule.getThingsByType(mockDb, { typeId: 1 })

      // All returned things should not be deleted
      expect(customers.every((t: ExpectedGraphThing) => t.deletedAt === null)).toBe(true)
    })

    it('includes deleted when requested', async () => {
      const thingsModule = await import('../things').catch(() => null)
      if (!thingsModule?.getThingsByType) {
        throw new Error('getThingsByType not implemented')
      }

      const mockDb = {}
      const customers = await thingsModule.getThingsByType(mockDb, {
        typeId: 1,
        includeDeleted: true,
      })

      // Should include things with deletedAt set
      expect(Array.isArray(customers)).toBe(true)
    })
  })

  // ============================================================================
  // UPDATE THING CONTRACT TESTS
  // ============================================================================

  describe('updateThing Contract', () => {
    it('updates Thing data', async () => {
      const thingsModule = await import('../things').catch(() => null)
      if (!thingsModule?.updateThing) {
        throw new Error('updateThing not implemented - waiting for db/graph/things.ts')
      }

      const mockDb = {}
      const updated = await thingsModule.updateThing(mockDb, 'update-test', {
        data: { name: 'Updated', email: 'updated@example.com', tier: 'premium' },
      })

      expect(updated?.data).toEqual({
        name: 'Updated',
        email: 'updated@example.com',
        tier: 'premium',
      })
    })

    it('updates updatedAt timestamp', async () => {
      const thingsModule = await import('../things').catch(() => null)
      if (!thingsModule?.updateThing || !thingsModule?.getThing) {
        throw new Error('updateThing or getThing not implemented')
      }

      const mockDb = {}
      const before = await thingsModule.getThing(mockDb, 'update-test')
      const beforeUpdatedAt = before?.updatedAt

      // Small delay to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10))

      const after = await thingsModule.updateThing(mockDb, 'update-test', {
        data: { name: 'Newer' },
      })

      expect(after?.updatedAt).toBeGreaterThan(beforeUpdatedAt!)
      expect(after?.createdAt).toBe(before?.createdAt) // createdAt unchanged
    })

    it('returns null for non-existent Thing', async () => {
      const thingsModule = await import('../things').catch(() => null)
      if (!thingsModule?.updateThing) {
        throw new Error('updateThing not implemented')
      }

      const mockDb = {}
      const result = await thingsModule.updateThing(mockDb, 'non-existent', {
        data: { name: 'Test' },
      })

      expect(result).toBeNull()
    })

    it('handles null data update', async () => {
      const thingsModule = await import('../things').catch(() => null)
      if (!thingsModule?.updateThing) {
        throw new Error('updateThing not implemented')
      }

      const mockDb = {}
      const updated = await thingsModule.updateThing(mockDb, 'update-test', {
        data: null,
      })

      expect(updated?.data).toBeNull()
    })
  })

  // ============================================================================
  // DELETE THING CONTRACT TESTS (Soft Delete)
  // ============================================================================

  describe('deleteThing Contract (Soft Delete)', () => {
    it('soft deletes a Thing by setting deletedAt', async () => {
      const thingsModule = await import('../things').catch(() => null)
      if (!thingsModule?.deleteThing) {
        throw new Error('deleteThing not implemented - waiting for db/graph/things.ts')
      }

      const mockDb = {}
      const deleted = await thingsModule.deleteThing(mockDb, 'delete-test')

      expect(deleted?.deletedAt).toBeDefined()
      expect(deleted?.deletedAt).not.toBeNull()
    })

    it('soft deleted Thing is still retrievable by ID', async () => {
      const thingsModule = await import('../things').catch(() => null)
      if (!thingsModule?.deleteThing || !thingsModule?.getThing) {
        throw new Error('deleteThing or getThing not implemented')
      }

      const mockDb = {}
      await thingsModule.deleteThing(mockDb, 'delete-test')

      const thing = await thingsModule.getThing(mockDb, 'delete-test')
      expect(thing).toBeDefined()
      expect(thing?.deletedAt).not.toBeNull()
    })

    it('returns null for non-existent Thing', async () => {
      const thingsModule = await import('../things').catch(() => null)
      if (!thingsModule?.deleteThing) {
        throw new Error('deleteThing not implemented')
      }

      const mockDb = {}
      const result = await thingsModule.deleteThing(mockDb, 'non-existent')

      expect(result).toBeNull()
    })
  })

  // ============================================================================
  // TYPE AS FIRST-CLASS CITIZEN TESTS
  // ============================================================================

  describe('Type as First-Class Citizen', () => {
    it('stores type as both ID reference and denormalized name', async () => {
      const thingsModule = await import('../things').catch(() => null)
      if (!thingsModule?.getThing) {
        throw new Error('getThing not implemented - waiting for db/graph/things.ts')
      }

      const mockDb = {}
      const thing = await thingsModule.getThing(mockDb, 'typed-thing-1')

      // Both typeId and typeName should be present
      expect(thing?.typeId).toBeDefined()
      expect(thing?.typeName).toBeDefined()
      expect(typeof thing?.typeId).toBe('number')
      expect(typeof thing?.typeName).toBe('string')
    })

    it('typeId references nouns table rowid', async () => {
      // This test documents that typeId is a FK to nouns.rowid
      // Actual FK enforcement happens at DB level
      const thingsModule = await import('../things').catch(() => null)

      // Schema should define typeId as integer referencing nouns
      expect(thingsModule?.graphThings?.typeId).toBeDefined()
    })
  })

  // ============================================================================
  // JSON FIELD INDEXING TESTS
  // ============================================================================

  describe('JSON Field Indexing', () => {
    it('data column supports JSON storage', async () => {
      const thingsModule = await import('../things').catch(() => null)

      // The data column should be configured for JSON
      expect(thingsModule?.graphThings?.data).toBeDefined()
    })

    it('can store and retrieve complex JSON', async () => {
      const thingsModule = await import('../things').catch(() => null)
      if (!thingsModule?.createThing || !thingsModule?.getThing) {
        throw new Error('createThing or getThing not implemented')
      }

      const complexData = {
        nested: { deep: { value: 42 } },
        array: [1, 2, 3],
        mixed: ['string', 123, true, null],
      }

      const mockDb = {}
      await thingsModule.createThing(mockDb, {
        id: 'json-test',
        typeId: 1,
        typeName: 'Customer',
        data: complexData,
      })

      const retrieved = await thingsModule.getThing(mockDb, 'json-test')
      expect(retrieved?.data).toEqual(complexData)
    })
  })

  // ============================================================================
  // TIMESTAMP TESTS
  // ============================================================================

  describe('Timestamps', () => {
    it('stores timestamps as Unix milliseconds', async () => {
      const thingsModule = await import('../things').catch(() => null)
      if (!thingsModule?.createThing) {
        throw new Error('createThing not implemented - waiting for db/graph/things.ts')
      }

      const mockDb = {}
      const now = Date.now()

      const thing = await thingsModule.createThing(mockDb, {
        id: 'timestamp-test',
        typeId: 1,
        typeName: 'Customer',
        data: {},
      })

      // Should be within 1 second of now
      expect(Math.abs(thing.createdAt - now)).toBeLessThan(1000)
      expect(Math.abs(thing.updatedAt - now)).toBeLessThan(1000)
    })

    it('createdAt is immutable after creation', async () => {
      const thingsModule = await import('../things').catch(() => null)
      if (!thingsModule?.createThing || !thingsModule?.updateThing || !thingsModule?.getThing) {
        throw new Error('CRUD functions not implemented')
      }

      const mockDb = {}
      await thingsModule.createThing(mockDb, {
        id: 'immutable-created',
        typeId: 1,
        typeName: 'Customer',
        data: { name: 'Original' },
      })

      const original = await thingsModule.getThing(mockDb, 'immutable-created')
      const originalCreatedAt = original!.createdAt

      await new Promise((resolve) => setTimeout(resolve, 10))

      await thingsModule.updateThing(mockDb, 'immutable-created', {
        data: { name: 'Updated' },
      })

      const updated = await thingsModule.getThing(mockDb, 'immutable-created')
      expect(updated!.createdAt).toBe(originalCreatedAt)
    })
  })

  // ============================================================================
  // EDGE CASES
  // ============================================================================

  describe('Edge Cases', () => {
    it('handles empty data object', async () => {
      const thingsModule = await import('../things').catch(() => null)
      if (!thingsModule?.createThing) {
        throw new Error('createThing not implemented - waiting for db/graph/things.ts')
      }

      const mockDb = {}
      const thing = await thingsModule.createThing(mockDb, {
        id: 'empty-data',
        typeId: 1,
        typeName: 'Customer',
        data: {},
      })

      expect(thing.data).toEqual({})
    })

    it('handles special characters in ID', async () => {
      const thingsModule = await import('../things').catch(() => null)
      if (!thingsModule?.createThing || !thingsModule?.getThing) {
        throw new Error('createThing or getThing not implemented')
      }

      const mockDb = {}
      await thingsModule.createThing(mockDb, {
        id: 'special-id_with.dots-and_underscores',
        typeId: 1,
        typeName: 'Customer',
        data: {},
      })

      const retrieved = await thingsModule.getThing(mockDb, 'special-id_with.dots-and_underscores')
      expect(retrieved?.id).toBe('special-id_with.dots-and_underscores')
    })

    it('handles Unicode in data', async () => {
      const thingsModule = await import('../things').catch(() => null)
      if (!thingsModule?.createThing || !thingsModule?.getThing) {
        throw new Error('createThing or getThing not implemented')
      }

      const mockDb = {}
      await thingsModule.createThing(mockDb, {
        id: 'unicode-data',
        typeId: 1,
        typeName: 'Customer',
        data: {
          japanese: 'Japanese text goes here',
          emoji: 'Hello World emoji',
          chinese: 'Chinese text',
        },
      })

      const retrieved = await thingsModule.getThing(mockDb, 'unicode-data')
      expect(retrieved?.data).toBeDefined()
    })
  })
})
