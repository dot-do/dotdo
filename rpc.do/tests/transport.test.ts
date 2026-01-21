// Transport Layer Tests for rpc.do - TDD for Fetch, WebSocket, Stub transports
// Tests the Transport interface and concrete implementations in the rpc.do package

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Transport, TransportState } from '../src/transport/types'

// ============================================================================
// Transport Interface Tests
// ============================================================================

describe('Transport interface', () => {
  it('FetchTransport sends POST to /rpc', async () => {
    const { FetchTransport } = await import('../src/transport/fetch')

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 42 }),
      headers: new Headers(),
    })

    const transport = new FetchTransport({
      url: 'https://api.example.com',
      fetch: mockFetch,
    })
    const result = await transport.send({ method: 'test', args: [] })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/rpc',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
        }),
      })
    )
    // FetchTransport returns the parsed JSON as the result
    expect(result.result).toEqual({ result: 42 })
  })

  it('FetchTransport attaches custom headers', async () => {
    const { FetchTransport } = await import('../src/transport/fetch')

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 42 }),
      headers: new Headers(),
    })

    const transport = new FetchTransport({
      url: 'https://api.example.com',
      headers: { Authorization: 'Bearer token' },
      fetch: mockFetch,
    })
    await transport.send({ method: 'test', args: [] })

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer token',
        }),
      })
    )
  })

  it('Transport interface has required methods', async () => {
    const { FetchTransport } = await import('../src/transport/fetch')

    const transport = new FetchTransport({
      url: 'https://api.example.com',
    })

    expect(typeof transport.send).toBe('function')
  })
})

// ============================================================================
// FetchTransport Tests
// ============================================================================

describe('FetchTransport', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
  })

  describe('constructor', () => {
    it('should create transport with required url option', async () => {
      const { FetchTransport } = await import('../src/transport/fetch')

      const transport = new FetchTransport({
        url: 'https://api.example.com',
        fetch: mockFetch,
      })

      expect(transport).toBeDefined()
      expect(typeof transport.send).toBe('function')
    })

    it('should accept optional timeout', async () => {
      const { FetchTransport } = await import('../src/transport/fetch')

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: 'test' }),
        headers: new Headers(),
      })

      const transport = new FetchTransport({
        url: 'https://api.example.com',
        timeout: 5000,
        fetch: mockFetch,
      })

      await transport.send({ method: 'test', args: [] })

      // The timeout should be passed to AbortSignal.timeout
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        })
      )
    })

    it('should accept optional correlation ID', async () => {
      const { FetchTransport, CORRELATION_ID_HEADER } = await import('../src/transport/fetch')

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: 'test' }),
        headers: new Headers(),
      })

      const transport = new FetchTransport({
        url: 'https://api.example.com',
        correlationId: 'base-correlation-id',
        fetch: mockFetch,
      })

      await transport.send({ method: 'test', args: [] })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            [CORRELATION_ID_HEADER]: 'base-correlation-id',
          }),
        })
      )
    })
  })

  describe('send', () => {
    it('should send method and args in request body', async () => {
      const { FetchTransport } = await import('../src/transport/fetch')

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: 'result' }),
        headers: new Headers(),
      })

      const transport = new FetchTransport({
        url: 'https://api.example.com',
        fetch: mockFetch,
      })

      await transport.send({ method: 'users.create', args: [{ name: 'Alice' }] })

      const calls = mockFetch.mock.calls
      const [[, options]] = calls as [[string, { body: string }]]
      const body = JSON.parse(options.body)

      expect(body.method).toBe('users.create')
      expect(body.args).toEqual([{ name: 'Alice' }])
    })

    it('should return result from successful response', async () => {
      const { FetchTransport } = await import('../src/transport/fetch')

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 123 } }),
        headers: new Headers(),
      })

      const transport = new FetchTransport({
        url: 'https://api.example.com',
        fetch: mockFetch,
      })

      const response = await transport.send({ method: 'test', args: [] })

      expect(response.result).toEqual({ success: true, data: { id: 123 } })
      expect(response.error).toBeUndefined()
    })

    it('should include correlation ID in response', async () => {
      const { FetchTransport, CORRELATION_ID_HEADER } = await import('../src/transport/fetch')

      const responseHeaders = new Headers()
      responseHeaders.set(CORRELATION_ID_HEADER, 'response-correlation-id')

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: 'test' }),
        headers: responseHeaders,
      })

      const transport = new FetchTransport({
        url: 'https://api.example.com',
        fetch: mockFetch,
      })

      const response = await transport.send({ method: 'test', args: [] })

      expect(response.correlationId).toBe('response-correlation-id')
    })

    it('should use message correlation ID over base correlation ID', async () => {
      const { FetchTransport, CORRELATION_ID_HEADER } = await import('../src/transport/fetch')

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: 'test' }),
        headers: new Headers(),
      })

      const transport = new FetchTransport({
        url: 'https://api.example.com',
        correlationId: 'base-id',
        fetch: mockFetch,
      })

      await transport.send({ method: 'test', args: [], correlationId: 'message-id' })

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            [CORRELATION_ID_HEADER]: 'message-id',
          }),
        })
      )
    })

    it('should generate correlation ID if not provided', async () => {
      const { FetchTransport, CORRELATION_ID_HEADER } = await import('../src/transport/fetch')

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ result: 'test' }),
        headers: new Headers(),
      })

      const transport = new FetchTransport({
        url: 'https://api.example.com',
        fetch: mockFetch,
      })

      await transport.send({ method: 'test', args: [] })

      const calls = mockFetch.mock.calls
      const [[, options]] = calls as [[string, { headers: Record<string, string> }]]
      expect(options.headers[CORRELATION_ID_HEADER]).toBeDefined()
      expect(typeof options.headers[CORRELATION_ID_HEADER]).toBe('string')
    })
  })

  describe('error handling', () => {
    it('should return error response on network failure', async () => {
      const { FetchTransport } = await import('../src/transport/fetch')

      mockFetch.mockRejectedValue(new TypeError('fetch failed'))

      const transport = new FetchTransport({
        url: 'https://api.example.com',
        fetch: mockFetch,
      })

      const response = await transport.send({ method: 'test', args: [] })

      expect(response.error).toBeDefined()
      expect(response.error?.type).toBe('TransportError')
      expect(response.correlationId).toBeDefined()
    })

    it('should parse structured error response', async () => {
      const { FetchTransport } = await import('../src/transport/fetch')

      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: () =>
          Promise.resolve({
            type: 'NotFoundError',
            code: 'NOT_FOUND',
            message: 'User not found',
          }),
        headers: new Headers(),
      })

      const transport = new FetchTransport({
        url: 'https://api.example.com',
        fetch: mockFetch,
      })

      const response = await transport.send({ method: 'users.get', args: ['123'] })

      expect(response.error).toBeDefined()
      expect(response.error?.code).toBe('NOT_FOUND')
      expect(response.error?.message).toBe('User not found')
    })

    it('should return generic error for non-JSON error response', async () => {
      const { FetchTransport } = await import('../src/transport/fetch')

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('Invalid JSON')),
        headers: new Headers(),
      })

      const transport = new FetchTransport({
        url: 'https://api.example.com',
        fetch: mockFetch,
      })

      const response = await transport.send({ method: 'test', args: [] })

      expect(response.error).toBeDefined()
      expect(response.error?.message).toContain('500')
    })

    it('should handle timeout errors', async () => {
      const { FetchTransport } = await import('../src/transport/fetch')

      const abortError = new Error('The operation was aborted')
      abortError.name = 'AbortError'
      mockFetch.mockRejectedValue(abortError)

      const transport = new FetchTransport({
        url: 'https://api.example.com',
        timeout: 1000,
        fetch: mockFetch,
      })

      const response = await transport.send({ method: 'test', args: [] })

      expect(response.error).toBeDefined()
      expect(response.error?.message).toContain('aborted')
    })
  })

  describe('getState', () => {
    it('should always return CONNECTED for stateless transport', async () => {
      const { FetchTransport } = await import('../src/transport/fetch')

      const transport = new FetchTransport({
        url: 'https://api.example.com',
        fetch: mockFetch,
      })

      expect(transport.getState()).toBe('CONNECTED')
    })
  })

  describe('close', () => {
    it('should be a no-op for stateless transport', async () => {
      const { FetchTransport } = await import('../src/transport/fetch')

      const transport = new FetchTransport({
        url: 'https://api.example.com',
        fetch: mockFetch,
      })

      await expect(transport.close()).resolves.toBeUndefined()
    })
  })
})

// ============================================================================
// Transport Type Guards Tests
// ============================================================================

describe('Transport type guards', () => {
  it('isCloseable should detect closeable transports', async () => {
    const { FetchTransport } = await import('../src/transport/fetch')
    const { isCloseable } = await import('../src/transport/types')

    const transport = new FetchTransport({ url: 'https://api.example.com' })

    expect(isCloseable(transport)).toBe(true)
  })

  it('isStateful should detect stateful transports', async () => {
    const { FetchTransport } = await import('../src/transport/fetch')
    const { isStateful } = await import('../src/transport/types')

    const transport = new FetchTransport({ url: 'https://api.example.com' })

    expect(isStateful(transport)).toBe(true)
  })

  it('supportsEvents should return false for FetchTransport', async () => {
    const { FetchTransport } = await import('../src/transport/fetch')
    const { supportsEvents } = await import('../src/transport/types')

    const transport = new FetchTransport({ url: 'https://api.example.com' })

    expect(supportsEvents(transport)).toBe(false)
  })
})

// ============================================================================
// generateCorrelationId Tests
// ============================================================================

describe('generateCorrelationId', () => {
  it('should generate unique IDs', async () => {
    const { generateCorrelationId } = await import('../src/transport/fetch')

    const id1 = generateCorrelationId()
    const id2 = generateCorrelationId()

    expect(id1).not.toBe(id2)
  })

  it('should return a string', async () => {
    const { generateCorrelationId } = await import('../src/transport/fetch')

    const id = generateCorrelationId()

    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })
})

// ============================================================================
// createFetchTransport Helper Tests
// ============================================================================

describe('createFetchTransport', () => {
  it('should create a FetchTransport instance', async () => {
    const { createFetchTransport, FetchTransport } = await import('../src/transport/fetch')

    const transport = createFetchTransport({
      url: 'https://api.example.com',
    })

    expect(transport).toBeInstanceOf(FetchTransport)
  })

  it('should pass options to transport', async () => {
    const { createFetchTransport, CORRELATION_ID_HEADER } = await import('../src/transport/fetch')

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: 'test' }),
      headers: new Headers(),
    })

    const transport = createFetchTransport({
      url: 'https://api.example.com',
      correlationId: 'test-id',
      headers: { 'X-Custom': 'value' },
      fetch: mockFetch,
    })

    await transport.send({ method: 'test', args: [] })

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          [CORRELATION_ID_HEADER]: 'test-id',
          'X-Custom': 'value',
        }),
      })
    )
  })
})
