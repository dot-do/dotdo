/**
 * CouchDB Client Tests - RED Phase
 *
 * Tests for CouchDB-compatible API with in-memory backend.
 * Following red-green-refactor TDD pattern.
 *
 * CouchDB API Overview:
 * - Database operations: create, delete, info
 * - Document operations: put, get, delete, bulk
 * - View queries: MapReduce views with emit
 * - Mango queries: find with selectors
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { CouchDB, Database } from '../src/index'

describe('CouchDB Client', () => {
  let client: CouchDB

  beforeEach(() => {
    client = new CouchDB()
  })

  describe('database operations', () => {
    it('should create a database', async () => {
      const result = await client.createDatabase('testdb')

      expect(result.ok).toBe(true)
    })

    it('should not allow duplicate database names', async () => {
      await client.createDatabase('testdb')

      await expect(client.createDatabase('testdb')).rejects.toThrow(/already exists/)
    })

    it('should delete a database', async () => {
      await client.createDatabase('testdb')
      const result = await client.deleteDatabase('testdb')

      expect(result.ok).toBe(true)
    })

    it('should throw when deleting non-existent database', async () => {
      await expect(client.deleteDatabase('nonexistent')).rejects.toThrow(/not found/)
    })

    it('should get database info', async () => {
      await client.createDatabase('testdb')
      const info = await client.info('testdb')

      expect(info.db_name).toBe('testdb')
      expect(info.doc_count).toBe(0)
    })

    it('should list all databases', async () => {
      await client.createDatabase('db1')
      await client.createDatabase('db2')

      const dbs = await client.listDatabases()

      expect(dbs).toContain('db1')
      expect(dbs).toContain('db2')
    })

    it('should access database by name', () => {
      const db = client.use('testdb')

      expect(db).toBeInstanceOf(Database)
      expect(db.name).toBe('testdb')
    })
  })
})

describe('Database Document Operations', () => {
  let client: CouchDB
  let db: Database

  beforeEach(async () => {
    client = new CouchDB()
    await client.createDatabase('testdb')
    db = client.use('testdb')
  })

  describe('put (create/update)', () => {
    it('should create a document with provided _id', async () => {
      const result = await db.put({
        _id: 'doc1',
        name: 'Alice',
        type: 'user',
      })

      expect(result.ok).toBe(true)
      expect(result.id).toBe('doc1')
      expect(result.rev).toMatch(/^1-/)
    })

    it('should generate _id if not provided', async () => {
      const result = await db.put({
        name: 'Bob',
        type: 'user',
      })

      expect(result.ok).toBe(true)
      expect(result.id).toBeDefined()
      expect(typeof result.id).toBe('string')
    })

    it('should update a document with correct _rev', async () => {
      const create = await db.put({ _id: 'doc1', name: 'Alice' })
      const update = await db.put({
        _id: 'doc1',
        _rev: create.rev,
        name: 'Alice Updated',
      })

      expect(update.ok).toBe(true)
      expect(update.rev).toMatch(/^2-/)
    })

    it('should reject update with wrong _rev (conflict)', async () => {
      await db.put({ _id: 'doc1', name: 'Alice' })

      await expect(
        db.put({ _id: 'doc1', _rev: '1-wrongrev', name: 'Bob' })
      ).rejects.toThrow(/conflict/)
    })

    it('should reject update without _rev for existing doc', async () => {
      await db.put({ _id: 'doc1', name: 'Alice' })

      await expect(db.put({ _id: 'doc1', name: 'Bob' })).rejects.toThrow(/conflict/)
    })
  })

  describe('get', () => {
    it('should get a document by _id', async () => {
      await db.put({ _id: 'doc1', name: 'Alice', type: 'user' })

      const doc = await db.get('doc1')

      expect(doc._id).toBe('doc1')
      expect(doc._rev).toMatch(/^1-/)
      expect(doc.name).toBe('Alice')
      expect(doc.type).toBe('user')
    })

    it('should throw for non-existent document', async () => {
      await expect(db.get('nonexistent')).rejects.toThrow(/not found/)
    })

    it('should get specific revision', async () => {
      const create = await db.put({ _id: 'doc1', name: 'v1' })
      await db.put({ _id: 'doc1', _rev: create.rev, name: 'v2' })

      const doc = await db.get('doc1', { rev: create.rev })

      expect(doc.name).toBe('v1')
    })
  })

  describe('delete', () => {
    it('should delete a document', async () => {
      const create = await db.put({ _id: 'doc1', name: 'Alice' })

      const result = await db.delete('doc1', create.rev)

      expect(result.ok).toBe(true)
    })

    it('should throw for wrong revision', async () => {
      await db.put({ _id: 'doc1', name: 'Alice' })

      await expect(db.delete('doc1', '1-wrongrev')).rejects.toThrow(/conflict/)
    })

    it('should throw for non-existent document', async () => {
      await expect(db.delete('nonexistent', '1-abc')).rejects.toThrow(/not found/)
    })

    it('should not return deleted document on get', async () => {
      const create = await db.put({ _id: 'doc1', name: 'Alice' })
      await db.delete('doc1', create.rev)

      await expect(db.get('doc1')).rejects.toThrow(/not found|deleted/)
    })
  })

  describe('bulkDocs', () => {
    it('should insert multiple documents', async () => {
      const results = await db.bulkDocs([
        { _id: 'doc1', name: 'Alice' },
        { _id: 'doc2', name: 'Bob' },
        { _id: 'doc3', name: 'Charlie' },
      ])

      expect(results).toHaveLength(3)
      expect(results[0].ok).toBe(true)
      expect(results[0].id).toBe('doc1')
      expect(results[1].ok).toBe(true)
      expect(results[2].ok).toBe(true)
    })

    it('should update and delete in bulk', async () => {
      const create1 = await db.put({ _id: 'doc1', name: 'Alice' })
      const create2 = await db.put({ _id: 'doc2', name: 'Bob' })

      const results = await db.bulkDocs([
        { _id: 'doc1', _rev: create1.rev, name: 'Alice Updated' },
        { _id: 'doc2', _rev: create2.rev, _deleted: true },
        { _id: 'doc3', name: 'Charlie' },
      ])

      expect(results).toHaveLength(3)
      expect(results.every((r) => r.ok)).toBe(true)
    })

    it('should report conflicts in bulk operations', async () => {
      await db.put({ _id: 'doc1', name: 'Alice' })

      const results = await db.bulkDocs([
        { _id: 'doc1', name: 'Conflict' }, // No _rev
        { _id: 'doc2', name: 'Bob' },
      ])

      expect(results[0].ok).toBeUndefined()
      expect(results[0].error).toBe('conflict')
      expect(results[1].ok).toBe(true)
    })
  })

  describe('allDocs', () => {
    beforeEach(async () => {
      await db.bulkDocs([
        { _id: 'a', name: 'Alice' },
        { _id: 'b', name: 'Bob' },
        { _id: 'c', name: 'Charlie' },
      ])
    })

    it('should get all documents', async () => {
      const result = await db.allDocs()

      expect(result.total_rows).toBe(3)
      expect(result.rows).toHaveLength(3)
      expect(result.rows[0].id).toBe('a')
      expect(result.rows[0].key).toBe('a')
      expect(result.rows[0].value.rev).toMatch(/^1-/)
    })

    it('should include document bodies with include_docs', async () => {
      const result = await db.allDocs({ include_docs: true })

      expect(result.rows[0].doc).toBeDefined()
      expect(result.rows[0].doc?.name).toBe('Alice')
    })

    it('should support startkey and endkey', async () => {
      const result = await db.allDocs({ startkey: 'b', endkey: 'c' })

      expect(result.rows).toHaveLength(2)
      expect(result.rows[0].id).toBe('b')
      expect(result.rows[1].id).toBe('c')
    })

    it('should support limit', async () => {
      const result = await db.allDocs({ limit: 2 })

      expect(result.rows).toHaveLength(2)
    })

    it('should support skip', async () => {
      const result = await db.allDocs({ skip: 1 })

      expect(result.rows).toHaveLength(2)
      expect(result.rows[0].id).toBe('b')
    })

    it('should support descending order', async () => {
      const result = await db.allDocs({ descending: true })

      expect(result.rows[0].id).toBe('c')
      expect(result.rows[2].id).toBe('a')
    })

    it('should support keys array', async () => {
      const result = await db.allDocs({ keys: ['a', 'c'] })

      expect(result.rows).toHaveLength(2)
      expect(result.rows.map((r) => r.id)).toEqual(['a', 'c'])
    })
  })
})

describe('Mango Find Queries', () => {
  let client: CouchDB
  let db: Database

  beforeEach(async () => {
    client = new CouchDB()
    await client.createDatabase('testdb')
    db = client.use('testdb')

    await db.bulkDocs([
      { _id: '1', type: 'user', name: 'Alice', age: 30, city: 'NYC' },
      { _id: '2', type: 'user', name: 'Bob', age: 25, city: 'LA' },
      { _id: '3', type: 'user', name: 'Charlie', age: 35, city: 'NYC' },
      { _id: '4', type: 'post', title: 'Hello World', author: '1' },
      { _id: '5', type: 'post', title: 'CouchDB Guide', author: '2' },
    ])
  })

  describe('find with selector', () => {
    it('should find documents with equality selector', async () => {
      const result = await db.find({ selector: { type: 'user' } })

      expect(result.docs).toHaveLength(3)
      expect(result.docs.every((d) => d.type === 'user')).toBe(true)
    })

    it('should find with nested field selector', async () => {
      const result = await db.find({ selector: { type: 'user', city: 'NYC' } })

      expect(result.docs).toHaveLength(2)
      expect(result.docs.every((d) => d.city === 'NYC')).toBe(true)
    })

    it('should support $eq operator', async () => {
      const result = await db.find({ selector: { age: { $eq: 30 } } })

      expect(result.docs).toHaveLength(1)
      expect(result.docs[0].name).toBe('Alice')
    })

    it('should support $ne operator', async () => {
      const result = await db.find({
        selector: { type: 'user', city: { $ne: 'NYC' } },
      })

      expect(result.docs).toHaveLength(1)
      expect(result.docs[0].name).toBe('Bob')
    })

    it('should support $gt operator', async () => {
      const result = await db.find({
        selector: { type: 'user', age: { $gt: 28 } },
      })

      expect(result.docs).toHaveLength(2)
      expect(result.docs.map((d) => d.name).sort()).toEqual(['Alice', 'Charlie'])
    })

    it('should support $gte operator', async () => {
      const result = await db.find({
        selector: { type: 'user', age: { $gte: 30 } },
      })

      expect(result.docs).toHaveLength(2)
    })

    it('should support $lt operator', async () => {
      const result = await db.find({
        selector: { type: 'user', age: { $lt: 30 } },
      })

      expect(result.docs).toHaveLength(1)
      expect(result.docs[0].name).toBe('Bob')
    })

    it('should support $lte operator', async () => {
      const result = await db.find({
        selector: { type: 'user', age: { $lte: 30 } },
      })

      expect(result.docs).toHaveLength(2)
    })

    it('should support $in operator', async () => {
      const result = await db.find({
        selector: { city: { $in: ['NYC', 'LA'] } },
      })

      expect(result.docs).toHaveLength(3)
    })

    it('should support $nin operator', async () => {
      const result = await db.find({
        selector: { type: 'user', city: { $nin: ['LA'] } },
      })

      expect(result.docs).toHaveLength(2)
      expect(result.docs.every((d) => d.city !== 'LA')).toBe(true)
    })

    it('should support $exists operator', async () => {
      const result = await db.find({
        selector: { author: { $exists: true } },
      })

      expect(result.docs).toHaveLength(2)
      expect(result.docs.every((d) => d.type === 'post')).toBe(true)
    })

    it('should support $and operator', async () => {
      const result = await db.find({
        selector: {
          $and: [{ type: 'user' }, { age: { $gt: 28 } }, { city: 'NYC' }],
        },
      })

      expect(result.docs).toHaveLength(2)
    })

    it('should support $or operator', async () => {
      const result = await db.find({
        selector: {
          $or: [{ name: 'Alice' }, { name: 'Bob' }],
        },
      })

      expect(result.docs).toHaveLength(2)
    })

    it('should support $not operator', async () => {
      const result = await db.find({
        selector: {
          type: 'user',
          age: { $not: { $gt: 30 } },
        },
      })

      expect(result.docs).toHaveLength(2) // Alice (30) and Bob (25)
    })

    it('should support $regex operator', async () => {
      const result = await db.find({
        selector: {
          name: { $regex: '^A' },
        },
      })

      expect(result.docs).toHaveLength(1)
      expect(result.docs[0].name).toBe('Alice')
    })
  })

  describe('find with options', () => {
    it('should support limit', async () => {
      const result = await db.find({
        selector: { type: 'user' },
        limit: 2,
      })

      expect(result.docs).toHaveLength(2)
    })

    it('should support skip', async () => {
      const result = await db.find({
        selector: { type: 'user' },
        skip: 1,
      })

      expect(result.docs).toHaveLength(2)
    })

    it('should support sort ascending', async () => {
      const result = await db.find({
        selector: { type: 'user' },
        sort: [{ age: 'asc' }],
      })

      expect(result.docs[0].age).toBe(25)
      expect(result.docs[2].age).toBe(35)
    })

    it('should support sort descending', async () => {
      const result = await db.find({
        selector: { type: 'user' },
        sort: [{ age: 'desc' }],
      })

      expect(result.docs[0].age).toBe(35)
      expect(result.docs[2].age).toBe(25)
    })

    it('should support fields projection', async () => {
      const result = await db.find({
        selector: { type: 'user' },
        fields: ['_id', 'name'],
      })

      expect(result.docs[0].name).toBeDefined()
      expect(result.docs[0].age).toBeUndefined()
      expect(result.docs[0].city).toBeUndefined()
    })
  })
})

describe('MapReduce Views', () => {
  let client: CouchDB
  let db: Database

  beforeEach(async () => {
    client = new CouchDB()
    await client.createDatabase('testdb')
    db = client.use('testdb')

    await db.bulkDocs([
      { _id: 'post-1', type: 'post', title: 'Hello World', author: 'alice', tags: ['intro', 'hello'] },
      { _id: 'post-2', type: 'post', title: 'CouchDB Guide', author: 'bob', tags: ['couchdb', 'tutorial'] },
      { _id: 'post-3', type: 'post', title: 'Advanced CouchDB', author: 'alice', tags: ['couchdb', 'advanced'] },
      { _id: 'user-1', type: 'user', name: 'Alice', email: 'alice@example.com' },
      { _id: 'user-2', type: 'user', name: 'Bob', email: 'bob@example.com' },
    ])
  })

  describe('design document operations', () => {
    it('should save a design document', async () => {
      const result = await db.put({
        _id: '_design/posts',
        views: {
          byAuthor: {
            map: `function(doc) { if (doc.type === 'post') emit(doc.author, doc.title); }`,
          },
          byTag: {
            map: `function(doc) {
              if (doc.tags) {
                for (var i = 0; i < doc.tags.length; i++) {
                  emit(doc.tags[i], doc._id);
                }
              }
            }`,
          },
        },
      })

      expect(result.ok).toBe(true)
    })

    it('should get a design document', async () => {
      await db.put({
        _id: '_design/posts',
        views: {
          byAuthor: {
            map: `function(doc) { if (doc.type === 'post') emit(doc.author, doc.title); }`,
          },
        },
      })

      const ddoc = await db.get('_design/posts')

      expect(ddoc._id).toBe('_design/posts')
      expect(ddoc.views.byAuthor).toBeDefined()
    })
  })

  describe('view queries', () => {
    beforeEach(async () => {
      await db.put({
        _id: '_design/posts',
        views: {
          byAuthor: {
            map: `function(doc) { if (doc.type === 'post') emit(doc.author, doc.title); }`,
          },
          byTag: {
            map: `function(doc) {
              if (doc.tags) {
                for (var i = 0; i < doc.tags.length; i++) {
                  emit(doc.tags[i], doc._id);
                }
              }
            }`,
          },
          byType: {
            map: `function(doc) { emit(doc.type, 1); }`,
          },
        },
      })
    })

    it('should query a view', async () => {
      const result = await db.view('posts', 'byAuthor')

      expect(result.rows).toHaveLength(3)
      expect(result.rows.some((r) => r.key === 'alice')).toBe(true)
      expect(result.rows.some((r) => r.key === 'bob')).toBe(true)
    })

    it('should query with key filter', async () => {
      const result = await db.view('posts', 'byAuthor', { key: 'alice' })

      expect(result.rows).toHaveLength(2)
      expect(result.rows.every((r) => r.key === 'alice')).toBe(true)
    })

    it('should query with startkey and endkey', async () => {
      const result = await db.view('posts', 'byTag', {
        startkey: 'couchdb',
        endkey: 'couchdb',
      })

      expect(result.rows).toHaveLength(2) // 'couchdb' tag on 2 posts
    })

    it('should include docs with include_docs', async () => {
      const result = await db.view('posts', 'byAuthor', {
        key: 'alice',
        include_docs: true,
      })

      expect(result.rows[0].doc).toBeDefined()
      expect(result.rows[0].doc?.type).toBe('post')
    })

    it('should support limit', async () => {
      const result = await db.view('posts', 'byAuthor', { limit: 1 })

      expect(result.rows).toHaveLength(1)
    })

    it('should support skip', async () => {
      const result = await db.view('posts', 'byAuthor', { skip: 1 })

      expect(result.rows).toHaveLength(2)
    })

    it('should support descending order', async () => {
      const result = await db.view('posts', 'byTag', { descending: true })

      // Tags in descending order: tutorial > intro > hello > couchdb > advanced
      expect(result.rows[0].key).toBe('tutorial')
    })

    it('should handle multiple emits per document', async () => {
      const result = await db.view('posts', 'byTag')

      // Total tags: 2+2+2 = 6 emits
      expect(result.rows).toHaveLength(6)
    })
  })

  describe('reduce functions', () => {
    beforeEach(async () => {
      await db.put({
        _id: '_design/stats',
        views: {
          countByType: {
            map: `function(doc) { emit(doc.type, 1); }`,
            reduce: '_count',
          },
          sumByType: {
            map: `function(doc) { emit(doc.type, 1); }`,
            reduce: '_sum',
          },
        },
      })
    })

    it('should apply _count reduce', async () => {
      const result = await db.view('stats', 'countByType', { reduce: true, group: true })

      expect(result.rows.find((r) => r.key === 'post')?.value).toBe(3)
      expect(result.rows.find((r) => r.key === 'user')?.value).toBe(2)
    })

    it('should apply _sum reduce', async () => {
      const result = await db.view('stats', 'sumByType', { reduce: true, group: true })

      expect(result.rows.find((r) => r.key === 'post')?.value).toBe(3)
      expect(result.rows.find((r) => r.key === 'user')?.value).toBe(2)
    })

    it('should reduce without group (total)', async () => {
      const result = await db.view('stats', 'countByType', { reduce: true })

      expect(result.rows).toHaveLength(1)
      expect(result.rows[0].value).toBe(5)
    })

    it('should skip reduce when reduce=false', async () => {
      const result = await db.view('stats', 'countByType', { reduce: false })

      expect(result.rows).toHaveLength(5)
      expect(result.rows.every((r) => r.value === 1)).toBe(true)
    })
  })
})

describe('Changes Feed', () => {
  let client: CouchDB
  let db: Database

  beforeEach(async () => {
    client = new CouchDB()
    await client.createDatabase('testdb')
    db = client.use('testdb')
  })

  it('should get changes since beginning', async () => {
    await db.put({ _id: 'doc1', name: 'Alice' })
    await db.put({ _id: 'doc2', name: 'Bob' })

    const changes = await db.changes()

    expect(changes.results).toHaveLength(2)
    expect(changes.last_seq).toBeDefined()
  })

  it('should get changes since a sequence', async () => {
    await db.put({ _id: 'doc1', name: 'Alice' })
    const firstChanges = await db.changes()

    await db.put({ _id: 'doc2', name: 'Bob' })
    const laterChanges = await db.changes({ since: firstChanges.last_seq })

    expect(laterChanges.results).toHaveLength(1)
    expect(laterChanges.results[0].id).toBe('doc2')
  })

  it('should include docs when requested', async () => {
    await db.put({ _id: 'doc1', name: 'Alice' })

    const changes = await db.changes({ include_docs: true })

    expect(changes.results[0].doc).toBeDefined()
    expect(changes.results[0].doc?.name).toBe('Alice')
  })

  it('should track deletions', async () => {
    const create = await db.put({ _id: 'doc1', name: 'Alice' })
    await db.delete('doc1', create.rev)

    const changes = await db.changes()

    const deleteChange = changes.results.find((r) => r.deleted)
    expect(deleteChange).toBeDefined()
    expect(deleteChange?.id).toBe('doc1')
  })

  it('should limit results', async () => {
    await db.put({ _id: 'doc1', name: 'Alice' })
    await db.put({ _id: 'doc2', name: 'Bob' })
    await db.put({ _id: 'doc3', name: 'Charlie' })

    const changes = await db.changes({ limit: 2 })

    expect(changes.results).toHaveLength(2)
  })
})

describe('Attachment Support', () => {
  let client: CouchDB
  let db: Database

  beforeEach(async () => {
    client = new CouchDB()
    await client.createDatabase('testdb')
    db = client.use('testdb')
  })

  it('should add an attachment to a document', async () => {
    const create = await db.put({ _id: 'doc1', name: 'Test' })

    const result = await db.putAttachment(
      'doc1',
      'readme.txt',
      create.rev,
      Buffer.from('Hello World'),
      'text/plain'
    )

    expect(result.ok).toBe(true)
    expect(result.rev).toMatch(/^2-/)
  })

  it('should get an attachment', async () => {
    const create = await db.put({ _id: 'doc1', name: 'Test' })
    await db.putAttachment(
      'doc1',
      'readme.txt',
      create.rev,
      Buffer.from('Hello World'),
      'text/plain'
    )

    const data = await db.getAttachment('doc1', 'readme.txt')

    expect(data.toString()).toBe('Hello World')
  })

  it('should delete an attachment', async () => {
    const create = await db.put({ _id: 'doc1', name: 'Test' })
    const attach = await db.putAttachment(
      'doc1',
      'readme.txt',
      create.rev,
      Buffer.from('Hello World'),
      'text/plain'
    )

    const result = await db.deleteAttachment('doc1', 'readme.txt', attach.rev)

    expect(result.ok).toBe(true)
  })

  it('should include attachment stubs in document', async () => {
    const create = await db.put({ _id: 'doc1', name: 'Test' })
    await db.putAttachment(
      'doc1',
      'readme.txt',
      create.rev,
      Buffer.from('Hello World'),
      'text/plain'
    )

    const doc = await db.get('doc1')

    expect(doc._attachments).toBeDefined()
    expect(doc._attachments?.['readme.txt']).toBeDefined()
    expect(doc._attachments?.['readme.txt'].content_type).toBe('text/plain')
    expect(doc._attachments?.['readme.txt'].stub).toBe(true)
  })
})

describe('Compaction', () => {
  let client: CouchDB
  let db: Database

  beforeEach(async () => {
    client = new CouchDB()
    await client.createDatabase('testdb')
    db = client.use('testdb')
  })

  it('should compact the database', async () => {
    // Create several revisions
    let rev = (await db.put({ _id: 'doc1', v: 1 })).rev
    rev = (await db.put({ _id: 'doc1', _rev: rev, v: 2 })).rev
    rev = (await db.put({ _id: 'doc1', _rev: rev, v: 3 })).rev
    await db.put({ _id: 'doc1', _rev: rev, v: 4 })

    const result = await db.compact()

    expect(result.ok).toBe(true)
  })

  it('should remove old revisions after compaction', async () => {
    let rev = (await db.put({ _id: 'doc1', v: 1 })).rev
    const oldRev = rev
    rev = (await db.put({ _id: 'doc1', _rev: rev, v: 2 })).rev
    await db.put({ _id: 'doc1', _rev: rev, v: 3 })

    await db.compact()

    // Old revision should no longer be accessible
    await expect(db.get('doc1', { rev: oldRev })).rejects.toThrow()
  })
})

describe('Replication', () => {
  let client: CouchDB
  let source: Database
  let target: Database

  beforeEach(async () => {
    client = new CouchDB()
    await client.createDatabase('source')
    await client.createDatabase('target')
    source = client.use('source')
    target = client.use('target')
  })

  it('should replicate documents from source to target', async () => {
    await source.put({ _id: 'doc1', name: 'Alice' })
    await source.put({ _id: 'doc2', name: 'Bob' })

    const result = await client.replicate('source', 'target')

    expect(result.ok).toBe(true)
    expect(result.docs_written).toBe(2)

    const doc1 = await target.get('doc1')
    const doc2 = await target.get('doc2')

    expect(doc1.name).toBe('Alice')
    expect(doc2.name).toBe('Bob')
  })

  it('should handle incremental replication', async () => {
    await source.put({ _id: 'doc1', name: 'Alice' })
    await client.replicate('source', 'target')

    await source.put({ _id: 'doc2', name: 'Bob' })
    const result = await client.replicate('source', 'target')

    expect(result.docs_written).toBe(1)
  })

  it('should replicate deletions', async () => {
    const create = await source.put({ _id: 'doc1', name: 'Alice' })
    await client.replicate('source', 'target')

    await source.delete('doc1', create.rev)
    await client.replicate('source', 'target')

    await expect(target.get('doc1')).rejects.toThrow(/not found|deleted/)
  })
})
