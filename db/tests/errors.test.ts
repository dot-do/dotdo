import { describe, it, expect } from 'vitest'
import {
  DatabaseError,
  DbValidationError,
  DbNotFoundError
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
