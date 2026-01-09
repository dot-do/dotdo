/**
 * @dotdo/elasticsearch - Elasticsearch SDK compat tests
 *
 * Tests for Elasticsearch API compatibility backed by DO SQLite FTS5:
 * - Client creation and configuration
 * - Document indexing (index, create, update)
 * - Document retrieval (get, mget)
 * - Search queries (match, term, bool, range, multi_match)
 * - Bulk operations
 * - Index management (create, delete, exists, mappings)
 * - Aggregations (terms, avg, sum, min, max)
 * - Scroll/pagination
 *
 * @see https://www.elastic.co/guide/en/elasticsearch/client/javascript-api/current/api-reference.html
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Client, clearAllIndices } from './elasticsearch'
import type { Client as ClientType, SearchResponse } from './types'
import { DocumentNotFoundError, IndexNotFoundError, IndexAlreadyExistsError } from './types'

// ============================================================================
// CLIENT TESTS
// ============================================================================

describe('Client creation', () => {
  beforeEach(() => {
    clearAllIndices()
  })

  it('should create a client with node option', () => {
    const client = new Client({ node: 'http://localhost:9200' })
    expect(client).toBeDefined()
  })

  it('should create a client with multiple nodes', () => {
    const client = new Client({ nodes: ['http://localhost:9200', 'http://localhost:9201'] })
    expect(client).toBeDefined()
  })

  it('should create a client with auth options', () => {
    const client = new Client({
      node: 'http://localhost:9200',
      auth: { username: 'elastic', password: 'changeme' },
    })
    expect(client).toBeDefined()
  })

  it('should create a client with API key auth', () => {
    const client = new Client({
      node: 'http://localhost:9200',
      auth: { apiKey: 'my-api-key' },
    })
    expect(client).toBeDefined()
  })

  it('should return info about the cluster', async () => {
    const client = new Client({ node: 'http://localhost:9200' })
    const info = await client.info()

    expect(info.name).toBeDefined()
    expect(info.cluster_name).toBeDefined()
    expect(info.version).toBeDefined()
    expect(info.version.number).toBeDefined()
    expect(info.tagline).toBe('You Know, for Search')
  })

  it('should close the client', async () => {
    const client = new Client({ node: 'http://localhost:9200' })
    await expect(client.close()).resolves.not.toThrow()
  })
})

// ============================================================================
// INDEX DOCUMENT TESTS
// ============================================================================

describe('client.index()', () => {
  let client: ClientType

  beforeEach(() => {
    clearAllIndices()
    client = new Client({ node: 'http://localhost:9200' })
  })

  it('should index a document with ID', async () => {
    const response = await client.index({
      index: 'my-index',
      id: '1',
      document: { title: 'Hello', content: 'World' },
    })

    expect(response._index).toBe('my-index')
    expect(response._id).toBe('1')
    expect(response._version).toBe(1)
    expect(response.result).toBe('created')
    expect(response._shards.successful).toBeGreaterThan(0)
  })

  it('should auto-generate ID if not provided', async () => {
    const response = await client.index({
      index: 'my-index',
      document: { title: 'Hello', content: 'World' },
    })

    expect(response._index).toBe('my-index')
    expect(response._id).toBeDefined()
    expect(response._id.length).toBeGreaterThan(0)
    expect(response.result).toBe('created')
  })

  it('should update existing document with same ID', async () => {
    await client.index({
      index: 'my-index',
      id: '1',
      document: { title: 'Hello', content: 'World' },
    })

    const response = await client.index({
      index: 'my-index',
      id: '1',
      document: { title: 'Updated', content: 'Content' },
    })

    expect(response.result).toBe('updated')
    expect(response._version).toBe(2)
  })

  it('should support body parameter for legacy compatibility', async () => {
    const response = await client.index({
      index: 'my-index',
      id: '1',
      body: { title: 'Hello', content: 'World' },
    })

    expect(response._index).toBe('my-index')
    expect(response._id).toBe('1')
    expect(response.result).toBe('created')
  })

  it('should create index automatically if it does not exist', async () => {
    await client.index({
      index: 'new-index',
      id: '1',
      document: { title: 'Hello' },
    })

    const exists = await client.indices.exists({ index: 'new-index' })
    expect(exists).toBe(true)
  })
})

// ============================================================================
// GET DOCUMENT TESTS
// ============================================================================

describe('client.get()', () => {
  let client: ClientType

  beforeEach(async () => {
    clearAllIndices()
    client = new Client({ node: 'http://localhost:9200' })
    await client.index({
      index: 'my-index',
      id: '1',
      document: { title: 'Hello', content: 'World', tags: ['greeting', 'test'] },
    })
  })

  it('should get a document by ID', async () => {
    const response = await client.get({
      index: 'my-index',
      id: '1',
    })

    expect(response._index).toBe('my-index')
    expect(response._id).toBe('1')
    expect(response.found).toBe(true)
    expect(response._source).toEqual({ title: 'Hello', content: 'World', tags: ['greeting', 'test'] })
  })

  it('should throw DocumentNotFoundError for missing document', async () => {
    await expect(
      client.get({ index: 'my-index', id: 'non-existent' })
    ).rejects.toThrow(DocumentNotFoundError)
  })

  it('should filter source fields with _source option', async () => {
    const response = await client.get({
      index: 'my-index',
      id: '1',
      _source: ['title'],
    })

    expect(response._source).toEqual({ title: 'Hello' })
  })

  it('should exclude source with _source: false', async () => {
    const response = await client.get({
      index: 'my-index',
      id: '1',
      _source: false,
    })

    expect(response._source).toBeUndefined()
    expect(response.found).toBe(true)
  })

  it('should include source fields with _source_includes', async () => {
    const response = await client.get({
      index: 'my-index',
      id: '1',
      _source_includes: ['title', 'content'],
    })

    expect(response._source).toEqual({ title: 'Hello', content: 'World' })
  })

  it('should exclude source fields with _source_excludes', async () => {
    const response = await client.get({
      index: 'my-index',
      id: '1',
      _source_excludes: ['tags'],
    })

    expect(response._source).toEqual({ title: 'Hello', content: 'World' })
  })
})

// ============================================================================
// MGET TESTS
// ============================================================================

describe('client.mget()', () => {
  let client: ClientType

  beforeEach(async () => {
    clearAllIndices()
    client = new Client({ node: 'http://localhost:9200' })
    await client.bulk({
      operations: [
        { index: { _index: 'my-index', _id: '1' } },
        { title: 'First', content: 'Document' },
        { index: { _index: 'my-index', _id: '2' } },
        { title: 'Second', content: 'Document' },
        { index: { _index: 'other-index', _id: '1' } },
        { title: 'Other', content: 'Index' },
      ],
    })
  })

  it('should get multiple documents with docs array', async () => {
    const response = await client.mget({
      docs: [
        { _index: 'my-index', _id: '1' },
        { _index: 'my-index', _id: '2' },
      ],
    })

    expect(response.docs).toHaveLength(2)
    expect(response.docs[0].found).toBe(true)
    expect(response.docs[0]._source).toEqual({ title: 'First', content: 'Document' })
    expect(response.docs[1].found).toBe(true)
    expect(response.docs[1]._source).toEqual({ title: 'Second', content: 'Document' })
  })

  it('should get documents with ids array and index', async () => {
    const response = await client.mget({
      index: 'my-index',
      ids: ['1', '2'],
    })

    expect(response.docs).toHaveLength(2)
    expect(response.docs[0].found).toBe(true)
    expect(response.docs[1].found).toBe(true)
  })

  it('should return found: false for missing documents', async () => {
    const response = await client.mget({
      index: 'my-index',
      ids: ['1', 'missing'],
    })

    expect(response.docs).toHaveLength(2)
    expect(response.docs[0].found).toBe(true)
    expect(response.docs[1].found).toBe(false)
  })

  it('should get documents from multiple indices', async () => {
    const response = await client.mget({
      docs: [
        { _index: 'my-index', _id: '1' },
        { _index: 'other-index', _id: '1' },
      ],
    })

    expect(response.docs).toHaveLength(2)
    expect(response.docs[0]._source).toEqual({ title: 'First', content: 'Document' })
    expect(response.docs[1]._source).toEqual({ title: 'Other', content: 'Index' })
  })
})

// ============================================================================
// DELETE DOCUMENT TESTS
// ============================================================================

describe('client.delete()', () => {
  let client: ClientType

  beforeEach(async () => {
    clearAllIndices()
    client = new Client({ node: 'http://localhost:9200' })
    await client.index({
      index: 'my-index',
      id: '1',
      document: { title: 'Hello', content: 'World' },
    })
  })

  it('should delete a document', async () => {
    const response = await client.delete({
      index: 'my-index',
      id: '1',
    })

    expect(response._index).toBe('my-index')
    expect(response._id).toBe('1')
    expect(response.result).toBe('deleted')

    await expect(
      client.get({ index: 'my-index', id: '1' })
    ).rejects.toThrow(DocumentNotFoundError)
  })

  it('should return not_found for missing document', async () => {
    const response = await client.delete({
      index: 'my-index',
      id: 'non-existent',
    })

    expect(response.result).toBe('not_found')
  })
})

// ============================================================================
// UPDATE DOCUMENT TESTS
// ============================================================================

describe('client.update()', () => {
  let client: ClientType

  beforeEach(async () => {
    clearAllIndices()
    client = new Client({ node: 'http://localhost:9200' })
    await client.index({
      index: 'my-index',
      id: '1',
      document: { title: 'Hello', content: 'World', count: 0 },
    })
  })

  it('should update a document with doc', async () => {
    const response = await client.update({
      index: 'my-index',
      id: '1',
      doc: { title: 'Updated' },
    })

    expect(response._index).toBe('my-index')
    expect(response._id).toBe('1')
    expect(response.result).toBe('updated')

    const doc = await client.get({ index: 'my-index', id: '1' })
    expect(doc._source).toEqual({ title: 'Updated', content: 'World', count: 0 })
  })

  it('should update with body.doc for legacy compatibility', async () => {
    const response = await client.update({
      index: 'my-index',
      id: '1',
      body: { doc: { content: 'New content' } },
    })

    expect(response.result).toBe('updated')

    const doc = await client.get({ index: 'my-index', id: '1' })
    expect(doc._source?.content).toBe('New content')
  })

  it('should create document with doc_as_upsert', async () => {
    const response = await client.update({
      index: 'my-index',
      id: 'new-id',
      doc: { title: 'New', content: 'Document' },
      doc_as_upsert: true,
    })

    expect(response.result).toBe('created')

    const doc = await client.get({ index: 'my-index', id: 'new-id' })
    expect(doc._source).toEqual({ title: 'New', content: 'Document' })
  })

  it('should throw DocumentNotFoundError for missing document without upsert', async () => {
    await expect(
      client.update({
        index: 'my-index',
        id: 'non-existent',
        doc: { title: 'Updated' },
      })
    ).rejects.toThrow(DocumentNotFoundError)
  })

  it('should return noop if document unchanged', async () => {
    const response = await client.update({
      index: 'my-index',
      id: '1',
      doc: { title: 'Hello' }, // Same as existing
    })

    expect(response.result).toBe('noop')
  })

  it('should support upsert option', async () => {
    const response = await client.update({
      index: 'my-index',
      id: 'new-id',
      doc: { title: 'Updated' },
      upsert: { title: 'Default', content: 'Default content' },
    })

    expect(response.result).toBe('created')

    const doc = await client.get({ index: 'my-index', id: 'new-id' })
    expect(doc._source).toEqual({ title: 'Default', content: 'Default content' })
  })
})

// ============================================================================
// DELETE BY QUERY TESTS
// ============================================================================

describe('client.deleteByQuery()', () => {
  let client: ClientType

  beforeEach(async () => {
    clearAllIndices()
    client = new Client({ node: 'http://localhost:9200' })
    await client.bulk({
      operations: [
        { index: { _index: 'my-index', _id: '1' } },
        { title: 'Hello', category: 'greeting' },
        { index: { _index: 'my-index', _id: '2' } },
        { title: 'World', category: 'greeting' },
        { index: { _index: 'my-index', _id: '3' } },
        { title: 'Foo', category: 'other' },
      ],
    })
  })

  it('should delete documents matching query', async () => {
    const response = await client.deleteByQuery({
      index: 'my-index',
      query: { term: { category: 'greeting' } },
    })

    expect(response.deleted).toBe(2)
    expect(response.total).toBe(2)

    const search = await client.search({ index: 'my-index' })
    expect(search.hits.total.value).toBe(1)
  })

  it('should delete all documents with match_all', async () => {
    const response = await client.deleteByQuery({
      index: 'my-index',
      query: { match_all: {} },
    })

    expect(response.deleted).toBe(3)
  })
})

// ============================================================================
// BULK OPERATIONS TESTS
// ============================================================================

describe('client.bulk()', () => {
  let client: ClientType

  beforeEach(() => {
    clearAllIndices()
    client = new Client({ node: 'http://localhost:9200' })
  })

  it('should index multiple documents', async () => {
    const response = await client.bulk({
      operations: [
        { index: { _index: 'my-index', _id: '1' } },
        { title: 'Hello' },
        { index: { _index: 'my-index', _id: '2' } },
        { title: 'World' },
      ],
    })

    expect(response.errors).toBe(false)
    expect(response.items).toHaveLength(2)
    expect(response.items[0].index?.result).toBe('created')
    expect(response.items[1].index?.result).toBe('created')
  })

  it('should support create action', async () => {
    const response = await client.bulk({
      operations: [
        { create: { _index: 'my-index', _id: '1' } },
        { title: 'Hello' },
      ],
    })

    expect(response.errors).toBe(false)
    expect(response.items[0].create?.result).toBe('created')
  })

  it('should fail create if document exists', async () => {
    await client.index({
      index: 'my-index',
      id: '1',
      document: { title: 'Existing' },
    })

    const response = await client.bulk({
      operations: [
        { create: { _index: 'my-index', _id: '1' } },
        { title: 'New' },
      ],
    })

    expect(response.errors).toBe(true)
    expect(response.items[0].create?.error).toBeDefined()
  })

  it('should support update action', async () => {
    await client.index({
      index: 'my-index',
      id: '1',
      document: { title: 'Hello', count: 0 },
    })

    const response = await client.bulk({
      operations: [
        { update: { _index: 'my-index', _id: '1' } },
        { doc: { title: 'Updated' } },
      ],
    })

    expect(response.errors).toBe(false)
    expect(response.items[0].update?.result).toBe('updated')

    const doc = await client.get({ index: 'my-index', id: '1' })
    expect(doc._source?.title).toBe('Updated')
    expect(doc._source?.count).toBe(0)
  })

  it('should support delete action', async () => {
    await client.index({
      index: 'my-index',
      id: '1',
      document: { title: 'Hello' },
    })

    const response = await client.bulk({
      operations: [
        { delete: { _index: 'my-index', _id: '1' } },
      ],
    })

    expect(response.errors).toBe(false)
    expect(response.items[0].delete?.result).toBe('deleted')
  })

  it('should use default index', async () => {
    const response = await client.bulk({
      index: 'my-index',
      operations: [
        { index: { _id: '1' } },
        { title: 'Hello' },
        { index: { _id: '2' } },
        { title: 'World' },
      ],
    })

    expect(response.errors).toBe(false)
    expect(response.items[0].index?._index).toBe('my-index')
    expect(response.items[1].index?._index).toBe('my-index')
  })

  it('should support body parameter for legacy compatibility', async () => {
    const response = await client.bulk({
      body: [
        { index: { _index: 'my-index', _id: '1' } },
        { title: 'Hello' },
      ],
    })

    expect(response.errors).toBe(false)
    expect(response.items).toHaveLength(1)
  })

  it('should handle mixed operations', async () => {
    await client.index({
      index: 'my-index',
      id: '1',
      document: { title: 'Existing' },
    })

    const response = await client.bulk({
      operations: [
        { index: { _index: 'my-index', _id: '2' } },
        { title: 'Indexed' },
        { update: { _index: 'my-index', _id: '1' } },
        { doc: { title: 'Updated' } },
        { delete: { _index: 'my-index', _id: '2' } },
      ],
    })

    expect(response.errors).toBe(false)
    expect(response.items).toHaveLength(3)
  })
})

// ============================================================================
// SEARCH TESTS - BASIC
// ============================================================================

describe('client.search() - basic', () => {
  let client: ClientType

  beforeEach(async () => {
    clearAllIndices()
    client = new Client({ node: 'http://localhost:9200' })
    await client.bulk({
      operations: [
        { index: { _index: 'my-index', _id: '1' } },
        { title: 'iPhone 15 Pro', brand: 'Apple', price: 1199, category: 'phones', inStock: true },
        { index: { _index: 'my-index', _id: '2' } },
        { title: 'iPhone 15', brand: 'Apple', price: 999, category: 'phones', inStock: true },
        { index: { _index: 'my-index', _id: '3' } },
        { title: 'Galaxy S24', brand: 'Samsung', price: 899, category: 'phones', inStock: false },
        { index: { _index: 'my-index', _id: '4' } },
        { title: 'MacBook Pro', brand: 'Apple', price: 2499, category: 'laptops', inStock: true },
        { index: { _index: 'my-index', _id: '5' } },
        { title: 'iPad Air', brand: 'Apple', price: 599, category: 'tablets', inStock: true },
      ],
    })
  })

  it('should search all documents with match_all', async () => {
    const response = await client.search({
      index: 'my-index',
      query: { match_all: {} },
    })

    expect(response.hits.total.value).toBe(5)
    expect(response.hits.hits).toHaveLength(5)
  })

  it('should search with empty query (match_all)', async () => {
    const response = await client.search({
      index: 'my-index',
    })

    expect(response.hits.total.value).toBe(5)
  })

  it('should return search metadata', async () => {
    const response = await client.search({
      index: 'my-index',
    })

    expect(response.took).toBeDefined()
    expect(response.timed_out).toBe(false)
    expect(response._shards).toBeDefined()
    expect(response._shards.total).toBeGreaterThan(0)
    expect(response._shards.successful).toBeGreaterThan(0)
    expect(response.hits.max_score).toBeDefined()
  })

  it('should search with size limit', async () => {
    const response = await client.search({
      index: 'my-index',
      size: 2,
    })

    expect(response.hits.hits).toHaveLength(2)
    expect(response.hits.total.value).toBe(5)
  })

  it('should search with from offset', async () => {
    const response = await client.search({
      index: 'my-index',
      size: 2,
      from: 2,
    })

    expect(response.hits.hits).toHaveLength(2)
  })

  it('should search multiple indices', async () => {
    await client.index({
      index: 'other-index',
      id: '1',
      document: { title: 'Other Document' },
    })

    const response = await client.search({
      index: ['my-index', 'other-index'],
    })

    expect(response.hits.total.value).toBe(6)
  })

  it('should filter source fields', async () => {
    const response = await client.search({
      index: 'my-index',
      size: 1,
      _source: ['title', 'brand'],
    })

    expect(response.hits.hits[0]._source).toHaveProperty('title')
    expect(response.hits.hits[0]._source).toHaveProperty('brand')
    expect(response.hits.hits[0]._source).not.toHaveProperty('price')
  })

  it('should exclude source with _source: false', async () => {
    const response = await client.search({
      index: 'my-index',
      size: 1,
      _source: false,
    })

    expect(response.hits.hits[0]._source).toBeUndefined()
  })
})

// ============================================================================
// SEARCH TESTS - MATCH QUERIES
// ============================================================================

describe('client.search() - match queries', () => {
  let client: ClientType

  beforeEach(async () => {
    clearAllIndices()
    client = new Client({ node: 'http://localhost:9200' })
    await client.bulk({
      operations: [
        { index: { _index: 'my-index', _id: '1' } },
        { title: 'The quick brown fox', content: 'Jumps over the lazy dog' },
        { index: { _index: 'my-index', _id: '2' } },
        { title: 'Quick brown foxes', content: 'Are fast animals' },
        { index: { _index: 'my-index', _id: '3' } },
        { title: 'Lazy dogs', content: 'Sleep all day' },
      ],
    })
  })

  it('should search with match query', async () => {
    const response = await client.search({
      index: 'my-index',
      query: { match: { title: 'quick' } },
    })

    expect(response.hits.total.value).toBe(2)
  })

  it('should search with match query (object format)', async () => {
    const response = await client.search({
      index: 'my-index',
      query: { match: { title: { query: 'quick brown', operator: 'and' } } },
    })

    expect(response.hits.total.value).toBe(2)
  })

  it('should search with multi_match query', async () => {
    const response = await client.search({
      index: 'my-index',
      query: {
        multi_match: {
          query: 'lazy',
          fields: ['title', 'content'],
        },
      },
    })

    expect(response.hits.total.value).toBe(2)
  })

  it('should search with match_phrase query', async () => {
    const response = await client.search({
      index: 'my-index',
      query: { match_phrase: { title: 'quick brown' } },
    })

    expect(response.hits.total.value).toBe(2)
  })

  it('should be case insensitive', async () => {
    const response = await client.search({
      index: 'my-index',
      query: { match: { title: 'QUICK' } },
    })

    expect(response.hits.total.value).toBe(2)
  })
})

// ============================================================================
// SEARCH TESTS - TERM QUERIES
// ============================================================================

describe('client.search() - term queries', () => {
  let client: ClientType

  beforeEach(async () => {
    clearAllIndices()
    client = new Client({ node: 'http://localhost:9200' })
    await client.bulk({
      operations: [
        { index: { _index: 'my-index', _id: '1' } },
        { title: 'iPhone', brand: 'Apple', price: 999, inStock: true },
        { index: { _index: 'my-index', _id: '2' } },
        { title: 'MacBook', brand: 'Apple', price: 2499, inStock: false },
        { index: { _index: 'my-index', _id: '3' } },
        { title: 'Galaxy', brand: 'Samsung', price: 899, inStock: true },
      ],
    })
  })

  it('should search with term query', async () => {
    const response = await client.search({
      index: 'my-index',
      query: { term: { brand: 'Apple' } },
    })

    expect(response.hits.total.value).toBe(2)
  })

  it('should search with term query (object format)', async () => {
    const response = await client.search({
      index: 'my-index',
      query: { term: { brand: { value: 'Apple' } } },
    })

    expect(response.hits.total.value).toBe(2)
  })

  it('should search with terms query', async () => {
    const response = await client.search({
      index: 'my-index',
      query: { terms: { brand: ['Apple', 'Samsung'] } },
    })

    expect(response.hits.total.value).toBe(3)
  })

  it('should search with exists query', async () => {
    const response = await client.search({
      index: 'my-index',
      query: { exists: { field: 'brand' } },
    })

    expect(response.hits.total.value).toBe(3)
  })

  it('should search with ids query', async () => {
    const response = await client.search({
      index: 'my-index',
      query: { ids: { values: ['1', '3'] } },
    })

    expect(response.hits.total.value).toBe(2)
  })
})

// ============================================================================
// SEARCH TESTS - RANGE QUERIES
// ============================================================================

describe('client.search() - range queries', () => {
  let client: ClientType

  beforeEach(async () => {
    clearAllIndices()
    client = new Client({ node: 'http://localhost:9200' })
    await client.bulk({
      operations: [
        { index: { _index: 'my-index', _id: '1' } },
        { title: 'iPhone', price: 999, rating: 4.5 },
        { index: { _index: 'my-index', _id: '2' } },
        { title: 'MacBook', price: 2499, rating: 4.8 },
        { index: { _index: 'my-index', _id: '3' } },
        { title: 'Galaxy', price: 899, rating: 4.2 },
      ],
    })
  })

  it('should search with range gt', async () => {
    const response = await client.search({
      index: 'my-index',
      query: { range: { price: { gt: 900 } } },
    })

    expect(response.hits.total.value).toBe(2)
  })

  it('should search with range gte', async () => {
    const response = await client.search({
      index: 'my-index',
      query: { range: { price: { gte: 999 } } },
    })

    expect(response.hits.total.value).toBe(2)
  })

  it('should search with range lt', async () => {
    const response = await client.search({
      index: 'my-index',
      query: { range: { price: { lt: 1000 } } },
    })

    expect(response.hits.total.value).toBe(2)
  })

  it('should search with range lte', async () => {
    const response = await client.search({
      index: 'my-index',
      query: { range: { price: { lte: 999 } } },
    })

    expect(response.hits.total.value).toBe(2)
  })

  it('should search with range between', async () => {
    const response = await client.search({
      index: 'my-index',
      query: { range: { price: { gte: 899, lte: 1000 } } },
    })

    expect(response.hits.total.value).toBe(2)
  })
})

// ============================================================================
// SEARCH TESTS - BOOL QUERIES
// ============================================================================

describe('client.search() - bool queries', () => {
  let client: ClientType

  beforeEach(async () => {
    clearAllIndices()
    client = new Client({ node: 'http://localhost:9200' })
    await client.bulk({
      operations: [
        { index: { _index: 'my-index', _id: '1' } },
        { title: 'iPhone', brand: 'Apple', price: 999, category: 'phones', inStock: true },
        { index: { _index: 'my-index', _id: '2' } },
        { title: 'MacBook', brand: 'Apple', price: 2499, category: 'laptops', inStock: true },
        { index: { _index: 'my-index', _id: '3' } },
        { title: 'Galaxy', brand: 'Samsung', price: 899, category: 'phones', inStock: false },
        { index: { _index: 'my-index', _id: '4' } },
        { title: 'iPad', brand: 'Apple', price: 599, category: 'tablets', inStock: true },
      ],
    })
  })

  it('should search with bool must', async () => {
    const response = await client.search({
      index: 'my-index',
      query: {
        bool: {
          must: [
            { term: { brand: 'Apple' } },
            { term: { category: 'phones' } },
          ],
        },
      },
    })

    expect(response.hits.total.value).toBe(1)
    expect(response.hits.hits[0]._source?.title).toBe('iPhone')
  })

  it('should search with bool must_not', async () => {
    const response = await client.search({
      index: 'my-index',
      query: {
        bool: {
          must: { term: { brand: 'Apple' } },
          must_not: { term: { category: 'phones' } },
        },
      },
    })

    expect(response.hits.total.value).toBe(2)
  })

  it('should search with bool should', async () => {
    const response = await client.search({
      index: 'my-index',
      query: {
        bool: {
          should: [
            { term: { category: 'phones' } },
            { term: { category: 'tablets' } },
          ],
        },
      },
    })

    expect(response.hits.total.value).toBe(3)
  })

  it('should search with bool filter', async () => {
    const response = await client.search({
      index: 'my-index',
      query: {
        bool: {
          must: { match: { title: 'iPhone' } },
          filter: { term: { inStock: true } },
        },
      },
    })

    expect(response.hits.total.value).toBe(1)
  })

  it('should search with nested bool', async () => {
    const response = await client.search({
      index: 'my-index',
      query: {
        bool: {
          must: { term: { brand: 'Apple' } },
          should: [
            { bool: { must: { term: { category: 'phones' } } } },
            { bool: { must: { term: { category: 'tablets' } } } },
          ],
          minimum_should_match: 1,
        },
      },
    })

    expect(response.hits.total.value).toBe(2)
  })
})

// ============================================================================
// SEARCH TESTS - SORTING
// ============================================================================

describe('client.search() - sorting', () => {
  let client: ClientType

  beforeEach(async () => {
    clearAllIndices()
    client = new Client({ node: 'http://localhost:9200' })
    await client.bulk({
      operations: [
        { index: { _index: 'my-index', _id: '1' } },
        { title: 'iPhone', price: 999 },
        { index: { _index: 'my-index', _id: '2' } },
        { title: 'MacBook', price: 2499 },
        { index: { _index: 'my-index', _id: '3' } },
        { title: 'Galaxy', price: 899 },
      ],
    })
  })

  it('should sort by field ascending', async () => {
    const response = await client.search({
      index: 'my-index',
      sort: [{ price: 'asc' }],
    })

    expect(response.hits.hits[0]._source?.title).toBe('Galaxy')
    expect(response.hits.hits[2]._source?.title).toBe('MacBook')
  })

  it('should sort by field descending', async () => {
    const response = await client.search({
      index: 'my-index',
      sort: [{ price: 'desc' }],
    })

    expect(response.hits.hits[0]._source?.title).toBe('MacBook')
    expect(response.hits.hits[2]._source?.title).toBe('Galaxy')
  })

  it('should include sort values in hits', async () => {
    const response = await client.search({
      index: 'my-index',
      sort: [{ price: 'asc' }],
    })

    expect(response.hits.hits[0].sort).toEqual([899])
    expect(response.hits.hits[1].sort).toEqual([999])
    expect(response.hits.hits[2].sort).toEqual([2499])
  })

  it('should sort by string field as string', async () => {
    const response = await client.search({
      index: 'my-index',
      sort: ['title'],
    })

    expect(response.hits.hits[0]._source?.title).toBe('Galaxy')
    expect(response.hits.hits[2]._source?.title).toBe('MacBook')
  })

  it('should sort by multiple fields', async () => {
    await client.index({
      index: 'my-index',
      id: '4',
      document: { title: 'Pixel', price: 899 },
    })

    const response = await client.search({
      index: 'my-index',
      sort: [{ price: 'asc' }, { title: 'asc' }],
    })

    expect(response.hits.hits[0]._source?.title).toBe('Galaxy')
    expect(response.hits.hits[1]._source?.title).toBe('Pixel')
  })
})

// ============================================================================
// SEARCH TESTS - HIGHLIGHTING
// ============================================================================

describe('client.search() - highlighting', () => {
  let client: ClientType

  beforeEach(async () => {
    clearAllIndices()
    client = new Client({ node: 'http://localhost:9200' })
    await client.bulk({
      operations: [
        { index: { _index: 'my-index', _id: '1' } },
        { title: 'The quick brown fox', content: 'Jumps over the lazy dog' },
        { index: { _index: 'my-index', _id: '2' } },
        { title: 'Quick brown foxes', content: 'Are fast animals' },
      ],
    })
  })

  it('should highlight matching terms', async () => {
    const response = await client.search({
      index: 'my-index',
      query: { match: { title: 'quick' } },
      highlight: {
        fields: { title: {} },
      },
    })

    expect(response.hits.hits[0].highlight).toBeDefined()
    expect(response.hits.hits[0].highlight?.title).toBeDefined()
    expect(response.hits.hits[0].highlight?.title[0]).toContain('<em>')
  })

  it('should use custom highlight tags', async () => {
    const response = await client.search({
      index: 'my-index',
      query: { match: { title: 'quick' } },
      highlight: {
        pre_tags: ['<mark>'],
        post_tags: ['</mark>'],
        fields: { title: {} },
      },
    })

    expect(response.hits.hits[0].highlight?.title[0]).toContain('<mark>')
    expect(response.hits.hits[0].highlight?.title[0]).toContain('</mark>')
  })

  it('should highlight multiple fields', async () => {
    const response = await client.search({
      index: 'my-index',
      query: {
        multi_match: {
          query: 'fox',
          fields: ['title', 'content'],
        },
      },
      highlight: {
        fields: {
          title: {},
          content: {},
        },
      },
    })

    // At least one field should have highlight
    const hit = response.hits.hits[0]
    const hasHighlight = hit.highlight?.title || hit.highlight?.content
    expect(hasHighlight).toBeTruthy()
  })
})

// ============================================================================
// AGGREGATION TESTS
// ============================================================================

describe('client.search() - aggregations', () => {
  let client: ClientType

  beforeEach(async () => {
    clearAllIndices()
    client = new Client({ node: 'http://localhost:9200' })
    await client.bulk({
      operations: [
        { index: { _index: 'my-index', _id: '1' } },
        { title: 'iPhone', brand: 'Apple', price: 999, category: 'phones' },
        { index: { _index: 'my-index', _id: '2' } },
        { title: 'MacBook', brand: 'Apple', price: 2499, category: 'laptops' },
        { index: { _index: 'my-index', _id: '3' } },
        { title: 'Galaxy', brand: 'Samsung', price: 899, category: 'phones' },
        { index: { _index: 'my-index', _id: '4' } },
        { title: 'iPad', brand: 'Apple', price: 599, category: 'tablets' },
        { index: { _index: 'my-index', _id: '5' } },
        { title: 'Pixel', brand: 'Google', price: 699, category: 'phones' },
      ],
    })
  })

  it('should return terms aggregation', async () => {
    const response = await client.search({
      index: 'my-index',
      size: 0,
      aggs: {
        brands: {
          terms: { field: 'brand' },
        },
      },
    })

    expect(response.aggregations).toBeDefined()
    expect(response.aggregations?.brands.buckets).toBeDefined()

    const buckets = response.aggregations?.brands.buckets as Array<{ key: string; doc_count: number }>
    const appleBucket = buckets.find((b) => b.key === 'Apple')
    expect(appleBucket?.doc_count).toBe(3)
  })

  it('should return avg aggregation', async () => {
    const response = await client.search({
      index: 'my-index',
      size: 0,
      aggs: {
        avg_price: {
          avg: { field: 'price' },
        },
      },
    })

    expect(response.aggregations?.avg_price.value).toBe((999 + 2499 + 899 + 599 + 699) / 5)
  })

  it('should return sum aggregation', async () => {
    const response = await client.search({
      index: 'my-index',
      size: 0,
      aggs: {
        total_price: {
          sum: { field: 'price' },
        },
      },
    })

    expect(response.aggregations?.total_price.value).toBe(999 + 2499 + 899 + 599 + 699)
  })

  it('should return min aggregation', async () => {
    const response = await client.search({
      index: 'my-index',
      size: 0,
      aggs: {
        min_price: {
          min: { field: 'price' },
        },
      },
    })

    expect(response.aggregations?.min_price.value).toBe(599)
  })

  it('should return max aggregation', async () => {
    const response = await client.search({
      index: 'my-index',
      size: 0,
      aggs: {
        max_price: {
          max: { field: 'price' },
        },
      },
    })

    expect(response.aggregations?.max_price.value).toBe(2499)
  })

  it('should return cardinality aggregation', async () => {
    const response = await client.search({
      index: 'my-index',
      size: 0,
      aggs: {
        unique_brands: {
          cardinality: { field: 'brand' },
        },
      },
    })

    expect(response.aggregations?.unique_brands.value).toBe(3)
  })

  it('should return stats aggregation', async () => {
    const response = await client.search({
      index: 'my-index',
      size: 0,
      aggs: {
        price_stats: {
          stats: { field: 'price' },
        },
      },
    })

    expect(response.aggregations?.price_stats.count).toBe(5)
    expect(response.aggregations?.price_stats.min).toBe(599)
    expect(response.aggregations?.price_stats.max).toBe(2499)
    expect(response.aggregations?.price_stats.sum).toBe(999 + 2499 + 899 + 599 + 699)
    expect(response.aggregations?.price_stats.avg).toBe((999 + 2499 + 899 + 599 + 699) / 5)
  })

  it('should support nested aggregations', async () => {
    const response = await client.search({
      index: 'my-index',
      size: 0,
      aggs: {
        categories: {
          terms: { field: 'category' },
          aggs: {
            avg_price: { avg: { field: 'price' } },
          },
        },
      },
    })

    const buckets = response.aggregations?.categories.buckets as Array<{
      key: string
      doc_count: number
      avg_price: { value: number }
    }>
    const phonesBucket = buckets.find((b) => b.key === 'phones')
    expect(phonesBucket).toBeDefined()
    expect(phonesBucket?.avg_price.value).toBe((999 + 899 + 699) / 3)
  })

  it('should filter aggregation results with terms.size', async () => {
    const response = await client.search({
      index: 'my-index',
      size: 0,
      aggs: {
        brands: {
          terms: { field: 'brand', size: 2 },
        },
      },
    })

    const buckets = response.aggregations?.brands.buckets as unknown[]
    expect(buckets.length).toBeLessThanOrEqual(2)
  })
})

// ============================================================================
// COUNT TESTS
// ============================================================================

describe('client.count()', () => {
  let client: ClientType

  beforeEach(async () => {
    clearAllIndices()
    client = new Client({ node: 'http://localhost:9200' })
    await client.bulk({
      operations: [
        { index: { _index: 'my-index', _id: '1' } },
        { title: 'iPhone', brand: 'Apple' },
        { index: { _index: 'my-index', _id: '2' } },
        { title: 'MacBook', brand: 'Apple' },
        { index: { _index: 'my-index', _id: '3' } },
        { title: 'Galaxy', brand: 'Samsung' },
      ],
    })
  })

  it('should count all documents', async () => {
    const response = await client.count({ index: 'my-index' })

    expect(response.count).toBe(3)
  })

  it('should count documents matching query', async () => {
    const response = await client.count({
      index: 'my-index',
      query: { term: { brand: 'Apple' } },
    })

    expect(response.count).toBe(2)
  })
})

// ============================================================================
// SCROLL TESTS
// ============================================================================

describe('scroll', () => {
  let client: ClientType

  beforeEach(async () => {
    clearAllIndices()
    client = new Client({ node: 'http://localhost:9200' })

    // Create 25 documents
    const operations: unknown[] = []
    for (let i = 1; i <= 25; i++) {
      operations.push({ index: { _index: 'my-index', _id: String(i) } })
      operations.push({ title: `Document ${i}` })
    }
    await client.bulk({ operations })
  })

  it('should paginate with scroll', async () => {
    const firstResponse = await client.search({
      index: 'my-index',
      scroll: '1m',
      size: 10,
    })

    expect(firstResponse.hits.hits).toHaveLength(10)
    expect(firstResponse._scroll_id).toBeDefined()

    const secondResponse = await client.scroll({
      scroll_id: firstResponse._scroll_id!,
      scroll: '1m',
    })

    expect(secondResponse.hits.hits).toHaveLength(10)

    const thirdResponse = await client.scroll({
      scroll_id: secondResponse._scroll_id!,
      scroll: '1m',
    })

    expect(thirdResponse.hits.hits).toHaveLength(5)
  })

  it('should clear scroll', async () => {
    const searchResponse = await client.search({
      index: 'my-index',
      scroll: '1m',
      size: 10,
    })

    const clearResponse = await client.clearScroll({
      scroll_id: searchResponse._scroll_id,
    })

    expect(clearResponse.succeeded).toBe(true)
  })
})

// ============================================================================
// INDEX MANAGEMENT TESTS
// ============================================================================

describe('client.indices', () => {
  let client: ClientType

  beforeEach(() => {
    clearAllIndices()
    client = new Client({ node: 'http://localhost:9200' })
  })

  describe('create', () => {
    it('should create an index', async () => {
      const response = await client.indices.create({ index: 'new-index' })

      expect(response.acknowledged).toBe(true)
      expect(response.index).toBe('new-index')
    })

    it('should create an index with settings', async () => {
      const response = await client.indices.create({
        index: 'new-index',
        settings: {
          number_of_shards: 1,
          number_of_replicas: 0,
        },
      })

      expect(response.acknowledged).toBe(true)
    })

    it('should create an index with mappings', async () => {
      const response = await client.indices.create({
        index: 'new-index',
        mappings: {
          properties: {
            title: { type: 'text' },
            created: { type: 'date' },
          },
        },
      })

      expect(response.acknowledged).toBe(true)
    })

    it('should throw IndexAlreadyExistsError if index exists', async () => {
      await client.indices.create({ index: 'new-index' })

      await expect(
        client.indices.create({ index: 'new-index' })
      ).rejects.toThrow(IndexAlreadyExistsError)
    })
  })

  describe('delete', () => {
    it('should delete an index', async () => {
      await client.indices.create({ index: 'new-index' })

      const response = await client.indices.delete({ index: 'new-index' })

      expect(response.acknowledged).toBe(true)
      expect(await client.indices.exists({ index: 'new-index' })).toBe(false)
    })

    it('should throw IndexNotFoundError if index does not exist', async () => {
      await expect(
        client.indices.delete({ index: 'non-existent' })
      ).rejects.toThrow(IndexNotFoundError)
    })
  })

  describe('exists', () => {
    it('should return true if index exists', async () => {
      await client.indices.create({ index: 'new-index' })

      expect(await client.indices.exists({ index: 'new-index' })).toBe(true)
    })

    it('should return false if index does not exist', async () => {
      expect(await client.indices.exists({ index: 'non-existent' })).toBe(false)
    })
  })

  describe('get', () => {
    it('should get index information', async () => {
      await client.indices.create({
        index: 'new-index',
        settings: {
          number_of_shards: 1,
        },
        mappings: {
          properties: {
            title: { type: 'text' },
          },
        },
      })

      const response = await client.indices.get({ index: 'new-index' })

      expect(response['new-index']).toBeDefined()
      expect(response['new-index'].settings).toBeDefined()
      expect(response['new-index'].mappings).toBeDefined()
    })
  })

  describe('getMapping', () => {
    it('should get index mappings', async () => {
      await client.indices.create({
        index: 'new-index',
        mappings: {
          properties: {
            title: { type: 'text' },
            count: { type: 'integer' },
          },
        },
      })

      const response = await client.indices.getMapping({ index: 'new-index' })

      expect(response['new-index'].mappings.properties?.title.type).toBe('text')
      expect(response['new-index'].mappings.properties?.count.type).toBe('integer')
    })
  })

  describe('putMapping', () => {
    it('should update index mappings', async () => {
      await client.indices.create({ index: 'new-index' })

      const response = await client.indices.putMapping({
        index: 'new-index',
        properties: {
          title: { type: 'text' },
          created: { type: 'date' },
        },
      })

      expect(response.acknowledged).toBe(true)

      const mappings = await client.indices.getMapping({ index: 'new-index' })
      expect(mappings['new-index'].mappings.properties?.title.type).toBe('text')
    })
  })

  describe('getSettings', () => {
    it('should get index settings', async () => {
      await client.indices.create({
        index: 'new-index',
        settings: {
          number_of_shards: 1,
          number_of_replicas: 0,
        },
      })

      const response = await client.indices.getSettings({ index: 'new-index' })

      expect(response['new-index'].settings.index.number_of_shards).toBe(1)
      expect(response['new-index'].settings.index.number_of_replicas).toBe(0)
    })
  })

  describe('putSettings', () => {
    it('should update index settings', async () => {
      await client.indices.create({ index: 'new-index' })

      const response = await client.indices.putSettings({
        index: 'new-index',
        settings: {
          number_of_replicas: 2,
        },
      })

      expect(response.acknowledged).toBe(true)

      const settings = await client.indices.getSettings({ index: 'new-index' })
      expect(settings['new-index'].settings.index.number_of_replicas).toBe(2)
    })
  })

  describe('refresh', () => {
    it('should refresh an index', async () => {
      await client.indices.create({ index: 'new-index' })

      const response = await client.indices.refresh({ index: 'new-index' })

      expect(response._shards.successful).toBeGreaterThan(0)
    })
  })

  describe('stats', () => {
    it('should get index stats', async () => {
      await client.indices.create({ index: 'new-index' })
      await client.index({
        index: 'new-index',
        id: '1',
        document: { title: 'Test' },
      })

      const response = await client.indices.stats({ index: 'new-index' })

      expect(response.indices['new-index']).toBeDefined()
      expect(response.indices['new-index'].primaries.docs.count).toBe(1)
    })
  })
})

// ============================================================================
// CLUSTER TESTS
// ============================================================================

describe('client.cluster', () => {
  let client: ClientType

  beforeEach(() => {
    clearAllIndices()
    client = new Client({ node: 'http://localhost:9200' })
  })

  it('should return cluster health', async () => {
    const response = await client.cluster.health()

    expect(response.cluster_name).toBeDefined()
    expect(response.status).toMatch(/^(green|yellow|red)$/)
    expect(response.number_of_nodes).toBeGreaterThan(0)
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('e-commerce integration', () => {
  let client: ClientType

  beforeEach(async () => {
    clearAllIndices()
    client = new Client({ node: 'http://localhost:9200' })

    await client.indices.create({
      index: 'products',
      mappings: {
        properties: {
          name: { type: 'text' },
          description: { type: 'text' },
          brand: { type: 'keyword' },
          category: { type: 'keyword' },
          price: { type: 'float' },
          inStock: { type: 'boolean' },
        },
      },
    })

    await client.bulk({
      index: 'products',
      operations: [
        { index: { _id: '1' } },
        { name: 'iPhone 15 Pro Max', brand: 'Apple', category: 'phones', price: 1199, inStock: true, description: 'The most powerful iPhone ever' },
        { index: { _id: '2' } },
        { name: 'iPhone 15', brand: 'Apple', category: 'phones', price: 999, inStock: true, description: 'Beautiful and powerful' },
        { index: { _id: '3' } },
        { name: 'Galaxy S24 Ultra', brand: 'Samsung', category: 'phones', price: 1199, inStock: false, description: 'AI-powered Galaxy experience' },
        { index: { _id: '4' } },
        { name: 'MacBook Pro 14', brand: 'Apple', category: 'laptops', price: 2499, inStock: true, description: 'Pro performance in a laptop' },
        { index: { _id: '5' } },
        { name: 'iPad Pro 12.9', brand: 'Apple', category: 'tablets', price: 1299, inStock: true, description: 'Your next computer is not a computer' },
      ],
    })
  })

  it('should perform a full e-commerce search', async () => {
    const response = await client.search<{
      name: string
      brand: string
      category: string
      price: number
      inStock: boolean
    }>({
      index: 'products',
      query: {
        bool: {
          must: { match: { name: 'iPhone' } },
          filter: [
            { term: { inStock: true } },
            { range: { price: { lt: 1200 } } },
          ],
        },
      },
      aggs: {
        brands: { terms: { field: 'brand' } },
        categories: { terms: { field: 'category' } },
      },
      size: 10,
    })

    expect(response.hits.total.value).toBe(2)
    expect(response.hits.hits.every((h) => h._source?.inStock)).toBe(true)
    expect(response.hits.hits.every((h) => (h._source?.price ?? 0) < 1200)).toBe(true)
    expect(response.aggregations).toBeDefined()
  })

  it('should handle faceted navigation', async () => {
    // Get all categories
    const categoriesResponse = await client.search({
      index: 'products',
      size: 0,
      aggs: {
        categories: {
          terms: { field: 'category' },
          aggs: {
            avg_price: { avg: { field: 'price' } },
          },
        },
      },
    })

    expect(categoriesResponse.aggregations?.categories.buckets).toBeDefined()

    // Filter by category and get brand facets
    const filteredResponse = await client.search({
      index: 'products',
      query: { term: { category: 'phones' } },
      size: 0,
      aggs: {
        brands: { terms: { field: 'brand' } },
        price_range: {
          range: {
            field: 'price',
            ranges: [
              { to: 1000 },
              { from: 1000, to: 1500 },
              { from: 1500 },
            ],
          },
        },
      },
    })

    expect(filteredResponse.aggregations?.brands.buckets).toBeDefined()
    expect(filteredResponse.aggregations?.price_range.buckets).toBeDefined()
  })

  it('should handle search_after pagination', async () => {
    const firstPage = await client.search({
      index: 'products',
      sort: [{ price: 'asc' }, { _id: 'asc' }],
      size: 2,
    })

    expect(firstPage.hits.hits).toHaveLength(2)
    expect(firstPage.hits.hits[1].sort).toBeDefined()

    const secondPage = await client.search({
      index: 'products',
      sort: [{ price: 'asc' }, { _id: 'asc' }],
      size: 2,
      body: {
        search_after: firstPage.hits.hits[1].sort,
      },
    })

    expect(secondPage.hits.hits).toHaveLength(2)
    // Ensure no overlap with first page
    const firstPageIds = firstPage.hits.hits.map((h) => h._id)
    const secondPageIds = secondPage.hits.hits.map((h) => h._id)
    expect(firstPageIds.filter((id) => secondPageIds.includes(id))).toHaveLength(0)
  })
})
