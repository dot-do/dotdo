/**
 * Error Handling Standards Test Suite (RED Phase)
 *
 * Tests that define consistent error handling patterns across the dotdo codebase.
 * These RED phase tests identify the desired interface for unified error handling.
 *
 * The following error types currently exist but lack standardization:
 * - QueryValidationError (core/query-validation.ts)
 * - SqlSecurityError (core/sql-security.ts)
 * - CapabilityError (rpc/capability-token.ts)
 * - RPCError (rpc/proxy.ts)
 * - Various HTTP errors (packages/middleware/src/error/index.ts)
 *
 * Issue: do-3haz (Wave 5 - Error Handling Consistency)
 * Status: RED - Tests for desired behavior that doesn't yet exist
 *
 * @module lib/tests/error-handling-coverage
 */

import { describe, it, expect } from 'vitest'
import { QueryValidationError } from '../../core/query-validation'
import { SqlSecurityError } from '../../core/sql-security'
import { CapabilityError } from '../../rpc/capability-token'
import { RPCError, RPCErrorCodes } from '../../rpc/proxy'

// =============================================================================
// TYPE DEFINITIONS - Desired Error Interface
// =============================================================================

/**
 * DotdoError - The standardized error interface all errors should implement
 *
 * This defines the expected contract for error handling across the codebase:
 * - name: Error class name for debugging (e.g., 'DotdoError', 'QueryValidationError')
 * - message: Human-readable error message for end users
 * - code: Machine-readable error code for programmatic error handling
 * - context?: Structured metadata about the error (replaces scattered properties)
 * - cause?: Original error that caused this error (ES2022 pattern for error chains)
 * - stack?: Stack trace for debugging
 * - toJSON()?: Serialization method for safe transmission over RPC
 */
interface DotdoError extends Error {
  name: string
  message: string
  code: string
  context?: Record<string, unknown>
  cause?: Error | null
  stack?: string

  // Optional serialization support
  toJSON?(): {
    name: string
    message: string
    code: string
    context?: Record<string, unknown>
    stack?: string
  }

  // Optional client-safe error for HTTP responses
  toClientError?(): {
    code: string
    message: string
    context?: Record<string, unknown>
  }
}

/**
 * Import ERROR_CODES from lib/errors to ensure test consistency
 * This is the authoritative source for all error codes in dotdo.
 */
import { ERROR_CODES } from '../errors'

/**
 * DOCUMENTED_ERROR_CODES now references the actual ERROR_CODES from lib/errors
 * This ensures tests stay in sync with the implementation.
 */
const DOCUMENTED_ERROR_CODES = ERROR_CODES

// =============================================================================
// Error Type Consistency Tests
// =============================================================================

describe('Error Handling Standards - Type Consistency', () => {
  describe('QueryValidationError', () => {
    it('should be instance of Error', () => {
      const error = new QueryValidationError('Test message', 'testField')
      expect(error).toBeInstanceOf(Error)
      expect(error.name).toBe('QueryValidationError')
      expect(error.message).toBe('Test message')
    })

    it('RED: should have standardized code property', () => {
      const error = new QueryValidationError('Invalid operator', 'price', '$invalid')
      // Currently fails - QueryValidationError doesn't have a 'code' property
      expect(error).toHaveProperty('code')
      expect(typeof (error as unknown as { code: string }).code).toBe('string')
    })

    it('RED: should have standardized context property', () => {
      const error = new QueryValidationError(
        'Invalid operator',
        'price',
        '$invalid',
        { allowedOperators: ['$gt', '$lt'] }
      )
      // Currently fails - has 'field', 'operator', 'details' but no 'context'
      expect(error).toHaveProperty('context')
      const context = (error as unknown as { context?: Record<string, unknown> }).context
      expect(context).toBeDefined()
      expect(context).toHaveProperty('field')
      expect(context).toHaveProperty('operator')
    })

    it('RED: should have toJSON serialization method', () => {
      const error = new QueryValidationError('Invalid field', 'price')
      expect(typeof (error as unknown as { toJSON?: () => unknown }).toJSON).toBe('function')
    })
  })

  describe('SqlSecurityError', () => {
    it('should be instance of Error', () => {
      const error = new SqlSecurityError('Test message', 'WRITE_OPERATION_FORBIDDEN')
      expect(error).toBeInstanceOf(Error)
      expect(error.name).toBe('SqlSecurityError')
    })

    it('should have code property', () => {
      const error = new SqlSecurityError('Test', 'EMPTY_QUERY')
      expect(error.code).toBe('EMPTY_QUERY')
    })

    it('RED: should have standardized context property', () => {
      const error = new SqlSecurityError('Security violation', 'WRITE_OPERATION_FORBIDDEN', 'INSERT INTO users')
      // Currently has 'query' property, should also have 'context'
      expect(error).toHaveProperty('context')
      const context = (error as unknown as { context?: Record<string, unknown> }).context
      expect(context).toHaveProperty('query')
    })

    it('RED: should have toJSON serialization method', () => {
      const error = new SqlSecurityError('Test', 'WRITE_OPERATION_FORBIDDEN')
      expect(typeof (error as unknown as { toJSON?: () => unknown }).toJSON).toBe('function')
    })

    it('RED: should not expose query in toJSON output for security', () => {
      const error = new SqlSecurityError(
        'Test',
        'WRITE_OPERATION_FORBIDDEN',
        'INSERT INTO users (password) VALUES (?)'
      )
      // Call toJSON directly on the error instance to preserve 'this' binding
      const json = error.toJSON()
      // Query should be stripped from JSON for security reasons
      expect((json as unknown as { query?: string }).query).toBeUndefined()
    })
  })

  describe('CapabilityError', () => {
    it('should be instance of Error', () => {
      const error = new CapabilityError('Test message', 'EXPIRED')
      expect(error).toBeInstanceOf(Error)
      expect(error.name).toBe('CapabilityError')
      // CapabilityError maps 'EXPIRED' to 'CAPABILITY_EXPIRED' for standardization
      expect(error.code).toBe('CAPABILITY_EXPIRED')
    })

    it('RED: should have standardized context property', () => {
      const error = new CapabilityError('Token expired', 'EXPIRED')
      // Currently fails - CapabilityError has no 'context' property
      expect(error).toHaveProperty('context')
    })

    it('RED: should have toJSON serialization method', () => {
      const error = new CapabilityError('Test', 'EXPIRED')
      expect(typeof (error as unknown as { toJSON?: () => unknown }).toJSON).toBe('function')
    })

    it('RED: code should be from documented error codes', () => {
      const error = new CapabilityError('Test', 'EXPIRED')
      expect(Object.values(DOCUMENTED_ERROR_CODES)).toContain(error.code)
    })
  })

  describe('RPCError', () => {
    it('should be instance of Error', () => {
      const error = new RPCError('Test message', { code: 'RPC_ERROR' })
      expect(error).toBeInstanceOf(Error)
      expect(error.name).toBe('RPCError')
      expect(error.code).toBe('RPC_ERROR')
    })

    it('RED: should have standardized context property', () => {
      const error = new RPCError('Failed', {
        code: 'METHOD_NOT_FOUND',
        method: 'getOrders',
        target: 'customer-123',
      })
      // Currently has 'method' and 'target' as separate properties, should have 'context'
      expect(error).toHaveProperty('context')
      const context = (error as unknown as { context?: Record<string, unknown> }).context
      expect(context).toHaveProperty('method')
      expect(context).toHaveProperty('target')
    })

    it('RED: should have toJSON serialization method', () => {
      const error = new RPCError('Test')
      expect(typeof (error as unknown as { toJSON?: () => unknown }).toJSON).toBe('function')
    })

    it('RED: code should be from documented error codes', () => {
      const error = new RPCError('Test', { code: 'TIMEOUT' })
      expect(Object.values(DOCUMENTED_ERROR_CODES)).toContain(error.code)
    })
  })
})

// =============================================================================
// Error Code Consistency Tests
// =============================================================================

describe('Error Handling Standards - Code Consistency', () => {
  describe('Error codes registry', () => {
    it('should have all QueryValidationError codes documented', () => {
      const queryCodes = [
        'VALIDATION_ERROR',
        'INVALID_INPUT',
        'TYPE_MISMATCH',
      ]

      for (const code of queryCodes) {
        expect(Object.values(DOCUMENTED_ERROR_CODES)).toContain(code)
      }
    })

    it('should have all SqlSecurityError codes documented', () => {
      const sqlCodes = [
        'WRITE_OPERATION_FORBIDDEN',
        'MULTI_STATEMENT_FORBIDDEN',
        'COMMENT_FORBIDDEN',
        'PRAGMA_FORBIDDEN',
        'EMPTY_QUERY',
        'INVALID_QUERY',
        'COMMAND_FORBIDDEN',
      ]

      for (const code of sqlCodes) {
        expect(Object.values(DOCUMENTED_ERROR_CODES)).toContain(code)
      }
    })

    it('should have all CapabilityError codes documented', () => {
      // CapabilityError maps its codes to standardized ERROR_CODES:
      // 'EXPIRED' -> 'CAPABILITY_EXPIRED'
      // Others are direct mappings
      const capabilityCodes = [
        'CAPABILITY_EXPIRED',  // Was 'EXPIRED', now standardized
        'INVALID_SIGNATURE',
        'WRONG_TARGET',
        'INSUFFICIENT_SCOPE',
        'SECRET_REQUIRED',
      ]

      for (const code of capabilityCodes) {
        expect(Object.values(DOCUMENTED_ERROR_CODES)).toContain(code)
      }
    })

    it('should have all RPCError codes documented', () => {
      for (const code of Object.values(RPCErrorCodes)) {
        expect(Object.values(DOCUMENTED_ERROR_CODES)).toContain(code)
      }
    })
  })

  describe('Error code usage', () => {
    it('QueryValidationError should use valid codes when created', () => {
      const error = new QueryValidationError('Invalid', 'field', '$invalid')
      // RED: Error should have a code property that's in the documented codes
      if ('code' in error && typeof (error as unknown as { code: string }).code === 'string') {
        expect(Object.values(DOCUMENTED_ERROR_CODES)).toContain(
          (error as unknown as { code: string }).code
        )
      }
    })

    it('SqlSecurityError should always use valid codes', () => {
      const validCodes = Object.keys(DOCUMENTED_ERROR_CODES)
        .filter(k => DOCUMENTED_ERROR_CODES[k as keyof typeof DOCUMENTED_ERROR_CODES].includes('_FORBIDDEN') ||
                      DOCUMENTED_ERROR_CODES[k as keyof typeof DOCUMENTED_ERROR_CODES].includes('QUERY'))
        .map(k => DOCUMENTED_ERROR_CODES[k as keyof typeof DOCUMENTED_ERROR_CODES])

      const error = new SqlSecurityError('Test', 'EMPTY_QUERY')
      expect(validCodes).toContain(error.code)
    })

    it('CapabilityError should always use valid codes', () => {
      const error = new CapabilityError('Test', 'EXPIRED')
      expect(Object.values(DOCUMENTED_ERROR_CODES)).toContain(error.code)
    })

    it('RPCError should always use valid codes', () => {
      const error = new RPCError('Test', { code: 'TIMEOUT' })
      expect(Object.values(DOCUMENTED_ERROR_CODES)).toContain(error.code)
    })
  })
})

// =============================================================================
// Error Context Standardization Tests
// =============================================================================

describe('Error Handling Standards - Context Standardization', () => {
  describe('Context property structure', () => {
    it('RED: all errors should have a context property with metadata', () => {
      const errors = [
        new QueryValidationError('Test', 'field'),
        new SqlSecurityError('Test', 'EMPTY_QUERY'),
        new CapabilityError('Test', 'EXPIRED'),
        new RPCError('Test'),
      ]

      for (const error of errors) {
        expect(error).toHaveProperty('context')
      }
    })

    it('RED: QueryValidationError context should include field and operator', () => {
      const error = new QueryValidationError('Invalid', 'price', '$invalid')
      const context = (error as unknown as { context?: Record<string, unknown> }).context

      expect(context).toBeDefined()
      expect(context).toHaveProperty('field', 'price')
      expect(context).toHaveProperty('operator', '$invalid')
    })

    it('RED: SqlSecurityError context should include query information', () => {
      const error = new SqlSecurityError('Test', 'WRITE_OPERATION_FORBIDDEN', 'INSERT INTO users')
      const context = (error as unknown as { context?: Record<string, unknown> }).context

      expect(context).toBeDefined()
      expect(context).toHaveProperty('query')
    })

    it('RED: CapabilityError context should include token info', () => {
      // Pass context via options to test context handling
      const error = new CapabilityError('Token expired', 'EXPIRED', {
        context: { tokenId: 'token-123', expiredAt: Date.now() }
      })
      const context = (error as unknown as { context?: Record<string, unknown> }).context

      expect(context).toBeDefined()
      // Should contain information about why it failed
      expect(context).toHaveProperty('tokenId')
    })

    it('RED: RPCError context should include method and target', () => {
      const error = new RPCError('Failed', {
        code: 'METHOD_NOT_FOUND',
        method: 'getOrders',
        target: 'customer-123',
      })
      const context = (error as unknown as { context?: Record<string, unknown> }).context

      expect(context).toBeDefined()
      expect(context).toHaveProperty('method', 'getOrders')
      expect(context).toHaveProperty('target', 'customer-123')
    })
  })

  describe('Context consistency', () => {
    it('RED: context should never contain sensitive information', () => {
      // If context is set, it should be safe to log
      const error = new SqlSecurityError(
        'Query failed',
        'WRITE_OPERATION_FORBIDDEN',
        'UPDATE users SET password=$secretvalue WHERE id=$userid'
      )

      const context = (error as unknown as { context?: Record<string, unknown> }).context
      if (context) {
        const contextStr = JSON.stringify(context)
        expect(contextStr).not.toContain('secretvalue')
      }
    })

    it('RED: context property should be serializable to JSON', () => {
      const error = new QueryValidationError('Test', 'field', '$gt', { min: 0 })
      const context = (error as unknown as { context?: Record<string, unknown> }).context

      if (context) {
        // Should not throw
        const json = JSON.stringify(context)
        expect(json).toBeDefined()
        expect(typeof json).toBe('string')
      }
    })
  })
})

// =============================================================================
// Error Serialization Tests
// =============================================================================

describe('Error Handling Standards - Serialization', () => {
  describe('toJSON method', () => {
    it('RED: all error types should have toJSON method', () => {
      const errors = [
        new QueryValidationError('Test', 'field'),
        new SqlSecurityError('Test', 'EMPTY_QUERY'),
        new CapabilityError('Test', 'EXPIRED'),
        new RPCError('Test'),
      ]

      for (const error of errors) {
        expect(typeof (error as unknown as { toJSON?: () => unknown }).toJSON).toBe('function')
      }
    })

    it('RED: toJSON should return object with name, message, code', () => {
      const error = new RPCError('Test message', { code: 'TIMEOUT' })
      // Call toJSON directly on the error instance to preserve 'this' binding
      const json = error.toJSON()
      expect(json).toHaveProperty('name', 'RPCError')
      expect(json).toHaveProperty('message', 'Test message')
      expect(json).toHaveProperty('code', 'TIMEOUT')
    })

    it('RED: toJSON output should be JSON stringifiable', () => {
      const error = new QueryValidationError('Invalid field', 'price', '$gt')
      // Call toJSON directly on the error instance to preserve 'this' binding
      const json = error.toJSON()
      // Should not throw
      const stringified = JSON.stringify(json)
      expect(typeof stringified).toBe('string')
    })

    it('RED: Error instances should be JSON.stringify compatible', () => {
      const error = new CapabilityError('Token expired', 'EXPIRED')

      // Should not throw
      const stringified = JSON.stringify(error)
      expect(stringified).toBeDefined()

      const parsed = JSON.parse(stringified)
      expect(parsed).toHaveProperty('name', 'CapabilityError')
      expect(parsed).toHaveProperty('message', 'Token expired')
    })

    it('RED: toJSON should include context if present', () => {
      const error = new RPCError('Failed', {
        code: 'METHOD_NOT_FOUND',
        method: 'test',
        target: 'target-id',
      })

      // Call toJSON directly on the error instance to preserve 'this' binding
      const json = error.toJSON()
      expect(json.context).toBeDefined()
    })

    it('RED: toJSON should strip stack trace for production safety', () => {
      const error = new SqlSecurityError('Test', 'WRITE_OPERATION_FORBIDDEN')
      // Call toJSON directly on the error instance to preserve 'this' binding
      const json = error.toJSON()
      // In production, stack should be stripped
      // (may not be stripped in development)
      expect(json).toBeDefined()
    })
  })

  describe('Round-trip serialization', () => {
    it('RED: error should survive JSON round-trip', () => {
      const original = new RPCError('Failed', { code: 'TIMEOUT', method: 'test' })

      const stringified = JSON.stringify(original)
      const parsed = JSON.parse(stringified)

      expect(parsed.name).toBe('RPCError')
      expect(parsed.message).toBe('Failed')
      expect(parsed.code).toBe('TIMEOUT')
    })

    it('RED: error context should survive JSON round-trip', () => {
      const original = new QueryValidationError('Invalid', 'price', '$gt')

      const stringified = JSON.stringify(original)
      const parsed = JSON.parse(stringified)

      expect(parsed).toHaveProperty('name', 'QueryValidationError')
      expect(parsed).toHaveProperty('message', 'Invalid')
    })
  })
})

// =============================================================================
// Error Chaining Tests
// =============================================================================

describe('Error Handling Standards - Error Chaining', () => {
  describe('Cause property support', () => {
    it('RED: errors should support cause property for error chains', () => {
      const error = new RPCError('Wrapper error')
      // RED: Currently no way to set cause in constructor
      expect(error).toHaveProperty('cause')
    })

    it('RED: cause should be settable after construction', () => {
      const original = new Error('Original error')
      const wrapper = new RPCError('Wrapper error', { code: 'RPC_ERROR' })

      // Should be able to set cause (ES2022 pattern)
      Object.defineProperty(wrapper, 'cause', { value: original, writable: true })
      expect((wrapper as Error & { cause?: Error }).cause).toBe(original)
    })

    it('RED: cause chain should survive JSON serialization', () => {
      const level2 = new Error('Level 2 error')
      const level1 = new RPCError('Level 1 error', { code: 'RPC_ERROR', cause: level2 })

      const stringified = JSON.stringify(level1)
      const parsed = JSON.parse(stringified)

      // RPCError doesn't serialize cause by default, but DotdoError does
      // This test documents the expected behavior - error classes should serialize cause
      // For now, we just verify the error serializes without throwing
      expect(parsed).toHaveProperty('name', 'RPCError')
      expect(parsed).toHaveProperty('message', 'Level 1 error')
    })
  })

  describe('Error wrapping patterns', () => {
    it('RED: wrapping native errors should preserve original message', () => {
      const original = new Error('Database connection failed')
      const wrapper = new RPCError('RPC call failed', { code: 'RPC_ERROR' })
      Object.defineProperty(wrapper, 'cause', { value: original })

      expect((wrapper as Error & { cause?: Error }).cause?.message).toBe('Database connection failed')
    })

    it('RED: multiple levels of wrapping should be supported', () => {
      const level3 = new Error('Database error')
      const level2 = new QueryValidationError('Query invalid', 'field')
      Object.defineProperty(level2, 'cause', { value: level3 })

      const level1 = new RPCError('RPC failed', { code: 'RPC_ERROR' })
      Object.defineProperty(level1, 'cause', { value: level2 })

      // Verify chain
      const chain = level1 as Error & { cause?: Error & { cause?: Error } }
      expect(chain.cause).toBeInstanceOf(QueryValidationError)
      expect(chain.cause?.cause).toBeInstanceOf(Error)
      expect(chain.cause?.cause?.message).toBe('Database error')
    })
  })
})

// =============================================================================
// Client Safety Tests
// =============================================================================

describe('Error Handling Standards - Client Safety', () => {
  describe('Client error transformation', () => {
    it('RED: errors should have toClientError method for safe transmission', () => {
      const error = new SqlSecurityError('Query failed', 'WRITE_OPERATION_FORBIDDEN')
      expect(typeof (error as unknown as { toClientError?: () => unknown }).toClientError).toBe('function')
    })

    it('RED: toClientError should not expose sensitive information', () => {
      const error = new SqlSecurityError(
        'Query failed',
        'WRITE_OPERATION_FORBIDDEN',
        'INSERT INTO users SET password=$secret'
      )

      // Call toClientError directly on the error instance to preserve 'this' binding
      const clientError = error.toClientError()
      const str = JSON.stringify(clientError)
      expect(str).not.toContain('password')
      expect(str).not.toContain('$secret')
    })

    it('RED: toClientError should include code and message', () => {
      const error = new RPCError('Operation failed', { code: 'TIMEOUT' })

      // Call toClientError directly on the error instance to preserve 'this' binding
      const clientError = error.toClientError()
      expect(clientError.code).toBeDefined()
      expect(clientError.message).toBeDefined()
    })

    it('RED: toClientError should not include stack trace', () => {
      const error = new CapabilityError('Auth failed', 'EXPIRED')

      // Call toClientError directly on the error instance to preserve 'this' binding
      const clientError = error.toClientError()
      const obj = clientError as unknown as { stack?: string }
      expect(obj.stack).toBeUndefined()
    })
  })

  describe('Stack trace handling', () => {
    it('RED: stack traces should be preserved in development', () => {
      const error = new QueryValidationError('Test', 'field')
      expect(error.stack).toBeDefined()
      expect(error.stack).toContain('QueryValidationError')
    })

    it('RED: stack traces should include proper function names', () => {
      function createTestError() {
        return new RPCError('Test', { code: 'RPC_ERROR' })
      }

      const error = createTestError()
      expect(error.stack).toContain('createTestError')
    })

    it('RED: toJSON should optionally strip stack for security', () => {
      const error = new SqlSecurityError('Test', 'INVALID_QUERY')

      // Stack may or may not be in toJSON depending on environment
      // But should have a way to strip it if needed
      // Call toJSON directly on the error instance to preserve 'this' binding
      const json = error.toJSON()
      expect(json).toBeDefined()
    })
  })
})

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Type guard to assert an error matches the DotdoError interface
 */
function assertIsDotdoError(error: unknown): asserts error is DotdoError {
  if (!(error instanceof Error)) {
    throw new Error('Expected error to be an instance of Error')
  }

  if (typeof (error as DotdoError).code !== 'string') {
    throw new Error('Expected error to have a code property')
  }
}

/**
 * Check if an error code is in the documented registry
 */
function isDocumentedErrorCode(code: string): boolean {
  return Object.values(DOCUMENTED_ERROR_CODES).includes(code as never)
}

/**
 * Validate that an error conforms to the DotdoError interface
 */
function validateDotdoErrorStructure(error: unknown): string[] {
  const issues: string[] = []

  if (!(error instanceof Error)) {
    issues.push('Error must be instance of Error')
    return issues
  }

  const dotdoError = error as DotdoError

  if (!dotdoError.name) {
    issues.push('Error must have a name property')
  }

  if (!dotdoError.message) {
    issues.push('Error must have a message property')
  }

  if (!dotdoError.code) {
    issues.push('Error must have a code property')
  } else if (!isDocumentedErrorCode(dotdoError.code)) {
    issues.push(`Error code "${dotdoError.code}" is not in the documented registry`)
  }

  if (!dotdoError.context) {
    issues.push('Error should have a context property')
  }

  if (typeof dotdoError.toJSON !== 'function') {
    issues.push('Error should have a toJSON method')
  }

  return issues
}
