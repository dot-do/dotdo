/**
 * DocumentStore - RED Phase Tests
 *
 * TDD RED phase: These tests define the expected behavior for DocumentStore,
 * a schema-free JSON document storage layer with JSONPath queries.
 * Tests should FAIL until implementation is complete.
 *
 * Based on: db/document/README.md
 *
 * Covers:
 * - CRUD operations (create, read, update, delete)
 * - JSONPath queries with nested field access
 * - Collection operations (list with filters, pagination)
 * - Batch operations
 * - CDC event emission
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'

// This import should FAIL until implementation exists
import { DocumentStore } from '../../../db/document'

// ============================================================================
// TYPE DEFINITIONS (Expected Interface)
// ============================================================================

interface Customer {
  $id: string
  $type: string
  $createdAt: number
  $updatedAt: number
  $version: number
  name: string
  email: string
  metadata?: {
    tier?: string
    joinedAt?: string
    preferences?: {
      notifications?: boolean
      theme?: string
    }
  }
}

interface Order {
  $id: string
  $type: string
  $createdAt: number
  $updatedAt: number
  $version: number
  customerId: string
  total: number
  status: string
  items: Array<{
    productId: string
    quantity: number
    price: number
  }>
}

interface CDCEvent {
  type: 'cdc.insert' | 'cdc.update' | 'cdc.delete'
  op: 'c' | 'u' | 'd'
  store: 'document'
  table: string
  key: string
  before?: Record<string, unknown>
  after?: Record<string, unknown>
}

// ============================================================================
// TEST SETUP
// ============================================================================

describe('DocumentStore - RED Phase', () => {
  let sqlite: Database.Database
  let db: ReturnType<typeof drizzle>
  let docs: DocumentStore<Customer>
  let cdcEvents: CDCEvent[]

  beforeEach(() => {
    sqlite = new Database(':memory:')
    db = drizzle(sqlite)
    cdcEvents = []

    // Create documents table as per schema in README
    sqlite.exec(`
      CREATE TABLE documents (
        "$id" TEXT PRIMARY KEY,
        "$type" TEXT NOT NULL,
        data JSON NOT NULL,
        "$createdAt" INTEGER NOT NULL,
        "$updatedAt" INTEGER NOT NULL,
        "$version" INTEGER NOT NULL DEFAULT 1
      );

      CREATE INDEX idx_documents_type ON documents("$type");
      CREATE INDEX idx_documents_updated ON documents("$updatedAt");
    `)

    // Create document store with CDC event capture
    docs = new DocumentStore<Customer>(db, {
      type: 'Customer',
      onEvent: (event: CDCEvent) => cdcEvents.push(event),
    })
  })

  afterEach(() => {
    sqlite.close()
  })

  // ============================================================================
  // CRUD OPERATIONS
  // ============================================================================

  describe('CRUD Operations', () => {
    describe('create()', () => {
      it('should create a document and return it with $id', async () => {
        const customer = await docs.create({
          name: 'Alice',
          email: 'alice@example.com',
          metadata: { tier: 'premium', joinedAt: '2024-01-01' },
        })

        expect(customer.$id).toBeDefined()
        expect(customer.$id).toMatch(/^[a-z0-9_-]+$/i)
        expect(customer.name).toBe('Alice')
        expect(customer.email).toBe('alice@example.com')
        expect(customer.metadata?.tier).toBe('premium')
      })

      it('should set $type, $createdAt, $updatedAt on create', async () => {
        const beforeCreate = Date.now()
        const customer = await docs.create({
          name: 'Bob',
          email: 'bob@example.com',
        })
        const afterCreate = Date.now()

        expect(customer.$type).toBe('Customer')
        expect(customer.$createdAt).toBeGreaterThanOrEqual(beforeCreate)
        expect(customer.$createdAt).toBeLessThanOrEqual(afterCreate)
        expect(customer.$updatedAt).toBe(customer.$createdAt)
        expect(customer.$version).toBe(1)
      })

      it('should store deeply nested JSON structures', async () => {
        const customer = await docs.create({
          name: 'Charlie',
          email: 'charlie@example.com',
          metadata: {
            tier: 'enterprise',
            preferences: {
              notifications: true,
              theme: 'dark',
            },
          },
        })

        const retrieved = await docs.get(customer.$id)
        expect(retrieved?.metadata?.preferences?.notifications).toBe(true)
        expect(retrieved?.metadata?.preferences?.theme).toBe('dark')
      })

      it('should allow custom $id if provided', async () => {
        const customer = await docs.create({
          $id: 'cust_custom_123',
          name: 'Dave',
          email: 'dave@example.com',
        })

        expect(customer.$id).toBe('cust_custom_123')
      })

      it('should reject duplicate $id', async () => {
        await docs.create({
          $id: 'cust_dup_001',
          name: 'Eve',
          email: 'eve@example.com',
        })

        await expect(
          docs.create({
            $id: 'cust_dup_001',
            name: 'Eve2',
            email: 'eve2@example.com',
          })
        ).rejects.toThrow()
      })
    })

    describe('get()', () => {
      it('should retrieve a document by $id', async () => {
        const created = await docs.create({
          name: 'Frank',
          email: 'frank@example.com',
        })

        const retrieved = await docs.get(created.$id)

        expect(retrieved).not.toBeNull()
        expect(retrieved?.$id).toBe(created.$id)
        expect(retrieved?.name).toBe('Frank')
        expect(retrieved?.email).toBe('frank@example.com')
      })

      it('should return null for non-existent $id', async () => {
        const result = await docs.get('nonexistent_id')
        expect(result).toBeNull()
      })

      it('should return the latest version after updates', async () => {
        const created = await docs.create({
          name: 'Grace',
          email: 'grace@example.com',
          metadata: { tier: 'free' },
        })

        await docs.update(created.$id, {
          'metadata.tier': 'premium',
        })

        const retrieved = await docs.get(created.$id)
        expect(retrieved?.metadata?.tier).toBe('premium')
        expect(retrieved?.$version).toBe(2)
      })
    })

    describe('update()', () => {
      it('should update a document with partial data', async () => {
        const created = await docs.create({
          name: 'Heidi',
          email: 'heidi@example.com',
          metadata: { tier: 'basic' },
        })

        const updated = await docs.update(created.$id, {
          name: 'Heidi Updated',
        })

        expect(updated.name).toBe('Heidi Updated')
        expect(updated.email).toBe('heidi@example.com') // unchanged
        expect(updated.metadata?.tier).toBe('basic') // unchanged
      })

      it('should update nested fields using dot notation', async () => {
        const created = await docs.create({
          name: 'Ivan',
          email: 'ivan@example.com',
          metadata: { tier: 'premium', joinedAt: '2024-01-01' },
        })

        const updated = await docs.update(created.$id, {
          'metadata.tier': 'enterprise',
        })

        expect(updated.metadata?.tier).toBe('enterprise')
        expect(updated.metadata?.joinedAt).toBe('2024-01-01') // unchanged
      })

      it('should increment $version on each update', async () => {
        const created = await docs.create({
          name: 'Judy',
          email: 'judy@example.com',
        })

        expect(created.$version).toBe(1)

        const v2 = await docs.update(created.$id, { name: 'Judy v2' })
        expect(v2.$version).toBe(2)

        const v3 = await docs.update(created.$id, { name: 'Judy v3' })
        expect(v3.$version).toBe(3)
      })

      it('should update $updatedAt but not $createdAt', async () => {
        const created = await docs.create({
          name: 'Kevin',
          email: 'kevin@example.com',
        })

        // Wait a tiny bit to ensure different timestamp
        await new Promise((resolve) => setTimeout(resolve, 10))

        const updated = await docs.update(created.$id, { name: 'Kevin Updated' })

        expect(updated.$createdAt).toBe(created.$createdAt)
        expect(updated.$updatedAt).toBeGreaterThan(created.$updatedAt)
      })

      it('should throw for non-existent document', async () => {
        await expect(
          docs.update('nonexistent_id', { name: 'Test' })
        ).rejects.toThrow()
      })

      it('should support setting nested fields that do not exist', async () => {
        const created = await docs.create({
          name: 'Laura',
          email: 'laura@example.com',
        })

        const updated = await docs.update(created.$id, {
          'metadata.preferences.notifications': true,
        })

        expect(updated.metadata?.preferences?.notifications).toBe(true)
      })
    })

    describe('delete()', () => {
      it('should soft delete a document', async () => {
        const created = await docs.create({
          name: 'Mike',
          email: 'mike@example.com',
        })

        await docs.delete(created.$id)

        const retrieved = await docs.get(created.$id)
        expect(retrieved).toBeNull()
      })

      it('should return true for successful delete', async () => {
        const created = await docs.create({
          name: 'Nancy',
          email: 'nancy@example.com',
        })

        const result = await docs.delete(created.$id)
        expect(result).toBe(true)
      })

      it('should return false for non-existent document', async () => {
        const result = await docs.delete('nonexistent_id')
        expect(result).toBe(false)
      })

      it('should not appear in query results after delete', async () => {
        await docs.create({ name: 'Oscar', email: 'oscar@example.com' })
        const toDelete = await docs.create({
          name: 'Patricia',
          email: 'patricia@example.com',
        })
        await docs.create({ name: 'Quinn', email: 'quinn@example.com' })

        await docs.delete(toDelete.$id)

        const results = await docs.query({})
        expect(results.map((r) => r.name)).not.toContain('Patricia')
        expect(results).toHaveLength(2)
      })

      it('should be idempotent (deleting twice should not error)', async () => {
        const created = await docs.create({
          name: 'Robert',
          email: 'robert@example.com',
        })

        await docs.delete(created.$id)
        const secondDelete = await docs.delete(created.$id)
        expect(secondDelete).toBe(false)
      })
    })
  })

  // ============================================================================
  // JSONPATH QUERIES
  // ============================================================================

  describe('JSONPath Queries', () => {
    beforeEach(async () => {
      // Seed test data
      await docs.create({
        name: 'Alice',
        email: 'alice@example.com',
        metadata: { tier: 'premium', joinedAt: '2024-01-01' },
      })
      await docs.create({
        name: 'Bob',
        email: 'bob@example.com',
        metadata: { tier: 'basic', joinedAt: '2024-02-15' },
      })
      await docs.create({
        name: 'Charlie',
        email: 'charlie@example.com',
        metadata: { tier: 'premium', joinedAt: '2024-03-20' },
      })
      await docs.create({
        name: 'Diana',
        email: 'diana@example.com',
        metadata: { tier: 'enterprise', joinedAt: '2024-01-10' },
      })
    })

    describe('Simple field queries', () => {
      it('should query by top-level field', async () => {
        const results = await docs.query({
          where: { name: 'Alice' },
        })

        expect(results).toHaveLength(1)
        expect(results[0].email).toBe('alice@example.com')
      })

      it('should query by nested field using dot notation', async () => {
        const results = await docs.query({
          where: { 'metadata.tier': 'premium' },
        })

        expect(results).toHaveLength(2)
        expect(results.map((r) => r.name).sort()).toEqual(['Alice', 'Charlie'])
      })

      it('should query deeply nested fields', async () => {
        await docs.create({
          name: 'Eve',
          email: 'eve@example.com',
          metadata: {
            tier: 'premium',
            preferences: { notifications: true, theme: 'dark' },
          },
        })

        const results = await docs.query({
          where: { 'metadata.preferences.theme': 'dark' },
        })

        expect(results).toHaveLength(1)
        expect(results[0].name).toBe('Eve')
      })
    })

    describe('Comparison operators', () => {
      it('should support $eq operator', async () => {
        const results = await docs.query({
          where: { name: { $eq: 'Bob' } },
        })

        expect(results).toHaveLength(1)
        expect(results[0].name).toBe('Bob')
      })

      it('should support $ne operator', async () => {
        const results = await docs.query({
          where: { 'metadata.tier': { $ne: 'premium' } },
        })

        expect(results).toHaveLength(2)
        expect(results.map((r) => r.metadata?.tier).sort()).toEqual([
          'basic',
          'enterprise',
        ])
      })

      it('should support $gt operator for dates', async () => {
        const results = await docs.query({
          where: { 'metadata.joinedAt': { $gt: '2024-02-01' } },
        })

        expect(results).toHaveLength(2)
        expect(results.map((r) => r.name).sort()).toEqual(['Bob', 'Charlie'])
      })

      it('should support $gte operator', async () => {
        const results = await docs.query({
          where: { 'metadata.joinedAt': { $gte: '2024-02-15' } },
        })

        expect(results).toHaveLength(2)
        expect(results.map((r) => r.name).sort()).toEqual(['Bob', 'Charlie'])
      })

      it('should support $lt operator', async () => {
        const results = await docs.query({
          where: { 'metadata.joinedAt': { $lt: '2024-02-01' } },
        })

        expect(results).toHaveLength(2)
        expect(results.map((r) => r.name).sort()).toEqual(['Alice', 'Diana'])
      })

      it('should support $lte operator', async () => {
        const results = await docs.query({
          where: { 'metadata.joinedAt': { $lte: '2024-01-10' } },
        })

        expect(results).toHaveLength(2)
        expect(results.map((r) => r.name).sort()).toEqual(['Alice', 'Diana'])
      })

      it('should support $in operator', async () => {
        const results = await docs.query({
          where: { 'metadata.tier': { $in: ['premium', 'enterprise'] } },
        })

        expect(results).toHaveLength(3)
        expect(results.map((r) => r.name).sort()).toEqual([
          'Alice',
          'Charlie',
          'Diana',
        ])
      })

      it('should support $nin operator', async () => {
        const results = await docs.query({
          where: { 'metadata.tier': { $nin: ['premium', 'enterprise'] } },
        })

        expect(results).toHaveLength(1)
        expect(results[0].name).toBe('Bob')
      })
    })

    describe('Logical operators', () => {
      it('should support $and operator', async () => {
        const results = await docs.query({
          where: {
            $and: [
              { 'metadata.tier': 'premium' },
              { 'metadata.joinedAt': { $gt: '2024-02-01' } },
            ],
          },
        })

        expect(results).toHaveLength(1)
        expect(results[0].name).toBe('Charlie')
      })

      it('should support $or operator', async () => {
        const results = await docs.query({
          where: {
            $or: [{ name: 'Alice' }, { name: 'Bob' }],
          },
        })

        expect(results).toHaveLength(2)
        expect(results.map((r) => r.name).sort()).toEqual(['Alice', 'Bob'])
      })

      it('should support $not operator', async () => {
        const results = await docs.query({
          where: {
            $not: { 'metadata.tier': 'premium' },
          },
        })

        expect(results).toHaveLength(2)
        expect(results.map((r) => r.name).sort()).toEqual(['Bob', 'Diana'])
      })

      it('should support nested logical operators', async () => {
        const results = await docs.query({
          where: {
            $and: [
              { 'metadata.tier': { $ne: 'basic' } },
              {
                $or: [
                  { 'metadata.joinedAt': { $lt: '2024-02-01' } },
                  { name: 'Charlie' },
                ],
              },
            ],
          },
        })

        expect(results).toHaveLength(3)
        expect(results.map((r) => r.name).sort()).toEqual([
          'Alice',
          'Charlie',
          'Diana',
        ])
      })
    })

    describe('String operators', () => {
      it('should support $like operator', async () => {
        const results = await docs.query({
          where: { email: { $like: '%@example.com' } },
        })

        expect(results).toHaveLength(4)
      })

      it('should support $regex operator', async () => {
        const results = await docs.query({
          where: { name: { $regex: '^[A-C]' } },
        })

        expect(results).toHaveLength(3)
        expect(results.map((r) => r.name).sort()).toEqual([
          'Alice',
          'Bob',
          'Charlie',
        ])
      })

      it('should support case-insensitive $regex', async () => {
        const results = await docs.query({
          where: { name: { $regex: '^alice$', $options: 'i' } },
        })

        expect(results).toHaveLength(1)
        expect(results[0].name).toBe('Alice')
      })
    })

    describe('Existence operators', () => {
      it('should support $exists: true', async () => {
        await docs.create({
          name: 'NoMeta',
          email: 'nometa@example.com',
        })

        const results = await docs.query({
          where: { 'metadata.tier': { $exists: true } },
        })

        expect(results).toHaveLength(4) // Original 4 have metadata.tier
      })

      it('should support $exists: false', async () => {
        await docs.create({
          name: 'NoMeta',
          email: 'nometa@example.com',
        })

        const results = await docs.query({
          where: { 'metadata.tier': { $exists: false } },
        })

        expect(results).toHaveLength(1)
        expect(results[0].name).toBe('NoMeta')
      })
    })
  })

  // ============================================================================
  // COLLECTION OPERATIONS
  // ============================================================================

  describe('Collection Operations', () => {
    beforeEach(async () => {
      // Seed 20 documents for pagination tests
      for (let i = 0; i < 20; i++) {
        await docs.create({
          name: `User${String(i).padStart(2, '0')}`,
          email: `user${i}@example.com`,
          metadata: {
            tier: i % 3 === 0 ? 'premium' : i % 3 === 1 ? 'basic' : 'enterprise',
            joinedAt: `2024-${String((i % 12) + 1).padStart(2, '0')}-01`,
          },
        })
      }
    })

    describe('Pagination', () => {
      it('should support limit', async () => {
        const results = await docs.query({
          limit: 5,
        })

        expect(results).toHaveLength(5)
      })

      it('should support offset', async () => {
        const firstPage = await docs.query({
          limit: 5,
          orderBy: { name: 'asc' },
        })
        const secondPage = await docs.query({
          limit: 5,
          offset: 5,
          orderBy: { name: 'asc' },
        })

        expect(firstPage[0].name).toBe('User00')
        expect(secondPage[0].name).toBe('User05')
        expect(firstPage).not.toEqual(secondPage)
      })

      it('should support cursor-based pagination', async () => {
        const firstPage = await docs.query({
          limit: 5,
          orderBy: { $createdAt: 'asc' },
        })

        const secondPage = await docs.query({
          limit: 5,
          cursor: firstPage[firstPage.length - 1].$id,
          orderBy: { $createdAt: 'asc' },
        })

        expect(firstPage).toHaveLength(5)
        expect(secondPage).toHaveLength(5)
        expect(firstPage.map((r) => r.$id)).not.toContain(secondPage[0].$id)
      })
    })

    describe('Ordering', () => {
      it('should order by field ascending', async () => {
        const results = await docs.query({
          orderBy: { name: 'asc' },
          limit: 3,
        })

        expect(results[0].name).toBe('User00')
        expect(results[1].name).toBe('User01')
        expect(results[2].name).toBe('User02')
      })

      it('should order by field descending', async () => {
        const results = await docs.query({
          orderBy: { name: 'desc' },
          limit: 3,
        })

        expect(results[0].name).toBe('User19')
        expect(results[1].name).toBe('User18')
        expect(results[2].name).toBe('User17')
      })

      it('should order by nested field', async () => {
        const results = await docs.query({
          orderBy: { 'metadata.joinedAt': 'asc' },
          limit: 5,
        })

        // Verify sorted by joinedAt
        for (let i = 1; i < results.length; i++) {
          const prevDate = results[i - 1].metadata?.joinedAt ?? ''
          const currDate = results[i].metadata?.joinedAt ?? ''
          expect(prevDate <= currDate).toBe(true)
        }
      })

      it('should support multiple order fields', async () => {
        const results = await docs.query({
          orderBy: [
            { 'metadata.tier': 'asc' },
            { name: 'desc' },
          ],
          limit: 10,
        })

        // First results should be 'basic' tier, sorted by name desc
        const basicUsers = results.filter((r) => r.metadata?.tier === 'basic')
        expect(basicUsers.length).toBeGreaterThan(0)
      })
    })

    describe('Counting', () => {
      it('should count all documents', async () => {
        const count = await docs.count()
        expect(count).toBe(20)
      })

      it('should count with filters', async () => {
        const count = await docs.count({
          where: { 'metadata.tier': 'premium' },
        })

        // Every 3rd document (0, 3, 6, 9, 12, 15, 18) = 7 premium users
        expect(count).toBe(7)
      })
    })

    describe('List all', () => {
      it('should list all documents with defaults', async () => {
        const results = await docs.list()

        expect(results).toHaveLength(20)
      })

      it('should support list with type filter', async () => {
        // Create different type store
        const orders = new DocumentStore<Order>(db, { type: 'Order' })
        await orders.create({
          customerId: 'cust_1',
          total: 99.99,
          status: 'pending',
          items: [{ productId: 'prod_1', quantity: 2, price: 49.99 }],
        })

        // Customers should only return Customer docs
        const customers = await docs.list()
        expect(customers).toHaveLength(20)

        // Orders should only return Order docs
        const orderList = await orders.list()
        expect(orderList).toHaveLength(1)
      })
    })
  })

  // ============================================================================
  // BATCH OPERATIONS
  // ============================================================================

  describe('Batch Operations', () => {
    describe('createMany()', () => {
      it('should create multiple documents in one call', async () => {
        const customers = await docs.createMany([
          { name: 'Batch1', email: 'batch1@example.com' },
          { name: 'Batch2', email: 'batch2@example.com' },
          { name: 'Batch3', email: 'batch3@example.com' },
        ])

        expect(customers).toHaveLength(3)
        expect(customers.every((c) => c.$id)).toBe(true)
        expect(customers.map((c) => c.name)).toEqual([
          'Batch1',
          'Batch2',
          'Batch3',
        ])
      })

      it('should be atomic (all or nothing)', async () => {
        // Attempt to create with duplicate $id in batch
        await expect(
          docs.createMany([
            { $id: 'dup_batch', name: 'First', email: 'first@example.com' },
            { $id: 'dup_batch', name: 'Second', email: 'second@example.com' },
          ])
        ).rejects.toThrow()

        // Neither should be created
        const result = await docs.get('dup_batch')
        expect(result).toBeNull()
      })

      it('should emit CDC events for each created document', async () => {
        await docs.createMany([
          { name: 'CDC1', email: 'cdc1@example.com' },
          { name: 'CDC2', email: 'cdc2@example.com' },
        ])

        const insertEvents = cdcEvents.filter((e) => e.type === 'cdc.insert')
        expect(insertEvents).toHaveLength(2)
      })
    })

    describe('updateMany()', () => {
      beforeEach(async () => {
        await docs.createMany([
          { name: 'Update1', email: 'u1@example.com', metadata: { tier: 'free' } },
          { name: 'Update2', email: 'u2@example.com', metadata: { tier: 'free' } },
          { name: 'Update3', email: 'u3@example.com', metadata: { tier: 'premium' } },
        ])
      })

      it('should update multiple documents matching filter', async () => {
        const count = await docs.updateMany(
          { where: { 'metadata.tier': 'free' } },
          { 'metadata.tier': 'basic' }
        )

        expect(count).toBe(2)

        const results = await docs.query({
          where: { 'metadata.tier': 'basic' },
        })
        expect(results).toHaveLength(2)
      })

      it('should return count of updated documents', async () => {
        const count = await docs.updateMany(
          { where: { name: 'Nonexistent' } },
          { 'metadata.tier': 'upgraded' }
        )

        expect(count).toBe(0)
      })
    })

    describe('deleteMany()', () => {
      beforeEach(async () => {
        await docs.createMany([
          { name: 'Delete1', email: 'd1@example.com', metadata: { tier: 'free' } },
          { name: 'Delete2', email: 'd2@example.com', metadata: { tier: 'free' } },
          { name: 'Delete3', email: 'd3@example.com', metadata: { tier: 'premium' } },
        ])
      })

      it('should delete multiple documents matching filter', async () => {
        const count = await docs.deleteMany({
          where: { 'metadata.tier': 'free' },
        })

        expect(count).toBe(2)

        const remaining = await docs.list()
        expect(remaining).toHaveLength(1)
        expect(remaining[0].name).toBe('Delete3')
      })

      it('should return count of deleted documents', async () => {
        const count = await docs.deleteMany({
          where: { name: 'Nonexistent' },
        })

        expect(count).toBe(0)
      })
    })

    describe('upsert()', () => {
      it('should insert if document does not exist', async () => {
        const result = await docs.upsert(
          { $id: 'upsert_new' },
          {
            $id: 'upsert_new',
            name: 'Upsert New',
            email: 'upsert@example.com',
          }
        )

        expect(result.name).toBe('Upsert New')
        expect(result.$version).toBe(1)
      })

      it('should update if document exists', async () => {
        await docs.create({
          $id: 'upsert_existing',
          name: 'Original',
          email: 'original@example.com',
        })

        const result = await docs.upsert(
          { $id: 'upsert_existing' },
          { name: 'Updated' }
        )

        expect(result.name).toBe('Updated')
        expect(result.email).toBe('original@example.com') // preserved
        expect(result.$version).toBe(2)
      })
    })
  })

  // ============================================================================
  // CDC EVENT EMISSION
  // ============================================================================

  describe('CDC Event Emission', () => {
    describe('Insert events', () => {
      it('should emit cdc.insert on create', async () => {
        const customer = await docs.create({
          name: 'CDC Test',
          email: 'cdc@example.com',
          metadata: { tier: 'premium' },
        })

        expect(cdcEvents).toHaveLength(1)
        expect(cdcEvents[0]).toMatchObject({
          type: 'cdc.insert',
          op: 'c',
          store: 'document',
          table: 'Customer',
          key: customer.$id,
        })
        expect(cdcEvents[0].after).toMatchObject({
          name: 'CDC Test',
          email: 'cdc@example.com',
        })
        expect(cdcEvents[0].before).toBeUndefined()
      })
    })

    describe('Update events', () => {
      it('should emit cdc.update on update', async () => {
        const customer = await docs.create({
          name: 'Before Update',
          email: 'before@example.com',
          metadata: { tier: 'basic' },
        })

        cdcEvents.length = 0 // Clear create event

        await docs.update(customer.$id, {
          name: 'After Update',
          'metadata.tier': 'premium',
        })

        expect(cdcEvents).toHaveLength(1)
        expect(cdcEvents[0]).toMatchObject({
          type: 'cdc.update',
          op: 'u',
          store: 'document',
          table: 'Customer',
          key: customer.$id,
        })
        expect(cdcEvents[0].before).toMatchObject({
          name: 'Before Update',
          'metadata.tier': 'basic',
        })
        expect(cdcEvents[0].after).toMatchObject({
          name: 'After Update',
          'metadata.tier': 'premium',
        })
      })

      it('should only include changed fields in before/after', async () => {
        const customer = await docs.create({
          name: 'Partial',
          email: 'partial@example.com',
          metadata: { tier: 'free', joinedAt: '2024-01-01' },
        })

        cdcEvents.length = 0

        await docs.update(customer.$id, { 'metadata.tier': 'premium' })

        expect(cdcEvents[0].before).toEqual({ 'metadata.tier': 'free' })
        expect(cdcEvents[0].after).toEqual({ 'metadata.tier': 'premium' })
        // email should not be in before/after since it didn't change
        expect(cdcEvents[0].before).not.toHaveProperty('email')
        expect(cdcEvents[0].after).not.toHaveProperty('email')
      })
    })

    describe('Delete events', () => {
      it('should emit cdc.delete on delete', async () => {
        const customer = await docs.create({
          name: 'To Delete',
          email: 'delete@example.com',
        })

        cdcEvents.length = 0

        await docs.delete(customer.$id)

        expect(cdcEvents).toHaveLength(1)
        expect(cdcEvents[0]).toMatchObject({
          type: 'cdc.delete',
          op: 'd',
          store: 'document',
          table: 'Customer',
          key: customer.$id,
        })
        expect(cdcEvents[0].before).toMatchObject({
          name: 'To Delete',
          email: 'delete@example.com',
        })
        expect(cdcEvents[0].after).toBeUndefined()
      })
    })

    describe('Batch CDC events', () => {
      it('should emit events for each document in createMany', async () => {
        await docs.createMany([
          { name: 'Batch1', email: 'b1@example.com' },
          { name: 'Batch2', email: 'b2@example.com' },
          { name: 'Batch3', email: 'b3@example.com' },
        ])

        const insertEvents = cdcEvents.filter((e) => e.type === 'cdc.insert')
        expect(insertEvents).toHaveLength(3)
      })

      it('should emit events for updateMany', async () => {
        await docs.createMany([
          { name: 'Up1', email: 'up1@example.com', metadata: { tier: 'free' } },
          { name: 'Up2', email: 'up2@example.com', metadata: { tier: 'free' } },
        ])

        cdcEvents.length = 0

        await docs.updateMany(
          { where: { 'metadata.tier': 'free' } },
          { 'metadata.tier': 'paid' }
        )

        const updateEvents = cdcEvents.filter((e) => e.type === 'cdc.update')
        expect(updateEvents).toHaveLength(2)
      })

      it('should emit events for deleteMany', async () => {
        await docs.createMany([
          { name: 'Del1', email: 'del1@example.com', metadata: { tier: 'temp' } },
          { name: 'Del2', email: 'del2@example.com', metadata: { tier: 'temp' } },
        ])

        cdcEvents.length = 0

        await docs.deleteMany({ where: { 'metadata.tier': 'temp' } })

        const deleteEvents = cdcEvents.filter((e) => e.type === 'cdc.delete')
        expect(deleteEvents).toHaveLength(2)
      })
    })
  })

  // ============================================================================
  // TIME TRAVEL QUERIES
  // ============================================================================

  describe('Time Travel Queries', () => {
    it('should retrieve document as of specific timestamp', async () => {
      const customer = await docs.create({
        name: 'Time Travel',
        email: 'time@example.com',
        metadata: { tier: 'basic' },
      })

      const afterCreate = new Date().toISOString()

      // Wait and update
      await new Promise((resolve) => setTimeout(resolve, 50))

      await docs.update(customer.$id, { 'metadata.tier': 'premium' })

      // Get historical version
      const historical = await docs.getAsOf(customer.$id, afterCreate)

      expect(historical?.metadata?.tier).toBe('basic')

      // Current version should be premium
      const current = await docs.get(customer.$id)
      expect(current?.metadata?.tier).toBe('premium')
    })

    it('should return null for document that did not exist at timestamp', async () => {
      const beforeCreate = new Date().toISOString()

      await new Promise((resolve) => setTimeout(resolve, 50))

      const customer = await docs.create({
        name: 'Future Doc',
        email: 'future@example.com',
      })

      const historical = await docs.getAsOf(customer.$id, beforeCreate)
      expect(historical).toBeNull()
    })
  })

  // ============================================================================
  // BLOOM FILTER OPTIMIZATION
  // ============================================================================

  describe('Bloom Filter Optimization', () => {
    beforeEach(async () => {
      // Create documents to populate bloom filter
      for (let i = 0; i < 100; i++) {
        await docs.create({
          name: `BloomUser${i}`,
          email: `bloom${i}@example.com`,
        })
      }
    })

    it('should expose getBloomFilter for indexed fields', async () => {
      const bloom = docs.getBloomFilter('email')

      expect(bloom).toBeDefined()
      expect(typeof bloom.mightContain).toBe('function')
    })

    it('should return true for values that might exist', async () => {
      const bloom = docs.getBloomFilter('email')

      // Value that exists
      expect(bloom.mightContain('bloom50@example.com')).toBe(true)
    })

    it('should return false for values that definitely do not exist', async () => {
      const bloom = docs.getBloomFilter('email')

      // Value that doesn't exist - bloom filter can return false negative-free
      expect(bloom.mightContain('definitely-not-here@xyz.com')).toBe(false)
    })
  })

  // ============================================================================
  // TYPE SAFETY
  // ============================================================================

  describe('Type Safety', () => {
    it('should enforce document type on create', async () => {
      // This should type-check correctly
      const customer: Customer = await docs.create({
        name: 'TypeSafe',
        email: 'typesafe@example.com',
      })

      expect(customer.name).toBe('TypeSafe')
    })

    it('should enforce document type on get', async () => {
      const created = await docs.create({
        name: 'TypeGet',
        email: 'typeget@example.com',
      })

      const retrieved: Customer | null = await docs.get(created.$id)

      expect(retrieved?.name).toBe('TypeGet')
    })

    it('should enforce document type on query results', async () => {
      await docs.create({
        name: 'TypeQuery',
        email: 'typequery@example.com',
      })

      const results: Customer[] = await docs.query({
        where: { name: 'TypeQuery' },
      })

      expect(results[0].name).toBe('TypeQuery')
    })
  })

  // ============================================================================
  // ERROR HANDLING
  // ============================================================================

  describe('Error Handling', () => {
    it('should throw meaningful error for invalid JSONPath', async () => {
      await expect(
        docs.query({
          where: { 'invalid..path': 'value' },
        })
      ).rejects.toThrow(/invalid.*path/i)
    })

    it('should throw for unsupported operator', async () => {
      await expect(
        docs.query({
          where: { name: { $unsupported: 'value' } as unknown },
        })
      ).rejects.toThrow(/unsupported.*operator/i)
    })

    it('should handle circular reference in document gracefully', async () => {
      const circular: Record<string, unknown> = { name: 'Circular' }
      circular.self = circular

      await expect(
        docs.create(circular as unknown as Omit<Customer, '$id' | '$type' | '$createdAt' | '$updatedAt' | '$version'>)
      ).rejects.toThrow()
    })
  })
})
