import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Artifact Storage Integration Tests (RED Phase)
 *
 * These tests verify the full artifact storage flow:
 *
 * WRITE PATH:
 *   POST /$.artifacts (JSONL body)
 *     -> artifacts-ingest.ts (Snippet)
 *     -> Pipeline HTTP endpoint (mocked)
 *     -> R2 Parquet (mocked via IcebergReader)
 *
 * READ PATH:
 *   GET /$.content/{ns}/{type}/{id}.{ext}
 *     -> artifacts-serve.ts (Snippet)
 *     -> Cache API (mocked)
 *     -> IcebergReader (mocked)
 *     -> Response with content
 *
 * Test Cases:
 * 1. POST -> Pipeline mock -> verify JSON array batch format
 * 2. Full round-trip: POST -> GET returns content
 * 3. Cache invalidation: POST update -> GET returns new content
 * 4. Multi-tenant isolation: tenant A can't read tenant B's artifacts
 * 5. Large file chunking: POST >1MB payload -> split into chunks
 * 6. Concurrent requests: multiple POSTs don't interfere
 *
 * These tests are expected to FAIL until the snippets are implemented.
 *
 * @see docs/plans/2026-01-10-artifact-storage-design.md
 */

// ============================================================================
// Imports from to-be-implemented snippets
// ============================================================================

// These imports will fail until the snippets are implemented
import { handleIngest, type IngestResult } from '../artifacts-ingest'
import { handleServe, type ServeResult } from '../artifacts-serve'
import type { TenantArtifactConfig } from '../artifacts-config'

// ============================================================================
// Test Types
// ============================================================================

interface ArtifactRecord {
  ns: string
  type: string
  id: string
  ts?: string
  markdown?: string
  mdx?: string
  html?: string
  esm?: string
  dts?: string
  css?: string
  frontmatter?: Record<string, unknown>
  visibility?: 'public' | 'private' | 'internal'
}

interface PipelineBatch {
  records: ArtifactRecord[]
  timestamp: string
  mode: 'preview' | 'build' | 'bulk'
}

// ============================================================================
// Mock Infrastructure
// ============================================================================

/**
 * Creates a mock Pipeline HTTP endpoint that captures sent batches.
 */
function createMockPipeline() {
  const batches: PipelineBatch[] = []
  let shouldFail = false
  let latencyMs = 0

  const handler = vi.fn(async (request: Request): Promise<Response> => {
    if (latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, latencyMs))
    }

    if (shouldFail) {
      return new Response('Pipeline Error', { status: 500 })
    }

    try {
      const body = await request.json()
      const mode = request.headers.get('X-Pipeline-Mode') || 'build'

      batches.push({
        records: Array.isArray(body) ? body : [body],
        timestamp: new Date().toISOString(),
        mode: mode as 'preview' | 'build' | 'bulk',
      })

      return new Response(JSON.stringify({ accepted: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (error) {
      return new Response('Invalid JSON', { status: 400 })
    }
  })

  return {
    handler,
    batches,
    setFailure: (fail: boolean) => {
      shouldFail = fail
    },
    setLatency: (ms: number) => {
      latencyMs = ms
    },
    clear: () => {
      batches.length = 0
    },
  }
}

/**
 * Creates a mock Cache API (in-memory Map).
 */
function createMockCache() {
  const store = new Map<string, { response: Response; timestamp: number; maxAge: number }>()

  return {
    match: vi.fn(async (request: Request | string): Promise<Response | undefined> => {
      const url = typeof request === 'string' ? request : request.url
      const entry = store.get(url)

      if (!entry) {
        return undefined
      }

      const age = (Date.now() - entry.timestamp) / 1000
      if (age > entry.maxAge) {
        // Stale but still return for SWR
        const response = entry.response.clone()
        // Add X-Cache-Stale header to indicate staleness
        const headers = new Headers(response.headers)
        headers.set('X-Cache-Stale', 'true')
        headers.set('X-Cache-Age', String(Math.floor(age)))
        return new Response(response.body, {
          status: response.status,
          headers,
        })
      }

      const response = entry.response.clone()
      const headers = new Headers(response.headers)
      headers.set('X-Cache-Age', String(Math.floor(age)))
      return new Response(response.body, {
        status: response.status,
        headers,
      })
    }),

    put: vi.fn(async (request: Request | string, response: Response): Promise<void> => {
      const url = typeof request === 'string' ? request : request.url
      const cacheControl = response.headers.get('Cache-Control') || ''
      const maxAgeMatch = cacheControl.match(/max-age=(\d+)/)
      const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : 300

      store.set(url, {
        response: response.clone(),
        timestamp: Date.now(),
        maxAge,
      })
    }),

    delete: vi.fn(async (request: Request | string): Promise<boolean> => {
      const url = typeof request === 'string' ? request : request.url
      return store.delete(url)
    }),

    _store: store,
    clear: () => store.clear(),
  }
}

/**
 * Creates a mock IcebergReader (in-memory record store).
 */
function createMockIcebergReader() {
  const records = new Map<string, ArtifactRecord>()

  // Generate a unique key for a record
  const getKey = (ns: string, type: string, id: string) => `${ns}/${type}/${id}`

  return {
    getRecord: vi.fn(
      async <T extends ArtifactRecord = ArtifactRecord>(options: {
        table: string
        partition: { ns: string; type: string }
        id: string
        columns?: string[]
      }): Promise<T | null> => {
        const key = getKey(options.partition.ns, options.partition.type, options.id)
        const record = records.get(key) as T | undefined

        if (!record) {
          return null
        }

        // If columns specified, filter to only those columns
        if (options.columns && options.columns.length > 0) {
          const filtered: Partial<T> = {}
          for (const col of options.columns) {
            if (col in record) {
              ;(filtered as Record<string, unknown>)[col] = (record as Record<string, unknown>)[col]
            }
          }
          return { ...filtered, ns: record.ns, type: record.type, id: record.id } as T
        }

        return record
      }
    ),

    // Helper methods for test setup
    addRecord: (record: ArtifactRecord) => {
      const key = getKey(record.ns, record.type, record.id)
      records.set(key, { ...record, ts: record.ts || new Date().toISOString() })
    },

    updateRecord: (ns: string, type: string, id: string, updates: Partial<ArtifactRecord>) => {
      const key = getKey(ns, type, id)
      const existing = records.get(key)
      if (existing) {
        records.set(key, { ...existing, ...updates, ts: new Date().toISOString() })
      }
    },

    deleteRecord: (ns: string, type: string, id: string) => {
      const key = getKey(ns, type, id)
      return records.delete(key)
    },

    hasRecord: (ns: string, type: string, id: string) => {
      const key = getKey(ns, type, id)
      return records.has(key)
    },

    _records: records,
    clear: () => records.clear(),
  }
}

/**
 * Creates a mock execution context.
 */
function createMockContext() {
  const waitUntilPromises: Promise<unknown>[] = []
  return {
    waitUntil: vi.fn((promise: Promise<unknown>) => {
      waitUntilPromises.push(promise)
    }),
    passThroughOnException: vi.fn(),
    _waitUntilPromises: waitUntilPromises,
  }
}

/**
 * Creates a mock environment with all bindings.
 */
function createMockEnv(overrides: Partial<MockEnv> = {}) {
  return {
    PIPELINE_PREVIEW_URL: 'https://pipeline.example.com.ai/preview',
    PIPELINE_BUILD_URL: 'https://pipeline.example.com.ai/build',
    PIPELINE_BULK_URL: 'https://pipeline.example.com.ai/bulk',
    ARTIFACTS_BUCKET: {} as R2Bucket,
    CONFIG_KV: {} as KVNamespace,
    ...overrides,
  }
}

interface MockEnv {
  PIPELINE_PREVIEW_URL: string
  PIPELINE_BUILD_URL: string
  PIPELINE_BULK_URL: string
  ARTIFACTS_BUCKET: R2Bucket
  CONFIG_KV: KVNamespace
}

/**
 * Creates JSONL body from artifact records.
 */
function createJsonlBody(records: ArtifactRecord[]): string {
  return records.map((r) => JSON.stringify(r)).join('\n')
}

/**
 * Creates an ingest request.
 */
function createIngestRequest(
  body: string,
  options: { mode?: 'preview' | 'build' | 'bulk'; auth?: string } = {}
): Request {
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-ndjson',
  }

  if (options.mode) {
    headers['X-Artifact-Mode'] = options.mode
  }

  if (options.auth) {
    headers['Authorization'] = `Bearer ${options.auth}`
  }

  return new Request('https://api.example.com.ai/$.artifacts', {
    method: 'POST',
    headers,
    body,
  })
}

/**
 * Creates a serve request.
 */
function createServeRequest(
  ns: string,
  type: string,
  id: string,
  ext: string,
  options: { maxAge?: number; fresh?: boolean } = {}
): Request {
  const url = new URL(`https://api.example.com.ai/$.content/${ns}/${type}/${id}.${ext}`)

  if (options.maxAge !== undefined) {
    url.searchParams.set('max_age', String(options.maxAge))
  }

  if (options.fresh) {
    url.searchParams.set('fresh', 'true')
  }

  return new Request(url.toString())
}

// ============================================================================
// Test Fixtures
// ============================================================================

const TEST_TENANT_CONFIG: TenantArtifactConfig = {
  ns: 'app.do',
  pipelines: {
    allowedModes: ['preview', 'build', 'bulk'],
    defaultMode: 'build',
  },
  cache: {
    defaultMaxAge: 300,
    defaultStaleWhileRevalidate: 60,
    minMaxAge: 10,
    allowFreshBypass: true,
  },
  limits: {
    maxArtifactsPerRequest: 1000,
    maxBytesPerRequest: 10 * 1024 * 1024,
    maxRequestsPerMinute: 100,
  },
}

const SAMPLE_ARTIFACTS: ArtifactRecord[] = [
  {
    ns: 'app.do',
    type: 'Page',
    id: 'home',
    markdown: '# Home\n\nWelcome to our app!',
    html: '<h1>Home</h1>\n<p>Welcome to our app!</p>',
    frontmatter: { title: 'Home', layout: 'default' },
  },
  {
    ns: 'app.do',
    type: 'Page',
    id: 'about',
    markdown: '# About\n\nLearn more about us.',
    html: '<h1>About</h1>\n<p>Learn more about us.</p>',
    frontmatter: { title: 'About', layout: 'default' },
  },
  {
    ns: 'app.do',
    type: 'Component',
    id: 'Button',
    mdx: 'export const Button = ({ children }) => <button>{children}</button>',
    esm: 'export const Button = ({ children }) => React.createElement("button", null, children);',
    dts: 'export declare const Button: React.FC<{ children: React.ReactNode }>;',
  },
]

// ============================================================================
// Pipeline Batch Format Tests
// ============================================================================

describe('Artifact Integration - Pipeline Batch Format', () => {
  let mockPipeline: ReturnType<typeof createMockPipeline>
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockPipeline = createMockPipeline()
    mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

      if (url.includes('pipeline.example.com.ai')) {
        const request = new Request(url, init)
        return mockPipeline.handler(request)
      }

      return new Response('Not Found', { status: 404 })
    })
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    mockPipeline.clear()
  })

  it('sends artifacts to Pipeline as JSON array batch', async () => {
    const body = createJsonlBody(SAMPLE_ARTIFACTS)
    const request = createIngestRequest(body)
    const env = createMockEnv()
    const ctx = createMockContext()

    const result = await handleIngest(request, env, ctx)

    expect(result.accepted).toBe(3)
    expect(mockPipeline.batches.length).toBe(1)

    // Verify batch format is JSON array
    const batch = mockPipeline.batches[0]
    expect(batch.records).toBeInstanceOf(Array)
    expect(batch.records.length).toBe(3)
    expect(batch.records[0]).toMatchObject({
      ns: 'app.do',
      type: 'Page',
      id: 'home',
    })
  })

  it('includes all artifact fields in Pipeline batch', async () => {
    const artifact: ArtifactRecord = {
      ns: 'app.do',
      type: 'Page',
      id: 'full',
      markdown: '# Full Page',
      mdx: '<Component />',
      html: '<h1>Full Page</h1>',
      esm: 'export default {}',
      dts: 'export {}',
      css: '.page { color: blue; }',
      frontmatter: { title: 'Full', author: 'Test' },
      visibility: 'public',
    }

    const body = createJsonlBody([artifact])
    const request = createIngestRequest(body)
    const env = createMockEnv()
    const ctx = createMockContext()

    await handleIngest(request, env, ctx)

    const batch = mockPipeline.batches[0]
    expect(batch.records[0]).toMatchObject({
      ns: 'app.do',
      type: 'Page',
      id: 'full',
      markdown: '# Full Page',
      mdx: '<Component />',
      html: '<h1>Full Page</h1>',
      esm: 'export default {}',
      dts: 'export {}',
      css: '.page { color: blue; }',
      frontmatter: { title: 'Full', author: 'Test' },
      visibility: 'public',
    })
  })

  it('routes to correct Pipeline based on X-Artifact-Mode header', async () => {
    const body = createJsonlBody([SAMPLE_ARTIFACTS[0]])

    // Test preview mode
    const previewRequest = createIngestRequest(body, { mode: 'preview' })
    await handleIngest(previewRequest, createMockEnv(), createMockContext())

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('pipeline.example.com.ai/preview'),
      expect.anything()
    )

    mockPipeline.clear()
    mockFetch.mockClear()

    // Test bulk mode
    const bulkRequest = createIngestRequest(body, { mode: 'bulk' })
    await handleIngest(bulkRequest, createMockEnv(), createMockContext())

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('pipeline.example.com.ai/bulk'),
      expect.anything()
    )
  })

  it('defaults to build Pipeline when no mode specified', async () => {
    const body = createJsonlBody([SAMPLE_ARTIFACTS[0]])
    const request = createIngestRequest(body) // No mode
    const env = createMockEnv()
    const ctx = createMockContext()

    await handleIngest(request, env, ctx)

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('pipeline.example.com.ai/build'),
      expect.anything()
    )
  })

  it('adds timestamp to batch if not present', async () => {
    const artifact: ArtifactRecord = {
      ns: 'app.do',
      type: 'Page',
      id: 'no-ts',
      markdown: '# No Timestamp',
    }

    const body = createJsonlBody([artifact])
    const request = createIngestRequest(body)
    const env = createMockEnv()
    const ctx = createMockContext()

    await handleIngest(request, env, ctx)

    const batch = mockPipeline.batches[0]
    expect(batch.records[0].ts).toBeDefined()
    expect(typeof batch.records[0].ts).toBe('string')
  })

  it('returns chunk count in response', async () => {
    const body = createJsonlBody(SAMPLE_ARTIFACTS)
    const request = createIngestRequest(body)
    const env = createMockEnv()
    const ctx = createMockContext()

    const result = await handleIngest(request, env, ctx)

    expect(result).toHaveProperty('chunks')
    expect(result.chunks).toBeGreaterThanOrEqual(1)
  })

  it('returns estimatedAvailableAt in response', async () => {
    const body = createJsonlBody(SAMPLE_ARTIFACTS)
    const request = createIngestRequest(body, { mode: 'build' })
    const env = createMockEnv()
    const ctx = createMockContext()

    const result = await handleIngest(request, env, ctx)

    expect(result).toHaveProperty('estimatedAvailableAt')
    // build mode has 30s buffer
    const estimated = new Date(result.estimatedAvailableAt)
    const now = new Date()
    expect(estimated.getTime() - now.getTime()).toBeGreaterThanOrEqual(25000) // ~30s buffer
  })
})

// ============================================================================
// Full Round-Trip Tests
// ============================================================================

describe('Artifact Integration - Full Round-Trip', () => {
  let mockPipeline: ReturnType<typeof createMockPipeline>
  let mockCache: ReturnType<typeof createMockCache>
  let mockReader: ReturnType<typeof createMockIcebergReader>
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockPipeline = createMockPipeline()
    mockCache = createMockCache()
    mockReader = createMockIcebergReader()

    mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

      if (url.includes('pipeline.example.com.ai')) {
        const request = new Request(url, init)
        return mockPipeline.handler(request)
      }

      return new Response('Not Found', { status: 404 })
    })

    vi.stubGlobal('fetch', mockFetch)
    vi.stubGlobal('caches', { default: mockCache })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    mockPipeline.clear()
    mockCache.clear()
    mockReader.clear()
  })

  it('POST artifact -> mock Pipeline accepts -> GET returns content', async () => {
    const artifact: ArtifactRecord = {
      ns: 'app.do',
      type: 'Page',
      id: 'roundtrip',
      markdown: '# Round Trip Test\n\nThis content should be retrievable.',
      html: '<h1>Round Trip Test</h1>\n<p>This content should be retrievable.</p>',
    }

    // Step 1: POST artifact
    const ingestBody = createJsonlBody([artifact])
    const ingestRequest = createIngestRequest(ingestBody)
    const env = createMockEnv()
    const ctx = createMockContext()

    const ingestResult = await handleIngest(ingestRequest, env, ctx)
    expect(ingestResult.accepted).toBe(1)

    // Simulate Pipeline writing to Parquet (mock reader has the data)
    mockReader.addRecord(artifact)

    // Step 2: GET artifact
    const serveRequest = createServeRequest('app.do', 'Page', 'roundtrip', 'md')

    const serveResult = await handleServe(serveRequest, env, ctx, {
      reader: mockReader,
      cache: mockCache,
    })

    expect(serveResult.status).toBe(200)
    expect(serveResult.contentType).toBe('text/markdown')
    expect(serveResult.body).toBe('# Round Trip Test\n\nThis content should be retrievable.')
  })

  it('GET returns correct content for each extension', async () => {
    const artifact: ArtifactRecord = {
      ns: 'app.do',
      type: 'Page',
      id: 'multi-format',
      markdown: '# Markdown Content',
      html: '<h1>HTML Content</h1>',
      esm: 'export default function() {}',
      css: '.page { color: red; }',
    }

    mockReader.addRecord(artifact)
    const env = createMockEnv()
    const ctx = createMockContext()

    // Test .md extension
    const mdResult = await handleServe(
      createServeRequest('app.do', 'Page', 'multi-format', 'md'),
      env,
      ctx,
      { reader: mockReader, cache: mockCache }
    )
    expect(mdResult.contentType).toBe('text/markdown')
    expect(mdResult.body).toBe('# Markdown Content')

    // Test .html extension
    const htmlResult = await handleServe(
      createServeRequest('app.do', 'Page', 'multi-format', 'html'),
      env,
      ctx,
      { reader: mockReader, cache: mockCache }
    )
    expect(htmlResult.contentType).toBe('text/html')
    expect(htmlResult.body).toBe('<h1>HTML Content</h1>')

    // Test .js extension (ESM)
    const jsResult = await handleServe(
      createServeRequest('app.do', 'Page', 'multi-format', 'js'),
      env,
      ctx,
      { reader: mockReader, cache: mockCache }
    )
    expect(jsResult.contentType).toBe('application/javascript')
    expect(jsResult.body).toBe('export default function() {}')

    // Test .css extension
    const cssResult = await handleServe(
      createServeRequest('app.do', 'Page', 'multi-format', 'css'),
      env,
      ctx,
      { reader: mockReader, cache: mockCache }
    )
    expect(cssResult.contentType).toBe('text/css')
    expect(cssResult.body).toBe('.page { color: red; }')
  })

  it('returns 404 for non-existent artifact', async () => {
    const env = createMockEnv()
    const ctx = createMockContext()

    const result = await handleServe(
      createServeRequest('app.do', 'Page', 'nonexistent', 'md'),
      env,
      ctx,
      { reader: mockReader, cache: mockCache }
    )

    expect(result.status).toBe(404)
  })

  it('returns 404 for missing column (extension)', async () => {
    const artifact: ArtifactRecord = {
      ns: 'app.do',
      type: 'Page',
      id: 'no-html',
      markdown: '# Only Markdown',
      // No html field
    }

    mockReader.addRecord(artifact)
    const env = createMockEnv()
    const ctx = createMockContext()

    const result = await handleServe(
      createServeRequest('app.do', 'Page', 'no-html', 'html'),
      env,
      ctx,
      { reader: mockReader, cache: mockCache }
    )

    expect(result.status).toBe(404)
  })

  it('sets correct Cache-Control headers', async () => {
    const artifact: ArtifactRecord = {
      ns: 'app.do',
      type: 'Page',
      id: 'cached',
      markdown: '# Cached Content',
    }

    mockReader.addRecord(artifact)
    const env = createMockEnv()
    const ctx = createMockContext()

    const result = await handleServe(
      createServeRequest('app.do', 'Page', 'cached', 'md'),
      env,
      ctx,
      { reader: mockReader, cache: mockCache }
    )

    expect(result.headers['Cache-Control']).toMatch(/max-age=\d+/)
    expect(result.headers['Cache-Control']).toMatch(/stale-while-revalidate=\d+/)
  })

  it('includes X-Artifact-Source header', async () => {
    const artifact: ArtifactRecord = {
      ns: 'app.do',
      type: 'Page',
      id: 'source-test',
      markdown: '# Source Test',
    }

    mockReader.addRecord(artifact)
    const env = createMockEnv()
    const ctx = createMockContext()

    // First request - should be from parquet
    const result1 = await handleServe(
      createServeRequest('app.do', 'Page', 'source-test', 'md'),
      env,
      ctx,
      { reader: mockReader, cache: mockCache }
    )

    expect(result1.headers['X-Artifact-Source']).toBe('parquet')

    // Second request - should be from cache
    const result2 = await handleServe(
      createServeRequest('app.do', 'Page', 'source-test', 'md'),
      env,
      ctx,
      { reader: mockReader, cache: mockCache }
    )

    expect(result2.headers['X-Artifact-Source']).toBe('cache')
  })
})

// ============================================================================
// Cache Invalidation / SWR Tests
// ============================================================================

describe('Artifact Integration - Cache Invalidation', () => {
  let mockPipeline: ReturnType<typeof createMockPipeline>
  let mockCache: ReturnType<typeof createMockCache>
  let mockReader: ReturnType<typeof createMockIcebergReader>

  beforeEach(() => {
    mockPipeline = createMockPipeline()
    mockCache = createMockCache()
    mockReader = createMockIcebergReader()

    vi.stubGlobal('caches', { default: mockCache })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    mockPipeline.clear()
    mockCache.clear()
    mockReader.clear()
  })

  it('POST update -> GET returns new content after cache expires', async () => {
    const env = createMockEnv()
    const ctx = createMockContext()

    // Initial artifact
    const initialArtifact: ArtifactRecord = {
      ns: 'app.do',
      type: 'Page',
      id: 'update-test',
      markdown: '# Version 1',
    }
    mockReader.addRecord(initialArtifact)

    // First GET - populates cache
    const result1 = await handleServe(
      createServeRequest('app.do', 'Page', 'update-test', 'md'),
      env,
      ctx,
      { reader: mockReader, cache: mockCache }
    )
    expect(result1.body).toBe('# Version 1')

    // Update artifact in reader (simulates Pipeline write)
    mockReader.updateRecord('app.do', 'Page', 'update-test', {
      markdown: '# Version 2',
    })

    // Invalidate cache (simulates cache expiration)
    await mockCache.delete(new Request('https://api.example.com.ai/$.content/app.do/Page/update-test.md'))

    // Second GET - should get new content
    const result2 = await handleServe(
      createServeRequest('app.do', 'Page', 'update-test', 'md'),
      env,
      ctx,
      { reader: mockReader, cache: mockCache }
    )
    expect(result2.body).toBe('# Version 2')
  })

  it('?fresh=true bypasses cache and returns fresh content', async () => {
    const env = createMockEnv()
    const ctx = createMockContext()

    // Initial artifact
    const artifact: ArtifactRecord = {
      ns: 'app.do',
      type: 'Page',
      id: 'fresh-test',
      markdown: '# Initial Content',
    }
    mockReader.addRecord(artifact)

    // First GET - populates cache
    await handleServe(createServeRequest('app.do', 'Page', 'fresh-test', 'md'), env, ctx, {
      reader: mockReader,
      cache: mockCache,
    })

    // Update artifact
    mockReader.updateRecord('app.do', 'Page', 'fresh-test', {
      markdown: '# Updated Content',
    })

    // GET without fresh - should return cached (old) content
    const cachedResult = await handleServe(
      createServeRequest('app.do', 'Page', 'fresh-test', 'md'),
      env,
      ctx,
      { reader: mockReader, cache: mockCache }
    )
    expect(cachedResult.body).toBe('# Initial Content')
    expect(cachedResult.headers['X-Artifact-Source']).toBe('cache')

    // GET with fresh=true - should bypass cache
    const freshResult = await handleServe(
      createServeRequest('app.do', 'Page', 'fresh-test', 'md', { fresh: true }),
      env,
      ctx,
      { reader: mockReader, cache: mockCache }
    )
    expect(freshResult.body).toBe('# Updated Content')
    expect(freshResult.headers['X-Artifact-Source']).toBe('parquet')
  })

  it('respects ?max_age query param for custom cache TTL', async () => {
    const env = createMockEnv()
    const ctx = createMockContext()

    const artifact: ArtifactRecord = {
      ns: 'app.do',
      type: 'Page',
      id: 'max-age-test',
      markdown: '# Max Age Test',
    }
    mockReader.addRecord(artifact)

    const result = await handleServe(
      createServeRequest('app.do', 'Page', 'max-age-test', 'md', { maxAge: 60 }),
      env,
      ctx,
      { reader: mockReader, cache: mockCache }
    )

    expect(result.headers['Cache-Control']).toMatch(/max-age=60/)
  })

  it('enforces minimum max_age from tenant config', async () => {
    const env = createMockEnv()
    const ctx = createMockContext()

    const artifact: ArtifactRecord = {
      ns: 'app.do',
      type: 'Page',
      id: 'min-age-test',
      markdown: '# Min Age Test',
    }
    mockReader.addRecord(artifact)

    // Request with very low max_age (below minimum)
    const result = await handleServe(
      createServeRequest('app.do', 'Page', 'min-age-test', 'md', { maxAge: 1 }),
      env,
      ctx,
      { reader: mockReader, cache: mockCache, tenantConfig: TEST_TENANT_CONFIG }
    )

    // Should be clamped to minimum (10 from config)
    expect(result.headers['Cache-Control']).toMatch(/max-age=10/)
  })

  it('triggers async revalidation for stale content (SWR)', async () => {
    const env = createMockEnv()
    const ctx = createMockContext()

    const artifact: ArtifactRecord = {
      ns: 'app.do',
      type: 'Page',
      id: 'swr-test',
      markdown: '# SWR Test',
    }
    mockReader.addRecord(artifact)

    // Manually add stale cache entry
    const cacheUrl = 'https://api.example.com.ai/$.content/app.do/Page/swr-test.md'
    mockCache._store.set(cacheUrl, {
      response: new Response('# Old Content', {
        headers: { 'Cache-Control': 'max-age=10' },
      }),
      timestamp: Date.now() - 20000, // 20s ago, cache has 10s max-age = stale
      maxAge: 10,
    })

    const result = await handleServe(
      createServeRequest('app.do', 'Page', 'swr-test', 'md'),
      env,
      ctx,
      { reader: mockReader, cache: mockCache }
    )

    // Should return stale content immediately
    expect(result.body).toBe('# Old Content')
    expect(result.headers['X-Cache-Stale']).toBe('true')

    // Should have triggered async revalidation via waitUntil
    expect(ctx.waitUntil).toHaveBeenCalled()
  })
})

// ============================================================================
// Multi-Tenant Isolation Tests
// ============================================================================

describe('Artifact Integration - Multi-Tenant Isolation', () => {
  let mockReader: ReturnType<typeof createMockIcebergReader>
  let mockCache: ReturnType<typeof createMockCache>

  beforeEach(() => {
    mockReader = createMockIcebergReader()
    mockCache = createMockCache()

    vi.stubGlobal('caches', { default: mockCache })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    mockReader.clear()
    mockCache.clear()
  })

  it("tenant A cannot read tenant B's artifacts", async () => {
    const env = createMockEnv()
    const ctx = createMockContext()

    // Tenant A's artifact
    mockReader.addRecord({
      ns: 'tenant-a.do',
      type: 'Page',
      id: 'secret',
      markdown: "# Tenant A's Secret",
      visibility: 'private',
    })

    // Tenant B's artifact
    mockReader.addRecord({
      ns: 'tenant-b.do',
      type: 'Page',
      id: 'secret',
      markdown: "# Tenant B's Secret",
      visibility: 'private',
    })

    // Tenant A requesting their own artifact - should succeed
    const tenantAResult = await handleServe(
      createServeRequest('tenant-a.do', 'Page', 'secret', 'md'),
      env,
      ctx,
      {
        reader: mockReader,
        cache: mockCache,
        authenticatedNs: 'tenant-a.do',
      }
    )
    expect(tenantAResult.status).toBe(200)
    expect(tenantAResult.body).toBe("# Tenant A's Secret")

    // Tenant A requesting Tenant B's artifact - should fail
    const crossTenantResult = await handleServe(
      createServeRequest('tenant-b.do', 'Page', 'secret', 'md'),
      env,
      ctx,
      {
        reader: mockReader,
        cache: mockCache,
        authenticatedNs: 'tenant-a.do',
      }
    )
    expect(crossTenantResult.status).toBe(403)
  })

  it('public artifacts are accessible across tenants', async () => {
    const env = createMockEnv()
    const ctx = createMockContext()

    // Tenant A's public artifact
    mockReader.addRecord({
      ns: 'tenant-a.do',
      type: 'Page',
      id: 'public-page',
      markdown: "# Tenant A's Public Page",
      visibility: 'public',
    })

    // Tenant B requesting Tenant A's public artifact - should succeed
    const result = await handleServe(
      createServeRequest('tenant-a.do', 'Page', 'public-page', 'md'),
      env,
      ctx,
      {
        reader: mockReader,
        cache: mockCache,
        authenticatedNs: 'tenant-b.do',
      }
    )

    expect(result.status).toBe(200)
    expect(result.body).toBe("# Tenant A's Public Page")
  })

  it('unauthenticated requests can only access public artifacts', async () => {
    const env = createMockEnv()
    const ctx = createMockContext()

    // Public artifact
    mockReader.addRecord({
      ns: 'app.do',
      type: 'Page',
      id: 'public',
      markdown: '# Public',
      visibility: 'public',
    })

    // Private artifact
    mockReader.addRecord({
      ns: 'app.do',
      type: 'Page',
      id: 'private',
      markdown: '# Private',
      visibility: 'private',
    })

    // Unauthenticated request to public - should succeed
    const publicResult = await handleServe(
      createServeRequest('app.do', 'Page', 'public', 'md'),
      env,
      ctx,
      {
        reader: mockReader,
        cache: mockCache,
        // No authenticatedNs - unauthenticated
      }
    )
    expect(publicResult.status).toBe(200)

    // Unauthenticated request to private - should fail
    const privateResult = await handleServe(
      createServeRequest('app.do', 'Page', 'private', 'md'),
      env,
      ctx,
      {
        reader: mockReader,
        cache: mockCache,
        // No authenticatedNs - unauthenticated
      }
    )
    expect(privateResult.status).toBe(401)
  })

  it('ingest validates namespace matches authenticated tenant', async () => {
    const env = createMockEnv()
    const ctx = createMockContext()

    const mockFetch = vi.fn(async () => new Response('OK'))
    vi.stubGlobal('fetch', mockFetch)

    // Tenant A trying to write to Tenant B's namespace
    const artifact: ArtifactRecord = {
      ns: 'tenant-b.do', // Wrong namespace!
      type: 'Page',
      id: 'injected',
      markdown: '# Injected Content',
    }

    const request = createIngestRequest(createJsonlBody([artifact]), {
      auth: 'tenant-a-token',
    })

    // Should reject the request
    await expect(
      handleIngest(request, env, ctx, { authenticatedNs: 'tenant-a.do' })
    ).rejects.toThrow(/namespace.*mismatch|unauthorized/i)

    // Should not have sent to pipeline
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

// ============================================================================
// Large File Chunking Tests
// ============================================================================

describe('Artifact Integration - Large File Chunking', () => {
  let mockPipeline: ReturnType<typeof createMockPipeline>
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockPipeline = createMockPipeline()
    mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

      if (url.includes('pipeline.example.com.ai')) {
        const request = new Request(url, init)
        return mockPipeline.handler(request)
      }

      return new Response('Not Found', { status: 404 })
    })
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    mockPipeline.clear()
  })

  it('splits >1MB payload into multiple chunks', async () => {
    const env = createMockEnv()
    const ctx = createMockContext()

    // Create a large payload (~2MB)
    const largeContent = 'x'.repeat(500 * 1024) // 500KB of content per artifact
    const artifacts: ArtifactRecord[] = Array.from({ length: 5 }, (_, i) => ({
      ns: 'app.do',
      type: 'Page',
      id: `large-${i}`,
      markdown: largeContent,
    }))

    const body = createJsonlBody(artifacts)
    expect(body.length).toBeGreaterThan(2 * 1024 * 1024) // Verify >2MB

    const request = createIngestRequest(body)
    const result = await handleIngest(request, env, ctx)

    // Should have chunked into multiple batches
    expect(result.chunks).toBeGreaterThan(1)
    expect(mockPipeline.batches.length).toBeGreaterThan(1)

    // Each batch should be <= 1MB
    for (const batch of mockPipeline.batches) {
      const batchSize = JSON.stringify(batch.records).length
      expect(batchSize).toBeLessThanOrEqual(1024 * 1024)
    }

    // All artifacts should be accounted for
    const totalArtifacts = mockPipeline.batches.reduce((sum, batch) => sum + batch.records.length, 0)
    expect(totalArtifacts).toBe(5)
  })

  it('respects chunk size limit of 1MB', async () => {
    const env = createMockEnv()
    const ctx = createMockContext()

    // Create exactly 1MB+ payload in single artifact
    const hugeContent = 'y'.repeat(1.5 * 1024 * 1024) // 1.5MB single artifact
    const artifact: ArtifactRecord = {
      ns: 'app.do',
      type: 'Page',
      id: 'huge',
      markdown: hugeContent,
    }

    const body = createJsonlBody([artifact])
    const request = createIngestRequest(body)
    const result = await handleIngest(request, env, ctx)

    // Single large artifact should still be sent (can't split further)
    expect(result.accepted).toBe(1)
    expect(mockPipeline.batches.length).toBe(1)
  })

  it('returns correct total accepted count across chunks', async () => {
    const env = createMockEnv()
    const ctx = createMockContext()

    // Create many small artifacts
    const artifacts: ArtifactRecord[] = Array.from({ length: 100 }, (_, i) => ({
      ns: 'app.do',
      type: 'Page',
      id: `item-${i}`,
      markdown: `# Item ${i}\n\n${'Content '.repeat(1000)}`, // ~8KB each
    }))

    const body = createJsonlBody(artifacts)
    const request = createIngestRequest(body)
    const result = await handleIngest(request, env, ctx)

    expect(result.accepted).toBe(100)
  })

  it('handles chunking with mixed artifact sizes', async () => {
    const env = createMockEnv()
    const ctx = createMockContext()

    // Mix of small and large artifacts
    const artifacts: ArtifactRecord[] = [
      { ns: 'app.do', type: 'Page', id: 'small-1', markdown: '# Small 1' },
      { ns: 'app.do', type: 'Page', id: 'large-1', markdown: 'x'.repeat(400 * 1024) }, // 400KB
      { ns: 'app.do', type: 'Page', id: 'small-2', markdown: '# Small 2' },
      { ns: 'app.do', type: 'Page', id: 'large-2', markdown: 'y'.repeat(400 * 1024) }, // 400KB
      { ns: 'app.do', type: 'Page', id: 'small-3', markdown: '# Small 3' },
      { ns: 'app.do', type: 'Page', id: 'large-3', markdown: 'z'.repeat(400 * 1024) }, // 400KB
    ]

    const body = createJsonlBody(artifacts)
    const request = createIngestRequest(body)
    const result = await handleIngest(request, env, ctx)

    expect(result.accepted).toBe(6)
    // Should have chunked due to size
    expect(result.chunks).toBeGreaterThanOrEqual(1)
  })
})

// ============================================================================
// Concurrent Request Tests
// ============================================================================

describe('Artifact Integration - Concurrent Requests', () => {
  let mockPipeline: ReturnType<typeof createMockPipeline>
  let mockCache: ReturnType<typeof createMockCache>
  let mockReader: ReturnType<typeof createMockIcebergReader>
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockPipeline = createMockPipeline()
    mockCache = createMockCache()
    mockReader = createMockIcebergReader()

    mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

      if (url.includes('pipeline.example.com.ai')) {
        const request = new Request(url, init)
        return mockPipeline.handler(request)
      }

      return new Response('Not Found', { status: 404 })
    })

    vi.stubGlobal('fetch', mockFetch)
    vi.stubGlobal('caches', { default: mockCache })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    mockPipeline.clear()
    mockCache.clear()
    mockReader.clear()
  })

  it('multiple POSTs do not interfere with each other', async () => {
    const env = createMockEnv()

    // Create different artifacts for each request
    const requests = Array.from({ length: 10 }, (_, i) => {
      const artifact: ArtifactRecord = {
        ns: 'app.do',
        type: 'Page',
        id: `concurrent-${i}`,
        markdown: `# Page ${i}`,
      }
      return {
        request: createIngestRequest(createJsonlBody([artifact])),
        ctx: createMockContext(),
        expectedId: `concurrent-${i}`,
      }
    })

    // Execute all requests concurrently
    const results = await Promise.all(
      requests.map(({ request, ctx }) => handleIngest(request, env, ctx))
    )

    // All should succeed
    expect(results.every((r) => r.accepted === 1)).toBe(true)

    // All artifacts should be in pipeline batches
    const allIds = mockPipeline.batches.flatMap((b) => b.records.map((r) => r.id))
    for (let i = 0; i < 10; i++) {
      expect(allIds).toContain(`concurrent-${i}`)
    }
  })

  it('concurrent GETs for same artifact share cache correctly', async () => {
    const env = createMockEnv()

    const artifact: ArtifactRecord = {
      ns: 'app.do',
      type: 'Page',
      id: 'shared',
      markdown: '# Shared Content',
    }
    mockReader.addRecord(artifact)

    // Create 10 concurrent requests for the same artifact
    const requests = Array.from({ length: 10 }, () => ({
      request: createServeRequest('app.do', 'Page', 'shared', 'md'),
      ctx: createMockContext(),
    }))

    // Execute all requests concurrently
    const results = await Promise.all(
      requests.map(({ request, ctx }) =>
        handleServe(request, env, ctx, { reader: mockReader, cache: mockCache })
      )
    )

    // All should succeed with same content
    expect(results.every((r) => r.status === 200)).toBe(true)
    expect(results.every((r) => r.body === '# Shared Content')).toBe(true)

    // Reader should have been called at most once (rest served from cache)
    expect(mockReader.getRecord.mock.calls.length).toBeLessThanOrEqual(1)
  })

  it('concurrent writes to different artifacts are isolated', async () => {
    const env = createMockEnv()

    // Simulate slight delays to interleave requests
    mockPipeline.setLatency(10)

    // Two sets of artifacts being written concurrently
    const batch1 = Array.from({ length: 5 }, (_, i) => ({
      ns: 'tenant-1.do',
      type: 'Page',
      id: `page-${i}`,
      markdown: `# Tenant 1 - Page ${i}`,
    }))

    const batch2 = Array.from({ length: 5 }, (_, i) => ({
      ns: 'tenant-2.do',
      type: 'Page',
      id: `page-${i}`,
      markdown: `# Tenant 2 - Page ${i}`,
    }))

    const [result1, result2] = await Promise.all([
      handleIngest(createIngestRequest(createJsonlBody(batch1)), env, createMockContext()),
      handleIngest(createIngestRequest(createJsonlBody(batch2)), env, createMockContext()),
    ])

    expect(result1.accepted).toBe(5)
    expect(result2.accepted).toBe(5)

    // Verify no cross-contamination
    const tenant1Records = mockPipeline.batches.flatMap((b) =>
      b.records.filter((r) => r.ns === 'tenant-1.do')
    )
    const tenant2Records = mockPipeline.batches.flatMap((b) =>
      b.records.filter((r) => r.ns === 'tenant-2.do')
    )

    expect(tenant1Records.length).toBe(5)
    expect(tenant2Records.length).toBe(5)
    expect(tenant1Records.every((r) => r.markdown?.includes('Tenant 1'))).toBe(true)
    expect(tenant2Records.every((r) => r.markdown?.includes('Tenant 2'))).toBe(true)
  })

  it('handles race condition on cache update', async () => {
    const env = createMockEnv()

    // Two concurrent requests that both result in cache miss
    // then try to update cache at the same time
    const artifact: ArtifactRecord = {
      ns: 'app.do',
      type: 'Page',
      id: 'race-condition',
      markdown: '# Race Condition Test',
    }
    mockReader.addRecord(artifact)

    // Clear any existing cache
    mockCache.clear()

    // Execute two requests at exactly the same time
    const [result1, result2] = await Promise.all([
      handleServe(
        createServeRequest('app.do', 'Page', 'race-condition', 'md'),
        env,
        createMockContext(),
        { reader: mockReader, cache: mockCache }
      ),
      handleServe(
        createServeRequest('app.do', 'Page', 'race-condition', 'md'),
        env,
        createMockContext(),
        { reader: mockReader, cache: mockCache }
      ),
    ])

    // Both should succeed with correct content
    expect(result1.status).toBe(200)
    expect(result2.status).toBe(200)
    expect(result1.body).toBe('# Race Condition Test')
    expect(result2.body).toBe('# Race Condition Test')
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Artifact Integration - Error Handling', () => {
  let mockPipeline: ReturnType<typeof createMockPipeline>
  let mockCache: ReturnType<typeof createMockCache>
  let mockReader: ReturnType<typeof createMockIcebergReader>
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockPipeline = createMockPipeline()
    mockCache = createMockCache()
    mockReader = createMockIcebergReader()

    mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

      if (url.includes('pipeline.example.com.ai')) {
        const request = new Request(url, init)
        return mockPipeline.handler(request)
      }

      return new Response('Not Found', { status: 404 })
    })

    vi.stubGlobal('fetch', mockFetch)
    vi.stubGlobal('caches', { default: mockCache })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    mockPipeline.clear()
    mockCache.clear()
    mockReader.clear()
  })

  it('handles Pipeline failure gracefully', async () => {
    const env = createMockEnv()
    const ctx = createMockContext()

    mockPipeline.setFailure(true)

    const artifact: ArtifactRecord = {
      ns: 'app.do',
      type: 'Page',
      id: 'fail-test',
      markdown: '# Fail Test',
    }

    const request = createIngestRequest(createJsonlBody([artifact]))

    await expect(handleIngest(request, env, ctx)).rejects.toThrow(/pipeline.*failed|error/i)
  })

  it('handles malformed JSONL gracefully', async () => {
    const env = createMockEnv()
    const ctx = createMockContext()

    const malformedBody = '{"ns":"app.do"}\n{malformed json\n{"type":"Page"}'
    const request = createIngestRequest(malformedBody)

    await expect(handleIngest(request, env, ctx)).rejects.toThrow(/invalid.*json|parse.*error/i)
  })

  it('handles missing required fields in artifacts', async () => {
    const env = createMockEnv()
    const ctx = createMockContext()

    const invalidArtifact = {
      // Missing ns, type, id
      markdown: '# Invalid',
    }

    const request = createIngestRequest(JSON.stringify(invalidArtifact))

    await expect(handleIngest(request, env, ctx)).rejects.toThrow(/missing.*required|ns.*type.*id/i)
  })

  it('handles IcebergReader failure gracefully', async () => {
    const env = createMockEnv()
    const ctx = createMockContext()

    // Make reader throw error
    mockReader.getRecord.mockRejectedValueOnce(new Error('R2 connection failed'))

    const result = await handleServe(
      createServeRequest('app.do', 'Page', 'reader-fail', 'md'),
      env,
      ctx,
      { reader: mockReader, cache: mockCache }
    )

    // Should return 500 or 503
    expect(result.status).toBeGreaterThanOrEqual(500)
  })

  it('returns proper error for invalid path format', async () => {
    const env = createMockEnv()
    const ctx = createMockContext()

    // Invalid path - missing extension
    const request = new Request('https://api.example.com.ai/$.content/app.do/Page/noext')

    const result = await handleServe(request, env, ctx, {
      reader: mockReader,
      cache: mockCache,
    })

    expect(result.status).toBe(400)
  })

  it('returns proper error for unsupported extension', async () => {
    const env = createMockEnv()
    const ctx = createMockContext()

    mockReader.addRecord({
      ns: 'app.do',
      type: 'Page',
      id: 'test',
      markdown: '# Test',
    })

    const result = await handleServe(
      createServeRequest('app.do', 'Page', 'test', 'xyz'), // Invalid extension
      env,
      ctx,
      { reader: mockReader, cache: mockCache }
    )

    expect(result.status).toBe(400)
  })
})

// ============================================================================
// Performance Tests
// ============================================================================

describe('Artifact Integration - Performance', () => {
  let mockPipeline: ReturnType<typeof createMockPipeline>
  let mockCache: ReturnType<typeof createMockCache>
  let mockReader: ReturnType<typeof createMockIcebergReader>

  beforeEach(() => {
    mockPipeline = createMockPipeline()
    mockCache = createMockCache()
    mockReader = createMockIcebergReader()

    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

      if (url.includes('pipeline.example.com.ai')) {
        const request = new Request(url, init)
        return mockPipeline.handler(request)
      }

      return new Response('Not Found', { status: 404 })
    })

    vi.stubGlobal('fetch', mockFetch)
    vi.stubGlobal('caches', { default: mockCache })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('ingest completes within 50ms for small batch', async () => {
    const env = createMockEnv()
    const ctx = createMockContext()

    const artifacts: ArtifactRecord[] = Array.from({ length: 10 }, (_, i) => ({
      ns: 'app.do',
      type: 'Page',
      id: `perf-${i}`,
      markdown: `# Page ${i}`,
    }))

    const request = createIngestRequest(createJsonlBody(artifacts))

    const start = performance.now()
    await handleIngest(request, env, ctx)
    const duration = performance.now() - start

    expect(duration).toBeLessThan(50)
  })

  it('cached serve completes within 2ms', async () => {
    const env = createMockEnv()
    const ctx = createMockContext()

    mockReader.addRecord({
      ns: 'app.do',
      type: 'Page',
      id: 'perf-cached',
      markdown: '# Cached Page',
    })

    // Warm up cache
    await handleServe(
      createServeRequest('app.do', 'Page', 'perf-cached', 'md'),
      env,
      ctx,
      { reader: mockReader, cache: mockCache }
    )

    // Measure cached response
    const start = performance.now()
    await handleServe(
      createServeRequest('app.do', 'Page', 'perf-cached', 'md'),
      env,
      ctx,
      { reader: mockReader, cache: mockCache }
    )
    const duration = performance.now() - start

    expect(duration).toBeLessThan(2)
  })

  it('handles 1000 artifact batch efficiently', async () => {
    const env = createMockEnv()
    const ctx = createMockContext()

    const artifacts: ArtifactRecord[] = Array.from({ length: 1000 }, (_, i) => ({
      ns: 'app.do',
      type: 'Page',
      id: `bulk-${i}`,
      markdown: `# Bulk Page ${i}\n\nContent for page ${i}.`,
    }))

    const request = createIngestRequest(createJsonlBody(artifacts), { mode: 'bulk' })

    const start = performance.now()
    const result = await handleIngest(request, env, ctx)
    const duration = performance.now() - start

    expect(result.accepted).toBe(1000)
    expect(duration).toBeLessThan(1000) // Should complete within 1 second
  })
})
