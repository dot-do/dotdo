/**
 * API Test Helpers
 *
 * Provides typed request/response utilities for testing Hono applications.
 * Eliminates boilerplate and provides fluent assertion chains.
 *
 * @example
 * ```typescript
 * import { createTestClient } from 'dotdo/testing'
 * import { app } from './app'
 *
 * const client = createTestClient(app)
 *
 * // Simple request
 * const response = await client.get<HealthResponse>('/health')
 * expect(response.body.status).toBe('ok')
 *
 * // With assertions
 * const response = await client.post('/items', { name: 'test' })
 * response
 *   .expectStatus(201)
 *   .expectJson()
 *   .expectBodyToMatch({ name: 'test' })
 *
 * // Authenticated requests
 * const authClient = client.withAuth('my-token').asUser('user-123')
 * const response = await authClient.get('/protected')
 * ```
 */

import type { Hono } from 'hono'

// ============================================================================
// Types
// ============================================================================

/**
 * Test response wrapper with typed body and assertion helpers
 */
export interface TestResponse<T = unknown> {
  /** HTTP status code */
  status: number
  /** Response headers */
  headers: Headers
  /** Parsed response body (JSON parsed if applicable) */
  body: T
  /** Raw Response object for advanced use cases */
  raw: Response

  /**
   * Assert response status code matches expected value
   * @throws Error if status doesn't match
   * @returns this for chaining
   */
  expectStatus(status: number): this

  /**
   * Assert response Content-Type is application/json
   * @throws Error if not JSON content type
   * @returns this for chaining
   */
  expectJson(): this

  /**
   * Assert response body matches partial object
   * @param matcher Partial object to match against body
   * @throws Error if body doesn't contain matching properties
   * @returns this for chaining
   */
  expectBodyToMatch(matcher: Partial<T>): this
}

/**
 * Test client for making HTTP requests to a Hono app
 */
export interface TestClient {
  /**
   * Make a GET request
   * @param path Request path (can include query string)
   */
  get<T = unknown>(path: string): Promise<TestResponse<T>>

  /**
   * Make a POST request with JSON body
   * @param path Request path
   * @param body Request body (will be JSON serialized)
   */
  post<T = unknown>(path: string, body: unknown): Promise<TestResponse<T>>

  /**
   * Make a PUT request with JSON body
   * @param path Request path
   * @param body Request body (will be JSON serialized)
   */
  put<T = unknown>(path: string, body: unknown): Promise<TestResponse<T>>

  /**
   * Make a PATCH request with JSON body
   * @param path Request path
   * @param body Request body (will be JSON serialized)
   */
  patch<T = unknown>(path: string, body: unknown): Promise<TestResponse<T>>

  /**
   * Make a DELETE request
   * @param path Request path
   */
  delete<T = unknown>(path: string): Promise<TestResponse<T>>

  /**
   * Create a new client with Authorization header set
   * Adds "Bearer " prefix to the token
   * @param token Auth token (without Bearer prefix)
   * @returns New TestClient with auth header configured
   */
  withAuth(token: string): TestClient

  /**
   * Create a new client with X-User-ID header set
   * Useful for simulating authenticated user context
   * @param userId User ID to set in header
   * @returns New TestClient with user header configured
   */
  asUser(userId: string): TestClient
}

// ============================================================================
// Implementation
// ============================================================================

/**
 * Creates a TestResponse wrapper from a raw Response
 */
async function createTestResponse<T>(response: Response): Promise<TestResponse<T>> {
  const contentType = response.headers.get('content-type') || ''
  const isJson = contentType.includes('application/json')

  let body: T
  if (response.status === 204) {
    // No content - body is null
    body = null as T
  } else if (isJson) {
    // Clone to allow multiple reads
    body = (await response.clone().json()) as T
  } else {
    // For non-JSON, body is null
    body = null as T
  }

  const testResponse: TestResponse<T> = {
    status: response.status,
    headers: response.headers,
    body,
    raw: response,

    expectStatus(expected: number) {
      if (this.status !== expected) {
        throw new Error(
          `Expected status ${expected}, but got ${this.status}. Body: ${JSON.stringify(this.body)}`
        )
      }
      return this
    },

    expectJson() {
      const ct = this.headers.get('content-type') || ''
      if (!ct.includes('application/json')) {
        throw new Error(`Expected JSON content type, but got: ${ct}`)
      }
      return this
    },

    expectBodyToMatch(matcher: Partial<T>) {
      const bodyObj = this.body as Record<string, unknown>
      const matcherObj = matcher as Record<string, unknown>

      for (const [key, value] of Object.entries(matcherObj)) {
        if (bodyObj[key] !== value) {
          throw new Error(
            `Expected body.${key} to be ${JSON.stringify(value)}, but got ${JSON.stringify(bodyObj[key])}`
          )
        }
      }
      return this
    },
  }

  return testResponse
}

/**
 * Creates a test client implementation
 */
function createClient(
  app: Hono,
  defaultHeaders: Record<string, string> = {}
): TestClient {
  async function request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<TestResponse<T>> {
    const options: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...defaultHeaders,
      },
    }

    if (body !== undefined) {
      options.body = JSON.stringify(body)
    }

    const response = await app.request(path, options)
    return createTestResponse<T>(response)
  }

  return {
    get<T = unknown>(path: string) {
      return request<T>('GET', path)
    },

    post<T = unknown>(path: string, body: unknown) {
      return request<T>('POST', path, body)
    },

    put<T = unknown>(path: string, body: unknown) {
      return request<T>('PUT', path, body)
    },

    patch<T = unknown>(path: string, body: unknown) {
      return request<T>('PATCH', path, body)
    },

    delete<T = unknown>(path: string) {
      return request<T>('DELETE', path)
    },

    withAuth(token: string): TestClient {
      return createClient(app, {
        ...defaultHeaders,
        Authorization: `Bearer ${token}`,
      })
    },

    asUser(userId: string): TestClient {
      return createClient(app, {
        ...defaultHeaders,
        'X-User-ID': userId,
      })
    },
  }
}

/**
 * Creates a test client for a Hono application
 *
 * @param app Hono application to test
 * @returns TestClient instance
 *
 * @example
 * ```typescript
 * import { createTestClient } from 'dotdo/testing'
 * import { app } from './api'
 *
 * const client = createTestClient(app)
 * const response = await client.get('/health')
 * expect(response.status).toBe(200)
 * ```
 */
export function createTestClient(app: Hono): TestClient {
  return createClient(app)
}
