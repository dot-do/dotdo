/**
 * Tests for RPC error deserialization type preservation
 *
 * When errors are serialized on the server and deserialized on the client,
 * the type information should be preserved for all built-in error types.
 *
 * IMPORTANT: Built-in error types (NotFoundError, ValidationError, etc.) are
 * fully preserved across RPC boundaries. Custom error subclasses cannot be
 * reconstructed without a registration mechanism.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createClient, createClientWithTransport } from '../client'
import { createServer } from '../server'
import {
  RPCError,
  RPCErrorCode,
  NotFoundError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  serializeError,
  deserializeError,
  isNotFoundError,
  isValidationError,
  isAuthenticationError,
  isRPCError,
} from '../errors'
import type { Transport, RPCMessage, RPCResponse } from '../transport/types'

describe('Error Deserialization Type Preservation', () => {
  describe('Direct serialization/deserialization', () => {
    it('should preserve NotFoundError type through serialization', () => {
      const original = NotFoundError.forResource('User', '123')
      const serialized = serializeError(original)
      const deserialized = deserializeError(serialized)

      // This currently passes - basic type is preserved
      expect(deserialized).toBeInstanceOf(NotFoundError)
      expect(isNotFoundError(deserialized)).toBe(true)
    })

    it('should preserve ValidationError type through serialization', () => {
      const original = ValidationError.forField('email', 'must be valid', 'bad-email')
      const serialized = serializeError(original)
      const deserialized = deserializeError(serialized)

      expect(deserialized).toBeInstanceOf(ValidationError)
      expect(isValidationError(deserialized)).toBe(true)
    })
  })

  describe('Custom error subclass deserialization (known limitations)', () => {
    /**
     * KNOWN LIMITATION: Custom error subclasses that extend RPCError but are not
     * in the ERROR_REGISTRY will be deserialized as plain RPCError, losing their
     * specific class type. However, all error properties are preserved in `details`.
     *
     * This is by design - the registry is static and cannot know about user-defined
     * error types. Custom errors should use the built-in error types and store
     * domain-specific information in the `details` field.
     */
    it('should fallback to RPCError for custom subclasses but preserve all data', () => {
      // Define a custom error type (as a user would)
      class CustomBusinessError extends RPCError {
        constructor(
          message: string,
          public readonly businessCode: string,
          details?: Record<string, unknown>
        ) {
          super(RPCErrorCode.INTERNAL_ERROR, message, { ...details, businessCode })
          this.name = 'CustomBusinessError'
        }
      }

      const original = new CustomBusinessError('Business rule violated', 'BIZ_001', {
        context: 'order processing',
      })

      const serialized = serializeError(original)
      const deserialized = deserializeError(serialized)

      // Custom class type is NOT preserved (falls back to RPCError)
      expect(deserialized).not.toBeInstanceOf(CustomBusinessError)
      expect(deserialized).toBeInstanceOf(RPCError)

      // BUT all data IS preserved in details - use built-in error types with rich details
      expect(deserialized.message).toBe('Business rule violated')
      expect((deserialized as RPCError).code).toBe(RPCErrorCode.INTERNAL_ERROR)
      expect((deserialized as RPCError).details?.businessCode).toBe('BIZ_001')
      expect((deserialized as RPCError).details?.context).toBe('order processing')
    })

    it('should preserve custom error data via details field', () => {
      class OrderError extends RPCError {
        constructor(
          message: string,
          public readonly orderId: string,
          public readonly reason: 'out_of_stock' | 'payment_failed' | 'cancelled'
        ) {
          super(RPCErrorCode.CONFLICT, message, { orderId, reason })
          this.name = 'OrderError'
        }
      }

      const original = new OrderError('Order failed', 'ord-123', 'out_of_stock')
      const serialized = serializeError(original)
      const deserialized = deserializeError(serialized)

      // Recommendation: Use ConflictError (built-in) with details instead of custom class
      // This ensures type preservation AND data preservation
      expect(deserialized).toBeInstanceOf(RPCError)
      expect((deserialized as RPCError).details?.orderId).toBe('ord-123')
      expect((deserialized as RPCError).details?.reason).toBe('out_of_stock')
    })
  })

  describe('Error type preservation across RPC boundary', () => {
    let mockFetch: ReturnType<typeof vi.fn>
    const originalFetch = global.fetch

    beforeEach(() => {
      mockFetch = vi.fn()
      global.fetch = mockFetch as unknown as typeof fetch
    })

    afterEach(() => {
      global.fetch = originalFetch
    })

    it('should deserialize NotFoundError from RPC response', async () => {
      // Server serializes NotFoundError
      const serverError = NotFoundError.forResource('Customer', 'cust-456')
      const serializedError = serializeError(serverError, { includeStack: false })

      // Mock the RPC response with serialized error
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers({ 'X-Correlation-ID': 'test-correlation' }),
        json: () => Promise.resolve(serializedError),
      })

      interface TestAPI {
        getCustomer(id: string): Promise<{ id: string; name: string }>
      }

      const client = createClient<TestAPI>({ url: 'http://localhost:8787' })

      try {
        await client.getCustomer('cust-456')
        expect.fail('Should have thrown')
      } catch (error) {
        // BUG: The error should be a NotFoundError with proper type
        expect(error).toBeInstanceOf(NotFoundError)
        expect(isNotFoundError(error)).toBe(true)

        if (error instanceof NotFoundError) {
          expect(error.code).toBe(RPCErrorCode.NOT_FOUND)
          expect(error.message).toBe('Customer with id cust-456 not found')
          expect(error.details?.resourceType).toBe('Customer')
          expect(error.details?.resourceId).toBe('cust-456')
        }
      }
    })

    it('should deserialize ValidationError with field errors from RPC response', async () => {
      const serverError = ValidationError.withErrors([
        { field: 'email', message: 'must be a valid email' },
        { field: 'age', message: 'must be positive' },
      ])
      const serializedError = serializeError(serverError, { includeStack: false })

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        headers: new Headers({ 'X-Correlation-ID': 'test-correlation' }),
        json: () => Promise.resolve(serializedError),
      })

      interface TestAPI {
        createUser(data: { email: string; age: number }): Promise<{ id: string }>
      }

      const client = createClient<TestAPI>({ url: 'http://localhost:8787' })

      try {
        await client.createUser({ email: 'invalid', age: -5 })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError)
        expect(isValidationError(error)).toBe(true)

        if (error instanceof ValidationError) {
          expect(error.details?.errors).toHaveLength(2)
        }
      }
    })

    it('should deserialize AuthenticationError from RPC response', async () => {
      const serverError = AuthenticationError.tokenExpired()
      const serializedError = serializeError(serverError, { includeStack: false })

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        headers: new Headers({ 'X-Correlation-ID': 'test-correlation' }),
        json: () => Promise.resolve(serializedError),
      })

      interface TestAPI {
        getProfile(): Promise<{ name: string }>
      }

      const client = createClient<TestAPI>({ url: 'http://localhost:8787' })

      try {
        await client.getProfile()
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(AuthenticationError)
        expect(isAuthenticationError(error)).toBe(true)

        if (error instanceof AuthenticationError) {
          expect(error.details?.reason).toBe('token_expired')
        }
      }
    })
  })

  describe('Transport-based client error deserialization', () => {
    it('should preserve error type when using transport client', async () => {
      const serverError = new AuthorizationError('Insufficient permissions', {
        action: 'delete',
        resource: 'Document',
      })
      const serializedError = serializeError(serverError, { includeStack: false })

      // Create a mock transport that returns the serialized error
      const mockTransport: Transport = {
        async send<R>(_message: RPCMessage): Promise<RPCResponse<R>> {
          return {
            error: serializedError,
            correlationId: 'transport-test',
          }
        },
      }

      interface TestAPI {
        deleteDocument(id: string): Promise<void>
      }

      const client = createClientWithTransport<TestAPI>({ transport: mockTransport })

      try {
        await client.deleteDocument('doc-123')
        expect.fail('Should have thrown')
      } catch (error) {
        // Verify the error is properly typed
        expect(isRPCError(error)).toBe(true)
        expect(error).toBeInstanceOf(AuthorizationError)
        expect((error as AuthorizationError).code).toBe(RPCErrorCode.AUTHORIZATION_ERROR)
        expect((error as AuthorizationError).details?.action).toBe('delete')
      }
    })
  })

  describe('Error chain preservation (known limitations)', () => {
    /**
     * KNOWN LIMITATION: The `cause` property of errors is not serialized.
     * This is intentional because:
     * 1. The cause may contain non-serializable objects (circular refs, functions)
     * 2. The cause may contain sensitive internal error details
     * 3. Stack traces are preserved separately for debugging
     *
     * Best practice: Include relevant cause information in the error message or details.
     */
    it('should NOT preserve error cause (by design) but preserve all other data', () => {
      const rootCause = new Error('Database connection failed')
      const error = new NotFoundError('User not found', { userId: '123' }, { cause: rootCause })

      const serialized = serializeError(error)
      const deserialized = deserializeError(serialized)

      // Cause is NOT preserved (by design - may contain non-serializable data)
      expect(deserialized.cause).toBeUndefined()

      // All other data IS preserved
      expect(deserialized.message).toBe('User not found')
      expect((deserialized as NotFoundError).details?.userId).toBe('123')
    })

    it('should recommend including cause info in details for cross-boundary errors', () => {
      // Best practice: Include cause information explicitly in details
      const error = new NotFoundError('User not found', {
        userId: '123',
        causedBy: 'Database connection failed', // Include cause info explicitly
        causeType: 'DatabaseError',
      })

      const serialized = serializeError(error)
      const deserialized = deserializeError(serialized)

      expect(deserialized).toBeInstanceOf(NotFoundError)
      expect((deserialized as NotFoundError).details?.causedBy).toBe('Database connection failed')
      expect((deserialized as NotFoundError).details?.causeType).toBe('DatabaseError')
    })
  })

  describe('Unknown error type fallback', () => {
    it('should fallback to RPCError for unknown error types', () => {
      // Simulate receiving an error from a newer server version with unknown type
      const serialized = {
        type: 'FutureErrorType',
        code: 'FUTURE_ERROR' as RPCErrorCode,
        message: 'This is a future error type',
        details: { version: '2.0' },
        httpStatus: 500,
      }

      const deserialized = deserializeError(serialized)

      // Should fallback to RPCError, not throw
      expect(deserialized).toBeInstanceOf(RPCError)
      expect(isRPCError(deserialized)).toBe(true)
      expect(deserialized.message).toBe('This is a future error type')
      expect((deserialized as RPCError).code).toBe('FUTURE_ERROR')
    })

    it('should handle malformed error responses gracefully', () => {
      // Minimal error structure
      const serialized = {
        type: 'Error',
        message: 'Something went wrong',
      }

      const deserialized = deserializeError(serialized as Parameters<typeof deserializeError>[0])

      // Should create a basic Error, not crash
      expect(deserialized).toBeInstanceOf(Error)
      expect(deserialized.message).toBe('Something went wrong')
    })
  })

  describe('JSON round-trip through actual wire format', () => {
    it('should preserve error type through JSON stringify/parse', () => {
      const original = NotFoundError.forResource('Order', 'ord-789')
      const serialized = serializeError(original)

      // Simulate actual wire format (JSON string)
      const wireFormat = JSON.stringify(serialized)
      const parsed = JSON.parse(wireFormat)
      const deserialized = deserializeError(parsed)

      expect(deserialized).toBeInstanceOf(NotFoundError)
      expect(deserialized.message).toBe('Order with id ord-789 not found')
      expect((deserialized as NotFoundError).details?.resourceType).toBe('Order')
    })

    it('should preserve ValidationError with nested details through JSON', () => {
      const original = new ValidationError('Nested validation failed', {
        errors: [
          { field: 'address.street', message: 'required' },
          { field: 'address.city', message: 'required' },
        ],
        nested: {
          deeply: {
            value: 123,
          },
        },
      })

      const wireFormat = JSON.stringify(serializeError(original))
      const deserialized = deserializeError(JSON.parse(wireFormat))

      expect(deserialized).toBeInstanceOf(ValidationError)
      expect((deserialized as ValidationError).details?.nested?.deeply?.value).toBe(123)
    })
  })
})
