/**
 * Body Size Limit Tests
 *
 * Tests for request body size validation middleware.
 *
 * Coverage:
 * - Content-Length validation (fast path)
 * - Proper 413 Payload Too Large responses
 * - Skip paths configuration
 * - Skip methods configuration
 * - Per-method limits
 * - Middleware integration
 * - Configuration validation
 *
 * @module api/tests/body-size-limit.test
 * @issue do-23wa - Add request size limits
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import {
  BodySizeValidator,
  bodySizeLimitMiddleware,
  createBodySizeValidator,
  DEFAULT_MAX_BODY_SIZE,
  MAX_ALLOWED_BODY_SIZE,
  type BodySizeLimitConfig,
} from '../middleware/body-size-limit'
import { PayloadTooLargeError, isPayloadTooLargeError, RPCErrorCode } from '@dotdo/rpc'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create a mock HTTP request with configurable body
 */
function createMockRequest(options: {
  method?: string
  path?: string
  body?: string | Uint8Array
  contentLength?: number | string
  chunked?: boolean
  headers?: Record<string, string>
}): Request {
  const {
    method = 'POST',
    path = '/api/data',
    body,
    contentLength,
    chunked = false,
    headers = {},
  } = options

  const url = `https://api.dotdo.dev${path}`

  const requestHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    ...headers,
  }

  // Set Content-Length if provided or calculate from body
  if (contentLength !== undefined) {
    requestHeaders['Content-Length'] = String(contentLength)
  } else if (body && !chunked) {
    const bodyLength = typeof body === 'string' ? new TextEncoder().encode(body).length : body.length
    requestHeaders['Content-Length'] = String(bodyLength)
  }

  // Set Transfer-Encoding for chunked
  if (chunked) {
    requestHeaders['Transfer-Encoding'] = 'chunked'
    delete requestHeaders['Content-Length']
  }

  return new Request(url, {
    method,
    headers: new Headers(requestHeaders),
    body: body,
  })
}

/**
 * Create a Hono app with body size limit middleware for testing
 */
function createTestApp(config: BodySizeLimitConfig = {}) {
  const app = new Hono()

  app.use('*', bodySizeLimitMiddleware(config))

  app.post('/api/data', async (c) => {
    const body = await c.req.text()
    return c.json({ message: 'ok', length: body.length })
  })

  app.put('/api/data', async (c) => {
    const body = await c.req.text()
    return c.json({ message: 'ok', length: body.length })
  })

  app.get('/api/data', (c) => c.json({ message: 'ok' }))
  app.get('/health', (c) => c.json({ status: 'healthy' }))

  return app
}

// ============================================================================
// TESTS: MODULE EXPORTS
// ============================================================================

describe('Body Size Limit Module Exports', () => {
  it('should export BodySizeValidator class', () => {
    expect(BodySizeValidator).toBeDefined()
    expect(typeof BodySizeValidator).toBe('function')
  })

  it('should export bodySizeLimitMiddleware function', () => {
    expect(bodySizeLimitMiddleware).toBeDefined()
    expect(typeof bodySizeLimitMiddleware).toBe('function')
  })

  it('should export createBodySizeValidator factory', () => {
    expect(createBodySizeValidator).toBeDefined()
    expect(typeof createBodySizeValidator).toBe('function')
  })

  it('should export DEFAULT_MAX_BODY_SIZE constant', () => {
    expect(DEFAULT_MAX_BODY_SIZE).toBeDefined()
    expect(DEFAULT_MAX_BODY_SIZE).toBe(1024 * 1024) // 1 MB
  })

  it('should export MAX_ALLOWED_BODY_SIZE constant', () => {
    expect(MAX_ALLOWED_BODY_SIZE).toBeDefined()
    expect(MAX_ALLOWED_BODY_SIZE).toBe(100 * 1024 * 1024) // 100 MB
  })
})

// ============================================================================
// TESTS: PayloadTooLargeError
// ============================================================================

describe('PayloadTooLargeError', () => {
  it('should create error with default message', () => {
    const error = new PayloadTooLargeError()
    expect(error.message).toBe('Request payload too large')
    expect(error.code).toBe(RPCErrorCode.PAYLOAD_TOO_LARGE)
    expect(error.httpStatus).toBe(413)
  })

  it('should create error with custom message', () => {
    const error = new PayloadTooLargeError('Custom message', { custom: 'detail' })
    expect(error.message).toBe('Custom message')
    expect(error.details).toEqual({ custom: 'detail' })
  })

  it('should create error with exceeded() factory', () => {
    const error = PayloadTooLargeError.exceeded({
      size: 2000000,
      maxSize: 1000000,
      unit: 'bytes',
    })
    expect(error.message).toContain('2000000')
    expect(error.message).toContain('1000000')
    expect(error.details?.size).toBe(2000000)
    expect(error.details?.maxSize).toBe(1000000)
  })

  it('should create error with exceededReadable() factory', () => {
    const error = PayloadTooLargeError.exceededReadable({
      sizeBytes: 2 * 1024 * 1024, // 2 MB
      maxSizeBytes: 1 * 1024 * 1024, // 1 MB
    })
    expect(error.message).toContain('2.00 MB')
    expect(error.message).toContain('1.00 MB')
    expect(error.details?.sizeBytes).toBe(2 * 1024 * 1024)
    expect(error.details?.maxSizeBytes).toBe(1 * 1024 * 1024)
  })

  it('should be detectable with type guard', () => {
    const error = new PayloadTooLargeError()
    expect(isPayloadTooLargeError(error)).toBe(true)
    expect(isPayloadTooLargeError(new Error())).toBe(false)
  })

  it('should serialize to JSON correctly', () => {
    const error = PayloadTooLargeError.exceeded({
      size: 2000,
      maxSize: 1000,
    })
    const json = error.toJSON()
    expect(json.type).toBe('PayloadTooLargeError')
    expect(json.code).toBe(RPCErrorCode.PAYLOAD_TOO_LARGE)
    expect(json.httpStatus).toBe(413)
    expect(json.details).toBeDefined()
  })
})

// ============================================================================
// TESTS: VALIDATOR CONFIGURATION
// ============================================================================

describe('BodySizeValidator Configuration', () => {
  it('should use default max size if not specified', () => {
    const validator = new BodySizeValidator()
    const request = createMockRequest({ body: 'test' })
    const maxSize = validator.getMaxSizeForRequest(request)
    expect(maxSize).toBe(DEFAULT_MAX_BODY_SIZE)
  })

  it('should use custom max size', () => {
    const customSize = 5 * 1024 * 1024 // 5 MB
    const validator = new BodySizeValidator({ maxSize: customSize })
    const request = createMockRequest({ body: 'test' })
    const maxSize = validator.getMaxSizeForRequest(request)
    expect(maxSize).toBe(customSize)
  })

  it('should throw on zero max size', () => {
    expect(() => {
      new BodySizeValidator({ maxSize: 0 })
    }).toThrow('maxSize must be positive')
  })

  it('should throw on negative max size', () => {
    expect(() => {
      new BodySizeValidator({ maxSize: -1 })
    }).toThrow('maxSize must be positive')
  })

  it('should throw on exceeding max allowed size', () => {
    expect(() => {
      new BodySizeValidator({ maxSize: MAX_ALLOWED_BODY_SIZE + 1 })
    }).toThrow('maxSize cannot exceed')
  })

  it('should apply per-method limits', () => {
    const validator = new BodySizeValidator({
      maxSize: 1024,
      methodLimits: {
        POST: 2048,
        PUT: 4096,
      },
    })

    const postRequest = createMockRequest({ method: 'POST', body: 'test' })
    const putRequest = createMockRequest({ method: 'PUT', body: 'test' })
    const patchRequest = createMockRequest({ method: 'PATCH', body: 'test' })

    expect(validator.getMaxSizeForRequest(postRequest)).toBe(2048)
    expect(validator.getMaxSizeForRequest(putRequest)).toBe(4096)
    expect(validator.getMaxSizeForRequest(patchRequest)).toBe(1024) // default
  })
})

// ============================================================================
// TESTS: SHOULD VALIDATE
// ============================================================================

describe('BodySizeValidator shouldValidate', () => {
  let validator: BodySizeValidator

  beforeEach(() => {
    validator = new BodySizeValidator()
  })

  it('should skip GET requests by default', () => {
    const request = createMockRequest({ method: 'GET' })
    expect(validator.shouldValidate(request)).toBe(false)
  })

  it('should skip HEAD requests by default', () => {
    const request = createMockRequest({ method: 'HEAD' })
    expect(validator.shouldValidate(request)).toBe(false)
  })

  it('should skip OPTIONS requests by default', () => {
    const request = createMockRequest({ method: 'OPTIONS' })
    expect(validator.shouldValidate(request)).toBe(false)
  })

  it('should validate POST requests with body', () => {
    const request = createMockRequest({ method: 'POST', body: '{"data": "test"}' })
    expect(validator.shouldValidate(request)).toBe(true)
  })

  it('should validate PUT requests with body', () => {
    const request = createMockRequest({ method: 'PUT', body: '{"data": "test"}' })
    expect(validator.shouldValidate(request)).toBe(true)
  })

  it('should validate PATCH requests with body', () => {
    const request = createMockRequest({ method: 'PATCH', body: '{"data": "test"}' })
    expect(validator.shouldValidate(request)).toBe(true)
  })

  it('should skip requests without body indicators', () => {
    const request = new Request('https://api.dotdo.dev/api/data', {
      method: 'POST',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      // No body, no Content-Length, no Transfer-Encoding
    })
    expect(validator.shouldValidate(request)).toBe(false)
  })

  it('should skip configured paths', () => {
    const validatorWithSkip = new BodySizeValidator({
      skipPaths: ['/health', '/metrics'],
    })

    const healthRequest = createMockRequest({ method: 'POST', path: '/health', body: 'test' })
    const metricsRequest = createMockRequest({ method: 'POST', path: '/metrics/push', body: 'test' })
    const apiRequest = createMockRequest({ method: 'POST', path: '/api/data', body: 'test' })

    expect(validatorWithSkip.shouldValidate(healthRequest)).toBe(false)
    expect(validatorWithSkip.shouldValidate(metricsRequest)).toBe(false) // prefix match
    expect(validatorWithSkip.shouldValidate(apiRequest)).toBe(true)
  })

  it('should respect custom skip methods', () => {
    const validatorWithSkip = new BodySizeValidator({
      skipMethods: ['GET', 'DELETE'], // DELETE added, HEAD/OPTIONS removed
    })

    const getRequest = createMockRequest({ method: 'GET' })
    const deleteRequest = createMockRequest({ method: 'DELETE', body: 'test' })
    const headRequest = createMockRequest({ method: 'HEAD', contentLength: 100 })

    expect(validatorWithSkip.shouldValidate(getRequest)).toBe(false)
    expect(validatorWithSkip.shouldValidate(deleteRequest)).toBe(false)
    expect(validatorWithSkip.shouldValidate(headRequest)).toBe(true) // Not in skip list
  })
})

// ============================================================================
// TESTS: CONTENT-LENGTH VALIDATION
// ============================================================================

describe('BodySizeValidator Content-Length Validation', () => {
  let validator: BodySizeValidator

  beforeEach(() => {
    validator = new BodySizeValidator({ maxSize: 1024 }) // 1 KB limit
  })

  it('should allow requests under the limit', () => {
    const request = createMockRequest({
      method: 'POST',
      body: 'a'.repeat(500), // 500 bytes
    })
    const result = validator.validateContentLength(request)

    expect(result.valid).toBe(true)
    expect(result.size).toBe(500)
    expect(result.isChunked).toBe(false)
    expect(result.error).toBeUndefined()
  })

  it('should allow requests exactly at the limit', () => {
    const request = createMockRequest({
      method: 'POST',
      body: 'a'.repeat(1024), // exactly 1 KB
    })
    const result = validator.validateContentLength(request)

    expect(result.valid).toBe(true)
    expect(result.size).toBe(1024)
  })

  it('should reject requests over the limit', () => {
    const request = createMockRequest({
      method: 'POST',
      body: 'a'.repeat(2000), // 2000 bytes > 1024
    })
    const result = validator.validateContentLength(request)

    expect(result.valid).toBe(false)
    expect(result.size).toBe(2000)
    expect(result.error).toBeInstanceOf(PayloadTooLargeError)
    expect(result.error?.httpStatus).toBe(413)
  })

  it('should handle chunked encoding (no Content-Length)', () => {
    const request = createMockRequest({
      method: 'POST',
      body: 'test',
      chunked: true,
    })
    const result = validator.validateContentLength(request)

    expect(result.valid).toBe(true)
    expect(result.isChunked).toBe(true)
    expect(result.size).toBeUndefined()
  })

  it('should handle invalid Content-Length header', () => {
    const request = createMockRequest({
      method: 'POST',
      body: 'test',
      contentLength: 'invalid',
    })
    const result = validator.validateContentLength(request)

    expect(result.valid).toBe(true) // Gracefully handle invalid header
    expect(result.isChunked).toBe(false)
  })
})

// ============================================================================
// TESTS: MIDDLEWARE INTEGRATION
// ============================================================================

describe('Body Size Limit Middleware Integration', () => {
  it('should allow requests under the limit', async () => {
    const app = createTestApp({ maxSize: 1024 })

    const res = await app.fetch(
      createMockRequest({
        method: 'POST',
        path: '/api/data',
        body: JSON.stringify({ data: 'small' }),
      })
    )

    expect(res.status).toBe(200)
    const body = await res.json() as { message: string }
    expect(body.message).toBe('ok')
  })

  it('should reject requests over the limit with 413', async () => {
    const app = createTestApp({ maxSize: 100 }) // 100 bytes limit

    const res = await app.fetch(
      createMockRequest({
        method: 'POST',
        path: '/api/data',
        body: 'a'.repeat(200), // 200 bytes > 100
      })
    )

    expect(res.status).toBe(413)
    const body = await res.json() as { code: string; message: string }
    expect(body.code).toBe(RPCErrorCode.PAYLOAD_TOO_LARGE)
    expect(body.message).toContain('exceeds maximum')
  })

  it('should skip validation for GET requests', async () => {
    const app = createTestApp({ maxSize: 10 }) // Very small limit

    const res = await app.fetch(
      createMockRequest({
        method: 'GET',
        path: '/api/data',
      })
    )

    expect(res.status).toBe(200)
  })

  it('should skip validation for configured paths', async () => {
    const app = createTestApp({
      maxSize: 10, // Very small limit
      skipPaths: ['/health'],
    })

    const res = await app.fetch(
      createMockRequest({
        method: 'GET',
        path: '/health',
      })
    )

    expect(res.status).toBe(200)
  })

  it('should apply per-method limits', async () => {
    const app = createTestApp({
      maxSize: 100,
      methodLimits: {
        POST: 50,  // Smaller limit for POST
        PUT: 200,  // Larger limit for PUT
      },
    })

    // POST with 75 bytes should fail (limit is 50)
    const postRes = await app.fetch(
      createMockRequest({
        method: 'POST',
        path: '/api/data',
        body: 'a'.repeat(75),
      })
    )
    expect(postRes.status).toBe(413)

    // PUT with 150 bytes should succeed (limit is 200)
    const putRes = await app.fetch(
      createMockRequest({
        method: 'PUT',
        path: '/api/data',
        body: 'a'.repeat(150),
      })
    )
    expect(putRes.status).toBe(200)
  })
})

// ============================================================================
// TESTS: 413 RESPONSE FORMAT
// ============================================================================

describe('413 Response Format', () => {
  it('should return proper JSON error response', async () => {
    const app = createTestApp({ maxSize: 100 })

    const res = await app.fetch(
      createMockRequest({
        method: 'POST',
        path: '/api/data',
        body: 'a'.repeat(200),
      })
    )

    expect(res.status).toBe(413)
    expect(res.headers.get('Content-Type')).toContain('application/json')

    const body = await res.json() as {
      type: string
      code: string
      message: string
      httpStatus: number
      details?: { sizeBytes: number; maxSizeBytes: number }
    }

    expect(body.type).toBe('PayloadTooLargeError')
    expect(body.code).toBe(RPCErrorCode.PAYLOAD_TOO_LARGE)
    expect(body.httpStatus).toBe(413)
    expect(body.message).toContain('exceeds maximum')
    expect(body.details).toBeDefined()
    expect(body.details?.sizeBytes).toBe(200)
    expect(body.details?.maxSizeBytes).toBe(100)
  })

  it('should include human-readable size information', async () => {
    const app = createTestApp({ maxSize: 1024 * 1024 }) // 1 MB

    const res = await app.fetch(
      createMockRequest({
        method: 'POST',
        path: '/api/data',
        body: 'a'.repeat(2 * 1024 * 1024), // 2 MB
        contentLength: 2 * 1024 * 1024, // Override Content-Length
      })
    )

    expect(res.status).toBe(413)
    const body = await res.json() as { message: string }
    expect(body.message).toContain('MB')
  })
})

// ============================================================================
// TESTS: EDGE CASES
// ============================================================================

describe('Edge Cases', () => {
  it('should handle empty body', async () => {
    const app = createTestApp({ maxSize: 100 })

    const res = await app.fetch(
      createMockRequest({
        method: 'POST',
        path: '/api/data',
        body: '',
      })
    )

    expect(res.status).toBe(200)
  })

  it('should handle missing Content-Type header', async () => {
    const app = createTestApp({ maxSize: 100 })

    const request = new Request('https://api.dotdo.dev/api/data', {
      method: 'POST',
      headers: new Headers({
        'Content-Length': '50',
      }),
      body: 'a'.repeat(50),
    })

    const res = await app.fetch(request)
    expect(res.status).toBe(200)
  })

  it('should handle very large Content-Length header', async () => {
    const app = createTestApp({ maxSize: 1024 })

    const request = new Request('https://api.dotdo.dev/api/data', {
      method: 'POST',
      headers: new Headers({
        'Content-Type': 'application/json',
        'Content-Length': '9999999999999', // Very large
      }),
      body: 'small body',
    })

    const res = await app.fetch(request)
    expect(res.status).toBe(413) // Should reject based on Content-Length
  })

  it('should create middleware with default config', () => {
    const middleware = bodySizeLimitMiddleware()
    expect(middleware).toBeDefined()
    expect(typeof middleware).toBe('function')
  })

  it('should create validator with default config', () => {
    const validator = createBodySizeValidator()
    expect(validator).toBeDefined()
    expect(validator).toBeInstanceOf(BodySizeValidator)
  })
})

// ============================================================================
// TESTS: STREAMING VALIDATION
// ============================================================================

describe('Streaming Body Validation', () => {
  it('should create validating stream', () => {
    const validator = new BodySizeValidator({ maxSize: 1024 })

    // Create a simple stream
    const data = new TextEncoder().encode('test data')
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(data)
        controller.close()
      },
    })

    const { stream: validatingStream, getSize } = validator.createValidatingStream(stream, 1024)

    expect(validatingStream).toBeInstanceOf(ReadableStream)
    expect(typeof getSize).toBe('function')
    expect(getSize()).toBe(0) // No bytes read yet
  })

  it('should track bytes consumed through stream', async () => {
    const validator = new BodySizeValidator({ maxSize: 1024 })

    const data = new TextEncoder().encode('test data that is longer')
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(data)
        controller.close()
      },
    })

    const { stream: validatingStream, getSize } = validator.createValidatingStream(stream, 1024)

    // Consume the stream
    const reader = validatingStream.getReader()
    await reader.read()

    expect(getSize()).toBe(data.length)
  })
})
