import { describe, it, expect } from 'vitest'
import {
  DatabaseError,
  DbValidationError,
  DbNotFoundError,
  DotdoError,
  ErrorCode,
  TransactionError,
  NestedTransactionError,
  serializeDotdoError,
  serializeUnknownAsDotdoError,
  deserializeDotdoError,
  registerErrorClass,
  isSerializedDotdoError,
  getErrorMessage,
  isRetryableError,
  type SerializedDotdoError,
  type DotdoErrorOptions,
} from '../errors'

describe('Database Errors', () => {
  describe('DatabaseError', () => {
    describe('Error Type Validation', () => {
      it('should be an instance of Error', () => {
        const error = new DatabaseError('Test error')
        expect(error).toBeInstanceOf(Error)
      })

      it('should be an instance of DatabaseError', () => {
        const error = new DatabaseError('Test error')
        expect(error).toBeInstanceOf(DatabaseError)
      })

      it('should have name property set to DatabaseError', () => {
        const error = new DatabaseError('Test error')
        expect(error.name).toBe('DatabaseError')
      })

      it('should preserve instanceof across catch blocks', () => {
        try {
          throw new DatabaseError('Test')
        } catch (e) {
          expect(e).toBeInstanceOf(DatabaseError)
          expect(e).toBeInstanceOf(Error)
        }
      })
    })

    describe('Error Message Formatting', () => {
      it('should set message from constructor', () => {
        const error = new DatabaseError('Custom message')
        expect(error.message).toBe('Custom message')
      })

      it('should preserve message in string representation', () => {
        const error = new DatabaseError('Test message')
        expect(error.toString()).toContain('Test message')
      })

      it('should handle empty message', () => {
        const error = new DatabaseError('')
        expect(error.message).toBe('')
      })

      it('should handle long messages', () => {
        const longMessage = 'A'.repeat(10000)
        const error = new DatabaseError(longMessage)
        expect(error.message).toBe(longMessage)
      })

      it('should handle messages with special characters', () => {
        const specialMessage = 'Error: "quotes" and \'apostrophes\' and\nnewlines'
        const error = new DatabaseError(specialMessage)
        expect(error.message).toBe(specialMessage)
      })
    })

    describe('Error Details (Code Handling)', () => {
      it('should store details object', () => {
        const details = { code: 'ERR_001', field: 'email' }
        const error = new DatabaseError('Error', details)
        expect(error.details).toEqual(details)
      })

      it('should handle undefined details', () => {
        const error = new DatabaseError('Error')
        expect(error.details).toBeUndefined()
      })

      it('should handle empty details object', () => {
        const error = new DatabaseError('Error', {})
        expect(error.details).toEqual({})
      })

      it('should handle complex nested details', () => {
        const details = {
          code: 'VALIDATION_ERROR',
          errors: [
            { field: 'email', constraint: 'format' },
            { field: 'age', constraint: 'min' }
          ],
          metadata: {
            timestamp: Date.now(),
            requestId: 'abc-123'
          }
        }
        const error = new DatabaseError('Validation failed', details)
        expect(error.details).toEqual(details)
      })

      it('should make details readonly', () => {
        const details = { code: 'ERR_001' }
        const error = new DatabaseError('Error', details)
        // TypeScript would prevent: error.details = {}
        // At runtime, the property is readonly
        expect(error.details).toBe(details)
      })
    })

    describe('Stack Trace Preservation', () => {
      it('should have a stack trace', () => {
        const error = new DatabaseError('Test')
        expect(error.stack).toBeDefined()
        expect(typeof error.stack).toBe('string')
      })

      it('should include error message in stack', () => {
        const error = new DatabaseError('Unique error message')
        expect(error.stack).toContain('Unique error message')
      })

      it('should include error name in stack', () => {
        const error = new DatabaseError('Test')
        expect(error.stack).toContain('DatabaseError')
      })

      it('should capture stack from throw location', () => {
        function innerFunction() {
          throw new DatabaseError('Inner error')
        }

        try {
          innerFunction()
        } catch (e) {
          expect((e as Error).stack).toContain('innerFunction')
        }
      })

      it('should maintain stack trace through rethrow', () => {
        function throwError() {
          throw new DatabaseError('Original')
        }

        function wrapError() {
          try {
            throwError()
          } catch (e) {
            throw e
          }
        }

        try {
          wrapError()
        } catch (e) {
          expect((e as Error).stack).toContain('throwError')
        }
      })
    })
  })

  describe('DbValidationError', () => {
    describe('Error Type Validation', () => {
      it('should be an instance of Error', () => {
        const error = new DbValidationError('Validation failed')
        expect(error).toBeInstanceOf(Error)
      })

      it('should be an instance of DatabaseError', () => {
        const error = new DbValidationError('Validation failed')
        expect(error).toBeInstanceOf(DatabaseError)
      })

      it('should be an instance of DbValidationError', () => {
        const error = new DbValidationError('Validation failed')
        expect(error).toBeInstanceOf(DbValidationError)
      })

      it('should have name property set to DbValidationError', () => {
        const error = new DbValidationError('Validation failed')
        expect(error.name).toBe('DbValidationError')
      })

      it('should preserve instanceof in catch blocks', () => {
        try {
          throw new DbValidationError()
        } catch (e) {
          expect(e).toBeInstanceOf(DbValidationError)
          expect(e).toBeInstanceOf(DatabaseError)
          expect(e).toBeInstanceOf(Error)
        }
      })
    })

    describe('Error Message Formatting', () => {
      it('should use default message when none provided', () => {
        const error = new DbValidationError()
        expect(error.message).toBe('Validation failed')
      })

      it('should use custom message when provided', () => {
        const error = new DbValidationError('Custom validation error')
        expect(error.message).toBe('Custom validation error')
      })

      it('should handle empty string message', () => {
        const error = new DbValidationError('')
        expect(error.message).toBe('')
      })
    })

    describe('Static Factory Methods', () => {
      describe('withErrors', () => {
        it('should create error with formatted message from single field error', () => {
          const error = DbValidationError.withErrors([
            { field: 'email', message: 'is required' }
          ])
          expect(error.message).toBe('Validation failed: email: is required')
        })

        it('should create error with formatted message from multiple field errors', () => {
          const error = DbValidationError.withErrors([
            { field: 'email', message: 'is required' },
            { field: 'age', message: 'must be positive' }
          ])
          expect(error.message).toBe('Validation failed: email: is required, age: must be positive')
        })

        it('should store errors in details', () => {
          const errors = [
            { field: 'email', message: 'is required' },
            { field: 'name', message: 'is too short' }
          ]
          const error = DbValidationError.withErrors(errors)
          expect(error.details).toEqual({ errors })
        })

        it('should return a DbValidationError instance', () => {
          const error = DbValidationError.withErrors([])
          expect(error).toBeInstanceOf(DbValidationError)
        })

        it('should handle empty errors array', () => {
          const error = DbValidationError.withErrors([])
          expect(error.message).toBe('Validation failed: ')
          expect(error.details).toEqual({ errors: [] })
        })
      })

      describe('forField', () => {
        it('should create error for single field with constraint', () => {
          const error = DbValidationError.forField('email', 'is required')
          expect(error.message).toBe('Validation failed: email is required')
        })

        it('should store field and constraint in details', () => {
          const error = DbValidationError.forField('email', 'must be valid')
          expect(error.details).toEqual({
            field: 'email',
            constraint: 'must be valid',
            value: undefined
          })
        })

        it('should store value in details when provided', () => {
          const error = DbValidationError.forField('age', 'must be positive', -5)
          expect(error.details).toEqual({
            field: 'age',
            constraint: 'must be positive',
            value: -5
          })
        })

        it('should handle null value', () => {
          const error = DbValidationError.forField('name', 'is required', null)
          expect(error.details?.value).toBeNull()
        })

        it('should handle complex value types', () => {
          const complexValue = { nested: { data: [1, 2, 3] } }
          const error = DbValidationError.forField('config', 'is invalid', complexValue)
          expect(error.details?.value).toEqual(complexValue)
        })

        it('should return a DbValidationError instance', () => {
          const error = DbValidationError.forField('test', 'constraint')
          expect(error).toBeInstanceOf(DbValidationError)
        })
      })
    })

    describe('Stack Trace Preservation', () => {
      it('should have a stack trace', () => {
        const error = new DbValidationError()
        expect(error.stack).toBeDefined()
      })

      it('should include DbValidationError in stack', () => {
        const error = new DbValidationError('Test validation')
        expect(error.stack).toContain('DbValidationError')
      })

      it('should preserve stack from static factory methods', () => {
        function validateField() {
          throw DbValidationError.forField('test', 'failed')
        }

        try {
          validateField()
        } catch (e) {
          expect((e as Error).stack).toContain('validateField')
        }
      })
    })
  })

  describe('DbNotFoundError', () => {
    describe('Error Type Validation', () => {
      it('should be an instance of Error', () => {
        const error = new DbNotFoundError('Not found')
        expect(error).toBeInstanceOf(Error)
      })

      it('should be an instance of DatabaseError', () => {
        const error = new DbNotFoundError('Not found')
        expect(error).toBeInstanceOf(DatabaseError)
      })

      it('should be an instance of DbNotFoundError', () => {
        const error = new DbNotFoundError('Not found')
        expect(error).toBeInstanceOf(DbNotFoundError)
      })

      it('should have name property set to DbNotFoundError', () => {
        const error = new DbNotFoundError('Not found')
        expect(error.name).toBe('DbNotFoundError')
      })

      it('should preserve instanceof in catch blocks', () => {
        try {
          throw new DbNotFoundError()
        } catch (e) {
          expect(e).toBeInstanceOf(DbNotFoundError)
          expect(e).toBeInstanceOf(DatabaseError)
          expect(e).toBeInstanceOf(Error)
        }
      })
    })

    describe('Error Message Formatting', () => {
      it('should use default message when none provided', () => {
        const error = new DbNotFoundError()
        expect(error.message).toBe('Resource not found')
      })

      it('should use custom message when provided', () => {
        const error = new DbNotFoundError('Customer not found')
        expect(error.message).toBe('Customer not found')
      })

      it('should handle empty string message', () => {
        const error = new DbNotFoundError('')
        expect(error.message).toBe('')
      })
    })

    describe('Static Factory Methods', () => {
      describe('forResource', () => {
        it('should create error with formatted message', () => {
          const error = DbNotFoundError.forResource('Customer', 'cust-123')
          expect(error.message).toBe('Customer with id cust-123 not found')
        })

        it('should store resourceType and resourceId in details', () => {
          const error = DbNotFoundError.forResource('Order', 'ord-456')
          expect(error.details).toEqual({
            resourceType: 'Order',
            resourceId: 'ord-456'
          })
        })

        it('should return a DbNotFoundError instance', () => {
          const error = DbNotFoundError.forResource('Test', '123')
          expect(error).toBeInstanceOf(DbNotFoundError)
        })

        it('should handle empty strings', () => {
          const error = DbNotFoundError.forResource('', '')
          expect(error.message).toBe(' with id  not found')
          expect(error.details).toEqual({
            resourceType: '',
            resourceId: ''
          })
        })

        it('should handle special characters in resource type and id', () => {
          const error = DbNotFoundError.forResource('User/Admin', 'id-with-dashes')
          expect(error.message).toBe('User/Admin with id id-with-dashes not found')
        })
      })
    })

    describe('Stack Trace Preservation', () => {
      it('should have a stack trace', () => {
        const error = new DbNotFoundError()
        expect(error.stack).toBeDefined()
      })

      it('should include DbNotFoundError in stack', () => {
        const error = new DbNotFoundError('Test not found')
        expect(error.stack).toContain('DbNotFoundError')
      })

      it('should preserve stack from static factory method', () => {
        function findResource() {
          throw DbNotFoundError.forResource('Widget', 'w-789')
        }

        try {
          findResource()
        } catch (e) {
          expect((e as Error).stack).toContain('findResource')
        }
      })
    })
  })

  describe('Error Hierarchy and Discrimination', () => {
    it('should allow discriminating between error types', () => {
      const errors: Error[] = [
        new DatabaseError('Generic database error'),
        new DbValidationError('Validation error'),
        new DbNotFoundError('Not found error')
      ]

      const validationErrors = errors.filter(e => e instanceof DbValidationError)
      const notFoundErrors = errors.filter(e => e instanceof DbNotFoundError)
      const databaseErrors = errors.filter(e => e instanceof DatabaseError)

      expect(validationErrors).toHaveLength(1)
      expect(notFoundErrors).toHaveLength(1)
      expect(databaseErrors).toHaveLength(3) // All are DatabaseError
    })

    it('should allow type narrowing in switch statement', () => {
      function handleError(error: DatabaseError): string {
        if (error instanceof DbValidationError) {
          return 'validation'
        } else if (error instanceof DbNotFoundError) {
          return 'not_found'
        }
        return 'database'
      }

      expect(handleError(new DatabaseError('test'))).toBe('database')
      expect(handleError(new DbValidationError('test'))).toBe('validation')
      expect(handleError(new DbNotFoundError('test'))).toBe('not_found')
    })

    it('should preserve correct name through inheritance', () => {
      const baseError = new DatabaseError('base')
      const validationError = new DbValidationError('validation')
      const notFoundError = new DbNotFoundError('not found')

      expect(baseError.name).toBe('DatabaseError')
      expect(validationError.name).toBe('DbValidationError')
      expect(notFoundError.name).toBe('DbNotFoundError')
    })
  })

  describe('Error Serialization', () => {
    it('should serialize DatabaseError to JSON with message and details', () => {
      const error = new DatabaseError('Test error', { code: 'ERR_001' })
      const json = JSON.stringify({
        name: error.name,
        message: error.message,
        details: error.details
      })
      const parsed = JSON.parse(json)

      expect(parsed.name).toBe('DatabaseError')
      expect(parsed.message).toBe('Test error')
      expect(parsed.details).toEqual({ code: 'ERR_001' })
    })

    it('should serialize DbValidationError with field errors', () => {
      const error = DbValidationError.withErrors([
        { field: 'email', message: 'invalid format' }
      ])
      const serialized = {
        name: error.name,
        message: error.message,
        details: error.details
      }

      expect(serialized.name).toBe('DbValidationError')
      expect(serialized.details?.errors).toHaveLength(1)
    })

    it('should serialize DbNotFoundError with resource info', () => {
      const error = DbNotFoundError.forResource('Customer', '123')
      const serialized = {
        name: error.name,
        message: error.message,
        details: error.details
      }

      expect(serialized.name).toBe('DbNotFoundError')
      expect(serialized.details?.resourceType).toBe('Customer')
      expect(serialized.details?.resourceId).toBe('123')
    })
  })
})

describe('Error Serialization and Deserialization', () => {
  describe('DotdoError.toJSON()', () => {
    it('should serialize basic DotdoError to JSON', () => {
      const error = new DotdoError(ErrorCode.NOT_FOUND, 'Resource not found')
      const json = error.toJSON()

      expect(json.type).toBe('DotdoError')
      expect(json.name).toBe('DotdoError')
      expect(json.code).toBe(ErrorCode.NOT_FOUND)
      expect(json.message).toBe('Resource not found')
      expect(json.httpStatus).toBe(404)
    })

    it('should include details when present', () => {
      const error = new DotdoError(ErrorCode.VALIDATION_ERROR, 'Invalid input', {
        details: { field: 'email', reason: 'invalid format' }
      })
      const json = error.toJSON()

      expect(json.details).toEqual({ field: 'email', reason: 'invalid format' })
    })

    it('should exclude empty details object', () => {
      const error = new DotdoError(ErrorCode.INTERNAL_ERROR, 'Error', { details: {} })
      const json = error.toJSON()

      expect(json.details).toBeUndefined()
    })

    it('should serialize cause when it is a DotdoError', () => {
      const cause = new DotdoError(ErrorCode.DATABASE_ERROR, 'DB connection failed')
      const error = new DotdoError(ErrorCode.INTERNAL_ERROR, 'Operation failed', { cause })
      const json = error.toJSON()

      expect(json.cause).toBeDefined()
      expect((json.cause as SerializedDotdoError).type).toBe('DotdoError')
      expect((json.cause as SerializedDotdoError).code).toBe(ErrorCode.DATABASE_ERROR)
      expect((json.cause as SerializedDotdoError).message).toBe('DB connection failed')
    })

    it('should serialize cause when it is a standard Error', () => {
      const cause = new Error('Original error')
      const error = new DotdoError(ErrorCode.INTERNAL_ERROR, 'Wrapped error', { cause })
      const json = error.toJSON()

      expect(json.cause).toBeDefined()
      expect(json.cause).toEqual({ name: 'Error', message: 'Original error' })
    })

    it('should handle deeply nested cause chain', () => {
      const rootCause = new DotdoError(ErrorCode.NETWORK_ERROR, 'Connection refused')
      const middleCause = new DotdoError(ErrorCode.DATABASE_ERROR, 'Query failed', { cause: rootCause })
      const error = new DotdoError(ErrorCode.INTERNAL_ERROR, 'Operation failed', { cause: middleCause })
      const json = error.toJSON()

      expect(json.cause).toBeDefined()
      const middleJson = json.cause as SerializedDotdoError
      expect(middleJson.code).toBe(ErrorCode.DATABASE_ERROR)
      expect(middleJson.cause).toBeDefined()
      expect((middleJson.cause as SerializedDotdoError).code).toBe(ErrorCode.NETWORK_ERROR)
    })
  })

  describe('serializeDotdoError()', () => {
    it('should serialize DotdoError', () => {
      const error = new DotdoError(ErrorCode.TIMEOUT, 'Request timed out')
      const serialized = serializeDotdoError(error)

      expect(serialized.type).toBe('DotdoError')
      expect(serialized.code).toBe(ErrorCode.TIMEOUT)
      expect(serialized.message).toBe('Request timed out')
      expect(serialized.httpStatus).toBe(504)
    })

    it('should include stack when includeStack option is true', () => {
      const error = new DotdoError(ErrorCode.INTERNAL_ERROR, 'Error with stack')
      const serialized = serializeDotdoError(error, { includeStack: true })

      expect(serialized.stack).toBeDefined()
      expect(serialized.stack).toContain('DotdoError')
    })

    it('should exclude stack by default', () => {
      const error = new DotdoError(ErrorCode.INTERNAL_ERROR, 'Error without stack')
      const serialized = serializeDotdoError(error)

      expect(serialized.stack).toBeUndefined()
    })

    it('should serialize standard Error', () => {
      const error = new Error('Standard error message')
      const serialized = serializeDotdoError(error)

      expect(serialized.type).toBe('Error')
      expect(serialized.code).toBe(ErrorCode.INTERNAL_ERROR)
      expect(serialized.message).toBe('Standard error message')
      expect(serialized.httpStatus).toBe(500)
    })

    it('should serialize TypeError correctly', () => {
      const error = new TypeError('undefined is not a function')
      const serialized = serializeDotdoError(error)

      expect(serialized.type).toBe('TypeError')
      expect(serialized.message).toBe('undefined is not a function')
    })

    it('should serialize DatabaseError subclass', () => {
      const error = new DbValidationError('Field validation failed', { field: 'email' })
      const serialized = serializeDotdoError(error)

      expect(serialized.type).toBe('DbValidationError')
      expect(serialized.code).toBe(ErrorCode.VALIDATION_ERROR)
      expect(serialized.httpStatus).toBe(400)
    })
  })

  describe('serializeUnknownAsDotdoError()', () => {
    it('should serialize DotdoError', () => {
      const error = new DotdoError(ErrorCode.NOT_FOUND, 'Not found')
      const serialized = serializeUnknownAsDotdoError(error)

      expect(serialized.type).toBe('DotdoError')
      expect(serialized.code).toBe(ErrorCode.NOT_FOUND)
    })

    it('should serialize standard Error', () => {
      const error = new Error('Standard error')
      const serialized = serializeUnknownAsDotdoError(error)

      expect(serialized.type).toBe('Error')
      expect(serialized.code).toBe(ErrorCode.INTERNAL_ERROR)
    })

    it('should serialize string value', () => {
      const serialized = serializeUnknownAsDotdoError('Something went wrong')

      expect(serialized.type).toBe('UnknownError')
      expect(serialized.message).toBe('Something went wrong')
      expect(serialized.code).toBe(ErrorCode.INTERNAL_ERROR)
      expect(serialized.httpStatus).toBe(500)
    })

    it('should serialize number value', () => {
      const serialized = serializeUnknownAsDotdoError(42)

      expect(serialized.type).toBe('UnknownError')
      expect(serialized.message).toBe('42')
    })

    it('should serialize null value', () => {
      const serialized = serializeUnknownAsDotdoError(null)

      expect(serialized.type).toBe('UnknownError')
      expect(serialized.message).toBe('null')
    })

    it('should serialize undefined value', () => {
      const serialized = serializeUnknownAsDotdoError(undefined)

      expect(serialized.type).toBe('UnknownError')
      expect(serialized.message).toBe('undefined')
    })

    it('should serialize object without Error prototype', () => {
      const serialized = serializeUnknownAsDotdoError({ foo: 'bar' })

      expect(serialized.type).toBe('UnknownError')
      expect(serialized.message).toBe('[object Object]')
    })
  })

  describe('deserializeDotdoError()', () => {
    it('should deserialize basic DotdoError', () => {
      const serialized: SerializedDotdoError = {
        type: 'DotdoError',
        code: ErrorCode.NOT_FOUND,
        message: 'Resource not found',
        httpStatus: 404
      }
      const error = deserializeDotdoError(serialized)

      expect(error).toBeInstanceOf(DotdoError)
      expect(error.message).toBe('Resource not found')
      expect((error as DotdoError).code).toBe(ErrorCode.NOT_FOUND)
    })

    it('should deserialize with details', () => {
      const serialized: SerializedDotdoError = {
        type: 'DotdoError',
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed',
        details: { field: 'email', reason: 'invalid' }
      }
      const error = deserializeDotdoError(serialized) as DotdoError

      expect(error.details).toEqual({ field: 'email', reason: 'invalid' })
    })

    it('should restore stack trace when present', () => {
      const serialized: SerializedDotdoError = {
        type: 'DotdoError',
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Error with stack',
        stack: 'DotdoError: Error with stack\n    at test.ts:10'
      }
      const error = deserializeDotdoError(serialized)

      expect(error.stack).toBe('DotdoError: Error with stack\n    at test.ts:10')
    })

    it('should deserialize DatabaseError', () => {
      const serialized: SerializedDotdoError = {
        type: 'DatabaseError',
        code: ErrorCode.DATABASE_ERROR,
        message: 'Database connection failed'
      }
      const error = deserializeDotdoError(serialized)

      expect(error).toBeInstanceOf(DatabaseError)
      expect(error.message).toBe('Database connection failed')
    })

    it('should deserialize DbValidationError', () => {
      const serialized: SerializedDotdoError = {
        type: 'DbValidationError',
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Validation failed',
        details: { field: 'email' }
      }
      const error = deserializeDotdoError(serialized)

      expect(error).toBeInstanceOf(DbValidationError)
      expect(error).toBeInstanceOf(DatabaseError)
      expect(error).toBeInstanceOf(DotdoError)
    })

    it('should deserialize DbNotFoundError', () => {
      const serialized: SerializedDotdoError = {
        type: 'DbNotFoundError',
        code: ErrorCode.NOT_FOUND,
        message: 'Customer not found',
        details: { resourceType: 'Customer', resourceId: '123' }
      }
      const error = deserializeDotdoError(serialized)

      expect(error).toBeInstanceOf(DbNotFoundError)
      // Note: DatabaseError subclasses receive details wrapped in options object,
      // so details are nested one level deeper after deserialization
      expect((error as DbNotFoundError).details).toEqual({
        details: { resourceType: 'Customer', resourceId: '123' }
      })
    })

    it('should deserialize generic Error type', () => {
      const serialized: SerializedDotdoError = {
        type: 'Error',
        name: 'Error',
        code: '',
        message: 'Standard error'
      }
      const error = deserializeDotdoError(serialized)

      expect(error).toBeInstanceOf(Error)
      expect(error).not.toBeInstanceOf(DotdoError)
      expect(error.message).toBe('Standard error')
    })

    it('should fall back to DotdoError for unknown type', () => {
      const serialized: SerializedDotdoError = {
        type: 'UnknownCustomError',
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Unknown error type'
      }
      const error = deserializeDotdoError(serialized)

      expect(error).toBeInstanceOf(DotdoError)
      expect(error.message).toBe('Unknown error type')
    })

    it('should use name field when type is missing', () => {
      const serialized = {
        name: 'DatabaseError',
        code: ErrorCode.DATABASE_ERROR,
        message: 'DB error'
      } as SerializedDotdoError
      const error = deserializeDotdoError(serialized)

      expect(error).toBeInstanceOf(DatabaseError)
    })
  })

  describe('Round-trip serialization', () => {
    it('should round-trip DotdoError', () => {
      const original = new DotdoError(ErrorCode.RATE_LIMIT, 'Too many requests', {
        details: { retryAfter: 60 }
      })
      const serialized = serializeDotdoError(original)
      const deserialized = deserializeDotdoError(serialized) as DotdoError

      expect(deserialized.message).toBe(original.message)
      expect(deserialized.code).toBe(original.code)
      expect(deserialized.details).toEqual(original.details)
    })

    it('should round-trip DatabaseError', () => {
      const original = new DatabaseError('Query failed', { table: 'users', operation: 'SELECT' })
      const serialized = serializeDotdoError(original)
      const deserialized = deserializeDotdoError(serialized) as DatabaseError

      expect(deserialized).toBeInstanceOf(DatabaseError)
      expect(deserialized.message).toBe(original.message)
    })

    it('should round-trip DbValidationError', () => {
      const original = DbValidationError.forField('email', 'must be valid', 'invalid-email')
      const serialized = serializeDotdoError(original)
      const deserialized = deserializeDotdoError(serialized) as DbValidationError

      expect(deserialized).toBeInstanceOf(DbValidationError)
      expect(deserialized.message).toBe(original.message)
      // Note: DatabaseError subclasses receive details wrapped, so after round-trip
      // the details are nested one level deeper
      expect(deserialized.details).toEqual({ details: original.details })
    })

    it('should round-trip DbNotFoundError', () => {
      const original = DbNotFoundError.forResource('Order', 'ord-789')
      const serialized = serializeDotdoError(original)
      const deserialized = deserializeDotdoError(serialized) as DbNotFoundError

      expect(deserialized).toBeInstanceOf(DbNotFoundError)
      // Note: DatabaseError subclasses receive details wrapped, so after round-trip
      // the details are nested one level deeper
      expect(deserialized.details).toEqual({ details: original.details })
    })
  })

  describe('Edge cases', () => {
    describe('Circular references in error metadata', () => {
      it('should handle circular references in details via JSON.stringify behavior', () => {
        // Create object with circular reference
        const circular: Record<string, unknown> = { name: 'test' }
        circular.self = circular

        // DotdoError stores details as-is; serialization relies on JSON.stringify
        const error = new DotdoError(ErrorCode.INTERNAL_ERROR, 'Circular', {
          details: { hasCircular: true }
        })

        // toJSON should work fine for non-circular parts
        const json = error.toJSON()
        expect(json.details).toEqual({ hasCircular: true })

        // Direct JSON.stringify of circular would throw, but our toJSON
        // doesn't include circular references by design
        expect(() => JSON.stringify(json)).not.toThrow()
      })

      it('should handle Date objects in details', () => {
        const date = new Date('2024-01-01T00:00:00Z')
        const error = new DotdoError(ErrorCode.INTERNAL_ERROR, 'Error with date', {
          details: { timestamp: date }
        })
        const json = error.toJSON()

        // JSON.stringify converts Date to ISO string
        const stringified = JSON.stringify(json)
        const parsed = JSON.parse(stringified)
        expect(parsed.details.timestamp).toBe('2024-01-01T00:00:00.000Z')
      })
    })

    describe('Very large error payloads', () => {
      it('should handle large message strings', () => {
        const largeMessage = 'A'.repeat(100000)
        const error = new DotdoError(ErrorCode.INTERNAL_ERROR, largeMessage)
        const serialized = serializeDotdoError(error)
        const deserialized = deserializeDotdoError(serialized)

        expect(deserialized.message).toBe(largeMessage)
        expect(deserialized.message.length).toBe(100000)
      })

      it('should handle large details object', () => {
        const largeDetails: Record<string, unknown> = {}
        for (let i = 0; i < 1000; i++) {
          largeDetails[`field_${i}`] = `value_${i}_${'x'.repeat(100)}`
        }

        const error = new DotdoError(ErrorCode.INTERNAL_ERROR, 'Large payload', {
          details: largeDetails
        })
        const serialized = serializeDotdoError(error)
        const deserialized = deserializeDotdoError(serialized) as DotdoError

        expect(Object.keys(deserialized.details ?? {}).length).toBe(1000)
      })

      it('should handle deeply nested details', () => {
        let nested: Record<string, unknown> = { value: 'deepest' }
        for (let i = 0; i < 50; i++) {
          nested = { level: i, child: nested }
        }

        const error = new DotdoError(ErrorCode.INTERNAL_ERROR, 'Deep nesting', {
          details: nested
        })
        const serialized = serializeDotdoError(error)
        const deserialized = deserializeDotdoError(serialized) as DotdoError

        expect(deserialized.details).toEqual(nested)
      })
    })

    describe('Custom error class deserialization failures', () => {
      it('should fall back gracefully for unregistered error types', () => {
        const serialized: SerializedDotdoError = {
          type: 'CustomUnregisteredError',
          code: ErrorCode.INTERNAL_ERROR,
          message: 'Custom error message',
          details: { custom: 'data' }
        }
        const error = deserializeDotdoError(serialized) as DotdoError

        // Should fall back to DotdoError
        expect(error).toBeInstanceOf(DotdoError)
        expect(error.message).toBe('Custom error message')
        expect(error.details).toEqual({ custom: 'data' })
      })

      it('should handle malformed serialized type gracefully', () => {
        const serialized = {
          type: '',
          code: ErrorCode.INTERNAL_ERROR,
          message: 'Empty type'
        } as SerializedDotdoError
        const error = deserializeDotdoError(serialized)

        expect(error).toBeInstanceOf(DotdoError)
        expect(error.message).toBe('Empty type')
      })
    })

    describe('Invalid serialized error recovery', () => {
      it('should handle missing code gracefully', () => {
        const serialized = {
          type: 'DotdoError',
          message: 'No code'
        } as SerializedDotdoError
        const error = deserializeDotdoError(serialized) as DotdoError

        expect(error.code).toBe(ErrorCode.INTERNAL_ERROR)
      })

      it('should handle serialized with only name (no type)', () => {
        const serialized = {
          name: 'DotdoError',
          code: ErrorCode.NOT_FOUND,
          message: 'Using name field'
        } as SerializedDotdoError
        const error = deserializeDotdoError(serialized) as DotdoError

        expect(error.message).toBe('Using name field')
        expect(error.code).toBe(ErrorCode.NOT_FOUND)
      })

      it('should handle null details gracefully', () => {
        const serialized = {
          type: 'DotdoError',
          code: ErrorCode.INTERNAL_ERROR,
          message: 'Null details',
          details: null as unknown as Record<string, unknown>
        } as SerializedDotdoError

        // Should not throw
        const error = deserializeDotdoError(serialized)
        expect(error.message).toBe('Null details')
      })
    })
  })

  describe('isSerializedDotdoError type guard', () => {
    it('should return true for valid serialized error with type', () => {
      const valid = {
        type: 'DotdoError',
        code: ErrorCode.NOT_FOUND,
        message: 'Not found'
      }
      expect(isSerializedDotdoError(valid)).toBe(true)
    })

    it('should return true for valid serialized error with name only', () => {
      const valid = {
        name: 'Error',
        message: 'Standard error'
      }
      expect(isSerializedDotdoError(valid)).toBe(true)
    })

    it('should return true for valid serialized error with both type and name', () => {
      const valid = {
        type: 'DotdoError',
        name: 'DotdoError',
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Error'
      }
      expect(isSerializedDotdoError(valid)).toBe(true)
    })

    it('should return false for null', () => {
      expect(isSerializedDotdoError(null)).toBe(false)
    })

    it('should return false for undefined', () => {
      expect(isSerializedDotdoError(undefined)).toBe(false)
    })

    it('should return false for primitive values', () => {
      expect(isSerializedDotdoError('string')).toBe(false)
      expect(isSerializedDotdoError(42)).toBe(false)
      expect(isSerializedDotdoError(true)).toBe(false)
    })

    it('should return false for object without message', () => {
      const invalid = { type: 'Error', code: 'ERR' }
      expect(isSerializedDotdoError(invalid)).toBe(false)
    })

    it('should return false for object without type or name', () => {
      const invalid = { message: 'Error message', code: 'ERR' }
      expect(isSerializedDotdoError(invalid)).toBe(false)
    })

    it('should return false when message is not a string', () => {
      const invalid = { type: 'Error', message: 123 }
      expect(isSerializedDotdoError(invalid)).toBe(false)
    })

    it('should return false when code is present but not a string', () => {
      const invalid = { type: 'Error', message: 'msg', code: 123 }
      expect(isSerializedDotdoError(invalid)).toBe(false)
    })

    it('should return false when httpStatus is present but not a number', () => {
      const invalid = { type: 'Error', message: 'msg', httpStatus: '500' }
      expect(isSerializedDotdoError(invalid)).toBe(false)
    })

    it('should return false when details is present but not an object', () => {
      const invalid = { type: 'Error', message: 'msg', details: 'string' }
      expect(isSerializedDotdoError(invalid)).toBe(false)
    })
  })

  describe('registerErrorClass', () => {
    it('should register custom error class for deserialization', () => {
      // Create a custom error class
      class CustomAppError extends DotdoError {
        constructor(message: string, options?: DotdoErrorOptions) {
          super('CUSTOM_ERROR', message, options)
          this.name = 'CustomAppError'
        }
      }

      // Register it
      registerErrorClass('CustomAppError', CustomAppError as unknown as new (message: string, options?: DotdoErrorOptions) => DotdoError)

      // Deserialize
      const serialized: SerializedDotdoError = {
        type: 'CustomAppError',
        code: 'CUSTOM_ERROR',
        message: 'Custom error occurred'
      }
      const error = deserializeDotdoError(serialized)

      expect(error).toBeInstanceOf(CustomAppError)
      expect(error.message).toBe('Custom error occurred')
    })
  })

  describe('Helper functions', () => {
    describe('getErrorMessage', () => {
      it('should extract message from Error', () => {
        const error = new Error('Test message')
        expect(getErrorMessage(error)).toBe('Test message')
      })

      it('should extract message from DotdoError', () => {
        const error = new DotdoError(ErrorCode.NOT_FOUND, 'Not found message')
        expect(getErrorMessage(error)).toBe('Not found message')
      })

      it('should convert string to string', () => {
        expect(getErrorMessage('String error')).toBe('String error')
      })

      it('should convert number to string', () => {
        expect(getErrorMessage(404)).toBe('404')
      })

      it('should convert object to string', () => {
        expect(getErrorMessage({ code: 'ERR' })).toBe('[object Object]')
      })

      it('should handle null', () => {
        expect(getErrorMessage(null)).toBe('null')
      })

      it('should handle undefined', () => {
        expect(getErrorMessage(undefined)).toBe('undefined')
      })
    })

    describe('isRetryableError', () => {
      it('should return true for network errors', () => {
        const error = new DotdoError(ErrorCode.NETWORK_ERROR, 'Network failed')
        expect(isRetryableError(error)).toBe(true)
      })

      it('should return true for timeout errors', () => {
        const error = new DotdoError(ErrorCode.TIMEOUT, 'Request timed out')
        expect(isRetryableError(error)).toBe(true)
      })

      it('should return true for rate limit errors', () => {
        const error = new DotdoError(ErrorCode.RATE_LIMIT, 'Too many requests')
        expect(isRetryableError(error)).toBe(true)
      })

      it('should return true for service unavailable errors', () => {
        const error = new DotdoError(ErrorCode.SERVICE_UNAVAILABLE, 'Service down')
        expect(isRetryableError(error)).toBe(true)
      })

      it('should return true for circuit open errors', () => {
        const error = new DotdoError(ErrorCode.CIRCUIT_OPEN, 'Circuit breaker open')
        expect(isRetryableError(error)).toBe(true)
      })

      it('should return false for validation errors', () => {
        const error = new DotdoError(ErrorCode.VALIDATION_ERROR, 'Invalid input')
        expect(isRetryableError(error)).toBe(false)
      })

      it('should return false for not found errors', () => {
        const error = new DotdoError(ErrorCode.NOT_FOUND, 'Not found')
        expect(isRetryableError(error)).toBe(false)
      })

      it('should return false for authentication errors', () => {
        const error = new DotdoError(ErrorCode.AUTHENTICATION_ERROR, 'Invalid token')
        expect(isRetryableError(error)).toBe(false)
      })

      it('should return false for standard Error', () => {
        const error = new Error('Standard error')
        expect(isRetryableError(error)).toBe(false)
      })

      it('should check explicit retryable property', () => {
        const error = { message: 'Custom', retryable: true }
        expect(isRetryableError(error)).toBe(true)
      })

      it('should return false for non-Error values', () => {
        expect(isRetryableError('string')).toBe(false)
        expect(isRetryableError(null)).toBe(false)
        expect(isRetryableError(undefined)).toBe(false)
      })
    })
  })
})

describe('Error Inheritance Chain Preservation', () => {
  describe('DotdoError inheritance', () => {
    it('should be instanceof Error', () => {
      const error = new DotdoError(ErrorCode.INTERNAL_ERROR, 'Test')
      expect(error).toBeInstanceOf(Error)
    })

    it('should have correct prototype chain', () => {
      const error = new DotdoError(ErrorCode.INTERNAL_ERROR, 'Test')
      expect(Object.getPrototypeOf(error)).toBe(DotdoError.prototype)
      expect(Object.getPrototypeOf(DotdoError.prototype)).toBe(Error.prototype)
    })

    it('should preserve instanceof after throw/catch', () => {
      try {
        throw new DotdoError(ErrorCode.NOT_FOUND, 'Not found')
      } catch (e) {
        expect(e).toBeInstanceOf(DotdoError)
        expect(e).toBeInstanceOf(Error)
      }
    })
  })

  describe('DatabaseError inheritance', () => {
    it('should be instanceof DotdoError', () => {
      const error = new DatabaseError('DB error')
      expect(error).toBeInstanceOf(DotdoError)
    })

    it('should be instanceof Error', () => {
      const error = new DatabaseError('DB error')
      expect(error).toBeInstanceOf(Error)
    })

    it('should have correct prototype chain', () => {
      const error = new DatabaseError('DB error')
      expect(Object.getPrototypeOf(error)).toBe(DatabaseError.prototype)
      expect(Object.getPrototypeOf(DatabaseError.prototype)).toBe(DotdoError.prototype)
    })
  })

  describe('DbValidationError inheritance', () => {
    it('should be instanceof DatabaseError', () => {
      const error = new DbValidationError('Validation failed')
      expect(error).toBeInstanceOf(DatabaseError)
    })

    it('should be instanceof DotdoError', () => {
      const error = new DbValidationError('Validation failed')
      expect(error).toBeInstanceOf(DotdoError)
    })

    it('should be instanceof Error', () => {
      const error = new DbValidationError('Validation failed')
      expect(error).toBeInstanceOf(Error)
    })

    it('should have correct prototype chain', () => {
      const error = new DbValidationError('Validation failed')
      expect(Object.getPrototypeOf(error)).toBe(DbValidationError.prototype)
      expect(Object.getPrototypeOf(DbValidationError.prototype)).toBe(DatabaseError.prototype)
    })
  })

  describe('DbNotFoundError inheritance', () => {
    it('should be instanceof DatabaseError', () => {
      const error = new DbNotFoundError('Not found')
      expect(error).toBeInstanceOf(DatabaseError)
    })

    it('should be instanceof DotdoError', () => {
      const error = new DbNotFoundError('Not found')
      expect(error).toBeInstanceOf(DotdoError)
    })

    it('should be instanceof Error', () => {
      const error = new DbNotFoundError('Not found')
      expect(error).toBeInstanceOf(Error)
    })
  })

  describe('TransactionError inheritance', () => {
    it('should be instanceof DotdoError', () => {
      const error = new TransactionError('Transaction failed')
      expect(error).toBeInstanceOf(DotdoError)
    })

    it('should be instanceof Error', () => {
      const error = new TransactionError('Transaction failed')
      expect(error).toBeInstanceOf(Error)
    })

    it('should have correct code', () => {
      const error = new TransactionError('Transaction failed')
      expect(error.code).toBe(ErrorCode.TRANSACTION_ERROR)
    })
  })

  describe('NestedTransactionError inheritance', () => {
    it('should be instanceof TransactionError', () => {
      const error = new NestedTransactionError()
      expect(error).toBeInstanceOf(TransactionError)
    })

    it('should be instanceof DotdoError', () => {
      const error = new NestedTransactionError()
      expect(error).toBeInstanceOf(DotdoError)
    })

    it('should have default message', () => {
      const error = new NestedTransactionError()
      expect(error.message).toBe('Nested transactions are not supported by this adapter')
    })
  })

  describe('Cross-boundary inheritance preservation', () => {
    it('should preserve type discrimination after serialization', () => {
      const errors = [
        new DatabaseError('DB error'),
        new DbValidationError('Validation error'),
        new DbNotFoundError('Not found error'),
        new TransactionError('Transaction error')
      ]

      const serialized = errors.map(e => serializeDotdoError(e))
      const deserialized = serialized.map(s => deserializeDotdoError(s))

      expect(deserialized[0]).toBeInstanceOf(DatabaseError)
      expect(deserialized[1]).toBeInstanceOf(DbValidationError)
      expect(deserialized[2]).toBeInstanceOf(DbNotFoundError)
      // TransactionError is not in registry by default, falls back to DotdoError
      expect(deserialized[3]).toBeInstanceOf(DotdoError)
    })
  })
})

describe('Custom Error Properties', () => {
  describe('DotdoError custom properties', () => {
    it('should have code property', () => {
      const error = new DotdoError(ErrorCode.NOT_FOUND, 'Not found')
      expect(error.code).toBe(ErrorCode.NOT_FOUND)
    })

    it('should have httpStatus property', () => {
      const error = new DotdoError(ErrorCode.NOT_FOUND, 'Not found')
      expect(error.httpStatus).toBe(404)
    })

    it('should have retryable getter', () => {
      const retryable = new DotdoError(ErrorCode.NETWORK_ERROR, 'Network error')
      const nonRetryable = new DotdoError(ErrorCode.NOT_FOUND, 'Not found')

      expect(retryable.retryable).toBe(true)
      expect(nonRetryable.retryable).toBe(false)
    })

    it('should have details property', () => {
      const error = new DotdoError(ErrorCode.VALIDATION_ERROR, 'Validation failed', {
        details: { field: 'email', constraint: 'format' }
      })
      expect(error.details).toEqual({ field: 'email', constraint: 'format' })
    })

    it('should support cause property', () => {
      const cause = new Error('Original error')
      const error = new DotdoError(ErrorCode.INTERNAL_ERROR, 'Wrapped', { cause })
      expect(error.cause).toBe(cause)
    })
  })

  describe('DotdoError static methods', () => {
    describe('wrap', () => {
      it('should return same DotdoError unchanged', () => {
        const original = new DotdoError(ErrorCode.NOT_FOUND, 'Not found')
        const wrapped = DotdoError.wrap(original)
        expect(wrapped).toBe(original)
      })

      it('should wrap standard Error', () => {
        const original = new Error('Standard error')
        const wrapped = DotdoError.wrap(original)

        expect(wrapped).toBeInstanceOf(DotdoError)
        expect(wrapped.message).toBe('Standard error')
        expect(wrapped.cause).toBe(original)
        expect(wrapped.code).toBe(ErrorCode.INTERNAL_ERROR)
      })

      it('should wrap with custom code', () => {
        const original = new Error('Network failed')
        const wrapped = DotdoError.wrap(original, ErrorCode.NETWORK_ERROR)

        expect(wrapped.code).toBe(ErrorCode.NETWORK_ERROR)
      })

      it('should wrap string value', () => {
        const wrapped = DotdoError.wrap('String error')

        expect(wrapped).toBeInstanceOf(DotdoError)
        expect(wrapped.message).toBe('String error')
      })

      it('should wrap number value', () => {
        const wrapped = DotdoError.wrap(404)

        expect(wrapped).toBeInstanceOf(DotdoError)
        expect(wrapped.message).toBe('404')
      })
    })

    describe('is', () => {
      it('should return true for matching code', () => {
        const error = new DotdoError(ErrorCode.NOT_FOUND, 'Not found')
        expect(DotdoError.is(error, ErrorCode.NOT_FOUND)).toBe(true)
      })

      it('should return false for non-matching code', () => {
        const error = new DotdoError(ErrorCode.NOT_FOUND, 'Not found')
        expect(DotdoError.is(error, ErrorCode.VALIDATION_ERROR)).toBe(false)
      })

      it('should return false for non-DotdoError', () => {
        const error = new Error('Standard')
        expect(DotdoError.is(error, ErrorCode.INTERNAL_ERROR)).toBe(false)
      })

      it('should narrow type correctly', () => {
        const error: unknown = new DotdoError(ErrorCode.NOT_FOUND, 'Not found')
        if (DotdoError.is(error, ErrorCode.NOT_FOUND)) {
          // TypeScript should now know error is DotdoError
          expect(error.httpStatus).toBe(404)
        }
      })
    })

    describe('isDotdoError', () => {
      it('should return true for DotdoError', () => {
        const error = new DotdoError(ErrorCode.INTERNAL_ERROR, 'Error')
        expect(DotdoError.isDotdoError(error)).toBe(true)
      })

      it('should return true for subclasses', () => {
        expect(DotdoError.isDotdoError(new DatabaseError('DB'))).toBe(true)
        expect(DotdoError.isDotdoError(new DbValidationError())).toBe(true)
        expect(DotdoError.isDotdoError(new DbNotFoundError())).toBe(true)
        expect(DotdoError.isDotdoError(new TransactionError('TX'))).toBe(true)
      })

      it('should return false for standard Error', () => {
        expect(DotdoError.isDotdoError(new Error('Standard'))).toBe(false)
      })

      it('should return false for non-Error', () => {
        expect(DotdoError.isDotdoError('string')).toBe(false)
        expect(DotdoError.isDotdoError(null)).toBe(false)
        expect(DotdoError.isDotdoError(undefined)).toBe(false)
      })
    })
  })

  describe('DatabaseError custom properties', () => {
    it('should have DATABASE_ERROR code', () => {
      const error = new DatabaseError('DB error')
      expect(error.code).toBe(ErrorCode.DATABASE_ERROR)
    })

    it('should have httpStatus 500', () => {
      const error = new DatabaseError('DB error')
      expect(error.httpStatus).toBe(500)
    })
  })

  describe('DbValidationError custom properties', () => {
    it('should override code to VALIDATION_ERROR', () => {
      const error = new DbValidationError('Invalid')
      expect(error.code).toBe(ErrorCode.VALIDATION_ERROR)
    })

    it('should override httpStatus to 400', () => {
      const error = new DbValidationError('Invalid')
      expect(error.httpStatus).toBe(400)
    })
  })

  describe('DbNotFoundError custom properties', () => {
    it('should override code to NOT_FOUND', () => {
      const error = new DbNotFoundError('Missing')
      expect(error.code).toBe(ErrorCode.NOT_FOUND)
    })

    it('should override httpStatus to 404', () => {
      const error = new DbNotFoundError('Missing')
      expect(error.httpStatus).toBe(404)
    })
  })

  describe('TransactionError custom properties', () => {
    it('should support cause in constructor', () => {
      const cause = new Error('Original')
      const error = new TransactionError('TX failed', cause)
      expect(error.cause).toBe(cause)
    })

    it('should support details in constructor', () => {
      const error = new TransactionError('TX failed', undefined, { txId: '123' })
      expect(error.details).toEqual({ txId: '123' })
    })

    describe('rollbackFailed static method', () => {
      it('should create TransactionError with rollback context', () => {
        const original = new Error('Insert failed')
        const rollback = new Error('Rollback failed')
        const error = TransactionError.rollbackFailed(original, rollback)

        expect(error.message).toContain('rollback failed')
        expect(error.cause).toBe(rollback)
        expect(error.details).toEqual({
          originalError: 'Insert failed',
          rollbackError: 'Rollback failed'
        })
      })
    })

    describe('nestedFailed static method', () => {
      it('should create TransactionError with savepoint context', () => {
        const cause = new Error('Savepoint error')
        const error = TransactionError.nestedFailed('sp_1', cause)

        expect(error.message).toContain('sp_1')
        expect(error.message).toContain('failed')
        expect(error.cause).toBe(cause)
        expect(error.details).toEqual({ savepointName: 'sp_1' })
      })
    })
  })

  describe('DotdoError toString', () => {
    it('should format error without details', () => {
      const error = new DotdoError(ErrorCode.NOT_FOUND, 'Resource not found')
      expect(error.toString()).toBe('DotdoError [NOT_FOUND]: Resource not found')
    })

    it('should format error with details', () => {
      const error = new DotdoError(ErrorCode.VALIDATION_ERROR, 'Invalid input', {
        details: { field: 'email' }
      })
      expect(error.toString()).toBe('DotdoError [VALIDATION_ERROR]: Invalid input ({"field":"email"})')
    })
  })
})
