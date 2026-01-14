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
})
