/**
 * ACID Test Suite - Phase 4: Failover and Primary Promotion
 *
 * RED TDD: These tests define the expected behavior for failover scenarios
 * when the primary becomes unavailable and a replica must be promoted.
 * All tests are expected to FAIL initially as this is the RED phase.
 *
 * Failover scenarios:
 * - Primary failure detection
 * - Replica promotion to primary
 * - Follower reconfiguration to new primary
 * - Split-brain prevention
 * - Data reconciliation after partition heal
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md - Phase 4 Replication
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockDO, MockDOResult, MockEnv } from '../../../testing/do'
import { DO } from '../../../objects/DO'
import type { CloneOptions } from '../../../types/Lifecycle'
import type { Thing } from '../../../db/things'

// ============================================================================
// TYPE DEFINITIONS FOR FAILOVER
// ============================================================================

/**
 * Primary status for health monitoring
 */
type PrimaryStatus = 'healthy' | 'degraded' | 'unreachable' | 'failed'

/**
 * Failover state machine
 */
type FailoverState =
  | 'normal'           // Primary healthy, no failover in progress
  | 'detecting'        // Detecting primary failure
  | 'electing'         // Selecting new primary
  | 'promoting'        // Promoting replica to primary
  | 'reconfiguring'    // Updating follower configurations
  | 'reconciling'      // Reconciling data after failover
  | 'completed'        // Failover complete
  | 'rolled_back'      // Failover aborted, original primary restored

/**
 * Health check result
 */
interface HealthCheck {
  /** Status of the primary */
  status: PrimaryStatus
  /** Latency in milliseconds */
  latencyMs: number
  /** Timestamp of check */
  checkedAt: Date
  /** Number of consecutive failures */
  consecutiveFailures: number
  /** Last successful check */
  lastSuccessAt: Date | null
}

/**
 * Failover configuration
 */
interface FailoverConfig {
  /** Health check interval in milliseconds */
  healthCheckIntervalMs: number
  /** Number of failures before triggering failover */
  failureThreshold: number
  /** Timeout for health check in milliseconds */
  healthCheckTimeoutMs: number
  /** Whether automatic failover is enabled */
  autoFailover: boolean
  /** Minimum replicas before failover can proceed */
  minReplicas: number
  /** Promotion strategy */
  promotionStrategy: 'lowest-lag' | 'designated' | 'random'
  /** Designated replica for promotion (if strategy is 'designated') */
  designatedReplica?: string
  /** Whether to require quorum for failover */
  requireQuorum: boolean
  /** Quorum size (number of replicas that must agree) */
  quorumSize?: number
}

/**
 * Failover event
 */
interface FailoverEvent {
  /** Event type */
  type: 'started' | 'promoted' | 'reconfigured' | 'completed' | 'failed' | 'rolled_back'
  /** Old primary namespace */
  oldPrimary: string
  /** New primary namespace (if applicable) */
  newPrimary?: string
  /** Timestamp */
  timestamp: Date
  /** Additional details */
  details?: Record<string, unknown>
}

/**
 * Failover result
 */
interface FailoverResult {
  /** Whether failover succeeded */
  success: boolean
  /** New primary namespace */
  newPrimary?: string
  /** Old primary namespace */
  oldPrimary: string
  /** Duration of failover in milliseconds */
  durationMs: number
  /** Data loss indicator (versions lost if any) */
  dataLoss: number
  /** Replicas that were reconfigured */
  reconfiguredReplicas: string[]
  /** Error if failover failed */
  error?: string
}

/**
 * Split-brain resolution strategy
 */
type SplitBrainResolution = 'highest-sequence' | 'most-replicas' | 'designated' | 'manual'

/**
 * Replica handle with failover support
 */
interface ReplicaWithFailover {
  /** Namespace of the replica */
  ns: string
  /** DO ID of the replica */
  doId: string
  /** Get current replica role */
  getRole(): Promise<'primary' | 'follower'>
  /** Get current primary namespace */
  getPrimaryNs(): Promise<string | null>
  /** Check if this replica can be promoted */
  canPromote(): Promise<boolean>
  /** Get current sequence number */
  getSequence(): Promise<number>
  /** Promote this replica to primary */
  promote(): Promise<FailoverResult>
  /** Demote this primary to follower */
  demote(newPrimary: string): Promise<void>
  /** Reconfigure to follow new primary */
  reconfigure(newPrimary: string): Promise<void>
  /** Get health of current primary */
  getPrimaryHealth(): Promise<HealthCheck>
  /** Force sync with primary */
  sync(): Promise<void>
  /** Get failover configuration */
  getFailoverConfig(): Promise<FailoverConfig>
  /** Set failover configuration */
  setFailoverConfig(config: Partial<FailoverConfig>): Promise<void>
  /** Get failover history */
  getFailoverHistory(limit?: number): Promise<FailoverEvent[]>
}

/**
 * Failover coordinator for managing cluster-wide failover
 */
interface FailoverCoordinator {
  /** Initiate failover */
  initiateFailover(reason: string): Promise<FailoverResult>
  /** Get current failover state */
  getState(): Promise<FailoverState>
  /** Cancel ongoing failover */
  cancelFailover(): Promise<void>
  /** Get all replicas in the cluster */
  getReplicas(): Promise<ReplicaWithFailover[]>
  /** Elect new primary based on strategy */
  electPrimary(): Promise<string>
  /** Detect split-brain and resolve */
  detectSplitBrain(): Promise<{ detected: boolean; resolution?: SplitBrainResolution }>
  /** Force rollback to previous primary */
  rollback(): Promise<FailoverResult>
}

/**
 * Extended clone options for replica with failover
 */
interface ReplicaCloneOptions extends CloneOptions {
  asReplica: true
  /** Failover configuration */
  failoverConfig?: Partial<FailoverConfig>
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('Failover and Primary Promotion', () => {
  let result: MockDOResult<DO, MockEnv>

  beforeEach(() => {
    vi.useFakeTimers()
    result = createMockDO(DO, {
      ns: 'https://primary.test.do',
      sqlData: new Map([
        ['things', Array.from({ length: 100 }, (_, i) => ({
          id: `thing-${i}`,
          type: 1,
          data: { index: i, name: `Item ${i}` },
          version: i + 1,
          branch: null,
          deleted: false,
        }))],
        ['objects', [{
          ns: 'https://primary.test.do',
          class: 'DO',
          primary: true,
          sequence: 100,
          region: 'us-east',
          createdAt: new Date().toISOString(),
        }]],
      ]),
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ==========================================================================
  // PRIMARY HEALTH MONITORING
  // ==========================================================================

  describe('Primary Health Monitoring', () => {
    it('should perform periodic health checks on primary', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        failoverConfig: {
          healthCheckIntervalMs: 1000,
        },
      }) as unknown as ReplicaWithFailover

      // Wait for health checks
      await vi.advanceTimersByTimeAsync(5000)

      const health = await replica.getPrimaryHealth()

      expect(health).toBeDefined()
      expect(health.status).toBe('healthy')
      expect(health.checkedAt).toBeInstanceOf(Date)
    })

    it('should track consecutive failures', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        failoverConfig: {
          healthCheckIntervalMs: 1000,
          healthCheckTimeoutMs: 500,
        },
      }) as unknown as ReplicaWithFailover

      // Simulate primary becoming unreachable
      // @ts-expect-error - accessing internal state for test
      result.instance._simulatePrimaryFailure?.()

      await vi.advanceTimersByTimeAsync(5000)

      const health = await replica.getPrimaryHealth()

      expect(health.consecutiveFailures).toBeGreaterThan(0)
      expect(['degraded', 'unreachable', 'failed']).toContain(health.status)
    })

    it('should track last successful check timestamp', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithFailover

      // Wait for successful checks
      await vi.advanceTimersByTimeAsync(3000)

      const health = await replica.getPrimaryHealth()

      expect(health.lastSuccessAt).toBeInstanceOf(Date)
    })

    it('should measure health check latency', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithFailover

      const health = await replica.getPrimaryHealth()

      expect(typeof health.latencyMs).toBe('number')
      expect(health.latencyMs).toBeGreaterThanOrEqual(0)
    })

    it('should detect degraded state on high latency', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        failoverConfig: {
          healthCheckTimeoutMs: 1000,
        },
      }) as unknown as ReplicaWithFailover

      // Simulate high latency
      // @ts-expect-error - accessing internal state for test
      result.instance._simulateHighLatency?.(800)

      await vi.advanceTimersByTimeAsync(5000)

      const health = await replica.getPrimaryHealth()

      // High latency should result in degraded or healthy depending on threshold
      expect(['healthy', 'degraded']).toContain(health.status)
    })
  })

  // ==========================================================================
  // FAILURE DETECTION
  // ==========================================================================

  describe('Failure Detection', () => {
    it('should detect primary failure after threshold', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        failoverConfig: {
          healthCheckIntervalMs: 1000,
          failureThreshold: 3,
          autoFailover: false,
        },
      }) as unknown as ReplicaWithFailover

      // Simulate primary failure
      // @ts-expect-error - accessing internal state for test
      result.instance._simulatePrimaryFailure?.()

      // Wait for threshold to be reached
      await vi.advanceTimersByTimeAsync(5000)

      const health = await replica.getPrimaryHealth()

      expect(health.consecutiveFailures).toBeGreaterThanOrEqual(3)
      expect(health.status).toBe('failed')
    })

    it('should reset failure count on successful check', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        failoverConfig: {
          healthCheckIntervalMs: 1000,
          failureThreshold: 3,
        },
      }) as unknown as ReplicaWithFailover

      // Simulate temporary failure
      // @ts-expect-error - accessing internal state for test
      result.instance._simulatePrimaryFailure?.()
      await vi.advanceTimersByTimeAsync(2000)

      // Restore primary
      // @ts-expect-error - accessing internal state for test
      result.instance._restorePrimary?.()
      await vi.advanceTimersByTimeAsync(2000)

      const health = await replica.getPrimaryHealth()

      expect(health.consecutiveFailures).toBe(0)
      expect(health.status).toBe('healthy')
    })

    it('should not trigger failover below threshold', async () => {
      const events: FailoverEvent[] = []

      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        failoverConfig: {
          healthCheckIntervalMs: 1000,
          failureThreshold: 5,
          autoFailover: true,
        },
      }) as unknown as ReplicaWithFailover

      // Track failover events
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        if (verb.startsWith('failover.')) {
          events.push(data as FailoverEvent)
        }
        return originalEmit?.call(result.instance, verb, data)
      }

      // Simulate brief failure (less than threshold)
      // @ts-expect-error - accessing internal state for test
      result.instance._simulatePrimaryFailure?.()
      await vi.advanceTimersByTimeAsync(2000)
      // @ts-expect-error - accessing internal state for test
      result.instance._restorePrimary?.()

      const startedEvents = events.filter((e) => e.type === 'started')
      expect(startedEvents).toHaveLength(0)
    })
  })

  // ==========================================================================
  // AUTOMATIC FAILOVER
  // ==========================================================================

  describe('Automatic Failover', () => {
    it('should trigger automatic failover when enabled', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        failoverConfig: {
          healthCheckIntervalMs: 500,
          failureThreshold: 3,
          autoFailover: true,
        },
      }) as unknown as ReplicaWithFailover

      // Sync replica first
      await replica.sync()
      await vi.advanceTimersByTimeAsync(1000)

      // Simulate primary failure
      // @ts-expect-error - accessing internal state for test
      result.instance._simulatePrimaryFailure?.()

      // Wait for failover to trigger and complete
      await vi.advanceTimersByTimeAsync(10000)

      const role = await replica.getRole()

      expect(role).toBe('primary')
    })

    it('should not trigger automatic failover when disabled', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        failoverConfig: {
          healthCheckIntervalMs: 500,
          failureThreshold: 3,
          autoFailover: false,
        },
      }) as unknown as ReplicaWithFailover

      // Simulate primary failure
      // @ts-expect-error - accessing internal state for test
      result.instance._simulatePrimaryFailure?.()

      await vi.advanceTimersByTimeAsync(10000)

      const role = await replica.getRole()

      // Should still be follower
      expect(role).toBe('follower')
    })

    it('should respect minimum replica requirement', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        failoverConfig: {
          healthCheckIntervalMs: 500,
          failureThreshold: 3,
          autoFailover: true,
          minReplicas: 3, // Need 3 replicas
        },
      }) as unknown as ReplicaWithFailover

      // Only one replica exists

      // Simulate primary failure
      // @ts-expect-error - accessing internal state for test
      result.instance._simulatePrimaryFailure?.()

      await vi.advanceTimersByTimeAsync(10000)

      // Failover should not proceed due to min replicas
      const role = await replica.getRole()
      expect(role).toBe('follower')
    })

    it('should use lowest-lag strategy by default', async () => {
      // Create multiple replicas with different lag
      const replica1 = await result.instance.clone('https://replica-1.test.do', {
        asReplica: true,
        failoverConfig: { autoFailover: true, promotionStrategy: 'lowest-lag' },
      }) as unknown as ReplicaWithFailover

      const replica2 = await result.instance.clone('https://replica-2.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithFailover

      // Sync replica1 fully
      await replica1.sync()
      await vi.advanceTimersByTimeAsync(1000)

      // Don't sync replica2 (higher lag)

      // Simulate primary failure
      // @ts-expect-error - accessing internal state for test
      result.instance._simulatePrimaryFailure?.()

      await vi.advanceTimersByTimeAsync(10000)

      // Replica1 should be promoted (lowest lag)
      const role1 = await replica1.getRole()
      const role2 = await replica2.getRole()

      expect(role1).toBe('primary')
      expect(role2).toBe('follower')
    })

    it('should use designated replica when strategy is designated', async () => {
      await result.instance.clone('https://replica-1.test.do', {
        asReplica: true,
      })

      const designatedReplica = await result.instance.clone('https://replica-designated.test.do', {
        asReplica: true,
        failoverConfig: {
          autoFailover: true,
          promotionStrategy: 'designated',
          designatedReplica: 'https://replica-designated.test.do',
        },
      }) as unknown as ReplicaWithFailover

      await designatedReplica.sync()
      await vi.advanceTimersByTimeAsync(1000)

      // Simulate primary failure
      // @ts-expect-error - accessing internal state for test
      result.instance._simulatePrimaryFailure?.()

      await vi.advanceTimersByTimeAsync(10000)

      const role = await designatedReplica.getRole()
      expect(role).toBe('primary')
    })
  })

  // ==========================================================================
  // MANUAL FAILOVER
  // ==========================================================================

  describe('Manual Failover', () => {
    it('should allow manual promotion of replica', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        failoverConfig: { autoFailover: false },
      }) as unknown as ReplicaWithFailover

      // Sync first
      await replica.sync()
      await vi.advanceTimersByTimeAsync(1000)

      const failoverResult = await replica.promote()

      expect(failoverResult.success).toBe(true)
      expect(failoverResult.newPrimary).toBe('https://replica.test.do')
    })

    it('should return failover result with duration', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithFailover

      await replica.sync()
      await vi.advanceTimersByTimeAsync(1000)

      const failoverResult = await replica.promote()

      expect(failoverResult.durationMs).toBeGreaterThanOrEqual(0)
    })

    it('should indicate data loss if any', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithFailover

      // Don't fully sync - will have some lag
      await vi.advanceTimersByTimeAsync(500)

      // Add more writes to primary
      result.sqlData.get('things')!.push({
        id: 'after-sync-thing',
        type: 1,
        data: { name: 'After Sync' },
        version: 101,
        branch: null,
        deleted: false,
      })

      const failoverResult = await replica.promote()

      // dataLoss should indicate versions that weren't replicated
      expect(failoverResult.dataLoss).toBeGreaterThanOrEqual(0)
    })

    it('should fail promotion if replica is too far behind', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithFailover

      // Add many writes without syncing
      for (let i = 0; i < 100; i++) {
        result.sqlData.get('things')!.push({
          id: `far-behind-thing-${i}`,
          type: 1,
          data: { index: i },
          version: 101 + i,
          branch: null,
          deleted: false,
        })
      }

      const canPromote = await replica.canPromote()

      expect(canPromote).toBe(false)
    })

    it('should check if replica can be promoted', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithFailover

      await replica.sync()
      await vi.advanceTimersByTimeAsync(1000)

      const canPromote = await replica.canPromote()

      expect(canPromote).toBe(true)
    })
  })

  // ==========================================================================
  // FOLLOWER RECONFIGURATION
  // ==========================================================================

  describe('Follower Reconfiguration', () => {
    it('should reconfigure followers to new primary after failover', async () => {
      const replica1 = await result.instance.clone('https://replica-1.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithFailover

      const replica2 = await result.instance.clone('https://replica-2.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithFailover

      // Sync both
      await replica1.sync()
      await replica2.sync()
      await vi.advanceTimersByTimeAsync(1000)

      // Promote replica1
      const failoverResult = await replica1.promote()

      expect(failoverResult.reconfiguredReplicas).toContain('https://replica-2.test.do')

      // Replica2 should now follow replica1
      const replica2Primary = await replica2.getPrimaryNs()
      expect(replica2Primary).toBe('https://replica-1.test.do')
    })

    it('should allow manual reconfiguration', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithFailover

      // Reconfigure to follow a different primary
      await replica.reconfigure('https://new-primary.test.do')

      const primaryNs = await replica.getPrimaryNs()
      expect(primaryNs).toBe('https://new-primary.test.do')
    })

    it('should demote old primary to follower', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithFailover

      await replica.sync()
      await vi.advanceTimersByTimeAsync(1000)

      // Promote replica
      await replica.promote()

      // Old primary should be demoted
      // @ts-expect-error - accessing internal method
      const oldPrimaryRole = await result.instance.getRole?.()
      expect(oldPrimaryRole).toBe('follower')
    })

    it('should handle unreachable followers during reconfiguration', async () => {
      const replica1 = await result.instance.clone('https://replica-1.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithFailover

      await result.instance.clone('https://replica-unreachable.test.do', {
        asReplica: true,
      })

      await replica1.sync()
      await vi.advanceTimersByTimeAsync(1000)

      // Simulate unreachable replica
      // @ts-expect-error - internal test method
      result.instance._simulateReplicaUnreachable?.('https://replica-unreachable.test.do')

      // Failover should still succeed
      const failoverResult = await replica1.promote()

      expect(failoverResult.success).toBe(true)
      // Unreachable replica may not be in reconfigured list
      expect(failoverResult.reconfiguredReplicas).not.toContain('https://replica-unreachable.test.do')
    })
  })

  // ==========================================================================
  // SPLIT-BRAIN PREVENTION
  // ==========================================================================

  describe('Split-Brain Prevention', () => {
    it('should require quorum for failover when configured', async () => {
      // Create 3 replicas for quorum
      const replica1 = await result.instance.clone('https://replica-1.test.do', {
        asReplica: true,
        failoverConfig: {
          requireQuorum: true,
          quorumSize: 2,
        },
      }) as unknown as ReplicaWithFailover

      await result.instance.clone('https://replica-2.test.do', { asReplica: true })
      await result.instance.clone('https://replica-3.test.do', { asReplica: true })

      await replica1.sync()
      await vi.advanceTimersByTimeAsync(1000)

      // With 3 replicas, quorum of 2 should be achievable
      const canPromote = await replica1.canPromote()
      expect(canPromote).toBe(true)
    })

    it('should prevent failover without quorum', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        failoverConfig: {
          requireQuorum: true,
          quorumSize: 3,
        },
      }) as unknown as ReplicaWithFailover

      // Only 1 replica exists, need quorum of 3

      await replica.sync()
      await vi.advanceTimersByTimeAsync(1000)

      // Should not be able to promote
      const canPromote = await replica.canPromote()
      expect(canPromote).toBe(false)
    })

    it('should detect split-brain scenario', async () => {
      // Create replicas
      const replica1 = await result.instance.clone('https://replica-1.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithFailover

      await result.instance.clone('https://replica-2.test.do', { asReplica: true })

      // Simulate network partition causing both to think they're primary
      // @ts-expect-error - internal test method
      result.instance._simulateNetworkPartition?.()

      // Advance time to trigger partition detection
      await vi.advanceTimersByTimeAsync(30000)

      // @ts-expect-error - accessing failover coordinator
      const coordinator = result.instance.failoverCoordinator as FailoverCoordinator
      const splitBrain = await coordinator?.detectSplitBrain()

      // Split brain detection should work
      expect(typeof splitBrain?.detected).toBe('boolean')
    })

    it('should use highest-sequence resolution by default', async () => {
      const replica1 = await result.instance.clone('https://replica-1.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithFailover

      const replica2 = await result.instance.clone('https://replica-2.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithFailover

      // Both replicas think they're primary (split brain)
      // Replica1 has higher sequence
      // @ts-expect-error - internal test method
      await result.instance._simulateSplitBrain?.({
        replica1Sequence: 150,
        replica2Sequence: 100,
      })

      // @ts-expect-error - accessing failover coordinator
      const coordinator = result.instance.failoverCoordinator as FailoverCoordinator
      const resolution = await coordinator?.detectSplitBrain()

      if (resolution?.detected) {
        expect(resolution.resolution).toBe('highest-sequence')
      }
    })

    it('should prevent promotion during ongoing failover', async () => {
      const replica1 = await result.instance.clone('https://replica-1.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithFailover

      const replica2 = await result.instance.clone('https://replica-2.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithFailover

      await replica1.sync()
      await replica2.sync()

      // Start failover on replica1
      const failover1Promise = replica1.promote()

      // Attempt to promote replica2 should fail
      await expect(replica2.promote()).rejects.toThrow(/failover.*in progress|already promoting/i)

      await failover1Promise
    })
  })

  // ==========================================================================
  // FAILOVER STATE MACHINE
  // ==========================================================================

  describe('Failover State Machine', () => {
    it('should track failover state transitions', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithFailover

      // @ts-expect-error - accessing failover coordinator
      const coordinator = result.instance.failoverCoordinator as FailoverCoordinator

      // Initial state
      const initialState = await coordinator?.getState()
      expect(initialState).toBe('normal')

      await replica.sync()
      await vi.advanceTimersByTimeAsync(1000)

      // Trigger failover
      coordinator?.initiateFailover('manual test')

      // Should be in progress
      const inProgressState = await coordinator?.getState()
      expect(['detecting', 'electing', 'promoting', 'reconfiguring']).toContain(inProgressState)
    })

    it('should allow cancelling failover', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithFailover

      // @ts-expect-error - accessing failover coordinator
      const coordinator = result.instance.failoverCoordinator as FailoverCoordinator

      await replica.sync()

      // Start failover
      coordinator?.initiateFailover('test')

      // Cancel it
      await coordinator?.cancelFailover()

      const state = await coordinator?.getState()
      expect(['normal', 'rolled_back']).toContain(state)
    })

    it('should record failover history', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithFailover

      await replica.sync()
      await vi.advanceTimersByTimeAsync(1000)

      // Perform failover
      await replica.promote()

      const history = await replica.getFailoverHistory()

      expect(history.length).toBeGreaterThan(0)
      expect(history[0].type).toBe('completed')
    })

    it('should limit failover history', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithFailover

      const history = await replica.getFailoverHistory(5)

      expect(history.length).toBeLessThanOrEqual(5)
    })
  })

  // ==========================================================================
  // DATA RECONCILIATION
  // ==========================================================================

  describe('Data Reconciliation', () => {
    it('should reconcile data when old primary comes back online', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithFailover

      await replica.sync()
      await vi.advanceTimersByTimeAsync(1000)

      // Simulate primary going down
      // @ts-expect-error - internal test method
      result.instance._simulatePrimaryFailure?.()

      // Promote replica
      await replica.promote()

      // Write some data to new primary
      // @ts-expect-error - accessing internal method
      await replica.writeThing?.({
        id: 'new-primary-thing',
        type: 1,
        data: { name: 'Written to new primary' },
      })

      // Old primary comes back
      // @ts-expect-error - internal test method
      result.instance._restorePrimary?.()

      await vi.advanceTimersByTimeAsync(5000)

      // Old primary should be reconciled as follower
      // @ts-expect-error - accessing internal method
      const oldPrimaryRole = await result.instance.getRole?.()
      expect(oldPrimaryRole).toBe('follower')
    })

    it('should handle conflicting writes during partition', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithFailover

      await replica.sync()

      // Simulate partition where both write
      // @ts-expect-error - internal test method
      result.instance._simulatePartitionedWrite?.('primary', {
        id: 'conflict-thing',
        data: { source: 'primary' },
      })

      // @ts-expect-error - internal test method
      await replica.simulatePartitionedWrite?.('replica', {
        id: 'conflict-thing',
        data: { source: 'replica' },
      })

      // Heal partition
      // @ts-expect-error - internal test method
      await result.instance._healPartition?.()

      await vi.advanceTimersByTimeAsync(5000)

      // Should have resolved conflict (implementation specific)
      // This test documents the expected behavior
    })

    it('should merge divergent histories after partition heal', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithFailover

      await replica.sync()
      await vi.advanceTimersByTimeAsync(1000)

      // Create divergent writes
      const primarySequenceBefore = 100 // From test setup

      // Both sides write during partition
      // @ts-expect-error - internal test method
      await result.instance._simulatePartitionedWrites?.({
        primary: 5,
        replica: 3,
      })

      // Promote replica during partition
      await replica.promote()

      // Heal partition
      await vi.advanceTimersByTimeAsync(10000)

      // Final sequence should include all writes
      const finalSequence = await replica.getSequence()
      expect(finalSequence).toBeGreaterThan(primarySequenceBefore)
    })
  })

  // ==========================================================================
  // FAILOVER CONFIGURATION
  // ==========================================================================

  describe('Failover Configuration', () => {
    it('should allow configuring health check interval', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        failoverConfig: {
          healthCheckIntervalMs: 5000,
        },
      }) as unknown as ReplicaWithFailover

      const config = await replica.getFailoverConfig()

      expect(config.healthCheckIntervalMs).toBe(5000)
    })

    it('should allow configuring failure threshold', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        failoverConfig: {
          failureThreshold: 10,
        },
      }) as unknown as ReplicaWithFailover

      const config = await replica.getFailoverConfig()

      expect(config.failureThreshold).toBe(10)
    })

    it('should allow updating failover config dynamically', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        failoverConfig: {
          autoFailover: false,
        },
      }) as unknown as ReplicaWithFailover

      await replica.setFailoverConfig({
        autoFailover: true,
        failureThreshold: 5,
      })

      const config = await replica.getFailoverConfig()

      expect(config.autoFailover).toBe(true)
      expect(config.failureThreshold).toBe(5)
    })

    it('should merge config updates with existing config', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        failoverConfig: {
          healthCheckIntervalMs: 1000,
          failureThreshold: 3,
        },
      }) as unknown as ReplicaWithFailover

      await replica.setFailoverConfig({
        autoFailover: true,
      })

      const config = await replica.getFailoverConfig()

      // Original values should be preserved
      expect(config.healthCheckIntervalMs).toBe(1000)
      expect(config.failureThreshold).toBe(3)
      // New value should be set
      expect(config.autoFailover).toBe(true)
    })

    it('should validate config values', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithFailover

      await expect(async () => {
        await replica.setFailoverConfig({
          healthCheckIntervalMs: -1, // Invalid
        })
      }).rejects.toThrow(/invalid.*config|must be.*positive/i)
    })
  })

  // ==========================================================================
  // FAILOVER EVENTS
  // ==========================================================================

  describe('Failover Events', () => {
    it('should emit failover.started event', async () => {
      const events: unknown[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({ type: verb, data })
        return originalEmit?.call(result.instance, verb, data)
      }

      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithFailover

      await replica.sync()
      await vi.advanceTimersByTimeAsync(1000)

      await replica.promote()

      const startedEvent = events.find((e) =>
        (e as Record<string, string>).type === 'failover.started'
      )
      expect(startedEvent).toBeDefined()
    })

    it('should emit failover.promoted event', async () => {
      const events: unknown[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({ type: verb, data })
        return originalEmit?.call(result.instance, verb, data)
      }

      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithFailover

      await replica.sync()
      await vi.advanceTimersByTimeAsync(1000)

      await replica.promote()

      const promotedEvent = events.find((e) =>
        (e as Record<string, string>).type === 'failover.promoted'
      )
      expect(promotedEvent).toBeDefined()
    })

    it('should emit failover.completed event', async () => {
      const events: unknown[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({ type: verb, data })
        return originalEmit?.call(result.instance, verb, data)
      }

      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithFailover

      await replica.sync()
      await vi.advanceTimersByTimeAsync(1000)

      await replica.promote()

      const completedEvent = events.find((e) =>
        (e as Record<string, string>).type === 'failover.completed'
      )
      expect(completedEvent).toBeDefined()
    })

    it('should emit failover.failed event on failure', async () => {
      const events: unknown[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({ type: verb, data })
        return originalEmit?.call(result.instance, verb, data)
      }

      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        failoverConfig: {
          requireQuorum: true,
          quorumSize: 10, // Impossible to achieve
        },
      }) as unknown as ReplicaWithFailover

      try {
        await replica.promote()
      } catch {
        // Expected to fail
      }

      const failedEvent = events.find((e) =>
        (e as Record<string, string>).type === 'failover.failed'
      )
      expect(failedEvent).toBeDefined()
    })

    it('should include old and new primary in events', async () => {
      const events: Array<{ type: string; data: FailoverEvent }> = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({ type: verb, data: data as FailoverEvent })
        return originalEmit?.call(result.instance, verb, data)
      }

      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithFailover

      await replica.sync()
      await vi.advanceTimersByTimeAsync(1000)

      await replica.promote()

      const completedEvent = events.find((e) => e.type === 'failover.completed')

      expect(completedEvent?.data.oldPrimary).toBe('https://primary.test.do')
      expect(completedEvent?.data.newPrimary).toBe('https://replica.test.do')
    })
  })

  // ==========================================================================
  // ROLLBACK
  // ==========================================================================

  describe('Failover Rollback', () => {
    it('should support rollback to original primary', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithFailover

      await replica.sync()
      await vi.advanceTimersByTimeAsync(1000)

      // Promote
      await replica.promote()

      // Rollback
      // @ts-expect-error - accessing failover coordinator
      const coordinator = result.instance.failoverCoordinator as FailoverCoordinator
      const rollbackResult = await coordinator?.rollback()

      expect(rollbackResult?.success).toBe(true)
      expect(rollbackResult?.newPrimary).toBe('https://primary.test.do')
    })

    it('should prevent rollback if original primary is unavailable', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithFailover

      await replica.sync()
      await vi.advanceTimersByTimeAsync(1000)

      // Simulate primary failure
      // @ts-expect-error - internal test method
      result.instance._simulatePrimaryFailure?.()

      // Promote
      await replica.promote()

      // Original primary still down
      // @ts-expect-error - accessing failover coordinator
      const coordinator = result.instance.failoverCoordinator as FailoverCoordinator

      await expect(coordinator?.rollback()).rejects.toThrow(
        /original primary.*unavailable|cannot rollback/i
      )
    })

    it('should emit failover.rolled_back event', async () => {
      const events: unknown[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({ type: verb, data })
        return originalEmit?.call(result.instance, verb, data)
      }

      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithFailover

      await replica.sync()
      await vi.advanceTimersByTimeAsync(1000)

      await replica.promote()

      // @ts-expect-error - accessing failover coordinator
      const coordinator = result.instance.failoverCoordinator as FailoverCoordinator
      await coordinator?.rollback()

      const rollbackEvent = events.find((e) =>
        (e as Record<string, string>).type === 'failover.rolled_back'
      )
      expect(rollbackEvent).toBeDefined()
    })
  })

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle promotion when already primary', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithFailover

      await replica.sync()
      await vi.advanceTimersByTimeAsync(1000)

      // First promotion
      await replica.promote()

      // Second promotion attempt should be no-op or error
      await expect(replica.promote()).rejects.toThrow(/already primary/i)
    })

    it('should handle rapid consecutive failovers', async () => {
      const replica1 = await result.instance.clone('https://replica-1.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithFailover

      const replica2 = await result.instance.clone('https://replica-2.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithFailover

      await replica1.sync()
      await replica2.sync()
      await vi.advanceTimersByTimeAsync(1000)

      // First failover
      await replica1.promote()

      // Immediate second failover
      await replica2.reconfigure('https://replica-1.test.do')
      await replica2.sync()

      // This might fail or need cooldown
      try {
        await replica2.promote()
        const role2 = await replica2.getRole()
        expect(['primary', 'follower']).toContain(role2)
      } catch (error) {
        // Expected behavior - rapid failovers may be blocked
        expect((error as Error).message).toMatch(/cooldown|too soon|in progress/i)
      }
    })

    it('should handle promotion with zero replicas remaining', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
      }) as unknown as ReplicaWithFailover

      await replica.sync()
      await vi.advanceTimersByTimeAsync(1000)

      // Promote - now this is primary with no followers
      const failoverResult = await replica.promote()

      expect(failoverResult.success).toBe(true)
      expect(failoverResult.reconfiguredReplicas).toHaveLength(0)
    })

    it('should handle network timeout during promotion', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        failoverConfig: {
          healthCheckTimeoutMs: 100,
        },
      }) as unknown as ReplicaWithFailover

      await replica.sync()
      await vi.advanceTimersByTimeAsync(1000)

      // Simulate slow network during promotion
      // @ts-expect-error - internal test method
      result.instance._simulateSlowNetwork?.(5000)

      // Promotion should either succeed with timeout handling or fail gracefully
      try {
        const result = await replica.promote()
        expect(result.success).toBeDefined()
      } catch (error) {
        expect((error as Error).message).toMatch(/timeout|network/i)
      }
    })

    it('should handle concurrent health checks during failover', async () => {
      const replica = await result.instance.clone('https://replica.test.do', {
        asReplica: true,
        failoverConfig: {
          healthCheckIntervalMs: 100,
        },
      }) as unknown as ReplicaWithFailover

      await replica.sync()
      await vi.advanceTimersByTimeAsync(1000)

      // Start multiple operations concurrently
      const promotePromise = replica.promote()
      const healthPromise = replica.getPrimaryHealth()

      const [failoverResult, health] = await Promise.all([promotePromise, healthPromise])

      expect(failoverResult.success).toBe(true)
      expect(health).toBeDefined()
    })
  })
})
