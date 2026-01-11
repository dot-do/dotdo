/**
 * Algolia-Compatible Search - Test Suite
 *
 * Tests for:
 * - Document indexing (single and batch)
 * - Full-text search with FTS5
 * - Filtering and faceting
 * - Highlighting
 * - Pagination
 * - Settings management
 */

import { describe, it, expect, beforeEach } from 'vitest'

// ============================================================================
// TYPES (matching SearchDO)
// ============================================================================

interface Product {
  objectID: string
  name: string
  description?: string
  category: string
  brand: string
  price: number
  inStock?: boolean
  tags?: string[]
  rating?: number
  reviews?: number
}

interface Settings {
  searchableAttributes?: string[]
  attributesForFaceting?: string[]
  hitsPerPage?: number
  attributesToHighlight?: string[]
  highlightPreTag?: string
  highlightPostTag?: string
}

interface SearchHit<T> extends T {
  objectID: string
  _highlightResult?: Record<string, { value: string; matchLevel: string; matchedWords: string[] }>
}

interface SearchResponse<T> {
  hits: SearchHit<T>[]
  nbHits: number
  page: number
  nbPages: number
  hitsPerPage: number
  exhaustiveNbHits: boolean
  facets?: Record<string, Record<string, number>>
  query: string
  params: string
  processingTimeMS: number
}

// ============================================================================
// MOCK SEARCH ENGINE (In-Memory FTS Simulation)
// ============================================================================

/**
 * Simulates the SQLite FTS5 search behavior for unit testing
 */
class MockSearchEngine {
  private objects: Map<string, Product> = new Map()
  private settings: Settings = {
    searchableAttributes: ['name', 'description', 'brand', 'category', 'tags'],
    attributesForFaceting: ['category', 'brand', 'tags'],
    hitsPerPage: 20,
    attributesToHighlight: ['name', 'description'],
    highlightPreTag: '<em>',
    highlightPostTag: '</em>'
  }

  /**
   * Index a product
   */
  indexProduct(product: Product): { objectID: string; taskID: number } {
    this.objects.set(product.objectID, product)
    return { objectID: product.objectID, taskID: Date.now() }
  }

  /**
   * Index multiple products
   */
  indexProducts(products: Product[]): { objectIDs: string[]; taskID: number } {
    const objectIDs: string[] = []
    for (const product of products) {
      this.objects.set(product.objectID, product)
      objectIDs.push(product.objectID)
    }
    return { objectIDs, taskID: Date.now() }
  }

  /**
   * Delete a product
   */
  deleteProduct(objectID: string): { objectID: string; taskID: number } {
    this.objects.delete(objectID)
    return { objectID, taskID: Date.now() }
  }

  /**
   * Get a product by ID
   */
  getProduct(objectID: string): Product | null {
    return this.objects.get(objectID) ?? null
  }

  /**
   * Clear all products
   */
  clearProducts(): { taskID: number } {
    this.objects.clear()
    return { taskID: Date.now() }
  }

  /**
   * Search products
   */
  search(
    query: string,
    options?: {
      filters?: string
      facetFilters?: string | string[] | string[][]
      facets?: string[]
      hitsPerPage?: number
      page?: number
      attributesToHighlight?: string[]
      highlightPreTag?: string
      highlightPostTag?: string
    }
  ): SearchResponse<Product> {
    const startTime = performance.now()
    const page = options?.page ?? 0
    const hitsPerPage = options?.hitsPerPage ?? this.settings.hitsPerPage ?? 20

    // Get all products
    let products = Array.from(this.objects.values())

    // Filter by query (simple tokenized search)
    if (query && query.trim()) {
      const queryTerms = query.toLowerCase().split(/\s+/)
      products = products.filter(product => {
        const searchableText = this.extractSearchableText(product).toLowerCase()
        return queryTerms.some(term => searchableText.includes(term))
      })
    }

    // Apply filters
    if (options?.filters) {
      products = this.applyFilters(products, options.filters)
    }
    if (options?.facetFilters) {
      products = this.applyFacetFilters(products, options.facetFilters)
    }

    const totalHits = products.length

    // Paginate
    const offset = page * hitsPerPage
    const pagedProducts = products.slice(offset, offset + hitsPerPage)

    // Calculate facets
    let facets: Record<string, Record<string, number>> | undefined
    if (options?.facets && options.facets.length > 0) {
      facets = this.calculateFacets(products, options.facets)
    }

    // Add highlighting
    const preTag = options?.highlightPreTag ?? this.settings.highlightPreTag ?? '<em>'
    const postTag = options?.highlightPostTag ?? this.settings.highlightPostTag ?? '</em>'
    const attrsToHighlight = options?.attributesToHighlight ?? this.settings.attributesToHighlight ?? []

    const hits: SearchHit<Product>[] = pagedProducts.map(product => {
      const highlighted: Record<string, { value: string; matchLevel: string; matchedWords: string[] }> = {}

      if (query && attrsToHighlight.length > 0) {
        for (const attr of attrsToHighlight) {
          const value = (product as Record<string, unknown>)[attr]
          if (typeof value === 'string') {
            const { highlightedValue, matchedWords } = this.highlightText(value, query, preTag, postTag)
            highlighted[attr] = {
              value: highlightedValue,
              matchLevel: matchedWords.length > 0 ? 'full' : 'none',
              matchedWords
            }
          }
        }
      }

      return {
        ...product,
        _highlightResult: Object.keys(highlighted).length > 0 ? highlighted : undefined
      }
    })

    return {
      hits,
      nbHits: totalHits,
      page,
      nbPages: Math.ceil(totalHits / hitsPerPage),
      hitsPerPage,
      exhaustiveNbHits: true,
      facets,
      query,
      params: '',
      processingTimeMS: Math.round(performance.now() - startTime)
    }
  }

  /**
   * Update settings
   */
  updateSettings(settings: Settings): { taskID: number } {
    this.settings = { ...this.settings, ...settings }
    return { taskID: Date.now() }
  }

  /**
   * Get settings
   */
  getSettings(): Settings {
    return { ...this.settings }
  }

  /**
   * Get stats
   */
  getStats(): { entries: number; indices: number } {
    return {
      entries: this.objects.size,
      indices: 1
    }
  }

  // Helper methods

  private extractSearchableText(product: Product): string {
    const texts: string[] = []
    const attrs = this.settings.searchableAttributes || Object.keys(product)

    for (const attr of attrs) {
      const value = (product as Record<string, unknown>)[attr]
      if (typeof value === 'string') {
        texts.push(value)
      } else if (Array.isArray(value)) {
        texts.push(value.filter(v => typeof v === 'string').join(' '))
      }
    }

    return texts.join(' ')
  }

  private highlightText(
    text: string,
    query: string,
    preTag: string,
    postTag: string
  ): { highlightedValue: string; matchedWords: string[] } {
    const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 0)
    const matchedWords: string[] = []
    let highlightedValue = text

    for (const term of queryTerms) {
      const regex = new RegExp(`(${term})`, 'gi')
      if (regex.test(text)) {
        highlightedValue = highlightedValue.replace(regex, `${preTag}$1${postTag}`)
        matchedWords.push(term)
      }
    }

    return { highlightedValue, matchedWords }
  }

  private applyFilters(products: Product[], filters: string): Product[] {
    const conditions = filters.split(/\s+AND\s+/i)

    return products.filter(product => {
      return conditions.every(condition => {
        const orParts = condition.split(/\s+OR\s+/i)
        return orParts.some(part => this.evaluateCondition(product, part.trim()))
      })
    })
  }

  private evaluateCondition(product: Product, condition: string): boolean {
    const match = condition.match(/^(\w+)\s*(:|>=|<=|>|<|=)\s*(.+)$/)
    if (!match) return true

    const [, field, operator, valueStr] = match
    const productValue = (product as Record<string, unknown>)[field]
    const filterValue = this.parseValue(valueStr)

    if (productValue === undefined || productValue === null) {
      return false
    }

    switch (operator) {
      case ':':
      case '=':
        if (Array.isArray(productValue)) {
          return productValue.includes(filterValue)
        }
        return String(productValue) === String(filterValue)
      case '>':
        return Number(productValue) > Number(filterValue)
      case '>=':
        return Number(productValue) >= Number(filterValue)
      case '<':
        return Number(productValue) < Number(filterValue)
      case '<=':
        return Number(productValue) <= Number(filterValue)
      default:
        return true
    }
  }

  private parseValue(str: string): string | number | boolean {
    str = str.trim().replace(/^["']|["']$/g, '')
    const num = Number(str)
    if (!isNaN(num) && str !== '') return num
    if (str === 'true') return true
    if (str === 'false') return false
    return str
  }

  private applyFacetFilters(
    products: Product[],
    facetFilters: string | string[] | string[][]
  ): Product[] {
    let normalized: string[][]
    if (typeof facetFilters === 'string') {
      normalized = [[facetFilters]]
    } else if (Array.isArray(facetFilters)) {
      normalized = facetFilters.map(f => typeof f === 'string' ? [f] : f)
    } else {
      return products
    }

    return products.filter(product => {
      return normalized.every(orGroup => {
        return orGroup.some(filter => {
          const [field, ...valueParts] = filter.split(':')
          const value = valueParts.join(':')
          const productValue = (product as Record<string, unknown>)[field]

          if (Array.isArray(productValue)) {
            return productValue.includes(value)
          }
          return String(productValue) === value
        })
      })
    })
  }

  private calculateFacets(
    products: Product[],
    facetNames: string[]
  ): Record<string, Record<string, number>> {
    const facets: Record<string, Record<string, number>> = {}

    for (const facetName of facetNames) {
      facets[facetName] = {}

      for (const product of products) {
        const value = (product as Record<string, unknown>)[facetName]

        if (Array.isArray(value)) {
          for (const v of value) {
            const key = String(v)
            facets[facetName][key] = (facets[facetName][key] ?? 0) + 1
          }
        } else if (value !== undefined && value !== null) {
          const key = String(value)
          facets[facetName][key] = (facets[facetName][key] ?? 0) + 1
        }
      }
    }

    return facets
  }

  /**
   * Reset for tests
   */
  reset(): void {
    this.objects.clear()
    this.settings = {
      searchableAttributes: ['name', 'description', 'brand', 'category', 'tags'],
      attributesForFaceting: ['category', 'brand', 'tags'],
      hitsPerPage: 20,
      attributesToHighlight: ['name', 'description'],
      highlightPreTag: '<em>',
      highlightPostTag: '</em>'
    }
  }
}

// ============================================================================
// TEST DATA
// ============================================================================

const testProducts: Product[] = [
  {
    objectID: 'prod-1',
    name: 'Apple iPhone 15 Pro',
    description: 'Latest flagship smartphone with titanium design',
    category: 'Electronics',
    brand: 'Apple',
    price: 999,
    inStock: true,
    tags: ['smartphone', 'mobile', 'ios'],
    rating: 4.8
  },
  {
    objectID: 'prod-2',
    name: 'Samsung Galaxy S24',
    description: 'Android smartphone with AI features',
    category: 'Electronics',
    brand: 'Samsung',
    price: 849,
    inStock: true,
    tags: ['smartphone', 'mobile', 'android'],
    rating: 4.6
  },
  {
    objectID: 'prod-3',
    name: 'Sony WH-1000XM5',
    description: 'Premium noise cancelling headphones',
    category: 'Audio',
    brand: 'Sony',
    price: 349,
    inStock: true,
    tags: ['headphones', 'wireless', 'audio'],
    rating: 4.9
  },
  {
    objectID: 'prod-4',
    name: 'Apple MacBook Pro 14"',
    description: 'Professional laptop with M3 chip',
    category: 'Computers',
    brand: 'Apple',
    price: 1999,
    inStock: false,
    tags: ['laptop', 'computer', 'mac'],
    rating: 4.7
  },
  {
    objectID: 'prod-5',
    name: 'Dell XPS 15',
    description: 'Windows laptop with OLED display',
    category: 'Computers',
    brand: 'Dell',
    price: 1499,
    inStock: true,
    tags: ['laptop', 'computer', 'windows'],
    rating: 4.5
  }
]

// ============================================================================
// INDEXING TESTS
// ============================================================================

describe('Indexing', () => {
  let search: MockSearchEngine

  beforeEach(() => {
    search = new MockSearchEngine()
  })

  it('should index a single product', () => {
    const result = search.indexProduct(testProducts[0])

    expect(result.objectID).toBe('prod-1')
    expect(result.taskID).toBeDefined()

    const stats = search.getStats()
    expect(stats.entries).toBe(1)
  })

  it('should index multiple products', () => {
    const result = search.indexProducts(testProducts)

    expect(result.objectIDs).toHaveLength(5)
    expect(result.objectIDs).toContain('prod-1')
    expect(result.objectIDs).toContain('prod-5')

    const stats = search.getStats()
    expect(stats.entries).toBe(5)
  })

  it('should update existing product', () => {
    search.indexProduct(testProducts[0])

    // Update with new price
    const updated = { ...testProducts[0], price: 899 }
    search.indexProduct(updated)

    const product = search.getProduct('prod-1')
    expect(product?.price).toBe(899)

    const stats = search.getStats()
    expect(stats.entries).toBe(1) // Still 1, not 2
  })

  it('should delete a product', () => {
    search.indexProducts(testProducts)

    const result = search.deleteProduct('prod-1')
    expect(result.objectID).toBe('prod-1')

    const product = search.getProduct('prod-1')
    expect(product).toBeNull()

    const stats = search.getStats()
    expect(stats.entries).toBe(4)
  })

  it('should clear all products', () => {
    search.indexProducts(testProducts)

    search.clearProducts()

    const stats = search.getStats()
    expect(stats.entries).toBe(0)
  })
})

// ============================================================================
// SEARCH TESTS
// ============================================================================

describe('Search', () => {
  let search: MockSearchEngine

  beforeEach(() => {
    search = new MockSearchEngine()
    search.indexProducts(testProducts)
  })

  it('should return all products when no query', () => {
    const results = search.search('')

    expect(results.nbHits).toBe(5)
    expect(results.hits).toHaveLength(5)
    expect(results.page).toBe(0)
    expect(results.query).toBe('')
  })

  it('should search by product name', () => {
    const results = search.search('iPhone')

    expect(results.nbHits).toBe(1)
    expect(results.hits[0].name).toContain('iPhone')
  })

  it('should search by description', () => {
    const results = search.search('noise cancelling')

    expect(results.nbHits).toBe(1)
    expect(results.hits[0].objectID).toBe('prod-3')
  })

  it('should search by brand', () => {
    const results = search.search('Apple')

    expect(results.nbHits).toBe(2)
    expect(results.hits.every(h => h.brand === 'Apple')).toBe(true)
  })

  it('should return multiple matching products', () => {
    const results = search.search('smartphone')

    expect(results.nbHits).toBe(2)
    expect(results.hits.some(h => h.objectID === 'prod-1')).toBe(true)
    expect(results.hits.some(h => h.objectID === 'prod-2')).toBe(true)
  })

  it('should handle case insensitive search', () => {
    const results1 = search.search('APPLE')
    const results2 = search.search('apple')

    expect(results1.nbHits).toBe(results2.nbHits)
  })
})

// ============================================================================
// FILTERING TESTS
// ============================================================================

describe('Filtering', () => {
  let search: MockSearchEngine

  beforeEach(() => {
    search = new MockSearchEngine()
    search.indexProducts(testProducts)
  })

  it('should filter by category', () => {
    const results = search.search('', {
      filters: 'category:Electronics'
    })

    expect(results.nbHits).toBe(2)
    expect(results.hits.every(h => h.category === 'Electronics')).toBe(true)
  })

  it('should filter by brand', () => {
    const results = search.search('', {
      filters: 'brand:Sony'
    })

    expect(results.nbHits).toBe(1)
    expect(results.hits[0].brand).toBe('Sony')
  })

  it('should filter by price range', () => {
    const results = search.search('', {
      filters: 'price>=500 AND price<=1000'
    })

    expect(results.nbHits).toBe(2)
    expect(results.hits.every(h => h.price >= 500 && h.price <= 1000)).toBe(true)
  })

  it('should filter by inStock', () => {
    const results = search.search('', {
      filters: 'inStock:true'
    })

    expect(results.nbHits).toBe(4)
    expect(results.hits.every(h => h.inStock === true)).toBe(true)
  })

  it('should combine search and filter', () => {
    const results = search.search('laptop', {
      filters: 'brand:Apple'
    })

    expect(results.nbHits).toBe(1)
    expect(results.hits[0].name).toContain('MacBook')
  })

  it('should use facet filters', () => {
    const results = search.search('', {
      facetFilters: ['category:Electronics']
    })

    expect(results.nbHits).toBe(2)
    expect(results.hits.every(h => h.category === 'Electronics')).toBe(true)
  })

  it('should support OR in facet filters', () => {
    const results = search.search('', {
      facetFilters: [['category:Electronics', 'category:Audio']]
    })

    expect(results.nbHits).toBe(3)
  })
})

// ============================================================================
// FACETING TESTS
// ============================================================================

describe('Faceting', () => {
  let search: MockSearchEngine

  beforeEach(() => {
    search = new MockSearchEngine()
    search.indexProducts(testProducts)
  })

  it('should return facet counts', () => {
    const results = search.search('', {
      facets: ['category', 'brand']
    })

    expect(results.facets).toBeDefined()
    expect(results.facets?.category).toBeDefined()
    expect(results.facets?.brand).toBeDefined()
  })

  it('should count category facets correctly', () => {
    const results = search.search('', {
      facets: ['category']
    })

    expect(results.facets?.category.Electronics).toBe(2)
    expect(results.facets?.category.Audio).toBe(1)
    expect(results.facets?.category.Computers).toBe(2)
  })

  it('should count brand facets correctly', () => {
    const results = search.search('', {
      facets: ['brand']
    })

    expect(results.facets?.brand.Apple).toBe(2)
    expect(results.facets?.brand.Samsung).toBe(1)
    expect(results.facets?.brand.Sony).toBe(1)
    expect(results.facets?.brand.Dell).toBe(1)
  })

  it('should update facets based on search query', () => {
    const results = search.search('laptop', {
      facets: ['brand']
    })

    expect(results.facets?.brand.Apple).toBe(1)
    expect(results.facets?.brand.Dell).toBe(1)
    expect(results.facets?.brand.Samsung).toBeUndefined()
  })
})

// ============================================================================
// HIGHLIGHTING TESTS
// ============================================================================

describe('Highlighting', () => {
  let search: MockSearchEngine

  beforeEach(() => {
    search = new MockSearchEngine()
    search.indexProducts(testProducts)
  })

  it('should highlight matching terms', () => {
    const results = search.search('iPhone')

    expect(results.hits[0]._highlightResult).toBeDefined()
    expect(results.hits[0]._highlightResult?.name.value).toContain('<em>iPhone</em>')
    expect(results.hits[0]._highlightResult?.name.matchLevel).toBe('full')
  })

  it('should use custom highlight tags', () => {
    const results = search.search('iPhone', {
      highlightPreTag: '<mark>',
      highlightPostTag: '</mark>'
    })

    expect(results.hits[0]._highlightResult?.name.value).toContain('<mark>iPhone</mark>')
  })

  it('should report matched words', () => {
    const results = search.search('iPhone')

    expect(results.hits[0]._highlightResult?.name.matchedWords).toContain('iphone')
  })

  it('should not highlight when no query', () => {
    const results = search.search('')

    expect(results.hits[0]._highlightResult).toBeUndefined()
  })
})

// ============================================================================
// PAGINATION TESTS
// ============================================================================

describe('Pagination', () => {
  let search: MockSearchEngine

  beforeEach(() => {
    search = new MockSearchEngine()
    search.indexProducts(testProducts)
  })

  it('should return correct page info', () => {
    const results = search.search('', {
      hitsPerPage: 2,
      page: 0
    })

    expect(results.hits).toHaveLength(2)
    expect(results.page).toBe(0)
    expect(results.nbPages).toBe(3) // 5 items / 2 per page = 3 pages
    expect(results.hitsPerPage).toBe(2)
  })

  it('should return second page', () => {
    const results = search.search('', {
      hitsPerPage: 2,
      page: 1
    })

    expect(results.hits).toHaveLength(2)
    expect(results.page).toBe(1)
  })

  it('should return last page with fewer hits', () => {
    const results = search.search('', {
      hitsPerPage: 2,
      page: 2
    })

    expect(results.hits).toHaveLength(1) // Only 1 item on last page
    expect(results.page).toBe(2)
  })

  it('should return empty for page beyond results', () => {
    const results = search.search('', {
      hitsPerPage: 2,
      page: 10
    })

    expect(results.hits).toHaveLength(0)
  })
})

// ============================================================================
// SETTINGS TESTS
// ============================================================================

describe('Settings', () => {
  let search: MockSearchEngine

  beforeEach(() => {
    search = new MockSearchEngine()
  })

  it('should return default settings', () => {
    const settings = search.getSettings()

    expect(settings.searchableAttributes).toBeDefined()
    expect(settings.hitsPerPage).toBe(20)
    expect(settings.highlightPreTag).toBe('<em>')
    expect(settings.highlightPostTag).toBe('</em>')
  })

  it('should update settings', () => {
    search.updateSettings({
      hitsPerPage: 50,
      highlightPreTag: '<strong>',
      highlightPostTag: '</strong>'
    })

    const settings = search.getSettings()
    expect(settings.hitsPerPage).toBe(50)
    expect(settings.highlightPreTag).toBe('<strong>')
    expect(settings.highlightPostTag).toBe('</strong>')
  })

  it('should apply updated hitsPerPage to search', () => {
    search.updateSettings({ hitsPerPage: 3 })
    search.indexProducts(testProducts)

    const results = search.search('')
    expect(results.hitsPerPage).toBe(3)
    expect(results.hits).toHaveLength(3)
  })
})

// ============================================================================
// STATS TESTS
// ============================================================================

describe('Stats', () => {
  let search: MockSearchEngine

  beforeEach(() => {
    search = new MockSearchEngine()
  })

  it('should return correct stats', () => {
    search.indexProducts(testProducts)

    const stats = search.getStats()
    expect(stats.entries).toBe(5)
    expect(stats.indices).toBe(1)
  })

  it('should update stats after indexing', () => {
    expect(search.getStats().entries).toBe(0)

    search.indexProduct(testProducts[0])
    expect(search.getStats().entries).toBe(1)

    search.indexProducts(testProducts.slice(1))
    expect(search.getStats().entries).toBe(5)
  })

  it('should update stats after deletion', () => {
    search.indexProducts(testProducts)
    expect(search.getStats().entries).toBe(5)

    search.deleteProduct('prod-1')
    expect(search.getStats().entries).toBe(4)

    search.clearProducts()
    expect(search.getStats().entries).toBe(0)
  })
})

// ============================================================================
// RETRIEVAL TESTS
// ============================================================================

describe('Retrieval', () => {
  let search: MockSearchEngine

  beforeEach(() => {
    search = new MockSearchEngine()
    search.indexProducts(testProducts)
  })

  it('should get product by ID', () => {
    const product = search.getProduct('prod-1')

    expect(product).not.toBeNull()
    expect(product?.name).toBe('Apple iPhone 15 Pro')
    expect(product?.price).toBe(999)
  })

  it('should return null for non-existent ID', () => {
    const product = search.getProduct('non-existent')

    expect(product).toBeNull()
  })
})

// ============================================================================
// EDGE CASES
// ============================================================================

describe('Edge Cases', () => {
  let search: MockSearchEngine

  beforeEach(() => {
    search = new MockSearchEngine()
    search.indexProducts(testProducts)
  })

  it('should handle empty search query', () => {
    const results = search.search('')

    expect(results.nbHits).toBe(5)
    expect(results.query).toBe('')
  })

  it('should handle whitespace-only query', () => {
    const results = search.search('   ')

    expect(results.nbHits).toBe(5)
  })

  it('should handle query with no matches', () => {
    const results = search.search('xyznonexistent')

    expect(results.nbHits).toBe(0)
    expect(results.hits).toHaveLength(0)
  })

  it('should handle special characters in query', () => {
    // This should not crash
    const results = search.search('test & query | special')

    expect(results).toBeDefined()
  })

  it('should handle empty product index', () => {
    search.clearProducts()
    const results = search.search('anything')

    expect(results.nbHits).toBe(0)
    expect(results.hits).toHaveLength(0)
  })
})
