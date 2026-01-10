import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  loadManifest,
  clearManifestCache,
  MANIFEST_CACHE_KEY,
  type LoadManifestOptions,
} from '../search'
import type {
  SearchManifest,
  BloomIndexConfig,
  RangeIndexConfig,
  VectorIndexConfig,
  InvertedIndexConfig,
} from '../../db/iceberg/search-manifest'

/**
 * Search Snippet Manifest Loading Tests (RED Phase)
 *
 * The search snippet loads a manifest file from CDN that describes available
 * indexes (bloom, range, vector, inverted) for the 100% FREE Query Architecture.
 *
 * Manifest loading flow:
 * 1. Check isolate memory cache (fastest, lives for isolate lifetime)
 * 2. Check Cache API (cross-isolate, respects TTL)
 * 3. Fetch from CDN path (single subrequest)
 *
 * These tests are expected to FAIL until the search snippet is implemented.
 */

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Minimal valid manifest for testing basic functionality
 */
const MINIMAL_MANIFEST: SearchManifest = {
  version: 1,
  base: 'cdn.apis.do/test/v1',
  indexes: {
    bloom: {
      id: {
        file: 'indexes/bloom/id.bloom',
        fpr: 0.01,
        items: 1000,
      },
    },
  },
  data: {
    files: ['data/test-0001.parquet'],
  },
}

/**
 * Full manifest with all index types for comprehensive testing
 */
const FULL_MANIFEST: SearchManifest = {
  version: 1,
  base: 'cdn.apis.do/wiktionary/v1',
  indexes: {
    bloom: {
      word: {
        file: 'indexes/bloom/word.bloom',
        fpr: 0.01,
        items: 500000,
      },
      etymology: {
        file: 'indexes/bloom/etymology.bloom',
        fpr: 0.001,
        items: 250000,
      },
    },
    range: {
      frequency: {
        file: 'indexes/range/frequency.range',
        offset: 0,
        blocks: 128,
      },
    },
    vector: {
      definition: {
        file: 'indexes/vector/definition.hnsw',
        dims: 384,
        count: 500000,
        metric: 'cosine',
      },
      embedding: {
        file: 'indexes/vector/embedding.hnsw',
        dims: 768,
        count: 500000,
        metric: 'dot',
      },
    },
    inverted: {
      text: {
        file: 'indexes/inverted/text.inv',
        terms: 150000,
      },
    },
  },
  data: {
    files: [
      'data/words-0001.parquet',
      'data/words-0002.parquet',
      'data/words-0003.parquet',
    ],
    puffin: ['stats/words.puffin'],
  },
  cache: {
    queries: {
      file: 'cache/common-queries.bin',
      count: 10000,
    },
  },
}

/**
 * Manifest with only vector indexes (for semantic search testing)
 */
const VECTOR_ONLY_MANIFEST: SearchManifest = {
  version: 1,
  base: 'cdn.apis.do/embeddings/v1',
  indexes: {
    vector: {
      content: {
        file: 'indexes/vector/content.hnsw',
        dims: 1536,
        count: 1000000,
        metric: 'euclidean',
      },
    },
  },
  data: {
    files: ['data/embeddings-0001.parquet'],
  },
}

// ============================================================================
// Mock Helpers
// ============================================================================

function createMockContext() {
  return {
    waitUntil: vi.fn(),
  }
}

function createMockCaches() {
  const store = new Map<string, Response>()
  return {
    default: {
      match: vi.fn(async (key: Request | string) => {
        const url = typeof key === 'string' ? key : key.url
        return store.get(url)?.clone()
      }),
      put: vi.fn(async (key: Request | string, response: Response) => {
        const url = typeof key === 'string' ? key : key.url
        store.set(url, response.clone())
      }),
    },
    _store: store,
  }
}

function createManifestResponse(manifest: SearchManifest, status = 200): Response {
  return new Response(JSON.stringify(manifest), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  })
}

// ============================================================================
// Manifest Loading Tests
// ============================================================================

describe('SearchSnippet - Manifest Loading', () => {
  beforeEach(() => {
    clearManifestCache()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('loads manifest from CDN path', () => {
    it('fetches manifest from provided CDN URL', async () => {
      const ctx = createMockContext()
      const mockCaches = createMockCaches()
      const mockFetch = vi.fn().mockResolvedValue(createManifestResponse(MINIMAL_MANIFEST))

      vi.stubGlobal('fetch', mockFetch)
      vi.stubGlobal('caches', mockCaches)

      const manifest = await loadManifest('https://cdn.apis.do/test/v1/manifest.json', ctx)

      expect(mockFetch).toHaveBeenCalledWith('https://cdn.apis.do/test/v1/manifest.json')
      expect(manifest).toBeDefined()
      expect(manifest.version).toBe(1)
      expect(manifest.base).toBe('cdn.apis.do/test/v1')
    })

    it('fetches manifest using options object', async () => {
      const ctx = createMockContext()
      const mockCaches = createMockCaches()
      const mockFetch = vi.fn().mockResolvedValue(createManifestResponse(FULL_MANIFEST))

      vi.stubGlobal('fetch', mockFetch)
      vi.stubGlobal('caches', mockCaches)

      const options: LoadManifestOptions = {
        url: 'https://cdn.apis.do/wiktionary/v1/manifest.json',
        ttl: 3600,
      }

      const manifest = await loadManifest(options, ctx)

      expect(mockFetch).toHaveBeenCalledWith(options.url)
      expect(manifest.base).toBe('cdn.apis.do/wiktionary/v1')
    })

    it('constructs manifest URL from dataset name', async () => {
      const ctx = createMockContext()
      const mockCaches = createMockCaches()
      const mockFetch = vi.fn().mockResolvedValue(createManifestResponse(MINIMAL_MANIFEST))

      vi.stubGlobal('fetch', mockFetch)
      vi.stubGlobal('caches', mockCaches)

      // Shorthand: just provide dataset name, constructs URL automatically
      const manifest = await loadManifest({ dataset: 'wiktionary' }, ctx)

      // Should construct URL like https://cdn.apis.do/wiktionary/manifest.json
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringMatching(/https:\/\/cdn\.apis\.do\/wiktionary.*manifest\.json/)
      )
      expect(manifest).toBeDefined()
    })
  })

  describe('validates manifest schema', () => {
    it('validates version field equals 1', async () => {
      const ctx = createMockContext()
      const mockCaches = createMockCaches()
      const invalidManifest = { ...MINIMAL_MANIFEST, version: 2 }
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(invalidManifest), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )

      vi.stubGlobal('fetch', mockFetch)
      vi.stubGlobal('caches', mockCaches)

      await expect(loadManifest('https://cdn.apis.do/test/manifest.json', ctx)).rejects.toThrow(
        /version|Expected version 1/i
      )
    })

    it('validates base field is present and non-empty', async () => {
      const ctx = createMockContext()
      const mockCaches = createMockCaches()
      const invalidManifest = { version: 1, indexes: { bloom: {} }, data: { files: ['test.parquet'] } }
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(invalidManifest), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )

      vi.stubGlobal('fetch', mockFetch)
      vi.stubGlobal('caches', mockCaches)

      await expect(loadManifest('https://cdn.apis.do/test/manifest.json', ctx)).rejects.toThrow(
        /base|non-empty string/i
      )
    })

    it('validates at least one index type is defined', async () => {
      const ctx = createMockContext()
      const mockCaches = createMockCaches()
      const invalidManifest = {
        version: 1,
        base: 'cdn.apis.do/test/v1',
        indexes: {},
        data: { files: ['test.parquet'] },
      }
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(invalidManifest), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )

      vi.stubGlobal('fetch', mockFetch)
      vi.stubGlobal('caches', mockCaches)

      await expect(loadManifest('https://cdn.apis.do/test/manifest.json', ctx)).rejects.toThrow(
        /index|At least one index type/i
      )
    })

    it('validates bloom index has required fields (file, fpr, items)', async () => {
      const ctx = createMockContext()
      const mockCaches = createMockCaches()
      const invalidManifest = {
        version: 1,
        base: 'cdn.apis.do/test/v1',
        indexes: {
          bloom: {
            word: { file: 'test.bloom' }, // Missing fpr and items
          },
        },
        data: { files: ['test.parquet'] },
      }
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(invalidManifest), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )

      vi.stubGlobal('fetch', mockFetch)
      vi.stubGlobal('caches', mockCaches)

      await expect(loadManifest('https://cdn.apis.do/test/manifest.json', ctx)).rejects.toThrow(
        /fpr|items|positive/i
      )
    })

    it('validates bloom fpr is between 0 and 1', async () => {
      const ctx = createMockContext()
      const mockCaches = createMockCaches()
      const invalidManifest = {
        version: 1,
        base: 'cdn.apis.do/test/v1',
        indexes: {
          bloom: {
            word: { file: 'test.bloom', fpr: 1.5, items: 1000 }, // Invalid fpr > 1
          },
        },
        data: { files: ['test.parquet'] },
      }
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(invalidManifest), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )

      vi.stubGlobal('fetch', mockFetch)
      vi.stubGlobal('caches', mockCaches)

      await expect(loadManifest('https://cdn.apis.do/test/manifest.json', ctx)).rejects.toThrow(
        /fpr|0 and 1/i
      )
    })

    it('validates vector index has required fields (file, dims, count, metric)', async () => {
      const ctx = createMockContext()
      const mockCaches = createMockCaches()
      const invalidManifest = {
        version: 1,
        base: 'cdn.apis.do/test/v1',
        indexes: {
          vector: {
            embedding: { file: 'test.hnsw', dims: 384 }, // Missing count and metric
          },
        },
        data: { files: ['test.parquet'] },
      }
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(invalidManifest), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )

      vi.stubGlobal('fetch', mockFetch)
      vi.stubGlobal('caches', mockCaches)

      await expect(loadManifest('https://cdn.apis.do/test/manifest.json', ctx)).rejects.toThrow(
        /count|metric|positive/i
      )
    })

    it('validates vector metric is cosine, euclidean, or dot', async () => {
      const ctx = createMockContext()
      const mockCaches = createMockCaches()
      const invalidManifest = {
        version: 1,
        base: 'cdn.apis.do/test/v1',
        indexes: {
          vector: {
            embedding: { file: 'test.hnsw', dims: 384, count: 1000, metric: 'hamming' },
          },
        },
        data: { files: ['test.parquet'] },
      }
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(invalidManifest), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )

      vi.stubGlobal('fetch', mockFetch)
      vi.stubGlobal('caches', mockCaches)

      await expect(loadManifest('https://cdn.apis.do/test/manifest.json', ctx)).rejects.toThrow(
        /metric|cosine|euclidean|dot/i
      )
    })

    it('validates range index has required fields (file, offset, blocks)', async () => {
      const ctx = createMockContext()
      const mockCaches = createMockCaches()
      const invalidManifest = {
        version: 1,
        base: 'cdn.apis.do/test/v1',
        indexes: {
          range: {
            frequency: { file: 'test.range' }, // Missing offset and blocks
          },
        },
        data: { files: ['test.parquet'] },
      }
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(invalidManifest), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )

      vi.stubGlobal('fetch', mockFetch)
      vi.stubGlobal('caches', mockCaches)

      await expect(loadManifest('https://cdn.apis.do/test/manifest.json', ctx)).rejects.toThrow(
        /offset|blocks|integer/i
      )
    })

    it('validates inverted index has required fields (file, terms)', async () => {
      const ctx = createMockContext()
      const mockCaches = createMockCaches()
      const invalidManifest = {
        version: 1,
        base: 'cdn.apis.do/test/v1',
        indexes: {
          inverted: {
            text: { file: 'test.inv' }, // Missing terms
          },
        },
        data: { files: ['test.parquet'] },
      }
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(invalidManifest), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )

      vi.stubGlobal('fetch', mockFetch)
      vi.stubGlobal('caches', mockCaches)

      await expect(loadManifest('https://cdn.apis.do/test/manifest.json', ctx)).rejects.toThrow(
        /terms|positive/i
      )
    })

    it('validates data.files is non-empty array', async () => {
      const ctx = createMockContext()
      const mockCaches = createMockCaches()
      const invalidManifest = {
        version: 1,
        base: 'cdn.apis.do/test/v1',
        indexes: {
          bloom: { word: { file: 'test.bloom', fpr: 0.01, items: 1000 } },
        },
        data: { files: [] }, // Empty files array
      }
      const mockFetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(invalidManifest), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )

      vi.stubGlobal('fetch', mockFetch)
      vi.stubGlobal('caches', mockCaches)

      await expect(loadManifest('https://cdn.apis.do/test/manifest.json', ctx)).rejects.toThrow(
        /files|non-empty|array/i
      )
    })

    it('accepts valid full manifest with all index types', async () => {
      const ctx = createMockContext()
      const mockCaches = createMockCaches()
      const mockFetch = vi.fn().mockResolvedValue(createManifestResponse(FULL_MANIFEST))

      vi.stubGlobal('fetch', mockFetch)
      vi.stubGlobal('caches', mockCaches)

      const manifest = await loadManifest('https://cdn.apis.do/wiktionary/manifest.json', ctx)

      expect(manifest.version).toBe(1)
      expect(manifest.base).toBe('cdn.apis.do/wiktionary/v1')
      expect(manifest.indexes.bloom).toBeDefined()
      expect(manifest.indexes.range).toBeDefined()
      expect(manifest.indexes.vector).toBeDefined()
      expect(manifest.indexes.inverted).toBeDefined()
      expect(manifest.data.files).toHaveLength(3)
      expect(manifest.data.puffin).toHaveLength(1)
      expect(manifest.cache?.queries?.count).toBe(10000)
    })
  })

  describe('handles missing manifest gracefully', () => {
    it('throws error on 404 response', async () => {
      const ctx = createMockContext()
      const mockCaches = createMockCaches()
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('Not Found', {
          status: 404,
          statusText: 'Not Found',
        })
      )

      vi.stubGlobal('fetch', mockFetch)
      vi.stubGlobal('caches', mockCaches)

      await expect(loadManifest('https://cdn.apis.do/missing/manifest.json', ctx)).rejects.toThrow(
        /404|not found|manifest/i
      )
    })

    it('throws error on 500 response', async () => {
      const ctx = createMockContext()
      const mockCaches = createMockCaches()
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('Internal Server Error', {
          status: 500,
          statusText: 'Internal Server Error',
        })
      )

      vi.stubGlobal('fetch', mockFetch)
      vi.stubGlobal('caches', mockCaches)

      await expect(loadManifest('https://cdn.apis.do/test/manifest.json', ctx)).rejects.toThrow(
        /500|server error|failed/i
      )
    })

    it('throws error on network failure', async () => {
      const ctx = createMockContext()
      const mockCaches = createMockCaches()
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network request failed'))

      vi.stubGlobal('fetch', mockFetch)
      vi.stubGlobal('caches', mockCaches)

      await expect(loadManifest('https://cdn.apis.do/test/manifest.json', ctx)).rejects.toThrow(
        /network|failed|fetch/i
      )
    })

    it('throws error on invalid JSON response', async () => {
      const ctx = createMockContext()
      const mockCaches = createMockCaches()
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('{ invalid json }', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )

      vi.stubGlobal('fetch', mockFetch)
      vi.stubGlobal('caches', mockCaches)

      await expect(loadManifest('https://cdn.apis.do/test/manifest.json', ctx)).rejects.toThrow()
    })

    it('throws error on empty response body', async () => {
      const ctx = createMockContext()
      const mockCaches = createMockCaches()
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )

      vi.stubGlobal('fetch', mockFetch)
      vi.stubGlobal('caches', mockCaches)

      await expect(loadManifest('https://cdn.apis.do/test/manifest.json', ctx)).rejects.toThrow()
    })

    it('throws error on null response body', async () => {
      const ctx = createMockContext()
      const mockCaches = createMockCaches()
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('null', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )

      vi.stubGlobal('fetch', mockFetch)
      vi.stubGlobal('caches', mockCaches)

      await expect(loadManifest('https://cdn.apis.do/test/manifest.json', ctx)).rejects.toThrow(
        /object|null/i
      )
    })
  })

  describe('caches manifest parsing', () => {
    it('caches manifest in isolate memory after first fetch', async () => {
      const ctx = createMockContext()
      const mockCaches = createMockCaches()
      const mockFetch = vi.fn().mockResolvedValue(createManifestResponse(MINIMAL_MANIFEST))

      vi.stubGlobal('fetch', mockFetch)
      vi.stubGlobal('caches', mockCaches)

      // First call - should fetch
      const manifest1 = await loadManifest('https://cdn.apis.do/test/manifest.json', ctx)
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Second call - should use memory cache
      const manifest2 = await loadManifest('https://cdn.apis.do/test/manifest.json', ctx)
      expect(mockFetch).toHaveBeenCalledTimes(1) // No additional fetch
      expect(manifest1).toEqual(manifest2)
    })

    it('stores manifest in Cache API for cross-isolate sharing', async () => {
      const ctx = createMockContext()
      const mockCaches = createMockCaches()
      const mockFetch = vi.fn().mockResolvedValue(createManifestResponse(MINIMAL_MANIFEST))

      vi.stubGlobal('fetch', mockFetch)
      vi.stubGlobal('caches', mockCaches)

      await loadManifest('https://cdn.apis.do/test/manifest.json', ctx)

      // Should populate Cache API in waitUntil
      expect(ctx.waitUntil).toHaveBeenCalled()
      expect(mockCaches.default.put).toHaveBeenCalled()

      // Verify cache key contains manifest identifier
      const putCalls = mockCaches.default.put.mock.calls
      expect(putCalls.length).toBeGreaterThan(0)
    })

    it('retrieves manifest from Cache API on memory miss', async () => {
      const ctx = createMockContext()
      const mockCaches = createMockCaches()

      // Pre-populate Cache API with manifest
      const cachedResponse = createManifestResponse(MINIMAL_MANIFEST)
      mockCaches._store.set(MANIFEST_CACHE_KEY, cachedResponse)

      const mockFetch = vi.fn()

      vi.stubGlobal('fetch', mockFetch)
      vi.stubGlobal('caches', mockCaches)

      // Memory cache is empty (cold isolate), should use Cache API
      const manifest = await loadManifest('https://cdn.apis.do/test/manifest.json', ctx)

      // Should NOT have fetched - used Cache API
      expect(mockFetch).not.toHaveBeenCalled()
      expect(manifest.version).toBe(1)
    })

    it('respects TTL for cache expiration', async () => {
      const ctx = createMockContext()
      const mockCaches = createMockCaches()
      const shortTtlManifest = { ...MINIMAL_MANIFEST }
      const mockFetch = vi.fn().mockResolvedValue(createManifestResponse(shortTtlManifest))

      vi.stubGlobal('fetch', mockFetch)
      vi.stubGlobal('caches', mockCaches)

      // First call with short TTL
      await loadManifest({ url: 'https://cdn.apis.do/test/manifest.json', ttl: 1 }, ctx)
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Advance time past TTL
      vi.useFakeTimers()
      vi.advanceTimersByTime(1100) // 1.1 seconds

      // Second call - should refetch due to TTL expiration
      await loadManifest({ url: 'https://cdn.apis.do/test/manifest.json', ttl: 1 }, ctx)
      expect(mockFetch).toHaveBeenCalledTimes(2)

      vi.useRealTimers()
    })

    it('clears manifest cache correctly', async () => {
      const ctx = createMockContext()
      const mockCaches = createMockCaches()
      const mockFetch = vi.fn().mockResolvedValue(createManifestResponse(MINIMAL_MANIFEST))

      vi.stubGlobal('fetch', mockFetch)
      vi.stubGlobal('caches', mockCaches)

      // First call - should fetch
      await loadManifest('https://cdn.apis.do/test/manifest.json', ctx)
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Clear cache
      clearManifestCache()

      // Second call - should fetch again (cache was cleared)
      await loadManifest('https://cdn.apis.do/test/manifest.json', ctx)
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('caches different manifests separately by URL', async () => {
      const ctx = createMockContext()
      const mockCaches = createMockCaches()

      const manifest1 = { ...MINIMAL_MANIFEST, base: 'cdn.apis.do/dataset1/v1' }
      const manifest2 = { ...MINIMAL_MANIFEST, base: 'cdn.apis.do/dataset2/v1' }

      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce(createManifestResponse(manifest1))
        .mockResolvedValueOnce(createManifestResponse(manifest2))

      vi.stubGlobal('fetch', mockFetch)
      vi.stubGlobal('caches', mockCaches)

      const result1 = await loadManifest('https://cdn.apis.do/dataset1/manifest.json', ctx)
      const result2 = await loadManifest('https://cdn.apis.do/dataset2/manifest.json', ctx)

      expect(result1.base).toBe('cdn.apis.do/dataset1/v1')
      expect(result2.base).toBe('cdn.apis.do/dataset2/v1')
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('handles Cache API errors gracefully by falling back to fetch', async () => {
      const ctx = createMockContext()
      const mockCaches = {
        default: {
          match: vi.fn().mockRejectedValue(new Error('Cache API unavailable')),
          put: vi.fn(),
        },
      }
      const mockFetch = vi.fn().mockResolvedValue(createManifestResponse(MINIMAL_MANIFEST))

      vi.stubGlobal('fetch', mockFetch)
      vi.stubGlobal('caches', mockCaches)

      // Should fall back to fetch when Cache API fails
      const manifest = await loadManifest('https://cdn.apis.do/test/manifest.json', ctx)

      expect(mockFetch).toHaveBeenCalled()
      expect(manifest.version).toBe(1)
    })
  })

  describe('extracts index URLs correctly', () => {
    it('builds bloom index URL from manifest base and file path', async () => {
      const ctx = createMockContext()
      const mockCaches = createMockCaches()
      const mockFetch = vi.fn().mockResolvedValue(createManifestResponse(FULL_MANIFEST))

      vi.stubGlobal('fetch', mockFetch)
      vi.stubGlobal('caches', mockCaches)

      const manifest = await loadManifest('https://cdn.apis.do/wiktionary/manifest.json', ctx)

      // The manifest should allow building full URLs for bloom indexes
      const bloomConfig = manifest.indexes.bloom?.word as BloomIndexConfig
      expect(bloomConfig).toBeDefined()
      expect(bloomConfig.file).toBe('indexes/bloom/word.bloom')

      // Full URL should be: https://cdn.apis.do/wiktionary/v1/indexes/bloom/word.bloom
      const expectedUrl = `https://${manifest.base}/${bloomConfig.file}`
      expect(expectedUrl).toBe('https://cdn.apis.do/wiktionary/v1/indexes/bloom/word.bloom')
    })

    it('builds vector index URL from manifest base and file path', async () => {
      const ctx = createMockContext()
      const mockCaches = createMockCaches()
      const mockFetch = vi.fn().mockResolvedValue(createManifestResponse(FULL_MANIFEST))

      vi.stubGlobal('fetch', mockFetch)
      vi.stubGlobal('caches', mockCaches)

      const manifest = await loadManifest('https://cdn.apis.do/wiktionary/manifest.json', ctx)

      const vectorConfig = manifest.indexes.vector?.definition as VectorIndexConfig
      expect(vectorConfig).toBeDefined()
      expect(vectorConfig.file).toBe('indexes/vector/definition.hnsw')
      expect(vectorConfig.dims).toBe(384)
      expect(vectorConfig.metric).toBe('cosine')

      const expectedUrl = `https://${manifest.base}/${vectorConfig.file}`
      expect(expectedUrl).toBe('https://cdn.apis.do/wiktionary/v1/indexes/vector/definition.hnsw')
    })

    it('builds range index URL from manifest base and file path', async () => {
      const ctx = createMockContext()
      const mockCaches = createMockCaches()
      const mockFetch = vi.fn().mockResolvedValue(createManifestResponse(FULL_MANIFEST))

      vi.stubGlobal('fetch', mockFetch)
      vi.stubGlobal('caches', mockCaches)

      const manifest = await loadManifest('https://cdn.apis.do/wiktionary/manifest.json', ctx)

      const rangeConfig = manifest.indexes.range?.frequency as RangeIndexConfig
      expect(rangeConfig).toBeDefined()
      expect(rangeConfig.file).toBe('indexes/range/frequency.range')
      expect(rangeConfig.offset).toBe(0)
      expect(rangeConfig.blocks).toBe(128)

      const expectedUrl = `https://${manifest.base}/${rangeConfig.file}`
      expect(expectedUrl).toBe('https://cdn.apis.do/wiktionary/v1/indexes/range/frequency.range')
    })

    it('builds inverted index URL from manifest base and file path', async () => {
      const ctx = createMockContext()
      const mockCaches = createMockCaches()
      const mockFetch = vi.fn().mockResolvedValue(createManifestResponse(FULL_MANIFEST))

      vi.stubGlobal('fetch', mockFetch)
      vi.stubGlobal('caches', mockCaches)

      const manifest = await loadManifest('https://cdn.apis.do/wiktionary/manifest.json', ctx)

      const invertedConfig = manifest.indexes.inverted?.text as InvertedIndexConfig
      expect(invertedConfig).toBeDefined()
      expect(invertedConfig.file).toBe('indexes/inverted/text.inv')
      expect(invertedConfig.terms).toBe(150000)

      const expectedUrl = `https://${manifest.base}/${invertedConfig.file}`
      expect(expectedUrl).toBe('https://cdn.apis.do/wiktionary/v1/indexes/inverted/text.inv')
    })

    it('builds data file URLs from manifest', async () => {
      const ctx = createMockContext()
      const mockCaches = createMockCaches()
      const mockFetch = vi.fn().mockResolvedValue(createManifestResponse(FULL_MANIFEST))

      vi.stubGlobal('fetch', mockFetch)
      vi.stubGlobal('caches', mockCaches)

      const manifest = await loadManifest('https://cdn.apis.do/wiktionary/manifest.json', ctx)

      expect(manifest.data.files).toHaveLength(3)

      const dataUrls = manifest.data.files.map((file) => `https://${manifest.base}/${file}`)
      expect(dataUrls).toEqual([
        'https://cdn.apis.do/wiktionary/v1/data/words-0001.parquet',
        'https://cdn.apis.do/wiktionary/v1/data/words-0002.parquet',
        'https://cdn.apis.do/wiktionary/v1/data/words-0003.parquet',
      ])
    })

    it('builds puffin stats URL from manifest', async () => {
      const ctx = createMockContext()
      const mockCaches = createMockCaches()
      const mockFetch = vi.fn().mockResolvedValue(createManifestResponse(FULL_MANIFEST))

      vi.stubGlobal('fetch', mockFetch)
      vi.stubGlobal('caches', mockCaches)

      const manifest = await loadManifest('https://cdn.apis.do/wiktionary/manifest.json', ctx)

      expect(manifest.data.puffin).toBeDefined()
      expect(manifest.data.puffin).toHaveLength(1)

      const puffinUrl = `https://${manifest.base}/${manifest.data.puffin![0]}`
      expect(puffinUrl).toBe('https://cdn.apis.do/wiktionary/v1/stats/words.puffin')
    })

    it('builds cache query file URL from manifest', async () => {
      const ctx = createMockContext()
      const mockCaches = createMockCaches()
      const mockFetch = vi.fn().mockResolvedValue(createManifestResponse(FULL_MANIFEST))

      vi.stubGlobal('fetch', mockFetch)
      vi.stubGlobal('caches', mockCaches)

      const manifest = await loadManifest('https://cdn.apis.do/wiktionary/manifest.json', ctx)

      expect(manifest.cache?.queries).toBeDefined()
      expect(manifest.cache?.queries?.file).toBe('cache/common-queries.bin')
      expect(manifest.cache?.queries?.count).toBe(10000)

      const cacheUrl = `https://${manifest.base}/${manifest.cache!.queries!.file}`
      expect(cacheUrl).toBe('https://cdn.apis.do/wiktionary/v1/cache/common-queries.bin')
    })

    it('handles manifest with only vector indexes', async () => {
      const ctx = createMockContext()
      const mockCaches = createMockCaches()
      const mockFetch = vi.fn().mockResolvedValue(createManifestResponse(VECTOR_ONLY_MANIFEST))

      vi.stubGlobal('fetch', mockFetch)
      vi.stubGlobal('caches', mockCaches)

      const manifest = await loadManifest('https://cdn.apis.do/embeddings/manifest.json', ctx)

      expect(manifest.indexes.bloom).toBeUndefined()
      expect(manifest.indexes.range).toBeUndefined()
      expect(manifest.indexes.inverted).toBeUndefined()
      expect(manifest.indexes.vector).toBeDefined()
      expect(manifest.indexes.vector?.content).toBeDefined()
      expect(manifest.indexes.vector?.content.dims).toBe(1536)
      expect(manifest.indexes.vector?.content.metric).toBe('euclidean')
    })
  })
})

// ============================================================================
// Manifest Cache Key Tests
// ============================================================================

describe('SearchSnippet - Manifest Cache Key', () => {
  it('exports MANIFEST_CACHE_KEY as a valid URL string', () => {
    expect(MANIFEST_CACHE_KEY).toBeDefined()
    expect(typeof MANIFEST_CACHE_KEY).toBe('string')
    expect(MANIFEST_CACHE_KEY).toMatch(/^https?:\/\//)
  })

  it('MANIFEST_CACHE_KEY is distinct from proxy config cache key', () => {
    // Ensure we don't collide with proxy snippet's cache key
    expect(MANIFEST_CACHE_KEY).not.toContain('proxy-config')
    expect(MANIFEST_CACHE_KEY).toContain('manifest')
  })
})

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('SearchSnippet - Edge Cases', () => {
  beforeEach(() => {
    clearManifestCache()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('handles manifest with very long file paths', async () => {
    const ctx = createMockContext()
    const mockCaches = createMockCaches()
    const longPathManifest: SearchManifest = {
      version: 1,
      base: 'cdn.apis.do/organization/project/dataset/version/subversion/v1',
      indexes: {
        bloom: {
          field: {
            file: 'deeply/nested/directory/structure/indexes/bloom/field.bloom',
            fpr: 0.01,
            items: 1000,
          },
        },
      },
      data: {
        files: ['deeply/nested/directory/structure/data/records.parquet'],
      },
    }
    const mockFetch = vi.fn().mockResolvedValue(createManifestResponse(longPathManifest))

    vi.stubGlobal('fetch', mockFetch)
    vi.stubGlobal('caches', mockCaches)

    const manifest = await loadManifest('https://cdn.apis.do/test/manifest.json', ctx)
    expect(manifest.base).toBe('cdn.apis.do/organization/project/dataset/version/subversion/v1')
  })

  it('handles manifest with special characters in field names', async () => {
    const ctx = createMockContext()
    const mockCaches = createMockCaches()
    const specialCharsManifest: SearchManifest = {
      version: 1,
      base: 'cdn.apis.do/test/v1',
      indexes: {
        bloom: {
          'user-email': {
            file: 'indexes/bloom/user-email.bloom',
            fpr: 0.01,
            items: 1000,
          },
          user_name: {
            file: 'indexes/bloom/user_name.bloom',
            fpr: 0.01,
            items: 1000,
          },
        },
      },
      data: {
        files: ['data/users.parquet'],
      },
    }
    const mockFetch = vi.fn().mockResolvedValue(createManifestResponse(specialCharsManifest))

    vi.stubGlobal('fetch', mockFetch)
    vi.stubGlobal('caches', mockCaches)

    const manifest = await loadManifest('https://cdn.apis.do/test/manifest.json', ctx)
    expect(manifest.indexes.bloom?.['user-email']).toBeDefined()
    expect(manifest.indexes.bloom?.user_name).toBeDefined()
  })

  it('handles manifest with large item counts', async () => {
    const ctx = createMockContext()
    const mockCaches = createMockCaches()
    const largeManifest: SearchManifest = {
      version: 1,
      base: 'cdn.apis.do/bigdata/v1',
      indexes: {
        bloom: {
          id: {
            file: 'indexes/bloom/id.bloom',
            fpr: 0.0001, // Very low FPR
            items: 100000000, // 100 million items
          },
        },
        vector: {
          embedding: {
            file: 'indexes/vector/embedding.hnsw',
            dims: 2048, // Large embedding dimensions
            count: 50000000, // 50 million vectors
            metric: 'cosine',
          },
        },
      },
      data: {
        files: Array.from({ length: 100 }, (_, i) =>
          `data/shard-${String(i).padStart(4, '0')}.parquet`
        ),
      },
    }
    const mockFetch = vi.fn().mockResolvedValue(createManifestResponse(largeManifest))

    vi.stubGlobal('fetch', mockFetch)
    vi.stubGlobal('caches', mockCaches)

    const manifest = await loadManifest('https://cdn.apis.do/bigdata/manifest.json', ctx)
    expect(manifest.indexes.bloom?.id.items).toBe(100000000)
    expect(manifest.indexes.vector?.embedding.count).toBe(50000000)
    expect(manifest.data.files).toHaveLength(100)
  })

  it('handles concurrent manifest loads for same URL', async () => {
    const ctx = createMockContext()
    const mockCaches = createMockCaches()
    const mockFetch = vi.fn().mockResolvedValue(createManifestResponse(MINIMAL_MANIFEST))

    vi.stubGlobal('fetch', mockFetch)
    vi.stubGlobal('caches', mockCaches)

    // Load same manifest concurrently
    const [manifest1, manifest2, manifest3] = await Promise.all([
      loadManifest('https://cdn.apis.do/test/manifest.json', ctx),
      loadManifest('https://cdn.apis.do/test/manifest.json', ctx),
      loadManifest('https://cdn.apis.do/test/manifest.json', ctx),
    ])

    // Should only fetch once due to request deduplication
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(manifest1).toEqual(manifest2)
    expect(manifest2).toEqual(manifest3)
  })

  it('handles timeout on manifest fetch', async () => {
    const ctx = createMockContext()
    const mockCaches = createMockCaches()
    const mockFetch = vi.fn().mockImplementation(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Request timeout')), 100)
        })
    )

    vi.stubGlobal('fetch', mockFetch)
    vi.stubGlobal('caches', mockCaches)

    await expect(
      loadManifest({ url: 'https://cdn.apis.do/test/manifest.json', timeout: 50 }, ctx)
    ).rejects.toThrow(/timeout/i)
  })

  it('handles redirected manifest URL', async () => {
    const ctx = createMockContext()
    const mockCaches = createMockCaches()

    // Simulate a redirect (response.url differs from request URL)
    const redirectedResponse = createManifestResponse(MINIMAL_MANIFEST)
    Object.defineProperty(redirectedResponse, 'url', {
      value: 'https://cdn.apis.do/test/v2/manifest.json', // Redirected URL
    })

    const mockFetch = vi.fn().mockResolvedValue(redirectedResponse)

    vi.stubGlobal('fetch', mockFetch)
    vi.stubGlobal('caches', mockCaches)

    const manifest = await loadManifest('https://cdn.apis.do/test/manifest.json', ctx)

    expect(manifest).toBeDefined()
    expect(manifest.version).toBe(1)
  })
})
