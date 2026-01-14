/**
 * ACID Test Context and Configuration
 *
 * Provides test configuration interfaces and a runtime context for ACID testing.
 * The context manages test isolation, network simulation, and DO lifecycle.
 *
 * @module testing/acid/context
 */

import type { ColoCode } from '../../types/acid/location'
import type { LifecycleEvent, LifecycleStatus } from '../../types/acid/lifecycle'
import type { MockDOResult, MockEnv, MockDurableObjectStorage } from '../../tests/harness/do'
import { createMockDO, createMockDONamespace } from '../../tests/harness/do'

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

/**
 * Isolation levels for ACID tests.
 *
 * - `none`: No isolation, tests share state (for performance testing)
 * - `storage`: Fresh storage per test, shared environment
 * - `full`: Complete isolation including environment bindings
 */
export type IsolationLevel = 'none' | 'storage' | 'full'

/**
 * Network simulation configuration.
 *
 * Allows simulating various network conditions for testing
 * resilience and edge cases.
 */
export interface NetworkConfig {
  /**
   * Fixed latency in milliseconds to add to all operations.
   * @default 0
   */
  latencyMs?: number

  /**
   * Random jitter in milliseconds (0 to jitterMs) added to latency.
   * @default 0
   */
  jitterMs?: number

  /**
   * Probability (0-1) of operations failing due to network issues.
   * @default 0
   */
  dropRate?: number
}

/**
 * Base configuration for ACID tests.
 *
 * Configures test isolation, network conditions, and timeouts.
 *
 * @example
 * ```typescript
 * const config: ACIDTestConfig = {
 *   isolation: 'full',
 *   network: {
 *     latencyMs: 10,
 *     jitterMs: 5,
 *   },
 *   timeout: 5000,
 * }
 * ```
 */
export interface ACIDTestConfig {
  /**
   * Test isolation level.
   * @default 'storage'
   */
  isolation: IsolationLevel

  /**
   * Simulated network conditions.
   */
  network?: NetworkConfig

  /**
   * Timeout in milliseconds for operations.
   * @default 5000
   */
  timeout?: number
}

// ============================================================================
// DO CREATION OPTIONS
// ============================================================================

/**
 * Options for creating test DOs within the ACID test context.
 */
export interface CreateDOOptions {
  /**
   * Namespace URL for the DO.
   * @default 'https://test.acid.do'
   */
  ns?: string

  /**
   * Target colo (datacenter) for DO placement.
   */
  colo?: ColoCode

  /**
   * Initial KV storage data.
   */
  storage?: Map<string, unknown>

  /**
   * Initial SQL table data by table name.
   */
  sqlData?: Map<string, unknown[]>
}

// ============================================================================
// TEST CONTEXT INTERFACE
// ============================================================================

/**
 * ACID test context provided to all tests.
 *
 * Provides utilities for creating DOs, simulating failures,
 * and tracking lifecycle events during tests.
 *
 * @example
 * ```typescript
 * describe('DO lifecycle', () => {
 *   let ctx: ACIDTestContext
 *
 *   beforeEach(() => {
 *     ctx = createACIDTestContext({ isolation: 'full' })
 *   })
 *
 *   afterEach(() => {
 *     ctx.cleanup()
 *   })
 *
 *   it('should handle crash and recovery', async () => {
 *     const { instance, id } = await ctx.createDO(MyDO)
 *     await instance.doSomething()
 *
 *     await ctx.crashAndRecover(id)
 *
 *     // Verify state persisted
 *     const history = await ctx.getHistory(id)
 *     expect(history).toHaveLength(1)
 *   })
 * })
 * ```
 */
export interface ACIDTestContext {
  /**
   * Configuration for this test context.
   */
  config: ACIDTestConfig

  /**
   * Create a fresh DO instance for testing.
   *
   * @param DOClass - The Durable Object class to instantiate
   * @param options - Optional creation options
   * @returns The DO instance with its ID and storage access
   */
  createDO<T extends new (...args: unknown[]) => InstanceType<T>>(
    DOClass: T,
    options?: CreateDOOptions
  ): Promise<DOTestInstance<InstanceType<T>>>

  /**
   * Create multiple DOs for cross-DO tests.
   *
   * @param DOClass - The Durable Object class to instantiate
   * @param count - Number of DOs to create
   * @returns Array of DO instances
   */
  createDOCluster<T extends new (...args: unknown[]) => InstanceType<T>>(
    DOClass: T,
    count: number
  ): Promise<DOTestInstance<InstanceType<T>>[]>

  /**
   * Simulate a network partition between specified DOs.
   *
   * While partitioned, cross-DO calls will fail with network errors.
   *
   * @param doIds - IDs of DOs to isolate from each other
   */
  partition(doIds: string[]): Promise<void>

  /**
   * Heal a previous network partition, restoring connectivity.
   */
  heal(): Promise<void>

  /**
   * Simulate DO crash and recovery.
   *
   * This clears in-memory state while preserving durable storage,
   * then recreates the DO instance.
   *
   * @param doId - ID of the DO to crash and recover
   */
  crashAndRecover(doId: string): Promise<void>

  /**
   * Get lifecycle event history for a DO.
   *
   * @param doId - ID of the DO
   * @returns Array of lifecycle events
   */
  getHistory(doId: string): Promise<LifecycleEvent[]>

  /**
   * Record a lifecycle event for tracking.
   *
   * @param doId - ID of the DO
   * @param event - The lifecycle event to record
   */
  recordEvent(doId: string, event: LifecycleEvent): void

  /**
   * Update lifecycle event status.
   *
   * @param doId - ID of the DO
   * @param eventIndex - Index of the event to update
   * @param status - New status
   * @param error - Optional error message for failed status
   */
  updateEventStatus(
    doId: string,
    eventIndex: number,
    status: LifecycleStatus,
    error?: string
  ): void

  /**
   * Clean up all resources created during the test.
   */
  cleanup(): void
}

/**
 * A DO instance created by the test context with additional metadata.
 */
export interface DOTestInstance<T> {
  /** The DO instance */
  instance: T
  /** The DO's unique identifier */
  id: string
  /** Direct access to mock storage */
  storage: MockDurableObjectStorage
  /** SQL data tables */
  sqlData: Map<string, unknown[]>
  /** Full mock result for advanced usage */
  mockResult: MockDOResult<T, MockEnv>
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

/**
 * Internal state for a test context.
 */
interface ContextState {
  dos: Map<string, DOTestInstance<unknown>>
  events: Map<string, LifecycleEvent[]>
  partitionedIds: Set<string>
  idCounter: number
}

/**
 * Create an ACID test context.
 *
 * @param config - Test configuration
 * @returns Initialized test context
 *
 * @example
 * ```typescript
 * const ctx = createACIDTestContext({
 *   isolation: 'full',
 *   network: { latencyMs: 10 },
 *   timeout: 5000,
 * })
 *
 * const { instance, id } = await ctx.createDO(MyDO)
 * // ... run tests
 * ctx.cleanup()
 * ```
 */
export function createACIDTestContext(
  config: Partial<ACIDTestConfig> = {}
): ACIDTestContext {
  const fullConfig: ACIDTestConfig = {
    isolation: config.isolation ?? 'storage',
    network: config.network,
    timeout: config.timeout ?? 5000,
  }

  const state: ContextState = {
    dos: new Map(),
    events: new Map(),
    partitionedIds: new Set(),
    idCounter: 0,
  }

  /**
   * Apply network simulation delay if configured.
   */
  async function applyNetworkDelay(): Promise<void> {
    if (!fullConfig.network) return

    const { latencyMs = 0, jitterMs = 0, dropRate = 0 } = fullConfig.network

    // Check for simulated network failure
    if (dropRate > 0 && Math.random() < dropRate) {
      throw new Error('Network request failed (simulated)')
    }

    // Apply latency + jitter
    const totalDelay = latencyMs + Math.random() * jitterMs
    if (totalDelay > 0) {
      await new Promise((resolve) => setTimeout(resolve, totalDelay))
    }
  }

  return {
    config: fullConfig,

    async createDO<T extends new (...args: unknown[]) => InstanceType<T>>(
      DOClass: T,
      options: CreateDOOptions = {}
    ): Promise<DOTestInstance<InstanceType<T>>> {
      await applyNetworkDelay()

      const id = `do-${state.idCounter++}`
      const mockResult = createMockDO(DOClass, {
        id,
        ns: options.ns ?? 'https://test.acid.do',
        storage: options.storage,
        sqlData: options.sqlData,
      })

      const testInstance: DOTestInstance<InstanceType<T>> = {
        instance: mockResult.instance,
        id,
        storage: mockResult.storage,
        sqlData: mockResult.sqlData,
        mockResult,
      }

      state.dos.set(id, testInstance as DOTestInstance<unknown>)
      state.events.set(id, [])

      return testInstance
    },

    async createDOCluster<T extends new (...args: unknown[]) => InstanceType<T>>(
      DOClass: T,
      count: number
    ): Promise<DOTestInstance<InstanceType<T>>[]> {
      const instances: DOTestInstance<InstanceType<T>>[] = []

      for (let i = 0; i < count; i++) {
        const instance = await this.createDO(DOClass)
        instances.push(instance)
      }

      return instances
    },

    async partition(doIds: string[]): Promise<void> {
      await applyNetworkDelay()

      for (const id of doIds) {
        state.partitionedIds.add(id)
      }
    },

    async heal(): Promise<void> {
      await applyNetworkDelay()

      state.partitionedIds.clear()
    },

    async crashAndRecover(doId: string): Promise<void> {
      await applyNetworkDelay()

      const existing = state.dos.get(doId)
      if (!existing) {
        throw new Error(`DO not found: ${doId}`)
      }

      // Preserve storage and SQL data (durable state)
      const preservedStorage = new Map(existing.storage.data)
      const preservedSqlData = new Map(existing.sqlData)

      // Get the DO class from the existing instance
      const DOClass = Object.getPrototypeOf(existing.instance).constructor

      // Recreate the DO with preserved storage
      const mockResult = createMockDO(DOClass, {
        id: doId,
        storage: preservedStorage,
        sqlData: preservedSqlData,
      })

      const newInstance: DOTestInstance<unknown> = {
        instance: mockResult.instance,
        id: doId,
        storage: mockResult.storage,
        sqlData: mockResult.sqlData,
        mockResult,
      }

      state.dos.set(doId, newInstance)
    },

    async getHistory(doId: string): Promise<LifecycleEvent[]> {
      await applyNetworkDelay()

      return state.events.get(doId) ?? []
    },

    recordEvent(doId: string, event: LifecycleEvent): void {
      const events = state.events.get(doId) ?? []
      events.push(event)
      state.events.set(doId, events)
    },

    updateEventStatus(
      doId: string,
      eventIndex: number,
      status: LifecycleStatus,
      error?: string
    ): void {
      const events = state.events.get(doId)
      if (!events || eventIndex >= events.length) {
        throw new Error(`Event not found: ${doId}[${eventIndex}]`)
      }

      events[eventIndex] = {
        ...events[eventIndex]!,
        status,
        completedAt: status === 'completed' || status === 'failed' ? new Date() : undefined,
        error,
      }
    },

    cleanup(): void {
      state.dos.clear()
      state.events.clear()
      state.partitionedIds.clear()
      state.idCounter = 0
    },
  }
}

/**
 * Default ACID test context factory for common use cases.
 */
export const defaultACIDTestConfig: ACIDTestConfig = {
  isolation: 'storage',
  timeout: 5000,
}
