/**
 * Error Propagation Integration Tests for Compat Layers
 *
 * Tests how errors propagate across different compat modules:
 * - Error class hierarchy and instanceof checks
 * - Error wrapping and unwrapping
 * - Cross-SDK error normalization
 * - Error serialization consistency
 * - Retry infrastructure with errors
 *
 * These tests verify that the unified error system works correctly
 * across all compat modules.
 *
 * Run with: npx vitest run tests/integration/compat/error-propagation.test.ts --project=integration
 *
 * @module tests/integration/compat/error-propagation
 */

import { describe, it, expect, beforeEach } from 'vitest'

describe('Error Propagation Integration Tests', () => {
  /**
   * Test Suite 1: Unified Error Classes
   *
   * Tests that all compat modules use the same error base classes.
   */
  describe('Unified Error Class Hierarchy', () => {
    it('CompatError is the base class for all SDK errors', async () => {
      const {
        CompatError,
        ValidationError,
        AuthenticationError,
        AuthorizationError,
        NotFoundError,
        RateLimitError,
        ServiceError,
      } = await import('../../../compat/core/errors')

      // All specialized errors should extend CompatError
      const validationErr = new ValidationError({ message: 'Invalid input' })
      const authErr = new AuthenticationError({ message: 'Invalid credentials' })
      const authzErr = new AuthorizationError({ message: 'Access denied' })
      const notFoundErr = new NotFoundError({ message: 'Resource not found' })
      const rateLimitErr = new RateLimitError({ message: 'Too many requests' })
      const serviceErr = new ServiceError({ message: 'Service unavailable' })

      // All should be instances of CompatError
      expect(validationErr).toBeInstanceOf(CompatError)
      expect(authErr).toBeInstanceOf(CompatError)
      expect(authzErr).toBeInstanceOf(CompatError)
      expect(notFoundErr).toBeInstanceOf(CompatError)
      expect(rateLimitErr).toBeInstanceOf(CompatError)
      expect(serviceErr).toBeInstanceOf(CompatError)

      // All should be instances of Error
      expect(validationErr).toBeInstanceOf(Error)
      expect(authErr).toBeInstanceOf(Error)
    })

    it('error codes are standardized across SDK types', async () => {
      const {
        ValidationError,
        AuthenticationError,
        AuthorizationError,
        NotFoundError,
        RateLimitError,
        ServiceError,
      } = await import('../../../compat/core/errors')

      expect(new ValidationError({ message: 'test' }).code).toBe('VALIDATION_ERROR')
      expect(new AuthenticationError({ message: 'test' }).code).toBe('AUTHENTICATION_ERROR')
      expect(new AuthorizationError({ message: 'test' }).code).toBe('AUTHORIZATION_ERROR')
      expect(new NotFoundError({ message: 'test' }).code).toBe('NOT_FOUND')
      expect(new RateLimitError({ message: 'test' }).code).toBe('RATE_LIMIT_ERROR')
      expect(new ServiceError({ message: 'test' }).code).toBe('SERVICE_ERROR')
    })

    it('status codes are correct for each error type', async () => {
      const {
        ValidationError,
        AuthenticationError,
        AuthorizationError,
        NotFoundError,
        RateLimitError,
        ServiceError,
      } = await import('../../../compat/core/errors')

      expect(new ValidationError({ message: 'test' }).statusCode).toBe(400)
      expect(new AuthenticationError({ message: 'test' }).statusCode).toBe(401)
      expect(new AuthorizationError({ message: 'test' }).statusCode).toBe(403)
      expect(new NotFoundError({ message: 'test' }).statusCode).toBe(404)
      expect(new RateLimitError({ message: 'test' }).statusCode).toBe(429)
      expect(new ServiceError({ message: 'test' }).statusCode).toBe(500)
    })

    it('retryable flag is set correctly by default', async () => {
      const {
        ValidationError,
        AuthenticationError,
        RateLimitError,
        ServiceError,
      } = await import('../../../compat/core/errors')

      // Client errors are not retryable
      expect(new ValidationError({ message: 'test' }).retryable).toBe(false)
      expect(new AuthenticationError({ message: 'test' }).retryable).toBe(false)

      // Rate limits and server errors are retryable
      expect(new RateLimitError({ message: 'test' }).retryable).toBe(true)
      expect(new ServiceError({ message: 'test' }).retryable).toBe(true)
    })
  })

  /**
   * Test Suite 2: S3 Error Propagation
   *
   * Tests that S3 errors are properly typed and propagated.
   */
  describe('S3 Error Propagation', () => {
    it('NoSuchBucket error has correct properties', async () => {
      const { NoSuchBucket, S3ServiceException } = await import('../../../compat/s3/index')

      const error = new NoSuchBucket('test-bucket')

      expect(error).toBeInstanceOf(S3ServiceException)
      expect(error).toBeInstanceOf(Error)
      expect(error.name).toBe('NoSuchBucket')
      expect(error.Bucket).toBe('test-bucket')
      expect(error.$metadata.httpStatusCode).toBe(404)
    })

    it('NoSuchKey error has correct properties', async () => {
      const { NoSuchKey, S3ServiceException } = await import('../../../compat/s3/index')

      const error = new NoSuchKey('my-key', 'my-bucket')

      expect(error).toBeInstanceOf(S3ServiceException)
      expect(error.name).toBe('NoSuchKey')
      expect(error.Key).toBe('my-key')
      expect(error.Bucket).toBe('my-bucket')
      expect(error.$metadata.httpStatusCode).toBe(404)
    })

    it('AccessDenied error has correct properties', async () => {
      const { AccessDenied, S3ServiceException } = await import('../../../compat/s3/index')

      const error = new AccessDenied('Operation not permitted')

      expect(error).toBeInstanceOf(S3ServiceException)
      expect(error.name).toBe('AccessDenied')
      expect(error.$metadata.httpStatusCode).toBe(403)
    })

    it('S3 errors can be caught by base class', async () => {
      const {
        S3ServiceException,
        NoSuchBucket,
        NoSuchKey,
        AccessDenied,
      } = await import('../../../compat/s3/index')

      // All S3 errors should be catchable by S3ServiceException
      const errors = [
        new NoSuchBucket('bucket'),
        new NoSuchKey('key'),
        new AccessDenied('denied'),
      ]

      for (const error of errors) {
        expect(error).toBeInstanceOf(S3ServiceException)
      }
    })

    it('S3 errors work with try-catch patterns', async () => {
      const { S3Client, GetObjectCommand, NoSuchKey, _clearAll } = await import('../../../compat/s3/index')

      _clearAll()

      const client = new S3Client({ region: 'auto' })

      try {
        await client.send(new GetObjectCommand({
          Bucket: 'test-bucket',
          Key: 'non-existent-key',
        }))
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(NoSuchKey)
        if (error instanceof NoSuchKey) {
          expect(error.Key).toBe('non-existent-key')
        }
      }
    })
  })

  /**
   * Test Suite 3: Error Wrapping
   *
   * Tests the wrapError utility for normalizing errors.
   */
  describe('Error Wrapping Utilities', () => {
    it('wrapError preserves CompatError instances', async () => {
      const { wrapError, ValidationError, isCompatError } = await import('../../../compat/core/errors')

      const original = new ValidationError({ message: 'Field is required', field: 'email' })
      const wrapped = wrapError(original, 'test-sdk')

      // Should return the same instance
      expect(wrapped).toBe(original)
      expect(isCompatError(wrapped)).toBe(true)
    })

    it('wrapError converts native Error to CompatError', async () => {
      const { wrapError, CompatError, isCompatError } = await import('../../../compat/core/errors')

      const original = new Error('Something went wrong')
      const wrapped = wrapError(original, 'test-sdk')

      expect(wrapped).toBeInstanceOf(CompatError)
      expect(isCompatError(wrapped)).toBe(true)
      expect(wrapped.message).toBe('Something went wrong')
      expect(wrapped.sdk).toBe('test-sdk')
      expect(wrapped.cause).toBe(original)
    })

    it('wrapError handles string errors', async () => {
      const { wrapError, CompatError } = await import('../../../compat/core/errors')

      const wrapped = wrapError('Plain string error', 'test-sdk')

      expect(wrapped).toBeInstanceOf(CompatError)
      expect(wrapped.message).toBe('Plain string error')
      expect(wrapped.code).toBe('UNKNOWN_ERROR')
    })

    it('wrapError handles unknown error types', async () => {
      const { wrapError, CompatError } = await import('../../../compat/core/errors')

      const wrapped = wrapError({ weird: 'object' }, 'test-sdk')

      expect(wrapped).toBeInstanceOf(CompatError)
      expect(wrapped.message).toBe('Unknown error')
      expect(wrapped.details).toBeDefined()
    })
  })

  /**
   * Test Suite 4: SDK-Specific Error Mappers
   *
   * Tests error mappers for different SDKs.
   */
  describe('SDK-Specific Error Mappers', () => {
    it('fromStripeError creates correct error types', async () => {
      const { fromStripeError, AuthenticationError, CompatError } = await import('../../../compat/core/errors')

      // Authentication error
      const authError = fromStripeError(
        {
          type: 'authentication_error',
          message: 'Invalid API key',
        },
        401,
        'req_123'
      )

      expect(authError).toBeInstanceOf(AuthenticationError)
      expect(authError.sdk).toBe('stripe')
      expect(authError.requestId).toBe('req_123')

      // Card error
      const cardError = fromStripeError(
        {
          type: 'card_error',
          code: 'card_declined',
          message: 'Your card was declined',
          decline_code: 'insufficient_funds',
        },
        402,
        'req_456'
      )

      expect(cardError).toBeInstanceOf(CompatError)
      expect(cardError.code).toBe('CARD_DECLINED')
      expect(cardError.details?.declineCode).toBe('insufficient_funds')
    })

    it('fromOpenAIError creates correct error types', async () => {
      const { fromOpenAIError, RateLimitError, CompatError } = await import('../../../compat/core/errors')

      // Rate limit error
      const rateLimitError = fromOpenAIError(
        {
          type: 'rate_limit_error',
          message: 'Rate limit exceeded',
        },
        429,
        'req_abc'
      )

      expect(rateLimitError).toBeInstanceOf(RateLimitError)
      expect(rateLimitError.sdk).toBe('openai')

      // Model error
      const modelError = fromOpenAIError(
        {
          type: 'invalid_request_error',
          code: 'model_not_found',
          message: 'Model not found',
        },
        404,
        'req_def'
      )

      expect(modelError).toBeInstanceOf(CompatError)
      expect(modelError.code).toBe('MODEL_NOT_FOUND')
    })

    it('fromAWSError creates correct error types', async () => {
      const { fromAWSError, ServiceError, NotFoundError } = await import('../../../compat/core/errors')

      // Server error
      const serverError = fromAWSError(
        {
          name: 'InternalServerError',
          message: 'Internal server error',
          $fault: 'server',
          $metadata: {
            httpStatusCode: 500,
            requestId: 'aws-req-123',
          },
        },
        's3'
      )

      expect(serverError).toBeInstanceOf(ServiceError)
      expect(serverError.sdk).toBe('s3')
      expect(serverError.retryable).toBe(true)

      // Not found error
      const notFoundError = fromAWSError(
        {
          name: 'NoSuchKey',
          message: 'The specified key does not exist',
          $fault: 'client',
          $metadata: {
            httpStatusCode: 404,
            requestId: 'aws-req-456',
          },
        },
        's3'
      )

      expect(notFoundError).toBeInstanceOf(NotFoundError)
      expect(notFoundError.code).toBe('NO_SUCH_KEY')
    })
  })

  /**
   * Test Suite 5: Error Serialization
   *
   * Tests that errors serialize correctly for logging and API responses.
   */
  describe('Error Serialization', () => {
    it('CompatError.toJSON produces valid JSON', async () => {
      const { CompatError } = await import('../../../compat/core/errors')

      const error = new CompatError({
        code: 'TEST_ERROR',
        message: 'Test message',
        statusCode: 500,
        sdk: 'test',
        requestId: 'req-123',
        details: { foo: 'bar' },
      })

      const json = error.toJSON()

      expect(json.code).toBe('TEST_ERROR')
      expect(json.message).toBe('Test message')
      expect(json.statusCode).toBe(500)
      expect(json.sdk).toBe('test')
      expect(json.requestId).toBe('req-123')
      expect(json.details).toEqual({ foo: 'bar' })

      // Should be valid JSON
      expect(() => JSON.stringify(json)).not.toThrow()
    })

    it('safeSerialize handles circular references', async () => {
      const { safeSerialize } = await import('../../../compat/core/errors')

      // Create circular reference
      const obj: Record<string, unknown> = { name: 'test' }
      obj.self = obj

      const serialized = safeSerialize(obj)

      expect(serialized).toBeDefined()
      expect(() => JSON.stringify(serialized)).not.toThrow()
    })

    it('safeSerialize handles Error objects', async () => {
      const { safeSerialize } = await import('../../../compat/core/errors')

      const error = new Error('Test error')
      const serialized = safeSerialize(error) as Record<string, unknown>

      expect(serialized.name).toBe('Error')
      expect(serialized.message).toBe('Test error')
      expect(serialized.stack).toBeDefined()
    })

    it('safeSerialize handles nested structures', async () => {
      const { safeSerialize } = await import('../../../compat/core/errors')

      const complex = {
        error: new Error('Nested error'),
        date: new Date('2026-01-13'),
        map: new Map([['key', 'value']]),
        set: new Set([1, 2, 3]),
        func: () => 'hello',
        regex: /test/gi,
      }

      const serialized = safeSerialize(complex) as Record<string, unknown>

      expect(serialized.error).toBeDefined()
      expect(serialized.date).toBe('2026-01-13T00:00:00.000Z')
      expect((serialized.map as Record<string, unknown>).__type).toBe('Map')
      expect((serialized.set as Record<string, unknown>).__type).toBe('Set')
      expect(serialized.func).toBe('[Function]')
      expect(serialized.regex).toBe('/test/gi')
    })

    it('toResponse creates valid HTTP response', async () => {
      const { toResponse, NotFoundError } = await import('../../../compat/core/errors')

      const error = new NotFoundError({
        message: 'User not found',
        resourceType: 'User',
        resourceId: 'user-123',
        requestId: 'req-abc',
      })

      const response = toResponse(error)

      expect(response.status).toBe(404)
      expect(response.headers.get('Content-Type')).toBe('application/json')
      expect(response.headers.get('X-Request-Id')).toBe('req-abc')

      const body = await response.json() as Record<string, Record<string, unknown>>
      expect(body.error.code).toBe('NOT_FOUND')
      expect(body.error.message).toBe('User not found')
      expect(body.error.resourceType).toBe('User')
      expect(body.error.resourceId).toBe('user-123')
    })

    it('RateLimitError response includes Retry-After header', async () => {
      const { toResponse, RateLimitError } = await import('../../../compat/core/errors')

      const error = new RateLimitError({
        message: 'Rate limit exceeded',
        retryAfter: 60,
      })

      const response = toResponse(error)

      expect(response.status).toBe(429)
      expect(response.headers.get('Retry-After')).toBe('60')
    })
  })

  /**
   * Test Suite 6: Retry Infrastructure with Errors
   *
   * Tests the retry handler's error handling capabilities.
   */
  describe('Retry Infrastructure Error Handling', () => {
    it('isRetryableStatus correctly identifies retryable codes', async () => {
      const { isRetryableStatus } = await import('../../../compat/core/retry')

      // Retryable status codes
      expect(isRetryableStatus(429)).toBe(true) // Rate limit
      expect(isRetryableStatus(500)).toBe(true) // Internal server error
      expect(isRetryableStatus(502)).toBe(true) // Bad gateway
      expect(isRetryableStatus(503)).toBe(true) // Service unavailable
      expect(isRetryableStatus(504)).toBe(true) // Gateway timeout

      // Non-retryable status codes
      expect(isRetryableStatus(200)).toBe(false)
      expect(isRetryableStatus(400)).toBe(false)
      expect(isRetryableStatus(401)).toBe(false)
      expect(isRetryableStatus(403)).toBe(false)
      expect(isRetryableStatus(404)).toBe(false)
    })

    it('parseRetryAfter handles seconds format', async () => {
      const { parseRetryAfter } = await import('../../../compat/core/retry')

      const headers = new Headers({ 'Retry-After': '60' })
      const delay = parseRetryAfter(headers)

      expect(delay).toBe(60000) // 60 seconds in ms
    })

    it('parseRetryAfter handles HTTP date format', async () => {
      const { parseRetryAfter } = await import('../../../compat/core/retry')

      const futureDate = new Date(Date.now() + 30000) // 30 seconds from now
      const headers = new Headers({ 'Retry-After': futureDate.toUTCString() })
      const delay = parseRetryAfter(headers)

      expect(delay).toBeDefined()
      expect(delay).toBeGreaterThan(0)
      expect(delay).toBeLessThanOrEqual(30000)
    })

    it('parseRetryAfter respects maxDelay cap', async () => {
      const { parseRetryAfter } = await import('../../../compat/core/retry')

      const headers = new Headers({ 'Retry-After': '300' }) // 5 minutes
      const delay = parseRetryAfter(headers, 60000) // Cap at 1 minute

      expect(delay).toBe(60000)
    })

    it('calculateExponentialBackoff increases delay exponentially', async () => {
      const { calculateExponentialBackoff, DEFAULT_RETRY_CONFIG } = await import('../../../compat/core/retry')

      const config = { ...DEFAULT_RETRY_CONFIG, jitter: 0 } // Disable jitter for predictable results

      const delay1 = calculateExponentialBackoff(1, config)
      const delay2 = calculateExponentialBackoff(2, config)
      const delay3 = calculateExponentialBackoff(3, config)

      expect(delay1).toBe(1000) // Initial delay
      expect(delay2).toBe(2000) // 1000 * 2
      expect(delay3).toBe(4000) // 1000 * 2^2
    })

    it('calculateExponentialBackoff respects maxDelay', async () => {
      const { calculateExponentialBackoff, DEFAULT_RETRY_CONFIG } = await import('../../../compat/core/retry')

      const config = { ...DEFAULT_RETRY_CONFIG, jitter: 0, maxDelay: 5000 }

      const delay5 = calculateExponentialBackoff(5, config) // Would be 16000 without cap

      expect(delay5).toBe(5000) // Capped at maxDelay
    })

    it('CircuitBreaker transitions states correctly', async () => {
      const { CircuitBreaker } = await import('../../../compat/core/retry')

      const breaker = new CircuitBreaker({
        failureThreshold: 3,
        cooldownPeriod: 100, // Short for testing
        successThreshold: 1,
      })

      // Initial state is closed
      expect(breaker.getState()).toBe('closed')
      expect(breaker.isRequestAllowed()).toBe(true)

      // Record failures to open circuit
      breaker.recordFailure()
      breaker.recordFailure()
      expect(breaker.getState()).toBe('closed') // Still closed (need 3 failures)

      breaker.recordFailure()
      expect(breaker.getState()).toBe('open') // Now open
      expect(breaker.isRequestAllowed()).toBe(false)

      // Wait for cooldown
      await new Promise(resolve => setTimeout(resolve, 150))

      // Should transition to half-open
      expect(breaker.getState()).toBe('half-open')
      expect(breaker.isRequestAllowed()).toBe(true)

      // Success should close circuit
      breaker.recordSuccess()
      expect(breaker.getState()).toBe('closed')
    })

    it('createRetryHandler executes retries correctly', async () => {
      const { createRetryHandler } = await import('../../../compat/core/retry')

      const handler = createRetryHandler({
        maxRetries: 2,
        initialDelay: 10,
        maxDelay: 100,
        jitter: 0,
        timeoutBudget: 10000,
      })

      let attempts = 0

      // Function that fails twice then succeeds
      const result = await handler.execute(async () => {
        attempts++
        if (attempts < 3) {
          throw new Error(`Attempt ${attempts} failed`)
        }
        return 'success'
      })

      expect(result).toBe('success')
      expect(attempts).toBe(3)
    })

    it('createRetryHandler respects maxRetries', async () => {
      const { createRetryHandler } = await import('../../../compat/core/retry')

      const handler = createRetryHandler({
        maxRetries: 2,
        initialDelay: 10,
        maxDelay: 100,
        jitter: 0,
        timeoutBudget: 10000,
      })

      let attempts = 0

      // Function that always fails
      await expect(
        handler.execute(async () => {
          attempts++
          throw new Error('Always fails')
        })
      ).rejects.toThrow('Always fails')

      expect(attempts).toBe(3) // Initial + 2 retries
    })
  })
})
