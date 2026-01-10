import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Artifact Memory Management and Streaming Tests (RED Phase)
 *
 * Tests for memory cleanup and streaming improvements in artifacts-serve.ts
 * and artifacts-ingest.ts. These tests verify:
 *
 * 1. inFlightRequests map cleanup (TTL-based, not growing unbounded)
 * 2. handleIngest streaming behavior (memory-efficient chunking)
 * 3. JSONL parsing consolidation (using parseJSONL generator)
 *
 * All tests in this file are expected to FAIL until the improvements
 * are implemented.
 *
 * @module snippets/tests/artifacts-memory.test
 * @see docs/plans/2026-01-10-artifact-storage-design.md
 */

// Default test timeout for slow tests
const SLOW_TEST_TIMEOUT = 30000

// ============================================================================
// Imports
// ============================================================================

import {
  handleServe,
  type IntegrationServeOptions,
  type ServeResult,
  type TenantConfig,
} from '../artifacts-serve'

import {
  handleIngest,
  chunkArtifactsStreaming,
  parseJSONL,
  type ArtifactRecord,
  type ArtifactMode,
} from '../artifacts-ingest'

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Default tenant configuration for testing.
 */
const DEFAULT_TENANT_CONFIG: TenantConfig = {
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
    maxBytesPerRequest: 10_485_760,
    maxRequestsPerMinute: 100,
  },
}

/**
 * Creates a mock Request object.
 */
function createRequest(
  path: string,
  options: { method?: string; headers?: Record<string, string> } = {}
): Request {
  const url = `https://artifacts.dotdo.dev${path}`
  return new Request(url, {
    method: options.method ?? 'GET',
    headers: new Headers(options.headers ?? {}),
  })
}

/**
 * Creates a mock ExecutionContext.
 */
function createContext(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext
}

/**
 * Creates a mock IcebergReader that can be configured to hang.
 */
function createMockIcebergReader(options: { hangForever?: boolean; delay?: number } = {}) {
  return {
    getRecord: vi.fn(async () => {
      if (options.hangForever) {
        // Return a promise that never resolves
        return new Promise<Record<string, unknown> | null>(() => {})
      }
      if (options.delay) {
        await new Promise((resolve) => setTimeout(resolve, options.delay))
      }
      return {
        ns: 'app.do',
        type: 'Page',
        id: 'test',
        markdown: '# Test',
      }
    }),
  }
}

/**
 * Creates a mock cache for integration testing.
 */
function createMockCache() {
  const store = new Map<string, Response>()
  return {
    match: vi.fn(async (key: string) => store.get(key)?.clone()),
    put: vi.fn(async (key: string, response: Response) => {
      store.set(key, response.clone())
    }),
  }
}

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
 * Creates an ingest request with JSONL body.
 */
function createIngestRequest(
  records: object[],
  options: {
    mode?: ArtifactMode
    contentType?: string
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
    method: 'POST',
    headers,
    body,
  })
}

/**
 * Creates a mock fetch for Pipeline HTTP endpoint.
 */
function createMockPipelineFetch() {
  return vi.fn(async () => {
    return new Response(JSON.stringify({ accepted: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
}

// ============================================================================
// inFlightRequests Memory Management Tests
// ============================================================================

describe('Artifact Serve - inFlightRequests Memory Management', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * Test: Stale entries should be cleaned up after TTL expires.
   *
   * PROBLEM: Currently, if a promise never settles (e.g., IcebergReader hangs),
   * the entry stays in inFlightRequests forever. There should be a TTL-based
   * cleanup mechanism (e.g., 30 seconds).
   *
   * Expected behavior:
   * - Request starts, entry added to inFlightRequests
   * - Request hangs (promise never resolves)
   * - After TTL (30s), entry should be automatically removed
   * - New request for same resource should not be blocked by stale entry
   *
   * NOTE: This test requires exporting either:
   * 1. getInFlightRequestCount() function
   * 2. Or implementing AbortController-based timeouts
   * 3. Or a cleanStaleEntries() function for testing
   */
  it('cleans up stale entries after TTL (30s)', async () => {
    // This test documents the expected behavior for TTL-based cleanup
    // Currently the implementation does NOT have TTL cleanup
    //
    // Expected implementation would:
    // - Store { promise, timestamp } in inFlightRequests
    // - On each access, purge entries older than TTL
    // - Or use AbortController with timeout to auto-reject

    // To make this test meaningful when implemented, we would need:
    // 1. A way to query inFlightRequests size
    // 2. Real time delays (not fake timers) to test actual cleanup

    expect.fail('Test expects TTL-based cleanup which is not implemented - need to export getInFlightRequestCount()')
  })

  /**
   * Test: inFlightRequests map should not grow unbounded under high load.
   *
   * PROBLEM: Without TTL cleanup, if many requests hang or are slow,
   * the map can grow indefinitely, causing memory leaks.
   *
   * Expected behavior:
   * - Under high load with slow requests, map size stays bounded
   * - Cleanup happens either via TTL or lazy cleanup on access
   *
   * NOTE: Requires exporting map size or implementing bounds
   */
  it('does not grow unbounded under high load', async () => {
    // This test documents the expected behavior for bounded map size
    // Currently the implementation has NO bounds on inFlightRequests size
    //
    // Expected implementation would:
    // - Have a max size limit (e.g., 10000 entries)
    // - Use LRU eviction when limit reached
    // - Or TTL-based cleanup to prevent growth

    expect.fail('Test expects bounded map size which is not implemented - need max size limit or LRU eviction')
  })

  /**
   * Test: Stale entries should be cleaned up lazily on new request access.
   *
   * PROBLEM: Even if TTL cleanup isn't continuous, accessing the map
   * with a new request should trigger cleanup of expired entries.
   *
   * Expected behavior:
   * - Old request starts, entry added with timestamp
   * - Request hangs
   * - Time passes beyond TTL
   * - New request arrives
   * - Before processing new request, stale entries should be purged
   */
  it('cleans up on access (lazy cleanup)', async () => {
    // This test documents expected lazy cleanup behavior
    // Currently the implementation has NO lazy cleanup
    //
    // Expected implementation would:
    // - Store creation timestamp with each entry
    // - On map access, iterate and purge expired entries
    // - Or use WeakRef/FinalizationRegistry for GC-based cleanup

    expect.fail('Test expects lazy cleanup which is not implemented - need timestamp tracking and purge logic')
  })

  /**
   * Test: Entries are properly removed when request completes normally.
   *
   * This verifies the existing cleanup works correctly.
   * This test should PASS with current implementation.
   *
   * NOTE: This test uses cache.match to return cached result on second call,
   * so the reader won't be called twice. The inFlightRequests cleanup works
   * correctly - it's just that the cache short-circuits the second reader call.
   */
  it('removes entries when request completes normally', async () => {
    const reader = {
      getRecord: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
        return {
          ns: 'app.do',
          type: 'Page',
          id: 'test',
          markdown: '# Test',
        }
      }),
    }

    // Use a cache that doesn't store (so second request goes to reader)
    const noopCache = {
      match: vi.fn(async () => undefined),
      put: vi.fn(async () => {}),
    }

    const options: IntegrationServeOptions = {
      reader: reader as never,
      cache: noopCache,
      tenantConfig: DEFAULT_TENANT_CONFIG,
    }

    const ctx = createContext()
    const env = {}

    // First request
    const request1 = createRequest('/$.content/app.do/Page/test.md')
    const result1 = await handleServe(request1, env, ctx, options)
    expect((result1 as ServeResult).status).toBe(200)

    // Wait a moment to ensure request is fully cleaned up
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Second request - should NOT coalesce with completed request
    const request2 = createRequest('/$.content/app.do/Page/test.md')
    const result2 = await handleServe(request2, env, ctx, options)
    expect((result2 as ServeResult).status).toBe(200)

    // Verify the reader was called twice (no coalescing with completed request)
    expect(reader.getRecord).toHaveBeenCalledTimes(2)
  }, SLOW_TEST_TIMEOUT)

  /**
   * Test: Request coalescing works for concurrent requests.
   *
   * Verifies that concurrent requests for same resource share one reader call.
   * This test should PASS with current implementation.
   */
  it('coalesces concurrent requests correctly', async () => {
    const reader = {
      getRecord: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
        return {
          ns: 'app.do',
          type: 'Page',
          id: 'test',
          markdown: '# Test',
        }
      }),
    }
    const cache = createMockCache()

    const options: IntegrationServeOptions = {
      reader: reader as never,
      cache,
      tenantConfig: DEFAULT_TENANT_CONFIG,
    }

    const request1 = createRequest('/$.content/app.do/Page/test.md')
    const request2 = createRequest('/$.content/app.do/Page/test.md')
    const ctx1 = createContext()
    const ctx2 = createContext()
    const env = {}

    // Make concurrent requests
    const [result1, result2] = await Promise.all([
      handleServe(request1, env, ctx1, options),
      handleServe(request2, env, ctx2, options),
    ])

    // Both should succeed
    expect((result1 as ServeResult).status).toBe(200)
    expect((result2 as ServeResult).status).toBe(200)

    // Reader should only be called ONCE (coalescing works)
    expect(reader.getRecord).toHaveBeenCalledTimes(1)
  }, SLOW_TEST_TIMEOUT)
})

// ============================================================================
// Streaming handleIngest Tests
// ============================================================================

describe('Artifact Ingest - Streaming Memory Management', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * Test: Processing large payload should use streaming chunker.
   *
   * PROBLEM: Current handleIngest does:
   *   const artifacts: ArtifactRecord[] = []
   *   // ... push all to array
   *   const chunks = chunkArtifacts(artifacts, maxBytes)
   *
   * This buffers the entire payload before chunking.
   * Should use streaming chunker (chunkArtifactsStreaming) instead.
   *
   * Expected behavior:
   * - Peak memory usage should be O(chunkSize), not O(payloadSize)
   * - Chunks should be uploaded as they fill, not all at once at the end
   */
  it('uses streaming chunker for memory efficiency', async () => {
    const mockFetch = createMockPipelineFetch()
    vi.stubGlobal('fetch', mockFetch)

    // Create a 5MB payload (within limit, but large enough to benefit from streaming)
    const artifactSize = 50 * 1024 // 50KB per artifact
    const artifactCount = 100 // ~5MB total

    const artifacts = Array.from({ length: artifactCount }, (_, i) =>
      createArtifact({
        id: `artifact-${i}`,
        markdown: 'x'.repeat(artifactSize - 100),
      })
    )

    const uploadTimes: number[] = []

    // Replace fetch to track upload timing
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        uploadTimes.push(Date.now())
        return new Response(JSON.stringify({ accepted: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      })
    )

    const request = createIngestRequest(artifacts)
    await handleIngest(request)

    // With streaming chunker:
    // - Implementation would use chunkArtifactsStreaming
    // - Memory bounded to chunk size (~1MB)
    //
    // Without streaming (current):
    // - All artifacts buffered in array first
    // - Memory usage is O(payloadSize)

    // This test documents the expected behavior
    // Currently it will FAIL because chunkArtifacts is used, not chunkArtifactsStreaming

    expect.fail('Test expects streaming chunker (chunkArtifactsStreaming) which is not used by handleIngest')
  })

  /**
   * Test: Chunks should be uploaded as they fill, not all at once.
   *
   * PROBLEM: Current implementation waits until all records are parsed
   * and chunked before starting uploads.
   *
   * Expected behavior:
   * - First chunk uploaded while still parsing input
   * - Upload and parsing happen concurrently
   *
   * NOTE: This test uses string body instead of stream due to test env limitations
   */
  it('uploads chunks incrementally during parsing', async () => {
    const uploadedChunks: { time: number; index: number }[] = []

    const mockFetch = vi.fn(async () => {
      uploadedChunks.push({
        time: Date.now(),
        index: uploadedChunks.length,
      })
      return new Response(JSON.stringify({ accepted: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', mockFetch)

    // Create artifacts that will span multiple chunks
    const artifactCount = 15
    const artifacts = Array.from({ length: artifactCount }, (_, i) =>
      createArtifact({
        id: `artifact-${i}`,
        markdown: 'x'.repeat(100 * 1024), // ~100KB each, ~10 per 1MB chunk
      })
    )

    const request = createIngestRequest(artifacts)
    await handleIngest(request)

    // With streaming:
    // - Uploads would start as soon as first chunk fills
    // - Implementation would use async iteration over parseJSONL
    //
    // Without streaming (current):
    // - All parsing completes first, then all chunking, then all uploads

    // This test documents the expected incremental upload behavior
    expect.fail('Test expects incremental upload during parsing which is not implemented')
  })

  /**
   * Test: Memory usage should stay bounded regardless of payload size.
   *
   * PROBLEM: Current implementation's memory usage is O(payloadSize).
   * Should be O(chunkSize) with streaming.
   *
   * This test documents the expected behavior but cannot directly measure
   * memory in the test environment.
   */
  it('memory usage bounded to chunk size not payload size', async () => {
    // This test documents the expected memory behavior
    //
    // Current implementation:
    // - Buffers all artifacts in array: O(payloadSize) memory
    // - Then chunks the array: additional O(payloadSize) memory
    //
    // Expected with streaming:
    // - Only current chunk buffered: O(chunkSize) memory
    // - Uploads happen as chunks fill: constant memory

    // To verify this in a real implementation:
    // 1. Use process.memoryUsage() in Node.js
    // 2. Compare memory across different payload sizes
    // 3. Memory should stay constant (within buffer variance)

    expect.fail('Test expects bounded memory O(chunkSize) which is not implemented - current is O(payloadSize)')
  })
})

// ============================================================================
// JSONL Parsing Consolidation Tests
// ============================================================================

describe('Artifact Ingest - JSONL Parsing Consolidation', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * Test: handleIngest should use the parseJSONL generator internally.
   *
   * PROBLEM: handleIngest has inline parsing logic that duplicates parseJSONL:
   *   const reader = request.body.getReader()
   *   const decoder = new TextDecoder()
   *   let buffer = ''
   *   // ... inline parsing
   *
   * This duplicates the parseJSONL generator and is harder to maintain.
   *
   * Expected behavior:
   * - handleIngest delegates to parseJSONL for parsing
   * - Single source of truth for JSONL parsing logic
   */
  it('handleIngest uses parseJSONL generator', async () => {
    const mockFetch = createMockPipelineFetch()
    vi.stubGlobal('fetch', mockFetch)

    // Spy on parseJSONL to verify it's being called
    // NOTE: This requires parseJSONL to be called directly by handleIngest
    // Currently handleIngest has inline parsing, so this will FAIL

    const artifacts = [
      createArtifact({ id: 'one' }),
      createArtifact({ id: 'two' }),
      createArtifact({ id: 'three' }),
    ]
    const request = createIngestRequest(artifacts)

    await handleIngest(request, {})

    // This test expects handleIngest to use parseJSONL
    // Currently it duplicates the logic inline, so test will FAIL

    expect.fail('Test expects parseJSONL usage which is not implemented')
  })

  /**
   * Test: Validation should happen inline with parsing for correct line numbers.
   *
   * When using parseJSONL with streaming validation, errors should include
   * the correct line number where the error occurred.
   */
  it('validation happens inline with parsing', async () => {
    const mockFetch = createMockPipelineFetch()
    vi.stubGlobal('fetch', mockFetch)

    // Create payload with invalid record in the middle
    const artifacts = [
      createArtifact({ id: 'valid-1' }),
      createArtifact({ id: 'valid-2' }),
      createArtifact({ id: 'valid-3' }),
      { type: 'Page', id: 'invalid' }, // Line 4 - missing ns
      createArtifact({ id: 'valid-5' }),
    ]
    const request = createIngestRequest(artifacts)

    const response = await handleIngest(request)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.line).toBe(4)

    // Verify that records before the error were validated
    // (streaming validation processes records as they come)
    // Currently this works, but with consolidated parsing it should still work
  })

  /**
   * Test: No duplicate parsing code should exist outside parseJSONL.
   *
   * PROBLEM: Currently artifacts-ingest.ts has both:
   * 1. parseJSONL generator function
   * 2. Inline parsing logic in handleIngest
   *
   * Expected behavior:
   * - Only parseJSONL contains TextDecoder/split logic
   * - handleIngest uses parseJSONL, not inline parsing
   */
  it('no duplicate parsing code exists', async () => {
    // This is a code structure test
    // We would read the source file and verify no inline parsing exists

    // For this test to pass, handleIngest should:
    // 1. Call parseJSONL(request.body)
    // 2. NOT have its own TextDecoder, buffer, newline splitting logic

    // Currently this will FAIL because handleIngest has duplicate parsing

    // NOTE: This could be verified by:
    // 1. Reading the source file and searching for patterns
    // 2. Using a spy on parseJSONL
    // 3. Code review checklist

    expect.fail('Test expects no duplicate parsing which is not implemented')
  })

  /**
   * Test: parseJSONL generator yields records with correct structure.
   *
   * Regression test to ensure parseJSONL works correctly when used
   * by handleIngest.
   */
  it('parseJSONL yields correctly structured records', async () => {
    const artifacts = [
      createArtifact({ id: 'one', markdown: '# One' }),
      createArtifact({ id: 'two', markdown: '# Two' }),
    ]

    const jsonl = toJSONL(artifacts)
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(jsonl))
        controller.close()
      },
    })

    const results: ArtifactRecord[] = []
    for await (const record of parseJSONL(stream)) {
      results.push(record)
    }

    expect(results).toHaveLength(2)
    expect(results[0].id).toBe('one')
    expect(results[0].markdown).toBe('# One')
    expect(results[1].id).toBe('two')
    expect(results[1].markdown).toBe('# Two')
  })
})

// ============================================================================
// Combined Streaming Tests
// ============================================================================

describe('Artifact Ingest - Combined Streaming Flow', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * Test: Full streaming pipeline from parse to upload.
   *
   * Expected flow:
   * 1. parseJSONL yields records as they arrive
   * 2. Records are validated inline
   * 3. chunkArtifactsStreaming buffers to chunk size
   * 4. Chunks are uploaded as they fill
   * 5. Memory usage stays bounded at O(chunkSize)
   */
  it('streams from parse through upload', async () => {
    // This test documents the expected full streaming behavior
    //
    // Expected implementation:
    // 1. handleIngest calls parseJSONL(request.body) to get async iterator
    // 2. Pipes through validation (inline with parsing)
    // 3. Uses chunkArtifactsStreaming to buffer chunks
    // 4. Uploads each chunk as it fills (async iteration)
    // 5. Memory never exceeds O(chunkSize)
    //
    // Current implementation:
    // 1. Inline parsing (duplicates parseJSONL logic)
    // 2. Buffers all artifacts in array
    // 3. Uses chunkArtifacts (not streaming)
    // 4. Uploads all chunks at end
    // 5. Memory is O(payloadSize)

    expect.fail('Test expects full streaming pipeline which is not implemented')
  })

  /**
   * Test: Streaming chunker is used instead of array-based chunker.
   *
   * Verifies that chunkArtifactsStreaming is used (O(chunkSize) memory)
   * instead of chunkArtifacts (O(payloadSize) memory).
   */
  it('uses streaming chunker not array chunker', async () => {
    const mockFetch = createMockPipelineFetch()
    vi.stubGlobal('fetch', mockFetch)

    // Create a moderately sized payload (~5MB)
    const artifacts = Array.from({ length: 100 }, (_, i) =>
      createArtifact({
        id: `artifact-${i}`,
        markdown: 'x'.repeat(50 * 1024),
      })
    )

    const request = createIngestRequest(artifacts)
    await handleIngest(request)

    // To verify streaming chunker is used:
    // 1. Could spy on chunkArtifactsStreaming
    // 2. Or check that uploads happen during parsing
    // 3. Or verify memory usage is bounded
    //
    // Currently handleIngest uses chunkArtifacts (line 1061 in artifacts-ingest.ts)
    // not chunkArtifactsStreaming

    expect.fail('Test expects chunkArtifactsStreaming usage - currently uses chunkArtifacts')
  })
})

// ============================================================================
// Regression Tests
// ============================================================================

describe('Artifact Memory Management - Regression Tests', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  /**
   * Test: Normal ingest flow still works after memory improvements.
   *
   * Ensures that implementing streaming doesn't break basic functionality.
   * This test should PASS with both current and streaming implementation.
   */
  it('basic ingest still works after streaming changes', async () => {
    const mockFetch = createMockPipelineFetch()
    vi.stubGlobal('fetch', mockFetch)

    const artifacts = [
      createArtifact({ id: 'one' }),
      createArtifact({ id: 'two' }),
      createArtifact({ id: 'three' }),
    ]
    const request = createIngestRequest(artifacts)

    // Call without env to get Response mode
    const response = await handleIngest(request) as Response

    expect(response.status).toBe(200)

    const body = await response.json()
    expect(body.accepted).toBe(3)
    expect(body.pipeline).toBe('build')
  })

  /**
   * Test: Error handling still works with streaming.
   * This test should PASS with both current and streaming implementation.
   */
  it('error handling works with streaming', async () => {
    const mockFetch = createMockPipelineFetch()
    vi.stubGlobal('fetch', mockFetch)

    // Invalid record
    const artifacts = [{ type: 'Page', id: 'missing-ns' }]
    const request = createIngestRequest(artifacts)

    const response = await handleIngest(request) as Response

    expect(response.status).toBe(400)

    const body = await response.json()
    expect(body.error).toMatch(/ns.*required/i)
    expect(body.line).toBe(1)
  })

  /**
   * Test: Request coalescing still works after cleanup improvements.
   * This test should PASS - verifies existing functionality.
   */
  it('request coalescing still works after cleanup changes', async () => {
    const reader = {
      getRecord: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
        return {
          ns: 'app.do',
          type: 'Page',
          id: 'test',
          markdown: '# Test',
        }
      }),
    }
    const cache = createMockCache()

    const options: IntegrationServeOptions = {
      reader: reader as never,
      cache,
      tenantConfig: DEFAULT_TENANT_CONFIG,
    }

    // Make concurrent requests to same resource
    const request1 = createRequest('/$.content/app.do/Page/test.md')
    const request2 = createRequest('/$.content/app.do/Page/test.md')
    const ctx1 = createContext()
    const ctx2 = createContext()
    const env = {}

    const [result1, result2] = await Promise.all([
      handleServe(request1, env, ctx1, options),
      handleServe(request2, env, ctx2, options),
    ])

    // Both should succeed
    expect((result1 as ServeResult).status).toBe(200)
    expect((result2 as ServeResult).status).toBe(200)

    // Reader should only be called once (coalescing)
    expect(reader.getRecord).toHaveBeenCalledTimes(1)
  }, SLOW_TEST_TIMEOUT)
})
