/**
 * @dotdo/couchdb - CouchDB SDK compat tests (nano style)
 *
 * Tests for CouchDB/nano API compatibility backed by DO SQLite with JSON storage:
 * - nano(url) client creation
 * - couch.db.create/destroy/list/get database management
 * - db.insert/get/destroy document CRUD with revisions
 * - db.bulk bulk document operations
 * - db.view MapReduce views
 * - db.find Mango query selector syntax
 * - db.list list all documents
 * - db.attachment.insert/get/destroy attachments
 * - db.changes changes feed
 * - couch.db.replicate replication basics
 *
 * @see https://github.com/apache/couchdb-nano
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type {
  ServerScope,
  DocumentScope,
  Document,
  DocumentInsertResponse,
  DocumentGetResponse,
  DocumentDestroyResponse,
  BulkModifyDocsWrapper,
  BulkGetResponse,
  ViewResponse,
  MangoResponse,
  DocumentListResponse,
  ChangesResponse,
  AttachmentData,
  DatabaseInfo,
  ServerInfo,
  DesignDocument,
  MangoQuery,
  MangoSelector,
  ViewParams,
  CouchDBError,
  DocumentRevisionResponse,
} from './types'
import nano, { CouchError } from './couchdb'

// ============================================================================
// SERVER SCOPE TESTS
// ============================================================================

describe('nano()', () => {
  it('should create server scope from URL string', () => {
    const couch = nano('http://localhost:5984')
    expect(couch).toBeDefined()
    expect(couch.config.url).toBe('http://localhost:5984')
  })

  it('should create server scope from config object', () => {
    const couch = nano({
      url: 'http://localhost:5984',
      requestDefaults: { timeout: 5000 }
    })
    expect(couch).toBeDefined()
    expect(couch.config.url).toBe('http://localhost:5984')
  })

  it('should parse auth from URL', () => {
    const couch = nano('http://admin:password@localhost:5984')
    expect(couch.config.url).toBe('http://localhost:5984')
    expect(couch.config.auth).toEqual({ username: 'admin', password: 'password' })
  })

  it('should support config with auth object', () => {
    const couch = nano({
      url: 'http://localhost:5984',
      auth: { username: 'admin', password: 'secret' }
    })
    expect(couch.config.auth).toEqual({ username: 'admin', password: 'secret' })
  })

  it('should have db namespace', () => {
    const couch = nano('http://localhost:5984')
    expect(couch.db).toBeDefined()
    expect(typeof couch.db.create).toBe('function')
    expect(typeof couch.db.destroy).toBe('function')
    expect(typeof couch.db.list).toBe('function')
    expect(typeof couch.db.get).toBe('function')
    expect(typeof couch.db.use).toBe('function')
  })

  it('should have use() shortcut', () => {
    const couch = nano('http://localhost:5984')
    expect(typeof couch.use).toBe('function')
    expect(typeof couch.scope).toBe('function')
  })
})

describe('ServerScope.info()', () => {
  it('should return server info', async () => {
    const couch = nano('http://localhost:5984')
    const info = await couch.info()
    expect(info.couchdb).toBe('Welcome')
    expect(info.version).toBeDefined()
    expect(info.uuid).toBeDefined()
  })
})

// ============================================================================
// DATABASE MANAGEMENT TESTS
// ============================================================================

describe('couch.db.create()', () => {
  let couch: ServerScope

  beforeEach(() => {
    couch = nano('http://localhost:5984')
  })

  it('should create a new database', async () => {
    const result = await couch.db.create('testdb')
    expect(result.ok).toBe(true)
  })

  it('should reject creating existing database', async () => {
    await couch.db.create('existing')
    await expect(couch.db.create('existing')).rejects.toThrow()
  })

  it('should reject invalid database names', async () => {
    await expect(couch.db.create('Invalid')).rejects.toThrow() // uppercase
    await expect(couch.db.create('_invalid')).rejects.toThrow() // starts with _
    await expect(couch.db.create('has spaces')).rejects.toThrow()
  })

  it('should accept partitioned database option', async () => {
    const result = await couch.db.create('partitioned', { partitioned: true })
    expect(result.ok).toBe(true)
  })
})

describe('couch.db.destroy()', () => {
  let couch: ServerScope

  beforeEach(async () => {
    couch = nano('http://localhost:5984')
    await couch.db.create('todelete')
  })

  it('should destroy existing database', async () => {
    const result = await couch.db.destroy('todelete')
    expect(result.ok).toBe(true)
  })

  it('should reject destroying non-existent database', async () => {
    await expect(couch.db.destroy('nonexistent')).rejects.toThrow()
  })
})

describe('couch.db.list()', () => {
  let couch: ServerScope

  beforeEach(async () => {
    couch = nano('http://localhost:5984')
    await couch.db.create('listtest1')
    await couch.db.create('listtest2')
  })

  afterEach(async () => {
    try { await couch.db.destroy('listtest1') } catch {}
    try { await couch.db.destroy('listtest2') } catch {}
  })

  it('should list all databases', async () => {
    const dbs = await couch.db.list()
    expect(Array.isArray(dbs)).toBe(true)
    expect(dbs).toContain('listtest1')
    expect(dbs).toContain('listtest2')
  })
})

describe('couch.db.get()', () => {
  let couch: ServerScope

  beforeEach(async () => {
    couch = nano('http://localhost:5984')
    await couch.db.create('infotest')
  })

  afterEach(async () => {
    try { await couch.db.destroy('infotest') } catch {}
  })

  it('should get database info', async () => {
    const info = await couch.db.get('infotest')
    expect(info.db_name).toBe('infotest')
    expect(typeof info.doc_count).toBe('number')
    expect(typeof info.disk_size).toBe('number')
  })

  it('should reject non-existent database', async () => {
    await expect(couch.db.get('nonexistent')).rejects.toThrow()
  })
})

describe('couch.db.compact()', () => {
  let couch: ServerScope

  beforeEach(async () => {
    couch = nano('http://localhost:5984')
    await couch.db.create('compacttest')
  })

  afterEach(async () => {
    try { await couch.db.destroy('compacttest') } catch {}
  })

  it('should compact database', async () => {
    const result = await couch.db.compact('compacttest')
    expect(result.ok).toBe(true)
  })
})

describe('couch.use()', () => {
  let couch: ServerScope

  beforeEach(async () => {
    couch = nano('http://localhost:5984')
    await couch.db.create('usetest')
  })

  afterEach(async () => {
    try { await couch.db.destroy('usetest') } catch {}
  })

  it('should return document scope', () => {
    const db = couch.use('usetest')
    expect(db).toBeDefined()
    expect(typeof db.insert).toBe('function')
    expect(typeof db.get).toBe('function')
  })

  it('should alias as scope()', () => {
    const db = couch.scope('usetest')
    expect(db).toBeDefined()
  })

  it('should alias as db.use()', () => {
    const db = couch.db.use('usetest')
    expect(db).toBeDefined()
  })
})

// ============================================================================
// DOCUMENT CRUD TESTS
// ============================================================================

describe('db.insert()', () => {
  let couch: ServerScope
  let db: DocumentScope<Document>

  beforeEach(async () => {
    couch = nano('http://localhost:5984')
    await couch.db.create('inserttest')
    db = couch.use('inserttest')
  })

  afterEach(async () => {
    try { await couch.db.destroy('inserttest') } catch {}
  })

  it('should insert document with auto-generated id', async () => {
    const result = await db.insert({ name: 'Alice', age: 30 })
    expect(result.ok).toBe(true)
    expect(result.id).toBeDefined()
    expect(result.rev).toBeDefined()
    expect(result.rev).toMatch(/^1-/)
  })

  it('should insert document with provided id', async () => {
    const result = await db.insert({ _id: 'alice', name: 'Alice', age: 30 })
    expect(result.ok).toBe(true)
    expect(result.id).toBe('alice')
    expect(result.rev).toMatch(/^1-/)
  })

  it('should reject duplicate id without rev', async () => {
    await db.insert({ _id: 'duplicate', name: 'First' })
    await expect(db.insert({ _id: 'duplicate', name: 'Second' })).rejects.toThrow()
  })

  it('should update document with correct rev', async () => {
    const first = await db.insert({ _id: 'updateme', name: 'Alice' })
    const result = await db.insert({ _id: 'updateme', _rev: first.rev, name: 'Alice Updated' })
    expect(result.ok).toBe(true)
    expect(result.rev).toMatch(/^2-/)
  })

  it('should reject update with wrong rev', async () => {
    await db.insert({ _id: 'wrongrev', name: 'Alice' })
    await expect(
      db.insert({ _id: 'wrongrev', _rev: '1-wrongrev', name: 'Alice Updated' })
    ).rejects.toThrow()
  })

  it('should accept docName as second parameter', async () => {
    const result = await db.insert({ name: 'Bob' }, 'bob-doc')
    expect(result.id).toBe('bob-doc')
  })

  it('should accept params object', async () => {
    const result = await db.insert({ name: 'Carol' }, { docName: 'carol-doc' })
    expect(result.id).toBe('carol-doc')
  })
})

describe('db.get()', () => {
  let couch: ServerScope
  let db: DocumentScope<Document>

  beforeEach(async () => {
    couch = nano('http://localhost:5984')
    await couch.db.create('gettest')
    db = couch.use('gettest')
    await db.insert({ _id: 'testdoc', name: 'Alice', age: 30 })
  })

  afterEach(async () => {
    try { await couch.db.destroy('gettest') } catch {}
  })

  it('should get document by id', async () => {
    const doc = await db.get('testdoc')
    expect(doc._id).toBe('testdoc')
    expect(doc._rev).toBeDefined()
    expect(doc.name).toBe('Alice')
    expect(doc.age).toBe(30)
  })

  it('should reject non-existent document', async () => {
    await expect(db.get('nonexistent')).rejects.toThrow()
  })

  it('should get specific revision', async () => {
    const first = await db.insert({ _id: 'versiontest', version: 1 })
    await db.insert({ _id: 'versiontest', _rev: first.rev, version: 2 })

    const doc = await db.get('versiontest', { rev: first.rev })
    expect(doc.version).toBe(1)
  })

  it('should include revision info with revs option', async () => {
    const doc = await db.get('testdoc', { revs: true })
    expect(doc._revisions).toBeDefined()
    expect(doc._revisions.start).toBe(1)
    expect(doc._revisions.ids).toBeInstanceOf(Array)
  })

  it('should include revision history with revs_info option', async () => {
    const doc = await db.get('testdoc', { revs_info: true })
    expect(doc._revs_info).toBeInstanceOf(Array)
    expect(doc._revs_info[0].rev).toBe(doc._rev)
    expect(doc._revs_info[0].status).toBe('available')
  })
})

describe('db.destroy()', () => {
  let couch: ServerScope
  let db: DocumentScope<Document>

  beforeEach(async () => {
    couch = nano('http://localhost:5984')
    await couch.db.create('destroytest')
    db = couch.use('destroytest')
  })

  afterEach(async () => {
    try { await couch.db.destroy('destroytest') } catch {}
  })

  it('should delete document with id and rev', async () => {
    const inserted = await db.insert({ _id: 'todelete', name: 'Alice' })
    const result = await db.destroy('todelete', inserted.rev)
    expect(result.ok).toBe(true)
    expect(result.rev).toMatch(/^2-/)
  })

  it('should reject delete with wrong rev', async () => {
    await db.insert({ _id: 'wrongrevdelete', name: 'Alice' })
    await expect(db.destroy('wrongrevdelete', '1-wrongrev')).rejects.toThrow()
  })

  it('should reject delete of non-existent document', async () => {
    await expect(db.destroy('nonexistent', '1-fake')).rejects.toThrow()
  })
})

describe('db.head()', () => {
  let couch: ServerScope
  let db: DocumentScope<Document>

  beforeEach(async () => {
    couch = nano('http://localhost:5984')
    await couch.db.create('headtest')
    db = couch.use('headtest')
    await db.insert({ _id: 'headdoc', name: 'Alice' })
  })

  afterEach(async () => {
    try { await couch.db.destroy('headtest') } catch {}
  })

  it('should return document revision', async () => {
    const response = await db.head('headdoc')
    expect(response.etag).toBeDefined()
    expect(response.etag).toMatch(/^1-/)
  })

  it('should reject non-existent document', async () => {
    await expect(db.head('nonexistent')).rejects.toThrow()
  })
})

// ============================================================================
// BULK OPERATIONS TESTS
// ============================================================================

describe('db.bulk()', () => {
  let couch: ServerScope
  let db: DocumentScope<Document>

  beforeEach(async () => {
    couch = nano('http://localhost:5984')
    await couch.db.create('bulktest')
    db = couch.use('bulktest')
  })

  afterEach(async () => {
    try { await couch.db.destroy('bulktest') } catch {}
  })

  it('should insert multiple documents', async () => {
    const result = await db.bulk({
      docs: [
        { name: 'Alice', age: 30 },
        { name: 'Bob', age: 25 },
        { name: 'Carol', age: 35 }
      ]
    })
    expect(result.length).toBe(3)
    expect(result.every(r => r.ok === true)).toBe(true)
    expect(result.every(r => r.rev?.startsWith('1-'))).toBe(true)
  })

  it('should handle mixed insert and update', async () => {
    const first = await db.insert({ _id: 'existing', name: 'Alice' })

    const result = await db.bulk({
      docs: [
        { _id: 'existing', _rev: first.rev, name: 'Alice Updated' },
        { _id: 'new', name: 'Bob' }
      ]
    })

    expect(result.length).toBe(2)
    expect(result[0].rev).toMatch(/^2-/)
    expect(result[1].rev).toMatch(/^1-/)
  })

  it('should handle delete in bulk', async () => {
    const inserted = await db.insert({ _id: 'todelete', name: 'Alice' })

    const result = await db.bulk({
      docs: [
        { _id: 'todelete', _rev: inserted.rev, _deleted: true }
      ]
    })

    expect(result[0].ok).toBe(true)
    await expect(db.get('todelete')).rejects.toThrow()
  })

  it('should report conflicts', async () => {
    await db.insert({ _id: 'conflict', name: 'Alice' })

    const result = await db.bulk({
      docs: [
        { _id: 'conflict', name: 'Bob' } // missing _rev
      ]
    })

    expect(result[0].error).toBe('conflict')
  })

  it('should support new_edits option', async () => {
    const result = await db.bulk({
      docs: [
        { _id: 'forced', _rev: '1-abc123abc123abc123abc123abc12345', name: 'Forced' }
      ],
      new_edits: false
    })
    expect(result.length).toBe(1)
  })
})

describe('db.bulkGet()', () => {
  let couch: ServerScope
  let db: DocumentScope<Document>

  beforeEach(async () => {
    couch = nano('http://localhost:5984')
    await couch.db.create('bulkgettest')
    db = couch.use('bulkgettest')
    await db.insert({ _id: 'doc1', name: 'Alice' })
    await db.insert({ _id: 'doc2', name: 'Bob' })
  })

  afterEach(async () => {
    try { await couch.db.destroy('bulkgettest') } catch {}
  })

  it('should get multiple documents', async () => {
    const result = await db.bulkGet({
      docs: [{ id: 'doc1' }, { id: 'doc2' }]
    })
    expect(result.results.length).toBe(2)
    expect(result.results[0].docs[0].ok._id).toBe('doc1')
    expect(result.results[1].docs[0].ok._id).toBe('doc2')
  })

  it('should report missing documents', async () => {
    const result = await db.bulkGet({
      docs: [{ id: 'doc1' }, { id: 'nonexistent' }]
    })
    expect(result.results[1].docs[0].error).toBeDefined()
  })

  it('should get specific revisions', async () => {
    const doc = await db.get('doc1')
    const result = await db.bulkGet({
      docs: [{ id: 'doc1', rev: doc._rev }]
    })
    expect(result.results[0].docs[0].ok._rev).toBe(doc._rev)
  })
})

// ============================================================================
// DOCUMENT LIST TESTS
// ============================================================================

describe('db.list()', () => {
  let couch: ServerScope
  let db: DocumentScope<Document>

  beforeEach(async () => {
    couch = nano('http://localhost:5984')
    await couch.db.create('listtest')
    db = couch.use('listtest')
    await db.bulk({
      docs: [
        { _id: 'alice', name: 'Alice' },
        { _id: 'bob', name: 'Bob' },
        { _id: 'carol', name: 'Carol' }
      ]
    })
  })

  afterEach(async () => {
    try { await couch.db.destroy('listtest') } catch {}
  })

  it('should list all documents', async () => {
    const result = await db.list()
    expect(result.total_rows).toBe(3)
    expect(result.rows.length).toBe(3)
    expect(result.rows.every(r => r.id && r.key && r.value.rev)).toBe(true)
  })

  it('should include docs with include_docs option', async () => {
    const result = await db.list({ include_docs: true })
    expect(result.rows[0].doc).toBeDefined()
    expect(result.rows[0].doc.name).toBeDefined()
  })

  it('should limit results', async () => {
    const result = await db.list({ limit: 2 })
    expect(result.rows.length).toBe(2)
  })

  it('should skip results', async () => {
    const result = await db.list({ skip: 1 })
    expect(result.rows.length).toBe(2)
    expect(result.offset).toBe(1)
  })

  it('should filter by startkey', async () => {
    const result = await db.list({ startkey: 'bob' })
    expect(result.rows.length).toBe(2)
    expect(result.rows[0].id).toBe('bob')
  })

  it('should filter by endkey', async () => {
    const result = await db.list({ endkey: 'bob' })
    expect(result.rows.length).toBe(2)
    expect(result.rows[1].id).toBe('bob')
  })

  it('should reverse order with descending', async () => {
    const result = await db.list({ descending: true })
    expect(result.rows[0].id).toBe('carol')
    expect(result.rows[2].id).toBe('alice')
  })

  it('should filter by keys', async () => {
    const result = await db.list({ keys: ['alice', 'carol'] })
    expect(result.rows.length).toBe(2)
    expect(result.rows.map(r => r.id)).toEqual(['alice', 'carol'])
  })
})

// ============================================================================
// VIEW TESTS (MapReduce)
// ============================================================================

describe('db.view()', () => {
  let couch: ServerScope
  let db: DocumentScope<Document>

  beforeEach(async () => {
    couch = nano('http://localhost:5984')
    await couch.db.create('viewtest')
    db = couch.use('viewtest')

    // Create design document with views
    await db.insert({
      _id: '_design/mydesign',
      views: {
        by_name: {
          map: 'function(doc) { if (doc.name) emit(doc.name, doc.age); }'
        },
        by_age: {
          map: 'function(doc) { if (doc.age) emit(doc.age, doc.name); }',
          reduce: '_count'
        },
        by_city: {
          map: 'function(doc) { if (doc.city) emit(doc.city, 1); }',
          reduce: '_sum'
        }
      }
    })

    // Insert test documents
    await db.bulk({
      docs: [
        { name: 'Alice', age: 30, city: 'NYC' },
        { name: 'Bob', age: 25, city: 'LA' },
        { name: 'Carol', age: 35, city: 'NYC' },
        { name: 'Diana', age: 25, city: 'Chicago' }
      ]
    })
  })

  afterEach(async () => {
    try { await couch.db.destroy('viewtest') } catch {}
  })

  it('should query view without reduce', async () => {
    const result = await db.view('mydesign', 'by_name')
    expect(result.total_rows).toBe(4)
    expect(result.rows.length).toBe(4)
  })

  it('should query view with specific key', async () => {
    const result = await db.view('mydesign', 'by_name', { key: 'Alice' })
    expect(result.rows.length).toBe(1)
    expect(result.rows[0].key).toBe('Alice')
    expect(result.rows[0].value).toBe(30)
  })

  it('should query view with key range', async () => {
    const result = await db.view('mydesign', 'by_name', {
      startkey: 'Alice',
      endkey: 'Carol'
    })
    expect(result.rows.length).toBe(3)
  })

  it('should query view with include_docs', async () => {
    const result = await db.view('mydesign', 'by_name', { include_docs: true })
    expect(result.rows[0].doc).toBeDefined()
    expect(result.rows[0].doc.name).toBeDefined()
  })

  it('should query view with reduce', async () => {
    const result = await db.view('mydesign', 'by_age', { reduce: true, group: true })
    expect(result.rows.length).toBe(3) // 25, 30, 35
    const age25 = result.rows.find(r => r.key === 25)
    expect(age25.value).toBe(2)
  })

  it('should disable reduce with reduce=false', async () => {
    const result = await db.view('mydesign', 'by_age', { reduce: false })
    expect(result.rows.length).toBe(4)
  })

  it('should support _sum reduce', async () => {
    const result = await db.view('mydesign', 'by_city', { reduce: true, group: true })
    const nyc = result.rows.find(r => r.key === 'NYC')
    expect(nyc.value).toBe(2)
  })

  it('should support descending order', async () => {
    const result = await db.view('mydesign', 'by_name', { descending: true })
    expect(result.rows[0].key).toBe('Diana')
  })

  it('should support limit and skip', async () => {
    const result = await db.view('mydesign', 'by_name', { limit: 2, skip: 1 })
    expect(result.rows.length).toBe(2)
    expect(result.rows[0].key).toBe('Bob')
  })

  it('should reject non-existent design document', async () => {
    await expect(db.view('nonexistent', 'view')).rejects.toThrow()
  })

  it('should reject non-existent view', async () => {
    await expect(db.view('mydesign', 'nonexistent')).rejects.toThrow()
  })
})

// ============================================================================
// MANGO QUERY TESTS (find)
// ============================================================================

describe('db.find()', () => {
  let couch: ServerScope
  let db: DocumentScope<Document>

  beforeEach(async () => {
    couch = nano('http://localhost:5984')
    await couch.db.create('findtest')
    db = couch.use('findtest')

    await db.bulk({
      docs: [
        { name: 'Alice', age: 30, city: 'NYC', tags: ['admin', 'user'] },
        { name: 'Bob', age: 25, city: 'LA', tags: ['user'] },
        { name: 'Carol', age: 35, city: 'NYC', tags: ['admin'] },
        { name: 'Diana', age: 28, city: 'Chicago', tags: ['user', 'moderator'] }
      ]
    })
  })

  afterEach(async () => {
    try { await couch.db.destroy('findtest') } catch {}
  })

  it('should find documents with $eq selector', async () => {
    const result = await db.find({
      selector: { name: { $eq: 'Alice' } }
    })
    expect(result.docs.length).toBe(1)
    expect(result.docs[0].name).toBe('Alice')
  })

  it('should find documents with implicit $eq', async () => {
    const result = await db.find({
      selector: { name: 'Alice' }
    })
    expect(result.docs.length).toBe(1)
  })

  it('should find documents with $gt operator', async () => {
    const result = await db.find({
      selector: { age: { $gt: 28 } }
    })
    expect(result.docs.length).toBe(2)
  })

  it('should find documents with $gte operator', async () => {
    const result = await db.find({
      selector: { age: { $gte: 28 } }
    })
    expect(result.docs.length).toBe(3)
  })

  it('should find documents with $lt operator', async () => {
    const result = await db.find({
      selector: { age: { $lt: 28 } }
    })
    expect(result.docs.length).toBe(1)
  })

  it('should find documents with $lte operator', async () => {
    const result = await db.find({
      selector: { age: { $lte: 28 } }
    })
    expect(result.docs.length).toBe(2)
  })

  it('should find documents with $ne operator', async () => {
    const result = await db.find({
      selector: { city: { $ne: 'NYC' } }
    })
    expect(result.docs.length).toBe(2)
  })

  it('should find documents with $in operator', async () => {
    const result = await db.find({
      selector: { city: { $in: ['NYC', 'LA'] } }
    })
    expect(result.docs.length).toBe(3)
  })

  it('should find documents with $nin operator', async () => {
    const result = await db.find({
      selector: { city: { $nin: ['NYC', 'LA'] } }
    })
    expect(result.docs.length).toBe(1)
    expect(result.docs[0].city).toBe('Chicago')
  })

  it('should find documents with $and operator', async () => {
    const result = await db.find({
      selector: {
        $and: [
          { city: 'NYC' },
          { age: { $gt: 30 } }
        ]
      }
    })
    expect(result.docs.length).toBe(1)
    expect(result.docs[0].name).toBe('Carol')
  })

  it('should find documents with $or operator', async () => {
    const result = await db.find({
      selector: {
        $or: [
          { name: 'Alice' },
          { name: 'Bob' }
        ]
      }
    })
    expect(result.docs.length).toBe(2)
  })

  it('should find documents with $not operator', async () => {
    const result = await db.find({
      selector: {
        age: { $not: { $gt: 30 } }
      }
    })
    expect(result.docs.length).toBe(3)
  })

  it('should find documents with $exists operator', async () => {
    await db.insert({ _id: 'noage', name: 'Eve' })
    const result = await db.find({
      selector: { age: { $exists: false } }
    })
    expect(result.docs.length).toBe(1)
    expect(result.docs[0].name).toBe('Eve')
  })

  it('should find documents with $regex operator', async () => {
    const result = await db.find({
      selector: { name: { $regex: '^A' } }
    })
    expect(result.docs.length).toBe(1)
    expect(result.docs[0].name).toBe('Alice')
  })

  it('should find documents with $elemMatch operator', async () => {
    const result = await db.find({
      selector: { tags: { $elemMatch: { $eq: 'admin' } } }
    })
    expect(result.docs.length).toBe(2)
  })

  it('should find documents with $all operator', async () => {
    const result = await db.find({
      selector: { tags: { $all: ['admin', 'user'] } }
    })
    expect(result.docs.length).toBe(1)
    expect(result.docs[0].name).toBe('Alice')
  })

  it('should find documents with $size operator', async () => {
    const result = await db.find({
      selector: { tags: { $size: 2 } }
    })
    expect(result.docs.length).toBe(2)
  })

  it('should limit results with limit option', async () => {
    const result = await db.find({
      selector: {},
      limit: 2
    })
    expect(result.docs.length).toBe(2)
  })

  it('should skip results with skip option', async () => {
    const result = await db.find({
      selector: {},
      skip: 2
    })
    expect(result.docs.length).toBe(2)
  })

  it('should sort results', async () => {
    const result = await db.find({
      selector: {},
      sort: [{ age: 'asc' }]
    })
    expect(result.docs[0].age).toBe(25)
    expect(result.docs[3].age).toBe(35)
  })

  it('should project fields', async () => {
    const result = await db.find({
      selector: { name: 'Alice' },
      fields: ['name', 'age']
    })
    expect(result.docs[0].name).toBe('Alice')
    expect(result.docs[0].age).toBe(30)
    expect(result.docs[0].city).toBeUndefined()
  })

  it('should include bookmark for pagination', async () => {
    const result = await db.find({
      selector: {},
      limit: 2
    })
    expect(result.bookmark).toBeDefined()
  })
})

describe('db.createIndex()', () => {
  let couch: ServerScope
  let db: DocumentScope<Document>

  beforeEach(async () => {
    couch = nano('http://localhost:5984')
    await couch.db.create('indextest')
    db = couch.use('indextest')
  })

  afterEach(async () => {
    try { await couch.db.destroy('indextest') } catch {}
  })

  it('should create single field index', async () => {
    const result = await db.createIndex({
      index: { fields: ['name'] },
      name: 'name-index'
    })
    expect(result.result).toBe('created')
    expect(result.name).toBe('name-index')
  })

  it('should create compound index', async () => {
    const result = await db.createIndex({
      index: { fields: ['city', 'age'] },
      name: 'city-age-index'
    })
    expect(result.result).toBe('created')
  })

  it('should return exists for duplicate index', async () => {
    await db.createIndex({
      index: { fields: ['name'] },
      name: 'name-index'
    })
    const result = await db.createIndex({
      index: { fields: ['name'] },
      name: 'name-index-2'
    })
    expect(result.result).toBe('exists')
  })

  it('should support partial filter selector', async () => {
    const result = await db.createIndex({
      index: { fields: ['age'] },
      name: 'adult-age-index',
      partial_filter_selector: { age: { $gte: 18 } }
    })
    expect(result.result).toBe('created')
  })
})

describe('db.listIndexes()', () => {
  let couch: ServerScope
  let db: DocumentScope<Document>

  beforeEach(async () => {
    couch = nano('http://localhost:5984')
    await couch.db.create('listindextest')
    db = couch.use('listindextest')
    await db.createIndex({
      index: { fields: ['name'] },
      name: 'name-index'
    })
  })

  afterEach(async () => {
    try { await couch.db.destroy('listindextest') } catch {}
  })

  it('should list all indexes', async () => {
    const result = await db.listIndexes()
    expect(result.total_rows).toBeGreaterThanOrEqual(2) // _all_docs + name-index
    expect(result.indexes.some(i => i.name === 'name-index')).toBe(true)
  })
})

describe('db.deleteIndex()', () => {
  let couch: ServerScope
  let db: DocumentScope<Document>

  beforeEach(async () => {
    couch = nano('http://localhost:5984')
    await couch.db.create('delindextest')
    db = couch.use('delindextest')
    await db.createIndex({
      index: { fields: ['name'] },
      name: 'name-index',
      ddoc: 'my-ddoc'
    })
  })

  afterEach(async () => {
    try { await couch.db.destroy('delindextest') } catch {}
  })

  it('should delete index', async () => {
    const result = await db.deleteIndex('my-ddoc', 'name-index')
    expect(result.ok).toBe(true)
  })
})

// ============================================================================
// ATTACHMENT TESTS
// ============================================================================

describe('db.attachment', () => {
  let couch: ServerScope
  let db: DocumentScope<Document>

  beforeEach(async () => {
    couch = nano('http://localhost:5984')
    await couch.db.create('attachmenttest')
    db = couch.use('attachmenttest')
    await db.insert({ _id: 'withdoc', name: 'Test Doc' })
  })

  afterEach(async () => {
    try { await couch.db.destroy('attachmenttest') } catch {}
  })

  describe('insert()', () => {
    it('should insert text attachment', async () => {
      const doc = await db.get('withdoc')
      const result = await db.attachment.insert(
        'withdoc',
        'test.txt',
        'Hello, World!',
        'text/plain',
        { rev: doc._rev }
      )
      expect(result.ok).toBe(true)
      expect(result.rev).toMatch(/^2-/)
    })

    it('should insert binary attachment', async () => {
      const doc = await db.get('withdoc')
      const buffer = new Uint8Array([72, 101, 108, 108, 111]).buffer // "Hello"
      const result = await db.attachment.insert(
        'withdoc',
        'binary.bin',
        buffer,
        'application/octet-stream',
        { rev: doc._rev }
      )
      expect(result.ok).toBe(true)
    })

    it('should insert attachment to new document', async () => {
      const result = await db.attachment.insert(
        'newdoc',
        'test.txt',
        'Hello',
        'text/plain'
      )
      expect(result.ok).toBe(true)
      expect(result.id).toBe('newdoc')
    })
  })

  describe('get()', () => {
    beforeEach(async () => {
      const doc = await db.get('withdoc')
      await db.attachment.insert(
        'withdoc',
        'test.txt',
        'Hello, World!',
        'text/plain',
        { rev: doc._rev }
      )
    })

    it('should get attachment data', async () => {
      const data = await db.attachment.get('withdoc', 'test.txt')
      expect(data).toBeDefined()
    })

    it('should get attachment as buffer', async () => {
      const data = await db.attachment.get('withdoc', 'test.txt')
      expect(data instanceof ArrayBuffer || typeof data === 'string').toBe(true)
    })

    it('should reject non-existent attachment', async () => {
      await expect(db.attachment.get('withdoc', 'nonexistent.txt')).rejects.toThrow()
    })
  })

  describe('destroy()', () => {
    beforeEach(async () => {
      const doc = await db.get('withdoc')
      await db.attachment.insert(
        'withdoc',
        'test.txt',
        'Hello, World!',
        'text/plain',
        { rev: doc._rev }
      )
    })

    it('should delete attachment', async () => {
      const doc = await db.get('withdoc')
      const result = await db.attachment.destroy('withdoc', 'test.txt', { rev: doc._rev })
      expect(result.ok).toBe(true)
    })
  })

  describe('getAsStream()', () => {
    beforeEach(async () => {
      const doc = await db.get('withdoc')
      await db.attachment.insert(
        'withdoc',
        'test.txt',
        'Hello, World!',
        'text/plain',
        { rev: doc._rev }
      )
    })

    it('should return readable stream', async () => {
      const stream = await db.attachment.getAsStream('withdoc', 'test.txt')
      expect(stream).toBeDefined()
    })
  })
})

// ============================================================================
// CHANGES FEED TESTS
// ============================================================================

describe('db.changes()', () => {
  let couch: ServerScope
  let db: DocumentScope<Document>

  beforeEach(async () => {
    couch = nano('http://localhost:5984')
    await couch.db.create('changestest')
    db = couch.use('changestest')
    await db.bulk({
      docs: [
        { _id: 'doc1', name: 'Alice' },
        { _id: 'doc2', name: 'Bob' },
        { _id: 'doc3', name: 'Carol' }
      ]
    })
  })

  afterEach(async () => {
    try { await couch.db.destroy('changestest') } catch {}
  })

  it('should return changes since beginning', async () => {
    const result = await db.changes()
    expect(result.results.length).toBe(3)
    expect(result.last_seq).toBeDefined()
  })

  it('should return changes with include_docs', async () => {
    const result = await db.changes({ include_docs: true })
    expect(result.results[0].doc).toBeDefined()
    expect(result.results[0].doc.name).toBeDefined()
  })

  it('should return changes since specific seq', async () => {
    const initial = await db.changes()
    await db.insert({ _id: 'doc4', name: 'Diana' })

    const result = await db.changes({ since: initial.last_seq })
    expect(result.results.length).toBe(1)
    expect(result.results[0].id).toBe('doc4')
  })

  it('should limit results', async () => {
    const result = await db.changes({ limit: 2 })
    expect(result.results.length).toBe(2)
  })

  it('should filter by doc_ids', async () => {
    const result = await db.changes({ doc_ids: ['doc1', 'doc3'] })
    expect(result.results.length).toBe(2)
    expect(result.results.map(r => r.id)).toContain('doc1')
    expect(result.results.map(r => r.id)).toContain('doc3')
  })

  it('should return descending changes', async () => {
    const result = await db.changes({ descending: true })
    expect(result.results[0].id).toBe('doc3')
  })

  it('should include deleted documents', async () => {
    const doc = await db.get('doc1')
    await db.destroy('doc1', doc._rev)

    const result = await db.changes()
    const deleted = result.results.find(r => r.id === 'doc1')
    expect(deleted.deleted).toBe(true)
  })
})

describe('db.changesReader', () => {
  let couch: ServerScope
  let db: DocumentScope<Document>

  beforeEach(async () => {
    couch = nano('http://localhost:5984')
    await couch.db.create('changesreadertest')
    db = couch.use('changesreadertest')
  })

  afterEach(async () => {
    try { await couch.db.destroy('changesreadertest') } catch {}
  })

  it('should create changes reader', () => {
    const reader = db.changesReader
    expect(reader).toBeDefined()
    expect(typeof reader.start).toBe('function')
    expect(typeof reader.stop).toBe('function')
  })
})

// ============================================================================
// REPLICATION TESTS
// ============================================================================

describe('couch.db.replicate', () => {
  let couch: ServerScope

  beforeEach(async () => {
    couch = nano('http://localhost:5984')
    await couch.db.create('replicatesrc')
    await couch.db.create('replicatetgt')

    const src = couch.use('replicatesrc')
    await src.bulk({
      docs: [
        { _id: 'doc1', name: 'Alice' },
        { _id: 'doc2', name: 'Bob' }
      ]
    })
  })

  afterEach(async () => {
    try { await couch.db.destroy('replicatesrc') } catch {}
    try { await couch.db.destroy('replicatetgt') } catch {}
  })

  it('should replicate database', async () => {
    const result = await couch.db.replicate('replicatesrc', 'replicatetgt')
    expect(result.ok).toBe(true)
    expect(result.docs_read).toBe(2)
    expect(result.docs_written).toBe(2)
  })

  it('should accept options', async () => {
    const result = await couch.db.replicate('replicatesrc', 'replicatetgt', {
      create_target: false
    })
    expect(result.ok).toBe(true)
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('CouchDB Errors', () => {
  it('should create CouchError', () => {
    const error = new CouchError('not_found', 'Document not found')
    expect(error.error).toBe('not_found')
    expect(error.reason).toBe('Document not found')
    expect(error.statusCode).toBe(404)
  })

  it('should set correct status codes', () => {
    expect(new CouchError('conflict').statusCode).toBe(409)
    expect(new CouchError('bad_request').statusCode).toBe(400)
    expect(new CouchError('unauthorized').statusCode).toBe(401)
    expect(new CouchError('forbidden').statusCode).toBe(403)
    expect(new CouchError('file_exists').statusCode).toBe(412)
  })
})

// ============================================================================
// DESIGN DOCUMENT TESTS
// ============================================================================

describe('Design Documents', () => {
  let couch: ServerScope
  let db: DocumentScope<Document>

  beforeEach(async () => {
    couch = nano('http://localhost:5984')
    await couch.db.create('designtest')
    db = couch.use('designtest')
  })

  afterEach(async () => {
    try { await couch.db.destroy('designtest') } catch {}
  })

  it('should insert design document', async () => {
    const result = await db.insert({
      _id: '_design/test',
      views: {
        by_name: {
          map: 'function(doc) { emit(doc.name, null); }'
        }
      }
    })
    expect(result.ok).toBe(true)
    expect(result.id).toBe('_design/test')
  })

  it('should get design document', async () => {
    await db.insert({
      _id: '_design/test',
      views: {
        by_name: {
          map: 'function(doc) { emit(doc.name, null); }'
        }
      }
    })

    const doc = await db.get('_design/test')
    expect(doc._id).toBe('_design/test')
    expect(doc.views).toBeDefined()
  })

  it('should update design document', async () => {
    const inserted = await db.insert({
      _id: '_design/test',
      views: {
        by_name: {
          map: 'function(doc) { emit(doc.name, null); }'
        }
      }
    })

    const result = await db.insert({
      _id: '_design/test',
      _rev: inserted.rev,
      views: {
        by_name: {
          map: 'function(doc) { emit(doc.name, 1); }'
        },
        by_age: {
          map: 'function(doc) { emit(doc.age, null); }'
        }
      }
    })
    expect(result.ok).toBe(true)
    expect(result.rev).toMatch(/^2-/)
  })
})

// ============================================================================
// PARTITIONED DATABASE TESTS
// ============================================================================

describe('Partitioned Databases', () => {
  let couch: ServerScope
  let db: DocumentScope<Document>

  beforeEach(async () => {
    couch = nano('http://localhost:5984')
    await couch.db.create('partitionedtest', { partitioned: true })
    db = couch.use('partitionedtest')
  })

  afterEach(async () => {
    try { await couch.db.destroy('partitionedtest') } catch {}
  })

  it('should insert document with partition key', async () => {
    const result = await db.insert({ _id: 'partition1:doc1', name: 'Alice' })
    expect(result.ok).toBe(true)
  })

  it('should query partition', async () => {
    await db.bulk({
      docs: [
        { _id: 'users:alice', name: 'Alice' },
        { _id: 'users:bob', name: 'Bob' },
        { _id: 'orders:order1', item: 'Widget' }
      ]
    })

    const result = await db.partitionedList('users')
    expect(result.rows.length).toBe(2)
  })

  it('should find within partition', async () => {
    await db.bulk({
      docs: [
        { _id: 'users:alice', name: 'Alice', age: 30 },
        { _id: 'users:bob', name: 'Bob', age: 25 },
        { _id: 'orders:order1', item: 'Widget' }
      ]
    })

    const result = await db.partitionedFind('users', {
      selector: { age: { $gt: 20 } }
    })
    expect(result.docs.length).toBe(2)
  })
})

// ============================================================================
// SERVER REQUEST TESTS
// ============================================================================

describe('couch.request()', () => {
  let couch: ServerScope

  beforeEach(() => {
    couch = nano('http://localhost:5984')
  })

  it('should make raw request', async () => {
    const result = await couch.request({ path: '/' })
    expect(result.couchdb).toBe('Welcome')
  })

  it('should support custom method', async () => {
    const result = await couch.request({
      path: '/',
      method: 'GET'
    })
    expect(result.couchdb).toBe('Welcome')
  })
})

describe('couch.uuids()', () => {
  let couch: ServerScope

  beforeEach(() => {
    couch = nano('http://localhost:5984')
  })

  it('should generate UUIDs', async () => {
    const result = await couch.uuids(5)
    expect(result.uuids.length).toBe(5)
    expect(result.uuids.every(u => typeof u === 'string')).toBe(true)
  })
})

// ============================================================================
// MULTIPART RELATED TESTS
// ============================================================================

describe('db.multipart', () => {
  let couch: ServerScope
  let db: DocumentScope<Document>

  beforeEach(async () => {
    couch = nano('http://localhost:5984')
    await couch.db.create('multiparttest')
    db = couch.use('multiparttest')
  })

  afterEach(async () => {
    try { await couch.db.destroy('multiparttest') } catch {}
  })

  it('should insert document with attachments', async () => {
    const result = await db.multipart.insert(
      { _id: 'withatts', name: 'Test' },
      [
        {
          name: 'file1.txt',
          data: 'Hello',
          content_type: 'text/plain'
        },
        {
          name: 'file2.txt',
          data: 'World',
          content_type: 'text/plain'
        }
      ]
    )
    expect(result.ok).toBe(true)
  })

  it('should get document with attachments', async () => {
    await db.multipart.insert(
      { _id: 'getwithatts', name: 'Test' },
      [
        {
          name: 'file.txt',
          data: 'Hello',
          content_type: 'text/plain'
        }
      ]
    )

    const result = await db.multipart.get('getwithatts')
    expect(result.doc).toBeDefined()
    expect(result.attachments).toBeDefined()
  })
})

// ============================================================================
// UPDATE HANDLER TESTS
// ============================================================================

describe('db.updateWithHandler()', () => {
  let couch: ServerScope
  let db: DocumentScope<Document>

  beforeEach(async () => {
    couch = nano('http://localhost:5984')
    await couch.db.create('updatehandlertest')
    db = couch.use('updatehandlertest')

    await db.insert({
      _id: '_design/updates',
      updates: {
        timestamp: `function(doc, req) {
          if (!doc) {
            if ('id' in req && req.id) {
              return [{ _id: req.id, timestamp: new Date().toISOString() }, 'Created'];
            }
            return [null, 'Error'];
          }
          doc.timestamp = new Date().toISOString();
          return [doc, 'Updated'];
        }`
      }
    })

    await db.insert({ _id: 'testdoc', name: 'Test' })
  })

  afterEach(async () => {
    try { await couch.db.destroy('updatehandlertest') } catch {}
  })

  it('should update document with handler', async () => {
    const result = await db.updateWithHandler('updates', 'timestamp', 'testdoc')
    expect(result).toBeDefined()
  })
})

// ============================================================================
// SHOW FUNCTION TESTS
// ============================================================================

describe('db.show()', () => {
  let couch: ServerScope
  let db: DocumentScope<Document>

  beforeEach(async () => {
    couch = nano('http://localhost:5984')
    await couch.db.create('showtest')
    db = couch.use('showtest')

    await db.insert({
      _id: '_design/shows',
      shows: {
        format: `function(doc, req) {
          return { body: JSON.stringify({ formatted: doc.name.toUpperCase() }) };
        }`
      }
    })

    await db.insert({ _id: 'testdoc', name: 'alice' })
  })

  afterEach(async () => {
    try { await couch.db.destroy('showtest') } catch {}
  })

  it('should execute show function', async () => {
    const result = await db.show('shows', 'format', 'testdoc')
    expect(result).toBeDefined()
  })
})

// ============================================================================
// SEARCH TESTS
// ============================================================================

describe('db.search()', () => {
  let couch: ServerScope
  let db: DocumentScope<Document>

  beforeEach(async () => {
    couch = nano('http://localhost:5984')
    await couch.db.create('searchtest')
    db = couch.use('searchtest')

    await db.insert({
      _id: '_design/search',
      indexes: {
        people: {
          analyzer: 'standard',
          index: `function(doc) {
            if (doc.name) {
              index('name', doc.name);
            }
          }`
        }
      }
    })

    await db.bulk({
      docs: [
        { name: 'Alice Smith' },
        { name: 'Bob Johnson' },
        { name: 'Alice Johnson' }
      ]
    })
  })

  afterEach(async () => {
    try { await couch.db.destroy('searchtest') } catch {}
  })

  it('should search documents', async () => {
    const result = await db.search('search', 'people', { q: 'name:Alice' })
    expect(result.total_rows).toBe(2)
  })
})

// ============================================================================
// INFO TESTS
// ============================================================================

describe('db.info()', () => {
  let couch: ServerScope
  let db: DocumentScope<Document>

  beforeEach(async () => {
    couch = nano('http://localhost:5984')
    await couch.db.create('dbinfotest')
    db = couch.use('dbinfotest')
    await db.bulk({
      docs: [
        { name: 'Alice' },
        { name: 'Bob' }
      ]
    })
  })

  afterEach(async () => {
    try { await couch.db.destroy('dbinfotest') } catch {}
  })

  it('should return database info', async () => {
    const info = await db.info()
    expect(info.db_name).toBe('dbinfotest')
    expect(info.doc_count).toBe(2)
  })
})

// ============================================================================
// COPY TESTS
// ============================================================================

describe('db.copy()', () => {
  let couch: ServerScope
  let db: DocumentScope<Document>

  beforeEach(async () => {
    couch = nano('http://localhost:5984')
    await couch.db.create('copytest')
    db = couch.use('copytest')
    await db.insert({ _id: 'source', name: 'Original' })
  })

  afterEach(async () => {
    try { await couch.db.destroy('copytest') } catch {}
  })

  it('should copy document to new id', async () => {
    const result = await db.copy('source', 'destination')
    expect(result.ok).toBe(true)
    expect(result.id).toBe('destination')

    const copied = await db.get('destination')
    expect(copied.name).toBe('Original')
  })

  it('should copy over existing document with rev', async () => {
    const existing = await db.insert({ _id: 'existing', name: 'Existing' })
    const result = await db.copy('source', 'existing', { overwrite: existing.rev })
    expect(result.ok).toBe(true)

    const copied = await db.get('existing')
    expect(copied.name).toBe('Original')
  })
})

// ============================================================================
// FETCH TESTS
// ============================================================================

describe('db.fetch()', () => {
  let couch: ServerScope
  let db: DocumentScope<Document>

  beforeEach(async () => {
    couch = nano('http://localhost:5984')
    await couch.db.create('fetchtest')
    db = couch.use('fetchtest')
    await db.bulk({
      docs: [
        { _id: 'doc1', name: 'Alice' },
        { _id: 'doc2', name: 'Bob' },
        { _id: 'doc3', name: 'Carol' }
      ]
    })
  })

  afterEach(async () => {
    try { await couch.db.destroy('fetchtest') } catch {}
  })

  it('should fetch multiple documents by key', async () => {
    const result = await db.fetch({ keys: ['doc1', 'doc3'] })
    expect(result.rows.length).toBe(2)
    expect(result.rows[0].doc.name).toBe('Alice')
    expect(result.rows[1].doc.name).toBe('Carol')
  })
})

// ============================================================================
// REVISIONS TESTS
// ============================================================================

describe('db.revsDiff()', () => {
  let couch: ServerScope
  let db: DocumentScope<Document>

  beforeEach(async () => {
    couch = nano('http://localhost:5984')
    await couch.db.create('revsdifftest')
    db = couch.use('revsdifftest')
    await db.insert({ _id: 'testdoc', name: 'Test' })
  })

  afterEach(async () => {
    try { await couch.db.destroy('revsdifftest') } catch {}
  })

  it('should return missing revisions', async () => {
    const result = await db.revsDiff({
      testdoc: ['1-nonexistent', '2-alsonotreal']
    })
    expect(result.testdoc.missing).toContain('1-nonexistent')
    expect(result.testdoc.missing).toContain('2-alsonotreal')
  })
})

// ============================================================================
// SECURITY TESTS
// ============================================================================

describe('db.security', () => {
  let couch: ServerScope
  let db: DocumentScope<Document>

  beforeEach(async () => {
    couch = nano('http://localhost:5984')
    await couch.db.create('securitytest')
    db = couch.use('securitytest')
  })

  afterEach(async () => {
    try { await couch.db.destroy('securitytest') } catch {}
  })

  it('should get security object', async () => {
    const security = await db.security()
    expect(security).toBeDefined()
    expect(typeof security).toBe('object')
  })

  it('should set security object', async () => {
    const result = await db.security({
      admins: { names: ['admin'], roles: ['admins'] },
      members: { names: [], roles: ['users'] }
    })
    expect(result.ok).toBe(true)
  })
})
