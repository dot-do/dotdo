/**
 * Tests for rpc.do structured error types
 *
 * Issue: do-y5p2.8
 *
 * Tests cover:
 * 1. Error creation with codes, messages, and metadata
 * 2. Error serialization to JSON
 * 3. Error deserialization from JSON
 * 4. HTTP status code mapping
 * 5. Error type checking (instanceof)
 * 6. Error hierarchy
 *
 * @module rpc.do/tests/errors
 */

import { describe, it, expect } from 'vitest'
import {
  RPCError,
  ValidationError,
  NotFoundError,
  AuthError,
  NetworkError,
  TimeoutError,
  ErrorCode,
  ErrorHttpStatus,
  fromSerializedError,
  isRPCError,
  isSerializedError,
} from '../errors'
import type { SerializedError } from '../types'

describe('RPCError', () => {
  describe('creation', () => {
    it('creates with message only', () => {
      const error = new RPCError('Something went wrong')
      expect(error.message).toBe('Something went wrong')
      expect(error.code).toBe(ErrorCode.INTERNAL_ERROR)
      expect(error.httpStatus).toBe(ErrorHttpStatus.INTERNAL_SERVER_ERROR)
      expect(error.details).toBeUndefined()
      expect(error.type).toBe('RPCError')
      expect(error.name).toBe('RPCError')
    })

    it('creates with message and code', () => {
      const error = new RPCError('Custom error', 'CUSTOM_CODE')
      expect(error.message).toBe('Custom error')
      expect(error.code).toBe('CUSTOM_CODE')
      expect(error.httpStatus).toBe(ErrorHttpStatus.INTERNAL_SERVER_ERROR)
    })

    it('creates with message, code, and status', () => {
      const error = new RPCError('Bad request', ErrorCode.INVALID_ARGUMENT, ErrorHttpStatus.BAD_REQUEST)
      expect(error.code).toBe(ErrorCode.INVALID_ARGUMENT)
      expect(error.httpStatus).toBe(ErrorHttpStatus.BAD_REQUEST)
    })

    it('creates with message, code, status, and details', () => {
      const error = new RPCError('Error with details', 'CODE', 500, { context: 'test', value: 42 })
      expect(error.details).toEqual({ context: 'test', value: 42 })
    })

    it('is instanceof Error', () => {
      const error = new RPCError('Test')
      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(RPCError)
    })

    it('has stack trace', () => {
      const error = new RPCError('Test')
      expect(error.stack).toBeDefined()
      expect(error.stack).toContain('RPCError')
    })
  })

  describe('serialization', () => {
    it('serializes to JSON without details', () => {
      const error = new RPCError('Test message', 'TEST_CODE', 400)
      const json = error.toJSON()

      expect(json).toEqual({
        type: 'RPCError',
        code: 'TEST_CODE',
        message: 'Test message',
        httpStatus: 400,
      })
    })

    it('serializes to JSON with details', () => {
      const error = new RPCError('Test', 'CODE', 500, { key: 'value' })
      const json = error.toJSON()

      expect(json.details).toEqual({ key: 'value' })
    })

    it('produces valid SerializedError', () => {
      const error = new RPCError('Test', 'CODE', 500, { key: 'value' })
      const json = error.toJSON()

      expect(isSerializedError(json)).toBe(true)
    })
  })

  describe('deserialization', () => {
    it('deserializes from SerializedError', () => {
      const serialized: SerializedError = {
        type: 'RPCError',
        code: 'TEST_CODE',
        message: 'Test message',
        httpStatus: 500,
        details: { key: 'value' },
      }

      const error = RPCError.fromJSON(serialized)

      expect(error).toBeInstanceOf(RPCError)
      expect(error.message).toBe('Test message')
      expect(error.code).toBe('TEST_CODE')
      expect(error.httpStatus).toBe(500)
      expect(error.details).toEqual({ key: 'value' })
    })

    it('round-trips through JSON', () => {
      const original = new RPCError('Original', 'ORIGINAL_CODE', 503, { round: 'trip' })
      const serialized = original.toJSON()
      const restored = RPCError.fromJSON(serialized)

      expect(restored.message).toBe(original.message)
      expect(restored.code).toBe(original.code)
      expect(restored.httpStatus).toBe(original.httpStatus)
      expect(restored.details).toEqual(original.details)
    })
  })
})

describe('ValidationError', () => {
  it('creates with default values', () => {
    const error = new ValidationError('Invalid input')
    expect(error.message).toBe('Invalid input')
    expect(error.code).toBe(ErrorCode.VALIDATION_FAILED)
    expect(error.httpStatus).toBe(ErrorHttpStatus.BAD_REQUEST)
    expect(error.type).toBe('ValidationError')
    expect(error.name).toBe('ValidationError')
  })

  it('creates with custom code and details', () => {
    const error = new ValidationError('Email required', ErrorCode.MISSING_REQUIRED_FIELD, { field: 'email' })
    expect(error.code).toBe(ErrorCode.MISSING_REQUIRED_FIELD)
    expect(error.details).toEqual({ field: 'email' })
  })

  it('is instanceof RPCError', () => {
    const error = new ValidationError('Test')
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(RPCError)
    expect(error).toBeInstanceOf(ValidationError)
  })

  it('serializes with correct type', () => {
    const error = new ValidationError('Test')
    const json = error.toJSON()
    expect(json.type).toBe('ValidationError')
  })

  it('deserializes to ValidationError', () => {
    const serialized: SerializedError = {
      type: 'ValidationError',
      code: 'VALIDATION_FAILED',
      message: 'Invalid',
    }
    const error = fromSerializedError(serialized)
    expect(error).toBeInstanceOf(ValidationError)
  })
})

describe('NotFoundError', () => {
  it('creates with default values', () => {
    const error = new NotFoundError('Not found')
    expect(error.code).toBe(ErrorCode.NOT_FOUND)
    expect(error.httpStatus).toBe(ErrorHttpStatus.NOT_FOUND)
    expect(error.type).toBe('NotFoundError')
  })

  it('creates for method not found', () => {
    const error = new NotFoundError('Method not found: users.archive', ErrorCode.METHOD_NOT_FOUND)
    expect(error.code).toBe(ErrorCode.METHOD_NOT_FOUND)
    expect(error.httpStatus).toBe(404)
  })

  it('creates for resource not found', () => {
    const error = new NotFoundError('User not found', ErrorCode.RESOURCE_NOT_FOUND, { id: 'user-123' })
    expect(error.code).toBe(ErrorCode.RESOURCE_NOT_FOUND)
    expect(error.details).toEqual({ id: 'user-123' })
  })

  it('is instanceof RPCError', () => {
    const error = new NotFoundError('Test')
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(RPCError)
    expect(error).toBeInstanceOf(NotFoundError)
  })

  it('deserializes to NotFoundError', () => {
    const serialized: SerializedError = {
      type: 'NotFoundError',
      code: 'NOT_FOUND',
      message: 'Not found',
    }
    const error = fromSerializedError(serialized)
    expect(error).toBeInstanceOf(NotFoundError)
  })
})

describe('AuthError', () => {
  it('creates with default values (unauthorized)', () => {
    const error = new AuthError('Missing authentication')
    expect(error.code).toBe(ErrorCode.UNAUTHORIZED)
    expect(error.httpStatus).toBe(ErrorHttpStatus.UNAUTHORIZED)
    expect(error.type).toBe('AuthError')
  })

  it('creates forbidden error with 403 status', () => {
    const error = new AuthError('Insufficient permissions', ErrorCode.FORBIDDEN)
    expect(error.code).toBe(ErrorCode.FORBIDDEN)
    expect(error.httpStatus).toBe(ErrorHttpStatus.FORBIDDEN)
  })

  it('creates with token expired code', () => {
    const error = new AuthError('Token expired', ErrorCode.TOKEN_EXPIRED, { expiredAt: '2024-01-01' })
    expect(error.code).toBe(ErrorCode.TOKEN_EXPIRED)
    expect(error.httpStatus).toBe(ErrorHttpStatus.UNAUTHORIZED)
    expect(error.details).toEqual({ expiredAt: '2024-01-01' })
  })

  it('creates with invalid token code', () => {
    const error = new AuthError('Invalid token', ErrorCode.INVALID_TOKEN)
    expect(error.code).toBe(ErrorCode.INVALID_TOKEN)
    expect(error.httpStatus).toBe(ErrorHttpStatus.UNAUTHORIZED)
  })

  it('is instanceof RPCError', () => {
    const error = new AuthError('Test')
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(RPCError)
    expect(error).toBeInstanceOf(AuthError)
  })

  it('deserializes to AuthError', () => {
    const serialized: SerializedError = {
      type: 'AuthError',
      code: 'UNAUTHORIZED',
      message: 'Unauthorized',
    }
    const error = fromSerializedError(serialized)
    expect(error).toBeInstanceOf(AuthError)
  })
})

describe('NetworkError', () => {
  it('creates with default values', () => {
    const error = new NetworkError('Connection failed')
    expect(error.code).toBe(ErrorCode.NETWORK_ERROR)
    expect(error.httpStatus).toBe(ErrorHttpStatus.SERVICE_UNAVAILABLE)
    expect(error.type).toBe('NetworkError')
  })

  it('creates with connection refused', () => {
    const error = new NetworkError('Connection refused', ErrorCode.CONNECTION_REFUSED, { host: 'api.example.com' })
    expect(error.code).toBe(ErrorCode.CONNECTION_REFUSED)
    expect(error.details).toEqual({ host: 'api.example.com' })
  })

  it('creates with transport failed', () => {
    const error = new NetworkError('Transport failed', ErrorCode.TRANSPORT_FAILED)
    expect(error.code).toBe(ErrorCode.TRANSPORT_FAILED)
  })

  it('creates with connection closed', () => {
    const error = new NetworkError('Connection closed', ErrorCode.CONNECTION_CLOSED)
    expect(error.code).toBe(ErrorCode.CONNECTION_CLOSED)
  })

  it('is instanceof RPCError', () => {
    const error = new NetworkError('Test')
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(RPCError)
    expect(error).toBeInstanceOf(NetworkError)
  })

  it('deserializes to NetworkError', () => {
    const serialized: SerializedError = {
      type: 'NetworkError',
      code: 'NETWORK_ERROR',
      message: 'Network error',
    }
    const error = fromSerializedError(serialized)
    expect(error).toBeInstanceOf(NetworkError)
  })
})

describe('TimeoutError', () => {
  it('creates with default values', () => {
    const error = new TimeoutError('Request timed out')
    expect(error.code).toBe(ErrorCode.TIMEOUT)
    expect(error.httpStatus).toBe(ErrorHttpStatus.TIMEOUT)
    expect(error.type).toBe('TimeoutError')
  })

  it('creates with request timeout', () => {
    const error = new TimeoutError('Request timed out after 30000ms', ErrorCode.REQUEST_TIMEOUT, { timeout: 30000 })
    expect(error.code).toBe(ErrorCode.REQUEST_TIMEOUT)
    expect(error.details).toEqual({ timeout: 30000 })
  })

  it('creates with connection timeout', () => {
    const error = new TimeoutError('Connection timed out', ErrorCode.CONNECTION_TIMEOUT, { host: 'api.example.com' })
    expect(error.code).toBe(ErrorCode.CONNECTION_TIMEOUT)
    expect(error.details).toEqual({ host: 'api.example.com' })
  })

  it('is instanceof RPCError', () => {
    const error = new TimeoutError('Test')
    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(RPCError)
    expect(error).toBeInstanceOf(TimeoutError)
  })

  it('deserializes to TimeoutError', () => {
    const serialized: SerializedError = {
      type: 'TimeoutError',
      code: 'TIMEOUT',
      message: 'Timeout',
    }
    const error = fromSerializedError(serialized)
    expect(error).toBeInstanceOf(TimeoutError)
  })
})

describe('fromSerializedError', () => {
  it('creates correct error type for each type string', () => {
    const types: Array<[string, unknown]> = [
      ['ValidationError', ValidationError],
      ['NotFoundError', NotFoundError],
      ['AuthError', AuthError],
      ['NetworkError', NetworkError],
      ['TimeoutError', TimeoutError],
    ]

    for (const [typeName, ErrorClass] of types) {
      const serialized: SerializedError = {
        type: typeName,
        code: 'TEST',
        message: 'Test',
      }
      const error = fromSerializedError(serialized)
      expect(error).toBeInstanceOf(ErrorClass)
    }
  })

  it('falls back to RPCError for unknown types', () => {
    const serialized: SerializedError = {
      type: 'UnknownError',
      code: 'UNKNOWN',
      message: 'Unknown error',
      httpStatus: 418,
    }
    const error = fromSerializedError(serialized)

    expect(error).toBeInstanceOf(RPCError)
    expect(error).not.toBeInstanceOf(ValidationError)
    expect(error.httpStatus).toBe(418)
  })

  it('uses default httpStatus when not provided for unknown types', () => {
    const serialized: SerializedError = {
      type: 'CustomError',
      code: 'CUSTOM',
      message: 'Custom',
    }
    const error = fromSerializedError(serialized)
    expect(error.httpStatus).toBe(ErrorHttpStatus.INTERNAL_SERVER_ERROR)
  })

  it('preserves details through deserialization', () => {
    const serialized: SerializedError = {
      type: 'ValidationError',
      code: 'VALIDATION_FAILED',
      message: 'Invalid',
      details: { field: 'email', value: 'invalid' },
    }
    const error = fromSerializedError(serialized)
    expect(error.details).toEqual({ field: 'email', value: 'invalid' })
  })
})

describe('isRPCError', () => {
  it('returns true for RPCError instances', () => {
    expect(isRPCError(new RPCError('Test'))).toBe(true)
    expect(isRPCError(new ValidationError('Test'))).toBe(true)
    expect(isRPCError(new NotFoundError('Test'))).toBe(true)
    expect(isRPCError(new AuthError('Test'))).toBe(true)
    expect(isRPCError(new NetworkError('Test'))).toBe(true)
    expect(isRPCError(new TimeoutError('Test'))).toBe(true)
  })

  it('returns false for non-RPCError values', () => {
    expect(isRPCError(new Error('Test'))).toBe(false)
    expect(isRPCError('error')).toBe(false)
    expect(isRPCError(null)).toBe(false)
    expect(isRPCError(undefined)).toBe(false)
    expect(isRPCError({ message: 'error' })).toBe(false)
  })
})

describe('isSerializedError', () => {
  it('returns true for valid SerializedError objects', () => {
    expect(isSerializedError({ code: 'TEST', message: 'Test' })).toBe(true)
    expect(isSerializedError({ type: 'RPCError', code: 'TEST', message: 'Test' })).toBe(true)
    expect(isSerializedError({ type: 'ValidationError', code: 'VALIDATION_FAILED', message: 'Invalid', details: {} })).toBe(true)
  })

  it('returns false for invalid values', () => {
    expect(isSerializedError(null)).toBe(false)
    expect(isSerializedError(undefined)).toBe(false)
    expect(isSerializedError('error')).toBe(false)
    expect(isSerializedError(123)).toBe(false)
    expect(isSerializedError({})).toBe(false)
    expect(isSerializedError({ code: 'TEST' })).toBe(false) // missing message
    expect(isSerializedError({ message: 'Test' })).toBe(false) // missing code
    expect(isSerializedError({ code: 123, message: 'Test' })).toBe(false) // code not string
    expect(isSerializedError({ code: 'TEST', message: 123 })).toBe(false) // message not string
  })
})

describe('ErrorCode constants', () => {
  it('has all expected error codes', () => {
    // Generic
    expect(ErrorCode.INTERNAL_ERROR).toBe('INTERNAL_ERROR')
    expect(ErrorCode.UNKNOWN_ERROR).toBe('UNKNOWN_ERROR')

    // Validation
    expect(ErrorCode.VALIDATION_FAILED).toBe('VALIDATION_FAILED')
    expect(ErrorCode.INVALID_ARGUMENT).toBe('INVALID_ARGUMENT')
    expect(ErrorCode.MISSING_REQUIRED_FIELD).toBe('MISSING_REQUIRED_FIELD')
    expect(ErrorCode.INVALID_FORMAT).toBe('INVALID_FORMAT')

    // Not found
    expect(ErrorCode.NOT_FOUND).toBe('NOT_FOUND')
    expect(ErrorCode.METHOD_NOT_FOUND).toBe('METHOD_NOT_FOUND')
    expect(ErrorCode.RESOURCE_NOT_FOUND).toBe('RESOURCE_NOT_FOUND')
    expect(ErrorCode.PATH_NOT_FOUND).toBe('PATH_NOT_FOUND')

    // Auth
    expect(ErrorCode.UNAUTHORIZED).toBe('UNAUTHORIZED')
    expect(ErrorCode.FORBIDDEN).toBe('FORBIDDEN')
    expect(ErrorCode.INVALID_TOKEN).toBe('INVALID_TOKEN')
    expect(ErrorCode.TOKEN_EXPIRED).toBe('TOKEN_EXPIRED')

    // Network
    expect(ErrorCode.NETWORK_ERROR).toBe('NETWORK_ERROR')
    expect(ErrorCode.TRANSPORT_FAILED).toBe('TRANSPORT_FAILED')
    expect(ErrorCode.CONNECTION_CLOSED).toBe('CONNECTION_CLOSED')
    expect(ErrorCode.CONNECTION_REFUSED).toBe('CONNECTION_REFUSED')

    // Timeout
    expect(ErrorCode.TIMEOUT).toBe('TIMEOUT')
    expect(ErrorCode.REQUEST_TIMEOUT).toBe('REQUEST_TIMEOUT')
    expect(ErrorCode.CONNECTION_TIMEOUT).toBe('CONNECTION_TIMEOUT')
  })
})

describe('ErrorHttpStatus constants', () => {
  it('has correct HTTP status codes', () => {
    // 4xx
    expect(ErrorHttpStatus.BAD_REQUEST).toBe(400)
    expect(ErrorHttpStatus.UNAUTHORIZED).toBe(401)
    expect(ErrorHttpStatus.FORBIDDEN).toBe(403)
    expect(ErrorHttpStatus.NOT_FOUND).toBe(404)
    expect(ErrorHttpStatus.METHOD_NOT_ALLOWED).toBe(405)
    expect(ErrorHttpStatus.TIMEOUT).toBe(408)
    expect(ErrorHttpStatus.CONFLICT).toBe(409)
    expect(ErrorHttpStatus.UNPROCESSABLE_ENTITY).toBe(422)

    // 5xx
    expect(ErrorHttpStatus.INTERNAL_SERVER_ERROR).toBe(500)
    expect(ErrorHttpStatus.NOT_IMPLEMENTED).toBe(501)
    expect(ErrorHttpStatus.BAD_GATEWAY).toBe(502)
    expect(ErrorHttpStatus.SERVICE_UNAVAILABLE).toBe(503)
    expect(ErrorHttpStatus.GATEWAY_TIMEOUT).toBe(504)
  })
})

describe('HTTP status mapping', () => {
  it('maps ValidationError to 400 Bad Request', () => {
    const error = new ValidationError('Invalid')
    expect(error.httpStatus).toBe(400)
  })

  it('maps NotFoundError to 404 Not Found', () => {
    const error = new NotFoundError('Not found')
    expect(error.httpStatus).toBe(404)
  })

  it('maps AuthError to 401 Unauthorized by default', () => {
    const error = new AuthError('Unauthorized')
    expect(error.httpStatus).toBe(401)
  })

  it('maps AuthError with FORBIDDEN to 403 Forbidden', () => {
    const error = new AuthError('Forbidden', ErrorCode.FORBIDDEN)
    expect(error.httpStatus).toBe(403)
  })

  it('maps NetworkError to 503 Service Unavailable', () => {
    const error = new NetworkError('Network error')
    expect(error.httpStatus).toBe(503)
  })

  it('maps TimeoutError to 408 Request Timeout', () => {
    const error = new TimeoutError('Timeout')
    expect(error.httpStatus).toBe(408)
  })

  it('maps RPCError to 500 Internal Server Error by default', () => {
    const error = new RPCError('Error')
    expect(error.httpStatus).toBe(500)
  })
})

describe('error hierarchy', () => {
  it('all error types extend RPCError', () => {
    const errors = [
      new ValidationError('Test'),
      new NotFoundError('Test'),
      new AuthError('Test'),
      new NetworkError('Test'),
      new TimeoutError('Test'),
    ]

    for (const error of errors) {
      expect(error).toBeInstanceOf(RPCError)
    }
  })

  it('all error types extend Error', () => {
    const errors = [
      new RPCError('Test'),
      new ValidationError('Test'),
      new NotFoundError('Test'),
      new AuthError('Test'),
      new NetworkError('Test'),
      new TimeoutError('Test'),
    ]

    for (const error of errors) {
      expect(error).toBeInstanceOf(Error)
    }
  })

  it('error types are distinguishable via instanceof', () => {
    const validation = new ValidationError('Test')
    const notFound = new NotFoundError('Test')

    expect(validation).toBeInstanceOf(ValidationError)
    expect(validation).not.toBeInstanceOf(NotFoundError)
    expect(notFound).toBeInstanceOf(NotFoundError)
    expect(notFound).not.toBeInstanceOf(ValidationError)
  })
})
