/**
 * DocumentStore Durable Object Integration Tests - GREEN Phase
 *
 * TDD GREEN phase: These tests verify the DocumentStore implementation works
 * with Durable Objects using flat RPC methods (stub.documentsCreate(), etc).
 *
 * @see do-25y - [GREEN] DocumentStore - Implement to pass tests
 *
 * This test file verifies:
 * 1. DocumentStore is accessible via flat RPC methods (stub.documentsCreate, etc.)
 * 2. CRUD operations work with real SQLite persistence
 * 3. JSONPath queries work for nested fields
 * 4. Soft delete behavior
 * 5. Full-text search capability
 *
 * Note: Uses flat RPC methods due to Workers RPC limitations with nested RpcTarget getters.
 *
 * Test Environment: cloudflare:test (real miniflare - NO MOCKS)
 */

import { env } from 'cloudflare:test'
import { describe, it, expect, beforeEach } from 'vitest'

// ============================================================================
// Type Definitions (Expected Interface)
// ============================================================================

/**
 * Document metadata added by the store
 */
interface DocumentMetadata {
  $id: string
  $type: string
  $createdAt: number
  $updatedAt: number
  $version: number
}

/**
 * A Document with its data and metadata
 */
type Document<T> = T & DocumentMetadata

/**
 * Test document type
 */
interface TestDoc {
  title: string
  content: string
  metadata?: {
    author?: string
    tags?: string[]
    priority?: number
  }
}

// ============================================================================
// Test Helpers
// ============================================================================

const testRunId = Date.now()
let testCounter = 0

/**
 * Generate unique namespace for test isolation
 */
function uniqueNs(prefix = 'doc-store-test'): string {
  return `${prefix}-${testRunId}-${++testCounter}`
}

/**
 * Get a real DO stub from env
 */
function getDOStub(ns: string) {
  const id = env.TEST_DO.idFromName(ns)
  return env.TEST_DO.get(id)
}

// ============================================================================
// TEST SUITE: DocumentStore CRUD Operations
// ============================================================================

describe('[GREEN] DocumentStore - CRUD Operations', () => {
  // --------------------------------------------------------------------------
  // CREATE Tests
  // --------------------------------------------------------------------------

  describe('create()', () => {
    it('creates a document with auto-generated $id', async () => {
      const ns = uniqueNs('doc-create')
      const stub = getDOStub(ns) as any

      // This test FAILS until stub.documents is exposed on the DO
      const doc = await stub.documentsCreate({
        $type: 'Article',
        title: 'Hello World',
        content: 'This is the content.',
      })

      expect(doc.$id).toBeDefined()
      expect(doc.$id).toMatch(/^[a-z0-9_-]+$/i)
      expect(doc.$type).toBe('Article')
      expect(doc.title).toBe('Hello World')
      expect(doc.content).toBe('This is the content.')
    })

    it('creates a document with custom $id', async () => {
      const ns = uniqueNs('doc-custom-id')
      const stub = getDOStub(ns) as any
      const customId = `doc-${Date.now()}`

      const doc = await stub.documentsCreate({
        $id: customId,
        $type: 'Article',
        title: 'Custom ID Article',
        content: 'Content here.',
      })

      expect(doc.$id).toBe(customId)
      expect(doc.$type).toBe('Article')
    })

    it('sets $createdAt and $updatedAt timestamps on create', async () => {
      const ns = uniqueNs('doc-timestamps')
      const stub = getDOStub(ns) as any

      const beforeCreate = Date.now()
      const doc = await stub.documentsCreate({
        $type: 'Article',
        title: 'Timestamp Test',
        content: 'Testing timestamps.',
      })
      const afterCreate = Date.now()

      expect(doc.$createdAt).toBeGreaterThanOrEqual(beforeCreate)
      expect(doc.$createdAt).toBeLessThanOrEqual(afterCreate)
      expect(doc.$updatedAt).toBe(doc.$createdAt)
    })

    it('sets $version to 1 on create', async () => {
      const ns = uniqueNs('doc-version')
      const stub = getDOStub(ns) as any

      const doc = await stub.documentsCreate({
        $type: 'Article',
        title: 'Version Test',
        content: 'Testing version.',
      })

      expect(doc.$version).toBe(1)
    })

    it('stores deeply nested JSON structures', async () => {
      const ns = uniqueNs('doc-nested')
      const stub = getDOStub(ns) as any

      const doc = await stub.documentsCreate({
        $type: 'Article',
        title: 'Nested Data',
        content: 'Testing nested structures.',
        metadata: {
          author: 'Alice',
          tags: ['tech', 'tutorial'],
          priority: 1,
        },
      })

      expect(doc.metadata).toBeDefined()
      expect(doc.metadata.author).toBe('Alice')
      expect(doc.metadata.tags).toEqual(['tech', 'tutorial'])
      expect(doc.metadata.priority).toBe(1)
    })

    it('rejects duplicate $id', async () => {
      const ns = uniqueNs('doc-duplicate')
      const stub = getDOStub(ns) as any
      const duplicateId = `dup-${Date.now()}`

      // First create succeeds
      await stub.documentsCreate({
        $id: duplicateId,
        $type: 'Article',
        title: 'First',
        content: 'First document.',
      })

      // Second create with same ID should fail
      await expect(
        stub.documentsCreate({
          $id: duplicateId,
          $type: 'Article',
          title: 'Second',
          content: 'Second document.',
        })
      ).rejects.toThrow(/already exists/i)
    })
  })

  // --------------------------------------------------------------------------
  // GET Tests
  // --------------------------------------------------------------------------

  describe('get()', () => {
    it('retrieves a document by $id', async () => {
      const ns = uniqueNs('doc-get')
      const stub = getDOStub(ns) as any

      const created = await stub.documentsCreate({
        $type: 'Article',
        title: 'Get Test',
        content: 'Testing retrieval.',
      })

      const retrieved = await stub.documentsGet(created.$id)

      expect(retrieved).not.toBeNull()
      expect(retrieved.$id).toBe(created.$id)
      expect(retrieved.title).toBe('Get Test')
      expect(retrieved.content).toBe('Testing retrieval.')
    })

    it('returns null for non-existent $id', async () => {
      const ns = uniqueNs('doc-get-null')
      const stub = getDOStub(ns) as any

      const result = await stub.documentsGet('non-existent-id')

      expect(result).toBeNull()
    })

    it('retrieves deeply nested data correctly', async () => {
      const ns = uniqueNs('doc-get-nested')
      const stub = getDOStub(ns) as any

      const created = await stub.documentsCreate({
        $type: 'Article',
        title: 'Nested Get Test',
        content: 'Testing nested retrieval.',
        metadata: {
          author: 'Bob',
          tags: ['test', 'nested'],
          priority: 2,
        },
      })

      const retrieved = await stub.documentsGet(created.$id)

      expect(retrieved.metadata.author).toBe('Bob')
      expect(retrieved.metadata.tags).toEqual(['test', 'nested'])
      expect(retrieved.metadata.priority).toBe(2)
    })
  })

  // --------------------------------------------------------------------------
  // UPDATE Tests
  // --------------------------------------------------------------------------

  describe('update()', () => {
    it('updates a document with partial data', async () => {
      const ns = uniqueNs('doc-update')
      const stub = getDOStub(ns) as any

      const created = await stub.documentsCreate({
        $type: 'Article',
        title: 'Original Title',
        content: 'Original content.',
      })

      const updated = await stub.documentsUpdate(created.$id, {
        title: 'Updated Title',
      })

      expect(updated.title).toBe('Updated Title')
      expect(updated.content).toBe('Original content.') // unchanged
    })

    it('updates nested fields using dot notation', async () => {
      const ns = uniqueNs('doc-update-nested')
      const stub = getDOStub(ns) as any

      const created = await stub.documentsCreate({
        $type: 'Article',
        title: 'Dot Notation Test',
        content: 'Testing dot notation.',
        metadata: {
          author: 'Original Author',
          priority: 1,
        },
      })

      const updated = await stub.documentsUpdate(created.$id, {
        'metadata.author': 'New Author',
      })

      expect(updated.metadata.author).toBe('New Author')
      expect(updated.metadata.priority).toBe(1) // unchanged
    })

    it('increments $version on each update', async () => {
      const ns = uniqueNs('doc-update-version')
      const stub = getDOStub(ns) as any

      const created = await stub.documentsCreate({
        $type: 'Article',
        title: 'Version Test',
        content: 'Testing version increment.',
      })

      expect(created.$version).toBe(1)

      const v2 = await stub.documentsUpdate(created.$id, { title: 'V2' })
      expect(v2.$version).toBe(2)

      const v3 = await stub.documentsUpdate(created.$id, { title: 'V3' })
      expect(v3.$version).toBe(3)
    })

    it('updates $updatedAt but not $createdAt', async () => {
      const ns = uniqueNs('doc-update-timestamps')
      const stub = getDOStub(ns) as any

      const created = await stub.documentsCreate({
        $type: 'Article',
        title: 'Timestamp Test',
        content: 'Testing timestamp update.',
      })

      // Wait a bit to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10))

      const updated = await stub.documentsUpdate(created.$id, {
        title: 'Updated Title',
      })

      expect(updated.$createdAt).toBe(created.$createdAt)
      expect(updated.$updatedAt).toBeGreaterThan(created.$updatedAt)
    })

    it('throws for non-existent document', async () => {
      const ns = uniqueNs('doc-update-error')
      const stub = getDOStub(ns) as any

      await expect(
        stub.documentsUpdate('non-existent-id', { title: 'Test' })
      ).rejects.toThrow(/not found/i)
    })

    it('creates nested fields that do not exist', async () => {
      const ns = uniqueNs('doc-update-create-nested')
      const stub = getDOStub(ns) as any

      const created = await stub.documentsCreate({
        $type: 'Article',
        title: 'No Metadata',
        content: 'No metadata initially.',
      })

      const updated = await stub.documentsUpdate(created.$id, {
        'metadata.author': 'New Author',
      })

      expect(updated.metadata).toBeDefined()
      expect(updated.metadata.author).toBe('New Author')
    })
  })

  // --------------------------------------------------------------------------
  // DELETE Tests
  // --------------------------------------------------------------------------

  describe('delete()', () => {
    it('soft deletes a document', async () => {
      const ns = uniqueNs('doc-delete')
      const stub = getDOStub(ns) as any

      const created = await stub.documentsCreate({
        $type: 'Article',
        title: 'Delete Test',
        content: 'Testing deletion.',
      })

      const result = await stub.documentsDelete(created.$id)

      expect(result).toBe(true)

      // Should not be retrievable after delete
      const retrieved = await stub.documentsGet(created.$id)
      expect(retrieved).toBeNull()
    })

    it('returns true for successful delete', async () => {
      const ns = uniqueNs('doc-delete-success')
      const stub = getDOStub(ns) as any

      const created = await stub.documentsCreate({
        $type: 'Article',
        title: 'Success Delete',
        content: 'Testing success return.',
      })

      const result = await stub.documentsDelete(created.$id)
      expect(result).toBe(true)
    })

    it('returns false for non-existent document', async () => {
      const ns = uniqueNs('doc-delete-nonexistent')
      const stub = getDOStub(ns) as any

      const result = await stub.documentsDelete('non-existent-id')
      expect(result).toBe(false)
    })

    it('is idempotent (deleting twice does not error)', async () => {
      const ns = uniqueNs('doc-delete-idempotent')
      const stub = getDOStub(ns) as any

      const created = await stub.documentsCreate({
        $type: 'Article',
        title: 'Idempotent Delete',
        content: 'Testing idempotency.',
      })

      const firstDelete = await stub.documentsDelete(created.$id)
      expect(firstDelete).toBe(true)

      const secondDelete = await stub.documentsDelete(created.$id)
      expect(secondDelete).toBe(false)
    })
  })
})

// ============================================================================
// TEST SUITE: DocumentStore Query/List Operations
// ============================================================================

describe('[GREEN] DocumentStore - Query Operations', () => {
  describe('list()', () => {
    it('lists all documents of a type', async () => {
      const ns = uniqueNs('doc-list')
      const stub = getDOStub(ns) as any

      // Create multiple documents
      await stub.documentsCreate({
        $type: 'Article',
        title: 'Article 1',
        content: 'First article.',
      })
      await stub.documentsCreate({
        $type: 'Article',
        title: 'Article 2',
        content: 'Second article.',
      })
      await stub.documentsCreate({
        $type: 'Note',
        title: 'Note 1',
        content: 'A note.',
      })

      // List only Articles
      const articles = await stub.documentsList({ type: 'Article' })

      expect(articles).toHaveLength(2)
      expect(articles.every((a: any) => a.$type === 'Article')).toBe(true)
    })

    it('supports limit pagination', async () => {
      const ns = uniqueNs('doc-list-limit')
      const stub = getDOStub(ns) as any

      // Create 5 documents
      for (let i = 0; i < 5; i++) {
        await stub.documentsCreate({
          $type: 'Article',
          title: `Article ${i}`,
          content: `Content ${i}`,
        })
      }

      const limited = await stub.documentsList({
        type: 'Article',
        limit: 3,
      })

      expect(limited).toHaveLength(3)
    })

    it('supports offset pagination', async () => {
      const ns = uniqueNs('doc-list-offset')
      const stub = getDOStub(ns) as any

      // Create 5 documents
      for (let i = 0; i < 5; i++) {
        await stub.documentsCreate({
          $type: 'Article',
          title: `Article ${i}`,
          content: `Content ${i}`,
        })
      }

      const page1 = await stub.documentsList({
        type: 'Article',
        limit: 2,
        orderBy: { title: 'asc' },
      })
      const page2 = await stub.documentsList({
        type: 'Article',
        limit: 2,
        offset: 2,
        orderBy: { title: 'asc' },
      })

      expect(page1).toHaveLength(2)
      expect(page2).toHaveLength(2)
      expect(page1[0].title).not.toBe(page2[0].title)
    })

    it('excludes soft-deleted documents by default', async () => {
      const ns = uniqueNs('doc-list-deleted')
      const stub = getDOStub(ns) as any

      const doc1 = await stub.documentsCreate({
        $type: 'Article',
        title: 'Keep Me',
        content: 'Kept.',
      })
      const doc2 = await stub.documentsCreate({
        $type: 'Article',
        title: 'Delete Me',
        content: 'Deleted.',
      })

      await stub.documentsDelete(doc2.$id)

      const results = await stub.documentsList({ type: 'Article' })

      expect(results).toHaveLength(1)
      expect(results[0].$id).toBe(doc1.$id)
    })
  })

  describe('query() with filters', () => {
    it('filters by simple field equality', async () => {
      const ns = uniqueNs('doc-query-eq')
      const stub = getDOStub(ns) as any

      await stub.documentsCreate({
        $type: 'Article',
        title: 'Target',
        content: 'Find me.',
      })
      await stub.documentsCreate({
        $type: 'Article',
        title: 'Other',
        content: 'Not me.',
      })

      const results = await stub.documentsQuery({
        type: 'Article',
        where: { title: 'Target' },
      })

      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('Target')
    })

    it('filters by nested field using dot notation', async () => {
      const ns = uniqueNs('doc-query-nested')
      const stub = getDOStub(ns) as any

      await stub.documentsCreate({
        $type: 'Article',
        title: 'Alice Article',
        content: 'By Alice.',
        metadata: { author: 'Alice' },
      })
      await stub.documentsCreate({
        $type: 'Article',
        title: 'Bob Article',
        content: 'By Bob.',
        metadata: { author: 'Bob' },
      })

      const results = await stub.documentsQuery({
        type: 'Article',
        where: { 'metadata.author': 'Alice' },
      })

      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('Alice Article')
    })

    it('supports $gt operator for numeric comparison', async () => {
      const ns = uniqueNs('doc-query-gt')
      const stub = getDOStub(ns) as any

      await stub.documentsCreate({
        $type: 'Article',
        title: 'Low Priority',
        content: 'Low.',
        metadata: { priority: 1 },
      })
      await stub.documentsCreate({
        $type: 'Article',
        title: 'High Priority',
        content: 'High.',
        metadata: { priority: 5 },
      })

      const results = await stub.documentsQuery({
        type: 'Article',
        where: { 'metadata.priority': { $gt: 3 } },
      })

      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('High Priority')
    })

    it('supports $in operator for array matching', async () => {
      const ns = uniqueNs('doc-query-in')
      const stub = getDOStub(ns) as any

      await stub.documentsCreate({
        $type: 'Article',
        title: 'Tech',
        content: 'Tech content.',
        metadata: { category: 'tech' },
      })
      await stub.documentsCreate({
        $type: 'Article',
        title: 'Science',
        content: 'Science content.',
        metadata: { category: 'science' },
      })
      await stub.documentsCreate({
        $type: 'Article',
        title: 'Sports',
        content: 'Sports content.',
        metadata: { category: 'sports' },
      })

      const results = await stub.documentsQuery({
        type: 'Article',
        where: { 'metadata.category': { $in: ['tech', 'science'] } },
      })

      expect(results).toHaveLength(2)
      expect(results.map((r: any) => r.metadata.category).sort()).toEqual([
        'science',
        'tech',
      ])
    })

    it('supports $like operator for string matching', async () => {
      const ns = uniqueNs('doc-query-like')
      const stub = getDOStub(ns) as any

      await stub.documentsCreate({
        $type: 'Article',
        title: 'Hello World',
        content: 'Greeting.',
      })
      await stub.documentsCreate({
        $type: 'Article',
        title: 'Hello Universe',
        content: 'Big greeting.',
      })
      await stub.documentsCreate({
        $type: 'Article',
        title: 'Goodbye World',
        content: 'Farewell.',
      })

      const results = await stub.documentsQuery({
        type: 'Article',
        where: { title: { $like: 'Hello%' } },
      })

      expect(results).toHaveLength(2)
      expect(results.every((r: any) => r.title.startsWith('Hello'))).toBe(true)
    })

    it('supports $and logical operator', async () => {
      const ns = uniqueNs('doc-query-and')
      const stub = getDOStub(ns) as any

      await stub.documentsCreate({
        $type: 'Article',
        title: 'Premium Tech',
        content: 'Premium tech article.',
        metadata: { category: 'tech', tier: 'premium' },
      })
      await stub.documentsCreate({
        $type: 'Article',
        title: 'Free Tech',
        content: 'Free tech article.',
        metadata: { category: 'tech', tier: 'free' },
      })
      await stub.documentsCreate({
        $type: 'Article',
        title: 'Premium Science',
        content: 'Premium science.',
        metadata: { category: 'science', tier: 'premium' },
      })

      const results = await stub.documentsQuery({
        type: 'Article',
        where: {
          $and: [
            { 'metadata.category': 'tech' },
            { 'metadata.tier': 'premium' },
          ],
        },
      })

      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('Premium Tech')
    })

    it('supports $or logical operator', async () => {
      const ns = uniqueNs('doc-query-or')
      const stub = getDOStub(ns) as any

      await stub.documentsCreate({
        $type: 'Article',
        title: 'Tech',
        content: 'Tech.',
        metadata: { category: 'tech' },
      })
      await stub.documentsCreate({
        $type: 'Article',
        title: 'Science',
        content: 'Science.',
        metadata: { category: 'science' },
      })
      await stub.documentsCreate({
        $type: 'Article',
        title: 'Sports',
        content: 'Sports.',
        metadata: { category: 'sports' },
      })

      const results = await stub.documentsQuery({
        type: 'Article',
        where: {
          $or: [
            { 'metadata.category': 'tech' },
            { 'metadata.category': 'sports' },
          ],
        },
      })

      expect(results).toHaveLength(2)
    })
  })
})

// ============================================================================
// TEST SUITE: DocumentStore Full-Text Search
// ============================================================================

describe('[GREEN] DocumentStore - Search Operations', () => {
  describe('search()', () => {
    it('performs full-text search on content', async () => {
      const ns = uniqueNs('doc-search')
      const stub = getDOStub(ns) as any

      await stub.documentsCreate({
        $type: 'Article',
        title: 'JavaScript Guide',
        content: 'Learn JavaScript programming from scratch.',
      })
      await stub.documentsCreate({
        $type: 'Article',
        title: 'Python Guide',
        content: 'Learn Python programming from scratch.',
      })
      await stub.documentsCreate({
        $type: 'Article',
        title: 'Cooking Guide',
        content: 'Learn cooking techniques from professionals.',
      })

      const results = await stub.documentsSearch({
        type: 'Article',
        query: 'JavaScript',
      })

      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('JavaScript Guide')
    })

    it('performs full-text search across multiple fields', async () => {
      const ns = uniqueNs('doc-search-multifield')
      const stub = getDOStub(ns) as any

      await stub.documentsCreate({
        $type: 'Article',
        title: 'Introduction to React',
        content: 'Building user interfaces with components.',
      })
      await stub.documentsCreate({
        $type: 'Article',
        title: 'Building Components',
        content: 'An introduction to modular design.',
      })

      // Search should find "introduction" in both title and content
      const results = await stub.documentsSearch({
        type: 'Article',
        query: 'introduction',
        fields: ['title', 'content'],
      })

      expect(results).toHaveLength(2)
    })

    it('returns results sorted by relevance', async () => {
      const ns = uniqueNs('doc-search-relevance')
      const stub = getDOStub(ns) as any

      await stub.documentsCreate({
        $type: 'Article',
        title: 'JavaScript Basics',
        content: 'JavaScript is a versatile language. JavaScript runs everywhere.',
      })
      await stub.documentsCreate({
        $type: 'Article',
        title: 'Web Development',
        content: 'JavaScript is used for web development.',
      })

      const results = await stub.documentsSearch({
        type: 'Article',
        query: 'JavaScript',
      })

      // First result should have more occurrences of "JavaScript"
      expect(results.length).toBeGreaterThanOrEqual(1)
      expect(results[0].title).toBe('JavaScript Basics')
    })

    it('supports search with additional filters', async () => {
      const ns = uniqueNs('doc-search-filter')
      const stub = getDOStub(ns) as any

      await stub.documentsCreate({
        $type: 'Article',
        title: 'Premium JavaScript',
        content: 'Advanced JavaScript techniques.',
        metadata: { tier: 'premium' },
      })
      await stub.documentsCreate({
        $type: 'Article',
        title: 'Free JavaScript',
        content: 'Basic JavaScript tutorial.',
        metadata: { tier: 'free' },
      })

      const results = await stub.documentsSearch({
        type: 'Article',
        query: 'JavaScript',
        where: { 'metadata.tier': 'premium' },
      })

      expect(results).toHaveLength(1)
      expect(results[0].title).toBe('Premium JavaScript')
    })
  })
})

// ============================================================================
// TEST SUITE: DocumentStore Batch Operations
// ============================================================================

describe('[GREEN] DocumentStore - Batch Operations', () => {
  describe('createMany()', () => {
    it('creates multiple documents in one call', async () => {
      const ns = uniqueNs('doc-create-many')
      const stub = getDOStub(ns) as any

      const docs = await stub.documentsCreateMany([
        { $type: 'Article', title: 'Batch 1', content: 'Content 1' },
        { $type: 'Article', title: 'Batch 2', content: 'Content 2' },
        { $type: 'Article', title: 'Batch 3', content: 'Content 3' },
      ])

      expect(docs).toHaveLength(3)
      expect(docs.every((d: any) => d.$id)).toBe(true)
      expect(docs.map((d: any) => d.title)).toEqual([
        'Batch 1',
        'Batch 2',
        'Batch 3',
      ])
    })

    it('is atomic - rolls back on duplicate $id in batch', async () => {
      const ns = uniqueNs('doc-create-many-atomic')
      const stub = getDOStub(ns) as any

      await expect(
        stub.documentsCreateMany([
          { $id: 'dup', $type: 'Article', title: 'First', content: 'First' },
          { $id: 'dup', $type: 'Article', title: 'Second', content: 'Second' },
        ])
      ).rejects.toThrow()

      // Neither should be created
      const result = await stub.documentsGet('dup')
      expect(result).toBeNull()
    })
  })

  describe('updateMany()', () => {
    it('updates multiple documents matching filter', async () => {
      const ns = uniqueNs('doc-update-many')
      const stub = getDOStub(ns) as any

      await stub.documentsCreateMany([
        {
          $type: 'Article',
          title: 'Update 1',
          content: 'Content 1',
          metadata: { status: 'draft' },
        },
        {
          $type: 'Article',
          title: 'Update 2',
          content: 'Content 2',
          metadata: { status: 'draft' },
        },
        {
          $type: 'Article',
          title: 'Update 3',
          content: 'Content 3',
          metadata: { status: 'published' },
        },
      ])

      const count = await stub.documentsUpdateMany(
        { type: 'Article', where: { 'metadata.status': 'draft' } },
        { 'metadata.status': 'published' }
      )

      expect(count).toBe(2)

      const results = await stub.documentsQuery({
        type: 'Article',
        where: { 'metadata.status': 'published' },
      })
      expect(results).toHaveLength(3)
    })
  })

  describe('deleteMany()', () => {
    it('deletes multiple documents matching filter', async () => {
      const ns = uniqueNs('doc-delete-many')
      const stub = getDOStub(ns) as any

      await stub.documentsCreateMany([
        {
          $type: 'Article',
          title: 'Delete 1',
          content: 'Content 1',
          metadata: { status: 'archived' },
        },
        {
          $type: 'Article',
          title: 'Delete 2',
          content: 'Content 2',
          metadata: { status: 'archived' },
        },
        {
          $type: 'Article',
          title: 'Keep',
          content: 'Content 3',
          metadata: { status: 'active' },
        },
      ])

      const count = await stub.documentsDeleteMany({
        type: 'Article',
        where: { 'metadata.status': 'archived' },
      })

      expect(count).toBe(2)

      const remaining = await stub.documentsList({ type: 'Article' })
      expect(remaining).toHaveLength(1)
      expect(remaining[0].title).toBe('Keep')
    })
  })
})

// ============================================================================
// TEST SUITE: DocumentStore Upsert Operation
// ============================================================================

describe('[GREEN] DocumentStore - Upsert Operation', () => {
  describe('upsert()', () => {
    it('inserts if document does not exist', async () => {
      const ns = uniqueNs('doc-upsert-insert')
      const stub = getDOStub(ns) as any

      const result = await stub.documentsUpsert(
        { $id: 'upsert-new' },
        {
          $id: 'upsert-new',
          $type: 'Article',
          title: 'Upserted',
          content: 'New document via upsert.',
        }
      )

      expect(result.title).toBe('Upserted')
      expect(result.$version).toBe(1)
    })

    it('updates if document already exists', async () => {
      const ns = uniqueNs('doc-upsert-update')
      const stub = getDOStub(ns) as any

      await stub.documentsCreate({
        $id: 'upsert-existing',
        $type: 'Article',
        title: 'Original',
        content: 'Original content.',
      })

      const result = await stub.documentsUpsert(
        { $id: 'upsert-existing' },
        { title: 'Updated via Upsert' }
      )

      expect(result.title).toBe('Updated via Upsert')
      expect(result.content).toBe('Original content.') // preserved
      expect(result.$version).toBe(2)
    })
  })
})

// ============================================================================
// TEST SUITE: Implementation Verification
// ============================================================================

describe('[GREEN] DocumentStore - Implementation Verification', () => {
  it('stub.documentsCreate is callable and works', async () => {
    const ns = uniqueNs('doc-impl-create')
    const stub = getDOStub(ns) as any

    // Verify flat RPC method works
    const doc = await stub.documentsCreate({
      $type: 'Test',
      title: 'Verification',
      content: 'Testing implementation.',
    })

    expect(doc.$id).toBeDefined()
    expect(doc.$type).toBe('Test')
  })

  it('stub.documentsGet is callable and works', async () => {
    const ns = uniqueNs('doc-impl-get')
    const stub = getDOStub(ns) as any

    // Create first
    const created = await stub.documentsCreate({
      $type: 'Test',
      title: 'Get Test',
      content: 'Content.',
    })

    // Then get
    const doc = await stub.documentsGet(created.$id)

    expect(doc).not.toBeNull()
    expect(doc.$id).toBe(created.$id)
  })

  it('stub.documentsList is callable and works', async () => {
    const ns = uniqueNs('doc-impl-list')
    const stub = getDOStub(ns) as any

    await stub.documentsCreate({
      $type: 'Test',
      title: 'List Test',
      content: 'Content.',
    })

    const docs = await stub.documentsList({ type: 'Test' })

    expect(Array.isArray(docs)).toBe(true)
    expect(docs.length).toBeGreaterThan(0)
  })

  it('stub.documentsSearch is callable and works', async () => {
    const ns = uniqueNs('doc-impl-search')
    const stub = getDOStub(ns) as any

    await stub.documentsCreate({
      $type: 'Test',
      title: 'Search Test',
      content: 'Searchable content.',
    })

    const docs = await stub.documentsSearch({
      type: 'Test',
      query: 'Searchable',
    })

    expect(Array.isArray(docs)).toBe(true)
  })
})
