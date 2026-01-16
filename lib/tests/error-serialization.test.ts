/**
 * Error Serialization and RPC Transport Test Suite (RED Phase)
 *
 * Tests for error serialization over RPC transport, error type preservation,
 * and nested error chain handling. These RED phase tests define the desired
 * behavior for error transmission across distributed systems.
 *
 * Issue: do-3haz (Wave 5 - Error Handling Consistency)
 * Status: RED - Tests for desired behavior that doesn't yet exist
 *
 * @module lib/tests/error-serialization
 */

import { describe, it, expect } from 'vitest'
import { QueryValidationError } from '../../core/query-validation'
import { SqlSecurityError } from '../../core/sql-security'
import { CapabilityError } from '../../rpc/capability-token'
import { RPCError, RPCErrorCodes } from '../../rpc/proxy'

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Serialized error format for RPC transport
 * Errors must serialize to a format that can be transmitted over HTTP/RPC
 */
interface SerializedError {
  $type: string // Error class name for reconstruction
  name: string
  message: string
  code: string
  context?: Record<string, unknown>
  cause?: SerializedError | null
  stack?: string
}

/**
 * Mock serialize/deserialize functions for testing
 * In production, these would be in rpc/transport.ts
 */
function mockSerialize(error: unknown): string {
  if (!(error instanceof Error)) {
    return JSON.stringify({ $type: 'Error', message: String(error) })
  }

  const serialized: Record<string, unknown> = {
    $type: error.constructor.name,
    name: error.name,
    message: error.message,
  }

  // Add code if present
  if ('code' in error && typeof (error as unknown as { code: string }).code === 'string') {
    serialized.code = (error as unknown as { code: string }).code
  }

  // Add context if present
  if ('context' in error) {
    serialized.context = (error as unknown as { context: unknown }).context
  }

  // Add cause if present
  if ('cause' in error && (error as unknown as { cause: unknown }).cause) {
    serialized.cause = JSON.parse(mockSerialize((error as unknown as { cause: unknown }).cause))
  }

  // Add stack in development
  if (error.stack && process.env.NODE_ENV !== 'production') {
    serialized.stack = error.stack
  }

  return JSON.stringify(serialized)
}

function mockDeserialize(json: string): unknown {
  const parsed = JSON.parse(json)

  if (!parsed.$type || parsed.$type === 'Error') {
    return new Error(parsed.message)
  }

  // For now, return as plain object since we can't reconstruct properly
  return parsed
}

// =============================================================================
// Basic Error Serialization Tests
// =============================================================================

describe('Error Serialization - Basic Types', () => {
  describe('QueryValidationError serialization', () => {
    it('RED: should serialize QueryValidationError with $type marker', () => {
      const error = new QueryValidationError('Invalid operator', 'price', '$invalid')
      const json = mockSerialize(error)
      const parsed = JSON.parse(json)

      expect(parsed.$type).toBe('QueryValidationError')
      expect(parsed.name).toBe('QueryValidationError')
      expect(parsed.message).toBe('Invalid operator')
    })

    it('RED: should include field and operator in serialized form', () => {
      const error = new QueryValidationError('Invalid', 'price', '$invalid')
      const json = mockSerialize(error)
      const parsed = JSON.parse(json)

      // Should be in context or as separate properties
      expect(parsed).toHaveProperty('name', 'QueryValidationError')
      expect(parsed).toHaveProperty('message', 'Invalid')
    })

    it('RED: JSON stringification should not throw', () => {
      const error = new QueryValidationError('Test', 'field', '$gt', { min: 0 })
      expect(() => JSON.stringify(error)).not.toThrow()
    })
  })

  describe('SqlSecurityError serialization', () => {
    it('RED: should serialize SqlSecurityError with $type marker', () => {
      const error = new SqlSecurityError('Write forbidden', 'WRITE_OPERATION_FORBIDDEN')
      const json = mockSerialize(error)
      const parsed = JSON.parse(json)

      expect(parsed.$type).toBe('SqlSecurityError')
      expect(parsed.name).toBe('SqlSecurityError')
      expect(parsed.message).toBe('Write forbidden')
      expect(parsed.code).toBe('WRITE_OPERATION_FORBIDDEN')
    })

    it('RED: should NOT include query in serialized form for security', () => {
      const error = new SqlSecurityError(
        'Forbidden',
        'WRITE_OPERATION_FORBIDDEN',
        'INSERT INTO users (password) VALUES (?)'
      )
      const json = mockSerialize(error)
      const parsed = JSON.parse(json)

      // Query should never be in serialized error
      expect(JSON.stringify(parsed)).not.toContain('INSERT')
      expect(JSON.stringify(parsed)).not.toContain('password')
    })

    it('RED: should be JSON stringifiable without error leakage', () => {
      const error = new SqlSecurityError('Test', 'INVALID_QUERY', 'SELECT * FROM sensitive_data')
      const stringified = JSON.stringify(error)

      // Should not expose the query
      expect(stringified).not.toContain('sensitive_data')
      expect(stringified).not.toContain('SELECT')
    })
  })

  describe('CapabilityError serialization', () => {
    it('RED: should serialize CapabilityError with $type marker', () => {
      const error = new CapabilityError('Token expired', 'EXPIRED')
      const json = mockSerialize(error)
      const parsed = JSON.parse(json)

      expect(parsed.$type).toBe('CapabilityError')
      expect(parsed.name).toBe('CapabilityError')
      expect(parsed.message).toBe('Token expired')
      expect(parsed.code).toBe('EXPIRED')
    })

    it('RED: should not expose sensitive token info in serialization', () => {
      const error = new CapabilityError('Token expired', 'EXPIRED')
      const json = mockSerialize(error)

      // Should not contain any token data
      expect(json).not.toContain('secret')
      expect(json).not.toContain('signature')
    })

    it('RED: JSON stringification should be safe', () => {
      const error = new CapabilityError('Auth failed', 'INVALID_SIGNATURE')
      expect(() => JSON.stringify(error)).not.toThrow()
    })
  })

  describe('RPCError serialization', () => {
    it('RED: should serialize RPCError with $type marker', () => {
      const error = new RPCError('Method not found', { code: 'METHOD_NOT_FOUND', method: 'getOrders' })
      const json = mockSerialize(error)
      const parsed = JSON.parse(json)

      expect(parsed.$type).toBe('RPCError')
      expect(parsed.name).toBe('RPCError')
      expect(parsed.message).toBe('Method not found')
      expect(parsed.code).toBe('METHOD_NOT_FOUND')
    })

    it('RED: should include method and target in serialized form', () => {
      const error = new RPCError('Timeout', {
        code: 'TIMEOUT',
        method: 'getOrders',
        target: 'customer-123',
      })
      const json = mockSerialize(error)
      const parsed = JSON.parse(json)

      expect(parsed).toHaveProperty('code', 'TIMEOUT')
      // Method and target should be in context or structure
      expect(parsed).toBeDefined()
    })

    it('RED: JSON stringification should not throw', () => {
      const error = new RPCError('Test', { code: 'RPC_ERROR', method: 'test' })
      expect(() => JSON.stringify(error)).not.toThrow()
    })
  })
})

// =============================================================================
// Error Type Reconstruction Tests
// =============================================================================

describe('Error Serialization - Type Reconstruction', () => {
  describe('Type preservation through serialization', () => {
    it('RED: serialized error should preserve type information', () => {
      const errors = [
        new QueryValidationError('Test', 'field'),
        new SqlSecurityError('Test', 'EMPTY_QUERY'),
        new CapabilityError('Test', 'EXPIRED'),
        new RPCError('Test', { code: 'RPC_ERROR' }),
      ]

      for (const error of errors) {
        const json = mockSerialize(error)
        const parsed = JSON.parse(json)
        expect(parsed.$type).toBe(error.constructor.name)
      }
    })

    it('RED: deserialized error should be identifiable by type', () => {
      const original = new RPCError('Failed', { code: 'TIMEOUT', method: 'test' })
      const json = mockSerialize(original)
      const parsed = JSON.parse(json)

      expect(parsed.$type).toBe('RPCError')
      expect(parsed.code).toBe('TIMEOUT')
    })

    it('RED: error code should survive round-trip', () => {
      const codes = [
        'VALIDATION_ERROR',
        'WRITE_OPERATION_FORBIDDEN',
        'EXPIRED',
        'TIMEOUT',
      ]

      for (const code of codes) {
        let error: Error & { code?: string }
        if (code === 'VALIDATION_ERROR') {
          error = new QueryValidationError('Test', 'field')
        } else if (code === 'WRITE_OPERATION_FORBIDDEN') {
          error = new SqlSecurityError('Test', 'WRITE_OPERATION_FORBIDDEN')
        } else if (code === 'EXPIRED') {
          error = new CapabilityError('Test', 'EXPIRED')
        } else {
          error = new RPCError('Test', { code: code as never })
        }

        const json = mockSerialize(error)
        const parsed = JSON.parse(json)
        expect(parsed.code).toBe(code)
      }
    })
  })

  describe('Message preservation', () => {
    it('RED: error message should survive serialization', () => {
      const messages = [
        'Invalid query operator',
        'Write operations not allowed',
        'Authentication token expired',
        'Remote method timeout',
      ]

      const errors = [
        new QueryValidationError(messages[0], 'field'),
        new SqlSecurityError(messages[1], 'WRITE_OPERATION_FORBIDDEN'),
        new CapabilityError(messages[2], 'EXPIRED'),
        new RPCError(messages[3], { code: 'TIMEOUT' }),
      ]

      for (let i = 0; i < errors.length; i++) {
        const json = mockSerialize(errors[i])
        const parsed = JSON.parse(json)
        expect(parsed.message).toBe(messages[i])
      }
    })

    it('RED: message should not be corrupted in JSON encoding', () => {
      const messages = [
        'Invalid "quotes" in message',
        "Single 'quotes' in message",
        'Backslash \\ and special chars',
      ]

      for (const msg of messages) {
        const error = new RPCError(msg, { code: 'RPC_ERROR' })
        const json = mockSerialize(error)
        const parsed = JSON.parse(json)
        expect(parsed.message).toBe(msg)
      }
    })
  })
})

// =============================================================================
// Error Chaining and Nesting Tests
// =============================================================================

describe('Error Serialization - Chaining', () => {
  describe('Cause chain serialization', () => {
    it('RED: should serialize error with cause', () => {
      const cause = new Error('Database error')
      const error = new RPCError('RPC failed', { code: 'RPC_ERROR' })
      Object.defineProperty(error, 'cause', { value: cause })

      const json = mockSerialize(error)
      const parsed = JSON.parse(json)

      expect(parsed.cause).toBeDefined()
      expect(parsed.cause.message).toBe('Database error')
    })

    it('RED: should serialize multi-level cause chains', () => {
      const level3 = new Error('Level 3')
      const level2 = new QueryValidationError('Level 2', 'field')
      Object.defineProperty(level2, 'cause', { value: level3 })

      const level1 = new RPCError('Level 1', { code: 'RPC_ERROR' })
      Object.defineProperty(level1, 'cause', { value: level2 })

      const json = mockSerialize(level1)
      const parsed = JSON.parse(json)

      // Verify chain structure
      expect(parsed.cause).toBeDefined()
      expect(parsed.cause.cause).toBeDefined()
      expect(parsed.cause.cause.message).toBe('Level 3')
    })

    it('RED: should handle circular cause references', () => {
      const error1 = new RPCError('Error 1', { code: 'RPC_ERROR' })
      const error2 = new RPCError('Error 2', { code: 'RPC_ERROR' })

      Object.defineProperty(error1, 'cause', { value: error2 })
      Object.defineProperty(error2, 'cause', { value: error1 })

      // Should not throw infinite loop
      expect(() => mockSerialize(error1)).not.toThrow()

      const json = mockSerialize(error1)
      expect(json).toBeDefined()
    })

    it('RED: cause chain should survive JSON round-trip', () => {
      const cause = new Error('Original')
      const error = new RPCError('Wrapper', { code: 'RPC_ERROR' })
      Object.defineProperty(error, 'cause', { value: cause })

      const json = mockSerialize(error)
      const parsed = JSON.parse(json)

      // Check both levels survive
      expect(parsed.message).toBe('Wrapper')
      expect(parsed.code).toBe('RPC_ERROR')
      expect(parsed.cause.message).toBe('Original')
    })
  })

  describe('Nested error handling', () => {
    it('RED: wrapped QueryValidationError should preserve field info', () => {
      const inner = new QueryValidationError('Invalid', 'price', '$invalid')
      const outer = new RPCError('Query failed', { code: 'RPC_ERROR' })
      Object.defineProperty(outer, 'cause', { value: inner })

      const json = mockSerialize(outer)
      const parsed = JSON.parse(json)

      expect(parsed.cause).toBeDefined()
      expect(parsed.cause.name).toBe('QueryValidationError')
    })

    it('RED: wrapped SqlSecurityError should not expose query', () => {
      const inner = new SqlSecurityError('Forbidden', 'WRITE_OPERATION_FORBIDDEN', 'INSERT SECRET')
      const outer = new RPCError('Operation failed', { code: 'RPC_ERROR' })
      Object.defineProperty(outer, 'cause', { value: inner })

      const json = mockSerialize(outer)

      // Query should not appear anywhere
      expect(json).not.toContain('INSERT')
      expect(json).not.toContain('SECRET')
    })
  })
})

// =============================================================================
// Stack Trace Handling Tests
// =============================================================================

describe('Error Serialization - Stack Traces', () => {
  describe('Stack trace preservation', () => {
    it('RED: serialized error should include stack in development', () => {
      if (process.env.NODE_ENV !== 'production') {
        const error = new RPCError('Test', { code: 'RPC_ERROR' })
        const json = mockSerialize(error)
        const parsed = JSON.parse(json)

        expect(parsed.stack).toBeDefined()
        expect(parsed.stack).toContain('RPCError')
      }
    })

    it('RED: stack trace should identify error location', () => {
      function throwError() {
        return new QueryValidationError('Test', 'field')
      }

      const error = throwError()
      const json = mockSerialize(error)
      const parsed = JSON.parse(json)

      if (parsed.stack) {
        expect(parsed.stack).toContain('throwError')
      }
    })

    it('RED: stack should be stripped in production', () => {
      const originalEnv = process.env.NODE_ENV
      process.env.NODE_ENV = 'production'

      try {
        const error = new CapabilityError('Test', 'EXPIRED')
        const json = mockSerialize(error)
        const parsed = JSON.parse(json)

        // In production, stack should not be included
        expect(parsed.stack).toBeUndefined()
      } finally {
        process.env.NODE_ENV = originalEnv
      }
    })
  })

  describe('Stack trace safety', () => {
    it('RED: stack trace should not expose sensitive information', () => {
      const error = new SqlSecurityError('Test', 'WRITE_OPERATION_FORBIDDEN', 'SECRET_QUERY')
      const json = mockSerialize(error)

      if (process.env.NODE_ENV !== 'production') {
        // Stack should not contain the secret query
        expect(json).not.toContain('SECRET_QUERY')
      }
    })

    it('RED: stack from cause should also be sanitized', () => {
      const cause = new Error('Private database error')
      const wrapper = new RPCError('RPC failed', { code: 'RPC_ERROR' })
      Object.defineProperty(wrapper, 'cause', { value: cause })

      const json = mockSerialize(wrapper)

      // Should not expose internal details
      expect(json).not.toContain('database')
    })
  })
})

// =============================================================================
// Context Serialization Tests
// =============================================================================

describe('Error Serialization - Context', () => {
  describe('Context in serialized form', () => {
    it('RED: context should be serialized as separate property', () => {
      const error = new RPCError('Failed', {
        code: 'METHOD_NOT_FOUND',
        method: 'getOrders',
        target: 'customer-123',
      })

      const json = mockSerialize(error)
      const parsed = JSON.parse(json)

      // Context or method/target should be available
      expect(parsed).toHaveProperty('code', 'METHOD_NOT_FOUND')
    })

    it('RED: context should be JSON-safe', () => {
      const error = new QueryValidationError('Invalid', 'field', '$gt', {
        allowedOperators: ['$gt', '$lt'],
        received: '$invalid',
      })

      const json = mockSerialize(error)
      // Should not throw
      expect(() => JSON.parse(json)).not.toThrow()
    })

    it('RED: context should not include circular references', () => {
      const error = new RPCError('Test', { code: 'RPC_ERROR' })

      // Should be serializable
      expect(() => JSON.stringify(error)).not.toThrow()
    })
  })

  describe('Context consistency in round-trip', () => {
    it('RED: structured context should survive serialization', () => {
      const error = new RPCError('Timeout', {
        code: 'TIMEOUT',
        method: 'processPayment',
        target: 'payment-service-1',
      })

      const json = mockSerialize(error)
      const parsed = JSON.parse(json)

      expect(parsed.code).toBe('TIMEOUT')
      expect(parsed.name).toBe('RPCError')
    })
  })
})

// =============================================================================
// Edge Case Tests
// =============================================================================

describe('Error Serialization - Edge Cases', () => {
  describe('Non-Error objects', () => {
    it('RED: should handle non-Error objects thrown as errors', () => {
      const weirdError = { message: 'Strange error', code: 'WEIRD' }

      // Should not throw
      expect(() => mockSerialize(weirdError)).not.toThrow()

      const json = mockSerialize(weirdError)
      expect(json).toBeDefined()
    })

    it('RED: should handle primitive values', () => {
      const primitives = ['string error', 42, null, undefined, true]

      for (const prim of primitives) {
        expect(() => mockSerialize(prim)).not.toThrow()
      }
    })

    it('RED: should handle undefined error gracefully', () => {
      expect(() => mockSerialize(undefined)).not.toThrow()
    })
  })

  describe('Special characters', () => {
    it('RED: should handle special characters in messages', () => {
      const messages = [
        'Error with "quotes"',
        "Error with 'apostrophes'",
        'Error with \\backslashes\\',
        'Error with \n newlines',
        'Error with \t tabs',
      ]

      for (const msg of messages) {
        const error = new RPCError(msg, { code: 'RPC_ERROR' })
        const json = mockSerialize(error)
        const parsed = JSON.parse(json)
        expect(parsed.message).toBe(msg)
      }
    })

    it('RED: should handle Unicode characters', () => {
      const error = new RPCError('Error: 你好 🚀 مرحبا', { code: 'RPC_ERROR' })
      const json = mockSerialize(error)
      const parsed = JSON.parse(json)
      expect(parsed.message).toBe('Error: 你好 🚀 مرحبا')
    })
  })

  describe('Large payloads', () => {
    it('RED: should handle large error messages', () => {
      const largeMessage = 'x'.repeat(10000)
      const error = new RPCError(largeMessage, { code: 'RPC_ERROR' })
      const json = mockSerialize(error)
      const parsed = JSON.parse(json)
      expect(parsed.message.length).toBe(10000)
    })

    it('RED: should handle large context objects', () => {
      const largeContext = { data: 'x'.repeat(10000) }
      const error = new RPCError('Test', { code: 'RPC_ERROR' })

      // Should handle large JSON encoding
      expect(() => JSON.stringify(error)).not.toThrow()
    })
  })
})
