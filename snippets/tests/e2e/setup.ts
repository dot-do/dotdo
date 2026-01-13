/**
 * E2E Test Setup Utilities
 *
 * Provides test infrastructure for end-to-end artifact storage tests.
 * Supports both Miniflare (local) and staging (remote) environments.
 *
 * ## Environment Variables
 *
 * - E2E_ENVIRONMENT: 'miniflare' | 'staging' (default: 'miniflare')
 * - E2E_R2_BUCKET: R2 bucket name for staging
 * - E2E_PIPELINE_URL: Pipeline HTTP endpoint URL
 * - E2E_API_URL: Artifact API base URL
 * - E2E_AUTH_TOKEN: Authentication token for staging
 *
 * ## Usage
 *
 * ```typescript
 * import { e2eConfig, createE2EClient, waitForPipelineFlush } from './setup'
 *
 * const client = await createE2EClient()
 * const result = await client.ingest([artifact])
 * await waitForPipelineFlush(result.estimatedAvailableAt)
 * const content = await client.serve('ns', 'type', 'id', 'md')
 * ```
 *
 * @module snippets/tests/e2e/setup
 */

import { vi } from 'vitest'
import type { IcebergReader, GetRecordOptions } from '../../artifacts-serve'

// ============================================================================
// Environment Configuration
// ============================================================================

/**
 * E2E test environment type.
 */
export type E2EEnvironment = 'miniflare' | 'staging'

/**
 * E2E configuration derived from environment variables.
 */
export interface E2EConfig {
  environment: E2EEnvironment
  r2BucketName: string
  pipelineBaseUrl: string
  apiBaseUrl: string
  authToken?: string
  /** Pipeline flush wait times by mode (ms) */
  pipelineFlushTimes: {
    preview: number
    build: number
    bulk: number
  }
}

/**
 * Get E2E configuration from environment variables.
 */
export function getE2EConfig(): E2EConfig {
  const env = process.env.E2E_ENVIRONMENT as E2EEnvironment | undefined

  return {
    environment: env ?? 'miniflare',
    r2BucketName: process.env.E2E_R2_BUCKET ?? 'artifacts-lake-test',
    pipelineBaseUrl: process.env.E2E_PIPELINE_URL ?? 'https://pipelines.dotdo.dev',
    apiBaseUrl: process.env.E2E_API_URL ?? 'https://api.dotdo.dev',
    authToken: process.env.E2E_AUTH_TOKEN,
    pipelineFlushTimes: {
      preview: 5_000,
      build: 30_000,
      bulk: 120_000,
    },
  }
}

/**
 * Singleton E2E config instance.
 */
export const e2eConfig = getE2EConfig()

// ============================================================================
// Test Artifact Types
// ============================================================================

/**
 * Artifact record for E2E testing.
 */
export interface E2EArtifact {
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

/**
 * Result from ingest operation.
 */
export interface E2EIngestResult {
  accepted: number
  chunks: number
  pipeline: 'preview' | 'build' | 'bulk'
  estimatedAvailableAt: string
  failed?: number
}

/**
 * Result from serve operation.
 */
export interface E2EServeResult {
  status: number
  body: string
  contentType: string
  headers: Record<string, string>
  source: 'cache' | 'parquet'
}

// ============================================================================
// E2E Test Client
// ============================================================================

/**
 * E2E test client for artifact storage operations.
 * Supports both miniflare and staging environments.
 */
export interface E2EClient {
  /**
   * Ingest artifacts via JSONL.
   *
   * @param artifacts - Array of artifacts to ingest
   * @param options - Ingest options (mode, auth)
   * @returns Ingest result with accepted count and estimated availability
   */
  ingest(
    artifacts: E2EArtifact[],
    options?: {
      mode?: 'preview' | 'build' | 'bulk'
      authToken?: string
    }
  ): Promise<E2EIngestResult>

  /**
   * Serve an artifact by path.
   *
   * @param ns - Namespace
   * @param type - Artifact type
   * @param id - Artifact ID
   * @param ext - File extension
   * @param options - Serve options
   * @returns Serve result with content and headers
   */
  serve(
    ns: string,
    type: string,
    id: string,
    ext: string,
    options?: {
      fresh?: boolean
      maxAge?: number
      authToken?: string
    }
  ): Promise<E2EServeResult>

  /**
   * Clean up test artifacts.
   */
  cleanup(): Promise<void>
}

// ============================================================================
// Mock Pipeline for Miniflare
// ============================================================================

/**
 * Mock pipeline that captures batches sent to it.
 */
export interface MockPipeline {
  /** All batches received */
  batches: Array<{
    records: E2EArtifact[]
    mode: 'preview' | 'build' | 'bulk'
    timestamp: string
  }>

  /** Handler for fetch requests */
  handler: (request: Request) => Promise<Response>

  /** Set whether the pipeline should fail */
  setFailure(shouldFail: boolean): void

  /** Set artificial latency */
  setLatency(ms: number): void

  /** Clear captured batches */
  clear(): void

  /**
   * Enable forwarding of records to R2 store.
   * When enabled, records sent to the pipeline are automatically
   * added to the R2 store to simulate the pipeline -> R2 flow.
   */
  enableR2Forwarding(r2Store: MockR2Store): void

  /** Disable R2 forwarding */
  disableR2Forwarding(): void
}

/**
 * Create a mock pipeline for local testing.
 */
export function createMockPipeline(): MockPipeline {
  const batches: MockPipeline['batches'] = []
  let shouldFail = false
  let latencyMs = 0
  let r2ForwardStore: MockR2Store | null = null

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
      const records = Array.isArray(body) ? body : [body]

      batches.push({
        records,
        mode: mode as 'preview' | 'build' | 'bulk',
        timestamp: new Date().toISOString(),
      })

      // Forward records to R2 store if enabled
      if (r2ForwardStore) {
        for (const record of records) {
          r2ForwardStore.addRecord(record)
        }
      }

      return new Response(JSON.stringify({ accepted: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    } catch {
      return new Response('Invalid JSON', { status: 400 })
    }
  })

  return {
    batches,
    handler,
    setFailure: (fail: boolean) => {
      shouldFail = fail
    },
    setLatency: (ms: number) => {
      latencyMs = ms
    },
    clear: () => {
      batches.length = 0
      handler.mockClear()
    },
    enableR2Forwarding: (store: MockR2Store) => {
      r2ForwardStore = store
    },
    disableR2Forwarding: () => {
      r2ForwardStore = null
    },
  }
}

// ============================================================================
// Mock R2 Store for Miniflare
// ============================================================================

/**
 * Mock R2 store that simulates Parquet storage.
 */
export interface MockR2Store {
  /** Add a record to the store */
  addRecord(artifact: E2EArtifact): void

  /** Update a record in the store */
  updateRecord(
    ns: string,
    type: string,
    id: string,
    updates: Partial<E2EArtifact>
  ): void

  /** Delete a record from the store */
  deleteRecord(ns: string, type: string, id: string): boolean

  /** Get a record from the store */
  getRecord(ns: string, type: string, id: string): E2EArtifact | null

  /** Clear all records */
  clear(): void

  /** Get all records for a namespace */
  listRecords(ns: string): E2EArtifact[]
}

/**
 * Create a mock R2 store for local testing.
 */
export function createMockR2Store(): MockR2Store {
  const records = new Map<string, E2EArtifact>()

  const getKey = (ns: string, type: string, id: string) => `${ns}/${type}/${id}`

  return {
    addRecord(artifact: E2EArtifact): void {
      const key = getKey(artifact.ns, artifact.type, artifact.id)
      records.set(key, {
        ...artifact,
        ts: artifact.ts || new Date().toISOString(),
      })
    },

    updateRecord(
      ns: string,
      type: string,
      id: string,
      updates: Partial<E2EArtifact>
    ): void {
      const key = getKey(ns, type, id)
      const existing = records.get(key)
      if (existing) {
        records.set(key, {
          ...existing,
          ...updates,
          ts: new Date().toISOString(),
        })
      }
    },

    deleteRecord(ns: string, type: string, id: string): boolean {
      const key = getKey(ns, type, id)
      return records.delete(key)
    },

    getRecord(ns: string, type: string, id: string): E2EArtifact | null {
      const key = getKey(ns, type, id)
      return records.get(key) ?? null
    },

    clear(): void {
      records.clear()
    },

    listRecords(ns: string): E2EArtifact[] {
      const result: E2EArtifact[] = []
      Array.from(records.entries()).forEach(([key, artifact]) => {
        if (key.startsWith(`${ns}/`)) {
          result.push(artifact)
        }
      })
      return result
    },
  }
}

// ============================================================================
// Mock Cache for Miniflare
// ============================================================================

/**
 * Mock Cache API for testing.
 */
export interface MockCache {
  match(request: Request | string): Promise<Response | undefined>
  put(request: Request | string, response: Response): Promise<void>
  delete(request: Request | string): Promise<boolean>
  clear(): void
  /** Set entry to be stale by backdating */
  setStale(url: string, staleSeconds: number): void
  /** Get all cache keys */
  keys(): string[]
}

/**
 * Create a mock Cache API.
 */
export function createMockCache(): MockCache {
  const store = new Map<
    string,
    {
      response: Response
      timestamp: number
      maxAge: number
      swrWindow: number
    }
  >()

  const getUrl = (request: Request | string) =>
    typeof request === 'string' ? request : request.url

  return {
    async match(request: Request | string): Promise<Response | undefined> {
      const url = getUrl(request)
      const entry = store.get(url)

      if (!entry) {
        return undefined
      }

      const age = (Date.now() - entry.timestamp) / 1000

      // Check if fully expired (past SWR window)
      if (age > entry.maxAge + entry.swrWindow) {
        return undefined
      }

      const response = entry.response.clone()
      const headers = new Headers(response.headers)
      headers.set('X-Cache-Age', String(Math.floor(age)))

      if (age > entry.maxAge) {
        headers.set('X-Cache-Stale', 'true')
      }

      return new Response(response.body, {
        status: response.status,
        headers,
      })
    },

    async put(request: Request | string, response: Response): Promise<void> {
      const url = getUrl(request)
      const cacheControl = response.headers.get('Cache-Control') || ''
      const maxAgeMatch = cacheControl.match(/max-age=(\d+)/)
      const swrMatch = cacheControl.match(/stale-while-revalidate=(\d+)/)

      store.set(url, {
        response: response.clone(),
        timestamp: Date.now(),
        maxAge: maxAgeMatch ? parseInt(maxAgeMatch[1]) : 300,
        swrWindow: swrMatch ? parseInt(swrMatch[1]) : 0,
      })
    },

    async delete(request: Request | string): Promise<boolean> {
      const url = getUrl(request)
      return store.delete(url)
    },

    clear(): void {
      store.clear()
    },

    setStale(url: string, staleSeconds: number): void {
      const entry = store.get(url)
      if (entry) {
        entry.timestamp =
          Date.now() - entry.maxAge * 1000 - staleSeconds * 1000
      }
    },

    keys(): string[] {
      return Array.from(store.keys())
    },
  }
}

// ============================================================================
// Mock IcebergReader for Miniflare
// ============================================================================

/**
 * Create a mock IcebergReader backed by MockR2Store.
 */
export function createMockIcebergReader(r2Store: MockR2Store): IcebergReader {
  return {
    getRecord: vi.fn(
      async (options: GetRecordOptions): Promise<Record<string, unknown> | null> => {
        const { ns, type } = options.partition as { ns: string; type: string; visibility?: string }
        const artifact = r2Store.getRecord(ns, type, options.id)

        if (!artifact) {
          return null
        }

        // Visibility filtering
        const { visibility } = options.partition as { ns: string; type: string; visibility?: string }
        if (visibility && artifact.visibility !== visibility) {
          // For 'public' visibility filter, allow 'public' or undefined artifacts
          if (visibility === 'public') {
            if (
              artifact.visibility !== 'public' &&
              artifact.visibility !== undefined
            ) {
              return null
            }
          } else {
            return null
          }
        }

        // Column projection
        if (options.columns && options.columns.length > 0) {
          const filtered: Record<string, unknown> = {
            ns: artifact.ns,
            type: artifact.type,
            id: artifact.id,
          }
          for (const col of options.columns) {
            if (col in artifact) {
              filtered[col] = (artifact as Record<string, unknown>)[col]
            }
          }
          return filtered
        }

        return artifact as unknown as Record<string, unknown>
      }
    ),
  }
}

// ============================================================================
// Miniflare E2E Client
// ============================================================================

/**
 * ExecutionContext type for Workers
 */
interface MockExecutionContext {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException(): void
}

/**
 * Create a Miniflare-based E2E client for local testing.
 */
export function createMiniflareClient(): E2EClient & {
  pipeline: MockPipeline
  r2Store: MockR2Store
  cache: MockCache
  reader: IcebergReader
} {
  const pipeline = createMockPipeline()
  const r2Store = createMockR2Store()
  const cache = createMockCache()
  const reader = createMockIcebergReader(r2Store)

  // Stub global fetch to intercept pipeline calls
  const originalFetch = globalThis.fetch
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

    if (url.includes('pipelines.dotdo.dev') || url.includes('pipeline')) {
      const request = new Request(url, init)
      return pipeline.handler(request)
    }

    // Pass through to original fetch for other requests
    return originalFetch(input, init)
  }) as typeof fetch

  return {
    pipeline,
    r2Store,
    cache,
    reader,

    async ingest(
      artifacts: E2EArtifact[],
      options?: { mode?: 'preview' | 'build' | 'bulk'; authToken?: string }
    ): Promise<E2EIngestResult> {
      const mode = options?.mode || 'build'
      const body = artifacts.map((a) => JSON.stringify(a)).join('\n')

      const headers: Record<string, string> = {
        'Content-Type': 'application/x-ndjson',
        'X-Artifact-Mode': mode,
      }

      if (options?.authToken) {
        headers['Authorization'] = `Bearer ${options.authToken}`
      }

      const request = new Request(
        `${e2eConfig.apiBaseUrl}/$.artifacts`,
        {
          method: 'POST',
          headers,
          body,
        }
      )

      // Import handleIngest dynamically to avoid circular deps
      const { handleIngest } = await import('../../artifacts-ingest')

      const response = await handleIngest(request)

      if (response instanceof Response) {
        const result = await response.json()
        return result as E2EIngestResult
      }

      return response as E2EIngestResult
    },

    async serve(
      ns: string,
      type: string,
      id: string,
      ext: string,
      options?: { fresh?: boolean; maxAge?: number; authToken?: string }
    ): Promise<E2EServeResult> {
      const url = new URL(
        `${e2eConfig.apiBaseUrl}/$.content/${ns}/${type}/${id}.${ext}`
      )

      if (options?.fresh) {
        url.searchParams.set('fresh', 'true')
      }
      if (options?.maxAge !== undefined) {
        url.searchParams.set('max_age', String(options.maxAge))
      }

      const headers: Record<string, string> = {}
      if (options?.authToken) {
        headers['Authorization'] = `Bearer ${options.authToken}`
      }

      const request = new Request(url.toString(), { headers })

      // Import handleServe dynamically to avoid circular deps
      const { handleServe } = await import('../../artifacts-serve')

      const ctx: MockExecutionContext = {
        waitUntil: vi.fn(),
        passThroughOnException: vi.fn(),
      }

      const response = await handleServe(request, {}, ctx as unknown as Parameters<typeof handleServe>[2], {
        reader,
        cache,
      })

      // Check if response is ServeResult (has contentType property)
      if ('contentType' in response) {
        const serveResult = response as { status: number; body: string; contentType: string; headers: Record<string, string> }
        return {
          status: serveResult.status,
          body: serveResult.body,
          contentType: serveResult.contentType,
          headers: serveResult.headers,
          source:
            (serveResult.headers['X-Artifact-Source'] as 'cache' | 'parquet') ||
            'parquet',
        }
      }

      // Handle Response type
      const res = response as Response
      const text = await res.text()
      const headersObj: Record<string, string> = {}
      res.headers.forEach((value, key) => {
        headersObj[key] = value
      })
      return {
        status: res.status,
        body: text,
        contentType: res.headers.get('Content-Type') || '',
        headers: headersObj,
        source:
          (res.headers.get('X-Artifact-Source') as 'cache' | 'parquet') ||
          'parquet',
      }
    },

    async cleanup(): Promise<void> {
      pipeline.clear()
      r2Store.clear()
      cache.clear()
      reader.getRecord.mockClear()
    },
  }
}

// ============================================================================
// Staging E2E Client
// ============================================================================

/**
 * Create a staging-based E2E client for remote testing.
 * Requires proper environment variables to be set.
 */
export function createStagingClient(): E2EClient {
  if (!e2eConfig.authToken) {
    throw new Error('E2E_AUTH_TOKEN environment variable required for staging tests')
  }

  return {
    async ingest(
      artifacts: E2EArtifact[],
      options?: { mode?: 'preview' | 'build' | 'bulk'; authToken?: string }
    ): Promise<E2EIngestResult> {
      const mode = options?.mode || 'build'
      const body = artifacts.map((a) => JSON.stringify(a)).join('\n')

      const response = await fetch(
        `${e2eConfig.apiBaseUrl}/$.artifacts`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-ndjson',
            'X-Artifact-Mode': mode,
            Authorization: `Bearer ${options?.authToken || e2eConfig.authToken}`,
          },
          body,
        }
      )

      if (!response.ok) {
        throw new Error(`Ingest failed: ${response.status} ${await response.text()}`)
      }

      return response.json()
    },

    async serve(
      ns: string,
      type: string,
      id: string,
      ext: string,
      options?: { fresh?: boolean; maxAge?: number; authToken?: string }
    ): Promise<E2EServeResult> {
      const url = new URL(
        `${e2eConfig.apiBaseUrl}/$.content/${ns}/${type}/${id}.${ext}`
      )

      if (options?.fresh) {
        url.searchParams.set('fresh', 'true')
      }
      if (options?.maxAge !== undefined) {
        url.searchParams.set('max_age', String(options.maxAge))
      }

      const headers: Record<string, string> = {}
      if (options?.authToken) {
        headers['Authorization'] = `Bearer ${options.authToken}`
      }

      const response = await fetch(url.toString(), { headers })

      const body = await response.text()
      const headersObj: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        headersObj[key] = value
      })
      return {
        status: response.status,
        body,
        contentType: response.headers.get('Content-Type') || '',
        headers: headersObj,
        source:
          (response.headers.get('X-Artifact-Source') as 'cache' | 'parquet') ||
          'parquet',
      }
    },

    async cleanup(): Promise<void> {
      // For staging, cleanup is handled externally or via TTL
      console.log('Staging cleanup: artifacts will expire via TTL')
    },
  }
}

// ============================================================================
// Client Factory
// ============================================================================

/**
 * Create an E2E client based on the environment.
 */
export function createE2EClient(): E2EClient & {
  pipeline?: MockPipeline
  r2Store?: MockR2Store
  cache?: MockCache
  reader?: ReturnType<typeof createMockIcebergReader>
} {
  if (e2eConfig.environment === 'staging') {
    return createStagingClient()
  }
  return createMiniflareClient()
}

// ============================================================================
// Test Utilities
// ============================================================================

/**
 * Wait for pipeline flush based on estimated availability time.
 *
 * @param estimatedAvailableAt - ISO timestamp from ingest response
 * @param extraBuffer - Additional buffer time in ms (default: 1000)
 */
export async function waitForPipelineFlush(
  estimatedAvailableAt: string,
  extraBuffer: number = 1000
): Promise<void> {
  const targetTime = new Date(estimatedAvailableAt).getTime()
  const waitTime = Math.max(0, targetTime - Date.now() + extraBuffer)

  if (waitTime > 0) {
    await new Promise((resolve) => setTimeout(resolve, waitTime))
  }
}

/**
 * Wait for a specified duration.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Generate a unique namespace for test isolation.
 */
export function uniqueNs(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 8)
  return `test-${timestamp}-${random}.do`
}

/**
 * Create a test artifact with defaults.
 */
export function createTestArtifact(
  overrides: Partial<E2EArtifact> = {}
): E2EArtifact {
  return {
    ns: uniqueNs(),
    type: 'Page',
    id: `test-${Date.now()}`,
    markdown: '# Test Artifact\n\nThis is test content.',
    visibility: 'public',
    ...overrides,
  }
}

/**
 * Create multiple test artifacts.
 */
export function createTestArtifacts(
  count: number,
  overrides: Partial<E2EArtifact> = {}
): E2EArtifact[] {
  const ns = overrides.ns || uniqueNs()
  return Array.from({ length: count }, (_, i) => ({
    ns,
    type: 'Page',
    id: `test-${i}`,
    markdown: `# Test Page ${i}\n\nContent for page ${i}.`,
    visibility: 'public' as const,
    ...overrides,
  }))
}

/**
 * Create large content for chunking tests.
 */
export function createLargeContent(sizeBytes: number): string {
  const base = 'Lorem ipsum dolor sit amet. '
  const repeats = Math.ceil(sizeBytes / base.length)
  return base.repeat(repeats).slice(0, sizeBytes)
}

/**
 * Assert that two artifacts have matching content.
 */
export function assertArtifactContent(
  expected: Partial<E2EArtifact>,
  actual: E2EServeResult,
  ext: string
): void {
  const columnMap: Record<string, keyof E2EArtifact> = {
    md: 'markdown',
    mdx: 'mdx',
    html: 'html',
    js: 'esm',
    mjs: 'esm',
    css: 'css',
    json: 'frontmatter',
  }

  const column = columnMap[ext] || ext
  const expectedContent = expected[column as keyof E2EArtifact]

  if (ext === 'json' && typeof expectedContent === 'object') {
    const actualJson = JSON.parse(actual.body)
    if (JSON.stringify(actualJson) !== JSON.stringify(expectedContent)) {
      throw new Error(
        `Content mismatch for ${ext}: expected ${JSON.stringify(expectedContent)}, got ${actual.body}`
      )
    }
  } else if (actual.body !== expectedContent) {
    throw new Error(
      `Content mismatch for ${ext}: expected "${expectedContent}", got "${actual.body}"`
    )
  }
}
