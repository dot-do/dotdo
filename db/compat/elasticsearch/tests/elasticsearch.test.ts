/**
 * Elasticsearch Compat Layer Tests
 *
 * TDD tests for the ES-compatible search engine backed by unified primitives.
 * Tests cover: indexing, search queries, aggregations, highlighting, and hybrid search.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createClient, type ElasticsearchClient } from '../index'
import type { Document, SearchResponse, BulkResponse, Hit } from '../types'

// ============================================================================
// TEST FIXTURES
// ============================================================================

interface ProductDoc extends Document {
  name: string
  description: string
  category: string
  price: number
  rating: number
  inStock: boolean
  tags: string[]
  createdAt: string
  embedding?: number[]
}

const testProducts: ProductDoc[] = [
  {
    name: 'MacBook Pro 16',
    description: 'Apple laptop with M3 Pro chip for professional use',
    category: 'electronics',
    price: 2499,
    rating: 4.8,
    inStock: true,
    tags: ['laptop', 'apple', 'professional'],
    createdAt: '2024-01-15T10:00:00Z',
  },
  {
    name: 'ThinkPad X1 Carbon',
    description: 'Business laptop with Intel processor lightweight design',
    category: 'electronics',
    price: 1899,
    rating: 4.5,
    inStock: true,
    tags: ['laptop', 'business', 'lenovo'],
    createdAt: '2024-01-20T14:30:00Z',
  },
  {
    name: 'Sony WH-1000XM5',
    description: 'Wireless noise cancelling headphones with premium sound',
    category: 'audio',
    price: 399,
    rating: 4.7,
    inStock: true,
    tags: ['headphones', 'wireless', 'sony'],
    createdAt: '2024-02-01T09:00:00Z',
  },
  {
    name: 'AirPods Pro',
    description: 'Apple wireless earbuds with active noise cancellation',
    category: 'audio',
    price: 249,
    rating: 4.6,
    inStock: false,
    tags: ['earbuds', 'wireless', 'apple'],
    createdAt: '2024-02-10T16:00:00Z',
  },
  {
    name: 'Dell UltraSharp 27',
    description: '4K monitor for professional color accurate work',
    category: 'monitors',
    price: 799,
    rating: 4.4,
    inStock: true,
    tags: ['monitor', '4k', 'dell'],
    createdAt: '2024-03-01T11:00:00Z',
  },
  {
    name: 'Logitech MX Master 3',
    description: 'Ergonomic wireless mouse for productivity',
    category: 'peripherals',
    price: 99,
    rating: 4.9,
    inStock: true,
    tags: ['mouse', 'wireless', 'ergonomic'],
    createdAt: '2024-03-15T08:00:00Z',
  },
]

// ============================================================================
// SETUP
// ============================================================================

describe('Elasticsearch Compat Layer', () => {
  let client: ElasticsearchClient
  const testIndex = 'test-products'

  beforeEach(async () => {
    client = createClient({
      defaultIndex: testIndex,
    })

    // Create test index
    await client.indices.create({
      index: testIndex,
      mappings: {
        properties: {
          name: { type: 'text', analyzer: 'standard' },
          description: { type: 'text', analyzer: 'standard' },
          category: { type: 'keyword' },
          price: { type: 'float' },
          rating: { type: 'float' },
          inStock: { type: 'boolean' },
          tags: { type: 'keyword' },
          createdAt: { type: 'date' },
          embedding: { type: 'dense_vector', dims: 384 },
        },
      },
    })

    // Index test documents
    const bulkOps = testProducts.flatMap((doc, i) => [{ index: { _index: testIndex, _id: `product-${i + 1}` } }, doc])

    await client.bulk({
      operations: bulkOps,
      refresh: true,
    })
  })

  afterEach(async () => {
    await client.indices.delete({ index: testIndex })
    await client.close()
  })

  // ==========================================================================
  // DOCUMENT OPERATIONS
  // ==========================================================================

  describe('Document Operations', () => {
    it('should index a single document', async () => {
      const response = await client.index<ProductDoc>({
        index: testIndex,
        id: 'new-product',
        document: {
          name: 'Test Product',
          description: 'A test product',
          category: 'test',
          price: 100,
          rating: 5.0,
          inStock: true,
          tags: ['test'],
          createdAt: '2024-04-01T00:00:00Z',
        },
      })

      expect(response._id).toBe('new-product')
      expect(response._index).toBe(testIndex)
      expect(response.result).toBe('created')
    })

    it('should update an existing document', async () => {
      const response = await client.index<ProductDoc>({
        index: testIndex,
        id: 'product-1',
        document: {
          name: 'MacBook Pro 16 Updated',
          description: 'Updated description',
          category: 'electronics',
          price: 2599,
          rating: 4.9,
          inStock: true,
          tags: ['laptop', 'apple', 'professional', 'updated'],
          createdAt: '2024-01-15T10:00:00Z',
        },
      })

      expect(response.result).toBe('updated')
    })

    it('should get a document by ID', async () => {
      const response = await client.get<ProductDoc>({
        index: testIndex,
        id: 'product-1',
      })

      expect(response.found).toBe(true)
      expect(response._id).toBe('product-1')
      expect(response._source?.name).toBe('MacBook Pro 16')
    })

    it('should return found=false for non-existent document', async () => {
      const response = await client.get({
        index: testIndex,
        id: 'non-existent',
      })

      expect(response.found).toBe(false)
    })

    it('should delete a document', async () => {
      const response = await client.delete({
        index: testIndex,
        id: 'product-1',
      })

      expect(response.result).toBe('deleted')

      const getResponse = await client.get({
        index: testIndex,
        id: 'product-1',
      })
      expect(getResponse.found).toBe(false)
    })

    it('should perform partial update', async () => {
      const response = await client.update<ProductDoc>({
        index: testIndex,
        id: 'product-1',
        doc: { price: 2299, inStock: false },
      })

      expect(response.result).toBe('updated')

      const getResponse = await client.get<ProductDoc>({
        index: testIndex,
        id: 'product-1',
      })
      expect(getResponse._source?.price).toBe(2299)
      expect(getResponse._source?.inStock).toBe(false)
    })

    it('should perform bulk operations', async () => {
      const response = await client.bulk<ProductDoc>({
        operations: [
          { index: { _index: testIndex, _id: 'bulk-1' } },
          { name: 'Bulk Product 1', description: 'First bulk', category: 'test', price: 50, rating: 4.0, inStock: true, tags: ['bulk'], createdAt: '2024-04-01T00:00:00Z' },
          { index: { _index: testIndex, _id: 'bulk-2' } },
          { name: 'Bulk Product 2', description: 'Second bulk', category: 'test', price: 75, rating: 4.5, inStock: true, tags: ['bulk'], createdAt: '2024-04-02T00:00:00Z' },
          { delete: { _index: testIndex, _id: 'product-6' } },
        ],
        refresh: true,
      })

      expect(response.errors).toBe(false)
      expect(response.items).toHaveLength(3)
    })
  })

  // ==========================================================================
  // SEARCH QUERIES
  // ==========================================================================

  describe('Search - Match Queries', () => {
    it('should perform simple match query', async () => {
      const response = await client.search<ProductDoc>({
        index: testIndex,
        query: {
          match: { name: 'MacBook' },
        },
      })

      expect(response.hits.total.value).toBe(1)
      expect(response.hits.hits[0]._source?.name).toBe('MacBook Pro 16')
    })

    it('should perform match query with operator', async () => {
      const response = await client.search<ProductDoc>({
        index: testIndex,
        query: {
          match: {
            description: {
              query: 'Apple laptop',
              operator: 'and',
            },
          },
        },
      })

      expect(response.hits.total.value).toBe(1)
    })

    it('should perform multi_match query', async () => {
      const response = await client.search<ProductDoc>({
        index: testIndex,
        query: {
          multi_match: {
            query: 'wireless',
            fields: ['name', 'description', 'tags'],
          },
        },
      })

      expect(response.hits.total.value).toBeGreaterThanOrEqual(3)
    })

    it('should perform match_phrase query', async () => {
      const response = await client.search<ProductDoc>({
        index: testIndex,
        query: {
          match_phrase: { description: 'noise cancelling' },
        },
      })

      expect(response.hits.total.value).toBe(1)
      expect(response.hits.hits[0]._source?.name).toBe('Sony WH-1000XM5')
    })
  })

  describe('Search - Term Queries', () => {
    it('should perform term query on keyword field', async () => {
      const response = await client.search<ProductDoc>({
        index: testIndex,
        query: {
          term: { category: 'electronics' },
        },
      })

      expect(response.hits.total.value).toBe(2)
    })

    it('should perform terms query', async () => {
      const response = await client.search<ProductDoc>({
        index: testIndex,
        query: {
          terms: { category: ['electronics', 'audio'] },
        },
      })

      expect(response.hits.total.value).toBe(4)
    })

    it('should perform exists query', async () => {
      const response = await client.search<ProductDoc>({
        index: testIndex,
        query: {
          exists: { field: 'rating' },
        },
      })

      expect(response.hits.total.value).toBe(6)
    })

    it('should perform prefix query', async () => {
      const response = await client.search<ProductDoc>({
        index: testIndex,
        query: {
          prefix: { name: 'Mac' },
        },
      })

      expect(response.hits.total.value).toBeGreaterThanOrEqual(1)
    })

    it('should perform wildcard query', async () => {
      const response = await client.search<ProductDoc>({
        index: testIndex,
        query: {
          wildcard: { name: '*Pro*' },
        },
      })

      expect(response.hits.total.value).toBeGreaterThanOrEqual(2)
    })

    it('should perform IDs query', async () => {
      const response = await client.search<ProductDoc>({
        index: testIndex,
        query: {
          ids: { values: ['product-1', 'product-2', 'product-3'] },
        },
      })

      expect(response.hits.total.value).toBe(3)
    })
  })

  describe('Search - Range Queries', () => {
    it('should perform range query on numeric field', async () => {
      const response = await client.search<ProductDoc>({
        index: testIndex,
        query: {
          range: {
            price: { gte: 100, lte: 500 },
          },
        },
      })

      // Products with price in [100, 500]: Sony WH-1000XM5 (399), AirPods Pro (249)
      expect(response.hits.total.value).toBe(2)
    })

    it('should perform range query on date field', async () => {
      const response = await client.search<ProductDoc>({
        index: testIndex,
        query: {
          range: {
            createdAt: {
              gte: '2024-02-01',
              lt: '2024-03-01',
            },
          },
        },
      })

      expect(response.hits.total.value).toBe(2)
    })
  })

  describe('Search - Bool Queries', () => {
    it('should perform bool query with must', async () => {
      const response = await client.search<ProductDoc>({
        index: testIndex,
        query: {
          bool: {
            must: [{ term: { category: 'electronics' } }, { range: { price: { gte: 2000 } } }],
          },
        },
      })

      expect(response.hits.total.value).toBe(1)
      expect(response.hits.hits[0]._source?.name).toBe('MacBook Pro 16')
    })

    it('should perform bool query with filter', async () => {
      const response = await client.search<ProductDoc>({
        index: testIndex,
        query: {
          bool: {
            must: [{ match: { description: 'laptop' } }],
            filter: [{ term: { inStock: true } }],
          },
        },
      })

      expect(response.hits.total.value).toBe(2)
    })

    it('should perform bool query with should and minimum_should_match', async () => {
      const response = await client.search<ProductDoc>({
        index: testIndex,
        query: {
          bool: {
            should: [{ term: { category: 'electronics' } }, { term: { category: 'audio' } }, { term: { category: 'monitors' } }],
            minimum_should_match: 1,
          },
        },
      })

      expect(response.hits.total.value).toBe(5)
    })

    it('should perform bool query with must_not', async () => {
      const response = await client.search<ProductDoc>({
        index: testIndex,
        query: {
          bool: {
            must: [{ match_all: {} }],
            must_not: [{ term: { inStock: false } }],
          },
        },
      })

      expect(response.hits.total.value).toBe(5)
    })
  })

  // ==========================================================================
  // PAGINATION AND SORTING
  // ==========================================================================

  describe('Search - Pagination and Sorting', () => {
    it('should paginate results', async () => {
      const response = await client.search<ProductDoc>({
        index: testIndex,
        query: { match_all: {} },
        from: 2,
        size: 2,
      })

      expect(response.hits.hits).toHaveLength(2)
    })

    it('should sort by single field', async () => {
      const response = await client.search<ProductDoc>({
        index: testIndex,
        query: { match_all: {} },
        sort: [{ price: 'asc' }],
      })

      const prices = response.hits.hits.map((h) => h._source?.price ?? 0)
      expect(prices).toEqual([...prices].sort((a, b) => a - b))
    })

    it('should sort by multiple fields', async () => {
      const response = await client.search<ProductDoc>({
        index: testIndex,
        query: { match_all: {} },
        sort: [{ category: 'asc' }, { price: 'desc' }],
      })

      expect(response.hits.hits.length).toBe(6)
    })

    it('should sort by score', async () => {
      const response = await client.search<ProductDoc>({
        index: testIndex,
        query: {
          multi_match: {
            query: 'wireless headphones',
            fields: ['name', 'description', 'tags'],
          },
        },
        sort: [{ _score: 'desc' }],
      })

      const scores = response.hits.hits.map((h) => h._score ?? 0)
      expect(scores).toEqual([...scores].sort((a, b) => b - a))
    })
  })

  // ==========================================================================
  // HIGHLIGHTING
  // ==========================================================================

  describe('Search - Highlighting', () => {
    it('should highlight matched terms', async () => {
      const response = await client.search<ProductDoc>({
        index: testIndex,
        query: {
          match: { description: 'laptop' },
        },
        highlight: {
          fields: {
            description: {},
          },
          pre_tags: ['<em>'],
          post_tags: ['</em>'],
        },
      })

      expect(response.hits.hits[0].highlight).toBeDefined()
      expect(response.hits.hits[0].highlight?.description[0]).toContain('<em>laptop</em>')
    })

    it('should highlight multiple fields', async () => {
      const response = await client.search<ProductDoc>({
        index: testIndex,
        query: {
          multi_match: {
            query: 'Apple',
            fields: ['name', 'description'],
          },
        },
        highlight: {
          fields: {
            name: {},
            description: {},
          },
        },
      })

      expect(response.hits.total.value).toBeGreaterThanOrEqual(1)
      const hit = response.hits.hits[0]
      expect(hit.highlight).toBeDefined()
    })
  })

  // ==========================================================================
  // AGGREGATIONS
  // ==========================================================================

  describe('Aggregations - Bucket', () => {
    it('should perform terms aggregation', async () => {
      const response = await client.search<ProductDoc>({
        index: testIndex,
        query: { match_all: {} },
        size: 0,
        aggs: {
          categories: {
            terms: { field: 'category', size: 10 },
          },
        },
      })

      expect(response.aggregations?.categories).toBeDefined()
      const agg = response.aggregations?.categories as { buckets: Array<{ key: string; doc_count: number }> }
      expect(agg.buckets.length).toBeGreaterThan(0)
      expect(agg.buckets.some((b) => b.key === 'electronics')).toBe(true)
    })

    it('should perform histogram aggregation', async () => {
      const response = await client.search<ProductDoc>({
        index: testIndex,
        query: { match_all: {} },
        size: 0,
        aggs: {
          price_ranges: {
            histogram: { field: 'price', interval: 500 },
          },
        },
      })

      expect(response.aggregations?.price_ranges).toBeDefined()
      const agg = response.aggregations?.price_ranges as { buckets: Array<{ key: number; doc_count: number }> }
      expect(agg.buckets.length).toBeGreaterThan(0)
    })

    it('should perform date_histogram aggregation', async () => {
      const response = await client.search<ProductDoc>({
        index: testIndex,
        query: { match_all: {} },
        size: 0,
        aggs: {
          by_month: {
            date_histogram: {
              field: 'createdAt',
              calendar_interval: 'month',
            },
          },
        },
      })

      expect(response.aggregations?.by_month).toBeDefined()
      const agg = response.aggregations?.by_month as { buckets: Array<{ key: number; key_as_string: string; doc_count: number }> }
      expect(agg.buckets.length).toBeGreaterThan(0)
    })

    it('should perform range aggregation', async () => {
      const response = await client.search<ProductDoc>({
        index: testIndex,
        query: { match_all: {} },
        size: 0,
        aggs: {
          price_tiers: {
            range: {
              field: 'price',
              ranges: [{ key: 'cheap', to: 200 }, { key: 'mid', from: 200, to: 1000 }, { key: 'expensive', from: 1000 }],
            },
          },
        },
      })

      expect(response.aggregations?.price_tiers).toBeDefined()
      const agg = response.aggregations?.price_tiers as { buckets: Array<{ key: string; doc_count: number }> }
      expect(agg.buckets.length).toBe(3)
    })
  })

  describe('Aggregations - Metric', () => {
    it('should perform avg aggregation', async () => {
      const response = await client.search<ProductDoc>({
        index: testIndex,
        query: { match_all: {} },
        size: 0,
        aggs: {
          avg_price: {
            avg: { field: 'price' },
          },
        },
      })

      expect(response.aggregations?.avg_price).toBeDefined()
      const agg = response.aggregations?.avg_price as { value: number }
      expect(typeof agg.value).toBe('number')
    })

    it('should perform sum aggregation', async () => {
      const response = await client.search<ProductDoc>({
        index: testIndex,
        query: { match_all: {} },
        size: 0,
        aggs: {
          total_price: {
            sum: { field: 'price' },
          },
        },
      })

      const agg = response.aggregations?.total_price as { value: number }
      expect(agg.value).toBe(5944) // Sum of all prices
    })

    it('should perform min/max aggregations', async () => {
      const response = await client.search<ProductDoc>({
        index: testIndex,
        query: { match_all: {} },
        size: 0,
        aggs: {
          min_price: { min: { field: 'price' } },
          max_price: { max: { field: 'price' } },
        },
      })

      const minAgg = response.aggregations?.min_price as { value: number }
      const maxAgg = response.aggregations?.max_price as { value: number }
      expect(minAgg.value).toBe(99)
      expect(maxAgg.value).toBe(2499)
    })

    it('should perform cardinality aggregation', async () => {
      const response = await client.search<ProductDoc>({
        index: testIndex,
        query: { match_all: {} },
        size: 0,
        aggs: {
          unique_categories: {
            cardinality: { field: 'category' },
          },
        },
      })

      const agg = response.aggregations?.unique_categories as { value: number }
      expect(agg.value).toBe(4) // electronics, audio, monitors, peripherals
    })

    it('should perform stats aggregation', async () => {
      const response = await client.search<ProductDoc>({
        index: testIndex,
        query: { match_all: {} },
        size: 0,
        aggs: {
          price_stats: {
            stats: { field: 'price' },
          },
        },
      })

      const agg = response.aggregations?.price_stats as { count: number; min: number; max: number; avg: number; sum: number }
      expect(agg.count).toBe(6)
      expect(agg.min).toBe(99)
      expect(agg.max).toBe(2499)
      expect(typeof agg.avg).toBe('number')
      expect(agg.sum).toBe(5944)
    })
  })

  describe('Aggregations - Nested', () => {
    it('should perform nested sub-aggregations', async () => {
      const response = await client.search<ProductDoc>({
        index: testIndex,
        query: { match_all: {} },
        size: 0,
        aggs: {
          by_category: {
            terms: { field: 'category' },
            aggs: {
              avg_price: { avg: { field: 'price' } },
              max_rating: { max: { field: 'rating' } },
            },
          },
        },
      })

      const agg = response.aggregations?.by_category as {
        buckets: Array<{
          key: string
          doc_count: number
          avg_price: { value: number }
          max_rating: { value: number }
        }>
      }

      expect(agg.buckets.length).toBeGreaterThan(0)
      const electronicsB = agg.buckets.find((b) => b.key === 'electronics')
      expect(electronicsB?.avg_price?.value).toBeDefined()
      expect(electronicsB?.max_rating?.value).toBeDefined()
    })

    it('should perform filter aggregation', async () => {
      const response = await client.search<ProductDoc>({
        index: testIndex,
        query: { match_all: {} },
        size: 0,
        aggs: {
          in_stock_products: {
            filter: { term: { inStock: true } },
            aggs: {
              avg_price: { avg: { field: 'price' } },
            },
          },
        },
      })

      const agg = response.aggregations?.in_stock_products as {
        doc_count: number
        avg_price: { value: number }
      }

      expect(agg.doc_count).toBe(5)
      expect(agg.avg_price?.value).toBeDefined()
    })
  })

  // ==========================================================================
  // VECTOR / HYBRID SEARCH
  // ==========================================================================

  describe('Hybrid Search (BM25 + Vector)', () => {
    beforeEach(async () => {
      // Add embeddings to documents
      const embeddings = [
        Array.from({ length: 384 }, () => Math.random()),
        Array.from({ length: 384 }, () => Math.random()),
        Array.from({ length: 384 }, () => Math.random()),
        Array.from({ length: 384 }, () => Math.random()),
        Array.from({ length: 384 }, () => Math.random()),
        Array.from({ length: 384 }, () => Math.random()),
      ]

      for (let i = 0; i < embeddings.length; i++) {
        await client.update({
          index: testIndex,
          id: `product-${i + 1}`,
          doc: { embedding: embeddings[i] },
        })
      }
    })

    it('should perform knn query', async () => {
      const queryVector = Array.from({ length: 384 }, () => Math.random())

      const response = await client.search<ProductDoc>({
        index: testIndex,
        knn: {
          field: 'embedding',
          query_vector: queryVector,
          k: 3,
          num_candidates: 10,
        },
      })

      expect(response.hits.total.value).toBe(3)
    })

    it('should perform hybrid search with RRF', async () => {
      const queryVector = Array.from({ length: 384 }, () => Math.random())

      const response = await client.search<ProductDoc>({
        index: testIndex,
        query: {
          match: { description: 'laptop' },
        },
        knn: {
          field: 'embedding',
          query_vector: queryVector,
          k: 5,
        },
        rank: {
          rrf: {
            window_size: 50,
            rank_constant: 60,
          },
        },
      })

      expect(response.hits.total.value).toBeGreaterThan(0)
    })

    it('should filter knn results', async () => {
      const queryVector = Array.from({ length: 384 }, () => Math.random())

      const response = await client.search<ProductDoc>({
        index: testIndex,
        knn: {
          field: 'embedding',
          query_vector: queryVector,
          k: 10,
          filter: {
            term: { category: 'electronics' },
          },
        },
      })

      response.hits.hits.forEach((hit) => {
        expect(hit._source?.category).toBe('electronics')
      })
    })
  })

  // ==========================================================================
  // INDEX MANAGEMENT
  // ==========================================================================

  describe('Index Management', () => {
    it('should check if index exists', async () => {
      const exists = await client.indices.exists({ index: testIndex })
      expect(exists).toBe(true)

      const notExists = await client.indices.exists({ index: 'non-existent' })
      expect(notExists).toBe(false)
    })

    it('should get index info', async () => {
      const info = await client.indices.get({ index: testIndex })
      expect(info[testIndex]).toBeDefined()
      expect(info[testIndex].mappings).toBeDefined()
    })

    it('should refresh index', async () => {
      const response = await client.indices.refresh({ index: testIndex })
      expect(response._shards.successful).toBeGreaterThanOrEqual(0)
    })

    it('should update mappings', async () => {
      const response = await client.indices.putMapping({
        index: testIndex,
        body: {
          properties: {
            newField: { type: 'keyword' },
          },
        },
      })
      expect(response.acknowledged).toBe(true)
    })
  })

  // ==========================================================================
  // CLUSTER OPERATIONS
  // ==========================================================================

  describe('Cluster Operations', () => {
    it('should get cluster health', async () => {
      const health = await client.cluster.health()
      expect(health.status).toBeDefined()
      expect(['green', 'yellow', 'red']).toContain(health.status)
    })

    it('should get cluster stats', async () => {
      const stats = await client.cluster.stats()
      expect(stats.indices).toBeDefined()
      expect(stats.indices.count).toBeGreaterThanOrEqual(0)
    })

    it('should ping cluster', async () => {
      const result = await client.ping()
      expect(result).toBe(true)
    })

    it('should get cluster info', async () => {
      const info = await client.info()
      expect(info.version).toBeDefined()
      expect(info.cluster_name).toBeDefined()
    })
  })

  // ==========================================================================
  // SOURCE FILTERING
  // ==========================================================================

  describe('Source Filtering', () => {
    it('should exclude _source', async () => {
      const response = await client.search<ProductDoc>({
        index: testIndex,
        query: { match_all: {} },
        _source: false,
        size: 1,
      })

      expect(response.hits.hits[0]._source).toBeUndefined()
    })

    it('should include specific fields', async () => {
      const response = await client.search<ProductDoc>({
        index: testIndex,
        query: { match_all: {} },
        _source: ['name', 'price'],
        size: 1,
      })

      const source = response.hits.hits[0]._source
      expect(source?.name).toBeDefined()
      expect(source?.price).toBeDefined()
      expect(source?.description).toBeUndefined()
    })

    it('should include/exclude fields', async () => {
      const response = await client.search<ProductDoc>({
        index: testIndex,
        query: { match_all: {} },
        _source: {
          includes: ['name', 'category', 'price'],
          excludes: ['price'],
        },
        size: 1,
      })

      const source = response.hits.hits[0]._source
      expect(source?.name).toBeDefined()
      expect(source?.category).toBeDefined()
      expect(source?.price).toBeUndefined()
    })
  })

  // ==========================================================================
  // SCORING
  // ==========================================================================

  describe('Scoring', () => {
    it('should track scores', async () => {
      const response = await client.search<ProductDoc>({
        index: testIndex,
        query: {
          match: { description: 'laptop' },
        },
        track_scores: true,
      })

      response.hits.hits.forEach((hit) => {
        expect(hit._score).toBeDefined()
        expect(hit._score).toBeGreaterThan(0)
      })
    })

    it('should apply min_score filter', async () => {
      const response = await client.search<ProductDoc>({
        index: testIndex,
        query: {
          match: { description: 'laptop professional wireless' },
        },
        min_score: 0.5,
      })

      response.hits.hits.forEach((hit) => {
        expect(hit._score).toBeGreaterThanOrEqual(0.5)
      })
    })
  })
})
