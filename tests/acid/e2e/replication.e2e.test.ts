/**
 * ACID Test Suite - Phase 4.6: E2E Replication Tests
 *
 * End-to-end tests for DO replication deployed to real Cloudflare infrastructure.
 * These tests verify:
 * - Full replica lifecycle (create, sync, promote, serve traffic)
 * - Multi-region deployment to actual Cloudflare colos
 * - Failover scenarios with data integrity verification
 *
 * NOTE: These tests require a live Cloudflare deployment.
 * They will be skipped if CLOUDFLARE_E2E is not set.
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md - Phase 4 Replication
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { benchmark, record, type BenchmarkResult } from '../../../benchmarks/lib'
import { NA_COLOS, EU_COLOS, APAC_COLOS, type Colo } from '../../../benchmarks/lib/colos'

// ============================================================================
// E2E CONFIGURATION
// ============================================================================

/** Whether E2E tests should run (requires live deployment) */
const E2E_ENABLED = process.env.CLOUDFLARE_E2E === 'true' || process.env.CI === 'true'

/** Target DO endpoint for replication E2E tests */
const TARGET = 'replication.e2e.do'

/** Timeout for E2E operations (ms) */
const E2E_TIMEOUT = 30000

/** Maximum acceptable latency for replica operations (ms) */
const MAX_REPLICA_LATENCY_MS = 5000

/** Maximum acceptable failover time (ms) */
const MAX_FAILOVER_TIME_MS = 10000

/** Maximum acceptable replication lag (ms) */
const MAX_REPLICATION_LAG_MS = 1000

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Replica status from E2E endpoint
 */
interface ReplicaStatus {
  id: string
  ns: string
  role: 'primary' | 'follower'
  status: 'initializing' | 'syncing' | 'active' | 'stale' | 'disconnected'
  colo: string
  region: string
  lag: number
  lastSyncAt: string | null
  sequence: number
  healthy: boolean
}

/**
 * Replication topology from E2E endpoint
 */
interface ReplicationTopology {
  primary: {
    ns: string
    colo: string
    sequence: number
  }
  replicas: ReplicaStatus[]
  totalReplicas: number
  healthyReplicas: number
  regions: string[]
}

/**
 * Failover result from E2E endpoint
 */
interface FailoverResult {
  success: boolean
  oldPrimary: string
  newPrimary: string
  durationMs: number
  dataLoss: number
  reconfiguredReplicas: string[]
}

/**
 * Data integrity check result
 */
interface DataIntegrityResult {
  consistent: boolean
  primarySequence: number
  replicaSequences: Record<string, number>
  checksumMatch: boolean
  missingItems: number
  extraItems: number
  divergentItems: number
}

/**
 * Test context for E2E replica operations
 */
interface ReplicaTestContext {
  testRunId: string
  primaryNs: string
  replicaNs: string[]
  results: BenchmarkResult[]
}

// ============================================================================
// TEST UTILITIES
// ============================================================================

/**
 * Skip test if E2E is not enabled
 */
function skipIfNoE2E() {
  if (!E2E_ENABLED) {
    return 'Skipped: CLOUDFLARE_E2E not enabled'
  }
  return null
}

/**
 * Generate a unique test run ID
 */
function generateTestRunId(): string {
  return `repl-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Wait for replica to reach a specific status
 */
async function waitForReplicaStatus(
  ctx: { do: { get: <T>(path: string) => Promise<T> } },
  replicaId: string,
  targetStatus: ReplicaStatus['status'],
  timeoutMs: number = 30000
): Promise<ReplicaStatus> {
  const startTime = Date.now()
  let lastStatus: ReplicaStatus | null = null

  while (Date.now() - startTime < timeoutMs) {
    try {
      lastStatus = await ctx.do.get<ReplicaStatus>(`/replica/${replicaId}/status`)

      if (lastStatus.status === targetStatus) {
        return lastStatus
      }
    } catch {
      // Replica might not exist yet during creation
    }

    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  throw new Error(
    `Timeout waiting for replica ${replicaId} to reach status ${targetStatus}. ` +
    `Last status: ${lastStatus?.status ?? 'unknown'}`
  )
}

/**
 * Wait for replication to stabilize (all replicas active with low lag)
 */
async function waitForReplicationStable(
  ctx: { do: { get: <T>(path: string) => Promise<T> } },
  maxLagMs: number = MAX_REPLICATION_LAG_MS,
  timeoutMs: number = 30000
): Promise<ReplicationTopology> {
  const startTime = Date.now()
  let lastTopology: ReplicationTopology | null = null

  while (Date.now() - startTime < timeoutMs) {
    try {
      lastTopology = await ctx.do.get<ReplicationTopology>('/replication/topology')

      const allActive = lastTopology.replicas.every((r) => r.status === 'active')
      const allLowLag = lastTopology.replicas.every((r) => r.lag <= maxLagMs)

      if (allActive && allLowLag) {
        return lastTopology
      }
    } catch {
      // Topology might not be available during setup
    }

    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  throw new Error(
    `Timeout waiting for replication to stabilize. ` +
    `Active: ${lastTopology?.replicas.filter((r) => r.status === 'active').length ?? 0}/${lastTopology?.totalReplicas ?? 0}, ` +
    `High lag: ${lastTopology?.replicas.filter((r) => r.lag > maxLagMs).length ?? 0}`
  )
}

// ============================================================================
// E2E TEST SUITE
// ============================================================================

describe('Replication E2E Tests', { timeout: E2E_TIMEOUT * 3 }, () => {
  const testContext: ReplicaTestContext = {
    testRunId: '',
    primaryNs: '',
    replicaNs: [],
    results: [],
  }

  beforeAll(() => {
    testContext.testRunId = generateTestRunId()
  })

  afterAll(() => {
    if (testContext.results.length > 0) {
      record(testContext.results)
    }
  })

  // ==========================================================================
  // FULL REPLICA LIFECYCLE
  // ==========================================================================

  describe('Full Replica Lifecycle', { timeout: E2E_TIMEOUT * 2 }, () => {
    it.skipIf(!E2E_ENABLED)('should create replica, sync, promote, and serve traffic', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await benchmark({
        name: 'e2e-replica-full-lifecycle',
        target: TARGET,
        iterations: 3,
        warmup: 0,
        setup: async (ctx) => {
          // Initialize primary with test data
          await ctx.do.request('/init', {
            method: 'POST',
            body: JSON.stringify({
              testRunId: testContext.testRunId,
              dataSize: 100,
            }),
          })
        },
        run: async (ctx, iteration) => {
          const replicaId = `lifecycle-${testContext.testRunId}-${iteration}`

          // Phase 1: Create replica
          const createStart = Date.now()
          await ctx.do.request('/replica/create', {
            method: 'POST',
            body: JSON.stringify({
              replicaId,
              mode: 'async',
              targetColo: EU_COLOS[iteration % EU_COLOS.length],
            }),
          })
          const createDuration = Date.now() - createStart

          // Phase 2: Wait for initial sync to complete
          const syncStart = Date.now()
          const replicaStatus = await waitForReplicaStatus(ctx, replicaId, 'active')
          const syncDuration = Date.now() - syncStart

          expect(replicaStatus.status).toBe('active')
          expect(replicaStatus.lag).toBeLessThanOrEqual(MAX_REPLICATION_LAG_MS)

          // Phase 3: Serve read traffic from replica
          const readStart = Date.now()
          const readResult = await ctx.do.get<{ data: unknown; servedBy: string }>(
            `/read?source=replica&replicaId=${replicaId}`
          )
          const readDuration = Date.now() - readStart

          expect(readResult.servedBy).toBe(replicaId)

          // Phase 4: Promote replica to primary
          const promoteStart = Date.now()
          const failoverResult = await ctx.do.request<FailoverResult>('/replica/promote', {
            method: 'POST',
            body: JSON.stringify({ replicaId }),
          })
          const promoteDuration = Date.now() - promoteStart

          expect(failoverResult.success).toBe(true)
          expect(failoverResult.dataLoss).toBe(0)

          // Phase 5: Verify replica is now serving as primary
          const newPrimaryStatus = await ctx.do.get<ReplicaStatus>(`/replica/${replicaId}/status`)
          expect(newPrimaryStatus.role).toBe('primary')

          // Phase 6: Write to new primary
          const writeResult = await ctx.do.request<{ success: boolean }>('/write', {
            method: 'POST',
            body: JSON.stringify({
              key: `post-promotion-${iteration}`,
              value: { timestamp: Date.now() },
            }),
          })
          expect(writeResult.success).toBe(true)

          // Cleanup: Reset for next iteration
          await ctx.do.request('/replica/cleanup', {
            method: 'POST',
            body: JSON.stringify({ replicaId }),
          })

          return {
            createDuration,
            syncDuration,
            readDuration,
            promoteDuration,
          }
        },
        teardown: async (ctx) => {
          await ctx.do.request('/cleanup', {
            method: 'POST',
            body: JSON.stringify({ testRunId: testContext.testRunId }),
          })
        },
      })

      testContext.results.push(result)

      expect(result.stats.p95).toBeLessThan(MAX_REPLICA_LATENCY_MS * 5)
      expect(result.errors).toBeUndefined()
    })

    it.skipIf(!E2E_ENABLED)('should handle replica failure and recovery', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await benchmark({
        name: 'e2e-replica-failure-recovery',
        target: TARGET,
        iterations: 2,
        warmup: 0,
        run: async (ctx, iteration) => {
          const replicaId = `failure-recovery-${testContext.testRunId}-${iteration}`

          // Create and activate replica
          await ctx.do.request('/replica/create', {
            method: 'POST',
            body: JSON.stringify({
              replicaId,
              mode: 'async',
              targetColo: NA_COLOS[0],
            }),
          })

          await waitForReplicaStatus(ctx, replicaId, 'active')

          // Simulate replica failure
          await ctx.do.request('/simulate/replica-failure', {
            method: 'POST',
            body: JSON.stringify({
              replicaId,
              durationMs: 2000,
            }),
          })

          // Verify replica shows as disconnected/stale
          await new Promise((resolve) => setTimeout(resolve, 1000))
          const failedStatus = await ctx.do.get<ReplicaStatus>(`/replica/${replicaId}/status`)
          expect(['stale', 'disconnected']).toContain(failedStatus.status)

          // Wait for recovery
          await new Promise((resolve) => setTimeout(resolve, 3000))

          // Verify replica recovered
          const recoveredStatus = await waitForReplicaStatus(ctx, replicaId, 'active', 15000)
          expect(recoveredStatus.healthy).toBe(true)

          // Verify data integrity after recovery
          const integrity = await ctx.do.get<DataIntegrityResult>(`/replica/${replicaId}/integrity`)
          expect(integrity.consistent).toBe(true)

          return {
            recoveryTime: 3000,
            postRecoveryStatus: recoveredStatus.status,
            dataIntegrity: integrity.consistent,
          }
        },
      })

      testContext.results.push(result)
      expect(result.errors).toBeUndefined()
    })

    it.skipIf(!E2E_ENABLED)('should support rolling replica updates', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await benchmark({
        name: 'e2e-rolling-replica-updates',
        target: TARGET,
        iterations: 1,
        warmup: 0,
        run: async (ctx) => {
          const replicaIds = [
            `rolling-1-${testContext.testRunId}`,
            `rolling-2-${testContext.testRunId}`,
            `rolling-3-${testContext.testRunId}`,
          ]

          // Create multiple replicas
          for (const replicaId of replicaIds) {
            await ctx.do.request('/replica/create', {
              method: 'POST',
              body: JSON.stringify({
                replicaId,
                mode: 'async',
                targetColo: NA_COLOS[replicaIds.indexOf(replicaId) % NA_COLOS.length],
              }),
            })
          }

          // Wait for all to be active
          for (const replicaId of replicaIds) {
            await waitForReplicaStatus(ctx, replicaId, 'active')
          }

          // Perform rolling update (update one replica at a time)
          const updateResults: Array<{ replicaId: string; downtime: number }> = []

          for (const replicaId of replicaIds) {
            const updateStart = Date.now()

            // Take replica offline for update
            await ctx.do.request('/replica/update', {
              method: 'POST',
              body: JSON.stringify({
                replicaId,
                action: 'refresh', // Re-sync from primary
              }),
            })

            // Wait for it to come back online
            await waitForReplicaStatus(ctx, replicaId, 'active')

            updateResults.push({
              replicaId,
              downtime: Date.now() - updateStart,
            })

            // Verify other replicas are still serving
            const topology = await ctx.do.get<ReplicationTopology>('/replication/topology')
            const otherActive = topology.replicas.filter(
              (r) => r.id !== replicaId && r.status === 'active'
            )
            expect(otherActive.length).toBeGreaterThan(0)
          }

          return {
            replicaCount: replicaIds.length,
            updateResults,
            maxDowntime: Math.max(...updateResults.map((r) => r.downtime)),
          }
        },
      })

      testContext.results.push(result)
      expect(result.errors).toBeUndefined()
    })
  })

  // ==========================================================================
  // MULTI-REGION DEPLOYMENT
  // ==========================================================================

  describe('Multi-Region Deployment', { timeout: E2E_TIMEOUT * 2 }, () => {
    it.skipIf(!E2E_ENABLED)('should deploy replicas to real Cloudflare colos', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      // Target colos in different regions
      const targetColos: Colo[] = [NA_COLOS[0], EU_COLOS[0], APAC_COLOS[0]] // SJC, LHR, NRT

      const result = await benchmark({
        name: 'e2e-multi-region-deploy',
        target: TARGET,
        iterations: 1,
        warmup: 0,
        run: async (ctx) => {
          const replicaResults: Array<{
            colo: Colo
            replicaId: string
            createTime: number
            syncTime: number
            actualColo?: string
          }> = []

          // Deploy replicas to each region
          for (const colo of targetColos) {
            const replicaId = `multi-region-${colo}-${testContext.testRunId}`
            const createStart = Date.now()

            await ctx.do.request('/replica/create', {
              method: 'POST',
              body: JSON.stringify({
                replicaId,
                mode: 'async',
                targetColo: colo,
              }),
            })

            const createTime = Date.now() - createStart

            // Wait for active status
            const syncStart = Date.now()
            const status = await waitForReplicaStatus(ctx, replicaId, 'active')
            const syncTime = Date.now() - syncStart

            replicaResults.push({
              colo,
              replicaId,
              createTime,
              syncTime,
              actualColo: status.colo,
            })
          }

          // Verify topology shows all regions
          const topology = await ctx.do.get<ReplicationTopology>('/replication/topology')

          expect(topology.regions).toContain('NA')
          expect(topology.regions).toContain('EU')
          expect(topology.regions).toContain('APAC')
          expect(topology.totalReplicas).toBe(targetColos.length)
          expect(topology.healthyReplicas).toBe(targetColos.length)

          return {
            targetColos,
            replicaResults,
            topology,
          }
        },
      })

      testContext.results.push(result)
      expect(result.errors).toBeUndefined()
    })

    it.skipIf(!E2E_ENABLED)('should measure actual cross-region latency', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await benchmark({
        name: 'e2e-cross-region-latency',
        target: TARGET,
        iterations: 10,
        warmup: 2,
        setup: async (ctx) => {
          // Ensure we have replicas in multiple regions
          const colos: Colo[] = [NA_COLOS[0], EU_COLOS[0], APAC_COLOS[0]]

          for (const colo of colos) {
            const replicaId = `latency-${colo}-${testContext.testRunId}`
            await ctx.do.request('/replica/create', {
              method: 'POST',
              body: JSON.stringify({
                replicaId,
                mode: 'async',
                targetColo: colo,
              }),
            })
            await waitForReplicaStatus(ctx, replicaId, 'active')
          }

          // Write some test data
          await ctx.do.request('/write', {
            method: 'POST',
            body: JSON.stringify({
              key: 'latency-test-data',
              value: { timestamp: Date.now() },
            }),
          })

          // Wait for replication to stabilize
          await waitForReplicationStable(ctx)
        },
        run: async (ctx, iteration) => {
          const colos: Colo[] = [NA_COLOS[0], EU_COLOS[0], APAC_COLOS[0]]
          const targetColo = colos[iteration % colos.length]

          // Measure read latency from specific replica
          const start = Date.now()
          const readResult = await ctx.do.get<{
            data: unknown
            servedBy: string
            servedByColo: string
            replicationLag: number
          }>(`/read?key=latency-test-data&preferColo=${targetColo}`)
          const latency = Date.now() - start

          return {
            targetColo,
            actualColo: readResult.servedByColo,
            latencyMs: latency,
            replicationLag: readResult.replicationLag,
          }
        },
      })

      testContext.results.push(result)

      // Cross-region reads should complete within reasonable time
      expect(result.stats.p95).toBeLessThan(2000)
    })

    it.skipIf(!E2E_ENABLED)('should verify geographic routing', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await benchmark({
        name: 'e2e-geographic-routing',
        target: TARGET,
        iterations: 20,
        warmup: 5,
        run: async (ctx) => {
          // Request with "nearest" routing - should hit closest replica
          const readResult = await ctx.do.get<{
            data: unknown
            servedBy: string
            servedByColo: string
            routingDecision: string
          }>('/read?key=latency-test-data&routing=nearest')

          return {
            servedByColo: readResult.servedByColo,
            routingDecision: readResult.routingDecision,
          }
        },
      })

      testContext.results.push(result)

      // All reads should be served (no errors)
      expect(result.errors).toBeUndefined()
    })
  })

  // ==========================================================================
  // FAILOVER SCENARIOS
  // ==========================================================================

  describe('Failover Scenarios', { timeout: E2E_TIMEOUT * 3 }, () => {
    it.skipIf(!E2E_ENABLED)('should handle simulated primary failure', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await benchmark({
        name: 'e2e-primary-failover',
        target: TARGET,
        iterations: 2,
        warmup: 0,
        setup: async (ctx) => {
          // Create test data on primary
          await ctx.do.request('/init', {
            method: 'POST',
            body: JSON.stringify({
              testRunId: testContext.testRunId,
              dataSize: 50,
            }),
          })

          // Create a replica for failover
          const replicaId = `failover-${testContext.testRunId}`
          await ctx.do.request('/replica/create', {
            method: 'POST',
            body: JSON.stringify({
              replicaId,
              mode: 'sync', // Sync mode for zero data loss
              targetColo: NA_COLOS[1],
            }),
          })

          await waitForReplicaStatus(ctx, replicaId, 'active')
        },
        run: async (ctx, iteration) => {
          const replicaId = `failover-${testContext.testRunId}`

          // Record pre-failover state
          const preFailoverTopology = await ctx.do.get<ReplicationTopology>('/replication/topology')
          const preFailoverSequence = preFailoverTopology.primary.sequence

          // Simulate primary failure
          await ctx.do.request('/simulate/primary-failure', {
            method: 'POST',
            body: JSON.stringify({
              failureType: 'network', // Simulates network partition
              durationMs: 10000, // Primary stays "down"
            }),
          })

          // Trigger automatic failover (if enabled) or manual
          const failoverStart = Date.now()
          const failoverResult = await ctx.do.request<FailoverResult>('/failover/trigger', {
            method: 'POST',
            body: JSON.stringify({
              promoteReplica: replicaId,
              reason: 'e2e-test-primary-failure',
            }),
          })
          const failoverDuration = Date.now() - failoverStart

          expect(failoverResult.success).toBe(true)
          expect(failoverDuration).toBeLessThan(MAX_FAILOVER_TIME_MS)

          // Verify new primary is serving
          const postFailoverTopology = await ctx.do.get<ReplicationTopology>('/replication/topology')
          expect(postFailoverTopology.primary.ns).toContain(replicaId)

          // Restore original primary
          await ctx.do.request('/simulate/restore-primary', {
            method: 'POST',
          })

          return {
            iteration,
            preFailoverSequence,
            failoverDuration,
            newPrimary: failoverResult.newPrimary,
            dataLoss: failoverResult.dataLoss,
          }
        },
      })

      testContext.results.push(result)

      expect(result.stats.p95).toBeLessThan(MAX_FAILOVER_TIME_MS)
      expect(result.errors).toBeUndefined()
    })

    it.skipIf(!E2E_ENABLED)('should verify data integrity post-failover', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await benchmark({
        name: 'e2e-failover-data-integrity',
        target: TARGET,
        iterations: 1,
        warmup: 0,
        run: async (ctx) => {
          const testDataSize = 100
          const testKey = `integrity-test-${testContext.testRunId}`

          // Write known test data before failover
          const testData = Array.from({ length: testDataSize }, (_, i) => ({
            id: `item-${i}`,
            value: i * 100,
            checksum: `chk-${i}`,
          }))

          await ctx.do.request('/write/batch', {
            method: 'POST',
            body: JSON.stringify({
              key: testKey,
              items: testData,
            }),
          })

          // Create and sync replica
          const replicaId = `integrity-${testContext.testRunId}`
          await ctx.do.request('/replica/create', {
            method: 'POST',
            body: JSON.stringify({
              replicaId,
              mode: 'sync',
              targetColo: EU_COLOS[0],
            }),
          })

          await waitForReplicaStatus(ctx, replicaId, 'active')

          // Perform failover
          await ctx.do.request('/failover/trigger', {
            method: 'POST',
            body: JSON.stringify({
              promoteReplica: replicaId,
              reason: 'integrity-test',
            }),
          })

          // Verify all data is present on new primary
          const verifyResult = await ctx.do.get<{
            totalItems: number
            matchingItems: number
            missingItems: string[]
            corruptedItems: string[]
          }>(`/verify?key=${testKey}&expectedCount=${testDataSize}`)

          expect(verifyResult.totalItems).toBe(testDataSize)
          expect(verifyResult.matchingItems).toBe(testDataSize)
          expect(verifyResult.missingItems).toHaveLength(0)
          expect(verifyResult.corruptedItems).toHaveLength(0)

          // Run full integrity check
          const integrity = await ctx.do.get<DataIntegrityResult>('/replication/integrity')

          expect(integrity.consistent).toBe(true)
          expect(integrity.checksumMatch).toBe(true)
          expect(integrity.missingItems).toBe(0)
          expect(integrity.extraItems).toBe(0)
          expect(integrity.divergentItems).toBe(0)

          return {
            testDataSize,
            verifyResult,
            integrity,
          }
        },
      })

      testContext.results.push(result)
      expect(result.errors).toBeUndefined()
    })

    it.skipIf(!E2E_ENABLED)('should measure failover time', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await benchmark({
        name: 'e2e-failover-timing',
        target: TARGET,
        iterations: 5,
        warmup: 1,
        setup: async (ctx) => {
          // Prepare multiple replicas for failover testing
          const replicaIds = [
            `timing-1-${testContext.testRunId}`,
            `timing-2-${testContext.testRunId}`,
          ]

          for (const replicaId of replicaIds) {
            await ctx.do.request('/replica/create', {
              method: 'POST',
              body: JSON.stringify({
                replicaId,
                mode: 'async',
                targetColo: NA_COLOS[replicaIds.indexOf(replicaId)],
              }),
            })
          }

          for (const replicaId of replicaIds) {
            await waitForReplicaStatus(ctx, replicaId, 'active')
          }
        },
        run: async (ctx, iteration) => {
          const replicaId = iteration % 2 === 0
            ? `timing-1-${testContext.testRunId}`
            : `timing-2-${testContext.testRunId}`

          // Measure complete failover cycle
          const startTime = Date.now()

          // Detection phase (simulated)
          await ctx.do.request('/simulate/primary-unavailable', {
            method: 'POST',
            body: JSON.stringify({ durationMs: 500 }),
          })

          const detectionTime = Date.now() - startTime

          // Election/promotion phase
          const promotionStart = Date.now()
          const failoverResult = await ctx.do.request<FailoverResult>('/failover/trigger', {
            method: 'POST',
            body: JSON.stringify({
              promoteReplica: replicaId,
              reason: 'timing-test',
            }),
          })
          const promotionTime = Date.now() - promotionStart

          // Reconfiguration phase (wait for topology to stabilize)
          const reconfigStart = Date.now()
          await waitForReplicationStable(ctx, MAX_REPLICATION_LAG_MS, 10000)
          const reconfigTime = Date.now() - reconfigStart

          const totalTime = Date.now() - startTime

          // Reset for next iteration
          await ctx.do.request('/failover/reset', {
            method: 'POST',
          })

          return {
            iteration,
            replicaId,
            detectionTime,
            promotionTime,
            reconfigTime,
            totalTime,
            failoverResult,
          }
        },
      })

      testContext.results.push(result)

      // Failover should complete within acceptable time
      expect(result.stats.p95).toBeLessThan(MAX_FAILOVER_TIME_MS)
    })

    it.skipIf(!E2E_ENABLED)('should handle region-wide failure and cross-region failover', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await benchmark({
        name: 'e2e-cross-region-failover',
        target: TARGET,
        iterations: 1,
        warmup: 0,
        run: async (ctx) => {
          // Deploy replicas across regions
          const regionReplicas = [
            { replicaId: `cross-na-${testContext.testRunId}`, colo: NA_COLOS[0], region: 'NA' },
            { replicaId: `cross-eu-${testContext.testRunId}`, colo: EU_COLOS[0], region: 'EU' },
            { replicaId: `cross-apac-${testContext.testRunId}`, colo: APAC_COLOS[0], region: 'APAC' },
          ]

          for (const { replicaId, colo } of regionReplicas) {
            await ctx.do.request('/replica/create', {
              method: 'POST',
              body: JSON.stringify({
                replicaId,
                mode: 'async',
                targetColo: colo,
              }),
            })
          }

          for (const { replicaId } of regionReplicas) {
            await waitForReplicaStatus(ctx, replicaId, 'active')
          }

          // Simulate primary region (NA) failure
          await ctx.do.request('/simulate/region-failure', {
            method: 'POST',
            body: JSON.stringify({
              region: 'NA',
              durationMs: 30000,
            }),
          })

          // Trigger cross-region failover to EU replica
          const failoverStart = Date.now()
          const failoverResult = await ctx.do.request<FailoverResult>('/failover/trigger', {
            method: 'POST',
            body: JSON.stringify({
              promoteReplica: `cross-eu-${testContext.testRunId}`,
              reason: 'region-failure',
            }),
          })
          const failoverDuration = Date.now() - failoverStart

          expect(failoverResult.success).toBe(true)

          // Verify EU is now primary
          const topology = await ctx.do.get<ReplicationTopology>('/replication/topology')
          expect(topology.primary.colo).toBe(EU_COLOS[0])

          // APAC should have reconfigured to EU
          const apacReplica = topology.replicas.find((r) => r.colo === APAC_COLOS[0])
          expect(apacReplica?.status).toBe('active')

          // Restore NA region
          await ctx.do.request('/simulate/restore-region', {
            method: 'POST',
            body: JSON.stringify({ region: 'NA' }),
          })

          return {
            failoverDuration,
            newPrimaryRegion: 'EU',
            dataLoss: failoverResult.dataLoss,
          }
        },
      })

      testContext.results.push(result)
      expect(result.errors).toBeUndefined()
    })
  })

  // ==========================================================================
  // CONSISTENCY VERIFICATION
  // ==========================================================================

  describe('Consistency Verification', { timeout: E2E_TIMEOUT * 2 }, () => {
    it.skipIf(!E2E_ENABLED)('should maintain consistency during high write load', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await benchmark({
        name: 'e2e-write-load-consistency',
        target: TARGET,
        iterations: 1,
        warmup: 0,
        run: async (ctx) => {
          const replicaId = `write-load-${testContext.testRunId}`

          // Create replica
          await ctx.do.request('/replica/create', {
            method: 'POST',
            body: JSON.stringify({
              replicaId,
              mode: 'async',
              targetColo: NA_COLOS[0],
            }),
          })

          await waitForReplicaStatus(ctx, replicaId, 'active')

          // Perform concurrent writes while checking consistency
          const writeCount = 100
          const writePromises = Array.from({ length: writeCount }, (_, i) =>
            ctx.do.request('/write', {
              method: 'POST',
              body: JSON.stringify({
                key: `load-${i}`,
                value: { index: i, timestamp: Date.now() },
              }),
            })
          )

          await Promise.all(writePromises)

          // Wait for replication to catch up
          await waitForReplicationStable(ctx, MAX_REPLICATION_LAG_MS * 2, 30000)

          // Verify all writes are on both primary and replica
          const primaryCount = await ctx.do.get<{ count: number }>('/count?pattern=load-*')
          const replicaCount = await ctx.do.get<{ count: number }>(
            `/count?pattern=load-*&source=replica&replicaId=${replicaId}`
          )

          expect(primaryCount.count).toBe(writeCount)
          expect(replicaCount.count).toBe(writeCount)

          // Full integrity check
          const integrity = await ctx.do.get<DataIntegrityResult>('/replication/integrity')
          expect(integrity.consistent).toBe(true)

          return {
            writeCount,
            primaryCount: primaryCount.count,
            replicaCount: replicaCount.count,
            integrity,
          }
        },
      })

      testContext.results.push(result)
      expect(result.errors).toBeUndefined()
    })

    it.skipIf(!E2E_ENABLED)('should verify read-your-writes consistency', async () => {
      const skipReason = skipIfNoE2E()
      if (skipReason) return

      const result = await benchmark({
        name: 'e2e-read-your-writes',
        target: TARGET,
        iterations: 20,
        warmup: 5,
        setup: async (ctx) => {
          const replicaId = `ryw-${testContext.testRunId}`
          await ctx.do.request('/replica/create', {
            method: 'POST',
            body: JSON.stringify({
              replicaId,
              mode: 'async',
              targetColo: NA_COLOS[0],
            }),
          })
          await waitForReplicaStatus(ctx, replicaId, 'active')
        },
        run: async (ctx, iteration) => {
          const key = `ryw-${iteration}-${Date.now()}`
          const value = { iteration, timestamp: Date.now() }

          // Write to primary
          await ctx.do.request('/write', {
            method: 'POST',
            body: JSON.stringify({ key, value }),
          })

          // Immediate read with session consistency
          const readResult = await ctx.do.get<{
            value: typeof value | null
            consistent: boolean
            sessionVersion: number
          }>(`/read?key=${key}&consistency=session`)

          expect(readResult.consistent).toBe(true)
          expect(readResult.value).toEqual(value)

          return {
            key,
            consistent: readResult.consistent,
            sessionVersion: readResult.sessionVersion,
          }
        },
      })

      testContext.results.push(result)

      // All reads should be consistent
      expect(result.errors).toBeUndefined()
    })
  })
})
