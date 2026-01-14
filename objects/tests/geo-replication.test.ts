/**
 * Geo-Replication Tests (GREEN Phase - TDD)
 *
 * Tests for the GeoReplicationModule that provides multi-region data replication:
 * 1. Region configuration (primary/replica regions)
 * 2. Write forwarding to primary region
 * 3. Read routing to nearest replica
 * 4. Conflict resolution (last-writer-wins, vector clocks)
 * 5. Eventual consistency guarantees
 * 6. Failover scenarios
 * 7. Replication lag metrics
 *
 * These tests run in Node environment with a mock DurableObjectState.
 * They test the GeoReplicationModule directly without requiring cloudflare:test.
 *
 * @see objects/GeoReplication.ts for implementation
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  GeoReplicationModule,
  createGeoReplicationModule,
  type RegionConfig,
  type GeoConfigResult,
  type WriteResult,
  type ReadResult,
  type VectorClock,
  type ConflictInfo,
  type FailoverEvent,
  type ReplicationLagMetrics,
  type ConsistencyMetrics,
  type RegionInfo,
} from '../GeoReplication'
import type { LifecycleContext } from '../lifecycle/types'

// ============================================================================
// MOCK IMPLEMENTATIONS
// ============================================================================

/**
 * Mock storage that simulates DurableObjectStorage
 */
class MockStorage {
  private store: Map<string, unknown> = new Map()

  async get<T>(key: string): Promise<T | undefined> {
    return this.store.get(key) as T | undefined
  }

  async put(key: string, value: unknown): Promise<void> {
    this.store.set(key, value)
  }

  async delete(key: string): Promise<boolean> {
    return this.store.delete(key)
  }

  async list(options?: { prefix?: string }): Promise<Map<string, unknown>> {
    const result = new Map<string, unknown>()
    for (const [key, value] of this.store) {
      if (!options?.prefix || key.startsWith(options.prefix)) {
        result.set(key, value)
      }
    }
    return result
  }

  clear(): void {
    this.store.clear()
  }
}

/**
 * Create a mock LifecycleContext for testing
 */
function createMockContext(): LifecycleContext {
  const storage = new MockStorage()
  const events: Array<{ verb: string; data: unknown }> = []

  return {
    ns: 'test-do',
    currentBranch: 'main',
    db: null as any, // Not needed for geo-replication
    env: {} as any, // Not needed for geo-replication
    ctx: {
      storage: storage as any,
    } as any,
    emitEvent: async (verb: string, data?: unknown) => {
      events.push({ verb, data })
    },
    log: (message: string, data?: unknown) => {
      // Silent in tests
    },
  }
}

// ============================================================================
// TEST SUITE: REGION CONFIGURATION
// ============================================================================

describe('Geo-Replication', () => {
  let geo: GeoReplicationModule
  let ctx: LifecycleContext

  beforeEach(() => {
    geo = createGeoReplicationModule()
    ctx = createMockContext()
    geo.initialize(ctx)
  })

  describe('Region Configuration', () => {
    it('should configure primary region', async () => {
      const result = await geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west', 'ap-south'],
      })

      expect(result.primary).toBe('us-east')
      expect(result.replicas).toContain('eu-west')
      expect(result.replicas).toContain('ap-south')
    })

    it('should get current region configuration', async () => {
      await geo.configureRegion({
        primary: 'us-west',
        replicas: ['eu-central'],
      })

      const config = await geo.getRegionConfig()

      expect(config.primary).toBe('us-west')
      expect(config.replicas).toEqual(['eu-central'])
      expect(config.version).toBeGreaterThanOrEqual(1)
    })

    it('should validate region codes using IATA format', async () => {
      // Should accept valid IATA codes
      const validResult = await geo.configureRegion({
        primary: 'ewr',
        replicas: ['lax', 'fra', 'sin'],
      })
      expect(validResult.primary).toBe('ewr')

      // Should reject invalid codes
      await expect(
        geo.configureRegion({
          primary: 'invalid-region-code',
          replicas: [],
        })
      ).rejects.toThrow(/invalid.*region/i)
    })

    it('should support multiple replicas per continent', async () => {
      const result = await geo.configureRegion({
        primary: 'ewr',
        replicas: ['lax', 'ord', 'fra', 'lhr', 'sin', 'nrt', 'syd'],
      })

      expect(result.replicas.length).toBe(7)
    })

    it('should list available regions with metadata', async () => {
      const regions: RegionInfo[] = await geo.listAvailableRegions()

      expect(Array.isArray(regions)).toBe(true)
      expect(regions.length).toBeGreaterThan(0)

      // Each region should have required metadata
      for (const region of regions) {
        expect(region.code).toBeDefined()
        expect(region.name).toBeDefined()
        expect(region.continent).toBeDefined()
        expect(typeof region.isActive).toBe('boolean')
      }
    })
  })

  // ============================================================================
  // TEST SUITE: WRITE FORWARDING TO PRIMARY
  // ============================================================================

  describe('Write Forwarding to Primary', () => {
    it('should forward writes to primary region', async () => {
      await geo.configureRegion({
        primary: 'eu-west',
        replicas: ['us-east', 'ap-south'],
      })

      const result: WriteResult = await geo.write('customer:123', {
        name: 'Alice',
        email: 'alice@example.com',
      })

      expect(result.primaryRegion).toBe('eu-west')
      expect(result.key).toBe('customer:123')
    })

    it('should propagate writes to all replicas', async () => {
      await geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west', 'ap-south'],
      })

      const result: WriteResult = await geo.write('order:456', {
        items: ['item1', 'item2'],
        total: 99.99,
      })

      expect(result.propagatedTo).toContain('eu-west')
      expect(result.propagatedTo).toContain('ap-south')
      expect(result.propagatedTo.length).toBe(2)
    })

    it('should batch writes for efficiency', async () => {
      await geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west'],
      })

      const results: WriteResult[] = await geo.writeBatch([
        { key: 'item:1', value: { data: 'one' } },
        { key: 'item:2', value: { data: 'two' } },
        { key: 'item:3', value: { data: 'three' } },
      ])

      expect(results.length).toBe(3)
      for (const result of results) {
        expect(result.primaryRegion).toBe('us-east')
      }
    })

    it('should reject writes when primary is unavailable', async () => {
      await geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west'],
      })

      // Simulate primary unavailable
      await geo.simulateRegionFailure('us-east')

      // Write should fail (unless failover has occurred)
      await expect(
        geo.write('test-key', { value: 'test' })
      ).rejects.toThrow(/primary.*unavailable/i)
    })

    it('should queue writes during network partition', async () => {
      await geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west'],
      })

      // Simulate network partition
      await geo.simulatePartition(['eu-west'])

      // Write to primary should succeed but queue for eu-west
      const result = await geo.write('queued-key', { value: 'queued' })

      expect(result.primaryRegion).toBe('us-east')

      // Check queue status
      const queueStatus = await geo.getReplicationQueue('eu-west')
      expect(queueStatus.pendingWrites).toBeGreaterThan(0)
    })
  })

  // ============================================================================
  // TEST SUITE: READ ROUTING TO NEAREST REPLICA
  // ============================================================================

  describe('Read Routing to Nearest Replica', () => {
    it('should route reads to nearest replica', async () => {
      await geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west', 'ap-south'],
      })

      // Write data first
      await geo.write('data:123', { value: 'test' })

      // Set caller location hint
      const result: ReadResult = await geo.read('data:123', {
        callerRegion: 'eu-central', // Should route to eu-west
      })

      expect(result.sourceRegion).toBe('eu-west')
    })

    it('should fall back to primary when replicas unavailable', async () => {
      await geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west'],
      })

      // Write data first
      await geo.write('data:456', { value: 'test' })

      // Simulate replica failure
      await geo.simulateRegionFailure('eu-west')

      const result: ReadResult = await geo.read('data:456', {
        callerRegion: 'eu-central',
      })

      expect(result.sourceRegion).toBe('us-east')
    })

    it('should support read preference configuration', async () => {
      await geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west', 'ap-south'],
        readPreference: 'primary',
      })

      // Write data first
      await geo.write('data:789', { value: 'test' })

      // With primary preference, should always read from primary
      const result: ReadResult = await geo.read('data:789', {
        callerRegion: 'ap-northeast',
      })

      expect(result.sourceRegion).toBe('us-east')
    })

    it('should measure latency to each replica', async () => {
      await geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west', 'ap-south'],
      })

      const latencies = await geo.measureReplicaLatencies()

      expect(latencies['us-east']).toBeDefined()
      expect(latencies['eu-west']).toBeDefined()
      expect(latencies['ap-south']).toBeDefined()
      expect(typeof latencies['eu-west']).toBe('number')
    })

    it('should cache routing decisions for performance', async () => {
      await geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west'],
      })

      // Write data first
      await geo.write('data:abc', { value: 'test1' })
      await geo.write('data:xyz', { value: 'test2' })

      // First read - routing decision calculated
      const result1 = await geo.read('data:abc', {
        callerRegion: 'eu-central',
      })

      // Second read - should use cached routing
      const result2 = await geo.read('data:xyz', {
        callerRegion: 'eu-central',
      })

      // Both should route to same region
      expect(result1.sourceRegion).toBe(result2.sourceRegion)

      // Check cache stats
      const cacheStats = await geo.getRoutingCacheStats()
      expect(cacheStats.hits).toBeGreaterThan(0)
    })
  })

  // ============================================================================
  // TEST SUITE: CONFLICT RESOLUTION
  // ============================================================================

  describe('Conflict Resolution', () => {
    describe('Last-Writer-Wins (LWW)', () => {
      it('should resolve conflicts using timestamp', async () => {
        await geo.configureRegion({
          primary: 'us-east',
          replicas: ['eu-west'],
          conflictResolution: 'lww',
        })

        // Simulate concurrent writes with different timestamps
        const earlier = Date.now() - 1000
        const later = Date.now()

        await geo.writeWithTimestamp('key:conflict', 'value-earlier', earlier)
        await geo.writeWithTimestamp('key:conflict', 'value-later', later)

        const result = await geo.read('key:conflict')
        expect(result.value).toBe('value-later')
      })

      it('should use microsecond precision for timestamps', async () => {
        await geo.configureRegion({
          primary: 'us-east',
          replicas: ['eu-west'],
          conflictResolution: 'lww',
        })

        // Write with high-precision timestamps
        const ts1 = 1704067200000.001 // Microsecond precision
        const ts2 = 1704067200000.002

        await geo.writeWithTimestamp('key:precise', 'value1', ts1)
        await geo.writeWithTimestamp('key:precise', 'value2', ts2)

        const result = await geo.read('key:precise')
        expect(result.value).toBe('value2')
      })
    })

    describe('Vector Clocks', () => {
      it('should track vector clocks for causality', async () => {
        await geo.configureRegion({
          primary: 'us-east',
          replicas: ['eu-west', 'ap-south'],
          conflictResolution: 'vector-clock',
        })

        // Write from primary
        await geo.write('key:versioned', { data: 'initial' })

        const clock: VectorClock = await geo.getVectorClock('key:versioned')

        expect(clock['us-east']).toBeDefined()
        expect(clock['us-east']).toBeGreaterThanOrEqual(1)
      })

      it('should detect concurrent writes with vector clocks', async () => {
        await geo.configureRegion({
          primary: 'us-east',
          replicas: ['eu-west'],
          conflictResolution: 'vector-clock',
        })

        // Simulate concurrent writes from different regions
        const clock1: VectorClock = { 'us-east': 1, 'eu-west': 0 }
        const clock2: VectorClock = { 'us-east': 0, 'eu-west': 1 }

        await geo.writeWithVectorClock('key:concurrent', 'value-a', clock1)
        await geo.writeWithVectorClock('key:concurrent', 'value-b', clock2)

        const conflicts: ConflictInfo[] = await geo.getConflicts()

        expect(conflicts.length).toBeGreaterThan(0)
        expect(conflicts[0].key).toBe('key:concurrent')
        expect(conflicts[0].conflictingValues.length).toBe(2)
      })

      it('should merge vector clocks on resolution', async () => {
        await geo.configureRegion({
          primary: 'us-east',
          replicas: ['eu-west'],
          conflictResolution: 'vector-clock',
        })

        // Create conflict
        const clock1: VectorClock = { 'us-east': 2, 'eu-west': 1 }
        const clock2: VectorClock = { 'us-east': 1, 'eu-west': 2 }

        await geo.writeWithVectorClock('key:merge', 'value-a', clock1)
        await geo.writeWithVectorClock('key:merge', 'value-b', clock2)

        // Resolve conflict manually
        await geo.resolveConflict('key:merge', 'value-resolved')

        const newClock = await geo.getVectorClock('key:merge')

        // Merged clock should have max of each component
        expect(newClock['us-east']).toBeGreaterThanOrEqual(2)
        expect(newClock['eu-west']).toBeGreaterThanOrEqual(2)
      })
    })

    describe('Conflict Reporting', () => {
      it('should report unresolved conflicts', async () => {
        await geo.configureRegion({
          primary: 'us-east',
          replicas: ['eu-west'],
          conflictResolution: 'manual',
        })

        // Create conflicts
        await geo.simulateConcurrentWrite('key:report1', 'value-a', 'us-east')
        await geo.simulateConcurrentWrite('key:report1', 'value-b', 'eu-west')

        const conflicts = await geo.getUnresolvedConflicts()

        expect(Array.isArray(conflicts)).toBe(true)
        expect(conflicts.length).toBeGreaterThan(0)
      })

      it('should emit conflict events', async () => {
        await geo.configureRegion({
          primary: 'us-east',
          replicas: ['eu-west'],
        })

        // Subscribe to conflict events
        const events: ConflictInfo[] = []
        await geo.onConflict((event: ConflictInfo) => events.push(event))

        // Create conflict
        await geo.simulateConcurrentWrite('key:event', 'value-a', 'us-east')
        await geo.simulateConcurrentWrite('key:event', 'value-b', 'eu-west')

        // Check events were emitted
        expect(events.length).toBeGreaterThan(0)
        expect(events[0].key).toBe('key:event')
      })
    })
  })

  // ============================================================================
  // TEST SUITE: EVENTUAL CONSISTENCY GUARANTEES
  // ============================================================================

  describe('Eventual Consistency Guarantees', () => {
    it('should default to eventual consistency', async () => {
      await geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west'],
      })

      const config: ConsistencyMetrics = await geo.getConsistencyConfig()

      expect(config.level).toBe('eventual')
    })

    it('should support strong consistency option', async () => {
      await geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west', 'ap-south'],
        consistency: 'strong',
      })

      const config: ConsistencyMetrics = await geo.getConsistencyConfig()

      expect(config.level).toBe('strong')
      expect(config.quorumSize).toBeDefined()
    })

    it('should support bounded staleness', async () => {
      await geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west'],
        consistency: 'bounded-staleness',
        maxStalenessMs: 5000,
      })

      const config: ConsistencyMetrics = await geo.getConsistencyConfig()

      expect(config.level).toBe('bounded-staleness')
      expect(config.staleness).toBe(5000)
    })

    it('should block stale reads when staleness exceeded', async () => {
      await geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west'],
        consistency: 'bounded-staleness',
        maxStalenessMs: 100, // Very low threshold
      })

      // Write data
      await geo.write('key:stale', { value: 'fresh' })

      // Simulate lag exceeding staleness bound
      await geo.simulateReplicationLag('eu-west', 200)

      // Read from eu-west should fail or route to primary
      const result = await geo.read('key:stale', {
        callerRegion: 'eu-west',
        requireFresh: true,
      })

      // Should fall back to primary
      expect(result.sourceRegion).toBe('us-east')
    })

    it('should guarantee read-your-writes consistency', async () => {
      await geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west'],
      })

      // Write from a specific session
      const sessionId = 'session-123'
      await geo.writeWithSession(sessionId, 'key:ryw', { value: 'written' })

      // Read with same session should see the write
      const result = await geo.readWithSession(sessionId, 'key:ryw')

      expect(result.value).toEqual({ value: 'written' })
    })
  })

  // ============================================================================
  // TEST SUITE: FAILOVER SCENARIOS
  // ============================================================================

  describe('Failover Scenarios', () => {
    it('should detect primary failure via health checks', async () => {
      await geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west', 'ap-south'],
        failover: { enabled: true, healthCheckIntervalMs: 100 },
      })

      // Simulate primary failure
      await geo.simulateRegionFailure('us-east')

      const status = await geo.getRegionStatus('us-east')
      expect(status.healthy).toBe(false)
    })

    it('should promote replica to primary on failover', async () => {
      await geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west', 'ap-south'],
        failover: { enabled: true, timeoutMs: 100 },
      })

      // Simulate primary failure
      await geo.simulateRegionFailure('us-east')

      // Trigger failover
      const failoverEvent: FailoverEvent = await geo.triggerFailover()

      expect(failoverEvent.previousPrimary).toBe('us-east')
      expect(['eu-west', 'ap-south']).toContain(failoverEvent.newPrimary)
      expect(failoverEvent.reason).toBe('health-check')
    })

    it('should select best replica for promotion', async () => {
      await geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west', 'ap-south'],
        failover: { enabled: true },
      })

      // Set eu-west as more up-to-date
      await geo.setReplicaLag('eu-west', 10)
      await geo.setReplicaLag('ap-south', 500)

      // Simulate failure and failover
      await geo.simulateRegionFailure('us-east')
      const failoverEvent = await geo.triggerFailover()

      // Should select replica with lowest lag
      expect(failoverEvent.newPrimary).toBe('eu-west')
    })

    it('should reintegrate recovered primary', async () => {
      await geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west'],
        failover: { enabled: true },
      })

      // Simulate failure and failover
      await geo.simulateRegionFailure('us-east')
      await geo.triggerFailover()

      // Verify eu-west is now primary
      const statusAfterFailover = await geo.getReplicationStatus()
      expect(statusAfterFailover.primary).toBe('eu-west')

      // Simulate recovery - the old primary should be healthy but NOT automatically added as replica
      // (that would require explicit addReplica call in production)
      await geo.simulateRegionRecovery('us-east')

      // Verify region is healthy again
      const regionStatus = await geo.getRegionStatus('us-east')
      expect(regionStatus.healthy).toBe(true)

      // In production, you would call addReplica to reintegrate
      await geo.addReplica('us-east')

      const finalStatus = await geo.getReplicationStatus()
      expect(finalStatus.replicas).toContain('us-east')
      expect(finalStatus.primary).toBe('eu-west')
    })

    it('should prevent split-brain scenarios', async () => {
      await geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west'],
        failover: { enabled: true },
      })

      // Simulate network partition (not failure)
      await geo.simulatePartition(['us-east'])

      // Both regions might think they're primary
      const usEastStatus = await geo.getRegionRole('us-east')
      const euWestStatus = await geo.getRegionRole('eu-west')

      // System should prevent both being primary
      const primaryCount = [usEastStatus, euWestStatus].filter(
        (s) => s.role === 'primary'
      ).length
      expect(primaryCount).toBe(1)
    })

    it('should track failover history', async () => {
      // Configure with multiple replicas so we can failover twice
      await geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west', 'ap-south'],
        failover: { enabled: true },
      })

      // First failover: us-east -> eu-west
      await geo.simulateRegionFailure('us-east')
      await geo.triggerFailover()

      // Recover us-east and add it back as replica for the second failover
      await geo.simulateRegionRecovery('us-east')
      await geo.addReplica('us-east')

      // Second failover: eu-west -> one of the replicas
      await geo.simulateRegionFailure('eu-west')
      await geo.triggerFailover()

      const history: FailoverEvent[] = await geo.getFailoverHistory()

      expect(history.length).toBe(2)
      expect(history[0].previousPrimary).toBe('us-east')
      expect(history[1].previousPrimary).toBe('eu-west')
    })
  })

  // ============================================================================
  // TEST SUITE: REPLICATION LAG METRICS
  // ============================================================================

  describe('Replication Lag Metrics', () => {
    it('should measure current replication lag', async () => {
      await geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west', 'ap-south'],
      })

      const lag: ReplicationLagMetrics = await geo.getReplicationLag()

      expect(typeof lag.maxLagMs).toBe('number')
      expect(typeof lag.avgLagMs).toBe('number')
      expect(lag.byRegion['eu-west']).toBeDefined()
      expect(lag.byRegion['ap-south']).toBeDefined()
    })

    it('should track lag percentiles', async () => {
      await geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west'],
      })

      // Generate some traffic to build metrics
      for (let i = 0; i < 100; i++) {
        await geo.write(`key:${i}`, { value: i })
      }

      const lag: ReplicationLagMetrics = await geo.getReplicationLag()

      expect(lag.p50LagMs).toBeDefined()
      expect(lag.p95LagMs).toBeDefined()
      expect(lag.p99LagMs).toBeDefined()
      expect(lag.p50LagMs).toBeLessThanOrEqual(lag.p95LagMs)
      expect(lag.p95LagMs).toBeLessThanOrEqual(lag.p99LagMs)
    })

    it('should alert on excessive lag', async () => {
      await geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west'],
        monitoring: { lagAlertThresholdMs: 1000 },
      })

      // Simulate high lag
      await geo.simulateReplicationLag('eu-west', 2000)

      const alerts = await geo.getActiveAlerts()

      expect(alerts.length).toBeGreaterThan(0)
      expect(alerts[0].type).toBe('replication-lag')
      expect(alerts[0].region).toBe('eu-west')
    })

    it('should track lag over time', async () => {
      await geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west'],
      })

      const history = await geo.getLagHistory({
        region: 'eu-west',
        duration: '1h',
        resolution: '1m',
      })

      expect(Array.isArray(history)).toBe(true)
      if (history.length > 0) {
        expect(history[0].timestamp).toBeDefined()
        expect(history[0].lagMs).toBeDefined()
      }
    })

    it('should estimate replication completion time', async () => {
      await geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west'],
      })

      // Simulate backlog
      await geo.simulateReplicationBacklog('eu-west', 1000) // 1000 pending writes

      const eta = await geo.getReplicationETA('eu-west')

      expect(eta.pendingWrites).toBe(1000)
      expect(typeof eta.estimatedCompletionMs).toBe('number')
      expect(eta.estimatedCompletionMs).toBeGreaterThan(0)
    })

    it('should expose lag metrics via prometheus format', async () => {
      await geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west'],
      })

      const metrics: string = await geo.getMetricsPrometheus()

      expect(metrics).toContain('geo_replication_lag_ms')
      expect(metrics).toContain('eu-west')
    })
  })

  // ============================================================================
  // TEST SUITE: INTEGRATION SCENARIOS
  // ============================================================================

  describe('Integration Scenarios', () => {
    it('should handle full replication lifecycle', async () => {
      // 1. Configure regions
      await geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west', 'ap-south'],
        consistency: 'eventual',
        failover: { enabled: true },
      })

      // 2. Write data
      await geo.write('user:1', { name: 'Alice' })

      // 3. Read from nearest
      const read1 = await geo.read('user:1', {
        callerRegion: 'eu-central',
      })
      expect(read1.value.name).toBe('Alice')

      // 4. Simulate failover
      await geo.simulateRegionFailure('us-east')
      const failover = await geo.triggerFailover()

      // 5. Verify continued operation
      const read2 = await geo.read('user:1')
      expect(read2.value.name).toBe('Alice')

      // 6. Check metrics
      const lag = await geo.getReplicationLag()
      expect(lag.maxLagMs).toBeDefined()
    })

    it('should handle region addition', async () => {
      // Start with one replica
      await geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west'],
      })

      // Write some data
      await geo.write('data:1', { value: 'test' })

      // Simulate lag for the new region before adding (syncing state)
      await geo.simulateReplicationLag('ap-south', 100)

      // Add new replica
      await geo.addReplica('ap-south')

      // Verify new replica is syncing (has lag)
      const status = await geo.getReplicaStatus('ap-south')
      expect(status.state).toBe('syncing')

      // Clear the lag to simulate sync completion
      await geo.simulateReplicationLag('ap-south', 0)

      // Verify replica is now synced
      const finalStatus = await geo.getReplicaStatus('ap-south')
      expect(finalStatus.state).toBe('synced')
    })

    it('should handle region removal', async () => {
      await geo.configureRegion({
        primary: 'us-east',
        replicas: ['eu-west', 'ap-south'],
      })

      // Remove a replica
      await geo.removeReplica('ap-south')

      const config = await geo.getRegionConfig()
      expect(config.replicas).not.toContain('ap-south')
      expect(config.replicas).toContain('eu-west')
    })
  })
})
