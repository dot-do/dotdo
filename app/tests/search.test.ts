import { describe, it, expect, beforeAll } from 'vitest'

// These imports will fail until search is implemented
// @ts-expect-error - module not yet implemented
import { createSearchClient, SearchClient } from '../lib/search/client'
// @ts-expect-error - module not yet implemented
import { generateSearchIndex } from '../lib/search/indexer'
// @ts-expect-error - module not yet implemented
import { searchHandler } from '../api/search'

describe('Search API', () => {
  describe('GET /api/search', () => {
    it('returns search results for valid query', async () => {
      const request = new Request('http://localhost/api/search?q=test')
      const response = await searchHandler(request)

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data).toHaveProperty('results')
      expect(Array.isArray(data.results)).toBe(true)
    })

    it('returns empty results for empty query', async () => {
      const request = new Request('http://localhost/api/search?q=')
      const response = await searchHandler(request)

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.results).toEqual([])
    })

    it('returns empty results when query parameter is missing', async () => {
      const request = new Request('http://localhost/api/search')
      const response = await searchHandler(request)

      expect(response.status).toBe(200)

      const data = await response.json()
      expect(data.results).toEqual([])
    })
  })
})

describe('Search Result Structure', () => {
  it('includes title in search results', async () => {
    const request = new Request('http://localhost/api/search?q=documentation')
    const response = await searchHandler(request)
    const data = await response.json()

    expect(data.results.length).toBeGreaterThan(0)
    expect(data.results[0]).toHaveProperty('title')
    expect(typeof data.results[0].title).toBe('string')
  })

  it('includes url in search results', async () => {
    const request = new Request('http://localhost/api/search?q=documentation')
    const response = await searchHandler(request)
    const data = await response.json()

    expect(data.results.length).toBeGreaterThan(0)
    expect(data.results[0]).toHaveProperty('url')
    expect(typeof data.results[0].url).toBe('string')
  })

  it('includes description in search results', async () => {
    const request = new Request('http://localhost/api/search?q=documentation')
    const response = await searchHandler(request)
    const data = await response.json()

    expect(data.results.length).toBeGreaterThan(0)
    expect(data.results[0]).toHaveProperty('description')
    expect(typeof data.results[0].description).toBe('string')
  })

  it('includes relevance score in search results', async () => {
    const request = new Request('http://localhost/api/search?q=documentation')
    const response = await searchHandler(request)
    const data = await response.json()

    expect(data.results.length).toBeGreaterThan(0)
    expect(data.results[0]).toHaveProperty('score')
    expect(typeof data.results[0].score).toBe('number')
  })
})

describe('Search Ranking', () => {
  it('ranks results by relevance score in descending order', async () => {
    const request = new Request('http://localhost/api/search?q=test')
    const response = await searchHandler(request)
    const data = await response.json()

    expect(data.results.length).toBeGreaterThan(1)

    for (let i = 0; i < data.results.length - 1; i++) {
      expect(data.results[i].score).toBeGreaterThanOrEqual(data.results[i + 1].score)
    }
  })

  it('gives higher score to exact matches', async () => {
    const request = new Request('http://localhost/api/search?q=getting%20started')
    const response = await searchHandler(request)
    const data = await response.json()

    // Exact phrase match should be ranked higher
    const exactMatch = data.results.find((r: { title: string }) => r.title.toLowerCase().includes('getting started'))
    expect(exactMatch).toBeDefined()
    expect(data.results[0].title.toLowerCase()).toContain('getting started')
  })

  it('considers title matches more important than description matches', async () => {
    const request = new Request('http://localhost/api/search?q=introduction')
    const response = await searchHandler(request)
    const data = await response.json()

    expect(data.results.length).toBeGreaterThan(0)
    // Result with "introduction" in title should rank higher than one with it only in description
    const titleMatch = data.results.find((r: { title: string }) => r.title.toLowerCase().includes('introduction'))
    if (titleMatch && data.results.length > 1) {
      expect(data.results.indexOf(titleMatch)).toBeLessThan(data.results.length / 2)
    }
  })
})

describe('Search Index Generation', () => {
  it('generates search index from content', async () => {
    const content = [
      {
        id: '1',
        title: 'Getting Started',
        url: '/docs/getting-started',
        description: 'Learn how to get started with our platform',
        content: 'This guide will help you get started quickly.',
      },
      {
        id: '2',
        title: 'API Reference',
        url: '/docs/api',
        description: 'Complete API documentation',
        content: 'Full reference for all API endpoints.',
      },
    ]

    const index = await generateSearchIndex(content)

    expect(index).toBeDefined()
    expect(typeof index).toBe('object')
  })

  it('index can be serialized for static export', async () => {
    const content = [
      {
        id: '1',
        title: 'Test Page',
        url: '/test',
        description: 'A test page',
        content: 'Test content',
      },
    ]

    const index = await generateSearchIndex(content)
    const serialized = JSON.stringify(index)

    expect(typeof serialized).toBe('string')
    expect(() => JSON.parse(serialized)).not.toThrow()
  })

  it('index is generated at build time', async () => {
    // This test verifies that the search index file exists (generated during build)
    // @ts-expect-error - module not yet implemented
    const { searchIndex } = await import('../.generated/search-index.json')

    expect(searchIndex).toBeDefined()
  })
})

describe('Partial Matching', () => {
  it('finds results with partial word matches', async () => {
    const request = new Request('http://localhost/api/search?q=doc')
    const response = await searchHandler(request)
    const data = await response.json()

    // Should match "documentation", "docs", "document", etc.
    expect(data.results.length).toBeGreaterThan(0)
  })

  it('finds results with prefix matching', async () => {
    const request = new Request('http://localhost/api/search?q=intro')
    const response = await searchHandler(request)
    const data = await response.json()

    // Should match "introduction", "introducing", etc.
    const hasMatch = data.results.some(
      (r: { title: string; description: string }) => r.title.toLowerCase().includes('intro') || r.description.toLowerCase().includes('intro'),
    )
    expect(hasMatch).toBe(true)
  })

  it('handles typo tolerance', async () => {
    const request = new Request('http://localhost/api/search?q=documntation')
    const response = await searchHandler(request)
    const data = await response.json()

    // Should still find "documentation" despite typo
    expect(data.results.length).toBeGreaterThan(0)
  })
})

describe('Search Highlighting', () => {
  it('highlights matching terms in title', async () => {
    const request = new Request('http://localhost/api/search?q=getting%20started')
    const response = await searchHandler(request)
    const data = await response.json()

    expect(data.results.length).toBeGreaterThan(0)
    expect(data.results[0]).toHaveProperty('highlights')
    expect(data.results[0].highlights).toHaveProperty('title')
  })

  it('highlights matching terms in description', async () => {
    const request = new Request('http://localhost/api/search?q=api')
    const response = await searchHandler(request)
    const data = await response.json()

    expect(data.results.length).toBeGreaterThan(0)
    expect(data.results[0]).toHaveProperty('highlights')
    expect(data.results[0].highlights).toHaveProperty('description')
  })

  it('uses mark tags for highlighting', async () => {
    const request = new Request('http://localhost/api/search?q=test')
    const response = await searchHandler(request)
    const data = await response.json()

    expect(data.results.length).toBeGreaterThan(0)
    const highlights = data.results[0].highlights

    // At least one field should have <mark> tags
    const hasMarkTags = (highlights.title && highlights.title.includes('<mark>')) || (highlights.description && highlights.description.includes('<mark>'))

    expect(hasMarkTags).toBe(true)
  })
})

describe('Orama Search Client', () => {
  let client: SearchClient

  beforeAll(async () => {
    client = await createSearchClient()
  })

  it('can be initialized', () => {
    expect(client).toBeDefined()
    expect(client).toHaveProperty('search')
  })

  it('has search method', () => {
    expect(typeof client.search).toBe('function')
  })

  it('can perform basic search', async () => {
    const results = await client.search('test')

    expect(results).toBeDefined()
    expect(Array.isArray(results)).toBe(true)
  })

  it('accepts search options', async () => {
    const results = await client.search('test', {
      limit: 5,
      offset: 0,
      boost: { title: 2 },
    })

    expect(results).toBeDefined()
    expect(results.length).toBeLessThanOrEqual(5)
  })

  it('returns typed search results', async () => {
    const results = await client.search('documentation')

    if (results.length > 0) {
      const result = results[0]
      expect(result).toHaveProperty('id')
      expect(result).toHaveProperty('title')
      expect(result).toHaveProperty('url')
      expect(result).toHaveProperty('description')
      expect(result).toHaveProperty('score')
    }
  })

  it('supports faceted search', async () => {
    const results = await client.search('api', {
      facets: {
        category: true,
      },
    })

    expect(results).toHaveProperty('facets')
  })
})

describe('Search Edge Cases', () => {
  it('handles special characters in query', async () => {
    const request = new Request('http://localhost/api/search?q=%3Cscript%3E')
    const response = await searchHandler(request)

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(Array.isArray(data.results)).toBe(true)
  })

  it('handles very long queries', async () => {
    const longQuery = 'a'.repeat(1000)
    const request = new Request(`http://localhost/api/search?q=${longQuery}`)
    const response = await searchHandler(request)

    expect(response.status).toBe(200)
  })

  it('handles unicode characters', async () => {
    const request = new Request('http://localhost/api/search?q=%E4%B8%AD%E6%96%87')
    const response = await searchHandler(request)

    expect(response.status).toBe(200)
    const data = await response.json()
    expect(Array.isArray(data.results)).toBe(true)
  })

  it('returns consistent results for same query', async () => {
    const request1 = new Request('http://localhost/api/search?q=test')
    const request2 = new Request('http://localhost/api/search?q=test')

    const [response1, response2] = await Promise.all([searchHandler(request1), searchHandler(request2)])

    const [data1, data2] = await Promise.all([response1.json(), response2.json()])

    expect(data1.results).toEqual(data2.results)
  })
})
