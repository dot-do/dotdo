/**
 * Tests for HTTP Client Infrastructure
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import {
  createHttpClient,
  HttpError,
  TimeoutError,
  RateLimitError,
  isHttpError,
  isTimeoutError,
  isRateLimitError,
  type HttpClient,
  type AuthConfig,
} from './http-client'

describe('createHttpClient', () => {
  describe('basic requests', () => {
    test('GET request returns data', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('{"id": 1, "name": "Test"}'),
        url: 'https://api.test.com/users/1',
      })

      const client = createHttpClient({
        baseUrl: 'https://api.test.com',
        fetch: mockFetch,
      })

      const data = await client.get('/users/1')

      expect(data).toEqual({ id: 1, name: 'Test' })
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/users/1',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          }),
        })
      )
    })

    test('POST request sends body', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        statusText: 'Created',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('{"id": 2, "name": "Alice"}'),
        url: 'https://api.test.com/users',
      })

      const client = createHttpClient({
        baseUrl: 'https://api.test.com',
        fetch: mockFetch,
      })

      const data = await client.post('/users', { name: 'Alice' })

      expect(data).toEqual({ id: 2, name: 'Alice' })
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/users',
        expect.objectContaining({
          method: 'POST',
          body: '{"name":"Alice"}',
        })
      )
    })

    test('PUT request updates resource', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('{"id": 1, "name": "Bob"}'),
        url: 'https://api.test.com/users/1',
      })

      const client = createHttpClient({
        baseUrl: 'https://api.test.com',
        fetch: mockFetch,
      })

      const data = await client.put('/users/1', { name: 'Bob' })

      expect(data).toEqual({ id: 1, name: 'Bob' })
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/users/1',
        expect.objectContaining({
          method: 'PUT',
          body: '{"name":"Bob"}',
        })
      )
    })

    test('DELETE request removes resource', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        statusText: 'No Content',
        headers: new Headers(),
        text: () => Promise.resolve(''),
        url: 'https://api.test.com/users/1',
      })

      const client = createHttpClient({
        baseUrl: 'https://api.test.com',
        fetch: mockFetch,
      })

      await client.delete('/users/1')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.test.com/users/1',
        expect.objectContaining({
          method: 'DELETE',
        })
      )
    })
  })

  describe('authentication', () => {
    test('bearer token authentication', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('{}'),
        url: 'https://api.test.com/users',
      })

      const client = createHttpClient({
        baseUrl: 'https://api.test.com',
        auth: { type: 'bearer', token: 'test-token' },
        fetch: mockFetch,
      })

      await client.get('/users')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-token',
          }),
        })
      )
    })

    test('API key authentication', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('{}'),
        url: 'https://api.test.com/users',
      })

      const client = createHttpClient({
        baseUrl: 'https://api.test.com',
        auth: {
          type: 'api_key',
          apiKey: 'api-key-123',
          apiKeyHeader: 'X-API-Key',
        },
        fetch: mockFetch,
      })

      await client.get('/users')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-API-Key': 'api-key-123',
          }),
        })
      )
    })

    test('basic authentication', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('{}'),
        url: 'https://api.test.com/users',
      })

      const client = createHttpClient({
        baseUrl: 'https://api.test.com',
        auth: {
          type: 'basic',
          username: 'user',
          password: 'pass',
        },
        fetch: mockFetch,
      })

      await client.get('/users')

      // Base64 of "user:pass"
      const expectedAuth = 'Basic ' + btoa('user:pass')
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expectedAuth,
          }),
        })
      )
    })

    test('setAuth updates authentication', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('{}'),
        url: 'https://api.test.com/users',
      })

      const client = createHttpClient({
        baseUrl: 'https://api.test.com',
        auth: { type: 'bearer', token: 'old-token' },
        fetch: mockFetch,
      })

      client.setAuth({ type: 'bearer', token: 'new-token' })
      await client.get('/users')

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer new-token',
          }),
        })
      )
    })

    test('skipAuth option bypasses authentication', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('{}'),
        url: 'https://api.test.com/public',
      })

      const client = createHttpClient({
        baseUrl: 'https://api.test.com',
        auth: { type: 'bearer', token: 'secret-token' },
        fetch: mockFetch,
      })

      await client.get('/public', { skipAuth: true })

      const callHeaders = mockFetch.mock.calls[0][1].headers
      expect(callHeaders.Authorization).toBeUndefined()
    })
  })

  describe('query parameters', () => {
    test('adds query parameters to URL', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('[]'),
        url: 'https://api.test.com/users',
      })

      const client = createHttpClient({
        baseUrl: 'https://api.test.com',
        fetch: mockFetch,
      })

      await client.get('/users', {
        params: { limit: 10, offset: 20, active: true },
      })

      const calledUrl = mockFetch.mock.calls[0][0]
      expect(calledUrl).toContain('limit=10')
      expect(calledUrl).toContain('offset=20')
      expect(calledUrl).toContain('active=true')
    })

    test('skips undefined parameters', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('[]'),
        url: 'https://api.test.com/users',
      })

      const client = createHttpClient({
        baseUrl: 'https://api.test.com',
        fetch: mockFetch,
      })

      await client.get('/users', {
        params: { limit: 10, offset: undefined },
      })

      const calledUrl = mockFetch.mock.calls[0][0]
      expect(calledUrl).toContain('limit=10')
      expect(calledUrl).not.toContain('offset')
    })
  })

  describe('error handling', () => {
    test('throws HttpError on non-OK response', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers({
          'content-type': 'application/json',
          'x-request-id': 'req-123',
        }),
        text: () => Promise.resolve('{"error": "User not found"}'),
        url: 'https://api.test.com/users/999',
      })

      const client = createHttpClient({
        baseUrl: 'https://api.test.com',
        fetch: mockFetch,
      })

      await expect(client.get('/users/999')).rejects.toThrow(HttpError)

      try {
        await client.get('/users/999')
      } catch (error) {
        expect(isHttpError(error)).toBe(true)
        if (isHttpError(error)) {
          expect(error.status).toBe(404)
          expect(error.requestId).toBe('req-123')
          expect(error.retryable).toBe(false)
        }
      }
    })

    test('identifies retryable status codes', async () => {
      const retryableStatuses = [429, 500, 502, 503, 504]

      for (const status of retryableStatuses) {
        const mockFetch = vi.fn().mockResolvedValue({
          ok: false,
          status,
          statusText: 'Error',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{}'),
          url: 'https://api.test.com/test',
        })

        const client = createHttpClient({
          baseUrl: 'https://api.test.com',
          fetch: mockFetch,
        })

        try {
          await client.get('/test')
        } catch (error) {
          if (isHttpError(error)) {
            expect(error.retryable).toBe(true)
          }
        }
      }
    })

    test('throws RateLimitError on 429 with Retry-After', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Headers({
          'content-type': 'application/json',
          'Retry-After': '60',
        }),
        text: () => Promise.resolve('{}'),
        url: 'https://api.test.com/test',
      })

      const client = createHttpClient({
        baseUrl: 'https://api.test.com',
        fetch: mockFetch,
      })

      await expect(client.get('/test')).rejects.toThrow(RateLimitError)

      try {
        await client.get('/test')
      } catch (error) {
        expect(isRateLimitError(error)).toBe(true)
        if (isRateLimitError(error)) {
          expect(error.retryAfter).toBe(60)
        }
      }
    })
  })

  describe('retries', () => {
    test('retries on retryable error', async () => {
      let callCount = 0
      const mockFetch = vi.fn().mockImplementation(() => {
        callCount++
        if (callCount < 3) {
          return Promise.resolve({
            ok: false,
            status: 503,
            statusText: 'Service Unavailable',
            headers: new Headers({ 'content-type': 'application/json' }),
            text: () => Promise.resolve('{}'),
            url: 'https://api.test.com/test',
          })
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: new Headers({ 'content-type': 'application/json' }),
          text: () => Promise.resolve('{"success": true}'),
          url: 'https://api.test.com/test',
        })
      })

      const client = createHttpClient({
        baseUrl: 'https://api.test.com',
        fetch: mockFetch,
        retries: 3,
        retryDelay: 10, // Short delay for tests
      })

      const data = await client.get('/test')

      expect(data).toEqual({ success: true })
      expect(mockFetch).toHaveBeenCalledTimes(3)
    }, 10000)

    test('gives up after max retries', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: 'Service Unavailable',
        headers: new Headers({ 'content-type': 'application/json' }),
        text: () => Promise.resolve('{}'),
        url: 'https://api.test.com/test',
      })

      const client = createHttpClient({
        baseUrl: 'https://api.test.com',
        fetch: mockFetch,
        retries: 2,
        retryDelay: 10,
      })

      await expect(client.get('/test')).rejects.toThrow(HttpError)
      expect(mockFetch).toHaveBeenCalledTimes(3) // Initial + 2 retries
    }, 10000)
  })

  describe('request method', () => {
    test('returns full response with metadata', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({
          'content-type': 'application/json',
          'x-custom': 'value',
        }),
        text: () => Promise.resolve('{"data": "test"}'),
        url: 'https://api.test.com/test',
      })

      const client = createHttpClient({
        baseUrl: 'https://api.test.com',
        fetch: mockFetch,
      })

      const response = await client.request('/test')

      expect(response.data).toEqual({ data: 'test' })
      expect(response.status).toBe(200)
      expect(response.statusText).toBe('OK')
      expect(response.headers.get('x-custom')).toBe('value')
      expect(response.duration).toBeGreaterThanOrEqual(0)
    })
  })
})

describe('type guards', () => {
  test('isHttpError returns true for HttpError', () => {
    const error = new HttpError({
      message: 'Test error',
      status: 400,
      statusText: 'Bad Request',
      url: 'https://test.com',
      method: 'GET',
    })

    expect(isHttpError(error)).toBe(true)
    expect(isHttpError(new Error('test'))).toBe(false)
    expect(isHttpError('string')).toBe(false)
    expect(isHttpError(null)).toBe(false)
  })

  test('isTimeoutError returns true for TimeoutError', () => {
    const error = new TimeoutError(5000, 'https://test.com')

    expect(isTimeoutError(error)).toBe(true)
    expect(isTimeoutError(new Error('timeout'))).toBe(false)
  })

  test('isRateLimitError returns true for RateLimitError', () => {
    const error = new RateLimitError('https://test.com', 'GET', 60)

    expect(isRateLimitError(error)).toBe(true)
    expect(isRateLimitError(new HttpError({
      message: 'Rate limited',
      status: 429,
      statusText: 'Too Many Requests',
      url: 'https://test.com',
      method: 'GET',
    }))).toBe(false)
  })
})
