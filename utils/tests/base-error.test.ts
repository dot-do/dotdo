/**
 * Tests for DotdoError base class
 */
import { describe, it, expect } from 'vitest'
import {
  DotdoError,
  isSerializedDotdoError,
  type ErrorDetails,
  type DotdoErrorOptions,
  type SerializedDotdoError,
} from '../base-error'

describe('DotdoError', () => {
  describe('constructor', () => {
    it('should create error with code and message', () => {
      const error = new DotdoError('TEST_ERROR', 'Something went wrong')

      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(DotdoError)
      expect(error.code).toBe('TEST_ERROR')
      expect(error.message).toBe('Something went wrong')
      expect(error.name).toBe('DotdoError')
    })

    it('should accept details option', () => {
      const details: ErrorDetails = { field: 'email', value: 'invalid' }
      const error = new DotdoError('VALIDATION_ERROR', 'Invalid email', { details })

      expect(error.details).toEqual(details)
    })

    it('should accept cause option', () => {
      const cause = new Error('Original error')
      const error = new DotdoError('WRAPPED_ERROR', 'Wrapped', { cause })

      expect(error.cause).toBe(cause)
    })

    it('should accept both details and cause', () => {
      const cause = new Error('Original')
      const details = { resourceId: '123' }
      const error = new DotdoError('NOT_FOUND', 'Resource not found', { cause, details })

      expect(error.cause).toBe(cause)
      expect(error.details).toEqual(details)
    })
  })

  describe('toJSON', () => {
    it('should serialize basic error', () => {
      const error = new DotdoError('TEST_CODE', 'Test message')
      const json = error.toJSON()

      expect(json).toEqual({
        type: 'DotdoError',
        code: 'TEST_CODE',
        message: 'Test message',
      })
    })

    it('should include details when present', () => {
      const error = new DotdoError('TEST_CODE', 'Test message', {
        details: { field: 'name' },
      })
      const json = error.toJSON()

      expect(json.details).toEqual({ field: 'name' })
    })

    it('should not include empty details', () => {
      const error = new DotdoError('TEST_CODE', 'Test message', {
        details: {},
      })
      const json = error.toJSON()

      expect(json.details).toBeUndefined()
    })

    it('should serialize DotdoError cause', () => {
      const cause = new DotdoError('CAUSE_CODE', 'Cause message')
      const error = new DotdoError('OUTER_CODE', 'Outer message', { cause })
      const json = error.toJSON()

      expect(json.cause).toEqual({
        type: 'DotdoError',
        code: 'CAUSE_CODE',
        message: 'Cause message',
      })
    })

    it('should serialize regular Error cause', () => {
      const cause = new Error('Regular error')
      const error = new DotdoError('OUTER_CODE', 'Outer message', { cause })
      const json = error.toJSON()

      expect(json.cause).toEqual({
        name: 'Error',
        message: 'Regular error',
      })
    })
  })

  describe('fromJSON', () => {
    it('should reconstruct basic error', () => {
      const serialized: SerializedDotdoError = {
        type: 'DotdoError',
        code: 'TEST_CODE',
        message: 'Test message',
      }

      const error = DotdoError.fromJSON(serialized)

      expect(error).toBeInstanceOf(DotdoError)
      expect(error.code).toBe('TEST_CODE')
      expect(error.message).toBe('Test message')
      expect(error.name).toBe('DotdoError')
    })

    it('should restore details', () => {
      const serialized: SerializedDotdoError = {
        type: 'DotdoError',
        code: 'TEST_CODE',
        message: 'Test message',
        details: { field: 'email' },
      }

      const error = DotdoError.fromJSON(serialized)

      expect(error.details).toEqual({ field: 'email' })
    })

    it('should restore DotdoError cause chain', () => {
      const serialized: SerializedDotdoError = {
        type: 'DotdoError',
        code: 'OUTER_CODE',
        message: 'Outer',
        cause: {
          type: 'DotdoError',
          code: 'INNER_CODE',
          message: 'Inner',
        },
      }

      const error = DotdoError.fromJSON(serialized)

      expect(error.cause).toBeInstanceOf(DotdoError)
      const cause = error.cause as DotdoError
      expect(cause.code).toBe('INNER_CODE')
      expect(cause.message).toBe('Inner')
    })

    it('should restore regular Error cause', () => {
      const serialized: SerializedDotdoError = {
        type: 'DotdoError',
        code: 'OUTER_CODE',
        message: 'Outer',
        cause: {
          name: 'TypeError',
          message: 'Cannot read property',
        },
      }

      const error = DotdoError.fromJSON(serialized)

      expect(error.cause).toBeInstanceOf(Error)
      const cause = error.cause as Error
      expect(cause.name).toBe('TypeError')
      expect(cause.message).toBe('Cannot read property')
    })

    it('should restore custom error name', () => {
      const serialized: SerializedDotdoError = {
        type: 'CustomError',
        code: 'CUSTOM_CODE',
        message: 'Custom message',
      }

      const error = DotdoError.fromJSON(serialized)

      expect(error.name).toBe('CustomError')
    })
  })

  describe('toString', () => {
    it('should format error without details', () => {
      const error = new DotdoError('TEST_CODE', 'Test message')
      expect(error.toString()).toBe('DotdoError [TEST_CODE]: Test message')
    })

    it('should format error with details', () => {
      const error = new DotdoError('TEST_CODE', 'Test message', {
        details: { field: 'name' },
      })
      expect(error.toString()).toBe('DotdoError [TEST_CODE]: Test message ({"field":"name"})')
    })
  })

  describe('wrap', () => {
    it('should return DotdoError as-is', () => {
      const original = new DotdoError('ORIGINAL', 'Original')
      const wrapped = DotdoError.wrap(original)

      expect(wrapped).toBe(original)
    })

    it('should wrap regular Error', () => {
      const original = new Error('Original message')
      const wrapped = DotdoError.wrap(original, 'WRAPPED')

      expect(wrapped).toBeInstanceOf(DotdoError)
      expect(wrapped.code).toBe('WRAPPED')
      expect(wrapped.message).toBe('Original message')
      expect(wrapped.cause).toBe(original)
    })

    it('should wrap non-Error values', () => {
      const wrapped = DotdoError.wrap('string error')

      expect(wrapped).toBeInstanceOf(DotdoError)
      expect(wrapped.code).toBe('INTERNAL_ERROR')
      expect(wrapped.message).toBe('string error')
    })

    it('should use default code INTERNAL_ERROR', () => {
      const wrapped = DotdoError.wrap(new Error('test'))
      expect(wrapped.code).toBe('INTERNAL_ERROR')
    })
  })

  describe('is', () => {
    it('should return true for DotdoError with matching code', () => {
      const error = new DotdoError('MATCH_CODE', 'message')
      expect(DotdoError.is(error, 'MATCH_CODE')).toBe(true)
    })

    it('should return false for DotdoError with different code', () => {
      const error = new DotdoError('OTHER_CODE', 'message')
      expect(DotdoError.is(error, 'MATCH_CODE')).toBe(false)
    })

    it('should return false for regular Error', () => {
      const error = new Error('message')
      expect(DotdoError.is(error, 'ANY_CODE')).toBe(false)
    })

    it('should return false for non-Error values', () => {
      expect(DotdoError.is('string', 'ANY_CODE')).toBe(false)
      expect(DotdoError.is(null, 'ANY_CODE')).toBe(false)
      expect(DotdoError.is(undefined, 'ANY_CODE')).toBe(false)
    })
  })

  describe('isDotdoError', () => {
    it('should return true for DotdoError', () => {
      const error = new DotdoError('CODE', 'message')
      expect(DotdoError.isDotdoError(error)).toBe(true)
    })

    it('should return false for regular Error', () => {
      const error = new Error('message')
      expect(DotdoError.isDotdoError(error)).toBe(false)
    })

    it('should return false for non-Error values', () => {
      expect(DotdoError.isDotdoError('string')).toBe(false)
      expect(DotdoError.isDotdoError(null)).toBe(false)
      expect(DotdoError.isDotdoError(undefined)).toBe(false)
    })
  })

  describe('extending DotdoError', () => {
    // Example of how packages should extend DotdoError
    class CustomPackageError extends DotdoError {
      readonly customField: string

      constructor(message: string, customField: string, options?: DotdoErrorOptions) {
        super('CUSTOM_PACKAGE_ERROR', message, options)
        this.name = 'CustomPackageError'
        this.customField = customField
      }
    }

    it('should allow creating custom error classes', () => {
      const error = new CustomPackageError('Custom error', 'custom-value')

      expect(error).toBeInstanceOf(Error)
      expect(error).toBeInstanceOf(DotdoError)
      expect(error).toBeInstanceOf(CustomPackageError)
      expect(error.name).toBe('CustomPackageError')
      expect(error.code).toBe('CUSTOM_PACKAGE_ERROR')
      expect(error.customField).toBe('custom-value')
    })

    it('should serialize custom errors with toJSON', () => {
      const error = new CustomPackageError('Custom error', 'custom-value', {
        details: { extra: 'data' },
      })
      const json = error.toJSON()

      expect(json.type).toBe('CustomPackageError')
      expect(json.code).toBe('CUSTOM_PACKAGE_ERROR')
      expect(json.details).toEqual({ extra: 'data' })
    })

    it('should work with DotdoError.is', () => {
      const error = new CustomPackageError('message', 'field')
      expect(DotdoError.is(error, 'CUSTOM_PACKAGE_ERROR')).toBe(true)
      expect(DotdoError.isDotdoError(error)).toBe(true)
    })
  })
})

describe('isSerializedDotdoError', () => {
  it('should return true for valid serialized error', () => {
    const valid: SerializedDotdoError = {
      type: 'DotdoError',
      code: 'TEST_CODE',
      message: 'Test message',
    }
    expect(isSerializedDotdoError(valid)).toBe(true)
  })

  it('should accept optional details', () => {
    const valid: SerializedDotdoError = {
      type: 'DotdoError',
      code: 'TEST_CODE',
      message: 'Test message',
      details: { field: 'value' },
    }
    expect(isSerializedDotdoError(valid)).toBe(true)
  })

  it('should accept optional stack', () => {
    const valid: SerializedDotdoError = {
      type: 'DotdoError',
      code: 'TEST_CODE',
      message: 'Test message',
      stack: 'Error: test\n    at ...',
    }
    expect(isSerializedDotdoError(valid)).toBe(true)
  })

  it('should return false for missing type', () => {
    const invalid = {
      code: 'TEST_CODE',
      message: 'Test message',
    }
    expect(isSerializedDotdoError(invalid)).toBe(false)
  })

  it('should return false for missing code', () => {
    const invalid = {
      type: 'DotdoError',
      message: 'Test message',
    }
    expect(isSerializedDotdoError(invalid)).toBe(false)
  })

  it('should return false for missing message', () => {
    const invalid = {
      type: 'DotdoError',
      code: 'TEST_CODE',
    }
    expect(isSerializedDotdoError(invalid)).toBe(false)
  })

  it('should return false for non-object values', () => {
    expect(isSerializedDotdoError(null)).toBe(false)
    expect(isSerializedDotdoError(undefined)).toBe(false)
    expect(isSerializedDotdoError('string')).toBe(false)
    expect(isSerializedDotdoError(123)).toBe(false)
  })

  it('should return false for wrong type of details', () => {
    const invalid = {
      type: 'DotdoError',
      code: 'TEST_CODE',
      message: 'Test message',
      details: 'not-an-object',
    }
    expect(isSerializedDotdoError(invalid)).toBe(false)
  })

  it('should return false for wrong type of stack', () => {
    const invalid = {
      type: 'DotdoError',
      code: 'TEST_CODE',
      message: 'Test message',
      stack: 123,
    }
    expect(isSerializedDotdoError(invalid)).toBe(false)
  })
})
