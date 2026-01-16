/**
 * RPC Error Serialization Tests
 *
 * RED Phase: Tests for error serialization over RPC.
 * Verifies that errors serialize correctly, types are preserved,
 * and nested error chains work properly.
 *
 * Issue: do-3haz
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:test'

// Import existing error types
import { CapabilityError } from '../capability-token'
import { RPCError, RPCErrorCodes } from '../proxy'
import { serialize, deserialize } from '../transport'
import { QueryValidationError } from '../../core/query-validation'
import { SqlSecurityError } from '../../core/sql-security'

// =============================================================================
// Error Serialization Format
// =============================================================================

/**
 * Expected serialized error format for RPC transport
 */
interface SerializedError {
  $type: 'Error' | 'RPCError' | 'CapabilityError' | 'QueryValidationError' | 'SqlSecurityError' | string
  name: string
  message: string
  code: string
  context?: Record<string, unknown>
  cause?: SerializedError
  stack?: string
}

// =============================================================================
// Error Serialization Tests
// =============================================================================

describe('RPC Error Serialization', () => {
  describe('Basic Error Serialization', () => {
    it('should serialize RPCError to JSON correctly', () => {
      const error = new RPCError('Method not found', {
        code: 'METHOD_NOT_FOUND',
        method: 'getOrders',
        target: 'customer-123',
      })

      const serialized = serialize(error)
      expect(serialized).toBeDefined()

      // Should be valid JSON
      const parsed = JSON.parse(serialized as string)

      // RED: serialize doesn't handle errors specially
      expect(parsed.$type).toBe('RPCError')
      expect(parsed.name).toBe('RPCError')
      expect(parsed.message).toBe('Method not found')
      expect(parsed.code).toBe('METHOD_NOT_FOUND')
      expect(parsed.method).toBe('getOrders')
      expect(parsed.target).toBe('customer-123')
    })

    it('should serialize CapabilityError to JSON correctly', () => {
      const error = new CapabilityError('Token expired', 'EXPIRED')

      const serialized = serialize(error)
      const parsed = JSON.parse(serialized as string)

      // RED: serialize doesn't handle errors specially
      expect(parsed.$type).toBe('CapabilityError')
      expect(parsed.name).toBe('CapabilityError')
      expect(parsed.message).toBe('Token expired')
      expect(parsed.code).toBe('EXPIRED')
    })

    it('should serialize QueryValidationError to JSON correctly', () => {
      const error = new QueryValidationError('Invalid operator', 'price', '$invalid', {
        allowedOperators: ['$gt', '$lt'],
      })

      const serialized = serialize(error)
      const parsed = JSON.parse(serialized as string)

      // RED: serialize doesn't handle errors specially
      expect(parsed.$type).toBe('QueryValidationError')
      expect(parsed.name).toBe('QueryValidationError')
      expect(parsed.message).toBe('Invalid operator')
      expect(parsed.field).toBe('price')
      expect(parsed.operator).toBe('$invalid')
    })

    it('should serialize SqlSecurityError to JSON correctly', () => {
      const error = new SqlSecurityError(
        'Write operations not allowed',
        'WRITE_OPERATION_FORBIDDEN',
        'INSERT INTO users'
      )

      const serialized = serialize(error)
      const parsed = JSON.parse(serialized as string)

      // RED: serialize doesn't handle errors specially
      expect(parsed.$type).toBe('SqlSecurityError')
      expect(parsed.name).toBe('SqlSecurityError')
      expect(parsed.message).toBe('Write operations not allowed')
      expect(parsed.code).toBe('WRITE_OPERATION_FORBIDDEN')
      // Note: query should NOT be serialized to client for security
      expect(parsed.query).toBeUndefined()
    })
  })

  describe('Error Deserialization', () => {
    it('should deserialize RPCError from JSON', () => {
      const original = new RPCError('Test error', {
        code: 'TIMEOUT',
        method: 'getOrders',
      })

      const serialized = serialize(original)
      const deserialized = deserialize(serialized as string)

      // RED: deserialize doesn't reconstruct error instances
      expect(deserialized).toBeInstanceOf(RPCError)
      expect((deserialized as RPCError).message).toBe('Test error')
      expect((deserialized as RPCError).code).toBe('TIMEOUT')
      expect((deserialized as RPCError).method).toBe('getOrders')
    })

    it('should deserialize CapabilityError from JSON', () => {
      const original = new CapabilityError('Invalid token', 'INVALID_SIGNATURE')

      const serialized = serialize(original)
      const deserialized = deserialize(serialized as string)

      // RED: deserialize doesn't reconstruct error instances
      expect(deserialized).toBeInstanceOf(CapabilityError)
      expect((deserialized as CapabilityError).message).toBe('Invalid token')
      expect((deserialized as CapabilityError).code).toBe('INVALID_SIGNATURE')
    })

    it('should deserialize QueryValidationError from JSON', () => {
      const original = new QueryValidationError('Bad query', 'age', '$gt')

      const serialized = serialize(original)
      const deserialized = deserialize(serialized as string)

      // RED: deserialize doesn't reconstruct error instances
      expect(deserialized).toBeInstanceOf(QueryValidationError)
      expect((deserialized as QueryValidationError).message).toBe('Bad query')
      expect((deserialized as QueryValidationError).field).toBe('age')
    })

    it('should deserialize SqlSecurityError from JSON', () => {
      const original = new SqlSecurityError('Security violation', 'MULTI_STATEMENT_FORBIDDEN')

      const serialized = serialize(original)
      const deserialized = deserialize(serialized as string)

      // RED: deserialize doesn't reconstruct error instances
      expect(deserialized).toBeInstanceOf(SqlSecurityError)
      expect((deserialized as SqlSecurityError).message).toBe('Security violation')
      expect((deserialized as SqlSecurityError).code).toBe('MULTI_STATEMENT_FORBIDDEN')
    })

    it('should preserve error type during round-trip', () => {
      const errors = [
        new RPCError('RPC failed', { code: 'RPC_ERROR' }),
        new CapabilityError('Expired', 'EXPIRED'),
        new QueryValidationError('Invalid', 'field'),
        new SqlSecurityError('Forbidden', 'COMMAND_FORBIDDEN'),
      ]

      for (const original of errors) {
        const serialized = serialize(original)
        const deserialized = deserialize(serialized as string)

        // RED: Type should be preserved
        expect(deserialized.constructor.name).toBe(original.constructor.name)
      }
    })
  })

  describe('Error Type Preservation Over RPC', () => {
    it('should preserve RPCError type when returned from DO', async () => {
      const getCore = () => {
        const id = env.DOCore.idFromName('rpc-error-preservation-test')
        return env.DOCore.get(id)
      }

      const core = getCore()

      try {
        // Call a method that should throw an RPCError
        await core.rpcCall('nonexistentMethod', [])
        expect.fail('Should have thrown')
      } catch (error) {
        // RED: Error type should be preserved when returned from DO
        expect(error).toBeInstanceOf(RPCError)
        expect((error as RPCError).code).toBe('METHOD_NOT_FOUND')
      }
    })

    it('should preserve CapabilityError type when returned from DO', async () => {
      const getCore = () => {
        const id = env.DOCore.idFromName('capability-error-preservation-test')
        return env.DOCore.get(id)
      }

      const core = getCore()

      try {
        // Call with invalid token (no secret configured)
        await core.rpcCall('ping', [], 'invalid.token.here')
        expect.fail('Should have thrown')
      } catch (error) {
        // RED: Error type should be preserved
        expect(error).toBeInstanceOf(CapabilityError)
        expect((error as CapabilityError).code).toBe('SECRET_REQUIRED')
      }
    })

    it('should preserve QueryValidationError type when returned from DO', async () => {
      const getCore = () => {
        const id = env.DOCore.idFromName('query-error-preservation-test')
        return env.DOCore.get(id)
      }

      const core = getCore()

      try {
        // Query with invalid operator
        await core.things.list({
          where: { price: { $invalid: 100 } },
        })
        expect.fail('Should have thrown')
      } catch (error) {
        // RED: Error type should be preserved
        expect(error).toBeInstanceOf(QueryValidationError)
        expect((error as QueryValidationError).field).toBe('price')
      }
    })
  })

  describe('Nested Error Chains', () => {
    it('should serialize error with cause chain', () => {
      const originalError = new Error('Database connection failed')
      const wrapperError = new RPCError('Failed to get orders', { code: 'RPC_ERROR' })

      // Set up cause chain (ES2022 pattern)
      Object.defineProperty(wrapperError, 'cause', { value: originalError })

      const serialized = serialize(wrapperError)
      const parsed = JSON.parse(serialized as string)

      // RED: serialize should include cause chain
      expect(parsed.cause).toBeDefined()
      expect(parsed.cause.message).toBe('Database connection failed')
    })

    it('should deserialize error with cause chain', () => {
      const originalError = new Error('Original cause')
      const wrapperError = new RPCError('Wrapper error', { code: 'RPC_ERROR' })
      Object.defineProperty(wrapperError, 'cause', { value: originalError })

      const serialized = serialize(wrapperError)
      const deserialized = deserialize(serialized as string) as RPCError

      // RED: deserialize should restore cause chain
      expect((deserialized as Error & { cause?: Error }).cause).toBeDefined()
      expect((deserialized as Error & { cause?: Error }).cause).toBeInstanceOf(Error)
      expect((deserialized as Error & { cause?: Error }).cause?.message).toBe('Original cause')
    })

    it('should handle multiple levels of error nesting', () => {
      const level3 = new Error('Database error')
      const level2 = new QueryValidationError('Validation failed', 'field')
      const level1 = new RPCError('RPC failed', { code: 'RPC_ERROR' })

      Object.defineProperty(level2, 'cause', { value: level3 })
      Object.defineProperty(level1, 'cause', { value: level2 })

      const serialized = serialize(level1)
      const deserialized = deserialize(serialized as string) as RPCError

      // RED: Should preserve multi-level cause chain
      const deserializedWithCause = deserialized as Error & { cause?: Error & { cause?: Error } }
      expect(deserializedWithCause.cause).toBeDefined()
      expect(deserializedWithCause.cause).toBeInstanceOf(QueryValidationError)
      expect(deserializedWithCause.cause?.cause).toBeDefined()
      expect(deserializedWithCause.cause?.cause?.message).toBe('Database error')
    })

    it('should handle circular cause references gracefully', () => {
      const error1 = new RPCError('Error 1', { code: 'RPC_ERROR' })
      const error2 = new RPCError('Error 2', { code: 'RPC_ERROR' })

      // Create circular reference
      Object.defineProperty(error1, 'cause', { value: error2 })
      Object.defineProperty(error2, 'cause', { value: error1 })

      // RED: serialize should handle circular references without infinite loop
      expect(() => serialize(error1)).not.toThrow()

      const serialized = serialize(error1)
      expect(serialized).toBeDefined()
    })
  })

  describe('Error Response Format', () => {
    it('should format RPC error response consistently', async () => {
      const getCore = () => {
        const id = env.DOCore.idFromName('error-response-format-test')
        return env.DOCore.get(id)
      }

      const core = getCore()

      // Make an HTTP request that will fail
      const response = await core.fetch('https://test.api.dotdo.dev/rpc', {
        method: 'POST',
        body: JSON.stringify({
          method: 'nonexistent',
          args: [],
        }),
      })

      const body = await response.json()

      // RED: Error responses should have consistent format
      expect(body).toMatchObject({
        error: {
          code: expect.any(String),
          message: expect.any(String),
        },
      })

      // Error response should not include stack trace by default
      expect(body.error.stack).toBeUndefined()
    })

    it('should include request correlation ID in error responses', async () => {
      const getCore = () => {
        const id = env.DOCore.idFromName('correlation-error-test')
        return env.DOCore.get(id)
      }

      const core = getCore()

      const correlationId = 'req-12345-67890'

      const response = await core.fetch('https://test.api.dotdo.dev/rpc', {
        method: 'POST',
        headers: {
          'X-Correlation-ID': correlationId,
        },
        body: JSON.stringify({
          method: 'nonexistent',
          args: [],
        }),
      })

      const body = await response.json()

      // RED: Error responses should include correlation ID
      expect(body.correlationId).toBe(correlationId)
    })
  })

  describe('Error Stack Trace Handling', () => {
    it('should include stack trace in serialized errors for development', () => {
      const error = new RPCError('Test error', { code: 'RPC_ERROR' })

      const serialized = serialize(error)
      const parsed = JSON.parse(serialized as string)

      // RED: Stack should be included when serializing errors
      expect(parsed.stack).toBeDefined()
      expect(parsed.stack).toContain('RPCError')
    })

    it('should strip stack trace for production/client responses', () => {
      const error = new RPCError('Test error', { code: 'RPC_ERROR' })

      // RED: Should have option to strip stack for production
      const serializedForClient = serialize(error, { stripStack: true } as never)
      const parsed = JSON.parse(serializedForClient as string)

      expect(parsed.stack).toBeUndefined()
    })

    it('should preserve stack trace through RPC round-trip in development', () => {
      const error = new QueryValidationError('Test', 'field')
      const originalStack = error.stack

      const serialized = serialize(error)
      const deserialized = deserialize(serialized as string) as QueryValidationError

      // RED: Stack should survive round-trip
      expect(deserialized.stack).toBe(originalStack)
    })
  })

  describe('Unknown Error Handling', () => {
    it('should wrap unknown errors in a standard format', () => {
      // Simulate a plain object thrown as an error
      const weirdError = { strange: 'object', thrown: true }

      // RED: serialize should handle non-Error objects
      const serialized = serialize(weirdError)
      const parsed = JSON.parse(serialized as string)

      // Should be wrapped in a standard format
      expect(parsed.$type).toBeDefined()
    })

    it('should handle primitive values thrown as errors', () => {
      const primitives = ['string error', 42, null, undefined, true]

      for (const primitive of primitives) {
        // RED: serialize should handle primitives thrown as errors
        expect(() => serialize(primitive)).not.toThrow()
      }
    })
  })
})

// =============================================================================
// Helper Types
// =============================================================================

// Augment the serialize function type for testing purposes
declare module '../transport' {
  interface SerializeOptions {
    stripStack?: boolean
  }
}
