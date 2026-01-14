/**
 * @dotdo/compat/core/error-normalization.test.ts - SDK Error Normalization Integration Tests
 *
 * Verifies that all compat SDKs correctly use the unified CompatError format.
 * These tests ensure cross-SDK consistency in error handling.
 *
 * TDD approach:
 * - RED: Tests define expected normalized error behavior
 * - GREEN: SDKs are migrated to use fromStripeError, fromOpenAIError, etc.
 */

import { describe, test, expect } from 'vitest'
import {
  CompatError,
  isCompatError,
  fromStripeError,
  fromOpenAIError,
  fromAWSError,
} from './errors'

// =============================================================================
// Cross-SDK Error Normalization Tests
// =============================================================================

describe('Stripe SDK Error Normalization', () => {
  test('converts card_declined error to CompatError', () => {
    const stripeError = {
      type: 'card_error',
      code: 'card_declined',
      message: 'Your card was declined.',
      decline_code: 'insufficient_funds',
    }

    const error = fromStripeError(stripeError, 402, 'req_stripe123')

    expect(isCompatError(error)).toBe(true)
    expect(error.sdk).toBe('stripe')
    expect(error.code).toBe('CARD_DECLINED')
    expect(error.statusCode).toBe(402)
    expect(error.requestId).toBe('req_stripe123')
    expect(error.retryable).toBe(false) // 4xx errors are not retryable
  })

  test('converts api_error to CompatError with retryable flag', () => {
    const stripeError = {
      type: 'api_error',
      message: 'An error occurred with our API.',
    }

    const error = fromStripeError(stripeError, 500)

    expect(error.sdk).toBe('stripe')
    expect(error.code).toBe('API_ERROR')
    expect(error.statusCode).toBe(500)
    expect(error.retryable).toBe(true) // 5xx errors are retryable
  })

  test('preserves Stripe-specific details', () => {
    const stripeError = {
      type: 'card_error',
      code: 'expired_card',
      message: 'Your card has expired.',
      param: 'exp_year',
      doc_url: 'https://stripe.com/docs/error-codes/expired-card',
    }

    const error = fromStripeError(stripeError, 402)

    expect(error.details?.stripeType).toBe('card_error')
    expect(error.details?.stripeCode).toBe('expired_card')
    expect(error.details?.param).toBe('exp_year')
    expect(error.details?.docUrl).toBe('https://stripe.com/docs/error-codes/expired-card')
  })
})

describe('OpenAI SDK Error Normalization', () => {
  test('converts rate_limit error to RateLimitError', () => {
    const openaiError = {
      type: 'rate_limit_error',
      message: 'Rate limit reached for gpt-4-turbo.',
      code: null,
    }

    const error = fromOpenAIError(openaiError, 429, 'req_oai456')

    expect(isCompatError(error)).toBe(true)
    expect(error.sdk).toBe('openai')
    expect(error.code).toBe('RATE_LIMIT_ERROR')
    expect(error.statusCode).toBe(429)
    expect(error.requestId).toBe('req_oai456')
    expect(error.retryable).toBe(true)
  })

  test('converts insufficient_quota error to CompatError', () => {
    const openaiError = {
      type: 'insufficient_quota',
      code: 'insufficient_quota',
      message: 'You exceeded your current quota.',
      param: null,
    }

    const error = fromOpenAIError(openaiError, 429)

    expect(error.sdk).toBe('openai')
    expect(error.code).toBe('INSUFFICIENT_QUOTA')
    expect(error.message).toBe('You exceeded your current quota.')
  })

  test('converts invalid_request_error to CompatError', () => {
    const openaiError = {
      type: 'invalid_request_error',
      code: 'context_length_exceeded',
      message: 'This model\'s maximum context length is 4096 tokens.',
      param: 'messages',
    }

    const error = fromOpenAIError(openaiError, 400)

    expect(error.code).toBe('CONTEXT_LENGTH_EXCEEDED')
    expect(error.statusCode).toBe(400)
    expect(error.retryable).toBe(false)
  })
})

describe('S3/AWS SDK Error Normalization', () => {
  test('converts NoSuchBucket to NotFoundError', () => {
    const awsError = {
      name: 'NoSuchBucket',
      message: 'The specified bucket does not exist.',
      $fault: 'client' as const,
      $metadata: {
        httpStatusCode: 404,
        requestId: 'AWSREQ789',
      },
    }

    const error = fromAWSError(awsError, 's3')

    expect(isCompatError(error)).toBe(true)
    expect(error.sdk).toBe('s3')
    expect(error.code).toBe('NO_SUCH_BUCKET')
    expect(error.statusCode).toBe(404)
    expect(error.requestId).toBe('AWSREQ789')
    expect(error.retryable).toBe(false)
  })

  test('converts server fault to ServiceError with retryable', () => {
    const awsError = {
      name: 'InternalError',
      message: 'We encountered an internal error. Please try again.',
      $fault: 'server' as const,
      $metadata: {
        httpStatusCode: 500,
        requestId: 'AWSREQ999',
        extendedRequestId: 'ext/req/id',
      },
    }

    const error = fromAWSError(awsError, 's3')

    expect(error.code).toBe('SERVICE_ERROR')
    expect(error.statusCode).toBe(500)
    expect(error.retryable).toBe(true)
    expect(error.details?.extendedRequestId).toBe('ext/req/id')
  })

  test('converts NoSuchKey to NotFoundError', () => {
    const awsError = {
      name: 'NoSuchKey',
      message: 'The specified key does not exist.',
      $fault: 'client' as const,
      $metadata: {
        httpStatusCode: 404,
        requestId: 'AWS_KEY_REQ',
      },
    }

    const error = fromAWSError(awsError, 's3')

    expect(error.code).toBe('NO_SUCH_KEY')
    expect(error.statusCode).toBe(404)
    expect(error.details?.awsErrorName).toBe('NoSuchKey')
  })

  test('converts AccessDenied to CompatError', () => {
    const awsError = {
      name: 'AccessDenied',
      message: 'Access Denied',
      $fault: 'client' as const,
      $metadata: {
        httpStatusCode: 403,
        requestId: 'AWS_ACCESS_REQ',
      },
    }

    const error = fromAWSError(awsError, 's3')

    expect(error.code).toBe('ACCESS_DENIED')
    expect(error.statusCode).toBe(403)
    expect(error.retryable).toBe(false)
  })
})

// =============================================================================
// Error JSON Serialization Tests
// =============================================================================

describe('Error JSON Serialization', () => {
  test('CompatError serializes consistently across SDKs', () => {
    const stripeErr = fromStripeError(
      { type: 'card_error', code: 'card_declined', message: 'Declined' },
      402
    )
    const openaiErr = fromOpenAIError(
      { type: 'invalid_request_error', message: 'Bad request', code: null },
      400
    )
    const awsErr = fromAWSError(
      {
        name: 'NoSuchBucket',
        message: 'Not found',
        $fault: 'client',
        $metadata: { httpStatusCode: 404 },
      },
      's3'
    )

    // All should have consistent structure
    for (const error of [stripeErr, openaiErr, awsErr]) {
      const json = error.toJSON()
      expect(json).toHaveProperty('code')
      expect(json).toHaveProperty('message')
      expect(json).toHaveProperty('statusCode')
      // SDK field should be set
      expect(json.sdk).toBeDefined()
    }
  })

  test('JSON serialization is safe for logging', () => {
    const error = fromStripeError(
      {
        type: 'api_error',
        message: 'Internal error',
        code: 'internal_error',
      },
      500,
      'req_123'
    )

    // Should not throw when serializing
    expect(() => JSON.stringify(error)).not.toThrow()

    const serialized = JSON.stringify(error)
    const parsed = JSON.parse(serialized)

    expect(parsed.code).toBe('INTERNAL_ERROR')
    expect(parsed.sdk).toBe('stripe')
  })
})

// =============================================================================
// Error Type Checking Tests
// =============================================================================

describe('Error Type Checking', () => {
  test('isCompatError returns true for all SDK-mapped errors', () => {
    const stripeErr = fromStripeError(
      { type: 'card_error', message: 'Test' },
      400
    )
    const openaiErr = fromOpenAIError(
      { type: 'api_error', message: 'Test' },
      500
    )
    const awsErr = fromAWSError(
      {
        name: 'TestError',
        message: 'Test',
        $fault: 'client',
        $metadata: { httpStatusCode: 400 },
      },
      's3'
    )

    expect(isCompatError(stripeErr)).toBe(true)
    expect(isCompatError(openaiErr)).toBe(true)
    expect(isCompatError(awsErr)).toBe(true)
  })

  test('isCompatError returns false for non-compat errors', () => {
    expect(isCompatError(new Error('Regular error'))).toBe(false)
    expect(isCompatError({ code: 'fake', message: 'fake' })).toBe(false)
    expect(isCompatError(null)).toBe(false)
    expect(isCompatError(undefined)).toBe(false)
  })
})

// =============================================================================
// Error SDK Field Tests
// =============================================================================

describe('Error SDK Field', () => {
  test('Stripe errors have sdk="stripe"', () => {
    const error = fromStripeError(
      { type: 'api_error', message: 'Test' },
      500
    )
    expect(error.sdk).toBe('stripe')
  })

  test('OpenAI errors have sdk="openai"', () => {
    const error = fromOpenAIError(
      { type: 'api_error', message: 'Test' },
      500
    )
    expect(error.sdk).toBe('openai')
  })

  test('AWS errors preserve the sdk parameter', () => {
    const s3Error = fromAWSError(
      {
        name: 'TestError',
        message: 'Test',
        $fault: 'client',
        $metadata: { httpStatusCode: 400 },
      },
      's3'
    )
    expect(s3Error.sdk).toBe('s3')

    const sqsError = fromAWSError(
      {
        name: 'TestError',
        message: 'Test',
        $fault: 'client',
        $metadata: { httpStatusCode: 400 },
      },
      'sqs'
    )
    expect(sqsError.sdk).toBe('sqs')
  })
})

// =============================================================================
// SDK Class Compat Property Tests
// =============================================================================

describe('SDK Error Classes Have Compat Properties', () => {
  // Note: These tests import the actual SDK error classes to verify
  // they have the compat properties after the migration

  test('StripeAPIError has compat properties', async () => {
    const { StripeAPIError } = await import('../stripe/stripe')
    const error = new StripeAPIError(
      {
        type: 'card_error',
        code: 'card_declined',
        message: 'Your card was declined.',
      },
      402,
      'req_stripe_test'
    )

    // Original Stripe properties
    expect(error.type).toBe('card_error')
    expect(error.code).toBe('card_declined')
    expect(error.statusCode).toBe(402)

    // Compat properties
    expect(error.sdk).toBe('stripe')
    expect(error.compatCode).toBe('CARD_DECLINED')
    expect(error.retryable).toBe(false)
    expect(typeof error.toJSON).toBe('function')
  })

  test('OpenAIError has compat properties', async () => {
    const { OpenAIError } = await import('../openai/openai')
    const error = new OpenAIError(
      {
        type: 'rate_limit_error',
        message: 'Rate limit exceeded.',
        code: null,
        param: null,
      },
      429,
      'req_openai_test'
    )

    // Original OpenAI properties
    expect(error.type).toBe('rate_limit_error')
    expect(error.status).toBe(429)

    // Compat properties
    expect(error.sdk).toBe('openai')
    expect(error.compatCode).toBe('RATE_LIMIT_ERROR')
    expect(error.statusCode).toBe(429)
    expect(error.retryable).toBe(true)
    expect(typeof error.toJSON).toBe('function')
    expect(typeof error.toCompatError).toBe('function')
  })

  test('S3ServiceException has compat properties', async () => {
    const { NoSuchBucket } = await import('../s3/errors')
    const error = new NoSuchBucket({
      message: 'The bucket does not exist',
      $metadata: { httpStatusCode: 404, requestId: 'AWS_REQ_TEST' },
    })

    // Original AWS properties
    expect(error.$fault).toBe('client')
    expect(error.$metadata.httpStatusCode).toBe(404)

    // Compat properties
    expect(error.sdk).toBe('s3')
    expect(error.statusCode).toBe(404)
    expect(error.retryable).toBe(false)
    expect(error.requestId).toBe('AWS_REQ_TEST')
    expect(typeof error.toJSON).toBe('function')
    expect(typeof error.toCompatError).toBe('function')
  })

  test('SendGridError has compat properties', async () => {
    const { SendGridError } = await import('../sendgrid/client')
    const error = new SendGridError(
      'Invalid email address',
      400,
      [{ message: 'Invalid email', field: 'to' }]
    )

    // Original SendGrid properties
    expect(error.statusCode).toBe(400)
    expect(error.errors).toHaveLength(1)

    // Compat properties
    expect(error.sdk).toBe('sendgrid')
    expect(error.compatCode).toBe('VALIDATION_ERROR')
    expect(error.retryable).toBe(false)
    expect(typeof error.toJSON).toBe('function')
    expect(typeof error.toCompatError).toBe('function')
  })
})
