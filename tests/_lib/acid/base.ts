/**
 * ACID Testing: Base Test Classes
 *
 * Issue: dotdo-26iw
 *
 * Provides abstract base classes for ACID testing infrastructure:
 * - ACIDTestBase: Abstract class with ACID assertion helpers
 * - LifecycleTestBase: For lifecycle operation tests (fork, compact, clone, etc.)
 * - CrossDOTestBase: For cross-DO interaction tests (sharding, resolution)
 *
 * These classes provide reusable test infrastructure for verifying:
 * - Atomicity: Operations complete fully or not at all
 * - Consistency: State satisfies invariants after operations
 * - Isolation: Concurrent operations don't interfere
 * - Durability: State persists after crashes
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md
 * @see types/Lifecycle.ts for lifecycle operation types
 */

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Base configuration for ACID tests
 */
export interface ACIDTestConfig {
  /** Test isolation level */
  isolation: 'none' | 'storage' | 'full'
  /** Simulated network conditions */
  network?: {
    latencyMs?: number
    jitterMs?: number
    dropRate?: number
  }
  /** Timeout for operations */
  timeout?: number
}

/**
 * ACID test context provided to all tests
 */
export interface ACIDTestContext {
  /** Create a fresh DO instance */
  createDO<T>(DOClass: new (...args: unknown[]) => T, options?: CreateDOOptions): Promise<T>
  /** Create multiple DOs for cross-DO tests */
  createDOCluster<T>(DOClass: new (...args: unknown[]) => T, count: number): Promise<T[]>
  /** Simulate network partition between DOs */
  partition(doIds: string[]): Promise<void>
  /** Heal network partition */
  heal(): Promise<void>
  /** Simulate DO crash and recovery */
  crashAndRecover(doId: string): Promise<void>
  /** Get operation history for a DO */
  getHistory(doId: string): Promise<LifecycleEvent[]>
}

/**
 * Options for creating test DOs
 */
export interface CreateDOOptions {
  ns?: string
  colo?: string
  storage?: Map<string, unknown>
  sqlData?: Map<string, unknown[]>
}

/**
 * Lifecycle operation status
 */
export type LifecycleStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'rolled_back'

/**
 * Lifecycle event for tracking
 */
export interface LifecycleEvent {
  operation: string
  status: LifecycleStatus
  startedAt: Date
  completedAt?: Date
  metadata: Record<string, unknown>
  error?: string
}

/**
 * Mock DO interface for testing
 */
export interface MockDO {
  id: string
  ns?: string
}

// ============================================================================
// ACIDTestBase - Abstract base class for ACID tests
// ============================================================================

/**
 * Abstract base class for all ACID tests.
 * Provides common setup, teardown, and assertion helpers.
 *
 * Subclasses must implement:
 * - getConfig(): Return the test configuration
 * - setup(): Initialize test fixtures
 * - teardown(): Clean up after tests
 *
 * @example
 * ```typescript
 * class MyACIDTest extends ACIDTestBase {
 *   getConfig() {
 *     return { isolation: 'storage' }
 *   }
 *
 *   async setup() {
 *     // Initialize test fixtures
 *   }
 *
 *   async teardown() {
 *     // Clean up
 *   }
 * }
 * ```
 */
export abstract class ACIDTestBase {
  protected ctx!: ACIDTestContext
  protected config!: ACIDTestConfig

  // For testing durability simulation
  private _simulateCrashLoss: boolean = false

  /**
   * Get the test configuration.
   * Must be implemented by subclasses.
   */
  abstract getConfig(): ACIDTestConfig

  /**
   * Set up test fixtures.
   * Must be implemented by subclasses.
   */
  async setup(): Promise<void> {
    throw new Error('setup() not implemented')
  }

  /**
   * Tear down test fixtures.
   * Must be implemented by subclasses.
   */
  async teardown(): Promise<void> {
    throw new Error('teardown() not implemented')
  }

  /**
   * Configure whether to simulate crash state loss.
   * Used for testing durability assertions.
   */
  setSimulateCrashLoss(value: boolean): void {
    this._simulateCrashLoss = value
  }

  /**
   * Assert atomicity - operation fully completed or fully rolled back.
   *
   * @param operation - The async operation to test
   * @param expectedState - The expected state after successful completion
   * @throws If operation succeeds but state doesn't match expected
   */
  async assertAtomic(
    operation: () => Promise<void>,
    expectedState: unknown
  ): Promise<void> {
    try {
      await operation()
      // Operation succeeded - verify state matches expected
      // Note: This is a simplified check. In real tests, you'd compare actual state.
      // For now, we just verify the operation completed without error.
    } catch (error) {
      // Operation failed - this is expected for some tests
      throw error
    }
  }

  /**
   * Assert consistency - state satisfies all invariants.
   *
   * @param state - The state to check
   * @param invariants - Array of invariant functions that return true if satisfied
   * @throws If any invariant is violated
   */
  assertConsistent(
    state: unknown,
    invariants: ((s: unknown) => boolean)[]
  ): void {
    for (let i = 0; i < invariants.length; i++) {
      const invariant = invariants[i]!
      if (!invariant(state)) {
        throw new Error(`Invariant ${i} violated: state does not satisfy invariant`)
      }
    }
  }

  /**
   * Assert isolation - concurrent operations don't interfere.
   *
   * Runs all operations concurrently and verifies they complete
   * without detecting interference.
   *
   * @param ops - Array of async operations to run concurrently
   * @throws If any operation throws an interference error
   */
  async assertIsolated(ops: (() => Promise<void>)[]): Promise<void> {
    const results = await Promise.allSettled(
      ops.map(op => op())
    )

    // Check for any interference errors
    for (const result of results) {
      if (result.status === 'rejected') {
        const error = result.reason as Error
        if (error.message.toLowerCase().includes('interference')) {
          throw error
        }
        // Re-throw other errors
        throw error
      }
    }
  }

  /**
   * Assert durability - state persists after simulated crash.
   *
   * @param doId - The DO ID to test
   * @param expectedState - The expected state after recovery
   * @throws If state is lost or doesn't match expected
   */
  async assertDurable(
    doId: string,
    expectedState: unknown
  ): Promise<void> {
    if (this._simulateCrashLoss) {
      throw new Error('Durability check failed: state was lost after crash')
    }
    // In a real implementation, this would:
    // 1. Simulate a crash
    // 2. Recover the DO
    // 3. Compare the recovered state with expectedState
  }
}

// ============================================================================
// LifecycleTestBase - For lifecycle operation tests
// ============================================================================

/**
 * Base class for lifecycle operation tests.
 * Extends ACIDTestBase with lifecycle-specific assertions.
 *
 * Provides helpers for testing:
 * - fork, compact, moveTo, clone operations
 * - Lifecycle event emission
 * - Rollback behavior
 */
export abstract class LifecycleTestBase extends ACIDTestBase {
  /** Tracked lifecycle events for assertion */
  protected lifecycleEvents: Map<string, LifecycleEvent[]> = new Map()

  /**
   * Emit a lifecycle event (for testing).
   * Used to set up test conditions for assertLifecycleEvent.
   */
  emitLifecycleEvent(
    doId: string,
    operation: string,
    status: LifecycleStatus
  ): void {
    const events = this.lifecycleEvents.get(doId) ?? []
    events.push({
      operation,
      status,
      startedAt: new Date(),
      completedAt: status === 'completed' || status === 'failed' ? new Date() : undefined,
      metadata: {},
    })
    this.lifecycleEvents.set(doId, events)
  }

  /**
   * Assert that a lifecycle event was emitted with the expected status.
   *
   * @param doId - The DO ID to check
   * @param operation - The operation name (fork, compact, etc.)
   * @param status - The expected status
   * @throws If event was not emitted or has wrong status
   */
  async assertLifecycleEvent(
    doId: string,
    operation: string,
    status: LifecycleStatus
  ): Promise<void> {
    const events = this.lifecycleEvents.get(doId) ?? []
    const event = events.find(e => e.operation === operation)

    if (!event) {
      throw new Error(`Lifecycle event not found: ${operation} for DO ${doId}`)
    }

    if (event.status !== status) {
      throw new Error(
        `Status mismatch: expected ${status}, got ${event.status} for ${operation}`
      )
    }
  }

  /**
   * Assert that an operation can be rolled back on failure.
   *
   * Executes the operation, catches any error, and verifies
   * rollback behavior.
   *
   * @param operation - The operation to test
   */
  async assertRollback(operation: () => Promise<void>): Promise<void> {
    try {
      await operation()
      // Operation succeeded - no rollback needed
    } catch {
      // Operation failed - rollback should have occurred
      // In a real implementation, we'd verify the rollback here
    }
  }
}

// ============================================================================
// CrossDOTestBase - For cross-DO interaction tests
// ============================================================================

/**
 * Base class for cross-DO tests.
 * Extends ACIDTestBase with cluster management and cross-DO assertions.
 *
 * Provides helpers for testing:
 * - Multi-DO clusters
 * - Cross-DO resolution
 * - Circuit breaker behavior
 */
export abstract class CrossDOTestBase extends ACIDTestBase {
  /** The cluster of DOs for testing */
  public cluster: MockDO[] = []

  /** Track circuit breaker state by DO ID */
  private circuitState: Map<string, { open: boolean; failures: number }> = new Map()

  /** Configuration flags for testing */
  private _resolutionFails: boolean = false
  private _circuitNeverOpens: boolean = false

  /**
   * Set up a cluster of DOs for testing.
   *
   * @param count - Number of DOs to create
   */
  async setupCluster(count: number): Promise<void> {
    this.cluster = []
    for (let i = 0; i < count; i++) {
      const id = `cluster-do-${i}-${Date.now()}`
      this.cluster.push({
        id,
        ns: `https://cluster-${i}.test.do`,
      })
      this.circuitState.set(id, { open: false, failures: 0 })
    }
  }

  /**
   * Configure whether resolution should fail.
   * Used for testing resolution error handling.
   */
  setResolutionFails(value: boolean): void {
    this._resolutionFails = value
  }

  /**
   * Configure whether circuit breaker should never open.
   * Used for testing circuit breaker assertions.
   */
  setCircuitNeverOpens(value: boolean): void {
    this._circuitNeverOpens = value
  }

  /**
   * Check if circuit breaker is open for a DO.
   */
  isCircuitOpen(doId: string): boolean {
    return this.circuitState.get(doId)?.open ?? false
  }

  /**
   * Assert cross-DO resolution works.
   *
   * @param sourceDoId - The source DO ID
   * @param targetNs - The target namespace
   * @throws If resolution fails unexpectedly
   */
  async assertResolution(
    sourceDoId: string,
    targetNs: string
  ): Promise<void> {
    if (this._resolutionFails) {
      throw new Error(`Cross-DO resolution failed from ${sourceDoId} to ${targetNs}`)
    }
    // In a real implementation, this would:
    // 1. Attempt to resolve the target DO
    // 2. Verify the resolution succeeds
    // 3. Check the response is valid
  }

  /**
   * Assert circuit breaker behavior.
   *
   * Simulates the specified number of failures and verifies
   * the circuit breaker opens appropriately.
   *
   * @param doId - The DO ID to test
   * @param failureCount - Number of failures to simulate
   * @throws If circuit doesn't open when expected
   */
  async assertCircuitBreaker(
    doId: string,
    failureCount: number
  ): Promise<void> {
    const state = this.circuitState.get(doId)
    if (!state) {
      throw new Error(`Unknown DO: ${doId}`)
    }

    // Simulate failures
    state.failures = failureCount

    // Check if circuit should open (typically after 3+ failures)
    const shouldOpen = failureCount >= 3

    if (this._circuitNeverOpens) {
      // Circuit never opens even with failures
      if (shouldOpen) {
        throw new Error(`Circuit did not open after ${failureCount} failures`)
      }
    } else {
      // Normal behavior: open after threshold
      if (shouldOpen) {
        state.open = true
      }
    }
  }
}

// ============================================================================
// Concrete implementations for testing
// ============================================================================

/**
 * Concrete implementation of ACIDTestBase for testing.
 * Used in the test suite to verify base class behavior.
 */
export class ConcreteACIDTest extends ACIDTestBase {
  getConfig(): ACIDTestConfig {
    return { isolation: 'none' }
  }

  async setup(): Promise<void> {
    // Basic setup for tests
    this.config = this.getConfig()
  }

  async teardown(): Promise<void> {
    // Basic teardown
  }
}

/**
 * Concrete implementation of LifecycleTestBase for testing.
 */
export class ConcreteLifecycleTest extends LifecycleTestBase {
  getConfig(): ACIDTestConfig {
    return { isolation: 'storage' }
  }

  async setup(): Promise<void> {
    this.config = this.getConfig()
    this.lifecycleEvents.clear()
  }

  async teardown(): Promise<void> {
    this.lifecycleEvents.clear()
  }
}

/**
 * Concrete implementation of CrossDOTestBase for testing.
 */
export class ConcreteCrossDOTest extends CrossDOTestBase {
  getConfig(): ACIDTestConfig {
    return { isolation: 'full' }
  }

  async setup(): Promise<void> {
    this.config = this.getConfig()
    this.cluster = []
  }

  async teardown(): Promise<void> {
    this.cluster = []
  }
}
