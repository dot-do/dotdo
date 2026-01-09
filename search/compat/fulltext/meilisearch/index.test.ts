/**
 * @dotdo/meilisearch - Meilisearch SDK compat tests
 *
 * Tests for Meilisearch API compatibility backed by DO SQLite FTS5:
 * - Client creation
 * - Index management (create, get, delete, list)
 * - Document CRUD (add, get, update, delete)
 * - Search with query string
 * - Filtering and faceting
 * - Settings (searchable, filterable, sortable)
 * - Pagination (limit, offset)
 * - Task status tracking
 *
 * RED PHASE: All tests should fail initially
 *
 * @see https://www.meilisearch.com/docs/reference/api/overview
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { MeiliSearch, clearAllIndices } from './meilisearch'
import type { MeiliSearchClient, Index, SearchResponse, Task, EnqueuedTask } from './types'
import { MeiliSearchError, DocumentNotFoundError, IndexNotFoundError } from './types'

// ============================================================================
// CLIENT CREATION TESTS
// ============================================================================

describe('MeiliSearch client', () => {
  let client: MeiliSearchClient

  beforeEach(() => {
    clearAllIndices()
    client = new MeiliSearch({ host: 'http://127.0.0.1:7700' })
  })

  it('should create a client with host', () => {
    expect(client).toBeDefined()
    expect(client.config.host).toBe('http://127.0.0.1:7700')
  })

  it('should create a client with API key', () => {
    const clientWithKey = new MeiliSearch({
      host: 'http://127.0.0.1:7700',
      apiKey: 'test-api-key',
    })
    expect(clientWithKey.config.apiKey).toBe('test-api-key')
  })

  it('should get health status', async () => {
    const health = await client.health()
    expect(health.status).toBe('available')
  })

  it('should check if server is healthy', async () => {
    const isHealthy = await client.isHealthy()
    expect(isHealthy).toBe(true)
  })

  it('should get version info', async () => {
    const version = await client.getVersion()
    expect(version.pkgVersion).toBeDefined()
    expect(version.indexCount).toBeDefined()
  })

  it('should get stats', async () => {
    const stats = await client.getStats()
    expect(stats.databaseSize).toBeDefined()
    expect(stats.indexes).toBeDefined()
  })
})

// ============================================================================
// INDEX MANAGEMENT TESTS
// ============================================================================

describe('index management', () => {
  let client: MeiliSearchClient

  beforeEach(() => {
    clearAllIndices()
    client = new MeiliSearch({ host: 'http://127.0.0.1:7700' })
  })

  describe('createIndex', () => {
    it('should create an index with uid', async () => {
      const task = await client.createIndex('movies')
      expect(task.taskUid).toBeDefined()
      expect(task.indexUid).toBe('movies')
      expect(task.type).toBe('indexCreation')
      expect(task.status).toBe('enqueued')
    })

    it('should create an index with primary key', async () => {
      const task = await client.createIndex('movies', { primaryKey: 'id' })
      expect(task.indexUid).toBe('movies')

      // Wait for task to complete
      await client.waitForTask(task.taskUid)

      const index = client.index('movies')
      const rawIndex = await index.getRawInfo()
      expect(rawIndex.primaryKey).toBe('id')
    })

    it('should fail to create duplicate index', async () => {
      await client.createIndex('movies')
      await client.waitForTask((await client.createIndex('movies')).taskUid)

      // Second creation should fail
      const task = await client.createIndex('movies')
      const taskResult = await client.waitForTask(task.taskUid)
      expect(taskResult.status).toBe('failed')
    })
  })

  describe('getIndex', () => {
    it('should get an existing index', async () => {
      const createTask = await client.createIndex('movies', { primaryKey: 'id' })
      await client.waitForTask(createTask.taskUid)

      const index = await client.getIndex('movies')
      expect(index.uid).toBe('movies')
      expect(index.primaryKey).toBe('id')
    })

    it('should throw IndexNotFoundError for non-existent index', async () => {
      await expect(client.getIndex('non-existent')).rejects.toThrow(IndexNotFoundError)
    })
  })

  describe('getIndexes', () => {
    it('should list all indexes', async () => {
      await client.createIndex('movies')
      await client.createIndex('books')
      await client.waitForTask((await client.createIndex('movies')).taskUid)
      await client.waitForTask((await client.createIndex('books')).taskUid)

      const response = await client.getIndexes()
      expect(response.results).toBeDefined()
      expect(response.results.length).toBeGreaterThanOrEqual(2)
    })

    it('should paginate indexes', async () => {
      const response = await client.getIndexes({ limit: 1, offset: 0 })
      expect(response.limit).toBe(1)
      expect(response.offset).toBe(0)
    })
  })

  describe('deleteIndex', () => {
    it('should delete an existing index', async () => {
      const createTask = await client.createIndex('movies')
      await client.waitForTask(createTask.taskUid)

      const deleteTask = await client.deleteIndex('movies')
      expect(deleteTask.type).toBe('indexDeletion')

      await client.waitForTask(deleteTask.taskUid)
      await expect(client.getIndex('movies')).rejects.toThrow(IndexNotFoundError)
    })
  })

  describe('updateIndex', () => {
    it('should update index primary key', async () => {
      const createTask = await client.createIndex('movies')
      await client.waitForTask(createTask.taskUid)

      const updateTask = await client.updateIndex('movies', { primaryKey: 'movie_id' })
      await client.waitForTask(updateTask.taskUid)

      const index = await client.getIndex('movies')
      expect(index.primaryKey).toBe('movie_id')
    })
  })

  describe('index()', () => {
    it('should get index reference without verifying existence', () => {
      const index = client.index('movies')
      expect(index).toBeDefined()
      expect(index.uid).toBe('movies')
    })
  })
})

// ============================================================================
// DOCUMENT CRUD TESTS
// ============================================================================

describe('document operations', () => {
  let client: MeiliSearchClient
  let index: Index

  beforeEach(async () => {
    clearAllIndices()
    client = new MeiliSearch({ host: 'http://127.0.0.1:7700' })
    const task = await client.createIndex('movies', { primaryKey: 'id' })
    await client.waitForTask(task.taskUid)
    index = client.index('movies')
  })

  describe('addDocuments', () => {
    it('should add a single document', async () => {
      const task = await index.addDocuments([
        { id: 1, title: 'The Matrix', genre: 'sci-fi' }
      ])

      expect(task.taskUid).toBeDefined()
      expect(task.type).toBe('documentAdditionOrUpdate')

      await client.waitForTask(task.taskUid)

      const doc = await index.getDocument(1)
      expect(doc.title).toBe('The Matrix')
    })

    it('should add multiple documents', async () => {
      const task = await index.addDocuments([
        { id: 1, title: 'The Matrix', genre: 'sci-fi' },
        { id: 2, title: 'Inception', genre: 'sci-fi' },
        { id: 3, title: 'The Godfather', genre: 'crime' },
      ])

      await client.waitForTask(task.taskUid)

      const docs = await index.getDocuments()
      expect(docs.results).toHaveLength(3)
    })

    it('should add documents with auto-detected primary key', async () => {
      const newIndex = client.index('books')
      await client.createIndex('books')

      const task = await newIndex.addDocuments([
        { id: 1, title: 'Book 1' },
      ])

      await client.waitForTask(task.taskUid)

      const rawIndex = await newIndex.getRawInfo()
      expect(rawIndex.primaryKey).toBe('id')
    })

    it('should add documents in batches', async () => {
      const docs = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        title: `Movie ${i + 1}`,
      }))

      const tasks = await index.addDocumentsInBatches(docs, 25)
      expect(tasks).toHaveLength(4)

      for (const task of tasks) {
        await client.waitForTask(task.taskUid)
      }

      const allDocs = await index.getDocuments({ limit: 200 })
      expect(allDocs.results).toHaveLength(100)
    })
  })

  describe('getDocument', () => {
    beforeEach(async () => {
      const task = await index.addDocuments([
        { id: 1, title: 'The Matrix', genre: 'sci-fi', year: 1999 },
      ])
      await client.waitForTask(task.taskUid)
    })

    it('should get a document by id', async () => {
      const doc = await index.getDocument(1)
      expect(doc.id).toBe(1)
      expect(doc.title).toBe('The Matrix')
    })

    it('should get a document with specific fields', async () => {
      const doc = await index.getDocument(1, { fields: ['title', 'year'] })
      expect(doc.title).toBe('The Matrix')
      expect(doc.year).toBe(1999)
      expect(doc.genre).toBeUndefined()
    })

    it('should throw DocumentNotFoundError for missing document', async () => {
      await expect(index.getDocument(999)).rejects.toThrow(DocumentNotFoundError)
    })
  })

  describe('getDocuments', () => {
    beforeEach(async () => {
      const task = await index.addDocuments([
        { id: 1, title: 'The Matrix', genre: 'sci-fi' },
        { id: 2, title: 'Inception', genre: 'sci-fi' },
        { id: 3, title: 'The Godfather', genre: 'crime' },
      ])
      await client.waitForTask(task.taskUid)
    })

    it('should get all documents', async () => {
      const response = await index.getDocuments()
      expect(response.results).toHaveLength(3)
      expect(response.total).toBe(3)
    })

    it('should paginate documents with limit', async () => {
      const response = await index.getDocuments({ limit: 2 })
      expect(response.results).toHaveLength(2)
      expect(response.limit).toBe(2)
    })

    it('should paginate documents with offset', async () => {
      const response = await index.getDocuments({ offset: 1, limit: 10 })
      expect(response.results).toHaveLength(2)
      expect(response.offset).toBe(1)
    })

    it('should retrieve specific fields', async () => {
      const response = await index.getDocuments({ fields: ['title'] })
      expect(response.results[0].title).toBeDefined()
      expect(response.results[0].genre).toBeUndefined()
    })

    it('should filter documents', async () => {
      await index.updateSettings({ filterableAttributes: ['genre'] })

      const response = await index.getDocuments({ filter: 'genre = sci-fi' })
      expect(response.results).toHaveLength(2)
    })
  })

  describe('updateDocuments', () => {
    beforeEach(async () => {
      const task = await index.addDocuments([
        { id: 1, title: 'The Matrix', year: 1999 },
      ])
      await client.waitForTask(task.taskUid)
    })

    it('should update existing documents', async () => {
      const task = await index.updateDocuments([
        { id: 1, year: 2000 },
      ])
      await client.waitForTask(task.taskUid)

      const doc = await index.getDocument(1)
      expect(doc.title).toBe('The Matrix')
      expect(doc.year).toBe(2000)
    })

    it('should create document if it does not exist', async () => {
      const task = await index.updateDocuments([
        { id: 2, title: 'Inception', year: 2010 },
      ])
      await client.waitForTask(task.taskUid)

      const doc = await index.getDocument(2)
      expect(doc.title).toBe('Inception')
    })
  })

  describe('deleteDocument', () => {
    beforeEach(async () => {
      const task = await index.addDocuments([
        { id: 1, title: 'The Matrix' },
        { id: 2, title: 'Inception' },
      ])
      await client.waitForTask(task.taskUid)
    })

    it('should delete a single document', async () => {
      const task = await index.deleteDocument(1)
      expect(task.type).toBe('documentDeletion')

      await client.waitForTask(task.taskUid)

      await expect(index.getDocument(1)).rejects.toThrow(DocumentNotFoundError)
    })
  })

  describe('deleteDocuments', () => {
    beforeEach(async () => {
      const task = await index.addDocuments([
        { id: 1, title: 'The Matrix' },
        { id: 2, title: 'Inception' },
        { id: 3, title: 'The Godfather' },
      ])
      await client.waitForTask(task.taskUid)
    })

    it('should delete multiple documents by ids', async () => {
      const task = await index.deleteDocuments([1, 3])
      await client.waitForTask(task.taskUid)

      const docs = await index.getDocuments()
      expect(docs.results).toHaveLength(1)
      expect(docs.results[0].id).toBe(2)
    })

    it('should delete documents by filter', async () => {
      await index.updateSettings({ filterableAttributes: ['genre'] })

      const addTask = await index.addDocuments([
        { id: 1, title: 'The Matrix', genre: 'sci-fi' },
        { id: 2, title: 'Inception', genre: 'sci-fi' },
        { id: 3, title: 'The Godfather', genre: 'crime' },
      ])
      await client.waitForTask(addTask.taskUid)

      const task = await index.deleteDocuments({ filter: 'genre = sci-fi' })
      await client.waitForTask(task.taskUid)

      const docs = await index.getDocuments()
      expect(docs.results).toHaveLength(1)
      expect(docs.results[0].genre).toBe('crime')
    })
  })

  describe('deleteAllDocuments', () => {
    beforeEach(async () => {
      const task = await index.addDocuments([
        { id: 1, title: 'The Matrix' },
        { id: 2, title: 'Inception' },
      ])
      await client.waitForTask(task.taskUid)
    })

    it('should delete all documents', async () => {
      const task = await index.deleteAllDocuments()
      expect(task.type).toBe('documentDeletion')

      await client.waitForTask(task.taskUid)

      const docs = await index.getDocuments()
      expect(docs.results).toHaveLength(0)
    })
  })
})

// ============================================================================
// SEARCH TESTS
// ============================================================================

describe('search', () => {
  let client: MeiliSearchClient
  let index: Index

  beforeEach(async () => {
    clearAllIndices()
    client = new MeiliSearch({ host: 'http://127.0.0.1:7700' })
    const task = await client.createIndex('movies', { primaryKey: 'id' })
    await client.waitForTask(task.taskUid)
    index = client.index('movies')

    const addTask = await index.addDocuments([
      { id: 1, title: 'The Matrix', genre: 'sci-fi', year: 1999, rating: 8.7 },
      { id: 2, title: 'The Matrix Reloaded', genre: 'sci-fi', year: 2003, rating: 7.2 },
      { id: 3, title: 'Inception', genre: 'sci-fi', year: 2010, rating: 8.8 },
      { id: 4, title: 'The Godfather', genre: 'crime', year: 1972, rating: 9.2 },
      { id: 5, title: 'Pulp Fiction', genre: 'crime', year: 1994, rating: 8.9 },
    ])
    await client.waitForTask(addTask.taskUid)
  })

  describe('basic search', () => {
    it('should search with empty query (returns all)', async () => {
      const response = await index.search('')
      expect(response.hits.length).toBe(5)
      expect(response.query).toBe('')
    })

    it('should search by query string', async () => {
      const response = await index.search('matrix')
      expect(response.hits.length).toBe(2)
      expect(response.query).toBe('matrix')
    })

    it('should return case-insensitive results', async () => {
      const response = await index.search('MATRIX')
      expect(response.hits.length).toBe(2)
    })

    it('should support typo tolerance', async () => {
      const response = await index.search('matix') // typo
      expect(response.hits.length).toBeGreaterThan(0)
    })

    it('should return search metadata', async () => {
      const response = await index.search('matrix')
      expect(response.processingTimeMs).toBeDefined()
      expect(response.estimatedTotalHits).toBeDefined()
    })
  })

  describe('pagination', () => {
    it('should limit results', async () => {
      const response = await index.search('', { limit: 2 })
      expect(response.hits.length).toBe(2)
      expect(response.limit).toBe(2)
    })

    it('should offset results', async () => {
      const response = await index.search('', { offset: 2, limit: 10 })
      expect(response.hits.length).toBe(3)
      expect(response.offset).toBe(2)
    })

    it('should paginate with page/hitsPerPage', async () => {
      const response = await index.search('', { page: 2, hitsPerPage: 2 })
      expect(response.hitsPerPage).toBe(2)
      expect(response.page).toBe(2)
      expect(response.totalPages).toBe(3)
      expect(response.totalHits).toBe(5)
    })
  })

  describe('attributesToRetrieve', () => {
    it('should retrieve specific attributes', async () => {
      const response = await index.search('matrix', {
        attributesToRetrieve: ['title', 'year'],
      })

      expect(response.hits[0].title).toBeDefined()
      expect(response.hits[0].year).toBeDefined()
      expect(response.hits[0].genre).toBeUndefined()
    })

    it('should retrieve all attributes with *', async () => {
      const response = await index.search('matrix', {
        attributesToRetrieve: ['*'],
      })

      expect(response.hits[0].title).toBeDefined()
      expect(response.hits[0].genre).toBeDefined()
      expect(response.hits[0].year).toBeDefined()
    })
  })

  describe('filtering', () => {
    beforeEach(async () => {
      await index.updateSettings({
        filterableAttributes: ['genre', 'year', 'rating'],
      })
    })

    it('should filter by equality', async () => {
      const response = await index.search('', {
        filter: 'genre = sci-fi',
      })
      expect(response.hits.length).toBe(3)
      expect(response.hits.every((h: { genre: string }) => h.genre === 'sci-fi')).toBe(true)
    })

    it('should filter by string with quotes', async () => {
      const response = await index.search('', {
        filter: 'genre = "sci-fi"',
      })
      expect(response.hits.length).toBe(3)
    })

    it('should filter by numeric comparison >', async () => {
      const response = await index.search('', {
        filter: 'year > 2000',
      })
      expect(response.hits.length).toBe(2)
      expect(response.hits.every((h: { year: number }) => h.year > 2000)).toBe(true)
    })

    it('should filter by numeric comparison >=', async () => {
      const response = await index.search('', {
        filter: 'rating >= 8.8',
      })
      expect(response.hits.length).toBe(3)
    })

    it('should filter by numeric comparison <', async () => {
      const response = await index.search('', {
        filter: 'year < 1999',
      })
      expect(response.hits.length).toBe(2)
    })

    it('should filter by numeric comparison <=', async () => {
      const response = await index.search('', {
        filter: 'year <= 1999',
      })
      expect(response.hits.length).toBe(3)
    })

    it('should filter by inequality !=', async () => {
      const response = await index.search('', {
        filter: 'genre != sci-fi',
      })
      expect(response.hits.length).toBe(2)
    })

    it('should filter with AND', async () => {
      const response = await index.search('', {
        filter: 'genre = sci-fi AND year > 2000',
      })
      expect(response.hits.length).toBe(2)
    })

    it('should filter with OR', async () => {
      const response = await index.search('', {
        filter: 'year = 1999 OR year = 2010',
      })
      expect(response.hits.length).toBe(2)
    })

    it('should filter with NOT', async () => {
      const response = await index.search('', {
        filter: 'NOT genre = sci-fi',
      })
      expect(response.hits.length).toBe(2)
    })

    it('should filter with parentheses', async () => {
      const response = await index.search('', {
        filter: '(genre = sci-fi OR genre = crime) AND year > 1990',
      })
      expect(response.hits.length).toBe(4)
    })

    it('should filter with array syntax', async () => {
      const response = await index.search('', {
        filter: ['genre = sci-fi', 'year > 2000'],
      })
      expect(response.hits.length).toBe(2)
    })

    it('should filter with nested array syntax (OR within AND)', async () => {
      const response = await index.search('', {
        filter: [['genre = sci-fi', 'genre = crime'], 'year > 1990'],
      })
      expect(response.hits.length).toBe(4)
    })

    it('should filter with IN operator', async () => {
      const response = await index.search('', {
        filter: 'year IN [1999, 2010]',
      })
      expect(response.hits.length).toBe(2)
    })

    it('should filter with TO range', async () => {
      const response = await index.search('', {
        filter: 'year 1990 TO 2000',
      })
      expect(response.hits.length).toBe(2)
    })

    it('should filter with EXISTS', async () => {
      const response = await index.search('', {
        filter: 'rating EXISTS',
      })
      expect(response.hits.length).toBe(5)
    })

    it('should filter with IS NULL', async () => {
      // Add a document without rating
      await index.addDocuments([{ id: 6, title: 'No Rating Movie', genre: 'drama' }])

      const response = await index.search('', {
        filter: 'rating IS NULL',
      })
      expect(response.hits.some((h: { id: number }) => h.id === 6)).toBe(true)
    })
  })

  describe('faceting', () => {
    beforeEach(async () => {
      await index.updateSettings({
        filterableAttributes: ['genre', 'year'],
      })
    })

    it('should return facet distribution', async () => {
      const response = await index.search('', {
        facets: ['genre'],
      })

      expect(response.facetDistribution).toBeDefined()
      expect(response.facetDistribution!.genre).toBeDefined()
      expect(response.facetDistribution!.genre['sci-fi']).toBe(3)
      expect(response.facetDistribution!.genre['crime']).toBe(2)
    })

    it('should return multiple facets', async () => {
      const response = await index.search('', {
        facets: ['genre', 'year'],
      })

      expect(response.facetDistribution!.genre).toBeDefined()
      expect(response.facetDistribution!.year).toBeDefined()
    })

    it('should return facet stats for numeric facets', async () => {
      const response = await index.search('', {
        facets: ['year'],
      })

      expect(response.facetStats).toBeDefined()
      expect(response.facetStats!.year.min).toBe(1972)
      expect(response.facetStats!.year.max).toBe(2010)
    })

    it('should return filtered facet distribution', async () => {
      const response = await index.search('', {
        filter: 'genre = sci-fi',
        facets: ['year'],
      })

      expect(response.facetDistribution!.year).toBeDefined()
      // Should only include years from sci-fi movies
      expect(Object.keys(response.facetDistribution!.year)).toHaveLength(3)
    })
  })

  describe('sorting', () => {
    beforeEach(async () => {
      await index.updateSettings({
        sortableAttributes: ['year', 'rating', 'title'],
      })
    })

    it('should sort by single attribute ascending', async () => {
      const response = await index.search('', {
        sort: ['year:asc'],
      })

      const years = response.hits.map((h: { year: number }) => h.year)
      expect(years).toEqual([...years].sort((a, b) => a - b))
    })

    it('should sort by single attribute descending', async () => {
      const response = await index.search('', {
        sort: ['year:desc'],
      })

      const years = response.hits.map((h: { year: number }) => h.year)
      expect(years).toEqual([...years].sort((a, b) => b - a))
    })

    it('should sort by multiple attributes', async () => {
      const response = await index.search('', {
        sort: ['genre:asc', 'year:desc'],
      })

      expect(response.hits[0].genre).toBe('crime')
    })
  })

  describe('highlighting', () => {
    it('should highlight matching terms', async () => {
      const response = await index.search('matrix', {
        attributesToHighlight: ['title'],
      })

      expect(response.hits[0]._formatted).toBeDefined()
      expect(response.hits[0]._formatted.title).toContain('<em>')
      expect(response.hits[0]._formatted.title).toContain('</em>')
    })

    it('should use custom highlight tags', async () => {
      const response = await index.search('matrix', {
        attributesToHighlight: ['title'],
        highlightPreTag: '<mark>',
        highlightPostTag: '</mark>',
      })

      expect(response.hits[0]._formatted.title).toContain('<mark>')
      expect(response.hits[0]._formatted.title).toContain('</mark>')
    })

    it('should highlight all attributes with *', async () => {
      const response = await index.search('sci-fi', {
        attributesToHighlight: ['*'],
      })

      const formatted = response.hits.find((h: { _formatted: { genre: string } }) =>
        h._formatted.genre.includes('<em>')
      )
      expect(formatted).toBeDefined()
    })
  })

  describe('cropping', () => {
    beforeEach(async () => {
      await index.addDocuments([
        {
          id: 10,
          title: 'Long Description Movie',
          description: 'This is a very long description that contains many words and should be cropped when searching for specific terms like Matrix in the middle of the text.',
        },
      ])
    })

    it('should crop long attributes', async () => {
      const response = await index.search('Matrix', {
        attributesToCrop: ['description'],
        cropLength: 10,
      })

      const hit = response.hits.find((h: { id: number }) => h.id === 10)
      if (hit) {
        expect(hit._formatted.description.length).toBeLessThan(100)
      }
    })

    it('should use custom crop marker', async () => {
      const response = await index.search('Matrix', {
        attributesToCrop: ['description'],
        cropLength: 10,
        cropMarker: '...',
      })

      const hit = response.hits.find((h: { id: number }) => h.id === 10)
      if (hit) {
        expect(hit._formatted.description).toContain('...')
      }
    })
  })

  describe('showMatchesPosition', () => {
    it('should return match positions', async () => {
      const response = await index.search('matrix', {
        showMatchesPosition: true,
      })

      expect(response.hits[0]._matchesPosition).toBeDefined()
      expect(response.hits[0]._matchesPosition.title).toBeDefined()
    })
  })

  describe('showRankingScore', () => {
    it('should return ranking score', async () => {
      const response = await index.search('matrix', {
        showRankingScore: true,
      })

      expect(response.hits[0]._rankingScore).toBeDefined()
      expect(typeof response.hits[0]._rankingScore).toBe('number')
    })
  })

  describe('matchingStrategy', () => {
    it('should use ALL matching strategy', async () => {
      const response = await index.search('matrix reloaded', {
        matchingStrategy: 'all',
      })

      expect(response.hits.length).toBe(1)
      expect(response.hits[0].title).toBe('The Matrix Reloaded')
    })

    it('should use LAST matching strategy (default)', async () => {
      const response = await index.search('matrix reloaded', {
        matchingStrategy: 'last',
      })

      expect(response.hits.length).toBeGreaterThanOrEqual(1)
    })
  })
})

// ============================================================================
// SETTINGS TESTS
// ============================================================================

describe('settings', () => {
  let client: MeiliSearchClient
  let index: Index

  beforeEach(async () => {
    clearAllIndices()
    client = new MeiliSearch({ host: 'http://127.0.0.1:7700' })
    const task = await client.createIndex('movies', { primaryKey: 'id' })
    await client.waitForTask(task.taskUid)
    index = client.index('movies')
  })

  describe('getSettings', () => {
    it('should get all settings', async () => {
      const settings = await index.getSettings()

      expect(settings.searchableAttributes).toBeDefined()
      expect(settings.filterableAttributes).toBeDefined()
      expect(settings.sortableAttributes).toBeDefined()
      expect(settings.displayedAttributes).toBeDefined()
      expect(settings.rankingRules).toBeDefined()
      expect(settings.stopWords).toBeDefined()
      expect(settings.synonyms).toBeDefined()
      expect(settings.distinctAttribute).toBeDefined()
      expect(settings.typoTolerance).toBeDefined()
      expect(settings.pagination).toBeDefined()
    })
  })

  describe('updateSettings', () => {
    it('should update searchable attributes', async () => {
      const task = await index.updateSettings({
        searchableAttributes: ['title', 'description'],
      })
      await client.waitForTask(task.taskUid)

      const settings = await index.getSettings()
      expect(settings.searchableAttributes).toEqual(['title', 'description'])
    })

    it('should update filterable attributes', async () => {
      const task = await index.updateSettings({
        filterableAttributes: ['genre', 'year'],
      })
      await client.waitForTask(task.taskUid)

      const settings = await index.getSettings()
      expect(settings.filterableAttributes).toContain('genre')
      expect(settings.filterableAttributes).toContain('year')
    })

    it('should update sortable attributes', async () => {
      const task = await index.updateSettings({
        sortableAttributes: ['year', 'rating'],
      })
      await client.waitForTask(task.taskUid)

      const settings = await index.getSettings()
      expect(settings.sortableAttributes).toContain('year')
      expect(settings.sortableAttributes).toContain('rating')
    })

    it('should update displayed attributes', async () => {
      const task = await index.updateSettings({
        displayedAttributes: ['title', 'year'],
      })
      await client.waitForTask(task.taskUid)

      const settings = await index.getSettings()
      expect(settings.displayedAttributes).toEqual(['title', 'year'])
    })

    it('should update ranking rules', async () => {
      const task = await index.updateSettings({
        rankingRules: ['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness'],
      })
      await client.waitForTask(task.taskUid)

      const settings = await index.getSettings()
      expect(settings.rankingRules).toEqual(['words', 'typo', 'proximity', 'attribute', 'sort', 'exactness'])
    })

    it('should update stop words', async () => {
      const task = await index.updateSettings({
        stopWords: ['the', 'a', 'an'],
      })
      await client.waitForTask(task.taskUid)

      const settings = await index.getSettings()
      expect(settings.stopWords).toContain('the')
    })

    it('should update synonyms', async () => {
      const task = await index.updateSettings({
        synonyms: {
          'movie': ['film', 'picture'],
          'sci-fi': ['science fiction'],
        },
      })
      await client.waitForTask(task.taskUid)

      const settings = await index.getSettings()
      expect(settings.synonyms?.movie).toContain('film')
    })

    it('should update distinct attribute', async () => {
      const task = await index.updateSettings({
        distinctAttribute: 'genre',
      })
      await client.waitForTask(task.taskUid)

      const settings = await index.getSettings()
      expect(settings.distinctAttribute).toBe('genre')
    })

    it('should update typo tolerance settings', async () => {
      const task = await index.updateSettings({
        typoTolerance: {
          enabled: true,
          minWordSizeForTypos: {
            oneTypo: 5,
            twoTypos: 9,
          },
          disableOnWords: ['matrix'],
          disableOnAttributes: ['id'],
        },
      })
      await client.waitForTask(task.taskUid)

      const settings = await index.getSettings()
      expect(settings.typoTolerance?.enabled).toBe(true)
      expect(settings.typoTolerance?.minWordSizeForTypos?.oneTypo).toBe(5)
    })

    it('should update pagination settings', async () => {
      const task = await index.updateSettings({
        pagination: {
          maxTotalHits: 500,
        },
      })
      await client.waitForTask(task.taskUid)

      const settings = await index.getSettings()
      expect(settings.pagination?.maxTotalHits).toBe(500)
    })

    it('should update faceting settings', async () => {
      const task = await index.updateSettings({
        faceting: {
          maxValuesPerFacet: 50,
        },
      })
      await client.waitForTask(task.taskUid)

      const settings = await index.getSettings()
      expect(settings.faceting?.maxValuesPerFacet).toBe(50)
    })
  })

  describe('resetSettings', () => {
    it('should reset all settings to default', async () => {
      await index.updateSettings({
        searchableAttributes: ['title'],
        filterableAttributes: ['genre'],
      })

      const task = await index.resetSettings()
      await client.waitForTask(task.taskUid)

      const settings = await index.getSettings()
      expect(settings.searchableAttributes).toEqual(['*'])
    })
  })

  describe('individual settings methods', () => {
    it('should get/update/reset searchable attributes', async () => {
      const updateTask = await index.updateSearchableAttributes(['title', 'description'])
      await client.waitForTask(updateTask.taskUid)

      const searchableAttrs = await index.getSearchableAttributes()
      expect(searchableAttrs).toEqual(['title', 'description'])

      const resetTask = await index.resetSearchableAttributes()
      await client.waitForTask(resetTask.taskUid)

      const defaultAttrs = await index.getSearchableAttributes()
      expect(defaultAttrs).toEqual(['*'])
    })

    it('should get/update/reset filterable attributes', async () => {
      const updateTask = await index.updateFilterableAttributes(['genre', 'year'])
      await client.waitForTask(updateTask.taskUid)

      const filterableAttrs = await index.getFilterableAttributes()
      expect(filterableAttrs).toContain('genre')

      const resetTask = await index.resetFilterableAttributes()
      await client.waitForTask(resetTask.taskUid)

      const defaultAttrs = await index.getFilterableAttributes()
      expect(defaultAttrs).toEqual([])
    })

    it('should get/update/reset sortable attributes', async () => {
      const updateTask = await index.updateSortableAttributes(['year', 'rating'])
      await client.waitForTask(updateTask.taskUid)

      const sortableAttrs = await index.getSortableAttributes()
      expect(sortableAttrs).toContain('year')

      const resetTask = await index.resetSortableAttributes()
      await client.waitForTask(resetTask.taskUid)

      const defaultAttrs = await index.getSortableAttributes()
      expect(defaultAttrs).toEqual([])
    })
  })
})

// ============================================================================
// TASK MANAGEMENT TESTS
// ============================================================================

describe('tasks', () => {
  let client: MeiliSearchClient

  beforeEach(() => {
    clearAllIndices()
    client = new MeiliSearch({ host: 'http://127.0.0.1:7700' })
  })

  describe('getTask', () => {
    it('should get task by uid', async () => {
      const createTask = await client.createIndex('movies')
      const task = await client.getTask(createTask.taskUid)

      expect(task.uid).toBe(createTask.taskUid)
      expect(task.type).toBe('indexCreation')
      expect(task.status).toBeDefined()
    })
  })

  describe('getTasks', () => {
    it('should get all tasks', async () => {
      await client.createIndex('movies')
      await client.createIndex('books')

      const response = await client.getTasks()

      expect(response.results).toBeDefined()
      expect(response.results.length).toBeGreaterThanOrEqual(2)
    })

    it('should filter tasks by status', async () => {
      const response = await client.getTasks({
        statuses: ['succeeded'],
      })

      expect(response.results.every((t) => t.status === 'succeeded')).toBe(true)
    })

    it('should filter tasks by type', async () => {
      const response = await client.getTasks({
        types: ['indexCreation'],
      })

      expect(response.results.every((t) => t.type === 'indexCreation')).toBe(true)
    })

    it('should filter tasks by indexUids', async () => {
      const response = await client.getTasks({
        indexUids: ['movies'],
      })

      expect(response.results.every((t) => t.indexUid === 'movies')).toBe(true)
    })

    it('should paginate tasks', async () => {
      const response = await client.getTasks({
        limit: 5,
        from: 0,
      })

      expect(response.limit).toBe(5)
    })
  })

  describe('waitForTask', () => {
    it('should wait for task completion', async () => {
      const createTask = await client.createIndex('movies')
      const completedTask = await client.waitForTask(createTask.taskUid)

      expect(['succeeded', 'failed']).toContain(completedTask.status)
    })

    it('should respect timeout', async () => {
      const createTask = await client.createIndex('movies')

      await expect(
        client.waitForTask(createTask.taskUid, { timeOutMs: 1 })
      ).rejects.toThrow()
    })
  })

  describe('waitForTasks', () => {
    it('should wait for multiple tasks', async () => {
      const task1 = await client.createIndex('movies')
      const task2 = await client.createIndex('books')

      const completedTasks = await client.waitForTasks([task1.taskUid, task2.taskUid])

      expect(completedTasks).toHaveLength(2)
      expect(completedTasks.every((t) => ['succeeded', 'failed'].includes(t.status))).toBe(true)
    })
  })

  describe('cancelTasks', () => {
    it('should cancel tasks by filter', async () => {
      // Create a task
      await client.createIndex('movies')

      const cancelTask = await client.cancelTasks({
        statuses: ['enqueued'],
      })

      expect(cancelTask.type).toBe('taskCancelation')
    })
  })

  describe('deleteTasks', () => {
    it('should delete tasks by filter', async () => {
      const createTask = await client.createIndex('movies')
      await client.waitForTask(createTask.taskUid)

      const deleteTask = await client.deleteTasks({
        statuses: ['succeeded'],
      })

      expect(deleteTask.type).toBe('taskDeletion')
    })
  })
})

// ============================================================================
// KEYS MANAGEMENT TESTS
// ============================================================================

describe('keys', () => {
  let client: MeiliSearchClient

  beforeEach(() => {
    clearAllIndices()
    client = new MeiliSearch({ host: 'http://127.0.0.1:7700' })
  })

  it('should get all keys', async () => {
    const response = await client.getKeys()
    expect(response.results).toBeDefined()
  })

  it('should create a key', async () => {
    const key = await client.createKey({
      name: 'Test Key',
      description: 'A test API key',
      actions: ['search'],
      indexes: ['movies'],
      expiresAt: null,
    })

    expect(key.key).toBeDefined()
    expect(key.name).toBe('Test Key')
  })

  it('should get a key by uid', async () => {
    const created = await client.createKey({
      name: 'Test Key',
      actions: ['*'],
      indexes: ['*'],
      expiresAt: null,
    })

    const key = await client.getKey(created.uid)
    expect(key.uid).toBe(created.uid)
  })

  it('should update a key', async () => {
    const created = await client.createKey({
      name: 'Test Key',
      actions: ['search'],
      indexes: ['movies'],
      expiresAt: null,
    })

    const updated = await client.updateKey(created.uid, {
      name: 'Updated Key',
    })

    expect(updated.name).toBe('Updated Key')
  })

  it('should delete a key', async () => {
    const created = await client.createKey({
      name: 'Test Key',
      actions: ['search'],
      indexes: ['movies'],
      expiresAt: null,
    })

    await client.deleteKey(created.uid)

    await expect(client.getKey(created.uid)).rejects.toThrow()
  })
})

// ============================================================================
// MULTI-SEARCH TESTS
// ============================================================================

describe('multiSearch', () => {
  let client: MeiliSearchClient

  beforeEach(async () => {
    clearAllIndices()
    client = new MeiliSearch({ host: 'http://127.0.0.1:7700' })

    // Create and populate indexes
    await client.createIndex('movies', { primaryKey: 'id' })
    await client.createIndex('books', { primaryKey: 'id' })

    const moviesIndex = client.index('movies')
    const booksIndex = client.index('books')

    await moviesIndex.addDocuments([
      { id: 1, title: 'The Matrix', genre: 'sci-fi' },
      { id: 2, title: 'Inception', genre: 'sci-fi' },
    ])

    await booksIndex.addDocuments([
      { id: 1, title: 'Neuromancer', genre: 'sci-fi' },
      { id: 2, title: 'The Hobbit', genre: 'fantasy' },
    ])

    // Wait for indexing
    const tasks = await client.getTasks()
    for (const task of tasks.results) {
      if (task.status === 'enqueued' || task.status === 'processing') {
        await client.waitForTask(task.uid)
      }
    }
  })

  it('should search multiple indexes', async () => {
    const response = await client.multiSearch({
      queries: [
        { indexUid: 'movies', q: 'matrix' },
        { indexUid: 'books', q: 'hobbit' },
      ],
    })

    expect(response.results).toHaveLength(2)
    expect(response.results[0].hits.length).toBeGreaterThan(0)
    expect(response.results[1].hits.length).toBeGreaterThan(0)
  })

  it('should support different options per query', async () => {
    await client.index('movies').updateSettings({ filterableAttributes: ['genre'] })

    const response = await client.multiSearch({
      queries: [
        { indexUid: 'movies', q: '', filter: 'genre = sci-fi', limit: 1 },
        { indexUid: 'books', q: '', limit: 5 },
      ],
    })

    expect(response.results[0].hits.length).toBe(1)
    expect(response.results[1].hits.length).toBeLessThanOrEqual(5)
  })
})

// ============================================================================
// ERROR HANDLING TESTS
// ============================================================================

describe('error handling', () => {
  let client: MeiliSearchClient

  beforeEach(() => {
    clearAllIndices()
    client = new MeiliSearch({ host: 'http://127.0.0.1:7700' })
  })

  it('should throw MeiliSearchError for API errors', async () => {
    await expect(client.getIndex('non-existent')).rejects.toThrow(MeiliSearchError)
  })

  it('should throw IndexNotFoundError for missing index', async () => {
    await expect(client.getIndex('non-existent')).rejects.toThrow(IndexNotFoundError)
  })

  it('should throw DocumentNotFoundError for missing document', async () => {
    const task = await client.createIndex('movies', { primaryKey: 'id' })
    await client.waitForTask(task.taskUid)

    const index = client.index('movies')
    await expect(index.getDocument(999)).rejects.toThrow(DocumentNotFoundError)
  })

  it('should include error code in MeiliSearchError', async () => {
    try {
      await client.getIndex('non-existent')
    } catch (error) {
      expect(error).toBeInstanceOf(MeiliSearchError)
      expect((error as MeiliSearchError).code).toBe('index_not_found')
    }
  })
})

// ============================================================================
// INDEX STATS TESTS
// ============================================================================

describe('index stats', () => {
  let client: MeiliSearchClient
  let index: Index

  beforeEach(async () => {
    clearAllIndices()
    client = new MeiliSearch({ host: 'http://127.0.0.1:7700' })
    const task = await client.createIndex('movies', { primaryKey: 'id' })
    await client.waitForTask(task.taskUid)
    index = client.index('movies')

    const addTask = await index.addDocuments([
      { id: 1, title: 'The Matrix', genre: 'sci-fi' },
      { id: 2, title: 'Inception', genre: 'sci-fi' },
    ])
    await client.waitForTask(addTask.taskUid)
  })

  it('should get index stats', async () => {
    const stats = await index.getStats()

    expect(stats.numberOfDocuments).toBe(2)
    expect(stats.isIndexing).toBeDefined()
    expect(stats.fieldDistribution).toBeDefined()
  })

  it('should show field distribution', async () => {
    const stats = await index.getStats()

    expect(stats.fieldDistribution.id).toBe(2)
    expect(stats.fieldDistribution.title).toBe(2)
    expect(stats.fieldDistribution.genre).toBe(2)
  })
})

// ============================================================================
// DUMPS TESTS
// ============================================================================

describe('dumps', () => {
  let client: MeiliSearchClient

  beforeEach(() => {
    clearAllIndices()
    client = new MeiliSearch({ host: 'http://127.0.0.1:7700' })
  })

  it('should create a dump', async () => {
    const task = await client.createDump()

    expect(task.taskUid).toBeDefined()
    expect(task.type).toBe('dumpCreation')
  })
})

// ============================================================================
// SNAPSHOTS TESTS
// ============================================================================

describe('snapshots', () => {
  let client: MeiliSearchClient

  beforeEach(() => {
    clearAllIndices()
    client = new MeiliSearch({ host: 'http://127.0.0.1:7700' })
  })

  it('should create a snapshot', async () => {
    const task = await client.createSnapshot()

    expect(task.taskUid).toBeDefined()
    expect(task.type).toBe('snapshotCreation')
  })
})

// ============================================================================
// SWAP INDEXES TESTS
// ============================================================================

describe('swapIndexes', () => {
  let client: MeiliSearchClient

  beforeEach(async () => {
    clearAllIndices()
    client = new MeiliSearch({ host: 'http://127.0.0.1:7700' })

    await client.createIndex('movies_v1')
    await client.createIndex('movies_v2')
  })

  it('should swap two indexes', async () => {
    const task = await client.swapIndexes([
      { indexes: ['movies_v1', 'movies_v2'] },
    ])

    expect(task.taskUid).toBeDefined()
    expect(task.type).toBe('indexSwap')
  })
})
