/**
 * DOError Store Integration Tests (RED Phase)
 *
 * These tests verify that stores throw appropriate DOError subclasses
 * instead of generic Error instances. Tests are designed to FAIL initially
 * because stores currently throw generic Error - implementing DOError
 * throwing will make these tests pass (GREEN phase).
 *
 * Stores tested:
 * - SQLiteGraphStore - Thing and Relationship operations
 * - DocumentGraphStore - Document-style operations with query operators
 * - AccountThingStore - OAuth account management
 *
 * Error mapping:
 * - Duplicate IDs -> ValidationError with DUPLICATE_THING code
 * - Missing entities -> NotFoundError with appropriate codes
 * - Invalid input -> ValidationError with INVALID_* codes
 * - Foreign key violations -> ValidationError with INVALID_TYPE_ID code
 *
 * Run with: npx vitest run lib/errors/tests/store-integration.test.ts --project=lib
 *
 * @module lib/errors/tests/store-integration.test
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  DOError,
  ValidationError,
  NotFoundError,
  TimeoutError,
  AuthorizationError,
} from '../index'
import { SQLiteGraphStore } from '../../../db/graph/stores/sqlite'
import { DocumentGraphStore } from '../../../db/graph/stores/document'
import {
  GraphError,
  ThingNotFoundError,
  RelationshipNotFoundError,
  DuplicateThingError,
  DuplicateRelationshipError,
  ValidationError as GraphValidationError,
} from '../../../db/graph/errors'

// ============================================================================
// TEST SETUP
// ============================================================================

/**
 * Helper to check if error is a DOError subclass with expected code.
 * Used for RED phase tests - stores currently throw generic Error.
 */
function isDOErrorWithCode(error: unknown, expectedCode: string): boolean {
  if (error instanceof DOError) {
    return error.code === expectedCode
  }
  // Also accept GraphError (graph-specific errors)
  if (error instanceof GraphError) {
    return error.code === expectedCode
  }
  return false
}

// ============================================================================
// SQLiteGraphStore DOError Integration Tests
// ============================================================================

describe('SQLiteGraphStore DOError Integration', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
  })

  describe('createThing - ValidationError scenarios', () => {
    /**
     * RED TEST: Duplicate Thing ID should throw GraphError with DUPLICATE_THING code
     *
     * Current behavior: Throws generic Error "Thing with ID 'x' already exists"
     * Expected: DuplicateThingError (extends GraphError) with code 'DUPLICATE_THING'
     */
    it('throws DuplicateThingError for duplicate Thing ID', async () => {
      // First create succeeds
      await store.createThing({
        id: 'thing-1',
        typeId: 1,
        typeName: 'Customer',
        data: { name: 'Alice' },
      })

      // Second create with same ID should throw DuplicateThingError
      await expect(
        store.createThing({
          id: 'thing-1',
          typeId: 1,
          typeName: 'Customer',
          data: { name: 'Bob' },
        })
      ).rejects.toThrow(DuplicateThingError)
    })

    /**
     * RED TEST: Verify error has correct code for duplicate ID
     */
    it('DuplicateThingError has code DUPLICATE_THING', async () => {
      await store.createThing({
        id: 'duplicate-test',
        typeId: 1,
        typeName: 'Test',
        data: {},
      })

      try {
        await store.createThing({
          id: 'duplicate-test',
          typeId: 1,
          typeName: 'Test',
          data: {},
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(DuplicateThingError)
        if (error instanceof DuplicateThingError) {
          expect(error.code).toBe('DUPLICATE_THING')
          expect(error.thingId).toBe('duplicate-test')
        }
      }
    })

    /**
     * RED TEST: Invalid typeId (foreign key violation) should throw ValidationError
     *
     * Current behavior: Throws generic Error "FOREIGN KEY constraint failed: typeId X..."
     * Expected: GraphValidationError with code 'INVALID_TYPE_ID'
     */
    it('throws ValidationError for invalid typeId', async () => {
      // Type ID 999 doesn't exist in nouns table
      await expect(
        store.createThing({
          id: 'invalid-type-thing',
          typeId: 999,
          typeName: 'NonExistent',
          data: {},
        })
      ).rejects.toThrow(GraphValidationError)
    })

    /**
     * RED TEST: ValidationError has INVALID_TYPE_ID code for FK violation
     */
    it('ValidationError has code INVALID_TYPE_ID for FK violation', async () => {
      try {
        await store.createThing({
          id: 'fk-test',
          typeId: 999,
          typeName: 'NonExistent',
          data: {},
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(GraphValidationError)
        if (error instanceof GraphValidationError) {
          expect(error.code).toBe('INVALID_TYPE_ID')
        }
      }
    })
  })

  describe('updateThing - NotFoundError scenarios', () => {
    /**
     * RED TEST: Update non-existent Thing should throw ThingNotFoundError
     *
     * Current behavior: Returns null silently
     * Expected: ThingNotFoundError with code 'THING_NOT_FOUND' (in strict mode)
     *
     * Note: Current implementation returns null which is valid behavior.
     * This test documents what a "strict mode" would look like.
     */
    it('returns null for update of non-existent thing (current behavior)', async () => {
      const result = await store.updateThing('non-existent-id', { data: { updated: true } })
      expect(result).toBeNull()
    })

    /**
     * RED TEST: Document expected strict mode behavior for update
     */
    it('should throw ThingNotFoundError in strict mode (future behavior)', async () => {
      // This documents what strict mode would look like
      // Currently returns null, but could throw in strict mode
      const error = new ThingNotFoundError('non-existent-id')
      expect(error.code).toBe('THING_NOT_FOUND')
      expect(error.thingId).toBe('non-existent-id')
      expect(error).toBeInstanceOf(GraphError)
    })
  })

  describe('deleteThing - NotFoundError scenarios', () => {
    /**
     * RED TEST: Delete non-existent Thing should return null (current behavior)
     */
    it('returns null for delete of non-existent thing (current behavior)', async () => {
      const result = await store.deleteThing('non-existent-id')
      expect(result).toBeNull()
    })

    /**
     * RED TEST: Document expected strict mode behavior for delete
     */
    it('should throw ThingNotFoundError in strict mode (future behavior)', async () => {
      const error = new ThingNotFoundError('non-existent-for-delete')
      expect(error.code).toBe('THING_NOT_FOUND')
      expect(error).toBeInstanceOf(GraphError)
    })
  })

  describe('createRelationship - ValidationError scenarios', () => {
    /**
     * RED TEST: Duplicate relationship should throw DuplicateRelationshipError
     *
     * Current behavior: Throws generic Error "Relationship with (verb=...) already exists"
     * Expected: DuplicateRelationshipError with code 'DUPLICATE_RELATIONSHIP'
     */
    it('throws DuplicateRelationshipError for duplicate relationship', async () => {
      // First create succeeds
      await store.createRelationship({
        id: 'rel-1',
        verb: 'owns',
        from: 'do://tenant/customers/alice',
        to: 'do://tenant/products/widget',
      })

      // Second create with same verb/from/to should throw
      await expect(
        store.createRelationship({
          id: 'rel-2',
          verb: 'owns',
          from: 'do://tenant/customers/alice',
          to: 'do://tenant/products/widget',
        })
      ).rejects.toThrow(DuplicateRelationshipError)
    })

    /**
     * RED TEST: Verify error has correct code and properties
     */
    it('DuplicateRelationshipError has code DUPLICATE_EDGE', async () => {
      await store.createRelationship({
        id: 'dup-rel-test',
        verb: 'follows',
        from: 'user-1',
        to: 'user-2',
      })

      try {
        await store.createRelationship({
          id: 'dup-rel-test-2',
          verb: 'follows',
          from: 'user-1',
          to: 'user-2',
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(DuplicateRelationshipError)
        if (error instanceof DuplicateRelationshipError) {
          expect(error.code).toBe('DUPLICATE_EDGE')
          expect(error.verb).toBe('follows')
          expect(error.from).toBe('user-1')
          expect(error.to).toBe('user-2')
        }
      }
    })
  })

  describe('deleteRelationship - NotFoundError scenarios', () => {
    /**
     * RED TEST: Delete non-existent relationship returns false (current behavior)
     */
    it('returns false for delete of non-existent relationship', async () => {
      const result = await store.deleteRelationship('non-existent-rel')
      expect(result).toBe(false)
    })

    /**
     * RED TEST: Document expected strict mode behavior
     */
    it('should throw RelationshipNotFoundError in strict mode (future behavior)', async () => {
      const error = new RelationshipNotFoundError('non-existent-rel')
      expect(error.code).toBe('RELATIONSHIP_NOT_FOUND')
      expect(error.relationshipId).toBe('non-existent-rel')
      expect(error).toBeInstanceOf(GraphError)
    })
  })
})

// ============================================================================
// DocumentGraphStore DOError Integration Tests
// ============================================================================

describe('DocumentGraphStore DOError Integration', () => {
  let store: DocumentGraphStore

  beforeEach(async () => {
    store = new DocumentGraphStore(':memory:')
    await store.initialize()
  })

  afterEach(async () => {
    await store.close()
  })

  describe('createThing - ValidationError scenarios', () => {
    /**
     * RED TEST: Duplicate ID in document store
     */
    it('throws DuplicateThingError for duplicate Thing ID', async () => {
      await store.createThing({
        id: 'doc-1',
        typeId: 1,
        typeName: 'Document',
        data: { content: 'First' },
      })

      await expect(
        store.createThing({
          id: 'doc-1',
          typeId: 1,
          typeName: 'Document',
          data: { content: 'Second' },
        })
      ).rejects.toThrow(DuplicateThingError)
    })

    /**
     * RED TEST: Error has correct code
     */
    it('DuplicateThingError has code DUPLICATE_THING', async () => {
      await store.createThing({
        id: 'doc-dup-test',
        typeId: 1,
        typeName: 'Test',
        data: {},
      })

      try {
        await store.createThing({
          id: 'doc-dup-test',
          typeId: 1,
          typeName: 'Test',
          data: {},
        })
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(DuplicateThingError)
        if (error instanceof DuplicateThingError) {
          expect(error.code).toBe('DUPLICATE_THING')
        }
      }
    })
  })

  describe('createRelationship - ValidationError scenarios', () => {
    /**
     * RED TEST: Duplicate relationship in document store
     */
    it('throws DuplicateRelationshipError for duplicate relationship', async () => {
      await store.createRelationship({
        id: 'doc-rel-1',
        verb: 'contains',
        from: 'folder-1',
        to: 'doc-1',
      })

      await expect(
        store.createRelationship({
          id: 'doc-rel-2',
          verb: 'contains',
          from: 'folder-1',
          to: 'doc-1',
        })
      ).rejects.toThrow(DuplicateRelationshipError)
    })
  })
})

// ============================================================================
// DOError Hierarchy Tests
// ============================================================================

describe('DOError hierarchy verification', () => {
  describe('ValidationError', () => {
    it('has httpStatus 400', () => {
      const error = new ValidationError('TEST', 'Test validation error')
      expect(error.httpStatus).toBe(400)
    })

    it('extends DOError', () => {
      const error = new ValidationError('TEST', 'Test')
      expect(error).toBeInstanceOf(DOError)
    })

    it('serializes to JSON correctly', () => {
      const error = new ValidationError('INVALID_INPUT', 'Input is invalid')
      const json = error.toJSON()
      expect(json.name).toBe('ValidationError')
      expect(json.code).toBe('INVALID_INPUT')
      expect(json.message).toBe('Input is invalid')
    })
  })

  describe('NotFoundError', () => {
    it('has httpStatus 404', () => {
      const error = new NotFoundError('TEST', 'Test not found')
      expect(error.httpStatus).toBe(404)
    })

    it('extends DOError', () => {
      const error = new NotFoundError('TEST', 'Test')
      expect(error).toBeInstanceOf(DOError)
    })
  })

  describe('TimeoutError', () => {
    it('has httpStatus 408', () => {
      const error = new TimeoutError('TEST', 'Test timeout')
      expect(error.httpStatus).toBe(408)
    })

    it('extends DOError', () => {
      const error = new TimeoutError('TEST', 'Test')
      expect(error).toBeInstanceOf(DOError)
    })
  })

  describe('AuthorizationError', () => {
    it('has httpStatus 403', () => {
      const error = new AuthorizationError('TEST', 'Test unauthorized')
      expect(error.httpStatus).toBe(403)
    })

    it('extends DOError', () => {
      const error = new AuthorizationError('TEST', 'Test')
      expect(error).toBeInstanceOf(DOError)
    })
  })
})

// ============================================================================
// GraphError Hierarchy Tests
// ============================================================================

describe('GraphError hierarchy verification', () => {
  describe('ThingNotFoundError', () => {
    it('has code THING_NOT_FOUND', () => {
      const error = new ThingNotFoundError('thing-123')
      expect(error.code).toBe('THING_NOT_FOUND')
    })

    it('extends GraphError', () => {
      const error = new ThingNotFoundError('thing-123')
      expect(error).toBeInstanceOf(GraphError)
    })

    it('includes thingId property', () => {
      const error = new ThingNotFoundError('specific-id')
      expect(error.thingId).toBe('specific-id')
    })

    it('includes thing ID in message', () => {
      const error = new ThingNotFoundError('my-thing-id')
      expect(error.message).toContain('my-thing-id')
    })
  })

  describe('RelationshipNotFoundError', () => {
    it('has code RELATIONSHIP_NOT_FOUND', () => {
      const error = new RelationshipNotFoundError('rel-123')
      expect(error.code).toBe('RELATIONSHIP_NOT_FOUND')
    })

    it('extends GraphError', () => {
      const error = new RelationshipNotFoundError('rel-123')
      expect(error).toBeInstanceOf(GraphError)
    })

    it('includes relationshipId property', () => {
      const error = new RelationshipNotFoundError('specific-rel')
      expect(error.relationshipId).toBe('specific-rel')
    })
  })

  describe('DuplicateThingError', () => {
    it('has code DUPLICATE_THING', () => {
      const error = new DuplicateThingError('thing-123')
      expect(error.code).toBe('DUPLICATE_THING')
    })

    it('extends GraphError', () => {
      const error = new DuplicateThingError('thing-123')
      expect(error).toBeInstanceOf(GraphError)
    })

    it('includes thingId property', () => {
      const error = new DuplicateThingError('dup-thing')
      expect(error.thingId).toBe('dup-thing')
    })
  })

  describe('DuplicateRelationshipError', () => {
    it('has code DUPLICATE_EDGE', () => {
      const error = new DuplicateRelationshipError('verb', 'from', 'to')
      expect(error.code).toBe('DUPLICATE_EDGE')
    })

    it('extends DuplicateEdgeError which extends GraphError', () => {
      const error = new DuplicateRelationshipError('verb', 'from', 'to')
      expect(error).toBeInstanceOf(GraphError)
    })

    it('includes verb, from, to properties', () => {
      const error = new DuplicateRelationshipError('owns', 'user-1', 'item-1')
      expect(error.verb).toBe('owns')
      expect(error.from).toBe('user-1')
      expect(error.to).toBe('item-1')
    })
  })

  describe('GraphValidationError', () => {
    it('has code VALIDATION_ERROR', () => {
      const error = new GraphValidationError('Invalid input')
      expect(error.code).toBe('VALIDATION_ERROR')
    })

    it('extends GraphError', () => {
      const error = new GraphValidationError('Invalid')
      expect(error).toBeInstanceOf(GraphError)
    })

    it('can include field and value', () => {
      const error = new GraphValidationError('Email is invalid', 'email', 'not-an-email')
      expect(error.field).toBe('email')
      expect(error.value).toBe('not-an-email')
    })
  })
})

// ============================================================================
// Error Cause Chaining Tests
// ============================================================================

describe('DOError cause chaining', () => {
  it('preserves original cause when wrapping', () => {
    const originalError = new Error('Database constraint violation')
    const wrappedError = new ValidationError(
      'DUPLICATE_THING',
      "Thing 'test' already exists",
      originalError
    )

    expect(wrappedError.cause).toBe(originalError)
    expect(wrappedError.cause?.message).toBe('Database constraint violation')
  })

  it('nested DOError causes serialize to JSON', () => {
    const innerError = new NotFoundError('THING_NOT_FOUND', 'Thing not found')
    const outerError = new ValidationError(
      'UPDATE_FAILED',
      'Cannot update non-existent thing',
      innerError
    )

    const json = outerError.toJSON()
    expect(json.cause).toBeDefined()
    expect((json.cause as any).code).toBe('THING_NOT_FOUND')
  })

  it('regular Error causes serialize as basic objects', () => {
    const regularError = new Error('SQL error')
    const wrappedError = new ValidationError('DB_ERROR', 'Database error', regularError)

    const json = wrappedError.toJSON()
    expect(json.cause).toEqual({
      name: 'Error',
      message: 'SQL error',
    })
  })
})

// ============================================================================
// Error Type Discrimination Tests
// ============================================================================

describe('Error type discrimination', () => {
  it('DOErrors can be discriminated by instanceof', () => {
    const errors: DOError[] = [
      new ValidationError('V', 'Validation'),
      new NotFoundError('N', 'Not found'),
      new TimeoutError('T', 'Timeout'),
      new AuthorizationError('A', 'Unauthorized'),
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

  it('GraphErrors can be discriminated by instanceof', () => {
    const errors: GraphError[] = [
      new ThingNotFoundError('t1'),
      new RelationshipNotFoundError('r1'),
      new DuplicateThingError('t2'),
      new DuplicateRelationshipError('v', 'f', 't'),
      new GraphValidationError('Invalid'),
    ]

    for (const error of errors) {
      expect(error).toBeInstanceOf(GraphError)
    }
  })

  it('catch block can handle errors appropriately', () => {
    function handleStoreError(error: unknown): number {
      // DOError hierarchy
      if (error instanceof ValidationError) return 400
      if (error instanceof NotFoundError) return 404
      if (error instanceof TimeoutError) return 408
      if (error instanceof AuthorizationError) return 403
      if (error instanceof DOError) return error.httpStatus

      // GraphError hierarchy (doesn't have httpStatus, map manually)
      if (error instanceof ThingNotFoundError) return 404
      if (error instanceof RelationshipNotFoundError) return 404
      if (error instanceof DuplicateThingError) return 409
      if (error instanceof DuplicateRelationshipError) return 409
      if (error instanceof GraphValidationError) return 400
      if (error instanceof GraphError) return 500

      return 500
    }

    expect(handleStoreError(new ValidationError('V', 'v'))).toBe(400)
    expect(handleStoreError(new NotFoundError('N', 'n'))).toBe(404)
    expect(handleStoreError(new ThingNotFoundError('t'))).toBe(404)
    expect(handleStoreError(new DuplicateThingError('t'))).toBe(409)
    expect(handleStoreError(new Error('generic'))).toBe(500)
  })
})

// ============================================================================
// Retryable Error Classification Tests
// ============================================================================

describe('Retryable error classification', () => {
  function isRetryable(error: unknown): boolean {
    // DOError hierarchy - 4xx are not retryable
    if (error instanceof ValidationError) return false
    if (error instanceof NotFoundError) return false
    if (error instanceof AuthorizationError) return false
    if (error instanceof TimeoutError) return true // May retry with backoff

    // GraphError hierarchy
    if (error instanceof ThingNotFoundError) return false
    if (error instanceof RelationshipNotFoundError) return false
    if (error instanceof DuplicateThingError) return false
    if (error instanceof DuplicateRelationshipError) return false
    if (error instanceof GraphValidationError) return false

    // 5xx errors are generally retryable
    if (error instanceof DOError) {
      return error.httpStatus >= 500
    }

    // Unknown errors - retry with caution
    return true
  }

  it('ValidationErrors are NOT retryable', () => {
    expect(isRetryable(new ValidationError('V', 'v'))).toBe(false)
  })

  it('NotFoundErrors are NOT retryable', () => {
    expect(isRetryable(new NotFoundError('N', 'n'))).toBe(false)
  })

  it('AuthorizationErrors are NOT retryable', () => {
    expect(isRetryable(new AuthorizationError('A', 'a'))).toBe(false)
  })

  it('TimeoutErrors MAY be retryable', () => {
    expect(isRetryable(new TimeoutError('T', 't'))).toBe(true)
  })

  it('DuplicateThingErrors are NOT retryable', () => {
    expect(isRetryable(new DuplicateThingError('t'))).toBe(false)
  })

  it('DuplicateRelationshipErrors are NOT retryable', () => {
    expect(isRetryable(new DuplicateRelationshipError('v', 'f', 't'))).toBe(false)
  })

  it('Generic DOError with 5xx status is retryable', () => {
    expect(isRetryable(new DOError('INTERNAL', 'Internal error'))).toBe(true)
  })

  it('Unknown errors default to retryable', () => {
    expect(isRetryable(new Error('unknown'))).toBe(true)
  })
})
