/**
 * E2E Integration Test Harness
 *
 * Provides utilities for end-to-end integration testing of the dotdo system.
 * Supports both mocked and real (miniflare) Durable Object testing.
 *
 * Features:
 * - Test setup/teardown utilities with isolation
 * - Helper functions for creating test DO instances
 * - Request builders for testing HTTP endpoints
 * - Assertion helpers for response validation
 * - Performance timing utilities
 *
 * @example
 * ```typescript
 * import { E2ETestHarness } from '../tests/e2e/harness'
 *
 * describe('My E2E Tests', () => {
 *   const harness = new E2ETestHarness()
 *
 *   beforeEach(async () => {
 *     await harness.setup()
 *   })
 *
 *   afterEach(async () => {
 *     await harness.teardown()
 *   })
 *
 *   it('creates a thing', async () => {
 *     const response = await harness
 *       .request('/things')
 *       .post({ $type: 'Customer', name: 'Alice' })
 *
 *     harness.assertStatus(response, 201)
 *     harness.assertJson(response)
 *   })
 * })
 * ```
 *
 * @module tests/e2e/harness
 */

import { vi } from 'vitest'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Configuration options for the test harness
 */
export interface HarnessConfig {
  /** Namespace for isolated testing (default: 'test-ns') */
  namespace?: string
  /** Enable verbose logging (default: false) */
  verbose?: boolean
  /** Enable timing measurements (default: true) */
  enableTiming?: boolean
  /** Custom mock overrides */
  mocks?: Partial<MockEnv>
}

/**
 * Mock environment bindings
 */
export interface MockEnv {
  DO: MockDONamespace
  PIPELINE: MockPipeline
  KV: MockKVNamespace
  AI?: MockAI
}

/**
 * Mock Durable Object namespace
 */
export interface MockDONamespace {
  idFromName(name: string): MockDOId
  get(id: MockDOId): MockDOStub
  _getStubs(): Map<string, MockDOStub>
  _getStub(name: string): MockDOStub | undefined
}

/**
 * Mock Durable Object ID
 */
export interface MockDOId {
  name: string
  toString(): string
}

/**
 * Mock Durable Object stub
 */
export interface MockDOStub {
  name: string
  state: Map<string, unknown>
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>
  _setResponse(method: string, path: string, response: Response): void
}

/**
 * Mock Pipeline for event emission
 */
export interface MockPipeline {
  send: ReturnType<typeof vi.fn>
  events: PipelineEvent[]
  clear(): void
  setDelay(ms: number): void
  setError(err: Error | null): void
  setFailCount(count: number): void
  simulateEvent(event: PipelineEvent): void
}

/**
 * Mock KV namespace
 */
export interface MockKVNamespace {
  get(key: string): Promise<string | null>
  put(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
  list(): Promise<{ keys: { name: string }[] }>
  _storage: Map<string, string>
}

/**
 * Mock AI binding
 */
export interface MockAI {
  run: ReturnType<typeof vi.fn>
}

/**
 * Pipeline event structure
 */
export interface PipelineEvent {
  type: 'thing.created' | 'thing.updated' | 'thing.deleted' | string
  entityId: string
  entityType: string
  payload: Record<string, unknown>
  timestamp: number
  idempotencyKey: string
  namespace: string
  sequence: number
}

/**
 * Request builder result
 */
export interface RequestResult {
  response: Response
  body: unknown
  duration: number
  headers: Headers
  status: number
}

/**
 * Performance metrics collected during tests
 */
export interface PerformanceMetrics {
  requestCount: number
  totalDuration: number
  averageDuration: number
  minDuration: number
  maxDuration: number
  statusCounts: Map<number, number>
}

/**
 * Entity type for Things
 */
export interface Thing {
  $id: string
  $type: string
  $version?: number
  $createdAt?: number | string
  $updatedAt?: number | string
  [key: string]: unknown
}

// ============================================================================
// MOCK FACTORIES
// ============================================================================

/**
 * Create a mock Durable Object stub
 */
function createMockDOStub(name: string): MockDOStub {
  const responses = new Map<string, Response>()
  const state = new Map<string, unknown>()
  const thingsStore = new Map<string, Thing>()

  return {
    name,
    state,
    fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const request = input instanceof Request ? input : new Request(input, init)
      const url = new URL(request.url)
      const path = url.pathname
      const method = request.method
      const key = `${method}:${path}`

      // Check for custom response
      if (responses.has(key)) {
        return responses.get(key)!.clone()
      }

      // Handle things collection
      if (path === '/things' || path === '/things/') {
        if (method === 'GET') {
          const things = Array.from(thingsStore.values())
          return new Response(JSON.stringify({ items: things, count: things.length }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        if (method === 'POST') {
          const body = await request.json() as Partial<Thing>
          const id = body.$id || crypto.randomUUID()
          const now = Date.now()

          const thing: Thing = {
            $id: id,
            $type: body.$type || 'Thing',
            $version: 1,
            $createdAt: now,
            $updatedAt: now,
            ...body,
          }

          thingsStore.set(id, thing)

          return new Response(JSON.stringify(thing), {
            status: 201,
            headers: {
              'Content-Type': 'application/json',
              'Location': `/things/${id}`,
            },
          })
        }
      }

      // Handle single thing
      const thingMatch = path.match(/^\/things\/([^/]+)$/)
      if (thingMatch) {
        const thingId = decodeURIComponent(thingMatch[1])

        if (method === 'GET') {
          const thing = thingsStore.get(thingId)
          if (!thing) {
            return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })
          }
          return new Response(JSON.stringify(thing), {
            headers: { 'Content-Type': 'application/json' },
          })
        }

        if (method === 'PUT' || method === 'PATCH') {
          const thing = thingsStore.get(thingId)
          if (!thing) {
            return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })
          }
          const body = await request.json() as Partial<Thing>
          const updated: Thing = {
            ...thing,
            ...body,
            $id: thing.$id,
            $version: (thing.$version || 0) + 1,
            $updatedAt: Date.now(),
          }
          thingsStore.set(thingId, updated)
          return new Response(JSON.stringify(updated), {
            headers: { 'Content-Type': 'application/json' },
          })
        }

        if (method === 'DELETE') {
          if (!thingsStore.has(thingId)) {
            return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 })
          }
          thingsStore.delete(thingId)
          return new Response(null, { status: 204 })
        }
      }

      // Health check
      if (path === '/health') {
        return new Response(JSON.stringify({ status: 'ok', stub: name }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Root info
      if (path === '/' || path === '') {
        return new Response(JSON.stringify({
          id: name,
          status: 'active',
          thingCount: thingsStore.size,
        }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      // Default 404
      return new Response(JSON.stringify({ error: `Not found: ${path}` }), { status: 404 })
    }),
    _setResponse(method: string, path: string, response: Response) {
      responses.set(`${method}:${path}`, response)
    },
  }
}

/**
 * Create a mock Durable Object namespace
 */
function createMockDONamespace(name: string): MockDONamespace {
  const stubs = new Map<string, MockDOStub>()

  return {
    idFromName(instanceName: string): MockDOId {
      return { name: instanceName, toString: () => `id:${instanceName}` }
    },
    get(id: MockDOId): MockDOStub {
      if (!stubs.has(id.name)) {
        stubs.set(id.name, createMockDOStub(id.name))
      }
      return stubs.get(id.name)!
    },
    _getStubs: () => stubs,
    _getStub: (stubName: string) => stubs.get(stubName),
  }
}

/**
 * Create a mock Pipeline
 */
function createMockPipeline(): MockPipeline {
  const events: PipelineEvent[] = []
  let delay = 0
  let error: Error | null = null
  let failuresRemaining = 0
  let sequence = 0

  const send = vi.fn(async (batch: unknown[]) => {
    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
    if (failuresRemaining > 0) {
      failuresRemaining--
      throw error || new Error('Mock pipeline failure')
    }
    if (error) {
      throw error
    }
    for (const event of batch as PipelineEvent[]) {
      sequence++
      events.push({ ...event, sequence })
    }
  })

  return {
    send,
    events,
    clear() {
      events.length = 0
      send.mockClear()
      sequence = 0
    },
    setDelay(ms: number) {
      delay = ms
    },
    setError(err: Error | null) {
      error = err
    },
    setFailCount(count: number) {
      failuresRemaining = count
    },
    simulateEvent(event: PipelineEvent) {
      events.push({ ...event, sequence: ++sequence })
    },
  }
}

/**
 * Create a mock KV namespace
 */
function createMockKVNamespace(): MockKVNamespace {
  const storage = new Map<string, string>()

  return {
    async get(key: string): Promise<string | null> {
      return storage.get(key) || null
    },
    async put(key: string, value: string): Promise<void> {
      storage.set(key, value)
    },
    async delete(key: string): Promise<void> {
      storage.delete(key)
    },
    async list(): Promise<{ keys: { name: string }[] }> {
      return { keys: Array.from(storage.keys()).map(name => ({ name })) }
    },
    _storage: storage,
  }
}

/**
 * Create a mock AI binding
 */
function createMockAI(): MockAI {
  return {
    run: vi.fn().mockResolvedValue({ response: 'AI response' }),
  }
}

// ============================================================================
// REQUEST BUILDER
// ============================================================================

/**
 * Fluent request builder for testing HTTP endpoints
 */
export class RequestBuilder {
  private url: string
  private headers: Record<string, string> = {}
  private harness: E2ETestHarness

  constructor(harness: E2ETestHarness, basePath: string) {
    this.harness = harness
    this.url = basePath.startsWith('http') ? basePath : `http://test.local${basePath}`
  }

  /**
   * Add a header to the request
   */
  header(name: string, value: string): this {
    this.headers[name] = value
    return this
  }

  /**
   * Add Authorization header
   */
  auth(token: string): this {
    this.headers['Authorization'] = `Bearer ${token}`
    return this
  }

  /**
   * Add Content-Type header
   */
  contentType(type: string): this {
    this.headers['Content-Type'] = type
    return this
  }

  /**
   * Execute GET request
   */
  async get(): Promise<RequestResult> {
    return this.execute('GET')
  }

  /**
   * Execute POST request with JSON body
   */
  async post(body?: unknown): Promise<RequestResult> {
    return this.execute('POST', body)
  }

  /**
   * Execute PUT request with JSON body
   */
  async put(body?: unknown): Promise<RequestResult> {
    return this.execute('PUT', body)
  }

  /**
   * Execute PATCH request with JSON body
   */
  async patch(body?: unknown): Promise<RequestResult> {
    return this.execute('PATCH', body)
  }

  /**
   * Execute DELETE request
   */
  async delete(): Promise<RequestResult> {
    return this.execute('DELETE')
  }

  /**
   * Execute the request and measure timing
   */
  private async execute(method: string, body?: unknown): Promise<RequestResult> {
    const start = performance.now()

    const init: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...this.headers,
      },
    }

    if (body !== undefined) {
      init.body = JSON.stringify(body)
    }

    const response = await this.harness.getStub().fetch(this.url, init)
    const duration = performance.now() - start

    let parsedBody: unknown = null
    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('application/json') && response.status !== 204) {
      parsedBody = await response.clone().json()
    }

    const result: RequestResult = {
      response,
      body: parsedBody,
      duration,
      headers: response.headers,
      status: response.status,
    }

    // Track metrics
    this.harness.recordRequest(result)

    return result
  }
}

// ============================================================================
// E2E TEST HARNESS
// ============================================================================

/**
 * E2E Integration Test Harness
 *
 * Provides complete setup/teardown and utilities for E2E testing.
 */
export class E2ETestHarness {
  private config: Required<HarnessConfig>
  private env: MockEnv
  private currentStub: MockDOStub | null = null
  private metrics: PerformanceMetrics
  private setupTime: number = 0
  private isSetup: boolean = false

  constructor(config: HarnessConfig = {}) {
    this.config = {
      namespace: config.namespace ?? 'test-ns',
      verbose: config.verbose ?? false,
      enableTiming: config.enableTiming ?? true,
      mocks: config.mocks ?? {},
    }

    this.env = this.createEnv()
    this.metrics = this.createEmptyMetrics()
  }

  /**
   * Create mock environment
   */
  private createEnv(): MockEnv {
    return {
      DO: this.config.mocks?.DO ?? createMockDONamespace('DO'),
      PIPELINE: this.config.mocks?.PIPELINE ?? createMockPipeline(),
      KV: this.config.mocks?.KV ?? createMockKVNamespace(),
      AI: this.config.mocks?.AI ?? createMockAI(),
    }
  }

  /**
   * Create empty metrics object
   */
  private createEmptyMetrics(): PerformanceMetrics {
    return {
      requestCount: 0,
      totalDuration: 0,
      averageDuration: 0,
      minDuration: Infinity,
      maxDuration: 0,
      statusCounts: new Map(),
    }
  }

  /**
   * Setup the test harness (call in beforeEach)
   */
  async setup(): Promise<void> {
    const start = performance.now()

    // Reset environment
    this.env = this.createEnv()
    this.metrics = this.createEmptyMetrics()

    // Create default stub
    const id = this.env.DO.idFromName(this.config.namespace)
    this.currentStub = this.env.DO.get(id)

    this.setupTime = performance.now() - start
    this.isSetup = true

    if (this.config.verbose) {
      console.log(`[Harness] Setup complete in ${this.setupTime.toFixed(2)}ms`)
    }
  }

  /**
   * Teardown the test harness (call in afterEach)
   */
  async teardown(): Promise<void> {
    if (this.config.verbose && this.metrics.requestCount > 0) {
      console.log(`[Harness] Teardown - ${this.metrics.requestCount} requests, avg ${this.metrics.averageDuration.toFixed(2)}ms`)
    }

    this.currentStub = null
    this.isSetup = false
    this.env.PIPELINE.clear()
  }

  /**
   * Get the current DO stub
   */
  getStub(): MockDOStub {
    if (!this.currentStub) {
      throw new Error('Harness not setup. Call setup() first.')
    }
    return this.currentStub
  }

  /**
   * Get the mock environment
   */
  getEnv(): MockEnv {
    return this.env
  }

  /**
   * Get a specific DO stub by name
   */
  getStubByName(name: string): MockDOStub {
    const id = this.env.DO.idFromName(name)
    return this.env.DO.get(id)
  }

  /**
   * Create a request builder for the given path
   */
  request(path: string): RequestBuilder {
    return new RequestBuilder(this, path)
  }

  /**
   * Record a request in metrics
   */
  recordRequest(result: RequestResult): void {
    if (!this.config.enableTiming) return

    this.metrics.requestCount++
    this.metrics.totalDuration += result.duration
    this.metrics.averageDuration = this.metrics.totalDuration / this.metrics.requestCount
    this.metrics.minDuration = Math.min(this.metrics.minDuration, result.duration)
    this.metrics.maxDuration = Math.max(this.metrics.maxDuration, result.duration)

    const count = this.metrics.statusCounts.get(result.status) || 0
    this.metrics.statusCounts.set(result.status, count + 1)
  }

  /**
   * Get performance metrics
   */
  getMetrics(): PerformanceMetrics {
    return { ...this.metrics, statusCounts: new Map(this.metrics.statusCounts) }
  }

  /**
   * Get pipeline events
   */
  getPipelineEvents(): PipelineEvent[] {
    return [...this.env.PIPELINE.events]
  }

  // ==========================================================================
  // ASSERTION HELPERS
  // ==========================================================================

  /**
   * Assert response status code
   */
  assertStatus(result: RequestResult, expected: number): void {
    if (result.status !== expected) {
      throw new Error(
        `Expected status ${expected}, got ${result.status}. Body: ${JSON.stringify(result.body)}`
      )
    }
  }

  /**
   * Assert response is JSON
   */
  assertJson(result: RequestResult): void {
    const contentType = result.headers.get('content-type') || ''
    if (!contentType.includes('application/json')) {
      throw new Error(`Expected JSON content type, got: ${contentType}`)
    }
  }

  /**
   * Assert response body contains expected fields
   */
  assertBodyContains(result: RequestResult, expected: Record<string, unknown>): void {
    const body = result.body as Record<string, unknown>
    for (const [key, value] of Object.entries(expected)) {
      if (body[key] !== value) {
        throw new Error(
          `Expected body.${key} to be ${JSON.stringify(value)}, got ${JSON.stringify(body[key])}`
        )
      }
    }
  }

  /**
   * Assert response body matches structure
   */
  assertBodyStructure(result: RequestResult, keys: string[]): void {
    const body = result.body as Record<string, unknown>
    for (const key of keys) {
      if (!(key in body)) {
        throw new Error(`Expected body to have key "${key}", but it was missing`)
      }
    }
  }

  /**
   * Assert request completed within duration
   */
  assertDuration(result: RequestResult, maxMs: number): void {
    if (result.duration > maxMs) {
      throw new Error(`Expected request to complete within ${maxMs}ms, but took ${result.duration.toFixed(2)}ms`)
    }
  }

  /**
   * Assert success status (2xx)
   */
  assertSuccess(result: RequestResult): void {
    if (result.status < 200 || result.status >= 300) {
      throw new Error(`Expected success status, got ${result.status}. Body: ${JSON.stringify(result.body)}`)
    }
  }

  /**
   * Assert error status (4xx or 5xx)
   */
  assertError(result: RequestResult): void {
    if (result.status < 400) {
      throw new Error(`Expected error status, got ${result.status}`)
    }
  }

  /**
   * Assert pipeline event was emitted
   */
  assertEventEmitted(type: string): void {
    const events = this.getPipelineEvents()
    const found = events.some(e => e.type === type)
    if (!found) {
      const types = events.map(e => e.type).join(', ')
      throw new Error(`Expected event "${type}" to be emitted. Events: [${types}]`)
    }
  }

  /**
   * Assert no pipeline events were emitted
   */
  assertNoEvents(): void {
    const events = this.getPipelineEvents()
    if (events.length > 0) {
      const types = events.map(e => e.type).join(', ')
      throw new Error(`Expected no events, but found: [${types}]`)
    }
  }

  // ==========================================================================
  // HELPER METHODS
  // ==========================================================================

  /**
   * Create a thing and return the result
   */
  async createThing(data: Partial<Thing>): Promise<Thing> {
    const result = await this.request('/things').post(data)
    this.assertStatus(result, 201)
    return result.body as Thing
  }

  /**
   * Get a thing by ID
   */
  async getThing(id: string): Promise<Thing | null> {
    const result = await this.request(`/things/${id}`).get()
    if (result.status === 404) return null
    this.assertStatus(result, 200)
    return result.body as Thing
  }

  /**
   * Update a thing
   */
  async updateThing(id: string, data: Partial<Thing>): Promise<Thing> {
    const result = await this.request(`/things/${id}`).patch(data)
    this.assertStatus(result, 200)
    return result.body as Thing
  }

  /**
   * Delete a thing
   */
  async deleteThing(id: string): Promise<void> {
    const result = await this.request(`/things/${id}`).delete()
    this.assertStatus(result, 204)
  }

  /**
   * List all things
   */
  async listThings(): Promise<Thing[]> {
    const result = await this.request('/things').get()
    this.assertStatus(result, 200)
    const body = result.body as { items: Thing[] }
    return body.items
  }

  /**
   * Wait for a condition with timeout
   */
  async waitFor(
    condition: () => boolean | Promise<boolean>,
    options: { timeout?: number; interval?: number } = {}
  ): Promise<void> {
    const timeout = options.timeout ?? 5000
    const interval = options.interval ?? 50
    const start = Date.now()

    while (Date.now() - start < timeout) {
      if (await condition()) {
        return
      }
      await new Promise(resolve => setTimeout(resolve, interval))
    }

    throw new Error(`Timeout waiting for condition after ${timeout}ms`)
  }

  /**
   * Run a timing test and return duration
   */
  async time<T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
    const start = performance.now()
    const result = await fn()
    const duration = performance.now() - start
    return { result, duration }
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  createMockDOStub,
  createMockDONamespace,
  createMockPipeline,
  createMockKVNamespace,
  createMockAI,
}

export default E2ETestHarness
