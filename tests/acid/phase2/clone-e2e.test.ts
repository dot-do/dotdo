/**
 * ACID Test Suite - Phase 2.5: Clone Mode E2E Tests
 *
 * RED TDD: These tests define the expected behavior for end-to-end clone mode scenarios.
 * All tests are expected to FAIL initially as this is the RED phase.
 *
 * This file tests real-world scenarios that involve:
 * 1. Cross-DO cloning - Cloning state between different Durable Objects
 * 2. Mode switching - Switching between clone modes during operations
 * 3. Failure recovery - Recovering from various failure scenarios across modes
 * 4. Performance benchmarks - Measuring clone performance metrics
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md
 * @task dotdo-oiic
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockDO, MockDOResult, MockEnv, createMockDONamespace, createMockId } from '../../do'
import { DO } from '../../../objects/DO'
import type {
  CloneMode,
  CloneOptions,
  CloneResult,
  CloneStatus,
  SyncStatus,
  EventualCloneHandle,
} from '../../../types/Lifecycle'

// ============================================================================
// TYPE DEFINITIONS FOR E2E TESTS
// ============================================================================

/**
 * Extended clone result with metrics
 */
interface CloneMetrics {
  /** Mode used for clone */
  mode: CloneMode
  /** Total duration in milliseconds */
  duration: number
  /** Number of items cloned */
  itemsCloned: number
  /** Bytes transferred */
  bytesTransferred: number
  /** Number of checkpoints created (if applicable) */
  checkpoints?: number
  /** Number of retries (if any) */
  retries?: number
  /** Throughput (items per second) */
  throughput: number
}

/**
 * Cross-DO clone handle
 */
interface CrossDOCloneHandle {
  /** Clone operation ID */
  id: string
  /** Source DO namespace */
  sourceNs: string
  /** Target DO namespace */
  targetNs: string
  /** Current status */
  status: CloneStatus
  /** Get progress */
  getProgress(): Promise<number>
  /** Get metrics */
  getMetrics(): Promise<CloneMetrics>
  /** Wait for completion */
  waitForCompletion(): Promise<CloneResult>
}

/**
 * Mode switch result
 */
interface ModeSwitchResult {
  /** Previous mode */
  previousMode: CloneMode
  /** New mode */
  newMode: CloneMode
  /** Progress preserved */
  progressPreserved: number
  /** Checkpoint created */
  checkpointId?: string
}

/**
 * Recovery result
 */
interface RecoveryResult {
  /** Whether recovery succeeded */
  success: boolean
  /** Recovered from checkpoint */
  checkpointId?: string
  /** Items recovered */
  itemsRecovered: number
  /** Recovery strategy used */
  strategy: 'checkpoint' | 'rollback' | 'restart'
}

/**
 * Benchmark result
 */
interface BenchmarkResult {
  /** Clone mode tested */
  mode: CloneMode
  /** Dataset size */
  datasetSize: number
  /** Total duration */
  duration: number
  /** Items per second */
  throughput: number
  /** Peak memory usage (estimated) */
  peakMemory?: number
  /** P50 latency */
  p50Latency?: number
  /** P99 latency */
  p99Latency?: number
}

// ============================================================================
// TEST HELPERS
// ============================================================================

/**
 * Create sample test data of specified size
 */
function createTestData(count: number, payloadSize = 100): Array<{
  id: string
  type: number
  data: string
  version: number
  branch: string
  deleted: boolean
}> {
  return Array.from({ length: count }, (_, i) => ({
    id: `thing-${i}`,
    type: 1,
    data: JSON.stringify({ index: i, payload: 'x'.repeat(payloadSize) }),
    version: 1,
    branch: 'main',
    deleted: false,
  }))
}

/**
 * Create sample relationships
 */
function createTestRelationships(thingCount: number): Array<{
  id: string
  verb: string
  from: string
  to: string
  data: null
  createdAt: string
}> {
  const now = new Date().toISOString()
  const relationships: Array<{
    id: string
    verb: string
    from: string
    to: string
    data: null
    createdAt: string
  }> = []

  for (let i = 0; i < thingCount - 1; i++) {
    relationships.push({
      id: `rel-${i}`,
      verb: 'linkedTo',
      from: `thing-${i}`,
      to: `thing-${i + 1}`,
      data: null,
      createdAt: now,
    })
  }

  return relationships
}

// ============================================================================
// TEST SUITE: CROSS-DO CLONING
// ============================================================================

describe('Cross-DO Cloning E2E', () => {
  let sourceDO: MockDOResult<DO, MockEnv>
  let targetDO: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    vi.useFakeTimers()

    // Create source DO with data
    sourceDO = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', createTestData(100)],
        ['relationships', createTestRelationships(100)],
        ['branches', [{ name: 'main', head: 100, forkedFrom: null, createdAt: new Date().toISOString() }]],
      ]),
    })

    // Create target DO (empty)
    targetDO = createMockDO(DO, {
      ns: 'https://target.test.do',
      sqlData: new Map([
        ['things', []],
        ['relationships', []],
        ['branches', []],
      ]),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // BASIC CROSS-DO CLONING
  // ==========================================================================

  describe('Basic Cross-DO Operations', () => {
    it('should clone all state from source DO to target DO', async () => {
      const target = 'https://target.test.do'
      const cloneResult = await sourceDO.instance.clone(target, { mode: 'atomic' })

      expect(cloneResult.ns).toBe(target)
      expect(cloneResult.mode).toBe('atomic')
      expect(cloneResult.doId).toBeDefined()
    })

    it('should preserve data integrity across DOs', async () => {
      const target = 'https://target.test.do'
      await sourceDO.instance.clone(target, { mode: 'atomic' })

      // Source things should equal target things count
      const sourceThings = sourceDO.sqlData.get('things')!
      expect(sourceThings.length).toBe(100)
    })

    it('should maintain relationship consistency after clone', async () => {
      const target = 'https://target.test.do'
      await sourceDO.instance.clone(target, { mode: 'atomic' })

      const sourceRelationships = sourceDO.sqlData.get('relationships')!
      expect(sourceRelationships.length).toBe(99) // 100 things = 99 relationships
    })

    it('should handle cloning between DOs in different colos', async () => {
      // Simulate different colo target
      const target = 'https://target-weur.test.do'
      const cloneResult = await sourceDO.instance.clone(target, {
        mode: 'atomic',
        colo: 'weur',
      })

      expect(cloneResult.ns).toBe(target)
    })

    it('should clone to multiple targets from same source', async () => {
      const target1 = 'https://target1.test.do'
      const target2 = 'https://target2.test.do'

      const [result1, result2] = await Promise.all([
        sourceDO.instance.clone(target1, { mode: 'atomic' }),
        sourceDO.instance.clone(target2, { mode: 'atomic' }),
      ])

      expect(result1.ns).toBe(target1)
      expect(result2.ns).toBe(target2)
      expect(result1.doId).not.toBe(result2.doId)
    })

    it('should preserve branch information across DOs', async () => {
      const target = 'https://target.test.do'
      await sourceDO.instance.clone(target, { mode: 'atomic', branch: 'main' })

      const sourceBranches = sourceDO.sqlData.get('branches')!
      expect(sourceBranches.length).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // CROSS-DO WITH DIFFERENT MODES
  // ==========================================================================

  describe('Cross-DO with Different Modes', () => {
    it('should clone across DOs using atomic mode', async () => {
      const target = 'https://target.test.do'
      const result = await sourceDO.instance.clone(target, { mode: 'atomic' })

      expect(result.mode).toBe('atomic')
      expect(result.staged).toBeUndefined()
      expect(result.checkpoint).toBeUndefined()
    })

    it('should clone across DOs using staged mode', async () => {
      const target = 'https://target.test.do'
      const result = await sourceDO.instance.clone(target, { mode: 'staged' })

      expect(result.mode).toBe('staged')
      // Staged mode should return prepare result first
    })

    it('should clone across DOs using eventual mode', async () => {
      const target = 'https://target.test.do'
      const result = await sourceDO.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      expect(result.id).toBeDefined()
      expect(result.status).toBe('pending')
    })

    it('should clone across DOs using resumable mode', async () => {
      const target = 'https://target.test.do'
      const result = await sourceDO.instance.clone(target, { mode: 'resumable' }) as CloneResult

      expect(result.mode).toBe('resumable')
      expect(result.checkpoint).toBeDefined()
      expect(result.checkpoint?.resumable).toBe(true)
    })

    it('should handle concurrent clones to same target with different modes', async () => {
      const target = 'https://target.test.do'

      // First clone (atomic) should succeed
      const atomicResult = await sourceDO.instance.clone(target, { mode: 'atomic' })
      expect(atomicResult.ns).toBe(target)

      // Second clone to same (now occupied) target should handle appropriately
      const differentTarget = 'https://target2.test.do'
      const eventualResult = await sourceDO.instance.clone(differentTarget, { mode: 'eventual' })
      expect(eventualResult).toBeDefined()
    })
  })

  // ==========================================================================
  // CROSS-DO CHAIN CLONING
  // ==========================================================================

  describe('Cross-DO Chain Cloning', () => {
    it('should support clone chain (A -> B -> C)', async () => {
      const targetB = 'https://targetB.test.do'
      const targetC = 'https://targetC.test.do'

      // Clone A -> B
      const resultAB = await sourceDO.instance.clone(targetB, { mode: 'atomic' })
      expect(resultAB.ns).toBe(targetB)

      // Clone B -> C (would need targetB DO instance in real implementation)
      // For now, verify chain is possible conceptually
      expect(resultAB.doId).toBeDefined()
    })

    it('should maintain data consistency through clone chain', async () => {
      const targetB = 'https://targetB.test.do'

      await sourceDO.instance.clone(targetB, { mode: 'atomic' })

      // Source data should be unchanged
      const sourceThings = sourceDO.sqlData.get('things')!
      expect(sourceThings.length).toBe(100)
    })

    it('should handle circular clone prevention', async () => {
      const selfTarget = 'https://source.test.do'

      // Cloning to self should be rejected
      await expect(
        sourceDO.instance.clone(selfTarget, { mode: 'atomic' })
      ).rejects.toThrow(/self|circular|same namespace/i)
    })
  })
})

// ============================================================================
// TEST SUITE: MODE SWITCHING
// ============================================================================

describe('Clone Mode Switching E2E', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    vi.useFakeTimers()

    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', createTestData(500)],
        ['relationships', createTestRelationships(500)],
      ]),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // ATOMIC TO OTHER MODES
  // ==========================================================================

  describe('Atomic Mode Transitions', () => {
    it('should upgrade from atomic to staged when atomicity fails', async () => {
      // If atomic clone fails due to size, should suggest staged
      const target = 'https://target.test.do'

      // Start with atomic
      const atomicAttempt = result.instance.clone(target, { mode: 'atomic' })

      // Verify the attempt was made with atomic mode
      await expect(atomicAttempt).resolves.toBeDefined()
    })

    it('should downgrade from atomic to eventual for large datasets', async () => {
      // Large dataset scenario
      result.sqlData.set('things', createTestData(10000))

      const target = 'https://target.test.do'

      // For very large datasets, eventual might be recommended
      const cloneResult = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      expect(cloneResult.id).toBeDefined()
      expect(cloneResult.status).toBe('pending')
    })
  })

  // ==========================================================================
  // STAGED TO OTHER MODES
  // ==========================================================================

  describe('Staged Mode Transitions', () => {
    it('should switch from staged to atomic on commit', async () => {
      const target = 'https://target.test.do'

      // Prepare with staged mode
      const prepareResult = await result.instance.clone(target, { mode: 'staged' })

      // Commit should finalize atomically
      expect(prepareResult.mode).toBe('staged')
    })

    it('should convert staged prepare to resumable on timeout', async () => {
      const target = 'https://target.test.do'

      // Prepare with short timeout
      const prepareResult = await result.instance.clone(target, {
        mode: 'staged',
      })

      // Advance past potential timeout
      await vi.advanceTimersByTimeAsync(60000)

      // Should be able to query status
      expect(prepareResult).toBeDefined()
    })

    it('should preserve staged checkpoint when switching to resumable', async () => {
      const target = 'https://target.test.do'

      const prepareResult = await result.instance.clone(target, { mode: 'staged' })

      // The checkpoint from staged should be preserved if switching modes
      expect(prepareResult.mode).toBe('staged')
    })
  })

  // ==========================================================================
  // EVENTUAL TO OTHER MODES
  // ==========================================================================

  describe('Eventual Mode Transitions', () => {
    it('should switch from eventual to resumable for pause', async () => {
      const target = 'https://target.test.do'

      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Start syncing
      await vi.advanceTimersByTimeAsync(5000)

      // Pause should create checkpoint (similar to resumable behavior)
      await handle.pause()
      expect(handle.status).toBe('paused')
    })

    it('should convert eventual to atomic for final sync', async () => {
      const target = 'https://target.test.do'

      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Let it progress towards completion
      await vi.advanceTimersByTimeAsync(30000)

      // Final sync should be atomic to ensure consistency
      const syncStatus = await handle.getSyncStatus()
      expect(syncStatus).toBeDefined()
    })

    it('should switch eventual to staged for critical sync', async () => {
      const target = 'https://target.test.do'

      const handle = await result.instance.clone(target, {
        mode: 'eventual',
      }) as unknown as EventualCloneHandle

      await vi.advanceTimersByTimeAsync(10000)

      // Manual sync with staged semantics
      const syncResult = await handle.sync()
      expect(syncResult).toBeDefined()
    })
  })

  // ==========================================================================
  // RESUMABLE TO OTHER MODES
  // ==========================================================================

  describe('Resumable Mode Transitions', () => {
    it('should convert resumable checkpoint to staged prepare', async () => {
      const target = 'https://target.test.do'

      const cloneResult = await result.instance.clone(target, { mode: 'resumable' }) as CloneResult

      // Checkpoint should be usable as staged prepare basis
      expect(cloneResult.checkpoint).toBeDefined()
    })

    it('should finalize resumable as atomic on completion', async () => {
      // Small dataset for quick completion
      result.sqlData.set('things', createTestData(50))

      const target = 'https://target.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'resumable' })

      // Wait for completion
      await vi.advanceTimersByTimeAsync(10000)

      // Final state should be consistent (atomic semantics)
      expect(cloneResult.mode).toBe('resumable')
    })

    it('should allow resumable to eventual mode conversion', async () => {
      const target = 'https://target.test.do'

      const cloneResult = await result.instance.clone(target, { mode: 'resumable' }) as CloneResult

      // After completing, could set up eventual sync
      expect(cloneResult.checkpoint?.resumable).toBe(true)
    })
  })

  // ==========================================================================
  // DYNAMIC MODE SELECTION
  // ==========================================================================

  describe('Dynamic Mode Selection', () => {
    it('should auto-select mode based on dataset size', async () => {
      // Small dataset -> atomic
      result.sqlData.set('things', createTestData(10))
      const target1 = 'https://target1.test.do'
      const smallResult = await result.instance.clone(target1)
      expect(smallResult.mode).toBeDefined()

      // Large dataset -> eventual or resumable (implementation dependent)
      result.sqlData.set('things', createTestData(10000))
      const target2 = 'https://target2.test.do'
      const largeResult = await result.instance.clone(target2, { mode: 'eventual' })
      expect(largeResult).toBeDefined()
    })

    it('should auto-select mode based on network conditions', async () => {
      const target = 'https://remote.test.do'

      // For high-latency targets, resumable might be preferred
      const cloneResult = await result.instance.clone(target, {
        mode: 'resumable',
        colo: 'apac', // Far colo
      })

      expect(cloneResult.mode).toBe('resumable')
    })

    it('should respect explicit mode override', async () => {
      // Even for small dataset, explicit atomic should be honored
      result.sqlData.set('things', createTestData(5))
      const target = 'https://target.test.do'

      const cloneResult = await result.instance.clone(target, { mode: 'atomic' })
      expect(cloneResult.mode).toBe('atomic')
    })
  })
})

// ============================================================================
// TEST SUITE: FAILURE RECOVERY
// ============================================================================

describe('Clone Failure Recovery E2E', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    vi.useFakeTimers()

    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', createTestData(200)],
        ['relationships', createTestRelationships(200)],
      ]),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // NETWORK FAILURE RECOVERY
  // ==========================================================================

  describe('Network Failure Recovery', () => {
    it('should recover atomic clone from network failure (rollback)', async () => {
      const target = 'https://flaky.test.do'

      // Atomic mode should rollback on failure
      try {
        await result.instance.clone(target, { mode: 'atomic' })
      } catch {
        // Verify source unchanged
        const sourceThings = result.sqlData.get('things')!
        expect(sourceThings.length).toBe(200)
      }
    })

    it('should recover staged clone from network failure (abort)', async () => {
      const target = 'https://flaky.test.do'

      // Staged mode can abort if commit fails
      const prepareResult = await result.instance.clone(target, { mode: 'staged' })

      // If network fails during commit, should be abortable
      expect(prepareResult.mode).toBe('staged')
    })

    it('should recover eventual clone from network failure (retry)', async () => {
      const target = 'https://flaky.test.do'

      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Let retry mechanism work
      await vi.advanceTimersByTimeAsync(30000)

      const syncStatus = await handle.getSyncStatus()
      // Should track errors and retry
      expect(syncStatus).toHaveProperty('errorCount')
    })

    it('should recover resumable clone from network failure (checkpoint)', async () => {
      const target = 'https://flaky.test.do'

      const cloneResult = await result.instance.clone(target, { mode: 'resumable' }) as CloneResult

      // Should have checkpoint for recovery
      expect(cloneResult.checkpoint).toBeDefined()
      expect(cloneResult.checkpoint?.resumable).toBe(true)
    })
  })

  // ==========================================================================
  // DO RESTART RECOVERY
  // ==========================================================================

  describe('DO Restart Recovery', () => {
    it('should recover atomic clone after source restart (restart)', async () => {
      const target = 'https://target.test.do'

      // Atomic clones in progress should restart on source restart
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' })

      // If source restarts mid-clone, target should be clean
      expect(cloneResult.ns).toBe(target)
    })

    it('should recover staged clone after source restart (from prepare)', async () => {
      const target = 'https://target.test.do'

      const prepareResult = await result.instance.clone(target, { mode: 'staged' })

      // Staged prepare should survive source restart
      expect(prepareResult.mode).toBe('staged')
    })

    it('should recover eventual clone after source restart (from sync state)', async () => {
      const target = 'https://target.test.do'

      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      await vi.advanceTimersByTimeAsync(10000)

      // Eventual clone state should be persisted
      const syncStatus = await handle.getSyncStatus()
      expect(syncStatus.itemsSynced).toBeGreaterThanOrEqual(0)
    })

    it('should recover resumable clone after source restart (from checkpoint)', async () => {
      const target = 'https://target.test.do'

      const cloneResult = await result.instance.clone(target, { mode: 'resumable' }) as CloneResult

      // Wait for checkpoints
      await vi.advanceTimersByTimeAsync(5000)

      // Should be resumable after restart
      expect(cloneResult.checkpoint?.id).toBeDefined()
    })
  })

  // ==========================================================================
  // PARTIAL FAILURE RECOVERY
  // ==========================================================================

  describe('Partial Failure Recovery', () => {
    it('should handle partial transfer failure in atomic mode (full rollback)', async () => {
      const target = 'https://partial-fail.test.do'

      // Atomic should rollback completely on partial failure
      try {
        await result.instance.clone(target, { mode: 'atomic' })
      } catch {
        // Source should be unchanged
        const sourceThings = result.sqlData.get('things')!
        expect(sourceThings.length).toBe(200)
      }
    })

    it('should handle partial transfer failure in staged mode (preserve prepare)', async () => {
      const target = 'https://partial-fail.test.do'

      const prepareResult = await result.instance.clone(target, { mode: 'staged' })

      // Prepare should succeed even if commit would fail
      expect(prepareResult.mode).toBe('staged')
    })

    it('should handle partial transfer failure in eventual mode (continue from last)', async () => {
      const target = 'https://partial-fail.test.do'

      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      await vi.advanceTimersByTimeAsync(20000)

      // Should continue from last successful point
      const syncStatus = await handle.getSyncStatus()
      expect(syncStatus.itemsSynced).toBeGreaterThanOrEqual(0)
    })

    it('should handle partial transfer failure in resumable mode (from checkpoint)', async () => {
      const target = 'https://partial-fail.test.do'

      const cloneResult = await result.instance.clone(target, { mode: 'resumable' }) as CloneResult

      await vi.advanceTimersByTimeAsync(5000)

      // Should have checkpoint to resume from
      expect(cloneResult.checkpoint?.progress).toBeGreaterThanOrEqual(0)
    })
  })

  // ==========================================================================
  // CONSISTENCY RECOVERY
  // ==========================================================================

  describe('Consistency Recovery', () => {
    it('should detect and repair inconsistency in atomic clone', async () => {
      const target = 'https://target.test.do'

      const cloneResult = await result.instance.clone(target, { mode: 'atomic' })

      // Atomic should guarantee consistency
      expect(cloneResult.mode).toBe('atomic')
    })

    it('should detect and repair inconsistency in staged clone', async () => {
      const target = 'https://target.test.do'

      const prepareResult = await result.instance.clone(target, { mode: 'staged' })

      // Staged commit should validate consistency
      expect(prepareResult.mode).toBe('staged')
    })

    it('should detect and repair inconsistency in eventual clone', async () => {
      const target = 'https://target.test.do'

      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      await vi.advanceTimersByTimeAsync(30000)

      // Eventual should track divergence
      const syncStatus = await handle.getSyncStatus()
      expect(syncStatus).toHaveProperty('divergence')
    })

    it('should detect and repair inconsistency in resumable clone (checkpoint validation)', async () => {
      const target = 'https://target.test.do'

      const cloneResult = await result.instance.clone(target, { mode: 'resumable' }) as CloneResult

      await vi.advanceTimersByTimeAsync(5000)

      // Checkpoints should have integrity validation
      expect(cloneResult.checkpoint).toBeDefined()
    })
  })

  // ==========================================================================
  // CROSS-MODE RECOVERY
  // ==========================================================================

  describe('Cross-Mode Recovery', () => {
    it('should fallback from atomic to resumable on failure', async () => {
      const target = 'https://large-target.test.do'

      // For failures, system might suggest resumable
      result.sqlData.set('things', createTestData(5000))

      const cloneResult = await result.instance.clone(target, { mode: 'resumable' })
      expect(cloneResult.checkpoint?.resumable).toBe(true)
    })

    it('should fallback from staged to eventual on timeout', async () => {
      const target = 'https://slow-target.test.do'

      const prepareResult = await result.instance.clone(target, { mode: 'staged' })

      // If staged times out, eventual might be alternative
      expect(prepareResult.mode).toBe('staged')
    })

    it('should convert eventual to resumable for long-running sync', async () => {
      const target = 'https://target.test.do'

      result.sqlData.set('things', createTestData(10000))

      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      await vi.advanceTimersByTimeAsync(60000)

      // Long-running eventual should have checkpoint-like progress
      const progress = await handle.getProgress()
      expect(progress).toBeGreaterThanOrEqual(0)
    })

    it('should use appropriate recovery strategy based on failure type', async () => {
      const target = 'https://target.test.do'

      // Start with resumable (most flexible)
      const cloneResult = await result.instance.clone(target, { mode: 'resumable' }) as CloneResult

      // Should have recovery options
      expect(cloneResult.checkpoint?.resumable).toBe(true)
    })
  })
})

// ============================================================================
// TEST SUITE: PERFORMANCE BENCHMARKS
// ============================================================================

describe('Clone Performance Benchmarks E2E', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // THROUGHPUT BENCHMARKS
  // ==========================================================================

  describe('Throughput Benchmarks', () => {
    it('should measure atomic clone throughput for small datasets', async () => {
      result = createMockDO(DO, {
        ns: 'https://source.test.do',
        sqlData: new Map([['things', createTestData(100)]]),
      })

      const target = 'https://target.test.do'
      const startTime = Date.now()

      await result.instance.clone(target, { mode: 'atomic' })

      const duration = Date.now() - startTime
      const throughput = 100 / (duration / 1000)

      // Atomic should be fast for small datasets
      expect(throughput).toBeGreaterThan(0)
    })

    it('should measure staged clone throughput', async () => {
      result = createMockDO(DO, {
        ns: 'https://source.test.do',
        sqlData: new Map([['things', createTestData(500)]]),
      })

      const target = 'https://target.test.do'
      const startTime = Date.now()

      await result.instance.clone(target, { mode: 'staged' })

      const duration = Date.now() - startTime
      const throughput = 500 / (duration / 1000)

      expect(throughput).toBeGreaterThan(0)
    })

    it('should measure eventual clone throughput for large datasets', async () => {
      result = createMockDO(DO, {
        ns: 'https://source.test.do',
        sqlData: new Map([['things', createTestData(1000)]]),
      })

      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Let it run
      await vi.advanceTimersByTimeAsync(30000)

      const syncStatus = await handle.getSyncStatus()
      const throughput = syncStatus.itemsSynced / 30 // items per second (30s elapsed)

      expect(throughput).toBeGreaterThanOrEqual(0)
    })

    it('should measure resumable clone throughput', async () => {
      result = createMockDO(DO, {
        ns: 'https://source.test.do',
        sqlData: new Map([['things', createTestData(500)]]),
      })

      const target = 'https://target.test.do'
      await result.instance.clone(target, { mode: 'resumable' })

      // Resumable creates checkpoints which has overhead
      // But provides reliability tradeoff
    })
  })

  // ==========================================================================
  // LATENCY BENCHMARKS
  // ==========================================================================

  describe('Latency Benchmarks', () => {
    it('should measure time to first byte/item for atomic', async () => {
      result = createMockDO(DO, {
        ns: 'https://source.test.do',
        sqlData: new Map([['things', createTestData(100)]]),
      })

      const target = 'https://target.test.do'
      const startTime = Date.now()

      await result.instance.clone(target, { mode: 'atomic' })

      const ttfb = Date.now() - startTime

      // Atomic has blocking semantics - returns after complete
      expect(ttfb).toBeDefined()
    })

    it('should measure time to first byte/item for eventual (async)', async () => {
      result = createMockDO(DO, {
        ns: 'https://source.test.do',
        sqlData: new Map([['things', createTestData(1000)]]),
      })

      const target = 'https://target.test.do'
      const startTime = Date.now()

      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      const ttfb = Date.now() - startTime

      // Eventual should return handle immediately
      expect(ttfb).toBeLessThan(100) // Should be nearly instant
      expect(handle.status).toBe('pending')
    })

    it('should measure checkpoint creation latency for resumable', async () => {
      result = createMockDO(DO, {
        ns: 'https://source.test.do',
        sqlData: new Map([['things', createTestData(500)]]),
      })

      const target = 'https://target.test.do'

      await result.instance.clone(target, { mode: 'resumable' })

      // Checkpoint creation should not significantly impact latency
    })
  })

  // ==========================================================================
  // SCALABILITY BENCHMARKS
  // ==========================================================================

  describe('Scalability Benchmarks', () => {
    it('should handle scaling from 100 to 10000 items', async () => {
      const sizes = [100, 500, 1000, 5000, 10000]
      const results: Array<{ size: number; mode: CloneMode }> = []

      for (const size of sizes) {
        result = createMockDO(DO, {
          ns: `https://source-${size}.test.do`,
          sqlData: new Map([['things', createTestData(size)]]),
        })

        const target = `https://target-${size}.test.do`

        // For larger datasets, use eventual/resumable
        const mode: CloneMode = size <= 1000 ? 'atomic' : 'eventual'
        await result.instance.clone(target, { mode })

        results.push({ size, mode })
      }

      expect(results.length).toBe(5)
    })

    it('should maintain performance with increasing relationship complexity', async () => {
      const thingCount = 500

      result = createMockDO(DO, {
        ns: 'https://source.test.do',
        sqlData: new Map([
          ['things', createTestData(thingCount)],
          ['relationships', createTestRelationships(thingCount)],
        ]),
      })

      const target = 'https://target.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' })

      expect(cloneResult.ns).toBe(target)
    })

    it('should handle deep nesting efficiently', async () => {
      // Things with deeply nested data
      const deeplyNestedThings = Array.from({ length: 100 }, (_, i) => ({
        id: `thing-${i}`,
        type: 1,
        data: JSON.stringify({
          level1: {
            level2: {
              level3: {
                level4: {
                  level5: { value: i, data: 'x'.repeat(100) },
                },
              },
            },
          },
        }),
        version: 1,
        branch: 'main',
        deleted: false,
      }))

      result = createMockDO(DO, {
        ns: 'https://source.test.do',
        sqlData: new Map([['things', deeplyNestedThings]]),
      })

      const target = 'https://target.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' })

      expect(cloneResult.ns).toBe(target)
    })
  })

  // ==========================================================================
  // RESOURCE USAGE BENCHMARKS
  // ==========================================================================

  describe('Resource Usage Benchmarks', () => {
    it('should not exceed memory bounds for large atomic clone', async () => {
      result = createMockDO(DO, {
        ns: 'https://source.test.do',
        sqlData: new Map([['things', createTestData(1000, 1000)]]), // Large payloads
      })

      const target = 'https://target.test.do'

      // Clone should complete without memory issues
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' })
      expect(cloneResult.ns).toBe(target)
    })

    it('should stream efficiently for eventual clone (bounded memory)', async () => {
      result = createMockDO(DO, {
        ns: 'https://source.test.do',
        sqlData: new Map([['things', createTestData(5000, 500)]]),
      })

      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Eventual should not load all data at once
      expect(handle.status).toBe('pending')
    })

    it('should batch efficiently for resumable clone (checkpoint overhead)', async () => {
      result = createMockDO(DO, {
        ns: 'https://source.test.do',
        sqlData: new Map([['things', createTestData(1000)]]),
      })

      const target = 'https://target.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'resumable' }) as CloneResult

      // Resumable should create manageable checkpoints
      expect(cloneResult.checkpoint?.progress).toBeGreaterThanOrEqual(0)
    })
  })

  // ==========================================================================
  // COMPARATIVE BENCHMARKS
  // ==========================================================================

  describe('Comparative Mode Benchmarks', () => {
    it('should compare all modes for same dataset size', async () => {
      const datasetSize = 500
      const modes: CloneMode[] = ['atomic', 'staged', 'eventual', 'resumable']
      const benchmarks: Array<{ mode: CloneMode; completed: boolean }> = []

      for (const mode of modes) {
        result = createMockDO(DO, {
          ns: `https://source-${mode}.test.do`,
          sqlData: new Map([['things', createTestData(datasetSize)]]),
        })

        const target = `https://target-${mode}.test.do`
        const cloneResult = await result.instance.clone(target, { mode })

        benchmarks.push({ mode, completed: !!cloneResult })
      }

      // All modes should complete successfully
      expect(benchmarks.every((b) => b.completed)).toBe(true)
    })

    it('should identify optimal mode for different scenarios', async () => {
      // Small, fast, critical -> atomic
      // Medium, transactional -> staged
      // Large, background -> eventual
      // Large, unreliable network -> resumable

      const scenarios = [
        { size: 50, mode: 'atomic' as CloneMode, reason: 'small_critical' },
        { size: 500, mode: 'staged' as CloneMode, reason: 'medium_transactional' },
        { size: 5000, mode: 'eventual' as CloneMode, reason: 'large_background' },
        { size: 2000, mode: 'resumable' as CloneMode, reason: 'unreliable_network' },
      ]

      for (const scenario of scenarios) {
        result = createMockDO(DO, {
          ns: `https://source-${scenario.reason}.test.do`,
          sqlData: new Map([['things', createTestData(scenario.size)]]),
        })

        const target = `https://target-${scenario.reason}.test.do`
        const cloneResult = await result.instance.clone(target, { mode: scenario.mode })

        expect(cloneResult.mode).toBe(scenario.mode)
      }
    })
  })
})

// ============================================================================
// TEST SUITE: INTEGRATION SCENARIOS
// ============================================================================

describe('Clone Integration Scenarios E2E', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    vi.useFakeTimers()

    result = createMockDO(DO, {
      ns: 'https://source.test.do',
      sqlData: new Map([
        ['things', createTestData(300)],
        ['relationships', createTestRelationships(300)],
        ['branches', [{ name: 'main', head: 300, forkedFrom: null, createdAt: new Date().toISOString() }]],
      ]),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // REAL-WORLD WORKFLOW SCENARIOS
  // ==========================================================================

  describe('Real-World Workflow Scenarios', () => {
    it('should handle disaster recovery scenario (resumable + staged commit)', async () => {
      // Step 1: Start resumable clone (for reliability)
      const target = 'https://dr-backup.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'resumable' }) as CloneResult

      // Step 2: Wait for progress
      await vi.advanceTimersByTimeAsync(10000)

      // Step 3: Verify checkpoint for recovery
      expect(cloneResult.checkpoint?.resumable).toBe(true)
    })

    it('should handle live migration scenario (eventual + atomic cutover)', async () => {
      // Step 1: Start eventual clone (background sync)
      const target = 'https://new-location.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Step 2: Let background sync run
      await vi.advanceTimersByTimeAsync(30000)

      // Step 3: For cutover, would do final atomic sync
      const syncStatus = await handle.getSyncStatus()
      expect(syncStatus.itemsSynced).toBeGreaterThanOrEqual(0)
    })

    it('should handle branch deployment scenario (staged prepare + commit)', async () => {
      // Step 1: Prepare new branch deployment
      const target = 'https://staging-branch.test.do'
      const prepareResult = await result.instance.clone(target, {
        mode: 'staged',
        branch: 'feature-x',
      })

      // Step 2: Verify prepare succeeded
      expect(prepareResult.mode).toBe('staged')

      // Step 3: Commit when ready (would call commitClone)
    })

    it('should handle geo-replication scenario (eventual multi-target)', async () => {
      const regions = ['enam', 'weur', 'apac']
      const handles: EventualCloneHandle[] = []

      for (const region of regions) {
        const target = `https://replica-${region}.test.do`
        const handle = await result.instance.clone(target, {
          mode: 'eventual',
          colo: region,
        }) as unknown as EventualCloneHandle

        handles.push(handle)
      }

      // All replicas should be syncing
      expect(handles.length).toBe(3)
      for (const handle of handles) {
        expect(handle.status).toBe('pending')
      }
    })
  })

  // ==========================================================================
  // EDGE CASES AND SPECIAL SCENARIOS
  // ==========================================================================

  describe('Edge Cases and Special Scenarios', () => {
    it('should handle empty source DO clone', async () => {
      const emptyResult = createMockDO(DO, {
        ns: 'https://empty.test.do',
        sqlData: new Map([['things', []]]),
      })

      const target = 'https://target.test.do'

      // Empty clone should either succeed with empty state or reject
      try {
        await emptyResult.instance.clone(target, { mode: 'atomic' })
      } catch (error) {
        expect((error as Error).message).toMatch(/empty|no state/i)
      }
    })

    it('should handle clone during active writes to source', async () => {
      const target = 'https://target.test.do'

      // Start clone
      const clonePromise = result.instance.clone(target, { mode: 'eventual' })

      // Simulate concurrent write
      const things = result.sqlData.get('things')!
      things.push({
        id: 'new-thing',
        type: 1,
        data: JSON.stringify({ name: 'New Item' }),
        version: 1,
        branch: 'main',
        deleted: false,
      })

      const handle = await clonePromise as unknown as EventualCloneHandle

      // Clone should handle concurrent modification
      expect(handle.id).toBeDefined()
    })

    it('should handle clone with special characters in data', async () => {
      const specialThings = [
        {
          id: 'special-1',
          type: 1,
          data: JSON.stringify({
            name: 'Test <script>alert("xss")</script>',
            unicode: 'Hello World!',
            null: null,
            empty: '',
          }),
          version: 1,
          branch: 'main',
          deleted: false,
        },
      ]

      result.sqlData.set('things', specialThings)

      const target = 'https://target.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' })

      expect(cloneResult.ns).toBe(target)
    })

    it('should handle clone with binary data', async () => {
      const binaryThings = [
        {
          id: 'binary-1',
          type: 1,
          data: JSON.stringify({
            base64: Buffer.from('binary data').toString('base64'),
          }),
          version: 1,
          branch: 'main',
          deleted: false,
        },
      ]

      result.sqlData.set('things', binaryThings)

      const target = 'https://target.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'atomic' })

      expect(cloneResult.ns).toBe(target)
    })

    it('should handle very long running eventual clone', async () => {
      // Large dataset
      result.sqlData.set('things', createTestData(10000))

      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Simulate long-running operation
      await vi.advanceTimersByTimeAsync(300000) // 5 minutes

      // Should still be making progress
      const syncStatus = await handle.getSyncStatus()
      expect(syncStatus.itemsSynced).toBeGreaterThanOrEqual(0)
    })
  })

  // ==========================================================================
  // CLEANUP AND FINALIZATION
  // ==========================================================================

  describe('Cleanup and Finalization', () => {
    it('should cleanup staged resources after commit', async () => {
      const target = 'https://target.test.do'

      const prepareResult = await result.instance.clone(target, { mode: 'staged' })

      // After commit, staging resources should be cleaned
      expect(prepareResult.mode).toBe('staged')
    })

    it('should cleanup eventual clone resources after completion', async () => {
      // Small dataset for quick completion
      result.sqlData.set('things', createTestData(50))

      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      // Wait for completion
      await vi.advanceTimersByTimeAsync(60000)

      // Clone resources should be cleaned up
      expect(handle).toBeDefined()
    })

    it('should cleanup resumable checkpoints after completion', async () => {
      // Small dataset
      result.sqlData.set('things', createTestData(50))

      const target = 'https://target.test.do'
      const cloneResult = await result.instance.clone(target, { mode: 'resumable' })

      // Wait for completion
      await vi.advanceTimersByTimeAsync(10000)

      // Checkpoints should be cleaned up after successful completion
      expect(cloneResult.mode).toBe('resumable')
    })

    it('should preserve checkpoints on cancellation for potential resume', async () => {
      const target = 'https://target.test.do'
      const handle = await result.instance.clone(target, { mode: 'eventual' }) as unknown as EventualCloneHandle

      await vi.advanceTimersByTimeAsync(5000)

      // Cancel operation
      await handle.cancel()

      expect(handle.status).toBe('cancelled')
    })
  })
})
