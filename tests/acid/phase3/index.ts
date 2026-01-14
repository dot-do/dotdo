/**
 * ACID Test Suite - Phase 3: Sharding Tests
 *
 * Re-exports all Phase 3 fixtures, mocks, and test utilities.
 * Import from this file for Phase 3 sharding tests.
 *
 * @example
 * ```ts
 * import {
 *   createMockShardCoordinator,
 *   LARGE_DATASET,
 *   hashRoute,
 * } from './index'
 * ```
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md - Phase 3 Sharding
 */

// ============================================================================
// FIXTURES RE-EXPORTS
// ============================================================================

export {
  // Types
  type ShardInfo,
  type ShardCoordinatorState,
  type RoutingTableEntry,
  type CrossShardResult,
  type UnshardConflict,
  type MockThing,

  // Dataset fixtures
  LARGE_DATASET,
  MEDIUM_DATASET,
  SMALL_DATASET,
  generateLargeDataset,

  // Shard registry fixtures
  SHARD_REGISTRY_4,
  SHARD_REGISTRY_8,

  // Partition fixtures
  HASH_PARTITIONS_4,
  ROUNDROBIN_PARTITIONS_4,
  RANGE_PARTITIONS_4,
  generateHashPartitions,
  generateRoundRobinPartitions,
  generateRangePartitions,

  // Range boundary fixtures
  RANGE_BOUNDARIES_4,
  RANGE_BOUNDARIES_8,

  // Conflict fixtures
  CONFLICTING_THINGS,

  // Coordinator state fixtures
  DEFAULT_COORDINATOR_STATE,
  ROUTING_TABLE_4,
  ROUTING_TABLE_4_RANGE,

  // Helper functions
  simpleHash,
  hashRoute,
  rangeRoute,
  verifyEvenDistribution,
  verifyNoDataLoss,
  findDuplicates,

  // Factory functions
  createCoordinatorState,
  createShardInfo,
  createCrossShardResult,
  createUnshardConflict,

  // Assertion helpers
  assertValidDistribution,
  assertDeterministicRouting,
  assertCrossShardSuccess,
} from '../fixtures/phase3'

// ============================================================================
// MOCK RE-EXPORTS
// ============================================================================

export {
  // Types
  type MockShardCoordinator,
  type MockShardStub,
  type MockCoordinatorOptions,
  type MockDistributedCoordinator,
  type MockCircuitBreaker,

  // Factory functions
  createMockShardCoordinator,
  createMockShardStub,
  createMockDistributedCoordinator,
  createMockCircuitBreaker,

  // Utility functions
  createCoordinatorWithData,
  simulateShardFailure,
  simulateShardRecovery,
  simulateLatency,
} from '../mocks/shard-coordinator'

// ============================================================================
// SHARED TEST HELPERS
// ============================================================================

import type { MockThing, ShardInfo, CrossShardResult } from '../fixtures/phase3'
import { createMockShardCoordinator, createMockShardStub } from '../mocks/shard-coordinator'

/**
 * Create a test harness for shard operation tests
 */
export function createShardTestHarness(options: {
  shardCount?: number
  thingCount?: number
  strategy?: 'hash' | 'range' | 'roundRobin' | 'custom'
} = {}) {
  const { shardCount = 4, thingCount = 100, strategy = 'hash' } = options

  // Generate test data
  const things: MockThing[] = Array.from({ length: thingCount }, (_, i) => ({
    id: `thing-${i.toString().padStart(4, '0')}`,
    type: 1,
    branch: null,
    name: `Thing ${i}`,
    data: { value: i },
    deleted: false,
    version: 1,
  }))

  // Create coordinator
  const coordinator = createMockShardCoordinator({
    shardCount,
    strategy,
  })

  // Create stubs with distributed data
  const stubs = new Map<number, ReturnType<typeof createMockShardStub>>()
  const distribution = new Map<number, MockThing[]>()

  // Initialize distribution
  for (let i = 0; i < shardCount; i++) {
    distribution.set(i, [])
  }

  // Distribute things
  for (const thing of things) {
    const shardIndex = coordinator.routeThing(thing)
    distribution.get(shardIndex)!.push(thing)
  }

  // Create stubs
  for (const shard of coordinator.getShards()) {
    const stub = createMockShardStub(shard, {
      things: distribution.get(shard.shardIndex) || [],
    })
    stubs.set(shard.shardIndex, stub)
  }

  return {
    things,
    coordinator,
    stubs,
    distribution,

    /** Get total thing count across all shards */
    getTotalCount(): number {
      let total = 0
      for (const shardThings of distribution.values()) {
        total += shardThings.length
      }
      return total
    },

    /** Verify distribution is valid */
    verifyDistribution(): { valid: boolean; issues: string[] } {
      const issues: string[] = []

      // Check total count
      const total = this.getTotalCount()
      if (total !== thingCount) {
        issues.push(`Total count mismatch: expected ${thingCount}, got ${total}`)
      }

      // Check for duplicates
      const seenIds = new Set<string>()
      for (const shardThings of distribution.values()) {
        for (const thing of shardThings) {
          if (seenIds.has(thing.id)) {
            issues.push(`Duplicate thing ID: ${thing.id}`)
          }
          seenIds.add(thing.id)
        }
      }

      // Check for missing things
      for (const thing of things) {
        if (!seenIds.has(thing.id)) {
          issues.push(`Missing thing ID: ${thing.id}`)
        }
      }

      return { valid: issues.length === 0, issues }
    },

    /** Execute scatter-gather query */
    async scatterGather<T>(
      query: (shardThings: MockThing[]) => T
    ): Promise<CrossShardResult<T>> {
      const start = Date.now()
      const shardResults = new Map<number, T>()
      const shardErrors = new Map<number, Error>()

      for (const [index, stub] of stubs) {
        try {
          const things = await stub.list()
          shardResults.set(index, query(things))
        } catch (error) {
          shardErrors.set(index, error as Error)
        }
      }

      let totalItems = 0
      for (const result of shardResults.values()) {
        if (Array.isArray(result)) {
          totalItems += result.length
        } else if (typeof result === 'number') {
          totalItems += result
        } else {
          totalItems += 1
        }
      }

      return {
        shardResults,
        shardErrors,
        totalItems,
        durationMs: Date.now() - start,
        hasErrors: shardErrors.size > 0,
      }
    },
  }
}

/**
 * Wait for condition with timeout
 */
export async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  options: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<boolean> {
  const { timeoutMs = 5000, intervalMs = 50 } = options
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    if (await condition()) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  return false
}

/**
 * Create mock shard events for testing event emission
 */
export function createMockShardEvents() {
  const events: Array<{ type: string; data: unknown; timestamp: Date }> = []

  return {
    events,

    emit(type: string, data: unknown): void {
      events.push({ type, data, timestamp: new Date() })
    },

    getByType(type: string): Array<{ type: string; data: unknown; timestamp: Date }> {
      return events.filter((e) => e.type === type)
    },

    clear(): void {
      events.length = 0
    },

    hasEvent(type: string): boolean {
      return events.some((e) => e.type === type)
    },

    getLatest(): { type: string; data: unknown; timestamp: Date } | undefined {
      return events[events.length - 1]
    },
  }
}

/**
 * Assert shard operation completed successfully with events
 */
export function assertShardOperationSuccess(
  events: ReturnType<typeof createMockShardEvents>,
  operationType: 'shard' | 'unshard',
  options: {
    expectedShardCount?: number
    expectedThingCount?: number
  } = {}
): void {
  const { expectedShardCount, expectedThingCount } = options

  // Check started event
  const startedEvents = events.getByType(`${operationType}.started`)
  if (startedEvents.length === 0) {
    throw new Error(`Expected ${operationType}.started event`)
  }

  // Check completed event
  const completedEvents = events.getByType(`${operationType}.completed`)
  if (completedEvents.length === 0) {
    throw new Error(`Expected ${operationType}.completed event`)
  }

  // Verify shard count if specified
  if (expectedShardCount !== undefined) {
    const completedData = completedEvents[0].data as Record<string, unknown>
    const actualCount = (completedData.shards as unknown[])?.length ?? completedData.shardCount
    if (actualCount !== expectedShardCount) {
      throw new Error(`Expected ${expectedShardCount} shards, got ${actualCount}`)
    }
  }

  // Verify thing count if specified
  if (expectedThingCount !== undefined) {
    const completedData = completedEvents[0].data as Record<string, unknown>
    const actualCount = completedData.thingsDistributed ?? completedData.totalThings
    if (actualCount !== expectedThingCount) {
      throw new Error(`Expected ${expectedThingCount} things, got ${actualCount}`)
    }
  }
}
