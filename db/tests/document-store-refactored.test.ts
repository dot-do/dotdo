/**
 * DocumentStore Refactored Tests
 *
 * Tests for the new indexing, tiering, and CDC features added to DocumentStore.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'

import {
  DocumentStore,
  IndexManager,
  type IndexDefinition,
  type CDCChangeEvent,
  INDEX_TEMPLATES,
} from '../document'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface Customer {
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

// ============================================================================
// TEST SETUP
// ============================================================================

describe('DocumentStore - Refactored Features', () => {
  let sqlite: Database.Database
  let db: ReturnType<typeof drizzle>
  let docs: DocumentStore<Customer>

  beforeEach(() => {
    sqlite = new Database(':memory:')
    db = drizzle(sqlite)

    // Create documents table
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

    docs = new DocumentStore<Customer>(db, { type: 'Customer' })
  })

  afterEach(() => {
    sqlite.close()
  })

  // ============================================================================
  // SECONDARY INDEXES
  // ============================================================================

  describe('Secondary Indexes', () => {
    describe('Index Creation', () => {
      it('should create a simple field index', async () => {
        await docs.createIndex({
          name: 'email_idx',
          fields: [{ path: 'email' }],
        })

        const indexes = docs.getIndexes()
        expect(indexes).toHaveLength(1)
        expect(indexes[0].name).toBe('email_idx')
      })

      it('should create a unique index', async () => {
        await docs.createIndex({
          name: 'email_unique',
          fields: [{ path: 'email' }],
          unique: true,
        })

        // Create first customer
        await docs.create({
          name: 'Alice',
          email: 'alice@example.com',
        })

        // Index should allow lookup
        const ids = docs.lookupByIndex('email_unique', { email: 'alice@example.com' })
        expect(ids).toHaveLength(1)
      })

      it('should create a compound index', async () => {
        await docs.createIndex({
          name: 'tier_created_idx',
          fields: [
            { path: 'metadata.tier' },
            { path: '$createdAt', order: 'desc' },
          ],
        })

        const indexes = docs.getIndexes()
        expect(indexes[0].fields).toHaveLength(2)
      })

      it('should create a sparse index', async () => {
        await docs.createIndex({
          name: 'tier_idx',
          fields: [{ path: 'metadata.tier' }],
          sparse: true,
        })

        // Create customer without metadata.tier
        await docs.create({
          name: 'NoTier',
          email: 'notier@example.com',
        })

        // Create customer with metadata.tier
        await docs.create({
          name: 'WithTier',
          email: 'withtier@example.com',
          metadata: { tier: 'premium' },
        })

        // Lookup should only find the one with tier
        const ids = docs.lookupByIndex('tier_idx', { 'metadata.tier': 'premium' })
        expect(ids).toHaveLength(1)
      })
    })

    describe('Index Lookup', () => {
      beforeEach(async () => {
        await docs.createIndex({
          name: 'email_idx',
          fields: [{ path: 'email' }],
        })

        await docs.createIndex({
          name: 'tier_idx',
          fields: [{ path: 'metadata.tier' }],
        })

        // Seed data
        await docs.create({
          name: 'Alice',
          email: 'alice@example.com',
          metadata: { tier: 'premium' },
        })
        await docs.create({
          name: 'Bob',
          email: 'bob@example.com',
          metadata: { tier: 'basic' },
        })
        await docs.create({
          name: 'Charlie',
          email: 'charlie@example.com',
          metadata: { tier: 'premium' },
        })
      })

      it('should lookup by email', () => {
        const ids = docs.lookupByIndex('email_idx', { email: 'alice@example.com' })
        expect(ids).toHaveLength(1)
      })

      it('should lookup by tier', () => {
        const ids = docs.lookupByIndex('tier_idx', { 'metadata.tier': 'premium' })
        expect(ids).toHaveLength(2)
      })

      it('should return empty array for non-existent value', () => {
        const ids = docs.lookupByIndex('email_idx', { email: 'nonexistent@example.com' })
        expect(ids).toHaveLength(0)
      })
    })

    describe('Index Range Lookup', () => {
      beforeEach(async () => {
        await docs.createIndex({
          name: 'created_idx',
          fields: [{ path: '$createdAt', order: 'desc' }],
        })

        // Create documents with slight delays to ensure different timestamps
        await docs.create({ name: 'First', email: 'first@example.com' })
        await new Promise((r) => setTimeout(r, 10))
        await docs.create({ name: 'Second', email: 'second@example.com' })
        await new Promise((r) => setTimeout(r, 10))
        await docs.create({ name: 'Third', email: 'third@example.com' })
      })

      it('should do range lookup with gte', () => {
        const now = Date.now()
        const ids = docs.lookupByIndexRange('created_idx', '$createdAt', {
          gte: now - 5000, // Last 5 seconds
        })
        expect(ids).toHaveLength(3)
      })

      it('should do range lookup with limit', () => {
        const ids = docs.lookupByIndexRange('created_idx', '$createdAt', {
          limit: 2,
        })
        expect(ids).toHaveLength(2)
      })

      it('should do range lookup with order', () => {
        const ascIds = docs.lookupByIndexRange('created_idx', '$createdAt', {
          order: 'asc',
          limit: 1,
        })
        const descIds = docs.lookupByIndexRange('created_idx', '$createdAt', {
          order: 'desc',
          limit: 1,
        })
        expect(ascIds[0]).not.toBe(descIds[0])
      })
    })

    describe('Index Maintenance', () => {
      it('should update index on document create', async () => {
        await docs.createIndex({
          name: 'email_idx',
          fields: [{ path: 'email' }],
        })

        await docs.create({
          name: 'New',
          email: 'new@example.com',
        })

        const ids = docs.lookupByIndex('email_idx', { email: 'new@example.com' })
        expect(ids).toHaveLength(1)
      })

      it('should update index on document update', async () => {
        await docs.createIndex({
          name: 'email_idx',
          fields: [{ path: 'email' }],
        })

        const customer = await docs.create({
          name: 'Original',
          email: 'original@example.com',
        })

        await docs.update(customer.$id, { email: 'updated@example.com' })

        const oldIds = docs.lookupByIndex('email_idx', { email: 'original@example.com' })
        const newIds = docs.lookupByIndex('email_idx', { email: 'updated@example.com' })

        expect(oldIds).toHaveLength(0)
        expect(newIds).toHaveLength(1)
      })

      it('should remove from index on document delete', async () => {
        await docs.createIndex({
          name: 'email_idx',
          fields: [{ path: 'email' }],
        })

        const customer = await docs.create({
          name: 'ToDelete',
          email: 'delete@example.com',
        })

        await docs.delete(customer.$id)

        const ids = docs.lookupByIndex('email_idx', { email: 'delete@example.com' })
        expect(ids).toHaveLength(0)
      })

      it('should rebuild index', async () => {
        // Create documents first
        await docs.create({ name: 'A', email: 'a@example.com' })
        await docs.create({ name: 'B', email: 'b@example.com' })

        // Create index (will populate from existing)
        await docs.createIndex({
          name: 'email_idx',
          fields: [{ path: 'email' }],
        })

        // Rebuild
        await docs.rebuildIndex('email_idx')

        // Should still work
        const ids = docs.lookupByIndex('email_idx', { email: 'a@example.com' })
        expect(ids).toHaveLength(1)
      })
    })

    describe('Index Templates', () => {
      it('should have email template', () => {
        expect(INDEX_TEMPLATES.uniqueEmail).toBeDefined()
        expect(INDEX_TEMPLATES.uniqueEmail.unique).toBe(true)
      })

      it('should have createdAt template', () => {
        expect(INDEX_TEMPLATES.createdAt).toBeDefined()
        expect(INDEX_TEMPLATES.createdAt.fields[0].path).toBe('$createdAt')
      })

      it('should have status template', () => {
        expect(INDEX_TEMPLATES.status).toBeDefined()
        expect(INDEX_TEMPLATES.status.sparse).toBe(true)
      })
    })
  })

  // ============================================================================
  // CDC STREAMING
  // ============================================================================

  describe('CDC Streaming', () => {
    describe('Subscribe', () => {
      it('should subscribe to changes', async () => {
        const events: CDCChangeEvent[] = []

        const subscription = docs.subscribe((event) => {
          events.push(event)
        })

        await docs.create({
          name: 'Test',
          email: 'test@example.com',
        })

        expect(events).toHaveLength(1)
        expect(events[0].type).toBe('cdc.insert')
        expect(events[0].op).toBe('c')

        subscription.unsubscribe()
      })

      it('should receive all CRUD events', async () => {
        const events: CDCChangeEvent[] = []

        const subscription = docs.subscribe((event) => {
          events.push(event)
        })

        // Create
        const customer = await docs.create({
          name: 'Test',
          email: 'test@example.com',
        })

        // Update
        await docs.update(customer.$id, { name: 'Updated' })

        // Delete
        await docs.delete(customer.$id)

        expect(events).toHaveLength(3)
        expect(events[0].type).toBe('cdc.insert')
        expect(events[1].type).toBe('cdc.update')
        expect(events[2].type).toBe('cdc.delete')

        subscription.unsubscribe()
      })

      it('should include LSN for ordering', async () => {
        const events: CDCChangeEvent[] = []

        const subscription = docs.subscribe((event) => {
          events.push(event)
        })

        await docs.create({ name: 'First', email: 'first@example.com' })
        await docs.create({ name: 'Second', email: 'second@example.com' })

        expect(events[0].lsn).toBeDefined()
        expect(events[1].lsn).toBeDefined()
        expect(events[1].lsn!).toBeGreaterThan(events[0].lsn!)

        subscription.unsubscribe()
      })

      it('should include timestamp', async () => {
        const events: CDCChangeEvent[] = []
        const beforeCreate = Date.now()

        const subscription = docs.subscribe((event) => {
          events.push(event)
        })

        await docs.create({ name: 'Test', email: 'test@example.com' })

        expect(events[0].timestamp).toBeGreaterThanOrEqual(beforeCreate)
        expect(events[0].timestamp).toBeLessThanOrEqual(Date.now())

        subscription.unsubscribe()
      })

      it('should include version', async () => {
        const events: CDCChangeEvent[] = []

        const subscription = docs.subscribe((event) => {
          events.push(event)
        })

        const customer = await docs.create({ name: 'Test', email: 'test@example.com' })
        await docs.update(customer.$id, { name: 'Updated' })

        expect(events[0].version).toBe(1)
        expect(events[1].version).toBe(2)

        subscription.unsubscribe()
      })
    })

    describe('Unsubscribe', () => {
      it('should stop receiving events after unsubscribe', async () => {
        const events: CDCChangeEvent[] = []

        const subscription = docs.subscribe((event) => {
          events.push(event)
        })

        await docs.create({ name: 'Before', email: 'before@example.com' })
        expect(events).toHaveLength(1)

        subscription.unsubscribe()

        await docs.create({ name: 'After', email: 'after@example.com' })
        expect(events).toHaveLength(1) // Still 1
      })

      it('should have subscription id', () => {
        const subscription = docs.subscribe(() => {})
        expect(subscription.id).toBeDefined()
        expect(subscription.id).toMatch(/^sub_/)
        subscription.unsubscribe()
      })
    })

    describe('Multiple Subscribers', () => {
      it('should notify all subscribers', async () => {
        const events1: CDCChangeEvent[] = []
        const events2: CDCChangeEvent[] = []

        const sub1 = docs.subscribe((e) => events1.push(e))
        const sub2 = docs.subscribe((e) => events2.push(e))

        await docs.create({ name: 'Test', email: 'test@example.com' })

        expect(events1).toHaveLength(1)
        expect(events2).toHaveLength(1)

        sub1.unsubscribe()
        sub2.unsubscribe()
      })

      it('should handle subscriber errors gracefully', async () => {
        const events: CDCChangeEvent[] = []

        docs.subscribe(() => {
          throw new Error('Subscriber error')
        })
        docs.subscribe((e) => events.push(e))

        // Should not throw
        await docs.create({ name: 'Test', email: 'test@example.com' })

        // Second subscriber should still receive event
        expect(events).toHaveLength(1)
      })
    })

    describe('LSN Management', () => {
      it('should get current LSN', async () => {
        const initialLsn = docs.getCurrentLSN()

        await docs.create({ name: 'Test', email: 'test@example.com' })

        expect(docs.getCurrentLSN()).toBe(initialLsn + 1)
      })

      it('should increment LSN for each event', async () => {
        const lsns: number[] = []

        docs.subscribe((e) => {
          if (e.lsn) lsns.push(e.lsn)
        })

        await docs.create({ name: 'A', email: 'a@example.com' })
        await docs.create({ name: 'B', email: 'b@example.com' })
        await docs.create({ name: 'C', email: 'c@example.com' })

        expect(lsns).toEqual([1, 2, 3])
      })
    })

    describe('onCDCChange callback', () => {
      it('should call onCDCChange callback', async () => {
        const events: CDCChangeEvent[] = []

        const docsWithCallback = new DocumentStore<Customer>(db, {
          type: 'CustomerCallback',
          onCDCChange: (e) => events.push(e),
        })

        await docsWithCallback.create({ name: 'Test', email: 'test@example.com' })

        expect(events).toHaveLength(1)
        expect(events[0].lsn).toBe(1)
      })
    })
  })

  // ============================================================================
  // TIERING (Basic tests - R2 not available in unit tests)
  // ============================================================================

  describe('Tiering', () => {
    describe('Without R2 configured', () => {
      it('should return null stats without tiering configured', async () => {
        const stats = await docs.getTieringStats()
        expect(stats).toBeNull()
      })

      it('should return error for tierToWarm without tiering', async () => {
        const customer = await docs.create({
          name: 'Test',
          email: 'test@example.com',
        })

        const result = await docs.tierToWarm(customer.$id)
        expect(result.success).toBe(false)
        expect(result.error).toContain('not configured')
      })

      it('should return empty candidates without tiering', () => {
        const candidates = docs.findTieringCandidates()
        expect(candidates).toHaveLength(0)
      })

      it('should get document with tier info defaulting to hot', async () => {
        const customer = await docs.create({
          name: 'Test',
          email: 'test@example.com',
        })

        const result = await docs.getWithTier(customer.$id)
        expect(result).not.toBeNull()
        expect(result!.tier).toBe('hot')
        expect(result!.data.name).toBe('Test')
      })
    })

    describe('Tiering batch without R2', () => {
      it('should return empty results', async () => {
        const results = await docs.runTieringBatch()
        expect(results.evaluated).toBe(0)
        expect(results.tieredToWarm).toBe(0)
        expect(results.tieredToCold).toBe(0)
      })
    })
  })

  // ============================================================================
  // INTEGRATION
  // ============================================================================

  describe('Integration', () => {
    it('should work with indexes and CDC together', async () => {
      const events: CDCChangeEvent[] = []

      // Setup store with index
      await docs.createIndex({
        name: 'email_idx',
        fields: [{ path: 'email' }],
      })

      // Subscribe to changes
      const sub = docs.subscribe((e) => events.push(e))

      // Create document
      const customer = await docs.create({
        name: 'Alice',
        email: 'alice@example.com',
      })

      // Verify index
      const ids = docs.lookupByIndex('email_idx', { email: 'alice@example.com' })
      expect(ids).toContain(customer.$id)

      // Verify CDC
      expect(events).toHaveLength(1)
      expect(events[0].key).toBe(customer.$id)

      sub.unsubscribe()
    })

    it('should maintain indexes through updates', async () => {
      const events: CDCChangeEvent[] = []

      await docs.createIndex({
        name: 'email_idx',
        fields: [{ path: 'email' }],
      })

      const sub = docs.subscribe((e) => events.push(e))

      const customer = await docs.create({
        name: 'Bob',
        email: 'bob@example.com',
      })

      await docs.update(customer.$id, { email: 'robert@example.com' })

      // Old email not found
      expect(docs.lookupByIndex('email_idx', { email: 'bob@example.com' })).toHaveLength(0)

      // New email found
      expect(docs.lookupByIndex('email_idx', { email: 'robert@example.com' })).toHaveLength(1)

      // Both events captured
      expect(events).toHaveLength(2)

      sub.unsubscribe()
    })
  })
})

// ============================================================================
// IndexManager Unit Tests
// ============================================================================

describe('IndexManager', () => {
  let sqlite: Database.Database
  let indexManager: IndexManager

  beforeEach(() => {
    sqlite = new Database(':memory:')

    // Create documents table
    sqlite.exec(`
      CREATE TABLE documents (
        "$id" TEXT PRIMARY KEY,
        "$type" TEXT NOT NULL,
        data JSON NOT NULL,
        "$createdAt" INTEGER NOT NULL,
        "$updatedAt" INTEGER NOT NULL,
        "$version" INTEGER NOT NULL DEFAULT 1
      )
    `)

    indexManager = new IndexManager(sqlite, { type: 'TestDoc' })
  })

  afterEach(() => {
    sqlite.close()
  })

  it('should create and list indexes', async () => {
    await indexManager.createIndex({
      name: 'test_idx',
      fields: [{ path: 'name' }],
    })

    const indexes = indexManager.getIndexes()
    expect(indexes).toHaveLength(1)
    expect(indexes[0].name).toBe('test_idx')
  })

  it('should drop indexes', async () => {
    await indexManager.createIndex({
      name: 'test_idx',
      fields: [{ path: 'name' }],
    })

    await indexManager.dropIndex('test_idx')

    const indexes = indexManager.getIndexes()
    expect(indexes).toHaveLength(0)
  })

  it('should throw on duplicate index', async () => {
    await indexManager.createIndex({
      name: 'dup_idx',
      fields: [{ path: 'name' }],
    })

    await expect(
      indexManager.createIndex({
        name: 'dup_idx',
        fields: [{ path: 'email' }],
      })
    ).rejects.toThrow()
  })

  it('should throw on drop non-existent index', async () => {
    await expect(
      indexManager.dropIndex('nonexistent')
    ).rejects.toThrow()
  })

  it('should check if index can be used for query', async () => {
    await indexManager.createIndex({
      name: 'compound_idx',
      fields: [{ path: 'a' }, { path: 'b' }],
    })

    // Full coverage
    const fullMatch = indexManager.canUseIndex(['a', 'b'])
    expect(fullMatch?.coverage).toBe('full')

    // Partial coverage
    const partialMatch = indexManager.canUseIndex(['a'])
    expect(partialMatch?.coverage).toBe('partial')

    // No match
    const noMatch = indexManager.canUseIndex(['c'])
    expect(noMatch).toBeNull()
  })
})
