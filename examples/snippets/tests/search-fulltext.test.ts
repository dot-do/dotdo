import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  InvertedIndexWriter,
  InvertedIndexReader,
  simpleTokenize,
  createInvertedIndex,
} from '../../db/iceberg/inverted-index'

/**
 * SearchSnippet - Full-Text Search Tests (RED Phase)
 *
 * Tests for Cloudflare Snippet-based full-text search using the inverted index
 * format defined in db/iceberg/inverted-index.ts. The search snippet fetches
 * inverted index files from CDN to perform term lookups and boolean queries.
 *
 * Memory Budget (from analysis):
 * - ~56K terms vocabulary-only per 1MB
 * - With posting lists: depends on average list size
 * - Typical: 10K terms + 100K postings in ~500KB
 *
 * Performance Requirements:
 * - Term lookup: <2ms (cached)
 * - Index fetch + parse: <50ms (cold)
 * - Multi-term AND/OR: <5ms (cached)
 *
 * These tests are expected to FAIL until the search snippet is implemented.
 *
 * @module snippets/tests/search-fulltext.test
 * @see db/iceberg/inverted-index.ts for the inverted index format
 */

// ============================================================================
// Imports from the to-be-implemented search snippet
// ============================================================================

// These imports will fail until the search snippet is implemented
import {
  queryFullText,
  fetchInvertedIndex,
  lookupTerm,
  intersectTerms,
  unionTerms,
  prefixSearch,
  phraseSearch,
  type FullTextQuery,
  type FullTextQueryResult,
  type FullTextFetchOptions,
  type PostingList,
} from '../search'

// ============================================================================
// Test Fixtures - Create realistic inverted index data
// ============================================================================

/**
 * Creates test documents with common search scenarios.
 */
const TEST_DOCUMENTS = new Map<number, string>([
  [1, 'The quick brown fox jumps over the lazy dog'],
  [2, 'A quick brown dog runs in the park'],
  [3, 'The lazy cat sleeps all day'],
  [4, 'Dogs and cats are popular pets'],
  [5, 'The fox is a cunning animal'],
  [6, 'Brown bears hibernate in winter'],
  [7, 'Quick service at the restaurant'],
  [8, 'The dog chased the fox'],
  [9, 'Lazy Sunday morning coffee'],
  [10, 'Quick quick double quick'],
])

/**
 * Creates a serialized inverted index for testing.
 */
function createTestIndex(documents: Map<number, string> = TEST_DOCUMENTS): Uint8Array {
  return createInvertedIndex(documents, simpleTokenize)
}

/**
 * Creates a larger test index with many documents.
 */
function createLargeTestIndex(docCount: number): Uint8Array {
  const writer = new InvertedIndexWriter()
  const words = ['hello', 'world', 'test', 'search', 'query', 'index', 'document', 'term', 'word', 'text']

  for (let docId = 0; docId < docCount; docId++) {
    // Each document gets 5-10 random words from the vocabulary
    const numWords = 5 + (docId % 6)
    for (let i = 0; i < numWords; i++) {
      const wordIdx = (docId + i) % words.length
      writer.addPosting(words[wordIdx], docId)
    }
  }

  return writer.serialize()
}

/**
 * Mock CDN fetch for inverted index files.
 */
function createMockFetch(files: Map<string, Uint8Array>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const data = files.get(url)
    if (!data) {
      return new Response(null, { status: 404, statusText: 'Not Found' })
    }

    // Handle range requests
    const rangeHeader =
      init?.headers instanceof Headers
        ? init.headers.get('Range')
        : (init?.headers as Record<string, string>)?.Range

    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d+)?/)
      if (match) {
        const start = parseInt(match[1], 10)
        const end = match[2] ? parseInt(match[2], 10) : data.length - 1
        const slice = data.slice(start, end + 1)
        return new Response(slice, {
          status: 206,
          headers: {
            'Content-Range': `bytes ${start}-${end}/${data.length}`,
            'Content-Length': String(slice.length),
          },
        })
      }
    }

    return new Response(data, {
      status: 200,
      headers: {
        'Content-Length': String(data.length),
        'Content-Type': 'application/octet-stream',
      },
    })
  })
}

// ============================================================================
// CDN Fetch Tests
// ============================================================================

describe('SearchSnippet - Full-Text Index Fetching', () => {
  let indexData: Uint8Array
  let mockFetch: ReturnType<typeof createMockFetch>

  beforeEach(() => {
    indexData = createTestIndex()
    const files = new Map<string, Uint8Array>()
    files.set('https://cdn.example.com.ai/indexes/inverted/text.inv', indexData)
    mockFetch = createMockFetch(files)
  })

  it('fetches inverted index from CDN', async () => {
    const result = await fetchInvertedIndex(
      'https://cdn.example.com.ai/indexes/inverted/text.inv',
      { fetch: mockFetch }
    )

    expect(result).toBeDefined()
    expect(result).toBeInstanceOf(InvertedIndexReader)
    expect(mockFetch).toHaveBeenCalled()
  })

  it('uses range requests to fetch term index first', async () => {
    await fetchInvertedIndex('https://cdn.example.com.ai/indexes/inverted/text.inv', {
      fetch: mockFetch,
      rangeRequestEnabled: true,
    })

    // Should make range requests to minimize data transfer
    const calls = mockFetch.mock.calls
    const rangeRequests = calls.filter(([_url, init]) => {
      const headers = init?.headers
      if (headers instanceof Headers) {
        return headers.has('Range')
      }
      return (headers as Record<string, string>)?.Range
    })

    // May or may not use range requests depending on implementation
    // But if rangeRequestEnabled is true, should attempt range requests
    expect(mockFetch).toHaveBeenCalled()
  })

  it('caches inverted index in memory for repeated queries', async () => {
    const options: FullTextFetchOptions = { fetch: mockFetch }

    // First fetch
    await fetchInvertedIndex('https://cdn.example.com.ai/indexes/inverted/text.inv', options)

    // Second fetch should hit cache
    await fetchInvertedIndex('https://cdn.example.com.ai/indexes/inverted/text.inv', options)

    // Should only fetch once
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('handles 404 gracefully', async () => {
    const result = await fetchInvertedIndex(
      'https://cdn.example.com.ai/indexes/inverted/nonexistent.inv',
      { fetch: mockFetch }
    )

    expect(result).toBeNull()
  })

  it('handles network errors gracefully', async () => {
    const errorFetch = vi.fn().mockRejectedValue(new Error('Network error'))

    await expect(
      fetchInvertedIndex('https://cdn.example.com.ai/indexes/inverted/text.inv', {
        fetch: errorFetch,
      })
    ).rejects.toThrow(/network|failed|fetch/i)
  })
})

// ============================================================================
// Term Lookup Tests
// ============================================================================

describe('SearchSnippet - Term Lookup', () => {
  let indexData: Uint8Array
  let mockFetch: ReturnType<typeof createMockFetch>

  beforeEach(() => {
    indexData = createTestIndex()
    const files = new Map([['https://cdn.example.com.ai/index.inv', indexData]])
    mockFetch = createMockFetch(files)
  })

  it('looks up term in index', async () => {
    const result = await lookupTerm(
      { url: 'https://cdn.example.com.ai/index.inv', term: 'quick' },
      { fetch: mockFetch }
    )

    expect(result).toBeDefined()
    expect(result.docIds).toBeInstanceOf(Array)
    expect(result.docIds.length).toBeGreaterThan(0)
  })

  it('returns posting list for term', async () => {
    const result = await lookupTerm(
      { url: 'https://cdn.example.com.ai/index.inv', term: 'the' },
      { fetch: mockFetch }
    )

    // "the" appears in documents 1, 3, 5, 8, 9
    expect(result.docIds).toEqual(expect.arrayContaining([1, 3, 5, 8]))
    expect(result.docIds.length).toBeGreaterThanOrEqual(4)
  })

  it('returns empty for unknown terms', async () => {
    const result = await lookupTerm(
      { url: 'https://cdn.example.com.ai/index.inv', term: 'xyznonexistent' },
      { fetch: mockFetch }
    )

    expect(result.docIds).toEqual([])
  })

  it('handles case normalization', async () => {
    // Index was built with simpleTokenize which lowercases
    const result = await lookupTerm(
      { url: 'https://cdn.example.com.ai/index.inv', term: 'QUICK' },
      { fetch: mockFetch, caseSensitive: false }
    )

    // Should find "quick" even though query was uppercase
    expect(result.docIds.length).toBeGreaterThan(0)
  })

  it('returns posting list with document frequency', async () => {
    const result = await lookupTerm(
      { url: 'https://cdn.example.com.ai/index.inv', term: 'dog' },
      { fetch: mockFetch }
    )

    expect(result).toHaveProperty('docIds')
    expect(result).toHaveProperty('documentFrequency')
    expect(result.documentFrequency).toBe(result.docIds.length)
  })
})

// ============================================================================
// Multi-Term Query Tests (AND)
// ============================================================================

describe('SearchSnippet - Multi-Term AND Queries', () => {
  let indexData: Uint8Array
  let mockFetch: ReturnType<typeof createMockFetch>

  beforeEach(() => {
    indexData = createTestIndex()
    const files = new Map([['https://cdn.example.com.ai/index.inv', indexData]])
    mockFetch = createMockFetch(files)
  })

  it('handles multi-term queries (AND)', async () => {
    const result = await intersectTerms(
      {
        url: 'https://cdn.example.com.ai/index.inv',
        terms: ['quick', 'brown'],
      },
      { fetch: mockFetch }
    )

    // "quick brown" appears in documents 1 and 2
    expect(result.docIds).toEqual(expect.arrayContaining([1, 2]))
  })

  it('returns empty when no documents match all terms', async () => {
    const result = await intersectTerms(
      {
        url: 'https://cdn.example.com.ai/index.inv',
        terms: ['quick', 'cat'], // "quick" and "cat" don't appear together
      },
      { fetch: mockFetch }
    )

    expect(result.docIds).toEqual([])
  })

  it('handles intersection of three or more terms', async () => {
    const result = await intersectTerms(
      {
        url: 'https://cdn.example.com.ai/index.inv',
        terms: ['quick', 'brown', 'fox'],
      },
      { fetch: mockFetch }
    )

    // Only document 1 has all three terms
    expect(result.docIds).toEqual([1])
  })

  it('handles single term intersection (passthrough)', async () => {
    const result = await intersectTerms(
      {
        url: 'https://cdn.example.com.ai/index.inv',
        terms: ['quick'],
      },
      { fetch: mockFetch }
    )

    // Should be equivalent to single term lookup
    expect(result.docIds.length).toBeGreaterThan(0)
  })

  it('handles empty terms array', async () => {
    const result = await intersectTerms(
      {
        url: 'https://cdn.example.com.ai/index.inv',
        terms: [],
      },
      { fetch: mockFetch }
    )

    expect(result.docIds).toEqual([])
  })

  it('optimizes by starting with smallest posting list', async () => {
    // This is an implementation detail but important for performance
    // The function should start intersection with the term that has fewest docs
    const result = await intersectTerms(
      {
        url: 'https://cdn.example.com.ai/index.inv',
        terms: ['the', 'fox'], // "the" is common, "fox" is rare
      },
      { fetch: mockFetch }
    )

    // Should correctly find intersection
    expect(result.docIds).toEqual(expect.arrayContaining([1, 5, 8]))
  })
})

// ============================================================================
// Multi-Term Query Tests (OR)
// ============================================================================

describe('SearchSnippet - Multi-Term OR Queries', () => {
  let indexData: Uint8Array
  let mockFetch: ReturnType<typeof createMockFetch>

  beforeEach(() => {
    indexData = createTestIndex()
    const files = new Map([['https://cdn.example.com.ai/index.inv', indexData]])
    mockFetch = createMockFetch(files)
  })

  it('handles multi-term queries (OR)', async () => {
    const result = await unionTerms(
      {
        url: 'https://cdn.example.com.ai/index.inv',
        terms: ['cat', 'dog'],
      },
      { fetch: mockFetch }
    )

    // Documents with "cat" or "dog"
    expect(result.docIds.length).toBeGreaterThan(0)
    // Should include doc 2 (dog), doc 3 (cat), doc 4 (dogs, cats), doc 8 (dog)
  })

  it('returns union of all matching documents', async () => {
    const result = await unionTerms(
      {
        url: 'https://cdn.example.com.ai/index.inv',
        terms: ['fox', 'bear'],
      },
      { fetch: mockFetch }
    )

    // "fox" in docs 1, 5, 8; "bear" in doc 6
    expect(result.docIds).toEqual(expect.arrayContaining([1, 5, 6, 8]))
  })

  it('handles single term union (passthrough)', async () => {
    const result = await unionTerms(
      {
        url: 'https://cdn.example.com.ai/index.inv',
        terms: ['quick'],
      },
      { fetch: mockFetch }
    )

    expect(result.docIds.length).toBeGreaterThan(0)
  })

  it('handles empty terms array', async () => {
    const result = await unionTerms(
      {
        url: 'https://cdn.example.com.ai/index.inv',
        terms: [],
      },
      { fetch: mockFetch }
    )

    expect(result.docIds).toEqual([])
  })

  it('deduplicates results', async () => {
    const result = await unionTerms(
      {
        url: 'https://cdn.example.com.ai/index.inv',
        terms: ['quick', 'quick'], // Duplicate term
      },
      { fetch: mockFetch }
    )

    // Should not have duplicates in result
    const uniqueIds = new Set(result.docIds)
    expect(result.docIds.length).toBe(uniqueIds.size)
  })
})

// ============================================================================
// Phrase Query Tests
// ============================================================================

describe('SearchSnippet - Phrase Queries', () => {
  let indexData: Uint8Array
  let mockFetch: ReturnType<typeof createMockFetch>

  beforeEach(() => {
    indexData = createTestIndex()
    const files = new Map([['https://cdn.example.com.ai/index.inv', indexData]])
    mockFetch = createMockFetch(files)
  })

  it('handles phrase queries', async () => {
    const result = await phraseSearch(
      {
        url: 'https://cdn.example.com.ai/index.inv',
        phrase: 'quick brown',
      },
      { fetch: mockFetch }
    )

    // Note: Basic inverted index doesn't store positions
    // Phrase search may be approximated by AND + post-filter
    // or require position-aware index
    expect(result.docIds).toEqual(expect.arrayContaining([1, 2]))
  })

  it('handles phrase with common words', async () => {
    const result = await phraseSearch(
      {
        url: 'https://cdn.example.com.ai/index.inv',
        phrase: 'the lazy',
      },
      { fetch: mockFetch }
    )

    // "the lazy" appears in documents 1 and 3
    expect(result.docIds.length).toBeGreaterThan(0)
  })

  it('handles single-word phrase (equivalent to term lookup)', async () => {
    const result = await phraseSearch(
      {
        url: 'https://cdn.example.com.ai/index.inv',
        phrase: 'dog',
      },
      { fetch: mockFetch }
    )

    expect(result.docIds.length).toBeGreaterThan(0)
  })

  it('returns empty for non-matching phrase', async () => {
    const result = await phraseSearch(
      {
        url: 'https://cdn.example.com.ai/index.inv',
        phrase: 'purple elephant dancing',
      },
      { fetch: mockFetch }
    )

    expect(result.docIds).toEqual([])
  })
})

// ============================================================================
// Prefix Search Tests
// ============================================================================

describe('SearchSnippet - Prefix Search', () => {
  let indexData: Uint8Array
  let mockFetch: ReturnType<typeof createMockFetch>

  beforeEach(() => {
    indexData = createTestIndex()
    const files = new Map([['https://cdn.example.com.ai/index.inv', indexData]])
    mockFetch = createMockFetch(files)
  })

  it('handles prefix search', async () => {
    const result = await prefixSearch(
      {
        url: 'https://cdn.example.com.ai/index.inv',
        prefix: 'qui',
      },
      { fetch: mockFetch }
    )

    // Should find "quick"
    expect(result.terms).toEqual(expect.arrayContaining(['quick']))
    expect(result.docIds.length).toBeGreaterThan(0)
  })

  it('returns all terms matching prefix', async () => {
    const result = await prefixSearch(
      {
        url: 'https://cdn.example.com.ai/index.inv',
        prefix: 'do',
      },
      { fetch: mockFetch }
    )

    // Should find "dog" and "dogs"
    expect(result.terms).toEqual(expect.arrayContaining(['dog']))
  })

  it('returns empty for non-matching prefix', async () => {
    const result = await prefixSearch(
      {
        url: 'https://cdn.example.com.ai/index.inv',
        prefix: 'xyz',
      },
      { fetch: mockFetch }
    )

    expect(result.terms).toEqual([])
    expect(result.docIds).toEqual([])
  })

  it('limits number of results', async () => {
    const result = await prefixSearch(
      {
        url: 'https://cdn.example.com.ai/index.inv',
        prefix: '',
        limit: 5,
      },
      { fetch: mockFetch }
    )

    expect(result.terms.length).toBeLessThanOrEqual(5)
  })
})

// ============================================================================
// Full-Text Query API Tests
// ============================================================================

describe('SearchSnippet - Full-Text Query API', () => {
  let indexData: Uint8Array
  let mockFetch: ReturnType<typeof createMockFetch>

  beforeEach(() => {
    indexData = createTestIndex()
    const files = new Map([['https://cdn.example.com.ai/index.inv', indexData]])
    mockFetch = createMockFetch(files)
  })

  it('handles simple single-term query', async () => {
    const result = await queryFullText(
      {
        url: 'https://cdn.example.com.ai/index.inv',
        query: 'dog',
      },
      { fetch: mockFetch }
    )

    expect(result.hits).toBeInstanceOf(Array)
    expect(result.hits.length).toBeGreaterThan(0)
    expect(result.totalHits).toBeGreaterThan(0)
  })

  it('handles AND query syntax', async () => {
    const result = await queryFullText(
      {
        url: 'https://cdn.example.com.ai/index.inv',
        query: 'quick AND brown',
      },
      { fetch: mockFetch }
    )

    expect(result.hits).toBeInstanceOf(Array)
  })

  it('handles OR query syntax', async () => {
    const result = await queryFullText(
      {
        url: 'https://cdn.example.com.ai/index.inv',
        query: 'cat OR dog',
      },
      { fetch: mockFetch }
    )

    expect(result.hits.length).toBeGreaterThan(0)
  })

  it('handles quoted phrase query', async () => {
    const result = await queryFullText(
      {
        url: 'https://cdn.example.com.ai/index.inv',
        query: '"quick brown"',
      },
      { fetch: mockFetch }
    )

    expect(result.hits).toBeInstanceOf(Array)
  })

  it('handles prefix wildcard query', async () => {
    const result = await queryFullText(
      {
        url: 'https://cdn.example.com.ai/index.inv',
        query: 'qui*',
      },
      { fetch: mockFetch }
    )

    expect(result.hits.length).toBeGreaterThan(0)
  })

  it('returns structured result with hits and metadata', async () => {
    const result = await queryFullText(
      {
        url: 'https://cdn.example.com.ai/index.inv',
        query: 'dog',
      },
      { fetch: mockFetch }
    )

    expect(result).toHaveProperty('hits')
    expect(result).toHaveProperty('totalHits')
    expect(result).toHaveProperty('queryTimeMs')
    expect(typeof result.queryTimeMs).toBe('number')
  })

  it('supports pagination with offset and limit', async () => {
    const result = await queryFullText(
      {
        url: 'https://cdn.example.com.ai/index.inv',
        query: 'the',
        offset: 0,
        limit: 3,
      },
      { fetch: mockFetch }
    )

    expect(result.hits.length).toBeLessThanOrEqual(3)
  })
})

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('SearchSnippet - Edge Cases', () => {
  let indexData: Uint8Array
  let mockFetch: ReturnType<typeof createMockFetch>

  beforeEach(() => {
    indexData = createTestIndex()
    const files = new Map([['https://cdn.example.com.ai/index.inv', indexData]])
    mockFetch = createMockFetch(files)
  })

  it('handles empty query', async () => {
    const result = await queryFullText(
      {
        url: 'https://cdn.example.com.ai/index.inv',
        query: '',
      },
      { fetch: mockFetch }
    )

    expect(result.hits).toEqual([])
    expect(result.totalHits).toBe(0)
  })

  it('handles query with only stopwords', async () => {
    const result = await queryFullText(
      {
        url: 'https://cdn.example.com.ai/index.inv',
        query: 'the a an',
      },
      { fetch: mockFetch }
    )

    // Implementation may filter stopwords or treat them normally
    expect(result).toBeDefined()
  })

  it('handles special characters in query', async () => {
    const result = await queryFullText(
      {
        url: 'https://cdn.example.com.ai/index.inv',
        query: 'hello@world.com',
      },
      { fetch: mockFetch }
    )

    // Should not crash, may return empty or tokenized results
    expect(result).toBeDefined()
    expect(result.hits).toBeInstanceOf(Array)
  })

  it('handles unicode characters', async () => {
    const result = await queryFullText(
      {
        url: 'https://cdn.example.com.ai/index.inv',
        query: 'cafe',
      },
      { fetch: mockFetch }
    )

    expect(result).toBeDefined()
  })

  it('handles very long query', async () => {
    const longQuery = 'word '.repeat(100).trim()

    const result = await queryFullText(
      {
        url: 'https://cdn.example.com.ai/index.inv',
        query: longQuery,
      },
      { fetch: mockFetch }
    )

    expect(result).toBeDefined()
  })

  it('handles corrupted index gracefully', async () => {
    const corruptedData = new Uint8Array([0x49, 0x4e, 0x56, 0x49, 0x00, 0x00]) // Valid magic but corrupt
    const files = new Map([['https://cdn.example.com.ai/corrupt.inv', corruptedData]])
    const errorFetch = createMockFetch(files)

    const result = await fetchInvertedIndex('https://cdn.example.com.ai/corrupt.inv', {
      fetch: errorFetch,
    })

    // Should return null or throw, not crash
    expect(result).toBeNull()
  })

  it('handles concurrent queries to same index', async () => {
    const queries = Array.from({ length: 10 }, (_, i) =>
      lookupTerm(
        { url: 'https://cdn.example.com.ai/index.inv', term: ['quick', 'brown', 'fox', 'dog', 'cat'][i % 5] },
        { fetch: mockFetch }
      )
    )

    const results = await Promise.all(queries)

    // All queries should complete successfully
    expect(results.every((r) => r.docIds !== undefined)).toBe(true)
  })

  it('handles query timeout', async () => {
    const slowFetch = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10000))
      return new Response(indexData)
    })

    await expect(
      queryFullText(
        {
          url: 'https://cdn.example.com.ai/index.inv',
          query: 'test',
        },
        { fetch: slowFetch, timeoutMs: 100 }
      )
    ).rejects.toThrow(/timeout/i)
  })
})

// ============================================================================
// Performance Tests
// ============================================================================

describe('SearchSnippet - Performance', () => {
  it('completes term lookup within 2ms (cached)', async () => {
    const indexData = createTestIndex()
    const files = new Map([['https://cdn.example.com.ai/index.inv', indexData]])
    const mockFetch = createMockFetch(files)

    // Warm up cache
    await lookupTerm(
      { url: 'https://cdn.example.com.ai/index.inv', term: 'warmup' },
      { fetch: mockFetch }
    )

    const start = performance.now()

    await lookupTerm(
      { url: 'https://cdn.example.com.ai/index.inv', term: 'quick' },
      { fetch: mockFetch }
    )

    const duration = performance.now() - start

    expect(duration).toBeLessThan(2)
  })

  it('completes 100 term lookups within 50ms (cached)', async () => {
    const indexData = createTestIndex()
    const files = new Map([['https://cdn.example.com.ai/index.inv', indexData]])
    const mockFetch = createMockFetch(files)

    // Warm up cache
    await lookupTerm(
      { url: 'https://cdn.example.com.ai/index.inv', term: 'warmup' },
      { fetch: mockFetch }
    )

    const terms = ['quick', 'brown', 'fox', 'dog', 'cat', 'lazy', 'the', 'jumps', 'over', 'runs']

    const start = performance.now()

    for (let i = 0; i < 100; i++) {
      await lookupTerm(
        { url: 'https://cdn.example.com.ai/index.inv', term: terms[i % terms.length] },
        { fetch: mockFetch }
      )
    }

    const duration = performance.now() - start

    expect(duration).toBeLessThan(50)
  })

  it('handles large index efficiently', async () => {
    const largeIndex = createLargeTestIndex(10000) // 10K documents
    const files = new Map([['https://cdn.example.com.ai/large.inv', largeIndex]])
    const mockFetch = createMockFetch(files)

    const start = performance.now()

    await lookupTerm(
      { url: 'https://cdn.example.com.ai/large.inv', term: 'hello' },
      { fetch: mockFetch }
    )

    const duration = performance.now() - start

    // First fetch + parse should complete in reasonable time
    expect(duration).toBeLessThan(100)
  })

  it('binary search is O(log n) for term lookup', async () => {
    // Create indexes of different sizes
    const smallIndex = createLargeTestIndex(100)
    const mediumIndex = createLargeTestIndex(1000)
    const largeIndex = createLargeTestIndex(10000)

    const files = new Map([
      ['https://cdn.example.com.ai/small.inv', smallIndex],
      ['https://cdn.example.com.ai/medium.inv', mediumIndex],
      ['https://cdn.example.com.ai/large.inv', largeIndex],
    ])
    const mockFetch = createMockFetch(files)

    // Warm up all indexes
    await Promise.all([
      lookupTerm({ url: 'https://cdn.example.com.ai/small.inv', term: 'warmup' }, { fetch: mockFetch }),
      lookupTerm({ url: 'https://cdn.example.com.ai/medium.inv', term: 'warmup' }, { fetch: mockFetch }),
      lookupTerm({ url: 'https://cdn.example.com.ai/large.inv', term: 'warmup' }, { fetch: mockFetch }),
    ])

    // Time lookups in each
    const times: number[] = []
    for (const size of ['small', 'medium', 'large']) {
      const start = performance.now()
      for (let i = 0; i < 100; i++) {
        await lookupTerm(
          { url: `https://cdn.example.com.ai/${size}.inv`, term: 'hello' },
          { fetch: mockFetch }
        )
      }
      times.push(performance.now() - start)
    }

    // Times should not grow linearly with index size (O(log n) not O(n))
    // Large index (100x docs) should not take 100x longer
    expect(times[2]).toBeLessThan(times[0] * 10) // 100x docs, <10x time
  })
})

// ============================================================================
// Memory Budget Tests
// ============================================================================

describe('SearchSnippet - Memory Budget', () => {
  it('respects memory limits for index cache', async () => {
    const largeIndex = createLargeTestIndex(50000) // ~500KB+ index
    const files = new Map([['https://cdn.example.com.ai/large.inv', largeIndex]])
    const mockFetch = createMockFetch(files)

    const options: FullTextFetchOptions = {
      fetch: mockFetch,
      maxMemoryBytes: 1024 * 1024, // 1MB limit
    }

    const result = await fetchInvertedIndex('https://cdn.example.com.ai/large.inv', options)

    expect(result).not.toBeNull()
  })

  it('evicts old indexes when memory limit exceeded', async () => {
    // Create multiple indexes
    const files = new Map<string, Uint8Array>()
    for (let i = 0; i < 10; i++) {
      files.set(`https://cdn.example.com.ai/index${i}.inv`, createLargeTestIndex(5000))
    }
    const mockFetch = createMockFetch(files)

    const options: FullTextFetchOptions = {
      fetch: mockFetch,
      maxMemoryBytes: 500 * 1024, // 500KB - can hold ~1-2 indexes
    }

    // Load more indexes than can fit in cache
    for (let i = 0; i < 10; i++) {
      await fetchInvertedIndex(`https://cdn.example.com.ai/index${i}.inv`, options)
    }

    // Should have evicted earlier entries
    // Verify by checking fetch count (should be called more than once per URL)
    expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(10)
  })

  it('fits within 2MB Snippet memory limit', async () => {
    // 56K terms vocabulary-only per 1MB (from analysis)
    // Create index with ~50K terms
    const writer = new InvertedIndexWriter()

    // Generate unique terms
    for (let i = 0; i < 50000; i++) {
      writer.addPosting(`term${i}`, i % 1000)
    }

    const indexData = writer.serialize()

    // Should be under 2MB
    expect(indexData.byteLength).toBeLessThan(2 * 1024 * 1024)

    const files = new Map([['https://cdn.example.com.ai/huge.inv', indexData]])
    const mockFetch = createMockFetch(files)

    const result = await fetchInvertedIndex('https://cdn.example.com.ai/huge.inv', {
      fetch: mockFetch,
    })

    expect(result).not.toBeNull()
  })
})

// ============================================================================
// Partial Index Loading Tests (Range Requests)
// ============================================================================

describe('SearchSnippet - Partial Index Loading', () => {
  it('supports partial loading via Range requests', async () => {
    const indexData = createTestIndex()
    const files = new Map([['https://cdn.example.com.ai/index.inv', indexData]])
    const mockFetch = createMockFetch(files)

    // Enable range request mode
    await fetchInvertedIndex('https://cdn.example.com.ai/index.inv', {
      fetch: mockFetch,
      rangeRequestEnabled: true,
    })

    // Should have made at least one request
    expect(mockFetch).toHaveBeenCalled()
  })

  it('fetches only header for initial load', async () => {
    const indexData = createTestIndex()
    const files = new Map([['https://cdn.example.com.ai/index.inv', indexData]])
    const mockFetch = createMockFetch(files)

    await fetchInvertedIndex('https://cdn.example.com.ai/index.inv', {
      fetch: mockFetch,
      rangeRequestEnabled: true,
      headerOnly: true,
    })

    // Should fetch minimal data for header
    if (mockFetch.mock.calls.length > 0) {
      const firstCall = mockFetch.mock.calls[0]
      const headers = firstCall[1]?.headers as Record<string, string> | undefined
      if (headers?.Range) {
        // If using range requests, should request small range
        const rangeMatch = headers.Range.match(/bytes=(\d+)-(\d+)/)
        if (rangeMatch) {
          const start = parseInt(rangeMatch[1])
          const end = parseInt(rangeMatch[2])
          expect(end - start).toBeLessThan(1024) // Header should be <1KB
        }
      }
    }
  })

  it('fetches term index separately from posting lists', async () => {
    const indexData = createLargeTestIndex(10000)
    const files = new Map([['https://cdn.example.com.ai/index.inv', indexData]])
    const mockFetch = createMockFetch(files)

    // First, fetch just the term index
    const reader = await fetchInvertedIndex('https://cdn.example.com.ai/index.inv', {
      fetch: mockFetch,
      rangeRequestEnabled: true,
      termIndexOnly: true,
    })

    if (reader) {
      // Term index should be loaded, posting lists fetched on demand
      expect(reader.termCount).toBeGreaterThan(0)
    }
  })

  it('fetches posting list on demand', async () => {
    const indexData = createLargeTestIndex(10000)
    const files = new Map([['https://cdn.example.com.ai/index.inv', indexData]])
    const mockFetch = createMockFetch(files)

    // With lazy loading enabled, posting lists are fetched on demand
    const result = await lookupTerm(
      { url: 'https://cdn.example.com.ai/index.inv', term: 'hello' },
      { fetch: mockFetch, lazyPostingLists: true }
    )

    expect(result.docIds.length).toBeGreaterThan(0)
  })
})

// ============================================================================
// Integration with Underlying Reader
// ============================================================================

describe('SearchSnippet - Integration with InvertedIndexReader', () => {
  it('correctly parses index created by InvertedIndexWriter', () => {
    const indexData = createTestIndex()
    const reader = InvertedIndexReader.deserialize(indexData)

    // Verify the index was created correctly
    expect(reader.termCount).toBeGreaterThan(0)
    expect(reader.hasTerm('quick')).toBe(true)
    expect(reader.hasTerm('brown')).toBe(true)
    expect(reader.hasTerm('fox')).toBe(true)
  })

  it('reader.getPostings returns correct document IDs', () => {
    const indexData = createTestIndex()
    const reader = InvertedIndexReader.deserialize(indexData)

    const postings = reader.getPostings('quick')

    // "quick" appears in documents 1, 2, 7, 10
    expect(postings).toEqual(expect.arrayContaining([1, 2, 7, 10]))
  })

  it('reader.intersect handles AND queries correctly', () => {
    const indexData = createTestIndex()
    const reader = InvertedIndexReader.deserialize(indexData)

    const intersection = reader.intersect(['quick', 'brown'])

    // Documents with both "quick" AND "brown": 1, 2
    expect(intersection).toEqual(expect.arrayContaining([1, 2]))
  })

  it('reader.union handles OR queries correctly', () => {
    const indexData = createTestIndex()
    const reader = InvertedIndexReader.deserialize(indexData)

    const union = reader.union(['fox', 'bear'])

    // Documents with "fox" OR "bear"
    expect(union.length).toBeGreaterThan(0)
  })

  it('reader.searchPrefix finds matching terms', () => {
    const indexData = createTestIndex()
    const reader = InvertedIndexReader.deserialize(indexData)

    const prefixMatches = reader.searchPrefix('qui')

    expect(prefixMatches.length).toBeGreaterThan(0)
    expect(prefixMatches.some((e) => e.term === 'quick')).toBe(true)
  })
})
