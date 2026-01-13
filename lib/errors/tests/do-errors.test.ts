import { describe, it, expect } from 'vitest'
import {
  DOError,
  ValidationError,
  NotFoundError,
  AuthorizationError,
  TimeoutError,
  TransportError,
} from '../index'

describe('DOError hierarchy', () => {
  describe('DOError (base class)', () => {
    it('exists and extends Error', () => {
      const error = new DOError('BASE_ERROR', 'Something went wrong')
      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(DOError)
    })

    it('accepts code and message', () => {
      const error = new DOError('TEST_CODE', 'Test message')
      expect(error.code).toBe('TEST_CODE')
      expect(error.message).toBe('Test message')
    })

    it('accepts optional cause', () => {
      const cause = new Error('Original error')
      const error = new DOError('WRAPPED', 'Wrapped error', cause)
      expect(error.cause).toBe(cause)
    })

    it('returns class name via error.name', () => {
      const error = new DOError('CODE', 'message')
      expect(error.name).toBe('DOError')
    })

    it('serializes to JSON correctly', () => {
      const error = new DOError('JSON_TEST', 'JSON message')
      const json = error.toJSON()
      expect(json).toEqual({
        name: 'DOError',
        code: 'JSON_TEST',
        message: 'JSON message',
      })
    })

    it('serializes cause to JSON when present', () => {
      const cause = new Error('Cause message')
      const error = new DOError('WITH_CAUSE', 'Main message', cause)
      const json = error.toJSON()
      expect(json).toEqual({
        name: 'DOError',
        code: 'WITH_CAUSE',
        message: 'Main message',
        cause: {
          name: 'Error',
          message: 'Cause message',
        },
      })
    })

    it('captures stack trace', () => {
      const error = new DOError('STACK', 'Stack test')
      expect(error.stack).toBeDefined()
      expect(error.stack).toContain('DOError')
    })

    it('has default httpStatus of 500', () => {
      const error = new DOError('GENERIC', 'Generic error')
      expect(error.httpStatus).toBe(500)
    })

    it('can be thrown and caught', () => {
      expect(() => {
        throw new DOError('THROWN', 'Thrown error')
      }).toThrow(DOError)
    })

    it('can be caught with specific error matching', () => {
      try {
        throw new DOError('CATCH_TEST', 'Catch test')
      } catch (e) {
        expect(e).toBeInstanceOf(DOError)
        if (e instanceof DOError) {
          expect(e.code).toBe('CATCH_TEST')
        }
      }
    })
  })

  describe('ValidationError', () => {
    it('exists and extends DOError', () => {
      const error = new ValidationError('INVALID_INPUT', 'Invalid input')
      expect(error).toBeInstanceOf(DOError)
      expect(error).toBeInstanceOf(ValidationError)
    })

    it('accepts code and message', () => {
      const error = new ValidationError('REQUIRED_FIELD', 'Field is required')
      expect(error.code).toBe('REQUIRED_FIELD')
      expect(error.message).toBe('Field is required')
    })

    it('accepts optional cause', () => {
      const cause = new TypeError('Type mismatch')
      const error = new ValidationError('TYPE_ERROR', 'Invalid type', cause)
      expect(error.cause).toBe(cause)
    })

    it('returns class name via error.name', () => {
      const error = new ValidationError('CODE', 'message')
      expect(error.name).toBe('ValidationError')
    })

    it('has httpStatus of 400', () => {
      const error = new ValidationError('BAD_REQUEST', 'Bad request')
      expect(error.httpStatus).toBe(400)
    })

    it('serializes to JSON correctly', () => {
      const error = new ValidationError('VALIDATION', 'Validation failed')
      const json = error.toJSON()
      expect(json).toEqual({
        name: 'ValidationError',
        code: 'VALIDATION',
        message: 'Validation failed',
      })
    })

    it('can be thrown and caught', () => {
      expect(() => {
        throw new ValidationError('THROW_TEST', 'Throw test')
      }).toThrow(ValidationError)
    })

    it('can be caught as DOError', () => {
      expect(() => {
        throw new ValidationError('PARENT_CATCH', 'Parent catch')
      }).toThrow(DOError)
    })
  })

  describe('NotFoundError', () => {
    it('exists and extends DOError', () => {
      const error = new NotFoundError('RESOURCE_NOT_FOUND', 'Resource not found')
      expect(error).toBeInstanceOf(DOError)
      expect(error).toBeInstanceOf(NotFoundError)
    })

    it('accepts code and message', () => {
      const error = new NotFoundError('USER_NOT_FOUND', 'User does not exist')
      expect(error.code).toBe('USER_NOT_FOUND')
      expect(error.message).toBe('User does not exist')
    })

    it('accepts optional cause', () => {
      const cause = new Error('Database lookup failed')
      const error = new NotFoundError('LOOKUP_FAILED', 'Not found', cause)
      expect(error.cause).toBe(cause)
    })

    it('returns class name via error.name', () => {
      const error = new NotFoundError('CODE', 'message')
      expect(error.name).toBe('NotFoundError')
    })

    it('has httpStatus of 404', () => {
      const error = new NotFoundError('NOT_FOUND', 'Not found')
      expect(error.httpStatus).toBe(404)
    })

    it('serializes to JSON correctly', () => {
      const error = new NotFoundError('MISSING', 'Item missing')
      const json = error.toJSON()
      expect(json).toEqual({
        name: 'NotFoundError',
        code: 'MISSING',
        message: 'Item missing',
      })
    })

    it('can be thrown and caught', () => {
      expect(() => {
        throw new NotFoundError('THROW_TEST', 'Throw test')
      }).toThrow(NotFoundError)
    })
  })

  describe('AuthorizationError', () => {
    it('exists and extends DOError', () => {
      const error = new AuthorizationError('FORBIDDEN', 'Access denied')
      expect(error).toBeInstanceOf(DOError)
      expect(error).toBeInstanceOf(AuthorizationError)
    })

    it('accepts code and message', () => {
      const error = new AuthorizationError('NO_PERMISSION', 'Permission denied')
      expect(error.code).toBe('NO_PERMISSION')
      expect(error.message).toBe('Permission denied')
    })

    it('accepts optional cause', () => {
      const cause = new Error('Token expired')
      const error = new AuthorizationError('TOKEN_EXPIRED', 'Session expired', cause)
      expect(error.cause).toBe(cause)
    })

    it('returns class name via error.name', () => {
      const error = new AuthorizationError('CODE', 'message')
      expect(error.name).toBe('AuthorizationError')
    })

    it('has httpStatus of 403', () => {
      const error = new AuthorizationError('FORBIDDEN', 'Forbidden')
      expect(error.httpStatus).toBe(403)
    })

    it('serializes to JSON correctly', () => {
      const error = new AuthorizationError('ACCESS_DENIED', 'Access denied')
      const json = error.toJSON()
      expect(json).toEqual({
        name: 'AuthorizationError',
        code: 'ACCESS_DENIED',
        message: 'Access denied',
      })
    })

    it('can be thrown and caught', () => {
      expect(() => {
        throw new AuthorizationError('THROW_TEST', 'Throw test')
      }).toThrow(AuthorizationError)
    })
  })

  describe('TimeoutError', () => {
    it('exists and extends DOError', () => {
      const error = new TimeoutError('TIMEOUT', 'Operation timed out')
      expect(error).toBeInstanceOf(DOError)
      expect(error).toBeInstanceOf(TimeoutError)
    })

    it('accepts code and message', () => {
      const error = new TimeoutError('REQUEST_TIMEOUT', 'Request took too long')
      expect(error.code).toBe('REQUEST_TIMEOUT')
      expect(error.message).toBe('Request took too long')
    })

    it('accepts optional cause', () => {
      const cause = new Error('Socket timeout')
      const error = new TimeoutError('SOCKET_TIMEOUT', 'Connection timeout', cause)
      expect(error.cause).toBe(cause)
    })

    it('returns class name via error.name', () => {
      const error = new TimeoutError('CODE', 'message')
      expect(error.name).toBe('TimeoutError')
    })

    it('has httpStatus of 408', () => {
      const error = new TimeoutError('TIMEOUT', 'Timeout')
      expect(error.httpStatus).toBe(408)
    })

    it('serializes to JSON correctly', () => {
      const error = new TimeoutError('OP_TIMEOUT', 'Operation timeout')
      const json = error.toJSON()
      expect(json).toEqual({
        name: 'TimeoutError',
        code: 'OP_TIMEOUT',
        message: 'Operation timeout',
      })
    })

    it('can be thrown and caught', () => {
      expect(() => {
        throw new TimeoutError('THROW_TEST', 'Throw test')
      }).toThrow(TimeoutError)
    })
  })

  describe('TransportError', () => {
    it('exists and extends DOError', () => {
      const error = new TransportError('RPC_FAILED', 'RPC call failed')
      expect(error).toBeInstanceOf(DOError)
      expect(error).toBeInstanceOf(TransportError)
    })

    it('accepts code and message', () => {
      const error = new TransportError('HTTP_ERROR', 'HTTP request failed')
      expect(error.code).toBe('HTTP_ERROR')
      expect(error.message).toBe('HTTP request failed')
    })

    it('accepts optional cause', () => {
      const cause = new Error('Network unreachable')
      const error = new TransportError('NETWORK_ERROR', 'Network error', cause)
      expect(error.cause).toBe(cause)
    })

    it('returns class name via error.name', () => {
      const error = new TransportError('CODE', 'message')
      expect(error.name).toBe('TransportError')
    })

    it('has httpStatus of 502', () => {
      const error = new TransportError('BAD_GATEWAY', 'Bad gateway')
      expect(error.httpStatus).toBe(502)
    })

    it('serializes to JSON correctly', () => {
      const error = new TransportError('TRANSPORT_FAIL', 'Transport failure')
      const json = error.toJSON()
      expect(json).toEqual({
        name: 'TransportError',
        code: 'TRANSPORT_FAIL',
        message: 'Transport failure',
      })
    })

    it('can be thrown and caught', () => {
      expect(() => {
        throw new TransportError('THROW_TEST', 'Throw test')
      }).toThrow(TransportError)
    })
  })

  describe('Error hierarchy relationships', () => {
    it('all error types extend DOError', () => {
      const errors = [
        new ValidationError('V', 'v'),
        new NotFoundError('N', 'n'),
        new AuthorizationError('A', 'a'),
        new TimeoutError('T', 't'),
        new TransportError('TR', 'tr'),
      ]

      for (const error of errors) {
        expect(error).toBeInstanceOf(DOError)
        expect(error).toBeInstanceOf(Error)
      }
    })

    it('each error type has unique httpStatus', () => {
      expect(new DOError('D', 'd').httpStatus).toBe(500)
      expect(new ValidationError('V', 'v').httpStatus).toBe(400)
      expect(new NotFoundError('N', 'n').httpStatus).toBe(404)
      expect(new AuthorizationError('A', 'a').httpStatus).toBe(403)
      expect(new TimeoutError('T', 't').httpStatus).toBe(408)
      expect(new TransportError('TR', 'tr').httpStatus).toBe(502)
    })

    it('errors can be discriminated by instanceof', () => {
      const error: DOError = new ValidationError('V', 'v')

      if (error instanceof ValidationError) {
        expect(error.httpStatus).toBe(400)
      } else {
        throw new Error('Should have matched ValidationError')
      }
    })

    it('catch block can handle DOError and check specific type', () => {
      function throwValidation(): never {
        throw new ValidationError('INVALID', 'Invalid data')
      }

      try {
        throwValidation()
      } catch (e) {
        if (e instanceof DOError) {
          expect(e.code).toBe('INVALID')
          expect(e instanceof ValidationError).toBe(true)
        } else {
          throw new Error('Should have caught DOError')
        }
      }
    })
  })

  describe('Nested cause serialization', () => {
    it('serializes nested DOError cause', () => {
      const innerError = new NotFoundError('INNER', 'Inner not found')
      const outerError = new TransportError('OUTER', 'Outer transport error', innerError)
      const json = outerError.toJSON()

      expect(json).toEqual({
        name: 'TransportError',
        code: 'OUTER',
        message: 'Outer transport error',
        cause: {
          name: 'NotFoundError',
          code: 'INNER',
          message: 'Inner not found',
        },
      })
    })

    it('handles deeply nested causes', () => {
      const level1 = new Error('Level 1')
      const level2 = new ValidationError('L2', 'Level 2', level1)
      const level3 = new TransportError('L3', 'Level 3', level2)

      const json = level3.toJSON()
      expect(json.cause).toBeDefined()
      expect((json.cause as any).code).toBe('L2')
      expect((json.cause as any).cause).toBeDefined()
      expect((json.cause as any).cause.message).toBe('Level 1')
    })
  })

  describe('Stack trace behavior', () => {
    it('stack trace points to throw location', () => {
      function innerFunction() {
        throw new DOError('STACK_TEST', 'Stack trace test')
      }

      try {
        innerFunction()
      } catch (e) {
        expect(e).toBeInstanceOf(DOError)
        if (e instanceof DOError) {
          expect(e.stack).toContain('innerFunction')
        }
      }
    })

    it('stack trace includes error name', () => {
      const error = new ValidationError('STACK', 'Stack test')
      expect(error.stack).toContain('ValidationError')
    })
  })

  describe('Edge cases', () => {
    it('handles empty message', () => {
      const error = new DOError('EMPTY', '')
      expect(error.message).toBe('')
      expect(error.code).toBe('EMPTY')
    })

    it('handles empty code', () => {
      const error = new DOError('', 'Empty code')
      expect(error.code).toBe('')
      expect(error.message).toBe('Empty code')
    })

    it('handles undefined cause gracefully', () => {
      const error = new DOError('NO_CAUSE', 'No cause', undefined)
      expect(error.cause).toBeUndefined()
      const json = error.toJSON()
      expect(json.cause).toBeUndefined()
    })

    it('handles null-ish values in cause', () => {
      const error = new DOError('NULL_CAUSE', 'Null cause', null as any)
      expect(error.cause).toBeNull()
    })

    it('preserves special characters in message', () => {
      const specialMessage = 'Error: "quotes" and <brackets> & ampersand'
      const error = new DOError('SPECIAL', specialMessage)
      expect(error.message).toBe(specialMessage)
      expect(error.toJSON().message).toBe(specialMessage)
    })

    it('preserves unicode in message', () => {
      const unicodeMessage = 'Error: 你好世界 🚀 émoji'
      const error = new DOError('UNICODE', unicodeMessage)
      expect(error.message).toBe(unicodeMessage)
    })
  })
})
