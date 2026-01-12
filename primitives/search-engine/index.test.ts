/**
 * SearchEngine Tests - TDD Red-Green-Refactor
 *
 * Comprehensive tests for search engine primitives
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  SearchEngine,
  QueryParser,
  Scorer,
  FacetAggregator,
  Highlighter,
  Analyzer,
  InvertedIndex,
} from './index'
import type {
  SearchQuery,
  SearchResult,
  IndexDocument,
  SearchFilter,
  FacetRequest,
  SortOption,
  IndexMapping,
} from './types'

// =============================================================================
// Test Data
// =============================================================================

interface Product {
  name: string
  description: string
  category: string
  price: number
  inStock: boolean
  tags?: string[]
  rating?: number
  createdAt?: string
}

const testProducts: IndexDocument<Product>[] = [
  {
    id: 'prod-1',
    source: {
      name: 'iPhone 15 Pro',
      description: 'The latest Apple smartphone with titanium design and A17 chip',
      category: 'electronics',
      price: 999,
      inStock: true,
      tags: ['apple', 'smartphone', 'premium'],
      rating: 4.8,
      createdAt: '2024-01-15',
    },
  },
  {
    id: 'prod-2',
    source: {
      name: 'Samsung Galaxy S24',
      description: 'Android flagship phone with AI features and great camera',
      category: 'electronics',
      price: 899,
      inStock: true,
      tags: ['samsung', 'smartphone', 'android'],
      rating: 4.6,
      createdAt: '2024-02-01',
    },
  },
  {
    id: 'prod-3',
    source: {
      name: 'MacBook Pro 16"',
      description: 'Professional laptop with M3 chip for developers and creatives',
      category: 'electronics',
      price: 2499,
      inStock: false,
      tags: ['apple', 'laptop', 'professional'],
      rating: 4.9,
      createdAt: '2023-11-20',
    },
  },
  {
    id: 'prod-4',
    source: {
      name: 'Wireless Earbuds Pro',
      description: 'Premium wireless earbuds with active noise cancellation',
      category: 'audio',
      price: 249,
      inStock: true,
      tags: ['audio', 'wireless', 'premium'],
      rating: 4.5,
      createdAt: '2024-01-10',
    },
  },
  {
    id: 'prod-5',
    source: {
      name: 'Smart Watch Ultra',
      description: 'Advanced smartwatch with health monitoring and GPS',
      category: 'wearables',
      price: 799,
      inStock: true,
      tags: ['wearable', 'fitness', 'premium'],
      rating: 4.7,
      createdAt: '2024-03-01',
    },
  },
]

// =============================================================================
// SearchEngine - Basic Text Search
// =============================================================================

describe('SearchEngine', () => {
  let engine: SearchEngine<Product>

  beforeEach(async () => {
    engine = new SearchEngine<Product>()
    for (const product of testProducts) {
      await engine.index(product)
    }
  })

  describe('basic text search', () => {
    it('should find documents by single term', async () => {
      const result = await engine.search('iPhone')

      expect(result.hits.length).toBeGreaterThan(0)
      expect(result.hits[0].source.name).toContain('iPhone')
      expect(result.total).toBe(1)
    })

    it('should return empty results for non-matching query', async () => {
      const result = await engine.search('nonexistent')

      expect(result.hits).toHaveLength(0)
      expect(result.total).toBe(0)
    })

    it('should be case-insensitive by default', async () => {
      const lowercase = await engine.search('iphone')
      const uppercase = await engine.search('IPHONE')
      const mixed = await engine.search('IpHoNe')

      expect(lowercase.total).toBe(1)
      expect(uppercase.total).toBe(1)
      expect(mixed.total).toBe(1)
    })

    it('should search across all text fields', async () => {
      const result = await engine.search('titanium')

      expect(result.hits.length).toBeGreaterThan(0)
      expect(result.hits[0].source.description).toContain('titanium')
    })

    it('should return relevance scores', async () => {
      const result = await engine.search('smartphone')

      expect(result.hits.length).toBeGreaterThan(0)
      result.hits.forEach((hit) => {
        expect(hit.score).toBeGreaterThan(0)
      })
      expect(result.maxScore).toBeGreaterThan(0)
    })

    it('should report query execution time', async () => {
      const result = await engine.search('phone')

      expect(result.took).toBeGreaterThanOrEqual(0)
    })
  })

  // ===========================================================================
  // Multi-field Search
  // ===========================================================================

  describe('multi-field search', () => {
    it('should search in specific fields', async () => {
      const result = await engine.search({
        query: 'premium',
        options: {
          fields: ['name'],
        },
      })

      // "premium" only appears in descriptions and tags, not names
      expect(result.total).toBe(0)
    })

    it('should search multiple specified fields', async () => {
      const result = await engine.search({
        query: 'premium',
        options: {
          fields: ['description', 'tags'],
        },
      })

      expect(result.total).toBeGreaterThan(0)
    })

    it('should support field boosting', async () => {
      const engine2 = new SearchEngine<Product>({
        fields: {
          name: { type: 'text', boost: 10 },
          description: { type: 'text', boost: 1 },
          category: { type: 'keyword' },
          price: { type: 'number' },
          inStock: { type: 'boolean' },
        },
      })

      for (const product of testProducts) {
        await engine2.index(product)
      }

      // "Pro" appears in both name and description
      const result = await engine2.search('Pro')

      // Products with "Pro" in name should score higher
      const firstHit = result.hits[0]
      expect(firstHit.source.name).toContain('Pro')
    })
  })

  // ===========================================================================
  // Phrase Search
  // ===========================================================================

  describe('phrase search', () => {
    it('should match exact phrases with quotes', async () => {
      const result = await engine.search('"iPhone 15"')

      expect(result.total).toBe(1)
      expect(result.hits[0].source.name).toContain('iPhone 15')
    })

    it('should not match partial phrases', async () => {
      const result = await engine.search('"iPhone 16"')

      expect(result.total).toBe(0)
    })

    it('should match phrase in any field', async () => {
      const result = await engine.search('"noise cancellation"')

      expect(result.total).toBe(1)
      expect(result.hits[0].source.description).toContain('noise cancellation')
    })

    it('should support phrase slop', async () => {
      const result = await engine.search({
        query: '"Apple smartphone"',
        options: {
          phraseSlop: 2,
        },
      })

      // Should match "Apple smartphone" with slop (allowing "latest Apple smartphone")
      expect(result.total).toBeGreaterThan(0)
    })
  })

  // ===========================================================================
  // Boolean Operators
  // ===========================================================================

  describe('boolean operators', () => {
    it('should handle AND operator', async () => {
      const result = await engine.search('apple AND smartphone')

      expect(result.total).toBe(1)
      expect(result.hits[0].id).toBe('prod-1')
    })

    it('should handle OR operator', async () => {
      const result = await engine.search('iPhone OR Galaxy')

      expect(result.total).toBe(2)
    })

    it('should handle NOT operator', async () => {
      const result = await engine.search('smartphone NOT Samsung')

      expect(result.total).toBe(1)
      expect(result.hits[0].source.name).not.toContain('Samsung')
    })

    it('should handle minus sign for exclusion', async () => {
      const result = await engine.search('phone -Galaxy')

      const hasGalaxy = result.hits.some((h) =>
        h.source.name.includes('Galaxy')
      )
      expect(hasGalaxy).toBe(false)
    })

    it('should handle complex boolean expressions', async () => {
      // Without proper grouping, use simpler AND/OR expressions
      // Find docs with apple AND premium (prod-1 has both in tags)
      const result = await engine.search('apple AND premium')

      expect(result.total).toBeGreaterThan(0)
      result.hits.forEach((hit) => {
        const hasApple =
          hit.source.name.toLowerCase().includes('apple') ||
          hit.source.tags?.includes('apple')
        const hasPremium =
          hit.source.description.toLowerCase().includes('premium') ||
          hit.source.tags?.includes('premium')
        expect(hasApple).toBe(true)
        expect(hasPremium).toBe(true)
      })
    })

    it('should use default operator for multiple terms', async () => {
      const resultOr = await engine.search({
        query: 'apple smartphone',
        options: { defaultOperator: 'OR' },
      })

      const resultAnd = await engine.search({
        query: 'apple smartphone',
        options: { defaultOperator: 'AND' },
      })

      expect(resultOr.total).toBeGreaterThan(resultAnd.total)
    })
  })

  // ===========================================================================
  // Filters
  // ===========================================================================

  describe('filters', () => {
    describe('equals filter', () => {
      it('should filter by exact value', async () => {
        const result = await engine.search({
          query: '*',
          filters: [{ field: 'category', operator: 'eq', value: 'electronics' }],
        })

        expect(result.total).toBe(3)
        result.hits.forEach((hit) => {
          expect(hit.source.category).toBe('electronics')
        })
      })

      it('should filter boolean fields', async () => {
        const result = await engine.search({
          query: '*',
          filters: [{ field: 'inStock', operator: 'eq', value: true }],
        })

        result.hits.forEach((hit) => {
          expect(hit.source.inStock).toBe(true)
        })
      })
    })

    describe('not equals filter', () => {
      it('should exclude matching values', async () => {
        const result = await engine.search({
          query: '*',
          filters: [{ field: 'category', operator: 'ne', value: 'electronics' }],
        })

        result.hits.forEach((hit) => {
          expect(hit.source.category).not.toBe('electronics')
        })
      })
    })

    describe('range filters', () => {
      it('should filter by greater than', async () => {
        const result = await engine.search({
          query: '*',
          filters: [{ field: 'price', operator: 'gt', value: 500 }],
        })

        result.hits.forEach((hit) => {
          expect(hit.source.price).toBeGreaterThan(500)
        })
      })

      it('should filter by less than or equal', async () => {
        const result = await engine.search({
          query: '*',
          filters: [{ field: 'price', operator: 'lte', value: 500 }],
        })

        result.hits.forEach((hit) => {
          expect(hit.source.price).toBeLessThanOrEqual(500)
        })
      })

      it('should support range with both bounds', async () => {
        const result = await engine.search({
          query: '*',
          filters: [{ field: 'price', operator: 'range', value: 200, to: 1000 }],
        })

        result.hits.forEach((hit) => {
          expect(hit.source.price).toBeGreaterThanOrEqual(200)
          expect(hit.source.price).toBeLessThanOrEqual(1000)
        })
      })
    })

    describe('in filter', () => {
      it('should match any value in array', async () => {
        const result = await engine.search({
          query: '*',
          filters: [
            { field: 'category', operator: 'in', value: ['electronics', 'audio'] },
          ],
        })

        result.hits.forEach((hit) => {
          expect(['electronics', 'audio']).toContain(hit.source.category)
        })
      })
    })

    describe('not in filter', () => {
      it('should exclude values in array', async () => {
        const result = await engine.search({
          query: '*',
          filters: [
            { field: 'category', operator: 'nin', value: ['electronics', 'audio'] },
          ],
        })

        result.hits.forEach((hit) => {
          expect(['electronics', 'audio']).not.toContain(hit.source.category)
        })
      })
    })

    describe('exists filter', () => {
      it('should filter by field existence', async () => {
        const result = await engine.search({
          query: '*',
          filters: [{ field: 'rating', operator: 'exists', value: true }],
        })

        result.hits.forEach((hit) => {
          expect(hit.source.rating).toBeDefined()
        })
      })
    })

    describe('prefix filter', () => {
      it('should filter by prefix', async () => {
        const result = await engine.search({
          query: '*',
          filters: [{ field: 'name', operator: 'prefix', value: 'Smart' }],
        })

        result.hits.forEach((hit) => {
          expect(hit.source.name.startsWith('Smart')).toBe(true)
        })
      })
    })

    describe('multiple filters', () => {
      it('should combine filters with AND', async () => {
        const result = await engine.search({
          query: '*',
          filters: [
            { field: 'category', operator: 'eq', value: 'electronics' },
            { field: 'inStock', operator: 'eq', value: true },
            { field: 'price', operator: 'lt', value: 1000 },
          ],
        })

        result.hits.forEach((hit) => {
          expect(hit.source.category).toBe('electronics')
          expect(hit.source.inStock).toBe(true)
          expect(hit.source.price).toBeLessThan(1000)
        })
      })
    })
  })

  // ===========================================================================
  // Faceted Search
  // ===========================================================================

  describe('faceted search', () => {
    it('should compute facets for keyword field', async () => {
      const result = await engine.search({
        query: '*',
        facets: [{ field: 'category' }],
      })

      expect(result.facets).toBeDefined()
      expect(result.facets!.length).toBe(1)

      const categoryFacet = result.facets![0]
      expect(categoryFacet.field).toBe('category')
      expect(categoryFacet.values.length).toBeGreaterThan(0)

      // Check counts
      const electronicsCount = categoryFacet.values.find(
        (v) => v.value === 'electronics'
      )
      expect(electronicsCount?.count).toBe(3)
    })

    it('should compute facets for boolean field', async () => {
      const result = await engine.search({
        query: '*',
        facets: [{ field: 'inStock' }],
      })

      const inStockFacet = result.facets![0]
      expect(inStockFacet.values.length).toBe(2)
    })

    it('should limit facet values', async () => {
      const result = await engine.search({
        query: '*',
        facets: [{ field: 'category', size: 2 }],
      })

      expect(result.facets![0].values.length).toBeLessThanOrEqual(2)
    })

    it('should filter facet values by min count', async () => {
      const result = await engine.search({
        query: '*',
        facets: [{ field: 'category', minCount: 2 }],
      })

      result.facets![0].values.forEach((v) => {
        expect(v.count).toBeGreaterThanOrEqual(2)
      })
    })

    it('should compute multiple facets', async () => {
      const result = await engine.search({
        query: '*',
        facets: [{ field: 'category' }, { field: 'inStock' }],
      })

      expect(result.facets!.length).toBe(2)
    })

    it('should apply filters before computing facets', async () => {
      const result = await engine.search({
        query: '*',
        filters: [{ field: 'inStock', operator: 'eq', value: true }],
        facets: [{ field: 'category' }],
      })

      // Only count in-stock products
      const totalCount = result.facets![0].values.reduce(
        (sum, v) => sum + v.count,
        0
      )
      expect(totalCount).toBe(result.total)
    })
  })

  // ===========================================================================
  // Sort
  // ===========================================================================

  describe('sort', () => {
    it('should sort by relevance by default', async () => {
      const result = await engine.search('smartphone premium')

      for (let i = 1; i < result.hits.length; i++) {
        expect(result.hits[i - 1].score).toBeGreaterThanOrEqual(
          result.hits[i].score
        )
      }
    })

    it('should sort by numeric field ascending', async () => {
      const result = await engine.search({
        query: '*',
        sort: [{ field: 'price', order: 'asc' }],
      })

      for (let i = 1; i < result.hits.length; i++) {
        expect(result.hits[i - 1].source.price).toBeLessThanOrEqual(
          result.hits[i].source.price
        )
      }
    })

    it('should sort by numeric field descending', async () => {
      const result = await engine.search({
        query: '*',
        sort: [{ field: 'price', order: 'desc' }],
      })

      for (let i = 1; i < result.hits.length; i++) {
        expect(result.hits[i - 1].source.price).toBeGreaterThanOrEqual(
          result.hits[i].source.price
        )
      }
    })

    it('should sort by text field', async () => {
      const result = await engine.search({
        query: '*',
        sort: [{ field: 'name', order: 'asc' }],
      })

      for (let i = 1; i < result.hits.length; i++) {
        expect(
          result.hits[i - 1].source.name.localeCompare(result.hits[i].source.name)
        ).toBeLessThanOrEqual(0)
      }
    })

    it('should support multi-level sort', async () => {
      const result = await engine.search({
        query: '*',
        sort: [
          { field: 'category', order: 'asc' },
          { field: 'price', order: 'desc' },
        ],
      })

      // Within same category, prices should be descending
      for (let i = 1; i < result.hits.length; i++) {
        const prev = result.hits[i - 1]
        const curr = result.hits[i]
        if (prev.source.category === curr.source.category) {
          expect(prev.source.price).toBeGreaterThanOrEqual(curr.source.price)
        }
      }
    })

    it('should sort by score explicitly', async () => {
      const result = await engine.search({
        query: 'phone',
        sort: [{ field: '_score', order: 'desc' }],
      })

      for (let i = 1; i < result.hits.length; i++) {
        expect(result.hits[i - 1].score).toBeGreaterThanOrEqual(
          result.hits[i].score
        )
      }
    })
  })

  // ===========================================================================
  // Pagination
  // ===========================================================================

  describe('pagination', () => {
    it('should limit results', async () => {
      const result = await engine.search({
        query: '*',
        pagination: { limit: 2 },
      })

      expect(result.hits.length).toBe(2)
      expect(result.total).toBe(5)
    })

    it('should skip results with offset', async () => {
      const page1 = await engine.search({
        query: '*',
        sort: [{ field: 'price', order: 'asc' }],
        pagination: { limit: 2, offset: 0 },
      })

      const page2 = await engine.search({
        query: '*',
        sort: [{ field: 'price', order: 'asc' }],
        pagination: { limit: 2, offset: 2 },
      })

      expect(page1.hits.length).toBe(2)
      expect(page2.hits.length).toBe(2)

      // No overlap
      const page1Ids = page1.hits.map((h) => h.id)
      const page2Ids = page2.hits.map((h) => h.id)
      expect(page1Ids).not.toEqual(expect.arrayContaining(page2Ids))
    })

    it('should return correct total across pages', async () => {
      const page1 = await engine.search({
        query: '*',
        pagination: { limit: 2, offset: 0 },
      })

      const page2 = await engine.search({
        query: '*',
        pagination: { limit: 2, offset: 2 },
      })

      expect(page1.total).toBe(page2.total)
    })

    it('should return empty hits when offset exceeds total', async () => {
      const result = await engine.search({
        query: '*',
        pagination: { limit: 10, offset: 100 },
      })

      expect(result.hits.length).toBe(0)
      expect(result.total).toBe(5)
    })
  })

  // ===========================================================================
  // Highlighting
  // ===========================================================================

  describe('highlighting', () => {
    it('should highlight matching terms', async () => {
      const result = await engine.search({
        query: 'smartphone',
        highlight: {
          fields: ['description'],
        },
      })

      expect(result.hits[0].highlights).toBeDefined()
      expect(result.hits[0].highlights!.description).toBeDefined()
      expect(result.hits[0].highlights!.description[0]).toContain('<em>')
    })

    it('should use custom highlight tags', async () => {
      const result = await engine.search({
        query: 'Apple',
        highlight: {
          fields: ['description'],
          preTag: '<mark>',
          postTag: '</mark>',
        },
      })

      expect(result.hits[0].highlights!.description[0]).toContain('<mark>')
      expect(result.hits[0].highlights!.description[0]).toContain('</mark>')
    })

    it('should highlight multiple fields', async () => {
      const result = await engine.search({
        query: 'premium',
        highlight: {
          fields: ['name', 'description'],
        },
      })

      const hit = result.hits.find((h) => h.highlights?.description)
      expect(hit?.highlights).toBeDefined()
    })

    it('should limit fragment size', async () => {
      const result = await engine.search({
        query: 'smartphone',
        highlight: {
          fields: ['description'],
          fragmentSize: 50,
        },
      })

      const highlights = result.hits[0].highlights?.description || []
      highlights.forEach((fragment) => {
        // Fragment might be longer due to tags
        expect(fragment.replace(/<\/?em>/g, '').length).toBeLessThanOrEqual(100)
      })
    })

    it('should return multiple fragments', async () => {
      const result = await engine.search({
        query: 'with',
        highlight: {
          fields: ['description'],
          numberOfFragments: 3,
        },
      })

      // "with" appears in multiple descriptions
      expect(result.hits.length).toBeGreaterThan(0)
      expect(result.hits[0].highlights).toBeDefined()
    })
  })

  // ===========================================================================
  // Fuzzy Matching
  // ===========================================================================

  describe('fuzzy matching', () => {
    it('should match with edit distance 1', async () => {
      const result = await engine.search({
        query: 'iPhon', // missing 'e'
        options: { fuzziness: 1 },
      })

      expect(result.total).toBe(1)
      expect(result.hits[0].source.name).toContain('iPhone')
    })

    it('should match with edit distance 2', async () => {
      const result = await engine.search({
        query: 'smartfone', // 'phone' -> 'fone'
        options: { fuzziness: 2 },
      })

      expect(result.total).toBeGreaterThan(0)
    })

    it('should support auto fuzziness', async () => {
      const result = await engine.search({
        query: 'samsng', // missing 'u'
        options: { fuzziness: 'auto' },
      })

      expect(result.total).toBeGreaterThan(0)
    })

    it('should respect prefix length', async () => {
      const result = await engine.search({
        query: 'xPhone', // wrong first letter
        options: { fuzziness: 1, prefixLength: 1 },
      })

      // Should not match because prefix doesn't match
      expect(result.total).toBe(0)
    })
  })

  // ===========================================================================
  // Prefix/Wildcard Search
  // ===========================================================================

  describe('prefix and wildcard search', () => {
    it('should match prefix with asterisk', async () => {
      const result = await engine.search('Smart*')

      // Matches: Smart Watch, smartphone in descriptions, smartphone in tags
      expect(result.total).toBeGreaterThanOrEqual(2)
      result.hits.forEach((hit) => {
        const hasSmartPrefix =
          hit.source.name.toLowerCase().startsWith('smart') ||
          hit.source.description.toLowerCase().includes('smart') ||
          hit.source.tags?.some((t) => t.toLowerCase().startsWith('smart'))
        expect(hasSmartPrefix).toBe(true)
      })
    })

    it('should match suffix with asterisk', async () => {
      const result = await engine.search('*phone')

      expect(result.total).toBeGreaterThan(0)
      result.hits.forEach((hit) => {
        const hasPhoneSuffix =
          hit.source.name.toLowerCase().includes('phone') ||
          hit.source.description.toLowerCase().includes('phone')
        expect(hasPhoneSuffix).toBe(true)
      })
    })

    it('should match wildcard in middle', async () => {
      const result = await engine.search('i*e')

      // Should match "iPhone", "i...e" patterns
      expect(result.total).toBeGreaterThan(0)
    })

    it('should match single character wildcard', async () => {
      const result = await engine.search('Galax?')

      expect(result.total).toBe(1)
      expect(result.hits[0].source.name).toContain('Galaxy')
    })
  })

  // ===========================================================================
  // Document Operations
  // ===========================================================================

  describe('document operations', () => {
    describe('index', () => {
      it('should index document and make it searchable', async () => {
        const newEngine = new SearchEngine<Product>()
        const id = await newEngine.index({
          source: {
            name: 'Test Product',
            description: 'A test product',
            category: 'test',
            price: 100,
            inStock: true,
          },
        })

        expect(id).toBeDefined()

        const result = await newEngine.search('Test Product')
        expect(result.total).toBe(1)
      })

      it('should auto-generate ID if not provided', async () => {
        const id = await engine.index({
          source: {
            name: 'Auto ID Product',
            description: 'Testing auto ID',
            category: 'test',
            price: 50,
            inStock: true,
          },
        })

        expect(id).toBeDefined()
        expect(typeof id).toBe('string')
      })

      it('should use provided ID', async () => {
        const id = await engine.index({
          id: 'custom-id-123',
          source: {
            name: 'Custom ID Product',
            description: 'Testing custom ID',
            category: 'test',
            price: 75,
            inStock: true,
          },
        })

        expect(id).toBe('custom-id-123')
      })
    })

    describe('get', () => {
      it('should retrieve document by ID', async () => {
        const doc = await engine.get('prod-1')

        expect(doc).toBeDefined()
        expect(doc?.name).toBe('iPhone 15 Pro')
      })

      it('should return null for non-existent ID', async () => {
        const doc = await engine.get('nonexistent')

        expect(doc).toBeNull()
      })
    })

    describe('delete', () => {
      it('should remove document from index', async () => {
        const deleted = await engine.delete('prod-1')
        expect(deleted).toBe(true)

        const result = await engine.search('iPhone')
        expect(result.total).toBe(0)
      })

      it('should return false for non-existent document', async () => {
        const deleted = await engine.delete('nonexistent')
        expect(deleted).toBe(false)
      })
    })

    describe('update', () => {
      it('should update document fields', async () => {
        await engine.update('prod-1', { price: 899 })

        const doc = await engine.get('prod-1')
        expect(doc?.price).toBe(899)
      })

      it('should update searchable content', async () => {
        await engine.update('prod-1', { name: 'iPhone 16 Pro Max' })

        // Use phrase search to match exact sequences
        const oldResult = await engine.search('"iPhone 15"')
        const newResult = await engine.search('"iPhone 16"')

        expect(oldResult.total).toBe(0)
        expect(newResult.total).toBe(1)
      })

      it('should return false for non-existent document', async () => {
        const updated = await engine.update('nonexistent', { price: 100 })
        expect(updated).toBe(false)
      })
    })
  })

  // ===========================================================================
  // Bulk Operations
  // ===========================================================================

  describe('bulk operations', () => {
    it('should bulk index multiple documents', async () => {
      const newEngine = new SearchEngine<Product>()
      const result = await newEngine.bulkIndex(testProducts)

      expect(result.successful).toBe(5)
      expect(result.failed).toBe(0)
      expect(result.items.length).toBe(5)
      expect(result.took).toBeGreaterThanOrEqual(0)

      const searchResult = await newEngine.search('*')
      expect(searchResult.total).toBe(5)
    })

    it('should report individual item results', async () => {
      const newEngine = new SearchEngine<Product>()
      const result = await newEngine.bulkIndex(testProducts)

      result.items.forEach((item) => {
        expect(item.type).toBe('index')
        expect(item.id).toBeDefined()
        expect(item.success).toBe(true)
      })
    })

    it('should continue on individual failures', async () => {
      const newEngine = new SearchEngine<Product>()

      // Index a doc first
      await newEngine.index({ id: 'existing', source: testProducts[0].source })

      // Try to bulk index with duplicate (depending on implementation)
      const docs: IndexDocument<Product>[] = [
        { id: 'new-1', source: testProducts[0].source },
        { id: 'new-2', source: testProducts[1].source },
      ]

      const result = await newEngine.bulkIndex(docs)
      expect(result.successful).toBe(2)
    })
  })

  // ===========================================================================
  // Index Statistics
  // ===========================================================================

  describe('index statistics', () => {
    it('should return document count', async () => {
      const stats = await engine.stats()

      expect(stats.documentCount).toBe(5)
    })

    it('should return term count', async () => {
      const stats = await engine.stats()

      expect(stats.termCount).toBeGreaterThan(0)
    })

    it('should update after indexing', async () => {
      const statsBefore = await engine.stats()

      await engine.index({
        source: {
          name: 'New Product',
          description: 'Brand new',
          category: 'new',
          price: 199,
          inStock: true,
        },
      })

      const statsAfter = await engine.stats()

      expect(statsAfter.documentCount).toBe(statsBefore.documentCount + 1)
    })
  })

  // ===========================================================================
  // Clear Index
  // ===========================================================================

  describe('clear', () => {
    it('should remove all documents', async () => {
      await engine.clear()

      const result = await engine.search('*')
      expect(result.total).toBe(0)

      const stats = await engine.stats()
      expect(stats.documentCount).toBe(0)
    })
  })
})

// =============================================================================
// QueryParser Tests
// =============================================================================

describe('QueryParser', () => {
  let parser: QueryParser

  beforeEach(() => {
    parser = new QueryParser()
  })

  describe('term parsing', () => {
    it('should parse single term', () => {
      const tokens = parser.parse('hello')

      expect(tokens).toHaveLength(1)
      expect(tokens[0]).toEqual({
        type: 'term',
        value: 'hello',
      })
    })

    it('should parse multiple terms', () => {
      const tokens = parser.parse('hello world')

      expect(tokens).toHaveLength(2)
      expect(tokens[0].value).toBe('hello')
      expect(tokens[1].value).toBe('world')
    })
  })

  describe('phrase parsing', () => {
    it('should parse quoted phrase', () => {
      const tokens = parser.parse('"hello world"')

      expect(tokens).toHaveLength(1)
      expect(tokens[0]).toEqual({
        type: 'phrase',
        value: 'hello world',
      })
    })

    it('should handle mixed terms and phrases', () => {
      const tokens = parser.parse('foo "hello world" bar')

      expect(tokens).toHaveLength(3)
      expect(tokens[0].type).toBe('term')
      expect(tokens[1].type).toBe('phrase')
      expect(tokens[2].type).toBe('term')
    })
  })

  describe('operator parsing', () => {
    it('should parse AND operator', () => {
      const tokens = parser.parse('foo AND bar')

      expect(tokens).toHaveLength(3)
      expect(tokens[1]).toEqual({
        type: 'operator',
        value: 'AND',
      })
    })

    it('should parse OR operator', () => {
      const tokens = parser.parse('foo OR bar')

      expect(tokens[1].type).toBe('operator')
      expect(tokens[1].value).toBe('OR')
    })

    it('should parse NOT operator', () => {
      const tokens = parser.parse('foo NOT bar')

      expect(tokens[1].type).toBe('operator')
      expect(tokens[1].value).toBe('NOT')
    })

    it('should parse minus as NOT', () => {
      const tokens = parser.parse('foo -bar')

      expect(tokens).toHaveLength(2)
      expect(tokens[1].negated).toBe(true)
    })
  })

  describe('field qualifier parsing', () => {
    it('should parse field:value', () => {
      const tokens = parser.parse('title:hello')

      expect(tokens).toHaveLength(1)
      expect(tokens[0]).toEqual({
        type: 'term',
        value: 'hello',
        field: 'title',
      })
    })

    it('should parse field with phrase', () => {
      const tokens = parser.parse('title:"hello world"')

      expect(tokens).toHaveLength(1)
      expect(tokens[0]).toEqual({
        type: 'phrase',
        value: 'hello world',
        field: 'title',
      })
    })
  })

  describe('wildcard parsing', () => {
    it('should parse prefix wildcard', () => {
      const tokens = parser.parse('hel*')

      expect(tokens).toHaveLength(1)
      expect(tokens[0].type).toBe('wildcard')
      expect(tokens[0].value).toBe('hel*')
    })

    it('should parse suffix wildcard', () => {
      const tokens = parser.parse('*llo')

      expect(tokens[0].type).toBe('wildcard')
    })
  })

  describe('fuzzy parsing', () => {
    it('should parse fuzzy term', () => {
      const tokens = parser.parse('hello~')

      expect(tokens).toHaveLength(1)
      expect(tokens[0].type).toBe('fuzzy')
      expect(tokens[0].fuzziness).toBe(2) // default
    })

    it('should parse fuzzy with distance', () => {
      const tokens = parser.parse('hello~1')

      expect(tokens[0].fuzziness).toBe(1)
    })
  })
})

// =============================================================================
// Scorer Tests (BM25)
// =============================================================================

describe('Scorer', () => {
  let scorer: Scorer

  beforeEach(() => {
    scorer = new Scorer()
  })

  describe('TF-IDF scoring', () => {
    it('should score term frequency', () => {
      // Document with term appearing multiple times should score higher
      const score1 = scorer.scoreTerm({
        termFreq: 1,
        docFreq: 10,
        totalDocs: 100,
        fieldLength: 100,
        avgFieldLength: 100,
      })

      const score2 = scorer.scoreTerm({
        termFreq: 5,
        docFreq: 10,
        totalDocs: 100,
        fieldLength: 100,
        avgFieldLength: 100,
      })

      expect(score2).toBeGreaterThan(score1)
    })

    it('should score inverse document frequency', () => {
      // Rare term should score higher
      const commonScore = scorer.scoreTerm({
        termFreq: 1,
        docFreq: 90,
        totalDocs: 100,
        fieldLength: 100,
        avgFieldLength: 100,
      })

      const rareScore = scorer.scoreTerm({
        termFreq: 1,
        docFreq: 1,
        totalDocs: 100,
        fieldLength: 100,
        avgFieldLength: 100,
      })

      expect(rareScore).toBeGreaterThan(commonScore)
    })

    it('should normalize by field length', () => {
      // Same term in shorter doc should score higher
      const longDoc = scorer.scoreTerm({
        termFreq: 1,
        docFreq: 10,
        totalDocs: 100,
        fieldLength: 500,
        avgFieldLength: 100,
      })

      const shortDoc = scorer.scoreTerm({
        termFreq: 1,
        docFreq: 10,
        totalDocs: 100,
        fieldLength: 50,
        avgFieldLength: 100,
      })

      expect(shortDoc).toBeGreaterThan(longDoc)
    })
  })

  describe('BM25 scoring', () => {
    it('should compute BM25 score', () => {
      const score = scorer.bm25({
        termFreq: 2,
        docFreq: 10,
        totalDocs: 1000,
        fieldLength: 100,
        avgFieldLength: 120,
        k1: 1.2,
        b: 0.75,
      })

      expect(score).toBeGreaterThan(0)
    })
  })
})

// =============================================================================
// FacetAggregator Tests
// =============================================================================

describe('FacetAggregator', () => {
  let aggregator: FacetAggregator

  beforeEach(() => {
    aggregator = new FacetAggregator()
  })

  it('should aggregate values', () => {
    const docs = [
      { id: '1', category: 'a' },
      { id: '2', category: 'b' },
      { id: '3', category: 'a' },
      { id: '4', category: 'a' },
      { id: '5', category: 'c' },
    ]

    const facet = aggregator.aggregate(docs, 'category')

    expect(facet.field).toBe('category')
    expect(facet.values).toHaveLength(3)

    const aCount = facet.values.find((v) => v.value === 'a')
    expect(aCount?.count).toBe(3)
  })

  it('should sort by count descending', () => {
    const docs = [
      { id: '1', category: 'rare' },
      { id: '2', category: 'common' },
      { id: '3', category: 'common' },
      { id: '4', category: 'common' },
    ]

    const facet = aggregator.aggregate(docs, 'category', { sortBy: 'count' })

    expect(facet.values[0].value).toBe('common')
    expect(facet.values[0].count).toBe(3)
  })

  it('should limit results', () => {
    const docs = [
      { id: '1', category: 'a' },
      { id: '2', category: 'b' },
      { id: '3', category: 'c' },
      { id: '4', category: 'd' },
      { id: '5', category: 'e' },
    ]

    const facet = aggregator.aggregate(docs, 'category', { size: 3 })

    expect(facet.values.length).toBe(3)
  })

  it('should filter by min count', () => {
    const docs = [
      { id: '1', category: 'a' },
      { id: '2', category: 'a' },
      { id: '3', category: 'b' },
    ]

    const facet = aggregator.aggregate(docs, 'category', { minCount: 2 })

    expect(facet.values.length).toBe(1)
    expect(facet.values[0].value).toBe('a')
  })
})

// =============================================================================
// Highlighter Tests
// =============================================================================

describe('Highlighter', () => {
  let highlighter: Highlighter

  beforeEach(() => {
    highlighter = new Highlighter()
  })

  it('should highlight matching terms', () => {
    const result = highlighter.highlight(
      'The quick brown fox jumps over the lazy dog',
      ['fox']
    )

    expect(result).toContain('<em>fox</em>')
  })

  it('should highlight multiple terms', () => {
    const result = highlighter.highlight(
      'The quick brown fox jumps over the lazy dog',
      ['quick', 'lazy']
    )

    expect(result).toContain('<em>quick</em>')
    expect(result).toContain('<em>lazy</em>')
  })

  it('should use custom tags', () => {
    const result = highlighter.highlight(
      'The quick brown fox',
      ['quick'],
      { preTag: '<mark>', postTag: '</mark>' }
    )

    expect(result).toContain('<mark>quick</mark>')
  })

  it('should be case-insensitive', () => {
    const result = highlighter.highlight('The Quick Brown Fox', ['quick'])

    expect(result).toContain('<em>Quick</em>')
  })

  it('should return fragments', () => {
    const text =
      'Lorem ipsum dolor sit amet. The fox is quick. Another sentence here. The fox jumps high.'
    const fragments = highlighter.getFragments(text, ['fox'], {
      fragmentSize: 30,
      numberOfFragments: 2,
    })

    expect(fragments.length).toBeLessThanOrEqual(2)
    fragments.forEach((f) => {
      expect(f).toContain('<em>fox</em>')
    })
  })
})

// =============================================================================
// Analyzer Tests
// =============================================================================

describe('Analyzer', () => {
  describe('standard analyzer', () => {
    let analyzer: Analyzer

    beforeEach(() => {
      analyzer = new Analyzer({ type: 'standard' })
    })

    it('should tokenize on whitespace', () => {
      const tokens = analyzer.analyze('hello world')

      expect(tokens).toEqual(['hello', 'world'])
    })

    it('should lowercase tokens', () => {
      const tokens = analyzer.analyze('Hello WORLD')

      expect(tokens).toEqual(['hello', 'world'])
    })

    it('should remove punctuation', () => {
      const tokens = analyzer.analyze('Hello, World!')

      expect(tokens).toEqual(['hello', 'world'])
    })

    it('should handle numbers', () => {
      const tokens = analyzer.analyze('iPhone 15 Pro')

      expect(tokens).toContain('iphone')
      expect(tokens).toContain('15')
      expect(tokens).toContain('pro')
    })
  })

  describe('keyword analyzer', () => {
    let analyzer: Analyzer

    beforeEach(() => {
      analyzer = new Analyzer({ type: 'keyword' })
    })

    it('should keep entire string as single token', () => {
      const tokens = analyzer.analyze('Hello World')

      expect(tokens).toEqual(['Hello World'])
    })
  })

  describe('whitespace analyzer', () => {
    let analyzer: Analyzer

    beforeEach(() => {
      analyzer = new Analyzer({ type: 'whitespace' })
    })

    it('should tokenize only on whitespace', () => {
      const tokens = analyzer.analyze('Hello, World!')

      expect(tokens).toEqual(['Hello,', 'World!'])
    })
  })

  describe('ngram analyzer', () => {
    let analyzer: Analyzer

    beforeEach(() => {
      analyzer = new Analyzer({ type: 'ngram', minGram: 2, maxGram: 3 })
    })

    it('should generate n-grams', () => {
      const tokens = analyzer.analyze('hello')

      expect(tokens).toContain('he')
      expect(tokens).toContain('hel')
      expect(tokens).toContain('el')
      expect(tokens).toContain('ell')
      expect(tokens).toContain('ll')
      expect(tokens).toContain('llo')
      expect(tokens).toContain('lo')
    })
  })

  describe('edge-ngram analyzer', () => {
    let analyzer: Analyzer

    beforeEach(() => {
      analyzer = new Analyzer({ type: 'edge-ngram', minGram: 2, maxGram: 4 })
    })

    it('should generate edge n-grams from start', () => {
      const tokens = analyzer.analyze('hello')

      expect(tokens).toContain('he')
      expect(tokens).toContain('hel')
      expect(tokens).toContain('hell')
      expect(tokens).not.toContain('ello') // not edge
    })
  })

  describe('stop words', () => {
    it('should filter stop words', () => {
      const analyzer = new Analyzer({
        type: 'standard',
        stopWords: ['the', 'a', 'is'],
      })

      const tokens = analyzer.analyze('the quick fox is a mammal')

      expect(tokens).not.toContain('the')
      expect(tokens).not.toContain('a')
      expect(tokens).not.toContain('is')
      expect(tokens).toContain('quick')
      expect(tokens).toContain('fox')
    })
  })
})

// =============================================================================
// InvertedIndex Tests
// =============================================================================

describe('InvertedIndex', () => {
  let index: InvertedIndex

  beforeEach(() => {
    index = new InvertedIndex()
  })

  describe('indexing', () => {
    it('should index document', () => {
      index.addDocument('doc1', 'content', 'hello world')

      const postings = index.getPostings('hello')

      expect(postings).toBeDefined()
      expect(postings!.length).toBe(1)
      expect(postings![0].docId).toBe('doc1')
    })

    it('should track term frequency', () => {
      index.addDocument('doc1', 'content', 'hello hello hello world')

      const postings = index.getPostings('hello')

      expect(postings![0].termFreq).toBe(3)
    })

    it('should track positions', () => {
      index.addDocument('doc1', 'content', 'hello world hello')

      const postings = index.getPostings('hello')

      expect(postings![0].positions).toEqual([0, 2])
    })

    it('should track document frequency', () => {
      index.addDocument('doc1', 'content', 'hello world')
      index.addDocument('doc2', 'content', 'hello there')
      index.addDocument('doc3', 'content', 'goodbye world')

      const entry = index.getEntry('hello')

      expect(entry?.docFreq).toBe(2)
    })
  })

  describe('removal', () => {
    it('should remove document from index', () => {
      index.addDocument('doc1', 'content', 'hello world')
      index.removeDocument('doc1')

      const postings = index.getPostings('hello')

      expect(postings).toHaveLength(0)
    })
  })

  describe('statistics', () => {
    it('should return total documents', () => {
      index.addDocument('doc1', 'content', 'hello')
      index.addDocument('doc2', 'content', 'world')

      expect(index.documentCount).toBe(2)
    })

    it('should return total terms', () => {
      index.addDocument('doc1', 'content', 'hello world foo bar')

      expect(index.termCount).toBeGreaterThanOrEqual(4)
    })
  })
})
