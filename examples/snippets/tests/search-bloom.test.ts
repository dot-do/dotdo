import { describe, it, expect, beforeEach, vi } from 'vitest'
import { BloomFilter, createBloomFilterFromValues, PuffinWriter, PuffinReader } from '../../db/iceberg/puffin'

/**
 * Search Snippet - Bloom Filter Pruning Tests (RED Phase)
 *
 * These tests verify the bloom filter query pruning functionality for the
 * "100% FREE Query Architecture" using Cloudflare Snippets.
 *
 * The search snippet needs to:
 * 1. Fetch bloom filters from CDN cache
 * 2. Deserialize bloom filter bytes
 * 3. Query bloom filters to make pruning decisions
 * 4. Handle multiple column queries efficiently
 * 5. Complete all operations within 2ms
 *
 * Pruning decisions:
 * - MAYBE: Value might be in the data file (must scan)
 * - NO: Value is definitely NOT in the data file (can skip)
 *
 * These tests are expected to FAIL until the search snippet is implemented.
 *
 * @see db/iceberg/puffin.ts for the BloomFilter implementation
 * @see docs/design/100-percent-free-query-architecture.md for architecture
 */

// ============================================================================
// Imports from the to-be-implemented search snippet
// ============================================================================

// These imports will fail until the search snippet is implemented
import {
  queryBloom,
  fetchBloomFilter,
  BloomQueryResult,
  clearBloomCache,
  type BloomQuery,
  type BloomFetchOptions,
} from '../search'

// ============================================================================
// Test Fixtures - Create realistic bloom filter data
// ============================================================================

/**
 * Creates a Puffin file with bloom filters for testing
 */
function createTestPuffinFile(columnData: Record<number, string[]>): Uint8Array {
  const writer = new PuffinWriter({
    snapshotId: 1234567890,
    sequenceNumber: 1,
  })

  for (const [fieldId, values] of Object.entries(columnData)) {
    const bloom = createBloomFilterFromValues(values, 0.01) // 1% FPR
    writer.addBloomFilter(Number(fieldId), bloom)
  }

  return writer.finish()
}

/**
 * Mock CDN fetch for testing
 */
function createMockFetch(files: Map<string, Uint8Array>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const data = files.get(url)
    if (!data) {
      return new Response(null, { status: 404 })
    }

    // Handle range requests
    const rangeHeader = init?.headers instanceof Headers
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
// Bloom Filter Fetch Tests
// ============================================================================

describe('SearchSnippet - Bloom Filter Fetch', () => {
  const testEmails = [
    'alice@example.com.ai',
    'bob@example.com.ai',
    'charlie@example.com.ai',
    'david@example.com.ai',
    'eve@example.com.ai',
  ]

  const testStatuses = ['active', 'pending', 'suspended']

  let puffinFile: Uint8Array
  let mockFetch: ReturnType<typeof createMockFetch>

  beforeEach(() => {
    // Clear bloom filter cache between tests
    clearBloomCache()

    // Create a test Puffin file with bloom filters
    // Field 5 = email column, Field 6 = status column
    puffinFile = createTestPuffinFile({
      5: testEmails,
      6: testStatuses,
    })

    // Create mock fetch
    const files = new Map<string, Uint8Array>()
    files.set('https://cdn.example.com.ai/data/file1.puffin', puffinFile)
    mockFetch = createMockFetch(files)
  })

  it('fetches bloom filter from CDN', async () => {
    const result = await fetchBloomFilter(
      'https://cdn.example.com.ai/data/file1.puffin',
      { fieldId: 5 },
      { fetch: mockFetch }
    )

    expect(result).toBeDefined()
    expect(result).toBeInstanceOf(BloomFilter)
    expect(mockFetch).toHaveBeenCalled()
  })

  it('uses range requests to fetch only footer first', async () => {
    await fetchBloomFilter(
      'https://cdn.example.com.ai/data/file1.puffin',
      { fieldId: 5 },
      { fetch: mockFetch }
    )

    // Should make at least one range request for footer
    const calls = mockFetch.mock.calls
    const rangeRequests = calls.filter(([_url, init]) => {
      const headers = init?.headers
      if (headers instanceof Headers) {
        return headers.has('Range')
      }
      return (headers as Record<string, string>)?.Range
    })

    expect(rangeRequests.length).toBeGreaterThan(0)
  })

  it('caches bloom filter in memory for repeated queries', async () => {
    const options: BloomFetchOptions = { fetch: mockFetch }

    // First fetch
    await fetchBloomFilter(
      'https://cdn.example.com.ai/data/file1.puffin',
      { fieldId: 5 },
      options
    )

    // Second fetch should hit cache
    await fetchBloomFilter(
      'https://cdn.example.com.ai/data/file1.puffin',
      { fieldId: 5 },
      options
    )

    // Only one network request should have been made for the bloom filter
    // (may have multiple range requests for footer + blob, but same URL)
    const uniqueUrls = new Set(mockFetch.mock.calls.map(([url]) => url))
    expect(uniqueUrls.size).toBe(1)
  })

  it('returns null for non-existent field ID', async () => {
    const result = await fetchBloomFilter(
      'https://cdn.example.com.ai/data/file1.puffin',
      { fieldId: 999 }, // Non-existent field
      { fetch: mockFetch }
    )

    expect(result).toBeNull()
  })

  it('handles 404 gracefully', async () => {
    const result = await fetchBloomFilter(
      'https://cdn.example.com.ai/data/nonexistent.puffin',
      { fieldId: 5 },
      { fetch: mockFetch }
    )

    expect(result).toBeNull()
  })
})

// ============================================================================
// Bloom Filter Deserialization Tests
// ============================================================================

describe('SearchSnippet - Bloom Filter Deserialization', () => {
  it('deserializes bloom filter correctly', () => {
    const originalValues = ['value1', 'value2', 'value3']
    const original = createBloomFilterFromValues(originalValues, 0.01)
    const serialized = original.serialize()

    const deserialized = BloomFilter.deserialize(serialized)

    // Deserialized filter should have same behavior
    expect(deserialized.mightContain('value1')).toBe(true)
    expect(deserialized.mightContain('value2')).toBe(true)
    expect(deserialized.mightContain('value3')).toBe(true)
  })

  it('deserializes bloom filter from Puffin file', () => {
    const values = ['apple', 'banana', 'cherry', 'date', 'elderberry']
    const puffinFile = createTestPuffinFile({ 1: values })
    const reader = PuffinReader.fromBytes(puffinFile)

    const blobMeta = reader.findBlob('bloom-filter-v1', 1)
    expect(blobMeta).not.toBeNull()

    const bloom = reader.extractBlob(blobMeta!, puffinFile)
    expect(bloom).toBeInstanceOf(BloomFilter)

    const bloomFilter = bloom as BloomFilter
    expect(bloomFilter.mightContain('apple')).toBe(true)
    expect(bloomFilter.mightContain('banana')).toBe(true)
  })

  it('handles malformed bloom filter data gracefully', () => {
    const malformedData = new Uint8Array([0x00, 0x01, 0x02]) // Too short

    expect(() => BloomFilter.deserialize(malformedData)).toThrow()
  })

  it('handles empty bloom filter', () => {
    const emptyBloom = new BloomFilter({ expectedElements: 100 })
    const serialized = emptyBloom.serialize()
    const deserialized = BloomFilter.deserialize(serialized)

    // Empty bloom should return false for all queries
    expect(deserialized.mightContain('anything')).toBe(false)
  })
})

// ============================================================================
// Bloom Query Result Tests - MAYBE (existing values)
// ============================================================================

describe('SearchSnippet - Bloom Query MAYBE (existing values)', () => {
  const testValues = [
    'user_001',
    'user_002',
    'user_003',
    'order_abc',
    'order_xyz',
    'product_123',
    'product_456',
  ]

  let bloom: BloomFilter

  beforeEach(() => {
    bloom = createBloomFilterFromValues(testValues, 0.01)
  })

  it('returns MAYBE for existing values', async () => {
    const puffinFile = createTestPuffinFile({ 1: testValues })
    const files = new Map([['https://cdn.example.com.ai/test.puffin', puffinFile]])
    const mockFetch = createMockFetch(files)

    const result = await queryBloom(
      {
        url: 'https://cdn.example.com.ai/test.puffin',
        fieldId: 1,
        value: 'user_001',
      },
      { fetch: mockFetch }
    )

    expect(result).toBe(BloomQueryResult.MAYBE)
  })

  it('returns MAYBE for all test values', async () => {
    const puffinFile = createTestPuffinFile({ 1: testValues })
    const files = new Map([['https://cdn.example.com.ai/test.puffin', puffinFile]])
    const mockFetch = createMockFetch(files)

    for (const value of testValues) {
      const result = await queryBloom(
        {
          url: 'https://cdn.example.com.ai/test.puffin',
          fieldId: 1,
          value,
        },
        { fetch: mockFetch }
      )

      expect(result).toBe(BloomQueryResult.MAYBE)
    }
  })

  it('returns MAYBE for values added to bloom filter directly', () => {
    // Test the underlying bloom filter logic
    for (const value of testValues) {
      expect(bloom.mightContain(value)).toBe(true)
    }
  })
})

// ============================================================================
// Bloom Query Result Tests - NO (definitely-absent values)
// ============================================================================

describe('SearchSnippet - Bloom Query NO (definitely-absent values)', () => {
  const existingValues = ['apple', 'banana', 'cherry', 'date']
  const absentValues = [
    'definitely_not_here_xyz123',
    'another_missing_value_abc',
    'this_value_does_not_exist_qrs',
    'missing_item_uvw789',
    'nonexistent_entry_lmn456',
  ]

  let puffinFile: Uint8Array
  let mockFetch: ReturnType<typeof createMockFetch>

  beforeEach(() => {
    puffinFile = createTestPuffinFile({ 1: existingValues })
    const files = new Map([['https://cdn.example.com.ai/test.puffin', puffinFile]])
    mockFetch = createMockFetch(files)
  })

  it('returns NO for definitely-absent values', async () => {
    // Test with values that are definitely not in the set
    // With 1% FPR and unique test values, these should return NO
    let noCount = 0
    for (const value of absentValues) {
      const result = await queryBloom(
        {
          url: 'https://cdn.example.com.ai/test.puffin',
          fieldId: 1,
          value,
        },
        { fetch: mockFetch }
      )

      if (result === BloomQueryResult.NO) {
        noCount++
      }
    }

    // Due to 1% FPR, at least 90% should return NO
    // With only 5 test values and 1% FPR, all should typically return NO
    expect(noCount).toBeGreaterThanOrEqual(Math.floor(absentValues.length * 0.9))
  })

  it('returns NO for random UUID values not in filter', async () => {
    // Generate random UUIDs that won't be in the filter
    const randomValues = Array.from({ length: 10 }, () =>
      `random_${crypto.randomUUID()}_value`
    )

    let noCount = 0
    for (const value of randomValues) {
      const result = await queryBloom(
        {
          url: 'https://cdn.example.com.ai/test.puffin',
          fieldId: 1,
          value,
        },
        { fetch: mockFetch }
      )

      if (result === BloomQueryResult.NO) {
        noCount++
      }
    }

    // At least 90% should return NO (accounting for false positives)
    expect(noCount).toBeGreaterThanOrEqual(Math.floor(randomValues.length * 0.9))
  })

  it('correctly identifies absent values using underlying bloom filter', () => {
    const bloom = createBloomFilterFromValues(existingValues, 0.01)

    // These specific values should not produce false positives
    // (statistically very unlikely with such distinct strings)
    let noCount = 0
    for (const value of absentValues) {
      if (!bloom.mightContain(value)) {
        noCount++
      }
    }

    expect(noCount).toBeGreaterThanOrEqual(Math.floor(absentValues.length * 0.9))
  })
})

// ============================================================================
// Multiple Column Bloom Query Tests
// ============================================================================

describe('SearchSnippet - Multiple Column Bloom Queries', () => {
  const emailValues = ['alice@example.com.ai', 'bob@example.com.ai', 'charlie@example.com.ai']
  const statusValues = ['active', 'pending', 'inactive']
  const typeValues = ['admin', 'user', 'guest']

  let puffinFile: Uint8Array
  let mockFetch: ReturnType<typeof createMockFetch>

  beforeEach(() => {
    // Create Puffin file with multiple column bloom filters
    puffinFile = createTestPuffinFile({
      5: emailValues,    // email column
      6: statusValues,   // status column
      7: typeValues,     // type column
    })
    const files = new Map([['https://cdn.example.com.ai/multi.puffin', puffinFile]])
    mockFetch = createMockFetch(files)
  })

  it('handles multiple column bloom queries', async () => {
    const queries: BloomQuery[] = [
      { url: 'https://cdn.example.com.ai/multi.puffin', fieldId: 5, value: 'alice@example.com.ai' },
      { url: 'https://cdn.example.com.ai/multi.puffin', fieldId: 6, value: 'active' },
      { url: 'https://cdn.example.com.ai/multi.puffin', fieldId: 7, value: 'admin' },
    ]

    const results = await Promise.all(
      queries.map(q => queryBloom(q, { fetch: mockFetch }))
    )

    // All should return MAYBE since values exist
    expect(results.every(r => r === BloomQueryResult.MAYBE)).toBe(true)
  })

  it('handles mixed MAYBE/NO results across columns', async () => {
    const queries: BloomQuery[] = [
      { url: 'https://cdn.example.com.ai/multi.puffin', fieldId: 5, value: 'alice@example.com.ai' }, // exists
      { url: 'https://cdn.example.com.ai/multi.puffin', fieldId: 6, value: 'deleted' }, // doesn't exist
      { url: 'https://cdn.example.com.ai/multi.puffin', fieldId: 7, value: 'superuser' }, // doesn't exist
    ]

    const results = await Promise.all(
      queries.map(q => queryBloom(q, { fetch: mockFetch }))
    )

    expect(results[0]).toBe(BloomQueryResult.MAYBE) // alice exists
    // At least one of the non-existing values should return NO
    const noResults = results.slice(1).filter(r => r === BloomQueryResult.NO)
    expect(noResults.length).toBeGreaterThan(0)
  })

  it('queries different columns from same file efficiently', async () => {
    // Query multiple columns - should reuse cached footer/blob metadata
    await queryBloom(
      { url: 'https://cdn.example.com.ai/multi.puffin', fieldId: 5, value: 'test@example.com.ai' },
      { fetch: mockFetch }
    )
    await queryBloom(
      { url: 'https://cdn.example.com.ai/multi.puffin', fieldId: 6, value: 'active' },
      { fetch: mockFetch }
    )
    await queryBloom(
      { url: 'https://cdn.example.com.ai/multi.puffin', fieldId: 7, value: 'user' },
      { fetch: mockFetch }
    )

    // Should have efficient caching - footer should only be fetched once
    // The total number of requests should be reasonable (not 3x full file fetches)
    expect(mockFetch.mock.calls.length).toBeLessThanOrEqual(6) // Allow for footer + 3 blob fetches
  })

  it('handles AND queries (all columns must match)', async () => {
    // For AND queries, if ANY bloom filter returns NO, we can skip the file
    const queries: BloomQuery[] = [
      { url: 'https://cdn.example.com.ai/multi.puffin', fieldId: 5, value: 'alice@example.com.ai' },
      { url: 'https://cdn.example.com.ai/multi.puffin', fieldId: 6, value: 'nonexistent_status_xyz' },
    ]

    const results = await Promise.all(
      queries.map(q => queryBloom(q, { fetch: mockFetch }))
    )

    // If any result is NO, the file can be pruned
    const canPrune = results.some(r => r === BloomQueryResult.NO)
    expect(canPrune).toBe(true)
  })

  it('handles OR queries (any column can match)', async () => {
    // For OR queries, all bloom filters must return NO to prune
    const queries: BloomQuery[] = [
      { url: 'https://cdn.example.com.ai/multi.puffin', fieldId: 5, value: 'nonexistent1@test.com' },
      { url: 'https://cdn.example.com.ai/multi.puffin', fieldId: 6, value: 'nonexistent_status_abc' },
    ]

    const results = await Promise.all(
      queries.map(q => queryBloom(q, { fetch: mockFetch }))
    )

    // For OR queries, file can only be pruned if ALL return NO
    const allNo = results.every(r => r === BloomQueryResult.NO)
    // With these specific non-existent values, all should return NO
    expect(allNo).toBe(true)
  })
})

// ============================================================================
// Memory Limit Tests
// ============================================================================

describe('SearchSnippet - Memory Limits', () => {
  it('respects memory limits for bloom filter cache', async () => {
    // Create multiple large bloom filters
    const largeValues = Array.from({ length: 10000 }, (_, i) => `value_${i}_${crypto.randomUUID()}`)

    const puffinFile = createTestPuffinFile({ 1: largeValues })
    const files = new Map([['https://cdn.example.com.ai/large.puffin', puffinFile]])
    const mockFetch = createMockFetch(files)

    // Bloom filter for 10k items at 1% FPR should be ~12KB
    // Within 2MB Snippet memory limit but should track size
    const options: BloomFetchOptions = {
      fetch: mockFetch,
      maxMemoryBytes: 1024 * 1024, // 1MB limit for testing
    }

    const result = await fetchBloomFilter(
      'https://cdn.example.com.ai/large.puffin',
      { fieldId: 1 },
      options
    )

    expect(result).not.toBeNull()
  })

  it('evicts old entries when memory limit exceeded', async () => {
    // Create multiple Puffin files
    const files = new Map<string, Uint8Array>()
    for (let i = 0; i < 10; i++) {
      const values = Array.from({ length: 5000 }, (_, j) => `file${i}_value_${j}`)
      files.set(`https://cdn.example.com.ai/file${i}.puffin`, createTestPuffinFile({ 1: values }))
    }
    const mockFetch = createMockFetch(files)

    // Small memory limit to force eviction
    const options: BloomFetchOptions = {
      fetch: mockFetch,
      maxMemoryBytes: 50 * 1024, // 50KB - can hold ~4 bloom filters
    }

    // Load more bloom filters than can fit in cache
    for (let i = 0; i < 10; i++) {
      await fetchBloomFilter(
        `https://cdn.example.com.ai/file${i}.puffin`,
        { fieldId: 1 },
        options
      )
    }

    // Should have evicted earlier entries, network should be called multiple times
    expect(mockFetch.mock.calls.length).toBeGreaterThan(10) // More calls than files due to eviction
  })

  it('reports memory usage statistics', async () => {
    const values = Array.from({ length: 1000 }, (_, i) => `value_${i}`)
    const puffinFile = createTestPuffinFile({ 1: values })
    const files = new Map([['https://cdn.example.com.ai/stats.puffin', puffinFile]])
    const mockFetch = createMockFetch(files)

    const options: BloomFetchOptions = {
      fetch: mockFetch,
      trackStats: true,
    }

    await fetchBloomFilter(
      'https://cdn.example.com.ai/stats.puffin',
      { fieldId: 1 },
      options
    )

    // Stats should be available on the options object after fetch
    expect(options.stats).toBeDefined()
    expect(options.stats?.totalBytes).toBeGreaterThan(0)
    expect(options.stats?.cacheHits).toBe(0)
    expect(options.stats?.cacheMisses).toBe(1)
  })

  it('handles bloom filters approaching 2MB Snippet memory limit', async () => {
    // 2MB is the Snippet memory limit
    // A bloom filter for ~1.5M items at 1% FPR would be ~1.8MB
    // We'll test with a smaller but still significant bloom filter

    const largeValues = Array.from({ length: 100000 }, (_, i) => `large_value_${i}_${i * 2}`)
    const puffinFile = createTestPuffinFile({ 1: largeValues })
    const files = new Map([['https://cdn.example.com.ai/huge.puffin', puffinFile]])
    const mockFetch = createMockFetch(files)

    const options: BloomFetchOptions = {
      fetch: mockFetch,
      maxMemoryBytes: 2 * 1024 * 1024, // 2MB limit
    }

    const result = await fetchBloomFilter(
      'https://cdn.example.com.ai/huge.puffin',
      { fieldId: 1 },
      options
    )

    // Should successfully load the bloom filter
    expect(result).not.toBeNull()
    if (result) {
      // Verify it works correctly
      expect(result.mightContain('large_value_0_0')).toBe(true)
      expect(result.mightContain('large_value_99999_199998')).toBe(true)
    }
  })
})

// ============================================================================
// Performance Timing Tests
// ============================================================================

describe('SearchSnippet - Performance Timing', () => {
  const testValues = Array.from({ length: 1000 }, (_, i) => `value_${i}`)
  let puffinFile: Uint8Array
  let mockFetch: ReturnType<typeof createMockFetch>

  beforeEach(() => {
    puffinFile = createTestPuffinFile({ 1: testValues })
    const files = new Map([['https://cdn.example.com.ai/perf.puffin', puffinFile]])
    mockFetch = createMockFetch(files)
  })

  it('completes bloom query within 2ms (cached)', async () => {
    // First fetch to warm cache
    await queryBloom(
      { url: 'https://cdn.example.com.ai/perf.puffin', fieldId: 1, value: 'warmup' },
      { fetch: mockFetch }
    )

    // Time the cached query
    const start = performance.now()

    await queryBloom(
      { url: 'https://cdn.example.com.ai/perf.puffin', fieldId: 1, value: 'value_500' },
      { fetch: mockFetch }
    )

    const duration = performance.now() - start

    // Cached query should complete in under 2ms
    expect(duration).toBeLessThan(2)
  })

  it('completes 100 bloom queries within 50ms (cached)', async () => {
    // Warm cache
    await queryBloom(
      { url: 'https://cdn.example.com.ai/perf.puffin', fieldId: 1, value: 'warmup' },
      { fetch: mockFetch }
    )

    const start = performance.now()

    const queries = Array.from({ length: 100 }, (_, i) => ({
      url: 'https://cdn.example.com.ai/perf.puffin',
      fieldId: 1,
      value: `value_${i % testValues.length}`,
    }))

    await Promise.all(queries.map(q => queryBloom(q, { fetch: mockFetch })))

    const duration = performance.now() - start

    // 100 queries should complete in under 50ms (0.5ms each average)
    expect(duration).toBeLessThan(50)
  })

  it('completes bloom deserialization within 1ms', () => {
    const bloom = createBloomFilterFromValues(testValues, 0.01)
    const serialized = bloom.serialize()

    const start = performance.now()
    BloomFilter.deserialize(serialized)
    const duration = performance.now() - start

    // Deserialization should be very fast
    expect(duration).toBeLessThan(1)
  })

  it('completes bloom mightContain check within 0.1ms', () => {
    const bloom = createBloomFilterFromValues(testValues, 0.01)

    const start = performance.now()

    // Run 1000 checks
    for (let i = 0; i < 1000; i++) {
      bloom.mightContain(`value_${i % testValues.length}`)
    }

    const duration = performance.now() - start
    const avgDuration = duration / 1000

    // Each check should average under 0.1ms
    expect(avgDuration).toBeLessThan(0.1)
  })

  it('measures fetch + deserialize + query total time', async () => {
    // Reset mock to simulate fresh fetch
    const files = new Map([['https://cdn.example.com.ai/timing.puffin', puffinFile]])
    const freshMockFetch = createMockFetch(files)

    const start = performance.now()

    const result = await queryBloom(
      { url: 'https://cdn.example.com.ai/timing.puffin', fieldId: 1, value: 'value_0' },
      { fetch: freshMockFetch }
    )

    const duration = performance.now() - start

    expect(result).toBe(BloomQueryResult.MAYBE)

    // Total time including fetch should be reasonable
    // (In real scenario, CDN cache hit would be ~1-5ms)
    // For mock, should be very fast
    expect(duration).toBeLessThan(10)
  })
})

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('SearchSnippet - Edge Cases', () => {
  it('handles empty value query', async () => {
    const values = ['a', 'b', 'c']
    const puffinFile = createTestPuffinFile({ 1: values })
    const files = new Map([['https://cdn.example.com.ai/empty.puffin', puffinFile]])
    const mockFetch = createMockFetch(files)

    const result = await queryBloom(
      { url: 'https://cdn.example.com.ai/empty.puffin', fieldId: 1, value: '' },
      { fetch: mockFetch }
    )

    // Empty string should return NO (wasn't added to filter)
    // or MAYBE if empty string handling is special
    expect([BloomQueryResult.NO, BloomQueryResult.MAYBE]).toContain(result)
  })

  it('handles unicode values', async () => {
    const unicodeValues = ['cafe', 'resume', 'Tokyo', 'Beijing']
    const puffinFile = createTestPuffinFile({ 1: unicodeValues })
    const files = new Map([['https://cdn.example.com.ai/unicode.puffin', puffinFile]])
    const mockFetch = createMockFetch(files)

    const result = await queryBloom(
      { url: 'https://cdn.example.com.ai/unicode.puffin', fieldId: 1, value: 'Tokyo' },
      { fetch: mockFetch }
    )

    expect(result).toBe(BloomQueryResult.MAYBE)
  })

  it('handles very long values', async () => {
    const longValue = 'x'.repeat(10000) // 10KB string
    const values = [longValue, 'short']
    const puffinFile = createTestPuffinFile({ 1: values })
    const files = new Map([['https://cdn.example.com.ai/long.puffin', puffinFile]])
    const mockFetch = createMockFetch(files)

    const result = await queryBloom(
      { url: 'https://cdn.example.com.ai/long.puffin', fieldId: 1, value: longValue },
      { fetch: mockFetch }
    )

    expect(result).toBe(BloomQueryResult.MAYBE)
  })

  it('handles network timeout gracefully', async () => {
    const slowFetch = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 10000)) // 10 second delay
      return new Response(null, { status: 200 })
    })

    const resultPromise = queryBloom(
      { url: 'https://cdn.example.com.ai/slow.puffin', fieldId: 1, value: 'test' },
      { fetch: slowFetch, timeoutMs: 100 }
    )

    // Should timeout or return error result
    await expect(resultPromise).rejects.toThrow()
  })

  it('handles corrupted Puffin file gracefully', async () => {
    const corruptedData = new Uint8Array([0x50, 0x46, 0x41, 0x31, 0x00, 0x00]) // Valid magic but corrupt
    const files = new Map([['https://cdn.example.com.ai/corrupt.puffin', corruptedData]])
    const mockFetch = createMockFetch(files)

    const result = await fetchBloomFilter(
      'https://cdn.example.com.ai/corrupt.puffin',
      { fieldId: 1 },
      { fetch: mockFetch }
    )

    // Should return null or throw, not crash
    expect(result).toBeNull()
  })

  it('handles concurrent queries to same file', async () => {
    const values = Array.from({ length: 100 }, (_, i) => `value_${i}`)
    const puffinFile = createTestPuffinFile({ 1: values })
    const files = new Map([['https://cdn.example.com.ai/concurrent.puffin', puffinFile]])
    const mockFetch = createMockFetch(files)

    // Fire 10 concurrent queries
    const queries = Array.from({ length: 10 }, (_, i) =>
      queryBloom(
        { url: 'https://cdn.example.com.ai/concurrent.puffin', fieldId: 1, value: `value_${i}` },
        { fetch: mockFetch }
      )
    )

    const results = await Promise.all(queries)

    // All should return MAYBE
    expect(results.every(r => r === BloomQueryResult.MAYBE)).toBe(true)
  })
})

// ============================================================================
// Integration with Puffin Format
// ============================================================================

describe('SearchSnippet - Puffin Integration', () => {
  it('works with real Puffin file format', () => {
    const values = ['integration', 'test', 'values']
    const puffinFile = createTestPuffinFile({ 1: values })

    // Verify Puffin file structure
    const reader = PuffinReader.fromBytes(puffinFile)
    const blobs = reader.getBlobs()

    expect(blobs.length).toBe(1)
    expect(blobs[0].type).toBe('bloom-filter-v1')
    expect(blobs[0].fields).toEqual([1])
  })

  it('extracts correct bloom filter from multi-blob Puffin file', () => {
    const puffinFile = createTestPuffinFile({
      1: ['a', 'b', 'c'],
      2: ['x', 'y', 'z'],
      3: ['1', '2', '3'],
    })

    const reader = PuffinReader.fromBytes(puffinFile)

    // Extract each bloom filter
    const bloom1 = reader.findBlob('bloom-filter-v1', 1)
    const bloom2 = reader.findBlob('bloom-filter-v1', 2)
    const bloom3 = reader.findBlob('bloom-filter-v1', 3)

    expect(bloom1).not.toBeNull()
    expect(bloom2).not.toBeNull()
    expect(bloom3).not.toBeNull()

    // Verify each filter contains correct values
    const filter1 = reader.extractBlob(bloom1!, puffinFile) as BloomFilter
    const filter2 = reader.extractBlob(bloom2!, puffinFile) as BloomFilter
    const filter3 = reader.extractBlob(bloom3!, puffinFile) as BloomFilter

    expect(filter1.mightContain('a')).toBe(true)
    expect(filter1.mightContain('x')).toBe(false) // x is in filter2

    expect(filter2.mightContain('x')).toBe(true)
    expect(filter2.mightContain('1')).toBe(false) // 1 is in filter3

    expect(filter3.mightContain('1')).toBe(true)
    expect(filter3.mightContain('a')).toBe(false) // a is in filter1
  })

  it('handles Puffin files with compression (future)', async () => {
    // TODO: When compression support is added
    // This test documents expected behavior for compressed blobs
    const values = ['compressed', 'test']
    const puffinFile = createTestPuffinFile({ 1: values })
    const files = new Map([['https://cdn.example.com.ai/compressed.puffin', puffinFile]])
    const mockFetch = createMockFetch(files)

    const result = await queryBloom(
      { url: 'https://cdn.example.com.ai/compressed.puffin', fieldId: 1, value: 'compressed' },
      { fetch: mockFetch }
    )

    expect(result).toBe(BloomQueryResult.MAYBE)
  })
})
