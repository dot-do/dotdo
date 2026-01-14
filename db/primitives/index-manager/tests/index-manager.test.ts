/**
 * IndexManager Tests - TDD RED Phase
 *
 * Tests for an IndexManager that coordinates multiple TypedColumnStore instances
 * for secondary indexes on document collections.
 *
 * Features to test:
 * - Compound indexes (multiple fields)
 * - Sparse indexes (only index docs with the field)
 * - Unique indexes (enforce uniqueness on insert)
 * - TTL indexes (automatic expiration)
 * - Partial indexes (with filter expression)
 * - Integration with PathExtractor for automatic field extraction
 * - Integration with SchemaEvolution for type changes
 *
 * @see dotdo-0i3mp - Implement Index Manager for secondary indexes
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  createIndexManager,
  type IndexManager,
  type IndexDefinition,
  type IndexOptions,
  type IndexInfo,
  type IndexEntry,
  type Document,
  type IndexStats,
} from '../index-manager'

// ============================================================================
// TEST TYPES
// ============================================================================

interface TestDocument extends Document {
  _id: string
  name: string
  email?: string
  age?: number
  status?: string
  tags?: string[]
  createdAt?: number
  expiresAt?: number
  address?: {
    city?: string
    state?: string
    country?: string
  }
  metadata?: {
    priority?: number
    category?: string
  }
}

// ============================================================================
// TEST FIXTURES
// ============================================================================

function createTestDoc(overrides: Partial<TestDocument> = {}): TestDocument {
  return {
    _id: `doc-${Math.random().toString(36).slice(2)}`,
    name: 'Test User',
    email: 'test@example.com',
    age: 30,
    status: 'active',
    ...overrides,
  }
}

function createTestDocs(count: number): TestDocument[] {
  return Array.from({ length: count }, (_, i) =>
    createTestDoc({
      _id: `doc-${i}`,
      name: `User ${i}`,
      email: `user${i}@example.com`,
      age: 20 + (i % 50),
      status: i % 2 === 0 ? 'active' : 'inactive',
      metadata: {
        priority: i % 10,
        category: ['A', 'B', 'C'][i % 3],
      },
    })
  )
}

// ============================================================================
// 1. BASIC INDEX CREATION
// ============================================================================

describe('IndexManager', () => {
  let manager: IndexManager<TestDocument>

  beforeEach(() => {
    manager = createIndexManager<TestDocument>()
  })

  describe('Basic Index Creation', () => {
    it('should create a single-field index', () => {
      manager.createIndex({ fields: { email: 1 } })

      const indexes = manager.listIndexes()
      expect(indexes.length).toBe(1)
      expect(indexes[0]!.fields).toEqual({ email: 1 })
    })

    it('should create an index with a custom name', () => {
      manager.createIndex({
        fields: { email: 1 },
        options: { name: 'email_idx' },
      })

      const indexes = manager.listIndexes()
      expect(indexes[0]!.name).toBe('email_idx')
    })

    it('should auto-generate index name from fields', () => {
      manager.createIndex({ fields: { name: 1, status: -1 } })

      const indexes = manager.listIndexes()
      expect(indexes[0]!.name).toMatch(/name_1_status_-1/)
    })

    it('should create an index on nested field', () => {
      manager.createIndex({ fields: { 'address.city': 1 } })

      const indexes = manager.listIndexes()
      expect(indexes[0]!.fields).toEqual({ 'address.city': 1 })
    })

    it('should create an index on deeply nested field', () => {
      manager.createIndex({ fields: { 'metadata.priority': 1 } })

      const indexes = manager.listIndexes()
      expect(indexes[0]!.fields).toEqual({ 'metadata.priority': 1 })
    })

    it('should not create duplicate indexes with same fields', () => {
      manager.createIndex({ fields: { email: 1 } })
      manager.createIndex({ fields: { email: 1 } })

      const indexes = manager.listIndexes()
      expect(indexes.length).toBe(1)
    })

    it('should throw error when creating duplicate index with different name', () => {
      manager.createIndex({
        fields: { email: 1 },
        options: { name: 'idx1' },
      })

      // Same fields but different name should either be idempotent or error
      // depending on design choice - we choose idempotent
      manager.createIndex({
        fields: { email: 1 },
        options: { name: 'idx2' },
      })

      const indexes = manager.listIndexes()
      // Should still have only one index (first one wins)
      expect(indexes.length).toBe(1)
      expect(indexes[0]!.name).toBe('idx1')
    })
  })

  // ============================================================================
  // 2. COMPOUND INDEXES
  // ============================================================================

  describe('Compound Indexes', () => {
    it('should create compound index on multiple fields', () => {
      manager.createIndex({ fields: { status: 1, age: -1 } })

      const indexes = manager.listIndexes()
      expect(indexes[0]!.fields).toEqual({ status: 1, age: -1 })
    })

    it('should create compound index with 3+ fields', () => {
      manager.createIndex({
        fields: { status: 1, 'metadata.category': 1, age: -1 },
      })

      const indexes = manager.listIndexes()
      expect(Object.keys(indexes[0]!.fields).length).toBe(3)
    })

    it('should maintain field order in compound index', () => {
      manager.createIndex({ fields: { status: 1, name: 1, email: 1 } })

      const indexes = manager.listIndexes()
      const fields = Object.keys(indexes[0]!.fields)
      expect(fields).toEqual(['status', 'name', 'email'])
    })

    it('should differentiate compound indexes by field order', () => {
      manager.createIndex({ fields: { status: 1, age: 1 } })
      manager.createIndex({ fields: { age: 1, status: 1 } })

      const indexes = manager.listIndexes()
      expect(indexes.length).toBe(2)
    })
  })

  // ============================================================================
  // 3. SPARSE INDEXES
  // ============================================================================

  describe('Sparse Indexes', () => {
    it('should create sparse index', () => {
      manager.createIndex({
        fields: { email: 1 },
        options: { sparse: true },
      })

      const indexes = manager.listIndexes()
      expect(indexes[0]!.sparse).toBe(true)
    })

    it('should only index documents with the field present', () => {
      manager.createIndex({
        fields: { email: 1 },
        options: { sparse: true },
      })

      const docWithEmail = createTestDoc({ _id: 'with-email', email: 'test@example.com' })
      const docWithoutEmail = createTestDoc({ _id: 'no-email', email: undefined })

      manager.indexDocument(docWithEmail)
      manager.indexDocument(docWithoutEmail)

      // Sparse index should only contain the doc with email
      const stats = manager.getIndexStats('email_1')
      expect(stats?.documentCount).toBe(1)
    })

    it('should not index null values in sparse index', () => {
      manager.createIndex({
        fields: { email: 1 },
        options: { sparse: true },
      })

      const docWithNull = createTestDoc({ _id: 'null-email', email: undefined })
      manager.indexDocument(docWithNull)

      const results = manager.find({ email: null })
      expect(results.length).toBe(0)
    })

    it('should index documents even when some compound fields are missing', () => {
      manager.createIndex({
        fields: { status: 1, email: 1 },
        options: { sparse: true },
      })

      const docWithBoth = createTestDoc({ status: 'active', email: 'test@example.com' })
      const docWithStatus = createTestDoc({ status: 'active', email: undefined })

      manager.indexDocument(docWithBoth)
      manager.indexDocument(docWithStatus)

      // For compound sparse, doc must have at least one field
      const stats = manager.getIndexStats('status_1_email_1')
      expect(stats?.documentCount).toBe(2)
    })
  })

  // ============================================================================
  // 4. UNIQUE INDEXES
  // ============================================================================

  describe('Unique Indexes', () => {
    it('should create unique index', () => {
      manager.createIndex({
        fields: { email: 1 },
        options: { unique: true },
      })

      const indexes = manager.listIndexes()
      expect(indexes[0]!.unique).toBe(true)
    })

    it('should enforce uniqueness on insert', () => {
      manager.createIndex({
        fields: { email: 1 },
        options: { unique: true },
      })

      const doc1 = createTestDoc({ _id: 'doc1', email: 'test@example.com' })
      const doc2 = createTestDoc({ _id: 'doc2', email: 'test@example.com' })

      manager.indexDocument(doc1)
      expect(() => manager.indexDocument(doc2)).toThrow(/duplicate/i)
    })

    it('should allow null in unique index (multiple nulls ok)', () => {
      manager.createIndex({
        fields: { email: 1 },
        options: { unique: true, sparse: true },
      })

      const doc1 = createTestDoc({ _id: 'doc1', email: undefined })
      const doc2 = createTestDoc({ _id: 'doc2', email: undefined })

      // Sparse unique allows multiple missing values
      manager.indexDocument(doc1)
      expect(() => manager.indexDocument(doc2)).not.toThrow()
    })

    it('should enforce compound unique constraint', () => {
      manager.createIndex({
        fields: { status: 1, email: 1 },
        options: { unique: true },
      })

      const doc1 = createTestDoc({ status: 'active', email: 'test@example.com' })
      const doc2 = createTestDoc({ status: 'inactive', email: 'test@example.com' })
      const doc3 = createTestDoc({ status: 'active', email: 'test@example.com' })

      manager.indexDocument(doc1)
      manager.indexDocument(doc2) // Different status, ok
      expect(() => manager.indexDocument(doc3)).toThrow(/duplicate/i)
    })

    it('should allow update if same document', () => {
      manager.createIndex({
        fields: { email: 1 },
        options: { unique: true },
      })

      const doc = createTestDoc({ _id: 'doc1', email: 'test@example.com' })
      manager.indexDocument(doc)

      // Update same document should not throw
      const updatedDoc = { ...doc, name: 'Updated Name' }
      expect(() => manager.indexDocument(updatedDoc)).not.toThrow()
    })
  })

  // ============================================================================
  // 5. TTL INDEXES
  // ============================================================================

  describe('TTL Indexes', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should create TTL index', () => {
      manager.createIndex({
        fields: { expiresAt: 1 },
        options: { expireAfterSeconds: 3600 },
      })

      const indexes = manager.listIndexes()
      expect(indexes[0]!.expireAfterSeconds).toBe(3600)
    })

    it('should identify expired documents', () => {
      manager.createIndex({
        fields: { expiresAt: 1 },
        options: { expireAfterSeconds: 3600 },
      })

      const now = Date.now()
      vi.setSystemTime(now)

      const expiredDoc = createTestDoc({
        _id: 'expired',
        expiresAt: now - 7200 * 1000, // 2 hours ago
      })
      const validDoc = createTestDoc({
        _id: 'valid',
        expiresAt: now + 3600 * 1000, // 1 hour from now
      })

      manager.indexDocument(expiredDoc)
      manager.indexDocument(validDoc)

      const expired = manager.getExpiredDocumentIds()
      expect(expired).toContain('expired')
      expect(expired).not.toContain('valid')
    })

    it('should expire documents after specified seconds', () => {
      manager.createIndex({
        fields: { createdAt: 1 },
        options: { expireAfterSeconds: 60 },
      })

      const now = Date.now()
      vi.setSystemTime(now)

      const doc = createTestDoc({ _id: 'doc1', createdAt: now })
      manager.indexDocument(doc)

      // Initially not expired
      expect(manager.getExpiredDocumentIds()).not.toContain('doc1')

      // Advance time past TTL
      vi.advanceTimersByTime(61 * 1000)

      expect(manager.getExpiredDocumentIds()).toContain('doc1')
    })

    it('should not mark documents as expired if field is missing', () => {
      manager.createIndex({
        fields: { expiresAt: 1 },
        options: { expireAfterSeconds: 3600 },
      })

      const docNoExpiry = createTestDoc({ _id: 'no-expiry', expiresAt: undefined })
      manager.indexDocument(docNoExpiry)

      const expired = manager.getExpiredDocumentIds()
      expect(expired).not.toContain('no-expiry')
    })
  })

  // ============================================================================
  // 6. PARTIAL INDEXES
  // ============================================================================

  describe('Partial Indexes', () => {
    it('should create partial index with filter expression', () => {
      manager.createIndex({
        fields: { email: 1 },
        options: {
          partialFilterExpression: { status: 'active' },
        },
      })

      const indexes = manager.listIndexes()
      expect(indexes[0]!.partialFilterExpression).toEqual({ status: 'active' })
    })

    it('should only index documents matching filter', () => {
      manager.createIndex({
        fields: { email: 1 },
        options: {
          partialFilterExpression: { status: 'active' },
        },
      })

      const activeDoc = createTestDoc({ _id: 'active', status: 'active' })
      const inactiveDoc = createTestDoc({ _id: 'inactive', status: 'inactive' })

      manager.indexDocument(activeDoc)
      manager.indexDocument(inactiveDoc)

      const stats = manager.getIndexStats('email_1')
      expect(stats?.documentCount).toBe(1)
    })

    it('should support comparison operators in filter', () => {
      manager.createIndex({
        fields: { email: 1 },
        options: {
          partialFilterExpression: { age: { $gte: 21 } },
        },
      })

      const adult = createTestDoc({ _id: 'adult', age: 25 })
      const minor = createTestDoc({ _id: 'minor', age: 18 })

      manager.indexDocument(adult)
      manager.indexDocument(minor)

      const stats = manager.getIndexStats('email_1')
      expect(stats?.documentCount).toBe(1)
    })

    it('should support $exists in filter', () => {
      manager.createIndex({
        fields: { 'metadata.priority': 1 },
        options: {
          partialFilterExpression: { metadata: { $exists: true } },
        },
      })

      const withMeta = createTestDoc({
        _id: 'with-meta',
        metadata: { priority: 1 },
      })
      const withoutMeta = createTestDoc({
        _id: 'no-meta',
        metadata: undefined,
      })

      manager.indexDocument(withMeta)
      manager.indexDocument(withoutMeta)

      const stats = manager.getIndexStats('metadata_priority_1')
      expect(stats?.documentCount).toBe(1)
    })

    it('should support $in in filter', () => {
      manager.createIndex({
        fields: { email: 1 },
        options: {
          partialFilterExpression: { status: { $in: ['active', 'pending'] } },
        },
      })

      const active = createTestDoc({ _id: 'active', status: 'active' })
      const pending = createTestDoc({ _id: 'pending', status: 'pending' })
      const inactive = createTestDoc({ _id: 'inactive', status: 'inactive' })

      manager.indexDocument(active)
      manager.indexDocument(pending)
      manager.indexDocument(inactive)

      const stats = manager.getIndexStats('email_1')
      expect(stats?.documentCount).toBe(2)
    })
  })

  // ============================================================================
  // 7. DOCUMENT INDEXING AND REMOVAL
  // ============================================================================

  describe('Document Indexing', () => {
    beforeEach(() => {
      manager.createIndex({ fields: { email: 1 } })
      manager.createIndex({ fields: { status: 1, age: -1 } })
    })

    it('should index document across all indexes', () => {
      const doc = createTestDoc()
      manager.indexDocument(doc)

      const emailStats = manager.getIndexStats('email_1')
      const statusStats = manager.getIndexStats('status_1_age_-1')

      expect(emailStats?.documentCount).toBe(1)
      expect(statusStats?.documentCount).toBe(1)
    })

    it('should update indexed values on re-index', () => {
      const doc = createTestDoc({ _id: 'doc1', email: 'old@example.com' })
      manager.indexDocument(doc)

      // Update and re-index
      const updatedDoc = { ...doc, email: 'new@example.com' }
      manager.indexDocument(updatedDoc)

      const results = manager.find({ email: 'new@example.com' })
      expect(results).toContain('doc1')

      const oldResults = manager.find({ email: 'old@example.com' })
      expect(oldResults).not.toContain('doc1')
    })

    it('should remove document from all indexes', () => {
      const doc = createTestDoc({ _id: 'doc1' })
      manager.indexDocument(doc)
      manager.removeDocument('doc1')

      const emailStats = manager.getIndexStats('email_1')
      expect(emailStats?.documentCount).toBe(0)
    })

    it('should handle batch indexing', () => {
      const docs = createTestDocs(100)
      manager.indexDocuments(docs)

      const stats = manager.getIndexStats('email_1')
      expect(stats?.documentCount).toBe(100)
    })

    it('should handle batch removal', () => {
      const docs = createTestDocs(100)
      manager.indexDocuments(docs)

      const idsToRemove = docs.slice(0, 50).map((d) => d._id)
      manager.removeDocuments(idsToRemove)

      const stats = manager.getIndexStats('email_1')
      expect(stats?.documentCount).toBe(50)
    })
  })

  // ============================================================================
  // 8. INDEX QUERIES
  // ============================================================================

  describe('Index Queries', () => {
    beforeEach(() => {
      manager.createIndex({ fields: { email: 1 } })
      manager.createIndex({ fields: { status: 1 } })
      manager.createIndex({ fields: { age: 1 } })
      manager.createIndex({ fields: { status: 1, age: -1 } })

      const docs = createTestDocs(100)
      manager.indexDocuments(docs)
    })

    it('should find documents by single field', () => {
      const results = manager.find({ email: 'user10@example.com' })
      expect(results).toContain('doc-10')
      expect(results.length).toBe(1)
    })

    it('should find documents by range', () => {
      const results = manager.find({ age: { $gte: 60 } })
      // Age is 20 + (i % 50), so max is 69
      // Values >= 60: 60, 61, 62, ..., 69 = 10 values
      // These occur at i where (20 + i % 50) >= 60
      // i % 50 >= 40, so i in [40-49, 90-99] = 20 documents
      expect(results.length).toBe(20)
    })

    it('should find documents using compound index prefix', () => {
      const results = manager.find({ status: 'active' })
      expect(results.length).toBe(50) // Half are active
    })

    it('should find documents using full compound index', () => {
      const results = manager.find({ status: 'active', age: { $gt: 50 } })
      // Active (even i) with age > 50 (i % 50 > 30)
      // i % 50 in [31-49] and i is even
      expect(results.length).toBeGreaterThan(0)
    })

    it('should return empty array for no matches', () => {
      const results = manager.find({ email: 'nonexistent@example.com' })
      expect(results).toEqual([])
    })

    it('should support $in operator', () => {
      const results = manager.find({
        status: { $in: ['active', 'pending'] },
      })
      expect(results.length).toBe(50) // All active, none pending
    })

    it('should support $ne operator', () => {
      const results = manager.find({ status: { $ne: 'active' } })
      expect(results.length).toBe(50) // All inactive
    })

    it('should support $lt and $gt operators', () => {
      const results = manager.find({
        age: { $gt: 30, $lt: 40 },
      })
      // Ages from 31 to 39 (inclusive range based on age = 20 + i%50)
      expect(results.length).toBeGreaterThan(0)
    })
  })

  // ============================================================================
  // 9. INDEX MANAGEMENT
  // ============================================================================

  describe('Index Management', () => {
    it('should drop an index by name', () => {
      manager.createIndex({ fields: { email: 1 } })
      manager.createIndex({ fields: { status: 1 } })

      manager.dropIndex('email_1')

      const indexes = manager.listIndexes()
      expect(indexes.map((i) => i.name)).not.toContain('email_1')
      expect(indexes.map((i) => i.name)).toContain('status_1')
    })

    it('should throw when dropping non-existent index', () => {
      expect(() => manager.dropIndex('nonexistent')).toThrow(/not found/i)
    })

    it('should clear all indexes', () => {
      manager.createIndex({ fields: { email: 1 } })
      manager.createIndex({ fields: { status: 1 } })

      manager.clearAllIndexes()

      expect(manager.listIndexes().length).toBe(0)
    })

    it('should rebuild index', () => {
      manager.createIndex({ fields: { email: 1 } })
      const docs = createTestDocs(10)
      manager.indexDocuments(docs)

      manager.rebuildIndex('email_1')

      const stats = manager.getIndexStats('email_1')
      expect(stats?.documentCount).toBe(10)
    })

    it('should return index stats', () => {
      manager.createIndex({ fields: { email: 1 } })
      const docs = createTestDocs(100)
      manager.indexDocuments(docs)

      const stats = manager.getIndexStats('email_1')

      expect(stats).toBeDefined()
      expect(stats!.name).toBe('email_1')
      expect(stats!.documentCount).toBe(100)
      expect(stats!.uniqueValues).toBeGreaterThan(0)
      expect(stats!.avgEntriesPerValue).toBeGreaterThan(0)
    })

    it('should return null stats for non-existent index', () => {
      const stats = manager.getIndexStats('nonexistent')
      expect(stats).toBeNull()
    })
  })

  // ============================================================================
  // 10. INDEX SELECTION
  // ============================================================================

  describe('Index Selection', () => {
    beforeEach(() => {
      manager.createIndex({ fields: { email: 1 } })
      manager.createIndex({ fields: { status: 1 } })
      manager.createIndex({ fields: { status: 1, age: -1 } })
      manager.createIndex({ fields: { 'metadata.category': 1 } })
    })

    it('should select single-field index for single-field query', () => {
      const selected = manager.selectIndex({ email: 'test@example.com' })
      expect(selected?.name).toBe('email_1')
    })

    it('should prefer compound index over single-field when applicable', () => {
      const selected = manager.selectIndex({ status: 'active', age: 25 })
      expect(selected?.name).toBe('status_1_age_-1')
    })

    it('should use compound index prefix', () => {
      const selected = manager.selectIndex({ status: 'active' })
      // Should select status_1 since it exactly matches
      // status_1_age_-1 could also work, but exact match preferred
      expect(selected?.name).toMatch(/status/)
    })

    it('should select nested field index', () => {
      const selected = manager.selectIndex({ 'metadata.category': 'A' })
      expect(selected?.name).toBe('metadata_category_1')
    })

    it('should return null when no suitable index exists', () => {
      const selected = manager.selectIndex({ 'unknown.field': 'value' })
      expect(selected).toBeNull()
    })

    it('should consider index direction for sort', () => {
      const selected = manager.selectIndex(
        { status: 'active' },
        { sort: { age: -1 } }
      )
      // Compound index with status and age desc should be preferred
      expect(selected?.name).toBe('status_1_age_-1')
    })
  })

  // ============================================================================
  // 11. PATH EXTRACTION INTEGRATION
  // ============================================================================

  describe('Path Extraction', () => {
    it('should extract value from simple path', () => {
      const doc = createTestDoc({ email: 'test@example.com' })
      const value = manager.extractValue(doc, 'email')
      expect(value).toBe('test@example.com')
    })

    it('should extract value from nested path', () => {
      const doc = createTestDoc({
        address: { city: 'Seattle', state: 'WA' },
      })
      const value = manager.extractValue(doc, 'address.city')
      expect(value).toBe('Seattle')
    })

    it('should return undefined for missing path', () => {
      const doc = createTestDoc()
      const value = manager.extractValue(doc, 'nonexistent.path')
      expect(value).toBeUndefined()
    })

    it('should handle array field paths', () => {
      const doc = createTestDoc({ tags: ['a', 'b', 'c'] })
      const value = manager.extractValue(doc, 'tags')
      expect(value).toEqual(['a', 'b', 'c'])
    })

    it('should extract compound key values', () => {
      const doc = createTestDoc({ status: 'active', age: 25 })
      const values = manager.extractCompoundKey(doc, ['status', 'age'])
      expect(values).toEqual(['active', 25])
    })
  })

  // ============================================================================
  // 12. SCHEMA EVOLUTION INTEGRATION
  // ============================================================================

  describe('Schema Evolution', () => {
    it('should handle type change in indexed field (number to string)', () => {
      manager.createIndex({ fields: { age: 1 } })

      const numericDoc = createTestDoc({ _id: 'num', age: 25 })
      const stringDoc = { ...createTestDoc({ _id: 'str' }), age: '25' as unknown as number }

      manager.indexDocument(numericDoc)
      manager.indexDocument(stringDoc)

      // Both should be indexed, coerced to comparable format
      const stats = manager.getIndexStats('age_1')
      expect(stats?.documentCount).toBe(2)
    })

    it('should handle null to value type change', () => {
      manager.createIndex({ fields: { email: 1 } })

      const nullDoc = createTestDoc({ _id: 'null-doc', email: undefined })
      manager.indexDocument(nullDoc)

      // Update with value
      const updatedDoc = createTestDoc({ _id: 'null-doc', email: 'now@has.value' })
      manager.indexDocument(updatedDoc)

      const results = manager.find({ email: 'now@has.value' })
      expect(results).toContain('null-doc')
    })

    it('should track type statistics per field', () => {
      manager.createIndex({ fields: { email: 1 } })

      const docs = [
        createTestDoc({ _id: '1', email: 'string@example.com' }),
        createTestDoc({ _id: '2', email: undefined }),
      ]

      manager.indexDocuments(docs)

      const stats = manager.getIndexStats('email_1')
      expect(stats?.typeStats).toBeDefined()
      expect(stats?.typeStats.string).toBe(1)
      expect(stats?.typeStats.undefined).toBe(1)
    })
  })

  // ============================================================================
  // 13. ERROR HANDLING
  // ============================================================================

  describe('Error Handling', () => {
    it('should throw on invalid field name', () => {
      expect(() =>
        manager.createIndex({ fields: { '$invalid': 1 } })
      ).toThrow(/invalid.*field/i)
    })

    it('should throw on invalid direction', () => {
      expect(() =>
        manager.createIndex({ fields: { email: 0 as 1 } })
      ).toThrow(/invalid.*direction/i)
    })

    it('should throw on empty fields', () => {
      expect(() => manager.createIndex({ fields: {} })).toThrow(/empty.*fields/i)
    })

    it('should handle very long field paths gracefully', () => {
      const longPath = 'a.b.c.d.e.f.g.h.i.j.k.l.m.n.o.p'
      manager.createIndex({ fields: { [longPath]: 1 } })

      const indexes = manager.listIndexes()
      expect(indexes.length).toBe(1)
    })
  })

  // ============================================================================
  // 14. CONCURRENCY
  // ============================================================================

  describe('Concurrency', () => {
    it('should handle concurrent indexing operations', async () => {
      manager.createIndex({ fields: { email: 1 } })

      const docs = createTestDocs(100)
      const promises = docs.map((doc) =>
        Promise.resolve(manager.indexDocument(doc))
      )

      await Promise.all(promises)

      const stats = manager.getIndexStats('email_1')
      expect(stats?.documentCount).toBe(100)
    })

    it('should handle concurrent index and remove', async () => {
      manager.createIndex({ fields: { email: 1 } })

      const docs = createTestDocs(10)
      manager.indexDocuments(docs)

      // Concurrent remove and add
      const removePromises = docs.slice(0, 5).map((d) =>
        Promise.resolve(manager.removeDocument(d._id))
      )
      const addPromises = createTestDocs(5).map((d) => {
        d._id = `new-${d._id}`
        return Promise.resolve(manager.indexDocument(d))
      })

      await Promise.all([...removePromises, ...addPromises])

      const stats = manager.getIndexStats('email_1')
      expect(stats?.documentCount).toBe(10) // 10 - 5 + 5
    })
  })
})
