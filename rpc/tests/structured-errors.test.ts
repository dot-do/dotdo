// Tests for Structured RPC Error Types
// TDD approach: write tests first, then implement

import { describe, it, expect } from 'vitest'

// Import the error types we'll implement
import {
  RPCError,
  RPCErrorCode,
  // Specific error types
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
  // Serialization
  serializeError,
  deserializeError,
  // Type guards
  isRPCError,
  isNotFoundError,
  isValidationError,
  isAuthenticationError,
  isAuthorizationError,
  isRetryableError,
} from '../errors'

describe('Structured RPC Error Types', () => {
  describe('RPCError base class', () => {
    it('should create an error with code, message, and details', () => {
      const error = new RPCError(
        RPCErrorCode.INTERNAL_ERROR,
        'Something went wrong',
        { context: 'test' }
      )

      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(RPCError)
      expect(error.code).toBe(RPCErrorCode.INTERNAL_ERROR)
      expect(error.message).toBe('Something went wrong')
      expect(error.details).toEqual({ context: 'test' })
      expect(error.name).toBe('RPCError')
    })

    it('should have an HTTP status code', () => {
      const error = new RPCError(RPCErrorCode.INTERNAL_ERROR, 'Error')
      expect(error.httpStatus).toBe(500)
    })

    it('should support cause chaining', () => {
      const cause = new Error('Original error')
      const error = new RPCError(
        RPCErrorCode.INTERNAL_ERROR,
        'Wrapped error',
        undefined,
        { cause }
      )

      expect(error.cause).toBe(cause)
    })

    it('should serialize to JSON', () => {
      const error = new RPCError(
        RPCErrorCode.TIMEOUT,
        'Request timed out',
        { timeout: 5000 }
      )

      const json = error.toJSON()

      expect(json.type).toBe('RPCError')
      expect(json.code).toBe(RPCErrorCode.TIMEOUT)
      expect(json.message).toBe('Request timed out')
      expect(json.details).toEqual({ timeout: 5000 })
    })
  })

  describe('NotFoundError', () => {
    it('should create error with correct code and status', () => {
      const error = new NotFoundError('User not found', {
        resourceType: 'User',
        resourceId: '123',
      })

      expect(error).toBeInstanceOf(RPCError)
      expect(error).toBeInstanceOf(NotFoundError)
      expect(error.code).toBe(RPCErrorCode.NOT_FOUND)
      expect(error.httpStatus).toBe(404)
      expect(error.message).toBe('User not found')
      expect(error.details?.resourceType).toBe('User')
      expect(error.details?.resourceId).toBe('123')
    })

    it('should use default message when not provided', () => {
      const error = new NotFoundError()
      expect(error.message).toBe('Resource not found')
    })

    it('should support resource type and ID helpers', () => {
      const error = NotFoundError.forResource('User', '123')

      expect(error.message).toBe('User with id 123 not found')
      expect(error.details?.resourceType).toBe('User')
      expect(error.details?.resourceId).toBe('123')
    })
  })

  describe('ValidationError', () => {
    it('should create error with validation details', () => {
      const error = new ValidationError('Invalid input', {
        field: 'email',
        constraint: 'must be a valid email',
        value: 'not-an-email',
      })

      expect(error.code).toBe(RPCErrorCode.VALIDATION_ERROR)
      expect(error.httpStatus).toBe(400)
      expect(error.details?.field).toBe('email')
    })

    it('should support multiple field errors', () => {
      const error = ValidationError.withErrors([
        { field: 'email', message: 'must be a valid email' },
        { field: 'age', message: 'must be positive' },
      ])

      expect(error.details?.errors).toHaveLength(2)
      expect(error.details?.errors[0].field).toBe('email')
      expect(error.details?.errors[1].field).toBe('age')
    })

    it('should support single field helper', () => {
      const error = ValidationError.forField('email', 'must be a valid email', 'bad-value')

      expect(error.details?.field).toBe('email')
      expect(error.details?.constraint).toBe('must be a valid email')
      expect(error.details?.value).toBe('bad-value')
    })
  })

  describe('AuthenticationError', () => {
    it('should create error with correct code and status', () => {
      const error = new AuthenticationError('Invalid credentials')

      expect(error.code).toBe(RPCErrorCode.AUTHENTICATION_ERROR)
      expect(error.httpStatus).toBe(401)
    })

    it('should support common authentication failure scenarios', () => {
      const expired = AuthenticationError.tokenExpired()
      expect(expired.message).toBe('Authentication token has expired')
      expect(expired.details?.reason).toBe('token_expired')

      const invalid = AuthenticationError.invalidCredentials()
      expect(invalid.message).toBe('Invalid credentials')
      expect(invalid.details?.reason).toBe('invalid_credentials')

      const missing = AuthenticationError.missingToken()
      expect(missing.message).toBe('Authentication token is required')
      expect(missing.details?.reason).toBe('missing_token')
    })
  })

  describe('AuthorizationError', () => {
    it('should create error with correct code and status', () => {
      const error = new AuthorizationError('Insufficient permissions')

      expect(error.code).toBe(RPCErrorCode.AUTHORIZATION_ERROR)
      expect(error.httpStatus).toBe(403)
    })

    it('should support permission details', () => {
      const error = AuthorizationError.insufficientPermissions(
        'delete',
        'Document',
        ['admin', 'owner']
      )

      expect(error.details?.action).toBe('delete')
      expect(error.details?.resource).toBe('Document')
      expect(error.details?.requiredRoles).toEqual(['admin', 'owner'])
    })
  })

  describe('ConflictError', () => {
    it('should create error with correct code and status', () => {
      const error = new ConflictError('Resource already exists')

      expect(error.code).toBe(RPCErrorCode.CONFLICT)
      expect(error.httpStatus).toBe(409)
    })

    it('should support conflict type details', () => {
      const error = ConflictError.resourceExists('User', 'email', 'test@example.com')

      expect(error.details?.resourceType).toBe('User')
      expect(error.details?.conflictField).toBe('email')
      expect(error.details?.conflictValue).toBe('test@example.com')
    })

    it('should support optimistic locking conflicts', () => {
      const error = ConflictError.versionMismatch('Document', '123', 5, 3)

      expect(error.message).toContain('Version mismatch')
      expect(error.details?.expectedVersion).toBe(5)
      expect(error.details?.actualVersion).toBe(3)
    })
  })

  describe('RateLimitError', () => {
    it('should create error with correct code and status', () => {
      const error = new RateLimitError('Too many requests')

      expect(error.code).toBe(RPCErrorCode.RATE_LIMIT)
      expect(error.httpStatus).toBe(429)
    })

    it('should include rate limit details', () => {
      const error = RateLimitError.exceeded({
        limit: 100,
        window: '1m',
        retryAfter: 30,
      })

      expect(error.details?.limit).toBe(100)
      expect(error.details?.window).toBe('1m')
      expect(error.details?.retryAfter).toBe(30)
    })
  })

  describe('TimeoutError', () => {
    it('should create error with correct code and status', () => {
      const error = new TimeoutError('Request timed out')

      expect(error.code).toBe(RPCErrorCode.TIMEOUT)
      expect(error.httpStatus).toBe(504)
    })

    it('should include timeout duration', () => {
      const error = TimeoutError.afterMs(5000)

      expect(error.message).toBe('Request timed out after 5000ms')
      expect(error.details?.timeout).toBe(5000)
    })
  })

  describe('NetworkError', () => {
    it('should create error with correct code and status', () => {
      const error = new NetworkError('Connection failed')

      expect(error.code).toBe(RPCErrorCode.NETWORK_ERROR)
      expect(error.httpStatus).toBe(503)
    })

    it('should support common network failure scenarios', () => {
      const connRefused = NetworkError.connectionRefused('localhost', 8080)
      expect(connRefused.details?.host).toBe('localhost')
      expect(connRefused.details?.port).toBe(8080)

      const dns = NetworkError.dnsResolutionFailed('api.example.com')
      expect(dns.details?.host).toBe('api.example.com')
      expect(dns.details?.reason).toBe('dns_resolution_failed')
    })
  })

  describe('InternalError', () => {
    it('should create error with correct code and status', () => {
      const error = new InternalError('Something went wrong')

      expect(error.code).toBe(RPCErrorCode.INTERNAL_ERROR)
      expect(error.httpStatus).toBe(500)
    })

    it('should wrap unknown errors', () => {
      const originalError = new Error('Database connection failed')
      const error = InternalError.wrap(originalError)

      expect(error.message).toBe('Internal error: Database connection failed')
      expect(error.cause).toBe(originalError)
    })

    it('should handle non-Error objects', () => {
      const error = InternalError.wrap('string error')

      expect(error.message).toBe('Internal error: string error')
    })
  })

  describe('ServiceUnavailableError', () => {
    it('should create error with correct code and status', () => {
      const error = new ServiceUnavailableError('Service temporarily unavailable')

      expect(error.code).toBe(RPCErrorCode.SERVICE_UNAVAILABLE)
      expect(error.httpStatus).toBe(503)
    })

    it('should support maintenance mode', () => {
      const error = ServiceUnavailableError.maintenance('2024-01-01T12:00:00Z')

      expect(error.details?.reason).toBe('maintenance')
      expect(error.details?.estimatedRecovery).toBe('2024-01-01T12:00:00Z')
    })
  })
})

describe('Error Serialization', () => {
  it('should serialize specific error types', () => {
    const error = new NotFoundError('User not found', {
      resourceType: 'User',
      resourceId: '123',
    })

    const serialized = serializeError(error)

    expect(serialized.type).toBe('NotFoundError')
    expect(serialized.code).toBe(RPCErrorCode.NOT_FOUND)
    expect(serialized.message).toBe('User not found')
    expect(serialized.details?.resourceType).toBe('User')
    expect(serialized.httpStatus).toBe(404)
  })

  it('should deserialize to specific error types', () => {
    const serialized = {
      type: 'NotFoundError',
      code: RPCErrorCode.NOT_FOUND,
      message: 'User not found',
      details: { resourceType: 'User', resourceId: '123' },
      httpStatus: 404,
    }

    const error = deserializeError(serialized)

    expect(error).toBeInstanceOf(NotFoundError)
    expect(error.message).toBe('User not found')
    expect(error.details?.resourceType).toBe('User')
  })

  it('should round-trip all error types', () => {
    const errors = [
      new NotFoundError('Not found'),
      new ValidationError('Invalid'),
      new AuthenticationError('Unauthenticated'),
      new AuthorizationError('Forbidden'),
      new ConflictError('Conflict'),
      new RateLimitError('Rate limited'),
      new TimeoutError('Timeout'),
      new NetworkError('Network error'),
      new InternalError('Internal error'),
      new ServiceUnavailableError('Unavailable'),
    ]

    for (const original of errors) {
      const serialized = serializeError(original)
      const deserialized = deserializeError(serialized)

      expect(deserialized.constructor.name).toBe(original.constructor.name)
      expect(deserialized.code).toBe(original.code)
      expect(deserialized.message).toBe(original.message)
      expect(deserialized.httpStatus).toBe(original.httpStatus)
    }
  })

  it('should handle unknown error types gracefully', () => {
    const serialized = {
      type: 'UnknownErrorType',
      code: 'UNKNOWN_CODE',
      message: 'Some error',
    }

    const error = deserializeError(serialized as any)

    expect(error).toBeInstanceOf(RPCError)
    expect(error.message).toBe('Some error')
  })

  it('should preserve stack traces when available', () => {
    const error = new NotFoundError('Not found')
    const serialized = serializeError(error, { includeStack: true })

    expect(serialized.stack).toBeDefined()
    expect(serialized.stack).toContain('NotFoundError')
  })

  it('should exclude stack traces by default in production-like serialization', () => {
    const error = new NotFoundError('Not found')
    const serialized = serializeError(error)

    // Default behavior includes stack, but production serialization should not
    const productionSerialized = serializeError(error, { includeStack: false })
    expect(productionSerialized.stack).toBeUndefined()
  })
})

describe('Error Type Guards', () => {
  it('should identify RPCError instances', () => {
    const rpcError = new RPCError(RPCErrorCode.INTERNAL_ERROR, 'Error')
    const genericError = new Error('Generic')

    expect(isRPCError(rpcError)).toBe(true)
    expect(isRPCError(genericError)).toBe(false)
    expect(isRPCError(null)).toBe(false)
    expect(isRPCError(undefined)).toBe(false)
    expect(isRPCError('string')).toBe(false)
  })

  it('should identify specific error types', () => {
    const notFound = new NotFoundError()
    const validation = new ValidationError('Invalid')
    const auth = new AuthenticationError()
    const authz = new AuthorizationError()

    expect(isNotFoundError(notFound)).toBe(true)
    expect(isNotFoundError(validation)).toBe(false)

    expect(isValidationError(validation)).toBe(true)
    expect(isValidationError(notFound)).toBe(false)

    expect(isAuthenticationError(auth)).toBe(true)
    expect(isAuthenticationError(authz)).toBe(false)

    expect(isAuthorizationError(authz)).toBe(true)
    expect(isAuthorizationError(auth)).toBe(false)
  })

  it('should identify retryable errors', () => {
    expect(isRetryableError(new NetworkError('Network'))).toBe(true)
    expect(isRetryableError(new TimeoutError('Timeout'))).toBe(true)
    expect(isRetryableError(new RateLimitError('Rate limit'))).toBe(true)
    expect(isRetryableError(new ServiceUnavailableError('Unavailable'))).toBe(true)

    expect(isRetryableError(new NotFoundError())).toBe(false)
    expect(isRetryableError(new ValidationError('Invalid'))).toBe(false)
    expect(isRetryableError(new AuthenticationError())).toBe(false)
    expect(isRetryableError(new AuthorizationError())).toBe(false)
    expect(isRetryableError(new ConflictError('Conflict'))).toBe(false)
  })
})

describe('Error Codes', () => {
  it('should define all required error codes', () => {
    expect(RPCErrorCode.NOT_FOUND).toBe('NOT_FOUND')
    expect(RPCErrorCode.VALIDATION_ERROR).toBe('VALIDATION_ERROR')
    expect(RPCErrorCode.AUTHENTICATION_ERROR).toBe('AUTHENTICATION_ERROR')
    expect(RPCErrorCode.AUTHORIZATION_ERROR).toBe('AUTHORIZATION_ERROR')
    expect(RPCErrorCode.CONFLICT).toBe('CONFLICT')
    expect(RPCErrorCode.RATE_LIMIT).toBe('RATE_LIMIT')
    expect(RPCErrorCode.TIMEOUT).toBe('TIMEOUT')
    expect(RPCErrorCode.NETWORK_ERROR).toBe('NETWORK_ERROR')
    expect(RPCErrorCode.INTERNAL_ERROR).toBe('INTERNAL_ERROR')
    expect(RPCErrorCode.SERVICE_UNAVAILABLE).toBe('SERVICE_UNAVAILABLE')
  })

  it('should map error codes to HTTP status codes', () => {
    const codeToStatus: Record<string, number> = {
      [RPCErrorCode.NOT_FOUND]: 404,
      [RPCErrorCode.VALIDATION_ERROR]: 400,
      [RPCErrorCode.AUTHENTICATION_ERROR]: 401,
      [RPCErrorCode.AUTHORIZATION_ERROR]: 403,
      [RPCErrorCode.CONFLICT]: 409,
      [RPCErrorCode.RATE_LIMIT]: 429,
      [RPCErrorCode.TIMEOUT]: 504,
      [RPCErrorCode.NETWORK_ERROR]: 503,
      [RPCErrorCode.INTERNAL_ERROR]: 500,
      [RPCErrorCode.SERVICE_UNAVAILABLE]: 503,
    }

    for (const [code, expectedStatus] of Object.entries(codeToStatus)) {
      const error = new RPCError(code as RPCErrorCode, 'Test')
      expect(error.httpStatus).toBe(expectedStatus)
    }
  })
})

describe('Wire Format Compatibility', () => {
  it('should produce JSON that can be transmitted over HTTP', () => {
    const error = ValidationError.withErrors([
      { field: 'email', message: 'Invalid email format' },
    ])

    const json = JSON.stringify(serializeError(error))
    const parsed = JSON.parse(json)

    // Should be able to reconstruct from parsed JSON
    const reconstructed = deserializeError(parsed)
    expect(reconstructed).toBeInstanceOf(ValidationError)
  })

  it('should handle special characters in messages', () => {
    const error = new ValidationError('Field "email" contains invalid <script> tags')

    const serialized = serializeError(error)
    const json = JSON.stringify(serialized)
    const parsed = JSON.parse(json)
    const reconstructed = deserializeError(parsed)

    expect(reconstructed.message).toBe('Field "email" contains invalid <script> tags')
  })

  it('should handle deeply nested details', () => {
    const error = new ValidationError('Complex validation failed', {
      nested: {
        deeply: {
          field: 'value',
          array: [1, 2, 3],
        },
      },
    })

    const serialized = serializeError(error)
    const reconstructed = deserializeError(serialized)

    expect(reconstructed.details?.nested?.deeply?.field).toBe('value')
    expect(reconstructed.details?.nested?.deeply?.array).toEqual([1, 2, 3])
  })
})
