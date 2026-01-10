import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Artifact Ingest Snippet Tests (RED Phase)
 *
 * Tests for the Cloudflare Snippet that handles artifact ingestion via JSONL.
 * The snippet parses JSONL bodies, validates the schema, chunks large payloads,
 * and routes to the appropriate Pipeline based on X-Artifact-Mode header.
 *
 * Key constraints (from design doc):
 * - Snippet size: <32KB
 * - CPU time: <5ms
 * - Chunk size: <=1MB batches for Pipeline HTTP endpoint
 * - Required fields: ns, type, id
 *
 * API:
 * - POST /$.artifacts
 * - Content-Type: application/x-ndjson
 * - X-Artifact-Mode: preview | build | bulk (default: build)
 *
 * Response format:
 * {
 *   accepted: N,        // Number of artifacts accepted
 *   chunks: M,          // Number of chunks sent to Pipeline
 *   pipeline: "build",  // Pipeline used
 *   estimatedAvailableAt?: string  // ISO timestamp
 * }
 *
 * These tests are expected to FAIL until artifacts-ingest.ts is implemented.
 *
 * @module snippets/tests/artifacts-ingest.test
 * @see docs/plans/2026-01-10-artifact-storage-design.md
 */

// ============================================================================
// Imports from the to-be-implemented artifact ingest snippet
// ============================================================================

import {
  parseJSONL,
  validateArtifact,
  chunkArtifacts,
  getPipelineEndpoint,
  handleIngest,
  type ArtifactRecord,
  type IngestResponse,
  type ArtifactMode,
} from '../artifacts-ingest'

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Creates a valid artifact record for testing.
 */
function createArtifact(overrides: Partial<ArtifactRecord> = {}): ArtifactRecord {
  return {
    ns: 'app.do',
    type: 'Page',
    id: 'home',
    markdown: '# Home\n\nWelcome to our app.',
    ...overrides,
  }
}

/**
 * Creates a JSONL string from an array of records.
 */
function toJSONL(records: object[]): string {
  return records.map((r) => JSON.stringify(r)).join('\n')
}

/**
 * Creates a ReadableStream from a string.
 */
function stringToStream(str: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(str))
      controller.close()
    },
  })
}

/**
 * Collects all items from an AsyncGenerator into an array.
 */
async function collectAsync<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const results: T[] = []
  for await (const item of gen) {
    results.push(item)
  }
  return results
}

/**
 * Creates a mock fetch for Pipeline HTTP endpoint.
 */
function createMockPipelineFetch(options: {
  shouldFail?: boolean
  failAfter?: number
  delay?: number
} = {}) {
  let callCount = 0

  return vi.fn(async (url: string, init?: RequestInit) => {
    callCount++

    if (options.delay) {
      await new Promise((resolve) => setTimeout(resolve, options.delay))
    }

    if (options.shouldFail) {
      return new Response('Pipeline Error', { status: 500 })
    }

    if (options.failAfter && callCount > options.failAfter) {
      return new Response('Pipeline Error', { status: 500 })
    }

    return new Response(JSON.stringify({ accepted: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
}

/**
 * Creates a test request with JSONL body.
 */
function createIngestRequest(
  records: object[],
  options: {
    mode?: ArtifactMode
    contentType?: string
    method?: string
  } = {}
): Request {
  const body = toJSONL(records)
  const headers: Record<string, string> = {
    'Content-Type': options.contentType ?? 'application/x-ndjson',
  }

  if (options.mode) {
    headers['X-Artifact-Mode'] = options.mode
  }

  return new Request('https://api.dotdo.dev/$.artifacts', {
    method: options.method ?? 'POST',
    headers,
    body,
  })
}

/**
 * Generates a large artifact for testing chunking.
 */
function createLargeArtifact(sizeBytes: number): ArtifactRecord {
  const contentSize = sizeBytes - 100 // Account for JSON overhead
  return {
    ns: 'app.do',
    type: 'Page',
    id: 'large',
    markdown: 'x'.repeat(contentSize),
  }
}

// ============================================================================
// JSONL Parsing Tests
// ============================================================================

describe('Artifact Ingest - JSONL Parsing', () => {
  it('parses single line JSONL', async () => {
    const artifact = createArtifact()
    const stream = stringToStream(JSON.stringify(artifact))

    const results = await collectAsync(parseJSONL(stream))

    expect(results).toHaveLength(1)
    expect(results[0]).toEqual(artifact)
  })

  it('parses multiple lines JSONL', async () => {
    const artifacts = [
      createArtifact({ id: 'home' }),
      createArtifact({ id: 'about' }),
      createArtifact({ id: 'contact' }),
    ]
    const stream = stringToStream(toJSONL(artifacts))

    const results = await collectAsync(parseJSONL(stream))

    expect(results).toHaveLength(3)
    expect(results[0].id).toBe('home')
    expect(results[1].id).toBe('about')
    expect(results[2].id).toBe('contact')
  })

  it('handles empty body', async () => {
    const stream = stringToStream('')

    const results = await collectAsync(parseJSONL(stream))

    expect(results).toHaveLength(0)
  })

  it('handles body with only whitespace', async () => {
    const stream = stringToStream('   \n\n   \n')

    const results = await collectAsync(parseJSONL(stream))

    expect(results).toHaveLength(0)
  })

  it('handles body with trailing newline', async () => {
    const artifact = createArtifact()
    const stream = stringToStream(JSON.stringify(artifact) + '\n')

    const results = await collectAsync(parseJSONL(stream))

    expect(results).toHaveLength(1)
    expect(results[0]).toEqual(artifact)
  })

  it('handles body with multiple trailing newlines', async () => {
    const artifact = createArtifact()
    const stream = stringToStream(JSON.stringify(artifact) + '\n\n\n')

    const results = await collectAsync(parseJSONL(stream))

    expect(results).toHaveLength(1)
  })

  it('handles body with blank lines between records', async () => {
    const artifacts = [createArtifact({ id: 'first' }), createArtifact({ id: 'second' })]
    const jsonl = JSON.stringify(artifacts[0]) + '\n\n\n' + JSON.stringify(artifacts[1])
    const stream = stringToStream(jsonl)

    const results = await collectAsync(parseJSONL(stream))

    expect(results).toHaveLength(2)
  })

  it('handles records split across stream chunks', async () => {
    const artifact = createArtifact()
    const json = JSON.stringify(artifact)
    const encoder = new TextEncoder()

    // Split the JSON across multiple chunks
    const chunks = [
      encoder.encode(json.slice(0, 10)),
      encoder.encode(json.slice(10, 20)),
      encoder.encode(json.slice(20)),
    ]

    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk)
        }
        controller.close()
      },
    })

    const results = await collectAsync(parseJSONL(stream))

    expect(results).toHaveLength(1)
    expect(results[0]).toEqual(artifact)
  })

  it('handles records with unicode content', async () => {
    const artifact = createArtifact({
      markdown: '# Hello World\n\nUnicode: \u4e2d\u6587 \u65e5\u672c\u8a9e \ud55c\uad6d\uc5b4',
    })
    const stream = stringToStream(JSON.stringify(artifact))

    const results = await collectAsync(parseJSONL(stream))

    expect(results).toHaveLength(1)
    expect(results[0].markdown).toContain('\u4e2d\u6587')
  })

  it('handles records with escaped newlines in content', async () => {
    const artifact = createArtifact({
      markdown: '# Title\n\nParagraph 1\n\nParagraph 2',
    })
    const stream = stringToStream(JSON.stringify(artifact))

    const results = await collectAsync(parseJSONL(stream))

    expect(results).toHaveLength(1)
    expect(results[0].markdown).toContain('\n\n')
  })

  it('yields records as they are parsed (streaming)', async () => {
    const artifacts = [
      createArtifact({ id: 'first' }),
      createArtifact({ id: 'second' }),
      createArtifact({ id: 'third' }),
    ]

    let chunksEnqueued = 0
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        for (const artifact of artifacts) {
          controller.enqueue(encoder.encode(JSON.stringify(artifact) + '\n'))
          chunksEnqueued++
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
        controller.close()
      },
    })

    const generator = parseJSONL(stream)
    const results: ArtifactRecord[] = []

    for await (const record of generator) {
      results.push(record)
      // Should receive records as they arrive, not all at once
      expect(results.length).toBeLessThanOrEqual(chunksEnqueued)
    }

    expect(results).toHaveLength(3)
  })
})

// ============================================================================
// Schema Validation Tests
// ============================================================================

describe('Artifact Ingest - Schema Validation', () => {
  it('accepts valid artifact with required fields', () => {
    const record = { ns: 'app.do', type: 'Page', id: 'home' }

    const result = validateArtifact(record)

    expect(result).toEqual(record)
  })

  it('accepts valid artifact with all fields', () => {
    const record = {
      ns: 'app.do',
      type: 'Page',
      id: 'home',
      markdown: '# Home',
      mdx: 'export default...',
      html: '<h1>Home</h1>',
      esm: 'export const...',
      dts: 'declare...',
      css: '.home { }',
      frontmatter: { title: 'Home' },
      dependencies: ['react'],
      exports: ['default'],
      hash: 'abc123',
      visibility: 'public',
    }

    const result = validateArtifact(record)

    expect(result).toEqual(record)
  })

  it('rejects record missing ns field', () => {
    const record = { type: 'Page', id: 'home' }

    expect(() => validateArtifact(record)).toThrow(/ns.*required/i)
  })

  it('rejects record missing type field', () => {
    const record = { ns: 'app.do', id: 'home' }

    expect(() => validateArtifact(record)).toThrow(/type.*required/i)
  })

  it('rejects record missing id field', () => {
    const record = { ns: 'app.do', type: 'Page' }

    expect(() => validateArtifact(record)).toThrow(/id.*required/i)
  })

  it('rejects record with empty ns', () => {
    const record = { ns: '', type: 'Page', id: 'home' }

    expect(() => validateArtifact(record)).toThrow(/ns.*empty/i)
  })

  it('rejects record with empty type', () => {
    const record = { ns: 'app.do', type: '', id: 'home' }

    expect(() => validateArtifact(record)).toThrow(/type.*empty/i)
  })

  it('rejects record with empty id', () => {
    const record = { ns: 'app.do', type: 'Page', id: '' }

    expect(() => validateArtifact(record)).toThrow(/id.*empty/i)
  })

  it('rejects record with ns as non-string', () => {
    const record = { ns: 123, type: 'Page', id: 'home' }

    expect(() => validateArtifact(record)).toThrow(/ns.*string/i)
  })

  it('rejects record with type as non-string', () => {
    const record = { ns: 'app.do', type: ['Page'], id: 'home' }

    expect(() => validateArtifact(record)).toThrow(/type.*string/i)
  })

  it('rejects record with id as non-string', () => {
    const record = { ns: 'app.do', type: 'Page', id: { value: 'home' } }

    expect(() => validateArtifact(record)).toThrow(/id.*string/i)
  })

  it('rejects null input', () => {
    expect(() => validateArtifact(null)).toThrow(/invalid|null/i)
  })

  it('rejects undefined input', () => {
    expect(() => validateArtifact(undefined)).toThrow(/invalid|undefined/i)
  })

  it('rejects non-object input', () => {
    expect(() => validateArtifact('string')).toThrow(/invalid|object/i)
    expect(() => validateArtifact(123)).toThrow(/invalid|object/i)
    expect(() => validateArtifact([])).toThrow(/invalid|object/i)
  })

  it('validates visibility field values', () => {
    const validRecord = { ns: 'app.do', type: 'Page', id: 'home', visibility: 'public' }
    expect(() => validateArtifact(validRecord)).not.toThrow()

    const privateRecord = { ns: 'app.do', type: 'Page', id: 'home', visibility: 'private' }
    expect(() => validateArtifact(privateRecord)).not.toThrow()

    const invalidVisibility = { ns: 'app.do', type: 'Page', id: 'home', visibility: 'invalid' }
    expect(() => validateArtifact(invalidVisibility)).toThrow(/visibility/i)
  })

  it('validates dependencies is array of strings', () => {
    const validDeps = { ns: 'app.do', type: 'Page', id: 'home', dependencies: ['react', 'lodash'] }
    expect(() => validateArtifact(validDeps)).not.toThrow()

    const invalidDeps = { ns: 'app.do', type: 'Page', id: 'home', dependencies: 'react' }
    expect(() => validateArtifact(invalidDeps)).toThrow(/dependencies.*array/i)

    const mixedDeps = { ns: 'app.do', type: 'Page', id: 'home', dependencies: ['react', 123] }
    expect(() => validateArtifact(mixedDeps)).toThrow(/dependencies.*string/i)
  })

  it('validates exports is array of strings', () => {
    const validExports = { ns: 'app.do', type: 'Page', id: 'home', exports: ['default', 'helper'] }
    expect(() => validateArtifact(validExports)).not.toThrow()

    const invalidExports = { ns: 'app.do', type: 'Page', id: 'home', exports: { default: true } }
    expect(() => validateArtifact(invalidExports)).toThrow(/exports.*array/i)
  })

  it('validates frontmatter is object', () => {
    const validFrontmatter = { ns: 'app.do', type: 'Page', id: 'home', frontmatter: { title: 'Home' } }
    expect(() => validateArtifact(validFrontmatter)).not.toThrow()

    const invalidFrontmatter = { ns: 'app.do', type: 'Page', id: 'home', frontmatter: 'title: Home' }
    expect(() => validateArtifact(invalidFrontmatter)).toThrow(/frontmatter.*object/i)
  })

  it('returns typed ArtifactRecord on success', () => {
    const record = { ns: 'app.do', type: 'Page', id: 'home', markdown: '# Home' }

    const result = validateArtifact(record)

    // Type assertion - should have correct shape
    expect(result.ns).toBe('app.do')
    expect(result.type).toBe('Page')
    expect(result.id).toBe('home')
    expect(result.markdown).toBe('# Home')
  })
})

// ============================================================================
// Chunking Tests
// ============================================================================

describe('Artifact Ingest - Chunking', () => {
  const ONE_MB = 1024 * 1024

  it('returns single chunk for small payloads', () => {
    const artifacts = [
      createArtifact({ id: 'one' }),
      createArtifact({ id: 'two' }),
      createArtifact({ id: 'three' }),
    ]

    const chunks = chunkArtifacts(artifacts, ONE_MB)

    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toHaveLength(3)
  })

  it('splits payloads at 1MB boundary', () => {
    // Create artifacts that together exceed 1MB
    const largeContent = 'x'.repeat(400 * 1024) // ~400KB each
    const artifacts = [
      createArtifact({ id: 'one', markdown: largeContent }),
      createArtifact({ id: 'two', markdown: largeContent }),
      createArtifact({ id: 'three', markdown: largeContent }),
    ]

    const chunks = chunkArtifacts(artifacts, ONE_MB)

    // Should split into multiple chunks
    expect(chunks.length).toBeGreaterThan(1)

    // Each chunk should be under 1MB when serialized
    for (const chunk of chunks) {
      const serialized = JSON.stringify(chunk)
      expect(serialized.length).toBeLessThanOrEqual(ONE_MB)
    }
  })

  it('handles single artifact larger than chunk size', () => {
    const hugeArtifact = createLargeArtifact(2 * ONE_MB) // 2MB artifact

    const chunks = chunkArtifacts([hugeArtifact], ONE_MB)

    // Single large artifact should be in its own chunk
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toHaveLength(1)
    expect(chunks[0][0].id).toBe('large')
  })

  it('handles empty array', () => {
    const chunks = chunkArtifacts([], ONE_MB)

    expect(chunks).toHaveLength(0)
  })

  it('handles single small artifact', () => {
    const artifacts = [createArtifact()]

    const chunks = chunkArtifacts(artifacts, ONE_MB)

    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toHaveLength(1)
  })

  it('respects custom maxBytes parameter', () => {
    const artifacts = [
      createArtifact({ id: 'one', markdown: 'x'.repeat(1000) }),
      createArtifact({ id: 'two', markdown: 'x'.repeat(1000) }),
      createArtifact({ id: 'three', markdown: 'x'.repeat(1000) }),
    ]

    // Set very low max to force splitting
    const chunks = chunkArtifacts(artifacts, 2000)

    expect(chunks.length).toBeGreaterThan(1)
  })

  it('preserves artifact order within chunks', () => {
    const artifacts = Array.from({ length: 100 }, (_, i) =>
      createArtifact({ id: `artifact-${i.toString().padStart(3, '0')}` })
    )

    const chunks = chunkArtifacts(artifacts, ONE_MB)

    // Flatten chunks and check order
    const flattened = chunks.flat()
    for (let i = 0; i < flattened.length; i++) {
      expect(flattened[i].id).toBe(`artifact-${i.toString().padStart(3, '0')}`)
    }
  })

  it('handles artifacts at exact boundary', () => {
    // Create artifacts that sum to exactly 1MB
    const targetSize = ONE_MB
    const artifactCount = 10
    const contentSize = Math.floor(targetSize / artifactCount) - 100 // Account for JSON overhead

    const artifacts = Array.from({ length: artifactCount }, (_, i) =>
      createArtifact({ id: `artifact-${i}`, markdown: 'x'.repeat(contentSize) })
    )

    const chunks = chunkArtifacts(artifacts, ONE_MB)

    // Should handle boundary case without issues
    expect(chunks.length).toBeGreaterThanOrEqual(1)
    expect(chunks.flat()).toHaveLength(artifactCount)
  })

  it('calculates chunk size using JSON serialization', () => {
    // Artifact with complex structure that affects JSON size
    const artifact = createArtifact({
      id: 'complex',
      frontmatter: {
        title: 'Test',
        tags: ['one', 'two', 'three'],
        nested: { deep: { value: 123 } },
      },
      dependencies: ['react', '@types/react', 'lodash'],
    })

    const chunks = chunkArtifacts([artifact], ONE_MB)

    expect(chunks).toHaveLength(1)
    // Verify JSON.stringify is being used for size calculation
    const expectedSize = JSON.stringify([artifact]).length
    expect(expectedSize).toBeLessThanOrEqual(ONE_MB)
  })
})

// ============================================================================
// Pipeline Routing Tests
// ============================================================================

describe('Artifact Ingest - Pipeline Routing', () => {
  it('returns preview pipeline endpoint for preview mode', () => {
    const endpoint = getPipelineEndpoint('preview')

    expect(endpoint).toContain('preview')
    expect(endpoint).toMatch(/^https?:\/\//)
  })

  it('returns build pipeline endpoint for build mode', () => {
    const endpoint = getPipelineEndpoint('build')

    expect(endpoint).toContain('build')
    expect(endpoint).toMatch(/^https?:\/\//)
  })

  it('returns bulk pipeline endpoint for bulk mode', () => {
    const endpoint = getPipelineEndpoint('bulk')

    expect(endpoint).toContain('bulk')
    expect(endpoint).toMatch(/^https?:\/\//)
  })

  it('defaults to build pipeline when mode is undefined', () => {
    const endpoint = getPipelineEndpoint(undefined as unknown as ArtifactMode)

    expect(endpoint).toContain('build')
  })

  it('throws for invalid mode', () => {
    expect(() => getPipelineEndpoint('invalid' as ArtifactMode)).toThrow(/invalid.*mode/i)
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Artifact Ingest - Error Handling', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 400 for malformed JSON', async () => {
    const mockFetch = createMockPipelineFetch()
    vi.stubGlobal('fetch', mockFetch)

    const request = new Request('https://api.dotdo.dev/$.artifacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-ndjson' },
      body: '{ invalid json }',
    })

    const response = await handleIngest(request)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toHaveProperty('error')
    expect(body.error).toMatch(/json|parse|malformed/i)
  })

  it('returns 400 for records missing required fields', async () => {
    const mockFetch = createMockPipelineFetch()
    vi.stubGlobal('fetch', mockFetch)

    const invalidRecords = [
      { type: 'Page', id: 'home' }, // Missing ns
    ]
    const request = createIngestRequest(invalidRecords)

    const response = await handleIngest(request)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toHaveProperty('error')
    expect(body.error).toMatch(/ns.*required|validation/i)
  })

  it('returns 400 with line number for invalid record', async () => {
    const mockFetch = createMockPipelineFetch()
    vi.stubGlobal('fetch', mockFetch)

    const records = [
      createArtifact({ id: 'valid-1' }),
      createArtifact({ id: 'valid-2' }),
      { type: 'Page', id: 'invalid' }, // Line 3 - missing ns
      createArtifact({ id: 'valid-4' }),
    ]
    const request = createIngestRequest(records)

    const response = await handleIngest(request)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toHaveProperty('line')
    expect(body.line).toBe(3)
  })

  it('returns 413 for oversized payload', async () => {
    const mockFetch = createMockPipelineFetch()
    vi.stubGlobal('fetch', mockFetch)

    // Create a payload larger than allowed (e.g., 10MB limit from design doc)
    const maxPayloadSize = 10 * 1024 * 1024
    const hugeContent = 'x'.repeat(maxPayloadSize + 1)

    const request = new Request('https://api.dotdo.dev/$.artifacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-ndjson' },
      body: JSON.stringify({ ns: 'app.do', type: 'Page', id: 'huge', markdown: hugeContent }),
    })

    const response = await handleIngest(request)

    expect(response.status).toBe(413)
  })

  it('returns 500 when Pipeline fails', async () => {
    const mockFetch = createMockPipelineFetch({ shouldFail: true })
    vi.stubGlobal('fetch', mockFetch)

    const records = [createArtifact()]
    const request = createIngestRequest(records)

    const response = await handleIngest(request)

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toHaveProperty('error')
    expect(body.error).toMatch(/pipeline|upstream/i)
  })

  it('returns partial success when some chunks fail', async () => {
    const mockFetch = createMockPipelineFetch({ failAfter: 1 })
    vi.stubGlobal('fetch', mockFetch)

    // Create enough artifacts to require multiple chunks
    const artifacts = Array.from({ length: 20 }, (_, i) =>
      createArtifact({
        id: `artifact-${i}`,
        markdown: 'x'.repeat(100 * 1024), // ~100KB each
      })
    )
    const request = createIngestRequest(artifacts)

    const response = await handleIngest(request)
    const body = await response.json()

    expect(response.status).toBe(207) // Partial content
    expect(body).toHaveProperty('accepted')
    expect(body).toHaveProperty('failed')
    expect(body.accepted).toBeGreaterThan(0)
    expect(body.failed).toBeGreaterThan(0)
  })

  it('handles empty body gracefully', async () => {
    const mockFetch = createMockPipelineFetch()
    vi.stubGlobal('fetch', mockFetch)

    const request = new Request('https://api.dotdo.dev/$.artifacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-ndjson' },
      body: '',
    })

    const response = await handleIngest(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.accepted).toBe(0)
    expect(body.chunks).toBe(0)
  })

  it('returns 415 for unsupported content type', async () => {
    const mockFetch = createMockPipelineFetch()
    vi.stubGlobal('fetch', mockFetch)

    const request = new Request('https://api.dotdo.dev/$.artifacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }, // Should be application/x-ndjson
      body: JSON.stringify([createArtifact()]),
    })

    const response = await handleIngest(request)

    expect(response.status).toBe(415)
  })

  it('returns 405 for non-POST methods', async () => {
    const mockFetch = createMockPipelineFetch()
    vi.stubGlobal('fetch', mockFetch)

    const getRequest = new Request('https://api.dotdo.dev/$.artifacts', {
      method: 'GET',
    })

    const response = await handleIngest(getRequest)

    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('POST')
  })

  it('handles malformed JSON on specific line', async () => {
    const mockFetch = createMockPipelineFetch()
    vi.stubGlobal('fetch', mockFetch)

    const body = `{"ns":"app.do","type":"Page","id":"one"}
{"ns":"app.do","type":"Page","id":"two"}
{invalid json here}
{"ns":"app.do","type":"Page","id":"four"}`

    const request = new Request('https://api.dotdo.dev/$.artifacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-ndjson' },
      body,
    })

    const response = await handleIngest(request)
    const responseBody = await response.json()

    expect(response.status).toBe(400)
    expect(responseBody.line).toBe(3)
  })
})

// ============================================================================
// Response Format Tests
// ============================================================================

describe('Artifact Ingest - Response Format', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns correct response structure', async () => {
    const mockFetch = createMockPipelineFetch()
    vi.stubGlobal('fetch', mockFetch)

    const records = [
      createArtifact({ id: 'one' }),
      createArtifact({ id: 'two' }),
      createArtifact({ id: 'three' }),
    ]
    const request = createIngestRequest(records)

    const response = await handleIngest(request)
    const body: IngestResponse = await response.json()

    expect(response.status).toBe(200)
    expect(body).toHaveProperty('accepted')
    expect(body).toHaveProperty('chunks')
    expect(body).toHaveProperty('pipeline')
    expect(body.accepted).toBe(3)
    expect(body.chunks).toBeGreaterThanOrEqual(1)
    expect(body.pipeline).toBe('build') // default mode
  })

  it('includes estimatedAvailableAt in response', async () => {
    const mockFetch = createMockPipelineFetch()
    vi.stubGlobal('fetch', mockFetch)

    const records = [createArtifact()]
    const request = createIngestRequest(records)

    const response = await handleIngest(request)
    const body: IngestResponse = await response.json()

    expect(body).toHaveProperty('estimatedAvailableAt')
    // Should be ISO timestamp in the future
    const estimatedTime = new Date(body.estimatedAvailableAt!).getTime()
    expect(estimatedTime).toBeGreaterThan(Date.now())
  })

  it('returns correct pipeline in response for preview mode', async () => {
    const mockFetch = createMockPipelineFetch()
    vi.stubGlobal('fetch', mockFetch)

    const records = [createArtifact()]
    const request = createIngestRequest(records, { mode: 'preview' })

    const response = await handleIngest(request)
    const body: IngestResponse = await response.json()

    expect(body.pipeline).toBe('preview')
  })

  it('returns correct pipeline in response for bulk mode', async () => {
    const mockFetch = createMockPipelineFetch()
    vi.stubGlobal('fetch', mockFetch)

    const records = [createArtifact()]
    const request = createIngestRequest(records, { mode: 'bulk' })

    const response = await handleIngest(request)
    const body: IngestResponse = await response.json()

    expect(body.pipeline).toBe('bulk')
  })

  it('returns JSON content type', async () => {
    const mockFetch = createMockPipelineFetch()
    vi.stubGlobal('fetch', mockFetch)

    const records = [createArtifact()]
    const request = createIngestRequest(records)

    const response = await handleIngest(request)

    expect(response.headers.get('Content-Type')).toBe('application/json')
  })

  it('includes chunk count in response', async () => {
    const mockFetch = createMockPipelineFetch()
    vi.stubGlobal('fetch', mockFetch)

    // Create artifacts that will be split into multiple chunks
    const artifacts = Array.from({ length: 10 }, (_, i) =>
      createArtifact({
        id: `artifact-${i}`,
        markdown: 'x'.repeat(200 * 1024), // ~200KB each
      })
    )
    const request = createIngestRequest(artifacts)

    const response = await handleIngest(request)
    const body: IngestResponse = await response.json()

    expect(body.chunks).toBeGreaterThan(1)
  })

  it('includes request ID in response headers', async () => {
    const mockFetch = createMockPipelineFetch()
    vi.stubGlobal('fetch', mockFetch)

    const records = [createArtifact()]
    const request = createIngestRequest(records)

    const response = await handleIngest(request)

    expect(response.headers.has('X-Request-Id')).toBe(true)
    expect(response.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]+$/i)
  })
})

// ============================================================================
// Integration Tests (Full Pipeline)
// ============================================================================

describe('Artifact Ingest - Integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('processes full ingest flow: parse -> validate -> chunk -> send', async () => {
    const mockFetch = createMockPipelineFetch()
    vi.stubGlobal('fetch', mockFetch)

    const records = [
      createArtifact({ id: 'home', markdown: '# Home' }),
      createArtifact({ id: 'about', markdown: '# About' }),
      createArtifact({ type: 'Component', id: 'Button', mdx: 'export...' }),
    ]
    const request = createIngestRequest(records)

    const response = await handleIngest(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.accepted).toBe(3)
    expect(mockFetch).toHaveBeenCalled()

    // Verify Pipeline was called with correct data
    const [pipelineUrl, pipelineInit] = mockFetch.mock.calls[0]
    expect(pipelineUrl).toContain('build')
    expect(pipelineInit.method).toBe('POST')
    expect(pipelineInit.headers['Content-Type']).toBe('application/json')
  })

  it('handles mixed valid and invalid records by failing fast', async () => {
    const mockFetch = createMockPipelineFetch()
    vi.stubGlobal('fetch', mockFetch)

    const records = [
      createArtifact({ id: 'valid-1' }),
      { type: 'Page', id: 'invalid' }, // Missing ns - should fail here
      createArtifact({ id: 'valid-3' }),
    ]
    const request = createIngestRequest(records)

    const response = await handleIngest(request)

    expect(response.status).toBe(400)
    // Pipeline should not have been called due to validation failure
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('sends correct payload format to Pipeline', async () => {
    const mockFetch = createMockPipelineFetch()
    vi.stubGlobal('fetch', mockFetch)

    const artifacts = [createArtifact({ id: 'test', markdown: '# Test' })]
    const request = createIngestRequest(artifacts, { mode: 'build' })

    await handleIngest(request)

    expect(mockFetch).toHaveBeenCalled()
    const [, init] = mockFetch.mock.calls[0]
    const sentBody = JSON.parse(init.body)

    // Pipeline expects array of records
    expect(Array.isArray(sentBody)).toBe(true)
    expect(sentBody[0]).toHaveProperty('ns')
    expect(sentBody[0]).toHaveProperty('type')
    expect(sentBody[0]).toHaveProperty('id')
  })

  it('adds timestamp to each record before sending', async () => {
    const mockFetch = createMockPipelineFetch()
    vi.stubGlobal('fetch', mockFetch)

    const artifacts = [createArtifact({ id: 'test' })]
    const request = createIngestRequest(artifacts)

    const beforeTime = Date.now()
    await handleIngest(request)
    const afterTime = Date.now()

    const [, init] = mockFetch.mock.calls[0]
    const sentBody = JSON.parse(init.body)

    expect(sentBody[0]).toHaveProperty('ts')
    const recordTs = new Date(sentBody[0].ts).getTime()
    expect(recordTs).toBeGreaterThanOrEqual(beforeTime)
    expect(recordTs).toBeLessThanOrEqual(afterTime)
  })

  it('handles concurrent requests independently', async () => {
    const mockFetch = createMockPipelineFetch({ delay: 50 })
    vi.stubGlobal('fetch', mockFetch)

    const requests = [
      createIngestRequest([createArtifact({ ns: 'app1.do', id: 'req1' })]),
      createIngestRequest([createArtifact({ ns: 'app2.do', id: 'req2' })]),
      createIngestRequest([createArtifact({ ns: 'app3.do', id: 'req3' })]),
    ]

    const responses = await Promise.all(requests.map((req) => handleIngest(req)))

    // All should succeed independently
    for (const response of responses) {
      expect(response.status).toBe(200)
    }
    expect(mockFetch).toHaveBeenCalledTimes(3)
  })

  it('calculates correct estimatedAvailableAt based on mode', async () => {
    const mockFetch = createMockPipelineFetch()
    vi.stubGlobal('fetch', mockFetch)

    const now = Date.now()

    // Preview mode - 5s buffer
    const previewRequest = createIngestRequest([createArtifact()], { mode: 'preview' })
    const previewResponse = await handleIngest(previewRequest)
    const previewBody = await previewResponse.json()
    const previewTime = new Date(previewBody.estimatedAvailableAt).getTime()
    expect(previewTime).toBeGreaterThanOrEqual(now + 5000 - 100) // 5s buffer, 100ms tolerance

    // Build mode - 30s buffer
    const buildRequest = createIngestRequest([createArtifact()], { mode: 'build' })
    const buildResponse = await handleIngest(buildRequest)
    const buildBody = await buildResponse.json()
    const buildTime = new Date(buildBody.estimatedAvailableAt).getTime()
    expect(buildTime).toBeGreaterThanOrEqual(now + 30000 - 100) // 30s buffer

    // Bulk mode - 120s buffer
    const bulkRequest = createIngestRequest([createArtifact()], { mode: 'bulk' })
    const bulkResponse = await handleIngest(bulkRequest)
    const bulkBody = await bulkResponse.json()
    const bulkTime = new Date(bulkBody.estimatedAvailableAt).getTime()
    expect(bulkTime).toBeGreaterThanOrEqual(now + 120000 - 100) // 120s buffer
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('Artifact Ingest - Edge Cases', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('handles extremely long ns/type/id values', async () => {
    const mockFetch = createMockPipelineFetch()
    vi.stubGlobal('fetch', mockFetch)

    const longValue = 'x'.repeat(1000)
    const records = [
      createArtifact({
        ns: longValue + '.do',
        type: longValue,
        id: longValue,
      }),
    ]
    const request = createIngestRequest(records)

    const response = await handleIngest(request)

    expect(response.status).toBe(200)
  })

  it('handles special characters in field values', async () => {
    const mockFetch = createMockPipelineFetch()
    vi.stubGlobal('fetch', mockFetch)

    const records = [
      createArtifact({
        id: 'page/with/slashes',
        markdown: 'Content with "quotes" and \\backslashes\\',
      }),
    ]
    const request = createIngestRequest(records)

    const response = await handleIngest(request)

    expect(response.status).toBe(200)
  })

  it('handles artifacts with minimal fields', async () => {
    const mockFetch = createMockPipelineFetch()
    vi.stubGlobal('fetch', mockFetch)

    const records = [{ ns: 'app.do', type: 'Page', id: 'minimal' }]
    const request = createIngestRequest(records)

    const response = await handleIngest(request)

    expect(response.status).toBe(200)
  })

  it('handles artifacts with all optional fields null', async () => {
    const mockFetch = createMockPipelineFetch()
    vi.stubGlobal('fetch', mockFetch)

    const records = [
      {
        ns: 'app.do',
        type: 'Page',
        id: 'nullfields',
        markdown: null,
        mdx: null,
        html: null,
        frontmatter: null,
      },
    ]
    const request = createIngestRequest(records)

    const response = await handleIngest(request)

    // Should handle null fields gracefully
    expect(response.status).toBe(200)
  })

  it('handles very large number of small artifacts', async () => {
    const mockFetch = createMockPipelineFetch()
    vi.stubGlobal('fetch', mockFetch)

    // 1000 small artifacts
    const records = Array.from({ length: 1000 }, (_, i) =>
      createArtifact({ id: `artifact-${i}` })
    )
    const request = createIngestRequest(records)

    const response = await handleIngest(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.accepted).toBe(1000)
  })

  it('handles X-Artifact-Mode header case insensitively', async () => {
    const mockFetch = createMockPipelineFetch()
    vi.stubGlobal('fetch', mockFetch)

    const records = [createArtifact()]
    const request = new Request('https://api.dotdo.dev/$.artifacts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-ndjson',
        'x-artifact-mode': 'PREVIEW', // lowercase header, uppercase value
      },
      body: toJSONL(records),
    })

    const response = await handleIngest(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.pipeline).toBe('preview')
  })

  it('defaults to build mode when X-Artifact-Mode header is missing', async () => {
    const mockFetch = createMockPipelineFetch()
    vi.stubGlobal('fetch', mockFetch)

    const records = [createArtifact()]
    const request = new Request('https://api.dotdo.dev/$.artifacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-ndjson' },
      body: toJSONL(records),
    })

    const response = await handleIngest(request)
    const body = await response.json()

    expect(body.pipeline).toBe('build')
  })

  it('handles empty JSONL lines gracefully', async () => {
    const mockFetch = createMockPipelineFetch()
    vi.stubGlobal('fetch', mockFetch)

    // JSONL with empty lines mixed in
    const body = `
{"ns":"app.do","type":"Page","id":"one"}

{"ns":"app.do","type":"Page","id":"two"}


{"ns":"app.do","type":"Page","id":"three"}
`
    const request = new Request('https://api.dotdo.dev/$.artifacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-ndjson' },
      body,
    })

    const response = await handleIngest(request)
    const responseBody = await response.json()

    expect(response.status).toBe(200)
    expect(responseBody.accepted).toBe(3)
  })
})

// ============================================================================
// Performance Tests
// ============================================================================

describe('Artifact Ingest - Performance', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('completes 100 artifact ingest within reasonable time', async () => {
    const mockFetch = createMockPipelineFetch()
    vi.stubGlobal('fetch', mockFetch)

    const records = Array.from({ length: 100 }, (_, i) =>
      createArtifact({ id: `artifact-${i}`, markdown: '# Test\n'.repeat(10) })
    )
    const request = createIngestRequest(records)

    const start = performance.now()
    const response = await handleIngest(request)
    const duration = performance.now() - start

    expect(response.status).toBe(200)
    // Should complete in under 100ms (excluding network)
    expect(duration).toBeLessThan(100)
  })

  it('parses JSONL stream efficiently', async () => {
    const records = Array.from({ length: 1000 }, (_, i) =>
      createArtifact({ id: `artifact-${i}` })
    )
    const stream = stringToStream(toJSONL(records))

    const start = performance.now()
    const results = await collectAsync(parseJSONL(stream))
    const duration = performance.now() - start

    expect(results).toHaveLength(1000)
    // Should parse 1000 records in under 50ms
    expect(duration).toBeLessThan(50)
  })

  it('chunks artifacts efficiently', () => {
    const artifacts = Array.from({ length: 1000 }, (_, i) =>
      createArtifact({ id: `artifact-${i}`, markdown: 'x'.repeat(1000) })
    )

    const start = performance.now()
    const chunks = chunkArtifacts(artifacts, 1024 * 1024)
    const duration = performance.now() - start

    expect(chunks.flat()).toHaveLength(1000)
    // Should chunk 1000 artifacts in under 50ms
    expect(duration).toBeLessThan(50)
  })
})
