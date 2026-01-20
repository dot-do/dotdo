// E2E Tests: Browser Environment
// Tests SDK behavior in browser-like environment using happy-dom
// NO MOCKS, NO FAKES - real network I/O
// See do-luhm.27

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import {
  getE2EConfig,
  skipIfNoWorker,
  generateTestId,
  trackCreatedResource,
  type E2EConfig
} from './setup'

/**
 * Browser-specific client that tests:
 * - Fetch API behavior (as in browsers)
 * - CORS handling
 * - Request/Response streaming
 * - AbortController support
 */
function createBrowserClient(baseUrl: string, apiKey?: string) {
  async function request<T>(
    path: string,
    method: string = 'GET',
    body?: unknown,
    options: { signal?: AbortSignal; timeout?: number } = {}
  ): Promise<T> {
    const { signal, timeout = 30000 } = options

    // Create abort controller for timeout if not provided
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }

    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`
    }

    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: signal || controller.signal,
        // Browser-specific options
        mode: 'cors',
        credentials: 'omit' // Don't send cookies for cross-origin requests
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: response.statusText }))
        throw new Error(`APIError: ${(error as any).error || (error as any).message || 'Request failed'} (${response.status})`)
      }

      if (response.status === 204) {
        return undefined as T
      }

      return response.json()
    } catch (error) {
      clearTimeout(timeoutId)
      if ((error as Error).name === 'AbortError') {
        throw new Error('Request timeout or aborted')
      }
      throw error
    }
  }

  return {
    request,

    things: {
      list: async (options?: { signal?: AbortSignal }) => {
        const res = await request<{ data: any[] } | any[]>('/things', 'GET', undefined, options)
        return Array.isArray(res) ? res : res.data || []
      },
      get: async (id: string, options?: { signal?: AbortSignal }) =>
        request<any>(`/things/${id}`, 'GET', undefined, options),
      create: async (data: { $type: string; name?: string; data?: unknown }, options?: { signal?: AbortSignal }) =>
        request<any>('/things', 'POST', data, options),
      update: async (id: string, data: Partial<{ name?: string; data?: unknown }>, options?: { signal?: AbortSignal }) =>
        request<any>(`/things/${id}`, 'PUT', data, options),
      delete: async (id: string, options?: { signal?: AbortSignal }) =>
        request<void>(`/things/${id}`, 'DELETE', undefined, options)
    },

    health: async (options?: { signal?: AbortSignal }) =>
      request<{ status: string }>('/health', 'GET', undefined, options),

    root: async (options?: { signal?: AbortSignal }) =>
      request<any>('/', 'GET', undefined, options)
  }
}

describe.skipIf(skipIfNoWorker())('E2E: Browser Environment', () => {
  let config: E2EConfig
  let client: ReturnType<typeof createBrowserClient>
  let testId: string

  beforeAll(() => {
    config = getE2EConfig()
    client = createBrowserClient(config.workerUrl, config.apiKey)
  })

  beforeEach(() => {
    testId = generateTestId()
  })

  describe('CORS Handling', () => {
    it('should receive proper CORS headers', async () => {
      // Make a preflight-like request by checking OPTIONS
      const response = await fetch(`${config.workerUrl}/health`, {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://example.com',
          'Access-Control-Request-Method': 'GET'
        }
      })

      // Check CORS headers are present
      const corsOrigin = response.headers.get('Access-Control-Allow-Origin')
      expect(corsOrigin).toBeTruthy()

      // The actual GET should work
      const health = await client.health()
      expect(health.status).toBe('ok')
    })

    it('should include request ID in response headers', async () => {
      const response = await fetch(`${config.workerUrl}/health`, {
        headers: {
          'X-Request-ID': `browser-test-${testId}`
        }
      })

      // Check X-Request-ID header is echoed back
      const requestId = response.headers.get('X-Request-ID')
      expect(requestId).toBeTruthy()
    })
  })

  describe('Fetch API Behavior', () => {
    it('should work with standard fetch patterns', async () => {
      // Test that standard browser fetch patterns work
      const response = await fetch(`${config.workerUrl}/health`)

      expect(response.ok).toBe(true)
      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toContain('application/json')

      const data = await response.json()
      expect(data.status).toBe('ok')
    })

    it('should handle JSON request/response correctly', async () => {
      const created = await client.things.create({
        $type: 'BrowserTest',
        name: `Browser Test ${testId}`,
        data: { browser: true, timestamp: Date.now() }
      })
      trackCreatedResource('Thing', created.$id)

      expect(created.$id).toBeDefined()
      expect(typeof created.$id).toBe('string')
    })
  })

  describe('AbortController Support', () => {
    it('should support request cancellation', async () => {
      const controller = new AbortController()

      // Abort immediately
      controller.abort()

      await expect(
        client.health({ signal: controller.signal })
      ).rejects.toThrow()
    })

    it('should handle timeout via AbortController', async () => {
      // Create a request with very short timeout
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 1) // 1ms timeout - will likely abort

      try {
        await client.health({ signal: controller.signal })
        // If it succeeds, that's fine too (server was fast)
        clearTimeout(timeoutId)
      } catch (error) {
        clearTimeout(timeoutId)
        // Timeout/abort is expected
        expect((error as Error).message).toMatch(/timeout|abort/i)
      }
    })
  })

  describe('Error Handling in Browser Context', () => {
    it('should handle 404 errors properly', async () => {
      await expect(
        client.things.get('non-existent-browser-test')
      ).rejects.toThrow(/404|not found/i)
    })

    it('should handle network errors gracefully', async () => {
      // Create client with invalid URL
      const badClient = createBrowserClient('http://localhost:99999')

      await expect(
        badClient.health()
      ).rejects.toThrow()
    })
  })

  describe('Content Type Handling', () => {
    it('should send and receive JSON correctly', async () => {
      const complexData = {
        $type: 'ComplexBrowserData',
        name: `Complex ${testId}`,
        data: {
          nested: {
            array: [1, 2, 3],
            object: { key: 'value' },
            unicode: '\u4e2d\u6587', // Chinese characters
            special: '<script>alert("xss")</script>'
          }
        }
      }

      const created = await client.things.create(complexData)
      trackCreatedResource('Thing', created.$id)

      expect(created.data.nested.array).toEqual([1, 2, 3])
      expect(created.data.nested.unicode).toBe('\u4e2d\u6587')
      expect(created.data.nested.special).toBe('<script>alert("xss")</script>')
    })
  })

  describe('Request Headers', () => {
    it('should support custom headers', async () => {
      // Test with X-Request-ID header
      const requestId = `browser-${testId}`
      const response = await fetch(`${config.workerUrl}/health`, {
        headers: {
          'X-Request-ID': requestId,
          'Accept': 'application/json'
        }
      })

      expect(response.ok).toBe(true)

      // Server should echo back request ID
      const returnedId = response.headers.get('X-Request-ID')
      expect(returnedId).toBe(requestId)
    })

    it('should work with Authorization header', async () => {
      if (!config.apiKey) {
        // Skip if no API key configured
        return
      }

      const response = await fetch(`${config.workerUrl}/health`, {
        headers: {
          'Authorization': `Bearer ${config.apiKey}`
        }
      })

      expect(response.ok).toBe(true)
    })
  })

  describe('Response Streaming', () => {
    it('should handle response body as stream', async () => {
      const response = await fetch(`${config.workerUrl}/things`)

      expect(response.body).toBeDefined()

      // Read body as text first
      const text = await response.text()
      const data = JSON.parse(text)

      expect(Array.isArray(data) || (data && typeof data === 'object')).toBe(true)
    })
  })

  describe('Concurrent Browser Requests', () => {
    it('should handle multiple concurrent requests', async () => {
      // Simulate typical browser behavior - multiple parallel requests
      const promises = [
        client.health(),
        client.root(),
        client.things.list(),
        client.things.create({
          $type: 'ConcurrentBrowser',
          name: `Concurrent ${testId}`
        })
      ]

      const results = await Promise.all(promises)

      expect(results[0].status).toBe('ok') // health
      expect(results[1]._links).toBeDefined() // root
      expect(Array.isArray(results[2])).toBe(true) // list
      expect(results[3].$id).toBeDefined() // create

      trackCreatedResource('Thing', results[3].$id)
    })

    it('should handle rapid sequential requests', async () => {
      // Simulate rapid UI interactions
      const results: any[] = []

      for (let i = 0; i < 5; i++) {
        const created = await client.things.create({
          $type: 'RapidSequential',
          name: `Rapid ${testId} #${i}`
        })
        results.push(created)
        trackCreatedResource('Thing', created.$id)
      }

      expect(results).toHaveLength(5)
      results.forEach((r, i) => {
        expect(r.name).toContain(`#${i}`)
      })
    })
  })

  describe('Browser-specific Edge Cases', () => {
    it('should handle empty response bodies', async () => {
      const created = await client.things.create({
        $type: 'ToDelete',
        name: `Delete Test ${testId}`
      })

      // DELETE typically returns 204 No Content
      await client.things.delete(created.$id)

      // Verify deletion
      await expect(client.things.get(created.$id)).rejects.toThrow()
    })

    it('should handle large list responses', async () => {
      // Create several items
      const createPromises = Array.from({ length: 10 }, (_, i) =>
        client.things.create({
          $type: 'BrowserListTest',
          name: `List Browser ${testId} #${i}`
        })
      )

      const created = await Promise.all(createPromises)
      created.forEach(c => trackCreatedResource('Thing', c.$id))

      // List should return all
      const list = await client.things.list()

      expect(list.length).toBeGreaterThanOrEqual(10)
    })
  })
})
