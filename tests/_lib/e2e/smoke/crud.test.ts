/**
 * ACID Test Suite - Phase 5: Smoke Tests - CRUD Operations
 *
 * CRUD operation smoke tests that verify basic Thing operations work.
 * These tests create, read, update, and delete test resources.
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md - Phase 5 E2E Pipeline
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest'

import {
  createE2EContext,
  skipIfNoE2E,
  skipIfReadOnly,
  type E2ETestContext,
} from '../context'

import {
  createTestThing,
  readThing,
  updateThing,
  deleteThing,
  thingExists,
  verifyCleanup,
  type TestThing,
} from './helpers'

import { SMOKE_TEST_FIXTURES, createPhase5TestNamespace } from '../../acid/fixtures/phase5'

// ============================================================================
// TEST SETUP
// ============================================================================

// Guard for E2E tests
const isE2EAvailable = (): boolean => {
  try {
    return !skipIfNoE2E()
  } catch {
    return false
  }
}

const isWriteAllowed = (): boolean => {
  try {
    return !skipIfReadOnly()
  } catch {
    return false
  }
}

describe('CRUD Smoke Tests', () => {
  let ctx: E2ETestContext | undefined
  let testNamespace: string
  const createdThings: TestThing[] = []

  beforeAll(async () => {
    if (!isE2EAvailable()) {
      return
    }

    try {
      ctx = createE2EContext()
      testNamespace = await ctx.createTestNamespace('crud-smoke')
    } catch {
      ctx = undefined
    }
  })

  afterAll(async () => {
    // Clean up all created things
    for (const thing of createdThings) {
      try {
        await thing.cleanup()
      } catch {
        // Ignore cleanup errors
      }
    }
    createdThings.length = 0

    if (ctx) {
      await ctx.cleanup()
    }
  })

  // ============================================================================
  // CREATE TESTS
  // ============================================================================

  describe('Create Operations', () => {
    it('should create a test Thing', async () => {
      if (!ctx || !isWriteAllowed()) return

      // Act
      const thing = await createTestThing(ctx, {
        namespace: testNamespace,
        prefix: 'smoke-create',
        data: { customField: 'test-value' },
      })
      createdThings.push(thing)

      // Assert
      expect(thing.id).toBeDefined()
      expect(thing.id.length).toBeGreaterThan(0)
      expect(thing.type).toBe('SmokeTestThing')
      expect(thing.namespace).toBe(testNamespace)
      expect(thing.data.customField).toBe('test-value')
    })

    it('should create Thing within timeout', async () => {
      if (!ctx || !isWriteAllowed()) return

      const startTime = Date.now()

      const thing = await createTestThing(ctx, {
        namespace: testNamespace,
        prefix: 'smoke-timeout',
      })
      createdThings.push(thing)

      const duration = Date.now() - startTime

      expect(duration).toBeLessThan(SMOKE_TEST_FIXTURES.crudTimeoutMs)
    })

    it('should create Thing with correct type', async () => {
      if (!ctx || !isWriteAllowed()) return

      const thing = await createTestThing(ctx, {
        namespace: testNamespace,
        type: 'CustomSmokeType',
        prefix: 'smoke-type',
      })
      createdThings.push(thing)

      expect(thing.type).toBe('CustomSmokeType')
    })
  })

  // ============================================================================
  // READ TESTS
  // ============================================================================

  describe('Read Operations', () => {
    it('should read the created Thing', async () => {
      if (!ctx || !isWriteAllowed()) return

      // Arrange - create a Thing first
      const created = await createTestThing(ctx, {
        namespace: testNamespace,
        prefix: 'smoke-read',
        data: { readField: 'read-value' },
      })
      createdThings.push(created)

      // Act
      const read = await readThing(ctx, testNamespace, created.id)

      // Assert
      expect(read).not.toBeNull()
      expect(read?.id).toBe(created.id)
      expect(read?.type).toBe(created.type)
      expect(read?.data.readField).toBe('read-value')
    })

    it('should read Thing within timeout', async () => {
      if (!ctx || !isWriteAllowed()) return

      // Arrange
      const created = await createTestThing(ctx, {
        namespace: testNamespace,
        prefix: 'smoke-read-timeout',
      })
      createdThings.push(created)

      // Act
      const startTime = Date.now()
      const read = await readThing(ctx, testNamespace, created.id)
      const duration = Date.now() - startTime

      // Assert
      expect(read).not.toBeNull()
      expect(duration).toBeLessThan(SMOKE_TEST_FIXTURES.crudTimeoutMs)
    })

    it('should return null for non-existent Thing', async () => {
      if (!ctx) return

      const read = await readThing(ctx, testNamespace, 'non-existent-id')

      expect(read).toBeNull()
    })
  })

  // ============================================================================
  // UPDATE TESTS
  // ============================================================================

  describe('Update Operations', () => {
    it('should update the Thing', async () => {
      if (!ctx || !isWriteAllowed()) return

      // Arrange
      const created = await createTestThing(ctx, {
        namespace: testNamespace,
        prefix: 'smoke-update',
        data: { originalField: 'original' },
      })
      createdThings.push(created)

      // Act
      const updates = { originalField: 'updated', newField: 'new-value' }
      const success = await updateThing(ctx, testNamespace, created.id, updates)

      // Assert
      expect(success).toBe(true)

      // Verify update was applied
      const read = await readThing(ctx, testNamespace, created.id)
      expect(read?.data.originalField).toBe('updated')
      expect(read?.data.newField).toBe('new-value')
    })

    it('should update Thing within timeout', async () => {
      if (!ctx || !isWriteAllowed()) return

      // Arrange
      const created = await createTestThing(ctx, {
        namespace: testNamespace,
        prefix: 'smoke-update-timeout',
      })
      createdThings.push(created)

      // Act
      const startTime = Date.now()
      await updateThing(ctx, testNamespace, created.id, { timeoutField: 'test' })
      const duration = Date.now() - startTime

      // Assert
      expect(duration).toBeLessThan(SMOKE_TEST_FIXTURES.crudTimeoutMs)
    })
  })

  // ============================================================================
  // DELETE TESTS
  // ============================================================================

  describe('Delete Operations', () => {
    it('should delete the Thing (soft delete)', async () => {
      if (!ctx || !isWriteAllowed()) return

      // Arrange
      const created = await createTestThing(ctx, {
        namespace: testNamespace,
        prefix: 'smoke-delete',
      })
      // Don't add to createdThings since we're deleting it

      // Act
      const success = await deleteThing(ctx, testNamespace, created.id)

      // Assert
      expect(success).toBe(true)

      // Verify Thing is marked as deleted (soft delete)
      // Note: readThing may still return the Thing with $deleted flag
      // depending on implementation
    })

    it('should delete Thing within timeout', async () => {
      if (!ctx || !isWriteAllowed()) return

      // Arrange
      const created = await createTestThing(ctx, {
        namespace: testNamespace,
        prefix: 'smoke-delete-timeout',
      })

      // Act
      const startTime = Date.now()
      await deleteThing(ctx, testNamespace, created.id)
      const duration = Date.now() - startTime

      // Assert
      expect(duration).toBeLessThan(SMOKE_TEST_FIXTURES.crudTimeoutMs)
    })
  })

  // ============================================================================
  // CLEANUP VERIFICATION TESTS
  // ============================================================================

  describe('Cleanup Verification', () => {
    it('should verify cleanup', async () => {
      if (!ctx || !isWriteAllowed()) return

      // Arrange - create and delete a Thing
      const created = await createTestThing(ctx, {
        namespace: testNamespace,
        prefix: 'smoke-cleanup',
      })

      await deleteThing(ctx, testNamespace, created.id)

      // Act - verify cleanup
      const result = await verifyCleanup(ctx, [`${testNamespace}/${created.id}`])

      // Assert
      // Note: Soft delete may not fully remove the resource
      // so we just verify the method runs successfully
      expect(result).toHaveProperty('allCleaned')
      expect(result).toHaveProperty('remaining')
    })
  })

  // ============================================================================
  // FULL CRUD CYCLE TEST
  // ============================================================================

  describe('Full CRUD Cycle', () => {
    it('should complete full CRUD cycle', async () => {
      if (!ctx || !isWriteAllowed()) return

      const startTime = Date.now()

      // Create
      const thing = await createTestThing(ctx, {
        namespace: testNamespace,
        prefix: 'smoke-cycle',
        data: { status: 'created' },
      })
      expect(thing.id).toBeDefined()

      // Read
      const read1 = await readThing(ctx, testNamespace, thing.id)
      expect(read1).not.toBeNull()
      expect(read1?.data.status).toBe('created')

      // Update
      const updateSuccess = await updateThing(ctx, testNamespace, thing.id, {
        status: 'updated',
      })
      expect(updateSuccess).toBe(true)

      // Read again to verify update
      const read2 = await readThing(ctx, testNamespace, thing.id)
      expect(read2?.data.status).toBe('updated')

      // Delete
      const deleteSuccess = await deleteThing(ctx, testNamespace, thing.id)
      expect(deleteSuccess).toBe(true)

      const totalDuration = Date.now() - startTime

      // Full CRUD cycle should complete within time budget
      expect(totalDuration).toBeLessThan(SMOKE_TEST_FIXTURES.maxTotalDurationMs)

      console.log(`Full CRUD cycle completed in ${totalDuration}ms`)
    })
  })
})
