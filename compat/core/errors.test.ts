/**
 * @dotdo/compat/core/errors.test.ts - Unified Error Format Tests
 *
 * TDD RED phase: These tests define the expected unified error handling
 * interface for all compat SDKs. Currently FAILING as the implementation
 * does not exist yet.
 *
 * Problem: Code review found 4+ different error formats across SDKs:
 * - S3: $fault, $metadata.httpStatusCode
 * - Stripe: statusCode, type, requestId, raw
 * - OpenAI: status, type, code, requestId
 * - SendGrid: statusCode, errors[]
 *
 * Solution: CompatError unified interface with consistent fields and
 * automatic mapping from SDK-specific error formats.
 */

import { describe, test, expect } from 'vitest'

// Import the unified error types (these don't exist yet - tests will FAIL)
import {
  CompatError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  RateLimitError,
  ServiceError,
  isCompatError,
  wrapError,
  toResponse,
  fromStripeError,
  fromOpenAIError,
  fromAWSError,
} from './errors'

// =============================================================================
// Error Structure Tests
// =============================================================================

describe('CompatError Structure', () => {
  test('CompatError has code, message, cause', () => {
    const cause = new Error('underlying issue')
    const error = new CompatError({
      code: 'INVALID_INPUT',
      message: 'The input was invalid',
      cause,
    })

    expect(error.code).toBe('INVALID_INPUT')
    expect(error.message).toBe('The input was invalid')
    expect(error.cause).toBe(cause)
    expect(error).toBeInstanceOf(Error)
  })

  test('CompatError has statusCode mapping', () => {
    const error = new CompatError({
      code: 'NOT_FOUND',
      message: 'Resource not found',
      statusCode: 404,
    })

    expect(error.statusCode).toBe(404)
  })

  test('CompatError has sdk field', () => {
    const error = new CompatError({
      code: 'API_ERROR',
      message: 'API call failed',
      sdk: 'stripe',
    })

    expect(error.sdk).toBe('stripe')
  })

  test('CompatError serializes to JSON', () => {
    const error = new CompatError({
      code: 'VALIDATION_ERROR',
      message: 'Invalid email format',
      statusCode: 400,
      sdk: 'sendgrid',
      details: { field: 'email', value: 'not-an-email' },
    })

    const json = error.toJSON()

    expect(json).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Invalid email format',
      statusCode: 400,
      sdk: 'sendgrid',
      details: { field: 'email', value: 'not-an-email' },
    })
  })

  test('CompatError name property is set correctly', () => {
    const error = new CompatError({
      code: 'TEST_ERROR',
      message: 'Test error',
    })

    expect(error.name).toBe('CompatError')
  })

  test('CompatError stack trace is captured', () => {
    const error = new CompatError({
      code: 'TEST_ERROR',
      message: 'Test error',
    })

    expect(error.stack).toBeDefined()
    expect(error.stack).toContain('CompatError')
  })
})

// =============================================================================
// Error Category Tests
// =============================================================================

describe('Error Categories', () => {
  test('ValidationError for invalid inputs', () => {
    const error = new ValidationError({
      message: 'Email format is invalid',
      field: 'email',
      value: 'not-valid',
    })

    expect(error.code).toBe('VALIDATION_ERROR')
    expect(error.statusCode).toBe(400)
    expect(error.field).toBe('email')
    expect(error.value).toBe('not-valid')
    expect(error).toBeInstanceOf(CompatError)
    expect(error).toBeInstanceOf(ValidationError)
  })

  test('AuthenticationError for auth failures', () => {
    const error = new AuthenticationError({
      message: 'Invalid API key',
    })

    expect(error.code).toBe('AUTHENTICATION_ERROR')
    expect(error.statusCode).toBe(401)
    expect(error).toBeInstanceOf(CompatError)
    expect(error).toBeInstanceOf(AuthenticationError)
  })

  test('AuthorizationError for forbidden', () => {
    const error = new AuthorizationError({
      message: 'Insufficient permissions to access resource',
      resource: 'customers',
      action: 'delete',
    })

    expect(error.code).toBe('AUTHORIZATION_ERROR')
    expect(error.statusCode).toBe(403)
    expect(error.resource).toBe('customers')
    expect(error.action).toBe('delete')
    expect(error).toBeInstanceOf(CompatError)
    expect(error).toBeInstanceOf(AuthorizationError)
  })

  test('NotFoundError for missing resources', () => {
    const error = new NotFoundError({
      message: 'Customer not found',
      resourceType: 'customer',
      resourceId: 'cus_123',
    })

    expect(error.code).toBe('NOT_FOUND')
    expect(error.statusCode).toBe(404)
    expect(error.resourceType).toBe('customer')
    expect(error.resourceId).toBe('cus_123')
    expect(error).toBeInstanceOf(CompatError)
    expect(error).toBeInstanceOf(NotFoundError)
  })

  test('RateLimitError for throttling', () => {
    const error = new RateLimitError({
      message: 'Rate limit exceeded',
      retryAfter: 30,
      limit: 100,
      remaining: 0,
    })

    expect(error.code).toBe('RATE_LIMIT_ERROR')
    expect(error.statusCode).toBe(429)
    expect(error.retryAfter).toBe(30)
    expect(error.limit).toBe(100)
    expect(error.remaining).toBe(0)
    expect(error).toBeInstanceOf(CompatError)
    expect(error).toBeInstanceOf(RateLimitError)
  })

  test('ServiceError for upstream failures', () => {
    const error = new ServiceError({
      message: 'Upstream service unavailable',
      statusCode: 502,
      service: 'stripe',
    })

    expect(error.code).toBe('SERVICE_ERROR')
    expect(error.statusCode).toBe(502)
    expect(error.service).toBe('stripe')
    expect(error).toBeInstanceOf(CompatError)
    expect(error).toBeInstanceOf(ServiceError)
  })

  test('ServiceError defaults to 500 for unspecified status', () => {
    const error = new ServiceError({
      message: 'Internal error',
    })

    expect(error.statusCode).toBe(500)
  })
})

// =============================================================================
// SDK-Specific Mapping Tests
// =============================================================================

describe('SDK-Specific Error Mapping', () => {
  test('Stripe errors map to CompatError', () => {
    // Simulating a Stripe error structure
    const stripeError = {
      type: 'card_error',
      code: 'card_declined',
      message: 'Your card was declined',
      decline_code: 'insufficient_funds',
      param: 'card',
      doc_url: 'https://stripe.com/docs/error-codes/card-declined',
    }

    const error = fromStripeError(stripeError, 402, 'req_abc123')

    expect(error).toBeInstanceOf(CompatError)
    expect(error.code).toBe('CARD_DECLINED')
    expect(error.message).toBe('Your card was declined')
    expect(error.statusCode).toBe(402)
    expect(error.sdk).toBe('stripe')
    expect(error.requestId).toBe('req_abc123')
    expect(error.details).toEqual({
      stripeType: 'card_error',
      stripeCode: 'card_declined',
      declineCode: 'insufficient_funds',
      param: 'card',
      docUrl: 'https://stripe.com/docs/error-codes/card-declined',
    })
  })

  test('Stripe authentication error maps correctly', () => {
    const stripeError = {
      type: 'authentication_error',
      message: 'Invalid API Key provided',
    }

    const error = fromStripeError(stripeError, 401)

    expect(error).toBeInstanceOf(AuthenticationError)
    expect(error.code).toBe('AUTHENTICATION_ERROR')
    expect(error.statusCode).toBe(401)
    expect(error.sdk).toBe('stripe')
  })

  test('OpenAI errors map to CompatError', () => {
    // Simulating an OpenAI error structure
    const openaiError = {
      message: 'You exceeded your current quota',
      type: 'insufficient_quota',
      code: 'insufficient_quota',
      param: null,
    }

    const error = fromOpenAIError(openaiError, 429, 'req_xyz789')

    expect(error).toBeInstanceOf(CompatError)
    expect(error.code).toBe('INSUFFICIENT_QUOTA')
    expect(error.message).toBe('You exceeded your current quota')
    expect(error.statusCode).toBe(429)
    expect(error.sdk).toBe('openai')
    expect(error.requestId).toBe('req_xyz789')
  })

  test('OpenAI rate limit error maps correctly', () => {
    const openaiError = {
      message: 'Rate limit reached for gpt-4',
      type: 'rate_limit_error',
      code: null,
    }

    const error = fromOpenAIError(openaiError, 429)

    expect(error).toBeInstanceOf(RateLimitError)
    expect(error.code).toBe('RATE_LIMIT_ERROR')
    expect(error.statusCode).toBe(429)
    expect(error.sdk).toBe('openai')
  })

  test('AWS errors map to CompatError', () => {
    // Simulating an AWS SDK v3 error structure
    const awsError = {
      name: 'NoSuchBucket',
      message: 'The specified bucket does not exist',
      $fault: 'client' as const,
      $metadata: {
        httpStatusCode: 404,
        requestId: 'ABCD1234',
        extendedRequestId: 'xyz/abc',
      },
    }

    const error = fromAWSError(awsError, 's3')

    expect(error).toBeInstanceOf(NotFoundError)
    expect(error.code).toBe('NO_SUCH_BUCKET')
    expect(error.message).toBe('The specified bucket does not exist')
    expect(error.statusCode).toBe(404)
    expect(error.sdk).toBe('s3')
    expect(error.requestId).toBe('ABCD1234')
    expect(error.details).toEqual({
      awsErrorName: 'NoSuchBucket',
      fault: 'client',
      extendedRequestId: 'xyz/abc',
    })
  })

  test('AWS server fault maps to ServiceError', () => {
    const awsError = {
      name: 'InternalError',
      message: 'We encountered an internal error',
      $fault: 'server' as const,
      $metadata: {
        httpStatusCode: 500,
        requestId: 'XYZ5678',
      },
    }

    const error = fromAWSError(awsError, 's3')

    expect(error).toBeInstanceOf(ServiceError)
    expect(error.code).toBe('SERVICE_ERROR')
    expect(error.statusCode).toBe(500)
    expect(error.retryable).toBe(true)
  })
})

// =============================================================================
// Error Enhancement Tests
// =============================================================================

describe('Error Enhancement', () => {
  test('retryable flag computed from error type', () => {
    // 5xx errors should be retryable
    const serverError = new ServiceError({
      message: 'Internal server error',
      statusCode: 500,
    })
    expect(serverError.retryable).toBe(true)

    // Rate limit errors should be retryable
    const rateLimitError = new RateLimitError({
      message: 'Too many requests',
    })
    expect(rateLimitError.retryable).toBe(true)

    // 4xx errors (except 429) should NOT be retryable
    const validationError = new ValidationError({
      message: 'Bad input',
    })
    expect(validationError.retryable).toBe(false)

    const authError = new AuthenticationError({
      message: 'Invalid key',
    })
    expect(authError.retryable).toBe(false)

    const notFoundError = new NotFoundError({
      message: 'Not found',
    })
    expect(notFoundError.retryable).toBe(false)
  })

  test('retryAfter extracted from headers', () => {
    const headers = new Headers({
      'Retry-After': '60',
      'X-RateLimit-Limit': '1000',
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': '1704067200',
    })

    const error = RateLimitError.fromHeaders(
      'Rate limit exceeded',
      headers
    )

    expect(error.retryAfter).toBe(60)
    expect(error.limit).toBe(1000)
    expect(error.remaining).toBe(0)
    expect(error.resetAt).toEqual(new Date(1704067200 * 1000))
  })

  test('retryAfter handles date format in header', () => {
    const headers = new Headers({
      'Retry-After': 'Wed, 01 Jan 2025 00:00:00 GMT',
    })

    const error = RateLimitError.fromHeaders(
      'Rate limit exceeded',
      headers
    )

    expect(error.retryAfter).toBeGreaterThan(0) // Should compute seconds from now
    expect(error.resetAt).toEqual(new Date('Wed, 01 Jan 2025 00:00:00 GMT'))
  })

  test('requestId attached from response', () => {
    const response = new Response('Error', {
      status: 500,
      headers: {
        'X-Request-Id': 'req_abc123xyz',
        'CF-Ray': 'ray_789',
      },
    })

    const error = CompatError.fromResponse(response, 'Service error')

    expect(error.requestId).toBe('req_abc123xyz')
    expect(error.details?.cfRay).toBe('ray_789')
  })

  test('requestId fallback headers', () => {
    // Test various request ID header formats
    const testCases = [
      { header: 'x-request-id', value: 'req_1' },
      { header: 'x-amzn-requestid', value: 'req_2' },
      { header: 'x-amz-request-id', value: 'req_3' },
      { header: 'request-id', value: 'req_4' },
    ]

    for (const { header, value } of testCases) {
      const response = new Response('Error', {
        status: 500,
        headers: { [header]: value },
      })

      const error = CompatError.fromResponse(response, 'Test')
      expect(error.requestId).toBe(value)
    }
  })
})

// =============================================================================
// Error Utility Tests
// =============================================================================

describe('Error Utilities', () => {
  test('isCompatError type guard works', () => {
    const compatError = new CompatError({
      code: 'TEST',
      message: 'Test error',
    })
    const regularError = new Error('Regular error')
    const stripeError = { type: 'api_error', message: 'Stripe error' }

    expect(isCompatError(compatError)).toBe(true)
    expect(isCompatError(regularError)).toBe(false)
    expect(isCompatError(stripeError)).toBe(false)
    expect(isCompatError(null)).toBe(false)
    expect(isCompatError(undefined)).toBe(false)
  })

  test('isCompatError narrows type correctly', () => {
    const maybeError: unknown = new ValidationError({
      message: 'Invalid input',
      field: 'email',
    })

    if (isCompatError(maybeError)) {
      // TypeScript should allow accessing CompatError properties
      expect(maybeError.code).toBe('VALIDATION_ERROR')
      expect(maybeError.statusCode).toBe(400)
    } else {
      throw new Error('Type guard should have returned true')
    }
  })

  test('wrapError wraps native errors', () => {
    const nativeError = new Error('Something went wrong')
    const wrapped = wrapError(nativeError, 'stripe')

    expect(wrapped).toBeInstanceOf(CompatError)
    expect(wrapped.code).toBe('UNKNOWN_ERROR')
    expect(wrapped.message).toBe('Something went wrong')
    expect(wrapped.cause).toBe(nativeError)
    expect(wrapped.sdk).toBe('stripe')
    expect(wrapped.statusCode).toBe(500)
  })

  test('wrapError preserves CompatError instances', () => {
    const original = new ValidationError({
      message: 'Already a compat error',
    })
    const wrapped = wrapError(original, 'openai')

    expect(wrapped).toBe(original) // Should return same instance
    expect(wrapped.sdk).toBeUndefined() // Should not modify sdk
  })

  test('wrapError handles string errors', () => {
    const wrapped = wrapError('Something failed', 'sqs')

    expect(wrapped).toBeInstanceOf(CompatError)
    expect(wrapped.message).toBe('Something failed')
    expect(wrapped.code).toBe('UNKNOWN_ERROR')
    expect(wrapped.sdk).toBe('sqs')
  })

  test('wrapError handles unknown error types', () => {
    const wrapped = wrapError({ foo: 'bar' }, 'slack')

    expect(wrapped).toBeInstanceOf(CompatError)
    expect(wrapped.message).toBe('Unknown error')
    expect(wrapped.code).toBe('UNKNOWN_ERROR')
    expect(wrapped.details).toEqual({ original: { foo: 'bar' } })
  })

  test('toResponse generates HTTP response', async () => {
    const error = new NotFoundError({
      message: 'Customer not found',
      resourceType: 'customer',
      resourceId: 'cus_123',
      sdk: 'stripe',
    })

    const response = toResponse(error)

    expect(response).toBeInstanceOf(Response)
    expect(response.status).toBe(404)
    expect(response.headers.get('Content-Type')).toBe('application/json')

    const body = await response.json()
    expect(body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Customer not found',
        resourceType: 'customer',
        resourceId: 'cus_123',
      },
    })
  })

  test('toResponse includes request ID header', () => {
    const error = new CompatError({
      code: 'TEST_ERROR',
      message: 'Test',
      requestId: 'req_abc123',
    })

    const response = toResponse(error)

    expect(response.headers.get('X-Request-Id')).toBe('req_abc123')
  })

  test('toResponse includes retry-after for rate limits', () => {
    const error = new RateLimitError({
      message: 'Too many requests',
      retryAfter: 60,
    })

    const response = toResponse(error)

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
  })

  test('toResponse hides internal details in production', () => {
    const cause = new Error('Database connection failed')
    const error = new ServiceError({
      message: 'Internal error',
      cause,
      details: { query: 'SELECT * FROM secrets' },
    })

    // In production mode, should not expose internal details
    const response = toResponse(error, { exposeDetails: false })
    const body = response.json()

    expect(body).resolves.toEqual({
      error: {
        code: 'SERVICE_ERROR',
        message: 'Internal error',
      },
    })
  })
})

// =============================================================================
// Edge Cases and Integration Tests
// =============================================================================

describe('Edge Cases', () => {
  test('CompatError handles missing optional fields', () => {
    const error = new CompatError({
      code: 'MINIMAL',
      message: 'Minimal error',
    })

    expect(error.sdk).toBeUndefined()
    expect(error.requestId).toBeUndefined()
    expect(error.details).toBeUndefined()
    expect(error.cause).toBeUndefined()
    expect(error.statusCode).toBe(500) // Default
  })

  test('ValidationError with multiple field errors', () => {
    const error = new ValidationError({
      message: 'Multiple validation errors',
      errors: [
        { field: 'email', message: 'Invalid email format' },
        { field: 'name', message: 'Name is required' },
        { field: 'age', message: 'Age must be positive' },
      ],
    })

    expect(error.errors).toHaveLength(3)
    expect(error.errors?.[0].field).toBe('email')
    expect(error.errors?.[1].field).toBe('name')
    expect(error.errors?.[2].field).toBe('age')
  })

  test('Error chaining preserves stack traces', () => {
    const root = new Error('Database error')
    const wrapped = new ServiceError({
      message: 'Failed to fetch user',
      cause: root,
    })

    expect(wrapped.stack).toContain('ServiceError')
    expect(wrapped.cause).toBe(root)
    // The cause's stack should still be accessible
    expect((wrapped.cause as Error).stack).toContain('Database error')
  })

  test('CompatError works with JSON.stringify', () => {
    const error = new CompatError({
      code: 'TEST',
      message: 'Test error',
      statusCode: 400,
      sdk: 'test',
    })

    const serialized = JSON.stringify(error)
    const parsed = JSON.parse(serialized)

    expect(parsed.code).toBe('TEST')
    expect(parsed.message).toBe('Test error')
    expect(parsed.statusCode).toBe(400)
    expect(parsed.sdk).toBe('test')
  })

  test('Circular reference handling in details', () => {
    const circular: Record<string, unknown> = { name: 'test' }
    circular.self = circular

    const error = new CompatError({
      code: 'TEST',
      message: 'Test',
      details: circular,
    })

    // Should not throw when serializing
    expect(() => error.toJSON()).not.toThrow()
    expect(() => JSON.stringify(error)).not.toThrow()
  })
})
