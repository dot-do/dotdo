/**
 * ThingsStorageStrategy Tests
 *
 * Tests for the MongoDB-style storage strategy that uses the Things table
 * for document storage with JSON data.
 *
 * @module @dotdo/payload/tests/strategies/things
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  ThingsStorageStrategy,
  createThingsStrategy,
  type ThingsStrategyConfig,
} from '../../src/strategies/things'
import type { PayloadCollection, PayloadField } from '../../src/adapter/types'

// ============================================================================
// MOCK DATABASE
// ============================================================================

/**
 * Create a mock in-memory database for testing
 */
function createMockDb() {
  const things: any[] = []
  const nouns: any[] = []
  const relationships: any[] = []
  let rowidCounter = 0
  let nounRowidCounter = 0

  const db = {
    things,
    nouns,
    relationships,
    rowidCounter: () => rowidCounter,
    nounRowidCounter: () => nounRowidCounter,

    select() {
      return {
        from: (table: any) => ({
          where: (condition: any) => ({
            limit: (n: number) => Promise.resolve([]),
            orderBy: (...args: any[]) => ({
              limit: (n: number) => Promise.resolve([]),
            }),
          }),
          limit: (n: number) => Promise.resolve([]),
        }),
      }
    },

    insert(table: any) {
      return {
        values: (data: any) => {
          if (table.name === 'nouns') {
            nounRowidCounter++
            nouns.push({ ...data, rowid: nounRowidCounter })
            return Promise.resolve()
          }
          if (table.name === 'things') {
            rowidCounter++
            const now = new Date()
            things.push({
              ...data,
              rowid: rowidCounter,
              createdAt: now,
              updatedAt: now,
            })
            return Promise.resolve()
          }
          if (table.name === 'relationships') {
            relationships.push({ ...data, rowid: relationships.length + 1 })
            return Promise.resolve()
          }
          return Promise.resolve()
        },
      }
    },

    // Raw query execution for SQLite
    // Signature: all(sql, params) for D1 style OR all({ sql, params }) for object style
    all(sqlOrQuery: any, maybeParams?: any[]): Promise<any[]> {
      // Handle both call signatures
      const sqlString = typeof sqlOrQuery === 'string' ? sqlOrQuery : sqlOrQuery?.sql || ''
      const params = maybeParams || sqlOrQuery?.params || []

      // Debug log
      // console.log('SQL:', sqlString.substring(0, 100), 'Params:', params, 'Things:', things.map(t => ({id: t.id, type: t.type})))

      // SELECT rowid FROM nouns
      if (sqlString.includes('SELECT rowid FROM nouns')) {
        const nounParam = params[0]
        const noun = nouns.find((n) => n.noun === nounParam)
        return Promise.resolve(noun ? [{ rowid: noun.rowid }] : [])
      }

      // SELECT * FROM things with rowid
      if (sqlString.includes('FROM things t') && sqlString.includes('INNER JOIN')) {
        // find query - return things filtered by type
        const typeParam = params.find((p: any) => typeof p === 'number')
        let filtered = [...things]

        if (typeParam !== undefined) {
          filtered = filtered.filter((t) => t.type === typeParam && !t.deleted)
        }

        // Group by id, get latest version
        const latestById = new Map<string, any>()
        for (const t of filtered) {
          const existing = latestById.get(t.id)
          if (!existing || t.rowid > existing.rowid) {
            latestById.set(t.id, {
              ...t,
              version: t.rowid,
              data: typeof t.data === 'object' ? JSON.stringify(t.data) : t.data,
            })
          }
        }

        return Promise.resolve(Array.from(latestById.values()))
      }

      // SELECT for single thing by id
      if (sqlString.includes('FROM things') && sqlString.includes('id =')) {
        const idParam = params[0]
        const typeParam = params.find((p: any) => typeof p === 'number')

        let filtered = things.filter((t) => t.id === idParam && !t.deleted)
        if (typeParam !== undefined) {
          filtered = filtered.filter((t) => t.type === typeParam)
        }

        const latest = filtered.reduce((best, t) => {
          if (!best || t.rowid > best.rowid) return t
          return best
        }, null as any)

        if (latest) {
          return Promise.resolve([{
            ...latest,
            version: latest.rowid,
            data: typeof latest.data === 'object' ? JSON.stringify(latest.data) : latest.data,
          }])
        }
        return Promise.resolve([])
      }

      // COUNT query
      if (sqlString.includes('COUNT')) {
        const typeParam = params.find((p: any) => typeof p === 'number')

        // Count unique IDs
        const ids = new Set<string>()
        for (const t of things) {
          if (!t.deleted && (typeParam === undefined || t.type === typeParam)) {
            ids.add(t.id)
          }
        }
        return Promise.resolve([{ count: ids.size }])
      }

      // BEGIN/COMMIT/ROLLBACK
      if (sqlString.includes('BEGIN') || sqlString.includes('COMMIT') || sqlString.includes('ROLLBACK')) {
        return Promise.resolve([])
      }

      // DELETE from relationships
      if (sqlString.includes('DELETE FROM relationships')) {
        // Parse from param
        const fromIdx = params.findIndex((p: any) => typeof p === 'string' && p.includes('/'))
        const from = fromIdx >= 0 ? params[fromIdx] : null

        if (from) {
          const toRemove = relationships.filter((r) => r.from === from)
          for (const r of toRemove) {
            const idx = relationships.indexOf(r)
            if (idx >= 0) relationships.splice(idx, 1)
          }
        }
        return Promise.resolve([])
      }

      // SELECT from relationships
      if (sqlString.includes('FROM relationships')) {
        const fromParam = params.find((p: any) => typeof p === 'string' && p.includes('/'))
        if (fromParam) {
          return Promise.resolve(relationships.filter((r) => r.from === fromParam))
        }
        return Promise.resolve(relationships)
      }

      return Promise.resolve([])
    },
  }

  return db
}

// Mock schema
const mockSchema = {
  things: { name: 'things' },
  nouns: { name: 'nouns', noun: 'noun' },
  relationships: { name: 'relationships' },
}

// ============================================================================
// TEST FIXTURES
// ============================================================================

const testNamespace = 'https://test.do'

const postsCollection: PayloadCollection = {
  slug: 'posts',
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'content', type: 'richText' },
    { name: 'status', type: 'select', options: ['draft', 'published'] },
    { name: 'author', type: 'relationship', relationTo: 'users' },
    { name: 'tags', type: 'array', fields: [{ name: 'tag', type: 'text' }] },
  ],
}

const usersCollection: PayloadCollection = {
  slug: 'users',
  fields: [
    { name: 'name', type: 'text', required: true },
    { name: 'email', type: 'email', required: true, index: true },
    { name: 'role', type: 'select', options: ['admin', 'user'] },
  ],
}

// ============================================================================
// TESTS
// ============================================================================

describe('ThingsStorageStrategy', () => {
  let mockDb: ReturnType<typeof createMockDb>
  let strategy: ThingsStorageStrategy

  beforeEach(() => {
    mockDb = createMockDb()
    strategy = createThingsStrategy({
      db: mockDb as any,
      schema: mockSchema as any,
      namespace: testNamespace,
      autoIndex: false,
    })
  })

  describe('init', () => {
    it('should register nouns for collections', async () => {
      await strategy.init({} as any, [postsCollection, usersCollection])

      expect(mockDb.nouns.length).toBe(2)
      expect(mockDb.nouns[0].noun).toBe('Post')
      expect(mockDb.nouns[1].noun).toBe('User')
    })

    it('should use pluralized slug for noun plural', async () => {
      await strategy.init({} as any, [postsCollection])

      expect(mockDb.nouns[0].plural).toBe('posts')
    })
  })

  describe('create', () => {
    beforeEach(async () => {
      await strategy.init({} as any, [postsCollection, usersCollection])
    })

    it('should create a document with generated ID', async () => {
      const doc = await strategy.create({
        collection: 'posts',
        data: { title: 'Test Post', content: 'Hello world' },
      })

      expect(doc.id).toBeDefined()
      expect(doc.title).toBe('Test Post')
      expect(doc.content).toBe('Hello world')
      expect(doc.createdAt).toBeDefined()
      expect(doc.updatedAt).toBeDefined()
    })

    it('should create a document with provided ID', async () => {
      const doc = await strategy.create({
        collection: 'posts',
        data: { id: 'custom-id', title: 'Test Post' },
      })

      expect(doc.id).toBe('custom-id')
    })

    it('should insert into things table', async () => {
      await strategy.create({
        collection: 'posts',
        data: { id: 'test-id', title: 'Test' },
      })

      expect(mockDb.things.length).toBe(1)
      expect(mockDb.things[0].id).toBe('test-id')
    })

    it('should create relationships for relation fields', async () => {
      await strategy.create({
        collection: 'posts',
        data: { title: 'Test', author: 'user-123' },
      })

      expect(mockDb.relationships.length).toBe(1)
      expect(mockDb.relationships[0].verb).toBe('hasAuthor')
      expect(mockDb.relationships[0].to).toContain('users/user-123')
    })
  })

  describe('find', () => {
    beforeEach(async () => {
      await strategy.init({} as any, [postsCollection])

      // Create test data directly in mock
      const typeId = 1
      mockDb.things.push(
        { id: '1', type: typeId, data: { title: 'First' }, deleted: false, rowid: 1 },
        { id: '2', type: typeId, data: { title: 'Second' }, deleted: false, rowid: 2 },
        { id: '3', type: typeId, data: { title: 'Third' }, deleted: false, rowid: 3 }
      )
    })

    it('should return paginated results', async () => {
      const result = await strategy.find({
        collection: 'posts',
        limit: 2,
        page: 1,
      })

      expect(result.docs.length).toBeLessThanOrEqual(2)
      expect(result.totalDocs).toBe(3)
      expect(result.page).toBe(1)
    })

    it('should return pagination metadata', async () => {
      const result = await strategy.find({
        collection: 'posts',
        limit: 2,
        page: 1,
      })

      expect(result.limit).toBe(2)
      expect(result.totalPages).toBe(2)
      expect(result.hasNextPage).toBe(true)
      expect(result.hasPrevPage).toBe(false)
    })
  })

  describe('findOne', () => {
    beforeEach(async () => {
      await strategy.init({} as any, [postsCollection])
      mockDb.things.push({
        id: 'test-1',
        type: 1,
        data: { title: 'Test' },
        deleted: false,
        rowid: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    })

    it('should find document by ID', async () => {
      const doc = await strategy.findOne({
        collection: 'posts',
        id: 'test-1',
      })

      expect(doc).not.toBeNull()
      expect(doc?.id).toBe('test-1')
    })

    it('should return null for non-existent ID', async () => {
      const doc = await strategy.findOne({
        collection: 'posts',
        id: 'non-existent',
      })

      expect(doc).toBeNull()
    })
  })

  describe('updateOne', () => {
    beforeEach(async () => {
      await strategy.init({} as any, [postsCollection])
      mockDb.things.push({
        id: 'update-1',
        type: 1,
        data: { title: 'Original' },
        deleted: false,
        rowid: 1,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      })
    })

    it('should update document data', async () => {
      const doc = await strategy.updateOne({
        collection: 'posts',
        id: 'update-1',
        data: { title: 'Updated' },
      })

      expect(doc.title).toBe('Updated')
    })

    it('should create new version (append-only)', async () => {
      await strategy.updateOne({
        collection: 'posts',
        id: 'update-1',
        data: { title: 'Updated' },
      })

      // Should have 2 things now (original + updated)
      const allThings = mockDb.things.filter((t) => t.id === 'update-1')
      expect(allThings.length).toBe(2)
    })
  })

  describe('deleteOne', () => {
    beforeEach(async () => {
      await strategy.init({} as any, [postsCollection])
      mockDb.things.push({
        id: 'delete-1',
        type: 1,
        data: { title: 'To Delete' },
        deleted: false,
        rowid: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    })

    it('should soft delete document', async () => {
      const deleted = await strategy.deleteOne({
        collection: 'posts',
        id: 'delete-1',
      })

      expect(deleted.id).toBe('delete-1')

      // Check the last thing entry is marked deleted
      const lastEntry = mockDb.things[mockDb.things.length - 1]
      expect(lastEntry.deleted).toBe(true)
    })

    it('should throw for non-existent document', async () => {
      await expect(
        strategy.deleteOne({
          collection: 'posts',
          id: 'non-existent',
        })
      ).rejects.toThrow(/not found/)
    })
  })

  describe('count', () => {
    beforeEach(async () => {
      await strategy.init({} as any, [postsCollection])
      mockDb.things.push(
        { id: '1', type: 1, data: {}, deleted: false, rowid: 1 },
        { id: '2', type: 1, data: {}, deleted: false, rowid: 2 }
      )
    })

    it('should count documents', async () => {
      const count = await strategy.count({ collection: 'posts' })
      expect(count).toBe(2)
    })

    it('should exclude deleted documents', async () => {
      mockDb.things.push({ id: '3', type: 1, data: {}, deleted: true, rowid: 3 })
      const count = await strategy.count({ collection: 'posts' })
      expect(count).toBe(2)
    })
  })

  describe('globals', () => {
    beforeEach(async () => {
      await strategy.init({} as any, [])
    })

    it('should create a global', async () => {
      const global = await strategy.createGlobal({
        slug: 'settings',
        data: { siteName: 'Test Site' },
      })

      expect(global.siteName).toBe('Test Site')
      expect(global.createdAt).toBeDefined()
    })

    it('should insert global into things', async () => {
      await strategy.createGlobal({
        slug: 'settings',
        data: { siteName: 'Test Site' },
      })

      const globalThing = mockDb.things.find((t) => t.id.includes('globals/settings'))
      expect(globalThing).toBeDefined()
    })

    it('should return minimal doc for non-existent global', async () => {
      const found = await strategy.findGlobal({ slug: 'non-existent' })
      expect(found).toEqual({ id: 'non-existent' })
    })
  })

  describe('transactions', () => {
    beforeEach(async () => {
      await strategy.init({} as any, [postsCollection])
    })

    it('should begin a transaction', async () => {
      const txId = await strategy.beginTransaction()
      expect(txId).toMatch(/^tx_/)
    })

    it('should commit a transaction', async () => {
      const txId = await strategy.beginTransaction()
      await expect(strategy.commitTransaction(txId)).resolves.toBeUndefined()
    })

    it('should rollback a transaction', async () => {
      const txId = await strategy.beginTransaction()
      await expect(strategy.rollbackTransaction(txId)).resolves.toBeUndefined()
    })

    it('should throw on invalid transaction commit', async () => {
      await expect(
        strategy.commitTransaction('invalid-tx')
      ).rejects.toThrow(/not found/)
    })
  })
})

describe('transforms', () => {
  describe('payloadToThing', () => {
    it('should transform Payload document to Thing', async () => {
      const { payloadToThing } = await import('../../src/strategies/things/transforms')

      const doc = {
        id: 'test-123',
        title: 'Test Post',
        status: 'published',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
      }

      const thing = payloadToThing(doc, 1, {
        collection: 'posts',
        namespace: testNamespace,
        fields: postsCollection.fields,
      })

      expect(thing.id).toBe('test-123')
      expect(thing.type).toBe(1)
      expect(thing.data?.status).toBe('published')
    })

    it('should extract name from title field', async () => {
      const { payloadToThing } = await import('../../src/strategies/things/transforms')

      const doc = {
        id: 'test-123',
        title: 'My Title',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }

      const thing = payloadToThing(doc, 1, {
        collection: 'posts',
        namespace: testNamespace,
        fields: postsCollection.fields,
      })

      expect(thing.name).toBe('My Title')
    })
  })

  describe('thingToPayload', () => {
    it('should transform Thing to Payload document', async () => {
      const { thingToPayload } = await import('../../src/strategies/things/transforms')

      const thing = {
        id: 'test-123',
        type: 1,
        name: 'Test Post',
        data: { title: 'Test Post', status: 'published' },
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
      }

      const doc = thingToPayload(thing, {
        collection: 'posts',
        namespace: testNamespace,
        fields: postsCollection.fields,
      })

      expect(doc.id).toBe('test-123')
      expect(doc.title).toBe('Test Post')
      expect(doc.status).toBe('published')
      expect(doc.createdAt).toBe('2024-01-01T00:00:00.000Z')
    })
  })

  describe('extractRelationships', () => {
    it('should extract relationship edges', async () => {
      const { extractRelationships } = await import('../../src/strategies/things/transforms')

      const doc = {
        id: 'post-1',
        title: 'Test',
        author: 'user-123',
      }

      const relationships = extractRelationships(doc, {
        collection: 'posts',
        namespace: testNamespace,
        fields: postsCollection.fields,
      })

      expect(relationships.length).toBe(1)
      expect(relationships[0].verb).toBe('hasAuthor')
      expect(relationships[0].from).toBe(`${testNamespace}/posts/post-1`)
      expect(relationships[0].to).toBe(`${testNamespace}/users/user-123`)
    })

    it('should handle hasMany relationships', async () => {
      const { extractRelationships } = await import('../../src/strategies/things/transforms')

      const fields: PayloadField[] = [
        { name: 'categories', type: 'relationship', relationTo: 'categories', hasMany: true },
      ]

      const doc = {
        id: 'post-1',
        categories: ['cat-1', 'cat-2', 'cat-3'],
      }

      const relationships = extractRelationships(doc, {
        collection: 'posts',
        namespace: testNamespace,
        fields,
      })

      expect(relationships.length).toBe(3)
      expect(relationships[0].to).toContain('cat-1')
      expect(relationships[1].to).toContain('cat-2')
      expect(relationships[2].to).toContain('cat-3')
    })

    it('should skip null relationships', async () => {
      const { extractRelationships } = await import('../../src/strategies/things/transforms')

      const doc = {
        id: 'post-1',
        title: 'Test',
        author: null,
      }

      const relationships = extractRelationships(doc, {
        collection: 'posts',
        namespace: testNamespace,
        fields: postsCollection.fields,
      })

      expect(relationships.length).toBe(0)
    })
  })

  describe('utility functions', () => {
    it('should generate Thing ID from components', async () => {
      const { getThingId } = await import('../../src/strategies/things/transforms')
      expect(getThingId('https://test.do', 'posts', 'abc')).toBe('https://test.do/posts/abc')
    })

    it('should parse Thing ID to components', async () => {
      const { parseThingId } = await import('../../src/strategies/things/transforms')
      const parsed = parseThingId('https://test.do/posts/abc', 'https://test.do')
      expect(parsed).toEqual({ collection: 'posts', id: 'abc' })
    })

    it('should get noun name from collection slug', async () => {
      const { getNounName } = await import('../../src/strategies/things/transforms')
      expect(getNounName('posts')).toBe('Post')
      expect(getNounName('users')).toBe('User')
      expect(getNounName('media-files')).toBe('MediaFile')
    })
  })
})

describe('factory function', () => {
  it('should create a ThingsStorageStrategy instance', () => {
    const mockDb = createMockDb()
    const strategy = createThingsStrategy({
      db: mockDb as any,
      schema: mockSchema as any,
      namespace: 'https://test.do',
    })

    expect(strategy).toBeInstanceOf(ThingsStorageStrategy)
  })
})
