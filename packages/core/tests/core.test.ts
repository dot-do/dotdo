/**
 * @dotdo/core Tests - Error Classes, Retry Logic, and Type Exports
 *
 * RED phase: These tests define the expected interface for @dotdo/core.
 * Tests cover:
 * - Error classes (CompatError, ValidationError, AuthenticationError, etc.)
 * - Retry logic with exponential backoff
 * - Circuit breaker pattern
 * - Type exports and utilities
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

// Import from the package - these should fail until implementation exists
import {
  // Error classes
  CompatError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  RateLimitError,
  ServiceError,
  // Error utilities
  isCompatError,
  wrapError,
  toResponse,
  // SDK mappers
  fromStripeError,
  fromOpenAIError,
  fromAWSError,
  // Retry infrastructure
  createRetryHandler,
  isRetryableStatus,
  parseRetryAfter,
  calculateExponentialBackoff,
  CircuitBreaker,
  DEFAULT_RETRY_CONFIG,
  // Types
  type CompatErrorOptions,
  type RetryConfig,
  type RetryHandler,
  type RetryEvent,
  type CircuitState,
  type CircuitBreakerConfig,
} from '../src'

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

  test('CompatError defaults statusCode to 500', () => {
    const error = new CompatError({
      code: 'UNKNOWN',
      message: 'Unknown error',
    })

    expect(error.statusCode).toBe(500)
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
// Retryable Flag Tests
// =============================================================================

describe('Retryable Flag', () => {
  test('5xx errors are retryable', () => {
    const serverError = new ServiceError({
      message: 'Internal server error',
      statusCode: 500,
    })
    expect(serverError.retryable).toBe(true)
  })

  test('Rate limit errors are retryable', () => {
    const rateLimitError = new RateLimitError({
      message: 'Too many requests',
    })
    expect(rateLimitError.retryable).toBe(true)
  })

  test('4xx errors (except 429) are NOT retryable', () => {
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
})

// =============================================================================
// SDK-Specific Mapping Tests
// =============================================================================

describe('SDK-Specific Error Mapping', () => {
  test('Stripe errors map to CompatError', () => {
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

  test('RateLimitError.fromHeaders extracts retry info', () => {
    const headers = new Headers({
      'Retry-After': '60',
      'X-RateLimit-Limit': '1000',
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': '1704067200',
    })

    const error = RateLimitError.fromHeaders('Rate limit exceeded', headers)

    expect(error.retryAfter).toBe(60)
    expect(error.limit).toBe(1000)
    expect(error.remaining).toBe(0)
    expect(error.resetAt).toEqual(new Date(1704067200 * 1000))
  })

  test('CompatError.fromResponse extracts request ID', () => {
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
})

// =============================================================================
// Exponential Backoff Tests
// =============================================================================

describe('Exponential Backoff', () => {
  test('doubles delay on each retry', () => {
    const config: RetryConfig = {
      maxRetries: 5,
      initialDelay: 1000,
      maxDelay: 32000,
      multiplier: 2,
      jitter: 0,
      timeoutBudget: 60000,
    }

    const delay1 = calculateExponentialBackoff(1, config)
    const delay2 = calculateExponentialBackoff(2, config)
    const delay3 = calculateExponentialBackoff(3, config)
    const delay4 = calculateExponentialBackoff(4, config)

    expect(delay1).toBe(1000)
    expect(delay2).toBe(2000)
    expect(delay3).toBe(4000)
    expect(delay4).toBe(8000)
  })

  test('respects maxDelay cap', () => {
    const config: RetryConfig = {
      maxRetries: 10,
      initialDelay: 1000,
      maxDelay: 5000,
      multiplier: 2,
      jitter: 0,
      timeoutBudget: 60000,
    }

    const delay4 = calculateExponentialBackoff(4, config)
    const delay5 = calculateExponentialBackoff(5, config)
    const delay10 = calculateExponentialBackoff(10, config)

    expect(delay4).toBe(5000)
    expect(delay5).toBe(5000)
    expect(delay10).toBe(5000)
  })

  test('adds jitter to prevent thundering herd', () => {
    const config: RetryConfig = {
      maxRetries: 5,
      initialDelay: 1000,
      maxDelay: 32000,
      multiplier: 2,
      jitter: 0.25,
      timeoutBudget: 60000,
    }

    const samples: number[] = []
    for (let i = 0; i < 100; i++) {
      samples.push(calculateExponentialBackoff(1, config))
    }

    const minExpected = 750
    const maxExpected = 1250

    for (const sample of samples) {
      expect(sample).toBeGreaterThanOrEqual(minExpected)
      expect(sample).toBeLessThanOrEqual(maxExpected)
    }

    const uniqueValues = new Set(samples)
    expect(uniqueValues.size).toBeGreaterThan(1)
  })
})

// =============================================================================
// Retry Decision Tests
// =============================================================================

describe('Retry Decisions', () => {
  test('retries on 429 Too Many Requests', () => {
    expect(isRetryableStatus(429)).toBe(true)
  })

  test('retries on 5xx errors', () => {
    expect(isRetryableStatus(500)).toBe(true)
    expect(isRetryableStatus(502)).toBe(true)
    expect(isRetryableStatus(503)).toBe(true)
    expect(isRetryableStatus(504)).toBe(true)
  })

  test('does NOT retry on 4xx errors (except 429)', () => {
    expect(isRetryableStatus(400)).toBe(false)
    expect(isRetryableStatus(401)).toBe(false)
    expect(isRetryableStatus(403)).toBe(false)
    expect(isRetryableStatus(404)).toBe(false)
    expect(isRetryableStatus(422)).toBe(false)
  })
})

// =============================================================================
// Retry-After Header Tests
// =============================================================================

describe('parseRetryAfter', () => {
  test('honors Retry-After seconds', () => {
    const headers = new Headers({ 'Retry-After': '5' })
    const delay = parseRetryAfter(headers)

    expect(delay).toBe(5000)
  })

  test('honors Retry-After date', () => {
    const futureDate = new Date(Date.now() + 10000)
    const httpDate = futureDate.toUTCString()
    const headers = new Headers({ 'Retry-After': httpDate })

    const delay = parseRetryAfter(headers)

    expect(delay).toBeGreaterThanOrEqual(9000)
    expect(delay).toBeLessThanOrEqual(11000)
  })

  test('caps Retry-After at maxDelay', () => {
    const headers = new Headers({ 'Retry-After': '300' })
    const maxDelay = 30000

    const delay = parseRetryAfter(headers, maxDelay)

    expect(delay).toBe(30000)
  })

  test('returns undefined for missing header', () => {
    const headers = new Headers()
    const delay = parseRetryAfter(headers)

    expect(delay).toBeUndefined()
  })

  test('returns undefined for invalid header value', () => {
    const headers = new Headers({ 'Retry-After': 'invalid' })
    const delay = parseRetryAfter(headers)

    expect(delay).toBeUndefined()
  })
})

// =============================================================================
// Circuit Breaker Tests
// =============================================================================

describe('Circuit Breaker', () => {
  test('opens circuit after consecutive failures', () => {
    const circuitBreaker = new CircuitBreaker({
      failureThreshold: 3,
      cooldownPeriod: 1000,
      successThreshold: 1,
    })

    expect(circuitBreaker.getState()).toBe('closed')

    circuitBreaker.recordFailure()
    circuitBreaker.recordFailure()
    circuitBreaker.recordFailure()

    expect(circuitBreaker.getState()).toBe('open')
  })

  test('half-opens circuit after cooldown', async () => {
    const circuitBreaker = new CircuitBreaker({
      failureThreshold: 3,
      cooldownPeriod: 100,
      successThreshold: 1,
    })

    circuitBreaker.recordFailure()
    circuitBreaker.recordFailure()
    circuitBreaker.recordFailure()
    expect(circuitBreaker.getState()).toBe('open')

    await new Promise(resolve => setTimeout(resolve, 150))

    expect(circuitBreaker.getState()).toBe('half-open')
  })

  test('closes circuit on success', async () => {
    const circuitBreaker = new CircuitBreaker({
      failureThreshold: 3,
      cooldownPeriod: 100,
      successThreshold: 1,
    })

    circuitBreaker.recordFailure()
    circuitBreaker.recordFailure()
    circuitBreaker.recordFailure()

    await new Promise(resolve => setTimeout(resolve, 150))
    expect(circuitBreaker.getState()).toBe('half-open')

    circuitBreaker.recordSuccess()

    expect(circuitBreaker.getState()).toBe('closed')
  })

  test('reports whether requests are allowed', () => {
    const circuitBreaker = new CircuitBreaker({
      failureThreshold: 3,
      cooldownPeriod: 1000,
      successThreshold: 1,
    })

    expect(circuitBreaker.isRequestAllowed()).toBe(true)

    circuitBreaker.recordFailure()
    circuitBreaker.recordFailure()
    circuitBreaker.recordFailure()

    expect(circuitBreaker.isRequestAllowed()).toBe(false)
  })

  test('resets failure count on success', () => {
    const circuitBreaker = new CircuitBreaker({
      failureThreshold: 3,
      cooldownPeriod: 1000,
      successThreshold: 1,
    })

    circuitBreaker.recordFailure()
    circuitBreaker.recordFailure()
    circuitBreaker.recordSuccess()

    circuitBreaker.recordFailure()
    circuitBreaker.recordFailure()
    expect(circuitBreaker.getState()).toBe('closed')

    circuitBreaker.recordFailure()
    expect(circuitBreaker.getState()).toBe('open')
  })
})

// =============================================================================
// RetryHandler Tests
// =============================================================================

describe('RetryHandler', () => {
  test('createRetryHandler creates handler with defaults', () => {
    const handler = createRetryHandler()

    expect(handler).toBeDefined()
    expect(handler.shouldRetry).toBeInstanceOf(Function)
    expect(handler.calculateDelay).toBeInstanceOf(Function)
    expect(handler.execute).toBeInstanceOf(Function)
    expect(handler.fetch).toBeInstanceOf(Function)
    expect(handler.onRetry).toBeInstanceOf(Function)
    expect(handler.getCircuitState).toBeInstanceOf(Function)
  })

  test('shouldRetry returns true for retryable responses', () => {
    const handler = createRetryHandler()
    const response429 = new Response('', { status: 429 })
    const response500 = new Response('', { status: 500 })

    expect(handler.shouldRetry(response429)).toBe(true)
    expect(handler.shouldRetry(response500)).toBe(true)
  })

  test('shouldRetry returns false for non-retryable responses', () => {
    const handler = createRetryHandler()
    const response400 = new Response('', { status: 400 })
    const response404 = new Response('', { status: 404 })

    expect(handler.shouldRetry(response400)).toBe(false)
    expect(handler.shouldRetry(response404)).toBe(false)
  })

  test('calculateDelay prefers Retry-After', () => {
    const handler = createRetryHandler({
      maxRetries: 3,
      initialDelay: 1000,
      maxDelay: 32000,
      multiplier: 2,
      jitter: 0,
      timeoutBudget: 60000,
    })

    const delay = handler.calculateDelay(1, 3000)

    expect(delay).toBe(3000)
  })

  test('calculateDelay falls back to exponential backoff', () => {
    const handler = createRetryHandler({
      maxRetries: 3,
      initialDelay: 1000,
      maxDelay: 32000,
      multiplier: 2,
      jitter: 0,
      timeoutBudget: 60000,
    })

    const delay = handler.calculateDelay(2, undefined)

    expect(delay).toBe(2000)
  })

  test('execute retries on failure and succeeds', async () => {
    const handler = createRetryHandler({
      maxRetries: 3,
      initialDelay: 10,
      maxDelay: 100,
      multiplier: 2,
      jitter: 0,
      timeoutBudget: 5000,
    })

    let callCount = 0
    const mockFn = vi.fn().mockImplementation(async () => {
      callCount++
      if (callCount < 3) {
        throw new Error('Transient error')
      }
      return 'success'
    })

    const result = await handler.execute(mockFn)

    expect(result).toBe('success')
    expect(mockFn).toHaveBeenCalledTimes(3)
  })

  test('execute throws after max retries', async () => {
    const handler = createRetryHandler({
      maxRetries: 2,
      initialDelay: 10,
      maxDelay: 100,
      multiplier: 2,
      jitter: 0,
      timeoutBudget: 5000,
    })

    const mockFn = vi.fn().mockRejectedValue(new Error('Always fails'))

    await expect(handler.execute(mockFn)).rejects.toThrow('Always fails')
    expect(mockFn).toHaveBeenCalledTimes(3) // Initial + 2 retries
  })

  test('onRetry subscribes to retry events', async () => {
    const events: RetryEvent[] = []
    const handler = createRetryHandler({
      maxRetries: 3,
      initialDelay: 10,
      maxDelay: 100,
      multiplier: 2,
      jitter: 0,
      timeoutBudget: 5000,
    })

    let callCount = 0
    const mockFn = vi.fn().mockImplementation(async () => {
      callCount++
      if (callCount < 3) {
        throw new Error('Transient error')
      }
      return 'success'
    })

    handler.onRetry(event => {
      events.push(event)
    })

    await handler.execute(mockFn)

    expect(events.length).toBeGreaterThan(0)
    expect(events.some(e => e.type === 'retry')).toBe(true)
  })

  test('onRetry returns unsubscribe function', async () => {
    const events: RetryEvent[] = []
    const handler = createRetryHandler({
      maxRetries: 3,
      initialDelay: 10,
      maxDelay: 100,
      multiplier: 2,
      jitter: 0,
      timeoutBudget: 5000,
    })

    let callCount = 0
    const mockFn = vi.fn().mockImplementation(async () => {
      callCount++
      if (callCount < 3) {
        throw new Error('Transient error')
      }
      return 'success'
    })

    const unsubscribe = handler.onRetry(event => {
      events.push(event)
    })

    unsubscribe()

    await handler.execute(mockFn)

    expect(events).toHaveLength(0)
  })

  test('getCircuitState returns current state', () => {
    const handler = createRetryHandler({
      maxRetries: 3,
      initialDelay: 10,
      maxDelay: 100,
      multiplier: 2,
      jitter: 0,
      timeoutBudget: 5000,
      circuitBreaker: {
        failureThreshold: 3,
        cooldownPeriod: 1000,
        successThreshold: 1,
      },
    })

    expect(handler.getCircuitState()).toBe('closed')
  })
})

// =============================================================================
// DEFAULT_RETRY_CONFIG Tests
// =============================================================================

describe('DEFAULT_RETRY_CONFIG', () => {
  test('has sensible defaults', () => {
    expect(DEFAULT_RETRY_CONFIG).toBeDefined()
    expect(DEFAULT_RETRY_CONFIG.maxRetries).toBe(3)
    expect(DEFAULT_RETRY_CONFIG.initialDelay).toBe(1000)
    expect(DEFAULT_RETRY_CONFIG.maxDelay).toBe(32000)
    expect(DEFAULT_RETRY_CONFIG.multiplier).toBe(2)
    expect(DEFAULT_RETRY_CONFIG.jitter).toBe(0.25)
    expect(DEFAULT_RETRY_CONFIG.timeoutBudget).toBe(60000)
  })
})

// =============================================================================
// Edge Cases
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
    expect(error.statusCode).toBe(500)
  })

  test('Error chaining preserves stack traces', () => {
    const root = new Error('Database error')
    const wrapped = new ServiceError({
      message: 'Failed to fetch user',
      cause: root,
    })

    expect(wrapped.stack).toContain('ServiceError')
    expect(wrapped.cause).toBe(root)
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

    expect(() => error.toJSON()).not.toThrow()
    expect(() => JSON.stringify(error)).not.toThrow()
  })
})
