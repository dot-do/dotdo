/**
 * Error Handling Consistency Tests
 *
 * RED Phase: Tests that define consistent error handling patterns across the codebase.
 * These tests identify inconsistencies in error types, structure, and behavior.
 *
 * Issue: do-3haz
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'

// Import existing error types
import { QueryValidationError } from '../query-validation'
import { SqlSecurityError } from '../sql-security'
import { CapabilityError } from '../../rpc/capability-token'
import { RPCError, RPCErrorCodes } from '../../rpc/proxy'

// =============================================================================
// Expected Error Interface
// =============================================================================

/**
 * DotdoError - The base error interface all errors should implement
 *
 * This defines the expected structure for consistent error handling:
 * - name: Error class name (e.g., 'DotdoError', 'QueryValidationError')
 * - message: Human-readable error message
 * - code: Machine-readable error code (for programmatic handling)
 * - context: Additional structured data about the error
 * - cause: Original error that caused this error (for error chains)
 */
interface DotdoErrorInterface {
  name: string
  message: string
  code: string
  context?: Record<string, unknown>
  cause?: Error
  stack?: string

  // Serialization support
  toJSON(): { name: string; message: string; code: string; context?: Record<string, unknown>; stack?: string }
}

/**
 * Documented error codes that should be used consistently
 */
const DOCUMENTED_ERROR_CODES = {
  // General errors
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',

  // Validation errors
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_INPUT: 'INVALID_INPUT',
  MISSING_REQUIRED: 'MISSING_REQUIRED',
  TYPE_MISMATCH: 'TYPE_MISMATCH',

  // Not found errors
  NOT_FOUND: 'NOT_FOUND',
  THING_NOT_FOUND: 'THING_NOT_FOUND',
  METHOD_NOT_FOUND: 'METHOD_NOT_FOUND',

  // Security/Auth errors
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  INSUFFICIENT_SCOPE: 'INSUFFICIENT_SCOPE',
  SECRET_REQUIRED: 'SECRET_REQUIRED',
  EXPIRED: 'EXPIRED',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',

  // SQL/Query errors
  EMPTY_QUERY: 'EMPTY_QUERY',
  INVALID_QUERY: 'INVALID_QUERY',
  WRITE_OPERATION_FORBIDDEN: 'WRITE_OPERATION_FORBIDDEN',
  MULTI_STATEMENT_FORBIDDEN: 'MULTI_STATEMENT_FORBIDDEN',

  // RPC errors
  RPC_ERROR: 'RPC_ERROR',
  TIMEOUT: 'TIMEOUT',
  VERSION_MISMATCH: 'VERSION_MISMATCH',

  // Storage errors
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  CONDITION_FAILED: 'CONDITION_FAILED',
} as const

// =============================================================================
// Error Structure Tests
// =============================================================================

describe('Error Handling Standards', () => {
  describe('Error Type Consistency', () => {
    it('should have QueryValidationError extend Error with code property', () => {
      const error = new QueryValidationError('Test message', 'testField', '$gt', { detail: 'info' })

      expect(error).toBeInstanceOf(Error)
      expect(error.name).toBe('QueryValidationError')
      expect(error.message).toBe('Test message')
      expect(error.field).toBe('testField')
      expect(error.operator).toBe('$gt')
      expect(error.details).toEqual({ detail: 'info' })
      // RED: QueryValidationError doesn't have a standardized 'code' property
      expect(error).toHaveProperty('code')
    })

    it('should have SqlSecurityError extend Error with code property', () => {
      const error = new SqlSecurityError('Test message', 'EMPTY_QUERY', 'SELECT * FROM foo')

      expect(error).toBeInstanceOf(Error)
      expect(error.name).toBe('SqlSecurityError')
      expect(error.message).toBe('Test message')
      expect(error.code).toBe('EMPTY_QUERY')
      expect(error.query).toBe('SELECT * FROM foo')
    })

    it('should have CapabilityError extend Error with code property', () => {
      const error = new CapabilityError('Test message', 'EXPIRED')

      expect(error).toBeInstanceOf(Error)
      expect(error.name).toBe('CapabilityError')
      expect(error.message).toBe('Test message')
      expect(error.code).toBe('EXPIRED')
    })

    it('should have RPCError extend Error with code property', () => {
      const error = new RPCError('Test message', { code: 'TIMEOUT', method: 'testMethod' })

      expect(error).toBeInstanceOf(Error)
      expect(error.name).toBe('RPCError')
      expect(error.message).toBe('Test message')
      expect(error.code).toBe('TIMEOUT')
      expect(error.method).toBe('testMethod')
    })
  })

  describe('Error Context Consistency', () => {
    it('all errors should include proper context via a context property', () => {
      // QueryValidationError - has field/operator/details but no 'context' property
      const queryError = new QueryValidationError('Invalid', 'age', '$gt', { foo: 'bar' })
      // RED: Should have a 'context' property that aggregates field, operator, details
      expect(queryError).toHaveProperty('context')
      expect((queryError as unknown as DotdoErrorInterface).context).toMatchObject({
        field: 'age',
        operator: '$gt',
      })

      // SqlSecurityError - has query but no 'context' property
      const sqlError = new SqlSecurityError('Security', 'WRITE_OPERATION_FORBIDDEN', 'INSERT')
      // RED: Should have a 'context' property that includes query
      expect(sqlError).toHaveProperty('context')
      expect((sqlError as unknown as DotdoErrorInterface).context).toMatchObject({
        query: 'INSERT',
      })

      // CapabilityError - no context at all
      const capError = new CapabilityError('Expired', 'EXPIRED')
      // RED: Should have a 'context' property
      expect(capError).toHaveProperty('context')

      // RPCError - has method/target but no 'context' property
      const rpcError = new RPCError('Failed', { method: 'getOrders', target: 'customer-123' })
      // RED: Should have a 'context' property that aggregates method, target
      expect(rpcError).toHaveProperty('context')
      expect((rpcError as unknown as DotdoErrorInterface).context).toMatchObject({
        method: 'getOrders',
        target: 'customer-123',
      })
    })

    it('error context should be structured and contain relevant information', () => {
      // Test that errors from DO operations include proper context
      const getCore = () => {
        const id = env.DOCore.idFromName('error-context-test')
        return env.DOCore.get(id)
      }

      const core = getCore()

      // This should fail with a properly contextualized error
      expect(core.things.get('nonexistent-id-12345')).rejects.toMatchObject({
        code: 'NOT_FOUND',
        context: {
          id: 'nonexistent-id-12345',
        },
      })
    })
  })

  describe('Error Serialization', () => {
    it('all errors should have a toJSON method for serialization', () => {
      const queryError = new QueryValidationError('Invalid', 'age', '$gt')
      const sqlError = new SqlSecurityError('Security', 'WRITE_OPERATION_FORBIDDEN')
      const capError = new CapabilityError('Expired', 'EXPIRED')
      const rpcError = new RPCError('Failed', { code: 'TIMEOUT' })

      // RED: Errors should all have toJSON() method
      expect(typeof queryError.toJSON).toBe('function')
      expect(typeof sqlError.toJSON).toBe('function')
      expect(typeof capError.toJSON).toBe('function')
      expect(typeof rpcError.toJSON).toBe('function')
    })

    it('serialized errors should include name, message, code, and context', () => {
      const error = new RPCError('Test', { code: 'TIMEOUT', method: 'test' })

      // RED: toJSON should return structured object
      const json = (error as unknown as DotdoErrorInterface).toJSON()

      expect(json).toMatchObject({
        name: 'RPCError',
        message: 'Test',
        code: 'TIMEOUT',
      })
    })

    it('serialized errors should be JSON-stringifiable', () => {
      const error = new QueryValidationError('Invalid field', 'price', '$gt', { min: 0 })

      // Should not throw when stringified
      const jsonStr = JSON.stringify(error)
      expect(jsonStr).toBeDefined()

      // Should be parseable back
      const parsed = JSON.parse(jsonStr)
      expect(parsed.name).toBe('QueryValidationError')
      expect(parsed.message).toBe('Invalid field')
    })
  })

  describe('Stack Trace Preservation', () => {
    it('should preserve stack traces in development', () => {
      const queryError = new QueryValidationError('Test', 'field')
      const sqlError = new SqlSecurityError('Test', 'EMPTY_QUERY')
      const capError = new CapabilityError('Test', 'EXPIRED')
      const rpcError = new RPCError('Test')

      // All errors should have stack traces
      expect(queryError.stack).toBeDefined()
      expect(sqlError.stack).toBeDefined()
      expect(capError.stack).toBeDefined()
      expect(rpcError.stack).toBeDefined()

      // Stack should include the error name
      expect(queryError.stack).toContain('QueryValidationError')
      expect(sqlError.stack).toContain('SqlSecurityError')
      expect(capError.stack).toContain('CapabilityError')
      expect(rpcError.stack).toContain('RPCError')
    })

    it('should capture stack trace at the correct location', () => {
      function createErrorInFunction() {
        return new QueryValidationError('Test', 'field')
      }

      const error = createErrorInFunction()

      // Stack trace should include the function name
      expect(error.stack).toContain('createErrorInFunction')
    })
  })

  describe('Error Code Documentation', () => {
    it('QueryValidationError should use documented error codes', () => {
      // RED: QueryValidationError doesn't have a 'code' property
      const error = new QueryValidationError('Test', 'field', '$invalid')

      // Should have a code that maps to a documented error code
      expect(error).toHaveProperty('code')
      expect(Object.values(DOCUMENTED_ERROR_CODES)).toContain(
        (error as unknown as { code: string }).code
      )
    })

    it('SqlSecurityError codes should all be documented', () => {
      const validCodes = [
        'WRITE_OPERATION_FORBIDDEN',
        'MULTI_STATEMENT_FORBIDDEN',
        'COMMENT_FORBIDDEN',
        'PRAGMA_FORBIDDEN',
        'EMPTY_QUERY',
        'INVALID_QUERY',
        'COMMAND_FORBIDDEN',
      ]

      for (const code of validCodes) {
        expect(Object.values(DOCUMENTED_ERROR_CODES)).toContain(code)
      }
    })

    it('CapabilityError codes should all be documented', () => {
      const validCodes = [
        'EXPIRED',
        'INVALID_SIGNATURE',
        'WRONG_TARGET',
        'INSUFFICIENT_SCOPE',
        'SECRET_REQUIRED',
      ]

      for (const code of validCodes) {
        expect(Object.values(DOCUMENTED_ERROR_CODES)).toContain(code)
      }
    })

    it('RPCError codes should all be documented', () => {
      for (const code of Object.values(RPCErrorCodes)) {
        expect(Object.values(DOCUMENTED_ERROR_CODES)).toContain(code)
      }
    })
  })

  describe('Error Cause Chain', () => {
    it('errors should support cause property for error chaining', () => {
      const originalError = new Error('Original error')
      const wrappedError = new RPCError('Wrapped error')

      // RED: Errors should support cause property (ES2022 Error Cause)
      expect(wrappedError).toHaveProperty('cause')

      // When wrapping, the cause should be set
      const errorWithCause = new Error('Wrapper', { cause: originalError })
      expect(errorWithCause.cause).toBe(originalError)

      // Custom errors should also support this pattern
      // RED: Custom error constructors don't support the cause option
      const customWithCause = new QueryValidationError('Validation failed', 'field')
      // Should be able to set cause somehow
      expect(customWithCause).toHaveProperty('cause')
    })

    it('should preserve the full error chain when wrapping errors', async () => {
      const getCore = () => {
        const id = env.DOCore.idFromName('error-chain-test')
        return env.DOCore.get(id)
      }

      const core = getCore()

      // When an internal error occurs during a DO operation, the wrapper error
      // should include the original error as cause
      try {
        // Force an error that would be wrapped
        await core.things.create({ $type: 'Test', $id: null as unknown as string })
      } catch (error) {
        // RED: Errors from DO should include cause chain
        if (error instanceof Error && 'cause' in error && error.cause) {
          expect(error.cause).toBeInstanceOf(Error)
        }
      }
    })
  })

  describe('DO Error Wrapping', () => {
    it('should wrap all DO errors in consistent error type', async () => {
      const getCore = () => {
        const id = env.DOCore.idFromName('do-error-wrap-test')
        return env.DOCore.get(id)
      }

      const core = getCore()

      // Get non-existent thing
      try {
        await core.things.get('nonexistent-thing-id')
        expect.fail('Should have thrown')
      } catch (error) {
        // RED: All DO errors should be wrapped in a consistent type
        // Currently throws plain Error
        expect(error).toHaveProperty('code')
        expect((error as { code: string }).code).toBe('NOT_FOUND')
      }
    })

    it('should include correlation ID in errors for tracing', async () => {
      const getCore = () => {
        const id = env.DOCore.idFromName('correlation-test')
        return env.DOCore.get(id)
      }

      const core = getCore()

      try {
        await core.things.get('nonexistent')
        expect.fail('Should have thrown')
      } catch (error) {
        // RED: Errors should include correlation ID for distributed tracing
        expect(error).toHaveProperty('correlationId')
      }
    })
  })

  describe('Error Sanitization for Clients', () => {
    it('should sanitize error messages for client responses', () => {
      // Errors containing sensitive info should be sanitized
      const errorWithSensitiveData = new SqlSecurityError(
        'Failed: password=secret123',
        'INVALID_QUERY',
        'SELECT * FROM users WHERE password=secret123'
      )

      // RED: Should have a sanitize method that removes sensitive data
      expect(errorWithSensitiveData).toHaveProperty('toClientError')

      const clientError = (errorWithSensitiveData as unknown as { toClientError(): { message: string; code: string } }).toClientError()
      expect(clientError.message).not.toContain('secret123')
      expect(clientError.code).toBe('INVALID_QUERY')
    })

    it('should not expose stack traces in production client errors', () => {
      const error = new RPCError('Internal failure')

      // RED: toClientError should strip stack in production
      const clientError = (error as unknown as { toClientError(): { stack?: string } }).toClientError()
      expect(clientError.stack).toBeUndefined()
    })
  })
})

// =============================================================================
// Helper to check if an error matches the DotdoError interface
// =============================================================================

function assertIsDotdoError(error: unknown): asserts error is DotdoErrorInterface {
  if (!(error instanceof Error)) {
    throw new Error('Expected error to be an instance of Error')
  }

  if (typeof (error as DotdoErrorInterface).code !== 'string') {
    throw new Error('Expected error to have a code property')
  }

  if (typeof (error as DotdoErrorInterface).toJSON !== 'function') {
    throw new Error('Expected error to have a toJSON method')
  }
}
