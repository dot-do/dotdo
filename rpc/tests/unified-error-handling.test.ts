import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  type ErrorInterceptor,
  type ErrorContext,
  type SerializedError,
  type ErrorCategory,
} from '../transport/types'
import {
  getErrorCategory,
  createNormalizedError,
  createTimeoutError,
  createNetworkError,
  createTransportErrorFromCatch,
  createErrorContext,
  applyErrorInterceptor,
  createErrorResponse,
  createValidationErrorResponse,
  createServerErrorFromStatus,
  createTransportClosedError,
  createNoTransportError,
  createUnifiedErrorHandler,
} from '../transport/error-utils'
import { FetchTransport } from '../transport/fetch'
import { ErrorCode } from '../errors'

describe('Unified Error Handling', () => {
  describe('getErrorCategory', () => {
    it('should categorize TIMEOUT as timeout', () => {
      expect(getErrorCategory(ErrorCode.TIMEOUT)).toBe('timeout')
    })

    it('should categorize NETWORK_ERROR as network', () => {
      expect(getErrorCategory(ErrorCode.NETWORK_ERROR)).toBe('network')
    })

    it('should categorize SERVICE_UNAVAILABLE as network', () => {
      expect(getErrorCategory(ErrorCode.SERVICE_UNAVAILABLE)).toBe('network')
    })

    it('should categorize VALIDATION_ERROR as validation', () => {
      expect(getErrorCategory(ErrorCode.VALIDATION_ERROR)).toBe('validation')
    })

    it('should categorize CIRCUIT_OPEN as transport', () => {
      expect(getErrorCategory(ErrorCode.CIRCUIT_OPEN)).toBe('transport')
    })

    it('should categorize 5xx errors as server', () => {
      expect(getErrorCategory('UNKNOWN', 500)).toBe('server')
      expect(getErrorCategory('UNKNOWN', 502)).toBe('server')
      expect(getErrorCategory('UNKNOWN', 503)).toBe('server')
    })

    it('should categorize 4xx errors as validation', () => {
      expect(getErrorCategory('UNKNOWN', 400)).toBe('validation')
      expect(getErrorCategory('UNKNOWN', 404)).toBe('validation')
      expect(getErrorCategory('UNKNOWN', 422)).toBe('validation')
    })
  })

  describe('createNormalizedError', () => {
    it('should create error with all fields', () => {
      const error = createNormalizedError({
        type: 'TestError',
        code: 'TEST_CODE',
        message: 'Test message',
        httpStatus: 500,
        details: { foo: 'bar' },
      })

      expect(error.type).toBe('TestError')
      expect(error.name).toBe('TestError')
      expect(error.code).toBe('TEST_CODE')
      expect(error.message).toBe('Test message')
      expect(error.httpStatus).toBe(500)
      expect(error.details).toEqual({ foo: 'bar' })
    })

    it('should omit undefined fields', () => {
      const error = createNormalizedError({
        type: 'TestError',
        code: 'TEST_CODE',
        message: 'Test message',
      })

      expect(error.httpStatus).toBeUndefined()
      expect(error.details).toBeUndefined()
    })
  })

  describe('createTimeoutError', () => {
    it('should create timeout error for fetch transport', () => {
      const error = createTimeoutError(5000, 'fetch')

      expect(error.type).toBe('TimeoutError')
      expect(error.code).toBe(ErrorCode.TIMEOUT)
      expect(error.message).toContain('5000ms')
      expect(error.httpStatus).toBe(504)
      expect(error.details?.transportType).toBe('fetch')
    })

    it('should create timeout error for websocket transport', () => {
      const error = createTimeoutError(3000, 'websocket')

      expect(error.type).toBe('TimeoutError')
      expect(error.details?.transportType).toBe('websocket')
    })

    it('should create timeout error for stub transport', () => {
      const error = createTimeoutError(1000, 'stub')

      expect(error.type).toBe('TimeoutError')
      expect(error.details?.transportType).toBe('stub')
    })
  })

  describe('createNetworkError', () => {
    it('should create network error with transport type', () => {
      const error = createNetworkError('Connection failed', 'fetch')

      expect(error.type).toBe('NetworkError')
      expect(error.code).toBe(ErrorCode.NETWORK_ERROR)
      expect(error.message).toBe('Connection failed')
      expect(error.httpStatus).toBe(503)
      expect(error.details?.transportType).toBe('fetch')
    })

    it('should include additional details', () => {
      const error = createNetworkError('Connection refused', 'websocket', {
        endpoint: 'wss://example.com',
        reason: 'connection_refused',
      })

      expect(error.details?.endpoint).toBe('wss://example.com')
      expect(error.details?.reason).toBe('connection_refused')
      expect(error.details?.transportType).toBe('websocket')
    })
  })

  describe('createTransportErrorFromCatch', () => {
    it('should handle AbortError as timeout', () => {
      const cause = new Error('The operation was aborted')
      cause.name = 'AbortError'

      const error = createTransportErrorFromCatch(cause, 'fetch', 'https://api.example.com')

      expect(error.type).toBe('TimeoutError')
      expect(error.code).toBe(ErrorCode.TIMEOUT)
      expect(error.details?.reason).toBe('timeout')
      expect(error.details?.endpoint).toBe('https://api.example.com')
    })

    it('should handle TimeoutError', () => {
      const cause = new Error('Request timed out')
      cause.name = 'TimeoutError'

      const error = createTransportErrorFromCatch(cause, 'websocket')

      expect(error.type).toBe('TimeoutError')
      expect(error.details?.reason).toBe('timeout')
    })

    it('should handle TypeError from fetch as network error', () => {
      const cause = new TypeError('fetch failed')

      const error = createTransportErrorFromCatch(cause, 'fetch')

      expect(error.type).toBe('NetworkError')
      expect(error.details?.reason).toBe('network_failure')
    })

    it('should handle generic errors', () => {
      const cause = new Error('Unknown error')

      const error = createTransportErrorFromCatch(cause, 'stub')

      expect(error.type).toBe('TransportError')
      expect(error.details?.reason).toBe('unknown')
    })

    it('should handle non-Error values', () => {
      const error = createTransportErrorFromCatch('string error', 'fetch')

      expect(error.type).toBe('TransportError')
      expect(error.message).toContain('string error')
    })
  })

  describe('createErrorContext', () => {
    it('should create context with all fields', () => {
      const error: SerializedError = {
        type: 'NetworkError',
        code: ErrorCode.NETWORK_ERROR,
        message: 'Connection failed',
        httpStatus: 503,
      }

      const context = createErrorContext({
        transportType: 'fetch',
        message: { method: 'test.method', args: [] },
        correlationId: 'test-123',
        error,
        endpoint: 'https://api.example.com',
        attempt: 2,
        startTime: Date.now() - 100,
      })

      expect(context.transportType).toBe('fetch')
      expect(context.message.method).toBe('test.method')
      expect(context.correlationId).toBe('test-123')
      expect(context.category).toBe('network')
      expect(context.retryable).toBe(true)
      expect(context.endpoint).toBe('https://api.example.com')
      expect(context.httpStatus).toBe(503)
      expect(context.attempt).toBe(2)
      expect(context.durationMs).toBeGreaterThanOrEqual(100)
    })

    it('should determine retryable status from error code', () => {
      const networkError: SerializedError = {
        type: 'NetworkError',
        code: ErrorCode.NETWORK_ERROR,
        message: 'Connection failed',
      }
      const networkContext = createErrorContext({
        transportType: 'fetch',
        message: { method: 'test', args: [] },
        correlationId: 'test',
        error: networkError,
      })
      expect(networkContext.retryable).toBe(true)

      const validationError: SerializedError = {
        type: 'ValidationError',
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Invalid input',
      }
      const validationContext = createErrorContext({
        transportType: 'fetch',
        message: { method: 'test', args: [] },
        correlationId: 'test',
        error: validationError,
      })
      expect(validationContext.retryable).toBe(false)
    })
  })

  describe('applyErrorInterceptor', () => {
    it('should return original error when no interceptor', () => {
      const error: SerializedError = {
        type: 'TestError',
        code: 'TEST',
        message: 'Test',
      }

      const result = applyErrorInterceptor(error, {} as ErrorContext, undefined)
      expect(result).toBe(error)
    })

    it('should return transformed error from interceptor', () => {
      const error: SerializedError = {
        type: 'TestError',
        code: 'TEST',
        message: 'Test',
      }

      const interceptor: ErrorInterceptor = (err, ctx) => ({
        ...err,
        details: { transformed: true },
      })

      const result = applyErrorInterceptor(error, {} as ErrorContext, interceptor)
      expect(result.details?.transformed).toBe(true)
    })

    it('should return original error when interceptor returns undefined', () => {
      const error: SerializedError = {
        type: 'TestError',
        code: 'TEST',
        message: 'Test',
      }

      const interceptor: ErrorInterceptor = () => undefined

      const result = applyErrorInterceptor(error, {} as ErrorContext, interceptor)
      expect(result).toBe(error)
    })

    it('should return original error when interceptor throws', () => {
      const error: SerializedError = {
        type: 'TestError',
        code: 'TEST',
        message: 'Test',
      }

      const interceptor: ErrorInterceptor = () => {
        throw new Error('Interceptor error')
      }

      const result = applyErrorInterceptor(error, {} as ErrorContext, interceptor)
      expect(result).toBe(error)
    })
  })

  describe('createServerErrorFromStatus', () => {
    it('should create INTERNAL_ERROR for 5xx status', () => {
      const error = createServerErrorFromStatus(500, 'fetch')

      expect(error.code).toBe(ErrorCode.INTERNAL_ERROR)
      expect(error.httpStatus).toBe(500)
    })

    it('should create VALIDATION_ERROR for 4xx status', () => {
      const error = createServerErrorFromStatus(400, 'stub')

      expect(error.code).toBe(ErrorCode.VALIDATION_ERROR)
      expect(error.httpStatus).toBe(400)
    })

    it('should include transport type in details', () => {
      const error = createServerErrorFromStatus(404, 'websocket')

      expect(error.details?.transportType).toBe('websocket')
    })
  })

  describe('createTransportClosedError', () => {
    it('should create transport closed error', () => {
      const error = createTransportClosedError('fetch')

      expect(error.type).toBe('TransportError')
      expect(error.code).toBe(ErrorCode.NETWORK_ERROR)
      expect(error.message).toBe('Transport has been closed')
      expect(error.httpStatus).toBe(503)
      expect(error.details?.transportType).toBe('fetch')
      expect(error.details?.reason).toBe('closed')
    })
  })

  describe('createNoTransportError', () => {
    it('should create no transport error', () => {
      const error = createNoTransportError('websocket')

      expect(error.type).toBe('TransportError')
      expect(error.code).toBe(ErrorCode.NETWORK_ERROR)
      expect(error.message).toBe('No transport available')
      expect(error.httpStatus).toBe(503)
      expect(error.details?.transportType).toBe('websocket')
      expect(error.details?.reason).toBe('no_transport')
    })
  })

  describe('createUnifiedErrorHandler', () => {
    const testMessage = { method: 'test.method', args: ['arg1', 'arg2'] }

    it('should handle errors from catch blocks', () => {
      const handler = createUnifiedErrorHandler({
        transportType: 'fetch',
        endpoint: 'https://api.example.com',
      })

      const cause = new TypeError('fetch failed')
      const result = handler.fromCatch(cause, testMessage, 'corr-123', Date.now() - 100)

      expect(result.error.type).toBe('NetworkError')
      expect(result.error.code).toBe(ErrorCode.NETWORK_ERROR)
      expect(result.correlationId).toBe('corr-123')
    })

    it('should handle timeout errors', () => {
      const handler = createUnifiedErrorHandler({
        transportType: 'websocket',
      })

      const result = handler.fromTimeout(5000, testMessage, 'corr-456')

      expect(result.error.type).toBe('TimeoutError')
      expect(result.error.code).toBe(ErrorCode.TIMEOUT)
      expect(result.error.message).toContain('5000ms')
      expect(result.correlationId).toBe('corr-456')
    })

    it('should handle network errors', () => {
      const handler = createUnifiedErrorHandler({
        transportType: 'stub',
        endpoint: 'https://do/rpc',
      })

      const result = handler.fromNetworkError(
        'Connection refused',
        testMessage,
        'corr-789',
        { host: 'localhost', port: 8080 }
      )

      expect(result.error.type).toBe('NetworkError')
      expect(result.error.details?.host).toBe('localhost')
      expect(result.error.details?.port).toBe(8080)
    })

    it('should handle validation errors', () => {
      const handler = createUnifiedErrorHandler({
        transportType: 'fetch',
      })

      const result = handler.fromValidationError(
        'Invalid method name',
        testMessage,
        'corr-101'
      )

      expect(result.error.type).toBe('ValidationError')
      expect(result.error.code).toBe(ErrorCode.VALIDATION_ERROR)
    })

    it('should handle HTTP status errors', () => {
      const handler = createUnifiedErrorHandler({
        transportType: 'fetch',
      })

      const result = handler.fromHttpStatus(404, testMessage, 'corr-102', 'Not Found')

      expect(result.error.code).toBe(ErrorCode.VALIDATION_ERROR)
      expect(result.error.httpStatus).toBe(404)
    })

    it('should handle closed transport errors', () => {
      const handler = createUnifiedErrorHandler({
        transportType: 'websocket',
      })

      const result = handler.fromClosed(testMessage, 'corr-103')

      expect(result.error.type).toBe('TransportError')
      expect(result.error.details?.reason).toBe('closed')
    })

    it('should handle no transport errors', () => {
      const handler = createUnifiedErrorHandler({
        transportType: 'fetch',
      })

      const result = handler.fromNoTransport(testMessage, 'corr-104')

      expect(result.error.type).toBe('TransportError')
      expect(result.error.details?.reason).toBe('no_transport')
    })

    it('should call error interceptor when provided', () => {
      const onError = vi.fn((error: SerializedError) => ({
        ...error,
        details: { ...error.details, intercepted: true },
      }))

      const handler = createUnifiedErrorHandler({
        transportType: 'fetch',
        onError,
      })

      const cause = new Error('Test error')
      const result = handler.fromCatch(cause, testMessage, 'corr-105')

      expect(onError).toHaveBeenCalled()
      expect(result.error.details?.intercepted).toBe(true)
    })

    it('should handle serialized errors from server response', () => {
      const handler = createUnifiedErrorHandler({
        transportType: 'fetch',
        endpoint: 'https://api.example.com',
      })

      const serverError: SerializedError = {
        type: 'NotFoundError',
        code: ErrorCode.NOT_FOUND,
        message: 'User not found',
        httpStatus: 404,
      }

      const result = handler.fromSerializedError(serverError, testMessage, 'corr-106')

      expect(result.error.type).toBe('NotFoundError')
      expect(result.error.code).toBe(ErrorCode.NOT_FOUND)
      expect(result.correlationId).toBe('corr-106')
    })

    it('should include duration in context when startTime provided', () => {
      const onError = vi.fn()
      const handler = createUnifiedErrorHandler({
        transportType: 'fetch',
        onError,
      })

      const cause = new Error('Test error')
      handler.fromCatch(cause, testMessage, 'corr-107', Date.now() - 100)

      expect(onError).toHaveBeenCalled()
      const [, context] = onError.mock.calls[0]
      expect(context.durationMs).toBeDefined()
      expect(context.durationMs).toBeGreaterThanOrEqual(100)
    })
  })
})

describe('Error Interceptor Integration', () => {
  describe('AutoTransport', () => {
    it('should return normalized error when closed', async () => {
      // Import AutoTransport dynamically to avoid issues with global WebSocket
      const { AutoTransport } = await import('../transport/auto')

      const transport = new AutoTransport({
        url: 'https://api.example.com',
        strategy: 'fetch-only',
        fetch: vi.fn().mockResolvedValue(new Response('{}', { status: 200 })),
      })

      await transport.close()

      const response = await transport.send({ method: 'test', args: [] })

      expect(response.error).toBeDefined()
      expect(response.error?.type).toBe('TransportError')
      expect(response.error?.code).toBe(ErrorCode.NETWORK_ERROR)
      expect(response.error?.details?.reason).toBe('closed')
      expect(response.correlationId).toBeDefined()
    })

    it('should pass onError interceptor to underlying transports', async () => {
      const { AutoTransport } = await import('../transport/auto')

      const onError = vi.fn()
      const mockFetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'))

      const transport = new AutoTransport({
        url: 'https://api.example.com',
        strategy: 'fetch-only',
        fetch: mockFetch,
        onError,
      })

      await transport.send({ method: 'test', args: [] })

      expect(onError).toHaveBeenCalledTimes(1)
      const [error, context] = onError.mock.calls[0]
      expect(error.type).toBe('NetworkError')
      expect(context.transportType).toBe('fetch')
    })
  })

  describe('FetchTransport', () => {
    it('should call onError interceptor when fetch fails', async () => {
      const onError = vi.fn()
      const mockFetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'))

      const transport = new FetchTransport({
        url: 'https://api.example.com',
        fetch: mockFetch,
        onError,
      })

      await transport.send({ method: 'test', args: [] })

      expect(onError).toHaveBeenCalledTimes(1)
      const [error, context] = onError.mock.calls[0]
      expect(error.type).toBe('NetworkError')
      expect(context.transportType).toBe('fetch')
      expect(context.category).toBe('network')
      expect(context.endpoint).toBe('https://api.example.com')
    })

    it('should call onError interceptor for server errors', async () => {
      const onError = vi.fn()
      const mockResponse = new Response(JSON.stringify({
        type: 'NotFoundError',
        code: 'NOT_FOUND',
        message: 'Resource not found',
        httpStatus: 404,
      }), { status: 404 })
      const mockFetch = vi.fn().mockResolvedValue(mockResponse)

      const transport = new FetchTransport({
        url: 'https://api.example.com',
        fetch: mockFetch,
        onError,
      })

      await transport.send({ method: 'test', args: [] })

      expect(onError).toHaveBeenCalledTimes(1)
      const [error, context] = onError.mock.calls[0]
      expect(error.code).toBe('NOT_FOUND')
      expect(context.httpStatus).toBe(404)
    })

    it('should use transformed error from interceptor', async () => {
      const onError: ErrorInterceptor = (error) => ({
        ...error,
        details: { ...error.details, intercepted: true },
      })
      const mockFetch = vi.fn().mockRejectedValue(new TypeError('fetch failed'))

      const transport = new FetchTransport({
        url: 'https://api.example.com',
        fetch: mockFetch,
        onError,
      })

      const response = await transport.send({ method: 'test', args: [] })

      expect(response.error?.details?.intercepted).toBe(true)
    })

    it('should include durationMs in context', async () => {
      const onError = vi.fn()
      const delayMs = 20
      const mockFetch = vi.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, delayMs))
        throw new Error('Network error')
      })

      const transport = new FetchTransport({
        url: 'https://api.example.com',
        fetch: mockFetch,
        onError,
      })

      await transport.send({ method: 'test', args: [] })

      const [, context] = onError.mock.calls[0]
      // Just verify durationMs exists and is a positive number
      expect(context.durationMs).toBeDefined()
      expect(context.durationMs).toBeGreaterThanOrEqual(0)
    })
  })

  // Note: WebSocketTransport error interceptor tests are complex due to connection lifecycle.
  // The core error handling utilities are tested above, and the FetchTransport tests verify
  // the interceptor integration pattern works correctly. WebSocket-specific error handling
  // is tested in the existing transport.test.ts file.
})

describe('Error Consistency Across Transports', () => {
  it('should create same error structure for timeouts', () => {
    const fetchTimeout = createTimeoutError(5000, 'fetch')
    const wsTimeout = createTimeoutError(5000, 'websocket')
    const stubTimeout = createTimeoutError(5000, 'stub')

    // All should have same structure, just different transportType in details
    expect(fetchTimeout.type).toBe(wsTimeout.type)
    expect(wsTimeout.type).toBe(stubTimeout.type)
    expect(fetchTimeout.type).toBe('TimeoutError')

    expect(fetchTimeout.code).toBe(wsTimeout.code)
    expect(wsTimeout.code).toBe(stubTimeout.code)
    expect(fetchTimeout.code).toBe(ErrorCode.TIMEOUT)

    expect(fetchTimeout.httpStatus).toBe(wsTimeout.httpStatus)
    expect(wsTimeout.httpStatus).toBe(stubTimeout.httpStatus)
    expect(fetchTimeout.httpStatus).toBe(504)

    expect(fetchTimeout.details?.transportType).toBe('fetch')
    expect(wsTimeout.details?.transportType).toBe('websocket')
    expect(stubTimeout.details?.transportType).toBe('stub')
  })

  it('should create same error structure for network errors', () => {
    const fetchNetwork = createNetworkError('Connection failed', 'fetch')
    const wsNetwork = createNetworkError('Connection failed', 'websocket')
    const stubNetwork = createNetworkError('Connection failed', 'stub')

    expect(fetchNetwork.type).toBe(wsNetwork.type)
    expect(wsNetwork.type).toBe(stubNetwork.type)
    expect(fetchNetwork.type).toBe('NetworkError')

    expect(fetchNetwork.code).toBe(wsNetwork.code)
    expect(wsNetwork.code).toBe(stubNetwork.code)
    expect(fetchNetwork.code).toBe(ErrorCode.NETWORK_ERROR)

    expect(fetchNetwork.httpStatus).toBe(wsNetwork.httpStatus)
    expect(wsNetwork.httpStatus).toBe(stubNetwork.httpStatus)
    expect(fetchNetwork.httpStatus).toBe(503)
  })

  it('should create same error structure for server errors', () => {
    const fetch500 = createServerErrorFromStatus(500, 'fetch')
    const ws500 = createServerErrorFromStatus(500, 'websocket')
    const stub500 = createServerErrorFromStatus(500, 'stub')

    expect(fetch500.type).toBe(ws500.type)
    expect(ws500.type).toBe(stub500.type)

    expect(fetch500.code).toBe(ws500.code)
    expect(ws500.code).toBe(stub500.code)
    expect(fetch500.code).toBe(ErrorCode.INTERNAL_ERROR)
  })

  it('should categorize errors consistently', () => {
    const timeoutError = createTimeoutError(5000, 'fetch')
    const networkError = createNetworkError('Failed', 'websocket')
    const serverError = createServerErrorFromStatus(500, 'stub')
    const validationError = createValidationErrorResponse('Invalid input', 'test')

    const timeoutCtx = createErrorContext({
      transportType: 'fetch',
      message: { method: 'test', args: [] },
      correlationId: 'test',
      error: timeoutError,
    })

    const networkCtx = createErrorContext({
      transportType: 'websocket',
      message: { method: 'test', args: [] },
      correlationId: 'test',
      error: networkError,
    })

    const serverCtx = createErrorContext({
      transportType: 'stub',
      message: { method: 'test', args: [] },
      correlationId: 'test',
      error: serverError,
    })

    const validationCtx = createErrorContext({
      transportType: 'fetch',
      message: { method: 'test', args: [] },
      correlationId: 'test',
      error: validationError,
    })

    expect(timeoutCtx.category).toBe('timeout')
    expect(networkCtx.category).toBe('network')
    expect(serverCtx.category).toBe('server')
    expect(validationCtx.category).toBe('validation')
  })
})
