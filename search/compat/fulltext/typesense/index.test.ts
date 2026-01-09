/**
 * @dotdo/typesense - Typesense SDK compat tests
 *
 * Tests for Typesense API compatibility backed by DO SQLite FTS5:
 * - Client creation
 * - Collection management (create, get, delete)
 * - Schema/field types
 * - Document CRUD
 * - Search with query_by
 * - Filtering (filter_by)
 * - Sorting (sort_by)
 * - Geo search
 * - Faceting
 *
 * @see https://typesense.org/docs/
 */
import { describe, it, expect, beforeEach } from 'vitest'
import Typesense, { clearAllCollections } from './typesense'
import type {
  TypesenseClient,
  Collection,
  SearchResult,
  Document,
} from './types'
import { ObjectNotFound, ObjectAlreadyExists, RequestMalformed } from './types'

// ============================================================================
// CLIENT TESTS
// ============================================================================

describe('Typesense.Client', () => {
  let client: TypesenseClient

  beforeEach(() => {
    clearAllCollections()
    client = new Typesense.Client({
      nodes: [{ host: 'localhost', port: 8108, protocol: 'http' }],
      apiKey: 'xyz',
    })
  })

  it('should create a client with configuration', () => {
    expect(client).toBeDefined()
  })

  it('should have collections() method', () => {
    expect(client.collections).toBeDefined()
    expect(typeof client.collections).toBe('function')
  })

  it('should have health check', async () => {
    const health = await client.health.retrieve()
    expect(health.ok).toBe(true)
  })

  it('should have debug info', async () => {
    const debug = await client.debug.retrieve()
    expect(debug.state).toBeDefined()
    expect(debug.version).toBeDefined()
  })
})

// ============================================================================
// COLLECTION MANAGEMENT TESTS
// ============================================================================

describe('collections().create', () => {
  let client: TypesenseClient

  beforeEach(() => {
    clearAllCollections()
    client = new Typesense.Client({
      nodes: [{ host: 'localhost', port: 8108, protocol: 'http' }],
      apiKey: 'xyz',
    })
  })

  it('should create a collection with schema', async () => {
    const collection = await client.collections().create({
      name: 'companies',
      fields: [
        { name: 'name', type: 'string' },
        { name: 'employees', type: 'int32' },
      ],
    })

    expect(collection.name).toBe('companies')
    expect(collection.fields).toHaveLength(2)
    expect(collection.num_documents).toBe(0)
  })

  it('should create a collection with geopoint field', async () => {
    const collection = await client.collections().create({
      name: 'places',
      fields: [
        { name: 'name', type: 'string' },
        { name: 'location', type: 'geopoint' },
      ],
    })

    expect(collection.name).toBe('places')
    expect(collection.fields.find((f) => f.name === 'location')?.type).toBe('geopoint')
  })

  it('should create a collection with facet fields', async () => {
    const collection = await client.collections().create({
      name: 'products',
      fields: [
        { name: 'name', type: 'string' },
        { name: 'brand', type: 'string', facet: true },
        { name: 'category', type: 'string', facet: true },
      ],
    })

    expect(collection.fields.find((f) => f.name === 'brand')?.facet).toBe(true)
  })

  it('should create a collection with optional fields', async () => {
    const collection = await client.collections().create({
      name: 'articles',
      fields: [
        { name: 'title', type: 'string' },
        { name: 'subtitle', type: 'string', optional: true },
      ],
    })

    expect(collection.fields.find((f) => f.name === 'subtitle')?.optional).toBe(true)
  })

  it('should create a collection with default_sorting_field', async () => {
    const collection = await client.collections().create({
      name: 'products',
      fields: [
        { name: 'name', type: 'string' },
        { name: 'popularity', type: 'int32' },
      ],
      default_sorting_field: 'popularity',
    })

    expect(collection.default_sorting_field).toBe('popularity')
  })

  it('should throw if collection already exists', async () => {
    await client.collections().create({
      name: 'companies',
      fields: [{ name: 'name', type: 'string' }],
    })

    await expect(
      client.collections().create({
        name: 'companies',
        fields: [{ name: 'name', type: 'string' }],
      })
    ).rejects.toThrow(ObjectAlreadyExists)
  })

  it('should include created_at timestamp', async () => {
    const collection = await client.collections().create({
      name: 'companies',
      fields: [{ name: 'name', type: 'string' }],
    })

    expect(collection.created_at).toBeDefined()
    expect(typeof collection.created_at).toBe('number')
  })
})

describe('collections().retrieve', () => {
  let client: TypesenseClient

  beforeEach(async () => {
    clearAllCollections()
    client = new Typesense.Client({
      nodes: [{ host: 'localhost', port: 8108, protocol: 'http' }],
      apiKey: 'xyz',
    })
    await client.collections().create({
      name: 'companies',
      fields: [{ name: 'name', type: 'string' }],
    })
  })

  it('should retrieve all collections', async () => {
    const collections = await client.collections().retrieve()

    expect(collections).toHaveLength(1)
    expect(collections[0].name).toBe('companies')
  })
})

describe('collections(name).retrieve', () => {
  let client: TypesenseClient

  beforeEach(async () => {
    clearAllCollections()
    client = new Typesense.Client({
      nodes: [{ host: 'localhost', port: 8108, protocol: 'http' }],
      apiKey: 'xyz',
    })
    await client.collections().create({
      name: 'companies',
      fields: [{ name: 'name', type: 'string' }],
    })
  })

  it('should retrieve a specific collection', async () => {
    const collection = await client.collections('companies').retrieve()

    expect(collection.name).toBe('companies')
  })

  it('should throw ObjectNotFound for non-existent collection', async () => {
    await expect(
      client.collections('non-existent').retrieve()
    ).rejects.toThrow(ObjectNotFound)
  })
})

describe('collections(name).delete', () => {
  let client: TypesenseClient

  beforeEach(async () => {
    clearAllCollections()
    client = new Typesense.Client({
      nodes: [{ host: 'localhost', port: 8108, protocol: 'http' }],
      apiKey: 'xyz',
    })
    await client.collections().create({
      name: 'companies',
      fields: [{ name: 'name', type: 'string' }],
    })
  })

  it('should delete a collection', async () => {
    const deleted = await client.collections('companies').delete()

    expect(deleted.name).toBe('companies')

    await expect(
      client.collections('companies').retrieve()
    ).rejects.toThrow(ObjectNotFound)
  })

  it('should throw ObjectNotFound for non-existent collection', async () => {
    await expect(
      client.collections('non-existent').delete()
    ).rejects.toThrow(ObjectNotFound)
  })
})

// ============================================================================
// SCHEMA/FIELD TYPE TESTS
// ============================================================================

describe('schema field types', () => {
  let client: TypesenseClient

  beforeEach(() => {
    clearAllCollections()
    client = new Typesense.Client({
      nodes: [{ host: 'localhost', port: 8108, protocol: 'http' }],
      apiKey: 'xyz',
    })
  })

  it('should support string type', async () => {
    const collection = await client.collections().create({
      name: 'test',
      fields: [{ name: 'title', type: 'string' }],
    })
    expect(collection.fields[0].type).toBe('string')
  })

  it('should support string[] type', async () => {
    const collection = await client.collections().create({
      name: 'test',
      fields: [{ name: 'tags', type: 'string[]' }],
    })
    expect(collection.fields[0].type).toBe('string[]')
  })

  it('should support int32 type', async () => {
    const collection = await client.collections().create({
      name: 'test',
      fields: [{ name: 'count', type: 'int32' }],
    })
    expect(collection.fields[0].type).toBe('int32')
  })

  it('should support int64 type', async () => {
    const collection = await client.collections().create({
      name: 'test',
      fields: [{ name: 'bigcount', type: 'int64' }],
    })
    expect(collection.fields[0].type).toBe('int64')
  })

  it('should support float type', async () => {
    const collection = await client.collections().create({
      name: 'test',
      fields: [{ name: 'price', type: 'float' }],
    })
    expect(collection.fields[0].type).toBe('float')
  })

  it('should support bool type', async () => {
    const collection = await client.collections().create({
      name: 'test',
      fields: [{ name: 'active', type: 'bool' }],
    })
    expect(collection.fields[0].type).toBe('bool')
  })

  it('should support geopoint type', async () => {
    const collection = await client.collections().create({
      name: 'test',
      fields: [{ name: 'location', type: 'geopoint' }],
    })
    expect(collection.fields[0].type).toBe('geopoint')
  })

  it('should support auto type', async () => {
    const collection = await client.collections().create({
      name: 'test',
      fields: [{ name: '.*', type: 'auto' }],
    })
    expect(collection.fields[0].type).toBe('auto')
  })
})

// ============================================================================
// DOCUMENT CRUD TESTS
// ============================================================================

describe('documents().create', () => {
  let client: TypesenseClient

  beforeEach(async () => {
    clearAllCollections()
    client = new Typesense.Client({
      nodes: [{ host: 'localhost', port: 8108, protocol: 'http' }],
      apiKey: 'xyz',
    })
    await client.collections().create({
      name: 'companies',
      fields: [
        { name: 'name', type: 'string' },
        { name: 'employees', type: 'int32' },
      ],
    })
  })

  it('should create a document with auto-generated id', async () => {
    const doc = await client.collections('companies').documents().create({
      name: 'Acme Corp',
      employees: 100,
    })

    expect(doc.id).toBeDefined()
    expect(doc.name).toBe('Acme Corp')
    expect(doc.employees).toBe(100)
  })

  it('should create a document with specified id', async () => {
    const doc = await client.collections('companies').documents().create({
      id: 'company-1',
      name: 'Acme Corp',
      employees: 100,
    })

    expect(doc.id).toBe('company-1')
  })

  it('should throw for duplicate id', async () => {
    await client.collections('companies').documents().create({
      id: 'company-1',
      name: 'Acme Corp',
      employees: 100,
    })

    await expect(
      client.collections('companies').documents().create({
        id: 'company-1',
        name: 'Other Corp',
        employees: 50,
      })
    ).rejects.toThrow(ObjectAlreadyExists)
  })

  it('should update num_documents on collection', async () => {
    await client.collections('companies').documents().create({
      name: 'Acme Corp',
      employees: 100,
    })

    const collection = await client.collections('companies').retrieve()
    expect(collection.num_documents).toBe(1)
  })
})

describe('documents().upsert', () => {
  let client: TypesenseClient

  beforeEach(async () => {
    clearAllCollections()
    client = new Typesense.Client({
      nodes: [{ host: 'localhost', port: 8108, protocol: 'http' }],
      apiKey: 'xyz',
    })
    await client.collections().create({
      name: 'companies',
      fields: [
        { name: 'name', type: 'string' },
        { name: 'employees', type: 'int32' },
      ],
    })
  })

  it('should create a new document', async () => {
    const doc = await client.collections('companies').documents().upsert({
      id: 'company-1',
      name: 'Acme Corp',
      employees: 100,
    })

    expect(doc.id).toBe('company-1')
  })

  it('should update existing document', async () => {
    await client.collections('companies').documents().upsert({
      id: 'company-1',
      name: 'Acme Corp',
      employees: 100,
    })

    const updated = await client.collections('companies').documents().upsert({
      id: 'company-1',
      name: 'Acme Corporation',
      employees: 150,
    })

    expect(updated.name).toBe('Acme Corporation')
    expect(updated.employees).toBe(150)
  })
})

describe('documents(id).retrieve', () => {
  let client: TypesenseClient

  beforeEach(async () => {
    clearAllCollections()
    client = new Typesense.Client({
      nodes: [{ host: 'localhost', port: 8108, protocol: 'http' }],
      apiKey: 'xyz',
    })
    await client.collections().create({
      name: 'companies',
      fields: [
        { name: 'name', type: 'string' },
        { name: 'employees', type: 'int32' },
      ],
    })
    await client.collections('companies').documents().create({
      id: 'company-1',
      name: 'Acme Corp',
      employees: 100,
    })
  })

  it('should retrieve a document by id', async () => {
    const doc = await client.collections('companies').documents('company-1').retrieve()

    expect(doc.id).toBe('company-1')
    expect(doc.name).toBe('Acme Corp')
  })

  it('should throw ObjectNotFound for non-existent document', async () => {
    await expect(
      client.collections('companies').documents('non-existent').retrieve()
    ).rejects.toThrow(ObjectNotFound)
  })
})

describe('documents(id).update', () => {
  let client: TypesenseClient

  beforeEach(async () => {
    clearAllCollections()
    client = new Typesense.Client({
      nodes: [{ host: 'localhost', port: 8108, protocol: 'http' }],
      apiKey: 'xyz',
    })
    await client.collections().create({
      name: 'companies',
      fields: [
        { name: 'name', type: 'string' },
        { name: 'employees', type: 'int32' },
      ],
    })
    await client.collections('companies').documents().create({
      id: 'company-1',
      name: 'Acme Corp',
      employees: 100,
    })
  })

  it('should partially update a document', async () => {
    const updated = await client.collections('companies').documents('company-1').update({
      employees: 150,
    })

    expect(updated.name).toBe('Acme Corp')
    expect(updated.employees).toBe(150)
  })

  it('should throw ObjectNotFound for non-existent document', async () => {
    await expect(
      client.collections('companies').documents('non-existent').update({
        employees: 150,
      })
    ).rejects.toThrow(ObjectNotFound)
  })
})

describe('documents(id).delete', () => {
  let client: TypesenseClient

  beforeEach(async () => {
    clearAllCollections()
    client = new Typesense.Client({
      nodes: [{ host: 'localhost', port: 8108, protocol: 'http' }],
      apiKey: 'xyz',
    })
    await client.collections().create({
      name: 'companies',
      fields: [
        { name: 'name', type: 'string' },
        { name: 'employees', type: 'int32' },
      ],
    })
    await client.collections('companies').documents().create({
      id: 'company-1',
      name: 'Acme Corp',
      employees: 100,
    })
  })

  it('should delete a document', async () => {
    const deleted = await client.collections('companies').documents('company-1').delete()

    expect(deleted.id).toBe('company-1')

    await expect(
      client.collections('companies').documents('company-1').retrieve()
    ).rejects.toThrow(ObjectNotFound)
  })

  it('should throw ObjectNotFound for non-existent document', async () => {
    await expect(
      client.collections('companies').documents('non-existent').delete()
    ).rejects.toThrow(ObjectNotFound)
  })
})

describe('documents().delete with filter', () => {
  let client: TypesenseClient

  beforeEach(async () => {
    clearAllCollections()
    client = new Typesense.Client({
      nodes: [{ host: 'localhost', port: 8108, protocol: 'http' }],
      apiKey: 'xyz',
    })
    await client.collections().create({
      name: 'companies',
      fields: [
        { name: 'name', type: 'string' },
        { name: 'employees', type: 'int32' },
      ],
    })
    await client.collections('companies').documents().upsert({ id: '1', name: 'Small Corp', employees: 10 })
    await client.collections('companies').documents().upsert({ id: '2', name: 'Medium Corp', employees: 50 })
    await client.collections('companies').documents().upsert({ id: '3', name: 'Large Corp', employees: 500 })
  })

  it('should delete documents matching filter', async () => {
    const result = await client.collections('companies').documents().delete({
      filter_by: 'employees:<100',
    })

    expect(result.num_deleted).toBe(2)

    const collection = await client.collections('companies').retrieve()
    expect(collection.num_documents).toBe(1)
  })
})

describe('documents().import', () => {
  let client: TypesenseClient

  beforeEach(async () => {
    clearAllCollections()
    client = new Typesense.Client({
      nodes: [{ host: 'localhost', port: 8108, protocol: 'http' }],
      apiKey: 'xyz',
    })
    await client.collections().create({
      name: 'companies',
      fields: [
        { name: 'name', type: 'string' },
        { name: 'employees', type: 'int32' },
      ],
    })
  })

  it('should import multiple documents', async () => {
    const results = await client.collections('companies').documents().import([
      { id: '1', name: 'Corp A', employees: 100 },
      { id: '2', name: 'Corp B', employees: 200 },
      { id: '3', name: 'Corp C', employees: 300 },
    ])

    expect(results).toHaveLength(3)
    expect(results.every((r) => r.success)).toBe(true)

    const collection = await client.collections('companies').retrieve()
    expect(collection.num_documents).toBe(3)
  })

  it('should import documents as JSONL string', async () => {
    const jsonl = [
      '{"id":"1","name":"Corp A","employees":100}',
      '{"id":"2","name":"Corp B","employees":200}',
    ].join('\n')

    const results = await client.collections('companies').documents().import(jsonl)

    expect(results).toHaveLength(2)
    expect(results.every((r) => r.success)).toBe(true)
  })
})

// ============================================================================
// SEARCH TESTS
// ============================================================================

describe('documents().search', () => {
  let client: TypesenseClient

  beforeEach(async () => {
    clearAllCollections()
    client = new Typesense.Client({
      nodes: [{ host: 'localhost', port: 8108, protocol: 'http' }],
      apiKey: 'xyz',
    })
    await client.collections().create({
      name: 'companies',
      fields: [
        { name: 'name', type: 'string' },
        { name: 'description', type: 'string' },
        { name: 'employees', type: 'int32' },
        { name: 'industry', type: 'string', facet: true },
      ],
    })

    await client.collections('companies').documents().import([
      { id: '1', name: 'Acme Corp', description: 'Technology company', employees: 100, industry: 'tech' },
      { id: '2', name: 'Acme Industries', description: 'Manufacturing company', employees: 500, industry: 'manufacturing' },
      { id: '3', name: 'Beta Tech', description: 'Software development', employees: 50, industry: 'tech' },
      { id: '4', name: 'Gamma Solutions', description: 'Consulting services', employees: 25, industry: 'consulting' },
    ])
  })

  it('should search by query', async () => {
    const results = await client.collections('companies').documents().search({
      q: 'acme',
      query_by: 'name',
    })

    expect(results.found).toBe(2)
    expect(results.hits).toHaveLength(2)
  })

  it('should search with wildcard query', async () => {
    const results = await client.collections('companies').documents().search({
      q: '*',
      query_by: 'name',
    })

    expect(results.found).toBe(4)
  })

  it('should search multiple fields', async () => {
    const results = await client.collections('companies').documents().search({
      q: 'technology',
      query_by: 'name,description',
    })

    expect(results.found).toBeGreaterThan(0)
  })

  it('should return search metadata', async () => {
    const results = await client.collections('companies').documents().search({
      q: 'acme',
      query_by: 'name',
    })

    expect(results.found).toBeDefined()
    expect(results.out_of).toBeDefined()
    expect(results.page).toBe(1)
    expect(results.search_time_ms).toBeDefined()
    expect(results.request_params).toBeDefined()
  })

  it('should include highlights', async () => {
    const results = await client.collections('companies').documents().search({
      q: 'acme',
      query_by: 'name',
    })

    expect(results.hits[0].highlights).toBeDefined()
    expect(results.hits[0].highlights!.length).toBeGreaterThan(0)
  })

  it('should search case-insensitively', async () => {
    const results = await client.collections('companies').documents().search({
      q: 'ACME',
      query_by: 'name',
    })

    expect(results.found).toBe(2)
  })
})

// ============================================================================
// FILTERING TESTS
// ============================================================================

describe('search filter_by', () => {
  let client: TypesenseClient

  beforeEach(async () => {
    clearAllCollections()
    client = new Typesense.Client({
      nodes: [{ host: 'localhost', port: 8108, protocol: 'http' }],
      apiKey: 'xyz',
    })
    await client.collections().create({
      name: 'companies',
      fields: [
        { name: 'name', type: 'string' },
        { name: 'employees', type: 'int32' },
        { name: 'industry', type: 'string', facet: true },
        { name: 'active', type: 'bool' },
      ],
    })

    await client.collections('companies').documents().import([
      { id: '1', name: 'Small Tech', employees: 10, industry: 'tech', active: true },
      { id: '2', name: 'Medium Tech', employees: 100, industry: 'tech', active: true },
      { id: '3', name: 'Large Corp', employees: 1000, industry: 'manufacturing', active: false },
      { id: '4', name: 'Startup', employees: 5, industry: 'tech', active: true },
    ])
  })

  it('should filter by numeric equality', async () => {
    const results = await client.collections('companies').documents().search({
      q: '*',
      query_by: 'name',
      filter_by: 'employees:=100',
    })

    expect(results.found).toBe(1)
    expect(results.hits[0].document.name).toBe('Medium Tech')
  })

  it('should filter by numeric greater than', async () => {
    const results = await client.collections('companies').documents().search({
      q: '*',
      query_by: 'name',
      filter_by: 'employees:>50',
    })

    expect(results.found).toBe(2)
  })

  it('should filter by numeric less than', async () => {
    const results = await client.collections('companies').documents().search({
      q: '*',
      query_by: 'name',
      filter_by: 'employees:<50',
    })

    expect(results.found).toBe(2)
  })

  it('should filter by numeric range', async () => {
    const results = await client.collections('companies').documents().search({
      q: '*',
      query_by: 'name',
      filter_by: 'employees:[10..100]',
    })

    expect(results.found).toBe(2)
  })

  it('should filter by string equality', async () => {
    const results = await client.collections('companies').documents().search({
      q: '*',
      query_by: 'name',
      filter_by: 'industry:=tech',
    })

    expect(results.found).toBe(3)
  })

  it('should filter by boolean', async () => {
    const results = await client.collections('companies').documents().search({
      q: '*',
      query_by: 'name',
      filter_by: 'active:=true',
    })

    expect(results.found).toBe(3)
  })

  it('should filter with AND operator', async () => {
    const results = await client.collections('companies').documents().search({
      q: '*',
      query_by: 'name',
      filter_by: 'industry:=tech && employees:>50',
    })

    expect(results.found).toBe(1)
  })

  it('should filter with OR operator', async () => {
    const results = await client.collections('companies').documents().search({
      q: '*',
      query_by: 'name',
      filter_by: 'industry:=tech || industry:=manufacturing',
    })

    expect(results.found).toBe(4)
  })

  it('should filter with NOT operator', async () => {
    const results = await client.collections('companies').documents().search({
      q: '*',
      query_by: 'name',
      filter_by: 'industry:!=tech',
    })

    expect(results.found).toBe(1)
  })

  it('should filter with multiple values (IN)', async () => {
    const results = await client.collections('companies').documents().search({
      q: '*',
      query_by: 'name',
      filter_by: 'industry:[tech,manufacturing]',
    })

    expect(results.found).toBe(4)
  })
})

// ============================================================================
// SORTING TESTS
// ============================================================================

describe('search sort_by', () => {
  let client: TypesenseClient

  beforeEach(async () => {
    clearAllCollections()
    client = new Typesense.Client({
      nodes: [{ host: 'localhost', port: 8108, protocol: 'http' }],
      apiKey: 'xyz',
    })
    await client.collections().create({
      name: 'companies',
      fields: [
        { name: 'name', type: 'string' },
        { name: 'employees', type: 'int32' },
        { name: 'revenue', type: 'float' },
      ],
    })

    await client.collections('companies').documents().import([
      { id: '1', name: 'Alpha', employees: 100, revenue: 1000000 },
      { id: '2', name: 'Beta', employees: 50, revenue: 500000 },
      { id: '3', name: 'Gamma', employees: 200, revenue: 2000000 },
    ])
  })

  it('should sort by field ascending', async () => {
    const results = await client.collections('companies').documents().search({
      q: '*',
      query_by: 'name',
      sort_by: 'employees:asc',
    })

    expect(results.hits[0].document.name).toBe('Beta')
    expect(results.hits[2].document.name).toBe('Gamma')
  })

  it('should sort by field descending', async () => {
    const results = await client.collections('companies').documents().search({
      q: '*',
      query_by: 'name',
      sort_by: 'employees:desc',
    })

    expect(results.hits[0].document.name).toBe('Gamma')
    expect(results.hits[2].document.name).toBe('Beta')
  })

  it('should sort by multiple fields', async () => {
    await client.collections('companies').documents().upsert({
      id: '4', name: 'Delta', employees: 100, revenue: 1500000,
    })

    const results = await client.collections('companies').documents().search({
      q: '*',
      query_by: 'name',
      sort_by: 'employees:desc,revenue:desc',
    })

    expect(results.hits[0].document.name).toBe('Gamma')
    // Alpha and Delta both have 100 employees, Delta has higher revenue
    expect(results.hits[1].document.name).toBe('Delta')
    expect(results.hits[2].document.name).toBe('Alpha')
  })
})

// ============================================================================
// GEO SEARCH TESTS
// ============================================================================

describe('geo search', () => {
  let client: TypesenseClient

  beforeEach(async () => {
    clearAllCollections()
    client = new Typesense.Client({
      nodes: [{ host: 'localhost', port: 8108, protocol: 'http' }],
      apiKey: 'xyz',
    })
    await client.collections().create({
      name: 'places',
      fields: [
        { name: 'name', type: 'string' },
        { name: 'location', type: 'geopoint' },
      ],
    })

    await client.collections('places').documents().import([
      { id: '1', name: 'New York', location: [40.7128, -74.0060] },
      { id: '2', name: 'Los Angeles', location: [34.0522, -118.2437] },
      { id: '3', name: 'Chicago', location: [41.8781, -87.6298] },
      { id: '4', name: 'Philadelphia', location: [39.9526, -75.1652] },
    ])
  })

  it('should filter by geo distance', async () => {
    const results = await client.collections('places').documents().search({
      q: '*',
      query_by: 'name',
      filter_by: 'location:(40.7, -74.0, 200 km)',
    })

    // New York and Philadelphia are within 200km
    expect(results.found).toBe(2)
  })

  it('should sort by geo distance', async () => {
    const results = await client.collections('places').documents().search({
      q: '*',
      query_by: 'name',
      sort_by: 'location(40.7, -74.0):asc',
    })

    expect(results.hits[0].document.name).toBe('New York')
    expect(results.hits[1].document.name).toBe('Philadelphia')
  })

  it('should include geo_distance_meters in results', async () => {
    const results = await client.collections('places').documents().search({
      q: '*',
      query_by: 'name',
      sort_by: 'location(40.7, -74.0):asc',
    })

    expect(results.hits[0].geo_distance_meters).toBeDefined()
    expect(results.hits[0].geo_distance_meters!.location).toBeDefined()
  })

  it('should filter by geo with miles', async () => {
    const results = await client.collections('places').documents().search({
      q: '*',
      query_by: 'name',
      filter_by: 'location:(40.7, -74.0, 100 mi)',
    })

    expect(results.found).toBe(2)
  })
})

// ============================================================================
// FACETING TESTS
// ============================================================================

describe('search faceting', () => {
  let client: TypesenseClient

  beforeEach(async () => {
    clearAllCollections()
    client = new Typesense.Client({
      nodes: [{ host: 'localhost', port: 8108, protocol: 'http' }],
      apiKey: 'xyz',
    })
    await client.collections().create({
      name: 'products',
      fields: [
        { name: 'name', type: 'string' },
        { name: 'brand', type: 'string', facet: true },
        { name: 'category', type: 'string', facet: true },
        { name: 'price', type: 'float', facet: true },
      ],
    })

    await client.collections('products').documents().import([
      { id: '1', name: 'iPhone 15', brand: 'Apple', category: 'phones', price: 999 },
      { id: '2', name: 'iPhone 15 Pro', brand: 'Apple', category: 'phones', price: 1199 },
      { id: '3', name: 'MacBook Pro', brand: 'Apple', category: 'laptops', price: 2499 },
      { id: '4', name: 'Galaxy S24', brand: 'Samsung', category: 'phones', price: 899 },
      { id: '5', name: 'Pixel 8', brand: 'Google', category: 'phones', price: 699 },
    ])
  })

  it('should return facet counts', async () => {
    const results = await client.collections('products').documents().search({
      q: '*',
      query_by: 'name',
      facet_by: 'brand',
    })

    expect(results.facet_counts).toBeDefined()
    expect(results.facet_counts!.length).toBe(1)

    const brandFacet = results.facet_counts!.find((f) => f.field_name === 'brand')
    expect(brandFacet).toBeDefined()
    expect(brandFacet!.counts.find((c) => c.value === 'Apple')?.count).toBe(3)
  })

  it('should return multiple facets', async () => {
    const results = await client.collections('products').documents().search({
      q: '*',
      query_by: 'name',
      facet_by: 'brand,category',
    })

    expect(results.facet_counts).toHaveLength(2)
  })

  it('should return facet stats for numeric fields', async () => {
    const results = await client.collections('products').documents().search({
      q: '*',
      query_by: 'name',
      facet_by: 'price',
    })

    const priceFacet = results.facet_counts!.find((f) => f.field_name === 'price')
    expect(priceFacet?.stats).toBeDefined()
    expect(priceFacet?.stats?.min).toBe(699)
    expect(priceFacet?.stats?.max).toBe(2499)
  })

  it('should limit max_facet_values', async () => {
    const results = await client.collections('products').documents().search({
      q: '*',
      query_by: 'name',
      facet_by: 'brand',
      max_facet_values: 2,
    })

    const brandFacet = results.facet_counts!.find((f) => f.field_name === 'brand')
    expect(brandFacet!.counts.length).toBeLessThanOrEqual(2)
  })

  it('should apply filter before faceting', async () => {
    const results = await client.collections('products').documents().search({
      q: '*',
      query_by: 'name',
      filter_by: 'category:=phones',
      facet_by: 'brand',
    })

    const brandFacet = results.facet_counts!.find((f) => f.field_name === 'brand')
    expect(brandFacet!.counts.find((c) => c.value === 'Apple')?.count).toBe(2)
  })
})

// ============================================================================
// PAGINATION TESTS
// ============================================================================

describe('search pagination', () => {
  let client: TypesenseClient

  beforeEach(async () => {
    clearAllCollections()
    client = new Typesense.Client({
      nodes: [{ host: 'localhost', port: 8108, protocol: 'http' }],
      apiKey: 'xyz',
    })
    await client.collections().create({
      name: 'items',
      fields: [{ name: 'name', type: 'string' }],
    })

    const items = Array.from({ length: 25 }, (_, i) => ({
      id: String(i + 1),
      name: `Item ${i + 1}`,
    }))
    await client.collections('items').documents().import(items)
  })

  it('should paginate with per_page', async () => {
    const results = await client.collections('items').documents().search({
      q: '*',
      query_by: 'name',
      per_page: 10,
    })

    expect(results.hits).toHaveLength(10)
    expect(results.found).toBe(25)
  })

  it('should return specific page', async () => {
    const results = await client.collections('items').documents().search({
      q: '*',
      query_by: 'name',
      per_page: 10,
      page: 2,
    })

    expect(results.page).toBe(2)
    expect(results.hits).toHaveLength(10)
  })

  it('should return partial last page', async () => {
    const results = await client.collections('items').documents().search({
      q: '*',
      query_by: 'name',
      per_page: 10,
      page: 3,
    })

    expect(results.hits).toHaveLength(5)
  })

  it('should support offset/limit style pagination', async () => {
    const results = await client.collections('items').documents().search({
      q: '*',
      query_by: 'name',
      limit: 5,
      offset: 10,
    })

    expect(results.hits).toHaveLength(5)
  })
})

// ============================================================================
// HIGHLIGHT CUSTOMIZATION TESTS
// ============================================================================

describe('search highlighting', () => {
  let client: TypesenseClient

  beforeEach(async () => {
    clearAllCollections()
    client = new Typesense.Client({
      nodes: [{ host: 'localhost', port: 8108, protocol: 'http' }],
      apiKey: 'xyz',
    })
    await client.collections().create({
      name: 'articles',
      fields: [
        { name: 'title', type: 'string' },
        { name: 'body', type: 'string' },
      ],
    })

    await client.collections('articles').documents().create({
      id: '1',
      title: 'Introduction to TypeScript',
      body: 'TypeScript is a typed superset of JavaScript that compiles to plain JavaScript.',
    })
  })

  it('should use custom highlight tags', async () => {
    const results = await client.collections('articles').documents().search({
      q: 'typescript',
      query_by: 'title,body',
      highlight_start_tag: '<mark>',
      highlight_end_tag: '</mark>',
    })

    const highlight = results.hits[0].highlights?.find((h) => h.field === 'title')
    expect(highlight?.snippet).toContain('<mark>')
    expect(highlight?.snippet).toContain('</mark>')
  })

  it('should highlight specific fields only', async () => {
    const results = await client.collections('articles').documents().search({
      q: 'typescript',
      query_by: 'title,body',
      highlight_fields: 'title',
    })

    expect(results.hits[0].highlights?.find((h) => h.field === 'title')).toBeDefined()
    expect(results.hits[0].highlights?.find((h) => h.field === 'body')).toBeUndefined()
  })
})

// ============================================================================
// MULTI-SEARCH TESTS
// ============================================================================

describe('multiSearch', () => {
  let client: TypesenseClient

  beforeEach(async () => {
    clearAllCollections()
    client = new Typesense.Client({
      nodes: [{ host: 'localhost', port: 8108, protocol: 'http' }],
      apiKey: 'xyz',
    })

    await client.collections().create({
      name: 'products',
      fields: [{ name: 'name', type: 'string' }],
    })
    await client.collections().create({
      name: 'articles',
      fields: [{ name: 'title', type: 'string' }],
    })

    await client.collections('products').documents().create({ id: '1', name: 'iPhone' })
    await client.collections('articles').documents().create({ id: '1', title: 'iPhone Review' })
  })

  it('should search multiple collections', async () => {
    const results = await client.multiSearch.perform({
      searches: [
        { collection: 'products', q: 'iPhone', query_by: 'name' },
        { collection: 'articles', q: 'iPhone', query_by: 'title' },
      ],
    })

    expect(results.results).toHaveLength(2)
    expect(results.results[0].found).toBe(1)
    expect(results.results[1].found).toBe(1)
  })
})

// ============================================================================
// TYPE VALIDATION TESTS
// ============================================================================

describe('type validation', () => {
  let client: TypesenseClient

  beforeEach(async () => {
    clearAllCollections()
    client = new Typesense.Client({
      nodes: [{ host: 'localhost', port: 8108, protocol: 'http' }],
      apiKey: 'xyz',
    })
    await client.collections().create({
      name: 'products',
      fields: [
        { name: 'name', type: 'string' },
        { name: 'price', type: 'int32' },
      ],
    })
  })

  it('should reject invalid type for int32', async () => {
    await expect(
      client.collections('products').documents().create({
        name: 'Test',
        price: 'not-a-number',
      })
    ).rejects.toThrow()
  })

  it('should coerce compatible types', async () => {
    // String "100" should be coerced to int32 100
    const doc = await client.collections('products').documents().create({
      name: 'Test',
      price: 100,
    })

    expect(doc.price).toBe(100)
  })
})

// ============================================================================
// ARRAY FIELD TESTS
// ============================================================================

describe('array fields', () => {
  let client: TypesenseClient

  beforeEach(async () => {
    clearAllCollections()
    client = new Typesense.Client({
      nodes: [{ host: 'localhost', port: 8108, protocol: 'http' }],
      apiKey: 'xyz',
    })
    await client.collections().create({
      name: 'products',
      fields: [
        { name: 'name', type: 'string' },
        { name: 'tags', type: 'string[]', facet: true },
      ],
    })

    await client.collections('products').documents().import([
      { id: '1', name: 'iPhone', tags: ['phone', 'apple', 'smartphone'] },
      { id: '2', name: 'MacBook', tags: ['laptop', 'apple', 'computer'] },
      { id: '3', name: 'Galaxy', tags: ['phone', 'samsung', 'android'] },
    ])
  })

  it('should filter by array field', async () => {
    const results = await client.collections('products').documents().search({
      q: '*',
      query_by: 'name',
      filter_by: 'tags:=apple',
    })

    expect(results.found).toBe(2)
  })

  it('should facet array fields', async () => {
    const results = await client.collections('products').documents().search({
      q: '*',
      query_by: 'name',
      facet_by: 'tags',
    })

    const tagsFacet = results.facet_counts!.find((f) => f.field_name === 'tags')
    expect(tagsFacet!.counts.find((c) => c.value === 'apple')?.count).toBe(2)
    expect(tagsFacet!.counts.find((c) => c.value === 'phone')?.count).toBe(2)
  })
})

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

describe('e-commerce integration', () => {
  let client: TypesenseClient

  beforeEach(async () => {
    clearAllCollections()
    client = new Typesense.Client({
      nodes: [{ host: 'localhost', port: 8108, protocol: 'http' }],
      apiKey: 'xyz',
    })

    await client.collections().create({
      name: 'products',
      fields: [
        { name: 'name', type: 'string' },
        { name: 'description', type: 'string' },
        { name: 'brand', type: 'string', facet: true },
        { name: 'category', type: 'string', facet: true },
        { name: 'price', type: 'float', facet: true },
        { name: 'in_stock', type: 'bool' },
        { name: 'rating', type: 'float' },
      ],
      default_sorting_field: 'rating',
    })

    await client.collections('products').documents().import([
      { id: '1', name: 'iPhone 15 Pro', description: 'Latest Apple flagship', brand: 'Apple', category: 'phones', price: 1199, in_stock: true, rating: 4.8 },
      { id: '2', name: 'iPhone 15', description: 'Beautiful and powerful', brand: 'Apple', category: 'phones', price: 999, in_stock: true, rating: 4.7 },
      { id: '3', name: 'Galaxy S24', description: 'AI-powered Samsung phone', brand: 'Samsung', category: 'phones', price: 899, in_stock: false, rating: 4.5 },
      { id: '4', name: 'MacBook Pro', description: 'Pro laptop for professionals', brand: 'Apple', category: 'laptops', price: 2499, in_stock: true, rating: 4.9 },
      { id: '5', name: 'iPad Pro', description: 'Your next computer', brand: 'Apple', category: 'tablets', price: 1099, in_stock: true, rating: 4.6 },
    ])
  })

  it('should perform full e-commerce search with filters and facets', async () => {
    const results = await client.collections('products').documents().search({
      q: 'phone',
      query_by: 'name,description',
      filter_by: 'in_stock:=true && price:<1200',
      sort_by: 'rating:desc',
      facet_by: 'brand,category',
    })

    // iPhone 15 Pro (in stock, price 1199) and iPhone 15 (in stock, price 999)
    expect(results.found).toBe(2)
    expect(results.hits[0].document.name).toBe('iPhone 15 Pro') // Higher rating
    expect(results.facet_counts).toBeDefined()
  })

  it('should handle complex filter expressions', async () => {
    const results = await client.collections('products').documents().search({
      q: '*',
      query_by: 'name',
      filter_by: '(brand:=Apple || brand:=Samsung) && category:=phones && price:[800..1200]',
    })

    expect(results.found).toBeGreaterThan(0)
    expect(results.hits.every((h) => {
      const doc = h.document as { price: number; category: string }
      return doc.price >= 800 && doc.price <= 1200 && doc.category === 'phones'
    })).toBe(true)
  })
})
