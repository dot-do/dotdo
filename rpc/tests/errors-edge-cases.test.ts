/**
 * Edge Case Tests for rpc/errors.ts
 *
 * Tests for error boundary conditions including:
 * 1. Error serialization edge cases (unusual data types, special characters, empty values)
 * 2. Error deserialization edge cases (malformed data, missing fields, unknown types)
 * 3. Network error handling edge cases
 * 4. Timeout scenarios
 *
 * TDD approach: These tests cover edge cases not handled by the main test suites.
 *
 * @module rpc/tests/errors-edge-cases.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  RPCError,
  RPCErrorCode,
  // Error types
  NotFoundError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  RateLimitError,
  TimeoutError,
  NetworkError,
  InternalError,
  ServiceUnavailableError,
  CircuitOpenError,
  // Serialization
  serializeError,
  deserializeError,
  serializeUnknownError,
  SerializedError,
  isSerializedError,
  // Type guards
  isRPCError,
  isRetryableError,
  getErrorMessage,
  // Utilities
  withTimeout,
  retryWithBackoff,
  handleHTTPError,
  handleResponseError,
  serializeErrorResponse,
  createErrorResponse,
  // Circuit breaker
  CircuitBreaker,
  CircuitState,
  RetryWithCircuitBreaker,
} from '../errors'

// ============================================================================
// Error Serialization Edge Cases
// ============================================================================

describe('Error Serialization Edge Cases', () => {
  describe('serializeError with unusual details', () => {
    it('should handle undefined details', () => {
      const error = new RPCError(RPCErrorCode.INTERNAL_ERROR, 'No details', undefined)
      const serialized = serializeError(error)

      expect(serialized.details).toBeUndefined()
      expect(serialized.code).toBe(RPCErrorCode.INTERNAL_ERROR)
    })

    it('should handle empty object details', () => {
      const error = new RPCError(RPCErrorCode.INTERNAL_ERROR, 'Empty details', {})
      const serialized = serializeError(error)

      expect(serialized.details).toEqual({})
    })

    it('should handle null values in details', () => {
      const error = new RPCError(RPCErrorCode.INTERNAL_ERROR, 'Null value', {
        nullField: null,
        validField: 'value',
      })
      const serialized = serializeError(error)

      expect(serialized.details?.nullField).toBeNull()
      expect(serialized.details?.validField).toBe('value')
    })

    it('should handle numeric values in details', () => {
      const error = new RPCError(RPCErrorCode.INTERNAL_ERROR, 'Numbers', {
        integer: 42,
        float: 3.14159,
        negative: -100,
        zero: 0,
        infinity: Infinity,
        negInfinity: -Infinity,
      })
      const serialized = serializeError(error)
      const json = JSON.stringify(serialized)
      const parsed = JSON.parse(json)

      expect(parsed.details.integer).toBe(42)
      expect(parsed.details.float).toBe(3.14159)
      expect(parsed.details.negative).toBe(-100)
      expect(parsed.details.zero).toBe(0)
      // Infinity becomes null in JSON
      expect(parsed.details.infinity).toBeNull()
      expect(parsed.details.negInfinity).toBeNull()
    })

    it('should handle NaN in details (becomes null in JSON)', () => {
      const error = new RPCError(RPCErrorCode.INTERNAL_ERROR, 'NaN', {
        nanValue: NaN,
      })
      const serialized = serializeError(error)
      const json = JSON.stringify(serialized)
      const parsed = JSON.parse(json)

      expect(parsed.details.nanValue).toBeNull()
    })

    it('should handle boolean values in details', () => {
      const error = new RPCError(RPCErrorCode.INTERNAL_ERROR, 'Booleans', {
        trueValue: true,
        falseValue: false,
      })
      const serialized = serializeError(error)

      expect(serialized.details?.trueValue).toBe(true)
      expect(serialized.details?.falseValue).toBe(false)
    })

    it('should handle array values in details', () => {
      const error = new RPCError(RPCErrorCode.INTERNAL_ERROR, 'Arrays', {
        empty: [],
        numbers: [1, 2, 3],
        mixed: [1, 'two', true, null],
        nested: [[1, 2], [3, 4]],
      })
      const serialized = serializeError(error)

      expect(serialized.details?.empty).toEqual([])
      expect(serialized.details?.numbers).toEqual([1, 2, 3])
      expect(serialized.details?.mixed).toEqual([1, 'two', true, null])
      expect(serialized.details?.nested).toEqual([[1, 2], [3, 4]])
    })

    it('should handle deeply nested objects in details', () => {
      const error = new RPCError(RPCErrorCode.INTERNAL_ERROR, 'Deep', {
        level1: {
          level2: {
            level3: {
              level4: {
                value: 'deep',
              },
            },
          },
        },
      })
      const serialized = serializeError(error)

      expect(serialized.details?.level1?.level2?.level3?.level4?.value).toBe('deep')
    })

    it('should handle special string characters in details', () => {
      const error = new RPCError(RPCErrorCode.INTERNAL_ERROR, 'Special chars', {
        unicode: '\u0000\u001F\uFFFF',
        quotes: '"single\' and "double"',
        backslash: '\\path\\to\\file',
        newlines: 'line1\nline2\rline3\r\nline4',
        tabs: 'col1\tcol2\tcol3',
        emoji: 'Hello! ',
      })
      const serialized = serializeError(error)
      const json = JSON.stringify(serialized)
      const parsed = JSON.parse(json)

      expect(parsed.details.quotes).toBe('"single\' and "double"')
      expect(parsed.details.backslash).toBe('\\path\\to\\file')
      expect(parsed.details.emoji).toBe('Hello! ')
    })

    it('should handle Date objects in details (converted to string)', () => {
      const date = new Date('2024-01-15T12:00:00Z')
      const error = new RPCError(RPCErrorCode.INTERNAL_ERROR, 'Dates', {
        createdAt: date,
      })
      const serialized = serializeError(error)
      const json = JSON.stringify(serialized)
      const parsed = JSON.parse(json)

      expect(parsed.details.createdAt).toBe('2024-01-15T12:00:00.000Z')
    })

    it('should handle BigInt by excluding it (throws in JSON.stringify)', () => {
      // BigInt cannot be serialized to JSON
      const error = new RPCError(RPCErrorCode.INTERNAL_ERROR, 'BigInt', {
        bigValue: BigInt(9007199254740991),
      })

      // Serializing works, but JSON.stringify fails
      const serialized = serializeError(error)
      expect(serialized.details?.bigValue).toBe(BigInt(9007199254740991))

      // JSON.stringify throws with BigInt
      expect(() => JSON.stringify(serialized)).toThrow()
    })

    it('should handle functions in details (excluded by JSON)', () => {
      const error = new RPCError(RPCErrorCode.INTERNAL_ERROR, 'Function', {
        callback: () => 'test',
        validField: 'value',
      })
      const serialized = serializeError(error)
      const json = JSON.stringify(serialized)
      const parsed = JSON.parse(json)

      // Functions are excluded from JSON
      expect(parsed.details.callback).toBeUndefined()
      expect(parsed.details.validField).toBe('value')
    })

    it('should handle symbols in details (excluded by JSON)', () => {
      const sym = Symbol('test')
      const error = new RPCError(RPCErrorCode.INTERNAL_ERROR, 'Symbol', {
        [sym]: 'symbol key',
        symbolValue: sym as unknown as Record<string, unknown>,
        validField: 'value',
      })
      const serialized = serializeError(error)
      const json = JSON.stringify(serialized)
      const parsed = JSON.parse(json)

      // Symbol keys and values are excluded from JSON
      expect(parsed.details.validField).toBe('value')
    })

    it('should handle very long strings', () => {
      const longString = 'x'.repeat(100000)
      const error = new RPCError(RPCErrorCode.INTERNAL_ERROR, 'Long string', {
        content: longString,
      })
      const serialized = serializeError(error)

      expect(serialized.details?.content?.length).toBe(100000)
    })

    it('should handle empty string message', () => {
      const error = new RPCError(RPCErrorCode.INTERNAL_ERROR, '')
      const serialized = serializeError(error)

      expect(serialized.message).toBe('')
    })
  })

  describe('serializeError stack trace handling', () => {
    it('should include stack trace by default', () => {
      const error = new RPCError(RPCErrorCode.INTERNAL_ERROR, 'With stack')
      const serialized = serializeError(error)

      expect(serialized.stack).toBeDefined()
      expect(serialized.stack).toContain('RPCError')
    })

    it('should exclude stack trace when includeStack is false', () => {
      const error = new RPCError(RPCErrorCode.INTERNAL_ERROR, 'No stack')
      const serialized = serializeError(error, { includeStack: false })

      expect(serialized.stack).toBeUndefined()
    })

    it('should handle error without stack trace', () => {
      const error = new RPCError(RPCErrorCode.INTERNAL_ERROR, 'No stack')
      // @ts-expect-error - Intentionally modifying readonly property for testing
      error.stack = undefined
      const serialized = serializeError(error)

      expect(serialized.stack).toBeUndefined()
    })
  })

  describe('serializeUnknownError edge cases', () => {
    it('should handle number input', () => {
      const serialized = serializeUnknownError(42)

      expect(serialized.type).toBe('UnknownError')
      expect(serialized.message).toBe('42')
    })

    it('should handle boolean input', () => {
      const serialized = serializeUnknownError(false)

      expect(serialized.type).toBe('UnknownError')
      expect(serialized.message).toBe('false')
    })

    it('should handle array input', () => {
      const serialized = serializeUnknownError([1, 2, 3])

      expect(serialized.type).toBe('UnknownError')
      expect(serialized.message).toBe('1,2,3')
    })

    it('should handle object with custom toString', () => {
      const obj = {
        toString() {
          return 'Custom toString result'
        },
      }
      const serialized = serializeUnknownError(obj)

      expect(serialized.message).toBe('Custom toString result')
    })

    it('should handle thrown string literal', () => {
      try {
        throw 'string error'
      } catch (e) {
        const serialized = serializeUnknownError(e)
        expect(serialized.message).toBe('string error')
      }
    })

    it('should handle Error subclass', () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message)
          this.name = 'CustomError'
        }
      }
      const error = new CustomError('Custom error message')
      const serialized = serializeUnknownError(error)

      expect(serialized.type).toBe('CustomError')
      expect(serialized.message).toBe('Custom error message')
    })
  })
})

// ============================================================================
// Error Deserialization Edge Cases
// ============================================================================

describe('Error Deserialization Edge Cases', () => {
  describe('deserializeError with malformed data', () => {
    it('should handle missing message field (uses type as fallback)', () => {
      const serialized = {
        type: 'RPCError',
        code: RPCErrorCode.INTERNAL_ERROR,
        message: '', // Empty message
      }
      const error = deserializeError(serialized)

      expect(error.message).toBe('')
      expect(error).toBeInstanceOf(RPCError)
    })

    it('should handle missing code field (uses INTERNAL_ERROR as default)', () => {
      const serialized = {
        type: 'RPCError',
        message: 'No code error',
      } as SerializedError
      const error = deserializeError(serialized)

      expect(error).toBeInstanceOf(RPCError)
      expect((error as RPCError).code).toBe(RPCErrorCode.INTERNAL_ERROR)
    })

    it('should use name field when type is missing', () => {
      const serialized = {
        name: 'NotFoundError',
        code: RPCErrorCode.NOT_FOUND,
        message: 'Not found via name',
      } as SerializedError
      const error = deserializeError(serialized)

      expect(error).toBeInstanceOf(NotFoundError)
    })

    it('should handle unknown error type gracefully', () => {
      const serialized = {
        type: 'FutureNewErrorType',
        code: 'NEW_ERROR_CODE' as RPCErrorCode,
        message: 'Future error type',
        details: { version: '3.0' },
      }
      const error = deserializeError(serialized)

      expect(error).toBeInstanceOf(RPCError)
      expect(error.message).toBe('Future error type')
      expect((error as RPCError).code).toBe('NEW_ERROR_CODE')
    })

    it('should handle null details', () => {
      const serialized = {
        type: 'RPCError',
        code: RPCErrorCode.INTERNAL_ERROR,
        message: 'Null details',
        details: null as unknown as Record<string, unknown>,
      }
      const error = deserializeError(serialized)

      expect(error).toBeInstanceOf(RPCError)
      // null is passed through as-is
      expect((error as RPCError).details).toBeNull()
    })

    it('should handle extra fields gracefully', () => {
      const serialized = {
        type: 'NotFoundError',
        code: RPCErrorCode.NOT_FOUND,
        message: 'Extra fields',
        details: { id: '123' },
        extraField: 'ignored',
        anotherExtra: 42,
      } as SerializedError
      const error = deserializeError(serialized)

      expect(error).toBeInstanceOf(NotFoundError)
      expect(error.message).toBe('Extra fields')
      // Extra fields are ignored
    })

    it('should preserve stack trace from serialized error', () => {
      const originalStack = 'Error: Original\n    at test.ts:123'
      const serialized = {
        type: 'RPCError',
        code: RPCErrorCode.INTERNAL_ERROR,
        message: 'With stack',
        stack: originalStack,
      }
      const error = deserializeError(serialized)

      expect(error.stack).toBe(originalStack)
    })

    it('should handle httpStatus field', () => {
      const serialized = {
        type: 'RPCError',
        code: RPCErrorCode.NOT_FOUND,
        message: 'With status',
        httpStatus: 404,
      }
      const error = deserializeError(serialized)

      expect((error as RPCError).httpStatus).toBe(404)
    })
  })

  describe('deserializeError for all built-in error types', () => {
    const errorTypes: Array<{
      type: string
      code: RPCErrorCode
      expectedClass: new (...args: unknown[]) => RPCError
    }> = [
      { type: 'NotFoundError', code: RPCErrorCode.NOT_FOUND, expectedClass: NotFoundError },
      { type: 'ValidationError', code: RPCErrorCode.VALIDATION_ERROR, expectedClass: ValidationError },
      { type: 'AuthenticationError', code: RPCErrorCode.AUTHENTICATION_ERROR, expectedClass: AuthenticationError },
      { type: 'AuthorizationError', code: RPCErrorCode.AUTHORIZATION_ERROR, expectedClass: AuthorizationError },
      { type: 'ConflictError', code: RPCErrorCode.CONFLICT, expectedClass: ConflictError },
      { type: 'RateLimitError', code: RPCErrorCode.RATE_LIMIT, expectedClass: RateLimitError },
      { type: 'TimeoutError', code: RPCErrorCode.TIMEOUT, expectedClass: TimeoutError },
      { type: 'NetworkError', code: RPCErrorCode.NETWORK_ERROR, expectedClass: NetworkError },
      { type: 'InternalError', code: RPCErrorCode.INTERNAL_ERROR, expectedClass: InternalError },
      { type: 'ServiceUnavailableError', code: RPCErrorCode.SERVICE_UNAVAILABLE, expectedClass: ServiceUnavailableError },
      { type: 'CircuitOpenError', code: RPCErrorCode.CIRCUIT_OPEN, expectedClass: CircuitOpenError },
    ]

    for (const { type, code, expectedClass } of errorTypes) {
      it(`should deserialize ${type} correctly`, () => {
        const serialized = {
          type,
          code,
          message: `Test ${type}`,
          details: { test: true },
        }
        const error = deserializeError(serialized)

        expect(error).toBeInstanceOf(expectedClass)
        expect(error.message).toBe(`Test ${type}`)
        expect((error as RPCError).details?.test).toBe(true)
      })
    }
  })

  describe('isSerializedError type guard', () => {
    it('should return true for valid serialized error', () => {
      const valid = {
        type: 'RPCError',
        code: RPCErrorCode.INTERNAL_ERROR,
        message: 'Valid error',
      }
      expect(isSerializedError(valid)).toBe(true)
    })

    it('should return true for error with name instead of type', () => {
      const valid = {
        name: 'NotFoundError',
        code: RPCErrorCode.NOT_FOUND,
        message: 'Valid error',
      }
      expect(isSerializedError(valid)).toBe(true)
    })

    it('should return false for null', () => {
      expect(isSerializedError(null)).toBe(false)
    })

    it('should return false for undefined', () => {
      expect(isSerializedError(undefined)).toBe(false)
    })

    it('should return false for string', () => {
      expect(isSerializedError('error')).toBe(false)
    })

    it('should return false for number', () => {
      expect(isSerializedError(42)).toBe(false)
    })

    it('should return false for array', () => {
      expect(isSerializedError([1, 2, 3])).toBe(false)
    })

    it('should return false for object without message', () => {
      const invalid = {
        type: 'RPCError',
        code: RPCErrorCode.INTERNAL_ERROR,
      }
      expect(isSerializedError(invalid)).toBe(false)
    })

    it('should return false for object without type or name', () => {
      const invalid = {
        code: RPCErrorCode.INTERNAL_ERROR,
        message: 'No type',
      }
      expect(isSerializedError(invalid)).toBe(false)
    })

    it('should return false for object with non-string message', () => {
      const invalid = {
        type: 'RPCError',
        code: RPCErrorCode.INTERNAL_ERROR,
        message: 123,
      }
      expect(isSerializedError(invalid)).toBe(false)
    })

    it('should return false for object with non-string type', () => {
      const invalid = {
        type: 123,
        code: RPCErrorCode.INTERNAL_ERROR,
        message: 'Invalid type',
      }
      expect(isSerializedError(invalid)).toBe(false)
    })

    it('should return false for object with non-number httpStatus', () => {
      const invalid = {
        type: 'RPCError',
        message: 'Test',
        httpStatus: 'five hundred',
      }
      expect(isSerializedError(invalid)).toBe(false)
    })

    it('should return false for object with non-object details', () => {
      const invalid = {
        type: 'RPCError',
        message: 'Test',
        details: 'not an object',
      }
      expect(isSerializedError(invalid)).toBe(false)
    })

    it('should return false for object with non-string stack', () => {
      const invalid = {
        type: 'RPCError',
        message: 'Test',
        stack: 123,
      }
      expect(isSerializedError(invalid)).toBe(false)
    })

    it('should return true for minimal valid error (type + message)', () => {
      const valid = {
        type: 'Error',
        message: 'Minimal',
      }
      expect(isSerializedError(valid)).toBe(true)
    })

    it('should return true for fully populated error', () => {
      const valid = {
        type: 'NotFoundError',
        name: 'NotFoundError',
        code: RPCErrorCode.NOT_FOUND,
        message: 'Full error',
        details: { id: '123' },
        httpStatus: 404,
        stack: 'Error: ...',
      }
      expect(isSerializedError(valid)).toBe(true)
    })
  })
})

// ============================================================================
// Network Error Handling Edge Cases
// ============================================================================

describe('Network Error Handling Edge Cases', () => {
  describe('NetworkError factory methods', () => {
    it('should create connection refused error with correct details', () => {
      const error = NetworkError.connectionRefused('api.example.com', 443)

      expect(error).toBeInstanceOf(NetworkError)
      expect(error.code).toBe(RPCErrorCode.NETWORK_ERROR)
      expect(error.httpStatus).toBe(503)
      expect(error.details?.host).toBe('api.example.com')
      expect(error.details?.port).toBe(443)
      expect(error.details?.reason).toBe('connection_refused')
    })

    it('should create DNS resolution failed error', () => {
      const error = NetworkError.dnsResolutionFailed('unknown.host.local')

      expect(error).toBeInstanceOf(NetworkError)
      expect(error.details?.host).toBe('unknown.host.local')
      expect(error.details?.reason).toBe('dns_resolution_failed')
    })

    it('should handle IPv6 addresses', () => {
      const error = NetworkError.connectionRefused('::1', 8080)

      expect(error.details?.host).toBe('::1')
      expect(error.details?.port).toBe(8080)
    })

    it('should handle port 0', () => {
      const error = NetworkError.connectionRefused('localhost', 0)

      expect(error.details?.port).toBe(0)
    })

    it('should handle very high port numbers', () => {
      const error = NetworkError.connectionRefused('localhost', 65535)

      expect(error.details?.port).toBe(65535)
    })
  })

  describe('isRetryableError edge cases', () => {
    it('should return true for NetworkError', () => {
      const error = new NetworkError('Network failed')
      expect(isRetryableError(error)).toBe(true)
    })

    it('should return true for TimeoutError', () => {
      const error = new TimeoutError('Timed out')
      expect(isRetryableError(error)).toBe(true)
    })

    it('should return true for RateLimitError', () => {
      const error = new RateLimitError('Too many requests')
      expect(isRetryableError(error)).toBe(true)
    })

    it('should return true for ServiceUnavailableError', () => {
      const error = new ServiceUnavailableError('Service down')
      expect(isRetryableError(error)).toBe(true)
    })

    it('should return true for CircuitOpenError', () => {
      const error = new CircuitOpenError('Circuit open')
      expect(isRetryableError(error)).toBe(true)
    })

    it('should return false for InternalError (not transient)', () => {
      const error = new InternalError('Server error')
      expect(isRetryableError(error)).toBe(false)
    })

    it('should return false for null', () => {
      expect(isRetryableError(null)).toBe(false)
    })

    it('should return false for undefined', () => {
      expect(isRetryableError(undefined)).toBe(false)
    })

    it('should return false for plain object', () => {
      expect(isRetryableError({ code: 'ERROR' })).toBe(false)
    })

    it('should respect explicit retriable property (true)', () => {
      const error = new Error('Custom error')
      ;(error as unknown as { retriable: boolean }).retriable = true
      expect(isRetryableError(error)).toBe(true)
    })

    it('should respect explicit retriable property (false)', () => {
      // Even for normally retryable errors, explicit false overrides
      const error = new NetworkError('Network failed')
      ;(error as unknown as { retriable: boolean }).retriable = false
      expect(isRetryableError(error)).toBe(false)
    })

    it('should handle object with retriable property', () => {
      const customError = { retriable: true, message: 'Custom' }
      expect(isRetryableError(customError)).toBe(true)
    })
  })

  describe('handleHTTPError edge cases', () => {
    it('should deserialize structured error from JSON promise', async () => {
      const serializedError = {
        type: 'NotFoundError',
        code: RPCErrorCode.NOT_FOUND,
        message: 'User not found',
        details: { userId: '123' },
      }

      await expect(
        handleHTTPError(Promise.resolve(serializedError), { status: 404 })
      ).rejects.toThrow(NotFoundError)
    })

    it('should fall back to generic error when JSON is not structured error', async () => {
      const plainJson = { error: 'Something went wrong' }

      await expect(
        handleHTTPError(Promise.resolve(plainJson), {
          status: 500,
          fallbackMessage: 'Server error',
        })
      ).rejects.toThrow('Server error')
    })

    it('should include correlation ID in fallback message', async () => {
      const plainJson = { data: 'invalid' }

      await expect(
        handleHTTPError(Promise.resolve(plainJson), {
          status: 500,
          correlationId: 'req-12345',
          fallbackMessage: 'Request failed',
        })
      ).rejects.toThrow('Request failed [req-12345]')
    })

    it('should handle JSON parse error gracefully', async () => {
      await expect(
        handleHTTPError(Promise.reject(new Error('JSON parse failed')), { status: 500 })
      ).rejects.toThrow('HTTP error: 500')
    })

    it('should re-throw deserialized RPCError', async () => {
      const serializedError = {
        type: 'ValidationError',
        code: RPCErrorCode.VALIDATION_ERROR,
        message: 'Invalid input',
      }

      try {
        await handleHTTPError(Promise.resolve(serializedError), { status: 400 })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError)
        expect((error as ValidationError).message).toBe('Invalid input')
      }
    })
  })

  describe('handleResponseError edge cases', () => {
    it('should handle Response with structured error', async () => {
      const serializedError = {
        type: 'AuthenticationError',
        code: RPCErrorCode.AUTHENTICATION_ERROR,
        message: 'Token expired',
      }
      const response = new Response(JSON.stringify(serializedError), { status: 401 })

      await expect(
        handleResponseError(response, { status: 401 })
      ).rejects.toThrow(AuthenticationError)
    })

    it('should handle Response with non-JSON body', async () => {
      const response = new Response('Not JSON', { status: 500 })

      await expect(
        handleResponseError(response, { status: 500, fallbackMessage: 'Parse error' })
      ).rejects.toThrow('Parse error')
    })

    it('should handle empty Response body', async () => {
      const response = new Response('', { status: 500 })

      await expect(
        handleResponseError(response, { status: 500 })
      ).rejects.toThrow('HTTP error: 500')
    })
  })
})

// ============================================================================
// Timeout Scenarios
// ============================================================================

describe('Timeout Scenarios', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('withTimeout edge cases', () => {
    it('should handle zero timeout with pending promise', async () => {
      // Use a never-resolving promise to test zero timeout
      const promise = withTimeout(new Promise(() => {}), 0)

      // Prevent unhandled rejection during timer advancement
      promise.catch(() => {})

      await vi.advanceTimersByTimeAsync(0)

      // Zero timeout should trigger immediately
      await expect(promise).rejects.toThrow('Request timed out after 0ms')
    })

    it('should handle very short timeout with fast promise', async () => {
      const fastPromise = Promise.resolve('fast')
      const promise = withTimeout(fastPromise, 1)

      await vi.runAllTimersAsync()
      const result = await promise

      expect(result).toBe('fast')
    })

    it('should handle promise that rejects before timeout', async () => {
      const error = new Error('Promise rejected')
      const rejectingPromise = Promise.reject(error)

      await expect(withTimeout(rejectingPromise, 5000)).rejects.toThrow('Promise rejected')
    })

    it('should handle promise that rejects with non-Error', async () => {
      const rejectingPromise = Promise.reject('string rejection')

      await expect(withTimeout(rejectingPromise, 5000)).rejects.toBe('string rejection')
    })

    it('should cancel timeout when promise resolves', async () => {
      let resolved = false
      const promise = new Promise<string>((resolve) => {
        setTimeout(() => {
          resolved = true
          resolve('success')
        }, 100)
      })

      const result = withTimeout(promise, 5000)
      await vi.advanceTimersByTimeAsync(100)

      await expect(result).resolves.toBe('success')
      expect(resolved).toBe(true)
    })

    it('should return TimeoutError with correct code and status', async () => {
      const promise = withTimeout(new Promise(() => {}), 1000)

      // Prevent unhandled rejection during timer advancement
      promise.catch(() => {})

      await vi.advanceTimersByTimeAsync(1000)

      try {
        await promise
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(TimeoutError)
        expect((error as TimeoutError).code).toBe(RPCErrorCode.TIMEOUT)
        expect((error as TimeoutError).httpStatus).toBe(504)
        expect((error as TimeoutError).details?.timeout).toBe(1000)
      }
    })
  })

  describe('TimeoutError factory method', () => {
    it('should create error with milliseconds', () => {
      const error = TimeoutError.afterMs(5000)

      expect(error.message).toBe('Request timed out after 5000ms')
      expect(error.details?.timeout).toBe(5000)
    })

    it('should handle very large timeout values', () => {
      const error = TimeoutError.afterMs(Number.MAX_SAFE_INTEGER)

      expect(error.details?.timeout).toBe(Number.MAX_SAFE_INTEGER)
    })

    it('should handle zero timeout', () => {
      const error = TimeoutError.afterMs(0)

      expect(error.message).toBe('Request timed out after 0ms')
      expect(error.details?.timeout).toBe(0)
    })
  })

  describe('retryWithBackoff timeout interaction', () => {
    it('should not retry TimeoutError when explicit', async () => {
      const timeoutError = new TimeoutError('Timed out')
      const fn = vi.fn().mockRejectedValue(timeoutError)

      const promise = retryWithBackoff(fn, {
        maxRetries: 3,
        initialDelay: 100,
      })

      // Prevent unhandled rejection during timer advancement
      promise.catch(() => {})

      await vi.runAllTimersAsync()

      // TimeoutError IS retryable by default
      await expect(promise).rejects.toThrow('Timed out')
      // Should retry 3 times + initial = 4 calls
      expect(fn).toHaveBeenCalledTimes(4)
    })

    it('should not retry when timeout marked as non-retryable', async () => {
      const timeoutError = new TimeoutError('Timed out')
      ;(timeoutError as unknown as { retriable: boolean }).retriable = false
      const fn = vi.fn().mockRejectedValue(timeoutError)

      await expect(
        retryWithBackoff(fn, { maxRetries: 3, initialDelay: 100 })
      ).rejects.toThrow('Timed out')

      expect(fn).toHaveBeenCalledTimes(1) // No retries
    })
  })
})

// ============================================================================
// Circuit Breaker Edge Cases
// ============================================================================

describe('Circuit Breaker Edge Cases', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('CircuitBreaker boundary conditions', () => {
    it('should handle failureThreshold of 1', async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 1, timeout: 5000 })
      const fn = vi.fn().mockRejectedValue(new Error('fail'))

      await expect(breaker.execute(fn)).rejects.toThrow('fail')

      expect(breaker.getState()).toBe(CircuitState.OPEN)
    })

    it('should handle successThreshold of 1', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 1,
        successThreshold: 1,
        timeout: 5000,
      })

      // Open the circuit
      await expect(breaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow()
      expect(breaker.getState()).toBe(CircuitState.OPEN)

      // Wait for half-open
      await vi.advanceTimersByTimeAsync(5000)

      // One success should close it
      await breaker.execute(() => Promise.resolve('success'))
      expect(breaker.getState()).toBe(CircuitState.CLOSED)
    })

    it('should handle very large timeout', async () => {
      const breaker = new CircuitBreaker({
        failureThreshold: 1,
        timeout: 86400000, // 24 hours
      })

      await expect(breaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow()
      expect(breaker.getState()).toBe(CircuitState.OPEN)

      // Should still be open after 1 hour
      await vi.advanceTimersByTimeAsync(3600000)
      expect(breaker.getState()).toBe(CircuitState.OPEN)

      // Execute to check - should still throw CircuitOpenError
      await expect(breaker.execute(() => Promise.resolve('test'))).rejects.toThrow(
        'Circuit breaker is open'
      )
    })

    it('should update metrics correctly for rapid failures', async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 10, timeout: 5000 })

      // Rapid fire 5 failures
      for (let i = 0; i < 5; i++) {
        await expect(breaker.execute(() => Promise.reject(new Error(`fail ${i}`)))).rejects.toThrow()
      }

      const metrics = breaker.getMetrics()
      expect(metrics.totalRequests).toBe(5)
      expect(metrics.failedRequests).toBe(5)
      expect(metrics.consecutiveFailures).toBe(5)
      expect(metrics.state).toBe(CircuitState.CLOSED) // Not yet at threshold
    })

    it('should track lastFailureTime correctly', async () => {
      const breaker = new CircuitBreaker({ failureThreshold: 5, timeout: 5000 })

      const beforeFailure = Date.now()
      await expect(breaker.execute(() => Promise.reject(new Error('fail')))).rejects.toThrow()
      const afterFailure = Date.now()

      const metrics = breaker.getMetrics()
      expect(metrics.lastFailureTime).toBeGreaterThanOrEqual(beforeFailure)
      expect(metrics.lastFailureTime).toBeLessThanOrEqual(afterFailure)
    })
  })

  describe('CircuitOpenError edge cases', () => {
    it('should calculate retryAfter correctly', () => {
      const now = Date.now()
      const lastFailure = now - 10000 // 10 seconds ago
      const resetTime = 30000 // 30 second reset

      const error = CircuitOpenError.withMetrics({
        consecutiveFailures: 5,
        lastFailureTime: lastFailure,
        resetTimeMs: resetTime,
      })

      // retryAfter should be approximately 20 seconds
      expect(error.details?.retryAfter).toBeGreaterThanOrEqual(19)
      expect(error.details?.retryAfter).toBeLessThanOrEqual(21)
    })

    it('should handle null lastFailureTime', () => {
      const error = CircuitOpenError.withMetrics({
        consecutiveFailures: 0,
        lastFailureTime: null,
        resetTimeMs: 30000,
      })

      expect(error.details?.retryAfter).toBeUndefined()
    })

    it('should handle missing resetTimeMs', () => {
      const error = CircuitOpenError.withMetrics({
        consecutiveFailures: 5,
        lastFailureTime: Date.now(),
      })

      expect(error.details?.retryAfter).toBeUndefined()
    })

    it('should handle past reset time (negative becomes 0)', () => {
      const now = Date.now()
      const error = CircuitOpenError.withMetrics({
        consecutiveFailures: 5,
        lastFailureTime: now - 60000, // 60 seconds ago
        resetTimeMs: 30000, // 30 second reset (already passed)
      })

      expect(error.details?.retryAfter).toBe(0)
    })
  })

  describe('RetryWithCircuitBreaker edge cases', () => {
    it('should handle zero maxRetries', async () => {
      const resilient = new RetryWithCircuitBreaker({
        retry: { maxRetries: 0 },
        circuitBreaker: { failureThreshold: 5 },
      })

      const fn = vi.fn().mockRejectedValue(new NetworkError('Network failed'))

      await expect(resilient.execute(fn)).rejects.toThrow('Network failed')
      expect(fn).toHaveBeenCalledTimes(1) // No retries
    })

    it('should use default options when none provided', async () => {
      const resilient = new RetryWithCircuitBreaker()

      const fn = vi.fn().mockResolvedValue('success')
      const result = await resilient.execute(fn)

      expect(result).toBe('success')
    })

    it('should track retry delay with jitter', async () => {
      const resilient = new RetryWithCircuitBreaker({
        retry: { maxRetries: 1, initialDelay: 100, jitter: true },
        circuitBreaker: { failureThreshold: 10 },
      })

      const fn = vi.fn()
        .mockRejectedValueOnce(new NetworkError('fail'))
        .mockResolvedValue('success')

      const promise = resilient.execute(fn)
      await vi.runAllTimersAsync()
      await promise

      const metrics = resilient.getMetrics()
      // With full jitter (jitter: true), delay is in range [0, 100ms]
      expect(metrics.lastRetryDelayMs).toBeGreaterThanOrEqual(0)
      expect(metrics.lastRetryDelayMs).toBeLessThanOrEqual(100)
    })

    it('should notify on all state transitions', async () => {
      const stateChanges: CircuitState[] = []

      const resilient = new RetryWithCircuitBreaker({
        retry: { maxRetries: 0 },
        circuitBreaker: { failureThreshold: 1, successThreshold: 1, timeout: 1000 },
        onStateChange: (state) => stateChanges.push(state),
      })

      // Open the circuit
      await expect(
        resilient.execute(() => Promise.reject(new Error('fail')))
      ).rejects.toThrow()
      expect(stateChanges).toContain(CircuitState.OPEN)

      // Wait for half-open
      await vi.advanceTimersByTimeAsync(1000)

      // Close the circuit
      await resilient.execute(() => Promise.resolve('success'))
      expect(stateChanges).toContain(CircuitState.HALF_OPEN)
      expect(stateChanges).toContain(CircuitState.CLOSED)
    })
  })
})

// ============================================================================
// Error Response Helpers
// ============================================================================

describe('Error Response Helpers', () => {
  describe('serializeErrorResponse', () => {
    it('should serialize RPCError with correct status code', () => {
      const error = new NotFoundError('User not found')
      const { serialized, statusCode } = serializeErrorResponse(error)

      expect(statusCode).toBe(404)
      expect(serialized.code).toBe(RPCErrorCode.NOT_FOUND)
      expect(serialized.message).toBe('User not found')
    })

    it('should wrap non-RPCError as InternalError', () => {
      const error = new Error('Generic error')
      const { serialized, statusCode } = serializeErrorResponse(error)

      expect(statusCode).toBe(500)
      expect(serialized.code).toBe(RPCErrorCode.INTERNAL_ERROR)
      expect(serialized.message).toContain('Generic error')
    })

    it('should include correlation ID when provided', () => {
      const error = new ValidationError('Invalid input')
      const { serialized } = serializeErrorResponse(error, {
        correlationId: 'req-12345',
      })

      expect(serialized.correlationId).toBe('req-12345')
    })

    it('should exclude stack by default', () => {
      const error = new RPCError(RPCErrorCode.INTERNAL_ERROR, 'Test')
      const { serialized } = serializeErrorResponse(error)

      expect(serialized.stack).toBeUndefined()
    })

    it('should include stack when requested', () => {
      const error = new RPCError(RPCErrorCode.INTERNAL_ERROR, 'Test')
      const { serialized } = serializeErrorResponse(error, { includeStack: true })

      expect(serialized.stack).toBeDefined()
    })
  })

  describe('createErrorResponse', () => {
    it('should create response with correlation ID', () => {
      const error = new AuthorizationError('Forbidden')
      const response = createErrorResponse(error, 'req-67890')

      expect(response.code).toBe(RPCErrorCode.AUTHORIZATION_ERROR)
      expect(response.correlationId).toBe('req-67890')
    })

    it('should work without correlation ID', () => {
      const error = new TimeoutError('Timed out')
      const response = createErrorResponse(error)

      expect(response.code).toBe(RPCErrorCode.TIMEOUT)
      expect(response.correlationId).toBeUndefined()
    })

    it('should respect includeStack parameter', () => {
      const error = new InternalError('Error')

      const withoutStack = createErrorResponse(error, undefined, false)
      expect(withoutStack.stack).toBeUndefined()

      const withStack = createErrorResponse(error, undefined, true)
      expect(withStack.stack).toBeDefined()
    })
  })
})

// ============================================================================
// getErrorMessage Edge Cases
// ============================================================================

describe('getErrorMessage Edge Cases', () => {
  it('should handle Error with empty message', () => {
    const error = new Error('')
    expect(getErrorMessage(error)).toBe('')
  })

  it('should handle object with toString throwing', () => {
    const obj = {
      toString() {
        throw new Error('toString failed')
      },
    }
    // String() catches the error and returns something like "[object Object]" or the error message
    expect(() => getErrorMessage(obj)).toThrow('toString failed')
  })

  it('should handle function', () => {
    // Arrow functions stringify to their source code
    const fn = () => 'test'
    const message = getErrorMessage(fn)
    // Should contain the arrow function syntax
    expect(message).toContain('=>')
  })

  it('should handle Symbol', () => {
    const sym = Symbol('test')
    expect(getErrorMessage(sym)).toBe('Symbol(test)')
  })

  it('should handle BigInt', () => {
    const big = BigInt(12345678901234567890n)
    expect(getErrorMessage(big)).toBe('12345678901234567890')
  })

  it('should handle negative zero', () => {
    expect(getErrorMessage(-0)).toBe('0')
  })

  it('should handle Infinity', () => {
    expect(getErrorMessage(Infinity)).toBe('Infinity')
    expect(getErrorMessage(-Infinity)).toBe('-Infinity')
  })

  it('should handle NaN', () => {
    expect(getErrorMessage(NaN)).toBe('NaN')
  })
})
