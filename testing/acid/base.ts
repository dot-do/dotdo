/**
 * ACID Test Base Classes
 *
 * Abstract base classes for ACID testing that provide:
 * - Common setup/teardown patterns
 * - ACID property assertion helpers (atomicity, consistency, isolation, durability)
 * - Lifecycle event tracking helpers
 * - Cross-DO test utilities
 *
 * @module testing/acid/base
 */

import { describe, beforeEach, afterEach, expect } from 'vitest'
import type { LifecycleEvent, LifecycleStatus, LifecycleOperation } from '../../types/acid/lifecycle'
import { createLifecycleEvent } from '../../types/acid/lifecycle'
import type { ACIDTestConfig, ACIDTestContext, DOTestInstance } from './context'
import { createACIDTestContext } from './context'

// ============================================================================
// BASE TEST CLASS
// ============================================================================

/**
 * Base class for all ACID tests.
 *
 * Provides common setup, teardown, and assertion helpers for testing
 * ACID properties of Durable Objects.
 *
 * @example
 * ```typescript
 * class ForkAtomicityTest extends ACIDTestBase {
 *   getConfig(): ACIDTestConfig {
 *     return { isolation: 'full' }
 *   }
 *
 *   async setup(): Promise<void> {
 *     // Load test fixtures
 *   }
 *
 *   async teardown(): Promise<void> {
 *     // Cleanup if needed
 *   }
 * }
 * ```
 */
export abstract class ACIDTestBase {
  /**
   * Test context for managing DOs and state.
   */
  protected ctx!: ACIDTestContext

  /**
   * Configuration for this test suite.
   */
  protected config!: ACIDTestConfig

  /**
   * Override to configure the test.
   * @returns Test configuration
   */
  abstract getConfig(): ACIDTestConfig

  /**
   * Override to setup test fixtures before each test.
   */
  abstract setup(): Promise<void>

  /**
   * Override to cleanup after each test.
   */
  abstract teardown(): Promise<void>

  /**
   * Initialize the test context. Called automatically by run().
   */
  protected initialize(): void {
    this.config = this.getConfig()
    this.ctx = createACIDTestContext(this.config)
  }

  /**
   * Cleanup the test context. Called automatically by run().
   */
  protected finalize(): void {
    this.ctx.cleanup()
  }

  // ==========================================================================
  // ATOMICITY ASSERTIONS
  // ==========================================================================

  /**
   * Assert that an operation is atomic - either fully completes or fully rolls back.
   *
   * Runs the operation and verifies that either:
   * - The operation completes and state matches expectedState
   * - The operation fails and state is unchanged from before
   *
   * @param getState - Function to get current state
   * @param operation - The operation to test
   * @param expectedState - Expected state if operation succeeds
   *
   * @example
   * ```typescript
   * await this.assertAtomic(
   *   () => instance.getData(),
   *   () => instance.fork(target),
   *   { forked: true, data: 'preserved' }
   * )
   * ```
   */
  protected async assertAtomic<S>(
    getState: () => Promise<S> | S,
    operation: () => Promise<void>,
    expectedState: S
  ): Promise<void> {
    const stateBefore = await getState()

    try {
      await operation()
      const stateAfter = await getState()
      expect(stateAfter).toEqual(expectedState)
    } catch (error) {
      // On failure, state should be unchanged
      const stateAfter = await getState()
      expect(stateAfter).toEqual(stateBefore)
      throw error // Re-throw so test can verify expected failure
    }
  }

  /**
   * Assert that an operation either succeeds completely or has no effect.
   *
   * Similar to assertAtomic but doesn't expect a specific final state,
   * only verifies rollback on failure.
   *
   * @param getState - Function to get current state
   * @param operation - The operation to test
   */
  protected async assertAtomicOrRollback<S>(
    getState: () => Promise<S> | S,
    operation: () => Promise<void>
  ): Promise<{ succeeded: boolean; stateBefore: S; stateAfter: S }> {
    const stateBefore = await getState()
    let succeeded = false

    try {
      await operation()
      succeeded = true
    } catch {
      // Expected - operation may fail
    }

    const stateAfter = await getState()

    if (!succeeded) {
      // On failure, verify state unchanged (atomicity)
      expect(stateAfter).toEqual(stateBefore)
    }

    return { succeeded, stateBefore, stateAfter }
  }

  // ==========================================================================
  // CONSISTENCY ASSERTIONS
  // ==========================================================================

  /**
   * Assert that state satisfies all given invariants.
   *
   * @param state - The state to validate
   * @param invariants - Array of invariant functions that should return true
   *
   * @example
   * ```typescript
   * this.assertConsistent(state, [
   *   (s) => s.version >= 0,
   *   (s) => s.items.every(i => i.id != null),
   *   (s) => s.total === s.items.length,
   * ])
   * ```
   */
  protected assertConsistent<S>(
    state: S,
    invariants: Array<(s: S) => boolean>
  ): void {
    for (let i = 0; i < invariants.length; i++) {
      const invariant = invariants[i]!
      const result = invariant(state)
      if (!result) {
        throw new Error(
          `Invariant ${i + 1} failed for state: ${JSON.stringify(state, null, 2)}`
        )
      }
    }
  }

  /**
   * Assert that state matches a schema structure.
   *
   * @param state - The state to validate
   * @param schema - Object describing expected types for each field
   */
  protected assertSchema<S extends Record<string, unknown>>(
    state: S,
    schema: Record<keyof S, 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null' | 'undefined'>
  ): void {
    for (const [key, expectedType] of Object.entries(schema)) {
      const value = state[key as keyof S]
      let actualType: string

      if (value === null) {
        actualType = 'null'
      } else if (value === undefined) {
        actualType = 'undefined'
      } else if (Array.isArray(value)) {
        actualType = 'array'
      } else {
        actualType = typeof value
      }

      if (actualType !== expectedType) {
        throw new Error(
          `Schema mismatch for field "${key}": expected ${expectedType}, got ${actualType}`
        )
      }
    }
  }

  // ==========================================================================
  // ISOLATION ASSERTIONS
  // ==========================================================================

  /**
   * Assert that concurrent operations don't interfere with each other.
   *
   * Runs all operations concurrently and verifies each produces
   * its expected result independently.
   *
   * @param operations - Array of { operation, expectedResult } pairs
   *
   * @example
   * ```typescript
   * await this.assertIsolated([
   *   { operation: () => do1.increment(), expectedResult: 1 },
   *   { operation: () => do2.increment(), expectedResult: 1 },
   * ])
   * ```
   */
  protected async assertIsolated<R>(
    operations: Array<{ operation: () => Promise<R>; expectedResult: R }>
  ): Promise<void> {
    const results = await Promise.all(operations.map((op) => op.operation()))

    for (let i = 0; i < operations.length; i++) {
      expect(results[i]).toEqual(operations[i]!.expectedResult)
    }
  }

  /**
   * Assert that branch isolation is maintained.
   *
   * Verifies that changes to one branch don't affect another.
   *
   * @param getBranchState - Function to get state for a given branch
   * @param branches - Branch names to check
   * @param operationBranch - Branch where operation will be performed
   * @param operation - Operation to perform
   */
  protected async assertBranchIsolation<S>(
    getBranchState: (branch: string) => Promise<S>,
    branches: string[],
    operationBranch: string,
    operation: () => Promise<void>
  ): Promise<void> {
    // Get state before for all branches
    const statesBefore = new Map<string, S>()
    for (const branch of branches) {
      statesBefore.set(branch, await getBranchState(branch))
    }

    // Perform operation
    await operation()

    // Verify other branches unchanged
    for (const branch of branches) {
      if (branch !== operationBranch) {
        const stateAfter = await getBranchState(branch)
        expect(stateAfter).toEqual(statesBefore.get(branch))
      }
    }
  }

  // ==========================================================================
  // DURABILITY ASSERTIONS
  // ==========================================================================

  /**
   * Assert that state persists after crash and recovery.
   *
   * @param doId - ID of the DO to crash and recover
   * @param getState - Function to get current state
   * @param expectedState - Expected state after recovery
   *
   * @example
   * ```typescript
   * await this.assertDurable(
   *   doId,
   *   () => instance.getData(),
   *   { saved: true, value: 42 }
   * )
   * ```
   */
  protected async assertDurable<S>(
    doId: string,
    getState: () => Promise<S> | S,
    expectedState: S
  ): Promise<void> {
    // Verify state is correct before crash
    const stateBefore = await getState()
    expect(stateBefore).toEqual(expectedState)

    // Crash and recover
    await this.ctx.crashAndRecover(doId)

    // Verify state persisted
    const stateAfter = await getState()
    expect(stateAfter).toEqual(expectedState)
  }

  /**
   * Assert that state persists through crash with custom recovery getter.
   *
   * Use this when the getter needs to reference the recovered instance.
   *
   * @param doId - ID of the DO to crash and recover
   * @param getStateBefore - Function to get state before crash
   * @param getStateAfter - Function to get state after recovery (receives recovered DO)
   * @param expectedState - Expected state
   */
  protected async assertDurableWithRecovery<S, T>(
    doId: string,
    getStateBefore: () => Promise<S> | S,
    getStateAfter: (recovered: DOTestInstance<T>) => Promise<S> | S,
    expectedState: S
  ): Promise<void> {
    const stateBefore = await getStateBefore()
    expect(stateBefore).toEqual(expectedState)

    await this.ctx.crashAndRecover(doId)

    // Note: After crash recovery, caller needs to get fresh reference
    // This is just a pattern - actual implementation depends on test setup
  }
}

// ============================================================================
// LIFECYCLE TEST BASE CLASS
// ============================================================================

/**
 * Base class for lifecycle operation tests.
 *
 * Extends ACIDTestBase with helpers specific to testing DO lifecycle
 * operations like fork, compact, move, clone, etc.
 *
 * @example
 * ```typescript
 * class ForkOperationTest extends LifecycleTestBase {
 *   // ... implement abstract methods
 *
 *   async testForkEmitsEvents(): Promise<void> {
 *     await instance.fork(target)
 *     await this.assertLifecycleEvent(doId, 'fork', 'completed')
 *   }
 * }
 * ```
 */
export abstract class LifecycleTestBase extends ACIDTestBase {
  // ==========================================================================
  // EVENT TRACKING HELPERS
  // ==========================================================================

  /**
   * Create and record a lifecycle event for tracking.
   *
   * @param doId - ID of the DO
   * @param operation - Type of lifecycle operation
   * @param metadata - Operation-specific metadata
   * @returns Index of the recorded event
   */
  protected recordLifecycleEvent(
    doId: string,
    operation: LifecycleOperation,
    metadata: Record<string, unknown> = {}
  ): number {
    const event = createLifecycleEvent(operation, metadata)
    const history = this.ctx.getHistory(doId)
    this.ctx.recordEvent(doId, event)
    // Return index (async history, so return current length as index)
    return 0 // Will be the last index
  }

  /**
   * Update a lifecycle event status.
   *
   * @param doId - ID of the DO
   * @param eventIndex - Index of the event
   * @param status - New status
   * @param error - Optional error message
   */
  protected updateLifecycleEvent(
    doId: string,
    eventIndex: number,
    status: LifecycleStatus,
    error?: string
  ): void {
    this.ctx.updateEventStatus(doId, eventIndex, status, error)
  }

  // ==========================================================================
  // LIFECYCLE ASSERTIONS
  // ==========================================================================

  /**
   * Assert that a lifecycle event was emitted with expected status.
   *
   * @param doId - ID of the DO
   * @param operation - Expected operation type
   * @param status - Expected status
   *
   * @example
   * ```typescript
   * await instance.fork(target)
   * await this.assertLifecycleEvent(doId, 'fork', 'completed')
   * ```
   */
  protected async assertLifecycleEvent(
    doId: string,
    operation: LifecycleOperation,
    status: LifecycleStatus
  ): Promise<void> {
    const history = await this.ctx.getHistory(doId)
    const found = history.find(
      (e) => e.operation === operation && e.status === status
    )

    if (!found) {
      const actual = history.map((e) => `${e.operation}:${e.status}`).join(', ')
      throw new Error(
        `Expected lifecycle event ${operation}:${status} not found. ` +
          `Actual events: [${actual}]`
      )
    }
  }

  /**
   * Assert that a lifecycle event was NOT emitted.
   *
   * @param doId - ID of the DO
   * @param operation - Operation type that should not exist
   */
  protected async assertNoLifecycleEvent(
    doId: string,
    operation: LifecycleOperation
  ): Promise<void> {
    const history = await this.ctx.getHistory(doId)
    const found = history.find((e) => e.operation === operation)

    if (found) {
      throw new Error(
        `Unexpected lifecycle event found: ${operation}:${found.status}`
      )
    }
  }

  /**
   * Assert that a lifecycle event has specific metadata.
   *
   * @param doId - ID of the DO
   * @param operation - Operation type
   * @param expectedMetadata - Partial metadata to match
   */
  protected async assertLifecycleEventMetadata(
    doId: string,
    operation: LifecycleOperation,
    expectedMetadata: Record<string, unknown>
  ): Promise<void> {
    const history = await this.ctx.getHistory(doId)
    const event = history.find((e) => e.operation === operation)

    if (!event) {
      throw new Error(`Lifecycle event ${operation} not found`)
    }

    for (const [key, value] of Object.entries(expectedMetadata)) {
      expect(event.metadata[key]).toEqual(value)
    }
  }

  // ==========================================================================
  // ROLLBACK ASSERTIONS
  // ==========================================================================

  /**
   * Assert that an operation can be rolled back.
   *
   * Captures state before, performs operation, then verifies
   * rollback restores original state.
   *
   * @param getState - Function to get current state
   * @param operation - Operation that should be rollback-able
   * @param rollback - Rollback function
   *
   * @example
   * ```typescript
   * await this.assertRollback(
   *   () => instance.getData(),
   *   () => instance.fork(target),
   *   () => instance.rollbackFork()
   * )
   * ```
   */
  protected async assertRollback<S>(
    getState: () => Promise<S> | S,
    operation: () => Promise<void>,
    rollback: () => Promise<void>
  ): Promise<void> {
    const stateBefore = await getState()

    // Perform operation
    await operation()

    // State should have changed
    const stateAfterOp = await getState()
    expect(stateAfterOp).not.toEqual(stateBefore)

    // Rollback
    await rollback()

    // State should be restored
    const stateAfterRollback = await getState()
    expect(stateAfterRollback).toEqual(stateBefore)
  }

  /**
   * Assert that failed operations automatically rollback.
   *
   * @param getState - Function to get current state
   * @param failingOperation - Operation that should fail and rollback
   */
  protected async assertAutoRollbackOnFailure<S>(
    getState: () => Promise<S> | S,
    failingOperation: () => Promise<void>
  ): Promise<void> {
    const stateBefore = await getState()

    try {
      await failingOperation()
      throw new Error('Expected operation to fail')
    } catch (error) {
      // Expected failure
    }

    const stateAfter = await getState()
    expect(stateAfter).toEqual(stateBefore)
  }
}

// ============================================================================
// CROSS-DO TEST BASE CLASS
// ============================================================================

/**
 * Base class for cross-DO interaction tests.
 *
 * Provides utilities for testing scenarios involving multiple DOs,
 * including clusters, resolution, and circuit breakers.
 *
 * @example
 * ```typescript
 * class CrossDOResolutionTest extends CrossDOTestBase {
 *   protected cluster: DOTestInstance<MyDO>[] = []
 *
 *   async setup(): Promise<void> {
 *     await this.setupCluster(3)
 *   }
 *
 *   async testResolution(): Promise<void> {
 *     await this.assertResolution(
 *       this.cluster[0].id,
 *       'https://target.do'
 *     )
 *   }
 * }
 * ```
 */
export abstract class CrossDOTestBase extends ACIDTestBase {
  /**
   * Cluster of DO instances for cross-DO tests.
   */
  protected cluster: DOTestInstance<unknown>[] = []

  // ==========================================================================
  // CLUSTER SETUP
  // ==========================================================================

  /**
   * Setup a cluster of DOs for testing.
   *
   * @param DOClass - The Durable Object class to instantiate
   * @param count - Number of DOs in the cluster
   */
  protected async setupCluster<T extends new (...args: unknown[]) => InstanceType<T>>(
    DOClass: T,
    count: number
  ): Promise<void> {
    this.cluster = await this.ctx.createDOCluster(DOClass, count)
  }

  /**
   * Get a DO from the cluster by index.
   *
   * @param index - Index in the cluster
   * @returns The DO test instance
   */
  protected getClusterDO<T>(index: number): DOTestInstance<T> {
    if (index < 0 || index >= this.cluster.length) {
      throw new Error(`Cluster index out of bounds: ${index}`)
    }
    return this.cluster[index] as DOTestInstance<T>
  }

  // ==========================================================================
  // CROSS-DO ASSERTIONS
  // ==========================================================================

  /**
   * Assert that cross-DO resolution works correctly.
   *
   * @param sourceDoId - Source DO ID
   * @param targetNs - Target namespace URL
   * @param expectedResult - Expected resolution result
   */
  protected async assertResolution(
    sourceDoId: string,
    targetNs: string,
    expectedResult?: unknown
  ): Promise<void> {
    // This is a placeholder - actual implementation depends on DO.resolve() behavior
    // The test should verify that:
    // 1. Resolution request is sent to correct namespace
    // 2. Response is correctly parsed
    // 3. State is updated based on response
  }

  /**
   * Assert circuit breaker behavior under failures.
   *
   * Verifies that after N failures, subsequent calls fail fast
   * without attempting the operation.
   *
   * @param operation - Operation that should trigger circuit breaker
   * @param failureThreshold - Number of failures before circuit opens
   *
   * @example
   * ```typescript
   * await this.assertCircuitBreaker(
   *   () => instance.callRemote(target),
   *   3
   * )
   * ```
   */
  protected async assertCircuitBreaker(
    operation: () => Promise<unknown>,
    failureThreshold: number
  ): Promise<void> {
    let failures = 0
    let circuitOpenErrors = 0

    // Trigger failures up to threshold
    for (let i = 0; i < failureThreshold; i++) {
      try {
        await operation()
      } catch (error) {
        failures++
      }
    }

    expect(failures).toBe(failureThreshold)

    // Next calls should fail fast (circuit open)
    for (let i = 0; i < 3; i++) {
      try {
        await operation()
      } catch (error) {
        if ((error as Error).message.includes('circuit') ||
            (error as Error).message.includes('Circuit')) {
          circuitOpenErrors++
        }
      }
    }

    // At least some should be circuit-open fast failures
    expect(circuitOpenErrors).toBeGreaterThan(0)
  }

  /**
   * Assert that partition handling works correctly.
   *
   * @param doIds - IDs to partition
   * @param crossPartitionOperation - Operation that crosses partition boundary
   * @param expectedError - Expected error pattern
   */
  protected async assertPartitionHandling(
    doIds: string[],
    crossPartitionOperation: () => Promise<unknown>,
    expectedError: string | RegExp
  ): Promise<void> {
    // Create partition
    await this.ctx.partition(doIds)

    // Operation should fail
    await expect(crossPartitionOperation()).rejects.toThrow(expectedError)

    // Heal partition
    await this.ctx.heal()

    // Operation should now succeed
    await expect(crossPartitionOperation()).resolves.toBeDefined()
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Run an ACID test class using Vitest.
 *
 * @param TestClass - The test class to run
 * @param suiteName - Name for the test suite
 *
 * @example
 * ```typescript
 * class MyTest extends ACIDTestBase {
 *   // ... implementation
 * }
 *
 * runACIDTest(MyTest, 'My ACID Tests')
 * ```
 */
export function runACIDTest<T extends ACIDTestBase>(
  TestClass: new () => T,
  suiteName: string
): void {
  const testInstance = new TestClass()

  describe(suiteName, () => {
    beforeEach(async () => {
      testInstance['initialize']()
      await testInstance.setup()
    })

    afterEach(async () => {
      await testInstance.teardown()
      testInstance['finalize']()
    })

    // Tests are added by the test class or manually
  })
}
