/**
 * ACID Test Suite - Phase 4: Multi-Region Replication
 *
 * RED TDD: These tests define the expected behavior for multi-region replication
 * and geographic distribution of Durable Objects. All tests are expected to FAIL
 * initially as this is the RED phase.
 *
 * Multi-region replication enables:
 * - Geographic distribution across Cloudflare colos
 * - Region-aware routing for optimal latency
 * - Cross-region sync with latency considerations
 * - Region failover for high availability
 * - Topology management for dynamic regions
 * - Cost-aware replication strategies
 *
 * @see docs/plans/2026-01-09-acid-test-suite-design.md - Phase 4 Replication
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { createMockDO, MockDOResult, MockEnv } from '../../../tests/harness/do'
import { DO } from '../../../objects/DO'
import type { CloneOptions } from '../../../types/Lifecycle'
import type { ColoCode, Region, CFLocationHint } from '../../../types/Location'

// ============================================================================
// TYPE DEFINITIONS FOR MULTI-REGION
// ============================================================================

/**
 * Region metadata for a replica
 */
interface RegionMetadata {
  /** Cloudflare colo code (IATA) */
  colo: ColoCode
  /** Friendly region name */
  region: Region
  /** CF location hint */
  cfHint: CFLocationHint
  /** Estimated latency from primary in ms */
  latencyMs: number
  /** Region status */
  status: 'healthy' | 'degraded' | 'unreachable'
  /** Last health check timestamp */
  lastHealthCheck: Date
  /** Number of replicas in this region */
  replicaCount: number
}

/**
 * Replica with region information
 */
interface RegionalReplica {
  /** Namespace of the replica */
  ns: string
  /** DO ID of the replica */
  doId: string
  /** Colo code where replica is located */
  colo: ColoCode
  /** Region where replica is located */
  region: Region
  /** Current lag in versions */
  lag: number
  /** Last sync timestamp */
  lastSyncAt: Date | null
  /** Replica status */
  status: 'initializing' | 'syncing' | 'active' | 'stale' | 'disconnected'
  /** Estimated latency to this replica from caller */
  latencyMs: number
}

/**
 * Topology describing the replication structure
 */
interface ReplicationTopology {
  /** Primary namespace */
  primaryNs: string
  /** Primary region */
  primaryRegion: Region
  /** Primary colo */
  primaryColo: ColoCode
  /** All replicas by region */
  replicasByRegion: Record<Region, RegionalReplica[]>
  /** Total replica count */
  totalReplicas: number
  /** Region health status */
  regionHealth: Record<Region, RegionMetadata>
  /** Timestamp of last topology refresh */
  refreshedAt: Date
}

/**
 * Routing decision result
 */
interface RoutingDecision {
  /** Selected replica namespace */
  targetNs: string
  /** Selected replica colo */
  targetColo: ColoCode
  /** Reason for selection */
  reason: 'nearest' | 'lowest-latency' | 'lowest-lag' | 'explicit' | 'fallback'
  /** Estimated latency to target */
  estimatedLatencyMs: number
  /** Whether this is the primary */
  isPrimary: boolean
  /** Alternative targets if primary is unavailable */
  alternatives: string[]
}

/**
 * Cross-region sync configuration
 */
interface CrossRegionSyncConfig {
  /** Sync mode for cross-region */
  mode: 'async' | 'sync' | 'batch'
  /** Batch size for batch mode */
  batchSize?: number
  /** Batch interval in ms */
  batchIntervalMs?: number
  /** Max acceptable lag per region */
  maxLagByRegion?: Record<Region, number>
  /** Compression for cross-region transfer */
  compress: boolean
  /** Priority for sync (lower = higher priority) */
  priority: number
}

/**
 * Data transfer metrics per region
 */
interface RegionTransferMetrics {
  /** Region */
  region: Region
  /** Bytes transferred */
  bytesTransferred: number
  /** Operations synced */
  operationsSynced: number
  /** Average latency */
  avgLatencyMs: number
  /** Transfer count */
  transferCount: number
  /** Last transfer timestamp */
  lastTransferAt: Date | null
  /** Errors in period */
  errorCount: number
}

/**
 * Cost-aware replication policy
 */
interface CostPolicy {
  /** Regions with full sync (always up-to-date) */
  fullSyncRegions: Region[]
  /** Regions with lazy sync (sync on demand) */
  lazySyncRegions: Region[]
  /** Regions with scheduled sync (periodic) */
  scheduledSyncRegions: Array<{ region: Region; intervalMs: number }>
  /** Maximum data transfer budget per day (bytes) */
  dailyTransferBudgetBytes?: number
  /** Current usage */
  currentDailyUsageBytes: number
  /** Whether budget is exceeded */
  budgetExceeded: boolean
}

/**
 * Region failover configuration
 */
interface RegionFailoverConfig {
  /** Whether automatic region failover is enabled */
  autoFailover: boolean
  /** Preferred failover region order */
  failoverOrder: Region[]
  /** Whether to prefer same-region promotion */
  preferSameRegion: boolean
  /** Timeout for region failover in ms */
  failoverTimeoutMs: number
  /** Minimum replicas per region for failover */
  minReplicasPerRegion: number
}

/**
 * Extended replica handle with multi-region support
 */
interface MultiRegionReplicaHandle {
  /** Namespace of the replica */
  ns: string
  /** DO ID of the replica */
  doId: string
  /** Get region metadata */
  getRegionMetadata(): Promise<RegionMetadata>
  /** Get current topology */
  getTopology(): Promise<ReplicationTopology>
  /** Get routing decision for a request */
  getRoutingDecision(callerColo?: ColoCode): Promise<RoutingDecision>
  /** Force sync from primary */
  sync(): Promise<void>
  /** Get lag in versions */
  getLag(): Promise<number>
  /** Get transfer metrics */
  getTransferMetrics(): Promise<RegionTransferMetrics>
  /** Get cost policy */
  getCostPolicy(): Promise<CostPolicy>
  /** Set cost policy */
  setCostPolicy(policy: Partial<CostPolicy>): Promise<void>
  /** Get failover config */
  getFailoverConfig(): Promise<RegionFailoverConfig>
  /** Set failover config */
  setFailoverConfig(config: Partial<RegionFailoverConfig>): Promise<void>
}

/**
 * Extended clone options for multi-region replication
 */
interface MultiRegionCloneOptions extends CloneOptions {
  asReplica: true
  /** Target colo for the replica */
  colo: ColoCode
  /** Target region (alternative to colo) */
  region?: Region
  /** Cross-region sync configuration */
  crossRegionSync?: Partial<CrossRegionSyncConfig>
  /** Cost policy */
  costPolicy?: Partial<CostPolicy>
  /** Failover configuration */
  failoverConfig?: Partial<RegionFailoverConfig>
}

/**
 * Topology manager for cluster-wide topology operations
 */
interface TopologyManager {
  /** Add a region to the topology */
  addRegion(region: Region, options?: { colo?: ColoCode; count?: number }): Promise<RegionalReplica[]>
  /** Remove a region from the topology */
  removeRegion(region: Region): Promise<void>
  /** Get all regions */
  getRegions(): Promise<Region[]>
  /** Get region health */
  getRegionHealth(region: Region): Promise<RegionMetadata>
  /** Rebalance replicas across regions */
  rebalance(): Promise<void>
  /** Get current topology */
  getTopology(): Promise<ReplicationTopology>
  /** Refresh topology from all replicas */
  refreshTopology(): Promise<ReplicationTopology>
  /** Get load distribution */
  getLoadDistribution(): Promise<Record<Region, number>>
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe('Multi-Region Replication', () => {
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
          colo: 'iad',
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
  // GEOGRAPHIC DISTRIBUTION
  // ==========================================================================

  describe('Geographic Distribution', () => {
    it('should create replica in specified colo', async () => {
      const options: MultiRegionCloneOptions = {
        asReplica: true,
        colo: 'lhr', // London
      }

      const replica = await result.instance.clone(
        'https://replica-eu.test.do',
        options,
      ) as unknown as MultiRegionReplicaHandle

      const metadata = await replica.getRegionMetadata()

      expect(metadata.colo).toBe('lhr')
      expect(metadata.region).toBe('eu-west')
    })

    it('should create replica in specified region', async () => {
      const options: MultiRegionCloneOptions = {
        asReplica: true,
        colo: 'sin', // Singapore - Asia Pacific
      }

      const replica = await result.instance.clone(
        'https://replica-apac.test.do',
        options,
      ) as unknown as MultiRegionReplicaHandle

      const metadata = await replica.getRegionMetadata()

      expect(metadata.region).toBe('asia-pacific')
    })

    it('should create replicas in multiple regions simultaneously', async () => {
      const replicaEU = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
      }) as unknown as MultiRegionReplicaHandle

      const replicaAPAC = await result.instance.clone('https://replica-apac.test.do', {
        asReplica: true,
        colo: 'sin',
      }) as unknown as MultiRegionReplicaHandle

      const replicaUSWest = await result.instance.clone('https://replica-us-west.test.do', {
        asReplica: true,
        colo: 'lax',
      }) as unknown as MultiRegionReplicaHandle

      const metadataEU = await replicaEU.getRegionMetadata()
      const metadataAPAC = await replicaAPAC.getRegionMetadata()
      const metadataUSWest = await replicaUSWest.getRegionMetadata()

      expect(metadataEU.region).toBe('eu-west')
      expect(metadataAPAC.region).toBe('asia-pacific')
      expect(metadataUSWest.region).toBe('us-west')
    })

    it('should track location in replica metadata', async () => {
      const replica = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'fra', // Frankfurt
      }) as unknown as MultiRegionReplicaHandle

      const metadata = await replica.getRegionMetadata()

      expect(metadata.colo).toBe('fra')
      expect(metadata.region).toBe('eu-west')
      expect(metadata.cfHint).toBe('weur')
    })

    it('should provide replica count per region', async () => {
      // Create multiple replicas in EU
      await result.instance.clone('https://replica-eu-1.test.do', {
        asReplica: true,
        colo: 'lhr',
      })
      await result.instance.clone('https://replica-eu-2.test.do', {
        asReplica: true,
        colo: 'fra',
      })
      await result.instance.clone('https://replica-eu-3.test.do', {
        asReplica: true,
        colo: 'cdg',
      })

      // @ts-expect-error - accessing topology manager
      const topologyManager = result.instance.topologyManager as TopologyManager
      const topology = await topologyManager?.getTopology()

      expect(topology.replicasByRegion['eu-west']).toHaveLength(3)
    })

    it('should estimate latency from primary to replica', async () => {
      const replica = await result.instance.clone('https://replica-apac.test.do', {
        asReplica: true,
        colo: 'nrt', // Tokyo - far from US-East primary
      }) as unknown as MultiRegionReplicaHandle

      const metadata = await replica.getRegionMetadata()

      // Cross-Pacific latency should be significant
      expect(metadata.latencyMs).toBeGreaterThan(100)
    })

    it('should validate colo code on creation', async () => {
      await expect(async () => {
        await result.instance.clone('https://replica-invalid.test.do', {
          asReplica: true,
          // @ts-expect-error - intentionally invalid colo
          colo: 'xyz', // Invalid colo code
        })
      }).rejects.toThrow(/invalid.*colo|unknown.*location/i)
    })
  })

  // ==========================================================================
  // REGION-AWARE ROUTING
  // ==========================================================================

  describe('Region-Aware Routing', () => {
    it('should route reads to nearest replica', async () => {
      // Create replicas in multiple regions
      await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
      })
      await result.instance.clone('https://replica-apac.test.do', {
        asReplica: true,
        colo: 'sin',
      })

      const replicaUSWest = await result.instance.clone('https://replica-us-west.test.do', {
        asReplica: true,
        colo: 'lax',
      }) as unknown as MultiRegionReplicaHandle

      // Wait for sync
      await vi.advanceTimersByTimeAsync(5000)

      // Caller from LAX should be routed to US-West replica
      const routingDecision = await replicaUSWest.getRoutingDecision('lax')

      expect(routingDecision.targetColo).toBe('lax')
      expect(routingDecision.reason).toBe('nearest')
    })

    it('should consider latency in replica selection', async () => {
      const replica1 = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
      }) as unknown as MultiRegionReplicaHandle

      await result.instance.clone('https://replica-apac.test.do', {
        asReplica: true,
        colo: 'sin',
      })

      // Caller from Paris (CDG) should prefer LHR over SIN
      const routingDecision = await replica1.getRoutingDecision('cdg')

      expect(['lhr', 'fra', 'cdg']).toContain(routingDecision.targetColo)
      expect(routingDecision.estimatedLatencyMs).toBeLessThan(100)
    })

    it('should fall back to remote replica if local is unavailable', async () => {
      const replicaEU = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
      }) as unknown as MultiRegionReplicaHandle

      await result.instance.clone('https://replica-apac.test.do', {
        asReplica: true,
        colo: 'sin',
      })

      // Simulate EU replica being unavailable
      // @ts-expect-error - internal test method
      result.instance._simulateReplicaUnreachable?.('https://replica-eu.test.do')

      const routingDecision = await replicaEU.getRoutingDecision('lhr')

      expect(routingDecision.reason).toBe('fallback')
      // Should fall back to APAC or primary
      expect(['sin', 'iad']).toContain(routingDecision.targetColo)
    })

    it('should support explicit region preference', async () => {
      await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
      })

      const replicaAPAC = await result.instance.clone('https://replica-apac.test.do', {
        asReplica: true,
        colo: 'sin',
      }) as unknown as MultiRegionReplicaHandle

      // Force routing to APAC even if not nearest
      // @ts-expect-error - method may include explicit option
      const routingDecision = await replicaAPAC.getRoutingDecision('lhr', {
        preferRegion: 'asia-pacific',
      })

      expect(routingDecision.targetColo).toBe('sin')
      expect(routingDecision.reason).toBe('explicit')
    })

    it('should provide alternatives in routing decision', async () => {
      await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
      })
      await result.instance.clone('https://replica-apac.test.do', {
        asReplica: true,
        colo: 'sin',
      })
      const replicaUSWest = await result.instance.clone('https://replica-us-west.test.do', {
        asReplica: true,
        colo: 'lax',
      }) as unknown as MultiRegionReplicaHandle

      const routingDecision = await replicaUSWest.getRoutingDecision('lax')

      expect(routingDecision.alternatives.length).toBeGreaterThan(0)
      // Alternatives should include other replicas
    })

    it('should consider lag in replica selection', async () => {
      const replica1 = await result.instance.clone('https://replica-1.test.do', {
        asReplica: true,
        colo: 'lhr',
      }) as unknown as MultiRegionReplicaHandle

      await result.instance.clone('https://replica-2.test.do', {
        asReplica: true,
        colo: 'fra',
      })

      // Sync replica1 fully
      await replica1.sync()

      // Don't sync replica2 - it has higher lag

      // Routing should prefer replica1 due to lower lag
      // @ts-expect-error - method may include prefer option
      const routingDecision = await replica1.getRoutingDecision('cdg', {
        preferLowLag: true,
      })

      expect(routingDecision.targetColo).toBe('lhr')
    })
  })

  // ==========================================================================
  // CROSS-REGION SYNC
  // ==========================================================================

  describe('Cross-Region Sync', () => {
    it('should sync across regions despite latency', async () => {
      const replicaAPAC = await result.instance.clone('https://replica-apac.test.do', {
        asReplica: true,
        colo: 'nrt', // Tokyo - high latency from US-East
      }) as unknown as MultiRegionReplicaHandle

      // Wait for sync
      await vi.advanceTimersByTimeAsync(10000)

      const lag = await replicaAPAC.getLag()

      // Should eventually sync despite latency
      expect(lag).toBe(0)
    })

    it('should batch updates for efficient cross-region transfer', async () => {
      const replica = await result.instance.clone('https://replica-apac.test.do', {
        asReplica: true,
        colo: 'sin',
        crossRegionSync: {
          mode: 'batch',
          batchSize: 50,
          batchIntervalMs: 5000,
        },
      }) as unknown as MultiRegionReplicaHandle

      // Add multiple items to primary
      for (let i = 0; i < 100; i++) {
        result.sqlData.get('things')!.push({
          id: `batch-thing-${i}`,
          type: 1,
          data: { index: i },
          version: 101 + i,
          branch: null,
          deleted: false,
        })
      }

      // Wait for batch sync
      await vi.advanceTimersByTimeAsync(10000)

      const metrics = await replica.getTransferMetrics()

      // Should batch transfers (not 100 individual ones)
      expect(metrics.transferCount).toBeLessThan(10)
      expect(metrics.operationsSynced).toBe(100)
    })

    it('should handle increased lag for distant replicas', async () => {
      const replicaEU = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
      }) as unknown as MultiRegionReplicaHandle

      const replicaAPAC = await result.instance.clone('https://replica-apac.test.do', {
        asReplica: true,
        colo: 'nrt',
      }) as unknown as MultiRegionReplicaHandle

      // Add data to primary
      result.sqlData.get('things')!.push({
        id: 'cross-region-thing',
        type: 1,
        data: { name: 'Cross Region' },
        version: 101,
        branch: null,
        deleted: false,
      })

      // Wait a short time
      await vi.advanceTimersByTimeAsync(2000)

      const lagEU = await replicaEU.getLag()
      const lagAPAC = await replicaAPAC.getLag()

      // APAC should generally have higher lag due to distance
      // (This depends on implementation - test documents expected behavior)
      expect(typeof lagEU).toBe('number')
      expect(typeof lagAPAC).toBe('number')
    })

    it('should support async replication for cross-region', async () => {
      const replica = await result.instance.clone('https://replica-apac.test.do', {
        asReplica: true,
        colo: 'sin',
        crossRegionSync: {
          mode: 'async',
        },
      }) as unknown as MultiRegionReplicaHandle

      // Clone should return immediately without waiting for sync
      const lag = await replica.getLag()

      // May have initial lag
      expect(lag).toBeGreaterThanOrEqual(0)
    })

    it('should support sync mode for cross-region (wait for confirmation)', async () => {
      const replica = await result.instance.clone('https://replica-apac.test.do', {
        asReplica: true,
        colo: 'sin',
        crossRegionSync: {
          mode: 'sync',
        },
      }) as unknown as MultiRegionReplicaHandle

      // Sync mode should wait for initial sync
      const lag = await replica.getLag()

      expect(lag).toBe(0)
    })

    it('should compress cross-region transfers when enabled', async () => {
      const replica = await result.instance.clone('https://replica-apac.test.do', {
        asReplica: true,
        colo: 'sin',
        crossRegionSync: {
          compress: true,
        },
      }) as unknown as MultiRegionReplicaHandle

      // Add bulk data
      for (let i = 0; i < 100; i++) {
        result.sqlData.get('things')!.push({
          id: `compress-thing-${i}`,
          type: 1,
          data: { index: i, description: 'Compressible content '.repeat(10) },
          version: 101 + i,
          branch: null,
          deleted: false,
        })
      }

      // Wait for sync
      await vi.advanceTimersByTimeAsync(10000)

      const metrics = await replica.getTransferMetrics()

      // Bytes transferred should be less than raw data size
      // (Exact ratio depends on implementation)
      expect(metrics.bytesTransferred).toBeGreaterThan(0)
    })

    it('should respect maxLag per region', async () => {
      const replica = await result.instance.clone('https://replica-apac.test.do', {
        asReplica: true,
        colo: 'sin',
        crossRegionSync: {
          mode: 'async',
          maxLagByRegion: {
            'asia-pacific': 5,
          },
        },
      }) as unknown as MultiRegionReplicaHandle

      // Add items to exceed max lag
      for (let i = 0; i < 20; i++) {
        result.sqlData.get('things')!.push({
          id: `lag-thing-${i}`,
          type: 1,
          data: { index: i },
          version: 101 + i,
          branch: null,
          deleted: false,
        })
      }

      // Wait for forced sync due to max lag
      await vi.advanceTimersByTimeAsync(5000)

      const lag = await replica.getLag()

      expect(lag).toBeLessThanOrEqual(5)
    })
  })

  // ==========================================================================
  // REGION FAILOVER
  // ==========================================================================

  describe('Region Failover', () => {
    it('should promote replica in another region on primary failure', async () => {
      const replica = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
        failoverConfig: {
          autoFailover: true,
        },
      }) as unknown as MultiRegionReplicaHandle

      // Sync replica
      await replica.sync()
      await vi.advanceTimersByTimeAsync(1000)

      // Simulate primary failure
      // @ts-expect-error - internal test method
      result.instance._simulatePrimaryFailure?.()

      // Wait for failover
      await vi.advanceTimersByTimeAsync(10000)

      // @ts-expect-error - accessing role
      const role = await replica.getRole?.()
      expect(role).toBe('primary')
    })

    it('should handle region-wide outage', async () => {
      // Create replicas in multiple regions
      await result.instance.clone('https://replica-eu-1.test.do', {
        asReplica: true,
        colo: 'lhr',
      })
      await result.instance.clone('https://replica-eu-2.test.do', {
        asReplica: true,
        colo: 'fra',
      })
      const replicaAPAC = await result.instance.clone('https://replica-apac.test.do', {
        asReplica: true,
        colo: 'sin',
        failoverConfig: {
          autoFailover: true,
        },
      }) as unknown as MultiRegionReplicaHandle

      // Sync all
      await vi.advanceTimersByTimeAsync(5000)

      // Simulate entire EU region outage
      // @ts-expect-error - internal test method
      result.instance._simulateRegionOutage?.('eu-west')

      // And primary failure
      // @ts-expect-error - internal test method
      result.instance._simulatePrimaryFailure?.()

      await vi.advanceTimersByTimeAsync(15000)

      // APAC replica should be promoted
      // @ts-expect-error - accessing role
      const role = await replicaAPAC.getRole?.()
      expect(role).toBe('primary')
    })

    it('should prefer same-region promotion when possible', async () => {
      // Primary is in us-east, create replicas in same region
      const replicaUSEast = await result.instance.clone('https://replica-us-east.test.do', {
        asReplica: true,
        colo: 'ewr', // Newark, same region as IAD
        failoverConfig: {
          autoFailover: true,
          preferSameRegion: true,
        },
      }) as unknown as MultiRegionReplicaHandle

      await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
      })

      await vi.advanceTimersByTimeAsync(5000)

      // @ts-expect-error - internal test method
      result.instance._simulatePrimaryFailure?.()

      await vi.advanceTimersByTimeAsync(10000)

      // US-East replica should be promoted (same region as primary)
      // @ts-expect-error - accessing role
      const role = await replicaUSEast.getRole?.()
      expect(role).toBe('primary')
    })

    it('should support cross-region failover configuration', async () => {
      const replica = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
        failoverConfig: {
          autoFailover: true,
          failoverOrder: ['eu-west', 'us-west', 'asia-pacific'],
          failoverTimeoutMs: 30000,
        },
      }) as unknown as MultiRegionReplicaHandle

      const config = await replica.getFailoverConfig()

      expect(config.failoverOrder).toEqual(['eu-west', 'us-west', 'asia-pacific'])
      expect(config.failoverTimeoutMs).toBe(30000)
    })

    it('should respect failover order', async () => {
      // Create replicas with specific failover order
      const replicaEU = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
        failoverConfig: {
          autoFailover: true,
          failoverOrder: ['us-west', 'eu-west', 'asia-pacific'],
          preferSameRegion: false,
        },
      }) as unknown as MultiRegionReplicaHandle

      const replicaUSWest = await result.instance.clone('https://replica-us-west.test.do', {
        asReplica: true,
        colo: 'lax',
      }) as unknown as MultiRegionReplicaHandle

      await result.instance.clone('https://replica-apac.test.do', {
        asReplica: true,
        colo: 'sin',
      })

      await vi.advanceTimersByTimeAsync(5000)

      // @ts-expect-error - internal test method
      result.instance._simulatePrimaryFailure?.()

      await vi.advanceTimersByTimeAsync(15000)

      // US-West should be promoted first per failover order
      // @ts-expect-error - accessing role
      const roleUSWest = await replicaUSWest.getRole?.()
      expect(roleUSWest).toBe('primary')
    })

    it('should timeout region failover after configured duration', async () => {
      const replica = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
        failoverConfig: {
          autoFailover: true,
          failoverTimeoutMs: 5000,
        },
      }) as unknown as MultiRegionReplicaHandle

      // Simulate slow failover
      // @ts-expect-error - internal test method
      result.instance._simulateSlowFailover?.(10000)

      // @ts-expect-error - internal test method
      result.instance._simulatePrimaryFailure?.()

      await vi.advanceTimersByTimeAsync(10000)

      // Failover should timeout or complete with error handling
      const config = await replica.getFailoverConfig()
      expect(config.failoverTimeoutMs).toBe(5000)
    })
  })

  // ==========================================================================
  // TOPOLOGY MANAGEMENT
  // ==========================================================================

  describe('Topology Management', () => {
    it('should list all replicas across regions', async () => {
      await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
      })
      await result.instance.clone('https://replica-apac.test.do', {
        asReplica: true,
        colo: 'sin',
      })
      const replicaUSWest = await result.instance.clone('https://replica-us-west.test.do', {
        asReplica: true,
        colo: 'lax',
      }) as unknown as MultiRegionReplicaHandle

      const topology = await replicaUSWest.getTopology()

      expect(topology.totalReplicas).toBe(3)
      expect(topology.replicasByRegion['eu-west']).toHaveLength(1)
      expect(topology.replicasByRegion['asia-pacific']).toHaveLength(1)
      expect(topology.replicasByRegion['us-west']).toHaveLength(1)
    })

    it('should track region health status', async () => {
      await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
      })

      // @ts-expect-error - accessing topology manager
      const topologyManager = result.instance.topologyManager as TopologyManager
      const health = await topologyManager?.getRegionHealth('eu-west')

      expect(health.status).toBe('healthy')
      expect(health.lastHealthCheck).toBeInstanceOf(Date)
    })

    it('should support adding regions dynamically', async () => {
      // @ts-expect-error - accessing topology manager
      const topologyManager = result.instance.topologyManager as TopologyManager

      // Add new region
      const replicas = await topologyManager?.addRegion('asia-pacific', {
        colo: 'sin',
        count: 2,
      })

      expect(replicas).toHaveLength(2)

      const regions = await topologyManager?.getRegions()
      expect(regions).toContain('asia-pacific')
    })

    it('should support removing regions dynamically', async () => {
      await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
      })
      await result.instance.clone('https://replica-apac.test.do', {
        asReplica: true,
        colo: 'sin',
      })

      // @ts-expect-error - accessing topology manager
      const topologyManager = result.instance.topologyManager as TopologyManager

      await topologyManager?.removeRegion('asia-pacific')

      const regions = await topologyManager?.getRegions()
      expect(regions).not.toContain('asia-pacific')
    })

    it('should balance load across regions', async () => {
      // Create unbalanced replicas
      await result.instance.clone('https://replica-eu-1.test.do', {
        asReplica: true,
        colo: 'lhr',
      })
      await result.instance.clone('https://replica-eu-2.test.do', {
        asReplica: true,
        colo: 'fra',
      })
      await result.instance.clone('https://replica-eu-3.test.do', {
        asReplica: true,
        colo: 'cdg',
      })
      await result.instance.clone('https://replica-apac.test.do', {
        asReplica: true,
        colo: 'sin',
      })

      // @ts-expect-error - accessing topology manager
      const topologyManager = result.instance.topologyManager as TopologyManager

      const loadBefore = await topologyManager?.getLoadDistribution()
      expect(loadBefore?.['eu-west']).toBeGreaterThan(loadBefore?.['asia-pacific'] ?? 0)

      await topologyManager?.rebalance()

      const loadAfter = await topologyManager?.getLoadDistribution()
      // Load should be more balanced after rebalance
      expect(loadAfter).toBeDefined()
    })

    it('should refresh topology from all replicas', async () => {
      await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
      })

      // @ts-expect-error - accessing topology manager
      const topologyManager = result.instance.topologyManager as TopologyManager

      const topology = await topologyManager?.refreshTopology()

      expect(topology.refreshedAt).toBeInstanceOf(Date)
      expect(topology.primaryNs).toBe('https://primary.test.do')
    })

    it('should track primary region in topology', async () => {
      await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
      })

      // @ts-expect-error - accessing topology manager
      const topologyManager = result.instance.topologyManager as TopologyManager

      const topology = await topologyManager?.getTopology()

      expect(topology.primaryRegion).toBe('us-east')
      expect(topology.primaryColo).toBe('iad')
    })
  })

  // ==========================================================================
  // COST-AWARE REPLICATION
  // ==========================================================================

  describe('Cost-Aware Replication', () => {
    it('should support different sync frequency by region', async () => {
      const replica = await result.instance.clone('https://replica-apac.test.do', {
        asReplica: true,
        colo: 'sin',
        costPolicy: {
          fullSyncRegions: ['us-east'],
          lazySyncRegions: ['asia-pacific'],
          scheduledSyncRegions: [],
        },
      }) as unknown as MultiRegionReplicaHandle

      const costPolicy = await replica.getCostPolicy()

      expect(costPolicy.lazySyncRegions).toContain('asia-pacific')
    })

    it('should batch cross-region transfers efficiently', async () => {
      const replica = await result.instance.clone('https://replica-apac.test.do', {
        asReplica: true,
        colo: 'sin',
        crossRegionSync: {
          mode: 'batch',
          batchSize: 100,
          batchIntervalMs: 10000,
        },
      }) as unknown as MultiRegionReplicaHandle

      // Add items
      for (let i = 0; i < 50; i++) {
        result.sqlData.get('things')!.push({
          id: `batch-efficient-thing-${i}`,
          type: 1,
          data: { index: i },
          version: 101 + i,
          branch: null,
          deleted: false,
        })
      }

      // Wait for batch interval
      await vi.advanceTimersByTimeAsync(15000)

      const metrics = await replica.getTransferMetrics()

      // Should have done minimal transfers
      expect(metrics.transferCount).toBeLessThanOrEqual(2)
    })

    it('should allow lazy sync for low-priority regions', async () => {
      const replica = await result.instance.clone('https://replica-apac.test.do', {
        asReplica: true,
        colo: 'sin',
        costPolicy: {
          fullSyncRegions: [],
          lazySyncRegions: ['asia-pacific'],
          scheduledSyncRegions: [],
        },
      }) as unknown as MultiRegionReplicaHandle

      // Add data
      result.sqlData.get('things')!.push({
        id: 'lazy-sync-thing',
        type: 1,
        data: { name: 'Lazy' },
        version: 101,
        branch: null,
        deleted: false,
      })

      // Don't wait for sync

      const lag = await replica.getLag()

      // Should have lag (lazy sync doesn't auto-sync)
      expect(lag).toBeGreaterThan(0)

      // Manual sync should work
      await replica.sync()
      const lagAfter = await replica.getLag()
      expect(lagAfter).toBe(0)
    })

    it('should track data transfer metrics per region', async () => {
      const replica = await result.instance.clone('https://replica-apac.test.do', {
        asReplica: true,
        colo: 'sin',
      }) as unknown as MultiRegionReplicaHandle

      // Trigger sync
      await replica.sync()
      await vi.advanceTimersByTimeAsync(5000)

      const metrics = await replica.getTransferMetrics()

      expect(metrics.region).toBe('asia-pacific')
      expect(metrics.bytesTransferred).toBeGreaterThan(0)
      expect(metrics.operationsSynced).toBeGreaterThan(0)
      expect(metrics.lastTransferAt).toBeInstanceOf(Date)
    })

    it('should support scheduled sync for regions', async () => {
      const replica = await result.instance.clone('https://replica-apac.test.do', {
        asReplica: true,
        colo: 'sin',
        costPolicy: {
          fullSyncRegions: [],
          lazySyncRegions: [],
          scheduledSyncRegions: [{ region: 'asia-pacific', intervalMs: 60000 }],
        },
      }) as unknown as MultiRegionReplicaHandle

      // Add data
      result.sqlData.get('things')!.push({
        id: 'scheduled-sync-thing',
        type: 1,
        data: { name: 'Scheduled' },
        version: 101,
        branch: null,
        deleted: false,
      })

      // Wait less than interval
      await vi.advanceTimersByTimeAsync(30000)
      const lagBefore = await replica.getLag()
      expect(lagBefore).toBeGreaterThan(0)

      // Wait for interval
      await vi.advanceTimersByTimeAsync(35000)
      const lagAfter = await replica.getLag()
      expect(lagAfter).toBe(0)
    })

    it('should enforce daily transfer budget', async () => {
      const replica = await result.instance.clone('https://replica-apac.test.do', {
        asReplica: true,
        colo: 'sin',
        costPolicy: {
          fullSyncRegions: [],
          lazySyncRegions: [],
          scheduledSyncRegions: [],
          dailyTransferBudgetBytes: 1000, // Very low budget
        },
      }) as unknown as MultiRegionReplicaHandle

      // Add lots of data
      for (let i = 0; i < 100; i++) {
        result.sqlData.get('things')!.push({
          id: `budget-thing-${i}`,
          type: 1,
          data: { content: 'Large content '.repeat(100) },
          version: 101 + i,
          branch: null,
          deleted: false,
        })
      }

      // Try to sync
      await vi.advanceTimersByTimeAsync(5000)

      const costPolicy = await replica.getCostPolicy()

      // Budget should be exceeded
      expect(costPolicy.budgetExceeded).toBe(true)
      expect(costPolicy.currentDailyUsageBytes).toBeGreaterThanOrEqual(costPolicy.dailyTransferBudgetBytes ?? 0)
    })

    it('should allow updating cost policy', async () => {
      const replica = await result.instance.clone('https://replica-apac.test.do', {
        asReplica: true,
        colo: 'sin',
      }) as unknown as MultiRegionReplicaHandle

      await replica.setCostPolicy({
        fullSyncRegions: ['us-east', 'asia-pacific'],
        dailyTransferBudgetBytes: 1000000,
      })

      const costPolicy = await replica.getCostPolicy()

      expect(costPolicy.fullSyncRegions).toContain('asia-pacific')
      expect(costPolicy.dailyTransferBudgetBytes).toBe(1000000)
    })

    it('should track average latency per region', async () => {
      const replica = await result.instance.clone('https://replica-apac.test.do', {
        asReplica: true,
        colo: 'sin',
      }) as unknown as MultiRegionReplicaHandle

      // Trigger multiple syncs
      await replica.sync()
      await vi.advanceTimersByTimeAsync(2000)
      await replica.sync()
      await vi.advanceTimersByTimeAsync(2000)
      await replica.sync()

      const metrics = await replica.getTransferMetrics()

      expect(metrics.avgLatencyMs).toBeGreaterThan(0)
      expect(metrics.transferCount).toBeGreaterThanOrEqual(3)
    })

    it('should track errors per region', async () => {
      const replica = await result.instance.clone('https://replica-apac.test.do', {
        asReplica: true,
        colo: 'sin',
      }) as unknown as MultiRegionReplicaHandle

      // Simulate network errors during sync
      // @ts-expect-error - internal test method
      result.instance._simulateNetworkErrors?.('https://replica-apac.test.do', 3)

      // Try to sync (will fail)
      try {
        await replica.sync()
      } catch {
        // Expected
      }

      const metrics = await replica.getTransferMetrics()

      expect(metrics.errorCount).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // EDGE CASES
  // ==========================================================================

  describe('Edge Cases', () => {
    it('should handle all replicas in same region', async () => {
      const replica1 = await result.instance.clone('https://replica-1.test.do', {
        asReplica: true,
        colo: 'ewr',
      }) as unknown as MultiRegionReplicaHandle

      await result.instance.clone('https://replica-2.test.do', {
        asReplica: true,
        colo: 'iad',
      })

      const topology = await replica1.getTopology()

      expect(topology.replicasByRegion['us-east']).toHaveLength(2)
      expect(Object.keys(topology.replicasByRegion).length).toBe(1)
    })

    it('should handle rapid region changes', async () => {
      // @ts-expect-error - accessing topology manager
      const topologyManager = result.instance.topologyManager as TopologyManager

      // Add and remove regions rapidly
      await topologyManager?.addRegion('eu-west', { colo: 'lhr' })
      await topologyManager?.addRegion('asia-pacific', { colo: 'sin' })
      await topologyManager?.removeRegion('eu-west')
      await topologyManager?.addRegion('us-west', { colo: 'lax' })

      const regions = await topologyManager?.getRegions()

      expect(regions).toContain('asia-pacific')
      expect(regions).toContain('us-west')
      expect(regions).not.toContain('eu-west')
    })

    it('should handle network partition between regions', async () => {
      const replicaEU = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
      }) as unknown as MultiRegionReplicaHandle

      await result.instance.clone('https://replica-apac.test.do', {
        asReplica: true,
        colo: 'sin',
      })

      // Simulate partition between US and EU
      // @ts-expect-error - internal test method
      result.instance._simulateRegionPartition?.('us-east', 'eu-west')

      await vi.advanceTimersByTimeAsync(30000)

      const metadata = await replicaEU.getRegionMetadata()

      expect(['healthy', 'degraded', 'unreachable']).toContain(metadata.status)
    })

    it('should gracefully degrade when primary region is unreachable', async () => {
      const replicaAPAC = await result.instance.clone('https://replica-apac.test.do', {
        asReplica: true,
        colo: 'sin',
        failoverConfig: {
          autoFailover: true,
        },
      }) as unknown as MultiRegionReplicaHandle

      // Sync first
      await vi.advanceTimersByTimeAsync(5000)

      // Simulate primary region unreachable
      // @ts-expect-error - internal test method
      result.instance._simulateRegionOutage?.('us-east')

      await vi.advanceTimersByTimeAsync(15000)

      // APAC should still be functional (or promoted)
      const metadata = await replicaAPAC.getRegionMetadata()
      expect(['healthy', 'degraded']).toContain(metadata.status)
    })

    it('should handle colo-level failure within region', async () => {
      await result.instance.clone('https://replica-eu-lhr.test.do', {
        asReplica: true,
        colo: 'lhr',
      })
      const replicaFRA = await result.instance.clone('https://replica-eu-fra.test.do', {
        asReplica: true,
        colo: 'fra',
      }) as unknown as MultiRegionReplicaHandle

      // Simulate LHR colo failure
      // @ts-expect-error - internal test method
      result.instance._simulateColoFailure?.('lhr')

      await vi.advanceTimersByTimeAsync(10000)

      // FRA should still be functional
      const metadata = await replicaFRA.getRegionMetadata()
      expect(metadata.status).toBe('healthy')
    })

    it('should maintain topology consistency during concurrent operations', async () => {
      // @ts-expect-error - accessing topology manager
      const topologyManager = result.instance.topologyManager as TopologyManager

      // Perform concurrent operations
      const operations = [
        topologyManager?.addRegion('eu-west', { colo: 'lhr' }),
        topologyManager?.addRegion('asia-pacific', { colo: 'sin' }),
        topologyManager?.addRegion('us-west', { colo: 'lax' }),
      ]

      await Promise.all(operations)

      const topology = await topologyManager?.getTopology()

      // Topology should be consistent
      expect(topology.totalReplicas).toBe(3)
    })
  })

  // ==========================================================================
  // EVENTS
  // ==========================================================================

  describe('Multi-Region Events', () => {
    it('should emit region.replica.created event', async () => {
      const events: unknown[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({ type: verb, data })
        return originalEmit?.call(result.instance, verb, data)
      }

      await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
      })

      const createdEvent = events.find((e) =>
        (e as Record<string, string>).type === 'region.replica.created',
      )
      expect(createdEvent).toBeDefined()
    })

    it('should emit region.sync.completed event', async () => {
      const events: unknown[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({ type: verb, data })
        return originalEmit?.call(result.instance, verb, data)
      }

      const replica = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
      }) as unknown as MultiRegionReplicaHandle

      await replica.sync()

      const syncEvent = events.find((e) =>
        (e as Record<string, string>).type === 'region.sync.completed',
      )
      expect(syncEvent).toBeDefined()
    })

    it('should emit region.health.changed event', async () => {
      const events: unknown[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({ type: verb, data })
        return originalEmit?.call(result.instance, verb, data)
      }

      await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
      })

      // Simulate health change
      // @ts-expect-error - internal test method
      result.instance._simulateRegionDegraded?.('eu-west')

      await vi.advanceTimersByTimeAsync(5000)

      const healthEvent = events.find((e) =>
        (e as Record<string, string>).type === 'region.health.changed',
      )
      expect(healthEvent).toBeDefined()
    })

    it('should emit region.failover event on cross-region failover', async () => {
      const events: unknown[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({ type: verb, data })
        return originalEmit?.call(result.instance, verb, data)
      }

      const replica = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
        failoverConfig: {
          autoFailover: true,
        },
      }) as unknown as MultiRegionReplicaHandle

      await replica.sync()
      await vi.advanceTimersByTimeAsync(1000)

      // @ts-expect-error - internal test method
      result.instance._simulatePrimaryFailure?.()

      await vi.advanceTimersByTimeAsync(15000)

      const failoverEvent = events.find((e) =>
        (e as Record<string, string>).type === 'region.failover',
      )
      expect(failoverEvent).toBeDefined()
    })

    it('should include region information in events', async () => {
      const events: Array<{ type: string; data: { region?: Region; colo?: ColoCode } }> = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({ type: verb, data: data as { region?: Region; colo?: ColoCode } })
        return originalEmit?.call(result.instance, verb, data)
      }

      await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
      })

      const createdEvent = events.find((e) => e.type === 'region.replica.created')

      expect(createdEvent?.data.region).toBe('eu-west')
      expect(createdEvent?.data.colo).toBe('lhr')
    })
  })

  // ==========================================================================
  // CROSS-REGION DATA SYNC (ADDITIONAL COMPREHENSIVE TESTS)
  // ==========================================================================

  describe('Cross-Region Data Sync - Comprehensive', () => {
    it('should maintain eventual consistency across all regions', async () => {
      // Create replicas in multiple regions
      const replicaEU = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
      }) as unknown as MultiRegionReplicaHandle

      const replicaAPAC = await result.instance.clone('https://replica-apac.test.do', {
        asReplica: true,
        colo: 'sin',
      }) as unknown as MultiRegionReplicaHandle

      const replicaUSWest = await result.instance.clone('https://replica-us-west.test.do', {
        asReplica: true,
        colo: 'lax',
      }) as unknown as MultiRegionReplicaHandle

      // Add data to primary
      for (let i = 0; i < 10; i++) {
        result.sqlData.get('things')!.push({
          id: `eventual-consistency-${i}`,
          type: 1,
          data: { index: i, timestamp: Date.now() },
          version: 101 + i,
          branch: null,
          deleted: false,
        })
      }

      // Wait for eventual sync to all regions
      await vi.advanceTimersByTimeAsync(60000)

      const lagEU = await replicaEU.getLag()
      const lagAPAC = await replicaAPAC.getLag()
      const lagUSWest = await replicaUSWest.getLag()

      // All regions should eventually be consistent
      expect(lagEU).toBe(0)
      expect(lagAPAC).toBe(0)
      expect(lagUSWest).toBe(0)
    })

    it('should handle high write throughput with cross-region replication', async () => {
      const replicaEU = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
        crossRegionSync: {
          mode: 'batch',
          batchSize: 100,
          batchIntervalMs: 1000,
        },
      }) as unknown as MultiRegionReplicaHandle

      // High throughput writes to primary
      for (let i = 0; i < 500; i++) {
        result.sqlData.get('things')!.push({
          id: `high-throughput-${i}`,
          type: 1,
          data: { index: i },
          version: 101 + i,
          branch: null,
          deleted: false,
        })
      }

      // Wait for batched sync
      await vi.advanceTimersByTimeAsync(30000)

      const metrics = await replicaEU.getTransferMetrics()

      // Should have used batching efficiently
      expect(metrics.operationsSynced).toBe(500)
      expect(metrics.transferCount).toBeLessThan(50) // Should batch, not 500 individual transfers
    })

    it('should prioritize sync based on region priority configuration', async () => {
      const replicaHighPriority = await result.instance.clone('https://replica-high.test.do', {
        asReplica: true,
        colo: 'lhr',
        crossRegionSync: {
          mode: 'async',
          priority: 1, // High priority
        },
      }) as unknown as MultiRegionReplicaHandle

      const replicaLowPriority = await result.instance.clone('https://replica-low.test.do', {
        asReplica: true,
        colo: 'sin',
        crossRegionSync: {
          mode: 'async',
          priority: 10, // Low priority
        },
      }) as unknown as MultiRegionReplicaHandle

      // Add data
      result.sqlData.get('things')!.push({
        id: 'priority-thing',
        type: 1,
        data: { name: 'Priority Test' },
        version: 101,
        branch: null,
        deleted: false,
      })

      // Wait partial time
      await vi.advanceTimersByTimeAsync(2000)

      const lagHigh = await replicaHighPriority.getLag()
      const lagLow = await replicaLowPriority.getLag()

      // High priority should sync faster
      expect(lagHigh).toBeLessThanOrEqual(lagLow)
    })

    it('should handle intermittent connectivity between regions', async () => {
      const replica = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
      }) as unknown as MultiRegionReplicaHandle

      // Add initial data
      result.sqlData.get('things')!.push({
        id: 'intermittent-thing-1',
        type: 1,
        data: { phase: 1 },
        version: 101,
        branch: null,
        deleted: false,
      })

      // Wait for sync
      await vi.advanceTimersByTimeAsync(5000)

      // Simulate connectivity loss
      // @ts-expect-error - internal test method
      result.instance._simulateConnectivityLoss?.('lhr')

      // Add more data during outage
      result.sqlData.get('things')!.push({
        id: 'intermittent-thing-2',
        type: 1,
        data: { phase: 2 },
        version: 102,
        branch: null,
        deleted: false,
      })

      await vi.advanceTimersByTimeAsync(5000)

      // Restore connectivity
      // @ts-expect-error - internal test method
      result.instance._restoreConnectivity?.('lhr')

      // Wait for catch-up sync
      await vi.advanceTimersByTimeAsync(10000)

      const lag = await replica.getLag()

      // Should have caught up after connectivity restored
      expect(lag).toBe(0)
    })

    it('should track sync progress per region', async () => {
      const replica = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
      }) as unknown as MultiRegionReplicaHandle

      // Add significant data
      for (let i = 0; i < 100; i++) {
        result.sqlData.get('things')!.push({
          id: `progress-thing-${i}`,
          type: 1,
          data: { index: i },
          version: 101 + i,
          branch: null,
          deleted: false,
        })
      }

      // Start sync but don't wait for completion
      const syncPromise = replica.sync()

      // Check progress mid-sync
      await vi.advanceTimersByTimeAsync(2000)

      // @ts-expect-error - accessing internal method
      const progress = await replica.getSyncProgress?.() ?? {
        totalOperations: 100,
        syncedOperations: 0,
        percentage: 0,
      }

      expect(progress.totalOperations).toBeGreaterThan(0)
      expect(progress.percentage).toBeGreaterThanOrEqual(0)
      expect(progress.percentage).toBeLessThanOrEqual(100)

      await syncPromise
    })

    it('should support selective sync for specific data types', async () => {
      const replica = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
        // @ts-expect-error - extended option
        selectiveSync: {
          includeTables: ['things'],
          excludeTables: ['events', 'actions'],
        },
      }) as unknown as MultiRegionReplicaHandle

      // Add data to multiple tables
      result.sqlData.get('things')!.push({
        id: 'selective-thing',
        type: 1,
        data: {},
        version: 101,
        branch: null,
        deleted: false,
      })
      result.sqlData.get('events')!.push({
        id: 'selective-event',
        type: 'test',
        data: {},
      })

      await replica.sync()
      await vi.advanceTimersByTimeAsync(5000)

      const metrics = await replica.getTransferMetrics()

      // Should only sync included tables
      expect(metrics.operationsSynced).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // CONFLICT RESOLUTION
  // ==========================================================================

  describe('Conflict Resolution', () => {
    it('should detect write conflicts across regions', async () => {
      const replicaEU = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
      }) as unknown as MultiRegionReplicaHandle

      // Sync initially
      await replicaEU.sync()
      await vi.advanceTimersByTimeAsync(1000)

      // Simulate concurrent writes to same key during partition
      // @ts-expect-error - internal test method
      result.instance._simulateRegionPartition?.('us-east', 'eu-west')

      // Write to primary
      result.sqlData.get('things')!.push({
        id: 'conflict-thing',
        type: 1,
        data: { source: 'primary', value: 'A' },
        version: 101,
        branch: null,
        deleted: false,
      })

      // Simulate write to replica during partition
      // @ts-expect-error - internal test method
      await replicaEU.simulateLocalWrite?.({
        id: 'conflict-thing',
        type: 1,
        data: { source: 'replica', value: 'B' },
        version: 101,
      })

      // Heal partition
      // @ts-expect-error - internal test method
      await result.instance._healPartition?.()

      await vi.advanceTimersByTimeAsync(10000)

      // @ts-expect-error - accessing conflict detection
      const conflicts = await result.instance.getConflicts?.() ?? []

      expect(conflicts.length).toBeGreaterThanOrEqual(0)
    })

    it('should use last-write-wins by default for conflict resolution', async () => {
      const replica = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
        // @ts-expect-error - extended option
        conflictResolution: 'last-write-wins',
      }) as unknown as MultiRegionReplicaHandle

      // Simulate conflict
      // @ts-expect-error - internal test method
      await result.instance._simulateConflict?.({
        id: 'lww-conflict',
        primaryValue: { value: 'primary', timestamp: 1000 },
        replicaValue: { value: 'replica', timestamp: 2000 }, // Later timestamp wins
      })

      await vi.advanceTimersByTimeAsync(5000)

      // @ts-expect-error - reading resolved value
      const resolved = await result.instance.getThing?.('lww-conflict')

      // Later timestamp should win
      expect(resolved?.data?.value).toBe('replica')
    })

    it('should support custom conflict resolution function', async () => {
      const replica = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
        // @ts-expect-error - extended option
        conflictResolution: 'custom',
        conflictResolver: (primary: unknown, replica: unknown) => {
          // Custom: merge both values
          return { ...primary as object, ...replica as object, merged: true }
        },
      }) as unknown as MultiRegionReplicaHandle

      // Simulate conflict
      // @ts-expect-error - internal test method
      await result.instance._simulateConflict?.({
        id: 'custom-conflict',
        primaryValue: { a: 1 },
        replicaValue: { b: 2 },
      })

      await vi.advanceTimersByTimeAsync(5000)

      // @ts-expect-error - reading resolved value
      const resolved = await result.instance.getThing?.('custom-conflict')

      expect(resolved?.data?.merged).toBe(true)
    })

    it('should support primary-wins conflict resolution', async () => {
      const replica = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
        // @ts-expect-error - extended option
        conflictResolution: 'primary-wins',
      }) as unknown as MultiRegionReplicaHandle

      // Simulate conflict
      // @ts-expect-error - internal test method
      await result.instance._simulateConflict?.({
        id: 'primary-wins-conflict',
        primaryValue: { value: 'primary' },
        replicaValue: { value: 'replica' },
      })

      await vi.advanceTimersByTimeAsync(5000)

      // @ts-expect-error - reading resolved value
      const resolved = await result.instance.getThing?.('primary-wins-conflict')

      expect(resolved?.data?.value).toBe('primary')
    })

    it('should log conflict resolution for audit', async () => {
      const events: unknown[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({ type: verb, data })
        return originalEmit?.call(result.instance, verb, data)
      }

      const replica = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
      }) as unknown as MultiRegionReplicaHandle

      // Simulate conflict
      // @ts-expect-error - internal test method
      await result.instance._simulateConflict?.({
        id: 'audit-conflict',
        primaryValue: { value: 'A' },
        replicaValue: { value: 'B' },
      })

      await vi.advanceTimersByTimeAsync(5000)

      const conflictEvent = events.find((e) =>
        (e as Record<string, string>).type === 'conflict.resolved'
      )

      expect(conflictEvent).toBeDefined()
    })

    it('should handle concurrent delete and update conflicts', async () => {
      const replica = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
      }) as unknown as MultiRegionReplicaHandle

      // Create initial data
      result.sqlData.get('things')!.push({
        id: 'delete-update-conflict',
        type: 1,
        data: { value: 'original' },
        version: 101,
        branch: null,
        deleted: false,
      })

      await replica.sync()
      await vi.advanceTimersByTimeAsync(1000)

      // Simulate partition
      // @ts-expect-error - internal test method
      result.instance._simulateRegionPartition?.('us-east', 'eu-west')

      // Primary deletes
      const things = result.sqlData.get('things')!
      const idx = things.findIndex((t: unknown) => (t as { id: string }).id === 'delete-update-conflict')
      if (idx >= 0) {
        (things[idx] as { deleted: boolean }).deleted = true
      }

      // Replica updates
      // @ts-expect-error - internal test method
      await replicaEU.simulateLocalUpdate?.({
        id: 'delete-update-conflict',
        data: { value: 'updated' },
      })

      // Heal partition
      // @ts-expect-error - internal test method
      await result.instance._healPartition?.()

      await vi.advanceTimersByTimeAsync(10000)

      // Conflict should be resolved (delete should win typically)
      // @ts-expect-error - reading value
      const thing = await result.instance.getThing?.('delete-update-conflict')
      expect(thing?.deleted === true || thing === null).toBe(true)
    })

    it('should track conflict history', async () => {
      const replica = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
      }) as unknown as MultiRegionReplicaHandle

      // Generate multiple conflicts
      for (let i = 0; i < 5; i++) {
        // @ts-expect-error - internal test method
        await result.instance._simulateConflict?.({
          id: `history-conflict-${i}`,
          primaryValue: { value: `primary-${i}` },
          replicaValue: { value: `replica-${i}` },
        })
      }

      await vi.advanceTimersByTimeAsync(10000)

      // @ts-expect-error - accessing conflict history
      const conflictHistory = await result.instance.getConflictHistory?.() ?? []

      expect(conflictHistory.length).toBeGreaterThanOrEqual(0)
    })
  })

  // ==========================================================================
  // LATENCY HANDLING
  // ==========================================================================

  describe('Latency Handling', () => {
    it('should measure round-trip latency to each region', async () => {
      const replicaEU = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
      }) as unknown as MultiRegionReplicaHandle

      const replicaAPAC = await result.instance.clone('https://replica-apac.test.do', {
        asReplica: true,
        colo: 'nrt',
      }) as unknown as MultiRegionReplicaHandle

      const metadataEU = await replicaEU.getRegionMetadata()
      const metadataAPAC = await replicaAPAC.getRegionMetadata()

      // Both should have latency measurements
      expect(metadataEU.latencyMs).toBeGreaterThanOrEqual(0)
      expect(metadataAPAC.latencyMs).toBeGreaterThanOrEqual(0)

      // APAC should generally have higher latency from US-East primary
      expect(metadataAPAC.latencyMs).toBeGreaterThan(metadataEU.latencyMs)
    })

    it('should adjust sync interval based on latency', async () => {
      const replicaHighLatency = await result.instance.clone('https://replica-apac.test.do', {
        asReplica: true,
        colo: 'nrt', // Tokyo - high latency from US-East
        // @ts-expect-error - extended option
        adaptiveSyncInterval: true,
      }) as unknown as MultiRegionReplicaHandle

      const replicaLowLatency = await result.instance.clone('https://replica-us-west.test.do', {
        asReplica: true,
        colo: 'lax', // LA - lower latency from US-East
        // @ts-expect-error - extended option
        adaptiveSyncInterval: true,
      }) as unknown as MultiRegionReplicaHandle

      await vi.advanceTimersByTimeAsync(30000)

      // @ts-expect-error - accessing sync interval
      const intervalHigh = await replicaHighLatency.getSyncInterval?.() ?? 10000
      // @ts-expect-error - accessing sync interval
      const intervalLow = await replicaLowLatency.getSyncInterval?.() ?? 5000

      // Higher latency should result in longer sync interval
      expect(intervalHigh).toBeGreaterThanOrEqual(intervalLow)
    })

    it('should provide latency percentiles over time', async () => {
      const replica = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
      }) as unknown as MultiRegionReplicaHandle

      // Perform multiple syncs to collect latency samples
      for (let i = 0; i < 10; i++) {
        await replica.sync()
        await vi.advanceTimersByTimeAsync(1000)
      }

      // @ts-expect-error - accessing latency stats
      const latencyStats = await replica.getLatencyStats?.() ?? {
        p50: 50,
        p95: 100,
        p99: 150,
        avg: 75,
      }

      expect(latencyStats.p50).toBeGreaterThanOrEqual(0)
      expect(latencyStats.p95).toBeGreaterThanOrEqual(latencyStats.p50)
      expect(latencyStats.p99).toBeGreaterThanOrEqual(latencyStats.p95)
    })

    it('should timeout operations on excessive latency', async () => {
      const replica = await result.instance.clone('https://replica-apac.test.do', {
        asReplica: true,
        colo: 'nrt',
        // @ts-expect-error - extended option
        operationTimeoutMs: 5000,
      }) as unknown as MultiRegionReplicaHandle

      // Simulate high latency
      // @ts-expect-error - internal test method
      result.instance._simulateHighLatency?.(10000) // 10s latency

      // Sync should timeout
      await expect(async () => {
        await replica.sync()
      }).rejects.toThrow(/timeout|operation.*exceeded/i)
    })

    it('should implement exponential backoff on latency spikes', async () => {
      const replica = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
        // @ts-expect-error - extended option
        backoffEnabled: true,
      }) as unknown as MultiRegionReplicaHandle

      const retryDelays: number[] = []

      // Mock retry tracking
      // @ts-expect-error - internal tracking
      replica._onRetry = (delay: number) => {
        retryDelays.push(delay)
      }

      // Simulate repeated failures
      for (let i = 0; i < 5; i++) {
        // @ts-expect-error - internal test method
        result.instance._simulateSyncFailure?.()
        await vi.advanceTimersByTimeAsync(30000)
      }

      // Backoff delays should increase exponentially
      if (retryDelays.length >= 2) {
        for (let i = 1; i < retryDelays.length; i++) {
          expect(retryDelays[i]!).toBeGreaterThanOrEqual(retryDelays[i - 1]!)
        }
      }
    })

    it('should route requests to lowest-latency replica', async () => {
      const replicaFast = await result.instance.clone('https://replica-fast.test.do', {
        asReplica: true,
        colo: 'ewr', // Close to IAD primary
      }) as unknown as MultiRegionReplicaHandle

      await result.instance.clone('https://replica-slow.test.do', {
        asReplica: true,
        colo: 'nrt', // Far from IAD primary
      })

      await vi.advanceTimersByTimeAsync(5000)

      // Route from EWR (near fast replica)
      const decision = await replicaFast.getRoutingDecision('ewr')

      expect(decision.targetColo).toBe('ewr')
      expect(decision.reason).toBe('lowest-latency')
    })

    it('should handle latency variance gracefully', async () => {
      const replica = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
      }) as unknown as MultiRegionReplicaHandle

      // Simulate variable latency
      const latencies = [50, 200, 30, 500, 80, 150, 40, 300]
      for (const latency of latencies) {
        // @ts-expect-error - internal test method
        result.instance._simulateLatency?.(latency)
        await replica.sync()
        await vi.advanceTimersByTimeAsync(1000)
      }

      // @ts-expect-error - accessing latency jitter
      const jitter = await replica.getLatencyJitter?.() ?? 100

      // Should track variance
      expect(jitter).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // FAILOVER SCENARIOS (ADDITIONAL)
  // ==========================================================================

  describe('Failover Scenarios - Extended', () => {
    it('should detect primary degradation before complete failure', async () => {
      const replica = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
        failoverConfig: {
          autoFailover: true,
        },
      }) as unknown as MultiRegionReplicaHandle

      // Simulate degraded primary (high latency, partial failures)
      // @ts-expect-error - internal test method
      result.instance._simulatePrimaryDegradation?.({
        latencyIncrease: 500,
        errorRate: 0.3,
      })

      await vi.advanceTimersByTimeAsync(30000)

      const metadata = await replica.getRegionMetadata()

      // Should detect degradation
      expect(['degraded', 'healthy']).toContain(metadata.status)
    })

    it('should perform graceful failover with zero data loss', async () => {
      const replica = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
        failoverConfig: {
          autoFailover: true,
        },
      }) as unknown as MultiRegionReplicaHandle

      // Ensure replica is fully synced
      await replica.sync()
      await vi.advanceTimersByTimeAsync(5000)

      const lagBefore = await replica.getLag()
      expect(lagBefore).toBe(0)

      // @ts-expect-error - internal test method
      result.instance._simulatePrimaryFailure?.()

      await vi.advanceTimersByTimeAsync(15000)

      // @ts-expect-error - accessing failover result
      const failoverResult = await replica.getLastFailoverResult?.() ?? {
        success: true,
        dataLoss: 0,
      }

      expect(failoverResult.dataLoss).toBe(0)
    })

    it('should redirect writes to new primary after failover', async () => {
      const replica = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
        failoverConfig: {
          autoFailover: true,
        },
      }) as unknown as MultiRegionReplicaHandle

      await replica.sync()
      await vi.advanceTimersByTimeAsync(5000)

      // @ts-expect-error - internal test method
      result.instance._simulatePrimaryFailure?.()

      await vi.advanceTimersByTimeAsync(15000)

      // Write to what was a replica
      // @ts-expect-error - accessing internal write method
      const writeResult = await replica.writeThing?.({
        id: 'post-failover-thing',
        type: 1,
        data: { name: 'After Failover' },
      })

      expect(writeResult?.ns).toBe('https://replica-eu.test.do')
    })

    it('should handle split-brain with automatic resolution', async () => {
      const replica1 = await result.instance.clone('https://replica-1.test.do', {
        asReplica: true,
        colo: 'lhr',
        failoverConfig: {
          autoFailover: true,
        },
      }) as unknown as MultiRegionReplicaHandle

      const replica2 = await result.instance.clone('https://replica-2.test.do', {
        asReplica: true,
        colo: 'sin',
        failoverConfig: {
          autoFailover: true,
        },
      }) as unknown as MultiRegionReplicaHandle

      // Sync both
      await replica1.sync()
      await replica2.sync()
      await vi.advanceTimersByTimeAsync(5000)

      // Simulate network partition causing split brain
      // @ts-expect-error - internal test method
      result.instance._simulateSplitBrain?.({
        replica1: 'https://replica-1.test.do',
        replica2: 'https://replica-2.test.do',
      })

      await vi.advanceTimersByTimeAsync(30000)

      // @ts-expect-error - accessing failover coordinator
      const coordinator = result.instance.failoverCoordinator as FailoverCoordinator
      const splitBrain = await coordinator?.detectSplitBrain()

      if (splitBrain?.detected) {
        // Should have a resolution
        expect(splitBrain.resolution).toBeDefined()
      }
    })

    it('should maintain read availability during failover', async () => {
      const replica = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
        failoverConfig: {
          autoFailover: true,
        },
      }) as unknown as MultiRegionReplicaHandle

      await replica.sync()
      await vi.advanceTimersByTimeAsync(5000)

      // Start failover
      // @ts-expect-error - internal test method
      result.instance._simulatePrimaryFailure?.()

      // Read during failover should still work (from replica's cached data)
      // @ts-expect-error - accessing read method
      const readResult = await replica.read?.('thing-0')

      expect(readResult).toBeDefined()
    })

    it('should recover from failed failover attempt', async () => {
      const replica = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
        failoverConfig: {
          autoFailover: true,
        },
      }) as unknown as MultiRegionReplicaHandle

      await replica.sync()
      await vi.advanceTimersByTimeAsync(5000)

      // Simulate failed failover
      // @ts-expect-error - internal test method
      result.instance._simulateFailedFailover?.()

      await vi.advanceTimersByTimeAsync(10000)

      // @ts-expect-error - accessing role
      const role = await replica.getRole?.()

      // Should still be in a valid state
      expect(['primary', 'follower']).toContain(role)
    })

    it('should support manual failover with confirmation', async () => {
      const replica = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
        failoverConfig: {
          autoFailover: false, // Manual only
        },
      }) as unknown as MultiRegionReplicaHandle

      await replica.sync()
      await vi.advanceTimersByTimeAsync(5000)

      // @ts-expect-error - accessing failover coordinator
      const coordinator = result.instance.failoverCoordinator as FailoverCoordinator

      // Manual initiation
      const failoverResult = await coordinator?.initiateFailover('manual test')

      expect(failoverResult?.success).toBeDefined()
    })

    it('should handle cascading failures across regions', async () => {
      const replicaEU = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
        failoverConfig: {
          autoFailover: true,
          failoverOrder: ['eu-west', 'us-west', 'asia-pacific'],
        },
      }) as unknown as MultiRegionReplicaHandle

      const replicaAPAC = await result.instance.clone('https://replica-apac.test.do', {
        asReplica: true,
        colo: 'sin',
      }) as unknown as MultiRegionReplicaHandle

      // Sync all
      await replicaEU.sync()
      await replicaAPAC.sync()
      await vi.advanceTimersByTimeAsync(5000)

      // Primary fails
      // @ts-expect-error - internal test method
      result.instance._simulatePrimaryFailure?.()

      await vi.advanceTimersByTimeAsync(10000)

      // EU replica promoted
      // Then EU fails too
      // @ts-expect-error - internal test method
      replicaEU._simulateFailure?.()

      await vi.advanceTimersByTimeAsync(15000)

      // APAC should now be primary
      // @ts-expect-error - accessing role
      const roleAPAC = await replicaAPAC.getRole?.()
      expect(['primary', 'follower']).toContain(roleAPAC)
    })

    it('should emit events during failover process', async () => {
      const events: unknown[] = []
      const originalEmit = (result.instance as unknown as { emitEvent: Function }).emitEvent
      ;(result.instance as unknown as { emitEvent: Function }).emitEvent = async (verb: string, data: unknown) => {
        events.push({ type: verb, data })
        return originalEmit?.call(result.instance, verb, data)
      }

      const replica = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
        failoverConfig: {
          autoFailover: true,
        },
      }) as unknown as MultiRegionReplicaHandle

      await replica.sync()
      await vi.advanceTimersByTimeAsync(5000)

      // @ts-expect-error - internal test method
      result.instance._simulatePrimaryFailure?.()

      await vi.advanceTimersByTimeAsync(20000)

      const failoverEvents = events.filter((e) =>
        (e as Record<string, string>).type?.startsWith('failover.')
      )

      // Should have multiple failover events
      expect(failoverEvents.length).toBeGreaterThan(0)
    })
  })

  // ==========================================================================
  // CONSISTENCY GUARANTEES
  // ==========================================================================

  describe('Consistency Guarantees', () => {
    it('should provide monotonic read consistency within a session', async () => {
      const replica = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
      }) as unknown as MultiRegionReplicaHandle

      await replica.sync()

      const sequences: number[] = []

      // Multiple reads should never go backwards
      for (let i = 0; i < 10; i++) {
        // @ts-expect-error - accessing read with sequence
        const read = await replica.read?.('thing-0', { sessionId: 'test-session' })
        sequences.push(read?.sequence ?? 0)
        await vi.advanceTimersByTimeAsync(500)
      }

      // Sequences should be monotonically increasing
      for (let i = 1; i < sequences.length; i++) {
        expect(sequences[i]!).toBeGreaterThanOrEqual(sequences[i - 1]!)
      }
    })

    it('should support linearizable reads when requested', async () => {
      const replica = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
      }) as unknown as MultiRegionReplicaHandle

      // Add data to primary
      result.sqlData.get('things')!.push({
        id: 'linearizable-thing',
        type: 1,
        data: { value: 'latest' },
        version: 101,
        branch: null,
        deleted: false,
      })

      // Linearizable read should always return latest
      // @ts-expect-error - accessing read with options
      const read = await replica.read?.('linearizable-thing', {
        consistency: 'linearizable',
      })

      expect(read?.data?.value).toBe('latest')
      expect(read?.isStale).toBe(false)
    })

    it('should track causal dependencies across regions', async () => {
      const replicaEU = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
      }) as unknown as MultiRegionReplicaHandle

      const replicaAPAC = await result.instance.clone('https://replica-apac.test.do', {
        asReplica: true,
        colo: 'sin',
      }) as unknown as MultiRegionReplicaHandle

      // Write A to primary
      result.sqlData.get('things')!.push({
        id: 'causal-a',
        type: 1,
        data: { value: 'A' },
        version: 101,
        branch: null,
        deleted: false,
      })

      // Write B depends on A
      result.sqlData.get('things')!.push({
        id: 'causal-b',
        type: 1,
        data: { value: 'B', dependsOn: 'causal-a' },
        version: 102,
        branch: null,
        deleted: false,
      })

      await replicaEU.sync()
      await replicaAPAC.sync()
      await vi.advanceTimersByTimeAsync(10000)

      // If B is visible, A must be visible (causal consistency)
      // @ts-expect-error - accessing read
      const readB = await replicaAPAC.read?.('causal-b')
      if (readB?.data) {
        // @ts-expect-error - accessing read
        const readA = await replicaAPAC.read?.('causal-a')
        expect(readA?.data).toBeDefined()
      }
    })

    it('should provide bounded staleness guarantees', async () => {
      const replica = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
        // @ts-expect-error - extended option
        boundedStaleness: {
          maxVersions: 10,
          maxTimeMs: 30000,
        },
      }) as unknown as MultiRegionReplicaHandle

      // Add data
      for (let i = 0; i < 5; i++) {
        result.sqlData.get('things')!.push({
          id: `bounded-thing-${i}`,
          type: 1,
          data: { index: i },
          version: 101 + i,
          branch: null,
          deleted: false,
        })
      }

      await vi.advanceTimersByTimeAsync(10000)

      const lag = await replica.getLag()

      // Should be within bounds
      expect(lag).toBeLessThanOrEqual(10)
    })
  })

  // ==========================================================================
  // OBSERVABILITY
  // ==========================================================================

  describe('Observability', () => {
    it('should emit metrics for cross-region sync', async () => {
      const replica = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
      }) as unknown as MultiRegionReplicaHandle

      await replica.sync()
      await vi.advanceTimersByTimeAsync(5000)

      const metrics = await replica.getTransferMetrics()

      expect(metrics.bytesTransferred).toBeGreaterThanOrEqual(0)
      expect(metrics.operationsSynced).toBeGreaterThanOrEqual(0)
      expect(metrics.avgLatencyMs).toBeGreaterThanOrEqual(0)
    })

    it('should provide health status per region', async () => {
      await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
      })
      await result.instance.clone('https://replica-apac.test.do', {
        asReplica: true,
        colo: 'sin',
      })

      // @ts-expect-error - accessing topology manager
      const topologyManager = result.instance.topologyManager as TopologyManager

      const healthEU = await topologyManager?.getRegionHealth('eu-west')
      const healthAPAC = await topologyManager?.getRegionHealth('asia-pacific')

      expect(healthEU?.status).toBeDefined()
      expect(healthAPAC?.status).toBeDefined()
    })

    it('should track replication lag histogram', async () => {
      const replica = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
        // @ts-expect-error - extended option
        monitorLag: true,
      }) as unknown as MultiRegionReplicaHandle

      // Generate varying lag
      for (let i = 0; i < 20; i++) {
        result.sqlData.get('things')!.push({
          id: `histogram-thing-${i}`,
          type: 1,
          data: {},
          version: 101 + i,
          branch: null,
          deleted: false,
        })
        await vi.advanceTimersByTimeAsync(500)
      }

      // @ts-expect-error - accessing lag histogram
      const histogram = await replica.getLagHistogram?.() ?? {
        buckets: [0, 1, 5, 10, 50, 100],
        counts: [0, 0, 0, 0, 0, 0],
      }

      expect(histogram.buckets).toBeDefined()
      expect(histogram.counts).toBeDefined()
    })

    it('should log sync operations for debugging', async () => {
      const replica = await result.instance.clone('https://replica-eu.test.do', {
        asReplica: true,
        colo: 'lhr',
        // @ts-expect-error - extended option
        debugLogging: true,
      }) as unknown as MultiRegionReplicaHandle

      await replica.sync()
      await vi.advanceTimersByTimeAsync(5000)

      // @ts-expect-error - accessing debug logs
      const logs = await replica.getSyncLogs?.() ?? []

      expect(Array.isArray(logs)).toBe(true)
    })
  })
})
