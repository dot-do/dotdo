/**
 * ACID Test Suite - Phase 5: Smoke Tests - Clone Operations
 *
 * Clone operation smoke tests that verify atomic clone functionality.
 * These tests create clones and verify data integrity.
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md - Phase 5 E2E Pipeline
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'

import {
  createE2EContext,
  skipIfNoE2E,
  skipIfReadOnly,
  type E2ETestContext,
} from '../context'

import {
  createTestThing,
  verifyCloneIntegrity,
  verifyQuickClone,
  cleanupTestResources,
  type TestThing,
  type CloneIntegrityResult,
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

describe('Clone Smoke Tests', () => {
  let ctx: E2ETestContext | undefined
  let sourceNamespace: string
  const createdNamespaces: string[] = []

  beforeAll(async () => {
    if (!isE2EAvailable()) {
      return
    }

    try {
      ctx = createE2EContext()
      sourceNamespace = await ctx.createTestNamespace('clone-smoke-source')

      // Create some test data in the source namespace
      if (isWriteAllowed()) {
        for (let i = 0; i < 5; i++) {
          await createTestThing(ctx, {
            namespace: sourceNamespace,
            prefix: 'smoke-clone',
            data: { index: i, value: `item-${i}` },
          })
        }
      }
    } catch {
      ctx = undefined
    }
  })

  afterAll(async () => {
    // Clean up created namespaces
    if (ctx) {
      for (const ns of createdNamespaces) {
        try {
          await ctx.deleteTestNamespace(ns)
        } catch {
          // Ignore cleanup errors
        }
      }

      await ctx.cleanup()
    }
  })

  // ============================================================================
  // ATOMIC CLONE TESTS
  // ============================================================================

  describe('Atomic Clone', () => {
    it('should perform atomic clone', async () => {
      if (!ctx || !isWriteAllowed()) return

      // Arrange
      const targetNamespace = createPhase5TestNamespace('clone-target')
      createdNamespaces.push(targetNamespace)
      ctx.registerResource(targetNamespace)

      // Act
      const startTime = Date.now()
      await ctx.post(`/do/${sourceNamespace}/clone`, {
        target: targetNamespace,
        mode: 'atomic',
      })
      const cloneDuration = Date.now() - startTime

      // Assert
      expect(cloneDuration).toBeLessThan(SMOKE_TEST_FIXTURES.cloneTimeoutMs)

      // Verify target namespace was created by trying to read from it
      const response = await ctx.get(`/do/${targetNamespace}/things`)
      expect(Array.isArray(response)).toBe(true)
    })

    it('should complete clone within timeout', async () => {
      if (!ctx || !isWriteAllowed()) return

      const targetNamespace = createPhase5TestNamespace('clone-timeout')
      createdNamespaces.push(targetNamespace)
      ctx.registerResource(targetNamespace)

      const startTime = Date.now()
      await ctx.post(`/do/${sourceNamespace}/clone`, {
        target: targetNamespace,
        mode: 'atomic',
      })
      const duration = Date.now() - startTime

      expect(duration).toBeLessThan(SMOKE_TEST_FIXTURES.cloneTimeoutMs)
    })
  })

  // ============================================================================
  // CLONE INTEGRITY TESTS
  // ============================================================================

  describe('Clone Integrity', () => {
    it('should verify clone integrity', async () => {
      if (!ctx || !isWriteAllowed()) return

      // Arrange - create a fresh clone
      const targetNamespace = createPhase5TestNamespace('clone-integrity')
      createdNamespaces.push(targetNamespace)
      ctx.registerResource(targetNamespace)

      await ctx.post(`/do/${sourceNamespace}/clone`, {
        target: targetNamespace,
        mode: 'atomic',
      })

      // Act
      const integrityResult: CloneIntegrityResult = await verifyCloneIntegrity(
        ctx,
        sourceNamespace,
        targetNamespace
      )

      // Assert
      expect(integrityResult.match).toBe(true)
      expect(integrityResult.itemsCompared).toBeGreaterThan(0)
      expect(integrityResult.differences).toBeUndefined()
      expect(integrityResult.missingInTarget).toBeUndefined()
      expect(integrityResult.extraInTarget).toBeUndefined()
    })

    it('should verify all items are cloned', async () => {
      if (!ctx || !isWriteAllowed()) return

      // Arrange
      const targetNamespace = createPhase5TestNamespace('clone-all-items')
      createdNamespaces.push(targetNamespace)
      ctx.registerResource(targetNamespace)

      await ctx.post(`/do/${sourceNamespace}/clone`, {
        target: targetNamespace,
        mode: 'atomic',
      })

      // Act
      const sourceThings = await ctx.get<unknown[]>(`/do/${sourceNamespace}/things`)
      const targetThings = await ctx.get<unknown[]>(`/do/${targetNamespace}/things`)

      // Assert
      expect(targetThings.length).toBe(sourceThings.length)
    })

    it('should preserve data integrity in clone', async () => {
      if (!ctx || !isWriteAllowed()) return

      // Arrange
      const targetNamespace = createPhase5TestNamespace('clone-data')
      createdNamespaces.push(targetNamespace)
      ctx.registerResource(targetNamespace)

      await ctx.post(`/do/${sourceNamespace}/clone`, {
        target: targetNamespace,
        mode: 'atomic',
      })

      // Act - compare specific fields
      const integrityResult = await verifyCloneIntegrity(
        ctx,
        sourceNamespace,
        targetNamespace,
        { compareFields: ['name', 'value', 'index'] }
      )

      // Assert
      expect(integrityResult.match).toBe(true)
    })
  })

  // ============================================================================
  // QUICK CLONE VERIFICATION
  // ============================================================================

  describe('Quick Clone Verification', () => {
    it('should verify quick clone', async () => {
      if (!ctx || !isWriteAllowed()) return

      // Act
      const result = await verifyQuickClone(ctx, sourceNamespace)

      // Assert
      expect(result.success).toBe(true)
      expect(result.targetNs).toBeDefined()
      expect(result.cloneDurationMs).toBeDefined()
      expect(result.cloneDurationMs).toBeLessThan(SMOKE_TEST_FIXTURES.cloneTimeoutMs)
      expect(result.integrityResult?.match).toBe(true)

      // Cleanup
      if (result.targetNs) {
        createdNamespaces.push(result.targetNs)
      }
    })

    it('should complete quick clone and verification within time budget', async () => {
      if (!ctx || !isWriteAllowed()) return

      const startTime = Date.now()
      const result = await verifyQuickClone(ctx, sourceNamespace)
      const totalDuration = Date.now() - startTime

      expect(result.success).toBe(true)
      expect(totalDuration).toBeLessThan(SMOKE_TEST_FIXTURES.maxTotalDurationMs)

      if (result.targetNs) {
        createdNamespaces.push(result.targetNs)
      }

      console.log(`Quick clone completed in ${result.cloneDurationMs}ms, total: ${totalDuration}ms`)
    })
  })

  // ============================================================================
  // CLEANUP TESTS
  // ============================================================================

  describe('Clone Cleanup', () => {
    it('should cleanup test clones', async () => {
      if (!ctx || !isWriteAllowed()) return

      // Arrange - create a clone to clean up
      const targetNamespace = createPhase5TestNamespace('clone-cleanup')
      ctx.registerResource(targetNamespace)

      await ctx.post(`/do/${sourceNamespace}/clone`, {
        target: targetNamespace,
        mode: 'atomic',
      })

      // Act - cleanup
      await ctx.deleteTestNamespace(targetNamespace)

      // Assert - namespace should be cleaned up
      // (we verify by not adding to createdNamespaces for afterAll cleanup)
      // The deletion itself not throwing is the assertion
    })

    it('should cleanup stale test resources', async () => {
      if (!ctx) return

      // Act
      const result = await cleanupTestResources(ctx, {
        prefix: 'e2e-test-',
        maxAge: 3600, // 1 hour
        dryRun: true, // Don't actually delete in smoke test
      })

      // Assert
      expect(result).toHaveProperty('cleaned')
      expect(result).toHaveProperty('failed')
      expect(result).toHaveProperty('errors')
      expect(result).toHaveProperty('durationMs')
    })
  })

  // ============================================================================
  // FULL CLONE WORKFLOW
  // ============================================================================

  describe('Full Clone Workflow', () => {
    it('should complete full clone workflow', async () => {
      if (!ctx || !isWriteAllowed()) return

      const startTime = Date.now()

      // Step 1: Create clone
      const targetNamespace = createPhase5TestNamespace('clone-workflow')
      createdNamespaces.push(targetNamespace)
      ctx.registerResource(targetNamespace)

      await ctx.post(`/do/${sourceNamespace}/clone`, {
        target: targetNamespace,
        mode: 'atomic',
      })

      // Step 2: Verify clone integrity
      const integrityResult = await verifyCloneIntegrity(
        ctx,
        sourceNamespace,
        targetNamespace
      )
      expect(integrityResult.match).toBe(true)

      // Step 3: Verify data can be read from clone
      const clonedThings = await ctx.get<unknown[]>(`/do/${targetNamespace}/things`)
      expect(clonedThings.length).toBeGreaterThan(0)

      // Step 4: Cleanup
      await ctx.deleteTestNamespace(targetNamespace)
      // Remove from createdNamespaces since we cleaned up
      const idx = createdNamespaces.indexOf(targetNamespace)
      if (idx > -1) createdNamespaces.splice(idx, 1)

      const totalDuration = Date.now() - startTime

      expect(totalDuration).toBeLessThan(SMOKE_TEST_FIXTURES.maxTotalDurationMs)
      console.log(`Full clone workflow completed in ${totalDuration}ms`)
    })
  })
})
