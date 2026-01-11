import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  createBloomFilterFromValues,
  PuffinWriter,
} from '../../db/iceberg/puffin'
import {
  InvertedIndexWriter,
  createInvertedIndex,
  simpleTokenize,
} from '../../db/iceberg/inverted-index'
import type { SearchManifest } from '../../db/iceberg/search-manifest'

/**
 * SearchSnippet - Combined Query Router Tests (RED Phase)
 *
 * Tests for the unified query router that combines all search types:
 * - Bloom filter pruning
 * - Range/zonemap pruning
 * - Vector search (centroid-based)
 * - Full-text search (inverted index)
 *
 * The combined router:
 * 1. Parses query parameters from URL
 * 2. Loads manifest and routes to handlers
 * 3. Combines results from multiple search types
 * 4. Respects subrequest budget (max 5)
 * 5. Completes within 5ms total (cached)
 *
 * Query Format:
 * /$.search?
 *   bloom=email:foo@bar.com
 *   range=created_at:gt:2024-01-01
 *   vector=embedding:base64data:k=10
 *   text=content:hello world
 *
 * These tests are expected to FAIL until the combined router is implemented.
 *
 * @module snippets/tests/search-combined.test
 */

// ============================================================================
// Imports from the to-be-implemented combined search router
// ============================================================================

import {
  parseSearchQuery,
  executeSearch,
  clearSearchCache,
  type SearchQuery,
  type SearchResult,
  type BloomQueryParam,
  type RangeQueryParam,
  type VectorQueryParam,
  type TextQueryParam,
} from '../search'

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Creates a test manifest with all index types.
 */
const TEST_MANIFEST: SearchManifest = {
  version: 1,
  base: 'cdn.example.com.ai/test/v1',
  indexes: {
    bloom: {
      email: {
        file: 'indexes/bloom/email.puffin',
        fpr: 0.01,
        items: 10000,
      },
      user_id: {
        file: 'indexes/bloom/user_id.puffin',
        fpr: 0.01,
        items: 10000,
      },
    },
    range: {
      created_at: {
        file: 'indexes/range/created_at.marks',
        offset: 0,
        blocks: 100,
      },
      score: {
        file: 'indexes/range/score.marks',
        offset: 0,
        blocks: 50,
      },
    },
    vector: {
      embedding: {
        file: 'indexes/vector/embedding.bin',
        dims: 384,
        count: 100,  // Match the 100 centroids created in tests
        metric: 'cosine',
      },
    },
    inverted: {
      content: {
        file: 'indexes/inverted/content.inv',
        terms: 5000,
      },
    },
  },
  data: {
    files: ['data/records-0001.parquet'],
  },
}

/**
 * Creates a Puffin file with bloom filters for testing.
 */
function createTestPuffinFile(columnData: Record<number, string[]>): Uint8Array {
  const writer = new PuffinWriter({
    snapshotId: 1234567890,
    sequenceNumber: 1,
  })

  for (const [fieldId, values] of Object.entries(columnData)) {
    const bloom = createBloomFilterFromValues(values, 0.01)
    writer.addBloomFilter(Number(fieldId), bloom)
  }

  return writer.finish()
}

/**
 * Creates a marks file for range queries.
 */
function createTestMarksFile(blocks: Array<{ min: bigint; max: bigint }>): Uint8Array {
  const BYTES_PER_BLOCK = 16
  const buffer = new ArrayBuffer(blocks.length * BYTES_PER_BLOCK)
  const view = new DataView(buffer)

  blocks.forEach((block, i) => {
    const offset = i * BYTES_PER_BLOCK
    view.setBigInt64(offset, block.min, true)
    view.setBigInt64(offset + 8, block.max, true)
  })

  return new Uint8Array(buffer)
}

/**
 * Creates a test inverted index.
 */
function createTestInvertedIndex(): Uint8Array {
  const documents = new Map<number, string>([
    [1, 'The quick brown fox jumps over the lazy dog'],
    [2, 'A quick brown dog runs in the park'],
    [3, 'The lazy cat sleeps all day'],
    [4, 'Dogs and cats are popular pets'],
    [5, 'The fox is a cunning animal'],
  ])
  return createInvertedIndex(documents, simpleTokenize)
}

/**
 * Creates a test centroids file.
 */
function createTestCentroidsFile(numCentroids: number, dims: number): ArrayBuffer {
  const buffer = new ArrayBuffer(numCentroids * dims * 4)
  const float32View = new Float32Array(buffer)

  for (let i = 0; i < numCentroids; i++) {
    // Create simple normalized vectors
    let norm = 0
    for (let d = 0; d < dims; d++) {
      const val = Math.sin(i * 0.1 + d * 0.01)
      float32View[i * dims + d] = val
      norm += val * val
    }
    // Normalize
    norm = Math.sqrt(norm)
    for (let d = 0; d < dims; d++) {
      float32View[i * dims + d] /= norm
    }
  }

  return buffer
}

/**
 * Mock CDN fetch for testing.
 */
function createMockFetch(files: Map<string, Uint8Array | ArrayBuffer>) {
  return vi.fn(async (url: string, _init?: RequestInit) => {
    const data = files.get(url)
    if (!data) {
      return new Response(null, { status: 404, statusText: 'Not Found' })
    }

    const buffer = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Length': String(data instanceof ArrayBuffer ? data.byteLength : data.length),
        'Content-Type': 'application/octet-stream',
      },
    })
  })
}

/**
 * Creates a mock ExecutionContext.
 */
function createMockContext() {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  }
}

// ============================================================================
// Query Parsing Tests
// ============================================================================

describe('SearchSnippet - Query Parsing', () => {
  describe('parseSearchQuery', () => {
    it('parses bloom query parameter', () => {
      const url = new URL('https://api.example.com.ai/$.search?bloom=email:foo@bar.com')

      const query = parseSearchQuery(url)

      expect(query.bloom).toBeDefined()
      expect(query.bloom).toHaveLength(1)
      expect(query.bloom![0]).toEqual({
        field: 'email',
        value: 'foo@bar.com',
      })
    })

    it('parses multiple bloom query parameters', () => {
      const url = new URL(
        'https://api.example.com.ai/$.search?bloom=email:foo@bar.com&bloom=user_id:abc123'
      )

      const query = parseSearchQuery(url)

      expect(query.bloom).toHaveLength(2)
      expect(query.bloom![0]).toEqual({ field: 'email', value: 'foo@bar.com' })
      expect(query.bloom![1]).toEqual({ field: 'user_id', value: 'abc123' })
    })

    it('parses range query parameter with gt operator', () => {
      const url = new URL('https://api.example.com.ai/$.search?range=created_at:gt:2024-01-01')

      const query = parseSearchQuery(url)

      expect(query.range).toBeDefined()
      expect(query.range).toHaveLength(1)
      expect(query.range![0]).toEqual({
        field: 'created_at',
        op: 'gt',
        value: '2024-01-01',
      })
    })

    it('parses range query parameter with lt operator', () => {
      const url = new URL('https://api.example.com.ai/$.search?range=score:lt:100')

      const query = parseSearchQuery(url)

      expect(query.range![0]).toEqual({
        field: 'score',
        op: 'lt',
        value: '100',
      })
    })

    it('parses range query parameter with gte operator', () => {
      const url = new URL('https://api.example.com.ai/$.search?range=score:gte:50')

      const query = parseSearchQuery(url)

      expect(query.range![0]).toEqual({
        field: 'score',
        op: 'gte',
        value: '50',
      })
    })

    it('parses range query parameter with lte operator', () => {
      const url = new URL('https://api.example.com.ai/$.search?range=score:lte:100')

      const query = parseSearchQuery(url)

      expect(query.range![0]).toEqual({
        field: 'score',
        op: 'lte',
        value: '100',
      })
    })

    it('parses range query parameter with eq operator', () => {
      const url = new URL('https://api.example.com.ai/$.search?range=status:eq:active')

      const query = parseSearchQuery(url)

      expect(query.range![0]).toEqual({
        field: 'status',
        op: 'eq',
        value: 'active',
      })
    })

    it('parses multiple range query parameters', () => {
      const url = new URL(
        'https://api.example.com.ai/$.search?range=score:gte:50&range=score:lte:100'
      )

      const query = parseSearchQuery(url)

      expect(query.range).toHaveLength(2)
      expect(query.range![0]).toEqual({ field: 'score', op: 'gte', value: '50' })
      expect(query.range![1]).toEqual({ field: 'score', op: 'lte', value: '100' })
    })

    it('parses vector query parameter', () => {
      // Base64 encoded Float32Array of 4 values
      const floatArray = new Float32Array([0.1, 0.2, 0.3, 0.4])
      const base64 = Buffer.from(floatArray.buffer).toString('base64')
      // URL-encode the base64 to handle special characters like = and +
      const encodedBase64 = encodeURIComponent(base64)
      const url = new URL(`https://api.example.com.ai/$.search?vector=embedding:${encodedBase64}:k=10`)

      const query = parseSearchQuery(url)

      expect(query.vector).toBeDefined()
      expect(query.vector!.field).toBe('embedding')
      expect(query.vector!.k).toBe(10)
      expect(query.vector!.query).toBeInstanceOf(Float32Array)
      expect(query.vector!.query.length).toBe(4)
    })

    it('parses text query parameter', () => {
      const url = new URL('https://api.example.com.ai/$.search?text=content:hello%20world')

      const query = parseSearchQuery(url)

      expect(query.text).toBeDefined()
      expect(query.text!.field).toBe('content')
      expect(query.text!.query).toBe('hello world')
    })

    it('parses combined query with all types', () => {
      const floatArray = new Float32Array([0.1, 0.2, 0.3, 0.4])
      const base64 = Buffer.from(floatArray.buffer).toString('base64')
      const encodedBase64 = encodeURIComponent(base64)
      const url = new URL(
        `https://api.example.com.ai/$.search?` +
          `bloom=email:foo@bar.com&` +
          `range=score:gte:50&` +
          `vector=embedding:${encodedBase64}:k=10&` +
          `text=content:hello%20world`
      )

      const query = parseSearchQuery(url)

      expect(query.bloom).toHaveLength(1)
      expect(query.range).toHaveLength(1)
      expect(query.vector).toBeDefined()
      expect(query.text).toBeDefined()
    })

    it('returns empty query for no parameters', () => {
      const url = new URL('https://api.example.com.ai/$.search')

      const query = parseSearchQuery(url)

      expect(query.bloom).toBeUndefined()
      expect(query.range).toBeUndefined()
      expect(query.vector).toBeUndefined()
      expect(query.text).toBeUndefined()
    })

    it('handles URL-encoded values in bloom query', () => {
      const url = new URL('https://api.example.com.ai/$.search?bloom=email:foo%40bar.com')

      const query = parseSearchQuery(url)

      expect(query.bloom![0].value).toBe('foo@bar.com')
    })

    it('handles colons in bloom values', () => {
      const url = new URL('https://api.example.com.ai/$.search?bloom=timestamp:2024:01:15T10:30:00Z')

      const query = parseSearchQuery(url)

      expect(query.bloom![0].field).toBe('timestamp')
      expect(query.bloom![0].value).toBe('2024:01:15T10:30:00Z')
    })
  })
})

// ============================================================================
// Combined Query Execution Tests
// ============================================================================

describe('SearchSnippet - Combined Query Execution', () => {
  let mockFetch: ReturnType<typeof createMockFetch>
  let mockCtx: ReturnType<typeof createMockContext>

  beforeEach(() => {
    clearSearchCache?.()

    // Create test files
    const files = new Map<string, Uint8Array | ArrayBuffer>()

    // Bloom filter Puffin file
    const emails = ['foo@bar.com', 'alice@example.com.ai', 'bob@test.com']
    const userIds = ['abc123', 'def456', 'ghi789']
    files.set(
      'https://cdn.example.com.ai/test/v1/indexes/bloom/email.puffin',
      createTestPuffinFile({ 1: emails })
    )
    files.set(
      'https://cdn.example.com.ai/test/v1/indexes/bloom/user_id.puffin',
      createTestPuffinFile({ 2: userIds })
    )

    // Range marks files
    const createdAtBlocks = [
      { min: 1704067200000n, max: 1704153600000n }, // Jan 1-2, 2024
      { min: 1704153600000n, max: 1704240000000n }, // Jan 2-3, 2024
      { min: 1704240000000n, max: 1704326400000n }, // Jan 3-4, 2024
    ]
    files.set(
      'https://cdn.example.com.ai/test/v1/indexes/range/created_at.marks',
      createTestMarksFile(createdAtBlocks)
    )

    const scoreBlocks = [
      { min: 0n, max: 50n },
      { min: 51n, max: 100n },
    ]
    files.set(
      'https://cdn.example.com.ai/test/v1/indexes/range/score.marks',
      createTestMarksFile(scoreBlocks)
    )

    // Vector centroids file
    files.set(
      'https://cdn.example.com.ai/test/v1/indexes/vector/embedding.bin',
      createTestCentroidsFile(100, 384)
    )

    // Inverted index file
    files.set(
      'https://cdn.example.com.ai/test/v1/indexes/inverted/content.inv',
      createTestInvertedIndex()
    )

    // Manifest
    files.set(
      'https://cdn.example.com.ai/test/v1/manifest.json',
      new TextEncoder().encode(JSON.stringify(TEST_MANIFEST))
    )

    mockFetch = createMockFetch(files)
    mockCtx = createMockContext()

    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('bloom + range query', () => {
    it('handles bloom + range query', async () => {
      const query: SearchQuery = {
        bloom: [{ field: 'email', value: 'foo@bar.com' }],
        range: [{ field: 'score', op: 'gte', value: '50' }],
      }

      const result = await executeSearch(TEST_MANIFEST, query, mockCtx)

      expect(result).toBeDefined()
      expect(result.pruned).toBeDefined()
      expect(result.timing).toBeDefined()
      expect(result.timing.total_ms).toBeGreaterThanOrEqual(0)
      expect(result.subrequests).toBeLessThanOrEqual(5)
    })

    it('combines bloom and range results with AND semantics', async () => {
      const query: SearchQuery = {
        bloom: [{ field: 'email', value: 'nonexistent@nowhere.com' }], // Should prune
        range: [{ field: 'score', op: 'gte', value: '50' }],
      }

      const result = await executeSearch(TEST_MANIFEST, query, mockCtx)

      // If bloom says NO, entire result is pruned
      expect(result.pruned).toBe(true)
    })
  })

  describe('vector + bloom query', () => {
    it('handles vector + bloom query', async () => {
      const queryVector = new Float32Array(384)
      for (let i = 0; i < 384; i++) {
        queryVector[i] = Math.random()
      }
      // Normalize
      let norm = 0
      for (let i = 0; i < 384; i++) {
        norm += queryVector[i] * queryVector[i]
      }
      norm = Math.sqrt(norm)
      for (let i = 0; i < 384; i++) {
        queryVector[i] /= norm
      }

      const query: SearchQuery = {
        bloom: [{ field: 'email', value: 'foo@bar.com' }],
        vector: { field: 'embedding', query: queryVector, k: 10 },
      }

      const result = await executeSearch(TEST_MANIFEST, query, mockCtx)

      expect(result).toBeDefined()
      expect(result.centroids).toBeDefined()
      expect(result.centroids!.length).toBeLessThanOrEqual(10)
      expect(result.subrequests).toBeLessThanOrEqual(5)
    })

    it('returns centroids with index and distance', async () => {
      const queryVector = new Float32Array(384).fill(0.1)
      // Normalize
      let norm = 0
      for (let i = 0; i < 384; i++) {
        norm += queryVector[i] * queryVector[i]
      }
      norm = Math.sqrt(norm)
      for (let i = 0; i < 384; i++) {
        queryVector[i] /= norm
      }

      const query: SearchQuery = {
        vector: { field: 'embedding', query: queryVector, k: 5 },
      }

      const result = await executeSearch(TEST_MANIFEST, query, mockCtx)

      expect(result.centroids).toBeDefined()
      for (const centroid of result.centroids!) {
        expect(centroid).toHaveProperty('index')
        expect(centroid).toHaveProperty('distance')
        expect(typeof centroid.index).toBe('number')
        expect(typeof centroid.distance).toBe('number')
      }
    })
  })

  describe('subrequest budget', () => {
    it('respects subrequest budget (max 5)', async () => {
      // Create a query that would require many subrequests
      const query: SearchQuery = {
        bloom: [
          { field: 'email', value: 'test1@example.com.ai' },
          { field: 'email', value: 'test2@example.com.ai' },
          { field: 'user_id', value: 'user1' },
        ],
        range: [
          { field: 'created_at', op: 'gte', value: '2024-01-01' },
          { field: 'score', op: 'lte', value: '100' },
        ],
      }

      const result = await executeSearch(TEST_MANIFEST, query, mockCtx)

      expect(result.subrequests).toBeLessThanOrEqual(5)
    })

    it('prioritizes most selective queries when budget limited', async () => {
      // When subrequest budget is limited, should prioritize bloom filters
      // (most likely to prune) over range queries
      const query: SearchQuery = {
        bloom: [{ field: 'email', value: 'nonexistent@example.com.ai' }],
        range: [
          { field: 'created_at', op: 'gte', value: '2024-01-01' },
          { field: 'created_at', op: 'lte', value: '2024-12-31' },
          { field: 'score', op: 'gte', value: '0' },
          { field: 'score', op: 'lte', value: '100' },
        ],
      }

      const result = await executeSearch(TEST_MANIFEST, query, mockCtx)

      // Should still complete within budget
      expect(result.subrequests).toBeLessThanOrEqual(5)
      // If bloom pruned, should short-circuit
      if (result.pruned) {
        expect(result.blocks).toBeUndefined()
      }
    })
  })

  describe('combined pruning result', () => {
    it('returns combined pruning result', async () => {
      const query: SearchQuery = {
        bloom: [{ field: 'email', value: 'foo@bar.com' }],
        range: [{ field: 'score', op: 'gte', value: '50' }],
      }

      const result = await executeSearch(TEST_MANIFEST, query, mockCtx)

      expect(result).toHaveProperty('pruned')
      expect(typeof result.pruned).toBe('boolean')
    })

    it('returns blocks to scan for range queries', async () => {
      const query: SearchQuery = {
        range: [{ field: 'score', op: 'gte', value: '50' }],
      }

      const result = await executeSearch(TEST_MANIFEST, query, mockCtx)

      if (!result.pruned) {
        expect(result.blocks).toBeDefined()
        expect(Array.isArray(result.blocks)).toBe(true)
      }
    })

    it('returns document IDs for text queries', async () => {
      const query: SearchQuery = {
        text: { field: 'content', query: 'quick fox' },
      }

      const result = await executeSearch(TEST_MANIFEST, query, mockCtx)

      if (!result.pruned) {
        expect(result.documents).toBeDefined()
        expect(Array.isArray(result.documents)).toBe(true)
      }
    })

    it('intersects results from multiple query types (AND semantics)', async () => {
      const queryVector = new Float32Array(384).fill(0.1)
      let norm = 0
      for (let i = 0; i < 384; i++) {
        norm += queryVector[i] * queryVector[i]
      }
      norm = Math.sqrt(norm)
      for (let i = 0; i < 384; i++) {
        queryVector[i] /= norm
      }

      const query: SearchQuery = {
        bloom: [{ field: 'email', value: 'foo@bar.com' }],
        range: [{ field: 'score', op: 'gte', value: '50' }],
        vector: { field: 'embedding', query: queryVector, k: 10 },
        text: { field: 'content', query: 'quick' },
      }

      const result = await executeSearch(TEST_MANIFEST, query, mockCtx)

      expect(result).toBeDefined()
      expect(result.timing).toBeDefined()
      expect(result.subrequests).toBeLessThanOrEqual(5)
    })
  })

  describe('timing requirements', () => {
    it('completes within 5ms total (cached)', async () => {
      // Warm up caches
      const warmupQuery: SearchQuery = {
        bloom: [{ field: 'email', value: 'warmup@example.com.ai' }],
      }
      await executeSearch(TEST_MANIFEST, warmupQuery, mockCtx)

      // Now test with cached data
      const query: SearchQuery = {
        bloom: [{ field: 'email', value: 'foo@bar.com' }],
        range: [{ field: 'score', op: 'gte', value: '50' }],
      }

      const start = performance.now()
      const result = await executeSearch(TEST_MANIFEST, query, mockCtx)
      const duration = performance.now() - start

      expect(result.timing.total_ms).toBeLessThan(5)
      expect(duration).toBeLessThan(10) // Allow some slack for test overhead
    })

    it('reports timing breakdown by query type', async () => {
      const query: SearchQuery = {
        bloom: [{ field: 'email', value: 'foo@bar.com' }],
        range: [{ field: 'score', op: 'gte', value: '50' }],
      }

      const result = await executeSearch(TEST_MANIFEST, query, mockCtx)

      expect(result.timing).toHaveProperty('total_ms')
      // May have additional timing breakdowns
      expect(typeof result.timing.total_ms).toBe('number')
    })
  })
})

// ============================================================================
// Partial Failure Handling Tests
// ============================================================================

describe('SearchSnippet - Partial Failure Handling', () => {
  let mockCtx: ReturnType<typeof createMockContext>

  beforeEach(() => {
    clearSearchCache?.()
    mockCtx = createMockContext()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('handles partial failures gracefully', async () => {
    // Create a fetch that fails for some URLs
    const mockFetch = vi.fn(async (url: string) => {
      if (url.includes('bloom')) {
        return new Response(null, { status: 500, statusText: 'Internal Server Error' })
      }
      // Return valid marks file for range
      const blocks = [{ min: 0n, max: 100n }, { min: 101n, max: 200n }]
      return new Response(createTestMarksFile(blocks), {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
      })
    })

    vi.stubGlobal('fetch', mockFetch)

    const query: SearchQuery = {
      bloom: [{ field: 'email', value: 'foo@bar.com' }],
      range: [{ field: 'score', op: 'gte', value: '50' }],
    }

    // Should not throw, but handle gracefully
    const result = await executeSearch(TEST_MANIFEST, query, mockCtx)

    expect(result).toBeDefined()
    // When bloom fails, should treat as MAYBE (not prune)
    // Range should still work
    expect(result.blocks).toBeDefined()
  })

  it('returns partial results when some indexes fail', async () => {
    const files = new Map<string, Uint8Array | ArrayBuffer>()

    // Only bloom filter succeeds
    const emails = ['foo@bar.com']
    files.set(
      'https://cdn.example.com.ai/test/v1/indexes/bloom/email.puffin',
      createTestPuffinFile({ 1: emails })
    )

    const mockFetch = createMockFetch(files)
    vi.stubGlobal('fetch', mockFetch)

    const query: SearchQuery = {
      bloom: [{ field: 'email', value: 'nonexistent@example.com.ai' }],
      range: [{ field: 'score', op: 'gte', value: '50' }], // Will 404
    }

    const result = await executeSearch(TEST_MANIFEST, query, mockCtx)

    expect(result).toBeDefined()
    // Bloom should prune since value doesn't exist
    expect(result.pruned).toBe(true)
  })

  it('treats failed bloom lookups as MAYBE (conservative)', async () => {
    const mockFetch = vi.fn(async () => {
      return new Response(null, { status: 500 })
    })

    vi.stubGlobal('fetch', mockFetch)

    const query: SearchQuery = {
      bloom: [{ field: 'email', value: 'foo@bar.com' }],
    }

    const result = await executeSearch(TEST_MANIFEST, query, mockCtx)

    // Should not prune when bloom lookup fails (conservative approach)
    expect(result.pruned).toBe(false)
  })

  it('handles 404 for missing index files', async () => {
    const mockFetch = vi.fn(async () => {
      return new Response(null, { status: 404, statusText: 'Not Found' })
    })

    vi.stubGlobal('fetch', mockFetch)

    const query: SearchQuery = {
      bloom: [{ field: 'email', value: 'foo@bar.com' }],
    }

    const result = await executeSearch(TEST_MANIFEST, query, mockCtx)

    expect(result).toBeDefined()
    expect(result.pruned).toBe(false) // Conservative on failure
  })

  it('handles network timeout', async () => {
    // Use a mock that immediately rejects with timeout
    const mockFetch = vi.fn(async () => {
      const controller = new AbortController()
      setTimeout(() => controller.abort(), 10) // Abort after 10ms
      await new Promise((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(new Error('Network timeout')))
        // But first wait a bit to let the abort fire
        setTimeout(() => reject(new Error('Network timeout')), 50)
      })
      return new Response(null, { status: 200 })
    })

    vi.stubGlobal('fetch', mockFetch)

    const query: SearchQuery = {
      bloom: [{ field: 'email', value: 'foo@bar.com' }],
    }

    // Should handle the error gracefully
    const result = await executeSearch(TEST_MANIFEST, query, mockCtx, { timeoutMs: 100 })

    expect(result).toBeDefined()
    expect(result.pruned).toBe(false) // Conservative on failure/timeout
  }, 5000)
})

// ============================================================================
// JSON Response Format Tests
// ============================================================================

describe('SearchSnippet - JSON Response Format', () => {
  let mockFetch: ReturnType<typeof createMockFetch>
  let mockCtx: ReturnType<typeof createMockContext>

  beforeEach(() => {
    clearSearchCache?.()

    const files = new Map<string, Uint8Array | ArrayBuffer>()
    const emails = ['foo@bar.com']
    files.set(
      'https://cdn.example.com.ai/test/v1/indexes/bloom/email.puffin',
      createTestPuffinFile({ 1: emails })
    )
    const blocks = [{ min: 0n, max: 100n }]
    files.set(
      'https://cdn.example.com.ai/test/v1/indexes/range/score.marks',
      createTestMarksFile(blocks)
    )

    mockFetch = createMockFetch(files)
    mockCtx = createMockContext()

    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns JSON response format', async () => {
    const query: SearchQuery = {
      bloom: [{ field: 'email', value: 'foo@bar.com' }],
    }

    const result = await executeSearch(TEST_MANIFEST, query, mockCtx)

    // Result should be JSON-serializable
    const json = JSON.stringify(result)
    const parsed = JSON.parse(json)

    expect(parsed).toHaveProperty('pruned')
    expect(parsed).toHaveProperty('timing')
    expect(parsed).toHaveProperty('subrequests')
  })

  it('includes timing breakdown in response', async () => {
    const query: SearchQuery = {
      bloom: [{ field: 'email', value: 'foo@bar.com' }],
      range: [{ field: 'score', op: 'lte', value: '50' }],
    }

    const result = await executeSearch(TEST_MANIFEST, query, mockCtx)

    expect(result.timing).toHaveProperty('total_ms')
    expect(typeof result.timing.total_ms).toBe('number')
    expect(result.timing.total_ms).toBeGreaterThanOrEqual(0)
  })

  it('includes subrequest count in response', async () => {
    const query: SearchQuery = {
      bloom: [{ field: 'email', value: 'foo@bar.com' }],
    }

    const result = await executeSearch(TEST_MANIFEST, query, mockCtx)

    expect(result).toHaveProperty('subrequests')
    expect(typeof result.subrequests).toBe('number')
    expect(result.subrequests).toBeGreaterThanOrEqual(0)
    expect(result.subrequests).toBeLessThanOrEqual(5)
  })

  it('includes blocks array when range query matches', async () => {
    const query: SearchQuery = {
      range: [{ field: 'score', op: 'lte', value: '50' }],
    }

    const result = await executeSearch(TEST_MANIFEST, query, mockCtx)

    if (!result.pruned && result.blocks) {
      expect(Array.isArray(result.blocks)).toBe(true)
      for (const block of result.blocks) {
        expect(typeof block).toBe('number')
      }
    }
  })

  it('includes centroids array when vector query is present', async () => {
    const files = new Map<string, Uint8Array | ArrayBuffer>()
    files.set(
      'https://cdn.example.com.ai/test/v1/indexes/vector/embedding.bin',
      createTestCentroidsFile(100, 384)
    )
    const mockFetchVector = createMockFetch(files)
    vi.stubGlobal('fetch', mockFetchVector)

    const queryVector = new Float32Array(384).fill(0.1)
    let norm = 0
    for (let i = 0; i < 384; i++) {
      norm += queryVector[i] * queryVector[i]
    }
    norm = Math.sqrt(norm)
    for (let i = 0; i < 384; i++) {
      queryVector[i] /= norm
    }

    const query: SearchQuery = {
      vector: { field: 'embedding', query: queryVector, k: 5 },
    }

    const result = await executeSearch(TEST_MANIFEST, query, mockCtx)

    if (result.centroids) {
      expect(Array.isArray(result.centroids)).toBe(true)
      for (const centroid of result.centroids) {
        expect(centroid).toHaveProperty('index')
        expect(centroid).toHaveProperty('distance')
      }
    }
  })

  it('includes documents array when text query matches', async () => {
    const files = new Map<string, Uint8Array | ArrayBuffer>()
    files.set(
      'https://cdn.example.com.ai/test/v1/indexes/inverted/content.inv',
      createTestInvertedIndex()
    )
    const mockFetchText = createMockFetch(files)
    vi.stubGlobal('fetch', mockFetchText)

    const query: SearchQuery = {
      text: { field: 'content', query: 'quick' },
    }

    const result = await executeSearch(TEST_MANIFEST, query, mockCtx)

    if (!result.pruned && result.documents) {
      expect(Array.isArray(result.documents)).toBe(true)
      for (const docId of result.documents) {
        expect(typeof docId).toBe('number')
      }
    }
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('SearchSnippet - Edge Cases', () => {
  let mockCtx: ReturnType<typeof createMockContext>

  beforeEach(() => {
    clearSearchCache?.()
    mockCtx = createMockContext()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('handles empty query gracefully', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    const query: SearchQuery = {}

    const result = await executeSearch(TEST_MANIFEST, query, mockCtx)

    expect(result).toBeDefined()
    expect(result.pruned).toBe(false)
    expect(result.subrequests).toBe(0)
  })

  it('handles missing index field in manifest', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    const query: SearchQuery = {
      bloom: [{ field: 'nonexistent_field', value: 'test' }],
    }

    const result = await executeSearch(TEST_MANIFEST, query, mockCtx)

    // Should handle missing field gracefully
    expect(result).toBeDefined()
    expect(result.pruned).toBe(false) // Conservative
  })

  it('handles malformed vector query data', async () => {
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)

    const query: SearchQuery = {
      vector: { field: 'embedding', query: new Float32Array(0), k: 10 }, // Empty vector
    }

    // Should throw or handle gracefully
    await expect(executeSearch(TEST_MANIFEST, query, mockCtx)).rejects.toThrow(/dimension|empty|invalid/i)
  })

  it('handles dimension mismatch in vector query', async () => {
    const files = new Map<string, Uint8Array | ArrayBuffer>()
    files.set(
      'https://cdn.example.com.ai/test/v1/indexes/vector/embedding.bin',
      createTestCentroidsFile(100, 384)
    )
    const mockFetch = createMockFetch(files)
    vi.stubGlobal('fetch', mockFetch)

    const query: SearchQuery = {
      vector: { field: 'embedding', query: new Float32Array(128), k: 10 }, // Wrong dims
    }

    // Should throw dimension mismatch error
    await expect(executeSearch(TEST_MANIFEST, query, mockCtx)).rejects.toThrow(/dimension/i)
  })

  it('handles very large k value for vector query', async () => {
    const files = new Map<string, Uint8Array | ArrayBuffer>()
    files.set(
      'https://cdn.example.com.ai/test/v1/indexes/vector/embedding.bin',
      createTestCentroidsFile(100, 384)
    )
    const mockFetch = createMockFetch(files)
    vi.stubGlobal('fetch', mockFetch)

    const queryVector = new Float32Array(384).fill(0.1)
    let norm = 0
    for (let i = 0; i < 384; i++) {
      norm += queryVector[i] * queryVector[i]
    }
    norm = Math.sqrt(norm)
    for (let i = 0; i < 384; i++) {
      queryVector[i] /= norm
    }

    const query: SearchQuery = {
      vector: { field: 'embedding', query: queryVector, k: 10000 }, // k > count
    }

    const result = await executeSearch(TEST_MANIFEST, query, mockCtx)

    // Should clamp k to available centroids
    expect(result.centroids!.length).toBeLessThanOrEqual(100)
  })

  it('handles concurrent searches correctly', async () => {
    const files = new Map<string, Uint8Array | ArrayBuffer>()
    const emails = ['foo@bar.com', 'alice@example.com.ai']
    files.set(
      'https://cdn.example.com.ai/test/v1/indexes/bloom/email.puffin',
      createTestPuffinFile({ 1: emails })
    )
    const mockFetch = createMockFetch(files)
    vi.stubGlobal('fetch', mockFetch)

    const queries = Array.from({ length: 10 }, (_, i) => ({
      bloom: [{ field: 'email', value: i % 2 === 0 ? 'foo@bar.com' : 'nonexistent@test.com' }],
    }))

    const results = await Promise.all(
      queries.map((q) => executeSearch(TEST_MANIFEST, q, mockCtx))
    )

    expect(results).toHaveLength(10)
    // Even indices should not prune, odd indices should prune
    for (let i = 0; i < 10; i++) {
      if (i % 2 === 0) {
        expect(results[i].pruned).toBe(false) // foo@bar.com exists
      } else {
        expect(results[i].pruned).toBe(true) // nonexistent doesn't exist
      }
    }
  })
})

// ============================================================================
// Cache Management Tests
// ============================================================================

describe('SearchSnippet - Cache Management', () => {
  let mockFetch: ReturnType<typeof createMockFetch>
  let mockCtx: ReturnType<typeof createMockContext>

  beforeEach(() => {
    clearSearchCache?.()

    const files = new Map<string, Uint8Array | ArrayBuffer>()
    const emails = ['foo@bar.com']
    files.set(
      'https://cdn.example.com.ai/test/v1/indexes/bloom/email.puffin',
      createTestPuffinFile({ 1: emails })
    )

    mockFetch = createMockFetch(files)
    mockCtx = createMockContext()

    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('caches index data between queries', async () => {
    const query: SearchQuery = {
      bloom: [{ field: 'email', value: 'foo@bar.com' }],
    }

    // First query
    await executeSearch(TEST_MANIFEST, query, mockCtx)
    const firstFetchCount = mockFetch.mock.calls.length

    // Second query - should use cache
    await executeSearch(TEST_MANIFEST, query, mockCtx)
    const secondFetchCount = mockFetch.mock.calls.length

    // No additional fetches for cached data
    expect(secondFetchCount).toBe(firstFetchCount)
  })

  it('clearSearchCache clears all cached data', async () => {
    const query: SearchQuery = {
      bloom: [{ field: 'email', value: 'foo@bar.com' }],
    }

    // First query - populates cache
    await executeSearch(TEST_MANIFEST, query, mockCtx)
    const firstFetchCount = mockFetch.mock.calls.length

    // Clear cache
    clearSearchCache?.()

    // Second query - should fetch again
    await executeSearch(TEST_MANIFEST, query, mockCtx)
    const secondFetchCount = mockFetch.mock.calls.length

    expect(secondFetchCount).toBeGreaterThan(firstFetchCount)
  })
})
