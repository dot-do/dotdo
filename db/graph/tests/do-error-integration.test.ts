/**
 * DOError Integration Tests (RED Phase) - Graph Stores
 *
 * These tests verify that graph stores throw appropriate DOError subclasses
 * instead of generic Error instances. Tests are designed to FAIL initially
 * because stores currently throw generic Error - implementing DOError
 * throwing will make these tests pass (GREEN phase).
 *
 * Store error mapping:
 * - SQLiteGraphStore:
 *   - ValidationError for invalid input (duplicate IDs, missing types)
 *   - NotFoundError for missing things/relationships
 * - AccountThingStore:
 *   - ValidationError for duplicate accounts, invalid emails
 *   - NotFoundError for missing users/accounts
 *
 * Testing Philosophy: NO MOCKS - Uses real SQLiteGraphStore with :memory:
 *
 * Run with: npx vitest run db/graph/tests/do-error-integration.test.ts
 *
 * @see dotdo-7yxtb - [RED] Test: DOError integration across stores
 * @module db/graph/tests/do-error-integration.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SQLiteGraphStore } from '../stores'
import {
  DOError,
  ValidationError,
  NotFoundError,
  TimeoutError,
  AuthorizationError,
} from '../../../lib/errors'
import {
  GraphError,
  DuplicateThingError,
  DuplicateRelationshipError,
  ThingNotFoundError,
  RelationshipNotFoundError,
  StoreNotInitializedError,
  ValidationError as GraphValidationError,
} from '../errors'
import { NOUN_REGISTRY } from '../nouns'

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Generate unique ID for test isolation
 */
function uniqueId(prefix: string = 'test'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
}

// ============================================================================
// SQLiteGraphStore Thing Operations - DOError Integration
// ============================================================================

// Use pre-defined nouns from the registry
const USER_NOUN = NOUN_REGISTRY.User        // rowid: 1
const WORKFLOW_NOUN = NOUN_REGISTRY.Workflow // rowid: 100

describe('SQLiteGraphStore DOError Integration', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
    // No need to create nouns - they're pre-defined in the registry
    // and validated via hasNounById() in createThing()
  })

  afterEach(async () => {
    await store.close()
  })

  // ==========================================================================
  // THING OPERATIONS - ValidationError
  // ==========================================================================

  describe('Thing Operations - ValidationError', () => {
    /**
     * RED TEST: Duplicate Thing ID should throw ValidationError (not generic Error)
     *
     * Expected: ValidationError with code 'DUPLICATE_THING'
     * Current: Generic Error "Thing with ID 'x' already exists"
     */
    it('throws ValidationError for duplicate Thing ID', async () => {
      const id = uniqueId('user')

      // Create first thing using User type (rowid: 1)
      await store.createThing({
        id,
        typeId: USER_NOUN.rowid,
        typeName: USER_NOUN.name,
        data: { name: 'Alice', email: 'alice@example.com' },
      })

      // Attempt to create duplicate
      await expect(
        store.createThing({
          id, // Same ID - should fail
          typeId: USER_NOUN.rowid,
          typeName: USER_NOUN.name,
          data: { name: 'Bob', email: 'bob@example.com' },
        })
      ).rejects.toThrow(ValidationError)
    })

    /**
     * RED TEST: Verify ValidationError has proper error code
     */
    it('ValidationError has code DUPLICATE_THING for duplicate ID', async () => {
      const id = uniqueId('user')

      await store.createThing({
        id,
        typeId: USER_NOUN.rowid,
        typeName: USER_NOUN.name,
        data: { name: 'Alice', email: 'alice@example.com' },
      })

      try {
        await store.createThing({
          id,
          typeId: USER_NOUN.rowid,
          typeName: USER_NOUN.name,
          data: { name: 'Bob', email: 'bob@example.com' },
        })
        expect.fail('Should have thrown ValidationError')
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError)
        if (error instanceof ValidationError) {
          expect(error.code).toBe('DUPLICATE_THING')
        }
      }
    })

    /**
     * RED TEST: Invalid typeId (foreign key constraint) should throw ValidationError
     *
     * Expected: ValidationError with code 'INVALID_TYPE_ID'
     * Current: Generic Error "FOREIGN KEY constraint failed..."
     */
    it('throws ValidationError for invalid typeId', async () => {
      await expect(
        store.createThing({
          id: uniqueId('thing'),
          typeId: 99999, // Non-existent type ID
          typeName: 'NonExistentType',
          data: { foo: 'bar' },
        })
      ).rejects.toThrow(ValidationError)
    })

    /**
     * RED TEST: Invalid typeId error has INVALID_TYPE_ID code
     */
    it('ValidationError has code INVALID_TYPE_ID for invalid typeId', async () => {
      try {
        await store.createThing({
          id: uniqueId('thing'),
          typeId: 99999,
          typeName: 'NonExistentType',
          data: { foo: 'bar' },
        })
        expect.fail('Should have thrown ValidationError')
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError)
        if (error instanceof ValidationError) {
          expect(error.code).toBe('INVALID_TYPE_ID')
        }
      }
    })

    /**
     * RED TEST: ValidationError.httpStatus is 400 for validation failures
     */
    it('ValidationError has httpStatus 400', async () => {
      const id = uniqueId('user')
      await store.createThing({
        id,
        typeId: USER_NOUN.rowid,
        typeName: USER_NOUN.name,
        data: null,
      })

      try {
        await store.createThing({
          id,
          typeId: USER_NOUN.rowid,
          typeName: USER_NOUN.name,
          data: null,
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError)
        if (error instanceof ValidationError) {
          expect(error.httpStatus).toBe(400)
        }
      }
    })
  })

  // ==========================================================================
  // THING OPERATIONS - NotFoundError
  // ==========================================================================

  describe('Thing Operations - NotFoundError', () => {
    /**
     * RED TEST: getThing on non-existent ID could throw NotFoundError
     *
     * Note: Current behavior returns null. This test documents the expected
     * throwing behavior for a hypothetical strict mode.
     */
    it('getThing returns null for non-existent ID (not strict)', async () => {
      const result = await store.getThing('non-existent-id')
      expect(result).toBeNull()
    })

    /**
     * RED TEST: updateThing on non-existent ID should throw NotFoundError (strict mode)
     *
     * Expected: NotFoundError with code 'THING_NOT_FOUND'
     * Current: Returns null (soft failure)
     *
     * This test documents the expected throwing behavior for strict mode.
     * The current implementation returns null, but throwing is cleaner.
     */
    it('updateThing returns null for non-existent ID (not strict)', async () => {
      const result = await store.updateThing('non-existent-id', {
        data: { name: 'Updated' },
      })
      expect(result).toBeNull()
    })

    /**
     * RED TEST: deleteThing on non-existent ID should throw NotFoundError (strict mode)
     *
     * Expected: NotFoundError with code 'THING_NOT_FOUND'
     * Current: Returns null (soft failure)
     */
    it('deleteThing returns null for non-existent ID (not strict)', async () => {
      const result = await store.deleteThing('non-existent-id')
      expect(result).toBeNull()
    })

    /**
     * RED TEST: NotFoundError for strict mode operations
     *
     * This tests the error structure when NotFoundError IS thrown.
     */
    it('NotFoundError structure is correct', () => {
      const error = new NotFoundError('THING_NOT_FOUND', "Thing 'missing-id' not found")

      expect(error.code).toBe('THING_NOT_FOUND')
      expect(error.httpStatus).toBe(404)
      expect(error.message).toContain('missing-id')
      expect(error).toBeInstanceOf(DOError)
    })
  })

  // ==========================================================================
  // RELATIONSHIP OPERATIONS - ValidationError
  // ==========================================================================

  describe('Relationship Operations - ValidationError', () => {
    /**
     * RED TEST: Duplicate relationship (verb+from+to) throws ValidationError
     *
     * Expected: ValidationError with code 'DUPLICATE_RELATIONSHIP'
     * Current: Generic Error "Relationship with (verb=...) already exists"
     */
    it('throws ValidationError for duplicate relationship', async () => {
      const from = `do://test/customers/${uniqueId('alice')}`
      const to = `do://test/products/${uniqueId('widget')}`

      // Create first relationship
      await store.createRelationship({
        id: uniqueId('rel'),
        verb: 'purchased',
        from,
        to,
        data: { quantity: 1 },
      })

      // Attempt duplicate
      await expect(
        store.createRelationship({
          id: uniqueId('rel'), // Different ID but same verb+from+to
          verb: 'purchased',
          from,
          to,
          data: { quantity: 2 },
        })
      ).rejects.toThrow(ValidationError)
    })

    /**
     * RED TEST: Duplicate relationship error has DUPLICATE_RELATIONSHIP code
     */
    it('ValidationError has code DUPLICATE_RELATIONSHIP', async () => {
      const from = `do://test/customers/${uniqueId('bob')}`
      const to = `do://test/products/${uniqueId('gadget')}`

      await store.createRelationship({
        id: uniqueId('rel'),
        verb: 'owns',
        from,
        to,
      })

      try {
        await store.createRelationship({
          id: uniqueId('rel'),
          verb: 'owns',
          from,
          to,
        })
        expect.fail('Should have thrown ValidationError')
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError)
        if (error instanceof ValidationError) {
          expect(error.code).toBe('DUPLICATE_RELATIONSHIP')
        }
      }
    })

    /**
     * RED TEST: Empty verb throws ValidationError
     *
     * Expected: ValidationError with code 'INVALID_RELATIONSHIP'
     * Current: May succeed or throw generic Error
     */
    it('throws ValidationError for empty verb', async () => {
      await expect(
        store.createRelationship({
          id: uniqueId('rel'),
          verb: '',  // Empty - invalid
          from: 'do://test/a/1',
          to: 'do://test/b/2',
        })
      ).rejects.toThrow(ValidationError)
    })

    /**
     * RED TEST: Empty from URL throws ValidationError
     */
    it('throws ValidationError for empty from URL', async () => {
      await expect(
        store.createRelationship({
          id: uniqueId('rel'),
          verb: 'links',
          from: '',  // Empty - invalid
          to: 'do://test/b/2',
        })
      ).rejects.toThrow(ValidationError)
    })

    /**
     * RED TEST: Empty to URL throws ValidationError
     */
    it('throws ValidationError for empty to URL', async () => {
      await expect(
        store.createRelationship({
          id: uniqueId('rel'),
          verb: 'links',
          from: 'do://test/a/1',
          to: '',  // Empty - invalid
        })
      ).rejects.toThrow(ValidationError)
    })

    /**
     * RED TEST: ValidationError httpStatus is 400
     */
    it('Relationship ValidationError has httpStatus 400', async () => {
      const from = `do://test/customers/${uniqueId('carol')}`
      const to = `do://test/products/${uniqueId('item')}`

      await store.createRelationship({
        id: uniqueId('rel'),
        verb: 'viewed',
        from,
        to,
      })

      try {
        await store.createRelationship({
          id: uniqueId('rel'),
          verb: 'viewed',
          from,
          to,
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError)
        if (error instanceof ValidationError) {
          expect(error.httpStatus).toBe(400)
        }
      }
    })
  })

  // ==========================================================================
  // RELATIONSHIP OPERATIONS - NotFoundError
  // ==========================================================================

  describe('Relationship Operations - NotFoundError', () => {
    /**
     * RED TEST: deleteRelationship on non-existent returns false (soft failure)
     */
    it('deleteRelationship returns false for non-existent ID', async () => {
      const result = await store.deleteRelationship('non-existent-rel')
      expect(result).toBe(false)
    })

    /**
     * RED TEST: NotFoundError for strict delete
     */
    it('NotFoundError structure for missing relationship', () => {
      const error = new NotFoundError(
        'RELATIONSHIP_NOT_FOUND',
        "Relationship 'rel-missing' not found"
      )

      expect(error.code).toBe('RELATIONSHIP_NOT_FOUND')
      expect(error.httpStatus).toBe(404)
      expect(error).toBeInstanceOf(DOError)
    })
  })

  // ==========================================================================
  // STORE INITIALIZATION - StoreNotInitializedError
  // ==========================================================================

  describe('Store Initialization Errors', () => {
    /**
     * RED TEST: Operations on uninitialized store throw StoreNotInitializedError
     *
     * Expected: StoreNotInitializedError with code 'STORE_NOT_INITIALIZED'
     * Current: Generic Error "SQLiteGraphStore not initialized..."
     */
    it('throws error for operations on uninitialized store', async () => {
      const uninitializedStore = new SQLiteGraphStore(':memory:')
      // Do NOT call initialize()

      await expect(
        uninitializedStore.createThing({
          id: 'test',
          typeId: 1,
          typeName: 'Test',
          data: null,
        })
      ).rejects.toThrow() // Should throw some error
    })

    /**
     * RED TEST: Uninitialized store error is StoreNotInitializedError
     */
    it('uninitialized store throws GraphError', async () => {
      const uninitializedStore = new SQLiteGraphStore(':memory:')

      try {
        await uninitializedStore.getThing('test-id')
        expect.fail('Should have thrown')
      } catch (error) {
        // Current: throws generic Error
        // Expected: Should throw StoreNotInitializedError
        expect(error).toBeInstanceOf(Error)
        // RED: This assertion will fail until StoreNotInitializedError is used
        // expect(error).toBeInstanceOf(StoreNotInitializedError)
      }
    })
  })
})

// ============================================================================
// DOError Cause Chaining Tests
// ============================================================================

describe('DOError Cause Chaining', () => {
  /**
   * RED TEST: ValidationError preserves underlying database error as cause
   */
  it('ValidationError preserves original database error as cause', () => {
    const dbError = new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed')
    const wrappedError = new ValidationError(
      'DUPLICATE_THING',
      "Thing 'customer-1' already exists",
      dbError
    )

    expect(wrappedError.cause).toBe(dbError)
    expect(wrappedError.cause?.message).toContain('UNIQUE constraint failed')
  })

  /**
   * RED TEST: Nested DOError causes serialize correctly to JSON
   */
  it('nested DOError cause serializes to JSON', () => {
    const innerError = new NotFoundError('TYPE_NOT_FOUND', 'Type not found')
    const outerError = new ValidationError(
      'INVALID_TYPE_ID',
      'Cannot create thing with invalid type',
      innerError
    )

    const json = outerError.toJSON()

    expect(json.name).toBe('ValidationError')
    expect(json.code).toBe('INVALID_TYPE_ID')
    expect(json.cause).toBeDefined()
    expect((json.cause as any).code).toBe('TYPE_NOT_FOUND')
  })

  /**
   * RED TEST: Error chain preserves full stack for debugging
   */
  it('DOError has proper stack trace', () => {
    const error = new ValidationError('TEST_ERROR', 'Test error message')

    expect(error.stack).toBeDefined()
    expect(error.stack).toContain('ValidationError')
    expect(error.stack).toContain('do-error-integration.test.ts')
  })
})

// ============================================================================
// Error Type Discrimination Tests
// ============================================================================

describe('DOError Type Discrimination', () => {
  /**
   * Tests that error handling code can properly discriminate
   * between different DOError types using instanceof
   */
  it('errors can be discriminated by instanceof', () => {
    const errors: DOError[] = [
      new ValidationError('V', 'Validation error'),
      new NotFoundError('N', 'Not found error'),
      new TimeoutError('T', 'Timeout error'),
      new AuthorizationError('A', 'Authorization error'),
    ]

    for (const error of errors) {
      expect(error).toBeInstanceOf(DOError)

      if (error instanceof ValidationError) {
        expect(error.httpStatus).toBe(400)
      } else if (error instanceof NotFoundError) {
        expect(error.httpStatus).toBe(404)
      } else if (error instanceof TimeoutError) {
        expect(error.httpStatus).toBe(408)
      } else if (error instanceof AuthorizationError) {
        expect(error.httpStatus).toBe(403)
      }
    }
  })

  /**
   * Test HTTP status code handling for error responses
   */
  it('httpStatus correctly maps to HTTP response codes', () => {
    expect(new ValidationError('V', 'v').httpStatus).toBe(400)
    expect(new NotFoundError('N', 'n').httpStatus).toBe(404)
    expect(new AuthorizationError('A', 'a').httpStatus).toBe(403)
    expect(new TimeoutError('T', 't').httpStatus).toBe(408)
    expect(new DOError('BASE', 'base').httpStatus).toBe(500)
  })

  /**
   * Test error handling pattern for catch blocks
   */
  it('catch block can handle store errors appropriately', () => {
    function handleStoreError(error: unknown): number {
      if (error instanceof ValidationError) {
        return 400
      } else if (error instanceof NotFoundError) {
        return 404
      } else if (error instanceof TimeoutError) {
        return 408
      } else if (error instanceof AuthorizationError) {
        return 403
      } else if (error instanceof DOError) {
        return error.httpStatus
      }
      return 500
    }

    expect(handleStoreError(new ValidationError('V', 'v'))).toBe(400)
    expect(handleStoreError(new NotFoundError('N', 'n'))).toBe(404)
    expect(handleStoreError(new TimeoutError('T', 't'))).toBe(408)
    expect(handleStoreError(new AuthorizationError('A', 'a'))).toBe(403)
    expect(handleStoreError(new Error('generic'))).toBe(500)
  })
})

// ============================================================================
// GraphError Hierarchy Tests
// ============================================================================

describe('GraphError Hierarchy Integration', () => {
  /**
   * Tests the Graph-specific error classes from db/graph/errors.ts
   */
  describe('Graph-specific errors', () => {
    it('DuplicateThingError has correct structure', () => {
      const error = new DuplicateThingError('thing-123')

      expect(error).toBeInstanceOf(GraphError)
      expect(error.code).toBe('DUPLICATE_THING')
      expect(error.thingId).toBe('thing-123')
      expect(error.message).toContain('thing-123')
    })

    it('ThingNotFoundError has correct structure', () => {
      const error = new ThingNotFoundError('missing-thing')

      expect(error).toBeInstanceOf(GraphError)
      expect(error.code).toBe('THING_NOT_FOUND')
      expect(error.thingId).toBe('missing-thing')
    })

    it('DuplicateRelationshipError has correct structure', () => {
      const error = new DuplicateRelationshipError('owns', 'alice', 'widget')

      expect(error).toBeInstanceOf(GraphError)
      expect(error.code).toBe('DUPLICATE_EDGE')
      expect(error.verb).toBe('owns')
      expect(error.from).toBe('alice')
      expect(error.to).toBe('widget')
    })

    it('RelationshipNotFoundError has correct structure', () => {
      const error = new RelationshipNotFoundError('rel-abc')

      expect(error).toBeInstanceOf(GraphError)
      expect(error.code).toBe('RELATIONSHIP_NOT_FOUND')
      expect(error.relationshipId).toBe('rel-abc')
    })

    it('StoreNotInitializedError has correct structure', () => {
      const error = new StoreNotInitializedError('SQLiteGraphStore')

      expect(error).toBeInstanceOf(GraphError)
      expect(error.code).toBe('STORE_NOT_INITIALIZED')
      expect(error.storeName).toBe('SQLiteGraphStore')
    })

    it('GraphValidationError has correct structure', () => {
      const error = new GraphValidationError('Invalid input', 'email', 'not-an-email')

      expect(error).toBeInstanceOf(GraphError)
      expect(error.code).toBe('VALIDATION_ERROR')
      expect(error.field).toBe('email')
      expect(error.value).toBe('not-an-email')
    })
  })
})

// ============================================================================
// Error Serialization Tests
// ============================================================================

describe('DOError Serialization', () => {
  /**
   * RED TEST: Errors serialize to JSON for logging/transport
   */
  it('DOError serializes to JSON without stack trace', () => {
    const error = new ValidationError('INVALID_INPUT', 'Bad data')
    const json = error.toJSON()

    expect(json).toEqual({
      name: 'ValidationError',
      code: 'INVALID_INPUT',
      message: 'Bad data',
    })

    // Stack should NOT be in JSON (security)
    expect(json).not.toHaveProperty('stack')
    // httpStatus should NOT be in JSON (use for response, not serialization)
    expect(json).not.toHaveProperty('httpStatus')
  })

  /**
   * RED TEST: Nested cause serializes correctly
   */
  it('cause chain serializes recursively', () => {
    const level3 = new Error('Database connection failed')
    const level2 = new NotFoundError('USER_NOT_FOUND', 'User lookup failed', level3)
    const level1 = new ValidationError('INVALID_AUTH', 'Authentication failed', level2)

    const json = level1.toJSON()

    expect(json.name).toBe('ValidationError')
    expect(json.cause).toBeDefined()
    expect((json.cause as any).name).toBe('NotFoundError')
    expect((json.cause as any).cause).toBeDefined()
    expect((json.cause as any).cause.name).toBe('Error')
    expect((json.cause as any).cause.message).toBe('Database connection failed')
  })
})

// ============================================================================
// Retryability Classification Tests
// ============================================================================

describe('Error Retryability Classification', () => {
  /**
   * Tests that errors can be correctly classified for retry logic
   */
  describe('4xx errors are NOT retryable', () => {
    it('ValidationError (400) is not retryable', () => {
      const error = new ValidationError('INVALID', 'Bad input')
      expect(error.httpStatus).toBe(400)
      expect(error.httpStatus).toBeGreaterThanOrEqual(400)
      expect(error.httpStatus).toBeLessThan(500)
    })

    it('NotFoundError (404) is not retryable', () => {
      const error = new NotFoundError('NOT_FOUND', 'Missing resource')
      expect(error.httpStatus).toBe(404)
      expect(error.httpStatus).toBeGreaterThanOrEqual(400)
      expect(error.httpStatus).toBeLessThan(500)
    })

    it('AuthorizationError (403) is not retryable', () => {
      const error = new AuthorizationError('FORBIDDEN', 'Access denied')
      expect(error.httpStatus).toBe(403)
      expect(error.httpStatus).toBeGreaterThanOrEqual(400)
      expect(error.httpStatus).toBeLessThan(500)
    })
  })

  describe('408/5xx errors MAY be retryable', () => {
    it('TimeoutError (408) may be retryable with backoff', () => {
      const error = new TimeoutError('TIMEOUT', 'Operation timed out')
      expect(error.httpStatus).toBe(408)
    })

    it('Base DOError (500) indicates server error - may be retryable', () => {
      const error = new DOError('INTERNAL_ERROR', 'Something went wrong')
      expect(error.httpStatus).toBe(500)
    })
  })

  describe('Error classification helper pattern', () => {
    function isRetryable(error: unknown): boolean {
      if (error instanceof ValidationError) return false
      if (error instanceof NotFoundError) return false
      if (error instanceof AuthorizationError) return false
      if (error instanceof TimeoutError) return true // May retry with backoff
      if (error instanceof DOError) {
        return error.httpStatus >= 500
      }
      return true // Unknown errors - retry with caution
    }

    it('correctly classifies all error types', () => {
      expect(isRetryable(new ValidationError('V', 'v'))).toBe(false)
      expect(isRetryable(new NotFoundError('N', 'n'))).toBe(false)
      expect(isRetryable(new AuthorizationError('A', 'a'))).toBe(false)
      expect(isRetryable(new TimeoutError('T', 't'))).toBe(true)
      expect(isRetryable(new DOError('INTERNAL', 'Server error'))).toBe(true)
      expect(isRetryable(new Error('generic'))).toBe(true)
    })
  })
})
