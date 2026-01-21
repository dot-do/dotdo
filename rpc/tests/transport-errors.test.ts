import { describe, it, expect, vi } from 'vitest'
import {
  TransportError,
  isTransportError,
  isRetryableError,
  RPCErrorCode,
  serializeError,
  deserializeError,
} from '../errors'
import { FetchTransport } from '../transport/fetch'

describe('TransportError', () => {
  it('should create a transport error with NETWORK_ERROR code', () => {
    const error = new TransportError('Connection failed')

    expect(error).toBeInstanceOf(TransportError)
    expect(error.code).toBe(RPCErrorCode.NETWORK_ERROR)
    expect(error.message).toBe('Connection failed')
    expect(error.name).toBe('TransportError')
    expect(error.httpStatus).toBe(503)
  })

  it('should create error with details', () => {
    const error = new TransportError('Transport failed', {
      transport: 'fetch',
      reason: 'network_failure',
    })

    expect(error.details).toEqual({
      transport: 'fetch',
      reason: 'network_failure',
    })
  })

  it('should be detected by isTransportError type guard', () => {
    const transportError = new TransportError('Transport failed')
    const otherError = new Error('Other error')

    expect(isTransportError(transportError)).toBe(true)
    expect(isTransportError(otherError)).toBe(false)
  })

  it('should be retryable', () => {
    const error = new TransportError('Network failed')
    expect(isRetryableError(error)).toBe(true)
  })

  describe('TransportError.fromError', () => {
    it('should wrap a generic Error', () => {
      const cause = new Error('Connection refused')
      const error = TransportError.fromError(cause, 'test-transport')

      expect(error).toBeInstanceOf(TransportError)
      expect(error.message).toContain('Connection refused')
      expect(error.details?.transport).toBe('test-transport')
      expect(error.details?.reason).toBe('unknown')
    })

    it('should handle AbortError as timeout', () => {
      const cause = new Error('The operation was aborted')
      cause.name = 'AbortError'
      const error = TransportError.fromError(cause)

      expect(error.message).toContain('timeout')
      expect(error.details?.reason).toBe('timeout')
    })

    it('should handle TimeoutError', () => {
      const cause = new Error('Request timed out')
      cause.name = 'TimeoutError'
      const error = TransportError.fromError(cause)

      expect(error.message).toContain('timeout')
      expect(error.details?.reason).toBe('timeout')
    })

    it('should handle TypeError from fetch', () => {
      const cause = new TypeError('fetch failed')
      const error = TransportError.fromError(cause)

      expect(error.message).toContain('Network error')
      expect(error.details?.reason).toBe('network_failure')
    })

    it('should handle non-Error values', () => {
      const error = TransportError.fromError('string error')

      expect(error).toBeInstanceOf(TransportError)
      expect(error.message).toContain('string error')
    })
  })

  describe('TransportError.fetchFailed', () => {
    it('should create error for fetch failure', () => {
      const cause = new Error('Network unreachable')
      const error = TransportError.fetchFailed('https://api.example.com', cause)

      expect(error).toBeInstanceOf(TransportError)
      expect(error.details?.transport).toBe('fetch:https://api.example.com')
    })
  })

  describe('TransportError.stubFailed', () => {
    it('should create error for DO stub failure', () => {
      const cause = new Error('Stub fetch failed')
      const error = TransportError.stubFailed(cause)

      expect(error).toBeInstanceOf(TransportError)
      expect(error.details?.transport).toBe('do-stub')
    })
  })

  describe('TransportError.webSocketFailed', () => {
    it('should create error for WebSocket failure', () => {
      const cause = new Error('WebSocket connection failed')
      const error = TransportError.webSocketFailed('wss://api.example.com', cause)

      expect(error).toBeInstanceOf(TransportError)
      expect(error.details?.transport).toBe('websocket:wss://api.example.com')
    })
  })

  it('should serialize and deserialize correctly', () => {
    const original = new TransportError('Transport failed', {
      transport: 'fetch',
      reason: 'timeout',
    })

    const serialized = serializeError(original)
    const deserialized = deserializeError(serialized)

    expect(deserialized).toBeInstanceOf(TransportError)
    expect(deserialized.code).toBe(RPCErrorCode.NETWORK_ERROR)
    expect(deserialized.message).toBe('Transport failed')
    expect(deserialized.details).toEqual({ transport: 'fetch', reason: 'timeout' })
  })
})

describe('FetchTransport error handling', () => {
  it('should return error response when fetch throws', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'))

    const transport = new FetchTransport({
      url: 'https://api.example.com',
      fetch: mockFetch,
    })

    const response = await transport.send({
      method: 'test.method',
      args: [],
    })

    expect(response.error).toBeDefined()
    expect(response.error?.code).toBe(RPCErrorCode.NETWORK_ERROR)
    expect(response.error?.type).toBe('TransportError')
    expect(response.error?.message).toContain('Network error')
    expect(response.correlationId).toBeDefined()
  })

  it('should return error response on timeout', async () => {
    const abortError = new Error('The operation was aborted')
    abortError.name = 'AbortError'
    const mockFetch = vi.fn().mockRejectedValue(abortError)

    const transport = new FetchTransport({
      url: 'https://api.example.com',
      fetch: mockFetch,
      timeout: 1000,
    })

    const response = await transport.send({
      method: 'test.method',
      args: [],
    })

    expect(response.error).toBeDefined()
    expect(response.error?.code).toBe(RPCErrorCode.NETWORK_ERROR)
    expect(response.error?.message).toContain('timeout')
  })

  it('should include transport details in error', async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error('DNS resolution failed'))

    const transport = new FetchTransport({
      url: 'https://api.example.com',
      fetch: mockFetch,
    })

    const response = await transport.send({
      method: 'test.method',
      args: [],
    })

    expect(response.error?.details?.transport).toContain('fetch:https://api.example.com')
  })

  it('should still handle HTTP errors correctly', async () => {
    // SerializedError format requires 'type' field
    const mockResponse = new Response(JSON.stringify({
      type: 'NotFoundError',
      code: 'NOT_FOUND',
      message: 'Resource not found',
    }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
    const mockFetch = vi.fn().mockResolvedValue(mockResponse)

    const transport = new FetchTransport({
      url: 'https://api.example.com',
      fetch: mockFetch,
    })

    const response = await transport.send({
      method: 'test.method',
      args: [],
    })

    expect(response.error).toBeDefined()
    expect(response.error?.code).toBe('NOT_FOUND')
  })

  it('should handle successful responses', async () => {
    const mockResponse = new Response(JSON.stringify({ result: 'success' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
    const mockFetch = vi.fn().mockResolvedValue(mockResponse)

    const transport = new FetchTransport({
      url: 'https://api.example.com',
      fetch: mockFetch,
    })

    const response = await transport.send({
      method: 'test.method',
      args: [],
    })

    expect(response.error).toBeUndefined()
    expect(response.result).toEqual({ result: 'success' })
  })
})
